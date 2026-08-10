const EXPLANATION_TEMPLATE = [
  "Siap kak, aku jelasin ya",
  "",
  "Flow kerjasamanya:",
  "Kita kirim video konten cuplikan dari live Proya yang sudah siap upload",
  "Kakak tinggal upload dan masukan keranjang kuning di akun kakak (tidak perlu edit lagi)",
  "",
  "Benefit:",
  "Tinggal fokus upload & jualan",
  "Komisi 10%",
  "",
  "Ketentuan:",
  "Konsisten upload",
  "\t3-8 per hari",
  "\tJeda 1-3 jam antar video",
  "Cantumkan @proya_official di bio akun TikTok untuk menghindari pelanggaran karena dianggap bukan konten original.",
  "Jika akun mendapatkan pelanggaran \"Konten tidak Orisinal\", silakan ajukan banding dan sertakan screenshot chat ini sebagai bukti kerja sama.",
  "",
  "Kalau oke dan kaka mau, nanti aku kirim folder untuk download videonya ya kak."
].join("\n");

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

function inboundFrom(item) {
  const body = item.body && typeof item.body === "object" && !Array.isArray(item.body)
    ? item.body
    : object(item);
  const message = object(body.message);
  const data = object(body.data);
  const content = parseJsonObject(data.content || body.content || message.content);
  const bodySender = object(body.sender);
  const messageSender = object(message.sender);
  const dataSender = object(data.sender);
  const sender = bodySender.sender_im_user_id || bodySender.sender_id
    ? bodySender
    : messageSender.sender_im_user_id || messageSender.sender_id
      ? messageSender
      : dataSender;

  const rawContent = text(data.content || body.content || message.content);
  const parsedContentText = content.content || content.text || content.message || "";

  return {
    affiliate_id:
      body.affiliate_id ||
      body.creator_id ||
      body.user_id ||
      body.sender_id ||
      body.tiktok_user_id ||
      message.sender_id ||
      data.sender_id ||
      data.sender_im_user_id ||
      sender.sender_id ||
      sender.sender_im_user_id ||
      "",
    affiliate_name:
      body.affiliate_name ||
      body.creator_name ||
      body.display_name ||
      body.name ||
      message.sender_name ||
      "",
    username:
      body.username ||
      body.tiktok_handle ||
      body.handle ||
      body.unique_id ||
      body.creator_username ||
      body.sender_handle ||
      sender.username ||
      sender.tiktok_handle ||
      sender.handle ||
      sender.unique_id ||
      message.username ||
      message.tiktok_handle ||
      message.sender_handle ||
      message.unique_id ||
      "",
    conversation_id:
      body.conversation_id ||
      body.thread_id ||
      body.chat_id ||
      message.conversation_id ||
      data.conversation_id ||
      "",
    message_id:
      body.message_id ||
      body.id ||
      message.id ||
      message.message_id ||
      data.message_id ||
      "",
    inbound_text:
      body.text ||
      body.message_text ||
      body.reply_text ||
      parsedContentText ||
      body.latest_message ||
      message.text ||
      message.message_text ||
      data.text ||
      data.message_text ||
      (rawContent.startsWith("{") ? "" : rawContent) ||
      "",
    existing_assignment_state:
      body.existing_assignment_state ||
      body.assignment_state ||
      body.tracker_state ||
      "",
    existing_assignment_conversation_id:
      body.existing_assignment_conversation_id ||
      body.assignment_conversation_id ||
      body.tracker_conversation_id ||
      ""
  };
}

function normalizeReply(value) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyReply(value) {
  const normalized = normalizeReply(value);
  if (!normalized) return { classification: "manual_review", reason: "empty_reply" };

  if ([
    /\bno thanks\b/,
    /\bnot interested\b/,
    /\bdon'?t\b/,
    /\bstop\b/,
    /\bremove me\b/,
    /\bno\b/,
    /\bskip\b/,
    /\bga\b/,
    /\bengga\b/,
    /\btidak tertarik\b/,
    /\btidak mau\b/,
    /\bnggak\b/,
    /\bgak\b/,
    /\btidak\b/
  ].some((pattern) => pattern.test(normalized))) {
    return { classification: "negative", reason: "negative_keyword" };
  }

  const hasQuestion =
    normalized.includes("?") ||
    /^(what|how|where|when|why|who|can|could|do|does|is|are|will|would)\b/.test(normalized);
  const hasConfirmation = [
    /^(yes|ya|y|ok|oke|okay|sure|confirm|confirmed|ready|agree|deal)\b/,
    /\bsend (it|link|the link|me the link)\b/,
    /\bplease send\b/,
    /\bsounds good\b/,
    /\blet'?s go\b/,
    /\bi'?m in\b/,
    /\bi am in\b/,
    /\bmau+\b/,
    /\bsetuju\b/,
    /\bsiap\b/,
    /\bkirim\b/,
    /\bboleh\b/
  ].some((pattern) => pattern.test(normalized));
  const hasInterest = [
    /\binterested\b/,
    /\bdetails\b/,
    /\bmore info\b/,
    /\btell me more\b/,
    /\bi want\b/,
    /\bi'm interested\b/,
    /\bi am interested\b/,
    /\bminat\b/,
    /\btertarik\b/,
    /\binfo\b/,
    /\bgimana\b/,
    /\bgmn\b/,
    /\bbagaimana\b/,
    /\bjelasin\b/
  ].some((pattern) => pattern.test(normalized));

  if (hasConfirmation && !hasQuestion) return { classification: "confirmed", reason: "confirmation_keyword" };
  if (hasConfirmation && hasQuestion) return { classification: "manual_review", reason: "confirmation_with_question" };
  if (hasInterest) return { classification: "interested", reason: "interest_keyword" };
  if (hasQuestion) return { classification: "question", reason: "question_keyword" };
  return { classification: "manual_review", reason: "no_fixed_keyword_match" };
}

return $input.all().map((item) => {
  const inbound = inboundFrom(item.json);
  const existingState = text(inbound.existing_assignment_state);
  const existingConversationId = text(inbound.existing_assignment_conversation_id);
  const alreadyHandledSameConversation =
    ["assigned", "link_sent"].includes(existingState) &&
    existingConversationId &&
    existingConversationId === text(inbound.conversation_id);
  if (alreadyHandledSameConversation) {
    return {
      json: {
        ...inbound,
        classification: "manual_review",
        reason: "existing_assignment_already_sent_same_conversation",
        action: "no_send",
        outbound_message: ""
      }
    };
  }

  const classification = classifyReply(inbound.inbound_text);
  const action =
    classification.classification === "interested"
      ? "send_explanation_template"
      : classification.classification === "confirmed"
        ? "assign_drive_folder"
        : "no_send";

  return {
    json: {
      ...inbound,
      ...classification,
      action,
      outbound_message: action === "send_explanation_template" ? EXPLANATION_TEMPLATE : ""
    }
  };
});
