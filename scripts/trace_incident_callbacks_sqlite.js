"use strict";
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const fs = require("node:fs");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const phones = new Set(["6287711806431", "6287701496171", "6281395829301"]);
function outputs(runs) { return (runs || []).flatMap((run) => (run?.data?.main || []).flatMap((branch) => branch || [])).map((item) => item?.json || {}); }
function statusesFrom(item) {
  const candidates = [item?.raw_event, item?.raw_callback, item?.body, item];
  const statuses = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    if (Array.isArray(candidate.statuses)) statuses.push(...candidate.statuses);
    for (const entry of candidate.entry || []) for (const change of entry.changes || []) statuses.push(...(change?.value?.statuses || []));
  }
  return statuses;
}
(async () => {
  const rows = await all(`select e.id,e.status,e."startedAt",e."stoppedAt",d.data from execution_entity e join execution_data d on d."executionId"=e.id where e."workflowId"='AffWaWebhook2026' and e."startedAt">='2026-08-24 09:00:00' order by cast(e.id as integer)`);
  const callbacks = [];
  for (const row of rows) {
    let data = {}; try { data = parse(row.data); } catch {}
    const run = data?.resultData?.runData || {};
    const items = outputs(run["Verify and Parse WhatsApp Webhook"] || []);
    for (const item of items) {
      for (const status of statusesFrom(item)) {
        const phone = String(status.recipient_id || item.whatsapp_number || item.wa_id || "").replace(/\D/g, "");
        if (!phones.has(phone)) continue;
        callbacks.push({ execution_id: Number(row.id), started_at: row.startedAt, phone, wamid: status.id || item.whatsapp_message_id || "", status: status.status || item.status || "", timestamp: status.timestamp || item.whatsapp_timestamp || "", errors: status.errors || [] });
      }
    }
  }
  const byPhone = {};
  for (const phone of phones) {
    const rowsForPhone = callbacks.filter((row) => row.phone === phone);
    const byWamid = {};
    for (const row of rowsForPhone) (byWamid[row.wamid] ||= []).push(row);
    byPhone[phone] = { callback_count: rowsForPhone.length, distinct_wamids: Object.keys(byWamid).length, statuses: Object.fromEntries([...new Set(rowsForPhone.map((row) => row.status))].map((status) => [status, rowsForPhone.filter((row) => row.status === status).length])), by_wamid: byWamid };
  }
  const result = { captured_at: new Date().toISOString(), by_phone: byPhone };
  const json = JSON.stringify(result, null, 2) + "\n";
  if (process.argv[2]) fs.writeFileSync(process.argv[2], json, { mode: 0o600 });
  process.stdout.write(JSON.stringify({ captured_at: result.captured_at, summary: Object.fromEntries(Object.entries(byPhone).map(([phone, value]) => [phone, { callback_count: value.callback_count, distinct_wamids: value.distinct_wamids, statuses: value.statuses }])) }, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }).finally(() => db.close());
