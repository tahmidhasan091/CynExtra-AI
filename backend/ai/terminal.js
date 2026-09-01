"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const DATA_DIR = path.join(__dirname, "..", "data");

const HELP_TEXT = `CynExtra-AI Terminal — safe command list

  help                 Show this help
  clear                Clear the screen (client-side)
  status               Backend + AI provider status
  health               API health check
  models               List available CynExtra models
  version              App / Node version
  date                 Current server time
  whoami               Current runtime user info
  ls                   List backend/data files
  ls data              Same as ls
  env                  Show non-secret environment config
  chats                Count chats in memory store
  users                Count users in memory store
  knowledge            Knowledge base summary

Note: Arbitrary shell commands are disabled for security.
`;

function safeReadJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function runCommand(rawInput) {
  const input = String(rawInput || "").trim();
  if (!input) {
    return { success: true, output: "" };
  }

  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case "help":
    case "?":
      return { success: true, output: HELP_TEXT };

    case "clear":
    case "cls":
      return { success: true, output: "", clear: true };

    case "status":
    case "health": {
      const hasKey = Boolean(process.env.AI_API_KEY && process.env.AI_API_KEY !== "YOUR_GROQ_OR_OPENAI_API_KEY_HERE");
      const lines = [
        "CynExtra-AI status",
        "-----------------",
        `Service:     online`,
        `Port:        ${process.env.PORT || 3000}`,
        `Provider:    ${process.env.AI_PROVIDER || "openai-compatible"}`,
        `Base URL:    ${process.env.AI_BASE_URL || "(not set)"}`,
        `Default model: ${process.env.AI_MODEL || "(not set)"}`,
        `API key:     ${hasKey ? "configured" : "MISSING — set AI_API_KEY in backend/.env"}`,
        `Search:      ${process.env.SEARCH_PROVIDER || "duckduckgo"}`,
        `Node:        ${process.version}`,
        `Platform:    ${process.platform} ${os.arch()}`,
        `Uptime:      ${Math.floor(process.uptime())}s`
      ];
      return { success: true, output: lines.join("\n") };
    }

    case "version": {
      let pkgVersion = "1.0.0";
      try {
        const pkg = require("../package.json");
        pkgVersion = pkg.version || pkgVersion;
      } catch {
        /* ignore */
      }
      return {
        success: true,
        output: `CynExtra-AI ${pkgVersion}\nNode ${process.version}\nExpress API /api/terminal`
      };
    }

    case "date":
    case "time":
      return {
        success: true,
        output: new Date().toString()
      };

    case "whoami":
      return {
        success: true,
        output: [
          `user: ${os.userInfo().username || "cynextra"}`,
          `host: ${os.hostname()}`,
          `cwd:  ${process.cwd()}`,
          `pid:  ${process.pid}`
        ].join("\n")
      };

    case "env": {
      const lines = [
        "Non-secret environment",
        "----------------------",
        `PORT=${process.env.PORT || 3000}`,
        `AI_BASE_URL=${process.env.AI_BASE_URL || ""}`,
        `AI_MODEL=${process.env.AI_MODEL || ""}`,
        `AI_PROVIDER=${process.env.AI_PROVIDER || ""}`,
        `AI_TIMEOUT_MS=${process.env.AI_TIMEOUT_MS || ""}`,
        `SEARCH_PROVIDER=${process.env.SEARCH_PROVIDER || ""}`,
        `AI_API_KEY=${process.env.AI_API_KEY && process.env.AI_API_KEY !== "YOUR_GROQ_OR_OPENAI_API_KEY_HERE" ? "(set)" : "(not set)"}`
      ];
      return { success: true, output: lines.join("\n") };
    }

    case "ls":
    case "dir": {
      const target = (args[0] || "data").toLowerCase();
      if (target !== "data" && target !== "." && target !== "./data") {
        return {
          success: false,
          output: `ls: only 'data' directory is allowed.\nTry: ls data`
        };
      }
      if (!fs.existsSync(DATA_DIR)) {
        return { success: true, output: "(data directory empty or missing)" };
      }
      const files = fs.readdirSync(DATA_DIR);
      if (!files.length) return { success: true, output: "(empty)" };
      const lines = files.map((name) => {
        const full = path.join(DATA_DIR, name);
        try {
          const st = fs.statSync(full);
          return `${st.isDirectory() ? "d" : "-"}  ${formatBytes(st.size).padStart(8)}  ${name}`;
        } catch {
          return `?         ${name}`;
        }
      });
      return { success: true, output: lines.join("\n") };
    }

    case "models": {
      try {
        const models = require("./models");
        const list = typeof models.listModels === "function" ? models.listModels() : models.MODELS || [];
        const arr = Array.isArray(list) ? list : Object.values(list);
        if (!arr.length) {
          return {
            success: true,
            output: "Models: Nova, Swift, Core, Think, Code, Vision, Max"
          };
        }
        const lines = arr.map((m) => {
          const id = m.id || m.name || "?";
          const name = m.name || m.label || id;
          const plan = m.minPlan || m.plan || "free";
          return `• ${name}  (${id})  plan:${plan}`;
        });
        return { success: true, output: "Available models\n----------------\n" + lines.join("\n") };
      } catch (err) {
        return {
          success: true,
          output: "Models: cynextra-nova, cynextra-swift, cynextra-core, cynextra-think, cynextra-code, cynextra-vision, cynextra-max"
        };
      }
    }

    case "chats": {
      const chats = safeReadJson(path.join(DATA_DIR, "chats.json"), []);
      const count = Array.isArray(chats) ? chats.length : Object.keys(chats || {}).length;
      return { success: true, output: `Chats stored: ${count}` };
    }

    case "users": {
      const users = safeReadJson(path.join(DATA_DIR, "users.json"), []);
      const count = Array.isArray(users) ? users.length : Object.keys(users || {}).length;
      return { success: true, output: `Users stored: ${count}` };
    }

    case "knowledge": {
      const knowledge = safeReadJson(path.join(DATA_DIR, "knowledge.json"), {});
      const entries = Array.isArray(knowledge)
        ? knowledge.length
        : Array.isArray(knowledge.entries)
          ? knowledge.entries.length
          : Object.keys(knowledge).length;
      return { success: true, output: `Knowledge entries: ${entries}` };
    }

    case "echo":
      return { success: true, output: args.join(" ") };

    case "npm":
    case "node":
    case "bash":
    case "sh":
    case "rm":
    case "sudo":
    case "cd":
    case "cat":
    case "curl":
      return {
        success: false,
        output: `Command '${cmd}' is blocked in the web terminal for security.\nUse Acode/Termux for real shell access.\nType 'help' for allowed commands.`
      };

    default:
      return {
        success: false,
        output: `Unknown command: ${cmd}\nType 'help' to see available commands.`
      };
  }
}

module.exports = {
  runCommand,
  HELP_TEXT
};
