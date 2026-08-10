"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSignedTikTokShopUrl,
  generateTikTokShopSign
} = require("../src/tiktokShopSign");

test("generates TikTok Shop HMAC-SHA256 signature from official docs example", () => {
  const sign = generateTikTokShopSign({
    path: "/authorization/202309/shops",
    query: {
      app_key: "29a39d",
      timestamp: 1623812664
    },
    appSecret: "e59af819cc"
  });

  assert.equal(sign, "b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8");
});

test("excludes access_token and sign from signature input", () => {
  const withoutExcluded = generateTikTokShopSign({
    path: "/authorization/202309/shops",
    query: {
      app_key: "29a39d",
      timestamp: 1623812664
    },
    appSecret: "e59af819cc"
  });
  const withExcluded = generateTikTokShopSign({
    path: "/authorization/202309/shops",
    query: {
      app_key: "29a39d",
      timestamp: 1623812664,
      access_token: "secret",
      sign: "ignore"
    },
    appSecret: "e59af819cc"
  });

  assert.equal(withExcluded, withoutExcluded);
});

test("builds signed TikTok Shop URL with query parameters", () => {
  const url = buildSignedTikTokShopUrl({
    baseUrl: "https://open-api.tiktokglobalshop.com",
    path: "/authorization/202309/shops",
    query: {
      timestamp: 1623812664
    },
    appKey: "29a39d",
    appSecret: "e59af819cc"
  });

  assert.ok(url.startsWith("https://open-api.tiktokglobalshop.com/authorization/202309/shops?"));
  assert.ok(url.includes("app_key=29a39d"));
  assert.ok(url.includes("timestamp=1623812664"));
  assert.ok(url.includes("sign=b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8"));
});
