const ExcelJS = require('exceljs')

function readSheetRows(worksheet) {
  if (!worksheet) {
    throw new Error('Required worksheet is missing from the workbook.')
  }

  const headers = worksheet.getRow(1).values.slice(1).map(value => String(value).trim())
  if (headers.some(header => !header)) {
    throw new Error(`Worksheet "${worksheet.name}" has an empty column header.`)
  }

  const rows = []
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return

    const values = row.values.slice(1)
    if (values.every(value => value === null || value === undefined || value === '')) return

    const item = {}
    headers.forEach((header, index) => {
      item[header] = values[index]
    })
    rows.push({ rowNumber, item })
  })
  return rows
}

function parseDate(value, sheetName, rowNumber) {
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date in "${sheetName}" row ${rowNumber}.`)
  }
  return date.toISOString().slice(0, 10)
}

function parseCount(value, field, sheetName, rowNumber) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`"${field}" must be a non-negative integer in "${sheetName}" row ${rowNumber}.`)
  }
  return number
}

function indexRows(rows, sheetName, fields) {
  const indexed = new Map()
  for (const { rowNumber, item } of rows) {
    const date = parseDate(item.date, sheetName, rowNumber)
    if (indexed.has(date)) {
      throw new Error(`Duplicate date ${date} in "${sheetName}".`)
    }

    const values = {}
    for (const [field, column] of Object.entries(fields)) {
      values[field] = parseCount(item[column], column, sheetName, rowNumber)
    }
    indexed.set(date, values)
  }
  return indexed
}

async function loadEngagementRows(workbookPath) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(workbookPath)

  const engagement = indexRows(
    readSheetRows(workbook.getWorksheet('Daily Engagement')),
    'Daily Engagement',
    { appOpens: 'app_opens', activeUsers: 'active_users' }
  )
  const notifications = indexRows(
    readSheetRows(workbook.getWorksheet('Push Notifications')),
    'Push Notifications',
    { sent: 'notifications_sent', opened: 'notifications_opened' }
  )

  if (engagement.size === 0 || engagement.size !== notifications.size) {
    throw new Error('Daily Engagement and Push Notifications must contain matching date rows.')
  }

  const rows = []
  for (const [date, engagementValues] of engagement) {
    const notificationValues = notifications.get(date)
    if (!notificationValues) {
      throw new Error(`No notification row found for ${date}.`)
    }
    if (notificationValues.opened > notificationValues.sent) {
      throw new Error(`Notifications opened exceed notifications sent for ${date}.`)
    }

    rows.push({ date, ...engagementValues, ...notificationValues })
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

module.exports = { loadEngagementRows }
