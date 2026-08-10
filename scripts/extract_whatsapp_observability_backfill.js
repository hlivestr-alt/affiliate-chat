#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse: parseFlatted } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");

const CLARIFICATION_TEXT = "Halo Kak! Terima kasih sudah menghubungi PROYA 😊 Untuk menerima video affiliate, kirim username TikTok dengan format: MINAT @username";
const CONFIRMATION_TEXT = (username) => `Halo Kak ${username ? `@${username}` : ""}! Terima kasih sudah tertarik bekerja sama dengan PROYA 😊 Video akan kami kirim melalui WhatsApp ini. Mohon upload ke TikTok dan tambahkan keranjang kuning produk PROYA.`.replace("Kak !", "Kak!");

function text(value) { return value == null ? "" : String(value).trim(); }
function digits(value) { return text(value).replace(/\D/g, ""); }
function parseJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(text(value) || JSON.stringify(fallback)); } catch { return fallback; }
}
function validUsername(value) { return /^[a-z0-9._]{2,30}$/i.test(text(value).replace(/^@+/, "")); }
function iso(value) {
  const raw = text(value);
  if (!raw) return "";
  let ms;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const number = Number(raw);
    ms = number < 1e12 ? number * 1000 : number;
  } else {
    ms = Date.parse(raw.endsWith("Z") || /[+-]\d\d:\d\d$/.test(raw) ? raw : raw.replace(" ", "T") + "Z");
  }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}
function jakarta(value) {
  const normalized = iso(value);
  if (!normalized) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(normalized));
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}
function sanitize(value, depth = 0) {
  if (depth > 12) return "<max-depth>";
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /authorization|cookie|credential|password|secret|token|api.?key/i.test(key)
        ? "<redacted>"
        : sanitize(item, depth + 1)
    ]));
  }
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>")
      .replace(/([?&](?:access_token|token|key|secret)=)[^&\s]+/gi, "$1<redacted>");
  }
  return value;
}
function rowsFromRange(valueRange) {
  const values = valueRange?.values || [];
  const headers = (values[0] || []).map(text);
  return values.slice(1).map((row, index) => ({
    _row_number: index + 2,
    ...Object.fromEntries(headers.map((name, column) => [name, row[column] == null ? "" : row[column]]))
  }));
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
}
function outputItems(run) {
  const main = run?.data?.main;
  return Array.isArray(main) ? main.flat().filter(Boolean) : [];
}
function statusTimes(row) {
  const result = { sent: "", delivered: "", read: "", failed: "" };
  const history = parseJson(row.status_history_json, []);
  for (const item of Array.isArray(history) ? history : []) {
    const status = text(item?.status).toLowerCase();
    const at = iso(item?.timestamp || item?.n8n_execution_time);
    if (Object.prototype.hasOwnProperty.call(result, status) && at && !result[status]) result[status] = at;
  }
  return result;
}
function inferIntent(direction, body, lead, sourceReference) {
  if (direction === "outbound") {
    if (sourceReference.startsWith("confirmation:")) return "confirmed";
    if (sourceReference.startsWith("clarification:")) return "awaiting_username";
    return "unknown";
  }
  const value = text(body).normalize("NFKC");
  if (lead?._conflict) return "manual_review";
  if (/^(?:minat|interested|tertarik|mau|yes|iya)(?:\b|$)/i.test(value)) return "interested";
  if (validUsername(value.replace(/^minat\s+@?/i, ""))) return "confirmed";
  if (lead?.state === "awaiting_username") return "awaiting_username";
  return value ? "unknown" : "unknown";
}
function eventType(direction, messageType, sourceReference) {
  if (direction === "inbound") return messageType === "text" ? "inbound_text" : "inbound_media";
  if (sourceReference.startsWith("clarification:")) return "clarification";
  if (sourceReference.startsWith("confirmation:")) return "confirmation";
  if (sourceReference.includes("intro")) return "clip_intro";
  if (sourceReference.includes("faq")) return "faq_reply";
  return "other";
}
function outboundBody(row, lead) {
  const payload = parseJson(row.message_payload_json, {});
  const direct = text(payload.text || payload.body || payload.message_text || payload.caption);
  if (direct) return direct;
  const reference = text(row.source_reference);
  if (reference.startsWith("clarification:")) return CLARIFICATION_TEXT;
  if (reference.startsWith("confirmation:")) return CONFIRMATION_TEXT(text(lead?.username).replace(/^@+/, ""));
  return "";
}

async function main() {
  const [databasePath, sheetsPath, clipsRoot, outputPath] = process.argv.slice(2);
  if (!databasePath || !sheetsPath || !clipsRoot || !outputPath) {
    throw new Error("usage: extract_whatsapp_observability_backfill.js DB SHEETS_JSON CLIPS_ROOT OUTPUT_JSON");
  }
  const sheetBackup = JSON.parse(fs.readFileSync(sheetsPath, "utf8"));
  const ranges = new Map((sheetBackup.valueRanges || []).map((entry) => [entry.range.split("!")[0].replace(/^'|'$/g, "").replace(/''/g, "'"), entry]));
  const leads = rowsFromRange(ranges.get("WhatsApp Leads"));
  const messages = rowsFromRange(ranges.get("WhatsApp Message Log"));
  const deliveries = rowsFromRange(ranges.get("Delivery Log"));
  const leadByPhone = new Map();
  for (const lead of leads) {
    for (const key of new Set([digits(lead.whatsapp_number), digits(lead.wa_id)].filter(Boolean))) {
      const list = leadByPhone.get(key) || [];
      list.push(lead);
      leadByPhone.set(key, list);
    }
  }
  function leadFor(number) {
    const matches = leadByPhone.get(digits(number)) || [];
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return { ...matches[0], _conflict: true };
    return null;
  }

  const db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY);
  let executionRows;
  try {
    executionRows = await all(db, `
      select e.id, e."workflowId", e.status, e."startedAt", e."stoppedAt", d.data
      from execution_entity e join execution_data d on d."executionId" = e.id
      where e."startedAt" >= datetime('now','-24 hours')
        and e."workflowId" in ('AffWaWebhook2026','AffWaReply2026','AffWaDelivery2026','AffWaStatus2026')
      order by e.id`);
  } finally { db.close(); }

  const raw = [];
  const inboundExecution = new Map();
  const deliveryExecutions = new Map();
  const seenRaw = new Set();
  for (const row of executionRows) {
    const execution = parseFlatted(row.data);
    const runData = execution?.resultData?.runData || {};
    if (row.workflowId === "AffWaWebhook2026") {
      for (const run of runData["Verify and Parse WhatsApp Webhook"] || []) {
        for (const item of outputItems(run)) {
          const event = item.json || {};
          if (!event.signature_valid) continue;
          const messageId = text(event.whatsapp_message_id);
          const status = text(event.delivery_status).toLowerCase();
          const key = text(event.status_event_key) || `${text(event.event_kind)}:${messageId}:${status || "message"}`;
          const duplicate = seenRaw.has(key);
          seenRaw.add(key);
          if (messageId && !status && !inboundExecution.has(messageId)) inboundExecution.set(messageId, String(row.id));
          raw.push({
            "Received Timestamp": iso(row.startedAt),
            "Event Kind": text(event.event_kind),
            "Event Category": status ? "Status callback" : "Inbound message",
            "Phone Number": digits(event.whatsapp_number),
            "wa_id": digits(event.wa_id || event.whatsapp_number),
            "Message ID / wamid": messageId,
            "Workflow": "AffWaWebhook2026",
            "Execution ID": String(row.id),
            "Deduplication Key": key,
            "Sanitized JSON Payload": JSON.stringify(sanitize(event.raw_callback || event.raw_event || event)),
            "Processing Result": duplicate ? "ignored_duplicate" : "processed",
            "Error Summary": text(event.last_error || event.error_message)
          });
        }
      }
    }
    if (row.workflowId === "AffWaDelivery2026") {
      let batch = "";
      for (const run of runData["Confirm Reservation Winner"] || []) {
        const item = outputItems(run)[0];
        batch ||= text(item?.json?.batch_number);
      }
      if (batch) {
        const error = execution?.resultData?.error || {};
        deliveryExecutions.set(batch, {
          execution_id: String(row.id),
          started_at: iso(row.startedAt),
          error_node: text(error.node?.name),
          error_message: text(error.message)
        });
      }
    }
  }

  const chat = [];
  for (const row of messages) {
    const payload = parseJson(row.message_payload_json, {});
    let direction = text(row.direction).toLowerCase();
    if (!direction) direction = "outbound";
    const number = digits(row.recipient_number || payload.wa_id || payload.sender_phone);
    const lead = leadFor(number);
    const messageTypeRaw = text(row.message_type).toLowerCase();
    const messageType = ["text", "video", "document", "image", "sticker", "interactive"].includes(messageTypeRaw) ? messageTypeRaw : "unknown";
    const sourceReference = text(row.source_reference);
    const inboundId = direction === "inbound" ? text(row.whatsapp_message_id) : "";
    const outboundId = direction === "outbound" && text(row.whatsapp_message_id).startsWith("wamid.") ? text(row.whatsapp_message_id) : "";
    const body = direction === "inbound" ? text(payload.text) : outboundBody(row, lead);
    const baseTime = direction === "inbound"
      ? iso(payload.meta_timestamp || payload.received_timestamp || row.status_timestamp || row.accepted_at)
      : iso(row.accepted_at || row.updated_at || row.status_timestamp);
    const times = statusTimes(row);
    const currentStatus = text(row.current_status || row.api_status).toLowerCase();
    const sendState = direction === "outbound"
      ? (currentStatus === "failed" ? "failed" : text(row.send_state || row.api_status).toLowerCase() || "outcome_uncertain")
      : "";
    const deliveryState = direction === "outbound"
      ? (currentStatus === "read" ? "read" : currentStatus === "delivered" ? "delivered" : "pending")
      : "";
    const replyTo = sourceReference.startsWith("confirmation:") ? sourceReference.slice("confirmation:".length) : "";
    const dedup = direction === "inbound" ? `inbound:${inboundId}` : `outbound:${outboundId || sourceReference || row.whatsapp_message_id}`;
    chat.push({
      "Event Time Jakarta": jakarta(baseTime), "Event Time UTC": baseTime,
      "Direction": direction, "Event Type": eventType(direction, messageType, sourceReference),
      "WhatsApp Number": number, "wa_id": digits(lead?.wa_id || number),
      "TikTok Username": text(lead?.username).replace(/^@+/, ""),
      "Contact/Lead ID": text(lead?.conversation_id || (number ? `wa:${number}` : "")),
      "Conversation Key": text(lead?.conversation_id || (number ? `wa:${number}` : "")),
      "Inbound Message ID": inboundId, "Outbound wamid": outboundId,
      "Reply-To Message ID": replyTo, "Message Type": messageType,
      "Message Text": body, "Media Filename": "", "Folder Number": text(lead?.batch_number),
      "Clip Filename": "", "Delivery Key": sourceReference.startsWith("wa:") ? sourceReference : "",
      "Workflow Name": text(row.source_workflow),
      "n8n Execution ID": inboundExecution.get(inboundId) || "",
      "Last Inbound At": iso(lead?.last_inbound_at), "Window Expires At": iso(lead?.window_expires_at),
      "Lead State": text(lead?.state), "Intent": inferIntent(direction, body, lead, sourceReference),
      "Send State": sendState, "Delivery State": deliveryState,
      "Error Code": text(row.error_code), "Error Title": text(row.error_title),
      "Error Details": text(row.error_details || row.error_message),
      "Created At": iso(row.accepted_at || baseTime || row.updated_at), "Updated At": iso(row.updated_at || baseTime),
      "Sent At": times.sent, "Delivered At": times.delivered, "Read At": times.read, "Failed At": times.failed,
      "Record Source": "historical_backfill", "Backfill Timestamp": new Date().toISOString(),
      "Deduplication Key": dedup
    });
    if (direction === "outbound") {
      raw.push({
        "Received Timestamp": iso(row.accepted_at || row.updated_at), "Event Kind": "outbound_send_result",
        "Event Category": "Outbound send result", "Phone Number": number, "wa_id": digits(lead?.wa_id || number),
        "Message ID / wamid": text(row.whatsapp_message_id), "Workflow": text(row.source_workflow),
        "Execution ID": "", "Deduplication Key": `send-result:${text(row.whatsapp_message_id)}`,
        "Sanitized JSON Payload": JSON.stringify(sanitize({
          message_type: messageType, source_reference: sourceReference, api_status: row.api_status,
          current_status: row.current_status, error_code: row.error_code, error_title: row.error_title,
          error_details: row.error_details
        })), "Processing Result": "historical_backfill", "Error Summary": text(row.error_message || row.error_details)
      });
    }
  }

  const clip = [];
  const deliveryByKey = new Map(deliveries.map((row) => [text(row.delivery_key), row]));
  for (const lead of leads) {
    const batch = text(lead.batch_number);
    if (!/^\d+$/.test(batch)) continue;
    const folder = path.join(clipsRoot, batch);
    if (!fs.existsSync(folder)) continue;
    const files = fs.readdirSync(folder).filter((name) => name.toLowerCase().endsWith(".mp4")).sort((a, b) => a.localeCompare(b));
    const execution = deliveryExecutions.get(batch) || {};
    files.forEach((fileName, index) => {
      const sourcePath = path.join(folder, fileName);
      const key = `${text(lead.conversation_id)}:${batch}:${fileName}`;
      const existing = deliveryByKey.get(key) || {};
      clip.push({
        "Folder Number": batch, "Batch/Assignment ID": `${text(lead.conversation_id)}:${batch}`,
        "Clip Sequence": index + 1, "Clip Filename": fileName,
        "Full Local Source Path": `D:\\output_clips\\export_batches_whatsapp\\${batch}\\${fileName}`,
        "File Size Bytes": fs.statSync(sourcePath).size, "Media Type": "video/mp4",
        "WhatsApp Number": digits(lead.whatsapp_number), "wa_id": digits(lead.wa_id || lead.whatsapp_number),
        "TikTok Username": text(lead.username).replace(/^@+/, ""), "Lead ID": text(lead.conversation_id),
        "Assignment Date": iso(lead.batch_reserved_at), "Upload Started At": iso(existing.uploaded_at),
        "Message Sent At": iso(existing.sent_at), "Outbound wamid": text(existing.whatsapp_message_id),
        "Send State": text(existing.send_state), "Sent At": iso(existing.sent_at),
        "Delivery State": text(existing.delivery_state) || (existing.whatsapp_message_id ? "pending" : ""),
        "Delivered At": iso(existing.delivered_at), "Read At": "", "Failed At": iso(existing.failed_at),
        "Error Code": "", "Error Title": text(execution.error_node),
        "Error Details": text(existing.last_error || execution.error_message), "Delivery Key": key,
        "Attempt Count": Number(existing.attempts || 0), "n8n Execution ID": text(execution.execution_id),
        "Current Result": existing.whatsapp_message_id
          ? (text(existing.delivery_state) === "read" ? "Read" : text(existing.delivery_state) === "delivered" ? "Delivered" : "Accepted by Meta")
          : "Pending",
        "Updated At": iso(existing.updated_at || lead.updated_at || execution.started_at),
        "Record Source": "historical_backfill", "Backfill Timestamp": new Date().toISOString()
      });
    });
  }

  // Preserve any sent clip evidence that is not part of a numbered production folder (for example isolated TEST data).
  for (const row of deliveries) {
    if (/^\d+$/.test(text(row.batch_number))) continue;
    const lead = leadFor(row.whatsapp_number) || {};
    const current = text(row.delivery_state) === "read" ? "Read" : text(row.delivery_state) === "delivered" ? "Delivered" : text(row.send_state) === "failed" ? "Failed" : text(row.whatsapp_message_id) ? "Accepted by Meta" : "Outcome uncertain";
    clip.push({
      "Folder Number": "", "Batch/Assignment ID": text(row.batch_number), "Clip Sequence": Number(row.file_index || 0),
      "Clip Filename": text(row.file_name), "Full Local Source Path": "", "File Size Bytes": "", "Media Type": "video/mp4",
      "WhatsApp Number": digits(row.whatsapp_number), "wa_id": digits(lead.wa_id || row.whatsapp_number),
      "TikTok Username": text(lead.username).replace(/^@+/, ""), "Lead ID": text(row.conversation_id),
      "Assignment Date": "", "Upload Started At": iso(row.uploaded_at), "Message Sent At": iso(row.sent_at),
      "Outbound wamid": text(row.whatsapp_message_id), "Send State": text(row.send_state), "Sent At": iso(row.sent_at),
      "Delivery State": text(row.delivery_state), "Delivered At": iso(row.delivered_at), "Read At": "", "Failed At": iso(row.failed_at),
      "Error Code": "", "Error Title": "", "Error Details": text(row.last_error), "Delivery Key": text(row.delivery_key),
      "Attempt Count": Number(row.attempts || 0), "n8n Execution ID": "", "Current Result": current,
      "Updated At": iso(row.updated_at), "Record Source": "historical_backfill", "Backfill Timestamp": new Date().toISOString()
    });
  }

  const chatKeys = new Set();
  const chatDeduped = chat.filter((row) => row["Deduplication Key"] && !chatKeys.has(row["Deduplication Key"]) && chatKeys.add(row["Deduplication Key"]));
  const clipKeys = new Set();
  const clipDeduped = clip.filter((row) => row["Delivery Key"] && !clipKeys.has(row["Delivery Key"]) && clipKeys.add(row["Delivery Key"]));
  const report = {
    generated_at: new Date().toISOString(),
    source_window_hours: 24,
    authenticated_webhook_events_recovered: raw.filter((row) => row["Workflow"] === "AffWaWebhook2026").length,
    duplicate_webhook_events_marked: raw.filter((row) => row["Processing Result"] === "ignored_duplicate").length,
    messages_recovered: chatDeduped.length,
    inbound_messages_recovered: chatDeduped.filter((row) => row.Direction === "inbound").length,
    outbound_messages_recovered: chatDeduped.filter((row) => row.Direction === "outbound").length,
    contacts_recovered: new Set(chatDeduped.map((row) => row.wa_id || row["WhatsApp Number"]).filter(Boolean)).size,
    numbered_folders_recovered: new Set(clipDeduped.map((row) => row["Folder Number"]).filter((value) => /^\d+$/.test(value))).size,
    production_clips_recovered: clipDeduped.filter((row) => /^\d+$/.test(row["Folder Number"])).length,
    all_clip_rows_recovered: clipDeduped.length,
    raw_events_recovered: raw.length
  };
  fs.writeFileSync(outputPath, JSON.stringify({ chat: chatDeduped, clip: clipDeduped, raw, report }, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
