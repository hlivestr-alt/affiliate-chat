# Fresh production delivery incident: assignments 6945–6947

Captured and remediated on 2026-08-28. Times in n8n evidence are UTC unless marked WIB.

## Executive finding

The initial premise that all three assignments failed at the same first-send node is false.

- 6945 used the older Delivery version and stopped after one real send at `Confirm Successful Clip Durable` because the successful PUT response had lost `delivery_log_row_number`; the subsequent broad read-back could not verify the exact row.
- 6946 and 6947 each completed all 15 uploads and all 15 Meta sends. They have 15 distinct accepted WAMIDs, attempts `1`, finalized `WhatsApp Leads` counters, and no unresolved uncertainty. They appeared as `0/15 | Sending` only because `Prepare Assignment Final Log` was orphaned in the production graph.
- The shared visible symptom was therefore stale simple logging, not a shared `0/15` media-delivery failure.

The graph defect was one missing edge:

`Done: Delivery Send Attempt` had no outgoing connection, while `Prepare Assignment Final Log` had no incoming connection.

The smallest fix connected:

`Done: Delivery Send Attempt → Prepare Assignment Final Log`

No node configuration, Meta node, credential, authorization guard, selection rule, state model, or persistence validator changed.

## Production safety

At `2026-08-28T03:20:58.623Z`, there were zero `new`, `running`, or `waiting` executions and zero open Delivery executions.

At `2026-08-28T03:22:05Z`, new Delivery calls were paused by changing only the Delivery caller allowlist to:

`callerIds = __delivery_recovery_paused__`

`AffWaWebhook2026` and `AffWaReply2026` remained active, so inbound WhatsApp reception remained active. No Meta node was disabled, no credential or caller permission was altered, and no assignment was deleted or reset. Dispatch remains paused after deployment and reconciliation.

## Live workflow versions and hashes

Post-deployment capture:

| Workflow | Active version | Definition SHA-256 | Active |
| --- | --- | --- | --- |
| `AffWaWebhook2026` | `ee13ba31-6764-4c41-91f1-6efaab917f05` | `6eb39ab098e2141f3a3273d534ca1d6354391f3e145ea969814ee52b25cb401f` | yes |
| `AffWaReply2026` | `246d3a95-be64-4ad1-a334-94a2954ce7ae` | `bd47d78e7937d76c3e4d32addfdebc460cffcece68cccb98b06b7a60066c3908` | yes |
| `AffWaDelivery2026` | `9900c0a2-5f14-4ee2-8a6e-adcf0f0a7b37` | `47f0450e2346166d2ce5ce8649af75317e06006c08caac205c0e06caebd51423` | yes, dispatch caller paused |
| Delivery Log Writer `ecBB2oa6xeY2knFu` | `146b9cca-ea87-4221-9c41-a6d74a3598de` | `dfb2d689ac83e68c8f4433d0864e807f64ffd0f641f340866fd517648144e67e` | yes |
| Delivery Log Retry `m1KBWKOLjwxbtFPP` | `dc3ad268-e072-4289-9ef8-d32bdea060ef` | `e28c62782f6fe86e06c52372207898fd64769ecd50ef674763cf44e0a01099fe` | yes |

Immediately before the incident pause, Delivery was version `73ad63f9-dcc2-41c2-a607-96e2244b229c`, hash `c51dd9a88fc105f72a70d2ba2122afde2f1ef6db7ead94c9a01a675fe16fe389`, active, with `callerIds=AffWaReply2026`.

All previously deployed node-level protections were simultaneously present in version `73ad...`: state separation, column-scoped lead writes, pre-send uncertainty claim, immediate WAMID persistence, exact read-back preparation, trailing-cell normalization, row-number restoration, identical-WAMID idempotency, conflicting-WAMID fail-closed behavior, aggregation, and final simple-log nodes. They were not simultaneously functional end-to-end because the final-log branch was disconnected.

## Side-by-side execution trace

Reply and Delivery use `saveDataSuccessExecution=none`. Successful execution IDs for 6946 and 6947 were allocated but removed after completion; the IDs below are reconstructed from consecutive allocation gaps, webhook/log-writer chronology, and durable timestamps.

| Stage | 6945 | 6946 | 6947 |
| --- | --- | --- | --- |
| Webhook execution | `25837` | `26081` | `26756` |
| Reply execution | `25838` error | `26082` success, no-retention | `26757` success, no-retention |
| Delivery execution | `25839` error | `26083` success, no-retention | `26758` success, no-retention |
| Workflow version used | `0e41e3cc-036a-4903-adcc-068e4039037a` | `73ad63f9-dcc2-41c2-a607-96e2244b229c` | `73ad63f9-dcc2-41c2-a607-96e2244b229c` |
| Start logger | `25843`, success | `26086`, success | `26761`, success |
| Clips selected | 15, indexes 1–15 | 15, indexes 1–15 | 15, indexes 1–15 |
| Uploads attempted/succeeded | 1/1 | 15/15 | 15/15 |
| Meta sends attempted | 1 | 15 | 15 |
| Valid WAMIDs | 1 | 15 | 15 |
| Durable WAMIDs | 1 | 15 | 15 |
| Remaining `outcome_uncertain` | 0 | 0 | 0 |
| Last successful node | `Read Back Persisted Successful Clip` | `Done: Delivery Send Attempt` | `Done: Delivery Send Attempt` |
| First failing node | `Confirm Successful Clip Durable` | none; graph terminated | none; graph terminated |
| Error | `successful_clip_persistence_not_verified:...clip_0007...mp4` | none | none |
| Final logger | absent | absent | absent |

There is no first common failing node across all three. For 6946 and 6947, the common stop is the successful `Done: Delivery Send Attempt` node. For 6945, execution failed earlier on the superseded version.

The later 6947 Reply error `26767` at `Refresh Existing WhatsApp Lead Window` was a separate inbound event and a transient closed connection. It did not stop the active Delivery run, which continued through all 15 sends and final lead counters.

## Actual send and durable state

### 6945

- Selected indexes: 1–15.
- Index 1: upload succeeded, Meta send succeeded, and one durable accepted Delivery row exists.
- Indexes 2–15: Meta was never called; all remain `send_prepared` with one pre-send claim attempt.
- Durable WAMID: `wamid.HBgNNjI4NzcxMTgwNjQzMRUCABEYEkYzOTZEOERCREFERjE0QjJCNgA=`.
- Callback executions: sent `25844`, delivered `25845`, read `25846`.
- No `outcome_uncertain` row remains. There is no unknowable result.

### 6946

All indexes 1–15 are accepted with attempts `1`, 15 distinct media IDs, and 15 distinct WAMIDs. All 15 have `sent` and `delivered` callbacks.

```text
wamid.HBgNNjI4NzcwMTQ5NjE3MRUCABEYEkUxODU4ODkzNTdBNjRGMTVDRQA=
wamid.HBgNNjI4NzcwMTQ5NjE3MRUCABEYEjNFODQyQ0M2RDA5MTBCMUYxQgA=
wamid.HBgNNjI4NzcwMTQ5NjE3MRUCABEYEjc2NkFBRjIwQ0UwQkNDN0EzRAA=
wamid.HBgNNjI4NzcwMTQ5NjE3MRUCABEYEjQ4NjBENkNCNzdGRjYxNzJFNgA=
wamid.HBgNNjI4NzcwMTQ5NjE3MRUCABEYEkNBRTk5RjhEODA4ODU5RjQ0NAA=
wamid.HBgNNjI4NzcwMTQ5NjE3MRUCABEYEjVGMTFCRjQ0QzMyQjM5OEE0MgA=
wamid.HBgNNjI4NzcwMTQ5NjE3MRUCABEYEjc1NTI0NzE1QTY4Mzg4Qzc4RAA=
wamid.HBgNNjI4NzcwMTQ5NjE3MRUCABEYEkMzRjdGRkVGOUQzNzM5RjhGMAA=
wamid.HBgNNjI4NzcwMTQ5NjE3MRUCABEYEkFGOUFGMjU2RjlDMDg0MjkzOAA=
wamid.HBgNNjI4NzcwMTQ5NjE3MRUCABEYEjhBODA0RDg3RUYxMzQ1NDFDQgA=
wamid.HBgNNjI4NzcwMTQ5NjE3MRUCABEYEjY3QzhEMkU0Q0FBRjhFOUE4NAA=
wamid.HBgNNjI4NzcwMTQ5NjE3MRUCABEYEkFDN0RGQkFDOUQ0QTI3Qzc5QwA=
wamid.HBgNNjI4NzcwMTQ5NjE3MRUCABEYEjZCQzFERDEyQjQ0MkU1QjlFMwA=
wamid.HBgNNjI4NzcwMTQ5NjE3MRUCABEYEjI2QUJDRUM5RkYxNTIwNDVEQQA=
wamid.HBgNNjI4NzcwMTQ5NjE3MRUCABEYEkEyQTA1QTkzM0MzRjIyQURENQA=
```

### 6947

All indexes 1–15 are accepted with attempts `1`, 15 distinct media IDs, and 15 distinct WAMIDs. Every delivery WAMID has `sent` and `read`; four also retained a distinct `delivered` callback execution.

```text
wamid.HBgNNjI4MTM5NTgyOTMwMRUCABEYEjc0MUI1QUY0REE5N0E5QUQ5NgA=
wamid.HBgNNjI4MTM5NTgyOTMwMRUCABEYEkJBOTEzMkYxQTc5NzlEREE5MAA=
wamid.HBgNNjI4MTM5NTgyOTMwMRUCABEYEkVBQkM3NzgzRkY1MEUzQjkxMwA=
wamid.HBgNNjI4MTM5NTgyOTMwMRUCABEYEjE1QkY0NkMxNkQ5RDhCMzlFQgA=
wamid.HBgNNjI4MTM5NTgyOTMwMRUCABEYEkY3QTRFQ0NBNUVBQjFBOUY4QwA=
wamid.HBgNNjI4MTM5NTgyOTMwMRUCABEYEjEwNzI5NjNFQkI3ODE0ODY0NAA=
wamid.HBgNNjI4MTM5NTgyOTMwMRUCABEYEjYwQzhFQzg2NzZCMzBGNUIzQwA=
wamid.HBgNNjI4MTM5NTgyOTMwMRUCABEYEkI2MzZDN0VDQjFERTNCMjE1MwA=
wamid.HBgNNjI4MTM5NTgyOTMwMRUCABEYEkEyNTY4MTA5QTk4RjVFQTlCQwA=
wamid.HBgNNjI4MTM5NTgyOTMwMRUCABEYEjdBODI1MTEyRTU2RDExMzE3NAA=
wamid.HBgNNjI4MTM5NTgyOTMwMRUCABEYEjE0MDU1QTE0MzE0QzFDODJGNwA=
wamid.HBgNNjI4MTM5NTgyOTMwMRUCABEYEjJFQTFGN0M3NkEwMjJEQjA1NwA=
wamid.HBgNNjI4MTM5NTgyOTMwMRUCABEYEkQxRjEwRjFFRkM1MDE2RDBBNwA=
wamid.HBgNNjI4MTM5NTgyOTMwMRUCABEYEkQyQTY1QTJCQ0FFQTc3NTlGNgA=
wamid.HBgNNjI4MTM5NTgyOTMwMRUCABEYEjZFODEyQTU2QURCMDYyNkQxRQA=
```

## First-clip path audit

| Step | 6945 | 6946 | 6947 |
| --- | --- | --- | --- |
| Reservation/start log/15-file selection | reached | reached | reached |
| Authorization and uncertainty claim | reached for clip 1 | reached for all 15 | reached for all 15 |
| Claim persistence/read-back | reached | reached | reached |
| Upload and Meta video send | clip 1 only | all 15 | all 15 |
| WAMID extraction | clip 1 | all 15 | all 15 |
| Immediate PUT | clip 1 | all 15 | all 15 |
| Exact-row read-back | old version used defective broad read | all 15 exact | all 15 exact |
| Durable confirmation | failed on clip 1 read-back despite durable row | all 15 | all 15 |
| Loop continuation | no | through clip 15 | through clip 15 |
| Aggregate/message log/lead counters | no | reached | reached |
| Final simple logger | not reached | unreachable | unreachable |

## 6944 and last genuine fresh success

6944 was not an uninterrupted fresh completion. It began as production execution `25791`, failed after clip 1, and was completed through controlled recovery executions `25860/25861`, `25864/25865`, and `25869/25870`, followed by secondary reconciliation.

`6944 does not prove the normal fresh assignment path works.`

The most recent genuine fresh, uninterrupted production completion before the incident series was folder 6940 (`imcahaya_06`):

- first fresh inbound webhook `23785`;
- delivery-confirmation webhook `23790`;
- Reply `23791` and Delivery `23792` (successful no-retention IDs);
- start logger `23795`;
- final logger `23829`;
- 15 accepted rows, 15 distinct WAMIDs, attempts `1`, simple row `15/15 Complete`.

6941 later reached Complete only after a recovery path; 6942 and 6943 remain partial/stuck historical cases.

## Controlled reproduction and deployment

The post-deployment controlled workflow used exact cloned production configurations/expressions for:

- start-log preparation;
- Loop Over Items;
- pre-send `outcome_uncertain` claim;
- Meta result parsing;
- immediate-success validation;
- exact-row read-back target preparation;
- durable confirmation;
- batch aggregation;
- lead summary preparation;
- final-log preparation.

External Google writes and Meta calls were mocked. The test made zero real Meta requests and zero real Google writes.

| Scenario | New clips processed | Uncertain claims | Mock Meta successes | Durable confirmations | Final result |
| --- | ---: | ---: | ---: | ---: | --- |
| Fresh assignment | 15 | 15 | 15 | 15 | `15/15 Complete`, final logger reached |
| Resumable, 5 already durable | 10 | 10 | 10 | 10 | aggregate `15/15 Complete`, final logger reached |

The test source was active production version `9900c0a2-5f14-4ee2-8a6e-adcf0f0a7b37`, hash `47f0450e...51423`. Controlled workflow `O1RWcB3sX1CGYHGx` was deleted after execution.

Deployment changed one connection and zero nodes. The pre-fix paused definition hash was `12d384f0b3d475c59a1ac8439a33c4a46b9245e1d3709af1110dc0be8d9399d1`; the new definition hash is `47f0450e2346166d2ce5ce8649af75317e06006c08caac205c0e06caebd51423`.

## Post-fix reconciliation

No delivery was resumed and no Meta request was made.

- 6945: service window expired. Canonical state is now safely `partial`, `files_sent=1`, and the existing simple row is `1/15 | Partial | Service window expired; re-engagement required`. Conversation state remains `awaiting_username` with the same intent and inbound message ID. It is not eligible to send the remaining 14 clips until legitimate re-engagement opens a new service window.
- 6946: already complete; existing simple row corrected in place to `15/15 | Complete`. No delivery row, WAMID, message row, or folder changed.
- 6947: already complete; existing simple row corrected in place to `15/15 | Complete`. No delivery row, WAMID, message row, or folder changed.

Duplicate-send proof:

- all 45 selected detail rows retain attempts `1`;
- durable WAMIDs are distinct within each assignment: `1/1`, `15/15`, `15/15`;
- reconciliation made `0` Meta requests;
- no Delivery or Message Log row changed during reconciliation;
- no new folder was allocated.

## Canary and verification status

No natural canary has occurred after deployment because new delivery dispatch remains paused. There are no canary execution IDs yet.

The code defect is patched and controlled actual-node tests pass, but the normal fresh-affiliate path is **not yet verified end-to-end in production**. It must not be declared fully fixed until one new legitimate affiliate runs uninterrupted through 15 sequential durable sends, aggregate finalization, and the simple log becoming `15/15 Complete` without manual recovery.

## Evidence and backups

- Pre-pause live definitions: `n8n/exports/fresh-production-incident-6945-6947-20260828/pre-pause/`
- Raw execution evidence: `n8n/exports/fresh-production-incident-6945-6947-20260828/execution-evidence.json`
- Canonical sheet state: `n8n/exports/fresh-production-incident-6945-6947-20260828/sheet-state.json`
- Callback evidence: `n8n/exports/fresh-production-incident-6945-6947-20260828/callback-evidence.json`
- Recent assignment history: `n8n/exports/fresh-production-incident-6945-6947-20260828/recent-assignment-history.json`
- Pre/post-fix Delivery backup and manifest: `n8n/exports/fresh-production-incident-6945-6947-20260828/deployment/`
- Controlled actual-node tests: `n8n/exports/fresh-production-incident-6945-6947-20260828/actual-node-controlled-tests.json`
- Reconciliation read-back: `n8n/exports/fresh-production-incident-6945-6947-20260828/reconciliation.json`
- Post-deployment live definitions: `n8n/exports/fresh-production-incident-6945-6947-20260828/post-deploy/`

