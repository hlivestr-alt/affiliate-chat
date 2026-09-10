const source = $("Validate Immediate Successful Send").item.json;
const text = (value) => value == null ? "" : String(value).trim();
const digits = (value) => text(value).replace(/\D/g, "");
const normalizeDeliveryRow = (values) => {
  if (!Array.isArray(values) || values.length === 0 || values.length > 18) throw new Error(`successful_clip_persistence_not_verified:${source.delivery_key}`);
  const row = values.map(text);
  while (row.length < 18) row.push("");
  return row;
};
const row = normalizeDeliveryRow($json.values?.[0]);
const expectedPhone = digits(source.whatsapp_number || source.wa_id || source.recipient_number);
const identityMatches = row[0] === text(source.delivery_key) && row[1] === text(source.conversation_id) && (!expectedPhone || digits(row[2]) === expectedPhone) && row[3] === text(source.batch_number) && Number(row[4]) === Number(source.file_index) && row[5] === text(source.file_name);
const valid = identityMatches && row[7] === text(source.whatsapp_message_id) && ["accepted","sent","delivered","read"].includes(text(row[16] || row[8]).toLowerCase()) && Number(row[9] || 0) === Number(source.attempts || 0);
if (!valid) throw new Error(`successful_clip_persistence_not_verified:${source.delivery_key}`);
return [{ json: { ...source, immediate_persistence_verified: true, immediate_persistence_result: "written_and_verified" } }];
