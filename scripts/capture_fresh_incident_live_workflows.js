"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, "n8n", "exports", "fresh-production-incident-6945-6947-20260828", "pre-pause");
const API = "http://localhost:5678/api/v1";
const CORE_IDS = ["AffWaWebhook2026", "AffWaReply2026", "AffWaDelivery2026"];
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8")
  .split(/\r?\n/)
  .map((line) => { const i = line.indexOf("="); return i > 0 ? [line.slice(0, i).trim(), line.slice(i + 1)] : ["", ""]; })
  .filter(([key]) => key));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function definition(workflow) {
  return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings };
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function targetId(node) {
  const value = node?.parameters?.workflowId;
  return String(value && typeof value === "object" ? value.value || "" : value || "");
}

async function api(route) {
  const response = await fetch(API + route, { headers: { "X-N8N-API-KEY": env.N8N_API_KEY } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n_${response.status}:${route}:${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const listing = await api("/workflows?limit=250");
  const list = listing.data || listing;
  const ids = new Set(CORE_IDS);
  const fetched = new Map();
  for (const id of CORE_IDS) fetched.set(id, await api(`/workflows/${id}`));
  for (const workflow of fetched.values()) {
    for (const node of workflow.nodes || []) {
      if (node.type === "n8n-nodes-base.executeWorkflow") {
        const id = targetId(node);
        if (id) ids.add(id);
      }
    }
  }
  for (const workflow of list) {
    if (/delivery.*(log|retry|recover)|(?:log|retry|recover).*delivery/i.test(workflow.name || "")) ids.add(workflow.id);
  }
  for (const id of ids) {
    if (!fetched.has(id)) {
      try { fetched.set(id, await api(`/workflows/${id}`)); } catch (error) { fetched.set(id, { id, fetch_error: error.message }); }
    }
  }
  const summary = { captured_at: new Date().toISOString(), workflows: [] };
  for (const [id, workflow] of fetched) {
    fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(workflow, null, 2) + "\n", { mode: 0o600 });
    if (workflow.fetch_error) {
      summary.workflows.push({ id, fetch_error: workflow.fetch_error });
      continue;
    }
    const execute_workflows = (workflow.nodes || []).filter((node) => node.type === "n8n-nodes-base.executeWorkflow")
      .map((node) => ({ node: node.name, target: targetId(node), wait: node?.parameters?.options?.waitForSubWorkflow !== false }));
    summary.workflows.push({
      id,
      name: workflow.name,
      active: workflow.active,
      version_id: workflow.versionId || "",
      active_version_id: workflow.activeVersionId || "",
      updated_at: workflow.updatedAt || "",
      definition_sha256: hash(definition(workflow)),
      node_count: (workflow.nodes || []).length,
      caller_policy: workflow.settings?.callerPolicy || "",
      caller_ids: workflow.settings?.callerIds || "",
      execute_workflows,
    });
  }
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
