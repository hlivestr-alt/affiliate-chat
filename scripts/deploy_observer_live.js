#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const API = "http://127.0.0.1:5678/api/v1";
function env() { const result = {}; for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) { const index = line.indexOf("="); if (index > 0) result[line.slice(0, index)] = line.slice(index + 1); } return result; }
async function api(pathname, key, options = {}) { const response = await fetch(API + pathname, { ...options, headers: { "X-N8N-API-KEY": key, ...(options.body ? { "Content-Type": "application/json" } : {}) } }); const body = await response.text(); if (!response.ok) throw new Error(`n8n API ${response.status}: ${body.slice(0, 400)}`); return body ? JSON.parse(body) : {}; }
async function main() {
  const key = env().N8N_API_KEY;
  const desired = JSON.parse(fs.readFileSync(path.join(ROOT, "n8n", "imports", "affiliate-whatsapp-observability.json"), "utf8"));
  const before = await api(`/workflows/${desired.id}`, key);
  const active = Boolean(before.active);
  const settings = Object.fromEntries(Object.entries(desired.settings || {}).filter(([name]) => ["executionOrder", "saveDataErrorExecution", "saveDataSuccessExecution", "callerPolicy", "callerIds"].includes(name)));
  await api(`/workflows/${desired.id}`, key, { method: "PUT", body: JSON.stringify({ name: desired.name, nodes: desired.nodes, connections: desired.connections, settings }) });
  if (active) await api(`/workflows/${desired.id}/activate`, key, { method: "POST" });
  const after = await api(`/workflows/${desired.id}`, key);
  if (Boolean(after.active) !== active || after.nodes.length !== desired.nodes.length) throw new Error("Observer verification failed");
  process.stdout.write(JSON.stringify({ id: after.id, active_before: active, active_after: Boolean(after.active), nodes: after.nodes.length, version_id: after.versionId, active_version_id: after.activeVersionId }, null, 2) + "\n");
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
