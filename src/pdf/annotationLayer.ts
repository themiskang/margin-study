/**
 * [INPUT]: 依赖 PDF 阅读器、标注基类、手写控制器和存储。
 * [OUTPUT]: 提供 PDF 标注控制器。
 * [POS]: 将手写栅格、回忆遮罩与摘录渲染到独立页面层。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type MarginStudyPlugin from "../main";
import { ReaderView } from "./readerView";
import { Annotation, AnnotationType, Card, HandwritingPresetId, PdfPageGeometry, PdfRect, Stroke } from "../types";
import { uid } from "../utils/id";
import { el } from "../utils/dom";
import { todayStr } from "../srs";
import { Notice, Platform, TFile } from "obsidian";
import { saveVoiceBlob } from "../audio/voice";
import { PenController, inkHitTest, measurePenCommit, paintInkStrokes } from "../annot/pen";
import { inkLayerOpacity } from "../annot/inkLayers";
import { handwritingPresetWidth } from "../annot/handwritingPresets";
import { BaseAnnotationController, SelTarget, VoiceTarget } from "../annot/baseController";
import { recognizeImage, mergeOcrWords } from "../ocr/ocr";
import { annotationGeometry, clientRectToPdfRect, uniquePdfRects } from "../anchors/pdfGeometry";
import { PageCollectionDocument, mapCollectionAnnotation } from "../documents/pageCollection";
import type { LinkedPageAnnotation } from "../documents/pageCollection";
import { boundedOverlayBox } from "../annot/overlay";
import type { OverlayBox, OverlaySurface } from "../annot/overlay";
import { projectPagePoint, sourcePagePoint, projectPageInk, sourcePageInk } from "./pageCrop";
import { EditedPdfDocument, mapEditedPdfAnnotation } from "./editedDocument";
import { handwritingSource } from "../documents/readingPosition";
import type { HandwritingSource } from "../documents/readingPosition";

type PenCommit = (strokes: Stroke[][]) => void;
type PageInkEntry = { ann: Annotation; strokes: Stroke[][]; projected: Stroke[][]; fingerprint: string; reference: boolean; masks: HTMLElement[] };
type PageInkRaster = { canvas: HTMLCanvasElement; maskLayer: HTMLElement; layer: HTMLElement; wrapper: HTMLElement; width: number; height: number; ratio: number; scale: number; projection: string; recall: boolean; entries: PageInkEntry[]; observer: ResizeObserver | null; click: (event: MouseEvent) => void };

/** PDF 标注控制器：坐标换算、rects 增量渲染、per-page 手写（继承公共基类） */
export class AnnotationController extends BaseAnnotationController {
  reader: ReaderView;
  getInkColor(): string { return this.color; }
  /** Public delete path used by the workspace/learning-set sync-delete contract. */
  deleteAnnotation(id: string): boolean {
    const annotation = this.cache.find(item => item.id === id);
    if (!annotation) return false;
    this.deleteAnn(annotation);
    return true;
  }

  // 标注 id → 渲染元素映射（性能优化 D：增量增删，避免整页重建）
  private elMap = new Map<string, { annId: string; els: HTMLElement[]; scale: number; page: number; fingerprint: string; strokes?: Stroke[][] }>();

  // 手写批注（仅平板）：每页一个 PenController
  private penControllers = new Map<number, PenController>();
  private inkRasters = new Map<number, PageInkRaster>();
  private inkRecall = false;

  // 套索/区域摘录
  private lassoOverlay: HTMLElement | null = null;
  private lassoStart = { x: 0, y: 0, page: 0 };
  private lassoActive = false;
  private cleanupLasso: (() => void) | null = null;

  constructor(plugin: MarginStudyPlugin, reader: ReaderView) {
    super(plugin);
    this.reader = reader;
    this.attach();
    this.bindLasso();
    window.addEventListener("resize", this.onInkViewportResize);
  }

  private onInkViewportResize = (): void => { for (const page of this.inkRasters.keys()) this.syncInkRaster(page); };

  protected getScrollContainer(): HTMLElement {
    return this.reader.getScrollContainer();
  }

  protected getBodyEl(): HTMLElement {
    // PDF 无单一 body，返回滚动容器作占位（渲染走 renderOne，不依赖此值）
    return this.reader.getScrollContainer();
  }

  protected onLoadDoc(): void {
    this.elMap.clear();
    for (const page of this.inkRasters.keys()) this.releaseInkRaster(page);
  }

  protected onAnnotationsChanged(): void { this.refreshAll(); }
  protected onTitleLinksChanged(): void { this.refreshAll(); this.renderTitleLinks(); }
  protected onDocumentNotebookChanged(): void { this.reader.applyDocumentNotebookView(); }
  protected prepareAnnotation(ann: Annotation, geometryChanged = true): void {
    if (!geometryChanged && ann.pdfReferencePages?.length) return;
    if (this.reader.getPdfPageEdits()) {
      ann.pdfReferencePages = annotationGeometry(ann).flatMap(part => { const id = geometryChanged ? this.reader.getPdfPageId(part.page) : `source:${part.page}`; return id ? [{ id, page: part.page }] : []; });
      return;
    }
    if (!(this.reader.getDoc() instanceof PageCollectionDocument)) return;
    ann.pdfReferencePages = annotationGeometry(ann).flatMap((part) => { const entry=this.reader.getPageReference(part.page); return entry ? [{id:entry.id,page:part.page}] : []; });
  }
  protected mapAnnotationForDisplay(ann: Annotation): Annotation {
    const doc=this.reader.getDoc();return doc instanceof PageCollectionDocument ? mapCollectionAnnotation(ann,doc.pageCollection) : doc instanceof EditedPdfDocument ? mapEditedPdfAnnotation(ann,doc.edits) : ann;
  }
  protected getAnnotationsForDisplay(): Annotation[] {
    const local=super.getAnnotationsForDisplay(),doc=this.reader.getDoc();
    return doc instanceof PageCollectionDocument ? [...local,...doc.getLinkedAnnotations().map((ann)=>({...ann,documentNotebookId:this.getDocumentNotebookId()}))] : local;
  }
  getPdfExportAnnotations(): import("./exportAnnotations").PdfExportAnnotation[] {
    return this.getAnnotationsForDisplay().filter(ann => ann.type !== "pen" || this.isInkVisible(ann)).map(annotation => ({
      annotation: structuredClone(annotation), opacity: inkLayerOpacity(this.isNotebookReference(annotation) || (annotation.type === "pen" || !!annotation.overlay) && this.isInkReference(annotation)),
    }));
  }
  protected onAnnClick(ann: Annotation, ev: MouseEvent): void {
    const source=(ann as LinkedPageAnnotation).referenceSource;
    if(source){ev.stopPropagation();if(this.handleRecallClick(ann,ev))return;void(async()=>{const file=this.plugin.app.vault.getAbstractFileByPath(source.docPath);if(!(file instanceof TFile))throw new Error("源文档已不存在");const reader=await this.plugin.openDocument(file);await (reader as any).selectDocumentNotebook?.(source.notebookId);reader.flashAnnotation(source.anchorAnnId);})().catch(error=>new Notice(String(error)));return;}
    const stored = this.cache.find(item => item.id === ann.id) ?? ann;
    const previous = this.popEl;
    super.onAnnClick(stored,ev);
    if (this.popEl && this.popEl !== previous && this.hasExtendSource(stored.id)) {
      const action = el("button", {text:"留白"});
      action.addEventListener("click", () => { this.removePop(); void this.extendAnnotation(stored.id).catch(error => new Notice(String(error))); });
      this.popEl.append(action);
    }
  }

  protected cancelRegionGesture(): void {
    this.cleanupLasso?.();
    this.cleanupLasso = null;
    this.lassoActive = false;
    this.lassoOverlay?.remove();
    this.lassoOverlay = null;
  }
  abortActiveGestures(): void {
    this.cancelRegionGesture();
    this.resetPenGestureWatch();
    for (const pen of this.penControllers.values()) pen.abortActiveGesture();
  }
  protected onReleaseDocument(): void { this.cancelRegionGesture(); for (const page of this.inkRasters.keys()) this.releaseInkRaster(page); }

  async destroy(): Promise<void> {
    this.getScrollContainer().removeEventListener("pointerdown", this.onLassoPointerDown);
    window.removeEventListener("resize", this.onInkViewportResize);
    await super.destroy();
    for (const page of this.inkRasters.keys()) this.releaseInkRaster(page);
    this.elMap.clear();
  }

  /** 页面回收时同时清掉覆盖层引用，保留 sidecar 中的批注。 */
  releasePage(pageNum: number): void {
    const pen = this.penControllers.get(pageNum);
    pen?.destroy();
    this.penControllers.delete(pageNum);
    this.releaseInkRaster(pageNum);
    for (const [id, entry] of this.elMap) {
      if (entry.page !== pageNum) continue;
      entry.els.forEach((element) => this.detachAnnotationElement(element));
      this.elMap.delete(id);
    }
  }

  protected onColorChanged(): void {
    for (const pc of this.penControllers.values()) pc.color = this.color;
  }
  protected flushPen(commitDrawing = true): void { for (const pen of this.penControllers.values()) pen.flush(commitDrawing); }
  protected onPenToolChanged(): void { for (const pen of this.penControllers.values()) pen.setTool(this.penTool); }
  protected placeTextInExtend(event: MouseEvent): boolean { return this.reader.placeExtendText(event); }
  protected resolveOverlaySurface(event: MouseEvent, width: number, height: number): OverlaySurface | null {
    const page = (event.target as HTMLElement).closest<HTMLElement>(".ms-page"); if (!page) return null;
    const pageNum = Number(page.dataset.page), rec = this.reader.getPageRecord(pageNum);
    if (!rec?.viewport || rec.renderedScale !== this.reader.getScale()) return null;
    const bounds = rec.annLayer.getBoundingClientRect(), scale = this.reader.getScale();
    return this.overlaySurface(pageNum, boundedOverlayBox({ left: event.clientX - bounds.left, top: event.clientY - bounds.top, width: width * scale, height: height * scale }, rec.annLayer.clientWidth,rec.annLayer.clientHeight));
  }
  protected getOverlaySurface(ann: Annotation): OverlaySurface | null {
    ann = this.mapAnnotationForDisplay(this.cache.find(stored => stored.id === ann.id) ?? ann);
    const geometry = annotationGeometry(ann).find(part => part.page === ann.page), rect = geometry?.rects[0];
    const box = rect && this.reader.projectRect(ann.page,rect,ann.pdfCoordinateSpace); return box ? this.overlaySurface(ann.page,box) : null;
  }
  protected getOverlayBoxMetrics(ann: Annotation): { left: number; top: number; width: number; height: number; containerWidth: number; containerHeight: number } | null {
    const mapped = this.mapAnnotationForDisplay(ann);
    const geometry = annotationGeometry(mapped).find(part => part.page === mapped.page), rect = geometry?.rects[0];
    if (!rect) return null;
    const box = this.reader.projectRect(mapped.page, rect, mapped.pdfCoordinateSpace);
    const rec = this.reader.getPageRecord(mapped.page);
    if (!box || !rec) return null;
    const containerWidth = rec.annLayer.clientWidth || rec.viewport?.width || 0;
    const containerHeight = rec.annLayer.clientHeight || rec.viewport?.height || 0;
    return containerWidth > 0 && containerHeight > 0 ? { ...box, containerWidth, containerHeight } : null;
  }
  protected projectInkForHost(ann: Annotation, strokes: Stroke[][]): Stroke[][] {
    return this.reader.projectAnnotationInk(ann.page, strokes, false);
  }
  protected unprojectInkForHost(ann: Annotation, strokes: Stroke[][]): Stroke[][] {
    return this.reader.projectAnnotationInk(ann.page, strokes, true);
  }
  private overlaySurface(page: number, box: OverlayBox): OverlaySurface | null {
    const rec = this.reader.getPageRecord(page); if (!rec?.viewport || rec.renderedScale !== this.reader.getScale()) return null;
    return { parent: rec.annLayer, handlesParent: rec.handlesLayer, box, fontScale: this.reader.getScale(), geometry: value => {
      if (!rec.viewport || rec.renderedScale !== this.reader.getScale()) return null;
      const canvas = rec.canvas.getBoundingClientRect(), bounds = rec.annLayer.getBoundingClientRect();
      const rect = clientRectToPdfRect({ left: bounds.left+value.left, top: bounds.top+value.top, width: value.width, height: value.height, right: bounds.left+value.left+value.width, bottom: bounds.top+value.top+value.height },canvas,rec.viewport);
      return rect ? { page,docKind:"pdf",rects:[rect],pdfGeometry:[{page,rects:[rect]}],pdfCoordinateSpace:"pdf" } : null;
    } };
  }

  // ===== 选区 → PDF 坐标矩形 =====
  protected resolveSelection(range: Range): SelTarget | null {
    const scroll = this.getScrollContainer();
    if (range.collapsed || !scroll.contains(range.startContainer) || !scroll.contains(range.endContainer)) return null;
    const pdfGeometry: PdfPageGeometry[] = [];
    for (const page of this.reader.getPageNumbers()) {
      const rec = this.reader.getPageRecord(page);
      if (!rec?.viewport || rec.renderedScale !== this.reader.getScale() || !range.intersectsNode(rec.textLayer)) continue;
      // Clip the DOM range to each page's text layer; wrapper/bar rectangles must never become highlights.
      const local = document.createRange();
      local.selectNodeContents(rec.textLayer);
      if (rec.textLayer.contains(range.startContainer)) local.setStart(range.startContainer, range.startOffset);
      if (rec.textLayer.contains(range.endContainer)) local.setEnd(range.endContainer, range.endOffset);
      const canvas = rec.canvas.getBoundingClientRect();
      const clients: DOMRect[] = [];
      const walker = document.createTreeWalker(rec.textLayer, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!local.intersectsNode(node)) continue;
        const text = document.createRange(); text.selectNodeContents(node);
        if (local.startContainer === node) text.setStart(node, local.startOffset);
        if (local.endContainer === node) text.setEnd(node, local.endOffset);
        for (const client of Array.from(text.getClientRects())) clients.push(client);
      }
      const rects = uniquePdfRects(clients.map((rect) => clientRectToPdfRect(rect, canvas, rec.viewport!))
        .filter((rect): rect is PdfRect => rect !== null));
      if (rects.length) pdfGeometry.push({ page, rects });
    }
    const first = pdfGeometry[0];
    return first ? { kind: "pdf", pageNum: first.page, rects: first.rects, pdfGeometry, pdfCoordinateSpace: "pdf" } : null;
  }

  protected selectionActions(target: SelTarget, text: string): {id?:string;icon?:string;label:string;run:()=>Promise<void>}[] {
    if (target.kind !== "pdf" || !this.reader.getPdfPageEdits()) return [];
    const revision = this.documentRevision;
    const extend = async (mode: "text" | "pen" = "text") => {
      await this.reader.finishExtendEditing();
      if (revision !== this.documentRevision || !this.docPath) return;
      const existing = this.cache.find(ann => (ann.documentNotebookId ?? "default") === this.getDocumentNotebookId() && ann.text === text && ann.type === "highlight" && JSON.stringify(ann.pdfGeometry) === JSON.stringify(target.pdfGeometry));
      const ann: Annotation = existing ?? {id:uid("ann"),docPath:this.docPath,docKind:"pdf",page:target.pageNum,type:"highlight",rects:target.rects,pdfGeometry:target.pdfGeometry,pdfCoordinateSpace:target.pdfCoordinateSpace,text,color:this.color,createdAt:todayStr()};
      if (!existing) this.pushAnnotation(ann);
      await this.extendAnnotation(ann.id);

      if (mode === "pen" && revision === this.documentRevision && this.docPath) {
        await this.reader.finishExtendEditing();
        if (revision === this.documentRevision && this.docPath) this.reader.setHandwritingMode("pen");
      }
    };
    return [{ id: "fold", icon: "fold-vertical", label: "折叠", run: async () => {
      if (revision === this.documentRevision && this.docPath) await this.reader.foldSelection(target.pdfGeometry ?? [{page:target.pageNum,rects:target.rects}]);
    }}, { id: "insert-toc", label: "插入目录", run: async () => {
      const items = await this.reader.getEditableOutline();
      if (revision !== this.documentRevision || !this.docPath) return;
      const item = {id:uid("toc"),title:text.trim(),page:target.pageNum,level:0,rects:target.rects};
      const index = items.findIndex(entry => entry.level === 0 && entry.page > item.page);
      items.splice(index < 0 ? items.length : index, 0, item);
      await this.reader.setEditableOutline(items);new Notice("已添加文档目录条目");
    }}, { id: "extend", label: "留白", run: () => extend() },
      { id: "extend-text", icon: "type", label: "文本", run: () => extend("text") },
      { id: "extend-ink", icon: "between-horizontal-start", label: "留白", run: () => extend("pen") }];
  }
  hasExtendSource(id: string): boolean {
    const ann = this.cache.find(item => item.id === id);
    return !!ann && (ann.documentNotebookId ?? "default") === this.getDocumentNotebookId() && !ann.overlay && ["highlight","underline","region","strike","note"].includes(ann.type) && !!annotationGeometry(this.mapAnnotationForDisplay(ann)).some(part => part.page > 0 && part.rects.length);
  }
  async extendAnnotation(id: string): Promise<void> {
    const revision = this.documentRevision;
    if (!this.hasExtendSource(id)) return;
    const ann = this.mapAnnotationForDisplay(this.cache.find(item => item.id === id)!);
    const parts = annotationGeometry(ann).filter(part => part.page > 0 && part.rects.length), part = parts[parts.length-1];
    await this.reader.renderPage(part.page);
    if (revision !== this.documentRevision || !this.hasExtendSource(id)) return;
    const rec = this.reader.getPageRecord(part.page); if (!rec?.viewport) return;
    const boxes = part.rects.map(rect => this.reader.projectRect(part.page,rect,ann.pdfCoordinateSpace)).filter(Boolean) as {left:number;top:number;width:number;height:number}[];
    if (!boxes.length) return;
    const bottom = Math.max(...boxes.map(box => box.top+box.height));
    const anchor = this.reader.projectAnnotationPoint(part.page,{x:boxes[0].left/rec.viewport.width,y:Math.min(1,(bottom+1)/rec.viewport.height)},true);
    await this.reader.createLinkedExtend(part.page,anchor,id);
  }
  addExtendSourceToMindmap(id: string): void {
    if (!this.hasExtendSource(id)) return;
    this.addRegionToMindmap(this.cache.find(item => item.id === id)!);
  }
  ensureExtendSourceCard(id: string): Card | undefined {
    if(!this.hasExtendSource(id))return;
    const ann=this.cache.find(item=>item.id===id)!;
    if(!ann.cardId||!this.plugin.store.getCard(ann.cardId))this.makeCard(ann,"excerpt",true);
    return ann.cardId?this.plugin.store.getCard(ann.cardId):undefined;
  }
  async createRegionExtend(page: number, client: DOMRect): Promise<void> {
    const rec = this.reader.getPageRecord(page);
    if (!this.docPath || !rec?.viewport) return;
    const rect = clientRectToPdfRect(client, rec.canvas.getBoundingClientRect(), rec.viewport);
    if (!rect) return;
    const bounds = rec.canvas.getBoundingClientRect();
    const image = this.captureRegion(page, client.left - bounds.left, client.top - bounds.top, client.width, client.height);
    const ann: Annotation = { id: uid("ann"), docPath: this.docPath, docKind: "pdf", page, type: "region", rects: [rect], pdfGeometry: [{page,rects:[rect]}], pdfCoordinateSpace: "pdf", text: "", image, color: this.color, createdAt: todayStr() };
    this.pushAnnotation(ann);
    if (this.plugin.store.settings.autoCardOnRegion) this.makeCard(ann,"excerpt",true);
    await this.extendAnnotation(ann.id);
  }

  protected commitAnnotation(target: SelTarget, type: AnnotationType, color: string, text: string): void {
    if (!this.docPath || target.kind !== "pdf") return;
    const ann: Annotation = {
      id: uid("ann"),
      docPath: this.docPath,
      docKind: "pdf",
      page: target.pageNum,
      type,
      rects: target.rects,
      pdfGeometry: target.pdfGeometry,
      pdfCoordinateSpace: target.pdfCoordinateSpace,
      text,
      color,
      createdAt: todayStr(),
    };
    if (type === "note") ann.noteText = "";
    this.pushAnnotation(ann);
    this.showExcerptMenu(ann);
  }

  protected resolveVoiceTarget(e: MouseEvent): VoiceTarget | null {
    let node: Node | null = e.target as Node;
    let pageEl: HTMLElement | null = null;
    while (node && node !== document.body) {
      if (node instanceof HTMLElement && node.classList.contains("ms-page")) {
        pageEl = node;
        break;
      }
      node = node.parentElement;
    }
    if (!pageEl) return null;
    const pageNum = Number(pageEl.dataset.page);
    const r = pageEl.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    return { ...this.reader.projectAnnotationPoint(pageNum, { x, y }, true), page: pageNum };
  }

  protected async commitVoice(blob: Blob, target: VoiceTarget): Promise<void> {
    if (!this.docPath) return;
    const docPath = this.docPath, documentNotebookId = this.getDocumentNotebookId();
    const path = await saveVoiceBlob(this.plugin.app, docPath, blob);
    if (this.docPath !== docPath) return;
    const ann: Annotation = {
      id: uid("ann"),
      docPath,
      documentNotebookId,
      docKind: "pdf",
      page: target.page ?? 1,
      type: "voice",
      rects: [],
      text: "",
      color: this.color,
      audioPath: path,
      mediaKind: "audio",
      mediaName: path.split("/").pop(),
      pos: { x: target.x, y: target.y },
      createdAt: todayStr(),
    };
    this.pushAnnotation(ann);
    this.recordMediaEdit(ann, true);
  }

  // ===== 手写批注（仅平板） =====
  protected setupPen(): void {
    for (const num of this.reader.getPageNumbers()) this.setupPenForPage(num);
  }

  private setupPenForPage(num: number): void {
    if (this.penControllers.has(num)) return;
    const rec = this.reader.getPageRecord(num);
    if (!rec?.viewport || !rec.canvas.width) return;
    const layerId = this.getInkLayers().active, notebookId = this.getDocumentNotebookId(), crop = this.reader.getPageCrop(), rotation = this.reader.getPdfPageRotation(num);
    let source: HandwritingSource | undefined;
    const pc = new PenController(rec.wrapper, {
      getColor: () => this.getHandwritingPreset().color,
      getWidth: () => handwritingPresetWidth(this.getHandwritingPreset(), "document"),
      getOpacity: () => this.getHandwritingPreset().opacity,
      isVanishPen: () => this.isVanishPen(),
      onBegin: () => { source = handwritingSource(this.plugin.store.documents ?? [], this.docPath, num); },
      onActionBegin: () => this.ensurePenRevision(),
      onInputActivity: change => this.plugin.store.noteInputActivity?.(change),
      onCommit: (strokes, brush, width, opacity) => this.createPenAnnotation(num, strokes, layerId, notebookId, brush, width, opacity, undefined, source),
      onPaste: (entries) => this.pastePenAnnotations(num, entries, layerId, notebookId, source),
      onExcerpt: (_selection, bounds, image) => this.excerptLassoSelection(num, bounds, image),
      onUnbind: (ids) => this.unbindInkAnnotations(ids),
      onSelectionChange: (hasSelection) => {
        if (hasSelection) {
          for (const [page, other] of this.penControllers) {
            if (page !== num) other.clearSelection();
          }
        }
      },
      getInk: () => this.getPenRecords(num, layerId).map(record => ({ ...record, strokes: this.reader.projectAnnotationInk(num, record.strokes) })),
      onChange: (changes) => this.commitPenChanges(changes, { project: strokes => this.reader.projectAnnotationInk(num, strokes), unproject: strokes => this.reader.projectAnnotationInk(num, strokes, true) }),
      onUndo: () => this.undoPenChange(), onRedo: () => this.redoPenChange(),
    });
    this.watchPenGestures(rec.wrapper.querySelector<SVGSVGElement>(":scope > .ms-pen-overlay")!);
    pc.color = this.color;
    pc.setTool(this.penTool);
    pc.setActive(true);
    this.penControllers.set(num, pc);
  }

  protected clearPenSelections(): void {
    for (const pc of this.penControllers.values()) pc.clearSelection();
  }
  protected teardownPen(): void {
    for (const pc of this.penControllers.values()) {
      pc.setActive(false);
      pc.destroy();
    }
    this.penControllers.clear();
  }

  private createPenAnnotation(pageNum: number, strokes: Stroke[][], layerId = this.getInkLayers().active, documentNotebookId = this.getDocumentNotebookId(), inkBrush: "pen" | "highlight" = "pen", inkWidth?: number, inkOpacity?: number, inkPreset?: HandwritingPresetId, source = handwritingSource(this.plugin.store.documents ?? [], this.docPath, pageNum), hostAnnotationId?: string): void {
    if (!this.docPath) return;
    const resolvedHostId = hostAnnotationId ?? this.findHostOverlayForStrokes(pageNum, strokes, layerId, documentNotebookId)?.id;
    const ann: Annotation = {
      id: uid("ann"),
      docPath: this.docPath,
      docKind: "pdf",
      page: pageNum,
      type: "pen",
      rects: [],
      text: "",
      color: this.getHandwritingPreset().color,
      strokes: measurePenCommit("projectMs", () => this.reader.projectAnnotationInk(pageNum, strokes, true)),
      inkBrush,
      inkRecallPurpose: inkBrush==="highlight" ? this.getHandwritingPreset().recallPurpose??"mask" : undefined,
      inkWidth: inkWidth ?? handwritingPresetWidth(this.getHandwritingPreset(), "document"),
      inkOpacity: inkOpacity ?? this.getHandwritingPreset().opacity,
      inkPreset: inkPreset ?? this.getActiveHandwritingPreset(),
      inkLayerId: layerId,
      ...(resolvedHostId ? { hostAnnotationId: resolvedHostId } : {}),
      documentNotebookId,
      ...source,
      createdAt: todayStr(),
    };
    this.pushAnnotation(ann);
  }
  private pastePenAnnotations(pageNum: number, entries: { strokes: Stroke[][]; brush: "pen" | "highlight"; color?: string; width?: number; opacity?: number }[], layerId: string, documentNotebookId: string, source?: HandwritingSource): void {
    if (!this.docPath || !entries.length) return;
    const resolvedSource = source ?? handwritingSource(this.plugin.store.documents ?? [], this.docPath, pageNum);
    const annotations: Annotation[] = entries.map(entry => ({
      id: uid("ann"),
      docPath: this.docPath!,
      docKind: "pdf",
      page: pageNum,
      type: "pen",
      rects: [],
      text: "",
      color: entry.color ?? this.getHandwritingPreset().color,
      strokes: this.reader.projectAnnotationInk(pageNum, entry.strokes, true),
      inkBrush: entry.brush,
      inkRecallPurpose: entry.brush === "highlight" ? this.getHandwritingPreset().recallPurpose ?? "mask" : undefined,
      inkWidth: entry.width ?? handwritingPresetWidth(this.getHandwritingPreset(), "document"),
      inkOpacity: entry.opacity ?? (entry.brush === "highlight" ? 0.32 : 1),
      inkLayerId: layerId,
      documentNotebookId,
      ...resolvedSource,
      createdAt: todayStr(),
    }));
    this.pushPastedPenAnnotations(annotations);
  }
  private excerptLassoSelection(pageNum: number, bounds: { x: number; y: number; width: number; height: number }, fallbackImage: string): void {
    if (!this.docPath) return;
    const rec = this.reader.getPageRecord(pageNum);
    if (!rec?.viewport) return;
    const wrapperRect = rec.wrapper.getBoundingClientRect();
    const canvasRect = rec.canvas.getBoundingClientRect();
    const client = {
      left: wrapperRect.left + bounds.x * wrapperRect.width,
      top: wrapperRect.top + bounds.y * wrapperRect.height,
      right: wrapperRect.left + (bounds.x + bounds.width) * wrapperRect.width,
      bottom: wrapperRect.top + (bounds.y + bounds.height) * wrapperRect.height,
      width: Math.max(4, bounds.width * wrapperRect.width),
      height: Math.max(4, bounds.height * wrapperRect.height),
    };
    const pdfRect = clientRectToPdfRect(client, canvasRect, rec.viewport) ?? { x: bounds.x, y: bounds.y, w: Math.max(0.01, bounds.width), h: Math.max(0.01, bounds.height) };
    const ix1 = Math.max(client.left, canvasRect.left), iy1 = Math.max(client.top, canvasRect.top);
    const ix2 = Math.min(client.right, canvasRect.right), iy2 = Math.min(client.bottom, canvasRect.bottom);
    const captured = ix2 - ix1 > 0 && iy2 - iy1 > 0
      ? this.captureRegion(pageNum, ix1 - canvasRect.left, iy1 - canvasRect.top, ix2 - ix1, iy2 - iy1)
      : undefined;
    const target: SelTarget = { kind: "pdf", pageNum, rects: [pdfRect], pdfGeometry: [{ page: pageNum, rects: [pdfRect] }], pdfCoordinateSpace: "pdf" };
    this.commitRegion(target, captured || fallbackImage, "");
  }

  // ===== 套索/区域摘录 =====
  private bindLasso(): void {
    const sc = this.getScrollContainer();
    sc.addEventListener("pointerdown", this.onLassoPointerDown);
  }

  private onLassoPointerDown = (e: PointerEvent): void => {
    if (!this.isLassoMode() || this.lassoActive || e.button !== 0 || e.isPrimary === false) return;
    const pageEl = this.findPageEl(e.clientX, e.clientY);
    if (!pageEl) return;
    e.preventDefault();
    e.stopPropagation();
    this.lassoActive = true;
    const rect = pageEl.getBoundingClientRect();
    this.lassoStart = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      page: Number(pageEl.dataset.page),
    };
    const overlay = el("div", { class: "ms-lasso" });
    overlay.style.left = `${this.lassoStart.x}px`;
    overlay.style.top = `${this.lassoStart.y}px`;
    overlay.style.width = "0px";
    overlay.style.height = "0px";
    pageEl.append(overlay);
    this.lassoOverlay = overlay;

    const pointerId = e.pointerId;
    const move = (ev: PointerEvent) => { if (ev.pointerId === pointerId) this.onLassoPointerMove(ev, pageEl); };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      this.cleanupLasso?.();
      this.cleanupLasso = null;
      void this.onLassoPointerUp(ev, pageEl);
    };
    const blur = () => this.cancelRegionGesture();
    this.cleanupLasso?.();
    this.cleanupLasso = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", blur);
    };
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === pointerId) this.cancelRegionGesture(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", blur);
  };

  private onLassoPointerMove(e: PointerEvent, pageEl: HTMLElement): void {
    if (!this.lassoActive || !this.lassoOverlay) return;
    const rect = pageEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const left = Math.min(this.lassoStart.x, x);
    const top = Math.min(this.lassoStart.y, y);
    const width = Math.abs(x - this.lassoStart.x);
    const height = Math.abs(y - this.lassoStart.y);
    this.lassoOverlay.style.left = `${left}px`;
    this.lassoOverlay.style.top = `${top}px`;
    this.lassoOverlay.style.width = `${width}px`;
    this.lassoOverlay.style.height = `${height}px`;
  }

  private async onLassoPointerUp(e: PointerEvent, pageEl: HTMLElement): Promise<void> {
    if (!this.lassoActive) return;
    const revision = this.documentRevision, regionSession = this.regionSession;
    const docPath = this.docPath;
    this.lassoActive = false;
    const overlay = this.lassoOverlay;
    this.lassoOverlay = null;
    if (overlay) overlay.remove();

    const rect = pageEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const left = Math.min(this.lassoStart.x, x);
    const top = Math.min(this.lassoStart.y, y);
    const width = Math.abs(x - this.lassoStart.x);
    const height = Math.abs(y - this.lassoStart.y);
    if (width < 20 || height < 20) return;

    const pageNum = this.lassoStart.page;
    const rec = this.reader.getPageRecord(pageNum);
    if (!rec?.viewport || rec.renderedScale !== this.reader.getScale()) return;
    const canvas = rec.canvas.getBoundingClientRect();
    const client = { left: rect.left + left, top: rect.top + top, right: rect.left + left + width, bottom: rect.top + top + height, width, height };
    if(this.plugin.store.settings.excerptAutoExpandRect){
      const spans=[...rec.wrapper.querySelectorAll<HTMLElement>(".ms-text-layer span")].map(span=>span.getBoundingClientRect()).filter(box=>box.bottom>client.top&&box.top<client.bottom&&box.right>client.left&&box.left<client.right);
      if(spans.length){client.left=Math.max(canvas.left,Math.min(client.left,...spans.map(box=>box.left)));client.right=Math.min(canvas.right,Math.max(client.right,...spans.map(box=>box.right)));client.width=client.right-client.left;}
    }
    const pdfRect = clientRectToPdfRect(client, canvas, rec.viewport);
    if (!pdfRect) return;

    const ix1 = Math.max(client.left, canvas.left), iy1 = Math.max(client.top, canvas.top);
    const ix2 = Math.min(client.right, canvas.right), iy2 = Math.min(client.bottom, canvas.bottom);
    if (ix2 - ix1 <= 0 || iy2 - iy1 <= 0) return;

    // 截图
    const image = this.captureRegion(pageNum, ix1 - canvas.left, iy1 - canvas.top, ix2 - ix1, iy2 - iy1);

    const target: SelTarget = { kind: "pdf", pageNum, rects: [pdfRect], pdfGeometry: [{ page: pageNum, rects: [pdfRect] }], pdfCoordinateSpace: "pdf" };
    if (revision !== this.documentRevision || regionSession !== this.regionSession || docPath !== this.docPath) return;
    this.commitRegion(target, image, "");
  }

  protected async correctSelectionText(target:SelTarget,text:string):Promise<string> {
    if(target.kind!=="pdf"||this.plugin.store.settings.appleOcrEngine===false)return text;
    const revision=this.documentRevision,path=this.docPath;const current=()=>revision===this.documentRevision&&path===this.docPath;
    const parts=target.pdfGeometry??[{page:target.pageNum,rects:target.rects}],corrected:string[]=[];
    for(const part of parts)for(const rect of part.rects){
      const box=this.reader.projectRect(part.page,rect,"pdf");if(!box)return text;
      const image=this.captureRegion(part.page,box.left,box.top,box.width,box.height);if(!image)return text;
      const line=mergeOcrWords(await recognizeImage(this.plugin.app,image,true,current));if(!current()||!line.trim())return text;corrected.push(line);
    }
    return corrected.join("\n")||text;
  }
  private findPageEl(clientX: number, clientY: number): HTMLElement | null {
    const sc = this.getScrollContainer();
    const pages = sc.querySelectorAll<HTMLElement>(".ms-page");
    for (const p of Array.from(pages)) {
      const r = p.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return p;
    }
    return null;
  }

  private captureRegion(pageNum: number, left: number, top: number, width: number, height: number): string | undefined {
    const rec = this.reader.getPageRecord(pageNum);
    if (!rec) return undefined;
    const source = rec.canvas;
    // rec.canvas 是设备像素（viewport.width * dpr），而 left/top/width/height 是 CSS 像素，
    // 必须按 dpr 换算采样坐标，否则只会截到左上角 1/dpr 大小的错误区域（看着像“看不到全景”）。
    const dprX = source.width / Math.max(1, rec.canvas.clientWidth);
    const dprY = source.height / Math.max(1, rec.canvas.clientHeight);
    const tmp = document.createElement("canvas");
    tmp.width = Math.max(1, Math.floor(width * dprX));
    tmp.height = Math.max(1, Math.floor(height * dprY));
    const ctx = tmp.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(
      source,
      left * dprX,
      top * dprY,
      width * dprX,
      height * dprY,
      0,
      0,
      tmp.width,
      tmp.height
    );
    const raster = this.inkRasters.get(pageNum)?.canvas;
    if (raster?.width && raster.height && rec.annLayer.clientWidth && rec.annLayer.clientHeight) {
      const layerBounds = rec.annLayer.getBoundingClientRect(), sourceBounds = source.getBoundingClientRect();
      const rasterX = raster.width / rec.annLayer.clientWidth, rasterY = raster.height / rec.annLayer.clientHeight;
      ctx.drawImage(raster, (sourceBounds.left + left - layerBounds.left) * rasterX, (sourceBounds.top + top - layerBounds.top) * rasterY,
        width * rasterX, height * rasterY, 0, 0, tmp.width, tmp.height);
    }
    try {
      return tmp.toDataURL("image/jpeg", 0.85);
    } catch {
      return undefined;
    }
  }

  // ===== 渲染（增量，带 elMap） =====
  protected onReadingPreferencesChanged():void { for(const page of this.reader.getPageNumbers?.() ?? [])this.renderMarginNotes(page); }
  private renderMarginNotes(pageNum:number):void {
    const rec=this.reader.getPageRecord(pageNum);if(!rec)return;rec.wrapper.querySelector(':scope > .ms-margin-notes')?.remove();
    if(rec.renderedScale!==this.reader.getScale())return;
    const settings=this.plugin.store.settings,layer=el('div',{class:'ms-margin-notes'}),all=this.getAnnotationsForDisplay().filter(ann=>ann.type!=='pen'&&ann.type!=='voice'&&!ann.overlay);
    let bottom=0;
    for(const [index,ann] of all.entries()){
      const part=annotationGeometry(ann).find(part=>part.page===pageNum),r=part?.rects[0],box=r&&this.reader.projectRect(pageNum,r,ann.pdfCoordinateSpace);if(!box)continue;
      if(!settings.hideMarginNumbers){const number=el('button',{class:'ms-margin-number','aria-label':`页边编号 ${index+1}`,text:String(index+1)});number.style.top=`${box.top}px`;number.addEventListener('click',event=>this.onAnnClick(ann,event));layer.append(number);}
      if(!settings.showFootnotesLinksOnMargin||!this.reader.getMarginCommentArea())continue;
      const card=ann.cardId?this.plugin.store.getCard(ann.cardId):undefined,note=[ann.noteText,card?.back].filter(Boolean).join('\n'),links=card?.links??[];
      if(!note&&!links.length)continue;const foot=el('div',{class:'ms-margin-footnote','aria-label':`页边脚注 ${index+1}`});foot.style.top=`${Math.max(box.top,bottom)}px`;foot.append(el('span',{text:`${index+1}. ${note}`}));
      for(const id of links){const linked=this.plugin.store.getCard(id);if(!linked)continue;const link=el('button',{text:linked.title||linked.front.slice(0,60),'aria-label':`页边链接 ${id}`});link.addEventListener('click',()=>{this.plugin.viewEvents?.onDocumentCardSelect?.(id);void(async()=>{const file=this.plugin.app.vault.getAbstractFileByPath(linked.docPath);if(file instanceof TFile){const reader=await this.plugin.openDocument(file);await(reader as any).selectDocumentNotebook?.(linked.documentNotebookId??'default');if(linked.anchorAnnId)reader.flashAnnotation(linked.anchorAnnId);}})().catch(error=>new Notice(String(error)));});foot.append(link);}
      layer.append(foot);bottom=Math.max(box.top,bottom)+Math.max(36,Math.ceil(note.length/24)*18+links.length*24)+8;
    }rec.wrapper.append(layer);
  }
  protected assistiveCandidates(): import('../annot/baseController').AssistiveCandidate[] {
    const result:import('../annot/baseController').AssistiveCandidate[]=[];
    for(const page of this.reader.getPageNumbers()){
      const rec=this.reader.getPageRecord(page);if(!rec||rec.renderedScale!==this.reader.getScale())continue;
      for(const rect of rec.imageRects??[]){
        const box=this.reader.projectRect(page,rect,'pdf');if(!box||box.width<3||box.height<3)continue;const canvas=rec.canvas.getBoundingClientRect();
        result.push({box:new DOMRect(canvas.left+box.left,canvas.top+box.top,box.width,box.height),text:'',target:{kind:'pdf',pageNum:page,rects:[rect],pdfGeometry:[{page,rects:[rect]}],pdfCoordinateSpace:'pdf'},image:()=>this.captureRegion(page,box.left,box.top,box.width,box.height)});
      }
      for(const span of rec.textLayer.querySelectorAll<HTMLElement>('span')){
        const range=document.createRange();range.selectNodeContents(span);const target=this.resolveSelection(range),box=range.getBoundingClientRect();
        if(target&&range.toString().trim()&&box.width>0&&box.height>0)result.push({box,text:range.toString().trim(),target,range});if(result.length>=200)return result;
      }
    }return result;
  }
  private releaseInkRaster(pageNum: number): void {
    const state = this.inkRasters.get(pageNum); if (!state) return;
    state.observer?.disconnect(); state.wrapper.removeEventListener("click", state.click);
    state.entries.forEach(entry => entry.masks.forEach(mask => this.detachAnnotationElement(mask)));
    state.maskLayer.remove(); state.canvas.remove(); state.canvas.width = state.canvas.height = 0; this.inkRasters.delete(pageNum);
  }

  private inkProjection(pageNum: number): string {
    const crop = this.reader.getPageCrop(), rec = this.reader.getPageRecord(pageNum), viewport: any = rec?.viewport;
    const height = rec?.baseViewport?.height ?? viewport?.height ?? 0;
    return JSON.stringify([crop.left, crop.top, crop.right, crop.bottom, this.reader.getPdfPageRotation(pageNum),
      ...[0, .125, .25, .375, .5, .625, .75, .875, 1].map(value => viewport?.extendDown?.(value * height) ?? value * height)]);
  }

  private rasterRatio(): number {
    const mobile = Platform.isMobile || document.body.classList.contains("is-mobile") || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    return mobile ? Math.min(window.devicePixelRatio || 1, 1.25) : window.devicePixelRatio || 1;
  }

  private ensureInkRaster(pageNum: number): { state: PageInkRaster; reset: boolean } | null {
    const rec = this.reader.getPageRecord(pageNum);
    if (!rec?.viewport || !rec.canvas.width || rec.renderedScale !== this.reader.getScale()) return null;
    const width = rec.annLayer.clientWidth, height = rec.annLayer.clientHeight; if (!width || !height) return null;
    let state = this.inkRasters.get(pageNum);
    if (state && (state.layer !== rec.annLayer || state.canvas.parentElement !== rec.wrapper)) { this.releaseInkRaster(pageNum); state = undefined; }
    let reset = false;
    if (!state) {
      const canvas = document.createElement("canvas"); canvas.className = "ms-ink-raster"; canvas.setAttribute("aria-hidden", "true");
      canvas.getContext("2d", { willReadFrequently: true });
      const maskLayer = el("div", { class: "ms-ink-masks" });
      const click = (event: MouseEvent) => this.onInkClick(pageNum, event);
      state = { canvas, maskLayer, layer: rec.annLayer, wrapper: rec.wrapper, width: 0, height: 0, ratio: 0, scale: -1, projection: "", recall: this.inkRecall, entries: [], observer: null, click };
      this.inkRasters.set(pageNum, state); rec.annLayer.after(canvas, maskLayer); rec.wrapper.addEventListener("click", click);
      if (typeof ResizeObserver !== "undefined") { state.observer = new ResizeObserver(() => this.syncInkRaster(pageNum)); state.observer.observe(rec.annLayer); }
      reset = true;
    }
    const ratio = this.rasterRatio(), scale = this.reader.getScale(), projection = this.inkProjection(pageNum);
    if (state.width !== width || state.height !== height || state.ratio !== ratio || state.scale !== scale || state.projection !== projection) {
      state.width = width; state.height = height; state.ratio = ratio; state.scale = scale; state.projection = projection;
      state.canvas.width = Math.max(1, Math.ceil(width * ratio)); state.canvas.height = Math.max(1, Math.ceil(height * ratio)); reset = true;
    }
    return { state, reset };
  }

  private paintRasterEntry(state: PageInkRaster, entry: PageInkEntry, dirty = false): void {
    if (state.recall && entry.reference) return;
    const context = state.canvas.getContext("2d"); if (!context) return;
    context.setTransform(state.canvas.width / state.width, 0, 0, state.canvas.height / state.height, 0, 0);
    if (dirty) {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const stroke of entry.projected) for (const point of stroke) {
        left = Math.min(left, point.x * state.width); top = Math.min(top, point.y * state.height);
        right = Math.max(right, point.x * state.width); bottom = Math.max(bottom, point.y * state.height);
      }
      if (!Number.isFinite(left)) return;
      const thickness = entry.ann.inkWidth ?? (entry.ann.inkBrush === "highlight" ? 16 : 3);
      const padding = (entry.ann.inkBrush === "highlight" ? thickness : thickness * 5.8 / 3) / 2 + 2 / state.ratio;
      context.save(); context.beginPath(); context.rect(left - padding, top - padding, right - left + padding * 2, bottom - top + padding * 2); context.clip();
    }
    paintInkStrokes(context, entry.projected, state.width, state.height, entry.ann.color, entry.ann.inkBrush, entry.ann.inkWidth, entry.ann.inkOpacity, entry.reference);
    if (dirty) context.restore();
  }

  private appendInkAnnotation(pageNum: number, ann: Annotation): void {
    const ensured = this.ensureInkRaster(pageNum); if (!ensured) return;
    const { state } = ensured;
    if (ensured.reset) { this.syncInkRaster(pageNum, undefined, true); return; }
    const annotations = this.getAnnotationsForDisplay().filter(candidate => candidate.type === "pen" && !candidate.overlay && !!candidate.strokes?.length && this.isInkVisible(candidate) && annotationGeometry(candidate).some(geometry => geometry.page === pageNum));
    if (!ensured.reset && state.recall === this.inkRecall && annotations.length === state.entries.length && state.entries.every((entry, index) => entry.ann.id === annotations[index].id && entry.strokes === annotations[index].strokes && entry.fingerprint === this.annotationFingerprint(annotations[index]) && entry.reference === this.isInkReference(annotations[index]))) return;
    if (ensured.reset || state.recall !== this.inkRecall || annotations.length !== state.entries.length + 1 || annotations[annotations.length - 1]?.id !== ann.id ||
      !state.entries.every((entry, index) => entry.ann.id === annotations[index].id && entry.strokes === annotations[index].strokes && entry.fingerprint === this.annotationFingerprint(annotations[index]) && entry.reference === this.isInkReference(annotations[index]))) {
      this.syncInkRaster(pageNum, annotations); return;
    }
    const projected = this.reader.projectAnnotationInk(pageNum, ann.strokes!);
    const entry: PageInkEntry = { ann, strokes: ann.strokes!, projected, fingerprint: this.annotationFingerprint(ann), reference: this.isInkReference(ann), masks: this.appendRecallInkMasks(state.maskLayer, ann, projected, state.width, state.height) };
    entry.masks.forEach(mask => {
      const nbRef = this.isNotebookReference(ann);
      mask.classList.toggle("ms-ink-reference", entry.reference);
      mask.classList.toggle("ms-document-notebook-reference", nbRef);
      this.markReferenceElement(mask, entry.reference || nbRef, "recall-mask");
    });
    state.entries.push(entry); this.paintRasterEntry(state, entry, true);
  }

  private syncInkRaster(pageNum: number, annotations?: Annotation[], force = false): void {
    const ensured = this.ensureInkRaster(pageNum); if (!ensured) return;
    const { state } = ensured;
    const visible = (annotations ?? this.getAnnotationsForDisplay().filter(ann => annotationGeometry(ann).some(geometry => geometry.page === pageNum)))
      .filter(ann => ann.type === "pen" && !ann.overlay && !!ann.strokes?.length && this.isInkVisible(ann));
    const match = (entry: PageInkEntry, ann: Annotation) => entry.ann.id === ann.id && entry.strokes === ann.strokes &&
      entry.fingerprint === this.annotationFingerprint(ann) && entry.reference === this.isInkReference(ann);
    const incremental = !force && !ensured.reset && state.recall === this.inkRecall && visible.length === state.entries.length && state.entries.every((entry, index) => match(entry, visible[index]));
    state.recall = this.inkRecall;
    if (!incremental) {
      state.entries.forEach(entry => entry.masks.forEach(mask => this.detachAnnotationElement(mask)));
      state.entries = []; const context = state.canvas.getContext("2d");
      context?.setTransform(1, 0, 0, 1, 0, 0); context?.clearRect(0, 0, state.canvas.width, state.canvas.height);
    }
    for (const ann of incremental ? [] : visible) {
      const projected = this.reader.projectAnnotationInk(pageNum, ann.strokes!);
      const entry: PageInkEntry = { ann, strokes: ann.strokes!, projected, fingerprint: this.annotationFingerprint(ann), reference: this.isInkReference(ann), masks: this.appendRecallInkMasks(state.maskLayer, ann, projected, state.width, state.height) };
      entry.masks.forEach(mask => {
      const nbRef = this.isNotebookReference(ann);
      mask.classList.toggle("ms-ink-reference", entry.reference);
      mask.classList.toggle("ms-document-notebook-reference", nbRef);
      this.markReferenceElement(mask, entry.reference || nbRef, "recall-mask");
    });
      state.entries.push(entry); this.paintRasterEntry(state, entry);
    }
  }

  private onInkClick(pageNum: number, event: MouseEvent): void {
    const state = this.inkRasters.get(pageNum); if (!state || event.defaultPrevented) return;
    const target = event.target as Element | null;
    if (target?.closest(".ms-ann, .ms-pen-overlay, .ms-overlay-handles-layer, .ms-extend-layer, button, a, input, textarea, select")) return;
    const bounds = state.layer.getBoundingClientRect(); if (!bounds.width || !bounds.height) return;
    const point = { x: (event.clientX - bounds.left) * state.width / bounds.width, y: (event.clientY - bounds.top) * state.height / bounds.height };
    const context = state.canvas.getContext("2d"); if (!context) return;
    for (const entry of [...state.entries].reverse()) {
      if (entry.reference || !inkHitTest(context, entry.projected, state.width, state.height, point, entry.ann.inkBrush, entry.ann.inkWidth)) continue;
      event.stopPropagation(); this.onAnnClick(entry.ann, event); return;
    }
  }

  protected syncOcclusionElements(): void {
    const recall = !!this.getScrollContainer().closest(".ms-reader-root")?.classList.contains("ms-recall");
    if (recall !== this.inkRecall) {
      this.inkRecall = recall;
      for (const page of this.inkRasters.keys()) this.syncInkRaster(page);
    }
    super.syncOcclusionElements();
  }

  renderPage(pageNum: number): void {
    const rec = this.reader.getPageRecord(pageNum);
    if (!rec || rec.renderedScale !== this.reader.getScale()) return;
    if (this.penMode) this.setupPenForPage(pageNum);
    const scale = this.reader.getScale();
    const inCache = this.getAnnotationsForDisplay().filter((a) => (a.type !== "pen" || this.isInkVisible(a)) && annotationGeometry(a).some((geometry) => geometry.page === pageNum));
    this.syncInkRaster(pageNum, inCache);
    if (this.penMode) this.penControllers.get(pageNum)?.refreshSelection();
    const inCacheIds = new Set(inCache.map((a) => a.id));
    // 1. 移除本页已不存在的标注元素（增量删除，不再整页 clear——性能优化 D）
    for (const [id, entry] of this.elMap) {
      if (entry.page === pageNum && !inCacheIds.has(entry.annId)) {
        entry.els.forEach((e) => this.detachAnnotationElement(e));
        this.elMap.delete(id);
      }
    }
    // 2. 新增 / scale 变化需重建的标注：仅处理缺失或过期项，已是最新的跳过
    for (const a of inCache) {
      if (a.type === "pen" && !a.overlay) continue;
      const entry = this.elMap.get(this.pageKey(a.id, pageNum));
      const live =
        entry &&
        entry.scale === scale &&
        entry.fingerprint === this.annotationFingerprint(a) &&
        (a.type !== "pen" || entry.strokes === a.strokes) &&
        entry.els.length > 0 &&
        entry.els.every((e) => e.parentElement === rec.annLayer);
      if (live) continue;
      if (entry) entry.els.forEach((e) => this.detachAnnotationElement(e));
      this.renderOnPage(a, pageNum, annotationGeometry(a).find((geometry) => geometry.page === pageNum)?.rects ?? []);
    }
    this.syncOcclusionElements();this.refreshAssistiveExcerpt();this.renderTitleLinks();this.renderMarginNotes(pageNum);
  }

  protected renderOne(ann: Annotation): void {
    ann=this.mapAnnotationForDisplay(ann);
    if (!this.isAnnotationVisible(ann) || (ann.overlay && !this.isInkVisible(ann))) return;
    if (ann.type === "pen" && !ann.overlay) {
      for (const geometry of annotationGeometry(ann)) this.appendInkAnnotation(geometry.page, ann);
      this.syncOcclusionElements(); return;
    }
    for (const geometry of annotationGeometry(ann)) this.renderOnPage(ann, geometry.page, geometry.rects);
    if (ann.type !== "pen") this.onReadingPreferencesChanged();
    this.syncOcclusionElements();
  }

  private pageKey(annId: string, page: number): string { return `${page}\u0000${annId}`; }

  private renderOnPage(ann: Annotation, pageNum: number, rects: PdfRect[]): void {
    const rec = this.reader.getPageRecord(pageNum);
    if (!rec || rec.renderedScale !== this.reader.getScale()) return;
    const scale = this.reader.getScale();
    const key = this.pageKey(ann.id, pageNum);
    // 幂等：先清理该标注可能残留的旧元素（便于缩放重建/重复渲染）
    const old = this.elMap.get(key);
    if (old) old.els.forEach((e) => this.detachAnnotationElement(e));

    const made: HTMLElement[] = [];
    const finish = () => {
      const nbRef = this.isNotebookReference(ann);
      made.forEach((element) => {
        element.classList.toggle("ms-document-notebook-reference", nbRef);
        const isRef = nbRef || (!!ann.overlay && this.isInkReference(ann));
        this.markReferenceElement(element, isRef, this.referenceKindFor(ann, element));
      });
      made.forEach((element) => element.classList.toggle("ms-reference-source", !!(ann as LinkedPageAnnotation).referenceSource));
      this.elMap.set(key, { annId: ann.id, els: made, scale, page: pageNum, fingerprint: this.annotationFingerprint(ann), strokes: ann.strokes });
    };

    if (ann.overlay && !ann.overlay.deleted) {
      const surface = this.getOverlaySurface(ann);
      if (surface) made.push(this.renderFreeOverlay(ann,surface));
      finish(); return;
    }

    if (ann.type === "voice" && ann.audioPath) {
      const w = rec.annLayer.clientWidth;
      const h = rec.annLayer.clientHeight;
      const holder = el("div", { class: "ms-ann ms-ann-voice" });
      holder.textContent = ann.mediaKind==="video"?"▶":"🎙";
      holder.dataset.annId = ann.id;
      const point = this.reader.projectAnnotationPoint(pageNum, ann.pos ?? { x: .5, y: .5 });
      holder.style.left = `${(point.x * w).toFixed(1)}px`;
      holder.style.top = `${(point.y * h).toFixed(1)}px`;
      holder.title = "点击播放语音批注";
      holder.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.onAnnClick(ann, ev);
      });
      rec.annLayer.append(holder);
      made.push(holder);
      finish();
      return;
    }

    if (ann.type === "region") {
      for (const r of rects) {
        const projected = this.reader.projectRect(pageNum, r, ann.pdfCoordinateSpace);
        if (!projected) continue;
        const { left, top, width, height } = projected;
        const div = el("div", { class: "ms-ann ms-ann-region", draggable: "true" });
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.width = `${width}px`;
        div.style.height = `${height}px`;
        div.style.borderColor = ann.color;
        div.dataset.annId = ann.id;
        div.title = ann.text ? ann.text.slice(0, 120) : "区域摘录";
        div.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.onAnnClick(ann, ev);
        });
        div.addEventListener("dragstart", (ev) => {
          ev.dataTransfer?.setData("text/plain", ann.cardId ?? "");
          ev.dataTransfer?.setData("application/margin-study-ann-id", ann.id);
        });
        rec.annLayer.append(div);
        made.push(div);
      }
      finish();
      return;
    }

    for (const r of rects) {
      const projected = this.reader.projectRect(pageNum, r, ann.pdfCoordinateSpace);
      if (!projected) continue;
      const { left, top, width, height } = projected;
      const div = el("div", { class: `ms-ann ms-ann-${ann.type}` });
      div.style.left = `${left}px`;
      div.style.top = `${top}px`;
      div.style.width = `${width}px`;
      div.style.height = `${height}px`;
      if (ann.type === "highlight") {
        div.style.background = ann.color;
      } else if (ann.type === "underline") {
        div.style.borderBottomColor = ann.color;
      } else if (ann.type === "strike") {
        div.style.background = ann.color;
        div.style.border = "0";
        div.style.height = "2px";
        div.style.top = `${top + height / 2 - 1}px`;
      } else {
        div.style.borderColor = ann.color;
        const dot = el("div", { class: "ms-ann-dot" });
        dot.style.background = ann.color;
        div.append(dot);
      }
      div.dataset.annId = ann.id;
      div.title = ann.type === "note" ? ann.noteText || "批注" : ann.text.slice(0, 80);
      div.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.onAnnClick(ann, ev);
      });
      rec.annLayer.append(div);
      made.push(div);
      if (ann.type === "highlight" || ann.type === "underline" || ann.type === "strike") {
        // 完整文字矩形上的不透明遮罩，不能只模糊 PDF 下方的独立色块。
        const mask = el("div", { class: "ms-ann ms-recall-mask", role: "button", tabindex: "0", "aria-label": "揭示摘录" });
        mask.dataset.annId = ann.id;
        mask.style.left = `${left}px`;
        mask.style.top = `${top}px`;
        mask.style.width = `${width}px`;
        mask.style.height = `${height}px`;
        mask.addEventListener("click", (event) => this.onAnnClick(ann, event));
        mask.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          mask.click();
        });
        rec.annLayer.append(mask);
        made.push(mask);
      }
    }
    finish();
  }

  protected removeAnnotationEl(ann: Annotation): void {
    for (const [key, entry] of this.elMap) {
      if (entry.annId !== ann.id) continue;
      entry.els.forEach((e) => this.detachAnnotationElement(e));
      this.elMap.delete(key);
    }
    if (ann.type === "pen" && !ann.overlay) for (const page of this.inkRasters.keys()) this.syncInkRaster(page);
    this.onReadingPreferencesChanged();
  }

  protected afterNoteEdited(ann: Annotation): void { this.renderOne(ann); }

  private annotationFingerprint(ann: Annotation): string {
    return JSON.stringify([ann.type, ann.rects, ann.pdfGeometry, ann.pdfCoordinateSpace, ann.color, ann.text, ann.noteText, ann.audioPath, ann.pos, ann.cardId, ann.inkLayerId, ann.bindToInkLayer, ann.hostAnnotationId, ann.inkBrush, ann.inkWidth, ann.inkOpacity, ann.inkRecallPurpose, ann.overlay, (ann.type === "pen" || !!ann.overlay) && this.isInkReference(ann)]);
  }

  refreshAll(): void {
    if (!this.docPath) return;
    const pages = new Set([...this.getAnnotationsForDisplay().flatMap((a) => annotationGeometry(a).map((geometry) => geometry.page)), ...[...this.elMap.values()].map((entry) => entry.page), ...this.inkRasters.keys()]);
    for (const p of pages) this.renderPage(p);
  }

  /** 跳转到某标注并高亮闪烁 */
  flashAnnotation(annId: string, block?: import("../types").ExcerptBlock): void {
    const stored = this.cache.find((a) => a.id === annId);
    if (stored?.overlay?.deleted) { new Notice("此自由批注已删除；已有卡片与来源身份仍保留"); return; }
    if (!stored) return; this.revealAnnotationNotebook(stored);
    const target = block?.target;
    const ann = this.mapAnnotationForDisplay(target?.kind === "pdf" ? { ...stored, page: target.pageNum, rects: target.rects, pdfGeometry: target.pdfGeometry, pdfCoordinateSpace: target.pdfCoordinateSpace } : stored);
    const geometry = annotationGeometry(ann).filter((entry)=>entry.page>0);
    const first = geometry.find((entry) => entry.rects.length) ?? geometry[0];
    if (!first) { new Notice("该标注的页面已从重组文档移除；原标注数据仍保留"); return; }
    const revision = this.documentRevision;
    void this.reader.navigateToReference(first.page, first.rects, ann.pdfCoordinateSpace).then((navigated) => {
      if (!navigated || revision !== this.documentRevision) return;
      this.renderPage(first.page);
      for (const entry of this.elMap.values()) {
        if (entry.annId !== annId) continue;
        entry.els.forEach((element) => element.classList.add("ms-ann-flash"));
        setTimeout(() => entry.els.forEach((element) => element.classList.remove("ms-ann-flash")), 1600);
      }
    });
  }
}
