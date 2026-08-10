#!/usr/bin/env node
"use strict";

const {
  nowIso,
  updateRecordState
} = require("./affiliateHandoff");

const {
  readSheetRow,
  updateSheetRow
} = require("./googleApi");

const {
  getGoogleAccessToken
} = require("./googleAuth");

function parseArgs(argv) {
  const output = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      output[key] = next;
      index += 1;
    } else {
      output[key] = "true";
    }
  }
  return output;
}

async function run() {
  const args = parseArgs(process.argv);
  const accessToken = await getGoogleAccessToken();
  const spreadsheetId = process.env.AFFILIATE_TRACKER_SPREADSHEET_ID;
  const sheetName = process.env.AFFILIATE_TRACKER_SHEET_NAME || "Affiliate Assignments";
  const rowNumber = args.row || args["row-number"] || process.env.TRACKER_ROW_NUMBER;
  const state = args.state || process.env.TRACKER_SEND_STATE;
  const lastError = args.error || process.env.TRACKER_LAST_ERROR || "";

  if (!spreadsheetId) throw new Error("AFFILIATE_TRACKER_SPREADSHEET_ID is required");
  if (!rowNumber) throw new Error("Tracker row number is required");
  if (!["link_sent", "failed_link_send"].includes(state)) {
    throw new Error("State must be link_sent or failed_link_send");
  }

  const current = await readSheetRow({
    accessToken,
    spreadsheetId,
    sheetName,
    rowNumber
  });

  const updated = updateRecordState(current, state, {
    linkSentAt: state === "link_sent" ? nowIso() : current.link_sent_at,
    lastError: state === "failed_link_send" ? lastError || "tiktok_send_failed" : ""
  });

  await updateSheetRow({
    accessToken,
    spreadsheetId,
    sheetName,
    rowNumber,
    record: updated
  });

  process.stdout.write(`${JSON.stringify({ ok: true, rowNumber, state, record: updated })}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
