"use strict";
const crypto = require("node:crypto");
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])); return value; }
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
function compact(row) {
  const output = { ...row };
  for (const key of ["nodes", "connections", "settings"]) {
    if (typeof output[key] !== "string") continue;
    try { output[key] = JSON.parse(output[key]); } catch {}
  }
  if (Array.isArray(output.nodes)) {
    output.definition_sha256 = hash({ name: output.name || "Affiliate Distribution - Resumable File Delivery", nodes: output.nodes, connections: output.connections || {}, settings: output.settings || {} });
    output.node_count = output.nodes.length;
    output.final_connections = Object.fromEntries(Object.entries(output.connections || {}).filter(([name, value]) => /Loop Through Files|Prepare Batched Delivery Tracking|Update Final Send State|Prepare Assignment Final Log|Log Assignment Final/.test(name) || JSON.stringify(value).match(/Prepare Batched Delivery Tracking|Update Final Send State|Prepare Assignment Final Log|Log Assignment Final/)));
    delete output.nodes; delete output.connections; delete output.settings;
  }
  return output;
}
(async () => {
  const tables = await all(`select name from sqlite_master where type='table' and name like 'workflow%' order by name`);
  const schemas = {};
  for (const { name } of tables) schemas[name] = (await all(`pragma table_info("${name}")`)).map((column) => column.name);
  const output = { schemas };
  if (schemas.workflow_publish_history) output.publish_history = await all(`select * from workflow_publish_history where "workflowId"='AffWaDelivery2026' and "createdAt">='2026-08-24 00:00:00' order by "createdAt"`);
  if (schemas.workflow_history) output.history = (await all(`select * from workflow_history where "workflowId"='AffWaDelivery2026' and "createdAt">='2026-08-24 00:00:00' order by "createdAt"`)).map(compact);
  output.current = (await all(`select id,name,active,"versionId","activeVersionId",nodes,connections,settings,"updatedAt" from workflow_entity where id='AffWaDelivery2026'`)).map(compact);
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }).finally(() => db.close());
