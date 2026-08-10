# Affiliate Distribution Runbook

## Workflow set

The generated workflow files live in `n8n/imports`:

- `affiliate-whatsapp-lead-capture.json` preserves live ID
  `AfDriveReady2026`.
- `affiliate-whatsapp-opt-in.json` sends the approved template once.
- `affiliate-whatsapp-webhook-verification.json` handles Meta's GET challenge.
- `affiliate-whatsapp-webhook-router.json` verifies signed POST events.
- `affiliate-whatsapp-status.json` stores each outbound `wamid`, correlates
  later status callbacks, and deduplicates by `wamid` plus status.
- `affiliate-whatsapp-reply-status.json` handles opt-in, FAQ, posting, and
  delivery callbacks.
- `affiliate-whatsapp-file-delivery.json` reserves a numeric local batch and
  sends its 15 MP4 files sequentially.
- `affiliate-human-queue.json` deduplicates manual-review cases.
- `affiliate-distribution-setup.json` migrates and verifies the spreadsheet.

All new production workflows are generated inactive. Do not replace the live
lead-capture workflow until the Sheet migration, Meta credential, approved
template, callback, and end-to-end test are complete.

## WhatsApp credential and template

Create an n8n Header Auth credential:

```text
Name: WhatsApp Cloud API token
Header: Authorization
Value: Bearer <permanent-system-user-token>
```

Set its credential ID in `.env` as
`WHATSAPP_HEADER_AUTH_CREDENTIAL_ID` before regenerating/importing workflows.

Submit a Marketing template named `affiliate_clip_opt_in_v1`, language `id`,
using this exact body:

```text
Halo Kak {{1}}! 😊

PROYA ingin mengirimkan materi video affiliate TikTok melalui WhatsApp.

Dengan menyetujui, Kakak bersedia menambahkan keranjang kuning PROYA, mencantumkan @proya_official di bio, tidak mengubah konteks video, tidak membuat klaim berlebihan atau medis, serta tidak mengunggah banyak video serupa secara berdekatan.

Balas **“YA, SAYA SETUJU”** untuk menerima materi video PROYA secara berkala.
```

The live opt-in workflow sends the affiliate username as the `{{1}}` body
parameter. Submit this exact body to Meta and wait for the template to be
approved before retrying a real opt-in send.

The 2026-08-01 submission created the template record but Meta returned
`REJECTED` without a `rejected_reason`. No recipient message or clip delivery
was attempted; review or revise the template in WhatsApp Manager before the
one-recipient test is retried.

The affiliate should reply with the text `Ya, Saya Setuju`; the reply workflow
continues to enforce explicit opt-in before reserving a clip batch.

## Build and validate

```powershell
npm test
```

This regenerates both the existing TikTok intake artifacts and the distribution
workflow set, then runs the deterministic unit and workflow-safety tests.

## Activation order

1. Back up workflows, encrypted credentials, and the stopped `n8n_data` volume.
2. Recreate n8n from `compose.yaml` and verify `/clips_whatsapp` is readable
   and read-only.
3. Import `affiliate-distribution-setup.json`, run it once, and verify all five
   tabs and headers.
4. Create the WhatsApp credential and fill all WhatsApp environment values.
5. Create the Cloudflare tunnel and verify the Meta callback.
6. Import and activate Human Queue, WhatsApp Status Registry, Delivery,
   Reply/Status, Opt-in, Webhook Verification, and Webhook Router in that order.
7. Use a Meta test recipient and a compliant 15-file test batch.
8. Only after the test passes, update the live lead-capture workflow while
   preserving ID `AfDriveReady2026`.

## Operational behavior

- The WhatsApp clip root is mounted read-only from
  `D:\output_clips\export_batches_whatsapp` to `/clips_whatsapp`.
- A batch must contain exactly 15 MP4 files. Files are uploaded as-is; the
  workflow does not inspect size/codecs or transcode.
- Upload/send calls retry three times. A permanent failure stops the batch,
  writes a failed Delivery Log row, and opens a Human Queue case.
- Re-running delivery skips `sent` and `delivered` files.
- `files_sent` means all 15 Graph API message calls were accepted.
  `files_delivered` means all 15 delivery webhooks arrived.
- `accepted` is only the synchronous Graph API result. The authoritative
  lifecycle is the later `sent`, `delivered`, `read`, or `failed` callback.
- Outbound IDs are stored in `WhatsApp Message Log`. Status callbacks retain
  the Meta timestamp, recipient, conversation, pricing, full errors, and a
  status history. A repeated `wamid` plus status is ignored safely.
- The FAQ tab starts empty. Questions escalate until active FAQ rows exist.
- LM Studio answers only with an intent and confidence. The customer-facing
  response always comes verbatim from the FAQ Sheet.

## Operational gaps and limits

- Meta must approve `affiliate_clip_opt_in_v1` before activation. First contact
  cannot be a free-form WhatsApp message.
- Free-form video and FAQ messages require an open 24-hour customer-service
  window. If a resumed delivery is outside that window, send the approved
  template again and wait for a new explicit Yes.
- WhatsApp video is limited to 16 MB and compatible H.264/AAC MP4. This
  workflow intentionally does no size/codec preflight or transcoding; Meta
  rejections are logged as resumable failures and escalated.
- Messaging tiers, pair limits, quality limits, template pauses, and Graph API
  throttling are account-dependent. Sequential sends and bounded retries reduce
  burst pressure but cannot remove those limits.
- Google Sheets quotas still apply. Sheet operations use bounded retries, but a
  sustained quota failure can pause delivery and require a resume.
- The Windows host, Docker, clip disk, Cloudflare Tunnel, and LM Studio must
  remain online. An empty FAQ tab intentionally escalates every FAQ question.

## Meta callback configuration

In Meta Developer Dashboard, open the app's WhatsApp webhook configuration and
set the callback URL to the production endpoint:

```text
https://n8n.proyaofficial.com/webhook/whatsapp-callback
```

Use the same verification token configured as `WHATSAPP_VERIFY_TOKEN`, but do
not paste that token into workflow code or logs. Subscribe the
`whatsapp_business_account` object to the `messages` field. Keep both the GET
verification workflow and POST router active; the production URL then works
without n8n's **Listen for test event** mode. Meta permits one callback per app,
so do not activate a second WhatsApp Trigger that attempts to replace this
subscription.

The standard Webhook node is intentional. n8n's built-in WhatsApp Trigger can
emit complete `change.value` status payloads, but activating it manages the same
Meta app subscription and would conflict with this existing shared callback.
The raw Webhook path also makes all `conversation`, `pricing`, and `errors`
fields explicit and preserves exact-body signature verification.

## Delivery-status test

1. Confirm `Affiliate Distribution - WhatsApp Status Registry`, the webhook
   GET verifier, and the webhook POST router are active.
2. In Meta, save and validate the production callback URL above, then confirm
   the `messages` field is subscribed.
3. Send one approved template to a consented test recipient.
4. Save `messages[0].id` from the send response. Treat
   `messages[0].message_status = accepted` only as API acceptance.
5. Find the same ID in `WhatsApp Message Log`, then wait for its status webhook.
6. Confirm the callback `id` exactly equals the saved `wamid` and inspect
   `current_status`/`status_history_json` for `sent`, `delivered`, `read`, or
   `failed`.
7. If the result is `failed`, inspect `error_code`, `error_title`,
   `error_message`, and `error_details`; the complete Meta error array remains
   in `errors_json`.
8. Re-deliver the same callback only for a controlled test. The row's
   `processed_statuses` and history must not gain a duplicate entry.
