# Read-only production investigation: assignments 6942 and 6943

Captured 2026-08-24. No WhatsApp send, workflow trigger, recovery, assignment allocation, sheet write, lead-state repair, workflow edit, permission edit, credential edit, or `outcome_uncertain` clear was performed.

## Finding

Both incidents share one production defect introduced by the immediate-persistence hardening. After the in-flight `outcome_uncertain` PUT and a successful Meta response, `Read Delivery Row after Meta Success` returned the correct A:R row with 17 array elements. Column R (`delivery_state`) was blank, and the Google Sheets Values API omitted that trailing blank cell. `Validate Immediate Successful Send` incorrectly treats any row shorter than 18 elements as missing:

```js
if (row.length < 18) throw new Error("immediate_success_persistence_row_missing");
```

The validator therefore threw before `IF Successful Send Persistence Required`, `Persist Successful Clip Immediately`, its read-back, and `Confirm Successful Clip Durable`. The latter validator also has the same unsafe `row.length >= 18` assumption and must be fixed too.

The per-clip loop did not complete its first selected clip in any affected delivery execution. Consequently, the loop's done output never fired, `Prepare Batched Delivery Tracking` received no item, and all aggregate/final nodes were unreachable. This is not a split-in-batches aggregate-emission defect or a zero-item accident after loop completion; finalization stopped earlier at the first clip's pre-persistence validation.

## Side-by-side result

| Field | 6942 | 6943 |
| --- | --- | --- |
| Delivery execution | 24798, followed by a second user-triggered chain 24812 | 24957 |
| Final execution result | Both `error` | `error` |
| Clips selected | 24798: 15, indexes 1-15; 24812: 14, indexes 2-15 | 15, indexes 1-15 |
| Successful uploads | 2 | 1 |
| Cached media reuse | 0 | 0 |
| Upload failures | 0 | 0 |
| Meta send requests | 2 | 1 |
| Valid WAMIDs returned | 2 | 1 |
| Durable WAMIDs | 0 | 0 |
| `outcome_uncertain` | 2: indexes 1, 2 | 1: index 1 |
| Canonical remaining | 15 (no durable WAMIDs) | 15 (no durable WAMIDs) |
| Forensically actual remaining | indexes 3-15 | indexes 2-15 |
| `delivery_state` | `delivery_in_progress` | `delivery_in_progress` |
| Last successful node | `Read Delivery Row after Meta Success` | `Read Delivery Row after Meta Success` |
| Failure/stopping node | `Validate Immediate Successful Send` | `Validate Immediate Successful Send` |
| Final logger executed? | No | No |
| Safety classification | `Outcome uncertain — forensic reconciliation required` | `Outcome uncertain — forensic reconciliation required` |
| Safe recovery action | Reconcile clips 1-2 to their proven WAMIDs/statuses; after the production fix, resumably deliver only 3-15 | Reconcile clip 1 to its proven WAMID/status; after the production fix, resumably deliver only 2-15 |

## Assignment 6942

### Execution chain

First chain:

| Stage | Execution/node | Final status |
| --- | --- | --- |
| Inbound webhook | execution 24796, `AffWaWebhook2026` | `success` |
| Reply/status workflow | execution 24797, `AffWaReply2026` | `error`; child delivery error propagated at `Start Sequential File Delivery` |
| Delivery workflow | execution 24798, `AffWaDelivery2026` | `error`: `immediate_success_persistence_row_missing [line 11]` |
| Start log preparation/call | nodes in 24798 | executed, one item |
| Start logger child | execution 24801, `PROYA WhatsApp Delivery Log Writer` | `success`; row 29 synced as `0/15 | Sending` |
| Upload | node in 24798 | successful, media ID `1381116476782378` |
| Meta video send | node in 24798 | successful WAMID returned |
| In-flight claim PUT | node in 24798 | executed; Delivery row 618 became `outcome_uncertain` |
| Read-back | node in 24798 | executed; exact row 618 returned with 17 elements |
| Immediate successful-send PUT | `Persist Successful Clip Immediately` | not executed |
| Successful-send read-back/confirmation | downstream nodes | not executed |
| Video Message Log write | aggregate node | not executed; current matching video rows: 0 |
| Aggregate delivery tracking | `Prepare Batched Delivery Tracking` | not executed |
| Final lead-state write | `Update Final Send State` | not executed |
| Final log preparation/writer | final nodes/child | not executed |
| Video status callbacks | executions 24802 (`sent`), 24803 (`read`) | both `success` |

Second, new inbound/user-triggered chain (not an n8n retry and not scheduler recovery; `retryOf` is null):

| Stage | Execution/node | Final status |
| --- | --- | --- |
| Inbound webhook | execution 24810, `AffWaWebhook2026` | `success` |
| Reply/status workflow | execution 24811, `AffWaReply2026` | `error` |
| Delivery workflow | execution 24812, `AffWaDelivery2026` | `error`: same validator defect |
| Start logger child | execution 24816 | `success`; existing row 29 resynced as `0/15 | Sending` |
| Upload | node in 24812 | successful, media ID `1624697609368578` |
| Meta video send | node in 24812 | successful WAMID returned |
| In-flight claim PUT | node in 24812 | executed; Delivery row 619 became `outcome_uncertain` |
| Read-back | node in 24812 | executed; exact row 619 returned with 17 elements |
| Immediate persistence through final logger | downstream nodes | not executed |
| Video status callbacks | executions 24817 (`sent`), 24818 (`read`) | both `success` |

The second delivery selected indexes 2-15, proving that the uncertain-claim guard prevented clip 1 from being sent twice. No production recovery item exists for 6942. Assignment logger state row 34 is `sync_state=synced`, phase `start`; there is no matching row in `wa_outbound_log_recovery`.

### WAMID and uncertain-clip reconciliation evidence

| Clip | File | Delivery row | Attempts | WAMID returned by Meta | Callback evidence | Classification |
| --- | --- | ---: | ---: | --- | --- | --- |
| 1 | `2026_06_12_15_06_39_run_191__2026_06_12_15_06_39_run_191_clip_0008_v0_original_score9_SETELAH_RUTIN,_TAMPAK_LEBIH_SAMAR.mp4` | 618 | 1 | `wamid.HBgNNjI4ODk4OTcyNDk4NxUCABEYEjUyODlDNDlCQzZDMzE3NUM0RQA=` | accepted, sent, read | Meta returned a successful WAMID but persistence did not complete |
| 2 | `2026_06_13_11_05_46_run_191__2026_06_13_11_05_46_run_191_clip_0005_v1_b_roll_hook_broll_score9_BIAR_KULIT_TAMPAK_FRESH.mp4` | 619 | 2 | `wamid.HBgNNjI4ODk4OTcyNDk4NxUCABEYEjE5NEFBMjJGRTgwQkYwRjEyRgA=` | accepted, sent, read | Meta returned a successful WAMID but persistence did not complete |

Both WAMIDs are unique and map to different delivery keys. There is no duplicate or conflicting WAMID. There were two successful Meta requests, two explicit `sent` callbacks, zero explicit `delivered` callback events, two `read` callbacks, and zero failures/rejections. A `read` callback establishes receipt even though no separate `delivered` callback was retained for these two IDs.

Canonical durable success is 0: the WAMID field is blank in all 15 Delivery rows and there are zero matching outbound-video Message Log rows. Maximum canonical attempt count is 2. Rows 3-15 also show attempt 2 because the second batch pre-send claim increments the selected set; this is not evidence that Meta was called for those rows.

### Current canonical state

- Conversation state: `distribution_pending`
- Intent: `distribution_intent`
- Delivery state: `delivery_in_progress`
- Expected: 15
- Sent: blank/0
- Failed: blank/0
- Canonical remaining: 15
- Forensically actual remaining after reconciliation: indexes 3-15
- Error: blank

Delivery processing did not overwrite the conversation state.

### Exact clip selection

Execution 24798 selected all entries below. Execution 24812 selected the same list except index 1.

1. `2026_06_12_15_06_39_run_191__2026_06_12_15_06_39_run_191_clip_0008_v0_original_score9_SETELAH_RUTIN,_TAMPAK_LEBIH_SAMAR.mp4`
2. `2026_06_13_11_05_46_run_191__2026_06_13_11_05_46_run_191_clip_0005_v1_b_roll_hook_broll_score9_BIAR_KULIT_TAMPAK_FRESH.mp4`
3. `2026_06_13_11_05_46_run_191__2026_06_13_11_05_46_run_191_clip_0009_v5_transitional_bb_score9_KULIT_TERASA_LEBIH_HALUS.mp4`
4. `2026_06_13_11_05_46_run_191__2026_06_13_11_05_46_run_191_clip_0015_v1_b_roll_hook_broll_score8_STEP_SKINCARE_TANPA_RIBET.mp4`
5. `2026_07_02_10_32_02_002_run_191__2026_07_02_10_32_02_002_run_191_clip_0004_v1_b_roll_hook_broll_score9_COBA_STEP_UNTUK_GLOWING.mp4`
6. `2026_07_02_10_32_02_002_run_191__2026_07_02_10_32_02_002_run_191_clip_0012_v1_b_roll_hook_broll_score9_SEKARANG_TERASA_LEBIH_HALUS.mp4`
7. `2026_07_02_10_32_02_002_run_191__2026_07_02_10_32_02_002_run_191_clip_0013_v2_transitional_hook_score9_KULIT_KUSAM_TAMPAK_LEBIH_CERAH.mp4`
8. `2026_07_02_15_04_18_run_191__2026_07_02_15_04_18_run_191_clip_0003_v2_transitional_hook_score9_SETELAH_RUTIN,_TAMPAK_GLOWING.mp4`
9. `2026_07_02_15_04_18_run_191__2026_07_02_15_04_18_run_191_clip_0005_v3_black_bars_score9_KULIT_TAMPAK_LEBIH_CERAH.mp4`
10. `2026_07_02_15_04_18_run_191__2026_07_02_15_04_18_run_191_clip_0006_v3_black_bars_score9_COBA_STEP_UNTUK_CERAH.mp4`
11. `2026_07_03_10_25_17_run_191__2026_07_03_10_25_17_run_191_clip_0001_v2_transitional_hook_score9_RUTIN_PAKAI_BIAR_TERASA_LEBIH_LEMBAP.mp4`
12. `2026_07_03_10_25_17_run_191__2026_07_03_10_25_17_run_191_clip_0002_v2_transitional_hook_score9_BIAR_KULIT_TAMPAK_FRESH.mp4`
13. `2026_07_03_11_05_46_run_191__2026_07_03_11_05_46_run_191_clip_0007_v4_b_roll_only_score9_AWALNYA_KASAR.mp4`
14. `2026_07_03_11_05_46_run_191__2026_07_03_11_05_46_run_191_clip_0008_v0_original_score9_KULIT_TERASA_LEBIH_LEMBAP.mp4`
15. `2026_07_03_11_05_46_run_191__2026_07_03_11_05_46_run_191_clip_0009_v0_original_score9_KULIT_TAMPAK_LEBIH_CERAH.mp4`

## Assignment 6943

### Execution chain

| Stage | Execution/node | Final status |
| --- | --- | --- |
| Inbound webhook | execution 24955, `AffWaWebhook2026` | `success` |
| Reply/status workflow | execution 24956, `AffWaReply2026` | `error`; child delivery error propagated |
| Delivery workflow | execution 24957, `AffWaDelivery2026` | `error`: `immediate_success_persistence_row_missing [line 11]` |
| Start log preparation/call | nodes in 24957 | executed, one item |
| Start logger child | execution 24960 | `success`; row 30 synced as `0/15 | Sending` |
| Upload | node in 24957 | successful, media ID `4486292865024167` |
| Meta video send | node in 24957 | successful WAMID returned |
| In-flight claim PUT | node in 24957 | executed; Delivery row 633 became `outcome_uncertain` |
| Read-back | node in 24957 | executed; exact row 633 returned with 17 elements |
| Immediate successful-send PUT/read-back | downstream nodes | not executed |
| Video Message Log write | aggregate node | not executed; current matching video rows: 0 |
| Aggregate delivery tracking | `Prepare Batched Delivery Tracking` | not executed |
| Final lead-state write | `Update Final Send State` | not executed |
| Final log preparation/writer | final nodes/child | not executed |
| Video status callbacks | executions 24961 (`sent`), 24962 (`delivered`), 24963 (`read`) | all `success` |

No retry/recovery delivery execution exists for 6943. Assignment logger state row 35 is `sync_state=synced`, phase `start`; there is no matching row in `wa_outbound_log_recovery`.

### WAMID and uncertain-clip reconciliation evidence

| Clip | File | Delivery row | Attempts | WAMID returned by Meta | Callback evidence | Classification |
| --- | --- | ---: | ---: | --- | --- | --- |
| 1 | `2026_06_12_15_06_39_run_191__2026_06_12_15_06_39_run_191_clip_0007_v0_original_score9_COBA_STEP_UNTUK_CERAH.mp4` | 633 | 1 | `wamid.HBgNNjI4ODkwNzAzODQ0OBUCABEYEjY4QTFGODZBNzYwNTRBNzdEMAA=` | accepted, sent, delivered, read | Meta returned a successful WAMID but persistence did not complete |

The WAMID maps uniquely to clip 1. There were one Meta request, one valid WAMID, one explicit `sent`, one explicit `delivered`, one `read`, and zero failures/rejections. Canonical durable success is 0 and the video Message Log has 0 matching rows. Maximum canonical attempt count is 1.

### Current canonical state

- Conversation state: `awaiting_username`
- Intent: `clarification_pending`
- Delivery state: `delivery_in_progress`
- Expected: 15
- Sent: blank/0
- Failed: blank/0
- Canonical remaining: 15
- Forensically actual remaining after reconciliation: indexes 2-15
- Error: blank

The delivery execution started from `distribution_pending`; later inbound processing changed the current conversation state to `awaiting_username`/`clarification_pending`. Delivery processing itself did not overwrite the conversation state.

### Exact clip selection

Execution 24957 selected all entries below.

1. `2026_06_12_15_06_39_run_191__2026_06_12_15_06_39_run_191_clip_0007_v0_original_score9_COBA_STEP_UNTUK_CERAH.mp4`
2. `2026_06_12_15_06_39_run_191__2026_06_12_15_06_39_run_191_clip_0008_v1_b_roll_hook_broll_score9_SETELAH_RUTIN,_TAMPAK_LEBIH_SAMAR.mp4`
3. `2026_06_13_11_05_46_run_191__2026_06_13_11_05_46_run_191_clip_0002_v4_b_roll_only_score9_COBA_STEP_UNTUK_GLOWING.mp4`
4. `2026_06_13_11_05_46_run_191__2026_06_13_11_05_46_run_191_clip_0005_v2_transitional_hook_score9_BIAR_KULIT_TAMPAK_FRESH.mp4`
5. `2026_06_13_11_05_46_run_191__2026_06_13_11_05_46_run_191_clip_0010_v5_transitional_bb_score9_SEKARANG_TAMPAK_LEBIH_SAMAR.mp4`
6. `2026_07_02_10_32_02_002_run_191__2026_07_02_10_32_02_002_run_191_clip_0007_v4_b_roll_only_score9_SEKARANG_TERASA_LEBIH_LEMBAP.mp4`
7. `2026_07_02_10_32_02_002_run_191__2026_07_02_10_32_02_002_run_191_clip_0012_v2_transitional_hook_score9_SEKARANG_TERASA_LEBIH_HALUS.mp4`
8. `2026_07_02_10_32_02_002_run_191__2026_07_02_10_32_02_002_run_191_clip_0013_v3_black_bars_score9_KULIT_KUSAM_TAMPAK_LEBIH_CERAH.mp4`
9. `2026_07_02_15_04_18_run_191__2026_07_02_15_04_18_run_191_clip_0001_v1_b_roll_hook_broll_score9_NODANYA_MAKIN_SAMAR.mp4`
10. `2026_07_02_15_04_18_run_191__2026_07_02_15_04_18_run_191_clip_0006_v5_transitional_bb_score9_COBA_STEP_UNTUK_CERAH.mp4`
11. `2026_07_03_10_25_17_run_191__2026_07_03_10_25_17_run_191_clip_0001_v3_black_bars_score9_RUTIN_PAKAI_BIAR_TERASA_LEBIH_LEMBAP.mp4`
12. `2026_07_03_10_25_17_run_191__2026_07_03_10_25_17_run_191_clip_0003_v2_transitional_hook_score9_TAMPILAN_BEKAS_JERAWAT_CEK_STEP_INI.mp4`
13. `2026_07_03_11_05_46_run_191__2026_07_03_11_05_46_run_191_clip_0004_v0_original_score9_STEP_SKINCARE_TANPA_RIBET.mp4`
14. `2026_07_03_11_05_46_run_191__2026_07_03_11_05_46_run_191_clip_0008_v1_b_roll_hook_broll_score9_KULIT_TERASA_LEBIH_LEMBAP.mp4`
15. `2026_07_03_11_05_46_run_191__2026_07_03_11_05_46_run_191_clip_0009_v1_b_roll_hook_broll_score9_KULIT_TAMPAK_LEBIH_CERAH.mp4`

## Simple-log and recovery conclusions

For both assignments, `Prepare Assignment Final Log` and `Log Assignment Final (Nonblocking)` did not execute. No final logger child was created. The start logger children succeeded and left durable logger-state rows marked `synced`, so the logger did not fail, receive zero items, swallow an error, or leave a pending scheduler item. The delivery and parent reply executions terminated normally with terminal `error` status; they were not still running, waiting, new, restarted, or n8n-retried.

The latest observed `PROYA WhatsApp Delivery Log Retry` scheduler execution was 25356 and completed successfully. Both assignment-log state rows are already `synced`, so neither is pending. The separate outbound-log recovery worker is inactive and its table has no row for either assignment; immediate-persistence delivery never reached the aggregate queue path.

## Hardening assessment and required next step

The claim portion worked: it wrote `outcome_uncertain` before Meta and prevented clip 1 of 6942 from being duplicated in the second chain. The success-persistence portion did not work: its pre-write validator rejected a valid 17-element Google response caused solely by a trailing blank column, so accepted WAMIDs were never written. No duplicate send occurred.

Before processing more affiliates, fix and controlled-test both row-shape validators so they validate required indexed fields without requiring Google to return trailing blank cells. Also consider blocking the entire assignment when any unresolved `outcome_uncertain` row exists; the current guard skipped 6942 clip 1 but allowed a fresh inbound chain to send clip 2.

After the workflow defect is fixed, reconcile the proven WAMIDs and callback statuses into canonical Delivery/Message Log state without sending media. Only then may resumable delivery safely target 6942 indexes 3-15 and 6943 indexes 2-15. Do not run delivery before that reconciliation.
