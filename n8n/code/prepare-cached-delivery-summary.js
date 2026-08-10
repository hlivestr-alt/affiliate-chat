const source = $("Restore and Validate Delivery Context").first().json;
const batch = $("Prepare Batched Delivery Tracking").first().json;
const text = (value) => value == null ? "" : String(value).trim();
const values = Array.isArray(source.delivery_log_values) ? source.delivery_log_values : [];
const headers = (values[0] || []).map(text);
const rows = values.slice(1).map((row) => Object.fromEntries(headers.map((name, column) => [name, text(row[column])]))).filter((row) => row.conversation_id === text(source.conversation_id) && row.batch_number === text(source.batch_number));
for (const result of batch.results) rows.push(Object.fromEntries(["delivery_key","conversation_id","whatsapp_number","batch_number","file_index","file_name","media_id","whatsapp_message_id","state","attempts","uploaded_at","sent_at","delivered_at","failed_at","last_error","updated_at","send_state","delivery_state"].map((name, index) => [name, text(result.delivery_row_values[index])])));
const rank = { failed: 1, accepted: 2, sent: 3, delivered: 4, read: 5 };
const byKey = new Map();
for (const row of rows) { if (!row.delivery_key) continue; const status = row.delivery_state || row.state || row.send_state; const current = byKey.get(row.delivery_key); if (!current || (rank[status] || 0) > (rank[current] || 0)) byKey.set(row.delivery_key, status); }
const statuses = [...byKey.values()];
const accepted = statuses.filter((status) => ["accepted","sent","delivered","read"].includes(status)).length;
const sent = statuses.filter((status) => ["sent","delivered","read"].includes(status)).length;
const delivered = statuses.filter((status) => ["delivered","read"].includes(status)).length;
const failed = statuses.filter((status) => status === "failed").length;
const expected = Number(source.expected_clip_count || 15);
const now = new Date().toISOString();
const leadRecord = { ...source, state: accepted === expected ? "files_sent" : failed ? "failed" : "delivery_in_progress", files_expected: String(expected), files_sent: String(sent), files_delivered: String(delivered), files_failed: String(failed), files_sent_at: accepted === expected ? (source.files_sent_at || now) : source.files_sent_at, last_error: failed ? "one_or_more_media_messages_failed" : "", updated_at: now };
let deliveryWriteError = "";
let messageWriteError = "";
try { deliveryWriteError = text($("Batch Write Delivery Results").first().json.error); } catch {}
try { messageWriteError = text($("Append Message Results Batch").first().json.error); } catch {}
return [{ json: { ...leadRecord, accepted_count: accepted, lead_row_values: source.lead_headers.map((name) => text(leadRecord[name])), tracking_delivery_write_ok: !deliveryWriteError, tracking_message_write_ok: batch.message_count === 0 || !messageWriteError } }];
