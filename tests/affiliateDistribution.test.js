"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  aggregateDelivery,
  classifyOptIn,
  humanQueueCase,
  isPostedConfirmation,
  parseModelClassification,
  planDelivery,
  reservationWinner,
  selectFaqAnswer,
  selectNextBatch,
  verifyMetaSignature
} = require("../src/affiliateDistribution");

test("explicit opt-in accepts only the configured payloads and narrow text", () => {
  assert.equal(classifyOptIn({ payload: "YES_SEND_CLIPS" }).action, "opted_in");
  assert.equal(classifyOptIn({ text: "Iya" }).action, "opted_in");
  assert.equal(classifyOptIn({ text: "Ya, Saya Setuju" }).action, "opted_in");
  assert.equal(classifyOptIn({ text: "**Ya, Saya Setuju**" }).action, "opted_in");
  assert.equal(classifyOptIn({ text: "**“YA, SAYA SETUJU”**" }).action, "opted_in");
  assert.equal(classifyOptIn({ payload: "NO_THANKS" }).action, "declined");
  assert.equal(classifyOptIn({ text: "Tidak" }).action, "declined");
  assert.equal(
    classifyOptIn({ text: "Iya, tapi kapan videonya dikirim?" }).action,
    "classify"
  );
});

test("batch selection uses the lowest local folder absent from both trackers", () => {
  const selected = selectNextBatch(
    ["3866", "not-a-batch", "3864", "3865"],
    [{ batch_number: "3864" }],
    [{ original_batch_number: "3865" }]
  );
  assert.equal(selected, "3866");
});

test("reservation winner is deterministic by timestamp then conversation id", () => {
  const winner = reservationWinner(
    [
      {
        batch_number: "3864",
        batch_reserved_at: "2026-07-31T00:00:00.000Z",
        conversation_id: "b"
      },
      {
        batch_number: "3864",
        batch_reserved_at: "2026-07-31T00:00:00.000Z",
        conversation_id: "a"
      }
    ],
    "3864"
  );
  assert.equal(winner.conversation_id, "a");
});

test("delivery planning requires 15 MP4s and skips previously sent files", () => {
  const files = Array.from({ length: 15 }, (_, index) => ({
    name: `clip-${String(index + 1).padStart(2, "0")}.mp4`,
    path: `/clips/3864/clip-${String(index + 1).padStart(2, "0")}.mp4`
  }));
  const plan = planDelivery(files, [
    { file_name: "clip-01.mp4", state: "sent" },
    { file_name: "clip-02.mp4", state: "delivered" }
  ]);
  assert.equal(plan.ok, true);
  assert.equal(plan.pending.length, 13);
  assert.equal(plan.pending[0].file_index, 3);
  assert.equal(planDelivery(files.slice(0, 14), []).reason, "unexpected_file_count");
});

test("FAQ answer is allow-listed and confidence-gated", () => {
  const faq = [{
    intent: "delivery_timing",
    answer: "Video akan dikirim setelah opt-in.",
    active: "TRUE",
    min_confidence: "0.9"
  }];
  assert.deepEqual(
    selectFaqAnswer(faq, { intent: "delivery_timing", confidence: 0.95 }),
    {
      action: "reply",
      intent: "delivery_timing",
      confidence: 0.95,
      answer: "Video akan dikirim setelah opt-in."
    }
  );
  assert.equal(
    selectFaqAnswer(faq, { intent: "delivery_timing", confidence: 0.89 }).action,
    "escalate"
  );
  assert.equal(
    selectFaqAnswer(faq, { intent: "invented", confidence: 1 }).reason,
    "unknown_intent"
  );
  assert.equal(parseModelClassification("not json").valid, false);
});

test("posted confirmation is recognized independently of the FAQ catalog", () => {
  assert.equal(isPostedConfirmation("Sudah aku upload kak"), true);
  assert.equal(isPostedConfirmation("Kapan uploadnya?"), false);
});

test("Meta webhook signature validation uses the exact raw body", () => {
  const crypto = require("node:crypto");
  const raw = '{"object":"whatsapp_business_account"}';
  const secret = "test-secret";
  const signature = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(raw)
    .digest("hex")}`;
  assert.equal(verifyMetaSignature(raw, signature, secret), true);
  assert.equal(verifyMetaSignature(`${raw}\n`, signature, secret), false);
});

test("delivery aggregation advances only after all 15 delivered callbacks", () => {
  const sent = Array.from({ length: 15 }, () => ({ state: "sent" }));
  assert.equal(aggregateDelivery(sent).state, "files_sent");
  const delivered = Array.from({ length: 15 }, () => ({ state: "delivered" }));
  assert.equal(aggregateDelivery(delivered).state, "files_delivered");
});

test("human queue IDs deduplicate the same message and reason", () => {
  const now = () => new Date("2026-07-31T00:00:00.000Z");
  const first = humanQueueCase({
    source_message_id: "wamid.1",
    conversation_id: "conv-1",
    reason: "low_confidence"
  }, now);
  const second = humanQueueCase({
    source_message_id: "wamid.1",
    conversation_id: "conv-1",
    reason: "low_confidence"
  }, now);
  assert.equal(first.case_id, second.case_id);
});
