const TRACKER_HEADERS = [
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
];

const ACTIVE_STATES = new Set([
  "reserved",
  "assigned",
  "link_sent",
  "failed_link_send",
  "failed_rename",
  "failed_share",
  "manual_review"
]);

function text(value) {
  return value == null ? "" : String(value);
}

function sanitize(value, fallback = "affiliate") {
  const safe = text(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/^@+/, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/[^A-Za-z0-9._ -]+/g, " ")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .replace(/[._ -]+$/g, "")
    .slice(0, 120);
  return safe || fallback;
}

function folderLink(id) {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
}

function suffix(base, value) {
  const clean = sanitize(value, "");
  if (!clean) return base;
  const marker = `__${clean}`;
  return `${base.slice(0, Math.max(1, 120 - marker.length))}${marker}`;
}

function makeFolderName(affiliate, batchNumber, existingNames) {
  const existing = new Set(existingNames.map((name) => text(name).toLowerCase()));
  const username = sanitize(affiliate.username, "");
  const base = sanitize(username || affiliate.affiliate_name || affiliate.affiliate_id || "affiliate");
  const candidates = [base];
  const idSuffix = sanitize(affiliate.affiliate_id, "");
  if (idSuffix && idSuffix.toLowerCase() !== base.toLowerCase()) candidates.push(suffix(base, idSuffix));
  candidates.push(suffix(base, `batch${batchNumber}`));
  for (const candidate of candidates) {
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return suffix(base, `batch${batchNumber}_${Date.now()}`);
}

function rowValues(record) {
  return TRACKER_HEADERS.map((header) => text(record[header]));
}

function timeMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function existingScore(row, affiliate) {
  let score = 0;
  if (text(row.username) && text(row.username) === text(affiliate.username)) score += 8;
  if (text(row.conversation_id) && text(row.conversation_id) === text(affiliate.conversation_id)) score += 4;
  if (text(row.affiliate_id) && text(row.affiliate_id) === text(affiliate.affiliate_id)) score += 2;
  if (text(row.state) === "link_sent") score += 1;
  return score;
}

function sameConversation(row, affiliate) {
  return Boolean(text(row.conversation_id)) && text(row.conversation_id) === text(affiliate.conversation_id);
}

const affiliate = $items("Resolve Username From Conversations")[0].json;
const folders = $items("Search Clips Folders").flatMap((item) =>
  Array.isArray(item.json.files) ? item.json.files : []
);
const rows = $items("Read Tracker Rows").map((item, index) => ({
  ...item.json,
  _rowNumber: item.json.row_number || item.json.rowNumber || item.json.__rowNumber || index + 2
}));

const activeFolderIds = new Set(
  rows
    .filter((row) => ACTIVE_STATES.has(text(row.state)))
    .map((row) => text(row.drive_folder_id))
    .filter(Boolean)
);

const reusableStates = new Set(["reserved", "assigned", "link_sent", "failed_link_send"]);
const existingAssignment = rows
  .filter((row) => text(row.drive_folder_id) && reusableStates.has(text(row.state)))
  .map((row) => ({ row, score: existingScore(row, affiliate) }))
  .filter((item) => item.score >= 2)
  .sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const delta = timeMs(b.row.assigned_at) - timeMs(a.row.assigned_at);
    if (delta !== 0) return delta;
    return Number(b.row._rowNumber || 0) - Number(a.row._rowNumber || 0);
  })[0]?.row || null;

if (existingAssignment) {
  const existingState = text(existingAssignment.state);
  const alreadyHandledSameConversation =
    sameConversation(existingAssignment, affiliate) && ["assigned", "link_sent"].includes(existingState);
  const action = alreadyHandledSameConversation
    ? "no_send"
    : existingState === "reserved"
      ? "resume_reserved_assignment"
      : "send_existing_link";
  const record = {
    affiliate_id: text(existingAssignment.affiliate_id || affiliate.affiliate_id),
    affiliate_name: text(existingAssignment.affiliate_name || affiliate.affiliate_name),
    username: text(existingAssignment.username || affiliate.username),
    conversation_id: text(existingAssignment.conversation_id || affiliate.conversation_id),
    original_batch_number: text(existingAssignment.original_batch_number),
    drive_folder_id: text(existingAssignment.drive_folder_id),
    drive_folder_old_name: text(existingAssignment.drive_folder_old_name),
    drive_folder_new_name: text(existingAssignment.drive_folder_new_name),
    drive_link: text(existingAssignment.drive_link) || folderLink(existingAssignment.drive_folder_id),
    state: existingState,
    assigned_at: text(existingAssignment.assigned_at),
    link_sent_at: text(existingAssignment.link_sent_at),
    last_error: ""
  };
  return [{
    json: {
      ...record,
      action,
      no_send_reason: alreadyHandledSameConversation ? "existing_assignment_already_sent_same_conversation" : "",
      tracker_row_number: existingAssignment._rowNumber,
      row_values: rowValues(record),
      outbound_message: action === "send_existing_link" ? [
        "Halo Kak, terima kasih sudah bergabung sebagai Affiliate PROYA! 😊",
        "",
        "Berikut link video yang sudah kami siapkan:",
        "",
        record.drive_link,
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
      ].join("\n") : ""
    }
  }];
}

const available = folders
  .filter((folder) => folder.id && /^\d+$/.test(text(folder.name).trim()))
  .filter((folder) => !activeFolderIds.has(text(folder.id)))
  .map((folder) => ({
    ...folder,
    original_batch_number: Number.parseInt(text(folder.name).trim(), 10),
    drive_folder_old_name: text(folder.name).trim()
  }))
  .sort((a, b) => a.original_batch_number - b.original_batch_number);

const assignedAt = new Date().toISOString();

if (!sanitize(affiliate.username, "")) {
  return [
    {
      json: {
        affiliate_id: text(affiliate.affiliate_id),
        affiliate_name: text(affiliate.affiliate_name),
        username: text(affiliate.username),
        conversation_id: text(affiliate.conversation_id),
        original_batch_number: "",
        drive_folder_id: "",
        drive_folder_old_name: "",
        drive_folder_new_name: "",
        drive_link: "",
        state: "manual_review",
        assigned_at: assignedAt,
        link_sent_at: "",
        last_error: "missing_username",
        action: "append_manual_review"
      }
    }
  ];
}

if (available.length === 0) {
  return [
    {
      json: {
        affiliate_id: text(affiliate.affiliate_id),
        affiliate_name: text(affiliate.affiliate_name),
        username: text(affiliate.username),
        conversation_id: text(affiliate.conversation_id),
        original_batch_number: "",
        drive_folder_id: "",
        drive_folder_old_name: "",
        drive_folder_new_name: "",
        drive_link: "",
        state: "manual_review",
        assigned_at: assignedAt,
        link_sent_at: "",
        last_error: "no_numeric_folder_available",
        action: "append_manual_review"
      }
    }
  ];
}

const folder = available[0];
const newName = makeFolderName(affiliate, folder.original_batch_number, folders.map((item) => item.name));
const record = {
  affiliate_id: text(affiliate.affiliate_id),
  affiliate_name: text(affiliate.affiliate_name),
  username: text(affiliate.username),
  conversation_id: text(affiliate.conversation_id),
  original_batch_number: String(folder.original_batch_number),
  drive_folder_id: text(folder.id),
  drive_folder_old_name: text(folder.drive_folder_old_name),
  drive_folder_new_name: newName,
  drive_link: folderLink(folder.id),
  state: "reserved",
  assigned_at: assignedAt,
  link_sent_at: "",
  last_error: "",
  action: "append_reserved"
};

return [{ json: record }];
