#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_IGNORED_SENDER_IM_USER_IDS,
  classifyReply,
  parseTimestampMs
} = require("../src/affiliateHandoff");
const { buildSignedTikTokShopUrl } = require("../src/tiktokShopSign");
const {
  extractIndonesianWhatsAppNumber
} = require("../src/whatsappLead");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_WEBHOOK_URL = "http://localhost:5678/webhook/tiktok-message";
const DEFAULT_BASE_URL = "https://open-api.tiktokglobalshop.com";
const STATE_PATH = path.join(ROOT, "n8n", "backfill-state.json");

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

function parseArgs(argv) {
  const args = {
    dryRun: false,
    ignoreState: false,
    phoneOnly: false,
    verbose: false
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--ignore-state") args.ignoreState = true;
    else if (arg === "--phone-only") args.phoneOnly = true;
    else if (arg === "--verbose") args.verbose = true;
    else if (arg.startsWith("--")) {
      const [key, value = ""] = arg.slice(2).split("=");
      args[key.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
    }
  }

  return args;
}

function requireValue(value, name) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function numberOption(value, fallback) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function setOption(value) {
  return new Set(
    text(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { posted_message_ids: [], runs: [] };
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function text(value) {
  return value == null ? "" : String(value);
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const raw = text(value).trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function messageText(content) {
  const parsed = parseJsonObject(content);
  return text(parsed.content || parsed.text || parsed.message || (text(content).startsWith("{") ? "" : content));
}

function messageBody(item) {
  return item && item.message_body && typeof item.message_body === "object"
    ? item.message_body
    : item || {};
}

function messageTimestampMs(item) {
  const body = messageBody(item);
  return parseTimestampMs(body.create_time || item.create_time || item.conversation_index);
}

function messageId(item) {
  const body = messageBody(item);
  return text(body.id || body.message_id || item.id || item.message_id);
}

function messageSenderId(item) {
  const body = messageBody(item);
  return text(body.sender_id || body.sender_im_user_id || item.sender_id || item.sender_im_user_id);
}

function messageType(item) {
  const body = messageBody(item);
  return text(body.type || body.msg_type || item.type || item.msg_type).toUpperCase();
}

function normalizeMessages(response) {
  const data = response && response.data && typeof response.data === "object" ? response.data : {};
  return Array.isArray(data.messages)
    ? data.messages
    : Array.isArray(data.message_list)
      ? data.message_list
      : [];
}

function sortMessages(messages) {
  return [...messages].sort((a, b) => {
    const timeDelta = messageTimestampMs(a) - messageTimestampMs(b);
    if (timeDelta !== 0) return timeDelta;
    return text(a.conversation_index).localeCompare(text(b.conversation_index));
  });
}

function makeWebhookPayload({ conversation, message, recentReplies, shopId, runId }) {
  const body = messageBody(message);
  const timestampMs = messageTimestampMs(message);
  const timestampSeconds = Number.isFinite(timestampMs) ? Math.floor(timestampMs / 1000) : Math.floor(Date.now() / 1000);
  const senderId = messageSenderId(message);
  const id = messageId(message);
  const conversationId = text(body.conversation_id || conversation.id || conversation.conversation_id);
  const rawContent = body.content != null ? body.content : JSON.stringify({ content: messageText(body.content) });

  return {
    type: 33,
    tts_notification_id: `backfill_${id || conversationId}_${timestampSeconds}`,
    shop_id: shopId,
    timestamp: timestampSeconds,
    affiliate_id: text(conversation.creator_im_id || senderId),
    username: text(conversation.username),
    conversation_id: conversationId,
    message_id: id,
    unread: true,
    received_at: new Date(timestampSeconds * 1000).toISOString(),
    backfill: true,
    backfill_run_id: runId,
    recent_replies: recentReplies,
    data: {
      content: rawContent,
      conversation_id: conversationId,
      create_time: String(timestampSeconds),
      index: text(message.conversation_index || timestampSeconds),
      message_id: id,
      msg_type: messageType(message) || "TEXT",
      sender: {
        sender_im_user_id: senderId
      }
    }
  };
}

function candidateFromMessage({
  conversation,
  message,
  sinceMs,
  ignoredSenders,
  unreadMessageIds,
  phoneOnly
}) {
  const id = messageId(message);
  const senderId = messageSenderId(message);
  const timestampMs = messageTimestampMs(message);
  const body = messageBody(message);
  const inboundText = messageText(body.content);
  const whatsappNumber = extractIndonesianWhatsAppNumber(inboundText);
  const classification = phoneOnly
    ? {
        classification: "whatsapp",
        reason: "valid_indonesian_mobile"
      }
    : classifyReply(inboundText);

  if (!id || !unreadMessageIds.has(id)) return null;
  if (!Number.isFinite(timestampMs) || timestampMs < sinceMs) return null;
  if (ignoredSenders.has(senderId)) return null;
  if (messageType(message) !== "TEXT") return null;
  if (phoneOnly && !whatsappNumber) return null;
  if (
    !phoneOnly &&
    !["confirmed", "interested"].includes(classification.classification)
  ) {
    return null;
  }

  return {
    id,
    conversation_id: text(body.conversation_id || conversation.id || conversation.conversation_id),
    username: text(conversation.username),
    sender_id: senderId,
    received_at: new Date(timestampMs).toISOString(),
    text: inboundText,
    whatsapp_number: whatsappNumber,
    classification,
    message
  };
}

function selectUnreadWindow(messages, unreadCount, ignoredSenders) {
  const inbound = sortMessages(messages).filter((message) => {
    const senderId = messageSenderId(message);
    return senderId && !ignoredSenders.has(senderId);
  });
  return inbound.slice(Math.max(0, inbound.length - unreadCount));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = { raw: responseText };
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  return payload;
}

class TikTokClient {
  constructor(config) {
    this.config = config;
  }

  async get(pathname, query = {}) {
    const url = buildSignedTikTokShopUrl({
      baseUrl: this.config.baseUrl,
      path: pathname,
      query: {
        shop_cipher: this.config.shopCipher,
        ...query
      },
      appKey: this.config.appKey,
      appSecret: this.config.appSecret
    });

    const payload = await fetchJson(url, {
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": this.config.accessToken
      }
    });

    if (payload.code != null && Number(payload.code) !== 0) {
      throw new Error(`TikTok API error ${payload.code}: ${payload.message || JSON.stringify(payload)}`);
    }

    return payload;
  }
}

async function listConversations(client, config) {
  const conversations = [];
  let pageToken = "";
  let page = 0;

  do {
    page += 1;
    const response = await client.get("/affiliate_seller/202412/conversations", {
      page_size: config.conversationPageSize,
      only_need_conversation_id: false,
      ...(pageToken ? { page_token: pageToken } : {})
    });
    const data = response.data || {};
    const pageConversations = Array.isArray(data.conversations) ? data.conversations : [];
    conversations.push(...pageConversations);
    pageToken = data.has_more ? text(data.next_page_token) : "";

    console.log(`conversation page ${page}: ${pageConversations.length} conversations, ${conversations.length} total`);
    if (config.requestDelayMs > 0) await sleep(config.requestDelayMs);
    if (config.maxConversationPages && page >= config.maxConversationPages) break;
    if (config.limitConversations && conversations.length >= config.limitConversations) break;
  } while (pageToken);

  return config.limitConversations ? conversations.slice(0, config.limitConversations) : conversations;
}

async function listMessages(client, conversationId, config) {
  const messages = [];
  let pageToken = "";
  let page = 0;

  do {
    page += 1;
    const response = await client.get(`/affiliate_seller/202412/conversation/${encodeURIComponent(conversationId)}/messages`, {
      page_size: config.messagePageSize,
      ...(pageToken ? { page_token: pageToken } : {})
    });
    const data = response.data || {};
    const pageMessages = normalizeMessages(response);
    messages.push(...pageMessages);
    pageToken = data.has_more ? text(data.next_page_token) : "";

    if (config.requestDelayMs > 0) await sleep(config.requestDelayMs);
    if (config.maxMessagePages && page >= config.maxMessagePages) break;
  } while (pageToken);

  return messages;
}

async function postWebhook(webhookUrl, payload) {
  const response = await fetchJson(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return response;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // This workspace's .env is the deployment source of truth. Stale desktop
  // environment variables must not silently override rotated TikTok credentials.
  const env = { ...process.env, ...readEnv(path.join(ROOT, ".env")) };
  const config = {
    accessToken: requireValue(env.TIKTOK_ACCESS_TOKEN, "TIKTOK_ACCESS_TOKEN"),
    appKey: requireValue(env.TIKTOK_APP_KEY, "TIKTOK_APP_KEY"),
    appSecret: requireValue(env.TIKTOK_APP_SECRET, "TIKTOK_APP_SECRET"),
    baseUrl: args.baseUrl || env.TIKTOK_BASE_URL || DEFAULT_BASE_URL,
    conversationPageSize: Math.min(50, numberOption(args.conversationPageSize, 50)),
    ignoredSenders: new Set(DEFAULT_IGNORED_SENDER_IM_USER_IDS.map(text)),
    limitConversations: numberOption(args.limitConversations, 0),
    maxConversationPages: numberOption(args.maxConversationPages, 120),
    maxMessagePages: numberOption(args.maxMessagePages, 20),
    messagePageSize: Math.min(20, numberOption(args.messagePageSize, 20)),
    n8nWebhookUrl: args.n8nWebhook || env.N8N_BACKFILL_WEBHOOK_URL || DEFAULT_WEBHOOK_URL,
    onlyMessageIds: setOption(args.onlyMessageIds),
    postDelayMs: numberOption(args.postDelayMs, 8000),
    requestDelayMs: numberOption(args.requestDelayMs, 100),
    shopCipher: requireValue(env.TIKTOK_SHOP_CIPHER, "TIKTOK_SHOP_CIPHER"),
    shopId: requireValue(env.TIKTOK_SHOP_ID, "TIKTOK_SHOP_ID"),
    sinceHours: numberOption(args.sinceHours, 24)
  };
  const runId = `backfill_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const sinceMs = Date.now() - config.sinceHours * 60 * 60 * 1000;
  const client = new TikTokClient(config);
  const state = loadState();
  const savedPostedIds = new Set(state.posted_message_ids || []);
  const postedIds = args.ignoreState ? new Set() : new Set(savedPostedIds);
  const newlyPostedIds = new Set();
  const summary = {
    run_id: runId,
    dry_run: args.dryRun,
    started_at: new Date().toISOString(),
    conversations_scanned: 0,
    conversations_with_unread: 0,
    unread_messages_seen: 0,
    candidates: 0,
    skipped_already_posted: 0,
    posted: 0,
    failed: 0,
    message_fetch_failed: 0
  };

  console.log(`Backfill run ${runId}`);
  console.log(`Scanning unread TikTok messages since ${new Date(sinceMs).toISOString()}`);
  console.log(args.dryRun ? "Dry run: no n8n webhook posts will be sent." : `Posting matches to ${config.n8nWebhookUrl}`);
  if (args.phoneOnly) {
    console.log("Candidate filter: replies containing a valid Indonesian mobile number.");
  }
  if (config.onlyMessageIds.size > 0) {
    console.log(`Only posting message ids: ${[...config.onlyMessageIds].join(", ")}`);
  }

  const conversations = await listConversations(client, config);
  summary.conversations_scanned = conversations.length;
  const unreadConversations = conversations.filter((conversation) => Number(conversation.unread_count) > 0);
  summary.conversations_with_unread = unreadConversations.length;
  console.log(`Found ${unreadConversations.length} conversations with unread_count > 0.`);

  for (const [index, conversation] of unreadConversations.entries()) {
    const conversationId = text(conversation.id || conversation.conversation_id);
    const unreadCount = Number(conversation.unread_count);
    if (!conversationId || !Number.isFinite(unreadCount) || unreadCount <= 0) continue;

    let messages;
    try {
      messages = await listMessages(client, conversationId, config);
    } catch (error) {
      summary.message_fetch_failed += 1;
      console.error(`failed to fetch messages for ${conversation.username || conversationId}: ${error.message}`);
      continue;
    }
    const unreadWindow = selectUnreadWindow(messages, unreadCount, config.ignoredSenders);
    const recentReplies = sortMessages(messages)
      .filter((item) => !config.ignoredSenders.has(messageSenderId(item)))
      .filter((item) => messageType(item) === "TEXT")
      .map((item) => messageText(messageBody(item).content).trim())
      .filter(Boolean)
      .slice(-3);
    const unreadMessageIds = new Set(unreadWindow.map(messageId).filter(Boolean));
    summary.unread_messages_seen += unreadWindow.length;

    if (args.verbose || unreadWindow.length > 0) {
      console.log(`conversation ${index + 1}/${unreadConversations.length} ${conversation.username || conversationId}: unread window ${unreadWindow.length}/${unreadCount}`);
    }

    for (const message of unreadWindow) {
      const candidate = candidateFromMessage({
        conversation,
        message,
        sinceMs,
        ignoredSenders: config.ignoredSenders,
        unreadMessageIds,
        phoneOnly: args.phoneOnly
      });
      if (!candidate) continue;
      if (config.onlyMessageIds.size > 0 && !config.onlyMessageIds.has(candidate.id)) continue;

      summary.candidates += 1;
      const label = `${candidate.classification.classification}:${candidate.classification.reason}`;
      console.log(`candidate ${candidate.id} @${candidate.username || "unknown"} ${label} ${JSON.stringify(candidate.text).slice(0, 160)}`);

      if (postedIds.has(candidate.id)) {
        summary.skipped_already_posted += 1;
        console.log(`skip already posted ${candidate.id}`);
        continue;
      }

      if (args.dryRun) continue;

      try {
        const payload = makeWebhookPayload({
          conversation,
          message,
          recentReplies,
          shopId: config.shopId,
          runId
        });
        await postWebhook(config.n8nWebhookUrl, payload);
        postedIds.add(candidate.id);
        newlyPostedIds.add(candidate.id);
        summary.posted += 1;
        console.log(`posted ${candidate.id} to n8n`);
      } catch (error) {
        summary.failed += 1;
        console.error(`failed ${candidate.id}: ${error.message}`);
      }

      if (config.postDelayMs > 0) await sleep(config.postDelayMs);
    }
  }

  summary.finished_at = new Date().toISOString();
  if (!args.dryRun) {
    state.posted_message_ids = [...new Set([...savedPostedIds, ...newlyPostedIds])].sort();
    state.runs = [...(state.runs || []), summary].slice(-20);
    saveState(state);
  }

  console.log("Backfill summary:");
  console.log(JSON.stringify(summary, null, 2));

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
