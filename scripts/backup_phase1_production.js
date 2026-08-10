"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const WORKFLOW_IDS = [
  "7jMwFtJdCvCg18F3",
  "AfDriveReady2026",
  "AffWaQueue2026",
  "AffWaDelivery2026",
  "AffWaOptIn2026",
  "AffWaReply2026",
  "AffWaStatus2026",
  "AffWaWebhook2026",
  "AffWaVerify2026"
];
const PUBLIC_FLAGS = new Set([
  "ZERO_CHARGE_MODE",
  "WHATSAPP_PHASE1_ENABLED",
  "WHATSAPP_TEST_MODE",
  "WHATSAPP_LIVE_TEST_ARMED"
]);

function readEnv(file) {
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) values[match[1].trim()] = match[2];
  }
  return values;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function hash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function redact(value, secrets) {
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (/secret|token|password|authorization|api.?key/i.test(key)) return [key, "<redacted>"];
      return [key, redact(item, secrets)];
    }));
  }
  if (typeof value !== "string") return value;
  let result = value.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer <redacted>");
  for (const secret of secrets) {
    if (secret.length >= 8) result = result.split(secret).join("<redacted>");
  }
  return result;
}

async function api(pathname, key) {
  const response = await fetch(API + pathname, { headers: { "X-N8N-API-KEY": key } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status} ${pathname}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

async function main() {
  const mainEnv = readEnv(path.join(ROOT, ".env"));
  const phaseEnv = readEnv(path.join(ROOT, ".env.phase1"));
  if (!mainEnv.N8N_API_KEY) throw new Error("N8N_API_KEY is missing");
  const secrets = [...Object.entries({ ...mainEnv, ...phaseEnv })]
    .filter(([key, value]) => value && !PUBLIC_FLAGS.has(key))
    .map(([, value]) => value);
  const backup = path.join(ROOT, "n8n", "exports", "live-backups", `post-isolated-test-${timestamp()}`);
  fs.mkdirSync(path.join(backup, "workflows"), { recursive: true });

  const manifest = [];
  for (const id of WORKFLOW_IDS) {
    const workflow = await api(`/workflows/${id}`, mainEnv.N8N_API_KEY);
    const safe = redact(workflow, secrets);
    const file = path.join(backup, "workflows", `${id}.json`);
    fs.writeFileSync(file, JSON.stringify(safe, null, 2) + "\n");
    manifest.push({ id, name: workflow.name, active: Boolean(workflow.active), updatedAt: workflow.updatedAt });
  }

  const redactedEnv = {};
  for (const [key, value] of Object.entries({ ...mainEnv, ...phaseEnv })) {
    redactedEnv[key] = PUBLIC_FLAGS.has(key) ? value : "<redacted>";
  }
  fs.writeFileSync(path.join(backup, "environment.redacted.json"), JSON.stringify(redactedEnv, null, 2) + "\n");

  const evidenceFiles = [
    "3p-direct-integration-test-template-last-response.json",
    "3p-direct-integration-test-template-last-status.json"
  ].map((name) => path.join(ROOT, "n8n", "exports", name)).filter(fs.existsSync);
  fs.writeFileSync(path.join(backup, "isolated-test-evidence.sha256.json"), JSON.stringify(
    evidenceFiles.map((file) => ({ file: path.relative(ROOT, file), sha256: hash(file), size: fs.statSync(file).size })),
    null,
    2
  ) + "\n");
  fs.writeFileSync(path.join(backup, "workflow-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  process.stdout.write(backup + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
