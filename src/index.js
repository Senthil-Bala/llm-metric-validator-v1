require('dotenv').config()

const path = require('node:path')
const { loadEngagementRows } = require('./services/workbook')
const { calculateMetrics } = require('./services/metrics')
const { createApp } = require('./app')

async function start() {
  const workbookPath = process.env.WORKBOOK_PATH
    ? path.resolve(process.env.WORKBOOK_PATH)
    : path.resolve(__dirname, '..', 'data', 'sample-engagement.xlsx')
  const rows = await loadEngagementRows(workbookPath)
  const metrics = calculateMetrics(rows)
  const port = Number(process.env.PORT || 3000)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.')
  }

  const app = createApp(metrics)
  app.listen(port, '127.0.0.1', () => {
    console.log(`MetricCheck API listening on http://localhost:${port}`)
    console.log('Loaded metrics:', metrics)
  })
}

start().catch(error => {
  console.error('MetricCheck could not start:', error.message)
  process.exitCode = 1
})
