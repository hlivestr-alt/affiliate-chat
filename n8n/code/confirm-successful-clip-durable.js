const source = $("Validate Immediate Successful Send").item.json;
const text = (value) => value == null ? "" : String(value).trim();
const row = Array.isArray($json.values?.[0]) ? $json.values[0].map(text) : [];
const valid = row.length >= 18 && row[0] === text(source.delivery_key) && row[7] === text(source.whatsapp_message_id) && ["accepted","sent","delivered","read"].includes(text(row[16] || row[8]).toLowerCase()) && Number(row[9] || 0) === Number(source.attempts || 0);
if (!valid) throw new Error(`successful_clip_persistence_not_verified:${source.delivery_key}`);
return [{ json: { ...source, immediate_persistence_verified: true, immediate_persistence_result: "written_and_verified" } }];
