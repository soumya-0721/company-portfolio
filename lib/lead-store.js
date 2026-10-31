"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const LEADS_FILE = path.join(DATA_DIR, "leads.jsonl");

loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

function getLeadsKey() {
  return process.env.LEADS_STORAGE_KEY || "next360:leads";
}

function getRedisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

function storageDescription() {
  return getRedisConfig() ? "Redis (persistent)" : LEADS_FILE;
}

async function redisCommand(command) {
  const config = getRedisConfig();
  if (!config) throw new Error("Redis is not configured.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(command),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Redis responded with ${response.status}.`);
    }
    if (payload && payload.error) {
      throw new Error(`Redis error: ${payload.error}`);
    }
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

async function appendLead(entry) {
  const serialized = JSON.stringify(entry);

  if (getRedisConfig()) {
    try {
      await redisCommand(["RPUSH", getLeadsKey(), serialized]);
      return { store: "redis" };
    } catch (error) {
      console.error("Redis lead storage failed:", error.message);
    }
  }

  await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  await fsp.appendFile(LEADS_FILE, `${serialized}\n`, { encoding: "utf8", mode: 0o600 });
  return { store: "file" };
}

async function readStoredLeads() {
  if (getRedisConfig()) {
    const result = await redisCommand(["LRANGE", getLeadsKey(), "0", "-1"]);
    if (!Array.isArray(result)) return [];
    return result.map(parseLead).filter(Boolean);
  }

  if (!fs.existsSync(LEADS_FILE)) return [];

  return fs
    .readFileSync(LEADS_FILE, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseLead)
    .filter(Boolean);
}

function parseLead(line) {
  try {
    return JSON.parse(line);
  } catch (error) {
    console.error(`Skipping invalid stored enquiry: ${error.message}`);
    return null;
  }
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

module.exports = {
  ROOT,
  DATA_DIR,
  LEADS_FILE,
  getLeadsKey,
  getRedisConfig,
  storageDescription,
  redisCommand,
  appendLead,
  readStoredLeads,
  loadEnvFile
};
