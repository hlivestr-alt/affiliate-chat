#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

function parseMaybe(value) { if (typeof value !== "string") return value || {}; try { return JSON.parse(value); } catch { return {}; } }
async function tokenFrom(file) {
  const credentials = JSON.parse(fs.readFileSync(file, "utf8"));
  const record = credentials.find((item) => item.type === "googleSheetsOAuth2Api");
  if (!record) throw new Error("Google Sheets credential not found");
  const data = parseMaybe(record.data), oauth = parseMaybe(data.oauthTokenData);
  if (oauth.refresh_token && data.clientId && data.clientSecret) {
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: data.clientId, client_secret: data.clientSecret, refresh_token: oauth.refresh_token, grant_type: "refresh_token" }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error_description || payload.error);
    return payload.access_token;
  }
  return oauth.access_token;
}
async function get(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Google API ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
function quote(name) { return `'${name.replace(/'/g, "''")}'`; }
function table(values) {
  const headers = values[0] || [];
  return { headers, rows: values.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] == null ? "" : row[index]]))) };
}
function text(value) { return value == null ? "" : String(value); }
function unique(rows, getter) { return new Set(rows.map(getter).filter(Boolean)).size; }
function isNumeric(value) { return /^\d+$/.test(text(value)); }

async function main() {
  const [spreadsheetId, outputPath] = process.argv.slice(2);
  if (!spreadsheetId || !outputPath || !process.env.N8N_DECRYPTED_CREDENTIALS_PATH) throw new Error("spreadsheet id, output path, and ephemeral credentials are required");
  const token = await tokenFrom(process.env.N8N_DECRYPTED_CREDENTIALS_PATH);
  const names = ["WhatsApp Chat Log", "WhatsApp Clip Log", "WhatsApp Raw Events", "WhatsApp Dashboard"];
  const params = new URLSearchParams({ valueRenderOption: "FORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
  for (const name of names) params.append("ranges", `${quote(name)}!A:BK`);
  const values = await get(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${params}`, token);
  const byName = new Map(values.valueRanges.map((entry, index) => [names[index], entry.values || []]));
  const chat = table(byName.get(names[0]));
  const clip = table(byName.get(names[1]));
  const raw = table(byName.get(names[2]));
  const dashboardValues = byName.get(names[3]);
  const formulaParams = new URLSearchParams({ valueRenderOption: "FORMULA" });
  formulaParams.append("ranges", `${quote("WhatsApp Dashboard")}!A1:BK230`);
  const dashboardFormulas = (await get(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${formulaParams}`, token)).valueRanges?.[0]?.values || [];
  const metadata = await get(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties,sheets(properties,basicFilter,charts,conditionalFormats)`, token);
  const diagnostic = await get(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?includeGridData=true&ranges=${encodeURIComponent("'WhatsApp Dashboard'!AX2:BK2")}&ranges=${encodeURIComponent("'WhatsApp Dashboard'!B5:E5")}&fields=sheets(data(rowData(values(userEnteredValue,effectiveValue))))`, token);

  const errors = [];
  for (let r = 0; r < dashboardValues.length; r += 1) for (let c = 0; c < (dashboardValues[r] || []).length; c += 1) {
    const value = text(dashboardValues[r][c]);
    if (/^#(?:REF!|N\/A|VALUE!|NAME\?|DIV\/0!|ERROR!)/.test(value)) errors.push({ row: r + 1, column: c + 1, value });
  }
  const chatKeys = chat.rows.map((row) => text(row["Deduplication Key"])).filter(Boolean);
  const clipKeys = clip.rows.map((row) => text(row["Delivery Key"])).filter(Boolean);
  const inbound = chat.rows.filter((row) => row.Direction === "inbound");
  const outbound = chat.rows.filter((row) => row.Direction === "outbound");
  const productionClips = clip.rows.filter((row) => isNumeric(row["Folder Number"]));
  const folders = [...new Set(productionClips.map((row) => row["Folder Number"]))];
  const folderSummary = folders.map((folder) => {
    const rows = productionClips.filter((row) => row["Folder Number"] === folder);
    return {
      folder,
      expected: rows.length,
      accepted: rows.filter((row) => row["Send State"] === "accepted").length,
      sent: rows.filter((row) => row["Send State"] === "sent").length,
      delivered: rows.filter((row) => ["delivered", "read"].includes(text(row["Delivery State"]).toLowerCase())).length,
      read: rows.filter((row) => text(row["Delivery State"]).toLowerCase() === "read").length,
      failed: rows.filter((row) => row["Send State"] === "failed" || row["Current Result"] === "Failed").length
    };
  });
  const suspiciousRaw = raw.rows.filter((row) => /Bearer\s+(?!<redacted>)|authorization["']?\s*:\s*["'](?!<redacted>)|client_secret|app_secret|access_token["']?\s*:\s*["'](?!<redacted>)/i.test(text(row["Sanitized JSON Payload"])));
  const meta = Object.fromEntries(metadata.sheets.filter((sheet) => names.includes(sheet.properties.title)).map((sheet) => [sheet.properties.title, {
    sheet_id: sheet.properties.sheetId,
    hidden: Boolean(sheet.properties.hidden), frozen_rows: sheet.properties.gridProperties?.frozenRowCount || 0,
    filter_present: Boolean(sheet.basicFilter), chart_count: (sheet.charts || []).length,
    conditional_format_count: (sheet.conditionalFormats || []).length
  }]));
  const kpiRows = {};
  for (let index = 4; index <= 21; index += 1) {
    const row = dashboardValues[index] || [];
    kpiRows[text(row[0])] = { today: row[1] ?? "", last_7_days: row[2] ?? "", last_30_days: row[3] ?? "", all_time: row[4] ?? "" };
  }
  const helperPreview = dashboardValues.slice(1, 12).map((row) => ({
    folder: row[49] ?? "", assignment: row[50] ?? "", expected: row[54] ?? "",
    accepted: row[55] ?? "", sent: row[56] ?? "", delivered: row[57] ?? "",
    failed: row[59] ?? "", remaining: row[60] ?? "", completion: row[61] ?? ""
  })).filter((row) => row.folder);
  const report = {
    audited_at: new Date().toISOString(),
    spreadsheet_time_zone: metadata.properties?.timeZone,
    rows: { chat: chat.rows.length, clip: clip.rows.length, raw: raw.rows.length },
    reconciliation: {
      distinct_chat_keys: new Set(chatKeys).size,
      duplicate_chat_keys: chatKeys.length - new Set(chatKeys).size,
      distinct_clip_keys: new Set(clipKeys).size,
      duplicate_clip_keys: clipKeys.length - new Set(clipKeys).size,
      inbound_messages: inbound.length,
      outbound_messages: outbound.length,
      unique_inbound_contacts: unique(inbound, (row) => row.wa_id || row["WhatsApp Number"]),
      numbered_folders: folders.length,
      production_clips: productionClips.length,
      accepted_clips: productionClips.filter((row) => row["Send State"] === "accepted").length,
      sent_clips: productionClips.filter((row) => row["Send State"] === "sent").length,
      delivered_clips: productionClips.filter((row) => ["delivered", "read"].includes(text(row["Delivery State"]).toLowerCase())).length,
      failed_clips: productionClips.filter((row) => row["Send State"] === "failed" || row["Current Result"] === "Failed").length,
      accepted_not_counted_as_delivered: productionClips.filter((row) => row["Send State"] === "accepted" && !["delivered", "read"].includes(text(row["Delivery State"]).toLowerCase())).length
    },
    folder_summary: folderSummary,
    dashboard_kpis: kpiRows,
    helper_preview: helperPreview,
    formula_count: dashboardFormulas.flat().filter((value) => text(value).startsWith("=")).length,
    formula_errors: errors,
    formula_diagnostics: diagnostic.sheets?.[0]?.data || [],
    raw_sanitization_violations: suspiciousRaw.length,
    sheet_properties: meta
  };
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
