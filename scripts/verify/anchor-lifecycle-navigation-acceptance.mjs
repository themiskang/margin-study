/**
 * [INPUT]: 依赖 StudyWorkspaceView、Store、ReaderView（真实 PDF.js Worker）、DocumentReaderView、jumpToCardSource、样式表与默认 agent-browser 后端，零私有夹具依赖。
 * [OUTPUT]: 执行 GAP-10b G10b-01~G10b-04 文档阅读锚点生命周期闭环验收（跨页/改名移目录/工作区冷重开/缺源离线与双路恢复）；若设置 MARGINSTUDY_EVIDENCE_DIR 则落盘带 head/generatedAt 的证据 JSON 至 $MARGINSTUDY_EVIDENCE_DIR/gap-10b/。
 * [POS]: 公开浏览器验收套件 anchor-lifecycle-navigation，在 1200×800 视口与真实 PDF.js Worker 下验证阅读器回源定位、折叠展开、前进后退、改名迁移、冷启动恢复与缺源保护。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { readFile, writeFile, copyFile, mkdtemp, realpath, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { runBrowser } from "./ego-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const project = await realpath(resolve(here, "../.."));
const workspaceDir = join(project, "src/workspace");
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-anchor-lifecycle-")));

const fixtureSource = `
import { TFile, notices } from "obsidian";
import { zipSync, strToU8 } from "${project}/node_modules/fflate/esm/browser.js";
import { Store } from "${project}/src/model/store";
import { StudyWorkspaceView } from "${project}/src/workspace/studyWorkspace";
import { jumpToCardSource } from "${project}/src/cards/cardView";
import { initPdfWorker } from "${project}/src/pdf/pdfjs";
import { sha256Hex } from "${project}/src/utils/sha256";
import type { Card, ExcerptBlock } from "${project}/src/types";

(HTMLElement.prototype as any).empty = function () { this.replaceChildren(); };
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};

const fixturesHost = document.getElementById("fixtures")!;
const stamp = "2026-11-25T00:00:00Z";
const runtimeErrors: string[] = [];
window.addEventListener("error", (e) => runtimeErrors.push(String(e.error ?? e.message)));
window.addEventListener("unhandledrejection", (e) => runtimeErrors.push(String(e.reason)));

const wait = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

async function waitFor(condition: () => boolean, label: string, timeoutMs = 10000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!condition() && Date.now() < end) await wait(20);
  if (!condition()) throw new Error("Timed out waiting for: " + label);
}

async function settled(scroll: HTMLElement): Promise<void> {
  let previous = NaN;
  let stable = 0;
  for (let i = 0; i < 160 && stable < 5; i++) {
    await wait(20);
    const top = scroll.scrollTop;
    stable = Math.abs(top - previous) < 0.25 ? stable + 1 : 0;
    previous = top;
  }
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function croppedMultiPagePdf(rotations: number[], labels: string[]): ArrayBuffer {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    \`<< /Type /Pages /Kids [\${rotations.map((_, idx) => \`\${4 + idx * 2} 0 R\`).join(" ")}] /Count \${rotations.length} >>\`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let i = 0; i < rotations.length; i++) {
    const pageObjId = 4 + i * 2;
    const contentObjId = pageObjId + 1;
    const text = labels[i] ?? \`Page \${i + 1} anchor target\`;
    const stream = \`BT /F1 14 Tf 140 420 Td (\${text}) Tj ET\\n\`;
    objects.push(\`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /CropBox [50 70 550 770] /Rotate \${rotations[i]} /Resources << /Font << /F1 3 0 R >> >> /Contents \${contentObjId} 0 R >>\`);
    objects.push(\`<< /Length \${stream.length} >>\\nstream\\n\${stream}endstream\`);
  }
  let source = "%PDF-1.4\\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(source.length);
    source += \`\${index + 1} 0 obj\\n\${object}\\nendobj\\n\`;
  });
  const xref = source.length;
  source += \`xref\\n0 \${objects.length + 1}\\n0000000000 65535 f \\n\`;
  source += offsets.slice(1).map((offset) => \`\${String(offset).padStart(10, "0")} 00000 n \\n\`).join("");
  source += \`trailer\\n<< /Size \${objects.length + 1} /Root 1 0 R >>\\nstartxref\\n\${xref}\\n%%EOF\\n\`;
  return new TextEncoder().encode(source).buffer as ArrayBuffer;
}

function buildEpub(chapterTwoBody: string): ArrayBuffer {
  const paras = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => \`<p>\${prefix} filler paragraph \${i} with sufficient length to ensure scrolling and vertical centering inside the viewport.</p>\`).join("");
  return bufferOf(zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'),
    "OPS/book.opf": strToU8('<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Anchor Lifecycle Book</dc:title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>'),
    "OPS/one.xhtml": strToU8(\`<html><head><title>Chapter One</title></head><body><h1 id="c1">Chapter One</h1>\${paras(28, "Intro")}</body></html>\`),
    "OPS/two.xhtml": strToU8(\`<html><head><title>Chapter Two</title></head><body><h1 id="c2">Chapter Two</h1>\${chapterTwoBody}</body></html>\`),
    "OPS/nav.xhtml": strToU8('<nav epub:type="toc"><ol><li><a href="one.xhtml#c1">Chapter One</a></li><li><a href="two.xhtml#c2">Chapter Two</a></li></ol></nav>'),
  }));
}

function selectTextIn(container: HTMLElement, needle: string): Range {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    const idx = text.data.indexOf(needle);
    if (idx >= 0) {
      const range = document.createRange();
      range.setStart(text, idx);
      range.setEnd(text, idx + needle.length);
      return range;
    }
  }
  throw new Error("Text not found in container: " + needle + " | actual=" + JSON.stringify(container.textContent));
}

function measureRectInScroll(targetEl: Element | null, scrollEl: HTMLElement) {
  if (!targetEl) return { found: false, inVisible: false, centerDelta: Infinity, target: null, scroll: null };
  const t = targetEl.getBoundingClientRect();
  const s = scrollEl.getBoundingClientRect();
  const inVisible = t.width > 0 && t.height > 0 &&
    t.left >= s.left - 1 && t.right <= s.right + 1 &&
    t.top >= s.top - 1 && t.bottom <= s.bottom + 1;
  const centerDelta = Math.round(Math.abs((t.top + t.height / 2) - (s.top + scrollEl.clientHeight / 2)) * 100) / 100;
  return {
    found: true,
    inVisible,
    centerDelta,
    target: { left: t.left, top: t.top, right: t.right, bottom: t.bottom, width: t.width, height: t.height },
    scroll: { left: s.left, top: s.top, right: s.right, bottom: s.bottom, clientHeight: scrollEl.clientHeight, scrollTop: scrollEl.scrollTop },
  };
}

class SyntheticVault {
  files = new Map<string, { file: TFile; bytes?: ArrayBuffer; text?: string }>();
  adapterFiles = new Map<string, string>();
  folders = new Set<string>();
  vaultEvents = new Map<string, Set<(...args: any[]) => void>>();
  wsEvents = new Map<string, Set<(...args: any[]) => void>>();
  disk: any = null;
  writeLog: string[] = [];

  addBinary(path: string, bytes: ArrayBuffer): TFile {
    const copy = bytes.slice(0);
    const file = new TFile(path, copy.byteLength);
    this.files.set(path, { file, bytes: copy });
    return file;
  }

  addText(path: string, text: string): TFile {
    const file = new TFile(path, text.length);
    this.files.set(path, { file, text });
    return file;
  }

  removeFile(path: string): void {
    this.files.delete(path);
  }

  sha256(path: string): string {
    const entry = this.files.get(path);
    if (!entry) throw new Error("Missing file for sha256: " + path);
    if (entry.bytes) return sha256Hex(new Uint8Array(entry.bytes));
    return sha256Hex(new TextEncoder().encode(entry.text ?? ""));
  }

  makeApp(): any {
    const self = this;
    const dock = () => ({ collapsed: false, collapse() { this.collapsed = true; }, expand() { this.collapsed = false; } });
    return {
      vault: {
        configDir: ".obsidian",
        getFiles: () => [...self.files.values()].map((v) => v.file),
        getAbstractFileByPath: (p: string) => self.files.get(p)?.file ?? null,
        async read(file: TFile) {
          const entry = self.files.get(file.path);
          if (!entry) throw new Error("Missing file: " + file.path);
          return entry.text ?? new TextDecoder().decode(entry.bytes!);
        },
        async readBinary(file: TFile) {
          const entry = self.files.get(file.path);
          if (!entry) throw new Error("Missing binary file: " + file.path);
          if (entry.bytes) return entry.bytes.slice(0);
          return new TextEncoder().encode(entry.text ?? "").buffer;
        },
        async rename(file: TFile, newPath: string) {
          const oldPath = file.path;
          const entry = self.files.get(oldPath);
          if (!entry) throw new Error("Cannot rename missing file: " + oldPath);
          self.files.delete(oldPath);
          Object.assign(file, new TFile(newPath, file.stat?.size ?? 10));
          self.files.set(newPath, entry);
        },
        getResourcePath: (file: TFile) => "/synthetic-resource/" + encodeURIComponent(file.path),
        on(name: string, cb: any) {
          const s = self.vaultEvents.get(name) ?? new Set();
          s.add(cb);
          self.vaultEvents.set(name, s);
          return { off: () => s.delete(cb) };
        },
        offref(ref: any) { ref?.off?.(); },
        adapter: {
          async exists(p: string) {
            return self.adapterFiles.has(p) || self.files.has(p) || self.folders.has(p);
          },
          async read(p: string) {
            if (p.endsWith("/pdf.worker.js")) return await (await fetch("/pdf.worker.js")).text();
            if (self.adapterFiles.has(p)) return self.adapterFiles.get(p)!;
            const entry = self.files.get(p);
            if (entry) return entry.text ?? new TextDecoder().decode(entry.bytes!);
            throw new Error("Missing adapter file: " + p);
          },
          async readBinary(p: string) {
            const entry = self.files.get(p);
            if (entry?.bytes) return entry.bytes.slice(0);
            if (entry?.text !== undefined) return new TextEncoder().encode(entry.text).buffer;
            if (self.adapterFiles.has(p)) return new TextEncoder().encode(self.adapterFiles.get(p)!).buffer;
            throw new Error("Missing adapter binary: " + p);
          },
          async write(p: string, v: string) {
            self.writeLog.push("adapter.write:" + p);
            self.adapterFiles.set(p, v);
          },
          async mkdir(p: string) { self.folders.add(p); },
          async remove(p: string) {
            self.writeLog.push("adapter.remove:" + p);
            self.adapterFiles.delete(p);
          },
          async rename(from: string, to: string) {
            self.writeLog.push("adapter.rename:" + from + "->" + to);
            if (!self.adapterFiles.has(from)) throw new Error("Missing adapter rename source: " + from);
            self.adapterFiles.set(to, self.adapterFiles.get(from)!);
            self.adapterFiles.delete(from);
          },
        },
      },
      metadataCache: { getFirstLinkpathDest: () => null },
      commands: { commands: {}, executeCommandById: () => false },
      workspace: {
        leftSplit: dock(), rightSplit: dock(), rootSplit: {}, activeLeaf: null as any, centerLeaf: null as any,
        on(name: string, cb: any) {
          const s = self.wsEvents.get(name) ?? new Set();
          s.add(cb);
          self.wsEvents.set(name, s);
          return { off: () => s.delete(cb) };
        },
        offref(ref: any) { ref?.off?.(); },
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
  }

  async bootWorkspace(initialDisk?: any, openDocPath?: string) {
    fixturesHost.replaceChildren();
    if (initialDisk !== undefined) this.disk = JSON.parse(JSON.stringify(initialDisk));
    const app = this.makeApp();
    await initPdfWorker(app);
    const self = this;
    const host: any = {
      app,
      loadData: async () => JSON.parse(JSON.stringify(self.disk)),
      saveData: async (value: any) => {
        self.writeLog.push("saveData");
        self.disk = JSON.parse(JSON.stringify(value));
      },
    };
    const store = new Store(host);
    await store.load();
    const leaf: any = { app, setViewState: async () => {}, updateHeader() {}, getRoot: () => app.workspace.rootSplit };
    app.workspace.activeLeaf = leaf;
    app.workspace.centerLeaf = leaf;
    let view!: StudyWorkspaceView;
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
    view = new StudyWorkspaceView(leaf, plugin);
    view.containerEl.firstElementChild!.classList.add("view-header-title");
    leaf.view = view;
    plugin.studyWorkspace = view;
    view.load();
    await view.onOpen();
    if (openDocPath) {
      const f = app.vault.getAbstractFileByPath(openDocPath);
      if (f instanceof TFile) await view.openFile(f);
    }
    await frame();
    return {
      app,
      store,
      plugin,
      view,
      dispose: async () => {
        await view.onClose();
        view.unload();
        view.containerEl.remove();
      },
    };
  }
}

async function runG10b01() {
  const errorsBefore = runtimeErrors.length;
  const vault = new SyntheticVault();
  const pdfBytes = croppedMultiPagePdf([0, 90, 180, 270], [
    "Page 1 intro anchor",
    "Page 2 cross-page start target",
    "Page 3 cross-page middle target",
    "Page 4 cross-page end target",
  ]);
  const pdfPath = "cross-page-rotated.pdf";
  vault.addBinary(pdfPath, pdfBytes);
  const shaBefore = vault.sha256(pdfPath);

  const session = await vault.bootWorkspace({
    settings: { autoCardOnHighlight: true, autoNodeOnCard: true, backupEnabled: false },
    studySets: [{ id: "set-1", name: "G10b-01", docPaths: [pdfPath], createdAt: stamp }],
    canvases: [{ id: "canvas-1", studySetId: "set-1", name: "Main", createdAt: stamp }],
    activeStudySetId: "set-1",
    activeCanvasId: "canvas-1",
    cards: [], nodes: [], edges: [], srs: {},
  }, pdfPath);

  try {
    const reader: any = session.view.getReader();
    await waitFor(() => !!reader?.getPageRecord?.(4), "4 pages created");
    for (const p of [1, 2, 3, 4]) {
      reader.visiblePages.add(p);
      await reader.renderPage(p);
    }
    await frame();

    const span2 = [...reader.getPageRecord(2).textLayer.querySelectorAll("span")].find((s: HTMLElement) => s.textContent?.includes("Page 2"))!;
    const span4 = [...reader.getPageRecord(4).textLayer.querySelectorAll("span")].find((s: HTMLElement) => s.textContent?.includes("Page 4"))!;
    const range = document.createRange();
    range.setStart(span2.firstChild!, 0);
    range.setEnd(span4.firstChild!, (span4.firstChild as Text).data.length);
    const target = reader.annController.resolveSelection(range);
    if (!target || target.pdfGeometry?.length !== 3) {
      throw new Error("Cross-page selection did not produce 3 page geometries: " + JSON.stringify(target?.pdfGeometry));
    }
    reader.annController.commitAnnotation(target, "highlight", "#ff0", "Cross-page 2-4 excerpt");
    await session.store.flush();
    const card = session.store.cards[0];
    if (!card?.anchorAnnId) throw new Error("Cross-page card not created");

    // Fold page 2 and scroll to page 1 top
    reader.toggleFold(2);
    const foldedBefore = reader.folded.has(2);
    reader.scrollEl.scrollTo({ top: 0, behavior: "instant" });
    await settled(reader.scrollEl);
    const beforeScrollTop = reader.scrollEl.scrollTop;

    // Trigger jumpToCardSource
    jumpToCardSource(session.plugin, card);
    await waitFor(() => !reader.folded.has(2) && !!reader.getPageRecord(2).annLayer.querySelector(".ms-ann-flash"), "page 2 unfolded & flashed");
    await settled(reader.scrollEl);

    const unfoldedAfter = !reader.folded.has(2);
    const currentPage = reader.currentPage;
    const p2Highlight = reader.getPageRecord(2).annLayer.querySelector(\`[data-ann-id="\${card.anchorAnnId}"]\`);
    const p2Geom = measureRectInScroll(p2Highlight, reader.scrollEl);

    // Check pages 2, 3, 4 highlights rendered & flashed
    const pageSegments = [2, 3, 4].map((p) => {
      const layer = reader.getPageRecord(p).annLayer as HTMLElement;
      const els = [...layer.querySelectorAll(\`[data-ann-id="\${card.anchorAnnId}"]\`)];
      return {
        page: p,
        renderedCount: els.length,
        flashedCount: els.filter((el) => el.classList.contains("ms-ann-flash")).length,
      };
    });

    const atSourceScrollTop = reader.scrollEl.scrollTop;
    await reader.goBack();
    await settled(reader.scrollEl);
    const afterBackScrollTop = reader.scrollEl.scrollTop;
    const backDelta = Math.round(Math.abs(afterBackScrollTop - beforeScrollTop) * 100) / 100;

    await reader.goForward();
    await settled(reader.scrollEl);
    const afterForwardScrollTop = reader.scrollEl.scrollTop;
    const forwardDelta = Math.round(Math.abs(afterForwardScrollTop - atSourceScrollTop) * 100) / 100;

    // Zoom to 200%, scroll to page 1 top, re-jump
    reader.setScale(2);
    for (const p of [1, 2, 3, 4]) {
      reader.visiblePages.add(p);
      await reader.renderPage(p);
    }
    await settled(reader.scrollEl);
    reader.scrollEl.scrollTo({ top: 0, behavior: "instant" });
    await settled(reader.scrollEl);
    // Wait for prior flash class to clear if needed
    await wait(50);
    jumpToCardSource(session.plugin, card);
    await waitFor(() => reader.currentPage === 2 && reader.scrollEl.scrollTop > 100, "zoomed jump to page 2");
    await settled(reader.scrollEl);
    const p2HighlightZoom = reader.getPageRecord(2).annLayer.querySelector(\`[data-ann-id="\${card.anchorAnnId}"]\`);
    const p2ZoomGeom = measureRectInScroll(p2HighlightZoom, reader.scrollEl);

    const shaAfter = vault.sha256(pdfPath);
    const errorsDelta = runtimeErrors.slice(errorsBefore);

    const passed =
      foldedBefore &&
      unfoldedAfter &&
      currentPage === 2 &&
      p2Geom.inVisible &&
      p2Geom.centerDelta <= 3.0 &&
      pageSegments.every((s) => s.renderedCount > 0 && s.flashedCount > 0) &&
      backDelta <= 2.0 &&
      forwardDelta <= 2.0 &&
      p2ZoomGeom.inVisible &&
      p2ZoomGeom.centerDelta <= 3.0 &&
      shaBefore === shaAfter &&
      errorsDelta.length === 0;

    return {
      id: "G10b-01",
      passed,
      foldedBefore,
      unfoldedAfter,
      currentPage,
      p2Geom,
      pageSegments,
      history: { beforeScrollTop, atSourceScrollTop, afterBackScrollTop, backDelta, afterForwardScrollTop, forwardDelta },
      zoom200: p2ZoomGeom,
      shaUnchanged: shaBefore === shaAfter,
      runtimeErrors: errorsDelta,
    };
  } finally {
    await session.dispose();
  }
}

async function runG10b02() {
  const errorsBefore = runtimeErrors.length;
  const vault = new SyntheticVault();
  const oldPdf = "docs/source.pdf";
  const newPdf = "archive/renamed-source.pdf";
  const oldEpub = "docs/book.epub";
  const newEpub = "archive/renamed-book.epub";

  const pdfBytes = croppedMultiPagePdf([0, 0, 90, 0], [
    "Page 1 intro",
    "Page 2 overview",
    "Page 3 non-default notebook excerpt target",
    "Page 4 conclusion",
  ]);
  const paras = (n: number, p: string) =>
    Array.from({ length: n }, (_, i) => \`<p>\${p} paragraph \${i} with extra words for scrolling height.</p>\`).join("");
  const epubBytes = buildEpub(\`\${paras(22, "Before")}<p>EPUB unique rename target sentence.</p>\${paras(24, "After")}\`);

  vault.addBinary(oldPdf, pdfBytes);
  vault.addBinary(oldEpub, epubBytes);
  const pdfShaBefore = vault.sha256(oldPdf);
  const epubShaBefore = vault.sha256(oldEpub);

  const session = await vault.bootWorkspace({
    settings: { autoCardOnHighlight: true, autoNodeOnCard: true, backupEnabled: false },
    studySets: [{ id: "set-1", name: "G10b-02", docPaths: [oldPdf, oldEpub], createdAt: stamp }],
    canvases: [{ id: "canvas-1", studySetId: "set-1", name: "Main", createdAt: stamp }],
    activeStudySetId: "set-1",
    activeCanvasId: "canvas-1",
    cards: [], nodes: [], edges: [], srs: {},
  }, oldPdf);

  try {
    // 1) PDF in non-default notebook nb-2 on page 3 (seed one default note first so createDocumentNotebook succeeds)
    const pdfReader: any = session.view.getReader();
    await waitFor(() => !!pdfReader?.getPageRecord?.(3), "pdf pages ready");
    pdfReader.visiblePages.add(1);
    await pdfReader.renderPage(1);
    await frame();
    const pdfSeed = pdfReader.annController.resolveSelection(selectTextIn(pdfReader.getPageRecord(1).textLayer, "Page 1 intro"));
    if (!pdfSeed) throw new Error("Failed to resolve seed selection on PDF page 1");
    pdfReader.annController.commitAnnotation(pdfSeed, "highlight", "#ff0", "Page 1 intro");
    const createdPdfNb = pdfReader.createDocumentNotebook("nb-2");
    const pdfNb2 = pdfReader.getDocumentNotebookId();
    if (!createdPdfNb || pdfNb2 === "default") throw new Error("Failed to create non-default PDF notebook: cache=" + (await session.store.loadAnnotations(oldPdf)).length);
    await frame();
    await pdfReader.navigateToReference(3, [], undefined, false);
    await waitFor(() => !!pdfReader.getPageRecord(3)?.textLayer?.textContent?.includes("Page 3 non-default"), "pdf page 3 textLayer rendered");
    await frame();
    const pdfRange = selectTextIn(pdfReader.getPageRecord(3).textLayer, "Page 3 non-default");
    const pdfTarget = pdfReader.annController.resolveSelection(pdfRange);
    pdfReader.annController.commitAnnotation(pdfTarget, "highlight", "#ff0", "Page 3 non-default");
    await session.store.flush();
    const pdfCard = session.store.cards.find((c: Card) => c.docPath === oldPdf && c.front.includes("Page 3 non-default"))!;
    const pdfBlock: ExcerptBlock = {
      id: "blk-pdf-1",
      text: "Page 3 non-default",
      sourceText: "Page 3 non-default",
      source: { docPath: oldPdf, page: 3, anchorAnnId: pdfCard.anchorAnnId, documentNotebookId: pdfNb2 },
      target: pdfTarget,
    };
    session.store.updateCard(pdfCard.id, {
      sources: [{ docPath: oldPdf, page: 3, anchorAnnId: pdfCard.anchorAnnId, documentNotebookId: pdfNb2 }],
      excerptBlocks: [pdfBlock],
    });
    await pdfReader.selectDocumentNotebook("default");

    // 2) EPUB in non-default notebook nb-2 (seed one default note first)
    await session.view.openFile(session.app.vault.getAbstractFileByPath(oldEpub));
    const epubReader: any = session.view.getReader();
    await waitFor(() => epubReader?.getFilePath?.() === oldEpub && epubReader.getBodyEl().textContent.includes("EPUB unique rename target"), "epub loaded");
    const epubSeed = epubReader.ann.resolveSelection(selectTextIn(epubReader.getBodyEl(), "Chapter One"));
    epubReader.ann.commitAnnotation(epubSeed, "highlight", "#ff0", "Chapter One");
    const createdEpubNb = epubReader.createDocumentNotebook("nb-2");
    const epubNb2 = epubReader.getDocumentNotebookId();
    if (!createdEpubNb || epubNb2 === "default") throw new Error("Failed to create non-default EPUB notebook");
    const epubRange = selectTextIn(epubReader.getBodyEl(), "EPUB unique rename target sentence.");
    const epubTarget = epubReader.ann.resolveSelection(epubRange);
    epubReader.ann.commitAnnotation(epubTarget, "highlight", "#ff0", "EPUB unique rename target sentence.");
    await session.store.flush();
    const epubCard = session.store.cards.find((c: Card) => c.docPath === oldEpub && c.front.includes("EPUB unique rename target"))!;
    const epubBlock: ExcerptBlock = {
      id: "blk-epub-1",
      text: "EPUB unique rename target sentence.",
      sourceText: "EPUB unique rename target sentence.",
      source: { docPath: oldEpub, anchorAnnId: epubCard.anchorAnnId, documentNotebookId: epubNb2 },
      target: epubTarget,
    };
    session.store.updateCard(epubCard.id, {
      sources: [{ docPath: oldEpub, anchorAnnId: epubCard.anchorAnnId, documentNotebookId: epubNb2 }],
      excerptBlocks: [epubBlock],
    });
    epubReader.selectDocumentNotebook("default");
    await session.store.flush();

    // 3) Rename + move both files (vault rename + store.renameDocument + workspace remapDocuments)
    await session.app.vault.rename(session.app.vault.getAbstractFileByPath(oldPdf), newPdf);
    await session.store.renameDocument(oldPdf, newPdf);
    await session.view.remapDocuments([{ oldPath: oldPdf, newPath: newPdf }], new Set());

    await session.app.vault.rename(session.app.vault.getAbstractFileByPath(oldEpub), newEpub);
    await session.store.renameDocument(oldEpub, newEpub);
    await session.view.remapDocuments([{ oldPath: oldEpub, newPath: newEpub }], new Set());
    await session.store.flush();

    // 4) Strict check: zero residual oldPath anywhere
    const updatedPdfCard = session.store.getCard(pdfCard.id)!;
    const updatedEpubCard = session.store.getCard(epubCard.id)!;
    const storeSerialized = JSON.stringify({
      cards: session.store.cards,
      nodes: session.store.nodes,
      studySets: session.store.studySets,
      documents: session.store.documents,
      docMeta: session.store.docMeta,
      workspaceState: session.store.getWorkspaceState(),
    });
    const oldPdfResidualInStore = storeSerialized.includes(oldPdf);
    const oldEpubResidualInStore = storeSerialized.includes(oldEpub);
    const oldPdfSidecarExists = await session.app.vault.adapter.exists(session.store.sidecarPath(oldPdf));
    const oldEpubSidecarExists = await session.app.vault.adapter.exists(session.store.sidecarPath(oldEpub));
    const pdfCardPathsOk =
      updatedPdfCard.docPath === newPdf &&
      updatedPdfCard.sources?.every((s) => s.docPath === newPdf) &&
      updatedPdfCard.excerptBlocks?.every((b) => b.source?.docPath === newPdf);
    const epubCardPathsOk =
      updatedEpubCard.docPath === newEpub &&
      updatedEpubCard.sources?.every((s) => s.docPath === newEpub) &&
      updatedEpubCard.excerptBlocks?.every((b) => b.source?.docPath === newEpub);

    // 5) Jump to PDF card (and block)
    jumpToCardSource(session.plugin, updatedPdfCard, updatedPdfCard.excerptBlocks![0]);
    await waitFor(() => {
      const r: any = session.view.getReader();
      return r?.getFilePath?.() === newPdf && r.currentPage === 3 && !!r.getPageRecord?.(3)?.annLayer?.querySelector(\`[data-ann-id="\${updatedPdfCard.anchorAnnId}"]\`);
    }, "pdf jump after rename");
    const activePdfReader: any = session.view.getReader();
    await settled(activePdfReader.scrollEl);
    const pdfJumpNb = activePdfReader.getDocumentNotebookId();
    const pdfJumpPage = activePdfReader.currentPage;
    const pdfJumpGeom = measureRectInScroll(
      activePdfReader.getPageRecord(3).annLayer.querySelector(\`[data-ann-id="\${updatedPdfCard.anchorAnnId}"]\`),
      activePdfReader.scrollEl,
    );

    // 6) Jump to EPUB card (and block)
    jumpToCardSource(session.plugin, updatedEpubCard, updatedEpubCard.excerptBlocks![0]);
    await waitFor(() => {
      const r: any = session.view.getReader();
      return r?.getFilePath?.() === newEpub && r.getBodyEl?.()?.dataset?.msAnchorNavigation === "exact";
    }, "epub jump after rename");
    const activeEpubReader: any = session.view.getReader();
    await settled(activeEpubReader.getScrollContainer());
    const epubJumpNb = activeEpubReader.getDocumentNotebookId();
    const epubNavState = activeEpubReader.getBodyEl().dataset.msAnchorNavigation;
    const epubJumpGeom = measureRectInScroll(
      activeEpubReader.getBodyEl().querySelector(\`[data-ann-id="\${updatedEpubCard.anchorAnnId}"]\`),
      activeEpubReader.getScrollContainer(),
    );

    const pdfShaAfter = vault.sha256(newPdf);
    const epubShaAfter = vault.sha256(newEpub);
    const errorsDelta = runtimeErrors.slice(errorsBefore);

    const passed =
      !oldPdfResidualInStore &&
      !oldEpubResidualInStore &&
      !oldPdfSidecarExists &&
      !oldEpubSidecarExists &&
      !!pdfCardPathsOk &&
      !!epubCardPathsOk &&
      pdfJumpNb === pdfNb2 &&
      pdfJumpPage === 3 &&
      pdfJumpGeom.inVisible &&
      pdfJumpGeom.centerDelta <= 3.0 &&
      epubJumpNb === epubNb2 &&
      epubNavState === "exact" &&
      epubJumpGeom.inVisible &&
      epubJumpGeom.centerDelta <= 3.0 &&
      pdfShaBefore === pdfShaAfter &&
      epubShaBefore === epubShaAfter &&
      errorsDelta.length === 0;

    return {
      id: "G10b-02",
      passed,
      residuals: { oldPdfResidualInStore, oldEpubResidualInStore, oldPdfSidecarExists, oldEpubSidecarExists },
      cardPaths: {
        pdfCardPathsOk,
        epubCardPathsOk,
        pdfBlockSourcePath: updatedPdfCard.excerptBlocks?.[0]?.source?.docPath ?? null,
        epubBlockSourcePath: updatedEpubCard.excerptBlocks?.[0]?.source?.docPath ?? null,
      },
      pdfJump: { path: activePdfReader.getFilePath(), nb: pdfJumpNb, expectedNb: pdfNb2, page: pdfJumpPage, geom: pdfJumpGeom },
      epubJump: { path: activeEpubReader.getFilePath(), nb: epubJumpNb, expectedNb: epubNb2, navState: epubNavState, geom: epubJumpGeom },
      shaUnchanged: { pdf: pdfShaBefore === pdfShaAfter, epub: epubShaBefore === epubShaAfter },
      runtimeErrors: errorsDelta,
    };
  } finally {
    await session.dispose();
  }
}

async function runG10b03() {
  const errorsBefore = runtimeErrors.length;
  const vault = new SyntheticVault();
  const pdfPath = "cold/paper.pdf";
  const epubPath = "cold/notes.epub";
  const introPath = "cold/intro.html";

  const pdfBytes = croppedMultiPagePdf([0, 0, 180, 0], [
    "Cold page 1",
    "Cold page 2",
    "Cold page 3 folded target",
    "Cold page 4",
  ]);
  const paras = (n: number, p: string) =>
    Array.from({ length: n }, (_, i) => \`<p>\${p} paragraph \${i} with extra lines for cold reopen test.</p>\`).join("");
  const epubBytes = buildEpub(\`\${paras(22, "ColdBefore")}<p>Cold reopen EPUB exact anchor.</p>\${paras(24, "ColdAfter")}\`);

  vault.addBinary(pdfPath, pdfBytes);
  vault.addBinary(epubPath, epubBytes);
  vault.addText(introPath, "<html><body><h1>Intro</h1><p>Unrelated starting document.</p></body></html>");

  // Session 1: create annotations in non-default notebook, fold PDF page 3, flush & destroy
  let pdfCardId = "";
  let epubCardId = "";
  let pdfNb2 = "";
  let epubNb2 = "";

  const session1 = await vault.bootWorkspace({
    settings: { autoCardOnHighlight: true, autoNodeOnCard: true, backupEnabled: false },
    studySets: [{ id: "set-1", name: "G10b-03", docPaths: [pdfPath, epubPath, introPath], createdAt: stamp }],
    canvases: [{ id: "canvas-1", studySetId: "set-1", name: "Main", createdAt: stamp }],
    activeStudySetId: "set-1",
    activeCanvasId: "canvas-1",
    cards: [], nodes: [], edges: [], srs: {},
  }, pdfPath);

  try {
    const pdfReader: any = session1.view.getReader();
    await waitFor(() => !!pdfReader?.getPageRecord?.(3), "session1 pdf pages");
    pdfReader.visiblePages.add(1);
    await pdfReader.renderPage(1);
    await frame();
    const coldSeed = pdfReader.annController.resolveSelection(selectTextIn(pdfReader.getPageRecord(1).textLayer, "Cold page 1"));
    if (!coldSeed) throw new Error("Failed to resolve seed selection on cold PDF page 1");
    pdfReader.annController.commitAnnotation(coldSeed, "highlight", "#ff0", "Cold page 1");
    const createdColdPdfNb = pdfReader.createDocumentNotebook("cold-nb");
    pdfNb2 = pdfReader.getDocumentNotebookId();
    if (!createdColdPdfNb || pdfNb2 === "default") throw new Error("Failed to create cold-nb for PDF");
    await frame();
    await pdfReader.navigateToReference(3, [], undefined, false);
    await waitFor(() => !!pdfReader.getPageRecord(3)?.textLayer?.textContent?.includes("Cold page 3 folded"), "cold pdf page 3 textLayer rendered");
    await frame();
    const pdfTarget = pdfReader.annController.resolveSelection(selectTextIn(pdfReader.getPageRecord(3).textLayer, "Cold page 3 folded"));
    pdfReader.annController.commitAnnotation(pdfTarget, "highlight", "#ff0", "Cold page 3 folded");
    pdfReader.toggleFold(3);
    await pdfReader.selectDocumentNotebook("default");
    await session1.store.flush();
    pdfCardId = session1.store.cards.find((c: Card) => c.docPath === pdfPath && c.front.includes("Cold page 3 folded"))!.id;

    await session1.view.openFile(session1.app.vault.getAbstractFileByPath(epubPath));
    const epubReader: any = session1.view.getReader();
    await waitFor(() => epubReader?.getFilePath?.() === epubPath && epubReader.getBodyEl().textContent.includes("Cold reopen EPUB"), "session1 epub");
    epubReader.ann.commitAnnotation(epubReader.ann.resolveSelection(selectTextIn(epubReader.getBodyEl(), "Chapter One")), "highlight", "#ff0", "Chapter One");
    const createdColdEpubNb = epubReader.createDocumentNotebook("cold-nb");
    epubNb2 = epubReader.getDocumentNotebookId();
    if (!createdColdEpubNb || epubNb2 === "default") throw new Error("Failed to create cold-nb for EPUB");
    const epubTarget = epubReader.ann.resolveSelection(selectTextIn(epubReader.getBodyEl(), "Cold reopen EPUB exact anchor."));
    epubReader.ann.commitAnnotation(epubTarget, "highlight", "#ff0", "Cold reopen EPUB exact anchor.");
    epubReader.selectDocumentNotebook("default");
    await session1.store.flush();
    epubCardId = session1.store.cards.find((c: Card) => c.docPath === epubPath && c.front.includes("Cold reopen EPUB"))!.id;
  } finally {
    await session1.dispose();
  }
  // Persist closed-tabs workspace state on disk so cold reopen starts with NO target doc open
  vault.disk.workspaceState = { ...(vault.disk.workspaceState ?? {}), tabs: [], activePath: undefined };

  // Session 2: TRUE cold reopen (brand new Store + brand new StudyWorkspaceView, no target doc open)
  vault.writeLog = [];
  const session2 = await vault.bootWorkspace(undefined, undefined);
  try {
    await wait(80);
    const writesBeforeJump = [...vault.writeLog];
    const initialReaderPath = session2.view.getReader()?.getFilePath?.() ?? null;

    // Trigger jump for PDF from persisted card
    const pdfCard = session2.store.getCard(pdfCardId)!;
    jumpToCardSource(session2.plugin, pdfCard);
    try {
      await waitFor(() => {
        const r: any = session2.view.getReader();
        return r?.getFilePath?.() === pdfPath && !r.folded?.has?.(3) && r.currentPage === 3 && !!r.getPageRecord?.(3)?.annLayer?.querySelector(\`[data-ann-id="\${pdfCard.anchorAnnId}"]\`);
      }, "cold reopen pdf jump");
    } catch (err) {
      const r: any = session2.view.getReader();
      throw new Error(String(err) + " | diag=" + JSON.stringify({
        filePath: r?.getFilePath?.(),
        folded: r?.folded ? [...r.folded] : null,
        currentPage: r?.currentPage,
        nb: r?.getDocumentNotebookId?.(),
        cardNb: pdfCard.documentNotebookId,
        cardAnnId: pdfCard.anchorAnnId,
        annEls: r?.getPageRecord?.(3)?.annLayer?.querySelectorAll?.("[data-ann-id]")?.length ?? null,
        notices: notices.slice(-5),
      }));
    }
    const rPdf: any = session2.view.getReader();
    await settled(rPdf.scrollEl);
    const pdfUnfolded = !rPdf.folded.has(3);
    const pdfNbAfter = rPdf.getDocumentNotebookId();
    const pdfGeom = measureRectInScroll(
      rPdf.getPageRecord(3).annLayer.querySelector(\`[data-ann-id="\${pdfCard.anchorAnnId}"]\`),
      rPdf.scrollEl,
    );

    // Trigger jump for EPUB from persisted card
    const epubCard = session2.store.getCard(epubCardId)!;
    jumpToCardSource(session2.plugin, epubCard);
    await waitFor(() => {
      const r: any = session2.view.getReader();
      return r?.getFilePath?.() === epubPath && r.getBodyEl?.()?.dataset?.msAnchorNavigation === "exact";
    }, "cold reopen epub jump");
    const rEpub: any = session2.view.getReader();
    await settled(rEpub.getScrollContainer());
    const epubNbAfter = rEpub.getDocumentNotebookId();
    const epubNavState = rEpub.getBodyEl().dataset.msAnchorNavigation;
    const epubGeom = measureRectInScroll(
      rEpub.getBodyEl().querySelector(\`[data-ann-id="\${epubCard.anchorAnnId}"]\`),
      rEpub.getScrollContainer(),
    );

    const errorsDelta = runtimeErrors.slice(errorsBefore);
    const passed =
      initialReaderPath === null &&
      writesBeforeJump.length === 0 &&
      pdfUnfolded &&
      pdfNbAfter === pdfNb2 &&
      rPdf.currentPage === 3 &&
      pdfGeom.inVisible &&
      pdfGeom.centerDelta <= 3.0 &&
      epubNbAfter === epubNb2 &&
      epubNavState === "exact" &&
      epubGeom.inVisible &&
      epubGeom.centerDelta <= 3.0 &&
      errorsDelta.length === 0;

    return {
      id: "G10b-03",
      passed,
      initialReaderPath,
      writesBeforeJump,
      pdf: { unfolded: pdfUnfolded, nb: pdfNbAfter, expectedNb: pdfNb2, page: rPdf.currentPage, geom: pdfGeom },
      epub: { nb: epubNbAfter, expectedNb: epubNb2, navState: epubNavState, geom: epubGeom },
      runtimeErrors: errorsDelta,
    };
  } finally {
    await session2.dispose();
  }
}

async function runG10b04() {
  const errorsBefore = runtimeErrors.length;
  const vault = new SyntheticVault();
  const pdfPath = "offline/origin.pdf";
  const epubPath = "offline/origin.epub";
  const pdfRelocated = "relocated/same-origin.pdf";
  const epubRevised = "relocated/revised-origin.epub";

  const pdfBytes = croppedMultiPagePdf([0, 0, 0, 0], [
    "Offline page 1",
    "Offline page 2",
    "Offline page 3 recovery target",
    "Offline page 4",
  ]);
  const paras = (n: number, p: string) =>
    Array.from({ length: n }, (_, i) => \`<p>\${p} paragraph \${i} providing vertical layout distance.</p>\`).join("");
  const epubOriginalBytes = buildEpub(
    \`\${paras(18, "Top")}<p>Stable quote kept in revised edition.</p>\${paras(16, "Mid")}<p>Removed quote replaced in revised edition.</p>\${paras(20, "Bot")}\`,
  );
  const epubRevisedBytes = buildEpub(
    \`\${paras(22, "TopRevised")}<p>Stable quote kept in revised edition.</p>\${paras(16, "Mid")}<p>Completely different rewritten sentence here.</p>\${paras(20, "Bot")}\`,
  );

  vault.addBinary(pdfPath, pdfBytes);
  vault.addBinary(epubPath, epubOriginalBytes);
  const pdfShaOriginal = vault.sha256(pdfPath);

  const session = await vault.bootWorkspace({
    settings: { autoCardOnHighlight: true, autoNodeOnCard: true, backupEnabled: false },
    studySets: [{ id: "set-1", name: "G10b-04", docPaths: [pdfPath, epubPath], createdAt: stamp }],
    canvases: [{ id: "canvas-1", studySetId: "set-1", name: "Main", createdAt: stamp }],
    activeStudySetId: "set-1",
    activeCanvasId: "canvas-1",
    cards: [], nodes: [], edges: [], srs: {},
  }, pdfPath);

  try {
    // Register fingerprints
    const pdfDoc = await session.store.refreshDocumentFingerprint(pdfPath);
    const epubDoc = await session.store.refreshDocumentFingerprint(epubPath);

    // Create PDF page 3 annotation
    const pdfReader: any = session.view.getReader();
    await waitFor(() => !!pdfReader?.getPageRecord?.(3), "g10b04 pdf ready");
    pdfReader.visiblePages.add(3);
    await pdfReader.renderPage(3);
    await frame();
    const pdfTarget = pdfReader.annController.resolveSelection(selectTextIn(pdfReader.getPageRecord(3).textLayer, "Offline page 3 recovery"));
    pdfReader.annController.commitAnnotation(pdfTarget, "highlight", "#ff0", "Offline page 3 recovery");
    await session.store.flush();
    const pdfCard = session.store.cards.find((c: Card) => c.docPath === pdfPath)!;

    // Create EPUB two annotations (one stable, one to be invalidated)
    await session.view.openFile(session.app.vault.getAbstractFileByPath(epubPath));
    const epubReader: any = session.view.getReader();
    await waitFor(() => epubReader?.getFilePath?.() === epubPath && epubReader.getBodyEl().textContent.includes("Stable quote kept"), "g10b04 epub ready");
    const stableTarget = epubReader.ann.resolveSelection(selectTextIn(epubReader.getBodyEl(), "Stable quote kept in revised edition."));
    epubReader.ann.commitAnnotation(stableTarget, "highlight", "#ff0", "Stable quote kept in revised edition.");
    const removedTarget = epubReader.ann.resolveSelection(selectTextIn(epubReader.getBodyEl(), "Removed quote replaced in revised edition."));
    epubReader.ann.commitAnnotation(removedTarget, "highlight", "#ff0", "Removed quote replaced in revised edition.");
    await session.store.flush();

    const stableCard = session.store.cards.find((c: Card) => c.front.includes("Stable quote kept"))!;
    const removedCard = session.store.cards.find((c: Card) => c.front.includes("Removed quote replaced"))!;
    const removedAnnBefore = (await session.store.loadAnnotations(epubPath)).find((a) => a.id === removedCard.anchorAnnId)!;
    const expectedSectionRatio = removedAnnBefore.range?.sectionRatio ?? 0;

    // ===== Phase 1: Offline (files moved away) =====
    const cardsBeforeOffline = session.store.cards.length;
    const nodesBeforeOffline = session.store.nodes.length;
    vault.removeFile(pdfPath);
    vault.removeFile(epubPath);
    session.store.markDocumentMissing(pdfPath);
    session.store.markDocumentMissing(epubPath);
    await session.store.flush();

    const pdfMissingFlag = session.store.documents.find((d) => d.id === pdfDoc.id)?.missing === true;
    const epubMissingFlag = session.store.documents.find((d) => d.id === epubDoc.id)?.missing === true;
    const preservedOffline =
      session.store.cards.length === cardsBeforeOffline &&
      session.store.nodes.length === nodesBeforeOffline &&
      (await session.store.loadAnnotations(pdfPath)).length === 1 &&
      (await session.store.loadAnnotations(epubPath)).length === 2;

    const noticeCountBefore = notices.length;
    jumpToCardSource(session.plugin, pdfCard);
    await wait(60);
    const offlineNotices = notices.slice(noticeCountBefore);
    const offlineGraceful = offlineNotices.some((n) => n.includes("无法跳转原文") || n.includes("不存在"));

    // ===== Phase 2: Auto-recovery (identical SHA-256 at new path) =====
    vault.addBinary(pdfRelocated, pdfBytes);
    const autoRec = await session.store.recoverMissingDocuments();
    const pdfRecovered = autoRec.recovered.some((r) => r.id === pdfDoc.id && r.newPath === pdfRelocated);
    const pdfRestoredEvent = session.store.localEvents.some((e) => e.kind === "restored" && e.objectIds.includes(pdfDoc.id));
    const pdfCardAfterAuto = session.store.getCard(pdfCard.id)!;

    jumpToCardSource(session.plugin, pdfCardAfterAuto);
    await waitFor(() => {
      const r: any = session.view.getReader();
      return r?.getFilePath?.() === pdfRelocated && r.currentPage === 3 && !!r.getPageRecord?.(3)?.annLayer?.querySelector(\`[data-ann-id="\${pdfCardAfterAuto.anchorAnnId}"]\`);
    }, "pdf jump after auto recovery");
    const rPdfAuto: any = session.view.getReader();
    await settled(rPdfAuto.scrollEl);
    const pdfAutoGeom = measureRectInScroll(
      rPdfAuto.getPageRecord(3).annLayer.querySelector(\`[data-ann-id="\${pdfCardAfterAuto.anchorAnnId}"]\`),
      rPdfAuto.scrollEl,
    );
    const pdfShaAfterAuto = vault.sha256(pdfRelocated);

    // ===== Phase 3: Changed-content explicit restore =====
    vault.addBinary(epubRevised, epubRevisedBytes);
    const epubRevisedShaBefore = vault.sha256(epubRevised);
    const revRec = await session.store.recoverMissingDocuments();
    const notSilentlyLinked =
      revRec.recovered.length === 0 &&
      revRec.ambiguous.some((a) => a.id === epubDoc.id && a.identicalCandidates.length === 0 && a.candidates.includes(epubRevised));

    let rejectedWithoutAccept = false;
    try {
      await session.store.restoreDocumentAtPath(epubDoc.id, epubRevised, false);
    } catch {
      rejectedWithoutAccept = true;
    }

    await session.store.restoreDocumentAtPath(epubDoc.id, epubRevised, true);
    const recoveryBackupKeys = [...vault.adapterFiles.keys()].filter((k) => k.includes("document-content-change"));
    const backupHasOldFingerprintAndSidecar = recoveryBackupKeys.some((k) => {
      const text = vault.adapterFiles.get(k) ?? "";
      return text.includes(epubDoc.sha256!) && text.includes("oldSidecarText");
    });

    // Jump to matching (stable) annotation -> exact
    const stableCardAfter = session.store.getCard(stableCard.id)!;
    jumpToCardSource(session.plugin, stableCardAfter);
    await waitFor(() => {
      const r: any = session.view.getReader();
      return r?.getFilePath?.() === epubRevised && r.getBodyEl?.()?.dataset?.msAnchorNavigation === "exact";
    }, "epub exact jump after explicit restore");
    const rEpubRev: any = session.view.getReader();
    await settled(rEpubRev.getScrollContainer());
    const exactNavState = rEpubRev.getBodyEl().dataset.msAnchorNavigation;
    const exactGeom = measureRectInScroll(
      rEpubRev.getBodyEl().querySelector(\`[data-ann-id="\${stableCardAfter.anchorAnnId}"]\`),
      rEpubRev.getScrollContainer(),
    );

    // Jump to invalidated (removed) annotation -> approximate via sectionRatio, zero guessed highlight, annotation preserved
    const removedCardAfter = session.store.getCard(removedCard.id)!;
    rEpubRev.getScrollContainer().scrollTo({ top: 0, behavior: "instant" });
    await settled(rEpubRev.getScrollContainer());
    jumpToCardSource(session.plugin, removedCardAfter);
    await waitFor(() => rEpubRev.getBodyEl().dataset.msAnchorNavigation === "approximate", "epub approximate jump");
    await settled(rEpubRev.getScrollContainer());
    const approxNavState = rEpubRev.getBodyEl().dataset.msAnchorNavigation;
    const guessedHighlightCount = rEpubRev.getBodyEl().querySelectorAll(\`[data-ann-id="\${removedCardAfter.anchorAnnId}"]\`).length;
    const sectionEl = rEpubRev.getBodyEl().querySelector('[data-ms-section="OPS/two.xhtml"]') as HTMLElement | null;
    const scrollRect = rEpubRev.getScrollContainer().getBoundingClientRect();
    const sectionRect = sectionEl?.getBoundingClientRect();
    const ratioDelta = sectionRect
      ? Math.round(Math.abs((sectionRect.top + sectionRect.height * expectedSectionRatio) - (scrollRect.top + rEpubRev.getScrollContainer().clientHeight / 2)) * 100) / 100
      : Infinity;
    const annsAfterRestore = await session.store.loadAnnotations(epubRevised);
    const originalAnnPreserved = annsAfterRestore.length === 2 && annsAfterRestore.some((a) => a.id === removedCardAfter.anchorAnnId);
    const epubRevisedShaAfter = vault.sha256(epubRevised);
    const errorsDelta = runtimeErrors.slice(errorsBefore);

    const passed =
      pdfMissingFlag &&
      epubMissingFlag &&
      preservedOffline &&
      offlineGraceful &&
      pdfRecovered &&
      pdfRestoredEvent &&
      rPdfAuto.currentPage === 3 &&
      pdfAutoGeom.inVisible &&
      pdfAutoGeom.centerDelta <= 3.0 &&
      pdfShaOriginal === pdfShaAfterAuto &&
      notSilentlyLinked &&
      rejectedWithoutAccept &&
      backupHasOldFingerprintAndSidecar &&
      exactNavState === "exact" &&
      exactGeom.inVisible &&
      exactGeom.centerDelta <= 3.0 &&
      approxNavState === "approximate" &&
      guessedHighlightCount === 0 &&
      ratioDelta <= 3.0 &&
      originalAnnPreserved &&
      epubRevisedShaBefore === epubRevisedShaAfter &&
      errorsDelta.length === 0;

    return {
      id: "G10b-04",
      passed,
      offline: { pdfMissingFlag, epubMissingFlag, preservedOffline, offlineGraceful, offlineNotices },
      autoRecovery: {
        pdfRecovered,
        pdfRestoredEvent,
        page: rPdfAuto.currentPage,
        geom: pdfAutoGeom,
        shaUnchanged: pdfShaOriginal === pdfShaAfterAuto,
      },
      changedRestore: {
        notSilentlyLinked,
        rejectedWithoutAccept,
        recoveryBackupKeys,
        backupHasOldFingerprintAndSidecar,
        exactNavState,
        exactGeom,
        approxNavState,
        guessedHighlightCount,
        expectedSectionRatio,
        ratioDelta,
        originalAnnPreserved,
        shaUnchanged: epubRevisedShaBefore === epubRevisedShaAfter,
      },
      runtimeErrors: errorsDelta,
    };
  } finally {
    await session.dispose();
  }
}

(window as any).runG10b01 = runG10b01;
(window as any).runG10b02 = runG10b02;
(window as any).runG10b03 = runG10b03;
(window as any).runG10b04 = runG10b04;
(window as any).getRuntimeErrors = () => runtimeErrors;
(window as any).ready = true;
`;

try {
  await writeFile(join(temporary, "obsidian-fixture.ts"), (await readFile(join(workspaceDir, "obsidian-fixture.txt"), "utf8")).replaceAll("__PROJECT__", project));
  await writeFile(join(temporary, "anchor-fixture.ts"), fixtureSource);
  await writeFile(join(temporary, "fakeMammoth.ts"), await readFile(join(project, "src/documents/acceptance-fixtures/fakeMammoth.txt"), "utf8"));
  await writeFile(join(temporary, "unused-network.ts"), "export function request(){throw new Error('network unused');}");
  await writeFile(
    join(temporary, "crypto.ts"),
    `import { sha256Hex } from "${project}/src/utils/sha256";\nexport function createHash(){let buf=new Uint8Array(0);return{update(v:any){const chunk=typeof v==="string"?new TextEncoder().encode(v):new Uint8Array(v);const next=new Uint8Array(buf.length+chunk.length);next.set(buf,0);next.set(chunk,buf.length);buf=next;return this;},digest(){return sha256Hex(buf);}};}\n`,
  );
  await copyFile(join(project, "pdf.worker.js"), join(temporary, "pdf.worker.js"));

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
    '<!doctype html><meta charset="utf-8"><title>MarginStudy GAP-10b anchor lifecycle acceptance</title><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0;height:100%}#fixtures{height:100vh;width:100vw}.test-item-view{height:100%;width:100%;display:flex;flex-direction:column}.test-item-view>.view-content{height:100%;width:100%;overflow:hidden}</style><main id="fixtures"></main><script type="module" src="/fixture.js"></script>',
  );

  await build({
    entryPoints: [join(temporary, "anchor-fixture.ts")],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "chrome120",
    outfile: join(temporary, "fixture.js"),
    external: ["canvas"],
    plugins: [{
      name: "anchor-lifecycle-adapters",
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: join(temporary, "obsidian-fixture.ts") }));
        builder.onResolve({ filter: /^crypto$/ }, () => ({ path: join(temporary, "crypto.ts") }));
        builder.onResolve({ filter: /^(?:http|https)$/ }, () => ({ path: join(temporary, "unused-network.ts") }));
        builder.onResolve({ filter: /^mammoth$/ }, () => ({ path: join(temporary, "fakeMammoth.ts") }));
      },
    }],
  });

  const allowed = new Set(["index.html", "fixture.js", "styles.css", "pdf.worker.js"]);
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    if (pathname.startsWith("/synthetic-resource/")) {
      res.setHeader("Content-Type", "image/png");
      res.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64"));
      return;
    }
    const name = pathname.slice(1) || "index.html";
    if (!allowed.has(name)) { res.statusCode = 404; res.end(); return; }
    res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
    res.end(await readFile(join(temporary, name)));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));

  const session = `marginstudy-anchor-lifecycle-${process.pid}`;
  const browser = (...args) => runBrowser(session, ...args);

  const evidenceDir = process.env.MARGINSTUDY_EVIDENCE_DIR ? resolve(process.env.MARGINSTUDY_EVIDENCE_DIR, "gap-10b") : null;
  if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
  let headSha = null;
  try { headSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: project, encoding: "utf8" }).trim(); } catch {}
  const writeEvidence = async (filename, payload) => {
    if (evidenceDir) {
      await writeFile(join(evidenceDir, filename), JSON.stringify({ head: headSha, generatedAt: new Date().toISOString(), ...payload }, null, 2) + "\n");
    }
  };

  try {
    await browser("open", "about:blank");
    await browser("set", "viewport", "1200", "800");
    await browser("open", `http://127.0.0.1:${server.address().port}`);
    await browser("wait", "--fn", "window.ready === true");
    const evalJson = async (expr) => JSON.parse((await browser("eval", expr)).stdout);

    const runSafe = async (id, expr) => {
      try {
        return await evalJson(expr);
      } catch (error) {
        return { id, passed: false, error: String(error?.stderr || error?.message || error) };
      }
    };

    const g10b01 = await runSafe("G10b-01", "window.runG10b01()");
    await writeEvidence("g10b-01-crosspage-jump.json", g10b01);

    const g10b02 = await runSafe("G10b-02", "window.runG10b02()");
    await writeEvidence("g10b-02-rename-move-jump.json", g10b02);

    const g10b03 = await runSafe("G10b-03", "window.runG10b03()");
    await writeEvidence("g10b-03-reopen-jump.json", g10b03);

    const g10b04 = await runSafe("G10b-04", "window.runG10b04()");
    await writeEvidence("g10b-04-missing-recovery-reanchor.json", g10b04);

    const runtimeErrors = await evalJson("window.getRuntimeErrors()");
    const assertions = [
      ["G10b-01", g10b01],
      ["G10b-02", g10b02],
      ["G10b-03", g10b03],
      ["G10b-04", g10b04],
    ];
    const passedCount = assertions.filter(([, res]) => res.passed).length;
    console.log(`${passedCount}/${assertions.length} GAP-10b anchor lifecycle navigation assertions passed (runtimeErrors=${runtimeErrors.length})`);
    for (const [id, res] of assertions) {
      console.log(`${res.passed ? "PASS" : "FAIL"} ${id}`);
    }
    if (passedCount !== assertions.length || runtimeErrors.length > 0) {
      console.error(JSON.stringify({
        runtimeErrors,
        failed: Object.fromEntries(assertions.filter(([, res]) => !res.passed)),
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
