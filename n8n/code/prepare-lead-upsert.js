const HEADERS = [
  "username",
  "whatsapp_number",
  "conversation_id",
  "captured_at",
  "reply_1",
  "reply_2",
  "reply_3"
];

function text(value) {
  return value == null ? "" : String(value);
}

function username(value) {
  return text(value).normalize("NFKC").trim().replace(/^@+/, "");
}

function timestampMs(value) {
  const raw = text(value).trim();
  if (!raw) return Number.NaN;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  return Date.parse(raw);
}

const source = $("Resolve Username From Conversations").first().json;
const values = Array.isArray($json.values) ? $json.values : [];
if (values.length === 0) {
  throw new Error("WhatsApp Leads sheet is missing its header row");
}
const actualHeader = HEADERS.map((_, index) => text(values[0][index]).trim());
if (actualHeader.some((value, index) => value !== HEADERS[index])) {
  throw new Error(`WhatsApp Leads header mismatch: expected ${HEADERS.join(",")}`);
}

const rows = values.slice(1).map((row, index) => ({
  row_number: index + 2,
  username: username(row[0]),
  whatsapp_number: text(row[1]).trim(),
  conversation_id: text(row[2]).trim(),
  captured_at: text(row[3]).trim(),
  reply_1: text(row[4]).trim(),
  reply_2: text(row[5]).trim(),
  reply_3: text(row[6]).trim()
}));
const incomingConversationId = text(source.conversation_id).trim();
const incomingUsername = username(source.username);
const suppliedReplies = Array.isArray(source.recent_replies)
  ? source.recent_replies.map((value) => text(value).trim()).filter(Boolean).slice(-3)
  : [];
const existing =
  rows.find((row) =>
    incomingConversationId &&
    row.conversation_id === incomingConversationId
  ) ||
  rows.find((row) =>
    !incomingConversationId &&
    incomingUsername &&
    row.username.toLowerCase() === incomingUsername.toLowerCase()
  );
const record = {
  username: incomingUsername || (existing && existing.username) || "",
  whatsapp_number: text(source.whatsapp_number).trim(),
  conversation_id:
    incomingConversationId || (existing && existing.conversation_id) || "",
  captured_at: text(source.captured_at).trim(),
  reply_1: "",
  reply_2: "",
  reply_3: ""
};

if (!existing) {
  const replies = suppliedReplies.length
    ? suppliedReplies
    : [text(source.inbound_text).trim()].filter(Boolean);
  [record.reply_1, record.reply_2, record.reply_3] = [
    replies[0] || "",
    replies[1] || "",
    replies[2] || ""
  ];
  const rowValues = HEADERS.map((header) => record[header]);
  return [{ json: { ...source, action: "append", record, row_values: rowValues } }];
}

const incomingMs = timestampMs(record.captured_at);
const existingMs = timestampMs(existing.captured_at);
const incomingIsOlder = Number.isFinite(existingMs) && incomingMs < existingMs;
if (incomingIsOlder) {
  record.username = existing.username || record.username;
  record.whatsapp_number = existing.whatsapp_number;
  record.conversation_id = existing.conversation_id || record.conversation_id;
  record.captured_at = existing.captured_at;
}

const existingReplies = [existing.reply_1, existing.reply_2, existing.reply_3]
  .map((value) => text(value).trim())
  .filter(Boolean);
const inboundText = text(source.inbound_text).trim();
const replies = suppliedReplies.length
  ? suppliedReplies
  : inboundText && existingReplies[existingReplies.length - 1] !== inboundText
    ? [...existingReplies, inboundText].slice(-3)
    : existingReplies;
[record.reply_1, record.reply_2, record.reply_3] = [
  replies[0] || "",
  replies[1] || "",
  replies[2] || ""
];
const rowValues = HEADERS.map((header) => record[header]);
const unchanged = HEADERS.every((header) => existing[header] === record[header]);
if (unchanged) {
  return [{
    json: {
      ...source,
      action: "no_write",
      reason: incomingIsOlder ? "older_than_existing" : "duplicate_delivery",
      row_number: existing.row_number,
      record
    }
  }];
}

return [{
  json: {
    ...source,
    action: "update",
    row_number: existing.row_number,
    record,
    row_values: rowValues
  }
}];
