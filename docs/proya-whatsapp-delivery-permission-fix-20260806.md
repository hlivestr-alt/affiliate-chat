# PROYA WhatsApp Delivery Caller-Permission Fix

Date: 2026-08-06

## Confirmed root cause

Execution `16013` was rejected by n8n's internal subworkflow policy checker at node `Start Normal Production Delivery` (node ID `c72f785d-fa26-44b9-90fb-2dd866e343f6`). The sanitized error was:

- Name: `SubworkflowPolicyDenialError`
- Message: `The sub-workflow (AffWaDelivery2026) cannot be called by this workflow`
- Description: the target limits allowed callers and its owner must allow the calling workflow
- Error level: `warning`
- HTTP/error code: none
- Stack origin: `SubworkflowPolicyChecker.check` before `startExecution`

This was not a Google Drive, Google Sheets, WhatsApp Cloud API, Meta app, credential-sharing, project-membership, or external API error. It happened before the delivery trigger ran, so no username, phone, folder, clip, Google write, upload, or media send existed in execution `16013`.

The caller was the temporary controller workflow `Temporary Approved Migration Delivery - ohyahahaa`, created by `scripts/trigger_ohyahahaa_migrated_delivery.js`. Its `Start Normal Production Delivery` node ID exactly matches the node recorded in execution `16013`. n8n deleted the temporary workflow immediately after its webhook response; its generated workflow ID is no longer retained. The workflow was created by the same API/user context as the production workflows (`proya official`) in the personal project.

At the failure instant, `AffWaDelivery2026` used `callerPolicy: workflowsFromAList` and allowed only `AffWaReply2026`. The migration controller temporarily added itself to the allow-list, but called the child with `waitForSubWorkflow: false`. Its webhook returned, then its `finally` block deleted the caller and restored the allow-list before the asynchronous child authorization check completed. The asynchronous child therefore failed after the parent appeared successful.

## Smallest safe fix

No caller access was broadened permanently. The following two call sites now wait for their delivery child:

1. Active workflow `AffWaReply2026`, node `Start Sequential File Delivery`: `waitForSubWorkflow` changed from `false` to `true`.
2. `scripts/trigger_ohyahahaa_migrated_delivery.js`, node `Start Normal Production Delivery`: `waitForSubWorkflow` changed from `false` to `true` so a temporary approved controller is not removed before its child finishes.

`AffWaDelivery2026` remains active with `callerPolicy: workflowsFromAList` and `callerIds: AffWaReply2026`. `AffWaReply2026` remains active and targets the correct workflow ID, `AffWaDelivery2026`. Its active version after deployment is `854826b9-5993-4202-b9b6-8f1b3e4cc968`.

Waiting makes an authorization/startup failure visible in the parent and prevents the parent from treating a child that never started as complete. The delivery workflow still owns numbered-folder reservation, so a policy rejection before its trigger cannot consume a folder. Existing assignment and send idempotency is unchanged.

No clip-selection rule, 15-clip behavior, media upload/send node, clip file, message content, or delivery-log design was changed.

## Backups

Pre-change backups are in:

`C:\Data\Affiliate Chat\n8n\exports\live-backups\before-subworkflow-permission-fix-20260806T1200CST\`

- `AffWaReply2026.json`
- `AffWaDelivery2026.json`
- `trigger_ohyahahaa_migrated_delivery.js`

## Google OAuth verification

The production `Google Sheets account` OAuth credential (ID redacted in this report) was tested from an active n8n workflow, not a manual editor execution. It successfully:

- read `WhatsApp Leads!A:AE`;
- read the deduplication source `WhatsApp Raw Events!A:L`;
- appended one controlled `Skipped` probe row to `PROYA WhatsApp Clip Delivery Log`;
- cleared exactly that probe range afterward.

The credential remains selected in the active production delivery workflow. No credential was revoked or replaced.

## Controlled production-path verification

No approved real WhatsApp test recipient was available. A controlled lead with an expired service window was inserted temporarily, then passed through the actual `AffWaDelivery2026` workflow. This safely exercised folder assignment, 15-file validation, durable pre-send claims, the media authorization guard, and both assignment-log calls without contacting Meta.

Execution evidence:

- `16240`: unauthorized control, `error`, exact `SubworkflowPolicyDenialError` at `Call Delivery without Authorization`; HTTP parent response was 500.
- `16243`: authorized actual delivery workflow, `success`; original numbered folder `6916`; exactly 15 clips validated; `Guard Cached Media Upload` ran 15 times; `Upload Video to WhatsApp` and `Send WhatsApp Video` did not run.
- `16244`: assignment-start logger, `success`; created the `Sending` row.
- `16251`: assignment-final logger, `success`; updated the same row.

The temporary controller workflow returned HTTP 200 only after execution `16243` finished. Its own execution record was cascade-deleted when the temporary workflow was removed, but the retained child and logger records record its trigger and outcome.

Before cleanup, the single visible row was:

| Numbered Folder | Clips Sent | Status | Error |
| --- | --- | --- | --- |
| 6916 | 0/15 | Failed | blocked_delivery_guard:no_active_customer_service_window |

There was one assignment row, not two, proving the final write updated the `Sending` row. The old detailed delivery log contained 15 blocked clip results and the WhatsApp message log contained zero records. No WhatsApp media API request or message ID was produced.

Cleanup cleared only the controlled lead row, its 15 detailed test rows, and its one new assignment-log row. A fresh read confirmed zero rows remain for the test conversation/username, so folder `6916` was not left consumed or reserved.

## Final state and limitation

The caller authorization defect is fixed and the production path is safe to leave running unattended for this issue. A caller-policy failure will now be visible to the parent, cannot silently look complete, and does not start or reserve an assignment.

Remaining limitation: this test deliberately stopped at the production media guard because no explicitly approved real WhatsApp test recipient was configured. Therefore a live Meta upload/send response was not re-tested. The upload/send nodes and credentials were not implicated in execution `16013` and were intentionally left unchanged.

Supporting sanitized evidence is in:

`C:\Data\Affiliate Chat\n8n\exports\proya-delivery-log-audit-20260806T1125CST\`

- `trace-16013-final.json`
- `caller-permission-e2e.json`
- `caller-permission-e2e-executions.json`
- `caller-permission-final-state.json`
- `google-oauth-production-probe.json`
