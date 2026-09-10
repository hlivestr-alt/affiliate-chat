"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const CORE_SHEET = "1eyA1XRNZU0usuii801IrJCJHp8oCh2XjlfROrzzvpwE";
const SIMPLE_SHEET = "1Zsq-ngyC1RGOCLlibFI-UyPBW88oQc0aJhC5cxtbrzA";
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const i = line.indexOf("="); return i > 0 ? [line.slice(0, i).trim(), line.slice(i + 1)] : ["", ""]; }).filter(([key]) => key));
async function api(route, options = {}) { const response = await fetch(API + route, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY, ...(options.body ? { "Content-Type": "application/json" } : {}) } }); const body = await response.text(); if (!response.ok) throw new Error(`n8n_${response.status}:${route}:${body.slice(0, 500)}`); return body ? JSON.parse(body) : {}; }
const id = () => crypto.randomUUID();
const edge = (node) => ({ main: [[{ node, type: "main", index: 0 }]] });
(async () => {
  const out = process.argv[2];
  if (!out) throw new Error("output path required");
  const delivery = await api("/workflows/AffWaDelivery2026");
  const credential = delivery.nodes.map((node) => node.credentials?.googleSheetsOAuth2Api).find(Boolean);
  if (!credential) throw new Error("google_sheets_credential_missing");
  const route = `fresh-incident-sheet-audit-${id()}`;
  const nodes = [
    { id: id(), name: "Audit Request", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-1000, 0], webhookId: id(), parameters: { httpMethod: "GET", path: route, responseMode: "lastNode", options: {} } },
    ...[
      ["Read Leads", CORE_SHEET, "WhatsApp%20Leads!A%3AAF"],
      ["Read Assignments", CORE_SHEET, "Affiliate%20Assignments!A%3AM"],
      ["Read Delivery", CORE_SHEET, "Delivery%20Log!A%3AR"],
      ["Read Messages", CORE_SHEET, "WhatsApp%20Message%20Log!A%3AX"],
      ["Read Simple Log", SIMPLE_SHEET, "%27Delivery%20Log%27!A%3AG"],
    ].map(([name, sheet, range], index) => ({ id: id(), name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-800 + index * 200, 0], credentials: { googleSheetsOAuth2Api: credential }, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `https://sheets.googleapis.com/v4/spreadsheets/${sheet}/values/${range}`, options: { timeout: 45000 } } })),
    { id: id(), name: "Filter Incident Rows", type: "n8n-nodes-base.code", typeVersion: 2, position: [200, 0], parameters: { jsCode: `
const targets=[{batch:"6945",phone:"6287711806431",username:"hayrii17"},{batch:"6946",phone:"6287701496171",username:"romansa.ai"},{batch:"6947",phone:"6281395829301",username:"d.raynjayashowcase"}];
const text=(v)=>v==null?"":String(v).trim(),digits=(v)=>text(v).replace(/\\D/g,"");
function table(values){const header=(values?.[0]||[]).map(text);return (values||[]).slice(1).map((row,index)=>({row_number:index+2,...Object.fromEntries(header.map((name,column)=>[name,text(row[column])]))}));}
const sources={leads:table($("Read Leads").first().json.values),assignments:table($("Read Assignments").first().json.values),delivery:table($("Read Delivery").first().json.values),messages:table($("Read Messages").first().json.values),simple:table($("Read Simple Log").first().json.values)};
const match=(row,target)=>Object.values(row).some((value)=>text(value)===target.batch||digits(value)===target.phone||text(value).toLowerCase()===target.username.toLowerCase())||text(row.batch_number||row.numbered_folder||row["Numbered Folder"])===target.batch||digits(row.wa_id||row.whatsapp_number||row.recipient_number)===target.phone;
const result={audited_at:new Date().toISOString(),targets:{}};
for(const target of targets)result.targets[target.batch]=Object.fromEntries(Object.entries(sources).map(([name,rows])=>[name,rows.filter((row)=>match(row,target))]));
return[{json:result}];` } },
  ];
  const connections = {};
  for (let index = 0; index < nodes.length - 1; index++) connections[nodes[index].name] = edge(nodes[index + 1].name);
  const workflow = await api("/workflows", { method: "POST", body: JSON.stringify({ name: "Temporary Fresh Production Incident Sheet Audit", nodes, connections, settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all" } }) });
  try {
    await api(`/workflows/${workflow.id}/activate`, { method: "POST" });
    const response = await fetch(`http://localhost:5678/webhook/${route}`);
    const body = await response.text();
    if (!response.ok) throw new Error(`audit_${response.status}:${body.slice(0, 500)}`);
    const result = JSON.parse(body);
    fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
    process.stdout.write(JSON.stringify({ audited_at: result.audited_at, counts: Object.fromEntries(Object.entries(result.targets).map(([batch, sources]) => [batch, Object.fromEntries(Object.entries(sources).map(([name, rows]) => [name, rows.length]))])), temporary_workflow_id: workflow.id }, null, 2) + "\n");
  } finally {
    try { await api(`/workflows/${workflow.id}/deactivate`, { method: "POST" }); } catch {}
    try { await api(`/workflows/${workflow.id}`, { method: "DELETE" }); } catch {}
  }
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
