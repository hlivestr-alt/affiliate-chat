"use strict";
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const ids = process.argv.slice(2).map(Number).filter(Number.isFinite);
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
db.all(`select e.id,e."startedAt",d.data from execution_entity e join execution_data d on d."executionId"=e.id where e.id in (${ids.map(() => "?").join(",")}) order by cast(e.id as integer)`, ids, (error, rows) => {
  if (error) throw error;
  const output = rows.map((row) => {
    const run = parse(row.data)?.resultData?.runData?.["Parse Video Send"] || [];
    const items = run.flatMap((entry) => (entry?.data?.main || []).flatMap((branch) => branch || [])).map((item) => item.json || {});
    return { execution_id: String(row.id), started_at: row.startedAt, sends: items.map((item) => ({ delivery_key: item.delivery_key, batch_number: item.batch_number, file_index: item.file_index, file_name: item.file_name, media_id: item.media_id, whatsapp_message_id: item.whatsapp_message_id, attempts: item.attempts, uploaded_at: item.uploaded_at, sent_at: item.delivery_row_values?.[11] || item.sent_at || "", delivery_row_values: item.delivery_row_values })) };
  });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  db.close();
});
