const LOOKBACK_HOURS = 24;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const IGNORED_SENDER_IM_USER_IDS = new Set([
  "7857891324986241124"
]);

function text(value) {
  return value == null ? "" : String(value);
}

function messageParts(input) {
  const body = input && input.body && typeof input.body === "object" ? input.body : input || {};
  const message = body.message && typeof body.message === "object" ? body.message : {};
  const conversation = body.conversation && typeof body.conversation === "object" ? body.conversation : {};
  const latestMessage = body.latest_message && typeof body.latest_message === "object" ? body.latest_message : {};
  const data = body.data && typeof body.data === "object" ? body.data : {};
  return { body, message, conversation, latestMessage, data };
}

function senderImUserId(input) {
  const { body, message, data } = messageParts(input);
  const bodySender = body.sender && typeof body.sender === "object" ? body.sender : {};
  const messageSender = message.sender && typeof message.sender === "object" ? message.sender : {};
  const dataSender = data.sender && typeof data.sender === "object" ? data.sender : {};
  return text(
    body.sender_im_user_id ||
    body.sender_id ||
    message.sender_im_user_id ||
    message.sender_id ||
    data.sender_im_user_id ||
    data.sender_id ||
    bodySender.sender_im_user_id ||
    bodySender.sender_id ||
    messageSender.sender_im_user_id ||
    messageSender.sender_id ||
    dataSender.sender_im_user_id ||
    dataSender.sender_id
  );
}

function getByKeys(objects, keys) {
  for (const object of objects) {
    if (!object || typeof object !== "object") continue;
    for (const key of keys) {
      if (object[key] != null && object[key] !== "") return object[key];
    }
  }
  return undefined;
}

function parseBooleanLike(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  const normalized = text(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return undefined;
}

function parseTimestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) < 1e12 ? value * 1000 : value;
  }
  const trimmed = text(value).trim();
  if (!trimmed) return Number.NaN;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric;
  }
  return Date.parse(trimmed);
}

function inboundMessageTimestampMs(input) {
  const { body, message, conversation, latestMessage, data } = messageParts(input);
  const value = getByKeys(
    [body, data, message, latestMessage, conversation],
    ["received_at", "created_at", "create_time", "timestamp", "message_time", "send_time", "sent_at"]
  );
  return parseTimestampMs(value);
}

function hasExplicitUnreadSignal(input) {
  const { body, message, conversation, latestMessage, data } = messageParts(input);
  const objects = [body, data, message, latestMessage, conversation];

  for (const object of objects) {
    if (!object || typeof object !== "object") continue;
    for (const key of [
      "is_unread",
      "unread",
      "has_unread",
      "read",
      "is_read",
      "seen",
      "is_seen",
      "read_status",
      "status",
      "message_status",
      "unread_count",
      "unreadCount"
    ]) {
      if (object[key] != null && object[key] !== "") return true;
    }
  }

  return false;
}

function isUnreadMessage(input) {
  const { body, message, conversation, latestMessage, data } = messageParts(input);
  const objects = [body, data, message, latestMessage, conversation];

  for (const object of objects) {
    if (!object || typeof object !== "object") continue;
    for (const key of ["is_unread", "unread", "has_unread"]) {
      if (parseBooleanLike(object[key]) === true) return true;
    }
  }

  for (const object of objects) {
    if (!object || typeof object !== "object") continue;
    for (const key of ["read", "is_read", "seen", "is_seen"]) {
      if (parseBooleanLike(object[key]) === false) return true;
    }
  }

  for (const object of objects) {
    if (!object || typeof object !== "object") continue;
    for (const key of ["read_status", "status", "message_status"]) {
      const normalized = text(object[key]).trim().toLowerCase();
      if (["unread", "not_read", "new", "unseen"].includes(normalized)) return true;
    }
  }

  const unreadCount = Number(getByKeys(objects, ["unread_count", "unreadCount"]));
  return Number.isFinite(unreadCount) && unreadCount > 0;
}

function withinLast24Hours(timestampMs) {
  if (!Number.isFinite(timestampMs)) return false;
  const nowMs = Date.now();
  const earliest = nowMs - LOOKBACK_HOURS * 60 * 60 * 1000;
  return timestampMs >= earliest && timestampMs <= nowMs + FUTURE_CLOCK_SKEW_MS;
}

const output = [];
for (const item of $input.all()) {
  const body = item.json && item.json.body && typeof item.json.body === "object" ? item.json.body : item.json || {};
  if (body.type != null && Number(body.type) !== 33) continue;
  if (IGNORED_SENDER_IM_USER_IDS.has(senderImUserId(item.json))) continue;

  const parsedTimestampMs = inboundMessageTimestampMs(item.json);
  const hasTimestamp = Number.isFinite(parsedTimestampMs);
  const timestampMs = hasTimestamp ? parsedTimestampMs : Date.now();
  const hasUnreadSignal = hasExplicitUnreadSignal(item.json);
  const unread = hasUnreadSignal ? isUnreadMessage(item.json) : true;
  const recent = withinLast24Hours(timestampMs);
  if (!unread || !recent) continue;

  output.push({
    json: {
      ...item.json,
      is_unread_message: unread,
      intake_assumed_unread: !hasUnreadSignal,
      intake_assumed_received_at: !hasTimestamp,
      message_received_at: new Date(timestampMs).toISOString(),
      message_age_hours: (Date.now() - timestampMs) / (60 * 60 * 1000)
    }
  });
}

return output;
