// F08 A3 driver: real import button -> native macOS file panel -> full import.
// Modes: "panel" (capture panel AX + land the import), "before" (import then immediate SIGKILL),
//        "after" (import, restart, re-import same archive).
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CDP, launchObsidian, waitWorkspace, waitExit, shaFile, jsonWrite, sleep, now } from "./lib.mjs";
import { connect, runCommand } from "./a3lib.mjs";

const mode = process.argv[2];
const out = process.env.F08_OUT;
const repo = fileURLToPath(new URL("../../", import.meta.url));
const stepsLog = path.join(out, "steps.log");
process.env.F08_STEPS_LOG = stepsLog;
const events = [];
const clean = value => JSON.parse(JSON.stringify(value ?? null, (k, v) => (/png_b64|screenshot_png/.test(k) ? `<stripped ${String(v).length} base64 chars>` : v)));
const log = (label, value) => { const safe = clean(value); events.push({ at: now(), label, ...(safe === null ? {} : { value: safe }) }); fs.appendFileSync(stepsLog, `${now()} ${label} ${JSON.stringify(safe)}\n`); };
const timeline = {};
const cua = (...args) => {
  const r = spawnSync("cua-driver", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const text = r.stdout || r.stderr;
  const start = text.indexOf("{");
  if (start < 0) throw new Error("cua output: " + text.slice(0, 400));
  return JSON.parse(text.slice(start));
};
const script = (body, timeout = 60000) => cua("run_script", JSON.stringify({ session: "f08a3", timeout_ms: timeout, script: body }));

const scenario = mode === "panel" ? "a3-before" : `a3-${mode}`;
const root = execFileSync(process.execPath, [path.join(repo, ".agent-artifacts/f08-executor/prepare-host.mjs"), scenario, path.join(repo, ".agent-artifacts/f08-executor/install")], { encoding: "utf8" }).trim();
const fixtureInfo = JSON.parse(execFileSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), "mkfixture.mjs"), root], { encoding: "utf8" }).trim());
const setup = JSON.parse(fs.readFileSync(path.join(root, "setup.json"), "utf8"));
fs.copyFileSync(path.join(root, "fixture.marginstudy-set.zip"), path.join(out, "archive.zip"));
const pluginDir = path.join(setup.vault, ".obsidian/plugins/margin-study");
const mainPath = path.join(pluginDir, "data.json");
const manifest = JSON.parse(fs.readFileSync(path.join(repo, "evidence/f08-f78573e-20261121/exec/build-manifest.json"), "utf8"));
jsonWrite(path.join(out, "setup.json"), setup);
jsonWrite(path.join(out, "fixture.json"), fixtureInfo);
const envRows = { case: mode, root, vault: setup.vault, profile: setup.profile, port: 9333, archive: setup.archive, archiveSha256: setup.archiveSha256 };

const storeSnapshot = `(() => { const s = app.plugins.plugins["margin-study"].store; const data = s.data(false);
  const collections = {}; for (const k of ["studySets","cards","nodes","edges","canvases","documents","reviewLogs","practiceAttempts","reviewDecks","localEvents"]) collections[k] = (data[k]||[]).map(x => (x ? x.id : null));
  return { counts: Object.fromEntries(Object.entries(collections).map(([k,v]) => [k, v.length])), ids: collections,
    studySetNames: (data.studySets||[]).map(x => x.name), cardFronts: (data.cards||[]).map(x => x.front),
    reviewPending: Object.keys(data.reviewPending ?? {}).length,
    annotations: null, notices: [...document.querySelectorAll(".notice")].map(n => n.textContent), f08: window.__f08Notices ?? [] }; })()`;

async function frameAndZip(cdp) { return await cdp.eval(`(() => { const m = [...document.querySelectorAll(".ms-modal")].filter(x => x.getClientRects().length).pop();
  if (!m) return null; const buttons = [...m.querySelectorAll("button")].map(b => { const r = b.getBoundingClientRect(); return { text: b.innerText.trim(), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; });
  return { text: m.innerText.slice(0, 300), buttons }; })()`); }

async function panelNavigate(hostName) {
  return script(`const app = await cua.getApp({pid: ${globalThis.__f08Pid}, windowId: ${globalThis.__f08Win}});
    const st = await app.getState({max_elements: 900, tree_format: "elements"});
    const pop = st.elements.find(e => e.role === "AXPopUpButton" && /位置/.test(e.label||""));
    const out = { location: pop && pop.value, steps: [] };
    const openItem = async (name) => { const st2 = await app.getState({max_elements: 900, tree_format: "elements"}); const item = st2.elements.find(e => e.role==="AXMenuItem" && e.label===name); if (!item) return false; await app.click(item.element_token); await cua.sleep(1200); return true; };
    const scrollAndFind = async (name) => {
      const st2 = await app.getState({max_elements: 900, tree_format: "elements"});
      const hit = st2.elements.find(e => e.role==="AXTextField" && e.value===name);
      if (hit) return hit;
      const outline = st2.elements.find(e => e.role==="AXOutline");
      if (outline) { try { await app.scroll(outline.element_token, "down", 6); } catch (e) {} await cua.sleep(600); }
      const st3 = await app.getState({max_elements: 900, tree_format: "elements"});
      return st3.elements.find(e => e.role==="AXTextField" && e.value===name) ?? null;
    };
    if (!out.location || out.location !== ${JSON.stringify(hostName)}) {
      if (pop) { await app.click(pop.element_token, {action: "press"}); await cua.sleep(700); }
      const jumped = await openItem("tmp");
      out.steps.push({ jumpedToTmp: jumped });
      const host = await scrollAndFind(${JSON.stringify(hostName)});
      if (!host) return { ...out, error: "host row not found" };
      try { await app.click(host.element_token, {action: "open"}); } catch (e) { out.openError = String(e); }
      await cua.sleep(1500);
    }
    const st4 = await app.getState({max_elements: 900, tree_format: "elements"});
    const pop4 = st4.elements.find(e => e.role === "AXPopUpButton" && /位置/.test(e.label||""));
    out.afterLocation = pop4 && pop4.value;
    return out;`);
}

// ---------- phase 1: bring-up, real import ----------
const { cdp, run, renderer, title, droppedUpdateCache } = await connect(root, "initial");
const hostPid = run.pid;
envRows.pids = { initial: { host: hostPid, renderer } };
envRows.obsidianTitles = { initial: title };
envRows.bundleVersion = execFileSync("/usr/bin/defaults", ["read", "/Applications/Obsidian.app/Contents/Info.plist", "CFBundleShortVersionString"], { encoding: "utf8" }).trim();
envRows.installed = setup.installed;
envRows.installedMatchesBuildManifest = Object.entries(setup.installed).every(([n, h]) => h === manifest.artifacts[n]);
envRows.updateCacheDropped = { initial: droppedUpdateCache };
envRows.launcher = `CFFIXED_USER_HOME=${setup.home} /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir=${setup.profile} --remote-debugging-port=9333`;
await cdp.eval(`(() => { if (window.__f08Notices) return 1; window.__f08Notices = []; new MutationObserver(() => { for (const n of document.querySelectorAll(".notice")) { const t = n.textContent; if (t && !window.__f08Notices.some(x => x.text === t)) window.__f08Notices.push({ at: new Date().toISOString(), text: t }); } }).observe(document.body, { childList: true, subtree: true }); return 1; })()`);
timeline.launched = now();
const diskBefore = { at: now(), dataJson: shaFile(mainPath), mtime: fs.statSync(mainPath).mtime.toISOString() };
fs.copyFileSync(mainPath, path.join(out, "data.json.before"));
const beforeState = await cdp.eval(storeSnapshot);

await runCommand(cdp, "导入学习集");
await sleep(800);
const dialog = await frameAndZip(cdp);
if (!dialog) throw new Error("import dialog missing");
jsonWrite(path.join(out, "import-dialog.json"), { capturedAt: now(), dialog });
const choose = dialog.buttons.find(b => b.text.includes("选择文件"));
await cdp.click(choose.x, choose.y);
log("click", { target: "选择文件…", ...choose });
await sleep(2500);
const wins = cua("list_windows", `--pid`, String(hostPid)).windows;
const panelWin = wins.find(w => w.title === "打开");
if (!panelWin) throw new Error("native panel window missing");
log("native-panel-open", { window_id: panelWin.window_id, title: panelWin.title, bounds: panelWin.bounds });
globalThis.__f08Pid = hostPid; globalThis.__f08Win = wins.find(w => w.title.includes("Obsidian")).window_id ?? 10163;
const nav = await panelNavigate(path.basename(root));
log("panel-navigate", nav);
// capture the panel surface itself
const panelShot = cua("get_window_state", JSON.stringify({ pid: hostPid, window_id: panelWin.window_id, session: "f08a3", max_elements: 40 }));
if (panelShot.screenshot_png_b64) fs.writeFileSync(path.join(out, "panel.png"), Buffer.from(panelShot.screenshot_png_b64, "base64"));
const dumpPanel = label => script(`const app = await cua.getApp({pid: ${hostPid}, windowId: ${globalThis.__f08Win}});
  const st = await app.getState({max_elements: 900, tree_format: "elements"});
  const sheet = st.elements.filter(e => e.role === "AXSheet" && /打开/.test(e.label||""));
  const zip = st.elements.find(e => e.role === "AXTextField" && e.value === "fixture.marginstudy-set.zip");
  const panelButtons = st.elements.filter(e => e.role === "AXButton" && e.frame && e.frame.y > 600 && e.frame.y < 660 && e.frame.x > 900).map(b => ({ t: b.element_token, l: b.label, f: b.frame, en: b.enabled }));
  return { label: ${JSON.stringify(label)}, process: { pid: ${hostPid}, window_id: ${globalThis.__f08Win} },
    sheets: st.elements.filter(e => e.role==="AXSheet").map(s => ({ role: s.role, label: s.label, frame: s.frame })),
    sheetMatched: sheet.map(s => ({ role: s.role, label: s.label, frame: s.frame })),
    zip: zip ? { token: zip.element_token, value: zip.value, enabled: zip.enabled, selected: zip.selected, frame: zip.frame } : null,
    panelButtons };`);
const axBefore = dumpPanel("before-selection");
jsonWrite(path.join(out, "ax-panel-before-selection.json"), { capturedAt: now(), panelWindow: { window_id: panelWin.window_id, title: panelWin.title, bounds: panelWin.bounds }, ax: axBefore.value });
log("ax-panel-captured", { label: "before-selection", zip: axBefore.value?.zip, buttons: axBefore.value?.panelButtons });
// select the archive row, verify selection, then confirm with the panel's 打开 button
const selectZip = script(`const app = await cua.getApp({pid: ${hostPid}, windowId: ${globalThis.__f08Win}});
  const st = await app.getState({max_elements: 900, tree_format: "elements"});
  const zip = st.elements.find(e => e.role === "AXTextField" && e.value === "fixture.marginstudy-set.zip");
  if (!zip) return { error: "zip row not visible" };
  const out = { zip: { token: zip.element_token, enabled: zip.enabled, selected: zip.selected }, before: zip.selected };
  try { await app.click(zip.element_token, { action: "press" }); } catch (e) { out.press = String(e); }
  await cua.sleep(900);
  const st2 = await app.getState({max_elements: 900, tree_format: "elements"});
  const zip2 = st2.elements.find(e => e.role === "AXTextField" && e.value === "fixture.marginstudy-set.zip");
  out.selectedAfter = zip2 && zip2.selected;
  return out;`, 40000);
log("panel-select", selectZip.value);
const axAfter = dumpPanel("after-selection");
jsonWrite(path.join(out, "ax-panel.json"), { capturedAt: now(), panelWindow: { window_id: panelWin.window_id, title: panelWin.title, bounds: panelWin.bounds }, selection: selectZip.value, ax: axAfter.value });
const shotFile = path.join(out, "panel.png");
const screenFile = path.join(out, "panel-screen.png");
let shotInfo = {};
try { cua("bring_to_front", JSON.stringify({ pid: hostPid, window_id: globalThis.__f08Win, session: "f08a3" })); } catch (error) { shotInfo.bringToFront = String(error); }
await sleep(600);
const desktop = cua("get_desktop_state", JSON.stringify({ session: "f08a3", screenshot_out_file: screenFile }));
const scale = Number(desktop.screenshot_width) / Number(desktop.screen_width);
const sheet = axAfter.value?.sheetMatched?.[0]?.frame ?? panelWin.bounds;
const crop = `crop=${Math.round(sheet.w * scale)}:${Math.round(sheet.h * scale)}:${Math.round(sheet.x * scale)}:${Math.round(sheet.y * scale)}`;
execFileSync("/opt/homebrew/bin/ffmpeg", ["-y", "-loglevel", "error", "-i", screenFile, "-vf", crop, shotFile]);
shotInfo.channel = "cua get_desktop_state capture, cropped to the AXSheet bounds";
shotInfo.desktop = { screen_width: desktop.screen_width, screen_height: desktop.screen_height, screenshot_width: desktop.screenshot_width, screenshot_height: desktop.screenshot_height, screenshot_original_width: desktop.screenshot_original_width, capture: path.basename(screenFile), scale };
shotInfo.crop = crop;
shotInfo.bytes = fs.statSync(shotFile).size;
log("ax-panel-captured", { label: "after-selection", zip: axAfter.value?.zip, buttons: axAfter.value?.panelButtons });
const confirmZip = script(`const app = await cua.getApp({pid: ${hostPid}, windowId: ${globalThis.__f08Win}});
  const st = await app.getState({max_elements: 900, tree_format: "elements"});
  const open = st.elements.find(e => e.role === "AXButton" && e.label === "打开" && e.frame && e.frame.y > 600);
  if (!open) return { error: "confirm button missing" };
  const out = { confirm: { token: open.element_token, frame: open.frame } };
  try { await app.click(open.element_token, { action: "press" }); } catch (e) { out.confirmError = String(e); }
  await cua.sleep(2500);
  out.windowsAfter = (await cua.listWindows({pid: ${hostPid}})).map(w => ({ id: w.window_id, t: w.title }));
  return out;`, 40000);
jsonWrite(path.join(out, "panel-selection.json"), { capturedAt: now(), selection: selectZip.value, confirm: confirmZip.value });
log("panel-confirm", confirmZip.value);
const panelClosed = !(confirmZip.value?.windowsAfter ?? []).some(w => w.title === "打开");
timeline.panelConfirmed = now();
// wait for the import to land (main data hash changes) and for the notice
let importDone = null;
for (let i = 0; i < 120; i++) {
  const hash = shaFile(mainPath);
  const st = await cdp.eval(storeSnapshot);
  if (hash !== diskBefore.dataJson || (st.f08 && st.f08.some(n => /已导入|此包已导入|导入失败/.test(n.text)))) { importDone = { at: now(), hash, state: st }; break; }
  await sleep(250);
}
if (!importDone) throw new Error("import did not land");
await sleep(2500);
const afterState = await cdp.eval(storeSnapshot);
const diskAfter = { at: now(), dataJson: shaFile(mainPath), mtime: fs.statSync(mainPath).mtime.toISOString() };
fs.copyFileSync(mainPath, path.join(out, "data.json.after-import"));
timeline.afterImport = now();
const data = JSON.parse(fs.readFileSync(mainPath, "utf8"));
jsonWrite(path.join(out, "state-after-import.json"), { capturedAt: now(), importDone: importDone && { at: importDone.at, hash: importDone.hash }, before: beforeState, after: afterState, dataJsonInspect: {
  schemaVersion: data.schemaVersion, studySets: (data.studySets ?? []).map(s => ({ id: s.id, name: s.name, cardIds: s.cardIds, docPaths: s.docPaths })),
  cards: (data.cards ?? []).map(c => ({ id: c.id, front: c.front, docPath: c.docPath })), reviewLogs: (data.reviewLogs ?? []).length,
  reviewPending: Object.keys(data.reviewPending ?? {}), documents: (data.documents ?? []).map(d => d.path), collectionCounts: { studySets: (data.studySets??[]).length, cards: (data.cards??[]).length, nodes: (data.nodes??[]).length, edges: (data.edges??[]).length, reviewLogs: (data.reviewLogs??[]).length, reviewPending: Object.keys(data.reviewPending??{}).length } } });
log("import-landed", { panelClosed, hashChanged: diskAfter.dataJson !== diskBefore.dataJson, notices: afterState.f08 });
await cdp.screenshot(path.join(out, "after-import.png"));

if (mode === "panel") {
  // panel scene ends here: exit and record
  cdp.close();
  execFileSync("/usr/bin/osascript", ["-e", 'tell application "Obsidian" to quit']);
  await waitExit(hostPid, 45000);
  timeline.exit1 = now();
  jsonWrite(path.join(out, "env.json"), { ...envRows, timeline, events });
  jsonWrite(path.join(out, "hashes.json"), { before: diskBefore, afterImport: diskAfter, archive: setup.archiveSha256, external: null });
  console.log(JSON.stringify({ mode, root, diskBefore, diskAfter, notices: afterState.f08, panelClosed }, null, 2));
  process.exit(0);
}

// ---------- phase 2: SIGKILL right after the import landed ----------
const killAt = now();
process.kill(hostPid, "SIGKILL");
const exited = await waitExit(hostPid, 30000);
timeline.exit1 = now();
const postExit = { at: now(), dataJson: shaFile(mainPath), mtime: fs.statSync(mainPath).mtime.toISOString() };
fs.copyFileSync(mainPath, path.join(out, "data.json.post-exit"));
timeline.postExitCaptured = now();
log("sigkill", { killedAt: killAt, exited, postExit });
cdp.close();

// ---------- phase 3: relaunch, read after restart ----------
await sleep(700);
const second = await connect(root, "restart", { trust: false, enable: false });
timeline.relaunch = now();
const cdp2 = second.cdp;
await cdp2.eval(`(() => { if (window.__f08Notices) return 1; window.__f08Notices = []; new MutationObserver(() => { for (const n of document.querySelectorAll(".notice")) { const t = n.textContent; if (t && !window.__f08Notices.some(x => x.text === t)) window.__f08Notices.push({ at: new Date().toISOString(), text: t }); } }).observe(document.body, { childList: true, subtree: true }); return 1; })()`);
await sleep(2500);
const restartState = await cdp2.eval(storeSnapshot);
const afterRestart = { at: now(), dataJson: shaFile(mainPath), mtime: fs.statSync(mainPath).mtime.toISOString() };
fs.copyFileSync(mainPath, path.join(out, "data.json.after-restart"));
envRows.pids.restart = { host: second.run.pid, renderer: second.renderer };
envRows.obsidianTitles.restart = second.title;
envRows.updateCacheDropped.restart = second.droppedUpdateCache;
timeline.afterRestartCaptured = now();
await cdp2.screenshot(path.join(out, "after-restart.png"));
log("restart", { renderer: second.renderer, hash: afterRestart.dataJson, pidChanged: second.run.pid !== hostPid });

if (mode === "before") {
  const finalExit = { at: null, dataJson: null };
  cdp2.close();
  execFileSync("/usr/bin/osascript", ["-e", 'tell application "Obsidian" to quit']);
  await waitExit(second.run.pid, 45000);
  timeline.exit2 = now();
  finalExit.at = now(); finalExit.dataJson = shaFile(mainPath);
  timeline.finalExitCaptured = now();
  jsonWrite(path.join(out, "env.json"), { ...envRows, timeline, events });
  jsonWrite(path.join(out, "hashes.json"), { before: diskBefore, afterImport: diskAfter, postExit, afterRestart, finalExit, archive: setup.archiveSha256 });
  const diff = { addedKeys: [], removedKeys: [], countsBefore: beforeState.counts, countsAfter: afterState.counts, studySetsAfter: afterState.studySetNames, cardsAfter: afterState.cardFronts };
  const [a, b] = [JSON.parse(fs.readFileSync(path.join(out, "data.json.before"), "utf8")), data];
  for (const k of Object.keys(b)) if (!(k in a)) diff.addedKeys.push(k);
  for (const k of Object.keys(a)) if (!(k in b)) diff.removedKeys.push(k);
  jsonWrite(path.join(out, "structure-diff.json"), diff);
  console.log(JSON.stringify({ mode, root, hashes: { before: diskBefore.dataJson, afterImport: diskAfter.dataJson, postExit: postExit.dataJson, afterRestart: afterRestart.dataJson, finalExit: finalExit.dataJson }, pids: envRows.pids, diff }, null, 2));
  process.exit(0);
}

// ---------- mode "after": re-import the same archive ----------
await runCommand(cdp2, "导入学习集");
await sleep(800);
const dialog2 = await frameAndZip(cdp2);
if (!dialog2) throw new Error("second import dialog missing");
const choose2 = dialog2.buttons.find(b => b.text.includes("选择文件"));
await cdp2.click(choose2.x, choose2.y);
await sleep(2000);
const wins2 = cua("list_windows", `--pid`, String(second.run.pid)).windows;
const panel2 = wins2.find(w => w.title === "打开");
if (!panel2) throw new Error("second panel missing");
globalThis.__f08Pid = second.run.pid; globalThis.__f08Win = wins2.find(w => w.title.includes("Obsidian")).window_id ?? 10163;
log("second-panel-open", { window_id: panel2.window_id });
const nav2 = await panelNavigate(path.basename(root));
log("second-panel-navigate", nav2);
const retry = script(`const app = await cua.getApp({pid: ${second.run.pid}, windowId: ${globalThis.__f08Win}});
  const st = await app.getState({max_elements: 900, tree_format: "elements"});
  const zip = st.elements.find(e => e.role === "AXTextField" && e.value === "fixture.marginstudy-set.zip");
  if (!zip) return { error: "zip row not visible" };
  try { await app.click(zip.element_token, { action: "press" }); } catch (e) {}
  await cua.sleep(800);
  const st2 = await app.getState({max_elements: 900, tree_format: "elements"});
  const zip2 = st2.elements.find(e => e.role === "AXTextField" && e.value === "fixture.marginstudy-set.zip");
  const open = st2.elements.find(e => e.role === "AXButton" && e.label === "打开" && e.frame && e.frame.y > 600);
  const out = { selected: zip2 && zip2.selected, enabled: zip && zip.enabled };
  if (open) { try { await app.click(open.element_token, { action: "press" }); } catch (e) { out.err = String(e); } }
  await cua.sleep(3000);
  out.windowsAfter = (await cua.listWindows({pid: ${second.run.pid}})).map(w => ({ id: w.window_id, t: w.title }));
  return out;`, 40000);
jsonWrite(path.join(out, "retry-selection.json"), { capturedAt: now(), result: retry.value });
const afterRetryState = await cdp2.eval(storeSnapshot);
const afterRetry = { at: now(), dataJson: shaFile(mainPath), mtime: fs.statSync(mainPath).mtime.toISOString() };
fs.copyFileSync(mainPath, path.join(out, "data.json.after-retry"));
timeline.afterRetryCaptured = now();
await cdp2.screenshot(path.join(out, "after-retry.png"));
log("retry", { retry: retry.value, notices: afterRetryState.f08, hash: afterRetry.dataJson, sameAsRestart: afterRetry.dataJson === afterRestart.dataJson });
cdp2.close();
execFileSync("/usr/bin/osascript", ["-e", 'tell application "Obsidian" to quit']);
await waitExit(second.run.pid, 45000);
timeline.exit2 = now();
const finalExit = { at: now(), dataJson: shaFile(mainPath) };
timeline.finalExitCaptured = now();
jsonWrite(path.join(out, "env.json"), { ...envRows, timeline, events });
jsonWrite(path.join(out, "hashes.json"), { before: diskBefore, afterImport: diskAfter, afterRestart, afterRetry, finalExit, archive: setup.archiveSha256 });
jsonWrite(path.join(out, "retry-state.json"), { capturedAt: now(), notices: afterRetryState.f08, beforeFirst: beforeState, afterFirst: afterState, afterRetry: afterRetryState });
console.log(JSON.stringify({ mode, root, hashes: { before: diskBefore.dataJson, afterImport: diskAfter.dataJson, afterRestart: afterRestart.dataJson, afterRetry: afterRetry.dataJson, finalExit: finalExit.dataJson }, counts: { before: beforeState.counts, afterImport: afterState.counts, afterRetry: afterRetryState.counts }, notices: afterRetryState.f08 }, null, 2));
