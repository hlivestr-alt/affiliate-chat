function text(value) { return value == null ? "" : String(value).trim(); }
function digits(value) { return text(value).replace(/\D/g, ""); }
const source = $("Restore Inbound after Lead Write").first().json;
const values = Array.isArray($json.values) ? $json.values : [];
const headers = (values[0] || []).map(text);
const rows = values.slice(1).map((row, index) => ({
  row_number: index + 2,
  ...Object.fromEntries(headers.map((name, column) => [name, text(row[column])]))
}));
const recipient = digits(source.wa_id || source.whatsapp_number);
const lead = rows.find((row) =>
  digits(row.wa_id || row.whatsapp_number) === recipient &&
  row.last_inbound_message_id === text(source.whatsapp_message_id)
);
const zeroCharge = text($env.ZERO_CHARGE_MODE || "true").toLowerCase() !== "false";
const type = "text";
const lastInbound = Date.parse(lead?.last_inbound_at || "");
const expires = Date.parse(lead?.window_expires_at || "");
const activeWindow = Number.isFinite(lastInbound) && Number.isFinite(expires) && Date.now() < expires;
const recipientMatches = Boolean(lead) && digits(lead.wa_id || lead.whatsapp_number) === recipient;
const phaseEnabled = text($env.WHATSAPP_PHASE1_ENABLED).toLowerCase() === "true";
const testMode = text($env.WHATSAPP_TEST_MODE).toLowerCase() === "true";
const armed = text($env.WHATSAPP_LIVE_TEST_ARMED).toLowerCase() === "true";
const testRecipient = digits($env.WHATSAPP_TEST_RECIPIENT_NUMBER);
const testUsername = text($env.WHATSAPP_TEST_AFFILIATE_USERNAME).replace(/^@+/, "").toLowerCase();
const sourceUsername = text(source.username).replace(/^@+/, "").toLowerCase();
const testAllowed = !testMode || (
  armed && testRecipient && testRecipient === recipient &&
  testUsername && sourceUsername === testUsername
);
const allowed = zeroCharge && activeWindow && recipientMatches && type !== "template" && phaseEnabled && testAllowed;
const reason = allowed ? "" :
  !zeroCharge ? "zero_charge_mode_disabled_fail_closed" :
  !phaseEnabled ? "phase1_not_enabled" :
  !testAllowed ? "live_test_not_armed_or_recipient_mismatch" :
  !recipientMatches ? "recipient_or_inbound_mismatch" :
  !activeWindow ? "no_active_customer_service_window" :
  "blocked_by_zero_charge_mode";
const body = source.action === "clarification"
  ? "Halo Kak! Terima kasih sudah menghubungi PROYA 😊 Untuk menerima video affiliate, kirim username TikTok dengan format: MINAT @username"
  : [
      "Halo kak",
      "Terima kasih sudah tertarik bergabung sebagai Affiliate PROYA. Kami ingin mengirimkan materi video yang dapat Kakak upload ke TikTok untuk mempromosikan produk PROYA dan mendapatkan komisi.",
      "",
      "Sebelum menerima video, mohon perhatikan ketentuan berikut:",
      "✅ Upload video ke akun TikTok Kakak dan tambahkan keranjang kuning produk PROYA.",
      "✅ Cantumkan @proya_official di bio TikTok sebagai tanda bahwa Kakak bekerja sama dengan PROYA.",
      "✅ Video boleh diedit ringan, seperti menambahkan caption, subtitle, musik, atau potongan singkat. Namun, isi dan konteks utama video tidak boleh diubah.",
      "✅ Jangan menambahkan klaim berlebihan atau klaim medis, seperti “pasti putih”, “hasil instan”, atau “menghilangkan jerawat permanen”. Gunakan kalimat yang lebih aman, misalnya “membantu merawat kulit” atau “membantu mencerahkan kulit”.",
      "✅ Hindari mengunggah terlalu banyak video serupa dalam waktu berdekatan untuk mengurangi risiko pelanggaran konten tidak orisinal.",
      "",
      "Jika mendapat pelanggaran “Konten Tidak Orisinal”, Kakak dapat mengajukan banding dan menggunakan screenshot percakapan ini sebagai bukti bahwa PROYA telah memberikan izin penggunaan video."
    ].join("\n");
return [{ json: {
  ...source,
  ...lead,
  outbound_allowed: allowed,
  blocked_reason: reason,
  blocked_log_code: allowed ? "" : "blocked_by_zero_charge_mode",
  outbound_type: type,
  outbound_body: body,
  outbound_source_reference: source.action === "clarification"
    ? `clarification:${recipient}`
    : `confirmation:${source.whatsapp_message_id}`
} }];
