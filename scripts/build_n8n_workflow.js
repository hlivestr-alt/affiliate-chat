"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PROCESSOR_WORKFLOW_ID = "AfDriveReady2026";
const ROUTER_WORKFLOW_ID = "AfDriveRouter2026";
const SETUP_WORKFLOW_ID = "AffWhatsAppSetup26";
const LEADS_SHEET_NAME = "WhatsApp Leads";
const SETUP_WEBHOOK_PATH = "setup-whatsapp-leads-2026-f3c90e";

function readEnv(filePath) {
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

const env = readEnv(path.join(ROOT, ".env"));
const CFG = {
  spreadsheetId: env.AFFILIATE_TRACKER_SPREADSHEET_ID,
  tiktokShopCipher: env.TIKTOK_SHOP_CIPHER,
  tiktokAccessToken: env.TIKTOK_ACCESS_TOKEN,
  tiktokAppKey: env.TIKTOK_APP_KEY,
  tiktokAppSecret: env.TIKTOK_APP_SECRET,
  googleSheetsCredentialId:
    env.GOOGLE_SHEETS_CREDENTIAL_ID || "v62HRbwXmN6BRJqs",
  googleSheetsCredentialName:
    env.GOOGLE_SHEETS_CREDENTIAL_NAME || "Google Sheets account"
};

for (const [key, value] of Object.entries(CFG)) {
  if (!value) throw new Error(`Missing config value: ${key}`);
}

const encodedSheetName = encodeURIComponent(LEADS_SHEET_NAME);
const historicalSheetName =
  env.AFFILIATE_TRACKER_SHEET_NAME || "Affiliate Assignments";
const leadsRange = encodeURIComponent(`${LEADS_SHEET_NAME}!A:G`);
const historicalRange = encodeURIComponent(`${historicalSheetName}!A:M`);
const readLeadsUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${CFG.spreadsheetId}/values/${leadsRange}`;
const readHistoricalTrackerUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${CFG.spreadsheetId}/values/${historicalRange}`;
const appendLeadsUrl =
  `${readLeadsUrl}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
const headerUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${CFG.spreadsheetId}` +
  `/values/${encodedSheetName}!A1%3AG1?valueInputOption=RAW`;

function id() {
  return crypto.randomUUID();
}

function node(name, type, typeVersion, position, parameters = {}, extra = {}) {
  return {
    parameters,
    id: id(),
    name,
    type,
    typeVersion,
    position,
    ...extra
  };
}

function codeNode(name, position, jsCode) {
  return node(name, "n8n-nodes-base.code", 2, position, { jsCode });
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
      conditions: [
        {
          id: id(),
          leftValue: expression,
          rightValue: "",
          operator: {
            type: "boolean",
            operation: "true",
            singleValue: true
          }
        }
      ],
      combinator: "and"
    },
    options: {}
  });
}

function noOp(name, position) {
  return node(name, "n8n-nodes-base.noOp", 1, position, {});
}

function webhookNode(name, position, pathName, responseMode = "onReceived") {
  return node(
    name,
    "n8n-nodes-base.webhook",
    2.1,
    position,
    {
      httpMethod: "POST",
      path: pathName,
      responseMode,
      options: {}
    },
    { webhookId: id() }
  );
}

function executeWorkflowTriggerNode(name, position) {
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

function executeSubWorkflowNode(name, position, workflowId) {
  return node(name, "n8n-nodes-base.executeWorkflow", 1.3, position, {
    source: "database",
    workflowId: workflowSelector(workflowId),
    mode: "once",
    options: { waitForSubWorkflow: false }
  });
}

function googleSheetsHttp(name, position, parameters, extra = {}) {
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
          id: CFG.googleSheetsCredentialId,
          name: CFG.googleSheetsCredentialName
        }
      },
      ...extra
    }
  );
}

function cryptoHmacNode(name, position) {
  return node(name, "n8n-nodes-base.crypto", 1, position, {
    action: "hmac",
    type: "SHA256",
    value: "={{ $json.sign_input }}",
    dataPropertyName: "sign",
    secret: CFG.tiktokAppSecret,
    encoding: "hex"
  });
}

function tiktokGetNode(name, position) {
  return node(
    name,
    "n8n-nodes-base.httpRequest",
    4.4,
    position,
    {
      method: "GET",
      url: "={{ $json.tiktok_url }}",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "content-type", value: "application/json" },
          {
            name: "x-tts-access-token",
            value: "={{ $json.tiktok_access_token }}"
          }
        ]
      },
      options: {}
    },
    {
      continueOnFail: true,
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 2000
    }
  );
}

function main(outputs) {
  return {
    main: outputs.map((branch) =>
      branch.map((name) => ({ node: name, type: "main", index: 0 }))
    )
  };
}

const filterRecentUnreadCode = fs
  .readFileSync(path.join(ROOT, "n8n", "code", "filter-recent-unread.js"), "utf8")
  .trim();
const extractLeadCode = fs
  .readFileSync(path.join(ROOT, "n8n", "code", "extract-whatsapp-lead.js"), "utf8")
  .trim();
const resolveUsernameCode = fs
  .readFileSync(
    path.join(ROOT, "n8n", "code", "resolve-username-from-conversations.js"),
    "utf8"
  )
  .trim();
const collectRecentRepliesCode = fs
  .readFileSync(path.join(ROOT, "n8n", "code", "collect-recent-replies.js"), "utf8")
  .trim();
const prepareUpsertCode = fs
  .readFileSync(path.join(ROOT, "n8n", "code", "prepare-lead-upsert.js"), "utf8")
  .trim();

const fakePhonePayloadCode = String.raw`return [{
  json: {
    body: {
      type: 33,
      timestamp: Math.floor(Date.now() / 1000),
      data: {
        content: JSON.stringify({ content: "boleh kak 0822 1035 8121" }),
        conversation_id: "test_conversation_1",
        create_time: String(Math.floor(Date.now() / 1000)),
        message_id: "manual_test_" + Date.now(),
        sender: { sender_im_user_id: "test_affiliate_1" }
      }
    },
    unread: true,
    received_at: new Date().toISOString()
  }
}];`;

const prepareMessageHistoryCode = String.raw`const source = $("Extract WhatsApp Lead").first().json;
const path = "/affiliate_seller/202412/conversation/" + encodeURIComponent(source.conversation_id) + "/messages";
const query = {
  app_key: ${JSON.stringify(CFG.tiktokAppKey)},
  timestamp: Math.floor(Date.now() / 1000),
  shop_cipher: ${JSON.stringify(CFG.tiktokShopCipher)},
  page_size: 20
};
const sorted = Object.keys(query)
  .filter((key) => key !== "sign" && key !== "access_token")
  .sort()
  .map((key) => key + query[key])
  .join("");
const secret = ${JSON.stringify(CFG.tiktokAppSecret)};
return [{
  json: {
    ...source,
    tiktok_path: path,
    tiktok_query: query,
    tiktok_access_token: ${JSON.stringify(CFG.tiktokAccessToken)},
    sign_input: secret + path + sorted + secret
  }
}];`;

const buildMessageHistoryCode = String.raw`const source = $("Prepare Message History Sign").first().json;
const sign = $json.sign;
if (!sign) throw new Error("TikTok signature missing");
const query = { ...source.tiktok_query, sign };
const queryString = Object.keys(query)
  .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(query[key]))
  .join("&");
return [{
  json: {
    ...source,
    tiktok_url: "https://open-api.tiktokglobalshop.com" + source.tiktok_path + "?" + queryString
  }
}];`;

const prepareConversationLookupCode = String.raw`const source = $("Collect Recent Replies").first().json;
const path = "/affiliate_seller/202412/conversations";
const query = {
  app_key: ${JSON.stringify(CFG.tiktokAppKey)},
  timestamp: Math.floor(Date.now() / 1000),
  shop_cipher: ${JSON.stringify(CFG.tiktokShopCipher)},
  page_size: 50,
  only_need_conversation_id: false
};
const sorted = Object.keys(query)
  .filter((key) => key !== "sign" && key !== "access_token")
  .sort()
  .map((key) => key + query[key])
  .join("");
const secret = ${JSON.stringify(CFG.tiktokAppSecret)};
return [{
  json: {
    ...source,
    tiktok_path: path,
    tiktok_query: query,
    tiktok_access_token: ${JSON.stringify(CFG.tiktokAccessToken)},
    sign_input: secret + path + sorted + secret
  }
}];`;

const buildConversationLookupCode = String.raw`const source = $("Prepare Conversation Lookup Sign").first().json;
const sign = $json.sign;
if (!sign) throw new Error("TikTok signature missing");
const query = { ...source.tiktok_query, sign };
const queryString = Object.keys(query)
  .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(query[key]))
  .join("&");
return [{
  json: {
    ...source,
    tiktok_url: "https://open-api.tiktokglobalshop.com" + source.tiktok_path + "?" + queryString
  }
}];`;

const setupInspectionCode = String.raw`const sheets = Array.isArray($json.sheets) ? $json.sheets : [];
const title = ${JSON.stringify(LEADS_SHEET_NAME)};
return [{
  json: {
    sheet_exists: sheets.some((sheet) => sheet && sheet.properties && sheet.properties.title === title)
  }
}];`;

const setupSummaryCode = String.raw`const leadsResponse = $("Read WhatsApp Leads For Verification").first().json;
const values = Array.isArray(leadsResponse.values) ? leadsResponse.values : [];
const rows = values.slice(1);
const historicalValues = Array.isArray($json.values) ? $json.values : [];
const conversationIds = rows.map((row) => String(row[2] || "").trim()).filter(Boolean);
const invalidPhoneRows = rows
  .map((row, index) => ({
    row_number: index + 2,
    phone: String(row[1] || "").trim(),
    captured_at: String(row[3] || "").trim()
  }))
  .filter((row) => !/^\+628\d{8,11}$/.test(row.phone))
  .map((row) => ({
    row_number: row.row_number,
    digit_count: row.phone.replace(/\D/g, "").length,
    starts_with_plus_62: row.phone.startsWith("+62"),
    captured_at: row.captured_at
  }));
return [{
  json: {
    sheet_name: ${JSON.stringify(LEADS_SHEET_NAME)},
    header: values[0] || [],
    row_count: rows.length,
    blank_username_count: rows.filter((row) => !String(row[0] || "").trim()).length,
    rows_with_replies: rows.filter((row) =>
      [row[4], row[5], row[6]].some((value) => String(value || "").trim())
    ).length,
    reply_cell_count: rows.reduce(
      (count, row) =>
        count +
        [row[4], row[5], row[6]].filter((value) => String(value || "").trim()).length,
      0
    ),
    invalid_phone_count: invalidPhoneRows.length,
    invalid_phone_rows: invalidPhoneRows,
    duplicate_conversation_count: conversationIds.length - new Set(conversationIds).size,
    historical_tracker_row_count: historicalValues.length,
    ready:
      Array.isArray(values[0]) &&
      values[0].join(",") === "username,whatsapp_number,conversation_id,captured_at,reply_1,reply_2,reply_3"
  }
}];`;

const routerNodes = [
  webhookNode("Affiliate Message Webhook", [-900, -120], "tiktok-message"),
  node("Manual Trigger", "n8n-nodes-base.manualTrigger", 1, [-900, 100], {}),
  codeNode("Fake Phone Reply", [-680, 100], fakePhonePayloadCode),
  codeNode("Filter Recent Unread Message", [-620, -120], filterRecentUnreadCode),
  executeSubWorkflowNode(
    "Process Real Unread Message",
    [-360, -120],
    PROCESSOR_WORKFLOW_ID
  )
];

const routerConnections = {
  "Affiliate Message Webhook": main([["Filter Recent Unread Message"]]),
  "Manual Trigger": main([["Fake Phone Reply"]]),
  "Fake Phone Reply": main([["Filter Recent Unread Message"]]),
  "Filter Recent Unread Message": main([["Process Real Unread Message"]])
};

const processorNodes = [
  executeWorkflowTriggerNode("When Executed by Router", [-900, 0]),
  codeNode("Extract WhatsApp Lead", [-680, 0], extractLeadCode),
  ifNode("IF Valid Phone", [-460, 0], "={{ $json.has_valid_phone }}"),
  noOp("Stop: No Phone", [-240, 180]),
  codeNode("Prepare Message History Sign", [-240, -160], prepareMessageHistoryCode),
  cryptoHmacNode("Crypto Sign Message History", [-20, -160]),
  codeNode("Build Message History Request", [200, -160], buildMessageHistoryCode),
  tiktokGetNode("Fetch Recent Conversation Messages", [420, -160]),
  codeNode("Collect Recent Replies", [640, -160], collectRecentRepliesCode),
  codeNode(
    "Prepare Conversation Lookup Sign",
    [860, -160],
    prepareConversationLookupCode
  ),
  cryptoHmacNode("Crypto Sign Conversation Lookup", [1080, -160]),
  codeNode(
    "Build Conversation Lookup Request",
    [1300, -160],
    buildConversationLookupCode
  ),
  tiktokGetNode("Fetch Conversation List", [1520, -160]),
  codeNode("Resolve Username From Conversations", [1740, -160], resolveUsernameCode),
  googleSheetsHttp(
    "Read WhatsApp Leads",
    [1960, -160],
    { url: readLeadsUrl, options: {} },
    { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 }
  ),
  codeNode("Prepare Lead Upsert", [2180, -160], prepareUpsertCode),
  ifNode("IF Update Existing Lead", [2400, -160], "={{ $json.action === 'update' }}"),
  googleSheetsHttp(
    "Update WhatsApp Lead",
    [2620, -300],
    {
      method: "PUT",
      url:
        `=https://sheets.googleapis.com/v4/spreadsheets/${CFG.spreadsheetId}` +
        `/values/${encodedSheetName}!A{{$json.row_number}}%3AG{{$json.row_number}}?valueInputOption=RAW`,
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        '={{ JSON.stringify({ majorDimension: "ROWS", values: [$json.row_values] }) }}',
      options: {}
    },
    { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 }
  ),
  ifNode("IF Append New Lead", [2620, 0], "={{ $json.action === 'append' }}"),
  googleSheetsHttp(
    "Append WhatsApp Lead",
    [2840, -60],
    {
      method: "POST",
      url: appendLeadsUrl,
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        '={{ JSON.stringify({ majorDimension: "ROWS", values: [$json.row_values] }) }}',
      options: {}
    },
    { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 }
  ),
  noOp("Stop: Stale or Duplicate", [2840, 120]),
  noOp("Done: Lead Updated", [2840, -300]),
  noOp("Done: Lead Appended", [3060, -60])
];

const processorConnections = {
  "When Executed by Router": main([["Extract WhatsApp Lead"]]),
  "Extract WhatsApp Lead": main([["IF Valid Phone"]]),
  "IF Valid Phone": main([
    ["Prepare Message History Sign"],
    ["Stop: No Phone"]
  ]),
  "Prepare Message History Sign": main([["Crypto Sign Message History"]]),
  "Crypto Sign Message History": main([["Build Message History Request"]]),
  "Build Message History Request": main([["Fetch Recent Conversation Messages"]]),
  "Fetch Recent Conversation Messages": main([["Collect Recent Replies"]]),
  "Collect Recent Replies": main([["Prepare Conversation Lookup Sign"]]),
  "Prepare Conversation Lookup Sign": main([["Crypto Sign Conversation Lookup"]]),
  "Crypto Sign Conversation Lookup": main([["Build Conversation Lookup Request"]]),
  "Build Conversation Lookup Request": main([["Fetch Conversation List"]]),
  "Fetch Conversation List": main([["Resolve Username From Conversations"]]),
  "Resolve Username From Conversations": main([["Read WhatsApp Leads"]]),
  "Read WhatsApp Leads": main([["Prepare Lead Upsert"]]),
  "Prepare Lead Upsert": main([["IF Update Existing Lead"]]),
  "IF Update Existing Lead": main([
    ["Update WhatsApp Lead"],
    ["IF Append New Lead"]
  ]),
  "Update WhatsApp Lead": main([["Done: Lead Updated"]]),
  "IF Append New Lead": main([
    ["Append WhatsApp Lead"],
    ["Stop: Stale or Duplicate"]
  ]),
  "Append WhatsApp Lead": main([["Done: Lead Appended"]])
};

const setupNodes = [
  webhookNode(
    "Setup WhatsApp Leads Webhook",
    [-900, 0],
    SETUP_WEBHOOK_PATH,
    "lastNode"
  ),
  googleSheetsHttp("Get Spreadsheet Metadata", [-680, 0], {
    url:
      `https://sheets.googleapis.com/v4/spreadsheets/${CFG.spreadsheetId}` +
      "?fields=sheets.properties(title)",
    options: {}
  }),
  codeNode("Inspect WhatsApp Leads Sheet", [-460, 0], setupInspectionCode),
  ifNode("IF Sheet Missing", [-240, 0], "={{ !$json.sheet_exists }}"),
  googleSheetsHttp("Add WhatsApp Leads Sheet", [-20, -120], {
    method: "POST",
    url:
      `https://sheets.googleapis.com/v4/spreadsheets/${CFG.spreadsheetId}:batchUpdate`,
    sendBody: true,
    specifyBody: "json",
    jsonBody: `={{ JSON.stringify({ requests: [{ addSheet: { properties: { title: ${JSON.stringify(
      LEADS_SHEET_NAME
    )} } } }] }) }}`,
    options: {}
  }),
  noOp("Sheet Already Exists", [-20, 120]),
  googleSheetsHttp("Write WhatsApp Leads Header", [200, 0], {
    method: "PUT",
    url: headerUrl,
    sendBody: true,
    specifyBody: "json",
    jsonBody:
      '={{ JSON.stringify({ majorDimension: "ROWS", values: [["username", "whatsapp_number", "conversation_id", "captured_at", "reply_1", "reply_2", "reply_3"]] }) }}',
    options: {}
  }),
  googleSheetsHttp("Read WhatsApp Leads For Verification", [420, 0], {
    url: readLeadsUrl,
    options: {}
  }),
  googleSheetsHttp("Read Historical Tracker For Verification", [640, 0], {
    url: readHistoricalTrackerUrl,
    options: {}
  }),
  codeNode("Summarize Sheet Setup", [860, 0], setupSummaryCode)
];

const setupConnections = {
  "Setup WhatsApp Leads Webhook": main([["Get Spreadsheet Metadata"]]),
  "Get Spreadsheet Metadata": main([["Inspect WhatsApp Leads Sheet"]]),
  "Inspect WhatsApp Leads Sheet": main([["IF Sheet Missing"]]),
  "IF Sheet Missing": main([
    ["Add WhatsApp Leads Sheet"],
    ["Sheet Already Exists"]
  ]),
  "Add WhatsApp Leads Sheet": main([["Write WhatsApp Leads Header"]]),
  "Sheet Already Exists": main([["Write WhatsApp Leads Header"]]),
  "Write WhatsApp Leads Header": main([["Read WhatsApp Leads For Verification"]]),
  "Read WhatsApp Leads For Verification": main([
    ["Read Historical Tracker For Verification"]
  ]),
  "Read Historical Tracker For Verification": main([["Summarize Sheet Setup"]])
};

const routerWorkflow = {
  id: ROUTER_WORKFLOW_ID,
  name: "Affiliate Message Router - Clean Executions",
  active: true,
  isArchived: false,
  nodes: routerNodes,
  connections: routerConnections,
  settings: {
    executionOrder: "v1",
    binaryMode: "separate",
    saveDataSuccessExecution: "none",
    saveDataErrorExecution: "all",
    saveManualExecutions: true
  },
  staticData: null,
  meta: { templateCredsSetupCompleted: true },
  pinData: {},
  tags: []
};

const processorWorkflow = {
  id: PROCESSOR_WORKFLOW_ID,
  name: "Affiliate WhatsApp Lead Capture",
  active: true,
  isArchived: false,
  nodes: processorNodes,
  connections: processorConnections,
  settings: {
    executionOrder: "v1",
    binaryMode: "separate",
    saveDataSuccessExecution: "none",
    saveDataErrorExecution: "all",
    saveManualExecutions: true,
    callerPolicy: "workflowsFromAList",
    callerIds: ROUTER_WORKFLOW_ID
  },
  staticData: null,
  meta: { templateCredsSetupCompleted: true },
  pinData: {},
  tags: []
};

const setupWorkflow = {
  id: SETUP_WORKFLOW_ID,
  name: "WhatsApp Leads - Setup Sheet",
  active: false,
  isArchived: false,
  nodes: setupNodes,
  connections: setupConnections,
  settings: {
    executionOrder: "v1",
    binaryMode: "separate",
    saveDataSuccessExecution: "none",
    saveDataErrorExecution: "all",
    saveManualExecutions: true
  },
  staticData: null,
  meta: { templateCredsSetupCompleted: true },
  pinData: {},
  tags: []
};

const outDir = path.join(ROOT, "n8n", "imports");
fs.mkdirSync(outDir, { recursive: true });
const outputs = [
  ["affiliate-message-router.json", routerWorkflow],
  ["affiliate-whatsapp-lead-capture.json", processorWorkflow],
  ["affiliate-drive-rename-handoff-ready.json", processorWorkflow],
  ["affiliate-whatsapp-leads-setup.json", setupWorkflow]
];

for (const [fileName, workflow] of outputs) {
  const outputPath = path.join(outDir, fileName);
  fs.writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`);
  console.log(outputPath);
}
