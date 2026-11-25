/**
 * [INPUT]: 依赖 StudyWorkspaceView、Store、startReview、openSyncStatusPanel、样式表、tests/fixtures/baseline/BASELINE.json、src/workspace/anchors-502.json 与默认 agent-browser 后端，零私有夹具依赖。
 * [OUTPUT]: 执行 GAP-10a G10a-01~G10a-05 九面（R2–R10）三视口合成浏览器验收；若设置 MARGINSTUDY_EVIDENCE_DIR 则落盘证据 JSON 至 $MARGINSTUDY_EVIDENCE_DIR/gap-10a/。
 * [POS]: 公开浏览器验收套件 yan-r2-r10-surfaces，固化 R2/R3/R4/R5/R6/R7/R8/R9/R10 九面几何、专属控件命中、菜单契约、简洁态往返零残留与无基线面板防溢出。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { readFile, writeFile, mkdtemp, realpath, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { runBrowser } from "./ego-harness.mjs";
import { publicFixture } from "./fixtures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const project = await realpath(resolve(here, "../.."));
const workspaceDir = join(project, "src/workspace");
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-yan-r2-r10-")));

// 读取冻结 MN5 5.0.2 AX 基线与锚点表，复用 px-gap.mjs 窗口原点换算口径（只读，不修改基线）。
const baseline = JSON.parse(await readFile(publicFixture("baseline/BASELINE.json"), "utf8"));
const anchorTable = JSON.parse(await readFile(join(workspaceDir, "anchors-502.json"), "utf8"));

function resolveBaselineAnchors() {
  const resolved = [];
  for (const anchor of anchorTable.anchors) {
    if (anchor.acceptanceOnly) continue;
    const prov = anchor.provenance;
    const state = baseline.states.find((item) => item.id === prov?.state);
    const element = prov?.kind === "baseline-ax" && state && Number.isInteger(prov.axElementIndex) && ["buttons", "texts"].includes(prov.collection)
      ? state[prov.collection]?.find((item) => item.axElementIndex === prov.axElementIndex)
      : null;
    const origin = state?.containers?.[0]?.rect;
    const last = prov?.derivation === "first-to-last-button-bounds"
      ? state?.buttons?.find((item) => item.axElementIndex === prov.lastAxElementIndex && item.label === prov.lastLabel)
      : null;
    if (!element?.rect || !origin || prov.state !== anchor.state || prov.label !== (element.label ?? null) ||
        prov.coordinateSpace !== "screen" || (prov.derivation && !last?.rect)) {
      continue;
    }
    const sourceRect = last
      ? [element.rect[0], element.rect[1], last.rect[0] + last.rect[2] - element.rect[0], element.rect[3]]
      : element.rect;
    const rect = sourceRect.map((value, index) => (index < 2 ? value - origin[index] : value));
    resolved.push({
      id: anchor.id,
      state: anchor.state,
      viewport: anchor.viewport,
      surface: anchor.surface,
      selector: anchor.selector,
      tolerance: anchor.tolerance,
      rect,
    });
  }
  return resolved;
}

const validAnchors = resolveBaselineAnchors();
const optionalAnchorIds = anchorTable.optionalAnchorIds ?? [];

const VIEWPORTS = {
  large: [1512, 851],
  medium: [756, 851],
  short: [756, 427],
};

const GAP04_MARGIN_KEYS = [
  { id: "home-heading", state: "01-1512x855-library", viewport: "large" },
  { id: "home-heading", state: "02-756x855-library", viewport: "medium" },
  { id: "home-heading", state: "03-756x427-library", viewport: "short" },
  { id: "capsule.organize", state: "06-workspace", viewport: "large" },
  { id: "capsule.organize", state: "07-node-selected", viewport: "large" },
  { id: "capsule.organize", state: "08-document-toc-open", viewport: "large" },
  { id: "capsule.organize", state: "09-document-toc-closed", viewport: "large" },
  { id: "capsule.organize", state: "11-toolbar", viewport: "large" },
];

const fixtureSource = `
import { Menu, TFile } from "obsidian";
import { Store } from "${project}/src/model/store";
import { StudyWorkspaceView } from "${project}/src/workspace/studyWorkspace";
import { startReview } from "${project}/src/review/reviewView";
import { openSyncStatusPanel } from "${project}/src/documents/recoveryPrompts";

(HTMLElement.prototype as any).empty = function () { this.replaceChildren(); };
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const fixturesHost = document.getElementById("fixtures")!;
const stamp = "2026-11-25T00:00:00Z";
const runtimeErrors: string[] = [];
window.addEventListener("error", (e) => runtimeErrors.push(String(e.error ?? e.message)));
window.addEventListener("unhandledrejection", (e) => runtimeErrors.push(String(e.reason)));

type RectObj = { x: number; y: number; width: number; height: number; left: number; top: number; right: number; bottom: number };

function rectObj(node: Element | null): RectObj | null {
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function intersectArea(a: RectObj | null, b: RectObj | null): number {
  if (!a || !b) return 0;
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return Math.round(w * h * 100) / 100;
}

function inViewport(r: RectObj | null, tol = 1): boolean {
  if (!r || r.width <= 0 || r.height <= 0) return false;
  return r.left >= -tol && r.top >= -tol && r.right <= window.innerWidth + tol && r.bottom <= window.innerHeight + tol;
}

function hitCheck(node: Element | null) {
  if (!node) return { ok: false, reason: "missing", cx: 0, cy: 0, hitTag: null, hitClass: null };
  const r = node.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return { ok: false, reason: "zero-rect", cx: r.left, cy: r.top, hitTag: null, hitClass: null };
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  const ok = !!hit && (hit === node || node.contains(hit));
  return {
    ok,
    cx: Math.round(cx * 100) / 100,
    cy: Math.round(cy * 100) / 100,
    hitTag: hit?.tagName ?? null,
    hitClass: typeof (hit as any)?.className === "string" ? (hit as any).className : null,
  };
}

let activeHarness: Awaited<ReturnType<typeof createHarness>> | null = null;

async function createHarness() {
  if (activeHarness) {
    await activeHarness.dispose().catch(() => {});
    activeHarness = null;
  }
  document.querySelectorAll("#test-menu, .ms-modal-bg, .notice").forEach((n) => n.remove());
  fixturesHost.replaceChildren();

  const sources = new Map<string, { file: TFile; content: string }>();
  const add = (path: string, content: string) => {
    const file = new TFile(path, content.length);
    sources.set(path, { file, content });
    return file;
  };
  const alpha = add("Alpha.html", "<html><body><h1>Alpha</h1><h2>Section 1</h2><p>Alpha anchor synthetic document paragraph for MarginStudy acceptance.</p><h2>Section 2</h2><p>Second section content.</p></body></html>");
  const beta = add("Beta.md", "# Beta\\n\\nBeta note body for attachment and node selection.");
  const adapterFiles = new Map<string, string>();
  const folders = new Set<string>();
  const vaultEvents = new Map<string, Set<(...args: any[]) => void>>();
  const wsEvents = new Map<string, Set<(...args: any[]) => void>>();
  const dock = () => ({ collapsed: false, collapse() { this.collapsed = true; }, expand() { this.collapsed = false; } });

  const app: any = {
    vault: {
      configDir: ".obsidian",
      getFiles: () => [...sources.values()].map((v) => v.file),
      getAbstractFileByPath: (p: string) => sources.get(p)?.file ?? null,
      async read(file: TFile) { return sources.get(file.path)!.content; },
      async readBinary(file: TFile) { return new TextEncoder().encode(sources.get(file.path)!.content).buffer; },
      getResourcePath: (file: TFile) => "/synthetic-resource/" + encodeURIComponent(file.path),
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
      openPopoutLeaf() { return { openFile: async () => {} }; },
      openLinkText: async () => {},
      revealLeaf: async () => {},
      setActiveLeaf(next: any) { this.activeLeaf = next; },
    },
  };

  let disk: any = {
    cards: [
      { id: "anchor-card", type: "excerpt", docPath: alpha.path, title: "探针卡片一 · 民法总则", front: "民法典总则编的核心基本原则是==平等、自愿、公平、诚信==。", back: "解析：民法典第 4–9 条规定了基本原则。", tags: ["法学"], links: [], createdAt: stamp },
      { id: "beta-card", type: "excerpt", docPath: beta.path, title: "探针卡片二 · 合同编", front: "要约生效时间采用==到达主义==。", back: "解析：民法典第 474 条。", tags: ["法学"], links: [], createdAt: stamp },
    ],
    nodes: [
      { id: "anchor-node", cardId: "anchor-card", canvasId: "canvas-1", parentId: null, title: "Alpha anchor", collapsed: false, x: 120, y: 120 },
      { id: "beta-node", cardId: "beta-card", canvasId: "canvas-1", parentId: "anchor-node", title: "Beta node", collapsed: false, x: 360, y: 120 },
    ],
    edges: [],
    srs: {},
    reviewDecks: [
      { id: "deck-1", name: "探针复习卡组", studySetIds: ["set-1"], cardIds: ["anchor-card", "beta-card"], createdAt: stamp },
    ],
    activeReviewDeckId: "deck-1",
    studySets: [
      { id: "set-1", name: "YAN Study", docPaths: [alpha.path, beta.path], documentAttachments: { [alpha.path]: [beta.path] }, createdAt: stamp },
    ],
    canvases: [
      { id: "canvas-1", studySetId: "set-1", name: "主脑图", createdAt: stamp },
    ],
    activeStudySetId: "set-1",
    activeCanvasId: "canvas-1",
  };
  const host: any = {
    app,
    loadData: async () => JSON.parse(JSON.stringify(disk)),
    saveData: async (value: any) => { disk = JSON.parse(JSON.stringify(value)); },
  };
  const store = new Store(host);
  await store.load();
  store.setStudyInterface("set-1", "scenes");
  store.enqueueReviewInDeck(["anchor-card", "beta-card"], "deck-1");

  const leaf: any = { app, setViewState: async () => {}, updateHeader() {}, getRoot: () => app.workspace.rootSplit };
  app.workspace.activeLeaf = leaf;
  app.workspace.centerLeaf = leaf;
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
    openStudyWorkspace: async () => view,
  };
  const view = new StudyWorkspaceView(leaf, plugin);
  view.containerEl.firstElementChild!.classList.add("view-header-title");
  leaf.view = view;
  plugin.studyWorkspace = view;
  view.load();
  await view.onOpen();
  await view.openFile(alpha);
  await frame();

  activeHarness = {
    app, alpha, beta, store, plugin, view,
    get root() { return view.contentEl; },
    dispose: async () => { await view.onClose(); view.unload(); view.containerEl.remove(); },
  };
  return activeHarness;
}

async function enterR2Workspace() {
  const h = await createHarness();
  h.store.updateStudySet("set-1", { documentAttachments: { [h.alpha.path]: [h.beta.path] } });
  h.store.setStudyInterface("set-1", "scenes");
  if ((h.view as any).state.library) (h.view as any).state.library = false;
  if ((h.view as any).state.documentNavigation) (h.view as any).toggleDocumentNavigation();
  if (h.view.isCleanView()) h.view.setCleanView(false);
  h.view.refresh(true);
  await frame();
  const closeAux = h.root.querySelector<HTMLButtonElement>('[aria-label="关闭卡片面板"]');
  closeAux?.click();
  await frame();
  return h;
}

async function enterHomeScene() {
  const h = await createHarness();
  h.store.updateStudySet("set-1", { pinned: false, category: "课程" });
  for (let i = 1; i < 6; i++) h.store.createStudySet("YAN layout " + i);
  h.view.refresh(true);
  await frame();
  const homeBtn = h.root.querySelector<HTMLButtonElement>('[aria-label="打开学习集与文档"]');
  homeBtn?.click();
  await frame();
  await wait(40);
  return h;
}

function measureSelectors(selectors: string[]) {
  return selectors.map((selector) => {
    const node = document.querySelector(selector);
    if (!node || !(node as HTMLElement).checkVisibility()) return null;
    const r = node.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  });
}

(window as any).yanMeasureWorkspaceState = async (state: string, selectors: string[]) => {
  if (/^0[123]-/.test(state)) {
    await enterHomeScene();
    return {
      rects: measureSelectors(selectors),
      overflow: (() => {
        const el = document.querySelector<HTMLElement>(".ms-study-home-screen");
        return el ? { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, ok: el.scrollWidth <= el.clientWidth + 1 } : null;
      })(),
    };
  }
  const h = await enterR2Workspace();
  if (/^07-/.test(state)) {
    const node = document.querySelector<HTMLElement>('.ms-node[data-id="beta-node"]');
    if (!node) throw new Error("Missing beta-node for " + state);
    node.click();
    await frame();
    if (!document.querySelector(".ms-node.is-selected")) throw new Error("Node selection failed for " + state);
  } else if (/^08-/.test(state)) {
    const toggle = document.querySelector<HTMLElement>('[aria-label="immersiveDocs"]');
    if (!toggle) throw new Error("Missing immersiveDocs for " + state);
    toggle.click();
    await frame();
    if (!document.querySelector(".ms-document-navigation")) throw new Error("Document navigation did not open for " + state);
  } else if (/^10-minimal/.test(state)) {
    const handle = document.querySelector<HTMLElement>(".ms-clean-view-handle");
    if (!handle) throw new Error("Missing clean view handle for " + state);
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await frame();
    if (!document.querySelector(".ms-study-workspace.is-clean-view")) throw new Error("Clean view did not activate for " + state);
  }
  const ws = document.querySelector<HTMLElement>(".ms-study-workspace")!;
  return {
    rects: measureSelectors(selectors),
    overflow: { scrollWidth: ws.scrollWidth, clientWidth: ws.clientWidth, ok: ws.scrollWidth <= ws.clientWidth + 1 },
  };
};

(window as any).yanAuditR6Exclusive = async () => {
  await enterR2Workspace();
  const node = document.querySelector<HTMLElement>('.ms-node[data-id="beta-node"]');
  if (!node) throw new Error("Missing beta-node");
  node.click();
  await frame();
  const selected = document.querySelector<HTMLElement>(".ms-node.is-selected");
  const toolbar = document.querySelector<HTMLElement>(".ms-node-toolbar");
  const topBar = rectObj(document.querySelector(".ms-workspace-context"));
  const bottomBar = rectObj(document.querySelector(".ms-bottom-capsule-shell"));
  const expectedLabels = ["分支布局", "焦点", "链接", "添加复习", "更多"];
  const items = expectedLabels.map((label) => {
    const btn = toolbar?.querySelector<HTMLElement>(\`button[aria-label="\${label}"]\`) ?? null;
    const visible = !!btn && btn.checkVisibility();
    const rect = visible ? rectObj(btn) : null;
    const hit = visible ? hitCheck(btn) : { ok: false, reason: "not-visible", cx: 0, cy: 0, hitTag: null, hitClass: null };
    const topOverlap = intersectArea(rect, topBar);
    const bottomOverlap = intersectArea(rect, bottomBar);
    return {
      label,
      visible,
      rect,
      inViewport: inViewport(rect, 1),
      hit,
      topOverlap,
      bottomOverlap,
      passed: visible && inViewport(rect, 1) && hit.ok && topOverlap === 0 && bottomOverlap === 0,
    };
  });
  return {
    viewport: [window.innerWidth, window.innerHeight],
    selectedExists: !!selected && selected.checkVisibility(),
    toolbarVisible: !!toolbar && toolbar.checkVisibility(),
    toolbarRect: rectObj(toolbar),
    topBarRect: topBar,
    bottomBarRect: bottomBar,
    items,
    passed: !!selected && selected.checkVisibility() && !!toolbar && toolbar.checkVisibility() && items.every((item) => item.passed),
  };
};

(window as any).yanAuditR7Exclusive = async () => {
  await enterR2Workspace();
  const toggle = document.querySelector<HTMLElement>('[aria-label="immersiveDocs"]');
  if (!toggle) throw new Error("Missing immersiveDocs");
  toggle.click();
  await frame();
  const nav = document.querySelector<HTMLElement>(".ms-document-navigation");
  const topBar = rectObj(document.querySelector(".ms-workspace-context"));
  const bottomBar = rectObj(document.querySelector(".ms-bottom-capsule-shell"));
  const navRect = nav && nav.checkVisibility() ? rectObj(nav) : null;
  const expectedTabs = ["目录", "缩略图", "书签", "标注", "卡片"];
  const tabs = expectedTabs.map((label) => {
    const btn = document.querySelector<HTMLElement>(\`.ms-document-navigation-tabs button[aria-label="\${label}"]\`);
    const visible = !!btn && btn.checkVisibility();
    const rect = visible ? rectObj(btn) : null;
    const hit = visible ? hitCheck(btn) : { ok: false, reason: "not-visible", cx: 0, cy: 0, hitTag: null, hitClass: null };
    const topOverlap = intersectArea(rect, topBar);
    const bottomOverlap = intersectArea(rect, bottomBar);
    return {
      label,
      visible,
      rect,
      inViewport: inViewport(rect, 1),
      hit,
      topOverlap,
      bottomOverlap,
      passed: visible && inViewport(rect, 1) && hit.ok && topOverlap === 0 && bottomOverlap === 0,
    };
  });
  // 同时检查目录面板内可见操作按钮（如 AI 目录 / 编辑等）
  const panelButtons = [...(nav?.querySelectorAll<HTMLElement>("button") ?? [])]
    .filter((btn) => btn.checkVisibility())
    .map((btn) => {
      const rect = rectObj(btn);
      const hit = hitCheck(btn);
      const topOverlap = intersectArea(rect, topBar);
      const bottomOverlap = intersectArea(rect, bottomBar);
      return {
        label: btn.getAttribute("aria-label") || btn.textContent?.trim() || "(unnamed)",
        rect,
        inViewport: inViewport(rect, 1),
        hit,
        topOverlap,
        bottomOverlap,
        passed: inViewport(rect, 1) && hit.ok && topOverlap === 0 && bottomOverlap === 0,
      };
    });
  const navTopOverlap = intersectArea(navRect, topBar);
  const navBottomOverlap = intersectArea(navRect, bottomBar);
  return {
    viewport: [window.innerWidth, window.innerHeight],
    navVisible: !!nav && nav.checkVisibility(),
    navRect,
    navInViewport: inViewport(navRect, 1),
    navTopOverlap,
    navBottomOverlap,
    topBarRect: topBar,
    bottomBarRect: bottomBar,
    tabs,
    panelButtons,
    passed: !!nav && nav.checkVisibility() && inViewport(navRect, 1) && tabs.every((t) => t.passed) && panelButtons.every((b) => b.passed),
  };
};

(window as any).yanAuditR4R5Menus = async () => {
  await enterR2Workspace();
  const coexistenceErrors: string[] = [];
  const observedTargets: string[] = [];

  const captureListener = (event: MouseEvent) => {
    try {
      const target = event.target as HTMLElement | null;
      if (target && typeof target.getAttribute === "function") {
        const label = target.getAttribute("aria-label");
        if (label) observedTargets.push(label);
      } else {
        throw new TypeError("event.target.getAttribute is not a function");
      }
    } catch (err) {
      coexistenceErrors.push("capture:" + String(err));
    }
  };
  document.addEventListener("click", captureListener, true);

  const origShowAtMouseEvent = Menu.prototype.showAtMouseEvent;
  let mindmapTargetAttr: string | null = null;
  Menu.prototype.showAtMouseEvent = function (event?: MouseEvent) {
    if (event) {
      try {
        mindmapTargetAttr = (event.target as HTMLElement).getAttribute("aria-label");
      } catch (err) {
        coexistenceErrors.push("showAtMouseEvent:" + String(err));
      }
    }
    return origShowAtMouseEvent.call(this, event);
  };

  try {
    // R4 文档菜单（Alpha.html 打开，Beta.md 为另一篇文档且作为附件）
    const docBtn = document.querySelector<HTMLButtonElement>('.ms-workspace-context [aria-label^="文档："]');
    if (!docBtn) throw new Error("Missing R4 document menu button");
    docBtn.click();
    await frame();
    const r4Menu = document.querySelector<HTMLElement>("#test-menu");
    const r4Rect = rectObj(r4Menu);
    const r4Items = [...(r4Menu?.querySelectorAll<HTMLButtonElement>("button") ?? [])].map((b) => ({
      text: b.textContent?.trim() ?? "",
      disabled: b.disabled,
      checked: b.getAttribute("aria-checked"),
    }));
    r4Menu?.remove();

    const expectedR4 = [
      { text: "关闭文档视图", disabled: false },
      { text: "文档浮窗", disabled: false },
      { text: "和《Beta》对照", disabled: false },
      { text: "单视图", disabled: false },
      { text: "双视图", disabled: false },
      { text: "三视图", disabled: true },
      { text: "自动方向", disabled: true },
      { text: "左右排列", disabled: true },
      { text: "上下排列", disabled: true },
      { text: "交换两篇文档的位置", disabled: true },
      { text: "结束对照，保留此文档", disabled: true },
      { text: "Alpha", disabled: false },
      { text: "Beta", disabled: false },
      { text: "文档与目录", disabled: false },
      { text: "从资料库…", disabled: false },
      { text: "从文件", disabled: false },
      { text: "新建笔记本", disabled: false },
      { text: "从Web", disabled: false },
      { text: "从百度网盘", disabled: false },
      { text: "添加外部源", disabled: false },
      { text: "管理文档…", disabled: false },
      { text: "AI 拆书", disabled: true },
      { text: "转到指定页码", disabled: true },
      { text: "附件 · Beta", disabled: false },
      { text: "竖向阅读", disabled: true },
      { text: "翻页阅读", disabled: true },
      { text: "双页模式 (PDF)", disabled: true },
      { text: "裁边", disabled: true },
      { text: "PDF OCR设置", disabled: true },
      { text: "编辑PDF页面", disabled: true },
      { text: "导出文档", disabled: true },
      { text: "在场景模板里设置…", disabled: false },
    ];
    const r4Match = r4Items.length === expectedR4.length && expectedR4.every((exp, idx) => r4Items[idx].text === exp.text && r4Items[idx].disabled === exp.disabled);

    // R5 脑图菜单
    const mapBtn = document.querySelector<HTMLButtonElement>('.ms-workspace-context [aria-label^="脑图："]');
    if (!mapBtn) throw new Error("Missing R5 mindmap menu button");
    mapBtn.click();
    await frame();
    const r5Menu = document.querySelector<HTMLElement>("#test-menu");
    const r5Rect = rectObj(r5Menu);
    const r5Items = [...(r5Menu?.querySelectorAll<HTMLButtonElement>("button") ?? [])].map((b) => ({
      text: b.textContent?.trim() ?? "",
      disabled: b.disabled,
      checked: b.getAttribute("aria-checked"),
    }));
    r5Menu?.remove();

    const expectedR5 = [
      { text: "关闭脑图", disabled: false },
      { text: "主脑图", disabled: false },
      { text: "管理脑图", disabled: false },
      { text: "大纲", disabled: false },
      { text: "卡片分组看板", disabled: false },
      { text: "导出思维导图", disabled: false },
      { text: "导出学习集", disabled: false },
      { text: "朗读卡片", disabled: false },
      { text: "在场景模板里设置…", disabled: false },
    ];
    const r5Match = r5Items.length === expectedR5.length && expectedR5.every((exp, idx) => r5Items[idx].text === exp.text && r5Items[idx].disabled === exp.disabled) && r5Items[1]?.checked === "true";

    return {
      viewport: [window.innerWidth, window.innerHeight],
      geometryBaseline: null,
      note: "按 YAN-6 批准无几何基线口径核验菜单文案顺序、启用态、视口边界与共存监听器防错",
      r4: {
        opened: !!r4Rect && r4Rect.width > 0 && r4Rect.height > 0,
        rect: r4Rect,
        inViewport: inViewport(r4Rect, 1),
        itemCount: r4Items.length,
        contractMatch: r4Match,
        items: r4Items,
      },
      r5: {
        opened: !!r5Rect && r5Rect.width > 0 && r5Rect.height > 0,
        rect: r5Rect,
        inViewport: inViewport(r5Rect, 1),
        itemCount: r5Items.length,
        contractMatch: r5Match,
        mindmapTargetAttr,
        items: r5Items,
      },
      coexistenceErrors,
      observedTargets,
      passed:
        inViewport(r4Rect, 1) && r4Match &&
        inViewport(r5Rect, 1) && r5Match &&
        mindmapTargetAttr === "脑图：主脑图" &&
        coexistenceErrors.length === 0,
    };
  } finally {
    document.removeEventListener("click", captureListener, true);
    Menu.prototype.showAtMouseEvent = origShowAtMouseEvent;
  }
};

(window as any).yanAuditR8Roundtrip = async (r2Selectors: string[], minimalSelector: string | null) => {
  const h = await enterR2Workspace();
  const root = h.root.classList.contains("ms-study-workspace") ? h.root : h.root.querySelector<HTMLElement>(".ms-study-workspace")!;
  const beforeSnapshot = {
    isCleanView: h.view.isCleanView(),
    hasCleanClass: root.classList.contains("is-clean-view"),
    reader: root.dataset.reader,
    mindmap: root.dataset.mindmap,
    readerTool: root.dataset.readerTool,
    library: root.dataset.library,
    auxiliary: root.dataset.auxiliary,
    toolbarVisible: !!root.querySelector<HTMLElement>(".ms-workspace-toolbar")?.checkVisibility(),
    bottomVisible: !!root.querySelector<HTMLElement>(".ms-bottom-capsule-shell")?.checkVisibility(),
    penStripVisible: !!root.querySelector<HTMLElement>(".ms-clean-pen-strip")?.checkVisibility(),
  };

  // 进入简洁态（10-minimal）
  const handle = root.querySelector<HTMLElement>(".ms-clean-view-handle");
  if (!handle) throw new Error("Missing .ms-clean-view-handle");
  handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await frame();

  const minimalAttachmentRect = minimalSelector ? measureSelectors([minimalSelector])[0] : null;

  // 开启手写笔模式以同时核验 把手 + 笔条 + 附件胶囊 三元素命中与两两零重叠
  (h.view.getReader() as any).setHandwritingMode("pen");
  await frame();

  const handleEl = root.querySelector<HTMLElement>(".ms-clean-view-handle");
  const penStripEl = root.querySelector<HTMLElement>(".ms-clean-pen-strip");
  const attachEl = root.querySelector<HTMLElement>(".ms-workspace-attachment-capsule");

  const cleanControls = [
    { name: "handle", el: handleEl },
    { name: "penStrip", el: penStripEl },
    { name: "attachment", el: attachEl },
  ].map(({ name, el }) => {
    const visible = !!el && el.checkVisibility();
    const rect = visible ? rectObj(el) : null;
    const hit = visible ? hitCheck(el) : { ok: false, reason: "not-visible", cx: 0, cy: 0, hitTag: null, hitClass: null };
    return { name, visible, rect, inViewport: inViewport(rect, 1), hit };
  });

  const pairs: { a: string; b: string; area: number }[] = [];
  for (let i = 0; i < cleanControls.length; i++) {
    for (let j = i + 1; j < cleanControls.length; j++) {
      pairs.push({
        a: cleanControls[i].name,
        b: cleanControls[j].name,
        area: intersectArea(cleanControls[i].rect, cleanControls[j].rect),
      });
    }
  }
  const maxOverlapArea = pairs.reduce((m, p) => Math.max(m, p.area), 0);

  // 关闭手写笔并退出简洁态，回到 R2 常态
  (h.view.getReader() as any).setHandwritingMode("off");
  await frame();
  handleEl!.click();
  await frame();

  const afterSnapshot = {
    isCleanView: h.view.isCleanView(),
    hasCleanClass: root.classList.contains("is-clean-view"),
    reader: root.dataset.reader,
    mindmap: root.dataset.mindmap,
    readerTool: root.dataset.readerTool,
    library: root.dataset.library,
    auxiliary: root.dataset.auxiliary,
    toolbarVisible: !!root.querySelector<HTMLElement>(".ms-workspace-toolbar")?.checkVisibility(),
    bottomVisible: !!root.querySelector<HTMLElement>(".ms-bottom-capsule-shell")?.checkVisibility(),
    penStripVisible: !!root.querySelector<HTMLElement>(".ms-clean-pen-strip")?.checkVisibility(),
  };

  const zeroResidualState = JSON.stringify(beforeSnapshot) === JSON.stringify(afterSnapshot);
  const r2AfterRects = r2Selectors.length ? measureSelectors(r2Selectors) : [];

  return {
    viewport: [window.innerWidth, window.innerHeight],
    hostAdaptationNote: "保留 .ms-clean-view-handle 当前约 70×14px 宿主适配尺寸（MN5 基线 76×34px 登记为已知宿主适配差异，严禁放大以防复发 G9-07 重叠）",
    minimalAttachmentRect,
    cleanControls,
    pairs,
    maxOverlapArea,
    beforeSnapshot,
    afterSnapshot,
    zeroResidualState,
    r2AfterRects,
    passed:
      cleanControls.every((c) => c.visible && c.inViewport && c.hit.ok) &&
      maxOverlapArea === 0 &&
      zeroResidualState,
  };
};

(window as any).yanAuditR9R10Panels = async () => {
  const h = await enterR2Workspace();
  // R9: 2-card probe via startReview
  startReview(h.plugin, { presentation: "score", deckId: "deck-1" });
  await frame();
  await wait(40);

  const titleEl = document.querySelector<HTMLElement>(".ms-modal .ms-review-card-title");
  const titleVisible = !!titleEl && titleEl.checkVisibility() && (titleEl.textContent?.trim().length ?? 0) > 0;
  const titleRect = titleVisible ? rectObj(titleEl) : null;

  const revealBtn = document.querySelector<HTMLButtonElement>(".ms-modal .ms-native-review-reveal");
  if (!revealBtn) throw new Error("Missing R9 reveal button");
  revealBtn.click();
  await frame();
  await wait(40);

  const bodyEl = document.querySelector<HTMLElement>(".ms-modal .ms-review-q");
  const bodyRect = bodyEl && bodyEl.checkVisibility() ? rectObj(bodyEl) : null;
  const gradeEls = [...document.querySelectorAll<HTMLButtonElement>(".ms-modal .ms-grade")];
  const grades = gradeEls.map((btn) => {
    const visible = btn.checkVisibility();
    const rect = visible ? rectObj(btn) : null;
    const hit = visible ? hitCheck(btn) : { ok: false, reason: "not-visible", cx: 0, cy: 0, hitTag: null, hitClass: null };
    const fullText = btn.textContent?.trim() ?? "";
    const label = fullText.split(/\\s+/)[0] ?? "";
    return {
      label,
      fullText,
      visible,
      rect,
      inViewport: inViewport(rect, 1),
      hit,
      bodyOverlap: intersectArea(rect, bodyRect),
    };
  });
  const gradePairOverlaps: { a: string; b: string; area: number }[] = [];
  for (let i = 0; i < grades.length; i++) {
    for (let j = i + 1; j < grades.length; j++) {
      gradePairOverlaps.push({
        a: grades[i].label,
        b: grades[j].label,
        area: intersectArea(grades[i].rect, grades[j].rect),
      });
    }
  }
  const exactLabels = grades.map((g) => g.label);
  const labelsMatch = JSON.stringify(exactLabels) === JSON.stringify(["重复", "难", "良好", "易"]);
  const r9Passed =
    titleVisible &&
    inViewport(titleRect, 1) &&
    labelsMatch &&
    grades.every((g) => g.visible && g.inViewport && g.hit.ok && g.bodyOverlap === 0) &&
    gradePairOverlaps.every((p) => p.area === 0);

  // 关闭 R9 复习弹窗
  document.querySelector<HTMLButtonElement>('.ms-modal [aria-label="结束复习"], .ms-modal .ms-native-review-exit')?.click();
  document.querySelectorAll(".ms-modal-bg").forEach((n) => n.remove());
  await frame();

  // R10: 本地状态与保护面板 (openSyncStatusPanel)
  openSyncStatusPanel(h.store, {
    findSource: () => {},
    resolveConflict: () => {},
    backupPaths: () => [],
    notify: () => {},
  });
  await frame();

  const syncModal = document.querySelector<HTMLElement>(".ms-modal.ms-sync-status");
  const syncRect = syncModal && syncModal.checkVisibility() ? rectObj(syncModal) : null;
  const syncRows = [...(syncModal?.querySelectorAll<HTMLElement>(".ms-sync-row") ?? [])].map((row) => row.textContent?.trim() ?? "");
  const syncOverflowOk = !!syncModal && syncModal.scrollWidth <= syncModal.clientWidth + 1;
  const r10Passed =
    !!syncModal &&
    inViewport(syncRect, 1) &&
    syncRows.length >= 5 &&
    syncRows.every((text) => text.length > 0) &&
    syncOverflowOk;

  document.querySelectorAll(".ms-modal-bg").forEach((n) => n.remove());
  await frame();

  return {
    viewport: [window.innerWidth, window.innerHeight],
    r9: {
      geometryBaseline: null,
      note: "无 MN5 几何基线；核验 2 卡探针标题、翻面四评分按钮精确文案（重复/难/良好/易）、视口边界、elementFromPoint 命中与零重叠",
      titleText: titleEl?.textContent?.trim() ?? null,
      titleVisible,
      titleRect,
      bodyRect,
      exactLabels,
      labelsMatch,
      grades,
      gradePairOverlaps,
      passed: r9Passed,
    },
    r10: {
      geometryBaseline: null,
      note: "D-04 自有增强，无 MN5 几何基线；核验容器非零、视口内不裁剪、状态行 >=5 且非空、scrollWidth <= clientWidth + 1",
      rect: syncRect,
      inViewport: inViewport(syncRect, 1),
      rowCount: syncRows.length,
      nonEmptyRows: syncRows.every((text) => text.length > 0),
      scrollWidth: syncModal?.scrollWidth ?? null,
      clientWidth: syncModal?.clientWidth ?? null,
      overflowOk: syncOverflowOk,
      passed: r10Passed,
    },
    passed: r9Passed && r10Passed,
  };
};

(window as any).yanGetRuntimeErrors = () => runtimeErrors.slice();
(window as any).ready = true;
`;

function compareAnchors(anchors, measuredRects, allowOptionalSkip = false) {
  const rows = anchors.map((anchor, index) => {
    const actual = measuredRects[index] ?? null;
    const optionalAbsent = allowOptionalSkip && !actual && optionalAnchorIds.includes(anchor.id);
    const skipped = optionalAbsent;
    const missing = !skipped && !actual;
    const delta = actual
      ? Object.fromEntries(["dx", "dy", "dw", "dh"].map((key, pos) => [key, Math.round((actual[pos] - anchor.rect[pos]) * 100) / 100]))
      : null;
    const maxDelta = delta ? Math.max(...Object.values(delta).map(Math.abs)) : null;
    return {
      id: anchor.id,
      state: anchor.state,
      viewport: anchor.viewport,
      target: anchor.rect,
      actual,
      delta,
      maxDelta,
      tolerance: anchor.tolerance,
      exceedsTolerance: maxDelta !== null && maxDelta > anchor.tolerance,
      missing,
      skipped,
    };
  });
  return {
    total: rows.length,
    passed: rows.filter((r) => !r.skipped && !r.missing && !r.exceedsTolerance).length,
    exceeded: rows.filter((r) => r.exceedsTolerance).length,
    missing: rows.filter((r) => r.missing).length,
    skipped: rows.filter((r) => r.skipped).length,
    maxDelta: Math.max(0, ...rows.filter((r) => r.maxDelta !== null).map((r) => r.maxDelta)),
    rows,
  };
}

try {
  await writeFile(join(temporary, "obsidian-fixture.ts"), (await readFile(join(workspaceDir, "obsidian-fixture.txt"), "utf8")).replaceAll("__PROJECT__", project));
  await writeFile(join(temporary, "yan-fixture.ts"), fixtureSource);
  for (const name of ["fakePdf", "fakeMammoth"]) {
    await writeFile(join(temporary, name + ".ts"), await readFile(join(project, "src/documents/acceptance-fixtures", name + ".txt"), "utf8"));
  }
  await writeFile(join(temporary, "fakePdf.ts"), (await readFile(join(temporary, "fakePdf.ts"), "utf8")) + "\nexport async function initPdfWorker() {}\n");
  const hashes = Object.fromEntries(["Alpha.html", "Beta.md"].map((p) => [p, createHash("sha256").update(p).digest("hex")]));
  await writeFile(join(temporary, "crypto.ts"), `const hashes=${JSON.stringify(hashes)};export function createHash(){let input;return{update(v){input=v;return this;},digest(){return hashes[input]??"0".repeat(64);}}}`);
  await writeFile(join(temporary, "unused-network.ts"), "export function request(){throw new Error('network unused');}");

  const styles = await Promise.all([
    "styles.css",
    "src/styles/styles-reader.css",
    "src/styles/styles-mindmap.css",
    "src/styles/styles-organize.css",
    "src/styles/styles-workspace.css",
    "src/styles/styles-review.css",
  ].map((name) => readFile(join(project, name), "utf8")));
  await writeFile(join(temporary, "styles.css"), styles.join("\n"));
  await writeFile(
    join(temporary, "index.html"),
    '<!doctype html><meta charset="utf-8"><title>MarginStudy GAP-10a R2-R10 surfaces acceptance</title><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0;height:100%}#fixtures{height:100vh;width:100vw}.test-item-view{height:100%;width:100%;display:flex;flex-direction:column}.test-item-view>.view-content{height:100%;width:100%;overflow:hidden}#test-menu{position:fixed;top:65px;right:8px;max-height:calc(100vh - 73px);max-width:calc(100vw - 16px);overflow-y:auto;z-index:9999;background:white;border:1px solid #aaa;display:flex;flex-direction:column}#test-menu button{padding:6px 10px;text-align:left;white-space:nowrap}</style><main id="fixtures"></main><script type="module" src="/fixture.js"></script>',
  );

  await build({
    entryPoints: [join(temporary, "yan-fixture.ts")],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "chrome120",
    outfile: join(temporary, "fixture.js"),
    plugins: [{
      name: "public-synthetic-host-adapters",
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
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const session = `marginstudy-yan-r2-r10-${process.pid}`;
  const browser = (...args) => runBrowser(session, ...args);

  const evidenceDir = process.env.MARGINSTUDY_EVIDENCE_DIR ? resolve(process.env.MARGINSTUDY_EVIDENCE_DIR, "gap-10a") : null;
  if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
  const writeEvidence = async (filename, payload) => {
    if (evidenceDir) await writeFile(join(evidenceDir, filename), JSON.stringify(payload, null, 2) + "\n");
  };

  try {
    await browser("open", "about:blank");
    await browser("set", "viewport", "1512", "851");
    await browser("open", `http://127.0.0.1:${server.address().port}`);
    await browser("wait", "--fn", "window.ready === true");
    const evalJson = async (expr) => JSON.parse((await browser("eval", expr)).stdout);

    const measuredByState = new Map();
    const overflowByState = new Map();

    async function measureState(state, viewportKey, allowOptionalSkip = false) {
      const [w, h] = VIEWPORTS[viewportKey];
      await browser("set", "viewport", String(w), String(h));
      const anchors = validAnchors.filter((a) => a.state === state && a.viewport === viewportKey);
      const res = await evalJson(`window.yanMeasureWorkspaceState(${JSON.stringify(state)}, ${JSON.stringify(anchors.map((a) => a.selector))})`);
      const summary = compareAnchors(anchors, res.rects, allowOptionalSkip);
      measuredByState.set(state, summary);
      overflowByState.set(state, res.overflow);
      return summary;
    }

    // ===== G10a-01: R2 + R3 + 8 条 GAP-04 边际项 =====
    const r2States = [["06-workspace", "large"], ["06-workspace-medium", "medium"], ["06-workspace-short", "short"]];
    const r3States = [["11-toolbar", "large"], ["11-toolbar-medium", "medium"], ["11-toolbar-short", "short"]];
    const homeStates = [["01-1512x855-library", "large"], ["02-756x855-library", "medium"], ["03-756x427-library", "short"]];
    for (const [st, vp] of [...r2States, ...r3States, ...homeStates]) {
      await measureState(st, vp, false);
    }
    // 补测 07/08/09 large 以覆盖全部 5 条 capsule.organize 边际项
    await measureState("07-node-selected", "large", true);
    await measureState("08-document-toc-open", "large", false);
    await measureState("09-document-toc-closed", "large", false);

    const r2Rows = r2States.flatMap(([st]) => measuredByState.get(st).rows);
    const r3Rows = r3States.flatMap(([st]) => measuredByState.get(st).rows);
    const r2Ok = r2Rows.length === 63 && r2Rows.every((r) => !r.missing && !r.exceedsTolerance);
    const r3Ok = r3Rows.length === 30 && r3Rows.every((r) => !r.missing && !r.exceedsTolerance);

    const gap04Margin = GAP04_MARGIN_KEYS.map((key) => {
      const row = measuredByState.get(key.state)?.rows.find((r) => r.id === key.id);
      return {
        ...key,
        maxDelta: row?.maxDelta ?? null,
        delta: row?.delta ?? null,
        passed: row !== undefined && row.maxDelta !== null && row.maxDelta <= 3.0,
      };
    });
    const gap04Ok = gap04Margin.length === 8 && gap04Margin.every((m) => m.passed);
    const workspaceOverflows = r2States.map(([st, vp]) => ({ state: st, viewport: vp, ...overflowByState.get(st) }));
    const g10a01Passed = r2Ok && r3Ok && gap04Ok && workspaceOverflows.every((o) => o.ok);
    const g10a01 = {
      id: "G10a-01",
      passed: g10a01Passed,
      coordinateSpace: "window-relative (baseline rect - containers[0].rect[0..1])",
      r2: { count: r2Rows.length, maxDelta: Math.max(...r2Rows.map((r) => r.maxDelta ?? 0)), missing: r2Rows.filter((r) => r.missing).length, exceeded: r2Rows.filter((r) => r.exceedsTolerance).length, passed: r2Ok },
      r3: { count: r3Rows.length, maxDelta: Math.max(...r3Rows.map((r) => r.maxDelta ?? 0)), missing: r3Rows.filter((r) => r.missing).length, exceeded: r3Rows.filter((r) => r.exceedsTolerance).length, passed: r3Ok },
      gap04Margin,
      workspaceOverflows,
    };
    await writeEvidence("g10a-01-r2-r3-margin.json", g10a01);

    // ===== G10a-02: R6 + R7 专属元素与三视口基线 =====
    await measureState("07-node-selected-medium", "medium", true);
    await measureState("07-node-selected-short", "short", true);
    await measureState("08-document-toc-open-medium", "medium", false);
    await measureState("08-document-toc-open-short", "short", false);

    const r6Exclusive = [];
    const r7Exclusive = [];
    for (const [vpKey, [w, h]] of Object.entries(VIEWPORTS)) {
      await browser("set", "viewport", String(w), String(h));
      r6Exclusive.push({ viewportKey: vpKey, ...(await evalJson("window.yanAuditR6Exclusive()")) });
      r7Exclusive.push({ viewportKey: vpKey, ...(await evalJson("window.yanAuditR7Exclusive()")) });
    }
    const r6BaselineRows = ["07-node-selected", "07-node-selected-medium", "07-node-selected-short"].flatMap((st) => measuredByState.get(st).rows);
    const r6NonOptional = r6BaselineRows.filter((r) => !r.skipped);
    const r7BaselineRows = ["08-document-toc-open", "08-document-toc-open-medium", "08-document-toc-open-short"].flatMap((st) => measuredByState.get(st).rows);

    const r6BaselineOk = r6NonOptional.length === 60 && r6NonOptional.every((r) => !r.missing && !r.exceedsTolerance);
    const r7BaselineOk = r7BaselineRows.length === 63 && r7BaselineRows.every((r) => !r.missing && !r.exceedsTolerance);
    const g10a02Passed = r6BaselineOk && r7BaselineOk && r6Exclusive.every((v) => v.passed) && r7Exclusive.every((v) => v.passed);
    const g10a02 = {
      id: "G10a-02",
      passed: g10a02Passed,
      r6: {
        baseline: { total: r6BaselineRows.length, nonOptional: r6NonOptional.length, skipped: r6BaselineRows.filter((r) => r.skipped).length, missing: r6NonOptional.filter((r) => r.missing).length, exceeded: r6NonOptional.filter((r) => r.exceedsTolerance).length, maxDelta: Math.max(...r6NonOptional.map((r) => r.maxDelta ?? 0)), passed: r6BaselineOk },
        exclusive: r6Exclusive,
      },
      r7: {
        baseline: { total: r7BaselineRows.length, missing: r7BaselineRows.filter((r) => r.missing).length, exceeded: r7BaselineRows.filter((r) => r.exceedsTolerance).length, maxDelta: Math.max(...r7BaselineRows.map((r) => r.maxDelta ?? 0)), passed: r7BaselineOk },
        exclusive: r7Exclusive,
      },
    };
    await writeEvidence("g10a-02-r6-r7-exclusive.json", g10a02);

    // ===== G10a-03: R4 + R5 菜单文案顺序、视口内边距与共存防错 =====
    const r4r5Viewports = [];
    for (const [vpKey, [w, h]] of Object.entries(VIEWPORTS)) {
      await browser("set", "viewport", String(w), String(h));
      r4r5Viewports.push({ viewportKey: vpKey, ...(await evalJson("window.yanAuditR4R5Menus()")) });
    }
    const g10a03Passed = r4r5Viewports.every((v) => v.passed);
    const g10a03 = {
      id: "G10a-03",
      passed: g10a03Passed,
      geometryBaseline: null,
      viewports: r4r5Viewports,
    };
    await writeEvidence("g10a-03-r4-r5-menus.json", g10a03);

    // ===== G10a-04: R8 四视口简洁态往返与零状态残留 =====
    const r8Specs = [
      { viewportKey: "large", size: [1512, 851], minimalState: "10-minimal", r2State: "06-workspace" },
      { viewportKey: "medium", size: [756, 851], minimalState: "10-minimal-medium", r2State: "06-workspace-medium" },
      { viewportKey: "short", size: [756, 427], minimalState: "10-minimal-short", r2State: "06-workspace-short" },
      { viewportKey: "narrow", size: [380, 700], minimalState: null, r2State: null },
    ];
    const r8Viewports = [];
    for (const spec of r8Specs) {
      await browser("set", "viewport", String(spec.size[0]), String(spec.size[1]));
      const r2Anchors = spec.r2State ? validAnchors.filter((a) => a.state === spec.r2State && a.viewport === spec.viewportKey) : [];
      const minAnchor = spec.minimalState ? validAnchors.find((a) => a.state === spec.minimalState && a.viewport === spec.viewportKey) : null;
      const audit = await evalJson(`window.yanAuditR8Roundtrip(${JSON.stringify(r2Anchors.map((a) => a.selector))}, ${JSON.stringify(minAnchor?.selector ?? null)})`);
      const minimalBaseline = minAnchor ? compareAnchors([minAnchor], [audit.minimalAttachmentRect], false) : null;
      const r2AfterBaseline = r2Anchors.length ? compareAnchors(r2Anchors, audit.r2AfterRects, false) : null;
      const minimalOk = !minimalBaseline || (minimalBaseline.missing === 0 && minimalBaseline.exceeded === 0);
      const r2AfterOk = !r2AfterBaseline || (r2AfterBaseline.missing === 0 && r2AfterBaseline.exceeded === 0);
      r8Viewports.push({
        viewportKey: spec.viewportKey,
        viewport: spec.size,
        hostAdaptationNote: audit.hostAdaptationNote,
        minimalBaseline: minimalBaseline ? { maxDelta: minimalBaseline.maxDelta, passed: minimalOk, rows: minimalBaseline.rows } : null,
        cleanControls: audit.cleanControls,
        pairs: audit.pairs,
        maxOverlapArea: audit.maxOverlapArea,
        beforeSnapshot: audit.beforeSnapshot,
        afterSnapshot: audit.afterSnapshot,
        zeroResidualState: audit.zeroResidualState,
        r2AfterBaseline: r2AfterBaseline ? { total: r2AfterBaseline.total, passedCount: r2AfterBaseline.passed, maxDelta: r2AfterBaseline.maxDelta, missing: r2AfterBaseline.missing, exceeded: r2AfterBaseline.exceeded, passed: r2AfterOk } : null,
        passed: audit.passed && minimalOk && r2AfterOk,
      });
    }
    const g10a04Passed = r8Viewports.every((v) => v.passed);
    const g10a04 = {
      id: "G10a-04",
      passed: g10a04Passed,
      viewports: r8Viewports,
    };
    await writeEvidence("g10a-04-r8-minimal-roundtrip.json", g10a04);

    // ===== G10a-05: R9 复习卡面 + R10 本地状态面板三视口 =====
    const r9r10Viewports = [];
    for (const [vpKey, [w, h]] of Object.entries(VIEWPORTS)) {
      await browser("set", "viewport", String(w), String(h));
      r9r10Viewports.push({ viewportKey: vpKey, ...(await evalJson("window.yanAuditR9R10Panels()")) });
    }
    const g10a05Passed = r9r10Viewports.every((v) => v.passed);
    const g10a05 = {
      id: "G10a-05",
      passed: g10a05Passed,
      viewports: r9r10Viewports,
    };
    await writeEvidence("g10a-05-r9-r10-panels.json", g10a05);

    const runtimeErrors = await evalJson("window.yanGetRuntimeErrors()");
    const assertions = [
      ["G10a-01", g10a01Passed],
      ["G10a-02", g10a02Passed],
      ["G10a-03", g10a03Passed],
      ["G10a-04", g10a04Passed],
      ["G10a-05", g10a05Passed],
    ];
    const passedCount = assertions.filter(([, ok]) => ok).length;
    console.log(`${passedCount}/${assertions.length} GAP-10a R2-R10 surface assertions passed (runtimeErrors=${runtimeErrors.length})`);
    for (const [id, ok] of assertions) {
      console.log(`${ok ? "PASS" : "FAIL"} ${id}`);
    }
    if (passedCount !== assertions.length || runtimeErrors.length > 0) {
      console.error(JSON.stringify({
        runtimeErrors,
        failed: {
          G10a01: g10a01Passed ? undefined : g10a01,
          G10a02: g10a02Passed ? undefined : g10a02,
          G10a03: g10a03Passed ? undefined : g10a03,
          G10a04: g10a04Passed ? undefined : g10a04,
          G10a05: g10a05Passed ? undefined : g10a05,
        },
      }, null, 2));
      process.exitCode = 1;
    }
  } finally {
    await browser("close").catch(() => {});
    await new Promise((done) => server.close(done));
  }
} finally {
  await rm(temporary, { recursive: true, force: true }).catch(() => {});
}
