"use strict";

const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

const TRACKER_HEADERS = Object.freeze([
  "affiliate_id",
  "affiliate_name",
  "username",
  "conversation_id",
  "original_batch_number",
  "drive_folder_id",
  "drive_folder_old_name",
  "drive_folder_new_name",
  "drive_link",
  "state",
  "assigned_at",
  "link_sent_at",
  "last_error"
]);

const ACTIVE_ASSIGNMENT_STATES = new Set([
  "reserved",
  "assigned",
  "link_sent",
  "failed_link_send",
  "failed_rename",
  "failed_share",
  "manual_review"
]);

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

const DEFAULT_MESSAGE_LOOKBACK_HOURS = 24;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_IGNORED_SENDER_IM_USER_IDS = Object.freeze([
  "7857891324986241124"
]);

function coerceString(value) {
  return value == null ? "" : String(value);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeReplyText(text) {
  return coerceString(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyReply(text) {
  const normalized = normalizeReplyText(text);

  if (!normalized) {
    return {
      classification: "manual_review",
      reason: "empty_reply"
    };
  }

  const negativePatterns = [
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
  ];

  if (negativePatterns.some((pattern) => pattern.test(normalized))) {
    return {
      classification: "negative",
      reason: "negative_keyword"
    };
  }

  const hasQuestion =
    normalized.includes("?") ||
    /^(what|how|where|when|why|who|can|could|do|does|is|are|will|would)\b/.test(normalized);

  const confirmationPatterns = [
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
  ];

  const interestedPatterns = [
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
  ];

  const hasConfirmation = confirmationPatterns.some((pattern) => pattern.test(normalized));
  const hasInterest = interestedPatterns.some((pattern) => pattern.test(normalized));

  if (hasConfirmation && !hasQuestion) {
    return {
      classification: "confirmed",
      reason: "confirmation_keyword"
    };
  }

  if (hasConfirmation && hasQuestion) {
    return {
      classification: "manual_review",
      reason: "confirmation_with_question"
    };
  }

  if (hasInterest) {
    return {
      classification: "interested",
      reason: "interest_keyword"
    };
  }

  if (hasQuestion) {
    return {
      classification: "question",
      reason: "question_keyword"
    };
  }

  return {
    classification: "manual_review",
    reason: "no_fixed_keyword_match"
  };
}

function sanitizeDriveFolderName(input, fallback = "affiliate") {
  const stripped = coerceString(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/^@+/, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/[^A-Za-z0-9._ -]+/g, " ")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .replace(/[._ -]+$/g, "");

  const safe = stripped.slice(0, 120);
  return safe || fallback;
}

function normalizeUsername(username) {
  return sanitizeDriveFolderName(coerceString(username).replace(/^@+/, ""), "");
}

function appendFolderSuffix(base, suffix) {
  const cleanSuffix = sanitizeDriveFolderName(suffix, "");
  if (!cleanSuffix) {
    return base;
  }
  const marker = `__${cleanSuffix}`;
  const maxBaseLength = Math.max(1, 120 - marker.length);
  return `${base.slice(0, maxBaseLength)}${marker}`;
}

function makeAffiliateFolderName({
  affiliateName,
  username,
  tiktokId,
  affiliateId,
  batchNumber,
  existingNames = []
} = {}) {
  const existing = new Set(existingNames.map((name) => coerceString(name).toLowerCase()));
  const usernameBase = normalizeUsername(username);
  const base = sanitizeDriveFolderName(
    usernameBase || affiliateName || tiktokId || affiliateId || "affiliate"
  );

  const candidates = [base];
  const idToken = normalizeUsername(tiktokId || affiliateId);
  if (idToken && idToken.toLowerCase() !== base.toLowerCase()) {
    candidates.push(appendFolderSuffix(base, idToken));
  }
  if (batchNumber != null && batchNumber !== "") {
    candidates.push(appendFolderSuffix(base, `batch${batchNumber}`));
  }

  for (const candidate of candidates) {
    if (!existing.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  let counter = 2;
  while (counter < 1000) {
    const candidate = appendFolderSuffix(base, `batch${batchNumber || "x"}_${counter}`);
    if (!existing.has(candidate.toLowerCase())) {
      return candidate;
    }
    counter += 1;
  }

  throw new Error("Could not create a unique affiliate folder name");
}

function isNumericFolderName(name) {
  return /^\d+$/.test(coerceString(name).trim());
}

function isDriveFolder(folder) {
  return !folder.mimeType || folder.mimeType === DRIVE_FOLDER_MIME_TYPE;
}

function selectNextNumericFolder(folders, assignedFolderIds = new Set(), strategy = "lowest") {
  const assigned = assignedFolderIds instanceof Set ? assignedFolderIds : new Set(assignedFolderIds);
  const matches = folders
    .filter((folder) => folder && folder.id && isDriveFolder(folder))
    .filter((folder) => isNumericFolderName(folder.name))
    .filter((folder) => !assigned.has(folder.id))
    .map((folder) => ({
      ...folder,
      originalBatchNumber: Number.parseInt(coerceString(folder.name).trim(), 10),
      driveFolderOldName: coerceString(folder.name).trim()
    }))
    .sort((a, b) => {
      const direction = strategy === "highest" ? -1 : 1;
      if (a.originalBatchNumber !== b.originalBatchNumber) {
        return direction * (a.originalBatchNumber - b.originalBatchNumber);
      }
      return coerceString(a.id).localeCompare(coerceString(b.id));
    });

  return matches[0] || null;
}

function buildDriveFolderLink(folderId) {
  if (!folderId) {
    return "";
  }
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

function buildDriveLinkMessage(driveLink) {
  return [
    "Halo Kak, terima kasih sudah bergabung sebagai Affiliate PROYA! 😊",
    "",
    "Berikut link video yang sudah kami siapkan:",
    "",
    driveLink,
    "",
    "Jika link tidak bisa langsung dibuka dari TikTok Affiliate Center, silakan tekan dan tahan link, lalu salin dan tempel ke browser seperti Google Chrome atau Safari.",
    "",
    "Langkah Upload",
    "",
    "1. Download video dari link di atas.",
    "2. Upload ke akun TikTok Kakak.",
    "3. Tambahkan keranjang kuning produk PROYA.",
    "",
    "Kalau ada pertanyaan atau butuh bantuan, silakan hubungi kami melalui WhatsApp:",
    "0882-1097-7575",
    "",
    "Hal yang Perlu Diperhatikan",
    "",
    "✅ Mohon cantumkan @proya_official di bio akun TikTok agar terlihat bahwa Kakak bekerja sama dengan PROYA, sekaligus membantu mengurangi risiko konten dianggap tidak orisinal.",
    "",
    "✅ Video boleh diedit ringan, seperti menambahkan caption, subtitle, musik, atau potongan singkat. Namun mohon jangan mengubah isi atau konteks utama video, serta jangan menambahkan klaim yang tidak sesuai.",
    "",
    "✅ Untuk caption, mohon hindari klaim yang berlebihan seperti:",
    "",
    "* “Pasti putih”",
    "* “Menghilangkan jerawat permanen”",
    "* “Hasil instan”",
    "* Klaim medis lainnya",
    "",
    "Gunakan kalimat yang lebih aman seperti:",
    "",
    "* “Membantu merawat kulit”",
    "* “Membantu mencerahkan kulit”",
    "* “Cocok untuk perawatan harian”",
    "",
    "✅ Sebaiknya jangan mengunggah terlalu banyak video yang mirip dalam waktu berdekatan agar mengurangi risiko pembatasan atau pelanggaran konten tidak orisinal.",
    "",
    "Jika Mendapat Pelanggaran “Konten Tidak Orisinal”",
    "",
    "Silakan ajukan banding (Appeal) melalui TikTok dan sertakan screenshot percakapan kerja sama ini sebagai bukti bahwa Kakak telah mendapatkan izin dari PROYA untuk menggunakan materi video yang kami sediakan.",
    "",
    "Terima kasih sudah bekerja sama dengan PROYA! 😊",
    "",
    "Semoga video Kakak mendapatkan hasil yang bagus dan menghasilkan banyak komisi. Kami juga akan terus mengirimkan materi video terbaru untuk membantu meningkatkan penjualan Kakak."
  ].join("\n");
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
  return coerceString(
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
      if (object[key] != null && object[key] !== "") {
        return object[key];
      }
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
  const normalized = coerceString(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return undefined;
}

function parseTimestampMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) < 1e12 ? value * 1000 : value;
  }
  const trimmed = coerceString(value).trim();
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
      const parsed = parseBooleanLike(object[key]);
      if (parsed === true) return true;
    }
  }

  for (const object of objects) {
    if (!object || typeof object !== "object") continue;
    for (const key of ["read", "is_read", "seen", "is_seen"]) {
      const parsed = parseBooleanLike(object[key]);
      if (parsed === false) return true;
    }
  }

  for (const object of objects) {
    if (!object || typeof object !== "object") continue;
    for (const key of ["read_status", "status", "message_status"]) {
      const normalized = coerceString(object[key]).trim().toLowerCase();
      if (["unread", "not_read", "new", "unseen"].includes(normalized)) return true;
    }
  }

  const unreadCount = Number(getByKeys(objects, ["unread_count", "unreadCount"]));
  return Number.isFinite(unreadCount) && unreadCount > 0;
}

function isTimestampWithinLastHours(timestampMs, hours = DEFAULT_MESSAGE_LOOKBACK_HOURS, nowMs = Date.now()) {
  if (!Number.isFinite(timestampMs)) return false;
  const earliest = nowMs - hours * 60 * 60 * 1000;
  return timestampMs >= earliest && timestampMs <= nowMs + FUTURE_CLOCK_SKEW_MS;
}

function shouldProcessInboundMessage(input, {
  nowMs = Date.now(),
  lookbackHours = DEFAULT_MESSAGE_LOOKBACK_HOURS,
  ignoredSenderImUserIds = DEFAULT_IGNORED_SENDER_IM_USER_IDS
} = {}) {
  const { body } = messageParts(input);
  if (body.type != null && Number(body.type) !== 33) {
    return {
      shouldProcess: false,
      unread: false,
      timestampMs: Number.NaN,
      hasTimestamp: false,
      hasUnreadSignal: false,
      withinLookback: false,
      reason: "unsupported_notification_type"
    };
  }

  const ignoredSenders = new Set(ignoredSenderImUserIds.map(coerceString));
  if (ignoredSenders.has(senderImUserId(input))) {
    return {
      shouldProcess: false,
      unread: false,
      timestampMs: Number.NaN,
      hasTimestamp: false,
      hasUnreadSignal: false,
      withinLookback: false,
      reason: "ignored_sender"
    };
  }

  const parsedTimestampMs = inboundMessageTimestampMs(input);
  const hasTimestamp = Number.isFinite(parsedTimestampMs);
  const timestampMs = hasTimestamp ? parsedTimestampMs : nowMs;
  const hasUnreadSignal = hasExplicitUnreadSignal(input);
  const unread = hasUnreadSignal ? isUnreadMessage(input) : true;
  const withinLookback = isTimestampWithinLastHours(timestampMs, lookbackHours, nowMs);

  return {
    shouldProcess: unread && withinLookback,
    unread,
    timestampMs,
    hasTimestamp,
    hasUnreadSignal,
    withinLookback,
    reason: !unread ? "message_not_unread" : !withinLookback ? "message_outside_24h" : ""
  };
}

function usernameFromConversationList(response, {
  conversationId,
  senderId,
  existingUsername = ""
} = {}) {
  if (coerceString(existingUsername)) {
    return {
      username: coerceString(existingUsername),
      creatorImId: "",
      matched: false
    };
  }

  const conversations = Array.isArray(response && response.data && response.data.conversations)
    ? response.data.conversations
    : [];
  const conversationIdText = coerceString(conversationId);
  const senderIdText = coerceString(senderId);
  const match =
    conversations.find((conversation) => coerceString(conversation.id || conversation.conversation_id) === conversationIdText) ||
    conversations.find((conversation) => coerceString(conversation.creator_im_id) === senderIdText) ||
    null;

  return {
    username: coerceString(match && match.username),
    creatorImId: coerceString(match && match.creator_im_id),
    matched: Boolean(match)
  };
}

function createAssignmentRecord({
  affiliateId,
  affiliateName,
  username,
  conversationId,
  folder,
  newFolderName,
  state = "reserved",
  assignedAt = nowIso(),
  lastError = ""
}) {
  const originalBatchNumber =
    folder && folder.originalBatchNumber != null
      ? folder.originalBatchNumber
      : Number.parseInt(coerceString(folder && folder.name).trim(), 10);

  return {
    affiliate_id: coerceString(affiliateId),
    affiliate_name: coerceString(affiliateName),
    username: coerceString(username),
    conversation_id: coerceString(conversationId),
    original_batch_number: Number.isFinite(originalBatchNumber) ? String(originalBatchNumber) : "",
    drive_folder_id: coerceString(folder && folder.id),
    drive_folder_old_name: coerceString((folder && (folder.driveFolderOldName || folder.name)) || ""),
    drive_folder_new_name: coerceString(newFolderName),
    drive_link: buildDriveFolderLink(folder && folder.id),
    state,
    assigned_at: assignedAt,
    link_sent_at: "",
    last_error: coerceString(lastError)
  };
}

function createManualReviewRecord({
  affiliateId,
  affiliateName,
  username,
  conversationId,
  state = "manual_review",
  lastError = "",
  assignedAt = nowIso()
}) {
  return {
    affiliate_id: coerceString(affiliateId),
    affiliate_name: coerceString(affiliateName),
    username: coerceString(username),
    conversation_id: coerceString(conversationId),
    original_batch_number: "",
    drive_folder_id: "",
    drive_folder_old_name: "",
    drive_folder_new_name: "",
    drive_link: "",
    state,
    assigned_at: assignedAt,
    link_sent_at: "",
    last_error: coerceString(lastError)
  };
}

function recordToSheetRow(record) {
  return TRACKER_HEADERS.map((header) => coerceString(record[header]));
}

function sheetRowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const [firstRow, ...dataRows] = rows;
  const firstRowLooksLikeHeader = TRACKER_HEADERS.every((header, index) => firstRow[index] === header);
  const headers = firstRowLooksLikeHeader ? firstRow : TRACKER_HEADERS;
  const offset = firstRowLooksLikeHeader ? 2 : 1;
  const bodyRows = firstRowLooksLikeHeader ? dataRows : rows;

  return bodyRows
    .filter((row) => Array.isArray(row) && row.some((value) => coerceString(value).trim() !== ""))
    .map((row, index) => {
      const object = {};
      headers.forEach((header, columnIndex) => {
        object[header] = coerceString(row[columnIndex]);
      });
      object._rowNumber = index + offset;
      return object;
    });
}

function assignedFolderIdsFromRows(rows) {
  const ids = new Set();
  for (const row of rows) {
    const state = coerceString(row.state).trim();
    const folderId = coerceString(row.drive_folder_id).trim();
    if (folderId && ACTIVE_ASSIGNMENT_STATES.has(state)) {
      ids.add(folderId);
    }
  }
  return ids;
}

function parseDateMs(value) {
  const ms = Date.parse(coerceString(value));
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

function compareReservationRows(a, b) {
  const aDate = parseDateMs(a.assigned_at);
  const bDate = parseDateMs(b.assigned_at);
  if (aDate !== bDate) {
    return aDate - bDate;
  }

  const aRow = Number.parseInt(coerceString(a._rowNumber || a.rowNumber), 10);
  const bRow = Number.parseInt(coerceString(b._rowNumber || b.rowNumber), 10);
  if (Number.isFinite(aRow) && Number.isFinite(bRow) && aRow !== bRow) {
    return aRow - bRow;
  }

  return coerceString(a.conversation_id).localeCompare(coerceString(b.conversation_id));
}

function findReservationWinner(rows, folderId) {
  const matches = rows
    .filter((row) => coerceString(row.drive_folder_id) === coerceString(folderId))
    .filter((row) => ACTIVE_ASSIGNMENT_STATES.has(coerceString(row.state)))
    .sort(compareReservationRows);

  return matches[0] || null;
}

function reservationWins(rows, currentRecord) {
  const winner = findReservationWinner(rows, currentRecord.drive_folder_id);
  if (!winner) {
    return false;
  }

  if (currentRecord._rowNumber || currentRecord.rowNumber) {
    return (
      Number.parseInt(coerceString(winner._rowNumber), 10) ===
      Number.parseInt(coerceString(currentRecord._rowNumber || currentRecord.rowNumber), 10)
    );
  }

  return (
    coerceString(winner.conversation_id) === coerceString(currentRecord.conversation_id) &&
    coerceString(winner.assigned_at) === coerceString(currentRecord.assigned_at)
  );
}

function updateRecordState(record, state, { linkSentAt = "", lastError = "" } = {}) {
  return {
    ...record,
    state,
    link_sent_at: linkSentAt || record.link_sent_at || "",
    last_error: coerceString(lastError)
  };
}

module.exports = {
  ACTIVE_ASSIGNMENT_STATES,
  DEFAULT_MESSAGE_LOOKBACK_HOURS,
  DEFAULT_IGNORED_SENDER_IM_USER_IDS,
  DRIVE_FOLDER_MIME_TYPE,
  EXPLANATION_TEMPLATE,
  TRACKER_HEADERS,
  assignedFolderIdsFromRows,
  buildDriveFolderLink,
  buildDriveLinkMessage,
  classifyReply,
  compareReservationRows,
  createAssignmentRecord,
  createManualReviewRecord,
  findReservationWinner,
  hasExplicitUnreadSignal,
  inboundMessageTimestampMs,
  isTimestampWithinLastHours,
  isUnreadMessage,
  isNumericFolderName,
  makeAffiliateFolderName,
  nowIso,
  parseTimestampMs,
  recordToSheetRow,
  reservationWins,
  sanitizeDriveFolderName,
  selectNextNumericFolder,
  senderImUserId,
  sheetRowsToObjects,
  shouldProcessInboundMessage,
  usernameFromConversationList,
  updateRecordState
};
