"use strict";

const {
  TRACKER_HEADERS,
  recordToSheetRow,
  sheetRowsToObjects
} = require("./affiliateHandoff");

function requireValue(value, name) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function encodeRange(sheetName, range) {
  return encodeURIComponent(`'${sheetName.replace(/'/g, "''")}'!${range}`);
}

function columnLetter(index) {
  let value = index;
  let output = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

async function requestJson(url, { method = "GET", accessToken, body, headers = {} } = {}) {
  requireValue(accessToken, "Google OAuth access token");

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = payload.error && payload.error.message ? payload.error.message : text;
    const error = new Error(`Google API ${method} ${url} failed: ${message}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function listDriveChildFolders({ accessToken, parentFolderId, pageSize = 1000 }) {
  requireValue(parentFolderId, "Google Drive Clips folder ID");

  const query = [
    `'${parentFolderId}' in parents`,
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false"
  ].join(" and ");

  const params = new URLSearchParams({
    q: query,
    fields: "nextPageToken,files(id,name,mimeType,webViewLink,createdTime,modifiedTime)",
    pageSize: String(pageSize),
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true"
  });

  const files = [];
  let pageToken = "";

  do {
    if (pageToken) {
      params.set("pageToken", pageToken);
    }
    const payload = await requestJson(`https://www.googleapis.com/drive/v3/files?${params}`, {
      accessToken
    });
    files.push(...(payload.files || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);

  return files;
}

async function renameDriveFolder({ accessToken, folderId, newName }) {
  requireValue(folderId, "Drive folder ID");
  requireValue(newName, "New Drive folder name");

  const params = new URLSearchParams({
    fields: "id,name,webViewLink",
    supportsAllDrives: "true"
  });

  return requestJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?${params}`, {
    method: "PATCH",
    accessToken,
    body: { name: newName }
  });
}

async function ensureDriveFolderSharing({ accessToken, folderId, mode = "anyone_reader" }) {
  if (mode === "skip") {
    return { skipped: true };
  }
  if (mode !== "anyone_reader") {
    throw new Error(`Unsupported GOOGLE_DRIVE_SHARE_MODE: ${mode}`);
  }

  const params = new URLSearchParams({
    sendNotificationEmail: "false",
    supportsAllDrives: "true",
    fields: "id,type,role"
  });

  try {
    return await requestJson(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}/permissions?${params}`,
      {
        method: "POST",
        accessToken,
        body: {
          type: "anyone",
          role: "reader"
        }
      }
    );
  } catch (error) {
    if (error.status === 409) {
      return { alreadyExists: true };
    }
    throw error;
  }
}

async function readSheetValues({ accessToken, spreadsheetId, sheetName }) {
  requireValue(spreadsheetId, "Affiliate tracker spreadsheet ID");
  requireValue(sheetName, "Affiliate tracker sheet name");

  const range = encodeRange(sheetName, `A:${columnLetter(TRACKER_HEADERS.length)}`);
  const payload = await requestJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}`,
    { accessToken }
  );
  return payload.values || [];
}

async function readTrackerRows({ accessToken, spreadsheetId, sheetName }) {
  const values = await readSheetValues({ accessToken, spreadsheetId, sheetName });
  return sheetRowsToObjects(values);
}

function parseAppendRowNumber(updatedRange) {
  const match = /!.*?(\d+)(?::|$)/.exec(updatedRange || "");
  return match ? Number.parseInt(match[1], 10) : null;
}

async function appendSheetRow({ accessToken, spreadsheetId, sheetName, record }) {
  requireValue(spreadsheetId, "Affiliate tracker spreadsheet ID");
  requireValue(sheetName, "Affiliate tracker sheet name");

  const range = encodeRange(sheetName, `A:${columnLetter(TRACKER_HEADERS.length)}`);
  const params = new URLSearchParams({
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS"
  });

  const payload = await requestJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}:append?${params}`,
    {
      method: "POST",
      accessToken,
      body: {
        majorDimension: "ROWS",
        values: [recordToSheetRow(record)]
      }
    }
  );

  return {
    payload,
    rowNumber: parseAppendRowNumber(payload.updates && payload.updates.updatedRange)
  };
}

async function updateSheetRow({ accessToken, spreadsheetId, sheetName, rowNumber, record }) {
  requireValue(rowNumber, "Tracker row number");

  const endColumn = columnLetter(TRACKER_HEADERS.length);
  const range = encodeRange(sheetName, `A${rowNumber}:${endColumn}${rowNumber}`);
  const params = new URLSearchParams({
    valueInputOption: "USER_ENTERED"
  });

  return requestJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?${params}`,
    {
      method: "PUT",
      accessToken,
      body: {
        majorDimension: "ROWS",
        values: [recordToSheetRow(record)]
      }
    }
  );
}

async function readSheetRow({ accessToken, spreadsheetId, sheetName, rowNumber }) {
  requireValue(rowNumber, "Tracker row number");

  const endColumn = columnLetter(TRACKER_HEADERS.length);
  const range = encodeRange(sheetName, `A${rowNumber}:${endColumn}${rowNumber}`);
  const payload = await requestJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}`,
    { accessToken }
  );
  const row = payload.values && payload.values[0] ? payload.values[0] : [];
  const object = {};
  TRACKER_HEADERS.forEach((header, index) => {
    object[header] = row[index] == null ? "" : String(row[index]);
  });
  object._rowNumber = Number.parseInt(rowNumber, 10);
  return object;
}

module.exports = {
  appendSheetRow,
  columnLetter,
  ensureDriveFolderSharing,
  listDriveChildFolders,
  parseAppendRowNumber,
  readSheetRow,
  readSheetValues,
  readTrackerRows,
  renameDriveFolder,
  requestJson,
  updateSheetRow
};
