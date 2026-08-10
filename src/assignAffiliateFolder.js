#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const {
  EXPLANATION_TEMPLATE,
  assignedFolderIdsFromRows,
  buildDriveLinkMessage,
  classifyReply,
  createAssignmentRecord,
  createManualReviewRecord,
  makeAffiliateFolderName,
  nowIso,
  reservationWins,
  selectNextNumericFolder,
  updateRecordState
} = require("./affiliateHandoff");

const {
  appendSheetRow,
  ensureDriveFolderSharing,
  listDriveChildFolders,
  readTrackerRows,
  renameDriveFolder,
  updateSheetRow
} = require("./googleApi");

const {
  getGoogleAccessToken
} = require("./googleAuth");

function parseInput() {
  if (process.env.AFFILIATE_INPUT_JSON_BASE64) {
    return JSON.parse(Buffer.from(process.env.AFFILIATE_INPUT_JSON_BASE64, "base64").toString("utf8"));
  }
  if (process.env.AFFILIATE_INPUT_JSON) {
    return JSON.parse(process.env.AFFILIATE_INPUT_JSON);
  }
  if (process.argv[2] === "--json-base64" && process.argv[3]) {
    return JSON.parse(Buffer.from(process.argv[3], "base64").toString("utf8"));
  }
  if (process.argv[2] === "--json" && process.argv[3]) {
    return JSON.parse(process.argv[3]);
  }
  if (process.argv[2]) {
    return JSON.parse(process.argv[2]);
  }
  if (!process.stdin.isTTY) {
    const text = fs.readFileSync(0, "utf8").trim();
    return text ? JSON.parse(text) : {};
  }
  return {};
}

function normalizeInbound(input) {
  const body = input && input.body && typeof input.body === "object" ? input.body : input || {};
  const message = body.message && typeof body.message === "object" ? body.message : {};
  const sender = body.sender && typeof body.sender === "object"
    ? body.sender
    : message.sender && typeof message.sender === "object"
      ? message.sender
      : {};

  return {
    affiliateId:
      body.affiliate_id ||
      body.creator_id ||
      body.user_id ||
      body.sender_id ||
      body.tiktok_user_id ||
      message.sender_id ||
      "",
    affiliateName:
      body.affiliate_name ||
      body.creator_name ||
      body.display_name ||
      body.name ||
      message.sender_name ||
      "",
    username:
      body.username ||
      body.tiktok_handle ||
      body.handle ||
      body.unique_id ||
      body.creator_username ||
      body.sender_handle ||
      sender.username ||
      sender.tiktok_handle ||
      sender.handle ||
      sender.unique_id ||
      message.username ||
      message.tiktok_handle ||
      message.sender_handle ||
      message.unique_id ||
      "",
    conversationId:
      body.conversation_id ||
      body.thread_id ||
      body.chat_id ||
      message.conversation_id ||
      "",
    inboundText:
      body.text ||
      body.reply_text ||
      body.content ||
      body.latest_message ||
      message.text ||
      message.content ||
      ""
  };
}

function getRuntimeConfig() {
  return {
    accessToken: process.env.GOOGLE_OAUTH_ACCESS_TOKEN || "",
    parentFolderId: process.env.GOOGLE_DRIVE_CLIPS_FOLDER_ID,
    spreadsheetId: process.env.AFFILIATE_TRACKER_SPREADSHEET_ID,
    sheetName: process.env.AFFILIATE_TRACKER_SHEET_NAME || "Affiliate Assignments",
    pickStrategy: process.env.AFFILIATE_PICK_STRATEGY || "lowest",
    shareMode: process.env.GOOGLE_DRIVE_SHARE_MODE || "anyone_reader",
    settleMs: Number.parseInt(process.env.RESERVATION_SETTLE_MS || "750", 10)
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function appendManualReview(config, inbound, reason) {
  if (!config.accessToken) {
    config.accessToken = await getGoogleAccessToken({ optional: true });
  }
  if (!config.accessToken || !config.spreadsheetId || !config.sheetName) {
    return { logged: false };
  }

  const record = createManualReviewRecord({
    affiliateId: inbound.affiliateId,
    affiliateName: inbound.affiliateName,
    username: inbound.username,
    conversationId: inbound.conversationId,
    lastError: reason
  });
  const append = await appendSheetRow({
    accessToken: config.accessToken,
    spreadsheetId: config.spreadsheetId,
    sheetName: config.sheetName,
    record
  });
  return {
    logged: true,
    rowNumber: append.rowNumber,
    record
  };
}

function assertLiveConfig(config) {
  const missing = [];
  if (!config.accessToken) missing.push("GOOGLE_OAUTH_ACCESS_TOKEN");
  if (!config.parentFolderId) missing.push("GOOGLE_DRIVE_CLIPS_FOLDER_ID");
  if (!config.spreadsheetId) missing.push("AFFILIATE_TRACKER_SPREADSHEET_ID");
  if (!config.sheetName) missing.push("AFFILIATE_TRACKER_SHEET_NAME");
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

async function run() {
  const input = parseInput();
  const inbound = normalizeInbound(input);
  const classification = classifyReply(inbound.inboundText);
  const config = getRuntimeConfig();

  if (classification.classification === "interested") {
    return {
      ok: true,
      action: "send_explanation_template",
      classification,
      outboundMessage: EXPLANATION_TEMPLATE
    };
  }

  if (classification.classification !== "confirmed") {
    const shouldLog = classification.classification === "manual_review" || classification.classification === "question";
    const log = shouldLog
      ? await appendManualReview(config, inbound, `classification:${classification.reason}`)
      : { logged: false };
    return {
      ok: true,
      action: "no_send",
      classification,
      log
    };
  }

  if (!inbound.username) {
    const log = await appendManualReview(config, inbound, "missing_username");
    return {
      ok: true,
      action: "no_send",
      classification,
      state: "manual_review",
      reason: "missing_username",
      log
    };
  }

  config.accessToken = await getGoogleAccessToken();
  assertLiveConfig(config);

  const trackerRows = await readTrackerRows({
    accessToken: config.accessToken,
    spreadsheetId: config.spreadsheetId,
    sheetName: config.sheetName
  });
  const assignedFolderIds = assignedFolderIdsFromRows(trackerRows);
  const driveFolders = await listDriveChildFolders({
    accessToken: config.accessToken,
    parentFolderId: config.parentFolderId
  });
  const folder = selectNextNumericFolder(driveFolders, assignedFolderIds, config.pickStrategy);

  if (!folder) {
    const log = await appendManualReview(config, inbound, "no_numeric_folder_available");
    return {
      ok: true,
      action: "no_send",
      classification,
      state: "manual_review",
      reason: "no_numeric_folder_available",
      log
    };
  }

  const newFolderName = makeAffiliateFolderName({
    affiliateName: inbound.affiliateName,
    username: inbound.username,
    tiktokId: inbound.affiliateId,
    batchNumber: folder.originalBatchNumber,
    existingNames: driveFolders.map((item) => item.name)
  });

  const assignedAt = nowIso();
  let record = createAssignmentRecord({
    affiliateId: inbound.affiliateId,
    affiliateName: inbound.affiliateName,
    username: inbound.username,
    conversationId: inbound.conversationId,
    folder,
    newFolderName,
    assignedAt
  });

  const append = await appendSheetRow({
    accessToken: config.accessToken,
    spreadsheetId: config.spreadsheetId,
    sheetName: config.sheetName,
    record
  });

  const rowNumber = append.rowNumber;
  record = {
    ...record,
    _rowNumber: rowNumber
  };

  if (config.settleMs > 0) {
    await sleep(config.settleMs);
  }

  const rowsAfterReserve = await readTrackerRows({
    accessToken: config.accessToken,
    spreadsheetId: config.spreadsheetId,
    sheetName: config.sheetName
  });

  if (!reservationWins(rowsAfterReserve, record)) {
    const loser = updateRecordState(record, "manual_review", {
      lastError: "duplicate_reservation_lost"
    });
    if (rowNumber) {
      await updateSheetRow({
        accessToken: config.accessToken,
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName,
        rowNumber,
        record: loser
      });
    }
    return {
      ok: true,
      action: "no_send",
      classification,
      state: "manual_review",
      reason: "duplicate_reservation_lost",
      trackerRowNumber: rowNumber,
      record: loser
    };
  }

  try {
    await renameDriveFolder({
      accessToken: config.accessToken,
      folderId: folder.id,
      newName: newFolderName
    });
  } catch (error) {
    const failed = updateRecordState(record, "failed_rename", {
      lastError: error.message
    });
    if (rowNumber) {
      await updateSheetRow({
        accessToken: config.accessToken,
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName,
        rowNumber,
        record: failed
      });
    }
    throw error;
  }

  record = updateRecordState(record, "assigned");
  if (rowNumber) {
    await updateSheetRow({
      accessToken: config.accessToken,
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName,
      rowNumber,
      record
    });
  }

  try {
    await ensureDriveFolderSharing({
      accessToken: config.accessToken,
      folderId: folder.id,
      mode: config.shareMode
    });
  } catch (error) {
    const failed = updateRecordState(record, "failed_share", {
      lastError: error.message
    });
    if (rowNumber) {
      await updateSheetRow({
        accessToken: config.accessToken,
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName,
        rowNumber,
        record: failed
      });
    }
    return {
      ok: true,
      action: "no_send",
      classification,
      state: "failed_share",
      reason: error.message,
      trackerRowNumber: rowNumber,
      record: failed
    };
  }

  return {
    ok: true,
    action: "send_drive_link",
    classification,
    state: "assigned",
    trackerRowNumber: rowNumber,
    driveLink: record.drive_link,
    outboundMessage: buildDriveLinkMessage(record.drive_link),
    record
  };
}

run()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
