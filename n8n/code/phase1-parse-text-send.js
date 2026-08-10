function text(value) { return value == null ? "" : String(value).trim(); }
const source = $("Guard Phase 1 Text Send").first().json;
const response = $json || {};
const returnedWamid = text(response.messages?.[0]?.id);
const errorCode = text(response.error?.code || response.error?.error_subcode);
const failed = Boolean(response.error) || !returnedWamid;
const sendState = returnedWamid ? "accepted" : errorCode ? "failed" : "outcome_uncertain";
const messageId = returnedWamid || `attempt:${source.outbound_source_reference}`;
return [{ json: {
  ...source,
  whatsapp_message_id: messageId,
  recipient_number: source.wa_id || source.whatsapp_number,
  message_type: "text",
  template_name: "",
  source_workflow: "AffWaReply2026",
  source_reference: source.outbound_source_reference,
  api_status: failed ? "failed" : text(response.messages?.[0]?.message_status || "accepted"),
  accepted_at: failed ? "" : new Date().toISOString(),
  registry_action: "register_send",
  returned_wamid: returnedWamid,
  send_succeeded: !failed && Boolean(returnedWamid),
  send_state: sendState,
  error_code: errorCode,
  last_error: failed ? text(response.error?.message || response.message || "whatsapp_text_send_failed") : "",
  message_payload_json: JSON.stringify({
    type: "text",
    source_reference: source.outbound_source_reference,
    error_code: errorCode,
    error_message: failed ? text(response.error?.message || response.message) : ""
  })
} }];
