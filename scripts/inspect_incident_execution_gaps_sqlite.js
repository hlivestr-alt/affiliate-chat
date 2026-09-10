"use strict";
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const ids = [25837,25838,25839,25843,26077,26078,26081,26082,26083,26086,26751,26752,26756,26757,26758,26761,26766,26767];
(async () => {
  const tables = await all(`select name from sqlite_master where type='table' and (name like '%execution%' or name like '%workflow%') order by name`);
  const output = { ids, tables: {} };
  for (const { name } of tables) {
    const columns = await all(`pragma table_info("${name}")`);
    const idColumn = columns.find((column) => /^(executionId|execution_id|id)$/.test(column.name));
    if (!idColumn) continue;
    try {
      const rows = await all(`select * from "${name}" where "${idColumn.name}" in (${ids.map(() => "?").join(",")})`, ids);
      if (rows.length) output.tables[name] = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" && value.length > 1000 ? `<${value.length} chars>` : value])));
    } catch {}
  }
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }).finally(() => db.close());
