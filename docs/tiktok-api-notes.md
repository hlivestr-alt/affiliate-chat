# TikTok Affiliate Messaging Notes

The workflow keeps TikTok sending as an n8n API step because the exact send node depends on the approved TikTok Shop Partner account, app signing setup, region, and credentials.

Useful official references:

- New affiliate messaging APIs: https://partner.tiktokshop.com/docv2/page/new-affiliate-messaging-apis
- Get messages in an affiliate conversation: https://partner.tiktokshop.com/docv2/page/get-message-in-the-conversation-202412
- Create or get a conversation with a creator: https://partner.tiktokshop.com/docv2/page/6791db7684178a030d7e3705
- Sign TikTok Shop API requests: https://partner.tiktokshop.com/docv2/page/sign-your-api-request

The public docs indicate the affiliate messaging APIs require signed TikTok Shop requests, `x-tts-access-token`, `app_key`, `timestamp`, `sign`, and `shop_cipher`. Configure the n8n TikTok send node with the same signed request layer you use for polling or inbound message retrieval.

The live send test confirmed the affiliate send endpoint uses the plural conversation route:

`POST /affiliate_seller/202412/conversations/{conversation_id}/messages`

For text sends, the accepted body shape is:

```json
{
  "msg_type": "TEXT",
  "content": "{\"content\":\"message text\"}"
}
```

The singular route `/affiliate_seller/202412/conversation/{conversation_id}/messages` is the read-history endpoint and rejected `POST` with `Invalid method`.

The shop id and shop cipher should be stored in n8n variables. The access token and app secret should be stored in n8n credentials or secure variables, not in workflow JSON or source files.
