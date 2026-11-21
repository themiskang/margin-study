// F08 A1 driver: concurrent external main write on a v2 vault -> blocked-write state,
// cold restart, then real-UI conflict resolution. Produces the a1-<case> evidence set.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CDP, launchObsidian, waitWorkspace, waitExit, shaFile, sha256, jsonWrite, sleep, now, portFree } from "./lib.mjs";

const [choice] = process.argv.slice(2);            // "local" | "remote"
const caseName = `a1-${choice}`;
const out = process.env.F08_OUT;
const repo = fileURLToPath(new URL("../../", import.meta.url));
const stepsLog = path.join(out, "steps.log");
process.env.F08_STEPS_LOG = stepsLog;
const events = [];
const log = (label, value) => { events.push({ at: now(), label, ...(value === undefined ? {} : { value }) }); };
const timeline = {};

const prep = execFileSync(process.execPath, [path.join(repo, ".agent-artifacts/f08-executor/prepare-host.mjs"), caseName, path.join(repo, ".agent-artifacts/f08-executor/install")], { encoding: "utf8" }).trim();
const root = prep;
process.env.F08_ROOT = root;
const setup = JSON.parse(fs.readFileSync(path.join(root, "setup.json"), "utf8"));
const pluginDir = path.join(setup.vault, ".obsidian/plugins/margin-study");
const mainPath = path.join(pluginDir, "data.json");
jsonWrite(path.join(out, "setup.json"), setup);
const dropUpdateCache = () => {
  const removed = fs.readdirSync(path.join(root, "profile")).filter(n => /obsidian-.*\.asar/.test(n));
  for (const n of removed) fs.rmSync(path.join(root, "profile", n), { force: true });
  return removed;
};
const stageDirs = () => fs.readdirSync(pluginDir).filter(n => /^data\.json\.ms-replace-[0-9a-f]+-\d+-[0-9a-f-]+$/.test(n));
const hashStage = () => Object.fromEntries(stageDirs().map(n => [n, Object.fromEntries(fs.readdirSync(path.join(pluginDir, n)).map(f => [f, shaFile(path.join(pluginDir, n, f))]))]));
const snapshotDisk = label => ({ at: now(), label, dataJson: fs.existsSync(mainPath) ? shaFile(mainPath) : null, stages: hashStage(),
  mtime: fs.existsSync(mainPath) ? fs.statSync(mainPath).mtime.toISOString() : null });

// ---------- helpers over the live renderer ----------
const observer = `(() => { if (window.__f08Notices) return "installed"; window.__f08Notices = [];
  new MutationObserver(() => { for (const n of document.querySelectorAll(".notice")) { const t = n.textContent;
    if (t && !window.__f08Notices.some(x => x.text === t)) window.__f08Notices.push({ at: new Date().toISOString(), text: t }); } })
    .observe(document.body, { childList: true, subtree: true }); return "installed"; })()`;
const byText = (selector, text) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
  .find(e => e.getClientRects().length && (e.getAttribute("aria-label") || e.innerText || "").trim().includes(${JSON.stringify(text)}));
  if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 60) }; })()`;
async function clickText(cdp, selector, text, wait = 600) {
  const hit = await cdp.eval(byText(selector, text));
  if (!hit) throw new Error(`not found: ${selector} ~ ${text}`);
  await cdp.click(hit.x, hit.y); log("click", hit); await sleep(wait); return hit;
}
async function runCommand(cdp, name) {
  await cdp.key("p", 4, "KeyP", "p"); await sleep(700);
  await cdp.type(name); await sleep(700);
  const hit = await cdp.eval(byText(".prompt-results .suggestion-item", name));
  if (!hit) throw new Error("palette item missing: " + name);
  await cdp.key("Enter", 0, "Enter"); log("command", name); await sleep(1200);
}
const storeState = `(() => { const s = app.plugins.plugins["margin-study"].store; return {
  hasDesktopMainConflict: s.hasDesktopMainConflict(), conflictPath: s.conflictPath, lastSaveError: s.lastSaveError,
  mainDirty: s.mainDirty, saveTimer: s.saveTimer, saveIdle: !!s.saveIdle, loadBlocked: s.loadBlocked,
  revision: s.getRevision(), pending: s.pendingConflict ? { local: s.pendingConflict.local.cards?.[0]?.front, remote: s.pendingConflict.remote.cards?.[0]?.front } : null,
  cards: s.cards.map(c => c.front), counts: { studySets: s.studySets.length, cards: s.cards.length, nodes: s.nodes.length, edges: s.edges.length,
    reviewLogs: (s.reviewLogs||[]).length, reviewPending: Object.keys(s.reviewPending||{}).length, documents: s.documents.length } }; })()`;

// ---------- phase 1: cold start on v2 ----------
const removed1 = dropUpdateCache();
const run1 = launchObsidian({ root, stage: "initial" });
const cdp = await CDP.connect(90000);
await waitWorkspace(cdp);
await cdp.eval(observer);
const version1 = await cdp.eval("document.title");
const renderer1 = await cdp.eval("process.pid");
log("initial-launch", { hostPid: run1.pid, rendererPid: renderer1, title: version1, droppedUpdateCache: removed1 });

// trust prompt -> community plugins settings
let trust = null;
for (let i = 0; i < 80 && !trust; i++) {
  trust = await cdp.eval(`(() => { const m = document.querySelector(".modal-container");
    if (!m || !m.innerText.includes("信任")) return null; const b = [...m.querySelectorAll("button")].find(x => x.innerText.includes("信任仓库作者"));
    if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), label: b.innerText.trim() }; })()`);
  if (!trust) await sleep(250);
}
if (trust) { await cdp.click(trust.x, trust.y); log("click", { target: "trust-vault", ...trust }); await sleep(1500); }
let rowReady = null;
for (let i = 0; i < 80 && !rowReady; i++) {
  rowReady = await cdp.eval(`(() => { const row = [...document.querySelectorAll(".setting-item")].find(r => r.innerText.includes("MarginStudy"));
    if (!row) return null; const t = row.querySelector(".checkbox-container"); if (!t) return null;
    const r = t.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), on: t.classList.contains("is-enabled") }; })()`);
  if (!rowReady) await sleep(250);
}
log("settings-ready", rowReady);

// arm the external writer before the plugin can load
const racer = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), "race.mjs"), root, "burst", "900"], { stdio: "ignore", detached: true });
racer.unref();
log("external-writer-armed", { pid: racer.pid });

// enable the plugin through the settings toggle
const toggle = rowReady;
if (!toggle) throw new Error("MarginStudy toggle not visible");
await cdp.click(toggle.x, toggle.y); log("click", { target: "MarginStudy plugin toggle", ...toggle });
await sleep(1200);
for (let i = 0; i < 40; i++) { if (await cdp.eval(`!!(app.plugins.plugins["margin-study"] && app.plugins.plugins["margin-study"].store.hasDesktopMainConflict())`)) break; await sleep(250); }
const noticesLive = await cdp.eval("window.__f08Notices"); log("notices-after-load", noticesLive);
await cdp.screenshot(path.join(out, "notice.png"));
await cdp.key("Escape", 0, "Escape"); await sleep(800);   // close settings
const live1 = await cdp.eval(storeState);
jsonWrite(path.join(out, "state-after-conflict.json"), { capturedAt: now(), store: live1, notices: noticesLive, disk: snapshotDisk("after-conflict") });

// real-UI card edit -> dirty while writes stay paused
await clickText(cdp, ".ms-btn", "编辑卡片", 1000);
const editorOpen = await cdp.eval(`!!document.querySelector(".ms-native-card-editor-bg")`);
if (editorOpen) {
  const box = await cdp.eval(`(() => { const e = document.querySelector(".ms-native-card-note"); const r = e.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
  await cdp.click(box.x, box.y); await sleep(200);
  await cdp.type("F08 autosave must stay blocked");
  await clickText(cdp, ".ms-native-card-editor-bg button, .ms-native-card-editor-bg .ms-btn", "保存", 1200);
}
const live2 = await cdp.eval(storeState);
jsonWrite(path.join(out, "state-after-edit.json"), { capturedAt: now(), editorOpened: editorOpen, store: live2, notices: await cdp.eval("window.__f08Notices"), disk: snapshotDisk("after-real-ui-edit") });

// real-UI explicit flush attempt (command palette)
await runCommand(cdp, "立即保存学习库");
await sleep(1200);
const afterCommand = await cdp.eval(storeState);
jsonWrite(path.join(out, "ui-flush-attempt.json"), { capturedAt: now(), command: "立即保存学习库", storeAfter: afterCommand, notices: await cdp.eval("window.__f08Notices"), disk: snapshotDisk("after-ui-flush-attempt") });

// explicit flush observation from the app console (records the thrown error verbatim)
const flushObs = await cdp.eval(`(async () => { const s = app.plugins.plugins["margin-study"].store; const out = { before: { dirty: s.mainDirty, timer: s.saveTimer } };
  try { await s.flush(); out.thrown = null; out.outcome = "resolved"; } catch (e) { out.thrown = String(e); out.thrownName = e && e.constructor && e.constructor.name; }
  out.after = { dirty: s.mainDirty, timer: s.saveTimer, conflict: s.hasDesktopMainConflict() }; return out; })()`);
jsonWrite(path.join(out, "flush-observation.json"), { capturedAt: now(), channel: "app renderer console (Runtime.evaluate on the live page)", observation: flushObs });

fs.copyFileSync(path.join(root, "external.json"), path.join(out, "data.json.external"));
fs.copyFileSync(mainPath, path.join(out, "data.json.after-blocked-flush"));
const afterBlocked = snapshotDisk("after-blocked-flush"); log("disk-after-blocked-flush", afterBlocked);
await cdp.screenshot(path.join(out, "state-blocked.png"));

// ---------- phase 2: quit, immediate post-exit capture ----------
cdp.close();
execFileSync("/usr/bin/osascript", ["-e", 'tell application "Obsidian" to quit']);
const exited = await waitExit(run1.pid, 45000);
timeline.exit1 = now();
const postExit = snapshotDisk("post-exit");
fs.copyFileSync(mainPath, path.join(out, "data.json.post-exit"));
timeline.postExitCaptured = now();
log("quit", { exited, hostPid: run1.pid, postExit });

// ---------- phase 3: cold restart ----------
await sleep(700);
const removed2 = dropUpdateCache();
const run2 = launchObsidian({ root, stage: "restart" });
timeline.relaunch = now();
const cdp2 = await CDP.connect(90000);
await waitWorkspace(cdp2);
await cdp2.eval(observer);
let noticeAfter = null;
for (let i = 0; i < 60; i++) { const n = await cdp2.eval("window.__f08Notices"); if (n && n.length) { noticeAfter = n; break; } await sleep(200); }
await cdp2.screenshot(path.join(out, "notice-after-restart.png"));
const renderer2 = await cdp2.eval("process.pid");
const version2 = await cdp2.eval("document.title");
log("restart-launch", { hostPid: run2.pid, rendererPid: renderer2, title: version2, droppedUpdateCache: removed2, notices: noticeAfter });
const restartState = await cdp2.eval(storeState);
const afterRestart = snapshotDisk("after-restart");
fs.copyFileSync(mainPath, path.join(out, "data.json.after-restart"));
jsonWrite(path.join(out, "state-after-restart.json"), { capturedAt: now(), store: restartState, notices: noticeAfter, disk: afterRestart });

// ---------- phase 4: resolve through the real conflict dialog ----------
await runCommand(cdp2, "处理保存冲突");
const modal = await cdp2.eval(`(() => { const m = [...document.querySelectorAll(".ms-modal")].filter(x => x.getClientRects().length).pop();
  if (!m) return null; const buttons = [...m.querySelectorAll("button")].map(b => { const r = b.getBoundingClientRect();
    return { text: b.innerText.trim(), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), disabled: b.disabled }; });
  return { text: m.innerText.slice(0, 400), buttons, openDialogs: document.querySelectorAll(".ms-modal").length }; })()`);
if (!modal) throw new Error("conflict dialog did not open");
jsonWrite(path.join(out, "conflict-dialog.json"), { capturedAt: now(), modal });
await cdp2.screenshot(path.join(out, "conflict-dialog.png"));
const wanted = choice === "local" ? "采用本地候选" : "采用外部版本";
const button = modal.buttons.find(b => b.text === wanted);
if (!button) throw new Error("choice button missing: " + wanted);
await cdp2.click(button.x, button.y);
log("click", { target: wanted, ...button });
await sleep(3000);
const resolvedState = await cdp2.eval(storeState);
const resolvedNotices = await cdp2.eval("window.__f08Notices");
await cdp2.screenshot(path.join(out, "resolved.png"));
const diskAfterResolve = snapshotDisk("after-resolution");
const resolvedDir = fs.readdirSync(pluginDir).filter(n => /^data\.json\.ms-replace-.*\.resolved$/.test(n));
const resolvedFiles = {};
for (const dir of resolvedDir) { resolvedFiles[dir] = {}; for (const f of fs.readdirSync(path.join(pluginDir, dir))) resolvedFiles[dir][f] = shaFile(path.join(pluginDir, dir, f)); }
if (resolvedDir.length) {
  fs.mkdirSync(path.join(out, "resolved-backup"), { recursive: true });
  for (const dir of resolvedDir) for (const f of fs.readdirSync(path.join(pluginDir, dir))) fs.copyFileSync(path.join(pluginDir, dir, f), path.join(out, "resolved-backup", `${caseName}.${f}`));
}
fs.copyFileSync(mainPath, path.join(out, "data.json.resolved"));
const diskJson = JSON.parse(fs.readFileSync(mainPath, "utf8"));
const recovery = path.join(setup.vault, "_marginstudy-recovery");
const recoveryFiles = fs.existsSync(recovery) ? Object.fromEntries(fs.readdirSync(recovery).map(n => [n, fs.existsSync(path.join(recovery, n)) ? (fs.statSync(path.join(recovery, n)).isDirectory() ? "dir" : shaFile(path.join(recovery, n))) : "?"])) : {};
jsonWrite(path.join(out, "after-resolution.json"), {
  capturedAt: now(), choice, resolvedState, notices: resolvedNotices, resolvedDirs: resolvedFiles, disk: diskAfterResolve,
  diskMain: { schemaVersion: diskJson.schemaVersion, revision: diskJson.revision, cardFronts: (diskJson.cards ?? []).map(c => c.front), cards: (diskJson.cards ?? []).length },
  recoveryDir: { path: "_marginstudy-recovery", entries: recoveryFiles },
});
timeline.afterResolutionCaptured = now();

// ---------- phase 5: final exit ----------
cdp2.close();
execFileSync("/usr/bin/osascript", ["-e", 'tell application "Obsidian" to quit']);
const exited2 = await waitExit(run2.pid, 45000);
timeline.exit2 = now();
const finalExit = snapshotDisk("final-exit");
timeline.finalExitCaptured = now();
jsonWrite(path.join(out, "timeline.json"), { case: caseName, timeline, events });

const hashes = {
  external: shaFile(path.join(out, "data.json.external")),
  afterBlockedFlush: shaFile(path.join(out, "data.json.after-blocked-flush")),
  postExit: shaFile(path.join(out, "data.json.post-exit")),
  afterRestart: shaFile(path.join(out, "data.json.after-restart")),
  resolved: shaFile(path.join(out, "data.json.resolved")),
  finalExit: finalExit.dataJson,
  setupOriginal: setup.originalSha256, setupExternal: setup.externalSha256,
  candidate: resolvedFiles[resolvedDir[0]]?.["candidate.json"] ?? null,
  displaced: resolvedFiles[resolvedDir[0]]?.["displaced.json"] ?? null,
  expected: resolvedFiles[resolvedDir[0]]?.["expected.sha256"] ?? null,
};
jsonWrite(path.join(out, "hashes.json"), { capturedAt: now(), hashes, resolvedFiles, finalExit, postExit, afterRestart, timeline });
jsonWrite(path.join(out, "env.json"), {
  case: caseName, commit: "f78573e8b5f5660bdf19af26fc9fd0ac75cd14db", port: 9333,
  vault: setup.vault, profile: setup.profile, home: setup.home, root,
  obsidianTitles: { initial: version1, restart: version2 },
  bundle: execFileSync("/usr/bin/defaults", ["read", "/Applications/Obsidian.app/Contents/Info.plist", "CFBundleShortVersionString"], { encoding: "utf8" }).trim(),
  pids: { initial: { host: run1.pid, renderer: renderer1 }, restart: { host: run2.pid, renderer: renderer2 } },
  installed: setup.installed, installedMatchesBuildManifest: Object.entries(setup.installed).every(([n, h]) => h === JSON.parse(fs.readFileSync(path.join(repo, "evidence/f08-f78573e-20261121/exec/build-manifest.json"), "utf8")).artifacts[n]),
  launcher: `CFFIXED_USER_HOME=${setup.home} /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir=${setup.profile} --remote-debugging-port=9333`,
  updateCacheDropped: { initial: removed1, restart: removed2 },
  externalWriter: { pid: racer.pid, script: "race.mjs", firstWriteDelayMs: 8, spanMs: 900 },
});
console.log(JSON.stringify({ case: caseName, root, hashes, live: live2, restart: restartState, resolved: resolvedState, diskMain: diskJson.schemaVersion }, null, 2));
