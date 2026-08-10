function text(value) { return value == null ? "" : String(value).trim(); }
const items = $input.all();
if (!items.length) return [];
const source = items[0].json;
const values = Array.isArray(source.delivery_log_values) ? source.delivery_log_values : [];
const headers = (values[0] || []).map(text);
const existingRows = values.slice(1).map((row, index) => ({
  row_number: index + 2,
  ...Object.fromEntries(headers.map((name, column) => [name, text(row[column])]))
}));
let nextRow = values.length + 1;
const now = new Date().toISOString();
const claims = items.map((item) => {
  const current = existingRows.find((row) => row.delivery_key === text(item.json.delivery_key));
  const rowNumber = current?.row_number || nextRow++;
  const record = {
    ...current,
    delivery_key: item.json.delivery_key,
    conversation_id: item.json.conversation_id,
    whatsapp_number: item.json.whatsapp_number,
    batch_number: item.json.batch_number,
    file_index: item.json.file_index,
    file_name: item.json.file_name,
    media_id: item.json.existing_media_id || "",
    whatsapp_message_id: "",
    state: "send_prepared",
    attempts: item.json.attempts || 1,
    uploaded_at: item.json.existing_uploaded_at || "",
    sent_at: "",
    delivered_at: "",
    failed_at: "",
    last_error: `batch_pre_send_claim:${String($execution.id)}:${item.json.delivery_key}`,
    updated_at: now,
    send_state: "send_prepared",
    delivery_state: ""
  };
  return {
    delivery_key: item.json.delivery_key,
    row_number: rowNumber,
    update: {
      range: `Delivery Log!A${rowNumber}:R${rowNumber}`,
      majorDimension: "ROWS",
      values: [headers.map((name) => text(record[name]))]
    }
  };
});
return [{ json: { claims, updates: claims.map((claim) => claim.update), claim_count: claims.length } }];
