const HEADERS = [
  "username",
  "whatsapp_number",
  "conversation_id",
  "captured_at",
  "reply_1",
  "reply_2",
  "reply_3",
  "state",
  "opt_in_message_id",
  "opt_in_sent_at",
  "opted_in_at",
  "declined_at",
  "batch_number",
  "batch_reserved_at",
  "delivery_started_at",
  "files_expected",
  "files_sent",
  "files_delivered",
  "files_failed",
  "files_sent_at",
  "files_delivered_at",
  "posted_confirmed_at",
  "last_whatsapp_message_id",
  "last_inbound_at",
  "last_intent",
  "last_intent_confidence",
  "last_error",
  "updated_at",
  "wa_id",
  "last_inbound_message_id",
  "window_expires_at"
];

function text(value) {
  return value == null ? "" : String(value).trim();
}

function normalizeUsername(value) {
  return text(value).normalize("NFKC").replace(/^@+/, "");
}

function timestampMs(value) {
  const raw = text(value);
  if (!raw) return Number.NaN;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const number = Number(raw);
    return number < 1e12 ? number * 1000 : number;
  }
  return Date.parse(raw);
}

function recordFromRow(row, rowNumber) {
  const record = { row_number: rowNumber };
  HEADERS.forEach((header, index) => {
    record[header] = text(row[index]);
  });
  return record;
}

const source = $("Resolve Username From Conversations").first().json;
const values = Array.isArray($json.values) ? $json.values : [];
if (!values.length) throw new Error("WhatsApp Leads sheet is missing its header row");
const header = values[0].map(text);
if (HEADERS.some((value, index) => header[index] !== value)) {
  throw new Error("WhatsApp Leads header must be migrated before lead capture is activated");
}

const rows = values.slice(1).map((row, index) => recordFromRow(row, index + 2));
const conversationId = text(source.conversation_id);
const username = normalizeUsername(source.username);
const phone = text(source.whatsapp_number);
const capturedAt = text(source.captured_at) || new Date().toISOString();
const suppliedReplies = Array.isArray(source.recent_replies)
  ? source.recent_replies.map(text).filter(Boolean).slice(-3)
  : [];
const existing =
  rows.find((row) => conversationId && row.conversation_id === conversationId) ||
  rows.find((row) =>
    !conversationId &&
    username &&
    row.username.toLowerCase() === username.toLowerCase()
  );

const now = new Date().toISOString();
const record = Object.fromEntries(HEADERS.map((name) => [name, ""]));
if (existing) Object.assign(record, existing);
record.username = username || record.username;
record.whatsapp_number = phone || record.whatsapp_number;
record.conversation_id = conversationId || record.conversation_id;

const incomingMs = timestampMs(capturedAt);
const existingMs = timestampMs(existing && existing.captured_at);
const stale = existing && Number.isFinite(existingMs) && incomingMs < existingMs;
if (!stale) record.captured_at = capturedAt;

const previousReplies = existing
  ? [existing.reply_1, existing.reply_2, existing.reply_3].map(text).filter(Boolean)
  : [];
const replies = suppliedReplies.length
  ? suppliedReplies
  : source.inbound_text &&
      previousReplies[previousReplies.length - 1] !== text(source.inbound_text)
    ? [...previousReplies, text(source.inbound_text)].slice(-3)
    : previousReplies;
[record.reply_1, record.reply_2, record.reply_3] = [
  replies[0] || "",
  replies[1] || "",
  replies[2] || ""
];

record.state = record.state || "interested";
record.files_expected = record.files_expected || "15";
record.updated_at = now;

const needsOptIn =
  record.state === "interested" &&
  !record.opt_in_message_id &&
  !record.declined_at;
const rowValues = HEADERS.map((name) => text(record[name]));

if (!existing) {
  return [{
    json: {
      action: "append",
      record,
      row_values: rowValues,
      needs_opt_in: needsOptIn
    }
  }];
}

const unchanged = HEADERS.every(
  (name, index) =>
    name === "updated_at" || text(existing[name]) === rowValues[index]
);
if (unchanged && !needsOptIn) {
  return [{
    json: {
      action: "no_write",
      reason: stale ? "older_than_existing" : "duplicate_delivery",
      row_number: existing.row_number,
      record: existing,
      needs_opt_in: false
    }
  }];
}

return [{
  json: {
    action: "update",
    row_number: existing.row_number,
    record,
    row_values: rowValues,
    needs_opt_in: needsOptIn
  }
}];
