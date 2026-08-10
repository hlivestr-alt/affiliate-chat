const ACTIVE_STATES = new Set([
  "reserved",
  "assigned",
  "link_sent",
  "failed_link_send",
  "failed_rename",
  "failed_share",
  "manual_review"
]);

function text(value) {
  return value == null ? "" : String(value);
}

function time(value) {
  const ms = Date.parse(text(value));
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

const current = $items("Select Assignment")[0].json;
const rows = $items("Read Tracker Rows After Reserve").map((item, index) => ({
  ...item.json,
  _rowNumber: item.json.row_number || item.json.rowNumber || item.json.__rowNumber || index + 2
}));

const winner = rows
  .filter((row) => text(row.drive_folder_id) === text(current.drive_folder_id))
  .filter((row) => ACTIVE_STATES.has(text(row.state)))
  .sort((a, b) => {
    const delta = time(a.assigned_at) - time(b.assigned_at);
    if (delta !== 0) return delta;
    return Number(a._rowNumber || 0) - Number(b._rowNumber || 0);
  })[0];

const wins =
  winner &&
  text(winner.conversation_id) === text(current.conversation_id) &&
  text(winner.assigned_at) === text(current.assigned_at);

return [
  {
    json: {
      ...current,
      action: wins ? "rename_folder" : "manual_review_duplicate_reservation",
      last_error: wins ? current.last_error : "duplicate_reservation_lost"
    }
  }
];
