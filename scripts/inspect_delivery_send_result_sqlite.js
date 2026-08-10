"use strict";
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const id = Number(process.argv[2]);
if (!Number.isInteger(id)) throw new Error("execution id required");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
db.get('select e.id,e.status,d.data from execution_entity e join execution_data d on d."executionId"=e.id where e.id=? and e."workflowId"=\'AffWaDelivery2026\'', [id], (error, row) => {
  if (error) throw error;
  if (!row) throw new Error("delivery execution not found");
  const data = parse(row.data);
  const run = data?.resultData?.runData || {};
  const safe = {};
  for (const name of ["Parse Media Upload", "IF Pre-Send Claim Won", "Send WhatsApp Video", "Parse Video Send", "Update Existing Delivery Log"]) {
    safe[name] = (run[name] || []).map((entry) => {
      const item = entry?.data?.main?.[0]?.[0]?.json || {};
      return {
        start_time: entry?.startTime || "",
        error: entry?.error?.message || "",
        delivery_key: item.delivery_key || "",
        file_name: item.file_name || "",
        media_id: item.media_id || "",
        whatsapp_message_id: item.whatsapp_message_id || item.messages?.[0]?.id || "",
        send_state: item.send_state || "",
        state: item.state || ""
      };
    });
  }
  process.stdout.write(`${JSON.stringify({ id: row.id, status: row.status, nodes: safe }, null, 2)}\n`);
  db.close();
});
