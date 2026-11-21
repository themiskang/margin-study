// Card A stage 2: host bring-up (trust prompt, plugin load), runtime bundle verification and
// cold-start settling. Observation only, no source changes.
import fs from "node:fs";
import path from "node:path";
import { BUNDLE, CDP, launchObsidian, obsidianVersion, readMainState, sha256, shaFile, sleep, note, waitWorkspace } from "./lib.mjs";

export function clearUpdateCache(root) {
  const profile = path.join(root, "profile");
  const removed = fs.readdirSync(profile).filter(name => /obsidian-.*\.asar/.test(name));
  for (const name of removed) fs.rmSync(path.join(profile, name), { force: true });
  return removed;
}

export async function acceptTrust(cdp, timeoutMs = 40000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const hit = await cdp.eval(`(() => { const m = document.querySelector(".modal-container");
      if (!m || !m.innerText.includes("信任")) return null;
      const b = [...m.querySelectorAll("button")].find(x => x.innerText.includes("信任"));
      if (!b) return null; const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: b.innerText.trim() }; })()`);
    if (hit) { await cdp.click(hit.x, hit.y); note("trust-click", hit); await sleep(2500); return hit; }
    await sleep(300);
  }
  return null;
}

export async function waitPlugin(cdp, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const ready = await cdp.eval(`(() => { const p = app.plugins && app.plugins.plugins && app.plugins.plugins["margin-study"];
      return !!(p && p.store && p.manifest); })()`).catch(() => false);
    if (ready) return true;
    await sleep(300);
  }
  return false;
}

export const RUNTIME_PROBE = `(() => {
  const p = app.plugins.plugins["margin-study"], s = p && p.store, m = app.plugins.manifests["margin-study"];
  const src = s && typeof s.backfillDocumentFingerprints === "function" ? s.backfillDocumentFingerprints.toString() : "";
  return {
    obsidianVersion: (document.title.match(/Obsidian ([0-9.]+)/) || [])[1] || null,
    windowTitle: document.title,
    rendererPid: process.pid,
    pluginLoaded: !!p,
    manifestFromPluginLoader: m ? { id: m.id, version: m.version, dir: m.dir, minAppVersion: m.minAppVersion } : null,
    pluginManifest: p && p.manifest ? { id: p.manifest.id, version: p.manifest.version, dir: p.manifest.dir } : null,
    enabledPlugins: [...((app.plugins && app.plugins.enabledPlugins) || [])],
    loadedPlugins: Object.keys((app.plugins && app.plugins.plugins) || {}),
    storeFingerprintApi: {
      hasBackfillDocumentFingerprints: typeof s?.backfillDocumentFingerprints === "function",
      hasHasDocumentFingerprintSymbol: /hasDocumentFingerprint/.test(src),
      backfillSourceLength: src.length,
      backfillSourceSha256: null,
      sourceHead: src.slice(0, 220),
    },
    storeState: s ? { revision: s.getRevision(), mainDirty: s.mainDirty, saveTimer: s.saveTimer, loadBlocked: s.loadBlocked,
      hasDesktopMainConflict: s.hasDesktopMainConflict(), lastSaveError: s.lastSaveError, writerId: s.writerId,
      documents: s.documents.length, cards: s.cards.length, studySets: s.studySets.length,
      localEvents: (s.localEvents || []).length } : null,
    storeSourceIsCardABuild: !!(s && typeof s.backfillDocumentFingerprints === "function" && /hasDocumentFingerprint/.test(src)),
  };
})()`;

/** Hash the four files Obsidian actually loads from the vault plugin directory. */
export function installedBundle(setup, manifest) {
  const files = {};
  for (const name of BUNDLE) {
    const file = path.join(setup.pluginDir, name);
    const bytes = fs.readFileSync(file);
    files[name] = {
      sha256: sha256(bytes), size: bytes.length,
      path: file,
      expectedFromBuildManifest: manifest?.artifacts?.[name] ?? null,
      equalsBuildManifest: manifest?.artifacts?.[name] === sha256(bytes),
    };
  }
  return files;
}

export async function runtimeBundleEvidence(cdp, setup, manifest) {
  const installed = installedBundle(setup, manifest);
  const probe = await cdp.eval(RUNTIME_PROBE);
  const backfillSha = await cdp.eval(`(async () => {
    const s = app.plugins.plugins["margin-study"].store;
    const src = s.backfillDocumentFingerprints.toString();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(src));
    return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
  })()`);
  probe.storeFingerprintApi.backfillSourceSha256 = backfillSha;
  const mainSourceStringPresent = fs.readFileSync(path.join(setup.pluginDir, "main.js"), "utf8").includes("hasDocumentFingerprint");
  return { installed, probe, mainSourceStringPresent, installedEqualsBuildManifest: BUNDLE.every(name => installed[name].equalsBuildManifest) };
}

/** Passive settle: await the plugin's own recovery chain, then require the main file to stop changing. */
export async function settle(cdp, mainFile, { quietMs = 5000, timeoutMs = 90000 } = {}) {
  const recovery = await cdp.eval(`(async () => {
    const p = app.plugins.plugins["margin-study"];
    const started = Date.now();
    if (p && p.sourceRecovery && typeof p.sourceRecovery.then === "function") { try { await p.sourceRecovery; } catch (e) {} }
    const s = p && p.store;
    return { sourceRecoveryAwaited: true, waitedMs: Date.now() - started,
      mainDirty: s ? s.mainDirty : null, saveTimer: s ? s.saveTimer : null,
      revision: s && s.getRevision ? s.getRevision() : null };
  })()`).catch(error => ({ error: String(error) }));
  const end = Date.now() + timeoutMs;
  let last = readMainState(mainFile);
  let since = Date.now();
  let quiet = false;
  while (Date.now() < end) {
    await sleep(300);
    const current = readMainState(mainFile);
    if (current.sha256 !== last.sha256 || current.mtimeMs !== last.mtimeMs) { last = current; since = Date.now(); continue; }
    if (Date.now() - since >= quietMs) { quiet = true; break; }
  }
  const state = readMainState(mainFile);
  const finalStore = await cdp.eval(`(() => { const s = app.plugins.plugins["margin-study"].store;
    return { revision: s.getRevision(), mainDirty: s.mainDirty, saveTimer: s.saveTimer, saveIdle: !!s.saveIdle,
      jobs: s.jobs ? s.jobs.size : null, loadBlocked: s.loadBlocked, hasDesktopMainConflict: s.hasDesktopMainConflict(),
      lastSaveError: s.lastSaveError, documents: s.documents.length, localEvents: (s.localEvents || []).length }; })()`).catch(error => ({ error: String(error) }));
  return { recovery, quiet, quietWindowMs: quietMs, quietHeldMs: Date.now() - since, disk: state, store: finalStore };
}

export async function bringUp(root, stage) {
  const removed = clearUpdateCache(root);
  const run = launchObsidian({ root, stage });
  const cdp = await CDP.connect(150000);
  await waitWorkspace(cdp);
  const trust = await acceptTrust(cdp);
  const plugin = await waitPlugin(cdp);
  note("bring-up", { stage, hostPid: run.pid, removedAsar: removed, trustClicked: !!trust, pluginLoaded: plugin });
  return { cdp, run, trust, plugin, removedAsar: removed };
}

export { shaFile, obsidianVersion };
