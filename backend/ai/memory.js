"use strict";

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const CHATS_FILE = path.join(DATA_DIR, "chats.json");
const LEARNED_MEMORIES_FILE = path.join(DATA_DIR, "memories.json");
const TRAINING_FILE = path.join(DATA_DIR, "training_examples.json");
const FILE_ENCODING = "utf8";

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await ensureJsonFile(USERS_FILE, []);
  await ensureJsonFile(CHATS_FILE, []);
  await ensureJsonFile(LEARNED_MEMORIES_FILE, { version: 1, entries: [] });
  await ensureJsonFile(TRAINING_FILE, { version: 1, entries: [] });
}

async function ensureJsonFile(filePath, defaultValue) {
  try {
    await fs.access(filePath);
  } catch {
    await writeJsonFile(filePath, defaultValue);
  }
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const rawData = await fs.readFile(filePath, FILE_ENCODING);
    if (!rawData.trim()) return fallbackValue;
    return JSON.parse(rawData);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON data in ${path.basename(filePath)}.`);
    }
    if (error.code === "ENOENT") return fallbackValue;
    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  const temporaryFile = `${filePath}.tmp`;
  await fs.writeFile(
    temporaryFile,
    JSON.stringify(data, null, 2),
    FILE_ENCODING
  );
  await fs.rename(temporaryFile, filePath);
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function createTimestamp() {
  return new Date().toISOString();
}

async function getUsers() {
  await ensureDataFiles();
  const users = await readJsonFile(USERS_FILE, []);
  if (!Array.isArray(users)) throw new Error("Invalid users.json structure.");
  return users;
}

async function saveUsers(users) {
  if (!Array.isArray(users)) throw new TypeError("Users data must be an array.");
  await writeJsonFile(USERS_FILE, users);
}

async function findUser(userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new TypeError("userId must be a non-empty string.");
  }
  const users = await getUsers();
  return users.find((user) => user.id === userId.trim()) || null;
}

async function getUserPlan(userId) {
  const user = await findUser(userId);
  if (!user) return null;
  const plan = String(user.plan || "free").toLowerCase();
  if (plan === "ultimate") return "ultimate";
  if (plan === "pro") return "pro";
  return "free";
}

async function createUser(userId, metadata = {}) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new TypeError("userId must be a non-empty string.");
  }
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("metadata must be an object.");
  }
  const normalizedUserId = userId.trim();
  const users = await getUsers();
  const existingUser = users.find((user) => user.id === normalizedUserId);
  if (existingUser) return existingUser;

  const timestamp = createTimestamp();
  const user = {
    id: normalizedUserId,
    plan: "free",
    metadata,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  users.push(user);
  await saveUsers(users);
  return user;
}

async function findUserByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  const users = await getUsers();
  return users.find((user) => String(user?.metadata?.email || "").trim().toLowerCase() === normalized) || null;
}

async function updateUserMetadata(userId, metadata) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new TypeError("userId must be a non-empty string.");
  }
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("metadata must be an object.");
  }
  const users = await getUsers();
  const userIndex = users.findIndex((user) => user.id === userId.trim());
  if (userIndex === -1) return null;
  users[userIndex] = {
    ...users[userIndex],
    metadata: { ...(users[userIndex].metadata || {}), ...metadata },
    updatedAt: createTimestamp()
  };
  await saveUsers(users);
  return users[userIndex];
}

async function updateUserPlan(userId, plan) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new TypeError("userId must be a non-empty string.");
  }
  const allowed = ["free", "basic", "pro", "ultimate"];
  if (!allowed.includes(plan)) {
    throw new TypeError("plan must be free, pro, or ultimate.");
  }
  const users = await getUsers();
  const userIndex = users.findIndex((user) => user.id === userId.trim());
  if (userIndex === -1) return null;
  users[userIndex] = {
    ...users[userIndex],
    plan: plan === "basic" ? "free" : plan,
    updatedAt: createTimestamp()
  };
  await saveUsers(users);
  return users[userIndex];
}

async function getChats() {
  await ensureDataFiles();
  const chats = await readJsonFile(CHATS_FILE, []);
  if (!Array.isArray(chats)) throw new Error("Invalid chats.json structure.");
  return chats;
}

async function saveChats(chats) {
  if (!Array.isArray(chats)) throw new TypeError("Chats data must be an array.");
  await writeJsonFile(CHATS_FILE, chats);
}

async function getUserChats(userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new TypeError("userId must be a non-empty string.");
  }
  const chats = await getChats();
  return chats.filter((chat) => chat.userId === userId.trim());
}

async function getChat(userId, chatId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new TypeError("userId must be a non-empty string.");
  }
  if (typeof chatId !== "string" || !chatId.trim()) {
    throw new TypeError("chatId must be a non-empty string.");
  }
  const chats = await getChats();
  return (
    chats.find(
      (chat) => chat.userId === userId.trim() && chat.id === chatId.trim()
    ) || null
  );
}

async function createChat(userId, title = null) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new TypeError("userId must be a non-empty string.");
  }
  const chats = await getChats();
  const timestamp = createTimestamp();
  const chat = {
    id: createId("chat"),
    userId: userId.trim(),
    title:
      typeof title === "string" && title.trim()
        ? title.trim()
        : "New conversation",
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
  chats.push(chat);
  await saveChats(chats);
  return chat;
}

async function addMessage(userId, chatId, role, content) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new TypeError("userId must be a non-empty string.");
  }
  if (typeof chatId !== "string" || !chatId.trim()) {
    throw new TypeError("chatId must be a non-empty string.");
  }
  if (typeof role !== "string" || !role.trim()) {
    throw new TypeError("role must be a non-empty string.");
  }
  if (typeof content !== "string" || !content.trim()) {
    throw new TypeError("content must be a non-empty string.");
  }
  const chats = await getChats();
  const chatIndex = chats.findIndex(
    (chat) => chat.userId === userId.trim() && chat.id === chatId.trim()
  );
  if (chatIndex === -1) return null;
  const message = {
    id: createId("msg"),
    role: role.trim(),
    content: content.trim(),
    createdAt: createTimestamp()
  };
  chats[chatIndex].messages.push(message);
  chats[chatIndex].updatedAt = message.createdAt;
  await saveChats(chats);
  return message;
}

async function getRecentMessages(userId, chatId, limit = 20) {
  const chat = await getChat(userId, chatId);
  if (!chat) return [];
  return chat.messages.slice(-limit);
}

async function getConversationContext(userId, chatId, limit = 20) {
  const messages = await getRecentMessages(userId, chatId, limit);
  return messages.map((message) => ({
    role: message.role,
    content: message.content
  }));
}

async function editUserMessage(userId, chatId, messageId, content) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedChatId = String(chatId || "").trim();
  const normalizedMessageId = String(messageId || "").trim();
  const normalizedContent = String(content || "").trim();
  if (!normalizedUserId || !normalizedChatId || !normalizedMessageId || !normalizedContent) return null;
  const chats = await getChats();
  const chatIndex = chats.findIndex((chat) => chat.userId === normalizedUserId && chat.id === normalizedChatId);
  if (chatIndex === -1) return null;
  const chat = chats[chatIndex];
  const messageIndex = chat.messages.findIndex((message) => message.id === normalizedMessageId);
  if (messageIndex === -1 || chat.messages[messageIndex].role !== "user") return null;
  const timestamp = createTimestamp();
  const editedMessage = { ...chat.messages[messageIndex], content: normalizedContent, editedAt: timestamp };
  chat.messages = chat.messages.slice(0, messageIndex + 1);
  chat.messages[messageIndex] = editedMessage;
  chat.updatedAt = timestamp;
  await saveChats(chats);
  return editedMessage;
}

async function deleteChat(userId, chatId) {
  const chats = await getChats();
  const chatIndex = chats.findIndex(
    (chat) => chat.userId === userId.trim() && chat.id === chatId.trim()
  );
  if (chatIndex === -1) return false;
  chats.splice(chatIndex, 1);
  await saveChats(chats);
  return true;
}


async function loadStructuredFile(filePath, fallbackValue) {
  const data = await readJsonFile(filePath, fallbackValue);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return fallbackValue;
  }
  if (!Array.isArray(data.entries)) data.entries = [];
  return data;
}

async function saveStructuredFile(filePath, data) {
  const payload = {
    version: data.version || 1,
    updatedAt: createTimestamp(),
    entries: Array.isArray(data.entries) ? data.entries : []
  };
  await writeJsonFile(filePath, payload);
  return payload;
}

async function getLearnedMemories(userId) {
  const normalized = String(userId || "").trim();
  if (!normalized) return [];
  await ensureDataFiles();
  const data = await loadStructuredFile(LEARNED_MEMORIES_FILE, { version: 1, entries: [] });
  return data.entries.filter((entry) => entry.userId === normalized);
}

async function findRelevantMemories(userId, query, limit = 8) {
  const memories = await getLearnedMemories(userId);
  const words = String(query || "").toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  if (!words.length) return memories.slice(-limit);
  return memories
    .map((entry) => {
      const text = `${entry.key || ""} ${entry.content || ""} ${(entry.tags || []).join(" ")}`.toLowerCase();
      const score = words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.entry.updatedAt || "").localeCompare(String(a.entry.updatedAt || "")))
    .slice(0, limit)
    .map((item) => item.entry);
}

async function upsertLearnedMemory(userId, memoryInput) {
  const normalized = String(userId || "").trim();
  if (!normalized) throw new TypeError("userId must be a non-empty string.");
  const content = typeof memoryInput?.content === "string" ? memoryInput.content.trim() : "";
  if (!content) throw new TypeError("memory content is required.");
  await ensureDataFiles();
  const data = await loadStructuredFile(LEARNED_MEMORIES_FILE, { version: 1, entries: [] });
  const key = String(memoryInput.key || "memory").trim();
  const type = String(memoryInput.type || "important_memory").trim();
  const existingIndex = data.entries.findIndex((entry) => entry.userId === normalized && entry.key === key && entry.content === content);
  const timestamp = createTimestamp();
  const entry = {
    id: existingIndex >= 0 ? data.entries[existingIndex].id : createId("mem"),
    userId: normalized,
    type,
    key,
    content,
    sourceChatId: memoryInput.sourceChatId || null,
    confidence: Number.isFinite(memoryInput.confidence) ? memoryInput.confidence : 0.8,
    tags: Array.isArray(memoryInput.tags) ? memoryInput.tags.slice(0, 10) : [],
    createdAt: existingIndex >= 0 ? data.entries[existingIndex].createdAt : timestamp,
    updatedAt: timestamp,
    lastUsedAt: existingIndex >= 0 ? data.entries[existingIndex].lastUsedAt || null : null
  };
  if (existingIndex >= 0) data.entries[existingIndex] = entry;
  else data.entries.push(entry);
  await saveStructuredFile(LEARNED_MEMORIES_FILE, data);
  return entry;
}

async function deleteLearnedMemory(userId, memoryId) {
  const normalized = String(userId || "").trim();
  const id = String(memoryId || "").trim();
  if (!normalized || !id) return false;
  const data = await loadStructuredFile(LEARNED_MEMORIES_FILE, { version: 1, entries: [] });
  const before = data.entries.length;
  data.entries = data.entries.filter((entry) => !(entry.userId === normalized && entry.id === id));
  if (data.entries.length === before) return false;
  await saveStructuredFile(LEARNED_MEMORIES_FILE, data);
  return true;
}

async function updateLearnedPreference(userId, key, value) {
  const user = await findUser(userId);
  if (!user) await createUser(userId);
  const current = (await findUser(userId)) || {};
  const metadata = current.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
    ? current.metadata
    : {};
  const learning = metadata.learning && typeof metadata.learning === "object" && !Array.isArray(metadata.learning)
    ? metadata.learning
    : {};
  const preferences = learning.preferences && typeof learning.preferences === "object" && !Array.isArray(learning.preferences)
    ? learning.preferences
    : {};
  preferences[String(key)] = value;
  learning.preferences = preferences;
  learning.updatedAt = createTimestamp();
  metadata.learning = learning;
  return updateUserMetadata(userId, metadata);
}

async function getLearnedProfile(userId) {
  const user = await findUser(userId);
  const metadata = user?.metadata && typeof user.metadata === "object" ? user.metadata : {};
  const learning = metadata.learning && typeof metadata.learning === "object" ? metadata.learning : {};
  return {
    preferences: learning.preferences && typeof learning.preferences === "object" ? learning.preferences : {},
    updatedAt: learning.updatedAt || null
  };
}

function normalizeTrainingText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function trainingFingerprint(userMessage, assistantResponse) {
  return crypto
    .createHash("sha256")
    .update(`${normalizeTrainingText(userMessage)}\n---\n${normalizeTrainingText(assistantResponse)}`)
    .digest("hex");
}

async function getTrainingExamples(userId, status = null) {
  const data = await loadStructuredFile(TRAINING_FILE, { version: 1, entries: [] });
  return data.entries.filter((entry) => entry.userId === String(userId || "").trim() && (!status || entry.status === status));
}

async function createTrainingExample(userId, input) {
  const normalized = String(userId || "").trim();
  if (!normalized) throw new TypeError("userId must be a non-empty string.");
  const userMessage = String(input?.userMessage || "").trim();
  const assistantResponse = String(input?.assistantResponse || "").trim();
  if (!userMessage || !assistantResponse) throw new TypeError("training example messages are required.");
  await ensureDataFiles();
  const data = await loadStructuredFile(TRAINING_FILE, { version: 1, entries: [] });
  const fingerprint = trainingFingerprint(userMessage, assistantResponse);
  const duplicate = data.entries.find((entry) => entry.fingerprint === fingerprint);
  if (duplicate) {
    // Do not return the existing entry: it may belong to another user.
    // Cross-user deduplication therefore never leaks another user's ID/content.
    return {
      id: null,
      status: "duplicate",
      duplicate: true,
      duplicateOf: null
    };
  }

  const quality = input.quality && typeof input.quality === "object" ? input.quality : {};
  const qualityScore = Number.isFinite(quality.score) ? quality.score : 0;
  const qualityReasons = Array.isArray(quality.reasons) ? quality.reasons.slice(0, 20) : [];
  const canPend = qualityScore >= 0.7 && qualityReasons.length === 0;

  const timestamp = createTimestamp();
  const entry = {
    id: createId("train"),
    userId: normalized,
    chatId: input.chatId || null,
    userMessage,
    assistantResponse,
    language: input.language || "en",
    classification: input.classification || "potential_training_example",
    fingerprint,
    quality: {
      score: qualityScore,
      reasons: qualityReasons
    },
    status: canPend ? "pending" : "rejected",
    rejectionReason: canPend ? null : (qualityReasons[0] || "quality_filter"),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  data.entries.push(entry);
  await saveStructuredFile(TRAINING_FILE, data);
  return entry;
}



async function getApprovedTrainingExamples() {
  const data = await loadStructuredFile(TRAINING_FILE, { version: 1, entries: [] });
  return data.entries.filter((entry) => entry.status === "approved");
}
async function setTrainingExampleStatus(userId, exampleId, status) {
  const allowed = ["pending", "approved", "rejected"];
  if (!allowed.includes(status)) throw new TypeError("Invalid training status.");
  const data = await loadStructuredFile(TRAINING_FILE, { version: 1, entries: [] });
  const index = data.entries.findIndex((entry) => entry.userId === String(userId || "").trim() && entry.id === String(exampleId || "").trim());
  if (index === -1) return null;
  data.entries[index] = { ...data.entries[index], status, updatedAt: createTimestamp() };
  await saveStructuredFile(TRAINING_FILE, data);
  return data.entries[index];
}

module.exports = {
  DATA_DIR,
  USERS_FILE,
  CHATS_FILE,
  LEARNED_MEMORIES_FILE,
  TRAINING_FILE,
  ensureDataFiles,
  findUser,
  findUserByEmail,
  getUserPlan,
  createUser,
  updateUserMetadata,
  updateUserPlan,
  getUserChats,
  getChat,
  createChat,
  addMessage,
  getRecentMessages,
  getConversationContext,
  deleteChat,
  editUserMessage,
  getLearnedMemories,
  findRelevantMemories,
  upsertLearnedMemory,
  deleteLearnedMemory,
  updateLearnedPreference,
  getLearnedProfile,
  getTrainingExamples,
  getApprovedTrainingExamples,
  createTrainingExample,
  trainingFingerprint,
  setTrainingExampleStatus
};
