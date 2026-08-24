"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CREDENTIAL = process.argv[2] || "/tmp/state-model-google-credential.json";
const BACKUP_FILE = process.argv[3] || path.join(ROOT, "n8n", "exports", "live-backups", "before-state-model-separation-20260821T1725CST", "canonical-sheet-backup.json");
const OUTPUT = process.argv[4] || path.join(ROOT, "n8n", "exports", "state-model-separation-20260821", "sheet-migration-report.json");
const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
const spreadsheetId = backup.spreadsheet_id;
const SHEET = "WhatsApp Leads";

function text(value) { return value == null ? "" : String(value).trim(); }
function table(values) { const headers = (values?.[0] || []).map(text); return { headers, rows: (values || []).slice(1).map((row, index) => ({ row_number: index + 2, ...Object.fromEntries(headers.map((name, column) => [name, text(row[column])])) })) }; }
async function accessToken() {
  const exported = JSON.parse(fs.readFileSync(CREDENTIAL, "utf8"));
  if (!Array.isArray(exported) || exported.length !== 1) throw new Error("credential_invalid");
  const data = exported[0].data;
  const oauth = typeof data.oauthTokenData === "string" ? JSON.parse(data.oauthTokenData) : data.oauthTokenData;
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: data.clientId, client_secret: data.clientSecret, refresh_token: oauth.refresh_token, grant_type: "refresh_token" }) });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error("oauth_refresh_failed");
  return body.access_token;
}
async function google(token, route, options = {}) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${route}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}) }, signal: AbortSignal.timeout(45000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`google_${response.status}_${route}:${body.slice(0, 600)}`);
  return body ? JSON.parse(body) : {};
}
function styleSignature(cell) {
  const format = cell?.userEnteredFormat || {};
  return JSON.stringify({ backgroundColor: format.backgroundColor || {}, backgroundColorStyle: format.backgroundColorStyle || {}, textFormat: format.textFormat || {}, horizontalAlignment: format.horizontalAlignment || "", verticalAlignment: format.verticalAlignment || "", wrapStrategy: format.wrapStrategy || "", numberFormat: format.numberFormat || {} });
}

(async () => {
  const token = await accessToken();
  const before = await google(token, `/values/${encodeURIComponent(`${SHEET}!A:AF`)}?majorDimension=ROWS`);
  const current = table(before.values || []);
  const expectedLegacy = backup.tables[SHEET].headers;
  if (!expectedLegacy.every((name, index) => current.headers[index] === name)) throw new Error("live_lead_header_no_longer_matches_backup_prefix");
  let insertedColumn = false;
  let sheetId;
  if (current.headers[31] !== "delivery_state") {
    const metadata = await google(token, `?fields=${encodeURIComponent("sheets(properties(sheetId,title,gridProperties))")}`);
    const sheet = metadata.sheets?.find((item) => item.properties?.title === SHEET);
    if (!sheet) throw new Error("whatsapp_leads_sheet_missing");
    sheetId = sheet.properties.sheetId;
    const columnCount = Number(sheet.properties.gridProperties?.columnCount || 0);
    if (columnCount <= 31) {
      await google(token, ":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ insertDimension: { range: { sheetId, dimension: "COLUMNS", startIndex: 31, endIndex: 32 }, inheritFromBefore: true } }] }) });
      insertedColumn = true;
    }
    await google(token, `/values/${encodeURIComponent(`${SHEET}!AF1`)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ majorDimension: "ROWS", values: [["delivery_state"]] }) });
  }

  const fresh = table((await google(token, `/values/${encodeURIComponent(`${SHEET}!A:AF`)}?majorDimension=ROWS`)).values || []);
  if (fresh.headers.length !== 32 || fresh.headers[31] !== "delivery_state") throw new Error("delivery_state_header_migration_failed");
  const originalByRow = new Map(backup.tables[SHEET].rows.map((row) => [row.row_number, row]));
  const freshByRow = new Map(fresh.rows.map((row) => [row.row_number, row]));
  const migrations = backup.assigned_lead_derivations.map((derived) => {
    const original = originalByRow.get(derived.row_number);
    const live = freshByRow.get(derived.row_number);
    if (!original || !live) throw new Error(`assigned_lead_row_missing:${derived.row_number}`);
    for (const field of ["conversation_id", "username", "batch_number"]) {
      if (text(live[field]) !== text(original[field])) throw new Error(`assigned_lead_identity_changed:${derived.row_number}:${field}`);
    }
    if (!/^(?:delivery_in_progress|partial|files_sent|files_delivered|failed)$/.test(derived.derived_delivery_state)) throw new Error(`invalid_derived_delivery_state:${derived.row_number}`);
    return { row_number: derived.row_number, conversation_id: derived.conversation_id, username: derived.username, batch_number: derived.batch_number, delivery_state: derived.derived_delivery_state, durable_success_count: derived.durable_success_count, durable_failed_count: derived.durable_failed_count };
  });
  const assignment6941 = migrations.find((item) => item.batch_number === "6941");
  if (!assignment6941 || assignment6941.delivery_state !== "partial" || assignment6941.durable_success_count !== 4) throw new Error("assignment_6941_migration_evidence_mismatch");

  await google(token, "/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: migrations.map((item) => ({ range: `${SHEET}!AF${item.row_number}`, majorDimension: "ROWS", values: [[item.delivery_state]] })) }) });
  const verified = table((await google(token, `/values/${encodeURIComponent(`${SHEET}!A:AF`)}?majorDimension=ROWS`)).values || []);
  const verifiedByRow = new Map(verified.rows.map((row) => [row.row_number, row]));
  for (const item of migrations) {
    const row = verifiedByRow.get(item.row_number);
    if (row?.delivery_state !== item.delivery_state) throw new Error(`delivery_state_verification_failed:${item.row_number}`);
    const original = originalByRow.get(item.row_number);
    for (const field of ["conversation_id", "username", "batch_number"]) if (text(row[field]) !== text(original[field])) throw new Error(`identity_changed_during_migration:${item.row_number}:${field}`);
  }
  const nonAssignedPopulated = verified.rows.filter((row) => !/^\d+$/.test(row.batch_number) && row.delivery_state).length;
  if (nonAssignedPopulated !== 0) throw new Error(`unexpected_unassigned_delivery_state_values:${nonAssignedPopulated}`);

  const grid = await google(token, `?includeGridData=true&ranges=${encodeURIComponent(`${SHEET}!AE1:AF3`)}&fields=${encodeURIComponent("sheets(data(rowData(values(formattedValue,userEnteredFormat))))")}`);
  const headerCells = grid.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values || [];
  const styleInherited = headerCells.length >= 2 && styleSignature(headerCells[0]) === styleSignature(headerCells[1]);
  const report = {
    migrated_at: new Date().toISOString(), spreadsheet_id: spreadsheetId, sheet: SHEET, sheet_id: sheetId || 1403034871,
    inserted_column: insertedColumn, header: verified.headers, migrated_assigned_leads: migrations.length,
    untouched_unassigned_leads: verified.rows.filter((row) => !/^\d+$/.test(row.batch_number)).length,
    populated_unassigned_delivery_states: nonAssignedPopulated, header_style_inherited: styleInherited,
    assignment_6941: { row_number: assignment6941.row_number, conversation_id: assignment6941.conversation_id, delivery_state: assignment6941.delivery_state, durable_success_count: assignment6941.durable_success_count, files_expected: "15" },
    state_values_written: Object.fromEntries([...new Set(migrations.map((item) => item.delivery_state))].sort().map((state) => [state, migrations.filter((item) => item.delivery_state === state).length])),
    migration_sha256: crypto.createHash("sha256").update(JSON.stringify(migrations)).digest("hex")
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
