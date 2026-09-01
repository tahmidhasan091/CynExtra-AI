"use strict";

class MediaProviderError extends Error {
  constructor(message, code = "MEDIA_PROVIDER_ERROR") {
    super(message);
    this.name = "MediaProviderError";
    this.code = code;
  }
}

function config() {
  return {
    provider: (process.env.IMAGE_PROVIDER || "").trim(),
    url: (process.env.IMAGE_API_URL || "").trim(),
    key: (process.env.IMAGE_API_KEY || "").trim(),
    model: (process.env.IMAGE_MODEL || "").trim(),
    timeoutMs: Number.parseInt(process.env.IMAGE_TIMEOUT_MS || "60000", 10)
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.provider && c.url && c.key && c.model);
}

function getStatus() {
  const c = config();
  return {
    provider: c.provider || null,
    configured: isConfigured(),
    model: c.model || null
  };
}

async function generateImage({ prompt, size = "1024x1024", n = 1 } = {}) {
  const text = typeof prompt === "string" ? prompt.trim() : "";
  if (!text) throw new MediaProviderError("Image prompt is required.", "INVALID_INPUT");
  const c = config();
  if (!isConfigured()) {
    throw new MediaProviderError(
      "Image generation provider is not configured.",
      "MEDIA_PROVIDER_NOT_CONFIGURED"
    );
  }

  let response;
  try {
    response = await fetch(c.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.key}` },
      body: JSON.stringify({ model: c.model, prompt: text, size, n }),
      signal: AbortSignal.timeout(c.timeoutMs)
    });
  } catch {
    throw new MediaProviderError("Unable to connect to the image provider.", "MEDIA_PROVIDER_CONNECTION_FAILED");
  }

  let data;
  try { data = await response.json(); } catch {
    throw new MediaProviderError("Image provider returned invalid JSON.", "MEDIA_PROVIDER_INVALID_RESPONSE");
  }
  if (!response.ok) {
    throw new MediaProviderError(data?.error?.message || "Image provider rejected the request.", "MEDIA_PROVIDER_REQUEST_FAILED");
  }

  const items = Array.isArray(data?.data) ? data.data : [];
  const results = items.map((item) => ({
    url: typeof item?.url === "string" ? item.url : null,
    b64_json: typeof item?.b64_json === "string" ? item.b64_json : null
  })).filter((x) => x.url || x.b64_json);

  if (!results.length) {
    throw new MediaProviderError("Image provider returned no image data.", "MEDIA_PROVIDER_EMPTY_RESPONSE");
  }
  return { provider: c.provider, model: c.model, results };
}

module.exports = { MediaProviderError, isConfigured, getStatus, generateImage };
