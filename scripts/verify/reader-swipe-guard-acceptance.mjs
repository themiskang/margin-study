/**
 * [INPUT]: 依赖 ReaderView、WordReaderView、DocumentReaderView、StudyWorkspaceView、MarginStudySettingTab、Store 与默认 agent-browser CDP 后端。
 * [OUTPUT]: 执行官方 data-ignore-swipe 属性方案的 A–E + 设置 UI + F 双真机视口（1131×800@DPR3、1510×962@DPR2）全量验收。
 * [POS]: 公开浏览器验收套件 reader-swipe-guard，注册于 scripts/verify.mjs。
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
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-swipe-guard-")));

const fixtureSource = `
import { TFile, Platform } from "obsidian";
import { Store } from "${project}/src/model/store";
import { DEFAULT_SETTINGS } from "${project}/src/types";
import { ReaderView } from "${project}/src/pdf/readerView";
import { WordReaderView } from "${project}/src/word/wordReader";
import { DocumentReaderView } from "${project}/src/documents/documentReader";
import { StudyWorkspaceView } from "${project}/src/workspace/studyWorkspace";
import { MarginStudySettingTab } from "${project}/src/settings";

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

const pageItems = [
  { str: "这是一段用于测试选区与滑动拦截的中文正文内容", x: 60, y: 720, w: 320, h: 18, hasEOL: true },
  { str: "第二行用于验证平板手写时不误触侧栏的段落文本", x: 60, y: 680, w: 320, h: 18, hasEOL: true },
];

/**
 * 原样复刻 Obsidian obsidian.asar/app.js Eb() 的 touchstart 祖先循环：
 * 含 HTMLAudioElement、HTMLElement.dataset.ignoreSwipe 与 style.touchAction === "none" 短路条件。
 */
function obsidianEbShouldIgnore(targetNode: Node | null): boolean {
  let r: Node | null = targetNode;
  for (; r;) {
    if (
      r instanceof HTMLAudioElement ||
      (r instanceof HTMLElement && Boolean(r.dataset.ignoreSwipe)) ||
      ((r instanceof HTMLElement || r instanceof SVGElement) && r.style.touchAction === "none")
    ) {
      return true;
    }
    r = r.parentNode;
  }
  return false;
}

let activeState: {
  view: any;
  store: Store;
  plugin: any;
  kind: string;
} | null = null;

function makeEnv(filesMap: Record<string, object | string | Uint8Array>) {
  const sources = new Map<string, { file: TFile; data: Uint8Array; text: string }>();
  for (const [path, val] of Object.entries(filesMap)) {
    if (val instanceof Uint8Array) {
      sources.set(path, { file: new TFile(path, val.byteLength), data: val, text: new TextDecoder().decode(val) });
    } else {
      const text = typeof val === "string" ? val : JSON.stringify(val);
      const data = new TextEncoder().encode(text);
      sources.set(path, { file: new TFile(path, data.byteLength), data, text });
    }
  }
  const adapterFiles = new Map<string, string>();
  const folders = new Set<string>();
  const vaultEvents = new Map<string, Set<(...args: any[]) => void>>();
  const wsEvents = new Map<string, Set<(...args: any[]) => void>>();
  const dock = () => ({ collapsed: false, containerEl: document.createElement("div"), collapse() { this.collapsed = true; }, expand() { this.collapsed = false; } });
  const app: any = {
    vault: {
      configDir: ".obsidian",
      getFiles: () => [...sources.values()].map(v => v.file),
      getAbstractFileByPath: (p: string) => sources.get(p)?.file ?? null,
      async read(file: TFile) { return sources.get(file.path)!.text; },
      async readBinary(file: TFile) {
        const d = sources.get(file.path)!.data;
        return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
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
      containerEl: document.createElement("div"),
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
    studySets: [{ id: "set-1", name: "Swipe Guard Study", docPaths: [...sources.keys()], createdAt: stamp }],
    canvases: [{ id: "canvas-1", studySetId: "set-1", name: "Map 1", createdAt: stamp }],
    activeStudySetId: "set-1", activeCanvasId: "canvas-1",
    settings: { ...DEFAULT_SETTINGS },
  };
  const host: any = {
    app,
    loadData: async () => JSON.parse(JSON.stringify(disk)),
    saveData: async (v: any) => { disk = JSON.parse(JSON.stringify(v)); },
  };
  return { app, host };
}

async function cleanupActive() {
  window.getSelection()?.removeAllRanges();
  if (activeState?.view?.onClose) {
    try { await activeState.view.onClose(); } catch { /* ignore */ }
  }
  activeState = null;
  fixturesHost.replaceChildren();
}

function makePlugin(app: any, store: Store) {
  return {
    manifest: { id: "margin-study" },
    app,
    store,
    viewEvents: {},
    studyWorkspace: null,
    activeReader: null,
    refreshMindmap() {},
    refreshSidebar() {},
    ensureSplitLayout: async () => {},
    openDocument: async () => {},
  };
}

function makeLeaf(app: any) {
  return { app, setViewState: async () => {}, updateHeader() {}, getRoot: () => app.workspace.rootSplit };
}

function buildMinimalEpub(): Uint8Array {
  const enc = new TextEncoder();
  const entries: { name: string; data: Uint8Array }[] = [
    { name: "mimetype", data: enc.encode("application/epub+zip") },
    {
      name: "META-INF/container.xml",
      data: enc.encode('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    },
    {
      name: "OEBPS/content.opf",
      data: enc.encode('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>EPUB Swipe Test</dc:title></metadata><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>'),
    },
    {
      name: "OEBPS/ch1.xhtml",
      data: enc.encode('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter 1</h1>' + Array.from({ length: 40 }, (_, i) => '<p>EPUB paragraph ' + (i + 1) + ' content for swipe guard verification.</p>').join("") + '</body></html>'),
    },
  ];
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Uint8Array) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = new Uint8Array(30 + nameBytes.length + e.data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(e.data, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length;
  }
  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of [...localParts, ...centralParts, eocd]) { out.set(p, pos); pos += p.length; }
  return out;
}

function inspectNode(node: Element | null) {
  const matched = node?.closest<HTMLElement>("[data-ignore-swipe]") ?? null;
  return {
    found: matched !== null,
    attrValue: matched?.getAttribute("data-ignore-swipe") ?? null,
    ebIgnored: obsidianEbShouldIgnore(node),
  };
}

// Run A, B, C, D across all 5 hosts (PDF / Word / HTML / EPUB / StudyWorkspace readerHost)
(window as any).runHostsABCD = async () => {
  document.body.classList.add("is-mobile");
  (Platform as any).isMobile = true;
  const results: Record<string, any> = {};

  // 1. PDF ReaderView
  {
    await cleanupActive();
    const { app, host } = makeEnv({ "a.pdf": { name: "a", pages: 2, textItems: pageItems } });
    const store = new Store(host);
    await store.load();
    const plugin = makePlugin(app, store);
    const view = new ReaderView(makeLeaf(app), plugin);
    view.containerEl.style.cssText = "position:relative;width:100vw;height:100vh;display:flex;flex-direction:column;";
    fixturesHost.append(view.containerEl);
    await view.onOpen();
    await view.loadFileByPath("a.pdf");
    await view.renderPage(1);
    await frame();
    const scrollEl = view.getScrollContainer();
    const inner = scrollEl.querySelector(".ms-text-layer span") ?? scrollEl;
    const toolbar = view.containerEl.querySelector(".ms-toolbar");
    const onState = { hostAttr: scrollEl.getAttribute("data-ignore-swipe"), inner: inspectNode(inner), toolbar: inspectNode(toolbar) };
    // Instant toggle OFF without reopening
    store.settings.blockSidebarSwipe = false;
    store.save();
    await Promise.resolve();
    const offState = { hostHasAttr: scrollEl.hasAttribute("data-ignore-swipe"), hostAttr: scrollEl.getAttribute("data-ignore-swipe"), inner: inspectNode(inner) };
    // Instant toggle ON without reopening
    store.settings.blockSidebarSwipe = true;
    store.save();
    await Promise.resolve();
    const reOnState = { hostHasAttr: scrollEl.hasAttribute("data-ignore-swipe"), hostAttr: scrollEl.getAttribute("data-ignore-swipe"), inner: inspectNode(inner) };
    await view.onClose();
    results.pdf = { onState, offState, reOnState };
  }

  // 2. WordReaderView
  {
    await cleanupActive();
    const html = "<h1>Word Title</h1>" + Array.from({ length: 12 }, (_, i) => "<p>Word paragraph " + (i + 1) + "</p>").join("");
    const { app, host } = makeEnv({ "a.docx": html });
    const store = new Store(host);
    await store.load();
    const plugin = makePlugin(app, store);
    const view = new WordReaderView(makeLeaf(app), plugin);
    view.containerEl.style.cssText = "position:relative;width:100vw;height:100vh;display:flex;flex-direction:column;";
    fixturesHost.append(view.containerEl);
    await view.onOpen();
    await view.loadFileByPath("a.docx");
    await frame();
    const scrollEl = view.getScrollContainer();
    const inner = scrollEl.querySelector("p") ?? scrollEl;
    const toolbar = view.containerEl.querySelector(".ms-toolbar");
    const onState = { hostAttr: scrollEl.getAttribute("data-ignore-swipe"), inner: inspectNode(inner), toolbar: inspectNode(toolbar) };
    store.settings.blockSidebarSwipe = false;
    store.save();
    await Promise.resolve();
    const offState = { hostHasAttr: scrollEl.hasAttribute("data-ignore-swipe"), hostAttr: scrollEl.getAttribute("data-ignore-swipe"), inner: inspectNode(inner) };
    store.settings.blockSidebarSwipe = true;
    store.save();
    await Promise.resolve();
    const reOnState = { hostHasAttr: scrollEl.hasAttribute("data-ignore-swipe"), hostAttr: scrollEl.getAttribute("data-ignore-swipe"), inner: inspectNode(inner) };
    await view.onClose();
    results.word = { onState, offState, reOnState };
  }

  // 3. HTML & 4. EPUB (DocumentReaderView)
  for (const ext of ["html", "epub"] as const) {
    await cleanupActive();
    const files: Record<string, any> = ext === "html"
      ? { "a.html": "<html><body><h1>HTML Title</h1><p>HTML paragraph content</p></body></html>" }
      : { "a.epub": buildMinimalEpub() };
    const { app, host } = makeEnv(files);
    const store = new Store(host);
    await store.load();
    const plugin = makePlugin(app, store);
    const view = new DocumentReaderView(makeLeaf(app), plugin);
    view.containerEl.style.cssText = "position:relative;width:100vw;height:100vh;display:flex;flex-direction:column;";
    fixturesHost.append(view.containerEl);
    await view.onOpen();
    await view.loadFileByPath("a." + ext);
    await frame();
    const scrollEl = view.getScrollContainer();
    const inner = scrollEl.querySelector("p") ?? scrollEl;
    const toolbar = view.containerEl.querySelector(".ms-toolbar");
    const searchInput = view.containerEl.querySelector("input[type='search']");
    const onState = { hostAttr: scrollEl.getAttribute("data-ignore-swipe"), inner: inspectNode(inner), toolbar: inspectNode(toolbar), searchInput: inspectNode(searchInput) };
    store.settings.blockSidebarSwipe = false;
    store.save();
    await Promise.resolve();
    const offState = { hostHasAttr: scrollEl.hasAttribute("data-ignore-swipe"), hostAttr: scrollEl.getAttribute("data-ignore-swipe"), inner: inspectNode(inner) };
    store.settings.blockSidebarSwipe = true;
    store.save();
    await Promise.resolve();
    const reOnState = { hostHasAttr: scrollEl.hasAttribute("data-ignore-swipe"), hostAttr: scrollEl.getAttribute("data-ignore-swipe"), inner: inspectNode(inner) };
    await view.onClose();
    results[ext] = { onState, offState, reOnState };
  }

  // 5. StudyWorkspaceView readerHost + exclusions (toolbar, map, auxiliary, input) + Settings Tab live toggle
  {
    await cleanupActive();
    const { app, host } = makeEnv({ "ws.pdf": { name: "ws", pages: 2, textItems: pageItems } });
    const store = new Store(host);
    await store.load();
    const plugin = makePlugin(app, store);
    const leaf = makeLeaf(app);
    app.workspace.activeLeaf = leaf;
    app.workspace.centerLeaf = leaf;
    const view = new StudyWorkspaceView(leaf, plugin);
    (leaf as any).view = view;
    view.containerEl.style.cssText = "position:relative;width:100vw;height:100vh;display:flex;flex-direction:column;";
    fixturesHost.append(view.containerEl);
    await view.setState({ activePath: "ws.pdf", reader: true, mindmap: true, auxiliary: "cards" });
    await view.onOpen();
    await frame();
    await wait(60);

    const readerHost = view.containerEl.querySelector<HTMLElement>(".ms-workspace-reader-host")!;
    const innerReader = readerHost.querySelector(".ms-text-layer span") ?? readerHost.querySelector(".ms-scroll") ?? readerHost;
    const toolbar = view.containerEl.querySelector(".ms-workspace-toolbar");
    const map = view.containerEl.querySelector(".ms-workspace-map");
    const auxiliary = view.containerEl.querySelector(".ms-workspace-auxiliary");
    const input = view.containerEl.querySelector(".ms-workspace-library input");

    // Also test Settings Tab live toggle without reopening workspace
    const tab = new MarginStudySettingTab(app, plugin);
    tab.display();
    const headings = [...tab.containerEl.querySelectorAll("h3")].map(h => h.textContent?.trim());
    const swipeItem = [...tab.containerEl.querySelectorAll<HTMLElement>(".setting-item")]
      .find(i => i.querySelector(".setting-item-name")?.textContent?.trim() === "阅读区禁止左右滑动开侧栏");
    assert(swipeItem, "Missing '阅读区禁止左右滑动开侧栏' setting");
    const desc = swipeItem!.querySelector(".setting-item-description")?.textContent?.trim() ?? "";
    const toggle = swipeItem!.querySelector<HTMLInputElement>("input[type='checkbox']")!;

    const onState = {
      hostAttr: readerHost.getAttribute("data-ignore-swipe"),
      inner: inspectNode(innerReader),
      toolbar: inspectNode(toolbar),
      map: inspectNode(map),
      auxiliary: inspectNode(auxiliary),
      input: inspectNode(input),
      settingsToggleChecked: toggle.checked,
      headings,
      desc,
    };

    // Toggle OFF via Settings UI -> instant DOM removal on BOTH readerHost & child scrollEl
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    const offState = {
      hostHasAttr: readerHost.hasAttribute("data-ignore-swipe"),
      hostAttr: readerHost.getAttribute("data-ignore-swipe"),
      inner: inspectNode(innerReader),
      settingValue: store.settings.blockSidebarSwipe,
    };

    // Toggle ON via Settings UI -> instant DOM restore
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    const reOnState = {
      hostHasAttr: readerHost.hasAttribute("data-ignore-swipe"),
      hostAttr: readerHost.getAttribute("data-ignore-swipe"),
      inner: inspectNode(innerReader),
      settingValue: store.settings.blockSidebarSwipe,
    };

    await view.onClose();
    results.workspace = { onState, offState, reOnState };
  }

  return results;
};

// Setup PDF for E (real CDP gestures: zoom horizontal pan, vertical scroll, pinch zoom, text selection)
(window as any).setupPdfForE = async () => {
  await cleanupActive();
  document.body.classList.add("is-mobile");
  (Platform as any).isMobile = true;
  const { app, host } = makeEnv({ "e.pdf": { name: "e", pages: 4, textItems: pageItems } });
  const store = new Store(host);
  await store.load();
  const plugin = makePlugin(app, store);
  const view = new ReaderView(makeLeaf(app), plugin);
  view.containerEl.style.cssText = "position:relative;width:100vw;height:100vh;display:flex;flex-direction:column;";
  fixturesHost.append(view.containerEl);
  await view.onOpen();
  await view.loadFileByPath("e.pdf");
  await view.fitWidth();
  await view.renderPage(1);
  await view.renderPage(2);
  await frame();
  await wait(40);
  const scrollEl = view.getScrollContainer();
  scrollEl.scrollTop = 0;
  scrollEl.scrollLeft = 0;
  await frame();
  activeState = { view, store, plugin, kind: "pdf" };
  return (window as any).getPdfMetrics();
};

(window as any).getPdfMetrics = () => {
  const view = activeState!.view as ReaderView;
  const scrollEl = view.getScrollContainer();
  const rect = scrollEl.getBoundingClientRect();
  return {
    cx: Math.round(rect.left + rect.width / 2),
    cy: Math.round(rect.top + rect.height / 2),
    scrollWidth: scrollEl.scrollWidth,
    clientWidth: scrollEl.clientWidth,
    scrollTop: scrollEl.scrollTop,
    scrollLeft: scrollEl.scrollLeft,
    scale: view.getScale(),
    ignoreSwipeAttr: scrollEl.getAttribute("data-ignore-swipe"),
  };
};

(window as any).zoomPdfToOverflow = async () => {
  const view = activeState!.view as ReaderView;
  await view.setScale(3.2);
  await view.renderPage(1);
  await frame();
  await wait(40);
  const scrollEl = view.getScrollContainer();
  scrollEl.scrollLeft = 0;
  await frame();
  return (window as any).getPdfMetrics();
};

(window as any).resetPdfFitWidth = async () => {
  const view = activeState!.view as ReaderView;
  await view.fitWidth();
  await view.renderPage(1);
  await frame();
  await wait(40);
  const scrollEl = view.getScrollContainer();
  scrollEl.scrollLeft = 0;
  scrollEl.scrollTop = 0;
  await frame();
  return (window as any).getPdfMetrics();
};

(window as any).testLongPressTextSelection = () => {
  const view = activeState!.view as ReaderView;
  const span = view.getScrollContainer().querySelector<HTMLElement>(".ms-text-layer span");
  assert(span && span.firstChild, "Missing text span");
  const range = document.createRange();
  range.setStart(span!.firstChild!, 0);
  range.setEnd(span!.firstChild!, 10);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  const selectedText = sel.toString();
  sel.removeAllRanges();
  return { selectedText, length: selectedText.length };
};

(window as any).getErrors = () => [...errors];
(window as any).ready = true;
`;

try {
  for (const name of ["obsidian", "fakeMammoth", "fakePdf"]) {
    let src = await readFile(join(docFixtures, name + ".txt"), "utf8");
    if (name === "obsidian") {
      src = src.replace("register() {}", "register() {} registerEvent(_ref?: any) {}");
      src += `\nexport async function requestUrl() { throw new Error("offline"); }
export class PluginSettingTab { containerEl: HTMLElement; constructor(public app: any, public plugin: any) { this.containerEl = document.createElement("div"); (this.containerEl as any).empty = () => this.containerEl.replaceChildren(); } display() {} }
export class Setting {
  item: HTMLElement; nameEl: HTMLElement; controlEl: HTMLElement; descEl: HTMLElement;
  constructor(public containerEl?: HTMLElement) {
    this.item = document.createElement("div"); this.item.className = "setting-item";
    const info = document.createElement("div"); info.className = "setting-item-info";
    this.nameEl = document.createElement("div"); this.nameEl.className = "setting-item-name";
    this.descEl = document.createElement("div"); this.descEl.className = "setting-item-description";
    info.append(this.nameEl, this.descEl);
    this.controlEl = document.createElement("div"); this.controlEl.className = "setting-item-control";
    this.item.append(info, this.controlEl);
    containerEl?.append(this.item);
  }
  setName(v: string) { this.nameEl.textContent = v; return this; }
  setDesc(v: string) { this.descEl.textContent = v; return this; }
  setHeading() { this.item.classList.add("setting-item-heading"); return this; }
  addText(cb: (c: any) => any) { const input = document.createElement("input"); input.type = "text"; const c = { inputEl: input, setValue: (v: string) => { input.value = v; return c; }, onChange: (f: (v: string) => void) => { input.addEventListener("change", () => f(input.value)); return c; } }; cb(c); this.controlEl.append(input); return this; }
  addTextArea(cb: (c: any) => any) { const ta = document.createElement("textarea"); const c = { inputEl: ta, setValue: (v: string) => { ta.value = v; return c; }, onChange: (f: (v: string) => void) => { ta.addEventListener("change", () => f(ta.value)); return c; } }; cb(c); this.controlEl.append(ta); return this; }
  addDropdown(cb: (c: any) => any) { const sel = document.createElement("select"); const c = { selectEl: sel, addOption: (v: string, l: string) => { const o = document.createElement("option"); o.value = v; o.textContent = l; sel.append(o); return c; }, setValue: (v: string) => { sel.value = v; return c; }, onChange: (f: (v: string) => void) => { sel.addEventListener("change", () => f(sel.value)); return c; } }; cb(c); this.controlEl.append(sel); return this; }
  addSlider(cb: (c: any) => any) { const input = document.createElement("input"); input.type = "range"; const c = { setLimits: (min: number, max: number, step: number) => { input.min = String(min); input.max = String(max); input.step = String(step); return c; }, setValue: (v: number) => { input.value = String(v); return c; }, onChange: (f: (v: number) => void) => { input.addEventListener("change", () => f(Number(input.value))); return c; } }; cb(c); this.controlEl.append(input); return this; }
  addToggle(cb: (c: any) => any) { const input = document.createElement("input"); input.type = "checkbox"; const c = { setValue: (v: boolean) => { input.checked = v; return c; }, setDisabled: (v: boolean) => { input.disabled = v; return c; }, onChange: (f: (v: boolean) => void) => { input.addEventListener("change", () => f(input.checked)); return c; } }; cb(c); this.controlEl.append(input); return this; }
  addButton(cb: (c: any) => any) { const btn = document.createElement("button"); const c = { setButtonText: (v: string) => { btn.textContent = v; return c; }, onClick: (f: () => void) => { btn.addEventListener("click", f); return c; } }; cb(c); this.controlEl.append(btn); return this; }
}\n`;
    } else if (name === "fakePdf") {
      src = `class FakeViewport {
        width: number; height: number; coeffs: number[];
        constructor({ viewBox = [0, 0, 600, 800], scale = 1, rotation = 0 }: any) {
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
        .replace(/getViewport\(\{scale\}:\{scale:number\}\)\{[\s\S]*?return \{[\s\S]*?\};\s*\}/, `getViewport({scale}:{scale:number}){ const viewBox=config.crop||[0,0,600,800]; const rotation=config.rotations?.[num-1]??config.rotation??0; return new FakeViewport({viewBox,scale,rotation}); }`);
    }
    await writeFile(join(temporary, name + ".ts"), src);
  }
  await writeFile(join(temporary, "unused-network.ts"), "export function request(){throw new Error('offline');}");
  await writeFile(join(temporary, "crypto.ts"), "export function createHash(){return{update(){return this;},digest(){return '0000000000000000';}};}");
  await writeFile(join(temporary, "swipe-fixture.ts"), fixtureSource);

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
    '<!doctype html><meta charset="utf-8"><title>MarginStudy reader-swipe-guard acceptance</title><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0;height:100%}#fixtures{position:relative;width:100vw;height:100vh;overflow:hidden}</style><main id="fixtures"></main><script type="module" src="/fixture.js"></script>',
  );

  await build({
    entryPoints: [join(temporary, "swipe-fixture.ts")],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "chrome120",
    outfile: join(temporary, "fixture.js"),
    plugins: [{
      name: "swipe-guard-adapters",
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
  const session = `marginstudy-swipe-guard-${process.pid}`;
  const browser = (...args) => runBrowser(session, ...args);

  try {
    await browser("open", "about:blank");
    await browser("set", "viewport", "1131", "800");
    await browser("open", `http://127.0.0.1:${server.address().port}`);
    await browser("wait", "--fn", "window.ready === true");

    const browserUrl = (await browser("get", "cdp-url")).stdout.trim();
    const pageUrl = (await browser("get", "url")).stdout.trim();
    const targets = await (await fetch(`http://${new URL(browserUrl).host}/json/list`)).json();
    const target = targets.find(item => item.type === "page" && item.url === pageUrl);
    if (!target?.webSocketDebuggerUrl) throw new Error(`No CDP target for ${pageUrl}`);

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", () => rej(new Error("CDP WebSocket open error")), { once: true });
    });

    let nextId = 1;
    const sendCdp = (method, params = {}) => new Promise((res, rej) => {
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

    const evalCdp = async (expression) => {
      const res = await sendCdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || JSON.stringify(res.exceptionDetails));
      }
      return res.result.value;
    };

    const singleFingerDrag = async (x0, y0, x1, y1, steps = 8) => {
      await sendCdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: x0, y: y0 }] });
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        await sendCdp("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ id: 1, x: Math.round(x0 + (x1 - x0) * t), y: Math.round(y0 + (y1 - y0) * t) }],
        });
        await new Promise(r => setTimeout(r, 14));
      }
      await sendCdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await new Promise(r => setTimeout(r, 40));
    };

    const twoFingerPinch = async (cx, cy, startHalf = 40, endHalf = 96, steps = 6) => {
      await sendCdp("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ id: 1, x: cx - startHalf, y: cy }, { id: 2, x: cx + startHalf, y: cy }],
      });
      for (let i = 1; i <= steps; i++) {
        const half = Math.round(startHalf + (endHalf - startHalf) * (i / steps));
        await sendCdp("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ id: 1, x: cx - half, y: cy }, { id: 2, x: cx + half, y: cy }],
        });
        await new Promise(r => setTimeout(r, 16));
      }
      await sendCdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await new Promise(r => setTimeout(r, 60));
    };

    try {
      await sendCdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

      const viewports = [
        { label: "1131x800@DPR3", width: 1131, height: 800, dpr: 3 },
        { label: "1510x962@DPR2", width: 1510, height: 962, dpr: 2 },
      ];

      let passedChecks = 0;
      let totalChecks = 0;
      const record = (ok, msg) => { totalChecks++; if (!ok) throw new Error(msg); passedChecks++; };

      const summary = {};
      for (const vp of viewports) {
        await sendCdp("Emulation.setDeviceMetricsOverride", {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: vp.dpr,
          mobile: true,
        });

        // A, B, C, D across all 5 hosts
        const hosts = await evalCdp("window.runHostsABCD()");
        for (const hostKey of ["pdf", "word", "html", "epub", "workspace"]) {
          const h = hosts[hostKey];
          // A: default ON -> closest('[data-ignore-swipe]') found and non-empty
          record(h.onState.inner.found === true && Boolean(h.onState.inner.attrValue), `[${vp.label}][${hostKey}] A attr missing: ${JSON.stringify(h.onState)}`);
          // B: Obsidian Eb loop -> reader inner ignored; toolbar (and map/auxiliary/input) NOT ignored
          record(h.onState.inner.ebIgnored === true, `[${vp.label}][${hostKey}] B Eb loop did not ignore reader inner`);
          record(h.onState.toolbar.ebIgnored === false && h.onState.toolbar.found === false, `[${vp.label}][${hostKey}] B toolbar wrongly ignored`);
          // C: setting OFF -> attribute removed (not "false"), Eb loop returns false
          record(h.offState.hostHasAttr === false && h.offState.hostAttr === null && h.offState.inner.found === false && h.offState.inner.ebIgnored === false, `[${vp.label}][${hostKey}] C attr not removed on disable: ${JSON.stringify(h.offState)}`);
          // D: instant toggle back ON without reopening -> attribute restored
          record(h.reOnState.hostHasAttr === true && h.reOnState.hostAttr === "true" && h.reOnState.inner.ebIgnored === true, `[${vp.label}][${hostKey}] D attr not restored on re-enable: ${JSON.stringify(h.reOnState)}`);
        }
        // Workspace extra exclusions (map, auxiliary, input) + Settings UI
        const wsOn = hosts.workspace.onState;
        record(wsOn.map.ebIgnored === false && wsOn.auxiliary.ebIgnored === false && wsOn.input.ebIgnored === false, `[${vp.label}] B workspace exclusions failed: ${JSON.stringify(wsOn)}`);
        record(wsOn.headings.includes("阅读") && wsOn.settingsToggleChecked === true && wsOn.desc.includes("只在 MarginStudy 阅读器内生效"), `[${vp.label}] Settings UI check failed`);

        // E: No regression on native gestures while data-ignore-swipe="true" is active
        const initE = await evalCdp("window.setupPdfForE()");
        record(initE.ignoreSwipeAttr === "true", `[${vp.label}] E data-ignore-swipe missing on PDF scrollEl`);

        // E1: Vertical scroll
        const beforeVert = await evalCdp("window.getPdfMetrics()");
        await singleFingerDrag(initE.cx, initE.cy + 100, initE.cx, initE.cy - 100, 8);
        const afterVert = await evalCdp("window.getPdfMetrics()");
        record(afterVert.scrollTop > beforeVert.scrollTop, `[${vp.label}] E1 vertical scroll failed: ${beforeVert.scrollTop} -> ${afterVert.scrollTop}`);

        // E2: Zoomed horizontal pan
        const zoomed = await evalCdp("window.zoomPdfToOverflow()");
        record(zoomed.scrollWidth > zoomed.clientWidth + 1, `[${vp.label}] E2 zoomed page has no horizontal overflow`);
        await singleFingerDrag(zoomed.cx + 90, zoomed.cy, zoomed.cx - 90, zoomed.cy, 8);
        const afterPan = await evalCdp("window.getPdfMetrics()");
        record(afterPan.scrollLeft > zoomed.scrollLeft, `[${vp.label}] E2 zoomed horizontal pan failed: ${zoomed.scrollLeft} -> ${afterPan.scrollLeft}`);

        // E3: Two-finger pinch zoom
        const fitAgain = await evalCdp("window.resetPdfFitWidth()");
        await twoFingerPinch(fitAgain.cx, fitAgain.cy, 40, 96, 6);
        const afterPinch = await evalCdp("window.getPdfMetrics()");
        record(afterPinch.scale > fitAgain.scale, `[${vp.label}] E3 pinch zoom failed: ${fitAgain.scale} -> ${afterPinch.scale}`);

        // E4: Text selection
        const sel = await evalCdp("window.testLongPressTextSelection()");
        record(sel.length === 10, `[${vp.label}] E4 text selection failed: ${JSON.stringify(sel)}`);

        summary[vp.label] = {
          hosts_ABCD: {
            pdf: { on: hosts.pdf.onState.hostAttr, off: hosts.pdf.offState.hostAttr, reOn: hosts.pdf.reOnState.hostAttr, ebOn: hosts.pdf.onState.inner.ebIgnored, ebOff: hosts.pdf.offState.inner.ebIgnored, toolbarEb: hosts.pdf.onState.toolbar.ebIgnored },
            word: { on: hosts.word.onState.hostAttr, off: hosts.word.offState.hostAttr, reOn: hosts.word.reOnState.hostAttr, ebOn: hosts.word.onState.inner.ebIgnored, ebOff: hosts.word.offState.inner.ebIgnored, toolbarEb: hosts.word.onState.toolbar.ebIgnored },
            html: { on: hosts.html.onState.hostAttr, off: hosts.html.offState.hostAttr, reOn: hosts.html.reOnState.hostAttr, ebOn: hosts.html.onState.inner.ebIgnored, ebOff: hosts.html.offState.inner.ebIgnored, toolbarEb: hosts.html.onState.toolbar.ebIgnored },
            epub: { on: hosts.epub.onState.hostAttr, off: hosts.epub.offState.hostAttr, reOn: hosts.epub.reOnState.hostAttr, ebOn: hosts.epub.onState.inner.ebIgnored, ebOff: hosts.epub.offState.inner.ebIgnored, toolbarEb: hosts.epub.onState.toolbar.ebIgnored },
            workspace: { on: hosts.workspace.onState.hostAttr, off: hosts.workspace.offState.hostAttr, reOn: hosts.workspace.reOnState.hostAttr, ebOn: hosts.workspace.onState.inner.ebIgnored, ebOff: hosts.workspace.offState.inner.ebIgnored, exclusionsEb: { toolbar: wsOn.toolbar.ebIgnored, map: wsOn.map.ebIgnored, auxiliary: wsOn.auxiliary.ebIgnored, input: wsOn.input.ebIgnored } },
          },
          E_gestures: {
            verticalScrollTop: [beforeVert.scrollTop, afterVert.scrollTop],
            zoomedPanScrollLeft: [zoomed.scrollLeft, afterPan.scrollLeft],
            zoomedWidth: [zoomed.scrollWidth, zoomed.clientWidth],
            pinchScale: [fitAgain.scale, afterPinch.scale],
            textSelectionLen: sel.length,
          },
        };
      }

      const errs = await evalCdp("window.getErrors()");
      record(errs.length === 0, "Unhandled browser errors: " + JSON.stringify(errs));

      console.log(JSON.stringify(summary, null, 2));
      console.log(`PASS reader-swipe-guard: ${passedChecks}/${totalChecks} assertions passed`);
    } finally {
      ws.close();
    }
  } finally {
    await browser("close").catch(() => {});
    await new Promise(done => server.close(done));
  }
} finally {
  await rm(temporary, { recursive: true, force: true }).catch(() => {});
}
