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

function messageBody(item) {
  const raw = item && item.message_body != null ? item.message_body : item;
  return parseJsonObject(raw);
}

function messageText(item) {
  const body = messageBody(item);
  const content = body.content;
  const parsed = parseJsonObject(content);
  return text(
    parsed.content ||
    parsed.text ||
    parsed.message ||
    body.text ||
    (text(content).trim().startsWith("{") ? "" : content)
  ).trim();
}

function timestampMs(item) {
  const body = messageBody(item);
  const raw = text(body.create_time || item.create_time || item.conversation_index).trim();
  if (!raw) return 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function senderId(item) {
  const body = messageBody(item);
  return text(
    body.sender_id ||
    body.sender_im_user_id ||
    item.sender_id ||
    item.sender_im_user_id
  );
}

function messageType(item) {
  const body = messageBody(item);
  return text(body.type || body.msg_type || item.type || item.msg_type).toUpperCase();
}

const source = $("Extract WhatsApp Lead").first().json;
const response = $json || {};
const data = object(response.data);
const messages = Array.isArray(data.messages)
  ? data.messages
  : Array.isArray(data.message_list)
    ? data.message_list
    : [];
const ignoredSender = "7857891324986241124";
const apiReplies = messages
  .filter((item) => senderId(item) !== ignoredSender)
  .filter((item) => !messageType(item) || messageType(item) === "TEXT")
  .map((item) => ({ text: messageText(item), at: timestampMs(item) }))
  .filter((item) => item.text)
  .sort((a, b) => a.at - b.at)
  .slice(-3)
  .map((item) => item.text);
const suppliedReplies = Array.isArray(source.recent_replies)
  ? source.recent_replies.map((value) => text(value).trim()).filter(Boolean).slice(-3)
  : [];
const recentReplies = apiReplies.length
  ? apiReplies
  : suppliedReplies.length
    ? suppliedReplies
    : [text(source.inbound_text).trim()].filter(Boolean);

return [{
  json: {
    ...source,
    recent_replies: recentReplies,
    reply_history_count: recentReplies.length,
    reply_history_api_code: response.code,
    reply_history_api_message: text(response.message)
  }
}];
