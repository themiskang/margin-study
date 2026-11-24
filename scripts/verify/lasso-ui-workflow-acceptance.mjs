/**
 * [INPUT]: 依赖 ReaderView、HtmlAnnotationController、ExtendNotes、StudyWorkspaceView、样式表与默认 agent-browser 后端，零私有夹具依赖。
 * [OUTPUT]: 执行 GAP-08 G8-01~G8-04(UI)/G8-06(UI) 合成浏览器验收；若设置 MARGINSTUDY_EVIDENCE_DIR 则落盘证据 JSON。
 * [POS]: 公开浏览器验收套件 lasso-ui-workflow，验证套索圈选/平移/跨页互斥/句柄不抢、D-22 5 项与富剪贴板/焦点/夹紧/留白改色、转摘录与区域摘录撤重/blur/底栏互斥、冷重载与像素一致性。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { readFile, writeFile, mkdtemp, realpath, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { runBrowser } from "./ego-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const project = await realpath(resolve(here, "../.."));
const docFixtures = join(project, "src/documents/acceptance-fixtures");
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-lasso-ui-")));

const fixtureSource = `
import { TFile, Notice } from "obsidian";
import { Store } from "${project}/src/model/store";
import { ReaderView } from "${project}/src/pdf/readerView";
import { HtmlAnnotationController } from "${project}/src/word/htmlAnnot";
import { StudyWorkspaceView } from "${project}/src/workspace/studyWorkspace";
import { PenController } from "${project}/src/annot/pen";
import { recognizeInk } from "${project}/src/annot/recognizeInk";

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
const stamp = "2026-11-24T00:00:00Z";

function pointer(target: Element, host: Element, type: string, x: number, y: number, extra: any = {}) {
  const b = host.getBoundingClientRect();
  target.dispatchEvent(new PointerEvent(type, {
    clientX: b.left + x * b.width,
    clientY: b.top + y * b.height,
    pointerId: 1, button: 0, isPrimary: true, bubbles: true, cancelable: true, ...extra,
  }));
}
function drag(target: Element, host: Element, pts: number[][], extra: any = {}) {
  pointer(target, host, "pointerdown", pts[0][0], pts[0][1], extra);
  for (let i = 1; i < pts.length - 1; i++) pointer(target, host, "pointermove", pts[i][0], pts[i][1], extra);
  const last = pts[pts.length - 1];
  pointer(target, host, "pointerup", last[0], last[1], extra);
}

function makePluginEnv(filesMap: Record<string, string | object>) {
  const sources = new Map<string, { file: TFile; content: string }>();
  for (const [path, val] of Object.entries(filesMap)) {
    const content = typeof val === "string" ? val : JSON.stringify(val);
    sources.set(path, { file: new TFile(path, content.length), content });
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
      async readBinary(file: TFile) { return new TextEncoder().encode(sources.get(file.path)!.content).buffer; },
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
      openLinkText: async () => {},
      revealLeaf: async () => {},
      setActiveLeaf(next: any) { this.activeLeaf = next; },
    },
  };
  let disk: any = {
    cards: [], nodes: [], edges: [], srs: {},
    studySets: [{ id: "set-1", name: "Lasso Study", docPaths: [...sources.keys()], createdAt: stamp }],
    canvases: [{ id: "canvas-1", studySetId: "set-1", name: "Map 1", createdAt: stamp }],
    activeStudySetId: "set-1", activeCanvasId: "canvas-1",
    settings: { autoCardOnRegion: true, autoNodeOnCard: false, syncDeleteCardOnSourceRemoval: true },
  };
  let writes = 0;
  const host: any = {
    app,
    loadData: async () => JSON.parse(JSON.stringify(disk)),
    saveData: async (v: any) => { writes++; disk = JSON.parse(JSON.stringify(v)); },
  };
  const makeStore = async () => {
    const store = new Store(host);
    await store.load();
    return store;
  };
  return { app, sources, adapterFiles, makeStore, getWrites: () => writes, getDisk: () => disk };
}

function createPlugin(app: any, store: any) {
  return {
    manifest: { id: "margin-study" },
    app, store,
    viewEvents: {},
    studyWorkspace: null as any,
    activeReader: null as any,
    refreshMindmap() {},
    refreshSidebar() {},
    ensureSplitLayout: async () => {},
    openDocument: async () => {},
  };
}

function createHtmlController(plugin: any, path: string, htmlText = "<p>Alpha paragraph for lasso region excerpt testing.</p><p>Second line of text content.</p>") {
  const scroll = document.createElement("div");
  scroll.className = "ms-scroll";
  scroll.style.cssText = "position:relative;width:500px;height:400px;overflow:auto;";
  const body = document.createElement("div");
  body.className = "ms-word-body";
  body.style.cssText = "position:relative;width:500px;height:400px;background:#fff;";
  body.innerHTML = htmlText;
  scroll.append(body);
  fixturesHost.append(scroll);
  const reader = { getScrollContainer: () => scroll, getBodyEl: () => body, getFilePath: () => path };
  const ann = new HtmlAnnotationController(plugin, reader as any);
  return { scroll, body, ann, async load() { await ann.loadForDoc(path); }, async close() { ann.destroy(); scroll.remove(); } };
}

async function openPdfReader(plugin: any, file: TFile, widthPx = 640, heightPx = 720) {
  const leaf: any = { app: plugin.app, setViewState: async () => {}, updateHeader() {}, getRoot: () => plugin.app.workspace.rootSplit };
  const view = new ReaderView(leaf, plugin);
  view.containerEl.style.cssText = \`position:relative;width:\${widthPx}px;height:\${heightPx}px;display:flex;flex-direction:column;\`;
  fixturesHost.append(view.containerEl);
  await view.onOpen();
  await view.loadFileByPath(file.path);
  await wait(80);
  await frame();
  return view;
}

function boxInside(inner: DOMRect, outer: DOMRect, tol = 1.5) {
  return inner.left >= outer.left - tol && inner.top >= outer.top - tol && inner.right <= outer.right + tol && inner.bottom <= outer.bottom + tol;
}

function centerHit(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
}

// ===== G8-01: 句柄不抢指针、圈选平移撞页边不失真、裁边页、跨页选区互斥、Esc =====
(window as any).runG801 = async () => {
  fixturesHost.replaceChildren();
  const env = makePluginEnv({ "g801.pdf": { name: "g801", pages: 2 } });
  const store = await env.makeStore();
  const plugin = createPlugin(env.app, store);
  const view = await openPdfReader(plugin, env.sources.get("g801.pdf")!.file, 680, 900);
  const ctrl = (view as any).annController;
  try {
    // 1. 构造第 1 页与第 2 页笔迹 + 第 1 页自由文本框
    const hostAnn = {
      id: "host-text-1", docPath: "g801.pdf", docKind: "pdf", page: 1, type: "note",
      rects: [{ x: 100, y: 500, w: 180, h: 90 }], pdfCoordinateSpace: "pdf",
      text: "Host Box", color: "#3478f6", overlay: { kind: "text" }, createdAt: stamp,
    };
    const p1Stroke = [{ x: 0.2, y: 0.25, pressure: 0.25 }, { x: 0.5, y: 0.25, pressure: 0.85 }];
    const p1Ann = {
      id: "pen-p1", docPath: "g801.pdf", docKind: "pdf", page: 1, type: "pen", rects: [], text: "",
      color: "#1e88e5", inkBrush: "pen", inkWidth: 3, inkOpacity: 1, strokes: [p1Stroke], createdAt: stamp,
    };
    const p2Ann = {
      id: "pen-p2", docPath: "g801.pdf", docKind: "pdf", page: 2, type: "pen", rects: [], text: "",
      color: "#e53935", inkBrush: "pen", inkWidth: 3, inkOpacity: 1, strokes: [[{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.2 }]], createdAt: stamp,
    };
    await store.saveAnnotationsNow("g801.pdf", [hostAnn, p1Ann, p2Ann]);
    await ctrl.loadForDoc("g801.pdf");
    await (view as any).renderPage(1);
    await (view as any).renderPage(2);
    await frame();

    const p1Rec = view.getPageRecord(1)!;
    const p2Rec = view.getPageRecord(2)!;
    assert(p1Rec && p2Rec, "2 PDF pages should be rendered");

    // 激活自由文本框 chrome (is-active) 并监听句柄 pointerdown
    const chrome = p1Rec.wrapper.querySelector<HTMLElement>('.ms-free-overlay-chrome[data-ann-id="host-text-1"]')!;
    assert(chrome, "free overlay chrome missing");
    chrome.classList.add("is-active");
    let handlePointerDowns = 0;
    for (const h of chrome.querySelectorAll(".ms-free-overlay-tools, .ms-free-overlay-resize")) {
      h.addEventListener("pointerdown", () => { handlePointerDowns++; });
    }
    const hostRectBefore = structuredClone((await store.loadAnnotations("g801.pdf")).find((a: any) => a.id === "host-text-1").rects);

    // 进入套索模式，验证句柄 pointer-events 为 none
    ctrl.setHandwritingMode("lasso");
    await frame();
    const toolsEl = chrome.querySelector<HTMLElement>(".ms-free-overlay-tools")!;
    const resizeEl = chrome.querySelector<HTMLElement>(".ms-free-overlay-resize")!;
    assert(getComputedStyle(toolsEl).pointerEvents === "none", "tools handle should have pointer-events: none in pen mode");
    assert(getComputedStyle(resizeEl).pointerEvents === "none", "resize handle should have pointer-events: none in pen mode");

    // 从句柄区位置使用 elementFromPoint 确认命中 ms-pen-overlay 而非句柄
    const toolsBox = toolsEl.getBoundingClientRect();
    const hitAtHandle = document.elementFromPoint(toolsBox.left + toolsBox.width / 2, toolsBox.top + toolsBox.height / 2);
    assert(hitAtHandle && !chrome.contains(hitAtHandle), "pointer at handle should pass through to pen overlay");

    // 在第 1 页圈选笔迹并平移（含撞右边界夹紧）
    const ov1 = p1Rec.wrapper.querySelector<SVGSVGElement>(".ms-pen-overlay")!;
    drag(ov1, p1Rec.wrapper, [[0.15, 0.18], [0.55, 0.18], [0.55, 0.32], [0.15, 0.32], [0.15, 0.18]]);
    assert(!!ov1.querySelector(".ms-pen-selection"), "selection rect should exist on page 1");

    // 正常小幅平移 (+0.1, +0.05)
    drag(ov1, p1Rec.wrapper, [[0.3, 0.25], [0.4, 0.30]]);
    await wait(20);
    let movedAnn = (await store.loadAnnotations("g801.pdf")).find((a: any) => a.id === "pen-p1");
    assert(Math.abs(movedAnn.strokes[0][0].x - 0.3) <= 1e-6 && Math.abs(movedAnn.strokes[0][0].y - 0.3) <= 1e-6, "move delta accuracy <= 1e-6");
    assert(movedAnn.strokes[0][0].pressure === 0.25 && movedAnn.strokes[0][1].pressure === 0.85, "pressure preserved on move");

    // 撞右页边平移 (+0.9, 0) -> 整组夹紧至 right=1.0，段长保持 0.3
    drag(ov1, p1Rec.wrapper, [[0.4, 0.30], [1.3, 0.30]]);
    await wait(20);
    movedAnn = (await store.loadAnnotations("g801.pdf")).find((a: any) => a.id === "pen-p1");
    const segLen = movedAnn.strokes[0][1].x - movedAnn.strokes[0][0].x;
    assert(Math.abs(movedAnn.strokes[0][1].x - 1) <= 1e-6 && Math.abs(segLen - 0.3) <= 1e-6, "edge clamp preserves segment length");
    assert(handlePointerDowns === 0, "handle pointerdown count must be 0");
    const hostRectAfter = (await store.loadAnnotations("g801.pdf")).find((a: any) => a.id === "host-text-1").rects;
    assert(JSON.stringify(hostRectAfter) === JSON.stringify(hostRectBefore), "host box coords delta === 0");

    // 跨页圈选第 2 页 -> 第 1 页选区清除，全文档可见工具条严格 === 1
    const ov2 = p2Rec.wrapper.querySelector<SVGSVGElement>(".ms-pen-overlay")!;
    drag(ov2, p2Rec.wrapper, [[0.15, 0.12], [0.55, 0.12], [0.55, 0.28], [0.15, 0.28], [0.15, 0.12]]);
    await frame();
    const visibleToolbars = [...document.querySelectorAll<HTMLElement>(".ms-pen-selection-toolbar:not([hidden])")];
    assert(visibleToolbars.length === 1, "expected exactly 1 visible lasso toolbar across pages, got " + visibleToolbars.length);
    assert(!ov1.querySelector(".ms-pen-selection") && !!ov2.querySelector(".ms-pen-selection"), "page 1 selection cleared, page 2 active");

    // Esc 取消选区且写盘增量 === 0
    await store.flush();
    const writesBeforeEsc = env.getWrites();
    ov2.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await wait(30);
    assert(!ov2.querySelector(".ms-pen-selection"), "Esc cleared selection");
    assert(document.querySelectorAll(".ms-pen-selection-toolbar:not([hidden])").length === 0, "Esc hid toolbar");
    assert(env.getWrites() === writesBeforeEsc, "Esc caused 0 disk writes");

    // 裁边页隐藏端点不拉入视野
    const croppedAnn = {
      id: "pen-crop", docPath: "g801.pdf", docKind: "pdf", page: 1, type: "pen", rects: [], text: "",
      color: "#000000", strokes: [[{ x: 0.05, y: 0.5 }, { x: 0.6, y: 0.5 }]], createdAt: stamp,
    };
    await store.saveAnnotationsNow("g801.pdf", [hostAnn, croppedAnn]);
    await ctrl.loadForDoc("g801.pdf");
    await view.setPageCrop({ left: 0.2, top: 0, right: 1, bottom: 1 });
    await (view as any).renderPage(1);
    await wait(60);
    await frame();
    view.setHandwritingMode("lasso");
    await frame();
    const cropRec = view.getPageRecord(1)!;
    const ovCrop = cropRec.wrapper.querySelector<SVGSVGElement>(".ms-pen-overlay")!;
    assert(ovCrop, "ovCrop missing; canvas=" + cropRec.canvas.width + "x" + cropRec.canvas.height + " errors=" + JSON.stringify(errors));
    drag(ovCrop, cropRec.wrapper, [[0.05, 0.42], [0.6, 0.42], [0.6, 0.58], [0.05, 0.58], [0.05, 0.42]]);
    drag(ovCrop, cropRec.wrapper, [[0.3, 0.5], [0.3, 0.6]]);
    await wait(20);
    const afterCropMove = (await store.loadAnnotations("g801.pdf")).find((a: any) => a.id === "pen-crop");
    assert(afterCropMove.strokes[0][0].x < 0.1, "cropped hidden endpoint must remain outside crop left=0.2, got " + afterCropMove.strokes[0][0].x);

    return { passed: true, handlePointerDowns, visibleToolbarsCrossPage: visibleToolbars.length, escWriteDelta: env.getWrites() - writesBeforeEsc, croppedEndX: afterCropMove.strokes[0][0].x };
  } finally {
    await view.onClose();
    view.containerEl.remove();
  }
};

// ===== G8-02: D-22 5 项顺序、窄窗/贴边定位、富剪贴板无手动聚焦粘贴、AI 转文本、删除保 ID、留白改色 =====
(window as any).runG802 = async () => {
  fixturesHost.replaceChildren();
  const env = makePluginEnv({ "g802.html": "<p>Test</p>", "g802.pdf": { name: "g802", pages: 1 } });
  const store = await env.makeStore();
  const plugin = createPlugin(env.app, store);

  // 1. HTML 窄窗 (380x700) + 贴边定位 + D-22 + 富剪贴板 + 焦点粘贴 + 删除保 ID + AI 转文本
  const h = createHtmlController(plugin, "g802.html");
  h.scroll.style.width = "380px"; h.scroll.style.height = "700px";
  h.body.style.width = "380px"; h.body.style.height = "700px";
  await h.load();
  try {
    // 贴右贴顶笔迹 + 荧光笔 + 普通笔
    const penNormal = {
      id: "ann-normal", docPath: "g802.html", docKind: "html", page: 0, type: "pen", rects: [], text: "",
      color: "#1e88e5", inkBrush: "pen", inkWidth: 5, inkOpacity: 0.9,
      strokes: [[{ x: 0.72, y: 0.04 }, { x: 0.96, y: 0.04 }]], createdAt: stamp,
    };
    const penHighlight = {
      id: "ann-hl", docPath: "g802.html", docKind: "html", page: 0, type: "pen", rects: [], text: "",
      color: "#ffd54f", inkBrush: "highlight", inkWidth: 18, inkOpacity: 0.42,
      strokes: [[{ x: 0.72, y: 0.08 }, { x: 0.96, y: 0.08 }]], createdAt: stamp,
    };
    store.addCard({ id: "c-normal", docPath: "g802.html", type: "excerpt", color: "#1e88e5", front: "F", links: [], tags: [], anchorAnnId: "ann-normal", page: 0, createdAt: stamp });
    await store.saveAnnotationsNow("g802.html", [penNormal, penHighlight]);
    await h.ann.loadForDoc("g802.html");
    h.ann.setHandwritingMode("lasso");
    await frame();

    const ov = h.body.querySelector<SVGSVGElement>(".ms-pen-overlay")!;
    drag(ov, h.body, [[0.65, 0.01], [0.99, 0.01], [0.99, 0.14], [0.65, 0.14], [0.65, 0.01]]);
    await frame();

    const bar = h.body.querySelector<HTMLElement>(".ms-pen-selection-toolbar")!;
    const extra = h.body.querySelector<HTMLElement>(".ms-pen-selection-extra")!;
    const pal = h.body.querySelector<HTMLElement>(".ms-pen-color-palette")!;
    assert(bar && !bar.hidden, "toolbar visible");
    const order = [...bar.querySelectorAll(":scope > button")].map(b => b.getAttribute("aria-label")).join("/");
    assert(order === "颜色/剪切/复制/AI 转文本/删除", "D-22 order mismatch: " + order);

    // 打开调色盘，校验三者全部在 380x700 容器内（容差 1px）且中心点 elementFromPoint 命中
    bar.querySelector<HTMLButtonElement>('[aria-label="颜色"]')!.click();
    await frame();
    const containerRect = h.body.getBoundingClientRect();
    assert(boxInside(bar.getBoundingClientRect(), containerRect, 1.5), "toolbar outside container");
    assert(boxInside(extra.getBoundingClientRect(), containerRect, 1.5), "extra toolbar outside container");
    assert(boxInside(pal.getBoundingClientRect(), containerRect, 1.5), "color palette outside container");
    assert(centerHit(bar), "toolbar center not hit");
    assert(centerHit(pal), "palette center not hit");

    // 改色 + 撤重
    pal.querySelector<HTMLButtonElement>('[data-color="#43a047"]')!.click();
    await wait(20);
    let anns = await store.loadAnnotations("g802.html");
    assert(anns.find((a: any) => a.id === "ann-normal").color === "#43a047", "color updated");
    h.ann.undoPenChange();
    anns = await store.loadAnnotations("g802.html");
    assert(anns.find((a: any) => a.id === "ann-normal").color === "#1e88e5", "color undo restored");

    // 富剪贴板：复制两者 -> 不手动聚焦 overlay -> 直接在 document.activeElement 派发 Ctrl+V -> 保留样式 + 有偏移 + 1 次 Undo
    bar.querySelector<HTMLButtonElement>('[aria-label="复制"]')!.click();
    const activeAfterCopy = (document.activeElement as HTMLElement) || document.body;
    activeAfterCopy.dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true }));
    await wait(20);
    anns = await store.loadAnnotations("g802.html");
    assert(anns.length === 4, "rich paste should create 2 styled annotations, got " + anns.length);
    const pastedHl = anns.find((a: any) => a.id !== "ann-hl" && a.inkBrush === "highlight");
    const pastedNorm = anns.find((a: any) => a.id !== "ann-normal" && a.inkBrush === "pen");
    assert(pastedHl && pastedHl.color === "#ffd54f" && pastedHl.inkWidth === 18 && Math.abs(pastedHl.inkOpacity - 0.42) < 1e-6, "pasted highlight lost style");
    assert(pastedNorm && pastedNorm.color === "#1e88e5" && pastedNorm.inkWidth === 5 && Math.abs(pastedNorm.inkOpacity - 0.9) < 1e-6, "pasted pen lost style");
    const offsetDist = Math.hypot(pastedNorm.strokes[0][0].x - penNormal.strokes[0][0].x, pastedNorm.strokes[0][0].y - penNormal.strokes[0][0].y);
    assert(offsetDist > 0.005, "pasted ink should have measurable offset");
    h.ann.undoPenChange();
    anns = await store.loadAnnotations("g802.html");
    assert(anns.length === 2, "1x undo should revert entire rich paste batch");

    // AI 转文本事件
    let recognizedImg = "";
    const onRec = (ev: Event) => {
      recognizedImg = (ev as CustomEvent).detail?.image ?? "";
      recognizeInk(plugin as any, recognizedImg);
    };
    h.body.addEventListener("ms-recognize-ink", onRec);
    drag(ov, h.body, [[0.65, 0.01], [0.99, 0.01], [0.99, 0.14], [0.65, 0.14], [0.65, 0.01]]);
    bar.querySelector<HTMLButtonElement>('[aria-label="AI 转文本"]')!.click();
    await frame();
    h.body.removeEventListener("ms-recognize-ink", onRec);
    assert(recognizedImg.startsWith("data:image/png;base64,") && recognizedImg.length > 100, "AI recognize image invalid");
    const aiModal = document.querySelector(".ms-modal");
    assert(!!aiModal, "AI recognize modal did not open");
    aiModal?.querySelector<HTMLButtonElement>("button:last-of-type")?.click();

    // 剪切 + 不手动聚焦直接 Ctrl+V 复原 + 剪切可 Undo
    drag(ov, h.body, [[0.65, 0.01], [0.99, 0.01], [0.99, 0.14], [0.65, 0.14], [0.65, 0.01]]);
    bar.querySelector<HTMLButtonElement>('[aria-label="剪切"]')!.click();
    await wait(20);
    anns = await store.loadAnnotations("g802.html");
    assert(anns.every((a: any) => a.strokes.length === 0), "cut cleared strokes");
    // 保留原 ann.id 与 card.anchorAnnId
    assert(anns.some((a: any) => a.id === "ann-normal") && store.getCard("c-normal")?.anchorAnnId === "ann-normal", "cut/delete retains ann.id and card.anchorAnnId");
    // 故意把焦点移到 body 验证 document 级捕获 Ctrl+V 依然生效
    (document.body as HTMLElement).focus();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true }));
    await wait(20);
    anns = await store.loadAnnotations("g802.html");
    assert(anns.filter((a: any) => a.strokes.length > 0).length === 2, "paste after cut restored both strokes");
    h.ann.undoPenChange(); // undo paste
    h.ann.undoPenChange(); // undo cut
    anns = await store.loadAnnotations("g802.html");
    assert(anns.find((a: any) => a.id === "ann-normal").strokes.length === 1, "undo cut restored original strokes");
  } finally {
    await h.close();
  }

  // 2. ExtendNotes 留白区套索改色真实落盘 note.ink[].color 并重绘
  const pdfView = await openPdfReader(plugin, env.sources.get("g802.pdf")!.file, 640, 720);
  try {
    const ext = (pdfView as any).extendNotes;
    const noteId = await ext.create(1, { x: 0.3, y: 0.3 });
    await ext.finish();
    await wait(30);
    await ext.update(noteId, { ink: [{ id: "ext-ink-1", color: "#000000", brush: "pen", strokes: [[{ x: 0.15, y: 0.4 }, { x: 0.55, y: 0.4 }]] }] });
    await frame();
    pdfView.setHandwritingMode("lasso");
    await frame();
    const inkHost = pdfView.containerEl.querySelector<HTMLElement>(".ms-extend-ink")!;
    assert(inkHost, "extend ink host missing");
    const extOv = inkHost.querySelector<SVGSVGElement>(".ms-pen-overlay")!;
    drag(extOv, inkHost, [[0.1, 0.2], [0.6, 0.2], [0.6, 0.6], [0.1, 0.6], [0.1, 0.2]]);
    await frame();
    const extBar = inkHost.querySelector<HTMLElement>(".ms-pen-selection-toolbar")!;
    assert(extBar && !extBar.hidden, "extend lasso toolbar visible");
    extBar.querySelector<HTMLButtonElement>('[aria-label="颜色"]')!.click();
    inkHost.querySelector<HTMLButtonElement>('.ms-pen-color-palette [data-color="#e53935"]')!.click();
    await wait(40);
    const updatedColor = ext.notes().find((n: any) => n.id === noteId)?.ink?.[0]?.color;
    assert(updatedColor === "#e53935", "ExtendNotes ink color did not update: " + updatedColor);
    return { passed: true, d22Order: "颜色/剪切/复制/AI 转文本/删除", richPastePreserved: true, extendColorUpdated: updatedColor };
  } finally {
    await pdfView.onClose();
    pdfView.containerEl.remove();
  }
};

// ===== G8-03: 套索转摘录、PDF/HTML 区域摘录 (<20px, 0交集, blur, 撤重)、底栏互斥 =====
(window as any).runG803 = async () => {
  fixturesHost.replaceChildren();
  const env = makePluginEnv({
    "g803.html": "<html><body><p>Region excerpt sample text for GAP-08.</p></body></html>",
    "g803.pdf": { name: "g803", pages: 1 },
  });
  const store = await env.makeStore();
  const plugin = createPlugin(env.app, store);

  // 1. HTML: 转摘录 + 区域摘录 (<20px, blur, 正常框选+撤重)
  const h = createHtmlController(plugin, "g803.html", "<p>Region excerpt sample text for GAP-08.</p>");
  await h.load();
  try {
    await store.saveAnnotationsNow("g803.html", [{
      id: "pen-ex", docPath: "g803.html", docKind: "html", page: 0, type: "pen", rects: [], text: "",
      color: "#1e88e5", strokes: [[{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.2 }]], createdAt: stamp,
    }]);
    await h.ann.loadForDoc("g803.html");
    h.ann.setHandwritingMode("lasso");
    await frame();
    const ov = h.body.querySelector<SVGSVGElement>(".ms-pen-overlay")!;
    drag(ov, h.body, [[0.05, 0.1], [0.45, 0.1], [0.45, 0.3], [0.05, 0.3], [0.05, 0.1]]);
    const bar = h.body.querySelector<HTMLElement>(".ms-pen-selection-toolbar")!;
    assert(bar.querySelectorAll(":scope > button").length === 5, "toolbar top-level still strictly 5 buttons");
    const extra = h.body.querySelector<HTMLElement>(".ms-pen-selection-extra")!;
    extra.querySelector<HTMLButtonElement>('[aria-label="转摘录"]')!.click();
    await wait(30);
    let anns = await store.loadAnnotations("g803.html");
    const regFromLasso = anns.find((a: any) => a.type === "region");
    assert(regFromLasso && regFromLasso.image?.startsWith("data:image/png;base64,"), "lasso excerpt created region with valid image");
    assert(!!regFromLasso.cardId && !!store.getCard(regFromLasso.cardId), "lasso excerpt created card");
    await h.ann.undoLastEdit();
    anns = await store.loadAnnotations("g803.html");
    assert(!anns.some((a: any) => a.id === regFromLasso.id), "undo lasso excerpt removed region");
    await h.ann.redoLastEdit();
    anns = await store.loadAnnotations("g803.html");
    assert(anns.some((a: any) => a.id === regFromLasso.id), "redo lasso excerpt restored region");

    // 区域摘录 Toast 不含「套索模式」
    const noticeBefore = (Notice as any).messages?.length ?? 0;
    h.ann.setRegionMode(true);
    const recentNotices = ((Notice as any).messages ?? []).slice(noticeBefore);
    assert(recentNotices.every((m: string) => !m.includes("套索模式")), "region toast must not say 套索模式: " + JSON.stringify(recentNotices));

    // <20px 拖拽增量 === 0
    const countBeforeSmall = (await store.loadAnnotations("g803.html")).length;
    drag(h.body, h.body, [[0.1, 0.1], [0.11, 0.11]]);
    await wait(20);
    assert((await store.loadAnnotations("g803.html")).length === countBeforeSmall, "<20px drag created annotation");

    // window.blur 清理 .ms-lasso 且重拖成功
    pointer(h.body, h.body, "pointerdown", 0.1, 0.1);
    pointer(h.body, h.body, "pointermove", 0.3, 0.3);
    assert(!!h.body.querySelector(".ms-lasso"), "ms-lasso shown during drag");
    window.dispatchEvent(new Event("blur"));
    assert(!h.body.querySelector(".ms-lasso"), "window.blur cleared .ms-lasso");
    assert(!(h.ann as any).lassoActive, "window.blur reset lassoActive");

    // 正常框选 -> 生成 region + card -> 加入/撤出脑图 -> 删除 -> 撤重
    drag(h.body, h.body, [[0.05, 0.05], [0.6, 0.4]]);
    await wait(30);
    anns = await store.loadAnnotations("g803.html");
    const reg2 = anns.filter((a: any) => a.type === "region").at(-1);
    assert(reg2 && reg2.cardId, "HTML region drag created region + card");
    (h.ann as any).addRegionToMindmap(reg2);
    const mappedNode = store.nodes.find((n: any) => n.cardId === reg2.cardId);
    assert(!!mappedNode, "region added to mindmap");
    assert(store.removeExcerptFromMindmap(mappedNode.id), "region removed from mindmap");

    // 删除区域摘录 + Undo + Redo
    (h.ann as any).deleteAnn(reg2);
    await wait(20);
    assert(!(await store.loadAnnotations("g803.html")).some((a: any) => a.id === reg2.id), "delete region removed it");
    await h.ann.undoLastEdit();
    assert((await store.loadAnnotations("g803.html")).some((a: any) => a.id === reg2.id), "undo delete region restored it");
    await h.ann.redoLastEdit();
    assert(!(await store.loadAnnotations("g803.html")).some((a: any) => a.id === reg2.id), "redo delete region removed it again");
  } finally {
    await h.close();
  }

  // 2. PDF 0 交集保护 + 工作区底栏套索/矩形互斥
  const leaf: any = { app: env.app, setViewState: async () => {}, updateHeader() {}, getRoot: () => env.app.workspace.rootSplit };
  env.app.workspace.activeLeaf = leaf; env.app.workspace.centerLeaf = leaf;
  const ws = new StudyWorkspaceView(leaf, plugin as any);
  leaf.view = ws; plugin.studyWorkspace = ws;
  ws.containerEl.style.cssText = "width:1100px;height:760px;";
  fixturesHost.append(ws.containerEl);
  ws.load();
  await ws.onOpen();
  await ws.openFile(env.sources.get("g803.pdf")!.file);
  await wait(80);
  await frame();
  try {
    const reader = ws.getReader() as any;
    const annot = reader.annController;
    // 底栏切换互斥
    (ws as any).setReaderHandwritingMode("lasso", false);
    assert(reader.getHandwritingMode() === "lasso" && !annot.isLassoMode(), "lasso mode active, region mode off");
    (ws as any).useReaderTool("region");
    assert(reader.getHandwritingMode() === "off" && annot.isLassoMode(), "region mode active, lasso mode off");
    (ws as any).setReaderHandwritingMode("lasso", false);
    assert(reader.getHandwritingMode() === "lasso" && !annot.isLassoMode(), "switched back to lasso, region off");

    // PDF 0 交集（在 pageEl 内但完全在 canvas 外侧拖拽，canvas 交集严格为 0）
    (ws as any).useReaderTool("region");
    const pageEl = ws.containerEl.querySelector<HTMLElement>(".ms-page")!;
    const canvasEl = pageEl.querySelector<HTMLCanvasElement>(".ms-page-canvas")!;
    pageEl.style.paddingBottom = "120px";
    const cRect = canvasEl.getBoundingClientRect();
    const beforePdfCount = (await store.loadAnnotations("g803.pdf")).length;
    pageEl.dispatchEvent(new PointerEvent("pointerdown", { clientX: cRect.left + 20, clientY: cRect.bottom + 10, pointerId: 1, button: 0, isPrimary: true, bubbles: true, cancelable: true }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: cRect.left + 120, clientY: cRect.bottom + 90, pointerId: 1, button: 0, isPrimary: true, bubbles: true, cancelable: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: cRect.left + 120, clientY: cRect.bottom + 90, pointerId: 1, button: 0, isPrimary: true, bubbles: true, cancelable: true }));
    await wait(30);
    assert((await store.loadAnnotations("g803.pdf")).length === beforePdfCount, "0-overlap drag outside PDF canvas must not create annotation");
    return { passed: true, lassoExcerptUndoRedo: true, regionBlurAndUndoRedo: true, zeroOverlapBlocked: true, bottomBarMutex: true };
  } finally {
    await ws.onClose();
    ws.containerEl.remove();
  }
};

// ===== G8-04(UI) + G8-06(UI): 扩展条解绑禁用/启用、onAnnClick 解绑、冷重载与像素 diff===0 =====
(window as any).runG804AndG806UI = async () => {
  fixturesHost.replaceChildren();
  const env = makePluginEnv({ "g806.pdf": { name: "g806", pages: 1 } });
  const store = await env.makeStore();
  const plugin = createPlugin(env.app, store);
  const view = await openPdfReader(plugin, env.sources.get("g806.pdf")!.file, 640, 720);
  const ctrl = (view as any).annController;
  try {
    const hostAnn = {
      id: "host-ui", docPath: "g806.pdf", docKind: "pdf", page: 1, type: "note",
      rects: [{ x: 60, y: 500, w: 200, h: 120 }], pdfCoordinateSpace: "pdf",
      text: "Host", color: "#3478f6", overlay: { kind: "text" }, createdAt: stamp,
    };
    const unboundPen = {
      id: "pen-unbound", docPath: "g806.pdf", docKind: "pdf", page: 1, type: "pen", rects: [], text: "",
      color: "#000000", strokes: [[{ x: 0.65, y: 0.7 }, { x: 0.85, y: 0.7 }]], createdAt: stamp,
    };
    const boundPen = {
      id: "pen-bound", docPath: "g806.pdf", docKind: "pdf", page: 1, type: "pen", rects: [], text: "",
      color: "#1e88e5", hostAnnotationId: "host-ui", strokes: [[{ x: 0.15, y: 0.25 }, { x: 0.35, y: 0.25 }]], createdAt: stamp,
    };
    await store.saveAnnotationsNow("g806.pdf", [hostAnn, unboundPen, boundPen]);
    await ctrl.loadForDoc("g806.pdf");
    view.redrawPage(1);
    await frame();

    const p1 = view.getPageRecord(1)!;
    const pixelHash = () => {
      const c = p1.wrapper.querySelector<HTMLCanvasElement>(".ms-ink-raster");
      if (!c) return "empty";
      const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let h = 2166136261;
      for (let i = 0; i < data.length; i += 4) h = Math.imul(h ^ (data[i] + data[i + 1] * 3 + data[i + 2] * 5 + data[i + 3] * 7), 16777619);
      return String(h >>> 0);
    };

    const initialHash = pixelHash();
    assert(initialHash !== "empty", "initial ink raster missing");
    ctrl.setHandwritingMode("lasso");
    await frame();
    const ov = p1.wrapper.querySelector<SVGSVGElement>(".ms-pen-overlay")!;
    const unbindBtn = p1.wrapper.querySelector<HTMLButtonElement>('.ms-pen-selection-extra [aria-label="解除绑定"]')!;
    assert(unbindBtn, "unbind button missing in extra toolbar");

    // 选未绑定笔迹 -> 解绑按钮 disabled
    drag(ov, p1.wrapper, [[0.6, 0.65], [0.9, 0.65], [0.9, 0.75], [0.6, 0.75], [0.6, 0.65]]);
    assert(unbindBtn.disabled === true, "unbind button should be disabled for unbound pen");

    // 选绑定笔迹 -> 解绑按钮 enabled -> 点击解绑
    drag(ov, p1.wrapper, [[0.1, 0.2], [0.4, 0.2], [0.4, 0.3], [0.1, 0.3], [0.1, 0.2]]);
    assert(unbindBtn.disabled === false, "unbind button should be enabled for bound pen");
    unbindBtn.click();
    await wait(20);
    assert(!(await store.loadAnnotations("g806.pdf")).find((a: any) => a.id === "pen-bound").hostAnnotationId, "extra toolbar unbind cleared hostAnnotationId");

    // Undo 恢复绑定，然后测试 onAnnClick 弹窗解绑
    ctrl.undoPenChange();
    await wait(20);
    assert((await store.loadAnnotations("g806.pdf")).find((a: any) => a.id === "pen-bound").hostAnnotationId === "host-ui", "undo restored hostAnnotationId");
    ctrl.setHandwritingMode("off");
    const boundObj = ctrl.getCache().find((a: any) => a.id === "pen-bound");
    ctrl.onAnnClick(boundObj, new MouseEvent("click", { clientX: 100, clientY: 100 }));
    const popUnbind = document.querySelector<HTMLButtonElement>('.ms-ann-pop button');
    const popButtons = [...document.querySelectorAll<HTMLButtonElement>('.ms-ann-pop button')];
    const unbindPopBtn = popButtons.find(b => b.textContent === "解除绑定");
    assert(!!popUnbind && !!unbindPopBtn, "onAnnClick popup missing 解除绑定 button");
    unbindPopBtn!.click();
    await wait(20);
    assert(!(await store.loadAnnotations("g806.pdf")).find((a: any) => a.id === "pen-bound").hostAnnotationId, "onAnnClick unbind cleared hostAnnotationId");

    // 改色 -> 记录终态像素 -> 逐步 Undo 回初始态验证像素 diff === 0 -> Redo 回终态验证像素 diff === 0
    ctrl.setHandwritingMode("lasso");
    await frame();
    const ov2 = p1.wrapper.querySelector<SVGSVGElement>(".ms-pen-overlay")!;
    drag(ov2, p1.wrapper, [[0.1, 0.2], [0.4, 0.2], [0.4, 0.3], [0.1, 0.3], [0.1, 0.2]]);
    p1.wrapper.querySelector<HTMLButtonElement>('.ms-pen-selection-toolbar [aria-label="颜色"]')!.click();
    p1.wrapper.querySelector<HTMLButtonElement>('.ms-pen-color-palette [data-color="#e53935"]')!.click();
    await wait(20);
    const finalHash = pixelHash();
    assert(finalHash !== initialHash, "color change should change canvas pixels");

    ctrl.undoPenChange(); // undo color
    ctrl.undoPenChange(); // undo unbind
    await frame();
    assert(pixelHash() === initialHash, "canvas pixels after full undo must equal initialHash");
    ctrl.redoPenChange(); // redo unbind
    ctrl.redoPenChange(); // redo color
    await frame();
    assert(pixelHash() === finalHash, "canvas pixels after full redo must equal finalHash");

    // 冷重载 onClose -> reloadStore -> reopen
    const beforeReload = structuredClone(await store.loadAnnotations("g806.pdf"));
    await store.flush();
    await view.onClose();
    view.containerEl.remove();

    const store2 = await env.makeStore();
    const plugin2 = createPlugin(env.app, store2);
    const view2 = await openPdfReader(plugin2, env.sources.get("g806.pdf")!.file, 640, 720);
    const afterReload = structuredClone(await store2.loadAnnotations("g806.pdf"));
    assert(JSON.stringify(afterReload) === JSON.stringify(beforeReload), "cold reload annotations mismatch");
    await view2.onClose();
    view2.containerEl.remove();

    return { passed: true, extraUnbindDisabledForUnbound: true, extraUnbindWorks: true, onAnnClickUnbindWorks: true, pixelUndoRedoZeroDiff: true, coldReloadExactMatch: true };
  } finally {
    if (view.containerEl.isConnected) { await view.onClose(); view.containerEl.remove(); }
  }
};

(window as any).ready = true;
(window as any).getErrors = () => errors;
`;

try {
  for (const name of ["obsidian", "fakePdf", "fakeMammoth"]) {
    let src = (await readFile(join(docFixtures, name + ".txt"), "utf8")).replaceAll("__PROJECT__", () => project);
    if (name === "obsidian") {
      if (!src.includes("requestUrl")) src += "\nexport async function requestUrl(){throw new Error('offline');}\n";
      src += "\nif (!(ItemView.prototype as any).registerEvent) (ItemView.prototype as any).registerEvent = function(){};\n";
      src += "if (!(ItemView.prototype as any).registerDomEvent) (ItemView.prototype as any).registerDomEvent = function(el:any,ev:any,cb:any){el?.addEventListener?.(ev,cb);};\n";
      src += "if (!(ItemView.prototype as any).load) (ItemView.prototype as any).load = function(){};\n";
      src += "if (!(ItemView.prototype as any).register) (ItemView.prototype as any).register = function(){};\n";
    }
    if (name === "fakePdf") {
      src = `class FakeViewport {
        viewBox: number[]; width: number; height: number; scale: number; rotation: number;
        private coeffs: number[];
        constructor({ viewBox, scale, rotation = 0 }: { viewBox: number[]; scale: number; rotation?: number }) {
          this.viewBox = viewBox; this.scale = scale; this.rotation = rotation;
          const [x0, y0, x1, y1] = viewBox;
          const map: Record<number, number[]> = { 0: [1, 0, 0, -1, -x0, y1], 90: [0, 1, 1, 0, -y0, -x0], 180: [-1, 0, 0, 1, x1, -y0], 270: [0, -1, -1, 0, y1, x1] };
          this.coeffs = map[rotation].map(v => v * scale);
          this.width = (rotation % 180 ? y1 - y0 : x1 - x0) * scale;
          this.height = (rotation % 180 ? x1 - x0 : y1 - y0) * scale;
        }
        convertToPdfPoint(x: number, y: number) {
          const [a, b, c, d, e, f] = this.coeffs, det = a * d - b * c;
          return [(d * (x - e) - c * (y - f)) / det, (-b * (x - e) + a * (y - f)) / det];
        }
        convertToViewportRectangle(rect: number[]) {
          const [a, b, c, d, e, f] = this.coeffs;
          const t = (x: number, y: number) => [a * x + c * y + e, b * x + d * y + f];
          return [...t(rect[0], rect[1]), ...t(rect[2], rect[3])];
        }
      }\n` + src.replace(/getViewport\(\{scale\}:\{scale:number\}\)\{[\s\S]*?return \{[\s\S]*?\};\s*\}/, `getViewport({scale}:{scale:number}){ const viewBox=config.crop||[0,0,600,800]; const rotation=config.rotations?.[num-1]??config.rotation??0; return new FakeViewport({viewBox,scale,rotation}); }`);
    }
    await writeFile(join(temporary, name + ".ts"), src);
  }
  await writeFile(join(temporary, "unused-network.ts"), "export function request(){throw new Error('offline');}");
  await writeFile(join(temporary, "crypto.ts"), "export function createHash(){return{update(){return this;},digest(){return '0000000000000000';}};}");
  await writeFile(join(temporary, "lasso-ui-fixture.ts"), fixtureSource);

  const styles = await Promise.all([
    "src/styles/styles-base.css",
    "src/styles/styles-reader.css",
    "src/styles/styles-mindmap.css",
    "src/styles/styles-organize.css",
    "src/styles/styles-workspace.css",
  ].map(name => readFile(join(project, name), "utf8")));
  await writeFile(join(temporary, "styles.css"), styles.join("\n"));
  await writeFile(
    join(temporary, "index.html"),
    '<!doctype html><meta charset="utf-8"><title>MarginStudy GAP-08 lasso-ui acceptance</title><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0;height:100%}#fixtures{position:relative;width:100vw;height:100vh;overflow:auto}</style><main id="fixtures"></main><script type="module" src="/fixture.js"></script>',
  );

  await build({
    entryPoints: [join(temporary, "lasso-ui-fixture.ts")],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "chrome120",
    outfile: join(temporary, "fixture.js"),
    plugins: [{
      name: "lasso-ui-adapters",
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: join(temporary, "obsidian.ts") }));
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
  const session = `marginstudy-lasso-ui-${process.pid}`;
  const browser = (...args) => runBrowser(session, ...args);

  const evidenceDir = process.env.MARGINSTUDY_EVIDENCE_DIR ? resolve(process.env.MARGINSTUDY_EVIDENCE_DIR, "gap-08") : null;
  if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
  const writeEvidence = async (filename, payload, mergeKey = null) => {
    if (!evidenceDir) return;
    const target = join(evidenceDir, filename);
    if (mergeKey) {
      let existing = {};
      try { existing = JSON.parse(await readFile(target, "utf8")); } catch { /* new */ }
      existing[mergeKey] = payload;
      await writeFile(target, JSON.stringify(existing, null, 2) + "\n");
    } else {
      await writeFile(target, JSON.stringify(payload, null, 2) + "\n");
    }
  };

  try {
    await browser("open", "about:blank");
    await browser("set", "viewport", "1280", "960");
    await browser("open", `http://127.0.0.1:${server.address().port}`);
    await browser("wait", "--fn", "window.ready === true");

    const evalJson = async expr => JSON.parse((await browser("eval", expr)).stdout);

    const g801 = await evalJson("window.runG801()");
    await writeEvidence("g8-01-select-move-multipage.json", g801);
    const g802 = await evalJson("window.runG802()");
    await writeEvidence("g8-02-toolbar-clipboard-extend.json", g802);
    const g803 = await evalJson("window.runG803()");
    await writeEvidence("g8-03-excerpt-and-region-undo.json", g803);
    const g8046 = await evalJson("window.runG804AndG806UI()");
    await writeEvidence("g8-04-unbind-preservation.json", g8046, "ui");
    await writeEvidence("g8-06-compound-undo-reload-export.json", g8046, "ui");

    const errs = await evalJson("window.getErrors()");
    if (errs.length) throw new Error("Unhandled browser errors: " + JSON.stringify(errs));
    console.log("PASS lasso-ui-workflow: G8-01, G8-02, G8-03, G8-04(UI), G8-06(UI) all passed");
  } finally {
    await browser("close").catch(() => {});
    await new Promise(done => server.close(done));
  }
} finally {
  await rm(temporary, { recursive: true, force: true }).catch(() => {});
}
