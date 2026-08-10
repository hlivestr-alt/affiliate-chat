# Read-only audit: missed real affiliate WhatsApp leads

Audit cut-off: 2026-08-06 12:49 WIB (2026-08-06 05:49 UTC). This report is an investigation only; no lead was processed.

## Scope and method

The audit read the live n8n SQLite database through explicit read-only connections. It correlated raw, signature-valid inbound WhatsApp webhook events; the durable inbound-dedup table; the latest pre-cut-off spreadsheet snapshots already retained in delivery execution `16383`; historical delivery executions; the durable outbound-log and PROYA assignment-log tables; WhatsApp Message Log; Delivery Log; and historical Affiliate Assignments.

The last spreadsheet snapshot was read by the pre-existing delivery execution at 2026-08-06 12:22 WIB. A further inbound response arrived at 12:48 WIB while this audit was running; it is included from its raw webhook and currently-running reply execution, but it had not yet reached the retained sheet snapshot at the cut-off.

Username normalization was read-only: Unicode trim, lowercase, leading `@` removal, TikTok profile URL extraction, and trailing-punctuation removal. Phone comparisons used digits with Indonesian `0` normalized to `62`.

## Summary

| Measure | Count |
|---|---:|
| Audited raw-inbound range | 2026-08-03 14:01 to 2026-08-06 12:48 WIB |
| Inbound conversations reviewed | 29 |
| Raw inbound message events / unique WhatsApp IDs | 82 / 81 |
| Clear, offer-context affirmative conversations | 20 |
| With usable TikTok usernames | 19 |
| Already completed | 3 |
| Currently in progress | 6 |
| Previously partially sent | 1 |
| Eligible for manual approval | 0 |
| Requiring manual review | 5 (4 data conflicts, 1 partial-send case) |
| Requiring approved WhatsApp re-engagement | 5 (4 explicit classification plus 1 missing-username case) |
| Opt-outs / test-internal among the 20 candidates | 0 / 0 |

No duplicate message was presented as a candidate: the raw history contained one repeated message ID, but that was an internal test-message duplicate and did not pass the offer-context / real-lead filter. The durable inbound-dedup table had no row for the pre-dedup historical candidates; its absence was not treated as positive eligibility.

## Candidate review table

`Assignment ID` is blank only after checking the historical Affiliate Assignments snapshot by normalized username and conversation/phone. `Folder` is the numbered batch already owned in WhatsApp Leads where present. `Successful sends` is a distinct-file count from durable Delivery Log rows with a message ID and accepted/sent/delivered/read evidence; it is corroborated against WhatsApp Message Log. “—” means none found in the inspected records.

| # | Inbound WIB | WhatsApp | TikTok username | Original inbound text | Inbound message ID | Webhook exec | Lead state | Assignment ID | Folder | Successful sends | Classification | Reason and proposed future action |
|---:|---|---|---|---|---|---:|---|---|---|---:|---|---|
| 1 | 2026-08-03 18:13:02 | +62 895••••1998 | `yuvikachuu` | Hallo saya Yuvikachuu dari tiktok. Saya tertarik mengikuti kerja sama affiliate PROYA | `wamid.HBgNNjI4OTUwODg4MTk5OBUCABIYIEE1RUM3MDg5REY1RjI5Nzg0QzFBMjQ0QzBGMTlGNUVBAA==` | 12360 | `files_delivered` | — | 6901 | 15 | Already completed | Lead is `files_delivered`; 15 durable video sends. No action. |
| 2 | 2026-08-03 18:52:20 | +62 877••••6589 | `haqiqi_41` | Halo kak saya haqiqi dari tiktok. Saya tertarik mengikuti kerja sama affiliate PROYA | `wamid.HBgNNjI4NzcxNjcxNjU4ORUCABIYIEFDRDQ5RURGNEZCRkY3RkMxODU2NDU5RDExNEI4MjQ2AA==` | 12457 | `awaiting_username` | — | — | 0 | Data conflict — manual review | Same conversation later supplied a TikTok profile URL for `haqiqi_41`, but the lead remains blank/`awaiting_username`. Review only; do not alter records. |
| 3 | 2026-08-03 19:09:42 | +62 896••••2493 | `uwininshp` | Halo, saya {{uwininshp}} dari TikTok. Saya tertarik mengikuti kerja sama affiliate PROYA | `wamid.HBgNNjI4OTY1NjI2MjQ5MxUCABIYFDNBNkQyQzIwQ0U0RTE3RkMyMDhGAA==` | 12482 | `files_delivered` | — | 6902 | 15 | Already completed | Lead is `files_delivered`; 15 durable video sends. No action. |
| 4 | 2026-08-03 19:35:00 | +62 823••••9945 | `mayreeaemyou` | Halo, saya Maria dari TikTok. Saya tertarik mengikuti kerja sama affiliate PROYA | `wamid.HBgNNjI4MjMyOTQ5OTk0NRUCABIYIEFDN0VDMDQyNzZFNEU3QjJDRDJFNEZCOEJBODAwREE1AA==` | 12533 | `delivery_in_progress` | — | 6905 | 7 | Currently in progress | Canonical state is in progress; seven successful sends, with outcome-uncertain rows. Do not process; operations review only. |
| 5 | 2026-08-03 19:49:04 | +62 857••••6787 | `fadliyyahnr` | Halo, saya fadliyyahnr dari TikTok. Saya tertarik mengikuti kerja sama affiliate PROYA | `wamid.HBgNNjI4NTcxMDQxNjc4NxUCABIYIEFDMTUwMjUxREFGMDY4N0Y4RDIzMjQxMDQ2RkY3QkQyAA==` | 12542 | `files_delivered` | — | 6904 | 15 | Already completed | Lead is `files_delivered`; 15 durable video sends. No action. |
| 6 | 2026-08-03 21:31:05 | +62 818••••1011 | `sanmisan88` | Halo, saya {{Sanmisan88}} dari TikTok. Saya tertarik mengikuti kerja sama affiliate PROYA. | `wamid.HBgNNjI4MTgwMjM0MTAxMRUCABIYFDJBRUNBNTdBMEZDOTUyM0E1N0M0AA==` | 12604 | `delivery_in_progress` | — | 6906 | 12 | Currently in progress | Canonical state is in progress; 12 successful sends, with outcome-uncertain rows. Do not process. |
| 7 | 2026-08-03 22:17:25 | +62 856••••0399 | `truelove894` | Halo, saya {{rita}} dari TikTok. Saya tertarik mengikuti kerja sama affiliate PROYA.** | `wamid.HBgNNjI4NTY1OTQwMDM5ORUCABIYIEFDOTk0RTM5Q0M0RjE1RTMzNDlGRTM5QzFEMzdFMkE0AA==` | 12637 | `distribution_pending` | — | — | 0 | Requires approved WhatsApp re-engagement | No assignment or successful send; prior customer-service window expired 2026-08-04 22:19 WIB. Obtain approval before any re-engagement. |
| 8 | 2026-08-04 07:56:17 | +62 896••••1314 | — | Halo saya Arni Suwardi dari tiktok,saya tertarik mengikuti kerja sama affiliate PROYA | `wamid.HBgNNjI4OTYzMDMwMTMxNBUCABIYIEFDNUJCOTA3OEVEMTJFREQ4NzIzNzMyQTUyQkZEMjUxAA==` | 12692 | `awaiting_username` | — | — | 0 | Missing username | No usable handle in the linked raw conversation or lead. Requires approved WhatsApp re-engagement if follow-up is desired. |
| 9 | 2026-08-04 08:08:16 | +62 857••••1597 | `nur.aissyiah` | Halo, saya nuraissyiah dari Tiktok. Saya tertarik mengikuti kerja sama affiliate PROYA. | `wamid.HBgNNjI4NTcyODA0MTU5NxUCABIYIEFDQzg1M0JEMzcyMzYwQTA3OTc2Njk1MDg3QThBOTc4AA==` | 12711 | `distribution_pending` | — | — | 0 | Requires approved WhatsApp re-engagement | No assignment or successful send; prior window expired 2026-08-05 08:10 WIB. Obtain approval before any re-engagement. |
| 10 | 2026-08-04 08:43:27 | +62 895••••2962 | `nyakcutriska1123` | Halo, saya nyakcutriska1123 dari TikTok. Saya tertarik mengikuti kerja sama affiliate PROYA. | `wamid.HBgNNjI4OTUxMzQ5Mjk2MhUCABIYIEE1RDc3RjE2NjdDREZDNTQwRjdEMDYxRDdDODhDQUM2AA==` | 12740 | `distribution_pending` | — | — | 0 | Requires approved WhatsApp re-engagement | No assignment or successful send; prior window expired 2026-08-05 08:45 WIB. Obtain approval before any re-engagement. |
| 11 | 2026-08-04 11:13:04 | +62 821••••7108 | `masdanang` | Halo, saya {{masdanang}} dari TikTok. Saya tertarik mengikuti kerja sama affiliate PROYA | `wamid.HBgNNjI4MjEzMDkxNzEwOBUCABIYIEFDQjU5ODE3Q0VFMjcwMzUxNzczQUU5OEVBQzE4ODBFAA==` | 12777 | `awaiting_username` | — | — | 0 | Data conflict — manual review | Raw message deterministically supplies `masdanang`, but lead remains blank/`awaiting_username`. Review only; do not alter records. |
| 12 | 2026-08-04 11:25:21 | +62 858••••0358 | `mxylna_` | Halo, saya mxylna_ dari TikTok. Saya tertarik mengikuti kerja sama affiliate PROYA. | `wamid.HBgNNjI4NTg2NDMwMDM1OBUCABIYIEFDM0I5RDUzRDAyQTEyREMxMUUxMkE5MUQ0NTMxMUMzAA==` | 12804 | `failed` | — | 6907 | 14 | Previously partially sent | Fourteen distinct files have durable successful-send evidence; one is failed. Manual review only; do not resend. |
| 13 | 2026-08-04 12:33:08 | +62 851••••2134 | `ikilorek_1` | Halo, saya firda dari TikTok. Saya tertarik mengikuti kerja sama affiliate PROYA. | `wamid.HBgNNjI4NTE1NjI0MjEzNBUCABIYIEFDQ0ZCODQ4MDBEN0FGQzFDOTI5OUU0NTY5RkIzRUIyAA==` | 12968 | `delivery_in_progress` | — | 6908 | 3 | Currently in progress | Canonical state is in progress; three successful sends. Do not process. |
| 14 | 2026-08-04 12:38:48 | +62 857••••8520 | `tiandesya_p` | Halo, saya tiandesya_p dari TikTok. Saya tertarik mengikuti kerja sama affiliate PROYA | `wamid.HBgNNjI4NTc1NzgwODUyMBUCABIYFDNBRDkxM0ExQjQ5OURFN0YzNTRGAA==` | 13075 | `delivery_in_progress` | — | 6909 | 2 | Currently in progress | Canonical state is in progress; two successful sends. Do not process. |
| 15 | 2026-08-04 15:04:55 | +62 831••••3806 | `shipwithnaa` | Halo, saya shipwithnaa dari TikTok. Saya tertarik mengikuti kerja sama affiliate PROYA.** | `wamid.HBgNNjI4MzE2ODg1MzgwNhUCABIYIEFDNEFENkVGMzkxNzUwREMzNjY4NEQ3MzExQ0QxMTZCAA==` | 14487 | `awaiting_username` | — | — | 0 | Data conflict — manual review | Raw message and subsequent `MINAT@shipwithnaa` provide the handle, but lead remains blank/`awaiting_username`. Review only. |
| 16 | 2026-08-04 16:02:54 | +62 823••••2349 | `ratna.sagraha` | Halo, saya Ratna Sa dari TikTok. Saya tertarik mengikuti kerja sama affiliate PROYA | `wamid.HBgNNjI4MjMyNTU2MjM0ORUCABIYFDNBM0E3MDUxNzk1NUM3NkUwOUJBAA==` | 14879 | `distribution_pending` | — | — | 0 | Requires approved WhatsApp re-engagement | No assignment or successful send; prior window expired 2026-08-05 16:03 WIB. Obtain approval before any re-engagement. |
| 17 | 2026-08-04 20:35:15 | +62 857••••2907 | `izzatanaura` | Halo, saya  izzatanaura dari TikTok. Saya tertarik mengikuti kerja sama affiliate PROYA. | `wamid.HBgNNjI4NTcyNjA3MjkwNxUCABIYFDJBMjk4RkJGQUM3OUZBNDU1QTc4AA==` | 15518 | `delivery_in_progress` | — | 6913 | 0 | Currently in progress | Batch 6913 has 15 `send_prepared` rows but no successful media ID. Canonical state remains in progress; do not process. |
| 18 | 2026-08-04 21:56:51 | +62 858••••6702 | `ririnshop04` | Halo, saya {{neni riyanti}} dari TikTok. Saya tertarik mengikuti kerja sama affiliate PROYA.** | `wamid.HBgNNjI4NTgxNDMwNjcwMhUCABIYIEFDM0YyRTQwMDA0MUU2QjkxNzUyMUQ2NDA5RjRCQjZFAA==` | 15625 | `delivery_in_progress` | — | 6914 | 0 | Currently in progress | Batch 6914 has 15 `send_prepared` rows but no successful media ID. Canonical state remains in progress; do not process. |
| 19 | 2026-08-05 07:20:00 | +62 823••••0262 | `wahyuniaksa.msi` | **Halo, saya @wahyuniaksa.msi dari TikTok. Saya tertarik mengikuti kerja sama affiliate PROYA. ** | `wamid.HBgNNjI4MjM5MzExMDI2MhUCABIYIEFDQzNDQUYyOUEzMTRGQzdGODcyRTdDNTRCMUJEMzdFAA==` | 15748 | `awaiting_username` | — | — | 0 | Data conflict — manual review | Raw message and later `MINAT @wahyuniaksa.msi` supply the handle, but lead remains blank/`awaiting_username`. Review only. |
| 20 | 2026-08-06 12:48:44 | +62 857••••8260 | `girlsshop` | Halo saya @girlsshop dari TikTok. Saya tertarik mengikuti kerja sama affiliate PROYA. | `wamid.HBgNNjI4NTc3NDc1ODI2MBUCABIYIEFDOTVGRUYyODZEQzc0QTE2RjRFMkQ2Q0M3Q0RCMjBCAA==` | 16393 | Reply execution 16394 running at cut-off; no retained lead row yet | — | — | 0 | Currently in progress | Inbound arrived during this audit and its existing Reply workflow was still running. Do not intervene or process. |

## Unresolved data conflicts

- `haqiqi_41` / +62 877••••6589: profile URL was supplied after the PROYA-interest message, while the lead remains `awaiting_username` with an empty username.
- `masdanang` / +62 821••••7108: raw inbound embeds the handle, while the lead remains `awaiting_username` with an empty username.
- `shipwithnaa` / +62 831••••3806: raw inbound plus a later explicit `MINAT@shipwithnaa` conflict with an empty/`awaiting_username` lead.
- `wahyuniaksa.msi` / +62 823••••0262: raw inbound and later explicit `MINAT` conflict with an empty/`awaiting_username` lead.
- `mxylna_` / +62 858••••0358: 14 durable successful media records coexist with a failed lead; this is preserved as a partial-send case for manual review, not an invitation to resend.

## Proof of no changes

All access made by this audit was read-only: SQLite was opened with `OPEN_READONLY`; no n8n API, webhook endpoint, Google write API, Google Drive mutation, Meta send/upload endpoint, or n8n workflow-execution endpoint was called.

- Workflow-definition SHA-256 baselines captured at 2026-08-06 13:49 CST exactly matched a second capture at 13:51 CST for all in-scope workflows: `AffWaWebhook2026` `850403…843b49`; `AffWaReply2026` `dc858d…19c1ac`; `AffWaDelivery2026` `33646a…7b0bfd`; `AffWaStatus2026` `1b902f…354cae`; `AffWaOptIn2026` `ada127…c8e549`; `AfDriveReady2026` `d6da92…d7b6c`; `AfDriveRouter2026` `9f2125…4c7c5`.
- No workflow was invoked by this audit. Any executions appearing during the audit are raw inbound webhook traffic already received by production (candidate 20 is one such independent event), not audit-triggered work.
- No WhatsApp upload/send node was executed by this audit. Existing media-send records cited above are historical execution and log evidence only.
- No spreadsheet, delivery-log, durable-table, folder, canonical-lead-state, credential, or permission write operation was called by this audit. The report is the only file created, and it is local.
- No numbered folder was allocated/reserved and no Google Drive folder was renamed; the only folder evidence inspected was existing historical ownership in lead/assignment records.
- No credentials or workflow permissions were accessed for modification.

Important qualification: production received independent inbound traffic during the read-only audit. Between the 13:49 and 13:51 CST captures, a separate Reply execution `16399` and Delivery execution `16400` began; these were not invoked by this audit. Therefore the evidence proves that the audit itself made no production change, but cannot truthfully assert that no other actor or the already-active production workflows changed production during the same minutes.

Stop condition: this audit ends here. No candidate was backfilled, re-engaged, or otherwise processed **by this audit**.
