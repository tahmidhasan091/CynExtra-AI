"use strict";

const memory = require("./memory");

const MAX_MEMORY_CONTENT = 1200;
const MAX_TRAINING_CONTENT = 6000;
const MIN_TRAINING_USER = 8;
const MIN_TRAINING_ASSISTANT = 20;

const LANGUAGE_PATTERNS = [
  { code: "bn", name: "Bengali", pattern: /[\u0980-\u09FF]/g },
  { code: "ar", name: "Arabic", pattern: /[\u0600-\u06FF]/g },
  { code: "zh", name: "Chinese", pattern: /[\u4E00-\u9FFF]/g },
  { code: "ja", name: "Japanese", pattern: /[\u3040-\u30FF]/g },
  { code: "ru", name: "Russian", pattern: /[\u0400-\u04FF]/g }
];

const LANGUAGE_WORDS = {
  en: ["the", "and", "you", "please", "what", "how", "why", "is", "are", "only", "reply", "answer"],
  es: ["el", "la", "los", "las", "que", "como", "por", "para", "solo", "responde", "respuesta"],
  fr: ["le", "la", "les", "que", "comment", "pour", "avec", "seulement", "réponds"],
  de: ["der", "die", "das", "und", "wie", "für", "nur", "antworte"],
  pt: ["o", "a", "os", "as", "que", "como", "para", "somente", "responda"],
  it: ["il", "lo", "la", "che", "come", "per", "solo", "rispondi"]
};

const LANGUAGE_NAMES = {
  bn: "Bengali", en: "English", es: "Spanish", ar: "Arabic", zh: "Chinese",
  ja: "Japanese", fr: "French", de: "German", pt: "Portuguese", it: "Italian", ru: "Russian"
};

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}

function detectLanguage(text) {
  const value = normalize(text);
  if (!value) return { code: "en", name: "English", confidence: 0 };

  const scriptScores = LANGUAGE_PATTERNS.map((item) => ({
    ...item,
    score: (value.match(item.pattern) || []).length
  })).sort((a, b) => b.score - a.score);

  if (scriptScores[0]?.score > 0) {
    const letters = (value.match(/[\p{L}]/gu) || []).length || 1;
    const confidence = Math.min(1, scriptScores[0].score / Math.max(letters * 0.55, 1));
    return {
      code: scriptScores[0].code,
      name: scriptScores[0].name,
      confidence: Number(confidence.toFixed(2))
    };
  }

  const words = value.toLowerCase().match(/[a-zÀ-ÿ]+/g) || [];
  const scores = Object.entries(LANGUAGE_WORDS).map(([code, dictionary]) => ({
    code,
    score: words.reduce((sum, word) => sum + (dictionary.includes(word) ? 1 : 0), 0)
  })).sort((a, b) => b.score - a.score);

  const top = scores[0];
  const second = scores[1];
  if (!top || top.score === 0) return { code: "en", name: "English", confidence: 0.45 };

  const confidence = Math.min(
    0.98,
    0.55 + (top.score / Math.max(words.length, 1)) * 0.7 +
      (top.score > (second?.score || 0) ? 0.15 : 0)
  );

  return {
    code: top.code,
    name: LANGUAGE_NAMES[top.code] || top.code,
    confidence: Number(confidence.toFixed(2))
  };
}

/*
 * Conservative secret/private-data filter.
 * This is deliberately broader than a few English-only examples because
 * training data must never contain credentials or obvious authentication data.
 */
function isSensitive(text) {
  const value = normalize(text);
  if (!value) return false;
  const patterns = [
    /password\s*[:=]/i,
    /passcode\s*[:=]/i,
    /api[_ -]?key\s*[:=]/i,
    /secret\s*[:=]/i,
    /token\s*[:=]/i,
    /bearer\s+[a-z0-9._-]{20,}/i,
    /sk-[a-z0-9_-]{16,}/i,
    /ghp_[a-z0-9]{20,}/i,
    /xox[baprs]-[a-z0-9-]{10,}/i,
    /-----begin [a-z0-9 ]*private key-----/i,
    /credit\s*card/i,
    /card\s*number/i,
    /\bcvv\b/i,
    /bank\s*account/i,
    /private\s*key/i,
    /\botp\s*[:=]/i,
    /one[- ]time\s+password/i,
    /authorization\s*[:=]\s*bearer/i,
    /\b(?:ssn|national id|nid)\s*[:=]/i
  ];
  return patterns.some((pattern) => pattern.test(value));
}

function hasPromptInjection(text) {
  const value = normalize(text).toLowerCase();
  if (!value) return false;
  return [
    /ignore\s+(all\s+)?previous\s+(instructions|messages)/i,
    /ignore\s+(the\s+)?system\s+(prompt|message)/i,
    /disregard\s+(all\s+)?previous/i,
    /reveal\s+(the\s+)?system\s+prompt/i,
    /show\s+(me\s+)?your\s+(hidden\s+)?instructions/i,
    /you\s+are\s+now\s+(a\s+)?system/i,
    /developer\s+message\s*:/i,
    /জ্ঞান.*উপেক্ষা.*নির্দেশ/i,
    /আগের.*নির্দেশ.*উপেক্ষা/i
  ].some((pattern) => pattern.test(value));
}

function truncate(value, max = MAX_MEMORY_CONTENT) {
  const text = normalize(value);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function extractPreference(text) {
  const value = normalize(text);
  if (!value || isSensitive(value)) return null;

  const patterns = [
    { regex: /(?:আমি|i)\s+(?:বাংলা|bangla|bengali)(?:তে|য়|য়)?\s+(?:লিখলে|write|লিখি).*?(?:শুধু|only)\s+(?:বাংলা|bangla|bengali)(?:তে|য়|in)?\s+(?:উত্তর|reply|respond)/i, key: "language_preference", value: "bn" },
    { regex: /(?:reply|respond|answer)\s+(?:only\s+)?in\s+english/i, key: "language_preference", value: "en" },
    { regex: /(?:reply|respond|answer)\s+(?:only\s+)?in\s+spanish/i, key: "language_preference", value: "es" },
    { regex: /(?:reply|respond|answer)\s+(?:only\s+)?in\s+arabic/i, key: "language_preference", value: "ar" },
    { regex: /(?:reply|respond|answer)\s+(?:only\s+)?in\s+chinese/i, key: "language_preference", value: "zh" },
    { regex: /(?:reply|respond|answer)\s+(?:only\s+)?in\s+japanese/i, key: "language_preference", value: "ja" },
    { regex: /(?:বাংলায়|বাংলাতে|বাংলা ভাষায়)\s+(?:উত্তর|জবাব)\s+দাও/i, key: "language_preference", value: "bn" },
    { regex: /(?:আমি|i)\s+(?:সবসময়|always)\s+(?:বাংলায়|বাংলাতে|bangla|bengali)\s+(?:উত্তর|reply|respond)\s+(?:চাই|want|please)/i, key: "language_preference", value: "bn" },
    { regex: /(?:ইংরেজিতে|ইংরেজি ভাষায়)\s+(?:উত্তর|জবাব)\s+দাও/i, key: "language_preference", value: "en" },
    { regex: /(?:অনুবাদ|translation).*?(?:চাই না|করো না|করবেন না)/i, key: "translation_unless_requested", value: false },
    { regex: /(?:no|don't|do not)\s+(?:add|include|give)\s+(?:a\s+)?translation\s+unless\s+i\s+ask/i, key: "translation_unless_requested", value: false }
  ];

  for (const item of patterns) {
    if (item.regex.test(value)) return { key: item.key, value: item.value };
  }
  return null;
}

function extractExplicitMemory(text) {
  const value = normalize(text);
  if (!value || isSensitive(value) || hasPromptInjection(value)) return null;
  const patterns = [
    /^(?:remember(?:\s+that)?|please remember|মনে রাখ(?:বে|ো)|মনে রেখো|গুরুত্বপূর্ণ তথ্য)\s*[:,-]?\s*(.+)$/i,
    /^(?:important|important information)\s*[:,-]\s*(.+)$/i
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return truncate(match[1]);
  }
  return null;
}

function extractUsefulKnowledge(text) {
  const value = normalize(text);
  if (!value || isSensitive(value) || hasPromptInjection(value)) return null;
  const patterns = [
    /^(?:for this project|in this project|for cynextra-ai|in cynextra-ai)\s*[:,-]?\s*(.+)$/i,
    /^(?:এই প্রজেক্টে|এই প্রজেক্টের জন্য|CynExtra-AI-তে|CynExtra-AI-এর জন্য)\s*[:,-]?\s*(.+)$/i
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return truncate(match[1]);
  }
  return null;
}

function classifyExchange({ userMessage, assistantResponse }) {
  const user = normalize(userMessage);
  const assistant = normalize(assistantResponse);
  const language = detectLanguage(user);
  const preference = extractPreference(user);
  const explicitMemory = extractExplicitMemory(user);
  const usefulKnowledge = extractUsefulKnowledge(user);

  if (!user || !assistant) {
    return { category: "ignore", confidence: 1, language, reason: "empty_exchange" };
  }
  if (isSensitive(user) || isSensitive(assistant)) {
    return { category: "ignore", confidence: 1, language, reason: "sensitive_data" };
  }
  if (hasPromptInjection(user) || hasPromptInjection(assistant)) {
    return { category: "ignore", confidence: 0.99, language, reason: "prompt_injection" };
  }
  if (preference) {
    return { category: "user_preference", confidence: 0.98, language, key: preference.key };
  }
  if (explicitMemory) {
    return { category: "important_memory", confidence: 0.98, language };
  }
  if (usefulKnowledge) {
    return { category: "useful_knowledge", confidence: 0.92, language };
  }
  if (isPotentialTrainingExample(user, assistant)) {
    return { category: "potential_training_example", confidence: 0.7, language };
  }
  if (user.length >= 12 && assistant.length >= 20) {
    return { category: "conversation_context", confidence: 0.65, language };
  }
  return { category: "ignore", confidence: 0.8, language, reason: "casual_or_low_signal" };
}

function qualityCheck(userMessage, assistantResponse) {
  const user = normalize(userMessage);
  const assistant = normalize(assistantResponse);
  const reasons = [];
  let score = 1;

  if (user.length < MIN_TRAINING_USER) { score -= 0.25; reasons.push("short_prompt"); }
  if (assistant.length < MIN_TRAINING_ASSISTANT) { score -= 0.25; reasons.push("short_response"); }
  if (user.length > MAX_TRAINING_CONTENT || assistant.length > MAX_TRAINING_CONTENT) {
    score -= 0.3; reasons.push("too_long");
  }
  if (isSensitive(user) || isSensitive(assistant)) { score = 0; reasons.push("sensitive_data"); }
  if (hasPromptInjection(user) || hasPromptInjection(assistant)) { score = 0; reasons.push("prompt_injection"); }
  if (/^(hi|hello|hey|ok|okay|thanks|thank you|হাই|হ্যালো|ধন্যবাদ)[.!?\s]*$/i.test(user)) {
    score = Math.min(score, 0.15); reasons.push("casual_chat");
  }
  if (/^(.)\1{12,}$/s.test(user) || /^(.)\1{12,}$/s.test(assistant)) {
    score = Math.min(score, 0.1); reasons.push("spam");
  }
  if (!/[.!?。！？।]$/.test(assistant) && assistant.length < 40) {
    score -= 0.05; reasons.push("possibly_incomplete_response");
  }

  score = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  const approvedForPending = score >= 0.7 && reasons.length === 0;
  return { score, approvedForPending, reasons };
}

function isPotentialTrainingExample(userMessage, assistantResponse) {
  const user = normalize(userMessage);
  const assistant = normalize(assistantResponse);
  if (!user || !assistant) return false;
  if (user.length < MIN_TRAINING_USER || assistant.length < MIN_TRAINING_ASSISTANT) return false;
  if (user.length > MAX_TRAINING_CONTENT || assistant.length > MAX_TRAINING_CONTENT) return false;
  if (isSensitive(user) || isSensitive(assistant)) return false;
  if (hasPromptInjection(user) || hasPromptInjection(assistant)) return false;
  if (/^(?:hi|hello|hey|ok|okay|thanks|thank you|হাই|হ্যালো|ধন্যবাদ)[.!?\s]*$/i.test(user)) return false;
  const taskSignal = /[?؟?]|\b(explain|teach|solve|calculate|write|translate|summarize|compare|how|why|what|code|debug|example|lesson|quiz|শেখাও|ব্যাখ্যা|কেন|কীভাবে|সমাধান|উদাহরণ|প্রশ্ন)\b/i.test(user);
  return taskSignal;
}

async function learnFromExchange({ userId, chatId, userMessage, assistantResponse }) {
  const user = normalize(userId);
  const userText = normalize(userMessage);
  const assistantText = normalize(assistantResponse);
  if (!user || !userText || !assistantText) {
    return { saved: [], trainingCandidate: null, classification: "ignore" };
  }

  const saved = [];
  const classification = classifyExchange({ userMessage: userText, assistantResponse: assistantText });
  const language = classification.language;

  const preference = extractPreference(userText);
  if (preference) {
    await memory.updateLearnedPreference(user, preference.key, preference.value);
    saved.push({ type: "user_preference", key: preference.key });
  } else if (language.confidence >= 0.8 && !hasPromptInjection(userText)) {
    await memory.updateLearnedPreference(user, "detected_language", language.code);
    saved.push({ type: "user_preference", key: "detected_language", value: language.code });
  }

  const explicitMemory = extractExplicitMemory(userText);
  const usefulKnowledge = explicitMemory ? null : extractUsefulKnowledge(userText);

  if (explicitMemory) {
    const entry = await memory.upsertLearnedMemory(user, {
      type: "important_memory",
      key: "explicit_user_memory",
      content: explicitMemory,
      sourceChatId: chatId,
      confidence: 0.98,
      tags: ["explicit"]
    });
    saved.push({ type: "important_memory", id: entry.id });
  }

  if (usefulKnowledge) {
    const entry = await memory.upsertLearnedMemory(user, {
      type: "useful_knowledge",
      key: "project_knowledge",
      content: usefulKnowledge,
      sourceChatId: chatId,
      confidence: 0.9,
      tags: ["project"]
    });
    saved.push({ type: "useful_knowledge", id: entry.id });
  }

  const quality = qualityCheck(userText, assistantText);
  let trainingCandidate = null;

  if (classification.category === "potential_training_example") {
    trainingCandidate = await memory.createTrainingExample(user, {
      chatId,
      userMessage: userText,
      assistantResponse: assistantText,
      language: language.code,
      classification: classification.category,
      quality
    });
  } else if (quality.approvedForPending && classification.category === "conversation_context") {
    // Do not automatically turn ordinary context into a training example.
    trainingCandidate = null;
  }

  return {
    saved,
    language,
    classification,
    quality,
    trainingCandidate
  };
}

function buildMemoryContext(memories) {
  if (!Array.isArray(memories) || !memories.length) return "";
  return memories
    .map((item) => `[Memory: ${item.type}] ${item.content}`)
    .join("\n");
}

module.exports = {
  detectLanguage,
  isSensitive,
  hasPromptInjection,
  extractPreference,
  extractExplicitMemory,
  extractUsefulKnowledge,
  classifyExchange,
  qualityCheck,
  isPotentialTrainingExample,
  learnFromExchange,
  buildMemoryContext
};
