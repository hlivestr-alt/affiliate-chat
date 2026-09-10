"use strict";

const fs = require("node:fs");
const credentialPath = process.argv[2] || "/tmp/google-sheets-credential.json";
const outputPath = process.argv[3] || "";
const simpleSpreadsheetId = "1Zsq-ngyC1RGOCLlibFI-UyPBW88oQc0aJhC5cxtbrzA";
const target = { batch: "6944", phone: "6281910833031", username: "kerlinday01", conversation: "wa:6281910833031" };
const text = (value) => value == null ? "" : String(value).trim();
const digits = (value) => text(value).replace(/\D/g, "");
function records(values) {
  const headers = (values?.[0] || []).map(text);
  return { headers, rows: (values || []).slice(1).map((row, index) => ({ row_number: index + 2, returned_width: row.length, ...Object.fromEntries(headers.map((name, column) => [name, text(row[column])])) })).filter((row) => headers.some((name) => text(row[name]))) };
}
async function accessToken() {
  const exported = JSON.parse(fs.readFileSync(credentialPath, "utf8"));
  const data = exported?.[0]?.data || {};
  const oauth = typeof data.oauthTokenData === "string" ? JSON.parse(data.oauthTokenData) : data.oauthTokenData;
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: data.clientId, client_secret: data.clientSecret, refresh_token: oauth.refresh_token, grant_type: "refresh_token" }) });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(`oauth_refresh_${response.status}`);
  return body.access_token;
}
async function batchGet(spreadsheet, ranges, token) {
  const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join("&");
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet}/values:batchGet?${query}&majorDimension=ROWS`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.text();
  if (!response.ok) throw new Error(`google_read_${response.status}:${body.slice(0, 300)}`);
  return JSON.parse(body);
}
(async () => {
  const spreadsheetId = process.env.AFFILIATE_TRACKER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("AFFILIATE_TRACKER_SPREADSHEET_ID missing");
  const token = await accessToken();
  const ranges = ["WhatsApp Leads!A:AF", "Affiliate Assignments!A:Z", "Delivery Log!A:R", "WhatsApp Message Log!A:X"];
  const main = await batchGet(spreadsheetId, ranges, token);
  const simple = await batchGet(simpleSpreadsheetId, ["Delivery Log!A:G"], token);
  const tables = Object.fromEntries(ranges.map((range, index) => [range.split("!")[0], records(main.valueRanges?.[index]?.values || [])]));
  tables["Simple Delivery Log"] = records(simple.valueRanges?.[0]?.values || []);
  const leadRows = tables["WhatsApp Leads"].rows.filter((row) => row.conversation_id === target.conversation || (row.batch_number === target.batch && digits(row.wa_id || row.whatsapp_number) === target.phone));
  const assignmentRows = tables["Affiliate Assignments"].rows.filter((row) => row.original_batch_number === target.batch || row.batch_number === target.batch || row.conversation_id === target.conversation);
  const deliveryRows = tables["Delivery Log"].rows.filter((row) => row.batch_number === target.batch && row.conversation_id === target.conversation).sort((a, b) => Number(a.file_index) - Number(b.file_index));
  const messageRows = tables["WhatsApp Message Log"].rows.filter((row) => text(row.source_reference).startsWith(`${target.conversation}:${target.batch}:`) || (digits(row.recipient_number || row.whatsapp_number) === target.phone && row.message_type === "video"));
  const simpleRows = tables["Simple Delivery Log"].rows.filter((row) => text(row["Numbered Folder"]) === target.batch || (digits(row.WhatsApp) === target.phone && text(row.Username).toLowerCase() === target.username));
  const folder = `/clips_whatsapp/${target.batch}`;
  const diskFiles = fs.existsSync(folder) ? fs.readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp4")).map((entry) => entry.name).sort((a, b) => a.localeCompare(b)) : [];
  const output = { captured_at: new Date().toISOString(), schemas: Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, table.headers])), target, lead_rows: leadRows, assignment_rows: assignmentRows, delivery_rows: deliveryRows, message_rows: messageRows, simple_log_rows: simpleRows, disk_files: diskFiles };
  if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
