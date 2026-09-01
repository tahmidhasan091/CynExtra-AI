"use strict";

/**
 * Short-lived, in-memory cache for uploaded image data.
 *
 * Why this exists: the frontend uploads a file once via POST /files/process
 * (so images aren't re-sent on every keystroke), but the actual chat request
 * that follows only references the attachment by id. This cache lets the
 * /chat route look the image data back up by id without a database.
 *
 * Entries expire on their own (TTL) so we never accumulate memory from
 * abandoned uploads. This is intentionally per-process/in-memory: it does
 * not need to survive a server restart, since an abandoned upload is not
 * worth persisting.
 */

const TTL_MS = 30 * 60 * 1000; // 30 minutes is far more than enough time
                                // between "file uploaded" and "message sent".
const MAX_ENTRIES = 500; // hard cap so a burst of uploads can't grow memory unbounded

const store = new Map();

function put(id, value) {
  if (!id) return;
  if (store.size >= MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) store.delete(oldestKey);
  }
  store.set(id, { value, expiresAt: Date.now() + TTL_MS });
}

function get(id) {
  if (!id) return null;
  const entry = store.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(id);
    return null;
  }
  return entry.value;
}

function sweep() {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (now > entry.expiresAt) store.delete(id);
  }
}

const sweeper = setInterval(sweep, 10 * 60 * 1000);
if (typeof sweeper.unref === "function") sweeper.unref();

module.exports = { put, get };
