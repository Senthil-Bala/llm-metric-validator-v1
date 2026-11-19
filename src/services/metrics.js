function roundToTwoDecimals(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function calculateMetrics(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('At least one engagement row is required to calculate metrics.')
  }

  let totalAppOpens = 0
  let totalNotificationsSent = 0
  let totalNotificationsOpened = 0
  const monthlyOpens = new Map()

  for (const row of rows) {
    totalAppOpens += row.appOpens
    totalNotificationsSent += row.sent
    totalNotificationsOpened += row.opened

    const month = row.date.slice(0, 7)
    const monthTotal = monthlyOpens.get(month) || { appOpens: 0, days: 0 }
    monthTotal.appOpens += row.appOpens
    monthTotal.days += 1
    monthlyOpens.set(month, monthTotal)
  }

  const metrics = {
    total_app_opens: totalAppOpens,
    notification_open_rate_percent: totalNotificationsSent === 0
      ? 0
      : roundToTwoDecimals((totalNotificationsOpened / totalNotificationsSent) * 100)
  }

  for (const [month, values] of monthlyOpens) {
    const monthKey = month.replace('-', '_')
    metrics[`monthly_avg_daily_app_opens_${monthKey}`] = roundToTwoDecimals(
      values.appOpens / values.days
    )
  }

  return metrics
}

module.exports = { calculateMetrics }
