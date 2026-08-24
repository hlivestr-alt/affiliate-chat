"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const DELIVERY_HEADERS = ["delivery_key","conversation_id","whatsapp_number","batch_number","file_index","file_name","media_id","whatsapp_message_id","state","attempts","uploaded_at","sent_at","delivered_at","failed_at","last_error","updated_at","send_state","delivery_state"];
const MESSAGE_HEADERS = ["whatsapp_message_id","recipient_number","message_type","template_name","source_workflow","source_reference","api_status","accepted_at","current_status","status_timestamp","conversation_json","pricing_json","errors_json","error_code","error_title","error_message","error_details","processed_statuses","status_history_json","updated_at","direction","message_payload_json","send_state","delivery_state"];
const MESSAGE_ID = "wamid.AAAAAAAAAAAAAAAA";

async function runCode(file, args) {
  const source = fs.readFileSync(path.join(ROOT, "n8n", "code", file), "utf8");
  const names = Object.keys(args), fn = new AsyncFunction(...names, source);
  return fn(...names.map((name) => args[name]));
}
function source(overrides = {}) {
  return {
    delivery_key: "wa:62000:6941:clip-01.mp4", conversation_id: "wa:62000",
    whatsapp_number: "62000", batch_number: "6941", file_index: 1,
    file_name: "clip-01.mp4", media_id: "media-1", whatsapp_message_id: MESSAGE_ID,
    state: "accepted", send_state: "accepted", attempts: 1, uploaded_at: "2026-08-22T00:00:00.000Z",
    sent_at: "2026-08-22T00:00:01.000Z", delivery_log_row_number: 9,
    send_success: true, delivery_row_values: [], ...overrides
  };
}
function row(values = {}) { return DELIVERY_HEADERS.map((name) => values[name] == null ? "" : String(values[name])); }
function refs(entries) { return (name) => ({ item: { json: entries[name] }, first: () => ({ json: entries[name] }) }); }

test("pre-send claim durably blocks blind resume before Meta is called", async () => {
  const input = source({ whatsapp_message_id: "", state: "send_prepared", send_state: "send_prepared" });
  const result = await runCode("prepare-in-flight-send-claim.js", {
    $input: { first: () => ({ json: input, binary: { data: { fileName: input.file_name } } }) },
    $execution: { id: "mock-crash" }
  });
  assert.equal(result[0].json.in_flight_row_values[DELIVERY_HEADERS.indexOf("state")], "outcome_uncertain");
  assert.equal(result[0].json.in_flight_row_values[DELIVERY_HEADERS.indexOf("send_state")], "outcome_uncertain");
  assert.equal(result[0].json.in_flight_row_values[DELIVERY_HEADERS.indexOf("attempts")], "1");
});

test("successful persistence writes an empty in-flight row and preserves attempt count", async () => {
  const incoming = source();
  const current = row({ ...incoming, whatsapp_message_id: "", state: "outcome_uncertain", send_state: "outcome_uncertain" });
  const result = await runCode("validate-immediate-successful-send.js", {
    $: refs({ "Parse Video Send": incoming }), $json: { values: [current] }
  });
  assert.equal(result[0].json.immediate_persistence_required, true);
  assert.equal(result[0].json.attempts, 1);
});

test("duplicate persistence retry is an idempotent no-op", async () => {
  const incoming = source();
  const current = row({ ...incoming, state: "accepted", send_state: "accepted" });
  const result = await runCode("validate-immediate-successful-send.js", {
    $: refs({ "Parse Video Send": incoming }), $json: { values: [current] }
  });
  assert.equal(result[0].json.immediate_persistence_required, false);
  assert.equal(result[0].json.immediate_persistence_already_durable, true);
  assert.equal(result[0].json.attempts, 1);
});

test("an already logged successful message is not appended again", async () => {
  const incoming = source({ message_log_values: [MESSAGE_HEADERS, MESSAGE_HEADERS.map((name) => ({ whatsapp_message_id: MESSAGE_ID, source_reference: "wa:62000:6941:clip-01.mp4", direction: "outbound", message_type: "video" })[name] || "")] });
  const current = row({ ...incoming, state: "accepted", send_state: "accepted" });
  const result = await runCode("validate-immediate-successful-send.js", {
    $: refs({ "Parse Video Send": incoming }), $json: { values: [current] }
  });
  assert.equal(result[0].json.message_log_append_required, false);
});

test("batched message persistence deduplicates an identical clip result", async () => {
  const incoming = source({ delivery_row_values: row(source()), message_log_append_required: true });
  const result = await runCode("prepare-batched-delivery-tracking.js", {
    $input: { all: () => [{ json: incoming }, { json: { ...incoming } }] }
  });
  assert.equal(result[0].json.message_count, 1);
  assert.equal(result[0].json.message_rows.length, 1);
});

test("different successful message ID for the same clip is a visible conflict", async () => {
  const incoming = source();
  const current = row({ ...incoming, whatsapp_message_id: "wamid.BBBBBBBBBBBBBBBB", state: "accepted", send_state: "accepted" });
  await assert.rejects(() => runCode("validate-immediate-successful-send.js", {
    $: refs({ "Parse Video Send": incoming }), $json: { values: [current] }
  }), /successful_message_id_conflict/);
});

test("read-back confirmation requires the exact stable clip key, ID, and attempt", async () => {
  const incoming = source({ immediate_persistence_required: true });
  const current = row({ ...incoming, state: "accepted", send_state: "accepted" });
  const result = await runCode("confirm-successful-clip-durable.js", {
    $: refs({ "Validate Immediate Successful Send": incoming }), $json: { values: [current] }
  });
  assert.equal(result[0].json.immediate_persistence_verified, true);
});

test("delivery topology persists in-flight and successful states before advancing the loop", () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(ROOT, "n8n", "imports", "affiliate-whatsapp-file-delivery.json"), "utf8"));
  const edge = (name, branch = 0) => workflow.connections[name].main[branch].map((item) => item.node);
  assert.deepEqual(edge("IF Cached Clip Send Authorized", 0), ["Prepare In-Flight Send Claim"]);
  assert.deepEqual(edge("Prepare In-Flight Send Claim"), ["Persist In-Flight Send Claim"]);
  assert.deepEqual(edge("Restore Clip after In-Flight Claim"), ["Send WhatsApp Video"]);
  assert.deepEqual(edge("IF File Send Succeeded", 0), ["Read Delivery Row after Meta Success"]);
  assert.deepEqual(edge("Persist Successful Clip Immediately"), ["Read Back Persisted Successful Clip"]);
  assert.deepEqual(edge("Confirm Successful Clip Durable"), ["Wait Between Recipient Messages"]);
  assert.equal(workflow.nodes.filter((node) => node.type === "n8n-nodes-base.dataTable").length, 0);
  const immediateWrite = workflow.nodes.find((node) => node.name === "Persist Successful Clip Immediately");
  assert.equal(immediateWrite.continueOnFail, undefined);
  assert.equal(immediateWrite.retryOnFail, true);
  assert.equal(immediateWrite.maxTries, 8);
});

test("Meta media upload and send request definitions remain unchanged", () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(ROOT, "n8n", "imports", "affiliate-whatsapp-file-delivery.json"), "utf8"));
  const upload = workflow.nodes.find((node) => node.name === "Upload Video to WhatsApp");
  const send = workflow.nodes.find((node) => node.name === "Send WhatsApp Video");
  assert.equal(upload.parameters.url, "=https://graph.facebook.com/v23.0/{{$env.WHATSAPP_PHONE_NUMBER_ID}}/media");
  assert.equal(upload.retryOnFail, false);
  assert.equal(send.parameters.url, "=https://graph.facebook.com/v23.0/{{$env.WHATSAPP_PHONE_NUMBER_ID}}/messages");
  assert.equal(send.retryOnFail, false);
  assert.match(send.parameters.jsonBody, /type: "video"/);
  assert.match(send.parameters.jsonBody, /caption: "Video " \+ \$json\.file_index/);
});
