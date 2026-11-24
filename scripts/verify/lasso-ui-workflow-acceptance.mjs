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
import * as pdfLib from "pdf-lib";
import { runBrowser } from "./ego-harness.mjs";
import { readPagePaint } from "./annotation-refs/export-roundtrip/pdf-content.mjs";

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
import { buildEditedPdf } from "${project}/src/pdf/editedPdfExport";

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

function makePluginEnv(filesMap: Record<string, string | object | Uint8Array>) {
  const sources = new Map<string, { file: TFile; content: string | Uint8Array }>();
  for (const [path, val] of Object.entries(filesMap)) {
    const content = val instanceof Uint8Array ? val : typeof val === "string" ? val : JSON.stringify(val);
    const size = val instanceof Uint8Array ? val.byteLength : content.length;
    sources.set(path, { file: new TFile(path, size), content });
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
      async read(file: TFile) { const c = sources.get(file.path)!.content; return c instanceof Uint8Array ? new TextDecoder().decode(c) : c; },
      async readBinary(file: TFile) { const c = sources.get(file.path)!.content; return c instanceof Uint8Array ? c.slice().buffer : new TextEncoder().encode(c).buffer; },
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

// ===== G8-04(UI): 扩展条解绑禁用/启用、点击解绑、onAnnClick 弹窗解绑 =====
(window as any).runG804UI = async () => {
  fixturesHost.replaceChildren();
  const env = makePluginEnv({ "g804.pdf": { name: "g804", pages: 1 } });
  const store = await env.makeStore();
  const plugin = createPlugin(env.app, store);
  const view = await openPdfReader(plugin, env.sources.get("g804.pdf")!.file, 640, 720);
  const ctrl = (view as any).annController;
  try {
    const hostAnn = {
      id: "host-ui", docPath: "g804.pdf", docKind: "pdf", page: 1, type: "note",
      rects: [{ x: 60, y: 500, w: 200, h: 120 }], pdfCoordinateSpace: "pdf",
      text: "Host", color: "#3478f6", overlay: { kind: "text" }, createdAt: stamp,
    };
    const unboundPen = {
      id: "pen-unbound", docPath: "g804.pdf", docKind: "pdf", page: 1, type: "pen", rects: [], text: "",
      color: "#000000", strokes: [[{ x: 0.65, y: 0.7 }, { x: 0.85, y: 0.7 }]], createdAt: stamp,
    };
    const boundPen = {
      id: "pen-bound", docPath: "g804.pdf", docKind: "pdf", page: 1, type: "pen", rects: [], text: "",
      color: "#1e88e5", hostAnnotationId: "host-ui", strokes: [[{ x: 0.15, y: 0.25 }, { x: 0.35, y: 0.25 }]], createdAt: stamp,
    };
    await store.saveAnnotationsNow("g804.pdf", [hostAnn, unboundPen, boundPen]);
    await ctrl.loadForDoc("g804.pdf");
    view.redrawPage(1);
    await frame();

    const p1 = view.getPageRecord(1)!;
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
    assert(!(await store.loadAnnotations("g804.pdf")).find((a: any) => a.id === "pen-bound").hostAnnotationId, "extra toolbar unbind cleared hostAnnotationId");

    // Undo 恢复绑定，然后测试 onAnnClick 弹窗解绑
    ctrl.undoPenChange();
    await wait(20);
    assert((await store.loadAnnotations("g804.pdf")).find((a: any) => a.id === "pen-bound").hostAnnotationId === "host-ui", "undo restored hostAnnotationId");
    ctrl.setHandwritingMode("off");
    const boundObj = ctrl.getCache().find((a: any) => a.id === "pen-bound");
    ctrl.onAnnClick(boundObj, new MouseEvent("click", { clientX: 100, clientY: 100 }));
    const popButtons = [...document.querySelectorAll<HTMLButtonElement>(".ms-ann-pop button")];
    const unbindPopBtn = popButtons.find(b => b.textContent === "解除绑定");
    assert(!!unbindPopBtn, "onAnnClick popup missing 解除绑定 button");
    unbindPopBtn!.click();
    await wait(20);
    assert(!(await store.loadAnnotations("g804.pdf")).find((a: any) => a.id === "pen-bound").hostAnnotationId, "onAnnClick unbind cleared hostAnnotationId");
    return { passed: true, extraUnbindDisabledForUnbound: true, extraUnbindWorks: true, onAnnClickUnbindWorks: true };
  } finally {
    if (view.containerEl.isConnected) { await view.onClose(); view.containerEl.remove(); }
  }
};

// ===== G8-05(UI): HTML 双控制器同文档，旧选区拒绝即清选区且连续两次不重圈均拒，重圈后可写 =====
(window as any).runG805UI = async () => {
  fixturesHost.replaceChildren();
  const env = makePluginEnv({ "g805.html": "<p>Dual view concurrency check</p>" });
  const store = await env.makeStore();
  const plugin = createPlugin(env.app, store);
  await store.saveAnnotationsNow("g805.html", [{
    id: "pen-shared", docPath: "g805.html", docKind: "html", page: 0, type: "pen", rects: [], text: "",
    color: "#000000", strokes: [[{ x: 0.15, y: 0.25 }, { x: 0.55, y: 0.25 }]], createdAt: stamp,
  }]);
  const a = createHtmlController(plugin, "g805.html");
  const b = createHtmlController(plugin, "g805.html");
  await a.load();
  await b.load();
  try {
    a.ann.setHandwritingMode("lasso");
    b.ann.setHandwritingMode("lasso");
    await frame();
    const ovA = a.body.querySelector<SVGSVGElement>(".ms-pen-overlay")!;
    const ovB = b.body.querySelector<SVGSVGElement>(".ms-pen-overlay")!;
    const poly = [[0.1, 0.15], [0.6, 0.15], [0.6, 0.35], [0.1, 0.35], [0.1, 0.15]];

    // A 圈选改红 #e53935
    drag(ovA, a.body, poly);
    a.body.querySelector<HTMLButtonElement>('.ms-pen-selection-toolbar [aria-label="颜色"]')!.click();
    a.body.querySelector<HTMLButtonElement>('.ms-pen-color-palette [data-color="#e53935"]')!.click();
    await wait(20);
    assert((await store.loadAnnotations("g805.html")).find((x: any) => x.id === "pen-shared").color === "#e53935", "A red failed");

    // B 同步并圈选改绿 #43a047 + 另写唯一笔迹 only-B
    await b.load();
    b.ann.setHandwritingMode("off"); b.ann.setHandwritingMode("lasso");
    await frame();
    const ovB2 = b.body.querySelector<SVGSVGElement>(".ms-pen-overlay")!;
    drag(ovB2, b.body, poly);
    b.body.querySelector<HTMLButtonElement>('.ms-pen-selection-toolbar [aria-label="颜色"]')!.click();
    b.body.querySelector<HTMLButtonElement>('.ms-pen-color-palette [data-color="#43a047"]')!.click();
    (b.ann as any).beginPenGesture();
    (b.ann as any).pushAnnotation({
      id: "only-B", docPath: "g805.html", docKind: "html", page: 0, type: "pen", rects: [], text: "",
      color: "#43a047", strokes: [[{ x: 0.15, y: 0.7 }, { x: 0.45, y: 0.7 }]], createdAt: stamp,
    });
    await store.flush();

    let saveCalls = 0;
    const origSave = store.saveAnnotationsDebounced.bind(store);
    (store as any).saveAnnotationsDebounced = (...args: any[]) => { saveCalls++; return origSave(...args); };

    // A 不重新圈选，第一次从旧选区调色盘改蓝 #1e88e5 -> 被拒、writes===0、canUndo===false、选区和工具条已清空
    const w0 = saveCalls;
    a.body.querySelector<HTMLButtonElement>('.ms-pen-selection-toolbar [aria-label="颜色"]')!.click();
    a.body.querySelector<HTMLButtonElement>('.ms-pen-color-palette [data-color="#1e88e5"]')!.click();
    await store.flush();
    const firstWrites = saveCalls - w0;
    const tbA = a.body.querySelector<HTMLElement>(".ms-pen-selection-toolbar")!;
    const palA = a.body.querySelector<HTMLElement>(".ms-pen-color-palette")!;
    const selRectAfterFirst = a.body.querySelector(".ms-pen-selection");
    assert(firstWrites === 0, "1st stale color must have 0 writes");
    assert(a.ann.getEditHistoryState().canUndo === false, "1st stale color must set canUndo=false");
    assert(!selRectAfterFirst && tbA.hidden && palA.hidden, "1st stale color must clear old selection and hide toolbar/palette");

    // 第二次（未重圈，直接点隐藏的黄色 swatch 或触发改色）-> 仍被拒、writes===0、canUndo===false
    const w1 = saveCalls;
    a.body.querySelector<HTMLButtonElement>('.ms-pen-color-palette [data-color="#ffd54f"]')!.click();
    await store.flush();
    const retryWrites = saveCalls - w1;
    const afterRetry = await store.loadAnnotations("g805.html");
    assert(retryWrites === 0, "2nd stale retry must have 0 writes, got " + retryWrites);
    assert(afterRetry.find((x: any) => x.id === "pen-shared").color === "#43a047" && afterRetry.some((x: any) => x.id === "only-B"), "B data lost on retry");
    assert(a.ann.getEditHistoryState().canUndo === false, "2nd stale retry must keep canUndo=false");

    // 重新圈选后改黄 -> 成功且写入 1 次
    await a.load();
    a.ann.setHandwritingMode("off"); a.ann.setHandwritingMode("lasso");
    await frame();
    const ovA2 = a.body.querySelector<SVGSVGElement>(".ms-pen-overlay")!;
    const w2 = saveCalls;
    drag(ovA2, a.body, poly);
    a.body.querySelector<HTMLButtonElement>('.ms-pen-selection-toolbar [aria-label="颜色"]')!.click();
    a.body.querySelector<HTMLButtonElement>('.ms-pen-color-palette [data-color="#ffd54f"]')!.click();
    await store.flush();
    const relassoWrites = saveCalls - w2;
    const afterRelasso = await store.loadAnnotations("g805.html");
    assert(relassoWrites === 1 && afterRelasso.find((x: any) => x.id === "pen-shared").color === "#ffd54f" && afterRelasso.some((x: any) => x.id === "only-B"), "relasso write failed");
    (store as any).saveAnnotationsDebounced = origSave;

    return { passed: true, firstWrites, retryWrites, selectionClearedOnReject: !selRectAfterFirst && tbA.hidden && palA.hidden, relassoWrites };
  } finally {
    await a.close();
    await b.close();
  }
};

// ===== G8-06 同一条 8 步链：逐步模型快照 + 逐步 Canvas 像素哈希 + 卡片冷启全等 + 导出 PDF Bytes =====
(window as any).runG806Unified8Step = async (realPdfBase64: string) => {
  fixturesHost.replaceChildren();
  const rawBin = Uint8Array.from(atob(realPdfBase64), c => c.charCodeAt(0));
  const env = makePluginEnv({ "g806-chain.pdf": rawBin });
  const store = await env.makeStore();
  const plugin = createPlugin(env.app, store);
  const view = await openPdfReader(plugin, env.sources.get("g806-chain.pdf")!.file, 640, 860);
  const ctrl = (view as any).annController;
  try {
    const hostAnn = {
      id: "host-8step", docPath: "g806-chain.pdf", docKind: "pdf", page: 1, type: "note",
      rects: [{ x: 60, y: 500, w: 220, h: 140 }], pdfCoordinateSpace: "pdf",
      text: "Host 8-Step", color: "#3478f6", overlay: { kind: "text" }, createdAt: stamp,
    };
    await store.saveAnnotationsNow("g806-chain.pdf", [hostAnn]);
    await ctrl.loadForDoc("g806-chain.pdf");
    view.redrawPage(1);
    await frame();

    const p1 = view.getPageRecord(1)!;
    const pixelHash = () => {
      const c = p1.wrapper.querySelector<HTMLCanvasElement>(".ms-ink-raster");
      if (!c || c.width === 0 || c.height === 0) return "empty";
      const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let h = 2166136261;
      for (let i = 0; i < data.length; i += 4) h = Math.imul(h ^ (data[i] + data[i + 1] * 3 + data[i + 2] * 5 + data[i + 3] * 7), 16777619);
      return String(h >>> 0);
    };
    const stableJson = (v: any): string => {
      if (Array.isArray(v)) return "[" + v.map(stableJson).join(",") + "]";
      if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ":" + stableJson(v[k])).join(",") + "}";
      return JSON.stringify(v);
    };
    const modelSnap = async () => {
      const anns = structuredClone(await store.loadAnnotations("g806-chain.pdf")).map(({ createdAt, ...r }: any) => r);
      const cards = structuredClone(store.cards).map(({ createdAt, ...r }: any) => r);
      return stableJson({ anns, cards });
    };

    const stepNames = ["0-initial", "1-draw", "2-move", "3-color", "4-copy-paste", "5-unbind", "6-excerpt", "7-cut", "8-delete"];
    const snaps: string[] = [];
    const hashes: string[] = [];
    const recordStep = async () => {
      await frame();
      snaps.push(await modelSnap());
      hashes.push(pixelHash());
    };

    // Step 0: initial
    await recordStep();

    // Step 1: 画笔（落在宿主框 x:[60..280]/600=[0.10..0.467], y:[160..300]/800=[0.20..0.375] 内，自动绑定）
    view.setHandwritingMode("pen");
    await frame();
    let ov = p1.wrapper.querySelector<SVGSVGElement>(".ms-pen-overlay")!;
    drag(ov, p1.wrapper, [[0.14, 0.25], [0.24, 0.25], [0.34, 0.25]]);
    await wait(20);
    const drawnAnn = (await store.loadAnnotations("g806-chain.pdf")).find((a: any) => a.type === "pen");
    assert(drawnAnn && drawnAnn.hostAnnotationId === "host-8step", "step 1 drawn pen should auto-bind host-8step");
    await recordStep();

    // Step 2: 套索框内平移 (+0.03, +0.03)
    view.setHandwritingMode("lasso");
    await frame();
    ov = p1.wrapper.querySelector<SVGSVGElement>(".ms-pen-overlay")!;
    drag(ov, p1.wrapper, [[0.11, 0.21], [0.38, 0.21], [0.38, 0.29], [0.11, 0.29], [0.11, 0.21]]);
    drag(ov, p1.wrapper, [[0.24, 0.25], [0.27, 0.28]]);
    await wait(20);
    await recordStep();

    // Step 3: 改色 #1e88e5
    p1.wrapper.querySelector<HTMLButtonElement>('.ms-pen-selection-toolbar [aria-label="颜色"]')!.click();
    p1.wrapper.querySelector<HTMLButtonElement>('.ms-pen-color-palette [data-color="#1e88e5"]')!.click();
    await wait(20);
    await recordStep();

    // Step 4: 复制粘贴（保留样式 + 偏移，1 次 Undo）
    p1.wrapper.querySelector<HTMLButtonElement>('.ms-pen-selection-toolbar [aria-label="复制"]')!.click();
    ((document.activeElement as HTMLElement) || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true }));
    await wait(20);
    const afterPastePens = (await store.loadAnnotations("g806-chain.pdf")).filter((a: any) => a.type === "pen");
    assert(afterPastePens.length === 2, "step 4 should produce 2 pens");
    await recordStep();

    // Step 5: 显式解绑原笔迹
    drag(ov, p1.wrapper, [[0.14, 0.25], [0.40, 0.25], [0.40, 0.295], [0.14, 0.295], [0.14, 0.25]]);
    p1.wrapper.querySelector<HTMLButtonElement>('.ms-pen-selection-extra [aria-label="解除绑定"]')!.click();
    await wait(20);
    assert(!(await store.loadAnnotations("g806-chain.pdf")).find((a: any) => a.id === drawnAnn.id).hostAnnotationId, "step 5 unbind failed");
    await recordStep();

    // Step 6: 转摘录（生成 region + 摘录卡）
    p1.wrapper.querySelector<HTMLButtonElement>('.ms-pen-selection-extra [aria-label="转摘录"]')!.click();
    await wait(30);
    assert(store.cards.length === 1, "step 6 excerpt should create 1 card");
    await recordStep();

    // Step 7: 剪切粘贴出来的第 2 笔（y≈0.30）
    drag(ov, p1.wrapper, [[0.16, 0.292], [0.44, 0.292], [0.44, 0.33], [0.16, 0.33], [0.16, 0.292]]);
    p1.wrapper.querySelector<HTMLButtonElement>('.ms-pen-selection-toolbar [aria-label="剪切"]')!.click();
    await wait(20);
    await recordStep();

    // Step 8: 删除第 1 笔（y≈0.28）
    drag(ov, p1.wrapper, [[0.14, 0.25], [0.40, 0.25], [0.40, 0.295], [0.14, 0.295], [0.14, 0.25]]);
    p1.wrapper.querySelector<HTMLButtonElement>('.ms-pen-selection-toolbar [aria-label="删除"]')!.click();
    await wait(20);
    await recordStep();

    // ① + ② 逐次全 Undo (8 -> 0) 验证模型快照 + Canvas 像素哈希
    const undoAudit: any[] = [];
    for (let i = 7; i >= 0; i--) {
      await ctrl.undoLastEdit();
      await frame();
      const m = await modelSnap();
      const h = pixelHash();
      assert(m === snaps[i], \`undo step \${i} (\${stepNames[i]}) model mismatch\`);
      assert(h === hashes[i], \`undo step \${i} (\${stepNames[i]}) pixelHash mismatch: \${h} vs \${hashes[i]}\`);
      undoAudit.push({ step: stepNames[i], modelExact: true, pixelHash: h });
    }
    assert(ctrl.getEditHistoryState().canUndo === false, "canUndo should be false at step 0");
    assert(!p1.wrapper.querySelector(".ms-pen-selection") && p1.wrapper.querySelectorAll(".ms-pen-selection-toolbar:not([hidden])").length === 0, "no stale selection after full undo");

    // ① + ② 逐次全 Redo (0 -> 8) 验证模型快照 + Canvas 像素哈希
    const redoAudit: any[] = [];
    for (let i = 1; i <= 8; i++) {
      await ctrl.redoLastEdit();
      await frame();
      const m = await modelSnap();
      const h = pixelHash();
      assert(m === snaps[i], \`redo step \${i} (\${stepNames[i]}) model mismatch\`);
      assert(h === hashes[i], \`redo step \${i} (\${stepNames[i]}) pixelHash mismatch: \${h} vs \${hashes[i]}\`);
      redoAudit.push({ step: stepNames[i], modelExact: true, pixelHash: h });
    }
    assert(ctrl.getEditHistoryState().canRedo === false, "canRedo should be false at step 8");

    // 退回 Step 6（同时含：解绑改色平移后的第 1 笔 + 粘贴第 2 笔 + 转摘录 region + 卡片），执行 ③ 冷重载 & ④ 导出 PDF
    await ctrl.undoLastEdit(); // undo delete
    await ctrl.undoLastEdit(); // undo cut
    await frame();
    assert(await modelSnap() === snaps[6] && pixelHash() === hashes[6], "step 6 state mismatch before cold reload");

    const beforeReloadAnns = structuredClone(await store.loadAnnotations("g806-chain.pdf"));
    const beforeReloadCards = structuredClone(store.cards);
    await store.flush();
    await view.onClose();
    view.containerEl.remove();

    const store2 = await env.makeStore();
    const plugin2 = createPlugin(env.app, store2);
    const view2 = await openPdfReader(plugin2, env.sources.get("g806-chain.pdf")!.file, 640, 860);
    const afterReloadAnns = structuredClone(await store2.loadAnnotations("g806-chain.pdf"));
    const afterReloadCards = structuredClone(store2.cards);
    assert(JSON.stringify(afterReloadAnns) === JSON.stringify(beforeReloadAnns), "cold reload annotations mismatch");
    assert(JSON.stringify(afterReloadCards) === JSON.stringify(beforeReloadCards), "cold reload cards mismatch");

    // ④ 导出真实 PDF（含 2 笔渲染笔迹）供 Node 侧 pdf-lib 解包逐笔比对坐标（<=1pt）
    const exportedBytes = await buildEditedPdf(view2 as any, { pages: [{ id: "p1", sourcePage: 1 }] } as any, { includeAnnotations: true }, () => {});
    let binStr = "";
    for (let i = 0; i < exportedBytes.length; i++) binStr += String.fromCharCode(exportedBytes[i]);
    const exportedPdfBase64 = btoa(binStr);
    const expectedPens = afterReloadAnns.filter((a: any) => a.type === "pen" && a.strokes?.length).map((a: any) => ({
      id: a.id, color: a.color, strokes: a.strokes,
    }));

    await view2.onClose();
    view2.containerEl.remove();

    return {
      passed: true,
      stepCount: 8,
      stepNames,
      stepPixelHashes: hashes,
      undoAudit,
      redoAudit,
      coldReloadAnnotationsExact: true,
      coldReloadCardsExact: true,
      coldReloadCardCount: afterReloadCards.length,
      expectedPens,
      exportedPdfBase64,
    };
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
      }\n` + src
        .replace("const config = JSON.parse(new TextDecoder().decode(data));", "const decoded = new TextDecoder().decode(data); const config = decoded.startsWith('%PDF-') ? { name: 'real-pdf', pages: 1 } : JSON.parse(decoded);")
        .replace(/getViewport\(\{scale\}:\{scale:number\}\)\{[\s\S]*?return \{[\s\S]*?\};\s*\}/, `getViewport({scale}:{scale:number}){ const viewBox=config.crop||[0,0,600,800]; const rotation=config.rotations?.[num-1]??config.rotation??0; return new FakeViewport({viewBox,scale,rotation}); }`);
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
    const g804 = await evalJson("window.runG804UI()");
    await writeEvidence("g8-04-unbind-preservation.json", g804, "ui");
    const g805 = await evalJson("window.runG805UI()");
    await writeEvidence("g8-05-isolation-and-concurrency.json", g805, "ui");

    // 生成真实 1 页 600x800 PDF 传给浏览器跑 G8-06 同一条 8 步链，并回传导出 PDF 流在 Node 侧逐笔解包比对
    const blankDoc = await pdfLib.PDFDocument.create();
    blankDoc.addPage([600, 800]);
    const blankPdfB64 = Buffer.from(await blankDoc.save()).toString("base64");
    const g806Raw = await evalJson(`window.runG806Unified8Step(${JSON.stringify(blankPdfB64)})`);
    const exportedBytes = Buffer.from(g806Raw.exportedPdfBase64, "base64");
    const paints = await readPagePaint(pdfLib, exportedBytes);
    const strokePaints = paints.filter(p => p.kind === "stroke");
    if (strokePaints.length < g806Raw.expectedPens.length) {
      throw new Error(`G8-06 exported PDF stroke count ${strokePaints.length} < expected ${g806Raw.expectedPens.length}`);
    }
    const perStrokeExport = g806Raw.expectedPens.map(pen => {
      const expectedPts = pen.strokes[0].map(pt => [pt.x * 600, 800 - pt.y * 800]);
      const sameColor = strokePaints.filter(p => p.color.toLowerCase() === pen.color.toLowerCase());
      const minErrPt = Math.min(...sameColor.map(p => {
        if (p.points.length < 2) return Infinity;
        const first = p.points[0], last = p.points[p.points.length - 1];
        return Math.max(
          Math.hypot(first[0] - expectedPts[0][0], first[1] - expectedPts[0][1]),
          Math.hypot(last[0] - expectedPts[expectedPts.length - 1][0], last[1] - expectedPts[expectedPts.length - 1][1]),
        );
      }));
      if (!(minErrPt <= 1)) throw new Error(`G8-06 exported stroke ${pen.id} error ${minErrPt}pt > 1pt`);
      return { id: pen.id, color: pen.color, maxErrorPt: Number(minErrPt.toFixed(4)) };
    });
    const { exportedPdfBase64: _drop, expectedPens: _drop2, ...g806Evidence } = g806Raw;
    await writeEvidence("g8-06-compound-undo-reload-export.json", { ...g806Evidence, perStrokeExport }, "unified8Step");

    const errs = await evalJson("window.getErrors()");
    if (errs.length) throw new Error("Unhandled browser errors: " + JSON.stringify(errs));
    console.log("PASS lasso-ui-workflow: G8-01, G8-02, G8-03, G8-04(UI), G8-05(UI), G8-06(unified 8-step) all passed");
  } finally {
    await browser("close").catch(() => {});
    await new Promise(done => server.close(done));
  }
} finally {
  await rm(temporary, { recursive: true, force: true }).catch(() => {});
}
