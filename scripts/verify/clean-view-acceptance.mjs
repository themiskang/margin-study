/**
 * [INPUT]: 依赖 StudyWorkspaceView、Store、featureSearch、样式表与默认 agent-browser 后端，零私有夹具依赖。
 * [OUTPUT]: 执行 GAP-09 G9-01~G9-07 合成浏览器验收；若设置 MARGINSTUDY_EVIDENCE_DIR 则落盘证据 JSON。
 * [POS]: 公开浏览器验收套件 workspace-clean-view，验证简洁显示三态、长按、笔条、快捷键、重载、模板状态栏与四视口可达性。
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

const here = dirname(fileURLToPath(import.meta.url));
const project = await realpath(resolve(here, "../.."));
const workspaceDir = join(project, "src/workspace");
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-clean-view-")));

const fixtureSource = `
import { TFile } from "obsidian";
import { Store } from "${project}/src/model/store";
import { StudyWorkspaceView } from "${project}/src/workspace/studyWorkspace";
import { FEATURE_INDEX, queryFeatures, runFeature } from "${project}/src/search/featureSearch";
import { exportMn5SceneTemplate } from "${project}/src/workspace/mn5SceneTemplates";
import { createModal } from "${project}/src/utils/modal";

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

async function createHarness() {
  fixturesHost.replaceChildren();
  const sources = new Map<string, { file: TFile; content: string }>();
  const add = (path: string, content: string) => {
    const file = new TFile(path, content.length);
    sources.set(path, { file, content });
    return file;
  };
  const alpha = add("Alpha.html", "<html><body><h1>Alpha</h1><p>MarginStudy clean view synthetic document.</p></body></html>");
  const beta = add("Beta.md", "# Beta\\n\\nAttachment note.");
  const adapterFiles = new Map<string, string>();
  const folders = new Set<string>();
  const vaultEvents = new Map<string, Set<(...args: any[]) => void>>();
  const wsEvents = new Map<string, Set<(...args: any[]) => void>>();
  const dock = () => ({ collapsed: false, collapse() { this.collapsed = true; }, expand() { this.collapsed = false; } });
  const commands: Record<string, any> = {};
  const app: any = {
    vault: {
      configDir: ".obsidian",
      getFiles: () => [...sources.values()].map(v => v.file),
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
    commands: { commands, executeCommandById: (id: string) => { const c = commands[id]; if (!c) return false; c.callback?.(); return true; } },
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
    cards: [{ id: "c1", type: "excerpt", docPath: alpha.path, front: "Card 1", tags: [], links: [], createdAt: stamp }],
    nodes: [{ id: "n1", cardId: "c1", canvasId: "canvas-1", parentId: null, title: "Node 1", collapsed: false, x: 120, y: 120 }],
    edges: [],
    srs: {},
    studySets: [{ id: "set-1", name: "CleanView Study", docPaths: [alpha.path, beta.path], documentAttachments: { [alpha.path]: [beta.path] }, createdAt: stamp }],
    canvases: [{ id: "canvas-1", studySetId: "set-1", name: "Main Map", createdAt: stamp }],
    activeStudySetId: "set-1",
    activeCanvasId: "canvas-1",
  };
  let writes = 0;
  const host: any = {
    app,
    loadData: async () => JSON.parse(JSON.stringify(disk)),
    saveData: async (value: any) => { writes++; disk = JSON.parse(JSON.stringify(value)); },
  };
  let store = new Store(host);
  await store.load();
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
  };
  commands["margin-study:toggle-clean-view"] = {
    id: "toggle-clean-view",
    name: "切换简洁显示",
    callback: () => plugin.studyWorkspace?.toggleCleanView(),
  };

  let view = new StudyWorkspaceView(leaf, plugin);
  leaf.view = view;
  plugin.studyWorkspace = view;
  view.load();
  await view.onOpen();
  await view.openFile(alpha);
  await frame();

  const reload = async (overrideState?: Record<string, unknown>) => {
    const savedState = view.getState();
    await view.onClose();
    view.unload();
    view.containerEl.remove();
    await store.flush();
    const writesBeforeReopen = writes;
    store = new Store(host);
    await store.load();
    plugin.store = store;
    view = new StudyWorkspaceView(leaf, plugin);
    leaf.view = view;
    plugin.studyWorkspace = view;
    view.load();
    await view.setState(overrideState ?? savedState);
    await view.onOpen();
    await frame();
    await store.flush();
    return { view, store, root: view.contentEl, writesDelta: writes - writesBeforeReopen };
  };

  return {
    app, alpha, beta, leaf, plugin,
    get view() { return view; },
    get store() { return store; },
    get root() { return view.contentEl; },
    get writes() { return writes; },
    reload,
    dispose: async () => { await view.onClose(); view.unload(); view.containerEl.remove(); },
  };
}

function rectObj(node: Element | null) {
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function intersectArea(a: ReturnType<typeof rectObj>, b: ReturnType<typeof rectObj>): number {
  if (!a || !b) return 0;
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return w * h;
}

function hitCheck(node: Element | null) {
  if (!node) return { ok: false, reason: "missing" };
  const r = node.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  const ok = !!hit && (hit === node || node.contains(hit));
  return { ok, cx, cy, hitTag: hit?.tagName ?? null, hitClass: hit?.className ?? null };
}

(window as any).runG901 = async () => {
  const h = await createHarness();
  try {
    h.store.setStudyInterface("set-1", "scenes");
    (h.view as any).state.library = true;
    (h.view as any).state.auxiliary = "cards";
    (h.view as any).state.showTabs = true;
    (h.view as any).fixedViewsOpen = true;
    (h.view as any).applyLayout();
    (h.view as any).refresh(true);
    await frame();
    // Ensure .ms-fixed-views has visible content so we can verify its hide/show transition
    const fixedHost = h.root.querySelector<HTMLElement>(".ms-fixed-views")!;
    if (!fixedHost.children.length) {
      const marker = document.createElement("div");
      marker.className = "ms-fixed-view-probe";
      marker.style.cssText = "width:60px;height:20px;";
      marker.textContent = "Fixed";
      fixedHost.append(marker);
    }
    await frame();

    const selectors = [
      ".ms-workspace-toolbar",
      ".ms-workspace-library",
      ".ms-workspace-splitter-library",
      ".ms-workspace-auxiliary",
      ".ms-workspace-splitter-auxiliary",
      ".ms-workspace-tabs",
      ".ms-workspace-floating-actions",
      ".ms-fixed-views",
      ".ms-bottom-capsule-shell",
    ];
    const vis = () => Object.fromEntries(selectors.map(s => [s, !!h.root.querySelector<HTMLElement>(s)?.checkVisibility()]));
    const strip = () => h.root.querySelector<HTMLElement>(".ms-clean-pen-strip")!;
    const domCount = () => h.root.querySelectorAll(":not(.ms-workspace-notice)").length;
    const dataSnap = () => JSON.stringify(Object.fromEntries(Object.entries(h.root.dataset).sort()));

    const initialDom = domCount();
    const initialData = dataSnap();
    const cycles: any[] = [];
    for (let i = 0; i < 3; i++) {
      const normalVis = vis();
      assert(h.view.isCleanView() === false, "cycle " + i + " normal isCleanView");
      assert(Object.values(normalVis).every(Boolean), "cycle " + i + " normal visibility: " + JSON.stringify(normalVis));
      assert(strip().hidden === true, "cycle " + i + " normal strip hidden");

      h.view.setCleanView(true);
      await frame();
      const hiddenVis = vis();
      assert(h.view.isCleanView() === true, "cycle " + i + " clean-hidden isCleanView");
      assert(Object.values(hiddenVis).every(v => !v), "cycle " + i + " clean-hidden visibility: " + JSON.stringify(hiddenVis));
      assert(strip().hidden === true, "cycle " + i + " clean-hidden strip hidden");

      (h.view.getReader() as any).setHandwritingMode("pen");
      await frame();
      const hwVis = vis();
      assert(Object.values(hwVis).every(v => !v), "cycle " + i + " clean-hw visibility: " + JSON.stringify(hwVis));
      assert(strip().hidden === false && strip().checkVisibility() === true, "cycle " + i + " clean-hw strip visible");

      (h.view.getReader() as any).setHandwritingMode("off");
      h.view.setCleanView(false);
      await frame();
      const restoredVis = vis();
      assert(h.view.isCleanView() === false, "cycle " + i + " restored isCleanView");
      assert(Object.values(restoredVis).every(Boolean), "cycle " + i + " restored visibility");
      assert(strip().hidden === true, "cycle " + i + " restored strip hidden");
      cycles.push({ cycle: i + 1, normalVis, hiddenVis, hwVis, restoredVis });
    }
    const finalDom = domCount();
    const finalData = dataSnap();
    assert(finalDom === initialDom, "DOM count drifted: " + initialDom + " -> " + finalDom);
    assert(finalData === initialData, "dataset drifted: " + initialData + " -> " + finalData);
    return { passed: true, initialDom, finalDom, datasetEqual: finalData === initialData, cycles };
  } finally {
    await h.dispose();
  }
};

(window as any).runG902 = async () => {
  const h = await createHarness();
  const startErrors = errors.length;
  try {
    const handle = h.root.querySelector<HTMLButtonElement>(".ms-clean-view-handle")!;
    assert(handle, "handle missing");

    // 1. Short press (threshold - 100ms = 320ms)
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: 1, clientX: 20, clientY: 10 }));
    await wait(320);
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: 1, clientX: 20, clientY: 10 }));
    await frame();
    const seq1 = h.view.isCleanView();
    assert(seq1 === false, "seq1 short press entered clean view");

    // 2. Move > 8px then wait threshold + 100ms (520ms)
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: 2, clientX: 20, clientY: 10 }));
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, pointerId: 2, clientX: 35, clientY: 10 }));
    await wait(520);
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: 2, clientX: 35, clientY: 10 }));
    await frame();
    const seq2 = h.view.isCleanView();
    assert(seq2 === false, "seq2 pointermove>8px entered clean view");

    // 3. Primary pointer threshold + 80ms (500ms) + pointerup + immediate synthetic click
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: 3, clientX: 20, clientY: 10 }));
    await wait(500);
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: 3, clientX: 20, clientY: 10 }));
    const seq3AfterUp = h.view.isCleanView();
    handle.click();
    const seq3AfterReleaseClick = h.view.isCleanView();
    assert(seq3AfterUp === true && seq3AfterReleaseClick === true, "seq3 failed: up=" + seq3AfterUp + " click=" + seq3AfterReleaseClick);

    // 4. Next tap click restores immediately
    await frame();
    handle.click();
    await frame();
    const seq4 = h.view.isCleanView();
    assert(seq4 === false, "seq4 tap did not exit clean view");

    // 5a. window.blur before threshold
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: 4, clientX: 20, clientY: 10 }));
    await wait(150);
    window.dispatchEvent(new Event("blur"));
    await wait(520);
    const seq5Blur = h.view.isCleanView();
    assert(seq5Blur === false, "seq5 blur still flipped state");

    // 5b. onClose() before threshold
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: 5, clientX: 20, clientY: 10 }));
    await wait(150);
    await h.view.onClose();
    await wait(520);
    const seq5Close = h.view.isCleanView();
    const newErrors = errors.slice(startErrors);
    assert(seq5Close === false && newErrors.length === 0, "seq5 onClose failed: state=" + seq5Close + " errors=" + JSON.stringify(newErrors));

    return { passed: true, seq1, seq2, seq3AfterUp, seq3AfterReleaseClick, seq4, seq5Blur, seq5Close, errors: newErrors };
  } finally {
    await h.dispose().catch(() => {});
  }
};

(window as any).runG903 = async () => {
  const h = await createHarness();
  try {
    const reader = h.view.getReader() as any;
    const presets = (h.view as any).handwritingPresets();
    const normalPen = presets.find((p: any) => p.type !== "pencil" && p.type !== "highlighter");
    const strip = h.root.querySelector<HTMLElement>(".ms-clean-pen-strip")!;
    const pressedMap = () => Object.fromEntries([...strip.querySelectorAll<HTMLButtonElement>("button")].map(b => [b.getAttribute("aria-label"), b.getAttribute("aria-pressed")]));

    reader.setHandwritingMode("pen");
    h.view.setCleanView(true);
    await frame();

    const steps: any[] = [];
    for (const [label, expectMode, expectType] of [
      ["普通笔 1", "pen", normalPen?.type ?? "ballpoint"],
      ["荧光笔", "highlight", "highlighter"],
      ["铅笔", "pen", "pencil"],
      ["橡皮擦", "eraser", null],
    ] as const) {
      const btn = strip.querySelector<HTMLButtonElement>(\`[aria-label="\${label}"]\`)!;
      assert(btn, "missing pen strip button: " + label);
      btn.click();
      await frame();
      const mode = reader.getHandwritingMode();
      const activeId = reader.getActiveHandwritingPreset?.();
      const activeSpec = presets.find((p: any) => p.id === activeId);
      const pressed = pressedMap();
      assert(mode === expectMode, label + " mode expected " + expectMode + " got " + mode);
      if (expectType) assert(activeSpec?.type === expectType, label + " preset type expected " + expectType + " got " + activeSpec?.type);
      for (const [k, v] of Object.entries(pressed)) {
        assert(v === (k === label ? "true" : "false"), label + " aria-pressed mismatch: " + JSON.stringify(pressed));
      }
      assert(strip.hidden === false && strip.checkVisibility() === true, label + " hid clean pen strip");
      steps.push({ label, mode, activePresetId: activeId, activePresetType: activeSpec?.type ?? null, pressed, stripVisible: strip.checkVisibility() });
    }

    // Enter clean view directly from highlight and eraser
    const directEntries: Record<string, boolean> = {};
    for (const entryMode of ["highlight", "eraser"] as const) {
      h.view.setCleanView(false);
      await frame();
      reader.setHandwritingMode(entryMode);
      await frame();
      h.view.setCleanView(true);
      await frame();
      const vis = strip.hidden === false && strip.checkVisibility() === true;
      assert(vis, "direct entry from " + entryMode + " hid pen strip");
      directEntries[entryMode] = vis;
    }

    // Switch back to text
    reader.setHandwritingMode("off");
    await frame();
    const hiddenAfterText = strip.hidden === true;
    assert(hiddenAfterText, "strip stayed visible after returning to text");

    return { passed: true, steps, directEntries, hiddenAfterText };
  } finally {
    await h.dispose();
  }
};

(window as any).runG904 = async () => {
  const h = await createHarness();
  try {
    const queryHits = queryFeatures("简洁").map(f => f.id);
    assert(queryHits.includes("toggle-clean-view"), "queryFeatures('简洁') missing toggle-clean-view: " + JSON.stringify(queryHits));
    assert(FEATURE_INDEX.some(f => f.id === "toggle-clean-view"), "FEATURE_INDEX missing toggle-clean-view");

    const run1 = runFeature(h.plugin, "toggle-clean-view");
    await frame();
    const afterRun1 = h.view.isCleanView();
    const run2 = runFeature(h.plugin, "toggle-clean-view");
    await frame();
    const afterRun2 = h.view.isCleanView();
    assert(run1 && afterRun1 === true && run2 && afterRun2 === false, "runFeature toggle failed");

    // Workspace shortcut Mod+Alt+H in body
    const fireShortcut = (target: EventTarget) => target.dispatchEvent(new KeyboardEvent("keydown", { key: "h", code: "KeyH", metaKey: true, altKey: true, bubbles: true, cancelable: true }));
    fireShortcut(h.root);
    await frame();
    const sc1 = { clean: h.view.isCleanView(), dataset: h.root.dataset.cleanView };
    fireShortcut(h.root);
    await frame();
    const sc2 = { clean: h.view.isCleanView(), dataset: h.root.dataset.cleanView };
    assert(sc1.clean === true && sc1.dataset === "true" && sc2.clean === false && sc2.dataset === "false", "shortcut toggle failed");

    // Guard against input / textarea / contenteditable / modal
    let guardedChanges = 0;
    for (const tag of ["input", "textarea", "div"] as const) {
      const node = document.createElement(tag);
      if (tag === "div") node.setAttribute("contenteditable", "true");
      h.root.append(node);
      node.focus();
      const before = h.view.isCleanView();
      fireShortcut(node);
      await frame();
      if (h.view.isCleanView() !== before) guardedChanges++;
      node.remove();
    }
    const { close } = createModal("Guard Modal");
    const beforeModal = h.view.isCleanView();
    fireShortcut(window);
    await frame();
    if (h.view.isCleanView() !== beforeModal) guardedChanges++;
    close();
    assert(guardedChanges === 0, "shortcut fired inside guarded target/modal: " + guardedChanges);

    // Handle Enter and Space
    const handle = h.root.querySelector<HTMLButtonElement>(".ms-clean-view-handle")!;
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await frame();
    const afterEnter = h.view.isCleanView();
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    await frame();
    const afterSpace = h.view.isCleanView();
    assert(afterEnter === true && afterSpace === false, "handle Enter/Space failed");

    return { passed: true, queryHits, afterRun1, afterRun2, sc1, sc2, guardedChanges, afterEnter, afterSpace };
  } finally {
    await h.dispose();
  }
};

(window as any).runG905 = async () => {
  const h = await createHarness();
  const startErrors = errors.length;
  try {
    // 1. Clean-hidden reload
    h.view.setCleanView(true);
    await frame();
    const r1 = await h.reload();
    const hiddenReload = {
      isCleanView: r1.view.isCleanView(),
      toolbarVisible: !!r1.root.querySelector<HTMLElement>(".ms-workspace-toolbar")?.checkVisibility(),
      capsuleVisible: !!r1.root.querySelector<HTMLElement>(".ms-bottom-capsule-shell")?.checkVisibility(),
      stripHidden: !!r1.root.querySelector<HTMLElement>(".ms-clean-pen-strip")?.hidden,
      writesDelta: r1.writesDelta,
    };
    assert(hiddenReload.isCleanView === true && !hiddenReload.toolbarVisible && !hiddenReload.capsuleVisible && hiddenReload.stripHidden === true, "clean-hidden reload failed: " + JSON.stringify(hiddenReload));
    assert(hiddenReload.writesDelta === 0, "unmodified reload wrote to disk: " + hiddenReload.writesDelta);

    // 2. Clean-handwriting (highlight) reload
    (r1.view.getReader() as any).setHandwritingMode("highlight");
    await frame();
    const r2 = await h.reload();
    (r2.view.getReader() as any).setHandwritingMode("highlight");
    await frame();
    const strip2 = r2.root.querySelector<HTMLElement>(".ms-clean-pen-strip")!;
    const hwReload = {
      isCleanView: r2.view.isCleanView(),
      stripVisible: !strip2.hidden && strip2.checkVisibility(),
    };
    assert(hwReload.isCleanView === true && hwReload.stripVisible === true, "clean-handwriting reload failed: " + JSON.stringify(hwReload));

    // 3. Dirty value cleanView: "bad"
    const dirtyState = { ...r2.view.getState(), cleanView: "bad" };
    const r3 = await h.reload(dirtyState);
    const dirtyReload = {
      isCleanView: r3.view.isCleanView(),
      errors: errors.slice(startErrors),
    };
    assert(dirtyReload.isCleanView === false && dirtyReload.errors.length === 0, "dirty cleanView did not degrade: " + JSON.stringify(dirtyReload));

    return { passed: true, hiddenReload, hwReload, dirtyReload };
  } finally {
    await h.dispose();
  }
};

(window as any).runG906 = async () => {
  const h = await createHarness();
  try {
    h.store.setStudyInterface("set-1", "scenes");
    h.store.selectStudyScene("set-1", "standard", "excerpt");
    h.view.refresh(true);
    await frame();

    // Default (undefined statusBar -> full)
    const fullStatus = h.root.dataset.statusBar;
    const fullCapsuleVis = !!h.root.querySelector<HTMLElement>(".ms-bottom-capsule-shell")?.checkVisibility();
    const fullPrimaryVis = !!h.root.querySelector<HTMLElement>(".ms-bottom-primary")?.checkVisibility();
    const fullToolsVis = !!h.root.querySelector<HTMLElement>(".ms-bottom-scene-tools")?.checkVisibility();
    const fullWidth = h.root.querySelector<HTMLElement>(".ms-bottom-primary")!.getBoundingClientRect().width;
    assert(fullStatus === "full" && fullCapsuleVis && fullPrimaryVis && fullToolsVis, "default full statusBar failed");

    // Hidden
    const hiddenTpl = h.store.copySceneTemplate("standard");
    hiddenTpl.name = "Hidden Bar";
    hiddenTpl.statusBar = "hidden";
    h.store.saveSceneTemplate(hiddenTpl);
    h.store.selectStudyScene("set-1", hiddenTpl.id, "excerpt");
    h.view.refresh(true);
    await frame();
    const hiddenStatus = h.root.dataset.statusBar;
    const hiddenCapsuleVis = !!h.root.querySelector<HTMLElement>(".ms-bottom-capsule-shell")?.checkVisibility();
    assert(hiddenStatus === "hidden" && !hiddenCapsuleVis, "hidden statusBar still visible");

    // Compact: distinguishable from full & hidden + interactive controls (no dead buttons)
    const compactTpl = h.store.copySceneTemplate("standard");
    compactTpl.name = "Compact Bar";
    compactTpl.statusBar = "compact";
    h.store.saveSceneTemplate(compactTpl);
    h.store.selectStudyScene("set-1", compactTpl.id, "excerpt");
    h.view.refresh(true);
    await frame();
    const compactStatus = h.root.dataset.statusBar;
    const compactCapsuleVis = !!h.root.querySelector<HTMLElement>(".ms-bottom-capsule-shell")?.checkVisibility();
    const compactPrimaryVis = !!h.root.querySelector<HTMLElement>(".ms-bottom-primary")?.checkVisibility();
    const compactToolsVis = !!h.root.querySelector<HTMLElement>(".ms-bottom-scene-tools")?.checkVisibility();
    const compactWidth = h.root.querySelector<HTMLElement>(".ms-bottom-primary")!.getBoundingClientRect().width;
    assert(compactStatus === "compact" && compactCapsuleVis && compactPrimaryVis && !compactToolsVis && compactWidth < fullWidth, "compact statusBar not distinguishable: " + JSON.stringify({ compactStatus, compactCapsuleVis, compactPrimaryVis, compactToolsVis, compactWidth, fullWidth }));

    // Test collapse toggle in compact mode (real response, no dead button)
    const collapseBtn = h.root.querySelector<HTMLButtonElement>(".ms-bottom-collapse")!;
    collapseBtn.click();
    await frame();
    const compactCollapsedVis = !!h.root.querySelector<HTMLElement>(".ms-bottom-primary")?.checkVisibility();
    h.root.querySelector<HTMLButtonElement>(".ms-bottom-collapse")!.click();
    await frame();
    const compactExpandedVis = !!h.root.querySelector<HTMLElement>(".ms-bottom-primary")?.checkVisibility();
    assert(!compactCollapsedVis && compactExpandedVis, "compact collapse button is dead");

    // Test scene tab click in compact mode (real response)
    const hwTab = h.root.querySelector<HTMLButtonElement>('.ms-bottom-scene-tab[data-scene-id="handwriting"]')!;
    hwTab.click();
    await frame();
    const sceneAfterClick = h.store.getStudyScene("set-1")?.sceneId;
    assert(sceneAfterClick === "handwriting", "compact scene tab did not switch scene: " + sceneAfterClick);

    // Traditional interface fixed to full
    h.store.setStudyInterface("set-1", "traditional");
    h.view.refresh(true);
    await frame();
    const tradStatus = h.root.dataset.statusBar;
    const tradCapsuleVis = !!h.root.querySelector<HTMLElement>(".ms-bottom-capsule-shell")?.checkVisibility();
    assert(tradStatus === "full" && tradCapsuleVis, "traditional interface did not lock statusBar=full");

    // Export/import checks
    const mn5Export = exportMn5SceneTemplate(compactTpl) as Record<string, unknown>;
    assert(!("statusBar" in mn5Export), "mn5 export leaked statusBar");
    let miniThrew = false;
    try {
      const bad = JSON.parse(h.store.exportSceneTemplate(compactTpl.id, "margin-study"));
      bad.template.id = "bad-mini";
      bad.template.statusBar = "mini";
      h.store.importSceneTemplate(JSON.stringify(bad));
    } catch { miniThrew = true; }
    assert(miniThrew, "statusBar='mini' did not throw");

    return {
      passed: true,
      full: { status: fullStatus, capsuleVis: fullCapsuleVis, primaryVis: fullPrimaryVis, toolsVis: fullToolsVis, width: fullWidth },
      hidden: { status: hiddenStatus, capsuleVis: hiddenCapsuleVis },
      compact: { status: compactStatus, capsuleVis: compactCapsuleVis, primaryVis: compactPrimaryVis, toolsVis: compactToolsVis, width: compactWidth, collapsedVis: compactCollapsedVis, expandedVis: compactExpandedVis, sceneAfterClick },
      traditional: { status: tradStatus, capsuleVis: tradCapsuleVis },
      mn5HasStatusBar: "statusBar" in mn5Export,
      miniThrew,
    };
  } finally {
    await h.dispose();
  }
};

let g907Harness: Awaited<ReturnType<typeof createHarness>> | null = null;
(window as any).prepareG907 = async () => {
  if (g907Harness) await g907Harness.dispose().catch(() => {});
  g907Harness = await createHarness();
  g907Harness.store.setStudyInterface("set-1", "scenes");
  (g907Harness.view as any).state.library = false;
  (g907Harness.view as any).state.auxiliary = "none";
  (g907Harness.view as any).applyLayout();
  g907Harness.view.refresh(true);
  await frame();
  return true;
};

(window as any).measureG907Viewport = async (width: number, height: number) => {
  const h = g907Harness!;
  const inBounds = (r: ReturnType<typeof rectObj>, root: ReturnType<typeof rectObj>) =>
    !!r && !!root && r.left >= root.left - 1 && r.right <= root.right + 1 && r.top >= root.top - 1 && r.bottom <= root.bottom + 1 && r.width > 0 && r.height > 0;

  // Reset to normal
  (h.view.getReader() as any).setHandwritingMode("off");
  if ((h.view as any).state.documentNavigation) (h.view as any).toggleDocumentNavigation();
  h.view.setCleanView(false);
  await frame();
  const rootRect = rectObj(h.root)!;
  const normalHandle = rectObj(h.root.querySelector(".ms-clean-view-handle"));
  const normalHit = hitCheck(h.root.querySelector(".ms-clean-view-handle"));
  assert(inBounds(normalHandle, rootRect) && normalHit.ok, \`normal handle fail @\${width}x\${height}\`);

  // Clean hidden
  h.view.setCleanView(true);
  await frame();
  const cleanHandleEl = h.root.querySelector(".ms-clean-view-handle");
  const attachEl = h.root.querySelector(".ms-workspace-attachment-capsule");
  const cleanHandle = rectObj(cleanHandleEl);
  const attachRect = rectObj(attachEl);
  const cleanHandleHit = hitCheck(cleanHandleEl);
  const attachHit = attachEl ? hitCheck(attachEl) : { ok: true };
  const handleAttachOverlap = intersectArea(cleanHandle, attachRect);
  assert(inBounds(cleanHandle, rootRect) && cleanHandleHit.ok, \`clean handle fail @\${width}x\${height}\`);
  assert(!attachEl || (inBounds(attachRect, rootRect) && attachHit.ok), \`attachment fail @\${width}x\${height}\`);
  assert(handleAttachOverlap === 0, \`handle/attachment overlap=\${handleAttachOverlap} @\${width}x\${height} handle=\${JSON.stringify(cleanHandle)} attach=\${JSON.stringify(attachRect)}\`);

  // Clean handwriting
  (h.view.getReader() as any).setHandwritingMode("pen");
  await frame();
  const stripEl = h.root.querySelector<HTMLElement>(".ms-clean-pen-strip")!;
  const stripRect = rectObj(stripEl);
  const penButtons = [...stripEl.querySelectorAll<HTMLButtonElement>("button")];
  const penChecks = penButtons.map(b => ({ label: b.getAttribute("aria-label"), inBounds: inBounds(rectObj(b), rootRect), hit: hitCheck(b) }));
  const handleStripOverlap = intersectArea(cleanHandle, stripRect);
  const attachStripOverlap = intersectArea(attachRect, stripRect);
  assert(penButtons.length === 4 && penChecks.every(c => c.inBounds && c.hit.ok), \`pen strip fail @\${width}x\${height}: \${JSON.stringify(penChecks)}\`);
  assert(handleStripOverlap === 0 && attachStripOverlap === 0, \`strip overlap @\${width}x\${height}: hs=\${handleStripOverlap} as=\${attachStripOverlap}\`);

  // Clean + TOC open
  (h.view as any).toggleDocumentNavigation();
  await frame();
  const tocTabs = [...h.root.querySelectorAll<HTMLButtonElement>(".ms-document-navigation-tabs [role='tab']")];
  const tocChecks = tocTabs.map(t => ({ label: t.getAttribute("aria-label") ?? t.textContent?.trim(), inBounds: inBounds(rectObj(t), rootRect), hit: hitCheck(t) }));
  assert(tocTabs.length === 5 && tocChecks.every(c => c.inBounds && c.hit.ok), \`toc tabs fail @\${width}x\${height}: \${JSON.stringify(tocChecks)}\`);

  return {
    viewport: [width, height],
    rootRect,
    normalHandle,
    cleanHandle,
    attachRect,
    stripRect,
    overlaps: { handleAttach: handleAttachOverlap, handleStrip: handleStripOverlap, attachStrip: attachStripOverlap },
    penChecks,
    tocTabCount: tocTabs.length,
    tocChecks,
  };
};

(window as any).cleanupG907 = async () => {
  if (g907Harness) { await g907Harness.dispose().catch(() => {}); g907Harness = null; }
  return true;
};
(window as any).ready = true;
`;

try {
  await writeFile(join(temporary, "obsidian-fixture.ts"), (await readFile(join(workspaceDir, "obsidian-fixture.txt"), "utf8")).replaceAll("__PROJECT__", project));
  await writeFile(join(temporary, "clean-view-fixture.ts"), fixtureSource);
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
  ].map((name) => readFile(join(project, name), "utf8")));
  await writeFile(join(temporary, "styles.css"), styles.join("\n"));
  await writeFile(
    join(temporary, "index.html"),
    '<!doctype html><meta charset="utf-8"><title>MarginStudy GAP-09 clean-view acceptance</title><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0;height:100%}#fixtures{height:100vh;width:100vw}.test-item-view{height:100%;width:100%;display:flex;flex-direction:column}.test-item-view>.view-content{height:100%;width:100%;overflow:hidden}</style><main id="fixtures"></main><script type="module" src="/fixture.js"></script>',
  );

  await build({
    entryPoints: [join(temporary, "clean-view-fixture.ts")],
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
  const session = `marginstudy-clean-view-${process.pid}`;
  const browser = (...args) => runBrowser(session, ...args);

  const evidenceDir = process.env.MARGINSTUDY_EVIDENCE_DIR ? resolve(process.env.MARGINSTUDY_EVIDENCE_DIR, "gap-09") : null;
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

    const g901 = await evalJson("window.runG901()");
    await writeEvidence("g9-01-tristate-cycle.json", g901);
    const g902 = await evalJson("window.runG902()");
    await writeEvidence("g9-02-longpress-threshold.json", g902);
    const g903 = await evalJson("window.runG903()");
    await writeEvidence("g9-03-pen-strip-actions.json", g903);
    const g904 = await evalJson("window.runG904()");
    await writeEvidence("g9-04-shortcuts-sync.json", g904);
    const g905 = await evalJson("window.runG905()");
    await writeEvidence("g9-05-reload-restore.json", g905);
    const g906 = await evalJson("window.runG906()");
    await writeEvidence("g9-06-template-statusbar.json", g906);

    // G9-07 across 4 viewports
    await evalJson("window.prepareG907()");
    const viewports = [[1512, 851], [756, 851], [756, 427], [380, 700]];
    const vpResults = [];
    for (const [w, h] of viewports) {
      await browser("set", "viewport", String(w), String(h));
      vpResults.push(await evalJson(`window.measureG907Viewport(${w}, ${h})`));
    }
    await evalJson("window.cleanupG907()");
    const g907 = { passed: true, viewports: vpResults };
    await writeEvidence("g9-07-narrow-reachability.json", g907);

    console.log("PASS workspace-clean-view: G9-01~G9-07 all passed across 4 viewports");
  } finally {
    await browser("close").catch(() => {});
    await new Promise((done) => server.close(done));
  }
} finally {
  await rm(temporary, { recursive: true, force: true }).catch(() => {});
}
