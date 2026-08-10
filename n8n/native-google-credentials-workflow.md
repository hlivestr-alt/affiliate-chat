# Native n8n Google Credentials Workflow

Use this version when Google Drive OAuth2 and Google Sheets credentials already exist in n8n.

Do not put the TikTok access token directly in workflow JSON or files. Store it as an n8n variable/credential and reference it in expressions.

## Variables

Create n8n variables:

- `GOOGLE_DRIVE_CLIPS_FOLDER_ID`
- `AFFILIATE_TRACKER_SPREADSHEET_ID`
- `AFFILIATE_TRACKER_SHEET_NAME`
- `TIKTOK_SHOP_ID`
- `TIKTOK_SHOP_CIPHER`
- `TIKTOK_ACCESS_TOKEN`
- `TIKTOK_APP_KEY`
- `TIKTOK_APP_SECRET`

The shop id and shop cipher you provided map to `TIKTOK_SHOP_ID` and `TIKTOK_SHOP_CIPHER`. The access token should be pasted into `TIKTOK_ACCESS_TOKEN` or a secure credential, not committed to this workspace.

The concrete values are listed in `n8n/variables.md`.

## Node Sequence

1. TikTok inbound trigger or polling
   - Production webhook path: `POST /webhook/tiktok-message`.
   - Output fields should include `conversation_id`, inbound message text, any affiliate identity fields available, an unread/read indicator, and a message timestamp.

2. Code node: `Filter Recent Unread Message`
   - Paste `n8n/code/filter-recent-unread.js`.
   - This only passes messages that are explicitly unread and within the last 24 hours.
   - Read, old, or undated messages return no items and stop before any reply or Drive assignment.

3. Code node: `Classify Inbound`
   - Paste `n8n/code/classify-inbound.js`.
   - Route:
     - `send_explanation_template`: send fixed explanation template.
     - `assign_drive_folder`: continue to Google inventory.
     - `no_send`: stop or append manual review if desired.
   - Confirmed messages need `username`; the folder rename uses the sanitized username as the primary folder name.

4. TikTok HTTP nodes: `Fetch Conversation List`
   - Before assignment, call `GET /affiliate_seller/202412/conversations` with `page_size=50` and `only_need_conversation_id=false`.
   - Sign it the same way as other TikTok Shop requests.
   - Use `n8n/code/resolve-username-from-conversations.js` to match by `conversation_id` or `creator_im_id` and fill `username`.

5. Google Drive node: `Search Clips Folders`
   - Credential: your existing Google Drive OAuth2 credential.
   - Resource: `File/Folder`.
   - Operation: `Search`.
   - Search Method: `Advanced Search`.
   - Query String:

```text
'{{ $vars.GOOGLE_DRIVE_CLIPS_FOLDER_ID }}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false
```

   - Return All: enabled.
   - Fields: `id`, `name`, `mimeType`, `webViewLink`.

6. Google Sheets node: `Read Tracker Rows`
   - Credential: your existing Google Sheets credential.
   - Resource: `Sheet Within Document`.
   - Operation: `Get Row(s)`.
   - Document: `{{ $vars.AFFILIATE_TRACKER_SPREADSHEET_ID }}` by ID.
   - Sheet: `{{ $vars.AFFILIATE_TRACKER_SHEET_NAME }}` by Name.

7. Code node: `Select Assignment`
   - Paste `n8n/code/select-assignment.js`.
   - It requires `username`, filters numeric folder names, ignores already-active folder ids in the tracker, picks the lowest batch, builds the Drive link, and emits the tracker row.
   - If `username` is missing, it emits `manual_review` with `last_error=missing_username` and does not reserve a folder.

8. Google Sheets node: `Append Reserved Row`
   - Operation: `Append Row`.
   - Mapping mode: map automatically.
   - Input: output of `Select Assignment`.
   - If `action` is `append_manual_review`, append it and stop. Do not send TikTok.

9. Wait node: `Reservation Settling`
   - Wait 1 second. This gives simultaneous confirmations time to append before the winner check.

10. Google Sheets node: `Read Tracker Rows After Reserve`
   - Same settings as `Read Tracker Rows`.

11. Code node: `Verify Reservation Winner`
   - Paste `n8n/code/verify-reservation-winner.js`.
   - If `action` is `manual_review_duplicate_reservation`, update/append that state and stop.

12. Google Drive node: `Rename Assigned Folder`
   - Credential: your existing Google Drive OAuth2 credential.
   - Resource: `File`.
   - Operation: `Update`.
   - File to Update: `{{ $json.drive_folder_id }}` by ID.
   - New Updated File Name: `{{ $json.drive_folder_new_name }}`.
   - This is how n8n renames a folder: Drive folders are files with folder metadata.

12. Google Drive node: `Share Assigned Folder`
   - Resource: `Folder`.
   - Operation: `Share`.
   - Folder: `{{ $json.drive_folder_id }}` by ID.
   - Permission Role: `Reader`.
   - Permission Type: `Anyone`.
   - Disable notification email.

13. Google Sheets node: `Mark Assigned`
   - Update the tracker row to `state=assigned`.
   - If your Sheets node returns a row number from append, use `Update Row`.
   - Otherwise use `Append or Update Row` matching on `drive_folder_id`; this is acceptable because every Drive folder id should only have one active tracker row.

14. Code node: `Sign TikTok Send`
   - Paste `n8n/code/sign-tiktok-shop-request.js`.
   - Requires `TIKTOK_APP_KEY` and `TIKTOK_APP_SECRET` in addition to the shop id, shop cipher, and access token.

15. HTTP Request node: `Send TikTok Message`
   - Method: `POST`.
   - URL: `{{ $json.tiktok_url }}`.
   - Headers:
     - `content-type`: `application/json`
     - `x-tts-access-token`: `{{ $json.tiktok_headers["x-tts-access-token"] }}`
   - Body JSON: `{{ $json.tiktok_body }}`
   - On success, update the tracker to `state=link_sent` and `link_sent_at={{ $now.toISO() }}`.
   - On failure, update the tracker to `state=failed_link_send` and keep the Drive folder assigned.

## Notes

- n8n's Google Drive node supports `File/Folder` search, `File` update, and `Folder` share operations with existing Google Drive credentials.
- n8n's Google Sheets node supports `Get Row(s)`, `Append Row`, `Append or Update Row`, and `Update Row` with existing Google Sheets credentials.
- TikTok Shop requests must be signed with HMAC-SHA256 using the app secret. The access token is excluded from the signature string.
