import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { inspect, isDeepStrictEqual } from "node:util";
import { compileFunction } from "node:vm";

export const sourcePath = "a.pdf";
export const targetPath = "sub/b.pdf";
export const otherLayer = "layer-l2";
export const missingLayer = "deleted-layer-404";
const crop = { left: 0, top: 0, right: 1, bottom: 1 };
const pageSize = 200;

export function pen(id, docPath, y, extra = {}) {
  return {
    id, docPath, docKind: "pdf", page: 1, type: "pen", rects: [], text: "",
    color: "#123456", inkWidth: 4, createdAt: "2026-11-24",
    strokes: [[{ x: .2, y }, { x: .7, y }]], ...extra,
  };
}

export function overlay(id, docPath, extra = {}) {
  return {
    id, docPath, docKind: "pdf", page: 1, type: "note",
    rects: [{ x: 20, y: 20, w: 70, h: 40 }], text: id,
    color: "#123456", createdAt: "2026-11-24", overlay: { kind: "text" }, ...extra,
  };
}

class FixtureElement extends EventTarget {
  classList = { add() {}, remove() {}, contains() { return false; } };
  dataset = {};
  clientWidth = pageSize;
  clientHeight = pageSize;
  setAttribute() {}
  closest() { return null; }
  after(...siblings) {
    for (const node of siblings) node.parentElement = this.parentElement;
  }
  remove() { this.parentElement = null; }
}

class ProbeCanvas extends FixtureElement {
  width = pageSize;
  height = pageSize;
  #paint = [];
  #path = [];
  #stack = [];
  #context = {
    globalAlpha: 1,
    lineWidth: 1,
    setTransform: (scaleX, skewY, skewX, scaleY, offsetX, offsetY) => {
      if (scaleX !== 1 || scaleY !== 1 || skewY || skewX || offsetX || offsetY) {
        throw new Error("Canvas probe requires the fixture's DPR 1 and identity transform");
      }
    },
    save: () => this.#stack.push([this.#context.globalAlpha, this.#context.lineWidth]),
    restore: () => {
      [this.#context.globalAlpha, this.#context.lineWidth] = this.#stack.pop();
    },
    clearRect: () => { this.#paint = []; },
    beginPath: () => { this.#path = []; },
    moveTo: (x, y) => { this.#path = [[x, y]]; },
    lineTo: (x, y) => { this.#path.push([x, y]); },
    stroke: () => {
      const { globalAlpha, lineWidth } = this.#context;
      this.#paint.push({ points: this.#path.slice(), alpha: globalAlpha, radius: lineWidth / 2 });
    },
  };
  getContext(kind) { return kind === "2d" ? this.#context : null; }
  alphaAt(x, y) {
    let alpha = 0;
    for (const stroke of this.#paint) {
      const hit = stroke.points.slice(1).some(([endX, endY], index) => {
        const [startX, startY] = stroke.points[index];
        const dx = endX - startX, dy = endY - startY;
        const lengthSquared = dx * dx + dy * dy;
        const fraction = lengthSquared ? Math.max(0, Math.min(1,
          ((x - startX) * dx + (y - startY) * dy) / lengthSquared)) : 0;
        return Math.hypot(x - startX - fraction * dx, y - startY - fraction * dy) <= stroke.radius;
      });
      if (hit) alpha = stroke.alpha + alpha * (1 - stroke.alpha);
    }
    return Math.round(255 * alpha);
  }
}

function resolveDependencies(project) {
  const local = createRequire(join(project, "package.json"));
  try {
    local.resolve("esbuild");
    return local;
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    const gitDir = execFileSync("git", ["-C", project, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
    return createRequire(join(dirname(gitDir), "package.json"));
  }
}

async function loadProduction(project, includePlugin) {
  const require = resolveDependencies(project);
  const { build } = require("esbuild");
  const source = [
    'export { Store } from "./src/model/store";',
    'export { isInkLayerBound, inkLayerState } from "./src/annot/inkLayers";',
    'export { Notice, TFile } from "obsidian";',
    includePlugin ? 'export { default as MarginStudyPlugin } from "./src/main";' : [
      'export { AnnotationController } from "./src/pdf/annotationLayer";',
      'export { flattenPdfAnnotations } from "./src/pdf/exportAnnotations";',
    ].join("\n"),
  ].join("\n");
  const { outputFiles: [bundle] } = await build({
    absWorkingDir: project,
    stdin: { contents: source, resolveDir: project, sourcefile: "round9-fixture-entry.ts" },
    bundle: true,
    platform: "node",
    packages: "external",
    format: "cjs",
    write: false,
    plugins: [{
      name: "synthetic-obsidian",
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `
            export class Component {}
            export class Plugin {
              constructor(app, manifest) { this.app = app; this.manifest = manifest; }
              loadData() { return this.app.loadData(); }
              saveData(data) { return this.app.saveData(data); }
              registerView() {}
              registerExtensions() {}
              registerObsidianProtocolHandler() {}
              registerEvent() {}
              registerDomEvent() {}
              register() {}
              addCommand() {}
              addRibbonIcon() {}
              addSettingTab() {}
            }
            export class Notice {
              static messages = [];
              constructor(message) { Notice.messages.push(String(message)); }
              hide() {}
            }
            export class TFile {
              constructor(path) { this.path = path; }
              get name() { return this.path.split("/").at(-1); }
              get extension() { return this.name.split(".").at(-1); }
              get basename() { return this.name.slice(0, -(this.extension.length + 1)); }
            }
            export class TFolder {}
            export class App {}
            export class ItemView {}
            export class WorkspaceLeaf {}
            export class Menu {}
            export class Modal {}
            export class Scope {}
            export class PluginSettingTab {}
            export class Setting {}
            export const MarkdownRenderer = {};
            export const Platform = { isMobile: false, isDesktop: true };
            export function setIcon() {}
            export function sanitizeHTMLToDom() { throw new Error("DOM sanitizing is outside this fixture"); }
            export function requestUrl() { throw new Error("Network is outside this fixture"); }
          `,
          loader: "js",
        }));
      },
    }],
  });
  const module = { exports: {} };
  const window = Object.assign(new EventTarget(), { devicePixelRatio: 1, setTimeout, clearTimeout });
  const document = Object.assign(new EventTarget(), {
    body: new FixtureElement(),
    createElement: tag => tag === "canvas" ? new ProbeCanvas() : new FixtureElement(),
  });
  const execute = compileFunction(bundle.text, [
    "module", "exports", "require", "__dirname", "__filename", "window", "document", "navigator",
  ], { filename: "marginstudy-round9-fixtures.cjs" });
  execute(module, module.exports, require, project, join(project, "main.js"), window, document, { userAgent: "Node fixture" });
  return { ...module.exports, require };
}

function memoryVault(TFile) {
  const files = new Map();
  const disk = new Map();
  const directories = new Set();
  const listeners = new Map();
  const hooks = { beforeWrite: null };
  const renames = [];
  let savedData = null;
  const adapter = {
    exists: async path => disk.has(path) || directories.has(path),
    read: async path => {
      if (!disk.has(path)) throw new Error(`ENOENT ${path}`);
      return disk.get(path);
    },
    readBinary: async path => new TextEncoder().encode(await adapter.read(path)).buffer,
    write: async (path, data) => {
      await hooks.beforeWrite?.(path);
      disk.set(path, data);
    },
    rename: async (from, to) => {
      if (!disk.has(from) || disk.has(to)) throw new Error(`Cannot rename ${from} to ${to}`);
      disk.set(to, disk.get(from));
      disk.delete(from);
      renames.push([from, to]);
    },
    mkdir: async path => { directories.add(path); },
    remove: async path => { disk.delete(path); },
    rmdir: async path => { directories.delete(path); },
    list: async path => ({
      files: [...disk.keys()].filter(key => dirname(key) === path),
      folders: [...directories].filter(key => dirname(key) === path),
    }),
    stat: async path => disk.has(path) ? { type: "file", size: disk.get(path).length, mtime: 1 } : null,
  };
  const app = {
    vault: {
      adapter, configDir: ".obsidian",
      getFiles: () => [...files.values()],
      getAbstractFileByPath: path => files.get(path) ?? null,
      on(name, handler) {
        const handlers = listeners.get(name) ?? [];
        handlers.push(handler);
        listeners.set(name, handlers);
        return { name, handler };
      },
    },
    workspace: { on() {}, onLayoutReady() {}, iterateAllLeaves() {} },
    loadData: async () => structuredClone(savedData),
    saveData: async data => { savedData = structuredClone(data); },
  };
  const manifest = { id: "margin-study", version: "0.2.0" };
  const addPdf = (path, bytes) => { files.set(path, new TFile(path)); disk.set(path, bytes); };
  const emitRename = (oldPath, newPath) => {
    const file = files.get(oldPath);
    if (!file) throw new Error(`Fixture source PDF absent: ${oldPath}`);
    if (!files.has(newPath)) {
      files.delete(oldPath);
      file.path = newPath;
      files.set(newPath, file);
      disk.set(newPath, disk.get(oldPath));
      disk.delete(oldPath);
    }
    const handlers = listeners.get("rename") ?? [];
    if (!handlers.length) throw new Error("Plugin did not register vault.on('rename')");
    for (const handler of handlers) handler(file.path === newPath ? file : new TFile(newPath), oldPath);
  };
  disk.set(".obsidian/plugins/margin-study/pdf.worker.js", "/* fixture: no worker is started */");
  return { app, manifest, disk, hooks, addPdf, emitRename, renames };
}

const layerMeta = {
  handwritingLayers: [{ id: "default", name: "默认图层" }, { id: otherLayer, name: "L2" }],
  activeHandwritingLayerId: "default",
};

export async function inkFixture(project, annotations) {
  return makeInkFixture(await loadProduction(project, false), annotations);
}

async function makeInkFixture(api, annotations, meta = layerMeta) {
  const env = memoryVault(api.TFile);
  const plugin = { app: env.app, manifest: env.manifest, loadData: env.app.loadData, saveData: env.app.saveData };
  const store = plugin.store = new api.Store(plugin);
  await store.load();
  store.updateDocMeta(sourcePath, meta);
  await store.flush();
  env.disk.set(store.sidecarPath(sourcePath), JSON.stringify({ annotations }));

  const wrapper = new FixtureElement();
  const annLayer = new FixtureElement();
  annLayer.parentElement = wrapper;
  const probePage = { wrapper, annLayer, canvas: { width: pageSize },
    viewport: { width: pageSize, height: pageSize }, renderedScale: 1 };
  const reader = {
    getDoc: () => null, getScrollContainer: () => wrapper, getPdfPageEdits: () => null,
    getPageRecord: () => probePage, getScale: () => 1, getPageCrop: () => crop,
    getPdfPageRotation: () => 0, projectAnnotationInk: (_page, strokes) => strokes,
  };
  class InkProbeController extends api.AnnotationController {
    onAnnotationsChanged() { this.syncInkRaster(1); }
    onReadingPreferencesChanged() {}
    syncOcclusionElements() {}
    refreshAssistiveExcerpt() {}
  }
  const controller = new InkProbeController(plugin, reader);
  const load = async () => {
    await controller.loadForDoc(sourcePath);
    controller.onAnnotationsChanged();
  };
  const layerMemberships = async () => {
    const state = controller.getInkLayers();
    const snapshot = structuredClone(controller.cache);
    const result = new Map(snapshot.map(item => [item.id, []]));
    for (const layer of state.layers) {
      const destination = state.layers.find(candidate => candidate.id !== layer.id);
      if (!destination) throw new Error("Membership probe requires two normal layers");
      const control = pen("membership-control", sourcePath, .9, { inkLayerId: layer.id });
      const probe = await makeInkFixture(api, [...snapshot, control], {
        handwritingLayers: state.layers, activeHandwritingLayerId: state.active,
      });
      await probe.load();
      probe.controller.mergeInkLayers(layer.id, destination.id);
      const moved = new Map(probe.cached().map(item => [item.id, item.inkLayerId]));
      await probe.store.flush();
      if (moved.get(control.id) !== destination.id) {
        throw new Error(`Membership control moved to ${moved.get(control.id)}, expected ${destination.id}`);
      }
      for (const item of snapshot) {
        if (item.inkLayerId !== destination.id && moved.get(item.id) === destination.id) {
          result.get(item.id).push(layer.id);
        }
      }
    }
    return result;
  };
  return {
    load, store, controller, layerMemberships,
    alpha: y => controller.inkRasters.get(1)?.canvas.alphaAt(pageSize * .45, pageSize * y) ?? 0,
    cached: () => structuredClone(controller.cache),
    select: id => controller.selectInkLayer(id),
    active: () => controller.getInkLayers().active,
    exportEntries: () => controller.getPdfExportAnnotations(),
    async flatten(entries) {
      const { PDFDocument } = api.require("pdf-lib");
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([pageSize, pageSize]);
      const viewport = { ...probePage.viewport, convertToPdfPoint: (x, y) => [x, pageSize - y] };
      await api.flattenPdfAnnotations(pdf, page, 1, { getViewport: () => viewport }, viewport, crop,
        entries, () => {}, async () => { throw new Error("Unexpected image in ink-only export"); });
      const hasContentStream = !!page.node.Contents();
      const bytes = await pdf.save();
      return { pages: (await PDFDocument.load(bytes)).getPageCount(), hasContentStream };
    },
  };
}

export async function renameFixture(project, withTarget = false) {
  const api = await loadProduction(project, true);
  const env = memoryVault(api.TFile);
  env.addPdf(sourcePath, "%PDF-1.4 source fixture");
  if (withTarget) env.addPdf(targetPath, "%PDF-1.4 different target fixture");
  const plugin = new api.MarginStudyPlugin(env.app, env.manifest);
  await plugin.onload();
  await plugin.sourceRecovery;
  const { store } = plugin;
  store.registerDocument(sourcePath);
  store.updateDocMeta(sourcePath, layerMeta);
  const annotations = [
    pen("public-pen", sourcePath, .2, { bindToInkLayer: false }),
    overlay("public-note", sourcePath, { bindToInkLayer: false }),
    overlay("bound-host", sourcePath, { inkLayerId: otherLayer }),
    pen("bound-pen", sourcePath, .6, { inkLayerId: otherLayer, hostAnnotationId: "bound-host" }),
  ];
  await store.loadAnnotations(sourcePath);
  await store.saveAnnotationsNow(sourcePath, annotations);
  if (withTarget) {
    store.registerDocument(targetPath);
    store.updateDocMeta(targetPath, { bookmarks: [1] });
    await store.loadAnnotations(targetPath);
    await store.saveAnnotationsNow(targetPath, [pen("target-only", targetPath, .4, { bindToInkLayer: false })]);
  }
  api.Notice.messages.length = 0;
  const read = async (path, instance = store) => structuredClone(await instance.loadAnnotations(path));
  const sidecar = path => store.sidecarPath(path);
  const counts = items => {
    const bound = items.filter(item => api.isInkLayerBound(item)).length;
    return { total: items.length, public: items.length - bound, bound };
  };
  const fresh = async () => {
    const reopened = new api.Store(plugin);
    await reopened.load();
    return reopened;
  };
  return {
    ...env, store, read, sidecar, counts, fresh,
    layerState: path => api.inkLayerState(store.getDocMeta(path)),
    settled: () => plugin.documentRenames,
    notices: () => api.Notice.messages.slice(),
    log: async action => {
      const errors = [];
      const original = console.error;
      console.error = (...args) => { errors.push(args.map(String).join(" ")); };
      try { await action(); } finally { console.error = original; }
      return [...api.Notice.messages, ...errors];
    },
  };
}

export function missingPen(id = "orphan-pen", y = .25) {
  return pen(id, sourcePath, y, { inkLayerId: missingLayer });
}

export async function observeErrors(action) {
  const counts = { thrown: null, uncaughtException: 0, unhandledRejection: 0 };
  const exception = () => { counts.uncaughtException++; };
  const rejection = () => { counts.unhandledRejection++; };
  process.on("uncaughtException", exception);
  process.on("unhandledRejection", rejection);
  try {
    try { await action(); } catch (error) { counts.thrown = String(error); }
    await nextTurn();
  } finally {
    process.off("uncaughtException", exception);
    process.off("unhandledRejection", rejection);
  }
  return counts;
}

export async function run(name, scenario) {
  const project = resolve(process.argv[2] ?? process.cwd());
  let failed = false;
  const check = (label, actual, expected) => {
    if (isDeepStrictEqual(actual, expected)) {
      console.log(`PASS ${name} ${label}`);
      return;
    }
    failed = true;
    console.error(`FAIL ${name} ${label}\n  actual:   ${inspect(actual, { depth: null })}\n  expected: ${inspect(expected, { depth: null })}`);
  };
  try {
    await scenario(project, check);
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error(`ERROR ${name}\n  actual:   ${error.stack ?? error}\n  expected: 场景完整执行并返回可比较的结果`);
    process.exitCode = 2;
  }
}
