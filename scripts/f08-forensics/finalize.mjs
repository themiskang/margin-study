// F08 forensics finalizer: complete env.json, write byte/JSON diff artifacts, observations, RESULT.json manifest.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = process.env.F08_FORENSICS;
const commit = "f78573e8b5f5660bdf19af26fc9fd0ac75cd14db";
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const cases = ["a1-local", "a1-remote", "a3-native-panel", "a3-before", "a3-after"];

for (const name of ["a3-native-panel", "a3-before", "a3-after"]) {
  const file = path.join(root, name, "env.json");
  const env = read(file);
  env.commit = commit;
  env.installed = Object.fromEntries(["main.js", "manifest.json", "styles.css", "pdf.worker.js"].map(f => [f, shaOf(path.join(env.vault, ".obsidian/plugins/margin-study", f))]));
  fs.writeFileSync(file, json(env));
}
function shaOf(file) { return sha(file); }

// byte diffs
const byteDiff = (dir, left, right, out) => {
  const a = path.join(root, dir, left), b = path.join(root, dir, right);
  let cmp = "";
  try { execFileSync("cmp", [a, b], { encoding: "utf8" }); cmp = "identical: cmp exit 0, 0 differing bytes"; }
  catch (error) { const lines = execFileSync("sh", ["-c", `cmp -l "${a}" "${b}" | wc -l`], { encoding: "utf8" }).trim(); cmp = `cmp exit ${error.status}; differing byte positions: ${lines}`; }
  const text = [`left  = ${left}  sha256=${sha(a)}`, `right = ${right}  sha256=${sha(b)}`, cmp, "",
    `reference: shasum -a 256 -c <<'EOF'`, `${sha(a)}  ${left}`, `${sha(b)}  ${right}`, "EOF", ""].join("\n");
  fs.writeFileSync(path.join(root, dir, out), text);
  return text.split("\n")[2];
};
const beforeByte = byteDiff("a3-before", "data.json.after-import", "data.json.after-restart", "byte-diff-after-import-vs-after-restart.txt");
const afterByte = byteDiff("a3-after", "data.json.after-restart", "data.json.after-retry", "byte-diff-after-restart-vs-after-retry.txt");
const afterByte2 = byteDiff("a3-after", "data.json.after-import", "data.json.after-restart", "byte-diff-after-import-vs-after-restart.txt");

// observations
const a1 = (dir, expectFront, resolvedHash) => {
  const live = read(path.join(root, dir, "state-after-edit.json"));
  const conflict = read(path.join(root, dir, "state-after-conflict.json"));
  const restart = read(path.join(root, dir, "state-after-restart.json"));
  const flush = read(path.join(root, dir, "flush-observation.json"));
  const uiFlush = read(path.join(root, dir, "ui-flush-attempt.json"));
  const hashes = read(path.join(root, dir, "hashes.json"));
  const resolution = read(path.join(root, dir, "after-resolution.json"));
  const env = read(path.join(root, dir, "env.json"));
  const dialog = read(path.join(root, dir, "conflict-dialog.json"));
  return {
    case: dir,
    criteria: [
      { criterion: "界面出现「发现主数据外部修改，已暂停写入」", observed: { noticeTexts: conflict.notices.map(n => n.text), noticeTextsAfterRestart: restart.notices.map(n => n.text), screenshot: "notice.png", screenshotAfterRestart: "notice-after-restart.png" } },
      { criterion: "内存态 dirty===true、saveTimer===null", observed: { afterRealUiCardEdit: { mainDirty: live.store.mainDirty, saveTimer: live.store.saveTimer, saveIdle: live.store.saveIdle }, afterConflictLoad: { mainDirty: conflict.store.mainDirty, saveTimer: conflict.store.saveTimer } } },
      { criterion: "主动 flush 抛错含「已暂停写入」", observed: {
  realUiCommand: { channel: "命令面板 → 立即保存学习库（真实 UI）", ranAt: uiFlush.capturedAt, noticeTimeline: uiFlush.notices ?? [],
    noticesIntroducedByCommand: (uiFlush.notices ?? []).filter(n => !(read(path.join(root, dir, "state-after-edit.json")).notices ?? []).some(m => m.text === n.text && m.at === n.at)).map(n => n.text),
    storeAfter: { mainDirty: uiFlush.storeAfter.mainDirty, saveTimer: uiFlush.storeAfter.saveTimer, lastSaveError: uiFlush.storeAfter.lastSaveError }, diskAfter: uiFlush.disk.dataJson },
  consoleFlush: flush.observation } },
      { criterion: "停写后磁盘 data.json 哈希等于外部改写后的哈希（零覆写）", observed: { externalFile: hashes.hashes.external, setupExternal: hashes.hashes.setupExternal, dataJsonAfterBlockedFlush: hashes.hashes.afterBlockedFlush, equal: hashes.hashes.external === hashes.hashes.afterBlockedFlush } },
      { criterion: "冷重启：前后 renderer PID 不同", observed: { initial: env.pids.initial, restart: env.pids.restart, rendererPidChanged: env.pids.initial.renderer !== env.pids.restart.renderer } },
      { criterion: "重开仍是停写态", observed: { hasDesktopMainConflict: restart.store.hasDesktopMainConflict, conflictPath: restart.store.conflictPath, lastSaveError: restart.store.lastSaveError, mainDirty: restart.store.mainDirty, saveTimer: restart.store.saveTimer } },
      { criterion: "post-exit / after-restart / external 三者哈希相等", observed: { external: hashes.hashes.external, postExit: hashes.hashes.postExit, afterRestart: hashes.hashes.afterRestart, equal: hashes.hashes.external === hashes.hashes.postExit && hashes.hashes.postExit === hashes.hashes.afterRestart } },
      { criterion: expectFront + "：schemaVersion 3、.resolved 保留两版原件", observed: { dialogButtons: dialog.modal.buttons.map(b => b.text), choice: resolution.choice, diskMain: resolution.diskMain, resolvedDirs: resolution.resolvedDirs, resolvedBackup: "resolved-backup/", resolvedDataJson: hashes.hashes.resolved, finalExit: hashes.hashes.finalExit, resolvedEqualsFinalExit: hashes.hashes.resolved === hashes.hashes.finalExit, originalV2HashCarriedInExpected: fs.readFileSync(path.join(root, dir, "resolved-backup", `${dir}.expected.sha256`), "utf8").trim() } },
    ],
  };
};

const panel = (() => {
  const ax = read(path.join(root, "a3-native-panel", "ax-panel.json"));
  const axBefore = read(path.join(root, "a3-native-panel", "ax-panel-before-selection.json"));
  const sel = read(path.join(root, "a3-native-panel", "panel-selection.json"));
  const st = read(path.join(root, "a3-native-panel", "state-after-import.json"));
  const hashes = read(path.join(root, "a3-native-panel", "hashes.json"));
  const fixture = read(path.join(root, "a3-native-panel", "fixture.json"));
  const dialog = read(path.join(root, "a3-native-panel", "import-dialog.json"));
  const data = read(path.join(root, "a3-native-panel", "data.json.after-import"));
  return { case: "a3-native-panel", criteria: [
    { criterion: "面板 AX 树归属 Obsidian 的 Electron 进程（AXSheet/AXDialog）", observed: { panelWindow: ax.panelWindow, ownerProcessPid: ax.ax.process.pid, ownerHostPid: ax.ax.process.pid, sheets: ax.ax.sheets, sheetMatched: ax.ax.sheetMatched, note: "AXSheet 位于 pid=Electron 主进程 的 Obsidian AXWindow 下；macOS 将实际面板表面托管在 'Open and Save Panel Service' 子进程，窗口本体 AX 树为空，故取证读取的是附着在主窗口下的 AXSheet 镜像" } },
    { criterion: "目标 zip 在面板里 AXEnabled === true", observed: { beforeSelection: axBefore.ax.zip, afterSelection: ax.ax.zip } },
    { criterion: "面板截图（panel.png）的采集通道", observed: { screenshot: (read(path.join(root, "a3-native-panel", "env.json")).events ?? []).find(e => e.label === "panel-screenshot")?.value ?? null,
      note: "采集期间宿主 Orca 触发的 macOS 屏幕采集授权提示叠在面板上方，遮挡目标行文件名的一部分；面板元素的可复制权威记录为 ax-panel.json / ax-panel-before-selection.json 的 AX 条目。" } },
    { criterion: "点确认后面板关闭", observed: { confirmButton: sel.confirm.confirm, windowsAfterConfirm: sel.confirm.windowsAfter, panelClosed: !sel.confirm.windowsAfter.some(w => w.t === "打开") } },
    { criterion: "导入后 data.json 哈希变化，JSON 内含该归档的学习集 ID 与复习记录", observed: { before: hashes.before.dataJson, afterImport: hashes.afterImport.dataJson, changed: hashes.before.dataJson !== hashes.afterImport.dataJson, archiveStudySetId: fixture.studySetId, importedStudySetIds: (data.studySets ?? []).map(s => s.id), importedStudySetNames: (data.studySets ?? []).map(s => s.name), reviewLogs: (data.reviewLogs ?? []).map(l => ({ cardId: l.cardId, rating: l.rating, reviewedAt: l.reviewedAt })), reviewPending: (data.reviewPending ?? []).map(r => ({ cardId: r.cardId, due: r.due })), srsKeys: Object.keys(data.srs ?? {}), notice: st.after.f08.map(n => n.text), importDialog: dialog.dialog.text } },
  ] };
})();

const before = (() => {
  const hashes = read(path.join(root, "a3-before", "hashes.json"));
  const h = hashes;
  const env = read(path.join(root, "a3-before", "env.json"));
  const diff = read(path.join(root, "a3-before", "structure-diff.json"));
  const semantic = read(path.join(root, "a3-before", "diff-after-import-vs-after-restart.json"));
  return { case: "a3-before", criteria: [
    { criterion: "时序严格单调 before < after-import < exit-1 <= post-exit < relaunch < after-restart < exit-2 <= final-exit", observed: env.timeline },
    { criterion: "PID 前后不同", observed: { initial: env.pids.initial, restart: env.pids.restart, changed: env.pids.initial.host !== env.pids.restart.host && env.pids.initial.renderer !== env.pids.restart.renderer } },
    { criterion: "after-import / post-exit / after-restart / final-exit 四者哈希相等", observed: { afterImport: h.afterImport.dataJson, postExit: h.postExit.dataJson, afterRestart: h.afterRestart.dataJson, finalExit: h.finalExit.dataJson, afterImportEqualsPostExit: h.afterImport.dataJson === h.postExit.dataJson, postExitEqualsAfterRestart: h.postExit.dataJson === h.afterRestart.dataJson, afterRestartEqualsFinalExit: h.afterRestart.dataJson === h.finalExit.dataJson, byteDiff: beforeByte } },
    { criterion: "before→after-import 的结构化 diff：学习集、卡片、复习记录全量落盘且原有键零缺失", observed: { addedKeys: diff.addedKeys, removedKeys: diff.removedKeys, countsBefore: diff.countsBefore, countsAfter: diff.countsAfter, studySetsAfter: diff.studySetsAfter, cardsAfter: diff.cardsAfter } },
    { criterion: "重开后的语义差分（启动期回填）", observed: { changeCount: semantic.changeCount, byTopLevelKey: semantic.byTopLevelKey } },
  ] };
})();

const after = (() => {
  const hashes = read(path.join(root, "a3-after", "hashes.json"));
  const h = hashes;
  const retry = read(path.join(root, "a3-after", "retry-state.json"));
  const eq = read(path.join(root, "a3-after", "collection-equality.json"));
  const semantic = read(path.join(root, "a3-after", "diff-after-import-vs-after-retry.json"));
  const env = read(path.join(root, "a3-after", "env.json"));
  return { case: "a3-after", criteria: [
    { criterion: "一律提示「此包已导入」", observed: { notices: retry.notices.map(n => ({ at: n.at, text: n.text })), retrySelection: read(path.join(root, "a3-after", "retry-selection.json")) } },
    { criterion: "studySets/cards/nodes/edges/srs/reviewPending/reviewLogs 集合数量与内容严格相等", observed: { ...eq.eq,
      srs: (() => { const A = read(path.join(root, "a3-after", "data.json.after-import")); const B = read(path.join(root, "a3-after", "data.json.after-retry"));
        const detail = read(path.join(root, "a3-after", "srs-comparison.json"));
        return { keyCountA: Object.keys(A.srs ?? {}).length, keyCountB: Object.keys(B.srs ?? {}).length, deepEqual: JSON.stringify(A.srs ?? {}) === JSON.stringify(B.srs ?? {}),
          changedFieldsOnlyDates: detail.onlyDateFields, changedFields: detail.rows.flatMap(r => r.changedFields), detailFile: "srs-comparison.json" }; })() } },
    { criterion: "重试前后哈希不同时，字节差异只允许出现在已登记的时间戳字段", observed: { afterRestart: h.afterRestart.dataJson, afterRetry: h.afterRetry.dataJson, identical: h.afterRestart.dataJson === h.afterRetry.dataJson, byteDiffRestartVsRetry: afterByte, byteDiffImportVsRestart: afterByte2, semanticDiffImportVsRetry: { changeCount: semantic.changeCount, byTopLevelKey: semantic.byTopLevelKey } } },
    { criterion: "after-retry 与 final-exit 哈希相等", observed: { afterRetry: h.afterRetry.dataJson, finalExit: h.finalExit.dataJson, equal: h.afterRetry.dataJson === h.finalExit.dataJson } },
    { criterion: "时序与 PID", observed: { timeline: env.timeline, pids: env.pids } },
  ] };
})();

const observations = { generatedAt: new Date().toISOString(), mode: "observation only; no PASS/FAIL verdicts",
  hostHygiene: {
    port: 9333, oneInstanceAtATime: true,
    staleInstanceAtStart: { pid: 62571, root: "/tmp/f08-host-73132", note: "开工时端口 9333 已被上一轮开发自测遗留的 a3-before 隔离宿主占用；采集前终止该进程（非本包启动），其后每个场景独立建库并单独退出。" },
    obsidianAutoUpdate: { note: "隔离 profile 首启会从 GitHub 检查更新并把 1.15.1 包下载进 profile，下一次启动会加载该包。a1 首次探索轮因此在重开后落到 Obsidian 1.15.1，该轮不作为证据并已删除；此后每次启动前删除 profile 内 obsidian-*.asar，所有留证场景全程为 bundle 1.12.7（见各 env.json updateCacheDropped 与 obsidianTitles）。", droppedArtefact: "obsidian-1.15.1.asar" },
    externalWriterRace: { note: "a1 的外部写入者为本包外的独立 Node 进程，先轮询替换暂存目录里的 expected.sha256（插件自身比较步骤之后写出），再以 rename 原子改写 data.json，持续 900ms 跨越插件的 osascript 原子交换；未在渲染进程内注入任何 hook 或改写插件代码。" },
    uiChannels: { note: "真实 UI 操作：信任库提示、插件启用开关、卡片编辑与保存、命令面板命令、冲突对话框按钮、原生文件面板的路径弹出菜单/行选择/打开按钮，均通过 AX 或真实鼠标键盘事件完成；渲染进程的 CDP 仅用于只读观测（notices/store 字段）与读取 panic 掉的具体错误串。" },
    appVersion: { bundle: "1.12.7", titles: "各场景 initial/restart 标题均含 Obsidian 1.12.7" },
  },
  scenes: {
  "a1-local": a1("a1-local", "选「采用本地候选」→ schemaVersion 3 且含 F08 baseline", null),
  "a1-remote": a1("a1-remote", "选「采用外部版本」→ 含 F08 external same revision", null),
  "a3-native-panel": panel, "a3-before": before, "a3-after": after } };
fs.writeFileSync(path.join(root, "observations.json"), json(observations));

// RESULT.json: every file except RESULT.json itself, with SHA-256
const files = {};
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) {
      const rel = path.relative(root, full);
      if (rel !== "RESULT.json") files[rel] = sha(full);
    }
  }
};
walk(root);
fs.writeFileSync(path.join(root, "RESULT.json"), json({
  package: "F08 f78573e 阶段 2 · 五场景实机取证",
  commit,
  buildManifest: read(fileURLToPath(new URL("../../evidence/f08-f78573e-20261121/exec/build-manifest.json", import.meta.url))).artifacts,
  note: "files 以 forensics/ 为根；本清单不含 RESULT.json 自身。observations.json 只记录观测值，不含 PASS/FAIL。",
  scenes: { "a1-local": { criteria: "并发外部写 → 停写 → 冷重启 → 采用本地候选", dir: "a1-local/" }, "a1-remote": { criteria: "并发外部写 → 停写 → 冷重启 → 采用外部版本", dir: "a1-remote/" }, "a3-native-panel": { criteria: "真实导入按钮 + macOS 原生文件面板选件并确认", dir: "a3-native-panel/" }, "a3-before": { criteria: "导入落盘后立即 SIGKILL，post-exit 与重启/退出哈希与结构差分", dir: "a3-before/" }, "a3-after": { criteria: "导入 → 重启 → 重复导入同一 ZIP", dir: "a3-after/" } },
  fileCount: Object.keys(files).length,
  files,
}));
console.log(JSON.stringify({ fileCount: Object.keys(files).length, beforeByte, afterByte, afterByte2 }, null, 2));
