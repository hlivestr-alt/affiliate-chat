# Live review: unresolved missed affiliate WhatsApp candidates

Live evidence cut-off: **2026-08-06 15:59:31 WIB** (`2026-08-06T08:59:31.853Z`). Production Sheets and Drive were read directly with the existing Google OAuth credential; n8n SQLite was opened read-only. No workflow, spreadsheet, Drive, Meta send/upload, or recovery endpoint was invoked.

## Consolidated result

`Assignment ID` below is the durable assignment key used by delivery records (`conversation_id:original_numbered_folder`). The historical `Affiliate Assignments` tab has no standalone assignment-ID column and contains no matching row for these WhatsApp-direct assignments; it must not be invented. Folder ownership is instead established by the unique canonical lead batch plus assignment-scoped Delivery Log keys.

| # | Current classification | Current lead state | Active execution | Assignment ID | Original folder | Durable successful sends | Remaining clips | Current delivery-log status | Recommended action | Approval required |
|---:|---|---|---|---|---:|---:|---:|---|---|---|
| 1 | Already completed | `files_delivered` | — | `wa:6289508881998:6901` | 6901 | 15 | 0 | 15/15; delivered/read evidence agrees | No action | No |
| 2 | Raw/lead conflict — safe deterministic repair possible | `awaiting_username`, username blank | — | — | — | 0 | 0 | No delivery row | Approve username/state repair; later re-engagement is separately required | Yes |
| 3 | Already completed | `files_delivered` | — | `wa:6289656262493:6902` | 6902 | 15 | 0 | 15/15; delivered/read evidence agrees | No action | No |
| 4 | Inconsistent; stale with unsent clips and one outcome-uncertain clip | `delivery_in_progress` | — | `wa:6282329499945:6905` | 6905 | 7 | 8 | 7 successful; 1 `outcome_uncertain`; 7 further clips have no durable row | Reconcile the uncertain send first; expired window then requires approved re-engagement | Yes |
| 5 | Already completed | `files_delivered` | — | `wa:6285710416787:6904` | 6904 | 15 | 0 | 15/15; delivered/read evidence agrees | No action | No |
| 6 | Inconsistent; stale with unsent clips and one outcome-uncertain clip | `delivery_in_progress` | — | `wa:6281802341011:6906` | 6906 | 12 | 3 | 12 successful; 1 `outcome_uncertain`; 2 further clips have no durable row | Reconcile the uncertain send first; expired window then requires approved re-engagement | Yes |
| 7 | Requires approved WhatsApp re-engagement | `distribution_pending` | — | — | — | 0 | 0 | No delivery row | Separately approve template contact; wait for inbound before media | Yes |
| 8 | Missing username; re-engagement needed | `awaiting_username` | — | — | — | 0 | 0 | No delivery row | Approve and send the proposed username request; do not allocate a folder | Yes |
| 9 | Requires approved WhatsApp re-engagement | `distribution_pending` | — | — | — | 0 | 0 | No delivery row | Separately approve template contact; wait for inbound before media | Yes |
| 10 | Requires approved WhatsApp re-engagement | `distribution_pending` | — | — | — | 0 | 0 | No delivery row | Separately approve template contact; wait for inbound before media | Yes |
| 11 | Raw/lead conflict — safe deterministic repair possible | `awaiting_username`, username blank | — | — | — | 0 | 0 | No delivery row | Approve username/state repair; preserve the later inbound question | Yes |
| 12 | Previously partially sent; consistent send evidence but guard-blocked | `failed` | — | `wa:6285864300358:6907` | 6907 | 14 | 1 | 14 durable IDs; clip 13 failed | Do not resend the 14; service window expired, so re-engage before the existing resumable path | Yes |
| 13 | Stale with unsent clips and unresolved pre-send claims | `delivery_in_progress` | — | `wa:6285156242134:6908` | 6908 | 3 | 12 | 3 successful; 4 `send_prepared`; 8 not durably prepared | Reconcile stale claims; expired window then requires approved re-engagement | Yes |
| 14 | Inconsistent and stale with unsent clips | `delivery_in_progress` | — | `wa:6285757808520:6909` | 6909 | 2 | 13 | Lead says sent 1, but two durable IDs exist; 2 `send_prepared`; 11 absent | Repair summary only after claim reconciliation; re-engage before resume | Yes |
| 15 | Raw/lead conflict — safe deterministic repair possible | `awaiting_username`, username blank | — | — | — | 0 | 0 | No delivery row | Approve username/state repair; later re-engagement is separately required | Yes |
| 16 | Requires approved WhatsApp re-engagement | `distribution_pending` | — | — | — | 0 | 0 | No delivery row | Separately approve template contact; wait for inbound before media | Yes |
| 17 | Stale with unsent clips; all 15 claims are `send_prepared` | `delivery_in_progress` | — | `wa:6285726072907:6913` | 6913 | 0 | 15 | 15 prepared rows, no message ID | Reconcile/clear stale claims; expired window then requires approved re-engagement | Yes |
| 18 | Stale with unsent clips; all 15 claims are `send_prepared` | `delivery_in_progress` | — | `wa:6285814306702:6914` | 6914 | 0 | 15 | 15 prepared rows, no message ID | Reconcile/clear stale claims; expired window then requires approved re-engagement | Yes |
| 19 | Raw/lead conflict — safe deterministic repair possible | `awaiting_username`, username blank | — | — | — | 0 | 0 | No delivery row | Approve username plus latest-inbound metadata repair; later re-engagement required | Yes |
| 20 | Stale partial; data-safe for the existing resumable path | `failed` | — | `wa:6285774758260:6917` | 6917 | 14 | 1 | PROYA log: `14/15`, `Partial`; clip 9 failed | Resume only through an already-authorized production caller while the window is open; none is exposed without forbidden workflow-definition changes | Yes / operator execution path |

No active `running`, `new`, or `waiting` execution existed anywhere in n8n at the final check. The historical failed delivery executions conclusively identify assignments 6908 (`13039`), 6909 (`13099`), 6913 (`15546`), and 6914 (`15657`). Candidates 6905/6906 are identified by their canonical lead and assignment-scoped durable keys. Candidate 20's natural chain used Reply `16399` and Delivery `16400` according to the audit/runtime evidence; the retained canonical/log result is 6917, 14/15.

## Category conclusions

1. **Completed naturally after the earlier audit:** none of the six original in-progress candidates (4, 6, 13, 14, 17, 18). Candidate 20, which arrived during the audit, progressed independently but stopped partial at 14/15.
2. **Still actively processing:** none.
3. **Safe for existing recovery:** candidate 20 is data-safe for a one-clip resumable recovery: unique phone/conversation/folder ownership, 14 distinct durable successful IDs, exactly one failed clip, no active execution, and its customer-service window remains open until 2026-08-07 12:50:37 WIB. No recovery was executed because the repository's available wrappers create or modify workflow definitions/caller permissions, which this task expressly forbids. Candidates 4, 6, 13, 14, 17, and 18 are not safe until uncertain/prepared claims are reconciled. Candidate 12 is internally consistent but guard-blocked by an expired window.
4. **Blocked by WhatsApp re-engagement:** explicit category candidates 7, 9, 10, 16; missing-username candidate 8; partial candidate 12; and stale candidates 4, 6, 13, 14, 17, 18 once their record inconsistencies are resolved.

## Approved WhatsApp re-engagement review

Direct media is prohibited because each `window_expires_at` is earlier than the live review time. The production media guard therefore requires a new customer inbound before media can be sent. The Meta read-only template inventory currently reports approved template **`affilaiteoptin`** (`id`, `MARKETING`) as available. It was not sent.

| Candidate | Redacted number | TikTok username | Last inbound (WIB) | Why re-engagement is required | Approved template currently available | Recommended operator action |
|---:|---|---|---|---|---|---|
| 7 | +62 856••••0399 | `truelove894` | 2026-08-03 22:19:10 | Service window expired 2026-08-04 22:19:10 WIB; no assignment or media send | Yes — `affilaiteoptin` | Obtain separate approval, send approved template, wait for inbound, then reassess |
| 9 | +62 857••••1597 | `nur.aissyiah` | 2026-08-04 08:10:44 | Service window expired 2026-08-05 08:10:44 WIB; no assignment or media send | Yes — `affilaiteoptin` | Same |
| 10 | +62 895••••2962 | `nyakcutriska1123` | 2026-08-04 08:45:20 | Service window expired 2026-08-05 08:45:20 WIB; no assignment or media send | Yes — `affilaiteoptin` | Same; retain the sample-request context for operator handling |
| 16 | +62 823••••2349 | `ratna.sagraha` | 2026-08-04 16:03:40 | Service window expired 2026-08-05 16:03:40 WIB; no assignment or media send | Yes — `affilaiteoptin` | Obtain separate approval, send approved template, wait for inbound, then reassess |

## Raw-versus-lead conflicts

For all four conflicts, the signed/raw inbound is authoritative for the message ID, sender phone, timestamp, and text. Normalized phone/username are deterministic derivatives of that raw evidence. The canonical lead is authoritative for operational row identity, conversation, and current workflow state, but its blank username is contradicted by the raw evidence. Assignment/Delivery/Message/PROYA logs contain no matching assignment or send for any of the four, so there is no competing ownership or historical-send evidence.

### Candidate 2 — `haqiqi_41`

- Raw interest: `wamid.HBgNNjI4NzcxNjcxNjU4ORUCABIYIEFDRDQ5RURGNEZCRkY3RkMxODU2NDU5RDExNEI4MjQ2AA==`, 2026-08-03 18:52:20 WIB, phone `6287716716589`, text names “haqiqi” but not a conclusive handle.
- Later inbound: `wamid.HBgNNjI4NzcxNjcxNjU4ORUCABIYIEFDNjBFOUQ4Qjc3NUYwNEQ4NTBENjZFRkRCNUFBOTQxAA==`, 2026-08-03 18:55:05 WIB, profile URL explicitly yields normalized username `haqiqi_41`.
- Canonical row 60: same normalized phone/conversation, blank username, `awaiting_username`; latest inbound ID/timestamp correctly point to the profile URL. No assignment/folder/send/log row.
- Conflict: username and derived state only. Classification: **Safe deterministic repair possible**.
- Proposed repair: set username to `haqiqi_41`; recompute `awaiting_username` to `distribution_pending`; preserve phone, conversation, and latest inbound metadata. Do not allocate a folder or send anything.

### Candidate 11 — `masdanang`

- Raw interest: `wamid.HBgNNjI4MjEzMDkxNzEwOBUCABIYIEFDQjU5ODE3Q0VFMjcwMzUxNzczQUU5OEVBQzE4ODBFAA==`, 2026-08-04 11:13:04 WIB, phone `6282130917108`, text explicitly contains `{{masdanang}}`; normalized username is `masdanang`.
- Later inbound: `wamid.HBgNNjI4MjEzMDkxNzEwOBUCABIYIEFDMzIxNEZDOTZGMjEwMUQ4QzJBNjIxNjRDOUUwMjMwAA==`, 2026-08-04 11:19:50 WIB, “kirim kemana ka”.
- Canonical row 75: same phone/conversation, blank username, `awaiting_username`; latest inbound metadata correctly preserves the later question. No assignment/folder/send/log row.
- Conflict: canonical username/state versus the earlier explicit handle. Classification: **Safe deterministic repair possible**.
- Proposed repair: set username to `masdanang`, recompute state to `distribution_pending`, and preserve the later question as the latest inbound. Do not infer any other field.

### Candidate 15 — `shipwithnaa`

- Raw interest: `wamid.HBgNNjI4MzE2ODg1MzgwNhUCABIYIEFDNEFENkVGMzkxNzUwREMzNjY4NEQ3MzExQ0QxMTZCAA==`, 2026-08-04 15:04:55 WIB, phone `6283168853806`, explicit `shipwithnaa`.
- Later inbound: `wamid.HBgNNjI4MzE2ODg1MzgwNhUCABIYIEFDQThBOThFREIxREEyRjY3RDI1MDgwOUMxQzI0RkU3AA==`, 2026-08-04 15:05:33 WIB, `MINAT@shipwithnaa`.
- Canonical row 81: same phone/conversation and correct later inbound metadata, but blank username/`awaiting_username`. No assignment/folder/send/log row.
- Conflict: username and derived state. Classification: **Safe deterministic repair possible**.
- Proposed repair: set username to `shipwithnaa`, recompute state to `distribution_pending`, preserve all phone/conversation/latest-inbound fields.

### Candidate 19 — `wahyuniaksa.msi`

- Raw interest: `wamid.HBgNNjI4MjM5MzExMDI2MhUCABIYIEFDQzNDQUYyOUEzMTRGQzdGODcyRTdDNTRCMUJEMzdFAA==`, 2026-08-05 07:20:00 WIB, phone `6282393110262`, explicit `@wahyuniaksa.msi`.
- Later inbound: `wamid.HBgNNjI4MjM5MzExMDI2MhUCABIYIEFDNjczMjNEQzI0NDYyRUVEMTc0OEVCNDM3NUU3MkM1AA==`, 2026-08-05 07:20:53 WIB, `MINAT @wahyuniaksa.msi`.
- Canonical row 91: same phone/conversation, blank username/`awaiting_username`, but its latest-inbound ID/timestamp still point to the first message. No assignment/folder/send/log row.
- Conflicts: username, state, last inbound message ID/timestamp, and derived window expiry. Classification: **Safe deterministic repair possible**.
- Proposed repair: set username `wahyuniaksa.msi`; set latest inbound ID/time to the later `MINAT` message; recompute expiry from it; recompute state to `distribution_pending`. The recomputed window is already expired, so no direct media follows.

None of the four has evidence of a duplicate person, an incorrect phone-to-username association, or an historical media send. Repairs were not written.

## Previously partially sent candidate 12

Expected clips: **15**. Original assignment: `wa:6285864300358:6907`; original folder: **6907**. There is no active execution.

Valid durable sends (clip index → WhatsApp message ID):

| Clip | WhatsApp message ID |
|---:|---|
| 1 | `wamid.HBgNNjI4NTg2NDMwMDM1OBUCABEYEjU4OENENDcxQ0YzNDY5QTE4RAA=` |
| 2 | `wamid.HBgNNjI4NTg2NDMwMDM1OBUCABEYEkYzQjNBNjYyOEI2OUQ1NDlEMQA=` |
| 3 | `wamid.HBgNNjI4NTg2NDMwMDM1OBUCABEYEjYzNjkyQjkwRENGQ0FDMDMwMAA=` |
| 4 | `wamid.HBgNNjI4NTg2NDMwMDM1OBUCABEYEjBCODQzNjM5MjRDQzUxQjRFOAA=` |
| 5 | `wamid.HBgNNjI4NTg2NDMwMDM1OBUCABEYEkJGRkRCRTIxQjZFN0I2RkZEMwA=` |
| 6 | `wamid.HBgNNjI4NTg2NDMwMDM1OBUCABEYEjI2OTkxNEYyQTkwOEM5RjBFMgA=` |
| 7 | `wamid.HBgNNjI4NTg2NDMwMDM1OBUCABEYEkIzMzVERTM3OTRCMEQyMENFQgA=` |
| 8 | `wamid.HBgNNjI4NTg2NDMwMDM1OBUCABEYEkYwMEE1QUUzMUNFNUQ2MTI1NgA=` |
| 9 | `wamid.HBgNNjI4NTg2NDMwMDM1OBUCABEYEkJGQzlBOUZGREU2QzlCNTE3MQA=` |
| 10 | `wamid.HBgNNjI4NTg2NDMwMDM1OBUCABEYEjIzQzQ2ODQyNUVFMzQ2MkQ3NwA=` |
| 11 | `wamid.HBgNNjI4NTg2NDMwMDM1OBUCABEYEjU1M0NCQzI4NzdGRUYzRjAwOQA=` |
| 12 | `wamid.HBgNNjI4NTg2NDMwMDM1OBUCABEYEjcxMjQyNUNDNTY3MDAwRjU1QwA=` |
| 14 | `wamid.HBgNNjI4NTg2NDMwMDM1OBUCABEYEkI4OUJFNjIyQzkwRjEwQjAwQwA=` |
| 15 | `wamid.HBgNNjI4NTg2NDMwMDM1OBUCABEYEjY5QjEyQUVGRjE3N0IxQUFGNgA=` |

Only remaining unsent clip:

- Clip 13: `2026_06_04_15_05_01_run_191__2026_06_04_15_05_01_run_191_clip_0009_v0_original_score8_BIAR_KULIT_TAMPAK_FRESH.mp4`
- Durable row state: `failed`; media ID `2277934532953300`; no WhatsApp message ID; error `Client network socket disconnected before secure TLS connection was established`.

The data is consistent for an idempotent one-clip resume, but the WhatsApp window expired 2026-08-05 11:26:20 WIB. Exact blocker: `no_active_customer_service_window`. The media guard must not be bypassed; first obtain separate re-engagement approval and wait for a new inbound.

## Missing username candidate 8

The complete linked raw conversation has one usable inbound only: `Halo saya Arni Suwardi dari tiktok,saya tertarik mengikuti kerja sama affiliate PROYA`. The canonical row, raw events, Affiliate Assignments, Delivery Log, Message Log, and later inbound history contain no TikTok handle or profile URL. No folder exists and none was allocated.

Proposed message (not sent):

> Halo Kak Arni, terima kasih sudah tertarik mengikuti kerja sama affiliate PROYA. Boleh kirim username TikTok Kakak (diawali @) atau link profil TikTok-nya? Contoh: @namapengguna.

## No-change and zero-duplicate proof

- Workflow-definition hashes were captured at `2026-08-06T08:52:47.952Z` and again at `2026-08-06T09:05:05.401Z`. All seven hashes and `updatedAt` values were identical:
  - `AffWaWebhook2026` `ce851a46442daed85e7ebb2b32ea97a245dd2950d426f289e9228d17068adb0e`
  - `AffWaReply2026` `2f7d7c41968fd0d37fe3f0cad7ef0d838799995547330305e8d60377f679751f`
  - `AffWaDelivery2026` `b05ecd7d796e29674d3f74ba0ed6aa8f70273d3b43eafb1c9f11a6b6ed2815ca`
  - `AffWaStatus2026` `5c4c7fb430b9b014e8ca97004aee1b71c697888541839e8896b4a6cebe565f86`
  - `AffWaOptIn2026` `2f18d94f197e6d067cb11e290efffaf2faa4502e98dad13cc7a3cee63c4b3ba8`
  - `AfDriveReady2026` `be293c8dc69b6cbab25a0bfd39023b67bf4a7bdfefa7350bf6e7de577d20a2fe`
  - `AfDriveRouter2026` `11a0009c3b40f59ad84d7df4bd1738a3438036852407fea42d4b98f69cfc4911`
- No recovery execution was performed. No parent workflow was rerun. No workflow activation/deactivation or definition PUT/POST/DELETE occurred.
- No WhatsApp media or template request was made. The only n8n execution beginning after the first definition baseline and before the final check was scheduled assignment-log retry `16596`; it had zero upload runs, zero media-send runs, and zero parsed-send runs. It was an independent production timer.
- Durable successful counts were unchanged by this review. Candidate 20 remains 14 distinct successful IDs and candidate 12 remains 14 distinct successful IDs; no duplicate delivery key or message ID was created.
- No spreadsheet row, folder, assignment, credential, permission, canonical lead, or delivery record was written. No new assignment or numbered folder was created.

Raw machine-readable evidence: `reports/missed-affiliate-candidates-current-20260806.json`.
