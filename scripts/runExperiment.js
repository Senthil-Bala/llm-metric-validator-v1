require('dotenv').config()

const fs = require('node:fs/promises')
const path = require('node:path')
const {
  getBenchmarkTasks,
  tasks: availableTasks,
  DEFAULT_TASK_IDS
} = require('../src/services/benchmarkTasks')
const { generateSummary } = require('../src/services/llm')
const { variants, DEFAULT_VARIANT_IDS, MODES } = require('../src/services/promptVariants')
const {
  DEFAULT_RUNS_PER_VARIANT,
  MAX_RUNS_PER_VARIANT,
  runExperiment
} = require('../src/services/experiment')

function parseArguments(args) {
  const options = {
    runsPerVariant: DEFAULT_RUNS_PER_VARIANT,
    variantIds: DEFAULT_VARIANT_IDS,
    modes: MODES,
    taskIds: DEFAULT_TASK_IDS
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--runs') {
      const value = Number(args[index + 1])
      if (!Number.isInteger(value) || value < 1 || value > MAX_RUNS_PER_VARIANT) {
        throw new Error(`--runs must be an integer between 1 and ${MAX_RUNS_PER_VARIANT}.`)
      }
      options.runsPerVariant = value
      index += 1
    } else if (argument === '--variants') {
      const value = args[index + 1]
      if (!value) {
        throw new Error('--variants requires comma-separated prompt variant IDs.')
      }
      options.variantIds = value.split(',').map(item => item.trim()).filter(Boolean)
      index += 1
    } else if (argument === '--modes') {
      const value = args[index + 1]
      if (!value) {
        throw new Error('--modes requires comma-separated mode names.')
      }
      options.modes = value.split(',').map(item => item.trim()).filter(Boolean)
      index += 1
    } else if (argument === '--tasks') {
      const value = args[index + 1]
      if (!value) {
        throw new Error('--tasks requires comma-separated task IDs.')
      }
      options.taskIds = value.split(',').map(item => item.trim()).filter(Boolean)
      index += 1
    } else if (argument === '--help') {
      options.help = true
    } else {
      throw new Error(`Unknown option "${argument}".`)
    }
  }

  const knownVariantIds = new Set(variants.map(variant => variant.id))
  for (const variantId of options.variantIds) {
    if (!knownVariantIds.has(variantId)) {
      throw new Error(`Unknown variant "${variantId}". Available variants: ${[...knownVariantIds].join(', ')}`)
    }
  }
  for (const mode of options.modes) {
    if (!MODES.includes(mode)) {
      throw new Error(`Unknown mode "${mode}". Available modes: ${MODES.join(', ')}`)
    }
  }
  const knownTaskIds = new Set(availableTasks.map(task => task.id))
  for (const taskId of options.taskIds) {
    if (!knownTaskIds.has(taskId)) {
      throw new Error(`Unknown task "${taskId}". Available tasks: ${[...knownTaskIds].join(', ')}`)
    }
  }
  if (new Set(options.taskIds).size !== options.taskIds.length) {
    throw new Error('Benchmark tasks must not be repeated.')
  }

  return options
}

function printHelp() {
  console.log([
    'Usage: npm run experiment -- [options]',
    '',
    `Options:`,
    `  --runs <1-${MAX_RUNS_PER_VARIANT}>      Repetitions per task/mode/prompt (default ${DEFAULT_RUNS_PER_VARIANT})`,
    `  --tasks <ids>       Comma-separated task IDs (default ${DEFAULT_TASK_IDS.length} standard tasks)`,
    `  --variants <ids>    Comma-separated prompt strategies (default ${DEFAULT_VARIANT_IDS.join(',')})`,
    `  --modes <names>     Comma-separated modes (default ${MODES.join(',')})`,
    '  --help              Show this help',
    '',
    `Available prompt strategies: ${variants.map(variant => `${variant.id} (${variant.name})`).join(', ')}`,
    `Available tasks: ${availableTasks.map(task => `${task.id}${task.defaultSelected === false ? ' (opt-in)' : ''} (${task.category})`).join(', ')}`,
    `Default experiment: ${DEFAULT_TASK_IDS.length} tasks x ${DEFAULT_VARIANT_IDS.length} prompt strategies x ${MODES.length} modes x ${DEFAULT_RUNS_PER_VARIANT} runs = ${DEFAULT_TASK_IDS.length * DEFAULT_VARIANT_IDS.length * MODES.length * DEFAULT_RUNS_PER_VARIANT} requests, plus provider retries.`
  ].join('\n'))
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const rootPath = path.resolve(__dirname, '..')
  const provider = process.env.LLM_PROVIDER || 'gemini'
  const benchmarkTasks = getBenchmarkTasks(options.taskIds)
  const requestCount = benchmarkTasks.length * options.variantIds.length *
    options.runsPerVariant * options.modes.length
  console.log(`Running ${requestCount} summary requests with ${provider}.`)
  console.log(`Tasks: ${benchmarkTasks.map(task => task.id).join(', ')}`)
  console.log(`Prompt strategies: ${options.variantIds.join(', ')}`)
  console.log('Grounded mode sends deterministic reference metrics; direct mode sends task rows.')

  const report = await runExperiment({
    tasks: benchmarkTasks,
    variantIds: options.variantIds,
    modes: options.modes,
    runsPerVariant: options.runsPerVariant,
    generate: generateSummary,
    metadata: {
      provider,
      model: process.env[provider === 'deepseek' ? 'DEEPSEEK_MODEL' : 'GEMINI_MODEL'],
      temperature: process.env.LLM_TEMPERATURE || 'provider-default',
      thinkingMode: process.env.LLM_PROVIDER === 'deepseek'
        ? process.env.DEEPSEEK_THINKING_MODE || 'provider-default'
        : 'not-applicable',
      datasetType: 'synthetic-benchmark'
    }
  })

  const reportsDirectory = path.join(rootPath, 'reports', 'experiments')
  await fs.mkdir(reportsDirectory, { recursive: true })
  const timestamp = new Date().toISOString().replaceAll(':', '-')
  const reportPath = path.join(reportsDirectory, `experiment-${timestamp}.json`)
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })

  console.log(`\nExperiment report saved to ${path.relative(rootPath, reportPath)}`)
  console.log(JSON.stringify({
    summary: report.summary,
    byMode: report.byMode,
    comparison: report.comparison,
    byTask: report.byTask,
    byVariant: report.byVariant,
    metricConsistency: report.metricConsistency
  }, null, 2))

  if (report.summary.failedRequests > 0) {
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(`Experiment failed: ${error.message}`)
  process.exitCode = 1
})
