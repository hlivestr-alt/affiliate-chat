#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildSignedTikTokShopUrl } = require("../src/tiktokShopSign");

function readEnv(filePath) {
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0 && !line.trimStart().startsWith("#")) {
      env[line.slice(0, index)] = line.slice(index + 1);
    }
  }
  return env;
}

async function main() {
  const env = readEnv(path.resolve(__dirname, "..", ".env"));
  async function call(pathname, query = {}) {
    const url = buildSignedTikTokShopUrl({
      baseUrl: "https://open-api.tiktokglobalshop.com",
      path: pathname,
      query,
      appKey: env.TIKTOK_APP_KEY,
      appSecret: env.TIKTOK_APP_SECRET
    });
    const response = await fetch(url, {
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": env.TIKTOK_ACCESS_TOKEN
      }
    });
    const payload = await response.json();
    return {
      http_status: response.status,
      code: payload.code,
      message: payload.message,
      shop_count: Array.isArray(payload.data?.shops)
        ? payload.data.shops.length
        : null,
      conversation_count: Array.isArray(payload.data?.conversations)
        ? payload.data.conversations.length
        : null
    };
  }

  const results = {
    authorized_shops: await call("/authorization/202309/shops"),
    conversations_minimal: await call(
      "/affiliate_seller/202412/conversations",
      {
        shop_cipher: env.TIKTOK_SHOP_CIPHER,
        page_size: 20
      }
    ),
    conversations_all_fields: await call(
      "/affiliate_seller/202412/conversations",
      {
        shop_cipher: env.TIKTOK_SHOP_CIPHER,
        page_size: 20,
        only_need_conversation_id: "false"
      }
    ),
    conversations_page_50: await call(
      "/affiliate_seller/202412/conversations",
      {
        shop_cipher: env.TIKTOK_SHOP_CIPHER,
        page_size: 50,
        only_need_conversation_id: false
      }
    )
  };
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  if (
    Object.values(results).some(
      (result) => result.http_status !== 200 || Number(result.code) !== 0
    )
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
