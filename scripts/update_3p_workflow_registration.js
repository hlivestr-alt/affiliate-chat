"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const WORKFLOW_ID = "SUyFO0U0GrvrqmFj";
const STATUS_WORKFLOW_ID = "AffWaStatus2026";
const API_BASE = "http://localhost:5678/api/v1";

function readEnv() {
  const values = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) values[match[1].trim()] = match[2];
  }
  return values;
}

async function request(pathname, apiKey, options = {}) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    ...options,
    headers: {
      "X-N8N-API-KEY": apiKey,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : null;
}

function connection(name) {
  return { node: name, type: "main", index: 0 };
}

async function main() {
  const apiKey = readEnv().N8N_API_KEY;
  if (!apiKey) throw new Error("N8N_API_KEY is missing");
  const workflow = await request(`/workflows/${WORKFLOW_ID}`, apiKey);
  if (!(workflow.nodes || []).some((item) => item.name === "Store 3p template wamid")) {
    workflow.nodes.push(
      {
        parameters: {
          jsCode: `const response = $json || {};
const messageId = String(response.messages?.[0]?.id || "");
return [{ json: {
  registry_action: "register_send",
  whatsapp_message_id: messageId,
  recipient_number: String(response.contacts?.[0]?.wa_id || response.contacts?.[0]?.input || ""),
  message_type: "template",
  template_name: "3p_direct_integration_test_template",
  source_workflow: "${WORKFLOW_ID}",
  source_reference: "approved_template_test",
  api_status: String(response.messages?.[0]?.message_status || "accepted"),
  accepted_at: new Date().toISOString(),
  raw_send_response: response,
  registration_valid: Boolean(messageId)
} }];`
        },
        id: crypto.randomUUID(), name: "Prepare 3p wamid registration",
        type: "n8n-nodes-base.code", typeVersion: 2, position: [540, 0]
      },
      {
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
            conditions: [{
              id: crypto.randomUUID(), leftValue: "={{ $json.registration_valid }}",
              rightValue: true,
              operator: { type: "boolean", operation: "true", singleValue: true }
            }],
            combinator: "and"
          },
          options: {}
        },
        id: crypto.randomUUID(), name: "IF wamid returned",
        type: "n8n-nodes-base.if", typeVersion: 2.3, position: [760, 0]
      },
      {
        parameters: {
          source: "database",
          workflowId: { __rl: true, value: STATUS_WORKFLOW_ID, mode: "list", cachedResultName: STATUS_WORKFLOW_ID },
          mode: "once",
          options: { waitForSubWorkflow: true }
        },
        id: crypto.randomUUID(), name: "Store 3p template wamid",
        type: "n8n-nodes-base.executeWorkflow", typeVersion: 1.3, position: [980, -80]
      },
      {
        parameters: {
          jsCode: 'return [{ json: $("Prepare 3p wamid registration").first().json.raw_send_response }];'
        },
        id: crypto.randomUUID(), name: "Return Meta send response",
        type: "n8n-nodes-base.code", typeVersion: 2, position: [1200, 0]
      }
    );
    workflow.connections["Send 3p template"] = { main: [[connection("Prepare 3p wamid registration")]] };
    workflow.connections["Prepare 3p wamid registration"] = { main: [[connection("IF wamid returned")]] };
    workflow.connections["IF wamid returned"] = {
      main: [[connection("Store 3p template wamid")], [connection("Return Meta send response")]]
    };
    workflow.connections["Store 3p template wamid"] = { main: [[connection("Return Meta send response")]] };
  }
  const payload = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: {
      ...(workflow.settings || {}),
      saveDataSuccessExecution: "none",
      saveDataErrorExecution: "none"
    }
  };
  const updated = await request(`/workflows/${WORKFLOW_ID}`, apiKey, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  process.stdout.write(`${JSON.stringify({
    id: updated.id,
    active: updated.active,
    node_count: updated.nodes.length,
    stores_wamid: updated.nodes.some((item) => item.name === "Store 3p template wamid")
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
