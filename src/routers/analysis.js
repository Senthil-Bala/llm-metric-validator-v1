const Router = require('@koa/router')
const Joi = require('joi')
const { validateClaims } = require('../services/claims')
const { generateSummary } = require('../services/llm')

const router = new Router()

const claimsBody = Joi.object({
  claims: Joi.array().items(
    Joi.object({
      metric: Joi.string().trim().min(1).required(),
      value: Joi.number().required()
    }).required()
  ).min(1).required()
}).required()

router.get('/health', async ctx => {
  ctx.body = { status: 'ok' }
})

function validateJsonBody(schema) {
  return async (ctx, next) => {
    const validation = schema.validate(ctx.request.body, { abortEarly: false })
    if (validation.error) {
      ctx.throw(400, validation.error.message)
    }

    ctx.request.body = validation.value
    await next()
  }
}

router.post('/api/validate', validateJsonBody(claimsBody), async ctx => {
  console.info(JSON.stringify({ component: 'api', event: 'claims_validation_started' }))
  ctx.body = {
    actualMetrics: ctx.state.actualMetrics,
    ...validateClaims(ctx.request.body.claims, ctx.state.actualMetrics)
  }
  console.info(JSON.stringify({ component: 'api', event: 'claims_validation_succeeded' }))
})

router.post('/api/generate-summary', async ctx => {
  console.info(JSON.stringify({ component: 'api', event: 'summary_generation_started' }))
  const generated = await generateSummary(ctx.state.actualMetrics)
  ctx.body = {
    summary: generated.summary,
    validation: validateClaims(generated.claims, ctx.state.actualMetrics)
  }
  console.info(JSON.stringify({ component: 'api', event: 'summary_generation_succeeded' }))
})

module.exports = router
