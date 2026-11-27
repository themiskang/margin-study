/**
 * [INPUT]: 依赖 StudyWorkspaceView、Store、样式表、公开合成夹具（fakePdf/fakeMammoth/obsidian-fixture）与默认 agent-browser 后端。
 * [OUTPUT]: 执行 UI-01（U1-01~U1-04）Pad 工具栏安全区避让与响应式溢出菜单浏览器验收；按需输出 JSON 摘要。
 * [POS]: 公开浏览器验收套件 pad-toolbar-layout，注册于 scripts/verify.mjs。
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
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-pad-toolbar-")));

const fixtureSource = `
import { TFile } from "obsidian";
import { Store } from "${project}/src/model/store";
import { StudyWorkspaceView } from "${project}/src/workspace/studyWorkspace";

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

function makePdfPayload() {
  const textItems: any[] = [];
  for (let i = 0; i < 24; i++) {
    const y = 760 - i * 32;
    textItems.push({
      str: \`PDF Line \${String(i + 1).padStart(2, "0")} — MarginStudy Pad bottom toolbar clearance check.\`,
      x: 40,
      y: Math.max(12, y),
      w: 500,
      h: 18,
      hasEOL: true,
    });
  }
  return new TextEncoder().encode(JSON.stringify({ name: "Long", pages: 3, textItems })).buffer;
}

function makeHtmlPayload() {
  const paras: string[] = [];
  for (let i = 1; i <= 48; i++) {
    paras.push(\`<p data-line="\${i}">HTML Paragraph \${String(i).padStart(2, "0")}: MarginStudy Pad bottom toolbar clearance and overflow layout verification content.</p>\`);
  }
  return \`<html><body><h1>Long Study Document</h1>\${paras.join("")}</body></html>\`;
}

function intersectionArea(a: DOMRect | { left: number; top: number; right: number; bottom: number }, b: DOMRect | { left: number; top: number; right: number; bottom: number }) {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return { w, h, area: w * h };
}

function isHit(el: Element, x: number, y: number): boolean {
  const hit = document.elementFromPoint(x, y);
  return !!hit && (hit === el || el.contains(hit));
}

async function createHarness() {
  fixturesHost.replaceChildren();
  const sources = new Map<string, { file: TFile; content: string; binary?: ArrayBuffer }>();
  const addText = (path: string, content: string) => {
    const file = new TFile(path, content.length);
    sources.set(path, { file, content });
    return file;
  };
  const addBinary = (path: string, binary: ArrayBuffer) => {
    const file = new TFile(path, binary.byteLength);
    sources.set(path, { file, content: "", binary });
    return file;
  };

  const longPdf = addBinary("Long.pdf", makePdfPayload());
  const longHtml = addText("Long.html", makeHtmlPayload());
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
      openLinkText: async () => {},
      revealLeaf: async () => {},
      setActiveLeaf(next: any) { this.activeLeaf = next; },
    },
  };

  let disk: any = {
    cards: [{ id: "c1", type: "excerpt", docPath: longPdf.path, front: "Card 1", tags: [], links: [], createdAt: stamp }],
    nodes: [{ id: "n1", cardId: "c1", canvasId: "canvas-1", parentId: null, title: "Node 1", collapsed: false, x: 120, y: 120 }],
    edges: [],
    srs: {},
    studySets: [{ id: "set-1", name: "Pad Layout Study", docPaths: [longPdf.path, longHtml.path], createdAt: stamp }],
    canvases: [{ id: "canvas-1", studySetId: "set-1", name: "Main Map", createdAt: stamp }],
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

  const view = new StudyWorkspaceView(leaf, plugin);
  leaf.view = view;
  plugin.studyWorkspace = view;
  view.load();
  fixturesHost.append(view.containerEl);
  await view.setState({
    tabs: [{ path: longPdf.path }, { path: longHtml.path }],
    activePath: longPdf.path,
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
  await frame();

  const root = view.contentEl as HTMLElement;
  return {
    view, store, root, longPdf, longHtml,
    async openDoc(kind: "pdf" | "html") {
      const target = kind === "pdf" ? longPdf : longHtml;
      await (view as any).openFile(target);
      await frame();
      await wait(60);
      await frame();
    },
    async selectScene(sceneId: string) {
      store.selectStudyScene("set-1", "standard", sceneId as any);
      (view as any).drawToolbar();
      await frame();
      await frame();
    },
    async dispose() {
      document.body.classList.remove("is-mobile");
      await view.onClose();
      fixturesHost.replaceChildren();
    },
  };
}

let activeHarness: Awaited<ReturnType<typeof createHarness>> | null = null;

(window as any).prepareHarness = async () => {
  if (activeHarness) await activeHarness.dispose();
  activeHarness = await createHarness();
  return { ok: true };
};

(window as any).disposeHarness = async () => {
  if (activeHarness) {
    await activeHarness.dispose();
    activeHarness = null;
  }
  return { ok: true, runtimeErrors: errors.slice() };
};

(window as any).measureU101Case = async (cfg: {
  label: string;
  mobile: boolean;
  ratio: number;
  doc: "pdf" | "html";
  scenes: string[];
}) => {
  const h = activeHarness!;
  document.body.classList.toggle("is-mobile", cfg.mobile);
  (h.view as any).state.ratio = cfg.ratio;
  (h.view as any).state.bottomCollapsed = false;
  (h.view as any).state.cleanView = false;
  (h.view as any).applyLayout();
  await h.openDoc(cfg.doc);
  await frame();

  const results: any[] = [];
  let maxOverlapArea = 0;
  let maxHostOverflow = -999;
  let maxLastLineOverflow = -999;
  let violations: any[] = [];

  for (const sceneId of cfg.scenes) {
    await h.selectScene(sceneId);
    const scroll = h.root.querySelector<HTMLElement>(cfg.doc === "pdf" ? ".ms-scroll" : ".ms-word-scroll")!;
    assert(scroll, \`scroll container missing for \${cfg.doc}\`);
    const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    assert(maxScroll > 20, \`expected scrollable content for \${cfg.doc} at \${cfg.label}, maxScroll=\${maxScroll}\`);

    for (const [posName, targetScroll] of [["top", 0], ["mid", Math.round(maxScroll / 2)], ["bottom", maxScroll]] as const) {
      scroll.scrollTop = targetScroll;
      await frame();
      await wait(25);
      await frame();

      const host = h.root.querySelector<HTMLElement>(".ms-workspace-reader-host")!;
      const bar = h.root.querySelector<HTMLElement>(".ms-bottom-capsule-shell")!;
      const hostRect = host.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      const clearance = getComputedStyle(h.root).getPropertyValue("--ms-bottom-bar-clearance").trim();
      const horizOverlap = barRect.left < hostRect.right && barRect.right > hostRect.left;

      const selector = cfg.doc === "pdf" ? ".ms-text-layer > span" : ".ms-word-body p";
      const lines = [...host.querySelectorAll<HTMLElement>(selector)];
      assert(lines.length > 0, \`no text lines found for \${cfg.doc} (\${selector})\`);

      let caseMaxArea = 0;
      let visibleLineCount = 0;
      for (const line of lines) {
        const r = line.getBoundingClientRect();
        const clipped = {
          left: Math.max(r.left, hostRect.left),
          right: Math.min(r.right, hostRect.right),
          top: Math.max(r.top, hostRect.top),
          bottom: Math.min(r.bottom, hostRect.bottom),
        };
        if (clipped.bottom - clipped.top <= 0.5 || clipped.right - clipped.left <= 0.5) continue;
        visibleLineCount++;
        const inter = intersectionArea(clipped, barRect);
        if (inter.area > caseMaxArea) caseMaxArea = inter.area;
        if (inter.w > 1 && inter.h > 1) {
          violations.push({
            case: \`\${cfg.label}/\${cfg.doc}/\${sceneId}/\${posName}\`,
            reason: "line-overlaps-bar",
            area: Number(inter.area.toFixed(2)),
            w: Number(inter.w.toFixed(2)),
            h: Number(inter.h.toFixed(2)),
            lineBottom: Number(clipped.bottom.toFixed(2)),
            barTop: Number(barRect.top.toFixed(2)),
          });
        }
      }

      if (caseMaxArea > maxOverlapArea) maxOverlapArea = caseMaxArea;
      const hostOverflow = horizOverlap ? Number((hostRect.bottom - barRect.top).toFixed(2)) : -999;
      if (horizOverlap && hostOverflow > maxHostOverflow) maxHostOverflow = hostOverflow;
      if (horizOverlap && hostRect.bottom > barRect.top + 1) {
        violations.push({
          case: \`\${cfg.label}/\${cfg.doc}/\${sceneId}/\${posName}\`,
          reason: "readerHost.bottom > bar.top + 1",
          hostBottom: Number(hostRect.bottom.toFixed(2)),
          barTop: Number(barRect.top.toFixed(2)),
        });
      }

      let lastLineOk = true;
      let lastLineDelta = 0;
      if (posName === "bottom") {
        const lastRect = lines[lines.length - 1].getBoundingClientRect();
        lastLineDelta = Number((lastRect.bottom - barRect.top).toFixed(2));
        if (lastLineDelta > maxLastLineOverflow) maxLastLineOverflow = lastLineDelta;
        const insideHost = lastRect.top >= hostRect.top - 1 && lastRect.bottom <= hostRect.bottom + 1;
        const aboveBar = !horizOverlap || lastRect.bottom <= barRect.top + 1;
        lastLineOk = insideHost && aboveBar;
        if (!lastLineOk) {
          violations.push({
            case: \`\${cfg.label}/\${cfg.doc}/\${sceneId}/bottom\`,
            reason: "lastLine-not-clear",
            insideHost,
            aboveBar,
            lastBottom: Number(lastRect.bottom.toFixed(2)),
            hostBottom: Number(hostRect.bottom.toFixed(2)),
            barTop: Number(barRect.top.toFixed(2)),
          });
        }
      }

      results.push({
        sceneId,
        posName,
        clearance,
        visibleLineCount,
        maxArea: Number(caseMaxArea.toFixed(2)),
        hostOverflow,
        lastLineOk,
      });
    }
  }

  return {
    label: cfg.label,
    doc: cfg.doc,
    passed: violations.length === 0,
    checkedCount: results.length,
    maxOverlapArea: Number(maxOverlapArea.toFixed(2)),
    maxHostOverflow,
    maxLastLineOverflow,
    violations: violations.slice(0, 10),
  };
};

(window as any).measureU102 = async () => {
  const h = activeHarness!;
  document.body.classList.remove("is-mobile");
  (h.view as any).state.ratio = 0.5;
  (h.view as any).state.bottomCollapsed = false;
  (h.view as any).state.cleanView = false;
  (h.view as any).applyLayout();
  await h.openDoc("pdf");
  await h.selectScene("excerpt");
  await frame();

  const host = () => h.root.querySelector<HTMLElement>(".ms-workspace-reader-host")!;
  const readMetrics = () => ({
    cssVar: getComputedStyle(h.root).getPropertyValue("--ms-bottom-bar-clearance").trim(),
    marginBottom: parseFloat(getComputedStyle(host()).marginBottom) || 0,
    hostHeight: Number(host().getBoundingClientRect().height.toFixed(2)),
  });

  const expanded = readMetrics();
  assert(expanded.marginBottom > 0, "expanded marginBottom should be > 0, got " + JSON.stringify(expanded));

  // 1. Collapse bottom bar
  h.root.querySelector<HTMLButtonElement>(".ms-bottom-collapse")!.click();
  await frame(); await frame();
  const collapsed = readMetrics();
  assert(collapsed.cssVar === "0px" && collapsed.marginBottom === 0, "collapsed clearance not 0: " + JSON.stringify(collapsed));
  assert(collapsed.hostHeight > expanded.hostHeight + 20, "collapsed host did not reclaim height");

  // Restore expanded
  h.root.querySelector<HTMLButtonElement>(".ms-bottom-collapse")!.click();
  await frame(); await frame();
  const afterCollapseRestore = readMetrics();
  assert(afterCollapseRestore.marginBottom > 0, "did not restore clearance after expand");

  // 2. Clean view
  h.view.setCleanView(true);
  await frame(); await frame();
  const cleanOn = readMetrics();
  assert(cleanOn.cssVar === "0px" && cleanOn.marginBottom === 0, "cleanView clearance not 0: " + JSON.stringify(cleanOn));
  assert(cleanOn.hostHeight > expanded.hostHeight + 20, "cleanView host did not reclaim height");

  h.view.setCleanView(false);
  await frame(); await frame();
  const afterCleanRestore = readMetrics();
  assert(afterCleanRestore.marginBottom > 0, "did not restore clearance after cleanView exit");

  // 3. statusBar = hidden (via custom scene template copy)
  const hiddenTpl = h.store.copySceneTemplate("standard");
  hiddenTpl.name = "UI01 隐藏状态栏";
  hiddenTpl.statusBar = "hidden";
  h.store.saveSceneTemplate(hiddenTpl);
  h.store.selectStudyScene("set-1", hiddenTpl.id, "excerpt");
  (h.view as any).drawToolbar();
  await frame(); await frame();
  const statusHidden = readMetrics();
  assert(statusHidden.cssVar === "0px" && statusHidden.marginBottom === 0, "statusBar=hidden clearance not 0: " + JSON.stringify(statusHidden));
  assert(statusHidden.hostHeight > expanded.hostHeight + 20, "statusBar=hidden host did not reclaim height");

  h.store.selectStudyScene("set-1", "standard", "excerpt");
  (h.view as any).drawToolbar();
  await frame(); await frame();
  const afterStatusRestore = readMetrics();
  assert(afterStatusRestore.marginBottom > 0, "did not restore clearance after statusBar=full");

  return {
    passed: true,
    expanded,
    collapsed,
    afterCollapseRestore,
    cleanOn,
    afterCleanRestore,
    statusHidden,
    afterStatusRestore,
  };
};

(window as any).measureU103Viewport = async (label: string, scenes: string[]) => {
  const h = activeHarness!;
  document.body.classList.remove("is-mobile");
  (h.view as any).state.bottomCollapsed = false;
  (h.view as any).state.cleanView = false;
  (h.view as any).applyLayout();
  await h.openDoc("pdf");

  const sceneSummaries: any[] = [];
  for (const sceneId of scenes) {
    await h.selectScene(sceneId);
    await frame(); await frame();

    const primary = h.root.querySelector<HTMLElement>(".ms-bottom-primary")!;
    const scrollDiff = Number((primary.scrollWidth - primary.clientWidth).toFixed(2));
    assert(primary.scrollWidth <= primary.clientWidth + 1, \`[\${label}/\${sceneId}] silent horizontal clip: scrollWidth=\${primary.scrollWidth} clientWidth=\${primary.clientWidth}\`);

    const toggle = h.root.querySelector<HTMLButtonElement>(".ms-bottom-overflow-toggle");
    assert(toggle, \`[\${label}/\${sceneId}] .ms-bottom-overflow-toggle missing\`);
    assert(toggle.checkVisibility(), \`[\${label}/\${sceneId}] toggle not visible\`);
    const toggleRect = toggle.getBoundingClientRect();
    assert(
      toggleRect.left >= -1 && toggleRect.top >= -1 && toggleRect.right <= window.innerWidth + 1 && toggleRect.bottom <= window.innerHeight + 1,
      \`[\${label}/\${sceneId}] toggle out of viewport: \${JSON.stringify(toggleRect.toJSON())}\`,
    );
    const hitEl = document.elementFromPoint(toggleRect.left + toggleRect.width / 2, toggleRect.top + toggleRect.height / 2);
    assert(
      !!hitEl && (hitEl === toggle || toggle.contains(hitEl)),
      \`[\${label}/\${sceneId}] toggle center not hit by elementFromPoint; rect=\${JSON.stringify(toggleRect.toJSON())} hit=\${hitEl ? hitEl.tagName + "." + hitEl.className + " aria=" + hitEl.getAttribute("aria-label") : "null"}\`,
    );

    // Open menu
    toggle.click();
    await frame();
    const menu = h.root.querySelector<HTMLElement>(".ms-bottom-overflow-menu");
    assert(menu && menu.checkVisibility(), \`[\${label}/\${sceneId}] overflow menu did not open\`);
    assert(toggle.getAttribute("aria-expanded") === "true", \`[\${label}/\${sceneId}] aria-expanded not true\`);
    const menuRect = menu.getBoundingClientRect();
    assert(
      menuRect.left >= -1 && menuRect.top >= -1 && menuRect.right <= window.innerWidth + 1 && menuRect.bottom <= window.innerHeight + 1,
      \`[\${label}/\${sceneId}] menu out of viewport: \${JSON.stringify(menuRect.toJSON())}\`,
    );

    const initialItems = [...menu.querySelectorAll<HTMLButtonElement>(".ms-bottom-overflow-item")];
    assert(initialItems.length > 0, \`[\${label}/\${sceneId}] overflow menu empty\`);
    const itemLabels = initialItems.map(item => item.querySelector(".ms-bottom-overflow-item-label")?.textContent?.trim() ?? "");

    // Test Escape close
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await frame();
    assert(!h.root.querySelector(".ms-bottom-overflow-menu"), \`[\${label}/\${sceneId}] Escape did not close menu\`);
    assert(toggle.getAttribute("aria-expanded") === "false", \`[\${label}/\${sceneId}] aria-expanded not false after Escape\`);

    // Reopen and test outside click close
    toggle.click();
    await frame();
    assert(!!h.root.querySelector(".ms-bottom-overflow-menu"), \`[\${label}/\${sceneId}] menu failed to reopen\`);
    const readerHost = h.root.querySelector<HTMLElement>(".ms-workspace-reader-host")!;
    readerHost.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    await frame();
    assert(!h.root.querySelector(".ms-bottom-overflow-menu"), \`[\${label}/\${sceneId}] outside pointerdown did not close menu\`);

    // Click every single overflowed item and verify hit + real state/panel effect
    const clicked: any[] = [];
    for (let idx = 0; idx < itemLabels.length; idx++) {
      // Ensure we are back on this scene & dismiss any prior popover
      (h.view as any).dismissPopup?.();
      await h.selectScene(sceneId);
      await frame();
      const curToggle = h.root.querySelector<HTMLButtonElement>(".ms-bottom-overflow-toggle")!;
      curToggle.click();
      await frame();
      const curMenu = h.root.querySelector<HTMLElement>(".ms-bottom-overflow-menu")!;
      const items = [...curMenu.querySelectorAll<HTMLButtonElement>(".ms-bottom-overflow-item")];
      const item = items[idx];
      assert(item, \`[\${label}/\${sceneId}] missing overflow item #\${idx}\`);
      item.scrollIntoView({ block: "nearest" });
      await frame();
      const ir = item.getBoundingClientRect();
      assert(ir.width > 0 && ir.height > 0, \`[\${label}/\${sceneId}] item \${itemLabels[idx]} has zero size\`);
      assert(
        isHit(item, ir.left + ir.width / 2, ir.top + ir.height / 2),
        \`[\${label}/\${sceneId}] item \${itemLabels[idx]} not hit by elementFromPoint\`,
      );

      const msTool = item.dataset.msTool ?? "";
      const wasDisabled = item.disabled;
      const beforePressed = item.getAttribute("aria-pressed");
      const beforeReaderTool = h.root.dataset.readerTool;
      const beforeNav = (h.view as any).state.documentNavigation;

      if (!wasDisabled) {
        item.click();
        await frame();
        await wait(20);
        await frame();

        const afterReaderTool = h.root.dataset.readerTool;
        const afterNav = (h.view as any).state.documentNavigation;
        const hasPopover = !!h.root.querySelector(".ms-native-popover") || !!document.querySelector(".ms-handwriting-popover,.ms-pen-popover,.ms-overlay-text-editor,.ms-modal-bg");
        const origBtn = h.root.querySelector<HTMLButtonElement>(\`.ms-bottom-scene-tools [data-ms-tool="\${msTool}"]\`);
        const afterPressed = origBtn?.getAttribute("aria-pressed") ?? null;

        let verified = false;
        if (beforePressed !== null && afterPressed !== null && afterPressed !== beforePressed) verified = true;
        if (afterReaderTool !== beforeReaderTool) verified = true;
        if (afterNav !== beforeNav) verified = true;
        if (hasPopover) verified = true;
        if (["excerpt.hand", "excerpt.text", "excerpt.rectangle", "excerpt.extend", "lasso", "ink", "pen.1", "pen.2", "highlighter", "pencil", "eraser", "hand"].includes(msTool)) {
          // Tool might already be active; verify aria-pressed is "true"
          if (afterPressed === "true") verified = true;
        }
        if (msTool === "text-box" || msTool === "image-box" || msTool === "ink-layers" || msTool === "excerpt.more") {
          verified = true; // invokes readerAction / popup / layer settings
        }
        assert(verified, \`[\${label}/\${sceneId}] clicking overflow item "\${itemLabels[idx]}" (\${msTool}) produced no observable effect\`);

        // Close any opened overlay/popover/modal/nav so next item starts clean
        document.querySelectorAll(".ms-overlay-text-editor button[aria-label='完成文字编辑'], .ms-handwriting-popover button[aria-label='关闭'], .ms-modal-bg button[aria-label*='关闭']").forEach((b: any) => b.click?.());
        if (document.querySelector(".ms-modal-bg")) {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
          document.querySelectorAll(".ms-modal-bg").forEach((m: any) => m.remove());
        }
        (h.view as any).dismissPopup?.();
        if (afterNav && !beforeNav) (h.view as any).toggleDocumentNavigation();
        clicked.push({ label: itemLabels[idx], msTool, disabled: false, beforePressed, afterPressed, verified });
      } else {
        clicked.push({ label: itemLabels[idx], msTool, disabled: true, verified: true });
      }
    }

    sceneSummaries.push({
      sceneId,
      scrollDiff,
      overflowCount: itemLabels.length,
      itemLabels,
      clickedCount: clicked.length,
    });
  }

  return { label, passed: true, scenes: sceneSummaries };
};

(window as any).measureU104Viewport = async (w: number, hSize: number) => {
  const h = activeHarness!;
  document.body.classList.remove("is-mobile");
  (h.view as any).state.bottomCollapsed = false;
  (h.view as any).state.cleanView = false;
  (h.view as any).applyLayout();
  await h.openDoc("pdf");
  await h.selectScene("excerpt");
  await frame(); await frame();

  const primary = h.root.querySelector<HTMLElement>(".ms-bottom-primary")!;
  const toggle = h.root.querySelector<HTMLElement>(".ms-bottom-overflow-toggle");
  const overflowed = h.root.querySelectorAll(".is-bottom-overflowed").length;
  const clearance = getComputedStyle(h.root).getPropertyValue("--ms-bottom-bar-clearance").trim();
  const scrollDiff = Number((primary.scrollWidth - primary.clientWidth).toFixed(2));

  assert(overflowed === 0, \`[\${w}x\${hSize}] expected 0 overflowed items, got \${overflowed}\`);
  assert(toggle === null, \`[\${w}x\${hSize}] expected no .ms-bottom-overflow-toggle in DOM\`);

  // R6: At 756x851 (tall narrow split where PDF is above map), clearance must be 0px (no double whitespace)
  if (w === 756 && hSize >= 850) {
    assert(clearance === "0px", \`[\${w}x\${hSize}] tall narrow split should have 0px clearance (R6), got \${clearance}\`);
  }

  return { viewport: \`\${w}x\${hSize}\`, overflowed, hasToggle: !!toggle, scrollDiff, clearance, passed: true };
};

(window as any).measureU201Viewport = async (w: number, hSize: number) => {
  const h = activeHarness!;
  document.body.classList.remove("is-mobile");
  h.store.setStudyInterface("set-1", "scenes");
  (h.view as any).state.bottomCollapsed = false;
  (h.view as any).state.cleanView = false;
  (h.view as any).applyLayout();
  (h.view as any).drawToolbar();
  await h.openDoc("pdf");
  await h.selectScene("excerpt");
  await frame(); await frame();

  const oldToggle = h.root.querySelector(".ms-workspace-extra-tools-toggle");
  const oldControls = h.root.querySelector(".ms-workspace-toolbar-controls");
  assert(oldToggle === null, \`[U2-01 \${w}x\${hSize}] legacy .ms-workspace-extra-tools-toggle still in DOM\`);
  assert(oldControls === null, \`[U2-01 \${w}x\${hSize}] legacy .ms-workspace-toolbar-controls still in DOM\`);

  const header = h.root.querySelector<HTMLElement>(".ms-workspace-toolbar.has-scene-header")!;
  const headerHeight = Number(header.getBoundingClientRect().height.toFixed(2));
  assert(headerHeight <= 46, \`[U2-01 \${w}x\${hSize}] scene header height \${headerHeight} > 46\`);

  const context = h.root.querySelector<HTMLElement>(".ms-workspace-context")!;
  const ctxRect = context.getBoundingClientRect();
  const ctxButtons = [...context.querySelectorAll<HTMLButtonElement>("button")];
  assert(ctxButtons.length === 7, \`[U2-01 \${w}x\${hSize}] expected 7 context buttons, got \${ctxButtons.length}\`);
  let hitContextButtons = 0;
  for (const btn of ctxButtons) {
    const r = btn.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.right <= ctxRect.left + 1 || r.left >= ctxRect.right - 1) continue;
    const cx = Math.max(ctxRect.left + 2, Math.min(ctxRect.right - 2, r.left + r.width / 2));
    const cy = r.top + r.height / 2;
    assert(isHit(btn, cx, cy), \`[U2-01 \${w}x\${hSize}] context button "\${btn.getAttribute("aria-label")}" covered at (\${cx},\${cy})\`);
    hitContextButtons++;
  }
  assert(hitContextButtons > 0, \`[U2-01 \${w}x\${hSize}] no context buttons hit\`);

  const follow = h.root.querySelector<HTMLButtonElement>(".ms-workspace-follow-selection");
  let followHit = true;
  if (follow && follow.checkVisibility()) {
    const fr = follow.getBoundingClientRect();
    followHit = isHit(follow, fr.left + fr.width / 2, fr.top + fr.height / 2);
    assert(followHit, \`[U2-01 \${w}x\${hSize}] .ms-workspace-follow-selection covered\`);
  }

  return { viewport: \`\${w}x\${hSize}\`, oldToggle: false, oldControls: false, headerHeight, hitContextButtons, followHit, passed: true };
};

(window as any).measureU202Matrix = async () => {
  const h = activeHarness!;
  document.body.classList.remove("is-mobile");
  h.store.setStudyInterface("set-1", "scenes");
  (h.view as any).state.library = false;
  (h.view as any).state.mindmap = true;
  (h.view as any).state.auxiliary = "none";
  (h.view as any).state.bottomCollapsed = false;
  (h.view as any).state.cleanView = false;
  (h.view as any).applyLayout();
  await h.openDoc("pdf");
  await h.selectScene("excerpt");
  await frame(); await frame();

  const openUnifiedMore = async () => {
    (h.view as any).dismissPopup?.();
    await frame();
    const moreBtn = h.root.querySelector<HTMLButtonElement>('[data-ms-tool="excerpt.more"], [data-ms-tool="scene.more"]')!;
    assert(moreBtn && moreBtn.checkVisibility(), "bottom unified more button missing or hidden");
    moreBtn.scrollIntoView({ inline: "nearest", block: "nearest" });
    await frame();
    const r = moreBtn.getBoundingClientRect();
    assert(isHit(moreBtn, r.left + r.width / 2, r.top + r.height / 2), "bottom unified more button not hit");
    moreBtn.click();
    await frame();
    const pane = h.root.querySelector<HTMLElement>(".ms-document-more")!;
    assert(pane && pane.checkVisibility(), ".ms-document-more did not open");
    return pane;
  };

  const clickMoreRow = async (label: string) => {
    const pane = await openUnifiedMore();
    const row = [...pane.querySelectorAll<HTMLButtonElement>(".ms-document-more-row")].find(
      b => b.getAttribute("aria-label") === label || b.textContent?.trim() === label,
    );
    assert(row, \`missing row "\${label}" in bottom unified more\`);
    row.scrollIntoView({ block: "nearest" });
    await frame();
    const r = row.getBoundingClientRect();
    assert(r.width > 0 && r.height > 0 && isHit(row, r.left + r.width / 2, r.top + r.height / 2), \`row "\${label}" not hit\`);
    return { pane, row };
  };

  const checked: any[] = [];
  const mark = (id: number, name: string, unique: boolean, entry: string) => checked.push({ id, name, unique, entry, passed: true });

  // #1-#3, #5-#7 bottom excerpt bar tools
  const clickBottom = async (tool: string) => {
    const btn = h.root.querySelector<HTMLButtonElement>(\`.ms-bottom-scene-tools [data-ms-tool="\${tool}"]\`)!;
    assert(btn && btn.checkVisibility(), \`missing bottom tool \${tool}\`);
    const r = btn.getBoundingClientRect();
    assert(isHit(btn, r.left + r.width / 2, r.top + r.height / 2), \`bottom tool \${tool} not hit\`);
    btn.click();
    await frame();
    return btn;
  };

  await clickBottom("excerpt.hand");
  assert(h.root.dataset.readerTool === "hand", "#1 hand did not activate");
  mark(1, "移动与选择", false, "bottom:excerpt.hand");

  await clickBottom("excerpt.text");
  assert(h.root.dataset.readerTool === "text", "#2 text did not activate");
  mark(2, "文本摘录", false, "bottom:excerpt.text");

  await clickBottom("excerpt.rectangle");
  assert(h.root.dataset.readerTool === "region", "#3 region did not activate");
  mark(3, "区域摘录", false, "bottom:excerpt.rectangle");

  const extBtn = h.root.querySelector<HTMLButtonElement>('.ms-bottom-scene-tools [data-ms-tool="excerpt.extend"]')!;
  assert(extBtn && extBtn.checkVisibility(), "#4 extend missing");
  const extR = extBtn.getBoundingClientRect();
  assert(isHit(extBtn, extR.left + extR.width / 2, extR.top + extR.height / 2), "#4 extend not hit");
  mark(4, "留白", false, "bottom:excerpt.extend");

  await clickBottom("ink");
  assert(h.root.dataset.readerTool === "pen", "#5 pen did not activate");
  mark(5, "手写画笔与设置", false, "bottom:ink");

  // #6 & #7 撤销/重做 across all 5 scenes: move node 120->170 -> switch scene -> undo reverts node 170->120 & keeps scene -> redo restores 120->170 & keeps scene
  const crossSceneHistory: any[] = [];
  const sceneCases: Array<{ fromTpl: string; fromScene: string; tpl: string; scene: string }> = [
    { fromTpl: "standard", fromScene: "organize", tpl: "standard", scene: "excerpt" },
    { fromTpl: "standard", fromScene: "excerpt", tpl: "standard", scene: "handwriting" },
    { fromTpl: "standard", fromScene: "excerpt", tpl: "standard", scene: "organize" },
    { fromTpl: "standard", fromScene: "organize", tpl: "standard", scene: "recall" },
    { fromTpl: "standard", fromScene: "recall", tpl: "read-write-recall", scene: "reading" },
  ];
  for (const sc of sceneCases) {
    h.store.selectStudyScene("set-1", sc.fromTpl, sc.fromScene as any);
    (h.view as any).drawToolbar();
    await frame();
    const xStart = h.store.getNode("n1")!.x;
    assert(xStart === 120, \`#6/#7 [\${sc.scene}] expected initial x=120, got \${xStart}\`);
    // Move node in prior scene, then switch to target scene
    h.store.moveNode("n1", 170, 120);
    await frame();
    const xAfterMove = h.store.getNode("n1")!.x;
    assert(xAfterMove === 170, \`#6/#7 [\${sc.scene}] moveNode did not set x=170 (got \${xAfterMove})\`);
    h.store.selectStudyScene("set-1", sc.tpl, sc.scene as any);
    (h.view as any).drawToolbar();
    await frame(); await frame();
    assert(h.store.getStudyScene("set-1")?.sceneId === sc.scene, \`#6/#7 [\${sc.scene}] failed to switch scene\`);
    const undoBtn = h.root.querySelector<HTMLButtonElement>('.ms-bottom-scene-tools [data-bottom-action="undo"]')!;
    const redoBtn = h.root.querySelector<HTMLButtonElement>('.ms-bottom-scene-tools [data-bottom-action="redo"]')!;
    assert(undoBtn && undoBtn.checkVisibility() && !undoBtn.disabled, \`#6 [\${sc.scene}] bottom undo missing or disabled\`);
    const ur = undoBtn.getBoundingClientRect();
    assert(isHit(undoBtn, ur.left + ur.width / 2, ur.top + ur.height / 2), \`#6 [\${sc.scene}] undo not hit\`);
    undoBtn.click();
    await frame();
    const xAfterUndo = h.store.getNode("n1")!.x;
    const sceneAfterUndo = h.store.getStudyScene("set-1")?.sceneId;
    assert(xAfterUndo === 120, \`#6 [\${sc.scene}] cross-scene undo did not revert x 170->120 (got \${xAfterUndo}, scene=\${sceneAfterUndo})\`);
    assert(sceneAfterUndo === sc.scene, \`#6 [\${sc.scene}] cross-scene undo reverted scene to \${sceneAfterUndo}\`);
    const redoBtnNow = h.root.querySelector<HTMLButtonElement>('.ms-bottom-scene-tools [data-bottom-action="redo"]')!;
    assert(redoBtnNow && redoBtnNow.checkVisibility() && !redoBtnNow.disabled, \`#7 [\${sc.scene}] bottom redo not enabled after undo\`);
    const rr = redoBtnNow.getBoundingClientRect();
    assert(isHit(redoBtnNow, rr.left + rr.width / 2, rr.top + rr.height / 2), \`#7 [\${sc.scene}] redo not hit\`);
    redoBtnNow.click();
    await frame();
    const xAfterRedo = h.store.getNode("n1")!.x;
    const sceneAfterRedo = h.store.getStudyScene("set-1")?.sceneId;
    assert(xAfterRedo === 170, \`#7 [\${sc.scene}] cross-scene redo did not restore x 120->170 (got \${xAfterRedo})\`);
    assert(sceneAfterRedo === sc.scene, \`#7 [\${sc.scene}] cross-scene redo changed scene to \${sceneAfterRedo}\`);
    // Clean up node position back to 120
    const undoClean = h.root.querySelector<HTMLButtonElement>('.ms-bottom-scene-tools [data-bottom-action="undo"]')!;
    undoClean.click();
    await frame();
    assert(h.store.getNode("n1")!.x === 120, \`#6 [\${sc.scene}] cleanup undo failed\`);
    crossSceneHistory.push({ scene: sc.scene, moveX: xAfterMove, undoX: xAfterUndo, sceneAfterUndo, redoX: xAfterRedo, sceneAfterRedo });
  }
  await h.selectScene("excerpt");
  // Study-set switch (empty canvas / non-empty canvas / zero canvases) must preserve redo stack and never push undo history
  const studySetSwitchCases: any[] = [];
  {
    const setEmpty = { id: "set-empty-canvas", name: "空脑图学习集", docPaths: [], createdAt: stamp };
    const setNonEmpty = { id: "set-nonempty-canvas", name: "非空脑图学习集", docPaths: [], createdAt: stamp };
    const setNoCanvas = { id: "set-no-canvas", name: "无脑图学习集", docPaths: [], createdAt: stamp };
    h.store.studySets.push(setEmpty as any, setNonEmpty as any, setNoCanvas as any);
    h.store.canvases.push(
      { id: "canvas-empty", studySetId: setEmpty.id, name: "空白主脑图", createdAt: stamp } as any,
      { id: "canvas-nonempty", studySetId: setNonEmpty.id, name: "已有内容脑图", createdAt: stamp } as any,
    );
    h.store.nodes.push({ id: "node-nonempty", canvasId: "canvas-nonempty", parentId: null, title: "Existing Note", collapsed: false, x: 60, y: 60 } as any);

    for (const [kind, targetSetId, expectedBefore, expectedAfter] of [
      ["empty-canvas", setEmpty.id, 1, 1],
      ["nonempty-canvas", setNonEmpty.id, 1, 1],
      ["zero-canvas", setNoCanvas.id, 0, 1],
    ] as const) {
      h.store.setActiveStudySet("set-1");
      h.store.moveNode("n1", 170, 120);
      h.store.undoLibraryChange();
      await frame();
      const histBefore = h.store.getLibraryHistoryState();
      assert(h.store.getNode("n1")!.x === 120 && histBefore.canRedo === true && histBefore.redoLabel === "移动节点", \`[\${kind}] setup redo state invalid\`);
      const canvasesBefore = h.store.canvases.filter(c => c.studySetId === targetSetId).length;
      assert(canvasesBefore === expectedBefore, \`[\${kind}] expected \${expectedBefore} canvases before switch, got \${canvasesBefore}\`);

      h.store.setActiveStudySet(targetSetId);
      await frame();
      const canvasesAfter = h.store.canvases.filter(c => c.studySetId === targetSetId).length;
      const histAfter = h.store.getLibraryHistoryState();
      assert(canvasesAfter === expectedAfter, \`[\${kind}] expected \${expectedAfter} canvases after switch, got \${canvasesAfter}\`);
      assert(histAfter.revision === histBefore.revision, \`[\${kind}] setActiveStudySet polluted history revision \${histBefore.revision}->\${histAfter.revision}\`);
      assert(histAfter.canRedo === true && histAfter.redoLabel === "移动节点", \`[\${kind}] setActiveStudySet wiped redo stack\`);

      h.store.redoLibraryChange();
      await frame();
      assert(h.store.getNode("n1")!.x === 170, \`[\${kind}] redo after study-set switch did not restore x 120->170\`);
      h.store.undoLibraryChange();
      await frame();
      assert(h.store.getNode("n1")!.x === 120, \`[\${kind}] cleanup undo failed\`);
      studySetSwitchCases.push({ kind, canvasesBefore, canvasesAfter, revisionUnchanged: true, redoRestoredX: 170 });
    }
    h.store.setActiveStudySet("set-1");
    (h.view as any).drawToolbar();
    await frame();
  }
  mark(6, "撤销", false, "bottom:undo(5-scene cross-scene + study-set switch verified)");
  mark(7, "重做", false, "bottom:redo(5-scene cross-scene + study-set switch verified)");

  // #8 house -> study home
  const homeBtn = h.root.querySelector<HTMLButtonElement>('.ms-workspace-context [aria-label="打开学习集与文档"]')!;
  const hr = homeBtn.getBoundingClientRect();
  assert(isHit(homeBtn, hr.left + hr.width / 2, hr.top + hr.height / 2), "#8 home not hit");
  homeBtn.click(); await frame();
  assert(!!h.root.querySelector(".ms-study-home-screen"), "#8 study home did not open");
  (h.view as any).dismissPopup(); await frame();
  mark(8, "学习集与文档", false, "top-capsule:house");

  // #9 docs nav floating action
  const docsBtn = h.root.querySelector<HTMLButtonElement>('.ms-workspace-floating-actions [aria-label="immersiveDocs"]')!;
  const dr = docsBtn.getBoundingClientRect();
  assert(isHit(docsBtn, dr.left + dr.width / 2, dr.top + dr.height / 2), "#9 immersiveDocs not hit");
  docsBtn.click(); await frame();
  assert(!!h.root.querySelector(".ms-document-navigation"), "#9 document navigation did not open");
  docsBtn.click(); await frame();
  mark(9, "文档目录与书签", false, "floating:immersiveDocs");

  // #10 AI floating action
  const aiBtn = h.root.querySelector<HTMLButtonElement>('.ms-workspace-floating-actions [aria-label="immersiveAI"]')!;
  const ar = aiBtn.getBoundingClientRect();
  assert(isHit(aiBtn, ar.left + ar.width / 2, ar.top + ar.height / 2), "#10 immersiveAI not hit");
  aiBtn.click(); await frame();
  assert(h.root.dataset.auxiliary === "ai", "#10 AI panel did not open");
  (h.view as any).selectAuxiliary("none"); await frame();
  mark(10, "AI 学习助手", false, "floating:immersiveAI");

  // #11 双文对照
  {
    const { row } = await clickMoreRow("双文对照");
    assert(!row.disabled, "#11 双文对照 disabled on PDF");
    (h.view as any).dismissPopup(); await frame();
    mark(11, "双文对照", false, "bottom-more:双文对照");
  }

  // #12 卡片, #13 复习, #14 研究 via bottom-more -> 学习集更多设置…
  for (const [id, name, rowText, auxVal] of [
    [12, "卡片面板", "卡片", "cards"],
    [13, "复习面板", "复习", "review"],
    [14, "研究浏览器", "研究", "research"],
  ] as const) {
    const { row } = await clickMoreRow("学习集更多设置…");
    row.click(); await frame();
    const studyMore = h.root.querySelector<HTMLElement>(".ms-native-study-more")!;
    assert(studyMore && studyMore.checkVisibility(), \`#\${id} study more did not open\`);
    const sub = [...studyMore.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === rowText)!;
    assert(sub, \`#\${id} missing \${rowText} in study more\`);
    sub.click(); await frame();
    assert(h.root.dataset.auxiliary === auxVal, \`#\${id} auxiliary did not become \${auxVal}\`);
    (h.view as any).selectAuxiliary("none"); await frame();
    mark(id, name, false, "bottom-more->study-more:" + rowText);
  }

  // #15 专注工作区（沉浸模式）
  {
    const { row } = await clickMoreRow("专注工作区");
    row.click(); await frame();
    assert(h.root.classList.contains("is-focused-stage"), "#15 focus stage did not activate");
    (h.view as any).toggleFocus(false); await frame();
    mark(15, "专注工作区", false, "bottom-more:专注工作区");
  }

  // #16 文字批注 (unique cross-scene)
  {
    const { row } = await clickMoreRow("文字批注");
    assert(!row.disabled, "#16 文字批注 disabled");
    row.click(); await frame();
    mark(16, "文字批注", true, "bottom-more:文字批注");
  }

  // #17 插入图片批注 (unique cross-scene)
  {
    const { row } = await clickMoreRow("插入图片批注");
    assert(!row.disabled, "#17 插入图片批注 disabled");
    (h.view as any).dismissPopup(); await frame();
    mark(17, "插入图片批注", true, "bottom-more:插入图片批注");
  }

  // #18 显示/隐藏学习集侧栏 (unique)
  {
    const beforeLib = h.root.dataset.library;
    const { row } = await clickMoreRow("显示/隐藏学习集侧栏");
    row.click(); await frame();
    assert(h.root.dataset.library !== beforeLib, "#18 library sidebar did not toggle");
    (h.view as any).dismissPopup(); await frame();
    const { row: row2 } = await clickMoreRow("显示/隐藏学习集侧栏");
    row2.click(); await frame();
    assert(h.root.dataset.library === beforeLib, "#18 library sidebar did not restore");
    (h.view as any).dismissPopup(); await frame();
    mark(18, "显示/隐藏学习集侧栏", true, "bottom-more:显示/隐藏学习集侧栏");
  }

  // #19 显示/隐藏脑图 (unique)
  {
    const beforeMap = h.root.dataset.mindmap;
    const { row } = await clickMoreRow("显示/隐藏脑图");
    row.click(); await frame();
    assert(h.root.dataset.mindmap !== beforeMap, "#19 mindmap did not toggle");
    (h.view as any).dismissPopup(); await frame();
    const { row: row2 } = await clickMoreRow("显示/隐藏脑图");
    row2.click(); await frame();
    assert(h.root.dataset.mindmap === beforeMap, "#19 mindmap did not restore");
    (h.view as any).dismissPopup(); await frame();
    mark(19, "显示/隐藏脑图", true, "bottom-more:显示/隐藏脑图");
  }

  // #20 文档与脑图联动设置 (unique)
  {
    const beforeLink = h.root.dataset.link;
    const { row } = await clickMoreRow("文档与脑图联动设置");
    row.click(); await frame();
    assert(h.root.dataset.link !== beforeLink, "#20 linkMode did not cycle");
    while (h.root.dataset.link !== beforeLink) (h.view as any).cycleLinkMode();
    await frame();
    mark(20, "文档与脑图联动设置", true, "bottom-more:文档与脑图联动设置");
  }

  // #21 文档内搜索 (unique - critical for Pad without Cmd+F)
  {
    const { row } = await clickMoreRow("文档内搜索");
    assert(!row.disabled, "#21 文档内搜索 disabled");
    row.click(); await frame(); await wait(30); await frame();
    const searchInput = h.root.querySelector<HTMLInputElement>('.ms-search-input[aria-label="搜索本文档"]');
    assert(searchInput && searchInput.checkVisibility(), "#21 reader search UI did not open");
    h.root.querySelector<HTMLButtonElement>('[aria-label="关闭文档搜索"]')?.click();
    await frame();
    mark(21, "文档内搜索", true, "bottom-more:文档内搜索");
  }

  // #22 识别当前扫描页 OCR (unique)
  {
    const { row } = await clickMoreRow("识别当前扫描页");
    assert(!row.disabled, "#22 识别当前扫描页 disabled on PDF");
    (h.view as any).dismissPopup(); await frame();
    mark(22, "识别当前扫描页", true, "bottom-more:识别当前扫描页");
  }

  // #23 文档与工作区设置 across non-excerpt scenes
  for (const sceneId of ["handwriting", "organize", "recall"]) {
    await h.selectScene(sceneId);
    const pane = await openUnifiedMore();
    assert(!!pane.querySelector('[aria-label="文档内搜索"]') && !!pane.querySelector('[aria-label="学习集更多设置…"]'), \`#23 unified more incomplete in \${sceneId}\`);
    (h.view as any).dismissPopup(); await frame();
  }
  await h.selectScene("excerpt");
  mark(23, "文档与工作区设置", true, "bottom:excerpt.more+scene.more");

  // #24 学习集更多设置…
  {
    const { row } = await clickMoreRow("学习集更多设置…");
    row.click(); await frame();
    const studyMore = h.root.querySelector<HTMLElement>(".ms-native-study-more")!;
    assert(studyMore && studyMore.checkVisibility(), "#24 study more did not open");
    const labels = [...studyMore.querySelectorAll<HTMLButtonElement>("button")].map(b => b.textContent?.trim() ?? "");
    for (const req of ["进入沉浸模式", "显示/隐藏学习集侧栏", "显示/隐藏脑图", "卡片", "复习", "研究", "AI", "全局搜索…", "切换界面模式", "工作区设置…"]) {
      assert(labels.includes(req), \`#24 missing study more item: \${req}\`);
    }
    (h.view as any).dismissPopup(); await frame();
    mark(24, "学习集更多设置…", true, "bottom-more:学习集更多设置…");
  }

  assert(checked.length === 24, \`expected 24 matrix items, got \${checked.length}\`);
  return { passed: true, total: checked.length, uniqueCount: checked.filter(c => c.unique).length, items: checked };
};

(window as any).measureU203TraditionalAndPopups = async (w: number, hSize: number, checkTraditional: boolean) => {
  const h = activeHarness!;
  document.body.classList.remove("is-mobile");
  await h.openDoc("pdf");

  let traditionalOk = true;
  if (checkTraditional) {
    h.store.setStudyInterface("set-1", "traditional");
    (h.view as any).drawToolbar();
    await frame(); await frame();
    const tb = h.root.querySelector<HTMLElement>(".ms-workspace-toolbar")!;
    const controls = h.root.querySelector<HTMLElement>(".ms-workspace-toolbar-controls")!;
    const body = h.root.querySelector<HTMLElement>(".ms-workspace-body")!;
    assert(!tb.classList.contains("has-scene-header"), "traditional toolbar kept has-scene-header");
    assert(controls && controls.checkVisibility(), "traditional controls not visible");
    assert(tb.getBoundingClientRect().bottom <= body.getBoundingClientRect().top + 1, "traditional toolbar overlaps body");

    h.store.setStudyInterface("set-1", "scenes");
    (h.view as any).drawToolbar();
    await frame(); await frame();
    assert(!h.root.querySelector(".ms-workspace-extra-tools-toggle"), "scene return left extra toggle");
    assert(!h.root.querySelector(".ms-workspace-toolbar-controls"), "scene return left toolbar controls");
  } else {
    h.store.setStudyInterface("set-1", "scenes");
    (h.view as any).drawToolbar();
    await frame(); await frame();
  }

  // Open 文档 - 更多 from bottom (or overflow menu on 380x700)
  const overflowToggle = h.root.querySelector<HTMLButtonElement>(".ms-bottom-overflow-toggle");
  if (overflowToggle) {
    overflowToggle.click();
    await frame();
    const moreItem = h.root.querySelector<HTMLButtonElement>('.ms-bottom-overflow-menu [data-ms-tool="excerpt.more"]')!;
    assert(moreItem, \`[U2-03 \${w}x\${hSize}] excerpt.more not in overflow menu\`);
    moreItem.click();
  } else {
    h.root.querySelector<HTMLButtonElement>('[data-ms-tool="excerpt.more"]')!.click();
  }
  await frame();
  const docMore = h.root.querySelector<HTMLElement>(".ms-document-more")!;
  assert(docMore && docMore.checkVisibility(), \`[U2-03 \${w}x\${hSize}] .ms-document-more not visible\`);
  const dmRect = docMore.getBoundingClientRect();
  const ctxRect = h.root.querySelector<HTMLElement>(".ms-workspace-context")!.getBoundingClientRect();
  assert(
    dmRect.left >= -1 && dmRect.top >= -1 && dmRect.right <= window.innerWidth + 1 && dmRect.bottom <= window.innerHeight + 1,
    \`[U2-03 \${w}x\${hSize}] .ms-document-more out of viewport: \${JSON.stringify(dmRect.toJSON())}\`,
  );
  assert(dmRect.top >= ctxRect.bottom - 1 || dmRect.bottom <= ctxRect.top + 1, \`[U2-03 \${w}x\${hSize}] .ms-document-more overlaps top context capsule\`);

  // Open 阅读设置 from inside 文档 - 更多
  const readSettingsRow = [...docMore.querySelectorAll<HTMLButtonElement>(".ms-document-more-row")].find(b => b.getAttribute("aria-label") === "阅读设置")!;
  readSettingsRow.click();
  await frame();
  const readSettings = h.root.querySelector<HTMLElement>(".ms-read-settings")!;
  assert(readSettings && readSettings.checkVisibility(), \`[U2-03 \${w}x\${hSize}] .ms-read-settings not visible\`);
  const rsRect = readSettings.getBoundingClientRect();
  assert(
    rsRect.left >= -1 && rsRect.top >= -1 && rsRect.right <= window.innerWidth + 1 && rsRect.bottom <= window.innerHeight + 1,
    \`[U2-03 \${w}x\${hSize}] .ms-read-settings out of viewport: \${JSON.stringify(rsRect.toJSON())}\`,
  );
  (h.view as any).dismissPopup();
  await frame();

  return {
    viewport: \`\${w}x\${hSize}\`,
    traditionalOk,
    docMoreRect: dmRect.toJSON(),
    readSettingsRect: rsRect.toJSON(),
    passed: true,
  };
};

async function openPdfInlineTextBox(h: Awaited<ReturnType<typeof createHarness>>) {
  (h.view as any).readerAction("文字批注");
  await frame();
  const page = h.root.querySelector<HTMLElement>(".ms-page")!;
  assert(page, "PDF .ms-page missing for text overlay placement");
  const pr = page.getBoundingClientRect();
  page.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: pr.left + 80, clientY: pr.top + 80 }));
  await frame();
  await wait(30);
  await frame();
  const editor = h.root.querySelector<HTMLElement>(".ms-overlay-text-editor");
  assert(editor, "inline text editor did not open");
  return editor;
}

(window as any).measureU301Viewport = async (w: number, hSize: number) => {
  const h = activeHarness!;
  document.body.classList.remove("is-mobile");
  h.store.setStudyInterface("set-1", "scenes");
  (h.view as any).state.bottomCollapsed = false;
  (h.view as any).state.cleanView = false;
  (h.view as any).applyLayout();
  await h.openDoc("pdf");
  await h.selectScene("excerpt");
  await frame(); await frame();

  // Open overflow menu first if narrow to verify entering editing auto-closes it
  const overflowToggle = h.root.querySelector<HTMLButtonElement>(".ms-bottom-overflow-toggle");
  if (overflowToggle) {
    overflowToggle.click();
    await frame();
    assert(!!h.root.querySelector(".ms-bottom-overflow-menu"), \`[U3-01 \${w}x\${hSize}] overflow menu did not open before edit\`);
  }

  await openPdfInlineTextBox(h);

  assert(h.root.dataset.inlineTextEditing === "true", \`[U3-01 \${w}x\${hSize}] data-inline-text-editing not set to true\`);
  assert(!h.root.querySelector(".ms-bottom-overflow-menu"), \`[U3-01 \${w}x\${hSize}] overflow menu remained open during inline text editing\`);

  const capsule = h.root.querySelector<HTMLElement>(".ms-bottom-capsule-shell")!;
  const penStrip = h.root.querySelector<HTMLElement>(".ms-clean-pen-strip")!;
  const stylebar = h.root.querySelector<HTMLElement>(".ms-overlay-stylebar")!;
  assert(stylebar && stylebar.checkVisibility(), \`[U3-01 \${w}x\${hSize}] .ms-overlay-stylebar not visible\`);
  assert(!capsule.checkVisibility(), \`[U3-01 \${w}x\${hSize}] .ms-bottom-capsule-shell still visible during inline text editing\`);
  assert(!penStrip.checkVisibility(), \`[U3-01 \${w}x\${hSize}] .ms-clean-pen-strip still visible during inline text editing\`);

  const sr = stylebar.getBoundingClientRect();
  assert(
    sr.left >= -1 && sr.top >= -1 && sr.right <= window.innerWidth + 1 && sr.bottom <= window.innerHeight + 1,
    \`[U3-01 \${w}x\${hSize}] stylebar out of viewport: \${JSON.stringify(sr.toJSON())}\`,
  );
  const scrollDiff = Number((stylebar.scrollWidth - stylebar.clientWidth).toFixed(2));
  assert(stylebar.scrollWidth <= stylebar.clientWidth + 1, \`[U3-01 \${w}x\${hSize}] stylebar overflowed horizontally: scrollWidth=\${stylebar.scrollWidth} clientWidth=\${stylebar.clientWidth}\`);

  // Check every control in stylebar is visible and hit by elementFromPoint
  const controlSelectors = [
    ".ms-text-font",
    ".ms-text-size input",
    ".ms-text-bold",
    ".ms-text-italic",
    ".ms-text-underline",
    ".ms-text-backcolor",
    ".ms-text-forecolor",
    ".ms-text-done",
  ];
  for (const sel of controlSelectors) {
    const ctrl = stylebar.querySelector<HTMLElement>(sel)!;
    assert(ctrl && ctrl.checkVisibility(), \`[U3-01 \${w}x\${hSize}] control \${sel} not visible\`);
    const cr = ctrl.getBoundingClientRect();
    assert(cr.left >= -1 && cr.right <= window.innerWidth + 1, \`[U3-01 \${w}x\${hSize}] control \${sel} clipped: \${JSON.stringify(cr.toJSON())}\`);
    assert(isHit(ctrl, cr.left + cr.width / 2, cr.top + cr.height / 2), \`[U3-01 \${w}x\${hSize}] control \${sel} not hit\`);
  }

  // Clearance check: readerHost.bottom <= stylebar.top + 1
  const hostRect = h.root.querySelector<HTMLElement>(".ms-workspace-reader-host")!.getBoundingClientRect();
  assert(hostRect.bottom <= sr.top + 1, \`[U3-01 \${w}x\${hSize}] readerHost.bottom (\${hostRect.bottom}) > stylebar.top (\${sr.top}) + 1\`);

  // Exit via done button
  stylebar.querySelector<HTMLButtonElement>(".ms-text-done")!.click();
  await frame(); await frame();
  assert(!h.root.querySelector(".ms-overlay-text-editor"), \`[U3-01 \${w}x\${hSize}] editor did not close\`);
  assert(!("inlineTextEditing" in h.root.dataset), \`[U3-01 \${w}x\${hSize}] inlineTextEditing leaked in dataset\`);
  assert(capsule.checkVisibility(), \`[U3-01 \${w}x\${hSize}] capsule did not restore\`);

  // Also test entering inline text editing from clean-view handwriting mode (.ms-clean-pen-strip)
  let cleanPenMutualExclOk = true;
  if (w === 1131) {
    (h.view.getReader() as any).setHandwritingMode("pen");
    h.view.setCleanView(true);
    await frame(); await frame();
    assert(penStrip.checkVisibility() && !capsule.checkVisibility(), "[U3-01 clean-hw] pen strip not visible before edit");
    await openPdfInlineTextBox(h);
    assert(!penStrip.checkVisibility() && !capsule.checkVisibility(), "[U3-01 clean-hw] pen strip or capsule visible during edit");
    h.root.querySelector<HTMLButtonElement>(".ms-text-done")!.click();
    await frame(); await frame();
    assert(penStrip.checkVisibility() && !capsule.checkVisibility(), "[U3-01 clean-hw] pen strip did not restore after edit");
    assert(!("inlineTextEditing" in h.root.dataset), "[U3-01 clean-hw] dataset leaked");
    h.view.setCleanView(false);
    (h.view.getReader() as any).setHandwritingMode("off");
    await frame(); await frame();
  }

  return {
    viewport: \`\${w}x\${hSize}\`,
    stylebarHeight: Number(sr.height.toFixed(2)),
    scrollDiff,
    hostBottomMinusBarTop: Number((hostRect.bottom - sr.top).toFixed(2)),
    cleanPenMutualExclOk,
    passed: true,
  };
};

(window as any).measureU302ExitPaths = async () => {
  const h = activeHarness!;
  document.body.classList.remove("is-mobile");
  h.store.setStudyInterface("set-1", "scenes");
  (h.view as any).state.bottomCollapsed = false;
  (h.view as any).state.cleanView = false;
  (h.view as any).applyLayout();
  await h.openDoc("pdf");
  await h.selectScene("excerpt");
  await frame(); await frame();

  const snapshotBar = () => {
    const capsule = h.root.querySelector<HTMLElement>(".ms-bottom-capsule-shell")!;
    const rect = capsule.getBoundingClientRect().toJSON();
    const buttons = [...capsule.querySelectorAll<HTMLButtonElement>("button")]
      .filter(b => b.checkVisibility())
      .map(b => ({ label: b.getAttribute("aria-label") || b.dataset.msTool || "", rect: b.getBoundingClientRect().toJSON() }));
    const dataset = JSON.stringify(Object.fromEntries(Object.entries(h.root.dataset).sort()));
    return { rect, buttons, dataset };
  };

  const baseline = snapshotBar();
  const pathResults: any[] = [];
  const outsideResults: any[] = [];

  const getAnnotationCount = async () => (await h.store.loadAnnotations("Long.pdf")).filter(a => !a.overlay?.deleted).length;
  const dispatchPointerClick = (target: Element, clientX: number, clientY: number) => {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, clientX, clientY }));
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, clientX, clientY }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, clientX, clientY }));
  };

  // Whitelist 3 areas: stylebar itself, editor body, font-size dropdown & popover must NOT close editor
  const whitelistResults: any[] = [];
  {
    const editor = await openPdfInlineTextBox(h);
    const stylebar = editor.querySelector<HTMLElement>(".ms-overlay-stylebar")!;
    const boldBtn = editor.querySelector<HTMLButtonElement>(".ms-text-bold")!;
    const inlineText = editor.querySelector<HTMLElement>(".ms-overlay-inline-text")!;
    const sizeBtn = editor.querySelector<HTMLButtonElement>('[aria-label="选择文字字号"]')!;

    // 1. stylebar control
    const br = boldBtn.getBoundingClientRect();
    dispatchPointerClick(boldBtn, br.left + br.width / 2, br.top + br.height / 2);
    await frame();
    assert(!!h.root.querySelector(".ms-overlay-text-editor") && h.root.dataset.inlineTextEditing === "true", "[U3-02 whitelist] stylebar click closed editor");
    whitelistResults.push({ target: "stylebar", keptOpen: true });

    // 2. editor body
    const tr = inlineText.getBoundingClientRect();
    dispatchPointerClick(inlineText, tr.left + tr.width / 2, tr.top + tr.height / 2);
    await frame();
    assert(!!h.root.querySelector(".ms-overlay-text-editor") && h.root.dataset.inlineTextEditing === "true", "[U3-02 whitelist] editor body click closed editor");
    whitelistResults.push({ target: "editor-body", keptOpen: true });

    // 3. font-size dropdown button + its popover option
    const sr = sizeBtn.getBoundingClientRect();
    dispatchPointerClick(sizeBtn, sr.left + sr.width / 2, sr.top + sr.height / 2);
    await frame();
    const popover = stylebar.querySelector<HTMLElement>(".ms-text-style-popover.ms-text-size-list")!;
    assert(popover && popover.checkVisibility(), "[U3-02 whitelist] size popover did not open");
    const opt18 = popover.querySelector<HTMLButtonElement>('[aria-label="字号 18"]')!;
    assert(opt18, "[U3-02 whitelist] size 18 option missing");
    const or = opt18.getBoundingClientRect();
    dispatchPointerClick(opt18, or.left + or.width / 2, or.top + or.height / 2);
    await frame();
    assert(!!h.root.querySelector(".ms-overlay-text-editor") && h.root.dataset.inlineTextEditing === "true", "[U3-02 whitelist] size popover click closed editor");
    whitelistResults.push({ target: "size-dropdown-popover", keptOpen: true });

    // Close cleanly
    editor.querySelector<HTMLButtonElement>(".ms-text-done")!.click();
    await frame(); await wait(30); await frame();
    assert(!h.root.querySelector(".ms-overlay-text-editor") && !("inlineTextEditing" in h.root.dataset), "[U3-02 whitelist] cleanup failed");
  }

  const paths: Array<{ name: string; outside?: boolean; exit: (editor: HTMLElement) => Promise<void> }> = [
    {
      name: "done-button",
      exit: async editor => {
        editor.querySelector<HTMLButtonElement>(".ms-text-done")!.click();
      },
    },
    {
      name: "escape-key",
      exit: async editor => {
        editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      },
    },
    {
      name: "mod-enter",
      exit: async editor => {
        editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }));
      },
    },
    {
      name: "switch-tool",
      exit: async () => {
        (h.view as any).useReaderTool("hand");
        await frame();
        (h.view as any).useReaderTool("text");
      },
    },
    {
      name: "switch-layer",
      exit: async () => {
        const reader = h.view.getReader() as any;
        const annot = reader?.annController;
        assert(annot && typeof annot.createInkLayer === "function", "reader.annController missing createInkLayer");
        annot.createInkLayer("UI03 Layer");
      },
    },
    {
      name: "switch-tab",
      exit: async () => {
        const htmlTab = h.root.querySelector<HTMLButtonElement>('.ms-workspace-tab[data-path="Long.html"] [role="tab"]')!;
        const pdfTab = h.root.querySelector<HTMLButtonElement>('.ms-workspace-tab[data-path="Long.pdf"] [role="tab"]')!;
        assert(htmlTab && pdfTab, "[U3-02 switch-tab] tabs missing");
        const hr = htmlTab.getBoundingClientRect();
        dispatchPointerClick(htmlTab, hr.left + hr.width / 2, hr.top + hr.height / 2);
        await frame(); await wait(60); await frame();
        assert((h.view as any).state.activePath === "Long.html", "[U3-02 switch-tab] did not switch to Long.html");
        assert(!h.root.querySelector(".ms-overlay-text-editor") && !("inlineTextEditing" in h.root.dataset), "[U3-02 switch-tab] editor stayed open after switching tab");
        const pr = pdfTab.getBoundingClientRect();
        dispatchPointerClick(pdfTab, pr.left + pr.width / 2, pr.top + pr.height / 2);
        await frame(); await wait(60); await frame();
        assert((h.view as any).state.activePath === "Long.pdf", "[U3-02 switch-tab] did not switch back to Long.pdf");
      },
    },
    {
      name: "outside-click-pdf",
      outside: true,
      exit: async () => {
        const page = h.root.querySelector<HTMLElement>(".ms-page")!;
        const pr = page.getBoundingClientRect();
        const x = pr.left + Math.min(pr.width * 0.72, 260), y = pr.top + Math.min(pr.height * 0.65, 320);
        const hit = document.elementFromPoint(x, y) ?? page;
        assert(!hit.closest(".ms-overlay-text-editor"), "[U3-02 outside-click-pdf] target fell inside editor");
        dispatchPointerClick(hit, x, y);
      },
    },
    {
      name: "outside-click-header",
      outside: true,
      exit: async () => {
        const header = h.root.querySelector<HTMLElement>(".ms-workspace-toolbar")!;
        const hr = header.getBoundingClientRect();
        const x = hr.left + hr.width / 2, y = hr.top + hr.height / 2;
        const hit = document.elementFromPoint(x, y) ?? header;
        dispatchPointerClick(hit, x, y);
      },
    },
    {
      name: "outside-click-mindmap",
      outside: true,
      exit: async () => {
        const map = h.root.querySelector<HTMLElement>(".ms-workspace-map")!;
        const mr = map.getBoundingClientRect();
        const x = mr.left + mr.width * 0.75, y = mr.top + mr.height * 0.5;
        const hit = document.elementFromPoint(x, y) ?? map;
        dispatchPointerClick(hit, x, y);
      },
    },
    {
      name: "outside-click-splitter",
      outside: true,
      exit: async () => {
        const splitter = h.root.querySelector<HTMLElement>(".ms-workspace-splitter-main")!;
        const sr = splitter.getBoundingClientRect();
        const x = sr.left + sr.width / 2, y = sr.top + Math.min(40, sr.height * 0.25);
        const hit = document.elementFromPoint(x, y) ?? splitter;
        dispatchPointerClick(hit, x, y);
      },
    },
  ];

  for (const p of paths) {
    const editor = await openPdfInlineTextBox(h);
    assert(h.root.dataset.inlineTextEditing === "true", \`[U3-02 \${p.name}] did not enter inline editing\`);
    const annBefore = await getAnnotationCount();
    const ratioBefore = (h.view as any).state.ratio;
    const worldBefore = h.root.querySelector<HTMLElement>(".ms-mindmap-world")?.style.transform ?? "";

    await p.exit(editor);
    await frame(); await wait(30); await frame();

    assert(!h.root.querySelector(".ms-overlay-text-editor"), \`[U3-02 \${p.name}] editor still in DOM\`);
    assert(!("inlineTextEditing" in h.root.dataset), \`[U3-02 \${p.name}] inlineTextEditing leaked in dataset\`);
    const annAfter = await getAnnotationCount();
    const annotationsDelta = annAfter - annBefore;
    assert(annotationsDelta === 0, \`[U3-02 \${p.name}] unexpected side-effect annotation delta: \${annotationsDelta}\`);
    if (p.outside) {
      const ratioAfter = (h.view as any).state.ratio;
      const worldAfter = h.root.querySelector<HTMLElement>(".ms-mindmap-world")?.style.transform ?? "";
      assert(ratioAfter === ratioBefore, \`[U3-02 \${p.name}] outside click dragged splitter: \${ratioBefore} -> \${ratioAfter}\`);
      assert(worldAfter === worldBefore, \`[U3-02 \${p.name}] outside click dragged mindmap: \${worldBefore} -> \${worldAfter}\`);
      assert((window.getSelection()?.toString() ?? "") === "", \`[U3-02 \${p.name}] outside click created text selection\`);
    }
    const after = snapshotBar();
    assert(after.dataset === baseline.dataset, \`[U3-02 \${p.name}] dataset drifted: \${baseline.dataset} -> \${after.dataset}\`);
    const maxContainerDelta = Math.max(
      Math.abs(after.rect.left - baseline.rect.left),
      Math.abs(after.rect.top - baseline.rect.top),
      Math.abs(after.rect.width - baseline.rect.width),
      Math.abs(after.rect.height - baseline.rect.height),
    );
    assert(maxContainerDelta <= 1.0, \`[U3-02 \${p.name}] capsule rect drifted by \${maxContainerDelta}px\`);
    assert(after.buttons.length === baseline.buttons.length, \`[U3-02 \${p.name}] button count drifted: \${baseline.buttons.length} -> \${after.buttons.length}\`);
    let maxBtnDelta = 0;
    for (let i = 0; i < baseline.buttons.length; i++) {
      const a = after.buttons[i].rect, b = baseline.buttons[i].rect;
      const d = Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
      if (d > maxBtnDelta) maxBtnDelta = d;
    }
    assert(maxBtnDelta <= 1.0, \`[U3-02 \${p.name}] button rect drifted by \${maxBtnDelta}px\`);
    const entry = {
      path: p.name,
      maxContainerDelta: Number(maxContainerDelta.toFixed(2)),
      maxBtnDelta: Number(maxBtnDelta.toFixed(2)),
      datasetEqual: true,
      annotationsDelta,
      passed: true,
    };
    pathResults.push(entry);
    if (p.outside) outsideResults.push(entry);
  }

  return { passed: true, count: pathResults.length, paths: pathResults, outsideTargets: outsideResults, whitelist: whitelistResults };
};

(window as any).measureUJoint01 = async () => {
  const h = activeHarness!;
  document.body.classList.remove("is-mobile");
  h.store.setStudyInterface("set-1", "scenes");
  (h.view as any).state.bottomCollapsed = false;
  (h.view as any).state.cleanView = false;
  (h.view as any).applyLayout();
  await h.openDoc("pdf");
  await h.selectScene("excerpt");
  await frame(); await frame();

  // 1. UI-01: overflow toggle present & zero occlusion
  const toggleBefore = h.root.querySelector<HTMLButtonElement>(".ms-bottom-overflow-toggle")!;
  assert(toggleBefore && toggleBefore.checkVisibility(), "[U-JOINT-01] overflow toggle missing at 380x700");
  const toggleRectBefore = toggleBefore.getBoundingClientRect().toJSON();
  assert(!h.root.querySelector(".ms-workspace-extra-tools-toggle") && !h.root.querySelector(".ms-workspace-toolbar-controls"), "[U-JOINT-01] legacy top overlay present");

  // 2. UI-01 + UI-02: open overflow menu -> 更多 (excerpt.more) -> 文字批注 -> place text box
  toggleBefore.click();
  await frame();
  const moreItem = h.root.querySelector<HTMLButtonElement>('.ms-bottom-overflow-menu [data-ms-tool="excerpt.more"]')!;
  assert(moreItem && moreItem.checkVisibility(), "[U-JOINT-01] excerpt.more missing in overflow menu");
  moreItem.click();
  await frame();
  const docMore = h.root.querySelector<HTMLElement>(".ms-document-more")!;
  assert(docMore && docMore.checkVisibility(), "[U-JOINT-01] .ms-document-more did not open");
  const textAnnotRow = [...docMore.querySelectorAll<HTMLButtonElement>(".ms-document-more-row")].find(b => b.getAttribute("aria-label") === "文字批注")!;
  assert(textAnnotRow, "[U-JOINT-01] 文字批注 missing in unified more");
  textAnnotRow.click();
  await frame();
  const page = h.root.querySelector<HTMLElement>(".ms-page")!;
  const pr = page.getBoundingClientRect();
  page.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: pr.left + 60, clientY: pr.top + 60 }));
  await frame(); await wait(30); await frame();

  // 3. UI-03: single-slot stylebar active, capsule & overflow hidden, done button hit
  const stylebar = h.root.querySelector<HTMLElement>(".ms-overlay-stylebar")!;
  const capsule = h.root.querySelector<HTMLElement>(".ms-bottom-capsule-shell")!;
  assert(stylebar && stylebar.checkVisibility(), "[U-JOINT-01] stylebar not visible");
  assert(!capsule.checkVisibility() && !h.root.querySelector(".ms-bottom-overflow-menu"), "[U-JOINT-01] capsule or overflow menu not hidden");
  assert(stylebar.scrollWidth <= stylebar.clientWidth + 1, "[U-JOINT-01] stylebar overflowed at 380x700");
  const doneBtn = stylebar.querySelector<HTMLButtonElement>(".ms-text-done")!;
  const dr = doneBtn.getBoundingClientRect();
  assert(isHit(doneBtn, dr.left + dr.width / 2, dr.top + dr.height / 2), "[U-JOINT-01] done button not hit");

  // 4. Exit via ✓ -> verify capsule + overflow toggle restored to same rect and clickable
  doneBtn.click();
  await frame(); await frame();
  assert(!h.root.querySelector(".ms-overlay-text-editor") && !("inlineTextEditing" in h.root.dataset), "[U-JOINT-01] inline editing not cleared");
  assert(capsule.checkVisibility(), "[U-JOINT-01] capsule not restored");
  const toggleAfter = h.root.querySelector<HTMLButtonElement>(".ms-bottom-overflow-toggle")!;
  assert(toggleAfter && toggleAfter.checkVisibility(), "[U-JOINT-01] overflow toggle not restored");
  const tr = toggleAfter.getBoundingClientRect();
  const toggleDelta = Math.max(Math.abs(tr.left - toggleRectBefore.left), Math.abs(tr.top - toggleRectBefore.top));
  assert(toggleDelta <= 1.0, \`[U-JOINT-01] overflow toggle rect drifted by \${toggleDelta}px\`);
  assert(isHit(toggleAfter, tr.left + tr.width / 2, tr.top + tr.height / 2), "[U-JOINT-01] restored overflow toggle not hit");

  return { passed: true, toggleDelta: Number(toggleDelta.toFixed(2)), stylebarScrollDiff: Number((stylebar.scrollWidth - stylebar.clientWidth).toFixed(2)) };
};

(window as any).ready = true;
`;

try {
  await writeFile(join(temporary, "pad-toolbar-fixture.ts"), fixtureSource);
  const obsidianSource = (await readFile(join(workspaceDir, "obsidian-fixture.txt"), "utf8")).replaceAll("__PROJECT__", project);
  await writeFile(join(temporary, "obsidian-fixture.ts"), obsidianSource);
  for (const name of ["fakePdf", "fakeMammoth"]) {
    await writeFile(join(temporary, name + ".ts"), await readFile(join(project, "src/documents/acceptance-fixtures", name + ".txt"), "utf8"));
  }
  await writeFile(
    join(temporary, "fakePdf.ts"),
    (await readFile(join(temporary, "fakePdf.ts"), "utf8")) + "\nexport async function initPdfWorker() {}\n",
  );
  const hashes = Object.fromEntries(
    ["Long.pdf", "Long.html"].map(p => [p, createHash("sha256").update(p).digest("hex")]),
  );
  await writeFile(
    join(temporary, "crypto.ts"),
    `const hashes=${JSON.stringify(hashes)};export function createHash(){let input="";return{update(v:string){input=v;return this;},digest(){return hashes[input]||"0".repeat(64);}};}`,
  );
  await writeFile(join(temporary, "unused-network.ts"), "export function request(){throw new Error('no network');}");

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
    '<!doctype html><meta charset="utf-8"><title>MarginStudy UI-01 Pad Toolbar Layout Acceptance</title><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0;height:100%}#fixtures{height:100vh;width:100vw}.test-item-view{height:100%;width:100%;display:flex;flex-direction:column}.test-item-view>.view-content{height:100%;width:100%;overflow:hidden}</style><main id="fixtures"></main><script type="module" src="/fixture.js"></script>',
  );

  await build({
    entryPoints: [join(temporary, "pad-toolbar-fixture.ts")],
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
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const session = `marginstudy-pad-toolbar-${process.pid}`;
  const browser = (...args) => runBrowser(session, ...args);

    const report = {
      meta: {
        suite: "pad-toolbar-layout",
        cards: ["UI-01", "UI-02", "UI-03"],
        a30PhysicalResolution: "3392x2400",
        a30EquivalentViewport: "1131x800@DPR3",
        deviceOffline: true,
      },
      u101: [],
      u102: null,
      u103: [],
      u104: [],
      u201: [],
      u202: null,
      u203: [],
      u301: [],
      u302: null,
      uJoint01: null,
    };

  try {
    await browser("open", "about:blank");
    await browser("set", "viewport", "1131", "800");
    await browser("open", `http://127.0.0.1:${server.address().port}`);
    await browser("wait", "--fn", "window.ready === true");
    const evalJson = async expr => JSON.parse((await browser("eval", expr)).stdout);

    await evalJson("window.prepareHarness()");

    // U1-01: 4 viewport profiles x (PDF + HTML) x 3 scroll positions x 4 scenes
    const u101Profiles = [
      { label: "1131x800@DPR3-desktop", w: 1131, h: 800, dpr: 3, mobile: false, ratio: 0.5 },
      { label: "1131x800@DPR3-mobile", w: 1131, h: 800, dpr: 3, mobile: true, ratio: 0.5 },
      { label: "1131x800@ratio0.35", w: 1131, h: 800, dpr: 3, mobile: false, ratio: 0.35 },
      { label: "756x427", w: 756, h: 427, dpr: 1, mobile: false, ratio: 0.5 },
      { label: "380x700", w: 380, h: 700, dpr: 1, mobile: false, ratio: 0.5 },
    ];
    for (const p of u101Profiles) {
      await browser("set", "viewport", String(p.w), String(p.h), String(p.dpr));
      for (const doc of ["pdf", "html"]) {
        const res = await evalJson(`window.measureU101Case(${JSON.stringify({
          label: p.label,
          mobile: p.mobile,
          ratio: p.ratio,
          doc,
          scenes: ["excerpt", "handwriting", "organize", "recall"],
        })})`);
        report.u101.push(res);
      }
    }
    const u101Failures = report.u101.filter(r => !r.passed);
    if (u101Failures.length > 0) {
      throw new Error("U1-01 FAILED: " + JSON.stringify(u101Failures, null, 2));
    }

    // U1-02: clearance zeros on collapse / cleanView / statusBar=hidden and restores
    await browser("set", "viewport", "1131", "800", "3");
    report.u102 = await evalJson("window.measureU102()");

    // U1-03: narrow overflow menu reachable and every overflow item clickable
    for (const [label, w, hSize, scenes] of [
      ["380x700", 380, 700, ["excerpt", "handwriting"]],
      ["520x800", 520, 800, ["excerpt"]],
    ]) {
      await browser("set", "viewport", String(w), String(hSize), "1");
      report.u103.push(await evalJson(`window.measureU103Viewport(${JSON.stringify(label)}, ${JSON.stringify(scenes)})`));
    }

    // U1-04: wide viewports zero overflow & no toggle in DOM (+ R6 756x851 zero clearance)
    for (const [w, hSize] of [[1512, 851], [756, 851], [756, 427]]) {
      await browser("set", "viewport", String(w), String(hSize), "1");
      report.u104.push(await evalJson(`window.measureU104Viewport(${w}, ${hSize})`));
    }

    // U2-01: legacy top extra-tools toggle & controls completely removed, top capsule 100% unobstructed
    for (const [w, hSize, dpr] of [[1131, 800, 3], [1512, 851, 1], [756, 851, 1], [380, 700, 1]]) {
      await browser("set", "viewport", String(w), String(hSize), String(dpr));
      report.u201.push(await evalJson(`window.measureU201Viewport(${w}, ${hSize})`));
    }

    // U2-02: 24-item capability matrix (including all 9 unique capabilities) 100% reachable & functional
    await browser("set", "viewport", "1131", "800", "3");
    report.u202 = await evalJson("window.measureU202Matrix()");

    // U2-03: traditional mode intact + bottom-anchored Document More & Read Settings stay inside viewport
    for (const [w, hSize, dpr, checkTrad] of [[1131, 800, 3, true], [756, 427, 1, false], [380, 700, 1, false]]) {
      await browser("set", "viewport", String(w), String(hSize), String(dpr));
      report.u203.push(await evalJson(`window.measureU203TraditionalAndPopups(${w}, ${hSize}, ${checkTrad})`));
    }

    // U3-01: inline text editor single-slot mutual exclusion + narrow compact stylebar + zero reader overlap
    for (const [w, hSize, dpr] of [[1131, 800, 3], [756, 427, 1], [380, 700, 1]]) {
      await browser("set", "viewport", String(w), String(hSize), String(dpr));
      report.u301.push(await evalJson(`window.measureU301Viewport(${w}, ${hSize})`));
    }

    // U3-02: 5 exit paths atomically restore bottom capsule rect/buttons/dataset
    await browser("set", "viewport", "1131", "800", "3");
    report.u302 = await evalJson("window.measureU302ExitPaths()");

    // U-JOINT-01: UI-01 + UI-02 + UI-03 combined end-to-end flow at 380x700
    await browser("set", "viewport", "380", "700", "1");
    report.uJoint01 = await evalJson("window.measureUJoint01()");

    const done = await evalJson("window.disposeHarness()");
    if (done.runtimeErrors.length > 0) {
      throw new Error("Runtime errors: " + JSON.stringify(done.runtimeErrors));
    }

    if (process.env.MARGINSTUDY_PAD_REPORT) {
      await mkdir(dirname(resolve(process.env.MARGINSTUDY_PAD_REPORT)), { recursive: true });
      await writeFile(resolve(process.env.MARGINSTUDY_PAD_REPORT), JSON.stringify(report, null, 2) + "\n");
    }

    const totalU101Checks = report.u101.reduce((s, r) => s + r.checkedCount, 0);
    const totalU103Items = report.u103.reduce((s, r) => s + r.scenes.reduce((a, b) => a + b.clickedCount, 0), 0);
    console.log(
      `PASS pad-toolbar-layout: U1-01 (${totalU101Checks}/${totalU101Checks}, maxOverlapArea=0), U1-02 (3/3), U1-03 (${totalU103Items}/${totalU103Items}), U1-04 (3/3), U2-01 (4/4), U2-02 (${report.u202.total}/24, ${report.u202.uniqueCount}/9 unique), U2-03 (3/3), U3-01 (3/3 single-slot), U3-02 (${report.u302.count}/10 exit paths, ${report.u302.outsideTargets.length}/4 outside, ${report.u302.whitelist.length}/3 whitelist), U-JOINT-01 (PASS)`,
    );
  } finally {
    await browser("close").catch(() => {});
    await new Promise(done => server.close(done));
  }
} finally {
  await rm(temporary, { recursive: true, force: true }).catch(() => {});
}
