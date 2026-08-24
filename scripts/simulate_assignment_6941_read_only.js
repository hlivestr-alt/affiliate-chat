"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SNAPSHOT = process.argv[2];
const FOLDER = process.argv[3] || "/clips_whatsapp/6941";
const OUTPUT = process.argv[4] || "/tmp/assignment-6941-read-only-simulation.json";
if (!SNAPSHOT) throw new Error("snapshot path required");
const data = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
const leads = data.tables["WhatsApp Leads"].rows;
const delivery = data.tables["Delivery Log"].rows;
const messages = data.tables["WhatsApp Message Log"].rows;
const lead = leads.find((row) => row.batch_number === "6941");
if (!lead) throw new Error("assignment_6941_lead_missing");
const files = fs.readdirSync(FOLDER).filter((name) => /\.mp4$/i.test(name)).sort((a, b) => a.localeCompare(b));
if (files.length !== 15 || new Set(files).size !== 15) throw new Error(`assignment_6941_expected_15_unique_mp4_found_${files.length}`);
const rows = delivery.filter((row) => row.conversation_id === lead.conversation_id && row.batch_number === "6941");
const outbound = messages.filter((row) => row.direction === "outbound" && row.message_type === "video");
const validMessageId = (value) => /^wamid\.[A-Za-z0-9_+=\/-]{12,}$/.test(String(value || "").trim());
const successStates = new Set(["accepted", "sent", "delivered", "read"]);
const plan = files.map((fileName, index) => {
  const key = `${lead.conversation_id}:6941:${fileName}`;
  const matching = rows.filter((row) => row.delivery_key === key || row.file_name === fileName);
  const successes = matching.filter((row) => successStates.has(String(row.delivery_state || row.state || row.send_state).toLowerCase()) && validMessageId(row.whatsapp_message_id));
  const corroborated = successes.filter((row) => outbound.some((message) => message.source_reference === key && message.whatsapp_message_id === row.whatsapp_message_id));
  const cached = matching.find((row) => ["upload_ready", "upload_ready_no_message"].includes(row.send_state) && row.media_id && !row.whatsapp_message_id);
  const status = successes.length === 1 && corroborated.length === 1 ? "skip_durable_success" : cached ? "pending_reuse_cached_upload" : "pending_unsent";
  return { file_index: index + 1, file_name: fileName, delivery_key: key, status, whatsapp_message_id: status === "skip_durable_success" ? successes[0].whatsapp_message_id : "", cached_media_id: cached?.media_id || "" };
});
const durable = plan.filter((item) => item.status === "skip_durable_success");
const pending = plan.filter((item) => item.status !== "skip_durable_success");
const report = {
  simulated_at: new Date().toISOString(), mode: "read_only", assignment_id: `${lead.conversation_id}:6941`,
  row_number: lead.row_number, username: lead.username, conversation_id: lead.conversation_id, batch_number: lead.batch_number,
  conversation_state: lead.state, last_intent: lead.last_intent, delivery_state: lead.delivery_state,
  last_inbound_at: lead.last_inbound_at, last_inbound_message_id: lead.last_inbound_message_id,
  expected_clips: 15, folder_mp4_count: files.length, durable_success_count: durable.length,
  durable_message_id_count: new Set(durable.map((item) => item.whatsapp_message_id)).size,
  pending_count: pending.length, skipped_indexes: durable.map((item) => item.file_index), pending_indexes: pending.map((item) => item.file_index),
  cached_uploads_reusable: pending.filter((item) => item.status === "pending_reuse_cached_upload").map((item) => ({ file_index: item.file_index, file_name: item.file_name, media_id: item.cached_media_id })),
  would_resume_from_index: pending[0]?.file_index || null, would_finalize_delivery_state: durable.length === 15 ? "files_sent" : "partial",
  would_change_conversation_state: false, would_change_last_intent: false, whatsapp_requests: 0, sheet_writes: 0,
  plan, simulation_sha256: ""
};
if (report.conversation_state !== "awaiting_username" || report.last_intent !== "clarification_pending" || report.delivery_state !== "partial") throw new Error("assignment_6941_state_split_not_verified");
if (durable.length !== 4 || pending.length !== 11 || pending[0]?.file_index !== 5 || durable.map((item) => item.file_index).join(",") !== "1,2,3,4") throw new Error("assignment_6941_resume_plan_mismatch");
report.simulation_sha256 = crypto.createHash("sha256").update(JSON.stringify({ ...report, simulation_sha256: "" })).digest("hex");
fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
