/**
 * [INPUT]: 依赖 StudyWorkspaceView、ReaderView、DocumentReaderView、WordReaderView、Store、MarginStudySettingTab、featureSearch、公开合成夹具与默认 agent-browser 后端。
 * [OUTPUT]: 执行 SELECT-01「拖选仅选中与自动高亮解耦」全量二值验收（S1~S9）。
 * [POS]: 公开浏览器验收套件 select-vs-highlight，注册于 scripts/verify.mjs。
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
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-select-vs-highlight-")));

const fixtureSource = `
import { TFile } from "obsidian";
import { Store } from "${project}/src/model/store";
import { DEFAULT_SETTINGS } from "${project}/src/types";
import { queryFeatures, openSettingAndReveal } from "${project}/src/search/featureSearch";
import { StudyWorkspaceView } from "${project}/src/workspace/studyWorkspace";
import { ReaderView } from "${project}/src/pdf/readerView";
import { DocumentReaderView } from "${project}/src/documents/documentReader";
import { WordReaderView } from "${project}/src/word/wordReader";

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

const page1Items = [
  { str: "这是八个中文字符", x: 60, y: 720, w: 220, h: 18, hasEOL: true },
  { str: "第二段八字内容啊", x: 60, y: 680, w: 220, h: 18, hasEOL: true },
  { str: "第三段八字文本哦", x: 60, y: 640, w: 220, h: 18, hasEOL: true },
  { str: "三个字", x: 60, y: 600, w: 90, h: 18, hasEOL: true },
  { str: "二字", x: 60, y: 560, w: 60, h: 18, hasEOL: true },
  { str: "多行第一行中文段", x: 60, y: 520, w: 220, h: 18, hasEOL: true },
  { str: "多行第二行中文段", x: 60, y: 480, w: 220, h: 18, hasEOL: true },
];
const page2Items = [
  { str: "跨页第二页首行字", x: 60, y: 720, w: 220, h: 18, hasEOL: true },
  { str: "跨页第二页次行字", x: 60, y: 680, w: 220, h: 18, hasEOL: true },
];

function makePdfBytes(name: string, pages = 2): ArrayBuffer {
  const payload: any = { name, pages, textItems: page1Items };
  if (pages >= 2) {
    payload.pageTexts = [page1Items, page2Items];
  }
  return new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer;
}

function selectNodeText(el: Element, start = 0, end?: number): Range {
  const node = el.firstChild!;
  const len = (node.textContent ?? "").length;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end ?? len);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}

function selectAcrossNodes(startEl: Element, endEl: Element): Range {
  const sNode = startEl.firstChild!;
  const eNode = endEl.firstChild!;
  const range = document.createRange();
  range.setStart(sNode, 0);
  range.setEnd(eNode, (eNode.textContent ?? "").length);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}

function findSpan(root: ParentNode, text: string, pageNum?: number): HTMLElement {
  const scope = pageNum ? root.querySelector(\`[data-page="\${pageNum}"]\`) : root;
  assert(scope, "Missing page container: " + pageNum);
  const found = [...scope!.querySelectorAll<HTMLElement>(".ms-text-layer span")].find(el => el.textContent === text);
  assert(found, "Missing text span: " + text + (pageNum ? " on page " + pageNum : ""));
  return found!;
}

function dispatchPtr(target: EventTarget, type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  target.dispatchEvent(new PointerEvent(type, {
    clientX: x,
    clientY: y,
    pointerId: 1,
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
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

async function dragSelectSpan(scroll: HTMLElement, text: string, dx = 180, dy = 0, waitMs = 300, extra: Record<string, unknown> = {}) {
  const span = findSpan(scroll, text);
  dispatchPtr(scroll, "pointerdown", 100, 100, { detail: 1, ...extra });
  selectNodeText(span);
  document.dispatchEvent(new Event("selectionchange"));
  dispatchPtr(window, "pointerup", 100 + dx, 100 + dy, { detail: 1, ...extra });
  if (waitMs > 0) await wait(waitMs);
  await frame();
}

async function dragSelectRange(scroll: HTMLElement, startEl: Element, endEl: Element, dx = 180, dy = 40, waitMs = 300) {
  dispatchPtr(scroll, "pointerdown", 100, 100, { detail: 1 });
  selectAcrossNodes(startEl, endEl);
  document.dispatchEvent(new Event("selectionchange"));
  dispatchPtr(window, "pointerup", 100 + dx, 100 + dy, { detail: 1 });
  if (waitMs > 0) await wait(waitMs);
  await frame();
}

function makeBaseEnv(pdfPath: string, initialDisk?: Partial<any>, extraFiles?: { path: string; content?: string; binary?: ArrayBuffer }[]) {
  const sources = new Map<string, { file: TFile; content: string; binary?: ArrayBuffer }>();
  const pdfBin = makePdfBytes(pdfPath, 2);
  const pdfFile = new TFile(pdfPath, pdfBin.byteLength);
  sources.set(pdfPath, { file: pdfFile, content: "", binary: pdfBin });
  const docPaths = [pdfPath];
  for (const extra of extraFiles ?? []) {
    const content = extra.content ?? "";
    const size = extra.binary ? extra.binary.byteLength : content.length;
    const f = new TFile(extra.path, size);
    sources.set(extra.path, { file: f, content, binary: extra.binary });
    docPaths.push(extra.path);
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
    studySets: [{ id: "set-1", name: "SELECT-01 Study", docPaths, createdAt: stamp }],
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
  return { app, store, host, pdfFile, sources };
}

async function openWorkspace(pdfPath: string, initialDisk?: Partial<any>, extraFiles?: { path: string; content?: string; binary?: ArrayBuffer }[]) {
  fixturesHost.replaceChildren();
  const { app, store, host, pdfFile, sources } = makeBaseEnv(pdfPath, initialDisk, extraFiles);
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
  await reader.renderPage(2);
  await frame();
  const root = view.contentEl as HTMLElement;
  return {
    app, store, host, plugin, view, reader, root, sources,
    scroll: reader.getScrollContainer(),
    ctrl: (reader as any).annController,
    async dispose() {
      await clearSelection();
      await view.onClose();
      view.unload();
      fixturesHost.replaceChildren();
    },
  };
}

function getPop(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".ms-ann-pop.ms-context-selection");
}

function primaryBtn(id: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(\`.ms-ann-pop.ms-context-selection .ms-context-primary [data-action-id="\${id}"]\`);
}

(window as any).runAll = async () => {
  const report: Record<string, any> = {};

  // ===== S1: 默认拖选仅选中（摘录 & 书写两场景）=====
  {
    const ws = await openWorkspace("s1.pdf");
    try {
      assert(ws.store.settings.autoHighlightOnSelect === false, "S1 default autoHighlightOnSelect must be false");
      await dragSelectSpan(ws.scroll, "这是八个中文字符", 180, 0, 300);
      const pop = getPop();
      const btnHl = primaryBtn("highlight");
      const btnCard = primaryBtn("excerpt-card");
      const btnCopy = primaryBtn("copy");
      const excerptState = {
        annotations: (await ws.store.loadAnnotations("s1.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
        selection: window.getSelection()?.toString().trim() ?? "",
        popVisible: !!pop && pop.checkVisibility(),
        hlVisible: !!btnHl && btnHl.checkVisibility(),
        cardVisible: !!btnCard && btnCard.checkVisibility(),
        copyVisible: !!btnCopy && btnCopy.checkVisibility(),
      };
      assert(excerptState.annotations === 0 && excerptState.cards === 0 && excerptState.nodes === 0,
        "S1 excerpt created artifacts: " + JSON.stringify(excerptState));
      assert(excerptState.selection === "这是八个中文字符", "S1 excerpt lost selection: " + JSON.stringify(excerptState));
      assert(excerptState.popVisible && excerptState.hlVisible && excerptState.cardVisible && excerptState.copyVisible,
        "S1 excerpt primary buttons not visible: " + JSON.stringify(excerptState));

      // 切换至 read-write-recall -> writing 场景
      await clearSelection();
      ws.store.selectStudyScene("set-1", "read-write-recall", "writing");
      ws.view.refresh(true);
      await frame();
      await dragSelectSpan(ws.scroll, "这是八个中文字符", 180, 0, 300);
      const writingPop = getPop();
      const writingState = {
        annotations: (await ws.store.loadAnnotations("s1.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
        selection: window.getSelection()?.toString().trim() ?? "",
        popVisible: !!writingPop && writingPop.checkVisibility(),
      };
      assert(writingState.annotations === 0 && writingState.cards === 0 && writingState.nodes === 0,
        "S1 writing created artifacts: " + JSON.stringify(writingState));
      assert(writingState.selection === "这是八个中文字符" && writingState.popVisible,
        "S1 writing selection/pop mismatch: " + JSON.stringify(writingState));
      report.S1 = { excerptState, writingState };
    } finally {
      await ws.dispose();
    }
  }

  // ===== S2: 菜单点「高亮」与 autoCardOnHighlight 联动 =====
  {
    // S2a: autoCardOnHighlight = false
    const wsA = await openWorkspace("s2a.pdf", { settings: { autoCardOnHighlight: false } });
    let s2a: any;
    try {
      await dragSelectSpan(wsA.scroll, "这是八个中文字符", 180, 0, 120);
      assert((await wsA.store.loadAnnotations("s2a.pdf")).length === 0, "S2a pre-click must be 0");
      primaryBtn("highlight")!.click();
      await wait(60);
      await frame();
      const afterHl = {
        annotations: (await wsA.store.loadAnnotations("s2a.pdf")).length,
        cards: wsA.store.cards.length,
        nodes: wsA.store.nodes.length,
      };
      assert(afterHl.annotations === 1 && afterHl.cards === 0 && afterHl.nodes === 0, "S2a highlight mismatch: " + JSON.stringify(afterHl));
      dispatchCmdZ(wsA.root, false);
      await wait(40);
      await frame();
      const afterUndo = {
        annotations: (await wsA.store.loadAnnotations("s2a.pdf")).length,
        cards: wsA.store.cards.length,
        nodes: wsA.store.nodes.length,
      };
      assert(afterUndo.annotations === 0 && afterUndo.cards === 0 && afterUndo.nodes === 0, "S2a undo mismatch: " + JSON.stringify(afterUndo));
      s2a = { afterHl, afterUndo };
    } finally {
      await wsA.dispose();
    }

    // S2b: autoCardOnHighlight = true + 3-char A4 guard
    const wsB = await openWorkspace("s2b.pdf", { settings: { autoCardOnHighlight: true } });
    let s2b: any;
    try {
      await dragSelectSpan(wsB.scroll, "这是八个中文字符", 180, 0, 120);
      assert((await wsB.store.loadAnnotations("s2b.pdf")).length === 0, "S2b pre-click must be 0");
      primaryBtn("highlight")!.click();
      await wait(60);
      await frame();
      const afterHl8 = {
        annotations: (await wsB.store.loadAnnotations("s2b.pdf")).length,
        cards: wsB.store.cards.length,
        nodes: wsB.store.nodes.length,
      };
      assert(afterHl8.annotations === 1 && afterHl8.cards === 1 && afterHl8.nodes >= 1, "S2b 8-char highlight mismatch: " + JSON.stringify(afterHl8));
      dispatchCmdZ(wsB.root, false);
      await wait(40);
      await frame();
      const afterUndo8 = {
        annotations: (await wsB.store.loadAnnotations("s2b.pdf")).length,
        cards: wsB.store.cards.length,
        nodes: wsB.store.nodes.length,
      };
      assert(afterUndo8.annotations === 0 && afterUndo8.cards === 0 && afterUndo8.nodes === 0, "S2b undo mismatch: " + JSON.stringify(afterUndo8));

      // 3-char manual highlight: 1 ann, 0 cards, 0 nodes (ANNOT-01 A4)
      await clearSelection();
      await dragSelectSpan(wsB.scroll, "三个字", 90, 0, 120);
      primaryBtn("highlight")!.click();
      await wait(60);
      await frame();
      const afterHl3 = {
        annotations: (await wsB.store.loadAnnotations("s2b.pdf")).length,
        cards: wsB.store.cards.length,
        nodes: wsB.store.nodes.length,
      };
      assert(afterHl3.annotations === 1 && afterHl3.cards === 0 && afterHl3.nodes === 0, "S2b 3-char mismatch: " + JSON.stringify(afterHl3));
      s2b = { afterHl8, afterUndo8, afterHl3 };
    } finally {
      await wsB.dispose();
    }
    report.S2 = { s2a, s2b };
  }

  // ===== S3: 菜单点「摘录卡」一步到位且不双卡、原子可撤 =====
  {
    // S3a: autoCardOnHighlight = false (8-char and 3-char)
    const wsA = await openWorkspace("s3a.pdf", { settings: { autoCardOnHighlight: false } });
    let s3a: any;
    try {
      const initHist = (wsA.store as any).history.length;
      await dragSelectSpan(wsA.scroll, "这是八个中文字符", 180, 0, 120);
      primaryBtn("excerpt-card")!.click();
      await wait(60);
      await frame();
      const anns8 = await wsA.store.loadAnnotations("s3a.pdf");
      const card8 = wsA.store.cards[0];
      const afterCard8 = {
        annotations: anns8.length,
        cards: wsA.store.cards.length,
        nodes: wsA.store.nodes.length,
        linked: !!card8 && anns8[0]?.cardId === card8.id && card8.anchorAnnId === anns8[0]?.id,
        storeHistDelta: (wsA.store as any).history.length - initHist,
      };
      assert(afterCard8.annotations === 1 && afterCard8.cards === 1 && afterCard8.linked && afterCard8.storeHistDelta === 0,
        "S3a 8-char excerpt-card mismatch: " + JSON.stringify(afterCard8));
      dispatchCmdZ(wsA.root, false);
      await wait(40);
      await frame();
      const afterUndo8 = {
        annotations: (await wsA.store.loadAnnotations("s3a.pdf")).length,
        cards: wsA.store.cards.length,
        nodes: wsA.store.nodes.length,
      };
      assert(afterUndo8.annotations === 0 && afterUndo8.cards === 0 && afterUndo8.nodes === 0,
        "S3a 8-char undo mismatch: " + JSON.stringify(afterUndo8));

      // 3-char explicit excerpt-card
      await clearSelection();
      await dragSelectSpan(wsA.scroll, "三个字", 90, 0, 120);
      primaryBtn("excerpt-card")!.click();
      await wait(60);
      await frame();
      const afterCard3 = {
        annotations: (await wsA.store.loadAnnotations("s3a.pdf")).length,
        cards: wsA.store.cards.length,
      };
      assert(afterCard3.annotations === 1 && afterCard3.cards === 1, "S3a 3-char excerpt-card mismatch: " + JSON.stringify(afterCard3));
      dispatchCmdZ(wsA.root, false);
      await wait(40);
      await frame();
      assert((await wsA.store.loadAnnotations("s3a.pdf")).length === 0 && wsA.store.cards.length === 0 && wsA.store.nodes.length === 0,
        "S3a 3-char undo not zero");
      s3a = { afterCard8, afterUndo8, afterCard3 };
    } finally {
      await wsA.dispose();
    }

    // S3b: autoCardOnHighlight = true (MUST NOT create 2 cards)
    const wsB = await openWorkspace("s3b.pdf", { settings: { autoCardOnHighlight: true } });
    let s3b: any;
    try {
      await dragSelectSpan(wsB.scroll, "这是八个中文字符", 180, 0, 120);
      primaryBtn("excerpt-card")!.click();
      await wait(60);
      await frame();
      const afterCard = {
        annotations: (await wsB.store.loadAnnotations("s3b.pdf")).length,
        cards: wsB.store.cards.length,
        nodes: wsB.store.nodes.length,
      };
      assert(afterCard.annotations === 1 && afterCard.cards === 1, "S3b double-card detected: " + JSON.stringify(afterCard));
      dispatchCmdZ(wsB.root, false);
      await wait(40);
      await frame();
      const afterUndo = {
        annotations: (await wsB.store.loadAnnotations("s3b.pdf")).length,
        cards: wsB.store.cards.length,
        nodes: wsB.store.nodes.length,
      };
      assert(afterUndo.annotations === 0 && afterUndo.cards === 0 && afterUndo.nodes === 0, "S3b undo mismatch: " + JSON.stringify(afterUndo));
      s3b = { afterCard, afterUndo };
    } finally {
      await wsB.dispose();
    }
    report.S3 = { s3a, s3b };
  }

  // ===== S4: 多行拖选 / 跨页拖选 / 连续 3 次拖选 =====
  {
    const ws = await openWorkspace("s4.pdf");
    try {
      // S4a: multi-line drag
      const line1 = findSpan(ws.scroll, "多行第一行中文段");
      const line2 = findSpan(ws.scroll, "多行第二行中文段");
      await dragSelectRange(ws.scroll, line1, line2, 180, 40, 300);
      const s4aPre = {
        annotations: (await ws.store.loadAnnotations("s4.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
        selText: window.getSelection()?.toString() ?? "",
        popVisible: !!getPop()?.checkVisibility(),
      };
      assert(s4aPre.annotations === 0 && s4aPre.cards === 0 && s4aPre.nodes === 0 && s4aPre.selText.includes("多行第一行") && s4aPre.selText.includes("多行第二行") && s4aPre.popVisible,
        "S4a multi-line pre-click mismatch: " + JSON.stringify(s4aPre));
      primaryBtn("highlight")!.click();
      await wait(60);
      await frame();
      const s4aAnns = await ws.store.loadAnnotations("s4.pdf");
      const s4aRects = s4aAnns[0]?.rects.length ?? 0;
      assert(s4aAnns.length === 1 && s4aRects >= 2, "S4a multi-line highlight rects mismatch: " + JSON.stringify(s4aAnns));
      dispatchCmdZ(ws.root, false);
      await wait(40);
      await frame();

      // S4b: cross-page drag (page 1 -> page 2) + late selectionchange
      await clearSelection();
      const p1Span = findSpan(ws.scroll, "多行第二行中文段", 1);
      const p2Span = findSpan(ws.scroll, "这是八个中文字符", 2);
      await dragSelectRange(ws.scroll, p1Span, p2Span, 180, 120, 40);
      document.dispatchEvent(new Event("selectionchange"));
      await wait(320);
      await frame();
      const s4bPre = {
        annotations: (await ws.store.loadAnnotations("s4.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
        selText: window.getSelection()?.toString() ?? "",
        popVisible: !!getPop()?.checkVisibility(),
      };
      assert(s4bPre.annotations === 0 && s4bPre.cards === 0 && s4bPre.nodes === 0 && s4bPre.selText.includes("多行第二行") && s4bPre.selText.includes("这是八个中文字符") && s4bPre.popVisible,
        "S4b cross-page pre-click mismatch: " + JSON.stringify(s4bPre));
      primaryBtn("highlight")!.click();
      await wait(60);
      await frame();
      const s4bAnns = await ws.store.loadAnnotations("s4.pdf");
      const s4bPages = s4bAnns[0]?.pdfGeometry?.length ?? 0;
      assert(s4bAnns.length === 1 && s4bPages === 2,
        "S4b cross-page highlight geometry mismatch: " + JSON.stringify(s4bAnns));
      dispatchCmdZ(ws.root, false);
      await wait(40);
      await frame();

      // S4c: 3 consecutive drags without clicking menu
      await clearSelection();
      await dragSelectSpan(ws.scroll, "这是八个中文字符", 180, 0, 120);
      await dragSelectSpan(ws.scroll, "第二段八字内容啊", 180, 0, 120);
      await dragSelectSpan(ws.scroll, "第三段八字文本哦", 180, 0, 300);
      const s4c = {
        annotations: (await ws.store.loadAnnotations("s4.pdf")).length,
        cards: ws.store.cards.length,
        nodes: ws.store.nodes.length,
        selection: window.getSelection()?.toString().trim() ?? "",
        currentText: (ws.ctrl as any).currentText,
        popVisible: !!getPop()?.checkVisibility(),
      };
      assert(s4c.annotations === 0 && s4c.cards === 0 && s4c.nodes === 0 && s4c.selection === "第三段八字文本哦" && s4c.currentText === "第三段八字文本哦" && s4c.popVisible,
        "S4c consecutive drags mismatch: " + JSON.stringify(s4c));
      report.S4 = { s4aRects, s4bPages, s4c };
    } finally {
      await ws.dispose();
    }
  }

  // ===== S5: 底层硬不变量 automaticTextExcerpt = false 永不自动建标注 =====
  {
    const htmlPath = "s5.html";
    const { app, store, sources } = makeBaseEnv("s5.pdf", { settings: { autoHighlightOnSelect: true, autoExcerptMinChars: 0 } }, [
      { path: htmlPath, content: "<html><body><p id='p1'>这是八个中文字符</p><p id='p2'>第二段八字内容啊</p></body></html>" },
    ]);
    await store.load();
    const leaf: any = { app, view: null, setViewState: async () => {}, updateHeader() {}, getRoot: () => app.workspace.rootSplit };
    app.workspace.activeLeaf = leaf;
    app.workspace.centerLeaf = leaf;
    const plugin: any = {
      manifest: { id: "margin-study" }, app, store, viewEvents: {}, studyWorkspace: null, activeReader: null,
      refreshMindmap() {}, refreshSidebar() {}, ensureSplitLayout: async () => {}, ensureMindMapOpen: async () => {},
      openStudyWorkspace: async () => null, openDocumentInReader: async () => {},
    };
    // PDF AnnotationController
    const pdfView = new ReaderView(leaf, plugin);
    leaf.view = pdfView;
    pdfView.containerEl.style.cssText = "position:relative;width:820px;height:760px;";
    fixturesHost.replaceChildren(pdfView.containerEl);
    await pdfView.onOpen();
    await pdfView.loadFileByPath("s5.pdf");
    pdfView.setScale(1);
    await pdfView.renderPage(1);
    await pdfView.renderPage(2);
    await frame();
    let pdfCounts: any;
    try {
      const pdfCtrl = (pdfView as any).annController;
      const pdfScroll = pdfView.getScrollContainer();
      pdfCtrl.setAutomaticTextExcerpt(false);
      await dragSelectSpan(pdfScroll, "这是八个中文字符", 180, 0, 240);
      await dragSelectSpan(pdfScroll, "这是八个中文字符", 0, 0, 240, { detail: 2 });
      await dragSelectSpan(pdfScroll, "这是八个中文字符", 0, 0, 240, { detail: 3 });
      await dragSelectRange(pdfScroll, findSpan(pdfScroll, "多行第一行中文段", 1), findSpan(pdfScroll, "多行第二行中文段", 1), 180, 40, 240);
      await dragSelectRange(pdfScroll, findSpan(pdfScroll, "多行第二行中文段", 1), findSpan(pdfScroll, "这是八个中文字符", 2), 180, 120, 240);
      selectNodeText(findSpan(pdfScroll, "第二段八字内容啊", 1));
      document.dispatchEvent(new Event("selectionchange"));
      await wait(240);
      pdfCounts = {
        annotations: (await store.loadAnnotations("s5.pdf")).length,
        cards: store.cards.length,
        nodes: store.nodes.length,
      };
      assert(pdfCounts.annotations === 0 && pdfCounts.cards === 0 && pdfCounts.nodes === 0,
        "S5 PDF invariant violated: " + JSON.stringify(pdfCounts));
    } finally {
      await clearSelection();
      await pdfView.onClose();
      pdfView.unload();
      fixturesHost.replaceChildren();
    }

    // HTML HtmlAnnotationController
    const htmlView = new DocumentReaderView(leaf, plugin);
    leaf.view = htmlView;
    htmlView.containerEl.style.cssText = "position:relative;width:820px;height:760px;";
    fixturesHost.replaceChildren(htmlView.containerEl);
    await htmlView.onOpen();
    await htmlView.loadFileByPath(htmlPath);
    await frame();
    let htmlCounts: any;
    try {
      htmlView.setAutomaticTextExcerpt(false);
      const p1 = htmlView.getBodyEl().querySelector("#p1")!;
      const p2 = htmlView.getBodyEl().querySelector("#p2")!;
      const htmlScroll = htmlView.getScrollContainer();
      dispatchPtr(htmlScroll, "pointerdown", 60, 60, { detail: 1 });
      selectNodeText(p1);
      document.dispatchEvent(new Event("selectionchange"));
      dispatchPtr(window, "pointerup", 220, 60, { detail: 1 });
      await wait(240);
      dispatchPtr(htmlScroll, "pointerdown", 60, 60, { detail: 2 });
      selectNodeText(p1);
      document.dispatchEvent(new Event("selectionchange"));
      dispatchPtr(window, "pointerup", 60, 60, { detail: 2 });
      await wait(240);
      dispatchPtr(htmlScroll, "pointerdown", 60, 60, { detail: 3 });
      selectNodeText(p1);
      document.dispatchEvent(new Event("selectionchange"));
      dispatchPtr(window, "pointerup", 60, 60, { detail: 3 });
      await wait(240);
      await dragSelectRange(htmlScroll, p1, p2, 180, 40, 240);
      selectNodeText(p2);
      document.dispatchEvent(new Event("selectionchange"));
      await wait(240);
      htmlCounts = {
        annotations: (await store.loadAnnotations(htmlPath)).length,
        cards: store.cards.length,
        nodes: store.nodes.length,
      };
      assert(htmlCounts.annotations === 0 && htmlCounts.cards === 0 && htmlCounts.nodes === 0,
        "S5 HTML invariant violated: " + JSON.stringify(htmlCounts));
    } finally {
      await clearSelection();
      await htmlView.onClose();
      htmlView.unload();
      fixturesHost.replaceChildren();
    }
    report.S5 = { pdfCounts, htmlCounts };
  }

  // ===== S6: 显式「拖选文本自动高亮」开关、实时生效、持久化与 featureSearch 索引 =====
  {
    assert(DEFAULT_SETTINGS.autoHighlightOnSelect === false, "S6 DEFAULT_SETTINGS.autoHighlightOnSelect must be false");
    assert(queryFeatures("拖选").some(e => e.id === "settings.auto-highlight-select"), "S6 queryFeatures('拖选') missed");
    assert(queryFeatures("autoHighlightOnSelect").some(e => e.id === "settings.auto-highlight-select"), "S6 queryFeatures('autoHighlightOnSelect') missed");

    const ws = await openWorkspace("s6.pdf");
    try {
      // openSettingAndReveal target scroll & flash check (full MarginStudySettingTab render is verified in search-features)
      const settingHost = document.createElement("div");
      const mockItem = document.createElement("div");
      mockItem.className = "setting-item";
      const mockName = document.createElement("div");
      mockName.className = "setting-item-name";
      mockName.textContent = "拖选文本自动高亮";
      mockItem.append(mockName);
      settingHost.append(mockItem);
      fixturesHost.append(settingHost);
      ws.app.setting = { open() {}, openTabById() {}, containerEl: settingHost };
      const revealed = openSettingAndReveal(ws.plugin, "拖选文本自动高亮");
      assert(revealed && mockItem.classList.contains("ms-setting-flash"), "S6 openSettingAndReveal failed");
      settingHost.remove();

      // Live toggle ON in workspace (no reopen, no scene switch)
      ws.store.settings.autoHighlightOnSelect = true;
      ws.store.save();
      await frame();
      await dragSelectSpan(ws.scroll, "这是八个中文字符", 180, 0, 120);
      assert((await ws.store.loadAnnotations("s6.pdf")).length === 1, "S6 live ON excerpt failed");
      dispatchCmdZ(ws.root, false);
      await wait(40);
      // 3-char still 0
      await clearSelection();
      await dragSelectSpan(ws.scroll, "三个字", 90, 0, 120);
      assert((await ws.store.loadAnnotations("s6.pdf")).length === 0, "S6 live ON 3-char should be 0");

      // writing scene with ON
      ws.store.selectStudyScene("set-1", "read-write-recall", "writing");
      ws.view.refresh(true);
      await frame();
      await clearSelection();
      await dragSelectSpan(ws.scroll, "这是八个中文字符", 180, 0, 120);
      assert((await ws.store.loadAnnotations("s6.pdf")).length === 1, "S6 live ON writing failed");
      dispatchCmdZ(ws.root, false);
      await wait(40);

      // reading scene -> 0
      ws.store.selectStudyScene("set-1", "read-write-recall", "reading");
      ws.view.refresh(true);
      await frame();
      await clearSelection();
      await dragSelectSpan(ws.scroll, "这是八个中文字符", 180, 0, 240);
      assert((await ws.store.loadAnnotations("s6.pdf")).length === 0, "S6 reading scene must not auto-highlight");

      // back to excerpt, traditional mode -> 0
      ws.store.selectStudyScene("set-1", "standard", "excerpt");
      ws.view.refresh(true);
      ws.view.toggleInterfaceMode();
      await frame();
      await clearSelection();
      await dragSelectSpan(ws.scroll, "这是八个中文字符", 180, 0, 240);
      assert((await ws.store.loadAnnotations("s6.pdf")).length === 0, "S6 traditional mode must not auto-highlight");
      ws.view.toggleInterfaceMode();
      await frame();

      // pen / region / block selection -> 0
      (ws.view as any).setReaderHandwritingMode("pen", false);
      await frame();
      await dragSelectSpan(ws.scroll, "这是八个中文字符", 180, 0, 120);
      assert((await ws.store.loadAnnotations("s6.pdf")).length === 0, "S6 pen mode must not auto-highlight");
      (ws.view as any).useReaderTool("region");
      await frame();
      await dragSelectSpan(ws.scroll, "这是八个中文字符", 180, 0, 120);
      assert((await ws.store.loadAnnotations("s6.pdf")).length === 0, "S6 region mode must not auto-highlight");
      (ws.view as any).useReaderTool("text");
      (ws.view as any).toggleBlockSelection();
      await frame();
      await dragSelectSpan(ws.scroll, "这是八个中文字符", 180, 0, 120);
      assert((await ws.store.loadAnnotations("s6.pdf")).length === 0, "S6 block selection must not auto-highlight");
      (ws.view as any).toggleBlockSelection();
      await frame();

      // Persistence check while ON
      await ws.store.flush();
      const reloadedOn = new Store(ws.host);
      await reloadedOn.load();
      assert(reloadedOn.settings.autoHighlightOnSelect === true, "S6 persistence ON failed");

      // Live toggle OFF -> immediately back to select-only
      ws.store.settings.autoHighlightOnSelect = false;
      ws.store.save();
      await frame();
      await clearSelection();
      await dragSelectSpan(ws.scroll, "这是八个中文字符", 180, 0, 240);
      assert((await ws.store.loadAnnotations("s6.pdf")).length === 0 && !!getPop()?.checkVisibility(), "S6 live OFF failed");

      await ws.store.flush();
      const reloadedOff = new Store(ws.host);
      await reloadedOff.load();
      assert(reloadedOff.settings.autoHighlightOnSelect === false, "S6 persistence OFF failed");
      report.S6 = { revealed: true, persistedOn: true, persistedOff: true };
    } finally {
      await ws.dispose();
    }
  }

  // ===== S7: 连续摘录高优先逐笔自动 + 退出立即复原 =====
  {
    const ws = await openWorkspace("s7.pdf");
    try {
      assert(ws.store.settings.autoHighlightOnSelect === false, "S7 must start with autoHighlightOnSelect=false");
      const contBtn = ws.root.querySelector<HTMLButtonElement>('[data-ms-tool="continuous-excerpt"]')!;
      assert(contBtn, "S7 missing continuous-excerpt button");
      contBtn.click();
      await frame();
      assert(ws.reader.getContinuousExcerpt().active === true, "S7 continuous excerpt did not activate");

      // Stroke 1 (8 chars), Stroke 2 (2 chars), Stroke 3 (multi-line)
      await dragSelectSpan(ws.scroll, "这是八个中文字符", 180, 0, 100);
      await clearSelection();
      await dragSelectSpan(ws.scroll, "二字", 60, 0, 100);
      await clearSelection();
      await dragSelectRange(ws.scroll, findSpan(ws.scroll, "多行第一行中文段"), findSpan(ws.scroll, "多行第二行中文段"), 180, 40, 100);

      const contAnns = await ws.store.loadAnnotations("s7.pdf");
      const contState = ws.reader.getContinuousExcerpt();
      assert(contAnns.length === 1 && ws.store.cards.length === 1 && contState.count === 3,
        "S7 continuous 3 strokes mismatch: " + JSON.stringify({ anns: contAnns.length, cards: ws.store.cards.length, contState }));
      assert(contAnns[0].text.includes("这是八个中文字符") && contAnns[0].text.includes("二字") && contAnns[0].text.includes("多行第一行"),
        "S7 continuous merged text missing segments: " + contAnns[0].text);

      // R-C3: switch excerpt.rectangle then back to excerpt.text keeps independent continuous state
      (ws.view as any).useReaderTool("region");
      await frame();
      assert(ws.reader.getContinuousExcerpt().active === false, "S7 region pen should have independent inactive state");
      (ws.view as any).useReaderTool("text");
      await frame();
      assert(ws.reader.getContinuousExcerpt().active === true && ws.reader.getContinuousExcerpt().count === 3,
        "S7 switching back to text pen lost continuous state");

      // Exit continuous excerpt -> 4th drag must NOT auto-create
      (ws.view as any).finishContinuousExcerpt();
      await frame();
      await clearSelection();
      await dragSelectSpan(ws.scroll, "第二段八字内容啊", 180, 0, 300);
      assert((await ws.store.loadAnnotations("s7.pdf")).length === 1 && !!getPop()?.checkVisibility() && window.getSelection()?.toString().trim() === "第二段八字内容啊",
        "S7 post-exit drag auto-created or lost menu");

      // continueExcerptInCard under autoHighlightOnSelect=false
      const existingCardId = ws.store.cards[0].id;
      await clearSelection();
      assert(ws.ctrl.continueExcerptInCard(existingCardId) === true, "S7 continueExcerptInCard returned false");
      await frame();
      await dragSelectSpan(ws.scroll, "第三段八字文本哦", 180, 0, 100);
      assert(ws.store.getCard(existingCardId)!.front.includes("第三段八字文本哦"), "S7 continueExcerptInCard did not append");
      ws.reader.setContinuousExcerpt(false);
      await frame();
      await clearSelection();
      const annsBefore = (await ws.store.loadAnnotations("s7.pdf")).length;
      await dragSelectSpan(ws.scroll, "这是八个中文字符", 180, 0, 240);
      assert((await ws.store.loadAnnotations("s7.pdf")).length === annsBefore && !!getPop()?.checkVisibility(),
        "S7 after continueExcerptInCard close did not restore select-only");
      report.S7 = { count: 3, rc3Kept: true, postExitSelectOnly: true, continueInCard: true };
    } finally {
      await ws.dispose();
    }
  }

  // ===== S8: 风险时序专项（双击/三击 + 触屏长按 + 拖拽停顿 + 迟到 selectionchange）=====
  {
    const ws = await openWorkspace("s8.pdf");
    try {
      // S8a: detail=2, detail=3, and detail=0 rapid multi-click
      await dragSelectSpan(ws.scroll, "这是八个中文字符", 0, 0, 120, { detail: 2 });
      assert((await ws.store.loadAnnotations("s8.pdf")).length === 0 && !!getPop()?.checkVisibility() && window.getSelection()?.toString().trim() === "这是八个中文字符",
        "S8a detail=2 failed");
      await clearSelection();
      await dragSelectSpan(ws.scroll, "第二段八字内容啊", 0, 0, 120, { detail: 3 });
      assert((await ws.store.loadAnnotations("s8.pdf")).length === 0 && !!getPop()?.checkVisibility(),
        "S8a detail=3 failed");
      // detail=0 rapid 2-click within 350ms & <=8px
      await clearSelection();
      const span3 = findSpan(ws.scroll, "第三段八字文本哦");
      dispatchPtr(ws.scroll, "pointerdown", 120, 120, { detail: 0 });
      dispatchPtr(window, "pointerup", 120, 120, { detail: 0 });
      await wait(80);
      dispatchPtr(ws.scroll, "pointerdown", 121, 121, { detail: 0 });
      selectNodeText(span3);
      document.dispatchEvent(new Event("selectionchange"));
      dispatchPtr(window, "pointerup", 121, 121, { detail: 0 });
      await wait(120);
      await frame();
      assert((await ws.store.loadAnnotations("s8.pdf")).length === 0 && !!getPop()?.checkVisibility(),
        "S8a detail=0 rapid multi-click was killed by micro-drag");

      // S8b: touch long-press (cancel path + 380ms hold path) vs mouse 4px micro-drag
      await clearSelection();
      await wait(400); // reset multi-click window
      dispatchPtr(ws.scroll, "pointerdown", 140, 140, { pointerType: "touch", detail: 1 });
      dispatchPtr(window, "pointercancel", 140, 140, { pointerType: "touch", detail: 1 });
      selectNodeText(findSpan(ws.scroll, "这是八个中文字符"));
      document.dispatchEvent(new Event("selectionchange"));
      await wait(240);
      await frame();
      assert((await ws.store.loadAnnotations("s8.pdf")).length === 0 && !!getPop()?.checkVisibility(),
        "S8b touch cancel path failed");

      await clearSelection();
      await wait(400);
      dispatchPtr(ws.scroll, "pointerdown", 150, 150, { pointerType: "touch", detail: 1 });
      await wait(380);
      selectNodeText(findSpan(ws.scroll, "第二段八字内容啊"));
      document.dispatchEvent(new Event("selectionchange"));
      dispatchPtr(window, "pointerup", 152, 150, { pointerType: "touch", detail: 1 });
      await wait(120);
      await frame();
      assert((await ws.store.loadAnnotations("s8.pdf")).length === 0 && !!getPop()?.checkVisibility(),
        "S8b touch 380ms hold path failed");

      // Mouse 4px micro-drag -> strictly 0 annotations && !pop
      await clearSelection();
      await wait(400);
      await dragSelectSpan(ws.scroll, "第三段八字文本哦", 4, 0, 240, { pointerType: "mouse", detail: 0 });
      assert((await ws.store.loadAnnotations("s8.pdf")).length === 0 && ws.store.cards.length === 0 && ws.store.nodes.length === 0 && !getPop(),
        "S8b single mouse 4px micro-drag was not blocked");

      // Consecutive 4px micro-drags from same origin at 40/65/120ms (3 repeats each, simulating real Obsidian pointerdown.detail=0 + mousedown.detail=1)
      const microDragOnce = async (text: string, x0 = 160, y0 = 160) => {
        const span = findSpan(ws.scroll, text);
        dispatchPtr(ws.scroll, "pointerdown", x0, y0, { pointerType: "mouse", detail: 0 });
        ws.scroll.dispatchEvent(new MouseEvent("mousedown", { clientX: x0, clientY: y0, button: 0, detail: 1, bubbles: true, cancelable: true }));
        selectNodeText(span);
        document.dispatchEvent(new Event("selectionchange"));
        dispatchPtr(window, "pointerup", x0 + 4, y0, { pointerType: "mouse", detail: 0 });
      };
      for (const gapMs of [40, 65, 120]) {
        for (let trial = 0; trial < 3; trial++) {
          await clearSelection();
          await wait(380);
          await microDragOnce("这是八个中文字符");
          await wait(gapMs);
          await microDragOnce("这是八个中文字符");
          await wait(240);
          await frame();
          assert((await ws.store.loadAnnotations("s8.pdf")).length === 0 && ws.store.cards.length === 0 && ws.store.nodes.length === 0 && !getPop(),
            \`S8b consecutive 2x 4px micro-drag @\${gapMs}ms trial \${trial + 1} popped menu\`);
        }
      }

      // 3 consecutive 4px micro-drags @ 60ms -> still no popup
      await clearSelection();
      await wait(380);
      await microDragOnce("第二段八字内容啊");
      await wait(60);
      await microDragOnce("第二段八字内容啊");
      await wait(60);
      await microDragOnce("第二段八字内容啊");
      await wait(240);
      await frame();
      assert((await ws.store.loadAnnotations("s8.pdf")).length === 0 && ws.store.cards.length === 0 && ws.store.nodes.length === 0 && !getPop(),
        "S8b consecutive 3x 4px micro-drag @60ms popped menu");

      // 4px micro-drag + normal 8-char drag + 4px micro-drag -> ONLY normal drag pops menu
      await clearSelection();
      await wait(380);
      await microDragOnce("这是八个中文字符");
      await wait(60);
      assert(!getPop(), "S8b interleaved 1st micro-drag popped menu");
      await dragSelectSpan(ws.scroll, "这是八个中文字符", 180, 0, 120, { pointerType: "mouse", detail: 0 });
      assert((await ws.store.loadAnnotations("s8.pdf")).length === 0 && !!getPop()?.checkVisibility(),
        "S8b interleaved normal 8-char drag did not pop menu");
      await wait(60);
      await microDragOnce("这是八个中文字符");
      await wait(240);
      await frame();
      assert((await ws.store.loadAnnotations("s8.pdf")).length === 0 && !getPop(),
        "S8b interleaved 2nd micro-drag popped menu");

      // S8c: drag pause 260ms before pointerup -> no early popup; after pointerup expand More + late selectionchange -> secondary stays connected
      await clearSelection();
      await wait(400);
      dispatchPtr(ws.scroll, "pointerdown", 100, 100, { detail: 1 });
      selectNodeText(findSpan(ws.scroll, "这是八个中文字符"));
      document.dispatchEvent(new Event("selectionchange"));
      await wait(260);
      await frame();
      assert((await ws.store.loadAnnotations("s8.pdf")).length === 0 && !document.querySelector(".ms-ann-pop"),
        "S8c early popup appeared while pointer still down");
      dispatchPtr(window, "pointerup", 280, 100, { detail: 1 });
      await wait(60);
      await frame();
      const pop = getPop();
      assert(!!pop, "S8c popup missing after pointerup");
      const moreBtn = pop!.querySelector<HTMLButtonElement>('[data-action-id="more"]')!;
      moreBtn.click();
      await frame();
      const secBefore = pop!.querySelector<HTMLElement>(".ms-context-secondary");
      assert(!!secBefore && secBefore!.checkVisibility(), "S8c secondary drawer did not open");
      // Late same-selection selectionchange
      document.dispatchEvent(new Event("selectionchange"));
      await wait(240);
      await frame();
      assert(secBefore!.isConnected && secBefore!.checkVisibility(), "S8c late selectionchange destroyed expanded More drawer");

      report.S8 = { s8a: true, s8b: true, s8c: true };
    } finally {
      await ws.dispose();
    }
  }

  // ===== S9: HTML / Word 阅读器一致性 =====
  {
    const htmlPath = "s9.html";
    const docxPath = "s9.docx";
    const docxBin = new TextEncoder().encode(JSON.stringify({ content: "<p>这是八个中文字符</p><p>第二段八字内容啊</p>" })).buffer as ArrayBuffer;
    const ws = await openWorkspace("s9.pdf", undefined, [
      { path: htmlPath, content: "<html><body><p id='hp1'>这是八个中文字符</p><p id='hp2'>第二段八字内容啊</p></body></html>" },
      { path: docxPath, binary: docxBin },
    ]);
    try {
      // HTML
      await ws.view.openFile(ws.sources.get(htmlPath)!.file);
      await frame();
      const docReader = (ws.view as any).reader as DocumentReaderView;
      assert(docReader instanceof DocumentReaderView, "S9 expected DocumentReaderView");
      const hp1 = docReader.getBodyEl().querySelector("#hp1")!;
      dispatchPtr(docReader.getScrollContainer(), "pointerdown", 60, 60, { detail: 1 });
      selectNodeText(hp1);
      document.dispatchEvent(new Event("selectionchange"));
      dispatchPtr(window, "pointerup", 220, 60, { detail: 1 });
      await wait(240);
      await frame();
      assert((await ws.store.loadAnnotations(htmlPath)).length === 0 && !!getPop()?.checkVisibility(), "S9 HTML default select-only failed");
      primaryBtn("highlight")!.click();
      await wait(60);
      assert((await ws.store.loadAnnotations(htmlPath)).length === 1, "S9 HTML menu highlight failed");

      // Word
      await clearSelection();
      await ws.view.openFile(ws.sources.get(docxPath)!.file);
      await frame();
      await wait(80);
      const wordReader = (ws.view as any).reader as WordReaderView;
      assert(wordReader instanceof WordReaderView, "S9 expected WordReaderView");
      const wp1 = wordReader.getBodyEl().querySelector("p")!;
      dispatchPtr(wordReader.getScrollContainer(), "pointerdown", 60, 60, { detail: 1 });
      selectNodeText(wp1);
      document.dispatchEvent(new Event("selectionchange"));
      dispatchPtr(window, "pointerup", 220, 60, { detail: 1 });
      await wait(240);
      await frame();
      assert((await ws.store.loadAnnotations(docxPath)).length === 0 && !!getPop()?.checkVisibility(), "S9 Word default select-only failed");
      const cardsBefore = ws.store.cards.length;
      primaryBtn("excerpt-card")!.click();
      await wait(60);
      assert((await ws.store.loadAnnotations(docxPath)).length === 1 && ws.store.cards.length === cardsBefore + 1, "S9 Word menu excerpt-card failed");
      report.S9 = { html: true, word: true };
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
  await writeFile(join(temporary, "select-vs-highlight-fixture.ts"), fixtureSource);

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
    '<!doctype html><meta charset="utf-8"><title>MarginStudy SELECT-01 Acceptance</title><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0;height:100%}#fixtures{position:relative;width:100vw;height:100vh;overflow:hidden}.test-item-view{height:100%;width:100%;display:flex;flex-direction:column}.test-item-view>.view-content{height:100%;width:100%;overflow:hidden}</style><main id="fixtures"></main><script type="module" src="/fixture.js"></script>',
  );

  await build({
    entryPoints: [join(temporary, "select-vs-highlight-fixture.ts")],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "chrome120",
    outfile: join(temporary, "fixture.js"),
    plugins: [{
      name: "select-vs-highlight-adapters",
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
  const session = `marginstudy-select-vs-highlight-${process.pid}`;
  const browser = (...args) => runBrowser(session, ...args);

  try {
    await browser("open", "about:blank");
    await browser("set", "viewport", "1280", "900");
    await browser("open", `http://127.0.0.1:${server.address().port}`);
    await browser("wait", "--fn", "window.ready === true");
    const result = JSON.parse((await browser("eval", "window.runAll()")).stdout);
    const errs = JSON.parse((await browser("eval", "window.getErrors()")).stdout);
    if (errs.length) throw new Error("Unhandled browser errors: " + JSON.stringify(errs));
    console.log("PASS select-vs-highlight:", JSON.stringify(result));
  } finally {
    await browser("close").catch(() => {});
    await new Promise(done => server.close(done));
  }
} finally {
  await rm(temporary, { recursive: true, force: true }).catch(() => {});
}
