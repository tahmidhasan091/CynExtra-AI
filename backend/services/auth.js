"use strict";

const crypto = require("crypto");
const memory = require("../ai/memory");

const SECRET = (process.env.AUTH_SECRET || "").trim();
const TOKEN_TTL_SEC = Number.parseInt(process.env.AUTH_TOKEN_TTL_SEC || "604800", 10);

function requireSecret() {
  if (!SECRET || SECRET.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters.");
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload) {
  requireSecret();
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token) {
  requireSecret();
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (!payload?.sub || !payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function hashPassword(password) {
  const value = String(password || "");
  if (value.length < 8) throw new Error("Password must be at least 8 characters.");
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(value, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function verifyPassword(password, encoded) {
  try {
    const [, saltHex, hashHex] = String(encoded || "").split("$");
    if (!saltHex || !hashHex) return false;
    const derived = crypto.scryptSync(String(password || ""), Buffer.from(saltHex, "hex"), 64);
    const expected = Buffer.from(hashHex, "hex");
    return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
  } catch { return false; }
}

function safeUser(user) {
  if (!user) return null;
  const metadata = user.metadata && typeof user.metadata === "object" ? user.metadata : {};
  return {
    id: user.id,
    plan: user.plan,
    metadata: {
      name: metadata.name || "",
      email: metadata.email || "",
      profile: metadata.profile || {}
    },
    createdAt: user.createdAt
  };
}

async function signup({ name, email, password }) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanName = String(name || "").trim().slice(0, 100);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error("A valid email is required.");
  if (cleanName.length < 1) throw new Error("Name is required.");
  // memory intentionally remains the source of user records.
  const existing = await memory.findUserByEmail(cleanEmail);
  if (existing) throw new Error("An account with that email already exists.");
  const id = "user_" + crypto.randomBytes(12).toString("hex");
  const user = await memory.createUser(id, {
    name: cleanName, email: cleanEmail,
    passwordHash: hashPassword(password)
  });
  return issue(user);
}

async function login({ email, password }) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  const user = await memory.findUserByEmail(cleanEmail);
  if (!user || !verifyPassword(password, user.metadata?.passwordHash)) {
    throw new Error("Invalid email or password.");
  }
  return issue(user);
}

function issue(user) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
  return { token: sign({ sub: user.id, exp }), user: safeUser(user), expiresAt: new Date(exp * 1000).toISOString() };
}

function authenticateRequest(req) {
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) return null;
  return verify(auth.slice(7).trim());
}


async function createPasswordCode(email) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  const user = await memory.findUserByEmail(cleanEmail);
  if (!user) return { accepted: true };
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000;
  await memory.updateUserMetadata(user.id, {
    passwordReset: { codeHash, expiresAt, attempts: 0, used: false }
  });
  return { accepted: true, email: cleanEmail, code, userId: user.id };
}

async function verifyPasswordCode(email, code, newPassword) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  const user = await memory.findUserByEmail(cleanEmail);
  if (!user) throw new Error("Invalid verification code.");
  const reset = user.metadata?.passwordReset;
  if (!reset || reset.used || Number(reset.expiresAt || 0) < Date.now()) {
    throw new Error("Verification code is invalid or expired.");
  }
  if (Number(reset.attempts || 0) >= 5) throw new Error("Too many verification attempts.");
  const suppliedHash = crypto.createHash("sha256").update(String(code || "").trim()).digest("hex");
  const expectedHash = Buffer.from(String(reset.codeHash || ""), "hex");
  const suppliedHashBuffer = Buffer.from(suppliedHash, "hex");
  if (expectedHash.length !== suppliedHashBuffer.length || !crypto.timingSafeEqual(expectedHash, suppliedHashBuffer)) {
    await memory.updateUserMetadata(user.id, {
      passwordReset: { ...reset, attempts: Number(reset.attempts || 0) + 1 }
    });
    throw new Error("Invalid verification code.");
  }
  const passwordHash = hashPassword(newPassword);
  await memory.updateUserMetadata(user.id, {
    passwordHash,
    passwordReset: { ...reset, used: true, codeHash: null }
  });
  return safeUser(await memory.findUser(user.id));
}

module.exports = {
  signup, login, authenticateRequest, verify, safeUser,
  hashPassword, verifyPassword, createPasswordCode, verifyPasswordCode
};
