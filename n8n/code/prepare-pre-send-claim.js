const source = $("Guard Individual Clip Send").item.json;
const now = new Date().toISOString();
const claimToken = `pre_send_claim:${String($execution.id)}:${source.delivery_key}`;
const record = {
  delivery_key: source.delivery_key,
  conversation_id: source.conversation_id,
  whatsapp_number: source.whatsapp_number,
  batch_number: source.batch_number,
  file_index: source.file_index,
  file_name: source.file_name,
  media_id: source.media_id,
  whatsapp_message_id: "",
  state: "send_prepared",
  attempts: source.attempts || 1,
  uploaded_at: source.uploaded_at || now,
  sent_at: "",
  delivered_at: "",
  failed_at: "",
  last_error: claimToken,
  updated_at: now,
  send_state: "send_prepared",
  delivery_state: ""
};
const headers = ["delivery_key","conversation_id","whatsapp_number","batch_number","file_index","file_name","media_id","whatsapp_message_id","state","attempts","uploaded_at","sent_at","delivered_at","failed_at","last_error","updated_at","send_state","delivery_state"];
return [{ json: { ...source, pre_send_claim_token: claimToken, delivery_row_values: headers.map((name) => record[name] == null ? "" : String(record[name])) } }];
