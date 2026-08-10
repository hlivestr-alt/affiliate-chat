# Dami Affiliate Outreach and WhatsApp Distribution

Dami remains responsible for initial TikTok outreach. The existing TikTok Shop
webhook captures interested affiliates and Indonesian WhatsApp numbers. The
extended n8n workflow set then manages approved WhatsApp opt-in, direct local
clip delivery, FAQ routing through local LM Studio/Qwen, human escalation, and
funnel tracking in Google Sheets.

## Architecture

1. `AfDriveRouter2026` receives TikTok Shop message notifications.
2. `AfDriveReady2026` extracts the phone number, resolves the username, updates
   `WhatsApp Leads`, and hands a new lead to the opt-in workflow.
3. WhatsApp sends approved template `affiliate_clip_opt_in_v1`.
4. An explicit Yes reserves the lowest unused numeric folder under
   `/clips_whatsapp`.
5. The delivery workflow uploads and sends the folder's 15 MP4s sequentially.
6. Every accepted outbound `wamid` is registered; signed production webhooks
   then correlate `sent`, `delivered`, `read`, or `failed` updates and route
   affiliate replies.
7. LM Studio classifies against active FAQ rows. Exact Sheet answers are sent
   only at confidence `>= 0.85`; all other cases enter `Human Queue`.

## Local services

- n8n `2.29.9`
- Existing external Docker volume `n8n_data`
- Read-only clip mounts:
  `D:\output_clips\export_batches` -> `/clips` and
  `D:\output_clips\export_batches_whatsapp` -> `/clips_whatsapp`
- LM Studio:
  `http://host.docker.internal:1234/v1`
- Public callback:
  `https://n8n.proyaofficial.com/webhook/whatsapp-callback`

See [the distribution runbook](docs/affiliate-distribution-runbook.md) and
[Cloudflare tunnel setup](docs/cloudflare-tunnel.md) for configuration and
activation.

## Build and test

```powershell
npm test
```

Generated workflow JSON is written to `n8n/imports`. New WhatsApp workflows are
inactive by default so they can be imported safely before Meta credentials and
template approval are complete.
