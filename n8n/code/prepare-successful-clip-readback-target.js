const source = $("Validate Immediate Successful Send").item.json;
const text = (value) => value == null ? "" : String(value).trim();
const rawRowNumber = text(source.delivery_log_row_number);
if (!/^[1-9]\d*$/.test(rawRowNumber)) {
  throw new Error("successful_clip_readback_row_number_invalid");
}
const rowNumber = Number(rawRowNumber);
if (!Number.isSafeInteger(rowNumber) || rowNumber < 2) {
  throw new Error("successful_clip_readback_row_number_invalid");
}
const required = [source.delivery_key, source.batch_number, source.conversation_id, source.file_index, source.file_name, source.whatsapp_message_id];
if (required.some((value) => !text(value))) {
  throw new Error("successful_clip_readback_context_invalid");
}
const normalizedPhone = text(source.whatsapp_number || source.wa_id || source.recipient_number).replace(/\D/g, "");
if (!normalizedPhone) {
  throw new Error("successful_clip_readback_context_invalid");
}
const spreadsheetId = "1eyA1XRNZU0usuii801IrJCJHp8oCh2XjlfROrzzvpwE";
const readbackUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Delivery%20Log!A${rowNumber}%3AR${rowNumber}`;
return [{ json: { ...source, delivery_log_row_number: rowNumber, whatsapp_number: normalizedPhone, successful_clip_readback_url: readbackUrl } }];
