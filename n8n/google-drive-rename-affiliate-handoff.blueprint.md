# n8n Workflow Blueprint

Use this blueprint to build the n8n workflow around the scripts in this workspace.

## Nodes

1. TikTok inbound message trigger or polling node
   - Production webhook path: `POST /webhook/tiktok-message`.
   - Output must include at least the inbound text and a stable conversation id.
   - Recommended fields: `affiliate_id`, `affiliate_name`, `username`, `conversation_id`, `text`, an unread flag, and a message timestamp.

2. Code: `Filter Recent Unread Message`
   - Only pass messages that are unread and less than 24 hours old.
   - Accept unread indicators such as `unread=true`, `is_unread=true`, `read=false`, `is_read=false`, `read_status=unread`, or `unread_count > 0`.
   - Accept timestamp fields such as `received_at`, `created_at`, `create_time`, `timestamp`, `message_time`, `send_time`, or `sent_at`.
   - Return no items for read, old, or undated messages so no folder is reserved and no reply is sent.

3. Code: `Prepare assignment input`
   - Convert the inbound item into base64 JSON so PowerShell quoting cannot corrupt it.
   - In the native imported workflow, confirmed replies first call `GET /affiliate_seller/202412/conversations` with `only_need_conversation_id=false` and `page_size=50`, then match by `conversation_id` or `creator_im_id` to fill `username`.

```javascript
const inbound = $json.body || $json;
return [
  {
    json: {
      affiliateInputBase64: Buffer.from(JSON.stringify(inbound), "utf8").toString("base64")
    }
  }
];
```

4. Execute Command: `Assign or classify`
   - Command:

```powershell
node "C:\Data\Affiliate Chat\src\assignAffiliateFolder.js" --json-base64 "{{ $json.affiliateInputBase64 }}"
```

   - Parse the stdout JSON in the next node.
   - The script returns one of:
     - `send_explanation_template`
     - `send_drive_link`
     - `no_send`
   - Confirmed messages must include `username`; missing usernames are logged as `manual_review` with `last_error=missing_username`.

5. IF or Switch: route by `action`

6. TikTok send fixed explanation
   - Run only when `action` is `send_explanation_template`.
   - Send `outboundMessage`.
   - Do not call an LLM.

7. TikTok send Drive link
   - Run only when `action` is `send_drive_link`.
   - Send `outboundMessage`.
   - Keep `trackerRowNumber` for the next step.

8. Execute Command: `Mark link sent`
   - Run after TikTok send success.
   - Command:

```powershell
node "C:\Data\Affiliate Chat\src\updateTrackerAfterSend.js" --row "{{ $json.trackerRowNumber }}" --state link_sent
```

9. Execute Command: `Mark send failed`
   - Connect this from the TikTok send error path.
   - Command:

```powershell
node "C:\Data\Affiliate Chat\src\updateTrackerAfterSend.js" --row "{{ $json.trackerRowNumber }}" --state failed_link_send --error "{{ $json.error.message || 'tiktok_send_failed' }}"
```

## Why the Reservation Is Safe

The assignment script reads currently active tracker rows, picks the first numeric Drive folder, appends a `reserved` row, then re-reads the tracker after `RESERVATION_SETTLE_MS`. If two executions tried to reserve the same folder, only the earliest appended row wins; later rows are marked `manual_review` and do not send a link.

For a stricter lock in high-volume production, use a database with a unique constraint on `drive_folder_id`. The optional SQL schema in `schemas/affiliate_assignments.sql` is ready for that path.

## No-Folder Path

When no numeric folder is available, the script appends a `manual_review` tracker row with `last_error=no_numeric_folder_available` and returns `no_send`. n8n should not send a TikTok message automatically.

## Missing Username Path

When a confirmed message has no `username`, the workflow appends a `manual_review` tracker row with `last_error=missing_username` and returns no send. This prevents Drive folders from being renamed to sender IDs or affiliate display names.

## Send Failure Path

When TikTok send fails after the folder is assigned, run `updateTrackerAfterSend.js` with `--state failed_link_send`. This keeps the Drive folder assigned and records the error for manual follow-up.
