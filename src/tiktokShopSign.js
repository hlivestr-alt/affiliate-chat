"use strict";

const crypto = require("node:crypto");

const EXCLUDED_SIGN_KEYS = new Set(["access_token", "sign"]);

function stableJson(value) {
  if (value == null || value === "") {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function generateTikTokShopSign({ path, query = {}, body = "", contentType = "application/json", appSecret }) {
  if (!path) {
    throw new Error("TikTok Shop API path is required");
  }
  if (!appSecret) {
    throw new Error("TikTok Shop app secret is required");
  }

  const paramString = Object.keys(query)
    .filter((key) => !EXCLUDED_SIGN_KEYS.has(key))
    .sort()
    .map((key) => `${key}${query[key]}`)
    .join("");

  const bodyString =
    String(contentType).toLowerCase() === "multipart/form-data" ? "" : stableJson(body);
  const signString = `${appSecret}${path}${paramString}${bodyString}${appSecret}`;

  return crypto
    .createHmac("sha256", appSecret)
    .update(signString)
    .digest("hex");
}

function buildSignedTikTokShopUrl({ baseUrl, path, query = {}, body = "", contentType, appKey, appSecret }) {
  if (!baseUrl) {
    throw new Error("TikTok Shop API base URL is required");
  }
  if (!appKey) {
    throw new Error("TikTok Shop app key is required");
  }

  const timestamp = query.timestamp || Math.floor(Date.now() / 1000);
  const qs = {
    ...query,
    app_key: query.app_key || appKey,
    timestamp
  };
  const sign = generateTikTokShopSign({
    path,
    query: qs,
    body,
    contentType,
    appSecret
  });
  const params = new URLSearchParams({
    ...Object.fromEntries(Object.entries(qs).map(([key, value]) => [key, String(value)])),
    sign
  });

  return `${baseUrl.replace(/\/+$/, "")}${path}?${params.toString()}`;
}

module.exports = {
  buildSignedTikTokShopUrl,
  generateTikTokShopSign
};
