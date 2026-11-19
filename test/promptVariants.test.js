const test = require('node:test')
const assert = require('node:assert/strict')
const { buildSummaryPrompt } = require('../src/services/promptVariants')

test('grounded prompt includes calculated values and does not request recalculation', () => {
  const prompt = buildSummaryPrompt({
    total_app_opens: 120,
    notification_open_rate_percent: 45
  }, 'executive-brief', 'grounded')

  assert.match(prompt, /pre-calculated metrics/)
  assert.match(prompt, /"total_app_opens":120/)
  assert.match(prompt, /Do not recalculate them/)
})

test('default summary prompt accepts the API metrics-only input', () => {
  const prompt = buildSummaryPrompt({
    total_app_opens: 120,
    notification_open_rate_percent: 45
  })

  assert.match(prompt, /Use the supplied trusted metrics/)
  assert.match(prompt, /"total_app_opens":120/)
  assert.match(prompt, /notification_open_rate_percent/)
})

test('direct prompt includes source rows and metric definitions but not expected values', () => {
  const prompt = buildSummaryPrompt({
    rows: [{ date: '2026-01-01', appOpens: 120, sent: 20, opened: 9 }],
    expectedMetricKeys: {
      total_app_opens: 120,
      notification_open_rate_percent: 45
    }
  }, 'analytics-review', 'direct')

  assert.match(prompt, /Calculate the requested metrics yourself/)
  assert.match(prompt, /"appOpens":120/)
  assert.match(prompt, /"total_app_opens"/)
  assert.doesNotMatch(prompt, /"notification_open_rate_percent":45/)
})

test('rejects unknown prompt variants and modes', () => {
  assert.throws(
    () => buildSummaryPrompt({}, 'unknown', 'grounded'),
    /Unknown prompt variant/
  )
  assert.throws(
    () => buildSummaryPrompt({}, 'executive-brief', 'unknown'),
    /Unknown experiment mode/
  )
})
