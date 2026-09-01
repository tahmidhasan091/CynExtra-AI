"use strict";

const TOOL_PERMISSION_LEVELS = Object.freeze({
  NONE: "none",
  USER: "user",
  SENSITIVE: "sensitive"
});

const TOOL_STATUS = Object.freeze({
  ENABLED: "enabled",
  DISABLED: "disabled"
});

const tools = new Map();

function registerTool(definition) {
  if (!definition?.name || typeof definition.handler !== "function") {
    throw new TypeError("Invalid tool definition.");
  }
  const name = definition.name.trim();
  if (tools.has(name)) {
    throw new Error(`Tool "${name}" is already registered.`);
  }
  tools.set(
    name,
    Object.freeze({
      name,
      description: String(definition.description || "").trim(),
      permission: definition.permission || TOOL_PERMISSION_LEVELS.NONE,
      status: definition.status || TOOL_STATUS.ENABLED,
      handler: definition.handler
    })
  );
}

function listTools() {
  return Array.from(tools.values()).map((t) => ({
    name: t.name,
    description: t.description,
    permission: t.permission,
    status: t.status
  }));
}

function getTool(name) {
  return tools.get(String(name || "").trim()) || null;
}

async function executeTool(name, input = {}, permissions = [], mode = "normal", authorization = {}) {
  const timeoutMs = Math.max(100, Math.min(
    Number.parseInt(process.env.TOOL_TIMEOUT_MS || "10000", 10) || 10000,
    60000
  ));
  if (mode === "ultimate" && authorization?.ultimate !== true) {
    return { success: false, error: "Mode authorization is required.", mode };
  }
  const tool = getTool(name);
  if (!tool) return { success: false, error: "Tool not found." };
  if (tool.status !== TOOL_STATUS.ENABLED) {
    return { success: false, error: "Tool is disabled." };
  }
  if (
    tool.permission !== TOOL_PERMISSION_LEVELS.NONE &&
    !permissions.includes(tool.permission)
  ) {
    return { success: false, error: "Required permission has not been granted." };
  }
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => tool.handler(input || {})),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Tool timeout.")), timeoutMs))
    ]);
    return { success: true, tool: tool.name, mode, result };
  } catch (error) {
    console.error(`Tool "${tool.name}" failed:`, error);
    return { success: false, error: "Tool execution failed." };
  }
}

function calculateExpression(input) {
  const expression = String(input?.expression || "").trim();
  if (!expression || expression.length > 120) throw new Error("A short expression is required.");
  if (!/^[0-9+\-*/%().\s]+$/.test(expression)) throw new Error("Only basic arithmetic is supported.");
  const tokens = expression.match(/(?:\d+(?:\.\d+)?|[+\-*/%()]|\s+)/g) || [];
  const cleaned = tokens.filter((t) => !/^\s+$/.test(t));
  const prec = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2 };
  const output = []; const ops = [];
  for (const token of cleaned) {
    if (/^\d/.test(token)) output.push(Number(token));
    else if (token === "(") ops.push(token);
    else if (token === ")") {
      while (ops.length && ops.at(-1) !== "(") output.push(ops.pop());
      if (ops.pop() !== "(") throw new Error("Invalid expression.");
    } else {
      while (ops.length && ops.at(-1) !== "(" && prec[ops.at(-1)] >= prec[token]) output.push(ops.pop());
      ops.push(token);
    }
  }
  while (ops.length) { const op = ops.pop(); if (op === "(" || op === ")") throw new Error("Invalid expression."); output.push(op); }
  const stack=[];
  for (const token of output) {
    if (typeof token === "number") stack.push(token);
    else { const b=stack.pop(), a=stack.pop(); if (a===undefined || b===undefined) throw new Error("Invalid expression."); let v; if(token==="+")v=a+b; else if(token==="-")v=a-b; else if(token==="*")v=a*b; else if(token==="/")v=a/b; else v=a%b; if(!Number.isFinite(v)) throw new Error("Result is not finite."); stack.push(v); }
  }
  if (stack.length !== 1) throw new Error("Invalid expression.");
  return { expression, result: stack[0] };
}

registerTool({
  name: "calculator",
  description: "Safely evaluates basic arithmetic expressions.",
  permission: TOOL_PERMISSION_LEVELS.NONE,
  handler: async (input) => calculateExpression(input)
});

registerTool({
  name: "random_choice",
  description: "Picks one item from a supplied list for creative or surprise interactions.",
  permission: TOOL_PERMISSION_LEVELS.NONE,
  handler: async (input) => {
    const items = Array.isArray(input?.items) ? input.items.filter((x) => typeof x === "string" && x.trim()).slice(0, 50) : [];
    if (!items.length) throw new Error("items must contain at least one string.");
    return { choice: items[Math.floor(Math.random() * items.length)], count: items.length };
  }
});

registerTool({
  name: "get_time",
  description: "Returns the current server time in ISO 8601 format.",
  permission: TOOL_PERMISSION_LEVELS.NONE,
  handler: async () => ({ timestamp: new Date().toISOString() })
});

module.exports = {
  TOOL_PERMISSION_LEVELS,
  TOOL_STATUS,
  registerTool,
  listTools,
  getTool,
  executeTool,
  calculateExpression
};
