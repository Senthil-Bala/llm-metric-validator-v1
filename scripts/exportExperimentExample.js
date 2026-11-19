const fs = require('node:fs/promises')
const path = require('node:path')
const ExcelJS = require('exceljs')
const { buildSummaryPrompt } = require('../src/services/promptVariants')
const { loadEngagementRows } = require('../src/services/workbook')

const rootPath = path.resolve(__dirname, '..')
const defaultReportPath = path.join(
  rootPath,
  'reports',
  'experiments',
  'experiment-2026-11-18T13-07-20.804Z.json'
)
function getOutputDirectory(report) {
  const directoryName = report.metadata.taskIds
    ? 'benchmark-run'
    : 'large-comparison'
  return path.join(rootPath, 'examples', directoryName)
}

function toCsvCell(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return `"${String(text).replaceAll('"', '""')}"`
}

function getValidationCounts(result) {
  const summary = result.validation?.summary || {}
  return {
    checked: summary.total || 0,
    matches: summary.matches || 0,
    mismatches: summary.mismatches || 0,
    unknown: summary.unknownMetrics || 0,
    missing: summary.missingMetrics || 0
  }
}

function getInputDescription(result, input) {
  if (input.task) {
    if (result.mode === 'direct') {
      return {
        inputType: `Synthetic rows: ${input.task.name}`,
        inputRecordCount: input.rows.length,
        inputValues: input.rows.map(row => JSON.stringify(row)).join('\n')
      }
    }

    return {
      inputType: `JavaScript reference metrics: ${input.task.name}`,
      inputRecordCount: Object.keys(input.metrics).length,
      inputValues: Object.entries(input.metrics)
        .map(([metric, value]) => `${metric}=${value}`)
        .join('\n')
    }
  }

  if (result.mode === 'direct') {
    return {
      inputType: 'Synthetic daily source rows',
      inputRecordCount: input.rows.length,
      inputValues: input.rows.map(row =>
        `${row.date}: appOpens=${row.appOpens}, sent=${row.sent}, opened=${row.opened}`
      ).join('\n')
    }
  }

  return {
    inputType: 'JavaScript-calculated metrics',
    inputRecordCount: Object.keys(input).length,
    inputValues: Object.entries(input).map(([metric, value]) => `${metric}=${value}`).join('\n')
  }
}

function renderMarkdown(report, details) {
  const reconstructedPromptCount = details.filter(result => result.promptSource === 'Reconstructed from the current prompt builder').length
  const sections = [
    '# Run-by-run comparison: prompt, input, and output',
    '',
    `This walkthrough is reconstructed from the saved experiment report created at **${report.createdAt}** using provider **${report.metadata.provider}** and model **${report.metadata.model}**.`,
    '',
    '## What the two modes mean',
    '',
    '- **Direct:** the model receives synthetic daily rows and is asked to calculate the requested metrics before writing a summary.',
    '- **Grounded:** the model receives metric values calculated by JavaScript and is asked to summarize them without recalculating.',
    '',
    '## Important note about these prompt variants',
    '',
    'Prompt strategy wording is shown exactly for each request. Earlier pilot reports used minor role-framing variants; newer benchmark reports use materially different instruction strategies.',
    '',
    reconstructedPromptCount === 0
      ? 'For every request, this document shows the input payload, exact prompt archived when the request was made, saved model output, and validation counts.'
      : `For every request, this document shows the input values, prompt, saved model output, and validation counts. ${reconstructedPromptCount} historical request prompts were reconstructed because those original reports did not archive prompt text; newer reports archive the exact prompt at request time.`,
    ''
  ]

  for (const [index, result] of details.entries()) {
    const counts = getValidationCounts(result)
    const output = result.error
      ? { error: result.error }
      : { summary: result.summary, claims: result.claims }
    sections.push(
      `## Request ${index + 1}: ${result.mode} / ${result.variantId} / run ${result.run}`,
      '',
      `- **Request status:** ${result.error ? 'failed' : 'successful'}`,
      `- **Input type:** ${result.inputDescription.inputType}`,
      `- **Input record count:** ${result.inputDescription.inputRecordCount}`,
      `- **Claims checked:** ${counts.checked}`,
      `- **Matched:** ${counts.matches}; **mismatched:** ${counts.mismatches}; **unknown:** ${counts.unknown}; **missing:** ${counts.missing}`,
      '',
      '### Input values',
      '',
      '```text',
      result.inputDescription.inputValues,
      '```',
      '',
      '### Exact prompt',
      '',
      '```text',
      result.prompt,
      '```',
      '',
      '### Model output',
      '',
      '```json',
      JSON.stringify(output, null, 2),
      '```',
      ''
    )
  }

  return `${sections.join('\n')}\n`
}

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF24527A' } }
  row.alignment = { vertical: 'middle', wrapText: true }
}

async function writeWorkbook(report, details, outputDirectory) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'MetricCheck'
  workbook.subject = 'Prompt, input, output, and numeric validation results'

  const guide = workbook.addWorksheet('Mode Guide')
  guide.columns = [
    { header: 'Topic', key: 'topic', width: 28 },
    { header: 'Explanation', key: 'explanation', width: 105 }
  ]
  guide.addRows([
    {
      topic: 'Grounded mode',
      explanation: 'JavaScript calculates the reference metrics first. The model receives the calculated values and is asked to summarize them without recalculating.'
    },
    {
      topic: 'Direct mode',
      explanation: 'The model receives the synthetic daily source rows and metric definitions. It is asked to calculate the metrics and write a summary.'
    },
    {
      topic: 'Shared evaluation',
      explanation: 'Both modes are checked against the same reference values calculated locally by MetricCheck. A MATCH means the structured numeric claim is within 0.01 of the reference value.'
    },
    {
      topic: 'Prompt strategies in this run',
      explanation: `Strategies: ${(report.metadata.variantIds || []).join(', ')}. See each exact prompt on the Run Results sheet.`
    },
    {
      topic: 'Request success rate',
      explanation: `${report.summary.successfulRequests} of ${report.summary.totalRequests} scheduled summary requests succeeded (${report.summary.totalRequests ? (100 * report.summary.successfulRequests / report.summary.totalRequests).toFixed(2) : '0.00'}%). This measures completed requests, not claim accuracy.`
    },
    {
      topic: 'Claim match rate',
      explanation: `${report.summary.matchingClaims} of ${report.summary.matchingClaims + report.summary.mismatchingClaims + report.summary.unknownMetricClaims + report.summary.missingMetricClaims} evaluated claims matched (${report.comparison.map(item => `${item.mode}: ${item.accuracyPercent}%`).join('; ')}). Mismatch, unknown, and missing claims are counted separately on the Run Results sheet.`
    },
    {
      topic: 'Run metadata',
      explanation: `Provider: ${report.metadata.provider}; model: ${report.metadata.model}; created: ${report.createdAt}; source: ${report.metadata.workbook || report.metadata.datasetType || 'benchmark tasks'}.`
    },
    {
      topic: 'Prompt archival',
      explanation: details.some(result => result.promptSource === 'Reconstructed from the current prompt builder')
        ? 'This historical report did not archive exact prompts. Prompt text was reconstructed from report data and the current prompt-builder code. New benchmark runs archive exact prompts and inputs at request time.'
        : 'This report archives exact prompts and inputs at request time.'
    },
    {
      topic: 'Scope limitation',
      explanation: 'Results apply only to the selected synthetic tasks, model configuration, prompt strategies, and repetitions. The validator checks structured claims; prose-level numeric checking requires separate evaluation.'
    }
  ])
  styleHeader(guide.getRow(1))
  guide.views = [{ state: 'frozen', ySplit: 1 }]
  guide.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: 'top', wrapText: true }
  })

  const runs = workbook.addWorksheet('Run Results')
  runs.columns = [
    { key: 'requestNumber', width: 12 },
    { key: 'mode', width: 14 },
    { key: 'variant', width: 22 },
    { key: 'run', width: 10 },
    { key: 'status', width: 16 },
    { key: 'inputType', width: 30 },
    { key: 'inputCount', width: 14 },
    { key: 'inputValues', width: 48 },
    { key: 'prompt', width: 85 },
    { key: 'summary', width: 58 },
    { key: 'claims', width: 48 },
    { key: 'checked', width: 15 },
    { key: 'matches', width: 12 },
    { key: 'mismatches', width: 14 },
    { key: 'unknown', width: 12 },
    { key: 'missing', width: 12 },
    { key: 'claimRate', width: 18 }
  ]
  const totalClaims = report.summary.matchingClaims +
    report.summary.mismatchingClaims +
    report.summary.unknownMetricClaims +
    report.summary.missingMetricClaims
  const successRate = report.summary.totalRequests
    ? 100 * report.summary.successfulRequests / report.summary.totalRequests
    : 0
  runs.addRow([
    'OVERALL',
    '',
    '',
    '',
    `${report.summary.successfulRequests}/${report.summary.totalRequests} succeeded`,
    '',
    '',
    `Request success rate: ${successRate.toFixed(2)}%`,
    '',
    '',
    '',
    totalClaims,
    report.summary.matchingClaims,
    report.summary.mismatchingClaims,
    report.summary.unknownMetricClaims,
    report.summary.missingMetricClaims,
    totalClaims ? 100 * report.summary.matchingClaims / totalClaims : 0
  ])
  runs.getRow(1).font = { bold: true }
  runs.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F0D9' } }
  runs.getRow(1).getCell(17).numFmt = '0.00'
  const header = runs.addRow([
    'Request #',
    'Mode',
    'Prompt variant',
    'Run #',
    'Request status',
    'Input type',
    'Input records',
    'Input values',
    'Exact prompt',
    'Model summary',
    'Model claims',
    'Claims checked',
    'Matched',
    'Mismatched',
    'Unknown',
    'Missing',
    'Claim match rate %'
  ])
  styleHeader(header)

  details.forEach((result, index) => {
    const counts = getValidationCounts(result)
    const claims = result.claims || []
    const claimRate = counts.checked
      ? 100 * counts.matches / counts.checked
      : 0
    runs.addRow({
      requestNumber: index + 1,
      mode: result.mode,
      variant: result.variantId,
      run: result.run,
      status: result.error ? 'Failed' : 'Success',
      inputType: result.inputDescription.inputType,
      inputCount: result.inputDescription.inputRecordCount,
      inputValues: result.inputDescription.inputValues,
      prompt: result.prompt,
      summary: result.summary || result.error?.message || '',
      claims: claims.map(claim => `${claim.metric} = ${claim.value}`).join('\n'),
      checked: counts.checked,
      matches: counts.matches,
      mismatches: counts.mismatches,
      unknown: counts.unknown,
      missing: counts.missing,
      claimRate
    })
  })
  runs.getRow(2).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } } })
  runs.getRow(2).eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF24527A' } } })
  runs.getRow(2).alignment = { vertical: 'middle', wrapText: true }
  runs.getRow(1).height = 30
  runs.getRow(2).height = 34
  runs.views = [{ state: 'frozen', ySplit: 2, xSplit: 4 }]
  runs.autoFilter = { from: 'A2', to: 'Q2' }
  runs.eachRow((row, rowNumber) => {
    if (rowNumber > 2) {
      row.alignment = { vertical: 'top', wrapText: true }
      row.getCell(17).numFmt = '0.00'
    }
  })

  await workbook.xlsx.writeFile(path.join(outputDirectory, 'comparison-details.xlsx'))
}

async function main() {
  const reportPath = path.resolve(process.argv[2] || defaultReportPath)
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'))
  const outputDirectory = getOutputDirectory(report)
  let rows = []
  if (report.results.some(result => !result.input && result.mode === 'direct')) {
    const workbookPath = path.resolve(
      rootPath,
      report.metadata.workbook || 'data/sample-engagement.xlsx'
    )
    rows = await loadEngagementRows(workbookPath)
  }

  const details = report.results.map(result => {
    const input = result.input || (result.mode === 'direct'
      ? { rows, expectedMetricKeys: report.metrics }
      : report.metrics)
    return {
      ...result,
      inputDescription: getInputDescription(result, input),
      prompt: result.prompt || buildSummaryPrompt(input, result.variantId, result.mode),
      promptSource: result.prompt
        ? 'Archived at request time'
        : 'Reconstructed from the current prompt builder'
    }
  })

  await fs.mkdir(outputDirectory, { recursive: true })
  const markdown = renderMarkdown(report, details)
  const csvHeader = [
    'request_number',
    'mode',
    'prompt_variant',
    'run',
    'request_status',
    'input_type',
    'input_record_count',
    'input_values',
    'exact_prompt',
    'model_summary',
    'model_claims',
    'claims_checked',
    'matches',
    'mismatches',
    'unknown_metrics',
    'missing_claims',
    'claim_match_rate_percent'
  ]
  const csvRows = details.map((result, index) => {
    const counts = getValidationCounts(result)
    const total = counts.checked
    return [
      index + 1,
      result.mode,
      result.variantId,
      result.run,
      result.error ? 'failed' : 'success',
      result.inputDescription.inputType,
      result.inputDescription.inputRecordCount,
      result.inputDescription.inputValues,
      result.prompt,
      result.summary || result.error?.message || '',
      (result.claims || []).map(claim => `${claim.metric}=${claim.value}`).join('\n'),
      counts.checked,
      counts.matches,
      counts.mismatches,
      counts.unknown,
      counts.missing,
      total ? (100 * counts.matches / total).toFixed(2) : '0.00'
    ]
  })
  const csv = [
    csvHeader.map(toCsvCell).join(','),
    ...csvRows.map(row => row.map(toCsvCell).join(','))
  ].join('\n') + '\n'

  await Promise.all([
    fs.writeFile(path.join(outputDirectory, 'run-by-run.md'), markdown),
    fs.writeFile(path.join(outputDirectory, 'run-details.csv'), csv),
    writeWorkbook(report, details, outputDirectory)
  ])

  console.log(`Wrote prompt, input, output, and numeric results for ${details.length} requests:`)
  console.log(`- ${path.relative(rootPath, path.join(outputDirectory, 'comparison-details.xlsx'))}`)
  console.log(`- ${path.relative(rootPath, path.join(outputDirectory, 'run-by-run.md'))}`)
  console.log(`- ${path.relative(rootPath, path.join(outputDirectory, 'run-details.csv'))}`)
}

main().catch(error => {
  console.error(`Could not export experiment example: ${error.message}`)
  process.exitCode = 1
})
