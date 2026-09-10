"use strict";
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "n8n", "exports", "assignment-6944-readback-recovery-20260824");
const API = "http://localhost:5678/api/v1";
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const i = line.indexOf("="); return i > 0 ? [line.slice(0, i).trim(), line.slice(i + 1)] : ["", ""]; }).filter(([key]) => key));
async function api(route, options = {}) { const response = await fetch(API + route, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY, ...(options.body ? { "Content-Type": "application/json" } : {}) } }); const body = await response.text(); if (!response.ok) throw new Error(`n8n_${response.status}:${route}:${body.slice(0,500)}`); return body ? JSON.parse(body) : {}; }
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  if (!process.argv.includes("--idle-verified")) throw new Error("read_only_idle_verification_required");
  const [entry, delivery] = await Promise.all([api("/workflows/AffWaWebhook2026"), api("/workflows/AffWaDelivery2026")]);
  if (!entry.active || entry.activeVersionId !== entry.versionId) throw new Error("entry_not_active_before_pause");
  if (delivery.versionId !== "0e41e3cc-036a-4903-adcc-068e4039037a" || delivery.activeVersionId !== delivery.versionId) throw new Error("unexpected_delivery_version_before_pause");
  fs.writeFileSync(path.join(OUT, "AffWaWebhook2026.before-pause.json"), JSON.stringify(entry, null, 2) + "\n", { mode: 0o600 });
  await api("/workflows/AffWaWebhook2026/deactivate", { method: "POST" });
  const after = await api("/workflows/AffWaWebhook2026");
  if (after.active) throw new Error("entry_pause_failed");
  const report = { paused_at: new Date().toISOString(), paused_workflow_id: entry.id, paused_workflow_name: entry.name, definition_version_unchanged: after.versionId === entry.versionId, version_id: after.versionId, active_before: entry.active, active_after: after.active, open_delivery_executions_before_pause: [] };
  fs.writeFileSync(path.join(OUT, "entry-pause-report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
