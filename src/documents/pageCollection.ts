import { Notice, TFile } from "obsidian";
import type MarginStudyPlugin from "../main";
import type { Annotation, PdfPageGeometry } from "../types";
import { uid } from "../utils/id";
import { loadPdf } from "../pdf/pdfjs";
import { annotationGeometry } from "../anchors/pdfGeometry";
import { annotationNotebook, notebookMeta, updateNotebookMeta } from "../annot/documentNotebooks";
import { annotationInkLayer, inkLayerState, isInkLayerBound, isOrphanInkLayer } from "../annot/inkLayers";
import { createModal } from "../utils/modal";
import { el, clear } from "../utils/dom";

export const PAGE_COLLECTION_EXTENSION = "msref";
export type PageReferenceOrigin = "toc" | "page" | "selection" | "document";
export interface PageReference {
  id: string;
  sourcePath: string;
  sourcePage: number;
  sourceNotebookId: string;
  annotations: "clean" | "include";
  origin: PageReferenceOrigin;
}
export interface PageCollection {
  format: "marginstudy-page-collection";
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  pages: PageReference[];
}
export interface PageCollectionLocalSource {
  path: string;
  page: number;
  referenceId?: string;
  notebookId: string;
  hadSourceSnapshots?: boolean;
}
export type PageReferenceInput = Pick<PageReference, "sourcePath" | "sourcePage">
  & Partial<Omit<PageReference, "id" | "sourcePath" | "sourcePage">>
  & { collectionSource?: PageCollectionLocalSource };
export interface LinkedPageAnnotation extends Annotation { referenceSource: { docPath: string; anchorAnnId: string; page: number; notebookId: string }; }
const excerptTypes = new Set(["highlight", "underline", "strike", "region"]);
const locks = new Set<string>();
const sourceRenameQueues = new WeakMap<MarginStudyPlugin,Promise<void>>();
function vaultPath(value: string): boolean { return !!value && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => part === "." || part === "..") && !/[\u0000-\u001f]/.test(value); }
export function parsePageCollection(bytes: ArrayBuffer): PageCollection {
  if (bytes.byteLength > 2_000_000) throw new Error("重组文档清单过大");
  let value: any; try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("重组文档清单无法读取"); }
  if (value?.format !== "marginstudy-page-collection" || value.version !== 1 || typeof value.id !== "string" || !value.id || typeof value.title !== "string" || !value.title.trim() || !Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 1000) throw new Error("重组文档清单格式无效");
  const ids = new Set<string>();
  for (const page of value.pages) {
    if (!page || typeof page.id !== "string" || !page.id || ids.has(page.id) || typeof page.sourcePath !== "string" || !vaultPath(page.sourcePath) || !/\.pdf$/i.test(page.sourcePath) || !Number.isInteger(page.sourcePage) || page.sourcePage < 1 || typeof page.sourceNotebookId !== "string" || !["clean", "include"].includes(page.annotations) || !["toc", "page", "selection", "document"].includes(page.origin)) throw new Error("重组文档包含无效页面引用");
    ids.add(page.id);
  }
  return value as PageCollection;
}
function collectionBytes(collection: PageCollection): ArrayBuffer { const bytes = new TextEncoder().encode(JSON.stringify(collection, null, 2)).buffer as ArrayBuffer; parsePageCollection(bytes); return bytes; }
export async function readPageCollection(plugin: MarginStudyPlugin, file: TFile): Promise<PageCollection> { return parsePageCollection(await plugin.app.vault.readBinary(file)); }
/** Called by the public vault rename event after the source's normal Store migration. */
export function updatePageCollectionSourcePath(plugin: MarginStudyPlugin, oldPath: string, newPath: string): Promise<string[]> {
  if (oldPath === newPath || !/\.pdf$/i.test(oldPath) || !/\.pdf$/i.test(newPath)) return Promise.resolve([]);
  if (!vaultPath(oldPath) || !vaultPath(newPath)) return Promise.reject(new Error("源 PDF 路径必须位于笔记库内"));
  // Preserve A -> B -> C ordering even when public rename events arrive rapidly.
  const task = (sourceRenameQueues.get(plugin) ?? Promise.resolve()).then(async () => {
    const updated: string[] = [], failed: string[] = [];
    const candidates = plugin.app.vault.getFiles().filter(file=>file.extension.toLowerCase() === PAGE_COLLECTION_EXTENSION
      && !file.path.startsWith("MarginStudyBackups/") && !file.path.startsWith("_marginstudy-recovery/"));
    for (const file of candidates) {
      let collection: PageCollection;
      try { collection = await readPageCollection(plugin,file); } catch { continue; }
      if (!collection.pages.some(entry=>entry.sourcePath === oldPath)) continue;
      const path = file.path, deadline = Date.now()+10_000;
      try {
        while (locks.has(path) && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20));
        if (locks.has(path)) throw new Error("此重组文档仍在更新");
        locks.add(path);
        try {
          let changed = false;
          // Public atomic text processing retains concurrent title/order additions.
          await plugin.app.vault.process(file,current=>{
            const latest = parsePageCollection(new TextEncoder().encode(current).buffer as ArrayBuffer);
            if (!latest.pages.some(entry=>entry.sourcePath === oldPath)) return current;
            const next = { ...latest, pages: latest.pages.map(entry=>entry.sourcePath === oldPath ? {...entry,sourcePath:newPath} : entry) };
            const result = new TextDecoder().decode(collectionBytes(next)); changed = true; return result;
          });
          if (changed) updated.push(file.path);
        } finally { locks.delete(path); }
      } catch { failed.push(file.path); }
    }
    if (failed.length) new Notice(`有 ${failed.length} 个重组文档的源路径未能更新，请重新打开检查：${failed.join("、")}`,10_000);
    return updated;
  });
  sourceRenameQueues.set(plugin,task.then(()=>{},()=>{}));
  return task;
}
function reference(input: PageReferenceInput, annotations: "clean" | "include", origin: PageReferenceOrigin): PageReference {
  return { id: uid("page"), sourcePath: input.sourcePath, sourcePage: input.sourcePage, sourceNotebookId: input.sourceNotebookId || "default", annotations: input.annotations ?? annotations, origin: input.origin ?? origin };
}
/** A PDF.js facade over the original files. No PDF bytes are copied into the collection. */
export class PageCollectionDocument {
  readonly numPages: number;
  readonly pageCollection: PageCollection;
  private documents = new Map<string, Promise<any>>();
  private annotations = new Map<string, Annotation[]>();
  private unsubscribers: (() => void)[] = [];
  private destroyed = false;
  onReferencesChanged?: () => void;
  constructor(private plugin: MarginStudyPlugin, collection: PageCollection, private signal?: AbortSignal) { this.pageCollection = collection; this.numPages = collection.pages.length; }
  async initialize(): Promise<void> {
    if (this.signal?.aborted) throw new Error("已取消打开重组文档");
    this.signal?.addEventListener("abort", this.onAbort, { once: true });
    for (const path of new Set(this.pageCollection.pages.filter((entry) => entry.annotations === "include").map((entry) => entry.sourcePath))) {
      const anns = await this.plugin.store.loadAnnotations(path); if (this.destroyed) return; this.annotations.set(path, anns);
      this.unsubscribers.push(this.plugin.store.subscribeAnnotations(path, () => { void this.plugin.store.loadAnnotations(path).then((next) => { if (!this.destroyed) { this.annotations.set(path,next); this.onReferencesChanged?.(); } }); }));
    }
  }
  private onAbort = () => { void this.destroy(); };
  private async source(path: string): Promise<any> {
    if (this.destroyed || this.signal?.aborted) throw new Error("重组文档已关闭");
    let promise = this.documents.get(path);
    if (!promise) {
      promise = (async () => {
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || file.extension.toLowerCase() !== "pdf") throw new Error(`源 PDF 不存在：${path}`);
        const bytes = await this.plugin.app.vault.readBinary(file);
        if (this.destroyed || this.signal?.aborted) throw new Error("已取消打开重组文档");
        const doc = await loadPdf(bytes, this.signal);
        if (this.destroyed || this.signal?.aborted) { await doc.destroy(); throw new Error("已取消打开重组文档"); }
        return doc;
      })();
      this.documents.set(path, promise); void promise.catch(() => { if (this.documents.get(path) === promise) this.documents.delete(path); });
    }
    return promise;
  }
  async getPage(page: number): Promise<any> {
    const entry = this.pageCollection.pages[page-1]; if (!entry || !Number.isInteger(page)) throw new Error("重组文档页码超出范围");
    const doc = await this.source(entry.sourcePath); if (entry.sourcePage > doc.numPages) throw new Error(`源页已不存在：${entry.sourcePath} 第 ${entry.sourcePage} 页`);
    return doc.getPage(entry.sourcePage);
  }
  async getOutline(): Promise<any[]> { return this.pageCollection.pages.map((entry,index) => ({ title: `${entry.sourcePath.split("/").pop()} · 第 ${entry.sourcePage} 页`, dest: [index, {name:"Fit"}], items: [] })); }
  getLinkedAnnotations(): LinkedPageAnnotation[] {
    const result: LinkedPageAnnotation[] = [];
    for (const [path, annotations] of this.annotations) for (const source of annotations) {
      if (!excerptTypes.has(source.type)) continue;
      const matches = this.pageCollection.pages.map((entry,index) => ({entry,page:index+1})).filter(({entry}) => entry.sourcePath === path && entry.annotations === "include" && entry.sourceNotebookId === annotationNotebook(source));
      const geometry: PdfPageGeometry[] = matches.flatMap(({entry,page}) => annotationGeometry(source).filter((part) => sourcePageForAnnotationPart(source, part.page) === entry.sourcePage).map((part) => ({page,rects:part.rects})));
      if (!geometry.length) continue; const first = geometry[0];
      result.push({ ...source, id: `linked:${encodeURIComponent(path)}:${source.id}`, page: first.page, rects: first.rects, pdfGeometry: geometry,
        referenceSource: { docPath: path, anchorAnnId: source.id, page: source.page, notebookId: annotationNotebook(source) } });
    }
    return result;
  }
  async destroy(): Promise<void> {
    if (this.destroyed) return; this.destroyed = true; this.signal?.removeEventListener("abort", this.onAbort); this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    const docs = [...this.documents.values()]; this.documents.clear(); this.annotations.clear();
    await Promise.allSettled(docs.map(async (promise) => { const doc = await promise; await doc.destroy(); }));
  }
}
export async function openPageCollectionDocument(plugin: MarginStudyPlugin, bytes: ArrayBuffer, signal?: AbortSignal): Promise<PageCollectionDocument> {
  const document = new PageCollectionDocument(plugin, parsePageCollection(bytes), signal);
  try { await document.initialize(); return document; } catch (error) { await document.destroy(); throw error; }
}
export function collectionPageIndex(collection: PageCollection, referenceId: string): number { return collection.pages.findIndex((entry) => entry.id === referenceId) + 1; }
export function mapCollectionAnnotation(annotation: Annotation, collection: PageCollection): Annotation {
  if (!annotation.pdfReferencePages?.length) return annotation;
  const map = new Map(annotation.pdfReferencePages.map((entry) => [entry.page, collectionPageIndex(collection,entry.id)]));
  const geometry = annotationGeometry(annotation).flatMap((part) => { const page = map.get(part.page); return page ? [{page,rects:part.rects}] : []; });
  return { ...annotation, page: map.get(annotation.page) || -1, pdfGeometry: geometry, rects: geometry[0]?.rects ?? [] };
}
async function validateSources(plugin: MarginStudyPlugin, collection: PageCollection): Promise<void> {
  const document = new PageCollectionDocument(plugin, collection); try { for (let index = 1; index <= collection.pages.length; index++) await document.getPage(index); } finally { await document.destroy(); }
}
function sourcePageForAnnotationPart(annotation: Annotation, partPage: number): number | null {
  const ref = annotation.pdfReferencePages?.find((entry) => entry.page === partPage);
  if (!ref) return partPage;
  if (!ref.id.startsWith("source:")) return null;
  const sourcePage = Number(ref.id.slice("source:".length));
  return Number.isInteger(sourcePage) && sourcePage >= 1 ? sourcePage : null;
}
function cloneSnapshotAnnotation(
  ann: Annotation,
  nextId: string,
  targetPath: string,
  notebookId: string,
  targetEntryId: string,
  targetPage: number,
  parts: PdfPageGeometry[],
  idMap: Map<string, string>,
): Annotation {
  const geometry = parts.map((part) => ({ page: targetPage, rects: part.rects.map((rect) => ({ ...rect })) }));
  const next: Annotation = {
    ...ann,
    id: nextId,
    docPath: targetPath,
    documentNotebookId: notebookId,
    cardId: undefined,
    page: targetPage,
    rects: geometry[0]?.rects ?? [],
    pdfGeometry: geometry,
    pdfReferencePages: [{ id: targetEntryId, page: targetPage }],
    ...(ann.strokes !== undefined ? { strokes: ann.strokes.map((stroke) => stroke.map((point) => ({ ...point }))) } : {}),
    ...(ann.overlay !== undefined ? { overlay: structuredClone(ann.overlay) } : {}),
    ...(ann.pos !== undefined ? { pos: { ...ann.pos } } : {}),
    ...(ann.images !== undefined ? { images: [...ann.images] } : {}),
    ...(ann.excerptBlocks !== undefined ? { excerptBlocks: structuredClone(ann.excerptBlocks) } : {}),
    ...(ann.range !== undefined ? { range: structuredClone(ann.range) } : {}),
  };
  delete next.cardId;
  if (ann.hostAnnotationId !== undefined) {
    const mappedHost = idMap.get(ann.hostAnnotationId);
    if (mappedHost) next.hostAnnotationId = mappedHost;
    else {
      delete next.hostAnnotationId;
      delete next.hostBindingId;
    }
  }
  return next;
}
async function copyNonExcerptAnnotationsFromSource(
  plugin: MarginStudyPlugin,
  cached: Map<string, Annotation[]>,
  target: Annotation[],
  targetPath: string,
  targetNotebookId: string,
  sourcePath: string,
  sourceNotebookId: string,
  targetEntryId: string,
  targetPage: number,
  matchParts: (ann: Annotation) => PdfPageGeometry[],
  layersToSync: Map<string, string>,
): Promise<void> {
  if (!cached.has(sourcePath)) cached.set(sourcePath, await plugin.store.loadAnnotations(sourcePath));
  const sourceAnns = cached.get(sourcePath)!;
  const sourceMeta = notebookMeta(plugin.store.getDocMeta(sourcePath), sourceNotebookId), ink = inkLayerState(sourceMeta);
  const deletedHostIds = new Set(sourceAnns.filter((ann) => annotationNotebook(ann) === sourceNotebookId && ann.overlay?.deleted).map((ann) => ann.id));
  const eligible: { ann: Annotation; parts: PdfPageGeometry[] }[] = [];
  for (const ann of sourceAnns) {
    if (annotationNotebook(ann) !== sourceNotebookId || ann.overlay?.deleted || ann.mediaDeleted || excerptTypes.has(ann.type)) continue;
    if (ann.type === "pen" && (!ann.strokes?.length || !ann.strokes.some((stroke) => stroke.length > 0))) continue;
    const parts = matchParts(ann);
    if (!parts.length) continue;
    if (ann.type === "pen" && ann.bindToInkLayer !== false && ann.hostAnnotationId && deletedHostIds.has(ann.hostAnnotationId)) continue;
    if (isInkLayerBound(ann) && !isOrphanInkLayer(ann, ink) && annotationInkLayer(ann, ink) !== ink.active) continue;
    eligible.push({ ann, parts });
  }
  const idMap = new Map(eligible.map(({ ann }) => [ann.id, uid("ann")]));
  for (const { ann, parts } of eligible) {
    if (isInkLayerBound(ann) && !isOrphanInkLayer(ann, ink)) {
      const layerId = annotationInkLayer(ann, ink);
      if (layerId !== "default") {
        const layer = ink.layers.find((item) => item.id === layerId);
        if (layer && !layersToSync.has(layer.id)) layersToSync.set(layer.id, layer.name);
      }
    }
    target.push(cloneSnapshotAnnotation(ann, idMap.get(ann.id)!, targetPath, targetNotebookId, targetEntryId, targetPage, parts, idMap));
  }
}
async function snapshotAnnotations(plugin: MarginStudyPlugin, targetPath: string, collection: PageCollection, entries: PageReference[], notebookId: string, inputs?: PageReferenceInput[]): Promise<void> {
  const target = await plugin.store.loadAnnotations(targetPath); const cached = new Map<string, Annotation[]>();
  const layersToSync = new Map<string, string>();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.annotations !== "include") continue;
    const targetPage = collectionPageIndex(collection, entry.id);
    const localSource = inputs?.[index]?.collectionSource;
    if (!localSource?.hadSourceSnapshots) {
      await copyNonExcerptAnnotationsFromSource(
        plugin, cached, target, targetPath, notebookId,
        entry.sourcePath, entry.sourceNotebookId, entry.id, targetPage,
        (ann) => annotationGeometry(ann).filter((part) => sourcePageForAnnotationPart(ann, part.page) === entry.sourcePage),
        layersToSync,
      );
    }
    if (localSource) {
      await copyNonExcerptAnnotationsFromSource(
        plugin, cached, target, targetPath, notebookId,
        localSource.path, localSource.notebookId, entry.id, targetPage,
        (ann) => {
          if (localSource.referenceId && ann.pdfReferencePages?.length) {
            const matchedPages = new Set(ann.pdfReferencePages.filter((ref) => ref.id === localSource.referenceId).map((ref) => ref.page));
            return matchedPages.size ? annotationGeometry(ann).filter((part) => matchedPages.has(part.page)) : [];
          }
          return annotationGeometry(ann).filter((part) => part.page === localSource.page);
        },
        layersToSync,
      );
    }
  }
  if (layersToSync.size) {
    const targetMeta = notebookMeta(plugin.store.getDocMeta(targetPath), notebookId);
    const existing = inkLayerState(targetMeta).layers.map((layer) => ({ ...layer }));
    let changed = false;
    for (const [id, name] of layersToSync) {
      if (!existing.some((layer) => layer.id === id)) {
        existing.push({ id, name });
        changed = true;
      }
    }
    if (changed) updateNotebookMeta(plugin, targetPath, { handwritingLayers: existing }, notebookId);
  }
  plugin.store.saveAnnotationsDebounced(targetPath, target);
}
async function includeSelectionFolds(plugin: MarginStudyPlugin, path: string, collection: PageCollection, entries: PageReference[], notebookId: string): Promise<void> {
  const meta = notebookMeta(plugin.store.getDocMeta(path),notebookId), folded = new Set(meta.foldedPages ?? []);
  for (const entry of entries) if (entry.origin === "selection" && notebookMeta(plugin.store.getDocMeta(entry.sourcePath),entry.sourceNotebookId).foldedPages?.includes(entry.sourcePage)) folded.add(collectionPageIndex(collection,entry.id));
  updateNotebookMeta(plugin,path,{foldedPages:[...folded].sort((a,b)=>a-b)},notebookId);
}
export async function createPageCollection(plugin: MarginStudyPlugin, options: { title: string; pages: PageReferenceInput[]; origin?: PageReferenceOrigin; annotations?: "clean" | "include"; studySetId?: string; folder?: string; recordLibraryHistory?: boolean }): Promise<TFile> {
  const title = options.title.trim(); if (!title || title.length > 120) throw new Error("请填写 1–120 字的文档名称");
  const origin = options.origin ?? "toc", collection: PageCollection = { format:"marginstudy-page-collection",version:1,id:uid("collection"),title,createdAt:new Date().toISOString(),pages:options.pages.map((entry) => reference(entry,options.annotations ?? (origin === "selection" ? "include" : "clean"),origin)) };
  collectionBytes(collection); await validateSources(plugin,collection);
  const folder = options.folder ?? "MarginStudy 重组文档"; if (!vaultPath(folder)) throw new Error("请选择笔记库内的文件夹"); let prefix = "";
  for (const part of folder.split("/")) { prefix = prefix ? `${prefix}/${part}` : part; if (!await plugin.app.vault.adapter.exists(prefix)) await plugin.app.vault.createFolder(prefix); }
  const basename = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g,"_").replace(/[. ]+$/,"") || "重组文档"; let path = `${folder}/${basename}.msref`, suffix = 2;
  while (await plugin.app.vault.adapter.exists(path)) path = `${folder}/${basename} ${suffix++}.msref`;
  const file = await plugin.app.vault.createBinary(path,collectionBytes(collection));
  await snapshotAnnotations(plugin,path,collection,collection.pages,"default",options.pages); await includeSelectionFolds(plugin,path,collection,collection.pages,"default");
  const selected = options.studySetId ?? plugin.store.activeStudySetId;
  const set = plugin.store.studySets.find((item) => item.id === selected) ?? plugin.store.createStudySet("我的学习集");
  const nextDocPaths = [...new Set([...set.docPaths, path])];
  if (options.recordLibraryHistory === false) set.docPaths = nextDocPaths;
  else plugin.store.updateStudySet(set.id,{docPaths:nextDocPaths});
  plugin.store.setActiveStudySet(set.id); plugin.store.registerDocument(path); plugin.store.save(); await plugin.store.flush(); plugin.refreshSidebar(); return file;
}
export async function recreatePageCollection(plugin: MarginStudyPlugin, path: string, collection: PageCollection, metadata: any, annotations: Annotation[], studySetId?: string | null): Promise<TFile> {
  if (!vaultPath(path) || !path.toLowerCase().endsWith(`.${PAGE_COLLECTION_EXTENSION}`)) throw new Error("重组文档路径无效");
  if (await plugin.app.vault.adapter.exists(path)) throw new Error("目标路径已存在同名文件，无法重做合并新建文档");
  const bytes = collectionBytes(collection);
  await validateSources(plugin, collection);
  const parts = path.split("/"); parts.pop(); let prefix = "";
  for (const part of parts) { prefix = prefix ? `${prefix}/${part}` : part; if (!await plugin.app.vault.adapter.exists(prefix)) await plugin.app.vault.createFolder(prefix); }
  const file = await plugin.app.vault.createBinary(path, bytes);
  if (metadata && Object.keys(metadata).length) plugin.store.updateDocMeta(path, structuredClone(metadata));
  plugin.store.saveAnnotationsDebounced(path, structuredClone(annotations));
  const selected = studySetId ?? plugin.store.activeStudySetId;
  const set = plugin.store.studySets.find((item) => item.id === selected);
  if (set && !set.docPaths.includes(path)) set.docPaths = [...set.docPaths, path];
  plugin.store.registerDocument(path); plugin.store.save(); await plugin.store.flush(); plugin.refreshSidebar();
  return file;
}
export async function appendPageReferences(plugin: MarginStudyPlugin, file: TFile, inputs: PageReferenceInput[], notebookId?: string): Promise<PageCollection> {
  if (locks.has(file.path)) throw new Error("此重组文档正在更新"); locks.add(file.path);
  try {
    const collection = await readPageCollection(plugin,file), pages = inputs.map((entry) => reference(entry,"include",entry.origin ?? "page"));
    const next = {...collection,pages:[...collection.pages,...pages]}; collectionBytes(next); await validateSources(plugin,{...next,pages});
    const id = notebookId ?? plugin.store.getDocMeta(file.path).activeDocumentNotebookId ?? "default";
    if (JSON.stringify(await readPageCollection(plugin,file))!==JSON.stringify(collection)) throw new Error("文档已在其他窗口更新，请重新打开后再操作");
    await plugin.app.vault.modifyBinary(file,collectionBytes(next)); await snapshotAnnotations(plugin,file.path,next,pages,id,inputs); await includeSelectionFolds(plugin,file.path,next,pages,id); await plugin.store.flush(); return next;
  } finally { locks.delete(file.path); }
}
export async function reorderPageReferences(plugin: MarginStudyPlugin, file: TFile, orderedIds: string[]): Promise<PageCollection> {
  if (locks.has(file.path)) throw new Error("此重组文档正在更新"); locks.add(file.path);
  try {
    const collection = await readPageCollection(plugin,file); if (!orderedIds.length || new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !collection.pages.some((entry)=>entry.id===id))) throw new Error("请选择有效且不重复的页面");
    const next = {...collection,pages:orderedIds.map((id)=>collection.pages.find((entry)=>entry.id===id)!)};
    if (JSON.stringify(await readPageCollection(plugin,file))!==JSON.stringify(collection)) throw new Error("文档已在其他窗口更新，请重新打开后再操作");
    await plugin.app.vault.modifyBinary(file,collectionBytes(next));
    const meta=plugin.store.getDocMeta(file.path),remap=(state:any)=>({...state,foldedPages:state.foldedPages?.flatMap((page:number)=>{const entry=collection.pages[page-1],index=entry?collectionPageIndex(next,entry.id):0;return index?[index]:[];}),bookmarks:state.bookmarks?.flatMap((page:number)=>{const entry=collection.pages[page-1],index=entry?collectionPageIndex(next,entry.id):0;return index?[index]:[];})});
    const scoped=Object.fromEntries(Object.entries(meta.documentNotebookMeta??{}).map(([id,state])=>[id,remap(state)]));
    const main=remap(meta); plugin.store.updateDocMeta(file.path,{foldedPages:main.foldedPages,bookmarks:main.bookmarks,documentNotebookMeta:scoped});await plugin.store.flush();return next;
  } finally { locks.delete(file.path); }
}
export async function restorePageReferences(plugin: MarginStudyPlugin, file: TFile, expected: PageCollection, target: PageCollection, metadata: any): Promise<void> {
  if (locks.has(file.path)) throw new Error("此重组文档正在更新"); locks.add(file.path);
  try {
    if (JSON.stringify(await readPageCollection(plugin,file)) !== JSON.stringify(expected)) throw new Error("文档已在其他窗口更新，请重新打开后再操作");
    await validateSources(plugin,target);
    if (JSON.stringify(await readPageCollection(plugin,file)) !== JSON.stringify(expected)) throw new Error("文档已在其他窗口更新，请重新打开后再操作");
    await plugin.app.vault.modifyBinary(file,collectionBytes(target));
    const current=plugin.store.getDocMeta(file.path), scoped={...current.documentNotebookMeta};
    for(const [id,state] of Object.entries(metadata.documentNotebookMeta??{})) scoped[id]={...scoped[id],foldedPages:(state as any).foldedPages,bookmarks:(state as any).bookmarks,handwritingLayers:(state as any).handwritingLayers};
    for(const id of Object.keys(scoped)) if (!(id in (metadata.documentNotebookMeta??{}))) delete scoped[id];
    plugin.store.updateDocMeta(file.path,{foldedPages:metadata.foldedPages,bookmarks:metadata.bookmarks,handwritingLayers:metadata.handwritingLayers,documentNotebookMeta:Object.keys(scoped).length?scoped:undefined});await plugin.store.flush();
  } finally { locks.delete(file.path); }
}
export async function restorePageCollectionSnapshot(
  plugin: MarginStudyPlugin,
  file: TFile,
  expectedCollection: PageCollection,
  targetCollection: PageCollection,
  targetMeta: any,
  expectedAnnotations: Annotation[],
  targetAnnotations: Annotation[],
): Promise<void> {
  const currentAnnotations = await plugin.store.loadAnnotations(file.path);
  if (JSON.stringify(currentAnnotations) !== JSON.stringify(expectedAnnotations)) {
    throw new Error("文档批注已变化，页面撤销已取消");
  }
  await restorePageReferences(plugin, file, expectedCollection, targetCollection, targetMeta);
  plugin.store.saveAnnotationsDebounced(file.path, structuredClone(targetAnnotations));
  await plugin.store.flush();
}
export function parsePageRange(value: string, count: number): number[] {
  const result: number[] = []; for (const token of value.trim().split(/[,，\s]+/).filter(Boolean)) {
    const match = /^(\d+)(?:[-–—](\d+))?$/.exec(token); if (!match) throw new Error("页码示例：1-3, 5, 8");
    const from = Number(match[1]), to = Number(match[2] ?? match[1]); if (from < 1 || to < 1 || from > count || to > count || Math.abs(to-from) > 1000) throw new Error(`页码范围为 1–${count}`);
    for (let page=from; to>=from ? page<=to : page>=to; page+=to>=from?1:-1) if (!result.includes(page)) result.push(page);
  }
  if (!result.length) throw new Error("请填写要重组的页码"); return result;
}
export interface PageCollectionReader {
  getFilePath(): string | null; getDoc(): any; getDocumentNotebookId(): string;
  getPageReferences(pages: number[]): PageReferenceInput[]; refreshPageCollection(referenceId?: string, preserveEditHistory?: boolean): Promise<void>;
  recordExtendEdit(label: string, apply: (redo: boolean) => Promise<void>): void;
}
export async function appendPageReferencesInReader(plugin: MarginStudyPlugin, reader: PageCollectionReader, inputs: PageReferenceInput[]): Promise<void> {
  const path=reader.getFilePath(),file=path?plugin.app.vault.getAbstractFileByPath(path):null;
  if(!(file instanceof TFile)||!(reader.getDoc() instanceof PageCollectionDocument))throw new Error("请先打开目标重组文档");
  const before=await readPageCollection(plugin,file),beforeMeta=structuredClone(plugin.store.getDocMeta(file.path)),beforeAnnotations=structuredClone(await plugin.store.loadAnnotations(file.path));
  const after=await appendPageReferences(plugin,file,inputs),afterMeta=structuredClone(plugin.store.getDocMeta(file.path)),afterAnnotations=structuredClone(await plugin.store.loadAnnotations(file.path));
  await reader.refreshPageCollection(undefined,true);reader.recordExtendEdit("追加页面",async redo=>{
    if(reader.getFilePath()!==file.path)throw new Error("文档已切换，页面撤销已取消");
    const current=await plugin.store.loadAnnotations(file.path),expected=redo?beforeAnnotations:afterAnnotations;
    if(JSON.stringify(current)!==JSON.stringify(expected))throw new Error("文档批注已变化，页面撤销已取消");
    await restorePageReferences(plugin,file,redo?before:after,redo?after:before,redo?afterMeta:beforeMeta);
    plugin.store.saveAnnotationsDebounced(file.path,structuredClone(redo?afterAnnotations:beforeAnnotations));await plugin.store.flush();await reader.refreshPageCollection(undefined,true);
  });
}
export function openPageReorganization(plugin: MarginStudyPlugin, reader: PageCollectionReader): void {
  const doc = reader.getDoc(), path = reader.getFilePath(); if (!doc || !path) { new Notice("请先打开文档"); return; }
  const {modal,close} = createModal("书页重组"); modal.classList.add("ms-page-reorganization-modal");
  const range = el("input",{type:"text",value:`1-${doc.numPages}`,"aria-label":"重组页码"}), title = el("input",{type:"text",value:"重组文档","aria-label":"重组文档名称"});
  const target = el("select",{"aria-label":"追加到文档"}); target.append(el("option",{value:"",text:"新建文档"}));
  for (const record of plugin.store.documents) if (record.path.endsWith(".msref")) target.append(el("option",{value:record.path,text:record.path.split("/").pop()!}));
  const method = el("select",{"aria-label":"重组来源"}); method.append(el("option",{value:"toc",text:"按页面新建"}),el("option",{value:"selection",text:"保留摘录与标注"}));
  const status = el("div",{role:"status",class:"ms-notebook-status"}), fields = [["页面",range],["目标",target],["名称",title],["内容",method]] as const;
  for (const [label,input] of fields) {const row=el("label",{class:"ms-notebook-field"});row.append(el("span",{text:label}),input);modal.append(row);}
  target.addEventListener("change",()=>{title.disabled=!!target.value;method.disabled=!!target.value;});
  const actions=el("div",{class:"ms-modal-actions"}),cancel=el("button",{class:"ms-btn",text:"取消"}),save=el("button",{class:"ms-btn primary",text:"完成"});cancel.addEventListener("click",close);
  save.addEventListener("click",async()=>{save.disabled=true;try{const inputs=reader.getPageReferences(parsePageRange(range.value,doc.numPages));let file:TFile;
    if(target.value){const existing=plugin.app.vault.getAbstractFileByPath(target.value);if(!(existing instanceof TFile))throw new Error("目标文档已不存在");file=existing;
      const before=await readPageCollection(plugin,file),beforeMeta=structuredClone(plugin.store.getDocMeta(file.path)),beforeAnnotations=structuredClone(await plugin.store.loadAnnotations(file.path));
      const after=await appendPageReferences(plugin,file,inputs.map((entry)=>({...entry,annotations:"include"})));
      const afterMeta=structuredClone(plugin.store.getDocMeta(file.path)),afterAnnotations=structuredClone(await plugin.store.loadAnnotations(file.path));
      let destination:PageCollectionReader;
      if(file.path===path){destination=reader;await destination.refreshPageCollection(undefined,true);}
      else destination=await plugin.openDocument(file) as unknown as PageCollectionReader;
      destination.recordExtendEdit("追加页面",async redo=>{
        if(destination.getFilePath()!==file.path)throw new Error("文档已切换，页面撤销已取消");
        const expected=redo?beforeAnnotations:afterAnnotations,replacement=redo?afterAnnotations:beforeAnnotations,current=await plugin.store.loadAnnotations(file.path);
        if(JSON.stringify(current)!==JSON.stringify(expected))throw new Error("文档批注已变化，页面撤销已取消");
        await restorePageReferences(plugin,file,redo?before:after,redo?after:before,redo?afterMeta:beforeMeta);
        plugin.store.saveAnnotationsDebounced(file.path,structuredClone(replacement));await plugin.store.flush();await destination.refreshPageCollection(undefined,true);
      });close();return;
    }
    else file=await createPageCollection(plugin,{title:title.value,pages:inputs,origin:method.value as PageReferenceOrigin,annotations:method.value==="selection"?"include":"clean"});
    close();if(file.path!==path)await plugin.openDocument(file);
  }catch(error){status.textContent=(error as Error).message;save.disabled=false;}});actions.append(cancel,save);modal.append(status,actions);
  if(doc instanceof PageCollectionDocument) {
    const manage=el("button",{class:"ms-btn",text:"排列或移除页面"});manage.addEventListener("click",()=>{close();openCollectionPageOrder(plugin,reader,doc.pageCollection);});modal.append(manage);
  }
}
function openCollectionPageOrder(plugin: MarginStudyPlugin, reader: PageCollectionReader, collection: PageCollection): void {
  const {modal,close}=createModal("排列页面");modal.classList.add("ms-page-reorganization-modal");let pages=[...collection.pages];const list=el("div",{class:"ms-reference-page-list"}),status=el("div",{role:"status",class:"ms-notebook-status"});
  const render=()=>{clear(list);pages.forEach((entry,index)=>{const row=el("div",{class:"ms-reference-page-row",draggable:"true","data-reference-id":entry.id});row.append(el("span",{text:`${index+1}. ${entry.sourcePath.split("/").pop()} · ${entry.sourcePage}`}));
    for(const [label,change] of [["上移",-1],["下移",1],["移除",0]] as const){const button=el("button",{class:"ms-btn",text:label});button.disabled=pages.length===1&&change===0||(change===-1&&index===0)||(change===1&&index===pages.length-1);button.addEventListener("click",()=>{if(change===0)pages.splice(index,1);else [pages[index],pages[index+change]]=[pages[index+change],pages[index]];render();});row.append(button);}
    row.addEventListener("dragstart",event=>{event.dataTransfer?.setData("application/x-marginstudy-reference-order",entry.id);});row.addEventListener("dragover",event=>{if(event.dataTransfer?.types.includes("application/x-marginstudy-reference-order"))event.preventDefault();});row.addEventListener("drop",event=>{const id=event.dataTransfer?.getData("application/x-marginstudy-reference-order"),from=pages.findIndex(page=>page.id===id);if(from<0)return;event.preventDefault();const [moved]=pages.splice(from,1);pages.splice(index,0,moved);render();});list.append(row);});};render();
  const actions=el("div",{class:"ms-modal-actions"}),cancel=el("button",{class:"ms-btn",text:"取消"}),save=el("button",{class:"ms-btn primary",text:"保存"});cancel.addEventListener("click",close);save.addEventListener("click",async()=>{save.disabled=true;try{const file=plugin.app.vault.getAbstractFileByPath(reader.getFilePath()!);if(!(file instanceof TFile))throw new Error("文档已不存在");const before=await readPageCollection(plugin,file),beforeMeta=structuredClone(plugin.store.getDocMeta(file.path));const after=await reorderPageReferences(plugin,file,pages.map(entry=>entry.id)),afterMeta=structuredClone(plugin.store.getDocMeta(file.path));await reader.refreshPageCollection(undefined,true);if(JSON.stringify(before)!==JSON.stringify(after))reader.recordExtendEdit("重排页面",async redo=>{if(reader.getFilePath()!==file.path)throw new Error("文档已切换，页面撤销已取消");await restorePageReferences(plugin,file,redo?before:after,redo?after:before,redo?afterMeta:beforeMeta);await reader.refreshPageCollection(undefined,true);});close();}catch(error){status.textContent=(error as Error).message;save.disabled=false;}});actions.append(cancel,save);modal.append(list,status,actions);
}
