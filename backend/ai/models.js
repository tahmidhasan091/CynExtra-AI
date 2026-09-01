"use strict";

/**
 * CynExtra-AI Model Registry
 * User-facing product names → real provider model IDs
 * Change the `providerModel` values to match your AI provider.
 */

const MODELS = Object.freeze([
  {
    id: "cynextra-swift",
    name: "CynExtra Swift",
    icon: "swift",
    tagline: "Fast",
    description: "Fast answers & simple tasks",
    providerModel: process.env.MODEL_SWIFT || process.env.AI_MODEL || "openai/gpt-oss-20b",
    minPlan: "free",
    capabilities: ["chat", "text"]
  },
  {
    id: "cynextra-nova",
    name: "CynExtra Nova",
    icon: "nova",
    tagline: "Friendly + balanced",
    description: "Everyday chatting & general tasks",
    providerModel: process.env.MODEL_NOVA || process.env.AI_MODEL || "openai/gpt-oss-20b",
    minPlan: "pro",
    capabilities: ["chat", "text"]
  },
  {
    id: "cynextra-core",
    name: "CynExtra Core",
    icon: "core",
    tagline: "Reliable",
    description: "General-purpose work",
    providerModel: process.env.MODEL_CORE || process.env.AI_MODEL || "openai/gpt-oss-20b",
    minPlan: "ultimate",
    capabilities: ["chat", "text"]
  },
  {
    id: "cynextra-think",
    name: "CynExtra Think",
    icon: "think",
    tagline: "Smart",
    description: "Complex reasoning & difficult problems",
    providerModel: process.env.MODEL_THINK || process.env.AI_MODEL || "openai/gpt-oss-20b",
    minPlan: "ultimate",
    capabilities: ["chat", "text", "reasoning"]
  },
  {
    id: "cynextra-code",
    name: "CynExtra Code",
    icon: "code",
    tagline: "Developer",
    description: "Programming & development",
    providerModel: process.env.MODEL_CODE || process.env.AI_MODEL || "openai/gpt-oss-20b",
    minPlan: "ultimate",
    capabilities: ["chat", "text", "code"]
  },
  {
    id: "cynextra-vision",
    name: "CynExtra Vision",
    icon: "vision",
    tagline: "Vision",
    description: "Images & visual understanding",
    providerModel: process.env.MODEL_VISION || "qwen/qwen3.6-27b",
    minPlan: "free",
    capabilities: ["chat", "text", "vision"],
    available: String(process.env.VISION_ENABLED || "true").toLowerCase() !== "false"
  },
  {
    id: "cynextra-max",
    name: "CynExtra Max",
    icon: "max",
    tagline: "Premium",
    description: "Most powerful/advanced tasks",
    providerModel: process.env.MODEL_MAX || process.env.AI_MODEL || "openai/gpt-oss-20b",
    minPlan: "ultimate",
    capabilities: ["chat", "text", "reasoning", "code"]
  }
]);

const PLAN_RANK = Object.freeze({
  free: 0,
  basic: 0,
  pro: 1,
  ultimate: 2
});

function listModels(userPlan = "free") {
  const rank = PLAN_RANK[userPlan] ?? 0;
  return MODELS.filter((m) => {
    if (m.available === false) return false;
    return (PLAN_RANK[m.minPlan] ?? 0) <= rank;
  }).map((m) => ({
    id: m.id,
    name: m.name,
    icon: m.icon,
    tagline: m.tagline,
    description: m.description,
    minPlan: m.minPlan,
    capabilities: m.capabilities
  }));
}

function getModel(id) {
  if (!id || typeof id !== "string") return null;
  return MODELS.find((m) => m.id === id.trim()) || null;
}

function resolveProviderModel(modelId, userPlan = "free") {
  const model = getModel(modelId);
  if (!model) {
    return {
      ok: false,
      error: "Unknown model.",
      model: null
    };
  }
  if (model.available === false) {
    return {
      ok: false,
      error: "This model is not available with the current provider.",
      model: null
    };
  }
  const rank = PLAN_RANK[userPlan] ?? 0;
  if ((PLAN_RANK[model.minPlan] ?? 0) > rank) {
    return {
      ok: false,
      error: `Model "${model.name}" requires ${model.minPlan} plan or higher.`,
      model: null
    };
  }
  return {
    ok: true,
    model,
    providerModel: model.providerModel
  };
}

function getDefaultModelId(userPlan = "free") {
  const available = listModels(userPlan);
  return available[0]?.id || "cynextra-nova";
}

function isVisionAvailable(userPlan = "free") {
  const resolution = resolveProviderModel("cynextra-vision", userPlan);
  return resolution.ok;
}

module.exports = {
  MODELS,
  listModels,
  getModel,
  resolveProviderModel,
  getDefaultModelId,
  isVisionAvailable,
  PLAN_RANK
};
