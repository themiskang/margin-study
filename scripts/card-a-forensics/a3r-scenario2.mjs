// Card A · A3 re-do, scenario 2: daily-backup isolation on the real old library.
// backupEnabled is set to true through the real settings UI toggle (never by editing JSON);
// the scenario then cold starts twice and reports backup sidecar writes separately from the
// main-state data.json judgement.
// usage: node a3r-scenario2.mjs
import fs from "node:fs";
import path from "node:path";
import {
  NEW_BUILD, OUT_ROOT, OLD_MAIN_JS, backupTree, coldStart, inspectFile, jsonWrite, keepOriginal, note, now,
  prepareScenario, readMainState, requireNewBuild, sha256, shaFile, sixDiff, treeDiff, treeSnapshot,
  WriteWatchVault,
} from "./a3r-scenario-common.mjs";
import { ObsCdp, acceptTrust, launchObsidian, portFree, quitObsidian, runtimeProbe, settle, waitWorkspace } from "./a3r-lib.mjs";
import { clearUpdateCache, waitPlugin } from "./host.mjs";
import { sleep } from "./lib.mjs";

const OUT = path.join(OUT_ROOT, "scenario-2");
const ROOT = "/tmp/a3r-s2";
fs.mkdirSync(OUT, { recursive: true });
process.env.CA_STEPS_LOG = path.join(OUT, "steps.log");
fs.writeFileSync(process.env.CA_STEPS_LOG, "");

const newBuild = requireNewBuild();
note("new-build-verified", { mainJs: newBuild.rows["main.js"].actual, allEqualManifest: newBuild.allEqual });
const { setup, l0 } = prepareScenario({ root: ROOT, outDir: OUT, scenarioName: "scenario-2 · 每日备份隔离" });

const l0Backups = backupTree(setup.vault);
note("l0-backup-dirs", { dirs: l0Backups.dirs, files: Object.keys(l0Backups.files) });
const l0BackupFileHashes = l0Backups.files;

// ---------- session c1: real UI toggle + one real backup action ----------
if (!await portFree()) throw new Error("port 9333 busy before c1");
const c1 = {};
c1.before = readMainState(setup.mainFile);
c1.beforeOriginal = keepOriginal(setup.mainFile, path.join(OUT, "c1-before.json"));
c1.vaultBefore = treeSnapshot(setup.vault);
const watch1 = new WriteWatchVault(setup.mainFile, "c1", setup.vault);
const removedAsar = clearUpdateCache(ROOT);
const run = launchObsidian({ root: ROOT, stage: "c1" });
const cdp = await ObsCdp.attach(150000);
await waitWorkspace(cdp);
c1.trust = await acceptTrust(cdp);
c1.pluginLoaded = await waitPlugin(cdp);
c1.bundle = await runtimeProbe(cdp, setup);
c1.settleOnArrival = await settle(cdp, setup.mainFile, { quietMs: 6000 });

const ui = async (expression) => cdp.eval(expression);
c1.uiBefore = await ui(`(() => { const s = app.plugins.plugins["margin-study"].store;
  return { backupEnabled: s.settings.backupEnabled, lastBackup: s.settings.lastBackup ?? null,
    settingsModalOpen: !!document.querySelector(".mod-settings") }; })()`);

// 1) open the plugin settings through the settings surface (gear in "已安装插件", else the settings modal tab)
c1.openSettings = await (async () => {
  const steps = [];
  if (!c1.uiBefore.settingsModalOpen) {
    const gear = await ui(`(() => { const b = [...document.querySelectorAll(".mod-community-plugin .setting-icon-button, .community-plugin-item .setting-icon-button, button.clickable-icon")];
      return b.length; })()`);
    steps.push({ openedBy: "app.setting.open()", candidateButtons: gear });
    await ui(`(() => { app.setting.open(); return true; })()`);
    await sleep(800);
  }
  const tabs = await ui(`(() => [...document.querySelectorAll(".vertical-tab-nav-item")].map(el => el.innerText.trim()))()`);
  steps.push({ visibleTabs: tabs });
  const pluginTab = tabs.findIndex(text => /MarginStudy/.test(text));
  if (pluginTab < 0) {
    await ui(`(() => { app.setting.openTabById("margin-study"); return true; })()`);
    steps.push({ openedBy: "app.setting.openTabById('margin-study')" });
  } else {
    const rect = await ui(`(() => { const items = [...document.querySelectorAll(".vertical-tab-nav-item")];
      const item = items[${pluginTab}]; const r = item.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: item.innerText.trim() }; })()`);
    await cdp.click(rect.x, rect.y);
    steps.push({ clickedTab: rect });
  }
  await sleep(900);
  const rows = await ui(`(() => [...document.querySelectorAll(".setting-item")].map(item => ({
    name: (item.querySelector(".setting-item-name")?.innerText || "").trim(),
    desc: (item.querySelector(".setting-item-description")?.innerText || "").trim(),
    hasToggle: !!item.querySelector(".checkbox-container"),
    toggleChecked: item.querySelector(".checkbox-container")?.classList.contains("is-enabled") ?? null })))()`);
  steps.push({ rows: rows.length, backupRow: rows.find(row => /每日自动备份/.test(row.name)) ?? null });
  return steps;
})();
note("settings-open", c1.openSettings);

const toggleOnce = async (label) => {
  const target = await ui(`(() => {
    const item = [...document.querySelectorAll(".setting-item")].find(el => /每日自动备份/.test(el.querySelector(".setting-item-name")?.innerText || ""));
    if (!item) return null;
    item.scrollIntoView({ block: "center" });
    const box = item.querySelector(".checkbox-container");
    if (!box) return null;
    const r = box.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), viewport: { w: innerWidth, h: innerHeight },
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      checked: box.classList.contains("is-enabled"), inputChecked: !!box.querySelector("input")?.checked }; })()`);
  if (!target) throw new Error("每日自动备份 toggle not found in the settings UI");
  if (target.y < 0 || target.y > target.viewport.h) throw new Error("toggle still outside viewport: " + JSON.stringify(target));
  await cdp.click(target.x, target.y);
  await sleep(1400); // store.save() debounce is 800ms
  const after = await ui(`(() => {
    const item = [...document.querySelectorAll(".setting-item")].find(el => /每日自动备份/.test(el.querySelector(".setting-item-name")?.innerText || ""));
    const box = item?.querySelector(".checkbox-container");
    const s = app.plugins.plugins["margin-study"].store;
    return { domChecked: box?.classList.contains("is-enabled") ?? null, storeValue: s.settings.backupEnabled,
      mainDirty: s.mainDirty, saveTimer: s.saveTimer }; })()`);
  if (after.domChecked === target.checked) throw new Error(`toggle click did not change the UI state (${label}): ` + JSON.stringify({ target, after }));
  note("toggle-click", { label, target, after });
  return { label, before: { checked: target.checked, inputChecked: target.inputChecked, rect: target.rect, viewport: target.viewport }, after };
};

// 2) produce backupEnabled = true through real UI clicks (off then on when it already is true)
c1.toggles = [];
if (c1.uiBefore.backupEnabled === true) {
  c1.toggles.push(await toggleOnce("off"));
  c1.toggles.push(await toggleOnce("on"));
} else {
  c1.toggles.push(await toggleOnce("on"));
}
c1.settingsScreenshot = await cdp.screenshot(path.join(OUT, "c1-settings-toggle.png"));
c1.diskAfterToggle = readMainState(setup.mainFile);
c1.diskBodyAfterToggle = inspectFile(setup.mainFile, setup.vault).body?.settings;
note("disk-after-toggle", { disk: c1.diskAfterToggle, settings: c1.diskBodyAfterToggle });

// 3) one real backup action through the command palette entry (command "备份数据（MarginStudy）")
await ui(`(() => { app.setting.close(); return true; })()`);
await sleep(700);
const backupsBeforeAction = backupTree(setup.vault);
c1.commandPalette = { opened: null, typed: null, executed: null, backupDirsBefore: backupsBeforeAction.dirs.length };
await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "p", code: "KeyP", modifiers: 4, windowsVirtualKeyCode: 80 });
await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "p", code: "KeyP", modifiers: 4, windowsVirtualKeyCode: 80 });
await sleep(700);
c1.commandPalette.opened = await ui(`(() => { const s = document.querySelector(".prompt");
  return { visible: !!s, input: s?.querySelector("input")?.value ?? null, results: [...document.querySelectorAll(".prompt-results .suggestion-item")].map(el => el.innerText.trim()).slice(0, 6) }; })()`);
note("palette-opened", c1.commandPalette.opened);
await cdp.send("Input.insertText", { text: "备份数据" });
await sleep(900);
c1.commandPalette.typed = await ui(`(() => { const s = document.querySelector(".prompt");
  return { input: s?.querySelector("input")?.value ?? null, results: [...document.querySelectorAll(".prompt-results .suggestion-item")].map(el => el.innerText.trim()).slice(0, 6) }; })()`);
note("palette-typed", c1.commandPalette.typed);
await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await sleep(2500);
c1.commandPalette.notesAfter = await cdp.notices();
c1.backupsAfterAction = backupTree(setup.vault);
c1.commandPalette.dirsAfter = c1.backupsAfterAction.dirs;
c1.commandPalette.addedDirs = c1.backupsAfterAction.dirs.filter(dir => !backupsBeforeAction.dirs.includes(dir));
note("palette-executed", { addedDirs: c1.commandPalette.addedDirs, notices: c1.commandPalette.notesAfter });
if (!c1.commandPalette.addedDirs.length) {
  // The palette path did not land; fall back to the same command through its command id and say so.
  c1.commandPalette.fallback = await cdp.eval(`(async () => { const out = await app.commands.executeCommandById("margin-study:backup-data"); return { ran: true, out: out ?? null }; })()`).catch(error => ({ error: String(error) }));
  await sleep(3000);
  c1.backupsAfterFallback = backupTree(setup.vault);
  c1.commandPalette.addedDirsViaFallback = c1.backupsAfterFallback.dirs.filter(dir => !backupsBeforeAction.dirs.includes(dir));
}
await sleep(1500);
c1.settleAfterToggle = await settle(cdp, setup.mainFile, { quietMs: 6000 });
c1.screenshot = await cdp.screenshot(path.join(OUT, "c1.png"));
c1.notices = [...cdp.noticeLog];
c1.errors = cdp.errors().slice(-40);
cdp.close();
c1.quitExited = await quitObsidian(run.pid);
if (!c1.quitExited) (await import("node:child_process")).execFileSync("/bin/sh", ["-c", `kill -9 ${run.pid} 2>/dev/null || true`]);
await sleep(1500);
c1.watch = watch1.stop();
c1.after = readMainState(setup.mainFile);
c1.afterOriginal = keepOriginal(setup.mainFile, path.join(OUT, "c1-after.json"));
c1.vaultAfter = treeSnapshot(setup.vault);
c1.backupsAfter = backupTree(setup.vault);
c1.inspection = inspectFile(setup.mainFile, setup.vault);
c1.six = sixDiff(c1.before, c1.after);

// ---------- cold starts c2 and c3: no interaction at all ----------
const c2 = await coldStart({ setup, outDir: OUT, index: 2 });
const c3 = await coldStart({ setup, outDir: OUT, index: 3 });

const backupFilesOf = (backups, dirs) => Object.entries(backups.files)
  .filter(([file]) => dirs.some(dir => file.startsWith(dir + "/")))
  .map(([file, info]) => ({ path: `MarginStudyBackups/${file}`, sha256: info.sha256, size: info.size }));

const c1BackupDiff = treeDiff(c1.vaultBefore, c1.vaultAfter);
const c2BackupDiff = c2.vault.diff;
const c3BackupDiff = c3.vault.diff;

const report = {
  capturedAt: now(),
  scenario: "scenario-2 · 每日备份写入隔离（真实 UI 开关 + 真实备份动作）",
  judgedInThisScenario: [
    "备份写入只发生在它该发生的时机；备份侧车文件与主状态 data.json 分开列",
    "冷启#2：主状态 data.json 零写盘、revision 差值 0、六项全等",
  ],
  builds: { old: { commit: "f78573e8b5f5660bdf19af26fc9fd0ac75cd14db", mainJs: OLD_MAIN_JS },
    new: { commit: NEW_BUILD.commit, mainJs: newBuild.rows["main.js"].actual, artifacts: newBuild.rows } },
  library: { L0: { dataSha256: l0.dataSha256, size: l0.dataSize, vaultFileCount: l0.vaultFileCount,
      original: "legacy-library/data.json", report: "legacy-library/legacy-library.json" },
    hostRoot: setup.root, vault: setup.vault,
    backupDirsBeforeScenario: l0Backups.dirs,
    backupFilesBeforeScenario: backupFilesOf({ files: l0BackupFileHashes }, l0Backups.dirs),
    note: "L0 里的备份目录由旧构建那次加载的每日自动备份写出（settings.lastBackup 已为当天），本场景未新增写入前先记录它们" },
  coldStart1ToggleSession: {
    hostPid: run.pid, rendererPid: c1.bundle?.probe?.rendererPid, obsidianVersion: c1.bundle?.probe?.obsidianVersion,
    trustClicked: !!c1.trust, removedAsar, settingsUi: c1.openSettings, toggles: c1.toggles,
    settingsScreenshot: c1.settingsScreenshot,
    settingsOnArrival: c1.uiBefore, diskAfterToggle: { metrics: c1.diskAfterToggle, settings: c1.diskBodyAfterToggle },
    commandPalette: { opened: c1.commandPalette.opened, typed: c1.commandPalette.typed,
      addedDirs: c1.commandPalette.addedDirs, addedDirsViaFallback: c1.commandPalette.addedDirsViaFallback ?? null,
      fallback: c1.commandPalette.fallback ?? null, notices: c1.commandPalette.notesAfter },
    backupWrites: { dirsAdded: c1.backupsAfter.dirs.filter(dir => !l0Backups.dirs.includes(dir)),
      filesWritten: backupFilesOf(c1.backupsAfter, c1.backupsAfter.dirs.filter(dir => !l0Backups.dirs.includes(dir))) },
    mainStateWrites: { contentWrites: c1.watch.contentWrites, touches: c1.watch.touches, states: c1.watch.states },
    dataJsonBefore: c1.before, dataJsonAfter: c1.after, six: c1.six,
    settle: c1.settleAfterToggle, notices: c1.notices, errors: c1.errors,
    screenshot: c1.screenshot, quitExited: c1.quitExited,
    vaultTreeDiff: { added: c1BackupDiff.added, changed: c1BackupDiff.changed, removed: c1BackupDiff.removed },
  },
  coldStart2: {
    dataJsonBefore: c2.before.realFile, dataJsonAfter: c2.after.realFile, six: c2.six,
    writeWatch: { contentWrites: c2.writeWatch.contentWrites, touches: c2.writeWatch.touches, states: c2.writeWatch.states },
    backup: { dirsBefore: c2.backup.before.dirs, dirsAfter: c2.backup.after.dirs, dirsAdded: c2.backup.addedDirs,
      filesWritten: backupFilesOf(c2.backup.after, c2.backup.addedDirs) },
    vaultTreeDiff: { added: c2BackupDiff.added, changed: c2BackupDiff.changed, removed: c2BackupDiff.removed },
    session: { hostPid: c2.session.hostPid, rendererPid: c2.session.rendererPid, obsidianVersion: c2.session.bundle?.probe?.obsidianVersion,
      trustClicked: !!c2.session.trust, removedAsar: c2.session.removedAsar, settle: c2.session.settle,
      notices: c2.session.notices, errors: c2.session.errors.length, screenshot: c2.session.screenshot, quitExited: c2.session.quitExited },
    stateAfter: { settings: c2.inspection.body.settings, revision: c2.inspection.body.revision,
      localEventKinds: c2.inspection.body.localEventKinds, backupDirs: c2.backup.after.dirs },
  },
  coldStart3: {
    dataJsonBefore: c3.before.realFile, dataJsonAfter: c3.after.realFile, six: c3.six,
    writeWatch: { contentWrites: c3.writeWatch.contentWrites, touches: c3.writeWatch.touches, states: c3.writeWatch.states },
    backup: { dirsBefore: c3.backup.before.dirs, dirsAfter: c3.backup.after.dirs, dirsAdded: c3.backup.addedDirs,
      filesWritten: backupFilesOf(c3.backup.after, c3.backup.addedDirs) },
    vaultTreeDiff: { added: c3BackupDiff.added, changed: c3BackupDiff.changed, removed: c3BackupDiff.removed },
    session: { hostPid: c3.session.hostPid, rendererPid: c3.session.rendererPid, obsidianVersion: c3.session.bundle?.probe?.obsidianVersion,
      trustClicked: !!c3.session.trust, removedAsar: c3.session.removedAsar, settle: c3.session.settle,
      notices: c3.session.notices, errors: c3.session.errors.length, screenshot: c3.session.screenshot, quitExited: c3.session.quitExited },
    stateAfter: { settings: c3.inspection.body.settings, revision: c3.inspection.body.revision,
      localEventKinds: c3.inspection.body.localEventKinds, backupDirs: c3.backup.after.dirs },
  },
  comparisons: {
    c2BeforeVsC2After: { allSixEqual: c2.six.allSixEqual, revisionDelta: c2.six.revisionDelta, localEventsDelta: c2.six.localEventsDelta },
    c3BeforeVsC3After: { allSixEqual: c3.six.allSixEqual, revisionDelta: c3.six.revisionDelta, localEventsDelta: c3.six.localEventsDelta },
    c2AfterVsC3Before: (() => { const diff = sixDiff(c2.after.realFile, c3.before.realFile);
      return { allSixEqual: diff.allSixEqual, revisionDelta: diff.revisionDelta }; })(),
  },
  originals: { c1Before: "c1-before.json", c1After: "c1-after.json", c2Before: "c2-before.json", c2After: "c2-after.json",
    c3Before: "c3-before.json", c3After: "c3-after.json" },
};
jsonWrite(path.join(OUT, "report.json"), report);

const key = {
  scenario: 2,
  oldBuildMainJs: OLD_MAIN_JS,
  newBuildMainJs: newBuild.rows["main.js"].actual,
  legacyLibrary: { dataSha256: l0.dataSha256, backupDirs: l0Backups.dirs, backupFiles: backupFilesOf({ files: l0BackupFileHashes }, l0Backups.dirs) },
  toggleSession: {
    settingsOnArrival: c1.uiBefore,
    clicks: c1.toggles.map(row => ({ label: row.label, domCheckedAfter: row.after.domChecked, storeValueAfter: row.after.storeValue })),
    settingsOnDiskAfterToggle: c1.diskBodyAfterToggle,
    backupDirsAdded: report.coldStart1ToggleSession.backupWrites.dirsAdded,
    backupFilesWritten: report.coldStart1ToggleSession.backupWrites.filesWritten,
    mainStateContentWrites: c1.watch.contentWrites,
    mainStateWriteStates: c1.watch.states.map(state => ({ at: state.at, revision: state.revision, lastEventKind: state.lastEventKind,
      settings: state.settings })),
  },
  coldStart2: { contentWrites: c2.writeWatch.contentWrites, revisionDelta: c2.six.revisionDelta, allSixEqual: c2.six.allSixEqual,
    backupDirsAdded: c2.backup.addedDirs, settings: c2.inspection.body.settings },
  coldStart3: { contentWrites: c3.writeWatch.contentWrites, revisionDelta: c3.six.revisionDelta, allSixEqual: c3.six.allSixEqual,
    backupDirsAdded: c3.backup.addedDirs, settings: c3.inspection.body.settings },
  backupDirsTotalAfter: c3.backup.after.dirs,
};
jsonWrite(path.join(OUT, "key-numbers.json"), key);
console.log(JSON.stringify(key, null, 2));