const source = $("Parse Video Send").item.json;
const text = (value) => value == null ? "" : String(value).trim();
const digits = (value) => text(value).replace(/\D/g, "");
const validMessageId = (value) => /^wamid\.[A-Za-z0-9_+=\/-]{12,}$/.test(text(value));
const normalizeDeliveryRow = (values) => {
  if (!Array.isArray(values) || values.length === 0 || values.length > 18) throw new Error("immediate_success_persistence_row_missing");
  const row = values.map(text);
  while (row.length < 18) row.push("");
  return row;
};
const records = (values) => {
  const rows = Array.isArray(values) ? values : [];
  const headers = (rows[0] || []).map(text);
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((name, index) => [name, text(values[index])])));
};
if (source.send_success !== true || !validMessageId(source.whatsapp_message_id)) throw new Error("immediate_success_persistence_requires_valid_message_id");
const row = normalizeDeliveryRow($json.values?.[0]);
const expectedPhone = digits(source.whatsapp_number || source.wa_id || source.recipient_number);
const identityMatches = row[0] === text(source.delivery_key) && row[1] === text(source.conversation_id) && (!expectedPhone || digits(row[2]) === expectedPhone) && row[3] === text(source.batch_number) && Number(row[4]) === Number(source.file_index) && row[5] === text(source.file_name);
if (!identityMatches) throw new Error("immediate_success_persistence_identity_conflict");
if (Number(row[9] || 0) !== Number(source.attempts || 0)) throw new Error("immediate_success_persistence_attempt_conflict");
const existingMessageId = row[7];
if (existingMessageId && existingMessageId !== text(source.whatsapp_message_id)) {
  throw new Error(`successful_message_id_conflict:${source.delivery_key}`);
}
const alreadyDurable = existingMessageId === text(source.whatsapp_message_id) && ["accepted","sent","delivered","read"].includes(text(row[16] || row[8]).toLowerCase());
if (!alreadyDurable && !["outcome_uncertain","send_prepared"].includes(text(row[16] || row[8]).toLowerCase())) {
  throw new Error(`immediate_success_persistence_invalid_prior_state:${text(row[16] || row[8])}`);
}
const priorMessageRows = records(source.message_log_values).filter((message) =>
  message.direction === "outbound" && message.message_type === "video" && message.source_reference === text(source.delivery_key)
);
const conflictingMessage = priorMessageRows.find((message) => message.whatsapp_message_id && message.whatsapp_message_id !== text(source.whatsapp_message_id));
if (conflictingMessage) throw new Error(`successful_message_log_id_conflict:${source.delivery_key}`);
const messageAlreadyLogged = priorMessageRows.some((message) => message.whatsapp_message_id === text(source.whatsapp_message_id));
return [{ json: { ...source, immediate_persistence_required: !alreadyDurable, immediate_persistence_already_durable: alreadyDurable, observed_message_id: existingMessageId, message_log_append_required: !messageAlreadyLogged } }];
