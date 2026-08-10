"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { patchPhase1Workflow } = require("./lib/phase1_whatsapp_patch");

const ROOT = path.resolve(__dirname, "..");
const IMPORTS = path.join(ROOT, "n8n", "imports");

const IDS = Object.freeze({
  processor: "AfDriveReady2026",
  optIn: "AffWaOptIn2026",
  webhookVerify: "AffWaVerify2026",
  webhookRouter: "AffWaWebhook2026",
  status: "AffWaStatus2026",
  reply: "AffWaReply2026",
  delivery: "AffWaDelivery2026",
  queue: "AffWaQueue2026",
  setup: "AffDistSetup2026"
});

const SHEETS = Object.freeze({
  leads: "WhatsApp Leads",
  delivery: "Delivery Log",
  messages: "WhatsApp Message Log",
  faq: "FAQ",
  queue: "Human Queue",
  historical: "Affiliate Assignments"
});

const HEADERS = Object.freeze({
  leads: [
    "username", "whatsapp_number", "conversation_id", "captured_at",
    "reply_1", "reply_2", "reply_3", "state", "opt_in_message_id",
    "opt_in_sent_at", "opted_in_at", "declined_at", "batch_number",
    "batch_reserved_at", "delivery_started_at", "files_expected",
    "files_sent", "files_delivered", "files_failed", "files_sent_at",
    "files_delivered_at", "posted_confirmed_at", "last_whatsapp_message_id",
    "last_inbound_at", "last_intent", "last_intent_confidence",
    "last_error", "updated_at", "wa_id", "last_inbound_message_id",
    "window_expires_at"
  ],
  delivery: [
    "delivery_key", "conversation_id", "whatsapp_number", "batch_number",
    "file_index", "file_name", "media_id", "whatsapp_message_id", "state",
    "attempts", "uploaded_at", "sent_at", "delivered_at", "failed_at",
    "last_error", "updated_at", "send_state", "delivery_state"
  ],
  messages: [
    "whatsapp_message_id", "recipient_number", "message_type",
    "template_name", "source_workflow", "source_reference", "api_status",
    "accepted_at", "current_status", "status_timestamp",
    "conversation_json", "pricing_json", "errors_json", "error_code",
    "error_title", "error_message", "error_details", "processed_statuses",
    "status_history_json", "updated_at", "direction",
    "message_payload_json", "send_state", "delivery_state"
  ],
  faq: [
    "intent", "description", "examples", "answer", "active", "min_confidence"
  ],
  queue: [
    "case_id", "created_at", "updated_at", "status", "reason",
    "conversation_id", "username", "whatsapp_number", "source_message_id",
    "message_text", "predicted_intent", "confidence", "batch_number",
    "delivery_step", "retry_count", "last_error", "assignee", "resolution"
  ]
});

function readEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return result;
}

const env = readEnv(path.join(ROOT, ".env"));
const CFG = Object.freeze({
  spreadsheetId: env.AFFILIATE_TRACKER_SPREADSHEET_ID,
  googleCredentialId:
    env.GOOGLE_SHEETS_CREDENTIAL_ID || "v62HRbwXmN6BRJqs",
  googleCredentialName:
    env.GOOGLE_SHEETS_CREDENTIAL_NAME || "Google Sheets account",
  whatsappCredentialId:
    env.WHATSAPP_HEADER_AUTH_CREDENTIAL_ID || "WHATSAPP_CLOUD_HEADER_AUTH",
  whatsappCredentialName:
    env.WHATSAPP_HEADER_AUTH_CREDENTIAL_NAME || "WhatsApp Cloud API token",
  graphVersion: env.WHATSAPP_GRAPH_API_VERSION || "v23.0"
});

const WHATSAPP_INTRO_MESSAGE = [
  "Halo Kak, terima kasih sudah bergabung sebagai Affiliate PROYA! 😊",
  "Berikut link video yang sudah kami siapkan",
  "",
  "Langkah Upload",
  "1. Download video",
  "2. Upload ke akun TikTok Kakak.",
  "3. Tambahkan keranjang kuning produk PROYA.",
  "",
  "Kalau ada pertanyaan atau butuh bantuan, silakan hubungi kami melalui WhatsApp",
  "",
  "Hal yang Perlu Diperhatikan",
  "✅ Mohon cantumkan @proya_official di bio akun TikTok agar terlihat bahwa Kakak bekerja sama dengan PROYA, sekaligus membantu mengurangi risiko konten dianggap tidak orisinal.",
  "✅ Video boleh diedit ringan, seperti menambahkan caption, subtitle, musik, atau potongan singkat. Namun mohon jangan mengubah isi atau konteks utama video, serta jangan menambahkan klaim yang tidak sesuai.",
  "✅ Untuk caption, mohon hindari klaim yang berlebihan seperti:",
  "- “Pasti putih”",
  "- “Menghilangkan jerawat permanen”",
  "- “Hasil instan”",
  "- Klaim medis lainnya",
  "Gunakan kalimat yang lebih aman seperti:",
  "- “Membantu merawat kulit”",
  "- “Membantu mencerahkan kulit”",
  "- “Cocok untuk perawatan harian”",
  "✅ Sebaiknya jangan mengunggah terlalu banyak video yang mirip dalam waktu berdekatan agar mengurangi risiko pembatasan atau pelanggaran konten tidak orisinal.",
  "",
  "Jika Mendapat Pelanggaran “Konten Tidak Orisinal”",
  "Silakan ajukan banding (Appeal) melalui TikTok dan sertakan screenshot percakapan kerja sama ini sebagai bukti bahwa Kakak telah mendapatkan izin dari PROYA untuk menggunakan materi video yang kami sediakan.",
  "",
  "Terima kasih sudah bekerja sama dengan PROYA! 😊",
  "",
  "Semoga video Kakak mendapatkan hasil yang bagus dan menghasilkan banyak komisi. Kami juga akan terus mengirimkan materi video terbaru untuk membantu meningkatkan penjualan Kakak."
].join("\n");

const WHATSAPP_OPT_IN_TEMPLATE_COPY = [
  "Halo Kak {{1}}! 😊",
  "",
  "PROYA ingin mengirimkan materi video affiliate TikTok melalui WhatsApp.",
  "",
  "Dengan menyetujui, Kakak bersedia menambahkan keranjang kuning PROYA, mencantumkan @proya_official di bio, tidak mengubah konteks video, tidak membuat klaim berlebihan atau medis, serta tidak mengunggah banyak video serupa secara berdekatan.",
  "",
  "Balas **“YA, SAYA SETUJU”** untuk menerima materi video PROYA secara berkala."
].join("\n");

if (!CFG.spreadsheetId) {
  throw new Error("AFFILIATE_TRACKER_SPREADSHEET_ID is required");
}

function uuid() {
  return crypto.randomUUID();
}

function node(name, type, typeVersion, position, parameters = {}, extra = {}) {
  return {
    parameters,
    id: uuid(),
    name,
    type,
    typeVersion,
    position,
    ...extra
  };
}

function code(name, position, jsCode) {
  return node(name, "n8n-nodes-base.code", 2, position, { jsCode });
}

function noOp(name, position) {
  return node(name, "n8n-nodes-base.noOp", 1, position, {});
}

function manual(name, position) {
  return node(name, "n8n-nodes-base.manualTrigger", 1, position, {});
}

function trigger(name, position) {
  return node(name, "n8n-nodes-base.executeWorkflowTrigger", 1.1, position, {
    inputSource: "passthrough"
  });
}

function workflowSelector(workflowId) {
  return {
    __rl: true,
    value: workflowId,
    mode: "list",
    cachedResultName: workflowId
  };
}

function execute(name, position, workflowId, wait = false) {
  return node(name, "n8n-nodes-base.executeWorkflow", 1.3, position, {
    source: "database",
    workflowId: workflowSelector(workflowId),
    mode: "once",
    options: { waitForSubWorkflow: wait }
  });
}

function ifNode(name, position, expression) {
  return node(name, "n8n-nodes-base.if", 2.3, position, {
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: "",
        typeValidation: "strict",
        version: 3
      },
      conditions: [{
        id: uuid(),
        leftValue: expression,
        rightValue: "",
        operator: {
          type: "boolean",
          operation: "true",
          singleValue: true
        }
      }],
      combinator: "and"
    },
    options: {}
  });
}

function webhook(name, position, method, route, responseMode, rawBody = false) {
  return node(
    name,
    "n8n-nodes-base.webhook",
    2.1,
    position,
    {
      httpMethod: method,
      path: route,
      responseMode,
      options: rawBody ? { rawBody: true } : {}
    },
    { webhookId: uuid() }
  );
}

function respond(name, position, statusCode, bodyExpression) {
  return node(name, "n8n-nodes-base.respondToWebhook", 1.4, position, {
    respondWith: "text",
    responseBody: bodyExpression,
    options: { responseCode: statusCode }
  });
}

function waitNode(name, position, seconds) {
  return node(name, "n8n-nodes-base.wait", 1.1, position, {
    amount: seconds,
    unit: "seconds"
  });
}

function google(name, position, parameters, extra = {}) {
  return node(
    name,
    "n8n-nodes-base.httpRequest",
    4.4,
    position,
    {
      authentication: "predefinedCredentialType",
      nodeCredentialType: "googleSheetsOAuth2Api",
      ...parameters
    },
    {
      credentials: {
        googleSheetsOAuth2Api: {
          id: CFG.googleCredentialId,
          name: CFG.googleCredentialName
        }
      },
      ...extra
    }
  );
}

function whatsapp(name, position, parameters, extra = {}) {
  return node(
    name,
    "n8n-nodes-base.httpRequest",
    4.4,
    position,
    {
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      ...parameters
    },
    {
      credentials: {
        httpHeaderAuth: {
          id: CFG.whatsappCredentialId,
          name: CFG.whatsappCredentialName
        }
      },
      ...extra
    }
  );
}

function http(name, position, parameters, extra = {}) {
  return node(name, "n8n-nodes-base.httpRequest", 4.4, position, parameters, extra);
}

function connect(outputs) {
  return {
    main: outputs.map((branch) =>
      branch.map((target) => ({ node: target, type: "main", index: 0 }))
    )
  };
}

function workflow(id, name, nodes, connections, settings = {}) {
  return {
    id,
    name,
    active: false,
    isArchived: false,
    nodes,
    connections,
    settings: {
      executionOrder: "v1",
      saveDataSuccessExecution: "none",
      saveDataErrorExecution: "all",
      saveManualExecutions: true,
      ...settings
    },
    staticData: null,
    meta: { templateCredsSetupCompleted: false },
    pinData: {},
    tags: []
  };
}

function loadCode(fileName) {
  return fs
    .readFileSync(path.join(ROOT, "n8n", "code", fileName), "utf8")
    .trim();
}

function sheetRange(sheetName, range) {
  return encodeURIComponent(`${sheetName}!${range}`);
}

function valuesUrl(sheetName, range) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${CFG.spreadsheetId}` +
    `/values/${sheetRange(sheetName, range)}`;
}

function appendUrl(sheetName, range) {
  return `${valuesUrl(sheetName, range)}:append` +
    "?valueInputOption=RAW&insertDataOption=INSERT_ROWS";
}

function updateRowsCode(sourceNodeName, statusExpression) {
  return String.raw`const HEADERS = ${JSON.stringify(HEADERS.leads)};
function text(value) { return value == null ? "" : String(value).trim(); }
const source = $(${JSON.stringify(sourceNodeName)}).first().json;
const values = Array.isArray($json.values) ? $json.values : [];
const rows = values.slice(1).map((row, index) => {
  const record = { row_number: index + 2 };
  HEADERS.forEach((name, column) => { record[name] = text(row[column]); });
  return record;
});
const current = rows.find((row) =>
  row.conversation_id === text(source.conversation_id)
);
if (!current) throw new Error("WhatsApp lead row not found");
const now = new Date().toISOString();
const changes = (${statusExpression});
const record = { ...current, ...changes, updated_at: now };
return [{ json: {
  ...source,
  ...record,
  row_number: current.row_number,
  row_values: HEADERS.map((name) => text(record[name]))
} }];`;
}

function updateLeadHttp(name, position, source = "$json") {
  return google(
    name,
    position,
    {
      method: "PUT",
      url:
        `=https://sheets.googleapis.com/v4/spreadsheets/${CFG.spreadsheetId}` +
        `/values/${encodeURIComponent(SHEETS.leads)}!A{{${source}.row_number}}%3AAE{{${source}.row_number}}` +
        "?valueInputOption=RAW",
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        `={{ JSON.stringify({ majorDimension: "ROWS", values: [${source}.row_values] }) }}`,
      options: {}
    },
    { retryOnFail: true, maxTries: 4, waitBetweenTries: 2000 }
  );
}

function queueHandoffCode(sourceNodeName, reasonExpression) {
  return String.raw`const source = $(${JSON.stringify(sourceNodeName)}).first().json;
return [{ json: {
  reason: ${reasonExpression},
  conversation_id: source.conversation_id || "",
  username: source.username || "",
  whatsapp_number: source.whatsapp_number || "",
  source_message_id: source.whatsapp_message_id || source.opt_in_message_id || "",
  message_text: source.message_text || "",
  predicted_intent: source.predicted_intent || "",
  confidence: source.confidence || "",
  batch_number: source.batch_number || "",
  delivery_step: source.delivery_step || "",
  retry_count: source.retry_count || 0,
  last_error: source.last_error || ""
} }];`;
}

function patchLeadCapture() {
  const filePath = path.join(IMPORTS, "affiliate-whatsapp-lead-capture.json");
  const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const read = existing.nodes.find((item) => item.name === "Read WhatsApp Leads");
  const prepare = existing.nodes.find((item) => item.name === "Prepare Lead Upsert");
  const update = existing.nodes.find((item) => item.name === "Update WhatsApp Lead");
  const append = existing.nodes.find((item) => item.name === "Append WhatsApp Lead");
  if (!read || !prepare || !update || !append) {
    throw new Error("Existing lead capture workflow shape changed");
  }

  read.parameters.url = valuesUrl(SHEETS.leads, "A:AE");
  prepare.parameters.jsCode = loadCode("prepare-distribution-lead-upsert.js");
  update.parameters.url =
    `=https://sheets.googleapis.com/v4/spreadsheets/${CFG.spreadsheetId}` +
    `/values/${encodeURIComponent(SHEETS.leads)}!A{{$json.row_number}}%3AAE{{$json.row_number}}` +
    "?valueInputOption=RAW";
  append.parameters.url = appendUrl(SHEETS.leads, "A:AE");

  const phase1Names = new Set([
    "Prepare WhatsApp Opt-in Handoff", "IF Needs WhatsApp Opt-in",
    "Dispatch WhatsApp Opt-in", "Done: Lead Captured"
  ]);
  existing.nodes = existing.nodes.filter((item) => !phase1Names.has(item.name));
  for (const name of phase1Names) delete existing.connections[name];

  const handoff = code(
    "Prepare WhatsApp Opt-in Handoff",
    [3060, -180],
    String.raw`const source = $("Prepare Lead Upsert").first().json;
return [{ json: {
  ...(source.record || {}),
  needs_opt_in: Boolean(source.needs_opt_in),
  lead_write_action: source.action
} }];`
  );
  const shouldSend = ifNode(
    "IF Needs WhatsApp Opt-in",
    [3280, -180],
    "={{ $json.needs_opt_in === true }}"
  );
  const send = execute(
    "Dispatch WhatsApp Opt-in",
    [3500, -300],
    IDS.optIn,
    false
  );
  const done = noOp("Done: Lead Captured", [3500, -60]);
  existing.nodes.push(handoff, shouldSend, send, done);
  existing.connections["Update WhatsApp Lead"] =
    connect([["Prepare WhatsApp Opt-in Handoff"]]);
  existing.connections["Append WhatsApp Lead"] =
    connect([["Prepare WhatsApp Opt-in Handoff"]]);
  existing.connections["Prepare WhatsApp Opt-in Handoff"] =
    connect([["IF Needs WhatsApp Opt-in"]]);
  existing.connections["IF Needs WhatsApp Opt-in"] =
    connect([["Dispatch WhatsApp Opt-in"], ["Done: Lead Captured"]]);
  existing.settings.callerPolicy = "workflowsFromAList";
  existing.settings.callerIds = "AfDriveRouter2026";
  return existing;
}

function buildQueueWorkflow() {
  const prepareCode = String.raw`const source = $("When Executed for Human Queue").first().json;
function text(value) { return value == null ? "" : String(value).trim(); }
const reason = text(source.reason || "manual_review");
const stable = text(source.source_message_id) ||
  [text(source.conversation_id), reason, text(source.batch_number)].join(":");
const caseId = (stable + ":" + reason).replace(/[^A-Za-z0-9:_-]/g, "_").slice(0, 180);
const values = Array.isArray($json.values) ? $json.values : [];
const exists = values.slice(1).some((row) => text(row[0]) === caseId);
const now = new Date().toISOString();
const record = {
  case_id: caseId,
  created_at: now,
  updated_at: now,
  status: "open",
  reason,
  conversation_id: text(source.conversation_id),
  username: text(source.username),
  whatsapp_number: text(source.whatsapp_number),
  source_message_id: text(source.source_message_id),
  message_text: text(source.message_text),
  predicted_intent: text(source.predicted_intent),
  confidence: text(source.confidence),
  batch_number: text(source.batch_number),
  delivery_step: text(source.delivery_step),
  retry_count: text(source.retry_count || 0),
  last_error: text(source.last_error),
  assignee: "",
  resolution: ""
};
return [{ json: {
  exists,
  record,
  row_values: ${JSON.stringify(HEADERS.queue)}.map((name) => text(record[name]))
} }];`;
  const nodes = [
    trigger("When Executed for Human Queue", [-700, 0]),
    google("Read Human Queue", [-480, 0], {
      url: valuesUrl(SHEETS.queue, "A:R"),
      options: {}
    }),
    code("Prepare Deduplicated Queue Case", [-260, 0], prepareCode),
    ifNode("IF New Queue Case", [-40, 0], "={{ !$json.exists }}"),
    google("Append Human Queue Case", [180, -100], {
      method: "POST",
      url: appendUrl(SHEETS.queue, "A:R"),
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        '={{ JSON.stringify({ majorDimension: "ROWS", values: [$json.row_values] }) }}',
      options: {}
    }, { retryOnFail: true, maxTries: 4, waitBetweenTries: 2000 }),
    noOp("Done: Queue Case Exists", [180, 100]),
    noOp("Done: Queue Case Appended", [400, -100])
  ];
  const connections = {
    "When Executed for Human Queue": connect([["Read Human Queue"]]),
    "Read Human Queue": connect([["Prepare Deduplicated Queue Case"]]),
    "Prepare Deduplicated Queue Case": connect([["IF New Queue Case"]]),
    "IF New Queue Case": connect([
      ["Append Human Queue Case"],
      ["Done: Queue Case Exists"]
    ]),
    "Append Human Queue Case": connect([["Done: Queue Case Appended"]])
  };
  return workflow(IDS.queue, "Affiliate Distribution - Human Queue", nodes, connections);
}

function buildOptInWorkflow() {
  const parseSend = String.raw`const source = $("When Executed after Lead Capture").first().json;
const response = $json || {};
const messageId = String(response.messages?.[0]?.id || "");
const failed = Boolean(response.error) || !messageId;
const errorCode = String(response.error?.code || response.error?.error_subcode || "");
const sendState = messageId ? "accepted" : errorCode ? "failed" : "outcome_uncertain";
return [{ json: {
  ...source,
  opt_in_success: !failed,
  opt_in_message_id: messageId,
  api_status: String(response.messages?.[0]?.message_status || "accepted"),
  last_error: failed
    ? String(response.error?.message || response.message || "whatsapp_template_send_failed")
    : ""
} }];`;
  const prepareUpdate = updateRowsCode(
    "Parse Opt-in Send Result",
    String.raw`source.opt_in_success
  ? {
      state: "opt_in_sent",
      opt_in_message_id: source.opt_in_message_id,
      opt_in_sent_at: now,
      last_error: ""
    }
  : {
      state: "failed",
      last_error: source.last_error || "whatsapp_template_send_failed"
    }`
  );
  const nodes = [
    trigger("When Executed after Lead Capture", [-900, 0]),
    ifNode(
      "IF Opt-in Still Required",
      [-680, 0],
      "={{ $json.needs_opt_in === true && $json.state === 'interested' }}"
    ),
    whatsapp("Send Approved Opt-in Template", [-460, -120], {
      method: "POST",
      url:
        `=https://graph.facebook.com/${CFG.graphVersion}/` +
        "{{$env.WHATSAPP_PHONE_NUMBER_ID}}/messages",
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: String($json.whatsapp_number || "").replace(/\\D/g, ""),
      type: "template",
      template: {
        name: $env.WHATSAPP_TEMPLATE_NAME || "affiliate_clip_opt_in_v1",
        language: { code: $env.WHATSAPP_TEMPLATE_LANGUAGE || "id" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: $json.username || "Kak" }
            ]
          }
        ]
      }
}) }}`,
      options: { response: { response: { neverError: true } } }
    }, {
      continueOnFail: true,
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 5000,
      notes: [
        "The Meta template configured by WHATSAPP_TEMPLATE_NAME must contain this exact body:",
        "",
        WHATSAPP_OPT_IN_TEMPLATE_COPY
      ].join("\n"),
      notesInFlow: false
    }),
    code("Parse Opt-in Send Result", [-240, -120], parseSend),
    ifNode("IF Register Opt-in Message", [-130, -120], "={{ $json.opt_in_success }}"),
    code("Prepare Opt-in Message Registration", [-20, -220], String.raw`const source = $("Parse Opt-in Send Result").first().json;
return [{ json: {
  ...source,
  registry_action: "register_send",
  whatsapp_message_id: source.opt_in_message_id,
  recipient_number: source.whatsapp_number,
  message_type: "template",
  template_name: "affiliate_clip_opt_in_v1",
  source_workflow: "${IDS.optIn}",
  source_reference: source.conversation_id || "",
  accepted_at: new Date().toISOString()
} }];`),
    execute("Store Opt-in Message ID", [200, -220], IDS.status, true),
    google("Read Leads after Opt-in Send", [-20, -120], {
      url: valuesUrl(SHEETS.leads, "A:AB"),
      options: {}
    }),
    code("Prepare Opt-in Lead Update", [200, -120], prepareUpdate),
    updateLeadHttp("Update Lead after Opt-in Send", [420, -120]),
    code(
      "Restore Opt-in Result after Lead Update",
      [640, -120],
      'return [{ json: $("Prepare Opt-in Lead Update").first().json }];'
    ),
    ifNode("IF Opt-in Send Failed", [860, -120], "={{ !$json.opt_in_success }}"),
    code(
      "Prepare Opt-in Failure Queue",
      [1080, -220],
      queueHandoffCode(
        "Restore Opt-in Result after Lead Update",
        '"whatsapp_opt_in_send_failed"'
      )
    ),
    execute("Queue Opt-in Failure", [1300, -220], IDS.queue, false),
    noOp("Done: Opt-in Sent", [1080, 0]),
    noOp("Stop: Opt-in Already Handled", [-460, 140])
  ];
  const connections = {
    "When Executed after Lead Capture": connect([["IF Opt-in Still Required"]]),
    "IF Opt-in Still Required": connect([
      ["Send Approved Opt-in Template"],
      ["Stop: Opt-in Already Handled"]
    ]),
    "Send Approved Opt-in Template": connect([["Parse Opt-in Send Result"]]),
    "Parse Opt-in Send Result": connect([["IF Register Opt-in Message"]]),
    "IF Register Opt-in Message": connect([
      ["Prepare Opt-in Message Registration"],
      ["Read Leads after Opt-in Send"]
    ]),
    "Prepare Opt-in Message Registration": connect([["Store Opt-in Message ID"]]),
    "Store Opt-in Message ID": connect([["Read Leads after Opt-in Send"]]),
    "Read Leads after Opt-in Send": connect([["Prepare Opt-in Lead Update"]]),
    "Prepare Opt-in Lead Update": connect([["Update Lead after Opt-in Send"]]),
    "Update Lead after Opt-in Send": connect([["Restore Opt-in Result after Lead Update"]]),
    "Restore Opt-in Result after Lead Update": connect([["IF Opt-in Send Failed"]]),
    "IF Opt-in Send Failed": connect([
      ["Prepare Opt-in Failure Queue"],
      ["Done: Opt-in Sent"]
    ]),
    "Prepare Opt-in Failure Queue": connect([["Queue Opt-in Failure"]])
  };
  return workflow(
    IDS.optIn,
    "Affiliate Distribution - WhatsApp Opt-in",
    nodes,
    connections,
    {
      callerPolicy: "workflowsFromAList",
      callerIds: IDS.processor
    }
  );
}

function buildWebhookVerifyWorkflow() {
  const nodes = [
    webhook(
      "WhatsApp Verification Webhook",
      [-520, 0],
      "GET",
      "whatsapp-callback",
      "responseNode"
    ),
    code(
      "Validate Verification Token",
      [-300, 0],
      String.raw`const query = $json.query || {};
return [{ json: {
  valid:
    String(query["hub.mode"] || "") === "subscribe" &&
    String(query["hub.verify_token"] || "") === String($env.WHATSAPP_VERIFY_TOKEN || ""),
  challenge: String(query["hub.challenge"] || "")
} }];`
    ),
    ifNode("IF Verification Valid", [-80, 0], "={{ $json.valid }}"),
    respond("Return Meta Challenge", [160, -100], 200, "={{ $json.challenge }}"),
    respond("Reject Verification", [160, 100], 403, "Forbidden")
  ];
  const connections = {
    "WhatsApp Verification Webhook": connect([["Validate Verification Token"]]),
    "Validate Verification Token": connect([["IF Verification Valid"]]),
    "IF Verification Valid": connect([
      ["Return Meta Challenge"],
      ["Reject Verification"]
    ])
  };
  return workflow(
    IDS.webhookVerify,
    "Affiliate Distribution - WhatsApp Webhook Verification",
    nodes,
    connections
  );
}

function buildWebhookRouterWorkflow() {
  const nodes = [
    webhook(
      "WhatsApp Events Webhook",
      [-600, 0],
      "POST",
      "whatsapp-callback",
      "onReceived",
      true
    ),
    code(
      "Verify and Parse WhatsApp Webhook",
      [-380, 0],
      loadCode("parse-whatsapp-webhook.js")
    ),
    ifNode(
      "IF Signature Valid",
      [-160, 0],
      "={{ $json.signature_valid === true }}"
    ),
    code(
      "Enforce Isolated Test Allow-list",
      [40, 0],
      String.raw`function text(value) { return value == null ? "" : String(value).trim(); }
function digits(value) { return text(value).replace(/\D/g, ""); }
const source = $input.first().json;
const testMode = text($env.WHATSAPP_TEST_MODE).toLowerCase() === "true";
let allowed = true;
if (testMode) {
  const recipient = digits(source.wa_id || source.whatsapp_number);
  const expectedRecipient = digits($env.WHATSAPP_TEST_RECIPIENT_NUMBER);
  const expectedUsername = text($env.WHATSAPP_TEST_AFFILIATE_USERNAME).replace(/^@+/, "").toLowerCase();
  const normalizedMessage = text(source.message_text).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
  const validTestIntent =
    normalizedMessage === "minat @" + expectedUsername ||
    normalizedMessage === "minat " + expectedUsername;
  allowed = recipient === expectedRecipient && (
    source.event_kind === "status" ||
    source.event_kind === "message" && source.message_type === "text" && validTestIntent
  );
}
return [{ json: { ...source, test_event_allowed: allowed } }];`
    ),
    ifNode(
      "IF Isolated Test Event Allowed",
      [260, 0],
      "={{ $json.test_event_allowed === true }}"
    ),
    ifNode(
      "IF Status Event",
      [60, -120],
      "={{ $json.event_kind === 'status' }}"
    ),
    noOp("Done: Status Sheet Logging Paused", [280, -220]),
    ifNode(
      "IF Message Event",
      [280, -40],
      "={{ $json.event_kind === 'message' }}"
    ),
    execute("Process WhatsApp Event", [500, -80], IDS.reply, false),
    noOp("Done: Ignored Webhook Event", [500, 40]),
    noOp("Done: Invalid Signature Ignored", [60, 120])
  ];
  const connections = {
    "WhatsApp Events Webhook": connect([["Verify and Parse WhatsApp Webhook"]]),
    "Verify and Parse WhatsApp Webhook": connect([["IF Signature Valid"]]),
    "IF Signature Valid": connect([
      ["Enforce Isolated Test Allow-list"],
      ["Done: Invalid Signature Ignored"]
    ]),
    "Enforce Isolated Test Allow-list": connect([["IF Isolated Test Event Allowed"]]),
    "IF Isolated Test Event Allowed": connect([
      ["IF Status Event"],
      ["Done: Ignored Webhook Event"]
    ]),
    "IF Status Event": connect([
      ["Done: Status Sheet Logging Paused"],
      ["IF Message Event"]
    ]),
    "IF Message Event": connect([
      ["Process WhatsApp Event"],
      ["Done: Ignored Webhook Event"]
    ])
  };
  return workflow(
    IDS.webhookRouter,
    "Affiliate Distribution - WhatsApp Webhook Router",
    nodes,
    connections,
    {
      saveDataSuccessExecution: "all",
      saveDataErrorExecution: "all"
    }
  );
}

function buildStatusWorkflow() {
  const nodes = [
    trigger("When Executed by Webhook Router", [-900, 0]),
    ifNode(
      "IF Register Sent Message",
      [-680, 0],
      "={{ $json.registry_action === 'register_send' }}"
    ),
    google("Read Message Log for Registration", [-460, -300], {
      url: valuesUrl(SHEETS.messages, "A:T"),
      options: {}
    }),
    code(
      "Prepare Sent Message Registration",
      [-240, -300],
      loadCode("prepare-whatsapp-send-registration.js")
    ),
    ifNode(
      "IF Append Message Registration",
      [-20, -300],
      "={{ $json.registration_valid && !$json.message_record_exists }}"
    ),
    google("Append WhatsApp Message Registration", [200, -380], {
      method: "POST",
      url: appendUrl(SHEETS.messages, "A:T"),
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        '={{ JSON.stringify({ majorDimension: "ROWS", values: [$json.message_row_values] }) }}',
      options: {}
    }, { retryOnFail: true, maxTries: 4, waitBetweenTries: 2000 }),
    noOp("Message Registration Already Stored", [200, -220]),
    code(
      "Return Sent Message Registration",
      [420, -300],
      'return [{ json: $("When Executed by Webhook Router").first().json }];'
    ),
    node(
      "Loop Through Status Events",
      "n8n-nodes-base.splitInBatches",
      3,
      [-460, 80],
      { batchSize: 1, options: {} }
    ),
    google("Read WhatsApp Message Log", [-460, -100], {
      url: valuesUrl(SHEETS.messages, "A:T"),
      options: {}
    }),
    code(
      "Prepare Message Status Update",
      [-240, -100],
      loadCode("prepare-whatsapp-status-update.js")
    ),
    ifNode(
      "IF Message Record Found",
      [-20, -100],
      "={{ $json.message_record_found }}"
    ),
    ifNode(
      "IF Duplicate Status",
      [200, -180],
      "={{ $json.duplicate_status }}"
    ),
    google("Update WhatsApp Message Log", [420, -260], {
      method: "PUT",
      url:
        `=https://sheets.googleapis.com/v4/spreadsheets/${CFG.spreadsheetId}` +
        `/values/${encodeURIComponent(SHEETS.messages)}!A{{$json.message_row_number}}%3AT{{$json.message_row_number}}` +
        "?valueInputOption=RAW",
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        '={{ JSON.stringify({ majorDimension: "ROWS", values: [$json.message_row_values] }) }}',
      options: {}
    }, { retryOnFail: true, maxTries: 4, waitBetweenTries: 2000 }),
    ifNode(
      "IF Failed Status",
      [640, -260],
      "={{ $(\"Prepare Message Status Update\").item.json.status_is_failed }}"
    ),
    noOp("Done: Failure Details Stored", [860, -340]),
    noOp("Done: Status Stored", [860, -220]),
    noOp("Done: Duplicate Status Ignored", [420, -100]),
    noOp("Done: Unknown Wamid", [200, 20]),
    code(
      "Restore Status Event for Delivery",
      [1080, -100],
      'return [{ json: $("Loop Through Status Events").item.json }];'
    ),
    execute("Process Existing Delivery Status", [1300, -100], IDS.reply, true),
    noOp("Done: All Status Events Processed", [-460, 120])
  ];
  const connections = {
    "When Executed by Webhook Router": connect([["IF Register Sent Message"]]),
    "IF Register Sent Message": connect([
      ["Read Message Log for Registration"],
      ["Loop Through Status Events"]
    ]),
    "Read Message Log for Registration": connect([["Prepare Sent Message Registration"]]),
    "Prepare Sent Message Registration": connect([["IF Append Message Registration"]]),
    "IF Append Message Registration": connect([
      ["Append WhatsApp Message Registration"],
      ["Message Registration Already Stored"]
    ]),
    "Append WhatsApp Message Registration": connect([["Return Sent Message Registration"]]),
    "Message Registration Already Stored": connect([["Return Sent Message Registration"]]),
    "Loop Through Status Events": {
      main: [
        [{ node: "Done: All Status Events Processed", type: "main", index: 0 }],
        [{ node: "Read WhatsApp Message Log", type: "main", index: 0 }]
      ]
    },
    "Read WhatsApp Message Log": connect([["Prepare Message Status Update"]]),
    "Prepare Message Status Update": connect([["IF Message Record Found"]]),
    "IF Message Record Found": connect([
      ["IF Duplicate Status"],
      ["Done: Unknown Wamid"]
    ]),
    "IF Duplicate Status": connect([
      ["Done: Duplicate Status Ignored"],
      ["Update WhatsApp Message Log"]
    ]),
    "Update WhatsApp Message Log": connect([["IF Failed Status"]]),
    "IF Failed Status": connect([
      ["Done: Failure Details Stored"],
      ["Done: Status Stored"]
    ]),
    "Done: Failure Details Stored": connect([["Restore Status Event for Delivery"]]),
    "Done: Status Stored": connect([["Restore Status Event for Delivery"]]),
    "Done: Duplicate Status Ignored": connect([["Restore Status Event for Delivery"]]),
    "Done: Unknown Wamid": connect([["Restore Status Event for Delivery"]]),
    "Restore Status Event for Delivery": connect([["Process Existing Delivery Status"]]),
    "Process Existing Delivery Status": {
      main: [[{ node: "Loop Through Status Events", type: "main", index: 0 }]]
    }
  };
  return workflow(
    IDS.status,
    "Affiliate Distribution - WhatsApp Status Registry",
    nodes,
    connections,
    {
      callerPolicy: "any",
      saveDataErrorExecution: "none"
    }
  );
}

function buildReplyWorkflow() {
  const prepareMessageUpdate = updateRowsCode(
    "Route WhatsApp Message",
    String.raw`source.action === "opted_in"
  ? {
      state: "opted_in",
      opted_in_at: current.opted_in_at || now,
      last_whatsapp_message_id: source.whatsapp_message_id,
      last_inbound_at: source.inbound_at,
      last_error: ""
    }
  : source.action === "declined"
    ? {
        state: "declined",
        declined_at: now,
        last_whatsapp_message_id: source.whatsapp_message_id,
        last_inbound_at: source.inbound_at,
        last_error: ""
      }
    : source.action === "posted_confirmed"
      ? {
          state: "posted_confirmed",
          posted_confirmed_at: now,
          last_whatsapp_message_id: source.whatsapp_message_id,
          last_inbound_at: source.inbound_at,
          last_intent: "posted_confirmed",
          last_intent_confidence: "1",
          last_error: ""
        }
      : {
          last_whatsapp_message_id: source.whatsapp_message_id,
          last_inbound_at: source.inbound_at
        }`
  );
  const prepareFaq = String.raw`function text(value) { return value == null ? "" : String(value).trim(); }
const source = $("Route WhatsApp Message").first().json;
const values = Array.isArray($json.values) ? $json.values : [];
const rows = values.slice(1).map((row) => ({
  intent: text(row[0]),
  description: text(row[1]),
  examples: text(row[2]),
  answer: text(row[3]),
  active: text(row[4]),
  min_confidence: text(row[5])
}));
const active = rows.filter((row) =>
  row.intent &&
  row.answer &&
  ["true", "yes", "1", "active"].includes(row.active.toLowerCase())
);
const catalog = active.map((row) => ({
  intent: row.intent,
  description: row.description,
  examples: row.examples
}));
return [{ json: {
  ...source,
  active_faq_rows: active,
  has_active_faq: active.length > 0,
  lm_messages: [
    {
      role: "system",
      content:
        "Classify the affiliate message into exactly one allowed intent. " +
        "Do not answer the user. Return only JSON matching the supplied schema. " +
        "Allowed intents: " + JSON.stringify(catalog)
    },
    { role: "user", content: source.message_text || "" }
  ]
} }];`;
  const parseStatus = String.raw`const source = $("Match WhatsApp Lead").item.json;
const values = Array.isArray($json.values) ? $json.values : [];
const rows = values.slice(1);
const index = rows.findIndex((row) =>
  String(row[7] || "") === String(source.whatsapp_message_id || "")
);
if (index < 0) return [{ json: {
  ...source,
  status_log_found: false,
  delivery_update_needed: false
} }];
const row = rows[index];
const now = new Date().toISOString();
const status = String(source.delivery_status || "").toLowerCase();
const currentState = String(row[8] || "").toLowerCase();
const nextState = status === "failed" ? "failed"
  : status === "delivered" || status === "read" ? "delivered"
  : status === "sent" ? "sent"
  : currentState;
const rank = { "": 0, sent: 1, delivered: 2, failed: 3 };
const deliveryUpdateNeeded =
  nextState === "failed" || (rank[nextState] || 0) > (rank[currentState] || 0);
if (!deliveryUpdateNeeded) return [{ json: {
  ...source,
  conversation_id: String(row[1] || source.conversation_id || ""),
  batch_number: String(row[3] || source.batch_number || ""),
  status_log_found: true,
  delivery_update_needed: false
} }];
row[8] = nextState;
if (status === "failed") row[16] = "failed";
if (["sent", "delivered", "read"].includes(status)) row[16] = "sent";
if (status === "delivered") row[17] = "delivered";
if (status === "read") row[17] = "read";
if (nextState === "delivered") row[12] = now;
if (nextState === "failed") row[13] = now;
row[14] = source.last_error || row[14] || "";
row[15] = now;
return [{ json: {
  ...source,
  conversation_id: String(row[1] || source.conversation_id || ""),
  batch_number: String(row[3] || source.batch_number || ""),
  status_log_found: true,
  delivery_update_needed: true,
  delivery_row_number: index + 2,
  delivery_row_values: row
} }];`;
  const aggregateStatus = String.raw`const source = $("Prepare Delivery Status Update").first().json;
const values = Array.isArray($json.values) ? $json.values : [];
const text = (value) => value == null ? "" : String(value).trim();
const headers = (values[0] || []).map(text);
const rows = values.slice(1).map((row) => Object.fromEntries(headers.map((name, column) => [name, text(row[column])]))).filter((row) =>
  row.conversation_id === text(source.conversation_id) && row.batch_number === text(source.batch_number)
);
const rank = { failed: 1, accepted: 2, sent: 3, delivered: 4, read: 5 };
const byKey = new Map();
for (const row of rows) {
  if (!row.delivery_key) continue;
  const status = row.delivery_state || row.state || row.send_state;
  const current = byKey.get(row.delivery_key);
  if (!current || (rank[status] || 0) > (rank[current] || 0)) byKey.set(row.delivery_key, status);
}
const statuses = [...byKey.values()];
const sent = statuses.filter((status) => ["sent", "delivered", "read"].includes(status)).length;
const delivered = statuses.filter((status) => ["delivered", "read"].includes(status)).length;
const failed = statuses.filter((status) => status === "failed").length;
const expected = String(source.batch_number || "") === "TEST" &&
  String($env.WHATSAPP_TEST_MODE || "").toLowerCase() === "true" ? 1 : 15;
return [{ json: {
  ...source,
  files_expected: expected,
  files_sent: sent,
  files_delivered: delivered,
  files_failed: failed,
  aggregate_state: delivered === expected ? "files_delivered"
    : sent === expected ? "files_sent"
    : failed > 0 ? "failed"
    : "delivery_in_progress"
} }];`;
  const prepareAggregateLead = updateRowsCode(
    "Aggregate Delivery Status",
    String.raw`{
  state: source.aggregate_state,
  files_expected: String(source.files_expected),
  files_sent: String(source.files_sent),
  files_delivered: String(source.files_delivered),
  files_failed: String(source.files_failed),
  files_sent_at:
    source.files_sent === source.files_expected ? (current.files_sent_at || now) : current.files_sent_at,
  files_delivered_at:
    source.files_delivered === source.files_expected
      ? (current.files_delivered_at || now)
      : current.files_delivered_at,
  last_error: source.last_error || current.last_error
}`
  );

  const nodes = [
    trigger("When Executed by Webhook Router", [-1200, 0]),
    google("Read WhatsApp Leads for Event", [-980, 0], {
      url: valuesUrl(SHEETS.leads, "A:AB"),
      options: {}
    }),
    code("Match WhatsApp Lead", [-760, 0], loadCode("match-whatsapp-lead.js")),
    ifNode("IF Lead Match Failed", [-540, 0], "={{ $json.route === 'queue' }}"),
    code(
      "Prepare Lead Match Queue",
      [-320, -260],
      queueHandoffCode("Match WhatsApp Lead", "$json.queue_reason")
    ),
    execute("Queue Lead Match Failure", [-100, -260], IDS.queue, false),
    ifNode("IF Delivery Status Event", [-320, 40], "={{ $json.route === 'status' }}"),
    google("Read Delivery Log for Status", [-100, -40], {
      url: valuesUrl(SHEETS.delivery, "A:P"),
      options: {}
    }),
    code("Prepare Delivery Status Update", [120, -40], parseStatus),
    ifNode(
      "IF Delivery Status Matched",
      [340, -40],
      "={{ $json.status_log_found && $json.delivery_update_needed }}"
    ),
    google("Update Delivery Log Status", [560, -120], {
      method: "PUT",
      url:
        `=https://sheets.googleapis.com/v4/spreadsheets/${CFG.spreadsheetId}` +
        `/values/${encodeURIComponent(SHEETS.delivery)}!A{{$json.delivery_row_number}}%3AR{{$json.delivery_row_number}}` +
        "?valueInputOption=RAW",
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        '={{ JSON.stringify({ majorDimension: "ROWS", values: [$json.delivery_row_values] }) }}',
      options: {}
    }, { retryOnFail: true, maxTries: 4, waitBetweenTries: 2000 }),
    noOp("Done: Unknown Status Message", [560, 40]),
    google("Read Delivery Log after Status", [780, -120], {
      url: valuesUrl(SHEETS.delivery, "A:P"),
      options: {}
    }),
    code("Aggregate Delivery Status", [1000, -120], aggregateStatus),
    google("Read Leads for Delivery Aggregate", [1220, -120], {
      url: valuesUrl(SHEETS.leads, "A:AB"),
      options: {}
    }),
    code("Prepare Delivery Aggregate Lead Update", [1440, -120], prepareAggregateLead),
    updateLeadHttp("Update Lead Delivery Aggregate", [1660, -120]),
    noOp("Done: Delivery Status Updated", [1880, -120]),
    code("Route WhatsApp Message", [-100, 180], loadCode("route-whatsapp-message.js")),
    ifNode("IF FAQ Classification Needed", [120, 180], "={{ $json.action === 'classify' }}"),
    google("Read FAQ Catalog", [340, 100], {
      url: valuesUrl(SHEETS.faq, "A:F"),
      options: {}
    }),
    code("Prepare FAQ Classification", [560, 100], prepareFaq),
    ifNode("IF Active FAQ Exists", [780, 100], "={{ $json.has_active_faq }}"),
    http("Classify with Local Qwen", [1000, 20], {
      method: "POST",
      url: "={{ ($env.LM_STUDIO_BASE_URL || 'http://host.docker.internal:1234/v1') + '/chat/completions' }}",
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify({
  model: $env.LM_STUDIO_MODEL || "qwen/qwen3.6-27b",
  temperature: 0,
  max_tokens: 120,
  messages: $json.lm_messages,
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "affiliate_intent",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          intent: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: ["intent", "confidence"]
      }
    }
  }
}) }}`,
      options: { timeout: 30000, response: { response: { neverError: true } } }
    }, { continueOnFail: true }),
    code("Parse FAQ Classification", [1220, 20], loadCode("parse-faq-classification.js")),
    ifNode("IF FAQ Auto-reply Allowed", [1440, 20], "={{ $json.faq_action === 'reply' }}"),
    whatsapp("Send Approved FAQ Answer", [1660, -40], {
      method: "POST",
      url:
        `=https://graph.facebook.com/${CFG.graphVersion}/` +
        "{{$env.WHATSAPP_PHONE_NUMBER_ID}}/messages",
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: String($json.whatsapp_number || "").replace(/\\D/g, ""),
  type: "text",
  text: { preview_url: false, body: $json.faq_answer }
}) }}`,
      options: { response: { response: { neverError: true } } }
    }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 }),
    code(
      "Prepare FAQ Escalation",
      [1660, 100],
      queueHandoffCode("Parse FAQ Classification", "$json.queue_reason")
    ),
    execute("Queue FAQ Escalation", [1880, 100], IDS.queue, false),
    code(
      "Prepare Empty FAQ Escalation",
      [1000, 180],
      queueHandoffCode("Prepare FAQ Classification", '"empty_faq_catalog"')
    ),
    execute("Queue Empty FAQ", [1220, 180], IDS.queue, false),
    google("Read Leads for Message State", [340, 300], {
      url: valuesUrl(SHEETS.leads, "A:AB"),
      options: {}
    }),
    code("Prepare Message State Update", [560, 300], prepareMessageUpdate),
    updateLeadHttp("Update Lead Message State", [780, 300]),
    code(
      "Restore Message State after Lead Update",
      [1000, 300],
      'return [{ json: $("Prepare Message State Update").first().json }];'
    ),
    ifNode("IF Start File Delivery", [1220, 300], "={{ $json.action === 'opted_in' }}"),
    execute("Start Resumable File Delivery", [1440, 260], IDS.delivery, false),
    ifNode("IF Send Posted Acknowledgment", [1440, 380], "={{ $json.action === 'posted_confirmed' }}"),
    whatsapp("Send Posted Confirmation", [1660, 340], {
      method: "POST",
      url:
        `=https://graph.facebook.com/${CFG.graphVersion}/` +
        "{{$env.WHATSAPP_PHONE_NUMBER_ID}}/messages",
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: String($json.whatsapp_number || "").replace(/\\D/g, ""),
  type: "text",
  text: {
    preview_url: false,
    body: "Terima kasih kak, konfirmasi postingnya sudah kami catat."
  }
}) }}`,
      options: {}
    }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 }),
    noOp("Done: Message State Updated", [1660, 460])
  ];

  const connections = {
    "When Executed by Webhook Router": connect([["Read WhatsApp Leads for Event"]]),
    "Read WhatsApp Leads for Event": connect([["Match WhatsApp Lead"]]),
    "Match WhatsApp Lead": connect([["IF Lead Match Failed"]]),
    "IF Lead Match Failed": connect([
      ["Prepare Lead Match Queue"],
      ["IF Delivery Status Event"]
    ]),
    "Prepare Lead Match Queue": connect([["Queue Lead Match Failure"]]),
    "IF Delivery Status Event": connect([
      ["Read Delivery Log for Status"],
      ["Route WhatsApp Message"]
    ]),
    "Read Delivery Log for Status": connect([["Prepare Delivery Status Update"]]),
    "Prepare Delivery Status Update": connect([["IF Delivery Status Matched"]]),
    "IF Delivery Status Matched": connect([
      ["Update Delivery Log Status"],
      ["Done: Unknown Status Message"]
    ]),
    "Update Delivery Log Status": connect([["Read Delivery Log after Status"]]),
    "Read Delivery Log after Status": connect([["Aggregate Delivery Status"]]),
    "Aggregate Delivery Status": connect([["Read Leads for Delivery Aggregate"]]),
    "Read Leads for Delivery Aggregate": connect([
      ["Prepare Delivery Aggregate Lead Update"]
    ]),
    "Prepare Delivery Aggregate Lead Update": connect([
      ["Update Lead Delivery Aggregate"]
    ]),
    "Update Lead Delivery Aggregate": connect([["Done: Delivery Status Updated"]]),
    "Route WhatsApp Message": connect([["IF FAQ Classification Needed"]]),
    "IF FAQ Classification Needed": connect([
      ["Read FAQ Catalog"],
      ["Read Leads for Message State"]
    ]),
    "Read FAQ Catalog": connect([["Prepare FAQ Classification"]]),
    "Prepare FAQ Classification": connect([["IF Active FAQ Exists"]]),
    "IF Active FAQ Exists": connect([
      ["Classify with Local Qwen"],
      ["Prepare Empty FAQ Escalation"]
    ]),
    "Classify with Local Qwen": connect([["Parse FAQ Classification"]]),
    "Parse FAQ Classification": connect([["IF FAQ Auto-reply Allowed"]]),
    "IF FAQ Auto-reply Allowed": connect([
      ["Send Approved FAQ Answer"],
      ["Prepare FAQ Escalation"]
    ]),
    "Prepare FAQ Escalation": connect([["Queue FAQ Escalation"]]),
    "Prepare Empty FAQ Escalation": connect([["Queue Empty FAQ"]]),
    "Read Leads for Message State": connect([["Prepare Message State Update"]]),
    "Prepare Message State Update": connect([["Update Lead Message State"]]),
    "Update Lead Message State": connect([["Restore Message State after Lead Update"]]),
    "Restore Message State after Lead Update": connect([["IF Start File Delivery"]]),
    "IF Start File Delivery": connect([
      ["Start Resumable File Delivery"],
      ["IF Send Posted Acknowledgment"]
    ]),
    "IF Send Posted Acknowledgment": connect([
      ["Send Posted Confirmation"],
      ["Done: Message State Updated"]
    ])
  };
  return workflow(
    IDS.reply,
    "Affiliate Distribution - WhatsApp Reply and Status",
    nodes,
    connections,
    {
      callerPolicy: "workflowsFromAList",
      callerIds: `${IDS.webhookRouter},${IDS.status}`
    }
  );
}

function buildDeliveryWorkflow() {
  const confirmReservation = String.raw`const source = $("Select and Prepare Batch Reservation").first().json;
const values = Array.isArray($json.values) ? $json.values : [];
const rows = values.slice(1).map((row, index) => ({
  row_number: index + 2,
  conversation_id: String(row[2] || ""),
  batch_number: String(row[12] || ""),
  batch_reserved_at: String(row[13] || "")
}));
const candidates = rows
  .filter((row) =>
    row.batch_number === String(source.batch_number) &&
    row.batch_reserved_at
  )
  .sort((a, b) => {
    const difference = Date.parse(a.batch_reserved_at) - Date.parse(b.batch_reserved_at);
    return difference || a.conversation_id.localeCompare(b.conversation_id);
  });
const winner = candidates[0];
return [{ json: {
  ...source,
  reservation_won: Boolean(
    winner && winner.conversation_id === String(source.conversation_id)
  ),
  queue_reason: winner ? "duplicate_reservation_lost" : "reservation_missing"
} }];`;
  const parseUpload = String.raw`const source = $("Loop Through Files").item;
const response = $json || {};
const mediaId = String(response.id || "");
const failed = Boolean(response.error) || !mediaId;
return [{
  json: {
    ...source.json,
    media_id: mediaId,
    upload_success: !failed,
    last_error: failed
      ? String(response.error?.message || response.message || "media_upload_failed")
      : "",
    uploaded_at: failed ? "" : new Date().toISOString()
  },
  binary: source.binary
}];`;
  const parseSend = String.raw`const source = $("Parse Media Upload").first().json;
const response = $json || {};
const messageId = String(response.messages?.[0]?.id || "");
const errorCode = String(response.error?.code || response.error?.error_subcode || "");
const failed = Boolean(response.error) || !messageId;
const sendState = messageId ? "accepted" : errorCode ? "failed" : "outcome_uncertain";
const now = new Date().toISOString();
const record = {
  delivery_key: source.delivery_key,
  conversation_id: source.conversation_id,
  whatsapp_number: source.whatsapp_number,
  batch_number: source.batch_number,
  file_index: source.file_index,
  file_name: source.file_name,
  media_id: source.media_id,
  whatsapp_message_id: messageId,
  state: sendState,
  attempts: source.attempts || 1,
  uploaded_at: source.uploaded_at,
  sent_at: failed ? "" : now,
  delivered_at: "",
  failed_at: failed ? now : "",
  last_error: failed
    ? String(response.error?.message || response.message || "media_send_failed")
    : "",
  updated_at: now,
  send_state: sendState,
  delivery_state: ""
};
const headers = ${JSON.stringify(HEADERS.delivery)};
return [{ json: {
  ...source,
  send_success: !failed,
  whatsapp_message_id: messageId,
  api_status: String(response.messages?.[0]?.message_status || "accepted"),
  send_state: sendState,
  error_code: errorCode,
  state: record.state,
  last_error: record.last_error,
  delivery_row_values: headers.map((name) =>
    record[name] == null ? "" : String(record[name])
  )
} }];`;
  const aggregate = String.raw`const source = $("Confirm Reservation Winner").first().json;
const values = Array.isArray($json.values) ? $json.values : [];
const text = (value) => value == null ? "" : String(value).trim();
const headers = (values[0] || []).map(text);
const rows = values.slice(1).map((row) => Object.fromEntries(headers.map((name, column) => [name, text(row[column])]))).filter((row) =>
  row.conversation_id === text(source.conversation_id) && row.batch_number === text(source.batch_number)
);
const rank = { failed: 1, accepted: 2, sent: 3, delivered: 4, read: 5 };
const byKey = new Map();
for (const row of rows) {
  if (!row.delivery_key) continue;
  const status = row.delivery_state || row.state || row.send_state;
  const current = byKey.get(row.delivery_key);
  if (!current || (rank[status] || 0) > (rank[current] || 0)) byKey.set(row.delivery_key, status);
}
const statuses = [...byKey.values()];
const sent = statuses.filter((status) => ["sent", "delivered", "read"].includes(status)).length;
const delivered = statuses.filter((status) => ["delivered", "read"].includes(status)).length;
const failed = statuses.filter((status) => status === "failed").length;
const expected = String(source.batch_number || "") === "TEST" &&
  String($env.WHATSAPP_TEST_MODE || "").toLowerCase() === "true" ? 1 : 15;
return [{ json: {
  ...source,
  files_expected: expected,
  files_sent: sent,
  files_delivered: delivered,
  files_failed: failed,
  final_send_state: sent === expected ? "files_sent"
    : failed > 0 ? "failed"
    : "delivery_in_progress"
} }];`;
  const prepareFinalLead = updateRowsCode(
    "Summarize Delivery Send",
    String.raw`{
  state: source.final_send_state,
  files_expected: String(source.files_expected),
  files_sent: String(source.files_sent),
  files_delivered: String(source.files_delivered),
  files_failed: String(source.files_failed),
  files_sent_at:
    source.files_sent === source.files_expected ? (current.files_sent_at || now) : current.files_sent_at,
  last_error:
    source.files_failed > 0 ? "one_or_more_media_messages_failed" : ""
}`
  );

  const nodes = [
    trigger("When Executed after Opt-in", [-1500, 0]),
    google("Read WhatsApp Leads for Reservation", [-1280, 0], {
      url: valuesUrl(SHEETS.leads, "A:AB"),
      options: {}
    }),
    google("Read Historical Assignments", [-1060, 0], {
      url: valuesUrl(SHEETS.historical, "A:M"),
      options: {}
    }),
    node("List Local Batch Folders", "n8n-nodes-base.executeCommand", 1, [-840, 0], {
      command:
        "find /clips_whatsapp -mindepth 1 -maxdepth 1 -type d -exec basename {} \\; | sort -n"
    }),
    code(
      "Select and Prepare Batch Reservation",
      [-620, 0],
      loadCode("select-local-batch.js")
    ),
    ifNode("IF Batch Available", [-400, 0], "={{ $json.reservation_ok }}"),
    updateLeadHttp("Reserve Batch in Leads", [-180, -100]),
    code(
      "Prepare No Batch Queue",
      [-180, 120],
      queueHandoffCode(
        "Select and Prepare Batch Reservation",
        "$json.queue_reason"
      )
    ),
    execute("Queue No Batch", [40, 120], IDS.queue, false),
    waitNode("Wait for Reservation Settle", [40, -100], 1),
    google("Reread Leads after Reservation", [260, -100], {
      url: valuesUrl(SHEETS.leads, "A:AB"),
      options: {}
    }),
    code("Confirm Reservation Winner", [480, -100], confirmReservation),
    ifNode("IF Reservation Won", [700, -100], "={{ $json.reservation_won }}"),
    google("Read Delivery Log for Resume", [920, -180], {
      url: valuesUrl(SHEETS.delivery, "A:P"),
      options: {}
    }),
    google("Read Message Log for Resume", [1040, -180], {
      url: valuesUrl(SHEETS.messages, "A:X"),
      options: {}
    }),
    code(
      "Restore and Validate Delivery Context",
      [1160, -180],
      loadCode("restore-delivery-context.js")
    ),
    node("Validate Assigned Folder", "n8n-nodes-base.executeCommand", 1, [1280, -180], {
      command: "={{ $('Restore and Validate Delivery Context').first().json.test_mode ? 'set -eu; file=\"' + $('Restore and Validate Delivery Context').first().json.resolved_folder_path + '\"; test -f \"$file\"; printf \"OK\\t%s\\t1\" \"$file\"' : 'set -eu; folder=\"' + $('Restore and Validate Delivery Context').first().json.resolved_folder_path + '\"; test -d \"$folder\"; count=$(find \"$folder\" -maxdepth 1 -type f -iname \"*.mp4\" | wc -l); test \"$count\" -eq ' + $('Restore and Validate Delivery Context').first().json.expected_clip_count + '; printf \"OK\\t%s\\t%s\" \"$folder\" \"$count\"' }}"
    }),
    code(
      "Confirm Assigned Folder Validation",
      [1400, -180],
      loadCode("confirm-delivery-folder.js")
    ),
    code(
      "Prepare Reservation Lost Queue",
      [920, 20],
      queueHandoffCode("Confirm Reservation Winner", "$json.queue_reason")
    ),
    execute("Queue Reservation Conflict", [1140, 20], IDS.queue, false),
    node(
      "Read Assigned MP4 Files",
      "n8n-nodes-base.readWriteFile",
      1.1,
      [1140, -180],
      {
        operation: "read",
        fileSelector: "={{ $('Restore and Validate Delivery Context').first().json.test_mode ? $('Restore and Validate Delivery Context').first().json.resolved_folder_path : $('Restore and Validate Delivery Context').first().json.resolved_folder_path + '/*.mp4' }}",
        options: {}
      }
    ),
    code(
      "Prepare Resumable Delivery Items",
      [1360, -180],
      loadCode("prepare-delivery-items.js")
    ),
    node(
      "Loop Through Files",
      "n8n-nodes-base.splitInBatches",
      3,
      [1580, -180],
      { batchSize: 1, options: {} }
    ),
    ifNode(
      "IF Intro Before First Video",
      [1800, -180],
      "={{ Number($json.file_index) === 1 }}"
    ),
    whatsapp("Send WhatsApp Intro Message", [2020, -100], {
      method: "POST",
      url:
        `=https://graph.facebook.com/${CFG.graphVersion}/` +
        "{{$env.WHATSAPP_PHONE_NUMBER_ID}}/messages",
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: String($json.whatsapp_number || "").replace(/\\D/g, ""),
  type: "text",
  text: {
    preview_url: false,
    body: ${JSON.stringify(WHATSAPP_INTRO_MESSAGE)}
  }
}) }}`,
      options: { response: { response: { neverError: true } } }
    }, { continueOnFail: true, retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 }),
    code(
      "Restore Intro Result before Video",
      [2240, -100],
      String.raw`const source = $("Loop Through Files").item;
const response = $json || {};
const messageId = String(response.messages?.[0]?.id || "");
if (Boolean(response.error) || !messageId) {
  throw new Error(String(response.error?.message || response.message || "whatsapp_intro_send_failed"));
}
return [{
  json: {
    ...source.json,
    intro_message_id: messageId,
    intro_api_status: String(response.messages?.[0]?.message_status || "accepted")
  },
  binary: source.binary
}];`
    ),
    code("Prepare Intro Message Registration", [2350, -100], String.raw`const source = $("Restore Intro Result before Video").item.json;
return [{ json: {
  registry_action: "register_send",
  whatsapp_message_id: source.intro_message_id,
  recipient_number: source.whatsapp_number,
  message_type: "text",
  template_name: "",
  source_workflow: "${IDS.delivery}",
  source_reference: source.delivery_key || source.conversation_id || "",
  api_status: source.intro_api_status || "accepted",
  accepted_at: new Date().toISOString()
} }];`),
    execute("Store Intro Message ID", [2460, -100], IDS.status, true),
    code("Restore File after Intro Registration", [2570, -100], String.raw`const source = $("Restore Intro Result before Video").item;
return [{ json: source.json, binary: source.binary }];`),
    whatsapp("Upload Video to WhatsApp", [1800, -260], {
      method: "POST",
      url:
        `=https://graph.facebook.com/${CFG.graphVersion}/` +
        "{{$env.WHATSAPP_PHONE_NUMBER_ID}}/media",
      sendBody: true,
      contentType: "multipart-form-data",
      bodyParameters: {
        parameters: [
          {
            parameterType: "formData",
            name: "messaging_product",
            value: "whatsapp"
          },
          {
            parameterType: "formData",
            name: "type",
            value: "video/mp4"
          },
          {
            parameterType: "formBinaryData",
            name: "file",
            inputDataFieldName: "data"
          }
        ]
      },
      options: { response: { response: { neverError: true } } }
    }, { continueOnFail: true, retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 }),
    code("Parse Media Upload", [2020, -260], parseUpload),
    ifNode("IF Media Upload Succeeded", [2240, -260], "={{ $json.upload_success }}"),
    whatsapp("Send WhatsApp Video", [2460, -340], {
      method: "POST",
      url:
        `=https://graph.facebook.com/${CFG.graphVersion}/` +
        "{{$env.WHATSAPP_PHONE_NUMBER_ID}}/messages",
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: String($json.whatsapp_number || "").replace(/\\D/g, ""),
  type: "video",
  video: {
    id: $json.media_id,
    caption: "Video " + $json.file_index + "/15"
  }
}) }}`,
      options: { response: { response: { neverError: true } } }
    }, { continueOnFail: true, retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 }),
    code("Prepare Upload Failure", [2460, -180], String.raw`const source = $("Parse Media Upload").first().json;
const now = new Date().toISOString();
const record = {
  delivery_key: source.delivery_key,
  conversation_id: source.conversation_id,
  whatsapp_number: source.whatsapp_number,
  batch_number: source.batch_number,
  file_index: source.file_index,
  file_name: source.file_name,
  media_id: "",
  whatsapp_message_id: "",
  state: "failed",
  attempts: source.attempts || 1,
  uploaded_at: "",
  sent_at: "",
  delivered_at: "",
  failed_at: now,
  last_error: source.last_error || "media_upload_failed",
  updated_at: now,
  send_state: "failed",
  delivery_state: ""
};
return [{ json: {
  ...source,
  send_success: false,
  state: "failed",
  delivery_row_values: ${JSON.stringify(HEADERS.delivery)}.map((name) =>
    record[name] == null ? "" : String(record[name])
  )
} }];`),
    code("Parse Video Send", [2680, -340], parseSend),
    ifNode("IF Register Video Message", [2790, -420], "={{ $json.send_success }}"),
    code("Prepare Video Message Registration", [2900, -460], String.raw`const source = $("Parse Video Send").item.json;
return [{ json: {
  ...source,
  registry_action: "register_send",
  recipient_number: source.whatsapp_number,
  message_type: "video",
  template_name: "",
  source_workflow: "${IDS.delivery}",
  source_reference: source.delivery_key || "",
  accepted_at: source.sent_at || new Date().toISOString()
} }];`),
    execute("Store Video Message ID", [3010, -460], IDS.status, true),
    code("Restore Video Send Result", [3120, -460], 'return [{ json: $("Parse Video Send").item.json }];'),
    code("Normalize Failed Delivery Log", [2680, -180], String.raw`return $input.all();`),
    ifNode("IF Update Existing Delivery Log", [2900, -260], "={{ Boolean($json.delivery_log_row_number) }}"),
    google("Update Existing Delivery Log", [3120, -360], {
      method: "PUT",
      url:
        `=https://sheets.googleapis.com/v4/spreadsheets/${CFG.spreadsheetId}` +
        `/values/${encodeURIComponent(SHEETS.delivery)}!A{{$json.delivery_log_row_number}}%3AR{{$json.delivery_log_row_number}}` +
        "?valueInputOption=RAW",
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        '={{ JSON.stringify({ majorDimension: "ROWS", values: [$json.delivery_row_values] }) }}',
      options: {}
    }, { retryOnFail: true, maxTries: 4, waitBetweenTries: 2000 }),
    google("Append New Delivery Log", [3120, -160], {
      method: "POST",
      url: appendUrl(SHEETS.delivery, "A:R"),
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        '={{ JSON.stringify({ majorDimension: "ROWS", values: [$json.delivery_row_values] }) }}',
      options: {}
    }, { retryOnFail: true, maxTries: 4, waitBetweenTries: 2000 }),
    code(
      "Restore Delivery Result after Log Write",
      [3340, -260],
      String.raw`let source;
try {
  source = $("Parse Video Send").first().json;
} catch {}
if (!source || typeof source.send_success !== "boolean") {
  source = $("Prepare Upload Failure").first().json;
}
return [{ json: source }];`
    ),
    ifNode("IF File Send Succeeded", [3560, -260], "={{ $json.send_success }}"),
    waitNode("Wait Between Recipient Messages", [3780, -360], 6),
    code(
      "Prepare Delivery Failure Queue",
      [3780, -160],
      queueHandoffCode(
        "Restore Delivery Result after Log Write",
        '"whatsapp_media_delivery_failed"'
      )
    ),
    execute("Queue Delivery Failure", [4000, -160], IDS.queue, false),
    google("Read Delivery Log after Send Loop", [1800, 40], {
      url: valuesUrl(SHEETS.delivery, "A:P"),
      options: {}
    }),
    code("Summarize Delivery Send", [2020, 40], aggregate),
    google("Read Leads for Final Send State", [2240, 40], {
      url: valuesUrl(SHEETS.leads, "A:AB"),
      options: {}
    }),
    code("Prepare Final Send Lead Update", [2460, 40], prepareFinalLead),
    updateLeadHttp("Update Final Send State", [2680, 40]),
    noOp("Done: Delivery Send Attempt", [2900, 40])
  ];

  const connections = {
    "When Executed after Opt-in": connect([["Read WhatsApp Leads for Reservation"]]),
    "Read WhatsApp Leads for Reservation": connect([["Read Historical Assignments"]]),
    "Read Historical Assignments": connect([["List Local Batch Folders"]]),
    "List Local Batch Folders": connect([["Select and Prepare Batch Reservation"]]),
    "Select and Prepare Batch Reservation": connect([["IF Batch Available"]]),
    "IF Batch Available": connect([
      ["Reserve Batch in Leads"],
      ["Prepare No Batch Queue"]
    ]),
    "Prepare No Batch Queue": connect([["Queue No Batch"]]),
    "Reserve Batch in Leads": connect([["Wait for Reservation Settle"]]),
    "Wait for Reservation Settle": connect([["Reread Leads after Reservation"]]),
    "Reread Leads after Reservation": connect([["Confirm Reservation Winner"]]),
    "Confirm Reservation Winner": connect([["IF Reservation Won"]]),
    "IF Reservation Won": connect([
      ["Read Delivery Log for Resume"],
      ["Prepare Reservation Lost Queue"]
    ]),
    "Prepare Reservation Lost Queue": connect([["Queue Reservation Conflict"]]),
    "Read Delivery Log for Resume": connect([["Read Message Log for Resume"]]),
    "Read Message Log for Resume": connect([["Restore and Validate Delivery Context"]]),
    "Restore and Validate Delivery Context": connect([["Validate Assigned Folder"]]),
    "Validate Assigned Folder": connect([["Confirm Assigned Folder Validation"]]),
    "Confirm Assigned Folder Validation": connect([["Read Assigned MP4 Files"]]),
    "Read Assigned MP4 Files": connect([["Prepare Resumable Delivery Items"]]),
    "Prepare Resumable Delivery Items": connect([["Loop Through Files"]]),
    "Loop Through Files": {
      main: [
        [{ node: "Read Delivery Log after Send Loop", type: "main", index: 0 }],
        [{ node: "IF Intro Before First Video", type: "main", index: 0 }]
      ]
    },
    "IF Intro Before First Video": connect([
      ["Send WhatsApp Intro Message"],
      ["Upload Video to WhatsApp"]
    ]),
    "Send WhatsApp Intro Message": connect([["Restore Intro Result before Video"]]),
    "Restore Intro Result before Video": connect([["Prepare Intro Message Registration"]]),
    "Prepare Intro Message Registration": connect([["Store Intro Message ID"]]),
    "Store Intro Message ID": connect([["Restore File after Intro Registration"]]),
    "Restore File after Intro Registration": connect([["Upload Video to WhatsApp"]]),
    "Upload Video to WhatsApp": connect([["Parse Media Upload"]]),
    "Parse Media Upload": connect([["IF Media Upload Succeeded"]]),
    "IF Media Upload Succeeded": connect([
      ["Send WhatsApp Video"],
      ["Prepare Upload Failure"]
    ]),
    "Send WhatsApp Video": connect([["Parse Video Send"]]),
    "Prepare Upload Failure": connect([["Normalize Failed Delivery Log"]]),
    "Normalize Failed Delivery Log": connect([["IF Update Existing Delivery Log"]]),
    "Parse Video Send": connect([["IF Register Video Message"]]),
    "IF Register Video Message": connect([
      ["Prepare Video Message Registration"],
      ["IF Update Existing Delivery Log"]
    ]),
    "Prepare Video Message Registration": connect([["Store Video Message ID"]]),
    "Store Video Message ID": connect([["Restore Video Send Result"]]),
    "Restore Video Send Result": connect([["IF Update Existing Delivery Log"]]),
    "IF Update Existing Delivery Log": connect([
      ["Update Existing Delivery Log"],
      ["Append New Delivery Log"]
    ]),
    "Update Existing Delivery Log": connect([["Restore Delivery Result after Log Write"]]),
    "Append New Delivery Log": connect([["Restore Delivery Result after Log Write"]]),
    "Restore Delivery Result after Log Write": connect([["IF File Send Succeeded"]]),
    "IF File Send Succeeded": connect([
      ["Wait Between Recipient Messages"],
      ["Prepare Delivery Failure Queue"]
    ]),
    "Wait Between Recipient Messages": {
      main: [[{ node: "Loop Through Files", type: "main", index: 0 }]]
    },
    "Prepare Delivery Failure Queue": connect([["Queue Delivery Failure"]]),
    "Read Delivery Log after Send Loop": connect([["Summarize Delivery Send"]]),
    "Summarize Delivery Send": connect([["Read Leads for Final Send State"]]),
    "Read Leads for Final Send State": connect([["Prepare Final Send Lead Update"]]),
    "Prepare Final Send Lead Update": connect([["Update Final Send State"]]),
    "Update Final Send State": connect([["Done: Delivery Send Attempt"]])
  };
  return workflow(
    IDS.delivery,
    "Affiliate Distribution - Resumable File Delivery",
    nodes,
    connections,
    {
      callerPolicy: "workflowsFromAList",
      callerIds: IDS.reply
    }
  );
}

function buildSetupWorkflow() {
  const setupCode = String.raw`const required = ${JSON.stringify(Object.values(SHEETS).filter((name) => name !== SHEETS.historical))};
const existing = new Set(
  (Array.isArray($json.sheets) ? $json.sheets : [])
    .map((sheet) => String(sheet?.properties?.title || ""))
);
const missing = required.filter((title) => !existing.has(title));
return [{ json: {
  needs_create: missing.length > 0,
  requests: missing.map((title) => ({ addSheet: { properties: { title } } }))
} }];`;
  const verifyCode = String.raw`const expected = ${JSON.stringify(HEADERS.leads)};
const expectedMessages = ${JSON.stringify(HEADERS.messages)};
const leadsResponse = $("Read Leads after Backfill").first().json;
const values = Array.isArray(leadsResponse.values) ? leadsResponse.values : [];
const messageValues = Array.isArray($json.values) ? $json.values : [];
const leadRows = values.slice(1).filter((row) =>
  String(row?.[1] || "").trim() || String(row?.[2] || "").trim()
);
const blankStateCount = leadRows.filter((row) => !String(row?.[7] || "").trim()).length;
return [{ json: {
  ready:
    Array.isArray(values[0]) &&
    expected.every((value, index) => String(values[0][index] || "") === value) &&
    Array.isArray(messageValues[0]) &&
    expectedMessages.every((value, index) =>
      String(messageValues[0][index] || "") === value
    ) &&
    blankStateCount === 0,
  sheet_name: ${JSON.stringify(SHEETS.leads)},
  message_log_sheet_name: ${JSON.stringify(SHEETS.messages)},
  message_log_header: messageValues[0] || [],
  header: values[0] || [],
  row_count: leadRows.length,
  blank_state_count: blankStateCount
} }];`;
  const backfillCode = String.raw`const headers = ${JSON.stringify(HEADERS.leads)};
const values = Array.isArray($json.values) ? $json.values : [];
const now = new Date().toISOString();
const data = [];
for (let index = 1; index < values.length; index += 1) {
  const row = [...values[index]];
  while (row.length < headers.length) row.push("");
  const hasLead = String(row[1] || "").trim() || String(row[2] || "").trim();
  if (!hasLead) continue;
  let changed = false;
  if (!String(row[7] || "").trim()) {
    row[7] = "interested";
    changed = true;
  }
  if (!String(row[15] || "").trim()) {
    row[15] = "15";
    changed = true;
  }
  if (!String(row[27] || "").trim()) {
    row[27] = now;
    changed = true;
  }
  if (changed) {
    const rowNumber = index + 1;
    data.push({
      range: ${JSON.stringify(SHEETS.leads)} + "!A" + rowNumber + ":AE" + rowNumber,
      majorDimension: "ROWS",
      values: [row]
    });
  }
}
return [{ json: { needs_backfill: data.length > 0, data } }];`;
  const headerData = [
    { range: `${SHEETS.leads}!A1:AE1`, values: [HEADERS.leads] },
    { range: `${SHEETS.delivery}!A1:R1`, values: [HEADERS.delivery] },
    { range: `${SHEETS.messages}!A1:X1`, values: [HEADERS.messages] },
    { range: `${SHEETS.faq}!A1:F1`, values: [HEADERS.faq] },
    { range: `${SHEETS.queue}!A1:R1`, values: [HEADERS.queue] }
  ];
  const nodes = [
    manual("Manual Setup Trigger", [-900, 120]),
    webhook(
      "Setup Distribution Sheets Webhook",
      [-900, -80],
      "POST",
      "setup-affiliate-distribution-2026",
      "lastNode"
    ),
    google("Get Spreadsheet Metadata", [-680, 0], {
      url:
        `https://sheets.googleapis.com/v4/spreadsheets/${CFG.spreadsheetId}` +
        "?fields=sheets.properties(title)",
      options: {}
    }),
    code("Build Missing Sheet Requests", [-460, 0], setupCode),
    ifNode("IF Sheets Missing", [-240, 0], "={{ $json.needs_create }}"),
    google("Create Missing Sheets", [-20, -120], {
      method: "POST",
      url:
        `https://sheets.googleapis.com/v4/spreadsheets/${CFG.spreadsheetId}:batchUpdate`,
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ requests: $json.requests }) }}",
      options: {}
    }),
    noOp("All Sheets Already Exist", [-20, 120]),
    google("Write Distribution Headers", [220, 0], {
      method: "POST",
      url:
        `https://sheets.googleapis.com/v4/spreadsheets/${CFG.spreadsheetId}` +
        "/values:batchUpdate",
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify({
  valueInputOption: "RAW",
  data: ${JSON.stringify(headerData)}
}) }}`,
      options: {}
    }),
    google("Read Migrated Leads Header", [460, 0], {
      url: valuesUrl(SHEETS.leads, "A1:AE"),
      options: {}
    }),
    code("Prepare Existing Lead Backfill", [680, 0], backfillCode),
    ifNode("IF Existing Leads Need Backfill", [900, 0], "={{ $json.needs_backfill }}"),
    google("Backfill Existing Lead States", [1120, -100], {
      method: "POST",
      url:
        `https://sheets.googleapis.com/v4/spreadsheets/${CFG.spreadsheetId}` +
        "/values:batchUpdate",
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        '={{ JSON.stringify({ valueInputOption: "RAW", data: $json.data }) }}',
      options: {}
    }),
    noOp("No Existing Lead Backfill Needed", [1120, 100]),
    google("Read Leads after Backfill", [1340, 0], {
      url: valuesUrl(SHEETS.leads, "A1:AE"),
      options: {}
    }),
    google("Read WhatsApp Message Log Header", [1560, 0], {
      url: valuesUrl(SHEETS.messages, "A1:X"),
      options: {}
    }),
    code("Verify Distribution Sheet Setup", [1780, 0], verifyCode)
  ];
  const connections = {
    "Manual Setup Trigger": connect([["Get Spreadsheet Metadata"]]),
    "Setup Distribution Sheets Webhook": connect([["Get Spreadsheet Metadata"]]),
    "Get Spreadsheet Metadata": connect([["Build Missing Sheet Requests"]]),
    "Build Missing Sheet Requests": connect([["IF Sheets Missing"]]),
    "IF Sheets Missing": connect([
      ["Create Missing Sheets"],
      ["All Sheets Already Exist"]
    ]),
    "Create Missing Sheets": connect([["Write Distribution Headers"]]),
    "All Sheets Already Exist": connect([["Write Distribution Headers"]]),
    "Write Distribution Headers": connect([["Read Migrated Leads Header"]]),
    "Read Migrated Leads Header": connect([["Prepare Existing Lead Backfill"]]),
    "Prepare Existing Lead Backfill": connect([["IF Existing Leads Need Backfill"]]),
    "IF Existing Leads Need Backfill": connect([
      ["Backfill Existing Lead States"],
      ["No Existing Lead Backfill Needed"]
    ]),
    "Backfill Existing Lead States": connect([["Read Leads after Backfill"]]),
    "No Existing Lead Backfill Needed": connect([["Read Leads after Backfill"]]),
    "Read Leads after Backfill": connect([["Read WhatsApp Message Log Header"]]),
    "Read WhatsApp Message Log Header": connect([["Verify Distribution Sheet Setup"]])
  };
  return workflow(
    IDS.setup,
    "Affiliate Distribution - Setup Sheets",
    nodes,
    connections
  );
}

function assertWorkflow(workflowValue) {
  const nodeNames = new Set(workflowValue.nodes.map((item) => item.name));
  if (nodeNames.size !== workflowValue.nodes.length) {
    throw new Error(`Duplicate node name in ${workflowValue.name}`);
  }
  for (const [source, outputs] of Object.entries(workflowValue.connections)) {
    if (!nodeNames.has(source)) {
      throw new Error(`${workflowValue.name} has missing connection source ${source}`);
    }
    for (const branches of outputs.main || []) {
      for (const target of branches || []) {
        if (!nodeNames.has(target.node)) {
          throw new Error(
            `${workflowValue.name} connects ${source} to missing ${target.node}`
          );
        }
      }
    }
  }
  const serialized = JSON.stringify(workflowValue);
  if (/D:\\\\output_clips|WHATSAPP_ACCESS_TOKEN|WHATSAPP_APP_SECRET":/i.test(serialized)) {
    throw new Error(`${workflowValue.name} embeds a host path or secret`);
  }
}

fs.mkdirSync(IMPORTS, { recursive: true });
const workflows = [
  ["affiliate-whatsapp-lead-capture.json", patchLeadCapture()],
  ["affiliate-whatsapp-opt-in.json", buildOptInWorkflow()],
  ["affiliate-whatsapp-webhook-router.json", buildWebhookRouterWorkflow()],
  ["affiliate-whatsapp-status.json", buildStatusWorkflow()],
  ["affiliate-whatsapp-reply-status.json", buildReplyWorkflow()],
  ["affiliate-whatsapp-file-delivery.json", buildDeliveryWorkflow()],
  ["affiliate-distribution-setup.json", buildSetupWorkflow()]
];

for (const [fileName, value] of workflows) {
  patchPhase1Workflow(value, {
    root: ROOT,
    headers: HEADERS,
    sheets: SHEETS,
    ids: IDS,
    config: CFG
  });
  assertWorkflow(value);
  const outputPath = path.join(IMPORTS, fileName);
  fs.writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`);
  console.log(outputPath);
}
