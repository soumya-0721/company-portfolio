"use strict";

const fs = require("fs");
const path = require("path");
const leadStore = require("../lib/lead-store");

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

async function main() {
  const outputArg = process.argv[2];
  const outputFile = outputArg ? path.resolve(process.cwd(), outputArg) : null;

  if (outputFile && isInsideProject(outputFile)) {
    console.error(
      "Refusing to write an enquiry export inside the website directory. Choose a private location outside the project."
    );
    process.exitCode = 1;
    return;
  }

  let rows;
  try {
    rows = await leadStore.readStoredLeads();
  } catch (error) {
    console.error(`Could not read stored enquiries: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const csv = [
    COLUMNS.join(","),
    ...rows.map((row) => COLUMNS.map((column) => csvCell(valueFor(row, column))).join(","))
  ].join("\r\n");

  if (outputFile) {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(outputFile, `\uFEFF${csv}\r\n`, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(outputFile, 0o600);
    console.log(`Exported ${rows.length} enquiries to ${outputFile}`);
  } else {
    process.stdout.write(`${csv}\r\n`);
  }
}

function isInsideProject(filePath) {
  const relative = path.relative(leadStore.ROOT, filePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
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
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

main();
