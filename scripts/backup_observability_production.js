#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index > 0) process.env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function quoteSheet(title) {
  return `'${String(title).replace(/'/g, "''")}'!A:ZZ`;
}

async function googleJson(url, accessToken) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Google API ${response.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value || {};
  try { return JSON.parse(value); } catch { return {}; }
}

async function accessTokenFromN8nExport(file) {
  const credentials = JSON.parse(fs.readFileSync(file, "utf8"));
  const record = credentials.find((item) => item.type === "googleSheetsOAuth2Api");
  if (!record) throw new Error("Google Sheets OAuth credential was not found in the ephemeral n8n export");
  const data = parseMaybeJson(record.data);
  const oauth = parseMaybeJson(data.oauthTokenData);
  if (oauth.refresh_token && data.clientId && data.clientSecret) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: data.clientId,
        client_secret: data.clientSecret,
        refresh_token: oauth.refresh_token,
        grant_type: "refresh_token"
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.access_token) {
      throw new Error(`Google OAuth refresh failed: ${payload.error_description || payload.error || response.status}`);
    }
    return payload.access_token;
  }
  if (!oauth.access_token) throw new Error("The Google Sheets credential has no usable OAuth token");
  return oauth.access_token;
}

async function main() {
  const destination = path.resolve(process.argv[2] || "");
  if (!process.argv[2] || !destination.startsWith(path.join(ROOT, "n8n", "exports", "live-backups"))) {
    throw new Error("Pass a backup directory under n8n/exports/live-backups");
  }
  fs.mkdirSync(destination, { recursive: true });
  loadEnv(path.join(ROOT, ".env"));
  loadEnv(path.join(ROOT, ".env.phase1"));
  const spreadsheetId = process.env.AFFILIATE_TRACKER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("AFFILIATE_TRACKER_SPREADSHEET_ID is missing");

  // Prefer the renewable service-account credential over a possibly stale static token.
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH) {
    delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  }
  let accessToken;
  if (process.env.N8N_DECRYPTED_CREDENTIALS_PATH) {
    accessToken = await accessTokenFromN8nExport(process.env.N8N_DECRYPTED_CREDENTIALS_PATH);
  } else {
    const { getGoogleAccessToken } = require("../src/googleAuth");
    accessToken = await getGoogleAccessToken();
  }
  const metadataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties,sheets(properties,merges,basicFilter,filterViews,conditionalFormats,bandedRanges,charts)`;
  const metadata = await googleJson(metadataUrl, accessToken);
  const titles = (metadata.sheets || []).map((sheet) => sheet.properties.title);
  const query = new URLSearchParams({
    valueRenderOption: "FORMULA",
    dateTimeRenderOption: "SERIAL_NUMBER",
    majorDimension: "ROWS"
  });
  for (const title of titles) query.append("ranges", quoteSheet(title));
  const formulas = await googleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${query}`,
    accessToken
  );

  const exportResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}/export?mimeType=${encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  let xlsx = null;
  let xlsxExportStatus = "exported";
  if (exportResponse.ok) {
    xlsx = Buffer.from(await exportResponse.arrayBuffer());
    if (xlsx.length < 4 || xlsx[0] !== 0x50 || xlsx[1] !== 0x4b) {
      throw new Error("Spreadsheet backup is not a valid XLSX/ZIP payload");
    }
  } else {
    await exportResponse.text();
    xlsxExportStatus = `unavailable_http_${exportResponse.status}`;
  }

  const gridQuery = new URLSearchParams({ includeGridData: "true" });
  for (const title of titles) gridQuery.append("ranges", quoteSheet(title));
  const gridBackup = await googleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?${gridQuery}`,
    accessToken
  );

  const files = {
    "sheets-metadata.json": Buffer.from(JSON.stringify(metadata, null, 2) + "\n"),
    "sheets-formulas-and-values.json": Buffer.from(JSON.stringify(formulas, null, 2) + "\n"),
    "sheets-grid-backup.json": Buffer.from(JSON.stringify(gridBackup, null, 2) + "\n")
  };
  if (xlsx) files["affiliate-tracker-before.xlsx"] = xlsx;
  const manifest = [];
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(destination, name);
    fs.writeFileSync(target, content, { flag: "wx" });
    manifest.push({ file: name, bytes: content.length, sha256: sha256(content) });
  }
  const parsedMetadata = JSON.parse(fs.readFileSync(path.join(destination, "sheets-metadata.json"), "utf8"));
  const parsedValues = JSON.parse(fs.readFileSync(path.join(destination, "sheets-formulas-and-values.json"), "utf8"));
  if ((parsedMetadata.sheets || []).length !== titles.length || (parsedValues.valueRanges || []).length !== titles.length) {
    throw new Error("Sheet backup verification failed");
  }
  const summary = {
    captured_at: new Date().toISOString(),
    spreadsheet_title: metadata.properties?.title || "",
    spreadsheet_time_zone: metadata.properties?.timeZone || "",
    xlsx_export_status: xlsxExportStatus,
    sheet_count: titles.length,
    sheets: (formulas.valueRanges || []).map((entry, index) => ({
      title: titles[index],
      row_count: Math.max(0, (entry.values || []).length - 1),
      header: (entry.values || [])[0] || []
    })),
    files: manifest
  };
  fs.writeFileSync(path.join(destination, "sheet-backup-manifest.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify({ backup_directory: destination, ...summary }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
