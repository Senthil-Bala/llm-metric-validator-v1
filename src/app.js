const Koa = require('koa')
const bodyParser = require('koa-bodyparser')
const router = require('./routers/analysis')

function createApp(actualMetrics) {
  const app = new Koa()

  app.use(async (ctx, next) => {
    try {
      await next()
    } catch (error) {
      const status = error.statusCode || error.status || 500
      if ((error.statusCode || error.status || 500) >= 500) {
        console.error(JSON.stringify({
          component: 'api',
          event: 'request_failed',
          method: ctx.method,
          path: ctx.path,
          status,
          message: error.message
        }))
      }
      ctx.status = status
      ctx.body = {
        error: ctx.status < 500 || error.expose ? error.message : 'Request failed.'
      }
    }
  })

  app.use(bodyParser({ jsonLimit: '1mb' }))
  app.use(async (ctx, next) => {
    ctx.state.actualMetrics = actualMetrics
    await next()
  })
  app.use(router.routes())
  app.use(router.allowedMethods())

  return app
}

module.exports = { createApp }
