#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse: parseFlatted } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");

function all(db, sql, values = []) {
  return new Promise((resolve, reject) => db.all(sql, values, (error, rows) => error ? reject(error) : resolve(rows)));
}

function firstItems(run) {
  const main = run?.data?.main;
  if (!Array.isArray(main)) return [];
  return main.flat().filter(Boolean);
}

async function main() {
  const database = process.argv[2] || "/home/node/.n8n/database.sqlite";
  const hours = Number(process.argv[3] || 24);
  if (!fs.existsSync(database)) throw new Error(`database not found: ${database}`);
  const db = new sqlite3.Database(database, sqlite3.OPEN_READONLY);
  let rows;
  try {
    rows = await all(db, `
      select e.id, e."workflowId", e.status, e."startedAt", e."stoppedAt", d.data
      from execution_entity e join execution_data d on d."executionId" = e.id
      where e."startedAt" >= datetime('now', ?)
        and e."workflowId" in ('AffWaWebhook2026','AffWaReply2026','AffWaDelivery2026','AffWaStatus2026','AffWaOptIn2026')
      order by e.id`, [`-${hours} hours`]);
  } finally {
    db.close();
  }
  const byWorkflow = {};
  const nodeSummary = {};
  const errorNodes = {};
  const errorSummaries = {};
  const keySamples = {};
  let parseFailures = 0;
  for (const row of rows) {
    const wf = byWorkflow[row.workflowId] ||= { executions: 0, statuses: {}, first: row.startedAt, last: row.startedAt };
    wf.executions += 1;
    wf.statuses[row.status] = (wf.statuses[row.status] || 0) + 1;
    if (row.startedAt < wf.first) wf.first = row.startedAt;
    if (row.startedAt > wf.last) wf.last = row.startedAt;
    let execution;
    try { execution = parseFlatted(row.data); } catch { parseFailures += 1; continue; }
    const runData = execution?.resultData?.runData || {};
    for (const [nodeName, runs] of Object.entries(runData)) {
      const key = `${row.workflowId} :: ${nodeName}`;
      const summary = nodeSummary[key] ||= { runs: 0, items: 0, errors: 0 };
      for (const run of runs || []) {
        summary.runs += 1;
        const items = firstItems(run);
        summary.items += items.length;
        if (run?.error) {
          summary.errors += 1;
          errorNodes[key] = (errorNodes[key] || 0) + 1;
          const raw = String(run.error.message || run.error.description || run.error.name || "unknown error");
          const safe = raw
            .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>")
            .replace(/([?&](?:access_token|token|key|secret)=)[^&\s]+/gi, "$1<redacted>")
            .slice(0, 500);
          const values = errorSummaries[key] ||= [];
          if (!values.includes(safe) && values.length < 5) values.push(safe);
        }
        for (const item of items.slice(0, 1)) {
          if (item?.json && !keySamples[key]) keySamples[key] = Object.keys(item.json).sort();
        }
      }
    }
  }
  const result = {
    audit_mode: "read_only",
    hours,
    executions_scanned: rows.length,
    parse_failures: parseFailures,
    workflows: byWorkflow,
    error_nodes: errorNodes,
    error_summaries: errorSummaries,
    nodes: Object.fromEntries(Object.entries(nodeSummary).filter(([, value]) => value.runs > 0)),
    output_key_samples: keySamples
  };
  const output = process.argv[4];
  if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify({
    audit_mode: result.audit_mode,
    hours,
    executions_scanned: rows.length,
    parse_failures: parseFailures,
    workflows: byWorkflow,
    error_nodes: errorNodes,
    nodes_run: Object.keys(nodeSummary).length
  }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
