function text(value) {
  return value == null ? "" : String(value).trim();
}

const source = $("Prepare FAQ Classification").first().json;
const faqRows = source.active_faq_rows || [];
const response = $json || {};
const content = response.choices?.[0]?.message?.content;
let parsed;
try {
  parsed = typeof content === "string" ? JSON.parse(content) : content;
} catch {
  parsed = null;
}

const intent = text(parsed && parsed.intent);
const confidence = Number(parsed && parsed.confidence);
const faq = faqRows.find((row) => text(row.intent) === intent);
const configured = Number(faq && faq.min_confidence);
const threshold = Number.isFinite(configured) && configured > 0
  ? Math.max(0.85, configured)
  : 0.85;
const canReply =
  faq &&
  Number.isFinite(confidence) &&
  confidence >= threshold &&
  Boolean(text(faq.answer));

return [{
  json: {
    ...source,
    predicted_intent: intent,
    confidence: Number.isFinite(confidence) ? confidence : "",
    faq_action: canReply ? "reply" : "queue",
    faq_answer: canReply ? text(faq.answer) : "",
    queue_reason: canReply
      ? ""
      : !parsed
        ? "invalid_llm_json"
        : !faq
          ? "unknown_intent"
          : "low_confidence"
  }
}];
