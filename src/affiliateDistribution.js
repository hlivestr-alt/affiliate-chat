"use strict";

const crypto = require("node:crypto");

const LEAD_HEADERS = Object.freeze([
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
  "updated_at"
]);

const DELIVERY_LOG_HEADERS = Object.freeze([
  "delivery_key",
  "conversation_id",
  "whatsapp_number",
  "batch_number",
  "file_index",
  "file_name",
  "media_id",
  "whatsapp_message_id",
  "state",
  "attempts",
  "uploaded_at",
  "sent_at",
  "delivered_at",
  "failed_at",
  "last_error",
  "updated_at"
]);

const FAQ_HEADERS = Object.freeze([
  "intent",
  "description",
  "examples",
  "answer",
  "active",
  "min_confidence"
]);

const HUMAN_QUEUE_HEADERS = Object.freeze([
  "case_id",
  "created_at",
  "updated_at",
  "status",
  "reason",
  "conversation_id",
  "username",
  "whatsapp_number",
  "source_message_id",
  "message_text",
  "predicted_intent",
  "confidence",
  "batch_number",
  "delivery_step",
  "retry_count",
  "last_error",
  "assignee",
  "resolution"
]);

const FUNNEL_STATES = Object.freeze([
  "interested",
  "opt_in_sent",
  "opted_in",
  "delivery_in_progress",
  "files_sent",
  "files_delivered",
  "posted_confirmed",
  "declined",
  "manual_review",
  "failed"
]);

const YES_TEXT = new Set([
  "yes",
  "ya",
  "iya",
  "setuju",
  "ya saya setuju",
  "ya, saya setuju",
  "ya kirim video",
  "ya, kirim video",
  "yes send clips",
  "yes, send clips"
]);

const NO_TEXT = new Set([
  "no",
  "tidak",
  "nggak",
  "gak",
  "stop",
  "berhenti",
  "tidak terima kasih",
  "no thanks"
]);

function text(value) {
  return value == null ? "" : String(value);
}

function normalizedText(value) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^[*"'“”]+/, "")
    .replace(/[*"'“”]+$/, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function recordFromRow(headers, row, rowNumber) {
  const record = { row_number: rowNumber };
  headers.forEach((header, index) => {
    record[header] = text(row[index]).trim();
  });
  return record;
}

function rowsFromValues(values, headers) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const actual = values[0].map((value) => text(value).trim());
  const expectedPrefix = headers.slice(0, actual.length);
  if (actual.some((value, index) => value !== expectedPrefix[index])) {
    throw new Error(`Header mismatch: expected ${headers.join(",")}`);
  }
  return values.slice(1).map((row, index) =>
    recordFromRow(headers, row, index + 2)
  );
}

function rowValues(record, headers = LEAD_HEADERS) {
  return headers.map((header) => text(record[header]));
}

function classifyOptIn({ payload, body, text: messageText } = {}) {
  const normalizedPayload = text(payload || body).trim().toUpperCase();
  if (normalizedPayload === "YES_SEND_CLIPS") {
    return { action: "opted_in", reason: "yes_payload" };
  }
  if (normalizedPayload === "NO_THANKS") {
    return { action: "declined", reason: "no_payload" };
  }

  const normalized = normalizedText(messageText);
  if (YES_TEXT.has(normalized)) {
    return { action: "opted_in", reason: "exact_affirmative_text" };
  }
  if (NO_TEXT.has(normalized)) {
    return { action: "declined", reason: "exact_negative_text" };
  }
  return { action: "classify", reason: "not_explicit_opt_in" };
}

function numericBatchNames(names) {
  return [...new Set((names || [])
    .map((value) => text(value).trim())
    .filter((value) => /^\d+$/.test(value))
    .map(Number))]
    .sort((a, b) => a - b);
}

function usedBatchNumbers(leadRows, historicalRows) {
  const used = new Set();
  for (const row of leadRows || []) {
    const value = text(row.batch_number).trim();
    if (/^\d+$/.test(value)) used.add(Number(value));
  }
  for (const row of historicalRows || []) {
    const value = text(
      row.original_batch_number ?? row.batch_number
    ).trim();
    if (/^\d+$/.test(value)) used.add(Number(value));
  }
  return used;
}

function selectNextBatch(folderNames, leadRows, historicalRows) {
  const used = usedBatchNumbers(leadRows, historicalRows);
  const batch = numericBatchNames(folderNames).find((value) => !used.has(value));
  return batch == null ? "" : String(batch);
}

function reservationWinner(rows, batchNumber) {
  const candidates = (rows || [])
    .filter((row) => text(row.batch_number) === text(batchNumber))
    .filter((row) => text(row.batch_reserved_at))
    .sort((a, b) => {
      const timeDifference =
        Date.parse(a.batch_reserved_at) - Date.parse(b.batch_reserved_at);
      if (Number.isFinite(timeDifference) && timeDifference !== 0) {
        return timeDifference;
      }
      return text(a.conversation_id).localeCompare(text(b.conversation_id));
    });
  return candidates[0] || null;
}

function planDelivery(files, logRows, expected = 15) {
  const normalizedFiles = (files || [])
    .map((file) => ({
      path: text(file.path),
      name: text(file.name || file.file_name)
    }))
    .filter((file) => file.name.toLowerCase().endsWith(".mp4"))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (normalizedFiles.length !== expected) {
    return {
      ok: false,
      reason: "unexpected_file_count",
      expected,
      actual: normalizedFiles.length,
      pending: []
    };
  }

  const completed = new Set(
    (logRows || [])
      .filter((row) => ["sent", "delivered"].includes(text(row.state)))
      .map((row) => text(row.file_name))
  );
  return {
    ok: true,
    expected,
    actual: normalizedFiles.length,
    pending: normalizedFiles
      .map((file, index) => ({ ...file, file_index: index + 1 }))
      .filter((file) => !completed.has(file.name))
  };
}

function parseModelClassification(content) {
  let parsed = content;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return { valid: false, reason: "invalid_json" };
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { valid: false, reason: "invalid_shape" };
  }
  const intent = text(parsed.intent).trim();
  const confidence = Number(parsed.confidence);
  if (!intent || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { valid: false, reason: "invalid_fields" };
  }
  return { valid: true, intent, confidence };
}

function activeFaqRows(rows) {
  return (rows || []).filter((row) => {
    const active = normalizedText(row.active);
    return row.intent && row.answer && ["true", "yes", "1", "active"].includes(active);
  });
}

function selectFaqAnswer(faqRows, classification, defaultThreshold = 0.85) {
  const parsed = parseModelClassification(classification);
  if (!parsed.valid) {
    return { action: "escalate", reason: parsed.reason };
  }
  const faq = activeFaqRows(faqRows).find(
    (row) => text(row.intent).trim() === parsed.intent
  );
  if (!faq) {
    return {
      action: "escalate",
      reason: "unknown_intent",
      intent: parsed.intent,
      confidence: parsed.confidence
    };
  }
  const configured = Number(faq.min_confidence);
  const threshold = Number.isFinite(configured) && configured > 0
    ? Math.max(defaultThreshold, configured)
    : defaultThreshold;
  if (parsed.confidence < threshold) {
    return {
      action: "escalate",
      reason: "low_confidence",
      intent: parsed.intent,
      confidence: parsed.confidence,
      threshold
    };
  }
  return {
    action: "reply",
    intent: parsed.intent,
    confidence: parsed.confidence,
    answer: text(faq.answer)
  };
}

function isPostedConfirmation(value) {
  const normalized = normalizedText(value);
  return [
    /\bsudah (aku |saya )?(upload|post|posting)\b/,
    /\b(udah|sudah) tayang\b/,
    /\bposted\b/,
    /\bi (have )?posted\b/
  ].some((pattern) => pattern.test(normalized));
}

function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  const raw = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(text(rawBody), "utf8");
  const supplied = text(signatureHeader).trim();
  if (!supplied.startsWith("sha256=") || !appSecret) return false;
  const expected = `sha256=${crypto
    .createHmac("sha256", appSecret)
    .update(raw)
    .digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function aggregateDelivery(logRows, expected = 15) {
  const rows = logRows || [];
  const sent = rows.filter((row) =>
    ["sent", "delivered"].includes(text(row.state))
  ).length;
  const delivered = rows.filter((row) => text(row.state) === "delivered").length;
  const failed = rows.filter((row) => text(row.state) === "failed").length;
  return {
    expected,
    sent,
    delivered,
    failed,
    state:
      delivered === expected
        ? "files_delivered"
        : sent === expected
          ? "files_sent"
          : failed > 0
            ? "failed"
            : "delivery_in_progress"
  };
}

function humanQueueCase(input, now = () => new Date()) {
  const createdAt = now().toISOString();
  const sourceMessageId = text(input.source_message_id);
  const conversationId = text(input.conversation_id);
  const reason = text(input.reason || "manual_review");
  const stable = sourceMessageId || `${conversationId}:${reason}:${createdAt}`;
  const caseId = crypto
    .createHash("sha256")
    .update(`${stable}:${reason}`)
    .digest("hex")
    .slice(0, 24);
  return {
    case_id: caseId,
    created_at: createdAt,
    updated_at: createdAt,
    status: "open",
    reason,
    conversation_id: conversationId,
    username: text(input.username),
    whatsapp_number: text(input.whatsapp_number),
    source_message_id: sourceMessageId,
    message_text: text(input.message_text),
    predicted_intent: text(input.predicted_intent),
    confidence: text(input.confidence),
    batch_number: text(input.batch_number),
    delivery_step: text(input.delivery_step),
    retry_count: text(input.retry_count || 0),
    last_error: text(input.last_error),
    assignee: "",
    resolution: ""
  };
}

module.exports = {
  DELIVERY_LOG_HEADERS,
  FAQ_HEADERS,
  FUNNEL_STATES,
  HUMAN_QUEUE_HEADERS,
  LEAD_HEADERS,
  activeFaqRows,
  aggregateDelivery,
  classifyOptIn,
  humanQueueCase,
  isPostedConfirmation,
  numericBatchNames,
  parseModelClassification,
  planDelivery,
  reservationWinner,
  rowValues,
  rowsFromValues,
  selectFaqAnswer,
  selectNextBatch,
  usedBatchNumbers,
  verifyMetaSignature
};
