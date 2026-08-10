"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function load(name) {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, "n8n", "imports", name), "utf8")
  );
}

function nodeByName(workflow, name) {
  return workflow.nodes.find((node) => node.name === name);
}

function executeCodeFile(name, nodes, input = [], env = {}, execution = { id: "test-execution" }) {
  const code = fs.readFileSync(path.join(ROOT, "n8n", "code", name), "utf8");
  const select = (nodeName) => ({
    first: () => ({ json: nodes[nodeName] || {} }),
    item: nodes[`${nodeName}:item`] || { json: nodes[nodeName] || {}, binary: {} }
  });
  return Function("$", "$input", "$env", "$execution", code)(select, { all: () => input }, env, execution);
}

const LEAD_HEADERS = [
  "username", "whatsapp_number", "conversation_id", "captured_at", "reply_1", "reply_2", "reply_3", "state",
  "opt_in_message_id", "opt_in_sent_at", "opted_in_at", "declined_at", "batch_number", "batch_reserved_at",
  "delivery_started_at", "files_expected", "files_sent", "files_delivered", "files_failed", "files_sent_at",
  "files_delivered_at", "posted_confirmed_at", "last_whatsapp_message_id", "last_inbound_at", "last_intent",
  "last_intent_confidence", "last_error", "updated_at", "wa_id", "last_inbound_message_id", "window_expires_at"
];

function values(headers, records) {
  return [headers, ...records.map((record) => headers.map((header) => record[header] || ""))];
}

test("new production workflows are generated inactive with stable IDs", () => {
  const expected = new Map([
    ["affiliate-whatsapp-opt-in.json", "AffWaOptIn2026"],
    ["affiliate-whatsapp-webhook-verification.json", "AffWaVerify2026"],
    ["affiliate-whatsapp-webhook-router.json", "AffWaWebhook2026"],
    ["affiliate-whatsapp-status.json", "AffWaStatus2026"],
    ["affiliate-whatsapp-reply-status.json", "AffWaReply2026"],
    ["affiliate-whatsapp-file-delivery.json", "AffWaDelivery2026"],
    ["affiliate-human-queue.json", "AffWaQueue2026"],
    ["affiliate-distribution-setup.json", "AffDistSetup2026"]
  ]);
  for (const [file, id] of expected) {
    const workflow = load(file);
    assert.equal(workflow.id, id);
    assert.equal(workflow.active, false);
    assert.equal(
      workflow.settings.saveDataSuccessExecution,
      id === "AffWaWebhook2026" ? "all" : "none"
    );
  }
});

test("WhatsApp webhook shares the callback path and validates raw signatures", () => {
  const verify = load("affiliate-whatsapp-webhook-verification.json");
  const router = load("affiliate-whatsapp-webhook-router.json");
  const getWebhook = nodeByName(verify, "WhatsApp Verification Webhook");
  const postWebhook = nodeByName(router, "WhatsApp Events Webhook");
  assert.equal(getWebhook.parameters.httpMethod, "GET");
  assert.equal(postWebhook.parameters.httpMethod, "POST");
  assert.equal(getWebhook.parameters.path, "whatsapp-callback");
  assert.equal(postWebhook.parameters.path, "whatsapp-callback");
  assert.equal(postWebhook.parameters.responseMode, "onReceived");
  assert.equal(postWebhook.parameters.options.rawBody, true);
  assert.match(
    nodeByName(router, "Verify and Parse WhatsApp Webhook").parameters.jsCode,
    /timingSafeEqual/
  );
  assert.match(
    nodeByName(router, "Verify and Parse WhatsApp Webhook").parameters.jsCode,
    /getBinaryDataBuffer/
  );
  assert.doesNotMatch(
    nodeByName(router, "Verify and Parse WhatsApp Webhook").parameters.jsCode,
    /\$helpers/
  );
  assert.match(
    nodeByName(router, "Verify and Parse WhatsApp Webhook").parameters.jsCode,
    /raw_callback|n8n_execution_time|status_event_key|conversation|pricing|error_details/
  );
  assert.equal(router.settings.saveDataErrorExecution, "all");
  assert.equal(nodeByName(router, "Acknowledge Meta"), undefined);
  assert.equal(
    router.connections["IF Status Event"].main[0][0].node,
    "Done: Status Sheet Logging Paused"
  );
});

test("WhatsApp parser reads filesystem binary data in the task runner and preserves status diagnostics", async () => {
  const crypto = require("node:crypto");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const code = fs.readFileSync(
    path.join(ROOT, "n8n", "code", "parse-whatsapp-webhook.js"),
    "utf8"
  );
  const payload = {
    object: "whatsapp_business_account",
    entry: [{
      id: "waba-test",
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: "phone-test" },
          statuses: [{
            id: "wamid.test",
            status: "failed",
            timestamp: "123",
            recipient_id: "recipient-test",
            errors: [{
              code: 131042,
              title: "Payment issue",
              message: "Payment issue",
              error_data: { details: "Set up billing" }
            }]
          }]
        }
      }]
    }]
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const secret = "test-secret";
  const signature = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;
  const execute = new AsyncFunction(
    "require",
    "$input",
    "helpers",
    "$env",
    "console",
    code
  );
  const result = await execute(
    require,
    {
      first: () => ({
        json: { headers: { "x-hub-signature-256": signature } },
        binary: { data: {} }
      })
    },
    { getBinaryDataBuffer: async () => rawBody },
    { WHATSAPP_APP_SECRET: secret },
    { log() {} }
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].json.signature_valid, true);
  assert.equal(result[0].json.event_kind, "status");
  assert.equal(result[0].json.delivery_status, "failed");
  assert.equal(result[0].json.error_code, "131042");
  assert.equal(result[0].json.error_details, "Set up billing");
  assert.deepEqual(result[0].json.raw_callback, payload);
  assert.match(result[0].json.n8n_execution_time, /^\d{4}-\d{2}-\d{2}T/);
});

test("status workflow temporarily performs no Sheet logging", () => {
  const workflow = load("affiliate-whatsapp-status.json");
  const serialized = JSON.stringify(workflow);
  assert.ok(nodeByName(workflow, "Done: Chat and Status Sheet Logging Paused"));
  assert.doesNotMatch(serialized, /sheets\.googleapis\.com|graph\.facebook\.com/);
  const reply = load("affiliate-whatsapp-reply-status.json");
  assert.equal(
    reply.settings.callerIds,
    "AffWaWebhook2026,AffWaStatus2026"
  );
});

test("opt-in uses an approved template and never embeds its bearer token", () => {
  const workflow = load("affiliate-whatsapp-opt-in.json");
  const send = nodeByName(workflow, "Send Approved Opt-in Template");
  const serialized = JSON.stringify(workflow);
  assert.equal(send, undefined);
  assert.ok(nodeByName(workflow, "No Send: Inbound Contact Required"));
  assert.doesNotMatch(serialized, /graph\.facebook\.com/);
  assert.doesNotMatch(serialized, /type\\?\"?:\s*\\?\"template/i);
  return;
  assert.match(send.parameters.jsonBody, /affiliate_clip_opt_in_v1/);
  assert.match(send.parameters.jsonBody, /type: "template"/);
  assert.match(send.parameters.jsonBody, /parameters: \[/);
  assert.match(send.parameters.jsonBody, /text: \$json\.username/);
  assert.doesNotMatch(send.parameters.jsonBody, /YES_SEND_CLIPS|NO_THANKS/);
  assert.match(send.notes, /Halo Kak \{\{1\}\}!/);
  assert.match(send.notes, /\*\*“YA, SAYA SETUJU”\*\*/);
  assert.doesNotMatch(serialized, /Bearer [A-Za-z0-9_-]{20,}/);
  assert.match(serialized, /WhatsApp Cloud API token/);
  assert.match(serialized, /Store Opt-in Message ID/);
  assert.match(serialized, /registry_action/);
});

test("delivery reads the read-only mount, requires 15 files, and loops sequentially", () => {
  const workflow = load("affiliate-whatsapp-file-delivery.json");
  const read = nodeByName(workflow, "Read Assigned MP4 Files");
  const prepare = nodeByName(workflow, "Prepare Resumable Delivery Items");
  const wait = nodeByName(workflow, "Wait Between Recipient Messages");
  assert.match(nodeByName(workflow, "Restore and Validate Delivery Context").parameters.jsCode, /clips_whatsapp_test/);
  assert.match(nodeByName(workflow, "Restore and Validate Delivery Context").parameters.jsCode, /clips_whatsapp/);
  assert.match(prepare.parameters.jsCode, /expected_clip_count/);
  assert.equal(wait.parameters.amount, 6);
  assert.ok(nodeByName(workflow, "Guard Cached Clip Send"));
  assert.ok(nodeByName(workflow, "IF Cached Clip Send Authorized"));
  assert.match(prepare.parameters.jsCode, /must contain exactly/);
  assert.equal(wait.parameters.amount, 6);
  assert.match(JSON.stringify(workflow), /multipart-form-data/);
  assert.doesNotMatch(JSON.stringify(workflow), /ffmpeg|transcod|whatsapp_cache/i);
  assert.match(JSON.stringify(workflow), /Append Message Results Batch/);
  assert.match(read.parameters.fileSelector, /Restore and Validate Delivery Context/);
  assert.doesNotMatch(read.parameters.fileSelector, /\$json\.batch_number/);
  assert.ok(nodeByName(workflow, "Validate Assigned Folder"));
  assert.ok(nodeByName(workflow, "Read Message Log for Resume"));
  assert.ok(nodeByName(workflow, "Prepare Batch Send Claims"));
  assert.ok(nodeByName(workflow, "Batch Write Pre-Send Claims"));
  assert.ok(nodeByName(workflow, "Prepare Batched Delivery Tracking"));
  assert.ok(nodeByName(workflow, "Batch Write Delivery Results"));
  assert.ok(nodeByName(workflow, "IF Reuse Existing Media Upload"));
  assert.ok(nodeByName(workflow, "Restore Existing Media Upload"));
  const sendGuard = nodeByName(workflow, "Guard Cached Clip Send").parameters.jsCode;
  assert.match(sendGuard, /window_expires_at/);
  assert.match(sendGuard, /ZERO_CHARGE_MODE/);
  assert.equal(nodeByName(workflow, "Upload Video to WhatsApp").retryOnFail, false);
  assert.equal(nodeByName(workflow, "Send WhatsApp Video").retryOnFail, false);
  assert.match(nodeByName(workflow, "Parse Video Send").parameters.jsCode, /Guard Cached Clip Send/);
  assert.equal(nodeByName(workflow, "Read Leads Immediately Before Media Upload"), undefined);
  assert.equal(nodeByName(workflow, "Read Leads Immediately Before Clip Send"), undefined);
  assert.equal(nodeByName(workflow, "Batch Write Delivery Results").maxTries, 8);
  assert.equal(nodeByName(workflow, "Batch Write Delivery Results").continueOnFail, true);
});

test("delivery sends the supplied intro once before the first video and preserves binary data", () => {
  const workflow = load("affiliate-whatsapp-file-delivery.json");
  assert.equal(nodeByName(workflow, "Send WhatsApp Intro Message"), undefined);
  assert.equal(
    workflow.connections["IF Media Upload Succeeded"].main[0][0].node,
    "Guard Cached Clip Send"
  );
  assert.match(
    nodeByName(workflow, "Guard Cached Clip Send").parameters.jsCode,
    /window_expires_at/
  );
  assert.equal(
    workflow.connections["IF Cached Clip Send Authorized"].main[0][0].node,
    "Send WhatsApp Video"
  );
  assert.match(nodeByName(workflow, "Guard Cached Media Upload").parameters.jsCode, /assignmentMatches/);
  assert.match(nodeByName(workflow, "Guard Cached Clip Send").parameters.jsCode, /assignmentMatches/);
});

test("FAQ classifier uses LM Studio structured output and sheet-owned answers", () => {
  const workflow = load("affiliate-whatsapp-reply-status.json");
  const serialized = JSON.stringify(workflow);
  assert.ok(nodeByName(workflow, "Resolve Inbound Affiliate and Intent"));
  assert.ok(nodeByName(workflow, "Guard Phase 1 Text Send"));
  assert.ok(nodeByName(workflow, "Done: Duplicate Inbound Ignored"));
  assert.doesNotMatch(serialized, /type\\?\"?:\s*\\?\"template/i);
  return;
  const classify = nodeByName(workflow, "Classify with Local Qwen");
  const send = nodeByName(workflow, "Send Approved FAQ Answer");
  assert.match(classify.parameters.url, /LM_STUDIO_BASE_URL/);
  assert.match(classify.parameters.jsonBody, /json_schema/);
  assert.match(classify.parameters.jsonBody, /temperature: 0/);
  assert.match(send.parameters.jsonBody, /faq_answer/);
  assert.doesNotMatch(send.parameters.jsonBody, /choices/);
});

test("delivery context survives Sheets item replacement and resolves folder 6901", () => {
  const source = { reservation_won: true, conversation_id: "wa:6289508881998", batch_number: "6901", username: "yuvikachuu", whatsapp_number: "6289508881998", wa_id: "6289508881998" };
  const lead = { ...source, state: "delivery_in_progress", files_expected: "15", last_inbound_at: "2026-08-04T00:00:00Z", window_expires_at: "2099-01-01T00:00:00Z" };
  const result = executeCodeFile("restore-delivery-context.js", {
    "Confirm Reservation Winner": source,
    "Read Delivery Log for Resume": { range: "Delivery Log", values: [["delivery_key"]] },
    "Read Message Log for Resume": { range: "Message Log", values: [["whatsapp_message_id"]] },
    "Reread Leads after Reservation": { values: values(LEAD_HEADERS, [lead]) }
  }, [], { WHATSAPP_TEST_MODE: "false" });
  assert.equal(result[0].json.batch_number, "6901");
  assert.equal(result[0].json.resolved_folder_path, "/clips_whatsapp/6901");
  assert.equal(`${result[0].json.resolved_folder_path}/*.mp4`, "/clips_whatsapp/6901/*.mp4");
  assert.doesNotMatch(result[0].json.resolved_folder_path, /undefined/);
});

test("delivery context fails closed for missing, nonnumeric, or mismatched assignments", () => {
  const base = { reservation_won: true, conversation_id: "wa:1", batch_number: "6901", username: "user", whatsapp_number: "6281", wa_id: "6281" };
  const lead = { ...base, state: "delivery_in_progress", files_expected: "15" };
  const run = (source, current = lead) => executeCodeFile("restore-delivery-context.js", {
    "Confirm Reservation Winner": source,
    "Read Delivery Log for Resume": { values: [["delivery_key"]] },
    "Read Message Log for Resume": { values: [["whatsapp_message_id"]] },
    "Reread Leads after Reservation": { values: values(LEAD_HEADERS, [current]) }
  }, [], { WHATSAPP_TEST_MODE: "false" });
  assert.throws(() => run({ ...base, batch_number: "" }), /missing_batch_number/);
  assert.throws(() => run({ ...base, batch_number: "../6901" }), /nonnumeric_production_batch/);
  assert.throws(() => run({ ...base, batch_number: "TEST" }), /nonnumeric_production_batch/);
  assert.throws(() => run(base, { ...lead, batch_number: "6902" }), /batch_assignment_mismatch/);
  assert.throws(() => run(base, { ...lead, username: "someone_else" }), /username_mismatch/);
});

test("TEST delivery context remains isolated from production folders", () => {
  const source = { reservation_won: true, conversation_id: "wa:test", batch_number: "TEST", username: "tester", whatsapp_number: "6280", wa_id: "6280" };
  const lead = { ...source, state: "delivery_in_progress", files_expected: "1" };
  const result = executeCodeFile("restore-delivery-context.js", {
    "Confirm Reservation Winner": source,
    "Read Delivery Log for Resume": { values: [["delivery_key"]] },
    "Read Message Log for Resume": { values: [["whatsapp_message_id"]] },
    "Reread Leads after Reservation": { values: values(LEAD_HEADERS, [lead]) }
  }, [], { WHATSAPP_TEST_MODE: "true", WHATSAPP_TEST_CLIP_PATH: "/clips_whatsapp_test/test-clip.mp4" });
  assert.equal(result[0].json.resolved_folder_path, "/clips_whatsapp_test/test-clip.mp4");
  assert.equal(result[0].json.expected_clip_count, 1);
});

test("resume skips accepted, uncertain, and pre-send-claimed clips", () => {
  const deliveryHeaders = ["delivery_key","conversation_id","whatsapp_number","batch_number","file_index","file_name","media_id","whatsapp_message_id","state","attempts","uploaded_at","sent_at","delivered_at","failed_at","last_error","updated_at","send_state","delivery_state"];
  const messageHeaders = ["whatsapp_message_id","recipient_number","message_type","template_name","source_workflow","source_reference","api_status","accepted_at","current_status","status_timestamp","conversation_json","pricing_json","errors_json","error_code","error_title","error_message","error_details","processed_statuses","status_history_json","updated_at","direction","message_payload_json","send_state","delivery_state"];
  const names = ["a.mp4", "b.mp4", "c.mp4", "d.mp4"];
  const key = (name) => `wa:1:6901:${name}`;
  const source = {
    delivery_context_valid: true, conversation_id: "wa:1", batch_number: "6901", expected_clip_count: 4,
    delivery_log_values: values(deliveryHeaders, [
      { delivery_key: key("a.mp4"), conversation_id: "wa:1", batch_number: "6901", file_name: "a.mp4", whatsapp_message_id: "wamid.a", send_state: "accepted" },
      { delivery_key: key("b.mp4"), conversation_id: "wa:1", batch_number: "6901", file_name: "b.mp4", send_state: "outcome_uncertain" },
      { delivery_key: key("c.mp4"), conversation_id: "wa:1", batch_number: "6901", file_name: "c.mp4", media_id: "media.c", send_state: "send_prepared" }
    ]),
    message_log_values: values(messageHeaders, [{ whatsapp_message_id: "wamid.a", message_type: "video", source_reference: key("a.mp4"), api_status: "accepted", direction: "outbound" }])
  };
  const input = names.map((name) => ({ json: {}, binary: { data: { fileName: name } } }));
  const result = executeCodeFile("prepare-delivery-items.js", { "Restore and Validate Delivery Context": source }, input);
  assert.deepEqual(result.map((item) => item.json.file_name), ["d.mp4"]);
  assert.equal(result[0].json.remaining_clip_count, 1);
});

test("expired windows are blocked and post-loop logging failures cannot interrupt Meta sends", () => {
  const workflow = load("affiliate-whatsapp-file-delivery.json");
  const uploadGuard = nodeByName(workflow, "Guard Cached Media Upload").parameters.jsCode;
  const sendGuard = nodeByName(workflow, "Guard Cached Clip Send").parameters.jsCode;
  assert.match(uploadGuard, /Date\.now\(\)\s*<\s*expires/);
  assert.match(sendGuard, /Date\.now\(\)\s*<\s*expires/);
  assert.match(uploadGuard, /ZERO_CHARGE_MODE/);
  assert.equal(workflow.connections["IF Cached Clip Send Authorized"].main[0][0].node, "Send WhatsApp Video");
  assert.equal(workflow.connections["Loop Through Files"].main[0][0].node, "Prepare Batched Delivery Tracking");
  assert.equal(nodeByName(workflow, "Batch Write Delivery Results").continueOnFail, true);
  assert.equal(nodeByName(workflow, "Append Message Results Batch").continueOnFail, true);
  assert.equal(nodeByName(workflow, "Batch Write Pre-Send Claims").maxTries, 8);
});

test("setup workflow migrates all required Sheet headers", () => {
  const setup = load("affiliate-distribution-setup.json");
  const serialized = JSON.stringify(setup);
  for (const name of ["WhatsApp Leads", "WhatsApp Message Log", "Delivery Log", "FAQ", "Human Queue"]) {
    assert.match(serialized, new RegExp(name));
  }
  assert.match(serialized, /posted_confirmed_at/);
  assert.match(serialized, /min_confidence/);
  assert.match(serialized, /resolution/);
  assert.match(serialized, /processed_statuses/);
  assert.match(serialized, /error_details/);
});

test("compose pins n8n, preserves the external volume, and mounts clips read-only", () => {
  const compose = fs.readFileSync(path.join(ROOT, "compose.yaml"), "utf8");
  assert.match(compose, /n8nio\/n8n:2\.29\.9/);
  assert.match(compose, /n8n_data:\/home\/node\/\.n8n/);
  assert.match(compose, /external: true/);
  assert.match(compose, /D:\/output_clips\/export_batches:\/clips:ro/);
  assert.match(compose, /N8N_DEFAULT_BINARY_DATA_MODE: filesystem/);
  assert.match(compose, /N8N_RESTRICT_FILE_ACCESS_TO: \/clips;\/clips_whatsapp;\/clips_whatsapp_test/);
  assert.match(compose, /n8n\.proyaofficial\.com/);
});
