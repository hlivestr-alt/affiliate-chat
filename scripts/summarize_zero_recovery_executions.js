"use strict";
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const input = JSON.parse(fs.readFileSync(path.join(ROOT, "n8n", "exports", "proya-delivery-log-audit-20260806T1125CST", "zero-recovery-production-executions.json"), "utf8").replace(/^\uFEFF/, ""));
const wanted = new Set(["Prepare Resumable Delivery Items", "IF Zero-Remaining Recovery", "Prepare Zero-Remaining Recovery Finalization", "IF Final-State Write Required", "Update Final Send State", "Upload Video to WhatsApp", "Send WhatsApp Video", "Batch Write Delivery Results", "Append Message Results Batch", "Done: Delivery Send Attempt"]);
const output = input.map((execution) => ({
  id: execution.execution.id,
  status: execution.execution.status,
  started_at: execution.execution.started_at,
  stopped_at: execution.execution.stopped_at,
  nodes: execution.nodes.filter((node) => wanted.has(node.name)).map((node) => {
    const value = node.outputs?.[0] || {};
    return { name: node.name, runs: node.runs, output_count: node.outputs?.length || 0, zero_remaining_recovery: value.zero_remaining_recovery, recovery_complete_verified: value.recovery_complete_verified, successful_send_count: value.successful_send_count, final_state_write_required: value.final_state_write_required, final_state_already_correct: value.final_state_already_correct, state: value.state, files_sent: value.files_sent, updated_range: value.updatedRange || value.updatedRange };
  })
}));
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
