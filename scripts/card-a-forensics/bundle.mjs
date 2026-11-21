// Card A stage 2, step 0: verify the four artifacts Obsidian actually loads.
// Writes forensics/runtime-bundle-sha256.txt and runtime-bundle.json, then quits the host.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsonWrite, note, now, obsidianVersion, quitObsidian, readMainState } from "./lib.mjs";
import { bringUp, runtimeBundleEvidence } from "./host.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const OUT = process.env.CA_OUT ?? path.join(REPO, "evidence/card-A/forensics");
const ROOT = process.env.CA_ROOT ?? "/tmp/card-a-host-bundle";
const MANIFEST = JSON.parse(fs.readFileSync(path.join(REPO, "evidence/card-A/exec/build-manifest.json"), "utf8"));

process.env.CA_STEPS_LOG = path.join(OUT, "bundle-steps.log");
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(process.env.CA_STEPS_LOG, "");
const { execFileSync } = await import("node:child_process");
const bootOut = execFileSync(process.execPath, [path.join(HERE, "bootstrap.mjs"), "fresh", ROOT], { encoding: "utf8" }).trim();
const setup = JSON.parse(bootOut);

const { cdp, run, trust, removedAsar } = await bringUp(ROOT, "bundle-check");
const evidence = await runtimeBundleEvidence(cdp, setup, MANIFEST);
const hostInfo = {
  checkedAt: now(),
  observedAsarRemovedBeforeLaunch: removedAsar,
  obsidianBundleVersionOnDisk: obsidianVersion(),
  launchCommand: setup.launchCommand,
  hostPid: run.pid,
  rendererPid: evidence.probe.rendererPid,
  windowTitle: evidence.probe.windowTitle,
  trustPromptAccepted: !!trust,
  manifestCommit: MANIFEST.commit,
  mainStateFileAtCheck: readMainState(setup.mainFile),
};
const report = { ...hostInfo, ...evidence };

const lines = [];
lines.push("# Card A stage 2 · runtime bundle SHA-256");
lines.push(`# checked at        : ${hostInfo.checkedAt}`);
lines.push(`# build manifest     : evidence/card-A/exec/build-manifest.json (commit ${MANIFEST.commit})`);
lines.push(`# obsidian on disk   : ${hostInfo.obsidianBundleVersionOnDisk}`);
lines.push(`# window title       : ${hostInfo.windowTitle}`);
lines.push(`# asar cleared before: ${JSON.stringify(hostInfo.observedAsarRemovedBeforeLaunch)}`);
lines.push(`# host pid / renderer: ${hostInfo.hostPid} / ${hostInfo.rendererPid}`);
lines.push(`# launch             : ${setup.launchCommand}`);
lines.push(`# loaded from        : ${setup.pluginDir}`);
lines.push("");
lines.push("# Obsidian 实际加载的四件套（vault 插件目录，逐字节哈希）");
for (const [name, info] of Object.entries(evidence.installed)) {
  lines.push(`${info.sha256}  ${name}  size=${info.size}  equalsBuildManifest=${info.equalsBuildManifest}  expected=${info.expectedFromBuildManifest}`);
}
lines.push("");
lines.push(`# all four equal build manifest : ${evidence.installedEqualsBuildManifest}`);
lines.push("");
lines.push("# 运行时确认（证明加载的就是这份代码，而不是同名旧包）");
lines.push(`pluginLoaded                     : ${evidence.probe.pluginLoaded}`);
lines.push(`manifestFromPluginLoader         : ${JSON.stringify(evidence.probe.manifestFromPluginLoader)}`);
lines.push(`pluginManifest                   : ${JSON.stringify(evidence.probe.pluginManifest)}`);
lines.push(`enabledPlugins                   : ${JSON.stringify(evidence.probe.enabledPlugins)}`);
lines.push(`loadedPlugins                    : ${JSON.stringify(evidence.probe.loadedPlugins)}`);
lines.push(`store.backfillDocumentFingerprints typeof : ${evidence.probe.storeFingerprintApi.hasBackfillDocumentFingerprints}`);
lines.push(`backfill source contains "hasDocumentFingerprint" (镜头A 新符号) : ${evidence.probe.storeFingerprintApi.hasHasDocumentFingerprintSymbol}`);
lines.push(`backfill source length / sha256  : ${evidence.probe.storeFingerprintApi.backfillSourceLength} / ${evidence.probe.storeFingerprintApi.backfillSourceSha256}`);
lines.push(`main.js 源串含 "hasDocumentFingerprint" : ${evidence.mainSourceStringPresent}`);
lines.push(`storeSourceIsCardABuild          : ${evidence.probe.storeSourceIsCardABuild}`);
lines.push(`storeState at check              : ${JSON.stringify(evidence.probe.storeState)}`);
lines.push("");
fs.writeFileSync(path.join(OUT, "runtime-bundle-sha256.txt"), lines.join("\n") + "\n");
jsonWrite(path.join(OUT, "runtime-bundle.json"), report);

cdp.close();
const exited = await quitObsidian(run.pid);
note("bundle-check-quit", { exited });
console.log(lines.join("\n"));
