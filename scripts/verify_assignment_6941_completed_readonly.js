"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

const inputPath = process.argv[2];
const outputPath = process.argv[3] || "/tmp/assignment-6941-completed-readonly.json";
if (!inputPath) throw new Error("snapshot path required");

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const tables = source.tables || {};
const rows = (name) => tables[name]?.rows || [];
const text = (value) => value == null ? "" : String(value).trim();
const digits = (value) => text(value).replace(/\D/g, "");
const validWamid = (value) => /^wamid\.[A-Za-z0-9_+=\/-]{12,}$/.test(text(value));
const conversationId = "wa:6282225211568";
const batchNumber = "6941";
const username = "jenius_abnormal";

const leads = rows("WhatsApp Leads").filter((row) =>
  row.batch_number === batchNumber && row.conversation_id === conversationId &&
  digits(row.wa_id || row.whatsapp_number) === "6282225211568" && text(row.username).toLowerCase() === username
);
const delivery = rows("Delivery Log").filter((row) =>
  row.batch_number === batchNumber && row.conversation_id === conversationId &&
  text(row.delivery_key).startsWith(`${conversationId}:${batchNumber}:`)
).sort((a, b) => Number(a.file_index) - Number(b.file_index));
const messages = rows("WhatsApp Message Log").filter((row) =>
  row.direction === "outbound" && row.message_type === "video" &&
  text(row.source_reference).startsWith(`${conversationId}:${batchNumber}:`)
).sort((a, b) => text(a.source_reference).localeCompare(text(b.source_reference)));
const simple = rows("Simple Delivery Log").filter((row) =>
  text(row["Numbered Folder"]) === batchNumber && text(row.Username).toLowerCase() === username
);

const failures = [];
const requireCheck = (condition, message) => { if (!condition) failures.push(message); };
requireCheck(leads.length === 1, `expected_one_exact_owner_found_${leads.length}`);
requireCheck(delivery.length === 15, `expected_15_delivery_rows_found_${delivery.length}`);
requireCheck(messages.length === 15, `expected_15_message_rows_found_${messages.length}`);
requireCheck(simple.length === 1, `expected_one_simple_log_row_found_${simple.length}`);

const indexes = delivery.map((row) => Number(row.file_index));
const deliveryIds = delivery.map((row) => text(row.whatsapp_message_id));
const messageIds = messages.map((row) => text(row.whatsapp_message_id));
requireCheck(indexes.join(",") === "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15", `delivery_indexes_invalid_${indexes.join("_")}`);
requireCheck(new Set(delivery.map((row) => row.delivery_key)).size === 15, "delivery_keys_not_unique");
requireCheck(deliveryIds.every(validWamid), "delivery_contains_invalid_wamid");
requireCheck(new Set(deliveryIds).size === 15, "delivery_wamids_not_unique");
requireCheck(messageIds.every(validWamid), "message_log_contains_invalid_wamid");
requireCheck(new Set(messageIds).size === 15, "message_log_wamids_not_unique");
requireCheck(delivery.every((row) => ["accepted", "sent", "delivered", "read"].includes(text(row.send_state || row.state).toLowerCase())), "delivery_contains_non_success_state");
requireCheck(delivery.every((row) => messages.some((message) => message.source_reference === row.delivery_key && message.whatsapp_message_id === row.whatsapp_message_id)), "delivery_message_log_corroboration_failed");
requireCheck(delivery.slice(0, 4).every((row) => text(row.attempts) === "1"), "clips_1_to_4_attempt_count_changed");
requireCheck(delivery.slice(4).every((row) => text(row.attempts) === "2"), "clips_5_to_15_attempt_count_changed");

const lead = leads[0] || {};
requireCheck(lead.delivery_state === "files_sent", `lead_delivery_state_${lead.delivery_state || "missing"}`);
requireCheck(lead.files_expected === "15" && lead.files_sent === "15" && lead.files_failed === "0", "lead_delivery_counters_invalid");
requireCheck(lead.state === "awaiting_username", `conversation_state_${lead.state || "missing"}`);
requireCheck(lead.last_intent === "clarification_pending", `last_intent_${lead.last_intent || "missing"}`);
const simpleRow = simple[0] || {};
requireCheck(simpleRow.row_number === 28, `simple_log_row_${simpleRow.row_number || "missing"}`);
requireCheck(simpleRow["Clips Sent"] === "15/15" && simpleRow.Status === "Complete" && !text(simpleRow.Error), "simple_log_not_complete");

const target = { lead_rows: leads, delivery_rows: delivery, message_rows: messages, simple_log_rows: simple };
const report = {
  mode: "read_only",
  verified_at: new Date().toISOString(),
  assignment: { batch_number: batchNumber, conversation_id: conversationId, username },
  assertions_passed: failures.length === 0,
  failures,
  summary: {
    exact_owner_rows: leads.length,
    delivery_rows: delivery.length,
    unique_delivery_keys: new Set(delivery.map((row) => row.delivery_key)).size,
    valid_unique_delivery_wamids: new Set(deliveryIds.filter(validWamid)).size,
    corroborating_message_rows: messages.length,
    attempts_1_to_4: delivery.slice(0, 4).map((row) => Number(row.attempts)),
    attempts_5_to_15: delivery.slice(4).map((row) => Number(row.attempts)),
    lead_delivery_state: lead.delivery_state || "",
    counters: { expected: lead.files_expected || "", sent: lead.files_sent || "", failed: lead.files_failed || "" },
    conversation_state: lead.state || "",
    last_intent: lead.last_intent || "",
    simple_log: { row_number: simpleRow.row_number || null, clips_sent: simpleRow["Clips Sent"] || "", status: simpleRow.Status || "", error: simpleRow.Error || "" },
    whatsapp_requests: 0,
    sheet_writes: 0,
  },
  target_snapshot_sha256: crypto.createHash("sha256").update(JSON.stringify(target)).digest("hex"),
  target,
};

fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify({ output: outputPath, assertions_passed: report.assertions_passed, summary: report.summary, target_snapshot_sha256: report.target_snapshot_sha256 }, null, 2) + "\n");
if (failures.length) throw new Error(`assignment_6941_verification_failed: ${failures.join("; ")}`);
