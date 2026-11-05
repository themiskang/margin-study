import { pdfImageRegions } from "./imageRegions";
import { orderTextColumns } from "./textColumns";
import { recognizeImage,mergeOcrWords } from "../ocr/ocr";
import type { OcrWord } from "../ocr/ocr";
import { getOutline } from "./outline";
import type { DocumentOutlineItem, HandwritingPresetId, HandwritingPresetSpec } from "../types";
import { exportExtendCard } from "./extendExport";
import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon, Menu, Platform } from "obsidian";
import type MarginStudyPlugin from "../main";
import type { HandwritingMode } from "../annot/penGeometry";
import type { ReaderEditHistoryState } from "../annot/baseController";
import { loadPdf, pdfjsLib } from "./pdfjs";
import { AnnotationController } from "./annotationLayer";
import { el, clear } from "../utils/dom";
import { createModal } from "../utils/modal";
import type { Annotation, DocMeta, PdfRect, PdfCrop, PdfPageEdits, PdfExtendMode, PdfExtendNote, Stroke } from "../types";
import { EditedPdfDocument, originalPdfPages, remapEditedPdfMetadata, validatePdfPageEdits, mapEditedPdfAnnotation } from "./editedDocument";
import { uid } from "../utils/id";
import { imagePagesPdf } from "./imagePages";
import { openPdfPageEditor } from "./pageEditor";
import { buildEditedPdf } from "./editedPdfExport";
import type { EditedPdfExportOptions } from "./editedPdfExport";
import { buildEditedPdfLongImage } from "./pdfLongImage";
import type { LongImageOptions, LongImageResult } from "./pdfLongImage";
import { openPdfExport } from "./pdfExportUi";
import { croppedPageViewport, fullPageCrop, readPageCrop, projectPagePoint } from "./pageCrop";
import { ExtendNotes, extendProjection } from "./extendNotes";
import { regionFoldBands, foldCoordinates, renderRegionFolds } from "./regionFolds";
import { extendDisplayPages, renderExtendThumbnail } from "./extendNavigation";
import { openPageCropEditor } from "./cropEditor";
import { clientRectToPdfRect, legacyRectToCssRect, pdfRectToCssRect, pdfRectsIntersect, unionCssRects } from "../anchors/pdfGeometry";
import type { CssRect, PdfViewport } from "../anchors/pdfGeometry";
import { NavigationHistory } from "../anchors/navigationHistory";
import { ReadingSpeechControls } from "../audio/speechControls";
import type { SpeechSection } from "../audio/speech";
import { readNotebookMetadata } from "../documents/notebookFormat";
import type { NotebookMetadata, NotebookStyle } from "../documents/notebookFormat";
import { renderNotebookControls, updateNotebook } from "../documents/notebook";
import { notebookMeta, updateNotebookMeta } from "../annot/documentNotebooks";
import { PageCollectionDocument, openPageCollectionDocument, openPageReorganization, collectionPageIndex, mapCollectionAnnotation } from "../documents/pageCollection";
import type { PageReferenceInput, PageReference } from "../documents/pageCollection";

export const VIEW_TYPE_READER = "margin-study-reader";

interface PageRecord {
  wrapper: HTMLElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLElement;
  annLayer: HTMLElement;
  imageRects?: import("../types").PdfRect[];
  renderedScale: number;
  renderTask: any | null;
  textTask: any | null;
  renderPromise: Promise<void> | null;
  renderingScale: number | null;
  revision: number;
  lastUsed: number;
  viewport: PdfViewport | null;
  baseViewport: any | null;
}

interface PdfReadingLocation { page: number; pageOffset: number; left: number; }
type PdfLayout = "single" | "spread";
interface PdfViewRestore { path: string; fitWidth?: boolean; scale?: number; layout?: PdfLayout; continuous?: boolean; position?: PdfReadingLocation; referenceId?: string; pdfPageId?: string; }
function restoredScale(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) && value >= 0.3 && value <= 4 ? Number(value.toFixed(3)) : undefined; }

const MAX_CACHED_PAGES = 6;
const MAX_CACHED_PIXELS = 32_000_000;
const MAX_PAGE_PIXELS = 16_000_000;

export class ReaderView extends ItemView {
  plugin: MarginStudyPlugin;
  private filePath: string | null = null;
  private loadedPath: string | null = null;
  private loadRevision = 0;
  private loadAbort: AbortController | null = null;
  private pendingLoad: { path: string; promise: Promise<void> } | null = null;
  private searchRevision = 0;
  private thumbTasks = new Set<any>();
  private doc: any = null;
  private scale = 1.4;
  private widthFitted = false;
  private fitRevision = 0;
  private fitPending = 0;
  private pages = new Map<number, PageRecord>();
  private pageSizes = new Map<number, { w: number; h: number }>();
  private originalPageSizes = new Map<number, { w: number; h: number }>();
  private crop: PdfCrop = { ...fullPageCrop };
  private cropRevision = 0;
  private cropEditorRevision = 0;
  private closeCropEditor: (() => void) | null = null;
  private stopCropSync: (() => void) | null = null;
  private applyingCrop = false;
  private applyingPageEdits = false;
  private exportingPdf = false;
  private closePdfExport: (() => void) | null = null;
  private syncingPageEdits = false;
  private closePageEditor: (() => void) | null = null;
  private pageChangeListeners = new Set<() => void>();
  private currentPageListeners = new Set<() => void>();
  private readingStateListeners = new Set<() => void>();
  private observer: IntersectionObserver | null = null;
  private thumbObserver: IntersectionObserver | null = null;
  // 书页折叠 / 书签（MN4 风格）
  private folded = new Set<number>();
  private bookmarked = new Set<number>();
  private thumbPanel: HTMLElement | null = null;
  private scrollEl!: HTMLElement;
  private toolbarEl!: HTMLElement;
  private pageInfoEl!: HTMLElement;
  private scaleEl!: HTMLElement;
  private annController!: AnnotationController;
  private currentPage = 1;
  private visiblePages = new Set<number>();
  // 文档内搜索（体验增强 N）
  private pageTextCache = new Map<number, string>();
  private recognizedPages = new Map<number, OcrWord[]>();
  private ocrRequest = 0;
  private searchTerm = "";
  private searchHits: { page: number; start: number; end: number }[] = [];
  private searchIdx = 0;
  private searchBoxEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private searchCountEl: HTMLElement | null = null;
  private searchDebounce: number | null = null;
  private destroyed = false;
  private navigationRevision = 0;
  private navigationPage: number | null = null;
  // A restored last page can be visible below an earlier page when scrolling is
  // clamped at the document end. Keep its identity until the viewport moves.
  private locationAnchor: {page:number;top:number;left:number;width:number;height:number;location:PdfReadingLocation} | null = null;
  private navigationHistory = new NavigationHistory<PdfReadingLocation>((first, second) =>
    first.page === second.page && Math.abs(first.pageOffset - second.pageOffset) < 0.002 && Math.abs(first.left - second.left) < 2);
  private historyBackEl: HTMLButtonElement | null = null;
  private historyForwardEl: HTMLButtonElement | null = null;
  private recallCoverAll = true;
  private recallScopeEl: HTMLButtonElement | null = null;
  private layout: PdfLayout = "single";
  private continuous = true;
  private pageRows = new Map<number, HTMLElement>();
  private restoredState: PdfViewRestore | null = null;
  private lastLocation: PdfReadingLocation = { page: 1, pageOffset: 0, left: 0 };
  private pendingLocation: PdfReadingLocation | null = null;
  private positionObserver: ResizeObserver | null = null;
  private layoutSelect: HTMLSelectElement | null = null;
  private continuousSelect: HTMLSelectElement | null = null;
  private pageTotalEl: HTMLElement | null = null;
  private prevPageEl: HTMLButtonElement | null = null;
  private nextPageEl: HTMLButtonElement | null = null;
  private savePositionTimer: number | null = null;
  private speech: ReadingSpeechControls | null = null;
  private notebook: NotebookMetadata | null = null;
  private notebookTools: HTMLElement | null = null;
  private workspaceChrome = false;
  private extendNotes = new ExtendNotes(this);

  constructor(leaf: WorkspaceLeaf, plugin: MarginStudyPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_READER;
  }
  getDisplayText(): string {
    return this.filePath ? `📖 ${this.filePath.split("/").pop()}` : "MarginStudy 阅读器";
  }
  getIcon(): string {
    return "book-open";
  }

  /** The workspace owns the common top bar; the original controls remain callable. */
  getReaderToolbar(): HTMLElement { return this.toolbarEl; }
  setWorkspaceChrome(enabled: boolean): void {
    this.workspaceChrome = enabled;
    const root = this.containerEl.children[1] as HTMLElement | undefined;
    root?.classList.toggle("ms-reader-native-chrome", enabled);
    if (this.searchBoxEl && root) {
      this.searchBoxEl.classList.toggle("ms-native-reader-search", enabled);
      (enabled ? root : this.toolbarEl).append(this.searchBoxEl);
    }
  }
  openHandwritingSettings(anchor?: HTMLElement): void { this.annController.openHandwritingSettings(anchor); }
  getContinuousExcerpt(): {active:boolean;count:number} { return this.annController.getContinuousExcerpt(); }
  setContinuousExcerpt(on:boolean): void { this.annController.setContinuousExcerpt(on); }
  setContinuousExcerptPen(key:string):void { this.annController.setContinuousExcerptPen(key); }
  continueExcerptInCard(cardId:string):boolean { return this.annController.continueExcerptInCard(cardId); }
  setContinuousExcerptListener(listener:(()=>void)|null):void { this.annController.setContinuousExcerptListener(listener); }
  getTitleLinksEnabled(): boolean { return this.annController.getTitleLinksEnabled(); }
  setTitleLinksEnabled(on: boolean): void { this.annController.setTitleLinksEnabled(on); }
  getRecallMode(): boolean { return !!(this.containerEl.children[1] as HTMLElement | undefined)?.classList.contains("ms-recall"); }
  setRecallMode(on: boolean): void { this.annController.setRecallMode(on); }
  clearRecallReveals(): void { this.annController.clearRecallReveals(); }
  getRecallCoverAll(): boolean { return this.recallCoverAll; }
  setRecallCoverAll(on: boolean): void { this.recallCoverAll = on; this.annController.setRecallCoverAll(on); this.syncRecallScopeButton(); }
  getRecallHierarchy(): number { return this.annController.getRecallHierarchy(); }
  setRecallHierarchy(level: number): void { this.annController.setRecallHierarchy(level); }
  getRecallAiHint(): boolean { return this.annController.getRecallAiHint(); }
  setRecallAiHint(on: boolean): void { this.annController.setRecallAiHint(on); }
  getRecallHintLanguage(): "auto" | "zh" | "en" { return this.annController.getRecallHintLanguage(); }
  setRecallHintLanguage(language: "auto" | "zh" | "en"): void { this.annController.setRecallHintLanguage(language); }
  setRecallHintProvider(provider?: (request: import("../types").RecallHintRequest) => Promise<import("../types").RecallHintResult>): void { this.annController.setRecallHintProvider(provider); }
  getRecallSetting(key: import("../types").RecallOptionKey): boolean { return this.annController.getRecallSetting(key); }
  setRecallSetting(key: import("../types").RecallOptionKey, on: boolean): void { this.annController.setRecallSetting(key, on); }
  getHandwritingColor(): string { return this.annController.getInkColor(); }
  getHandwritingMode(): HandwritingMode { return this.annController.getHandwritingMode(); }
  getActiveHandwritingPreset(): HandwritingPresetId { return this.annController.getActiveHandwritingPreset(); }
  refreshSceneSettings(): void { this.annController.refreshSceneSettings();const tools=this.toolbarEl?.querySelector<HTMLElement>(".ms-tb-ann");if(tools)this.annController.buildToolbar(tools); }
  getHandwritingPreset(): HandwritingPresetSpec { return this.annController.getHandwritingPreset(); }
  openHandwritingPresets(anchor?: HTMLElement): void { this.annController.openHandwritingPresets(anchor); }
  setActiveHandwritingPreset(preset: HandwritingPresetId): void { this.annController.setActiveHandwritingPreset(preset); }
  getBlockSelectionMode():boolean { return this.annController.getBlockSelectionMode(); }
  setBlockSelectionMode(on:boolean):void { this.annController.setBlockSelectionMode(on); }
  setAutomaticTextExcerpt(on:boolean):void { this.annController.setAutomaticTextExcerpt(on); }
  setRegionMode(on:boolean):void { this.annController.setRegionMode(on); }
  setHandwritingMode(mode: HandwritingMode): void { this.annController.setHandwritingMode(mode); }
  subscribeHandwritingModeChange(listener: (mode: HandwritingMode) => void): () => void { return this.annController.subscribeHandwritingModeChange(listener); }
  getHandwritingSyncPreference(): boolean { return this.annController.getHandwritingSyncPreference(); }
  setHandwritingSyncAvailable(available: boolean): void { this.annController.setHandwritingSyncAvailable(available); }
  setHandwritingSyncPreference(enabled: boolean): void { this.annController.setHandwritingSyncPreference(enabled); }
  subscribeHandwritingSyncPreference(listener: (enabled: boolean) => void): () => void { return this.annController.subscribeHandwritingSyncPreference(listener); }
  openDocumentNotebooks(): void { if(this.extendNotes.hasEditor())void this.finishExtendEditing().then(()=>this.annController.openDocumentNotebooks());else this.annController.openDocumentNotebooks(); }
  async selectDocumentNotebook(id: string): Promise<void> { await this.finishExtendEditing(); this.annController.selectDocumentNotebook(id); await this.extendNotes.sync(); }
  createDocumentNotebook(name: string): boolean { return this.annController.createDocumentNotebook(name); }
  getDocumentNotebookId(): string { return this.annController.getDocumentNotebookId(); }
  beginTextAnnotation(): void { this.annController.beginTextAnnotation(); }
  placeExtendText(event: MouseEvent): boolean { return this.extendNotes.placeText(event); }
  insertImageAnnotation(file: File): Promise<void> { return this.annController.insertImageAnnotation(file); }
  undoOverlayChange(): void { this.annController.undoOverlayChange(); }
  redoOverlayChange(): void { this.annController.redoOverlayChange(); }
  getEditHistoryState(): ReaderEditHistoryState { return this.annController.getEditHistoryState(); }
  undoLastEdit(): void | Promise<void> { return this.extendNotes.hasEditor() ? this.finishExtendEditing().then(() => this.annController.undoLastEdit()) : this.annController.undoLastEdit(); }
  redoLastEdit(): void | Promise<void> { return this.extendNotes.hasEditor() ? this.finishExtendEditing().then(() => this.annController.redoLastEdit()) : this.annController.redoLastEdit(); }
  subscribeEditHistory(listener: (state: ReaderEditHistoryState) => void): () => void { return this.annController.subscribeEditHistory(listener); }
  beginExtend(): void { if (this.getPdfPageEdits()) this.extendNotes.begin(); }
  stopExtend(): void { this.extendNotes.stop(); }
  getExtendMode(): PdfExtendMode { return this.extendNotes.mode(); }
  getMarginCommentArea(): boolean { return this.extendNotes.marginVisible(); }
  setMarginCommentArea(visible: boolean): Promise<void> { return this.extendNotes.setMarginVisible(visible); }
  getPageBaseSize(page:number):{width:number;height:number} {
    const original=this.originalPageSizes.get(page),base=this.getPageRecord(page)?.baseViewport;
    if(base)return{width:base.width/this.scale,height:base.height/this.scale};
    const rotated=this.getPdfPageRotation(page)%180!==0,w=(original?.w??600)*(this.crop.right-this.crop.left),h=(original?.h??800)*(this.crop.bottom-this.crop.top);
    return{width:rotated?h:w,height:rotated?w:h};
  }
  getExtendGaps(page:number,base:{width:number;height:number}) { return this.extendNotes.gaps(page,base,1); }
  getDisplayPages() { return extendDisplayPages(this); }
  getCurrentDisplayPage():number {
    const location=this.captureLocation(),entries=this.getDisplayPages().filter(entry=>entry.page===location.page),height=this.pageSizes.get(location.page)?.h??1,y=Math.max(0,location.pageOffset*height);
    return [...entries].reverse().find(entry=>entry.top<=y+1)?.number??entries[0]?.number??1;
  }
  async gotoDisplayPage(number:number):Promise<void>{
    const entry=this.getDisplayPages().find(entry=>entry.number===number);if(!entry)return;
    await this.navigateToReference(entry.page,[]);const rec=this.getPageRecord(entry.page);if(!rec)return;
    const bounds=rec.wrapper.getBoundingClientRect(),scroll=this.scrollEl.getBoundingClientRect();this.scrollEl.scrollTop+=bounds.top-scroll.top+entry.top*this.scale;
    this.saveReadingPosition();this.syncDisplayPageControls();
  }
  renderDisplayThumbnail(number:number,canvas:HTMLCanvasElement):Promise<void>{return renderExtendThumbnail(this,number,canvas);}
  getExtendNotes(): PdfExtendNote[] { return this.extendNotes.notes(); }
  setExtendMode(mode: PdfExtendMode): Promise<void> { return this.extendNotes.setMode(mode); }
  createExtend(page: number, anchor: { x: number; y: number }): Promise<string> { return this.extendNotes.create(page, anchor); }
  createLinkedExtend(page: number, anchor: {x:number;y:number}, sourceAnnId: string): Promise<string> { return this.extendNotes.create(page, anchor, sourceAnnId); }
  extendAnnotation(id: string): Promise<void> { return this.annController.extendAnnotation(id); }
  hasExtendSource(id: string): boolean { return this.annController.hasExtendSource(id); }
  addExtendSourceToMindmap(id: string): void { this.annController.addExtendSourceToMindmap(id); }
  ensureExtendSourceCard(id: string) { return this.annController.ensureExtendSourceCard(id); }
  createRegionExtend(page: number, rect: DOMRect): Promise<void> { return this.annController.createRegionExtend(page,rect); }
  updateExtend(id: string, patch: Partial<Pick<PdfExtendNote, "anchor" | "height" | "text" | "runs" | "collapsed" | "ink" | "color" | "tags" | "images">>): Promise<void> { return this.extendNotes.update(id, patch); }
  removeExtend(id: string): Promise<void> { return this.extendNotes.remove(id); }
  exportExtendCard(id: string, format: "pdf"|"png"): Promise<Uint8Array> { return exportExtendCard(this,id,format); }
  addExtendToMindmap(id: string): Promise<void> { return this.extendNotes.addToMindmap(id); }
  finishExtendEditing(): Promise<void> { return this.extendNotes.finish(); }
  insertExtendImages(id: string, files: File[], signal?: AbortSignal): Promise<void> { return this.extendNotes.insertImages(id,files,signal); }
  recordExtendEdit(label: string, apply: (redo: boolean) => Promise<void>): void { this.annController.recordDocumentEdit(label, apply); }
  async foldSelection(parts: {page:number;rects:PdfRect[]}[]): Promise<void> {
    const path = this.loadedPath; if (!path || this.filePath !== path) return;
    const before = structuredClone(notebookMeta(this.plugin.store.getDocMeta(path)).pdfRegionFolds);
    const added = parts.flatMap(part => {
      const pageId = this.getPdfPageId(part.page);
      return pageId && part.rects.length ? [{id:uid("fold"),pageId,rects:structuredClone(part.rects)}] : [];
    });
    if (!added.length) return;
    await this.commitRegionFolds(before, [...(before ?? []),...added], "折叠选区");
  }
  async expandRegionFolds(ids: string[]): Promise<void> {
    const path = this.loadedPath; if (!path) return;
    const before = structuredClone(notebookMeta(this.plugin.store.getDocMeta(path)).pdfRegionFolds);
    if (!before?.some(item => ids.includes(item.id))) return;
    const next = before.filter(item => !ids.includes(item.id));
    await this.commitRegionFolds(before,next.length ? next : undefined,"展开折叠区域");
  }
  private async commitRegionFolds(before:DocMeta["pdfRegionFolds"], next:DocMeta["pdfRegionFolds"], label:string):Promise<void> {
    const path=this.loadedPath,notebook=this.getDocumentNotebookId(); if(!path)return;
    const apply=async(value:DocMeta["pdfRegionFolds"],expected:DocMeta["pdfRegionFolds"])=>{
      if(this.destroyed||this.loadedPath!==path||this.filePath!==path||this.getDocumentNotebookId()!==notebook) return;
      if(JSON.stringify(notebookMeta(this.plugin.store.getDocMeta(path),notebook).pdfRegionFolds)!==JSON.stringify(expected)) throw new Error("折叠区域已变化，请重新操作");
      updateNotebookMeta(this.plugin,path,{pdfRegionFolds:structuredClone(value)},notebook);await this.extendNotes.sync();
    };
    const task=apply(next,before);this.recordExtendEdit(label,redo=>apply(redo?next:before,redo?before:next));await task;
  }
  projectAnnotationPoint<T extends {x:number;y:number}>(page: number, point: T, inverse = false): T { return this.extendNotes.projectPoint(page, point, inverse); }
  projectAnnotationInk(page: number, strokes: Stroke[][], inverse = false): Stroke[][] { return this.extendNotes.projectInk(page, strokes, inverse); }
  async refreshExtendLayout(): Promise<void> {
    if (!this.doc || !this.loadedPath || this.destroyed || !this.pages.size) return;
    const path = this.loadedPath, revision = this.loadRevision, location = this.captureLocation(), mode = this.getHandwritingMode(), fitted = this.widthFitted;
    this.setHandwritingMode("off");
    for (const [page, rec] of this.pages) {
      const base = rec.baseViewport, original = this.originalPageSizes.get(page);
      const rotated = this.getPdfPageRotation(page) % 180 !== 0;
      const rawW = (original?.w ?? 600) * (this.crop.right - this.crop.left), rawH = (original?.h ?? 800) * (this.crop.bottom - this.crop.top);
      const width = base?.width ?? (rotated ? rawH : rawW) * this.scale, height = base?.height ?? (rotated ? rawW : rawH) * this.scale;
      const expanded = foldCoordinates(regionFoldBands(this,page,base ?? {width,height})).down(height) + this.extendNotes.gaps(page, base ?? {width,height}).reduce((sum,gap)=>sum+gap.height,0);
      this.releasePage(page, rec); this.pageSizes.set(page,{w:width/this.scale,h:expanded/this.scale});
      rec.wrapper.style.width = `${Math.floor(width)}px`; rec.wrapper.style.height = `${Math.floor(expanded)}px`;
    }
    await this.restoreHistoryLocation(location, false);
    if (this.destroyed || this.loadedPath !== path || this.loadRevision !== revision) return;
    this.setHandwritingMode(mode); if (fitted) { await this.fitWidth(); await this.renderPageUnit(location.page); } for (const listener of this.pageChangeListeners) listener();
    this.thumbObserver?.disconnect();this.thumbPanel?.replaceChildren();this.syncDisplayPageControls();
  }
  openPageReorganization(): void { openPageReorganization(this.plugin,this); }
  openPdfPageEditor(): void {
    if (!this.getPdfPageEdits()) return;
    this.closeCropEditor?.(); this.closePageEditor?.(); this.closePageEditor = openPdfPageEditor(this);
  }
  getPdfPageEdits(): PdfPageEdits | null {
    if (!this.doc || !this.loadedPath?.toLowerCase().endsWith(".pdf")) return null;
    return this.doc instanceof EditedPdfDocument ? structuredClone(this.doc.edits) : originalPdfPages(this.doc.numPages);
  }
  async exportEditedPdf(options: EditedPdfExportOptions = {}): Promise<Uint8Array> {
    await this.finishExtendEditing();
    const edits = this.getPdfPageEdits(), document = this.doc, path = this.loadedPath, revision = this.loadRevision;
    if (!edits || !path || this.destroyed || this.pendingLoad || this.applyingPageEdits) throw new Error("请等待 PDF 加载完成");
    if (this.exportingPdf) throw new Error("PDF 正在导出，请稍后重试");
    const crop = JSON.stringify(this.crop), pages = JSON.stringify(edits), notes = JSON.stringify(this.getExtendNotes()), notebook=this.getDocumentNotebookId(), outline=JSON.stringify(this.plugin.store.getDocMeta(path).documentOutline);
    const current = () => {
      if (options.signal?.aborted || this.destroyed || this.doc !== document || this.loadedPath !== path || this.filePath !== path || this.loadRevision !== revision
        || JSON.stringify(this.getPdfPageEdits()) !== pages || JSON.stringify(this.crop) !== crop || JSON.stringify(this.getExtendNotes())!==notes || this.getDocumentNotebookId()!==notebook || JSON.stringify(this.plugin.store.getDocMeta(path).documentOutline)!==outline) throw new Error("导出已取消：文档或页面发生变化");
    };
    current(); this.exportingPdf = true;
    try { return await buildEditedPdf(this,edits,options,current); }
    finally { this.exportingPdf = false; }
  }
  async exportEditedPdfLongImage(options: LongImageOptions = {}): Promise<LongImageResult> {
    await this.finishExtendEditing();
    const edits = this.getPdfPageEdits(), document = this.doc, path = this.loadedPath, revision = this.loadRevision;
    if (!edits || !path || this.destroyed || this.pendingLoad || this.applyingPageEdits) throw new Error("请等待 PDF 加载完成");
    if (this.exportingPdf) throw new Error("PDF 正在导出，请稍后重试");
    const crop = JSON.stringify(this.crop), pages = JSON.stringify(edits), notes = JSON.stringify(this.getExtendNotes()), notebook=this.getDocumentNotebookId(), outline=JSON.stringify(this.plugin.store.getDocMeta(path).documentOutline);
    const current = () => {
      if (options.signal?.aborted || this.destroyed || this.doc !== document || this.loadedPath !== path || this.filePath !== path || this.loadRevision !== revision
        || JSON.stringify(this.getPdfPageEdits()) !== pages || JSON.stringify(this.crop) !== crop || JSON.stringify(this.getExtendNotes())!==notes || this.getDocumentNotebookId()!==notebook || JSON.stringify(this.plugin.store.getDocMeta(path).documentOutline)!==outline) throw new Error("导出已取消：文档或页面发生变化");
    };
    current(); this.exportingPdf = true;
    try { return await buildEditedPdfLongImage(this,edits,options,current); }
    finally { this.exportingPdf = false; }
  }
  getPdfExportAnnotations(): import("./exportAnnotations").PdfExportAnnotation[] { return this.annController.getPdfExportAnnotations(); }
  openPdfExport(): void { if(!this.getPdfPageEdits())return;this.closePdfExport?.();this.closePdfExport=openPdfExport(this); }
  getPdfPageId(page: number): string | undefined { return this.doc instanceof EditedPdfDocument ? this.doc.edits.pages[page - 1]?.id : this.doc && this.loadedPath?.toLowerCase().endsWith(".pdf") && page > 0 && page <= this.doc.numPages ? `source:${page}` : undefined; }
  getPdfPageRotation(page: number): number { return this.doc instanceof EditedPdfDocument ? this.doc.edits.pages[page - 1]?.rotation ?? 0 : 0; }
  getDisplayAnnotation(annotation: Annotation): Annotation { return this.doc instanceof EditedPdfDocument ? mapEditedPdfAnnotation(annotation,this.doc.edits) : this.doc instanceof PageCollectionDocument ? mapCollectionAnnotation(annotation,this.doc.pageCollection) : annotation; }
  subscribePageChanges(listener: () => void): () => void { this.pageChangeListeners.add(listener); return () => this.pageChangeListeners.delete(listener); }
  subscribeCurrentPageChange(listener: () => void): () => void { this.currentPageListeners.add(listener); return () => this.currentPageListeners.delete(listener); }
  /** The workspace keeps a recovery copy independently of Obsidian's saved layout. */
  subscribeReadingStateChange(listener: () => void): () => void {
    this.readingStateListeners.add(listener); return () => this.readingStateListeners.delete(listener);
  }
  private saveReadingState(): void {
    if (this.destroyed) return;
    for (const listener of this.readingStateListeners) listener();
    this.app.workspace.requestSaveLayout();
  }
  gotoSourcePage(sourcePage: number): void {
    const page = this.doc instanceof EditedPdfDocument ? this.doc.edits.pages.findIndex(entry => entry.sourcePage === sourcePage) + 1 : sourcePage;
    if (page < 1) { new Notice("来源页面已移除；原 PDF 和批注仍保留"); return; } this.gotoPage(page);
  }
  async rotatePdfPage(page: number): Promise<void> {
    const edits = this.getPdfPageEdits(); if (!edits || !Number.isInteger(page) || !edits.pages[page - 1]) throw new Error("PDF 页码超出范围");
    const next = structuredClone(edits), entry = next.pages[page - 1]; entry.rotation = ((entry.rotation ?? 0) + 90) % 360 as 0 | 90 | 180 | 270;
    await this.applyPdfPageEdits(edits, next, entry.id, "旋转页面");
  }
  async insertBlankPage(afterPage: number): Promise<void> {
    const edits = this.getPdfPageEdits(); if (!edits) throw new Error("请先打开 PDF");
    if (!Number.isInteger(afterPage) || afterPage < 1 || afterPage > edits.pages.length) throw new Error("PDF 页码超出范围");
    const document = this.doc, path = this.loadedPath;
    const source = await document.getPage(afterPage), size = source.getViewport({ scale: 1 });
    if (this.doc !== document || this.loadedPath !== path || this.destroyed) throw new Error("文档已切换，插页已取消");
    const next = structuredClone(edits), entry = { id: `blank:${uid("page")}`, width: size.width, height: size.height };
    next.pages.splice(afterPage, 0, entry); await this.applyPdfPageEdits(edits, next, entry.id, "插入空白页");
  }
  /** Decode images before committing any library asset or page metadata. */
  async insertImagePages(afterPage: number, files: File[]): Promise<void> {
    const previous = this.getPdfPageEdits(), document = this.doc, path = this.loadedPath;
    if (!previous || !path || !Number.isInteger(afterPage) || afterPage < 1 || afterPage > previous.pages.length) throw new Error("PDF 页码超出范围");
    const current = () => {
      if (this.destroyed || this.doc !== document || this.loadedPath !== path || this.filePath !== path || JSON.stringify(this.getPdfPageEdits()) !== JSON.stringify(previous)) throw new Error("文档或页面已切换，插页已取消");
    };
    const pdf = await imagePagesPdf(files,current); current();
    await this.insertPdfPages(afterPage,pdf,files.map((_,index)=>index+1));
  }

  /** Copy selected source sheets; subsequent changes to the picked file cannot alter this document. */
  async insertPdfPages(afterPage: number, file: File, selectedPages: number[]): Promise<void> {
    const previous = this.getPdfPageEdits(), document = this.doc, path = this.loadedPath, signal = this.loadAbort?.signal;
    if (!previous || !path) throw new Error("请先打开 PDF");
    if (!Number.isInteger(afterPage) || afterPage < 1 || afterPage > previous.pages.length) throw new Error("PDF 页码超出范围");
    if (!/\.pdf$/i.test(file.name)) throw new Error("请选择 PDF 文件");
    const current = () => {
      if (this.destroyed || this.doc !== document || this.loadedPath !== path || this.filePath !== path || signal?.aborted) throw new Error("文档已切换，插页已取消");
      if (JSON.stringify(this.getPdfPageEdits()) !== JSON.stringify(previous)) throw new Error("页面已在其他窗口更新，请重新操作");
    };
    const bytes = await file.arrayBuffer(); current();
    const imported = await loadPdf(bytes.slice(0),signal);
    const pages = [...new Set(selectedPages)].sort((a,b)=>a-b), entries: PdfPageEdits["pages"] = [];
    const assetPath = `MarginStudyImports/page-assets/${uid("pdf")}.pdf`;
    try {
      if (!pages.length || previous.pages.length + pages.length > 10000 || pages.some(page=>!Number.isInteger(page) || page < 1 || page > imported.numPages)) throw new Error("请选择有效的 PDF 页面");
      for (const page of pages) {
        const source = await imported.getPage(page), size = source.getViewport({scale:1}); current();
        entries.push({id:`import:${uid("page")}`,imported:{path:assetPath,page},width:size.width,height:size.height});
      }
    } finally { await imported.destroy(); }
    current();
    for (const folder of ["MarginStudyImports","MarginStudyImports/page-assets"]) {
      if (!await this.app.vault.adapter.exists(folder)) {
        try { await this.app.vault.createFolder(folder); }
        catch (error) { if (!await this.app.vault.adapter.exists(folder)) throw error; }
      }
      current();
    }
    const asset = await this.app.vault.createBinary(assetPath,bytes);
    try {
      current(); const next = structuredClone(previous); next.pages.splice(afterPage,0,...entries);
      await this.applyPdfPageEdits(previous,next,entries[0].id,"插入页面");
    } catch (error) {
      // Only discard an uncommitted copy. A saved edit must always keep its source asset.
      if (!this.plugin.store.getDocMeta(path).pdfPageEdits?.pages.some(page=>page.imported?.path === assetPath)) {
        try { await this.app.vault.trash(asset,true); } catch { /* preserve a recoverable copy if trash is unavailable */ }
      }
      throw error;
    }
  }
  async movePdfPage(page: number, target: number): Promise<void> {
    const edits = this.getPdfPageEdits(); if (!edits) throw new Error("请先打开 PDF");
    if (![page, target].every(number => Number.isInteger(number) && number > 0 && number <= edits.pages.length)) throw new Error("PDF 页码超出范围");
    if (page === target) return;
    const next = structuredClone(edits), [entry] = next.pages.splice(page - 1, 1); next.pages.splice(target - 1, 0, entry);
    await this.applyPdfPageEdits(edits, next, entry.id, "移动页面");
  }
  async removePdfPage(page: number): Promise<void> {
    const edits = this.getPdfPageEdits(); if (!edits) throw new Error("请先打开 PDF");
    if (!Number.isInteger(page) || page <= 1 || page > edits.pages.length) throw new Error("第一页不能移除");
    const next = structuredClone(edits); next.pages.splice(page - 1, 1);
    await this.applyPdfPageEdits(edits, next, next.pages[Math.min(page - 1, next.pages.length - 1)].id, "移除页面");
  }
  private async applyPdfPageEdits(previous: PdfPageEdits, next: PdfPageEdits, selectedId: string, label?: string, restored?: DocMeta): Promise<void> {
    const path = this.loadedPath, document = this.doc;
    if (!path || !document || this.destroyed || this.applyingPageEdits || this.pendingLoad || this.filePath !== path) throw new Error("页面正在更新，请稍后重试");
    if (JSON.stringify(this.getPdfPageEdits()) !== JSON.stringify(previous)) throw new Error("页面已在其他窗口更新，请重新操作");
    validatePdfPageEdits(next, document instanceof EditedPdfDocument ? document.source.numPages : document.numPages);
    const mode = this.getHandwritingMode(); this.applyingPageEdits = true;
    try {
      this.closeCropEditor?.(); this.setHandwritingMode("off");
      const meta = this.plugin.store.getDocMeta(path), beforeMeta = structuredClone(meta);
      const beforeId = previous.pages[this.captureLocation().page - 1]?.id ?? previous.pages[0].id;
      if (JSON.stringify(meta.pdfPageEdits ?? originalPdfPages(document instanceof EditedPdfDocument ? document.source.numPages : document.numPages)) !== JSON.stringify(previous)) throw new Error("页面已在其他窗口更新，请重新操作");
      const page = next.pages.findIndex(entry => entry.id === selectedId) + 1;
      this.restoredState = { path, scale: this.scale, fitWidth:this.widthFitted, layout: this.layout, continuous: this.continuous, pdfPageId: selectedId, position: { page: page || 1, pageOffset: 0, left: 0 } };
      this.plugin.store.updateDocMeta(path, { ...remapEditedPdfMetadata(meta, previous, next, restored), pdfPageEdits: next });
      await this.plugin.store.flush();
      if (this.destroyed || this.loadedPath !== path || this.doc !== document) return;
      await this.loadFileByPath(path, true, true); this.setHandwritingMode(mode); this.saveReadingState();
      if (label && !this.destroyed && this.loadedPath === path && this.filePath === path && JSON.stringify(this.getPdfPageEdits()) === JSON.stringify(next)) {
        let undoMeta = beforeMeta, redoMeta = structuredClone(this.plugin.store.getDocMeta(path));
        this.annController.recordDocumentEdit(label, async redo => {
          if (this.destroyed || this.loadedPath !== path || this.filePath !== path) throw new Error("文档已切换，页面撤销已取消");
          const activeDocument = this.doc, revision = this.loadRevision, target = redo ? next : previous;
          const current = () => { if (this.destroyed || this.loadedPath !== path || this.filePath !== path || this.doc !== activeDocument || this.loadRevision !== revision) throw new Error("文档已切换，页面撤销已取消"); };
          // Validate returning assets before committing metadata or releasing the usable paper.
          const imports = new Map<string, number[]>();
          for (const page of target.pages) if (page.imported) imports.set(page.imported.path,[...(imports.get(page.imported.path) ?? []),page.imported.page]);
          for (const [assetPath, numbers] of imports) {
            const asset = this.app.vault.getAbstractFileByPath(assetPath);
            if (!(asset instanceof TFile)) throw new Error(`插页源文件缺失，无法恢复：${assetPath}`);
            const bytes = await this.app.vault.readBinary(asset); current();
            const imported = await loadPdf(bytes,this.loadAbort?.signal);
            try { for (const number of new Set(numbers)) { await imported.getPage(number); current(); } }
            finally { await imported.destroy(); }
          }
          current();
          const snapshot = structuredClone(this.plugin.store.getDocMeta(path));
          await this.applyPdfPageEdits(redo ? previous : next, redo ? next : previous, redo ? selectedId : beforeId, undefined, redo ? redoMeta : undoMeta);
          if (redo) undoMeta = snapshot; else redoMeta = snapshot;
        });
      }
    } finally { this.applyingPageEdits = false; this.syncPdfPageEdits(); }
  }
  private syncPdfPageEdits(): void {
    if (this.destroyed || this.applyingPageEdits || this.syncingPageEdits || this.pendingLoad || !this.loadedPath || !this.doc) return;
    const previous = this.getPdfPageEdits(); if (!previous) return;
    const incoming = this.plugin.store.getDocMeta(this.loadedPath).pdfPageEdits;
    const sourceCount = this.doc instanceof EditedPdfDocument ? this.doc.source.numPages : this.doc.numPages;
    if (JSON.stringify(previous) === JSON.stringify(incoming ?? originalPdfPages(sourceCount))) return;
    const path = this.loadedPath, location = this.captureLocation(), id = previous.pages[location.page - 1]?.id;
    const page = incoming?.pages.findIndex(entry => entry.id === id) ?? location.page - 1;
    this.closePageEditor?.(); this.closePageEditor = null;
    this.restoredState = {path,scale:this.scale,fitWidth:this.widthFitted,layout:this.layout,continuous:this.continuous,pdfPageId:id,position:{...location,page:page < 0 ? Math.min(location.page,incoming?.pages.length ?? sourceCount) : page+1}};
    this.syncingPageEdits = true;
    void this.loadFileByPath(path,true).finally(() => { this.syncingPageEdits = false; });
  }
  getPageCrop(): PdfCrop { return { ...this.crop }; }
  getPageViewport(page: any, scale: number): any { return croppedPageViewport(page, scale, this.crop); }
  async openCrop(): Promise<void> {
    if (!this.doc || this.destroyed) return;
    this.closePageEditor?.(); this.closePageEditor = null;
    this.closeCropEditor?.();
    const revision = ++this.cropEditorRevision, doc = this.doc;
    const page = await doc.getPage(this.captureLocation().page);
    if (this.destroyed || doc !== this.doc || revision !== this.cropEditorRevision) return;
    const editor = openPageCropEditor(this, page, () => { if (revision === this.cropEditorRevision) this.closeCropEditor = null; });
    this.closeCropEditor = editor.close; await editor.ready;
  }
  async setPageCrop(value: PdfCrop): Promise<void> {
    await this.applyPageCrop(readPageCrop(value), true);
  }
  private syncPageCrop(): void {
    if (this.destroyed || this.applyingCrop || !this.loadedPath || !this.doc) return;
    const crop = readPageCrop(this.plugin.store.getDocMeta(this.loadedPath).pdfCrop);
    if (JSON.stringify(crop) === JSON.stringify(this.crop)) return;
    this.closeCropEditor?.();
    void this.applyPageCrop(crop, false).catch(error => console.error("MarginStudy crop sync:", error));
  }
  private async applyPageCrop(crop: PdfCrop, persist: boolean): Promise<void> {
    if (!this.loadedPath || !this.doc || this.destroyed) return;
    if (JSON.stringify(crop) === JSON.stringify(this.crop)) return;
    const location = this.captureLocation(), path = this.loadedPath, mode = this.getHandwritingMode();
    const revision = ++this.cropRevision;
    this.applyingCrop = true;
    try {
      this.setHandwritingMode("off");
      this.navigationRevision++; this.navigationPage = null; this.widthFitted = false;
      this.crop = crop;
      for (const [page, rec] of this.pages) {
        this.releasePage(page, rec);
        const original = this.originalPageSizes.get(page)!;
        const rotated = this.getPdfPageRotation(page) % 180 !== 0, width = original.w * (crop.right - crop.left), height = original.h * (crop.bottom - crop.top);
        const size = { w: rotated ? height : width, h: rotated ? width : height };
        this.pageSizes.set(page, size);
        rec.wrapper.style.width = `${Math.floor(size.w * this.scale)}px`;
        rec.wrapper.style.height = `${Math.floor(size.h * this.scale)}px`;
      }
      for (const task of this.thumbTasks) { try { task.cancel(); } catch { /* noop */ } }
      this.thumbTasks.clear(); if (this.thumbPanel) clear(this.thumbPanel);
      if (persist) this.plugin.store.updateDocMeta(path, { pdfCrop: { ...crop } });
      this.reflowPages(location.page);
      await this.restoreHistoryLocation(location, false);
      if (this.destroyed || this.loadedPath !== path || revision !== this.cropRevision) return;
      this.setHandwritingMode(mode); this.app.workspace.requestSaveLayout();
    } finally { if (revision === this.cropRevision) { this.applyingCrop = false; this.syncPageCrop(); } }
  }
  getPageReference(page: number): PageReference | undefined { return this.doc instanceof PageCollectionDocument ? this.doc.pageCollection.pages[page-1] : undefined; }
  getPageReferences(pages: number[]): PageReferenceInput[] {
    if (!this.loadedPath) return [];
    return pages.map((page) => { const entry = this.getPageReference(page); const sourcePage = this.doc instanceof EditedPdfDocument ? this.doc.edits.pages[page-1]?.sourcePage : page;
      if (!entry && !sourcePage) throw new Error("空白插页暂不能用于书页重组");
      return entry ? {sourcePath:entry.sourcePath,sourcePage:entry.sourcePage,sourceNotebookId:entry.sourceNotebookId} : {sourcePath:this.loadedPath!,sourcePage:sourcePage!,sourceNotebookId:this.getDocumentNotebookId()}; });
  }
  async openPageSource(page = this.currentPage): Promise<void> {
    const entry = this.getPageReference(page); if (!entry) return; const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
    if (!(file instanceof TFile)) { new Notice("源文档已不存在：" + entry.sourcePath); return; }
    const reader = await this.plugin.openDocument(file); await (reader as any).selectDocumentNotebook?.(entry.sourceNotebookId); if (reader.gotoSourcePage) reader.gotoSourcePage(entry.sourcePage); else reader.gotoPage?.(entry.sourcePage);
  }
  async refreshPageCollection(referenceId = this.getPageReference(this.currentPage)?.id): Promise<void> {
    if (!this.loadedPath || !(this.doc instanceof PageCollectionDocument)) return;
    const path=this.loadedPath; this.restoredState={path,scale:this.scale,fitWidth:this.widthFitted,layout:this.layout,continuous:this.continuous,position:this.captureLocation(),referenceId}; await this.loadFileByPath(path,true);
  }

  async setState(state: any): Promise<void> {
    if (state && (typeof state.filePath === "string" || typeof state.file === "string")) {
      const p = (state.filePath ?? state.file) as string;
      const position = state.position;
      this.restoredState = { path: p,
        scale: restoredScale(state.scale),
        fitWidth: state.pdfFitWidth === true,
        referenceId: typeof state.referenceId === "string" ? state.referenceId : undefined,
        pdfPageId: typeof state.pdfPageId === "string" ? state.pdfPageId : undefined,
        layout: state.pdfLayout === "single" || state.pdfLayout === "spread" ? state.pdfLayout : undefined,
        continuous: typeof state.pdfContinuous === "boolean" ? state.pdfContinuous : undefined,
        position: position && Number.isFinite(position.page) && Number.isFinite(position.pageOffset) ? {
          page: Math.max(1, Math.floor(position.page)), pageOffset: Math.max(-1, Math.min(1, position.pageOffset)),
          left: Number.isFinite(position.left) ? Math.max(0, position.left) : 0 } : undefined };
      if (this.scrollEl && !this.destroyed) {
        const alreadyLoaded = this.loadedPath === p;
        await this.loadFileByPath(p);
        if (alreadyLoaded && this.restoredState?.path === p) await this.applyRestoredState();
      }
      else this.filePath = p;
    }
  }

  /** 双击文件（registerExtensions 接管默认打开）时由 Obsidian 调用 */
  async onLoadFile(file: TFile): Promise<void> {
    if (!["pdf","msref"].includes(file.extension.toLowerCase())) return;
    if (this.scrollEl && !this.destroyed) await this.loadFileByPath(file.path);
    else this.filePath = file.path;
  }

  getState(): Record<string, unknown> {
    return { filePath: this.filePath, scale: this.doc ? this.scale : this.restoredState?.scale ?? this.scale, pdfLayout: this.layout, pdfContinuous: this.continuous, pdfFitWidth:this.doc?this.widthFitted:this.restoredState?.fitWidth??false,
      referenceId: this.getPageReference(this.currentPage)?.id,
      ...(this.doc instanceof EditedPdfDocument ? { pdfPageId: this.getPdfPageId(this.captureLocation().page) } : {}),
      position: this.doc ? this.captureLocation() : this.restoredState?.position };
  }

  async onOpen(): Promise<void> {
    this.destroyed = false;
    this.stopCropSync?.(); this.stopCropSync = this.plugin.store.subscribe(() => { this.syncPdfPageEdits(); this.syncPageCrop(); if (this.doc && this.loadedPath) void this.extendNotes.sync(); });
    this.register(this.plugin.store.subscribeDocumentRename?.((oldPath, newPath) => {
      if (this.destroyed) return;
      if (this.filePath === oldPath) this.filePath = newPath;
      if (this.loadedPath === oldPath) this.loadedPath = newPath;
    }) ?? (() => {}));
    this.scale = restoredScale(this.restoredState?.scale) ?? restoredScale(this.plugin.store.settings.scale) ?? 1.4;
    const root = this.containerEl.children[1] as HTMLElement;
    clear(root);
    root.classList.add("ms-reader-root", "ms-reader-pdf");
    root.classList.toggle("ms-reader-native-chrome", this.workspaceChrome);

    this.toolbarEl = el("div", { class: "ms-toolbar", role: "toolbar", "aria-label": "阅读与批注工具" });
    this.scrollEl = el("div", { class: "ms-scroll" });
    // Keep document gestures inside the reader on mobile; do not cancel native scrolling or text selection.
    if (Platform.isMobile) {
      this.scrollEl.addEventListener("contextmenu", event => {
        if ((event.target as Element).closest(".ms-text-layer")) event.preventDefault();
      });
      for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const)
        this.scrollEl.addEventListener(type, event => event.stopPropagation(), { passive: true });
    }
    this.scrollEl.addEventListener("click", this.extendNotes.onPlace, true);
    this.scrollEl.addEventListener("click",event=>{
      if(!this.plugin.store.settings.tapPageEdges||this.annController?.getHandwritingMode()!=="off"||this.annController?.isLassoMode()||!(event.target instanceof HTMLElement)||!event.target.matches(".ms-page-canvas,.ms-text-layer")||window.getSelection()?.toString())return;
      const paper=event.target.closest<HTMLElement>('[data-page]'),canvas=paper?.querySelector<HTMLCanvasElement>('.ms-page-canvas');if(!canvas)return;
      const box=canvas.getBoundingClientRect(),x=event.clientX-box.left,edge=Math.min(48,box.width*.08),page=Number(paper?.dataset.page);
      if(x<edge&&page>1)void this.gotoDisplayPage(page-1);else if(x>box.width-edge&&page<this.doc?.numPages)void this.gotoDisplayPage(page+1);
    });
    this.scrollEl.addEventListener("pointerdown", this.extendNotes.onRegionStart, true);
    this.scrollEl.tabIndex = 0;
    this.scrollEl.setAttribute("aria-label", "PDF 正文；方向键和 PageUp / PageDown 翻页");
    this.scrollEl.addEventListener("keydown", this.onPageKey);
    this.scrollEl.addEventListener("scroll", this.saveReadingPosition, { passive: true });
    this.scrollEl.style.setProperty("--ms-page-gap", this.plugin.store.settings.pageGap + "px");
    this.thumbPanel = el("div", { class: "ms-thumb-panel" });
    root.append(this.thumbPanel, this.toolbarEl, this.scrollEl);
    this.positionObserver = new ResizeObserver(() => {
      const anchor = this.locationAnchor;
      const resized = anchor && (anchor.width !== this.scrollEl.clientWidth || anchor.height !== this.scrollEl.clientHeight);
      this.updateExtendScrollSpace();
      if (this.canMeasureLocation()) {
        const location = this.pendingLocation ?? (resized ? anchor.location : null);
        if (location && !this.fitPending && this.navigationPage===null) void this.restoreHistoryLocation(location, false);
      }
    });
    this.positionObserver.observe(this.scrollEl);

    this.annController = new AnnotationController(this.plugin, this);
    this.register(this.annController.subscribeHandwritingModeChange(() => this.extendNotes.syncHandwriting()));
    this.speech = new ReadingSpeechControls({ owner: `pdf-${Math.random().toString(36).slice(2)}`,
      selectionRoot: () => this.scrollEl, documentSource: () => this.speechSource(), ready: () => !!this.doc });
    this.scrollEl.addEventListener("pointerdown", () => { this.plugin.activeReader = this; this.locationAnchor = null; });
    this.scrollEl.addEventListener("wheel", () => { this.locationAnchor = null; }, { passive: true });
    this.scrollEl.addEventListener("focusin", () => { this.plugin.activeReader = this; });

    this.buildToolbar();

    this.observer = new IntersectionObserver(
      (entries) => {
        let topMost: { num: number; ratio: number } | null = null;
        for (const e of entries) {
          const num = Number((e.target as HTMLElement).dataset.page);
          if (this.pages.get(num)?.wrapper !== e.target || this.destroyed || !this.isPageShown(num)) continue;
          if (e.isIntersecting) {
            this.visiblePages.add(num);
            void this.renderPage(num);
          } else {
            this.visiblePages.delete(num);
          }
          if (e.isIntersecting && (!topMost || e.intersectionRatio > topMost.ratio)) {
            topMost = { num, ratio: e.intersectionRatio };
          }
        }
        if (topMost && this.continuous && this.navigationPage === null && !this.hasLocationAnchor() &&
          (!this.unitPages(topMost.num).includes(this.currentPage) || !this.visiblePages.has(this.currentPage))) this.setCurrentPage(topMost.num);
        this.evictOffscreenPages();
      },
      { root: this.scrollEl, threshold: [0, 0.1, 0.5, 1] }
    );

    this.thumbObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            this.renderThumb(e.target as HTMLElement);
            this.thumbObserver?.unobserve(e.target);
          }
        }
      },
      { root: this.thumbPanel, threshold: 0.01 }
    );

    if (this.filePath) await this.loadFileByPath(this.filePath);
  }

  async onClose(): Promise<void> {
    await this.finishExtendEditing(); this.extendNotes.reset();
    this.scrollEl?.removeEventListener("click", this.extendNotes.onPlace, true);
    this.scrollEl?.removeEventListener("pointerdown", this.extendNotes.onRegionStart, true);
    this.closePdfExport?.();this.closePdfExport=null;
    this.closePageEditor?.(); this.closePageEditor = null;
    this.pageChangeListeners.clear();
    this.currentPageListeners.clear();
    this.readingStateListeners.clear();
    this.stopCropSync?.(); this.stopCropSync = null;
    this.speech?.dispose(); this.speech = null;
    if (this.savePositionTimer !== null) window.clearTimeout(this.savePositionTimer);
    this.savePositionTimer = null;
    this.scrollEl?.removeEventListener("keydown", this.onPageKey);
    this.scrollEl?.removeEventListener("scroll", this.saveReadingPosition);
    this.destroyed = true;
    this.positionObserver?.disconnect(); this.positionObserver = null;
    this.loadRevision++;
    this.ocrRequest++;this.recognizedPages.clear();
    this.searchRevision++;
    this.loadAbort?.abort();
    if (this.searchDebounce !== null) {
      window.clearTimeout(this.searchDebounce);
      this.searchDebounce = null;
    }
    if (this.plugin.activeReader === this) this.plugin.activeReader = null;
    this.observer?.disconnect();
    this.observer = null;
    this.thumbObserver?.disconnect();
    this.thumbObserver = null;
    try { await this.annController?.destroy(); }
    finally { await this.disposeDocument(); }
  }

  // ===== 工具栏 =====
  private buildToolbar(): void {
    clear(this.toolbarEl);
    const btn = (icon: string, title: string, cb: () => void) => {
      const b = el("button", { class: "ms-tb-btn", title, "aria-label": title });
      setIcon(b, icon);
      b.addEventListener("click", cb);
      return b;
    };

    const prev = this.prevPageEl = btn("chevron-left", "上一页", () => this.stepPage(-1)) as HTMLButtonElement;
    const next = this.nextPageEl = btn("chevron-right", "下一页", () => this.stepPage(1)) as HTMLButtonElement;
    this.historyBackEl = btn("undo-2", "返回上次阅读位置", () => { void this.goBack(); }) as HTMLButtonElement;
    this.historyForwardEl = btn("redo-2", "前进到下一阅读位置", () => { void this.goForward(); }) as HTMLButtonElement;
    this.updateHistoryButtons();
    this.pageInfoEl = el("input", {
      class: "ms-tb-page",
      type: "number",
      min: "1",
      value: "1",
      "aria-label": "跳转到页码",
    });
    this.pageInfoEl.addEventListener("change", () => {
      const v = parseInt((this.pageInfoEl as HTMLInputElement).value, 10);
      if (!isNaN(v)) void this.gotoDisplayPage(v);
    });
    this.pageInfoEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") (e.target as HTMLElement).blur();
    });

    const zoomOut = btn("minus", "缩小", () => this.setScale(this.scale / 1.2));
    this.scaleEl = el("span", { class: "ms-tb-scale", text: Math.round(this.scale * 100) + "%" });
    const zoomIn = btn("plus", "放大", () => this.setScale(this.scale * 1.2));
    const fit = btn("maximize", "适应宽度", () => this.fitWidth());
    this.pageTotalEl = el("span", { class: "ms-page-total", text: "/ 0" });
    this.layoutSelect = el("select", { class: "ms-layout-select", "aria-label": "页面布局", title: "页面布局" });
    this.layoutSelect.append(el("option", { value: "single", text: "单页" }), el("option", { value: "spread", text: "双页" }));
    this.continuousSelect = el("select", { class: "ms-layout-select", "aria-label": "翻页方式", title: "翻页方式" });
    this.continuousSelect.append(el("option", { value: "continuous", text: "连续滚动" }), el("option", { value: "paged", text: "逐组翻页" }));
    this.layoutSelect.addEventListener("change", () => { void this.setPageLayout(this.layoutSelect!.value as PdfLayout, this.continuous); });
    this.continuousSelect.addEventListener("change", () => { void this.setPageLayout(this.layout, this.continuousSelect!.value === "continuous"); });
    this.notebookTools = el("div", { class: "ms-notebook-controls" }); this.notebookTools.hidden = true;
    const searchBtn = btn("search", "文档内搜索", () => this.toggleSearch());
    const scanBtn = btn("scan-text", "识别当前扫描页", () => { void this.recognizeCurrentPage(); });
    const thumbBtn = btn("image", "缩略图", () => this.toggleThumb());
    const prevBm = btn("arrow-up", "上一书签", () => this.gotoBookmark(-1));
    const nextBm = btn("arrow-down", "下一书签", () => this.gotoBookmark(1));
    const compareBtn = btn("columns", "对照", () => this.compare());
    const reorganizeBtn = btn("files", "书页重组", () => this.openPageReorganization());
    const recallBtn = btn("eye-off", "忆模式：遮住摘录，点击揭示", () => this.toggleRecall());
    this.recallScopeEl = el("button", { class: "ms-btn", text: "全部摘录", title: "忆模式遮挡范围：全部摘录", "aria-label": "切换忆模式遮挡范围", "aria-pressed": "true" });
    this.recallScopeEl.addEventListener("click", () => this.setRecallCoverAll(!this.recallCoverAll));
    this.syncRecallScopeButton();

    const spacer = el("div", { class: "ms-tb-spacer" });
    const annTools = el("div", { class: "ms-tb-ann" });
    this.annController.buildToolbar(annTools);

    this.toolbarEl.append(
      prev,
      this.pageInfoEl,
      this.pageTotalEl,
      next,
      this.historyBackEl,
      this.historyForwardEl,
      el("span", { class: "ms-tb-sep" }),
      zoomOut,
      this.scaleEl,
      zoomIn,
      fit,
      this.layoutSelect,
      this.continuousSelect,
      this.notebookTools,
      searchBtn,
      scanBtn,
      thumbBtn,
      prevBm,
      nextBm,
      compareBtn,
      reorganizeBtn,
      recallBtn,
      this.recallScopeEl,
      this.speech!.element,
      spacer,
      annTools
    );
  }

  /** 忆模式（对齐 MN4「沉浸·忆」）：模糊全部高亮，点击揭示，主动回忆后再看答案 */
  toggleRecall(): void {
    const on = !this.getRecallMode();
    this.setRecallMode(on);
    new Notice(on ? "已进入忆模式：摘录已遮住，点击揭示" : "已退出忆模式");
  }
  private syncRecallScopeButton(): void {
    if(!this.recallScopeEl)return;
    this.recallScopeEl.textContent=this.recallCoverAll?"全部摘录":"仅标记遮挡";
    this.recallScopeEl.title=`忆模式遮挡范围：${this.recallScopeEl.textContent}`;
    this.recallScopeEl.setAttribute("aria-pressed",String(this.recallCoverAll));
  }

  // ===== 文档内搜索（体验增强 N） =====
  private toggleSearch(): void {
    if (this.searchBoxEl) {
      this.searchBoxEl.remove();
      this.searchBoxEl = null;
      if (this.searchDebounce !== null) {
        window.clearTimeout(this.searchDebounce);
        this.searchDebounce = null;
      }
      return;
    }
    const box = el("div", { class: "ms-search-box" + (this.workspaceChrome ? " ms-native-reader-search" : "") });
    const input = el("input", {
      class: "ms-tb-page ms-search-input",
      type: "text",
      placeholder: "搜索本文档…",
      "aria-label": "搜索本文档",
    }) as HTMLInputElement;
    input.addEventListener("input", () => {
      this.scheduleSearch(input.value);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) this.prevHit();
        else this.nextHit();
      } else if (e.key === "Escape") {
        this.toggleSearch();
      }
    });
    const prev = el("button", { class: "ms-tb-btn", text: "↑", title: "上一处" });
    prev.addEventListener("click", () => this.prevHit());
    const next = el("button", { class: "ms-tb-btn", text: "↓", title: "下一处" });
    next.addEventListener("click", () => this.nextHit());
    const count = el("span", { class: "ms-search-count", text: "0/0" });
    const close = el("button", { class: "ms-tb-btn", title: "关闭文档搜索", "aria-label": "关闭文档搜索" });
    setIcon(close, "x"); close.addEventListener("click", () => this.toggleSearch());
    box.append(input, prev, next, count, close);
    (this.workspaceChrome ? this.containerEl.children[1] : this.toolbarEl).append(box);
    this.searchBoxEl = box;
    this.searchInputEl = input;
    this.searchCountEl = count;
    input.focus();
  }

  openSearch(): void {
    if (!this.searchBoxEl) this.toggleSearch();
    else this.searchInputEl?.focus();
  }

  private async runSearch(term: string): Promise<void> {
    const revision = ++this.searchRevision;
    const doc = this.doc;
    const loadRevision = this.loadRevision;
    this.searchTerm = term.trim();
    this.searchHits = [];
    this.searchIdx = 0;
    if (!this.searchTerm || !this.doc) {
      this.clearSearchHighlight();
      this.updateSearchCount();
      return;
    }
    const lower = this.searchTerm.toLowerCase();
    const hits: { page: number; start: number; end: number }[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const text = await this.getPageText(p, doc, loadRevision);
      if (revision !== this.searchRevision || loadRevision !== this.loadRevision || this.destroyed) return;
      const tl = text.toLowerCase();
      let from = 0;
      let i: number;
      while ((i = tl.indexOf(lower, from)) >= 0) {
        hits.push({ page: p, start: i, end: i + lower.length });
        from = i + lower.length;
      }
    }
    this.searchHits = hits;
    this.updateSearchCount();
    if (this.searchHits.length) await this.gotoHit(0);
    else {
      this.clearSearchHighlight();
      new Notice("未找到：" + this.searchTerm);
    }
  }

  /** 输入防抖：避免每敲一键就全文档扫描（大 PDF 直接卡死） */
  private scheduleSearch(term: string): void {
    if (this.searchDebounce !== null) window.clearTimeout(this.searchDebounce);
    this.searchDebounce = window.setTimeout(() => {
      this.searchDebounce = null;
      void this.runSearch(term).catch((error) => console.warn("MarginStudy search:", error));
    }, 300);
  }

  private async getPageText(pageNum: number, doc = this.doc, revision = this.loadRevision): Promise<string> {
    if(doc===this.doc&&revision===this.loadRevision&&this.recognizedPages.has(pageNum))return mergeOcrWords(this.recognizedPages.get(pageNum)!);
    const cached = this.pageTextCache.get(pageNum);
    if (cached !== undefined) return cached;
    if (!doc) return "";
    const page = await doc.getPage(pageNum);
    const tc = await page.getTextContent();
    const text = (tc.items as Array<{ str: string }>).map((it) => it.str).join(" ");
    if (revision === this.loadRevision && doc === this.doc) this.pageTextCache.set(pageNum, text);
    return text;
  }

  private async gotoHit(idx: number): Promise<void> {
    if (!this.searchHits.length) return;
    const len = this.searchHits.length;
    this.searchIdx = ((idx % len) + len) % len;
    const hit = this.searchHits[this.searchIdx];
    const revision = this.searchRevision;
    const loadRevision = this.loadRevision;
    this.gotoPage(hit.page);
    await this.renderPage(hit.page);
    if (revision !== this.searchRevision || loadRevision !== this.loadRevision || this.destroyed) return;
    this.applySearchHighlight(hit.page);
    this.updateSearchCount();
  }

  private async waitPageTextLayer(pageNum: number): Promise<void> {
    const rec = this.pages.get(pageNum);
    if (!rec) return;
    for (let t = 0; t < 30; t++) {
      if (rec.textLayer.querySelector("span")) return;
      await new Promise((r) => setTimeout(r, 30));
    }
  }

  private applySearchHighlight(pageNum: number): void {
    const rec = this.pages.get(pageNum);
    if (!rec || !this.searchTerm) return;
    this.clearSearchHighlightIn(rec.textLayer);
    const lower = this.searchTerm.toLowerCase();
    const walker = document.createTreeWalker(rec.textLayer, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) nodes.push(n as Text);
    for (const node of nodes) {
      const txt = node.textContent || "";
      const tl = txt.toLowerCase();
      let from = 0;
      let i: number;
      let found = false;
      const frag = document.createDocumentFragment();
      let last = 0;
      while ((i = tl.indexOf(lower, from)) >= 0) {
        found = true;
        const before = txt.slice(last, i);
        const mid = txt.slice(i, i + this.searchTerm.length);
        if (before) frag.append(document.createTextNode(before));
        const span = document.createElement("span");
        span.className = "ms-search-hit";
        span.textContent = mid;
        frag.append(span);
        last = i + this.searchTerm.length;
        from = last;
      }
      if (found) {
        const after = txt.slice(last);
        if (after) frag.append(document.createTextNode(after));
        const parent = node.parentNode;
        if (parent) parent.replaceChild(frag, node);
      }
    }
  }

  private clearSearchHighlight(): void {
    for (const rec of this.pages.values()) this.clearSearchHighlightIn(rec.textLayer);
  }
  private clearSearchHighlightIn(layer: HTMLElement): void {
    layer.querySelectorAll(".ms-search-hit").forEach((e) => {
      const parent = e.parentNode;
      if (parent) parent.replaceChild(document.createTextNode(e.textContent || ""), e);
    });
  }

  private nextHit(): void {
    if (!this.searchHits.length) return;
    void this.gotoHit(this.searchIdx + 1);
  }
  private prevHit(): void {
    if (!this.searchHits.length) return;
    void this.gotoHit(this.searchIdx - 1);
  }
  private updateSearchCount(): void {
    if (this.searchCountEl)
      this.searchCountEl.textContent = `${this.searchHits.length ? this.searchIdx + 1 : 0}/${this.searchHits.length}`;
  }

  getPageLayout(): { layout: PdfLayout; continuous: boolean } { return { layout: this.layout, continuous: this.continuous }; }
  getCurrentPage(): number { return this.currentPage; }

  /** Reparent the existing page shells: annotations keep their original canvas coordinate system. */
  async setPageLayout(layout: PdfLayout, continuous: boolean): Promise<void> {
    if (layout !== "single" && layout !== "spread") return;
    const location = this.doc ? this.captureLocation() : { page: this.currentPage, pageOffset: 0, left: 0 };
    this.layout = layout; this.continuous = continuous;
    this.reflowPages(location.page);
    if (this.loadedPath) updateNotebookMeta(this.plugin, this.loadedPath, { pdfLayout: layout, pdfContinuous: continuous });
    if (this.doc) await this.restoreHistoryLocation(location, false);
    this.app.workspace.requestSaveLayout();
  }

  private unitPages(page: number): number[] {
    const width = this.layout === "spread" ? 2 : 1;
    const start = Math.floor((page - 1) / width) * width + 1;
    return Array.from({ length: width }, (_, index) => start + index).filter((number) => this.pages.has(number));
  }
  private isPageShown(page: number): boolean { return !!this.pages.get(page) && !this.pageRows.get(page)?.hidden; }
  private reflowPages(page: number): void {
    this.observer?.disconnect(); this.pageRows.clear(); this.visiblePages.clear();
    this.scrollEl.classList.toggle("ms-pdf-spread", this.layout === "spread");
    this.scrollEl.classList.toggle("ms-pdf-paged", !this.continuous);
    const fragment = document.createDocumentFragment();
    let row: HTMLElement | null = null;
    for (const [number, rec] of this.pages) {
      if (!row || this.layout === "single" || number % 2 === 1) {
        row = el("div", { class: "ms-page-spread", "data-first-page": String(number), role: "group", "aria-label": this.layout === "spread" ? `第 ${number}–${Math.min(number + 1, this.pages.size)} 页` : `第 ${number} 页` });
        fragment.append(row);
      }
      row.append(rec.wrapper); this.pageRows.set(number, row);
    }
    this.scrollEl.replaceChildren(fragment);
    this.showPageUnit(page);
    for (const rec of this.pages.values()) this.observer?.observe(rec.wrapper);
    this.syncLayoutControls();
  }
  private showPageUnit(page: number): void {
    const active = this.pageRows.get(page);
    for (const row of new Set(this.pageRows.values())) row.hidden = !this.continuous && row !== active;
    for (const [number, rec] of this.pages) if (!this.isPageShown(number)) {
      this.visiblePages.delete(number);
      if (rec.canvas.width || rec.renderPromise) this.releasePage(number, rec);
    }
    if (!this.continuous) {
      this.visiblePages.clear();
      this.unitPages(page).forEach((number) => this.visiblePages.add(number));
    }
    this.setCurrentPage(page);
  }
  private async renderPageUnit(page: number): Promise<void> {
    await Promise.all(this.unitPages(page).map((number) => this.renderPage(number)));
  }
  private syncLayoutControls(): void {
    if (this.layoutSelect) this.layoutSelect.value = this.layout;
    if (this.continuousSelect) this.continuousSelect.value = this.continuous ? "continuous" : "paged";
  }
  private stepPage(direction: 1 | -1): void {
    if(this.getDisplayPages().length!==(this.doc?.numPages??0)){void this.gotoDisplayPage(this.getCurrentDisplayPage()+direction);return;}
    const pages = this.unitPages(this.currentPage);
    const target = direction > 0 ? (pages[pages.length - 1] ?? 0) + 1 : (pages[0] ?? 1) - (this.layout === "spread" ? 2 : 1);
    this.gotoPage(target);
  }
  private onPageKey = (event: KeyboardEvent): void => {
    if(!event.defaultPrevented&&(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==="f") {event.preventDefault();this.openSearch();return;}
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !this.doc) return;
    const target = event.target as HTMLElement;
    if (target.closest("input,textarea,select,button,[contenteditable=true]") || window.getSelection()?.toString()) return;
    if (["ArrowLeft", "PageUp"].includes(event.key)) { event.preventDefault(); this.stepPage(-1); }
    else if (["ArrowRight", "PageDown"].includes(event.key)) { event.preventDefault(); this.stepPage(1); }
    else if (event.key === "Home") { event.preventDefault(); this.gotoPage(1); }
    else if (event.key === "End") { event.preventDefault(); this.gotoPage(this.doc.numPages); }
  };
  private saveReadingPosition = (): void => {
    this.captureLocation();
    this.syncDisplayPageControls();
    if (this.savePositionTimer !== null) window.clearTimeout(this.savePositionTimer);
    this.savePositionTimer = window.setTimeout(() => { this.savePositionTimer = null; this.saveReadingState(); }, 250);
  };
  private async applyRestoredState(): Promise<void> {
    const saved = this.restoredState;
    if (!saved || saved.path !== this.loadedPath) return;
    this.restoredState = null;
    if (saved.referenceId && this.doc instanceof PageCollectionDocument && saved.position) {
      const page = collectionPageIndex(this.doc.pageCollection,saved.referenceId); if (page) saved.position.page=page;
    }
    if (saved.pdfPageId && this.doc instanceof EditedPdfDocument && saved.position) {
      const index = this.doc.edits.pages.findIndex(entry => entry.id === saved.pdfPageId); if (index >= 0) saved.position.page = index + 1;
    }
    this.layout = saved.layout ?? this.layout;
    this.continuous = saved.continuous ?? this.continuous;
    if (saved.scale !== undefined && saved.scale !== this.scale) this.applyScale(saved.scale,false);
    this.reflowPages(Math.min(this.pages.size, saved.position?.page ?? 1));
    if (saved.position) await this.restoreHistoryLocation({ ...saved.position, page: Math.min(this.pages.size, saved.position.page) }, false);
    else await this.renderPageUnit(this.currentPage);
    if(saved.fitWidth)await this.fitWidth();
  }

  setScale(scale: number): void {
    if (!Number.isFinite(scale)) return;
    const previous = this.scale;
    const location = this.doc ? this.captureLocation() : null;
    this.applyScale(scale,true);
    if (location) void this.restoreHistoryLocation({ ...location, left: location.left * this.scale / previous }, false);
  }
  private applyScale(scale: number, saveDefault: boolean): void {
    if (!Number.isFinite(scale)) return;
    this.widthFitted = false;
    this.navigationRevision++;
    this.navigationPage = null;
    this.pendingLocation = null;
    this.scale = Math.max(0.3, Math.min(4, Number(scale.toFixed(3))));
    if (saveDefault) { this.plugin.store.settings.scale = this.scale; this.plugin.store.save(); this.app.workspace.requestSaveLayout(); }
    if (this.scaleEl) this.scaleEl.textContent = Math.round(this.scale * 100) + "%";
    // 仅重渲当前视口内页；视口外页置 -1，待滚动/observer 自然重渲（性能优化 C）
    for (const [num, rec] of this.pages) {
      const size = this.pageSizes.get(num);
      if (size) {
        rec.wrapper.style.width = `${Math.floor(size.w * this.scale)}px`;
        rec.wrapper.style.height = `${Math.floor(size.h * this.scale)}px`;
      }
      if (this.visiblePages.has(num)) {
        if (rec.renderedScale !== this.scale) void this.renderPage(num);
      } else {
        this.releasePage(num, rec);
      }
    }
    // 标注层随上面 renderPage 末尾统一渲染（页面已量好尺寸），此处无需重复调用
  }

  /** Includes the whole spread; a manually zoomed page keeps its scale on pane changes. */
  isFittedToWidth(): boolean {
    if (!this.doc || !this.scrollEl.clientWidth) return false;
    if (this.widthFitted) return true;
    const pages = this.unitPages(this.captureLocation().page);
    const style = getComputedStyle(this.scrollEl);
    const gap = Math.max(0, parseFloat(style.getPropertyValue("--ms-page-gap")) || 0);
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const width = pages.reduce((sum, page) => sum + (this.pages.get(page)?.wrapper.getBoundingClientRect().width ?? 0) * (this.getMarginCommentArea() ? 1.4 : 1), 0);
    return width > 0 && Math.abs(width + Math.max(0, pages.length - 1) * gap + padding - this.scrollEl.clientWidth) < 4;
  }

  fitWidth(): Promise<void> {
    if (!this.doc) return Promise.resolve();
    const doc = this.doc;
    const revision = this.loadRevision;
    const fitRevision=++this.fitRevision,navigationRevision=this.navigationRevision;this.fitPending=fitRevision;
    const pages = this.unitPages(this.captureLocation().page);
    return Promise.all(pages.map((page) => doc.getPage(page))).then((loaded: any[]) => {
      if (revision !== this.loadRevision || fitRevision !== this.fitRevision || navigationRevision !== this.navigationRevision || this.destroyed) return;
      const width = loaded.reduce((sum, page) => sum + this.getPageViewport(page, 1).width * (this.getMarginCommentArea() ? 1.4 : 1), 0);
      const style = getComputedStyle(this.scrollEl);
      const gap = Math.max(0, parseFloat(style.getPropertyValue("--ms-page-gap")) || 0);
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const avail = this.scrollEl.clientWidth - padding - Math.max(0, pages.length - 1) * gap;
      this.setScale(Math.max(1, avail) / Math.max(1, width));
      this.widthFitted = true;
      this.saveReadingState();
    }).catch(() => {}).finally(()=>{if(this.fitPending===fitRevision)this.fitPending=0;});
  }

  private setCurrentPage(num: number): void {
    const changed=this.currentPage!==num;
    this.currentPage = num;
    const unit = this.unitPages(num);
    if (this.prevPageEl) this.prevPageEl.disabled = !this.doc || (unit[0] ?? 1) <= 1;
    if (this.nextPageEl) this.nextPageEl.disabled = !this.doc || (unit[unit.length - 1] ?? 1) >= this.doc.numPages;
    this.syncDisplayPageControls();
    this.plugin.viewEvents?.onPageChange?.(num);
    if(changed)for(const listener of this.currentPageListeners)listener();
  }
  private syncDisplayPageControls():void {
    this.updateExtendScrollSpace();
    const total=this.getDisplayPages().length,current=this.doc?this.getCurrentDisplayPage():1;
    if(this.pageInfoEl){(this.pageInfoEl as HTMLInputElement).value=String(current);(this.pageInfoEl as HTMLInputElement).max=String(total||1);}
    if(this.pageTotalEl)this.pageTotalEl.textContent=`/ ${total}`;
    if(total!==(this.doc?.numPages??0)){if(this.prevPageEl)this.prevPageEl.disabled=current<=1;if(this.nextPageEl)this.nextPageEl.disabled=current>=total;}
  }

  /** Let a short last page or Extend segment reach the viewport top instead of bottom-clamping. */
  private updateExtendScrollSpace():void {
    if(!this.scrollEl)return;
    const entries=this.getDisplayPages().filter(entry=>this.isPageShown(entry.page)),last=entries[entries.length-1];
    const split=last&&entries.some(entry=>entry.page===last.page&&entry.noteId);
    const rowHeight=last?(this.pageRows.get(last.page)?.getBoundingClientRect().height??last.height*this.scale):0;
    const remainingHeight=Math.max(0,rowHeight-(split?last.top*this.scale:0));
    const tail=last?Math.max(0,this.scrollEl.clientHeight-remainingHeight):0;
    this.scrollEl.style.setProperty("--ms-extend-scroll-tail",`${tail}px`);
    this.scrollEl.classList.toggle("ms-extend-scroll-tail",!!split||tail>0);
  }

  gotoPage(num: number): void {
    void this.navigateToReference(num, []);
  }

  /** Record the old view before expanding/rendering; return only after the destination is usable. */
  async navigateToReference(pageNum: number, rects: PdfRect[], coordinateSpace?: Annotation["pdfCoordinateSpace"], smooth = true): Promise<boolean> {
    if (!this.doc || !Number.isFinite(pageNum) || this.destroyed) return false;
    const page = Math.max(1, Math.min(this.doc.numPages, Math.floor(pageNum)));
    const rec = this.pages.get(page);
    if (!rec) return false;
    this.pendingLocation = null;
    const revision = ++this.navigationRevision;
    const loadRevision = this.loadRevision;
    this.navigationHistory.record(this.captureLocation());
    this.locationAnchor = null;
    this.updateHistoryButtons();
    this.navigationPage = page;
    try {
      this.showPageUnit(page);
      if (this.folded.has(page)) this.toggleFold(page);
      await this.renderPageUnit(page);
      if (this.destroyed || loadRevision !== this.loadRevision || revision !== this.navigationRevision || rec.renderedScale !== this.scale) return false;
      const bounds = this.referenceBounds(page, rects, coordinateSpace);
      const scroll = this.scrollEl.getBoundingClientRect();
      const canvas = rec.canvas.getBoundingClientRect();
      const wrapper = rec.wrapper.getBoundingClientRect();
      this.scrollEl.scrollTo({
        top: this.scrollEl.scrollTop + (bounds ? canvas.top + bounds.top + bounds.height / 2 - scroll.top - this.scrollEl.clientHeight / 2 : wrapper.top - scroll.top),
        left: bounds && canvas.width > this.scrollEl.clientWidth
          ? this.scrollEl.scrollLeft + canvas.left + bounds.left + bounds.width / 2 - scroll.left - this.scrollEl.clientWidth / 2 : this.scrollEl.scrollLeft,
        behavior: smooth ? "smooth" : "instant" as ScrollBehavior,
      });
      if(!smooth){
        const destination=rec.wrapper.getBoundingClientRect();
        this.locationAnchor={page,top:this.scrollEl.scrollTop,left:this.scrollEl.scrollLeft,width:this.scrollEl.clientWidth,height:this.scrollEl.clientHeight,location:{page,pageOffset:(this.scrollEl.getBoundingClientRect().top-destination.top)/Math.max(1,destination.height),left:this.scrollEl.scrollLeft}};
      }
      this.setCurrentPage(page);
      this.saveReadingState();
      return true;
    } finally { if (revision === this.navigationRevision) this.navigationPage = null; }
  }

  /** Single projection gate for overlays and source jumps, including legacy sidecars. */
  projectRect(pageNum: number, rect: PdfRect, coordinateSpace?: Annotation["pdfCoordinateSpace"]): CssRect | null {
    const rec = this.pages.get(pageNum);
    if (!rec) return null;
    if (coordinateSpace !== "pdf") {
      const projected = legacyRectToCssRect(rect, this.getPagePdfHeight(pageNum), this.scale);
      if (!projected) return null;
      const extend = (value: CssRect): CssRect => {
        const down = (rec.viewport as any)?.extendDown ?? ((y: number) => y);
        return {...value, top: down(value.top), height: down(value.top+value.height)-down(value.top)};
      };
      const rotation = this.getPdfPageRotation(pageNum);
      if (rotation) {
        const width = this.getPagePdfWidth(pageNum) * this.scale, height = this.getPagePdfHeight(pageNum) * this.scale;
        const a = projectPagePoint({x:projected.left/width,y:projected.top/height},this.crop,rotation),b = projectPagePoint({x:(projected.left+projected.width)/width,y:(projected.top+projected.height)/height},this.crop,rotation);
        return extend({left:Math.min(a.x,b.x)*(rec.baseViewport?.width ?? rec.canvas.clientWidth),top:Math.min(a.y,b.y)*(rec.baseViewport?.height ?? rec.canvas.clientHeight),width:Math.abs(a.x-b.x)*(rec.baseViewport?.width ?? rec.canvas.clientWidth),height:Math.abs(a.y-b.y)*(rec.baseViewport?.height ?? rec.canvas.clientHeight)});
      }
      return extend({ ...projected, left: projected.left - this.crop.left * this.getPagePdfWidth(pageNum) * this.scale,
        top: projected.top - this.crop.top * this.getPagePdfHeight(pageNum) * this.scale });
    }
    return rec.viewport ? pdfRectToCssRect(rect, rec.viewport, { width: rec.canvas.clientWidth, height: rec.canvas.clientHeight }) : null;
  }

  private referenceBounds(page: number, rects: PdfRect[], space?: Annotation["pdfCoordinateSpace"]): CssRect | null {
    const rec = this.pages.get(page);
    if (!rec?.viewport) return null;
    const projected = rects.map((rect) => this.projectRect(page, rect, space)).filter((rect): rect is CssRect => rect !== null);
    const reference = unionCssRects(projected);
    if (!reference) return null;
    const canvas = rec.canvas.getBoundingClientRect();
    const canonical = space === "pdf" ? rects : projected.map((rect) => clientRectToPdfRect({ ...rect,
      left: canvas.left + rect.left, top: canvas.top + rect.top, right: canvas.left + rect.left + rect.width,
      bottom: canvas.top + rect.top + rect.height }, canvas, rec.viewport!)).filter((rect): rect is PdfRect => rect !== null);
    const hits: CssRect[] = [];
    for (const span of Array.from(rec.textLayer.querySelectorAll("span"))) {
      for (const client of Array.from(span.getClientRects())) {
        const candidate = clientRectToPdfRect(client, canvas, rec.viewport);
        if (candidate && canonical.some((rect) => pdfRectsIntersect(rect, candidate, 2))) hits.push({
          left: client.left - canvas.left, top: client.top - canvas.top, width: client.width, height: client.height });
      }
    }
    const text = unionCssRects(hits);
    return text ? { ...reference, top: text.top, height: text.height } : reference;
  }

  private canMeasureLocation(): boolean {
    return !!this.scrollEl?.isConnected && this.scrollEl.clientHeight > 0 && this.scrollEl.clientWidth > 0
      && /^(auto|scroll|overlay)$/.test(getComputedStyle(this.scrollEl).overflowY);
  }
  private hasLocationAnchor(): boolean {
    const anchor = this.locationAnchor;
    if (anchor && this.isPageShown(anchor.page) && Math.abs(this.scrollEl.scrollTop-anchor.top)<1 && Math.abs(this.scrollEl.scrollLeft-anchor.left)<1) return true;
    this.locationAnchor = null; return false;
  }
  private captureLocation(): PdfReadingLocation {
    if (this.pendingLocation) return { ...this.pendingLocation };
    // Host chrome can resize after restoration and trigger browser scroll anchoring.
    // Keep the requested reading point until ResizeObserver reapplies it; user input releases it.
    const anchor = this.locationAnchor;
    if (anchor && (anchor.width !== this.scrollEl.clientWidth || anchor.height !== this.scrollEl.clientHeight)) return { ...anchor.location };
    if (!this.canMeasureLocation()) return { ...(this.restoredState?.position ?? this.lastLocation) };
    const top = this.scrollEl.getBoundingClientRect().top;
    const entries = [...this.pages.entries()].filter(([page]) => this.isPageShown(page));
    const rows = [...new Set(entries.map(([page]) => this.pageRows.get(page)))].filter((row): row is HTMLElement => !!row);
    const row = [...rows].reverse().find((row) => row.getBoundingClientRect().top <= top + 1) ?? rows[0];
    const candidates = entries.filter(([page]) => this.pageRows.get(page) === row);
    const anchored = this.hasLocationAnchor() ? entries.find(([page])=>page === this.locationAnchor!.page) : undefined;
    const current = anchored ?? candidates.find(([page]) => page === this.currentPage) ?? candidates[0] ?? entries[0];
    if (!current) return { page: 1, pageOffset: 0, left: this.scrollEl.scrollLeft };
    const [page, rec] = current;
    const bounds = rec.wrapper.getBoundingClientRect();
    this.lastLocation = { page, pageOffset: (top - bounds.top) / Math.max(1, bounds.height), left: this.scrollEl.scrollLeft };
    return { ...this.lastLocation };
  }
  async goBack(): Promise<void> { const target = this.navigationHistory.back(this.captureLocation()); this.updateHistoryButtons(); if (target) await this.restoreHistoryLocation(target); }
  async goForward(): Promise<void> { const target = this.navigationHistory.forward(this.captureLocation()); this.updateHistoryButtons(); if (target) await this.restoreHistoryLocation(target); }
  private async restoreHistoryLocation(target: PdfReadingLocation, smooth = true): Promise<void> {
    this.locationAnchor = null;
    const rec = this.pages.get(target.page);
    if (!rec) return;
    this.pendingLocation = { ...target }; this.lastLocation = { ...target };
    if (!this.canMeasureLocation()) { this.setCurrentPage(target.page); return; }
    const revision = ++this.navigationRevision;
    const loadRevision = this.loadRevision;
    this.navigationPage = target.page;
    try {
      this.showPageUnit(target.page);
      if (this.folded.has(target.page)) this.toggleFold(target.page);
      await this.renderPageUnit(target.page);
      if (this.destroyed || loadRevision !== this.loadRevision || revision !== this.navigationRevision || this.pages.get(target.page) !== rec) return;
      const bounds = rec.wrapper.getBoundingClientRect();
      this.scrollEl.scrollTo({ top: this.scrollEl.scrollTop + bounds.top - this.scrollEl.getBoundingClientRect().top + target.pageOffset * bounds.height,
        left: target.left, behavior: smooth ? "smooth" : "instant" as ScrollBehavior });
      if (!smooth) this.locationAnchor = {page:target.page,top:this.scrollEl.scrollTop,left:this.scrollEl.scrollLeft,
        width:this.scrollEl.clientWidth,height:this.scrollEl.clientHeight,location:{...target}};
      this.pendingLocation = null;
      this.setCurrentPage(target.page);
    } finally { if (revision === this.navigationRevision) this.navigationPage = null; }
  }
  private updateHistoryButtons(): void {
    if (this.historyBackEl) this.historyBackEl.disabled = !this.navigationHistory.canBack;
    if (this.historyForwardEl) this.historyForwardEl.disabled = !this.navigationHistory.canForward;
  }

  // ===== 文件加载 =====
  async loadFileByPath(path: string, force = false, preserveEditHistory = false): Promise<void> {
    this.closePdfExport?.();this.closePdfExport=null;
    if (!force && this.loadedPath === path && this.doc) return;
    if (!force && this.pendingLoad?.path === path) return this.pendingLoad.promise;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || !["pdf","msref"].includes(file.extension.toLowerCase())) {
      new Notice("请选择 PDF 或重组文档");
      return;
    }
    if (this.extendNotes.hasEditor()) await this.finishExtendEditing();
    const revision = ++this.loadRevision;
    this.ocrRequest++;this.recognizedPages.clear();
    this.speech?.stop();
    this.loadAbort?.abort();
    const abort = this.loadAbort = new AbortController();
    this.filePath = path;
    const promise = this.loadFile(file, revision, abort.signal, preserveEditHistory && this.loadedPath === path);
    this.pendingLoad = { path, promise };
    try { await promise; }
    finally { if (this.pendingLoad?.promise === promise) this.pendingLoad = null; if (!this.syncingPageEdits) this.syncPdfPageEdits(); }
  }

  private async loadFile(file: TFile, revision: number, signal: AbortSignal, preserveEditHistory = false): Promise<void> {
    const current = () => revision === this.loadRevision && !this.destroyed && !signal.aborted;
    let candidate: any = null;
    try {
      await this.annController.releaseDocument(preserveEditHistory);
      if (!current()) return;
      await this.disposeDocument();
      if (!current()) return;
      this.searchRevision++;
      if (this.searchDebounce !== null) window.clearTimeout(this.searchDebounce);
      this.searchDebounce = null;
      this.pageTextCache.clear();
      this.searchTerm = "";
      this.searchHits = [];
      this.searchBoxEl?.remove();
      this.searchBoxEl = null;
      this.searchInputEl = null;
      this.searchCountEl = null;
      new Notice(`正在加载 ${file.name} …`);
      const buf = await this.app.vault.readBinary(file);
      if (!current()) return;
      const notebook = file.extension.toLowerCase() === "pdf" ? readNotebookMetadata(buf) : null;
      candidate = file.extension.toLowerCase() === "msref" ? await openPageCollectionDocument(this.plugin,buf,signal) : await loadPdf(buf, signal);
      const edits = this.plugin.store.getDocMeta(file.path).pdfPageEdits;
      if (file.extension.toLowerCase() === "pdf" && edits) candidate = new EditedPdfDocument(candidate, edits, signal, async (path,abort) => {
        const asset = this.app.vault.getAbstractFileByPath(path);
        if (!(asset instanceof TFile)) throw new Error(`插页源文件缺失：${path}`);
        return loadPdf(await this.app.vault.readBinary(asset),abort);
      });
      if (!current()) return;
      const first = await candidate.getPage(1);
      if (!current()) return;
      const base = (first.marginStudySourcePage ?? first).getViewport({ scale: 1 });
      await this.annController.loadForDoc(file.path, preserveEditHistory);
      if (!current()) return;
      this.doc = candidate;
      if (this.doc instanceof PageCollectionDocument) { const document=this.doc; document.onReferencesChanged=()=>{if(this.doc===document&&!this.destroyed)this.annController.refreshAll();}; }
      candidate = null;
      this.loadedPath = file.path;
      this.crop = readPageCrop(this.plugin.store.getDocMeta(file.path).pdfCrop);
      this.notebook = edits ? null : notebook;
      if (this.notebookTools) renderNotebookControls(this.notebookTools, this.notebook, (patch) => this.updateNotebook(patch));
      this.plugin.activeReader = this; this.extendNotes.acceptLoaded();
      await this.buildPageShells({ w: base.width, h: base.height });
      if (!current()) return;
      for (const listener of this.pageChangeListeners) listener();
      this.plugin.refreshSidebar();
      new Notice(`已加载 ${this.doc.numPages} 页`);
      void this.plugin.ensureSplitLayout();
    } catch (error) {
      if (current()) {
        console.error(error);
        new Notice("PDF 加载失败：" + (error as Error).message);
      }
    } finally {
      if (candidate) await candidate.destroy().catch(() => {});
    }
  }

  private async disposeDocument(): Promise<void> {
    await this.finishExtendEditing(); this.extendNotes.reset();
    if (!this.applyingPageEdits) { this.closePageEditor?.(); this.closePageEditor = null; }
    this.cropEditorRevision++; this.closeCropEditor?.(); this.closeCropEditor = null;
    this.locationAnchor = null;
    this.pendingLocation = null; this.lastLocation = { page: 1, pageOffset: 0, left: 0 };
    this.navigationRevision++;
    this.navigationPage = null;
    this.navigationHistory.clear();
    this.updateHistoryButtons();
    this.observer?.disconnect();
    this.thumbObserver?.disconnect();
    for (const task of this.thumbTasks) { try { task.cancel(); } catch { /* noop */ } }
    this.thumbTasks.clear();
    for (const [num, rec] of this.pages) this.releasePage(num, rec);
    this.pages.clear();
    this.pageRows.clear();
    this.visiblePages.clear();
    this.pageSizes.clear();
    this.originalPageSizes.clear(); this.cropRevision++; this.applyingCrop = false; this.crop = { ...fullPageCrop };
    this.loadedPath = null;
    this.widthFitted = false;
    this.notebook = null;
    if (this.notebookTools) { clear(this.notebookTools); this.notebookTools.hidden = true; }
    const doc = this.doc;
    this.doc = null;
    clear(this.scrollEl);
    if (this.thumbPanel) clear(this.thumbPanel);
    if (doc) await doc.destroy().catch(() => {});
  }

  private speechSource(): (signal: AbortSignal) => AsyncGenerator<SpeechSection> {
    const doc = this.doc, revision = this.loadRevision;
    return async function* (this: ReaderView, signal: AbortSignal) {
      for (let number = 1; doc && number <= doc.numPages; number++) {
        if (signal.aborted || revision !== this.loadRevision || doc !== this.doc || this.destroyed) return;
        // Use the same ordered text/OCR layer the reader can select, and reveal
        // its source before queuing speech. Raw PDF producer order can interleave columns.
        await this.navigateToReference(number, [], undefined, false);
        if (signal.aborted || revision !== this.loadRevision) return;
        const layer = this.pages.get(number)?.textLayer;
        const text = Array.from(layer?.querySelectorAll("span") ?? [])
          .map(span => span.textContent ?? "").join("\n") || this.pageTextCache.get(number) || "";
        yield { text, label: `第 ${number} 页` };
      }
    }.bind(this);
  }

  private async updateNotebook(patch: { style?: NotebookStyle; pageCount?: number }): Promise<void> {
    if (!this.loadedPath || !this.notebook) return;
    const path = this.loadedPath, state = this.getState(), file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error("笔记本文件已不存在");
    await updateNotebook(this.plugin, file, patch);
    if (this.destroyed || this.loadedPath !== path) return;
    this.restoredState = { path, scale: this.scale, fitWidth:this.widthFitted, layout: this.layout, continuous: this.continuous, position: state.position as PdfReadingLocation };
    await this.loadFileByPath(path, true);
  }

  private async buildPageShells(estimatedSize: { w: number; h: number }): Promise<void> {
    clear(this.scrollEl);
    this.pages.clear();
    this.visiblePages.clear();
    this.folded.clear();
    this.bookmarked.clear();
    const meta = notebookMeta(this.plugin.store.getDocMeta(this.filePath ?? ""));
    this.layout = meta.pdfLayout === "spread" ? "spread" : "single";
    this.continuous = meta.pdfContinuous !== false;
    (meta.foldedPages ?? []).forEach((p) => this.folded.add(p));
    (meta.bookmarks ?? []).forEach((p) => this.bookmarked.add(p));
    for (let i = 1; i <= this.doc.numPages; i++) {
      const wrapper = el("div", { class: "ms-page", "data-page": String(i) });
      const entry = this.doc instanceof EditedPdfDocument ? this.doc.edits.pages[i - 1] : undefined;
      const original = entry && !entry.sourcePage ? {w:entry.width!,h:entry.height!} : estimatedSize;
      this.originalPageSizes.set(i, original);
      const width = original.w * (this.crop.right - this.crop.left), height = original.h * (this.crop.bottom - this.crop.top), rotated = this.getPdfPageRotation(i) % 180 !== 0;
      const size = { w: rotated ? height : width, h: rotated ? width : height };
      this.pageSizes.set(i, size);
      wrapper.style.width = `${Math.floor(size.w * this.scale)}px`;
      wrapper.style.height = `${Math.floor(size.h * this.scale)}px`;
      const bar = el("div", { class: "ms-page-bar" });
      const label = el("span", { class: "ms-page-num", text: `第 ${i} 页` });
      const foldBtn = el("button", { class: "ms-page-btn", title: "折叠 / 展开此页" });
      setIcon(foldBtn, "chevron-down");
      foldBtn.addEventListener("click", () => this.toggleFold(i));
      const bmBtn = el("button", { class: "ms-page-btn is-bm", title: "书签此页" });
      setIcon(bmBtn, "bookmark");
      bmBtn.addEventListener("click", () => this.toggleBookmark(i));
      bar.append(label, foldBtn, bmBtn);
      const reference = this.getPageReference(i);
      if (reference) {
        label.title = `${reference.sourcePath} · 第 ${reference.sourcePage} 页`; wrapper.dataset.referenceId = reference.id;
        const source = el("button",{class:"ms-page-btn",title:"查看原页面","aria-label":`查看第 ${i} 页的原页面`});setIcon(source,"arrow-up-right");source.addEventListener("click",()=>{void this.openPageSource(i).catch(error=>new Notice(String(error)));});bar.append(source);
      }
      const canvas = el("canvas", { class: "ms-page-canvas" }) as HTMLCanvasElement;
      canvas.width = canvas.height = 0;
      const textLayer = el("div", { class: "ms-text-layer" });
      const annLayer = el("div", { class: "ms-ann-layer" });
      wrapper.append(bar, canvas, textLayer, annLayer);
      if (this.folded.has(i)) wrapper.classList.add("ms-page-folded");
      if (this.bookmarked.has(i)) wrapper.classList.add("ms-page-bookmarked");
      this.scrollEl.append(wrapper);
      this.pages.set(i, {
        wrapper,
        canvas,
        textLayer,
        annLayer,
        renderedScale: -1,
        renderTask: null,
        textTask: null,
        renderPromise: null,
        renderingScale: null,
        revision: 0,
        lastUsed: 0,
        viewport: null,
        baseViewport: null,
      });
      this.observer?.observe(wrapper);
    }
    this.reflowPages(1);
    if (this.restoredState?.path === this.loadedPath) await this.applyRestoredState();
    else await this.renderPageUnit(1);
  }

  // ===== 单页渲染与有上限的页面缓存 =====
  refreshOcr(clearRecognized = false):void {
    if(clearRecognized){this.ocrRequest++;this.recognizedPages.clear();}
    this.pageTextCache.clear();
    for(const rec of this.pages.values()){this.cancelPage(rec);rec.renderingScale=null;rec.renderedScale=-1;}
    for(const page of new Set([...this.visiblePages,...this.unitPages(this.currentPage)]))void this.renderPage(page);
  }
  async recognizeCurrentPage():Promise<void> {
    const doc=this.doc,pageNum=this.currentPage,path=this.loadedPath,revision=this.loadRevision,request=++this.ocrRequest;
    const current=()=>!!doc&&this.doc===doc&&this.loadedPath===path&&this.loadRevision===revision&&this.ocrRequest===request&&!this.destroyed;
    if(!doc||!path)return;
    if(this.plugin.store.settings.appleOcrEngine===false){new Notice("请先在阅读设置中启用 OCR");return;}
    const canvas=document.createElement("canvas");
    try{
      const page=await doc.getPage(pageNum);if(!current())return;
      const base=this.getPageViewport(page,1),scale=Math.min(2,Math.sqrt(MAX_PAGE_PIXELS/Math.max(1,base.width*base.height))),viewport=this.getPageViewport(page,scale);
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const context=canvas.getContext("2d");if(!context)throw new Error("无法渲染页面");
      await page.render({canvasContext:context,viewport}).promise;if(!current())return;
      const words=await recognizeImage(this.app,canvas.toDataURL("image/png"),true,current);if(!current())return;
      this.recognizedPages.set(pageNum,words);this.refreshOcr();
      if(this.searchTerm)void this.runSearch(this.searchTerm);
      new Notice(words.length?`已识别第 ${pageNum} 页`:`第 ${pageNum} 页未识别到文字`);
    }catch(error){if(current())new Notice("识别失败："+String(error));}
    finally{canvas.width=canvas.height=0;}
  }
  renderPage(pageNum: number): Promise<void> {
    const rec = this.pages.get(pageNum);
    const doc = this.doc;
    if (!rec || !doc || this.destroyed || this.folded.has(pageNum) || !this.isPageShown(pageNum)) return Promise.resolve();
    rec.lastUsed = Date.now();
    const scale = this.scale;
    if (rec.renderPromise && rec.renderingScale === scale) return rec.renderPromise;
    if (rec.renderedScale === scale && !rec.renderPromise) return Promise.resolve();
    const previous = rec.renderPromise;
    this.cancelPage(rec);
    const revision = rec.revision;
    const loadRevision = this.loadRevision;
    rec.renderingScale = scale;
    const current = () => !this.destroyed && this.doc === doc && this.loadRevision === loadRevision &&
      this.pages.get(pageNum) === rec && rec.revision === revision;
    const promise = (async () => {
      try {
        // 同一 canvas 必须等旧 renderTask 完成取消，才可调整 backing store。
        if (previous) await previous;
        if (!current()) return;
        const page = await doc.getPage(pageNum);
        if (!current()) return;
        const original = (page.marginStudySourcePage ?? page).getViewport({ scale: 1 });
        this.originalPageSizes.set(pageNum, { w: original.width, h: original.height });
        const baseViewport = this.getPageViewport(page, scale);
        const viewport = extendProjection(baseViewport, this.extendNotes.gaps(pageNum, baseViewport, scale), regionFoldBands(this,pageNum,baseViewport));
        rec.baseViewport = baseViewport; rec.viewport = viewport;
        this.pageSizes.set(pageNum, { w: viewport.width / scale, h: viewport.height / scale });
        const dpr = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_PAGE_PIXELS / Math.max(1, viewport.width * viewport.height)));
        rec.wrapper.style.width = `${Math.floor(viewport.width)}px`;
        rec.wrapper.style.height = `${Math.floor(viewport.height)}px`;
        rec.canvas.style.width = `${Math.floor(viewport.width)}px`;
        rec.canvas.style.height = `${Math.floor(baseViewport.height)}px`;
        rec.canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        rec.canvas.height = Math.max(1, Math.floor(baseViewport.height * dpr));
        rec.textLayer.style.width = `${Math.floor(viewport.width)}px`;
        rec.textLayer.style.height = `${Math.floor(viewport.height)}px`;
        rec.textLayer.style.setProperty("--scale-factor", String(viewport.scale));
        rec.annLayer.style.width = `${Math.floor(viewport.width)}px`;
        rec.annLayer.style.height = `${Math.floor(viewport.height)}px`;
        const context = rec.canvas.getContext("2d");
        if (!context) return;
        const task = page.render({ canvasContext: context, viewport: baseViewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
        rec.renderTask = task;
        await task.promise;
        if (!current()) return;
        rec.renderTask = null;
        clear(rec.textLayer);
        try {
          const text = await page.getTextContent();
          if (!current()) return;
          rec.textTask = pdfjsLib.renderTextLayer({ textContentSource: text, container: rec.textLayer, viewport: baseViewport });
          await rec.textTask.promise;
          const words=this.recognizedPages.get(pageNum);
          if(current()&&!rec.textLayer.querySelector('span')&&words){
            rec.textLayer.removeAttribute("data-main-rotation");
            for(const word of words){
              const width=word.w*viewport.width,height=word.h*baseViewport.height;
              if(!word.text.trim()||width<=0||height<=0)continue;
              const span=el("span",{text:word.text}),fontSize=height;
              span.style.cssText=`left:${word.x*viewport.width}px;top:${(1-word.y-word.h)*baseViewport.height}px;font-family:Helvetica,sans-serif;font-size:${fontSize}px;line-height:1;height:${height}px;transform-origin:0 0;`;
              context.font=`${fontSize}px Helvetica`;const measured=context.measureText(word.text).width;
              if(measured)span.style.transform=`scaleX(${width/measured})`;
              rec.textLayer.append(span,document.createElement("br"));
            }
            if(words.length)this.pageTextCache.set(pageNum,mergeOcrWords(words));
          }
          if(current())orderTextColumns(rec.textLayer,baseViewport);
        } catch { /* 没有文字层的扫描 PDF 仍可阅读及区域摘录。 */ }
        if (!current()) return;
        try{rec.imageRects=await pdfImageRegions(page);}catch{rec.imageRects=[];}
        if(!current())return;
        this.extendNotes.paint(pageNum, baseViewport);
        this.extendNotes.render(pageNum);
        renderRegionFolds(this, pageNum);
        rec.renderedScale = scale;
        if (this.searchTerm) this.applySearchHighlight(pageNum);
        this.annController.renderPage(pageNum);
      } catch (error: any) {
        if (current() && error?.name !== "RenderingCancelledException" && error?.name !== "AbortException") {
          console.error("MarginStudy render page:", error);
        }
      } finally {
        if (rec.revision === revision) {
          rec.renderTask = null;
          rec.textTask = null;
          rec.renderPromise = null;
          rec.renderingScale = null;
          this.evictOffscreenPages();
        }
      }
    })();
    rec.renderPromise = promise;
    return promise;
  }

  private cancelPage(rec: PageRecord): void {
    rec.revision++;
    try { rec.renderTask?.cancel(); } catch { /* noop */ }
    try { rec.textTask?.cancel(); } catch { /* noop */ }
    rec.renderTask = null;
    rec.textTask = null;
  }

  private releasePage(pageNum: number, rec: PageRecord): void {
    const pending = rec.renderPromise;
    this.cancelPage(rec);
    this.extendNotes.releasePage(pageNum);
    this.annController?.releasePage(pageNum);
    rec.canvas.width = rec.canvas.height = 0;
    rec.renderedScale = -1;
    rec.viewport = null; rec.baseViewport = null;
    rec.wrapper.querySelectorAll(":scope > .ms-extend-layer, :scope > .ms-region-fold").forEach(node => node.remove());
    rec.renderingScale = null;
    clear(rec.textLayer);
    clear(rec.annLayer);
    if (pending) void pending.finally(() => {
      if (rec.renderPromise === pending) rec.renderPromise = null;
    });
  }

  private evictOffscreenPages(): void {
    const cached = [...this.pages.entries()].filter(([, rec]) => rec.canvas.width > 0 && rec.canvas.height > 0);
    let pixels = cached.reduce((sum, [, rec]) => sum + rec.canvas.width * rec.canvas.height, 0);
    let count = cached.length;
    const candidates = cached.filter(([num]) => !this.visiblePages.has(num) && num !== this.navigationPage)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [num, rec] of candidates) {
      if (count <= MAX_CACHED_PAGES && pixels <= MAX_CACHED_PIXELS) break;
      pixels -= rec.canvas.width * rec.canvas.height;
      count--;
      this.releasePage(num, rec);
    }
  }

  // ===== 供标注层使用的访问器 =====
  async getEditableOutline(): Promise<DocumentOutlineItem[]> {
    const path = this.loadedPath, doc = this.doc;
    if (!path || !doc) return [];
    const saved = this.plugin.store.getDocMeta(path).documentOutline;
    const items = saved ?? (await getOutline(doc)).map((item, index) => ({ ...item, id: "embedded:" + index, pageId: this.getPdfPageId(item.page) }));
    if (this.loadedPath !== path || this.doc !== doc) throw new Error("文档已切换，目录读取已取消");
    return structuredClone(items).map(item => ({ ...item, page: item.pageId ? (this.getPdfPageEdits()?.pages.findIndex(page => page.id === item.pageId) ?? -1) + 1 : item.page }));
  }
  async setEditableOutline(items: DocumentOutlineItem[]): Promise<void> {
    const path = this.loadedPath, doc = this.doc;
    if (!path || !doc || this.destroyed || this.pendingLoad) throw new Error("文档正在更新，请稍后重试");
    const ids = new Set<string>(); let level = -1;
    const next = items.map(item => {
      if (!item.id || ids.has(item.id) || !item.title.trim() || !Number.isInteger(item.level) || item.level < 0 || item.level > level + 1 || !Number.isInteger(item.page) || item.page < 0 || item.page > doc.numPages) throw new Error("目录标题、层级或目标页面无效");
      ids.add(item.id); level = item.level;
      return { ...structuredClone(item), title: item.title.trim(), pageId: item.pageId ?? this.getPdfPageId(item.page) };
    });
    const previous = structuredClone(this.plugin.store.getDocMeta(path).documentOutline);
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    this.plugin.store.updateDocMeta(path, { documentOutline: next });
    this.annController.recordDocumentEdit("编辑目录", async redo => {
      if (this.destroyed || this.loadedPath !== path || this.pendingLoad) throw new Error("文档已切换，目录撤销已取消");
      const expected = redo ? previous : next;
      if (JSON.stringify(this.plugin.store.getDocMeta(path).documentOutline) !== JSON.stringify(expected)) throw new Error("目录已在其他视图修改，请重新操作");
      this.plugin.store.updateDocMeta(path, { documentOutline: structuredClone(redo ? next : previous) });
    });
  }
  navigateToOutline(item: DocumentOutlineItem): void {
    if (item.page > 0) void this.navigateToReference(item.page, item.rects ?? [], "pdf", false);
  }
  getDoc(): any {
    return this.doc;
  }
  getScale(): number {
    return this.scale;
  }
  getPagePdfHeight(pageNum: number): number {
    return this.originalPageSizes.get(pageNum)?.h ?? 0;
  }
  getPagePdfWidth(pageNum: number): number {
    return this.originalPageSizes.get(pageNum)?.w ?? 0;
  }
  getPageRecord(pageNum: number): PageRecord | undefined {
    return this.pages.get(pageNum);
  }
  getPageNumbers(): number[] {
    return Array.from(this.pages.keys());
  }
  getFilePath(): string | null {
    return this.filePath;
  }
  getScrollContainer(): HTMLElement {
    return this.scrollEl;
  }

  /** 触发某页重绘（标注变更后调用） */
  redrawPage(pageNum: number): void {
    this.annController?.renderPage(pageNum);
  }

  /** 跳转到标注并闪烁高亮 */
  flashAnnotation(annId: string): void {
    if(this.getExtendNotes().some(note=>note.id===annId)){void this.extendNotes.focus(annId);return;}
    this.annController?.flashAnnotation(annId);
  }

  flashExcerptBlock(annId: string, block: import("../types").ExcerptBlock): void {
    this.annController?.flashAnnotation(annId, block);
  }

  applyDocumentNotebookView(): void {
    void this.finishExtendEditing().then(() => this.extendNotes.sync());
    if (!this.doc || !this.loadedPath) return; const meta = notebookMeta(this.plugin.store.getDocMeta(this.loadedPath));
    this.folded = new Set(meta.foldedPages ?? []); this.bookmarked = new Set(meta.bookmarks ?? []);
    this.layout = meta.pdfLayout === "spread" ? "spread" : "single"; this.continuous = meta.pdfContinuous !== false;
    for (const [number, rec] of this.pages) {
      rec.wrapper.classList.toggle("ms-page-folded", this.folded.has(number)); rec.wrapper.classList.toggle("ms-page-bookmarked", this.bookmarked.has(number));
      rec.wrapper.querySelector(".ms-page-btn.is-bm")?.classList.toggle("is-on", this.bookmarked.has(number));
      if (this.folded.has(number)) this.releasePage(number, rec);
      else { const size = this.pageSizes.get(number); if (size) rec.wrapper.style.height = `${Math.floor(size.h * this.scale)}px`; }
    }
    if (this.thumbPanel) clear(this.thumbPanel); this.reflowPages(this.currentPage); this.speech?.stop();
    for (const number of this.unitPages(this.currentPage)) if (!this.folded.has(number)) void this.renderPage(number);
  }

  // ===== 书页折叠（MN4 风格） =====
  private toggleFold(pageNum: number): void {
    if (this.folded.has(pageNum)) this.folded.delete(pageNum);
    else this.folded.add(pageNum);
    if (this.filePath) updateNotebookMeta(this.plugin, this.filePath, { foldedPages: [...this.folded].sort((a,b) => a-b) });
    const rec = this.pages.get(pageNum);
    if (!rec) return;
    const folded = this.folded.has(pageNum);
    rec.wrapper.classList.toggle("ms-page-folded", folded);
    if (folded) this.releasePage(pageNum, rec);
    else {
      const size = this.pageSizes.get(pageNum);
      if (size) rec.wrapper.style.height = `${Math.floor(size.h * this.scale)}px`;
      void this.renderPage(pageNum);
    }
    // 同步缩略图状态
    this.thumbPanel
      ?.querySelector(`.ms-thumb-item[data-page="${pageNum}"]`)
      ?.classList.toggle("is-folded", folded);
  }

  // ===== 书签 =====
  isPageBookmarked(page: number): boolean { return this.bookmarked.has(page); }
  setPageBookmarked(page: number, bookmarked: boolean): void {
    if (!this.doc || !Number.isInteger(page) || page < 1 || page > this.doc.numPages) return;
    if (this.bookmarked.has(page) !== bookmarked) this.toggleBookmark(page);
  }
  private toggleBookmark(pageNum: number): void {
    if (this.bookmarked.has(pageNum)) this.bookmarked.delete(pageNum);
    else this.bookmarked.add(pageNum);
    if (this.filePath) updateNotebookMeta(this.plugin, this.filePath, { bookmarks: [...this.bookmarked].sort((a,b) => a-b) });
    const rec = this.pages.get(pageNum);
    rec?.wrapper.classList.toggle("ms-page-bookmarked", this.bookmarked.has(pageNum));
    rec?.wrapper.querySelector(".ms-page-btn.is-bm")?.classList.toggle("is-on", this.bookmarked.has(pageNum));
    this.thumbPanel
      ?.querySelector(`.ms-thumb-item[data-page="${pageNum}"]`)
      ?.classList.toggle("is-bookmarked", this.bookmarked.has(pageNum));
  }

  private gotoBookmark(dir: 1 | -1): void {
    const list = [...this.bookmarked].sort((a, b) => a - b);
    if (!list.length) {
      new Notice("暂无书签");
      return;
    }
    let target: number;
    if (dir === 1) {
      target = list.find((p) => p > this.currentPage) ?? list[0];
    } else {
      const before = list.filter((p) => p < this.currentPage);
      target = before.length ? before[before.length - 1] : list[list.length - 1];
    }
    this.gotoPage(target);
  }

  // ===== 缩略图面板 =====
  private toggleThumb(): void {
    if (!this.thumbPanel) return;
    const root = this.containerEl.children[1] as HTMLElement;
    if (!this.thumbPanel.childElementCount) this.renderThumbs();
    const open = !this.thumbPanel.classList.contains("is-open");
    this.thumbPanel.classList.toggle("is-open", open);
    root.classList.toggle("is-thumb", open);
    if (open) {
      // 面板展开后触发懒渲染
      this.thumbPanel
        .querySelectorAll(".ms-thumb-item")
        .forEach((it) => this.thumbObserver?.observe(it));
    }
  }

  private renderThumbs(): void {
    if (!this.thumbPanel || !this.doc || this.thumbPanel.childElementCount) return;
    const wrap = el("div", { class: "ms-thumb-list" });
    for (let i = 1; i <= this.getDisplayPages().length; i++) {
      const item = el("div", { class: "ms-thumb-item", "data-page": String(i) });
      const cv = el("canvas", { class: "ms-thumb-canvas" }) as HTMLCanvasElement;
      cv.width = cv.height = 0;
      const lab = el("span", { class: "ms-thumb-num", text: String(i) });
      item.append(cv, lab);
      if (this.bookmarked.has(i)) item.classList.add("is-bookmarked");
      if (this.folded.has(i)) item.classList.add("is-folded");
      item.addEventListener("click", () => {void this.gotoDisplayPage(i);});
      wrap.append(item);
      (item as any)._page = i;
      (item as any)._cv = cv;
      (item as any)._done = false;
    }
    this.thumbPanel.append(wrap);
  }

  private renderThumb(item: HTMLElement): void {
    if ((item as any)._done) return;
    (item as any)._done = true;
    const n = (item as any)._page as number;
    const cv = (item as any)._cv as HTMLCanvasElement;
    if(this.getDisplayPages().length!==(this.doc?.numPages??0)){void this.renderDisplayThumbnail(n,cv).catch(()=>{(item as any)._done=false;});return;}
    const doc = this.doc;
    const revision = this.loadRevision;
    if (!doc) return;
    void doc.getPage(n).then((pg: any) => {
      if (this.destroyed || revision !== this.loadRevision || doc !== this.doc || !item.isConnected) return;
      const vp = this.getPageViewport(pg, 1);
      const tw = 104;
      const scale = tw / vp.width;
      const v = this.getPageViewport(pg, scale);
      cv.width = Math.floor(v.width);
      cv.height = Math.floor(v.height);
      cv.style.width = cv.width + "px";
      cv.style.height = cv.height + "px";
      const ctx = cv.getContext("2d");
      if (ctx) {
        const task = pg.render({ canvasContext: ctx, viewport: v });
        this.thumbTasks.add(task);
        void task.promise.catch(() => {}).finally(() => this.thumbTasks.delete(task));
      }
    }).catch(() => { (item as any)._done = false; });
  }

  // ===== 双文对照（split） =====
  compare(openInWorkspace?: (file: TFile, sync: boolean) => Promise<void>): void {
    if (!this.filePath) return;
    const current = this.filePath;
    const { modal, close } = createModal("选择对照文档");
    const syncLabel = el("label");
    const sync = el("input", { type: "checkbox", "aria-label": "同步滚动" }) as HTMLInputElement;
    syncLabel.append(sync, document.createTextNode("同步滚动")); modal.append(syncLabel);
    const files = this.app.vault.getFiles().filter(file => file.path !== current && ["pdf", "msref", "docx", "epub", "html", "htm", "md"].includes(file.extension.toLowerCase()));
    if (!files.length) modal.append(el("p", { text: "没有其他可对照文档" }));
    for (const file of files) {
      const button = el("button", { text: file.path, "aria-label": "对照文档：" + file.path });
      button.addEventListener("click", () => {
        close();
        if (openInWorkspace) { void openInWorkspace(file, sync.checked).catch(error => new Notice(String(error))); return; }
        if (this.plugin.studyWorkspace) { void this.plugin.studyWorkspace.openMobileComparison(file, sync.checked).catch(error => new Notice("打开对照文档失败：" + String(error))); return; }
        const leaf = Platform.isMobile ? this.app.workspace.getLeaf("split", "horizontal") : this.app.workspace.openPopoutLeaf();
        void this.plugin.openDocument(file, { leaf }).then(reader => {
          if (!sync.checked) return;
          const left = this.getScrollContainer(), right = reader.getScrollContainer();
          let busy = false;
          const transfer = (source: HTMLElement, target: HTMLElement) => {
            if (busy || !source.isConnected || !target.isConnected) { if (!source.isConnected || !target.isConnected) { left.removeEventListener("scroll", fromLeft); right.removeEventListener("scroll", fromRight); } return; }
            busy = true; const range = source.scrollHeight - source.clientHeight; target.scrollTop = range > 0 ? source.scrollTop / range * Math.max(0, target.scrollHeight - target.clientHeight) : 0; requestAnimationFrame(() => { busy = false; });
          };
          const fromLeft = () => transfer(left, right), fromRight = () => transfer(right, left);
          left.addEventListener("scroll", fromLeft); right.addEventListener("scroll", fromRight);
        }).catch(error => new Notice("打开对照文档失败：" + String(error)));
      });
      modal.append(button);
    }
  }

  /** 供卡片关键词点击：在本文档内高亮搜索（蓝虚线） */
  searchInDoc(term: string): void {
    if (!term) return;
    void this.runSearch(term).catch((error) => console.warn("MarginStudy search:", error));
  }
}
