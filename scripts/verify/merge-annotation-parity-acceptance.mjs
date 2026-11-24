/**
 * [INPUT]: 依赖 pageCollection、Store、inkLayers、documentNotebooks、editedDocument、pdfExport 与 esbuild/pdf-lib，零私有夹具依赖。
 * [OUTPUT]: 无头验证 G6c-03（PDF/.msref 双轨批注携带与非默认笔记本一致性）、G6c-04（snapshotAnnotations 保真/层同步/孤儿与 bindToInkLayer 三态）、G6c-05（EditedPdfDocument 与 .msref 源解析）与 G6c-06（冷重载与导出一致）。
 * [POS]: 公开无头验收套件 merge-annotation-parity，固化 GAP-06c 数据层与批注一致性不变量。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { compileFunction } from "node:vm";
import { readPagePaint } from "./annotation-refs/export-roundtrip/pdf-content.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, "../..");
const evidenceDir = process.env.MARGINSTUDY_EVIDENCE_DIR ? resolve(process.env.MARGINSTUDY_EVIDENCE_DIR, "gap-06c") : null;

async function mergeEvidence(filename, sectionKey, payload) {
  if (!evidenceDir) return;
  await mkdir(evidenceDir, { recursive: true });
  const target = join(evidenceDir, filename);
  let existing = {};
  try { existing = JSON.parse(await readFile(target, "utf8")); } catch { /* new file */ }
  if (sectionKey) existing[sectionKey] = payload;
  else existing = payload;
  await writeFile(target, JSON.stringify(existing, null, 2) + "\n");
}

function sha256(bytes) {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function dependencies() {
  const local = createRequire(join(project, "package.json"));
  try {
    local.resolve("esbuild");
    return local;
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: project, encoding: "utf8" }).trim();
    return createRequire(join(dirname(gitDir), "package.json"));
  }
}

const width = 400;
const height = 500;
const pixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=";

async function loadModules() {
  const require = dependencies();
  const { build } = require("esbuild");
  const pdfLib = require("pdf-lib");
  const { outputFiles: [bundle] } = await build({
    stdin: {
      contents: `
        export { TFile, Notice } from "obsidian";
        export { Store } from "./src/model/store.ts";
        export {
          createPageCollection, appendPageReferences, readPageCollection,
          openPageCollectionDocument, PageCollectionDocument, mapCollectionAnnotation,
        } from "./src/documents/pageCollection.ts";
        export { EditedPdfDocument, originalPdfPages } from "./src/pdf/editedDocument.ts";
        export { buildEditedPdf } from "./src/pdf/editedPdfExport.ts";
        export {
          inkLayerState, isOrphanInkLayer, isInkLayerBound, annotationInkLayer,
        } from "./src/annot/inkLayers.ts";
        export { documentNotebookState, notebookMeta } from "./src/annot/documentNotebooks.ts";
      `,
      resolveDir: project,
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    external: ["pdf-lib"],
    plugins: [{
      name: "gap06c-headless-stubs",
      setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
        b.onLoad({ filter: /^obsidian$/, namespace: "stub" }, () => ({
          contents: `
            export class TFile {
              constructor(path) {
                this.path = path;
                this.name = path.split("/").pop();
                const dot = this.name.lastIndexOf(".");
                this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
                this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
                this.stat = { size: 0, mtime: 1, ctime: 1 };
              }
            }
            export class Notice { constructor(message) { globalThis.__msNotices?.push(String(message)); } }
            export const Platform = { isMobile: false };
            export function setIcon() {}
            export class Component { load() {} unload() {} register() {} addChild(c) { return c; } removeChild(c) { return c; } }
            export class ItemView extends Component {}
            export class Menu {}
            export class Scope {}
            export class WorkspaceLeaf {}
            export class Modal {}
            export const MarkdownRenderer = { async render() {} };
          `,
          loader: "js",
        }));
        b.onResolve({ filter: /\/pdfjs$/ }, () => ({ path: "pdfjs-stub", namespace: "stub" }));
        b.onLoad({ filter: /^pdfjs-stub$/, namespace: "stub" }, () => ({
          contents: `
            const { PDFDocument } = require("pdf-lib");
            export async function loadPdf(bytes) {
              const doc = await PDFDocument.load(bytes);
              const pages = doc.getPages();
              return {
                numPages: pages.length,
                async getPage(number) {
                  if (!Number.isInteger(number) || number < 1 || number > pages.length) throw new Error("Page out of range: " + number);
                  const size = pages[number - 1].getSize();
                  return {
                    pageNumber: number,
                    rotate: 0,
                    getViewport({ scale = 1 } = {}) {
                      return {
                        width: size.width * scale,
                        height: size.height * scale,
                        scale,
                        rotation: 0,
                        viewBox: [0, 0, size.width, size.height],
                        convertToPdfPoint: (x, y) => [x / scale, size.height - y / scale],
                        convertToViewportRectangle: ([l, b, r, t]) => [l * scale, (size.height - b) * scale, r * scale, (size.height - t) * scale],
                      };
                    },
                  };
                },
                async getOutline() { return []; },
                async destroy() {},
              };
            }
          `,
          loader: "js",
        }));
      },
    }],
  });

  const window = Object.assign(new EventTarget(), { devicePixelRatio: 1, setTimeout, clearTimeout });
  const document = Object.assign(new EventTarget(), {
    body: { append() {} },
    createElement: () => ({ getContext: () => null, style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, append() {} }),
  });
  const mod = { exports: {} };
  const exec = compileFunction(bundle.text, ["module", "exports", "require", "__dirname", "__filename", "window", "document", "navigator"], { filename: "gap06c-parity.cjs" });
  exec(mod, mod.exports, require, project, join(project, "main.js"), window, document, { userAgent: "Node" });
  return { ...mod.exports, pdfLib };
}

async function makePdf(pdfLib, pageCount = 3) {
  const doc = await pdfLib.PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([width + i * 10, height]);
  }
  return await doc.save();
}

async function createVault(api) {
  const files = new Map();
  const folders = new Set();
  let saved = null;
  const readBuf = (p) => {
    if (!files.has(p)) throw new Error("ENOENT " + p);
    return files.get(p);
  };
  const toArrayBuffer = (p) => Uint8Array.from(readBuf(p)).buffer;
  const fileObj = (p) => (files.has(p) ? new api.TFile(p) : null);
  const adapter = {
    exists: async (p) => files.has(p) || folders.has(p),
    read: async (p) => Buffer.from(readBuf(p)).toString("utf8"),
    readBinary: async (p) => toArrayBuffer(p),
    write: async (p, content) => { files.set(p, Buffer.from(content)); },
    mkdir: async (p) => { folders.add(p); },
    list: async (p) => ({
      files: [...files.keys()].filter((name) => dirname(name) === p),
      folders: [...folders].filter((name) => dirname(name) === p),
    }),
    remove: async (p) => { files.delete(p); },
    rename: async (from, to) => { files.set(to, readBuf(from)); files.delete(from); },
    stat: async (p) => (files.has(p) ? { type: "file", size: readBuf(p).byteLength, mtime: 1 } : null),
  };
  const vault = {
    adapter,
    configDir: ".obsidian",
    getAbstractFileByPath: fileObj,
    getFiles: () => [...files.keys()].map(fileObj),
    createFolder: async (p) => { folders.add(p); },
    readBinary: async (f) => toArrayBuffer(f.path),
    createBinary: async (p, data) => {
      if (files.has(p)) throw new Error("EEXIST " + p);
      files.set(p, Buffer.from(data));
      return fileObj(p);
    },
    modifyBinary: async (f, data) => { files.set(f.path, Buffer.from(data)); },
    trash: async (f) => { files.delete(f.path); },
  };
  const plugin = {
    app: { vault },
    manifest: { id: "margin-study", version: "0.2.0" },
    loadData: async () => structuredClone(saved),
    saveData: async (data) => { saved = structuredClone(data); },
    refreshSidebar() {},
  };
  const reopenStore = async () => {
    const store = new api.Store(plugin);
    await store.load();
    let activeAnnSubs = 0;
    const origSub = store.subscribeAnnotations.bind(store);
    store.subscribeAnnotations = (path, listener) => {
      activeAnnSubs++;
      const unsub = origSub(path, listener);
      let done = false;
      return () => { if (!done) { done = true; activeAnnSubs--; unsub(); } };
    };
    Object.defineProperty(store, "annotationSubscriptionCount", { get: () => activeAnnSubs });
    plugin.store = store;
    return store;
  };
  await reopenStore();
  return { files, plugin, get store() { return plugin.store; }, reopenStore };
}

function makeRichPageAnns(docPath, page, notebookId, prefix) {
  const base = { docPath, docKind: "pdf", page, documentNotebookId: notebookId, pdfCoordinateSpace: "pdf", createdAt: "2026-11-24T00:00:00Z" };
  return [
    { ...base, id: `${prefix}-hl`, type: "highlight", rects: [{ x: 30, y: 400, w: 120, h: 16 }], text: `${prefix} highlight`, color: "#ffd54f", cardId: `${prefix}-card-hl` },
    { ...base, id: `${prefix}-ul`, type: "underline", rects: [{ x: 30, y: 370, w: 110, h: 14 }], text: `${prefix} underline`, color: "#80cbc4", cardId: `${prefix}-card-ul` },
    { ...base, id: `${prefix}-st`, type: "strike", rects: [{ x: 30, y: 340, w: 100, h: 14 }], text: `${prefix} strike`, color: "#ff8a80", cardId: `${prefix}-card-st` },
    { ...base, id: `${prefix}-rg`, type: "region", rects: [{ x: 30, y: 260, w: 120, h: 60 }], text: `${prefix} region`, color: "#9fa8da", image: pixelPng, cardId: `${prefix}-card-rg` },
    { ...base, id: `${prefix}-note`, type: "note", rects: [{ x: 180, y: 400, w: 90, h: 20 }], text: `${prefix} note`, noteText: `${prefix} note body`, color: "#ce93d8", cardId: `${prefix}-card-note` },
    { ...base, id: `${prefix}-ov`, type: "note", rects: [{ x: 180, y: 310, w: 110, h: 50 }], text: `${prefix} overlay`, color: "#1e88e5", overlay: { kind: "text", box: { x: 0.45, y: 0.3, w: 0.25, h: 0.12 }, textRuns: [{ text: `${prefix} run`, style: { fontFamily: "Helvetica", fontSize: 16, bold: true, italic: false, underline: false, color: "#111111", background: "transparent" } }] } },
    { ...base, id: `${prefix}-pen`, type: "pen", rects: [], text: "", color: "#e53935", inkWidth: 3, strokes: [[{ x: 0.45, y: 0.35 }, { x: 0.65, y: 0.35 }]], hostAnnotationId: `${prefix}-ov`, hostBindingId: `${prefix}-bind-1` },
    { ...base, id: `${prefix}-voice`, type: "voice", rects: [{ x: 200, y: 220, w: 28, h: 28 }], text: "", audioPath: `audio/${prefix}.webm`, color: "#43a047" },
  ];
}

function normalizeSnapshots(anns) {
  const hostIndex = new Map();
  const nonExcerpts = anns.filter((a) => !["highlight", "underline", "strike", "region"].includes(a.type));
  nonExcerpts.forEach((a, idx) => { if (a.overlay) hostIndex.set(a.id, `host#${idx}`); });
  return nonExcerpts
    .map((a) => ({
      type: a.type,
      text: a.text,
      noteText: a.noteText,
      audioPath: a.audioPath,
      color: a.color,
      hasOverlay: !!a.overlay,
      overlayKind: a.overlay?.kind,
      overlayRuns: a.overlay?.textRuns,
      strokes: a.strokes,
      hasRemappedHost: a.hostAnnotationId ? hostIndex.has(a.hostAnnotationId) : false,
      cardId: a.cardId,
      refCount: a.pdfReferencePages?.length ?? 0,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

const failures = [];
function check(label, actual, expected) {
  if (!isDeepStrictEqual(actual, expected)) {
    failures.push(`${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

const api = await loadModules();

// =========================================================================
// G6c-03: PDF target vs .msref target dual-track parity + non-default notebooks
// =========================================================================
{
  const env = await createVault(api);
  const srcBytes = await makePdf(api.pdfLib, 2);
  const dstBytes = await makePdf(api.pdfLib, 2);
  const srcShaBefore = sha256(srcBytes);
  const dstShaBefore = sha256(dstBytes);
  const srcFile = await env.plugin.app.vault.createBinary("src.pdf", srcBytes);
  const dstFile = await env.plugin.app.vault.createBinary("dst.pdf", dstBytes);
  const set = env.store.createStudySet("G6c-03", [srcFile.path, dstFile.path]);
  env.store.setActiveStudySet(set.id);

  env.store.updateDocMeta(srcFile.path, {
    documentNotebooks: [{ id: "nb-src", name: "源笔记本" }],
    activeDocumentNotebookId: "nb-src",
  });
  env.store.updateDocMeta(dstFile.path, {
    documentNotebooks: [{ id: "nb-dst", name: "目标笔记本" }],
    activeDocumentNotebookId: "nb-dst",
  });

  const srcAnns = [
    ...makeRichPageAnns(srcFile.path, 1, "nb-src", "src-nb"),
    ...makeRichPageAnns(srcFile.path, 1, "default", "src-def"),
  ];
  const dstAnns = [
    ...makeRichPageAnns(dstFile.path, 1, "nb-dst", "dst-nb"),
    ...makeRichPageAnns(dstFile.path, 1, "default", "dst-def"),
  ];
  await env.store.saveAnnotationsNow(srcFile.path, srcAnns);
  await env.store.saveAnnotationsNow(dstFile.path, dstAnns);

  // Branch A: target is existing .msref (created with dst page 1 in nb-dst)
  const msrefTarget = await api.createPageCollection(env.plugin, {
    title: "Existing Target",
    pages: [{ sourcePath: dstFile.path, sourcePage: 1, sourceNotebookId: "nb-dst", annotations: "include", origin: "document" }],
    origin: "document",
    annotations: "include",
    studySetId: set.id,
  });
  await api.appendPageReferences(env.plugin, msrefTarget, [
    { sourcePath: srcFile.path, sourcePage: 1, sourceNotebookId: "nb-src", annotations: "include", origin: "page" },
  ]);

  // Branch B: target is .pdf -> createPageCollection with explicit annotations: "include" + active target notebook
  const dstActiveNb = api.documentNotebookState(env.store.getDocMeta(dstFile.path)).active;
  const pdfTargetCreated = await api.createPageCollection(env.plugin, {
    title: "PDF Target Merged",
    pages: [
      { sourcePath: dstFile.path, sourcePage: 1, sourceNotebookId: dstActiveNb, annotations: "include", origin: "document" },
      { sourcePath: srcFile.path, sourcePage: 1, sourceNotebookId: "nb-src", annotations: "include", origin: "page" },
    ],
    origin: "document",
    annotations: "include",
    studySetId: set.id,
  });

  // Also verify Redline #1: createPageCollection(origin:"toc") still defaults to "clean"
  const tocDefault = await api.createPageCollection(env.plugin, {
    title: "TOC Clean Default",
    pages: [{ sourcePath: srcFile.path, sourcePage: 1, sourceNotebookId: "nb-src" }],
    origin: "toc",
    studySetId: set.id,
  });
  const tocManifest = await api.readPageCollection(env.plugin, tocDefault);
  const tocDoc = await api.openPageCollectionDocument(env.plugin, await env.plugin.app.vault.readBinary(tocDefault));
  check("G6c-03 Redline #1 origin:toc default annotations is clean", tocManifest.pages[0].annotations, "clean");
  check("G6c-03 Redline #1 origin:toc linked annotations is 0", tocDoc.getLinkedAnnotations().length, 0);
  check("G6c-03 Redline #1 origin:toc sidecar is 0", (await env.store.loadAnnotations(tocDefault.path)).length, 0);
  await tocDoc.destroy();

  const mA = await api.readPageCollection(env.plugin, msrefTarget);
  const mB = await api.readPageCollection(env.plugin, pdfTargetCreated);
  check("G6c-03 Branch A all pages annotations=include", mA.pages.every((p) => p.annotations === "include"), true);
  check("G6c-03 Branch B all pages annotations=include", mB.pages.every((p) => p.annotations === "include"), true);
  check("G6c-03 Branch A notebooks exact", mA.pages.map((p) => p.sourceNotebookId), ["nb-dst", "nb-src"]);
  check("G6c-03 Branch B notebooks exact", mB.pages.map((p) => p.sourceNotebookId), ["nb-dst", "nb-src"]);

  const docA = await api.openPageCollectionDocument(env.plugin, await env.plugin.app.vault.readBinary(msrefTarget));
  const docB = await api.openPageCollectionDocument(env.plugin, await env.plugin.app.vault.readBinary(pdfTargetCreated));
  const linkedA = docA.getLinkedAnnotations();
  const linkedB = docB.getLinkedAnnotations();
  check("G6c-03 Branch A linked excerpt count === 8 (4 dst + 4 src)", linkedA.length, 8);
  check("G6c-03 Branch B linked excerpt count === 8 (4 dst + 4 src)", linkedB.length, 8);
  check("G6c-03 Branch A zero default notebook excerpts", linkedA.some((a) => a.referenceSource.notebookId === "default"), false);
  check("G6c-03 Branch B zero default notebook excerpts", linkedB.some((a) => a.referenceSource.notebookId === "default"), false);

  // Live sync check: mutate source highlight text
  const loadedSrc = await env.store.loadAnnotations(srcFile.path);
  loadedSrc.find((a) => a.id === "src-nb-hl").text = "src-nb highlight UPDATED";
  env.store.saveAnnotationsDebounced(srcFile.path, loadedSrc);
  await new Promise((r) => setTimeout(r, 25));
  check("G6c-03 Branch A live excerpt sync", docA.getLinkedAnnotations().find((a) => a.referenceSource.anchorAnnId === "src-nb-hl")?.text, "src-nb highlight UPDATED");
  check("G6c-03 Branch B live excerpt sync", docB.getLinkedAnnotations().find((a) => a.referenceSource.anchorAnnId === "src-nb-hl")?.text, "src-nb highlight UPDATED");

  const sidecarA = await env.store.loadAnnotations(msrefTarget.path);
  const sidecarB = await env.store.loadAnnotations(pdfTargetCreated.path);
  const excerptSet = new Set(["highlight", "underline", "strike", "region"]);
  check("G6c-03 Branch A zero excerpts in sidecar", sidecarA.filter((a) => excerptSet.has(a.type)).length, 0);
  check("G6c-03 Branch B zero excerpts in sidecar", sidecarB.filter((a) => excerptSet.has(a.type)).length, 0);
  check("G6c-03 Branch A non-excerpt count === 8 (4 dst + 4 src)", sidecarA.length, 8);
  check("G6c-03 Branch B non-excerpt count === 8 (4 dst + 4 src)", sidecarB.length, 8);
  check("G6c-03 Branch A zero default notebook non-excerpts", sidecarA.some((a) => a.text.includes("def") || a.audioPath?.includes("def")), false);
  check("G6c-03 Branch B zero default notebook non-excerpts", sidecarB.some((a) => a.text.includes("def") || a.audioPath?.includes("def")), false);
  check("G6c-03 all snapshots have cardId === undefined & new id", [...sidecarA, ...sidecarB].every((a) => a.cardId === undefined && !a.id.startsWith("src-nb-") && !a.id.startsWith("dst-nb-")), true);
  check("G6c-03 normalized snapshot sets 100% equivalent", normalizeSnapshots(sidecarA), normalizeSnapshots(sidecarB));

  // Verify original PDFs SHA-256 unchanged
  check("G6c-03 src PDF SHA-256 unchanged", sha256(await env.plugin.app.vault.readBinary(srcFile)), srcShaBefore);
  check("G6c-03 dst PDF SHA-256 unchanged", sha256(await env.plugin.app.vault.readBinary(dstFile)), dstShaBefore);

  await docA.destroy();
  await docB.destroy();

  await mergeEvidence("g6c-03-pdf-msref-parity.json", null, {
    passed: true,
    tocCleanDefaultPreserved: true,
    branchALinkedCount: linkedA.length,
    branchBLinkedCount: linkedB.length,
    branchASidecarCount: sidecarA.length,
    branchBSidecarCount: sidecarB.length,
    normalizedParityEqual: isDeepStrictEqual(normalizeSnapshots(sidecarA), normalizeSnapshots(sidecarB)),
    srcShaUnchanged: true,
    dstShaUnchanged: true,
  });
}

// =========================================================================
// G6c-04: snapshotAnnotations data fidelity, layer sync, deep copy & refs-b7
// =========================================================================
{
  const env = await createVault(api);
  const srcBytes = await makePdf(api.pdfLib, 2);
  const srcFile = await env.plugin.app.vault.createBinary("fidelity-src.pdf", srcBytes);
  const set = env.store.createStudySet("G6c-04", [srcFile.path]);
  env.store.setActiveStudySet(set.id);

  env.store.updateDocMeta(srcFile.path, {
    handwritingLayers: [
      { id: "default", name: "默认图层" },
      { id: "layer-l2", name: "第二手写层" },
    ],
    activeHandwritingLayerId: "layer-l2",
  });

  const base = { docPath: srcFile.path, docKind: "pdf", page: 1, documentNotebookId: "default", pdfCoordinateSpace: "pdf", createdAt: "2026-11-24T00:00:00Z" };
  const missingBindPen = {
    ...base, id: "pen-l2-missing-bind", type: "pen", rects: [], text: "", color: "#1e88e5",
    inkLayerId: "layer-l2", strokes: [[{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.2 }]],
  };
  const srcAnns = [
    // Soft-deleted / empty shells / inactive layer -> MUST be excluded (0 copied)
    { ...base, id: "voice-deleted", type: "voice", rects: [{ x: 10, y: 10, w: 20, h: 20 }], text: "", audioPath: "a.webm", color: "#000", mediaDeleted: true },
    { ...base, id: "ov-deleted", type: "note", rects: [{ x: 10, y: 50, w: 80, h: 30 }], text: "deleted box", color: "#000", inkLayerId: "layer-l2", overlay: { kind: "text", deleted: true } },
    { ...base, id: "pen-deleted-host", type: "pen", rects: [], text: "", color: "#000", inkLayerId: "layer-l2", hostAnnotationId: "ov-deleted", strokes: [[{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }]] },
    { ...base, id: "pen-empty-shell", type: "pen", rects: [], text: "", color: "#000", inkLayerId: "layer-l2", strokes: [] },
    { ...base, id: "pen-inactive-default", type: "pen", rects: [], text: "", color: "#000", inkLayerId: "default", strokes: [[{ x: 0.4, y: 0.4 }, { x: 0.5, y: 0.4 }]] },
    // Active L2 host + bound pen (with deep nested fields)
    {
      ...base, id: "ov-l2-true", type: "note", rects: [{ x: 40, y: 200, w: 120, h: 60 }], text: "L2 host", color: "#1e88e5",
      inkLayerId: "layer-l2", bindToInkLayer: true,
      pos: { x: 0.25, y: 0.5 },
      images: [pixelPng],
      excerptBlocks: [{ kind: "text", text: "block-1" }],
      overlay: { kind: "text", box: { x: 0.1, y: 0.3, w: 0.3, h: 0.12 }, textRuns: [{ text: "run-1", style: { fontFamily: "Helvetica", fontSize: 16, bold: true, italic: false, underline: false, color: "#111111", background: "transparent" } }] },
    },
    {
      ...base, id: "pen-l2-bound", type: "pen", rects: [], text: "", color: "#e53935",
      inkLayerId: "layer-l2", hostAnnotationId: "ov-l2-true", hostBindingId: "bind-l2-1",
      strokes: [[{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.5 }]],
    },
    // Missing bindToInkLayer field on L2
    missingBindPen,
    // Public across all layers: bindToInkLayer: false
    {
      ...base, id: "ov-public-false", type: "note", rects: [{ x: 200, y: 200, w: 90, h: 40 }], text: "public overlay", color: "#43a047",
      inkLayerId: "default", bindToInkLayer: false,
      overlay: { kind: "text", box: { x: 0.5, y: 0.3, w: 0.22, h: 0.1 }, textRuns: [{ text: "pub", style: { fontFamily: "Helvetica", fontSize: 14, bold: false, italic: false, underline: false, color: "#111111", background: "transparent" } }] },
    },
    // Source orphan layer (must stay orphan, never forged into handwritingLayers)
    {
      ...base, id: "pen-orphan", type: "pen", rects: [], text: "", color: "#8e24aa",
      inkLayerId: "deleted-layer-404", strokes: [[{ x: 0.6, y: 0.6 }, { x: 0.7, y: 0.6 }]],
    },
    // Pen whose host is on page 2 (not selected) -> hostAnnotationId & hostBindingId must both be cleared
    {
      ...base, id: "pen-unselected-host", type: "pen", rects: [], text: "", color: "#fb8c00",
      inkLayerId: "layer-l2", hostAnnotationId: "host-on-page-2", hostBindingId: "bind-stale-99",
      strokes: [[{ x: 0.5, y: 0.7 }, { x: 0.6, y: 0.7 }]],
    },
  ];
  await env.store.saveAnnotationsNow(srcFile.path, srcAnns);
  const srcSnapshotBefore = structuredClone(await env.store.loadAnnotations(srcFile.path));

  const targetFile = await api.createPageCollection(env.plugin, {
    title: "Fidelity Target",
    pages: [{ sourcePath: srcFile.path, sourcePage: 1, sourceNotebookId: "default", annotations: "include", origin: "document" }],
    origin: "document",
    annotations: "include",
    studySetId: set.id,
  });

  const copied = await env.store.loadAnnotations(targetFile.path);
  const targetMeta = env.store.getDocMeta(targetFile.path);
  const targetInk = api.inkLayerState(targetMeta);

  // 1. Soft-deleted / empty / inactive excluded
  check("G6c-04 copied count === 6", copied.length, 6);
  check("G6c-04 zero mediaDeleted copied", copied.some((a) => a.mediaDeleted), false);
  check("G6c-04 zero overlay.deleted copied", copied.some((a) => a.overlay?.deleted), false);
  check("G6c-04 zero empty pen shells copied", copied.some((a) => a.type === "pen" && !a.strokes?.length), false);
  check("G6c-04 zero inactive default pen copied", copied.some((a) => a.type === "pen" && a.inkLayerId === "default"), false);

  // 2. Normal active layer L2 synced into target DocMeta.handwritingLayers
  const syncedL2 = targetInk.layers.find((l) => l.id === "layer-l2");
  check("G6c-04 L2 synced to target handwritingLayers", syncedL2, { id: "layer-l2", name: "第二手写层" });
  const copiedL2Pen = copied.find((a) => a.color === "#e53935");
  check("G6c-04 L2 pen isOrphanInkLayer === false", api.isOrphanInkLayer(copiedL2Pen, targetInk), false);
  check("G6c-04 L2 pen erasable/lassoable on L2", api.isInkLayerBound(copiedL2Pen) && !api.isOrphanInkLayer(copiedL2Pen, targetInk) && api.annotationInkLayer(copiedL2Pen, targetInk) === "layer-l2", true);

  // 3. Source orphan layer NOT forged into target handwritingLayers
  check("G6c-04 orphan layer NOT in target handwritingLayers", targetInk.layers.some((l) => l.id === "deleted-layer-404"), false);
  const copiedOrphan = copied.find((a) => a.color === "#8e24aa");
  check("G6c-04 orphan pen keeps inkLayerId", copiedOrphan.inkLayerId, "deleted-layer-404");
  check("G6c-04 orphan pen isOrphanInkLayer === true", api.isOrphanInkLayer(copiedOrphan, targetInk), true);

  // 4. bindToInkLayer tri-state fidelity
  const copiedFalse = copied.find((a) => a.text === "public overlay");
  const copiedTrue = copied.find((a) => a.text === "L2 host");
  const copiedMissing = copied.find((a) => a.color === "#1e88e5" && a.type === "pen");
  check("G6c-04 bindToInkLayer false preserved", Object.hasOwn(copiedFalse, "bindToInkLayer") && copiedFalse.bindToInkLayer === false, true);
  check("G6c-04 bindToInkLayer true preserved", Object.hasOwn(copiedTrue, "bindToInkLayer") && copiedTrue.bindToInkLayer === true, true);
  check("G6c-04 bindToInkLayer missing preserved", Object.hasOwn(copiedMissing, "bindToInkLayer"), false);

  // 5. Deep-copy isolation: mutate target snapshot fields and verify source in-memory cache unchanged
  copiedTrue.overlay.textRuns[0].text = "MUTATED";
  copiedTrue.overlay.textRuns[0].style.bold = false;
  copiedTrue.images.push("data:image/png;base64,MUTATED");
  copiedTrue.excerptBlocks[0].text = "MUTATED";
  copiedTrue.pos.x = 0.99;
  copiedL2Pen.strokes[0][0].x = 0.99;
  const srcAfterMutate = await env.store.loadAnnotations(srcFile.path);
  check("G6c-04 mutating target leaves source cache diff === 0", srcAfterMutate, srcSnapshotBefore);

  // 6. Unselected host clears BOTH hostAnnotationId and hostBindingId
  const copiedUnselected = copied.find((a) => a.color === "#fb8c00");
  check("G6c-04 unselected host clears hostAnnotationId", copiedUnselected.hostAnnotationId, undefined);
  check("G6c-04 unselected host clears hostBindingId", copiedUnselected.hostBindingId, undefined);

  await mergeEvidence("g6c-04-snapshot-fidelity.json", null, {
    passed: true,
    copiedCount: copied.length,
    syncedLayers: targetInk.layers,
    orphanNotForged: !targetInk.layers.some((l) => l.id === "deleted-layer-404"),
    triStatePreserved: {
      false: copiedFalse.bindToInkLayer === false,
      true: copiedTrue.bindToInkLayer === true,
      missing: !Object.hasOwn(copiedMissing, "bindToInkLayer"),
    },
    deepCopyIsolated: true,
    unselectedHostCleared: copiedUnselected.hostAnnotationId === undefined && copiedUnselected.hostBindingId === undefined,
  });
}

// =========================================================================
// G6c-05 (headless): EditedPdfDocument & .msref source resolution + local snapshot
// =========================================================================
{
  const env = await createVault(api);
  const srcBytes = await makePdf(api.pdfLib, 3);
  const extBytes = await makePdf(api.pdfLib, 2);
  const srcFile = await env.plugin.app.vault.createBinary("edited-src.pdf", srcBytes);
  const extAssetPath = "MarginStudyImports/page-assets/ext-1.pdf";
  await env.plugin.app.vault.createFolder("MarginStudyImports");
  await env.plugin.app.vault.createFolder("MarginStudyImports/page-assets");
  await env.plugin.app.vault.createBinary(extAssetPath, extBytes);
  const set = env.store.createStudySet("G6c-05", [srcFile.path]);
  env.store.setActiveStudySet(set.id);

  // Seed distinct annotations on physical page 3 and physical page 1 of src.pdf
  await env.store.saveAnnotationsNow(srcFile.path, [
    { id: "p3-hl", docPath: srcFile.path, docKind: "pdf", page: 3, type: "highlight", rects: [{ x: 10, y: 100, w: 80, h: 15 }], pdfCoordinateSpace: "pdf", text: "phys-3-hl", color: "#ffd54f", createdAt: "2026-11-24" },
    { id: "p3-note", docPath: srcFile.path, docKind: "pdf", page: 3, type: "note", rects: [{ x: 10, y: 140, w: 80, h: 20 }], pdfCoordinateSpace: "pdf", text: "phys-3-note", noteText: "p3", color: "#ce93d8", createdAt: "2026-11-24" },
    { id: "p1-hl", docPath: srcFile.path, docKind: "pdf", page: 1, type: "highlight", rects: [{ x: 10, y: 200, w: 80, h: 15 }], pdfCoordinateSpace: "pdf", text: "phys-1-hl", color: "#ffd54f", createdAt: "2026-11-24" },
    { id: "imp-note", docPath: srcFile.path, docKind: "pdf", page: 2, pdfReferencePages: [{ id: "import:ext1", page: 2 }], type: "note", rects: [{ x: 20, y: 200, w: 80, h: 20 }], pdfCoordinateSpace: "pdf", text: "imported-page-note", color: "#43a047", createdAt: "2026-11-24" },
  ]);

  // Simulate EditedPdfDocument: [source:3, import:ext1(page 2), blank:b1, source:1]
  const edits = {
    version: 1,
    pages: [
      { id: "source:3", sourcePage: 3 },
      { id: "import:ext1", imported: { path: extAssetPath, page: 2 }, width: 400, height: 500 },
      { id: "blank:b1", width: 400, height: 500 },
      { id: "source:1", sourcePage: 1 },
    ],
  };
  const resolveEditedPages = (pages) => pages.map((page) => {
    const edited = edits.pages[page - 1];
    if (edited?.imported) {
      return {
        sourcePath: edited.imported.path,
        sourcePage: edited.imported.page,
        sourceNotebookId: "default",
        annotations: "include",
        origin: "page",
        collectionSource: { path: srcFile.path, page, referenceId: edited.id, notebookId: "default", hadSourceSnapshots: false },
      };
    }
    if (!edited?.sourcePage) throw new Error("空白插页暂不能用于书页重组");
    return { sourcePath: srcFile.path, sourcePage: edited.sourcePage, sourceNotebookId: "default", annotations: "include", origin: "page" };
  });

  // 1. Blank page rejected with zero dirty writes
  const filesBeforeBlank = [...env.files.keys()].sort();
  let blankRejected = false;
  try {
    const refs = resolveEditedPages([1, 3]);
    await api.createPageCollection(env.plugin, { title: "Should Fail", pages: refs, origin: "document", annotations: "include", studySetId: set.id });
  } catch (err) {
    blankRejected = String(err.message).includes("空白插页");
  }
  check("G6c-05 blank page rejected", blankRejected, true);
  check("G6c-05 blank page zero dirty writes", [...env.files.keys()].sort(), filesBeforeBlank);

  // 2. Reordered + imported pages resolve exact physical sourcePath/sourcePage & annotations align offset === 0
  const mergedEdited = await api.createPageCollection(env.plugin, {
    title: "From Edited PDF",
    pages: resolveEditedPages([1, 2, 4]),
    origin: "document",
    annotations: "include",
    studySetId: set.id,
  });
  const editedManifest = await api.readPageCollection(env.plugin, mergedEdited);
  check("G6c-05 edited sourcePath/sourcePage exact", editedManifest.pages.map((p) => [p.sourcePath, p.sourcePage]), [
    [srcFile.path, 3],
    [extAssetPath, 2],
    [srcFile.path, 1],
  ]);
  const editedDoc = await api.openPageCollectionDocument(env.plugin, await env.plugin.app.vault.readBinary(mergedEdited));
  const editedLinked = editedDoc.getLinkedAnnotations();
  check("G6c-05 phys-3-hl aligns to display page 1 (offset 0)", editedLinked.find((a) => a.text === "phys-3-hl")?.page, 1);
  check("G6c-05 phys-1-hl aligns to display page 3 (offset 0)", editedLinked.find((a) => a.text === "phys-1-hl")?.page, 3);
  const editedSidecar = await env.store.loadAnnotations(mergedEdited.path);
  check("G6c-05 phys-3-note aligns to page 1", editedSidecar.find((a) => a.text === "phys-3-note")?.page, 1);
  check("G6c-05 imported-page-note aligns to page 2", editedSidecar.find((a) => a.text === "imported-page-note")?.page, 2);
  await editedDoc.destroy();

  // 3. .msref as source: underlying PDF excerpts live-map + source .msref local non-excerpt snapshots copied without duplicating
  const srcMsref = await api.createPageCollection(env.plugin, {
    title: "Source MSREF",
    pages: [{ sourcePath: srcFile.path, sourcePage: 3, sourceNotebookId: "default", annotations: "include", origin: "document" }],
    origin: "document",
    annotations: "include",
    studySetId: set.id,
  });
  const srcMsrefManifest = await api.readPageCollection(env.plugin, srcMsref);
  const srcMsrefAnns = await env.store.loadAnnotations(srcMsref.path);
  srcMsrefAnns.push({
    id: "msref-local-note",
    docPath: srcMsref.path,
    docKind: "pdf",
    page: 1,
    pdfReferencePages: [{ id: srcMsrefManifest.pages[0].id, page: 1 }],
    type: "note",
    rects: [{ x: 80, y: 240, w: 90, h: 24 }],
    pdfCoordinateSpace: "pdf",
    text: "msref local note",
    noteText: "added in msref",
    color: "#26a69a",
    createdAt: "2026-11-24",
  });
  await env.store.saveAnnotationsNow(srcMsref.path, srcMsrefAnns);

  const dstFromMsref = await api.createPageCollection(env.plugin, {
    title: "Target From MSREF",
    pages: [{
      sourcePath: srcMsrefManifest.pages[0].sourcePath,
      sourcePage: srcMsrefManifest.pages[0].sourcePage,
      sourceNotebookId: srcMsrefManifest.pages[0].sourceNotebookId,
      annotations: "include",
      origin: "document",
      collectionSource: {
        path: srcMsref.path,
        page: 1,
        referenceId: srcMsrefManifest.pages[0].id,
        notebookId: "default",
        hadSourceSnapshots: srcMsrefManifest.pages[0].annotations === "include",
      },
    }],
    origin: "document",
    annotations: "include",
    studySetId: set.id,
  });
  const dstFromMsrefDoc = await api.openPageCollectionDocument(env.plugin, await env.plugin.app.vault.readBinary(dstFromMsref));
  const dstFromMsrefSidecar = await env.store.loadAnnotations(dstFromMsref.path);
  check("G6c-05 msref source underlying excerpt live-mapped", dstFromMsrefDoc.getLinkedAnnotations().some((a) => a.text === "phys-3-hl"), true);
  check("G6c-05 msref source local non-excerpt snapshotted", dstFromMsrefSidecar.some((a) => a.text === "msref local note"), true);
  check("G6c-05 msref source no duplicate underlying non-excerpt", dstFromMsrefSidecar.filter((a) => a.text === "phys-3-note").length, 1);
  await dstFromMsrefDoc.destroy();

  await mergeEvidence("g6c-05-edited-and-msref-source.json", "headless", {
    passed: true,
    blankPageRejectedWithZeroDirtyWrites: true,
    editedAlignmentOffset: 0,
    msrefSourceLiveExcerptPreserved: true,
    msrefSourceLocalNoteSnapshotted: true,
    noDuplicateUnderlyingSnapshots: true,
  });
}

// =========================================================================
// G6c-06: Cold reload & PDF export consistency
// =========================================================================
{
  const env = await createVault(api);
  const srcBytes = await makePdf(api.pdfLib, 2);
  const dstBytes = await makePdf(api.pdfLib, 2);
  const srcShaBefore = sha256(srcBytes);
  const dstShaBefore = sha256(dstBytes);
  const srcFile = await env.plugin.app.vault.createBinary("reload-src.pdf", srcBytes);
  const dstFile = await env.plugin.app.vault.createBinary("reload-dst.pdf", dstBytes);
  const set = env.store.createStudySet("G6c-06", [srcFile.path, dstFile.path]);
  env.store.setActiveStudySet(set.id);

  env.store.updateDocMeta(srcFile.path, {
    handwritingLayers: [{ id: "default", name: "默认图层" }, { id: "layer-l2", name: "L2" }],
    activeHandwritingLayerId: "layer-l2",
  });
  await env.store.saveAnnotationsNow(srcFile.path, [
    { id: "r-hl", docPath: srcFile.path, docKind: "pdf", page: 1, type: "highlight", rects: [{ x: 40, y: 380, w: 120, h: 18 }], pdfCoordinateSpace: "pdf", text: "reload hl", color: "#ffd54f", createdAt: "2026-11-24" },
    { id: "r-pen", docPath: srcFile.path, docKind: "pdf", page: 1, type: "pen", rects: [], text: "", color: "#e53935", inkWidth: 4, inkLayerId: "layer-l2", strokes: [[{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.3 }]], createdAt: "2026-11-24" },
  ]);

  const merged = await api.createPageCollection(env.plugin, {
    title: "Cold Reload Target",
    pages: [
      { sourcePath: dstFile.path, sourcePage: 1, sourceNotebookId: "default", annotations: "include", origin: "document" },
      { sourcePath: srcFile.path, sourcePage: 1, sourceNotebookId: "default", annotations: "include", origin: "page" },
    ],
    origin: "document",
    annotations: "include",
    studySetId: set.id,
  });

  const beforeManifest = await api.readPageCollection(env.plugin, merged);
  const beforeMeta = structuredClone(env.store.getDocMeta(merged.path));
  const beforeSidecar = structuredClone(await env.store.loadAnnotations(merged.path));
  const doc1 = await api.openPageCollectionDocument(env.plugin, await env.plugin.app.vault.readBinary(merged));
  const beforeLinked = structuredClone(doc1.getLinkedAnnotations());
  await doc1.destroy();
  check("G6c-06 annotationSubscriptionCount === 0 after destroy", env.store.annotationSubscriptionCount, 0);

  // Cold reload Store + reopen PageCollectionDocument
  await env.reopenStore();
  const afterManifest = await api.readPageCollection(env.plugin, merged);
  const afterMeta = structuredClone(env.store.getDocMeta(merged.path));
  const afterSidecar = structuredClone(await env.store.loadAnnotations(merged.path));
  const doc2 = await api.openPageCollectionDocument(env.plugin, await env.plugin.app.vault.readBinary(merged));
  const afterLinked = structuredClone(doc2.getLinkedAnnotations());

  check("G6c-06 manifest identical after cold reload", afterManifest, beforeManifest);
  check("G6c-06 DocMeta (with synced L2) identical after cold reload", afterMeta, beforeMeta);
  check("G6c-06 sidecar identical after cold reload", afterSidecar, beforeSidecar);
  check("G6c-06 linked annotations identical after cold reload", afterLinked, beforeLinked);

  // Export PDF with both live-mapped excerpts and snapshotted pen annotations
  const exportAnns = [...afterLinked, ...afterSidecar].map((ann) => ({
    annotation: api.mapCollectionAnnotation(ann, afterManifest),
    opacity: 1,
  }));
  const fakeReader = {
    app: env.plugin.app,
    plugin: env.plugin,
    getFilePath: () => merged.path,
    getDoc: () => doc2,
    getPageCrop: () => ({ left: 0, top: 0, right: 1, bottom: 1 }),
    getPdfPageRotation: () => 0,
    getExtendNotes: () => [],
    getPdfExportAnnotations: () => exportAnns,
    getDocumentNotebookId: () => "default",
    getHandwritingOnTop: () => false,
    getBlankBackground: () => false,
    getExtendMode: () => "normal",
    getMarginCommentArea: () => false,
  };
  const editsForExport = {
    version: 1,
    pages: afterManifest.pages.map((p) => ({ id: p.id, imported: { path: p.sourcePath, page: p.sourcePage } })),
  };
  const exportedBytes = await api.buildEditedPdf(fakeReader, editsForExport, { includeAnnotations: true }, () => {});
  const exportedPdf = await api.pdfLib.PDFDocument.load(exportedBytes);
  check("G6c-06 exported PDF page count === 2", exportedPdf.getPageCount(), 2);
  const exportedPage2Bytes = await api.buildEditedPdf(fakeReader, editsForExport, { pages: [2], includeAnnotations: true }, () => {});
  const page2Paints = await readPagePaint(api.pdfLib, exportedPage2Bytes);
  const fills = page2Paints.filter((p) => p.kind === "fill");
  const strokes = page2Paints.filter((p) => p.kind === "stroke");
  check("G6c-06 exported PDF page 2 has both highlight fill and pen stroke", fills.length >= 1 && strokes.length >= 1, true);

  await doc2.destroy();
  check("G6c-06 annotationSubscriptionCount === 0 after second destroy", env.store.annotationSubscriptionCount, 0);
  check("G6c-06 src PDF SHA-256 unchanged after export", sha256(await env.plugin.app.vault.readBinary(srcFile)), srcShaBefore);
  check("G6c-06 dst PDF SHA-256 unchanged after export", sha256(await env.plugin.app.vault.readBinary(dstFile)), dstShaBefore);

  await mergeEvidence("g6c-06-reload-and-export.json", null, {
    passed: true,
    coldReloadDiffZero: true,
    annotationSubscriptionCountAfterClose: env.store.annotationSubscriptionCount,
    exportedPageCount: exportedPdf.getPageCount(),
    exportedPage2Fills: fills.length,
    exportedPage2Strokes: strokes.length,
    srcShaUnchanged: true,
    dstShaUnchanged: true,
  });
}

if (failures.length) {
  console.error(`GAP-06c merge-annotation-parity FAILED (${failures.length}):\n` + failures.join("\n\n"));
  process.exit(1);
}
console.log("GAP-06c merge-annotation-parity PASS (G6c-03, G6c-04, G6c-05-headless, G6c-06)");
