"use strict";

const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");

const phones = process.argv.slice(2);
if (!phones.length) throw new Error("at least one phone number is required");

const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params) => new Promise((resolve, reject) => {
  db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
});

function itemsFor(run) {
  const output = [];
  for (const entry of run || []) {
    for (const branch of entry?.data?.main || []) {
      for (const item of branch || []) output.push(item?.json || {});
    }
  }
  return output;
}

function compactItem(item) {
  return {
    whatsapp_number: item.whatsapp_number || item.wa_id || item.recipient || item.recipient_number || "",
    batch_number: item.batch_number || item.batch || "",
    file_index: item.file_index || "",
    file_name: item.file_name || "",
    delivery_key: item.delivery_key || "",
    media_id: item.media_id || "",
    whatsapp_message_id: item.whatsapp_message_id || item.messages?.[0]?.id || "",
    state: item.state || item.send_state || item.current_status || "",
    api_status: item.api_status || "",
    error: item.error || item.error_message || item.error_details || ""
  };
}

(async () => {
  const result = {};
  for (const phone of phones) {
    const rows = await all(
      `select e.id,e."workflowId",w.name as workflow_name,e.status,e."startedAt",e."stoppedAt",d.data
       from execution_entity e
       join execution_data d on d."executionId"=e.id
       left join workflow_entity w on w.id=e."workflowId"
       where d.data like ?
       order by cast(e.id as integer)`,
      [`%${phone}%`]
    );
    result[phone] = rows.map((row) => {
      let data;
      try { data = parse(row.data); } catch (error) {
        return { id: row.id, workflow_id: row.workflowId, status: row.status, parse_error: error.message };
      }
      const runData = data?.resultData?.runData || {};
      const relevant = {};
      for (const [name, runs] of Object.entries(runData)) {
        const items = itemsFor(runs).filter((item) => JSON.stringify(item).includes(phone));
        const errors = (runs || []).map((entry) => entry?.error?.message).filter(Boolean);
        if (items.length || errors.length || /send|video|delivery|claim|message log|tracker/i.test(name)) {
          relevant[name] = {
            runs: (runs || []).length,
            items: items.map(compactItem),
            errors
          };
        }
      }
      const error = data?.resultData?.error;
      return {
        id: row.id,
        workflow_id: row.workflowId,
        workflow_name: row.workflow_name,
        status: row.status,
        started_at: row.startedAt,
        stopped_at: row.stoppedAt,
        last_node: data?.resultData?.lastNodeExecuted || "",
        error_node: error?.node?.name || "",
        error: error?.message || "",
        nodes: relevant
      };
    });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  db.close();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  db.close();
  process.exitCode = 1;
});
