const variants = [
  {
    id: 'concise',
    name: 'Concise instruction',
    directInstruction: 'Calculate the requested metrics from the supplied data and return a concise summary.',
    groundedInstruction: 'Use the supplied trusted metrics to write a concise summary.'
  },
  {
    id: 'formula-led',
    name: 'Formula-led reasoning',
    directInstruction: 'Follow the metric definitions explicitly. Identify relevant rows, apply each formula in order, and check units and rounding before reporting results.',
    groundedInstruction: 'Follow the metric definitions and units when interpreting the trusted values. Preserve each supplied value and its specified rounding; do not recalculate.'
  },
  {
    id: 'self-check',
    name: 'Independent self-check',
    directInstruction: 'Solve the analytics task, then independently recompute every requested value from the rows as a check. Correct any discrepancy before responding.',
    groundedInstruction: 'Treat the trusted metrics as authoritative. Before responding, check that every claim copies the supplied metric key and value exactly; do not recalculate.'
  }
]

const legacyVariants = [
  {
    id: 'executive-brief',
    instruction: 'Prepare a concise executive-facing response to the analytics task.'
  },
  {
    id: 'analytics-review',
    instruction: 'Act as an analytics reviewer and respond to the task for a decision-maker.'
  },
  {
    id: 'leadership-update',
    instruction: 'Write a short leadership update that accurately addresses the analytics task.'
  }
]

const DEFAULT_VARIANT_IDS = variants.map(variant => variant.id)
const MODES = ['grounded', 'direct']

function getPromptVariant(variantId) {
  const variant = [...variants, ...legacyVariants].find(item => item.id === variantId)
  if (!variant) {
    throw new Error(`Unknown prompt variant "${variantId}".`)
  }
  return variant
}

function buildTaskPrompt(data, variant, mode) {
  const task = data.task || {}
  const taskContext = [
    `Task: ${task.name || task.id || 'Analytics task'}`,
    task.description || '',
    `Metric definitions: ${JSON.stringify(task.metricDefinitions || [])}`
  ].filter(Boolean)

  const outputRequirements = [
    'Return JSON only with this shape:',
    '{"summary":"...","claims":[{"metric":"exact_metric_key","value":0}]}',
    'Return exactly one claim for every requested metric key.',
    'Every numeric value in the summary must correspond to a claim with the exact metric key and value.'
  ]

  const instructions = mode === 'direct'
    ? [
        'Calculate the requested metrics from the supplied source rows and definitions.',
        `Requested metric keys: ${JSON.stringify(data.expectedMetricKeys)}`
      ]
    : [
        'Use the trusted metrics calculated by software as the source of truth.',
        'Do not recalculate, alter, or invent metric values.',
      `Trusted metrics: ${JSON.stringify(data.metrics || data)}`
      ]

  return [
    mode === 'direct' ? variant.directInstruction : variant.groundedInstruction,
    ...outputRequirements,
    ...taskContext,
    ...instructions,
    ...(mode === 'direct' ? [`Source rows: ${JSON.stringify(data.rows)}`] : [])
  ].join('\n')
}

function buildLegacyPrompt(data, variant, mode) {
  const task = mode === 'grounded'
    ? [
        'Summarize the pre-calculated metrics below. Do not recalculate them.',
        'Use only these metric keys and values. Do not invent additional values.',
        JSON.stringify(data)
      ]
    : [
        'Calculate the requested metrics yourself from the daily rows below, then write the summary.',
        'Definitions: total_app_opens is the sum of appOpens; each monthly_avg_daily_app_opens_YYYY_MM is the arithmetic mean of appOpens for rows in that month; notification_open_rate_percent is total opened divided by total sent across all rows, multiplied by 100 and rounded to two decimal places.',
        'Use only the supplied rows. Do not invent or estimate data. Return one claim for each requested metric key.',
        `Requested metric keys: ${JSON.stringify(Object.keys(data.expectedMetricKeys))}`,
        `Daily rows: ${JSON.stringify(data.rows)}`
      ]

  return [
    variant.instruction,
    'Return JSON only with this shape:',
    '{"summary":"...","claims":[{"metric":"exact_metric_key","value":0}]}',
    'For every numeric value in the summary, include a corresponding claim using the exact metric key and value.',
    ...task
  ].join('\n')
}

function buildSummaryPrompt(data, variantId = DEFAULT_VARIANT_IDS[0], mode = 'grounded') {
  const variant = getPromptVariant(variantId)
  if (!MODES.includes(mode)) {
    throw new Error(`Unknown experiment mode "${mode}".`)
  }

  return legacyVariants.includes(variant)
    ? buildLegacyPrompt(data, variant, mode)
    : buildTaskPrompt(data, variant, mode)
}

module.exports = {
  variants,
  legacyVariants,
  DEFAULT_VARIANT_IDS,
  MODES,
  getPromptVariant,
  buildSummaryPrompt
}
