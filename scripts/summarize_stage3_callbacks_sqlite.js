"use strict";

const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");

const database = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);

database.get(
  'select "message_rows_json" payload from "data_table_user_uoxclxRHcZAECvLC" where "batch_number" = ?',
  ["TEST15-20260805"],
  (queueError, queueRow) => {
    if (queueError) throw queueError;
    if (!queueRow) throw new Error("Stage 3 queue payload missing");
    const messageRows = JSON.parse(queueRow.payload || "[]");
    const targets = new Set(messageRows.map((row) => String(row[0] || "")).filter(Boolean));
    database.all(
      `select e.id,e.status,e.startedAt,d.data from execution_entity e
       join execution_data d on d.executionId=e.id
       where e.workflowId='AffWaWebhook2026' and e.id>=15870 order by e.id`,
      (executionError, rows) => {
        if (executionError) throw executionError;
        const callbacks = [];
        for (const row of rows) {
          const execution = parse(row.data);
          const runs = execution?.resultData?.runData?.["Verify and Parse WhatsApp Webhook"] || [];
          for (const run of runs) {
            for (const item of run?.data?.main?.[0] || []) {
              const event = item?.json || {};
              if (event.event_kind === "status" && targets.has(String(event.whatsapp_message_id || ""))) {
                callbacks.push({
                  execution_id: row.id,
                  execution_status: row.status,
                  started_at_utc: row.startedAt,
                  wamid: event.whatsapp_message_id,
                  status: event.delivery_status,
                  signature_valid: event.signature_valid,
                  error_code: event.error_code || "",
                  error_message: event.error_message || ""
                });
              }
            }
          }
        }
        const byWamid = [...targets].map((wamid) => ({
          wamid,
          callbacks: callbacks.filter((event) => event.wamid === wamid)
        }));
        process.stdout.write(JSON.stringify({
          target_count: targets.size,
          callback_count: callbacks.length,
          unique_callback_wamids: new Set(callbacks.map((event) => event.wamid)).size,
          sent_count: callbacks.filter((event) => event.status === "sent").length,
          delivered_count: callbacks.filter((event) => event.status === "delivered").length,
          read_count: callbacks.filter((event) => event.status === "read").length,
          failed_count: callbacks.filter((event) => event.status === "failed").length,
          invalid_signature_count: callbacks.filter((event) => event.signature_valid !== true).length,
          by_wamid: byWamid
        }, null, 2) + "\n");
        database.close();
      }
    );
  }
);
