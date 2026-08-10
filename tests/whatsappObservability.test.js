"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CHAT_HEADERS,
  CLIP_HEADERS,
  mergeChatRecord,
  mergeClipRecord,
  normalizeEvent,
  sanitize
} = require("../src/whatsappObservability");

const ROOT = path.resolve(__dirname, "..");
const workflow = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "n8n", "imports", name), "utf8"));

function upsert(map, normalized) {
  const key = normalized.chat_dedup_key;
  if (!key) return;
  map.set(key, map.has(key) ? mergeChatRecord(map.get(key), normalized.chat) : normalized.chat);
}

test("inbound text and duplicate webhook produce one readable chat row", () => {
  const event = { observability_kind: "authenticated_webhook", event_kind: "message", message_type: "text", message_text: "MINAT @creator.one", whatsapp_message_id: "wamid.in.1", whatsapp_number: "62811", wa_id: "62811", whatsapp_timestamp: "1785800000", workflow_name: "AffWaWebhook2026", execution_id: "100" };
  const rows = new Map();
  upsert(rows, normalizeEvent(event, "2026-08-04T00:00:00Z"));
  upsert(rows, normalizeEvent({ ...event, inbound_duplicate: true, processing_result: "ignored_duplicate" }, "2026-08-04T00:00:01Z"));
  assert.equal(rows.size, 1);
  assert.equal([...rows.values()][0]["Message Text"], "MINAT @creator.one");
});

test("clarification and confirmation text sends retain wamid and reply text", () => {
  for (const action of ["clarification", "confirmation"]) {
    const row = normalizeEvent({ observability_kind: "outbound_text", action, outbound_body: `${action} body`, outbound_source_reference: `${action}:wamid.in`, returned_wamid: `wamid.${action}`, whatsapp_number: "62812", send_state: "accepted", workflow_name: "AffWaReply2026" }).chat;
    assert.equal(row["Event Type"], action);
    assert.equal(row["Message Text"], `${action} body`);
    assert.equal(row["Outbound wamid"], `wamid.${action}`);
  }
});

test("one numbered folder with fifteen exact files creates fifteen distinct clip keys", () => {
  const rows = Array.from({ length: 15 }, (_, index) => normalizeEvent({ observability_kind: "clip_assigned", batch_number: "6901", conversation_id: "wa:1", file_index: index + 1, file_name: `clip-${String(index + 1).padStart(2, "0")}.mp4`, delivery_key: `wa:1:6901:clip-${index + 1}.mp4`, whatsapp_number: "62813", workflow_name: "AffWaDelivery2026" }).clip);
  assert.equal(rows.length, 15);
  assert.equal(new Set(rows.map((row) => row["Delivery Key"])).size, 15);
  assert(rows.every((row) => row["Folder Number"] === "6901"));
  assert.equal(rows[14]["Clip Filename"], "clip-15.mp4");
});

test("status callbacks update the right row monotonically and remain idempotent", () => {
  const accepted = normalizeEvent({ observability_kind: "clip_send", delivery_key: "d1", file_name: "one.mp4", batch_number: "1", returned_wamid: "wamid.out.1", send_state: "accepted" }).clip;
  const delivered = normalizeEvent({ observability_kind: "authenticated_webhook", delivery_status: "delivered", whatsapp_message_id: "wamid.out.1", whatsapp_timestamp: "1785800100" }).clip;
  const sentLater = normalizeEvent({ observability_kind: "authenticated_webhook", delivery_status: "sent", whatsapp_message_id: "wamid.out.1", whatsapp_timestamp: "1785800000" }).clip;
  const once = mergeClipRecord(accepted, delivered);
  const duplicate = mergeClipRecord(once, delivered);
  const older = mergeClipRecord(duplicate, sentLater);
  assert.equal(older["Delivery State"], "delivered");
  assert.equal(older["Delivered At"], once["Delivered At"]);
});

test("failed callback preserves complete Meta error fields and window block is visible", () => {
  const failed = normalizeEvent({ observability_kind: "authenticated_webhook", delivery_status: "failed", whatsapp_message_id: "wamid.fail", error_code: "131042", error_title: "Payment issue", error_details: "Complete Meta details" }).chat;
  assert.equal(failed["Error Code"], "131042");
  assert.equal(failed["Error Title"], "Payment issue");
  assert.equal(failed["Error Details"], "Complete Meta details");
  const blocked = normalizeEvent({ observability_kind: "clip_guard", outbound_allowed: false, blocked_reason: "no_active_customer_service_window", delivery_key: "d2" }).clip;
  assert.equal(blocked["Current Result"], "Blocked: window expired");
});

test("accepted is never counted as delivered and distinct contacts/folders stay distinct", () => {
  const chat = ["6281", "6281", "6282"].map((wa_id, index) => normalizeEvent({ observability_kind: "authenticated_webhook", event_kind: "message", message_type: "text", whatsapp_message_id: `in.${index}`, wa_id }).chat);
  assert.equal(new Set(chat.map((row) => row.wa_id)).size, 2);
  const clip = normalizeEvent({ observability_kind: "clip_send", delivery_key: "d3", returned_wamid: "wamid.accepted", send_state: "accepted" }).clip;
  assert.notEqual(clip["Delivery State"], "delivered");
});

test("historical/live merge does not duplicate and headers contain required audit columns", () => {
  const existing = Object.fromEntries(CHAT_HEADERS.map((header) => [header, ""]));
  existing["Deduplication Key"] = "inbound:1";
  existing["Record Source"] = "historical_backfill";
  const live = { ...existing, "Record Source": "live", "Updated At": "2026-08-04T00:00:00Z" };
  const merged = mergeChatRecord(existing, live);
  assert.equal(merged["Deduplication Key"], "inbound:1");
  assert(CHAT_HEADERS.includes("Outbound wamid"));
  assert(CLIP_HEADERS.includes("Full Local Source Path"));
});

test("raw sanitization removes credentials, authorization, tokens, and secrets", () => {
  const clean = JSON.stringify(sanitize({ Authorization: "Bearer abc", access_token: "abc", nested: { app_secret: "secret", safe: "ok" } }));
  assert.doesNotMatch(clean, /Bearer abc|"abc"|"secret"/);
  assert.match(clean, /<redacted>/);
});

test("observability producers are paused and sender keeps batched tracking", () => {
  const observer = workflow("affiliate-whatsapp-observability.json");
  const serialized = JSON.stringify(observer);
  assert.doesNotMatch(serialized, /graph\.facebook\.com|type\s*[:=]\s*["']template/i);
  for (const file of ["affiliate-whatsapp-webhook-router.json", "affiliate-whatsapp-reply-status.json"]) {
    const patched = workflow(file);
    const calls = patched.nodes.filter((node) => node.type === "n8n-nodes-base.executeWorkflow" && node.parameters?.workflowId?.value === "AffWaObservability2026");
    assert.equal(calls.length, 0);
  }
  const delivery = workflow("affiliate-whatsapp-file-delivery.json");
  const deliveryCalls = delivery.nodes.filter((node) => node.type === "n8n-nodes-base.executeWorkflow" && node.parameters?.workflowId?.value === "AffWaObservability2026");
  assert.equal(deliveryCalls.length, 0);
  assert.ok(delivery.nodes.some((node) => node.name === "Prepare Batched Delivery Tracking"));
});

test("generated Chat and Clip upsert Code nodes execute their embedded merge helper", () => {
  const observer = workflow("affiliate-whatsapp-observability.json");
  for (const [nodeName, headers, source] of [
    ["Prepare Chat Upsert", CHAT_HEADERS, {
      kind: "authenticated_webhook", delivery_status: "delivered", chat_dedup_key: "outbound:wamid.runtime",
      chat: { ...Object.fromEntries(CHAT_HEADERS.map((header) => [header, ""])), "Outbound wamid": "wamid.runtime", "Delivery State": "delivered", "Deduplication Key": "outbound:wamid.runtime" }
    }],
    ["Prepare Clip Upsert", CLIP_HEADERS, {
      kind: "clip_send", clip_dedup_key: "delivery:runtime",
      clip: { ...Object.fromEntries(CLIP_HEADERS.map((header) => [header, ""])), "Delivery Key": "delivery:runtime", "Current Result": "Accepted by Meta" }
    }]
  ]) {
    const existing = headers.map(() => "");
    const keyHeader = nodeName.includes("Chat") ? "Deduplication Key" : "Delivery Key";
    existing[headers.indexOf(keyHeader)] = source[nodeName.includes("Chat") ? "chat_dedup_key" : "clip_dedup_key"];
    const codeNode = observer.nodes.find((node) => node.name === nodeName);
    const execute = new Function("$", "$json", codeNode.parameters.jsCode);
    const result = execute(() => ({ first: () => ({ json: source }) }), { values: [headers, existing] });
    assert.equal(result[0].json.write_action, "update");
  }
});
