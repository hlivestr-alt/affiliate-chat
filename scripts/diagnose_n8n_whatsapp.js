#!/usr/bin/env node
"use strict";

const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse: parseFlatted } = require(
  "/usr/local/lib/node_modules/n8n/node_modules/flatted"
);

const databasePath =
  process.env.N8N_DATABASE_PATH || "/home/node/.n8n/database.sqlite";
const sinceHours = Number(process.argv[2] || 24);
const workflowIds = ["AfDriveRouter2026", "AfDriveReady2026"];

function all(db, sql, parameters = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, parameters, (error, rows) =>
      error ? reject(error) : resolve(rows)
    );
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => (error ? reject(error) : resolve()));
  });
}

function sqliteDate(date) {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

function errorSummary(serialized) {
  try {
    const data = parseFlatted(serialized);
    const error = data?.resultData?.error;
    return {
      message: error?.message || "",
      node: error?.node?.name || "",
      description: error?.description || ""
    };
  } catch {
    return { message: "", node: "", description: "" };
  }
}

function executionSummary(serialized) {
  try {
    const data = parseFlatted(serialized);
    const runData = data?.resultData?.runData || {};
    return {
      last_node_executed: data?.resultData?.lastNodeExecuted || "",
      nodes_with_run_data: Object.keys(runData),
      wait_till: data?.waitTill || null
    };
  } catch {
    return {
      last_node_executed: "",
      nodes_with_run_data: [],
      wait_till: null
    };
  }
}

async function main() {
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY);
  try {
    const webhooks = await all(
      db,
      `select "workflowId", "webhookPath", method, node
       from webhook_entity
       where "workflowId" in (?, ?)
       order by "workflowId", "webhookPath", method`,
      workflowIds
    );
    const executionCounts = await all(
      db,
      `select "workflowId", status, count(*) as count,
              min("startedAt") as oldest, max("startedAt") as newest
       from execution_entity
       where "workflowId" in (?, ?)
         and "startedAt" >= ?
       group by "workflowId", status
       order by "workflowId", status`,
      [...workflowIds, sqliteDate(since)]
    );
    const recentErrors = await all(
      db,
      `select e.id, e."workflowId", e.status, e."startedAt", d.data
       from execution_entity e
       join execution_data d on d."executionId" = e.id
       where e."workflowId" in (?, ?)
         and e.status = 'error'
         and e."startedAt" >= ?
       order by e."startedAt" desc
       limit 25`,
      [...workflowIds, sqliteDate(since)]
    );
    const recentRunning = await all(
      db,
      `select e.id, e."workflowId", e.status, e."startedAt", d.data
       from execution_entity e
       join execution_data d on d."executionId" = e.id
       where e."workflowId" in (?, ?)
         and e.status = 'running'
         and e."startedAt" >= ?
       order by e."startedAt" desc
       limit 25`,
      [...workflowIds, sqliteDate(since)]
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          since: since.toISOString(),
          webhooks,
          execution_counts: executionCounts,
          recent_errors: recentErrors.map((row) => ({
            id: row.id,
            workflowId: row.workflowId,
            status: row.status,
            startedAt: row.startedAt,
            ...errorSummary(row.data)
          })),
          recent_running: recentRunning.map((row) => ({
            id: row.id,
            workflowId: row.workflowId,
            status: row.status,
            startedAt: row.startedAt,
            ...executionSummary(row.data)
          }))
        },
        null,
        2
      )}\n`
    );
  } finally {
    await close(db);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
