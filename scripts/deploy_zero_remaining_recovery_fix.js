"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const WORKFLOW_ID = "AffWaDelivery2026";
const ALLOWED_SETTINGS = ["saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder", "callerPolicy", "callerIds", "timeSavedPerExecution", "redactionPolicy", "availableInMCP", "customTelemetryTags"];
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const i = line.indexOf("="); return i > 0 ? [line.slice(0, i), line.slice(i + 1)] : ["", ""]; }).filter(([key]) => key));
const id = () => crypto.randomUUID();
async function api(route, options = {}) { const response = await fetch(API + route, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY, ...(options.body ? { "Content-Type": "application/json" } : {}) } }); const body = await response.text(); if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 900)}`); return body ? JSON.parse(body) : {}; }
function payload(workflow) { return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: Object.fromEntries(ALLOWED_SETTINGS.filter((name) => Object.hasOwn(workflow.settings || {}, name)).map((name) => [name, workflow.settings[name]])) }; }
function ifNode(name, expression, position) {
  return { id: id(), name, type: "n8n-nodes-base.if", typeVersion: 2.3, position, parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 }, conditions: [{ id: id(), leftValue: expression, rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" }, options: {} } };
}

const prepareCode = `function text(value) { return value == null ? "" : String(value).trim(); }
function records(values) {
  const rows = Array.isArray(values) ? values : [];
  const headers = (rows[0] || []).map(text);
  return rows.slice(1).map((row, index) => ({ row_number: index + 2, ...Object.fromEntries(headers.map((name, column) => [name, text(row[column])])) }));
}
function validMessageId(value) { return /^wamid\\.[A-Za-z0-9_+=\\/-]{12,}$/.test(text(value)); }
function normalizedUsername(value) { return text(value).normalize("NFKC").replace(/^@+/, "").toLowerCase(); }
function digits(value) { return text(value).replace(/\\D/g, ""); }

const source = $("Restore and Validate Delivery Context").first().json;
if (source.delivery_context_valid !== true) throw new Error("delivery_context_not_validated");
const deliveryRows = records(source.delivery_log_values).filter((row) => row.conversation_id === text(source.conversation_id) && row.batch_number === text(source.batch_number));
const messageRows = records(source.message_log_values).filter((row) => row.direction === "outbound" && row.message_type === "video");
const blockedDeliveryKeys = new Set();
for (const row of deliveryRows) {
  const uploadReady = ["upload_ready", "upload_ready_no_message"].includes(row.send_state) && Boolean(row.media_id) && !row.whatsapp_message_id;
  const uncertainOrAccepted = ["accepted", "sent", "outcome_uncertain"].includes(row.send_state) || ["accepted", "sent", "delivered", "read", "outcome_uncertain"].includes(row.state) || (!uploadReady && Boolean(row.media_id)) || Boolean(row.whatsapp_message_id);
  if (uncertainOrAccepted) blockedDeliveryKeys.add(row.delivery_key);
}
for (const row of messageRows) {
  if (row.source_reference && (row.whatsapp_message_id || ["accepted", "sent", "outcome_uncertain"].includes(row.send_state || row.api_status))) blockedDeliveryKeys.add(row.source_reference);
}

const items = $input.all().sort((a, b) => text(a.binary?.data?.fileName).localeCompare(text(b.binary?.data?.fileName)));
const expectedCount = Number(source.expected_clip_count);
if (items.length !== expectedCount) throw new Error(\`Assigned batch must contain exactly \${expectedCount} MP4 files; found \${items.length}\`);
const prepared = items.map((item, index) => {
  const fileName = text(item.binary?.data?.fileName);
  const deliveryKey = \`\${text(source.conversation_id)}:\${text(source.batch_number)}:\${fileName}\`;
  const existing = deliveryRows.find((row) => row.delivery_key === deliveryKey || row.file_name === fileName);
  return { json: { ...source, file_index: index + 1, file_name: fileName, delivery_key: deliveryKey, attempts: Number(existing?.attempts || 0) + 1, delivery_log_row_number: existing?.row_number || "", existing_media_id: ["upload_ready", "upload_ready_no_message"].includes(existing?.send_state) ? existing.media_id : "", existing_uploaded_at: ["upload_ready", "upload_ready_no_message"].includes(existing?.send_state) ? existing.uploaded_at : "", resume_blocked: blockedDeliveryKeys.has(deliveryKey) }, binary: item.binary };
});
const pending = prepared.filter((item) => !item.json.resume_blocked);
if (pending.length) return pending.map((item, index) => ({ ...item, json: { ...item.json, resume_position: index + 1, remaining_clip_count: pending.length - index, zero_remaining_recovery: false } }));

const assignmentId = text(source.assignment_id) || \`\${text(source.conversation_id)}:\${text(source.batch_number)}\`;
const expectedKeys = prepared.map((item) => item.json.delivery_key);
const expectedKeySet = new Set(expectedKeys);
const expectedFiles = prepared.map((item) => item.json.file_name);
const successStates = new Set(["accepted", "sent", "delivered", "read"]);
const successByKey = new Map();
const unresolvedKeys = new Set();
const unexpectedKeys = new Set();
for (const row of deliveryRows) {
  const key = text(row.delivery_key) || (row.file_name ? \`\${text(source.conversation_id)}:\${text(source.batch_number)}:\${text(row.file_name)}\` : "");
  if (!key || !expectedKeySet.has(key)) { if (key) unexpectedKeys.add(key); continue; }
  const state = text(row.delivery_state || row.state || row.send_state).toLowerCase();
  if (successStates.has(state) && validMessageId(row.whatsapp_message_id)) {
    const list = successByKey.get(key) || [];
    list.push({ delivery_key: key, file_name: text(row.file_name), whatsapp_message_id: text(row.whatsapp_message_id), media_id: text(row.media_id), sent_at: text(row.sent_at), attempts: Number(row.attempts || 0) });
    successByKey.set(key, list);
  } else if (["failed", "outcome_uncertain", "accepted", "sent", "delivered", "read"].includes(state) || row.media_id || row.whatsapp_message_id) unresolvedKeys.add(key);
}
const successful = [];
const duplicateSuccessKeys = [];
for (const key of expectedKeys) {
  const list = successByKey.get(key) || [];
  if (list.length === 1) successful.push(list[0]);
  else if (list.length > 1) duplicateSuccessKeys.push(key);
  if (list.length === 1) unresolvedKeys.delete(key);
}
const uniqueMessageIds = new Set(successful.map((row) => row.whatsapp_message_id));
const messageMatches = new Set(messageRows.filter((row) => expectedKeySet.has(text(row.source_reference)) && validMessageId(row.whatsapp_message_id)).map((row) => \`\${text(row.source_reference)}|\${text(row.whatsapp_message_id)}\`));
const corroborated = successful.filter((row) => messageMatches.has(\`\${row.delivery_key}|\${row.whatsapp_message_id}\`));
const ownershipMatches = /^\\d+$/.test(text(source.batch_number)) && Number(source.row_number) > 1 && digits(source.whatsapp_number || source.wa_id) === digits(source.wa_id || source.whatsapp_number) && normalizedUsername(source.username) === normalizedUsername(source.tiktok_username || source.username);
const problems = [];
if (expectedCount !== 15) problems.push(\`expected_clip_count_\${expectedCount}_not_15\`);
if (new Set(expectedFiles).size !== expectedCount || expectedKeySet.size !== expectedCount) problems.push("expected_clip_identities_not_unique");
if (successful.length !== expectedCount) problems.push(\`verified_success_count_\${successful.length}_of_\${expectedCount}\`);
if (uniqueMessageIds.size !== successful.length) problems.push("duplicate_whatsapp_message_id");
if (duplicateSuccessKeys.length) problems.push(\`duplicate_success_clip_records_\${duplicateSuccessKeys.length}\`);
if (corroborated.length !== successful.length) problems.push(\`message_log_corroboration_\${corroborated.length}_of_\${successful.length}\`);
if (unresolvedKeys.size) problems.push(\`unresolved_clip_records_\${unresolvedKeys.size}\`);
if (unexpectedKeys.size) problems.push(\`foreign_or_unexpected_clip_records_\${unexpectedKeys.size}\`);
if (!ownershipMatches) problems.push("canonical_folder_or_affiliate_ownership_mismatch");
const complete = problems.length === 0;
const recoveryState = complete ? "files_sent" : successful.length ? "partial" : "delivery_in_progress";
const failedCount = expectedKeys.filter((key) => deliveryRows.some((row) => text(row.delivery_key) === key && text(row.delivery_state || row.state || row.send_state).toLowerCase() === "failed") && !successByKey.has(key)).length;
const error = complete ? "" : \`zero_remaining_inconsistent:\${problems.join(",")}\`;
return [{ json: { ...source, zero_remaining_recovery: true, recovery_complete_verified: complete, recovery_state: recoveryState, recovery_error: error, assignment_id: assignmentId, original_numbered_folder: text(source.batch_number), canonical_lead_row_identifier: source.row_number, expected_clip_count: expectedCount, successful_send_count: successful.length, failed_count: failedCount, remaining_clip_count: 0, durable_message_ids: successful.map((row) => row.whatsapp_message_id), durable_clip_references: successful.map((row) => ({ delivery_key: row.delivery_key, file_name: row.file_name, whatsapp_message_id: row.whatsapp_message_id, media_id: row.media_id, sent_at: row.sent_at })), verified_aggregate_reference: \`\${assignmentId}:\${successful.length}:\${uniqueMessageIds.size}\`, recovery_problems: problems } }];`;

const finalizationCode = `function text(value) { return value == null ? "" : String(value).trim(); }
function digits(value) { return text(value).replace(/\\D/g, ""); }
function username(value) { return text(value).normalize("NFKC").replace(/^@+/, "").toLowerCase(); }
const item = $input.first().json;
const source = $("Restore and Validate Delivery Context").first().json;
if (item.zero_remaining_recovery !== true) throw new Error("zero_remaining_recovery_marker_missing");
if (text(item.assignment_id) !== (text(source.assignment_id) || \`\${text(source.conversation_id)}:\${text(source.batch_number)}\`)) throw new Error("zero_recovery_assignment_id_mismatch");
if (text(item.original_numbered_folder) !== text(source.batch_number) || Number(item.canonical_lead_row_identifier) !== Number(source.row_number)) throw new Error("zero_recovery_canonical_lead_or_folder_mismatch");
if (digits(item.whatsapp_number || item.wa_id) !== digits(source.whatsapp_number || source.wa_id) || username(item.username) !== username(source.username)) throw new Error("zero_recovery_affiliate_ownership_mismatch");
const expected = Number(item.expected_clip_count);
const accepted = Number(item.successful_send_count);
const failed = Number(item.failed_count || 0);
const complete = item.recovery_complete_verified === true && expected === 15 && accepted === 15 && failed === 0 && Array.isArray(item.durable_message_ids) && new Set(item.durable_message_ids).size === 15;
const state = complete ? "files_sent" : text(item.recovery_state || (accepted ? "partial" : "delivery_in_progress"));
const lastSentAt = (item.durable_clip_references || []).map((row) => text(row.sent_at)).filter(Boolean).sort().at(-1) || text(source.files_sent_at);
const error = complete ? "" : text(item.recovery_error || "zero_remaining_completion_not_verified");
const now = new Date().toISOString();
const leadRecord = { ...source, state, files_expected: String(expected), files_sent: String(accepted), files_failed: String(failed), files_sent_at: complete ? (lastSentAt || now) : text(source.files_sent_at), last_error: error, updated_at: now };
const alreadyCorrect = text(source.state) === text(leadRecord.state) && text(source.files_expected) === text(leadRecord.files_expected) && text(source.files_sent) === text(leadRecord.files_sent) && text(source.files_failed) === text(leadRecord.files_failed) && text(source.last_error) === text(leadRecord.last_error);
return [{ json: { ...leadRecord, zero_remaining_recovery: true, recovery_complete_verified: complete, successful_send_count: accepted, failed_count: failed, durable_message_ids: item.durable_message_ids, verified_aggregate_reference: item.verified_aggregate_reference, recovery_problems: item.recovery_problems, lead_row_values: source.lead_headers.map((name) => text(leadRecord[name])), final_state_write_required: !alreadyCorrect, final_state_already_correct: alreadyCorrect } }];`;

(async () => {
  const workflow = await api(`/workflows/${WORKFLOW_ID}`);
  const wasActive = workflow.active;
  const beforeVersion = workflow.versionId;
  const prepare = workflow.nodes.find((node) => node.name === "Prepare Resumable Delivery Items");
  const update = workflow.nodes.find((node) => node.name === "Update Final Send State");
  if (!prepare || !update) throw new Error("required production nodes missing");
  if (!String(update.parameters?.jsonBody || "").includes("$json.lead_row_values") || update.continueOnFail === true) throw new Error("final-state writer safety fix missing");
  const addedNames = ["IF Zero-Remaining Recovery", "Prepare Zero-Remaining Recovery Finalization", "IF Final-State Write Required"];
  if (workflow.nodes.some((node) => addedNames.includes(node.name))) throw new Error("zero-remaining recovery nodes already exist");
  prepare.parameters.jsCode = prepareCode;
  const zeroIf = ifNode("IF Zero-Remaining Recovery", "={{ $json.zero_remaining_recovery }}", [1580, -180]);
  const finalize = { id: id(), name: "Prepare Zero-Remaining Recovery Finalization", type: "n8n-nodes-base.code", typeVersion: 2, position: [1800, -320], parameters: { jsCode: finalizationCode } };
  const writeIf = ifNode("IF Final-State Write Required", "={{ $json.final_state_write_required }}", [2120, -320]);
  workflow.nodes.push(zeroIf, finalize, writeIf);
  workflow.connections[prepare.name] = { main: [[{ node: zeroIf.name, type: "main", index: 0 }]] };
  workflow.connections[zeroIf.name] = { main: [[{ node: finalize.name, type: "main", index: 0 }], [{ node: "Prepare Batch Send Claims", type: "main", index: 0 }, { node: "Prepare Assignment Start Log", type: "main", index: 0 }]] };
  workflow.connections[finalize.name] = { main: [[{ node: writeIf.name, type: "main", index: 0 }]] };
  workflow.connections[writeIf.name] = { main: [[{ node: "Update Final Send State", type: "main", index: 0 }], [{ node: "Done: Delivery Send Attempt", type: "main", index: 0 }]] };
  await api(`/workflows/${WORKFLOW_ID}`, { method: "PUT", body: JSON.stringify(payload(workflow)) });
  if (wasActive) await api(`/workflows/${WORKFLOW_ID}/activate`, { method: "POST" });
  const after = await api(`/workflows/${WORKFLOW_ID}`);
  const result = { workflow_id: after.id, active: after.active, before_version: beforeVersion, after_version: after.versionId, before_nodes: workflow.nodes.length - 3, after_nodes: after.nodes.length, changed_node: prepare.name, added_nodes: addedNames, final_writer_reused: true, media_nodes_changed: false, connection_targets: after.connections[zeroIf.name] };
  if (after.active !== wasActive || after.nodes.length !== workflow.nodes.length || !after.nodes.find((node) => node.name === finalize.name) || !String(after.nodes.find((node) => node.name === prepare.name)?.parameters?.jsCode || "").includes("zero_remaining_recovery")) throw new Error("zero-remaining recovery deployment verification failed");
  const outPath = path.join(ROOT, "n8n", "exports", "proya-delivery-log-audit-20260806T1125CST", "zero-remaining-recovery-deployment.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
