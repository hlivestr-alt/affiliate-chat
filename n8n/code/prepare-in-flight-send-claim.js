const source = $input.first();
const headers = ["delivery_key","conversation_id","whatsapp_number","batch_number","file_index","file_name","media_id","whatsapp_message_id","state","attempts","uploaded_at","sent_at","delivered_at","failed_at","last_error","updated_at","send_state","delivery_state"];
const text = (value) => value == null ? "" : String(value).trim();
if (!source.json.delivery_key || !source.json.delivery_log_row_number) throw new Error("in_flight_claim_identity_missing");
const now = new Date().toISOString();
const record = {
  delivery_key: source.json.delivery_key,
  conversation_id: source.json.conversation_id,
  whatsapp_number: source.json.whatsapp_number,
  batch_number: source.json.batch_number,
  file_index: source.json.file_index,
  file_name: source.json.file_name,
  media_id: source.json.media_id,
  whatsapp_message_id: "",
  state: "outcome_uncertain",
  attempts: source.json.attempts || 1,
  uploaded_at: source.json.uploaded_at,
  sent_at: "",
  delivered_at: "",
  failed_at: "",
  last_error: `meta_send_in_flight:${String($execution.id || "")}:${source.json.delivery_key}`,
  updated_at: now,
  send_state: "outcome_uncertain",
  delivery_state: ""
};
return [{ json: { ...source.json, in_flight_claimed_at: now, in_flight_row_values: headers.map((name) => text(record[name])) }, binary: source.binary }];
