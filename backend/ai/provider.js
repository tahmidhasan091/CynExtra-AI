"use strict";

const dotenv = require("dotenv");
dotenv.config();

const DEFAULT_PROVIDER_NAME = "openai-compatible";
const DEFAULT_MODEL = "openai/gpt-oss-20b";
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_RETRIES = 2;

class AIProviderError extends Error {
  constructor(message, code = "AI_PROVIDER_ERROR") {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
  }
}

function getProviderConfig() {
  const baseUrl = process.env.AI_BASE_URL?.trim() || "";
  const apiKey = process.env.AI_API_KEY?.trim() || "";
  const model = process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
  const providerName =
    process.env.AI_PROVIDER?.trim() || DEFAULT_PROVIDER_NAME;
  const timeoutValue = Number.parseInt(process.env.AI_TIMEOUT_MS, 10);
  const timeoutMs =
    Number.isInteger(timeoutValue) && timeoutValue > 0
      ? timeoutValue
      : DEFAULT_TIMEOUT_MS;

  return { providerName, baseUrl, apiKey, model, timeoutMs };
}

function isConfigured() {
  const config = getProviderConfig();
  const key = config.apiKey || "";
  const looksLikePlaceholder =
    !key ||
    key.includes("YOUR_") ||
    key.includes("your_") ||
    key === "changeme" ||
    key.length < 8;
  return Boolean(config.baseUrl && config.model && !looksLikePlaceholder);
}

function getStatus() {
  const config = getProviderConfig();
  return {
    provider: config.providerName,
    configured: isConfigured(),
    model: config.model
  };
}

function buildEndpoint(baseUrl) {
  return baseUrl.endsWith("/")
    ? `${baseUrl}chat/completions`
    : `${baseUrl}/chat/completions`;
}

async function generateResponse(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new TypeError("Provider messages must be a non-empty array.");
  }

  const config = getProviderConfig();
  if (!config.baseUrl) {
    throw new AIProviderError("AI provider base URL is not configured.", "AI_PROVIDER_NOT_CONFIGURED");
  }
  if (!config.apiKey) {
    throw new AIProviderError("AI provider API key is not configured.", "AI_PROVIDER_NOT_CONFIGURED");
  }

  const model = typeof options.model === "string" && options.model.trim() ? options.model.trim() : config.model;
  const endpoint = buildEndpoint(config.baseUrl);
  const requestBody = { model, messages, stream: false };
  if (typeof options.temperature === "number" && Number.isFinite(options.temperature)) requestBody.temperature = options.temperature;
  if (Number.isInteger(options.maxTokens) && options.maxTokens > 0) requestBody.max_tokens = options.maxTokens;
  if (typeof options.reasoningEffort === "string" && options.reasoningEffort.trim()) requestBody.reasoning_effort = options.reasoningEffort.trim();
  if (options.responseFormat && typeof options.responseFormat === "object") requestBody.response_format = options.responseFormat;

  const maxRetries = Number.isInteger(options.retries) ? Math.max(0, options.retries) : DEFAULT_RETRIES;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          "X-CynExtra-Request": String(options.requestId || "cynextra")
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(config.timeoutMs)
      });
    } catch (error) {
      lastError = error;
      const retryable = error?.name === "TimeoutError" || error?.name === "TypeError" || error?.code === "ECONNRESET";
      if (!retryable || attempt >= maxRetries) {
        if (error?.name === "TimeoutError") throw new AIProviderError("AI provider request timed out.", "AI_PROVIDER_TIMEOUT");
        throw new AIProviderError("Unable to connect to the AI provider.", "AI_PROVIDER_CONNECTION_FAILED");
      }
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      continue;
    }

    let data;
    try {
      data = await response.json();
    } catch {
      lastError = new AIProviderError("AI provider returned an invalid response.", "AI_PROVIDER_INVALID_RESPONSE");
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const msg = data?.error?.message || "AI provider rejected the request.";
      const retryableStatus = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
      lastError = new AIProviderError(msg, "AI_PROVIDER_REQUEST_FAILED");
      if (retryableStatus && attempt < maxRetries) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) ? Math.min(5000, Math.max(500, retryAfter * 1000)) : 900 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw lastError;
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      lastError = new AIProviderError("AI provider returned no usable message.", "AI_PROVIDER_EMPTY_RESPONSE");
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
        continue;
      }
      throw lastError;
    }

    return { content: content.trim(), provider: config.providerName, model };
  }

  throw lastError || new AIProviderError("Unable to generate an AI response.", "AI_PROVIDER_ERROR");
}

module.exports = {
  AIProviderError,
  getProviderConfig,
  isConfigured,
  getStatus,
  generateResponse
};
