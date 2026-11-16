/**
 * [INPUT]: 阅读器、文档批注、卡片和笔迹默认颜色。
 * [OUTPUT]: 文档导航面板及其交互。
 * [POS]: 工作区的目录、缩略图和批注导航入口。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { INK_DEFAULT_COLOR } from "../annot/pen";
import type MarginStudyPlugin from "../main";
import type { Annotation, Card, CardSource, ReaderLike, DocumentOutlineItem } from "../types";
import { Component, MarkdownRenderer, Menu, Notice } from "obsidian";
import { el } from "../utils/dom";
import { setNativeIcon } from "./nativeIcons";
import type { AiDraft } from "../ai/contracts";
import { buildClaudianPrompt, claudianAvailability, prefillClaudian } from "../ai/claudianBridge";
import { draftFromPastedReply } from "../ai/resultImport";
import { requestClaudian } from "../ai/claudianRequest";
import { aiErrorText } from "../ai/contracts";
import { aiServiceFor } from "../ai/panel";
import { uid } from "../utils/id";
import { createModal, openTextModal } from "../utils/modal";
import { getOutline } from "../pdf/outline";
import { annotationNotebook, documentNotebookState, notebookMeta } from "../annot/documentNotebooks";
import { annotationTextRuns, renderTextRuns } from "../annot/textRuns";
import { imageUrl } from "../review/content";
import { appendPageReferencesInReader, PageCollectionDocument, type PageCollectionReader } from "../documents/pageCollection";

export type DocumentNavigationTab = "contents" | "thumbnails" | "bookmarks" | "annotations" | "cards";
export const documentNavigationTabs: { id: DocumentNavigationTab; label: string; icon: string }[] = [
  { id: "contents", label: "目录", icon: "book-open" },
  { id: "thumbnails", label: "缩略图", icon: "grid-3x3" },
  { id: "bookmarks", label: "书签", icon: "bookmark" },
  { id: "annotations", label: "标注", icon: "scribble" },
  { id: "cards", label: "卡片", icon: "sticky-note" },
];

/** Owns one reader's navigation; closing it never closes or replaces that reader. */
export class DocumentNavigation {
  readonly element = el("aside", { class: "ms-document-navigation", "aria-label": "书页查找" });
  readonly tabs = el("div", { class: "ms-document-navigation-tabs", role: "tablist", "aria-label": "书页查找方式" });
  private list = el("div", { class: "ms-document-navigation-list", role: "tabpanel" });
  private spine = el("div", { class: "ms-document-spine", "aria-label": "文档书脊" });
  private selected: DocumentNavigationTab;
  private disposed = false;
  private revision = 0;
  private request = 0;
  private signature = "";
  private stopStore: () => void;
  private stopAnnotations: () => void;
  private stopPageChanges: () => void;
  private stopCurrentPageChanges: () => void;
  private markdownOwner = new Component();
  private thumbnails: IntersectionObserver | null = null;
  private tasks = new Set<any>();
  private selectedPage = 0;
  private editingOutline = false;
  private outlineItems: DocumentOutlineItem[] = [];
  private outlineSelection = new Set<string>();
  private closeOutlineEditor: (() => void) | null = null;

  constructor(private plugin: MarginStudyPlugin, private reader: ReaderLike, selected: DocumentNavigationTab, private onSelect: (tab: DocumentNavigationTab) => void) {
    this.selected = selected;
    this.element.append(this.spine,this.list);
    for (const [index, item] of documentNavigationTabs.entries()) {
      const button = el("button", { class: "ms-document-navigation-tab", role: "tab", title: item.label, "aria-label": item.label });
      setNativeIcon(button, item.icon);
      button.addEventListener("click", () => this.select(item.id));
      button.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? 4 : (index + (event.key === "ArrowRight" ? 1 : 4)) % 5;
        this.select(documentNavigationTabs[next].id); (this.tabs.children[next] as HTMLElement).focus();
      });
      this.tabs.append(button);
    }
    this.stopStore = plugin.store.subscribe(() => { void this.refresh(); });
    this.stopAnnotations = plugin.store.subscribeAnnotations(reader.getFilePath()!, () => { void this.refresh(); });
    this.stopPageChanges = reader.subscribePageChanges?.(() => { this.signature = ""; void this.refresh(); }) ?? (() => {});
    this.stopCurrentPageChanges = reader.subscribeCurrentPageChange?.(() => { this.signature = ""; void this.refresh(); }) ?? (() => {});
    this.markdownOwner.load();
    this.select(selected);
  }
  private select(tab: DocumentNavigationTab): void {
    if (this.disposed) return;
    this.selected = tab; this.onSelect(tab);
    for (const [index, item] of documentNavigationTabs.entries()) {
      this.tabs.children[index].setAttribute("aria-selected", String(item.id === tab));
      this.tabs.children[index].setAttribute("tabindex", item.id === tab ? "0" : "-1");
    }
    this.list.setAttribute("aria-label", documentNavigationTabs.find(item => item.id === tab)!.label);
    this.signature = ""; this.list.scrollTop = 0; void this.refresh();
  }
  setTab(tab: DocumentNavigationTab): void { if (tab !== this.selected) this.select(tab); }
  private stopPreviews(): void {
    this.thumbnails?.disconnect(); this.thumbnails = null;
    for (const task of this.tasks) task.cancel(); this.tasks.clear();
  }
  private async refresh(): Promise<void> {
    if (this.disposed) return;
    const request = ++this.request, selected = this.selected;
    const path = this.reader.getFilePath(); if (!path) return;
    const meta = this.plugin.store.getDocMeta(path), notebook = documentNotebookState(meta).active;
    let revision = this.revision;
    const current = () => !this.disposed && revision === this.revision;
    try {
      const annotations = selected === "cards" || selected === "annotations" ? (await this.plugin.store.loadAnnotations(path)).map(annotation => this.reader.getDisplayAnnotation?.(annotation) ?? annotation) : [];
      if (this.disposed || request !== this.request) return;
      const cards = selected === "cards" ? this.plugin.store.cards.filter(card => !card.hidden&&this.source(card, path)) : [];
      const signature = JSON.stringify([selected, path, notebook, notebookMeta(meta).bookmarks, notebookMeta(meta).foldedPages, meta.pdfCrop, meta.pdfPageEdits, meta.documentOutline, this.editingOutline, annotations, cards]);
      if (this.signature === signature) return; this.signature = signature;
      revision = ++this.revision; this.stopPreviews();
      this.markdownOwner.unload(); this.markdownOwner = new Component(); this.markdownOwner.load();
      const scroll = this.list.scrollTop; this.list.replaceChildren();
      const doc = this.reader.getDoc?.();
      this.spine.replaceChildren();this.spine.hidden=!doc;
      if(doc){
        const state=this.reader.getState?.(),position=state?.position as {page?:number}|undefined,page=Math.max(1,Math.min(doc.numPages,this.reader.getCurrentPage?.()??position?.page??1));
        const preview=el("button",{class:"ms-document-spine-preview","aria-label":`当前第 ${page} 页，查看缩略图`,"data-page":String(page)});
        preview.append(el("canvas",{"aria-hidden":"true"}));preview.addEventListener("click",()=>this.select("thumbnails"));
        const info=el("div",{class:"ms-document-spine-info"});info.append(el("strong",{text:path.split("/").pop()??path}),el("span",{text:`${page} / ${doc.numPages}`}));
        const progress=el("progress",{max:String(doc.numPages),value:String(page),"aria-label":"文档阅读进度"});info.append(progress);this.spine.append(preview,info);void this.renderThumbnail(preview,doc,current);
      }
      if (selected === "contents") {
        if (this.reader.getEditableOutline) {
          const outline = await this.reader.getEditableOutline();
          if (!current()) return;
          this.outlineItems = outline; this.renderEditableOutline(outline);
        } else {
          const outline = doc ? (await getOutline(doc)).map(item => ({ ...item, select: () => this.reader.gotoPage?.(item.page), disabled: !item.page }))
            : (this.reader.getNavigationOutline?.() ?? []).map(item => ({ ...item, disabled: false }));
          if (!current()) return;
          for (const item of outline) {
            const row = el("button", { class: "ms-document-outline-entry", text: item.title, "aria-label": item.title });
            row.style.paddingLeft = 14 + Math.min(12, item.level) * 14 + "px"; row.disabled = item.disabled;
            row.addEventListener("click", () => { item.select(); this.markSelected(row); }); this.list.append(row);
          }
          if (!outline.length) this.empty("文档没有目录");
        }
      } else if (selected === "thumbnails" || selected === "bookmarks") {
        if (!doc) { this.empty("此文档没有固定书页"); return; }
        const display=selected==="thumbnails"?this.reader.getDisplayPages?.():undefined;
        const pages = selected === "thumbnails" ? display?.map(entry=>entry.number)??Array.from({ length: doc.numPages }, (_, index) => index + 1)
          : [...new Set(notebookMeta(meta).bookmarks ?? [])].filter(page => Number.isInteger(page) && page > 0 && page <= doc.numPages).sort((a, b) => a - b);
        const grid = el("div", { class: "ms-document-page-grid" }); this.list.append(grid);
        if(selected==="thumbnails"&&doc instanceof PageCollectionDocument){
          grid.addEventListener("dragover",event=>{if(event.dataTransfer?.types.includes("application/x-marginstudy-page-reference"))event.preventDefault();});
          grid.addEventListener("drop",event=>{
            const raw=event.dataTransfer?.getData("application/x-marginstudy-page-reference");if(!raw)return;event.preventDefault();
            try{if(raw.length>4096)throw new Error("页面引用无效");const input=JSON.parse(raw);void appendPageReferencesInReader(this.plugin,this.reader as unknown as PageCollectionReader,[{sourcePath:input.sourcePath,sourcePage:input.sourcePage,sourceNotebookId:input.sourceNotebookId,origin:"page"}]).catch(error=>new Notice(String(error)));}
            catch(error){new Notice("页面拖入失败："+String(error));}
          });
        }
        this.thumbnails = new IntersectionObserver(entries => {
          for (const entry of entries) if (entry.isIntersecting) { this.thumbnails?.unobserve(entry.target); void this.renderThumbnail(entry.target as HTMLElement, doc, current); }
        }, { root: this.list, rootMargin: "160px" });
        for (const page of pages) {
          const row = el("button", { class: "ms-document-page-preview", "aria-label": `第 ${page} 页`, "data-page": String(page) });
          if(display)row.dataset.displayPage="true";
          if(selected==="thumbnails"&&typeof (this.reader as any).getPageReferences==="function"){
            row.draggable=true;row.addEventListener("dragstart",event=>{const sourcePage=display?.find(entry=>entry.number===page)?.page??page;try{const reference=(this.reader as unknown as PageCollectionReader).getPageReferences([sourcePage])[0];if(reference)event.dataTransfer?.setData("application/x-marginstudy-page-reference",JSON.stringify(reference));}catch(error){event.preventDefault();new Notice(String(error));}});
          }
          row.append(el("canvas", { "aria-hidden": "true" }), el("span", { class: "ms-document-preview-number", text: String(page) }));
          row.addEventListener("click", () => { this.selectedPage = page; if(display)void this.reader.gotoDisplayPage?.(page);else this.reader.gotoPage?.(page); this.markSelected(row); });
          if (this.selectedPage === page) row.setAttribute("aria-current", "true");
          grid.append(row); this.thumbnails.observe(row);
        }
      } else if (selected === "annotations") {
        const items = annotations.filter(ann => annotationNotebook(ann) === notebook && !ann.overlay?.deleted && (ann.overlay || ann.type === "pen" && ann.strokes?.some(stroke => stroke.length)));
        const previews = el("div", { class: "ms-document-annotation-previews" }); this.list.append(previews);
        for (const ann of items) {
          const row = el("button", { class: "ms-document-annotation-preview", "data-annotation-id": ann.id, "aria-label": ann.text || "手写标注" });
          if (ann.overlay?.kind === "text") { const text = el("div", { class: "ms-document-text-preview" }); renderTextRuns(text, annotationTextRuns(ann)); row.append(text); }
          else if (ann.overlay?.kind === "image" && ann.image) row.append(el("img", { src: ann.image, alt: "图片批注" }));
          else if (ann.strokes?.length) row.append(this.inkPreview(ann));
          if (ann.page > 0) row.append(el("span", { class: "ms-document-preview-number", text: String(ann.page) }));
          row.addEventListener("click", () => { this.reader.flashAnnotation(ann.id); this.markSelected(row); }); previews.append(row);
        }
      } else if (selected === "cards") {
        for (const card of cards) {
          const source = this.source(card, path)!;
          const annotation = source.anchorAnnId ? annotations.find(ann => ann.id === source.anchorAnnId) : undefined;
          if (annotation && annotationNotebook(annotation) !== notebook) continue;
          if (!annotation && (source.documentNotebookId??"default")!==notebook) continue;
          const row = el("button", { class: "ms-document-source-card", "data-card-id": card.id, "aria-label": card.title || card.front || "空卡片" });
          const body = el("div", { class: "ms-document-source-card-body markdown-rendered" }); row.append(body);
          void MarkdownRenderer.render(this.plugin.app, card.front || card.title || "", body, path, this.markdownOwner)
            .catch(() => { if (current()) body.textContent = card.front; })
            .then(() => { if (current() && card.image) body.append(el("img", { src: imageUrl(this.plugin, card.image), alt: "卡片图片" })); });
          row.addEventListener("click", () => {
            if (source.anchorAnnId) this.reader.flashAnnotation(source.anchorAnnId); else if (source.page) { if (this.reader.gotoSourcePage) this.reader.gotoSourcePage(source.page); else this.reader.gotoPage?.(source.page); }
            this.markSelected(row); this.plugin.viewEvents.onDocumentCardSelect?.(card.id);
          }); this.list.append(row);
        }
      }
      this.list.scrollTop = scroll;
    } catch (error) { if (current() && request === this.request) this.empty("无法加载书页查找：" + String(error)); }
  }
  private renderEditableOutline(items: DocumentOutlineItem[]): void {
    const selected = this.outlineSelection;
    for (const item of items) {
      const row = el("div", {class:"ms-toc-row", "data-toc-id":item.id});
      row.style.paddingLeft = Math.min(12,item.level)*16+"px";
      if (this.editingOutline) {
        const select = el("input", {type:"checkbox", "aria-label":"选择目录 "+item.title});select.checked=selected.has(item.id);
        select.addEventListener("change",()=>{select.checked?selected.add(item.id):selected.delete(item.id);});row.append(select);
        const drag = el("button", {class:"ms-toc-drag",text:"⠿",title:"拖动目录", "aria-label":"拖动目录 "+item.title});
        drag.addEventListener("pointerdown",event=>{
          if(event.button!==0)return;event.preventDefault();drag.setPointerCapture(event.pointerId);
          const y=event.clientY;
          const up=(end:PointerEvent)=>{drag.removeEventListener("pointerup",up);drag.removeEventListener("pointercancel",cancel);
            if(Math.abs(end.clientY-y)<6)return;
            const target=document.elementFromPoint(end.clientX,end.clientY)?.closest<HTMLElement>("[data-toc-id]");
            if(target?.dataset.tocId)this.moveOutline(item.id,target.dataset.tocId,end.clientY>target.getBoundingClientRect().top+target.clientHeight/2);
          };
          const cancel=()=>{drag.removeEventListener("pointerup",up);drag.removeEventListener("pointercancel",cancel);};
          drag.addEventListener("pointerup",up);drag.addEventListener("pointercancel",cancel);
        });row.append(drag);
      }
      const title=el("button", {class:"ms-document-outline-entry",text:item.title,"aria-label":item.title,"data-toc-focus":item.id});
      title.disabled=!this.editingOutline&&!item.page;
      title.addEventListener("click",()=>{if(this.editingOutline)this.renameOutline(item);else{this.reader.navigateToOutline?.(item);this.markSelected(row);}});
      title.addEventListener("keydown",event=>{
        const index=items.findIndex(entry=>entry.id===item.id);
        // 5.0.2 目录键盘：上下浏览、Enter 定位、Alt+左右改层级、空格多选、Delete 删除。
        if(event.key==="ArrowDown"||event.key==="ArrowUp"){
          if(event.altKey&&this.editingOutline){event.preventDefault();const target=items[index+(event.key==="ArrowUp"?-1:1)];if(target)this.moveOutline(item.id,target.id,event.key==="ArrowDown");return;}
          event.preventDefault();
          const next=items[index+(event.key==="ArrowDown"?1:-1)];const button=next?this.list.querySelector<HTMLButtonElement>(`[data-toc-focus="${next.id}"]`):null;
          button?.focus();button?.scrollIntoView({block:"nearest"});return;
        }
        if(event.altKey&&(event.key==="ArrowLeft"||event.key==="ArrowRight")&&this.editingOutline){
          event.preventDefault();this.changeOutlineLevel(event.shiftKey?new Set(this.outlineSelection.size?this.outlineSelection:[item.id]):new Set([item.id]),event.key==="ArrowRight"?1:-1);return;
        }
        if(event.key===" "&&this.editingOutline){
          event.preventDefault();const checkbox=row.querySelector<HTMLInputElement>('input[type="checkbox"]');
          if(checkbox){checkbox.checked=!checkbox.checked;checkbox.dispatchEvent(new Event("change"));}return;
        }
        if(event.key==="Enter"){event.preventDefault();if(this.editingOutline)this.renameOutline(item);else{this.reader.navigateToOutline?.(item);this.markSelected(row);}return;}
        if(event.key==="Delete"&&this.editingOutline){
          event.preventDefault();const ids=this.outlineSelection.size?new Set(this.outlineSelection):new Set([item.id]);this.deleteOutline(ids);return;
        }
      });row.append(title);
      if(!this.editingOutline&&this.reader.toggleOutlineFold&&item.page>0){
        const next=items.slice(items.indexOf(item)+1).find(entry=>entry.level<=item.level&&entry.page>0),end=next?.page??(this.reader.getDoc?.()?.numPages??0)+1;
        const folded=new Set(notebookMeta(this.plugin.store.getDocMeta(this.reader.getFilePath()!)).foldedPages??[]),expanded=end>item.page&&Array.from({length:end-item.page},(_,offset)=>item.page+offset).every(page=>folded.has(page));
        const toggle=el("button",{text:expanded?"展开":"折叠","aria-label":`${expanded?"展开":"折叠"}章节 ${item.title}`});
        toggle.addEventListener("click",()=>{void this.reader.toggleOutlineFold!(item,items).catch(error=>new Notice(String(error)));});row.append(toggle);
      }
      const more=el("button", {class:"ms-toc-more",text:"…","aria-label":"目录菜单 "+item.title});
      more.addEventListener("click",event=>{const menu=new Menu();
        menu.addItem(entry=>entry.setTitle("重命名").onClick(()=>this.renameOutline(item)));
        menu.addItem(entry=>entry.setTitle("增加缩进").onClick(()=>this.changeOutlineLevel(new Set([item.id]),1)));
        menu.addItem(entry=>entry.setTitle("减少缩进").onClick(()=>this.changeOutlineLevel(new Set([item.id]),-1)));
        menu.addItem(entry=>entry.setTitle("删除").onClick(()=>this.deleteOutline(new Set([item.id]))));menu.showAtMouseEvent(event);
      });row.append(more);this.list.append(row);
    }
    if(!items.length)this.empty("文档没有目录");
    const toolbar=el("div", {class:"ms-toc-toolbar"});
    const action=(label:string,run:()=>void,disabled=false)=>{const b=el("button",{text:label,"aria-label":label});b.disabled=disabled;b.addEventListener("click",run);toolbar.append(b);};
    if(this.editingOutline){
      action("全选",()=>{this.outlineSelection=new Set(items.map(item=>item.id));this.signature="";void this.refresh();},!items.length);
      action("删除",()=>this.deleteOutline(this.outlineSelection),!items.length);
      action("增加缩进",()=>this.changeOutlineLevel(this.outlineSelection,1),!items.length);
      action("减少缩进",()=>this.changeOutlineLevel(this.outlineSelection,-1),!items.length);
      action("插入目录",()=>{void this.insertSelectionToOutline();});
      action("分割折页",()=>{void this.splitAtChapter().catch(error=>new Notice("分割折页失败："+String(error)));});
    }
    if(!this.editingOutline)action("AI 目录",()=>this.generateOutline());
    if(!this.editingOutline)action("目录转脑图",()=>{void this.outlineToMindmap().catch(error=>new Notice(String(error)));},!items.length);
    action(this.editingOutline?"完成":"编辑",()=>{this.editingOutline=!this.editingOutline;this.outlineSelection.clear();this.signature="";void this.refresh();});
    this.list.append(toolbar);
  }
  /** MN5「插入目录」：把当前页/选区文字插入目录，记入撤销历史。 */
  private async insertSelectionToOutline(): Promise<void> {
    const path = this.reader.getFilePath(); if (!path || !this.reader.setEditableOutline) return;
    const page = this.reader instanceof Object && "getCurrentPage" in this.reader ? Number((this.reader as unknown as { getCurrentPage(): number }).getCurrentPage()) : 1;
    const selection = (this.reader.getScrollContainer?.()?.ownerDocument ?? document).getSelection();
    const text = selection && !selection.isCollapsed ? selection.toString().trim().slice(0, 200) : "";
    openTextModal({ title: "插入目录", initial: text || "", placeholder: "目录标题", onOk: async (title: string) => {
      if (!title.trim()) return;
      const items = await this.reader.getEditableOutline?.() ?? [];
      const current = this.reader.getFilePath();
      if (current !== path) return;
      const next = [...items, { id: uid("toc"), title: title.trim(), page: Number.isFinite(page) ? page : 1, level: 0 }]
        .sort((a, b) => a.page - b.page || a.title.localeCompare(b.title, "zh-CN"));
      await this.reader.setEditableOutline?.(next);
      this.signature = ""; await this.refresh();
    } });
  }

  /** MN5「分割折页」：把当前页所在章节的页面折起（可撤销）。 */
  private async splitAtChapter(): Promise<void> {
    const items = await this.reader.getEditableOutline?.() ?? [];
    if (!items.length) { new Notice("文档没有目录，无法按章节分割折页"); return; }
    const page = "getCurrentPage" in this.reader ? Number((this.reader as unknown as { getCurrentPage(): number }).getCurrentPage()) : 1;
    let chapter = items[0];
    for (const item of items) if (item.page > 0 && item.page <= page) chapter = item;
    await this.reader.toggleOutlineFold?.(chapter, items);
    this.signature = ""; await this.refresh();
  }

  private async outlineToMindmap():Promise<void> {
    const path=this.reader.getFilePath(),canvasId=this.plugin.store.activeCanvasId,items=structuredClone(this.outlineItems);
    if(!path||!canvasId||!items.length)throw new Error("请先打开文档并选择脑图");
    const annotations=await this.plugin.store.loadAnnotations(path);
    if(this.disposed||this.reader.getFilePath()!==path||this.plugin.store.activeCanvasId!==canvasId)throw new Error("文档或脑图已切换");
    const notebook=documentNotebookState(this.plugin.store.getDocMeta(path)).active,parents:string[]=[];
    this.plugin.store.libraryTransaction("目录转脑图",()=>{
      const next=[...annotations];
      for(const [index,item] of items.entries()){
        const cardId=uid("card"),nodeId=uid("node"),anchorAnnId=item.page>0&&item.rects?.length?uid("ann"):undefined;
        if(anchorAnnId)next.push({id:anchorAnnId,docPath:path,docKind:"pdf",page:item.page,type:"highlight",rects:structuredClone(item.rects!),pdfCoordinateSpace:"pdf",pdfReferencePages:item.pageId?[{id:item.pageId,page:item.page}]:undefined,documentNotebookId:notebook,text:item.title,color:"#ffff00",cardId,createdAt:new Date().toISOString()});
        this.plugin.store.addCard({id:cardId,docPath:path,documentNotebookId:notebook,page:item.page||undefined,anchorAnnId,type:"excerpt",front:item.title,title:item.title,tags:[],links:[],createdAt:new Date().toISOString()});
        this.plugin.store.addNode({id:nodeId,cardId,canvasId,parentId:item.level?parents[item.level-1]??null:null,title:item.title,kind:"toc",collapsed:false,x:80+item.level*260,y:80+index*100});
        parents.length=item.level;parents[item.level]=nodeId;
      }
      if(next.length!==annotations.length)this.plugin.store.saveAnnotationsDebounced(path,next);
    });
  }
  openAiOutline(): void { this.generateOutline(); }
  private generateOutline():void {
    this.closeOutlineEditor?.();const path=this.reader.getFilePath(),doc=this.reader.getDoc?.(),service=aiServiceFor(this.plugin),controller=new AbortController();
    const {modal,close}=createModal("AI 目录",()=>{controller.abort();this.closeOutlineEditor=null;});this.closeOutlineEditor=close;
    modal.setAttribute("aria-label","AI 目录");const status=el("p",{role:"status"}),cancel=el("button",{text:"取消"});cancel.addEventListener("click",close);modal.append(status,cancel);
    if(!doc){status.textContent="请先打开 PDF 文档";return;}
    const current=()=>!this.disposed&&!controller.signal.aborted&&path===this.reader.getFilePath()&&doc===this.reader.getDoc?.();
    const instructions="Extract a hierarchical document TOC. Copy heading titles exactly from the source. Put the source [Pnumber] marker in every item's note. Do not invent headings or pages.";
    const sourceText=async()=>{
      const source:string[]=[];let length=0;
      for(let page=1;page<=doc.numPages;page++){const text=(await(await doc.getPage(page)).getTextContent()).items.map((item:any)=>item.str??"").join(" ");if(!current())throw new Error("文档已切换或窗口已关闭");const chunk=`[P${page}] ${text}`;length+=chunk.length;if(length>180000)throw new Error("文档文字过长，请使用当前选区的 AI 工具分段生成");source.push(chunk);}
      return source.join("\n");
    };
    const preview=el("div");modal.append(preview);
    const showPreview=(draft:Extract<AiDraft,{kind:"outline"}>)=>{
      if(!current())return;preview.replaceChildren();
      const rows=draft.items.map(item=>{const row=el("div",{class:"ms-toc-ai-row"}),title=el("input",{value:item.title,"aria-label":"AI目录标题"}),level=el("input",{type:"number",min:"1",max:"8",value:String(item.level),"aria-label":"AI目录层级"}),page=el("input",{type:"number",min:"1",max:String(doc.numPages),value:item.note.match(/\[P(\d+)\]/)?.[1]??"","aria-label":"AI目录页码"});row.append(title,level,page);preview.append(row);return{title,level,page};});
      const apply=el("button",{text:"保存目录"});preview.append(apply);status.textContent="请核对标题、层级和页码；保存会替换当前文档目录，可撤销。";
      apply.addEventListener("click",async()=>{if(!current())return;try{
        let previous=0;const items=rows.map(row=>{const title=row.title.value.trim(),level=Number(row.level.value),page=Number(row.page.value);if(!title||!Number.isInteger(level)||level<1||level>8||level>previous+1)throw new Error("目录标题不能为空，层级从 1 开始，每行最多增加一级");previous=level;return{id:uid("toc"),title,level:level-1,page};});
        if(items.some(item=>!Number.isInteger(item.page)||item.page<1||item.page>doc.numPages))throw new Error("请为每个条目填写有效页码");await this.reader.setEditableOutline?.(items);if(current())close();
      }catch(error){if(current())status.textContent=String(error);}});
    };
    if(service.isBound()){
      const generate=el("button",{text:"用 AI 生成目录"});modal.append(generate);status.textContent="生成后先预览和编辑目录标题、层级与页码，确认后保存。";
      generate.addEventListener("click",async()=>{if(!current())return;generate.disabled=true;status.textContent="正在读取文档…";try{
        const text=await sourceText();if(!current())return;status.textContent="正在生成目录…";const response=await service.request({task:"outline",text:instructions,context:{text,docPath:path??undefined},signal:controller.signal});if(!current())return;
        const draft=response.drafts.find(item=>item.kind==="outline");if(!draft||draft.kind!=="outline")throw new Error("AI 没有返回目录预览");showPreview(draft);
      }catch(error){if(current())status.textContent=String(error);}finally{if(current())generate.disabled=false;}});
    }else status.textContent="尚未绑定可用的直接 AI 服务；未发送文档内容。可直接通过 Claudian 生成目录；也可手动导入回复。";
    const bridge=claudianAvailability(this.plugin.app);
    if(bridge.available){
      const prefill=el("button",{text:"预填到 Claudian"});modal.append(prefill);
      const prompt=el("textarea",{"aria-label":"Claudian 目录提问",placeholder:"点击预填后在此保留完整提问，亦可复制到已有 Claudian。"});prompt.readOnly=true;modal.append(prompt);
      prefill.addEventListener("click",async()=>{if(!current())return;prefill.disabled=true;status.textContent="正在准备文档文字…";try{
        const text=await sourceText();if(!current())return;prompt.value=buildClaudianPrompt({task:"outline",text:instructions,context:{text,label:"当前 PDF 文档（含页码）"}});
        const result=await prefillClaudian(this.plugin.app,prompt.value,{signal:controller.signal});if(current())status.textContent=result.kind==="prefilled"?"已预填，未自动发送。请关闭此窗口，在 Claudian 中发送；返回 AI 目录粘贴回复。":result.reason;
      }catch(error){if(current())status.textContent=String(error);}finally{if(current())prefill.disabled=false;}});
    }
    if(bridge.available){
      const direct=el("button",{text:"通过 Claudian 生成目录"});modal.append(direct);
      direct.addEventListener("click",async()=>{
        if(!current()||direct.disabled)return;direct.disabled=true;preview.replaceChildren();status.textContent="正在读取文档并调用 Claudian…";
        const controls=[...modal.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLTextAreaElement>("button,input,textarea")].filter(control=>control!==cancel&&control!==direct);const previous=controls.map(control=>control.disabled);controls.forEach(control=>control.disabled=true);
        try{
          const text=await sourceText();if(!current())return;reply.value="";
          const output=await requestClaudian(this.plugin.app,buildClaudianPrompt({task:"outline",text:instructions,context:{text,label:"当前 PDF 文档（含页码）"}}),{signal:controller.signal,onText:fragment=>{if(current())reply.value+=fragment;}});
          if(!current())return;const draft=draftFromPastedReply("outline",output);if(draft.kind==="outline")showPreview(draft);
        }catch(error){if(current())status.textContent=aiErrorText(error);}
        finally{if(current()){direct.disabled=false;controls.forEach((control,index)=>control.disabled=previous[index]);}}
      });
    }
    const reply=el("textarea",{"aria-label":"Claudian 目录回复",placeholder:'粘贴 Claudian 的 JSON 目录回复；每项 note 应包含 [P页码]。'}),importReply=el("button",{text:"预览 Claudian 目录"});modal.append(reply,importReply);
    importReply.addEventListener("click",()=>{if(!current())return;try{const draft=draftFromPastedReply("outline",reply.value);if(draft.kind==="outline")showPreview(draft);}catch(error){status.textContent=String(error);}});
  }
  private commitOutline(items:DocumentOutlineItem[]):void {
    if(this.disposed)return;
    void this.reader.setEditableOutline?.(items).catch(error=>new Notice(String(error)));
  }
  private subtreeEnd(items:DocumentOutlineItem[],index:number):number {
    let end=index+1;while(end<items.length&&items[end].level>items[index].level)end++;return end;
  }
  private deleteOutline(ids:Set<string>):void {
    const items=this.outlineItems,remove=new Set<string>();
    items.forEach((item,index)=>{if(ids.has(item.id))for(const child of items.slice(index,this.subtreeEnd(items,index)))remove.add(child.id);});
    if(remove.size)this.commitOutline(items.filter(item=>!remove.has(item.id)));
  }
  private changeOutlineLevel(ids:Set<string>,delta:number):void {
    const items=structuredClone(this.outlineItems);let through=-1;
    for(let index=0;index<items.length;index++)if(ids.has(items[index].id)&&index>=through){
      const end=this.subtreeEnd(items,index),level=items[index].level;
      if(level+delta<0||delta>0&&(index===0||items[index-1].level<level))continue;
      for(let child=index;child<end;child++)items[child].level+=delta;through=end;
    }
    this.commitOutline(items);
  }
  private moveOutline(id:string,targetId:string,after:boolean):void {
    if(this.disposed||!this.editingOutline||id===targetId)return;
    const items=structuredClone(this.outlineItems),from=items.findIndex(item=>item.id===id),target=items.findIndex(item=>item.id===targetId);
    if(from<0||target<0)return;const end=this.subtreeEnd(items,from);if(target>=from&&target<end)return;
    const targetItem=items[target],block=items.splice(from,end-from),difference=targetItem.level-block[0].level;
    block.forEach(item=>item.level+=difference);
    const at=items.findIndex(item=>item.id===targetId),insert=after?this.subtreeEnd(items,at):at;items.splice(insert,0,...block);this.commitOutline(items);
  }
  private renameOutline(item:DocumentOutlineItem):void {
    this.closeOutlineEditor?.();const path=this.reader.getFilePath();
    const {modal,close}=createModal("重命名",()=>{this.closeOutlineEditor=null;});this.closeOutlineEditor=close;
    const input=el("input",{type:"text",value:item.title,"aria-label":"目录标题"}),ok=el("button",{text:"确定"}),cancel=el("button",{text:"取消"});
    const save=()=>{if(!input.value.trim()||this.disposed||path!==this.reader.getFilePath())return;
      this.commitOutline(this.outlineItems.map(entry=>entry.id===item.id?{...entry,title:input.value.trim()}:entry));close();};
    ok.addEventListener("click",save);cancel.addEventListener("click",close);input.addEventListener("keydown",event=>{if(event.key==="Enter")save();});modal.append(input,cancel,ok);input.focus();input.select();
  }
  private source(card: Card, path: string): CardSource | undefined {
    return card.sources?.find(source => source.docPath === path) ?? (card.docPath === path ? { docPath: path, anchorAnnId: card.anchorAnnId, page: card.page, documentNotebookId:card.documentNotebookId } : undefined);
  }
  private inkPreview(ann: Annotation): SVGSVGElement {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const stroke of ann.strokes!) for (const point of stroke) { left = Math.min(left, point.x * 600); right = Math.max(right, point.x * 600); top = Math.min(top, point.y * 800); bottom = Math.max(bottom, point.y * 800); }
    left -= 8; top -= 8; const width = right - left + 8, height = bottom - top + 8;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `${left} ${top} ${width} ${height}`); svg.setAttribute("aria-hidden", "true");
    for (const stroke of ann.strokes!) {
      if (!stroke.length) continue;
      const line = document.createElementNS(svg.namespaceURI, "polyline");
      line.setAttribute("points", stroke.map(point => `${point.x * 600},${point.y * 800}`).join(" "));
      line.setAttribute("fill", "none"); line.setAttribute("stroke", ann.color ?? INK_DEFAULT_COLOR); line.setAttribute("stroke-width", ann.inkBrush === "highlight" ? "10" : "2");
      line.setAttribute("stroke-linecap", "round"); line.setAttribute("stroke-linejoin", "round"); svg.append(line);
    }
    return svg;
  }
  private async renderThumbnail(row: HTMLElement, doc: any, current: () => boolean): Promise<void> {
    try {
      if(row.dataset.displayPage&&this.reader.renderDisplayThumbnail){await this.reader.renderDisplayThumbnail(Number(row.dataset.page),row.querySelector("canvas")!);return;}
      const page = await doc.getPage(Number(row.dataset.page));
      if (!current() || !row.isConnected) return;
      const projection = (scale: number) => this.reader.getPageViewport?.(page, scale) ?? page.getViewport({ scale });
      const base = projection(1), viewport = projection(220 / base.width);
      const canvas = row.querySelector("canvas")!;
      canvas.width = Math.max(1, Math.ceil(viewport.width - 1e-7)); canvas.height = Math.max(1, Math.ceil(viewport.height - 1e-7));
      const context = canvas.getContext("2d"); if (!context) return;
      const task = page.render({ canvasContext: context, viewport }); this.tasks.add(task);
      try { await task.promise; } finally { this.tasks.delete(task); }
    } catch (error) {
      if (!current() || (error as Error)?.name === "RenderingCancelledException") return;
      row.append(el("span", { class: "ms-document-preview-error", text: "预览未加载" }));
    }
  }
  private markSelected(row: HTMLElement): void {
    this.list.querySelectorAll("[aria-current]").forEach(item => item.removeAttribute("aria-current")); row.setAttribute("aria-current", "true");
  }
  private empty(message: string): void { this.list.append(el("p", { class: "ms-document-navigation-empty", text: message, role: "status" })); }
  dispose(): void { this.closeOutlineEditor?.(); this.disposed = true; this.revision++; this.stopStore(); this.stopAnnotations(); this.stopPageChanges(); this.stopCurrentPageChanges(); this.stopPreviews(); this.markdownOwner.unload(); this.tabs.remove(); this.element.remove(); }
}
