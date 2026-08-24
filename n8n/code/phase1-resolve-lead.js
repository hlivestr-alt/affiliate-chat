function text(value) { return value == null ? "" : String(value).trim(); }
function digits(value) { return text(value).replace(/\D/g, ""); }
function normalizeUsername(value) {
  return text(value).normalize("NFKC").replace(/^@+/, "").toLowerCase();
}
function validUsername(value) { return /^[a-z0-9._]{2,30}$/i.test(value); }
function timestamp(value) {
  const raw = text(value);
  if (!raw) return Number.NaN;
  if (/^\d+$/.test(raw)) return Number(raw) < 1e12 ? Number(raw) * 1000 : Number(raw);
  return Date.parse(raw);
}

const event = $("Restore Inbound after Durable Claim").first().json;
const values = Array.isArray($json.values) ? $json.values : [];
const headers = (values[0] || []).map(text);
for (const name of ["username", "whatsapp_number", "state", "last_inbound_at", "window_expires_at", "wa_id", "last_inbound_message_id"]) {
  if (!headers.includes(name)) throw new Error(`WhatsApp Leads missing header: ${name}`);
}
const records = values.slice(1).map((row, index) => ({
  row_number: index + 2,
  ...Object.fromEntries(headers.map((name, column) => [name, text(row[column])]))
}));
const body = text(event.message_text).normalize("NFKC").trim();
const lower = body.toLowerCase();
const structured = body.match(/^\s*minat\s+@?([a-z0-9._]{2,30})\s*$/i);
const interest = /^(?:minat|interested|tertarik|mau(?:\s+(?:video|clips?))?|yes|iya)(?:\b|$)/i.test(body);
const tokenOnly = body.match(/^@?([a-z0-9._]{2,30})$/i);
const unrelatedTokens = new Set(["halo", "hai", "hello", "hi", "minat", "interested", "tertarik", "yes", "iya"]);
let username = normalizeUsername(structured?.[1] || "");
const phone = digits(event.whatsapp_number);
const waId = digits(event.wa_id || event.whatsapp_number);

const phoneMatches = records.filter((row) => phone && digits(row.whatsapp_number) === phone);
let current = phoneMatches.length === 1 ? phoneMatches[0] : null;
if (!username && current?.state === "awaiting_username" && tokenOnly && !unrelatedTokens.has(normalizeUsername(tokenOnly[1]))) {
  username = normalizeUsername(tokenOnly[1]);
}
const usernameMatches = records.filter((row) =>
  username && normalizeUsername(row.username) === username
);
const conflict =
  phoneMatches.length > 1 || usernameMatches.length > 1 ||
  (phoneMatches.length === 1 && usernameMatches.length === 1 && phoneMatches[0].row_number !== usernameMatches[0].row_number) ||
  (current && username && current.username && normalizeUsername(current.username) !== username) ||
  (!current && usernameMatches.length === 1 && digits(usernameMatches[0].whatsapp_number) && digits(usernameMatches[0].whatsapp_number) !== phone);
if (conflict) {
  return [{ json: { ...event, route: "queue", reason: "conflicting_affiliate_match", queue_reason: "conflicting_affiliate_match", lead_write_action: "none" } }];
}
if (!current && usernameMatches.length === 1) current = usernameMatches[0];

const inboundMs = timestamp(event.whatsapp_timestamp);
const receivedMs = timestamp(event.n8n_execution_time);
const lastInboundMs = Number.isFinite(inboundMs) ? inboundMs : receivedMs;
if (!Number.isFinite(lastInboundMs)) throw new Error("Inbound WhatsApp timestamp is invalid");
const lastInboundAt = new Date(lastInboundMs).toISOString();
const expiresAt = new Date(lastInboundMs + 24 * 60 * 60 * 1000).toISOString();
const now = new Date().toISOString();
const record = Object.fromEntries(headers.map((name) => [name, ""]));
if (current) Object.assign(record, current);
record.username = username || record.username;
record.whatsapp_number = phone || record.whatsapp_number;
record.wa_id = waId || record.wa_id;
record.conversation_id = record.conversation_id || `wa:${waId || phone}`;
record.captured_at = record.captured_at || lastInboundAt;
record.last_whatsapp_message_id = text(event.whatsapp_message_id);
record.last_inbound_message_id = text(event.whatsapp_message_id);
record.last_inbound_at = lastInboundAt;
record.window_expires_at = expiresAt;
record.updated_at = now;

const hasValidUsername = validUsername(normalizeUsername(record.username));
const explicitContinue = /^(?:yes|iya|lanjut|continue|kirim|kirim video|mau video|mau clips?)\b/i.test(lower);
const legacyDeliveryStates = new Set(["delivery_in_progress", "partial", "files_sent", "files_delivered", "failed"]);
const currentDeliveryState = text(current?.delivery_state) ||
  (legacyDeliveryStates.has(text(current?.state)) ? text(current?.state) : "not_started");
const deliveryComplete = ["files_sent", "files_delivered"].includes(currentDeliveryState);
const ready =
  (interest && validUsername(username)) ||
  (current?.state === "awaiting_username" && validUsername(username)) ||
  (explicitContinue && hasValidUsername && !deliveryComplete && ["awaiting_confirmation", "distribution_pending", "waiting_for_affiliate_message"].includes(current?.state));

// General reply logging is intentionally paused. The lead state is the durable
// source of truth for whether a clarification has already been issued.
const clarificationSent = current?.state === "awaiting_username" ||
  current?.last_intent === "clarification_pending";

let action = "refresh_only";
if (ready) {
  action = "confirmation";
  record.state = "distribution_pending";
  record.last_intent = "distribution_intent";
  record.last_intent_confidence = "1";
} else if (!clarificationSent && (!hasValidUsername || !interest)) {
  action = "clarification";
  record.state = "awaiting_username";
  record.last_intent = "clarification_pending";
} else if (!hasValidUsername) {
  record.state = "awaiting_username";
}

return [{ json: {
  ...event,
  ...record,
  route: "message",
  action,
  display_username: record.username ? `@${normalizeUsername(record.username)}` : "",
  row_number: current?.row_number || "",
  lead_write_action: current ? "update" : "append",
  lead_row_values: headers.map((name) => text(record[name]))
} }];
