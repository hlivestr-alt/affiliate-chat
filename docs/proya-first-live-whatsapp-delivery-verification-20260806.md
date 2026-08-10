# PROYA First Live WhatsApp Delivery Verification

Date: 2026-08-06

## Assignment

- Affiliate username: `testes`
- WhatsApp number: `6281••••2823`
- Original numbered folder: `6916`
- Stable assignment key: `wa:6281120262823:6916`
- Customer-service window: open; inbound at `2026-08-06T04:33:53.000Z`, window expiry `2026-08-07T04:33:53.000Z`
- Folder ownership: exactly one WhatsApp Leads owner for folder `6916`; zero historical Affiliate Assignments owners
- Selected clips: 15 unique filenames and 15 unique delivery keys

## Execution chain

- Production webhook: `16269`
- Parent `AffWaReply2026`: `16270`
- Child `AffWaDelivery2026`: `16271`
- Assignment-start logger: `16274`
- Assignment-final logger: `16324`
- Safe child-only resumable check: `16343`

The parent and child were configured with successful execution retention set to `none` and error retention set to `all`. Their IDs were preserved while running. After the run settled, they were absent from the execution table and no corresponding error record existed, consistent with successful no-retention cleanup.

## Media results

- Successful media uploads: 15
- Successful WhatsApp sends: 15
- Unique WhatsApp message IDs: 15
- Delivery-detail rows: 15
- WhatsApp message-log rows: 15
- Attempts per clip: 1
- Duplicate filenames: 0
- Duplicate delivery keys: 0
- Duplicate message IDs: 0
- Clip errors: 0

The exact sequence, filenames, media IDs, WhatsApp message IDs, state, attempt count, and accepted timestamps are preserved in `live-production-assignment-sheet-evidence.json`. All 15 delivery rows are `accepted` and contain both a media ID and a WhatsApp message ID.

## Timing

- Parent start: `2026-08-06T04:33:51.761Z`
- Delivery child start: `2026-08-06T04:33:55.231Z`
- First accepted media send: `2026-08-06T04:35:41.124Z`
- Fifteenth accepted media send: `2026-08-06T04:42:10.104Z`
- Final logger completion: `2026-08-06T04:42:23.187Z`
- First-to-last media-send interval: 6 minutes 28.980 seconds
- Delivery-child start through final log: 8 minutes 27.956 seconds
- Parent start through final log: 8 minutes 31.426 seconds

No workflow-level execution timeout was configured. `waitForSubWorkflow: true` kept the parent active throughout the live send and did not cause a timeout.

## Simple delivery log

The assignment-start logger `16274` appended one row at `Delivery Log!A3:G3`:

- Folder: `6916`
- Username: `testes`
- WhatsApp number: correct normalized number
- Sent At: `2026-08-06 11:33:57 WIB`
- Clips Sent: `0/15`
- Status: `Sending`
- Error: empty

The final logger `16324` updated that same range, not a new row:

- Clips Sent: `15/15`
- Status: `Complete`
- Error: empty

A fresh spreadsheet read found exactly one simple-log row for this assignment.

## Finalization defect and repair

The real run exposed one defect after all 15 sends: `Prepare Cached Delivery Summary` emitted `lead_row_values`, but `Update Final Send State` attempted to write `$json.row_values`. The simple delivery log reached `Complete`, while the canonical lead remained `delivery_in_progress` with `files_sent=0`. The node also had `continueOnFail: true`, which hid the final-state write failure and prolonged the waiting parent/child.

The smallest workflow correction was applied only to `AffWaDelivery2026` node `Update Final Send State`:

- request body now uses `$json.lead_row_values`;
- `continueOnFail` was removed, so a future final-state write failure stops the child and propagates to the waiting parent.

No selection, upload, media-send, message, clip, assignment-key, or delivery-log node was changed.

The affected lead was repaired only after re-verifying 15 durable unique WhatsApp message IDs. The exact row changed from:

- `delivery_in_progress`, `files_sent=0`

to:

- `files_sent`, `files_expected=15`, `files_sent=15`, `files_failed=0`, empty error

The final send timestamp was preserved as `2026-08-06T04:42:10.104Z`.

## Retry behavior

Child-only resumable execution `16343` was invoked after confirming all 15 durable message IDs. It made zero media uploads and zero media sends, so no successful clip was duplicated. Its controller received `No item to return was found` because the delivery workflow emits no item when every clip is already accepted.

This zero-remaining-items behavior is a remaining recovery limitation: it safely prevents duplicate sends, but it does not itself finalize an already-complete lead. The current assignment therefore used a verified one-row finalization-only repair; the entire parent workflow was never rerun.

## Final assessment

The real production media path and simple delivery logger are verified:

- 15/15 unique WhatsApp media requests were accepted with message IDs;
- no duplicate media send occurred;
- one spreadsheet row moved from `Sending` to `Complete`;
- the original numbered folder was preserved and finalized;
- `waitForSubWorkflow: true` did not time out.

The system is not yet fully verified for completely unattended recovery from the narrow case where all 15 sends succeed but final lead-state persistence fails. Normal future deliveries contain the corrected field mapping and will now surface finalization failures to the parent, but the zero-remaining-items resumable path still needs operator-assisted finalization if that narrow failure recurs. No architectural change was made to that path.

## Evidence and backup

Sanitized/local evidence:

- `C:\Data\Affiliate Chat\n8n\exports\proya-delivery-log-audit-20260806T1125CST\live-production-chain-raw.json`
- `C:\Data\Affiliate Chat\n8n\exports\proya-delivery-log-audit-20260806T1125CST\live-production-assignment-sheet-evidence.json`
- `C:\Data\Affiliate Chat\n8n\exports\proya-delivery-log-audit-20260806T1125CST\live-finalization-fix.json`
- `C:\Data\Affiliate Chat\n8n\exports\proya-delivery-log-audit-20260806T1125CST\live-production-lead-finalization.json`

Pre-fix workflow backup:

- `C:\Data\Affiliate Chat\n8n\exports\live-backups\before-live-finalization-fix-20260806T1255CST\AffWaDelivery2026.json`
