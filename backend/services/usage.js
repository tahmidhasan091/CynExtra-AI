"use strict";

const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const USAGE_FILE = path.join(DATA_DIR, "usage.json");

const PLAN_LIMITS = Object.freeze({
  free: Object.freeze({ prompts: 300, files: 60 }),
  basic: Object.freeze({ prompts: 300, files: 60 }),
  pro: Object.freeze({ prompts: 1500, files: 500 }),
  ultimate: Object.freeze({
    prompts: Number.parseInt(process.env.ULTIMATE_DAILY_PROMPTS || "3000", 10),
    files: Number.parseInt(process.env.ULTIMATE_DAILY_FILES || "2000", 10)
  })
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function load() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(USAGE_FILE, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid");
    return data;
  } catch {
    return { version: 1, days: {} };
  }
}

async function save(data) {
  const tmp = `${USAGE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, USAGE_FILE);
}

function planLimits(plan) {
  return PLAN_LIMITS[String(plan || "free").toLowerCase()] || PLAN_LIMITS.free;
}

async function getUsage(userId, plan = "free") {
  const data = await load();
  const day = today();
  const record = data.days?.[day]?.[userId] || { prompts: 0, files: 0 };
  const limits = planLimits(plan);
  return {
    date: day,
    plan: String(plan || "free").toLowerCase(),
    prompts: Number(record.prompts || 0),
    files: Number(record.files || 0),
    limits
  };
}

async function consume(userId, plan, type, amount = 1) {
  const key = type === "files" ? "files" : type === "prompts" ? "prompts" : null;
  if (!key) throw new Error("Unknown usage type.");
  const count = Math.max(1, Number.parseInt(amount, 10) || 1);
  const data = await load();
  const day = today();
  data.days ||= {};
  data.days[day] ||= {};
  data.days[day][userId] ||= { prompts: 0, files: 0 };
  const record = data.days[day][userId];
  const limits = planLimits(plan);
  if (Number(record[key] || 0) + count > limits[key]) {
    const err = new Error(`Daily ${key} limit reached for the ${plan} plan.`);
    err.code = "DAILY_LIMIT_REACHED";
    err.usage = {
      date: day,
      plan,
      prompts: Number(record.prompts || 0),
      files: Number(record.files || 0),
      limits
    };
    throw err;
  }
  record[key] = Number(record[key] || 0) + count;
  await save(data);
  return {
    date: day,
    plan,
    prompts: Number(record.prompts || 0),
    files: Number(record.files || 0),
    limits
  };
}

async function release(userId, type, amount = 1) {
  const key = type === "files" ? "files" : type === "prompts" ? "prompts" : null;
  if (!key) return;
  const data = await load();
  const day = today();
  const record = data.days?.[day]?.[userId];
  if (!record) return;
  record[key] = Math.max(0, Number(record[key] || 0) - Math.max(1, Number.parseInt(amount, 10) || 1));
  await save(data);
}

module.exports = { PLAN_LIMITS, planLimits, getUsage, consume, release, today };
