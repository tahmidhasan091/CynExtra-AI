"use strict";

/*
 * Real email transport adapter.
 * It intentionally does not pretend to send mail when no provider is configured.
 * EMAIL_API_URL should accept JSON: {to, subject, text, from}.
 */
async function sendEmail({ to, subject, text }) {
  const url = String(process.env.EMAIL_API_URL || "").trim();
  const key = String(process.env.EMAIL_API_KEY || "").trim();
  if (!url || !key) {
    const err = new Error("Email provider is not configured.");
    err.code = "EMAIL_PROVIDER_NOT_CONFIGURED";
    throw err;
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      to,
      subject,
      text,
      from: String(process.env.EMAIL_FROM || "").trim() || undefined
    }),
    signal: AbortSignal.timeout(Number.parseInt(process.env.EMAIL_TIMEOUT_MS || "15000", 10))
  });
  if (!response.ok) {
    const err = new Error("Email provider rejected the message.");
    err.code = "EMAIL_PROVIDER_FAILED";
    throw err;
  }
  return { sent: true };
}

module.exports = { sendEmail };
