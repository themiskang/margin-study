// Card A · A3 re-do, scenario 1 (main): real old-build library -> new build cold start #1 and #2.
// Observed facts only, no verdicts.
// usage: node a3r-scenario1.mjs
import fs from "node:fs";
import path from "node:path";
import {
  NEW_BUILD, OUT_ROOT, OLD_MAIN_JS, coldStart, jsonWrite, note, now, prepareScenario, requireNewBuild, shaFile, sixDiff,
} from "./a3r-scenario-common.mjs";

const OUT = path.join(OUT_ROOT, "scenario-1");
const ROOT = "/tmp/a3r-s1";
fs.mkdirSync(OUT, { recursive: true });
process.env.CA_STEPS_LOG = path.join(OUT, "steps.log");
fs.writeFileSync(process.env.CA_STEPS_LOG, "");

// old-library production evidence (from a3r-old-import.mjs) travels with the scenario.
const oldImportEvidence = path.join(OUT, "legacy-library");
fs.mkdirSync(oldImportEvidence, { recursive: true });
for (const name of ["old-import.json", "old-import-steps.log", "old-import-after.png", "L0-data.json", "L0-data-after-quit.json"]) {
  const from = path.join("/tmp/a3r-out-old", name);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(oldImportEvidence, name.replace("L0-data", "L0-original")));
}
const buildOldHashes = {};
for (const name of ["main.js", "manifest.json", "styles.css", "pdf.worker.js"]) {
  const file = path.join(OUT_ROOT, "build-old", name);
  buildOldHashes[name] = { file, sha256: shaFile(file), size: fs.statSync(file).size };
}

const newBuild = requireNewBuild();
note("new-build-verified", { mainJs: newBuild.rows["main.js"].actual, allEqualManifest: newBuild.allEqual });
const { setup, l0 } = prepareScenario({ root: ROOT, outDir: OUT, scenarioName: "scenario-1 · 真旧库冷启#1/#2" });

const c1 = await coldStart({ setup, outDir: OUT, index: 1 });
const c2 = await coldStart({ setup, outDir: OUT, index: 2 });

const c1AfterVsC2Before = sixDiff(c1.after.realFile, c2.before.realFile);
const c1AfterVsC2After = sixDiff(c1.after.realFile, c2.after.realFile);
const c2BeforeVsC2After = c2.six;

const summary = {
  capturedAt: now(),
  scenario: "scenario-1 · 旧构建真实导入库（真旧库）→ 新构建冷启#1 / 冷启#2",
  judgedInThisScenario: [
    "冷启#1：data.json 写盘次数；documents 指纹是否补齐；srs 裸 YYYY-MM-DD 是否转 ISO（裸日期计数）",
    "冷启#2：data.json 写盘次数；revision 差值；六项（sha256/mtimeMs/revision/writerId/savedAt/localEvents.length）是否全等",
  ],
  builds: {
    old: { commit: "f78573e8b5f5660bdf19af26fc9fd0ac75cd14db", worktree: "/tmp/card-a-old", mainJs: OLD_MAIN_JS,
      artifacts: buildOldHashes, evidence: "a3-legacy-real/build-old/" },
    new: { commit: NEW_BUILD.commit, buildDir: NEW_BUILD.buildDir, mainJs: newBuild.rows["main.js"].actual,
      artifacts: newBuild.rows, manifestFile: NEW_BUILD.manifestFile },
  },
  library: {
    origin: "由旧构建 44c324b8 在全新隔离宿主真实导入产出的库；非脚本构造 JSON、非当前工作树构建",
    producedAt: "2026-11-21T05:51:34.845Z（旧构建会话 obsidian 1.12.7，真实导入入口 plugin.importStudySetBytes）",
    L0: { dataSha256: l0.dataSha256, dataSize: l0.dataSize, vaultFileCount: l0.vaultFileCount,
      original: "legacy-library/data.json", report: "legacy-library/legacy-library.json",
      oldImportReport: "legacy-library/old-import.json" },
    hostRoot: setup.root, vault: setup.vault, mainStateFile: setup.mainFile,
    copiedFrom: setup.copiedFrom,
    installedBundleAtSwap: setup.installed,
  },
  coldStart1: {
    dataJsonBefore: c1.before.realFile, dataJsonAfter: c1.after.realFile, six: c1.six,
    writeWatch: { contentWrites: c1.writeWatch.contentWrites, touches: c1.writeWatch.touches,
      distinctObservations: c1.writeWatch.distinctObservations, rawFsEventCount: c1.writeWatch.rawFsEventCount,
      states: c1.writeWatch.states },
    stateAfter: { documentsAllFingerprinted: c1.inspection.body.documentsAllFingerprinted,
      documentsWithoutFingerprint: c1.inspection.body.documentsWithoutFingerprint,
      bareDateCount: c1.inspection.body.bareDateCount, revision: c1.inspection.body.revision,
      chars: c1.inspection.body.documents.map(doc => ({ path: doc.path, byteSize: doc.byteSize, sha256: doc.sha256,
        byteSizeEqualsVaultFile: doc.byteSizeEqualsVaultFile, sha256EqualsVaultFile: doc.sha256EqualsVaultFile,
        byteSizePresent: doc.byteSizePresent, sha256Present: doc.sha256Present })),
      srs: c1.inspection.body.srs.map(row => ({ questionId: row.questionId, due: row.due, lastReviewed: row.lastReviewed,
        dueIsIso: row.dueIsIso, lastReviewedIsIso: row.lastReviewedIsIso })),
      localEventKinds: c1.inspection.body.localEventKinds, localEventTail: c1.inspection.body.localEventTail },
    session: { hostPid: c1.session.hostPid, rendererPid: c1.session.rendererPid, obsidianVersion: c1.session.bundle?.probe?.obsidianVersion,
      trustClicked: !!c1.session.trust, removedAsar: c1.session.removedAsar, pluginLoaded: c1.session.pluginLoaded,
      settle: c1.session.settle, notices: c1.session.notices, errors: c1.session.errors.length,
      screenshot: c1.session.screenshot, quitExited: c1.session.quitExited, portReleased: c1.session.portReleased },
    vaultTreeDiff: c1.vault.diff, backupDirsAdded: c1.backup.addedDirs,
  },
  coldStart2: {
    dataJsonBefore: c2.before.realFile, dataJsonAfter: c2.after.realFile, six: c2.six,
    writeWatch: { contentWrites: c2.writeWatch.contentWrites, touches: c2.writeWatch.touches,
      distinctObservations: c2.writeWatch.distinctObservations, rawFsEventCount: c2.writeWatch.rawFsEventCount,
      states: c2.writeWatch.states },
    session: { hostPid: c2.session.hostPid, rendererPid: c2.session.rendererPid, obsidianVersion: c2.session.bundle?.probe?.obsidianVersion,
      trustClicked: !!c2.session.trust, removedAsar: c2.session.removedAsar, pluginLoaded: c2.session.pluginLoaded,
      settle: c2.session.settle, notices: c2.session.notices, errors: c2.session.errors.length,
      screenshot: c2.session.screenshot, quitExited: c2.session.quitExited, portReleased: c2.session.portReleased },
    stateAfter: { documentsAllFingerprinted: c2.inspection.body.documentsAllFingerprinted,
      bareDateCount: c2.inspection.body.bareDateCount, revision: c2.inspection.body.revision,
      localEventKinds: c2.inspection.body.localEventKinds },
    vaultTreeDiff: c2.vault.diff, backupDirsAdded: c2.backup.addedDirs,
  },
  comparisons: {
    c1AfterVsC2Before: { allSixEqual: c1AfterVsC2Before.allSixEqual, revisionDelta: c1AfterVsC2Before.revisionDelta,
      sha256Equal: c1.after.realFile.sha256 === c2.before.realFile.sha256, fields: c1AfterVsC2Before.fields },
    c1AfterVsC2After: { allSixEqual: c1AfterVsC2After.allSixEqual, revisionDelta: c1AfterVsC2After.revisionDelta, fields: c1AfterVsC2After.fields },
    c2BeforeVsC2After: { allSixEqual: c2BeforeVsC2After.allSixEqual, revisionDelta: c2BeforeVsC2After.revisionDelta,
      localEventsDelta: c2BeforeVsC2After.localEventsDelta, fields: c2BeforeVsC2After.fields },
  },
  originals: { c1Before: "c1-before.json", c1After: "c1-after.json", c2Before: "c2-before.json", c2After: "c2-after.json",
    legacyLibrary: "legacy-library/data.json" },
};
jsonWrite(path.join(OUT, "report.json"), summary);

const key = {
  scenario: 1,
  oldBuildMainJs: OLD_MAIN_JS,
  newBuildMainJs: newBuild.rows["main.js"].actual,
  legacyLibrary: { mainJsUsed: OLD_MAIN_JS, dataSha256: l0.dataSha256, revision: 2, schemaVersion: 3,
    documentsWithoutFingerprintCount: 3, bareDateCount: 6 },
  coldStart1: { contentWrites: c1.writeWatch.contentWrites, touches: c1.writeWatch.touches, revisionDelta: c1.six.revisionDelta,
    documentsAllFingerprinted: c1.inspection.body.documentsAllFingerprinted, bareDateCount: c1.inspection.body.bareDateCount,
    revisionAfter: c1.after.realFile.revision, backupDirsAdded: c1.backup.addedDirs, vaultFilesAdded: c1.vault.diff.added.map(row => row.path) },
  coldStart2: { contentWrites: c2.writeWatch.contentWrites, touches: c2.writeWatch.touches, revisionDelta: c2.six.revisionDelta,
    allSixEqual: c2.six.allSixEqual, localEventsDelta: c2.six.localEventsDelta, revision: c2.after.realFile.revision,
    backupDirsAdded: c2.backup.addedDirs, vaultFilesAdded: c2.vault.diff.added.map(row => row.path) },
  coldStart1VsColdStart2After: { allSixEqual: c1AfterVsC2After.allSixEqual, revisionDelta: c1AfterVsC2After.revisionDelta },
};
jsonWrite(path.join(OUT, "key-numbers.json"), key);
console.log(JSON.stringify(key, null, 2));