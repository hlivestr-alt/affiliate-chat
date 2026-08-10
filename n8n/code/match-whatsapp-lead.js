const HEADERS = [
  "username", "whatsapp_number", "conversation_id", "captured_at",
  "reply_1", "reply_2", "reply_3", "state", "opt_in_message_id",
  "opt_in_sent_at", "opted_in_at", "declined_at", "batch_number",
  "batch_reserved_at", "delivery_started_at", "files_expected",
  "files_sent", "files_delivered", "files_failed", "files_sent_at",
  "files_delivered_at", "posted_confirmed_at", "last_whatsapp_message_id",
  "last_inbound_at", "last_intent", "last_intent_confidence",
  "last_error", "updated_at"
];

function text(value) {
  return value == null ? "" : String(value).trim();
}

function digits(value) {
  return text(value).replace(/\D/g, "");
}

const event = $("When Executed by Webhook Router").item.json;
const values = Array.isArray($json.values) ? $json.values : [];
const rows = values.slice(1).map((row, index) => {
  const record = { row_number: index + 2 };
  HEADERS.forEach((name, column) => {
    record[name] = text(row[column]);
  });
  return record;
});

if (event.event_kind === "status") {
  const messageId = text(event.whatsapp_message_id);
  const idMatches = rows.filter((row) =>
    messageId &&
    [row.opt_in_message_id, row.last_whatsapp_message_id].includes(messageId)
  );
  const matched = idMatches.length === 1 ? idMatches[0] : {};
  return [{
    json: {
      ...event,
      ...matched,
      route: "status",
      matched_by: idMatches.length === 1 ? "wamid" : "delivery_log_pending",
      matched_lead_count: idMatches.length
    }
  }];
}

if (event.event_kind !== "message") {
  return [{ json: { ...event, route: "ignored" } }];
}

const eventDigits = digits(event.whatsapp_number);
const matches = rows.filter((row) => digits(row.whatsapp_number) === eventDigits);

if (matches.length !== 1) {
  return [{
    json: {
      ...event,
      route: "queue",
      queue_reason: matches.length ? "ambiguous_phone_match" : "unknown_phone",
      matched_lead_count: matches.length
    }
  }];
}

return [{
  json: {
    ...event,
    ...matches[0],
    route: event.event_kind
  }
}];
