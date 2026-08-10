"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const OLD_SHEET = "1eyA1XRNZU0usuii801IrJCJHp8oCh2XjlfROrzzvpwE";
const NEW_SHEET = "1Zsq-ngyC1RGOCLlibFI-UyPBW88oQc0aJhC5cxtbrzA";
const evidencePath = path.join(ROOT, "n8n", "exports", "proya-delivery-log-audit-20260806T1125CST", "caller-permission-e2e.json");
const test = JSON.parse(fs.readFileSync(evidencePath, "utf8")).test;
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const i = line.indexOf("="); return i > 0 ? [line.slice(0, i), line.slice(i + 1)] : ["", ""]; }).filter(([key]) => key));
const id = () => crypto.randomUUID();
const edge = (node) => ({ main: [[{ node, type: "main", index: 0 }]] });
async function api(route, options = {}) { const response = await fetch(API + route, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY, ...(options.body ? { "Content-Type": "application/json" } : {}) } }); const body = await response.text(); if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 500)}`); return body ? JSON.parse(body) : {}; }

(async () => {
  const delivery = await api("/workflows/AffWaDelivery2026");
  const reply = await api("/workflows/AffWaReply2026");
  const credential = delivery.nodes.map((node) => node.credentials?.googleSheetsOAuth2Api).find(Boolean);
  const callNode = reply.nodes.find((node) => node.name === "Start Sequential File Delivery");
  const route = `delivery-final-state-${id()}`;
  const trigger = { id: id(), name: "Verify Final State", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-660, 0], webhookId: id(), parameters: { httpMethod: "POST", path: route, responseMode: "lastNode", options: {} } };
  const oldRead = { id: id(), name: "Read Assignment State after Cleanup", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-440, 0], credentials: { googleSheetsOAuth2Api: credential }, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `https://sheets.googleapis.com/v4/spreadsheets/${OLD_SHEET}/values:batchGet?${["WhatsApp Leads!A:AE", "Affiliate Assignments!A:M", "Delivery Log!A:R", "WhatsApp Message Log!A:X"].map((r) => `ranges=${encodeURIComponent(r)}`).join("&")}`, options: { timeout: 45000 } } };
  const newRead = { id: id(), name: "Read Assignment Log after Cleanup", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-220, 0], credentials: { googleSheetsOAuth2Api: credential }, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `https://sheets.googleapis.com/v4/spreadsheets/${NEW_SHEET}/values/%27Delivery%20Log%27!A%3AG`, options: { timeout: 45000 } } };
  const code = `const TEST=${JSON.stringify(test)},text=v=>v==null?"":String(v).trim(),table=v=>{const h=(v?.[0]||[]).map(text);return(v||[]).slice(1).map(r=>Object.fromEntries(h.map((n,i)=>[n,text(r[i])])))};const old=$("Read Assignment State after Cleanup").first().json.valueRanges||[],all=[...table(old[0]?.values),...table(old[1]?.values),...table(old[2]?.values),...table(old[3]?.values),...table($json.values)];const residual=all.filter(r=>r.conversation_id===TEST.conversation_id||r.Username===TEST.username||r.username===TEST.username);return[{json:{controlled_rows_remaining:residual.length,assignment_released:residual.length===0,residual_sources:residual.map(r=>({conversation_id:r.conversation_id||"",username:r.username||r.Username||"",status:r.Status||r.state||""})),checked_at:new Date().toISOString()}}];`;
  const result = { id: id(), name: "Confirm Controlled Rows Removed", type: "n8n-nodes-base.code", typeVersion: 2, position: [0, 0], parameters: { jsCode: code } };
  const workflow = await api("/workflows", { method: "POST", body: JSON.stringify({ name: "Temporary Delivery Permission Final-State Verification", nodes: [trigger, oldRead, newRead, result], connections: { [trigger.name]: edge(oldRead.name), [oldRead.name]: edge(newRead.name), [newRead.name]: edge(result.name) }, settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all" } }) });
  try {
    await api(`/workflows/${workflow.id}/activate`, { method: "POST" });
    const response = await fetch(`http://localhost:5678/webhook/${route}`, { method: "POST" });
    const body = await response.text();
    if (!response.ok) throw new Error(`final-state probe ${response.status}: ${body.slice(0, 500)}`);
    const output = {
      cleanup: JSON.parse(body),
      delivery: { active: delivery.active, callerPolicy: delivery.settings?.callerPolicy, callerIds: delivery.settings?.callerIds, google_credential_name: credential?.name, google_credential_id: credential?.id },
      reply: { active: reply.active, target_workflow_id: typeof callNode?.parameters?.workflowId === "object" ? callNode.parameters.workflowId.value : callNode?.parameters?.workflowId, wait_for_subworkflow: callNode?.parameters?.options?.waitForSubWorkflow !== false },
    };
    const outPath = path.join(ROOT, "n8n", "exports", "proya-delivery-log-audit-20260806T1125CST", "caller-permission-final-state.json");
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  } finally {
    try { await api(`/workflows/${workflow.id}/deactivate`, { method: "POST" }); } catch {}
    try { await api(`/workflows/${workflow.id}`, { method: "DELETE" }); } catch {}
  }
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
