const text = (value) => value == null ? "" : String(value).trim();
const claims = new Map($("Prepare Batch Send Claims").first().json.claims.map((claim) => [claim.delivery_key, claim.row_number]));
const values = Array.isArray($json.values) ? $json.values : [];
const headers = (values[0] || []).map(text);
const rows = values.slice(1).map((row, index) => ({ row_number: index + 2, ...Object.fromEntries(headers.map((name, column) => [name, text(row[column])])) }));
const tokenPrefix = `batch_pre_send_claim:${String($execution.id)}:`;
const owned = new Set(rows.filter((row) => row.last_error === tokenPrefix + row.delivery_key).map((row) => row.delivery_key));
return $("Prepare Resumable Delivery Items").all().filter((item) => owned.has(item.json.delivery_key)).map((item) => ({
  json: { ...item.json, delivery_log_row_number: claims.get(item.json.delivery_key) || item.json.delivery_log_row_number }, binary: item.binary
}));
