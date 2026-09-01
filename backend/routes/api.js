"use strict";

const crypto = require("crypto");
const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimit");
const memory = require("../ai/memory");
const brain = require("../ai/brain");
const tools = require("../ai/tools");
const models = require("../ai/models");
const knowledge = require("../ai/knowledge");
const { webSearch } = require("../ai/search");
const terminal = require("../ai/terminal");
const learning = require("../ai/learning");
const provider = require("../ai/provider");
const imageProvider = require("../ai/providers/image");
const videoProvider = require("../ai/providers/video");
const { processBase64File, storeProcessedFile, decodeBase64 } = require("../services/fileService");
const attachmentCache = require("../services/attachmentCache");
const auth = require("../services/auth");
const usage = require("../services/usage");
const email = require("../services/email");
const payment = require("../services/payment");
const ultimate = require("../ai/ultimate");

const router = express.Router();

const MAX_USER_ID_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 10000;
const MAX_CHAT_ID_LENGTH = 128;
const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `${req.ip || "unknown"}:${normalizeString(req.body?.email).toLowerCase()}`
});

function authGuard(req, res, next) {
  if (String(process.env.AUTH_REQUIRED).toLowerCase() !== "true") return next();
  const identity = auth.authenticateRequest(req);
  if (!identity) return res.status(401).json({ success: false, error: "Authentication required." });
  const supplied = normalizeString(req.query?.userId || req.body?.userId);
  if (supplied && supplied !== identity.sub) return res.status(403).json({ success: false, error: "User identity does not match the authenticated session." });
  req.authUserId = identity.sub;
  return next();
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateIdentifier(value, fieldName, maxLength) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return { valid: false, error: `${fieldName} is required.` };
  }
  if (normalized.length > maxLength) {
    return { valid: false, error: `${fieldName} exceeds the maximum allowed length.` };
  }
  return { valid: true, value: normalized };
}


function requireAuthenticatedUserId(req, supplied) {
  const value = normalizeString(supplied);
  if (!value) return req.authUserId;
  if (value !== req.authUserId) {
    const error = new Error("User identity does not match the authenticated session.");
    error.statusCode = 403;
    throw error;
  }
  return value;
}

function adminKeyMatches(req) {
  const configured = Buffer.from(String(process.env.ADMIN_KEY || ""));
  const supplied = Buffer.from(String(req.headers["x-admin-key"] || ""));
  return configured.length > 0 && configured.length === supplied.length && crypto.timingSafeEqual(configured, supplied);
}

router.get("/health", (req, res) => {
  return res.status(200).json({
    success: true,
    service: "CynExtra-AI API",
    status: "healthy"
  });
});

router.get("/status", (req, res) => {
  const provider = require("../ai/provider");
  return res.status(200).json({
    success: true,
    service: "CynExtra-AI API",
    status: "operational",
    version: "2.0.0",
    provider: provider.getStatus()
  });
});

router.post("/auth/signup", authRateLimiter, async (req, res, next) => {
  try {
    const result = await auth.signup({
      name: req.body?.name,
      email: req.body?.email,
      password: req.body?.password
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || "Unable to create account." });
  }
});

router.post("/auth/login", authRateLimiter, async (req, res, next) => {
  try {
    const result = await auth.login({ email: req.body?.email, password: req.body?.password });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(401).json({ success: false, error: "Invalid email or password." });
  }
});

router.get("/capabilities", (req, res) => {
  return res.status(200).json({
    success: true,
    capabilities: {
      chat: provider.isConfigured(),
      search: true,
      memory: true,
      learning: true,
      tools: true,
      authentication: true,
      imageGeneration: imageProvider.isConfigured(),
      videoGeneration: videoProvider.isConfigured(),
      fileProcessing: true,
      vision: models.isVisionAvailable("ultimate")
    },
    providers: {
      chat: provider.getStatus(),
      image: imageProvider.getStatus(),
      video: videoProvider.getStatus()
    }
  });
});

router.post("/payments/webhook", async (req, res, next) => {
  try {
    if (!payment.isConfigured()) return res.status(503).json({ success: false, error: "Payment webhook is not configured." });
    const signature = String(req.headers["x-payment-signature"] || req.headers["x-webhook-signature"] || "");
    const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    if (!payment.verifyWebhook(raw, signature)) return res.status(401).json({ success: false, error: "Invalid payment webhook signature." });
    const event = payment.normalizeEvent(req.body);
    if (!event || !event.paid) return res.status(200).json({ success: true, processed: false });
    if (!event.eventId) return res.status(400).json({ success: false, error: "Payment webhook event id is required." });
    const user = await memory.findUser(event.userId);
    if (!user) return res.status(404).json({ success: false, error: "User not found." });
    const claimed = await payment.claimEvent(event.eventId);
    if (!claimed) return res.status(200).json({ success: true, processed: true, duplicate: true });
    await memory.updateUserPlan(event.userId, event.plan);
    return res.status(200).json({ success: true, processed: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/auth/password/request", authRateLimiter, async (req, res, next) => {
  try {
    const result = await auth.createPasswordCode(req.body?.email);
    if (result.userId) {
      try {
        await email.sendEmail({
          to: result.email,
          subject: "CynExtra-AI password verification code",
          text: `Your CynExtra-AI password verification code is ${result.code}. It expires in 10 minutes and can be used once.`
        });
      } catch (err) {
        if (err.code === "EMAIL_PROVIDER_NOT_CONFIGURED") {
          return res.status(503).json({ success: false, error: "Password recovery email service is not configured." });
        }
        return res.status(502).json({ success: false, error: "Unable to send the verification email." });
      }
    }
    return res.status(200).json({ success: true, accepted: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/auth/password/change", authRateLimiter, async (req, res, next) => {
  try {
    const emailAddress = normalizeString(req.body?.email);
    const code = normalizeString(req.body?.code);
    const password = String(req.body?.newPassword || "");
    if (!emailAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) {
      return res.status(400).json({ success: false, error: "A valid email is required." });
    }
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ success: false, error: "A valid 6-digit verification code is required." });
    if (password.length < 8) return res.status(400).json({ success: false, error: "Password must be at least 8 characters." });
    await auth.verifyPasswordCode(emailAddress, code, password);
    return res.status(200).json({ success: true, message: "Password changed successfully." });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || "Unable to change password." });
  }
});

router.use(authGuard);

router.post("/payments/checkout", async (req, res, next) => {
  try {
    const userId = req.authUserId;
    const plan = normalizeString(req.body?.plan).toLowerCase();
    if (!userId || !["pro", "ultimate"].includes(plan)) {
      return res.status(400).json({ success: false, error: "A valid paid plan is required." });
    }
    const result = await payment.createCheckout({
      userId,
      plan,
      successUrl: normalizeString(req.body?.successUrl),
      cancelUrl: normalizeString(req.body?.cancelUrl)
    });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    const status = error.code === "PAYMENT_PROVIDER_NOT_CONFIGURED" ? 503 : 502;
    return res.status(status).json({ success: false, error: error.message || "Unable to create checkout." });
  }
});

router.get("/usage", async (req, res, next) => {
  try {
    const userId = requireAuthenticatedUserId(req, req.query.userId);
    if (!userId) return res.status(400).json({ success: false, error: "userId is required." });
    const plan = await memory.getUserPlan(userId);
    return res.status(200).json({ success: true, usage: await usage.getUsage(userId, plan || "free") });
  } catch (error) { return next(error); }
});

router.get("/models", async (req, res, next) => {
  try {
    const userId = normalizeString(req.query.userId);
    if (String(process.env.AUTH_REQUIRED).toLowerCase() === "true" && userId !== req.authUserId) {
      return res.status(403).json({ success: false, error: "User identity does not match the authenticated session." });
    }
    let plan = "free";
    if (userId) {
      const userPlan = await memory.getUserPlan(userId);
      if (userPlan) plan = userPlan;
    }
    const list = models.listModels(plan);
    return res.status(200).json({
      success: true,
      plan,
      models: list,
      defaultModel: models.getDefaultModelId(plan)
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/search", async (req, res, next) => {
  try {
    const query = normalizeString(req.body?.query);
    if (!query) {
      return res.status(400).json({ success: false, error: "query is required." });
    }
    const result = await webSearch(query, { limit: req.body?.limit || 5 });
    return res.status(result.success ? 200 : 503).json(result);
  } catch (error) {
    return next(error);
  }
});


router.get("/chats", async (req, res, next) => {
  try {
    const userId = requireAuthenticatedUserId(req, req.query.userId);
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId is required." });
    }
    const chats = await memory.getUserChats(userId);
    return res.status(200).json({ success: true, userId, chats });
  } catch (error) {
    return next(error);
  }
});

router.get("/chats/:chatId", async (req, res, next) => {
  try {
    const userId = requireAuthenticatedUserId(req, req.query.userId);
    const chatId = normalizeString(req.params.chatId);
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId is required." });
    }
    if (!chatId) {
      return res.status(400).json({ success: false, error: "chatId is required." });
    }
    const chat = await memory.getChat(userId, chatId);
    if (!chat) {
      return res.status(404).json({ success: false, error: "Chat not found." });
    }
    return res.status(200).json({
      success: true,
      chat: {
        id: chat.id,
        userId: chat.userId,
        title: chat.title,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt
      },
      messages: chat.messages
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/chats/:chatId", async (req, res, next) => {
  try {
    const userId = requireAuthenticatedUserId(req, req.query.userId);
    const chatId = normalizeString(req.params.chatId);
    if (!userId || !chatId) {
      return res.status(400).json({ success: false, error: "userId and chatId are required." });
    }
    const deleted = await memory.deleteChat(userId, chatId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Chat not found." });
    }
    return res.status(200).json({ success: true, message: "Chat deleted successfully.", chatId });
  } catch (error) {
    return next(error);
  }
});

router.post("/user", async (req, res, next) => {
  try {
    const validation = validateIdentifier(req.authUserId, "userId", MAX_USER_ID_LENGTH);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }
    const metadata = req.body?.metadata ?? {};
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return res.status(400).json({ success: false, error: "metadata must be an object." });
    }
    const user = await memory.createUser(validation.value, metadata);
    return res.status(200).json({ success: true, user: auth.safeUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.get("/user", async (req, res, next) => {
  try {
    const userId = requireAuthenticatedUserId(req, req.query.userId);
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId is required." });
    }
    const user = await memory.findUser(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }
    return res.status(200).json({ success: true, user: auth.safeUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.patch("/user", async (req, res, next) => {
  try {
    const userId = requireAuthenticatedUserId(req, req.body?.userId);
    const metadata = req.body?.metadata;
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId is required." });
    }
    if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
      return res.status(400).json({ success: false, error: "metadata must be an object." });
    }
    const allowed = {};
    if (typeof metadata.name === "string") allowed.name = metadata.name.trim().slice(0, 100);
    if (metadata.profile && typeof metadata.profile === "object" && !Array.isArray(metadata.profile)) {
      allowed.profile = metadata.profile;
    }
    const user = await memory.updateUserMetadata(userId, allowed);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }
    return res.status(200).json({ success: true, user: auth.safeUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.patch("/user/plan", async (req, res, next) => {
  try {
    const userId = normalizeString(req.body?.userId);
    const plan = normalizeString(req.body?.plan).toLowerCase();
    const adminKey = String(req.headers["x-admin-key"] || "");
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId is required." });
    }
    if (!adminKeyMatches(req)) {
      return res.status(403).json({ success: false, error: "Plan changes require admin authorization." });
    }
    const user = await memory.updateUserPlan(userId, plan);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }
    return res.status(200).json({ success: true, user: auth.safeUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.get("/tools", (req, res) => {
  return res.status(200).json({ success: true, tools: tools.listTools() });
});

router.post("/tools/execute", async (req, res, next) => {
  try {
    const userId = req.authUserId;
    const name = normalizeString(req.body?.name);
    const input = req.body?.input ?? {};
    const mode = req.body?.mode ?? "normal";
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId is required." });
    }
    const user = await memory.findUser(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }
    const userPlan = await memory.getUserPlan(userId);
    const permissions = userPlan === "ultimate"
      ? [tools.TOOL_PERMISSION_LEVELS.USER, tools.TOOL_PERMISSION_LEVELS.SENSITIVE]
      : userPlan === "pro"
        ? [tools.TOOL_PERMISSION_LEVELS.USER]
        : [];
    const authorization = { ultimate: userPlan === "ultimate" };
    if (!name) {
      return res.status(400).json({ success: false, error: "Tool name is required." });
    }
    const result = await tools.executeTool(name, input, permissions, mode, authorization);
    if (!result.success) {
      return res.status(403).json(result);
    }
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});

router.get("/ultimate/status", authGuard, async (req, res) => {
  try {
    const userId = normalizeString(req.authUserId);
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }
    const user = await memory.findUser(userId);
    const plan = user ? await memory.getUserPlan(user.id) : null;
    return res.status(200).json({
      success: true,
      ultimateAvailable: String(plan || "").toLowerCase() === "ultimate",
      plan: plan || null
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Unable to check Ultimate Mode status." });
  }
});

router.post("/ultimate/confirm", authGuard, async (req, res) => {
  const userId = normalizeString(req.authUserId);
  if (!userId) return res.status(401).json({ success: false, error: "Authentication required." });
  const confirmationId = normalizeString(req.body?.confirmationId);
  const action = normalizeString(req.body?.action);
  if (!confirmationId || !action) {
    return res.status(400).json({ success: false, error: "confirmationId and action are required." });
  }
  const result = ultimate.consumeConfirmation({
    confirmationId,
    userId,
    expectedAction: action
  });
  return res.status(result.confirmed ? 200 : 403).json({
    success: result.confirmed,
    ...result,
    executed: false,
    message: result.confirmed
      ? "Confirmation accepted. The host application must execute the action."
      : "Confirmation was not accepted."
  });
});

router.post("/chat", async (req, res, next) => {
  try {
    const body = req.body || {};
    const userValidation = validateIdentifier(req.authUserId, "userId", MAX_USER_ID_LENGTH);
    if (!userValidation.valid) {
      return res.status(400).json({ success: false, error: userValidation.error });
    }
    const message = normalizeString(body.message);
    if (!message) {
      return res.status(400).json({ success: false, error: "message is required." });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        error: "Message exceeds the maximum allowed length."
      });
    }

    const userId = userValidation.value;
    const modelId = normalizeString(body.modelId) || null;
    const useSearch = body.webSearch === true || body.search === true;
    const ultimateMode = body.ultimateMode === true;
    const ultimateReasoning = normalizeString(body.ultimateReasoning) || "balanced";
    const ultimateTools = normalizeString(body.ultimateTools) || "auto";
    const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 5) : [];
    const fileContextText = attachments
      .filter((item) => item && item.kind === "text" && typeof item.text === "string")
      .map((item) => `File: ${normalizeString(item.name).slice(0, 180)}\n${item.text.slice(0, 50000)}`)
      .join("\n\n")
      .slice(0, 100000);
    const cachedImages = attachments
      .filter((item) => item && item.kind === "image" && item.id)
      .map((item) => attachmentCache.get(item.id))
      .filter(Boolean)
      .slice(0, 4);
    const imageAttachments = cachedImages.map((img) => img.dataUrl);
    const imageFileNames = cachedImages.map((img) => img.name).filter(Boolean);
    let chatId = null;
    if (body.chatId !== undefined && body.chatId !== null) {
      const chatValidation = validateIdentifier(body.chatId, "chatId", MAX_CHAT_ID_LENGTH);
      if (!chatValidation.valid) {
        return res.status(400).json({ success: false, error: chatValidation.error });
      }
      chatId = chatValidation.value;
    }

    await memory.ensureDataFiles();
    let user = await memory.findUser(userId);
    if (!user && String(process.env.AUTH_REQUIRED).toLowerCase() === "true") {
      return res.status(404).json({ success: false, error: "Authenticated account not found." });
    }
    if (!user) user = await memory.createUser(userId);
    const userPlan = await memory.getUserPlan(user.id);
    let promptUsageReserved = false;
    try {
      await usage.consume(user.id, userPlan || "free", "prompts", 1);
      promptUsageReserved = true;
    } catch (err) {
      if (err.code === "DAILY_LIMIT_REACHED") {
        return res.status(429).json({ success: false, error: err.message, usage: err.usage });
      }
      throw err;
    }

    let chat;
    if (chatId) {
      chat = await memory.getChat(user.id, chatId);
      if (!chat) {
        return res.status(404).json({ success: false, error: "Chat not found." });
      }
    } else {
      chat = await memory.createChat(user.id);
    }

    // Build context from the existing conversation BEFORE saving the new prompt.
    // This prevents the current user message from being duplicated in the provider
    // context and ensures replies in reopened/older chats use their prior history.
    const context = await memory.getConversationContext(user.id, chat.id, 80);
    await memory.addMessage(user.id, chat.id, "user", message);

    let searchResult = null;
    if (useSearch) {
      searchResult = await webSearch(message, { limit: 5 });
    }

    let aiResult;
    try {
      aiResult = await brain.askCynExtra({
        userId: user.id,
        message,
        context,
        modelId,
        userPlan,
        searchResult,
        ultimateMode: ultimateMode && userPlan === "ultimate",
        ultimateReasoning,
        ultimateTools,
        fileContextText,
        imageAttachments,
        imageFileNames
      });
    } catch (err) {
      if (promptUsageReserved) await usage.release(user.id, "prompts", 1);
      if (err.code === "PROVIDER_NOT_CONFIGURED") {
        return res.status(503).json({
          success: false,
          error:
            "AI provider is not configured. Add AI_BASE_URL and AI_API_KEY to backend/.env"
        });
      }
      if (err.code === "MODEL_NOT_ALLOWED") {
        if (promptUsageReserved) await usage.release(user.id, "prompts", 1);
        return res.status(403).json({ success: false, error: err.message });
      }
      if (promptUsageReserved) await usage.release(user.id, "prompts", 1);
      throw err;
    }

    await memory.addMessage(
      user.id,
      chat.id,
      "assistant",
      aiResult.response.content
    );

    let learningResult = null;
    try {
      learningResult = await learning.learnFromExchange({
        userId: user.id,
        chatId: chat.id,
        userMessage: message,
        assistantResponse: aiResult.response.content
      });
    } catch (learnError) {
      // Learning is intentionally non-blocking: a learning failure must never
      // break a successful AI response or the existing chat API contract.
      console.warn("Learning analyzer warning:", learnError.message);
    }

    return res.status(200).json({
      success: true,
      chat: { id: chat.id, userId: user.id },
      message: { role: "user", content: message },
      response: aiResult.response,
      provider: aiResult.provider,
      model: aiResult.model,
      modelName: aiResult.modelName,
      searchUsed: aiResult.searchUsed,
      searchResults: searchResult?.success ? searchResult.results : undefined,
      ultimateMode: Boolean(aiResult.ultimateMode),
      learning: learningResult
        ? {
            saved: learningResult.saved || [],
            language: learningResult.language || null,
            classification: learningResult.classification || null,
            quality: learningResult.quality || null,
            trainingCandidate: learningResult.trainingCandidate
              ? {
                  id: learningResult.trainingCandidate.id,
                  status: learningResult.trainingCandidate.status,
                  classification: learningResult.trainingCandidate.classification || null,
                  quality: learningResult.trainingCandidate.quality || null,
                  duplicate: Boolean(learningResult.trainingCandidate.duplicate)
                }
              : null
          }
        : null
    });
  } catch (error) {
    return next(error);
  }
});


router.post("/chats/:chatId/messages/:messageId/edit", async (req, res, next) => {
  try {
    const userValidation = validateIdentifier(req.authUserId, "userId", MAX_USER_ID_LENGTH);
    if (!userValidation.valid) return res.status(400).json({ success: false, error: userValidation.error });
    const chatValidation = validateIdentifier(req.params.chatId, "chatId", MAX_CHAT_ID_LENGTH);
    if (!chatValidation.valid) return res.status(400).json({ success: false, error: chatValidation.error });
    const messageValidation = validateIdentifier(req.params.messageId, "messageId", 128);
    if (!messageValidation.valid) return res.status(400).json({ success: false, error: messageValidation.error });
    const message = normalizeString(req.body?.message);
    if (!message) return res.status(400).json({ success: false, error: "message is required." });
    if (message.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ success: false, error: "Message exceeds the maximum allowed length." });

    const userId = userValidation.value;
    const chatId = chatValidation.value;
    const existingChat = await memory.getChat(userId, chatId);
    if (!existingChat) return res.status(404).json({ success: false, error: "Chat not found." });
    const targetIndex = existingChat.messages.findIndex((m) => m.id === messageValidation.value);
    if (targetIndex === -1 || existingChat.messages[targetIndex]?.role !== "user") {
      return res.status(404).json({ success: false, error: "Editable user message not found." });
    }

    const userPlan = await memory.getUserPlan(userId);
    let promptUsageReserved = false;
    try {
      await usage.consume(userId, userPlan || "free", "prompts", 1);
      promptUsageReserved = true;
    } catch (err) {
      if (err.code === "DAILY_LIMIT_REACHED") return res.status(429).json({ success: false, error: err.message, usage: err.usage });
      throw err;
    }
    const modelId = normalizeString(req.body?.modelId) || null;
    const useSearch = req.body?.webSearch === true || req.body?.search === true;
    const ultimateMode = req.body?.ultimateMode === true;
    const ultimateReasoning = normalizeString(req.body?.ultimateReasoning) || "balanced";
    const ultimateTools = normalizeString(req.body?.ultimateTools) || "auto";
    const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments.slice(0, 5) : [];
    const fileContextText = attachments
      .filter((item) => item && item.kind === "text" && typeof item.text === "string")
      .map((item) => `File: ${normalizeString(item.name).slice(0, 180)}\n${item.text.slice(0, 50000)}`)
      .join("\n\n")
      .slice(0, 100000);
    const cachedImages = attachments
      .filter((item) => item && item.kind === "image" && item.id)
      .map((item) => attachmentCache.get(item.id))
      .filter(Boolean)
      .slice(0, 4);
    const imageAttachments = cachedImages.map((img) => img.dataUrl);
    const imageFileNames = cachedImages.map((img) => img.name).filter(Boolean);

    const context = existingChat.messages
      .slice(0, targetIndex)
      .concat([{ role: "user", content: message }])
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }));

    let searchResult = null;
    if (useSearch) searchResult = await webSearch(message, { limit: 5 });

    let aiResult;
    try {
      aiResult = await brain.askCynExtra({
        userId,
        message,
        context,
        modelId,
        userPlan,
        searchResult,
        ultimateMode: ultimateMode && userPlan === "ultimate",
        ultimateReasoning,
        ultimateTools,
        fileContextText,
        imageAttachments,
        imageFileNames
      });
    } catch (err) {
      if (promptUsageReserved) await usage.release(userId, "prompts", 1);
      if (err.code === "PROVIDER_NOT_CONFIGURED") return res.status(503).json({ success: false, error: "AI provider is not configured. Add AI_BASE_URL and AI_API_KEY to backend/.env" });
      if (err.code === "MODEL_NOT_ALLOWED") return res.status(403).json({ success: false, error: err.message });
      throw err;
    }

    await memory.editUserMessage(userId, chatId, messageValidation.value, message);
    await memory.addMessage(userId, chatId, "assistant", aiResult.response.content);
    try {
      await learning.learnFromExchange({ userId, chatId, userMessage: message, assistantResponse: aiResult.response.content });
    } catch (learnError) {
      console.warn("Learning analyzer warning:", learnError.message);
    }
    const updatedChat = await memory.getChat(userId, chatId);
    return res.status(200).json({
      success: true,
      chat: { id: chatId, userId },
      response: aiResult.response,
      provider: aiResult.provider,
      model: aiResult.model,
      modelName: aiResult.modelName,
      searchUsed: aiResult.searchUsed,
      searchResults: searchResult?.success ? searchResult.results : undefined,
      ultimateMode: Boolean(aiResult.ultimateMode),
      messages: updatedChat?.messages || []
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/media/image", async (req, res, next) => {
  try {
    const userId = req.authUserId;
    const plan = await memory.getUserPlan(userId);
    if (!["pro", "ultimate"].includes(plan)) return res.status(403).json({ success: false, error: "Image generation requires a Pro or Ultimate plan." });
    const count = Math.min(4, Math.max(1, Number(req.body?.n) || 1));
    try {
      await usage.consume(userId, plan, "files", count);
    } catch (err) {
      if (err.code === "DAILY_LIMIT_REACHED") return res.status(429).json({ success: false, error: err.message, usage: err.usage });
      throw err;
    }
    const result = await imageProvider.generateImage({
      prompt: req.body?.prompt,
      size: req.body?.size,
      n: count
    });
    return res.status(200).json({ success: true, type: "image", ...result });
  } catch (error) {
    const status = error.code === "MEDIA_PROVIDER_NOT_CONFIGURED" ? 503 : error.code === "INVALID_INPUT" ? 400 : 502;
    return res.status(status).json({ success: false, error: error.message || "Image generation failed." });
  }
});

router.post("/media/video", async (req, res, next) => {
  try {
    const userId = req.authUserId;
    const plan = await memory.getUserPlan(userId);
    if (plan !== "ultimate") return res.status(403).json({ success: false, error: "Video generation requires the Ultimate plan." });
    const result = await videoProvider.generateVideo({
      prompt: req.body?.prompt,
      duration: req.body?.duration,
      aspectRatio: req.body?.aspectRatio
    });
    return res.status(200).json({ success: true, type: "video", ...result });
  } catch (error) {
    const status = error.code === "MEDIA_PROVIDER_NOT_CONFIGURED" ? 503 : error.code === "INVALID_INPUT" ? 400 : 502;
    return res.status(status).json({ success: false, error: error.message || "Video generation failed." });
  }
});

router.post("/files/process", async (req, res, next) => {
  try {
    const userId = req.authUserId;
    if (!userId) return res.status(400).json({ success: false, error: "userId is required." });
    const user = await memory.findUser(userId);
    if (!user) return res.status(404).json({ success: false, error: "User not found." });
    const plan = await memory.getUserPlan(userId);
    const result = processBase64File({
      name: req.body?.name,
      mimeType: req.body?.mimeType,
      data: req.body?.data
    });
    try {
      await usage.consume(userId, plan || "free", "files", 1);
    } catch (err) {
      if (err.code === "DAILY_LIMIT_REACHED") return res.status(429).json({ success: false, error: err.message, usage: err.usage });
      throw err;
    }
    const stored = await storeProcessedFile(userId, result, decodeBase64(req.body?.data));

    // Text files carry their content straight through in the /chat request
    // body, but images are cached here (by attachment id) so /chat can look
    // the image data back up without re-uploading it.
    let aiContextSupported = result.kind === "text";
    if (result.kind === "image") {
      const rawData = String(req.body?.data || "");
      const dataUrl = rawData.startsWith("data:") ? rawData : `data:${result.mimeType};base64,${rawData}`;
      attachmentCache.put(stored.id, { dataUrl, name: result.name });
      aiContextSupported = models.isVisionAvailable(plan || "free");
    }

    return res.status(200).json({
      success: true,
      file: {
        ...result,
        id: stored.id,
        stored: true,
        aiContextSupported,
        storageKey: stored.storedName
      },
      usage: await usage.getUsage(userId, plan || "free")
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || "File processing failed." });
  }
});

router.get("/learning/training/export", async (req, res, next) => {
  try {
    const userId = normalizeString(req.query.userId);
    const format = normalizeString(req.query.format || "jsonl").toLowerCase();
    const adminKey = String(req.headers["x-admin-key"] || "");
    if (!adminKeyMatches(req)) {
      return res.status(403).json({ success: false, error: "Admin approval/export access is required." });
    }
    const examples = userId
      ? await memory.getTrainingExamples(userId, "approved")
      : await memory.getApprovedTrainingExamples();
    if (format === "jsonl") {
      const body = examples.map((e) => JSON.stringify({
        messages: [
          { role: "user", content: e.userMessage },
          { role: "assistant", content: e.assistantResponse }
        ]
      })).join("\n");
      res.type("application/jsonl");
      return res.status(200).send(body);
    }
    if (format === "alpaca") {
      return res.status(200).json(examples.map((e) => ({
        instruction: e.userMessage,
        input: "",
        output: e.assistantResponse
      })));
    }
    if (format === "openai") {
      return res.status(200).json(examples.map((e) => ({
        messages: [
          { role: "user", content: e.userMessage },
          { role: "assistant", content: e.assistantResponse }
        ]
      })));
    }
    return res.status(400).json({ success: false, error: "format must be jsonl, alpaca, or openai." });
  } catch (error) { return next(error); }
});

router.get("/learning/profile", async (req, res, next) => {
  try {
    const userId = requireAuthenticatedUserId(req, req.query.userId);
    if (!userId) return res.status(400).json({ success: false, error: "userId is required." });
    const user = await memory.findUser(userId);
    if (!user) return res.status(404).json({ success: false, error: "User not found." });
    const profile = await memory.getLearnedProfile(userId);
    const memories = await memory.getLearnedMemories(userId);
    return res.status(200).json({ success: true, userId, profile, memories });
  } catch (error) {
    return next(error);
  }
});

router.get("/learning/memories", async (req, res, next) => {
  try {
    const userId = requireAuthenticatedUserId(req, req.query.userId);
    if (!userId) return res.status(400).json({ success: false, error: "userId is required." });
    const memories = await memory.getLearnedMemories(userId);
    return res.status(200).json({ success: true, userId, memories });
  } catch (error) {
    return next(error);
  }
});

router.delete("/learning/memories/:memoryId", async (req, res, next) => {
  try {
    const userId = normalizeString(req.query.userId);
    const memoryId = normalizeString(req.params.memoryId);
    if (!userId || !memoryId) return res.status(400).json({ success: false, error: "userId and memoryId are required." });
    const deleted = await memory.deleteLearnedMemory(userId, memoryId);
    if (!deleted) return res.status(404).json({ success: false, error: "Learned memory not found." });
    return res.status(200).json({ success: true, memoryId });
  } catch (error) {
    return next(error);
  }
});

router.get("/learning/training", async (req, res, next) => {
  try {
    const userId = requireAuthenticatedUserId(req, req.query.userId);
    const status = normalizeString(req.query.status) || null;
    if (!userId) return res.status(400).json({ success: false, error: "userId is required." });
    const examples = await memory.getTrainingExamples(userId, status);
    return res.status(200).json({ success: true, userId, examples });
  } catch (error) {
    return next(error);
  }
});

router.post("/learning/training/:exampleId/status", async (req, res, next) => {
  try {
    const userId = normalizeString(req.body?.userId);
    const exampleId = normalizeString(req.params.exampleId);
    const status = normalizeString(req.body?.status).toLowerCase();
    const adminKey = String(req.headers["x-admin-key"] || "");
    if (!userId || !exampleId) return res.status(400).json({ success: false, error: "userId and exampleId are required." });
    if (!["pending", "approved", "rejected"].includes(status)) return res.status(400).json({ success: false, error: "status must be pending, approved, or rejected." });
    if (!adminKeyMatches(req)) {
      return res.status(403).json({ success: false, error: "Human/admin approval is required." });
    }
    const example = await memory.setTrainingExampleStatus(userId, exampleId, status);
    if (!example) return res.status(404).json({ success: false, error: "Training example not found." });
    return res.status(200).json({ success: true, example });
  } catch (error) {
    return next(error);
  }
});

router.get("/knowledge", async (req, res, next) => {
  try {
    const data = await knowledge.loadKnowledge();
    return res.status(200).json({ success: true, knowledge: data });
  } catch (error) {
    return next(error);
  }
});

router.post("/terminal", async (req, res, next) => {
  try {
    const userValidation = validateIdentifier(req.authUserId, "userId", MAX_USER_ID_LENGTH);
    if (!userValidation.valid) {
      return res.status(400).json({ success: false, error: userValidation.error });
    }
    const user = await memory.findUser(userValidation.value);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }
    const plan = await memory.getUserPlan(user.id);
    if (plan !== "ultimate") {
      return res.status(403).json({ success: false, error: "Terminal access requires the Ultimate plan." });
    }
    const command = typeof req.body?.command === "string" ? req.body.command : "";
    if (command.length > 500) {
      return res.status(400).json({
        success: false,
        error: "Command too long."
      });
    }
    const result = await terminal.runCommand(command);
    return res.status(200).json({
      success: true,
      output: result.output || "",
      clear: Boolean(result.clear),
      ok: result.success !== false
    });
  } catch (err) {
    return next(err);
  }
});

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error("API error:", err?.message || "Unknown API error");
  return res.status(500).json({
    success: false,
    error: "Internal API error."
  });
});

module.exports = router;
