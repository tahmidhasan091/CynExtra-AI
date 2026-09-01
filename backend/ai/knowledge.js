"use strict";

const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const KNOWLEDGE_FILE = path.join(DATA_DIR, "knowledge.json");

async function ensureKnowledgeFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(KNOWLEDGE_FILE);
  } catch {
    const initial = {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries: [
        {
          id: "about-cynextra",
          title: "About CynExtra-AI",
          content:
            "CynExtra-AI is an intelligent AI workspace for chat, projects, tools, and creative work. It supports multiple models, memory, and optional web search.",
          tags: ["about", "product"]
        },
        {
          id: "safety",
          title: "Safety principles",
          content:
            "CynExtra-AI should be used responsibly. Users must not request or use the system for illegal or harmful activities. Important AI outputs should be verified.",
          tags: ["safety", "policy"]
        }
      ]
    };
    await fs.writeFile(
      KNOWLEDGE_FILE,
      JSON.stringify(initial, null, 2),
      "utf8"
    );
  }
}

async function loadKnowledge() {
  await ensureKnowledgeFile();
  try {
    const raw = await fs.readFile(KNOWLEDGE_FILE, "utf8");
    if (!raw.trim()) {
      return { version: 1, entries: [] };
    }
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || !Array.isArray(data.entries)) {
      return { version: 1, entries: [] };
    }
    return data;
  } catch {
    return { version: 1, entries: [] };
  }
}

async function saveKnowledge(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.entries)) {
    throw new TypeError("Invalid knowledge data.");
  }
  const payload = {
    version: data.version || 1,
    updatedAt: new Date().toISOString(),
    entries: data.entries
  };
  const tmp = `${KNOWLEDGE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
  await fs.rename(tmp, KNOWLEDGE_FILE);
  return payload;
}

function findRelevantKnowledge(entries, query, limit = 5) {
  if (!Array.isArray(entries) || !query) return [];
  const q = String(query).toLowerCase();
  const scored = entries
    .map((e) => {
      const text = `${e.title || ""} ${e.content || ""} ${(e.tags || []).join(" ")}`.toLowerCase();
      let score = 0;
      q.split(/\s+/).forEach((word) => {
        if (word.length > 2 && text.includes(word)) score += 1;
      });
      return { entry: e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((x) => x.entry);
}

async function getKnowledgeContext(query, limit = 5) {
  const data = await loadKnowledge();
  const relevant = findRelevantKnowledge(data.entries, query, limit);
  if (!relevant.length) return "";
  return relevant
    .map((e) => `[Knowledge: ${e.title}]\n${e.content}`)
    .join("\n\n");
}

module.exports = {
  ensureKnowledgeFile,
  loadKnowledge,
  saveKnowledge,
  findRelevantKnowledge,
  getKnowledgeContext,
  KNOWLEDGE_FILE
};
