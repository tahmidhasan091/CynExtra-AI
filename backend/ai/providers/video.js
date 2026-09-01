"use strict";

const { MediaProviderError } = require("./image");

function config() {
  return {
    provider: (process.env.VIDEO_PROVIDER || "").trim(),
    url: (process.env.VIDEO_API_URL || "").trim(),
    key: (process.env.VIDEO_API_KEY || "").trim(),
    model: (process.env.VIDEO_MODEL || "").trim(),
    timeoutMs: Number.parseInt(process.env.VIDEO_TIMEOUT_MS || "120000", 10)
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.provider && c.url && c.key && c.model);
}

function getStatus() {
  const c = config();
  return { provider: c.provider || null, configured: isConfigured(), model: c.model || null };
}

async function generateVideo({ prompt, duration, aspectRatio } = {}) {
  const text = typeof prompt === "string" ? prompt.trim() : "";
  if (!text) throw new MediaProviderError("Video prompt is required.", "INVALID_INPUT");
  const c = config();
  if (!isConfigured()) {
    throw new MediaProviderError(
      "Video generation provider is not configured.",
      "MEDIA_PROVIDER_NOT_CONFIGURED"
    );
  }

  const body = { model: c.model, prompt: text };
  if (duration !== undefined) body.duration = duration;
  if (aspectRatio) body.aspect_ratio = aspectRatio;

  let response;
  try {
    response = await fetch(c.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(c.timeoutMs)
    });
  } catch {
    throw new MediaProviderError("Unable to connect to the video provider.", "MEDIA_PROVIDER_CONNECTION_FAILED");
  }

  let data;
  try { data = await response.json(); } catch {
    throw new MediaProviderError("Video provider returned invalid JSON.", "MEDIA_PROVIDER_INVALID_RESPONSE");
  }
  if (!response.ok) {
    throw new MediaProviderError(data?.error?.message || "Video provider rejected the request.", "MEDIA_PROVIDER_REQUEST_FAILED");
  }

  const result = {
    id: typeof data?.id === "string" ? data.id : null,
    status: typeof data?.status === "string" ? data.status : null,
    url: typeof data?.url === "string" ? data.url : null
  };
  if (!result.id && !result.url) {
    throw new MediaProviderError(
      "Video provider returned neither a job id nor a video URL.",
      "MEDIA_PROVIDER_EMPTY_RESPONSE"
    );
  }
  return { provider: c.provider, model: c.model, result };
}

module.exports = { isConfigured, getStatus, generateVideo };
