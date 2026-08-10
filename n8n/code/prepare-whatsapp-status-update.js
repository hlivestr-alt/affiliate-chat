const HEADERS = [
  "whatsapp_message_id",
  "recipient_number",
  "message_type",
  "template_name",
  "source_workflow",
  "source_reference",
  "api_status",
  "accepted_at",
  "current_status",
  "status_timestamp",
  "conversation_json",
  "pricing_json",
  "errors_json",
  "error_code",
  "error_title",
  "error_message",
  "error_details",
  "processed_statuses",
  "status_history_json",
  "updated_at",
  "direction",
  "message_payload_json",
  "send_state",
  "delivery_state"
];

function text(value) {
  return value == null ? "" : String(value).trim();
}

function json(value, fallback) {
  if (value && typeof value === "object") return value;
  const raw = text(value);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function compactJson(value) {
  return JSON.stringify(value == null ? {} : value);
}

const event = $("Loop Through Status Events").item.json;
const values = Array.isArray($json.values) ? $json.values : [];
const rows = values.slice(1).map((row, index) => {
  const record = { row_number: index + 2 };
  HEADERS.forEach((name, column) => {
    record[name] = text(row[column]);
  });
  return record;
});

const messageId = text(event.whatsapp_message_id);
const status = text(event.delivery_status).toLowerCase();
const current = rows.find((row) => row.whatsapp_message_id === messageId);

if (!current) {
  return [{
    json: {
      ...event,
      message_record_found: false,
      duplicate_status: false,
      status_update_needed: false
    }
  }];
}

const processed = json(current.processed_statuses, []);
const processedStatuses = Array.isArray(processed) ? processed.map(text) : [];
const duplicateStatus = processedStatuses.includes(status);
if (duplicateStatus) {
  return [{
    json: {
      ...event,
      ...current,
      message_record_found: true,
      duplicate_status: true,
      status_update_needed: false
    }
  }];
}

const historyValue = json(current.status_history_json, []);
const history = Array.isArray(historyValue) ? historyValue : [];
history.push({
  id: messageId,
  status,
  timestamp: text(event.whatsapp_timestamp),
  recipient_id: text(event.whatsapp_number),
  phone_number_id: text(event.phone_number_id),
  conversation: event.conversation || {},
  pricing: event.pricing || {},
  errors: Array.isArray(event.errors) ? event.errors : [],
  error_code: text(event.error_code),
  error_title: text(event.error_title),
  error_message: text(event.error_message),
  error_details: text(event.error_details),
  raw_callback: event.raw_callback || {},
  n8n_execution_time: text(event.n8n_execution_time)
});

const rank = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
const existingStatus = text(current.current_status).toLowerCase();
const shouldAdvance =
  status === "failed" ||
  existingStatus !== "failed" &&
    (rank[status] ?? -1) >= (rank[existingStatus] ?? -1);
const now = new Date().toISOString();
const record = {
  ...current,
  recipient_number: current.recipient_number || text(event.whatsapp_number),
  current_status: shouldAdvance ? status : current.current_status,
  status_timestamp: shouldAdvance
    ? text(event.whatsapp_timestamp)
    : current.status_timestamp,
  conversation_json: compactJson(event.conversation || {}),
  pricing_json: compactJson(event.pricing || {}),
  errors_json: compactJson(Array.isArray(event.errors) ? event.errors : []),
  error_code: text(event.error_code),
  error_title: text(event.error_title),
  error_message: text(event.error_message),
  error_details: text(event.error_details),
  processed_statuses: compactJson([...processedStatuses, status]),
  status_history_json: compactJson(history),
  updated_at: now,
  direction: current.direction || "outbound",
  message_payload_json: current.message_payload_json || "{}",
  send_state: status === "failed"
    ? "failed"
    : ["sent", "delivered", "read"].includes(status)
      ? "sent"
      : current.send_state || current.api_status || "accepted",
  delivery_state: status === "read"
    ? "read"
    : status === "delivered"
      ? "delivered"
      : current.delivery_state
};

return [{
  json: {
    ...event,
    ...record,
    message_record_found: true,
    duplicate_status: false,
    status_update_needed: true,
    status_is_failed: status === "failed",
    message_row_number: current.row_number,
    message_row_values: HEADERS.map((name) => text(record[name]))
  }
}];
