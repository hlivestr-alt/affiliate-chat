# WhatsApp observability deployment report — 2026-08-04

## A. Root audit findings

- n8n 2.29.9 was paused for the initial audit. `ZERO_CHARGE_MODE=true`, phase 1 was enabled, test mode and live-test arming were disabled.
- The five production workflows were active before the change. The POST callback remained `whatsapp-callback`, node ID `521dd150-7170-465f-8c7a-78399bbe7e41`, webhook ID `404ceb4d-9ed3-40b6-b684-94b4aadcf6e0`, and `responseMode=onReceived`.
- Initial retained data contained 54 deduplicated message records (29 inbound, 25 outbound), 13 recent contacts, 103 authenticated webhook events, and 7 duplicate callback retries.
- `Delivery Log` contained only one isolated TEST row. There was no evidence that a production clip had been accepted or sent.
- Six numbered folders (6901–6906) were reserved. Each folder exists and contains exactly 15 MP4 files: 90 production clips total.
- Existing delivery executions were failing at `Read Assigned MP4 Files` with file-access/no-files errors. This pre-existing delivery defect was not redesigned as part of observability work.

## B. Tabs created or changed

- Created `WhatsApp Chat Log` with deduplicated append/update semantics.
- Created `WhatsApp Clip Log` with one primary row per numbered-folder clip.
- Created `WhatsApp Dashboard`, using Asia/Jakarta formulas, four periods, operational tables, conditional formatting, and five charts.
- Created hidden `WhatsApp Raw Events`, append-only and sanitized.
- Existing tabs and unknown columns were preserved. No existing data was cleared or replaced.

## C. Final column lists

### WhatsApp Chat Log (38)

Event Time Jakarta; Event Time UTC; Direction; Event Type; WhatsApp Number; wa_id; TikTok Username; Contact/Lead ID; Conversation Key; Inbound Message ID; Outbound wamid; Reply-To Message ID; Message Type; Message Text; Media Filename; Folder Number; Clip Filename; Delivery Key; Workflow Name; n8n Execution ID; Last Inbound At; Window Expires At; Lead State; Intent; Send State; Delivery State; Error Code; Error Title; Error Details; Created At; Updated At; Sent At; Delivered At; Read At; Failed At; Record Source; Backfill Timestamp; Deduplication Key.

### WhatsApp Clip Log (31)

Folder Number; Batch/Assignment ID; Clip Sequence; Clip Filename; Full Local Source Path; File Size Bytes; Media Type; WhatsApp Number; wa_id; TikTok Username; Lead ID; Assignment Date; Upload Started At; Message Sent At; Outbound wamid; Send State; Sent At; Delivery State; Delivered At; Read At; Failed At; Error Code; Error Title; Error Details; Delivery Key; Attempt Count; n8n Execution ID; Current Result; Updated At; Record Source; Backfill Timestamp.

### WhatsApp Raw Events (12)

Received Timestamp; Event Kind; Event Category; Phone Number; wa_id; Message ID / wamid; Workflow; Execution ID; Deduplication Key; Sanitized JSON Payload; Processing Result; Error Summary.

## D. Workflows and files changed

- Added and published active `AffWaObservability2026` (20 nodes).
- Added asynchronous observer calls to `AffWaWebhook2026`, `AffWaReply2026`, and `AffWaDelivery2026` while preserving their active states and main execution paths.
- `AffWaStatus2026` and `AffWaOptIn2026` remained active and unchanged in behavior.
- Main implementation files: `src/whatsappObservability.js`, `scripts/build_whatsapp_observability.js`, `scripts/deploy_whatsapp_observability_sheets.js`, `scripts/extract_whatsapp_observability_backfill.js`, audit/backup/deployment scripts, generated n8n imports, `tests/whatsappObservability.test.js`, and `package.json`.
- Sheet API calls have bounded retries. Observer calls do not wait for the subworkflow, so Sheet failures cannot fail the acknowledged webhook or trigger a Meta resend.

## E. Backup paths

- Before-change, parse-verified backup: `n8n/exports/live-backups/before-observability-20260804T033447Z`.
- Post-deployment audit and reconciliation artifacts: `n8n/exports/live-backups/after-observability-20260804T041500Z`.
- The before backup includes current and published workflow JSON, workflow IDs/versions/active states/hashes, a stopped n8n data copy, complete Sheet grid/formula/value/metadata backups, and manifests. Google Drive XLSX export returned HTTP 403, but the complete Sheets API grid backup was captured and verified.

## F–G. Historical backfill and recovered records

- Initial backfill: 54 messages, 13 contacts, 6 folders, 90 production clips, 91 total clip rows including one TEST row, and 128 raw events.
- Reconciliation snapshot after live traffic advanced: 57 messages, 14 contacts, 6 folders, 90 production clips, 91 total clip rows, and 127 retained-source raw events.
- Final live Sheets reconciliation: 62 distinct messages (34 inbound, 28 outbound), 15 unique inbound contacts, 6 numbered folders, 90 production clips, 91 total clip rows, and 151 raw audit rows.
- Duplicate primary keys: 0 Chat rows and 0 Clip rows. Accepted production clips: 0; sent: 0; delivered: 0; failed: 0.
- Backfilled rows carry `Record Source=historical_backfill` and a backfill timestamp. Live records carry `Record Source=live`.

## H. Automated test results

- Full Affiliate Chat and Clipper regression suite: 61/61 passed.
- Coverage includes inbound/status idempotency, readable text, clarification/confirmation, exact folder and filenames, fifteen-clip cardinality, monotonic status updates, complete Meta error fields, window blocks, distinct dashboard counts, accepted-not-delivered, Sheet failure isolation, and raw sanitization.
- Final Sheet audit: 0 formula errors, 0 raw sanitization violations, 5 charts, 3 Clip Log conditional-format rules, filters/frozen rows present, Raw Events hidden.

## I. Dashboard metrics at final audit

| KPI | Today | Last 7 days | Last 30 days | All time |
|---|---:|---:|---:|---:|
| Total inbound messages | 12 | 34 | 34 | 34 |
| Unique WhatsApp numbers | 5 | 15 | 15 | 15 |
| New contacts | 5 | 15 | 15 | 15 |
| Interested contacts | 3 | 12 | 12 | 12 |
| Contacts awaiting username | 5 | 14 | 14 | 14 |
| Valid TikTok usernames received | 3 | 11 | 11 | 11 |
| Leads requiring manual review | 1 | 1 | 1 | 1 |
| Folders assigned | 0 | 6 | 6 | 6 |
| Folders started / fully delivered | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Clips attempted / accepted / sent / delivered / read / failed | 0 | 0 | 0 | 0 |
| Active 24-hour windows | 12 | 12 | 12 | 12 |
| Expired windows with pending clips | 1 | 1 | 1 | 1 |

## J. No-send confirmation

- No WhatsApp webhook was invoked for testing or deployment.
- No template was used or activated.
- The execution audit scanned 77 executions from 04:00 UTC and found zero Meta send-node executions.
- Callback URLs/IDs, numbered folders, assignments, ZERO_CHARGE_MODE, pacing, and 24-hour guards were not changed.

## K. Historical data not recoverable

- Two legacy template-test message rows do not retain readable message bodies; they remain blank/unknown rather than invented.
- Some historical reply-to IDs and n8n execution IDs were not retained by source logs.
- No production clip `wamid`, upload, accepted, sent, delivered, read, or failure evidence exists in retained sources, so all 90 production clip rows correctly remain Pending.
- The retained sources support 15 unique inbound contacts, not the estimated 40–50 conversations; unretained conversations were not fabricated.

## L. Manual action required

- Repair the pre-existing `AffWaDelivery2026` `Read Assigned MP4 Files` file-access/no-files failure before expecting the six reserved folders to start sending. This was deliberately left outside the requested observability-only scope.
- No manual action is required for logging or the dashboard. Browser visual inspection was blocked by Google sign-in, but the Sheets API verified grids, formulas, filters, frozen rows, charts, formatting, hidden Raw Events, and reconciliation.
