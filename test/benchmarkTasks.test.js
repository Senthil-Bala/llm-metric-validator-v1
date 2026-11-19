const test = require('node:test')
const assert = require('node:assert/strict')
const { getBenchmarkTasks, tasks, DEFAULT_TASK_IDS } = require('../src/services/benchmarkTasks')
const { buildSummaryPrompt, variants } = require('../src/services/promptVariants')
const { buildTaskInput, runExperiment } = require('../src/services/experiment')

test('benchmark includes varied, explicitly categorized calculation tasks', () => {
  assert.deepEqual(DEFAULT_TASK_IDS.map(taskId => tasks.find(task => task.id === taskId).category), [
    'baseline',
    'aggregation',
    'filtering',
    'grouping',
    'multi-step'
  ])
  const benchmarkTasks = getBenchmarkTasks()
  assert.equal(benchmarkTasks.length, 5)
  assert.equal(tasks.length, 6)
  assert.deepEqual(benchmarkTasks[0].referenceMetrics, {
    total_app_opens: 800,
    average_daily_app_opens: 133.33
  })

  test('400-row synthetic benchmark task is reproducible and opt-in', () => {
    const task = getBenchmarkTasks(['synthetic-engagement-400'])[0]
    assert.equal(task.rows.length, 400)
    assert.equal(task.defaultSelected, false)
    assert.equal(DEFAULT_TASK_IDS.includes(task.id), false)
    assert.equal(task.datasetId, 'synthetic-engagement-400-v1')
    assert.equal(new Set(task.rows.map(row => row.date)).size, 100)
    assert.deepEqual([...new Set(task.rows.map(row => row.platform))], [
      'Android',
      'iOS',
      'Web',
      'Other'
    ])
    assert.equal(task.rows.every(row => row.notificationsOpened <= row.notificationsSent), true)
    assert.equal(task.rows.some(row => row.notificationsSent === 0), true)
    assert.equal(task.rows.every(row => row.activeUsers <= row.appOpens), true)
    assert.deepEqual(task.referenceMetrics, {
      total_app_opens: 367535,
      average_daily_app_opens: 3675.35,
      weighted_notification_open_rate_percent: 35.14,
      android_app_opens: 88977,
      north_region_app_opens: 78605,
      social_campaign_app_opens: 87114,
      monthly_app_opens_2026_01: 113415,
      monthly_app_opens_2026_02: 103582,
      monthly_app_opens_2026_03: 111149,
      monthly_app_opens_2026_04: 39389,
      january_to_april_app_opens_change_percent: -65.27
    })

    const regenerated = require('../scripts/createLargeSyntheticDataset').buildDataset()
    assert.deepEqual(regenerated.rows, task.rows)
  })

  test('checked-in large synthetic dataset exports to an Excel sheet with 400 records', async () => {
    const ExcelJS = require('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(require('node:path').resolve(
      __dirname,
      '..',
      'data',
      'synthetic-engagement-400.xlsx'
    ))
    const worksheet = workbook.getWorksheet('Daily Engagement')
    assert.equal(worksheet.rowCount, 401)
    assert.deepEqual(worksheet.getRow(1).values.slice(1), [
      'date',
      'platform',
      'region',
      'campaign',
      'appOpens',
      'activeUsers',
      'notificationsSent',
      'notificationsOpened'
    ])
  })

  test('large dataset runs through both modes and validates all reference metrics without API calls', async () => {
    const task = getBenchmarkTasks(['synthetic-engagement-400'])[0]
    const report = await runExperiment({
      tasks: [task],
      variantIds: ['concise'],
      runsPerVariant: 1,
      generate: async input => {
        const expected = input.task.id === task.id
          ? task.referenceMetrics
          : {}
        return {
          summary: 'Synthetic benchmark metrics.',
          claims: Object.entries(expected).map(([metric, value]) => ({ metric, value }))
        }
      }
    })

    assert.equal(report.summary.totalRequests, 2)
    assert.equal(report.summary.successfulRequests, 2)
    assert.equal(report.summary.matchingClaims, 22)
    assert.equal(report.summary.mismatchingClaims, 0)
    assert.equal(report.summary.missingMetricClaims, 0)
    assert.equal(report.results.find(result => result.mode === 'direct').input.rows.length, 400)
    assert.ok(report.results.find(result => result.mode === 'direct').prompt.length > 50000)
    assert.ok(report.results.find(result => result.mode === 'grounded').prompt.length < 5000)
  })
  assert.deepEqual(benchmarkTasks[1].referenceMetrics, {
    weighted_open_rate_percent: 43.13,
    mean_daily_open_rate_percent: 53.33
  })
  assert.deepEqual(benchmarkTasks[2].referenceMetrics, {
    enterprise_total_app_opens: 350,
    consumer_average_daily_app_opens: 106.67
  })
  assert.deepEqual(benchmarkTasks[3].referenceMetrics, {
    monthly_avg_daily_app_opens_2026_01: 110,
    monthly_avg_daily_app_opens_2026_02: 180
  })
  assert.deepEqual(benchmarkTasks[4].referenceMetrics, {
    january_revenue: 2000,
    february_revenue: 3200,
    revenue_change_percent: 60
  })
})

test('direct task prompt exposes rows but not reference metric values', () => {
  const task = getBenchmarkTasks(['weighted-notification-rate'])[0]
  const input = buildTaskInput(task, 'direct')
  const prompt = buildSummaryPrompt(input, 'formula-led', 'direct')

  assert.match(prompt, /Source rows/)
  assert.match(prompt, /weighted rate/i)
  assert.match(prompt, /Follow the metric definitions explicitly/)
  assert.doesNotMatch(prompt, /43\.13/)
  assert.doesNotMatch(prompt, /53\.33/)
})

test('grounded prompts preserve trusted metrics and use mode-appropriate strategy wording', () => {
  const task = getBenchmarkTasks(['weighted-notification-rate'])[0]
  const prompt = buildSummaryPrompt(buildTaskInput(task, 'grounded'), 'self-check', 'grounded')

  assert.match(prompt, /trusted metrics as authoritative/)
  assert.match(prompt, /43\.13/)
  assert.doesNotMatch(prompt, /Source rows/)
})

test('new prompt strategies make substantive instruction changes', () => {
  const task = getBenchmarkTasks(['month-over-month-change'])[0]
  const input = buildTaskInput(task, 'direct')
  const prompts = variants.map(variant =>
    buildSummaryPrompt(input, variant.id, 'direct')
  )

  assert.equal(new Set(prompts).size, variants.length)
  assert.match(prompts[0], /concise summary/)
  assert.match(prompts[1], /apply each formula in order/)
  assert.match(prompts[2], /independently recompute/)
})
