"use strict";

// Narrow launcher for the already-deployed Reply -> Delivery subworkflow edge.
// It does not create or mutate a workflow, credential, permission, or assignment.

const N8N_DIST = "/usr/local/lib/node_modules/n8n/dist";
const { Container } = require("@n8n/di");
const { WorkflowRepository } = require("@n8n/db");
const { BaseCommand } = require(`${N8N_DIST}/commands/base-command`);
const { WorkflowExecutionService } = require(`${N8N_DIST}/workflows/workflow-execution.service`);
const { OwnershipService } = require(`${N8N_DIST}/services/ownership.service`);
const { ActiveExecutions } = require(`${N8N_DIST}/active-executions`);

const REPLY_ID = "AffWaReply2026";
const DELIVERY_ID = "AffWaDelivery2026";
const REPLY_ACTIVE_VERSION = "246d3a95-be64-4ad1-a334-94a2954ce7ae";
const DELIVERY_ACTIVE_VERSION = "5dbf32d5-dc22-4c19-a627-36d4e2a87fc6";
const START_NODE = "Start Sequential File Delivery";

const input = Object.freeze({
  conversation_id: "wa:6282225211568",
  username: "jenius_abnormal",
  tiktok_username: "jenius_abnormal",
  whatsapp_number: "6282225211568",
  wa_id: "6282225211568",
  batch_number: "6941",
  expected_clip_count: 15,
  files_expected: "15",
  state: "awaiting_username",
  last_intent: "clarification_pending",
  delivery_state: "partial",
  last_inbound_at: "2026-08-21T07:42:27.000Z",
  window_expires_at: "2026-08-22T07:42:27.000Z",
});

class ControlledResume6941 extends BaseCommand {
  constructor() {
    super();
    this.needsCommunityPackages = false;
    this.needsTaskRunner = true;
  }

  async init() {
    await super.init();
    await this.initLicense();
    await this.initBinaryDataService();
    await this.initDataDeduplicationService();
    await this.initExternalHooks();
  }

  async validatePath() {
    const repository = Container.get(WorkflowRepository);
    const reply = await repository.findOneBy({ id: REPLY_ID });
    const delivery = await repository.findOneBy({ id: DELIVERY_ID });
    if (!reply?.active || reply.activeVersionId !== REPLY_ACTIVE_VERSION) {
      throw new Error("reply_workflow_active_version_changed");
    }
    if (!delivery?.active || delivery.activeVersionId !== DELIVERY_ACTIVE_VERSION) {
      throw new Error("delivery_workflow_active_version_changed");
    }
    const node = reply.nodes.find((candidate) => candidate.name === START_NODE);
    const target = node?.parameters?.workflowId?.value;
    if (node?.type !== "n8n-nodes-base.executeWorkflow" || target !== DELIVERY_ID) {
      throw new Error("authorized_parent_delivery_edge_changed");
    }
    if (node.parameters?.mode !== "once" || node.parameters?.options?.waitForSubWorkflow !== true) {
      throw new Error("authorized_parent_delivery_execution_mode_changed");
    }
    const settings = delivery.settings || {};
    const callerIds = String(settings.callerIds || "").split(",").map((value) => value.trim()).filter(Boolean);
    if (settings.callerPolicy !== "workflowsFromAList" || !callerIds.includes(REPLY_ID)) {
      throw new Error("delivery_caller_policy_no_longer_authorizes_reply");
    }
    return { reply, delivery, node, callerPolicy: settings.callerPolicy, callerIds };
  }

  async run() {
    const validated = await this.validatePath();
    if (process.argv.includes("--validate-only")) {
      process.stdout.write(`${JSON.stringify({
        validated: true,
        reply_id: validated.reply.id,
        reply_active_version: validated.reply.activeVersionId,
        delivery_id: validated.delivery.id,
        delivery_active_version: validated.delivery.activeVersionId,
        start_node: validated.node.name,
        caller_policy: validated.callerPolicy,
        caller_ids: validated.callerIds,
        input,
      })}\n`);
      return;
    }

    const user = await Container.get(OwnershipService).getInstanceOwner();
    const executionId = await Container.get(WorkflowExecutionService).runWorkflow(
      validated.reply,
      validated.node,
      [[{ json: { ...input } }]],
      { userId: user.id },
      "cli",
    );
    process.stdout.write(`RECOVERY_PARENT_EXECUTION_ID=${executionId}\n`);

    const result = await Container.get(ActiveExecutions).getPostExecutePromise(executionId);
    const error = result?.data?.resultData?.error;
    process.stdout.write(`${JSON.stringify({
      parent_execution_id: executionId,
      status: error ? "error" : "success",
      stopped_at: result?.stoppedAt || null,
      error: error ? { message: error.message, node: error.node?.name || "" } : null,
    })}\n`);
    if (error) throw error;
  }
}

async function main() {
  const command = new ControlledResume6941();
  try {
    await command.init();
    await command.run();
    await command.stopProcess();
    await command.exitSuccessFully();
  } catch (error) {
    process.stderr.write(`${error?.stack || error?.message || error}\n`);
    process.exitCode = 1;
    try { await command.stopProcess(); } catch {}
    process.exit();
  }
}

main();
