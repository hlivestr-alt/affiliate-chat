"use strict";

const CHAT_HEADERS = Object.freeze([
  "Event Time Jakarta", "Event Time UTC", "Direction", "Event Type", "WhatsApp Number", "wa_id", "TikTok Username",
  "Contact/Lead ID", "Conversation Key", "Inbound Message ID", "Outbound wamid", "Reply-To Message ID", "Message Type",
  "Message Text", "Media Filename", "Folder Number", "Clip Filename", "Delivery Key", "Workflow Name", "n8n Execution ID",
  "Last Inbound At", "Window Expires At", "Lead State", "Intent", "Send State", "Delivery State", "Error Code",
  "Error Title", "Error Details", "Created At", "Updated At", "Sent At", "Delivered At", "Read At", "Failed At",
  "Record Source", "Backfill Timestamp", "Deduplication Key"
]);
const CLIP_HEADERS = Object.freeze([
  "Folder Number", "Batch/Assignment ID", "Clip Sequence", "Clip Filename", "Full Local Source Path", "File Size Bytes",
  "Media Type", "WhatsApp Number", "wa_id", "TikTok Username", "Lead ID", "Assignment Date", "Upload Started At",
  "Message Sent At", "Outbound wamid", "Send State", "Sent At", "Delivery State", "Delivered At", "Read At", "Failed At",
  "Error Code", "Error Title", "Error Details", "Delivery Key", "Attempt Count", "n8n Execution ID", "Current Result",
  "Updated At", "Record Source", "Backfill Timestamp"
]);
const RAW_HEADERS = Object.freeze([
  "Received Timestamp", "Event Kind", "Event Category", "Phone Number", "wa_id", "Message ID / wamid", "Workflow",
  "Execution ID", "Deduplication Key", "Sanitized JSON Payload", "Processing Result", "Error Summary"
]);

function text(value) { return value == null ? "" : String(value).trim(); }
function digits(value) { return text(value).replace(/\D/g, ""); }
function iso(value, fallback = "") {
  const raw = text(value);
  if (!raw) return fallback;
  const numeric = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
  const ms = Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}
function jakarta(value) {
  const normalized = iso(value);
  if (!normalized) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(normalized));
  const p = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${p("year")}-${p("month")}-${p("day")} ${p("hour")}:${p("minute")}:${p("second")}`;
}
function sanitize(value, depth = 0) {
  if (depth > 12) return "<max-depth>";
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /authorization|cookie|credential|password|secret|token|api.?key/i.test(key) ? "<redacted>" : sanitize(item, depth + 1)]));
  if (typeof value === "string") return value.replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>").replace(/([?&](?:access_token|token|key|secret)=)[^&\s]+/gi, "$1<redacted>");
  return value;
}
function blank(headers) { return Object.fromEntries(headers.map((header) => [header, ""])); }
function intent(source) {
  if (source.reason === "conflicting_affiliate_match" || source.route === "queue") return "manual_review";
  if (source.action === "confirmation") return "confirmed";
  if (source.action === "clarification" || source.state === "awaiting_username") return "awaiting_username";
  if (/^(?:minat|interested|tertarik|mau|yes|iya)(?:\b|$)/i.test(text(source.message_text))) return "interested";
  return text(source.intent || "unknown");
}
function eventType(kind, source) {
  if (kind.startsWith("inbound") || (kind === "authenticated_webhook" && source.event_kind === "message")) return text(source.message_type) === "text" ? "inbound_text" : "inbound_media";
  if (kind === "outbound_text") return source.action === "clarification" ? "clarification" : source.action === "confirmation" ? "confirmation" : "other";
  if (kind.startsWith("clip")) return kind === "clip_intro" ? "clip_intro" : "other";
  return kind === "status_callback" || (kind === "authenticated_webhook" && source.delivery_status) ? "status_update" : "other";
}
function resultForClip(kind, source) {
  if (kind === "clip_guard" && !source.outbound_allowed) return source.blocked_reason === "no_active_customer_service_window" ? "Blocked: window expired" : "Blocked: duplicate";
  if (kind === "clip_assigned") return "Pending";
  if (kind === "clip_upload") return source.upload_success ? "Uploaded" : "Failed";
  if (kind === "clip_send") return source.send_state === "accepted" ? "Accepted by Meta" : source.send_state === "failed" ? "Failed" : "Outcome uncertain";
  const status = text(source.delivery_status).toLowerCase();
  return status ? status[0].toUpperCase() + status.slice(1) : "";
}
function normalizeEvent(source, nowValue = new Date().toISOString()) {
  const kind = text(source.observability_kind || "other");
  const now = iso(nowValue, new Date().toISOString());
  const statusCallback = Boolean(source.delivery_status) && (kind === "authenticated_webhook" || kind === "status_callback");
  const inbound = kind.startsWith("inbound") || (kind === "authenticated_webhook" && source.event_kind === "message" && !source.delivery_status);
  const outboundText = kind === "outbound_text";
  const clipEvent = kind.startsWith("clip_");
  const wamid = text(source.returned_wamid || (statusCallback ? source.whatsapp_message_id : source.whatsapp_message_id?.startsWith?.("wamid.") ? source.whatsapp_message_id : ""));
  const inboundId = inbound ? text(source.whatsapp_message_id || source.last_inbound_message_id) : "";
  const deliveryKey = text(source.delivery_key);
  const phone = digits(source.whatsapp_number || source.recipient_number || source.wa_id);
  const utc = iso(source.whatsapp_timestamp || source.accepted_at || source.n8n_execution_time || now, now);
  const status = text(source.delivery_status).toLowerCase();
  const dedup = inbound ? `inbound:${inboundId}` : outboundText ? `outbound:${wamid || source.outbound_source_reference}` : clipEvent ? `clip:${deliveryKey || wamid}` : statusCallback ? `outbound:${wamid}` : "";
  const rawKey = text(source.status_event_key || source.raw_deduplication_key || `${kind}:${inboundId || wamid || deliveryKey}:${status}`);
  const raw = {
    "Received Timestamp": now, "Event Kind": kind, "Event Category": statusCallback ? "Status callback" : inbound ? "Inbound message" : kind,
    "Phone Number": phone, "wa_id": digits(source.wa_id || phone), "Message ID / wamid": inboundId || wamid,
    "Workflow": text(source.workflow_name || source.source_workflow), "Execution ID": text(source.execution_id),
    "Deduplication Key": rawKey, "Sanitized JSON Payload": JSON.stringify(sanitize(source.raw_callback || source.raw_event || source)),
    "Processing Result": text(source.processing_result || (source.inbound_duplicate ? "ignored_duplicate" : "processed")),
    "Error Summary": text(source.error_message || source.last_error || source.blocked_reason)
  };
  let chat = null;
  if (inbound || outboundText || kind === "clip_send" || statusCallback) {
    chat = blank(CHAT_HEADERS);
    Object.assign(chat, {
      "Event Time Jakarta": jakarta(utc), "Event Time UTC": utc, "Direction": inbound ? "inbound" : "outbound",
      "Event Type": eventType(kind, source), "WhatsApp Number": phone, "wa_id": digits(source.wa_id || phone),
      "TikTok Username": text(source.username).replace(/^@+/, ""), "Contact/Lead ID": text(source.conversation_id || (phone ? `wa:${phone}` : "")),
      "Conversation Key": text(source.conversation_id || (phone ? `wa:${phone}` : "")), "Inbound Message ID": inboundId,
      "Outbound wamid": wamid, "Reply-To Message ID": text(source.reply_to_message_id || (source.outbound_source_reference || "").replace(/^confirmation:/, "")),
      "Message Type": inbound ? text(source.message_type || "unknown") : kind === "clip_send" ? "video" : "text",
      "Message Text": inbound ? text(source.message_text) : outboundText ? text(source.outbound_body) : "",
      "Media Filename": kind === "clip_send" ? text(source.file_name) : "", "Folder Number": text(source.batch_number),
      "Clip Filename": text(source.file_name), "Delivery Key": deliveryKey, "Workflow Name": text(source.workflow_name || source.source_workflow),
      "n8n Execution ID": text(source.execution_id), "Last Inbound At": iso(source.last_inbound_at), "Window Expires At": iso(source.window_expires_at),
      "Lead State": text(source.state), "Intent": intent(source),
      "Send State": inbound ? "" : status === "failed" ? "failed" : ["sent", "delivered", "read"].includes(status) ? "sent" : text(source.send_state || source.api_status),
      "Delivery State": inbound ? "" : status === "read" ? "read" : status === "delivered" ? "delivered" : "pending",
      "Error Code": text(source.error_code), "Error Title": text(source.error_title), "Error Details": text(source.error_details || source.error_message || source.last_error),
      "Created At": now, "Updated At": now, "Sent At": status === "sent" ? utc : "", "Delivered At": status === "delivered" ? utc : "",
      "Read At": status === "read" ? utc : "", "Failed At": status === "failed" ? utc : "", "Record Source": "live", "Deduplication Key": dedup
    });
  }
  let clip = null;
  if (clipEvent || statusCallback) {
    clip = blank(CLIP_HEADERS);
    Object.assign(clip, {
      "Folder Number": text(source.batch_number), "Batch/Assignment ID": text(source.assignment_id || `${source.conversation_id || ""}:${source.batch_number || ""}`),
      "Clip Sequence": source.file_index == null ? "" : source.file_index, "Clip Filename": text(source.file_name),
      "Full Local Source Path": text(source.full_local_source_path || (source.batch_number && source.file_name ? `D:\\output_clips\\export_batches_whatsapp\\${source.batch_number}\\${source.file_name}` : "")),
      "File Size Bytes": source.file_size_bytes == null ? "" : source.file_size_bytes, "Media Type": text(source.media_type || "video/mp4"),
      "WhatsApp Number": phone, "wa_id": digits(source.wa_id || phone), "TikTok Username": text(source.username).replace(/^@+/, ""),
      "Lead ID": text(source.conversation_id), "Assignment Date": iso(source.batch_reserved_at || (kind === "clip_assigned" ? now : "")),
      "Upload Started At": kind === "clip_upload" ? now : "", "Message Sent At": kind === "clip_send" && wamid ? now : "",
      "Outbound wamid": wamid, "Send State": status === "failed" ? "failed" : ["sent", "delivered", "read"].includes(status) ? "sent" : text(source.send_state),
      "Sent At": status === "sent" ? utc : text(source.sent_at), "Delivery State": status === "read" ? "read" : status === "delivered" ? "delivered" : (wamid ? "pending" : ""),
      "Delivered At": status === "delivered" ? utc : "", "Read At": status === "read" ? utc : "", "Failed At": status === "failed" ? utc : "",
      "Error Code": text(source.error_code), "Error Title": text(source.error_title), "Error Details": text(source.error_details || source.error_message || source.last_error),
      "Delivery Key": deliveryKey, "Attempt Count": source.attempts == null ? "" : source.attempts, "n8n Execution ID": text(source.execution_id),
      "Current Result": resultForClip(kind, source), "Updated At": now, "Record Source": "live"
    });
  }
  return { kind, raw, chat, clip, chat_dedup_key: dedup, clip_dedup_key: deliveryKey || wamid };
}
function mergeMonotonic(existing, incoming, headers, type) {
  const merged = { ...blank(headers), ...existing };
  for (const header of headers) if (incoming[header] !== "" && incoming[header] != null) merged[header] = incoming[header];
  merged["Created At"] = existing["Created At"] || incoming["Created At"] || "";
  for (const field of ["Sent At", "Delivered At", "Read At", "Failed At"]) merged[field] = existing[field] || incoming[field] || "";
  const deliveryRank = { "": 0, pending: 1, delivered: 2, read: 3 };
  if ((deliveryRank[text(existing["Delivery State"]).toLowerCase()] || 0) > (deliveryRank[text(incoming["Delivery State"]).toLowerCase()] || 0)) merged["Delivery State"] = existing["Delivery State"];
  if (["delivered", "read"].includes(text(existing["Delivery State"]).toLowerCase()) && text(incoming["Send State"]).toLowerCase() === "sent") merged["Send State"] = existing["Send State"] || "sent";
  if (type === "clip") {
    const resultRank = { Pending: 0, Uploaded: 1, "Accepted by Meta": 2, Sent: 3, Delivered: 4, Read: 5 };
    if ((resultRank[existing["Current Result"]] || 0) > (resultRank[incoming["Current Result"]] || 0)) merged["Current Result"] = existing["Current Result"];
  }
  return merged;
}

module.exports = { CHAT_HEADERS, CLIP_HEADERS, RAW_HEADERS, mergeChatRecord: (a, b) => mergeMonotonic(a, b, CHAT_HEADERS, "chat"), mergeClipRecord: (a, b) => mergeMonotonic(a, b, CLIP_HEADERS, "clip"), normalizeEvent, sanitize };
