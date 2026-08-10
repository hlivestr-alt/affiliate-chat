const HEADERS = [
  "whatsapp_message_id", "recipient_number", "message_type", "template_name",
  "source_workflow", "source_reference", "api_status", "accepted_at",
  "current_status", "status_timestamp", "conversation_json", "pricing_json",
  "errors_json", "error_code", "error_title", "error_message",
  "error_details", "processed_statuses", "status_history_json", "updated_at",
  "direction", "message_payload_json", "send_state", "delivery_state"
];

function text(value) {
  return value == null ? "" : String(value).trim();
}

const source = $("When Executed by Webhook Router").first().json;
const values = Array.isArray($json.values) ? $json.values : [];
const messageId = text(source.whatsapp_message_id);
const exists = values.slice(1).some((row) => text(row[0]) === messageId);
const now = new Date().toISOString();
const apiStatus = text(source.api_status || "accepted").toLowerCase();
const record = {
  whatsapp_message_id: messageId,
  recipient_number: text(source.recipient_number),
  message_type: text(source.message_type),
  template_name: text(source.template_name),
  source_workflow: text(source.source_workflow),
  source_reference: text(source.source_reference),
  api_status: apiStatus,
  accepted_at: text(source.accepted_at || now),
  current_status: apiStatus,
  status_timestamp: "",
  conversation_json: "{}",
  pricing_json: "{}",
  errors_json: source.last_error ? JSON.stringify([{ message: text(source.last_error), code: text(source.error_code) }]) : "[]",
  error_code: text(source.error_code),
  error_title: "",
  error_message: text(source.last_error),
  error_details: "",
  processed_statuses: "[]",
  status_history_json: "[]",
  updated_at: now,
  direction: "outbound",
  message_payload_json: text(source.message_payload_json || "{}"),
  send_state: text(source.send_state || apiStatus || "accepted"),
  delivery_state: ""
};

return [{ json: {
  ...source,
  registration_valid: Boolean(messageId),
  message_record_exists: exists,
  message_row_values: HEADERS.map((name) => text(record[name]))
} }];
