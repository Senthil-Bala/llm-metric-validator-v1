const ExcelJS = require('exceljs')
const fs = require('node:fs/promises')
const path = require('node:path')

const rootPath = path.resolve(__dirname, '..')
const sourcePath = path.join(rootPath, 'data', 'sample-engagement.json')
const workbookPath = path.join(rootPath, 'data', 'sample-engagement.xlsx')

async function createSampleWorkbook() {
  const sampleData = JSON.parse(await fs.readFile(sourcePath, 'utf8'))
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'MetricCheck'
  workbook.subject = 'Synthetic engagement data for local testing'

  const engagementSheet = workbook.addWorksheet('Daily Engagement')
  engagementSheet.columns = [
    { header: 'date', key: 'date', width: 16 },
    { header: 'app_opens', key: 'appOpens', width: 16 },
    { header: 'active_users', key: 'activeUsers', width: 16 }
  ]
  engagementSheet.addRows(sampleData.dailyEngagement)

  const notificationSheet = workbook.addWorksheet('Push Notifications')
  notificationSheet.columns = [
    { header: 'date', key: 'date', width: 16 },
    { header: 'notifications_sent', key: 'sent', width: 24 },
    { header: 'notifications_opened', key: 'opened', width: 26 }
  ]
  notificationSheet.addRows(sampleData.notifications)

  const monthlySheet = workbook.addWorksheet('Monthly Overview')
  monthlySheet.addRows([
    ['month', 'average_daily_app_opens'],
    ['Calculated by MetricCheck', 'This sheet is illustrative; the API recalculates metrics from daily rows.']
  ])
  monthlySheet.getColumn(1).width = 28
  monthlySheet.getColumn(2).width = 72

  await workbook.xlsx.writeFile(workbookPath)
  console.log(`Created synthetic workbook: ${workbookPath}`)
}

createSampleWorkbook().catch(error => {
  console.error('Could not create the sample workbook:', error.message)
  process.exitCode = 1
})
