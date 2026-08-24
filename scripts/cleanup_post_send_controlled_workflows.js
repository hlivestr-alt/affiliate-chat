"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/).map((line) => {
  const index = line.indexOf("=");
  return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1)] : ["", ""];
}).filter(([key]) => key));
const base = "http://localhost:5678/api/v1";
const exactName = "Controlled Mock - WhatsApp Post-Send Persistence 20260822";

async function api(route, options = {}) {
  const response = await fetch(base + route, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n_${response.status}:${route}:${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : {};
}

(async () => {
  const found = [];
  let cursor = "";
  do {
    const page = await api(`/workflows?limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    found.push(...(page.data || []).filter((workflow) => workflow.name === exactName));
    cursor = page.nextCursor || "";
  } while (cursor);
  for (const workflow of found) {
    if (workflow.active) await api(`/workflows/${workflow.id}/deactivate`, { method: "POST" });
    await api(`/workflows/${workflow.id}`, { method: "DELETE" });
  }
  process.stdout.write(JSON.stringify({ exact_name: exactName, found: found.length, deleted_ids: found.map((workflow) => workflow.id), active_found: found.filter((workflow) => workflow.active).length }, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
