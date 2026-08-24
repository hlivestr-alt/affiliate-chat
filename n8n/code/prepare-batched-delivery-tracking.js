const DELIVERY_HEADERS = ["delivery_key","conversation_id","whatsapp_number","batch_number","file_index","file_name","media_id","whatsapp_message_id","state","attempts","uploaded_at","sent_at","delivered_at","failed_at","last_error","updated_at","send_state","delivery_state"];
const MESSAGE_HEADERS = ["whatsapp_message_id","recipient_number","message_type","template_name","source_workflow","source_reference","api_status","accepted_at","current_status","status_timestamp","conversation_json","pricing_json","errors_json","error_code","error_title","error_message","error_details","processed_statuses","status_history_json","updated_at","direction","message_payload_json","send_state","delivery_state"];
const text = (value) => value == null ? "" : String(value).trim();
const results = $input.all().map((item) => item.json).filter((item) => item.delivery_key && item.delivery_log_row_number && Array.isArray(item.delivery_row_values));
if (!results.length) throw new Error("batch_tracking_results_missing");
const now = new Date().toISOString();
const deliveryUpdates = results.map((result) => ({
  range: `Delivery Log!A${result.delivery_log_row_number}:R${result.delivery_log_row_number}`,
  majorDimension: "ROWS",
  values: [DELIVERY_HEADERS.map((_, index) => text(result.delivery_row_values[index]))]
}));
const successfulMessageResults = [];
const successfulByKey = new Map();
for (const result of results.filter((item) => item.send_success && item.whatsapp_message_id && item.message_log_append_required !== false)) {
  const prior = successfulByKey.get(result.delivery_key);
  if (prior && prior.whatsapp_message_id !== result.whatsapp_message_id) throw new Error(`successful_message_id_conflict:${result.delivery_key}`);
  if (!prior) {
    successfulByKey.set(result.delivery_key, result);
    successfulMessageResults.push(result);
  }
}
const messageRows = successfulMessageResults.map((result) => {
  const record = {
    whatsapp_message_id: result.whatsapp_message_id,
    recipient_number: result.whatsapp_number,
    message_type: "video",
    template_name: "",
    source_workflow: "AffWaDelivery2026",
    source_reference: result.delivery_key,
    api_status: result.api_status || "accepted",
    accepted_at: result.sent_at || now,
    current_status: result.api_status || "accepted",
    status_timestamp: "",
    conversation_json: "{}",
    pricing_json: "{}",
    errors_json: "[]",
    error_code: result.error_code || "",
    error_title: "",
    error_message: result.last_error || "",
    error_details: "",
    processed_statuses: "[]",
    status_history_json: "[]",
    updated_at: now,
    direction: "outbound",
    message_payload_json: JSON.stringify({ type: "video", source_reference: result.delivery_key, batch_number: result.batch_number, file_index: result.file_index, file_name: result.file_name }),
    send_state: result.send_state || "accepted",
    delivery_state: result.delivery_state || ""
  };
  return MESSAGE_HEADERS.map((name) => text(record[name]));
});
return [{ json: { results, delivery_updates: deliveryUpdates, message_rows: messageRows, message_count: messageRows.length } }];
