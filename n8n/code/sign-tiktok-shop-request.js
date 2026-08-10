const crypto = require("crypto");

function signTikTokShop({ path, query, body, appSecret, contentType = "application/json" }) {
  const paramString = Object.keys(query)
    .filter((key) => key !== "sign" && key !== "access_token")
    .sort()
    .map((key) => `${key}${query[key]}`)
    .join("");
  const bodyString =
    contentType.toLowerCase() === "multipart/form-data" || !body ? "" : JSON.stringify(body);
  const signString = `${appSecret}${path}${paramString}${bodyString}${appSecret}`;
  return crypto.createHmac("sha256", appSecret).update(signString).digest("hex");
}

const source = $json;
const path = `/affiliate_seller/202412/conversation/${source.conversation_id}/messages`;
const body = {
  type: "TEXT",
  content: JSON.stringify({ content: source.outbound_message || source.outboundMessage })
};
const query = {
  app_key: $vars.TIKTOK_APP_KEY,
  timestamp: Math.floor(Date.now() / 1000),
  shop_cipher: $vars.TIKTOK_SHOP_CIPHER
};
query.sign = signTikTokShop({
  path,
  query,
  body,
  appSecret: $vars.TIKTOK_APP_SECRET
});

return [
  {
    json: {
      ...source,
      tiktok_url: `https://open-api.tiktokglobalshop.com${path}?${new URLSearchParams(query).toString()}`,
      tiktok_body: body,
      tiktok_headers: {
        "content-type": "application/json",
        "x-tts-access-token": $vars.TIKTOK_ACCESS_TOKEN
      }
    }
  }
];
