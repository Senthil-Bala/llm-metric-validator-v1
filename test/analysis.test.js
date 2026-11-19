const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { createApp } = require('../src/app')

const actualMetrics = {
  total_app_opens: 40,
  notification_open_rate_percent: 34
}

test('summary endpoint returns generated text and claim validation separately', async t => {
  const environmentNames = [
    'LLM_PROVIDER',
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_MODEL'
  ]
  const previousEnvironment = Object.fromEntries(
    environmentNames.map(name => [name, process.env[name]])
  )
  process.env.LLM_PROVIDER = 'deepseek'
  process.env.DEEPSEEK_API_KEY = 'test-key'
  process.env.DEEPSEEK_MODEL = 'test-model'
  t.after(() => {
    for (const name of environmentNames) {
      if (previousEnvironment[name] === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = previousEnvironment[name]
      }
    }
  })

  const generatedSummary = 'There were 40 app opens and a 34% notification open rate.'
  t.mock.method(console, 'info', () => {})
  t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          summary: generatedSummary,
          claims: [
            { metric: 'total_app_opens', value: 40 },
            { metric: 'notification_open_rate_percent', value: 34 }
          ]
        })
      }
    }]
  }), { status: 200 }))

  const server = await new Promise(resolve => {
    const listeningServer = createApp(actualMetrics).listen(0, '127.0.0.1')
    listeningServer.once('listening', () => resolve(listeningServer))
  })
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  }))

  const response = await new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: '/api/generate-summary',
      method: 'POST'
    }, incoming => {
      let body = ''
      incoming.setEncoding('utf8')
      incoming.on('data', chunk => { body += chunk })
      incoming.on('end', () => resolve({
        statusCode: incoming.statusCode,
        body: JSON.parse(body)
      }))
    })
    request.on('error', reject)
    request.end()
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.summary, generatedSummary)
  assert.deepEqual(response.body.validation.summary, {
    total: 2,
    matches: 2,
    mismatches: 0,
    unknownMetrics: 0
  })
  assert.deepEqual(response.body.validation.results.map(result => result.status), [
    'MATCH',
    'MATCH'
  ])
})
