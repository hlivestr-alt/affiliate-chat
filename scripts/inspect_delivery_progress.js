"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const values = {};
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match) values[match[1].trim()] = match[2]; }
async function main() {
  const id = process.argv[2]; if (!id) throw new Error("execution id required");
  const response = await fetch(`http://localhost:5678/api/v1/executions/${id}?includeData=true`, { headers: { "X-N8N-API-KEY": values.N8N_API_KEY } });
  const body = await response.text(); if (!response.ok) throw new Error(`API ${response.status}: ${body.slice(0, 300)}`);
  const execution = JSON.parse(body); const runData = execution.data?.resultData?.runData || {};
  const summary = Object.entries(runData).map(([name, runs]) => ({ name, runs: runs.length, last_start: runs.at(-1)?.startTime, execution_time_ms: runs.at(-1)?.executionTime, error: runs.at(-1)?.error?.message || "", items: runs.at(-1)?.data?.main?.[0]?.length || 0 }));
  process.stdout.write(`${JSON.stringify({ id: execution.id, status: execution.status, startedAt: execution.startedAt, stoppedAt: execution.stoppedAt, lastNodeExecuted: execution.data?.resultData?.lastNodeExecuted, nodes: summary }, null, 2)}\n`);
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
