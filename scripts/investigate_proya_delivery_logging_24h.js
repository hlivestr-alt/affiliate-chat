"use strict";

const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");

const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
});

function flattenItems(runs) {
  const result = [];
  for (const run of runs || []) {
    for (const branch of run?.data?.main || []) {
      for (const item of branch || []) result.push(item?.json || {});
    }
  }
  return result;
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|authorization|access_token|client_secret|api[_-]?key/i.test(key)) output[key] = "[REDACTED]";
    else if (/message_text|inbound_text|content|caption/i.test(key)) output[key] = item ? "[REDACTED CONTENT]" : item;
    else output[key] = redact(item);
  }
  return output;
}

function compact(item) {
  const source = item?.body?.data || item || {};
  return redact({
    username: item.username || item.tiktok_username || item.affiliate_username || "",
    whatsapp_number: item.whatsapp_number || item.wa_id || item.recipient_number || item.phone || "",
    numbered_folder: item.numbered_folder || item.original_folder_number || item.folder_number || item.batch_number || "",
    expected_count: item.expected_count || item.expected_clips || item.total_files || item.clip_count || "",
    successful_count: item.successful_count || item.sent_count || item.accepted_count || "",
    file_index: item.file_index || "",
    delivery_key: item.assignment_id || item.delivery_key || item.source_reference || "",
    whatsapp_message_id: item.whatsapp_message_id || item.messages?.[0]?.id || "",
    status: item.status || item.state || item.send_state || item.delivery_state || item.current_result || "",
    spreadsheet_id: item.spreadsheetId || item.spreadsheet_id || "",
    updated_rows: item.totalUpdatedRows || item.updatedRows || item.updates?.updatedRows || "",
    updated_range: item.updatedRange || item.updates?.updatedRange || "",
    error: item.error || item.last_error || item.error_message || item.error_details || ""
  });
}

function targetWorkflowId(node) {
  const value = node?.parameters?.workflowId;
  return typeof value === "object" ? value?.value || "" : value || "";
}

function sheetTarget(node) {
  const url = String(node?.parameters?.url || "");
  const match = /spreadsheets\/([A-Za-z0-9_-]+)/.exec(url);
  const afterValues = url.includes("/values/") ? url.split("/values/")[1].split("?")[0] : "";
  return {
    node: node.name,
    type: node.type,
    method: node.parameters?.method || "GET",
    spreadsheet_id: match?.[1] || "",
    range: afterValues ? decodeURIComponent(afterValues) : "",
    credential: node.credentials?.googleSheetsOAuth2Api?.name || node.credentials?.googleSheetsOAuth2Api?.id || "",
    continue_on_fail: Boolean(node.continueOnFail || node.onError === "continueRegularOutput" || node.onError === "continueErrorOutput"),
    always_output_data: Boolean(node.alwaysOutputData),
    retry_on_fail: Boolean(node.retryOnFail),
    max_tries: node.maxTries || 1
  };
}

(async () => {
  const serverClock = await all("select datetime('now') as utc_now, datetime('now','-24 hours') as utc_start");
  const counts = await all(`
    select e."workflowId", coalesce(w.name, '') as workflow_name, e.status, count(*) as count,
           min(e."startedAt") as oldest, max(e."startedAt") as newest
    from execution_entity e
    left join workflow_entity w on w.id=e."workflowId"
    where e."startedAt" >= datetime('now','-24 hours')
    group by e."workflowId", w.name, e.status
    order by max(e."startedAt") desc, e."workflowId", e.status
  `);
  const relevantPattern = /(AffWa|Affiliate|Delivery|Drive|Outbound|Clip)/i;
  const rows = await all(`
    select e.id,e."workflowId",coalesce(w.name,'') as workflow_name,e.status,e.mode,e."startedAt",e."stoppedAt",d.data,d."workflowData"
    from execution_entity e
    left join workflow_entity w on w.id=e."workflowId"
    join execution_data d on d."executionId"=e.id
    where e."startedAt" >= datetime('now','-24 hours')
    order by cast(e.id as integer) desc
  `);

  const executions = [];
  const sendExecutions = [];
  for (const row of rows) {
    let data = {}, workflow = {};
    try { data = parse(row.data); } catch {}
    try { workflow = JSON.parse(row.workflowData || "{}"); } catch {}
    const runData = data?.resultData?.runData || {};
    const nodesByName = new Map((workflow.nodes || []).map((node) => [node.name, node]));
    const sends = Object.entries(runData).filter(([name]) => /send whatsapp video|send.*(?:media|video|clip)|(?:media|video|clip).*send/i.test(name));
    if (sends.length) {
      sendExecutions.push({
        id: row.id,
        workflow_id: row.workflowId,
        workflow_name: row.workflow_name,
        status: row.status,
        started_at_utc: row.startedAt,
        sends: sends.map(([name, runs]) => ({
          node: name,
          attempts: runs.length,
          outputs: flattenItems(runs).map(compact),
          errors: runs.map((run) => redact({ message: run?.error?.message || "", description: run?.error?.description || "" })).filter((error) => error.message || error.description)
        }))
      });
    }
    if (!relevantPattern.test(`${row.workflowId} ${row.workflow_name}`)) continue;
    const nodeRuns = Object.entries(runData).map(([name, runs]) => {
      const definition = nodesByName.get(name) || {};
      const outputs = flattenItems(runs);
      const isSheet = Boolean(definition.credentials?.googleSheetsOAuth2Api || /sheets\.googleapis\.com/.test(String(definition.parameters?.url || "")));
      const isSend = /send whatsapp video|send.*media|whatsapp.*send/i.test(name);
      const isBranch = /\b(if|switch|merge|loop|filter|done|skip)\b/i.test(`${name} ${definition.type || ""}`);
      if (!isSheet && !isSend && !isBranch && !/assign|folder|delivery|clip|batch|log|track|result|claim|reservation/i.test(name)) return null;
      return {
        node: name,
        type: definition.type || "",
        executions: runs.length,
        output_count: outputs.length,
        output: outputs.slice(0, 3).map(compact),
        errors: runs.map((run) => redact({
          message: run?.error?.message || "",
          description: run?.error?.description || "",
          http_code: run?.error?.httpCode || ""
        })).filter((error) => error.message || error.description),
        ...(isSheet ? { sheet: sheetTarget(definition) } : {}),
        ...(definition.type === "n8n-nodes-base.executeWorkflow" ? { target_workflow: targetWorkflowId(definition), wait_for_subworkflow: definition.parameters?.options?.waitForSubWorkflow !== false } : {})
      };
    }).filter(Boolean);
    const finalError = data?.resultData?.error || {};
    executions.push({
      id: row.id,
      workflow_id: row.workflowId,
      workflow_name: row.workflow_name,
      status: row.status,
      mode: row.mode,
      started_at_utc: row.startedAt,
      stopped_at_utc: row.stoppedAt,
      last_node: data?.resultData?.lastNodeExecuted || "",
      error_node: finalError?.node?.name || "",
      error: finalError?.message || "",
      executed_nodes: Object.keys(runData),
      relevant_node_runs: nodeRuns
    });
  }

  process.stdout.write(`${JSON.stringify({server_clock:serverClock[0],counts,send_executions:sendExecutions,executions}, null, 2)}\n`);
  db.close();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  db.close();
  process.exitCode = 1;
});
