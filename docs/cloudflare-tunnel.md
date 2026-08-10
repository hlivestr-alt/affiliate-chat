# Cloudflare Tunnel for n8n

The production hostname is:

```text
https://n8n.proyaofficial.com
```

The Docker Compose configuration runs `cloudflared` on the same Docker network
as n8n and forwards the public hostname to `http://n8n:5678`.

## One-time Cloudflare setup

Authenticate the local CLI:

```powershell
cloudflared tunnel login
```

Create the named tunnel and DNS route:

```powershell
cloudflared tunnel create proya-n8n
cloudflared tunnel route dns proya-n8n n8n.proyaofficial.com
cloudflared tunnel token proya-n8n
```

The route command creates a proxied CNAME for `n8n.proyaofficial.com` pointing
to `<tunnel-uuid>.cfargotunnel.com`. Put the token printed by the final command
in `.env` as `CLOUDFLARE_TUNNEL_TOKEN`, then start both services:

```powershell
docker compose --profile tunnel up -d
```

No inbound router port or public IP is required.

## Access policy

Protect the n8n editor with Cloudflare Access, but create a bypass policy for:

```text
/webhook/*
```

Meta and TikTok must reach production webhooks without an interactive Access
login. The WhatsApp POST workflow independently validates
`X-Hub-Signature-256` against `WHATSAPP_APP_SECRET`.

## WhatsApp callback

Configure the Meta app callback URL as:

```text
https://n8n.proyaofficial.com/webhook/whatsapp-callback
```

Use the same value configured as `WHATSAPP_VERIFY_TOKEN` when Meta verifies the
callback, then subscribe the WhatsApp Business Account to the `messages` field.
