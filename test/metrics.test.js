const test = require('node:test')
const assert = require('node:assert/strict')
const { calculateMetrics } = require('../src/services/metrics')
const { validateClaims } = require('../src/services/claims')

const sampleRows = [
  { date: '2026-01-01', appOpens: 10, sent: 20, opened: 5 },
  { date: '2026-01-02', appOpens: 14, sent: 30, opened: 9 },
  { date: '2026-02-01', appOpens: 16, sent: 50, opened: 20 }
]

test('calculates totals, monthly daily averages, and weighted notification open rate', () => {
  assert.deepEqual(calculateMetrics(sampleRows), {
    total_app_opens: 40,
    notification_open_rate_percent: 34,
    monthly_avg_daily_app_opens_2026_01: 12,
    monthly_avg_daily_app_opens_2026_02: 16
  })
})

test('requires rows before calculating metrics', () => {
  assert.throws(() => calculateMetrics([]), /At least one engagement row/)
})

test('matches correct claims and flags wrong or unknown claims', () => {
  const result = validateClaims([
    { metric: 'total_app_opens', value: 40 },
    { metric: 'notification_open_rate_percent', value: 40 },
    { metric: 'made_up_metric', value: 12 }
  ], calculateMetrics(sampleRows))

  assert.deepEqual(result.summary, {
    total: 3,
    matches: 1,
    mismatches: 1,
    unknownMetrics: 1
  })
  assert.deepEqual(result.results.map(item => item.status), [
    'MATCH',
    'MISMATCH',
    'UNKNOWN_METRIC'
  ])
})

test('allows small floating-point differences within the configured tolerance', () => {
  const result = validateClaims([
    { metric: 'notification_open_rate_percent', value: 34.01 }
  ], calculateMetrics(sampleRows))

  assert.equal(result.results[0].status, 'MATCH')
})
