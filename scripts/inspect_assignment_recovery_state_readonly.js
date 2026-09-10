"use strict";
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
(async () => {
  const definitions = await all('select id,name,"projectId" from data_table order by name');
  const tables = await all("select name from sqlite_master where type='table' and name like 'data_table_user_%' order by name");
  const matched = [];
  for (const table of tables) {
    const columns = await all(`pragma table_info("${table.name.replace(/"/g, '""')}")`);
    const textColumns = columns.map((column) => column.name).filter((name) => !["id", "createdAt", "updatedAt"].includes(name));
    if (!textColumns.length) continue;
    const predicate = textColumns.map((name) => `cast("${name.replace(/"/g, '""')}" as text) in ('6942','6943','6288989724987','6288907038448','wa:6288989724987:6942','wa:6288907038448:6943')`).join(" or ");
    const rows = await all(`select * from "${table.name.replace(/"/g, '""')}" where ${predicate}`);
    if (rows.length) matched.push({ physical_table: table.name, definition: definitions.find((item) => table.name.endsWith(item.id)) || null, rows });
  }
  process.stdout.write(JSON.stringify({ definitions, matched }, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }).finally(() => db.close());
