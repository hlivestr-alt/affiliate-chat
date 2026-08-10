const fs = require("node:fs");

const [, , inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  throw new Error("Usage: node scripts/patch_live_drive_link_note.js <input.json> <output.json>");
}

const parsed = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const workflows = Array.isArray(parsed) ? parsed : [parsed];
const workflow = workflows.find((item) => item && item.id === "AfDriveReady2026");

if (!workflow) {
  throw new Error("Workflow AfDriveReady2026 was not found in the export");
}

const targetNames = new Set(["Select Assignment", "Build Assigned State"]);
const noteLines = [
  "Catatan: Link di TikTok Affiliate Center biasanya tidak bisa langsung diklik. Silakan tekan dan tahan pada link, pilih atau blok seluruh link, lalu salin dan tempelkan ke browser seperti Google Chrome atau Safari.",
  "Jika ada yang perlu ditanyakan silahkan WA di nomor ini 0882-1097-7575."
];
let changed = 0;

for (const node of workflow.nodes || []) {
  if (!targetNames.has(node.name)) continue;

  const code = node.parameters && node.parameters.jsCode;
  if (typeof code !== "string") {
    throw new Error(`Target node ${node.name} does not contain jsCode`);
  }
  if (noteLines.every((line) => code.includes(line))) {
    throw new Error(`Target node ${node.name} already contains the Drive-link note`);
  }

  const indentation = node.name === "Select Assignment" ? "        " : "      ";
  const anchor = `${indentation}record.drive_link,\n${indentation}\"Berikut ketentuan`;
  const replacement = [
    `${indentation}record.drive_link,`,
    `${indentation}\"${noteLines[0]}\",`,
    `${indentation}\"${noteLines[1]}\",`,
    `${indentation}\"Berikut ketentuan`
  ].join("\n");

  if (!code.includes(anchor)) {
    throw new Error(`Expected Drive-link message anchor was not found in ${node.name}`);
  }

  node.parameters.jsCode = code.replace(anchor, replacement);
  changed += 1;
}

if (changed !== targetNames.size) {
  throw new Error(`Expected to update ${targetNames.size} nodes, updated ${changed}`);
}

fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2) + "\n");
console.log(`Updated ${changed} live workflow nodes in ${outputPath}`);
