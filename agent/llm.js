/**
 * LLM Provider Abstraction
 * 
 * Unified interface for multiple LLM providers:
 * - Anthropic (Claude)
 * - OpenAI (GPT-4)
 * - Google Gemini
 * - AWS Bedrock
 */

require('dotenv').config();

// Provider configurations (Updated Feb 2025)
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      'claude-opus-4-6-20250205',      // Latest flagship, 1M context
      'claude-opus-4-5-20250929',      // Previous flagship
      'claude-sonnet-4-20250514',      // Balanced performance/cost
      'claude-3-5-haiku-20241022',     // Fast, cost-effective
    ],
  },
  openai: {
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    models: [
      'gpt-5',                         // Latest flagship
      'gpt-4.1',                       // Improved GPT-4
      'gpt-4.1-mini',                  // Cost-effective
      'gpt-4o',                        // Multimodal
      'o3',                            // Reasoning, advanced
      'o4-mini',                       // Reasoning, fast
    ],
  },
  gemini: {
    name: 'Google Gemini',
    envKey: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.5-pro',
    models: [
      'gemini-2.5-pro',                // Latest flagship
      'gemini-2.5-flash',              // Fast, cost-effective
      'gemini-2.0-flash',              // Stable
      'gemini-2.0-flash-lite',         // Fastest, cheapest
    ],
  },
  bedrock: {
    name: 'AWS Bedrock',
    envKeys: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    defaultModel: 'global.anthropic.claude-opus-4-6-v1',
    models: [
      'global.anthropic.claude-opus-4-6-v1',            // Claude Opus 4.6 (latest)
      'us.anthropic.claude-opus-4-20250514-v1:0',       // Claude Opus 4
      'us.anthropic.claude-3-5-sonnet-20241022-v2:0',   // Claude 3.5 Sonnet v2
      'us.anthropic.claude-3-5-haiku-20241022-v1:0',    // Claude 3.5 Haiku
    ],
  },
};

/**
 * Get current configuration
 */
function getConfig() {
  const provider = process.env.LLM_PROVIDER || 'bedrock';
  const providerConfig = PROVIDERS[provider];
  
  if (!providerConfig) {
    throw new Error(`Unknown provider: ${provider}. Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  const model = process.env.LLM_MODEL || providerConfig.defaultModel;

  return {
    provider,
    providerName: providerConfig.name,
    model,
    availableModels: providerConfig.models,
  };
}

/**
 * Validate credentials are set
 */
function validateCredentials() {
  const config = getConfig();
  const providerConfig = PROVIDERS[config.provider];

  if (config.provider === 'bedrock') {
    const missing = providerConfig.envKeys.filter(k => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(`Missing AWS credentials: ${missing.join(', ')}`);
    }
  } else {
    if (!process.env[providerConfig.envKey]) {
      throw new Error(`Missing API key: ${providerConfig.envKey}`);
    }
  }

  return true;
}

/**
 * Lazy singleton for Anthropic client.
 */
let _anthropicClient = null;
function getAnthropicClient() {
  if (!_anthropicClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropicClient = new Anthropic();
  }
  return _anthropicClient;
}

/**
 * Create Anthropic client
 */
async function callAnthropic(system, messages, options = {}) {
  const client = getAnthropicClient();
  
  const response = await client.messages.create({
    model: options.model || process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: options.maxTokens || 4096,
    system: system,
    messages: messages,
  });

  return response.content[0].text;
}

/**
 * Create OpenAI client
 */
async function callOpenAI(system, messages, options = {}) {
  const OpenAI = require('openai');
  const client = new OpenAI();

  // Convert to OpenAI format (system as first message)
  const openaiMessages = [
    { role: 'system', content: system },
    ...messages,
  ];

  const response = await client.chat.completions.create({
    model: options.model || process.env.LLM_MODEL || 'gpt-4o',
    max_tokens: options.maxTokens || 4096,
    messages: openaiMessages,
  });

  return response.choices[0].message.content;
}

/**
 * Create Gemini client
 */
async function callGemini(system, messages, options = {}) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  const model = genAI.getGenerativeModel({ 
    model: options.model || process.env.LLM_MODEL || 'gemini-1.5-pro',
    systemInstruction: system,
  });

  // Convert messages to Gemini format
  const history = messages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history });
  const lastMessage = messages[messages.length - 1];
  const result = await chat.sendMessage(lastMessage.content);

  return result.response.text();
}

/**
 * Lazy singleton for Bedrock client — avoids creating a new client on every call.
 */
let _bedrockClient = null;
function getBedrockClient() {
  if (!_bedrockClient) {
    const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');
    _bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return _bedrockClient;
}

/**
 * Resolve Bedrock model ID consistently across streaming and non-streaming.
 */
function resolveBedrockModel(options = {}) {
  return options.model || process.env.LLM_MODEL || PROVIDERS.bedrock.defaultModel;
}

/**
 * Create Bedrock client
 */
async function callBedrock(system, messages, options = {}) {
  const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
  
  const client = getBedrockClient();

  const modelId = resolveBedrockModel(options);

  // Bedrock uses Anthropic message format for Claude models
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: options.maxTokens || 4096,
    system: system,
    messages: messages,
  };

  const command = new InvokeModelCommand({
    modelId: modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  return responseBody.content[0].text;
}

/**
 * Stream from Bedrock
 */
async function* streamBedrock(system, messages, options = {}) {
  const { InvokeModelWithResponseStreamCommand } = require('@aws-sdk/client-bedrock-runtime');
  
  const client = getBedrockClient();

  const modelId = resolveBedrockModel(options);

  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: options.maxTokens || 4096,
    system: system,
    messages: messages,
  };

  const command = new InvokeModelWithResponseStreamCommand({
    modelId: modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  });

  const response = await client.send(command);
  
  for await (const event of response.body) {
    try {
      if (event.chunk) {
        const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
        if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
          yield chunk.delta.text;
        }
        // Handle Bedrock error events within the stream
        if (chunk.type === 'error') {
          throw new Error(`Bedrock stream error: ${chunk.error?.message || 'Unknown error'}`);
        }
      }
    } catch (err) {
      // Re-throw after logging — callers (SSE handler) will catch and handle
      console.error('Bedrock stream chunk error:', err.message);
      throw err;
    }
  }
}

/**
 * Stream from Anthropic
 */
async function* streamAnthropic(system, messages, options = {}) {
  const client = getAnthropicClient();
  
  const stream = await client.messages.stream({
    model: options.model || process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: options.maxTokens || 4096,
    system: system,
    messages: messages,
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.text) {
      yield event.delta.text;
    }
  }
}

/**
 * Stream from OpenAI
 */
async function* streamOpenAI(system, messages, options = {}) {
  const OpenAI = require('openai');
  const client = new OpenAI();

  const openaiMessages = [
    { role: 'system', content: system },
    ...messages,
  ];

  const stream = await client.chat.completions.create({
    model: options.model || process.env.LLM_MODEL || 'gpt-4o',
    max_tokens: options.maxTokens || 4096,
    messages: openaiMessages,
    stream: true,
  });

  for await (const chunk of stream) {
    const text = chunk.choices?.[0]?.delta?.content;
    if (text) yield text;
  }
}

/**
 * Stream from Gemini
 */
async function* streamGemini(system, messages, options = {}) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  const model = genAI.getGenerativeModel({
    model: options.model || process.env.LLM_MODEL || 'gemini-1.5-pro',
    systemInstruction: system,
  });

  // Convert messages to Gemini format
  const history = messages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history });
  const lastMessage = messages[messages.length - 1];
  const result = await chat.sendMessageStream(lastMessage.content);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}

/**
 * Unified streaming function
 */
async function* chatStream(system, messages, options = {}) {
  const config = getConfig();
  validateCredentials();

  if (config.provider === 'bedrock') {
    yield* streamBedrock(system, messages, { ...options, model: config.model });
  } else if (config.provider === 'anthropic') {
    yield* streamAnthropic(system, messages, { ...options, model: config.model });
  } else if (config.provider === 'openai') {
    yield* streamOpenAI(system, messages, { ...options, model: config.model });
  } else if (config.provider === 'gemini') {
    yield* streamGemini(system, messages, { ...options, model: config.model });
  } else {
    // Fallback: non-streaming for unknown providers
    const response = await chat(system, messages, options);
    yield response;
  }
}

/**
 * Determine if an error is retryable.
 * Retry on: network errors, 429 (rate limit), 500/502/503 (server errors).
 * Don't retry on: 400 (bad request), 401/403 (auth errors).
 */
function isRetryableError(err) {
  // Network errors (no status code)
  if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'EPIPE') {
    return true;
  }
  const status = err.status || err.statusCode || err.$metadata?.httpStatusCode;
  if (status === 429 || status === 500 || status === 502 || status === 503) return true;
  if (status === 400 || status === 401 || status === 403) return false;
  // Retry on generic network/fetch errors
  if (err.message && /ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|network/i.test(err.message)) return true;
  return false;
}

/**
 * Unified chat function with retry logic (3 attempts, exponential backoff).
 */
async function chat(system, messages, options = {}) {
  const config = getConfig();
  validateCredentials();

  const callFunctions = {
    anthropic: callAnthropic,
    openai: callOpenAI,
    gemini: callGemini,
    bedrock: callBedrock,
  };

  const callFn = callFunctions[config.provider];
  if (!callFn) {
    throw new Error(`Provider not implemented: ${config.provider}`);
  }

  const maxAttempts = 3;
  const backoffMs = [1000, 2000, 4000];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callFn(system, messages, { ...options, model: config.model });
    } catch (err) {
      if (attempt < maxAttempts && isRetryableError(err)) {
        const delay = backoffMs[attempt - 1];
        console.warn(`LLM call attempt ${attempt}/${maxAttempts} failed (${err.message}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }
}

/**
 * List available providers and models
 */
function listProviders() {
  return Object.entries(PROVIDERS).map(([key, config]) => ({
    id: key,
    name: config.name,
    models: config.models,
    defaultModel: config.defaultModel,
    configured: key === 'bedrock' 
      ? config.envKeys.every(k => !!process.env[k])
      : !!process.env[config.envKey],
  }));
}

module.exports = {
  chat,
  chatStream,
  getConfig,
  validateCredentials,
  listProviders,
  PROVIDERS,
};
