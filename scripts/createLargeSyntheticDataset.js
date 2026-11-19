const fs = require('node:fs/promises')
const path = require('node:path')
const ExcelJS = require('exceljs')

const dataDirectory = path.resolve(__dirname, '..', 'data')
const platforms = ['Android', 'iOS', 'Web', 'Other']
const regions = ['North', 'South', 'East', 'West', 'Central']
const campaigns = ['organic', 'paid-search', 'social', 'email']

function createRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function dateForDay(dayIndex) {
  const date = new Date(Date.UTC(2026, 0, 1 + dayIndex))
  return date.toISOString().slice(0, 10)
}

function buildDataset(seed = 20261119) {
  const random = createRandom(seed)
  const rows = []

  for (let dayIndex = 0; dayIndex < 100; dayIndex += 1) {
    for (let platformIndex = 0; platformIndex < platforms.length; platformIndex += 1) {
      const sent = dayIndex * platforms.length + platformIndex === 67
        ? 0
        : Math.floor(random() * 450) + 50
      const openRate = 0.12 + random() * 0.46
      const opened = Math.floor(sent * openRate)
      const appOpens = 250 + Math.floor(random() * 1400)

      rows.push({
        date: dateForDay(dayIndex),
        platform: platforms[platformIndex],
        region: regions[(dayIndex + platformIndex * 2) % regions.length],
        campaign: campaigns[(dayIndex * 3 + platformIndex) % campaigns.length],
        appOpens,
        activeUsers: 50 + Math.floor(random() * (Math.min(800, appOpens) - 49)),
        notificationsSent: sent,
        notificationsOpened: opened
      })
    }
  }

  return {
    datasetId: 'synthetic-engagement-400-v1',
    description: 'Deterministic synthetic engagement data for MetricCheck; 100 days x 4 platforms.',
    seed,
    rowCount: rows.length,
    rows
  }
}

async function main() {
  const dataset = buildDataset()
  const jsonPath = path.join(dataDirectory, 'synthetic-engagement-400.json')
  const csvPath = path.join(dataDirectory, 'synthetic-engagement-400.csv')
  const workbookPath = path.join(dataDirectory, 'synthetic-engagement-400.xlsx')
  const headers = Object.keys(dataset.rows[0])
  const csv = [
    headers.join(','),
    ...dataset.rows.map(row => headers.map(header => JSON.stringify(row[header])).join(','))
  ].join('\n') + '\n'

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'MetricCheck'
  workbook.subject = 'Deterministic synthetic engagement data'
  const worksheet = workbook.addWorksheet('Daily Engagement')
  worksheet.columns = [
    { header: 'date', key: 'date', width: 14 },
    { header: 'platform', key: 'platform', width: 14 },
    { header: 'region', key: 'region', width: 14 },
    { header: 'campaign', key: 'campaign', width: 18 },
    { header: 'appOpens', key: 'appOpens', width: 14 },
    { header: 'activeUsers', key: 'activeUsers', width: 14 },
    { header: 'notificationsSent', key: 'notificationsSent', width: 20 },
    { header: 'notificationsOpened', key: 'notificationsOpened', width: 22 }
  ]
  worksheet.addRows(dataset.rows)
  worksheet.getRow(1).font = { bold: true }
  worksheet.autoFilter = { from: 'A1', to: 'H1' }
  worksheet.views = [{ state: 'frozen', ySplit: 1 }]

  await fs.mkdir(dataDirectory, { recursive: true })
  await Promise.all([
    fs.writeFile(jsonPath, `${JSON.stringify(dataset, null, 2)}\n`),
    fs.writeFile(csvPath, csv),
    workbook.xlsx.writeFile(workbookPath)
  ])
  console.log(`Created ${dataset.rowCount} synthetic rows in JSON, CSV, and Excel formats:`)
  console.log(`- ${jsonPath}`)
  console.log(`- ${csvPath}`)
  console.log(`- ${workbookPath}`)
}

module.exports = { buildDataset }

if (require.main === module) {
  main().catch(error => {
    console.error(`Could not create synthetic engagement data: ${error.message}`)
    process.exitCode = 1
  })
}
