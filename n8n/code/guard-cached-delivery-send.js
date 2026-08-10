function text(value) { return value == null ? "" : String(value).trim(); }
function digits(value) { return text(value).replace(/\D/g, ""); }
function username(value) { return text(value).normalize("NFKC").replace(/^@+/, "").toLowerCase(); }

const source = $input.first();
const recipient = digits(source.json.wa_id || source.json.whatsapp_number);
const zeroCharge = text($env.ZERO_CHARGE_MODE).toLowerCase() === "true";
const phaseEnabled = text($env.WHATSAPP_PHASE1_ENABLED).toLowerCase() === "true";
const testMode = text($env.WHATSAPP_TEST_MODE).toLowerCase() === "true";
const liveTestArmed = text($env.WHATSAPP_LIVE_TEST_ARMED).toLowerCase() === "true";
const testRecipient = digits($env.WHATSAPP_TEST_RECIPIENT_NUMBER);
const testAllowed = !testMode || (liveTestArmed && testRecipient === recipient && source.json.batch_number === "TEST");
const expires = Date.parse(source.json.window_expires_at || "");
const activeWindow = Boolean(source.json.last_inbound_at) && Number.isFinite(expires) && Date.now() < expires;
const assignmentMatches = recipient &&
  recipient === digits(source.json.whatsapp_number) &&
  text(source.json.batch_number) &&
  username(source.json.username) === username(source.json.tiktok_username || source.json.username);
const allowed = Boolean(zeroCharge && phaseEnabled && testAllowed && activeWindow && assignmentMatches);

return [{
  json: {
    ...source.json,
    outbound_allowed: allowed,
    blocked_log_code: allowed ? "" : "blocked_delivery_guard",
    blocked_reason: allowed ? "" : !activeWindow ? "no_active_customer_service_window"
      : !testAllowed ? "live_test_not_armed_or_recipient_mismatch"
      : !zeroCharge ? "zero_charge_mode_not_enabled"
      : !phaseEnabled ? "phase1_not_enabled"
      : "assignment_or_recipient_mismatch"
  },
  binary: source.binary
}];
