import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { inspect, isDeepStrictEqual } from "node:util";
import { compileFunction } from "node:vm";

export const project = resolve(process.argv[2] ?? process.cwd());
export const docPath = "b6-b7-fixture.pdf";
export const width = 400;
export const height = 500;
export const referenceLayer = "layer-reference";
export const layers = [
  { id: "default", name: "Default" },
  { id: referenceLayer, name: "Reference" },
];
const crop = { left: 0, top: 0, right: 1, bottom: 1 };
const pixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=", "base64");
const viewport = {
  width, height, scale: 1, rotation: 0, viewBox: [0, 0, width, height],
  convertToPdfPoint: (x, y) => [x, height - y],
  convertToViewportRectangle: ([left, bottom, right, top]) => [left, height - bottom, right, height - top],
};

export function dependencies() {
  const local = createRequire(join(project, "package.json"));
  try {
    local.resolve("esbuild");
    return local;
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: project, encoding: "utf8" }).trim();
    return createRequire(join(dirname(gitDir), "package.json"));
  }
}

export function pen(id, color, points, extra = {}) {
  return {
    id, docPath, docKind: "pdf", page: 1, type: "pen", rects: [], text: "", color,
    createdAt: "2026-11-24T00:00:00.000Z", inkWidth: 4, inkOpacity: 1,
    strokes: [points.map(([x, y]) => ({ x: x / width, y: y / height }))], ...extra,
  };
}

export function imageOverlay(id, left, top, extra = {}) {
  return {
    id, docPath, docKind: "pdf", page: 1, type: "note",
    rects: [{ x: left, y: height - top - 80, w: 120, h: 80 }],
    pdfCoordinateSpace: "pdf", text: id, color: "#304050",
    createdAt: "2026-11-24T00:00:00.000Z", overlay: { kind: "image" },
    image: `data:image/png;base64,${pixelPng.toString("base64")}`, ...extra,
  };
}

class Element extends EventTarget {
  constructor(tag) { super(); this.tagName = tag; }
  className = "";
  clientWidth = width;
  clientHeight = height;
  children = [];
  dataset = {};
  parentElement = null;
  style = { setProperty: (key, value) => { this.style[key] = value; } };
  classList = {
    contains: name => this.className.split(/\s+/).includes(name),
    toggle: (name, force) => {
      const names = new Set(this.className.split(/\s+/).filter(Boolean));
      if (force ?? !names.has(name)) names.add(name);
      else names.delete(name);
      this.className = [...names].join(" ");
    },
    add: name => this.classList.toggle(name, true),
    remove: name => this.classList.toggle(name, false),
  };
  setAttribute(name, value) { this[name] = value; }
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parentElement = this;
      this.children.push(node);
    }
  }
  after(...nodes) { this.parentElement.append(...nodes); }
  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  contains(node) { return this === node || this.descendants().includes(node); }
  querySelectorAll(selector) {
    return this.descendants().filter(node => selector === "*" || selector.startsWith(".") && node.classList.contains(selector.slice(1)));
  }
  closest() { return null; }
  focus() {}
  blur() {}
  cloneNode(deep) {
    const clone = new Element(this.tagName);
    if (deep) clone.append(...this.children.map(node => node.cloneNode(true)));
    return clone;
  }
  getBoundingClientRect() { return { left: 0, top: 0, right: width, bottom: height, width, height }; }
}

class Canvas extends Element {
  constructor() { super("canvas"); }
  width = width;
  height = height;
  strokes = [];
  #stack = [];
  #context = {
    globalAlpha: 1,
    strokeStyle: "#000000",
    setTransform() {},
    drawImage() {},
    save: () => this.#stack.push([this.#context.globalAlpha, this.#context.strokeStyle]),
    restore: () => { [this.#context.globalAlpha, this.#context.strokeStyle] = this.#stack.pop(); },
    clearRect: () => { this.strokes.length = 0; },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke: () => { this.strokes.push({ color: this.#context.strokeStyle, alpha: this.#context.globalAlpha }); },
  };
  getContext() { return this.#context; }
  toBlob(callback) { callback(new Blob([pixelPng], { type: "image/png" })); }
}

async function loadProduction() {
  const require = dependencies();
  const { outputFiles: [bundle] } = await require("esbuild").build({
    absWorkingDir: project,
    stdin: { resolveDir: project, loader: "ts", contents: [
      'export { Store } from "./src/model/store";',
      'export { AnnotationController } from "./src/pdf/annotationLayer";',
      'export { buildEditedPdf } from "./src/pdf/editedPdfExport";',
      'export { exportStudySet } from "./src/export/studySetExport";',
      'export { importStudySetPackage, readStudySetPackage } from "./src/export/studySetImport";',
      'export { TFile } from "obsidian";',
    ].join("\n") },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{
      name: "synthetic-obsidian",
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
          export class Component {}
          export class App {}
          export class Modal {}
          export class Menu {}
          export class ItemView {}
          export class Notice {}
          export class TFile { constructor(path) { this.path = path; this.extension = path.split(".").at(-1); } }
          export const Platform = { isMobile: false, isDesktop: true };
          export const MarkdownRenderer = {};
          export function setIcon() {}
          export function sanitizeHTMLToDom() { throw new Error("HTML is outside this fixture"); }
        ` }));
      },
    }],
  });
  const window = Object.assign(new EventTarget(), { devicePixelRatio: 1, setTimeout, clearTimeout });
  const document = Object.assign(new EventTarget(), {
    body: new Element("body"),
    fonts: { ready: Promise.resolve() },
    createElement: tag => tag === "canvas" ? new Canvas() : new Element(tag),
    createTextNode: text => Object.assign(new Element("#text"), { textContent: text }),
  });
  class Image extends Element {
    constructor() { super("img"); }
    async decode() {}
  }
  class XMLSerializer { serializeToString() { return "<div/>"; } }
  const module = { exports: {} };
  const execute = compileFunction(bundle.text, [
    "module", "exports", "require", "__dirname", "__filename", "window", "document", "navigator",
    "Image", "XMLSerializer", "getComputedStyle",
  ], { filename: "gap-07b-round16.cjs" });
  execute(module, module.exports, require, project, join(project, "main.js"), window, document,
    { userAgent: "Node fixture" }, Image, XMLSerializer, () => []);
  return { ...module.exports, window, pdf: require("pdf-lib") };
}

export async function emptyVault(api) {
  const files = new Map();
  const folders = new Set();
  let saved = null;
  const read = path => {
    if (!files.has(path)) throw new Error(`ENOENT ${path}`);
    return files.get(path);
  };
  const bytes = path => Uint8Array.from(read(path)).buffer;
  const file = path => files.has(path) ? new api.TFile(path) : null;
  const adapter = {
    exists: async path => files.has(path) || folders.has(path),
    read: async path => Buffer.from(read(path)).toString("utf8"),
    readBinary: async path => bytes(path),
    write: async (path, content) => { files.set(path, Buffer.from(content)); },
    mkdir: async path => { folders.add(path); },
    list: async path => ({
      files: [...files.keys()].filter(name => dirname(name) === path),
      folders: [...folders].filter(name => dirname(name) === path),
    }),
    remove: async path => { files.delete(path); },
    rename: async (from, to) => { files.set(to, read(from)); files.delete(from); },
    stat: async path => files.has(path) ? { type: "file", size: read(path).byteLength, mtime: 1 } : null,
  };
  const vault = {
    adapter, configDir: ".obsidian", getAbstractFileByPath: file,
    getFiles: () => [...files.keys()].map(file),
    readBinary: async file => bytes(file.path),
    createBinary: async (path, data) => {
      if (files.has(path)) throw new Error(`EEXIST ${path}`);
      files.set(path, Buffer.from(data));
      return file(path);
    },
    delete: async file => { files.delete(file.path); },
  };
  const plugin = {
    app: { vault }, manifest: { id: "margin-study", version: "0.2.0" },
    loadData: async () => structuredClone(saved),
    saveData: async data => { saved = structuredClone(data); },
  };
  const reopen = async () => {
    const store = new api.Store(plugin);
    await store.load();
    return store;
  };
  plugin.store = await reopen();
  return { files, plugin, store: plugin.store, reopen };
}

export async function seededVault(api, annotations) {
  const env = await emptyVault(api);
  const pdf = await api.pdf.PDFDocument.create();
  pdf.addPage([width, height]);
  const bytes = await pdf.save();
  await env.plugin.app.vault.createBinary(docPath, bytes);
  env.store.createStudySet("Round 16 fixture", [docPath]);
  env.store.registerDocument(docPath, undefined, bytes);
  env.store.updateDocMeta(docPath, { handwritingLayers: layers, activeHandwritingLayerId: "default" });
  await env.store.loadAnnotations(docPath);
  await env.store.saveAnnotationsNow(docPath, annotations);
  await env.store.flush();
  return env;
}

export async function readerFixture(api, plugin) {
  const wrapper = new Element("div");
  const annLayer = new Element("div");
  const page = { wrapper, annLayer, handlesLayer: new Element("div"), canvas: new Canvas(), viewport, renderedScale: 1 };
  wrapper.append(annLayer, page.handlesLayer);
  const reader = {
    app: plugin.app, plugin,
    getFilePath: () => docPath,
    getDoc: () => ({ getPage: async () => ({ getViewport: () => viewport }) }),
    getScrollContainer: () => wrapper, getPdfPageEdits: () => null,
    getPageRecord: number => number === 1 ? page : null,
    getScale: () => 1, getPageCrop: () => crop, getPdfPageRotation: () => 0,
    projectAnnotationInk: (_page, strokes) => strokes,
    projectRect: (_page, rect) => ({ left: rect.x, top: height - rect.y - rect.h, width: rect.w, height: rect.h }),
    getHandwritingOnTop: () => true, getExtendNotes: () => [],
    getPdfExportAnnotations: () => controller.getPdfExportAnnotations(),
  };
  class ProbeController extends api.AnnotationController {
    onReadingPreferencesChanged() {}
    syncOcclusionElements() {}
    refreshAssistiveExcerpt() {}
    onAnnotationsChanged() {
      this.syncInkRaster(1);
      for (const element of [...annLayer.children]) this.detachAnnotationElement(element);
      for (const annotation of this.getAnnotationsForDisplay()) {
        if (annotation.overlay) this.renderOne(annotation);
      }
    }
  }
  const controller = new ProbeController(plugin, reader);
  await controller.loadForDoc(docPath);
  controller.onAnnotationsChanged();
  function gesture(id, handle, dx, dy) {
    const chrome = page.handlesLayer.children.find(node => node.dataset.annId === id);
    const target = chrome?.querySelectorAll(`.ms-free-overlay-${handle}`)[0];
    if (!target) throw new Error(`No ${handle} handle for ${id}`);
    const sample = (type, clientX, clientY) => Object.assign(new Event(type, { cancelable: true }),
      { button: 0, isPrimary: true, pointerId: 1, clientX, clientY });
    target.dispatchEvent(sample("pointerdown", 0, 0));
    api.window.dispatchEvent(sample("pointerup", dx, dy));
  }
  return {
    controller, gesture,
    entries: reader.getPdfExportAnnotations,
    model: () => structuredClone(controller.cache),
    overlays: () => annLayer.children.filter(node => node.dataset.annId),
    canvasStrokes: () => [...(wrapper.children.find(node => node.classList.contains("ms-ink-raster"))?.strokes ?? [])],
    exportPdf: ({ copySource = true } = {}) => api.buildEditedPdf(reader, { pages: [
      { id: "fixture-page", ...(copySource ? { sourcePage: 1 } : { width, height }) },
    ] }, { includeAnnotations: true }, () => {}),
  };
}

export async function roundTrip(api, annotations, { includePdf = true } = {}) {
  const source = await seededVault(api, annotations);
  const archiveFiles = new Map();
  const output = "fixture.marginstudy-set.zip";
  api.window.require = module => {
    if (module === "@electron/remote") return { dialog: { showSaveDialog: async () => ({ filePath: output }) } };
    if (module === "path") return { dirname, join };
    if (module === "fs") return { promises: {
      writeFile: async (path, bytes) => { archiveFiles.set(path, Buffer.from(bytes)); },
      link: async (from, to) => { archiveFiles.set(to, archiveFiles.get(from)); },
      unlink: async path => { archiveFiles.delete(path); },
    } };
    throw new Error(`Unexpected export host module: ${module}`);
  };
  const before = await source.store.loadAnnotations(docPath);
  const zipPath = await api.exportStudySet(source.plugin, { includePdf, history: "none" });
  const bytes = Uint8Array.from(archiveFiles.get(zipPath)).buffer;
  const archive = await api.readStudySetPackage(bytes);
  const target = await emptyVault(api);
  const targetBefore = { files: target.files.size, annotations: (await target.store.loadAnnotations(docPath)).length };
  let summary, error = null;
  try {
    summary = await api.importStudySetPackage(target.plugin, bytes);
  } catch (failure) { error = String(failure); }
  const reopened = await target.reopen();
  const after = await reopened.loadAnnotations(docPath);
  return { before, after, archive, target, targetBefore, reopened, summary, error };
}

export async function run(name, scenario) {
  let failed = false;
  const check = (label, actual, expected) => {
    if (isDeepStrictEqual(actual, expected)) console.log(`PASS ${name} ${label}`);
    else {
      failed = true;
      console.error(`FAIL ${name} ${label}\n  actual:   ${inspect(actual, { depth: null })}\n  expected: ${inspect(expected, { depth: null })}`);
    }
  };
  try {
    await scenario(await loadProduction(), check);
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error(`ERROR ${name}\n  actual:   ${error.stack ?? error}\n  expected: 场景完整执行并返回可比较的结果`);
    process.exitCode = 2;
  }
}
