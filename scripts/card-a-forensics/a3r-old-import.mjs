// Card A · A3 re-do, step 1: produce a REAL old library with the old build (commit f78573e,
// main.js 44c324b8…). Fresh isolated host, old build four-piece install, real import entry
// (plugin.importStudySetBytes -> importStudySetPackage, the same function the command
// "导入学习集（.marginstudy-set.zip）" calls), then quit Obsidian. What is on disk at that
// moment is the "true old library" (L0) every scenario starts from.
// usage: node a3r-old-import.mjs <root> <outDir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  backupTree, inspectFile, jsonWrite, keepOriginal, note, now, portFree, readMainState, session,
  sha256, shaFile, treeSnapshot,
} from "./a3r-lib.mjs";
import { acceptTrust, clearUpdateCache, waitPlugin } from "./host.mjs";
import { ObsCdp, launchObsidian, quitObsidian, runtimeProbe, settle, waitWorkspace } from "./a3r-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const [rootArg, outArg] = process.argv.slice(2);
if (!rootArg || !outArg) throw new Error("usage: a3r-old-import.mjs <root> <outDir>");
const ROOT = path.resolve(rootArg);
const OUT = path.resolve(outArg);
fs.mkdirSync(OUT, { recursive: true });
process.env.CA_STEPS_LOG = path.join(OUT, "old-import-steps.log");
fs.writeFileSync(process.env.CA_STEPS_LOG, "");

export const OLD_BUILD = {
  commit: "f78573e8b5f5660bdf19af26fc9fd0ac75cd14db",
  buildDir: "/tmp/card-a-old",
  artifacts: {
    "main.js": "44c324b80b75311c5d9aa35c62071541d31bce548fb32a3ffaf3c83e0acba2ea",
    "manifest.json": "5bb313c4bbd901873136731ddc9bad11faf1ffaf31ed93edb6136a4a54a5bc66",
    "styles.css": "2a1c1ae006f0d4e357b7725b9b681bc1121de126e3100a433ccf69a1e0212308",
    "pdf.worker.js": "a2197f116566b0b80cab7a464f0b3955a66a509b52c1e51bc2783bf52c12ed8f",
  },
};

// ---- 0. the old build must be exactly the pinned one ----
const oldHashes = {};
for (const [name, expected] of Object.entries(OLD_BUILD.artifacts)) {
  const file = path.join(OLD_BUILD.buildDir, name);
  if (!fs.existsSync(file)) throw new Error("old build artifact missing: " + file);
  const actual = shaFile(file);
  oldHashes[name] = { file, actual, expected, equals: actual === expected, size: fs.statSync(file).size };
  if (actual !== expected) throw new Error(`old build identity mismatch on ${name}: ${actual} != ${expected}`);
}
const oldWorktree = {
  path: OLD_BUILD.buildDir,
  head: execFileSync("git", ["-C", OLD_BUILD.buildDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  headMessage: execFileSync("git", ["-C", OLD_BUILD.buildDir, "log", "-1", "--pretty=%s"], { encoding: "utf8" }).trim(),
  statusShort: execFileSync("git", ["-C", OLD_BUILD.buildDir, "status", "--short", "--untracked-files=normal"],
    { encoding: "utf8" }).trim().split("\n").filter(line => line && !line.includes("node_modules")),
  nodeVersion: process.version,
  buildCommand: "npm run build",
};
note("old-build", oldHashes);

// ---- 1. fixture (three sources + full object graph) ----
const FIXTURE_ROOT = path.join("/tmp", "a3r-fixture");
fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
const fixture = JSON.parse(execFileSync(process.execPath, [path.join(HERE, "a3r-fixture.mjs"), FIXTURE_ROOT],
  { encoding: "utf8" }).trim());
note("fixture", { archive: fixture.archive, archiveSha256: fixture.archiveSha256, size: fixture.archiveSize });

// ---- 2. isolated host with the old build ----
const setup = JSON.parse(execFileSync(process.execPath, [path.join(HERE, "a3r-host.mjs"), ROOT, OLD_BUILD.buildDir],
  { encoding: "utf8" }).trim());
note("host", { root: setup.root, vault: setup.vault, installedEqualsSource: setup.installedEqualsSource, installed: setup.installed });

if (!await portFree()) throw new Error("port 9333 busy before old-build session");

// ---- 3. old-build session: real import ----
const stage = "old-import";
const cdp = (await (async () => {
  const removedAsar = clearUpdateCache(ROOT);
  const run = launchObsidian({ root: ROOT, stage });
  const client = await ObsCdp.attach(150000);
  await waitWorkspace(client);
  const trust = await acceptTrust(client);
  const pluginLoaded = await waitPlugin(client);
  note("old-session-arrived", { hostPid: run.pid, removedAsar, trustClicked: !!trust, pluginLoaded });
  return { client, run, trust, pluginLoaded, removedAsar };
})());

const beforeImport = readMainState(setup.mainFile);
const bundleBefore = await runtimeProbe(cdp.client, setup);
note("old-session-bundle", { installed: bundleBefore.installed,
  backfillSourceSha256: bundleBefore.probe.backfillSourceSha256,
  hasHasDocumentFingerprint: bundleBefore.probe.storeApi.backfillHasHasDocumentFingerprint,
  storeState: bundleBefore.probe.storeState });

const zipBytes = fs.readFileSync(fixture.archive);
const b64 = zipBytes.toString("base64");
const importStarted = now();
const importResult = await cdp.client.eval(`(async () => {
  const plugin = app.plugins.plugins["margin-study"];
  const bin = atob(${JSON.stringify(b64)});
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const started = Date.now();
  const summary = await plugin.importStudySetBytes(bytes.buffer, { mode: "new" });
  return { entry: "plugin.importStudySetBytes(bytes, {mode:'new'})", waitsMs: Date.now() - started, summary };
})()`);
note("import", { startedAt: importStarted, finishedAt: now(), summary: importResult.summary, waitsMs: importResult.waitsMs });

const settled = await settle(cdp.client, setup.mainFile, { quietMs: 8000 });
await cdp.client.notices();
const screenshot = await cdp.client.screenshot(path.join(OUT, "old-import-after.png"));
const notices = [...cdp.client.noticeLog];
const errors = cdp.client.errors().slice(-40);
const rendererState = await cdp.client.eval(`(() => { const s = app.plugins.plugins["margin-study"].store;
  return { revision: s.getRevision(), documents: s.documents.map(d => ({ id: d.id, path: d.path, missing: !!d.missing,
    byteSize: d.byteSize ?? null, sha256: d.sha256 ?? null })), srs: s.srs, localEvents: (s.localEvents||[]).length,
    settings: { backupEnabled: s.settings.backupEnabled, lastBackup: s.settings.lastBackup ?? null } }; })()`);
const afterImportState = readMainState(setup.mainFile);
const afterImportOriginal = keepOriginal(setup.mainFile, path.join(OUT, "L0-data.json"));

cdp.client.close();
const exited = await quitObsidian(cdp.run.pid);
if (!exited) execFileSync("/bin/sh", ["-c", `kill -9 ${cdp.run.pid} 2>/dev/null || true`]);
await new Promise(resolve => setTimeout(resolve, 2000));

// ---- 4. L0 = disk state with Obsidian closed ----
const l0File = setup.mainFile;
const l0 = inspectFile(l0File, setup.vault);
const l0Copy = keepOriginal(l0File, path.join(OUT, "L0-data-after-quit.json"));
const backups = backupTree(setup.vault);
const vaultTree = treeSnapshot(setup.vault);
const L0VAULT = path.join("/tmp", "a3r-L0", "vault");
fs.rmSync("/tmp/a3r-L0", { recursive: true, force: true });
fs.mkdirSync(path.dirname(L0VAULT), { recursive: true });
fs.cpSync(setup.vault, L0VAULT, { recursive: true, preserveTimestamps: true });
const l0VaultTree = treeSnapshot(L0VAULT);
const l0VaultData = shaFile(path.join(L0VAULT, ".obsidian/plugins/margin-study/data.json"));

const report = {
  capturedAt: now(),
  what: "L0 · 真旧库（旧构建 f78573e 真实导入后落盘、Obsidian 已退出）",
  oldBuild: { pinned: OLD_BUILD, hashes: oldHashes, worktree: oldWorktree },
  fixture,
  host: { root: setup.root, vault: setup.vault, mainStateFile: setup.mainFile, buildDir: setup.buildDir },
  import: { entry: importResult.entry, summary: importResult.summary, waitsMs: importResult.waitsMs,
    archiveSha256: fixture.archiveSha256, beforeImportMetrics: beforeImport, afterImportMetrics: afterImportState },
  bundleAtImport: { installed: bundleBefore.installed, backfillSourceSha256: bundleBefore.probe.backfillSourceSha256,
    mainJsContainsHasDocumentFingerprint: bundleBefore.mainJsContainsHasDocumentFingerprint,
    backfillHasHasDocumentFingerprint: bundleBefore.probe.storeApi.backfillHasHasDocumentFingerprint,
    obsidianVersion: bundleBefore.probe.obsidianVersion, rendererPid: bundleBefore.probe.rendererPid },
  settle: settled, rendererState, notices, errors, screenshot, quitExited: exited,
  L0: { dataFileOriginal: afterImportOriginal, dataFileAfterQuit: l0Copy, inspection: l0,
    backupTree: backups, vaultTree, vaultFileCount: Object.keys(vaultTree).length },
  L0VaultCopy: { path: L0VAULT, fileCount: Object.keys(l0VaultTree).length, dataSha256: l0VaultData,
    dataShaEqualsL0: l0VaultData === l0.sha256 },
};
jsonWrite(path.join(OUT, "old-import.json"), report);

console.log(JSON.stringify({
  oldBuildMainJs: oldHashes["main.js"].actual,
  importSummary: importResult.summary,
  L0: { sha256: l0.sha256, size: l0.size, revision: l0.body?.revision, schemaVersion: l0.body?.schemaVersion,
    settings: l0.body?.settings, graph: l0.body?.graph,
    documentsWithoutFingerprint: l0.body?.documentsWithoutFingerprint, bareDateCount: l0.body?.bareDateCount,
    documents: l0.body?.documents.map(d => ({ path: d.path, missing: d.missing, byteSizePresent: d.byteSizePresent, sha256Present: d.sha256Present })),
    srs: l0.body?.srs.map(s => ({ id: s.questionId, due: s.due, lastReviewed: s.lastReviewed, dueIsBareDate: s.dueIsBareDate })) },
  backupDirs: backups.dirs, vaultFileCount: Object.keys(vaultTree).length,
  L0VaultCopy: L0VAULT,
}, null, 2));