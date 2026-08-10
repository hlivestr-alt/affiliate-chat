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
    const parsed = JSON.parse(raw);
    return object(parsed);
  } catch {
    return {};
  }
}

function normalizeUsername(value) {
  return text(value).normalize("NFKC").trim().replace(/^@+/, "");
}

function normalizePhone(value) {
  const digits = text(value).normalize("NFKC").replace(/\D/g, "");
  const international = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  return /^628\d{8,11}$/.test(international) ? `+${international}` : "";
}

function extractPhone(value) {
  const normalized = text(value)
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-");
  const pattern = /(?<!\d)(?:\+?\s*62|0)[\s(.-]*8(?:[\s().-]*\d){8,11}(?![\s().-]*\d)/g;
  for (const match of normalized.matchAll(pattern)) {
    const phone = normalizePhone(match[0]);
    if (phone) return phone;
  }
  return "";
}

function parseTimestamp(value) {
  const raw = text(value).trim();
  if (!raw) return Number.NaN;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  return Date.parse(raw);
}

function capturedAt(value) {
  const parsed = parseTimestamp(value);
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : new Date().toISOString();
}

return $input.all().map((item) => {
  const source = object(item.json);
  const body = Object.keys(object(source.body)).length ? object(source.body) : source;
  const message = object(body.message);
  const data = object(body.data);
  const sender = object(data.sender);
  const content = parseJsonObject(data.content || body.content || message.content);
  const rawContent = text(data.content || body.content || message.content);
  const inboundText = text(
    body.text ||
    body.message_text ||
    body.reply_text ||
    content.content ||
    content.text ||
    content.message ||
    message.text ||
    data.text ||
    (rawContent.startsWith("{") ? "" : rawContent)
  );
  const whatsappNumber = extractPhone(inboundText);

  return {
    json: {
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
      inbound_text: inboundText,
      recent_replies: Array.isArray(body.recent_replies)
        ? body.recent_replies
        : Array.isArray(source.recent_replies)
          ? source.recent_replies
          : [],
      whatsapp_number: whatsappNumber,
      captured_at: capturedAt(
        body.backfill_original_received_at ||
        source.message_received_at ||
        body.received_at ||
        body.created_at ||
        body.timestamp ||
        data.create_time ||
        data.timestamp ||
        message.create_time
      ),
      has_valid_phone: Boolean(whatsappNumber),
      action: whatsappNumber ? "capture_whatsapp_lead" : "no_write"
    }
  };
});
