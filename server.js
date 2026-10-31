"use strict";

const http = require("http");
const fsp = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const net = require("net");
const tls = require("tls");
const leadStore = require("./lib/lead-store");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_NOTIFICATION_EMAIL = "office@next360.in";

const IP_SALT = process.env.IP_HASH_SALT || crypto.randomBytes(24).toString("hex");
const TRUST_PROXY = process.env.TRUST_PROXY === "1" || process.env.VERCEL === "1";

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
  "/vercel.json",
  "/.env",
  "/.env.example"
]);

const BLOCKED_EXTENSIONS = new Set([
  ".csv",
  ".jsonl",
  ".xlsx",
  ".xls",
  ".log"
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
const recentEnquiries = new Map();

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

server.requestTimeout = 15000;
server.headersTimeout = 10000;

server.listen(PORT, HOST, () => {
  console.log(`NEXT360 site running at http://localhost:${PORT}`);
  console.log(`Lead storage: ${leadStore.storageDescription()}`);
  if (process.env.VERCEL === "1" && !leadStore.getRedisConfig()) {
    console.warn(
      "Vercel detected without Redis. Local file storage is not persistent on serverless hosting."
    );
  }
  if (!process.env.IP_HASH_SALT) {
    console.warn("IP_HASH_SALT is not set. A random salt will be used for this process only.");
  }
  if (!process.env.ENQUIRY_WEBHOOK_URL) {
    console.log("No ENQUIRY_WEBHOOK_URL configured.");
  }
  if (process.env.SMTP_HOST) {
    console.log(
      `Enquiry email notifications: ${process.env.ENQUIRY_NOTIFICATION_EMAIL || DEFAULT_NOTIFICATION_EMAIL}`
    );
  } else {
    console.log("No SMTP_HOST configured. Enquiry email notifications are disabled.");
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

  const fingerprint = enquiryFingerprint(fields, formType);
  const duplicate = findDuplicate(fingerprint);
  if (duplicate) {
    return sendJson(res, 200, {
      ok: true,
      id: duplicate.id,
      duplicate: true,
      message: "This enquiry was already received. Our team will review it shortly."
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
    await leadStore.appendLead(entry);
    rememberEnquiry(fingerprint, entry.id);
  } catch (error) {
    console.error("Could not save enquiry:", error);
    return sendJson(res, 500, {
      ok: false,
      error: "Your enquiry could not be saved. Please try again or contact us directly."
    });
  }

  notifyEmail(entry).catch((error) => {
    console.error("Enquiry email notification failed:", error.message);
  });

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

/* --------------------------------------------------------------------------
   Internal email notification (optional SMTP, zero dependencies)
   -------------------------------------------------------------------------- */

async function notifyEmail(entry) {
  const host = process.env.SMTP_HOST;
  if (!host) return;

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = /^(1|true|yes)$/i.test(process.env.SMTP_SECURE || "") || port === 465;
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const from = process.env.SMTP_FROM || user || DEFAULT_NOTIFICATION_EMAIL;
  const to = process.env.ENQUIRY_NOTIFICATION_EMAIL || DEFAULT_NOTIFICATION_EMAIL;

  await sendSmtpMail({
    host,
    port,
    secure,
    user,
    pass,
    from,
    to,
    replyTo: entry.fields.email || "",
    subject: `New ${entry.formType} enquiry from ${entry.fields.name}`,
    body: formatEnquiryEmail(entry)
  });
}

function formatEnquiryEmail(entry) {
  const labels = {
    name: "Name",
    email: "Email",
    phone: "Phone",
    company: "Company",
    role: "Role",
    location: "Location",
    website: "Website",
    service: "Service",
    budget: "Budget",
    timeline: "Timeline",
    category: "Category",
    product: "Product",
    quantity: "Quantity",
    enquiry_type: "Enquiry type",
    partnership_type: "Partnership type"
  };

  const lines = [
    "A new enquiry was submitted on the NEXT360 website.",
    "",
    `Reference: ${entry.id}`,
    `Received: ${entry.receivedAt}`,
    `Form type: ${entry.formType}`,
    `Page: ${entry.fields.page || "Not provided"}`,
    "",
    "Customer details"
  ];

  for (const [key, label] of Object.entries(labels)) {
    if (entry.fields[key]) lines.push(`${label}: ${entry.fields[key]}`);
  }

  lines.push("", "Message", entry.fields.message || "(No message provided)");
  lines.push("", `Consent to be contacted: ${entry.fields.consent ? "Yes" : "No"}`);

  const utm = Object.entries(entry.utm || {})
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  if (utm) lines.push(`Campaign: ${utm}`);

  return lines.join("\n");
}

function sendSmtpMail(options) {
  return new Promise((resolve, reject) => {
    let socket = options.secure
      ? tls.connect({ host: options.host, port: options.port, servername: options.host })
      : net.connect({ host: options.host, port: options.port });
    let read = createLineReader(socket);
    let settled = false;
    const timer = setTimeout(() => finish(new Error("SMTP connection timed out.")), 20000);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    }

    function watch(target) {
      target.on("error", finish);
      target.on("close", () => {
        if (!settled) finish(new Error("SMTP connection closed unexpectedly."));
      });
    }

    watch(socket);

    async function smtpCommand(line, expected) {
      socket.write(`${line}\r\n`);
      const response = await readResponse(read);
      assertSmtpCode(response, expected);
      return response;
    }

    (async () => {
      await waitForConnection(socket, options.secure);
      let response = await readResponse(read);
      assertSmtpCode(response, [220]);

      const greeting = await smtpCommand("EHLO next360.in", [250]);
      const supportsStartTls = /\bSTARTTLS\b/i.test(greeting.lines.join(" "));

      if (!options.secure && supportsStartTls) {
        await smtpCommand("STARTTLS", [220]);
        socket.removeAllListeners("data");
        socket.removeAllListeners("error");
        socket.removeAllListeners("close");
        socket = tls.connect({ socket, servername: options.host });
        watch(socket);
        read = createLineReader(socket);
        await waitForConnection(socket, true);
        await smtpCommand("EHLO next360.in", [250]);
      }

      if (options.user) {
        await smtpCommand("AUTH LOGIN", [334]);
        await smtpCommand(Buffer.from(options.user, "utf8").toString("base64"), [334]);
        await smtpCommand(Buffer.from(options.pass || "", "utf8").toString("base64"), [235]);
      }

      await smtpCommand(`MAIL FROM:<${extractAddress(options.from)}>`, [250]);
      await smtpCommand(`RCPT TO:<${extractAddress(options.to)}>`, [250, 251]);
      await smtpCommand("DATA", [354]);

      socket.write(`${buildSmtpMessage(options)}\r\n.\r\n`);
      response = await readResponse(read);
      assertSmtpCode(response, [250]);

      socket.write("QUIT\r\n");
      await readResponse(read).catch(() => null);
      finish();
    })().catch(finish);
  });
}

function waitForConnection(socket, secure) {
  const readyEvent = secure ? "secureConnect" : "connect";
  if (!secure && !socket.connecting) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.removeListener(readyEvent, onReady);
      socket.removeListener("error", onError);
    };

    socket.once(readyEvent, onReady);
    socket.once("error", onError);
  });
}

function createLineReader(socket) {
  let buffer = "";
  const queue = [];
  let waiter = null;

  socket.on("data", (chunk) => {
    buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    let index;
    while ((index = buffer.indexOf("\r\n")) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (waiter) {
        const resolveLine = waiter;
        waiter = null;
        resolveLine(line);
      } else {
        queue.push(line);
      }
    }
  });

  return function readLine() {
    if (queue.length > 0) return Promise.resolve(queue.shift());
    return new Promise((resolve) => {
      waiter = resolve;
    });
  };
}

async function readResponse(readLine) {
  const lines = [];

  for (;;) {
    const line = await readLine();
    lines.push(line);
    if (line.length < 4 || line[3] !== "-") break;
  }

  return {
    code: Number(lines[lines.length - 1].slice(0, 3)),
    lines
  };
}

function assertSmtpCode(response, expected) {
  if (!expected.includes(response.code)) {
    throw new Error(`SMTP error ${response.code}: ${response.lines.join(" ")}`);
  }
}

function buildSmtpMessage({ from, to, replyTo, subject, body }) {
  const headers = [
    `From: NEXT360 Website <${extractAddress(from)}>`,
    `To: ${to}`,
    `Subject: ${encodeMailHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit"
  ];

  if (replyTo) headers.push(`Reply-To: ${replyTo}`);

  const message = `${headers.join("\r\n")}\r\n\r\n${body.replace(/\r?\n/g, "\r\n")}`;

  return message
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function extractAddress(value) {
  const match = String(value || "").match(/<([^>]+)>/);
  return (match ? match[1] : String(value || "")).trim();
}

function encodeMailHeader(value) {
  const text = String(value || "");
  return /^[\x20-\x7E]*$/.test(text)
    ? text
    : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
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

function enquiryFingerprint(fields, formType) {
  const contact = `${(fields.email || "").toLowerCase()}|${(fields.phone || "").replace(/\D/g, "")}`;
  const message = (fields.message || "").trim().toLowerCase();
  return crypto.createHash("sha256").update(`${formType}|${contact}|${message}`).digest("hex");
}

function findDuplicate(fingerprint) {
  const existing = recentEnquiries.get(fingerprint);
  if (!existing) return null;
  if (Date.now() - existing.createdAt > DUPLICATE_WINDOW_MS) {
    recentEnquiries.delete(fingerprint);
    return null;
  }
  return existing;
}

function rememberEnquiry(fingerprint, id) {
  recentEnquiries.set(fingerprint, { id, createdAt: Date.now() });
}

setInterval(() => {
  const rateCutoff = Date.now() - RATE_WINDOW_MS;
  for (const [ip, bucket] of rateBuckets) {
    if (bucket.start < rateCutoff) rateBuckets.delete(ip);
  }

  const duplicateCutoff = Date.now() - DUPLICATE_WINDOW_MS;
  for (const [fingerprint, item] of recentEnquiries) {
    if (item.createdAt < duplicateCutoff) recentEnquiries.delete(fingerprint);
  }
}, RATE_WINDOW_MS).unref();

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined) {
      const raw = Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : typeof req.body === "string"
          ? req.body
          : JSON.stringify(req.body);

      if (Buffer.byteLength(raw) > maxBytes) {
        const error = new Error("Body too large");
        error.code = "BODY_TOO_LARGE";
        return reject(error);
      }
      return resolve(raw);
    }

    let total = 0;
    let tooLarge = false;
    const chunks = [];

    req.on("data", (chunk) => {
      if (tooLarge) return;
      total += chunk.length;
      if (total > maxBytes) {
        tooLarge = true;
        const error = new Error("Body too large");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString("utf8"));
    });
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
  if (BLOCKED_EXTENSIONS.has(path.extname(normalized).toLowerCase())) return true;
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
  return (req.socket && req.socket.remoteAddress) || "unknown";
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
