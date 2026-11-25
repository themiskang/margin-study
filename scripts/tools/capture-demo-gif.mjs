/**
 * [INPUT]: 依赖 src/workspace/studyWorkspace.ts、src/model/store.ts、src/styles/*、
 *          src/workspace/obsidian-fixture.txt、scripts/verify/ego-harness.mjs (agent-browser) 与本机 ffmpeg。
 * [OUTPUT]: 生成 docs/assets/demo.gif（1200px 宽、8–12 秒、≤3 MB、循环播放），中间帧写入 /tmp/marginstudy-demo-frames/。
 * [POS]: 项目介绍页 README 演示动图的可复现录制脚本；使用纯合成夹具数据与真实 UI 组件，不注册进验收套件。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 *
 * 如何重新生成 docs/assets/demo.gif：
 *   1. 确保已安装 Node.js、agent-browser（项目 devDependency）及本机 ffmpeg。
 *   2. 在仓库根目录执行：
 *        node scripts/tools/capture-demo-gif.mjs
 *   3. 脚本将在 /tmp/marginstudy-demo-frames/ 生成逐步操作截帧，并调用 ffmpeg 两遍调色板优化输出至 docs/assets/demo.gif。
 *   4. 中间帧保存在 /tmp 目录，不会进入仓库。
 */

import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { runBrowser } from "../verify/ego-harness.mjs";

// 强制使用默认 agent-browser 后端，禁用 ego 后端
delete process.env.MARGINSTUDY_BROWSER;

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const project = await realpath(resolve(here, "../.."));
const framesDir = "/tmp/marginstudy-demo-frames";
const outputGif = join(project, "docs/assets/demo.gif");
const viewportWidth = 1200;
const viewportHeight = 750;

const styleSources = [
  "styles-base.css",
  "styles-reader.css",
  "styles-mindmap.css",
  "styles-review.css",
  "styles-import.css",
  "styles-organize.css",
  "styles-workspace.css",
  "styles-ai.css",
  "styles-research.css",
];

// ── 1. 构建合成 Obsidian 适配器（补全常用 Lucide 图标路径，使真实界面图标清晰） ──
const iconPaths = {
  "book-open": "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
  "file-text": "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  "folder": "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  "folder-open": "M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v2H2zM2 10h20l-2 9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z",
  "home": "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10",
  "layout-grid": "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  "library": "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
  "list": "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  "network": "M9 2h6v6H9zM2 16h6v6H2zM16 16h6v6h-6zM12 8v4M5 16v-4h14v4",
  "git-branch": "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9",
  "layers": "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  "hand": "M8 13V6a2 2 0 0 1 4 0v6V3a2 2 0 0 1 4 0v9V7a2 2 0 0 1 4 0v8c0 4-2 7-6 7h-2c-3 0-4-2-6-5l-3-4a2 2 0 0 1 3-3l2 3",
  "highlighter": "M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4",
  "pen": "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  "pen-tool": "M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.586 7.586",
  "pencil": "M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z",
  "type": "M4 7V4h16v3M9 20h6M12 4v16",
  "square": "M4 4h16v16H4z",
  "crop": "M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2",
  "scissors": "M8 8L20 20M8 16L20 4M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  "copy": "M8 8h12v13H8zM16 8V3H3v13h5",
  "palette": "M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4c-1-1 0-3 2-3h2a3 3 0 0 0 3-3 9 9 0 0 0-9-8",
  "tag": "M3 3h8l10 10-8 8L3 11zM7 7h.01",
  "link": "M10 13l4-4M8 15l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M14 9l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
  "link-2": "M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8",
  "search": "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
  "sparkles": "M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5zM19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75z",
  "settings": "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  "sliders": "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  "plus": "M12 5v14M5 12h14",
  "minus": "M5 12h14",
  "x": "M18 6L6 18M6 6l12 12",
  "check": "M20 6L9 17l-5-5",
  "chevron-down": "M6 9l6 6 6-6",
  "chevron-up": "M18 15l-6-6-6 6",
  "chevron-left": "M15 18l-6-6 6-6",
  "chevron-right": "M9 18l6-6-6-6",
  "ellipsis": "M5 12h.01M12 12h.01M19 12h.01",
  "more-horizontal": "M5 12h.01M12 12h.01M19 12h.01",
  "more-vertical": "M12 5h.01M12 12h.01M12 19h.01",
  "panel-left": "M3 3h18v18H3zM9 3v18",
  "panels-top-left": "M3 3h18v18H3zM3 10h18M10 10v11",
  "bookmark": "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z",
  "eye": "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  "eye-off": "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22",
  "trash-2": "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  "undo": "M3 7v6h6M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13",
  "redo": "M21 7v6h-6M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13",
  "maximize-2": "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  "minimize-2": "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
  "volume-2": "M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14",
  "sticky-note": "M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3zM15 3v6h6",
  "paperclip": "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48",
  "spline": "M4 18c4-12 12-12 16 0",
  "lasso": "M7 22a5 5 0 0 1-2-4M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1",
  "eraser": "M20 20H7L3 16c-.6-.6-.6-1.5 0-2.1l10-10c.6-.6 1.5-.6 2.1 0l6 6c.6.6.6 1.5 0 2.1L13 20",
  "brain": "M12 4a4 4 0 0 0-4 4v8a4 4 0 0 0 4 4M12 4a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4M8 8H6a3 3 0 0 0 0 6h2M16 8h2a3 3 0 0 1 0 6h-2",
  "clock": "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  "filter": "M22 3H2l8 9.46V19l4 2v-8.54L22 3z",
  "arrow-up-down": "M7 15l5 5 5-5M7 9l5-5 5 5",
  "check-square": "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
};

const demoFixtureTs = `
import { Store } from "${project}/src/model/store";
import { StudyWorkspaceView } from "${project}/src/workspace/studyWorkspace";
import { DocumentReaderView } from "${project}/src/documents/documentReader";
import { aiServiceFor } from "${project}/src/ai/panel";
import { condenseServiceFor } from "${project}/src/ai/condense";
import { TFile } from "obsidian";

const target = document.querySelector("#fixtures") as HTMLElement;
(HTMLElement.prototype as any).empty = function () { this.replaceChildren(); };
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};

const wait = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

async function until<T>(fn: () => T, label: string, timeoutMs = 6000): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  while (true) {
    const v = fn();
    if (v) return v;
    if (performance.now() > deadline) throw new Error("Timeout waiting for: " + label);
    await wait(20);
  }
}

function findButton(root: ParentNode, label: string): HTMLButtonElement {
  const btn = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.getAttribute("aria-label") === label || item.textContent?.trim() === label,
  );
  if (!btn) throw new Error("Missing button: " + label);
  return btn;
}

const docHtml = \`
<article style="max-width:680px;margin:0 auto;padding:24px 28px 64px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;line-height:1.85;color:#1e293b;">
  <h1 style="font-size:24px;font-weight:700;margin:0 0 8px;color:#0f172a;">记忆巩固与间隔重复</h1>
  <p style="font-size:13px;color:#64748b;margin:0 0 22px;border-bottom:1px solid #e2e8f0;padding-bottom:12px;">认知心理学学习笔记 · 合成示例文档</p>

  <h2 style="font-size:17px;font-weight:600;margin:20px 0 10px;color:#0f172a;">一、遗忘曲线与记忆衰减</h2>
  <p id="p1" style="margin:0 0 14px;font-size:15px;">新学知识在最初 24 小时内衰减最快，单纯重复阅读只能带来短暂的熟悉感，很难形成稳定的长期记忆提取通道。</p>

  <h2 style="font-size:17px;font-weight:600;margin:22px 0 10px;color:#0f172a;">二、间隔重复的核心机制</h2>
  <p id="p2" style="margin:0 0 14px;font-size:15px;">间隔重复通过在即将遗忘的临界点触发主动回忆，显著延缓遗忘曲线下降速率，并逐轮拉长最佳复习间隔。</p>

  <h2 style="font-size:17px;font-weight:600;margin:22px 0 10px;color:#0f172a;">三、提取练习与知识网络</h2>
  <p id="p3" style="margin:0 0 14px;font-size:15px;">将零散摘录转化为结构化知识卡片并建立脑图关联，可同时激活语义编码与视觉空间线索，大幅提升迁移应用能力。</p>

  <h2 style="font-size:17px;font-weight:600;margin:22px 0 10px;color:#0f172a;">四、实践建议</h2>
  <p id="p4" style="margin:0 0 14px;font-size:15px;">阅读时优先摘录高信息密度的核心命题，随后将摘录组织为原子卡片，借助脑图梳理层级关系并定期进行回忆测试。</p>
</article>
\`;

const doc2Html = \`
<article style="max-width:680px;margin:0 auto;padding:24px 28px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;line-height:1.8;color:#1e293b;">
  <h1>认知负荷与工作记忆</h1>
  <p>工作记忆容量有限，将复杂概念拆分为可复用的卡片节点能够有效降低外在认知负荷。</p>
</article>
\`;

async function bootDemo() {
  let disk: any = {};
  const sources = new Map<string, { file: TFile; content: string }>();
  const writes = new Map<string, string>();
  const folders = new Set<string>();

  const addDoc = (path: string, content: string) => {
    const file = new TFile(path, content.length);
    sources.set(path, { file, content });
    return file;
  };

  const mainDoc = addDoc("记忆与间隔重复.html", docHtml);
  const sideDoc = addDoc("认知负荷理论.html", doc2Html);

  const dock = (collapsed = false) => ({
    collapsed,
    collapse() { this.collapsed = true; },
    expand() { this.collapsed = false; },
  });
  const events = new Map<string, Set<(...args: any[]) => void>>();
  const workspaceEvents = new Map<string, Set<(...args: any[]) => void>>();

  const app: any = {
    vault: {
      configDir: ".obsidian",
      getFiles: () => [...sources.values()].map((v) => v.file),
      getAbstractFileByPath: (path: string) => sources.get(path)?.file ?? null,
      async read(file: TFile) { return sources.get(file.path)!.content; },
      async readBinary(file: TFile) { return new TextEncoder().encode(sources.get(file.path)!.content).buffer; },
      getResourcePath: (file: TFile) => "/synthetic-resource/" + encodeURIComponent(file.path),
      on(name: string, cb: any) {
        const set = events.get(name) ?? new Set();
        set.add(cb);
        events.set(name, set);
        return { off: () => set.delete(cb) };
      },
      adapter: {
        async exists(path: string) { return writes.has(path) || sources.has(path) || folders.has(path); },
        async read(path: string) { return writes.get(path)!; },
        async write(path: string, value: string) { writes.set(path, value); },
        async mkdir(path: string) { folders.add(path); },
        async remove(path: string) { writes.delete(path); },
        async rename(from: string, to: string) { writes.set(to, writes.get(from)!); writes.delete(from); },
      },
    },
    metadataCache: { getFirstLinkpathDest: () => null },
    workspace: {
      leftSplit: dock(false),
      rightSplit: dock(false),
      rootSplit: {},
      activeLeaf: null,
      centerLeaf: null,
      on(name: string, cb: any) {
        const set = workspaceEvents.get(name) ?? new Set();
        set.add(cb);
        workspaceEvents.set(name, set);
        return { off: () => set.delete(cb) };
      },
      offref(ref: any) { ref.off(); },
      onLayoutReady(cb: any) { cb(); },
      getMostRecentLeaf() { return this.centerLeaf; },
      requestSaveLayout() {},
      getLeaf() { return { setViewState: async () => {} }; },
      openLinkText: async () => {},
      revealLeaf: async () => {},
      setActiveLeaf(next: any) { this.activeLeaf = next; },
    },
  };

  const store = new Store({
    app,
    loadData: async () => structuredClone(disk),
    saveData: async (value: any) => { disk = structuredClone(value); },
  } as any);
  await store.load();

  store.settings.colors = ["#ffd54f", "#80cbc4", "#9fa8da", "#ff8a80"];
  store.settings.autoCardOnHighlight = false;
  store.settings.scale = 1;

  const set = store.createStudySet("认知心理学导论", [mainDoc.path, sideDoc.path]);
  store.updateStudySet(set.id, { pinned: false, category: "课程" });
  const canvasId = store.activeCanvasId!;
  store.setStudyInterface(set.id, "scenes");

  // 额外合成学习集，让学习集首页看起来饱满真实
  for (const title of ["深度学习基础", "算法与数据结构", "文献精读方法", "认知神经科学"]) {
    store.createStudySet(title);
  }
  store.setActiveStudySet(set.id);
  store.setActiveCanvas(canvasId);

  // 初始脑图骨架：一个主题根节点 + 一个已有子节点
  store.addCard({
    id: "seed-card",
    docPath: mainDoc.path,
    type: "excerpt",
    front: "遗忘曲线：新学知识在 24 小时内衰减最快",
    anchorAnnId: "seed-ann",
    color: "#e2e8f0",
    tags: ["记忆"],
    links: [],
    createdAt: "2026-10-15T00:00:00Z",
  });
  store.addNode({
    id: "root-topic",
    canvasId,
    parentId: null,
    title: "记忆与间隔重复",
    x: 36,
    y: 210,
    collapsed: false,
  });
  store.addNode({
    id: "seed-node",
    cardId: "seed-card",
    canvasId,
    parentId: "root-topic",
    title: "遗忘曲线：新学知识在 24 小时内衰减最快",
    x: 245,
    y: 75,
    collapsed: false,
  });
  await store.saveAnnotationsNow(mainDoc.path, []);

  let view: StudyWorkspaceView;
  const plugin: any = {
    app,
    store,
    viewEvents: {},
    activeReader: null,
    studyWorkspace: null,
    sidebar: { name: "demo-sidebar" },
    condenseService: () => condenseServiceFor(aiServiceFor(plugin)),
    openDocument: async (file: TFile) => view.openFile(file),
    refreshMindmap() { view?.refresh(); },
    refreshSidebar() { view?.refresh(); },
    ensureSplitLayout: async () => {},
  };
  const leaf: any = {
    app,
    getRoot: () => app.workspace.rootSplit,
    setViewState: async () => {},
    getViewState: () => ({ type: "margin-study-workspace" }),
    updateHeader() {},
  };
  view = new StudyWorkspaceView(leaf, plugin);
  view.load();
  view.containerEl.firstElementChild!.classList.add("view-header-title");
  leaf.view = view;
  app.workspace.activeLeaf = app.workspace.centerLeaf = leaf;
  await view.setState({ tabs: [{ path: mainDoc.path }], activePath: mainDoc.path });
  await view.onOpen();
  await frame();

  const ctx = {
    store,
    view,
    root: view.contentEl,
    mainDoc,
    canvasId,
    set,
  };

  const closeCardPanel = () => {
    const close = ctx.root.querySelector<HTMLButtonElement>('[aria-label="关闭卡片面板"]');
    if (close) close.click();
  };

  const centerMindmapOnNodes = () => {
    const mapScroll = ctx.root.querySelector<HTMLElement>(".ms-mindmap");
    const nodes = [...ctx.root.querySelectorAll<HTMLElement>(".ms-node")];
    if (!mapScroll || !nodes.length) return;
    const mapRect = mapScroll.getBoundingClientRect();
    let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      minL = Math.min(minL, r.left - mapRect.left + mapScroll.scrollLeft);
      minT = Math.min(minT, r.top - mapRect.top + mapScroll.scrollTop);
      maxR = Math.max(maxR, r.right - mapRect.left + mapScroll.scrollLeft);
      maxB = Math.max(maxB, r.bottom - mapRect.top + mapScroll.scrollTop);
    }
    const cx = (minL + maxR) / 2;
    const cy = (minT + maxB) / 2;
    mapScroll.scrollLeft = Math.max(0, Math.round(cx - mapScroll.clientWidth / 2));
    mapScroll.scrollTop = Math.max(0, Math.round(cy - mapScroll.clientHeight / 2 + 15));
  };

  const clickAtElement = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: Math.round(r.left + Math.min(120, r.width / 2)),
        clientY: Math.round(r.bottom + 4),
      }),
    );
  };

  // 将每一步操作挂载到 window.demoSteps，供外部浏览器驱动逐帧截图
  (window as any).demoSteps = {
    // 01: 学习集首页
    async step01Home() {
      closeCardPanel();
      findButton(ctx.root, "学习集与文档").click();
      await frame();
      await wait(60);
      return { ok: !!document.querySelector(".ms-study-home-screen") };
    },

    // 02: 进入工作区（显示左侧文档列表 + 脑图，尚未展开阅读器）
    async step02WorkspaceOpen() {
      const closeBtn = document.querySelector<HTMLButtonElement>(".ms-study-home-screen [aria-label='关闭工具面板']");
      if (closeBtn) closeBtn.click();
      await frame();
      closeCardPanel();
      ctx.view.state.library = true;
      ctx.view.state.reader = false;
      ctx.view.state.mindmap = true;
      ctx.view.applyLayout();
      ctx.view.drawToolbar();
      ctx.view.refresh(true);
      await frame();
      closeCardPanel();
      centerMindmapOnNodes();
      await frame();
      await wait(60);
      return { library: ctx.view.state.library, mindmap: ctx.view.state.mindmap };
    },

    // 03: 打开阅读器（双栏：左阅读器 + 右脑图）
    async step03ReaderOpen() {
      ctx.view.state.library = false;
      ctx.view.state.reader = true;
      ctx.view.state.mindmap = true;
      await ctx.view.openFile(ctx.mainDoc);
      ctx.view.applyLayout();
      ctx.view.drawToolbar();
      ctx.view.refresh(true);
      await frame();
      closeCardPanel();
      // 切换为手型选择模式，使选中文本先弹出选区工具栏（含四色摘录快捷栏），再手动点击颜色生成摘录
      const handBtn = ctx.root.querySelector<HTMLButtonElement>('[data-ms-tool="excerpt.hand"]');
      if (handBtn) handBtn.click();
      await frame();
      centerMindmapOnNodes();
      await wait(80);
      const reader = ctx.view.getReader() as DocumentReaderView;
      const p2 = reader.getScrollContainer().querySelector("#p2");
      return { opened: !!p2, path: reader.getFilePath(), readerTool: ctx.root.dataset.readerTool };
    },

    // 04: 选中第一段关键文字，弹出选区工具栏
    async step04SelectText1() {
      const reader = ctx.view.getReader() as DocumentReaderView;
      const p2 = reader.getScrollContainer().querySelector("#p2") as HTMLElement;
      p2.scrollIntoView({ block: "center" });
      await frame();
      const range = document.createRange();
      range.selectNodeContents(p2);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      const pop = await until(() => document.querySelector<HTMLElement>(".ms-ann-pop button") && document.querySelector<HTMLElement>(".ms-ann-pop"), "selection popup 1");
      await frame();
      await wait(60);
      return { popup: !!pop, text: sel.toString().slice(0, 20) };
    },

    // 05: 点击高亮色，生成第一条摘录高亮（先展示纯摘录高亮结果，尚未生成卡片）
    async step05CreateExcerpt1() {
      const pop = await until(() => document.querySelector<HTMLElement>(".ms-ann-pop"), "selection popup 1");
      const swatches = [...pop.querySelectorAll<HTMLButtonElement>('[data-action-group="color"]')];
      const colorBtn = swatches[0] || findButton(pop, "高亮");
      window.getSelection()?.removeAllRanges();
      colorBtn.click();
      await until(async () => (await ctx.store.loadAnnotations(ctx.mainDoc.path)).length >= 1, "excerpt 1 saved");
      await frame();
      // 暂收起浮窗，让本帧清晰展示原文已生成黄色摘录高亮
      document.querySelectorAll(".ms-ann-pop").forEach((el) => el.remove());
      await frame();
      await wait(80);
      const anns = await ctx.store.loadAnnotations(ctx.mainDoc.path);
      return { annCount: anns.length, cardCount: ctx.store.cards.length, color: colorBtn.getAttribute("aria-label") };
    },

    // 06: 点击第一条摘录高亮，在摘录下方弹出操作栏（高亮标出「摘录卡」按钮）
    async step06OpenExcerptMenu1() {
      const anns = await ctx.store.loadAnnotations(ctx.mainDoc.path);
      const targetAnn = anns[anns.length - 1];
      const hl = await until(
        () => ctx.root.querySelector<HTMLElement>(\`.ms-workspace-reader [data-ann-id="\${targetAnn.id}"]\`),
        "highlight element 1",
      );
      clickAtElement(hl);
      const pop = await until(() => document.querySelector<HTMLElement>(".ms-ann-pop"), "annotation popup 1");
      const cardBtn = findButton(pop, "摘录卡");
      cardBtn.style.outline = "2px solid #2563eb";
      cardBtn.style.outlineOffset = "1px";
      cardBtn.style.borderRadius = "6px";
      await frame();
      await wait(60);
      return { annId: targetAnn.id, hasCardBtn: !!cardBtn };
    },

    // 07: 点击「摘录卡」，第一张卡片生成并出现在右侧脑图中
    async step07CreateCard1() {
      const pop = await until(() => document.querySelector<HTMLElement>(".ms-ann-pop"), "annotation popup 1");
      const before = ctx.store.cards.length;
      findButton(pop, "摘录卡").click();
      await until(() => ctx.store.cards.length > before, "card 1 created");
      const created = ctx.store.cards[ctx.store.cards.length - 1];
      const node = ctx.store.nodes.find((n: any) => n.cardId === created.id);
      if (node) {
        ctx.store.updateNode(node.id, { parentId: "root-topic", x: 245, y: 205 });
      }
      ctx.view.refresh(true);
      await frame();
      centerMindmapOnNodes();
      if (node) {
        const nodeEl = ctx.root.querySelector<HTMLElement>(\`.ms-node[data-id="\${node.id}"]\`);
        nodeEl?.click();
      }
      await frame();
      await wait(80);
      return { cardId: created.id, nodeId: node?.id, totalCards: ctx.store.cards.length };
    },

    // 08: 选中第二段文字，弹出选区工具栏
    async step08SelectText2() {
      // 先点脑图空白处收起上一张卡片的浮动工具条
      const mapEl = ctx.root.querySelector<HTMLElement>(".ms-mindmap");
      mapEl?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 640, clientY: 120 }));
      mapEl?.click();
      const reader = ctx.view.getReader() as DocumentReaderView;
      const p3 = reader.getScrollContainer().querySelector("#p3") as HTMLElement;
      p3.scrollIntoView({ block: "center" });
      await frame();
      const range = document.createRange();
      range.selectNodeContents(p3);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      const pop = await until(() => document.querySelector<HTMLElement>(".ms-ann-pop button") && document.querySelector<HTMLElement>(".ms-ann-pop"), "selection popup 2");
      await frame();
      await wait(60);
      return { popup: !!pop, text: sel.toString().slice(0, 20) };
    },

    // 09: 生成第二条摘录并立即转为第二张卡片加入脑图
    async step09ExcerptToCard2() {
      const pop = await until(() => document.querySelector<HTMLElement>(".ms-ann-pop"), "selection popup 2");
      const swatches = [...pop.querySelectorAll<HTMLButtonElement>('[data-action-group="color"]')];
      const colorBtn = swatches[2] || swatches[1] || swatches[0] || findButton(pop, "高亮");
      window.getSelection()?.removeAllRanges();
      colorBtn.click();
      await until(async () => (await ctx.store.loadAnnotations(ctx.mainDoc.path)).length >= 2, "excerpt 2 saved");
      await frame();
      const anns = await ctx.store.loadAnnotations(ctx.mainDoc.path);
      const secondAnn = anns[anns.length - 1];
      const hl2 = await until(
        () => ctx.root.querySelector<HTMLElement>(\`.ms-workspace-reader [data-ann-id="\${secondAnn.id}"]\`),
        "highlight element 2",
      );
      clickAtElement(hl2);
      const annPop = await until(() => document.querySelector<HTMLElement>(".ms-ann-pop"), "annotation popup 2");
      const before = ctx.store.cards.length;
      findButton(annPop, "摘录卡").click();
      await until(() => ctx.store.cards.length > before, "card 2 created");
      const created = ctx.store.cards[ctx.store.cards.length - 1];
      const node = ctx.store.nodes.find((n: any) => n.cardId === created.id);
      if (node) {
        ctx.store.updateNode(node.id, { parentId: "root-topic", x: 245, y: 345 });
      }
      ctx.view.refresh(true);
      await frame();
      centerMindmapOnNodes();
      if (node) {
        const nodeEl = ctx.root.querySelector<HTMLElement>(\`.ms-node[data-id="\${node.id}"]\`);
        nodeEl?.click();
      }
      await frame();
      await wait(80);
      return { cardId: created.id, nodeId: node?.id, totalCards: ctx.store.cards.length };
    },

    // 10: 最终全景停留（清除浮窗遮挡，展示完整的「阅读器摘录 ↔ 脑图卡片」双栏工作区）
    async step10FinalMindmap() {
      document.querySelectorAll(".ms-ann-pop, #test-menu").forEach((el) => el.remove());
      window.getSelection()?.removeAllRanges();
      // 点击脑图画布空白处并按 Esc 清除节点选中态工具条，让三张卡片与连线完全无遮挡展示
      const world = ctx.root.querySelector<HTMLElement>(".ms-mindmap-world") || ctx.root.querySelector<HTMLElement>(".ms-mindmap");
      world?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 620, clientY: 120 }));
      world?.click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      ctx.view.refresh(true);
      await frame();
      centerMindmapOnNodes();
      await frame();
      await wait(80);
      return {
        cards: ctx.store.cards.length,
        nodes: ctx.store.nodes.length,
        anns: (await ctx.store.loadAnnotations(ctx.mainDoc.path)).length,
      };
    },
  };

  (window as any).demoReady = true;
}

bootDemo().catch((err) => {
  (window as any).demoError = String(err?.stack || err);
});
`;

const framePlan = [
  { file: "01-home.png", fn: "step01Home", duration: 0.9 },
  { file: "02-workspace-open.png", fn: "step02WorkspaceOpen", duration: 0.8 },
  { file: "03-reader-open.png", fn: "step03ReaderOpen", duration: 0.9 },
  { file: "04-select-text-1.png", fn: "step04SelectText1", duration: 0.9 },
  { file: "05-excerpt-created-1.png", fn: "step05CreateExcerpt1", duration: 0.9 },
  { file: "06-excerpt-menu-1.png", fn: "step06OpenExcerptMenu1", duration: 0.8 },
  { file: "07-card-in-map-1.png", fn: "step07CreateCard1", duration: 1.1 },
  { file: "08-select-text-2.png", fn: "step08SelectText2", duration: 0.8 },
  { file: "09-excerpt-to-card-2.png", fn: "step09ExcerptToCard2", duration: 0.9 },
  { file: "10-final-mindmap.png", fn: "step10FinalMindmap", duration: 2.0 },
];

const t0 = Date.now();
const tempBuild = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-demo-build-")));

try {
  // 清理并创建帧输出目录
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  await mkdir(dirname(outputGif), { recursive: true });

  // 生成带 Lucide 图标的合成 Obsidian 适配器
  const obsidianBase = await readFile(join(project, "src/workspace/obsidian-fixture.txt"), "utf8");
  const iconReplacement = `export function setIcon(host:HTMLElement,name:string){
  const paths: Record<string,string> = ${JSON.stringify(iconPaths)};
  host.dataset.icon = name;
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('width','16');
  svg.setAttribute('height','16');
  svg.setAttribute('fill','none');
  svg.setAttribute('stroke','currentColor');
  svg.setAttribute('stroke-width','1.8');
  svg.setAttribute('stroke-linecap','round');
  svg.setAttribute('stroke-linejoin','round');
  const path = document.createElementNS(svg.namespaceURI,'path');
  path.setAttribute('d', paths[name] || 'M5 12h.01M12 12h.01M19 12h.01');
  svg.append(path);
  host.replaceChildren(svg);
}`;
  const obsidianMock = obsidianBase.replace(
    /export function setIcon\(host:HTMLElement,name:string\)\{[^\n]+\}/,
    iconReplacement,
  );
  await writeFile(join(tempBuild, "obsidian-fixture.ts"), obsidianMock);

  // 合成 fakePdf / fakeMammoth / crypto / network
  for (const name of ["fakePdf", "fakeMammoth"]) {
    await writeFile(
      join(tempBuild, `${name}.ts`),
      await readFile(join(project, "src/documents/acceptance-fixtures", `${name}.txt`), "utf8"),
    );
  }
  await writeFile(
    join(tempBuild, "fakePdf.ts"),
    (await readFile(join(tempBuild, "fakePdf.ts"), "utf8")) + "\nexport async function initPdfWorker() {}\n",
  );
  const docNames = ["记忆与间隔重复.html", "认知负荷理论.html"];
  const hashes = Object.fromEntries(docNames.map((p) => [p, createHash("sha256").update(p).digest("hex")]));
  await writeFile(
    join(tempBuild, "crypto.ts"),
    `const hashes=${JSON.stringify(hashes)};export function createHash(){let v="";return{update(x:string){v=String(x);return this;},digest(){return hashes[v]||"0".repeat(64);}};}`,
  );
  await writeFile(
    join(tempBuild, "unused-network.ts"),
    "export function request(){throw new Error('Network disabled in demo fixture');}",
  );
  await writeFile(join(tempBuild, "demo-fixture.ts"), demoFixtureTs);

  // 拼接样式（直接从 src/styles/ 读取，不依赖预先 npm run build）
  const cssParts = await Promise.all(
    styleSources.map((name) => readFile(join(project, "src/styles", name), "utf8")),
  );
  const hostThemeCss = `
:root {
  --font-interface: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Segoe UI", sans-serif;
  --font-text: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Segoe UI", sans-serif;
  --background-primary: #ffffff;
  --background-primary-alt: #fafafa;
  --background-secondary: #f6f7f9;
  --background-secondary-alt: #eef0f4;
  --background-modifier-border: #e2e6ec;
  --background-modifier-hover: rgba(15, 23, 42, 0.06);
  --text-normal: #1e293b;
  --text-muted: #64748b;
  --text-faint: #94a3b8;
  --text-on-accent: #ffffff;
  --interactive-accent: #2563eb;
  --interactive-accent-hover: #1d4ed8;
  --interactive-normal: #f1f5f9;
  --interactive-hover: #e2e8f0;
}
html, body {
  margin: 0;
  height: 100%;
  background: var(--background-primary);
  color: var(--text-normal);
  font-family: var(--font-interface);
  -webkit-font-smoothing: antialiased;
}
#fixtures { height: 100vh; width: 100vw; overflow: hidden; }
.test-item-view { height: 100%; width: 100%; display: flex; flex-direction: column; }
.test-item-view > header { display: none; }
.test-item-view > .view-content { height: 100%; width: 100%; overflow: hidden; }
`;
  await writeFile(join(tempBuild, "styles.css"), hostThemeCss + "\n" + cssParts.join("\n\n"));
  await writeFile(
    join(tempBuild, "index.html"),
    '<!doctype html><meta charset="utf-8"><title>MarginStudy Demo</title><link rel="stylesheet" href="/styles.css"><main id="fixtures"></main><script type="module" src="/fixture.js"></script>',
  );

  // esbuild 打包浏览器夹具
  await build({
    entryPoints: [join(tempBuild, "demo-fixture.ts")],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "chrome120",
    outfile: join(tempBuild, "fixture.js"),
    plugins: [
      {
        name: "demo-synthetic-host-adapters",
        setup(builder) {
          builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: join(tempBuild, "obsidian-fixture.ts") }));
          builder.onResolve({ filter: /^crypto$/ }, () => ({ path: join(tempBuild, "crypto.ts") }));
          builder.onResolve({ filter: /^(?:http|https)$/ }, () => ({ path: join(tempBuild, "unused-network.ts") }));
          builder.onResolve({ filter: /^mammoth$/ }, () => ({ path: join(tempBuild, "fakeMammoth.ts") }));
          builder.onResolve({ filter: /\/pdfjs$/ }, () => ({ path: join(tempBuild, "fakePdf.ts") }));
        },
      },
    ],
  });

  // 启动本地静态服务
  const allowed = new Set(["index.html", "fixture.js", "styles.css"]);
  const server = createServer(async (req, res) => {
    const name = new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
    if (!allowed.has(name)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html; charset=utf-8",
    );
    res.end(await readFile(join(tempBuild, name)));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));

  const session = `marginstudy-demo-gif-${process.pid}`;
  const browser = (...args) => runBrowser(session, ...args);

  try {
    await browser("open", "about:blank");
    await browser("set", "viewport", String(viewportWidth), String(viewportHeight));
    await browser("open", `http://127.0.0.1:${server.address().port}`);

    // 等待夹具初始化
    const deadline = Date.now() + 30000;
    while (true) {
      const status = JSON.parse((await browser("eval", "({ready:window.demoReady,error:window.demoError})")).stdout);
      if (status.error) throw new Error(`Demo fixture init failed: ${status.error}`);
      if (status.ready) break;
      if (Date.now() > deadline) throw new Error("Timed out waiting for demo fixture ready");
      await new Promise((r) => setTimeout(r, 150));
    }

    // 逐步执行主线操作并截帧
    for (const step of framePlan) {
      const stepRes = JSON.parse((await browser("eval", `window.demoSteps.${step.fn}()`)).stdout);
      const framePath = join(framesDir, step.file);
      await browser("screenshot", framePath);
      console.log(`[frame] ${step.file} (${step.duration}s) -> ${JSON.stringify(stepRes)}`);
    }
  } finally {
    await browser("close").catch(() => {});
    await new Promise((done) => server.close(done));
  }

  // 生成 ffmpeg concat 清单（末帧重复一行以确保 concat demuxer 保留其 duration）
  const concatLines = [];
  for (const step of framePlan) {
    concatLines.push(`file '${join(framesDir, step.file)}'`);
    concatLines.push(`duration ${step.duration}`);
  }
  concatLines.push(`file '${join(framesDir, framePlan[framePlan.length - 1].file)}'`);
  const concatFile = join(framesDir, "frames.txt");
  await writeFile(concatFile, concatLines.join("\n") + "\n", "utf8");

  // 两遍调色板优化生成高质量、小体积 GIF（宽 1200px，循环播放）
  const paletteFile = join(framesDir, "palette.png");
  await exec("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatFile,
    "-vf", `scale=${viewportWidth}:-1:flags=lanczos,palettegen=max_colors=192:stats_mode=diff`,
    paletteFile,
  ]);

  await exec("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatFile,
    "-i", paletteFile,
    "-lavfi", `scale=${viewportWidth}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
    "-loop", "0",
    outputGif,
  ]);

  const info = await stat(outputGif);
  const totalSec = framePlan.reduce((sum, s) => sum + s.duration, 0);
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nGenerated ${outputGif}`);
  console.log(`Frames: ${framePlan.length}, Planned duration: ${totalSec.toFixed(1)}s, Size: ${(info.size / 1024).toFixed(1)} KB (${(info.size / 1024 / 1024).toFixed(2)} MB), Elapsed: ${elapsedSec}s`);
} finally {
  await rm(tempBuild, { recursive: true, force: true });
}
