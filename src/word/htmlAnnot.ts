import type MarginStudyPlugin from "../main";
import { Annotation, AnnotationType, DomRange, HandwritingPresetId, Stroke } from "../types";
import { uid } from "../utils/id";
import { el } from "../utils/dom";
import { todayStr } from "../srs";
import { Notice, sanitizeHTMLToDom } from "obsidian";
import { saveVoiceBlob } from "../audio/voice";
import { PenController } from "../annot/pen";
import { handwritingPresetWidth } from "../annot/handwritingPresets";
import { BaseAnnotationController, SelTarget, VoiceTarget } from "../annot/baseController";
import { NavigationHistory } from "../anchors/navigationHistory";
import { unionCssRects } from "../anchors/pdfGeometry";
import { boundedOverlayBox, positionOverlay } from "../annot/overlay";
import type { OverlayBox, OverlaySurface } from "../annot/overlay";

/** Word/HTML 阅读器需向标注控制器暴露的接口 */
export interface HtmlReader {
  getScrollContainer(): HTMLElement;
  getBodyEl(): HTMLElement;
  getFilePath(): string | null;
}

interface HtmlReadingLocation { section?: string; sectionOffset: number; ratio: number; left: number; }

/** Word/HTML 标注控制器：选区→字符偏移、wrapRange 增量渲染（继承公共基类） */
export class HtmlAnnotationController extends BaseAnnotationController {
  reader: HtmlReader;

  private originalHtml: string | null = null;

  // 桌面鼠标 / 触控笔手写：单实例
  private pen: PenController | null = null;

  // 套索/区域摘录
  private lassoOverlay: HTMLElement | null = null;
  private lassoStart = { x: 0, y: 0 };
  private lassoActive = false;
  private cleanupLasso: (() => void) | null = null;
  private unresolved = new Set<string>();
  private unresolvedNotice = "";
  private noticeQueued = false;
  private referenceRanges = new Map<string, { annotation: Annotation; element: HTMLElement }>();
  private referenceResize: ResizeObserver | null = null;
  private referenceFrame: number | null = null;
  private navigationHistory = new NavigationHistory<HtmlReadingLocation>((first, second) =>
    first.section === second.section && Math.abs(first.sectionOffset - second.sectionOffset) < 0.002 &&
    Math.abs(first.ratio - second.ratio) < 0.002 && Math.abs(first.left - second.left) < 2);

  constructor(plugin: MarginStudyPlugin, reader: HtmlReader) {
    super(plugin);
    this.reader = reader;
    this.attach();
    this.bindLasso();
    this.referenceResize = new ResizeObserver(this.queueReferenceLayout);
    this.referenceResize.observe(this.getBodyEl());
    this.getBodyEl().addEventListener("load", this.queueReferenceLayout, true);
    window.addEventListener("resize", this.queueReferenceLayout);
    document.fonts?.addEventListener("loadingdone", this.queueReferenceLayout);
  }

  protected getScrollContainer(): HTMLElement {
    return this.reader.getScrollContainer();
  }

  protected getBodyEl(): HTMLElement {
    return this.reader.getBodyEl();
  }

  protected onColorChanged(): void {
    if (this.pen) this.pen.color = this.color;
  }
  protected onTitleLinksChanged(): void { this.renderAll(); this.renderTitleLinks(); }

  protected onAnnotationsChanged(): void { this.renderAll(); }
  protected resolveOverlaySurface(event: MouseEvent, width: number, height: number): OverlaySurface | null {
    const body = this.getBodyEl(); if (!body.contains(event.target as Node)) return null;
    const bounds = body.getBoundingClientRect();
    return this.overlaySurface(boundedOverlayBox({ left:event.clientX-bounds.left-body.clientLeft,top:event.clientY-bounds.top-body.clientTop,width,height },body.clientWidth,body.clientHeight));
  }
  protected getOverlaySurface(ann: Annotation): OverlaySurface | null {
    const box = ann.overlay?.box, body = this.getBodyEl(); if (!box) return null;
    return this.overlaySurface({left:box.x*body.clientWidth,top:box.y*body.clientHeight,width:box.w*body.clientWidth,height:box.h*body.clientHeight});
  }
  private overlaySurface(box: OverlayBox): OverlaySurface | null {
    const body = this.getBodyEl(); if (body.clientWidth <= 0 || body.clientHeight <= 0) return null;
    return {parent:body,box,geometry:value=>({page:0,docKind:"html",rects:[],box:{x:value.left/body.clientWidth,y:value.top/body.clientHeight,w:value.width/body.clientWidth,h:value.height/body.clientHeight}})};
  }

  protected cancelRegionGesture(): void {
    this.cleanupLasso?.();
    this.cleanupLasso = null;
    this.lassoActive = false;
    this.lassoOverlay?.remove();
    this.lassoOverlay = null;
  }
  protected onReleaseDocument(): void {
    this.cancelRegionGesture();
    this.originalHtml = null;
    this.referenceRanges.clear();
    if (this.referenceFrame !== null) cancelAnimationFrame(this.referenceFrame);
    this.referenceFrame = null;
    this.unresolved.clear();
    this.unresolvedNotice = "";
    this.navigationHistory.clear();
  }

  async destroy(): Promise<void> {
    this.getBodyEl().removeEventListener("pointerdown", this.onLassoPointerDown);
    this.referenceResize?.disconnect(); this.referenceResize = null;
    this.getBodyEl().removeEventListener("load", this.queueReferenceLayout, true);
    window.removeEventListener("resize", this.queueReferenceLayout);
    document.fonts?.removeEventListener("loadingdone", this.queueReferenceLayout);
    await super.destroy();
  }

  protected assistiveCandidates():import('../annot/baseController').AssistiveCandidate[] {
    const text=super.assistiveCandidates(),images=[...this.getBodyEl().querySelectorAll<HTMLImageElement>('img')].filter(image=>!image.closest('.ms-ann,.ms-pen-overlay'));
    return [...images.slice(0,36).flatMap((image,index)=>{
      const box=image.getBoundingClientRect();if(!image.complete||!image.naturalWidth||box.width<3||box.height<3)return [];
      return [{box,text:'',target:{kind:'html' as const,range:{start:0,end:0,imageIndex:index,imageSource:image.getAttribute('src')??''}},image:()=>{try{const canvas=document.createElement('canvas'),factor=Math.min(1,Math.sqrt(4_000_000/(image.naturalWidth*image.naturalHeight)));canvas.width=Math.max(1,Math.round(image.naturalWidth*factor));canvas.height=Math.max(1,Math.round(image.naturalHeight*factor));canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png');}catch{new Notice('图片无法读取，未创建摘录');return undefined;}}}];
    }),...text].slice(0,200);
  }
  private regionSourceImage(ann:Annotation):HTMLImageElement|undefined {
    if(ann.range?.imageIndex===undefined)return undefined;
    const images=[...this.getBodyEl().querySelectorAll<HTMLImageElement>('img')].filter(image=>!image.closest('.ms-ann,.ms-pen-overlay')),image=images[ann.range.imageIndex];
    return image&&image.getAttribute('src')===ann.range.imageSource?image:undefined;
  }
  private layoutImageRegion(ann:Annotation,element:HTMLElement):void {
    const image=this.regionSourceImage(ann);element.hidden=!image;if(!image){this.unresolved.add(ann.id);return;}
    const box=image.getBoundingClientRect(),body=this.getBodyEl().getBoundingClientRect();element.style.cssText=`left:${box.left-body.left}px;top:${box.top-body.top}px;width:${box.width}px;height:${box.height}px;border-color:${ann.color}`;
  }
  // ===== 选区 → 字符偏移 =====
  protected resolveSelection(range: Range): SelTarget | null {
    const body = this.reader.getBodyEl();
    if (!body.contains(range.commonAncestorContainer)) return null;
    const start = this.offsetOf(body, range.startContainer, range.startOffset);
    const end = this.offsetOf(body, range.endContainer, range.endOffset);
    if (start < 0 || end <= start) return null;
    const sectionOf = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)
      ?.closest<HTMLElement>("[data-ms-section]");
    const firstSection = sectionOf(range.startContainer);
    const lastSection = sectionOf(range.endContainer);
    const section = firstSection && firstSection === lastSection && body.contains(firstSection)
      ? firstSection.dataset.msSection : undefined;
    const scope = section ? firstSection! : body;
    const text = this.textNodes(scope).map((node) => node.data).join("");
    const localStart = this.offsetOf(scope, range.startContainer, range.startOffset);
    const localEnd = this.offsetOf(scope, range.endContainer, range.endOffset);
    const firstRect = Array.from(range.getClientRects()).find((rect) => rect.width > 0 && rect.height > 0);
    const sectionBounds = section ? firstSection!.getBoundingClientRect() : null;
    // This is MarginStudy's own 0..1 chapter ratio. It is a coarse fallback, never a text match.
    const sectionRatio = sectionBounds && firstRect ? Math.min(1, Math.max(0, (firstRect.top - sectionBounds.top) / Math.max(1, sectionBounds.height))) : undefined;
    return { kind: "html", range: { start, end, section, exact: text.slice(localStart, localEnd),
      prefix: text.slice(Math.max(0, localStart - 64), localStart), suffix: text.slice(localEnd, localEnd + 64), sectionRatio } };
  }

  /** 计算节点内偏移在 body 全文中的全局字符位置 */
  private offsetOf(body: HTMLElement, node: Node, offset: number): number {
    let total = 0;
    for (const n of this.textNodes(body)) {
      if (n === node) return total + offset;
      total += (n.textContent || "").length;
    }
    if (node.nodeType !== Node.TEXT_NODE && body.contains(node)) {
      const before = document.createRange();
      before.selectNodeContents(body);
      before.setEnd(node, offset);
      const fragment = before.cloneContents();
      fragment.querySelectorAll(".ms-ann,.ms-pen-overlay,script,style").forEach((element) => element.remove());
      return (fragment.textContent ?? "").length;
    }
    return -1;
  }

  private textNodes(scope: HTMLElement): Text[] {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const result: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.parentElement?.closest(".ms-ann,.ms-pen-overlay,script,style")) result.push(node as Text);
    }
    return result;
  }

  /** 文字引用只接受唯一最佳匹配；章节内找不到时不跳到另一个章节的同名句子。 */
  private locateRange(ann: Annotation): { start: number; end: number } | null {
    if (!ann.range) return null;
    const body = this.getBodyEl();
    const range = ann.range;
    let scope = body;
    if (range.section) {
      const section = Array.from(body.querySelectorAll<HTMLElement>("[data-ms-section]"))
        .find((element) => element.dataset.msSection === range.section);
      if (!section) return null;
      scope = section;
    }
    const nodes = this.textNodes(scope);
    const text = nodes.map((node) => node.data).join("");
    const base = scope === body ? 0 : (nodes[0] ? this.offsetOf(body, nodes[0], 0) : -1);
    if (base < 0) return null;
    if (!range.exact) {
      // 老版 sidecar 没有文字引用，保留有效的全局字符偏移。
      const length = this.textNodes(body).reduce((sum, node) => sum + node.length, 0);
      return range.start >= 0 && range.end > range.start && range.end <= length
        ? { start: range.start, end: range.end } : null;
    }
    const candidates: { start: number; score: number }[] = [];
    let from = 0;
    let index: number;
    while ((index = text.indexOf(range.exact, from)) >= 0) {
      const prefix = range.prefix ?? "";
      const suffix = range.suffix ?? "";
      let score = 0;
      for (let n = 1; n <= Math.min(prefix.length, index); n++) {
        if (prefix[prefix.length - n] !== text[index - n]) break;
        score++;
      }
      const after = index + range.exact.length;
      for (let n = 0; n < Math.min(suffix.length, text.length - after); n++) {
        if (suffix[n] !== text[after + n]) break;
        score++;
      }
      candidates.push({ start: index, score });
      from = index + 1;
    }
    candidates.sort((a, b) => b.score - a.score);
    if (!candidates.length || (candidates.length > 1 &&
      (candidates[0].score === 0 || candidates[0].score === candidates[1].score))) return null;
    return { start: base + candidates[0].start, end: base + candidates[0].start + range.exact.length };
  }

  private reportUnresolved(): void {
    if (this.noticeQueued) return;
    this.noticeQueued = true;
    queueMicrotask(() => {
      this.noticeQueued = false;
      const ids = [...this.unresolved].sort().join(",");
      this.getBodyEl().dataset.msUnresolvedAnnotations = String(this.unresolved.size);
      if (ids && ids !== this.unresolvedNotice) new Notice(`${this.unresolved.size} 条批注未定位：原文已变化或有多处相同文字，已保留原数据。`);
      this.unresolvedNotice = ids;
    });
  }

  protected commitAnnotation(target: SelTarget, type: AnnotationType, color: string, text: string): void {
    if (!this.docPath || target.kind !== "html") return;
    const ann: Annotation = {
      id: uid("ann"),
      docPath: this.docPath,
      docKind: "html",
      page: 0,
      type,
      rects: [],
      range: target.range,
      text,
      color,
      createdAt: todayStr(),
    };
    if (type === "note") ann.noteText = "";
    this.pushAnnotation(ann);
    this.showExcerptMenu(ann);
  }

  protected resolveVoiceTarget(e: MouseEvent): VoiceTarget | null {
    const body = this.reader.getBodyEl();
    const r = body.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    return { x, y };
  }

  protected async commitVoice(blob: Blob, target: VoiceTarget): Promise<void> {
    if (!this.docPath) return;
    const docPath = this.docPath, documentNotebookId = this.getDocumentNotebookId();
    const path = await saveVoiceBlob(this.plugin.app, docPath, blob);
    if (docPath !== this.docPath) return;
    const ann: Annotation = {
      id: uid("ann"),
      docPath,
      documentNotebookId,
      docKind: "html",
      page: 0,
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

  // ===== 手写（仅平板） =====
  protected setupPen(): void {
    if (this.pen) return;
    const body = this.reader.getBodyEl();
    const layerId = this.getInkLayers().active, notebookId = this.getDocumentNotebookId();
    const pc = new PenController(body, {
      getColor: () => this.getHandwritingPreset().color,
      getWidth: () => handwritingPresetWidth(this.getHandwritingPreset(), "document"),
      getOpacity: () => this.getHandwritingPreset().opacity,
      isVanishPen: () => this.isVanishPen(),
      onCommit: (strokes, brush, width, opacity) => this.createPenAnnotation(strokes, layerId, notebookId, brush, width, opacity),
      getInk: () => this.getPenRecords(undefined, layerId),
      onChange: (changes) => this.commitPenChanges(changes),
      onUndo: () => this.undoPenChange(), onRedo: () => this.redoPenChange(),
    });
    pc.color = this.color;
    pc.setTool(this.penTool);
    pc.setActive(true);
    this.pen = pc;
  }
  protected flushPen(): void { this.pen?.flush(); }
  protected onPenToolChanged(): void { this.pen?.setTool(this.penTool); }

  protected teardownPen(): void {
    if (this.pen) {
      this.pen.setActive(false);
      this.pen.destroy();
      this.pen = null;
    }
  }

  private createPenAnnotation(strokes: Stroke[][], layerId = this.getInkLayers().active, documentNotebookId = this.getDocumentNotebookId(), inkBrush: "pen" | "highlight" = "pen", inkWidth?: number, inkOpacity?: number, inkPreset?: HandwritingPresetId): void {
    if (!this.docPath) return;
    const ann: Annotation = {
      id: uid("ann"),
      docPath: this.docPath,
      docKind: "html",
      page: 0,
      type: "pen",
      rects: [],
      text: "",
      color: this.getHandwritingPreset().color,
      strokes,
      inkBrush,
      inkRecallPurpose: inkBrush==="highlight" ? this.getHandwritingPreset().recallPurpose??"mask" : undefined,
      inkWidth: inkWidth ?? handwritingPresetWidth(this.getHandwritingPreset(), "document"),
      inkOpacity: inkOpacity ?? this.getHandwritingPreset().opacity,
      inkPreset: inkPreset ?? this.getActiveHandwritingPreset(),
      inkLayerId: layerId,
      documentNotebookId,
      createdAt: todayStr(),
    };
    this.pushAnnotation(ann);
  }

  // ===== 套索/区域摘录 =====
  private bindLasso(): void {
    const body = this.getBodyEl();
    body.addEventListener("pointerdown", this.onLassoPointerDown);
  }

  private onLassoPointerDown = (e: PointerEvent): void => {
    if (!this.isLassoMode() || this.lassoActive || e.button !== 0 || e.isPrimary === false) return;
    const body = this.getBodyEl();
    const rect = body.getBoundingClientRect();
    e.preventDefault();
    e.stopPropagation();
    this.lassoActive = true;
    this.lassoStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const overlay = el("div", { class: "ms-lasso" });
    overlay.style.left = `${this.lassoStart.x}px`;
    overlay.style.top = `${this.lassoStart.y}px`;
    overlay.style.width = "0px";
    overlay.style.height = "0px";
    body.append(overlay);
    this.lassoOverlay = overlay;

    const pointerId = e.pointerId;
    const move = (ev: PointerEvent) => { if (ev.pointerId === pointerId) this.onLassoPointerMove(ev); };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      this.cleanupLasso?.();
      this.cleanupLasso = null;
      void this.onLassoPointerUp(ev);
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      this.cleanupLasso?.();
      this.cleanupLasso = null;
      this.lassoActive = false;
      this.lassoOverlay?.remove();
      this.lassoOverlay = null;
    };
    this.cleanupLasso?.();
    this.cleanupLasso = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  private onLassoPointerMove(e: PointerEvent): void {
    if (!this.lassoActive || !this.lassoOverlay) return;
    const body = this.getBodyEl();
    const rect = body.getBoundingClientRect();
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

  private async onLassoPointerUp(e: PointerEvent): Promise<void> {
    if (!this.lassoActive) return;
    const revision = this.documentRevision, regionSession = this.regionSession;
    const docPath = this.docPath;
    this.lassoActive = false;
    const overlay = this.lassoOverlay;
    this.lassoOverlay = null;
    if (overlay) overlay.remove();

    const body = this.getBodyEl();
    const rect = body.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const left = Math.min(this.lassoStart.x, x);
    const top = Math.min(this.lassoStart.y, y);
    const width = Math.abs(x - this.lassoStart.x);
    const height = Math.abs(y - this.lassoStart.y);
    if (width < 20 || height < 20) return;

    // 提取区域内的文本与图片
    const selRect = { left, top, right: left + width, bottom: top + height };
    const text = this.extractTextInRect(selRect);
    const image = await this.captureImageInRect(selRect);

    if (revision !== this.documentRevision || regionSession !== this.regionSession || docPath !== this.docPath) return;
    const fullText = text;
    const startNode = this.nodeAtOffset(body, selRect.left, selRect.top);
    const endNode = this.nodeAtOffset(body, selRect.right, selRect.bottom);
    let range: DomRange = { start: 0, end: 0 };
    if (startNode.nodeType === Node.TEXT_NODE && endNode.nodeType === Node.TEXT_NODE) {
      const selection = document.createRange();
      selection.setStart(startNode, 0); selection.setEnd(endNode, (endNode.textContent ?? "").length);
      const resolved = this.resolveSelection(selection);
      if (resolved?.kind === "html") range = resolved.range;
    }

    const target: SelTarget = { kind: "html", range };
    this.commitRegion(target, image, fullText);
  }

  private extractTextInRect(rect: { left: number; top: number; right: number; bottom: number }): string {
    const body = this.getBodyEl();
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const r = rectOfNode(n);
      if (!r) continue;
      const bodyR = body.getBoundingClientRect();
      const relTop = r.top - bodyR.top;
      const relBottom = r.bottom - bodyR.top;
      const relLeft = r.left - bodyR.left;
      const relRight = r.right - bodyR.left;
      if (
        relRight > rect.left &&
        relLeft < rect.right &&
        relBottom > rect.top &&
        relTop < rect.bottom
      ) {
        parts.push(n.textContent || "");
      }
    }
    return parts.join(" ").trim();
  }

  private async captureImageInRect(
    rect: { left: number; top: number; right: number; bottom: number }
  ): Promise<string | undefined> {
    const body = this.getBodyEl();
    const images = Array.from(body.querySelectorAll<HTMLImageElement>("img"));
    const bodyR = body.getBoundingClientRect();
    for (const img of images) {
      const r = img.getBoundingClientRect();
      const relLeft = r.left - bodyR.left;
      const relTop = r.top - bodyR.top;
      const relRight = relLeft + r.width;
      const relBottom = relTop + r.height;
      if (
        relRight > rect.left &&
        relLeft < rect.right &&
        relBottom > rect.top &&
        relTop < rect.bottom
      ) {
        return imageToDataUrl(img);
      }
    }
    return undefined;
  }

  private nodeAtOffset(body: HTMLElement, x: number, y: number): Node {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let best: Node | null = null;
    let bestDist = Infinity;
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const r = rectOfNode(n);
      if (!r) continue;
      const bodyR = body.getBoundingClientRect();
      const cx = bodyR.left + x;
      const cy = bodyR.top + y;
      const dx = Math.max(r.left, Math.min(r.right, cx)) - cx;
      const dy = Math.max(r.top, Math.min(r.bottom, cy)) - cy;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = n;
      }
    }
    return best ?? body;
  }

  // ===== 渲染（增量） =====
  /** 增量渲染单条标注（新增时调用，避免整文档重解析——性能优化 E） */
  protected renderOne(ann: Annotation): void {
    if (!this.isAnnotationVisible(ann) || (ann.overlay && !this.isInkVisible(ann))) return;
    if (ann.overlay && !ann.overlay.deleted) { const surface = this.getOverlaySurface(ann); if (surface) this.renderFreeOverlay(ann,surface); }
    else if (ann.range && (ann.type === "highlight" || ann.type === "underline" || ann.type === "strike" || ann.type === "note")) {
      this.wrapRange(ann);
    } else if (ann.type === "voice" && ann.audioPath) {
      this.appendVoiceMarker(ann);
    } else if (ann.type === "pen" && ann.strokes) {
      this.appendPen(ann);
    } else if (ann.type === "region") {
      this.appendRegion(ann);
    }
    this.layoutReferenceRanges();
    this.syncOcclusionElements();
  }

  /** 增量移除单条标注的 DOM（删除时调用，避免整文档重解析——性能优化 E） */
  protected removeAnnotationEl(ann: Annotation): void {
    // Rebuild from the preserved source so deleting an overlapping highlight reveals its neighbours.
    this.renderAll();
  }

  renderAll(): void {
    const body = this.reader.getBodyEl();
    if (this.originalHtml === null) return;
    this.unresolved.clear();
    this.referenceRanges.clear();
    this.disposeOverlayElements();
    // 保留正在使用的画笔 overlay，使另一分屏刷新批注时不打断指针捕获。
    const penOverlay = body.querySelector(".ms-pen-overlay");
    for (const child of Array.from(body.childNodes)) if (child !== penOverlay) child.remove();
    const template = document.createElement("template");
    template.innerHTML = this.originalHtml;
    body.insertBefore(template.content, penOverlay);
    for (const a of this.getAnnotationsForDisplay()) {
      if (a.overlay && !a.overlay.deleted) { const surface = this.getOverlaySurface(a); if (surface) this.renderFreeOverlay(a,surface); }
      else if (a.range && (a.type === "highlight" || a.type === "underline" || a.type === "strike" || a.type === "note")) {
        this.wrapRange(a);
      } else if (a.type === "voice" && a.audioPath) {
        this.appendVoiceMarker(a);
      } else if (a.type === "pen" && a.strokes) {
        this.appendPen(a);
      } else if (a.type === "region") {
        this.appendRegion(a);
      }
    }
    this.reportUnresolved();
    this.syncOcclusionElements();this.refreshAssistiveExcerpt();
  }

  private wrapRange(ann: Annotation): void {
    const body = this.reader.getBodyEl();
    const located = this.locateRange(ann);
    if (!located) {
      this.unresolved.add(ann.id);
      this.reportUnresolved();
      return;
    }
    this.unresolved.delete(ann.id);
    const { start, end } = located;
    // A reference notebook must never wrap the active notebook's text. Nested
    // wrappers would dim that text and remove it when references hide in recall.
    if (this.isNotebookReference(ann)) {
      const holder = el("div", { class: "ms-ann ms-html-reference-range", "aria-hidden": "true" });
      holder.dataset.annId = ann.id;
      body.append(holder);
      this.referenceRanges.set(ann.id, { annotation: ann, element: holder });
      this.layoutReferenceRange(ann, holder, located);
      return;
    }
    const nodes = this.textNodes(body);
    let total = 0;
    for (const node of nodes) {
      // 先累加偏移（无论是否已被其它标注包裹），保证重叠高亮的字符偏移对齐原文
      const len = (node.textContent || "").length;
      const ns = total;
      const ne = total + len;
      total = ne;
      // 跳过已处于其它标注 span 内的文本节点，避免重叠嵌套（健壮 J）
      if ((node.parentNode as HTMLElement | null)?.closest?.(".ms-hl")) continue;
      const s2 = Math.max(ns, start);
      const e2 = Math.min(ne, end);
      if (s2 >= e2) continue;
      const localS = s2 - ns;
      const localE = e2 - ns;
      const text = node.textContent || "";
      const before = text.slice(0, localS);
      const mid = text.slice(localS, localE);
      const after = text.slice(localE);
      const parent = node.parentNode;
      if (!parent) continue;
      const frag = document.createDocumentFragment();
      if (before) frag.append(document.createTextNode(before));
      const span = document.createElement("span");
      span.className = `ms-hl ms-hl-${ann.type}`;
      span.dataset.annId = ann.id;
      if (ann.type === "highlight") span.style.background = ann.color;
      else if (ann.type === "underline") span.style.borderBottom = `2px solid ${ann.color}`;
      else if (ann.type === "strike") {
        span.style.textDecoration = "line-through";
        span.style.textDecorationColor = ann.color;
      } else {
        span.style.borderBottom = `1px dashed ${ann.color}`;
      }
      span.textContent = mid;
      span.title = ann.noteText || (ann.type === "note" ? "批注" : ann.text.slice(0, 80));
      span.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.onAnnClick(ann, ev);
      });
      frag.append(span);
      if (after) frag.append(document.createTextNode(after));
      parent.replaceChild(frag, node);
    }
  }

  private queueReferenceLayout = (): void => {
    if (this.referenceFrame !== null) return;
    this.referenceFrame = requestAnimationFrame(() => {
      this.referenceFrame = null;
      this.layoutReferenceRanges();this.refreshAssistiveExcerpt();
    });
  };
  private layoutReferenceRanges(): void {
    for (const { annotation, element } of this.referenceRanges.values()) this.layoutReferenceRange(annotation, element);
    for (const ann of this.getAnnotationsForDisplay()) {
      if(ann.range?.imageIndex!==undefined){const element=[...this.getBodyEl().querySelectorAll<HTMLElement>('.ms-ann-region')].find(node=>node.dataset.annId===ann.id);if(element)this.layoutImageRegion(ann,element);}
      if (!ann.overlay) continue; const surface = this.getOverlaySurface(ann); if (!surface) continue;
      const element = [...this.getBodyEl().querySelectorAll<HTMLElement>(".ms-free-overlay")].find(node => node.dataset.annId === ann.id);
      if (element) positionOverlay(element,surface.box);
    }
  }
  private layoutReferenceRange(ann: Annotation, holder: HTMLElement, located = this.locateRange(ann)): void {
    holder.replaceChildren();
    const range = located && this.domRange(located.start, located.end);
    if (!range) { this.unresolved.add(ann.id); this.reportUnresolved(); return; }
    const body = this.getBodyEl(), bounds = body.getBoundingClientRect();
    const scaleX = body.offsetWidth ? bounds.width / body.offsetWidth : 1;
    const scaleY = body.offsetHeight ? bounds.height / body.offsetHeight : 1;
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const segment = el("span", { class: "ms-html-reference-segment" });
      const x = (rect.left - bounds.left) / scaleX - body.clientLeft;
      const y = (rect.top - bounds.top) / scaleY - body.clientTop;
      segment.style.left = `${x}px`; segment.style.top = `${y}px`;
      segment.style.width = `${rect.width / scaleX}px`; segment.style.height = `${rect.height / scaleY}px`;
      if (ann.type === "highlight") segment.style.background = ann.color;
      else if (ann.type === "strike") { segment.style.top = `${y + rect.height / scaleY / 2}px`; segment.style.height = "0px"; segment.style.borderTop = `2px solid ${ann.color}`; }
      else segment.style.borderBottom = `${ann.type === "note" ? "1px dashed" : "2px solid"} ${ann.color}`;
      holder.append(segment);
    }
  }

  private appendVoiceMarker(ann: Annotation): void {
    const body = this.reader.getBodyEl();
    const marker = el("span", { class: "ms-ann ms-ann-voice" });
    marker.textContent = ann.mediaKind==="video"?"▶":"🎙";
    marker.dataset.annId = ann.id;
    marker.style.left = `${((ann.pos?.x ?? 0.5) * 100).toFixed(2)}%`;
    marker.style.top = `${((ann.pos?.y ?? 0.5) * 100).toFixed(2)}%`;
    marker.title = "点击播放语音批注";
    marker.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.onAnnClick(ann, ev);
    });
    body.append(marker);
  }

  private appendPen(ann: Annotation): void {
    if (!ann.strokes?.length || !this.isInkVisible(ann)) return;
    const body = this.reader.getBodyEl();
    const holder = el("div", { class: "ms-ann ms-ann-pen" });
    holder.dataset.annId = ann.id;
    if(ann.inkBrush==="highlight")holder.dataset.recallInk="";
    holder.dataset.inkLayerId = ann.inkLayerId ?? "default";
    holder.classList.toggle("ms-ink-reference", this.isInkReference(ann));
    const w = body.clientWidth;
    const h = body.clientHeight;
    if (ann.strokes && w && h) PenController.render(holder, ann.strokes, w, h, ann.color, ann.inkBrush, ann.inkWidth, ann.inkOpacity);
    holder.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.onAnnClick(ann, ev);
    });
    body.append(holder);
    this.appendRecallInkMasks(body,ann,ann.strokes,w,h);
  }

  private appendRegion(ann: Annotation): void {
    const body = this.reader.getBodyEl();
    if(ann.range?.imageIndex!==undefined){
      const div=el('div',{class:'ms-ann ms-ann-region',draggable:'true'});div.dataset.annId=ann.id;div.title='图片摘录';this.layoutImageRegion(ann,div);div.addEventListener('click',event=>this.onAnnClick(ann,event));div.addEventListener('dragstart',event=>{event.dataTransfer?.setData('text/plain',ann.cardId??'');event.dataTransfer?.setData('application/margin-study-ann-id',ann.id);});body.append(div);return;
    }
    const located = this.locateRange(ann);
    if (!located) {
      this.unresolved.add(ann.id); this.reportUnresolved(); return;
    }
    this.unresolved.delete(ann.id);
    const div = el("div", { class: "ms-ann ms-ann-region", draggable: "true" });
    div.dataset.annId = ann.id;
    div.style.borderColor = ann.color;
    div.title = ann.text ? ann.text.slice(0, 120) : "区域摘录";
    // region 在 Word 中没有精确矩形，以 range 首字符位置作为锚点
    let total = 0;
    let anchor: Text | null = null;
    const start = located.start;
    for (const n of this.textNodes(body)) {
      const len = (n.textContent || "").length;
      if (total <= start && start < total + len) {
        anchor = n as Text;
        break;
      }
      total += len;
    }
    if (anchor) {
      const r = rectOfNode(anchor);
      const bodyR = body.getBoundingClientRect();
      div.style.left = `${(r?.left ?? 0) - bodyR.left}px`;
      div.style.top = `${(r?.top ?? 0) - bodyR.top}px`;
      div.style.width = `${r?.width || 120}px`;
      div.style.height = `${r?.height || 24}px`;
    } else {
      div.style.left = "0px";
      div.style.top = "0px";
      div.style.width = "120px";
      div.style.height = "24px";
    }
    div.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.onAnnClick(ann, ev);
    });
    div.addEventListener("dragstart", (ev) => {
      ev.dataTransfer?.setData("text/plain", ann.cardId ?? "");
      ev.dataTransfer?.setData("application/margin-study-ann-id", ann.id);
    });
    body.append(div);
  }

  protected afterNoteEdited(ann: Annotation): void {
    // 仅更新关联 span 的提示文本即可，无需整文档重建
    const body = this.reader.getBodyEl();
    body.querySelectorAll<HTMLElement>(`.ms-hl[data-ann-id="${ann.id}"]`).forEach((s) => {
      s.title = ann.noteText || "批注";
    });
    this.syncOcclusionElements();
  }

  /** 设置原始 HTML 源（Word 转换结果），随后渲染 */
  setHtml(html: string): void {
    const container = document.createElement("div");
    container.append(sanitizeHTMLToDom(html));
    this.originalHtml = container.innerHTML;
    this.renderAll();
  }

  flashAnnotation(annId: string): void {
    const body = this.reader.getBodyEl();
    const ann = this.cache.find((entry) => entry.id === annId);
    if (!ann) return;
    if (ann.overlay?.deleted) { new Notice("此自由批注已删除；已有卡片与来源身份仍保留"); return; }
    this.revealAnnotationNotebook(ann);
    // Avoid selector interpolation: imported annotation ids need not be CSS identifiers.
    const els = Array.from(body.querySelectorAll<HTMLElement>("[data-ann-id]")).filter((node) => node.dataset.annId === annId);
    const located = ann.range ? this.locateRange(ann) : null;
    const quote = located ? this.domRange(located.start, located.end) : null;
    const image=ann.range?.imageIndex!==undefined?this.regionSourceImage(ann):undefined;
    const bounds = image?image.getBoundingClientRect():quote ? unionCssRects(Array.from(quote.getClientRects())) : ann.range ? null : unionCssRects(els.map((node) => node.getBoundingClientRect()));
    const scroll = this.reader.getScrollContainer();
    if (bounds) {
      this.rememberLocation();
      body.dataset.msAnchorNavigation = "exact";
      scroll.scrollTo({ top: scroll.scrollTop + bounds.top + bounds.height / 2 - scroll.getBoundingClientRect().top - scroll.clientHeight / 2, behavior: "smooth" });
      els.forEach((node) => node.classList.add("ms-ann-flash"));
      setTimeout(() => els.forEach((node) => node.classList.remove("ms-ann-flash")), 1600);
      return;
    }
    const section = ann.range?.section ? this.sections().find((node) => node.dataset.msSection === ann.range!.section) : null;
    const ratio = ann.range?.sectionRatio;
    if (section && typeof ratio === "number" && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1) {
      this.rememberLocation();
      body.dataset.msAnchorNavigation = "approximate";
      const sectionBounds = section.getBoundingClientRect();
      scroll.scrollTo({ top: scroll.scrollTop + sectionBounds.top - scroll.getBoundingClientRect().top + ratio * sectionBounds.height - scroll.clientHeight / 2, behavior: "smooth" });
      new Notice("已跳到章节内近似位置；原文未能精确定位，批注数据仍保留。");
    } else { body.dataset.msAnchorNavigation = "unresolved"; new Notice("批注未能定位：原文章节或文字已变化，批注数据仍保留。"); }
  }

  private domRange(start: number, end: number): Range | null {
    const range = document.createRange();
    let total = 0; let started = false;
    for (const node of this.textNodes(this.getBodyEl())) {
      if (!started && start < total + node.length) { range.setStart(node, start - total); started = true; }
      if (started && end <= total + node.length) { range.setEnd(node, end - total); return range; }
      total += node.length;
    }
    return null;
  }
  private sections(): HTMLElement[] { return Array.from(this.getBodyEl().querySelectorAll<HTMLElement>("[data-ms-section]")); }
  private captureLocation(): HtmlReadingLocation {
    const scroll = this.getScrollContainer();
    const top = scroll.getBoundingClientRect().top;
    const sections = this.sections();
    const section = [...sections].reverse().find((node) => node.getBoundingClientRect().top <= top + 1) ?? sections[0];
    const bounds = section?.getBoundingClientRect();
    return { section: section?.dataset.msSection, sectionOffset: bounds ? (top - bounds.top) / Math.max(1, bounds.height) : 0,
      ratio: scroll.scrollTop / Math.max(1, scroll.scrollHeight - scroll.clientHeight), left: scroll.scrollLeft };
  }
  rememberLocation(): void { this.navigationHistory.record(this.captureLocation()); }
  goBack(): void { const location = this.navigationHistory.back(this.captureLocation()); if (location) this.restoreLocation(location); }
  goForward(): void { const location = this.navigationHistory.forward(this.captureLocation()); if (location) this.restoreLocation(location); }
  private restoreLocation(location: HtmlReadingLocation): void {
    const scroll = this.getScrollContainer();
    const section = this.sections().find((node) => node.dataset.msSection === location.section);
    const bounds = section?.getBoundingClientRect();
    scroll.scrollTo({ top: bounds ? scroll.scrollTop + bounds.top - scroll.getBoundingClientRect().top + location.sectionOffset * bounds.height
      : location.ratio * Math.max(0, scroll.scrollHeight - scroll.clientHeight), left: location.left, behavior: "smooth" });
  }
}

function rectOfNode(node: Node): DOMRect | null {
  try {
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect();
  } catch {
    return null;
  }
}

function imageToDataUrl(img: HTMLImageElement): string | undefined {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(img.naturalWidth || img.clientWidth));
    canvas.height = Math.max(1, Math.floor(img.naturalHeight || img.clientHeight));
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return undefined;
  }
}
