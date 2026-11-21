// Card A · A3 re-do (real legacy build) shared helpers.
// Observation only: launch one isolated Obsidian on 9333, drive/observe via CDP,
// snapshot vault trees and the plugin main state file, never write plugin data.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  BUNDLE, CDP, ISO_RE, HEX64_RE, SIX, bareDates, jsonWrite, note,
  now, quitObsidian, readMainState, sha256, shaFile, sixDiff, sleep, waitExit,
} from "./lib.mjs";
import { clearUpdateCache } from "./host.mjs";

export { BUNDLE, ISO_RE, HEX64_RE, SIX, bareDates, jsonWrite, note, now, readMainState, sha256, shaFile, sixDiff, sleep, waitExit, quitObsidian };

export const PORT = 9333;

export function portFree(port = PORT) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

async function pageTarget(timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === "page" && t.url.startsWith("app://obsidian.md"));
      if (page) return page;
    } catch {}
    await sleep(120);
  }
  throw new Error(`CDP page target not found on ${PORT}`);
}

/** CDP client with passive event capture (console / log / exceptions) and screenshots. */
export class ObsCdp extends CDP {
  static async attach(timeout = 150000) {
    const page = await pageTarget(timeout);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const client = new ObsCdp(ws);
    client.events = [];
    client.noticeLog = [];
    client.pageTarget = { url: page.url, id: page.id };
    ws.addEventListener("message", event => {
      const msg = JSON.parse(event.data);
      if (msg.id && client.pending.has(msg.id)) {
        const { resolve, reject } = client.pending.get(msg.id);
        client.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
      if (msg.id) return;
      const method = msg.method || "";
      if (method === "Runtime.consoleAPICalled") {
        const type = msg.params?.type;
        const text = (msg.params?.args ?? []).map(a => a.value ?? a.description ?? a.type).join(" ");
        client.events.push({ at: now(), method, type, text: String(text).slice(0, 1200) });
      } else if (method === "Runtime.exceptionThrown") {
        const d = msg.params?.exceptionDetails;
        client.events.push({ at: now(), method, text: String(d?.exception?.description ?? d?.text ?? "").slice(0, 2000) });
      } else if (method === "Log.entryAdded") {
        const e = msg.params?.entry;
        client.events.push({ at: now(), method, level: e?.level, source: e?.source, text: String(e?.text ?? "").slice(0, 2000) });
      }
    });
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    await client.send("Runtime.enable").catch(() => {});
    await client.send("Log.enable").catch(() => {});
    await client.send("Page.enable").catch(() => {});
    return client;
  }
  async screenshot(file) {
    const out = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(out.data, "base64"));
    return { file, sha256: shaFile(file), size: fs.statSync(file).size };
  }
  /** Visible Obsidian Notices, deduplicated by text. */
  async notices() {
    const rows = await this.eval(`(() => [...document.querySelectorAll(".notice")].map(el => (el.innerText || "").trim()).filter(Boolean))()`).catch(() => []);
    const seen = new Set(this.noticeLog.map(row => row.text));
    for (const text of rows ?? []) if (!seen.has(text)) { this.noticeLog.push({ at: now(), text }); seen.add(text); }
    return this.noticeLog;
  }
  errors() {
    return this.events.filter(e => e.method === "Runtime.exceptionThrown"
      || (e.method === "Log.entryAdded" && (e.level === "error" || e.level === "warning"))
      || (e.method === "Runtime.consoleAPICalled" && (e.type === "error" || e.type === "warning")));
  }
}

// ---------- builds ----------
/** Copy one build's four files into the vault plugin dir and prove what landed. */
export function installBuild(pluginDir, buildDir) {
  const before = {};
  const installed = {};
  for (const name of BUNDLE) {
    const from = path.join(buildDir, name);
    if (!fs.existsSync(from)) throw new Error("missing build artifact: " + from);
    const bytes = fs.readFileSync(from);
    before[name] = { path: from, sha256: sha256(bytes), size: bytes.length };
    fs.writeFileSync(path.join(pluginDir, name), bytes);
  }
  for (const name of BUNDLE) installed[name] = { shaFile: shaFile(path.join(pluginDir, name)), size: fs.statSync(path.join(pluginDir, name)).size };
  return {
    buildDir,
    source: before,
    installed,
    installedEqualsSource: BUNDLE.every(name => before[name].sha256 === installed[name].shaFile),
  };
}

/** Refuse to proceed unless the four files in the vault match the pinned hashes. */
export function requireBundle(setup, pinned, label) {
  const rows = {};
  for (const name of BUNDLE) {
    const file = path.join(setup.pluginDir, name);
    const actual = shaFile(file);
    rows[name] = { path: file, actual, expected: pinned[name] ?? null, equals: pinned[name] ? actual === pinned[name] : null };
  }
  const mismatch = BUNDLE.filter(name => rows[name].expected !== null && !rows[name].equals);
  if (mismatch.length) throw new Error(`${label}: bundle mismatch on ${mismatch.join(", ")}: ` + JSON.stringify(rows, null, 1));
  return rows;
}

// ---------- vault tree ----------
export function treeSnapshot(dir) {
  const files = {};
  const walk = rel => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) {
        const abs = path.join(dir, child);
        const stat = fs.statSync(abs);
        try { files[child] = { sha256: shaFile(abs), size: stat.size }; }
        catch (error) { files[child] = { sha256: null, size: stat.size, readError: String(error), mode: "0" + (stat.mode & 0o777).toString(8) }; }
      }
    }
  };
  walk("");
  return files;
}

export function treeDiff(before, after) {
  const added = Object.keys(after).filter(name => !before[name]).map(name => ({ path: name, ...after[name] }));
  const removed = Object.keys(before).filter(name => !after[name]).map(name => ({ path: name, ...before[name] }));
  const changed = Object.keys(after).filter(name => before[name] && before[name].sha256 !== after[name].sha256)
    .map(name => ({ path: name, before: before[name], after: after[name] }));
  return { added, removed, changed, addedCount: added.length, removedCount: removed.length, changedCount: changed.length };
}

export function backupTree(vault) {
  const root = path.join(vault, "MarginStudyBackups");
  if (!fs.existsSync(root)) return { root, exists: false, dirs: [], files: {} };
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
  return { root, exists: true, dirs, files: treeSnapshot(root) };
}

// ---------- main state inspection ----------
/** Extended observation of one data.json body (read from the real file, never from a copy). */
export function inspectBody(parsed, vault) {
  const docs = parsed?.documents ?? [];
  const documents = docs.map(doc => {
    const abs = path.join(vault, doc.path ?? "");
    let exists = false, bytes = null, readError = null;
    try { exists = fs.existsSync(abs); if (exists) bytes = fs.readFileSync(abs); }
    catch (error) { readError = String(error); }
    return {
      id: doc.id, path: doc.path, kind: doc.kind,
      byteSizePresent: Object.prototype.hasOwnProperty.call(doc, "byteSize"),
      sha256Present: Object.prototype.hasOwnProperty.call(doc, "sha256"),
      byteSize: doc.byteSize ?? null, sha256: doc.sha256 ?? null, missing: doc.missing === true,
      sourceUrl: doc.sourceUrl ?? null, createdAt: doc.createdAt ?? null,
      byteSizeIsNonNegativeInteger: Number.isSafeInteger(doc.byteSize) && doc.byteSize >= 0,
      sha256IsLowerHex64: typeof doc.sha256 === "string" && HEX64_RE.test(doc.sha256),
      fileExistsInVault: exists,
      vaultFileByteSize: bytes ? bytes.length : null,
      vaultFileSha256: bytes ? sha256(bytes) : null,
      marketReadError: readError,
      byteSizeEqualsVaultFile: !!bytes && doc.byteSize === bytes.length,
      sha256EqualsVaultFile: !!bytes && doc.sha256 === sha256(bytes),
    };
  });
  const srs = Object.entries(parsed?.srs ?? {}).map(([questionId, state]) => ({
    questionId,
    due: state?.due ?? null, lastReviewed: state?.lastReviewed ?? null,
    dueIsBareDate: typeof state?.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(state.due),
    dueIsIso: typeof state?.due === "string" && ISO_RE.test(state.due),
    lastReviewedIsBareDate: typeof state?.lastReviewed === "string" && /^\d{4}-\d{2}-\d{2}$/.test(state.lastReviewed),
    lastReviewedIsIso: typeof state?.lastReviewed === "string" && ISO_RE.test(state.lastReviewed),
    keys: Object.keys(state ?? {}).sort(),
  }));
  const bare = bareDates(parsed);
  const keys = Object.keys(parsed ?? {});
  const events = Array.isArray(parsed?.localEvents) ? parsed.localEvents : [];
  return {
    schemaVersion: parsed?.schemaVersion ?? null,
    revision: parsed?.revision ?? null,
    writerId: parsed?.writerId ?? null,
    savedAt: parsed?.savedAt ?? null,
    keys,
    presentKeys: {
      reviewPending: Array.isArray(parsed?.reviewPending), reviewDecks: Array.isArray(parsed?.reviewDecks),
      reviewLogs: Array.isArray(parsed?.reviewLogs), cardTemplates: Array.isArray(parsed?.cardTemplates),
      workspaceState: !!parsed?.workspaceState, sceneTemplates: !!parsed?.sceneTemplates,
      activeReviewDeckId: parsed?.activeReviewDeckId !== undefined,
    },
    settings: { backupEnabled: parsed?.settings?.backupEnabled ?? null, lastBackup: parsed?.settings?.lastBackup ?? null,
      replaceNativeReader: parsed?.settings?.replaceNativeReader ?? null, defaultEase: parsed?.settings?.defaultEase ?? null },
    graph: {
      cards: parsed?.cards?.length ?? 0, nodes: parsed?.nodes?.length ?? 0, edges: parsed?.edges?.length ?? 0,
      studySets: parsed?.studySets?.length ?? 0, canvases: parsed?.canvases?.length ?? 0,
      documents: documents.length, srsEntries: srs.length,
      docMeta: Object.keys(parsed?.docMeta ?? {}).length,
      reviewHistory: Object.keys(parsed?.reviewHistory ?? {}).length,
      reviewLogs: parsed?.reviewLogs?.length ?? 0, practiceAttempts: parsed?.practiceAttempts?.length ?? 0,
      reviewPending: parsed?.reviewPending?.length ?? 0, reviewDecks: parsed?.reviewDecks?.length ?? 0,
      cardTemplates: parsed?.cardTemplates?.length ?? 0,
      localEvents: events.length,
      studySetCardIds: (parsed?.studySets ?? []).reduce((sum, set) => sum + (set.cardIds?.length ?? 0), 0),
      canvasNodes: (parsed?.nodes ?? []).filter(n => !!n.canvasId).length,
      linkedNodes: (parsed?.nodes ?? []).filter(n => !!n.parentId).length,
    },
    documents,
    srs,
    bareDateCount: bare.length,
    bareDateEntries: bare,
    documentsWithoutFingerprint: documents.filter(doc => !doc.byteSizePresent || !doc.sha256Present).map(doc => doc.path),
    documentsAllFingerprinted: documents.every(doc => doc.byteSizeIsNonNegativeInteger && doc.sha256IsLowerHex64),
    missingDocuments: documents.filter(doc => doc.missing).map(doc => ({ id: doc.id, path: doc.path })),
    localEventTail: events.slice(-8).map(event => ({ kind: event.kind, at: event.at, objectIds: event.objectIds, detail: event.detail })),
    localEventKinds: events.reduce((acc, event) => { acc[event.kind] = (acc[event.kind] ?? 0) + 1; return acc; }, {}),
  };
}

export function inspectFile(file, vault) {
  const base = readMainState(file);
  if (!base.exists) return { ...base, body: null };
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  return { ...base, body: parsed ? inspectBody(parsed, vault) : null };
}

// ---------- write watch with per-write attribution ----------
export class WriteWatchVault {
  constructor(file, label, vault) {
    this.file = file; this.label = label; this.vault = vault;
    this.states = []; this.rawEvents = []; this.startedAt = now(); this.timer = null; this.closed = false;
    this.sample("open");
    this.watcher = fs.watch(path.dirname(file), (_event, name) => {
      if (name !== path.basename(file)) return;
      this.rawEvents.push(now());
      if (this.timer) return;
      this.timer = setTimeout(() => { this.timer = null; this.sample("fs-event"); }, 60);
    });
  }
  sample(reason) {
    if (this.closed || !fs.existsSync(this.file)) return;
    const stat = fs.statSync(this.file);
    const bytes = fs.readFileSync(this.file);
    const digest = sha256(bytes);
    const last = this.states[this.states.length - 1];
    if (last && last.sha256 === digest && last.mtimeMs === stat.mtimeMs && last.size === bytes.length) return;
    let parsed = null;
    try { parsed = JSON.parse(bytes.toString("utf8")); } catch {}
    const body = parsed ? inspectBody(parsed, this.vault) : null;
    this.states.push({
      at: now(), reason, sha256: digest, size: bytes.length, mtimeMs: stat.mtimeMs,
      revision: body?.revision ?? null, localEventsLength: body?.graph?.localEvents ?? null,
      lastEventKind: body?.localEventTail?.length ? body.localEventTail[body.localEventTail.length - 1].kind : null,
      lastEventDetail: body?.localEventTail?.length ? body.localEventTail[body.localEventTail.length - 1].detail : null,
      settings: body?.settings ?? null,
      documentsAllFingerprinted: body?.documentsAllFingerprinted ?? null,
      documentsWithoutFingerprint: body?.documentsWithoutFingerprint ?? null,
      bareDateCount: body?.bareDateCount ?? null,
      missingDocuments: body?.missingDocuments ?? null,
    });
  }
  stop() {
    this.sample("close"); this.closed = true;
    try { this.watcher.close(); } catch {}
    if (this.timer) clearTimeout(this.timer);
    let contentWrites = 0, touches = 0;
    for (let i = 1; i < this.states.length; i++) {
      if (this.states[i].sha256 !== this.states[i - 1].sha256) contentWrites++; else touches++;
    }
    return { file: this.file, label: this.label, startedAt: this.startedAt, stoppedAt: now(),
      distinctObservations: this.states.length, contentWrites, touches, writes: contentWrites,
      states: this.states, rawFsEventCount: this.rawEvents.length };
  }
}

// ---------- session ----------
export function launchObsidian({ root, stage }) {
  const log = path.join(root, `${stage}.obsidian.log`);
  const child = spawn("/Applications/Obsidian.app/Contents/MacOS/Obsidian",
    [`--user-data-dir=${path.join(root, "profile")}`, `--remote-debugging-port=${PORT}`],
    { env: { ...process.env, CFFIXED_USER_HOME: path.join(root, "home") },
      stdio: ["ignore", fs.openSync(log, "a"), fs.openSync(log, "a")], detached: true });
  child.unref();
  return { pid: child.pid, log };
}

export async function waitWorkspace(cdp, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await cdp.eval(`!!(window.app && app.workspace && app.vault && document.querySelector(".workspace"))`)) return true;
    } catch {}
    await sleep(200);
  }
  throw new Error("workspace not ready");
}

export async function acceptTrust(cdp, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  let clicked = null;
  while (Date.now() < end) {
    const hit = await cdp.eval(`(() => { const m = document.querySelector(".modal-container");
      if (!m) return null;
      const text = m.innerText || "";
      if (!/信任/.test(text)) return null;
      const b = [...m.querySelectorAll("button")].find(x => /信任/.test(x.innerText));
      if (!b) return null; const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (b.innerText || "").trim(), modalText: text.slice(0, 400) }; })()`).catch(() => null);
    if (hit) { await cdp.click(hit.x, hit.y); clicked = hit; await sleep(3000); break; }
    await sleep(300);
  }
  return clicked;
}

export async function waitPlugin(cdp, timeoutMs = 90000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const ready = await cdp.eval(`(() => { const p = app.plugins && app.plugins.plugins && app.plugins.plugins["margin-study"];
      return !!(p && p.store && p.manifest); })()`).catch(() => false);
    if (ready) return true;
    await sleep(300);
  }
  return false;
}

export const PROBE = `(() => {
  const p = app.plugins.plugins["margin-study"], s = p && p.store, m = app.plugins.manifests["margin-study"];
  const backfill = s && typeof s.backfillDocumentFingerprints === "function" ? s.backfillDocumentFingerprints.toString() : "";
  return {
    obsidianVersion: (document.title.match(/Obsidian ([0-9.]+)/) || [])[1] || null,
    documentTitle: document.title,
    rendererPid: process.pid,
    vaultBasePath: (() => { try { return app.vault.adapter.getBasePath ? app.vault.adapter.getBasePath() : null; } catch (e) { return String(e); } })(),
    pluginLoaded: !!p,
    manifestFromLoader: m ? { id: m.id, version: m.version, dir: m.dir, minAppVersion: m.minAppVersion } : null,
    enabledPlugins: [...((app.plugins && app.plugins.enabledPlugins) || [])],
    storeApi: {
      hasBackfillDocumentFingerprints: typeof s?.backfillDocumentFingerprints === "function",
      backfillSourceLength: backfill.length,
      backfillHasHasDocumentFingerprint: /hasDocumentFingerprint/.test(backfill),
      backfillIsBatchedForm: /const updates = \/\* @__PURE__ \*\/ new Map\(\)/.test(backfill),
      hasRecoverMissingDocuments: typeof s?.recoverMissingDocuments === "function",
      schemaVersionConstant: (() => { try { return s && s.constructor ? null : null; } catch (e) { return null; } })(),
    },
    storeState: s ? { revision: s.getRevision(), mainDirty: s.mainDirty, saveTimer: s.saveTimer,
      loadBlocked: s.loadBlocked, lastSaveError: s.lastSaveError ?? null, writerId: s.writerId,
      documents: s.documents.length, cards: s.cards.length, srsEntries: Object.keys(s.srs || {}).length,
      studySets: s.studySets.length, canvases: s.canvases.length, nodes: s.nodes.length, edges: s.edges.length,
      localEvents: (s.localEvents || []).length, settings: { backupEnabled: s.settings.backupEnabled, lastBackup: s.settings.lastBackup ?? null } } : null,
  };
})()`;

export async function runtimeProbe(cdp, setup) {
  const probe = await cdp.eval(PROBE);
  const backfillSha = await cdp.eval(`(async () => {
    const s = app.plugins.plugins["margin-study"].store;
    if (typeof s.backfillDocumentFingerprints !== "function") return null;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s.backfillDocumentFingerprints.toString()));
    return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
  })()`).catch(error => String(error));
  const installed = {};
  for (const name of BUNDLE) installed[name] = { sha256: shaFile(path.join(setup.pluginDir, name)), size: fs.statSync(path.join(setup.pluginDir, name)).size };
  const mainSource = fs.readFileSync(path.join(setup.pluginDir, "main.js"), "utf8");
  return {
    installed,
    probe: { ...probe, backfillSourceSha256: backfillSha },
    mainJsContainsHasDocumentFingerprint: mainSource.includes("hasDocumentFingerprint"),
    mainJsContainsBatchedBackfillMarker: mainSource.includes("const pending = this.documents.filter"),
  };
}

/** Passive settle: await the plugin's own recovery chain, then require data.json to stop changing. */
export async function settle(cdp, mainFile, { quietMs = 6000, timeoutMs = 120000 } = {}) {
  const recovery = await cdp.eval(`(async () => {
    const p = app.plugins.plugins["margin-study"];
    const started = Date.now();
    if (p && p.sourceRecovery && typeof p.sourceRecovery.then === "function") { try { await p.sourceRecovery; } catch (e) {} }
    const s = p && p.store;
    return { waitedMs: Date.now() - started, mainDirty: s ? s.mainDirty : null, saveTimer: s ? s.saveTimer : null,
      revision: s && s.getRevision ? s.getRevision() : null }; })()`).catch(error => ({ error: String(error) }));
  const end = Date.now() + timeoutMs;
  let last = readMainState(mainFile), since = Date.now(), quiet = false;
  while (Date.now() < end) {
    await sleep(300);
    const current = readMainState(mainFile);
    if (current.sha256 !== last.sha256 || current.mtimeMs !== last.mtimeMs) { last = current; since = Date.now(); continue; }
    if (Date.now() - since >= quietMs) { quiet = true; break; }
  }
  const finalStore = await cdp.eval(`(() => { const s = app.plugins.plugins["margin-study"].store;
    return { revision: s.getRevision(), mainDirty: s.mainDirty, saveTimer: s.saveTimer, loadBlocked: s.loadBlocked,
      lastSaveError: s.lastSaveError ?? null, documents: s.documents.length, cards: s.cards.length,
      srsEntries: Object.keys(s.srs || {}).length, localEvents: (s.localEvents || []).length,
      settings: { backupEnabled: s.settings.backupEnabled, lastBackup: s.settings.lastBackup ?? null },
      missingDocuments: s.documents.filter(d => d.missing).map(d => ({ id: d.id, path: d.path })),
      documentsWithoutFingerprint: s.documents.filter(d => !(typeof d.sha256 === "string" && Number.isSafeInteger(d.byteSize))).map(d => d.path) }; })()`).catch(error => ({ error: String(error) }));
  return { recovery, quiet, quietWindowMs: quietMs, quietHeldMs: Date.now() - since, disk: readMainState(mainFile), store: finalStore };
}

/**
 * One observed Obsidian session: launch, arrive, settle, screenshot, quit.
 * Caller supplies the write watch and vault snapshots around it.
 */
export async function session({ root, stage, setup, outDir, quietMs = 6000, settleMs = 120000, holdMs = 0 }) {
  if (!await portFree()) throw new Error(`port ${PORT} busy before ${stage}`);
  const removedAsar = clearUpdateCache(root);
  const run = launchObsidian({ root, stage });
  const record = { stage, root, hostPid: run.pid, hostLog: run.log, removedAsar, launchedAt: now() };
  const cdp = await ObsCdp.attach(150000);
  try {
    await waitWorkspace(cdp);
    record.workspaceReadyAt = now();
    record.trust = await acceptTrust(cdp);
    record.pluginLoaded = await waitPlugin(cdp);
    record.arrivedAt = now();
    record.bundle = await runtimeProbe(cdp, setup);
    record.settle = await settle(cdp, setup.mainFile, { quietMs, timeoutMs: settleMs });
    await cdp.notices();
    if (holdMs > 0) {
      // Extra passive hold: prove the session is settled rather than retrying in the background.
      const holdStart = readMainState(setup.mainFile);
      const noticesStart = cdp.noticeLog.length;
      await sleep(holdMs);
      const holdEnd = readMainState(setup.mainFile);
      await cdp.notices();
      record.observationHold = {
        ms: holdMs, sha256Before: holdStart.sha256, sha256After: holdEnd.sha256,
        mtimeMsBefore: holdStart.mtimeMs, mtimeMsAfter: holdEnd.mtimeMs,
        identical: holdStart.sha256 === holdEnd.sha256 && holdStart.mtimeMs === holdEnd.mtimeMs,
        noticesAddedDuringHold: cdp.noticeLog.slice(noticesStart),
        storeAfterHold: await cdp.eval(`(() => { const s = app.plugins.plugins["margin-study"].store;
          return { mainDirty: s.mainDirty, saveTimer: s.saveTimer, loadBlocked: s.loadBlocked, lastSaveError: s.lastSaveError ?? null,
            jobs: s.jobs ? s.jobs.size : null }; })()`).catch(error => ({ error: String(error) })),
      };
    }
    record.promptSurfaces = await cdp.eval(`(() => [...document.querySelectorAll(".modal-container, .modal, .prompt")]
      .map(el => (el.innerText || "").trim()).filter(Boolean).map(text => text.slice(0, 800)))()`).catch(() => []);
    record.settingsAutoClosed = await cdp.eval(`(() => { try { if (document.querySelector(".mod-settings") && app.setting) { app.setting.close(); return true; } } catch (e) { return String(e); } return false; })()`).catch(() => null);
    if (record.settingsAutoClosed === true) await sleep(900);
    record.screenshot = await cdp.screenshot(path.join(outDir, `${stage}.png`));
    record.notices = [...cdp.noticeLog];
    record.events = cdp.events.slice(-400);
    record.errors = cdp.errors().slice(-80);
    record.rendererPid = record.bundle?.probe?.rendererPid ?? null;
  } finally {
    cdp.close();
  }
  record.quitExited = await quitObsidian(run.pid);
  if (!record.quitExited) execFileSync("/bin/sh", ["-c", `kill -9 ${run.pid} 2>/dev/null || true`]);
  record.quitAt = now();
  record.postQuit = readMainState(setup.mainFile);
  record.portReleased = await portFree();
  return { cdpClosed: true, record };
}

export function hostSetup(root) {
  return JSON.parse(fs.readFileSync(path.join(root, "setup.json"), "utf8"));
}

/** data.json 原件拷出（只作留档，六项指标一律读真身文件）。 */
export function keepOriginal(mainFile, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.copyFileSync(mainFile, outFile);
  return { file: outFile, sha256: shaFile(outFile), size: fs.statSync(outFile).size };
}