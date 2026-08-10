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
const HISTORICAL_HEADERS = [
  "affiliate_id", "affiliate_name", "username", "conversation_id",
  "original_batch_number", "drive_folder_id", "drive_folder_old_name",
  "drive_folder_new_name", "drive_link", "state", "assigned_at",
  "link_sent_at", "last_error"
];

function text(value) {
  return value == null ? "" : String(value).trim();
}

function records(values, headers) {
  return (Array.isArray(values) ? values : []).slice(1).map((row, index) => {
    const record = { row_number: index + 2 };
    headers.forEach((name, column) => {
      record[name] = text(row[column]);
    });
    return record;
  });
}

const source = $("When Executed after Opt-in").first().json;
const leads = records(
  $("Read WhatsApp Leads for Reservation").first().json.values,
  LEAD_HEADERS
);
const historical = records(
  $("Read Historical Assignments").first().json.values,
  HISTORICAL_HEADERS
);
const folders = text($json.stdout)
  .split(/\r?\n/)
  .map(text)
  .filter((value) => /^\d+$/.test(value))
  .map(Number)
  .sort((a, b) => a - b);
const used = new Set([
  ...leads.map((row) => row.batch_number),
  ...historical.map((row) => row.original_batch_number)
].filter((value) => /^\d+$/.test(value)).map(Number));
const current = leads.find((row) => row.conversation_id === text(source.conversation_id));
if (!current) throw new Error("Opted-in lead no longer exists in WhatsApp Leads");

const normalizedUsername = text(current.username).normalize("NFKC").replace(/^@+/, "").toLowerCase();
const normalizedPhone = text(current.wa_id || current.whatsapp_number).replace(/\D/g, "");
const ownershipMatches = leads.filter((row) =>
  row.row_number !== current.row_number && (
    normalizedUsername && text(row.username).normalize("NFKC").replace(/^@+/, "").toLowerCase() === normalizedUsername ||
    normalizedPhone && text(row.wa_id || row.whatsapp_number).replace(/\D/g, "") === normalizedPhone
  ) && /^\d+$/.test(row.batch_number));
if (ownershipMatches.length) {
  return [{ json: { ...source, ...current, reservation_ok: false, queue_reason: "duplicate_affiliate_batch_ownership" } }];
}
const historicalOwnership = historical.filter((row) =>
  normalizedUsername &&
  text(row.username).normalize("NFKC").replace(/^@+/, "").toLowerCase() === normalizedUsername &&
  /^\d+$/.test(row.original_batch_number)
);
const existingBatch = /^\d+$/.test(current.batch_number)
  ? current.batch_number
  : "";
const migrationMatch = text(current.last_error).match(
  /^approved_historical_migration:(\d+):one_new_whatsapp_batch$/
);
const historicalMigrationApproved = Boolean(
  !existingBatch &&
  migrationMatch &&
  historicalOwnership.length === 1 &&
  historicalOwnership[0].original_batch_number === migrationMatch[1] &&
  text(historicalOwnership[0].state).toLowerCase() === "link_sent"
);
if (historicalOwnership.length && !existingBatch && !historicalMigrationApproved) {
  return [{ json: { ...source, ...current, reservation_ok: false, queue_reason: "historical_affiliate_already_assigned" } }];
}

const testMode = text($env.WHATSAPP_TEST_MODE).toLowerCase() === "true";
const testUsername = text($env.WHATSAPP_TEST_AFFILIATE_USERNAME).replace(/^@+/, "").toLowerCase();
const testRecipient = text($env.WHATSAPP_TEST_RECIPIENT_NUMBER).replace(/\D/g, "");
if (testMode && (normalizedUsername !== testUsername || normalizedPhone !== testRecipient)) {
  return [{ json: { ...source, ...current, reservation_ok: false, queue_reason: "test_identity_mismatch" } }];
}

const batch = testMode ? "TEST" : (existingBatch || String(folders.find((value) => !used.has(value)) || ""));
if (!batch) {
  return [{
    json: {
      ...source,
      ...current,
      reservation_ok: false,
      queue_reason: "no_available_local_batch"
    }
  }];
}

const now = new Date().toISOString();
const record = {
  ...current,
  state: "delivery_in_progress",
  batch_number: batch,
  batch_reserved_at: current.batch_reserved_at || now,
  delivery_started_at: current.delivery_started_at || now,
  files_expected: testMode ? "1" : "15",
  last_error: "",
  updated_at: now
};

return [{
  json: {
    ...source,
    ...record,
    row_number: current.row_number,
    row_values: LEAD_HEADERS.map((name) => text(record[name])),
    reservation_ok: true,
    reservation_attempt: Number(source.reservation_attempt || 1)
  }
}];
