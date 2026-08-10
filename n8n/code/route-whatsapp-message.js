function text(value) {
  return value == null ? "" : String(value);
}

function normalized(value) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^[*"'“”]+/, "")
    .replace(/[*"'“”]+$/, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const yes = new Set([
  "yes", "ya", "iya", "setuju", "ya saya setuju", "ya, saya setuju",
  "ya kirim video", "ya, kirim video",
  "yes send clips", "yes, send clips"
]);
const no = new Set([
  "no", "tidak", "nggak", "gak", "stop", "berhenti",
  "tidak terima kasih", "no thanks"
]);
const input = $input.first().json;
const payload = text(input.reply_payload).toUpperCase();
const message = normalized(input.message_text);
const posted = [
  /\bsudah (aku |saya )?(upload|post|posting)\b/,
  /\b(udah|sudah) tayang\b/,
  /\bposted\b/,
  /\bi (have )?posted\b/
].some((pattern) => pattern.test(message));

let action = "classify";
if (payload === "YES_SEND_CLIPS" || yes.has(message)) action = "opted_in";
else if (payload === "NO_THANKS" || no.has(message)) action = "declined";
else if (posted) action = "posted_confirmed";

return [{
  json: {
    ...input,
    action,
    inbound_at: input.whatsapp_timestamp
      ? new Date(Number(input.whatsapp_timestamp) * 1000).toISOString()
      : new Date().toISOString()
  }
}];
