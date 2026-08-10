"use strict";

const WHATSAPP_LEAD_HEADERS = Object.freeze([
  "username",
  "whatsapp_number",
  "conversation_id",
  "captured_at",
  "reply_1",
  "reply_2",
  "reply_3"
]);

function text(value) {
  return value == null ? "" : String(value);
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const raw = text(value).trim();
  if (!raw) return {};
  try {
    return object(JSON.parse(raw));
  } catch {
    return {};
  }
}

function normalizeUsername(value) {
  return text(value).normalize("NFKC").trim().replace(/^@+/, "");
}

function normalizeIndonesianWhatsAppNumber(value) {
  const digits = text(value).normalize("NFKC").replace(/\D/g, "");
  let international = digits;
  if (international.startsWith("0")) {
    international = `62${international.slice(1)}`;
  }
  if (!/^628\d{8,11}$/.test(international)) return "";
  return `+${international}`;
}

function extractIndonesianWhatsAppNumber(value) {
  const normalized = text(value)
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-");
  const candidatePattern =
    /(?<!\d)(?:\+?\s*62|0)[\s(.-]*8(?:[\s().-]*\d){8,11}(?![\s().-]*\d)/g;

  for (const match of normalized.matchAll(candidatePattern)) {
    const phone = normalizeIndonesianWhatsAppNumber(match[0]);
    if (phone) return phone;
  }
  return "";
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

function toIsoTimestamp(value, fallbackNow = () => new Date()) {
  const parsed = timestampMs(value);
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : fallbackNow().toISOString();
}

function inboundLeadFrom(item, { now = () => new Date() } = {}) {
  const source = object(item);
  const body = Object.keys(object(source.body)).length ? object(source.body) : source;
  const message = object(body.message);
  const data = object(body.data);
  const sender = object(data.sender);
  const content = parseJsonObject(data.content || body.content || message.content);
  const rawContent = text(data.content || body.content || message.content);
  const inboundText =
    body.text ||
    body.message_text ||
    body.reply_text ||
    content.content ||
    content.text ||
    content.message ||
    message.text ||
    data.text ||
    (rawContent.startsWith("{") ? "" : rawContent) ||
    "";
  const timestamp =
    body.backfill_original_received_at ||
    source.message_received_at ||
    body.received_at ||
    body.created_at ||
    body.timestamp ||
    data.create_time ||
    data.timestamp ||
    message.create_time ||
    "";

  return {
    affiliate_id: text(
      body.affiliate_id ||
      body.creator_id ||
      body.sender_id ||
      data.sender_id ||
      data.sender_im_user_id ||
      sender.sender_id ||
      sender.sender_im_user_id
    ),
    username: normalizeUsername(
      body.username ||
      body.tiktok_handle ||
      body.handle ||
      data.username ||
      sender.username ||
      source.username
    ),
    conversation_id: text(
      body.conversation_id ||
      body.thread_id ||
      message.conversation_id ||
      data.conversation_id
    ),
    message_id: text(
      body.message_id ||
      body.id ||
      message.message_id ||
      message.id ||
      data.message_id
    ),
    inbound_text: text(inboundText),
    whatsapp_number: extractIndonesianWhatsAppNumber(inboundText),
    captured_at: toIsoTimestamp(timestamp, now)
  };
}

function sheetRows(values) {
  const rows = Array.isArray(values) ? values : [];
  if (rows.length === 0) {
    throw new Error("WhatsApp Leads sheet is missing its header row");
  }
  const header = WHATSAPP_LEAD_HEADERS.map((_, index) =>
    text(rows[0][index]).trim()
  );
  if (header.some((value, index) => value !== WHATSAPP_LEAD_HEADERS[index])) {
    throw new Error(
      `WhatsApp Leads header mismatch: expected ${WHATSAPP_LEAD_HEADERS.join(",")}`
    );
  }
  return rows.slice(1).map((row, index) => ({
    row_number: index + 2,
    username: normalizeUsername(row[0]),
    whatsapp_number: text(row[1]).trim(),
    conversation_id: text(row[2]).trim(),
    captured_at: text(row[3]).trim(),
    reply_1: text(row[4]).trim(),
    reply_2: text(row[5]).trim(),
    reply_3: text(row[6]).trim()
  }));
}

function prepareLeadUpsert(source, values) {
  const suppliedReplies = Array.isArray(source.recent_replies)
    ? source.recent_replies
        .map((value) => text(value).trim())
        .filter(Boolean)
        .slice(-3)
    : [];
  const incoming = {
    username: normalizeUsername(source.username),
    whatsapp_number: normalizeIndonesianWhatsAppNumber(source.whatsapp_number),
    conversation_id: text(source.conversation_id).trim(),
    captured_at: toIsoTimestamp(source.captured_at),
    inbound_text: text(source.inbound_text).trim()
  };
  if (!incoming.whatsapp_number) {
    return { action: "no_write", reason: "invalid_phone" };
  }

  const rows = sheetRows(values);
  const existing =
    rows.find((row) =>
      incoming.conversation_id &&
      row.conversation_id === incoming.conversation_id
    ) ||
    rows.find((row) =>
      !incoming.conversation_id &&
      incoming.username &&
      row.username.toLowerCase() === incoming.username.toLowerCase()
    );

  const record = {
    username: incoming.username || (existing && existing.username) || "",
    whatsapp_number: incoming.whatsapp_number,
    conversation_id:
      incoming.conversation_id || (existing && existing.conversation_id) || "",
    captured_at: incoming.captured_at,
    reply_1: "",
    reply_2: "",
    reply_3: ""
  };

  if (!existing) {
    const replies = suppliedReplies.length
      ? suppliedReplies
      : [incoming.inbound_text].filter(Boolean);
    [record.reply_1, record.reply_2, record.reply_3] = [
      replies[0] || "",
      replies[1] || "",
      replies[2] || ""
    ];
    const rowValues = WHATSAPP_LEAD_HEADERS.map((header) => record[header]);
    return { action: "append", record, row_values: rowValues };
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
  const replies = suppliedReplies.length
    ? suppliedReplies
    : incoming.inbound_text &&
        existingReplies[existingReplies.length - 1] !== incoming.inbound_text
      ? [...existingReplies, incoming.inbound_text].slice(-3)
      : existingReplies;
  [record.reply_1, record.reply_2, record.reply_3] = [
    replies[0] || "",
    replies[1] || "",
    replies[2] || ""
  ];
  const rowValues = WHATSAPP_LEAD_HEADERS.map((header) => record[header]);
  const unchanged =
    WHATSAPP_LEAD_HEADERS.every((header) => existing[header] === record[header]);
  if (unchanged) {
    return {
      action: "no_write",
      reason: incomingIsOlder ? "older_than_existing" : "duplicate_delivery",
      row_number: existing.row_number,
      record
    };
  }

  return {
    action: "update",
    row_number: existing.row_number,
    record,
    row_values: rowValues
  };
}

module.exports = {
  WHATSAPP_LEAD_HEADERS,
  extractIndonesianWhatsAppNumber,
  inboundLeadFrom,
  normalizeIndonesianWhatsAppNumber,
  normalizeUsername,
  parseJsonObject,
  prepareLeadUpsert,
  sheetRows,
  timestampMs,
  toIsoTimestamp
};
