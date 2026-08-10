"use strict";

const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));

function sanitize(value, depth = 0) {
  if (depth > 8) return "[DEPTH_LIMIT]";
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|authorization|credentialData|apiKey/i.test(key)) output[key] = "[REDACTED]";
    else if (/message_text|inbound_text|caption|content/i.test(key)) output[key] = item ? "[REDACTED CONTENT]" : item;
    else output[key] = sanitize(item, depth + 1);
  }
  return output;
}

function runItems(runs) {
  const output = [];
  for (const run of runs || []) {
    for (const branch of run?.data?.main || []) {
      for (const item of branch || []) output.push(sanitize(item?.json || {}));
    }
  }
  return output;
}

(async () => {
  const schema = await all("pragma table_info(execution_entity)");
  const execution = (await all(`select * from execution_entity where id=?`, [16013]))[0] || {};
  const dataRow = (await all(`select * from execution_data where "executionId"=?`, [16013]))[0] || {};
  let data = {}, workflow = {};
  try { data = parse(dataRow.data || ""); } catch {}
  try { workflow = JSON.parse(dataRow.workflowData || "{}"); } catch {}
  const runData = data?.resultData?.runData || {};
  const workflowNodes = (workflow.nodes || []).map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
    workflow_id: typeof node.parameters?.workflowId === "object" ? node.parameters.workflowId.value : node.parameters?.workflowId,
    wait_for_subworkflow: node.parameters?.options?.waitForSubWorkflow !== false,
    credential_names: Object.values(node.credentials || {}).map((credential) => credential?.name || credential?.id || "")
  }));
  const nodes = Object.entries(runData).map(([name, runs]) => ({
    name,
    executions: runs.length,
    start_time: runs[0]?.startTime || null,
    execution_time_ms: runs[0]?.executionTime || null,
    source: sanitize(runs[0]?.source || []),
    inputs: sanitize(runs[0]?.inputOverride || null),
    outputs: runItems(runs),
    errors: runs.map((run) => sanitize({
      name: run?.error?.name || "",
      message: run?.error?.message || "",
      description: run?.error?.description || "",
      code: run?.error?.code || "",
      httpCode: run?.error?.httpCode || "",
      level: run?.error?.level || "",
      stack: run?.error?.stack || ""
    })).filter((error) => error.message || error.description)
  }));
  const related = await all(`
    select id,"workflowId",status,mode,"startedAt","stoppedAt","retryOf","retrySuccessId","waitTill"
    from execution_entity
    where cast(id as integer) between 15990 and 16025
    order by cast(id as integer)
  `);
  const runningExecutions = await all(`select id,"workflowId",status,mode,"startedAt","waitTill" from execution_entity where status='running' order by cast(id as integer)`);
  const workflowRow = await all(`select id,name,active,"activeVersionId","versionId" from workflow_entity where id=?`, [execution.workflowId]);
  const tables = await all("select name,sql from sqlite_master where type='table' order by name");
  const tableNames = new Set(tables.map((table) => table.name));
  const metadataSchema = tableNames.has("execution_metadata") ? await all("pragma table_info(execution_metadata)") : [];
  const executionMetadata = tableNames.has("execution_metadata") ? await all(`select * from execution_metadata where "executionId"=?`, [16013]) : [];
  const historySchema = tableNames.has("workflow_history") ? await all("pragma table_info(workflow_history)") : [];
  let matchingHistory = [];
  if (tableNames.has("workflow_history")) {
    const historyColumns = new Set(historySchema.map((column) => column.name));
    const searchable = ["nodes", "connections", "name"].filter((column) => historyColumns.has(column));
    if (searchable.length) matchingHistory = await all(`select * from workflow_history where ${searchable.map((column) => `"${column}" like ?`).join(" or ")} limit 20`, searchable.map(() => "%c72f785d-fa26-44b9-90fb-2dd866e343f6%"));
  }
  const sharedCredentialSchema = tableNames.has("shared_credentials") ? await all("pragma table_info(shared_credentials)") : [];
  const credentialSharing = tableNames.has("shared_credentials") ? await all(`
    select sc."credentialsId",sc."projectId",sc.role,p.name as project_name,p.type as project_type,c.name as credential_name,c.type as credential_type
    from shared_credentials sc
    left join project p on p.id=sc."projectId"
    left join credentials_entity c on c.id=sc."credentialsId"
    where sc."credentialsId" in (?,?)
  `, ["v62HRbwXmN6BRJqs", "CQK8KrdZjxOzOzgc"]) : [];
  const projectRelations = tableNames.has("project_relation") ? await all(`
    select pr."projectId",pr."userId",pr.role,p.name as project_name,p.type as project_type
    from project_relation pr left join project p on p.id=pr."projectId"
    where pr."projectId"=?
  `, ["sSUYKps61tFNiKyf"]) : [];
  process.stdout.write(`${JSON.stringify({
    execution_schema: schema.map((column) => column.name),
    execution: sanitize(execution),
    execution_data_keys: Object.keys(dataRow),
    parsed_data_top_keys: Object.keys(data || {}),
    execution_data: sanitize({
      startData: data?.startData,
      executionData: data?.executionData,
      waitTill: data?.waitTill,
      lastNodeExecuted: data?.resultData?.lastNodeExecuted,
      error: data?.resultData?.error
    }),
    workflow_snapshot: { id: workflow.id, name: workflow.name, active: workflow.active, settings: workflow.settings, nodes: workflowNodes, connections: workflow.connections },
    node_runs: nodes,
    workflow_entity: workflowRow,
    nearby_executions: related,
    running_executions: runningExecutions,
    table_names: tables.map((table) => table.name),
    execution_metadata_schema: metadataSchema.map((column) => column.name),
    execution_metadata: sanitize(executionMetadata),
    workflow_history_schema: historySchema.map((column) => column.name),
    matching_workflow_history: sanitize(matchingHistory),
    shared_credentials_schema: sharedCredentialSchema.map((column) => column.name),
    credential_sharing: sanitize(credentialSharing),
    project_relations: sanitize(projectRelations)
  }, null, 2)}\n`);
  db.close();
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); db.close(); process.exitCode = 1; });
