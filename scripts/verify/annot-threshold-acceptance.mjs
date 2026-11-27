/**
 * [INPUT]: 依赖 ReaderView、HtmlAnnotationController、Store、selectionGuard 与默认 agent-browser 后端，零私有夹具依赖。
 * [OUTPUT]: 执行 ANNOT-01 选区防误触与碎词自动成卡解耦验收（A1~A7 + 跨页高亮合并）。
 * [POS]: 公开浏览器验收套件 annot-threshold，固化 ANNOT-01 全部二值断言与 Red/Green 门槛验证。
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
const docFixtures = join(project, "src/documents/acceptance-fixtures");
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-annot-threshold-")));

const fixtureSource = `
import { TFile } from "obsidian";
import { Store } from "${project}/src/model/store";
import { ReaderView } from "${project}/src/pdf/readerView";
import { HtmlAnnotationController } from "${project}/src/word/htmlAnnot";
import {
  countExcerptWeight,
  meetsExcerptMinLength,
  isPointerMicroDrag,
  isValidSelectionRect,
  isValidRegionSize,
} from "${project}/src/annot/selectionGuard";

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

function makeEnv(filesMap: Record<string, string | object>) {
  const sources = new Map<string, { file: TFile; content: string }>();
  for (const [path, val] of Object.entries(filesMap)) {
    const content = typeof val === "string" ? val : JSON.stringify(val);
    sources.set(path, { file: new TFile(path, content.length), content });
  }
  const adapterFiles = new Map<string, string>();
  const folders = new Set<string>();
  const app: any = {
    vault: {
      configDir: ".obsidian",
      getFiles: () => [...sources.values()].map(v => v.file),
      getAbstractFileByPath: (p: string) => sources.get(p)?.file ?? null,
      async read(file: TFile) { return sources.get(file.path)!.content; },
      async readBinary(file: TFile) { return new TextEncoder().encode(sources.get(file.path)!.content).buffer; },
      getResourcePath: (file: TFile) => "/synthetic/" + encodeURIComponent(file.path),
      on() { return { off() {} }; },
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
      on() { return { off() {} }; },
      offref() {},
      onLayoutReady(cb: any) { cb(); },
      getMostRecentLeaf() { return null; },
      requestSaveLayout() {},
      getLeaf() { return { setViewState: async () => {} }; },
      getLeavesOfType() { return []; },
      revealLeaf() {},
      setActiveLeaf() {},
    },
  };
  let savedData: any = null;
  const plugin: any = {
    app,
    async loadData() { return savedData; },
    async saveData(d: any) { savedData = structuredClone(d); },
    refreshSidebar() {},
    refreshMindmap() {},
    async ensureMindMapOpen() {},
    async openStudyWorkspace() { return null; },
    async openDocumentInReader() {},
    activeReader: null,
    studyWorkspace: null,
  };
  const store = new Store(plugin);
  plugin.store = store;
  return { app, plugin, store };
}

async function openPdfReader(filesMap: Record<string, string | object>, path: string, pagesToRender: number[] = [1]) {
  fixturesHost.replaceChildren();
  const env = makeEnv(filesMap);
  await env.store.load();
  const leaf: any = { app: env.app, view: null, containerEl: document.createElement("div") };
  const view = new ReaderView(leaf, env.plugin);
  leaf.view = view;
  view.containerEl.style.cssText = "position:relative;width:820px;height:760px;";
  fixturesHost.append(view.containerEl);
  await view.onOpen();
  await view.loadFileByPath(path);
  view.setScale(1);
  for (const pageNum of pagesToRender) await view.renderPage(pageNum);
  await frame();
  return { ...env, view, ctrl: (view as any).annController };
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

async function closePopAndSelection() {
  window.getSelection()?.removeAllRanges();
  document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  await frame();
}

const sampleTextItems = [
  { str: "这是八个中文字符", x: 80, y: 700, w: 220, h: 18 },
  { str: "三个字", x: 80, y: 660, w: 90, h: 18 },
  { str: "四个汉字", x: 80, y: 620, w: 120, h: 18 },
  { str: "二字", x: 80, y: 580, w: 60, h: 18 },
  { str: "abcdef", x: 80, y: 540, w: 90, h: 18 },
  { str: "abcdefg", x: 80, y: 500, w: 105, h: 18 },
  { str: "complete", x: 80, y: 460, w: 120, h: 18 },
  { str: "，。！？ ", x: 80, y: 420, w: 90, h: 18 },
  { str: "另一组四字词", x: 80, y: 380, w: 140, h: 18 },
];

(window as any).runAll = async () => {
  const report: Record<string, any> = {};

  // Pure function sanity
  assert(countExcerptWeight("三个字") === 6, "3 CJK weight should be 6");
  assert(countExcerptWeight("四个汉字") === 8, "4 CJK weight should be 8");
  assert(countExcerptWeight("abcdef") === 6, "6 ASCII weight should be 6");
  assert(countExcerptWeight("complete") === 8, "8 ASCII weight should be 8");
  assert(countExcerptWeight("，。！？ ") === 0, "punctuation weight should be 0");
  assert(!meetsExcerptMinLength("三个字", 4), "3 CJK must fail min 4");
  assert(meetsExcerptMinLength("四个汉字", 4), "4 CJK must pass min 4");
  assert(!meetsExcerptMinLength("abcdef", 4), "6 ASCII must fail min 4");
  assert(!meetsExcerptMinLength("abcdefg", 4), "7 ASCII must fail min 4");
  assert(meetsExcerptMinLength("complete", 4), "8 ASCII must pass min 4");
  assert(meetsExcerptMinLength("三个字", 0), "min 0 must allow 3 CJK");
  assert(isPointerMicroDrag({ x: 100, y: 100 }, { x: 104, y: 101 }, 1) === true, "4.12px detail=1 is micro-drag");
  assert(isPointerMicroDrag({ x: 100, y: 100 }, { x: 104, y: 101 }, 2) === false, "detail=2 must not be micro-drag");
  assert(isPointerMicroDrag({ x: 100, y: 100 }, { x: 106, y: 100 }, 1) === false, "6px is not micro-drag");
  assert(isValidSelectionRect({ width: 5, height: 5 }) === false, "5x5 rect invalid");
  assert(isValidSelectionRect({ width: 5, height: 14 }) === true, "5x14 line rect valid");
  assert(isValidRegionSize(2, 2, 12) === false && isValidRegionSize(12, 12, 12) === true, "region size threshold");
  assert(isValidRegionSize(40, 2, 12) === false && isValidRegionSize(2, 30, 12) === false, "thin region must fail short-side check");

  // ===== A1: 6px 微拖 0 产物且无浮层 =====
  {
    const { view, ctrl, store } = await openPdfReader({ "a1.pdf": { name: "A1", pages: 1, textItems: sampleTextItems } }, "a1.pdf");
    try {
      ctrl.setAutomaticTextExcerpt(true);
      const scroll = view.getScrollContainer();
      const span = findSpan(scroll, "四个汉字");
      dispatchPtr(scroll, "pointerdown", 100, 100, { detail: 1 });
      selectSpanText(span);
      document.dispatchEvent(new Event("selectionchange"));
      dispatchPtr(window, "pointerup", 104, 101, { detail: 1 });
      await wait(260);
      const anns = await store.loadAnnotations("a1.pdf");
      const popVisible = !!document.querySelector(".ms-ann-pop");
      report.A1 = {
        distancePx: Number(Math.hypot(4, 1).toFixed(2)),
        annotations: anns.length,
        cards: store.cards.length,
        nodes: store.nodes.length,
        popVisible,
      };
      assert(anns.length === 0 && store.cards.length === 0 && store.nodes.length === 0 && !popVisible,
        "A1 failed: " + JSON.stringify(report.A1));
    } finally {
      await closePopAndSelection();
      await view.onClose();
    }
  }

  // ===== A2: 拖拽中未松手停顿 300ms 不提前建卡，松手后立即创建 =====
  {
    const { view, ctrl, store } = await openPdfReader({ "a2.pdf": { name: "A2", pages: 1, textItems: sampleTextItems } }, "a2.pdf");
    try {
      ctrl.setAutomaticTextExcerpt(true);
      const scroll = view.getScrollContainer();
      const span = findSpan(scroll, "这是八个中文字符");
      dispatchPtr(scroll, "pointerdown", 100, 100, { detail: 1 });
      selectSpanText(span);
      document.dispatchEvent(new Event("selectionchange"));
      await wait(300);
      const duringAnns = (await store.loadAnnotations("a2.pdf")).length;
      const duringCards = store.cards.length;
      const duringNodes = store.nodes.length;
      dispatchPtr(window, "pointerup", 220, 100, { detail: 1 });
      await frame();
      const afterAnns = (await store.loadAnnotations("a2.pdf")).length;
      const afterCards = store.cards.length;
      const afterNodes = store.nodes.length;
      report.A2 = {
        during300ms: { annotations: duringAnns, cards: duringCards, nodes: duringNodes },
        afterPointerUp: { annotations: afterAnns, cards: afterCards, nodes: afterNodes },
      };
      assert(duringAnns === 0 && duringCards === 0 && duringNodes === 0, "A2 created before pointerup: " + JSON.stringify(report.A2));
      assert(afterAnns === 1 && afterCards === 1 && afterNodes >= 1, "A2 did not create after pointerup: " + JSON.stringify(report.A2));
    } finally {
      await closePopAndSelection();
      await view.onClose();
    }
  }

  // ===== A3: 3 字中文 / 6 字英文 / 7 字英文 / 纯标点自动摘录 0 产物 =====
  {
    const { view, ctrl, store } = await openPdfReader({ "a3.pdf": { name: "A3", pages: 1, textItems: sampleTextItems } }, "a3.pdf");
    try {
      ctrl.setAutomaticTextExcerpt(true);
      const scroll = view.getScrollContainer();
      const cases: Record<string, any> = {};
      for (const sample of ["三个字", "abcdef", "abcdefg", "，。！？ "]) {
        const span = findSpan(scroll, sample);
        dispatchPtr(scroll, "pointerdown", 100, 100, { detail: 1 });
        selectSpanText(span);
        document.dispatchEvent(new Event("selectionchange"));
        dispatchPtr(window, "pointerup", 220, 100, { detail: 1 });
        await wait(240);
        const anns = await store.loadAnnotations("a3.pdf");
        cases[sample] = { annotations: anns.length, cards: store.cards.length, nodes: store.nodes.length };
        assert(anns.length === 0 && store.cards.length === 0 && store.nodes.length === 0,
          "A3 failed for " + sample + ": " + JSON.stringify(cases[sample]));
        await closePopAndSelection();
      }
      report.A3 = cases;
    } finally {
      await closePopAndSelection();
      await view.onClose();
    }
  }

  // ===== A4: 碎词手动高亮不自动成卡；手动点「摘录卡」可成卡 =====
  {
    const { view, ctrl, store } = await openPdfReader({ "a4.pdf": { name: "A4", pages: 1, textItems: sampleTextItems } }, "a4.pdf");
    try {
      ctrl.setAutomaticTextExcerpt(true);
      const scroll = view.getScrollContainer();
      const span = findSpan(scroll, "三个字");
      dispatchPtr(scroll, "pointerdown", 100, 100, { detail: 1 });
      selectSpanText(span);
      document.dispatchEvent(new Event("selectionchange"));
      dispatchPtr(window, "pointerup", 220, 100, { detail: 1 });
      await frame();
      const pop = document.querySelector(".ms-ann-pop");
      assert(pop, "A4 selection pop missing");
      // 点击浮层里「高亮」或展开更多后点「高亮」
      const findBtn = (root: ParentNode, label: string) =>
        [...root.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
      let hlBtn = findBtn(pop!, "高亮");
      if (!hlBtn) {
        const moreBtn = [...pop!.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.includes("更多") || b.getAttribute("aria-label")?.includes("更多"));
        if (moreBtn) { moreBtn.click(); await frame(); hlBtn = findBtn(document, "高亮"); }
      }
      assert(hlBtn, "A4 highlight button missing");
      hlBtn!.click();
      await frame();
      const annsAfterHl = await store.loadAnnotations("a4.pdf");
      const afterManualHighlight = { annotations: annsAfterHl.length, cards: store.cards.length, nodes: store.nodes.length };
      assert(afterManualHighlight.annotations === 1 && afterManualHighlight.cards === 0 && afterManualHighlight.nodes === 0,
        "A4 manual short highlight auto-created card: " + JSON.stringify(afterManualHighlight));

      // 手动点击该高亮触发菜单并点「摘录卡」
      const annEl = scroll.querySelector<HTMLElement>(\`[data-ann-id="\${annsAfterHl[0].id}"]\`);
      assert(annEl, "A4 rendered highlight element missing");
      annEl!.click();
      await frame();
      let cardBtn = findBtn(document, "摘录卡");
      if (!cardBtn) {
        const moreBtn = [...document.querySelectorAll<HTMLButtonElement>(".ms-ann-pop button")].find(b => b.textContent?.includes("更多") || b.getAttribute("aria-label")?.includes("更多"));
        if (moreBtn) { moreBtn.click(); await frame(); cardBtn = findBtn(document, "摘录卡"); }
      }
      assert(cardBtn, "A4 manual excerpt card button missing");
      cardBtn!.click();
      await frame();
      const afterManualCard = { annotations: annsAfterHl.length, cards: store.cards.length, nodes: store.nodes.length };
      assert(afterManualCard.cards === 1, "A4 manual card creation failed: " + JSON.stringify(afterManualCard));
      report.A4 = { afterManualHighlight, afterManualCard };
    } finally {
      await closePopAndSelection();
      await view.onClose();
    }
  }

  // ===== A5: 达门槛正常摘录成卡（4字中文 / 8字英文 / 双击 detail=2 / 跨页高亮合并）=====
  {
    const { view, ctrl, store } = await openPdfReader({
      "a5.pdf": { name: "A5", pages: 2, textItems: sampleTextItems },
    }, "a5.pdf", [1, 2]);
    try {
      ctrl.setAutomaticTextExcerpt(true);
      const scroll = view.getScrollContainer();
      const p1 = view.getPageRecord(1)!.wrapper;
      const p2 = view.getPageRecord(2)!.wrapper;

      // 4 CJK
      dispatchPtr(scroll, "pointerdown", 100, 100, { detail: 1 });
      selectSpanText(findSpan(p1, "四个汉字"));
      document.dispatchEvent(new Event("selectionchange"));
      dispatchPtr(window, "pointerup", 220, 100, { detail: 1 });
      await frame();
      const after4Cjk = { annotations: (await store.loadAnnotations("a5.pdf")).length, cards: store.cards.length, nodes: store.nodes.length };
      assert(after4Cjk.annotations === 1 && after4Cjk.cards === 1 && after4Cjk.nodes >= 1, "A5 4 CJK failed: " + JSON.stringify(after4Cjk));

      // 8 ASCII
      dispatchPtr(scroll, "pointerdown", 100, 120, { detail: 1 });
      selectSpanText(findSpan(p1, "complete"));
      document.dispatchEvent(new Event("selectionchange"));
      dispatchPtr(window, "pointerup", 220, 120, { detail: 1 });
      await frame();
      const after8Ascii = { annotations: (await store.loadAnnotations("a5.pdf")).length, cards: store.cards.length, nodes: store.nodes.length };
      assert(after8Ascii.annotations === 2 && after8Ascii.cards === 2 && after8Ascii.nodes >= 2, "A5 8 ASCII failed: " + JSON.stringify(after8Ascii));

      // Double-click detail=2 (zero movement)
      dispatchPtr(scroll, "pointerdown", 100, 140, { detail: 2 });
      selectSpanText(findSpan(p1, "另一组四字词"));
      document.dispatchEvent(new Event("selectionchange"));
      dispatchPtr(window, "pointerup", 100, 140, { detail: 2 });
      await frame();
      const afterDblClick = { annotations: (await store.loadAnnotations("a5.pdf")).length, cards: store.cards.length, nodes: store.nodes.length };
      assert(afterDblClick.annotations === 3 && afterDblClick.cards === 3 && afterDblClick.nodes >= 3, "A5 double-click failed: " + JSON.stringify(afterDblClick));

      // Cross-page highlight merge (wait 320ms after pointerup so native delayed selectionchange cannot double-commit)
      const startSpan = findSpan(p1, "这是八个中文字符");
      const endSpan = findSpan(p2, "四个汉字");
      const crossRange = document.createRange();
      crossRange.setStart(startSpan.firstChild!, 0);
      crossRange.setEnd(endSpan.firstChild!, endSpan.firstChild!.textContent!.length);
      dispatchPtr(scroll, "pointerdown", 100, 160, { detail: 1 });
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(crossRange);
      dispatchPtr(window, "pointerup", 220, 400, { detail: 1 });
      document.dispatchEvent(new Event("selectionchange"));
      await wait(320);
      const anns = await store.loadAnnotations("a5.pdf");
      const crossAnn = anns[anns.length - 1];
      const crossPages = crossAnn?.pdfGeometry?.length ?? 0;
      const afterCrossPage = { annotations: anns.length, cards: store.cards.length, crossPages };
      assert(anns.length === 4 && store.cards.length === 4 && crossPages === 2, "A5 cross-page merge failed: " + JSON.stringify(afterCrossPage));
      report.A5 = { after4Cjk, after8Ascii, afterDblClick, afterCrossPage };
    } finally {
      await closePopAndSelection();
      await view.onClose();
    }
  }

  // ===== A6: 区域 2x2 px / 5x5 px 全入口 0 产物；40x30 px 正常产出 =====
  {
    const { view, ctrl, store } = await openPdfReader({ "a6.pdf": { name: "A6", pages: 1, textItems: sampleTextItems } }, "a6.pdf");
    try {
      const pageEl = view.getPageRecord(1)!.wrapper;
      const box = pageEl.getBoundingClientRect();

      // 1) PDF onLassoPointerUp 2x2, 5x5, 40x2, 2x30
      ctrl.setRegionMode(true);
      for (const [w, h] of [[2, 2], [5, 5], [40, 2], [2, 30]]) {
        dispatchPtr(pageEl, "pointerdown", box.left + 100, box.top + 100);
        dispatchPtr(window, "pointermove", box.left + 100 + w, box.top + 100 + h);
        dispatchPtr(window, "pointerup", box.left + 100 + w, box.top + 100 + h);
        await frame();
      }
      ctrl.setRegionMode(false);
      const afterPdfLassoMicro = { annotations: (await store.loadAnnotations("a6.pdf")).length, cards: store.cards.length };
      assert(afterPdfLassoMicro.annotations === 0 && afterPdfLassoMicro.cards === 0, "A6 PDF lasso micro/thin failed");

      // 2) PDF createRegionExtend 2x2, 5x5, 40x2, 2x30
      for (const [w, h] of [[2, 2], [5, 5], [40, 2], [2, 30]]) {
        await ctrl.createRegionExtend(1, new DOMRect(box.left + 100, box.top + 100, w, h));
      }
      const afterPdfExtendMicro = { annotations: (await store.loadAnnotations("a6.pdf")).length, cards: store.cards.length };
      assert(afterPdfExtendMicro.annotations === 0 && afterPdfExtendMicro.cards === 0, "A6 PDF createRegionExtend micro/thin failed");

      // 3) PDF excerptLassoSelection 2x2, 5x5, 40x2, 2x30
      for (const [w, h] of [[2, 2], [5, 5], [40, 2], [2, 30]]) {
        (ctrl as any).excerptLassoSelection(1, { x: 0.2, y: 0.2, width: w / box.width, height: h / box.height }, "data:image/png;base64,AA==");
      }
      const afterPdfExcerptLassoMicro = { annotations: (await store.loadAnnotations("a6.pdf")).length, cards: store.cards.length };
      assert(afterPdfExcerptLassoMicro.annotations === 0 && afterPdfExcerptLassoMicro.cards === 0, "A6 PDF excerptLassoSelection micro/thin failed");

      // 4) Valid 40x30 px on PDF onLassoPointerUp & excerptLassoSelection
      ctrl.setRegionMode(true);
      dispatchPtr(pageEl, "pointerdown", box.left + 100, box.top + 100);
      dispatchPtr(window, "pointermove", box.left + 140, box.top + 130);
      dispatchPtr(window, "pointerup", box.left + 140, box.top + 130);
      await wait(50);
      ctrl.setRegionMode(false);
      const afterPdfLassoValid = { annotations: (await store.loadAnnotations("a6.pdf")).length, cards: store.cards.length };
      assert(afterPdfLassoValid.annotations === 1 && afterPdfLassoValid.cards === 1, "A6 PDF valid 40x30 lasso failed: " + JSON.stringify(afterPdfLassoValid));

      (ctrl as any).excerptLassoSelection(1, { x: 0.2, y: 0.3, width: 40 / box.width, height: 30 / box.height }, "data:image/png;base64,AA==");
      const afterPdfExcerptLassoValid = { annotations: (await store.loadAnnotations("a6.pdf")).length, cards: store.cards.length };
      assert(afterPdfExcerptLassoValid.annotations === 2 && afterPdfExcerptLassoValid.cards === 2, "A6 PDF valid 40x30 excerptLasso failed");

      // 5) HTML onLassoPointerUp & excerptLassoSelection 2x2, 5x5, 40x2, 2x30 + valid 40x30
      const htmlEnv = makeEnv({ "a6.html": "<p>HTML region test paragraph content</p>" });
      await htmlEnv.store.load();
      const sc = document.createElement("div");
      sc.style.cssText = "position:relative;width:500px;height:300px;overflow:auto;";
      const body = document.createElement("div");
      body.style.cssText = "position:relative;width:480px;height:280px;";
      body.innerHTML = "<p>HTML region test paragraph content</p>";
      sc.append(body);
      fixturesHost.append(sc);
      const htmlCtrl = new HtmlAnnotationController(htmlEnv.plugin, {
        getScrollContainer: () => sc,
        getBodyEl: () => body,
        getFilePath: () => "a6.html",
      });
      await htmlCtrl.loadForDoc("a6.html");
      const hBox = body.getBoundingClientRect();
      htmlCtrl.setRegionMode(true);
      for (const [w, h] of [[2, 2], [5, 5], [40, 2], [2, 30]]) {
        dispatchPtr(body, "pointerdown", hBox.left + 20, hBox.top + 20);
        dispatchPtr(window, "pointermove", hBox.left + 20 + w, hBox.top + 20 + h);
        dispatchPtr(window, "pointerup", hBox.left + 20 + w, hBox.top + 20 + h);
        await frame();
      }
      htmlCtrl.setRegionMode(false);
      for (const [w, h] of [[2, 2], [5, 5], [40, 2], [2, 30]]) {
        (htmlCtrl as any).excerptLassoSelection({ x: 0.1, y: 0.1, width: w / hBox.width, height: h / hBox.height }, "data:image/png;base64,AA==");
      }
      const afterHtmlMicro = { annotations: (await htmlEnv.store.loadAnnotations("a6.html")).length, cards: htmlEnv.store.cards.length };
      assert(afterHtmlMicro.annotations === 0 && afterHtmlMicro.cards === 0, "A6 HTML micro/thin failed: " + JSON.stringify(afterHtmlMicro));

      (htmlCtrl as any).excerptLassoSelection({ x: 0.1, y: 0.1, width: 40 / hBox.width, height: 30 / hBox.height }, "data:image/png;base64,AA==");
      const afterHtmlValid = { annotations: (await htmlEnv.store.loadAnnotations("a6.html")).length, cards: htmlEnv.store.cards.length };
      assert(afterHtmlValid.annotations === 1 && afterHtmlValid.cards === 1, "A6 HTML valid 40x30 failed");
      await htmlCtrl.destroy();

      report.A6 = {
        afterPdfLassoMicro,
        afterPdfExtendMicro,
        afterPdfExcerptLassoMicro,
        afterPdfLassoValid,
        afterPdfExcerptLassoValid,
        afterHtmlMicro,
        afterHtmlValid,
      };
    } finally {
      await closePopAndSelection();
      await view.onClose();
    }
  }

  // ===== A7: continuousExcerpt 不误杀短片段 + autoExcerptMinChars=0 开关 =====
  {
    const { view, ctrl, store } = await openPdfReader({ "a7.pdf": { name: "A7", pages: 1, textItems: sampleTextItems } }, "a7.pdf");
    try {
      ctrl.setAutomaticTextExcerpt(true);
      ctrl.setContinuousExcerpt(true);
      const scroll = view.getScrollContainer();

      // 1st excerpt: 4 CJK
      dispatchPtr(scroll, "pointerdown", 100, 100, { detail: 1 });
      selectSpanText(findSpan(scroll, "四个汉字"));
      document.dispatchEvent(new Event("selectionchange"));
      dispatchPtr(window, "pointerup", 220, 100, { detail: 1 });
      await frame();

      // 2nd excerpt in continuous session: 2 CJK ("二字"), wait 320ms after delayed selectionchange to verify no duplicate append
      dispatchPtr(scroll, "pointerdown", 100, 120, { detail: 1 });
      selectSpanText(findSpan(scroll, "二字"));
      dispatchPtr(window, "pointerup", 220, 120, { detail: 1 });
      document.dispatchEvent(new Event("selectionchange"));
      await wait(320);

      const annsCont = await store.loadAnnotations("a7.pdf");
      const contSession = ctrl.getContinuousExcerpt();
      const mergedText = annsCont[0]?.text ?? "";
      const mergedCardFront = store.cards[0]?.front ?? "";
      assert(annsCont.length === 1 && store.cards.length === 1 && contSession.count === 2 && mergedText === "四个汉字\\n\\n二字" && mergedCardFront === "四个汉字\\n\\n二字",
        "A7 continuous short append failed: " + JSON.stringify({ anns: annsCont.length, cards: store.cards.length, contSession, mergedText, mergedCardFront }));

      // Turn off continuousExcerpt, set autoExcerptMinChars = 0, select "三个字"
      ctrl.setContinuousExcerpt(false);
      store.settings.autoExcerptMinChars = 0;
      dispatchPtr(scroll, "pointerdown", 100, 140, { detail: 1 });
      selectSpanText(findSpan(scroll, "三个字"));
      document.dispatchEvent(new Event("selectionchange"));
      dispatchPtr(window, "pointerup", 220, 140, { detail: 1 });
      await frame();
      const annsZero = await store.loadAnnotations("a7.pdf");
      assert(annsZero.length === 2 && store.cards.length === 2,
        "A7 minChars=0 failed: " + JSON.stringify({ anns: annsZero.length, cards: store.cards.length }));

      report.A7 = {
        continuousCount: contSession.count,
        continuousMerged: mergedText,
        minCharsZeroAnns: annsZero.length,
        minCharsZeroCards: store.cards.length,
      };
    } finally {
      await closePopAndSelection();
      await view.onClose();
    }
  }

  return report;
};

(window as any).getErrors = () => errors;
(window as any).ready = true;
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
    await writeFile(join(temporary, name + ".ts"), src);
  }
  await writeFile(join(temporary, "unused-network.ts"), "export function request(){throw new Error('offline');}");
  await writeFile(join(temporary, "crypto.ts"), "export function createHash(){return{update(){return this;},digest(){return '0000000000000000';}};}");
  await writeFile(join(temporary, "annot-threshold-fixture.ts"), fixtureSource);

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
    '<!doctype html><meta charset="utf-8"><title>MarginStudy ANNOT-01 threshold acceptance</title><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0;height:100%}#fixtures{position:relative;width:100vw;height:100vh;overflow:auto}</style><main id="fixtures"></main><script type="module" src="/fixture.js"></script>',
  );

  await build({
    entryPoints: [join(temporary, "annot-threshold-fixture.ts")],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "chrome120",
    outfile: join(temporary, "fixture.js"),
    plugins: [{
      name: "annot-threshold-adapters",
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
  const session = `marginstudy-annot-threshold-${process.pid}`;
  const browser = (...args) => runBrowser(session, ...args);

  try {
    await browser("open", "about:blank");
    await browser("set", "viewport", "1280", "960");
    await browser("open", `http://127.0.0.1:${server.address().port}`);
    await browser("wait", "--fn", "window.ready === true");
    const result = JSON.parse((await browser("eval", "window.runAll()")).stdout);
    const errs = JSON.parse((await browser("eval", "window.getErrors()")).stdout);
    if (errs.length) throw new Error("Unhandled browser errors: " + JSON.stringify(errs));
    console.log("PASS annot-threshold:", JSON.stringify(result));
  } finally {
    await browser("close").catch(() => {});
    await new Promise(done => server.close(done));
  }
} finally {
  await rm(temporary, { recursive: true, force: true }).catch(() => {});
}
