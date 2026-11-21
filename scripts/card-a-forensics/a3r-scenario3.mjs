// Card A · A3 re-do, scenario 3: source file missing / moved / unreadable (mixed), cold started twice.
// Two sub-cases, both on descendants of the same real old library:
//   A. unfingerprinted/   L0 as the old build left it (documents carry no sha256/byteSize),
//                          three sources broken before the first new-build load.
//   B. after-upgrade/     L0 after one new-build load (fingerprints present = the state a user's
//                          old library is in when the sources break later), then the same three
//                          breaks, then two observed cold starts.
// usage: node a3r-scenario3.mjs
import fs from "node:fs";
import path from "node:path";
import {
  NEW_BUILD, OUT_ROOT, OLD_MAIN_JS, coldStart, inspectFile, jsonWrite, note, now, prepareScenario,
  readMainState, requireNewBuild, sha256, shaFile, sixDiff, treeDiff, treeSnapshot, writeLegacyLibrary,
} from "./a3r-scenario-common.mjs";

const OUT = path.join(OUT_ROOT, "scenario-3");
fs.mkdirSync(OUT, { recursive: true });
process.env.CA_STEPS_LOG = path.join(OUT, "steps.log");
fs.writeFileSync(process.env.CA_STEPS_LOG, "");

const DOC_MISSING = "a3-old-01.pdf";
const DOC_MOVED = "a3-old-02.pdf";
const DOC_MOVED_TO = "sources-moved/a3-old-02.pdf";
const DOC_UNREADABLE = "a3-old-03.msref";

const newBuild = requireNewBuild();
note("new-build-verified", { mainJs: newBuild.rows["main.js"].actual, allEqualManifest: newBuild.allEqual });
// The L0 original travels with this scenario dir, once for both sub-cases.
writeLegacyLibrary(OUT, "scenario-3 · 源文件缺失/已移动/不可读（子案 A 直接用 L0；子案 B 在 L0 上先做一次新构建冷启）");
note("legacy-library-archived", { dir: path.join(OUT, "legacy-library") });

/** Real (non-plugin) file operations in the vault, recorded before/after. */
function breakSources(vault, tag) {
  const state = (rel) => {
    const abs = path.join(vault, rel);
    if (!fs.existsSync(abs)) return { path: rel, exists: false };
    const stat = fs.statSync(abs);
    let readable = true, digest = null, readError = null;
    try { digest = shaFile(abs); } catch (error) { readable = false; readError = String(error); }
    return { path: rel, exists: true, size: stat.size, mode: "0" + (stat.mode & 0o777).toString(8), readable, sha256: digest, readError };
  };
  const before = { missing: state(DOC_MISSING), moved: state(DOC_MOVED), movedTarget: state(DOC_MOVED_TO), unreadable: state(DOC_UNREADABLE) };
  fs.rmSync(path.join(vault, DOC_MISSING), { force: true });
  fs.mkdirSync(path.join(vault, "sources-moved"), { recursive: true });
  fs.renameSync(path.join(vault, DOC_MOVED), path.join(vault, DOC_MOVED_TO));
  fs.chmodSync(path.join(vault, DOC_UNREADABLE), 0o000);
  const after = { missing: state(DOC_MISSING), moved: state(DOC_MOVED), movedTarget: state(DOC_MOVED_TO), unreadable: state(DOC_UNREADABLE) };
  const record = { tag, at: now(), operations: [
      { op: "delete", path: DOC_MISSING, result: before.missing.exists && !after.missing.exists ? "deleted" : "unexpected" },
      { op: "move", from: DOC_MOVED, to: DOC_MOVED_TO, byteIdentical: before.moved.sha256 === after.movedTarget.sha256, fromGone: !after.moved.exists },
      { op: "chmod 000", path: DOC_UNREADABLE, modeBefore: before.unreadable.mode, modeAfter: after.unreadable.mode,
        readableBefore: before.unreadable.readable, readableAfter: after.unreadable.readable, readErrorAfter: after.unreadable.readError },
    ], before, after };
  note("break-sources", { tag, operations: record.operations });
  return record;
}

const subCases = {};

// ---------- A. unfingerprinted ----------
{
  const dir = path.join(OUT, "unfingerprinted");
  fs.mkdirSync(dir, { recursive: true });
  const { setup, l0 } = prepareScenario({ root: "/tmp/a3r-s3a", outDir: dir, scenarioName: "scenario-3A · 未回填指纹的旧库 + 三种来源异常", writeLegacyLibrary: false });
  note("s3a-host", { vault: setup.vault, copiedFrom: setup.copiedFrom });
  const beforeOps = inspectFile(setup.mainFile, setup.vault);
  const fileOps = breakSources(setup.vault, "3A");
  const c1 = await coldStart({ setup, outDir: dir, index: 1, quietMs: 8000, holdMs: 8000 });
  const c2 = await coldStart({ setup, outDir: dir, index: 2, quietMs: 8000, holdMs: 4000 });
  fs.chmodSync(path.join(setup.vault, DOC_UNREADABLE), 0o644);
  const fileOpsCopy = { ...fileOps, restoredModeAtEnd: "0644", note: "chmod 000 在两次冷启动观察结束后恢复为 0644，仅清理本次取证宿主 /tmp" };
  jsonWrite(path.join(dir, "file-operations.json"), { before: { documents: beforeOps.body.documents }, ...fileOpsCopy });
  subCases.A = {
    dir: "unfingerprinted/", hostRoot: setup.root, vault: setup.vault,
    libraryStart: { dataSha256: l0.dataSha256, documentsWithoutFingerprint: beforeOps.body.documentsWithoutFingerprint,
      documentsAllFingerprinted: beforeOps.body.documentsAllFingerprinted, bareDateCount: beforeOps.body.bareDateCount },
    fileOperations: fileOpsCopy,
    coldStart1: { writeWatch: { contentWrites: c1.writeWatch.contentWrites, touches: c1.writeWatch.touches, states: c1.writeWatch.states },
      six: c1.six, documents: c1.inspection.body.documents.map(doc => ({ path: doc.path, missing: doc.missing, byteSizePresent: doc.byteSizePresent,
        sha256Present: doc.sha256Present, fileExistsInVault: doc.fileExistsInVault, marketReadError: doc.marketReadError })),
      missingDocuments: c1.inspection.body.missingDocuments, localEventKinds: c1.inspection.body.localEventKinds,
      localEventTail: c1.inspection.body.localEventTail, notices: c1.session.notices, promptSurfaces: c1.session.promptSurfaces,
      errors: c1.session.errors, observationHold: c1.session.observationHold, settle: c1.session.settle,
      vaultTreeDiff: c1.vault.diff, backupDirsAdded: c1.backup.addedDirs, screenshot: c1.session.screenshot,
      hostPid: c1.session.hostPid, rendererPid: c1.session.rendererPid, obsidianVersion: c1.session.bundle?.probe?.obsidianVersion,
      trustClicked: !!c1.session.trust, pluginLoaded: c1.session.pluginLoaded, removedAsar: c1.session.removedAsar, quitExited: c1.session.quitExited },
    coldStart2: { writeWatch: { contentWrites: c2.writeWatch.contentWrites, touches: c2.writeWatch.touches, states: c2.writeWatch.states },
      six: c2.six, documents: c2.inspection.body.documents.map(doc => ({ path: doc.path, missing: doc.missing,
        byteSizePresent: doc.byteSizePresent, sha256Present: doc.sha256Present, fileExistsInVault: doc.fileExistsInVault })),
      missingDocuments: c2.inspection.body.missingDocuments, notices: c2.session.notices, promptSurfaces: c2.session.promptSurfaces,
      errors: c2.session.errors, observationHold: c2.session.observationHold, settle: c2.session.settle,
      vaultTreeDiff: c2.vault.diff, backupDirsAdded: c2.backup.addedDirs, screenshot: c2.session.screenshot,
      hostPid: c2.session.hostPid, rendererPid: c2.session.rendererPid, trustClicked: !!c2.session.trust,
      pluginLoaded: c2.session.pluginLoaded, removedAsar: c2.session.removedAsar, quitExited: c2.session.quitExited },
  };
}

// ---------- B. after one upgrade load ----------
{
  const dir = path.join(OUT, "after-upgrade");
  fs.mkdirSync(dir, { recursive: true });
  const { setup, l0 } = prepareScenario({ root: "/tmp/a3r-s3b", outDir: dir, scenarioName: "scenario-3B · 已回填指纹的旧库 + 三种来源异常", writeLegacyLibrary: false });
  note("s3b-host", { vault: setup.vault, copiedFrom: setup.copiedFrom });
  const upgrade = await coldStart({ setup, outDir: dir, index: 0, quietMs: 8000 });
  const fingerprintState = inspectFile(setup.mainFile, setup.vault);
  const fileOps = breakSources(setup.vault, "3B");
  const c1 = await coldStart({ setup, outDir: dir, index: 1, quietMs: 8000, holdMs: 8000 });
  const c2 = await coldStart({ setup, outDir: dir, index: 2, quietMs: 8000, holdMs: 4000 });
  fs.chmodSync(path.join(setup.vault, DOC_UNREADABLE), 0o644);
  const fileOpsCopy = { ...fileOps, restoredModeAtEnd: "0644", note: "chmod 000 在两次冷启动观察结束后恢复为 0644，仅清理本次取证宿主 /tmp" };
  jsonWrite(path.join(dir, "file-operations.json"), { beforeUpgradeLoad: { documents: fingerprintState.body.documents }, ...fileOpsCopy });
  subCases.B = {
    dir: "after-upgrade/", hostRoot: setup.root, vault: setup.vault,
    libraryStart: { dataSha256: l0.dataSha256 },
    upgradeColdStart: { tag: upgrade.tag, writeWatch: { contentWrites: upgrade.writeWatch.contentWrites, states: upgrade.writeWatch.states },
      six: upgrade.six, documentsAllFingerprinted: fingerprintState.body.documentsAllFingerprinted,
      bareDateCount: fingerprintState.body.bareDateCount, revision: fingerprintState.body.revision,
      quitExited: upgrade.session.quitExited, screenshot: upgrade.session.screenshot },
    fileOperations: fileOpsCopy,
    coldStart1: { writeWatch: { contentWrites: c1.writeWatch.contentWrites, touches: c1.writeWatch.touches, states: c1.writeWatch.states },
      six: c1.six, documents: c1.inspection.body.documents.map(doc => ({ path: doc.path, missing: doc.missing,
        byteSizePresent: doc.byteSizePresent, sha256Present: doc.sha256Present, fileExistsInVault: doc.fileExistsInVault,
        vaultFileSha256: doc.vaultFileSha256, sha256EqualsVaultFile: doc.sha256EqualsVaultFile, marketReadError: doc.marketReadError })),
      missingDocuments: c1.inspection.body.missingDocuments, localEventKinds: c1.inspection.body.localEventKinds,
      localEventTail: c1.inspection.body.localEventTail, notices: c1.session.notices, promptSurfaces: c1.session.promptSurfaces,
      errors: c1.session.errors, observationHold: c1.session.observationHold, settle: c1.session.settle,
      vaultTreeDiff: c1.vault.diff, backupDirsAdded: c1.backup.addedDirs, screenshot: c1.session.screenshot,
      hostPid: c1.session.hostPid, rendererPid: c1.session.rendererPid, obsidianVersion: c1.session.bundle?.probe?.obsidianVersion,
      trustClicked: !!c1.session.trust, pluginLoaded: c1.session.pluginLoaded, removedAsar: c1.session.removedAsar, quitExited: c1.session.quitExited },
    coldStart2: { writeWatch: { contentWrites: c2.writeWatch.contentWrites, touches: c2.writeWatch.touches, states: c2.writeWatch.states },
      six: c2.six, documents: c2.inspection.body.documents.map(doc => ({ path: doc.path, missing: doc.missing,
        byteSizePresent: doc.byteSizePresent, sha256Present: doc.sha256Present, fileExistsInVault: doc.fileExistsInVault })),
      missingDocuments: c2.inspection.body.missingDocuments, notices: c2.session.notices, promptSurfaces: c2.session.promptSurfaces,
      errors: c2.session.errors, observationHold: c2.session.observationHold, settle: c2.session.settle,
      vaultTreeDiff: c2.vault.diff, backupDirsAdded: c2.backup.addedDirs, screenshot: c2.session.screenshot,
      hostPid: c2.session.hostPid, rendererPid: c2.session.rendererPid, trustClicked: !!c2.session.trust,
      pluginLoaded: c2.session.pluginLoaded, removedAsar: c2.session.removedAsar, quitExited: c2.session.quitExited },
  };
}

const report = {
  capturedAt: now(),
  scenario: "scenario-3 · 源文件缺失 / 已移动 / 不可读（混合）",
  judgedInThisScenario: [
    "冷启#1 不崩、不无限重试（插件加载、settle 静默、额外 8 s 静默观察、Notice 不再增长）",
    "冷启#2 写盘 = 0、revision 差值 0",
    "三种来源异常各自记录插件行为原文：missing 标记、异常、Notice",
  ],
  builds: { old: { commit: "f78573e8b5f5660bdf19af26fc9fd0ac75cd14db", mainJs: OLD_MAIN_JS },
    new: { commit: NEW_BUILD.commit, mainJs: newBuild.rows["main.js"].actual, artifacts: newBuild.rows } },
  legacyLibrary: { original: "legacy-library/data.json", report: "legacy-library/legacy-library.json",
    note: "两个子案都从同一 L0 复制出来；A 直接用 L0，B 先在 L0 上跑一次新构建冷启（回填指纹）再制造三种异常" },
  subCases,
};
jsonWrite(path.join(OUT, "report.json"), report);

const key = {
  scenario: 3,
  oldBuildMainJs: OLD_MAIN_JS,
  newBuildMainJs: newBuild.rows["main.js"].actual,
  A_unfingerprinted: {
    libraryStart: subCases.A.libraryStart,
    fileOperations: subCases.A.fileOperations.operations,
    coldStart1: { contentWrites: subCases.A.coldStart1.writeWatch.contentWrites, revisionDelta: subCases.A.coldStart1.six.revisionDelta,
      missingDocuments: subCases.A.coldStart1.missingDocuments, notices: subCases.A.coldStart1.notices.map(row => row.text),
      promptSurfaces: subCases.A.coldStart1.promptSurfaces, errors: subCases.A.coldStart1.errors.length,
      holdIdentical: subCases.A.coldStart1.observationHold?.identical, documents: subCases.A.coldStart1.documents },
    coldStart2: { contentWrites: subCases.A.coldStart2.writeWatch.contentWrites, revisionDelta: subCases.A.coldStart2.six.revisionDelta,
      allSixEqual: subCases.A.coldStart2.six.allSixEqual, missingDocuments: subCases.A.coldStart2.missingDocuments,
      notices: subCases.A.coldStart2.notices.map(row => row.text), promptSurfaces: subCases.A.coldStart2.promptSurfaces },
  },
  B_afterUpgrade: {
    upgradeColdStart: { contentWrites: subCases.B.upgradeColdStart.writeWatch.contentWrites,
      documentsAllFingerprinted: subCases.B.upgradeColdStart.documentsAllFingerprinted, bareDateCount: subCases.B.upgradeColdStart.bareDateCount },
    fileOperations: subCases.B.fileOperations.operations,
    coldStart1: { contentWrites: subCases.B.coldStart1.writeWatch.contentWrites, revisionDelta: subCases.B.coldStart1.six.revisionDelta,
      localEventsDelta: subCases.B.coldStart1.six.localEventsDelta,
      missingDocuments: subCases.B.coldStart1.missingDocuments, localEventTail: subCases.B.coldStart1.localEventTail,
      notices: subCases.B.coldStart1.notices.map(row => row.text), promptSurfaces: subCases.B.coldStart1.promptSurfaces,
      errors: subCases.B.coldStart1.errors.length, holdIdentical: subCases.B.coldStart1.observationHold?.identical,
      documents: subCases.B.coldStart1.documents, vaultAdded: subCases.B.coldStart1.vaultTreeDiff.added },
    coldStart2: { contentWrites: subCases.B.coldStart2.writeWatch.contentWrites, revisionDelta: subCases.B.coldStart2.six.revisionDelta,
      allSixEqual: subCases.B.coldStart2.six.allSixEqual, missingDocuments: subCases.B.coldStart2.missingDocuments,
      notices: subCases.B.coldStart2.notices.map(row => row.text), promptSurfaces: subCases.B.coldStart2.promptSurfaces,
      documents: subCases.B.coldStart2.documents },
  },
};
jsonWrite(path.join(OUT, "key-numbers.json"), key);
console.log(JSON.stringify(key, null, 2));