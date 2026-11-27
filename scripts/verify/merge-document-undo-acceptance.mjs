/**
 * [INPUT]: 依赖 StudyWorkspaceView、ReaderView、Store、pageCollection 与默认 agent-browser 后端，零私有夹具依赖。
 * [OUTPUT]: 执行 GAP-06c G6c-01（合并到 .msref 连续撤重+对照刷新+并发防覆盖）、G6c-02（合并到 .pdf 新建 .msref undo→redo→undo+防误删守卫）、G6c-05（.msref 源与 EditedPdfDocument 端到端合并与撤重）合成浏览器验收。
 * [POS]: 公开浏览器验收套件 merge-document-undo，固化 GAP-06c 工作区合并撤重闭环。
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
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-merge-undo-")));

const fixtureSource = `
import { TFile, notices } from "obsidian";
import { Store } from "${project}/src/model/store";
import { StudyWorkspaceView } from "${project}/src/workspace/studyWorkspace";
import { ReaderView } from "${project}/src/pdf/readerView";
import {
  createPageCollection, readPageCollection, reorderPageReferences, openPageCollectionDocument,
  cleanupCreatedPageCollection, verifyCreatedCollectionUnchanged,
} from "${project}/src/documents/pageCollection";
import * as pageCollectionApi from "${project}/src/documents/pageCollection";
import { createNotebookBytes } from "${project}/src/documents/notebookFormat";

(HTMLElement.prototype as any).empty = function () { this.replaceChildren(); };
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};

const frame = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const assert = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };
const until = async <T>(fn: () => T | Promise<T>, msg: string, tries = 150): Promise<T> => {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await wait(20);
  }
  throw new Error(msg);
};
const button = (root: ParentNode, label: string) => {
  const el = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    b => b.getAttribute("aria-label") === label || b.textContent?.trim() === label,
  );
  if (!el) throw new Error("Missing button: " + label);
  return el;
};

const errors: string[] = [];
window.addEventListener("error", e => errors.push(String(e.error ?? e.message)));
window.addEventListener("unhandledrejection", e => errors.push(String(e.reason)));

const fixturesHost = document.getElementById("fixtures")!;
const stamp = "2026-11-24T00:00:00Z";

function makePdfBytes(id: string, pages = 3): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify({ name: id, pages })).buffer as ArrayBuffer;
}

function bytesSig(buf: ArrayBuffer): string {
  const arr = new Uint8Array(buf);
  let h = 2166136261;
  for (let i = 0; i < arr.length; i++) { h ^= arr[i]; h = Math.imul(h, 16777619); }
  return arr.length + ":" + (h >>> 0).toString(16);
}

async function createHarness() {
  fixturesHost.replaceChildren();
  notices.length = 0;
  const sources = new Map<string, { file: TFile; binary: ArrayBuffer }>();
  const adapterFiles = new Map<string, string>();
  const folders = new Set<string>();
  const vaultEvents = new Map<string, Set<(...args: any[]) => void>>();
  const wsEvents = new Map<string, Set<(...args: any[]) => void>>();

  const emitVault = (name: string, file: TFile) => {
    for (const cb of vaultEvents.get(name) ?? []) cb(file);
  };
  const addPdf = (path: string, pages = 3) => {
    const bin = makePdfBytes(path, pages);
    const file = new TFile(path, bin.byteLength);
    sources.set(path, { file, binary: bin.slice(0) });
    return file;
  };
  const srcPdf = addPdf("Source.pdf", 3);
  const dstPdf = addPdf("Target.pdf", 2);

  const dock = () => ({ collapsed: false, collapse() { this.collapsed = true; }, expand() { this.collapsed = false; } });
  const app: any = {
    vault: {
      configDir: ".obsidian",
      getFiles: () => [...sources.values()].map(v => v.file),
      getAbstractFileByPath: (p: string) => sources.get(p)?.file ?? null,
      async readBinary(file: TFile) {
        const entry = sources.get(file.path);
        if (!entry) throw new Error("Missing binary: " + file.path);
        return entry.binary.slice(0);
      },
      async createBinary(path: string, bytes: ArrayBuffer) {
        if (sources.has(path)) throw new Error("File exists: " + path);
        const file = new TFile(path, bytes.byteLength);
        sources.set(path, { file, binary: bytes.slice(0) });
        emitVault("create", file);
        return file;
      },
      async modifyBinary(file: TFile, bytes: ArrayBuffer) {
        const entry = sources.get(file.path);
        if (!entry) throw new Error("Missing file: " + file.path);
        entry.binary = bytes.slice(0);
        entry.file.stat.size = bytes.byteLength;
      },
      async createFolder(path: string) { folders.add(path); },
      async trash(file: TFile, _system?: boolean) {
        sources.delete(file.path);
        emitVault("delete", file);
      },
      getResourcePath: (file: TFile) => "/synthetic-resource/" + encodeURIComponent(file.path),
      on(name: string, cb: any) {
        const s = vaultEvents.get(name) ?? new Set();
        s.add(cb);
        vaultEvents.set(name, s);
        return { off: () => s.delete(cb) };
      },
      offref(ref: any) { ref?.off?.(); },
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
      offref(ref: any) { ref?.off?.(); },
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
    cards: [],
    nodes: [],
    edges: [],
    srs: {},
    studySets: [{ id: "set-1", name: "Merge Study", docPaths: [srcPdf.path, dstPdf.path], createdAt: stamp }],
    canvases: [{ id: "canvas-1", studySetId: "set-1", name: "Main Map", createdAt: stamp }],
    activeStudySetId: "set-1",
    activeCanvasId: "canvas-1",
    documents: [
      { id: "doc-src", path: srcPdf.path, kind: "pdf", createdAt: stamp },
      { id: "doc-dst", path: dstPdf.path, kind: "pdf", createdAt: stamp },
    ],
    docMeta: {},
    settings: { colors: ["#ffd54f"], defaultColor: "#ffd54f" },
  };
  const plugin: any = {
    app,
    manifest: { id: "margin-study", version: "0.2.0" },
    viewEvents: {},
    activeReader: null,
    loadData: async () => structuredClone(disk),
    saveData: async (data: any) => { disk = structuredClone(data); },
    refreshSidebar() {},
    async openDocument(file: TFile) { return await view.openFile(file); },
  };
  plugin.store = new Store(plugin);
  await plugin.store.load();

  const leaf: any = { app, view: null, getRoot: () => app.workspace.rootSplit };
  app.workspace.activeLeaf = leaf;
  app.workspace.centerLeaf = leaf;
  const view = new StudyWorkspaceView(leaf, plugin);
  leaf.view = view;
  fixturesHost.append(view.containerEl);
  await view.onOpen();
  await frame();

  const openMoreMenu = () => {
    const trigger = view.containerEl.querySelector<HTMLButtonElement>('[data-ms-tool="excerpt.more"], [aria-label="文档与工作区设置"]');
    assert(trigger, "Missing button: 文档与工作区设置 / excerpt.more");
    trigger.click();
    return view.containerEl.querySelector<HTMLElement>('[aria-label="文档 - 更多"]')!;
  };
  const runMergeModal = async (scope: "page" | "range" | "document", targetPath: string, range = "") => {
    const menu = openMoreMenu();
    const mergeBtn = button(menu, "合并到另一份文档…");
    assert(!mergeBtn.disabled, "合并到另一份文档… button should be enabled");
    mergeBtn.click();
    await until(() => document.querySelector('.ms-modal [aria-label="合并范围"]'), "merge dialog missing");
    const modal = document.querySelector<HTMLElement>(".ms-modal")!;
    const select = modal.querySelector<HTMLSelectElement>('[aria-label="合并范围"]')!;
    select.value = scope;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    if (scope === "range") {
      const input = modal.querySelector<HTMLInputElement>('[aria-label="合并页范围"]')!;
      input.value = range;
    }
    const target = modal.querySelector<HTMLSelectElement>('[aria-label="合并目标文档"]')!;
    target.value = targetPath;
    button(modal, "合并").click();
    await until(() => !document.body.contains(modal), "merge modal did not close");
    await frame();
  };

  return { app, plugin, view, srcPdf, dstPdf, sources, runMergeModal, openMoreMenu };
}

const results: Record<string, any> = {};

async function runAll() {
  // =========================================================================
  // G6c-01: Merge into existing .msref (3x) -> Undo 3x -> Redo 3x + comparison refresh + conflict guard
  // =========================================================================
  {
    const h = await createHarness();
    const srcSigBefore = bytesSig(h.sources.get(h.srcPdf.path)!.binary);

    // Seed custom active ink layer L2 + non-excerpt note/pen on Source.pdf
    h.plugin.store.updateDocMeta(h.srcPdf.path, {
      handwritingLayers: [{ id: "default", name: "默认图层" }, { id: "layer-l2", name: "L2" }],
      activeHandwritingLayerId: "layer-l2",
    });
    const srcSeedAnns = [
      { id: "s-hl-2", docPath: h.srcPdf.path, docKind: "pdf", page: 2, type: "highlight", rects: [{ x: 30, y: 400, w: 120, h: 16 }], pdfCoordinateSpace: "pdf", text: "src p2 hl", color: "#ffd54f", createdAt: stamp },
      { id: "s-pen-2", docPath: h.srcPdf.path, docKind: "pdf", page: 2, type: "pen", rects: [], text: "", color: "#e53935", inkLayerId: "layer-l2", strokes: [[{ x: 0.2, y: 0.3 }, { x: 0.5, y: 0.3 }]], createdAt: stamp },
      { id: "s-note-1", docPath: h.srcPdf.path, docKind: "pdf", page: 1, type: "note", rects: [{ x: 50, y: 500, w: 80, h: 20 }], pdfCoordinateSpace: "pdf", text: "src p1 note", noteText: "body1", color: "#ce93d8", createdAt: stamp },
    ];
    await h.plugin.store.saveAnnotationsNow(h.srcPdf.path, srcSeedAnns);
    const srcAnnsBefore = JSON.stringify(await h.plugin.store.loadAnnotations(h.srcPdf.path));

    const targetFile = await createPageCollection(h.plugin, {
      title: "G6c01 Target",
      pages: [{ sourcePath: h.dstPdf.path, sourcePage: 1, origin: "document" }],
      origin: "document",
      annotations: "include",
      studySetId: "set-1",
    });
    h.plugin.store.updateDocMeta(targetFile.path, { bookmarks: [1], foldedPages: [] });
    await h.plugin.store.flush();

    await h.view.openFile(h.srcPdf);
    const srcReader = h.view.getReader() as ReaderView;
    await h.view.openMobileComparison(targetFile, false);
    await srcReader.navigateToReference(2, [], undefined, false);
    await srcReader.renderPage(2);
    const compReader = () => (h.view as any).comparisons[0]?.reader as ReaderView;
    assert(compReader()?.getDoc()?.numPages === 1, "comparison did not open target.msref");

    const snapTarget = async () => ({
      manifest: await readPageCollection(h.plugin, targetFile),
      meta: structuredClone(h.plugin.store.getDocMeta(targetFile.path)),
      anns: structuredClone(await h.plugin.store.loadAnnotations(targetFile.path)),
      compPages: compReader()?.getDoc()?.numPages,
    });

    const s0 = await snapTarget();
    await h.runMergeModal("page", targetFile.path);
    const s1 = await snapTarget();
    assert(s1.manifest.pages.length === 2 && s1.manifest.pages[1].sourcePage === 2, "merge #1 wrong pages: " + JSON.stringify(s1.manifest.pages));
    assert(s1.compPages === 2, "comparison did not refresh after merge #1: " + s1.compPages);
    assert(s1.meta.handwritingLayers?.some((l: any) => l.id === "layer-l2"), "L2 not synced on merge #1");

    await h.runMergeModal("range", targetFile.path, "1,3");
    const s2 = await snapTarget();
    assert(s2.manifest.pages.length === 4 && s2.compPages === 4, "merge #2 wrong pages or comp not refreshed");

    await h.runMergeModal("document", targetFile.path);
    const s3 = await snapTarget();
    assert(s3.manifest.pages.length === 7 && s3.compPages === 7, "merge #3 wrong pages or comp not refreshed");

    // 3 consecutive Undo
    await srcReader.undoLastEdit();
    assert(JSON.stringify(await snapTarget()) === JSON.stringify(s2), "undo #1 did not match s2");
    await srcReader.undoLastEdit();
    assert(JSON.stringify(await snapTarget()) === JSON.stringify(s1), "undo #2 did not match s1");
    await srcReader.undoLastEdit();
    assert(JSON.stringify(await snapTarget()) === JSON.stringify(s0), "undo #3 did not match s0 (diff !== 0)");

    // 3 consecutive Redo
    await srcReader.redoLastEdit();
    assert(JSON.stringify(await snapTarget()) === JSON.stringify(s1), "redo #1 did not match s1");
    await srcReader.redoLastEdit();
    assert(JSON.stringify(await snapTarget()) === JSON.stringify(s2), "redo #2 did not match s2");
    await srcReader.redoLastEdit();
    assert(JSON.stringify(await snapTarget()) === JSON.stringify(s3), "redo #3 did not match s3");

    // External annotation modification conflict guard
    const extAnns = structuredClone(await h.plugin.store.loadAnnotations(targetFile.path));
    extAnns.push({ id: "ext-user-note", docPath: targetFile.path, docKind: "pdf", page: 1, type: "note", rects: [{ x: 10, y: 10, w: 50, h: 20 }], pdfCoordinateSpace: "pdf", text: "external edit", color: "#000", createdAt: stamp });
    await h.plugin.store.saveAnnotationsNow(targetFile.path, extAnns);
    const noticeCountBefore = notices.length;
    await srcReader.undoLastEdit();
    const afterConflictAnns = await h.plugin.store.loadAnnotations(targetFile.path);
    assert(afterConflictAnns.some((a: any) => a.id === "ext-user-note"), "conflict undo overwrote external annotation");
    assert((await readPageCollection(h.plugin, targetFile)).pages.length === 7, "conflict undo modified manifest");
    assert(notices.length > noticeCountBefore, "conflict undo did not emit notice");

    // External manifest reorder conflict guard
    await h.runMergeModal("page", targetFile.path);
    const beforeReorder = await readPageCollection(h.plugin, targetFile);
    const reorderedIds = [...beforeReorder.pages.map(p => p.id)].reverse();
    await reorderPageReferences(h.plugin, targetFile, reorderedIds);
    const noticeCountBefore2 = notices.length;
    await srcReader.undoLastEdit();
    const afterManifestConflict = await readPageCollection(h.plugin, targetFile);
    assert(afterManifestConflict.pages.map(p => p.id).join(",") === reorderedIds.join(","), "conflict undo overwrote reordered manifest");
    assert(notices.length > noticeCountBefore2, "manifest conflict undo did not emit notice");

    // Source PDF bytes & annotations untouched
    assert(bytesSig(h.sources.get(h.srcPdf.path)!.binary) === srcSigBefore, "source PDF bytes changed");
    assert(JSON.stringify(await h.plugin.store.loadAnnotations(h.srcPdf.path)) === srcAnnsBefore, "source annotations changed");

    await h.view.onClose();
    results.g6c01 = {
      passed: true,
      mergesCount: 3,
      comparisonSynced: true,
      undo3DiffZero: true,
      redo3DiffZero: true,
      externalAnnotationConflictProtected: true,
      externalManifestConflictProtected: true,
      sourceUnchanged: true,
    };
  }

  // =========================================================================
  // G6c-02: Merge into .pdf (create .msref) -> undo -> redo -> undo + anti-accidental-delete guard
  // =========================================================================
  {
    const h = await createHarness();
    const srcSigBefore = bytesSig(h.sources.get(h.srcPdf.path)!.binary);
    const dstSigBefore = bytesSig(h.sources.get(h.dstPdf.path)!.binary);

    h.plugin.store.updateDocMeta(h.srcPdf.path, { documentNotebooks: [{ id: "nb-src", name: "源本" }], activeDocumentNotebookId: "nb-src" });
    h.plugin.store.updateDocMeta(h.dstPdf.path, { documentNotebooks: [{ id: "nb-dst", name: "目标本" }], activeDocumentNotebookId: "nb-dst" });
    await h.plugin.store.saveAnnotationsNow(h.srcPdf.path, [
      { id: "src-hl", docPath: h.srcPdf.path, docKind: "pdf", page: 1, documentNotebookId: "nb-src", type: "highlight", rects: [{ x: 20, y: 300, w: 100, h: 16 }], pdfCoordinateSpace: "pdf", text: "src hl", color: "#ffd54f", createdAt: stamp },
      { id: "src-note", docPath: h.srcPdf.path, docKind: "pdf", page: 1, documentNotebookId: "nb-src", type: "note", rects: [{ x: 20, y: 340, w: 100, h: 16 }], pdfCoordinateSpace: "pdf", text: "src note", color: "#ce93d8", createdAt: stamp },
    ]);
    await h.plugin.store.saveAnnotationsNow(h.dstPdf.path, [
      { id: "dst-hl", docPath: h.dstPdf.path, docKind: "pdf", page: 1, documentNotebookId: "nb-dst", type: "highlight", rects: [{ x: 20, y: 300, w: 100, h: 16 }], pdfCoordinateSpace: "pdf", text: "dst hl", color: "#80cbc4", createdAt: stamp },
      { id: "dst-note", docPath: h.dstPdf.path, docKind: "pdf", page: 1, documentNotebookId: "nb-dst", type: "note", rects: [{ x: 20, y: 340, w: 100, h: 16 }], pdfCoordinateSpace: "pdf", text: "dst note", color: "#43a047", createdAt: stamp },
    ]);
    const srcAnnsBefore = JSON.stringify(await h.plugin.store.loadAnnotations(h.srcPdf.path));
    const dstAnnsBefore = JSON.stringify(await h.plugin.store.loadAnnotations(h.dstPdf.path));

    await h.view.openFile(h.srcPdf);
    const snapWorkspace = () => ({
      vaultPaths: [...h.sources.keys()].sort(),
      setDocPaths: [...h.plugin.store.studySets[0].docPaths],
      storeDocPaths: h.plugin.store.documents.map((d: any) => d.path),
      activePath: h.view.getReader()?.getFilePath(),
      tabPaths: (h.view as any).state.tabs.map((t: any) => t.path),
    });
    const beforeMerge = snapWorkspace();

    await h.runMergeModal("page", h.dstPdf.path);
    const createdPath = h.view.getReader()?.getFilePath()!;
    assert(createdPath.endsWith(".msref"), "PDF merge did not create and open .msref: " + createdPath);
    const histAfterMerge = (h.view as any).currentHistoryState();
    assert(histAfterMerge?.canUndo === true, "workspace canUndo !== true after PDF merge");

    const createdFile = h.app.vault.getAbstractFileByPath(createdPath) as TFile;
    const afterMerge = {
      ws: snapWorkspace(),
      manifest: await readPageCollection(h.plugin, createdFile),
      meta: structuredClone(h.plugin.store.getDocMeta(createdPath)),
      anns: structuredClone(await h.plugin.store.loadAnnotations(createdPath)),
    };
    assert(afterMerge.manifest.pages.every((p: any) => p.annotations === "include"), "PDF merge pages missing annotations=include");
    assert(afterMerge.anns.length === 2, "PDF merge did not snapshot both dst and src non-excerpt notes");

    const docRecordBeforeUndo = h.plugin.store.documents.find((d: any) => d.path === createdPath)?.id;
    // Simulate a saved reading-return position pointing at createdPath's DocumentRecord.id (page 2)
    (h.view as any).handwritingReturn = { path: createdPath, documentId: docRecordBeforeUndo, page: 2, scrollTop: 120, scrollLeft: 0 };

    // 1st Undo
    await (h.view as any).applyHistory(false);
    assert(h.app.vault.getAbstractFileByPath(createdPath) === null, "1st undo did not trash created.msref");
    assert((await h.plugin.store.loadAnnotations(createdPath)).length === 0, "1st undo did not clear sidecar");
    assert(Object.keys(h.plugin.store.getDocMeta(createdPath)).length === 0, "1st undo did not clear DocMeta");
    assert(JSON.stringify(snapWorkspace()) === JSON.stringify(beforeMerge), "1st undo workspace diff !== 0: " + JSON.stringify(snapWorkspace()) + " vs " + JSON.stringify(beforeMerge));

    // Redo -> DocumentRecord.id MUST be reused AND returnFromHandwritingSource MUST restore page 2 (no "原阅读文档不存在")
    await (h.view as any).applyHistory(true);
    const recreatedFile = h.app.vault.getAbstractFileByPath(createdPath) as TFile;
    assert(!!recreatedFile, "redo did not recreate file at original path");
    const docRecordAfterRedo = h.plugin.store.documents.find((d: any) => d.path === createdPath)?.id;
    assert(docRecordAfterRedo === docRecordBeforeUndo, "redo rebuilt DocumentRecord.id: before=" + docRecordBeforeUndo + " after=" + docRecordAfterRedo);
    await (h.view as any).returnFromHandwritingSource();
    const returnedReader = h.view.getReader() as ReaderView;
    assert(returnedReader.getFilePath() === createdPath && returnedReader.getCurrentPage() === 2, "returnFromHandwritingSource did not restore original page 2: path=" + returnedReader.getFilePath() + " page=" + returnedReader.getCurrentPage());
    // Also verify cold reload preserves the exact DocumentRecord.id on disk
    const coldStore = new Store(h.plugin);
    await coldStore.load();
    assert(coldStore.documents.find((d: any) => d.path === createdPath)?.id === docRecordBeforeUndo, "cold reload lost preserved DocumentRecord.id");

    const afterRedo = {
      ws: snapWorkspace(),
      manifest: await readPageCollection(h.plugin, recreatedFile),
      meta: structuredClone(h.plugin.store.getDocMeta(createdPath)),
      anns: structuredClone(await h.plugin.store.loadAnnotations(createdPath)),
    };
    assert(afterRedo.manifest.id === afterMerge.manifest.id, "redo changed collection.id");
    assert(JSON.stringify(afterRedo.manifest.pages.map((p: any) => p.id)) === JSON.stringify(afterMerge.manifest.pages.map((p: any) => p.id)), "redo changed PageReference IDs");
    assert(JSON.stringify(afterRedo) === JSON.stringify(afterMerge), "redo state diff !== 0");

    // 2nd Undo
    await (h.view as any).applyHistory(false);
    assert(h.app.vault.getAbstractFileByPath(createdPath) === null, "2nd undo did not trash created.msref");
    assert(JSON.stringify(snapWorkspace()) === JSON.stringify(beforeMerge), "2nd undo workspace diff !== 0");

    // Anti-accidental-delete guard #1: user adds annotation to created.msref -> Undo MUST refuse delete
    await (h.view as any).applyHistory(true);
    const modifiedAnns = structuredClone(await h.plugin.store.loadAnnotations(createdPath));
    modifiedAnns.push({ id: "user-new-note", docPath: createdPath, docKind: "pdf", page: 1, type: "note", rects: [{ x: 40, y: 100, w: 60, h: 20 }], pdfCoordinateSpace: "pdf", text: "user added", color: "#000", createdAt: stamp });
    await h.plugin.store.saveAnnotationsNow(createdPath, modifiedAnns);
    const noticesBeforeGuard1 = notices.length;
    await (h.view as any).applyHistory(false);
    assert(h.app.vault.getAbstractFileByPath(createdPath) !== null, "guard #1 deleted user-modified .msref!");
    assert((await h.plugin.store.loadAnnotations(createdPath)).some((a: any) => a.id === "user-new-note"), "guard #1 lost user annotation!");
    assert(notices.length > noticesBeforeGuard1, "guard #1 did not emit notice");

    // Anti-accidental-delete guard #2: user reorders pages of newly created .msref -> Undo MUST refuse delete
    await h.view.openFile(h.srcPdf);
    await h.runMergeModal("page", h.dstPdf.path);
    const createdPath2 = h.view.getReader()?.getFilePath()!;
    const createdFile2 = h.app.vault.getAbstractFileByPath(createdPath2) as TFile;
    const origManifest2 = await readPageCollection(h.plugin, createdFile2);
    const revIds2 = [...origManifest2.pages.map(p => p.id)].reverse();
    await reorderPageReferences(h.plugin, createdFile2, revIds2);
    const noticesBeforeGuard2 = notices.length;
    await (h.view as any).applyHistory(false);
    assert(h.app.vault.getAbstractFileByPath(createdPath2) !== null, "guard #2 deleted reordered .msref!");
    assert((await readPageCollection(h.plugin, createdFile2)).pages.map(p => p.id).join(",") === revIds2.join(","), "guard #2 lost reordered pages!");
    assert(notices.length > noticesBeforeGuard2, "guard #2 did not emit notice");

    // Anti-accidental-delete guard #3: user adds bookmark to newly created .msref -> Undo MUST refuse delete
    await h.view.openFile(h.srcPdf);
    await h.runMergeModal("page", h.dstPdf.path);
    const createdPath3 = h.view.getReader()?.getFilePath()!;
    const reader3 = h.view.getReader() as ReaderView;
    reader3.toggleBookmark(1);
    await h.plugin.store.flush();
    const noticesBeforeGuard3 = notices.length;
    await (h.view as any).applyHistory(false);
    assert(h.app.vault.getAbstractFileByPath(createdPath3) !== null, "guard #3 deleted .msref with new bookmark!");
    assert(h.plugin.store.getDocMeta(createdPath3).bookmarks?.includes(1), "guard #3 lost new bookmark!");
    assert(notices.length > noticesBeforeGuard3, "guard #3 did not emit notice");

    // Anti-accidental-delete guard #4: new annotation written to disk sidecar while .msref view is closed -> Undo MUST refuse delete
    await h.view.openFile(h.srcPdf);
    await h.runMergeModal("page", h.dstPdf.path);
    const createdPath4 = h.view.getReader()?.getFilePath()!;
    const reader4 = h.view.getReader() as ReaderView;
    await reader4.onClose();
    const sidecar4 = h.plugin.store.sidecarPath(createdPath4);
    const diskSidecar4 = JSON.parse(await h.app.vault.adapter.read(sidecar4));
    diskSidecar4.annotations.push({
      id: "disk-after-close-note",
      docPath: createdPath4,
      docKind: "pdf",
      page: 1,
      type: "note",
      rects: [{ x: 30, y: 120, w: 70, h: 20 }],
      pdfCoordinateSpace: "pdf",
      text: "written after close",
      color: "#000",
      createdAt: stamp,
    });
    await h.app.vault.adapter.write(sidecar4, JSON.stringify(diskSidecar4));
    const noticesBeforeGuard4 = notices.length;
    await (h.view as any).applyHistory(false);
    assert(h.app.vault.getAbstractFileByPath(createdPath4) !== null, "guard #4 deleted .msref with disk annotation written after onClose!");
    const afterDisk4 = JSON.parse(await h.app.vault.adapter.read(sidecar4));
    assert(afterDisk4.annotations.some((a: any) => a.id === "disk-after-close-note"), "guard #4 lost disk annotation written after onClose!");
    assert(notices.length > noticesBeforeGuard4, "guard #4 did not emit notice");

    // TOCTOU race guard #5: write new annotation to disk DURING reader.onClose() await inside Undo -> trash MUST be 0!
    await h.view.openFile(h.srcPdf);
    await h.runMergeModal("page", h.dstPdf.path);
    const createdPath5 = h.view.getReader()?.getFilePath()!;
    const reader5 = h.view.getReader() as ReaderView;
    const sidecar5 = h.plugin.store.sidecarPath(createdPath5);
    const origOnClose5 = reader5.onClose.bind(reader5);
    reader5.onClose = async () => {
      await origOnClose5();
      const disk = JSON.parse(await h.app.vault.adapter.read(sidecar5));
      disk.annotations.push({
        id: "toctou-during-onclose-note",
        docPath: createdPath5,
        docKind: "pdf",
        page: 1,
        type: "note",
        rects: [{ x: 35, y: 140, w: 70, h: 20 }],
        pdfCoordinateSpace: "pdf",
        text: "written during onClose",
        color: "#000",
        createdAt: stamp,
      });
      await h.app.vault.adapter.write(sidecar5, JSON.stringify(disk));
    };
    let trashCount5 = 0;
    const origTrash = h.app.vault.trash.bind(h.app.vault);
    h.app.vault.trash = async (f: TFile, system?: boolean) => {
      if (f.path === createdPath5) trashCount5++;
      return origTrash(f, system);
    };
    try {
      const noticesBeforeGuard5 = notices.length;
      await (h.view as any).applyHistory(false);
      assert(trashCount5 === 0, "TOCTOU race #5 trashed file during onClose! trashCount=" + trashCount5);
      assert(h.app.vault.getAbstractFileByPath(createdPath5) !== null, "TOCTOU race #5 removed file from vault!");
      const afterDisk5 = JSON.parse(await h.app.vault.adapter.read(sidecar5));
      assert(afterDisk5.annotations.some((a: any) => a.id === "toctou-during-onclose-note"), "TOCTOU race #5 lost disk annotation written during onClose!");
      assert(notices.length > noticesBeforeGuard5, "TOCTOU race #5 did not emit notice");
    } finally {
      h.app.vault.trash = origTrash;
    }

    // Store bypass guard #6: Store cleanup path must NOT expose unguarded clearDocMeta/unregisterDocument and purgeCreatedCollection must reject disk change
    assert(typeof (h.plugin.store as any).clearDocMeta === "undefined", "unguarded Store.clearDocMeta bypass still exists!");
    assert(typeof (h.plugin.store as any).unregisterDocument === "undefined", "unguarded Store.unregisterDocument bypass still exists!");
    let bypassRejected = false;
    try {
      await (h.plugin.store as any).purgeCreatedCollection(createdPath5, {
        diskSidecar: JSON.stringify({ annotations: [] }),
        annotations: [],
        meta: {},
      });
    } catch {
      bypassRejected = true;
    }
    assert(bypassRejected, "Store.purgeCreatedCollection did not reject stale snapshot!");
    const afterBypassDisk5 = JSON.parse(await h.app.vault.adapter.read(sidecar5));
    assert(afterBypassDisk5.annotations.some((a: any) => a.id === "toctou-during-onclose-note"), "Store bypass cleared disk annotation!");

    // Store live-document bypass guard #7: calling purgeCreatedCollection on a LIVE document with matching snapshot MUST be rejected (3->3 anns, bookmark & registration preserved!)
    const liveMsref = await createPageCollection(h.plugin, {
      title: "Live Existing Doc",
      pages: [{ sourcePath: h.dstPdf.path, sourcePage: 1, origin: "toc" }],
      origin: "toc",
      studySetId: "set-1",
    });
    const liveAnns = [
      { id: "live-a1", docPath: liveMsref.path, docKind: "pdf", page: 1, type: "note", rects: [{ x: 10, y: 100, w: 60, h: 20 }], pdfCoordinateSpace: "pdf", text: "live1", color: "#000", createdAt: stamp },
      { id: "live-a2", docPath: liveMsref.path, docKind: "pdf", page: 1, type: "note", rects: [{ x: 10, y: 140, w: 60, h: 20 }], pdfCoordinateSpace: "pdf", text: "live2", color: "#000", createdAt: stamp },
      { id: "live-a3", docPath: liveMsref.path, docKind: "pdf", page: 1, type: "note", rects: [{ x: 10, y: 180, w: 60, h: 20 }], pdfCoordinateSpace: "pdf", text: "live3", color: "#000", createdAt: stamp },
    ];
    await h.plugin.store.saveAnnotationsNow(liveMsref.path, liveAnns);
    h.plugin.store.toggleBookmark(liveMsref.path, 1);
    await h.plugin.store.flush();
    const liveSidecarPath = h.plugin.store.sidecarPath(liveMsref.path);
    const liveDiskBefore = await h.app.vault.adapter.read(liveSidecarPath);
    const liveMetaBefore = structuredClone(h.plugin.store.getDocMeta(liveMsref.path));
    let liveBypassRejected = false;
    try {
      await (h.plugin.store as any).purgeCreatedCollection(liveMsref.path, {
        diskSidecar: liveDiskBefore,
        annotations: structuredClone(liveAnns),
        meta: liveMetaBefore,
        studySetId: "set-1",
      });
    } catch {
      liveBypassRejected = true;
    }
    const liveDiskAfterCount = JSON.parse(await h.app.vault.adapter.read(liveSidecarPath)).annotations.length;
    assert(liveBypassRejected, "live-document bypass #7 was NOT rejected! disk anns 3->" + liveDiskAfterCount);
    assert(liveDiskAfterCount === 3, "live-document bypass #7 wiped disk annotations: 3->" + liveDiskAfterCount);
    assert(h.plugin.store.getDocMeta(liveMsref.path).bookmarks?.includes(1), "live-document bypass #7 wiped bookmark!");
    assert(h.plugin.store.documents.some((d: any) => d.path === liveMsref.path), "live-document bypass #7 wiped documents registration!");

    // Token hardening #8a: TOC collection MUST NOT be able to mint a token (no public mint API; forged cleanup rejected)
    assert(typeof (pageCollectionApi as any).captureCreatedCollectionGuard === "undefined", "public captureCreatedCollectionGuard mint API still exposed (can mint token for TOC collection)!");
    assert(typeof (h.plugin.store as any).markCreatedCollection === "undefined", "public Store.markCreatedCollection mint API still exposed!");
    assert(!h.plugin.store.getDocMeta(liveMsref.path).createdByMergeTxId, "TOC collection unexpectedly has createdByMergeTxId");
    let tocCleanupRejected = false;
    try {
      await cleanupCreatedPageCollection(h.plugin, {
        path: liveMsref.path,
        token: "forged-token",
        mergeTxId: "forged-tx",
        sourcePath: h.srcPdf.path,
        fileDigest: "forged",
        collection: await readPageCollection(h.plugin, liveMsref),
        annotations: structuredClone(liveAnns),
        diskSidecar: liveDiskBefore,
        meta: liveMetaBefore,
      } as any);
    } catch {
      tocCleanupRejected = true;
    }
    assert(tocCleanupRejected, "forged cleanup on TOC collection was NOT rejected!");
    assert(h.app.vault.getAbstractFileByPath(liveMsref.path) !== null, "TOC collection file was deleted!");
    assert(JSON.parse(await h.app.vault.adapter.read(liveSidecarPath)).annotations.length === 3, "TOC collection annotations were lost!");
    assert(h.plugin.store.getDocMeta(liveMsref.path).bookmarks?.includes(1), "TOC collection bookmark was lost!");

    // Token hardening #8b & #8c: createMergePageCollection -> wrong collectionId rejected & single-use reuse rejected
    const mergeResultA = await (pageCollectionApi as any).createMergePageCollection(h.plugin, {
      title: "Token Test A",
      sourcePath: h.srcPdf.path,
      pages: [{ sourcePath: h.srcPdf.path, sourcePage: 1, sourceNotebookId: "nb-src", annotations: "include", origin: "document" }],
      studySetId: "set-1",
    });
    const mergeResultB = await (pageCollectionApi as any).createMergePageCollection(h.plugin, {
      title: "Token Test B",
      sourcePath: h.srcPdf.path,
      pages: [{ sourcePath: h.srcPdf.path, sourcePage: 1, sourceNotebookId: "nb-src", annotations: "include", origin: "document" }],
      studySetId: "set-1",
    });
    assert(!!h.plugin.store.getDocMeta(mergeResultA.file.path).createdByMergeTxId, "merge collection A missing createdByMergeTxId");
    // #8b: use A's token against B's collection -> MUST reject, B untouched
    let wrongCollectionRejected = false;
    try {
      await cleanupCreatedPageCollection(h.plugin, {
        ...mergeResultB.guardSnapshot,
        token: mergeResultA.guardSnapshot.token,
        mergeTxId: mergeResultA.guardSnapshot.mergeTxId,
      });
    } catch {
      wrongCollectionRejected = true;
    }
    assert(wrongCollectionRejected, "token used on wrong collection B was NOT rejected!");
    assert(h.app.vault.getAbstractFileByPath(mergeResultB.file.path) !== null, "wrong-collection token deleted B!");
    // #8d: Reference isolation — mutating returned object from verifyCreatedCollectionUnchanged MUST NOT rebind internal grant to unrelated TOC collection!
    const verifiedA: any = await verifyCreatedCollectionUnchanged(h.plugin, mergeResultA.guardSnapshot);
    const leakedObj = verifiedA.grant ?? verifiedA.snapshot;
    const liveManifest = await readPageCollection(h.plugin, liveMsref);
    let mutateThrew = false;
    try {
      leakedObj.path = liveMsref.path;
      leakedObj.collectionId = liveManifest.id;
      leakedObj.mergeTxId = "rebound-tx";
    } catch {
      mutateThrew = true;
    }
    let liveTrashCount = 0;
    const origTrashLive = h.app.vault.trash.bind(h.app.vault);
    h.app.vault.trash = async (f: TFile, system?: boolean) => {
      if (f.path === liveMsref.path) liveTrashCount++;
      return origTrashLive(f, system);
    };
    try {
      let rebindRejected = false;
      try {
        await cleanupCreatedPageCollection(h.plugin, {
          ...mergeResultA.guardSnapshot,
          path: liveMsref.path,
          collectionId: liveManifest.id,
          collection: liveManifest,
          mergeTxId: leakedObj.mergeTxId,
          annotations: structuredClone(liveAnns),
          diskSidecar: liveDiskBefore,
          meta: structuredClone(h.plugin.store.getDocMeta(liveMsref.path)),
        });
      } catch {
        rebindRejected = true;
      }
      assert(mutateThrew || leakedObj.collectionId !== liveManifest.id, "returned grant object was mutable and re-bound to live TOC collection!");
      assert(rebindRejected, "cleanup after mutating returned grant was NOT rejected!");
      assert(liveTrashCount === 0, "unrelated TOC collection was trashed! liveTrashCount=" + liveTrashCount);
      assert(h.app.vault.getAbstractFileByPath(liveMsref.path) !== null, "unrelated TOC collection file deleted!");
      assert(JSON.parse(await h.app.vault.adapter.read(liveSidecarPath)).annotations.length === 3, "unrelated TOC annotations lost!");
      assert(h.plugin.store.getDocMeta(liveMsref.path).bookmarks?.includes(1), "unrelated TOC bookmark lost!");
      assert(h.plugin.store.documents.some((d: any) => d.path === liveMsref.path), "unrelated TOC registration lost!");
    } finally {
      h.app.vault.trash = origTrashLive;
    }
    // #8e: Digest / mismatched-field submission rejected, target B zero changes
    let digestMismatchRejected = false;
    try {
      await cleanupCreatedPageCollection(h.plugin, {
        ...mergeResultB.guardSnapshot,
        collectionId: mergeResultA.guardSnapshot.collectionId,
      });
    } catch {
      digestMismatchRejected = true;
    }
    assert(digestMismatchRejected, "mismatched collectionId/digest was NOT rejected!");
    assert(h.app.vault.getAbstractFileByPath(mergeResultB.file.path) !== null, "target B was modified by mismatched digest submission!");

    // #8c: consume A's token once (succeeds), then reuse A's token a 2nd time -> MUST reject
    await cleanupCreatedPageCollection(h.plugin, mergeResultA.guardSnapshot, { studySetId: "set-1" });
    assert(h.app.vault.getAbstractFileByPath(mergeResultA.file.path) === null, "first valid use of A token did not clean A");
    let reuseRejected = false;
    try {
      await cleanupCreatedPageCollection(h.plugin, mergeResultA.guardSnapshot, { studySetId: "set-1" });
    } catch {
      reuseRejected = true;
    }
    assert(reuseRejected, "reused token was NOT rejected on 2nd call!");
    // Clean up B cleanly
    await cleanupCreatedPageCollection(h.plugin, mergeResultB.guardSnapshot, { studySetId: "set-1" });

    // Source & target original PDFs SHA-256 & annotations untouched
    assert(bytesSig(h.sources.get(h.srcPdf.path)!.binary) === srcSigBefore, "src PDF bytes changed");
    assert(bytesSig(h.sources.get(h.dstPdf.path)!.binary) === dstSigBefore, "dst PDF bytes changed");
    assert(JSON.stringify(await h.plugin.store.loadAnnotations(h.srcPdf.path)) === srcAnnsBefore, "src anns changed");
    assert(JSON.stringify(await h.plugin.store.loadAnnotations(h.dstPdf.path)) === dstAnnsBefore, "dst anns changed");

    await h.view.onClose();
    results.g6c02 = {
      passed: true,
      undoRedoUndoDiffZero: true,
      preservedCollectionAndPageIds: true,
      docRecordIdBeforeUndo: docRecordBeforeUndo,
      docRecordIdAfterRedo: docRecordAfterRedo,
      refusedDeleteAfterAnnotationEdit: true,
      refusedDeleteAfterPageReorder: true,
      refusedDeleteAfterBookmark: true,
      refusedDeleteAfterCloseDiskWrite: true,
      refusedDeleteDuringOnCloseToctouRace: true,
      storeBypassClosedAndGuarded: true,
      originalPdfsUnchanged: true,
    };
  }

  // =========================================================================
  // G6c-05 (UI): .msref source merge + undo/redo & EditedPdfDocument blank page rejection
  // =========================================================================
  {
    const h = await createHarness();
    await h.plugin.store.saveAnnotationsNow(h.srcPdf.path, [
      { id: "base-hl", docPath: h.srcPdf.path, docKind: "pdf", page: 2, type: "highlight", rects: [{ x: 30, y: 300, w: 120, h: 16 }], pdfCoordinateSpace: "pdf", text: "underlying excerpt", color: "#ffd54f", createdAt: stamp },
    ]);
    const srcMsref = await createPageCollection(h.plugin, {
      title: "Source Collection",
      pages: [{ sourcePath: h.srcPdf.path, sourcePage: 2, origin: "document" }],
      origin: "document",
      annotations: "include",
      studySetId: "set-1",
    });
    const srcMsrefManifest = await readPageCollection(h.plugin, srcMsref);
    await h.plugin.store.saveAnnotationsNow(srcMsref.path, [
      { id: "src-msref-local", docPath: srcMsref.path, docKind: "pdf", page: 1, pdfReferencePages: [{ id: srcMsrefManifest.pages[0].id, page: 1 }], type: "note", rects: [{ x: 50, y: 400, w: 90, h: 20 }], pdfCoordinateSpace: "pdf", text: "msref local note", color: "#26a69a", createdAt: stamp },
    ]);
    const dstMsref = await createPageCollection(h.plugin, {
      title: "Dest Collection",
      pages: [{ sourcePath: h.dstPdf.path, sourcePage: 1, origin: "document" }],
      origin: "document",
      annotations: "include",
      studySetId: "set-1",
    });
    const dstBefore = JSON.stringify(await readPageCollection(h.plugin, dstMsref));

    // Open srcMsref and merge into dstMsref via UI modal
    await h.view.openFile(srcMsref);
    const msrefReader = h.view.getReader() as ReaderView;
    await h.runMergeModal("document", dstMsref.path);

    const dstDoc = await openPageCollectionDocument(h.plugin, await h.app.vault.readBinary(dstMsref));
    const dstLinked = dstDoc.getLinkedAnnotations();
    const dstAnns = await h.plugin.store.loadAnnotations(dstMsref.path);
    assert(dstLinked.some((a: any) => a.text === "underlying excerpt"), "msref source merge lost live underlying excerpt");
    assert(dstAnns.some((a: any) => a.text === "msref local note"), "msref source merge lost local non-excerpt note");
    await dstDoc.destroy();

    // Undo & Redo from msref source reader
    await msrefReader.undoLastEdit();
    assert(JSON.stringify(await readPageCollection(h.plugin, dstMsref)) === dstBefore, "msref source undo did not restore dstMsref");
    await msrefReader.redoLastEdit();
    assert((await readPageCollection(h.plugin, dstMsref)).pages.length === 2, "msref source redo did not restore merged page");

    // EditedPdfDocument blank inserted page rejected in UI with zero dirty writes
    await h.view.openFile(h.srcPdf);
    const pdfReader = h.view.getReader() as ReaderView;
    await pdfReader.insertBlankPage(1);
    const dstBeforeBlank = JSON.stringify(await readPageCollection(h.plugin, dstMsref));
    const menu = h.openMoreMenu();
    button(menu, "合并到另一份文档…").click();
    await until(() => document.querySelector('.ms-modal [aria-label="合并范围"]'), "merge dialog missing for blank test");
    const modal = document.querySelector<HTMLElement>(".ms-modal")!;
    const select = modal.querySelector<HTMLSelectElement>('[aria-label="合并范围"]')!;
    select.value = "document";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const target = modal.querySelector<HTMLSelectElement>('[aria-label="合并目标文档"]')!;
    target.value = dstMsref.path;
    button(modal, "合并").click();
    await until(() => modal.querySelector('[role="status"]')?.textContent?.includes("空白插页"), "blank page error not shown in modal");
    assert(JSON.stringify(await readPageCollection(h.plugin, dstMsref)) === dstBeforeBlank, "blank page rejection left dirty write");
    button(modal, "取消").click();

    await h.view.onClose();
    results.g6c05Ui = {
      passed: true,
      msrefSourceMenuEnabled: true,
      msrefSourceLiveExcerptAndLocalNote: true,
      msrefSourceUndoRedo: true,
      editedBlankPageRejectedZeroDirtyWrite: true,
    };
  }

  assert(errors.length === 0, "Uncaught browser errors: " + errors.join(" | "));
  (window as any).__results = results;
  (window as any).__done = true;
}

runAll().catch(err => {
  (window as any).__fatal = String(err?.stack ?? err);
  (window as any).__done = true;
});
`;

await writeFile(join(temporary, "fixture.ts"), fixtureSource);
const obsidianFixture = (await readFile(join(workspaceDir, "obsidian-fixture.txt"), "utf8"))
  .replaceAll("__PROJECT__", project);
await writeFile(join(temporary, "obsidian-fixture.ts"), obsidianFixture);
for (const name of ["fakePdf", "fakeMammoth"]) {
  await writeFile(join(temporary, name + ".ts"), await readFile(join(project, "src/documents/acceptance-fixtures", name + ".txt"), "utf8"));
}
await writeFile(join(temporary, "fakePdf.ts"), (await readFile(join(temporary, "fakePdf.ts"), "utf8")) + "\nexport async function initPdfWorker() {}\n");
await writeFile(join(temporary, "crypto.ts"), `
  function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, "0").repeat(8); }
  export function createHash() { let buf = ""; return { update(v) { buf += typeof v === "string" ? v : String(v.length); return this; }, digest() { return fnv(buf); } }; }
`);
await writeFile(join(temporary, "unused-network.ts"), "export function request(){throw new Error('AI network outside fixture');}");

const styles = await Promise.all(["styles.css", "src/styles/styles-reader.css", "src/styles/styles-mindmap.css", "src/styles/styles-organize.css", "src/styles/styles-workspace.css"].map(name => readFile(join(project, name), "utf8")));
await writeFile(join(temporary, "styles.css"), styles.join("\n"));
await writeFile(join(temporary, "index.html"), '<!doctype html><meta charset="utf-8"><title>GAP-06c merge undo acceptance</title><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0;height:100%}#fixtures{height:100vh;width:100vw}.test-item-view{height:100%;width:100%;display:flex;flex-direction:column}.test-item-view>.view-content{height:100%;width:100%;overflow:hidden}</style><main id="fixtures"></main><script type="module" src="/fixture.js"></script>');

await build({
  entryPoints: [join(temporary, "fixture.ts")],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome120",
  outfile: join(temporary, "fixture.js"),
  plugins: [{
    name: "gap06c-browser-stubs",
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
const session = `marginstudy-merge-undo-${process.pid}`;
const browser = (...args) => runBrowser(session, ...args);

try {
  await browser("open", "about:blank");
  await browser("set", "viewport", "1440", "900");
  await browser("open", `http://127.0.0.1:${server.address().port}`);
  const deadline = Date.now() + 90_000;
  let state = { done: false, fatal: null, results: null };
  for (;;) {
    state = JSON.parse((await browser("eval", "({done:!!window.__done,fatal:window.__fatal||null,results:window.__results||null})")).stdout);
    if (state.done || state.fatal || Date.now() > deadline) break;
    await new Promise(r => setTimeout(r, 250));
  }
  if (!state.done) throw new Error("merge-document-undo timed out");
  if (state.fatal) throw new Error("merge-document-undo FAILED:\n" + state.fatal);

  const evidenceDir = process.env.MARGINSTUDY_EVIDENCE_DIR ? resolve(process.env.MARGINSTUDY_EVIDENCE_DIR, "gap-06c") : null;
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(join(evidenceDir, "g6c-01-merge-msref-undo.json"), JSON.stringify(state.results.g6c01, null, 2) + "\n");
    await writeFile(join(evidenceDir, "g6c-02-merge-pdf-create-undo.json"), JSON.stringify(state.results.g6c02, null, 2) + "\n");
    const g5Path = join(evidenceDir, "g6c-05-edited-and-msref-source.json");
    let g5 = {};
    try { g5 = JSON.parse(await readFile(g5Path, "utf8")); } catch { /* new */ }
    g5.ui = state.results.g6c05Ui;
    await writeFile(g5Path, JSON.stringify(g5, null, 2) + "\n");
  }
  console.log("GAP-06c merge-document-undo PASS (G6c-01, G6c-02, G6c-05-ui)");
} finally {
  try { await browser("close"); } catch { /* noop */ }
  server.close();
  await rm(temporary, { recursive: true, force: true });
}
