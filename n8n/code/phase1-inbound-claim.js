function text(value) { return value == null ? "" : String(value).trim(); }
function compact(value) { try { return JSON.stringify(value ?? {}); } catch { return "{}"; } }

const event = $("When Executed by Webhook Router").first().json;
const values = Array.isArray($json.values) ? $json.values : [];
const headers = (values[0] || []).map(text);
const required = ["whatsapp_message_id", "direction", "message_payload_json", "send_state"];
if (required.some((name) => !headers.includes(name))) {
  throw new Error("WhatsApp Message Log Phase 1 headers are missing");
}
const id = text(event.whatsapp_message_id);
const claimToken = text(typeof $execution !== "undefined" && $execution.id) || `local-${text(event.n8n_execution_time)}`;
const duplicate = values.slice(1).some((row) => {
  const record = Object.fromEntries(headers.map((name, index) => [name, text(row[index])]));
  return record.direction === "inbound" && record.whatsapp_message_id === id;
});
const now = new Date().toISOString();
const record = Object.fromEntries(headers.map((name) => [name, ""]));
Object.assign(record, {
  whatsapp_message_id: id,
  recipient_number: text(event.wa_id || event.whatsapp_number),
  message_type: text(event.message_type || "unknown"),
  source_workflow: "AffWaWebhook2026",
  source_reference: `inbound:${id}:${claimToken}`,
  api_status: "received",
  accepted_at: now,
  current_status: "received",
  status_timestamp: text(event.whatsapp_timestamp),
  updated_at: now,
  direction: "inbound",
  message_payload_json: compact({
    wa_id: event.wa_id,
    sender_phone: event.whatsapp_number,
    text: event.message_text,
    type: event.message_type,
    meta_timestamp: event.whatsapp_timestamp,
    received_timestamp: event.n8n_execution_time,
    raw_event: event.raw_event,
    raw_callback: event.raw_callback
  }),
  send_state: "received"
});
return [{ json: {
  ...event,
  inbound_duplicate: duplicate,
  inbound_claim_valid: Boolean(id),
  inbound_claim_token: claimToken,
  inbound_row_values: headers.map((name) => text(record[name]))
} }];
