/**
 * [INPUT]: 依赖 ReaderView、WordReaderView、DocumentReaderView、StudyWorkspaceView、MarginStudySettingTab、Store 与默认 agent-browser CDP 后端。
 * [OUTPUT]: 执行阅读区单指水平防侧栏滑出守卫的 A–E + 覆盖范围/排除区/设置项 + G 双真机视口（1131×800@DPR3、1510×962@DPR2）全量验收。
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

// Global touchmove observer on document (bubble phase) to measure defaultPrevented
let touchStats = { total: 0, prevented: 0, lastDefaultPrevented: false };
document.addEventListener("touchmove", (event) => {
  touchStats.total += 1;
  if (event.defaultPrevented) touchStats.prevented += 1;
  touchStats.lastDefaultPrevented = event.defaultPrevented;
}, false);

(window as any).resetTouchStats = () => {
  touchStats = { total: 0, prevented: 0, lastDefaultPrevented: false };
  return touchStats;
};
(window as any).getTouchStats = () => ({ ...touchStats });

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

(window as any).setupPdfFixture = async () => {
  await cleanupActive();
  document.body.classList.add("is-mobile");
  (Platform as any).isMobile = true;

  const { app, host } = makeEnv({
    "swipe.pdf": { name: "swipe", pages: 4, textItems: pageItems },
  });
  const store = new Store(host);
  await store.load();
  assert(store.settings.blockSidebarSwipe === true, "Expected default blockSidebarSwipe === true");
  const plugin = makePlugin(app, store);
  const view = new ReaderView(makeLeaf(app), plugin);
  view.containerEl.style.cssText = "position:relative;width:100vw;height:100vh;display:flex;flex-direction:column;";
  fixturesHost.append(view.containerEl);
  await view.onOpen();
  await view.loadFileByPath("swipe.pdf");
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
  const rect = scrollEl.getBoundingClientRect();
  return {
    cx: Math.round(rect.left + rect.width / 2),
    cy: Math.round(rect.top + rect.height / 2),
    scrollWidth: scrollEl.scrollWidth,
    clientWidth: scrollEl.clientWidth,
    scrollHeight: scrollEl.scrollHeight,
    clientHeight: scrollEl.clientHeight,
    scrollTop: scrollEl.scrollTop,
    scrollLeft: scrollEl.scrollLeft,
    scale: view.getScale(),
    isMobileBody: document.body.classList.contains("is-mobile"),
    dpr: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  };
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
    scrollHeight: scrollEl.scrollHeight,
    clientHeight: scrollEl.clientHeight,
    scrollTop: scrollEl.scrollTop,
    scrollLeft: scrollEl.scrollLeft,
    scale: view.getScale(),
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

(window as any).selectPdfText = () => {
  const view = activeState!.view as ReaderView;
  const span = view.getScrollContainer().querySelector<HTMLElement>(".ms-text-layer span");
  assert(span && span.firstChild, "Missing PDF text span for selection test");
  const range = document.createRange();
  range.setStart(span!.firstChild!, 0);
  range.setEnd(span!.firstChild!, (span!.firstChild!.textContent ?? "").length);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return { selectedText: sel.toString(), isCollapsed: sel.isCollapsed };
};

(window as any).clearSelection = () => {
  window.getSelection()?.removeAllRanges();
  return { isCollapsed: window.getSelection()?.isCollapsed ?? true };
};

(window as any).setBlockSidebarSwipe = (enabled: boolean) => {
  activeState!.store.settings.blockSidebarSwipe = enabled;
  return { blockSidebarSwipe: activeState!.store.settings.blockSidebarSwipe };
};

// Coverage: Word / HTML / EPUB / StudyWorkspace + Exclusions + Settings UI
function buildMinimalEpub(): Uint8Array {
  // Store-only ZIP builder for minimal valid EPUB
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

(window as any).setupWordFixture = async () => {
  await cleanupActive();
  document.body.classList.add("is-mobile");
  (Platform as any).isMobile = true;
  const html = "<h1>Word Swipe Test</h1>" + Array.from({ length: 40 }, (_, i) => "<p>Word paragraph " + (i + 1) + " content.</p>").join("");
  const { app, host } = makeEnv({ "swipe.docx": html });
  const store = new Store(host);
  await store.load();
  const plugin = makePlugin(app, store);
  const view = new WordReaderView(makeLeaf(app), plugin);
  view.containerEl.style.cssText = "position:relative;width:100vw;height:100vh;display:flex;flex-direction:column;";
  fixturesHost.append(view.containerEl);
  await view.onOpen();
  await view.loadFileByPath("swipe.docx");
  await frame();
  activeState = { view, store, plugin, kind: "word" };
  const scrollEl = view.getScrollContainer();
  const rect = scrollEl.getBoundingClientRect();
  return {
    cx: Math.round(rect.left + rect.width / 2),
    cy: Math.round(rect.top + rect.height / 2),
    scrollWidth: scrollEl.scrollWidth,
    clientWidth: scrollEl.clientWidth,
  };
};

(window as any).setupDocumentFixture = async (ext: "html" | "epub") => {
  await cleanupActive();
  document.body.classList.add("is-mobile");
  (Platform as any).isMobile = true;
  const files: Record<string, any> = ext === "html"
    ? { "swipe.html": "<html><body><h1>HTML Swipe Test</h1>" + Array.from({ length: 40 }, (_, i) => "<p>HTML paragraph " + (i + 1) + " content.</p>").join("") + "</body></html>" }
    : { "swipe.epub": buildMinimalEpub() };
  const { app, host } = makeEnv(files);
  const store = new Store(host);
  await store.load();
  const plugin = makePlugin(app, store);
  const view = new DocumentReaderView(makeLeaf(app), plugin);
  view.containerEl.style.cssText = "position:relative;width:100vw;height:100vh;display:flex;flex-direction:column;";
  fixturesHost.append(view.containerEl);
  await view.onOpen();
  await view.loadFileByPath("swipe." + ext);
  await frame();
  activeState = { view, store, plugin, kind: ext };
  const scrollEl = view.getScrollContainer();
  const rect = scrollEl.getBoundingClientRect();
  return {
    cx: Math.round(rect.left + rect.width / 2),
    cy: Math.round(rect.top + rect.height / 2),
    scrollWidth: scrollEl.scrollWidth,
    clientWidth: scrollEl.clientWidth,
  };
};

(window as any).setupWorkspaceFixture = async () => {
  await cleanupActive();
  document.body.classList.add("is-mobile");
  (Platform as any).isMobile = true;
  const { app, host } = makeEnv({
    "ws.pdf": { name: "ws", pages: 2, textItems: pageItems },
  });
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
  await wait(80);
  // Add an input inside workspace for input-exclusion test
  const testInput = document.createElement("input");
  testInput.type = "text";
  testInput.className = "ms-swipe-test-input";
  testInput.style.cssText = "position:fixed;left:16px;bottom:16px;width:200px;height:36px;z-index:9999;";
  view.containerEl.append(testInput);
  await frame();
  activeState = { view, store, plugin, kind: "workspace" };

  const centerOf = (sel: string) => {
    const node = view.containerEl.querySelector<HTMLElement>(sel);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return null;
    return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), width: r.width, height: r.height };
  };
  return {
    readerHost: centerOf(".ms-workspace-reader-host"),
    toolbar: centerOf(".ms-workspace-toolbar"),
    map: centerOf(".ms-workspace-map"),
    auxiliary: centerOf(".ms-workspace-auxiliary"),
    input: centerOf(".ms-swipe-test-input"),
  };
};

(window as any).verifySettingsUi = async () => {
  const { app, host } = makeEnv({});
  const store = new Store(host);
  await store.load();
  const plugin = makePlugin(app, store);
  const tab = new MarginStudySettingTab(app, plugin);
  tab.display();
  const headings = [...tab.containerEl.querySelectorAll("h3")].map(h => h.textContent?.trim());
  assert(headings.includes("阅读"), "Missing '阅读' heading in settings tab: " + JSON.stringify(headings));
  const items = [...tab.containerEl.querySelectorAll<HTMLElement>(".setting-item")];
  const swipeItem = items.find(i => i.querySelector(".setting-item-name")?.textContent?.trim() === "阅读区禁止左右滑动开侧栏");
  assert(swipeItem, "Missing '阅读区禁止左右滑动开侧栏' setting item");
  const desc = swipeItem!.querySelector(".setting-item-description")?.textContent?.trim() ?? "";
  assert(desc.includes("只在 MarginStudy 阅读器内生效") && desc.includes("不影响上下翻页") && desc.includes("不影响双指缩放"), "Unexpected desc: " + desc);
  const toggle = swipeItem!.querySelector<HTMLInputElement>("input[type='checkbox']");
  assert(toggle && toggle.checked === true, "Expected default toggle checked === true");
  toggle!.checked = false;
  toggle!.dispatchEvent(new Event("change", { bubbles: true }));
  assert(store.settings.blockSidebarSwipe === false, "Expected toggle off to update store.settings.blockSidebarSwipe === false");
  return { passed: true, headingFound: true, label: "阅读区禁止左右滑动开侧栏", desc, defaultChecked: true, afterToggle: store.settings.blockSidebarSwipe };
};

(window as any).getErrors = () => [...errors];
(window as any).ready = true;
`;

try {
  // Reuse synthetic adapters from docFixtures
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

    const twoFingerPinch = async (cx, cy, startHalf = 40, endHalf = 92, steps = 6) => {
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

    const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

    try {
      await sendCdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

      const viewports = [
        { label: "1131x800@DPR3", width: 1131, height: 800, dpr: 3 },
        { label: "1510x962@DPR2", width: 1510, height: 962, dpr: 2 },
      ];

      const viewportResults = {};
      let passedChecks = 0;
      let totalChecks = 0;
      const record = (ok, msg) => { totalChecks++; if (!ok) throw new Error(msg); passedChecks++; };

      for (const vp of viewports) {
        await sendCdp("Emulation.setDeviceMetricsOverride", {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: vp.dpr,
          mobile: true,
        });
        const init = await evalCdp("window.setupPdfFixture()");
        record(init.isMobileBody === true, `[${vp.label}] body.is-mobile missing`);
        record(init.scrollWidth <= init.clientWidth + 1, `[${vp.label}] fit-width has unexpected horizontal overflow: ${init.scrollWidth} vs ${init.clientWidth}`);

        // A1: Horizontal drag 60px on fit-width -> intercepted
        await evalCdp("window.resetTouchStats()");
        await singleFingerDrag(init.cx, init.cy, init.cx + 60, init.cy, 6);
        const aHoriz = await evalCdp("window.getTouchStats()");
        record(aHoriz.prevented > 0 && aHoriz.lastDefaultPrevented === true, `[${vp.label}] A1 horizontal swipe not intercepted: ${JSON.stringify(aHoriz)}`);

        // A2: Vertical drag on same surface -> NOT intercepted, page scrolls vertically
        await evalCdp("window.resetTouchStats()");
        const beforeVert = await evalCdp("window.getPdfMetrics()");
        await singleFingerDrag(init.cx, init.cy + 100, init.cx, init.cy - 100, 8);
        const aVert = await evalCdp("window.getTouchStats()");
        const afterVert = await evalCdp("window.getPdfMetrics()");
        record(aVert.prevented === 0 && aVert.lastDefaultPrevented === false, `[${vp.label}] A2 vertical scroll was intercepted: ${JSON.stringify(aVert)}`);
        record(afterVert.scrollTop > beforeVert.scrollTop, `[${vp.label}] A2 vertical scroll did not move: ${beforeVert.scrollTop} -> ${afterVert.scrollTop}`);

        // B: Zoomed in with horizontal overflow -> NOT intercepted, scrollLeft changes
        const zoomed = await evalCdp("window.zoomPdfToOverflow()");
        record(zoomed.scrollWidth > zoomed.clientWidth + 1, `[${vp.label}] B zoomed page did not overflow horizontally: ${zoomed.scrollWidth} vs ${zoomed.clientWidth}`);
        await evalCdp("window.resetTouchStats()");
        await singleFingerDrag(zoomed.cx + 90, zoomed.cy, zoomed.cx - 90, zoomed.cy, 8);
        const bStats = await evalCdp("window.getTouchStats()");
        const afterPan = await evalCdp("window.getPdfMetrics()");
        record(bStats.prevented === 0 && bStats.lastDefaultPrevented === false, `[${vp.label}] B zoomed horizontal pan was intercepted: ${JSON.stringify(bStats)}`);
        record(afterPan.scrollLeft > zoomed.scrollLeft, `[${vp.label}] B zoomed horizontal pan did not scroll: ${zoomed.scrollLeft} -> ${afterPan.scrollLeft}`);

        // C: Two-finger pinch -> NOT intercepted, scale changes
        const fitAgain = await evalCdp("window.resetPdfFitWidth()");
        const scaleBefore = fitAgain.scale;
        await evalCdp("window.resetTouchStats()");
        await twoFingerPinch(fitAgain.cx, fitAgain.cy, 40, 96, 6);
        const afterPinch = await evalCdp("window.getPdfMetrics()");
        record(afterPinch.scale > scaleBefore, `[${vp.label}] C pinch zoom did not increase scale: ${scaleBefore} -> ${afterPinch.scale}`);

        // D: Active text selection -> horizontal drag NOT intercepted
        const fitD = await evalCdp("window.resetPdfFitWidth()");
        const sel = await evalCdp("window.selectPdfText()");
        record(!sel.isCollapsed && sel.selectedText.length > 0, `[${vp.label}] D failed to create active selection`);
        await evalCdp("window.resetTouchStats()");
        await singleFingerDrag(fitD.cx, fitD.cy, fitD.cx + 60, fitD.cy, 6);
        const dStats = await evalCdp("window.getTouchStats()");
        await evalCdp("window.clearSelection()");
        record(dStats.prevented === 0 && dStats.lastDefaultPrevented === false, `[${vp.label}] D horizontal drag with active selection was intercepted: ${JSON.stringify(dStats)}`);

        // E: Setting OFF (blockSidebarSwipe = false) -> A scenario NOT intercepted
        await evalCdp("window.setBlockSidebarSwipe(false)");
        await evalCdp("window.resetTouchStats()");
        await singleFingerDrag(fitD.cx, fitD.cy, fitD.cx + 60, fitD.cy, 6);
        const eStats = await evalCdp("window.getTouchStats()");
        await evalCdp("window.setBlockSidebarSwipe(true)");
        record(eStats.prevented === 0 && eStats.lastDefaultPrevented === false, `[${vp.label}] E horizontal swipe still intercepted when disabled: ${JSON.stringify(eStats)}`);

        viewportResults[vp.label] = {
          A_horizontal: aHoriz,
          A_vertical: { ...aVert, scrollTopBefore: beforeVert.scrollTop, scrollTopAfter: afterVert.scrollTop },
          B_zoomPan: { ...bStats, scrollWidth: zoomed.scrollWidth, clientWidth: zoomed.clientWidth, scrollLeftBefore: zoomed.scrollLeft, scrollLeftAfter: afterPan.scrollLeft },
          C_pinch: { scaleBefore, scaleAfter: afterPinch.scale },
          D_selection: dStats,
          E_disabled: eStats,
        };
      }

      // Coverage: Word, HTML, EPUB
      const coverage = {};
      for (const [kind, setupExpr] of [
        ["word", "window.setupWordFixture()"],
        ["html", 'window.setupDocumentFixture("html")'],
        ["epub", 'window.setupDocumentFixture("epub")'],
      ]) {
        const info = await evalCdp(setupExpr);
        await evalCdp("window.resetTouchStats()");
        await singleFingerDrag(info.cx, info.cy, info.cx + 60, info.cy, 6);
        const onStats = await evalCdp("window.getTouchStats()");
        record(onStats.prevented > 0 && onStats.lastDefaultPrevented === true, `[${kind}] horizontal swipe not intercepted: ${JSON.stringify(onStats)}`);
        await evalCdp("window.setBlockSidebarSwipe(false)");
        await evalCdp("window.resetTouchStats()");
        await singleFingerDrag(info.cx, info.cy, info.cx + 60, info.cy, 6);
        const offStats = await evalCdp("window.getTouchStats()");
        record(offStats.prevented === 0 && offStats.lastDefaultPrevented === false, `[${kind}] horizontal swipe still intercepted when disabled: ${JSON.stringify(offStats)}`);
        coverage[kind] = { on: onStats, off: offStats };
      }

      // Workspace host + exclusion zones (toolbar, map, auxiliary, input)
      const wsInfo = await evalCdp("window.setupWorkspaceFixture()");
      assert(wsInfo.readerHost && wsInfo.toolbar && wsInfo.map && wsInfo.auxiliary && wsInfo.input, "Missing workspace regions: " + JSON.stringify(wsInfo));
      await evalCdp("window.resetTouchStats()");
      await singleFingerDrag(wsInfo.readerHost.cx, wsInfo.readerHost.cy, wsInfo.readerHost.cx + 60, wsInfo.readerHost.cy, 6);
      const wsReaderStats = await evalCdp("window.getTouchStats()");
      record(wsReaderStats.prevented > 0 && wsReaderStats.lastDefaultPrevented === true, `[workspace.readerHost] horizontal swipe not intercepted: ${JSON.stringify(wsReaderStats)}`);

      const exclusions = {};
      for (const zone of ["toolbar", "map", "auxiliary", "input"]) {
        const pt = wsInfo[zone];
        await evalCdp("window.resetTouchStats()");
        await singleFingerDrag(pt.cx, pt.cy, pt.cx + 60, pt.cy, 6);
        const stats = await evalCdp("window.getTouchStats()");
        record(stats.prevented === 0 && stats.lastDefaultPrevented === false, `[workspace.${zone}] excluded zone was wrongly intercepted: ${JSON.stringify(stats)}`);
        exclusions[zone] = stats;
      }

      // Settings UI check
      const settingsCheck = await evalCdp("window.verifySettingsUi()");
      record(settingsCheck.passed === true, "Settings UI check failed");

      const errs = await evalCdp("window.getErrors()");
      record(errs.length === 0, "Unhandled browser errors: " + JSON.stringify(errs));

      console.log(JSON.stringify({ viewports: viewportResults, coverage, workspace: { readerHost: wsReaderStats, exclusions }, settings: settingsCheck }, null, 2));
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
