"use strict";

const fs = require("node:fs");
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");

const APPLY = process.argv.includes("--apply");
const CREDENTIAL = "/tmp/recovery-6941-google-credential-node.json";
const OUTPUT = "/tmp/assignment-6941-execution-24658-reconciliation.json";
const EXECUTION_ID = 24658;
const DETAIL = process.env.AFFILIATE_TRACKER_SPREADSHEET_ID;
const SIMPLE = "1Zsq-ngyC1RGOCLlibFI-UyPBW88oQc0aJhC5cxtbrzA";
const CONVERSATION = "wa:6282225211568";
const PHONE = "6282225211568";
const USERNAME = "jenius_abnormal";
const BATCH = "6941";
const EXPECTED_PENDING = [5,6,7,8,9,10,11,12,13,14,15];
const VALID_WAMID = /^wamid\.[A-Za-z0-9_+=\/-]{12,}$/;

function text(value) { return value == null ? "" : String(value).trim(); }
function digits(value) { return text(value).replace(/\D/g, ""); }
function assert(value, message) { if (!value) throw new Error(message); }
function table(values) {
  const headers = (values?.[0] || []).map(text);
  return { headers, rows: (values || []).slice(1).map((row, index) => ({ row_number: index + 2, ...Object.fromEntries(headers.map((name, column) => [name, text(row[column])])) })) };
}
function same(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function sqliteGet(db, sql, params = []) { return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row))); }
function sqliteAll(db, sql, params = []) { return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows))); }
function executionItems(run, name) {
  return (run[name] || []).flatMap((entry) => (entry?.data?.main || []).flatMap((branch) => branch || []).map((item) => item.json || {}));
}
async function executionEvidence() {
  const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
  try {
    const row = await sqliteGet(db, 'select e.id,e."workflowId",e.status,e."startedAt",e."stoppedAt",d.data from execution_entity e join execution_data d on d."executionId"=e.id where e.id=?', [EXECUTION_ID]);
    assert(row && row.workflowId === "AffWaDelivery2026" && row.status === "error", "recovery_execution_identity_or_status_changed");
    const parsed = parse(row.data), run = parsed?.resultData?.runData || {};
    assert(parsed?.resultData?.lastNodeExecuted === "Ensure Outbound Log Recovery Table", "recovery_failure_point_changed");
    const prepared = executionItems(run, "Prepare Resumable Delivery Items");
    const cached = executionItems(run, "Restore Existing Media Upload");
    const uploads = executionItems(run, "Parse Media Upload");
    const sends = executionItems(run, "Parse Video Send");
    const tracking = executionItems(run, "Prepare Batched Delivery Tracking");
    const indexes = prepared.map((item) => Number(item.file_index));
    assert(same(indexes, EXPECTED_PENDING), "execution_pending_set_not_exactly_5_through_15");
    assert(prepared.length === 11 && prepared.every((item) => Number(item.attempts) === 2), "execution_prepared_attempts_invalid");
    assert(cached.length === 1 && Number(cached[0].file_index) === 5 && cached[0].media_id === "1036446072487271" && cached[0].reused_media_upload === true, "clip_5_cache_reuse_not_proven");
    assert(uploads.length === 10 && same(uploads.map((item) => Number(item.file_index)), EXPECTED_PENDING.slice(1)) && uploads.every((item) => item.upload_success === true && item.media_id), "new_upload_evidence_invalid");
    assert(sends.length === 11 && same(sends.map((item) => Number(item.file_index)), EXPECTED_PENDING), "send_result_set_invalid");
    assert(sends.every((item) => item.send_success === true && item.api_status === "accepted" && VALID_WAMID.test(text(item.whatsapp_message_id)) && Number(item.attempts) === 2 && !item.last_error), "send_result_not_all_successful");
    assert(new Set(sends.map((item) => item.whatsapp_message_id)).size === 11, "new_message_ids_not_unique");
    assert(tracking.length === 1 && tracking[0].delivery_updates?.length === 11 && tracking[0].message_rows?.length === 11 && tracking[0].message_count === 11, "persisted_tracking_batch_invalid");
    const open = await sqliteAll(db, `select e.id,e."workflowId",e.status from execution_entity e join execution_data d on d."executionId"=e.id where e.status in ('new','running','waiting') and (d.data like ? or d.data like ? or d.data like ?)`, [`%${CONVERSATION}:${BATCH}:%`, `%${PHONE}%`, `%${USERNAME}%`]);
    assert(open.length === 0, "active_scoped_execution_exists_during_reconciliation");
    return { row, prepared, cached, uploads, sends, tracking: tracking[0] };
  } finally { db.close(); }
}
async function accessToken() {
  const exported = JSON.parse(fs.readFileSync(CREDENTIAL, "utf8"));
  assert(Array.isArray(exported) && exported.length === 1, "credential_export_invalid");
  const data = exported[0].data, oauth = typeof data.oauthTokenData === "string" ? JSON.parse(data.oauthTokenData) : data.oauthTokenData;
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: data.clientId, client_secret: data.clientSecret, refresh_token: oauth.refresh_token, grant_type: "refresh_token" }) });
  const body = await response.json(); assert(response.ok && body.access_token, "oauth_refresh_failed"); return body.access_token;
}
async function google(url, token, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}) }, signal: AbortSignal.timeout(45000) });
  const body = await response.text(); if (!response.ok) throw new Error(`google_${response.status}:${body.slice(0,500)}`); return body ? JSON.parse(body) : {};
}
async function readState(token) {
  const ranges = ["WhatsApp Leads!A:AF", "Affiliate Assignments!A:M", "Delivery Log!A:R", "WhatsApp Message Log!A:X"];
  const detail = await google(`https://sheets.googleapis.com/v4/spreadsheets/${DETAIL}/values:batchGet?${ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join("&")}&majorDimension=ROWS`, token);
  const simple = await google(`https://sheets.googleapis.com/v4/spreadsheets/${SIMPLE}/values/${encodeURIComponent("Delivery Log!A:G")}`, token);
  return { detail: Object.fromEntries(ranges.map((range, index) => [range.split("!")[0], table(detail.valueRanges?.[index]?.values || [])])), simple: table(simple.values || []) };
}
function validateBefore(state, evidence) {
  const leads = state.detail["WhatsApp Leads"].rows;
  const owners = leads.filter((row) => row.batch_number === BATCH);
  assert(owners.length === 1 && owners[0].conversation_id === CONVERSATION && owners[0].username === USERNAME && digits(owners[0].wa_id || owners[0].whatsapp_number) === PHONE, "folder_owner_changed");
  const lead = owners[0];
  assert(lead.state === "awaiting_username" && lead.last_intent === "clarification_pending" && lead.delivery_state === "delivery_in_progress" && lead.files_expected === "15", "lead_state_changed_before_reconciliation");
  const assignments = state.detail["Affiliate Assignments"].rows.filter((row) => row.original_batch_number === BATCH || row.batch_number === BATCH);
  assert(assignments.every((row) => (!row.username || row.username === USERNAME) && (!row.conversation_id || row.conversation_id === CONVERSATION)), "assignment_owner_conflict");
  const rows = state.detail["Delivery Log"].rows.filter((row) => row.batch_number === BATCH && row.conversation_id === CONVERSATION).sort((a,b) => Number(a.file_index)-Number(b.file_index));
  assert(rows.length === 15 && same(rows.map((row) => Number(row.file_index)), [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]), "canonical_delivery_rows_changed");
  const durable = rows.filter((row) => row.whatsapp_message_id);
  assert(durable.length === 4 && same(durable.map((row) => Number(row.file_index)), [1,2,3,4]) && durable.every((row) => Number(row.attempts) === 1), "protected_clip_state_changed");
  assert(new Set(durable.map((row) => row.whatsapp_message_id)).size === 4, "protected_message_ids_not_unique");
  const pending = rows.slice(4);
  assert(pending.every((row) => row.send_state === "send_prepared" && !row.whatsapp_message_id && Number(row.attempts) === 2), "post_send_claim_rows_changed");
  assert(pending[0].media_id === "1036446072487271" && pending.slice(1).every((row) => !row.media_id), "post_send_media_claim_state_changed");
  const messages = state.detail["WhatsApp Message Log"].rows.filter((row) => row.direction === "outbound" && row.message_type === "video" && text(row.source_reference).startsWith(`${CONVERSATION}:${BATCH}:`));
  assert(messages.length === 4 && !messages.some((row) => evidence.sends.some((send) => send.whatsapp_message_id === row.whatsapp_message_id)), "new_message_log_rows_already_exist_or_conflict");
  const simpleRows = state.simple.rows.filter((row) => row["Numbered Folder"] === BATCH);
  assert(simpleRows.length === 1 && simpleRows[0].Username === USERNAME && digits(simpleRows[0]["WhatsApp Number"]) === PHONE && simpleRows[0]["Clips Sent"] === "4/15" && simpleRows[0].Status === "Partial", "simple_log_precondition_changed");
  for (let offset = 0; offset < 11; offset++) {
    const update = evidence.tracking.delivery_updates[offset], expectedRow = rows[offset + 4];
    assert(update.range === `Delivery Log!A${expectedRow.row_number}:R${expectedRow.row_number}`, `delivery_update_range_mismatch_clip_${offset+5}`);
    assert(Number(update.values?.[0]?.[4]) === offset + 5 && update.values[0][7] === evidence.sends[offset].whatsapp_message_id && update.values[0][8] === "accepted" && update.values[0][16] === "accepted", `delivery_update_payload_mismatch_clip_${offset+5}`);
  }
  return { lead, rows, messages, simpleRow: simpleRows[0] };
}
function validateAfter(state, evidence, before) {
  const leads = state.detail["WhatsApp Leads"].rows.filter((row) => row.batch_number === BATCH);
  assert(leads.length === 1, "final_owner_count_invalid");
  const lead = leads[0];
  assert(lead.state === before.lead.state && lead.last_intent === before.lead.last_intent, "conversation_state_or_intent_overwritten");
  assert(lead.delivery_state === "files_sent" && lead.files_expected === "15" && lead.files_sent === "15" && lead.files_delivered === "0" && lead.files_failed === "0" && !lead.last_error, "final_delivery_summary_invalid");
  const rows = state.detail["Delivery Log"].rows.filter((row) => row.batch_number === BATCH && row.conversation_id === CONVERSATION).sort((a,b) => Number(a.file_index)-Number(b.file_index));
  const successful = rows.filter((row) => VALID_WAMID.test(row.whatsapp_message_id) && ["accepted","sent","delivered","read"].includes(row.send_state || row.state));
  assert(rows.length === 15 && successful.length === 15 && new Set(successful.map((row) => row.delivery_key)).size === 15 && new Set(successful.map((row) => row.whatsapp_message_id)).size === 15, "final_durable_delivery_integrity_invalid");
  assert(rows.slice(0,4).every((row) => Number(row.attempts) === 1) && rows.slice(4).every((row) => Number(row.attempts) === 2), "final_attempt_counts_invalid");
  const messages = state.detail["WhatsApp Message Log"].rows.filter((row) => row.direction === "outbound" && row.message_type === "video" && text(row.source_reference).startsWith(`${CONVERSATION}:${BATCH}:`));
  assert(messages.length === 15 && new Set(messages.map((row) => row.whatsapp_message_id)).size === 15 && new Set(messages.map((row) => row.source_reference)).size === 15, "final_message_log_integrity_invalid");
  const simpleRows = state.simple.rows.filter((row) => row["Numbered Folder"] === BATCH);
  assert(simpleRows.length === 1 && simpleRows[0].row_number === before.simpleRow.row_number && simpleRows[0].Username === USERNAME && digits(simpleRows[0]["WhatsApp Number"]) === PHONE && simpleRows[0]["Clips Sent"] === "15/15" && simpleRows[0].Status === "Complete" && !simpleRows[0].Error, "final_simple_log_invalid");
  return { lead, rows, messages, simpleRow: simpleRows[0] };
}

(async () => {
  assert(DETAIL, "spreadsheet_id_missing");
  const evidence = await executionEvidence();
  const token = await accessToken();
  const beforeState = await readState(token);
  const before = validateBefore(beforeState, evidence);
  const now = new Date().toISOString();
  const messageHeader = beforeState.detail["WhatsApp Message Log"].headers;
  assert(messageHeader.length === 24, "message_log_header_changed");
  const lastMessageRow = Math.max(1, ...beforeState.detail["WhatsApp Message Log"].rows.map((row) => row.row_number));
  const detailUpdates = [
    ...evidence.tracking.delivery_updates,
    ...evidence.tracking.message_rows.map((values, index) => ({ range: `WhatsApp Message Log!A${lastMessageRow+1+index}:X${lastMessageRow+1+index}`, majorDimension: "ROWS", values: [values] })),
    { range: `WhatsApp Leads!P${before.lead.row_number}:U${before.lead.row_number}`, majorDimension: "ROWS", values: [["15","15","0","0", before.lead.files_sent_at || now, ""]] },
    { range: `WhatsApp Leads!AA${before.lead.row_number}:AB${before.lead.row_number}`, majorDimension: "ROWS", values: [["",now]] },
    { range: `WhatsApp Leads!AF${before.lead.row_number}:AF${before.lead.row_number}`, majorDimension: "ROWS", values: [["files_sent"]] },
  ];
  const simpleValues = [BATCH, USERNAME, PHONE, before.simpleRow["Sent At"], "15/15", "Complete", ""];
  if (APPLY) {
    await google(`https://sheets.googleapis.com/v4/spreadsheets/${DETAIL}/values:batchUpdate`, token, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: detailUpdates }) });
    await google(`https://sheets.googleapis.com/v4/spreadsheets/${SIMPLE}/values/${encodeURIComponent(`Delivery Log!A${before.simpleRow.row_number}:G${before.simpleRow.row_number}`)}?valueInputOption=RAW`, token, { method: "PUT", body: JSON.stringify({ majorDimension: "ROWS", values: [simpleValues] }) });
  }
  const afterState = await readState(token);
  const after = APPLY ? validateAfter(afterState, evidence, before) : null;
  const report = {
    mode: APPLY ? "applied" : "dry_run",
    reconciled_at: new Date().toISOString(),
    recovery_execution_id: String(EXECUTION_ID),
    exact_recovery_indexes: evidence.prepared.map((item) => Number(item.file_index)),
    protected_indexes: [1,2,3,4],
    cached_media_reused: evidence.cached[0].media_id,
    new_uploads: evidence.uploads.length,
    new_whatsapp_sends: evidence.sends.length,
    new_unique_message_ids: new Set(evidence.sends.map((item) => item.whatsapp_message_id)).size,
    detail_update_count: detailUpdates.length,
    simple_log_row: before.simpleRow.row_number,
    clips: evidence.sends.map((send) => ({ index: Number(send.file_index), file_name: send.file_name, cached_media_used: Number(send.file_index) === 5, new_upload: Number(send.file_index) !== 5, media_id: send.media_id, upload_result: "success", send_result: "accepted", whatsapp_message_id: send.whatsapp_message_id, attempts: Number(send.attempts) })),
    final: after ? { delivery_state: after.lead.delivery_state, expected: Number(after.lead.files_expected), sent: Number(after.lead.files_sent), delivered: Number(after.lead.files_delivered), failed: Number(after.lead.files_failed), conversation_state: after.lead.state, last_intent: after.lead.last_intent, durable_message_ids: new Set(after.rows.map((row) => row.whatsapp_message_id)).size, message_log_rows: after.messages.length, simple_log: after.simpleRow, owner_count: afterState.detail["WhatsApp Leads"].rows.filter((row) => row.batch_number === BATCH).length } : null,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
