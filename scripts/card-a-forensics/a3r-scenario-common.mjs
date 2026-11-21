// Card A · A3 re-do shared scenario driver: start from the real old library (L0 vault copy),
// swap in the new build, run observed cold starts, keep originals + six-field metrics.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  BUNDLE, backupTree, inspectFile, jsonWrite, keepOriginal, note, now, readMainState, requireBundle,
  session, sha256, shaFile, sixDiff, treeDiff, treeSnapshot, WriteWatchVault,
} from "./a3r-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../..");
export const NEW_BUILD = {
  commit: "f1366fcb2aaeee917bda7a68b54f0013000c0f4e",
  buildDir: path.join(REPO, "evidence/card-A/exec/build"),
  manifestFile: path.join(REPO, "evidence/card-A/exec/build-manifest.json"),
  mainJs: "9cd732cf4896563de68bd761fafbd068b5804f7f1229ad38f0e4d8ee359f94a4",
};
export const OLD_MAIN_JS = "44c324b80b75311c5d9aa35c62071541d31bce548fb32a3ffaf3c83e0acba2ea";
export const L0_VAULT = "/tmp/a3r-L0/vault";
export const L0_DATA = path.join(L0_VAULT, ".obsidian/plugins/margin-study/data.json");
export const OUT_ROOT = path.join(REPO, "evidence/card-A/forensics/a3-legacy-real");

/** Refuse to load any new build other than the pinned one. */
export function requireNewBuild() {
  const manifest = JSON.parse(fs.readFileSync(NEW_BUILD.manifestFile, "utf8"));
  const rows = {};
  for (const name of BUNDLE) {
    const file = path.join(NEW_BUILD.buildDir, name);
    const actual = shaFile(file);
    rows[name] = { file, actual, expectedManifest: manifest.artifacts[name] ?? null, equalsManifest: actual === (manifest.artifacts[name] ?? null) };
  }
  if (rows["main.js"].actual !== NEW_BUILD.mainJs) throw new Error(`new build main.js mismatch: ${rows["main.js"].actual} != ${NEW_BUILD.mainJs}`);
  if (BUNDLE.some(name => !rows[name].equalsManifest)) throw new Error("new build does not equal its build manifest: " + JSON.stringify(rows, null, 1));
  return { manifest, rows, allEqual: true };
}

/** Archive the L0 data.json original plus its provenance into <outDir>/legacy-library/. */
export function writeLegacyLibrary(outDir, scenarioName) {
  const l0 = {
    vault: L0_VAULT, dataFile: L0_DATA, dataSha256: shaFile(L0_DATA), dataSize: fs.statSync(L0_DATA).size,
    vaultFileCount: Object.keys(treeSnapshot(L0_VAULT)).length,
  };
  if (l0.dataSha256 !== "7dcad826d37d45558fea14f6866f67ea17a75b601a8b99ab4f54437e79814b05")
    throw new Error("L0 data.json is not the one captured by a3r-old-import: " + l0.dataSha256);
  const legacyDir = path.join(outDir, "legacy-library");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.copyFileSync(L0_DATA, path.join(legacyDir, "data.json"));
  jsonWrite(path.join(legacyDir, "legacy-library.json"), {
    scenario: scenarioName,
    capturedAt: now(),
    source: {
      producedBy: "old build (commit f78573e, main.js " + OLD_MAIN_JS + ")",
      oldBuildEvidence: "a3-legacy-real/build-old/, old-import evidence in a3-legacy-real/scenario-1/legacy-library/old-import.json",
      producedAt: "2026-11-21T05:51:34.845Z",
      vaultCopyAtTimeOfRun: L0_VAULT,
    },
    dataJson: { file: "data.json", sha256: l0.dataSha256, size: l0.dataSize },
    inspection: inspectFile(L0_DATA, L0_VAULT),
    vaultFileCount: l0.vaultFileCount,
  });
  return l0;
}

/**
 * Build one scenario host from the L0 vault copy and install the new build.
 * Also archives the L0 data.json original inside the scenario dir.
 */
export function prepareScenario({ root, outDir, scenarioName, writeLegacyLibrary: withLegacy = true }) {
  fs.mkdirSync(outDir, { recursive: true });
  const l0 = { vault: L0_VAULT, dataFile: L0_DATA, dataSha256: shaFile(L0_DATA), dataSize: fs.statSync(L0_DATA).size,
    vaultFileCount: Object.keys(treeSnapshot(L0_VAULT)).length };
  const legacyDir = path.join(outDir, "legacy-library");
  if (withLegacy) writeLegacyLibrary(outDir, scenarioName);

  const setup = JSON.parse(execFileSync(process.execPath, [path.join(HERE, "a3r-host.mjs"), root, NEW_BUILD.buildDir, L0_VAULT],
    { encoding: "utf8" }).trim());
  const pinned = requireBundle(setup, { "main.js": NEW_BUILD.mainJs }, "new build install");
  note("scenario-host", { root, vault: setup.vault, installed: setup.installed, copiedFrom: setup.copiedFrom, pinned });
  const copiedData = shaFile(setup.mainFile);
  if (copiedData !== l0.dataSha256) throw new Error("vault copy data.json changed: " + copiedData);
  return { setup, l0, legacyDir, pinned };
}

/** One observed cold start with pre/post originals, write watch and vault-tree diff. */
export async function coldStart({ setup, outDir, index, quietMs = 6000, holdMs = 0, extraVaultOps = null }) {
  const tag = `c${index}`;
  process.env.CA_STEPS_LOG = process.env.CA_STEPS_LOG || path.join(outDir, "steps.log");
  if (extraVaultOps) await extraVaultOps();
  const before = readMainState(setup.mainFile);
  const beforeOriginal = keepOriginal(setup.mainFile, path.join(outDir, `${tag}-before.json`));
  const vaultBefore = treeSnapshot(setup.vault);
  const backupsBefore = backupTree(setup.vault);
  const watch = new WriteWatchVault(setup.mainFile, tag, setup.vault);
  const { record } = await session({ root: setup.root, stage: tag, setup, outDir, quietMs, holdMs });
  const watchReport = watch.stop();
  const after = readMainState(setup.mainFile);
  const afterOriginal = keepOriginal(setup.mainFile, path.join(outDir, `${tag}-after.json`));
  const vaultAfter = treeSnapshot(setup.vault);
  const backupsAfter = backupTree(setup.vault);
  const inspector = inspectFile(setup.mainFile, setup.vault);
  const diff = sixDiff(before, after);
  const result = {
    tag,
    before: { realFile: before, original: beforeOriginal },
    after: { realFile: after, original: afterOriginal },
    six: diff,
    writeWatch: watchReport,
    session: record,
    vault: { beforeCount: Object.keys(vaultBefore).length, afterCount: Object.keys(vaultAfter).length,
      diff: { added: treeDiff(vaultBefore, vaultAfter).added, removed: treeDiff(vaultBefore, vaultAfter).removed,
        changed: treeDiff(vaultBefore, vaultAfter).changed } },
    backup: { before: { exists: backupsBefore.exists, dirs: backupsBefore.dirs, files: backupsBefore.files },
      after: { exists: backupsAfter.exists, dirs: backupsAfter.dirs, files: backupsAfter.files },
      addedDirs: backupsAfter.dirs.filter(dir => !backupsBefore.dirs.includes(dir)) },
    inspection: inspector,
  };
  note(tag, { contentWrites: watchReport.contentWrites, touches: watchReport.touches, quiet: record.settle?.quiet,
    revisionBefore: before.revision, revisionAfter: after.revision, revisionDelta: diff.revisionDelta,
    allSixEqual: diff.allSixEqual, backupAddedDirs: result.backup.addedDirs, vaultAdded: result.vault.diff.added.length,
    missingAfter: inspector.body?.missingDocuments ?? null,
    notices: record.notices.map(row => row.text), errors: record.errors.length,
    promptSurfaces: record.promptSurfaces, holdIdentical: record.observationHold?.identical ?? null,
    quitExited: record.quitExited });
  jsonWrite(path.join(outDir, `${tag}-detail.json`), result);
  return result;
}

export function sixTable(phases) {
  const rows = {};
  for (const [name, phase] of Object.entries(phases)) {
    rows[name] = { sha256: phase.before.realFile.sha256, mtimeMs: phase.before.realFile.mtimeMs, revision: phase.before.realFile.revision,
      writerId: phase.before.realFile.writerId, savedAt: phase.before.realFile.savedAt, localEventsLength: phase.before.realFile.localEventsLength };
  }
  return rows;
}

export { BUNDLE, backupTree, inspectFile, jsonWrite, keepOriginal, note, now, readMainState, sha256, shaFile, sixDiff, treeDiff, treeSnapshot, WriteWatchVault, createHash };