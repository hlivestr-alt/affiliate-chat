function text(value) { return value == null ? "" : String(value).trim(); }
const source = $("Prepare Pre-Send Delivery Claim").item;
const values = Array.isArray($json.values) ? $json.values : [];
const headers = (values[0] || []).map(text);
const rows = values.slice(1).map((row, index) => ({ row_number: index + 2, ...Object.fromEntries(headers.map((name, column) => [name, text(row[column])])) }));
const candidates = rows.filter((row) => row.delivery_key === text(source.json.delivery_key) && (
  row.state === "send_prepared" || row.media_id || row.whatsapp_message_id ||
  ["send_prepared", "accepted", "sent", "outcome_uncertain"].includes(row.send_state)
)).sort((a, b) => a.row_number - b.row_number);
const winner = candidates[0];
const won = Boolean(winner) && winner.last_error === text(source.json.pre_send_claim_token) && winner.media_id === text(source.json.media_id);
return [{ json: { ...source.json, pre_send_claim_won: won, delivery_log_row_number: winner?.row_number || source.json.delivery_log_row_number || "", blocked_reason: won ? "" : "duplicate_or_lost_pre_send_claim" }, binary: source.binary }];
