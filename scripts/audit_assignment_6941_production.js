"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CREDENTIAL_PATH = process.argv[2] || "/tmp/recovery-6941-google-credential.json";
const OUTPUT_PATH = process.argv[3] || "/tmp/assignment-6941-production-state.json";
const ENV_PATH = process.argv[4] || "/tmp/recovery-6941.env";
const BATCH = "6941";
const PHONE = "6282225211568";
const USERNAME = "jenius_abnormal";
const CONVERSATION = `wa:${PHONE}`;
const SIMPLE_SPREADSHEET_ID = "1Zsq-ngyC1RGOCLlibFI-UyPBW88oQc0aJhC5cxtbrzA";

function readEnv(file) {
  const output = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) output[match[1].trim()] = match[2];
  }
  return output;
}

function text(value) { return value == null ? "" : String(value).trim(); }
function digits(value) { return text(value).replace(/\D/g, ""); }
function username(value) { return text(value).normalize("NFKC").replace(/^@+/, "").toLowerCase(); }
function table(values) {
  const headers = (values?.[0] || []).map(text);
  return {
    headers,
    rows: (values || []).slice(1).map((row, index) => ({ row_number: index + 2, ...Object.fromEntries(headers.map((name, column) => [name, text(row[column])])) }))
      .filter((row) => Object.entries(row).some(([key, value]) => key !== "row_number" && text(value))),
  };
}

async function accessToken() {
  const exported = JSON.parse(fs.readFileSync(CREDENTIAL_PATH, "utf8"));
  if (!Array.isArray(exported) || exported.length !== 1) throw new Error("exactly one exported credential is required");
  const data = exported[0].data || {};
  const token = typeof data.oauthTokenData === "string" ? JSON.parse(data.oauthTokenData) : data.oauthTokenData;
  if (!token?.refresh_token || !data.clientId || !data.clientSecret) throw new Error("Google OAuth refresh material is incomplete");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: data.clientId, client_secret: data.clientSecret, refresh_token: token.refresh_token, grant_type: "refresh_token" }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(`Google OAuth refresh failed: ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body.access_token;
}

async function googleJson(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.text();
  if (!response.ok) throw new Error(`Google API read failed ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}

async function batchGet(spreadsheetId, ranges, token) {
  const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join("&");
  return googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${query}&majorDimension=ROWS`, token);
}

(async () => {
  const env = fs.existsSync(ENV_PATH) ? readEnv(ENV_PATH) : process.env;
  if (!env.AFFILIATE_TRACKER_SPREADSHEET_ID) throw new Error("AFFILIATE_TRACKER_SPREADSHEET_ID is missing");
  const token = await accessToken();
  const ranges = [
    "WhatsApp Leads!A:AE",
    "Affiliate Assignments!A:M",
    "Delivery Log!A:R",
    "WhatsApp Message Log!A:X",
  ];
  const detailed = await batchGet(env.AFFILIATE_TRACKER_SPREADSHEET_ID, ranges, token);
  const simple = await batchGet(SIMPLE_SPREADSHEET_ID, ["Delivery Log!A:G"], token);
  const tables = Object.fromEntries(ranges.map((range, index) => [range.split("!")[0], table(detailed.valueRanges?.[index]?.values || [])]));
  const simpleTable = table(simple.valueRanges?.[0]?.values || []);
  const leads = tables["WhatsApp Leads"].rows;
  const assignments = tables["Affiliate Assignments"].rows;
  const delivery = tables["Delivery Log"].rows;
  const messages = tables["WhatsApp Message Log"].rows;

  const leadRows = leads.filter((row) => row.batch_number === BATCH || digits(row.wa_id || row.whatsapp_number) === PHONE || username(row.username) === username(USERNAME));
  const assignmentRows = assignments.filter((row) => row.original_batch_number === BATCH || row.batch_number === BATCH || row.conversation_id === CONVERSATION || digits(row.whatsapp_number) === PHONE || username(row.username) === username(USERNAME));
  const deliveryRows = delivery.filter((row) => row.batch_number === BATCH || row.conversation_id === CONVERSATION || digits(row.whatsapp_number) === PHONE || text(row.delivery_key).startsWith(`${CONVERSATION}:${BATCH}:`));
  const messageRows = messages.filter((row) => row.conversation_id === CONVERSATION || digits(row.recipient_number || row.whatsapp_number) === PHONE || text(row.source_reference).startsWith(`${CONVERSATION}:${BATCH}:`));
  const simpleRows = simpleTable.rows.filter((row) => text(row["Numbered Folder"] || row.batch_number) === BATCH || username(row.Username || row.username) === username(USERNAME));

  const folder = `/clips_whatsapp/${BATCH}`;
  const diskFiles = fs.existsSync(folder)
    ? fs.readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp4")).map((entry) => entry.name).sort((a, b) => a.localeCompare(b))
    : [];
  const successfulDelivery = deliveryRows.filter((row) => row.whatsapp_message_id || ["accepted", "sent", "delivered", "read"].includes(row.send_state) || ["sent", "delivered", "read"].includes(row.delivery_state));
  const successfulMessages = messageRows.filter((row) => row.direction === "outbound" && row.message_type === "video" && row.whatsapp_message_id);
  const messageIds = [...successfulDelivery.map((row) => row.whatsapp_message_id), ...successfulMessages.map((row) => row.whatsapp_message_id)].filter(Boolean);
  const output = {
    captured_at: new Date().toISOString(),
    assignment: { batch_number: BATCH, conversation_id: CONVERSATION, phone: PHONE, username: USERNAME },
    schema: {
      leads: tables["WhatsApp Leads"].headers,
      assignments: tables["Affiliate Assignments"].headers,
      delivery: tables["Delivery Log"].headers,
      messages: tables["WhatsApp Message Log"].headers,
      simple: simpleTable.headers,
    },
    lead_rows: leadRows,
    assignment_rows: assignmentRows,
    delivery_rows: deliveryRows,
    message_rows: messageRows,
    simple_log_rows: simpleRows,
    schema_samples: {
      recent_successful_delivery_rows: delivery.filter((row) => row.whatsapp_message_id).slice(-5),
      recent_outbound_video_message_rows: messages.filter((row) => row.direction === "outbound" && row.message_type === "video" && row.whatsapp_message_id).slice(-5),
    },
    disk_folder: folder,
    disk_files: diskFiles,
    summary: {
      lead_rows: leadRows.length,
      exact_lead_owners: leadRows.filter((row) => row.batch_number === BATCH && digits(row.wa_id || row.whatsapp_number) === PHONE && username(row.username) === username(USERNAME)).length,
      assignment_rows: assignmentRows.length,
      delivery_rows: deliveryRows.length,
      message_rows: messageRows.length,
      simple_log_rows: simpleRows.length,
      disk_mp4_count: diskFiles.length,
      durable_success_rows: successfulDelivery.length,
      durable_message_rows: successfulMessages.length,
      distinct_durable_message_ids: new Set(messageIds).size,
    },
    integrity_sha256: "",
  };
  output.integrity_sha256 = crypto.createHash("sha256").update(JSON.stringify({ ...output, integrity_sha256: "" })).digest("hex");
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify({ output: OUTPUT_PATH, captured_at: output.captured_at, summary: output.summary, lead_state: leadRows.map((row) => ({ row_number: row.row_number, state: row.state, last_intent: row.last_intent, last_inbound_at: row.last_inbound_at, window_expires_at: row.window_expires_at, batch_number: row.batch_number })), integrity_sha256: output.integrity_sha256 }, null, 2) + "\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
