# Read-only production investigation: assignment 6944

Captured 2026-08-24. No resend, recovery, webhook replay, folder allocation, assignment creation, Sheet/log repair, `outcome_uncertain` clear, workflow change, credential change, or permission change was performed.

## Finding and safety classification

**Classification: `Partially sent — resumable after verification`.**

Clip 1 was uploaded, accepted by Meta, immediately persisted to Delivery row 648 with a valid WAMID, and subsequently received `sent`, `delivered`, and `read` callbacks. Clips 2–15 were never uploaded or sent. There are no current `outcome_uncertain` rows.

The execution stopped at `Confirm Successful Clip Durable` because its preceding HTTP read-back lost the clip row number. `Persist Successful Clip Immediately` returns only Google's update response, not the prior delivery context. `Read Back Persisted Successful Clip` then evaluated `$json.delivery_log_row_number` as blank, requested `Delivery Log!A:R` instead of `Delivery Log!A648:R648`, returned all 662 rows, and passed the header row to the validator. The validator correctly rejected the header as an identity mismatch.

This is a **read-back range/context-mapping defect in the immediate-persistence path**, not the prior trailing-blank validator defect.

## Workflow version

- Execution 25791 `workflowVersionId`: `0e41e3cc-036a-4903-adcc-068e4039037a`
- Version definition SHA-256: `ab8c45c5900e15d1febaa897871dc580c17b69fcd60f6c94c734706444327106`
- Activated: `2026-08-24 15:47:46.531 WIB`
- Execution began: `2026-08-24 16:12:02.297 WIB`
- The same version remains active.

The execution snapshot contains both fixed validator code nodes plus the pre-send `outcome_uncertain` claim, immediate successful PUT, read-back confirmation, and separate `delivery_state` handling.

## Execution chain

| Execution | Workflow/stage | Result and timing (WIB) | Last successful/stopping point |
| --- | --- | --- | --- |
| 25789 | `AffWaWebhook2026`, inbound `MINAT Kerlinday01` | Success, 16:11:58.802–16:11:58.830 | `Process WhatsApp Event` |
| 25790 | `AffWaReply2026` | Error, 16:11:58.825–16:12:33.162 | Child `Start Sequential File Delivery` propagated delivery error |
| 25791 | `AffWaDelivery2026` | Error, 16:12:02.297–16:12:32.904 | Last successful: `Read Back Persisted Successful Clip`; stopped in `Confirm Successful Clip Durable` |
| 25794 | `PROYA WhatsApp Delivery Log Writer`, start logger | Success, 16:12:12.547–16:12:14.610 | `Done: Assignment Log Synced`; simple row 31 written as `0/15`, `Sending` |
| 25796 | Video status callback | Success, 16:12:30.301–16:12:30.319 | `sent` for clip 1 WAMID |
| 25797 | Video status callback | Success, 16:12:30.592–16:12:30.608 | `delivered` for clip 1 WAMID |
| 25798 | Video status callback | Success, 16:19:11.043–16:19:11.064 | `read` for clip 1 WAMID |

Executions 25792, 25793, and 25795 are `sent`, `delivered`, and `read` callbacks for the separate confirmation text WAMID, not the video. There was no n8n retry (`retryOf` is null), no resumable delivery, and no recovery delivery for 6944. Assignment-log retry executions 25805/25807/25808/25809 found no pending start-log work because state row 36 was already `synced`. No outbound recovery table row exists for 6944.

## Exact delivery path

The reservation/context, start logging, 15-item resumable preparation, batch pre-send claims, first loop item, media/send guards, new upload, in-flight `outcome_uncertain` PUT, Meta send, WAMID validation, immediate Delivery-row PUT, and read-back HTTP request all succeeded.

- New upload: 1; media ID `1776486560467385`
- Cached media uses: 0
- Failed uploads: 0
- Meta video requests: 1
- Valid Meta WAMIDs: 1
- Failed/rejected sends: 0
- Durable canonical WAMIDs: 1
- Video Message Log rows: 0 (aggregate logging was never reached)
- Duplicate/conflicting WAMIDs: 0

Protected clip 1 WAMID:

`wamid.HBgNNjI4MTkxMDgzMzAzMRUCABEYEjJGODY3NEE3QUFFQkU0QzE4RAA=`

The exact Delivery row is 648 and its current state is `accepted`, attempts `1`, sent at `2026-08-24T09:12:28.393Z`. Callbacks prove it progressed through `sent`, `delivered`, and `read`, although status Sheet logging is presently paused and did not update this row.

## Validator verification and exact failure

`Read Delivery Row after Meta Success` correctly requested row 648 and returned one row of width 17. Google omitted only trailing column R (`delivery_state`) because it was blank. `Validate Immediate Successful Send` right-padded it to width 18, validated identity/attempt/state, and emitted one item. The prior validator defect is therefore fixed.

`Persist Successful Clip Immediately` then successfully updated `'Delivery Log'!A648:R648`. Its response did not carry `delivery_log_row_number`. The next node's URL expression therefore collapsed from:

`Delivery Log!A{{$json.delivery_log_row_number}}:R{{$json.delivery_log_row_number}}`

to the whole-column range `Delivery Log!A:R`. The sanitized response contained 662 rows: first row width 18 (headers), last row width 17 (clip 15 with blank trailing delivery state). `Confirm Successful Clip Durable` normalized the first/header row to width 18, but correctly failed identity validation.

Exact deterministic Code-node error:

`successful_clip_persistence_not_verified:wa:6281910833031:6944:2026_06_12_15_06_39_run_191__2026_06_12_15_06_39_run_191_clip_0007_v1_b_roll_hook_broll_score9_COBA_STEP_UNTUK_CERAH.mp4`

n8n's serialized display was the file name plus `[line 14]`, with description `6944`.

`Confirm Successful Clip Durable` did not reject a legitimate row or expose another trailing-blank problem: it was given the wrong array's first row because of the range/context loss.

## Clip state

Expected and selected: 15 clips, exact indexes 1–15. Actual Meta-send count by clip: index 1 = 1; indexes 2–15 = 0. All canonical rows show attempts `1` because batch pre-send claiming increments the selected set before looping; that is not evidence of 15 Meta requests.

Current `outcome_uncertain` count: 0. Clip 1 temporarily held the protective in-flight state, then the successful immediate PUT changed it to durable `accepted`. Therefore no uncertain clip needs classification among the four unresolved categories.

Exact remaining clips: indexes **2–15**.

1. `2026_06_12_15_06_39_run_191__2026_06_12_15_06_39_run_191_clip_0008_v3_black_bars_score9_SETELAH_RUTIN,_TAMPAK_LEBIH_SAMAR.mp4`
2. `2026_06_13_11_05_46_run_191__2026_06_13_11_05_46_run_191_clip_0002_v5_transitional_bb_score9_COBA_STEP_UNTUK_GLOWING.mp4`
3. `2026_06_13_11_05_46_run_191__2026_06_13_11_05_46_run_191_clip_0005_v3_black_bars_score9_BIAR_KULIT_TAMPAK_FRESH.mp4`
4. `2026_06_13_11_05_46_run_191__2026_06_13_11_05_46_run_191_clip_0015_v2_transitional_hook_score8_STEP_SKINCARE_TANPA_RIBET.mp4`
5. `2026_07_02_10_32_02_002_run_191__2026_07_02_10_32_02_002_run_191_clip_0003_v1_b_roll_hook_score9_CEK_PRODUK_DI_LIVE_INI.mp4`
6. `2026_07_02_10_32_02_002_run_191__2026_07_02_10_32_02_002_run_191_clip_0010_v0_original_score9_CEK_PRODUK_DI_LIVE_INI.mp4`
7. `2026_07_02_10_32_02_002_run_191__2026_07_02_10_32_02_002_run_191_clip_0013_v4_b_roll_only_score9_KULIT_KUSAM_TAMPAK_LEBIH_CERAH.mp4`
8. `2026_07_02_15_04_18_run_191__2026_07_02_15_04_18_run_191_clip_0001_v2_transitional_hook_score9_NODANYA_MAKIN_SAMAR.mp4`
9. `2026_07_02_15_04_18_run_191__2026_07_02_15_04_18_run_191_clip_0005_v4_b_roll_only_score9_KULIT_TAMPAK_LEBIH_CERAH.mp4`
10. `2026_07_03_10_25_17_run_191__2026_07_03_10_25_17_run_191_clip_0001_v4_b_roll_only_score9_RUTIN_PAKAI_BIAR_TERASA_LEBIH_LEMBAP.mp4`
11. `2026_07_03_10_25_17_run_191__2026_07_03_10_25_17_run_191_clip_0006_v1_b_roll_hook_broll_score8_PENGALAMAN_KULIT_TAMPAK_LEBIH_CERAH.mp4`
12. `2026_07_03_11_05_46_run_191__2026_07_03_11_05_46_run_191_clip_0004_v1_b_roll_hook_broll_score9_STEP_SKINCARE_TANPA_RIBET.mp4`
13. `2026_07_03_11_05_46_run_191__2026_07_03_11_05_46_run_191_clip_0007_v0_original_score9_AWALNYA_KASAR.mp4`
14. `2026_07_03_11_05_46_run_191__2026_07_03_11_05_46_run_191_clip_0009_v2_transitional_hook_score9_KULIT_TAMPAK_LEBIH_CERAH.mp4`

The list is numbered 1–14 above for readability; these correspond to delivery indexes 2–15 in order.

## Current lead and simple-log state

- Conversation state: `awaiting_username`
- Intent: `clarification_pending`
- Delivery state: `delivery_in_progress`
- Expected: 15
- Aggregate sent counter: blank/0
- Aggregate failed counter: blank/0
- Canonical successful clips: 1 (from Delivery row, despite stale aggregate counter)
- Remaining: 14, indexes 2–15
- Batch/folder: 6944
- Current lead error: blank

A later inbound at 16:19 WIB changed conversational state/intent; delivery processing did not overwrite it. The separate `delivery_state` remained intact.

The simple log remains `0/15 | Sending` because start logging succeeded, then delivery stopped inside the first clip before loop continuation and aggregate finalization. `Prepare Assignment Final Log` and `Log Assignment Final (Nonblocking)` never executed; no final logger child was invoked and no final logger item existed.

## Production health and recommendation

Since deployment/activation of version `0e41e3cc-036a-4903-adcc-068e4039037a`, there has been exactly one real `AffWaDelivery2026` execution: 25791 for 6944. Results: 0 successes, 1 failure; first failing node `Confirm Successful Clip Durable`. No later real assignment started after 6944.

Safest recovery, after a workflow fix and verification: preserve clip 1 and its exact WAMID; repair/reconcile the missing video Message Log/final aggregate state without sending it; then resumably deliver only indexes 2–15. Do not resend clip 1.

New affiliate delivery should be temporarily stopped until the read-back range/context fix is deployed and controlled-tested. This recommendation was not enacted during the investigation.
