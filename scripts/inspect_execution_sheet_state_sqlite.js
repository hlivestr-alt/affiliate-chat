"use strict";
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const id = Number(process.argv[2]);
const phone = String(process.argv[3] || "");
const batch = String(process.argv[4] || "");
if (!Number.isInteger(id) || !phone || !batch) throw new Error("usage: execution-id phone batch");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
db.get('select data from execution_data where "executionId"=?', [id], (error, row) => {
  if (error) throw error;
  const data = parse(row.data);
  const run = data?.resultData?.runData || {};
  const output = {};
  for (const name of ["Read Delivery Log for Resume", "Reread Delivery Log after Pre-Send Claim", "Read Message Log for Resume", "Parse Video Send"]) {
    const entries = run[name] || [];
    output[name] = entries.map((entry) => {
      const item = entry?.data?.main?.[0]?.[0]?.json || {};
      if (Array.isArray(item.values)) {
        const headers = (item.values[0] || []).map(String);
        return item.values.slice(1).map((values, index) => ({ row_number: index + 2, ...Object.fromEntries(headers.map((header, column) => [header, values[column] == null ? "" : String(values[column])])) }))
          .filter((record) => JSON.stringify(record).includes(phone) && (!record.batch_number || record.batch_number === batch));
      }
      return item;
    });
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  db.close();
});
