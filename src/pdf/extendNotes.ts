import { Menu, Notice, setIcon } from "obsidian";
import { foldCoordinates, regionFoldBands, type FoldBand } from "./regionFolds";
import type { Card, PdfExtendMode, PdfExtendNote, Stroke } from "../types";
import type { ReaderView } from "./readerView";
import { notebookMeta, updateNotebookMeta } from "../annot/documentNotebooks";
import { openInlineTextEditor } from "../annot/inlineTextEditor";
import { applyTextStyle, normalizeTextStyle, renderTextRuns } from "../annot/textRuns";
import { projectPagePoint, sourcePagePoint } from "./pageCrop";
import { uid } from "../utils/id";
import { PenController } from "../annot/pen";
import { el } from "../utils/dom";
import { openExtendMenu, ExtendAction } from "./extendMenu";
import { openTextModal, createModal } from "../utils/modal";
import { enrollCardsForReview } from "../review/decks";
import { hasNativePhotoPicker, pickNativeCamera, pickNativePhotos } from "./nativePhotoPicker";
import { PAGE_IMAGE_ACCEPT, isPageImage } from "./imagePages";
import { openDetail } from "../cards/cardView";
import { isExtendTextBand, extendTextScale } from "./extendText";
import { extendMediaImage } from "./extendMedia";
import { renderExtendImages } from "./extendImageEditor";
import { renderExtendTextBoxes, fitExtendTextBox } from "./extendTextBoxes";
import { extendCardText, extendTextFromCard } from "./extendCardText";
import { openExtendSpeech } from "./extendSpeech";
import { researchPreferences, engineSearchUrl } from "../research/contracts";

export interface ExtendGap { note: PdfExtendNote; y: number; height: number; top: number; }
/** All geometry stays in the original PDF. Only the view acquires inserted vertical bands. */
export function extendProjection(base: any, gaps: ExtendGap[], folds: FoldBand[] = []): any {
  if (!gaps.length && !folds.length) return base;
  const fold = foldCoordinates(folds);
  const down = (y: number) => { const at = fold.down(y); return at + gaps.filter(gap => gap.y <= at + .001).reduce((sum, gap) => sum + gap.height, 0); };
  const up = (y: number) => {
    let offset = 0;
    for (const gap of gaps) { if (y < gap.top) break; if (y < gap.top + gap.height) return fold.up(gap.y); offset += gap.height; }
    return fold.up(y - offset);
  };
  return Object.assign(Object.create(base), {
    height: fold.down(base.height) + gaps.reduce((sum, gap) => sum + gap.height, 0),
    convertToViewportPoint(x: number, y: number) { const point = base.convertToViewportPoint ? base.convertToViewportPoint(x, y) : base.convertToViewportRectangle([x,y,x,y]); return [point[0], down(point[1])]; },
    convertToViewportRectangle(rect: number[]) { const first = this.convertToViewportPoint(rect[0], rect[1]), last = this.convertToViewportPoint(rect[2], rect[3]); return [...first, ...last]; },
    convertToPdfPoint(x: number, y: number) { return base.convertToPdfPoint(x, up(y)); },
    extendDown: down, extendUp: up,
  });
}

export class ExtendNotes {
  private fingerprint = "";
  private layoutFingerprint = "";
  private pens = new Map<string, {page: number; controller: PenController}>();
  private pending: Promise<void> = Promise.resolve();
  private closeEditor: (() => void) | null = null;
  private editTask: Promise<void> = Promise.resolve();
  private editingId: string | null = null;
  private popupId: string | null = null;
  private placing = false;
  private cancelDrag: (() => void) | null = null;
  private consumePlaceClick = false;
  private closeMenu: (()=>void) | null = null;
  private menuTabs = new Map<string, {tab: string}>();
  private imageRequest: AbortController | null = null;
  private imageInput: HTMLInputElement | null = null;
  private syncingCards = false;
  private imageEditors = new Map<string, {page:number; dispose:()=>void}>();
  private selectedImage?: string;
  private closeSpeech?:()=>void;
  private imageClipboard?:{token:string;noteId:string;record:NonNullable<PdfExtendNote["images"]>[number];height:number;path:string|null;notebook:string;cut:boolean};
  private pendingTextCut?:{noteId:string;record:NonNullable<PdfExtendNote["textBoxes"]>[number];path:string|null;notebook:string};
  private textBoxEditors=new Map<string,{page:number;dispose:()=>void}>();
  constructor(private reader: ReaderView) {}
  private meta() { return notebookMeta(this.reader.plugin.store.getDocMeta(this.reader.getFilePath() ?? "")); }
  notes(): PdfExtendNote[] { return structuredClone(this.meta().pdfExtendNotes ?? []); }
  mode(): PdfExtendMode { const value = this.meta().pdfExtendMode; return value === "margin" || value === "collapse" ? value : "normal"; }
  marginVisible(): boolean { return this.meta().pdfMarginCommentArea??this.mode()==="margin"; }
  async setMarginVisible(visible: boolean): Promise<void> {
    const fitted = this.reader.isFittedToWidth();
    await this.finish();const path=this.reader.getFilePath();if(path)updateNotebookMeta(this.reader.plugin,path,{pdfMarginCommentArea:visible});await this.sync();
    if (fitted && !this.reader.isFittedToWidth()) await this.reader.fitWidth();
  }
  private layoutSignature(): string { return JSON.stringify([this.reader.getFilePath(), this.reader.getDocumentNotebookId(), this.mode(), this.marginVisible(), this.meta().pdfRegionFolds, this.notes().map(note => [note.id,note.pageId,note.anchor,note.height,note.collapsed,note.placement])]); }
  acceptLoaded(): void { this.fingerprint = JSON.stringify([this.reader.getFilePath(), this.reader.getDocumentNotebookId(), this.mode(), this.marginVisible(), this.meta().pdfRegionFolds, this.notes()]); this.layoutFingerprint = this.layoutSignature(); }
  hasEditor(): boolean { return !!this.closeEditor; }
  sync(): Promise<void> {
    if(!this.syncingCards){
      const notes=this.notes();let changed=false;
      for(const note of notes){const card=this.noteCard(note);if(!card||card.hidden||this.editingId===note.id)continue;
        const text=note.sourceAnnId ? note.separateCardText ? card.extendText?.find(item=>item.noteId===note.id)?.text??"" : note.text ? card.back??"" : undefined : card.front;
        if(text!==undefined&&text!==extendCardText(note)){
          const content=extendTextFromCard(text);
          if(content.text!==note.text||JSON.stringify(content.runs)!==JSON.stringify(note.runs)){Object.assign(note,content);note.height=this.textHeight(note);changed=true;}
        }
        if(!note.sourceAnnId&&(card.color!==note.color||JSON.stringify(card.tags??[])!==JSON.stringify(note.tags??[]))){note.color=card.color;note.tags=card.tags;changed=true;}
      }
      if(changed){const path=this.reader.getFilePath();if(path){this.syncingCards=true;try{updateNotebookMeta(this.reader.plugin,path,{pdfExtendNotes:notes});}finally{this.syncingCards=false;}}}
    }
    const next = JSON.stringify([this.reader.getFilePath(), this.reader.getDocumentNotebookId(), this.mode(), this.marginVisible(), this.meta().pdfRegionFolds, this.notes()]);
    if (next === this.fingerprint) return this.pending;
    this.fingerprint = next;
    const layout = this.layoutSignature();
    if (layout === this.layoutFingerprint) {
      for (const page of this.reader.getPageNumbers()) if (this.reader.getPageRecord(page)?.baseViewport) this.render(page);
      return this.pending;
    }
    this.layoutFingerprint = layout;
    this.pending = this.reader.refreshExtendLayout();
    return this.pending;
  }
  reset(): void { this.closeSpeech?.();this.closeSpeech=undefined;this.imageClipboard=undefined; this.pendingTextCut=undefined; this.closeMenu?.();this.imageRequest?.abort();this.imageInput?.remove();this.imageInput=null; this.cancelDrag?.(); for (const page of new Set([...this.pens.values()].map(value=>value.page))) this.releasePage(page); this.placing = false; this.popupId = null; this.fingerprint = ""; this.layoutFingerprint = ""; }
  releasePage(page: number): void { for(const [id,value] of [...this.textBoxEditors])if(value.page===page){value.dispose();this.textBoxEditors.delete(id);} for(const [id,value] of [...this.imageEditors])if(value.page===page){value.dispose();this.imageEditors.delete(id);} for (const [id,value] of [...this.pens]) if (value.page===page) { this.pens.delete(id); value.controller.destroy(); } }
  syncHandwriting(): void {
    const mode = this.reader.getHandwritingMode();
    for(const box of this.reader.getScrollContainer().querySelectorAll(".ms-extend-note"))box.classList.toggle("is-drawing",mode!=="off");
    for (const value of this.pens.values()) { value.controller.setTool(mode === "eraser" ? "erase" : mode === "lasso" ? "select" : mode === "highlight" ? "highlight" : "draw"); value.controller.setActive(mode !== "off"); }
  }
  begin(): void { this.placing = true; this.reader.setHandwritingMode("off"); this.reader.getScrollContainer().classList.add("ms-extend-placing"); }
  stop(): void { this.cancelDrag?.(); this.placing = false; this.reader.getScrollContainer().classList.remove("ms-extend-placing"); void this.finish(); }
  async finish(): Promise<void> { const close = this.closeEditor; this.closeEditor = null; close?.(); await this.editTask; }
  async setMode(mode: PdfExtendMode): Promise<void> {
    if (!["normal", "margin", "collapse"].includes(mode)) throw new Error("无效留白模式");
    const fitted = this.reader.isFittedToWidth();
    await this.finish(); this.popupId = null;
    const path = this.reader.getFilePath(); if (!path) return;
    if (this.mode() !== mode) updateNotebookMeta(this.reader.plugin, path, { pdfExtendMode: mode === "normal" ? undefined : mode, ...(mode==="margin"&&this.meta().pdfMarginCommentArea===false?{pdfMarginCommentArea:undefined}:{}) });
    await this.sync();
    if (fitted && !this.reader.isFittedToWidth()) await this.reader.fitWidth();
  }
  async create(page: number, anchor: { x: number; y: number }, sourceAnnId?: string, placement?: "margin"): Promise<string> {
    const path = this.reader.getFilePath(), notebook = this.reader.getDocumentNotebookId();
    await this.finish();
    if (path !== this.reader.getFilePath() || notebook !== this.reader.getDocumentNotebookId()) throw new Error("文档或笔记本已切换，留白操作已取消");
    const existing = sourceAnnId && this.notes().find(note => note.sourceAnnId === sourceAnnId);
    if (existing) { this.popupId = existing.id; this.render(page); this.edit(existing.id); return existing.id; }
    const pageId = this.reader.getPdfPageId(page);
    if (!pageId || ![anchor.x, anchor.y].every(Number.isFinite)) throw new Error("请在 PDF 页面中添加留白");
    const note: PdfExtendNote = { id: uid("extend"), pageId, ...(sourceAnnId ? {sourceAnnId} : {}), ...(placement?{placement}:{}), anchor: { x: Math.max(0, Math.min(1, anchor.x)), y: Math.max(0, Math.min(1, anchor.y)) }, height: 90, text: "", createdAt: new Date().toISOString() };
    if(sourceAnnId&&this.noteCard(note)?.back?.trim())note.separateCardText=true;
    this.popupId = this.mode() === "collapse" ? note.id : null;
    await this.replace(note.id, note, "添加留白"); this.edit(note.id); return note.id;
  }
  async update(id: string, patch: Partial<Pick<PdfExtendNote, "anchor" | "height" | "text" | "runs" | "collapsed" | "ink" | "color" | "tags" | "images" | "textBoxes">>): Promise<void> {
    const before = this.notes().find(note => note.id === id); if (!before) return;
    const next = { ...before, ...structuredClone(patch) };
    if (!Number.isFinite(next.height) || next.height < 24 || next.height > 3000 || ![next.anchor.x, next.anchor.y].every(Number.isFinite)) throw new Error("留白位置或高度无效");
    next.anchor = { x: Math.max(0, Math.min(1, next.anchor.x)), y: Math.max(0, Math.min(1, next.anchor.y)) };
    if(next.color&&!/^#[0-9a-f]{6}$/i.test(next.color))throw new Error("留白颜色无效");
    if(next.images?.some(image=>!/^data:image\/(png|jpeg|webp);base64,/.test(image.src)||![image.x,image.y,image.w,image.h].every(Number.isFinite)||image.w<=0||image.h<=0))throw new Error("留白图片无效");
    if(next.images?.some(({edit})=>edit&&(!/^data:image\/(png|jpeg|webp);base64,/.test(edit.source)||![0,90,180,270].includes(edit.rotation)||![edit.w,edit.h,edit.crop?.left,edit.crop?.top,edit.crop?.right,edit.crop?.bottom].every(Number.isFinite)||edit.w<=0||edit.h<=0||edit.crop.left<0||edit.crop.top<0||edit.crop.right>1||edit.crop.bottom>1||edit.crop.left>=edit.crop.right||edit.crop.top>=edit.crop.bottom)))throw new Error("留白图片裁剪无效");
    if(next.textBoxes?.some(box=>!box.id||typeof box.text!=="string"||box.text.length>100_000||![box.x,box.y,box.w,box.h].every(Number.isFinite)||box.x<0||box.y<0||box.w<=0||box.h<=0||box.x+box.w>1.001||box.y+box.h>1.001))throw new Error("留白文字框无效");
    await this.replace(id, next, "编辑留白");
  }
  async remove(id: string): Promise<void> { await this.finish(); this.popupId = null; await this.replace(id, undefined, "删除留白"); }
  private ownCard(id: string): Card | undefined {
    return this.reader.plugin.store.cards.find(card=>card.docPath===this.reader.getFilePath()&&card.anchorAnnId===id&&!card.groupId);
  }
  async focus(id: string): Promise<void> {
    const note=this.notes().find(note=>note.id===id);if(!note)return;
    const page=(this.reader.getPdfPageEdits()?.pages.findIndex(page=>page.id===note.pageId)??-1)+1;if(!page)return;
    await this.reader.navigateToReference(page,[]);this.popupId=id;this.render(page);
    this.reader.getScrollContainer().querySelector<HTMLElement>(`.ms-extend-note[data-extend-id="${id}"]`)?.scrollIntoView({block:"center"});
  }
  private async syncOwnCard(id: string, next: PdfExtendNote | undefined, expected: PdfExtendNote | undefined, visibility: {card?:boolean;nodes:Map<string,boolean|undefined>}): Promise<void> {
    const linked=next?.sourceAnnId?next:expected?.sourceAnnId?expected:undefined;
    if(linked){const card=this.noteCard(linked);if(card){await this.syncCardMedia(card,id,next,expected);this.syncSourceText(card,id,next,expected);}return;}
    const store=this.reader.plugin.store, card=this.ownCard(id); if(!card)return;
    await this.syncCardMedia(card,id,next,expected);
    if(!next)card.hidden=true;else if(!expected)card.hidden=visibility.card;
    if(next){card.front=extendCardText(next);card.color=next.color;card.tags=next.tags??[];card.images=next.images?.map(image=>image.src);card.updatedAt=new Date().toISOString();}
    for(const node of store.nodes.filter(node=>node.cardId===card.id)){if(!next)node.hidden=true;else if(!expected)node.hidden=visibility.nodes.get(node.id);if(next){node.title=next.text.slice(0,60)||"留白";node.color=next.color;node.tags=next.tags;}}
  }
  private syncSourceText(card: Card, id: string, next?: PdfExtendNote, expected?: PdfExtendNote): void {
    const before=JSON.stringify([card.back,card.extendText]);
    if(next?.separateCardText||expected?.separateCardText){
      const entries=card.extendText?.filter(item=>item.noteId!==id)??[];
      if(next?.separateCardText)entries.push({noteId:id,text:extendCardText(next)});
      card.extendText=entries.length?entries:undefined;
    }else if(next?.text||expected?.text){card.back=next?extendCardText(next)||undefined:undefined;}
    if(before!==JSON.stringify([card.back,card.extendText]))card.updatedAt=new Date().toISOString();
  }
  private async syncCardMedia(card: Card, id: string, next?: PdfExtendNote, expected?: PdfExtendNote): Promise<void> {
    const existing=card.extendMedia?.find(item=>item.noteId===id);
    if(next&&existing&&next.height===expected?.height&&JSON.stringify(next.ink)===JSON.stringify(expected.ink)&&JSON.stringify(next.images)===JSON.stringify(expected.images)&&JSON.stringify(next.textBoxes)===JSON.stringify(expected.textBoxes)&&next.text===expected.text&&JSON.stringify(next.runs)===JSON.stringify(expected.runs))return;
    const path=this.reader.getFilePath(),notebook=this.reader.getDocumentNotebookId();
    const page=next?(this.reader.getPdfPageEdits()?.pages.findIndex(page=>page.id===next.pageId)??-1)+1:0;
    const composed=!!next&&!next.sourceAnnId&&!!(next.textBoxes?.length||!next.text&&next.images?.length);
    const image=next?await extendMediaImage(next.sourceAnnId||composed?next:{...next,images:undefined},this.reader.getPageBaseSize(page).width,composed):undefined;
    if(this.reader.getFilePath()!==path||this.reader.getDocumentNotebookId()!==notebook)throw new Error("文档或笔记本已切换，评论图片同步已取消");
    if(this.reader.plugin.store.getCard(card.id)!==card)return;
    const media=card.extendMedia?.filter(item=>item.noteId!==id)??[];
    if(image)media.push({noteId:id,image,...(composed?{composed:true}:{})});
    card.extendMedia=media.length?media:undefined;
  }
  private async ensureCard(note: PdfExtendNote): Promise<Card | undefined> {
    if(note.sourceAnnId){const syncing=this.syncingCards;this.syncingCards=true;try{const card=this.reader.ensureExtendSourceCard(note.sourceAnnId);if(card){this.syncSourceText(card,note.id,note);await this.syncCardMedia(card,note.id,note);}return card;}finally{this.syncingCards=syncing;}}
    const store=this.reader.plugin.store;let card=this.ownCard(note.id);
    if(!card){card={id:uid("card"),docPath:this.reader.getFilePath()!,type:"comment",front:extendCardText(note),color:note.color,tags:note.tags??[],images:note.images?.map(image=>image.src),links:[],anchorAnnId:note.id,documentNotebookId:this.reader.getDocumentNotebookId(),page:(this.reader.getPdfPageEdits()?.pages.findIndex(page=>page.id===note.pageId)??0)+1,createdAt:new Date().toISOString()};store.addCard(card);}
    await this.syncCardMedia(card,note.id,note);return card;
  }
  private noteCard(note: PdfExtendNote): Card | undefined {
    return note.sourceAnnId ? this.reader.plugin.store.cards.find(card=>card.docPath===this.reader.getFilePath()&&card.anchorAnnId===note.sourceAnnId&&!card.groupId) : this.ownCard(note.id);
  }
  private inCurrentMindmap(note: PdfExtendNote): boolean {
    const card=this.noteCard(note),store=this.reader.plugin.store;
    return !!card&&!card.hidden&&store.nodes.some(node=>node.cardId===card.id&&node.canvasId===store.activeCanvasId&&!node.hidden);
  }
  async addToMindmap(id: string): Promise<void> {
    await this.finish(); const note=this.notes().find(note=>note.id===id); if(!note||this.inCurrentMindmap(note))return;
    const store=this.reader.plugin.store,path=this.reader.getFilePath()!,notebook=this.reader.getDocumentNotebookId(),canvasId=store.activeCanvasId;
    const before=new Map([...store.cards,...store.nodes].map(item=>[item.id,item.hidden]));
    if(note.sourceAnnId){await this.ensureCard(note);this.reader.addExtendSourceToMindmap(note.sourceAnnId);}
    else {
      const card=await this.ensureCard(note);if(!card)return;card.hidden=false;
      let root=store.nodes.find(node=>node.docPath===path&&node.parentId===null&&node.canvasId===canvasId&&!node.hidden);
      if(!root){root={id:uid("node"),parentId:null,title:path.split("/").pop()??path,docPath:path,canvasId,collapsed:false,x:40,y:40};store.addNode(root);}
      const siblings=store.nodes.filter(node=>node.parentId===root!.id&&!node.hidden);
      store.addNode({id:uid("node"),parentId:root.id,cardId:card.id,title:note.text.slice(0,60)||"留白",docPath:path,canvasId,collapsed:false,x:320,y:40+siblings.length*150});
    }
    const changed=[...store.cards,...store.nodes].filter(item=>!before.has(item.id)||before.get(item.id)!==item.hidden).map(item=>({id:item.id,before:before.has(item.id)?before.get(item.id):true,after:item.hidden}));
    // Store delivers its card/node history notification in a microtask. Publish the
    // composite reader action afterwards so the workspace Undo remains on Extend.
    store.save();await this.sync();this.reader.plugin.refreshMindmap();this.reader.plugin.refreshSidebar();
    if(this.reader.getFilePath()!==path||this.reader.getDocumentNotebookId()!==notebook)return;
    if(changed.length)this.reader.recordExtendEdit("加入脑图",async redo=>{
      if(this.reader.getFilePath()!==path||this.reader.getDocumentNotebookId()!==notebook)throw new Error("文档或笔记本已切换，操作已取消");
      for(const change of changed){const item=[...store.cards,...store.nodes].find(item=>item.id===change.id);if(item)item.hidden=redo?change.after:change.before;}
      store.save();await this.sync();this.reader.plugin.refreshMindmap();this.reader.plugin.refreshSidebar();
    });
    new Notice("已加入脑图");
  }
  private async replace(id: string, next: PdfExtendNote | undefined, label: string): Promise<void> {
    const path = this.reader.getFilePath(), notebook = this.reader.getDocumentNotebookId(); if (!path) return;
    const before = this.notes().find(note => note.id === id);
    if(next?.sourceAnnId&&!before?.text.trim()&&next.text.trim()&&this.noteCard(next)?.back?.trim())next={...next,separateCardText:true};
    const card=this.ownCard(id),visibility={card:card?.hidden,nodes:new Map(this.reader.plugin.store.nodes.filter(node=>node.cardId===card?.id).map(node=>[node.id,node.hidden]))};
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    const apply = async (value: PdfExtendNote | undefined, expected: PdfExtendNote | undefined) => {
      if (this.reader.getFilePath() !== path || this.reader.getDocumentNotebookId() !== notebook) throw new Error("文档或笔记本已切换，留白操作已取消");
      const notes = this.notes(), current = notes.find(note => note.id === id);
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error("留白已在其他窗口更新，请重新操作");
      const index = notes.findIndex(note => note.id === id);
      if (value) { if (index < 0) notes.push(structuredClone(value)); else notes[index] = structuredClone(value); }
      else if (index >= 0) notes.splice(index, 1);
      await this.syncOwnCard(id,value,expected,visibility);
      updateNotebookMeta(this.reader.plugin, path, { pdfExtendNotes: notes.length ? notes : undefined }, notebook);
      await this.sync();
    };
    // Store notification starts the new layout, but history stays in the same reader session.
    const task = apply(next, before);
    this.reader.recordExtendEdit(label, redo => apply(redo ? next : before, redo ? before : next));
    await task;
  }
  pageNotes(page: number): PdfExtendNote[] { const id = this.reader.getPdfPageId(page); return this.notes().filter(note => note.pageId === id); }
  gaps(page: number, base: any, scale = this.reader.getScale()): ExtendGap[] {
    if (this.mode() !== "normal") return [];
    let offset = 0;
    const folds = regionFoldBands(this.reader, page, base), fold = foldCoordinates(folds);
    return this.pageNotes(page).filter(note => !note.collapsed&&note.placement!=="margin").map(note => ({ note, y: projectPagePoint(note.anchor, this.reader.getPageCrop(), this.reader.getPdfPageRotation(page)).y * base.height }))
      .filter(gap => gap.y >= 0 && gap.y <= base.height && !folds.some(band => gap.y > band.top && gap.y < band.bottom)).map(gap => ({...gap, y: fold.down(gap.y)})).sort((a, b) => a.y - b.y || a.note.id.localeCompare(b.note.id)).map(gap => {
        const height = gap.note.height * scale, result = { ...gap, height, top: gap.y + offset }; offset += height; return result;
      });
  }
  projectPoint<T extends { x: number; y: number }>(page: number, point: T, inverse = false): T {
    const rec = this.reader.getPageRecord(page), base = rec?.baseViewport, viewport: any = rec?.viewport;
    if (!base || !viewport) return inverse ? sourcePagePoint(point, this.reader.getPageCrop(), this.reader.getPdfPageRotation(page)) : projectPagePoint(point, this.reader.getPageCrop(), this.reader.getPdfPageRotation(page));
    if (inverse) return sourcePagePoint({ ...point, y: (viewport.extendUp?.(point.y * viewport.height) ?? point.y * viewport.height) / base.height }, this.reader.getPageCrop(), this.reader.getPdfPageRotation(page));
    const source = projectPagePoint(point, this.reader.getPageCrop(), this.reader.getPdfPageRotation(page));
    return { ...source, y: (viewport.extendDown?.(source.y * base.height) ?? source.y * base.height) / viewport.height };
  }
  projectInk(page: number, strokes: Stroke[][], inverse = false): Stroke[][] { return strokes.map(stroke => stroke.map(point => this.projectPoint(page, point, inverse))); }
  paint(page: number, base: any): void {
    const rec = this.reader.getPageRecord(page); if (!rec) return;
    const gaps = this.gaps(page, base), folds = regionFoldBands(this.reader, page, base), fold = foldCoordinates(folds);
    if (!gaps.length && !folds.length) return;
    const original = document.createElement("canvas"); original.width = rec.canvas.width; original.height = rec.canvas.height;
    original.getContext("2d")!.drawImage(rec.canvas, 0, 0);
    const ratio = original.height / base.height;
    const folded = document.createElement("canvas"); folded.width = original.width; folded.height = Math.max(1, Math.round(fold.down(base.height) * ratio));
    const foldedContext = folded.getContext("2d")!;
    foldedContext.fillStyle = "#ffffff"; foldedContext.fillRect(0, 0, folded.width, folded.height);
    let from = 0;
    for (const band of [...folds, {top:base.height,bottom:base.height,height:0,ids:[]}]) {
      const first = Math.round(from * ratio), last = Math.round(band.top * ratio);
      if (last > first) foldedContext.drawImage(original, 0, first, original.width, last-first, 0, Math.round(fold.down(from)*ratio), original.width, last-first);
      from = band.bottom;
    }
    const height = (rec.viewport as any).height;
    rec.canvas.height = Math.max(1, Math.floor(height * ratio)); rec.canvas.style.height = `${height}px`;
    const context = rec.canvas.getContext("2d")!; context.fillStyle = "#ffffff"; context.fillRect(0, 0, rec.canvas.width, rec.canvas.height);
    let y = 0, offset = 0;
    for (const gap of [...gaps, { y: fold.down(base.height), height: 0 }]) {
      const first = Math.round(y * ratio), last = Math.round(gap.y * ratio);
      if (last > first) context.drawImage(folded, 0, first, folded.width, last-first, 0, Math.round((y+offset)*ratio), folded.width, last-first);
      y = gap.y; offset += gap.height;
    }
    const bounds = rec.wrapper.getBoundingClientRect(), rotation = Number(rec.textLayer.dataset.mainRotation ?? 0);
    for (const span of rec.textLayer.querySelectorAll<HTMLElement>("span")) {
      const box = span.getBoundingClientRect(), top = box.top-bounds.top, bottom = box.bottom-bounds.top, at = (top+bottom)/2;
      if (folds.some(band => top < band.bottom-.01 && bottom > band.top+.01)) { span.style.display = "none"; continue; }
      const shift = (rec.viewport as any).extendDown(at)-at;
      span.style.translate = rotation === 90 ? `${shift}px 0` : rotation === 180 ? `0 ${-shift}px` : rotation === 270 ? `${-shift}px 0` : `0 ${shift}px`;
    }
    rec.textLayer.style.overflow = "visible";
  }
  render(page: number): void {
    const rec = this.reader.getPageRecord(page), base = rec?.baseViewport;
    if (!rec || !base) return;
    this.closeMenu?.();this.closeMenu=null;
    this.releasePage(page);
    rec.wrapper.querySelectorAll(":scope > .ms-extend-layer").forEach(node => node.remove());
    const layer = el("div", { class: "ms-extend-layer" }); rec.wrapper.append(layer);
    const mode = this.mode(), scale = this.reader.getScale(), gaps = this.gaps(page, base), folds = regionFoldBands(this.reader,page,base), fold = foldCoordinates(folds);
    rec.wrapper.classList.toggle("ms-extend-margin", this.marginVisible());
    rec.wrapper.style.setProperty("--ms-extend-margin-width", `${base.width * .4}px`);
    const surface = el("div", { class: "ms-extend-surface" }); layer.append(surface);
    const marginSurface=el("div",{class:"ms-extend-surface ms-extend-margin-surface","aria-label":"页边评论区"});
    if(this.marginVisible()){layer.append(marginSurface);marginSurface.addEventListener("click",event=>{if(!this.placing||event.target!==marginSurface)return;event.stopPropagation();const bounds=rec.wrapper.getBoundingClientRect(),anchor=this.projectPoint(page,{x:1,y:(event.clientY-bounds.top)/bounds.height},true);void this.create(page,anchor,undefined,"margin").catch(error=>new Notice(String(error)));});}
    let marginBottom = 0;
    for (const note of this.pageNotes(page)) {
      const point = projectPagePoint(note.anchor, this.reader.getPageCrop(), this.reader.getPdfPageRotation(page));
      if (point.y < 0 || point.y > 1) continue;
      const inMargin=mode==="margin"||note.placement==="margin",shownInMargin=inMargin&&this.marginVisible();
      if (folds.some(band => point.y * base.height > band.top && point.y * base.height < band.bottom)) continue;
      const gap = gaps.find(gap => gap.note.id === note.id), collapsed = mode === "collapse" || !!note.collapsed || inMargin&&!shownInMargin;
      const at = fold.down(point.y * base.height);
      const y = at + gaps.filter(item => item.y < at || item.y === at && item.note.id < note.id).reduce((sum, item) => sum + item.height, 0);
      if (collapsed || inMargin) {
        const line = el("button", { class: "ms-extend-line", "aria-label": "查看留白", "data-extend-id": note.id }); line.style.top = `${y}px`; line.textContent = "▤";
        line.addEventListener("click", () => { this.popupId = note.id; this.render(page); if(!note.images?.length&&!note.textBoxes?.length)this.edit(note.id); }); layer.append(line);
      }
      if (collapsed && this.popupId !== note.id) continue;
      const box = el("section", { class: "ms-extend-note" + (isExtendTextBand(note)?" ms-extend-text-band":"") + (collapsed ? " ms-extend-popup" : ""), "data-extend-id": note.id, "aria-label": "留白笔记" });
      box.style.setProperty("--ms-extend-note-color",note.color??"#ffffad");
      const embeddedInMargin=shownInMargin&&!collapsed;
      const top = embeddedInMargin ? Math.max(y, marginBottom) : gap?.top ?? y + 6;
      const paperWidth=(embeddedInMargin?Math.max(1,base.width*.4-20):base.width)*(collapsed?.88:1);
      const paperScale=paperWidth/this.reader.getPageBaseSize(page).width;
      // MN4 scales an entire composition into the narrow paper, including its height.
      // Legacy text-only bands keep their existing wrapping and natural-height path.
      const marginTextBand=embeddedInMargin&&isExtendTextBand(note);
      const contentScale=isExtendTextBand(note)?scale*(marginTextBand?2:1):paperScale;
      box.style.top = `${top}px`; box.style.height = `${note.height * contentScale}px`;
      // Keep clipboard operations on the Extend paper; editable text handles its own paste.
      let pastePoint={x:.1,y:.1};box.tabIndex=0;
      const paperPoint=(event:MouseEvent)=>{const bounds=box.getBoundingClientRect();return{x:Math.max(0,Math.min(.94,(event.clientX-bounds.left)/bounds.width)),y:Math.max(0,Math.min(.85,(event.clientY-bounds.top)/bounds.height))};};
      const canPaste=(target:EventTarget|null)=>this.reader.getHandwritingMode()==="off"&&!(target instanceof Element&&target.closest('[contenteditable],input,textarea'));
      box.addEventListener("pointerdown",event=>{pastePoint=paperPoint(event);if(event.target===box||event.target===content)box.focus({preventScroll:true});});
      box.addEventListener("paste",event=>{if(!canPaste(event.target))return;const text=event.clipboardData?.getData("text/plain")??"",files=Array.from(event.clipboardData?.files??[]).filter(isPageImage);if(!text&&!files.length)return;event.preventDefault();event.stopPropagation();void (async()=>{if(await this.pasteImage(note.id,text,pastePoint,path,notebook))return;if(files.length)await this.insertImages(note.id,files);else if(!text.startsWith("marginstudy-image:"))await this.pasteTextBox(note.id,text,pastePoint,path,notebook);})().catch(error=>new Notice(String(error)));});
      box.addEventListener("contextmenu",event=>{if(!canPaste(event.target)||(event.target as Element).closest("button"))return;event.preventDefault();event.stopPropagation();pastePoint=paperPoint(event);const point={...pastePoint};new Menu().addItem(item=>item.setTitle("Paste").setIcon("clipboard-paste").onClick(async()=>{try{const text=await navigator.clipboard.readText();if(await this.pasteImage(note.id,text,point,path,notebook))return;if(text&&!text.startsWith("marginstudy-image:"))await this.pasteTextBox(note.id,text,point,path,notebook);else{const items=await navigator.clipboard.read();const item=items.find(item=>item.types.includes("image/png"));if(item)await this.insertImages(note.id,[new File([await item.getType("image/png")],"Clipboard.png",{type:"image/png"})]);}}catch(error){new Notice("粘贴文字框失败："+String(error));}})).showAtMouseEvent(event);});
      if (embeddedInMargin) marginBottom = top + note.height * contentScale + 8;
      const content = el("div", { class: "ms-extend-content ms-extend-text" });
      if(marginTextBand){
        const left=Math.min(base.width*.084,paperWidth*.23),right=Math.min(29,paperWidth*.23);
        content.style.position="relative";content.style.inset="auto";content.style.marginLeft=`${left}px`;content.style.width=`calc(100% - ${left+right}px)`;
        box.style.height="auto";box.style.minHeight=`${note.height*scale}px`;
      }
      content.style.paddingBlock=`${5*contentScale}px`;
      applyTextStyle(content, normalizeTextStyle({ fontSize: 16 }), contentScale * extendTextScale(note));
      renderTextRuns(content, note.runs?.length ? note.runs : [{ text: note.text, style: normalizeTextStyle({ fontSize: 16 }) }], contentScale * extendTextScale(note));
      content.addEventListener("dblclick", event => {if(note.images?.length||note.textBoxes?.length)this.placeText(event);else this.edit(note.id);});
      this.imageEditors.set(note.id,{page,dispose:renderExtendImages(box,{
        images:note.images??[],selected:this.selectedImage,select:id=>{this.selectedImage=id;},
        clipboard:(image,cut)=>this.copyImage(note,image,cut,path,notebook),
        enabled:()=>this.reader.getHandwritingMode()==="off",current:()=>this.reader.getFilePath()===path&&this.reader.getDocumentNotebookId()===notebook,
        latest:()=>this.notes().find(value=>value.id===note.id)?.images??[],save:images=>this.update(note.id,{images:images.length?images:undefined}),
      })});
      this.textBoxEditors.set(note.id,{page,dispose:renderExtendTextBoxes(box,note,paperScale,()=>this.reader.getHandwritingMode()==="off",id=>this.editTextBox(note.id,id),id=>{void this.update(note.id,{textBoxes:this.notes().find(value=>value.id===note.id)?.textBoxes?.filter(value=>value.id!==id)}).catch(error=>new Notice(String(error)));} ,{current:()=>this.reader.getFilePath()===path&&this.reader.getDocumentNotebookId()===notebook,latest:()=>this.notes().find(value=>value.id===note.id)?.textBoxes??[],save:records=>this.update(note.id,{textBoxes:records}),cut:record=>{this.pendingTextCut={noteId:note.id,record:structuredClone(record),path,notebook};},copied:()=>{this.pendingTextCut=undefined;}})});
      const ink = el("div", {class:"ms-extend-ink"});
      for (const record of note.ink ?? []) PenController.render(ink,record.strokes,paperWidth,note.height*contentScale,record.color,record.brush);
      const tools = el("div", { class: "ms-extend-tools" });
      const button = (icon: string, label: string, action: () => void) => { const node = el("button", { "aria-label": label, title: label }); setIcon(node, icon); node.addEventListener("click", action); return node; };
      const textButton=button("type","编辑留白文字",()=>{if(note.images?.length||note.textBoxes?.length)this.editTextBox(note.id,undefined,{x:.1,y:.1});else this.edit(note.id);});
      tools.append(textButton,button("move-vertical","自动展开",()=>this.autoExpand(note.id)));
      const sidebar=el("div",{class:"ms-extend-sidebar"}),menu=button("ellipsis-vertical","留白菜单",()=>this.menu(note.id,menu));sidebar.append(menu);
      const move=button("chevron-up","移动留白位置",()=>{this.popupId=null;void this.update(note.id,{collapsed:true}).catch(error=>new Notice(String(error)));});move.className="ms-extend-move";move.title="点击折叠；拖动调整留白位置";
      move.addEventListener("pointerdown",event=>this.drag(event,page,note,box,false));
      const resize = button("minus", "调整留白高度", () => {}); resize.className = "ms-extend-resize";resize.querySelector("svg")?.setAttribute("viewBox","3 8 18 8");resize.querySelector("svg")?.setAttribute("preserveAspectRatio","none");
      resize.addEventListener("pointerdown", event => this.drag(event, page, note, box, true));
      sidebar.append(resize);box.append(content,ink);if(collapsed||!isExtendTextBand(note))box.append(tools);box.append(sidebar,move); (embeddedInMargin?marginSurface:surface).append(box);
      if(marginTextBand)marginBottom=top+box.getBoundingClientRect().height+8;
      const path = this.reader.getFilePath(), notebook = this.reader.getDocumentNotebookId();
      const current = () => this.reader.getFilePath()===path && this.reader.getDocumentNotebookId()===notebook;
      const commit = (next: NonNullable<PdfExtendNote["ink"]>) => { if(current()) void this.update(note.id,{ink:next.length ? next : undefined}).catch(error=>new Notice(String(error))); };
      const pen = new PenController(ink, {
        getColor: () => this.reader.getHandwritingColor(),
        getInk: () => this.notes().find(item=>item.id===note.id)?.ink ?? [],
        onCommit: (strokes,brush) => commit([...(this.notes().find(item=>item.id===note.id)?.ink ?? []),{id:uid("extend-ink"),strokes,color:this.reader.getHandwritingColor(),brush}]),
        onChange: changes => commit((this.notes().find(item=>item.id===note.id)?.ink ?? []).map(record=>{const change=changes.find(item=>item.id===record.id);return change ? {...record,strokes:change.after} : record;}).filter(record=>record.strokes.length)),
        onUndo: () => {void this.reader.undoLastEdit();}, onRedo: () => {void this.reader.redoLastEdit();},
      });
      this.pens.set(note.id,{page,controller:pen}); this.syncHandwriting();
      for (const type of ["pointerdown", "click", "dblclick"]) box.addEventListener(type, event => event.stopPropagation());
    }
  }
  private autoExpand(id: string): void {
    const expand=async()=>{await this.finish();if(this.mode()==="collapse")await this.setMode("normal");this.popupId=null;await this.update(id,{collapsed:false});};
    if(this.mode()!=="collapse"){void expand().catch(error=>new Notice(String(error)));return;}
    const path=this.reader.getFilePath(),notebook=this.reader.getDocumentNotebookId();
    const {modal,close}=createModal("切换留白显示模式");modal.setAttribute("role","dialog");modal.setAttribute("aria-label","切换留白显示模式");
    modal.append(el("p",{text:"当前设置下，留白只能以弹出方式显示。若要嵌入显示，需要切换设置。是否切换？"}));
    const actions=el("div",{class:"ms-modal-actions"}),no=el("button",{text:"No","aria-label":"No"}),yes=el("button",{text:"Yes","aria-label":"Yes"});
    no.addEventListener("click",close);yes.addEventListener("click",()=>{close();if(this.reader.getFilePath()===path&&this.reader.getDocumentNotebookId()===notebook)void expand().catch(error=>new Notice(String(error)));});actions.append(no,yes);modal.append(actions);no.focus();
  }
  private async editCard(id: string): Promise<void> {
    await this.finish();
    const note=this.notes().find(note=>note.id===id);if(!note)return;
    const card=await this.ensureCard(note);if(!card)return;
    this.reader.plugin.store.save();
    openDetail(this.reader.plugin,card,()=>{void this.sync();this.reader.plugin.refreshMindmap();this.reader.plugin.refreshSidebar();});
  }
  private menu(id: string, anchor: HTMLElement): void {
    this.closeMenu?.(); const note=this.notes().find(note=>note.id===id);if(!note)return;
    const action=(id:string,label:string,icon:string,run:ExtendAction["run"],text=false):ExtendAction=>({id,label,icon,run,text});
    const basic:ExtendAction[]=[action("edit","编辑卡片","notebook-pen",()=>this.editCard(id)),action("collapse",note.collapsed?"Expand":"Collapse","chevron-up",()=>this.update(id,{collapsed:!note.collapsed}),true),action("palette","自定义颜色","palette",()=>{
      const input=el("input",{type:"color","aria-label":"留白颜色"});input.value=note.color??"#ffffad";input.addEventListener("change",()=>{void this.update(id,{color:input.value}).catch(error=>new Notice(String(error)));input.remove();});this.reader.containerEl.append(input);input.click();input.addEventListener("blur",()=>input.remove(),{once:true});
    })];
    for(const color of ["#ffffad","#b8f7ba","#b5d9ff","#ffb5cb"])basic.push({id:"color:"+color,label:"颜色 "+color,color,pressed:(note.color??"#ffffad")===color,run:()=>this.update(id,{color})});
    if(!this.inCurrentMindmap(note))basic.push(action("mindmap","Add to MindMap","network",()=>this.addToMindmap(id),true));
    basic.push(action("tags","标签","tag",()=>openTextModal({title:"标签",initial:(note.tags??[]).join(", "),onOk:value=>{void this.update(id,{tags:[...new Set(value.split(/[,，\n]/).map(value=>value.trim()).filter(Boolean))]}).catch(error=>new Notice(String(error)));}})),action("ai","AI","sparkles",()=>{this.reader.plugin.studyWorkspace?.showAiContext({text:note.text,label:"留白笔记",docPath:this.reader.getFilePath()??undefined});}),action("delete","删除留白","trash-2",()=>this.remove(id)),action("more","更多留白操作","ellipsis",()=>this.more(id,anchor)));
    if(note.sourceAnnId&&this.reader.hasExtendSource(note.sourceAnnId))basic.push(action("source","定位摘录","locate-fixed",()=>this.reader.flashAnnotation(note.sourceAnnId!)));
    const selectedText=[note.text,...(note.textBoxes??[]).map(box=>box.text)].filter(Boolean).join("\n").trim();
    const advanced:ExtendAction[]=[action("review","Add Review","clipboard-list",async()=>{const card=await this.ensureCard(note);if(card)enrollCardsForReview(this.reader.plugin,[card.id]);},true)];
    if(selectedText)advanced.push(action("speech","Speech","file-audio",()=>{this.closeSpeech?.();this.closeSpeech=openExtendSpeech(this.reader.containerEl,selectedText);}),action("research","Research","globe",()=>{if(this.reader.plugin.studyWorkspace)this.reader.plugin.studyWorkspace.showResearchText(selectedText);else{const prefs=researchPreferences(this.reader.plugin.store.settings.research),engine=prefs.engines.find(item=>item.id===prefs.selected[prefs.mode]&&item.mode===prefs.mode);if(engine)return this.reader.plugin.openResearchBrowser(engineSearchUrl(engine,selectedText.slice(0,4000)));}}));
    advanced.push(action("export","Export Card","share",()=>this.exportNote(note),true));
    const key=JSON.stringify([this.reader.getFilePath(),this.reader.getDocumentNotebookId(),id]);
    const menuState=this.menuTabs.get(key)??{tab:"Basic"};this.menuTabs.set(key,menuState);
    this.closeMenu=openExtendMenu(this.reader.containerEl,anchor,basic,advanced,this.meta().pdfExtendFavorites??["edit","palette","ai","delete"],ids=>{const path=this.reader.getFilePath();if(path)updateNotebookMeta(this.reader.plugin,path,{pdfExtendFavorites:ids});},menuState);
  }
  private more(id: string, anchor: HTMLElement): void {
    const note=this.notes().find(note=>note.id===id);if(!note)return;
    const actions:ExtendAction[]=[{id:"collapse",label:note.collapsed?"展开留白":"折叠留白",text:true,run:()=>this.update(id,{collapsed:!note.collapsed})},...(["files","photos","camera"] as const).map(source=>({id:source,label:source==="files"?"插入图片":source==="photos"?"从相册插入":"拍照",text:true,run:()=>this.pickImages(id,source)}))];
    this.closeMenu=openExtendMenu(this.reader.containerEl,anchor,actions,[],[],()=>{});
  }
  private exportNote(note: PdfExtendNote): void {
    const path=this.reader.getFilePath(),notebook=this.reader.getDocumentNotebookId();
    const {modal,close}=createModal("Export PDF or Long Image");modal.setAttribute("role","dialog");modal.setAttribute("aria-label","Export Card");
    const actions=el("div",{class:"ms-modal-actions"});
    for(const [label,format] of [["PDF","pdf"],["Long Image","png"]] as const){const button=el("button",{text:label,"aria-label":label});button.addEventListener("click",()=>{close();if(this.reader.getFilePath()!==path||this.reader.getDocumentNotebookId()!==notebook)return;
      void this.reader.exportExtendCard(note.id,format).then(bytes=>{const url=URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer],{type:format==="pdf"?"application/pdf":"image/png"})),link=el("a",{href:url,download:`Extend.${format}`});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}).catch(error=>new Notice(String(error)));});actions.append(button);}
    const cancel=el("button",{text:"Cancel","aria-label":"Cancel"});cancel.addEventListener("click",close);actions.append(cancel);modal.append(actions);
  }
  private async pickImages(id: string, source: "files"|"photos"|"camera"): Promise<void> {
    this.imageRequest?.abort();this.imageInput?.remove();const request=new AbortController();this.imageRequest=request;
    if(source!=="files"&&hasNativePhotoPicker(this.reader.app)){try{const files=await(source==="photos"?pickNativePhotos:pickNativeCamera)(this.reader.app,request.signal);if(!request.signal.aborted)await this.insertImages(id,files,request.signal);}finally{if(this.imageRequest===request)this.imageRequest=null;}return;}
    const input=el("input",{type:"file",accept:PAGE_IMAGE_ACCEPT,"aria-label":"选择留白图片"});input.multiple=true;input.hidden=true;if(source==="camera")input.setAttribute("capture","environment");this.imageInput=input;this.reader.containerEl.append(input);
    input.addEventListener("change",()=>{const files=Array.from(input.files??[]);input.remove();this.imageInput=null;void this.insertImages(id,files,request.signal).catch(error=>new Notice(String(error)));},{once:true});input.addEventListener("cancel",()=>{input.remove();this.imageInput=null;},{once:true});input.click();
  }
  async insertImages(id: string, files: File[], signal?: AbortSignal): Promise<void> {
    const path=this.reader.getFilePath(), notebook=this.reader.getDocumentNotebookId();
    const current=()=>{if(signal?.aborted||path!==this.reader.getFilePath()||notebook!==this.reader.getDocumentNotebookId()||!this.notes().some(note=>note.id===id))throw new Error("文档、笔记本或留白已变化，图片插入已取消");};
    current();if(!files.length)return;if(files.length>20)throw new Error("一次最多插入20张图片");const images:NonNullable<PdfExtendNote["images"]>=[];
    for(const file of files){if(!isPageImage(file)||file.size>30_000_000)throw new Error("不支持的图片或文件过大："+file.name);const bitmap=await createImageBitmap(file);try{current();if(bitmap.width*bitmap.height>40_000_000)throw new Error("图片尺寸过大");const canvas=document.createElement("canvas");canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext("2d")!.drawImage(bitmap,0,0);images.push({id:uid("extend-image"),src:canvas.toDataURL("image/png"),x:.06,y:.1,w:bitmap.width/bitmap.height,h:1});canvas.width=canvas.height=0;}finally{bitmap.close();}}
    current();const latest=this.notes().find(note=>note.id===id)!;
    // Grow the note once for the whole batch; preserve the existing content's paper coordinates.
    const imageHeight=Math.max(24,latest.height*.8),padding=Math.max(4,latest.height*.1);
    let bottom=Math.max(latest.height*.1,...(latest.images??[]).map(image=>(image.y+image.h)*latest.height+8));
    const page=(this.reader.getPdfPageEdits()?.pages.findIndex(page=>page.id===latest.pageId)??-1)+1;
    const paperWidth=this.reader.getPageBaseSize(page).width;
    const placed=images.map(image=>{const h=Math.min(imageHeight,paperWidth*.7/image.w),w=h*image.w/paperWidth;const result={...image,y:bottom,w,h};bottom+=h+8;return result;});
    const height=Math.max(latest.height,bottom-8+padding);
    if(height>3000)throw new Error("留白已达到最大高度，请减少图片或另建留白");
    const ratio=latest.height/height;
    await this.update(id,{height,...(latest.textBoxes?{textBoxes:latest.textBoxes.map(box=>({...box,y:box.y*ratio,h:box.h*ratio}))}:{}),images:[...(latest.images??[]).map(image=>({...image,y:image.y*ratio,h:image.h*ratio,...(image.edit?{edit:{...image.edit,h:image.edit.h*ratio}}:{})})),...placed.map(image=>({...image,y:image.y/height,h:image.h/height}))],
      ...(height!==latest.height&&latest.ink?{ink:latest.ink.map(record=>({...record,strokes:record.strokes.map(stroke=>stroke.map(point=>({...point,y:point.y*ratio})))}))}:{})});
  }
  placeText(event: MouseEvent): boolean {
    const box=(event.target as HTMLElement).closest<HTMLElement>(".ms-extend-note");
    if(!box||!this.reader.getScrollContainer().contains(box))return false;
    const id=box.dataset.extendId!,existing=(event.target as HTMLElement).closest<HTMLElement>(".ms-extend-text-box");
    if(existing){this.editTextBox(id,existing.dataset.textBoxId);return true;}
    // A click inside the paper must never become an annotation on the PDF underneath.
    if((event.target as HTMLElement).closest("button"))return true;
    const bounds=box.getBoundingClientRect();
    this.editTextBox(id,undefined,{x:Math.max(0,Math.min(.94,(event.clientX-bounds.left)/bounds.width)),y:Math.max(0,Math.min(.85,(event.clientY-bounds.top)/bounds.height))});return true;
  }
  private async copyImage(note:PdfExtendNote,image:NonNullable<PdfExtendNote["images"]>[number],cut:boolean,path:string|null,notebook:string):Promise<void>{
    const pixels=await createImageBitmap(await(await fetch(image.src)).blob()),canvas=document.createElement("canvas");
    let png:Blob;
    try{canvas.width=pixels.width;canvas.height=pixels.height;canvas.getContext("2d")!.drawImage(pixels,0,0);png=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("无法复制图片")),"image/png"));}
    finally{pixels.close();canvas.width=canvas.height=0;}
    const token="marginstudy-image:"+uid("clipboard");
    await navigator.clipboard.write([new ClipboardItem({"image/png":png,"text/plain":new Blob([token],{type:"text/plain"})})]);
    if(path!==this.reader.getFilePath()||notebook!==this.reader.getDocumentNotebookId())return;
    this.pendingTextCut=undefined;this.imageClipboard={token,noteId:note.id,record:structuredClone(image),height:note.height,path,notebook,cut};
  }
  private async pasteImage(id:string,token:string,point:{x:number;y:number},path:string|null,notebook:string):Promise<boolean>{
    const clip=this.imageClipboard;if(!clip||clip.token!==token)return false;
    if(path!==this.reader.getFilePath()||notebook!==this.reader.getDocumentNotebookId())return true;
    await this.finish();
    if(path!==this.reader.getFilePath()||notebook!==this.reader.getDocumentNotebookId())return true;
    const target=this.notes().find(note=>note.id===id);if(!target)return true;
    const source=this.notes().find(note=>note.id===clip.noteId);
    if(clip.cut&&(clip.path!==path||clip.notebook!==notebook||!source||JSON.stringify(source.images?.find(image=>image.id===clip.record.id))!==JSON.stringify(clip.record)))throw new Error("剪切来源已修改，请重新剪切；原图片保留");
    const h=clip.record.h*clip.height/target.height,fit=Math.min(1,1/clip.record.w,1/h),record={...structuredClone(clip.record),id:clip.cut?clip.record.id:uid("extend-image"),x:Math.min(point.x,1-clip.record.w*fit),y:Math.min(point.y,1-h*fit),w:clip.record.w*fit,h:h*fit,...(clip.record.edit?{edit:{...clip.record.edit,w:clip.record.edit.w*fit,h:clip.record.edit.h*clip.height/target.height*fit}}:{})};
    if(clip.cut&&source!.id!==target.id)await this.moveImage(source!,target,record);
    else await this.update(id,{images:clip.cut?target.images?.map(image=>image.id===record.id?record:image):[...(target.images??[]),record]});
    this.imageClipboard={...clip,noteId:target.id,record:structuredClone(record),height:target.height,cut:false};return true;
  }
  private async moveImage(source:PdfExtendNote,target:PdfExtendNote,record:NonNullable<PdfExtendNote["images"]>[number]):Promise<void>{
    const path=this.reader.getFilePath(),notebook=this.reader.getDocumentNotebookId();if(!path)return;
    const remaining=source.images?.filter(image=>image.id!==record.id),before=[source,target],after=[{...source,images:remaining?.length?remaining:undefined},{...target,images:[...(target.images??[]),record]}];
    const visibility=before.map(note=>{const card=this.ownCard(note.id);return{card:card?.hidden,nodes:new Map(this.reader.plugin.store.nodes.filter(node=>node.cardId===card?.id).map(node=>[node.id,node.hidden]))};});
    const apply=async(values:PdfExtendNote[],expected:PdfExtendNote[])=>{
      if(path!==this.reader.getFilePath()||notebook!==this.reader.getDocumentNotebookId())throw new Error("文档或笔记本已切换，剪切移动已取消");
      const notes=this.notes();for(const note of expected)if(JSON.stringify(notes.find(value=>value.id===note.id))!==JSON.stringify(note))throw new Error("留白已在其他窗口更新，请重新操作");
      for(let index=0;index<values.length;index++)await this.syncOwnCard(values[index].id,values[index],expected[index],visibility[index]);
      updateNotebookMeta(this.reader.plugin,path,{pdfExtendNotes:notes.map(note=>structuredClone(values.find(value=>value.id===note.id)??note))},notebook);await this.sync();
    };
    await apply(after,before);this.reader.recordExtendEdit("移动留白图片",redo=>apply(redo?after:before,redo?before:after));
  }
  private async pasteTextBox(id:string,text:string,point:{x:number;y:number},path:string|null,notebook:string):Promise<void>{
    if(!text)return;
    if(text.length>100_000)throw new Error("粘贴文字过长，最多支持100000个字符");
    if(path!==this.reader.getFilePath()||notebook!==this.reader.getDocumentNotebookId())return;
    await this.finish();
    if(path!==this.reader.getFilePath()||notebook!==this.reader.getDocumentNotebookId())return;
    const note=this.notes().find(value=>value.id===id);if(!note)return;
    const page=(this.reader.getPdfPageEdits()?.pages.findIndex(page=>page.id===note.pageId)??-1)+1;if(!page)return;
    const cut=this.pendingTextCut;
    if(cut&&cut.path===path&&cut.notebook===notebook&&cut.record.text===text){
      const source=this.notes().find(value=>value.id===cut.noteId),record=source?.textBoxes?.find(value=>value.id===cut.record.id);
      if(!source||JSON.stringify(record)!==JSON.stringify(cut.record)){this.pendingTextCut=undefined;throw new Error("剪切来源已修改，请重新剪切；原内容保留");}
      const moved={...cut.record,x:Math.min(point.x,1-cut.record.w),y:Math.min(point.y,1-cut.record.h)};
      if(source.id===note.id)await this.update(note.id,{textBoxes:note.textBoxes?.map(value=>value.id===record!.id?moved:value)});
      else await this.moveTextBox(source,note,moved);
      this.pendingTextCut=undefined;return;
    }
    this.pendingTextCut=undefined;
    const record=fitExtendTextBox({id:uid("extend-text"),text,...point,w:Math.min(.6,1-point.x),h:Math.min(.3,1-point.y)},this.reader.getPageBaseSize(page).width,note.height);
    await this.update(id,{textBoxes:[...(note.textBoxes??[]),record]});
  }
  private async moveTextBox(source:PdfExtendNote,target:PdfExtendNote,record:NonNullable<PdfExtendNote["textBoxes"]>[number]):Promise<void>{
    const path=this.reader.getFilePath(),notebook=this.reader.getDocumentNotebookId();if(!path)return;
    const before=[source,target],after=[{...source,textBoxes:source.textBoxes?.filter(value=>value.id!==record.id)},{...target,textBoxes:[...(target.textBoxes??[]),record]}];
    const visibility=before.map(note=>{const card=this.ownCard(note.id);return{card:card?.hidden,nodes:new Map(this.reader.plugin.store.nodes.filter(node=>node.cardId===card?.id).map(node=>[node.id,node.hidden]))};});
    const apply=async(values:PdfExtendNote[],expected:PdfExtendNote[])=>{
      if(path!==this.reader.getFilePath()||notebook!==this.reader.getDocumentNotebookId())throw new Error("文档或笔记本已切换，剪切移动已取消");
      const notes=this.notes();for(const note of expected)if(JSON.stringify(notes.find(value=>value.id===note.id))!==JSON.stringify(note))throw new Error("留白已在其他窗口更新，请重新操作");
      for(let index=0;index<values.length;index++)await this.syncOwnCard(values[index].id,values[index],expected[index],visibility[index]);
      updateNotebookMeta(this.reader.plugin,path,{pdfExtendNotes:notes.map(note=>structuredClone(values.find(value=>value.id===note.id)??note))},notebook);await this.sync();
    };
    await apply(after,before);this.reader.recordExtendEdit("移动留白文字框",redo=>apply(redo?after:before,redo?before:after));
  }
  private editTextBox(id:string,boxId?:string,point?:{x:number;y:number}):void {
    this.closeEditor?.();this.closeEditor=null;
    const note=this.notes().find(note=>note.id===id);if(!note)return;
    const old=note.textBoxes?.find(box=>box.id===boxId);
    if(boxId&&!old)return;
    const record=old??{id:uid("extend-text"),text:"",x:point?.x??.1,y:point?.y??.1,w:Math.min(.6,1-(point?.x??.1)),h:Math.min(.3,1-(point?.y??.1))};
    const paper=this.reader.getScrollContainer().querySelector<HTMLElement>(`.ms-extend-note[data-extend-id="${id}"]`);if(!paper)return;
    let anchor=paper.querySelector<HTMLElement>(`[data-text-box-id="${record.id}"]`);
    const page=(this.reader.getPdfPageEdits()?.pages.findIndex(page=>page.id===note.pageId)??-1)+1;
    const paperScale=()=>paper.getBoundingClientRect().width/this.reader.getPageBaseSize(page).width;
    if(!anchor){renderExtendTextBoxes(paper,{...note,textBoxes:[record]},paperScale(),()=>false,()=>{},()=>{});anchor=paper.querySelector<HTMLElement>(`[data-text-box-id="${record.id}"]`);}
    const path=this.reader.getFilePath(),notebook=this.reader.getDocumentNotebookId();this.editingId=id;
    this.closeEditor=openInlineTextEditor({scroll:this.reader.getScrollContainer(),label:"留白文字框",textClass:"ms-extend-text",fontScale:paperScale,anchor:()=>paper.querySelector<HTMLElement>(`[data-text-box-id="${record.id}"]`),draft:{text:record.text,runs:record.runs,fontSize:16,color:"#111111",background:"transparent"},save:draft=>{
      this.closeEditor=null;this.editingId=null;
      if(path!==this.reader.getFilePath()||notebook!==this.reader.getDocumentNotebookId())return;
      const latest=this.notes().find(note=>note.id===id);if(!latest)return;
      const current=latest.textBoxes?.find(box=>box.id===record.id);
      if(JSON.stringify(current)!==JSON.stringify(old)){new Notice("文字框已在其他窗口更新，本次草稿未覆盖已有内容");return;}
      if(!old&&!draft.text){anchor?.remove();return;}
      if(old&&draft.text===old.text&&JSON.stringify(draft.runs)===JSON.stringify(old.runs))return;
      const boxes=latest.textBoxes?.filter(box=>box.id!==record.id)??[];
      if(draft.text){const page=(this.reader.getPdfPageEdits()?.pages.findIndex(page=>page.id===latest.pageId)??-1)+1;const next=fitExtendTextBox({...record,text:draft.text,runs:draft.runs},this.reader.getPageBaseSize(page).width,latest.height);if(old)boxes.splice(latest.textBoxes!.findIndex(box=>box.id===record.id),0,next);else boxes.push(next);}
      this.editTask=this.update(id,{textBoxes:boxes.length?boxes:undefined}).catch(error=>{new Notice(String(error));});
    }});
  }
  private edit(id: string): void {
    if (this.editingId === id && this.closeEditor) return;
    this.closeEditor?.(); this.closeEditor = null;
    const note = this.notes().find(note => note.id === id); if (!note) return;
    const path = this.reader.getFilePath(), notebook = this.reader.getDocumentNotebookId(); this.editingId = id;
    this.closeEditor = openInlineTextEditor({ scroll: this.reader.getScrollContainer(), label: "留白文字", textClass: "ms-extend-text", fontScale: () => this.reader.getScale() * extendTextScale(note),
      anchor: () => this.reader.getScrollContainer().querySelector<HTMLElement>(`.ms-extend-note[data-extend-id="${id}"] .ms-extend-content`),
      draft: { text: note.text, runs: note.runs, fontSize: 16, color: "#111111", background: "transparent" },
      save: draft => { this.closeEditor = null; this.editingId = null; this.popupId = null;
        if (this.reader.getFilePath() !== path || this.reader.getDocumentNotebookId() !== notebook) return;
        const latest = this.notes().find(item=>item.id===id);
        if (!latest || latest.text !== note.text || JSON.stringify(latest.runs)!==JSON.stringify(note.runs)) { new Notice("留白文字已在其他窗口更新，本次草稿未覆盖已有内容"); return; }
        if (!note.runs && draft.text === note.text && !draft.text) return;
        const changed=draft.text!==note.text||JSON.stringify(draft.runs)!==JSON.stringify(note.runs);
        this.editTask = this.update(id, { text: draft.text, runs: draft.runs, ...(changed?{height:this.textHeight({...latest,text:draft.text,runs:draft.runs})}:{}) }).catch(error => { new Notice(String(error)); });
      },
    });
  }
  /** Text comments fit their content; drawing/image notes retain their paper geometry. */
  private textHeight(note: PdfExtendNote): number {
    if(!note.text||note.images?.length||note.textBoxes?.length||note.ink?.some(record=>record.strokes.length))return note.height;
    const scale=this.reader.getScale(),page=(this.reader.getPdfPageEdits()?.pages.findIndex(page=>page.id===note.pageId)??-1)+1;
    const box=this.reader.getScrollContainer().querySelector<HTMLElement>(`.ms-extend-note[data-extend-id="${note.id}"]`),content=box?.querySelector<HTMLElement>(".ms-extend-content");
    const width=content?.clientWidth??Math.max(1,(this.reader.getPageRecord(page)?.baseViewport?.width??500*scale)*.94-38);
    const measure=el("div",{class:"ms-extend-content ms-extend-text"});
    measure.style.cssText=`position:absolute;visibility:hidden;pointer-events:none;left:0;right:auto;top:0;bottom:auto;height:auto;width:${width}px;overflow:visible`;
    measure.style.paddingBlock=`${5*scale}px`;
    applyTextStyle(measure,normalizeTextStyle({fontSize:16}),scale * extendTextScale(note));
    renderTextRuns(measure,note.runs?.length?note.runs:[{text:note.text,style:normalizeTextStyle({fontSize:16})}],scale * extendTextScale(note));
    this.reader.getScrollContainer().append(measure);
    try{return Math.max(24,Math.min(3000,Math.ceil(measure.getBoundingClientRect().height/scale+2)));}finally{measure.remove();}
  }
  private drag(event: PointerEvent, page: number, note: PdfExtendNote, box: HTMLElement, resize: boolean): void {
    if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); this.cancelDrag?.();
    const start = event.clientY, original = box.style.cssText, path = this.reader.getFilePath(), notebook = this.reader.getDocumentNotebookId();
    const paperScale=box.getBoundingClientRect().height/note.height||this.reader.getScale();
    let delta = 0;
    const move = (next: PointerEvent) => { if (next.pointerId !== event.pointerId) return; delta = next.clientY - start;
      if (resize) box.style.height = `${Math.max(24 * paperScale, Math.min(3000 * paperScale, note.height * paperScale + delta))}px`;
      else box.style.transform = `translateY(${delta}px)`;
    };
    const cleanup = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); this.cancelDrag = null; box.style.cssText = original; };
    const cancel = () => cleanup();
    const up = (next: PointerEvent) => { if (next.pointerId !== event.pointerId) return; cleanup();
      if (this.reader.getFilePath() !== path || this.reader.getDocumentNotebookId() !== notebook || !delta) return;
      const base = this.reader.getPageRecord(page)?.baseViewport; if (!base) return;
      const point = projectPagePoint(note.anchor, this.reader.getPageCrop(), this.reader.getPdfPageRotation(page));
      const patch = resize ? { height: Math.max(24, Math.min(3000, note.height + delta / paperScale)) } : { anchor: sourcePagePoint({ x: point.x, y: point.y + delta / base.height }, this.reader.getPageCrop(), this.reader.getPdfPageRotation(page)) };
      void this.update(note.id, patch).catch(error => new Notice(String(error)));
    };
    this.cancelDrag = cancel; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
  }
  readonly onRegionStart = (event: PointerEvent): void => {
    this.consumePlaceClick = false;
    if (!this.placing || event.button !== 0 || (event.target as HTMLElement).closest(".ms-extend-layer,.ms-ann,.ms-page-bar,button,input,select,textarea,.ms-text-layer span")) return;
    const wrapper = (event.target as HTMLElement).closest<HTMLElement>(".ms-page"); if (!wrapper) return;
    this.cancelDrag?.();
    const page = Number(wrapper.dataset.page), bounds = wrapper.getBoundingClientRect(), path = this.reader.getFilePath(), notebook = this.reader.getDocumentNotebookId();
    const start = {x:event.clientX,y:event.clientY};
    const overlay = el("div",{class:"ms-lasso"}); wrapper.append(overlay);
    const rectangle = (next: PointerEvent) => {
      const x = Math.max(bounds.left,Math.min(bounds.right,next.clientX)), y = Math.max(bounds.top,Math.min(bounds.bottom,next.clientY));
      return new DOMRect(Math.min(start.x,x),Math.min(start.y,y),Math.abs(x-start.x),Math.abs(y-start.y));
    };
    const move = (next: PointerEvent) => { if (next.pointerId!==event.pointerId) return; const rect=rectangle(next); overlay.style.cssText=`left:${rect.left-bounds.left}px;top:${rect.top-bounds.top}px;width:${rect.width}px;height:${rect.height}px`; if(rect.width>5||rect.height>5) next.preventDefault(); };
    const cleanup = () => { overlay.remove(); window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up); window.removeEventListener("pointercancel",cancel); this.cancelDrag=null; };
    const cancel = () => { this.consumePlaceClick=true; cleanup(); };
    const up = (next: PointerEvent) => { if(next.pointerId!==event.pointerId)return; const rect=rectangle(next); cleanup();
      if(rect.width<8||rect.height<8)return;
      this.consumePlaceClick=true; window.getSelection()?.removeAllRanges();
      if(!wrapper.isConnected||path!==this.reader.getFilePath()||notebook!==this.reader.getDocumentNotebookId())return;
      void this.reader.createRegionExtend(page,rect).catch(error=>new Notice(String(error)));
    };
    this.cancelDrag=cancel; window.addEventListener("pointermove",move,{passive:false}); window.addEventListener("pointerup",up); window.addEventListener("pointercancel",cancel);
  };
  readonly onPlace = (event: MouseEvent): void => {
    if(this.consumePlaceClick){this.consumePlaceClick=false;event.preventDefault();event.stopImmediatePropagation();return;}
    if (!this.placing || event.button !== 0 || (event.target as HTMLElement).closest(".ms-extend-layer,.ms-ann,.ms-page-bar,button,input,select,textarea")) return;
    // Text selection belongs to the excerpt popover, never to blank-note placement.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return;
    if ((event.target as HTMLElement).closest(".ms-text-layer span")) return;
    const wrapper = (event.target as HTMLElement).closest<HTMLElement>(".ms-page"); if (!wrapper) return;
    const page = Number(wrapper.dataset.page), bounds = wrapper.getBoundingClientRect();
    event.preventDefault(); event.stopImmediatePropagation();
    const anchor = this.projectPoint(page, { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }, true);
    void this.create(page, anchor).catch(error => new Notice(String(error)));
  };
}
