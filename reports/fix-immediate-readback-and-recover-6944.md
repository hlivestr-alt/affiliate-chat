# Production fix and recovery report: assignment 6944

Completed 2026-08-24. Production WhatsApp entry was paused during the change and restored only after canonical completion verification.

## Outcome

- Assignment 6944: **15/15 durable successful clips**
- Distinct WAMIDs: **15**
- Distinct media IDs: **15**
- `outcome_uncertain`: **0**
- Duplicate/conflicting WAMIDs: **0**
- Delivery state: `files_sent`; expected 15, sent 15, failed 0, remaining 0, error blank
- Conversation state preserved: `awaiting_username`; intent `clarification_pending`
- Existing simple log row 31: `15/15 | Complete`, error blank
- Original clip 1 WAMID, media ID, and attempts remained unchanged

## Production protection and backups

`AffWaWebhook2026` was deactivated at `2026-08-24T10:47:59.005Z` after confirming no active Delivery execution. One existing Reply execution had no nodes/child delivery and was not interrupted. The entry definition/version was unchanged. Entry was restored at `2026-08-24T11:26:27.912Z` on version `ee13ba31-6764-4c41-91f1-6efaab917f05`.

Backups, node hashes, canonical before/final snapshots, test evidence, deployment evidence, reconciliation, and restore evidence are in `n8n/exports/assignment-6944-readback-recovery-20260824`.

## Exact context defect and fix

The lost field was `delivery_log_row_number` at the output boundary of `Persist Successful Clip Immediately`. Google's PUT response replaced the input item and contained only update metadata. The old `Read Back Persisted Successful Clip` URL read `$json.delivery_log_row_number`, which was blank and collapsed to the broad `Delivery Log!A:R` range.

Smallest production fix:

1. Added `Prepare Successful Clip Read-Back Target` between the PUT and read-back.
2. It explicitly restores the paired item from `Validate Immediate Successful Send`.
3. It validates a decimal, safe-integer row number of at least 2.
4. It validates delivery key, batch, conversation, normalized phone, clip index/name, and WAMID context.
5. It constructs one exact URL: `Delivery Log!A<row>:R<row>`.
6. `Read Back Persisted Successful Clip` now uses only the prepared URL.

Missing, blank, zero, negative, non-numeric, unsafe, or header-row targets throw `successful_clip_readback_row_number_invalid` before an HTTP request. Missing clip context throws `successful_clip_readback_context_invalid`. The broad fallback is gone from this path.

No other proven direct PUT-output/read-back context-loss sequence exists. The in-flight claim path already restores clip context through `Restore Clip after In-Flight Claim`; intentional resume/batch reads of complete tables were not changed.

## Controlled tests

The inactive controlled workflow contained no Meta or upload nodes and was deleted after testing.

| Test | Execution | Result |
| --- | ---: | --- |
| A: PUT response loses input; context restored | 25848 | Pass |
| B: exact one-row URL | 25849 | Pass |
| C: 17-value trailing blank normalizes to 18 | 25850 | Pass |
| D: blank row | 25851 | Expected fail closed |
| E: zero row | 25852 | Expected fail closed |
| E: negative row | 25853 | Expected fail closed |
| E: non-numeric row | 25854 | Expected fail closed |
| F: wrong read-back row | 25855 | Expected durable-confirmation failure |
| G: same-WAMID replay | 25856 | Pass; persistence required false, one durable WAMID |
| H: conflicting WAMID | 25857 | Expected conflict |
| I: two-clip ordered loop | 25858 | Pass; two exact targets, two aggregate items |
| J: 15-clip completion | 25859 | Pass; 15 durable items, one final logger item |

The existing `Validate Immediate Successful Send` and `Confirm Successful Clip Durable` code/hashes did not change.

## Deployment

- Previous version: `0e41e3cc-036a-4903-adcc-068e4039037a`
- Previous definition hash: `ab8c45c5900e15d1febaa897871dc580c17b69fcd60f6c94c734706444327106`
- New active version: `73ad63f9-dcc2-41c2-a607-96e2244b229c`
- New definition hash: `c51dd9a88fc105f72a70d2ba2122afde2f1ef6db7ead94c9a01a675fe16fe389`
- Changed existing node: `Read Back Persisted Successful Clip`
- Added node: `Prepare Successful Clip Read-Back Target`
- Changed connection: successful PUT → new guard/restore → exact read-back
- Settings, credentials, caller policy/IDs, authorization guards, Meta structures, state separation, uncertainty protection, and validators were preserved.

Critical unchanged hashes:

| Node | Before and after SHA-256 |
| --- | --- |
| `Upload Video to WhatsApp` | `4f455775e2382621066549c37309ef72c854c6f223a34379e5f01ab8af4990a7` |
| `Send WhatsApp Video` | `c00021dc3164be2837f386cb7b5be4e3428f731cc08897fe9066469cc8703e37` |
| `Validate Immediate Successful Send` | `3f33b0777ae58a6e9bd1ecd248c7c9bb2bbe3c9e94d88ce2e6a42b218b2e8c0a` |
| `Confirm Successful Clip Durable` | `44094bcebcf122315ca75b2776b878ddb0cb407353ae179930391a91391d2219` |

## Clip 1 reconciliation and preflight

Only the missing video Message Log row was appended from the already durable Delivery row and execution/callback evidence. No Delivery row or Meta request was made. Clip 1 remained:

- WAMID `wamid.HBgNNjI4MTkxMDgzMzAzMRUCABEYEjJGODY3NEE3QUFFQkU0QzE4RAA=`
- media ID `1776486560467385`
- attempts `1`
- matching Meta sends `1`
- callbacks: sent (25796), delivered (25797), read (25798)

Preflight at `2026-08-24T10:56:58.560Z` passed every gate: no scoped active execution, one owner, 15 canonical/disk clips, one durable clip 1, no extra WAMID, exact remaining set 2–15, no uncertainty, valid service window through `2026-08-25T09:19:53.000Z`, compatible delivery state, current conversation state, and exact simple row 31.

## Recovery executions

- 25860 / 25861: first authorized launch. It stopped before upload/Meta because the isolated CLI logger could not load Data Tables. It performed only batch pre-send claims; canonical success remained clip 1 only. The exact orphan launcher was terminated and both rows recorded as crashed.
- 25864 / 25865: authorized recovery of indexes 2–15. It durably completed indexes 2–14, with exact read-back after each Meta success. The isolated runner later stalled before clip 15; with clip 15 still `send_prepared` and no uncertain row, the exact launcher was terminated and both rows recorded as crashed.
- 25869 / 25870: authorized continuation selected only index 15 and returned success. It completed clip 15 and aggregate finalization.
- Logger children 25862, 25866, and 25872 failed only because the isolated CLI runtime disabled the Data Table module. This did not alter the Delivery loop. Missing secondary Message Logs and the existing simple row were reconciled after all 15 WAMIDs were durable.

Exactly 14 new uploads, 14 Meta sends, and 14 new WAMIDs were produced for indexes 2–15. Clip 1 never re-entered upload, cached-media, send, or retry logic. All 15 final media IDs and WAMIDs are distinct.

Canonical `attempts` values are 1 for clip 1, 3 for clips 2–14, and 4 for clip 15 because each safe batch pre-send claim increments selected rows, including launches that ended before Meta. These bookkeeping values do not represent duplicate Meta sends; every clip has exactly one durable WAMID and no conflicting record.

## Final state and production readiness

Thirteen Message Log rows missing from the terminated middle execution were appended from their durable Delivery rows. The final result is 15 exact video Message Log rows and 15 exact Delivery rows. Existing simple row 31 was updated in place; no new row was created.

Production entry is active again. The fixed Delivery workflow is active with its caller allowlist unchanged (`AffWaReply2026`). No open Delivery execution remains. The confirmed read-back defect is removed and the path is safe for new unattended affiliate deliveries. No artificial real affiliate was created; observation of the first naturally occurring post-restore assignment remains the next operational confirmation.
