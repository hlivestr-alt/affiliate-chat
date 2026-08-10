function text(value) { return value == null ? "" : String(value).trim(); }
function records(values) {
  const rows = Array.isArray(values) ? values : [];
  const headers = (rows[0] || []).map(text);
  return rows.slice(1).map((row, index) => ({
    row_number: index + 2,
    ...Object.fromEntries(headers.map((name, column) => [name, text(row[column])]))
  }));
}

const source = $("Restore and Validate Delivery Context").first().json;
if (source.delivery_context_valid !== true) throw new Error("delivery_context_not_validated");
const deliveryRows = records(source.delivery_log_values).filter((row) =>
  row.conversation_id === text(source.conversation_id) && row.batch_number === text(source.batch_number)
);
const messageRows = records(source.message_log_values).filter((row) =>
  row.direction === "outbound" && row.message_type === "video"
);
const blockedDeliveryKeys = new Set();
for (const row of deliveryRows) {
  const uploadReady = ["upload_ready", "upload_ready_no_message"].includes(row.send_state) && Boolean(row.media_id) && !row.whatsapp_message_id;
  // A pre-send claim with no media ID or wamid is not proof of a send. Treating
  // it as delivered work made interrupted batches permanently skip unsent clips.
  const uncertainOrAccepted = ["accepted", "sent", "outcome_uncertain"].includes(row.send_state) ||
    ["accepted", "sent", "delivered", "read", "outcome_uncertain"].includes(row.state) ||
    (!uploadReady && Boolean(row.media_id)) || Boolean(row.whatsapp_message_id);
  if (uncertainOrAccepted) blockedDeliveryKeys.add(row.delivery_key);
}
for (const row of messageRows) {
  if (row.source_reference && (row.whatsapp_message_id || ["accepted", "sent", "outcome_uncertain"].includes(row.send_state || row.api_status))) {
    blockedDeliveryKeys.add(row.source_reference);
  }
}

const items = $input.all().sort((a, b) =>
  text(a.binary?.data?.fileName).localeCompare(text(b.binary?.data?.fileName))
);
const expectedCount = Number(source.expected_clip_count);
if (items.length !== expectedCount) throw new Error(`Assigned batch must contain exactly ${expectedCount} MP4 files; found ${items.length}`);

const prepared = items.map((item, index) => {
  const fileName = text(item.binary?.data?.fileName);
  const deliveryKey = `${text(source.conversation_id)}:${text(source.batch_number)}:${fileName}`;
  const existing = deliveryRows.find((row) => row.delivery_key === deliveryKey || row.file_name === fileName);
  return {
    json: {
      ...source,
      file_index: index + 1,
      file_name: fileName,
      delivery_key: deliveryKey,
      attempts: Number(existing?.attempts || 0) + 1,
      delivery_log_row_number: existing?.row_number || "",
      existing_media_id: ["upload_ready", "upload_ready_no_message"].includes(existing?.send_state) ? existing.media_id : "",
      existing_uploaded_at: ["upload_ready", "upload_ready_no_message"].includes(existing?.send_state) ? existing.uploaded_at : "",
      resume_blocked: blockedDeliveryKeys.has(deliveryKey)
    },
    binary: item.binary
  };
});
const pending = prepared.filter((item) => !item.json.resume_blocked);
return pending.map((item, index) => ({
  ...item,
  json: {
    ...item.json,
    resume_position: index + 1,
    remaining_clip_count: pending.length - index
  }
}));
