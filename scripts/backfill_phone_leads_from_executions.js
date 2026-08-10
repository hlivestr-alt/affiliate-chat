#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const args = {
    sinceHours: 24,
    postDelayMs: 750,
    dryRun: false,
    enrichUsernames: false,
    envFile: "",
    workflowId: "AfDriveReady2026",
    webhookUrl: "http://localhost:5678/webhook/tiktok-message"
  };
  for (const arg of argv) {
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--enrich-usernames") {
      args.enrichUsernames = true;
      continue;
    }
    if (!arg.startsWith("--") || !arg.includes("=")) continue;
    const [rawKey, rawValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    args[key] = rawValue;
  }
  args.sinceHours = Number(args.sinceHours);
  args.postDelayMs = Number(args.postDelayMs);
  if (!Number.isFinite(args.sinceHours) || args.sinceHours <= 0) {
    throw new Error("--since-hours must be a positive number");
  }
  if (!Number.isFinite(args.postDelayMs) || args.postDelayMs < 0) {
    throw new Error("--post-delay-ms must be zero or positive");
  }
  return args;
}

function readEnv(filePath) {
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

function requireRuntimeModule(name, fallbackPath) {
  try {
    return require(name);
  } catch {
    return require(fallbackPath);
  }
}

const sqlite3 = requireRuntimeModule(
  "sqlite3",
  "/usr/local/lib/node_modules/n8n/node_modules/sqlite3"
);
const { parse: parseFlatted } = requireRuntimeModule(
  "flatted",
  "/usr/local/lib/node_modules/n8n/node_modules/flatted"
);
const helperPath =
  process.env.WHATSAPP_LEAD_MODULE ||
  path.resolve(__dirname, "..", "src", "whatsappLead.js");
const { inboundLeadFrom } = require(helperPath);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toSqliteDate(value) {
  return value.toISOString().replace("T", " ").replace("Z", "");
}

function firstNodeJson(runData, nodeName) {
  const runs = runData && runData[nodeName];
  const branch =
    runs &&
    runs[0] &&
    runs[0].data &&
    runs[0].data.main &&
    runs[0].data.main[0];
  return branch && branch[0] && branch[0].json ? branch[0].json : null;
}

function queryRows(db, sql, parameters) {
  return new Promise((resolve, reject) => {
    db.all(sql, parameters, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

function closeDatabase(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => (error ? reject(error) : resolve()));
  });
}

function webhookBody(trigger, username, capturedAt) {
  const source =
    trigger && trigger.body && typeof trigger.body === "object"
      ? structuredClone(trigger.body)
      : structuredClone(trigger || {});
  if (username) source.username = username;
  source.unread = true;
  source.backfill_original_received_at = capturedAt;
  source.received_at = new Date().toISOString();
  source.timestamp = Math.floor(Date.now() / 1000);
  source.backfill = true;
  source.backfill_source = "n8n_execution_history";
  return source;
}

async function postWebhook(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Webhook ${response.status}: ${responseText.slice(0, 500)}`);
  }
}

function signedTikTokUrl(config, pathname, extraQuery = {}) {
  const query = {
    app_key: config.appKey,
    timestamp: Math.floor(Date.now() / 1000),
    shop_cipher: config.shopCipher,
    ...extraQuery
  };
  const sorted = Object.keys(query)
    .filter((key) => key !== "sign" && key !== "access_token")
    .sort()
    .map((key) => `${key}${query[key]}`)
    .join("");
  const signInput = `${config.appSecret}${pathname}${sorted}${config.appSecret}`;
  const sign = crypto
    .createHmac("sha256", config.appSecret)
    .update(signInput)
    .digest("hex");
  const parameters = new URLSearchParams(
    Object.fromEntries(
      Object.entries({ ...query, sign }).map(([key, value]) => [
        key,
        String(value)
      ])
    )
  );
  return `https://open-api.tiktokglobalshop.com${pathname}?${parameters}`;
}

async function fetchTikTokJson(config, pathname, query) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(signedTikTokUrl(config, pathname, query), {
        headers: {
          "content-type": "application/json",
          "x-tts-access-token": config.accessToken
        }
      });
      const payload = await response.json();
      if (!response.ok || (payload.code != null && Number(payload.code) !== 0)) {
        throw new Error(
          `TikTok lookup failed (${response.status}/${payload.code || ""}): ${
            payload.message || "unknown error"
          }`
        );
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 1000);
    }
  }
  throw lastError;
}

async function conversationUsernameMap(args) {
  if (!args.enrichUsernames) return new Map();
  if (!args.envFile) {
    throw new Error("--env-file is required with --enrich-usernames");
  }
  const env = readEnv(args.envFile);
  const config = {
    accessToken: env.TIKTOK_ACCESS_TOKEN,
    appKey: env.TIKTOK_APP_KEY,
    appSecret: env.TIKTOK_APP_SECRET,
    shopCipher: env.TIKTOK_SHOP_CIPHER
  };
  for (const [name, value] of Object.entries(config)) {
    if (!value) throw new Error(`Missing TikTok configuration: ${name}`);
  }

  const usernames = new Map();
  let pageToken = "";
  let pageCount = 0;
  do {
    pageCount += 1;
    const response = await fetchTikTokJson(
      config,
      "/affiliate_seller/202412/conversations",
      {
        page_size: 50,
        only_need_conversation_id: false,
        ...(pageToken ? { page_token: pageToken } : {})
      }
    );
    const data = response.data || {};
    const conversations = Array.isArray(data.conversations)
      ? data.conversations
      : [];
    for (const conversation of conversations) {
      const username = String(conversation.username || "")
        .normalize("NFKC")
        .trim()
        .replace(/^@+/, "");
      if (!username) continue;
      const conversationId = String(
        conversation.id || conversation.conversation_id || ""
      );
      const creatorId = String(conversation.creator_im_id || "");
      if (conversationId) usernames.set(`conversation:${conversationId}`, username);
      if (creatorId) usernames.set(`creator:${creatorId}`, username);
    }
    pageToken = data.has_more ? String(data.next_page_token || "") : "";
    if (pageCount >= 120) break;
    if (pageToken) await sleep(100);
  } while (pageToken);
  return usernames;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const until = new Date();
  const since = new Date(until.getTime() - args.sinceHours * 60 * 60 * 1000);
  const databasePath =
    process.env.N8N_DATABASE_PATH || "/home/node/.n8n/database.sqlite";
  const db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY);
  let rows;
  try {
    rows = await queryRows(
      db,
      `select e.id, e.startedAt, d.data
       from execution_entity e
       join execution_data d on d.executionId = e.id
       where e.workflowId = ?
         and e.startedAt >= ?
         and e.startedAt <= ?
       order by e.startedAt asc, e.id asc`,
      [args.workflowId, toSqliteDate(since), toSqliteDate(until)]
    );
  } finally {
    await closeDatabase(db);
  }

  const usernameMap = await conversationUsernameMap(args);
  const candidates = [];
  for (const row of rows) {
    let execution;
    try {
      execution = parseFlatted(row.data);
    } catch {
      continue;
    }
    const runData = execution?.resultData?.runData || {};
    const trigger = firstNodeJson(runData, "When Executed by Router");
    if (!trigger) continue;
    const lead = inboundLeadFrom(trigger);
    if (!lead.whatsapp_number) continue;
    const resolved = firstNodeJson(
      runData,
      "Resolve Username From Conversations"
    );
    const resolvedUsername =
      resolved?.username ||
      lead.username ||
      usernameMap.get(`conversation:${lead.conversation_id}`) ||
      usernameMap.get(`creator:${lead.affiliate_id}`) ||
      "";
    candidates.push({
      executionId: row.id,
      capturedAt: lead.captured_at,
      body: webhookBody(trigger, resolvedUsername, lead.captured_at)
    });
  }

  const summary = {
    dry_run: args.dryRun,
    snapshot_from: since.toISOString(),
    snapshot_until: until.toISOString(),
    executions_scanned: rows.length,
    phone_replies_found: candidates.length,
    unique_conversations_found: new Set(
      candidates.map((candidate) =>
        String(candidate.body.conversation_id || candidate.body.data?.conversation_id || "")
      )
    ).size,
    conversation_username_keys_loaded: usernameMap.size,
    candidates_with_username: candidates.filter((candidate) =>
      Boolean(candidate.body.username)
    ).length,
    posted: 0,
    failed: 0
  };

  for (const candidate of candidates) {
    if (args.dryRun) continue;
    try {
      await postWebhook(args.webhookUrl, candidate.body);
      summary.posted += 1;
    } catch (error) {
      summary.failed += 1;
      process.stderr.write(
        `Execution ${candidate.executionId} failed: ${error.message}\n`
      );
    }
    if (args.postDelayMs > 0) await sleep(args.postDelayMs);
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
