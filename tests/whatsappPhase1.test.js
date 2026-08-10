"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const LEADS = [
  "username", "whatsapp_number", "conversation_id", "captured_at",
  "reply_1", "reply_2", "reply_3", "state", "opt_in_message_id",
  "opt_in_sent_at", "opted_in_at", "declined_at", "batch_number",
  "batch_reserved_at", "delivery_started_at", "files_expected",
  "files_sent", "files_delivered", "files_failed", "files_sent_at",
  "files_delivered_at", "posted_confirmed_at", "last_whatsapp_message_id",
  "last_inbound_at", "last_intent", "last_intent_confidence", "last_error",
  "updated_at", "wa_id", "last_inbound_message_id", "window_expires_at"
];
const MESSAGES = [
  "whatsapp_message_id", "recipient_number", "message_type", "template_name",
  "source_workflow", "source_reference", "api_status", "accepted_at",
  "current_status", "status_timestamp", "conversation_json", "pricing_json",
  "errors_json", "error_code", "error_title", "error_message", "error_details",
  "processed_statuses", "status_history_json", "updated_at", "direction",
  "message_payload_json", "send_state", "delivery_state"
];

function row(headers, values) {
  return headers.map((name) => values[name] == null ? "" : String(values[name]));
}

async function runCode(file, args) {
  const source = fs.readFileSync(path.join(ROOT, "n8n", "code", file), "utf8");
  const names = Object.keys(args);
  const fn = new AsyncFunction(...names, source);
  return fn(...names.map((name) => args[name]));
}

function refs(entries) {
  return (name) => {
    const value = entries[name];
    if (!value) throw new Error(`missing mock node ${name}`);
    return {
      first: () => ({ json: value }),
      item: { json: value, binary: value.binary }
    };
  };
}

function event(overrides = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    event_kind: "message", signature_valid: true, wa_id: "628111111111",
    whatsapp_number: "628111111111", whatsapp_message_id: "wamid.in.1",
    whatsapp_timestamp: String(timestamp), n8n_execution_time: new Date().toISOString(),
    message_type: "text", message_text: "MINAT @Creator.Name", raw_event: {}, raw_callback: {},
    ...overrides
  };
}

async function resolveInbound(inbound, leadRows = [], messageRows = []) {
  return runCode("phase1-resolve-lead.js", {
    $: refs({
      "Restore Inbound after Durable Claim": inbound
    }),
    $json: { values: [LEADS, ...leadRows] }
  });
}

test("valid MINAT username refreshes the window and authorizes distribution intent", async () => {
  const inbound = event();
  const result = (await resolveInbound(inbound, [row(LEADS, {
    username: "creator.name", whatsapp_number: inbound.whatsapp_number,
    wa_id: inbound.wa_id, conversation_id: "wa:628111111111", state: "awaiting_username"
  })]))[0].json;
  assert.equal(result.action, "confirmation");
  assert.equal(result.username, "creator.name");
  assert.equal(result.display_username, "@creator.name");
  assert.equal(result.state, "distribution_pending");
  assert.equal(Date.parse(result.window_expires_at) - Date.parse(result.last_inbound_at), 24 * 60 * 60 * 1000);
});

test("missing username or unrelated first contact produces one clarification and no allocation", async () => {
  const inbound = event({ message_text: "halo", whatsapp_message_id: "wamid.in.halo" });
  const first = (await resolveInbound(inbound))[0].json;
  assert.equal(first.action, "clarification");
  assert.equal(first.state, "awaiting_username");
  assert.equal(first.batch_number, "");
  const sent = row(MESSAGES, {
    whatsapp_message_id: "wamid.out.clarify", direction: "outbound",
    source_reference: `clarification:${inbound.wa_id}`, send_state: "sent"
  });
  const later = (await resolveInbound({ ...inbound, whatsapp_message_id: "wamid.in.halo.2" },
    [first.lead_row_values], [sent]))[0].json;
  assert.equal(later.action, "refresh_only");
  assert.equal(later.batch_number, "");
});

test("duplicate inbound Meta message id is claimed only once", async () => {
  const inbound = event();
  const existing = row(MESSAGES, {
    whatsapp_message_id: inbound.whatsapp_message_id, direction: "inbound"
  });
  const result = await runCode("phase1-inbound-claim.js", {
    $: refs({ "When Executed by Webhook Router": inbound }),
    $json: { values: [MESSAGES, existing] }
  });
  assert.equal(result[0].json.inbound_duplicate, true);
});

test("a new inbound refreshes an existing window without implying distribution", async () => {
  const old = event({ message_text: "halo", whatsapp_timestamp: String(Math.floor(Date.now() / 1000) - 3600) });
  const first = (await resolveInbound(old))[0].json;
  const newer = event({ message_text: "😊", message_type: "text", whatsapp_message_id: "wamid.in.emoji" });
  const second = (await resolveInbound(newer, [first.lead_row_values], [row(MESSAGES, {
    direction: "outbound", source_reference: `clarification:${newer.wa_id}`, send_state: "sent"
  })]))[0].json;
  assert.ok(Date.parse(second.window_expires_at) > Date.parse(first.window_expires_at));
  assert.equal(second.action, "refresh_only");
});

test("text send guard allows an active matching window and fails closed when expired", async () => {
  const inbound = event();
  const now = new Date();
  const source = {
    ...inbound, action: "clarification", row_number: 2,
    username: "testusername",
    last_inbound_at: now.toISOString(), window_expires_at: new Date(now.getTime() + 60_000).toISOString()
  };
  const activeRow = row(LEADS, {
    whatsapp_number: inbound.whatsapp_number, wa_id: inbound.wa_id,
    last_inbound_message_id: inbound.whatsapp_message_id,
    last_inbound_at: source.last_inbound_at, window_expires_at: source.window_expires_at
  });
  const active = await runCode("phase1-send-guard.js", {
    $: refs({ "Restore Inbound after Lead Write": source }),
    $json: { values: [LEADS, activeRow] },
    $env: {
      ZERO_CHARGE_MODE: "true", WHATSAPP_PHASE1_ENABLED: "true",
      WHATSAPP_TEST_MODE: "true", WHATSAPP_LIVE_TEST_ARMED: "true",
      WHATSAPP_TEST_RECIPIENT_NUMBER: inbound.whatsapp_number,
      WHATSAPP_TEST_AFFILIATE_USERNAME: "testusername"
    }
  });
  assert.equal(active[0].json.outbound_allowed, true);
  const expectedConfirmation = [
    "Halo kak",
    "Terima kasih sudah tertarik bergabung sebagai Affiliate PROYA. Kami ingin mengirimkan materi video yang dapat Kakak upload ke TikTok untuk mempromosikan produk PROYA dan mendapatkan komisi.",
    "",
    "Sebelum menerima video, mohon perhatikan ketentuan berikut:",
    "✅ Upload video ke akun TikTok Kakak dan tambahkan keranjang kuning produk PROYA.",
    "✅ Cantumkan @proya_official di bio TikTok sebagai tanda bahwa Kakak bekerja sama dengan PROYA.",
    "✅ Video boleh diedit ringan, seperti menambahkan caption, subtitle, musik, atau potongan singkat. Namun, isi dan konteks utama video tidak boleh diubah.",
    "✅ Jangan menambahkan klaim berlebihan atau klaim medis, seperti “pasti putih”, “hasil instan”, atau “menghilangkan jerawat permanen”. Gunakan kalimat yang lebih aman, misalnya “membantu merawat kulit” atau “membantu mencerahkan kulit”.",
    "✅ Hindari mengunggah terlalu banyak video serupa dalam waktu berdekatan untuk mengurangi risiko pelanggaran konten tidak orisinal.",
    "",
    "Jika mendapat pelanggaran “Konten Tidak Orisinal”, Kakak dapat mengajukan banding dan menggunakan screenshot percakapan ini sebagai bukti bahwa PROYA telah memberikan izin penggunaan video."
  ].join("\n");
  const confirmation = await runCode("phase1-send-guard.js", {
    $: refs({ "Restore Inbound after Lead Write": { ...source, action: "confirmation" } }),
    $json: { values: [LEADS, activeRow] },
    $env: {
      ZERO_CHARGE_MODE: "true", WHATSAPP_PHASE1_ENABLED: "true",
      WHATSAPP_TEST_MODE: "true", WHATSAPP_LIVE_TEST_ARMED: "true",
      WHATSAPP_TEST_RECIPIENT_NUMBER: inbound.whatsapp_number,
      WHATSAPP_TEST_AFFILIATE_USERNAME: "testusername"
    }
  });
  assert.equal(confirmation[0].json.outbound_body, expectedConfirmation);
  const expiredRow = [...activeRow];
  expiredRow[LEADS.indexOf("window_expires_at")] = new Date(now.getTime() - 1).toISOString();
  const expired = await runCode("phase1-send-guard.js", {
    $: refs({ "Restore Inbound after Lead Write": source }),
    $json: { values: [LEADS, expiredRow] },
    $env: { ZERO_CHARGE_MODE: "true", WHATSAPP_PHASE1_ENABLED: "true" }
  });
  assert.equal(expired[0].json.outbound_allowed, false);
  assert.equal(expired[0].json.blocked_log_code, "blocked_by_zero_charge_mode");
});

test("templates and unguarded Meta sends are absent from Phase 1 definitions", () => {
  for (const file of [
    "affiliate-whatsapp-opt-in.json", "affiliate-whatsapp-reply-status.json",
    "affiliate-whatsapp-file-delivery.json"
  ]) {
    const workflow = JSON.parse(fs.readFileSync(path.join(ROOT, "n8n", "imports", file), "utf8"));
    const serialized = JSON.stringify(workflow);
    assert.doesNotMatch(serialized, /type\\?\"?:\s*\\?\"template/i);
  }
  const delivery = JSON.parse(fs.readFileSync(path.join(ROOT, "n8n", "imports", "affiliate-whatsapp-file-delivery.json"), "utf8"));
  assert.equal(delivery.connections["IF Media Upload Succeeded"].main[0][0].node, "Guard Cached Clip Send");
});

test("generated reply workflow contains the current clip introduction message", () => {
  const workflow = JSON.parse(fs.readFileSync(
    path.join(ROOT, "n8n", "imports", "affiliate-whatsapp-reply-status.json"),
    "utf8"
  ));
  const guard = workflow.nodes.find((node) => node.name === "Guard Phase 1 Text Send");
  assert.ok(guard);
  assert.match(guard.parameters.jsCode, /Halo kak/);
  assert.match(guard.parameters.jsCode, /Sebelum menerima video, mohon perhatikan ketentuan berikut:/);
  assert.match(guard.parameters.jsCode, /PROYA telah memberikan izin penggunaan video/);
  assert.doesNotMatch(guard.parameters.jsCode, /Terima kasih sudah tertarik bekerja sama dengan PROYA/);
});

test("duplicate affiliate ownership blocks a second batch assignment", async () => {
  const source = { conversation_id: "wa:1", username: "Creator", whatsapp_number: "628111111111", wa_id: "628111111111" };
  const current = row(LEADS, source);
  const duplicate = row(LEADS, { conversation_id: "wa:2", username: "@creator", whatsapp_number: "628222222222", batch_number: "100" });
  const output = await runCode("select-local-batch.js", {
    $: refs({
      "When Executed after Opt-in": source,
      "Read WhatsApp Leads for Reservation": { values: [LEADS, current, duplicate] },
      "Read Historical Assignments": { values: [[]] }
    }),
    $json: { stdout: "100\n101" },
    $env: { WHATSAPP_TEST_MODE: "false" }
  });
  assert.equal(output[0].json.reservation_ok, false);
  assert.equal(output[0].json.queue_reason, "duplicate_affiliate_batch_ownership");
});

test("blocked clips return to the loop without a Sheet write", () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(ROOT, "n8n", "imports", "affiliate-whatsapp-file-delivery.json"), "utf8"));
  assert.equal(workflow.connections["Wait Between Recipient Messages"].main[0][0].node, "Loop Through Files");
  assert.equal(workflow.connections["IF Cached Clip Send Authorized"].main[1][0].node, "Prepare Blocked Clip Result");
  assert.equal(workflow.connections["Prepare Blocked Clip Result"].main[0][0].node, "Wait Between Recipient Messages");
  assert.equal(workflow.nodes.some((node) => node.name === "Mark Waiting after Blocked Clip"), false);
});

test("Phase 1 patch preserves write-specific Google Sheets ranges and query parameters", () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(ROOT, "n8n", "imports", "affiliate-whatsapp-file-delivery.json"), "utf8"));
  const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
  const reserve = byName.get("Reserve Batch in Leads");
  assert.equal(reserve.parameters.method, "PUT");
  assert.match(reserve.parameters.url, /A\{\{\$json\.row_number\}\}%3AAE\{\{\$json\.row_number\}\}/);
  assert.match(reserve.parameters.url, /valueInputOption=RAW/);
  const claimBatch = byName.get("Batch Write Pre-Send Claims");
  assert.equal(claimBatch.parameters.method, "POST");
  assert.match(claimBatch.parameters.url, /values:batchUpdate/);
  assert.equal(claimBatch.maxTries, 8);
  const updateLog = byName.get("Batch Write Delivery Results");
  assert.equal(updateLog.parameters.method, "POST");
  assert.match(updateLog.parameters.url, /values:batchUpdate/);
  assert.equal(updateLog.continueOnFail, true);
  const appendLog = byName.get("Append Message Results Batch");
  assert.equal(appendLog.parameters.method, "POST");
  assert.match(appendLog.parameters.url, /A%3AX:append/);
  assert.match(appendLog.parameters.url, /:append\?valueInputOption=RAW/);
  assert.equal(appendLog.continueOnFail, true);
  const parseVideo = byName.get("Parse Video Send").parameters.jsCode;
  assert.match(parseVideo, /const errorCode =/);
  assert.match(parseVideo, /const sendState =/);
  const reply = JSON.parse(fs.readFileSync(path.join(ROOT, "n8n", "imports", "affiliate-whatsapp-reply-status.json"), "utf8"));
  assert.equal(reply.nodes.some((node) => node.name === "Update Delivery Log Status"), false);
  const summarizeDelivery = byName.get("Prepare Cached Delivery Summary").parameters.jsCode;
  assert.match(summarizeDelivery, /source\.expected_clip_count/);
  assert.match(summarizeDelivery, /files_expected: String\(expected\)/);
  assert.match(summarizeDelivery, /new Map\(\)/);
  assert.match(summarizeDelivery, /\["delivered","read"\]/);
  assert.match(summarizeDelivery, /\["accepted","sent","delivered","read"\]/);
});

test("failed Meta status preserves evidence and separates send from delivery state", async () => {
  const existing = row(MESSAGES, {
    whatsapp_message_id: "wamid.out.1", api_status: "accepted", current_status: "accepted",
    send_state: "accepted", processed_statuses: "[]", status_history_json: "[]"
  });
  const status = {
    whatsapp_message_id: "wamid.out.1", delivery_status: "failed",
    whatsapp_timestamp: "123", whatsapp_number: "628111111111",
    errors: [{ code: 131042, title: "Payment issue", message: "Payment issue", error_data: { details: "billing" } }],
    error_code: "131042", error_title: "Payment issue", error_message: "Payment issue",
    error_details: "billing", raw_callback: { entry: [] }, n8n_execution_time: new Date().toISOString()
  };
  const result = await runCode("prepare-whatsapp-status-update.js", {
    $: refs({ "Loop Through Status Events": status }),
    $json: { values: [MESSAGES, existing] }
  });
  assert.equal(result[0].json.send_state, "failed");
  assert.equal(result[0].json.delivery_state, "");
  assert.equal(result[0].json.error_code, "131042");
  assert.match(result[0].json.status_history_json, /raw_callback/);
});

test("status-only webhook data is not classified as an inbound message", () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(ROOT, "n8n", "imports", "affiliate-whatsapp-webhook-router.json"), "utf8"));
  assert.equal(workflow.connections["IF Status Event"].main[0][0].node, "Done: Status Sheet Logging Paused");
  assert.equal(workflow.connections["IF Status Event"].main[1][0].node, "IF Message Event");
});
