const test = require('node:test')
const assert = require('node:assert/strict')
const { generateSummary } = require('../src/services/llm')

const metrics = { total_app_opens: 40 }

function configureProvider(t, provider) {
  const names = [
    'LLM_PROVIDER',
    'LLM_TEMPERATURE',
    'LLM_REQUEST_TIMEOUT_MS',
    'DEEPSEEK_THINKING_MODE',
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_MODEL'
  ]
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  for (const name of names) {
    delete process.env[name]
  }
  process.env.LLM_PROVIDER = provider
  process.env[`${provider.toUpperCase()}_API_KEY`] = 'test-key'
  process.env[`${provider.toUpperCase()}_MODEL`] = 'test-model'
  t.after(() => {
    for (const name of names) {
      if (previous[name] === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = previous[name]
      }
    }
  })
  t.mock.method(console, 'info', () => {})
}

function configureGemini(t) {
  configureProvider(t, 'gemini')
}

function configureDeepseek(t) {
  configureProvider(t, 'deepseek')
}

function successfulResponse(summary = 'There were 40 app opens.') {
  return new Response(JSON.stringify({
    candidates: [{
      content: {
        parts: [{
          text: JSON.stringify({
            summary,
            claims: [{ metric: 'total_app_opens', value: 40 }]
          })
        }]
      }
    }]
  }), { status: 200 })
}

function successfulDeepseekResponse(summary = 'There were 40 app opens.') {
  return new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          summary,
          claims: [{ metric: 'total_app_opens', value: 40 }]
        })
      }
    }]
  }), { status: 200 })
}

test('sends DeepSeek chat completion requests and parses the structured response', async t => {
  configureDeepseek(t)
  process.env.LLM_TEMPERATURE = '0'
  let requestUrl
  let requestOptions
  t.mock.method(global, 'fetch', async (url, options) => {
    requestUrl = url
    requestOptions = options
    return successfulDeepseekResponse()
  })

  const result = await generateSummary(metrics)
  const requestBody = JSON.parse(requestOptions.body)

  assert.equal(requestUrl, 'https://api.deepseek.com/chat/completions')
  assert.equal(requestOptions.headers.authorization, 'Bearer test-key')
  assert.equal(requestBody.model, 'test-model')
  assert.equal(requestBody.temperature, 0)
  assert.deepEqual(requestBody.response_format, { type: 'json_object' })
  assert.equal(result.summary, 'There were 40 app opens.')
  assert.deepEqual(result.claims, [{ metric: 'total_app_opens', value: 40 }])
})

test('rejects an invalid configured temperature before making a provider request', async t => {
  configureGemini(t)
  process.env.LLM_TEMPERATURE = '2.1'
  let attempts = 0
  t.mock.method(global, 'fetch', async () => {
    attempts += 1
    return successfulResponse()
  })

  await assert.rejects(generateSummary(metrics), /LLM_TEMPERATURE must be a number between 0 and 2/)
  assert.equal(attempts, 0)
})

test('passes an explicitly configured DeepSeek thinking mode', async t => {
  configureDeepseek(t)
  process.env.DEEPSEEK_THINKING_MODE = 'disabled'
  let requestOptions
  t.mock.method(global, 'fetch', async (url, options) => {
    requestOptions = options
    return successfulDeepseekResponse()
  })

  await generateSummary(metrics)
  assert.deepEqual(JSON.parse(requestOptions.body).thinking, { type: 'disabled' })
})

test('rejects invalid DeepSeek thinking mode before making a provider request', async t => {
  configureDeepseek(t)
  process.env.DEEPSEEK_THINKING_MODE = 'off'
  let attempts = 0
  t.mock.method(global, 'fetch', async () => {
    attempts += 1
    return successfulDeepseekResponse()
  })

  await assert.rejects(generateSummary(metrics), /DEEPSEEK_THINKING_MODE must be either/)
  assert.equal(attempts, 0)
})

test('reports content type and size when provider returns malformed JSON', async t => {
  configureDeepseek(t)
  t.mock.method(global, 'fetch', async () => new Response('<html>bad gateway</html>', {
    status: 200,
    headers: { 'content-type': 'text/html' }
  }))

  await assert.rejects(generateSummary(metrics), error => {
    assert.equal(error.statusCode, 502)
    assert.match(error.message, /content-type: text\/html/)
    assert.match(error.message, /bytes: 24/)
    return true
  })
})

test('retries Gemini overload and returns a valid summary', async t => {
  configureGemini(t)
  let attempts = 0
  t.mock.method(global, 'fetch', async () => {
    attempts += 1
    if (attempts === 1) {
      return new Response(JSON.stringify({ error: { message: 'busy' } }), {
        status: 429,
        headers: { 'retry-after': '0' }
      })
    }
    return successfulResponse()
  })

  const result = await generateSummary(metrics)

  assert.equal(attempts, 2)
  assert.deepEqual(result, {
    summary: 'There were 40 app opens.',
    claims: [{ metric: 'total_app_opens', value: 40 }]
  })
})

test('retries a transient network failure', async t => {
  configureGemini(t)
  let attempts = 0
  t.mock.method(global, 'fetch', async () => {
    attempts += 1
    if (attempts === 1) {
      throw new Error('temporary network failure')
    }
    return successfulResponse()
  })

  const result = await generateSummary(metrics)

  assert.equal(attempts, 2)
  assert.equal(result.summary, 'There were 40 app opens.')
})

test('reports request timeouts as 504 without retrying', async t => {
  configureGemini(t)
  let attempts = 0
  t.mock.method(global, 'fetch', async () => {
    attempts += 1
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  await assert.rejects(generateSummary(metrics), error => {
    assert.equal(error.statusCode, 504)
    assert.equal(error.expose, true)
    assert.match(error.message, /did not respond within 20 seconds/)
    return true
  })
  assert.equal(attempts, 1)
})

test('returns 503 after exhausting retries for an overloaded model', async t => {
  configureGemini(t)
  let attempts = 0
  t.mock.method(global, 'fetch', async () => {
    attempts += 1
    return new Response(JSON.stringify({ error: { message: 'model is busy' } }), {
      status: 503,
      headers: { 'retry-after': '0' }
    })
  })

  await assert.rejects(generateSummary(metrics), error => {
    assert.equal(error.statusCode, 503)
    assert.match(error.message, /model is busy/)
    return true
  })
  assert.equal(attempts, 3)
})

test('does not retry non-transient Gemini errors', async t => {
  configureGemini(t)
  let attempts = 0
  t.mock.method(global, 'fetch', async () => {
    attempts += 1
    return new Response(JSON.stringify({ error: { message: 'invalid model' } }), {
      status: 400
    })
  })

  await assert.rejects(generateSummary(metrics), error => {
    assert.equal(error.statusCode, 502)
    assert.match(error.message, /invalid model/)
    return true
  })
  assert.equal(attempts, 1)
})
