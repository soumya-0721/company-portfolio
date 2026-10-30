"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LEADS_FILE = path.join(ROOT, "data", "leads.jsonl");
const COLUMNS = [
  "id",
  "receivedAt",
  "formType",
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
  "page",
  "utm",
  "ipHash",
  "userAgent"
];

function main() {
  if (!fs.existsSync(LEADS_FILE)) {
    console.error(`No leads file found at ${LEADS_FILE}`);
    process.exitCode = 1;
    return;
  }

  const outputArg = process.argv[2];
  const outputFile = outputArg ? path.resolve(process.cwd(), outputArg) : null;
  const lines = fs.readFileSync(LEADS_FILE, "utf8").split(/\r?\n/).filter(Boolean);
  const rows = [];

  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      console.error(`Skipping invalid JSON line: ${error.message}`);
    }
  }

  const csv = [
    COLUMNS.join(","),
    ...rows.map((row) => COLUMNS.map((column) => csvCell(valueFor(row, column))).join(","))
  ].join("\r\n");

  if (outputFile) {
    fs.writeFileSync(outputFile, `\uFEFF${csv}\r\n`, "utf8");
    console.log(`Exported ${rows.length} enquiries to ${outputFile}`);
  } else {
    process.stdout.write(`${csv}\r\n`);
  }
}

function valueFor(row, column) {
  if (column === "utm") {
    const utm = row.utm || {};
    const text = Object.entries(utm)
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
    return text;
  }

  if (COLUMNS.includes(column) && row.fields && Object.prototype.hasOwnProperty.call(row.fields, column)) {
    return row.fields[column];
  }

  return row[column] == null ? "" : row[column];
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

main();
