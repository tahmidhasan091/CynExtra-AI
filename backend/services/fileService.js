"use strict";

const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");

const MAX_FILE_BYTES = Number.parseInt(process.env.MAX_FILE_BYTES || String(12 * 1024 * 1024), 10);
const SUPPORTED = new Set([
  "text/plain", "text/csv", "text/markdown", "text/html", "text/css", "text/javascript", "application/javascript", "application/x-javascript", "application/json", "application/xml", "text/xml", "text/yaml", "application/x-yaml", "text/x-python", "text/x-c", "text/x-c++src", "text/x-java-source", "text/sql",
  "image/png", "image/jpeg", "image/webp", "image/gif"
]);
const EXTENSIONS = new Set([".txt", ".csv", ".md", ".markdown", ".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".xml", ".yaml", ".yml", ".py", ".java", ".c", ".h", ".cpp", ".cc", ".hpp", ".sql", ".sh", ".bash", ".env", ".log", ".ini", ".toml", ".conf", ".env.example", ".png", ".jpg", ".jpeg", ".webp", ".gif"]);

const MIME_BY_EXT = Object.freeze({
  ".txt":"text/plain", ".csv":"text/csv", ".md":"text/markdown", ".markdown":"text/markdown",
  ".html":"text/html", ".htm":"text/html", ".css":"text/css", ".js":"text/javascript", ".mjs":"text/javascript", ".cjs":"text/javascript",
  ".ts":"text/javascript", ".tsx":"text/javascript", ".jsx":"text/javascript", ".json":"application/json", ".xml":"application/xml",
  ".yaml":"text/yaml", ".yml":"text/yaml", ".py":"text/x-python", ".java":"text/x-java-source", ".c":"text/x-c", ".h":"text/x-c",
  ".cpp":"text/x-c++src", ".cc":"text/x-c++src", ".hpp":"text/x-c++src", ".sql":"text/sql", ".sh":"text/plain", ".bash":"text/plain",
  ".env":"text/plain", ".log":"text/plain", ".ini":"text/plain", ".toml":"text/plain", ".conf":"text/plain"
});
const STORAGE_ROOT = path.join(__dirname, "..", "data", "uploads");

function processBase64File({ name, mimeType, data }) {
  const safeName = path.basename(String(name || "")).slice(0, 180);
  let mime = String(mimeType || "").toLowerCase().trim();
  const ext = path.extname(safeName).toLowerCase();
  if (!SUPPORTED.has(mime) && MIME_BY_EXT[ext]) mime = MIME_BY_EXT[ext];
  const raw = String(data || "");
  if (!safeName || !raw) throw new Error("name, mimeType and base64 data are required.");
  if (!SUPPORTED.has(mime) || !EXTENSIONS.has(path.extname(safeName).toLowerCase())) {
    throw new Error("Unsupported file type. Supported: common text/code files, JSON/CSV/YAML/XML and common images.");
  }
  const buffer = Buffer.from(raw.replace(/^data:[^;]+;base64,/, ""), "base64");
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new Error("File is empty or exceeds the configured size limit.");

  if (mime.startsWith("image/")) {
    return { name: safeName, mimeType: mime, size: buffer.length, kind: "image", text: null };
  }
  let text = buffer.toString("utf8");
  // Never pass obvious credential values into model context. Keep the file useful for debugging while redacting secrets.
  if (ext === ".env" || ext === ".env.example" || /secret|token|api[_-]?key|password/i.test(text)) {
    text = text.replace(/(^|\n)(\s*[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PRIVATE[_-]?KEY)[A-Z0-9_]*\s*=\s*)([^\n#]*)/gmi, "$1$2[REDACTED]");
  }
  return { name: safeName, mimeType: mime, size: buffer.length, kind: "text", text: text.slice(0, 50000) };
}


async function storeProcessedFile(userId, processed, originalBuffer) {
  const uid = String(userId || "").trim();
  if (!uid || !processed?.name || !Buffer.isBuffer(originalBuffer)) {
    throw new Error("Invalid stored file.");
  }
  const safeUser = crypto.createHash("sha256").update(uid).digest("hex");
  const userDir = path.join(STORAGE_ROOT, safeUser);
  await fs.mkdir(userDir, { recursive: true });
  const ext = path.extname(processed.name).toLowerCase();
  const storedName = `${crypto.randomUUID()}${ext}`;
  const destination = path.join(userDir, storedName);
  await fs.writeFile(destination, originalBuffer, { flag: "wx" });
  return {
    id: crypto.randomUUID(),
    userId: uid,
    name: processed.name,
    mimeType: processed.mimeType,
    size: processed.size,
    kind: processed.kind,
    storedName,
    createdAt: new Date().toISOString()
  };
}

function decodeBase64(data) {
  const raw = String(data || "").replace(/^data:[^;]+;base64,/, "");
  return Buffer.from(raw, "base64");
}

module.exports = { MAX_FILE_BYTES, processBase64File, storeProcessedFile, decodeBase64 };
