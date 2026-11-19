const test = require('node:test')
const assert = require('node:assert/strict')
const {
  runExperiment,
  validateExperimentOptions,
  validateExperimentClaims
} = require('../src/services/experiment')
const { getBenchmarkTasks } = require('../src/services/benchmarkTasks')
const { DEFAULT_VARIANT_IDS } = require('../src/services/promptVariants')

const metrics = {
  total_app_opens: 100,
  notification_open_rate_percent: 25
}
const task = {
  id: 'test-task',
  name: 'Test task',
  category: 'test',
  description: 'Calculate the total and rate.',
  metricDefinitions: ['total_app_opens is the total.', 'notification_open_rate_percent is the rate.'],
  rows: [{ date: '2026-01-01', appOpens: 100, sent: 20, opened: 5 }],
  referenceMetrics: metrics
}

test('rejects invalid run limits and unknown or duplicate variants', () => {
  assert.throws(
    () => validateExperimentOptions({ runsPerVariant: 11, variantIds: ['concise'] }),
    /between 1 and 10/
  )
  assert.throws(
    () => validateExperimentOptions({ runsPerVariant: 1, variantIds: ['not-a-strategy'] }),
    /Unknown prompt strategy/
  )
  assert.throws(
    () => validateExperimentOptions({ runsPerVariant: 1, variantIds: ['concise', 'concise'] }),
    /selected more than once/
  )
  assert.throws(
    () => validateExperimentOptions({ runsPerVariant: 1, variantIds: ['concise'], modes: ['grounded', 'grounded'] }),
    /modes must not be repeated/
  )
})

test('marks expected metrics missing when a generated response omits claims', () => {
  const validation = validateExperimentClaims([
    { metric: 'total_app_opens', value: 100 }
  ], metrics)

  assert.equal(validation.summary.matches, 1)
  assert.equal(validation.summary.missingMetrics, 1)
  assert.equal(validation.results[1].status, 'MISSING_CLAIM')
})

test('runs each task, prompt strategy, mode, and repetition and archives the exact prompt and input', async () => {
  let callCount = 0
  const inputs = []
  const report = await runExperiment({
    tasks: [task],
    variantIds: ['concise', 'formula-led'],
    runsPerVariant: 2,
    metadata: { provider: 'test-provider', model: 'test-model' },
    generate: async (input, variantId, mode) => {
      callCount += 1
      inputs.push({ input, mode })
      return {
        summary: `${variantId} response`,
        claims: [
          { metric: 'total_app_opens', value: 100 },
          { metric: 'notification_open_rate_percent', value: callCount === 3 ? 24 : 25 }
        ]
      }
    },
    modes: ['grounded', 'direct']
  })

  assert.equal(callCount, 8)
  assert.equal(report.summary.totalRequests, 8)
  assert.equal(report.summary.successfulRequests, 8)
  assert.equal(report.summary.matchingClaims, 15)
  assert.equal(report.summary.mismatchingClaims, 1)
  assert.equal(report.comparison.find(item => item.mode === 'grounded').accuracyPercent, 87.5)
  assert.equal(report.comparison.find(item => item.mode === 'direct').accuracyPercent, 100)
  assert.equal(report.metricConsistency.find(item => item.mode === 'grounded' && item.metric === 'total_app_opens').variedAcrossRuns, false)
  assert.equal(report.metricConsistency.find(item =>
    item.mode === 'grounded' &&
    item.variantId === 'formula-led' &&
    item.metric === 'notification_open_rate_percent'
  ).variedAcrossRuns, true)
  assert.deepEqual(inputs.find(item => item.mode === 'grounded').input.metrics, metrics)
  assert.deepEqual(inputs.find(item => item.mode === 'direct').input.rows, task.rows)
  assert.equal(report.results[0].taskId, 'test-task')
  assert.match(report.results[0].prompt, /Return exactly one claim/)
  assert.equal(report.metadata.model, 'test-model')
})

test('records a failed provider attempt and continues the experiment', async () => {
  let callCount = 0
  const report = await runExperiment({
    tasks: [task],
    variantIds: ['concise'],
    runsPerVariant: 2,
    modes: ['grounded'],
    generate: async () => {
      callCount += 1
      if (callCount === 1) throw new Error('provider unavailable')
      return {
        summary: 'App opens were 100.',
        claims: [{ metric: 'total_app_opens', value: 100 }]
      }
    }
  })

  assert.equal(report.summary.failedRequests, 1)
  assert.equal(report.summary.successfulRequests, 1)
  assert.match(report.results[0].error.message, /provider unavailable/)
})

test('one dry-run repetition schedules every benchmark task across all modes and strategies', async () => {
  const tasks = getBenchmarkTasks()
  const referenceById = new Map(tasks.map(item => [item.id, item.referenceMetrics]))
  const report = await runExperiment({
    tasks,
    variantIds: DEFAULT_VARIANT_IDS,
    runsPerVariant: 1,
    generate: async input => {
      const taskId = input.task.id
      return {
        summary: `Results for ${taskId}.`,
        claims: Object.entries(referenceById.get(taskId)).map(([metric, value]) => ({ metric, value }))
      }
    }
  })

  assert.equal(report.summary.totalRequests, 30)
  assert.equal(report.summary.successfulRequests, 30)
  assert.equal(report.summary.failedRequests, 0)
  assert.equal(report.summary.mismatchingClaims, 0)
  assert.equal(report.summary.missingMetricClaims, 0)
  assert.deepEqual(report.byTask.map(item => item.taskId), tasks.map(item => item.id))
  assert.equal(report.results.every(result => result.prompt && result.input), true)
  assert.equal(new Set(report.results.map(result => result.prompt)).size, 30)
})
