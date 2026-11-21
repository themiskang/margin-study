// Card A stage 2 · A1 (new import is normalized) + A2 (first cold restart of that new library
// writes nothing). Observation only: records state, never modifies sources.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { HEX64_RE, ISO_RE, WriteWatch, bareDates, jsonWrite, note, now, quitObsidian, readMainState, sha256, shaFile, sixDiff, sleep } from "./lib.mjs";
import { bringUp, runtimeBundleEvidence, settle } from "./host.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const OUT = process.env.CA_OUT ?? path.join(REPO, "evidence/card-A/forensics");
const ROOT = process.env.CA_ROOT ?? "/tmp/card-a-host-a12";
const MANIFEST = JSON.parse(fs.readFileSync(path.join(REPO, "evidence/card-A/exec/build-manifest.json"), "utf8"));
fs.mkdirSync(OUT, { recursive: true });
process.env.CA_STEPS_LOG = path.join(OUT, "a1a2-steps.log");
fs.writeFileSync(process.env.CA_STEPS_LOG, "");

const setup = JSON.parse(execFileSync(process.execPath, [path.join(HERE, "bootstrap.mjs"), "fresh", ROOT], { encoding: "utf8" }).trim());
const fixture = JSON.parse(execFileSync(process.execPath, [path.join(HERE, "mkfixture.mjs"), "import", ROOT], { encoding: "utf8" }).trim());
const archive = fs.readFileSync(fixture.archive);
note("setup", { root: ROOT, archiveSha256: sha256(archive), installed: setup.installedAfterInstall });

// ---------- A1: import into the fresh library ----------
const first = await bringUp(ROOT, "a1-import");
let { cdp, run } = first;
const bundleAtA1 = await runtimeBundleEvidence(cdp, setup, MANIFEST);
note("bundle-at-a1", { installedEqualsBuildManifest: bundleAtA1.installedEqualsBuildManifest,
  storeSourceIsCardABuild: bundleAtA1.probe.storeSourceIsCardABuild, rendererPid: bundleAtA1.probe.rendererPid,
  obsidianVersion: bundleAtA1.probe.obsidianVersion });
if (!bundleAtA1.installedEqualsBuildManifest || !bundleAtA1.probe.storeSourceIsCardABuild) {
  throw new Error("runtime bundle does not match evidence/card-A/exec/build-manifest.json or is not the Card A build");
}
const preImportState = readMainState(setup.mainFile);
note("pre-import-main", preImportState);
await cdp.eval(`(() => { window.__caNotices = [];
  new MutationObserver(() => { for (const n of document.querySelectorAll(".notice")) { const t = n.textContent;
    if (t && !window.__caNotices.some(x => x.text === t)) window.__caNotices.push({ at: new Date().toISOString(), text: t }); } })
    .observe(document.body, { childList: true, subtree: true }); return "installed"; })()`);

const watchImport = new WriteWatch(setup.mainFile, "a1-import");
const b64 = archive.toString("base64");
const importResult = await cdp.eval(`(async () => {
  const bin = atob(${JSON.stringify(b64)});
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const t0 = performance.now();
  const summary = await app.plugins.plugins["margin-study"].importStudySetBytes(u8.buffer, { mode: "new" });
  return { summary, elapsedMs: Math.round(performance.now() - t0), at: new Date().toISOString() };
})()`);
note("import-resolved", importResult);

// "导入完成后立即读主状态 JSON"：原件逐字节拷走，另做机器可读的核对。
const immediate = readMainState(setup.mainFile);
const immediateCopyPath = path.join(OUT, "import-snapshot.json");
fs.copyFileSync(setup.mainFile, immediateCopyPath);
const watchImportReport = watchImport.stop();
note("import-immediate-read", { ...immediate, copy: immediateCopyPath });

const rendererAfterImport = await cdp.eval(`(() => { const p = app.plugins.plugins["margin-study"], s = p.store;
  const docs = s.documents.map(d => ({ id: d.id, path: d.path, kind: d.kind, byteSize: d.byteSize ?? null,
    sha256: d.sha256 ?? null, missing: !!d.missing }));
  const srs = Object.entries(s.srs ?? {}).map(([id, state]) => ({ questionId: id, due: state.due ?? null,
    lastReviewed: state.lastReviewed ?? null, state: state.state ?? null, interval: state.interval ?? null }));
  return { summaryCounts: { cards: s.cards.length, nodes: s.nodes.length, edges: s.edges.length, studySets: s.studySets.length,
      canvases: s.canvases.length, documents: s.documents.length, reviewStates: Object.keys(s.srs ?? {}).length,
      reviewLogs: (s.reviewLogs || []).length, localEvents: (s.localEvents || []).length },
    documents: docs, srs, revision: s.getRevision(), mainDirty: s.mainDirty, saveTimer: s.saveTimer,
    notices: window.__caNotices || [],
    activeStudySetId: s.activeStudySetId, documentsRegistered: s.documents.length }; })()`);
note("renderer-after-import", { counts: rendererAfterImport.summaryCounts, revision: rendererAfterImport.revision });

// Disk-side verification of document fingerprints against the bytes actually in the vault.
const parsedImmediate = JSON.parse(fs.readFileSync(setup.mainFile, "utf8"));
const documentRows = (parsedImmediate.documents ?? []).map(doc => {
  const abs = path.join(setup.vault, doc.path);
  const exists = fs.existsSync(abs);
  const diskBytes = exists ? fs.readFileSync(abs) : null;
  return {
    id: doc.id, path: doc.path, kind: doc.kind,
    byteSize: doc.byteSize ?? null, sha256: doc.sha256 ?? null, missing: !!doc.missing,
    byteSizeIsPositiveInteger: Number.isSafeInteger(doc.byteSize) && doc.byteSize > 0,
    sha256IsLowerHex64: typeof doc.sha256 === "string" && HEX64_RE.test(doc.sha256),
    fileExistsInVault: exists,
    vaultFileByteSize: diskBytes ? diskBytes.length : null,
    vaultFileSha256: diskBytes ? sha256(diskBytes) : null,
    byteSizeEqualsVaultFile: !!diskBytes && doc.byteSize === diskBytes.length,
    sha256EqualsVaultFile: !!diskBytes && doc.sha256 === sha256(diskBytes),
  };
});
const srsRows = Object.entries(parsedImmediate.srs ?? {}).map(([questionId, state]) => ({
  questionId,
  due: state?.due ?? null, lastReviewed: state?.lastReviewed ?? null,
  dueIsIso: typeof state?.due === "string" && ISO_RE.test(state.due),
  lastReviewedIsIso: typeof state?.lastReviewed === "string" && ISO_RE.test(state.lastReviewed),
  dueIsBareDate: typeof state?.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(state.due),
  lastReviewedIsBareDate: typeof state?.lastReviewed === "string" && /^\d{4}-\d{2}-\d{2}$/.test(state.lastReviewed),
}));
const bare = bareDates(parsedImmediate);
const importCheck = {
  capturedAt: now(),
  archive: { path: fixture.archive, sha256: sha256(archive) },
  fixtureSourceSha256: fixture.entries,
  importCall: { entryPoint: "plugin.importStudySetBytes(bytes, {mode:'new'})", elapsedMs: importResult.elapsedMs, summary: importResult.summary },
  mainStateFile: immediate,
  importWrites: { contentWrites: watchImportReport.contentWrites, touches: watchImportReport.touches, distinctObservations: watchImportReport.distinctObservations, states: watchImportReport.states },
  documents: { count: documentRows.length, rows: documentRows,
    allHavePositiveIntegerByteSize: documentRows.every(row => row.byteSizeIsPositiveInteger),
    allHaveLowerHex64Sha256: documentRows.every(row => row.sha256IsLowerHex64),
    allFingerprintsMatchVaultBytes: documentRows.every(row => row.byteSizeEqualsVaultFile && row.sha256EqualsVaultFile) },
  srs: { entries: srsRows.length, rows: srsRows,
    allNonEmptyDueIso: srsRows.filter(row => row.due).every(row => row.dueIsIso),
    allNonEmptyLastReviewedIso: srsRows.filter(row => row.lastReviewed).every(row => row.lastReviewedIsIso),
    bareDateCount: bare.length, bareDateEntries: bare },
  rendererCounts: rendererAfterImport.summaryCounts,
  rendererNotices: rendererAfterImport.notices,
  rendererRevision: rendererAfterImport.revision,
  preImportMainState: preImportState,
  srsIntentFromFixture: fixture.srsIntent,
};
jsonWrite(path.join(OUT, "import-check.json"), importCheck);

const checkLines = [];
checkLines.push("# Card A · A1 新导入即规范 · 观测原文");
checkLines.push(`# captured at            : ${importCheck.capturedAt}`);
checkLines.push(`# archive                : ${fixture.archive}`);
checkLines.push(`# archive sha256         : ${sha256(archive)}`);
checkLines.push(`# import entry point     : ${importCheck.importCall.entryPoint}`);
checkLines.push(`# import elapsed         : ${importCheck.importCall.elapsedMs} ms`);
checkLines.push(`# import summary         : ${JSON.stringify(importCheck.importCall.summary)}`);
checkLines.push(`# main state file        : revision=${immediate.revision} writerId=${immediate.writerId} savedAt=${immediate.savedAt}`);
checkLines.push(`#                          sha256=${immediate.sha256} size=${immediate.size} mtime=${immediate.mtime}`);
checkLines.push(`#                          localEvents.length=${immediate.localEventsLength}`);
checkLines.push(`# import write watch     : contentWrites=${watchImportReport.contentWrites} touches=${watchImportReport.touches} observations=${watchImportReport.distinctObservations}`);
checkLines.push(`#                          states=${JSON.stringify(watchImportReport.states)}`);
checkLines.push(`# renderer counts        : ${JSON.stringify(importCheck.rendererCounts)}`);
checkLines.push(`# renderer notices       : ${JSON.stringify(importCheck.rendererNotices)}`);
checkLines.push("");
checkLines.push("## 文档登记（documents[]）");
for (const row of documentRows) {
  checkLines.push(`${row.path}  byteSize=${row.byteSize} sha256=${row.sha256}`);
  checkLines.push(`    byteSize 正整数=${row.byteSizeIsPositiveInteger}  sha256 小写hex64=${row.sha256IsLowerHex64}  库内文件存在=${row.fileExistsInVault}`);
  checkLines.push(`    库内文件 byteSize=${row.vaultFileByteSize} sha256=${row.vaultFileSha256}  与登记相等: byteSize=${row.byteSizeEqualsVaultFile} sha256=${row.sha256EqualsVaultFile}`);
}
checkLines.push(`合计文档=${documentRows.length}  全部 byteSize 正整数=${importCheck.documents.allHavePositiveIntegerByteSize}  全部 sha256 小写hex64=${importCheck.documents.allHaveLowerHex64Sha256}  全部与库内字节相等=${importCheck.documents.allFingerprintsMatchVaultBytes}`);
checkLines.push("");
checkLines.push("## 复习调度（srs{}）");
for (const row of srsRows) {
  checkLines.push(`${row.questionId}  due=${row.due}  lastReviewed=${row.lastReviewed}  ISO(due)=${row.dueIsIso}  ISO(lastReviewed)=${row.lastReviewedIsIso}`);
}
checkLines.push(`合计调度=${srsRows.length}  非空 due 全 ISO=${importCheck.srs.allNonEmptyDueIso}  非空 lastReviewed 全 ISO=${importCheck.srs.allNonEmptyLastReviewedIso}`);
checkLines.push(`裸 YYYY-MM-DD 数量 = ${importCheck.srs.bareDateCount}  ${JSON.stringify(importCheck.srs.bareDateEntries)}`);
checkLines.push("");
checkLines.push("## 导入前主状态（同一启动内的基线）");
checkLines.push(JSON.stringify(preImportState, null, 2));
checkLines.push("");
fs.writeFileSync(path.join(OUT, "import-check.txt"), checkLines.join("\n") + "\n");

// ---------- A2: cold restart of the just-imported library ----------
const settledAfterImport = await settle(cdp, setup.mainFile, { quietMs: 5000 });
note("settled-after-import", settledAfterImport);
const beforeState = readMainState(setup.mainFile);
const beforeCopy = path.join(OUT, "cold-restart-new-before.json");
fs.copyFileSync(setup.mainFile, beforeCopy);

cdp.close();
const exited1 = await quitObsidian(run.pid);
const afterQuitState = readMainState(setup.mainFile);
note("quit-1", { exited: exited1, afterQuit: afterQuitState });
const quitDelta = sixDiff(beforeState, afterQuitState);

// Write watch starts before the new process exists, so every startup write is observed.
const watchCold = new WriteWatch(setup.mainFile, "a2-cold-restart");
const relaunchStartedAt = now();
const second = await bringUp(ROOT, "a2-cold-restart");
const bundleAtCold = await runtimeBundleEvidence(second.cdp, setup, MANIFEST);
note("bundle-at-cold", { installedEqualsBuildManifest: bundleAtCold.installedEqualsBuildManifest,
  storeSourceIsCardABuild: bundleAtCold.probe.storeSourceIsCardABuild, rendererPid: bundleAtCold.probe.rendererPid,
  obsidianVersion: bundleAtCold.probe.obsidianVersion, removedAsar: second.removedAsar, trustClicked: !!second.trust });
const settledCold = await settle(second.cdp, setup.mainFile, { quietMs: 5000 });
const afterState = readMainState(setup.mainFile);
const afterCopy = path.join(OUT, "cold-restart-new-after.json");
fs.copyFileSync(setup.mainFile, afterCopy);
const watchColdReport = watchCold.stop();
note("cold-restart", { relaunchStartedAt, settledCold, afterState, watch: { contentWrites: watchColdReport.contentWrites, touches: watchColdReport.touches, states: watchColdReport.states } });
second.cdp.close();
const exited2 = await quitObsidian(second.run.pid);

const diff = sixDiff(beforeState, afterState);
const beforeJson = JSON.parse(fs.readFileSync(beforeCopy, "utf8"));
const afterJson = JSON.parse(fs.readFileSync(afterCopy, "utf8"));
const bodyEqual = JSON.stringify(beforeJson) === JSON.stringify(afterJson);
const diffReport = {
  capturedAt: now(),
  scenario: "A2 新导入库首次冷重启",
  library: { root: ROOT, vault: setup.vault, mainStateFile: setup.mainFile },
  timeline: {
    importResolvedAt: importResult.at,
    settledAfterImport,
    beforeColdRestart: beforeState,
    firstHost: { pid: run.pid, rendererPid: bundleAtA1.probe.rendererPid, exited: exited1,
      obsidianVersion: bundleAtA1.probe.obsidianVersion, windowTitle: bundleAtA1.probe.windowTitle,
      asarRemovedBeforeLaunch: first.removedAsar },
    quitDeltaSix: quitDelta,
    postQuitState: afterQuitState,
    relaunchStartedAt,
    secondHost: { pid: second.run.pid, pidRenderer: bundleAtCold.probe.rendererPid, exited: exited2,
      trustPromptAccepted: !!second.trust, obsidianVersion: bundleAtCold.probe.obsidianVersion,
      windowTitle: bundleAtCold.probe.windowTitle, asarRemovedBeforeLaunch: second.removedAsar },
    settledAfterColdRestart: settledCold,
    afterColdRestart: afterState,
  },
  sixFieldComparison: diff,
  writeWatch: { beforeRelaunch: { contentWrites: watchColdReport.contentWrites, touches: watchColdReport.touches, distinctObservations: watchColdReport.distinctObservations,
      states: watchColdReport.states, rawFsEventCount: watchColdReport.rawFsEventCount, startedAt: watchColdReport.startedAt } },
  serializedBodyIdentical: bodyEqual,
  bodySha256: { before: shaFile(beforeCopy), after: shaFile(afterCopy), immediateAfterImport: immediate.sha256 },
  bundles: { atA1: { installedEqualsBuildManifest: bundleAtA1.installedEqualsBuildManifest, installed: bundleAtA1.installed },
    atColdRestart: { installedEqualsBuildManifest: bundleAtCold.installedEqualsBuildManifest, installed: bundleAtCold.installed } },
};
jsonWrite(path.join(OUT, "cold-restart-new-diff.json"), diffReport);
console.log(JSON.stringify({ sixFieldComparison: diff, contentWrites: watchColdReport.contentWrites, touches: watchColdReport.touches, bodyEqual,
  before: { sha: beforeState.sha256, mtimeMs: beforeState.mtimeMs, revision: beforeState.revision, savedAt: beforeState.savedAt, events: beforeState.localEventsLength },
  after: { sha: afterState.sha256, mtimeMs: afterState.mtimeMs, revision: afterState.revision, savedAt: afterState.savedAt, events: afterState.localEventsLength },
  quitDeltaAllSixEqual: quitDelta.allSixEqual, quitDeltaRevision: quitDelta.revisionDelta }, null, 2));
