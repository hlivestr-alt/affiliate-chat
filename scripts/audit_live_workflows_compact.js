"use strict";

const fs = require("fs");
const workflows = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

function text(value) {
  return value == null ? "" : String(value);
}

function targetId(node) {
  const value = node?.parameters?.workflowId;
  return text(value && typeof value === "object" ? value.value : value);
}

const spreadsheetPattern = /spreadsheets\/([A-Za-z0-9_-]+)/;
const result = workflows
  .filter((workflow) => workflow.active)
  .map((workflow) => {
    const sheetNodes = workflow.nodes.filter((node) =>
      node?.credentials?.googleSheetsOAuth2Api || /sheets\.googleapis\.com/.test(text(node?.parameters?.url))
    );
    const executeNodes = workflow.nodes
      .filter((node) => node.type === "n8n-nodes-base.executeWorkflow")
      .map((node) => ({ node: node.name, target: targetId(node), wait: node?.parameters?.options?.waitForSubWorkflow !== false }));
    const triggers = workflow.nodes
      .filter((node) => /webhook|trigger$/i.test(node.type) || /webhook/i.test(node.name))
      .map((node) => ({ node: node.name, type: node.type, path: text(node?.parameters?.path), http_method: text(node?.parameters?.httpMethod || "GET") }));
    const sheetOperations = sheetNodes.map((node) => {
      const url = text(node?.parameters?.url);
      const match = spreadsheetPattern.exec(url);
      return {
        node: node.name,
        method: text(node?.parameters?.method || "GET"),
        spreadsheet_id: match?.[1] || "",
        range: decodeURIComponent((url.split("/values/")[1] || url.split("/values/")[1] || url.split("/values")[1] || "").split("?")[0]),
        retry: Boolean(node.retryOnFail),
        max_tries: node.maxTries || 1,
        continue_on_fail: Boolean(node.continueOnFail)
      };
    });
    return {
      id: workflow.id,
      name: workflow.name,
      active: workflow.active,
      node_count: workflow.nodes.length,
      caller_policy: text(workflow?.settings?.callerPolicy),
      caller_ids: text(workflow?.settings?.callerIds),
      pinned_nodes: Object.keys(workflow.pinData || {}),
      triggers,
      execute_workflows: executeNodes,
      sheet_operations: sheetOperations
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
