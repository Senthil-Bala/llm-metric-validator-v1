function roundToTwoDecimals(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + row[field], 0)
}

function average(values) {
  return values.length === 0
    ? 0
    : roundToTwoDecimals(values.reduce((total, value) => total + value, 0) / values.length)
}

function addLargeSyntheticEngagementTask() {
  const dataset = require('../../data/synthetic-engagement-400.json')
  const rows = dataset.rows

  tasks.push({
    id: 'synthetic-engagement-400',
    name: '400-row multi-dimensional engagement analysis',
    category: 'large-multi-step',
    description: 'Analyze 400 synthetic daily-by-platform records from January 1 through April 10, 2026. Calculate totals across all rows, daily averages after combining platforms by date, weighted notification rates, platform and campaign filtered totals, monthly totals, and month-to-month change.',
    metricDefinitions: [
      'total_app_opens is the sum of appOpens across all records.',
      'average_daily_app_opens is calculated by first summing appOpens across all platforms for each date, then taking the arithmetic mean across the 100 dates, rounded to two decimal places.',
      'weighted_notification_open_rate_percent is total notificationsOpened divided by total notificationsSent across all records, multiplied by 100 and rounded to two decimal places. Do not average row-level percentages.',
      'android_app_opens is the sum of appOpens for rows where platform is Android.',
      'north_region_app_opens is the sum of appOpens for rows where region is North.',
      'social_campaign_app_opens is the sum of appOpens for rows where campaign is social.',
      'monthly_app_opens_2026_01, monthly_app_opens_2026_02, monthly_app_opens_2026_03, and monthly_app_opens_2026_04 are sums of appOpens for rows in each named calendar month.',
      'january_to_april_app_opens_change_percent is (April app opens total minus January app opens total) divided by January app opens total, multiplied by 100 and rounded to two decimal places.'
    ],
    rows,
    defaultSelected: false,
    datasetId: dataset.datasetId,
    calculateReference(inputRows) {
      const byDate = new Map()
      const byMonth = new Map()
      let totalNotificationsSent = 0
      let totalNotificationsOpened = 0
      let androidAppOpens = 0
      let northRegionAppOpens = 0
      let socialCampaignAppOpens = 0

      for (const row of inputRows) {
        byDate.set(row.date, (byDate.get(row.date) || 0) + row.appOpens)
        const month = row.date.slice(0, 7)
        byMonth.set(month, (byMonth.get(month) || 0) + row.appOpens)
        totalNotificationsSent += row.notificationsSent
        totalNotificationsOpened += row.notificationsOpened
        if (row.platform === 'Android') androidAppOpens += row.appOpens
        if (row.region === 'North') northRegionAppOpens += row.appOpens
        if (row.campaign === 'social') socialCampaignAppOpens += row.appOpens
      }

      const januaryAppOpens = byMonth.get('2026-01') || 0
      const aprilAppOpens = byMonth.get('2026-04') || 0
      return {
        total_app_opens: sum(inputRows, 'appOpens'),
        average_daily_app_opens: average([...byDate.values()]),
        weighted_notification_open_rate_percent: totalNotificationsSent === 0
          ? 0
          : roundToTwoDecimals((totalNotificationsOpened / totalNotificationsSent) * 100),
        android_app_opens: androidAppOpens,
        north_region_app_opens: northRegionAppOpens,
        social_campaign_app_opens: socialCampaignAppOpens,
        monthly_app_opens_2026_01: januaryAppOpens,
        monthly_app_opens_2026_02: byMonth.get('2026-02') || 0,
        monthly_app_opens_2026_03: byMonth.get('2026-03') || 0,
        monthly_app_opens_2026_04: aprilAppOpens,
        january_to_april_app_opens_change_percent: januaryAppOpens === 0
          ? 0
          : roundToTwoDecimals(((aprilAppOpens - januaryAppOpens) / januaryAppOpens) * 100)
      }
    }
  })
}

const tasks = [
  {
    id: 'simple-total-average',
    name: 'Simple total and average',
    category: 'baseline',
    description: 'Calculate the total and arithmetic mean of app opens across all supplied daily rows.',
    metricDefinitions: [
      'total_app_opens is the sum of appOpens for all rows.',
      'average_daily_app_opens is the arithmetic mean of appOpens across all rows, rounded to two decimal places.'
    ],
    rows: [
      { date: '2026-01-03', appOpens: 101 },
      { date: '2026-01-04', appOpens: 123 },
      { date: '2026-01-05', appOpens: 98 },
      { date: '2026-01-06', appOpens: 144 },
      { date: '2026-01-07', appOpens: 156 },
      { date: '2026-01-08', appOpens: 178 }
    ],
    calculateReference(rows) {
      return {
        total_app_opens: sum(rows, 'appOpens'),
        average_daily_app_opens: average(rows.map(row => row.appOpens))
      }
    }
  },
  {
    id: 'weighted-notification-rate',
    name: 'Weighted rate versus average of rates',
    category: 'aggregation',
    description: 'Calculate both the overall weighted notification open rate and the arithmetic mean of daily open rates. They are different metrics and must not be confused.',
    metricDefinitions: [
      'weighted_open_rate_percent is sum(opened) divided by sum(sent), multiplied by 100, rounded to two decimal places.',
      'mean_daily_open_rate_percent is the arithmetic mean of each row opened/sent percentage, rounded to two decimal places.'
    ],
    rows: [
      { date: '2026-02-01', sent: 100, opened: 50 },
      { date: '2026-02-02', sent: 10, opened: 9 },
      { date: '2026-02-03', sent: 50, opened: 10 }
    ],
    calculateReference(rows) {
      const totalSent = sum(rows, 'sent')
      const dailyRates = rows.map(row => row.sent === 0 ? 0 : (row.opened / row.sent) * 100)
      return {
        weighted_open_rate_percent: totalSent === 0
          ? 0
          : roundToTwoDecimals((sum(rows, 'opened') / totalSent) * 100),
        mean_daily_open_rate_percent: average(dailyRates)
      }
    }
  },
  {
    id: 'segment-filter',
    name: 'Segment filter and average',
    category: 'filtering',
    description: 'Use only rows whose segment is enterprise to calculate its total app opens. Separately calculate the average daily app opens for consumer rows.',
    metricDefinitions: [
      'enterprise_total_app_opens is the sum of appOpens where segment equals enterprise.',
      'consumer_average_daily_app_opens is the arithmetic mean of appOpens where segment equals consumer, rounded to two decimal places.'
    ],
    rows: [
      { date: '2026-03-01', segment: 'enterprise', appOpens: 100 },
      { date: '2026-03-01', segment: 'consumer', appOpens: 90 },
      { date: '2026-03-02', segment: 'enterprise', appOpens: 200 },
      { date: '2026-03-02', segment: 'consumer', appOpens: 120 },
      { date: '2026-03-03', segment: 'enterprise', appOpens: 50 },
      { date: '2026-03-03', segment: 'consumer', appOpens: 110 }
    ],
    calculateReference(rows) {
      const enterpriseRows = rows.filter(row => row.segment === 'enterprise')
      const consumerRows = rows.filter(row => row.segment === 'consumer')
      return {
        enterprise_total_app_opens: sum(enterpriseRows, 'appOpens'),
        consumer_average_daily_app_opens: average(consumerRows.map(row => row.appOpens))
      }
    }
  },
  {
    id: 'monthly-grouping',
    name: 'Monthly grouping and averages',
    category: 'grouping',
    description: 'Group rows by calendar month and calculate the average daily app opens for each month represented.',
    metricDefinitions: [
      'monthly_avg_daily_app_opens_2026_01 is the arithmetic mean of appOpens for January 2026 rows present.',
      'monthly_avg_daily_app_opens_2026_02 is the arithmetic mean of appOpens for February 2026 rows present.',
      'Use only observed rows; do not divide by the number of calendar days in the month. Round to two decimal places.'
    ],
    rows: [
      { date: '2026-01-29', appOpens: 100 },
      { date: '2026-01-30', appOpens: 120 },
      { date: '2026-02-01', appOpens: 150 },
      { date: '2026-02-02', appOpens: 180 },
      { date: '2026-02-03', appOpens: 210 }
    ],
    calculateReference(rows) {
      const byMonth = new Map()
      for (const row of rows) {
        const month = row.date.slice(0, 7)
        const values = byMonth.get(month) || []
        values.push(row.appOpens)
        byMonth.set(month, values)
      }
      return Object.fromEntries([...byMonth].map(([month, values]) => [
        `monthly_avg_daily_app_opens_${month.replace('-', '_')}`,
        average(values)
      ]))
    }
  },
  {
    id: 'month-over-month-change',
    name: 'Month-over-month percentage change',
    category: 'multi-step',
    description: 'Sum revenue by month, then calculate the percentage change from January to February 2026 relative to January.',
    metricDefinitions: [
      'january_revenue is the sum of revenue for January 2026 rows.',
      'february_revenue is the sum of revenue for February 2026 rows.',
      'revenue_change_percent is (February total minus January total) divided by January total, multiplied by 100, rounded to two decimal places.'
    ],
    rows: [
      { date: '2026-01-10', revenue: 1200 },
      { date: '2026-01-20', revenue: 800 },
      { date: '2026-02-05', revenue: 1500 },
      { date: '2026-02-15', revenue: 1700 }
    ],
    calculateReference(rows) {
      const januaryRows = rows.filter(row => row.date.startsWith('2026-01'))
      const februaryRows = rows.filter(row => row.date.startsWith('2026-02'))
      const januaryRevenue = sum(januaryRows, 'revenue')
      const februaryRevenue = sum(februaryRows, 'revenue')
      return {
        january_revenue: januaryRevenue,
        february_revenue: februaryRevenue,
        revenue_change_percent: januaryRevenue === 0
          ? 0
          : roundToTwoDecimals(((februaryRevenue - januaryRevenue) / januaryRevenue) * 100)
      }
    }
  }
]

addLargeSyntheticEngagementTask()

const DEFAULT_TASK_IDS = tasks
  .filter(task => task.defaultSelected !== false)
  .map(task => task.id)

function getBenchmarkTasks(taskIds = DEFAULT_TASK_IDS) {
  return taskIds.map(taskId => {
    const task = tasks.find(candidate => candidate.id === taskId)
    if (!task) {
      throw new Error(`Unknown benchmark task "${taskId}". Available tasks: ${tasks.map(item => item.id).join(', ')}`)
    }
    return {
      id: task.id,
      name: task.name,
      category: task.category,
      description: task.description,
      metricDefinitions: [...task.metricDefinitions],
      rows: task.rows.map(row => ({ ...row })),
      defaultSelected: task.defaultSelected !== false,
      datasetId: task.datasetId || null,
      referenceMetrics: task.calculateReference(task.rows)
    }
  })
}

module.exports = { tasks, DEFAULT_TASK_IDS, getBenchmarkTasks }
