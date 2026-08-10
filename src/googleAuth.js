"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets"
].join(" ");

let cachedToken = null;

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function readServiceAccount() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH) {
    return JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH, "utf8"));
  }
  return null;
}

function createJwtAssertion(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT"
  };
  const claim = {
    iss: serviceAccount.client_email,
    scope: GOOGLE_SCOPES,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(serviceAccount.private_key)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${unsigned}.${signature}`;
}

async function exchangeJwtForAccessToken(assertion) {
  const params = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: params.toString()
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Google service account token exchange failed: ${payload.error_description || payload.error}`);
  }
  return {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(0, (payload.expires_in || 3600) - 60) * 1000
  };
}

async function getGoogleAccessToken({ optional = false } = {}) {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) {
    return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  }

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  const serviceAccount = readServiceAccount();
  if (!serviceAccount) {
    if (optional) {
      return "";
    }
    throw new Error(
      "Set GOOGLE_OAUTH_ACCESS_TOKEN, GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_SERVICE_ACCOUNT_JSON_PATH"
    );
  }

  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("Google service account JSON must include client_email and private_key");
  }

  cachedToken = await exchangeJwtForAccessToken(createJwtAssertion(serviceAccount));
  return cachedToken.accessToken;
}

module.exports = {
  getGoogleAccessToken
};
