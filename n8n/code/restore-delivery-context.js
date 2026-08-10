const LEAD_HEADERS = [
  "username", "whatsapp_number", "conversation_id", "captured_at",
  "reply_1", "reply_2", "reply_3", "state", "opt_in_message_id",
  "opt_in_sent_at", "opted_in_at", "declined_at", "batch_number",
  "batch_reserved_at", "delivery_started_at", "files_expected",
  "files_sent", "files_delivered", "files_failed", "files_sent_at",
  "files_delivered_at", "posted_confirmed_at", "last_whatsapp_message_id",
  "last_inbound_at", "last_intent", "last_intent_confidence",
  "last_error", "updated_at", "wa_id", "last_inbound_message_id",
  "window_expires_at"
];

function text(value) { return value == null ? "" : String(value).trim(); }
function digits(value) { return text(value).replace(/\D/g, ""); }
function username(value) { return text(value).normalize("NFKC").replace(/^@+/, "").toLowerCase(); }
function records(values) {
  return (Array.isArray(values) ? values : []).slice(1).map((row, index) => {
    const record = { row_number: index + 2 };
    LEAD_HEADERS.forEach((name, column) => { record[name] = text(row[column]); });
    return record;
  });
}

const source = $("Confirm Reservation Winner").first().json;
const deliveryResponse = $("Read Delivery Log for Resume").first().json;
const messageResponse = $("Read Message Log for Resume").first().json;
const leadResponse = $("Reread Leads after Reservation").first().json;
const testMode = text($env.WHATSAPP_TEST_MODE).toLowerCase() === "true";
const batch = text(source.batch_number);
if (!batch) throw new Error("delivery_context_missing_batch_number");
if (testMode ? batch !== "TEST" : !/^\d+$/.test(batch)) {
  throw new Error(testMode ? "delivery_context_invalid_test_batch" : "delivery_context_nonnumeric_production_batch");
}
if (batch.includes("..") || batch.includes("/") || batch.includes("\\")) {
  throw new Error("delivery_context_unsafe_batch_path");
}
if (source.reservation_won !== true) throw new Error("delivery_context_reservation_not_won");

const sourceRecipient = digits(source.wa_id || source.whatsapp_number);
const sourceUsername = username(source.username || source.tiktok_username);
const leads = records(leadResponse.values);
const matches = leads.filter((row) => row.conversation_id === text(source.conversation_id));
if (matches.length !== 1) throw new Error(matches.length ? "delivery_context_duplicate_conversation" : "delivery_context_lead_missing");
const lead = matches[0];
if (text(lead.batch_number) !== batch) throw new Error("delivery_context_batch_assignment_mismatch");
if (!sourceRecipient || digits(lead.wa_id || lead.whatsapp_number) !== sourceRecipient) throw new Error("delivery_context_recipient_mismatch");
if (!sourceUsername || username(lead.username) !== sourceUsername) throw new Error("delivery_context_username_mismatch");
if (!testMode && text(lead.files_expected) !== "15") throw new Error("delivery_context_expected_clip_count_mismatch");
if (testMode && text(lead.files_expected) !== "1") throw new Error("delivery_context_test_clip_count_mismatch");

const expectedClipCount = testMode ? 1 : 15;
return [{ json: {
  ...source,
  ...lead,
  batch_number: batch,
  assignment_id: text(source.assignment_id) || `${text(source.conversation_id)}:${batch}`,
  whatsapp_number: digits(lead.whatsapp_number || lead.wa_id),
  wa_id: digits(lead.wa_id || lead.whatsapp_number),
  tiktok_username: lead.username,
  delivery_state: lead.state,
  files_expected: String(expectedClipCount),
  expected_clip_count: expectedClipCount,
  test_mode: testMode,
  resolved_folder_path: testMode ? text($env.WHATSAPP_TEST_CLIP_PATH || "/clips_whatsapp_test/test-clip.mp4") : `/clips_whatsapp/${batch}`,
  delivery_log_values: Array.isArray(deliveryResponse.values) ? deliveryResponse.values : [],
  message_log_values: Array.isArray(messageResponse.values) ? messageResponse.values : [],
  lead_headers: LEAD_HEADERS,
  delivery_context_valid: true
} }];
