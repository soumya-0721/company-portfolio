"use strict";

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const LEADS_FILE = path.join(DATA_DIR, "leads.jsonl");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;

loadEnvFile(path.join(ROOT, ".env"));

const IP_SALT = process.env.IP_HASH_SALT || crypto.randomBytes(24).toString("hex");
const TRUST_PROXY = process.env.TRUST_PROXY === "1";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".pdf": "application/pdf"
};

const COMPRESSIBLE_EXTENSIONS = new Set([
  ".html",
  ".css",
  ".js",
  ".json",
  ".webmanifest",
  ".xml",
  ".txt",
  ".svg"
]);

const BLOCKED_PREFIXES = [
  "/data/",
  "/scripts/",
  "/node_modules/",
  "/.git/"
];

const BLOCKED_FILES = new Set([
  "/server.js",
  "/package.json",
  "/package-lock.json",
  "/.env",
  "/.env.example"
]);

const FORM_TYPES = new Set(["general", "organic", "it", "partnership"]);

const ALLOWED_FIELDS = new Set([
  "name",
  "email",
  "phone",
  "company",
  "role",
  "location",
  "website",
  "service",
  "budget",
  "timeline",
  "category",
  "product",
  "quantity",
  "enquiry_type",
  "partnership_type",
  "message",
  "page"
]);

const rateBuckets = new Map();

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = requestUrl.pathname;

    setSecurityHeaders(req, res);

    if (pathname === "/api/health") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return sendJson(res, 405, { ok: false, error: "Method not allowed." }, { Allow: "GET, HEAD" });
      }
      return sendJson(res, 200, {
        ok: true,
        service: "next360-site",
        uptimeSeconds: Math.round(process.uptime())
      });
    }

    if (pathname === "/api/enquiry" || pathname === "/api/enquiry/") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { Allow: "POST, OPTIONS" });
        return res.end();
      }
      if (req.method !== "POST") {
        return sendJson(res, 405, { ok: false, error: "Method not allowed." }, { Allow: "POST, OPTIONS" });
      }
      return handleEnquiry(req, res);
    }

    if (pathname.startsWith("/api/")) {
      return sendJson(res, 404, { ok: false, error: "API route not found." });
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendText(res, 405, "Method not allowed.", { Allow: "GET, HEAD" });
    }

    if (pathname === "/favicon.ico") {
      res.writeHead(302, { Location: "/assets/img/favicon.png" });
      return res.end();
    }

    return serveStatic(req, res, pathname);
  } catch (error) {
    console.error("Unhandled request error:", error);
    if (!res.headersSent) {
      setSecurityHeaders(req, res);
      sendJson(res, 500, { ok: false, error: "Something went wrong. Please try again." });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`NEXT360 site running at http://localhost:${PORT}`);
  console.log(`Lead storage: ${LEADS_FILE}`);
  if (!process.env.IP_HASH_SALT) {
    console.warn("IP_HASH_SALT is not set. A random salt will be used for this process only.");
  }
  if (!process.env.ENQUIRY_WEBHOOK_URL) {
    console.log("No ENQUIRY_WEBHOOK_URL configured. Enquiries will be stored locally only.");
  }
});

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, () => {
    console.log(`\nReceived ${signal}. Shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
});

/* --------------------------------------------------------------------------
   Enquiry API
   -------------------------------------------------------------------------- */

async function handleEnquiry(req, res) {
  const contentType = (req.headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return sendJson(res, 415, { ok: false, error: "Please submit the form as JSON." });
  }

  const ip = clientIp(req);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return sendJson(
      res,
      429,
      { ok: false, error: "Too many enquiries from this connection. Please try again later." },
      { "Retry-After": String(limit.retryAfterSeconds) }
    );
  }

  let rawBody;
  try {
    rawBody = await readBody(req, MAX_BODY_BYTES);
  } catch (error) {
    if (error.code === "BODY_TOO_LARGE") {
      return sendJson(res, 413, { ok: false, error: "The enquiry is too large." });
    }
    return sendJson(res, 400, { ok: false, error: "Could not read the enquiry." });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: "Invalid JSON in the enquiry." });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return sendJson(res, 400, { ok: false, error: "Invalid enquiry format." });
  }

  if (typeof payload._gotcha === "string" && payload._gotcha.trim() !== "") {
    return sendJson(res, 200, {
      ok: true,
      message: "Thank you. Your enquiry has been received."
    });
  }

  const formType = FORM_TYPES.has(payload.formType) ? payload.formType : "general";
  const fields = sanitizeFields(payload);
  const errors = validateEnquiry(fields, formType);

  if (errors.length > 0) {
    return sendJson(res, 422, {
      ok: false,
      error: errors[0],
      fields: errors
    });
  }

  const entry = {
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    formType,
    fields,
    utm: sanitizeUtm(payload.utm),
    ipHash: hashIp(ip),
    userAgent: truncate(cleanString(req.headers["user-agent"] || ""), 300)
  };

  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.appendFile(LEADS_FILE, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    console.error("Could not save enquiry:", error);
    return sendJson(res, 500, {
      ok: false,
      error: "Your enquiry could not be saved. Please try again or contact us directly."
    });
  }

  notifyWebhook(entry).catch((error) => {
    console.error("Enquiry webhook failed:", error.message);
  });

  return sendJson(res, 201, {
    ok: true,
    id: entry.id,
    message: "Thank you. Your enquiry has been received and will be reviewed by the relevant team."
  });
}

function sanitizeFields(payload) {
  const fields = {};
  for (const key of ALLOWED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    const value = payload[key];
    if (typeof value === "string") {
      const cleaned = truncate(cleanString(value), key === "message" ? 6000 : 500);
      if (cleaned !== "") fields[key] = cleaned;
    } else if (typeof value === "number" || typeof value === "boolean") {
      fields[key] = value;
    }
  }
  fields.consent = payload.consent === true || payload.consent === "true" || payload.consent === "on";
  return fields;
}

function validateEnquiry(fields, formType) {
  const errors = [];

  if (!fields.name || fields.name.length < 2) {
    errors.push("Please provide your name.");
  }

  if (!fields.message || fields.message.length < 5) {
    errors.push("Please include a short message about your enquiry.");
  }

  if (!fields.consent) {
    errors.push("Please agree to be contacted about your enquiry.");
  }

  const emailProvided = Boolean(fields.email);
  const phoneProvided = Boolean(fields.phone);

  if (!emailProvided && !phoneProvided) {
    errors.push("Please provide an email address or phone number.");
  }

  if (emailProvided && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(fields.email)) {
    errors.push("Please provide a valid email address.");
  }

  if (phoneProvided) {
    const digits = fields.phone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
      errors.push("Please provide a valid phone number.");
    }
  }

  if (fields.website) {
    try {
      const url = new URL(fields.website);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        errors.push("Please provide a valid website URL.");
      }
    } catch (error) {
      errors.push("Please provide a valid website URL.");
    }
  }

  if (formType === "it" && !fields.service) {
    errors.push("Please select the service you are interested in.");
  }

  if (formType === "partnership" && !fields.partnership_type) {
    errors.push("Please select a partnership type.");
  }

  if (formType === "partnership" && !fields.company) {
    errors.push("Please provide your organisation name.");
  }

  return errors;
}

function sanitizeUtm(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = ["source", "medium", "campaign", "term", "content"];
  const clean = {};
  for (const key of allowed) {
    if (typeof value[key] === "string" && value[key].trim() !== "") {
      clean[key] = truncate(cleanString(value[key]), 200);
    }
  }
  return clean;
}

async function notifyWebhook(entry) {
  const url = process.env.ENQUIRY_WEBHOOK_URL;
  if (!url) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const headers = { "Content-Type": "application/json" };
    if (process.env.ENQUIRY_WEBHOOK_SECRET) {
      headers["X-NEXT360-Secret"] = process.env.ENQUIRY_WEBHOOK_SECRET;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(entry),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Webhook responded with ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    return { allowed: true };
  }

  bucket.count += 1;

  if (bucket.count > RATE_MAX) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.start + RATE_WINDOW_MS - now) / 1000))
    };
  }

  return { allowed: true };
}

setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [ip, bucket] of rateBuckets) {
    if (bucket.start < cutoff) rateBuckets.delete(ip);
  }
}, RATE_WINDOW_MS).unref();

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const error = new Error("Body too large");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/* --------------------------------------------------------------------------
   Static files
   -------------------------------------------------------------------------- */

async function serveStatic(req, res, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch (error) {
    return sendText(res, 400, "Bad request.");
  }

  if (decodedPath.includes("\0")) {
    return sendText(res, 400, "Bad request.");
  }

  if (isBlockedPath(decodedPath)) {
    return serveNotFound(req, res);
  }

  let relativePath = decodedPath.replace(/^\/+/, "");
  if (relativePath === "" || relativePath.endsWith("/")) {
    relativePath += "index.html";
  }

  let filePath = path.resolve(ROOT, relativePath);

  if (!isInsideRoot(filePath)) {
    return sendText(res, 403, "Forbidden.");
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch (error) {
    if (!path.extname(filePath)) {
      return serveHtmlCandidate(req, res, `${filePath}.html`);
    }
    return serveNotFound(req, res);
  }

  if (stat.isDirectory()) {
    return serveHtmlCandidate(req, res, path.join(filePath, "index.html"));
  }

  if (!stat.isFile()) {
    return serveNotFound(req, res);
  }

  return sendFile(req, res, filePath, stat);
}

async function serveHtmlCandidate(req, res, candidatePath) {
  if (!isInsideRoot(candidatePath)) {
    return serveNotFound(req, res);
  }

  try {
    const stat = await fsp.stat(candidatePath);
    if (stat.isFile()) return sendFile(req, res, candidatePath, stat);
  } catch (error) {
    // Fall through to 404.
  }

  return serveNotFound(req, res);
}

async function sendFile(req, res, filePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;

  res.setHeader("Content-Type", contentType);
  res.setHeader("ETag", etag);

  if (ext === ".html") {
    res.setHeader("Cache-Control", "no-cache");
  } else {
    res.setHeader("Cache-Control", "public, max-age=3600");
  }

  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304);
    return res.end();
  }

  let body;
  try {
    body = await fsp.readFile(filePath);
  } catch (error) {
    console.error("Could not read file:", error);
    return sendText(res, 500, "Could not load this file.");
  }

  if (COMPRESSIBLE_EXTENSIONS.has(ext) && body.length > 1024) {
    const accepted = String(req.headers["accept-encoding"] || "");
    if (accepted.includes("gzip")) {
      body = zlib.gzipSync(body, { level: 6 });
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Vary", "Accept-Encoding");
    }
  }

  res.setHeader("Content-Length", body.length);

  if (req.method === "HEAD") {
    res.writeHead(200);
    return res.end();
  }

  res.writeHead(200);
  return res.end(body);
}

async function serveNotFound(req, res) {
  const notFoundPath = path.join(ROOT, "404.html");
  try {
    const body = await fsp.readFile(notFoundPath);
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", body.length);
    if (req.method === "HEAD") return res.end();
    return res.end(body);
  } catch (error) {
    return sendText(res, 404, "Page not found.");
  }
}

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */

function setSecurityHeaders(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "script-src 'self' https://www.googletagmanager.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://*.google-analytics.com https://www.googletagmanager.com",
      "connect-src 'self' https://*.google-analytics.com https://www.googletagmanager.com",
      "frame-src https://www.google.com https://maps.google.com https://www.google.co.in"
    ].join("; ")
  );

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  if (req.socket.encrypted || forwardedProto === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function sendJson(res, status, payload, extraHeaders) {
  const body = Buffer.from(JSON.stringify(payload));
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", body.length);
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      res.setHeader(key, value);
    }
  }
  res.end(body);
}

function sendText(res, status, message, extraHeaders) {
  const body = Buffer.from(message);
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", body.length);
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      res.setHeader(key, value);
    }
  }
  res.end(body);
}

function isBlockedPath(pathname) {
  const normalized = pathname.replace(/\\/g, "/");
  if (BLOCKED_FILES.has(normalized)) return true;
  if (BLOCKED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  return normalized
    .split("/")
    .filter(Boolean)
    .some((segment) => segment.startsWith("."));
}

function isInsideRoot(filePath) {
  const relative = path.relative(ROOT, filePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || "unknown";
}

function hashIp(ip) {
  return crypto.createHash("sha256").update(`${IP_SALT}:${ip}`).digest("hex").slice(0, 16);
}

function cleanString(value) {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

function truncate(value, maxLength) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function loadEnvFile(filePath) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
