#!/usr/bin/env python3
"""Export current and published workflow definitions from an offline n8n backup."""

import hashlib
import json
import pathlib
import sqlite3
import sys

WORKFLOW_IDS = (
    "AffWaWebhook2026",
    "AffWaReply2026",
    "AffWaDelivery2026",
    "AffWaStatus2026",
    "AffWaOptIn2026",
)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: pathlib.Path, payload: dict) -> dict:
    data = (json.dumps(payload, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    path.write_bytes(data)
    json.loads(path.read_text(encoding="utf-8"))
    return {"file": str(path.name), "bytes": len(data), "sha256": digest(data)}


def parse_json(value, fallback):
    if value in (None, ""):
        return fallback
    return json.loads(value)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: export_observability_workflow_backup.py BACKUP_DIRECTORY")
    destination = pathlib.Path(sys.argv[1]).resolve()
    database = destination / "n8n_data" / "database.sqlite"
    if not database.is_file():
        raise SystemExit(f"offline n8n database not found: {database}")
    current_dir = destination / "workflows" / "current"
    published_dir = destination / "workflows" / "published"
    current_dir.mkdir(parents=True, exist_ok=True)
    published_dir.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    files = []
    manifest = []
    try:
        for workflow_id in WORKFLOW_IDS:
            row = connection.execute(
                "select * from workflow_entity where id = ?", (workflow_id,)
            ).fetchone()
            if row is None:
                raise RuntimeError(f"missing current workflow {workflow_id}")
            current = {
                "id": row["id"],
                "name": row["name"],
                "active": bool(row["active"]),
                "versionId": row["versionId"],
                "activeVersionId": row["activeVersionId"],
                "versionCounter": row["versionCounter"],
                "createdAt": row["createdAt"],
                "updatedAt": row["updatedAt"],
                "nodes": parse_json(row["nodes"], []),
                "connections": parse_json(row["connections"], {}),
                "settings": parse_json(row["settings"], {}),
                "staticData": parse_json(row["staticData"], None),
                "pinData": parse_json(row["pinData"], None),
            }
            files.append(write_json(current_dir / f"{workflow_id}.json", current))
            published_row = connection.execute(
                "select * from workflow_history where workflowId = ? and versionId = ?",
                (workflow_id, row["activeVersionId"]),
            ).fetchone()
            if published_row is None:
                raise RuntimeError(f"published version missing for {workflow_id}")
            published = {
                "id": workflow_id,
                "name": published_row["name"],
                "versionId": published_row["versionId"],
                "createdAt": published_row["createdAt"],
                "updatedAt": published_row["updatedAt"],
                "nodes": parse_json(published_row["nodes"], []),
                "connections": parse_json(published_row["connections"], {}),
            }
            files.append(write_json(published_dir / f"{workflow_id}.json", published))
            manifest.append({
                "id": workflow_id,
                "name": row["name"],
                "active": bool(row["active"]),
                "version_id": row["versionId"],
                "active_version_id": row["activeVersionId"],
                "version_counter": row["versionCounter"],
                "updated_at": row["updatedAt"],
                "current_nodes": len(current["nodes"]),
                "published_nodes": len(published["nodes"]),
            })
    finally:
        connection.close()
    result = {"database_integrity": "ok", "workflows": manifest, "files": files}
    write_json(destination / "workflow-backup-manifest.json", result)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
