const { validateClaims } = require('./claims')
const { variants, MODES } = require('./promptVariants')
const { buildSummaryPrompt } = require('./promptVariants')

const DEFAULT_RUNS_PER_VARIANT = 3
const MAX_RUNS_PER_VARIANT = 10

function validateExperimentClaims(claims, metrics) {
  const validation = validateClaims(claims, metrics)
  const reportedMetrics = new Set(claims.map(claim => claim.metric))
  const missingMetrics = Object.keys(metrics).filter(metric => !reportedMetrics.has(metric))

  for (const metric of missingMetrics) {
    validation.results.push({
      metric,
      expectedValue: metrics[metric],
      status: 'MISSING_CLAIM'
    })
  }

  validation.summary.missingMetrics = missingMetrics.length
  return validation
}

function validateExperimentOptions({ runsPerVariant, variantIds, modes = ['grounded', 'direct'] }) {
  if (!Number.isInteger(runsPerVariant) || runsPerVariant < 1 || runsPerVariant > MAX_RUNS_PER_VARIANT) {
    throw new Error(`runsPerVariant must be an integer between 1 and ${MAX_RUNS_PER_VARIANT}.`)
  }
  if (!Array.isArray(variantIds) || variantIds.length === 0) {
    throw new Error('Select at least one prompt strategy.')
  }
  if (!Array.isArray(modes) || modes.length === 0) {
    throw new Error('Select at least one experiment mode.')
  }
  for (const mode of modes) {
    if (!MODES.includes(mode)) {
      throw new Error(`Unknown experiment mode "${mode}".`)
    }
  }
  if (new Set(modes).size !== modes.length) {
    throw new Error('Experiment modes must not be repeated.')
  }

  const availableIds = new Set(variants.map(variant => variant.id))
  const seenIds = new Set()
  for (const variantId of variantIds) {
    if (!availableIds.has(variantId)) {
      throw new Error(`Unknown prompt strategy "${variantId}". Available strategies: ${[...availableIds].join(', ')}`)
    }
    if (seenIds.has(variantId)) {
      throw new Error(`Prompt strategy "${variantId}" was selected more than once.`)
    }
    seenIds.add(variantId)
  }

  return { runsPerVariant, variantIds: [...variantIds], modes: [...modes] }
}

function sumValidation(results, key) {
  return results.reduce((sum, result) => sum + (result.validation?.summary[key] || 0), 0)
}

function summarizeRequests(results) {
  const successfulRequests = results.filter(result => !result.error).length
  return {
    totalRequests: results.length,
    successfulRequests,
    failedRequests: results.length - successfulRequests,
    successRatePercent: results.length
      ? Math.round((successfulRequests / results.length) * 10000) / 100
      : null,
    matchingClaims: sumValidation(results, 'matches'),
    mismatchingClaims: sumValidation(results, 'mismatches'),
    unknownMetricClaims: sumValidation(results, 'unknownMetrics'),
    missingMetricClaims: sumValidation(results, 'missingMetrics')
  }
}

function buildExperimentReport(results, metrics, metadata) {
  const modeTaskVariantSummaries = new Map()
  const metricConsistencyGroups = new Map()

  for (const result of results) {
    const taskId = result.taskId || 'sample'
    const groupKey = `${result.mode}:${taskId}:${result.variantId}`
    const group = modeTaskVariantSummaries.get(groupKey) || {
      mode: result.mode,
      taskId,
      taskName: result.taskName || 'Sample workbook',
      taskCategory: result.taskCategory || 'sample',
      variantId: result.variantId,
      attemptedRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      matchingClaims: 0,
      mismatchingClaims: 0,
      unknownMetricClaims: 0,
      missingMetricClaims: 0
    }
    group.attemptedRuns += 1

    if (result.error) {
      group.failedRuns += 1
      modeTaskVariantSummaries.set(groupKey, group)
      continue
    }

    group.successfulRuns += 1
    group.matchingClaims += result.validation.summary.matches
    group.mismatchingClaims += result.validation.summary.mismatches
    group.unknownMetricClaims += result.validation.summary.unknownMetrics
    group.missingMetricClaims += result.validation.summary.missingMetrics

    for (const claim of result.validation.results) {
      const metricKey = `${result.mode}:${taskId}:${result.variantId}:${claim.metric}`
      const observed = metricConsistencyGroups.get(metricKey) || {
        mode: result.mode,
        taskId,
        taskName: result.taskName || 'Sample workbook',
        variantId: result.variantId,
        metric: claim.metric,
        expectedValue: claim.expectedValue ?? null,
        reportedValues: [],
        statuses: []
      }
      if (claim.claimedValue !== undefined) {
        observed.reportedValues.push(claim.claimedValue)
      }
      observed.statuses.push(claim.status)
      metricConsistencyGroups.set(metricKey, observed)
    }

    modeTaskVariantSummaries.set(groupKey, group)
  }

  const metricConsistency = [...metricConsistencyGroups.values()].map(item => ({
    mode: item.mode,
    taskId: item.taskId,
    taskName: item.taskName,
    variantId: item.variantId,
    metric: item.metric,
    expectedValue: item.expectedValue,
    reportedValues: item.reportedValues,
    distinctReportedValues: [...new Set(item.reportedValues)],
    variedAcrossRuns: new Set(item.reportedValues).size > 1,
    allClaimsMatched: item.statuses.length > 0 && item.statuses.every(status => status === 'MATCH')
  }))

  const byMode = MODES
    .filter(mode => results.some(result => result.mode === mode))
    .map(mode => ({ mode, ...summarizeRequests(results.filter(result => result.mode === mode)) }))

  const byTask = [...new Set(results.map(result => result.taskId || 'sample'))].map(taskId => {
    const taskResults = results.filter(result => (result.taskId || 'sample') === taskId)
    return {
      taskId,
      taskName: taskResults[0]?.taskName || 'Sample workbook',
      taskCategory: taskResults[0]?.taskCategory || 'sample',
      ...summarizeRequests(taskResults)
    }
  })

  const allSummary = summarizeRequests(results)
  const comparison = byMode.map(modeSummary => {
    const totalClaims = modeSummary.matchingClaims + modeSummary.mismatchingClaims +
      modeSummary.unknownMetricClaims + modeSummary.missingMetricClaims
    return {
      mode: modeSummary.mode,
      checkedClaims: totalClaims,
      correctClaims: modeSummary.matchingClaims,
      accuracyPercent: totalClaims === 0
        ? null
        : Math.round((modeSummary.matchingClaims / totalClaims) * 10000) / 100
    }
  })

  return {
    createdAt: new Date().toISOString(),
    metadata,
    metrics: metrics || null,
    summary: allSummary,
    byMode,
    comparison,
    byTask,
    byVariant: [...modeTaskVariantSummaries.values()],
    metricConsistency,
    results
  }
}

function buildTaskInput(task, mode) {
  const taskContext = {
    id: task.id,
    name: task.name,
    category: task.category,
    description: task.description,
    metricDefinitions: task.metricDefinitions
  }
  if (mode === 'direct') {
    return {
      task: taskContext,
      rows: task.rows,
      expectedMetricKeys: Object.keys(task.referenceMetrics)
    }
  }
  return { task: taskContext, metrics: task.referenceMetrics }
}

async function runExperiment({
  tasks,
  metrics,
  rows,
  variantIds,
  modes = ['grounded', 'direct'],
  runsPerVariant = DEFAULT_RUNS_PER_VARIANT,
  generate = async () => {
    throw new Error('A summary generator must be provided.')
  },
  metadata = {}
}) {
  const options = validateExperimentOptions({ runsPerVariant, variantIds, modes })
  const legacyMode = !tasks
  const experimentTasks = tasks || [{
    id: 'sample',
    name: 'Sample workbook',
    category: 'sample',
    rows,
    referenceMetrics: metrics
  }]

  if (experimentTasks.length === 0) {
    throw new Error('Select at least one benchmark task.')
  }
  for (const task of experimentTasks) {
    if (!task.id || !task.referenceMetrics || Object.keys(task.referenceMetrics).length === 0) {
      throw new Error('Every benchmark task must have an ID and at least one reference metric.')
    }
    if (options.modes.includes('direct') && (!Array.isArray(task.rows) || task.rows.length === 0)) {
      throw new Error(`Daily rows are required for direct mode task "${task.id}".`)
    }
  }

  const results = []
  for (let run = 1; run <= options.runsPerVariant; run += 1) {
    for (const task of experimentTasks) {
      for (const variantId of options.variantIds) {
        for (const mode of options.modes) {
          const result = {
            mode,
            taskId: task.id,
            taskName: task.name,
            taskCategory: task.category,
            variantId,
            run,
            referenceMetrics: task.referenceMetrics,
            startedAt: new Date().toISOString()
          }

          try {
            const input = legacyMode
              ? mode === 'direct'
                ? { rows: task.rows, expectedMetricKeys: task.referenceMetrics }
                : task.referenceMetrics
              : buildTaskInput(task, mode)
            result.input = input
            result.prompt = buildSummaryPrompt(input, variantId, mode)
            const generated = await generate(input, variantId, mode)
            result.summary = generated.summary
            result.claims = generated.claims
            result.validation = validateExperimentClaims(generated.claims, task.referenceMetrics)
          } catch (error) {
            result.error = {
              message: error.message,
              statusCode: error.statusCode || null
            }
          }

          result.completedAt = new Date().toISOString()
          results.push(result)
        }
      }
    }
  }

  return buildExperimentReport(results, legacyMode ? metrics : null, {
    runsPerVariant: options.runsPerVariant,
    variantIds: options.variantIds,
    modes: options.modes,
    taskIds: experimentTasks.map(task => task.id),
    ...metadata
  })
}

module.exports = {
  DEFAULT_RUNS_PER_VARIANT,
  MAX_RUNS_PER_VARIANT,
  validateExperimentOptions,
  validateExperimentClaims,
  buildExperimentReport,
  runExperiment,
  buildTaskInput
}
