/**
 * [INPUT]: 依赖 StudyWorkspaceView、ReaderView、DocumentReaderView、Store、公开合成夹具（obsidian-fixture/fakePdf/fakeMammoth）与默认 agent-browser 后端。
 * [OUTPUT]: 执行 ANNOT-03 工作区焦点路由、独立阅读器 Cmd+Z 与端到端交互闭环验收（C1~C4）。
 * [POS]: 公开浏览器验收套件 workspace-annot-undo-e2e，注册于 scripts/verify.mjs。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { readFile, writeFile, mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { runBrowser } from "./ego-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const project = await realpath(resolve(here, "../.."));
const workspaceDir = join(project, "src/workspace");
const docFixtures = join(project, "src/documents/acceptance-fixtures");
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-annot-e2e-")));

const fixtureSource = `
import { TFile } from "obsidian";
import { Store } from "${project}/src/model/store";
import { StudyWorkspaceView } from "${project}/src/workspace/studyWorkspace";
import { ReaderView } from "${project}/src/pdf/readerView";
import { DocumentReaderView } from "${project}/src/documents/documentReader";

(HTMLElement.prototype as any).empty = function () { this.replaceChildren(); };
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};

const frame = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const assert = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };
const errors: string[] = [];
window.addEventListener("error", e => errors.push(String(e.error ?? e.message)));
window.addEventListener("unhandledrejection", e => errors.push(String(e.reason)));

const fixturesHost = document.getElementById("fixtures")!;
const stamp = "2026-11-27T00:00:00Z";

const sampleTextItems = [
  { str: "三个字", x: 60, y: 700, w: 90, h: 18, hasEOL: true },
  { str: "六个中文字符", x: 60, y: 650, w: 180, h: 18, hasEOL: true },
  { str: "第二段高亮文本", x: 60, y: 600, w: 210, h: 18, hasEOL: true },
  { str: "独立阅读器摘录", x: 60, y: 550, w: 210, h: 18, hasEOL: true },
  { str: "另一段中文摘录", x: 60, y: 500, w: 210, h: 18, hasEOL: true },
];

function makePdfBytes(name: string): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify({ name, pages: 1, textItems: sampleTextItems })).buffer as ArrayBuffer;
}

function selectSpanText(span: Element, start = 0, end?: number): Range {
  const node = span.firstChild!;
  const len = (node.textContent ?? "").length;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end ?? len);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}

function findSpan(root: ParentNode, text: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>(".ms-text-layer span")].find(el => el.textContent === text);
  assert(found, "Missing text span: " + text);
  return found!;
}

function dispatchPtr(target: EventTarget, type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  target.dispatchEvent(new PointerEvent(type, {
    clientX: x,
    clientY: y,
    pointerId: 1,
    button: 0,
    isPrimary: true,
    bubbles: true,
    cancelable: true,
    detail: 1,
    ...extra,
  }));
}

function dispatchCmdZ(target: EventTarget, shiftKey = false) {
  const ev = new KeyboardEvent("keydown", {
    key: "z",
    code: "KeyZ",
    metaKey: true,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(ev);
  return ev;
}

async function clearSelection() {
  window.getSelection()?.removeAllRanges();
  document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  await frame();
}

async function dragSelectPdfText(scroll: HTMLElement, text: string, dx: number, dy = 0, waitMs = 60) {
  const span = findSpan(scroll, text);
  dispatchPtr(scroll, "pointerdown", 100, 100, { detail: 1 });
  selectSpanText(span);
  document.dispatchEvent(new Event("selectionchange"));
  dispatchPtr(window, "pointerup", 100 + dx, 100 + dy, { detail: 1 });
  if (waitMs > 0) await wait(waitMs);
  await frame();
}

function makeBaseEnv(pdfPath: string, initialDisk?: Partial<any>, extraHtml?: { path: string; html: string }) {
  const sources = new Map<string, { file: TFile; content: string; binary?: ArrayBuffer }>();
  const pdfBin = makePdfBytes(pdfPath);
  const pdfFile = new TFile(pdfPath, pdfBin.byteLength);
  sources.set(pdfPath, { file: pdfFile, content: "", binary: pdfBin });
  if (extraHtml) {
    const htmlFile = new TFile(extraHtml.path, extraHtml.html.length);
    sources.set(extraHtml.path, { file: htmlFile, content: extraHtml.html });
  }
  const adapterFiles = new Map<string, string>();
  const folders = new Set<string>();
  const vaultEvents = new Map<string, Set<(...args: any[]) => void>>();
  const wsEvents = new Map<string, Set<(...args: any[]) => void>>();
  const dock = () => ({ collapsed: false, collapse() { this.collapsed = true; }, expand() { this.collapsed = false; } });

  const app: any = {
    vault: {
      configDir: ".obsidian",
      getFiles: () => [...sources.values()].map(v => v.file),
      getAbstractFileByPath: (p: string) => sources.get(p)?.file ?? null,
      async read(file: TFile) { return sources.get(file.path)!.content; },
      async readBinary(file: TFile) {
        const entry = sources.get(file.path)!;
        return entry.binary ? entry.binary.slice(0) : new TextEncoder().encode(entry.content).buffer;
      },
      getResourcePath: (file: TFile) => "/synthetic/" + encodeURIComponent(file.path),
      on(name: string, cb: any) { const s = vaultEvents.get(name) ?? new Set(); s.add(cb); vaultEvents.set(name, s); return { off: () => s.delete(cb) }; },
      adapter: {
        async exists(p: string) { return adapterFiles.has(p) || sources.has(p) || folders.has(p); },
        async read(p: string) { if (!adapterFiles.has(p)) throw new Error("Missing " + p); return adapterFiles.get(p)!; },
        async write(p: string, v: string) { adapterFiles.set(p, v); },
        async mkdir(p: string) { folders.add(p); },
        async remove(p: string) { adapterFiles.delete(p); },
        async rename(from: string, to: string) { adapterFiles.set(to, adapterFiles.get(from)!); adapterFiles.delete(from); },
      },
    },
    metadataCache: { getFirstLinkpathDest: () => null },
    commands: { commands: {}, executeCommandById: () => false },
    workspace: {
      leftSplit: dock(), rightSplit: dock(), rootSplit: {}, activeLeaf: null as any, centerLeaf: null as any,
      on(name: string, cb: any) { const s = wsEvents.get(name) ?? new Set(); s.add(cb); wsEvents.set(name, s); return { off: () => s.delete(cb) }; },
      offref(ref: any) { ref.off(); },
      onLayoutReady(cb: any) { cb(); },
      getMostRecentLeaf() { return this.centerLeaf; },
      requestSaveLayout() {},
      getLeaf() { return { setViewState: async () => {} }; },
      getLeavesOfType() { return []; },
      openLinkText: async () => {},
      revealLeaf: async () => {},
      setActiveLeaf(next: any) { this.activeLeaf = next; },
    },
  };

  let disk: any = {
    cards: [],
    nodes: [],
    edges: [],
    srs: {},
    studySets: [{ id: "set-1", name: "ANNOT-03 Study", docPaths: [pdfPath], createdAt: stamp }],
    canvases: [{ id: "canvas-1", studySetId: "set-1", name: "Main Map", createdAt: stamp }],
    activeStudySetId: "set-1",
    activeCanvasId: "canvas-1",
    ...initialDisk,
  };
  const host: any = {
    app,
    loadData: async () => JSON.parse(JSON.stringify(disk)),
    saveData: async (value: any) => { disk = JSON.parse(JSON.stringify(value)); },
  };
  const store = new Store(host);
  return { app, store, pdfFile };
}

async function openWorkspace(pdfPath: string, initialDisk?: Partial<any>) {
  fixturesHost.replaceChildren();
  const { app, store, pdfFile } = makeBaseEnv(pdfPath, initialDisk);
  await store.load();
  const leaf: any = { app, setViewState: async () => {}, updateHeader() {}, getRoot: () => app.workspace.rootSplit };
  app.workspace.activeLeaf = leaf;
  app.workspace.centerLeaf = leaf;
  let view!: StudyWorkspaceView;
  const plugin: any = {
    manifest: { id: "margin-study" },
    app,
    store,
    viewEvents: {},
    studyWorkspace: null,
    activeReader: null,
    refreshMindmap() { view?.refresh(); },
    refreshSidebar() { view?.refresh(); },
    ensureSplitLayout: async () => {},
    openDocument: async (file: TFile) => view.openFile(file),
  };
  view = new StudyWorkspaceView(leaf, plugin);
  leaf.view = view;
  plugin.studyWorkspace = view;
  view.load();
  fixturesHost.append(view.containerEl);
  await view.setState({
    tabs: [{ path: pdfFile.path }],
    activePath: pdfFile.path,
    library: false,
    auxiliary: "none",
    reader: true,
    mindmap: true,
    ratio: 0.5,
    placement: "left",
    bottomCollapsed: false,
    cleanView: false,
  });
  await view.onOpen();
  await frame();
  await wait(80);
  const reader = (view as any).reader as ReaderView;
  assert(reader instanceof ReaderView, "Workspace reader must be ReaderView");
  reader.setScale(1);
  await reader.renderPage(1);
  await frame();
  const root = view.contentEl as HTMLElement;
  return {
    app, store, view, reader, root,
    scroll: reader.getScrollContainer(),
    async dispose() {
      await clearSelection();
      await view.onClose();
      view.unload();
      fixturesHost.replaceChildren();
    },
  };
}

async function openStandalonePdf(pdfPath: string) {
  fixturesHost.replaceChildren();
  const { app, store } = makeBaseEnv(pdfPath);
  await store.load();
  const leaf: any = { app, view: null, setViewState: async () => {}, updateHeader() {}, getRoot: () => app.workspace.rootSplit };
  app.workspace.activeLeaf = leaf;
  app.workspace.centerLeaf = leaf;
  const plugin: any = {
    manifest: { id: "margin-study" },
    app,
    store,
    viewEvents: {},
    studyWorkspace: null,
    activeReader: null,
    refreshMindmap() {},
    refreshSidebar() {},
    ensureSplitLayout: async () => {},
    ensureMindMapOpen: async () => {},
    openStudyWorkspace: async () => null,
    openDocumentInReader: async () => {},
  };
  const view = new ReaderView(leaf, plugin);
  leaf.view = view;
  view.containerEl.style.cssText = "position:relative;width:820px;height:760px;";
  fixturesHost.append(view.containerEl);
  await view.onOpen();
  await view.loadFileByPath(pdfPath);
  view.setScale(1);
  await view.renderPage(1);
  await frame();
  return {
    app, store, view,
    scroll: view.getScrollContainer(),
    ctrl: (view as any).annController,
    async dispose() {
      await clearSelection();
      await view.onClose();
      view.unload();
      fixturesHost.replaceChildren();
    },
  };
}

async function openStandaloneHtml(htmlPath: string, html: string) {
  fixturesHost.replaceChildren();
  const { app, store } = makeBaseEnv("dummy.pdf", undefined, { path: htmlPath, html });
  await store.load();
  const leaf: any = { app, view: null, setViewState: async () => {}, updateHeader() {}, getRoot: () => app.workspace.rootSplit };
  app.workspace.activeLeaf = leaf;
  app.workspace.centerLeaf = leaf;
  const plugin: any = {
    manifest: { id: "margin-study" },
    app,
    store,
    viewEvents: {},
    studyWorkspace: null,
    activeReader: null,
    refreshMindmap() {},
    refreshSidebar() {},
    ensureSplitLayout: async () => {},
    ensureMindMapOpen: async () => {},
    openStudyWorkspace: async () => null,
    openDocumentInReader: async () => {},
  };
  const view = new DocumentReaderView(leaf, plugin);
  leaf.view = view;
  view.containerEl.style.cssText = "position:relative;width:820px;height:760px;";
  fixturesHost.append(view.containerEl);
  await view.onOpen();
  await view.loadFileByPath(htmlPath);
  await frame();
  return {
    app, store, view,
    async dispose() {
      await clearSelection();
      await view.onClose();
      view.unload();
      fixturesHost.replaceChildren();
    },
  };
}

(window as any).runAll = async () => {
  const report: Record<string, any> = {};

  // ===== C1: 工作区默认仅选中→点菜单「高亮」→1 次 Cmd+Z 撤净 + 显式开启自动高亮（微拖 4px / 3 字 0 产物 + 正常 6 字摘录 + 1 次 Cmd+Z 全部归 0 + Cmd+Shift+Z 恢复）=====
  {
    const ws = await openWorkspace("c1.pdf");
    try {
      // 0) 默认态（autoHighlightOnSelect=false）：拖选 6 字仅选中不建标注，点菜单「高亮」生成 1 标注 + 1 卡 + 2 节点，1 次 Cmd+Z 撤净
      assert(ws.store.settings.autoHighlightOnSelect === false, "C1 default autoHighlightOnSelect must be false");
      await dragSelectPdfText(ws.scroll, "六个中文字符", 160, 0, 240);
      const afterDefaultSelect = {
        annotations: (await ws.store.loadAnnotations("c1.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
        hasPop: !!document.querySelector(".ms-ann-pop.ms-context-selection"),
      };
      assert(afterDefaultSelect.annotations === 0 && afterDefaultSelect.cards === 0 && afterDefaultSelect.nodes === 0 && afterDefaultSelect.hasPop,
        "C1 default select-only mismatch: " + JSON.stringify(afterDefaultSelect));
      const hlBtn = document.querySelector<HTMLButtonElement>('.ms-ann-pop [data-action-id="highlight"]');
      assert(hlBtn, "C1 missing highlight button in selection menu");
      hlBtn!.click();
      await wait(60);
      await frame();
      const afterMenuHighlight = {
        annotations: (await ws.store.loadAnnotations("c1.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
      };
      assert(afterMenuHighlight.annotations === 1 && afterMenuHighlight.cards === 1 && afterMenuHighlight.nodes === 2,
        "C1 menu highlight mismatch: " + JSON.stringify(afterMenuHighlight));
      dispatchCmdZ(ws.root, false);
      await wait(40);
      await frame();
      const afterMenuUndo = {
        annotations: (await ws.store.loadAnnotations("c1.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
      };
      assert(afterMenuUndo.annotations === 0 && afterMenuUndo.cards === 0 && afterMenuUndo.nodes === 0,
        "C1 menu highlight 1x Cmd+Z not zero: " + JSON.stringify(afterMenuUndo));

      // 开启显式 autoHighlightOnSelect=true 覆盖原自动高亮链路
      ws.store.settings.autoHighlightOnSelect = true;
      ws.store.save();
      await frame();

      // 1) 4px 微拖
      await clearSelection();
      await dragSelectPdfText(ws.scroll, "六个中文字符", 4, 0, 240);
      const afterMicro = {
        annotations: (await ws.store.loadAnnotations("c1.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
      };
      assert(afterMicro.annotations === 0 && afterMicro.cards === 0 && afterMicro.nodes === 0,
        "C1 micro-drag produced artifacts: " + JSON.stringify(afterMicro));

      // 2) 3 字中文
      await clearSelection();
      await dragSelectPdfText(ws.scroll, "三个字", 120, 0, 240);
      const after3Chars = {
        annotations: (await ws.store.loadAnnotations("c1.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
      };
      assert(after3Chars.annotations === 0 && after3Chars.cards === 0 && after3Chars.nodes === 0,
        "C1 3-char excerpt produced artifacts: " + JSON.stringify(after3Chars));

      // 3) 正常拖选 6 字中文
      await clearSelection();
      await dragSelectPdfText(ws.scroll, "六个中文字符", 160, 0, 80);
      const undoBtn = ws.root.querySelector<HTMLButtonElement>('[data-bottom-action="undo"]');
      assert(undoBtn, "C1 missing bottom undo button");
      const afterCreate = {
        annotations: (await ws.store.loadAnnotations("c1.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
        undoDisabled: undoBtn!.disabled,
        undoTitle: undoBtn!.title,
      };
      assert(afterCreate.annotations === 1 && afterCreate.cards === 1 && afterCreate.nodes === 2,
        "C1 normal create mismatch: " + JSON.stringify(afterCreate));
      assert(afterCreate.undoDisabled === false && afterCreate.undoTitle.includes("撤销添加高亮"),
        "C1 undo button state mismatch: " + JSON.stringify(afterCreate));

      // 4) 按 1 次 Cmd+Z -> 全部归 0
      dispatchCmdZ(ws.root, false);
      await wait(40);
      await frame();
      const afterUndo = {
        annotations: (await ws.store.loadAnnotations("c1.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
      };
      assert(afterUndo.annotations === 0 && afterUndo.cards === 0 && afterUndo.nodes === 0,
        "C1 after 1x Cmd+Z not zero: " + JSON.stringify(afterUndo));

      // 5) 按 Cmd+Shift+Z -> 全部恢复
      dispatchCmdZ(ws.root, true);
      await wait(40);
      await frame();
      const afterRedo = {
        annotations: (await ws.store.loadAnnotations("c1.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
      };
      assert(afterRedo.annotations === 1 && afterRedo.cards === 1 && afterRedo.nodes === 2,
        "C1 after Cmd+Shift+Z not restored: " + JSON.stringify(afterRedo));

      report.C1 = { afterDefaultSelect, afterMenuHighlight, afterMenuUndo, afterMicro, after3Chars, afterCreate, afterUndo, afterRedo };
    } finally {
      await ws.dispose();
    }
  }

  // ===== C2: 连续两次摘录 + 两次 Cmd+Z -> 全部归 0，store.history 未增长、无卡片复活 =====
  {
    const ws = await openWorkspace("c2.pdf", { settings: { autoHighlightOnSelect: true } });
    try {
      const initHistLen = (ws.store as any).history.length;
      const initRev = ws.store.getLibraryHistoryState().revision;

      await dragSelectPdfText(ws.scroll, "六个中文字符", 160, 0, 60);
      await clearSelection();
      await dragSelectPdfText(ws.scroll, "第二段高亮文本", 160, 0, 60);
      const afterTwo = {
        annotations: (await ws.store.loadAnnotations("c2.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
      };
      assert(afterTwo.annotations === 2 && afterTwo.cards === 2 && afterTwo.nodes === 3,
        "C2 after 2 highlights mismatch: " + JSON.stringify(afterTwo));

      // 连续 2 次 Cmd+Z
      dispatchCmdZ(ws.root, false);
      await wait(40);
      await frame();
      const afterUndo1 = {
        annotations: (await ws.store.loadAnnotations("c2.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
      };
      assert(afterUndo1.annotations === 1 && afterUndo1.cards === 1 && afterUndo1.nodes === 2,
        "C2 after 1st Cmd+Z mismatch: " + JSON.stringify(afterUndo1));

      dispatchCmdZ(ws.root, false);
      await wait(40);
      await frame();
      const afterUndo2 = {
        annotations: (await ws.store.loadAnnotations("c2.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
        storeHistoryDelta: (ws.store as any).history.length - initHistLen,
        storeRevDelta: ws.store.getLibraryHistoryState().revision - initRev,
      };
      assert(afterUndo2.annotations === 0 && afterUndo2.cards === 0 && afterUndo2.nodes === 0,
        "C2 after 2nd Cmd+Z not zero: " + JSON.stringify(afterUndo2));
      assert(afterUndo2.storeHistoryDelta === 0 && afterUndo2.storeRevDelta === 0,
        "C2 store.history polluted: " + JSON.stringify(afterUndo2));

      // 额外再按 1 次 Cmd+Z 确认无卡片复活
      dispatchCmdZ(ws.root, false);
      await wait(40);
      await frame();
      const afterExtraUndo = {
        annotations: (await ws.store.loadAnnotations("c2.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
      };
      assert(afterExtraUndo.annotations === 0 && afterExtraUndo.cards === 0 && afterExtraUndo.nodes === 0,
        "C2 card resurrected on extra Cmd+Z: " + JSON.stringify(afterExtraUndo));

      report.C2 = { afterTwo, afterUndo1, afterUndo2, afterExtraUndo };
    } finally {
      await ws.dispose();
    }
  }

  // ===== C3: 跨栈交替不串栈 =====
  {
    const ws = await openWorkspace("c3.pdf", {
      settings: { autoHighlightOnSelect: true },
      cards: [{ id: "c-ind", type: "excerpt", docPath: "c3.pdf", front: "Independent Card", tags: [], links: [], createdAt: stamp }],
      nodes: [{ id: "n-ind", cardId: "c-ind", canvasId: "canvas-1", parentId: null, title: "Independent Node", collapsed: false, x: 120, y: 120 }],
    });
    try {
      // 先在脑图做 1 次更早的编辑（120 -> 180），用于后续验证 reader 空栈时不会误撤更早的脑图编辑
      ws.store.moveNode("n-ind", 180, 140);
      await frame();
      assert(ws.store.nodes.find(n => n.id === "n-ind")?.x === 180, "C3 setup earlier move failed");

      // 1) 左侧 PDF 创建高亮 1（进 reader 栈）
      await dragSelectPdfText(ws.scroll, "六个中文字符", 160, 0, 60);
      assert((await ws.store.loadAnnotations("c3.pdf")).length === 1 && ws.store.cards.length === 2,
        "C3 highlight 1 creation failed");

      // 2) 右侧脑图拖动节点（进 library 栈）
      const mapPane = ws.root.querySelector<HTMLElement>(".ms-workspace-map")!;
      dispatchPtr(mapPane, "pointerdown", 600, 300);
      ws.store.moveNode("n-ind", 340, 260);
      await frame();
      assert(ws.store.nodes.find(n => n.id === "n-ind")?.x === 340, "C3 mindmap move failed");

      // 3) 按 Cmd+Z -> 只撤脑图拖动（高亮与卡仍在）
      dispatchCmdZ(ws.root, false);
      await wait(40);
      await frame();
      const afterMapUndo = {
        nodeX: ws.store.nodes.find(n => n.id === "n-ind")?.x,
        annotations: (await ws.store.loadAnnotations("c3.pdf")).length,
        cards: ws.store.cards.length,
      };
      assert(afterMapUndo.nodeX === 180 && afterMapUndo.annotations === 1 && afterMapUndo.cards === 2,
        "C3 map undo mismatch: " + JSON.stringify(afterMapUndo));

      // 4) 点左侧 PDF（回 reader 栈）-> 按 Cmd+Z 撤高亮 1
      const readerHost = ws.root.querySelector<HTMLElement>(".ms-workspace-reader-host")!;
      dispatchPtr(readerHost, "pointerdown", 120, 200);
      await frame();
      dispatchCmdZ(ws.root, false);
      await wait(40);
      await frame();
      const afterReaderUndo = {
        nodeX: ws.store.nodes.find(n => n.id === "n-ind")?.x,
        annotations: (await ws.store.loadAnnotations("c3.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
      };
      assert(afterReaderUndo.nodeX === 180 && afterReaderUndo.annotations === 0 && afterReaderUndo.cards === 1 && afterReaderUndo.nodes === 1,
        "C3 reader undo mismatch: " + JSON.stringify(afterReaderUndo));

      // 5) reader 栈已空时再按 1 次 Cmd+Z -> 不许误切到 library 栈删掉更早的脑图编辑（x 仍为 180）
      dispatchCmdZ(ws.root, false);
      await wait(40);
      await frame();
      const afterEmptyReaderUndo = {
        nodeX: ws.store.nodes.find(n => n.id === "n-ind")?.x,
        libraryCanUndo: ws.store.getLibraryHistoryState().canUndo,
      };
      assert(afterEmptyReaderUndo.nodeX === 180 && afterEmptyReaderUndo.libraryCanUndo === true,
        "C3 cross-stack leak deleted earlier mindmap edit: " + JSON.stringify(afterEmptyReaderUndo));

      report.C3 = { afterMapUndo, afterReaderUndo, afterEmptyReaderUndo };
    } finally {
      await ws.dispose();
    }
  }

  // ===== C4: 独立阅读器 Cmd+Z + 工作区防双触发 + 输入框保护 =====
  {
    // Part A: 独立 ReaderView
    const standalone = await openStandalonePdf("c4-standalone.pdf");
    let standaloneResult: any;
    try {
      standalone.ctrl.setAutomaticTextExcerpt(true);
      await dragSelectPdfText(standalone.scroll, "独立阅读器摘录", 160, 0, 60);
      const created = {
        annotations: (await standalone.store.loadAnnotations("c4-standalone.pdf")).length,
        cards: standalone.store.cards.length,
        nodes: standalone.store.nodes.length,
      };
      assert(created.annotations === 1 && created.cards === 1 && created.nodes === 2,
        "C4 standalone create failed: " + JSON.stringify(created));

      // 输入框聚焦态按 Cmd+Z 不触发阅读器撤销
      const input = document.createElement("input");
      standalone.view.containerEl.append(input);
      input.focus();
      dispatchCmdZ(input, false);
      await wait(40);
      const duringInputFocus = (await standalone.store.loadAnnotations("c4-standalone.pdf")).length;
      assert(duringInputFocus === 1, "C4 input focus triggered reader undo");
      input.blur();
      input.remove();

      // 容器内 Cmd+Z 撤销成功
      dispatchCmdZ(standalone.scroll, false);
      await wait(40);
      await frame();
      const afterUndo = {
        annotations: (await standalone.store.loadAnnotations("c4-standalone.pdf")).length,
        cards: standalone.store.cards.length,
        nodes: standalone.store.nodes.length,
      };
      assert(afterUndo.annotations === 0 && afterUndo.cards === 0 && afterUndo.nodes === 0,
        "C4 standalone Cmd+Z failed: " + JSON.stringify(afterUndo));

      // window 级 Cmd+Shift+Z 重做 + Cmd+Z 撤销（焦点在 body 且 activeLeaf === leaf）
      dispatchCmdZ(window, true);
      await wait(40);
      await frame();
      const afterWindowRedo = (await standalone.store.loadAnnotations("c4-standalone.pdf")).length;
      assert(afterWindowRedo === 1, "C4 standalone window Cmd+Shift+Z failed");

      dispatchCmdZ(window, false);
      await wait(40);
      await frame();
      const afterWindowUndo = (await standalone.store.loadAnnotations("c4-standalone.pdf")).length;
      assert(afterWindowUndo === 0, "C4 standalone window Cmd+Z failed");

      standaloneResult = { created, duringInputFocus, afterUndo, afterWindowRedo, afterWindowUndo };
    } finally {
      await standalone.dispose();
    }

    // Part B: 独立 DocumentReaderView (HTML)
    const htmlDoc = await openStandaloneHtml("c4-doc.html", "<html><body><p id='p1'>独立文档阅读器中文摘录测试段落</p></body></html>");
    let htmlResult: any;
    try {
      htmlDoc.view.setAutomaticTextExcerpt(true);
      const p = htmlDoc.view.getBodyEl().querySelector("p")!;
      dispatchPtr(htmlDoc.view.getScrollContainer(), "pointerdown", 60, 60, { detail: 1 });
      selectSpanText(p);
      document.dispatchEvent(new Event("selectionchange"));
      dispatchPtr(window, "pointerup", 220, 60, { detail: 1 });
      await wait(80);
      await frame();
      const created = (await htmlDoc.store.loadAnnotations("c4-doc.html")).length;
      assert(created === 1, "C4 DocumentReaderView create failed: " + created);
      dispatchCmdZ(htmlDoc.view.getScrollContainer(), false);
      await wait(40);
      await frame();
      const afterUndo = (await htmlDoc.store.loadAnnotations("c4-doc.html")).length;
      assert(afterUndo === 0, "C4 DocumentReaderView Cmd+Z failed: " + afterUndo);
      htmlResult = { created, afterUndo };
    } finally {
      await htmlDoc.dispose();
    }

    // Part C: StudyWorkspaceView 内防双触发（在嵌入的 reader scroll 上派发 1 次 Cmd+Z，冒泡经 reader -> workspace -> window，严格只撤高亮 2）
    const ws = await openWorkspace("c4-ws.pdf", { settings: { autoHighlightOnSelect: true } });
    let noDoubleTriggerResult: any;
    try {
      await dragSelectPdfText(ws.scroll, "六个中文字符", 160, 0, 60);
      await clearSelection();
      await dragSelectPdfText(ws.scroll, "第二段高亮文本", 160, 0, 60);
      const before = await ws.store.loadAnnotations("c4-ws.pdf");
      const beforeCount = before.length;
      assert(beforeCount === 2 && ws.store.cards.length === 2, "C4 workspace setup failed");

      // 在嵌入式 ReaderView 的 scrollEl 上派发 1 次 Cmd+Z（最容易暴露双触发的路径）
      dispatchCmdZ(ws.scroll, false);
      await wait(40);
      await frame();
      const afterOne = await ws.store.loadAnnotations("c4-ws.pdf");
      assert(afterOne.length === 1 && ws.store.cards.length === 1 && afterOne[0].text === "六个中文字符",
        "C4 workspace double-trigger detected: " + JSON.stringify({ anns: afterOne.map(a => a.text), cards: ws.store.cards.length }));

      // 工作区输入框聚焦态按 Cmd+Z 不触发撤销
      const input = document.createElement("input");
      ws.root.append(input);
      input.focus();
      dispatchCmdZ(input, false);
      await wait(40);
      const afterInputKey = (await ws.store.loadAnnotations("c4-ws.pdf")).length;
      assert(afterInputKey === 1, "C4 workspace input focus triggered undo");
      input.blur();
      input.remove();

      noDoubleTriggerResult = {
        beforeCount,
        afterOneCmdZCount: afterOne.length,
        remainingText: afterOne[0].text,
        cardsAfterOneCmdZ: ws.store.cards.length,
        afterInputKey,
      };
    } finally {
      await ws.dispose();
    }

    report.C4 = { standaloneResult, htmlResult, noDoubleTriggerResult };
  }

  // ===== C5: 6 类浮层打开时 Cmd+Z 不得误撤背后文档 + 关闭后恢复正常撤销 =====
  {
    const ws = await openWorkspace("c5-overlays.pdf", {
      settings: { autoHighlightOnSelect: true },
      cards: [{ id: "c-ind", type: "excerpt", docPath: "c5-overlays.pdf", front: "Independent Card", tags: [], links: [], createdAt: stamp }],
      nodes: [{ id: "n-ind", cardId: "c-ind", canvasId: "canvas-1", parentId: null, title: "Independent Node", collapsed: false, x: 120, y: 120 }],
    });
    try {
      const counts = async () => ({
        annotations: (await ws.store.loadAnnotations("c5-overlays.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
        nodeX: ws.store.nodes.find(n => n.id === "n-ind")?.x,
        historyScope: (ws.view as any).historyScope,
      });
      const pressEsc = (target: EventTarget) => {
        target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
      };

      // 建立基线：独立节点移动 + PDF 高亮 1 -> 1/2/3（且当前焦点在 reader 栈）
      ws.store.moveNode("n-ind", 184, 140);
      await frame();
      await dragSelectPdfText(ws.scroll, "六个中文字符", 160, 0, 80);
      const baseline = await counts();
      assert(baseline.annotations === 1 && baseline.cards === 2 && baseline.nodes === 3 && baseline.historyScope === "reader",
        "C5 baseline mismatch: " + JSON.stringify(baseline));

      const overlays: Record<string, any> = {};

      // 1) 底部统一「更多」菜单 (.ms-native-popover)
      {
        const moreBtn = ws.root.querySelector<HTMLButtonElement>('[data-ms-tool="excerpt.more"]')!;
        assert(moreBtn, "C5 missing excerpt.more button");
        moreBtn.click();
        await frame();
        const popover = ws.root.querySelector<HTMLElement>(".ms-native-popover");
        assert(popover, "C5 bottom more popover did not open");
        const row = popover!.querySelector<HTMLButtonElement>("button:not([aria-label='关闭工具面板'])") ?? popover!.querySelector<HTMLButtonElement>("button")!;
        assert(row, "C5 bottom more popover missing button");
        row.focus();
        const before = await counts();
        const ev = dispatchCmdZ(row, false);
        await wait(40);
        await frame();
        const after = await counts();
        const stillOpen = !!ws.root.querySelector(".ms-native-popover");
        assert(after.annotations === 1 && after.cards === 2 && after.nodes === 3 && after.nodeX === 184 && stillOpen,
          "C5 bottomMore failed: " + JSON.stringify({ before, after, stillOpen }));
        pressEsc(window);
        await frame();
        assert(!ws.root.querySelector(".ms-native-popover"), "C5 bottomMore did not close on Escape");
        overlays.bottomMore = { before, after, closedByCmdZ: !stillOpen, prevented: ev.defaultPrevented };
      }

      // 2) UI-01 溢出菜单 (.ms-bottom-overflow-menu) —— 精确复现复核 420px 场景
      {
        const prevWidth = fixturesHost.style.width;
        fixturesHost.style.width = "420px";
        (ws.view as any).syncBottomLayout?.();
        await wait(60);
        await frame();
        const toggle = ws.root.querySelector<HTMLButtonElement>(".ms-bottom-overflow-toggle");
        assert(toggle, "C5 overflow toggle did not appear at 420px");
        toggle!.click();
        await frame();
        const menu = ws.root.querySelector<HTMLElement>(".ms-bottom-overflow-menu");
        assert(menu, "C5 overflow menu did not open");
        const item = [...menu!.querySelectorAll<HTMLButtonElement>(".ms-bottom-overflow-item")]
          .find(b => b.textContent?.includes("连续摘录")) ?? menu!.querySelector<HTMLButtonElement>(".ms-bottom-overflow-item")!;
        item.focus();
        const before = await counts();
        const ev = dispatchCmdZ(item, false);
        await wait(40);
        await frame();
        const after = await counts();
        const stillOpen = !!ws.root.querySelector(".ms-bottom-overflow-menu");
        assert(after.annotations === 1 && after.cards === 2 && after.nodes === 3 && after.nodeX === 184 && stillOpen,
          "C5 overflowMenu failed: " + JSON.stringify({ before, after, stillOpen }));
        pressEsc(window);
        await frame();
        assert(!ws.root.querySelector(".ms-bottom-overflow-menu"), "C5 overflowMenu did not close on Escape");
        fixturesHost.style.width = prevWidth;
        (ws.view as any).syncBottomLayout?.();
        await wait(60);
        await frame();
        overlays.overflowMenu = { before, after, closedByCmdZ: !stillOpen, prevented: ev.defaultPrevented };
      }

      // 3) 格式条字号下拉浮层 (.ms-text-style-popover) —— 独立验证避免临时文字框干扰其余 5 类计数
      {
        const wsFont = await openWorkspace("c5-fontsize.pdf", {
          settings: { autoHighlightOnSelect: true },
          cards: [{ id: "c-ind", type: "excerpt", docPath: "c5-fontsize.pdf", front: "Independent Card", tags: [], links: [], createdAt: stamp }],
          nodes: [{ id: "n-ind", cardId: "c-ind", canvasId: "canvas-1", parentId: null, title: "Independent Node", collapsed: false, x: 120, y: 120 }],
        });
        try {
          const fCounts = async () => ({
            annotations: (await wsFont.store.loadAnnotations("c5-fontsize.pdf")).length,
            cards: wsFont.store.cards.length,
            nodes: wsFont.store.nodes.length,
          });
          await dragSelectPdfText(wsFont.scroll, "六个中文字符", 160, 0, 80);
          wsFont.reader.beginTextAnnotation();
          await frame();
          const page = wsFont.scroll.querySelector<HTMLElement>("[data-page='1']")!;
          const rect = page.getBoundingClientRect();
          page.dispatchEvent(new MouseEvent("click", {
            clientX: rect.left + 80,
            clientY: rect.top + 80,
            bubbles: true,
            cancelable: true,
          }));
          await wait(60);
          await frame();
          const editor = wsFont.root.querySelector<HTMLElement>(".ms-overlay-text-editor");
          assert(editor, "C5 inline text editor did not open");
          const sizeBtn = editor!.querySelector<HTMLButtonElement>('[aria-label="选择文字字号"]')!;
          assert(sizeBtn, "C5 font size dropdown button missing");
          sizeBtn.click();
          await frame();
          const sizePopover = editor!.querySelector<HTMLElement>(".ms-text-style-popover");
          assert(sizePopover, "C5 font size popover did not open");
          const opt = sizePopover!.querySelector<HTMLButtonElement>("button")!;
          opt.focus();
          const before = await fCounts();
          const ev = dispatchCmdZ(opt, false);
          await wait(40);
          await frame();
          const after = await fCounts();
          const stillOpen = !!editor!.querySelector(".ms-text-style-popover");
          assert(after.annotations === before.annotations && after.cards === before.cards && after.nodes === before.nodes && stillOpen,
            "C5 fontSizePopover failed: " + JSON.stringify({ before, after, stillOpen }));
          pressEsc(editor!);
          await frame();
          pressEsc(editor!);
          await wait(60);
          await frame();
          assert(!wsFont.root.querySelector(".ms-overlay-text-editor"), "C5 inline text editor did not close");
          overlays.fontSizePopover = { before, after, closedByCmdZ: !stillOpen, prevented: ev.defaultPrevented };
        } finally {
          await wsFont.dispose();
        }
        // 重新挂载主 ws DOM（openWorkspace 清空了 fixturesHost）
        fixturesHost.append(ws.view.containerEl);
        await frame();
      }

      // 4) 脑图搜索框 (.ms-mm-search / .ms-workspace-map input)
      {
        const mapSearchToggle = ws.root.querySelector<HTMLButtonElement>('.ms-workspace-map button[aria-label*="搜索"]');
        if (mapSearchToggle) { mapSearchToggle.click(); await frame(); }
        let searchInput = ws.root.querySelector<HTMLInputElement>(".ms-mm-search, .ms-workspace-map input");
        let injected = false;
        if (!searchInput) {
          searchInput = document.createElement("input");
          searchInput.className = "ms-mm-search";
          searchInput.type = "text";
          ws.root.querySelector(".ms-workspace-map-host")!.append(searchInput);
          injected = true;
        }
        searchInput.focus();
        searchInput.value = "测试";
        const before = await counts();
        const ev = dispatchCmdZ(searchInput, false);
        await wait(40);
        await frame();
        const after = await counts();
        assert(after.annotations === 1 && after.cards === 2 && after.nodes === 3 && ev.defaultPrevented === false,
          "C5 mindmapSearch failed: " + JSON.stringify({ before, after, prevented: ev.defaultPrevented }));
        searchInput.blur();
        if (injected) searchInput.remove();
        else if (mapSearchToggle) { pressEsc(window); await frame(); }
        overlays.mindmapSearch = { before, after, closedByCmdZ: false, prevented: ev.defaultPrevented };
      }

      // 5) 模态框 (.ms-modal-bg)
      {
        const modalBg = document.createElement("div");
        modalBg.className = "ms-modal-bg";
        const modalBtn = document.createElement("button");
        modalBtn.type = "button";
        modalBtn.textContent = "确认合并";
        modalBg.append(modalBtn);
        document.body.append(modalBg);
        modalBtn.focus();
        const before = await counts();
        const ev = dispatchCmdZ(modalBtn, false);
        await wait(40);
        await frame();
        const after = await counts();
        const stillOpen = document.body.contains(modalBg);
        assert(after.annotations === 1 && after.cards === 2 && after.nodes === 3 && stillOpen,
          "C5 modal failed: " + JSON.stringify({ before, after, stillOpen }));
        modalBg.remove();
        await frame();
        overlays.modal = { before, after, closedByCmdZ: !stillOpen, prevented: ev.defaultPrevented };
      }

      // 6) 侧栏面板输入框 (.ms-workspace-auxiliary input)
      {
        const aux = ws.root.querySelector<HTMLElement>(".ms-workspace-auxiliary")!;
        assert(aux, "C5 auxiliary sidebar missing");
        const sideInput = document.createElement("input");
        sideInput.type = "text";
        sideInput.value = "侧栏笔记";
        aux.append(sideInput);
        sideInput.focus();
        const before = await counts();
        const ev = dispatchCmdZ(sideInput, false);
        await wait(40);
        await frame();
        const after = await counts();
        assert(after.annotations === 1 && after.cards === 2 && after.nodes === 3 && ev.defaultPrevented === false,
          "C5 sidebarInput failed: " + JSON.stringify({ before, after, prevented: ev.defaultPrevented }));
        sideInput.blur();
        sideInput.remove();
        await frame();
        overlays.sidebarInput = { before, after, closedByCmdZ: false, prevented: ev.defaultPrevented };
      }

      // 7) 反向验证：所有浮层关闭后，Cmd+Z 恢复正常撤销（1/2/3 -> 0/1/1）
      const readerHost = ws.root.querySelector<HTMLElement>(".ms-workspace-reader-host")!;
      dispatchPtr(readerHost, "pointerdown", 120, 200);
      await frame();
      dispatchCmdZ(ws.root, false);
      await wait(40);
      await frame();
      const afterRecoveryUndo = await counts();
      assert(afterRecoveryUndo.annotations === 0 && afterRecoveryUndo.cards === 1 && afterRecoveryUndo.nodes === 1,
        "C5 recovery undo failed: " + JSON.stringify(afterRecoveryUndo));

      report.C5 = { baseline, overlays, afterRecoveryUndo };
    } finally {
      await ws.dispose();
    }
  }

  return report;
};

(window as any).getErrors = () => errors;
(window as any).ready = true;
`;

try {
  await writeFile(
    join(temporary, "obsidian-fixture.ts"),
    (await readFile(join(workspaceDir, "obsidian-fixture.txt"), "utf8")).replaceAll("__PROJECT__", () => project),
  );
  for (const name of ["fakePdf", "fakeMammoth"]) {
    await writeFile(
      join(temporary, name + ".ts"),
      (await readFile(join(docFixtures, name + ".txt"), "utf8")).replaceAll("__PROJECT__", () => project),
    );
  }
  await writeFile(join(temporary, "unused-network.ts"), "export function request(){throw new Error('offline');}");
  await writeFile(join(temporary, "crypto.ts"), "export function createHash(){return{update(){return this;},digest(){return '0000000000000000';}};}");
  await writeFile(join(temporary, "workspace-annot-undo-fixture.ts"), fixtureSource);

  const styles = await Promise.all([
    "styles.css",
    "src/styles/styles-reader.css",
    "src/styles/styles-mindmap.css",
    "src/styles/styles-organize.css",
    "src/styles/styles-workspace.css",
  ].map(name => readFile(join(project, name), "utf8")));
  await writeFile(join(temporary, "styles.css"), styles.join("\n"));
  await writeFile(
    join(temporary, "index.html"),
    '<!doctype html><meta charset="utf-8"><title>MarginStudy ANNOT-03 Workspace Annot Undo E2E Acceptance</title><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0;height:100%}#fixtures{position:relative;width:100vw;height:100vh;overflow:hidden}.test-item-view{height:100%;width:100%;display:flex;flex-direction:column}.test-item-view>.view-content{height:100%;width:100%;overflow:hidden}</style><main id="fixtures"></main><script type="module" src="/fixture.js"></script>',
  );

  await build({
    entryPoints: [join(temporary, "workspace-annot-undo-fixture.ts")],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "chrome120",
    outfile: join(temporary, "fixture.js"),
    plugins: [{
      name: "workspace-annot-undo-adapters",
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: join(temporary, "obsidian-fixture.ts") }));
        builder.onResolve({ filter: /^crypto$/ }, () => ({ path: join(temporary, "crypto.ts") }));
        builder.onResolve({ filter: /^(?:http|https)$/ }, () => ({ path: join(temporary, "unused-network.ts") }));
        builder.onResolve({ filter: /^mammoth$/ }, () => ({ path: join(temporary, "fakeMammoth.ts") }));
        builder.onResolve({ filter: /\/pdfjs$/ }, () => ({ path: join(temporary, "fakePdf.ts") }));
      },
    }],
  });

  const allowed = new Set(["index.html", "fixture.js", "styles.css"]);
  const server = createServer(async (req, res) => {
    const name = new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
    if (!allowed.has(name)) { res.statusCode = 404; res.end(); return; }
    res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
    res.end(await readFile(join(temporary, name)));
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const session = `marginstudy-annot-e2e-${process.pid}`;
  const browser = (...args) => runBrowser(session, ...args);

  try {
    await browser("open", "about:blank");
    await browser("set", "viewport", "1280", "900");
    await browser("open", `http://127.0.0.1:${server.address().port}`);
    await browser("wait", "--fn", "window.ready === true");
    const result = JSON.parse((await browser("eval", "window.runAll()")).stdout);
    const errs = JSON.parse((await browser("eval", "window.getErrors()")).stdout);
    if (errs.length) throw new Error("Unhandled browser errors: " + JSON.stringify(errs));
    console.log("PASS workspace-annot-undo-e2e:", JSON.stringify(result));
  } finally {
    await browser("close").catch(() => {});
    await new Promise(done => server.close(done));
  }
} finally {
  await rm(temporary, { recursive: true, force: true }).catch(() => {});
}
