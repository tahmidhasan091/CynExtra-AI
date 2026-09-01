"use strict";

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const EVENTS_FILE = path.join(__dirname, "..", "data", "payment_events.json");
let eventLock = Promise.resolve();

/*
 * Provider-neutral payment webhook verifier.
 * A real payment provider must POST a signed event to PAYMENT_WEBHOOK_URL
 * and the provider-specific checkout adapter can be added without changing
 * account/plan logic.
 */

async function claimEvent(eventId) {
  const id = String(eventId || "").trim();
  if (!id) return true;
  const run = eventLock.then(async () => {
    await fs.mkdir(path.dirname(EVENTS_FILE), { recursive: true });
    let events = [];
    try {
      const raw = await fs.readFile(EVENTS_FILE, "utf8");
      events = JSON.parse(raw);
      if (!Array.isArray(events)) events = [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (events.includes(id)) return false;
    events.push(id);
    if (events.length > 5000) events = events.slice(-5000);
    const tmp = `${EVENTS_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(events, null, 2), "utf8");
    await fs.rename(tmp, EVENTS_FILE);
    return true;
  });
  eventLock = run.catch(() => {});
  return run;
}

function allowedReturnUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return String(process.env.APP_ORIGIN || "").trim();
  try {
    const candidate = new URL(raw);
    const allowed = String(process.env.APP_ORIGIN || "").trim();
    if (allowed && candidate.origin === new URL(allowed).origin) return raw;
  } catch {}
  return String(process.env.APP_ORIGIN || "").trim();
}

function isConfigured() {
  return Boolean(
    String(process.env.PAYMENT_PROVIDER || "").trim() &&
    String(process.env.PAYMENT_CHECKOUT_URL || "").trim() &&
    String(process.env.PAYMENT_WEBHOOK_SECRET || "").trim()
  );
}

async function createCheckout({ userId, plan, successUrl, cancelUrl }) {
  const url = String(process.env.PAYMENT_CHECKOUT_URL || "").trim();
  const key = String(process.env.PAYMENT_API_KEY || "").trim();
  if (!url || !key) {
    const err = new Error("Payment checkout provider is not configured.");
    err.code = "PAYMENT_PROVIDER_NOT_CONFIGURED";
    throw err;
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ userId, plan, successUrl: allowedReturnUrl(successUrl), cancelUrl: allowedReturnUrl(cancelUrl) }),
    signal: AbortSignal.timeout(Number.parseInt(process.env.PAYMENT_TIMEOUT_MS || "15000", 10))
  });
  if (!response.ok) {
    const err = new Error("Payment provider rejected checkout creation.");
    err.code = "PAYMENT_PROVIDER_FAILED";
    throw err;
  }
  const data = await response.json();
  const checkoutUrl = String(data?.checkoutUrl || data?.url || "").trim();
  if (!checkoutUrl) {
    const err = new Error("Payment provider returned no checkout URL.");
    err.code = "PAYMENT_PROVIDER_INVALID_RESPONSE";
    throw err;
  }
  return { checkoutUrl, provider: String(process.env.PAYMENT_PROVIDER || "").trim() };
}

function verifyWebhook(rawBody, signature) {
  const secret = String(process.env.PAYMENT_WEBHOOK_SECRET || "").trim();
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const supplied = String(signature).trim().replace(/^sha256=/i, "");
  if (expected.length !== supplied.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

function normalizeEvent(event) {
  if (!event || typeof event !== "object") return null;
  const userId = String(event.userId || event.metadata?.userId || "").trim();
  const plan = String(event.plan || event.metadata?.plan || "").trim().toLowerCase();
  const status = String(event.status || event.type || "").trim().toLowerCase();
  if (!userId || !["pro", "ultimate"].includes(plan)) return null;
  const paid = ["paid", "succeeded", "payment_succeeded", "checkout.session.completed"].includes(status);
  return { userId, plan, paid, eventId: String(event.id || "").trim() || null };
}

module.exports = { isConfigured, createCheckout, verifyWebhook, normalizeEvent, claimEvent };
