const Joi = require('joi')
const { buildSummaryPrompt } = require('./promptVariants')

const responseSchema = Joi.object({
  summary: Joi.string().min(1).required(),
  claims: Joi.array().items(
    Joi.object({
      metric: Joi.string().min(1).required(),
      value: Joi.number().required()
    }).required()
  ).min(1).required()
}).required()

const maxAttempts = 3
const defaultRequestTimeoutMs = 20000
const maxRequestTimeoutMs = 120000
const maxRetryDelayMs = 2000
const retryableStatuses = new Set([408, 429, 500, 502, 503, 504])

const providers = {
  gemini: {
    apiKeyEnv: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    buildRequest(apiKey, model, prompt, temperature) {
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        options: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              ...(temperature === undefined ? {} : { temperature })
            }
          })
        }
      }
    },
    getText(responseBody) {
      return responseBody.candidates?.[0]?.content?.parts
        ?.map(part => part.text || '')
        .join('')
    }
  },
  deepseek: {
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    modelEnv: 'DEEPSEEK_MODEL',
    buildRequest(apiKey, model, prompt, temperature, thinkingMode) {
      return {
        url: 'https://api.deepseek.com/chat/completions',
        options: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            ...(temperature === undefined ? {} : { temperature }),
            ...(thinkingMode === undefined ? {} : { thinking: { type: thinkingMode } })
          })
        }
      }
    },
    getText(responseBody) {
      return responseBody.choices?.[0]?.message?.content
    }
  }
}

function log(provider, event, details = {}) {
  console.info(JSON.stringify({ component: 'llm', provider, event, ...details }))
}

function retryDelay(response, attempt) {
  const retryAfter = response.headers?.get('retry-after')
  if (retryAfter) {
    const retryAfterSeconds = Number(retryAfter)
    const retryAfterDate = Date.parse(retryAfter)
    const delay = Number.isFinite(retryAfterSeconds)
      ? retryAfterSeconds * 1000
      : Number.isNaN(retryAfterDate)
        ? null
        : retryAfterDate - Date.now()
    if (delay !== null && delay >= 0) {
      return Math.min(delay, maxRetryDelayMs)
    }
  }

  return Math.min(250 * (2 ** (attempt - 1)), maxRetryDelayMs)
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function generateSummary(data, promptVariantId, mode = 'grounded') {
  const providerName = process.env.LLM_PROVIDER || 'gemini'
  const provider = providers[providerName]
  if (!provider) {
    const error = new Error('LLM_PROVIDER must be either "gemini" or "deepseek".')
    error.statusCode = 503
    error.expose = true
    log(providerName, 'configuration_invalid')
    throw error
  }

  const apiKey = process.env[provider.apiKeyEnv]
  const model = process.env[provider.modelEnv]
  if (!apiKey || !model) {
    const error = new Error(`Set ${provider.apiKeyEnv} and ${provider.modelEnv} to enable ${providerName} summary generation.`)
    error.statusCode = 503
    error.expose = true
    log(providerName, 'configuration_missing')
    throw error
  }

  const temperature = process.env.LLM_TEMPERATURE === undefined || process.env.LLM_TEMPERATURE === ''
    ? undefined
    : Number(process.env.LLM_TEMPERATURE)
  if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
    const error = new Error('LLM_TEMPERATURE must be a number between 0 and 2.')
    error.statusCode = 503
    error.expose = true
    log(providerName, 'configuration_invalid')
    throw error
  }

  const thinkingMode = providerName === 'deepseek'
    ? process.env.DEEPSEEK_THINKING_MODE
    : undefined
  if (thinkingMode !== undefined && !['enabled', 'disabled'].includes(thinkingMode)) {
    const error = new Error('DEEPSEEK_THINKING_MODE must be either "enabled" or "disabled".')
    error.statusCode = 503
    error.expose = true
    log(providerName, 'configuration_invalid')
    throw error
  }

  const configuredTimeout = process.env.LLM_REQUEST_TIMEOUT_MS
  const requestTimeoutMs = configuredTimeout === undefined || configuredTimeout === ''
    ? defaultRequestTimeoutMs
    : Number(configuredTimeout)
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > maxRequestTimeoutMs) {
    const error = new Error(`LLM_REQUEST_TIMEOUT_MS must be an integer between 1000 and ${maxRequestTimeoutMs}.`)
    error.statusCode = 503
    error.expose = true
    log(providerName, 'configuration_invalid')
    throw error
  }

  log(providerName, 'request_started', { maxAttempts, timeoutMs: requestTimeoutMs })

  const prompt = buildSummaryPrompt(data, promptVariantId, mode)

  const { url, options } = provider.buildRequest(apiKey, model, prompt, temperature, thinkingMode)
  let response
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now()
    log(providerName, 'attempt_started', { attempt })

    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(requestTimeoutMs)
      })
    } catch (fetchError) {
      log(providerName, 'attempt_failed', {
        attempt,
        durationMs: Date.now() - startedAt,
        reason: fetchError.name || 'NetworkError'
      })

      if (fetchError.name === 'TimeoutError') {
        const error = new Error(
          `${providerName} did not respond within ${requestTimeoutMs / 1000} seconds. Check network connectivity and provider API availability.`
        )
        error.statusCode = 504
        error.expose = true
        throw error
      }

      if (attempt === maxAttempts) {
        const error = new Error(`${providerName} request failed after multiple attempts.`)
        error.statusCode = 502
        throw error
      }

      const delayMs = Math.min(250 * (2 ** (attempt - 1)), maxRetryDelayMs)
      log(providerName, 'retry_scheduled', { attempt, delayMs })
      await wait(delayMs)
      continue
    }

    log(providerName, 'response_received', {
      attempt,
      status: response.status,
      durationMs: Date.now() - startedAt
    })

    if (response.ok) {
      break
    }

    const responseBody = await response.json().catch(() => null)
    if (!retryableStatuses.has(response.status) || attempt === maxAttempts) {
      const error = new Error(
        responseBody?.error?.message || `${providerName} API returned HTTP ${response.status}.`
      )
      error.statusCode = response.status === 429 || retryableStatuses.has(response.status)
        ? 503
        : 502
      throw error
    }

    const delayMs = retryDelay(response, attempt)
    log(providerName, 'retry_scheduled', { attempt, delayMs, status: response.status })
    await wait(delayMs)
  }

  let responseBody
  let responseText
  try {
    responseText = await response.text()
  } catch (bodyError) {
    const isTimeout = bodyError.name === 'TimeoutError' ||
      bodyError.name === 'AbortError' ||
      /timeout|timed out|aborted/i.test(bodyError.message)
    const error = new Error(isTimeout
      ? `${providerName} response body exceeded the ${requestTimeoutMs / 1000}-second request timeout.`
      : `${providerName} response body could not be read.`)
    error.statusCode = isTimeout ? 504 : 502
    error.expose = isTimeout
    log(providerName, 'response_body_failed', {
      reason: isTimeout ? 'timeout' : bodyError.name || 'read_error'
    })
    throw error
  }
  try {
    responseBody = JSON.parse(responseText)
  } catch (parseError) {
    const contentType = response.headers.get('content-type') || 'unknown'
    const error = new Error(
      `${providerName} returned an unreadable response body (content-type: ${contentType}, bytes: ${Buffer.byteLength(responseText)}).`
    )
    error.statusCode = 502
    log(providerName, 'response_invalid', {
      reason: 'invalid_response_body',
      contentType,
      bodyBytes: Buffer.byteLength(responseText),
      parseError: parseError.name
    })
    throw error
  }

  const text = provider.getText(responseBody)
  if (!text) {
    const error = new Error(`${providerName} returned no summary text.`)
    error.statusCode = 502
    log(providerName, 'response_invalid', { reason: 'empty_summary' })
    throw error
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    const parseError = new Error(`${providerName} response was not valid JSON.`)
    parseError.statusCode = 502
    log(providerName, 'response_invalid', { reason: 'invalid_json' })
    throw parseError
  }

  const validation = responseSchema.validate(parsed, { abortEarly: false })
  if (validation.error) {
    const error = new Error(`${providerName} response did not match the expected structure: ${validation.error.message}`)
    error.statusCode = 502
    log(providerName, 'response_invalid', { reason: 'schema_validation' })
    throw error
  }

  log(providerName, 'request_succeeded')
  return validation.value
}

module.exports = { generateSummary }
