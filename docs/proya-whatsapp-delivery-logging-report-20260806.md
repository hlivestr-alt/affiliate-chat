# PROYA WhatsApp clip-delivery logging report

## Result

The production delivery workflow now emits assignment-level start and final log events to a separate, idempotent Google Sheet without changing clip selection, the 15-clip rule, WhatsApp content, media upload, or media-send nodes.

- Spreadsheet: `PROYA WhatsApp Clip Delivery Log`
- Spreadsheet ID: `1Zsq-ngyC1RGOCLlibFI-UyPBW88oQc0aJhC5cxtbrzA`
- Only worksheet: `Delivery Log`
- Timezone: `Asia/Jakarta`
- Final visible data: one clearly marked `Skipped` logger-verification row; no simulated successful delivery rows remain.

## Investigated window and root cause

The anchored 24-hour audit used n8n/SQLite UTC `2026-08-05 03:25:42` through `2026-08-06 03:25:42`, equivalent to `2026-08-05 10:25:42 WIB` through `2026-08-06 10:25:42 WIB`. The server itself is configured for `Asia/Shanghai`.

There were **zero WhatsApp media-send node executions** in that window. The green executions were not successful clip deliveries:

- 92 successful `Affiliate Distribution - Outbound Log Recovery` schedule runs stopped at `Read Pending Outbound Log Payloads` with zero output items. No Google Sheets node ran.
- 104 successful `AffWaWebhook2026` runs included 90 that ended at `Done: Status Sheet Logging Paused`. Those events contained WhatsApp status message IDs but no affiliate username, folder, clip selection, or media-send request. No Sheets node ran.
- Six webhook executions ended after asynchronous `Process WhatsApp Event` dispatch. A green parent only confirmed dispatch, not a downstream Sheet write.
- The only `AffWaDelivery2026` record was execution `16013`. It failed before the child delivery began: `The sub-workflow (AffWaDelivery2026) cannot be called by this workflow`. It had no recoverable username, number, folder, selected clips, or send requests.

Actual Google writes were also blocked earlier in the window:

- `AfDriveReady2026` execution `15849` reached `Read WhatsApp Leads`, targeting spreadsheet `1eyA1XRNZU0usuii801IrJCJHp8oCh2XjlfROrzzvpwE`, range `WhatsApp Leads!A:AB`, credential `Google Sheets account`. It returned no items and failed with `The credential "Google Sheets account" needs to be reconnected.`
- `AffWaObservability2026` execution `15809` reached `Read Raw Events for Deduplication`, targeting the same spreadsheet, range `WhatsApp Raw Events!A:L`, and the same credential. It returned no items with the same reconnect failure.
- A later Google connectivity execution succeeded, and the credential was able to create and write the new spreadsheet. No credential secret was exported or exposed.

The confirmed cause of the apparent contradiction was therefore: green schedule/webhook executions followed branches that did not write rows, while the real lead/assignment path was blocked by the disconnected Google OAuth credential. There was no media-send execution to log in the audited 24-hour window.

## Changed workflows and nodes

### `AffWaDelivery2026` — Affiliate Distribution - Resumable File Delivery

Added only these four nodes:

- `Prepare Assignment Start Log`
- `Log Assignment Start (Nonblocking)`
- `Prepare Assignment Final Log`
- `Log Assignment Final (Nonblocking)`

The start branch fans out after `Prepare Resumable Delivery Items`. The final branch fans out after `Prepare Durable Queue Status`. Both logger calls are nonblocking child executions, so a Sheet outage cannot resend or stop WhatsApp clips. Hash comparison confirmed these production nodes are unchanged:

- `Select and Prepare Batch Reservation`
- `Prepare Resumable Delivery Items`
- `Upload Video to WhatsApp`
- `Send WhatsApp Video`
- `Parse Video Send`

### `ecBB2oa6xeY2knFu` — PROYA WhatsApp Delivery Log Writer

New active workflow. It:

1. Normalizes phone numbers and Jakarta timestamps.
2. Stores a stable assignment key in n8n Data Table `proya_delivery_assignment_log`.
3. Marks each event `pending` before contacting Google.
4. Resolves an existing row using the stored row number, with a visible-key fallback of original numbered folder + normalized phone + assignment timestamp.
5. Appends only when no matching row exists; otherwise updates `A:G` on the existing row.
6. Treats Google failures as workflow errors; the Google nodes do not use Continue On Fail or Always Output Data.
7. Marks the internal state `synced` only after Google returns a row/range response.

It uses credential name `Google Sheets account`, spreadsheet `1Zsq-ngyC1RGOCLlibFI-UyPBW88oQc0aJhC5cxtbrzA`, and tab `Delivery Log`.

### `m1KBWKOLjwxbtFPP` — PROYA WhatsApp Delivery Log Retry

New active workflow. Every 10 minutes it reads only `pending` assignment-log states and calls the writer. It contains no WhatsApp, Drive, clip-selection, media-upload, or media-send nodes.

## Logging behavior

- Start: one row is created/updated as `Sending`, including the accepted count already recovered from the detailed delivery log on a resume.
- Final: the same row becomes `Complete`, `Partial`, or `Failed` using unique per-clip evidence with a WhatsApp message ID / accepted-or-later send state.
- Retry: updates the same row using the internal assignment key and row number; the visible fallback protects against loss of the internal row mapping.
- The original `batch_number` is copied as `Numbered Folder`; an existing internal folder value is never replaced by a renamed Drive folder value.
- `Sent At` is the stable assignment start timestamp rendered as `YYYY-MM-DD HH:mm:ss WIB`.
- Logging retry is independent from delivery retry, so a logger failure never invokes the delivery workflow.

## Backfill

Recovered and backfilled real assignments: **0**.

No WhatsApp media-send node ran in the audited window. Execution `16013` had no recoverable assignment identity and failed before the delivery child started, so creating a guessed row would violate the no-guess requirement. Status callbacks were not treated as new assignments because they referred to prior message IDs and did not contain the required assignment fields.

## Controlled test results

No WhatsApp request was made by the test harness.

| Requirement | Result | Evidence |
| --- | --- | --- |
| 15/15 becomes Complete | Pass | executions `16209` and `16211`; row `A2:G2` appended then updated |
| Failure after several clips becomes Partial | Pass | controlled row `7/15`, `Partial` |
| Complete failure becomes Failed | Pass | controlled row `0/15`, `Failed` |
| Retry is idempotent | Pass | repeated `test:success` kept one row; Google returned update range `A2:G2` |
| Google failure is visible | Pass | execution `16219` failed at `Read PROYA Delivery Log for Idempotency`, HTTP 404 |
| Logging-only retry does not rerun delivery | Pass | execution `16221` contained only logger nodes and wrote one row |
| Original folder survives rename | Pass | retry supplied a renamed folder value; row retained `900005` |
| Asia/Jakarta timestamp | Pass | `2026-08-06T02:42:18Z` became `2026-08-06 09:42:18 WIB` |

The five scenario rows were removed after verification. One final controlled row remains as `Skipped`, with `0/15` and an explicit note that no WhatsApp media request was sent.

## Backups and evidence

- Pre-change workflow backup: `n8n/exports/live-backups/before-proya-assignment-logger-20260806T1130CST/AffWaDelivery2026.json`
- Post-change workflow exports: `n8n/exports/live-backups/after-proya-assignment-logger-20260806T1142CST/`
- 24-hour audit: `n8n/exports/proya-delivery-log-audit-20260806T1125CST/proya-24h-audit.json`
- Controlled tests: `n8n/exports/proya-delivery-log-audit-20260806T1125CST/logger-test-results.json`
- Final Sheet verification: `n8n/exports/proya-delivery-log-audit-20260806T1125CST/final-sheet-verification.json`

## Remaining limitation

The writer uses the existing user OAuth credential `Google Sheets account`. It is currently working, but user OAuth can be revoked or expire again. The durable pending queue and visible failed execution prevent silent loss; a future credential revocation will still require reconnecting that Google credential.
