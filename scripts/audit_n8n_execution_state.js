"use strict";

const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");

function all(db, sql, parameters = []) {
  return new Promise((resolve, reject) => db.all(sql, parameters, (error, rows) => error ? reject(error) : resolve(rows)));
}

async function main() {
  const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
  try {
    const openExecutions = await all(db, `
      select id, "workflowId", status, "startedAt", "waitTill"
      from execution_entity
      where status in ('new', 'running', 'waiting')
        and "workflowId" in ('AffWaDelivery2026', 'AffWaReply2026', 'AffWaStatus2026', 'AffWaWebhook2026')
      order by "startedAt"
    `);
    const deliveryCounts = await all(db, `
      select status, count(*) as count
      from execution_entity
      where "workflowId" = 'AffWaDelivery2026'
        and status in ('new', 'running', 'waiting')
      group by status
    `);
    const recent = await all(db, `
      select id, "workflowId", status, "startedAt", "stoppedAt"
      from execution_entity
      where "startedAt" >= datetime('now', '-15 minutes')
        and "workflowId" in ('AffWaDelivery2026', 'AffWaReply2026', 'AffWaStatus2026', 'AffWaWebhook2026')
      order by "startedAt"
    `);
    process.stdout.write(JSON.stringify({
      open_executions: openExecutions,
      open_delivery_counts: deliveryCounts,
      recent_phase1_executions: recent
    }, null, 2) + "\n");
  } finally {
    db.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
