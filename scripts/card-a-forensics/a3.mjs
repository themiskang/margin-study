// Card A stage 2 · A3: legacy library (documents without fingerprints, date-only schedules)
// cold start #1 then cold start #2. Observation only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { HEX64_RE, ISO_RE, WriteWatch, bareDates, jsonWrite, note, now, quitObsidian, readMainState, sha256, shaFile, sixDiff } from "./lib.mjs";
import { bringUp, runtimeBundleEvidence, settle } from "./host.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const OUT = process.env.CA_OUT ?? path.join(REPO, "evidence/card-A/forensics");
const ROOT = process.env.CA_ROOT ?? "/tmp/card-a-host-a3";
const MANIFEST = JSON.parse(fs.readFileSync(path.join(REPO, "evidence/card-A/exec/build-manifest.json"), "utf8"));
fs.mkdirSync(OUT, { recursive: true });
process.env.CA_STEPS_LOG = path.join(OUT, "a3-steps.log");
fs.writeFileSync(process.env.CA_STEPS_LOG, "");

const setup = JSON.parse(execFileSync(process.execPath, [path.join(HERE, "bootstrap.mjs"), "legacy", ROOT], { encoding: "utf8" }).trim());
const seed = JSON.parse(execFileSync(process.execPath, [path.join(HERE, "mkfixture.mjs"), "legacy", ROOT], { encoding: "utf8" }).trim());
fs.copyFileSync(path.join(ROOT, "legacy-seed.json"), path.join(OUT, "legacy-seed.json"));
note("setup", { root: ROOT, seedSha256: seed.sha256, installed: setup.installedAfterInstall, documentsWithoutFingerprint: seed.documentsWithoutFingerprint, bareDateFields: seed.bareDateFields.length });

const seedState = readMainState(setup.mainFile);
const cold1Before = path.join(OUT, "legacy-cold1-before.json");
fs.copyFileSync(setup.mainFile, cold1Before);

const inspect = parsed => {
  const documents = (parsed.documents ?? []).map(doc => {
    const abs = path.join(setup.vault, doc.path);
    const exists = fs.existsSync(abs);
    const bytes = exists ? fs.readFileSync(abs) : null;
    return { id: doc.id, path: doc.path,
      byteSize: doc.byteSize ?? null, sha256: doc.sha256 ?? null, missing: !!doc.missing,
      byteSizeIsPositiveInteger: Number.isSafeInteger(doc.byteSize) && doc.byteSize > 0,
      sha256IsLowerHex64: typeof doc.sha256 === "string" && HEX64_RE.test(doc.sha256),
      fileExistsInVault: exists,
      vaultFileByteSize: bytes ? bytes.length : null, vaultFileSha256: bytes ? sha256(bytes) : null,
      byteSizeEqualsVaultFile: !!bytes && doc.byteSize === bytes.length,
      sha256EqualsVaultFile: !!bytes && doc.sha256 === sha256(bytes) };
  });
  const srs = Object.entries(parsed.srs ?? {}).map(([questionId, state]) => ({ questionId,
    due: state?.due ?? null, lastReviewed: state?.lastReviewed ?? null,
    dueIsIso: typeof state?.due === "string" && ISO_RE.test(state.due),
    lastReviewedIsIso: typeof state?.lastReviewed === "string" && ISO_RE.test(state.lastReviewed) }));
  return {
    revision: parsed.revision ?? null, writerId: parsed.writerId ?? null, savedAt: parsed.savedAt ?? null,
    schemaVersion: parsed.schemaVersion ?? null,
    localEventsLength: Array.isArray(parsed.localEvents) ? parsed.localEvents.length : null,
    documents, srs,
    documentsAllFingerprinted: documents.every(doc => doc.byteSizeIsPositiveInteger && doc.sha256IsLowerHex64),
    documentsAllMatchVaultBytes: documents.every(doc => doc.byteSizeEqualsVaultFile && doc.sha256EqualsVaultFile),
    srsAllIso: srs.every(row => row.dueIsIso && row.lastReviewedIsIso),
    bareDateCount: bareDates(parsed).length,
    bareDateEntries: bareDates(parsed),
  };
};

const seedInspect = inspect(JSON.parse(fs.readFileSync(cold1Before, "utf8")));
note("seed-inspect", { revision: seedInspect.revision, documentsAllFingerprinted: seedInspect.documentsAllFingerprinted,
  srsAllIso: seedInspect.srsAllIso, bareDateCount: seedInspect.bareDateCount });

// ---------- cold start #1 ----------
const watch1 = new WriteWatch(setup.mainFile, "a3-cold1");
const startedAt1 = now();
const first = await bringUp(ROOT, "a3-cold1");
const bundle1 = await runtimeBundleEvidence(first.cdp, setup, MANIFEST);
note("bundle-cold1", { installedEqualsBuildManifest: bundle1.installedEqualsBuildManifest, storeSourceIsCardABuild: bundle1.probe.storeSourceIsCardABuild, obsidianVersion: bundle1.probe.obsidianVersion, removedAsar: first.removedAsar });
const settled1 = await settle(first.cdp, setup.mainFile, { quietMs: 6000 });
const after1State = readMainState(setup.mainFile);
const cold1After = path.join(OUT, "legacy-cold1-after.json");
fs.copyFileSync(setup.mainFile, cold1After);
const watch1Report = watch1.stop();
const renderer1 = await first.cdp.eval(`(() => { const s = app.plugins.plugins["margin-study"].store;
  return { revision: s.getRevision(), mainDirty: s.mainDirty, saveTimer: s.saveTimer, documents: s.documents.length,
    documentsAllFingerprinted: s.documents.every(d => typeof d.sha256 === "string" && /^[0-9a-f]{64}$/.test(d.sha256) && Number.isSafeInteger(d.byteSize) && d.byteSize > 0),
    srsEntries: Object.keys(s.srs || {}).length, localEvents: (s.localEvents || []).length }; })()`);
first.cdp.close();
const exited1 = await quitObsidian(first.run.pid);
const postQuit1 = readMainState(setup.mainFile);
note("cold1", { startedAt: startedAt1, settled: settled1, after: after1State, contentWrites: watch1Report.contentWrites, touches: watch1Report.touches,
  states: watch1Report.states, renderer: renderer1, exited: exited1, postQuit: postQuit1.sha256 });
const cold1Inspect = inspect(JSON.parse(fs.readFileSync(cold1After, "utf8")));

// ---------- cold start #2 ----------
// 六项指标一律取真身文件（副本只作原件留档；副本自身的 mtime 是拷贝时间，不可参与比对）。
const before2State = readMainState(setup.mainFile);
const cold2Before = path.join(OUT, "legacy-cold2-before.json");
fs.copyFileSync(setup.mainFile, cold2Before);
const watch2 = new WriteWatch(setup.mainFile, "a3-cold2");
const startedAt2 = now();
const second = await bringUp(ROOT, "a3-cold2");
const bundle2 = await runtimeBundleEvidence(second.cdp, setup, MANIFEST);
const settled2 = await settle(second.cdp, setup.mainFile, { quietMs: 6000 });
const after2State = readMainState(setup.mainFile);
const cold2After = path.join(OUT, "legacy-cold2-after.json");
fs.copyFileSync(setup.mainFile, cold2After);
const watch2Report = watch2.stop();
const renderer2 = await second.cdp.eval(`(() => { const s = app.plugins.plugins["margin-study"].store;
  return { revision: s.getRevision(), mainDirty: s.mainDirty, saveTimer: s.saveTimer, documents: s.documents.length,
    documentsAllFingerprinted: s.documents.every(d => typeof d.sha256 === "string" && /^[0-9a-f]{64}$/.test(d.sha256) && Number.isSafeInteger(d.byteSize) && d.byteSize > 0),
    srsEntries: Object.keys(s.srs || {}).length, localEvents: (s.localEvents || []).length }; })()`);
second.cdp.close();
const exited2 = await quitObsidian(second.run.pid);
note("cold2", { startedAt: startedAt2, settled: settled2, after: after2State, contentWrites: watch2Report.contentWrites, touches: watch2Report.touches,
  states: watch2Report.states, renderer: renderer2, exited: exited2 });

const cold1AfterState = after1State;
const cold2BeforeState = before2State;
const cold2AfterState = after2State;
const cold1BeforeState = seedState;
const diffCold1ToCold2 = sixDiff(cold1AfterState, cold2AfterState);

const report = {
  capturedAt: now(),
  scenario: "A3 历史旧库冷启回填一次收敛",
  library: { root: ROOT, vault: setup.vault, mainStateFile: setup.mainFile,
    origin: "脚本构造的等价历史旧库（scripts/card-a-forensics/mkfixture.mjs legacy），非旧构建真实产出",
    seed: { sha256: seed.sha256, size: seed.size, seededFiles: seed.seededFiles,
      documentsWithoutFingerprint: seed.documentsWithoutFingerprint, bareDateFields: seed.bareDateFields } },
  seedInspection: seedInspect,
  coldStart1: {
    startedAt: startedAt1, hostPid: first.run.pid, rendererPid: bundle1.probe.rendererPid, trustPromptAccepted: !!first.trust,
    obsidianVersion: bundle1.probe.obsidianVersion, windowTitle: bundle1.probe.windowTitle, asarRemovedBeforeLaunch: first.removedAsar,
    bundle: { installedEqualsBuildManifest: bundle1.installedEqualsBuildManifest, installed: bundle1.installed,
      storeSourceIsCardABuild: bundle1.probe.storeSourceIsCardABuild },
    writeWatch: { contentWrites: watch1Report.contentWrites, touches: watch1Report.touches,
      distinctObservations: watch1Report.distinctObservations, states: watch1Report.states, rawFsEventCount: watch1Report.rawFsEventCount },
    settle: settled1, rendererAfterSettle: renderer1,
    mainBefore: cold1Before, mainBeforeMetrics: cold1BeforeState,
    mainAfter: cold1After, mainAfterMetrics: cold1AfterState,
    revisionDelta: (cold1AfterState.revision ?? 0) - (cold1BeforeState.revision ?? 0),
    localEventsDelta: (cold1AfterState.localEventsLength ?? 0) - (cold1BeforeState.localEventsLength ?? 0),
    sixFieldsCold1: sixDiff(cold1BeforeState, cold1AfterState),
    quitExited: exited1, postQuitSha256: postQuit1.sha256,
    inspection: cold1Inspect,
  },
  coldStart2: {
    startedAt: startedAt2, hostPid: second.run.pid, rendererPid: bundle2.probe.rendererPid, trustPromptAccepted: !!second.trust,
    obsidianVersion: bundle2.probe.obsidianVersion, windowTitle: bundle2.probe.windowTitle, asarRemovedBeforeLaunch: second.removedAsar,
    bundle: { installedEqualsBuildManifest: bundle2.installedEqualsBuildManifest, storeSourceIsCardABuild: bundle2.probe.storeSourceIsCardABuild },
    writeWatch: { contentWrites: watch2Report.contentWrites, touches: watch2Report.touches,
      distinctObservations: watch2Report.distinctObservations, states: watch2Report.states, rawFsEventCount: watch2Report.rawFsEventCount },
    settle: settled2, rendererAfterSettle: renderer2,
    mainBefore: cold2Before, mainBeforeMetrics: cold2BeforeState,
    mainAfter: cold2After, mainAfterMetrics: cold2AfterState,
    revisionDelta: (cold2AfterState.revision ?? 0) - (cold2BeforeState.revision ?? 0),
    localEventsDelta: (cold2AfterState.localEventsLength ?? 0) - (cold2BeforeState.localEventsLength ?? 0),
    quitExited: exited2,
    inspection: inspect(JSON.parse(fs.readFileSync(cold2After, "utf8"))),
  },
  cold1AfterVsCold2After: diffCold1ToCold2,
  cold2BeforeVsCold2After: sixDiff(cold2BeforeState, cold2AfterState),
  cold1AfterEqualsCold2Before: {
    sha256: cold1AfterState.sha256 === cold2BeforeState.sha256,
    mtimeMs: cold1AfterState.mtimeMs === cold2BeforeState.mtimeMs,
    six: sixDiff(cold1AfterState, cold2BeforeState),
  },
  bodySha256: { cold1Before: shaFile(cold1Before), cold1After: shaFile(cold1After), cold2Before: shaFile(cold2Before), cold2After: shaFile(cold2After) },
};
jsonWrite(path.join(OUT, "legacy-cold-restart-diff.json"), report);
console.log(JSON.stringify({
  seed: { revision: seedState.revision, documentsAllFingerprinted: seedInspect.documentsAllFingerprinted, bareDateCount: seedInspect.bareDateCount },
  cold1: { contentWrites: watch1Report.contentWrites, touches: watch1Report.touches, revisionDelta: report.coldStart1.revisionDelta,
    documentsAllFingerprinted: cold1Inspect.documentsAllFingerprinted, srsAllIso: cold1Inspect.srsAllIso, bareDateCount: cold1Inspect.bareDateCount,
    revision: cold1AfterState.revision, localEvents: cold1AfterState.localEventsLength },
  cold2: { contentWrites: watch2Report.contentWrites, touches: watch2Report.touches, revisionDelta: report.coldStart2.revisionDelta, revision: cold2AfterState.revision },
  cold1AfterVsCold2After: { allSixEqual: diffCold1ToCold2.allSixEqual, revisionDelta: diffCold1ToCold2.revisionDelta },
}, null, 2));
