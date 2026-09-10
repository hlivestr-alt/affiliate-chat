# Production Canary — Pending Natural Affiliate

## Current status

The fresh production path is **not yet classified** as `VERIFIED FOR UNATTENDED PRODUCTION` because no naturally occurring legitimate fresh affiliate arrived during the interactive observation window.

This is not a canary failure. Normal dispatch remains enabled and a persistent read-only monitor is running. The monitor automatically restores the caller pause if the first post-unpause Delivery execution ends in error.

## Pre-unpause verification

- Verified idle immediately before unpause: zero `new`, `running`, or `waiting` executions.
- Active Delivery workflow version: `9900c0a2-5f14-4ee2-8a6e-adcf0f0a7b37`.
- Paused definition SHA-256: `47f0450e2346166d2ce5ce8649af75317e06006c08caac205c0e06caebd51423`.
- Repaired edge verified: `Done: Delivery Send Attempt → Prepare Assignment Final Log`.
- Accepted protections verified: separate `delivery_state`, column-scoped lead writes, `outcome_uncertain`, immediate WAMID persistence, exact-row read-back, trailing blank normalization, missing-row fail-closed handling, identical-WAMID idempotency, and conflicting-WAMID protection.
- Meta upload node SHA-256: `3b544fca92e1791adcd53f5f35120165fda7f43ef04aa96af0b266501e9de3de`.
- Meta send node SHA-256: `be4f60f5700604603162a2744e9858433d19049cbf69383a80de70e9076db07e`.
- Meta credential reference remained `CQK8KrdZjxOzOzgc`.
- Caller policy remained `workflowsFromAList`.

## Dispatch restoration

At `2026-08-28T03:47:56.529Z`, only the operational caller control was restored:

`callerIds: __delivery_recovery_paused__ → AffWaReply2026`

Nodes and connections were byte-for-byte unchanged. The enabled definition SHA-256 is `043d8a45996c95ffe88c7e89152d4ac46f4285944a34c65c3c017032a976d593`.

The execution boundary immediately after restoration was `26835`.

## Canary fields

1. Active version/hash before canary: recorded above.
2. Dispatch restoration: caller allowlist only.
3. Canary username/folder: pending natural traffic.
4. Webhook/reply/delivery/start/final execution IDs: pending.
5. Selected clips: pending.
6. Successful upload/cache uses: pending.
7. Successful Meta sends: pending.
8. Durable WAMIDs: pending.
9. Per-clip durability: pending.
10. Repaired finalization edge execution: pending.
11. Aggregate counters: pending.
12. Final delivery state: pending.
13. Conversation state/intent: pending.
14. Simple Delivery Log row: pending.
15. Duplicate-send check: pending.
16. Recovery/manual repair: none performed.
17. Normal dispatch: enabled.
18. Final classification: **PENDING — no natural canary candidate yet**.
19. Remaining limitation: classification requires the next genuinely fresh assignment to complete through the normal workflow.

## Monitor evidence

- Preflight: `C:\Data\Affiliate Chat\n8n\exports\production-canary-20260828\2026-08-28T03-47-40-430Z-preflight.json`
- Unpause record: `C:\Data\Affiliate Chat\n8n\exports\production-canary-20260828\2026-08-28T03-47-56-532Z-unpause.json`
- Persistent snapshots: `C:\Data\Affiliate Chat\n8n\exports\production-canary-20260828\persistent-watch.ndjson`
- Monitor status: `C:\Data\Affiliate Chat\n8n\exports\production-canary-20260828\persistent-monitor-status.json`

Scheduled logger-retry sweeps are not accepted as canary candidates. No historical assignment, including 6945–6947, has been resumed or altered.
