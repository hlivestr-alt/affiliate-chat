const crypto = require("node:crypto");

function text(value) {
  return value == null ? "" : String(value);
}

const inputItem = $input.first();
const input = inputItem.json;
const receivedAt = new Date().toISOString();
const headers = input.headers || {};
const signature = text(
  headers["x-hub-signature-256"] || headers["X-Hub-Signature-256"]
).trim();
let rawBody = Buffer.alloc(0);
if (inputItem.binary && inputItem.binary.data) {
  rawBody = await helpers.getBinaryDataBuffer(0, "data");
} else if (Buffer.isBuffer(input.rawBody)) {
  rawBody = input.rawBody;
} else if (input.rawBody) {
  rawBody = Buffer.from(text(input.rawBody), "utf8");
}
const secret = text($env.WHATSAPP_APP_SECRET);

if (!secret || !rawBody.length || !signature.startsWith("sha256=")) {
  return [{
    json: {
      signature_valid: false,
      signature_error: !secret
        ? "missing_app_secret"
        : !rawBody.length
          ? "missing_raw_body"
          : "missing_signature"
    }
  }];
}

const expected = `sha256=${crypto
  .createHmac("sha256", secret)
  .update(rawBody)
  .digest("hex")}`;
const suppliedBuffer = Buffer.from(signature);
const expectedBuffer = Buffer.from(expected);
if (
  suppliedBuffer.length !== expectedBuffer.length ||
  !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
) {
  return [{ json: { signature_valid: false, signature_error: "invalid_signature" } }];
}

let payload;
try {
  payload = JSON.parse(rawBody.toString("utf8"));
} catch {
  return [{ json: { signature_valid: false, signature_error: "invalid_json" } }];
}

const events = [];
for (const entry of payload.entry || []) {
  for (const change of entry.changes || []) {
    const value = change.value || {};
    const contacts = Array.isArray(value.contacts) ? value.contacts : [];
    for (const message of value.messages || []) {
      const contact = contacts.find((item) => text(item && item.wa_id) === text(message.from)) || contacts[0] || {};
      const interactive = message.interactive || {};
      const buttonReply = interactive.button_reply || {};
      const listReply = interactive.list_reply || {};
      const button = message.button || {};
      events.push({
        json: {
          event_kind: "message",
          signature_valid: true,
          waba_id: text(entry.id),
          phone_number_id: text(value.metadata && value.metadata.phone_number_id),
          wa_id: text(contact.wa_id || message.from),
          sender_phone_number: text(message.from),
          sender_profile_name: text(contact.profile && contact.profile.name),
          whatsapp_number: text(message.from),
          whatsapp_message_id: text(message.id),
          whatsapp_timestamp: text(message.timestamp),
          message_type: text(message.type),
          message_text: text(
            (message.text && message.text.body) ||
            buttonReply.title ||
            listReply.title ||
            button.text
          ),
          reply_payload: text(
            buttonReply.id ||
            listReply.id ||
            button.payload
          ),
          raw_event: message,
          raw_callback: payload,
          n8n_execution_time: receivedAt
        }
      });
    }
    for (const status of value.statuses || []) {
      const errors = Array.isArray(status.errors) ? status.errors : [];
      const firstError = errors[0] || {};
      const errorData = firstError.error_data || {};
      const messageId = text(status.id);
      const deliveryStatus = text(status.status).toLowerCase();
      events.push({
        json: {
          event_kind: "status",
          signature_valid: true,
          waba_id: text(entry.id),
          phone_number_id: text(value.metadata && value.metadata.phone_number_id),
          whatsapp_number: text(status.recipient_id),
          whatsapp_message_id: messageId,
          whatsapp_timestamp: text(status.timestamp),
          delivery_status: deliveryStatus,
          status_event_key: `${messageId}:${deliveryStatus}`,
          conversation: status.conversation || {},
          pricing: status.pricing || {},
          errors,
          error_code: text(firstError.code),
          error_title: text(firstError.title),
          error_message: text(firstError.message),
          error_details: text(errorData.details),
          last_error: text(
            firstError.message || firstError.title || errorData.details
          ),
          raw_event: status,
          raw_callback: payload,
          n8n_execution_time: receivedAt
        }
      });
    }
  }
}

const eventKinds = [...new Set(events.map((item) => item.json.event_kind))];
console.log(
  `whatsapp_webhook_received event_types=${eventKinds.join(",") || "ignored"}` +
  ` status_count=${events.filter((item) => item.json.event_kind === "status").length}` +
  ` message_count=${events.filter((item) => item.json.event_kind === "message").length}`
);

return events.length
  ? events
  : [{
      json: {
        event_kind: "ignored",
        signature_valid: true,
        raw_callback: payload,
        n8n_execution_time: receivedAt
      }
    }];
