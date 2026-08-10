"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API_BASE = "http://localhost:5678/api/v1";

function envValues() {
  return Object.fromEntries(
    fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1)];
      })
  );
}

async function api(pathname, key, options = {}) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    ...options,
    headers: { "X-N8N-API-KEY": key, ...(options.body ? { "Content-Type": "application/json" } : {}) }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const env = envValues();
  const webhookPath = `waba-subscription-audit-${crypto.randomUUID()}`;
  const graphBase = `https://graph.facebook.com/${env.WHATSAPP_GRAPH_API_VERSION}`;
  const credential = {
    httpHeaderAuth: {
      id: env.WHATSAPP_HEADER_AUTH_CREDENTIAL_ID,
      name: env.WHATSAPP_HEADER_AUTH_CREDENTIAL_NAME
    }
  };
  const requestNode = (name, url, position) => ({
    parameters: {
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      method: "GET",
      url,
      options: { response: { response: { neverError: true } } }
    },
    id: crypto.randomUUID(), name,
    type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position,
    credentials: credential
  });
  const workflow = await api("/workflows", env.N8N_API_KEY, {
    method: "POST",
    body: JSON.stringify({
      name: "Temporary WABA Subscription Audit",
      nodes: [
        {
          parameters: { httpMethod: "GET", path: webhookPath, responseMode: "lastNode", options: {} },
          id: crypto.randomUUID(), name: "Audit Trigger", type: "n8n-nodes-base.webhook",
          typeVersion: 2.1, position: [-300, 0], webhookId: crypto.randomUUID()
        },
        requestNode(
          "Read WABA Subscribed Apps",
          `${graphBase}/${env.WHATSAPP_WABA_ID}/subscribed_apps`,
          [-100, 0]
        ),
        requestNode(
          "Read WABA",
          `${graphBase}/${env.WHATSAPP_WABA_ID}?fields=id,name,account_review_status,business_verification_status,status`,
          [100, 0]
        ),
        requestNode(
          "Read WABA Phone Numbers",
          `${graphBase}/${env.WHATSAPP_WABA_ID}/phone_numbers?fields=id,verified_name,quality_rating,code_verification_status,platform_type`,
          [300, 0]
        ),
        requestNode(
          "Read Expected Phone",
          `${graphBase}/${env.WHATSAPP_PHONE_NUMBER_ID}?fields=id,verified_name,quality_rating,code_verification_status,platform_type`,
          [500, 0]
        ),
        requestNode(
          "Read Phone Webhook Configuration",
          `${graphBase}/${env.WHATSAPP_PHONE_NUMBER_ID}?fields=id,webhook_configuration`,
          [700, 0]
        ),
        requestNode(
          "Read Expected App",
          `${graphBase}/${env.WHATSAPP_APP_ID}?fields=id,name`,
          [900, 0]
        ),
        requestNode(
          "Read Token Principal",
          `${graphBase}/me?fields=id,name`,
          [1100, 0]
        ),
        requestNode(
          "Read Token Permissions",
          `${graphBase}/me/permissions`,
          [1300, 0]
        ),
        {
          parameters: {
            jsCode: `function node(name) {
  try { return $(name).first().json || {}; } catch { return {}; }
}
function error(value) {
  const item = value && value.error;
  return item ? { code: item.code || null, type: item.type || "GraphError" } : null;
}
function callback(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const direct = value.override_callback_uri || value.callback_uri || value.callback_url || value.url;
    if (direct) return callback(direct);
    if (
      typeof value.application === "string" &&
      ["http://", "https://"].some((prefix) =>
        value.application.toLowerCase().startsWith(prefix)
      )
    ) return value.application;
    if (value.application && typeof value.application === "object") {
      const found = callback(value.application);
      if (found) return found;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (/(callback|url|uri)/i.test(key)) {
        const found = callback(nested);
        if (found) return found;
      }
    }
  }
  return "";
}
function callbackSummary(uri) {
  if (!uri) return { configured: false, matches_expected: false, origin: "", path: "" };
  const raw = String(uri);
  const separator = raw.indexOf("://");
  const scheme = separator > 0 ? raw.slice(0, separator).toLowerCase() : "";
  const remainder = separator > 0 ? raw.slice(separator + 3) : "";
  const slash = remainder.indexOf("/");
  const host = slash >= 0 ? remainder.slice(0, slash) : remainder;
  const path = slash >= 0 ? remainder.slice(slash) : "/";
  if ((scheme === "http" || scheme === "https") && host) {
    return {
      configured: true,
      matches_expected: uri === "https://n8n.proyaofficial.com/webhook/whatsapp-callback",
      origin: scheme + "://" + host,
      path
    };
  }
  return { configured: true, matches_expected: false, origin: "invalid_uri", path: "" };
}
const subscriptionResponse = node("Read WABA Subscribed Apps");
const subscriptions = Array.isArray(subscriptionResponse.data) ? subscriptionResponse.data : [];
const apps = subscriptions.map((item) => ({
  app: item.whatsapp_business_api_data || item,
  override_callback_uri: item.override_callback_uri || ""
})).filter((item) => item.app && typeof item.app === "object");
const waba = node("Read WABA");
const phonesResponse = node("Read WABA Phone Numbers");
const phones = Array.isArray(phonesResponse.data) ? phonesResponse.data : [];
const phone = node("Read Expected Phone");
const phoneWebhook = node("Read Phone Webhook Configuration");
const app = node("Read Expected App");
const principal = node("Read Token Principal");
const permissionsResponse = node("Read Token Permissions");
const permissions = Array.isArray(permissionsResponse.data) ? permissionsResponse.data : [];
const phoneCallback = callback(phoneWebhook.webhook_configuration);
const configuredApplication = phoneWebhook.webhook_configuration &&
  phoneWebhook.webhook_configuration.application;
return [{ json: {
  subscription_count: apps.length,
  expected_app_subscribed: apps.some((item) => String(item.app.id || "") === $env.WHATSAPP_APP_ID),
  subscriptions: apps.map((item) => ({
    expected_app: String(item.app.id || "") === $env.WHATSAPP_APP_ID,
    subscribed_fields: item.app.subscribed_fields || item.subscribed_fields || [],
    override_callback: callbackSummary(item.override_callback_uri)
  })),
  waba: {
    query_ok: !error(waba),
    id_matches: String(waba.id || "") === $env.WHATSAPP_WABA_ID,
    account_review_status: waba.account_review_status || "",
    business_verification_status: waba.business_verification_status || "",
    status: waba.status || "",
    error: error(waba)
  },
  phone_membership: {
    query_ok: !error(phonesResponse),
    count: phones.length,
    expected_phone_in_waba: phones.some((item) => String(item.id || "") === $env.WHATSAPP_PHONE_NUMBER_ID),
    expected_phone_state: (() => {
      const item = phones.find((entry) => String(entry.id || "") === $env.WHATSAPP_PHONE_NUMBER_ID) || {};
      return {
        quality_rating: item.quality_rating || "",
        code_verification_status: item.code_verification_status || "",
        platform_type: item.platform_type || ""
      };
    })(),
    error: error(phonesResponse)
  },
  phone: {
    query_ok: !error(phone),
    id_matches: String(phone.id || "") === $env.WHATSAPP_PHONE_NUMBER_ID,
    quality_rating: phone.quality_rating || "",
    code_verification_status: phone.code_verification_status || "",
    platform_type: phone.platform_type || "",
    error: error(phone)
  },
  phone_webhook_configuration: {
    query_ok: !error(phoneWebhook),
    application_present: configuredApplication != null && String(configuredApplication) !== "",
    application_kind: Array.isArray(configuredApplication)
      ? "array"
      : typeof configuredApplication,
    application_is_callback_uri:
      typeof configuredApplication === "string" &&
      ["http://", "https://"].some((prefix) =>
        configuredApplication.toLowerCase().startsWith(prefix)
      ),
    callback: callbackSummary(phoneCallback),
    raw_keys: phoneWebhook.webhook_configuration && typeof phoneWebhook.webhook_configuration === "object"
      ? Object.keys(phoneWebhook.webhook_configuration)
      : [],
    application_keys: phoneWebhook.webhook_configuration &&
      phoneWebhook.webhook_configuration.application &&
      typeof phoneWebhook.webhook_configuration.application === "object"
      ? Object.keys(phoneWebhook.webhook_configuration.application).filter((key) => !/token|secret/i.test(key))
      : [],
    error: error(phoneWebhook)
  },
  app: {
    query_ok: !error(app),
    id_matches: String(app.id || "") === $env.WHATSAPP_APP_ID,
    name: app.name || "",
    error: error(app)
  },
  token_principal: {
    query_ok: !error(principal),
    type: principal.id ? "system_user_or_user" : "unknown",
    error: error(principal)
  },
  token_permissions: {
    query_ok: !error(permissionsResponse),
    whatsapp_business_management: permissions.some((item) => item.permission === "whatsapp_business_management" && item.status === "granted"),
    whatsapp_business_messaging: permissions.some((item) => item.permission === "whatsapp_business_messaging" && item.status === "granted"),
    business_management: permissions.some((item) => item.permission === "business_management" && item.status === "granted"),
    error: error(permissionsResponse)
  }
} }];`
          },
          id: crypto.randomUUID(), name: "Return Sanitized Audit",
          type: "n8n-nodes-base.code", typeVersion: 2, position: [1500, 0]
        }
      ],
      connections: {
        "Audit Trigger": { main: [[{ node: "Read WABA Subscribed Apps", type: "main", index: 0 }]] },
        "Read WABA Subscribed Apps": { main: [[{ node: "Read WABA", type: "main", index: 0 }]] },
        "Read WABA": { main: [[{ node: "Read WABA Phone Numbers", type: "main", index: 0 }]] },
        "Read WABA Phone Numbers": { main: [[{ node: "Read Expected Phone", type: "main", index: 0 }]] },
        "Read Expected Phone": { main: [[{ node: "Read Phone Webhook Configuration", type: "main", index: 0 }]] },
        "Read Phone Webhook Configuration": { main: [[{ node: "Read Expected App", type: "main", index: 0 }]] },
        "Read Expected App": { main: [[{ node: "Read Token Principal", type: "main", index: 0 }]] },
        "Read Token Principal": { main: [[{ node: "Read Token Permissions", type: "main", index: 0 }]] },
        "Read Token Permissions": { main: [[{ node: "Return Sanitized Audit", type: "main", index: 0 }]] }
      },
      settings: { executionOrder: "v1", saveDataSuccessExecution: "none", saveDataErrorExecution: "none" }
    })
  });
  try {
    await api(`/workflows/${workflow.id}/activate`, env.N8N_API_KEY, { method: "POST" });
    const response = await fetch(`http://localhost:5678/webhook/${webhookPath}`);
    if (!response.ok) throw new Error(`Subscription lookup ${response.status}`);
    process.stdout.write(`${JSON.stringify(await response.json(), null, 2)}\n`);
  } finally {
    try { await api(`/workflows/${workflow.id}/deactivate`, env.N8N_API_KEY, { method: "POST" }); } catch {}
    await api(`/workflows/${workflow.id}`, env.N8N_API_KEY, { method: "DELETE" });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
