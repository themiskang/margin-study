/**
 * [INPUT]: 依赖 ReaderView、StudyWorkspaceView、PenController、Store、样式表与 ego-harness 浏览器后端，零私有夹具依赖。
 * [OUTPUT]: 执行 PZ-01~PZ-07（含缩放无白闪 ~60Hz 采样）与原生 CDP 触控冒烟验收；若设置 MARGINSTUDY_EVIDENCE_DIR 则落盘带 head/generatedAt 的证据 JSON。
 * [POS]: 公开浏览器验收套件 pdf-pinch-zoom，验证 PDF 双指缩放、两阶段提交、无白闪双缓冲、锚点保持、手写/套索零副作用、三指安全、旋转页/双页/简洁态与折叠页/批注保真。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdtemp, realpath, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { runBrowser } from "./ego-harness.mjs";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const project = await realpath(resolve(here, "../.."));
const docFixtures = join(project, "src/documents/acceptance-fixtures");
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-pdf-pinch-")));

const fixtureSource = `
import { TFile, Platform } from "obsidian";
import { Store } from "${project}/src/model/store";
import { ReaderView } from "${project}/src/pdf/readerView";
import { events as pdfEvents } from "${project}/src/pdf/pdfjs";
import { StudyWorkspaceView } from "${project}/src/workspace/studyWorkspace";

(HTMLElement.prototype as any).empty = function () { this.replaceChildren(); };
const nativeSetPointerCapture = Element.prototype.setPointerCapture;
const nativeReleasePointerCapture = Element.prototype.releasePointerCapture;
let useNativePointerCapture = false;
Element.prototype.setPointerCapture = function (id: number) { if (useNativePointerCapture) return nativeSetPointerCapture.call(this, id); };
Element.prototype.releasePointerCapture = function (id: number) { if (useNativePointerCapture) return nativeReleasePointerCapture.call(this, id); };

const frame = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const assert = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };
const errors: string[] = [];
window.addEventListener("error", e => errors.push(String(e.error ?? e.message)));
window.addEventListener("unhandledrejection", e => errors.push(String(e.reason)));

const fixturesHost = document.getElementById("fixtures")!;
const stamp = "2026-11-25T00:00:00Z";

function sendPointer(target: EventTarget, type: string, pointerId: number, x: number, y: number, extra: any = {}) {
  const ev = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerType: "touch",
    pointerId,
    button: 0,
    isPrimary: pointerId === 301,
    clientX: x,
    clientY: y,
    ...extra,
  });
  target.dispatchEvent(ev);
  return ev;
}

async function pinchGesture(
  scrollEl: HTMLElement,
  cx: number,
  cy: number,
  startDist: number,
  endDist: number,
  opts: { steps?: number; staggerMs?: number; target1?: EventTarget; target2?: EventTarget; onAfterMove?: () => void; cancel?: boolean } = {},
) {
  const steps = opts.steps ?? 12;
  const staggerMs = opts.staggerMs ?? 30;
  const half0 = startDist / 2;
  const half1 = endDist / 2;
  const t1 = opts.target1 ?? (document.elementFromPoint(cx - half0, cy) || scrollEl);
  const t2 = opts.target2 ?? (document.elementFromPoint(cx + half0, cy) || scrollEl);
  sendPointer(t1, "pointerdown", 301, cx - half0, cy, { isPrimary: true });
  if (staggerMs > 0) {
    await wait(staggerMs);
    sendPointer(t1, "pointermove", 301, cx - half0 + 2, cy + 1, { isPrimary: true });
  }
  sendPointer(t2, "pointerdown", 302, cx + half0, cy, { isPrimary: false });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const half = half0 + (half1 - half0) * t;
    sendPointer(window, "pointermove", 301, cx - half, cy, { isPrimary: true });
    sendPointer(window, "pointermove", 302, cx + half, cy, { isPrimary: false });
    await frame();
  }
  opts.onAfterMove?.();
  const endType = opts.cancel ? "pointercancel" : "pointerup";
  sendPointer(window, endType, 302, cx + half1, cy, { isPrimary: false });
  sendPointer(window, endType, 301, cx - half1, cy, { isPrimary: true });
}

async function waitPagesRendered(view: ReaderView, pageNums: number[], expectedScale: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const allDone = pageNums.every(n => {
      const rec = view.getPageRecord(n);
      return rec && rec.renderedScale === expectedScale && !rec.renderPromise;
    });
    if (allDone) { await frame(); return; }
    await wait(25);
  }
  throw new Error("Timed out waiting for pages " + pageNums.join(",") + " to render at scale " + expectedScale);
}

function makeEnv(filesMap: Record<string, object | string>) {
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
    studySets: [{ id: "set-1", name: "Pinch Study", docPaths: [...sources.keys()], createdAt: stamp }],
    canvases: [{ id: "canvas-1", studySetId: "set-1", name: "Map 1", createdAt: stamp }],
    activeStudySetId: "set-1", activeCanvasId: "canvas-1",
    settings: { scale: 1.4 },
  };
  const host: any = {
    app,
    loadData: async () => JSON.parse(JSON.stringify(disk)),
    saveData: async (v: any) => { disk = JSON.parse(JSON.stringify(v)); },
  };
  return { app, host, sources };
}

async function openReader(filesMap: Record<string, object | string>, pdfPath: string, widthPx?: number, heightPx?: number) {
  fixturesHost.replaceChildren();
  const { app, host, sources } = makeEnv(filesMap);
  const store = new Store(host);
  await store.load();
  const plugin: any = {
    manifest: { id: "margin-study" },
    app, store,
    viewEvents: {},
    studyWorkspace: null,
    activeReader: null,
    refreshMindmap() {},
    refreshSidebar() {},
    ensureSplitLayout: async () => {},
    openDocument: async () => {},
  };
  const leaf: any = { app, setViewState: async () => {}, updateHeader() {}, getRoot: () => app.workspace.rootSplit };
  const view = new ReaderView(leaf, plugin);
  view.containerEl.style.cssText = widthPx && heightPx
    ? \`position:relative;width:\${widthPx}px;height:\${heightPx}px;display:flex;flex-direction:column;\`
    : "position:relative;width:100vw;height:100vh;display:flex;flex-direction:column;";
  fixturesHost.append(view.containerEl);
  await view.onOpen();
  await view.loadFileByPath(pdfPath);
  await frame();
  return { view, store, plugin, app, sources };
}

// ===== PZ-01: Monotonic zoom, [0.3, 4] clamping, and two-phase commit =====
(window as any).runPZ01 = async () => {
  const { view, store } = await openReader({ "pz01.pdf": { name: "pz01", pages: 3 } }, "pz01.pdf");
  try {
    await view.renderPage(1);
    await frame();
    const scrollEl = view.getScrollContainer();
    const scaleEl = (view as any).scaleEl as HTMLElement;
    const box = scrollEl.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;

    let saveCalls = 0;
    let renderCalls = 0;
    const origSave = store.save.bind(store);
    const origRender = view.renderPage.bind(view);
    store.save = ((...args: any[]) => { saveCalls++; return origSave(...args); }) as any;
    (view as any).renderPage = (num: number) => { renderCalls++; return origRender(num); };

    // 1. Pinch out: 80 -> 144px
    const s0 = view.getScale();
    let saveDuringMove = -1;
    let renderDuringMove = -1;
    saveCalls = 0; renderCalls = 0;
    await pinchGesture(scrollEl, cx, cy, 80, 144, {
      onAfterMove: () => {
        saveDuringMove = saveCalls;
        renderDuringMove = renderCalls;
      },
    });
    const s1 = view.getScale();
    const saveAfterCommit = saveCalls;
    await waitPagesRendered(view, [1], s1);
    const renderAfterCommit = renderCalls;
    const text1 = scaleEl.textContent;
    const rec1 = view.getPageRecord(1)!;
    assert(s1 > s0, \`PZ-01 pinch out did not increase scale: \${s0} -> \${s1}\`);
    assert(saveDuringMove === 0, \`PZ-01 store.save called during pointermove: \${saveDuringMove}\`);
    assert(renderDuringMove === 0, \`PZ-01 renderPage called during pointermove: \${renderDuringMove}\`);
    assert(saveAfterCommit === 1, \`PZ-01 store.save delta after commit expected 1, got \${saveAfterCommit}\`);
    assert(renderAfterCommit >= 1 && rec1.renderedScale === s1, \`PZ-01 visible page not re-rendered to \${s1}, got \${rec1.renderedScale}\`);
    assert(text1 === Math.round(s1 * 100) + "%", \`PZ-01 scaleEl mismatch: \${text1} vs \${Math.round(s1 * 100)}%\`);

    // 2. Pinch in: 160 -> 80px
    saveCalls = 0; renderCalls = 0;
    await pinchGesture(scrollEl, cx, cy, 160, 80);
    const s2 = view.getScale();
    await waitPagesRendered(view, [1], s2);
    const text2 = scaleEl.textContent;
    assert(s2 < s1, \`PZ-01 pinch in did not decrease scale: \${s1} -> \${s2}\`);
    assert(text2 === Math.round(s2 * 100) + "%", \`PZ-01 scaleEl mismatch after pinch in: \${text2}\`);

    // 3. Extreme pinch out -> clamped === 4
    await pinchGesture(scrollEl, cx, cy, 20, 600);
    const sMax = view.getScale();
    await waitPagesRendered(view, [1], sMax);
    const textMax = scaleEl.textContent;
    assert(sMax === 4, \`PZ-01 max clamp expected 4, got \${sMax}\`);
    assert(textMax === "400%", \`PZ-01 scaleEl max expected 400%, got \${textMax}\`);

    // 4. Extreme pinch in -> clamped === 0.3
    await pinchGesture(scrollEl, cx, cy, 600, 10);
    const sMin = view.getScale();
    await waitPagesRendered(view, [1], sMin);
    const textMin = scaleEl.textContent;
    assert(sMin === 0.3, \`PZ-01 min clamp expected 0.3, got \${sMin}\`);
    assert(textMin === "30%", \`PZ-01 scaleEl min expected 30%, got \${textMin}\`);

    return {
      passed: true,
      s0, s1, s2, sMax, sMin,
      saveDuringMove, renderDuringMove, saveAfterCommit, renderAfterCommit,
      renderedScaleAfterOut: rec1.renderedScale,
      scaleTexts: { s1: text1, s2: text2, sMax: textMax, sMin: textMin },
    };
  } finally {
    await view.onClose();
    view.containerEl.remove();
  }
};

// ===== PZ-02: Pinch center anchor preservation (<= 4px) =====
(window as any).runPZ02 = async () => {
  // Use 1200x1600 pages so even at scale 1.0 (1200px > 1024px) both X and Y are non-scroll-clamped
  const { view } = await openReader({ "pz02.pdf": { name: "pz02", pages: 3, crop: [0, 0, 1200, 1600] } }, "pz02.pdf");
  try {
    view.setScale(1.4);
    await view.renderPage(1);
    await view.renderPage(2);
    await frame();
    const scrollEl = view.getScrollContainer();
    // Scroll into middle of page 2 so neither X nor Y is clamped at boundaries
    const rec2 = view.getPageRecord(2)!;
    const sr = scrollEl.getBoundingClientRect();
    const r2Before = rec2.wrapper.getBoundingClientRect();
    scrollEl.scrollTop += (r2Before.top - sr.top) + r2Before.height * 0.35;
    scrollEl.scrollLeft = Math.max(0, (scrollEl.scrollWidth - scrollEl.clientWidth) / 2);
    await frame();
    await view.renderPage(2);
    await frame();

    const cx = sr.left + sr.width * 0.48;
    const cy = sr.top + sr.height * 0.45;
    const rStart = rec2.wrapper.getBoundingClientRect();
    const u = (cx - rStart.left) / rStart.width;
    const v = (cy - rStart.top) / rStart.height;
    assert(u > 0.1 && u < 0.9 && v > 0.1 && v < 0.9, \`PZ-02 start anchor not inside page 2: u=\${u}, v=\${v}\`);

    // Pinch out: 1.4 -> ~2.1 (80 -> 120px)
    await pinchGesture(scrollEl, cx, cy, 80, 120);
    const sOut = view.getScale();
    await waitPagesRendered(view, [2], sOut);
    const rOut = rec2.wrapper.getBoundingClientRect();
    const nxOut = rOut.left + u * rOut.width;
    const nyOut = rOut.top + v * rOut.height;
    const errOutX = Math.abs(nxOut - cx);
    const errOutY = Math.abs(nyOut - cy);
    assert(errOutX <= 4 && errOutY <= 4, \`PZ-02 pinch out anchor drift (\${errOutX.toFixed(2)}, \${errOutY.toFixed(2)}) > 4px\`);

    // Pinch in: ~2.1 -> ~1.0 (168 -> 80px)
    await pinchGesture(scrollEl, cx, cy, 168, 80);
    const sIn = view.getScale();
    await waitPagesRendered(view, [2], sIn);
    const rIn = rec2.wrapper.getBoundingClientRect();
    const nxIn = rIn.left + u * rIn.width;
    const nyIn = rIn.top + v * rIn.height;
    const errInX = Math.abs(nxIn - cx);
    const errInY = Math.abs(nyIn - cy);
    assert(errInX <= 4 && errInY <= 4, \`PZ-02 pinch in anchor drift (\${errInX.toFixed(2)}, \${errInY.toFixed(2)}) > 4px\`);

    return {
      passed: true,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      scales: { start: 1.4, out: sOut, in: sIn },
      outDriftPx: { x: Number(errOutX.toFixed(3)), y: Number(errOutY.toFixed(3)) },
      inDriftPx: { x: Number(errInX.toFixed(3)), y: Number(errInY.toFixed(3)) },
    };
  } finally {
    await view.onClose();
    view.containerEl.remove();
  }
};

// ===== PZ-03: Zero side effects across normal / pen / highlight / eraser / lasso-with-selection + pointercancel =====
(window as any).runPZ03 = async () => {
  const { view, store } = await openReader({ "pz03.pdf": { name: "pz03", pages: 2 } }, "pz03.pdf");
  try {
    await view.renderPage(1);
    await frame();
    const scrollEl = view.getScrollContainer();
    const rec1 = view.getPageRecord(1)!;

    // Seed highlight host + host-bound ink + free ink
    const hostAnn = {
      id: "host-hl-1", docPath: "pz03.pdf", type: "highlight" as const, color: "#ffd54f", text: "host highlight",
      page: 1, rects: [{ x: 100, y: 500, w: 160, h: 40 }], pdfCoordinateSpace: "pdf" as const, createdAt: stamp,
    };
    const boundInk = {
      id: "ink-bound-1", docPath: "pz03.pdf", type: "pen" as const, color: "#e53935",
      page: 1, rects: [], strokes: [[{ x: 0.2, y: 0.25 }, { x: 0.35, y: 0.28 }]], hostAnnotationId: "host-hl-1", createdAt: stamp,
    };
    const freeInk = {
      id: "ink-free-1", docPath: "pz03.pdf", type: "pen" as const, color: "#1e88e5",
      page: 1, rects: [], strokes: [[{ x: 0.5, y: 0.45 }, { x: 0.65, y: 0.48 }]], createdAt: stamp,
    };
    await store.saveAnnotationsNow("pz03.pdf", [hostAnn, boundInk, freeInk] as any);
    await frame();

    const getInks = async () => (await store.loadAnnotations("pz03.pdf")).filter((a: any) => a.type === "pen");
    const baselineInksJson = JSON.stringify(await getInks());
    const baselineHosts = (await getInks()).map((a: any) => [a.id, a.hostAnnotationId ?? null]);

    const modeResults: Record<string, any> = {};
    for (const mode of ["off", "pen", "highlight", "eraser", "lasso"] as const) {
      view.setScale(1.2);
      await waitPagesRendered(view, [1], 1.2);
      view.setHandwritingMode(mode);
      await frame();
      const pc = ((view as any).annController.penControllers as Map<number, any>).get(1);
      let selBefore: string[] = [];
      if (mode === "lasso") {
        assert(pc, "PZ-03 missing PenController in lasso mode");
        // Select both strokes via lasso drag
        const r = rec1.wrapper.getBoundingClientRect();
        const ov = rec1.wrapper.querySelector(".ms-pen-overlay")!;
        const pts = [[0.1, 0.15], [0.75, 0.15], [0.75, 0.6], [0.1, 0.6], [0.1, 0.15]];
        sendPointer(ov, "pointerdown", 101, r.left + pts[0][0] * r.width, r.top + pts[0][1] * r.height, { pointerType: "pen", isPrimary: true });
        for (let i = 1; i < pts.length - 1; i++) {
          sendPointer(ov, "pointermove", 101, r.left + pts[i][0] * r.width, r.top + pts[i][1] * r.height, { pointerType: "pen", isPrimary: true });
        }
        sendPointer(ov, "pointerup", 101, r.left + pts[pts.length - 1][0] * r.width, r.top + pts[pts.length - 1][1] * r.height, { pointerType: "pen", isPrimary: true });
        await frame();
        selBefore = (pc.selection as any[]).map(s => s.id).sort();
        assert(selBefore.length === 2, \`PZ-03 lasso failed to select 2 strokes before pinch: \${JSON.stringify(selBefore)}\`);
      }

      const annCtrl = (view as any).annController;
      assert(Array.isArray(annCtrl.editUndo) && Array.isArray(annCtrl.editRedo), "PZ-03 missing real editUndo/editRedo arrays");
      const histBefore = view.getEditHistoryState();
      const undoLenBefore = annCtrl.editUndo.length;
      const redoLenBefore = annCtrl.editRedo.length;
      const r = rec1.wrapper.getBoundingClientRect();
      // Land finger 1 outside the selection (at bottom-left) so lasso mode actually hits clearSelection() on finger 1!
      const cx = r.left + r.width * 0.5;
      const cy = r.top + r.height * 0.72;
      const targetOverlay = rec1.wrapper.querySelector(".ms-pen-overlay") || scrollEl;
      const scaleBefore = view.getScale();
      await pinchGesture(scrollEl, cx, cy, 80, 112, { staggerMs: 30, target1: targetOverlay, target2: targetOverlay });
      const scaleAfter = view.getScale();
      await waitPagesRendered(view, [1], scaleAfter);

      const inksAfter = await getInks();
      const inksAfterJson = JSON.stringify(inksAfter);
      const hostsAfter = inksAfter.map((a: any) => [a.id, a.hostAnnotationId ?? null]);
      const histAfter = view.getEditHistoryState();
      const undoLenAfter = annCtrl.editUndo.length;
      const redoLenAfter = annCtrl.editRedo.length;
      const selAfter = mode === "lasso" ? (pc.selection as any[]).map(s => s.id).sort() : [];
      const residue = {
        preview: document.querySelectorAll(".ms-pen-preview").length,
        lassoTrail: document.querySelectorAll(".ms-pen-lasso-trail").length,
        msLasso: document.querySelectorAll(".ms-lasso").length,
      };

      assert(scaleAfter > scaleBefore, \`PZ-03 mode=\${mode} pinch did not zoom: \${scaleBefore} -> \${scaleAfter}\`);
      assert(histAfter.canUndo === histBefore.canUndo && histAfter.canRedo === histBefore.canRedo && undoLenAfter === undoLenBefore && redoLenAfter === redoLenBefore,
        \`PZ-03 mode=\${mode} editUndo/editRedo mutated: undo \${undoLenBefore}->\${undoLenAfter}, redo \${redoLenBefore}->\${redoLenAfter}, canUndo \${histBefore.canUndo}->\${histAfter.canUndo}, canRedo \${histBefore.canRedo}->\${histAfter.canRedo}\`);
      assert(inksAfterJson === baselineInksJson, \`PZ-03 mode=\${mode} ink JSON mutated\`);
      assert(JSON.stringify(hostsAfter) === JSON.stringify(baselineHosts), \`PZ-03 mode=\${mode} hostAnnotationId mutated\`);
      if (mode === "lasso") {
        assert(JSON.stringify(selAfter) === JSON.stringify(selBefore), \`PZ-03 lasso selection lost: \${JSON.stringify(selBefore)} -> \${JSON.stringify(selAfter)}\`);
      }
      assert(residue.preview === 0 && residue.lassoTrail === 0 && residue.msLasso === 0,
        \`PZ-03 mode=\${mode} DOM residue: \${JSON.stringify(residue)}\`);
      modeResults[mode] = { scaleBefore, scaleAfter, selBefore, selAfter, residue, undoLenBefore, undoLenAfter, redoLenBefore, redoLenAfter, canUndo: histAfter.canUndo, canRedo: histAfter.canRedo };
    }

    // Explicit pointercancel check: must NOT commit half-drawn stroke
    view.setHandwritingMode("pen");
    await frame();
    const ov = rec1.wrapper.querySelector(".ms-pen-overlay")!;
    const r = rec1.wrapper.getBoundingClientRect();
    const undoBeforeCancel = (view as any).annController.editUndo.length;
    sendPointer(ov, "pointerdown", 401, r.left + 80, r.top + 80, { pointerType: "pen", isPrimary: true });
    sendPointer(ov, "pointermove", 401, r.left + 140, r.top + 120, { pointerType: "pen", isPrimary: true });
    sendPointer(ov, "pointercancel", 401, r.left + 140, r.top + 120, { pointerType: "pen", isPrimary: true });
    await frame();
    assert((view as any).annController.editUndo.length === undoBeforeCancel, "PZ-03 pointercancel pushed to editUndo!");
    assert(JSON.stringify(await getInks()) === baselineInksJson, "PZ-03 pointercancel committed a half-drawn stroke!");
    assert(document.querySelectorAll(".ms-pen-preview").length === 0, "PZ-03 pointercancel left .ms-pen-preview");

    // H1: ExtendNotes placing mode + diagonal 2-finger pinch must NOT spawn .ms-lasso (mid-pinch or after lift), must NOT leave active drag, and must NOT create stray extend note
    view.setScale(1.2);
    await waitPagesRendered(view, [1], 1.2);
    view.beginExtend();
    await frame();
    const rExt = rec1.wrapper.getBoundingClientRect();
    const extCx = rExt.left + rExt.width * 0.5;
    const extCy = rExt.top + rExt.height * 0.5;
    const extNotesBefore = view.getExtendNotes().length;
    const extScaleBefore = view.getScale();
    // Diagonal 2-finger pinch (staggered 30ms) so Finger 2 moves in both X and Y
    sendPointer(rec1.canvas, "pointerdown", 441, extCx - 30, extCy - 30, { isPrimary: true });
    await wait(30);
    sendPointer(rec1.canvas, "pointerdown", 442, extCx + 30, extCy + 30, { isPrimary: false });
    for (let i = 1; i <= 8; i++) {
      const d = 30 + i * 4;
      sendPointer(window, "pointermove", 441, extCx - d, extCy - d, { isPrimary: true });
      sendPointer(window, "pointermove", 442, extCx + d, extCy + d, { isPrimary: false });
      await frame();
    }
    const midPinchLassos = [...document.querySelectorAll(".ms-lasso")].map(el => ({ className: el.className, style: el.getAttribute("style"), parent: el.parentElement?.className }));
    const midPinchExtendDrag = Boolean((view as any).extendNotes.cancelDrag);
    sendPointer(window, "pointerup", 442, extCx + 62, extCy + 62, { isPrimary: false });
    sendPointer(window, "pointerup", 441, extCx - 62, extCy - 62, { isPrimary: true });
    const extScaleAfter = view.getScale();
    await waitPagesRendered(view, [1], extScaleAfter);
    await wait(60);
    await frame();
    const residualLassos = [...document.querySelectorAll(".ms-lasso")].map(el => ({ className: el.className, style: el.getAttribute("style"), parent: el.parentElement?.className }));
    const activeExtendDrag = Boolean((view as any).extendNotes.cancelDrag);
    assert(extScaleAfter > extScaleBefore, \`PZ-03 H1 ExtendNotes pinch did not zoom: \${extScaleBefore} -> \${extScaleAfter}\`);
    assert(midPinchLassos.length === 0 && !midPinchExtendDrag, \`PZ-03 H1 ExtendNotes pinch spawned .ms-lasso on 2nd finger: lassos=\${JSON.stringify(midPinchLassos)}, activeDrag=\${midPinchExtendDrag}\`);
    assert(residualLassos.length === 0, \`PZ-03 H1 ExtendNotes pinch left .ms-lasso residue: \${JSON.stringify(residualLassos)}\`);
    assert(!activeExtendDrag, "PZ-03 H1 ExtendNotes pinch left active cancelDrag gesture");
    assert(view.getExtendNotes().length === extNotesBefore, \`PZ-03 H1 ExtendNotes pinch created stray extend note: \${extNotesBefore} -> \${view.getExtendNotes().length}\`);
    // Subsequent single-finger region drag in ExtendNotes placing mode still creates an extend note cleanly
    const rExt2 = rec1.wrapper.getBoundingClientRect();
    sendPointer(rec1.canvas, "pointerdown", 451, rExt2.left + 80, rExt2.top + 120, { pointerType: "touch", isPrimary: true });
    sendPointer(window, "pointermove", 451, rExt2.left + 220, rExt2.top + 220, { pointerType: "touch", isPrimary: true });
    sendPointer(window, "pointerup", 451, rExt2.left + 220, rExt2.top + 220, { pointerType: "touch", isPrimary: true });
    await wait(60);
    await frame();
    const extNotesAfterSingle = view.getExtendNotes().length;
    assert(extNotesAfterSingle === extNotesBefore + 1, \`PZ-03 H1 ExtendNotes single-finger region drag failed after pinch: \${extNotesBefore} -> \${extNotesAfterSingle}\`);
    assert(document.querySelectorAll(".ms-lasso").length === 0, "PZ-03 H1 ExtendNotes single-finger drag left .ms-lasso");
    view.stopExtend();
    await frame();

    return { passed: true, modeResults, pointerCancelClean: true, extendNotesPinch: { extScaleBefore, extScaleAfter, residualLassos: residualLassos.length, activeExtendDrag, extNotesBefore, extNotesAfterSingle } };
  } finally {
    await view.onClose();
    view.containerEl.remove();
  }
};

// ===== PZ-04: Handwriting pinch + single-finger normal + 3-finger safe =====
(window as any).runPZ04 = async () => {
  const { view, store } = await openReader({ "pz04.pdf": { name: "pz04", pages: 2 } }, "pz04.pdf");
  try {
    await view.renderPage(1);
    await frame();
    const scrollEl = view.getScrollContainer();
    const rec1 = view.getPageRecord(1)!;
    const getInkCount = async () => (await store.loadAnnotations("pz04.pdf")).filter((a: any) => a.type === "pen").length;

    // 1. Pinch in pen mode
    view.setHandwritingMode("pen");
    await frame();
    const ov = rec1.wrapper.querySelector(".ms-pen-overlay")!;
    const r0 = rec1.wrapper.getBoundingClientRect();
    const s0 = view.getScale();
    await pinchGesture(scrollEl, r0.left + r0.width * 0.5, r0.top + r0.height * 0.4, 80, 112, { target1: ov, target2: ov });
    const s1 = view.getScale();
    await waitPagesRendered(view, [1], s1);
    assert(s1 > s0 && (await getInkCount()) === 0, "PZ-04 pen mode pinch failed or leaked ink");

    // 2a. Single-finger pen stroke commits (+1) and can Undo
    const r1 = rec1.wrapper.getBoundingClientRect();
    sendPointer(ov, "pointerdown", 501, r1.left + 90, r1.top + 90, { pointerType: "pen", isPrimary: true, pressure: 0.6 });
    sendPointer(ov, "pointermove", 501, r1.left + 160, r1.top + 110, { pointerType: "pen", isPrimary: true, pressure: 0.6 });
    sendPointer(ov, "pointerup", 501, r1.left + 180, r1.top + 120, { pointerType: "pen", isPrimary: true, pressure: 0.6 });
    await frame();
    const countAfterPen = await getInkCount();
    const canUndoAfterPen = view.getEditHistoryState().canUndo;
    assert(countAfterPen === 1 && canUndoAfterPen, \`PZ-04 single-finger pen stroke failed: count=\${countAfterPen}, canUndo=\${canUndoAfterPen}\`);
    await view.undoLastEdit();
    await frame();
    const countAfterUndo = await getInkCount();
    assert(countAfterUndo === 0, \`PZ-04 undo after pen stroke failed: count=\${countAfterUndo}\`);

    // 2b. Wait palm cooldown (>1250ms) then single-finger touch stroke commits (+1)
    await wait(1260);
    sendPointer(ov, "pointerdown", 502, r1.left + 100, r1.top + 160, { pointerType: "touch", isPrimary: true });
    sendPointer(ov, "pointermove", 502, r1.left + 180, r1.top + 180, { pointerType: "touch", isPrimary: true });
    sendPointer(ov, "pointerup", 502, r1.left + 210, r1.top + 190, { pointerType: "touch", isPrimary: true });
    await frame();
    const countAfterTouch = await getInkCount();
    assert(countAfterTouch === 1, \`PZ-04 single-finger touch stroke failed: count=\${countAfterTouch}\`);

    // 2c. Lasso mode single-finger drag selects the stroke
    view.setHandwritingMode("lasso");
    await frame();
    const pc = ((view as any).annController.penControllers as Map<number, any>).get(1);
    const r2 = rec1.wrapper.getBoundingClientRect();
    const pts = [[0.05, 0.05], [0.9, 0.05], [0.9, 0.9], [0.05, 0.9], [0.05, 0.05]];
    sendPointer(ov, "pointerdown", 503, r2.left + pts[0][0] * r2.width, r2.top + pts[0][1] * r2.height, { pointerType: "touch", isPrimary: true });
    for (let i = 1; i < pts.length - 1; i++) {
      sendPointer(ov, "pointermove", 503, r2.left + pts[i][0] * r2.width, r2.top + pts[i][1] * r2.height, { pointerType: "touch", isPrimary: true });
    }
    sendPointer(ov, "pointerup", 503, r2.left + pts[pts.length - 1][0] * r2.width, r2.top + pts[pts.length - 1][1] * r2.height, { pointerType: "touch", isPrimary: true });
    await frame();
    const lassoSelected = (pc.selection as any[]).length;
    assert(lassoSelected === 1, \`PZ-04 lasso select after pinch failed: selected=\${lassoSelected}\`);

    // 3. 3-finger touch mid-pinch: zero ink, zero selection change, finite scale, clean reset
    const scaleBefore3 = view.getScale();
    const cx = r2.left + r2.width * 0.5;
    const cy = r2.top + r2.height * 0.5;
    sendPointer(ov, "pointerdown", 601, cx - 40, cy, { isPrimary: true });
    await wait(20);
    sendPointer(ov, "pointerdown", 602, cx + 40, cy, { isPrimary: false });
    sendPointer(window, "pointermove", 602, cx + 60, cy, { isPrimary: false });
    await frame();
    // 3rd finger arrives!
    sendPointer(ov, "pointerdown", 603, cx, cy + 50, { isPrimary: false });
    sendPointer(window, "pointermove", 603, cx + 20, cy + 70, { isPrimary: false });
    await frame();
    sendPointer(window, "pointerup", 603, cx + 20, cy + 70, { isPrimary: false });
    sendPointer(window, "pointerup", 602, cx + 60, cy, { isPrimary: false });
    sendPointer(window, "pointerup", 601, cx - 40, cy, { isPrimary: true });
    await frame();
    const scaleAfter3 = view.getScale();
    assert(Number.isFinite(scaleAfter3) && scaleAfter3 === scaleBefore3, \`PZ-04 3-finger changed or broke scale: \${scaleBefore3} -> \${scaleAfter3}\`);
    assert((await getInkCount()) === 1, "PZ-04 3-finger created ink");
    assert((pc.selection as any[]).length === 1, "PZ-04 3-finger cleared selection");
    assert(((view as any).pinchPointers as Map<any, any>).size === 0 && (view as any).pinchState === null, "PZ-04 3-finger state machine did not reset");

    // 4. Subsequent 2-finger pinch works normally after 3-finger reset
    await pinchGesture(scrollEl, cx, cy, 80, 104, { target1: ov, target2: ov });
    const scaleAfterRecovery = view.getScale();
    await waitPagesRendered(view, [1], scaleAfterRecovery);
    assert(scaleAfterRecovery > scaleAfter3, \`PZ-04 pinch did not recover after 3-finger: \${scaleAfter3} -> \${scaleAfterRecovery}\`);

    // 5. Normal mode single-finger touch scroll unaffected
    view.setHandwritingMode("off");
    await frame();
    sendPointer(scrollEl, "pointerdown", 701, cx, cy, { pointerType: "touch", isPrimary: true });
    sendPointer(window, "pointermove", 701, cx, cy - 40, { pointerType: "touch", isPrimary: true });
    sendPointer(window, "pointerup", 701, cx, cy - 40, { pointerType: "touch", isPrimary: true });
    scrollEl.scrollTop = 60;
    await frame();
    assert(scrollEl.scrollTop > 0 && ((view as any).pinchPointers as Map<any, any>).size === 0, "PZ-04 normal mode scroll broken");

    return {
      passed: true,
      s0, s1, countAfterPen, countAfterUndo, countAfterTouch, lassoSelected,
      scaleBefore3, scaleAfter3, scaleAfterRecovery,
    };
  } finally {
    await view.onClose();
    view.containerEl.remove();
  }
};

// ===== PZ-05: 90°/270° rotated pages, spread layout (paged & continuous), clean view =====
(window as any).runPZ05 = async () => {
  // 1. Rotated 90° and 270° pages
  const rotationResults: Record<string, any> = {};
  for (const rot of [90, 270] as const) {
    const path = \`pz05-rot-\${rot}.pdf\`;
    const { view, store } = await openReader({ [path]: { name: "rot", pages: 2, crop: [0, 0, 1000, 1200], rotation: rot } }, path);
    try {
      const hl = {
        id: \`hl-rot-\${rot}\`, docPath: path, type: "highlight" as const, color: "#ffd54f", text: "rotated highlight",
        page: 1, rects: [{ x: 180, y: 300, w: 240, h: 80 }], pdfCoordinateSpace: "pdf" as const, createdAt: stamp,
      };
      await store.saveAnnotationsNow(path, [hl] as any);
      view.setScale(1.4);
      await view.renderPage(1);
      await frame();
      const scrollEl = view.getScrollContainer();
      const rec1 = view.getPageRecord(1)!;
      const sr = scrollEl.getBoundingClientRect();
      scrollEl.scrollLeft = Math.max(0, (scrollEl.scrollWidth - scrollEl.clientWidth) / 2);
      scrollEl.scrollTop = Math.max(0, (rec1.wrapper.getBoundingClientRect().height - scrollEl.clientHeight) / 2);
      await frame();

      const cx = sr.left + sr.width * 0.5;
      const cy = sr.top + sr.height * 0.5;
      const rStart = rec1.wrapper.getBoundingClientRect();
      const u = (cx - rStart.left) / rStart.width;
      const v = (cy - rStart.top) / rStart.height;

      await pinchGesture(scrollEl, cx, cy, 80, 112);
      const sAfter = view.getScale();
      await waitPagesRendered(view, [1], sAfter);
      const rAfter = rec1.wrapper.getBoundingClientRect();
      const driftX = Math.abs(rAfter.left + u * rAfter.width - cx);
      const driftY = Math.abs(rAfter.top + v * rAfter.height - cy);
      assert(sAfter > 1.4 && sAfter <= 4, \`PZ-05 rot=\${rot} scale invalid: \${sAfter}\`);
      assert(driftX <= 4 && driftY <= 4, \`PZ-05 rot=\${rot} anchor drift (\${driftX}, \${driftY}) > 4px\`);

      // Check highlight projection <= 2px
      const projected = view.projectRect(1, hl.rects[0] as any, "pdf")!;
      const annEl = rec1.annLayer.querySelector<HTMLElement>(\`.ms-ann-highlight[data-ann-id="\${hl.id}"]\`)!;
      assert(projected && annEl, \`PZ-05 rot=\${rot} missing projected rect or annEl\`);
      const annBox = annEl.getBoundingClientRect();
      const canvasBox = rec1.canvas.getBoundingClientRect();
      const projErr = Math.max(
        Math.abs((annBox.left - canvasBox.left) - projected.left),
        Math.abs((annBox.top - canvasBox.top) - projected.top),
        Math.abs(annBox.width - projected.width),
        Math.abs(annBox.height - projected.height),
      );
      assert(projErr <= 2, \`PZ-05 rot=\${rot} annotation projection error \${projErr}px > 2px\`);
      rotationResults[String(rot)] = { scaleAfter: sAfter, driftX: Number(driftX.toFixed(3)), driftY: Number(driftY.toFixed(3)), projErr: Number(projErr.toFixed(3)) };
    } finally {
      await view.onClose();
      view.containerEl.remove();
    }
  }

  // 2. Spread layout (both paged spread and continuous spread)
  const spreadResults: Record<string, any> = {};
  for (const mode of ["paged", "continuous"] as const) {
    const { view } = await openReader({ "pz05-spread.pdf": { name: "spread", pages: 4, crop: [0, 0, 700, 900] } }, "pz05-spread.pdf");
    try {
      await view.setPageLayout("spread", false);
      if (mode === "continuous") {
        (view as any).continuous = true;
        (view as any).layout = "spread";
        (view as any).reflowPages(1);
      }
      view.setScale(1.4);
      await Promise.all([view.renderPage(1), view.renderPage(2)]);
      await frame();
      const scrollEl = view.getScrollContainer();
      scrollEl.scrollLeft = Math.max(0, (scrollEl.scrollWidth - scrollEl.clientWidth) / 2);
      scrollEl.scrollTop = Math.max(0, (scrollEl.scrollHeight - scrollEl.clientHeight) / 3);
      await frame();
      const rec1 = view.getPageRecord(1)!;
      const rec2 = view.getPageRecord(2)!;
      assert(rec1.wrapper.parentElement === rec2.wrapper.parentElement && rec1.wrapper.parentElement!.classList.contains("ms-page-spread"),
        \`PZ-05 spread (\${mode}) pages 1 & 2 not paired before pinch\`);

      const sr = scrollEl.getBoundingClientRect();
      const r1 = rec1.wrapper.getBoundingClientRect();
      const cx = Math.max(sr.left + 40, Math.min(sr.right - 40, r1.left + r1.width * 0.6));
      const cy = sr.top + sr.height * 0.5;
      const u = (cx - r1.left) / r1.width;
      const v = (cy - r1.top) / r1.height;

      await pinchGesture(scrollEl, cx, cy, 80, 112);
      const sAfter = view.getScale();
      await waitPagesRendered(view, [1, 2], sAfter);
      assert(rec1.wrapper.parentElement === rec2.wrapper.parentElement, \`PZ-05 spread (\${mode}) broke pairing\`);
      const r1After = rec1.wrapper.getBoundingClientRect();
      const driftX = Math.abs(r1After.left + u * r1After.width - cx);
      const driftY = Math.abs(r1After.top + v * r1After.height - cy);
      assert(driftX <= 4 && driftY <= 4, \`PZ-05 spread (\${mode}) anchor drift (\${driftX}, \${driftY}) > 4px\`);
      spreadResults[mode] = { scaleAfter: sAfter, paired: true, driftX: Number(driftX.toFixed(3)), driftY: Number(driftY.toFixed(3)) };
    } finally {
      await view.onClose();
      view.containerEl.remove();
    }
  }

  // 3. Clean view (StudyWorkspaceView with is-clean-view + compact pen bar)
  fixturesHost.replaceChildren();
  const { app, host, sources } = makeEnv({ "pz05-clean.pdf": { name: "clean", pages: 2 } });
  const store = new Store(host);
  await store.load();
  const leaf: any = { app, setViewState: async () => {}, updateHeader() {}, getRoot: () => app.workspace.rootSplit };
  app.workspace.activeLeaf = leaf;
  app.workspace.centerLeaf = leaf;
  const plugin: any = {
    manifest: { id: "margin-study" }, app, store, viewEvents: {}, studyWorkspace: null, activeReader: null,
    refreshMindmap() { ws?.refresh(); }, refreshSidebar() { ws?.refresh(); },
    ensureSplitLayout: async () => {}, openDocument: async (f: TFile) => ws.openFile(f),
  };
  const ws = new StudyWorkspaceView(leaf, plugin);
  leaf.view = ws; plugin.studyWorkspace = ws;
  ws.containerEl.style.cssText = "position:relative;width:100vw;height:100vh;display:flex;flex-direction:column;";
  fixturesHost.append(ws.containerEl);
  ws.load();
  await ws.onOpen();
  await ws.openFile(sources.get("pz05-clean.pdf")!.file);
  await frame();
  ws.toggleCleanView(true);
  await frame();
  try {
    const reader = ws.getReader() as ReaderView;
    assert(reader instanceof ReaderView, "PZ-05 clean view reader is not ReaderView");
    await reader.renderPage(1);
    await frame();
    const scrollEl = reader.getScrollContainer();
    const box = scrollEl.getBoundingClientRect();
    const sBefore = reader.getScale();
    let wsSaveCalls = 0;
    let wsSaveDuringMove = -1;
    const origWsSave = store.save.bind(store);
    store.save = ((...args: any[]) => { wsSaveCalls++; return origWsSave(...args); }) as any;
    await pinchGesture(scrollEl, box.left + box.width / 2, box.top + box.height / 2, 80, 120, {
      onAfterMove: () => { wsSaveDuringMove = wsSaveCalls; },
    });
    const sAfter = reader.getScale();
    await waitPagesRendered(reader, [1], sAfter);
    // Wait past 250ms scroll debounce to ensure no duplicate Store.save() fires
    await wait(350);
    await frame();
    const wsSaveAfterLift = wsSaveCalls;
    store.save = origWsSave;
    const wsRoot = (ws.contentEl ?? ws.containerEl.children[1]) as HTMLElement;
    const cleanActive = wsRoot.classList.contains("is-clean-view") || !!ws.containerEl.querySelector(".is-clean-view");
    const handle = ws.containerEl.querySelector<HTMLElement>(".ms-clean-view-handle");
    const handleBox = handle?.getBoundingClientRect();
    assert(sAfter > sBefore, \`PZ-05 clean view pinch did not zoom: \${sBefore} -> \${sAfter}\`);
    assert(wsSaveDuringMove === 0, \`PZ-05 Q2 clean view Store.save during pointermove expected 0, got \${wsSaveDuringMove}\`);
    assert(wsSaveAfterLift === 1, \`PZ-05 Q2 clean view Store.save after lift expected 1, got \${wsSaveAfterLift}\`);
    assert(cleanActive, "PZ-05 clean view exited unexpectedly during pinch");
    assert(handle && handleBox && handleBox.width > 0 && handleBox.height > 0 && handleBox.top >= 0 && handleBox.left >= 0, "PZ-05 clean view handle obstructed/missing");

    // Q2b: Scroll -> immediately pinch within 100ms (before 250ms saveReadingPosition debounce expires) -> total Store.save() === 1
    let scrollPinchSaves = 0;
    let scrollPinchSavesDuringMove = -1;
    store.save = ((...args: any[]) => { scrollPinchSaves++; return origWsSave(...args); }) as any;
    scrollEl.scrollTop += 60;
    scrollEl.dispatchEvent(new Event("scroll"));
    await wait(50); // < 100ms, 250ms timer is still pending!
    const spCx = box.left + box.width / 2;
    const spCy = box.top + box.height / 2;
    sendPointer(scrollEl, "pointerdown", 381, spCx - 40, spCy, { isPrimary: true });
    await wait(25);
    sendPointer(scrollEl, "pointerdown", 382, spCx + 40, spCy, { isPrimary: false });
    for (let i = 1; i <= 12; i++) {
      const half = 40 + i * 2;
      sendPointer(window, "pointermove", 381, spCx - half, spCy, { isPrimary: true });
      sendPointer(window, "pointermove", 382, spCx + half, spCy, { isPrimary: false });
      await wait(25); // 12 * 25ms = 300ms > 250ms debounce window!
    }
    scrollPinchSavesDuringMove = scrollPinchSaves;
    sendPointer(window, "pointerup", 382, spCx + 64, spCy, { isPrimary: false });
    sendPointer(window, "pointerup", 381, spCx - 64, spCy, { isPrimary: true });
    const sAfterScrollPinch = reader.getScale();
    await waitPagesRendered(reader, [1], sAfterScrollPinch);
    await wait(350);
    await frame();
    const scrollPinchSavesAfterLift = scrollPinchSaves;
    store.save = origWsSave;
    assert(scrollPinchSavesDuringMove === 0, \`PZ-05 Q2b scroll+immediate-pinch Store.save during move expected 0, got \${scrollPinchSavesDuringMove}\`);
    assert(scrollPinchSavesAfterLift === 1, \`PZ-05 Q2b scroll+immediate-pinch total Store.save expected 1, got \${scrollPinchSavesAfterLift}\`);

    return {
      passed: true,
      rotationResults,
      spreadResults,
      cleanView: { scaleBefore: sBefore, scaleAfter: sAfter, wsSaveDuringMove, wsSaveAfterLift, scrollPinchSavesDuringMove, scrollPinchSavesAfterLift, cleanActive, handleVisible: true },
    };
  } finally {
    await ws.onClose();
    ws.unload();
    ws.containerEl.remove();
  }
};

// ===== PZ-06: Post-zoom page number / folded page / annotation position fidelity =====
(window as any).runPZ06 = async () => {
  const { view, store } = await openReader({ "pz06.pdf": { name: "pz06", pages: 4 } }, "pz06.pdf");
  try {
    const hl = {
      id: "pz06-hl-1", docPath: "pz06.pdf", type: "highlight" as const, color: "#ffd54f", text: "page 2 highlight",
      page: 2, rects: [{ x: 120, y: 420, w: 240, h: 50 }], pdfCoordinateSpace: "pdf" as const, createdAt: stamp,
    };
    const pen = {
      id: "pz06-pen-1", docPath: "pz06.pdf", type: "pen" as const, color: "#e53935",
      page: 2, rects: [], strokes: [[{ x: 0.2, y: 0.3 }, { x: 0.5, y: 0.35 }]], createdAt: stamp,
    };
    await store.saveAnnotationsNow("pz06.pdf", [hl, pen] as any);
    await frame();

    // Fold page 3
    (view as any).toggleFold(3);
    assert(((view as any).folded as Set<number>).has(3), "PZ-06 failed to fold page 3");
    // Navigate to page 2
    await view.navigateToReference(2, [], undefined, false);
    await waitPagesRendered(view, [2], view.getScale());
    await frame();
    assert(view.getCurrentPage() === 2, \`PZ-06 initial currentPage expected 2, got \${view.getCurrentPage()}\`);

    const canonicalBefore = JSON.stringify(await store.loadAnnotations("pz06.pdf"));
    const foldedBefore = [...((view as any).folded as Set<number>)].sort();
    const scrollEl = view.getScrollContainer();
    const rec2 = view.getPageRecord(2)!;
    const r2 = rec2.wrapper.getBoundingClientRect();
    const sr = scrollEl.getBoundingClientRect();
    const cx = Math.max(sr.left + 60, Math.min(sr.right - 60, r2.left + r2.width / 2));
    const cy = Math.max(sr.top + 60, Math.min(sr.bottom - 60, r2.top + r2.height / 2));

    // Pinch zoom IN then pinch zoom OUT
    await pinchGesture(scrollEl, cx, cy, 80, 128);
    await waitPagesRendered(view, [2], view.getScale());
    const scaleMid = view.getScale();
    await pinchGesture(scrollEl, cx, cy, 128, 88);
    await waitPagesRendered(view, [2], view.getScale());
    const scaleEnd = view.getScale();
    await frame();

    const currentPageAfter = view.getCurrentPage();
    const foldedAfter = [...((view as any).folded as Set<number>)].sort();
    const page3FoldedClass = view.getPageRecord(3)!.wrapper.classList.contains("ms-page-folded");
    const canonicalAfter = JSON.stringify(await store.loadAnnotations("pz06.pdf"));

    assert(currentPageAfter === 2, \`PZ-06 currentPage drifted: expected 2, got \${currentPageAfter}\`);
    assert(JSON.stringify(foldedAfter) === JSON.stringify(foldedBefore) && page3FoldedClass,
      \`PZ-06 folded pages changed: \${JSON.stringify(foldedBefore)} -> \${JSON.stringify(foldedAfter)}\`);
    assert(canonicalAfter === canonicalBefore, "PZ-06 canonical annotation coordinates mutated");

    // Check rendered highlight bounding box vs projectRect <= 2px
    const projected = view.projectRect(2, hl.rects[0] as any, "pdf")!;
    const annEl = rec2.annLayer.querySelector<HTMLElement>('.ms-ann-highlight[data-ann-id="pz06-hl-1"]')!;
    assert(projected && annEl, "PZ-06 missing highlight element after zoom");
    const annBox = annEl.getBoundingClientRect();
    const canvasBox = rec2.canvas.getBoundingClientRect();
    const projErr = Math.max(
      Math.abs((annBox.left - canvasBox.left) - projected.left),
      Math.abs((annBox.top - canvasBox.top) - projected.top),
      Math.abs(annBox.width - projected.width),
      Math.abs(annBox.height - projected.height),
    );
    assert(projErr <= 2, \`PZ-06 highlight projection error \${projErr}px > 2px\`);

    return {
      passed: true,
      scaleMid, scaleEnd, currentPageAfter, foldedAfter, page3FoldedClass,
      canonicalUnchanged: true,
      projErr: Number(projErr.toFixed(3)),
    };
  } finally {
    await view.onClose();
    view.containerEl.remove();
  }
};

// ===== Q3: Native lostpointercapture (isTrusted=true) must NOT commit half-drawn stroke =====
let q3Ctx: { view: ReaderView; store: Store; ov: Element; lostEvents: { isTrusted: boolean; pointerType: string }[]; undoBefore: number; canUndoBefore: boolean; inksBefore: number } | null = null;
(window as any).setupQ3NativeLostCapture = async () => {
  useNativePointerCapture = true;
  const { view, store } = await openReader({ "q3-lost.pdf": { name: "q3", pages: 1 } }, "q3-lost.pdf");
  await view.renderPage(1);
  view.setHandwritingMode("pen");
  await frame();
  const rec1 = view.getPageRecord(1)!;
  const ov = rec1.wrapper.querySelector(".ms-pen-overlay")!;
  const lostEvents: { isTrusted: boolean; pointerType: string }[] = [];
  ov.addEventListener("lostpointercapture", (ev: Event) => {
    const pe = ev as PointerEvent;
    lostEvents.push({ isTrusted: pe.isTrusted, pointerType: pe.pointerType });
  }, true);
  const box = rec1.wrapper.getBoundingClientRect();
  const inksBefore = (await store.loadAnnotations("q3-lost.pdf")).filter((a: any) => a.type === "pen").length;
  const undoBefore = (view as any).annController.editUndo.length;
  const canUndoBefore = view.getEditHistoryState().canUndo;
  q3Ctx = { view, store, ov, lostEvents, undoBefore, canUndoBefore, inksBefore };
  return { x: Math.round(box.left + 120), y: Math.round(box.top + 120) };
};
(window as any).triggerQ3ReleaseCapture = () => {
  if (!q3Ctx) throw new Error("No q3Ctx");
  const pc = ((q3Ctx.view as any).annController.penControllers as Map<number, any>).get(1);
  const pid = pc?.pointerId;
  if (typeof pid !== "number") throw new Error("Q3 expected active pointerId on PenController, got " + String(pid));
  nativeReleasePointerCapture.call(q3Ctx.ov, pid);
  return { releasedPointerId: pid };
};
(window as any).finishQ3NativeLostCapture = async () => {
  if (!q3Ctx) throw new Error("No q3Ctx");
  const { view, store, ov, lostEvents, undoBefore, canUndoBefore, inksBefore } = q3Ctx;
  try {
    await frame();
    const inksAfterLost = (await store.loadAnnotations("q3-lost.pdf")).filter((a: any) => a.type === "pen").length;
    const undoAfterLost = (view as any).annController.editUndo.length;
    const canUndoAfterLost = view.getEditHistoryState().canUndo;
    const previewResidue = document.querySelectorAll(".ms-pen-preview").length;
    assert(lostEvents.some(e => e.isTrusted), \`Q3 did not observe trusted native lostpointercapture: \${JSON.stringify(lostEvents)}\`);
    assert(inksAfterLost === inksBefore && undoAfterLost === undoBefore && canUndoAfterLost === canUndoBefore,
      \`Q3 nativeLostCapture committed half-drawn stroke: inks \${inksBefore}->\${inksAfterLost}, editUndo \${undoBefore}->\${undoAfterLost}, canUndo \${canUndoBefore}->\${canUndoAfterLost}\`);
    assert(previewResidue === 0, \`Q3 nativeLostCapture left .ms-pen-preview: \${previewResidue}\`);
    // Subsequent single-finger stroke still commits +1 cleanly
    useNativePointerCapture = false;
    const r = view.getPageRecord(1)!.wrapper.getBoundingClientRect();
    sendPointer(ov, "pointerdown", 801, r.left + 100, r.top + 180, { pointerType: "pen", isPrimary: true, pressure: 0.5 });
    sendPointer(ov, "pointermove", 801, r.left + 180, r.top + 200, { pointerType: "pen", isPrimary: true, pressure: 0.5 });
    sendPointer(ov, "pointerup", 801, r.left + 210, r.top + 210, { pointerType: "pen", isPrimary: true, pressure: 0.5 });
    await frame();
    const inksAfterFollowup = (await store.loadAnnotations("q3-lost.pdf")).filter((a: any) => a.type === "pen").length;
    assert(inksAfterFollowup === inksBefore + 1, \`Q3 follow-up single-finger stroke failed: \${inksBefore} -> \${inksAfterFollowup}\`);
    return { passed: true, lostEvents, inksBefore, inksAfterLost, undoBefore, undoAfterLost, canUndoAfterLost, inksAfterFollowup };
  } finally {
    useNativePointerCapture = false;
    await view.onClose();
    view.containerEl.remove();
    q3Ctx = null;
  }
};

// ===== Q3b: Trusted window.blur (no pointercancel / no lostpointercapture) must clear previews and prevent commit on later pointerup =====
let q3bCtx: { view: ReaderView; store: Store; blurEvents: boolean[]; undoBefore: number; canUndoBefore: boolean; inksBefore: number } | null = null;
(window as any).setupQ3bTrustedBlur = async () => {
  useNativePointerCapture = false; // no pointer capture so blur happens with zero lostpointercapture and zero pointercancel
  const { view, store } = await openReader({ "q3b-blur.pdf": { name: "q3b", pages: 1 } }, "q3b-blur.pdf");
  await view.renderPage(1);
  view.setHandwritingMode("pen");
  await frame();
  const rec1 = view.getPageRecord(1)!;
  const blurEvents: boolean[] = [];
  window.addEventListener("blur", (ev: Event) => blurEvents.push(ev.isTrusted), true);
  const box = rec1.wrapper.getBoundingClientRect();
  const inksBefore = (await store.loadAnnotations("q3b-blur.pdf")).filter((a: any) => a.type === "pen").length;
  const undoBefore = (view as any).annController.editUndo.length;
  const canUndoBefore = view.getEditHistoryState().canUndo;
  q3bCtx = { view, store, blurEvents, undoBefore, canUndoBefore, inksBefore };
  return { x: Math.round(box.left + 120), y: Math.round(box.top + 120) };
};
(window as any).checkQ3bAfterBlur = () => {
  if (!q3bCtx) throw new Error("No q3bCtx");
  return {
    blurEvents: q3bCtx.blurEvents,
    visibilityState: document.visibilityState,
    previewsAfterBlur: document.querySelectorAll(".ms-pen-preview").length,
    undoAfterBlur: (q3bCtx.view as any).annController.editUndo.length,
  };
};
(window as any).finishQ3bTrustedBlur = async (afterBlur: any) => {
  if (!q3bCtx) throw new Error("No q3bCtx");
  const { view, store, undoBefore, canUndoBefore, inksBefore } = q3bCtx;
  try {
    await frame();
    const inksAfterUp = (await store.loadAnnotations("q3b-blur.pdf")).filter((a: any) => a.type === "pen").length;
    const undoAfterUp = (view as any).annController.editUndo.length;
    const canUndoAfterUp = view.getEditHistoryState().canUndo;
    const previewsAfterUp = document.querySelectorAll(".ms-pen-preview").length;
    assert(afterBlur.blurEvents.some((t: boolean) => t === true), \`Q3b did not observe trusted window.blur: \${JSON.stringify(afterBlur.blurEvents)}\`);
    assert(afterBlur.previewsAfterBlur === 0, \`Q3b trusted blur left .ms-pen-preview elements: \${afterBlur.previewsAfterBlur}\`);
    assert(inksAfterUp === inksBefore && undoAfterUp === undoBefore && canUndoAfterUp === canUndoBefore,
      \`Q3b trusted blur + pointerup committed half-drawn stroke: inks \${inksBefore}->\${inksAfterUp}, editUndo \${undoBefore}->\${undoAfterUp}, canUndo \${canUndoBefore}->\${canUndoAfterUp}\`);
    assert(previewsAfterUp === 0, \`Q3b previews remained after pointerup: \${previewsAfterUp}\`);
    return { passed: true, afterBlur, inksBefore, inksAfterUp, undoBefore, undoAfterUp, canUndoAfterUp };
  } finally {
    await view.onClose();
    view.containerEl.remove();
    q3bCtx = null;
  }
};

// ===== Native CDP Touch Smoke setup/teardown =====
let cdpView: ReaderView | null = null;
(window as any).setupCdpTouchSmoke = async () => {
  const { view } = await openReader({ "cdp-smoke.pdf": { name: "cdp", pages: 2 } }, "cdp-smoke.pdf");
  cdpView = view;
  await view.renderPage(1);
  await frame();
  const scrollEl = view.getScrollContainer();
  const touchAction = getComputedStyle(scrollEl).touchAction;
  const box = scrollEl.getBoundingClientRect();
  return {
    scaleBefore: view.getScale(),
    touchAction,
    cx: Math.round(box.left + box.width / 2),
    cy: Math.round(box.top + box.height / 2),
  };
};
(window as any).finishCdpTouchSmoke = async () => {
  if (!cdpView) throw new Error("No cdpView");
  const scaleAfter = cdpView.getScale();
  await waitPagesRendered(cdpView, [1], scaleAfter);
  const scaleElText = ((cdpView as any).scaleEl as HTMLElement).textContent;
  await cdpView.onClose();
  cdpView.containerEl.remove();
  cdpView = null;
  return { scaleAfter, scaleElText };
};

// ===== PZ-07: No white-flash frames (~60Hz sampling) on pinch commit & desktop zoom buttons =====
(window as any).runPZ07NoWhiteFlash = async () => {
  const { view } = await openReader(
    { "flash.pdf": { name: "flash", pages: 3, renderDelay: 120, textDelay: 20, paintContent: true } },
    "flash.pdf",
  );
  try {
    await view.renderPage(1);
    await frame();
    const scrollEl = view.getScrollContainer();
    const box = scrollEl.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;

    const WHITE_FLASH_RATIO_THRESHOLD = 0.98;
    const WHITE_FLASH_JUMP_THRESHOLD = 0.25;
    const MAX_ALLOWED_WHITE_RATIO = 0.90;

    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = 64;
    sampleCanvas.height = 80;
    const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true })!;

    const measureWhiteRatio = (pageNum: number): number => {
      const rec = view.getPageRecord(pageNum);
      if (!rec) return 1;
      const wRect = rec.wrapper.getBoundingClientRect();
      const cRect = rec.canvas.getBoundingClientRect();
      sampleCtx.fillStyle = "#ffffff";
      sampleCtx.fillRect(0, 0, sampleCanvas.width, sampleCanvas.height);
      if (rec.canvas.width > 0 && rec.canvas.height > 0 && wRect.width > 0 && wRect.height > 0 && cRect.width > 0 && cRect.height > 0) {
        const dx = ((cRect.left - wRect.left) / wRect.width) * sampleCanvas.width;
        const dy = ((cRect.top - wRect.top) / wRect.height) * sampleCanvas.height;
        const dw = (cRect.width / wRect.width) * sampleCanvas.width;
        const dh = (cRect.height / wRect.height) * sampleCanvas.height;
        sampleCtx.drawImage(rec.canvas, 0, 0, rec.canvas.width, rec.canvas.height, dx, dy, dw, dh);
      }
      const data = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
      let white = 0;
      const total = sampleCanvas.width * sampleCanvas.height;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] >= 245 && data[i + 1] >= 245 && data[i + 2] >= 245) white++;
      }
      return Number((white / total).toFixed(4));
    };

    const sampleTransition = async (label: string, trigger: () => Promise<number> | number) => {
      const eventsBefore = pdfEvents.length;
      const ratios: number[] = [];
      let sampling = true;
      const baselineWhiteRatio = measureWhiteRatio(1);
      ratios.push(baselineWhiteRatio);
      const tick = () => {
        if (!sampling) return;
        ratios.push(measureWhiteRatio(1));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      try {
        const targetScale = await trigger();
        await waitPagesRendered(view, [1], targetScale);
        await frame();
      } finally {
        sampling = false;
      }
      const renderCount = pdfEvents.slice(eventsBefore).filter(e => e[0] === "render" && e[1] === "flash" && e[2] === 1).length;
      let flashFrames = 0;
      let maxJump = 0;
      let maxWhiteRatio = 0;
      let peakFlashRatio = 0;
      for (let i = 0; i < ratios.length; i++) {
        if (ratios[i] > maxWhiteRatio) maxWhiteRatio = ratios[i];
        if (i > 0) {
          const jump = Number((ratios[i] - ratios[i - 1]).toFixed(4));
          if (jump > maxJump) maxJump = jump;
          if (ratios[i] >= WHITE_FLASH_RATIO_THRESHOLD && jump >= WHITE_FLASH_JUMP_THRESHOLD) {
            flashFrames++;
            if (ratios[i] > peakFlashRatio) peakFlashRatio = ratios[i];
          }
        }
      }
      return {
        label,
        baselineWhiteRatio,
        samples: ratios.length,
        maxWhiteRatio,
        maxJump,
        flashFrames,
        peakFlashRatio,
        renderCount,
        ratios: ratios.slice(0, 24),
      };
    };

    const pinchOut = await sampleTransition("pinch-out", async () => {
      await pinchGesture(scrollEl, cx, cy, 80, 136, { steps: 6, staggerMs: 20 });
      return view.getScale();
    });

    const pinchIn = await sampleTransition("pinch-in", async () => {
      await pinchGesture(scrollEl, cx, cy, 136, 80, { steps: 6, staggerMs: 20 });
      return view.getScale();
    });

    const zoomInBtn = view.containerEl.querySelector('button[title="放大"]') as HTMLButtonElement | null;
    const zoomOutBtn = view.containerEl.querySelector('button[title="缩小"]') as HTMLButtonElement | null;
    assert(zoomInBtn && zoomOutBtn, "PZ-07 desktop zoom buttons not found");

    const desktopZoomIn = await sampleTransition("desktop-zoom-in", () => {
      zoomInBtn!.click();
      return view.getScale();
    });

    const desktopZoomOut = await sampleTransition("desktop-zoom-out", () => {
      zoomOutBtn!.click();
      return view.getScale();
    });

    const transitions = [pinchOut, pinchIn, desktopZoomIn, desktopZoomOut];
    for (const t of transitions) {
      assert(t.baselineWhiteRatio < 0.75, \`PZ-07 [\${t.label}] baseline not textured enough: whiteRatio=\${t.baselineWhiteRatio}\`);
      assert(t.samples >= 5, \`PZ-07 [\${t.label}] too few ~60Hz samples: \${t.samples}\`);
      assert(t.renderCount === 1, \`PZ-07 [\${t.label}] expected 1 visible page render, got \${t.renderCount}\`);
      assert(
        t.flashFrames === 0 && t.maxWhiteRatio < MAX_ALLOWED_WHITE_RATIO,
        \`PZ-07 [\${t.label}] white flash detected: flashFrames=\${t.flashFrames}, baseline=\${t.baselineWhiteRatio}, maxWhiteRatio=\${t.maxWhiteRatio}, maxJump=\${t.maxJump}\`,
      );
    }

    return {
      passed: true,
      thresholds: {
        whiteFlashRatioThreshold: WHITE_FLASH_RATIO_THRESHOLD,
        whiteFlashJumpThreshold: WHITE_FLASH_JUMP_THRESHOLD,
        maxAllowedWhiteRatio: MAX_ALLOWED_WHITE_RATIO,
      },
      pinchOut,
      pinchIn,
      desktopZoomIn,
      desktopZoomOut,
    };
  } finally {
    await view.onClose();
    view.containerEl.remove();
  }
};

// ===== PZ-08: Hard memory budget matrix (4 page types x Desktop/Mobile) + 0 white-flash under degradation =====
(window as any).runPZ08MemoryBudgetMatrix = async () => {
  const origIsMobile = Platform.isMobile;
  const origDprDesc = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => 2 });

  const WHITE_FLASH_RATIO_THRESHOLD = 0.98;
  const WHITE_FLASH_JUMP_THRESHOLD = 0.25;
  const MAX_ALLOWED_WHITE_RATIO = 0.90;
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 64;
  sampleCanvas.height = 80;
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true })!;

  const measureWhiteRatio = (view: ReaderView, pageNum: number): number => {
    const rec = view.getPageRecord(pageNum);
    if (!rec) return 1;
    const wRect = rec.wrapper.getBoundingClientRect();
    const cRect = rec.canvas.getBoundingClientRect();
    sampleCtx.fillStyle = "#ffffff";
    sampleCtx.fillRect(0, 0, sampleCanvas.width, sampleCanvas.height);
    if (rec.canvas.width > 0 && rec.canvas.height > 0 && wRect.width > 0 && wRect.height > 0 && cRect.width > 0 && cRect.height > 0) {
      const dx = ((cRect.left - wRect.left) / wRect.width) * sampleCanvas.width;
      const dy = ((cRect.top - wRect.top) / wRect.height) * sampleCanvas.height;
      const dw = (cRect.width / wRect.width) * sampleCanvas.width;
      const dh = (cRect.height / wRect.height) * sampleCanvas.height;
      sampleCtx.drawImage(rec.canvas, 0, 0, rec.canvas.width, rec.canvas.height, dx, dy, dw, dh);
    }
    const data = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    let white = 0;
    const total = sampleCanvas.width * sampleCanvas.height;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] >= 245 && data[i + 1] >= 245 && data[i + 2] >= 245) white++;
    }
    return Number((white / total).toFixed(4));
  };

  const toMB = (pixels: number) => Number(((pixels * 4) / (1024 * 1024)).toFixed(2));

  const runCase = async (
    tier: "desktop" | "mobile",
    pageType: "normal-a4" | "folded-a4" | "rotated-a4" | "spread-a4",
  ) => {
    Platform.isMobile = tier === "mobile";
    const pdfPath = \`mem-\${tier}-\${pageType}.pdf\`;
    const cfg: any = {
      name: \`\${tier}-\${pageType}\`,
      pages: 6,
      crop: [0, 0, 595, 842],
      renderDelay: 80,
      textDelay: 10,
      paintContent: true,
    };
    if (pageType === "rotated-a4") cfg.rotation = 90;
    const { view, store } = await openReader({ [pdfPath]: cfg }, pdfPath);
    try {
      if (pageType === "spread-a4") {
        await view.setPageLayout("spread", false);
        await waitPagesRendered(view, [1, 2], view.getScale());
      } else if (pageType === "folded-a4") {
        // Fold ~75% of A4 height (leaving top & bottom dark content bands visible)
        store.updateDocMeta(pdfPath, {
          pdfRegionFolds: [{ id: "fold-a4-1", pageId: view.getPdfPageId(1), rects: [{ x: 0, y: 120, w: 595, h: 600 }] }],
        });
        await view.refreshExtendLayout();
        await waitPagesRendered(view, [1], view.getScale());
        await frame();
      } else {
        await view.renderPage(1);
        await frame();
      }

      const targetPages = pageType === "spread-a4" ? [1, 2] : [1];
      for (const p of targetPages) (view as any).visiblePages.add(p);
      view.resetMemoryPeak();

      // Zoom from 1.4 -> 4.0 (extreme scale at DPR=2) while sampling at ~60Hz
      const ratios: number[] = [];
      let sampling = true;
      ratios.push(measureWhiteRatio(view, 1));
      const tick = () => {
        if (!sampling) return;
        ratios.push(measureWhiteRatio(view, 1));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      try {
        view.setScale(4.0);
        await waitPagesRendered(view, targetPages, 4.0);
        await frame();
      } finally {
        sampling = false;
      }

      let flashFrames = 0;
      let maxWhiteRatio = 0;
      let maxJump = 0;
      for (let i = 0; i < ratios.length; i++) {
        if (ratios[i] > maxWhiteRatio) maxWhiteRatio = ratios[i];
        if (i > 0) {
          const jump = Number((ratios[i] - ratios[i - 1]).toFixed(4));
          if (jump > maxJump) maxJump = jump;
          if (ratios[i] >= WHITE_FLASH_RATIO_THRESHOLD && jump >= WHITE_FLASH_JUMP_THRESHOLD) {
            flashFrames++;
          }
        }
      }

      const stats = view.getMemoryStats();
      const page1 = stats.pages[1];
      const peakMB = toMB(stats.peakTotalPixels);
      const hardBudgetMB = toMB(stats.hardBudgetPixels);

      assert(
        stats.peakTotalPixels <= stats.hardBudgetPixels,
        \`PZ-08 [\${tier}/\${pageType}] exceeded hard budget: peak=\${peakMB}MB (\${stats.peakTotalPixels}px) > hard=\${hardBudgetMB}MB (\${stats.hardBudgetPixels}px)\`,
      );
      assert(
        flashFrames === 0 && maxWhiteRatio < MAX_ALLOWED_WHITE_RATIO,
        \`PZ-08 [\${tier}/\${pageType}] white flash under budget: flashFrames=\${flashFrames}, maxWhiteRatio=\${maxWhiteRatio}, maxJump=\${maxJump}\`,
      );

      // Verify offscreen cache hard cap by rendering all 6 pages sequentially while only page 6 stays visible
      for (let p = 2; p <= 6; p++) {
        (view as any).visiblePages.clear();
        (view as any).visiblePages.add(p);
        await view.renderPage(p);
      }
      const afterScroll = view.getMemoryStats();
      const maxCachedPages = tier === "mobile" ? 3 : 4;
      assert(
        afterScroll.cachedPages <= maxCachedPages && afterScroll.currentTotalPixels <= afterScroll.hardBudgetPixels,
        \`PZ-08 [\${tier}/\${pageType}] offscreen cache cap exceeded: cachedPages=\${afterScroll.cachedPages} (max \${maxCachedPages}), total=\${toMB(afterScroll.currentTotalPixels)}MB (hard \${hardBudgetMB}MB)\`,
      );

      return {
        tier,
        pageType,
        peakPixels: stats.peakTotalPixels,
        peakMB,
        hardBudgetPixels: stats.hardBudgetPixels,
        hardBudgetMB,
        degraded: Boolean(page1?.degraded),
        downsampledPlaceholder: Boolean(page1?.downsampledPlaceholder),
        dpr: page1 ? Number(page1.dpr.toFixed(4)) : 0,
        targetDpr: page1 ? Number(page1.targetDpr.toFixed(4)) : 0,
        flashFrames,
        maxWhiteRatio,
        maxJump,
        samples: ratios.length,
        afterScrollCachedPages: afterScroll.cachedPages,
        afterScrollMB: toMB(afterScroll.currentTotalPixels),
      };
    } finally {
      await view.onClose();
      view.containerEl.remove();
    }
  };

  try {
    const matrix: any[] = [];
    for (const tier of ["desktop", "mobile"] as const) {
      for (const pageType of ["normal-a4", "folded-a4", "rotated-a4", "spread-a4"] as const) {
        matrix.push(await runCase(tier, pageType));
      }
    }
    return { passed: true, dprSimulated: 2, matrix };
  } finally {
    Platform.isMobile = origIsMobile;
    if (origDprDesc) Object.defineProperty(window, "devicePixelRatio", origDprDesc);
  }
};

// ===== PZ-09: True canvas pixel audit (A4 spread DPR=3 & mobile 14000pt@400%) + 3 allocation failure injections =====
(window as any).runPZ09BudgetAuditAndAllocFailures = async () => {
  const origIsMobile = Platform.isMobile;
  const origDprDesc = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  const origCreateElement = document.createElement.bind(document);
  const origWidthDesc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width")!;
  const origHeightDesc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "height")!;
  const origGetContext = HTMLCanvasElement.prototype.getContext;

  const sampleCanvas = origCreateElement("canvas");
  sampleCanvas.width = 64;
  sampleCanvas.height = 80;
  const sampleCtx = origGetContext.call(sampleCanvas, "2d", { willReadFrequently: true }) as CanvasRenderingContext2D;

  const WHITE_FLASH_RATIO_THRESHOLD = 0.98;
  const WHITE_FLASH_JUMP_THRESHOLD = 0.25;
  const MAX_ALLOWED_WHITE_RATIO = 0.90;

  const measureWhiteRatio = (view: ReaderView, pageNum: number): number => {
    const rec = view.getPageRecord(pageNum);
    if (!rec) return 1;
    const wRect = rec.wrapper.getBoundingClientRect();
    const cRect = rec.canvas.getBoundingClientRect();
    sampleCtx.fillStyle = "#ffffff";
    sampleCtx.fillRect(0, 0, sampleCanvas.width, sampleCanvas.height);
    if (rec.canvas.width > 0 && rec.canvas.height > 0 && wRect.width > 0 && wRect.height > 0 && cRect.width > 0 && cRect.height > 0) {
      const dx = ((cRect.left - wRect.left) / wRect.width) * sampleCanvas.width;
      const dy = ((cRect.top - wRect.top) / wRect.height) * sampleCanvas.height;
      const dw = (cRect.width / wRect.width) * sampleCanvas.width;
      const dh = (cRect.height / wRect.height) * sampleCanvas.height;
      sampleCtx.drawImage(rec.canvas, 0, 0, rec.canvas.width, rec.canvas.height, dx, dy, dw, dh);
    }
    const data = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    let white = 0;
    const total = sampleCanvas.width * sampleCanvas.height;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] >= 245 && data[i + 1] >= 245 && data[i + 2] >= 245) white++;
    }
    return Number((white / total).toFixed(4));
  };

  // Independent live canvas pixel tracker: intercepts all non-sampler canvases created during each audit
  let trackedCanvases = new Set<HTMLCanvasElement>();
  let measuredPeakPixels = 0;
  let trackingActive = false;
  const updateMeasuredPeak = () => {
    if (!trackingActive) return;
    let sum = 0;
    for (const c of trackedCanvases) {
      if (c.classList.contains("ms-ink-raster")) continue;
      const w = origWidthDesc.get!.call(c);
      const h = origHeightDesc.get!.call(c);
      if (w > 0 && h > 0) sum += w * h;
    }
    if (sum > measuredPeakPixels) measuredPeakPixels = sum;
  };

  // Injection modes for negative allocation failure tests
  let failMode: "none" | "getContext-null" | "size-silent-fail" | "size-throw" = "none";
  let failTriggered = 0;

  (document as any).createElement = function (tag: string, options?: any) {
    const el = origCreateElement(tag, options);
    if (trackingActive && tag.toLowerCase() === "canvas") trackedCanvases.add(el as HTMLCanvasElement);
    return el;
  };
  Object.defineProperty(HTMLCanvasElement.prototype, "width", {
    configurable: true,
    get() { return origWidthDesc.get!.call(this); },
    set(v: number) {
      if (this !== sampleCanvas && v > 0) {
        if (failMode === "size-throw") { failTriggered++; throw new RangeError("Injected canvas width allocation error"); }
        if (failMode === "size-silent-fail") { failTriggered++; origWidthDesc.set!.call(this, 0); updateMeasuredPeak(); return; }
      }
      origWidthDesc.set!.call(this, v);
      updateMeasuredPeak();
    },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "height", {
    configurable: true,
    get() { return origHeightDesc.get!.call(this); },
    set(v: number) {
      if (this !== sampleCanvas && v > 0) {
        if (failMode === "size-throw") { failTriggered++; throw new RangeError("Injected canvas height allocation error"); }
        if (failMode === "size-silent-fail") { failTriggered++; origHeightDesc.set!.call(this, 0); updateMeasuredPeak(); return; }
      }
      origHeightDesc.set!.call(this, v);
      updateMeasuredPeak();
    },
  });
  HTMLCanvasElement.prototype.getContext = function (type: any, attrs?: any) {
    if (this !== sampleCanvas && type === "2d" && failMode === "getContext-null") {
      failTriggered++;
      return null;
    }
    return origGetContext.call(this, type, attrs);
  } as any;

  const toMB = (px: number) => Number(((px * 4) / (1024 * 1024)).toFixed(2));

  try {
    // --- Audit A: Real A4 spread at DPR=3 (hard budget 16M px) ---
    Platform.isMobile = false;
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => 3 });
    trackedCanvases = new Set();
    measuredPeakPixels = 0;
    trackingActive = true;
    const spreadAudit = await (async () => {
      const pdfPath = "pz09-spread-dpr3.pdf";
      const { view } = await openReader(
        { [pdfPath]: { name: "spread-dpr3", pages: 4, crop: [0, 0, 595, 842], renderDelay: 60, textDelay: 10, paintContent: true } },
        pdfPath,
      );
      try {
        await view.setPageLayout("spread", false);
        await waitPagesRendered(view, [1, 2], view.getScale());
        (view as any).visiblePages.add(1);
        (view as any).visiblePages.add(2);
        // Reset both product peak & external measured peak right before extreme zoom
        view.resetMemoryPeak();
        measuredPeakPixels = 0;
        updateMeasuredPeak();
        // Zoom to 4.0 then to 3.5 to stress consecutive spread re-renders under tight budget
        view.setScale(4.0);
        await waitPagesRendered(view, [1, 2], 4.0);
        view.setScale(3.5);
        await waitPagesRendered(view, [1, 2], 3.5);
        await frame();
        const stats = view.getMemoryStats();
        return {
          scenario: "desktop-spread-a4-dpr3",
          reportedPeakPixels: stats.peakTotalPixels,
          measuredPeakPixels,
          deltaPixels: measuredPeakPixels - stats.peakTotalPixels,
          reportedPeakMB: toMB(stats.peakTotalPixels),
          measuredPeakMB: toMB(measuredPeakPixels),
          hardBudgetPixels: stats.hardBudgetPixels,
          hardBudgetMB: toMB(stats.hardBudgetPixels),
          withinBudget: measuredPeakPixels <= stats.hardBudgetPixels && stats.peakTotalPixels <= stats.hardBudgetPixels,
          noUnderreport: stats.peakTotalPixels >= measuredPeakPixels,
        };
      } finally {
        await view.onClose();
        view.containerEl.remove();
      }
    })();
    trackingActive = false;

    // --- Audit B: Mobile 14000pt x 14000pt square page @ 400% (hard budget 4M px) ---
    Platform.isMobile = true;
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => 2 });
    trackedCanvases = new Set();
    measuredPeakPixels = 0;
    trackingActive = true;
    const hugeSquareAudit = await (async () => {
      const pdfPath = "pz09-mobile-14000pt.pdf";
      const { view } = await openReader(
        { [pdfPath]: { name: "mobile-14000pt", pages: 2, crop: [0, 0, 14000, 14000], renderDelay: 60, textDelay: 10, paintContent: true } },
        pdfPath,
      );
      try {
        await view.renderPage(1);
        await frame();
        (view as any).visiblePages.add(1);
        view.resetMemoryPeak();
        measuredPeakPixels = 0;
        updateMeasuredPeak();
        const ratios: number[] = [];
        let sampling = true;
        ratios.push(measureWhiteRatio(view, 1));
        const tick = () => { if (!sampling) return; ratios.push(measureWhiteRatio(view, 1)); requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        try {
          view.setScale(4.0);
          await wait(200);
          await frame();
        } finally {
          sampling = false;
        }
        let flashFrames = 0, maxWhiteRatio = 0, maxJump = 0;
        for (let i = 0; i < ratios.length; i++) {
          if (ratios[i] > maxWhiteRatio) maxWhiteRatio = ratios[i];
          if (i > 0) {
            const j = Number((ratios[i] - ratios[i - 1]).toFixed(4));
            if (j > maxJump) maxJump = j;
            if (ratios[i] >= WHITE_FLASH_RATIO_THRESHOLD && j >= WHITE_FLASH_JUMP_THRESHOLD) flashFrames++;
          }
        }
        const stats = view.getMemoryStats();
        const p1 = stats.pages[1];
        return {
          scenario: "mobile-14000pt-400pct",
          reportedPeakPixels: stats.peakTotalPixels,
          measuredPeakPixels,
          deltaPixels: measuredPeakPixels - stats.peakTotalPixels,
          reportedPeakMB: toMB(stats.peakTotalPixels),
          measuredPeakMB: toMB(measuredPeakPixels),
          hardBudgetPixels: stats.hardBudgetPixels,
          hardBudgetMB: toMB(stats.hardBudgetPixels),
          skippedDoubleBuffer: Boolean((p1 as any)?.skippedDoubleBuffer),
          dpr: p1 ? Number(p1.dpr.toFixed(5)) : 0,
          flashFrames,
          maxWhiteRatio,
          maxJump,
          withinBudget: measuredPeakPixels <= stats.hardBudgetPixels && stats.peakTotalPixels <= stats.hardBudgetPixels,
          noUnderreport: stats.peakTotalPixels >= measuredPeakPixels,
        };
      } finally {
        await view.onClose();
        view.containerEl.remove();
      }
    })();
    trackingActive = false;

    // --- Audit C: 3 Allocation Failure Injections (getContext=null, size-silent-fail, size-throw) ---
    // Use tight budget pressure (mobile + 2 visible pages at max scale so placeholder downsample is also exercised)
    const runAllocFailureCase = async (mode: "getContext-null" | "size-silent-fail" | "size-throw") => {
      Platform.isMobile = true;
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => 2 });
      const pdfPath = \`pz09-fail-\${mode}.pdf\`;
      const { view } = await openReader(
        { [pdfPath]: { name: \`fail-\${mode}\`, pages: 2, crop: [0, 0, 595, 842], renderDelay: 60, textDelay: 10, paintContent: true } },
        pdfPath,
      );
      try {
        await view.setPageLayout("spread", false);
        await waitPagesRendered(view, [1, 2], view.getScale());
        (view as any).visiblePages.add(1);
        (view as any).visiblePages.add(2);
        // First zoom to 4.0 so both pages fill the mobile budget (triggering placeholder downsample path on next zoom)
        view.setScale(4.0);
        await waitPagesRendered(view, [1, 2], 4.0);
        await frame();

        const prevCanvas = view.getPageRecord(1)!.canvas;
        const prevScale = view.getPageRecord(1)!.renderedScale;
        const baselineWhiteRatio = measureWhiteRatio(view, 1);

        failTriggered = 0;
        failMode = mode;
        const ratios: number[] = [baselineWhiteRatio];
        let sampling = true;
        const tick = () => { if (!sampling) return; ratios.push(measureWhiteRatio(view, 1)); requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        try {
          view.setScale(3.2);
          await wait(160);
          await frame();
        } finally {
          sampling = false;
          failMode = "none";
        }

        let flashFrames = 0, maxWhiteRatio = 0, maxJump = 0;
        for (let i = 0; i < ratios.length; i++) {
          if (ratios[i] > maxWhiteRatio) maxWhiteRatio = ratios[i];
          if (i > 0) {
            const j = Number((ratios[i] - ratios[i - 1]).toFixed(4));
            if (j > maxJump) maxJump = j;
            if (ratios[i] >= WHITE_FLASH_RATIO_THRESHOLD && j >= WHITE_FLASH_JUMP_THRESHOLD) flashFrames++;
          }
        }
        const recAfter = view.getPageRecord(1)!;
        const domPreserved = recAfter.canvas === prevCanvas && recAfter.canvas.width > 0 && recAfter.canvas.height > 0;
        const pendingRerender = recAfter.renderedScale === prevScale && recAfter.renderedScale !== 3.2;

        return {
          mode,
          failTriggered,
          baselineWhiteRatio,
          maxWhiteRatio,
          maxJump,
          flashFrames,
          samples: ratios.length,
          domPreserved,
          pendingRerender,
        };
      } finally {
        failMode = "none";
        await view.onClose();
        view.containerEl.remove();
      }
    };

    const failGetContext = await runAllocFailureCase("getContext-null");
    const failSilentSize = await runAllocFailureCase("size-silent-fail");
    const failThrowSize = await runAllocFailureCase("size-throw");

    const failures: string[] = [];
    if (!spreadAudit.withinBudget) failures.push(\`[spread-dpr3] exceeded hard budget: measured=\${spreadAudit.measuredPeakPixels}px (\${spreadAudit.measuredPeakMB}MB), reported=\${spreadAudit.reportedPeakPixels}px, hard=\${spreadAudit.hardBudgetPixels}px\`);
    if (!spreadAudit.noUnderreport) failures.push(\`[spread-dpr3] reported peak underreported: reported=\${spreadAudit.reportedPeakPixels}px < measured=\${spreadAudit.measuredPeakPixels}px (delta=\${spreadAudit.deltaPixels}px)\`);
    if (!hugeSquareAudit.withinBudget) failures.push(\`[mobile-14000pt] exceeded hard budget: measured=\${hugeSquareAudit.measuredPeakPixels}px (\${hugeSquareAudit.measuredPeakMB}MB), reported=\${hugeSquareAudit.reportedPeakPixels}px, hard=\${hugeSquareAudit.hardBudgetPixels}px\`);
    if (!hugeSquareAudit.noUnderreport) failures.push(\`[mobile-14000pt] reported peak underreported: reported=\${hugeSquareAudit.reportedPeakPixels}px < measured=\${hugeSquareAudit.measuredPeakPixels}px\`);
    if (!(hugeSquareAudit.flashFrames === 0 && hugeSquareAudit.maxWhiteRatio < MAX_ALLOWED_WHITE_RATIO)) failures.push(\`[mobile-14000pt] white flash: flashFrames=\${hugeSquareAudit.flashFrames}, maxWhiteRatio=\${hugeSquareAudit.maxWhiteRatio}\`);
    for (const f of [failGetContext, failSilentSize, failThrowSize]) {
      if (!(f.failTriggered > 0)) failures.push(\`[\${f.mode}] failure injection was not triggered\`);
      if (!(f.flashFrames === 0 && f.maxWhiteRatio < MAX_ALLOWED_WHITE_RATIO)) failures.push(\`[\${f.mode}] white flash on alloc fail: flashFrames=\${f.flashFrames}, baseline=\${f.baselineWhiteRatio}, maxWhiteRatio=\${f.maxWhiteRatio}, maxJump=\${f.maxJump}\`);
      if (!f.domPreserved) failures.push(\`[\${f.mode}] old canvas replaced/cleared\`);
      if (!f.pendingRerender) failures.push(\`[\${f.mode}] page not kept pending re-render\`);
    }
    if (failures.length) throw new Error("PZ-09 failed:\\n  - " + failures.join("\\n  - "));

    return {
      passed: true,
      reconciliation: [spreadAudit, hugeSquareAudit],
      allocationFailures: [failGetContext, failSilentSize, failThrowSize],
    };
  } finally {
    trackingActive = false;
    failMode = "none";
    (document as any).createElement = origCreateElement;
    Object.defineProperty(HTMLCanvasElement.prototype, "width", origWidthDesc);
    Object.defineProperty(HTMLCanvasElement.prototype, "height", origHeightDesc);
    HTMLCanvasElement.prototype.getContext = origGetContext;
    Platform.isMobile = origIsMobile;
    if (origDprDesc) Object.defineProperty(window, "devicePixelRatio", origDprDesc);
  }
};

// ===== PZ-10: Cross-page eviction release-before-writeoff + Readability floor & <=500ms idle auto-upgrade =====
(window as any).runPZ10EvictionOrderAndIdleUpgrade = async () => {
  const origIsMobile = Platform.isMobile;
  const origDprDesc = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  const origCreateElement = document.createElement.bind(document);
  const origWidthDesc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width")!;
  const origHeightDesc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "height")!;
  const origGetContext = HTMLCanvasElement.prototype.getContext;

  const sampleCanvas = origCreateElement("canvas");
  sampleCanvas.width = 160;
  sampleCanvas.height = 160;
  const sampleCtx = origGetContext.call(sampleCanvas, "2d", { willReadFrequently: true }) as CanvasRenderingContext2D;

  // Measure both white ratio and high-frequency edge gradient (mean horizontal+vertical luma delta) of rendered canvas
  const measureCanvasQuality = (canvas: HTMLCanvasElement): { width: number; height: number; whiteRatio: number; edgeEnergy: number } => {
    const w = origWidthDesc.get!.call(canvas);
    const h = origHeightDesc.get!.call(canvas);
    if (w <= 0 || h <= 0) return { width: 0, height: 0, whiteRatio: 1, edgeEnergy: 0 };
    sampleCtx.fillStyle = "#ffffff";
    sampleCtx.fillRect(0, 0, sampleCanvas.width, sampleCanvas.height);
    sampleCtx.drawImage(canvas, 0, 0, w, h, 0, 0, sampleCanvas.width, sampleCanvas.height);
    const data = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    const sw = sampleCanvas.width, sh = sampleCanvas.height;
    let white = 0;
    let gradSum = 0;
    let gradCount = 0;
    const luma = (idx: number) => 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const idx = (y * sw + x) * 4;
        if (data[idx] >= 245 && data[idx + 1] >= 245 && data[idx + 2] >= 245) white++;
        if (x + 1 < sw && y + 1 < sh) {
          const l0 = luma(idx);
          const lx = luma(idx + 4);
          const ly = luma(idx + sw * 4);
          gradSum += Math.abs(l0 - lx) + Math.abs(l0 - ly);
          gradCount++;
        }
      }
    }
    return {
      width: w,
      height: h,
      whiteRatio: Number((white / (sw * sh)).toFixed(4)),
      edgeEnergy: Number((gradSum / Math.max(1, gradCount)).toFixed(2)),
    };
  };

  let trackedCanvases = new Set<HTMLCanvasElement>();
  let measuredPeakPixels = 0;
  let trackingActive = false;
  const computeLivePixels = () => {
    let sum = 0;
    for (const c of trackedCanvases) {
      if (c.classList.contains("ms-ink-raster")) continue;
      const w = origWidthDesc.get!.call(c);
      const h = origHeightDesc.get!.call(c);
      if (w > 0 && h > 0) sum += w * h;
    }
    return sum;
  };
  const updateMeasuredPeak = () => {
    if (!trackingActive) return;
    const sum = computeLivePixels();
    if (sum > measuredPeakPixels) measuredPeakPixels = sum;
  };

  (document as any).createElement = function (tag: string, options?: any) {
    const el = origCreateElement(tag, options);
    if (trackingActive && tag.toLowerCase() === "canvas") trackedCanvases.add(el as HTMLCanvasElement);
    return el;
  };
  Object.defineProperty(HTMLCanvasElement.prototype, "width", {
    configurable: true,
    get() { return origWidthDesc.get!.call(this); },
    set(v: number) { origWidthDesc.set!.call(this, v); updateMeasuredPeak(); },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "height", {
    configurable: true,
    get() { return origHeightDesc.get!.call(this); },
    set(v: number) { origHeightDesc.set!.call(this, v); updateMeasuredPeak(); },
  });

  try {
    // --- Part A: Cross-page eviction of 3+ pages while page 4 has an in-flight offscreen buffer (Mobile 4M hard cap) ---
    Platform.isMobile = true;
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => 2 });
    trackedCanvases = new Set();
    measuredPeakPixels = 0;
    trackingActive = true;
    const evictionAudit = await (async () => {
      const pdfPath = "pz10-eviction-order.pdf";
      const { view } = await openReader(
        { [pdfPath]: { name: "evict-order", pages: 6, crop: [0, 0, 595, 842], renderDelay: 90, textDelay: 10, paintContent: true } },
        pdfPath,
      );
      try {
        // Pre-render pages 1, 2, 3 at scale 1.4 (~1.5M px each under mobile budget -> fills 4M hard cap)
        (view as any).visiblePages.clear();
        for (const p of [1, 2, 3]) {
          (view as any).visiblePages.add(p);
          await view.renderPage(p);
        }
        view.resetMemoryPeak();
        measuredPeakPixels = computeLivePixels();

        const frameTrace: { step: string; livePixels: number; reportedPixels: number }[] = [];
        const recordStep = (step: string) => {
          frameTrace.push({
            step,
            livePixels: computeLivePixels(),
            reportedPixels: view.getMemoryStats().currentTotalPixels,
          });
        };
        recordStep("before-inflight-p4");

        // Start in-flight offscreen render on page 4 (~1M+ px allocated), then immediately evict pages 1, 2, 3, 4 by jumping to page 5 & 6
        (view as any).visiblePages.clear();
        (view as any).visiblePages.add(4);
        const p4Promise = view.renderPage(4);
        await wait(25); // allow page 4 to allocate its offscreen bufferCanvas while page.render is still pending
        recordStep("p4-inflight-allocated");

        // Now switch visibility to page 5 (triggers cross-page eviction of pages 1, 2, 3, 4 including in-flight page 4!)
        (view as any).visiblePages.clear();
        (view as any).visiblePages.add(5);
        const p5Promise = view.renderPage(5);
        await wait(25);
        recordStep("p5-allocated-after-evict");

        (view as any).visiblePages.clear();
        (view as any).visiblePages.add(6);
        const p6Promise = view.renderPage(6);
        await Promise.allSettled([p4Promise, p5Promise, p6Promise]);
        await frame();
        recordStep("after-all-settled");

        const stats = view.getMemoryStats();
        return {
          hardBudgetPixels: stats.hardBudgetPixels,
          measuredPeakPixels,
          reportedPeakPixels: stats.peakTotalPixels,
          deltaPixels: measuredPeakPixels - stats.peakTotalPixels,
          withinBudget: measuredPeakPixels <= stats.hardBudgetPixels && stats.peakTotalPixels <= stats.hardBudgetPixels,
          noUnderreport: stats.peakTotalPixels >= measuredPeakPixels,
          frameTrace,
        };
      } finally {
        await view.onClose();
        view.containerEl.remove();
      }
    })();
    trackingActive = false;

    // --- Part B: Readability floor (14000pt@400% must NOT destroy old 1414x1414 into 353x353 smudge) ---
    Platform.isMobile = true;
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => 2 });
    const readabilityAudit = await (async () => {
      const pdfPath = "pz10-readability-14000pt.pdf";
      const { view } = await openReader(
        { [pdfPath]: { name: "readability-14000", pages: 2, crop: [0, 0, 14000, 14000], renderDelay: 50, textDelay: 10, paintContent: true } },
        pdfPath,
      );
      try {
        await view.renderPage(1);
        await frame();
        (view as any).visiblePages.add(1);
        const before = measureCanvasQuality(view.getPageRecord(1)!.canvas);
        view.setScale(4.0);
        await wait(160);
        await frame();
        const after = measureCanvasQuality(view.getPageRecord(1)!.canvas);
        return {
          beforeWidth: before.width,
          beforeHeight: before.height,
          beforeEdgeEnergy: before.edgeEnergy,
          afterWidth: after.width,
          afterHeight: after.height,
          afterEdgeEnergy: after.edgeEnergy,
          afterWhiteRatio: after.whiteRatio,
          preservedResolution: after.width >= Math.floor(before.width * 0.8) && after.height >= Math.floor(before.height * 0.8),
          readableEdgeEnergy: after.edgeEnergy >= 8.0,
        };
      } finally {
        await view.onClose();
        view.containerEl.remove();
      }
    })();

    // --- Part C: TRUE automatic idle upgrade within <=500ms (NO explicit renderPage / internal upgrade calls!) ---
    Platform.isMobile = true;
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => 2 });
    const idleUpgradeAudit = await (async () => {
      const pdfPath = "pz10-idle-upgrade.pdf";
      const { view } = await openReader(
        { [pdfPath]: { name: "idle-upgrade", pages: 4, crop: [0, 0, 595, 842], renderDelay: 50, textDelay: 10, paintContent: true } },
        pdfPath,
      );
      try {
        await view.setPageLayout("spread", false);
        await waitPagesRendered(view, [1, 2], view.getScale());
        const scrollEl = view.getScrollContainer();

        // Position scroll at the seam between page 1 and page 2 so real IntersectionObserver sees BOTH [1, 2]
        view.setScale(4.0);
        const rec1 = view.getPageRecord(1)!;
        const seamLeft = Math.max(0, rec1.wrapper.offsetLeft + rec1.wrapper.offsetWidth - scrollEl.clientWidth / 2);
        scrollEl.scrollLeft = seamLeft;
        await waitPagesRendered(view, [1, 2], 4.0);
        await frame();
        const dprDuringSpread = view.getMemoryStats().pages[1]?.dpr ?? 0;

        // Real user horizontal scroll left to bring only page 1 into viewport (pushes page 2 out of viewport)
        // STRICT RULE: Do NOT call renderPage(), runIdleUpgrade(), or mutate visiblePages manually!
        const eventsBefore = pdfEvents.length;
        const t0 = performance.now();
        scrollEl.scrollLeft = 0;
        scrollEl.dispatchEvent(new Event("scroll"));

        let upgradedAtMs = -1;
        let finalDpr = dprDuringSpread;
        const targetSingleDpr = Math.min(1.25, Math.sqrt(2_000_000 / (595 * 4 * 842 * 4)));
        while (performance.now() - t0 <= 500) {
          finalDpr = view.getMemoryStats().pages[1]?.dpr ?? 0;
          if (finalDpr >= targetSingleDpr - 0.02 && !view.getPageRecord(1)?.renderPromise) {
            upgradedAtMs = Math.round(performance.now() - t0);
            break;
          }
          await wait(20);
        }
        const qualityAfterUpgrade = measureCanvasQuality(view.getPageRecord(1)!.canvas);
        const upgradeRenderCount = pdfEvents.slice(eventsBefore).filter(e => e[0] === "render" && e[1] === "idle-upgrade" && e[2] === 1).length;
        return {
          trigger: "real-horizontal-scroll-spread-to-single-visible",
          dprDuringSpread: Number(dprDuringSpread.toFixed(4)),
          targetSingleDpr: Number(targetSingleDpr.toFixed(4)),
          finalDpr: Number(finalDpr.toFixed(4)),
          upgradedWithin500ms: upgradedAtMs >= 0 && upgradedAtMs <= 500 && upgradeRenderCount >= 1,
          upgradedAtMs,
          upgradeRenderCount,
          afterUpgradeWidth: qualityAfterUpgrade.width,
          afterUpgradeHeight: qualityAfterUpgrade.height,
          afterUpgradeEdgeEnergy: qualityAfterUpgrade.edgeEnergy,
        };
      } finally {
        await view.onClose();
        view.containerEl.remove();
      }
    })();

    // --- Part D: Folding page 2 in spread auto-upgrades page 1 within <=500ms (NO explicit renderPage!) ---
    Platform.isMobile = true;
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => 2 });
    const foldUpgradeAudit = await (async () => {
      const pdfPath = "pz10-fold-upgrade.pdf";
      const { view } = await openReader(
        { [pdfPath]: { name: "fold-upgrade", pages: 2, crop: [0, 0, 595, 842], renderDelay: 40, textDelay: 10, paintContent: true } },
        pdfPath,
      );
      try {
        await view.setPageLayout("spread", false);
        await waitPagesRendered(view, [1, 2], view.getScale());
        const scrollEl = view.getScrollContainer();
        view.setScale(4.0);
        const rec1 = view.getPageRecord(1)!;
        const rec2 = view.getPageRecord(2)!;
        scrollEl.scrollLeft = Math.max(0, rec1.wrapper.offsetLeft + rec1.wrapper.offsetWidth - scrollEl.clientWidth / 2);
        await waitPagesRendered(view, [1, 2], 4.0);
        await frame();
        const dprBefore = view.getMemoryStats().pages[1]?.dpr ?? 0;
        const widthBefore = rec1.canvas.width;

        const eventsBefore = pdfEvents.length;
        const t0 = performance.now();
        // Real UI click on page 2's fold button (page 2 remains in viewport as a folded bar, so visiblePages still contains 2)
        rec2.wrapper.querySelector<HTMLButtonElement>(".ms-page-btn")!.click();

        let upgradedAtMs = -1;
        let finalDpr = dprBefore;
        const targetSingleDpr = Math.min(1.25, Math.sqrt(2_000_000 / (595 * 4 * 842 * 4)));
        while (performance.now() - t0 <= 500) {
          finalDpr = view.getMemoryStats().pages[1]?.dpr ?? 0;
          if (finalDpr >= targetSingleDpr - 0.02 && !rec1.renderPromise) {
            upgradedAtMs = Math.round(performance.now() - t0);
            break;
          }
          await wait(20);
        }
        const renderCount = pdfEvents.slice(eventsBefore).filter(e => e[0] === "render" && e[1] === "fold-upgrade" && e[2] === 1).length;
        return {
          widthBefore,
          widthAfter: rec1.canvas.width,
          dprBefore: Number(dprBefore.toFixed(4)),
          finalDpr: Number(finalDpr.toFixed(4)),
          targetSingleDpr: Number(targetSingleDpr.toFixed(4)),
          upgradedWithin500ms: upgradedAtMs >= 0 && upgradedAtMs <= 500 && renderCount === 1,
          upgradedAtMs,
          renderCount,
        };
      } finally {
        await view.onClose();
        view.containerEl.remove();
      }
    })();

    // --- Part E: Already-at-cap folded A4 page must NOT redundantly re-render on scroll / visibilitychange ---
    Platform.isMobile = true;
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => 2 });
    const noRedundantFoldRenderAudit = await (async () => {
      const pdfPath = "pz10-folded-no-redundancy.pdf";
      const { view, store } = await openReader(
        { [pdfPath]: { name: "folded-cap", pages: 1, crop: [0, 0, 595, 842], renderDelay: 30, textDelay: 5, paintContent: true } },
        pdfPath,
      );
      try {
        store.updateDocMeta(pdfPath, {
          pdfRegionFolds: [{ id: "fold-cap-1", pageId: view.getPdfPageId(1), rects: [{ x: 0, y: 120, w: 595, h: 600 }] }],
        });
        await view.refreshExtendLayout();
        view.setScale(4.0);
        await waitPagesRendered(view, [1], 4.0);
        await wait(160);
        const rec1 = view.getPageRecord(1)!;
        const canvasBefore = rec1.canvas;
        const dprBefore = view.getMemoryStats().pages[1]?.dpr ?? 0;
        const scrollEl = view.getScrollContainer();

        const eventsBefore = pdfEvents.length;
        for (let i = 1; i <= 4; i++) {
          scrollEl.scrollTop = i * 8;
          scrollEl.dispatchEvent(new Event("scroll"));
          await wait(15);
        }
        await wait(220);
        for (let i = 0; i < 3; i++) {
          document.dispatchEvent(new Event("visibilitychange"));
          await wait(160);
        }
        const redundantRenders = pdfEvents.slice(eventsBefore).filter(e => e[0] === "render" && e[1] === "folded-cap" && e[2] === 1).length;
        return {
          dprBefore: Number(dprBefore.toFixed(4)),
          dprAfter: Number((view.getMemoryStats().pages[1]?.dpr ?? 0).toFixed(4)),
          canvasSwapped: rec1.canvas !== canvasBefore,
          redundantRenders,
        };
      } finally {
        await view.onClose();
        view.containerEl.remove();
      }
    })();

    const failures: string[] = [];
    if (!evictionAudit.withinBudget) failures.push(\`[eviction-order] exceeded 4M hard budget: measured=\${evictionAudit.measuredPeakPixels}px, reported=\${evictionAudit.reportedPeakPixels}px, hard=\${evictionAudit.hardBudgetPixels}px\`);
    if (!evictionAudit.noUnderreport) failures.push(\`[eviction-order] writeoff before release underreported: reported=\${evictionAudit.reportedPeakPixels}px < measured=\${evictionAudit.measuredPeakPixels}px (delta=\${evictionAudit.deltaPixels}px)\`);
    if (!readabilityAudit.preservedResolution) failures.push(\`[readability-14000pt] old canvas destroyed: \${readabilityAudit.beforeWidth}x\${readabilityAudit.beforeHeight} -> \${readabilityAudit.afterWidth}x\${readabilityAudit.afterHeight}\`);
    if (!readabilityAudit.readableEdgeEnergy) failures.push(\`[readability-14000pt] text smudged: edgeEnergy=\${readabilityAudit.afterEdgeEnergy} < 8.0\`);
    if (!idleUpgradeAudit.upgradedWithin500ms) failures.push(\`[idle-upgrade-auto] did not auto-upgrade within 500ms: renders=\${idleUpgradeAudit.upgradeRenderCount}, spreadDpr=\${idleUpgradeAudit.dprDuringSpread}, finalDpr=\${idleUpgradeAudit.finalDpr}, target=\${idleUpgradeAudit.targetSingleDpr}\`);
    if (!foldUpgradeAudit.upgradedWithin500ms) failures.push(\`[fold-upgrade-auto] folding page 2 did not auto-upgrade page 1 within 500ms: renders=\${foldUpgradeAudit.renderCount}, dpr=\${foldUpgradeAudit.dprBefore}->\${foldUpgradeAudit.finalDpr}, target=\${foldUpgradeAudit.targetSingleDpr}\`);
    if (noRedundantFoldRenderAudit.redundantRenders !== 0 || noRedundantFoldRenderAudit.canvasSwapped) failures.push(\`[folded-no-redundancy] at-cap folded page redundantly re-rendered: renders=\${noRedundantFoldRenderAudit.redundantRenders}, swapped=\${noRedundantFoldRenderAudit.canvasSwapped}\`);
    if (failures.length) throw new Error("PZ-10 failed:\\n  - " + failures.join("\\n  - "));

    return { passed: true, evictionAudit, readabilityAudit, idleUpgradeAudit, foldUpgradeAudit, noRedundantFoldRenderAudit };
  } finally {
    trackingActive = false;
    (document as any).createElement = origCreateElement;
    Object.defineProperty(HTMLCanvasElement.prototype, "width", origWidthDesc);
    Object.defineProperty(HTMLCanvasElement.prototype, "height", origHeightDesc);
    Platform.isMobile = origIsMobile;
    if (origDprDesc) Object.defineProperty(window, "devicePixelRatio", origDprDesc);
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
        .replace("render({canvasContext,viewport}:any){", "render({canvasContext,viewport,transform}:any){")
        .replace("canvasContext.fillStyle='#fff';canvasContext.fillRect(0,0,viewport.width,viewport.height);canvasContext.fillStyle='#222';canvasContext.fillText(config.name+' page '+num,20,30);", "canvasContext.save();if(transform)canvasContext.transform(transform[0],transform[1],transform[2],transform[3],transform[4],transform[5]);canvasContext.fillStyle='#fff';canvasContext.fillRect(0,0,viewport.width,viewport.height);canvasContext.fillStyle='#222';if(config.paintContent){for(let r=0;r<8;r++){canvasContext.fillRect(viewport.width*0.08,viewport.height*(0.06+r*0.115),viewport.width*0.84,viewport.height*0.065);}}canvasContext.fillText(config.name+' page '+num,20,30);canvasContext.restore();")
        .replace(/getViewport\(\{scale\}:\{scale:number\}\)\{[\s\S]*?return \{[\s\S]*?\};\s*\}/, `getViewport({scale}:{scale:number}){ const viewBox=config.crop||[0,0,600,800]; const rotation=config.rotations?.[num-1]??config.rotation??0; return new FakeViewport({viewBox,scale,rotation}); }`);
    }
    await writeFile(join(temporary, name + ".ts"), src);
  }
  await writeFile(join(temporary, "unused-network.ts"), "export function request(){throw new Error('offline');}");
  await writeFile(join(temporary, "crypto.ts"), "export function createHash(){return{update(){return this;},digest(){return '0000000000000000';}};}");
  await writeFile(join(temporary, "pinch-fixture.ts"), fixtureSource);

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
    '<!doctype html><meta charset="utf-8"><title>MarginStudy PDF pinch-zoom acceptance</title><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0;height:100%}#fixtures{position:relative;width:100vw;height:100vh;overflow:hidden}</style><main id="fixtures"></main><script type="module" src="/fixture.js"></script>',
  );

  await build({
    entryPoints: [join(temporary, "pinch-fixture.ts")],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "chrome120",
    outfile: join(temporary, "fixture.js"),
    plugins: [{
      name: "pinch-adapters",
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
  const session = `marginstudy-pdf-pinch-${process.pid}`;
  const browser = (...args) => runBrowser(session, ...args);

  let head = "unknown";
  try { head = (await exec("git", ["rev-parse", "--short", "HEAD"], { cwd: project })).stdout.trim(); } catch { /* ignore */ }

  try {
    await browser("open", "about:blank");
    await browser("set", "viewport", "1024", "768");
    await browser("open", `http://127.0.0.1:${server.address().port}`);
    await browser("wait", "--fn", "window.ready === true");

    const evalJson = async expr => JSON.parse((await browser("eval", expr)).stdout);

    // Run full PZ-01..PZ-06 in 1024x768 (landscape Pad)
    const pz01 = await evalJson("window.runPZ01()");
    const pz02Landscape = await evalJson("window.runPZ02()");
    const pz03 = await evalJson("window.runPZ03()");
    const pz04 = await evalJson("window.runPZ04()");
    const pz05 = await evalJson("window.runPZ05()");
    const pz06 = await evalJson("window.runPZ06()");
    const pz07 = await evalJson("window.runPZ07NoWhiteFlash()");
    const pz08 = await evalJson("window.runPZ08MemoryBudgetMatrix()");
    const pz09 = await evalJson("window.runPZ09BudgetAuditAndAllocFailures()");
    const pz10 = await evalJson("window.runPZ10EvictionOrderAndIdleUpgrade()");

    // Native CDP Input.dispatchTouchEvent smoke test
    const cdpInit = await evalJson("window.setupCdpTouchSmoke()");
    if (!cdpInit.touchAction.includes("pan-x") || !cdpInit.touchAction.includes("pan-y")) {
      throw new Error(`Expected scrollEl touch-action to contain pan-x pan-y, got: ${cdpInit.touchAction}`);
    }
    const { cx, cy } = cdpInit;
    // Send trusted 2-finger pinch over a single CDP WebSocket session so Chromium tracks active touch points across start/move/end
    const browserUrl = (await browser("get", "cdp-url")).stdout.trim();
    const pageUrl = (await browser("get", "url")).stdout.trim();
    const targets = await (await fetch(`http://${new URL(browserUrl).host}/json/list`)).json();
    const target = targets.find(item => item.type === "page" && item.url === pageUrl);
    if (!target?.webSocketDebuggerUrl) throw new Error(`No CDP target for ${pageUrl}`);
    await new Promise((resolveCdp, rejectCdp) => {
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      let nextId = 1;
      const sendCdp = (method, params) => new Promise((res, rej) => {
        const id = nextId++;
        const onMsg = ev => {
          const msg = JSON.parse(ev.data);
          if (msg.id !== id) return;
          ws.removeEventListener("message", onMsg);
          if (msg.error) rej(new Error(JSON.stringify(msg.error)));
          else res(msg.result);
        };
        ws.addEventListener("message", onMsg);
        ws.send(JSON.stringify({ id, method, params }));
      });
      ws.addEventListener("open", async () => {
        try {
          await sendCdp("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ id: 1, x: cx - 40, y: cy }, { id: 2, x: cx + 40, y: cy }],
          });
          for (let i = 1; i <= 6; i++) {
            const half = 40 + i * 8;
            await sendCdp("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ id: 1, x: cx - half, y: cy }, { id: 2, x: cx + half, y: cy }],
            });
            await new Promise(r => setTimeout(r, 16));
          }
          await sendCdp("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          ws.close();
          resolveCdp();
        } catch (err) {
          ws.close();
          rejectCdp(err);
        }
      });
      ws.addEventListener("error", () => rejectCdp(new Error("CDP WebSocket error")));
    });
    const cdpDone = await evalJson("window.finishCdpTouchSmoke()");
    if (!(cdpDone.scaleAfter > cdpInit.scaleBefore)) {
      throw new Error(`CDP native touch pinch did not zoom: ${cdpInit.scaleBefore} -> ${cdpDone.scaleAfter}`);
    }
    const cdpTouchSmoke = {
      passed: true,
      touchAction: cdpInit.touchAction,
      scaleBefore: cdpInit.scaleBefore,
      scaleAfter: cdpDone.scaleAfter,
      scaleElText: cdpDone.scaleElText,
    };

    // Q3: Native trusted lostpointercapture (isTrusted=true) via CDP touchStart + touchMove + native releasePointerCapture
    const q3Pos = await evalJson("window.setupQ3NativeLostCapture()");
    await new Promise((resolveCdp, rejectCdp) => {
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      let nextId = 1;
      const sendCdp = (method, params) => new Promise((res, rej) => {
        const id = nextId++;
        const onMsg = ev => {
          const msg = JSON.parse(ev.data);
          if (msg.id !== id) return;
          ws.removeEventListener("message", onMsg);
          if (msg.error) rej(new Error(JSON.stringify(msg.error)));
          else res(msg.result);
        };
        ws.addEventListener("message", onMsg);
        ws.send(JSON.stringify({ id, method, params }));
      });
      ws.addEventListener("open", async () => {
        try {
          await sendCdp("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ id: 1, x: q3Pos.x, y: q3Pos.y }],
          });
          await sendCdp("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ id: 1, x: q3Pos.x + 40, y: q3Pos.y + 20 }],
          });
          await new Promise(r => setTimeout(r, 30));
          await evalJson("window.triggerQ3ReleaseCapture()");
          await new Promise(r => setTimeout(r, 30));
          await sendCdp("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          ws.close();
          resolveCdp();
        } catch (err) {
          ws.close();
          rejectCdp(err);
        }
      });
      ws.addEventListener("error", () => rejectCdp(new Error("CDP WebSocket error in Q3")));
    });
    const q3NativeLostCapture = await evalJson("window.finishQ3NativeLostCapture()");

    // Q3b: Trusted window.blur (via CDP Target.createTarget + activateTarget) while pen stroke is active (no pointercancel / no lostpointercapture)
    const q3bPos = await evalJson("window.setupQ3bTrustedBlur()");
    let q3bAfterBlur = null;
    await new Promise((resolveCdp, rejectCdp) => {
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      const browserWs = new WebSocket(browserUrl);
      let nextId = 1;
      const sendOn = (sock, method, params = {}) => new Promise((res, rej) => {
        const id = nextId++;
        const onMsg = ev => {
          const msg = JSON.parse(ev.data);
          if (msg.id !== id) return;
          sock.removeEventListener("message", onMsg);
          if (msg.error) rej(new Error(JSON.stringify(msg.error)));
          else res(msg.result);
        };
        sock.addEventListener("message", onMsg);
        sock.send(JSON.stringify({ id, method, params }));
      });
      let openCount = 0;
      const onOpen = async () => {
        if (++openCount < 2) return;
        let createdTargetId = null;
        try {
          await sendOn(ws, "Input.dispatchMouseEvent", { type: "mousePressed", x: q3bPos.x, y: q3bPos.y, button: "left", clickCount: 1, pointerType: "pen" });
          await sendOn(ws, "Input.dispatchMouseEvent", { type: "mouseMoved", x: q3bPos.x + 50, y: q3bPos.y + 30, button: "left", buttons: 1, pointerType: "pen" });
          await new Promise(r => setTimeout(r, 30));
          // Trigger genuine trusted window.blur by creating & activating another tab via browser CDP
          const created = await sendOn(browserWs, "Target.createTarget", { url: "about:blank" });
          createdTargetId = created.targetId;
          await sendOn(browserWs, "Target.activateTarget", { targetId: createdTargetId });
          await new Promise(r => setTimeout(r, 60));
          const evalRes = await sendOn(ws, "Runtime.evaluate", { expression: "window.checkQ3bAfterBlur()", returnByValue: true });
          q3bAfterBlur = evalRes?.result?.value;
          // Close the extra tab, reactivate main page, then send trusted pointerup
          await sendOn(browserWs, "Target.closeTarget", { targetId: createdTargetId });
          createdTargetId = null;
          await sendOn(browserWs, "Target.activateTarget", { targetId: target.id });
          await new Promise(r => setTimeout(r, 40));
          await sendOn(ws, "Input.dispatchMouseEvent", { type: "mouseReleased", x: q3bPos.x + 50, y: q3bPos.y + 30, button: "left", clickCount: 1, pointerType: "pen" });
          ws.close();
          browserWs.close();
          resolveCdp();
        } catch (err) {
          if (createdTargetId) await sendOn(browserWs, "Target.closeTarget", { targetId: createdTargetId }).catch(() => {});
          ws.close();
          browserWs.close();
          rejectCdp(err);
        }
      };
      ws.addEventListener("open", onOpen);
      browserWs.addEventListener("open", onOpen);
      ws.addEventListener("error", () => rejectCdp(new Error("CDP page WebSocket error in Q3b")));
      browserWs.addEventListener("error", () => rejectCdp(new Error("CDP browser WebSocket error in Q3b")));
    });
    const q3bTrustedBlur = await evalJson(`window.finishQ3bTrustedBlur(${JSON.stringify(q3bAfterBlur)})`);

    // Re-test PZ-02 anchor accuracy in 768x1024 (portrait Pad / narrow split)
    await browser("set", "viewport", "768", "1024");
    const pz02Portrait = await evalJson("window.runPZ02()");

    const errs = await evalJson("window.getErrors()");
    if (errs.length) throw new Error("Unhandled browser errors: " + JSON.stringify(errs));

    const summary = {
      head,
      generatedAt: new Date().toISOString(),
      suite: "pdf-pinch-zoom",
      passed: true,
      pz01,
      pz02: { landscape1024x768: pz02Landscape, portrait768x1024: pz02Portrait },
      pz03,
      pz04,
      pz05,
      pz06,
      pz07,
      pz08,
      pz09,
      pz10,
      cdpTouchSmoke,
      q3NativeLostCapture,
      q3bTrustedBlur,
    };

    if (process.env.MARGINSTUDY_EVIDENCE_DIR) {
      const evidenceDir = resolve(process.env.MARGINSTUDY_EVIDENCE_DIR, "pdf-pinch-zoom");
      await mkdir(evidenceDir, { recursive: true });
      await writeFile(join(evidenceDir, "results.json"), JSON.stringify(summary, null, 2) + "\n");
      const flashEvidenceDir = resolve(process.env.MARGINSTUDY_EVIDENCE_DIR, "pdf-pinch-flash");
      await mkdir(flashEvidenceDir, { recursive: true });
      await writeFile(join(flashEvidenceDir, "results.json"), JSON.stringify({
        head,
        generatedAt: summary.generatedAt,
        suite: "pdf-pinch-zoom",
        passed: true,
        pz01,
        pz07,
        pz08,
        pz09,
        pz10,
      }, null, 2) + "\n");
    }

    console.log("PASS pdf-pinch-zoom: PZ-01..PZ-10 (pinch, no-flash, 4x2 budget, audit/alloc-fail, eviction-order & idle-upgrade), cdpTouchSmoke all passed (11/11)");
  } finally {
    await browser("close").catch(() => {});
    await new Promise(done => server.close(done));
  }
} finally {
  await rm(temporary, { recursive: true, force: true }).catch(() => {});
}
