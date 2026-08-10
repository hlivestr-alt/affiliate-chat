"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8")
  .split(/\r?\n/).map((line) => { const index = line.indexOf("="); return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : ["", ""]; })
  .filter(([key]) => key));
const apiKey = env.N8N_API_KEY;
if (!apiKey) throw new Error("N8N_API_KEY is missing");

async function api(route, options = {}) {
  const response = await fetch(`${API}${route}`, {
    ...options,
    headers: { "X-N8N-API-KEY": apiKey, ...(options.body ? { "Content-Type": "application/json" } : {}) }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}

const id = () => crypto.randomUUID();
const connect = (name) => ({ main: [[{ node: name, type: "main", index: 0 }]] });

async function main() {
  const reference = await api("/workflows/AffWaDelivery2026");
  const credential = reference.nodes.map((node) => node.credentials?.googleSheetsOAuth2Api).find(Boolean);
  if (!credential) throw new Error("Google Sheets credential was not found on AffWaDelivery2026");

  const route = `proya-create-delivery-log-${crypto.randomUUID()}`;
  const webhook = {
    id: id(), name: "Create Sheet Trigger", type: "n8n-nodes-base.webhook", typeVersion: 2.1,
    position: [-700, 0], webhookId: id(),
    parameters: { httpMethod: "POST", path: route, responseMode: "lastNode", options: {} }
  };
  const create = {
    id: id(), name: "Create PROYA Delivery Spreadsheet", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4,
    position: [-480, 0], credentials: { googleSheetsOAuth2Api: credential }, retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
    parameters: {
      authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", method: "POST",
      url: "https://sheets.googleapis.com/v4/spreadsheets?fields=spreadsheetId,properties.title,properties.timeZone,sheets.properties",
      sendBody: true, specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ properties: { title: 'PROYA WhatsApp Clip Delivery Log', locale: 'en_US', timeZone: 'Asia/Jakarta' }, sheets: [{ properties: { title: 'Delivery Log', gridProperties: { rowCount: 1000, columnCount: 7, frozenRowCount: 1 } } }] }) }}",
      options: { timeout: 45000 }
    }
  };
  const prepare = {
    id: id(), name: "Prepare Header and Format", type: "n8n-nodes-base.code", typeVersion: 2, position: [-260, 0],
    parameters: { jsCode: `const spreadsheetId=$json.spreadsheetId;const sheetId=$json.sheets?.[0]?.properties?.sheetId;if(!spreadsheetId||sheetId==null)throw new Error("Google did not return the spreadsheet identifiers");return [{json:{spreadsheetId,sheetId,headers:[["Numbered Folder","Username","WhatsApp Number","Sent At","Clips Sent","Status","Error"]]}}];` }
  };
  const header = {
    id: id(), name: "Write Delivery Log Header", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4,
    position: [-40, 0], credentials: { googleSheetsOAuth2Api: credential }, retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
    parameters: {
      authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", method: "PUT",
      url: "=https://sheets.googleapis.com/v4/spreadsheets/{{$json.spreadsheetId}}/values/%27Delivery%20Log%27!A1%3AG1?valueInputOption=RAW",
      sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify({ majorDimension: 'ROWS', values: $json.headers }) }}", options: { timeout: 45000 }
    }
  };
  const restore = {
    id: id(), name: "Restore Spreadsheet Identifiers", type: "n8n-nodes-base.code", typeVersion: 2, position: [180, 0],
    parameters: { jsCode: `return [{json:$("Prepare Header and Format").first().json}];` }
  };
  const format = {
    id: id(), name: "Format Delivery Log", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4,
    position: [400, 0], credentials: { googleSheetsOAuth2Api: credential }, retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
    parameters: {
      authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", method: "POST",
      url: "=https://sheets.googleapis.com/v4/spreadsheets/{{$json.spreadsheetId}}:batchUpdate",
      sendBody: true, specifyBody: "json",
      jsonBody: `={{ JSON.stringify({ requests: [
        { updateSheetProperties: { properties: { sheetId: $json.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
        { setBasicFilter: { filter: { range: { sheetId: $json.sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 7 } } } },
        { repeatCell: { range: { sheetId: $json.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.12, green: 0.32, blue: 0.52 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat' } },
        { repeatCell: { range: { sheetId: $json.sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 }, cell: { userEnteredFormat: { numberFormat: { type: 'TEXT', pattern: '@' } } }, fields: 'userEnteredFormat.numberFormat' } },
        { autoResizeDimensions: { dimensions: { sheetId: $json.sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 7 } } },
        { updateDimensionProperties: { range: { sheetId: $json.sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 185 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: $json.sheetId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 300 }, fields: 'pixelSize' } }
      ] }) }}`,
      options: { timeout: 45000 }
    }
  };
  const result = {
    id: id(), name: "Return Created Spreadsheet", type: "n8n-nodes-base.code", typeVersion: 2, position: [620, 0],
    parameters: { jsCode: `const source=$("Prepare Header and Format").first().json;return [{json:{spreadsheet_id:source.spreadsheetId,name:"PROYA WhatsApp Clip Delivery Log",sheet_name:"Delivery Log",sheet_id:source.sheetId,created_at:new Date().toISOString(),google_response:$json}}];` }
  };
  const nodes = [webhook, create, prepare, header, restore, format, result];
  const connections = {
    [webhook.name]: connect(create.name), [create.name]: connect(prepare.name), [prepare.name]: connect(header.name),
    [header.name]: connect(restore.name), [restore.name]: connect(format.name), [format.name]: connect(result.name)
  };
  const workflow = await api("/workflows", { method: "POST", body: JSON.stringify({ name: "Temporary - Create PROYA Delivery Log", nodes, connections, settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all" } }) });
  try {
    await api(`/workflows/${workflow.id}/activate`, { method: "POST" });
    const response = await fetch(`http://localhost:5678/webhook/${route}`, { method: "POST" });
    const body = await response.text();
    if (!response.ok) throw new Error(`create spreadsheet webhook ${response.status}: ${body.slice(0, 500)}`);
    const payload = JSON.parse(body);
    const output = path.join(ROOT, "n8n", "exports", "proya-delivery-log-audit-20260806T1125CST", "new-spreadsheet.json");
    fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ spreadsheet_id: payload.spreadsheet_id, name: payload.name, sheet_name: payload.sheet_name, created_at: payload.created_at }, null, 2)}\n`);
  } finally {
    try { await api(`/workflows/${workflow.id}/deactivate`, { method: "POST" }); } catch {}
    await api(`/workflows/${workflow.id}`, { method: "DELETE" });
  }
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
