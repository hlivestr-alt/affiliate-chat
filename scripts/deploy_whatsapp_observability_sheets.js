#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CHAT_SHEET = "WhatsApp Chat Log";
const CLIP_SHEET = "WhatsApp Clip Log";
const DASHBOARD_SHEET = "WhatsApp Dashboard";
const RAW_SHEET = "WhatsApp Raw Events";
let FORMULA_LOCALE = "en_US";

const CHAT_HEADERS = [
  "Event Time Jakarta", "Event Time UTC", "Direction", "Event Type", "WhatsApp Number", "wa_id",
  "TikTok Username", "Contact/Lead ID", "Conversation Key", "Inbound Message ID", "Outbound wamid",
  "Reply-To Message ID", "Message Type", "Message Text", "Media Filename", "Folder Number", "Clip Filename",
  "Delivery Key", "Workflow Name", "n8n Execution ID", "Last Inbound At", "Window Expires At", "Lead State",
  "Intent", "Send State", "Delivery State", "Error Code", "Error Title", "Error Details", "Created At", "Updated At",
  "Sent At", "Delivered At", "Read At", "Failed At", "Record Source", "Backfill Timestamp", "Deduplication Key"
];
const CLIP_HEADERS = [
  "Folder Number", "Batch/Assignment ID", "Clip Sequence", "Clip Filename", "Full Local Source Path", "File Size Bytes",
  "Media Type", "WhatsApp Number", "wa_id", "TikTok Username", "Lead ID", "Assignment Date", "Upload Started At",
  "Message Sent At", "Outbound wamid", "Send State", "Sent At", "Delivery State", "Delivered At", "Read At", "Failed At",
  "Error Code", "Error Title", "Error Details", "Delivery Key", "Attempt Count", "n8n Execution ID", "Current Result",
  "Updated At", "Record Source", "Backfill Timestamp"
];
const RAW_HEADERS = [
  "Received Timestamp", "Event Kind", "Event Category", "Phone Number", "wa_id", "Message ID / wamid", "Workflow",
  "Execution ID", "Deduplication Key", "Sanitized JSON Payload", "Processing Result", "Error Summary"
];

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    const index = value.indexOf("=");
    if (index > 0) process.env[value.slice(0, index)] = value.slice(index + 1);
  }
}
function text(value) { return value == null ? "" : String(value); }
function parseMaybeJson(value) {
  if (typeof value !== "string") return value || {};
  try { return JSON.parse(value); } catch { return {}; }
}
async function accessTokenFromN8nExport(file) {
  const credentials = JSON.parse(fs.readFileSync(file, "utf8"));
  const record = credentials.find((item) => item.type === "googleSheetsOAuth2Api");
  if (!record) throw new Error("Google Sheets credential missing from ephemeral n8n export");
  const data = parseMaybeJson(record.data);
  const oauth = parseMaybeJson(data.oauthTokenData);
  if (oauth.refresh_token && data.clientId && data.clientSecret) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: data.clientId, client_secret: data.clientSecret, refresh_token: oauth.refresh_token, grant_type: "refresh_token" })
    });
    const payload = await response.json();
    if (!response.ok || !payload.access_token) throw new Error(`Google OAuth refresh failed: ${payload.error_description || payload.error || response.status}`);
    return payload.access_token;
  }
  if (!oauth.access_token) throw new Error("No usable Google Sheets OAuth token");
  return oauth.access_token;
}
async function google(url, token, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`, Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {})
        }
      });
      const body = await response.text();
      if (!response.ok) {
        const error = new Error(`Google API ${response.status}: ${body.slice(0, 500)}`);
        error.status = response.status;
        throw error;
      }
      return body ? JSON.parse(body) : {};
    } catch (error) {
      lastError = error;
      if (attempt >= 3 || ![429, 500, 502, 503, 504].includes(error.status)) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}
function quote(title) { return `'${title.replace(/'/g, "''")}'`; }
function a1(title, range) { return `${quote(title)}!${range}`; }
function col(index) {
  let value = index + 1, result = "";
  while (value > 0) { value -= 1; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
}
function columnMap(headers) { return new Map(headers.map((header, index) => [header, { index, letter: col(index) }])); }
function rowValues(headers, record) { return headers.map((header) => record[header] == null ? "" : record[header]); }
function formulaRef(sheet, map, header) {
  const item = map.get(header);
  if (!item) throw new Error(`Missing header ${sheet}.${header}`);
  return `${quote(sheet)}!$${item.letter}$2:$${item.letter}`;
}
function timeCondition(timeRange, periodColumn) {
  return `IF(${periodColumn}$4="All time",${timeRange}<>"",(${timeRange}>=TEXT(TODAY()-${periodColumn}$3,"yyyy-mm-dd"))*(${timeRange}<TEXT(TODAY()+1,"yyyy-mm-dd")))`;
}
async function batchUpdate(spreadsheetId, token, requests) {
  if (!requests.length) return {};
  return google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, token, {
    method: "POST", body: JSON.stringify({ requests })
  });
}
async function getMetadata(spreadsheetId, token) {
  return google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties,sheets(properties,basicFilter,charts,conditionalFormats),namedRanges`, token);
}
async function getValues(spreadsheetId, token, sheet, endColumn = "AZ") {
  const range = encodeURIComponent(a1(sheet, `A:${endColumn}`));
  return google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`, token);
}
async function writeValues(spreadsheetId, token, range, values, input = "RAW") {
  const localizedValues = input === "USER_ENTERED"
    ? values.map((row) => row.map((value) => typeof value === "string" && value.startsWith("=") ? localizeFormula(value) : value))
    : values;
  return google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=${input}`, token, {
    method: "PUT", body: JSON.stringify({ majorDimension: "ROWS", values: localizedValues })
  });
}
async function batchWriteValues(spreadsheetId, token, data, input = "RAW") {
  if (!data.length) return {};
  return google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, token, {
    method: "POST", body: JSON.stringify({ valueInputOption: input, data })
  });
}
function localizeFormula(formula) {
  if (!/^in(?:_|-)/i.test(FORMULA_LOCALE)) return formula;
  let result = "", inString = false, arrayDepth = 0;
  for (let index = 0; index < formula.length; index += 1) {
    const character = formula[index];
    if (character === '"') {
      result += character;
      if (inString && formula[index + 1] === '"') { result += formula[++index]; continue; }
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (character === "{") arrayDepth += 1;
      if (character === "}") arrayDepth = Math.max(0, arrayDepth - 1);
      if (character === ",") { result += arrayDepth ? "\\" : ";"; continue; }
    }
    result += character;
  }
  return result;
}
async function appendValues(spreadsheetId, token, sheet, rows) {
  if (!rows.length) return {};
  const range = encodeURIComponent(a1(sheet, "A:ZZ"));
  return google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, token, {
    method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values: rows })
  });
}
function objectRows(values) {
  const headers = (values[0] || []).map(text);
  return { headers, rows: values.slice(1).map((row, rowIndex) => ({
    _rowNumber: rowIndex + 2,
    ...Object.fromEntries(headers.map((header, index) => [header, row[index] == null ? "" : row[index]]))
  })) };
}
function dedupKey(sheet, row) {
  if (sheet === CHAT_SHEET) return text(row["Deduplication Key"] || (row["Inbound Message ID"] ? `inbound:${row["Inbound Message ID"]}` : row["Outbound wamid"] ? `outbound:${row["Outbound wamid"]}` : row["Delivery Key"]));
  if (sheet === CLIP_SHEET) return text(row["Delivery Key"] || row["Outbound wamid"]);
  return [row["Execution ID"], row["Deduplication Key"], row["Event Kind"], row["Received Timestamp"]].map(text).join("|");
}
function laterTimestamp(left, right) {
  if (!left) return right || "";
  if (!right) return left;
  const leftTime = Date.parse(left), rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime)) return right;
  if (!Number.isFinite(rightTime)) return left;
  return rightTime > leftTime ? right : left;
}
function mergeBackfillRow(sheet, current, incoming) {
  const merged = { ...current };
  for (const [header, value] of Object.entries(incoming)) {
    if (header === "_rowNumber" || value == null || value === "") continue;
    if (merged[header] == null || merged[header] === "") merged[header] = value;
  }
  const sendRank = { "": 0, authorized: 1, accepted: 2, sent: 3, outcome_uncertain: 4, failed: 5 };
  const deliveryRank = { "": 0, pending: 1, delivered: 2, read: 3 };
  if ((sendRank[text(incoming["Send State"])] || 0) > (sendRank[text(current["Send State"])] || 0)) merged["Send State"] = incoming["Send State"];
  if ((deliveryRank[text(incoming["Delivery State"])] || 0) > (deliveryRank[text(current["Delivery State"])] || 0)) merged["Delivery State"] = incoming["Delivery State"];
  for (const header of ["Sent At", "Delivered At", "Read At", "Failed At"]) {
    merged[header] = laterTimestamp(current[header], incoming[header]);
  }
  merged["Updated At"] = laterTimestamp(current["Updated At"], incoming["Updated At"]);
  if (sheet === CLIP_SHEET) {
    const resultRank = { "": 0, Pending: 1, Uploaded: 2, "Accepted by Meta": 3, Sent: 4, Delivered: 5, Read: 6, "Outcome uncertain": 7, Failed: 8 };
    if ((resultRank[text(incoming["Current Result"])] || 0) > (resultRank[text(current["Current Result"])] || 0)) merged["Current Result"] = incoming["Current Result"];
    merged["Attempt Count"] = Math.max(Number(current["Attempt Count"] || 0), Number(incoming["Attempt Count"] || 0));
  }
  return merged;
}

async function main() {
  loadEnv(path.join(ROOT, ".env"));
  loadEnv(path.join(ROOT, ".env.phase1"));
  const spreadsheetId = process.env.AFFILIATE_TRACKER_SPREADSHEET_ID;
  const backfillPath = path.resolve(process.argv[2] || "");
  if (!spreadsheetId || !fs.existsSync(backfillPath)) throw new Error("Spreadsheet ID or backfill JSON is missing");
  const backfill = JSON.parse(fs.readFileSync(backfillPath, "utf8"));
  const credentialPath = process.env.N8N_DECRYPTED_CREDENTIALS_PATH;
  if (!credentialPath) throw new Error("N8N_DECRYPTED_CREDENTIALS_PATH is required");
  const token = await accessTokenFromN8nExport(credentialPath);

  let metadata = await getMetadata(spreadsheetId, token);
  FORMULA_LOCALE = metadata.properties?.locale || "en_US";
  const existing = new Map((metadata.sheets || []).map((sheet) => [sheet.properties.title, sheet]));
  const addRequests = [];
  for (const [title, cols, rows] of [
    [CHAT_SHEET, CHAT_HEADERS.length, 5000], [CLIP_SHEET, CLIP_HEADERS.length, 10000],
    [DASHBOARD_SHEET, 63, 1200], [RAW_SHEET, RAW_HEADERS.length, 20000]
  ]) {
    if (!existing.has(title)) addRequests.push({ addSheet: { properties: { title, gridProperties: { rowCount: rows, columnCount: cols } } } });
  }
  await batchUpdate(spreadsheetId, token, addRequests);
  metadata = await getMetadata(spreadsheetId, token);
  const sheets = new Map(metadata.sheets.map((sheet) => [sheet.properties.title, sheet]));

  const headerSets = [[CHAT_SHEET, CHAT_HEADERS], [CLIP_SHEET, CLIP_HEADERS], [RAW_SHEET, RAW_HEADERS]];
  const finalHeaders = new Map();
  for (const [title, required] of headerSets) {
    const values = (await getValues(spreadsheetId, token, title)).values || [];
    const current = (values[0] || []).map(text);
    if (new Set(current.filter(Boolean)).size !== current.filter(Boolean).length) throw new Error(`Duplicate header exists in ${title}`);
    const headers = current.length ? [...current] : [];
    for (const header of required) if (!headers.includes(header)) headers.push(header);
    if (!headers.length) throw new Error(`No headers prepared for ${title}`);
    if (!current.length || headers.length !== current.length) await writeValues(spreadsheetId, token, a1(title, `A1:${col(headers.length - 1)}1`), [headers], "RAW");
    finalHeaders.set(title, headers);
  }

  const backfillSpecs = [[CHAT_SHEET, backfill.chat || []], [CLIP_SHEET, backfill.clip || []], [RAW_SHEET, backfill.raw || []]];
  const appended = {};
  const updated = {};
  for (const [title, records] of backfillSpecs) {
    const values = (await getValues(spreadsheetId, token, title, "ZZ")).values || [];
    const parsed = objectRows(values);
    const headers = finalHeaders.get(title);
    const knownRows = new Map(parsed.rows.map((row) => [dedupKey(title, row), row]).filter(([key]) => Boolean(key)));
    const known = new Set(knownRows.keys());
    const missing = records.filter((row) => {
      const key = dedupKey(title, row);
      if (!key || known.has(key)) return false;
      known.add(key);
      return true;
    });
    const changes = [];
    if (title !== RAW_SHEET) {
      for (const incoming of records) {
        const key = dedupKey(title, incoming);
        const current = knownRows.get(key);
        if (!current) continue;
        const merged = mergeBackfillRow(title, current, incoming);
        const before = JSON.stringify(rowValues(headers, current));
        const after = JSON.stringify(rowValues(headers, merged));
        if (before !== after) changes.push({
          range: a1(title, `A${current._rowNumber}:${col(headers.length - 1)}${current._rowNumber}`),
          majorDimension: "ROWS", values: [rowValues(headers, merged)]
        });
      }
      await batchWriteValues(spreadsheetId, token, changes, "RAW");
    }
    await appendValues(spreadsheetId, token, title, missing.map((row) => rowValues(headers, row)));
    appended[title] = missing.length;
    updated[title] = changes.length;
  }

  const chatMap = columnMap(finalHeaders.get(CHAT_SHEET));
  const clipMap = columnMap(finalHeaders.get(CLIP_SHEET));
  const dashboardId = sheets.get(DASHBOARD_SHEET).properties.sheetId;
  const chatId = sheets.get(CHAT_SHEET).properties.sheetId;
  const clipId = sheets.get(CLIP_SHEET).properties.sheetId;
  const rawId = sheets.get(RAW_SHEET).properties.sheetId;
  const c = (header) => formulaRef(CHAT_SHEET, chatMap, header);
  const k = (header) => formulaRef(CLIP_SHEET, clipMap, header);
  const leadHeaders = objectRows(((await getValues(spreadsheetId, token, "WhatsApp Leads", "AZ")).values || [])).headers;
  const leadMap = columnMap(leadHeaders);
  const l = (header) => formulaRef("WhatsApp Leads", leadMap, header);

  await batchUpdate(spreadsheetId, token, [{ updateSheetProperties: { properties: { sheetId: dashboardId, gridProperties: { columnCount: 63 } }, fields: "gridProperties.columnCount" } }]);
  await google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`, token, {
    method: "POST", body: JSON.stringify({ ranges: [a1(DASHBOARD_SHEET, "A1:BK1200")] })
  });
  const dashboard = Array.from({ length: 230 }, () => Array(63).fill(""));
  dashboard[0][0] = "WhatsApp Affiliate Operations Dashboard";
  dashboard[1][0] = "Asia/Jakarta · live from deduplicated Chat Log and Clip Log";
  dashboard[2][0] = "Period offset days"; dashboard[2][1] = 0; dashboard[2][2] = 6; dashboard[2][3] = 29; dashboard[2][4] = 0;
  dashboard[3][0] = "KPI"; dashboard[3][1] = "Today"; dashboard[3][2] = "Last 7 days"; dashboard[3][3] = "Last 30 days"; dashboard[3][4] = "All time";
  const metrics = [
    "Total inbound messages", "Unique WhatsApp numbers", "New contacts", "Interested contacts", "Contacts awaiting username",
    "Valid TikTok usernames received", "Leads requiring manual review", "Folders assigned", "Folders started", "Folders fully delivered",
    "Individual clips attempted", "Clips accepted", "Clips sent", "Clips delivered", "Clips read", "Clips failed",
    "Active 24-hour windows", "Expired windows with pending clips"
  ];
  metrics.forEach((name, index) => { dashboard[4 + index][0] = name; });
  for (let period = 1; period <= 4; period += 1) {
    const pcol = col(period);
    const chatTime = c("Event Time Jakarta"), clipTime = k("Assignment Date");
    const chatPeriod = timeCondition(chatTime, pcol), clipPeriod = timeCondition(clipTime, pcol);
    const formulas = [
      `=IFERROR(SUMPRODUCT((${c("Direction")}="inbound")*${chatPeriod}),0)`,
      `=IFERROR(COUNTUNIQUE(FILTER(${c("wa_id")},${c("Direction")}="inbound",${c("wa_id")}<>"",${chatPeriod})),0)`,
      `=IFERROR(COUNTUNIQUE(FILTER(${l("wa_id")},${l("wa_id")}<>"",IF(${pcol}$4="All time",${l("captured_at")}<>"",(${l("captured_at")}>=TEXT(TODAY()-${pcol}$3,"yyyy-mm-dd"))*(${l("captured_at")}<TEXT(TODAY()+1,"yyyy-mm-dd"))))),0)`,
      `=IFERROR(COUNTUNIQUE(FILTER(${c("wa_id")},REGEXMATCH(${c("Intent")},"interested|confirmed"),${c("wa_id")}<>"",${chatPeriod})),0)`,
      `=IFERROR(COUNTUNIQUE(FILTER(${c("wa_id")},${c("Intent")}="awaiting_username",${c("wa_id")}<>"",${chatPeriod})),0)`,
      `=IFERROR(COUNTUNIQUE(FILTER(${c("TikTok Username")},REGEXMATCH(${c("TikTok Username")},"^[A-Za-z0-9._]{2,30}$"),${chatPeriod})),0)`,
      `=IFERROR(COUNTUNIQUE(FILTER(${c("wa_id")},${c("Intent")}="manual_review",${c("wa_id")}<>"",${chatPeriod})),0)`,
      `=IFERROR(SUMPRODUCT(N(REGEXMATCH($AX$2:$AX100,"^[0-9]+$"))*${timeCondition("$AY$2:$AY100", pcol)}),0)`,
      `=IFERROR(SUMPRODUCT(N($BJ$2:$BJ100<>"Not started")*N($BJ$2:$BJ100<>"")*${timeCondition("$AY$2:$AY100", pcol)}),0)`,
      `=IFERROR(SUMPRODUCT(N($BJ$2:$BJ100="Fully delivered")*${timeCondition("$AY$2:$AY100", pcol)}),0)`,
      `=IFERROR(SUMPRODUCT(((${k("Upload Started At")}<>"")+(${k("Message Sent At")}<>"")+(${k("Attempt Count")}>0)>0)*${clipPeriod}),0)`,
      `=IFERROR(SUMPRODUCT((${k("Send State")}="accepted")*${clipPeriod}),0)`,
      `=IFERROR(SUMPRODUCT((${k("Send State")}="sent")*${clipPeriod}),0)`,
      `=IFERROR(SUMPRODUCT(((${k("Delivery State")}="delivered")+(${k("Delivery State")}="read")>0)*${clipPeriod}),0)`,
      `=IFERROR(SUMPRODUCT((${k("Delivery State")}="read")*${clipPeriod}),0)`,
      `=IFERROR(SUMPRODUCT(((${k("Send State")}="failed")+(${k("Current Result")}="Failed")>0)*${clipPeriod}),0)`,
      `=IFERROR(COUNTUNIQUE(FILTER(${l("wa_id")},${l("wa_id")}<>"",${l("window_expires_at")}>TEXT(NOW(),"yyyy-mm-ddThh:mm:ss"))),0)`,
      `=IFERROR(COUNTUNIQUE(FILTER($AX$2:$AX,$BI$2:$BI>0,$AZ$2:$AZ<TEXT(NOW(),"yyyy-mm-ddThh:mm:ss"))),0)`
    ];
    formulas.forEach((formula, index) => { dashboard[4 + index][period] = formula; });
  }

  dashboard[24][0] = "Conversion funnel"; dashboard[25][0] = "Stage"; dashboard[25][1] = "Contacts";
  const funnel = [
    ["1. Unique inbound contacts", "=E6"], ["2. Interested contacts", "=E8"], ["3. Valid username received", "=E10"],
    ["4. Folder assigned", "=E12"], ["5. At least one clip sent", `=IFERROR(COUNTUNIQUE(FILTER(${k("Folder Number")},${k("Send State")}="sent")),0)`],
    ["6. At least one clip delivered", `=IFERROR(COUNTUNIQUE(FILTER(${k("Folder Number")},REGEXMATCH(${k("Delivery State")},"delivered|read"))),0)`],
    ["7. Full folder delivered", "=E14"]
  ];
  funnel.forEach((row, index) => { dashboard[26 + index][0] = row[0]; dashboard[26 + index][1] = row[1]; });

  dashboard[35][0] = "Latest Conversations";
  ["Time", "Number", "TikTok username", "Latest inbound text", "Latest bot reply", "State", "Folder number", "Clips delivered/expected", "Window expiry"].forEach((v, i) => dashboard[36][i] = v);
  dashboard[35][11] = "Active Deliveries";
  ["Folder", "Affiliate", "WhatsApp number", "Expected", "Accepted", "Sent", "Delivered", "Failed", "Remaining", "Current state"].forEach((v, i) => dashboard[36][11 + i] = v);
  dashboard[60][0] = "Needs Attention";
  ["Reason", "WhatsApp number", "TikTok username", "Folder", "State", "Details", "Updated", "Window expiry"].forEach((v, i) => dashboard[61][i] = v);
  dashboard[60][11] = "Recent Folder Assignments";
  ["Folder", "TikTok username", "WhatsApp number", "Assignment time", "Clips", "Sent", "Delivered", "Failed", "Completion status"].forEach((v, i) => dashboard[61][11 + i] = v);

  // Helper ranges AX:BH are intentionally off-screen and drive all dynamic tables/charts.
  const helperHeaders = ["Folder", "Assignment", "Window Expiry", "Username", "Number", "Expected", "Accepted", "Sent", "Delivered", "Read", "Failed", "Remaining", "Completion"];
  helperHeaders.forEach((v, i) => dashboard[0][49 + i] = v);
  dashboard[1][49] = `=SORT(UNIQUE(FILTER(${k("Folder Number")},REGEXMATCH(${k("Folder Number")},"^[0-9]+$"))))`;
  dashboard[1][50] = `=ARRAYFORMULA(IF(AX2:AX100="",,IFNA(VLOOKUP(AX2:AX100,SORT({${k("Folder Number")},${k("Assignment Date")}},2,TRUE),2,FALSE),"")))`;
  dashboard[1][51] = `=ARRAYFORMULA(IF(AX2:AX100="",,IFNA(VLOOKUP(AX2:AX100,{${l("batch_number")},${l("window_expires_at")}},2,FALSE),"")))`;
  dashboard[1][52] = `=ARRAYFORMULA(IF(AX2:AX100="",,IFNA(VLOOKUP(AX2:AX100,{${k("Folder Number")},${k("TikTok Username")}},2,FALSE),"")))`;
  dashboard[1][53] = `=ARRAYFORMULA(IF(AX2:AX100="",,IFNA(VLOOKUP(AX2:AX100,{${k("Folder Number")},${k("WhatsApp Number")}},2,FALSE),"")))`;
  dashboard[1][54] = `=ARRAYFORMULA(IF(AX2:AX100="",,COUNTIF(${k("Folder Number")},AX2:AX100)))`;
  dashboard[1][55] = `=ARRAYFORMULA(IF(AX2:AX100="",,COUNTIFS(${k("Folder Number")},AX2:AX100,${k("Send State")},"accepted")))`;
  dashboard[1][56] = `=ARRAYFORMULA(IF(AX2:AX100="",,COUNTIFS(${k("Folder Number")},AX2:AX100,${k("Send State")},"sent")))`;
  dashboard[1][57] = `=ARRAYFORMULA(IF(AX2:AX100="",,COUNTIFS(${k("Folder Number")},AX2:AX100,${k("Delivery State")},"delivered")+COUNTIFS(${k("Folder Number")},AX2:AX100,${k("Delivery State")},"read")))`;
  dashboard[1][58] = `=ARRAYFORMULA(IF(AX2:AX100="",,COUNTIFS(${k("Folder Number")},AX2:AX100,${k("Delivery State")},"read")))`;
  dashboard[1][59] = `=ARRAYFORMULA(IF(AX2:AX100="",,COUNTIFS(${k("Folder Number")},AX2:AX100,${k("Send State")},"failed")+COUNTIFS(${k("Folder Number")},AX2:AX100,${k("Current Result")},"Failed")))`;
  dashboard[1][60] = `=ARRAYFORMULA(IF(AX2:AX100="",,BC2:BC100-BF2:BF100-BH2:BH100))`;
  dashboard[1][61] = `=ARRAYFORMULA(IF(AX2:AX100="",,IF(BI2:BI100=0,"Fully delivered",IF(BH2:BH100>0,"Failed",IF(BF2:BF100>0,"Partial","Not started")))))`;

  // Daily/chart helpers start at AX200.
  ["Date", "Unique inbound", "Interested", "Clips sent", "Clips delivered"].forEach((v, i) => dashboard[199][49 + i] = v);
  dashboard[200][49] = "=SEQUENCE(30,1,TODAY()-29,1)";
  dashboard[200][50] = `=ARRAYFORMULA(IF(AX201:AX230="",,MAP(AX201:AX230,LAMBDA(d,IFERROR(COUNTUNIQUE(FILTER(${c("wa_id")},${c("Direction")}="inbound",LEFT(${c("Event Time Jakarta")},10)=TEXT(d,"yyyy-mm-dd"))),0)))))`;
  dashboard[200][51] = `=ARRAYFORMULA(IF(AX201:AX230="",,MAP(AX201:AX230,LAMBDA(d,IFERROR(COUNTUNIQUE(FILTER(${c("wa_id")},REGEXMATCH(${c("Intent")},"interested|confirmed"),LEFT(${c("Event Time Jakarta")},10)=TEXT(d,"yyyy-mm-dd"))),0)))))`;
  dashboard[200][52] = `=ARRAYFORMULA(IF(AX201:AX230="",,MAP(AX201:AX230,LAMBDA(d,COUNTIFS(${k("Send State")},"sent",${k("Assignment Date")},">="&TEXT(d,"yyyy-mm-dd"),${k("Assignment Date")},"<"&TEXT(d+1,"yyyy-mm-dd"))))))`;
  dashboard[200][53] = `=ARRAYFORMULA(IF(AX201:AX230="",,MAP(AX201:AX230,LAMBDA(d,COUNTIFS(${k("Delivery State")},"delivered",${k("Assignment Date")},">="&TEXT(d,"yyyy-mm-dd"),${k("Assignment Date")},"<"&TEXT(d+1,"yyyy-mm-dd"))+COUNTIFS(${k("Delivery State")},"read",${k("Assignment Date")},">="&TEXT(d,"yyyy-mm-dd"),${k("Assignment Date")},"<"&TEXT(d+1,"yyyy-mm-dd"))))))`;
  dashboard[199][55] = "Delivery status"; dashboard[199][56] = "Count";
  dashboard[200][55] = `=QUERY(${k("Current Result")},"select Col1,count(Col1) where Col1 is not null group by Col1 label count(Col1) ''",0)`;
  dashboard[199][58] = "Folder completion"; dashboard[199][59] = "Count";
  dashboard[200][58] = "=QUERY(BJ2:BJ,\"select Col1,count(Col1) where Col1 is not null group by Col1 label count(Col1) ''\",0)";
  dashboard[199][61] = "Meta error code"; dashboard[199][62] = "Count";
  dashboard[200][61] = `=QUERY({${c("Error Code")};${k("Error Code")}},"select Col1,count(Col1) where Col1 is not null group by Col1 order by count(Col1) desc limit 10 label count(Col1) ''",0)`;

  await writeValues(spreadsheetId, token, a1(DASHBOARD_SHEET, "A1:BK100"), dashboard.slice(0, 100), "USER_ENTERED");
  await writeValues(spreadsheetId, token, a1(DASHBOARD_SHEET, "AX200:BK230"), dashboard.slice(199, 230).map((row) => row.slice(49)), "USER_ENTERED");

  // Dynamic operational tables.
  const latestFormula = `=IFERROR(LET(base,ARRAY_CONSTRAIN(SORT(FILTER({${c("Event Time Jakarta")},${c("WhatsApp Number")},${c("TikTok Username")},${c("Message Text")},${c("Lead State")},${c("Folder Number")},${c("Window Expires At")}},${c("Direction")}="inbound"),1,FALSE),20,7),nums,INDEX(base,,2),folders,INDEX(base,,6),HSTACK(INDEX(base,,1),nums,INDEX(base,,3),INDEX(base,,4),MAP(nums,LAMBDA(n,IFERROR(LOOKUP(2,1/((${c("WhatsApp Number")}=n)*(${c("Direction")}="outbound")),${c("Message Text")}),""))),INDEX(base,,5),folders,MAP(folders,LAMBDA(f,IF(f="","",COUNTIFS(${k("Folder Number")},f,${k("Delivery State")},"delivered")+COUNTIFS(${k("Folder Number")},f,${k("Delivery State")},"read")&"/"&COUNTIF(${k("Folder Number")},f)))),INDEX(base,,7))),{"No conversations","","","","","","","",""})`;
  await writeValues(spreadsheetId, token, a1(DASHBOARD_SHEET, "A38"), [[latestFormula]], "USER_ENTERED");
  const deliveryTable = "=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER({AX2:AX100,BA2:BA100,BB2:BB100,BC2:BC100,BD2:BD100,BE2:BE100,BF2:BF100,BH2:BH100,BI2:BI100,BJ2:BJ100},AX2:AX100<>\"\",BI2:BI100>0),1,TRUE),20,10),{\"No active deliveries\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\"})";
  await writeValues(spreadsheetId, token, a1(DASHBOARD_SHEET, "L38"), [[deliveryTable]], "USER_ENTERED");
  const recentFolders = "=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER({AX2:AX100,BA2:BA100,BB2:BB100,AY2:AY100,BC2:BC100,BE2:BE100,BF2:BF100,BH2:BH100,BJ2:BJ100},AX2:AX100<>\"\"),4,FALSE),20,9),{\"No assignments\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\"})";
  await writeValues(spreadsheetId, token, a1(DASHBOARD_SHEET, "L63"), [[recentFolders]], "USER_ENTERED");
  const attention = `=IFERROR(ARRAY_CONSTRAIN(VSTACK(FILTER({"Username missing",${l("whatsapp_number")},${l("username")},${l("batch_number")},${l("state")},"Valid TikTok username required",${l("updated_at")},${l("window_expires_at")}},${l("whatsapp_number")}<>"",NOT(REGEXMATCH(${l("username")},"^[A-Za-z0-9._]{2,30}$"))),FILTER({"Delivery failed",${k("WhatsApp Number")},${k("TikTok Username")},${k("Folder Number")},${k("Current Result")},${k("Error Details")},${k("Updated At")},""},(${k("Send State")}="failed")+(${k("Current Result")}="Failed")>0),FILTER({"Outcome uncertain",${k("WhatsApp Number")},${k("TikTok Username")},${k("Folder Number")},${k("Current Result")},${k("Error Details")},${k("Updated At")},""},${k("Current Result")}="Outcome uncertain"),FILTER({"Meta error 131042",${k("WhatsApp Number")},${k("TikTok Username")},${k("Folder Number")},${k("Current Result")},${k("Error Details")},${k("Updated At")},""},${k("Error Code")}="131042"),FILTER({"Folder reserved; no clip sent",BB2:BB,BA2:BA,AX2:AX,BJ2:BJ,"No accepted or sent clip",AY2:AY,AZ2:AZ},AX2:AX<>"",(BD2:BD+BE2:BE)=0),FILTER({"Window expired before completion",BB2:BB,BA2:BA,AX2:AX,BJ2:BJ,"Clips remain",AY2:AY,AZ2:AZ},AX2:AX<>"",BI2:BI>0,AZ2:AZ<TEXT(NOW(),"yyyy-mm-ddThh:mm:ss"))),30,8),{"No current issues","","","","","","",""})`;
  await writeValues(spreadsheetId, token, a1(DASHBOARD_SHEET, "A63"), [[attention]], "USER_ENTERED");

  const requests = [];
  const headerColor = { red: 0.08, green: 0.22, blue: 0.38 };
  const successColor = { red: 0.82, green: 0.94, blue: 0.86 };
  const warningColor = { red: 1, green: 0.94, blue: 0.74 };
  const failureColor = { red: 0.98, green: 0.82, blue: 0.82 };
  for (const [sheetId, headers] of [[chatId, finalHeaders.get(CHAT_SHEET)], [clipId, finalHeaders.get(CLIP_SHEET)], [rawId, finalHeaders.get(RAW_SHEET)]]) {
    requests.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } });
    requests.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: headers.length }, cell: { userEnteredFormat: { backgroundColor: headerColor, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true }, horizontalAlignment: "CENTER", wrapStrategy: "WRAP" } }, fields: "userEnteredFormat" } });
    requests.push({ setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: headers.length } } } });
    requests.push({ autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: headers.length } } });
  }
  requests.push({ updateSheetProperties: { properties: { sheetId: rawId, hidden: true }, fields: "hidden" } });
  requests.push({ updateSheetProperties: { properties: { sheetId: dashboardId, gridProperties: { frozenRowCount: 4, frozenColumnCount: 1, hideGridlines: true } }, fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount,gridProperties.hideGridlines" } });
  requests.push({ repeatCell: { range: { sheetId: dashboardId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 21 }, cell: { userEnteredFormat: { backgroundColor: headerColor, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 16 }, verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat" } });
  for (const rowIndex of [3, 25, 36, 61]) requests.push({ repeatCell: { range: { sheetId: dashboardId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 21 }, cell: { userEnteredFormat: { backgroundColor: headerColor, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true }, wrapStrategy: "WRAP" } }, fields: "userEnteredFormat" } });
  for (const rowIndex of [24, 35, 60]) requests.push({ repeatCell: { range: { sheetId: dashboardId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 21 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.88, green: 0.92, blue: 0.96 }, textFormat: { bold: true, fontSize: 12 } } }, fields: "userEnteredFormat" } });
  requests.push({ autoResizeDimensions: { dimensions: { sheetId: dashboardId, dimension: "COLUMNS", startIndex: 0, endIndex: 21 } } });
  requests.push({ updateDimensionProperties: { range: { sheetId: dashboardId, dimension: "COLUMNS", startIndex: 3, endIndex: 5 }, properties: { pixelSize: 260 }, fields: "pixelSize" } });
  requests.push({ updateDimensionProperties: { range: { sheetId: dashboardId, dimension: "COLUMNS", startIndex: 49, endIndex: 63 }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } });
  const resultColumn = clipMap.get("Current Result").index;
  const existingClipRules = sheets.get(CLIP_SHEET).conditionalFormats || [];
  for (let index = existingClipRules.length - 1; index >= 0; index -= 1) {
    requests.push({ deleteConditionalFormatRule: { sheetId: clipId, index } });
  }
  requests.push({ addConditionalFormatRule: { index: 0, rule: { ranges: [{ sheetId: clipId, startRowIndex: 1, startColumnIndex: resultColumn, endColumnIndex: resultColumn + 1 }], booleanRule: { condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "Delivered" }] }, format: { backgroundColor: successColor } } } } });
  requests.push({ addConditionalFormatRule: { index: 0, rule: { ranges: [{ sheetId: clipId, startRowIndex: 1, startColumnIndex: resultColumn, endColumnIndex: resultColumn + 1 }], booleanRule: { condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Failed" }] }, format: { backgroundColor: failureColor } } } } });
  requests.push({ addConditionalFormatRule: { index: 0, rule: { ranges: [{ sheetId: clipId, startRowIndex: 1, startColumnIndex: resultColumn, endColumnIndex: resultColumn + 1 }], booleanRule: { condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "Pending" }] }, format: { backgroundColor: warningColor } } } } });

  // Replace dashboard charts only; no other sheet drawings are touched.
  for (const chart of sheets.get(DASHBOARD_SHEET).charts || []) requests.push({ deleteEmbeddedObject: { objectId: chart.chartId } });
  const chart = (title, range, row, column, type = "LINE") => ({ addChart: { chart: { spec: { title, basicChart: { chartType: type, legendPosition: "BOTTOM_LEGEND", axis: [{ position: "BOTTOM_AXIS", title: "" }, { position: "LEFT_AXIS", title: "Count" }], domains: [{ domain: { sourceRange: { sources: [{ sheetId: dashboardId, startRowIndex: range[0], endRowIndex: range[1], startColumnIndex: range[2], endColumnIndex: range[2] + 1 }] } } }], series: Array.from({ length: range[3] - range[2] - 1 }, (_, index) => ({ series: { sourceRange: { sources: [{ sheetId: dashboardId, startRowIndex: range[0], endRowIndex: range[1], startColumnIndex: range[2] + 1 + index, endColumnIndex: range[2] + 2 + index }] } } })) } }, position: { overlayPosition: { anchorCell: { sheetId: dashboardId, rowIndex: row, columnIndex: column }, widthPixels: 480, heightPixels: 260 } } } } });
  requests.push(chart("Daily unique inbound contacts and interested contacts", [199, 230, 49, 52], 24, 3, "LINE"));
  requests.push(chart("Daily clips sent and delivered", [199, 230, 49, 54], 24, 12, "LINE"));
  requests.push(chart("Delivery-status breakdown", [199, 212, 55, 57], 49, 12, "COLUMN"));
  requests.push(chart("Folder completion breakdown", [199, 210, 58, 60], 49, 17, "COLUMN"));
  requests.push(chart("Top Meta error codes", [199, 211, 61, 63], 74, 12, "BAR"));
  await batchUpdate(spreadsheetId, token, requests);

  const verification = {};
  for (const [title, expectedHeaders] of headerSets) {
    const values = (await getValues(spreadsheetId, token, title, "ZZ")).values || [];
    const current = (values[0] || []).map(text);
    verification[title] = {
      header_count: current.length,
      headers_unique: current.length === new Set(current).size,
      required_headers_present: expectedHeaders.every((header) => current.includes(header)),
      data_rows: Math.max(0, values.length - 1)
    };
    if (!verification[title].headers_unique || !verification[title].required_headers_present) throw new Error(`Header verification failed: ${title}`);
  }
  const dashboardValues = (await getValues(spreadsheetId, token, DASHBOARD_SHEET, "BK")).values || [];
  verification[DASHBOARD_SHEET] = { populated_rows: dashboardValues.length, charts_requested: 5 };
  process.stdout.write(JSON.stringify({ spreadsheet_id: spreadsheetId, appended, updated, verification, backfill_report: backfill.report }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
