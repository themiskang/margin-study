import type MarginStudyPlugin from "../main";
import { Annotation, AnnotationType, Card, CardType, DEFAULT_HANDWRITING_PRESETS, DomRange, HandwritingPresetId, HandwritingPresetSpec, MindNode, PdfRect, PdfPageGeometry, RecallHintRequest, RecallHintResult, RecallOptionKey, Stroke } from "../types";
import { clampHandwritingWidth, handwritingPresetWidth, handwritingPresets } from "./handwritingPresets";
import { uid } from "../utils/id";
import { renderContextActionMenu } from "./contextActions";
import type { ContextAction } from "./contextActions";
import { openExtendSpeech } from "../pdf/extendSpeech";
import { aiErrorText } from "../ai/contracts";
import type { CondenseLevel } from "../ai/condense";
import { el, clear } from "../utils/dom";
import { openTextModal, createModal } from "../utils/modal";
import { todayStr } from "../srs";
import { Menu, Notice } from "obsidian";
import { VoiceRecorder, playVoice, chooseVoiceInput } from "../audio/voice";
import { transcribeVoice } from "../audio/transcription";
import { hasMic } from "../utils/platform";
import { RecallSession } from "../recall/session";
import { cloneStrokes } from "./penGeometry";
import type { HandwritingMode, InkChange, InkRecord, PenTool } from "./penGeometry";
import { annotationInkLayer, inkLayerState, InkLayerControls } from "./inkLayers";
import type { InkLayerState } from "./inkLayers";
import { annotationNotebook, documentNotebookState, DocumentNotebookControls, notebookMeta, updateNotebookMeta } from "./documentNotebooks";
import type { DocumentNotebookState } from "./documentNotebooks";
import type { DocMeta } from "../types";
import { openExtendImageCrop } from "../pdf/extendImageCrop";
import { openMediaPlayer, mediaFileKind, saveMediaFile } from "../audio/voice";
import { createFreeOverlay, loadOverlayImage } from "./overlay";
import { openInlineTextEditor } from "./inlineTextEditor";
import { annotationTextRuns } from "./textRuns";
import type { OverlayBox, OverlaySurface } from "./overlay";

/** 选区经子类解析后的标注定位信息（PDF 用坐标矩形，Word 用字符偏移） */
export type SelTarget =
  | { kind: "pdf"; pageNum: number; rects: PdfRect[]; pdfGeometry?: PdfPageGeometry[]; pdfCoordinateSpace?: "pdf" | "legacy-viewport" }
  | { kind: "html"; range: DomRange };

/** 语音落点（归一化坐标；PDF 附带页码） */
export type VoiceTarget = { x: number; y: number; page?: number };
export type AssistiveCandidate = {box:DOMRect;text:string;target:SelTarget;range?:Range;image?:string|(()=>string|undefined)};

/** Chronological reader edits; document commands can rebuild their paper asynchronously. */
export interface ReaderEditHistoryState { canUndo: boolean; canRedo: boolean; undoLabel?: string; redoLabel?: string; }
type ReaderPenChange = InkChange & { creation?: { annotation: Annotation; index: number; removed: boolean } };
type ReaderEditChange = { sequence: number; label: string } & (
  | { kind: "pen"; changes: ReaderPenChange[] }
  | { kind: "overlay"; before: Annotation; after: Annotation }
  | { kind: "document"; apply: (redo: boolean) => Promise<void> }
);

/**
 * 标注控制器公共基类：承载 PDF / Word 两份控制器的纯公共逻辑
 * （生命周期监听、选区捕获骨架、浮动工具条、语音/手写通用流程、点击标注弹层、
 * 生成卡片、持久化、pop 管理），把差异点（选区→标注转换、渲染、语音落点、手写）留给子类。
 * 抽基类旨在消除 ~90% 重复，降低后续改动弹层/卡片逻辑时两处不同步的风险
 * （见 OPTIMIZATION_REVIEW H）。
 */
export abstract class BaseAnnotationController {
  private continuousExcerpts = new Map<string, { cardId?: string; count: number }>();
  private continuousExcerptKey = "text";
  private get continuousExcerpt(): { cardId?: string; count: number } | null { return this.continuousExcerpts.get(this.continuousExcerptKey) ?? null; }
  setContinuousExcerptPen(key:string):void {
    this.continuousExcerptKey=key; this.continuousExcerptListener?.();
  }
  private continuousExcerptListener: (() => void) | null = null;
  setContinuousExcerptListener(listener: (() => void) | null): void { this.continuousExcerptListener = listener; }
  getContinuousExcerpt(): { active: boolean; count: number } { return { active: !!this.continuousExcerpt, count: this.continuousExcerpt?.count ?? 0 }; }
  setContinuousExcerpt(on: boolean): void {
    if (on && !this.docPath) return;
    if (on && !this.continuousExcerpt) this.continuousExcerpts.set(this.continuousExcerptKey, { count: 0 });
    if (!on) this.continuousExcerpts.delete(this.continuousExcerptKey);
    this.continuousExcerptListener?.();
  }
  continueExcerptInCard(cardId:string):boolean {
    const card=this.plugin.store.getCard(cardId);
    if (!card || card.docPath!==this.docPath || !["text","region"].includes(this.continuousExcerptKey)) return false;
    this.continuousExcerpts.set(this.continuousExcerptKey,{cardId,count:0});this.continuousExcerptListener?.();return true;
  }
  plugin: MarginStudyPlugin;
  protected docPath: string | null = null;
  protected cache: Annotation[] = [];
  protected color: string;
  protected popEl: HTMLElement | null = null;
  protected lastPoint = { x: 0, y: 0 };
  protected selTimer: number | null = null;
  private selectionSession = 0;
  private closeSelectionPop: (() => void) | null = null;
  private closeCompetingMenuListener: (() => void) | null = null;
  private closeSelectionSpeech: (() => void) | null = null;
  private automaticTextExcerpt = false;
  private lastAutomaticSelection: { range: Range; target: string; text: string; annotationId: string; revision: number } | null = null;
  setAutomaticTextExcerpt(on: boolean): void {
    if (this.automaticTextExcerpt === on) return;
    this.automaticTextExcerpt = on; this.lastAutomaticSelection = null;
    this.selectionSession++; if (this.selTimer !== null) window.clearTimeout(this.selTimer); this.selTimer = null; this.removePop();
  }

  // 语音批注（桌面 + 平板）
  protected recorder: VoiceRecorder | null = null;
  protected micBtn: HTMLButtonElement | null = null;
  protected voicePlacing = false;
  private recordingNotice: Notice | null = null;
  private pendingMedia: File | null = null;
  private closeMediaPlayer: (()=>void) | null = null;
  private voiceCommitTask: Promise<void> | null = null;
  protected documentRevision = 0;
  private disposed = false;
  private releasing = false;
  private unsubscribeAnnotations: (() => void) | null = null;
  private unsubscribeDocumentRename: (() => void) | null = null;
  private saving = false;
  private unsubscribeStore: (() => void) | null = null;
  private recall = new RecallSession();
  private recallScope?: string;
  private coverAllExcerpts = true;
  private recallHierarchy = 1;
  private recallAiHint = false;
  private recallHintLanguage: "auto" | "zh" | "en" = "auto";
  private recallHintEl: HTMLElement | null = null;
  private recallHintProvider?: (request: RecallHintRequest) => Promise<RecallHintResult>;
  private titleLinksEnabled = false;
  private handwritingPreset: HandwritingPresetId = "pen-1";
  private normalHandwritingPreset: HandwritingPresetId = "pen-1";
  private highlightHandwritingPreset: HandwritingPresetId = "highlight-1";

  // 手写批注（桌面鼠标 / 触控笔）
  protected penMode = false;
  private penBtn: HTMLButtonElement | null = null;
  protected penTool: PenTool = "draw";
  private penEditButtons = new Map<PenTool, HTMLButtonElement>();
  private penUndoButton: HTMLButtonElement | null = null;
  private penRedoButton: HTMLButtonElement | null = null;
  private editUndo: ReaderEditChange[] = [];
  private editRedo: ReaderEditChange[] = [];
  private editSequence = 0;
  private applyingEditHistory = false;
  private editHistoryListeners = new Set<(state: ReaderEditHistoryState) => void>();
  private inkLayers: InkLayerControls | null = null;
  private inkLayerFingerprint = "";
  private documentNotebooks: DocumentNotebookControls | null = null;
  private notebookFingerprint = "";
  private activeNotebookId = "default";
  private handwritingSyncPreference: boolean | null = null;
  private handwritingSyncListeners = new Set<(enabled: boolean) => void>();
  private handwritingModeListeners = new Set<(mode: HandwritingMode) => void>();
  private publishedHandwritingMode: HandwritingMode = "off";
  private handwritingSyncAvailable = false;
  private vanishPen = false;
  private overlayElements = new Map<HTMLElement, () => void>();
  private overlayPlacement: { kind: "text" | "image"; image?: string; width?: number; height?: number } | null = null;
  private overlayImageInput: HTMLInputElement | null = null;
  private overlayImageReplacement: string | null = null;
  private closeOverlayEditor: (() => void) | null = null;
  private overlayUndoButton: HTMLButtonElement | null = null;
  private overlayRedoButton: HTMLButtonElement | null = null;

  // 套索/区域摘录模式
  protected lassoMode = false;
  protected lassoBtn: HTMLButtonElement | null = null;

  private assistiveLayer: HTMLElement | null = null;
  private closeBlockMenuListener: (() => void) | null = null;
  private closeBlockCondense: (() => void) | null = null;
  private assistiveFrame: number | null = null;
  private assistiveMode: "off" | "block" | "legacy" = "off";
  private selectedBlocks = new Set<string>();
  private blockHistory: Set<string>[] = [];
  protected regionSession = 0;
  protected cancelRegionGesture(): void {}
  protected onReadingPreferencesChanged():void {}
  protected onTitleLinksChanged():void {}
  protected assistiveCandidates(): AssistiveCandidate[] {
    const body=this.getBodyEl(),nodes=[...body.querySelectorAll<HTMLElement>('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td')];
    return nodes.filter(node=>!node.querySelector('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td')).flatMap(node=>{
      if(!node.textContent?.trim())return [];const range=document.createRange();range.selectNodeContents(node);const target=this.resolveSelection(range),box=range.getBoundingClientRect();
      return target&&box.width>0&&box.height>0?[{box,text:range.toString().trim(),target,range}]:[];
    }).slice(0,200);
  }
  protected clearAssistiveExcerpt():void {
    this.closeBlockMenuListener?.();this.closeBlockMenuListener=null;
    if(this.assistiveFrame!==null)cancelAnimationFrame(this.assistiveFrame);this.assistiveFrame=null;this.assistiveLayer?.remove();this.assistiveLayer=null;
  }
  getBlockSelectionMode():boolean { return this.assistiveMode === "block"; }
  setBlockSelectionMode(on:boolean):void {
    if(on&&(this.disposed||this.releasing||!this.docPath))return;
    this.closeBlockCondense?.();this.closeBlockCondense=null;
    if (this.getBlockSelectionMode() !== on) this.selectionSession++;
    this.clearAssistiveExcerpt();this.selectedBlocks.clear();this.blockHistory=[];this.assistiveMode="off";
    if(on){if(this.selTimer!==null)window.clearTimeout(this.selTimer);this.selTimer=null;this.removePop();this.setRegionMode(false);this.setHandwritingMode("off");this.cancelOverlayPlacement();this.closeOverlayEditor?.();window.getSelection()?.removeAllRanges();this.assistiveMode="block";this.refreshAssistiveExcerpt();}
  }
  private toggleLegacyAssistive():void {
    const on=this.assistiveMode!=="legacy";this.setBlockSelectionMode(false);
    if(on&&!this.disposed&&!this.releasing&&this.docPath){this.setRegionMode(false);this.setHandwritingMode("off");this.assistiveMode="legacy";this.refreshAssistiveExcerpt();}
  }
  protected refreshAssistiveExcerpt():void {
    if(this.assistiveFrame!==null)cancelAnimationFrame(this.assistiveFrame);
    this.assistiveFrame=requestAnimationFrame(()=>{this.assistiveFrame=null;this.paintAssistiveExcerpt();});
  }
  private paintAssistiveExcerpt():void {
    this.closeBlockMenuListener?.();this.closeBlockMenuListener=null;
    this.assistiveLayer?.remove();this.assistiveLayer=null;
    if(this.assistiveMode==="off"||(this.assistiveMode==="legacy"&&this.plugin.store.settings.assistiveExcerpt===false)||!this.docPath||this.disposed||this.releasing)return;
    const candidates=this.assistiveCandidates();
    if(this.assistiveMode==="block")candidates.sort((a,b)=>a.box.top-b.box.top||a.box.left-b.box.left);
    const sc=this.getScrollContainer(),bounds=sc.getBoundingClientRect(),layer=el('div',{class:'ms-assistive-layer','aria-label':'辅助摘录识别框'}),selected=new Set<number>();
    layer.style.height=`${sc.scrollHeight}px`;
    if(this.assistiveMode==="block"){
      const tools=el('div',{class:'ms-assistive-tools',role:'toolbar','aria-label':'块选择操作'}),status=el('span',{role:'status',text:this.selectedBlocks.size?`已选 ${this.selectedBlocks.size} 块`:'点击块'});
      const entries=candidates.map(candidate=>({candidate,key:JSON.stringify([candidate.target,candidate.text,!!candidate.image])}));
      const undo=el('button',{type:'button',text:'撤销','aria-label':'块选择：撤销'}),choose=el('button',{type:'button',text:'选择','aria-label':'块选择：选择'}),copy=el('button',{type:'button',text:'复制','aria-label':'块选择：复制'});
      const exit=el('button',{type:'button',text:'✕','aria-label':'退出块选择'}),more=el('button',{type:'button',text:'更多','aria-label':'块选择：更多','aria-expanded':'false'}),moreMenu=el('div',{class:'ms-block-more',role:'menu','aria-label':'块选择更多操作'});
      moreMenu.hidden=true;
      exit.addEventListener('click',()=>{this.setBlockSelectionMode(false);sc.dispatchEvent(new CustomEvent('ms-block-selection-change',{bubbles:true}));});
      const closeMore=()=>{moreMenu.hidden=true;more.setAttribute('aria-expanded','false');};
      document.addEventListener('ms-card-menu-opening',closeMore);this.closeBlockMenuListener=()=>document.removeEventListener('ms-card-menu-opening',closeMore);
      more.addEventListener('click',()=>{if(moreMenu.hidden){document.dispatchEvent(new Event('ms-block-menu-opening'));moreMenu.hidden=false;more.setAttribute('aria-expanded','true');}else closeMore();});
      const selectedTextEntries=()=>{const indexes=entries.flatMap((entry,index)=>this.selectedBlocks.has(entry.key)?[index]:[]);if(!indexes.length||indexes.length!==this.selectedBlocks.size||indexes.some((index,i)=>i>0&&index!==indexes[i-1]+1))return [];const chosen=indexes.map(index=>entries[index]);return chosen.every(entry=>entry.candidate.range&&!entry.candidate.image)?chosen:[];};
      const selectedImageEntry=()=>{const selected=entries.filter(entry=>this.selectedBlocks.has(entry.key));return this.selectedBlocks.size===1&&selected.length===1&&selected[0].candidate.image?selected[0]:undefined;};
      const selectedRange=():Range|null=>{if(this.assistiveMode!=='block'||this.disposed||this.releasing||!sc.isConnected)return null;const chosen=selectedTextEntries();if(!chosen.length)return null;for(const entry of chosen){const part=entry.candidate.range!;if(!part.startContainer.isConnected||!part.endContainer.isConnected||!sc.contains(part.commonAncestorContainer)||part.toString().trim()!==entry.candidate.text||JSON.stringify(this.resolveSelection(part))!==JSON.stringify(entry.candidate.target))return null;}const range=chosen[0].candidate.range!.cloneRange(),last=chosen[chosen.length-1].candidate.range!;try{range.setEnd(last.endContainer,last.endOffset);}catch{return null;}return range.collapsed?null:range;};
      const condenseSource=():{text:string;images:string[]}|null=>{const range=selectedRange();if(range)return {text:range.toString(),images:[]};if(this.assistiveMode!=='block'||this.disposed||this.releasing||!sc.isConnected)return null;const image=selectedImageEntry();if(!image)return null;const probe=this.assistiveCandidates().find(candidate=>!!candidate.image&&JSON.stringify([candidate.target,candidate.text,true])===image.key);if(!probe)return null;const data=typeof probe.image==='function'?probe.image():probe.image;return data?{text:probe.text,images:[data]}:null;};
      const speech=el('button',{type:'button',text:'朗读','aria-label':'块选择：朗读'}),textAction=el('button',{type:'button',text:'文本','aria-label':'块选择：文本'}),fold=el('button',{type:'button',text:'折页','aria-label':'块选择：折页'}),reset=el('button',{type:'button',text:'清空重选','aria-label':'块选择：清空重选'}),condense=el('button',{type:'button',text:'浓缩','aria-label':'块选择：浓缩'});
      const colors=this.plugin.store.getEffectiveSceneSettings().colors.slice(0,4).map((color,index)=>{const item=el('button',{type:'button',text:`颜色 ${index+1}`,'aria-label':`块选择：颜色 ${index+1}`});item.addEventListener('click',()=>{const range=selectedRange();if(!range)return;const target=this.resolveSelection(range);if(!target)return;const text=range.toString();this.setBlockSelectionMode(false);this.commitAnnotation(target,'highlight',color,text);sc.dispatchEvent(new CustomEvent('ms-block-selection-change',{bubbles:true}));});return item;});
      const sync=()=>{status.textContent=this.selectedBlocks.size?`已选 ${this.selectedBlocks.size} 块`:'点击块';undo.disabled=!this.blockHistory.length;more.disabled=!this.selectedBlocks.size;if(more.disabled){moreMenu.hidden=true;more.setAttribute('aria-expanded','false');}copy.disabled=speech.disabled=!selectedTextEntries().length;textAction.disabled=copy.disabled||!!this.continuousExcerpt;for(const color of colors)color.disabled=copy.disabled;const image=selectedImageEntry();condense.hidden=!image;condense.disabled=!image;fold.hidden=!image||image.candidate.target.kind!=='pdf'||!this.selectionActions(image.candidate.target,'').some(action=>action.id==='fold');reset.disabled=!this.selectedBlocks.size;choose.disabled=!selectedTextEntries().length&&!image;for(const frame of layer.querySelectorAll<HTMLButtonElement>('.ms-assistive-frame'))frame.setAttribute('aria-pressed',String(this.selectedBlocks.has(frame.dataset.blockKey??'')));};
      let textNumber=0,imageNumber=0;
      for(const [index,candidate] of candidates.entries()){
        const key=entries[index].key;
        const number=candidate.image?++imageNumber:++textNumber;
        const frame=el('button',{type:'button',class:'ms-assistive-frame'+(candidate.image?' is-image':''),'aria-label':`辅助摘录${candidate.image?'图片':'文字'} ${number}: ${candidate.text.slice(0,60)}`,'aria-pressed':String(this.selectedBlocks.has(key))}),box=candidate.box;
        frame.dataset.blockKey=key;
        frame.style.cssText=`left:${box.left-bounds.left+sc.scrollLeft}px;top:${box.top-bounds.top+sc.scrollTop}px;width:${box.width}px;height:${box.height}px`;
        frame.addEventListener('pointerdown',event=>event.stopPropagation());frame.addEventListener('mousedown',event=>event.preventDefault());frame.addEventListener('click',event=>{event.stopPropagation();this.blockHistory.push(new Set(this.selectedBlocks));if(this.selectedBlocks.size===1){const start=entries.findIndex(entry=>this.selectedBlocks.has(entry.key));if(start>=0&&start!==index)this.selectedBlocks=new Set(entries.slice(Math.min(start,index),Math.max(start,index)+1).map(entry=>entry.key));else this.selectedBlocks.clear();}else this.selectedBlocks=new Set([key]);sync();});layer.append(frame);
      }
      undo.addEventListener('click',()=>{if(undo.disabled)return;this.selectedBlocks=this.blockHistory.pop()??new Set();sync();});
      copy.addEventListener('click',()=>{const text=selectedRange()?.toString();if(text?.trim())void navigator.clipboard.writeText(text).catch(()=>new Notice('复制失败'));});
      speech.addEventListener('click',()=>{const text=selectedRange()?.toString();if(!text?.trim())return;this.closeSelectionSpeech?.();this.closeSelectionSpeech=openExtendSpeech(sc,text,'选区朗读');});
      condense.addEventListener('click',()=>{
        const source=condenseSource();if(!source||(!source.text.trim()&&!source.images.length))return;const sourceKey=JSON.stringify(source);this.closeBlockCondense?.();
        let request:AbortController|null=null,closed=false;
        const {modal,close}=createModal('浓缩',()=>{closed=true;request?.abort();request=null;this.closeBlockCondense=null;});
        this.closeBlockCondense=close;
        const level=el('select',{'aria-label':'浓缩档位'}) as HTMLSelectElement;
        for(const [value,label] of [['sentence','一句话'],['points','要点'],['outline','脉络']] as const)level.append(el('option',{value,text:label}));
        const language=el('select',{'aria-label':'浓缩语言'}) as HTMLSelectElement;
        for(const [value,label] of [['简体中文','简体中文'],['English','English']] as const)language.append(el('option',{value,text:label}));
        const style=el('select',{'aria-label':'浓缩显示样式'}) as HTMLSelectElement;
        for(const [value,label] of [['plain','普通'],['quote','引用']] as const)style.append(el('option',{value,text:label}));
        const service=this.plugin.condenseService(),provider=el('p'),status=el('p',{role:'status',text:'选择档位后，点击生成。'}),output=el('textarea',{'aria-label':'浓缩结果',readonly:true}) as HTMLTextAreaElement;
        try{const info=service.status();provider.textContent=`服务：${info.service} · ${info.model||'未配置模型'} · ${info.bound?'已绑定':'未绑定'}`;}catch(error){provider.textContent=aiErrorText(error);}
        const generate=el('button',{type:'button',text:'生成浓缩','aria-label':'生成浓缩'}),stop=el('button',{type:'button',text:'取消生成','aria-label':'取消浓缩'}),done=el('button',{type:'button',text:'关闭'});stop.disabled=true;
        let result='';style.addEventListener('change',()=>{output.value=style.value==='quote'?result.split('\n').map(line=>'> '+line).join('\n'):result;});
        stop.addEventListener('click',()=>request?.abort());done.addEventListener('click',close);
        generate.addEventListener('click',()=>{if(request)return;if(JSON.stringify(condenseSource())!==sourceKey){status.textContent='选区已变化，请重新选择。';return;}const controller=new AbortController(),requestedLevel=level.value as CondenseLevel;request=controller;generate.disabled=true;stop.disabled=false;level.disabled=language.disabled=true;status.textContent='正在浓缩…';
          void service.request({...source,level:requestedLevel,language:language.value,signal:controller.signal}).then(value=>{if(closed||request!==controller)return;if(JSON.stringify(condenseSource())!==sourceKey){status.textContent='选区已变化，请重新选择。';return;}result=value.text;output.value=style.value==='quote'?result.split('\n').map(line=>'> '+line).join('\n'):result;status.textContent=`${value.cached?'缓存命中':'生成完成'} · ${value.service} · ${value.model} · ${level.selectedOptions[0]?.textContent??''}`;}).catch(error=>{if(!closed&&request===controller)status.textContent=aiErrorText(error);}).finally(()=>{if(!closed&&request===controller){request=null;generate.disabled=false;stop.disabled=true;level.disabled=language.disabled=false;}});
        });
        modal.append(provider,level,language,style,status,output,generate,stop,done);
      });
      reset.addEventListener('click',()=>{if(reset.disabled)return;this.blockHistory.push(new Set(this.selectedBlocks));this.selectedBlocks.clear();sync();});
      fold.addEventListener('click',()=>{if(fold.hidden||this.assistiveMode!=='block'||this.disposed||this.releasing||!sc.isConnected)return;const image=selectedImageEntry();if(!image)return;const probe=this.assistiveCandidates().find(candidate=>!!candidate.image&&JSON.stringify([candidate.target,candidate.text,true])===image.key);if(!probe)return;const action=this.selectionActions(probe.target,'').find(item=>item.id==='fold');if(!action)return;this.setBlockSelectionMode(false);sc.dispatchEvent(new CustomEvent('ms-block-selection-change',{bubbles:true}));void Promise.resolve(action.run()).catch(error=>new Notice('折页失败：'+String(error)));});
      textAction.addEventListener('click',()=>{if(textAction.disabled||this.continuousExcerpt)return;const range=selectedRange();if(!range)return;const target=this.resolveSelection(range);if(!target)return;const text=range.toString(),before=new Set(this.cache.map(ann=>ann.id));this.setBlockSelectionMode(false);this.commitAnnotation(target,'highlight',this.color,text);const annotation=this.cache.find(ann=>!before.has(ann.id));if(annotation)this.addRegionToMindmap(annotation);sc.dispatchEvent(new CustomEvent('ms-block-selection-change',{bubbles:true}));});
      choose.addEventListener('click',()=>{if(choose.disabled||this.assistiveMode!=='block')return;const view=this.getScrollContainer(),imageEntry=selectedImageEntry();if(imageEntry){const revision=this.documentRevision,path=this.docPath,session=this.selectionSession,probe=this.assistiveCandidates().find(candidate=>!!candidate.image&&JSON.stringify([candidate.target,candidate.text,true])===imageEntry.key);if(!probe||!path)return;const image=typeof probe.image==='function'?probe.image():probe.image;if(!image||revision!==this.documentRevision||path!==this.docPath||session!==this.selectionSession||!view.isConnected||this.disposed||this.releasing)return;this.setBlockSelectionMode(false);this.commitRegion(probe.target,image,probe.text);view.dispatchEvent(new CustomEvent('ms-block-selection-change',{bubbles:true}));return;}const chosen=selectedTextEntries(),selection=window.getSelection();if(!chosen.length||!selection)return;for(const entry of chosen){const part=entry.candidate.range!;if(!part.startContainer.isConnected||!part.endContainer.isConnected||!view.contains(part.commonAncestorContainer)||part.toString().trim()!==entry.candidate.text||JSON.stringify(this.resolveSelection(part))!==JSON.stringify(entry.candidate.target))return;}const first=chosen[0].candidate.range!,last=chosen[chosen.length-1].candidate.range!,range=first.cloneRange();try{range.setEnd(last.endContainer,last.endOffset);}catch{return;}if(range.collapsed||!this.resolveSelection(range))return;this.setBlockSelectionMode(false);selection.removeAllRanges();selection.addRange(range);this.handleSelection(true);view.dispatchEvent(new CustomEvent('ms-block-selection-change',{bubbles:true}));});
      moreMenu.append(...colors.slice(2),speech,textAction,fold,reset,condense);
      tools.append(exit,status,undo,choose,copy,...colors.slice(0,2),more,moreMenu);
      const edit=el('button',{type:'button',text:'编辑','aria-label':'块选择：编辑',title:'编辑操作尚未接通'});edit.disabled=true;tools.append(edit);
      sync();tools.addEventListener('mousedown',event=>event.preventDefault());
      tools.addEventListener('pointerdown',event=>event.stopPropagation());layer.append(tools);sc.append(layer);this.assistiveLayer=layer;return;
    }
    if(!candidates.length)return;
    const revision=this.documentRevision,path=this.docPath;
    const tools=el('div',{class:'ms-assistive-tools'}),all=el('button',{text:'全选识别框','aria-label':'全选识别框'}),extract=el('button',{text:'一键摘录','aria-label':'一键摘录'});extract.disabled=true;
    const frames=candidates.map((candidate,index)=>{
      const frame=el('button',{class:'ms-assistive-frame'+(candidate.image?' is-image':''),'aria-label':`辅助摘录${candidate.image?'图片':'文字'} ${index+1}: ${candidate.text.slice(0,60)}`,'aria-pressed':'false'}),box=candidate.box;
      frame.style.cssText=`left:${box.left-bounds.left+sc.scrollLeft}px;top:${box.top-bounds.top+sc.scrollTop}px;width:${box.width}px;height:${box.height}px`;
      frame.addEventListener('pointerdown',event=>event.stopPropagation());frame.addEventListener('mousedown',event=>event.preventDefault());frame.addEventListener('click',event=>{event.stopPropagation();selected.has(index)?selected.delete(index):selected.add(index);sync();});layer.append(frame);return frame;
    });
    const sync=()=>{frames.forEach((frame,index)=>frame.setAttribute('aria-pressed',String(selected.has(index))));extract.disabled=!selected.size;extract.textContent=selected.size?`一键摘录 (${selected.size})`:'一键摘录';};
    all.addEventListener('click',event=>{event.stopPropagation();if(selected.size===frames.length)selected.clear();else frames.forEach((_,index)=>selected.add(index));sync();});
    extract.addEventListener('click',event=>{event.stopPropagation();const chosen=[...selected].sort((a,b)=>a-b).map(index=>candidates[index]);selected.clear();sync();
      for(const candidate of chosen){if(revision!==this.documentRevision||path!==this.docPath||this.disposed||this.releasing)break;if(candidate.image){const image=typeof candidate.image==='function'?candidate.image():candidate.image;if(image)this.commitRegion(candidate.target,image,candidate.text);}else this.commitAnnotation(candidate.target,'highlight',this.color,candidate.text);}this.removePop();this.refreshAssistiveExcerpt();
    });
    tools.addEventListener('pointerdown',event=>event.stopPropagation());tools.append(all,extract);layer.append(tools);sc.append(layer);this.assistiveLayer=layer;
  }
  private currentTarget: SelTarget | null = null;
  private currentText = "";

  constructor(plugin: MarginStudyPlugin) {
    this.plugin = plugin;
    // 防御：升级旧 data.json 可能缺 colors/defaultColor（浅合并不补），直接访问会崩。
    const settings = plugin.store.getEffectiveSceneSettings();
    const colors = settings.colors ?? [];
    const def = settings.defaultColor ?? "#ffd54f";
    this.color = colors.includes(def) ? def : colors[0] ?? "#ffd54f";
  }

  /** 子类构造赋值 reader 后调用，注册全局监听 */
  protected attach(): void {
    this.unsubscribeDocumentRename = this.plugin.store.subscribeDocumentRename?.((oldPath, newPath) => {
      if (this.disposed || this.docPath !== oldPath) return;
      this.docPath = newPath;
      this.watchAnnotations();
    }) ?? null;
    this.getScrollContainer().addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("mousedown", this.onDocMouseDown);
    document.addEventListener("selectionchange", this.onSelectionChange);
    this.getScrollContainer().addEventListener("click", this.onOverlayPlace, true);
    document.addEventListener("keydown", this.onOverlayPlacementKey);
    this.recallScope = this.plugin.store.activeCanvasId;
    this.unsubscribeStore = this.plugin.store.subscribe?.(() => {
      if (this.recallScope !== this.plugin.store.activeCanvasId) { this.recallScope = this.plugin.store.activeCanvasId; this.recall.clear(); }
      if (!this.disposed && !this.releasing) {
        this.syncDocumentNotebooks();
        this.syncInkLayers();
        this.syncHandwritingSyncPreference();
        this.syncOcclusionElements();
        this.refreshAssistiveExcerpt();
        this.onReadingPreferencesChanged();
        if (this.titleLinksEnabled) this.renderTitleLinks();
      }
    }) ?? null;
  }

  /** Recall controls affect this reader view only. */
  setRecallMode(on: boolean, coverAllExcerpts = this.coverAllExcerpts): void {
    if (!on) this.removeRecallHint();
    this.getScrollContainer().closest(".ms-reader-root")?.classList.toggle("ms-recall",on);
    this.coverAllExcerpts = coverAllExcerpts; this.recall.clear(); this.syncOcclusionElements();
  }
  setRecallCoverAll(on: boolean): void { this.coverAllExcerpts = on; this.recall.clear(); this.syncOcclusionElements(); }
  clearRecallReveals(): void { this.recall.clear(); this.syncOcclusionElements(); }
  getRecallHierarchy(): number { return this.recallHierarchy; }
  setRecallHierarchy(level: number): void {
    if (!Number.isInteger(level) || level < 1 || level > 8) return;
    this.recallHierarchy = level;
    this.recall.clear();
    this.syncOcclusionElements();
  }
  getRecallAiHint(): boolean { return this.recallAiHint; }
  setRecallAiHint(on: boolean): void {
    this.recallAiHint = on;
    if (!on) this.removeRecallHint();
  }
  getRecallHintLanguage(): "auto" | "zh" | "en" { return this.recallHintLanguage; }
  setRecallHintLanguage(language: "auto" | "zh" | "en"): void {
    if (!["auto", "zh", "en"].includes(language)) return;
    this.recallHintLanguage = language;
  }
  setRecallHintProvider(provider?: (request: RecallHintRequest) => Promise<RecallHintResult>): void { this.recallHintProvider = provider; }
  getRecallSetting(key: RecallOptionKey): boolean { return this.recall.getOption(key); }
  setRecallSetting(key: RecallOptionKey, on: boolean): void {
    this.recall.setOption(key, on);
    if (key === "singleReveal") this.recall.clear();
    this.syncOcclusionElements();
  }
  getTitleLinksEnabled(): boolean { return this.titleLinksEnabled; }
  setTitleLinksEnabled(on: boolean): void {
    this.titleLinksEnabled = on;
    this.onTitleLinksChanged();
  }
  /** Strict case-insensitive whole-keyword links backed by the active study set's cards. */
  protected renderTitleLinks(): void {
    const root = this.plugin.studyWorkspace?.getReader() === this.plugin.activeReader
      ? (this.getScrollContainer().closest(".ms-reader-root") ?? this.getBodyEl())
      : this.getBodyEl();
    root.querySelectorAll<HTMLElement>(".ms-title-link").forEach((node) => {
      const parent = node.parentNode;
      if (parent) parent.replaceChild(document.createTextNode(node.textContent ?? ""), node);
      parent?.normalize();
    });
    if (!this.titleLinksEnabled || !this.docPath || !this.plugin.store.activeStudySetId) return;
    const keywords = new Map<string, string[]>();
    for (const card of this.plugin.store.cardsForStudySet()) {
      // MN4 uses the card title as the dictionary entry. Semicolons split one
      // title into several complete keywords; stored keywords remain readable
      // for cards authored before the title-link contract was completed.
      const titleKeywords = card.title
        ? card.title.split(/[;；]/).map(value => value.trim()).filter(Boolean)
        : [];
      for (const raw of [...titleKeywords, ...(card.keywords ?? [])]) for (const keyword of raw.split(/[;；,，\n]/).map(value => value.trim()).filter(Boolean)) {
        const key = keyword.toLocaleLowerCase();
        keywords.set(key, [...new Set([...(keywords.get(key) ?? []), card.id])]);
      }
    }
    if (!keywords.size) return;
    const ordered = [...keywords.keys()].sort((a, b) => b.length - a.length);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node as Text;
      if (!text.data.trim() || text.parentElement?.closest(".ms-ann,.ms-title-link,input,textarea,select,[contenteditable=true],script,style")) continue;
      nodes.push(text);
    }
    for (const text of nodes) {
      if (!text.isConnected) continue;
      const source = text.data;
      const matcher = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${ordered.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
      let last = 0, found: RegExpExecArray | null;
      const fragment = document.createDocumentFragment();
      while ((found = matcher.exec(source))) {
        if (found.index > last) fragment.append(document.createTextNode(source.slice(last, found.index)));
        const link = el("button", {
          type: "button",
          class: "ms-title-link",
          text: found[0],
          "aria-label": `标题链接：${found[0]}`,
        }) as HTMLButtonElement;
        const ids = keywords.get(found[0].toLocaleLowerCase()) ?? [];
        link.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const cards = ids.map(id => this.plugin.store.getCard(id)).filter((card): card is Card => !!card);
          if (!cards.length) return;
          this.plugin.viewEvents?.onDocumentCardSelect?.(cards[0].id);
          const menu = new Menu();
          for (const card of cards) {
            const title = card.title?.trim() || card.front.trim().slice(0, 80) || "未命名卡片";
            menu.addItem(item => item.setTitle(title).onClick(() => {
              void import("../cards/cardView").then(({ openDetail }) => openDetail(this.plugin, card, () => this.plugin.refreshMindmap()));
            }));
          }
          const rect = link.getBoundingClientRect();
          menu.showAtPosition({ x: rect.left, y: rect.bottom + 6 });
        });
        fragment.append(link);
        last = found.index + found[0].length;
      }
      if (!last) continue;
      if (last < source.length) fragment.append(document.createTextNode(source.slice(last)));
      text.parentNode?.replaceChild(fragment, text);
    }
  }

  /** Shared hook for lazy PDF pages, zoom rebuilds and HTML text wrappers. */
  protected syncOcclusionElements(): void {
    const root = this.getScrollContainer().closest<HTMLElement>(".ms-reader-root"); if (!root) return;
    const active = root.classList.contains("ms-recall"), store = this.plugin.store;
    const workspace = root.closest<HTMLElement>(".ms-study-workspace");
    root.toggleAttribute("data-recall-blur", active && this.recall.getOption("blurExcerpts"));
    workspace?.toggleAttribute("data-recall-mask-body", active && this.recall.getOption("maskCardBody"));
    workspace?.toggleAttribute("data-recall-mask-emphasis-images", active && this.recall.getOption("maskEmphasisImages"));
    workspace?.toggleAttribute("data-recall-single", active && this.recall.getOption("singleReveal"));
    workspace?.classList.toggle("ms-recall-title-only", active && this.recall.getOption("maskMindMapTitles"));
    const displayed = new Map(this.getAnnotationsForDisplay().map((ann) => [ann.id,ann]));
    const covered = (ann: Annotation): boolean => {
      const card = ann.cardId ? store.getCard(ann.cardId) : undefined;
      const node = card && store.nodes?.find(n => n.cardId === card.id && n.canvasId === store.activeCanvasId && !n.hidden);
      return this.recall.getOption("maskDocumentExcerpts") && ["highlight","underline","strike","region"].includes(ann.type) && (this.coverAllExcerpts || !!(node?.occluded ?? card?.occluded));
    };
    let counter = root.querySelector<HTMLElement>("[data-recall-remaining]");
    if (active) {
      if (!counter) { counter = el("div", { class: "ms-recall-remaining", "data-recall-remaining": "", "aria-live": "polite" }); root.append(counter); }
      const remaining = [...displayed.values()].filter(ann => covered(ann) && !this.recall.has("excerpt:" + ann.id)).length;
      counter.replaceChildren(el("span",{text:`还有 ${remaining} 处摘录遮挡`}));
      const inkRemaining=this.recall.getOption("maskHighlighter")?[...displayed.values()].filter(ann=>ann.type==="pen"&&ann.inkBrush==="highlight"&&ann.inkRecallPurpose!=="highlight"&&this.isInkVisible(ann)).reduce((sum,ann)=>sum+(ann.strokes??[]).reduce((count,stroke,index)=>count+Number(stroke.some(point=>Number.isFinite(point.x)&&Number.isFinite(point.y))&&!this.recall.has(`ink:${ann.id}:${index}`)),0),0):0;
      if(inkRemaining)counter.append(el("span",{"data-recall-ink-remaining":"",text:`还有 ${inkRemaining} 处荧光笔遮挡`}));
    } else counter?.remove();
    for (const element of root.querySelectorAll<HTMLElement>("[data-ann-id]")) {
      const ann = displayed.get(element.dataset.annId ?? ""); if (!ann) continue;
      element.classList.toggle("ms-document-notebook-reference", this.isNotebookReference(ann));
      if (element.hasAttribute("data-recall-ink")) continue;
      const occluded = active && (element.hasAttribute("data-recall-ink-mask") ? this.recall.getOption("maskHighlighter") : covered(ann));
      const key = element.dataset.recallKey ?? "excerpt:"+ann.id;
      const revealed = active && this.recall.has(key);
      element.classList.toggle("is-occluded",occluded); element.classList.toggle("is-revealed",revealed);
      if(element.hasAttribute("data-recall-ink-mask")){element.setAttribute("aria-pressed",String(revealed));element.setAttribute("aria-label",revealed?"重新遮回荧光笔":"揭开荧光笔遮挡");}
      if (occluded && !revealed) {
        if (element.title) { element.dataset.occlusionTitle = element.title; element.removeAttribute("title"); }
      } else if (element.dataset.occlusionTitle !== undefined) { element.title = element.dataset.occlusionTitle; delete element.dataset.occlusionTitle; }
    }
  }

  /** Draw view-only covers around each highlighter stroke using the rendered surface coordinates. */
  protected appendRecallInkMasks(parent: HTMLElement, ann: Annotation, strokes: Stroke[][], width: number, height: number): HTMLElement[] {
    if (ann.inkBrush !== "highlight" || ann.inkRecallPurpose === "highlight" || !width || !height) return [];
    const masks: HTMLElement[] = [];
    strokes.forEach((stroke, index) => {
      const points=stroke.filter(point=>Number.isFinite(point.x)&&Number.isFinite(point.y));if(!points.length)return;
      const xs=points.map(point=>point.x*width),ys=points.map(point=>point.y*height),pad=Math.max(4,(ann.inkWidth??16)/2+2);
      const left=Math.max(0,Math.min(...xs)-pad),top=Math.max(0,Math.min(...ys)-pad),right=Math.min(width,Math.max(...xs)+pad),bottom=Math.min(height,Math.max(...ys)+pad);
      if(right<=left||bottom<=top)return;
      const mask=el("button",{type:"button",class:"ms-ann ms-recall-ink-mask","data-recall-ink-mask":"","aria-label":"揭开荧光笔遮挡"});
      mask.dataset.annId=ann.id;mask.dataset.recallKey=`ink:${ann.id}:${index}`;
      Object.assign(mask.style,{position:"absolute",left:`${left}px`,top:`${top}px`,width:`${right-left}px`,height:`${bottom-top}px`});
      const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
      svg.setAttribute("viewBox",`0 0 ${right-left} ${bottom-top}`);svg.setAttribute("aria-hidden","true");
      const path=document.createElementNS("http://www.w3.org/2000/svg","path");
      const coords=points.map(point=>`${point.x*width-left} ${point.y*height-top}`);
      path.setAttribute("d",`M ${coords[0]} ${coords.length===1?`L ${coords[0]}`:coords.slice(1).map(point=>`L ${point}`).join(" ")}`);
      path.setAttribute("stroke-width",String(pad*2));path.setAttribute("stroke-linecap","round");path.setAttribute("stroke-linejoin","round");path.setAttribute("fill","none");svg.append(path);mask.append(svg);
      mask.addEventListener("click",event=>{if(this.handleRecallClick(ann,event))event.stopPropagation();});
      parent.append(mask);masks.push(mask);
    });
    return masks;
  }

  // ===== 抽象接口（子类提供） =====
  protected abstract getScrollContainer(): HTMLElement;
  /** 返回文档内容容器（Word 为真 body；PDF 无单一 body，返回滚动容器作占位，不直接用于渲染） */
  protected abstract getBodyEl(): HTMLElement;
  /** DOM 选区 → 标注定位信息；落在文档外返回 null */
  protected abstract resolveSelection(range: Range): SelTarget | null;
  /** 由选区定位信息 + 类型 构造并渲染一条标注 */
  protected abstract commitAnnotation(target: SelTarget, type: AnnotationType, color: string, text: string): void;
  /** 增量渲染单条标注 */
  protected abstract renderOne(ann: Annotation): void;
  /** 增量移除单条标注的 DOM */
  protected abstract removeAnnotationEl(ann: Annotation): void;
  /** 跳转到标注并高亮闪烁 */
  abstract flashAnnotation(annId: string): void;
  /** 语音落点解析（子类按各自文档结构计算归一化坐标/页码） */
  protected abstract resolveVoiceTarget(e: MouseEvent): VoiceTarget | null;
  /** 保存语音 blob 并构造语音标注 */
  protected abstract commitVoice(blob: Blob, target: VoiceTarget): void | Promise<void>;
  /** 进入手写模式（子类按各自文档结构创建 PenController 并绑定 onCommit） */
  protected abstract setupPen(): void;
  /** 退出手写模式（清理 PenController） */
  protected abstract teardownPen(): void;
  protected placeTextInExtend(_event: MouseEvent): boolean { return false; }
  protected abstract resolveOverlaySurface(event: MouseEvent, width: number, height: number): OverlaySurface | null;
  protected abstract getOverlaySurface(ann: Annotation): OverlaySurface | null;
  /** 加载文档时的子类钩子（如 PDF 清 elMap） */
  protected onLoadDoc(): void {}
  /** 子类移除区域选框及其 window 监听。 */
  protected onReleaseDocument(): void {}
  protected onAnnotationsChanged(): void {}
  protected onDocumentNotebookChanged(): void {}
  protected prepareAnnotation(_ann: Annotation, _geometryChanged = true): void {}
  protected mapAnnotationForDisplay(ann: Annotation): Annotation { return ann; }
  /** 颜色变更时同步子类状态（如手写笔颜色） */
  protected onColorChanged(): void {}
  /** Commit an unfinished stroke before changing the parameters it was drawn with. */
  protected flushPen(): void {}
  protected onPenToolChanged(): void {}
  /** 批注文字改完后的子类处理（PDF 重画 / Word 改 span title） */
  protected afterNoteEdited(_ann: Annotation): void {}

  // ===== 加载 / 销毁 =====
  async loadForDoc(docPath: string, preserveEditHistory = false): Promise<void> {
    if (docPath !== this.docPath) { this.continuousExcerpts.clear(); this.continuousExcerptListener?.(); }
    const revision = ++this.documentRevision;
    const annotations = await this.plugin.store.loadAnnotations(docPath);
    if (this.disposed || revision !== this.documentRevision) return;
    this.docPath = docPath;
    this.recall.clear();
    this.releasing = false;
    this.onLoadDoc();
    this.cache = annotations;
    if (!preserveEditHistory) this.clearEditHistory(); this.syncPenButtons();
    this.syncDocumentNotebooks(false);
    this.syncInkLayers(false);
    this.syncHandwritingSyncPreference();
    this.watchAnnotations();
  }
  private watchAnnotations(): void {
    this.unsubscribeAnnotations?.(); this.unsubscribeAnnotations = null;
    const path = this.docPath;
    if (path && !this.releasing) this.unsubscribeAnnotations = this.plugin.store.subscribeAnnotations(path, () => {
      if (!this.saving && !this.releasing && !this.disposed && this.docPath === path) this.onAnnotationsChanged();
    });
  }

  /** 切换前先结束输入并落盘，旧异步 OCR 不可再写入新文档。 */
  async releaseDocument(preserveEditHistory = false): Promise<void> {
    this.closeSelectionSpeech?.(); this.closeSelectionSpeech = null;
    this.closeOverlayEditor?.();
    this.removeRecallHint();
    const revision = ++this.documentRevision;
    this.releasing = true;
    this.unsubscribeAnnotations?.();
    this.unsubscribeAnnotations = null;
    if (this.selTimer !== null) window.clearTimeout(this.selTimer);
    this.selTimer = null;
    this.currentTarget = null;
    this.currentText = "";
    const selection=window.getSelection();if(selection?.rangeCount&&this.getScrollContainer().contains(selection.getRangeAt(0).commonAncestorContainer))selection.removeAllRanges();
    this.recall.clear();
    this.removePop();
    this.inkLayers?.close();
    this.documentNotebooks?.close();
    this.setBlockSelectionMode(false);this.regionSession++;this.cancelOverlayPlacement(); this.closeOverlayEditor?.(); this.disposeOverlayElements();
    if (this.penMode) {
      this.penMode = false;
      this.teardownPen();
    }
    this.penBtn?.classList.remove("is-active");
    this.penEditButtons.forEach((button) => button.classList.remove("is-active"));
    this.lassoMode = false;
    this.getScrollContainer().classList.remove("ms-region-selecting");this.getScrollContainer().style.touchAction="";
    this.lassoBtn?.classList.remove("is-active");
    this.onReleaseDocument();
    this.voicePlacing = false;
    this.recordingNotice?.hide(); this.recordingNotice = null;
    this.pendingMedia=null;this.closeMediaPlayer?.();this.closeMediaPlayer=null;
    this.micBtn?.classList.remove("is-recording");
    this.getScrollContainer().removeEventListener("click", this.onVoicePlaceClick, true);
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder?.isRecording) await recorder.stop().catch(() => {});
    await this.voiceCommitTask;
    await this.plugin.store.flush();
    if (revision === this.documentRevision) {
      this.docPath = null;
      this.cache = [];
      if (!preserveEditHistory) {
        this.clearEditHistory();
        this.inkLayerFingerprint = ""; this.inkLayers?.refresh();
        this.notebookFingerprint = ""; this.activeNotebookId = "default"; this.documentNotebooks?.refresh();
        this.vanishPen = false;
      }
      this.syncPenButtons();
    }
  }

  /** 视图关闭时清理：移除全局监听，退出语音/手写模式，移除浮动工具条（防内存泄漏，见 OPTIMIZATION_REVIEW A） */
  async destroy(): Promise<void> {
    this.closeSelectionSpeech?.(); this.closeSelectionSpeech = null;
    this.closeOverlayEditor?.();
    this.removeRecallHint();
    this.disposed = true;
    this.unsubscribeDocumentRename?.(); this.unsubscribeDocumentRename = null;
    this.handwritingSyncListeners.clear();
    this.unsubscribeStore?.(); this.unsubscribeStore = null;
    this.getScrollContainer().removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("mousedown", this.onDocMouseDown);
    document.removeEventListener("selectionchange", this.onSelectionChange);
    this.getScrollContainer().removeEventListener("click", this.onOverlayPlace, true);
    document.removeEventListener("keydown", this.onOverlayPlacementKey);
    if (this.selTimer !== null) {
      window.clearTimeout(this.selTimer);
      this.selTimer = null;
    }
    await this.releaseDocument();
    this.handwritingModeListeners.clear();
    this.editHistoryListeners.clear();
  }

  // ===== 工具栏 =====
  buildToolbar(container: HTMLElement): void {
    clear(container);
    for (const c of this.plugin.store.getEffectiveSceneSettings().colors) {
      const sw = el("button", {
        class: "ms-swatch" + (c === this.color ? " is-active" : ""),
        title: "标注颜色",
        "aria-label": `标注颜色 ${c}`,
      }) as HTMLButtonElement;
      sw.style.background = c;
      sw.addEventListener("click", () => {
        this.color = sw.dataset.color ?? c;
        this.onColorChanged();
        this.syncSwatches(container);
      });
      sw.dataset.color=c;
      sw.addEventListener("dblclick",()=>{
        if(this.plugin.store.settings.excerptLockColors){new Notice("摘录颜色快捷栏已锁定");return;}
        const input=el("input",{type:"color",value:sw.dataset.color??c,"aria-label":"修改摘录颜色快捷键"});
        const {modal,close}=createModal("Set Color");const ok=el("button",{text:"OK"});
        ok.addEventListener("click",()=>{if(this.plugin.store.settings.excerptLockColors){close();return;}
          const old=sw.dataset.color??c,colors=[...this.plugin.store.getEffectiveSceneSettings().colors],index=colors.indexOf(old);if(index>=0)colors[index]=input.value;
          const selection=this.plugin.store.activeStudySetId?this.plugin.store.getStudyScene(this.plugin.store.activeStudySetId):undefined;
          if((!selection||selection.interfaceMode!=="scenes"||["standard","read-write-recall"].includes(selection.templateId))&&this.plugin.store.settings.defaultColor===old)this.plugin.store.settings.defaultColor=input.value;
          this.plugin.store.setEffectiveSceneSettings({colors});sw.dataset.color=input.value;sw.style.background=input.value;sw.setAttribute("aria-label","标注颜色 "+input.value);close();
        });modal.append(input,ok);
      });
      container.append(sw);
    }
    container.append(el("span", { class: "ms-tb-sep" }));
    this.documentNotebooks?.close();
    this.documentNotebooks = new DocumentNotebookControls({ state: () => this.getDocumentNotebooks(), select: (id) => this.selectDocumentNotebook(id),
      create: (name) => this.createDocumentNotebook(name), overlay: (id) => this.setDocumentNotebookOverlay(id), rename: (id, name) => this.renameDocumentNotebook(id, name), remove: (id) => this.deleteDocumentNotebook(id) });
    container.append(this.documentNotebooks.element);

    if (hasMic()) {
      const mic = el("button", { class: "ms-tb-btn ms-tb-mic", title: "语音批注", "aria-label": "语音批注" }) as HTMLButtonElement;
      mic.textContent = "🎙";
      mic.addEventListener("click", () => this.toggleVoice());
      this.micBtn = mic;
      container.append(mic);
    }
    {
      const pen = el("button", { class: "ms-tb-btn ms-tb-pen", title: "手写批注（鼠标 / 触摸笔）" }) as HTMLButtonElement;
      pen.textContent = "✎";
      pen.setAttribute("aria-label", "手写画笔");
      pen.addEventListener("click", () => this.selectPenTool("draw"));
      pen.addEventListener("dblclick", () => { if (!this.penMode) this.selectPenTool("draw"); this.openHandwritingSettings(pen); });
      this.penBtn = pen;
      this.penEditButtons.set("draw", pen);
      container.append(pen);
    }
    for (const [tool, glyph, label] of [["highlight", "▰", "手写荧光笔"], ["erase", "⌫", "手写橡皮：删除整笔"], ["select", "⌁", "手写套索：移动或删除笔画"]] as const) {
      const button = el("button", { class: "ms-tb-btn", title: label, "aria-label": label, text: glyph }) as HTMLButtonElement;
      button.addEventListener("click", () => this.selectPenTool(tool)); this.penEditButtons.set(tool, button); container.append(button);
    }
    this.penUndoButton = el("button", { class: "ms-tb-btn", title: "撤销手写修改", "aria-label": "撤销手写修改", text: "↶" });
    this.penRedoButton = el("button", { class: "ms-tb-btn", title: "重做手写修改", "aria-label": "重做手写修改", text: "↷" });
    this.penUndoButton.addEventListener("click", () => this.undoPenChange()); this.penRedoButton.addEventListener("click", () => this.redoPenChange());
    container.append(this.penUndoButton, this.penRedoButton); this.syncPenButtons();
    this.inkLayers?.close();
    this.inkLayers = new InkLayerControls({ state: () => this.getInkLayers(), select: (id) => this.selectInkLayer(id), overlay: (id) => this.setInkOverlay(id),
      create: (name) => this.createInkLayer(name), rename: (id, name) => this.renameInkLayer(id, name), merge: (source, target) => this.mergeInkLayers(source, target), remove: (id) => this.deleteInkLayer(id),
      presets: () => this.getHandwritingPresets(), activePreset: () => this.getActiveHandwritingPreset(), selectPreset: (id) => this.setActiveHandwritingPreset(id),
      activatePreset: id => { this.setActiveHandwritingPreset(id); this.setHandwritingMode(this.getHandwritingPreset().type === "highlighter" ? "highlight" : "pen"); },
      updatePreset: (id, patch) => this.updateHandwritingPreset(id, patch), movePreset: (id, offset) => this.moveHandwritingPreset(id, offset), deletePreset: (id) => this.deleteHandwritingPreset(id),
      copyPreset: id => this.copyHandwritingPreset(id),
      syncPreference: () => this.getHandwritingSyncPreference(), syncAvailable: () => this.handwritingSyncAvailable, setSyncPreference: enabled => this.setHandwritingSyncPreference(enabled), vanishPen: () => this.vanishPen, setVanishPen: enabled => this.setVanishPen(enabled) });
    container.append(this.inkLayers.element);
    const textOverlay = el("button", { class: "ms-tb-btn", text: "T", title: "文字批注", "aria-label": "文字批注" });
    textOverlay.addEventListener("click", () => this.beginTextAnnotation());
    const imageOverlay = el("button", { class: "ms-tb-btn", text: "▧", title: "插入图片批注", "aria-label": "插入图片批注" });
    imageOverlay.addEventListener("click", () => this.requestOverlayImage());
    this.overlayImageInput = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/avif", "aria-label": "选择图片批注文件" }); this.overlayImageInput.hidden = true;
    this.overlayImageInput.addEventListener("change", () => { const file = this.overlayImageInput?.files?.[0], replacement = this.overlayImageReplacement; if (this.overlayImageInput) this.overlayImageInput.value = ""; this.overlayImageReplacement = null; if (file) void this.insertImageAnnotation(file, replacement); });
    this.overlayUndoButton = el("button", { class: "ms-tb-btn", text: "↶", title: "撤销文字或图片批注", "aria-label": "撤销文字或图片批注" });
    this.overlayRedoButton = el("button", { class: "ms-tb-btn", text: "↷", title: "重做文字或图片批注", "aria-label": "重做文字或图片批注" });
    this.overlayUndoButton.addEventListener("click", () => this.undoOverlayChange()); this.overlayRedoButton.addEventListener("click", () => this.redoOverlayChange());
    const media=el("button",{class:"ms-tb-btn",text:"♫","aria-label":"添加音视频",title:"添加音视频"}),mediaInput=el("input",{type:"file",accept:"audio/*,video/*","aria-label":"选择音视频文件"});mediaInput.hidden=true;
    media.addEventListener("click",()=>mediaInput.click());mediaInput.addEventListener("change",()=>{const file=mediaInput.files?.[0];mediaInput.value="";if(file)this.insertMediaAnnotation(file);});
    container.append(media,mediaInput);
    container.append(textOverlay, imageOverlay, this.overlayImageInput, this.overlayUndoButton, this.overlayRedoButton); this.syncOverlayButtons();
    const lasso = el("button", { class: "ms-tb-btn ms-tb-lasso", title: "区域摘录：拖拽截图", "aria-label": "区域摘录：拖拽截图" }) as HTMLButtonElement;
    lasso.textContent = "▣";
    lasso.addEventListener("click", () => this.toggleLasso());
    this.lassoBtn = lasso;
    container.append(lasso);
    const assistive=el("button",{class:"ms-tb-btn",text:"辅助识别摘录","aria-label":"辅助识别摘录",title:"辅助识别摘录（原有一键摘录）"});assistive.addEventListener("click",()=>this.toggleLegacyAssistive());container.append(assistive);
    container.append(el("span", { class: "ms-tb-hint", text: "选中文本后浮现工具" }));
  }

  private syncSwatches(container: HTMLElement): void {
    const sws = container.querySelectorAll(".ms-swatch");
    sws.forEach((s, i) => {
      s.classList.toggle("is-active", this.plugin.store.getEffectiveSceneSettings().colors[i] === this.color);
    });
  }

  // ===== 选区捕获 =====
  private onMouseUp = (e: MouseEvent): void => {
    this.lastPoint = { x: e.clientX, y: e.clientY };
    if (this.voicePlacing || this.penMode) return;
  };

  private onDocMouseDown = (e: MouseEvent): void => {
    if (this.popEl && !this.popEl.contains(e.target as Node)) this.removePop();
  };

  // 选区变化（鼠标与平板触摸通用）触发选区捕获，200ms 防抖（体验增强 M）
  private onSelectionChange = (): void => {
    if (this.disposed || this.releasing || this.voicePlacing || this.penMode || this.lassoMode || this.assistiveMode === 'block') return;
    if (this.selTimer !== null) window.clearTimeout(this.selTimer);
    const revision = this.documentRevision, path = this.docPath, session = this.selectionSession, view = this.getScrollContainer();
    this.selTimer = window.setTimeout(() => {
      this.selTimer = null;
      if (revision !== this.documentRevision || path !== this.docPath || session !== this.selectionSession || !view.isConnected || view !== this.getScrollContainer()) return;
      this.handleSelection();
    }, 200);
  };

  private handleSelection(fromBlock = false): void {
    if (this.disposed || this.releasing || !this.docPath || this.voicePlacing || this.penMode || this.lassoMode || this.assistiveMode === "block" || !this.getScrollContainer().isConnected) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      // 选区收起时不在此移除 pop：避免点击工具条按钮时因 selectionchange 误关，
      // pop 的关闭统一由 onDocMouseDown（点击 pop 之外）处理。
      return;
    }
    const range = sel.getRangeAt(0);
    if (!range.startContainer.isConnected || !range.endContainer.isConnected || !this.getScrollContainer().contains(range.commonAncestorContainer)) return;
    const rb = range.getBoundingClientRect();
    if (rb.width || rb.height) this.lastPoint = { x: rb.left + rb.width / 2, y: rb.bottom + 8 };
    const target = this.resolveSelection(range);
    if (!target) {
      this.removePop();
      return;
    }
    const selectedText = sel.toString(), targetKey = JSON.stringify(target), last = this.lastAutomaticSelection;
    if (this.automaticTextExcerpt && !fromBlock) {
      const unchanged = last && last.revision === this.documentRevision && last.text === selectedText && last.target === targetKey && last.range.startContainer === range.startContainer && last.range.startOffset === range.startOffset && last.range.endContainer === range.endContainer && last.range.endOffset === range.endOffset && this.cache.some(ann => ann.id === last.annotationId);
      if (!unchanged) {
        const existing = this.cache.find(ann => ann.type === "highlight" && ann.text === selectedText && (ann.documentNotebookId ?? "default") === this.getDocumentNotebookId() && (target.kind === "pdf" ? ann.docKind === "pdf" && ann.page === target.pageNum && JSON.stringify(ann.pdfGeometry ?? [{page:ann.page,rects:ann.rects}]) === JSON.stringify(target.pdfGeometry ?? [{page:target.pageNum,rects:target.rects}]) : ann.docKind === "html" && JSON.stringify(ann.range) === JSON.stringify(target.range)));
        if (existing) {
          this.lastAutomaticSelection = { range:range.cloneRange(), target:targetKey, text:selectedText, annotationId:existing.id, revision:this.documentRevision };
        } else {
          const before = new Set(this.cache.map(ann => ann.id));
          this.commitAnnotation(target, "highlight", this.color, selectedText);
          const created = this.cache.find(ann => !before.has(ann.id));
          if (created) this.lastAutomaticSelection = { range:range.cloneRange(), target:targetKey, text:selectedText, annotationId:created.id, revision:this.documentRevision };
        }
      }
    }
    this.currentTarget = target;
    this.currentText = selectedText;
    this.showSelectionPop(range.cloneRange());
  }

  protected selectionActions(target: SelTarget, text: string): { id?: string; label: string; run: () => void | Promise<void> }[] { return []; }
  protected correctSelectionText(_target:SelTarget,text:string):Promise<string> {return Promise.resolve(text);}

  private showSelectionPop(range: Range): void {
    this.removePop();
    document.dispatchEvent(new Event("ms-reader-menu-opening"));
    const pop = el("div", { class: "ms-ann-pop" });
    this.watchCompetingMenus();
    const revision = this.documentRevision, path = this.docPath, session = this.selectionSession, view = this.getScrollContainer();
    const selectionIsCurrent = () => range.startContainer.isConnected && range.endContainer.isConnected && view.contains(range.commonAncestorContainer) && !this.disposed && !this.releasing && !!path && path === this.docPath && revision === this.documentRevision && session === this.selectionSession && view.isConnected && view === this.getScrollContainer() && !this.voicePlacing && !this.penMode && !this.lassoMode && this.assistiveMode !== "block";
    const target = this.currentTarget ? structuredClone(this.currentTarget) : null, text = this.currentText;
    const close = () => { window.getSelection()?.removeAllRanges(); this.removePop(); };
    const actions: ContextAction[] = [{ id: "copy", label: "复制", icon: "copy", group: "clipboard",
      run: () => navigator.clipboard.writeText(text) }];
    for (const [type, label] of [["highlight", "高亮"], ["underline", "下划线"], ["strike", "删除线"], ["note", "批注"]] as const) {
      actions.push({ id: type, label, group: "excerpt", run: async () => {
        if (!target) return;
        if (selectionIsCurrent()) this.commitAnnotation(target, type, this.color, text);
      }});
    }
    if (target) actions.push(...this.selectionActions(target, text).map((action, index) => ({
      ...action, id: action.id ?? `document-${index}`, group: "document",
    })));
    for (const color of this.plugin.store.getEffectiveSceneSettings().colors.slice(0, 4)) {
      actions.push({ id: "color:" + color, label: "摘录颜色 " + color, color, group: "color", run: async () => {
        if (!target) return;
        if (selectionIsCurrent()) this.commitAnnotation(target, "highlight", color, text);
      }});
    }
    if(target&&this.plugin.store.settings.ocrSelectionCorrection)actions.push({id:"ocr-highlight",label:"识别选区并高亮",group:"excerpt",run:async()=>{const corrected=await this.correctSelectionText(target,text);if(selectionIsCurrent())this.commitAnnotation(target,"highlight",this.color,corrected);}});
    actions.push({ id: "ask", label: "向 AI 提问", icon: "message-circle", group: "research", run: async () => {
      const workspace = this.plugin.studyWorkspace ?? await this.plugin.openStudyWorkspace();
      if (selectionIsCurrent()) workspace.showAiContext({ text, label: "文档选区", docPath: path ?? undefined });
    }}, { id: "research", label: "研究", icon: "search", group: "research", run: async () => {
      const workspace = this.plugin.studyWorkspace ?? await this.plugin.openStudyWorkspace();
      if (selectionIsCurrent()) workspace.showResearchText(text);
    }});
    actions.push({ id: "speech", label: "朗读", icon: "volume-2", group: "more", run: () => {
      this.closeSelectionSpeech?.();
      this.closeSelectionSpeech = openExtendSpeech(this.getScrollContainer(), text, "选区朗读");
    }});
    const defaultPrimary = ["copy", "fold", "extend-ink", "extend-text", "ask", ...actions.filter(action => action.group === "color").map(action => action.id), "research"];
    renderContextActionMenu(pop, actions, {
      primaryIds: this.plugin.store.getEffectiveSceneSettings().textSelectionMenuActions ?? defaultPrimary,
      savePrimaryIds: ids => { this.plugin.store.setEffectiveSceneSettings({textSelectionMenuActions:ids}); },
      current: selectionIsCurrent, close, error: error => new Notice("操作失败：" + String(error)), layout: () => reposition(),
    });
    // Keep the captured target intact and prevent menu input from reaching the reader.
    pop.addEventListener("pointerdown", event => event.stopPropagation());
    pop.addEventListener("mousedown", event => { event.preventDefault(); event.stopPropagation(); });
    pop.addEventListener("mouseup", event => event.stopPropagation());
    pop.addEventListener("click", event => event.stopPropagation());
    document.body.append(pop);
    this.popEl = pop;
    const boundary = view.closest<HTMLElement>(".ms-study-workspace") ?? view.closest<HTMLElement>(".ms-reader-root") ?? view;
    const reposition = () => {
      if (!selectionIsCurrent() || !boundary.isConnected) { this.removePop(); return; }
      const bounds = boundary.getBoundingClientRect();
      const left = Math.max(0, bounds.left), top = Math.max(0, bounds.top);
      const right = Math.min(window.innerWidth, bounds.right), bottom = Math.min(window.innerHeight, bounds.bottom);
      if (right <= left || bottom <= top) { this.removePop(); return; }
      pop.style.maxWidth = `${right - left}px`;
      pop.style.maxHeight = `${bottom - top}px`;
      pop.style.boxSizing = "border-box";
      pop.style.flexWrap = "wrap";
      pop.style.overflow = "auto";
      const anchor = range.getBoundingClientRect(), size = pop.getBoundingClientRect();
      const x = Math.max(left, Math.min(anchor.left + anchor.width / 2 - size.width / 2, right - size.width));
      const below = anchor.bottom + 8, above = anchor.top - size.height - 8;
      const y = Math.max(top, Math.min(below + size.height <= bottom ? below : above, bottom - size.height));
      pop.style.left = `${x}px`;
      pop.style.top = `${y}px`;
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); this.removePop();
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("keydown", onEscape, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
    observer?.observe(boundary);
    if (boundary !== view) observer?.observe(view);
    this.closeSelectionPop = () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("keydown", onEscape, true);
      observer?.disconnect();
    };
    reposition();
  }

  /** 构造标注 + 推入缓存 + 持久化 + 增量渲染 + 提示（子类 commitAnnotation 复用） */
  protected pushAnnotation(ann: Annotation): void {
    ann.documentNotebookId ??= this.activeNotebookId;
    this.prepareAnnotation(ann);
    this.cache.push(ann);
    if (ann.type === "pen" && ann.strokes?.length) this.recordPenChange([{ id: ann.id, before: [], after: cloneStrokes(ann.strokes) }], ann);
    this.persist();
    if (this.isAnnotationVisible(ann)) this.renderOne(ann);
    this.syncOcclusionElements();
    if (ann.type !== "pen") new Notice("已添加" + this.typeLabel(ann.type));
    // 高亮/下划线后自动成卡（设置开启且尚未关联卡片时）
    if (this.continuousExcerpt && ann.docKind === "pdf" && (ann.type === "highlight" || ann.type === "underline" || ann.type === "region")) {
      const session = this.continuousExcerpt;
      let card = session.cardId ? this.plugin.store.getCard(session.cardId) : undefined;
      if (!card) {
        this.makeCard(ann, "excerpt", true);
        card = ann.cardId ? this.plugin.store.getCard(ann.cardId) : undefined;
        session.cardId = card?.id;
      } else {
        const sources = card.sources?.length ? card.sources : [{ docPath:card.docPath, anchorAnnId:card.anchorAnnId, page:card.page, text:card.front, image:card.image }];
        const source = { docPath:ann.docPath, documentNotebookId:ann.documentNotebookId, anchorAnnId:ann.id, page:ann.page, text:ann.text, image:ann.image };
        this.plugin.store.updateCard(card.id, { sources:[...sources, source], front:[card.front, ann.text || (ann.type === "region" ? "[区域摘录]" : "")].filter(Boolean).join("\n\n"), images:[...new Set([...(card.images ?? (card.image ? [card.image] : [])), ...(ann.image ? [ann.image] : [])])] });
        ann.cardId = card.id; this.persist(); this.plugin.refreshSidebar();
      }
      if (card) { session.count++; this.continuousExcerptListener?.(); }
      return;
    }
    if (
      (ann.type === "highlight" || ann.type === "underline") &&
      !ann.cardId &&
      this.plugin.store.settings.autoCardOnHighlight
    ) {
      this.makeCard(ann, "excerpt", true);
      new Notice("已自动生成摘录卡（可在卡片管理中查看）");
    }
  }

  protected showExcerptMenu(ann: Annotation):void {
    if(this.plugin.store.getEffectiveSceneSettings().excerptPopup!==true)return;const revision=this.documentRevision;
    queueMicrotask(()=>{if(revision!==this.documentRevision||this.disposed||this.releasing||!this.cache.includes(ann))return;
      this.onAnnClick(ann,new MouseEvent("click",{clientX:this.lastPoint.x,clientY:this.lastPoint.y}));
    });
  }
  // ===== Independent text/image overlays =====
  beginTextAnnotation(): void {
    if (!this.docPath || this.disposed || this.releasing) return;
    this.setBlockSelectionMode(false);this.setRegionMode(false);this.setHandwritingMode("off");
    this.overlayPlacement = { kind: "text" }; this.getScrollContainer().classList.add("ms-overlay-placement");
    window.getSelection()?.removeAllRanges(); new Notice("点击文档放置文字批注；Esc 取消");
  }
  private requestOverlayImage(replacement: string | null = null): void {
    if (!this.docPath || this.disposed || this.releasing) return;
    this.overlayImageReplacement = replacement; this.overlayImageInput?.click();
  }
  async insertImageAnnotation(file: File, replacement: string | null = null): Promise<void> {
    if (!this.docPath || this.disposed || this.releasing) return;
    const revision = this.documentRevision, layer = this.getInkLayers().active;
    try {
      const asset = await loadOverlayImage(file);
      if (revision !== this.documentRevision || layer !== this.getInkLayers().active || this.disposed || this.releasing) return;
      if (replacement) { this.commitOverlayUpdate(replacement, { image: asset.image }); return; }
      this.setBlockSelectionMode(false);this.setRegionMode(false);this.setHandwritingMode("off");
      this.overlayPlacement = { kind: "image", ...asset }; this.getScrollContainer().classList.add("ms-overlay-placement");
      new Notice("图片已读取，点击文档放置；Esc 取消");
    } catch (error) { if (revision === this.documentRevision && !this.disposed) new Notice(String(error)); }
  }
  private cancelOverlayPlacement(): void { this.overlayPlacement = null; this.getScrollContainer().classList.remove("ms-overlay-placement"); }
  private onOverlayPlacementKey = (event: KeyboardEvent): void => {
    if(event.key==="Escape"&&this.pendingMedia){this.pendingMedia=null;this.voicePlacing=false;this.getScrollContainer().removeEventListener("click",this.onVoicePlaceClick,true);return;} if (this.overlayPlacement && event.key === "Escape") { event.preventDefault(); this.cancelOverlayPlacement(); } };
  private onOverlayPlace = (event: MouseEvent): void => {
    const pending = this.overlayPlacement;
    if (!pending || !this.docPath || this.disposed || this.releasing) return;
    if(pending.kind==="text"&&this.placeTextInExtend(event)){event.preventDefault();event.stopImmediatePropagation();this.cancelOverlayPlacement();this.removePop();return;}
    const width = 220, height = pending.kind === "text" ? 90 : Math.min(280, width * (pending.height ?? 1) / (pending.width ?? 1));
    const surface = this.resolveOverlaySurface(event, width, height); if (!surface) return;
    const projection = surface.geometry(surface.box); if (!projection) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.cancelOverlayPlacement(); this.removePop();
    const { box, ...geometry } = projection;
    const ann: Annotation = { id: uid("ann"), docPath: this.docPath, ...geometry, type: "note", text: pending.kind === "text" ? "输入文字" : "", color: "#111111",
      image: pending.image, overlay: { kind: pending.kind, ...(box ? {box} : {}), fontSize: 16, background: "transparent" },
      inkLayerId: this.getInkLayers().active, documentNotebookId: this.activeNotebookId, createdAt: todayStr() };
    this.pushAnnotation(ann);
    const before = this.cloneAnnotation(ann); before.overlay!.deleted = true; this.recordOverlayChange(before, ann);
    if (pending.kind === "text") this.editFreeOverlay(ann.id);
  };
  protected renderFreeOverlay(ann: Annotation, surface: OverlaySurface): HTMLElement {
    const readonly = this.isNotebookReference(ann) || this.isInkReference(ann);
    const rendered = createFreeOverlay(ann, surface, { readonly,
      rotate:angle=>{const current=this.editableOverlay(ann.id);if(current)this.commitOverlayUpdate(ann.id,{overlay:{...current.overlay!,rotation:angle}});},
      commit: box => {
        const geometry = surface.geometry(box); if (!geometry) return;
        const { box: normalized, ...patch } = geometry;
        const current = this.cache.find(item => item.id === ann.id); if (!current?.overlay) return;
        this.commitOverlayUpdate(ann.id, { ...patch, overlay: { ...current.overlay, ...(normalized ? {box: normalized} : {}) } });
      }, crop: () => this.cropFreeImage(ann.id), edit: () => this.editFreeOverlay(ann.id), remove: () => this.deleteFreeOverlay(ann.id), undo: () => this.undoOverlayChange(), redo: () => this.redoOverlayChange(), card: () => { const current = this.editableOverlay(ann.id); if (current) this.makeCard(current,"excerpt"); } });
    rendered.element.classList.toggle("ms-ink-reference", readonly);
    this.overlayElements.set(rendered.element, rendered.dispose); return rendered.element;
  }
  protected detachAnnotationElement(element: HTMLElement): void {
    const dispose = this.overlayElements.get(element); if (dispose) { this.overlayElements.delete(element); dispose(); } else element.remove();
  }
  protected disposeOverlayElements(): void { for (const dispose of this.overlayElements.values()) dispose(); this.overlayElements.clear(); }
  private editableOverlay(id: string): Annotation | null {
    const ann = this.cache.find(item => item.id === id);
    return ann?.overlay && !ann.overlay.deleted && !this.isNotebookReference(ann) && !this.isInkReference(ann) && !this.disposed && !this.releasing ? ann : null;
  }
  private cloneAnnotation(ann: Annotation): Annotation { return JSON.parse(JSON.stringify(ann)); }
  private overlayFingerprint(ann: Annotation): string { return JSON.stringify([ann.text,ann.image,ann.color,ann.page,ann.rects,ann.pdfGeometry,ann.pdfCoordinateSpace,ann.overlay,ann.inkLayerId,ann.documentNotebookId,ann.pdfReferencePages]); }
  private recordOverlayChange(before: Annotation, after: Annotation): void {
    this.recordEditChange({ kind: "overlay", sequence: ++this.editSequence, label: after.overlay?.kind === "image" ? "图片批注" : "自由文字批注", before: this.cloneAnnotation(before), after: this.cloneAnnotation(after) });
  }
  private commitOverlayUpdate(id: string, patch: Partial<Annotation>): void {
    const ann = this.editableOverlay(id); if (!ann) return;
    const before = this.cloneAnnotation(ann); Object.assign(ann, patch); this.prepareAnnotation(ann, "page" in patch || "pdfGeometry" in patch);
    if (this.overlayFingerprint(before) === this.overlayFingerprint(ann)) return;
    this.recordOverlayChange(before,ann); this.persist(); this.onAnnotationsChanged();
  }
  deleteFreeOverlay(id: string): void { const ann = this.editableOverlay(id); if (ann) this.commitOverlayUpdate(id, { overlay: { ...ann.overlay!, deleted: true } }); }
  private cropFreeImage(id:string):void {
    const ann=this.editableOverlay(id);if(!ann?.image||ann.overlay?.kind!=="image")return;
    const surface=this.getOverlaySurface(ann);if(!surface)return;
    this.closeOverlayEditor?.();const baseline=this.cloneAnnotation(ann),revision=this.documentRevision;
    const parent=surface.parent,width=parent.clientWidth,height=parent.clientHeight,box=surface.box;
    this.closeOverlayEditor=openExtendImageCrop({id,src:ann.image,x:box.left/width,y:box.top/height,w:box.width/width,h:box.height/height},parent,async patch=>{
      const current=this.editableOverlay(id);
      if(revision!==this.documentRevision||!current||this.overlayFingerprint(current)!==this.overlayFingerprint(baseline))throw new Error("图片已在其他视图修改或文档已切换");
      const geometry=surface.geometry({...box,width:(patch.w??box.width/width)*width,height:(patch.h??box.height/height)*height});if(!geometry)throw new Error("图片目标位置无效");
      const {box:normalized,...coordinates}=geometry;
      this.commitOverlayUpdate(id,{...coordinates,image:patch.src??ann.image,overlay:{...current.overlay!,...(normalized?{box:normalized}:{})}});
    });
  }
  private editFreeOverlay(id: string): void {
    const ann = this.editableOverlay(id); if (!ann) return;
    if (ann.overlay!.kind === "image") { this.requestOverlayImage(id); return; }
    this.closeOverlayEditor?.(); const revision = this.documentRevision;
    const baseline = this.cloneAnnotation(ann), originalRuns = annotationTextRuns(baseline);
    let fontScale = this.getOverlaySurface(ann)?.fontScale ?? 1;
    this.closeOverlayEditor = openInlineTextEditor({ scroll: this.getScrollContainer(),
      anchor: () => [...this.overlayElements.keys()].find(element => element.dataset.annId === id && element.isConnected) ?? null,
      fontScale: () => fontScale = this.getOverlaySurface(ann)?.fontScale ?? fontScale,
      draft: { text: ann.text, runs: annotationTextRuns(ann), fontSize: ann.overlay!.fontSize ?? 16, color: ann.color, background: ann.overlay!.background ?? "transparent" },
      save: draft => {
        this.closeOverlayEditor = null;
        if (revision !== this.documentRevision) return;
        if (draft.text === baseline.text && JSON.stringify(draft.runs) === JSON.stringify(originalRuns) && draft.background === (baseline.overlay!.background ?? "transparent")) return;
        const current = this.cache.find(item => item.id === id);
        const patch = { text: draft.text, color: draft.color, overlay: { ...baseline.overlay!, fontSize: draft.fontSize, fontFamily: draft.runs?.[0]?.style.fontFamily, textRuns: draft.runs, background: draft.background } };
        if (!current || current.overlay?.deleted || this.overlayFingerprint(current) !== this.overlayFingerprint(baseline)) {
          // A stale draft is retained as an independent note, never written over a newer edit.
          const copy = { ...baseline, ...patch, id: uid("ann"), docPath: this.docPath!, inkLayerId: this.getInkLayers().active, documentNotebookId: this.activeNotebookId };
          delete copy.cardId; delete copy.overlay.deleted;
          this.pushAnnotation(copy); const before = this.cloneAnnotation(copy); before.overlay!.deleted = true; this.recordOverlayChange(before, copy);
          new Notice("原批注已在其他视图修改，当前文字草稿已另存为一条独立批注"); return;
        }
        // A scope change may already have changed the active-layer metadata. This draft
        // still belongs to the original annotation and can finish before the scope redraw.
        const before = this.cloneAnnotation(current); Object.assign(current, patch); this.prepareAnnotation(current, false);
        this.recordOverlayChange(before, current); this.persist(); this.onAnnotationsChanged();
      } });
  }

  undoOverlayChange(): void { this.applyEditHistory(false,"overlay"); }
  redoOverlayChange(): void { this.applyEditHistory(true,"overlay"); }
  private applyOverlayChange(change: Extract<ReaderEditChange,{kind:"overlay"}>, redo: boolean): boolean {
    const current = this.cache.find(ann => ann.id === change.after.id), expected = redo ? change.before : change.after, desired = redo ? change.after : change.before;
    if (!current || this.overlayFingerprint(current) !== this.overlayFingerprint(expected)) { this.clearEditHistory(); new Notice("批注已在其他视图修改，已清除此视图的阅读编辑撤销记录"); return false; }
    const saved = this.cloneAnnotation(desired);
    for (const key of ["text","image","color","page","rects","pdfGeometry","pdfCoordinateSpace","overlay","inkLayerId","pdfReferencePages"] as const) {
      if (key in saved) (current as any)[key] = saved[key]; else delete (current as any)[key];
    }
    this.persist(); this.onAnnotationsChanged(); return true;
  }
  private syncOverlayButtons(): void { if (this.overlayUndoButton) this.overlayUndoButton.disabled = this.applyingEditHistory || !this.editUndo.some(change=>change.kind==="overlay"); if (this.overlayRedoButton) this.overlayRedoButton.disabled = this.applyingEditHistory || !this.editRedo.some(change=>change.kind==="overlay"); }

  getEditHistoryState(): ReaderEditHistoryState {
    return { canUndo: !this.applyingEditHistory && this.editUndo.length > 0, canRedo: !this.applyingEditHistory && this.editRedo.length > 0,
      undoLabel: this.editUndo[this.editUndo.length-1]?.label, redoLabel: this.editRedo[this.editRedo.length-1]?.label };
  }
  subscribeEditHistory(listener: (state: ReaderEditHistoryState) => void): () => void {
    if (this.disposed) return () => {};
    this.editHistoryListeners.add(listener); listener(this.getEditHistoryState());
    return () => this.editHistoryListeners.delete(listener);
  }
  undoLastEdit(): void | Promise<void> { return this.applyEditHistory(false); }
  redoLastEdit(): void | Promise<void> { return this.applyEditHistory(true); }
  recordDocumentEdit(label: string, apply: (redo: boolean) => Promise<void>): void {
    if (this.disposed || this.releasing || !this.docPath) return;
    this.recordEditChange({ kind: "document", sequence: ++this.editSequence, label, apply });
  }
  private recordEditChange(change: ReaderEditChange): void {
    this.editUndo.push(change);
    // Retain the existing forty-operation allowance for each independent tool family.
    if (this.editUndo.filter(entry=>entry.kind===change.kind).length > 40) this.editUndo.splice(this.editUndo.findIndex(entry=>entry.kind===change.kind),1);
    this.editRedo = []; this.publishEditHistory();
  }
  private clearEditHistory(): void { this.editUndo = []; this.editRedo = []; this.publishEditHistory(); }
  private publishEditHistory(): void {
    this.syncPenButtons(); this.syncOverlayButtons();
    const state = this.getEditHistoryState(); for (const listener of this.editHistoryListeners) listener(state);
  }
  private applyEditHistory(redo: boolean, kind?: ReaderEditChange["kind"]): void | Promise<void> {
    if (!this.docPath || this.disposed || this.releasing || this.applyingEditHistory) return;
    this.closeOverlayEditor?.();
    const source = redo ? this.editRedo : this.editUndo, target = redo ? this.editUndo : this.editRedo;
    let index = source.length - 1; while (index >= 0 && kind && source[index].kind !== kind) index--;
    const change = source[index]; if (!change) return;
    if (change.kind === "document") {
      const undo = this.editUndo, redoStack = this.editRedo;
      this.applyingEditHistory = true; this.publishEditHistory();
      return change.apply(redo).then(() => {
        // A document switch or conflicting edit may have invalidated this journal while awaiting I/O.
        if (this.disposed || this.editUndo !== undo || this.editRedo !== redoStack) return;
        source.splice(index,1); target.push(change);
      }).catch(error => { this.clearEditHistory(); new Notice(error instanceof Error ? error.message : String(error)); })
        .finally(() => { this.applyingEditHistory = false; this.publishEditHistory(); });
    }
    const applied = change.kind === "pen" ? this.applyPenChanges(change.changes,!redo) : this.applyOverlayChange(change,redo);
    if (!applied) return;
    source.splice(index,1); target.push(change);
    // A selective legacy redo is now the most recent edit in the shared journal.
    if (redo) change.sequence = ++this.editSequence;
    this.publishEditHistory();
  }

  // ===== 语音批注 =====
  private toggleVoice(): void {
    if (this.disposed || this.releasing || !this.docPath || this.voiceCommitTask) return;
    if (this.voicePlacing) {
      this.recordingNotice?.hide(); this.recordingNotice = null;
      this.pendingMedia=null;
      this.voicePlacing = false;
      this.micBtn?.classList.remove("is-recording");
      this.getScrollContainer().removeEventListener("click", this.onVoicePlaceClick, true);
      this.recorder?.stop().catch(() => {});
      this.recorder = null;
      new Notice("已取消录音");
      return;
    }
    if (this.recorder) return;
    const recorder = this.recorder = new VoiceRecorder();
    const revision = this.documentRevision;
    chooseVoiceInput().then(input => {
        if(input===null || this.disposed || this.releasing || revision!==this.documentRevision || this.recorder!==recorder)throw new Error("已取消录音");
        return recorder.start(input);
      })
      .then(() => {
        if (this.disposed || this.releasing || revision !== this.documentRevision || this.recorder !== recorder) {
          return recorder.stop().then(() => {}, () => {});
        }
        this.voicePlacing = true;
        this.micBtn?.classList.add("is-recording");
        this.recordingNotice = new Notice("录音中… 点击文档保存；再次选择录音可取消", 0);
        this.getScrollContainer().addEventListener("click", this.onVoicePlaceClick, true);
      })
      .catch((e: Error) => {
        if (this.recorder === recorder) this.recorder = null;
        if (!this.disposed && revision === this.documentRevision) new Notice("无法录音：" + e.message);
      });
  }

  insertMediaAnnotation(file:File):void {
    if(!this.docPath||this.disposed||this.releasing)return;
    try{mediaFileKind(file);}catch(error){new Notice(String(error));return;}
    this.setHandwritingMode("off");this.cancelOverlayPlacement();this.pendingMedia=file;this.voicePlacing=true;
    this.getScrollContainer().addEventListener("click",this.onVoicePlaceClick,true);new Notice("点击文档放置音视频；Esc 取消");
  }
  private async finishMedia(file:File,target:VoiceTarget):Promise<void> {
    const path=this.docPath,revision=this.documentRevision,notebook=this.activeNotebookId;if(!path)return;
    const mediaKind=mediaFileKind(file),audioPath=await saveMediaFile(this.plugin.app,file);
    if(path!==this.docPath||revision!==this.documentRevision)return;
    const ann:Annotation={id:uid("ann"),docPath:path,docKind:target.page?"pdf":"html",page:target.page??0,type:"voice",rects:[],text:file.name,color:this.color,pos:{x:target.x,y:target.y},audioPath,mediaKind,mediaName:file.name,documentNotebookId:notebook,createdAt:todayStr()};
    this.pushAnnotation(ann);this.recordMediaEdit(ann,true);
  }
  protected recordMediaEdit(ann:Annotation,created:boolean):void {
    const path=this.docPath,revision=this.documentRevision;
    this.recordDocumentEdit(created?"添加音视频":"删除音视频",async redo=>{
      if(path!==this.docPath||revision!==this.documentRevision)throw new Error("文档已切换，媒体撤销已取消");
      const current=this.cache.find(item=>item.id===ann.id);if(!current)throw new Error("媒体批注已在其他视图删除");
      current.mediaDeleted=created?!redo:redo;this.persist();this.onAnnotationsChanged();
    });
  }
  private onVoicePlaceClick = (e: MouseEvent): void => {
    if (!this.voicePlacing) return;
    const target = this.resolveVoiceTarget(e);
    if (!target) return;
    if(this.pendingMedia){
      e.preventDefault();e.stopImmediatePropagation();const file=this.pendingMedia;this.pendingMedia=null;this.voicePlacing=false;this.getScrollContainer().removeEventListener("click",this.onVoicePlaceClick,true);
      const task=this.finishMedia(file,target).catch(error=>{new Notice("媒体保存失败："+String(error));});this.voiceCommitTask=task;void task.finally(()=>{if(this.voiceCommitTask===task)this.voiceCommitTask=null;});return;
    }
    void this.finishVoice(target);
  };

  private async finishVoice(target: VoiceTarget): Promise<void> {
    this.recordingNotice?.hide(); this.recordingNotice = null;
    this.voicePlacing = false;
    this.micBtn?.classList.remove("is-recording");
    this.getScrollContainer().removeEventListener("click", this.onVoicePlaceClick, true);
    if (!this.docPath || !this.recorder) return;
    const recorder = this.recorder;
    this.recorder = null;
    const task = (async () => {
      try {
        const blob = await recorder.stop();
        await this.commitVoice(blob, target);
      } catch (e) {
        new Notice("录音保存失败：" + (e as Error).message);
      }
    })();
    this.voiceCommitTask = task;
    await task;
    if (this.voiceCommitTask === task) this.voiceCommitTask = null;
  }

  // ===== 手写批注 =====
  getHandwritingMode(): HandwritingMode {
    return !this.penMode ? "off" : this.penTool === "draw" ? "pen" : this.penTool === "erase" ? "eraser" : this.penTool === "select" ? "lasso" : "highlight";
  }
  getActiveHandwritingPreset(): HandwritingPresetId { return this.handwritingPreset; }
  refreshSceneSettings(): void {
    const settings=this.plugin.store.getEffectiveSceneSettings();
    if(!settings.colors.includes(this.color)){this.color=settings.defaultColor;this.onColorChanged();}
    const presets=this.getHandwritingPresets();if(!presets.some(preset=>preset.id===this.handwritingPreset)&&presets[0])this.setActiveHandwritingPreset(presets[0].id);
  }
  getHandwritingPresets(): HandwritingPresetSpec[] { return handwritingPresets(this.plugin.store.getEffectiveSceneSettings()); }
  getHandwritingPreset(): HandwritingPresetSpec {
    const presets = this.getHandwritingPresets();
    return presets.find(preset => preset.id === this.handwritingPreset) ?? presets[0] ?? DEFAULT_HANDWRITING_PRESETS[0];
  }
  setActiveHandwritingPreset(preset: HandwritingPresetId): void {
    const selected = this.getHandwritingPresets().find(item => item.id === preset);
    if (!selected) return;
    this.flushPen();
    this.handwritingPreset = preset;
    if (selected.type === "highlighter") this.highlightHandwritingPreset = preset;
    else this.normalHandwritingPreset = preset;
    if (this.penMode) this.setHandwritingMode(selected.type === "highlighter" ? "highlight" : "pen");
    this.inkLayers?.refresh();
    this.onPenToolChanged();
  }
  private updateHandwritingPreset(id: HandwritingPresetId, patch: Partial<HandwritingPresetSpec>): void {
    this.flushPen();
    const presets = this.getHandwritingPresets().map(preset => {
      if (preset.id !== id) return preset;
      const next = { ...preset, ...patch, id: preset.id };
      next.width = clampHandwritingWidth(next.type, next.width);
      next.documentWidth = clampHandwritingWidth(next.type, next.documentWidth ?? next.width);
      next.mindmapWidth = clampHandwritingWidth(next.type, next.mindmapWidth ?? next.width);
      next.cardWidth = clampHandwritingWidth(next.type, next.cardWidth ?? next.width);
      return next;
    });
    this.plugin.store.setEffectiveSceneSettings({handwritingPresets:presets});
    this.setActiveHandwritingPreset(this.handwritingPreset);
    this.plugin.store.save();
    this.onPenToolChanged();
  }
  private moveHandwritingPreset(id: HandwritingPresetId, offset: number): void {
    const presets = this.getHandwritingPresets().map(preset => ({ ...preset })), index = presets.findIndex(preset => preset.id === id), target = index + offset;
    if (index < 0 || target < 0 || target >= presets.length) return;
    const [moving] = presets.splice(index, 1); presets.splice(target, 0, moving);
    this.plugin.store.setEffectiveSceneSettings({handwritingPresets:presets});
    this.plugin.store.save();
    this.onPenToolChanged();
  }
  private copyHandwritingPreset(id: HandwritingPresetId): void {
    const presets = this.getHandwritingPresets(), index = presets.findIndex(item => item.id === id);
    if (index < 0) return;
    this.flushPen();
    const copy = { ...presets[index], id: uid("pen") }, next = presets.slice();
    next.splice(index + 1, 0, copy);
    this.plugin.store.setEffectiveSceneSettings({handwritingPresets:next});
    this.setActiveHandwritingPreset(copy.id);
    this.plugin.store.save();
  }
  private deleteHandwritingPreset(id: HandwritingPresetId): void {
    const presets = this.getHandwritingPresets().filter(preset => preset.id !== id);
    if (!presets.length) return;
    this.flushPen();
    this.plugin.store.setEffectiveSceneSettings({handwritingPresets:presets});
    if (this.handwritingPreset === id) this.handwritingPreset = presets[0].id;
    this.setActiveHandwritingPreset(this.handwritingPreset);
    this.plugin.store.save();
    this.onPenToolChanged();
  }
  setHandwritingMode(mode: HandwritingMode): void {
    if (this.disposed || this.releasing || !this.docPath || !["pen","highlight","eraser","lasso","off"].includes(mode)) return;
    this.flushPen();
    if (mode === "pen" || mode === "highlight") {
      const highlighted = mode === "highlight", wanted = highlighted ? this.highlightHandwritingPreset : this.normalHandwritingPreset;
      const selected = this.getHandwritingPresets().find(item => item.id === wanted && (item.type === "highlighter") === highlighted)
        ?? this.getHandwritingPresets().find(item => (item.type === "highlighter") === highlighted);
      if (!selected) return;
      this.handwritingPreset = selected.id;
    }
    this.closeOverlayEditor?.(); this.cancelOverlayPlacement();
    if (this.getHandwritingMode() === mode) return;
    this.selectionSession++; this.removePop();
    this.setBlockSelectionMode(false);this.setRegionMode(false);
    const wasActive = this.penMode;
    this.penMode = mode !== "off";
    if (mode !== "off") this.penTool = mode === "pen" ? "draw" : mode === "eraser" ? "erase" : mode === "lasso" ? "select" : "highlight";
    if (this.penMode) { if (!wasActive) this.setupPen(); else this.onPenToolChanged(); }
    else this.teardownPen();
    this.syncPenButtons();
  }
  subscribeHandwritingModeChange(listener: (mode: HandwritingMode) => void): () => void {
    if (this.disposed) return () => {};
    this.handwritingModeListeners.add(listener); return () => this.handwritingModeListeners.delete(listener);
  }
  selectPenTool(tool: PenTool): void {
    if (this.disposed || this.releasing || !this.docPath) return;
    const mode: HandwritingMode = tool === "draw" ? "pen" : tool === "erase" ? "eraser" : tool === "select" ? "lasso" : "highlight";
    this.setHandwritingMode(this.getHandwritingMode() === mode ? "off" : mode);
    new Notice(!this.penMode ? "已退出手写模式" : tool === "erase" ? "手写橡皮：划过笔画后松开，删除整笔；可撤销" : tool === "select" ? "手写套索：圈选后拖动；Delete 删除，Esc 取消" : tool === "highlight" ? "荧光笔：在文档自由划线" : this.vanishPen ? "消失笔：笔迹约 4 秒后消失，不会保存" : "手写模式：在文档书写，再次点画笔退出");
  }

  protected isVanishPen(): boolean { return this.vanishPen; }
  private setVanishPen(enabled: boolean): void { this.vanishPen = enabled; }

  protected getPenRecords(page?: number, layer = this.getInkLayers().active): InkRecord[] {
    const state = this.getInkLayers();
    return this.cache.map((ann) => this.mapAnnotationForDisplay(ann)).filter((ann) => annotationNotebook(ann) === this.activeNotebookId && ann.type === "pen" && annotationInkLayer(ann, state) === layer && (page === undefined || ann.page === page) && ann.strokes?.length)
      .map((ann) => ({ id: ann.id, strokes: ann.strokes! }));
  }
  protected commitPenChanges(changes: InkChange[], coordinates?: { project: (strokes: Stroke[][]) => Stroke[][]; unproject: (strokes: Stroke[][]) => Stroke[][] }): void {
    if (!this.docPath || this.releasing || this.disposed) return;
    if (coordinates) {
      const originals = changes.map(change => this.cache.find(ann => ann.id === change.id));
      const displayed = originals.map(ann => coordinates.project(ann?.strokes ?? []));
      if (originals.some((ann, index) => !ann || ann.type !== "pen" || JSON.stringify(displayed[index]) !== JSON.stringify(changes[index].before))) {
        this.rejectStalePenChange(); return;
      }
      changes = changes.map((change, index) => ({ id: change.id, before: cloneStrokes(originals[index]!.strokes!),
        after: change.after.map(stroke => {
          const unchanged = displayed[index].findIndex(before => JSON.stringify(before) === JSON.stringify(stroke));
          return unchanged < 0 ? coordinates.unproject([stroke])[0] : cloneStrokes([originals[index]!.strokes![unchanged]])[0];
        }) }));
    }
    const changed = changes.filter((change) => JSON.stringify(change.before) !== JSON.stringify(change.after));
    if (!changed.length || !this.applyPenChanges(changed, false)) return;
    this.recordPenChange(changed);
  }
  private recordPenChange(changes: InkChange[], created?: Annotation): void {
    this.recordEditChange({ kind:"pen", sequence:++this.editSequence, label:"手写", changes:changes.map((change) => ({
      id: change.id, before: cloneStrokes(change.before), after: cloneStrokes(change.after),
      ...(created?.id === change.id ? { creation: { annotation: this.cloneAnnotation(created), index: this.cache.indexOf(created), removed: false } } : {})
    })) });
  }
  private rejectStalePenChange(): void {
    this.clearEditHistory();
    new Notice("笔画已在其他视图修改，已清除此视图的阅读编辑撤销记录");
  }
  private applyPenChanges(changes: ReaderPenChange[], reverse: boolean): boolean {
    const annotations = changes.map((change) => this.cache.find((ann) => ann.id === change.id));
    if (annotations.some((ann, index) => changes[index].creation?.removed
      ? reverse || !!ann
      : !ann || ann.type !== "pen" || JSON.stringify(ann.strokes ?? []) !== JSON.stringify(reverse ? changes[index].after : changes[index].before))) {
      this.rejectStalePenChange(); return false;
    }
    annotations.forEach((ann, index) => {
      const change = changes[index], creation = change.creation;
      if (creation?.removed) {
        const restored = this.cloneAnnotation(creation.annotation); restored.docPath = this.docPath!;
        this.cache.splice(Math.min(creation.index, this.cache.length), 0, restored); creation.removed = false;
      } else if (reverse && creation && this.canRemoveCreatedPen(ann!, creation.annotation)) {
        this.cache.splice(this.cache.indexOf(ann!), 1); creation.removed = true;
      } else ann!.strokes = cloneStrokes(reverse ? change.before : change.after);
    });
    // Erasing existing ink and linked source records still retains their annotation IDs.
    this.persist(); this.onAnnotationsChanged(); return true;
  }
  private canRemoveCreatedPen(current: Annotation, original: Annotation): boolean {
    if (JSON.stringify(current) !== JSON.stringify({ ...original, docPath: current.docPath }) || current.cardId) return false;
    return !this.plugin.store.cards.some(card => (card.docPath === current.docPath && card.anchorAnnId === current.id)
      || card.sources?.some(source => source.docPath === current.docPath && source.anchorAnnId === current.id));
  }
  undoPenChange(): void {
    this.applyEditHistory(false,"pen");
  }
  redoPenChange(): void {
    this.applyEditHistory(true,"pen");
  }
  private syncPenButtons(): void {
    this.penEditButtons.forEach((button, tool) => { const active = this.penMode && tool === this.penTool; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active)); });
    if (this.penUndoButton) this.penUndoButton.disabled = this.applyingEditHistory || !this.editUndo.some(change=>change.kind==="pen");
    if (this.penRedoButton) this.penRedoButton.disabled = this.applyingEditHistory || !this.editRedo.some(change=>change.kind==="pen");
    const mode = this.getHandwritingMode();
    this.getScrollContainer().closest<HTMLElement>(".ms-reader-root")?.toggleAttribute("data-recall-drawing",mode!=="off");
    if (mode !== this.publishedHandwritingMode) { this.publishedHandwritingMode = mode; for (const listener of this.handwritingModeListeners) listener(mode); }
    this.getScrollContainer().dataset.handwritingMode = mode;
  }

  getDocumentNotebooks(): DocumentNotebookState { return documentNotebookState(this.docPath ? this.plugin.store.getDocMeta(this.docPath) : {}); }
  getDocumentNotebookId(): string { return this.activeNotebookId; }
  openDocumentNotebooks(): void { this.documentNotebooks?.show(); }
  protected getCurrentNotebookMeta(): DocMeta { return notebookMeta(this.docPath ? this.plugin.store.getDocMeta(this.docPath) : {}, this.activeNotebookId); }
  protected updateCurrentNotebookMeta(patch: Partial<DocMeta>): void { if (this.docPath) updateNotebookMeta(this.plugin, this.docPath, patch, this.activeNotebookId); }
  protected isNotebookReference(ann: Annotation): boolean { return annotationNotebook(ann) !== this.activeNotebookId; }
  protected isAnnotationVisible(ann: Annotation): boolean { const state = this.getDocumentNotebooks(), id = annotationNotebook(ann); return !ann.mediaDeleted && !ann.overlay?.deleted && (id === state.active || id === state.overlay); }
  protected getAnnotationsForDisplay(): Annotation[] { return this.cache.filter((ann) => this.isAnnotationVisible(ann) && (!ann.overlay || this.isInkVisible(ann))).sort((a,b) => Number(this.isNotebookReference(a)) - Number(this.isNotebookReference(b))).map((ann) => this.mapAnnotationForDisplay(ann)); }
  private syncDocumentNotebooks(redraw = true): void {
    if (!this.docPath) return; const state = this.getDocumentNotebooks(), fingerprint = JSON.stringify(state); if (fingerprint === this.notebookFingerprint) return;
    const switched = state.active !== this.activeNotebookId; if (switched) this.closeOverlayEditor?.(); this.notebookFingerprint = fingerprint;
    if (redraw && switched && this.penMode) this.teardownPen();
    this.activeNotebookId = state.active; this.documentNotebooks?.refresh();
    if (redraw && switched) {
      this.setBlockSelectionMode(false);this.setRegionMode(false);
      this.documentRevision++; this.removePop(); this.currentTarget = null; this.currentText = ""; this.recall.clear();
      this.cancelOverlayPlacement(); this.closeOverlayEditor?.(); this.clearEditHistory();
      this.inkLayerFingerprint = ""; this.syncInkLayers(false); this.onDocumentNotebookChanged();
    }
    if (redraw) { this.onAnnotationsChanged(); if (switched && this.penMode) this.setupPen(); }
  }
  selectDocumentNotebook(id: string): void {
    if (!this.docPath || this.releasing || this.disposed) return; const state = this.getDocumentNotebooks();
    if (!state.notebooks.some((item) => item.id === id)) return;
    this.closeOverlayEditor?.();
    this.plugin.store.updateDocMeta(this.docPath, { activeDocumentNotebookId: id, overlayDocumentNotebookId: state.overlay === id ? undefined : state.overlay });
  }
  createDocumentNotebook(name: string): boolean {
    if (!this.docPath || this.releasing || this.disposed) return false; const value = name.trim(), state = this.getDocumentNotebooks();
    if (!value || value.length > 80) { new Notice("请填写 1–80 字的笔记本名称"); return false; }
    const existing = state.notebooks.find((item) => item.name === value); if (existing) { this.selectDocumentNotebook(existing.id); return true; }
    if (!this.cache.some((ann) => annotationNotebook(ann) === state.active && !ann.overlay?.deleted && (ann.type !== "pen" || !!ann.strokes?.length))) { new Notice("当前笔记本为空，请先添加笔记"); return false; }
    this.closeOverlayEditor?.();
    const item = { id: uid("notebook"), name: value }; this.plugin.store.updateDocMeta(this.docPath, { documentNotebooks: [...state.notebooks, item], activeDocumentNotebookId: item.id }); return true;
  }
  renameDocumentNotebook(id: string, name: string): boolean {
    if (!this.docPath || this.releasing || this.disposed) return false; const value = name.trim(), state = this.getDocumentNotebooks();
    if (!value || value.length > 80 || !state.notebooks.some((item) => item.id === id) || state.notebooks.some((item) => item.id !== id && item.name === value)) return false;
    this.plugin.store.updateDocMeta(this.docPath, { documentNotebooks: state.notebooks.map((item) => item.id === id ? { ...item, name: value } : item) }); return true;
  }
  setDocumentNotebookOverlay(id?: string): void {
    if (!this.docPath || this.releasing || this.disposed) return; const state = this.getDocumentNotebooks(); if (id && (id === state.active || !state.notebooks.some((item) => item.id === id))) return;
    this.plugin.store.updateDocMeta(this.docPath, { overlayDocumentNotebookId: id });
  }
  deleteDocumentNotebook(id: string): void {
    if (!this.docPath || this.releasing || this.disposed) return; const state = this.getDocumentNotebooks(); if (!state.notebooks.some((item) => item.id === id)) return;
    if (id === state.active && this.penMode) this.teardownPen();
    const removed = this.cache.filter((ann) => annotationNotebook(ann) === id);
    for (const ann of removed) { const index = this.cache.indexOf(ann); if (index >= 0) this.cache.splice(index,1); this.plugin.store.removeAnnotationLinks(this.docPath, ann.id); }
    this.persist(); const meta = this.plugin.store.getDocMeta(this.docPath), scoped = { ...meta.documentNotebookMeta }; delete scoped[id];
    const retain = id === state.active || id === "default";
    this.plugin.store.updateDocMeta(this.docPath, { documentNotebooks: state.notebooks.filter((item) => retain || item.id !== id), documentNotebookMeta: scoped,
      overlayDocumentNotebookId: state.overlay === id ? undefined : state.overlay,
      ...(id === "default" ? { handwritingLayers: undefined, activeHandwritingLayerId: undefined, overlayHandwritingLayerId: undefined, foldedPages: undefined, bookmarks: undefined } : {}) });
    this.clearEditHistory(); this.inkLayerFingerprint = ""; this.syncInkLayers(false); this.onDocumentNotebookChanged(); this.onAnnotationsChanged(); if (this.penMode) this.setupPen();
  }
  protected revealAnnotationNotebook(ann: Annotation): void { if (annotationNotebook(ann) !== this.activeNotebookId) this.selectDocumentNotebook(annotationNotebook(ann)); }
  protected getInkLayers(): InkLayerState { return inkLayerState(this.getCurrentNotebookMeta()); }
  openHandwritingSettings(anchor?: HTMLElement): void { this.inkLayers?.show(anchor ?? this.penBtn ?? undefined); }
  openHandwritingPresets(anchor?: HTMLElement): void { this.inkLayers?.showPresets(anchor ?? this.penBtn ?? undefined); }
  /** Document preference; the workspace supplies the live reader/map mode connection. */
  getHandwritingSyncPreference(): boolean { return !!(this.docPath && this.plugin.store.getDocMeta(this.docPath).handwritingSyncEnabled); }
  setHandwritingSyncAvailable(available: boolean): void { if (this.handwritingSyncAvailable === available) return; this.handwritingSyncAvailable = available; this.inkLayers?.refresh(); }
  setHandwritingSyncPreference(enabled: boolean): void {
    if (!this.docPath || this.disposed || this.releasing) return;
    this.plugin.store.updateDocMeta(this.docPath, { handwritingSyncEnabled: enabled });
  }
  subscribeHandwritingSyncPreference(listener: (enabled: boolean) => void): () => void {
    if (this.disposed) return () => {};
    this.handwritingSyncListeners.add(listener); listener(this.getHandwritingSyncPreference());
    return () => this.handwritingSyncListeners.delete(listener);
  }
  private syncHandwritingSyncPreference(): void {
    const value = this.getHandwritingSyncPreference(); if (value === this.handwritingSyncPreference) return;
    this.handwritingSyncPreference = value; this.inkLayers?.refresh();
    for (const listener of this.handwritingSyncListeners) listener(value);
  }
  protected isInkVisible(ann: Annotation): boolean {
    if (!this.isAnnotationVisible(ann)) return false;
    const state = this.isNotebookReference(ann) ? inkLayerState(notebookMeta(this.docPath ? this.plugin.store.getDocMeta(this.docPath) : {}, annotationNotebook(ann))) : this.getInkLayers();
    const layer = annotationInkLayer(ann, state); return layer === state.active || layer === state.overlay;
  }
  protected isInkReference(ann: Annotation): boolean { const state = this.getInkLayers(); return this.isNotebookReference(ann) || annotationInkLayer(ann, state) !== state.active; }
  private syncInkLayers(redraw = true): void {
    if (!this.docPath) return;
    const fingerprint = JSON.stringify(this.getInkLayers()); if (fingerprint === this.inkLayerFingerprint) return;
    this.closeOverlayEditor?.(); this.inkLayerFingerprint = fingerprint;
    if (redraw && this.penMode) this.teardownPen();
    this.clearEditHistory(); this.inkLayers?.refresh();
    this.cancelOverlayPlacement(); this.closeOverlayEditor?.();
    if (redraw) { this.onAnnotationsChanged(); if (this.penMode) this.setupPen(); }
  }
  selectInkLayer(id: string): void {
    if (!this.docPath || this.releasing || this.disposed) return;
    const state = this.getInkLayers(); if (!state.layers.some((layer) => layer.id === id)) return;
    this.closeOverlayEditor?.();
    this.updateCurrentNotebookMeta({ activeHandwritingLayerId: id, overlayHandwritingLayerId: state.overlay === id ? undefined : state.overlay });
  }
  setInkOverlay(id?: string): void {
    if (!this.docPath || this.releasing || this.disposed) return;
    const state = this.getInkLayers(); if (id && (id === state.active || !state.layers.some((layer) => layer.id === id))) return;
    this.updateCurrentNotebookMeta({ overlayHandwritingLayerId: id });
  }
  createInkLayer(name: string): void {
    if (!this.docPath || this.releasing || this.disposed) return;
    const value = name.trim(); if (!value || value.length > 80) { new Notice("请填写 1–80 字的图层名称"); return; }
    const state = this.getInkLayers(), existing = state.layers.find((layer) => layer.name === value);
    if (existing) { this.selectInkLayer(existing.id); return; }
    this.closeOverlayEditor?.();
    const layer = { id: uid("ink"), name: value };
    this.updateCurrentNotebookMeta({ handwritingLayers: [...state.layers, layer], activeHandwritingLayerId: layer.id });
  }
  renameInkLayer(id: string, name: string): void {
    if (!this.docPath || this.releasing || this.disposed) return;
    const value = name.trim(), state = this.getInkLayers(); if (!value || value.length > 80) { new Notice("请填写 1–80 字的图层名称"); return; }
    if (!state.layers.some((layer) => layer.id === id)) return;
    const existing = state.layers.find((layer) => layer.id !== id && layer.name === value);
    if (existing) { this.mergeInkLayers(id, existing.id); return; }
    this.updateCurrentNotebookMeta({ handwritingLayers: state.layers.map((layer) => layer.id === id ? { ...layer, name: value } : layer) });
  }
  mergeInkLayers(source: string, target: string): void {
    if (!this.docPath || this.releasing || this.disposed || source === target) return;
    const state = this.getInkLayers(); if (![source, target].every((id) => state.layers.some((layer) => layer.id === id))) return;
    if (this.penMode) this.teardownPen();
    this.closeOverlayEditor?.();
    for (const ann of this.cache) if (annotationNotebook(ann) === this.activeNotebookId && (ann.type === "pen" || !!ann.overlay) && annotationInkLayer(ann, state) === source) ann.inkLayerId = target;
    this.persist();
    const active = state.active === source ? target : state.active;
    this.updateCurrentNotebookMeta({ handwritingLayers: state.layers.filter((layer) => layer.id !== source || layer.id === "default"), activeHandwritingLayerId: active,
      overlayHandwritingLayerId: state.overlay === source || state.overlay === active ? undefined : state.overlay });
    this.clearEditHistory();
    // Merge can retain an empty default layer, so metadata may compare equal; redraw explicitly as well.
    this.onAnnotationsChanged(); if (this.penMode) this.setupPen();
  }
  deleteInkLayer(id: string): void {
    if (!this.docPath || this.releasing || this.disposed || id === "default") return;
    const state = this.getInkLayers(); if (!state.layers.some((layer) => layer.id === id)) return;
    if (this.penMode) this.teardownPen();
    // As with erasing the last stroke, keep annotation identities for saved source cards.
    for (const ann of this.cache) if (annotationNotebook(ann) === this.activeNotebookId && annotationInkLayer(ann, state) === id) { if (ann.type === "pen") ann.strokes = []; else if (ann.overlay) ann.overlay.deleted = true; }
    this.persist();
    this.updateCurrentNotebookMeta({ handwritingLayers: state.layers.filter((layer) => layer.id !== id),
      activeHandwritingLayerId: state.active === id ? "default" : state.active,
      overlayHandwritingLayerId: state.overlay === id ? undefined : state.overlay });
    this.clearEditHistory();
    this.onAnnotationsChanged(); if (this.penMode) this.setupPen();
  }

  // ===== 套索/区域摘录 =====
  toggleLasso(): void {
    if (this.disposed || this.releasing || !this.docPath) return;
    this.setBlockSelectionMode(false);
    this.closeOverlayEditor?.(); this.cancelOverlayPlacement();
    if (this.penMode) {
      this.penMode = false;
      this.penBtn?.classList.remove("is-active");
      this.teardownPen();
      this.syncPenButtons();
    }
    this.selectionSession++; this.removePop();
    this.lassoMode = !this.lassoMode;this.getScrollContainer().classList.toggle("ms-region-selecting",this.lassoMode);this.getScrollContainer().style.touchAction=this.lassoMode?"none":"";this.regionSession++;this.cancelRegionGesture();
    this.lassoBtn?.classList.toggle("is-active", this.lassoMode);
    if (this.lassoMode) {
      window.getSelection()?.removeAllRanges();
      new Notice("套索模式：在页面上拖拽框选区域，松开后生成摘录");
    } else {
      new Notice("已退出套索模式");
    }
  }

  isLassoMode(): boolean {
    return this.lassoMode;
  }
  setRegionMode(on:boolean):void { if(this.lassoMode!==on)this.toggleLasso(); }

  /**
   * 由子类在框选完成后调用：生成 region 标注并可选择直接成卡。
   * @param target 定位信息（PDF 坐标 或 HTML 字符范围）
   * @param image  区域截图（base64 data URL），可选
   * @param text   区域内文本/OCR 结果，可选
   */
  commitRegion(target: SelTarget, image?: string, text = ""): void {
    if (!this.docPath) return;
    const page = target.kind === "pdf" ? target.pageNum : 0;
    const ann: Annotation = {
      id: uid("ann"),
      docPath: this.docPath,
      docKind: target.kind === "pdf" ? "pdf" : "html",
      page,
      type: "region",
      rects: target.kind === "pdf" ? target.rects : [],
      pdfGeometry: target.kind === "pdf" ? target.pdfGeometry : undefined,
      pdfCoordinateSpace: target.kind === "pdf" ? target.pdfCoordinateSpace : undefined,
      range: target.kind === "html" ? target.range : undefined,
      text,
      color: this.color,
      image,
      createdAt: todayStr(),
    };
    this.pushAnnotation(ann);
    this.showExcerptMenu(ann);
    // 区域摘录后默认直接生成摘录卡（可被「区域摘录自动成卡」开关关闭），方便拖到脑图
    if (!this.continuousExcerpt && this.plugin.store.settings.autoCardOnRegion) this.makeCard(ann, "excerpt");
  }

  protected handleRecallClick(ann: Annotation, ev: MouseEvent): boolean {
    const t = ev.currentTarget as HTMLElement | null;
    const root = t?.closest(".ms-reader-root") as HTMLElement | null;
    if (root?.classList.contains("ms-recall") && t?.classList.contains("is-occluded")) {
      const key = t.dataset.recallKey ?? "excerpt:"+ann.id;
      if (this.recallAiHint && !this.recall.has(key)) {
        this.showRecallHint(ann, t, key);
        return true;
      }
      const canvas = this.plugin.store.canvases?.find(c => c.id === this.plugin.store.activeCanvasId);
      const single=this.recall.getOption("singleReveal") || (canvas?.singlePeek ?? false);
      if(single&&!this.recall.has(key))root.dispatchEvent(new CustomEvent("ms-recall-reveal",{bubbles:true,detail:{source:"reader"}}));
      this.recall.toggle(key,single);
      this.syncOcclusionElements();
      return true;
    }
    return false;
  }

  /** AI-hint mode reveals only after an explicit clue review. */
  private showRecallHint(ann: Annotation, target: HTMLElement, key: string): void {
    this.removeRecallHint();
    const card = ann.cardId ? this.plugin.store.getCard(ann.cardId) : undefined;
    const node = card
      ? this.plugin.store.nodes.find(candidate => candidate.cardId === card.id && candidate.canvasId === this.plugin.store.activeCanvasId)
      : undefined;
    const parent = node?.parentId ? this.plugin.store.getNode(node.parentId) : undefined;
    const excerpt = ann.text.trim();
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
    const normalizedExcerpt = normalize(excerpt);
    const safeMetadata = (value: string) => !normalizedExcerpt || !normalize(value).includes(normalizedExcerpt);
    const language = this.recallHintLanguage === "auto" ? "zh" : this.recallHintLanguage;
    const request: RecallHintRequest = {
      title: card?.title && safeMetadata(card.title) ? card.title.trim() || undefined : undefined,
      parentTitle: parent?.title && safeMetadata(parent.title) ? parent.title.trim() || undefined : undefined,
      keywords: (card?.keywords ?? []).filter(safeMetadata),
      excerpt,
      excerptLength: excerpt.length,
      hasImage: !!ann.image,
      language,
    };
    const structured = this.recall.getOption("structuredHint") ? language === "en" ? [
      request.title ? `Key concept: ${request.title}` : "",
      request.parentTitle ? `Hierarchy: ${request.parentTitle}` : "",
      request.keywords.length ? `Related terms: ${request.keywords.slice(0, 4).join(", ")}` : "",
      request.excerpt ? `Context cue: this excerpt has about ${request.excerptLength} characters. Recall its definition or conclusion.` : "This is an image or area excerpt. Recall its surrounding context.",
    ].filter(Boolean) : [
      request.title ? `关键概念：${request.title}` : "",
      request.parentTitle ? `所在层级：${request.parentTitle}` : "",
      request.keywords.length ? `关联词：${request.keywords.slice(0, 4).join("、")}` : "",
      request.excerpt ? `内容提示：这段摘录约 ${request.excerptLength} 个字符，先回忆它所属的定义或结论。` : "这是一处图片或区域摘录，先回忆它所在的上下文。",
    ].filter(Boolean) : [language === "en" ? "Recall the concept and structure before revealing." : "先回忆这段内容所属的概念，再选择揭开。"];
    const hint = el("div", { class: "ms-recall-hint", role: "dialog", "aria-label": "AI 回忆提示" });
    const title = el("strong", { text: "回忆提示" });
    const text = el("p", { text: structured.slice(0, 2).join("\n") || (language === "en" ? "Recall the concept before revealing." : "先回忆这段内容所属的概念。") });
    const more = el("button", { type: "button", text: "再来一层", "aria-label": "显示更多回忆提示" });
    const reveal = el("button", { type: "button", text: "揭开", "aria-label": "揭开遮挡内容" });
    const close = el("button", { type: "button", text: "关闭", "aria-label": "关闭回忆提示" });
    more.addEventListener("click", () => {
      text.textContent = structured.join("\n");
      more.disabled = structured.length <= 2;
    });
    reveal.addEventListener("click", () => {
      this.removeRecallHint();
      const single=this.recall.getOption("singleReveal") || !!this.plugin.store.canvases?.find(c=>c.id===this.plugin.store.activeCanvasId)?.singlePeek;
      if(single&&!this.recall.has(key))target.closest(".ms-reader-root")?.dispatchEvent(new CustomEvent("ms-recall-reveal",{bubbles:true,detail:{source:"reader"}}));
      this.recall.toggle(key,single);
      this.syncOcclusionElements();
    });
    close.addEventListener("click", () => this.removeRecallHint());
    hint.append(title, text, el("div", { class: "ms-recall-hint-actions" }, [more, reveal, close]));
    document.body.append(hint);
    const bounds = target.getBoundingClientRect(), width = hint.getBoundingClientRect().width;
    hint.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, bounds.left + bounds.width / 2 - width / 2))}px`;
    hint.style.top = `${Math.max(8, Math.min(window.innerHeight - hint.getBoundingClientRect().height - 8, bounds.top - hint.getBoundingClientRect().height - 8))}px`;
    this.recallHintEl = hint;
    const revision = this.documentRevision, path = this.docPath;
    if (this.recall.getOption("onDeviceAiHint") && this.recallHintProvider) void this.recallHintProvider(request).then(result => {
      if (!hint.isConnected || revision !== this.documentRevision || path !== this.docPath || this.recallHintEl !== hint) return;
      const lines = result.lines.map(line => line.trim()).filter(Boolean).slice(0, 4);
      if (lines.length) text.textContent = lines.join("\n");
      hint.dataset.hintSource = result.source;
    }).catch(() => {
      if (hint.isConnected) hint.dataset.hintSource = "structured";
    });
  }

  private removeRecallHint(): void {
    this.recallHintEl?.remove();
    this.recallHintEl = null;
  }
  // ===== 点击标注（两控制器完全相同） =====
  protected onAnnClick(ann: Annotation, ev: MouseEvent): void {
    ev.stopPropagation();
    if (this.isNotebookReference(ann)) return;
    if (ann.cardId) this.plugin.viewEvents?.onDocumentCardSelect?.(ann.cardId);
    if (this.handleRecallClick(ann,ev)) return;
    this.removePop();
    document.dispatchEvent(new Event("ms-reader-menu-opening"));
    const pop = el("div", { class: "ms-ann-pop" });
    this.watchCompetingMenus();
    const mk = (label: string, cb: () => void) => {
      const b = el("button", { text: label });
      b.addEventListener("click", () => {
        cb();
        this.removePop();
      });
      return b;
    };
    if (ann.type === "voice" && ann.audioPath) {
      pop.append(mk("播放", () => {const revision=this.documentRevision;this.closeMediaPlayer?.();void openMediaPlayer(this.plugin.app,ann.audioPath!,ann.mediaKind??"audio").then(close=>{if(revision!==this.documentRevision||this.disposed)close();else this.closeMediaPlayer=close;}).catch(error=>new Notice("播放失败："+String(error)));}));
      pop.append(mk("转写文字（粘贴/编辑）", () => this.editVoiceTranscript(ann)));
      pop.append(mk("本地自动转写", () => this.editVoiceTranscript(ann, true)));
    }
    if (ann.type !== "voice" && ann.type !== "pen") {
      pop.append(
        mk("摘录卡", () => this.makeCard(ann, "excerpt")),
        mk("评论卡", () => this.makeCard(ann, "comment")),
        mk("闪卡", () => this.makeCard(ann, "flashcard"))
      );
      pop.append(mk("切换整卡遮挡", () => {
        if (!ann.cardId || !this.plugin.store.getCard(ann.cardId)) this.makeCard(ann,"excerpt",true);
        if (!ann.cardId) return;
        const node = this.plugin.store.nodes.find(n => n.cardId === ann.cardId && n.canvasId === this.plugin.store.activeCanvasId);
        if (node) this.plugin.store.toggleNodeOcclusion([node.id]); else this.plugin.store.toggleCardOcclusion([ann.cardId]);
        this.syncOcclusionElements();
      }));
      if (ann.type === "note" || ann.noteText) {
        pop.append(mk(ann.noteText ? "编辑批注" : "加批注", () => this.editNote(ann)));
      }
      if (ann.type === "region") {
        pop.append(mk("加入脑图", () => this.addRegionToMindmap(ann)));
      }
      const mapped=ann.cardId&&this.plugin.store.nodes.find(node=>node.cardId===ann.cardId&&node.canvasId===this.plugin.store.activeCanvasId);
      if(mapped)pop.append(mk("撤出脑图",()=>{if(this.plugin.store.removeExcerptFromMindmap(mapped.id)){this.plugin.refreshMindmap();new Notice("已撤出脑图，文档标注保留");}}));
    } else if (ann.type === "pen") {
      pop.append(mk("变成卡片", () => this.makeCard(ann, "excerpt")));
    }
    pop.append(mk("删除", () => this.deleteAnn(ann)));
    document.body.append(pop);
    this.popEl = pop;
    const rect = pop.getBoundingClientRect();
    let x = ev.clientX + 8;
    let y = ev.clientY + 8;
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight) y = ev.clientY - rect.height - 8;
    pop.style.left = `${Math.max(8, x)}px`;
    pop.style.top = `${Math.max(8, y)}px`;
  }

  protected makeCard(ann: Annotation, type: CardType, silent = false): void {
    const front =
      ann.overlay?.kind === "image" ? ann.text || "[图片批注]" : ann.overlay?.kind === "text" ? ann.text : ann.type === "voice"
        ? "[语音批注]"
        : ann.type === "pen"
        ? "[手写批注]"
        : ann.type === "region"
        ? ann.text || "[区域摘录]"
        : ann.type === "note" && ann.noteText
        ? ann.noteText
        : ann.text;
    const card: Card = {
      id: uid("card"),
      docPath: ann.docPath,
      type,
      color: ann.color,
      front,
      back: type === "flashcard" ? "" : undefined,
      links: [],
      tags: [],
      anchorAnnId: ann.id,
      page: ann.page,
      image: ann.image,
      createdAt: todayStr(),
    };
    this.plugin.store.addCard(card);
    ann.cardId = card.id;
    this.persist();
    this.plugin.refreshSidebar();
    if (this.plugin.store.settings.autoNodeOnCard) this.addCardToMindmap(card);
    let autoReviewNotice="";
    if(this.plugin.store.settings.autoReview){
      const deck=this.plugin.store.reviewDeckForStudySet();
      if(deck){
        try{
          const rows=this.plugin.store.enqueueReviewInDeck([card.id],deck.id,this.plugin.store.activeCanvasId);
          autoReviewNotice=rows.length?`已加入复习卡组「${deck.name}」`:"未加入复习：当前卡组不可用";
        }catch(error){autoReviewNotice=`未加入复习：${String(error)}`;}
      }else autoReviewNotice="未加入复习：当前学习集没有可用复习卡组";
    }
    if (!silent) {
      const label = type === "excerpt" ? "摘录卡" : type === "comment" ? "评论卡" : "闪卡";
      new Notice(`已生成${label}，可在侧边栏「卡片」或脑图拖拽使用${autoReviewNotice?`；${autoReviewNotice}`:""}`);
    }else if(autoReviewNotice.startsWith("未加入复习"))new Notice(`已生成卡片；${autoReviewNotice}`);
  }

  protected editNote(ann: Annotation): void {
    openTextModal({
      title: "编辑批注",
      placeholder: "输入你的批注内容…",
      initial: ann.noteText ?? "",
      onOk: (v) => {
        ann.noteText = v;
        this.persist();
        this.afterNoteEdited(ann);
      },
    });
  }

  private editVoiceTranscript(ann: Annotation, automatic = false): void {
    const path=this.docPath,revision=this.documentRevision,before=ann.noteText;
    const abort=new AbortController();
    const {modal,close}=createModal("录音转写文字",()=>abort.abort());
    modal.setAttribute("role","dialog");modal.setAttribute("aria-label","录音转写文字");
    const text=el("textarea",{"aria-label":"录音转写内容",placeholder:"粘贴已完成的转写文字…",style:"width:100%;min-height:160px"}) as HTMLTextAreaElement;
    text.value=before??"";
    const save=el("button",{text:"保存","aria-label":"保存转写文字"});
    const status=el("p",{role:"status",text:"可在本机自动识别或粘贴文字；仅点击保存后修改批注，不上传音频。"});
    const run=el("button",{text:"本地自动转写","aria-label":"开始本地自动转写"}) as HTMLButtonElement;
    const recognize=async()=>{
      if(run.disabled||abort.signal.aborted)return;
      run.disabled=true;(save as HTMLButtonElement).disabled=true;text.disabled=true;
      try{
        const result=await transcribeVoice(this.plugin.app,ann.audioPath!,abort.signal,message=>{status.textContent=message;});
        if(!abort.signal.aborted){text.value=result;status.textContent="本地识别完成，请校对后保存；已有转写尚未修改。";}
      }catch(error){if(!abort.signal.aborted)status.textContent=(error as Error).message||String(error);}
      finally{run.disabled=false;(save as HTMLButtonElement).disabled=false;text.disabled=false;}
    };
    run.addEventListener("click",()=>{void recognize();});
    save.addEventListener("click",()=>{
      const current=this.cache.find(item=>item.id===ann.id);
      if(this.docPath!==path||revision!==this.documentRevision||!current||current.mediaDeleted||current.noteText!==before){new Notice("录音来源已变化，请关闭后重新打开；输入文字仍保留在此窗口");return;}
      const after=text.value||undefined;if(after===before){close();return;}
      current.noteText=after;this.persist();this.onAnnotationsChanged();
      this.recordDocumentEdit("编辑录音转写",async redo=>{
        const target=this.cache.find(item=>item.id===ann.id);
        if(this.docPath!==path||revision!==this.documentRevision||!target||target.mediaDeleted||target.noteText!==(redo?before:after))throw new Error("录音转写已在其他视图修改");
        target.noteText=redo?after:before;this.persist();this.onAnnotationsChanged();
      });close();
    });
    const cancel=el("button",{text:"取消"});cancel.addEventListener("click",close);
    modal.append(status,text,run,save,cancel);text.focus();if(automatic)void recognize();
  }

  protected deleteAnn(ann: Annotation): void {
    if(ann.mediaKind || ann.type === "voice" && ann.audioPath){ann.mediaDeleted=true;this.recordMediaEdit(ann,false);this.persist();this.removeAnnotationEl(ann);return;}
    const index = this.cache.findIndex((item) => item.id === ann.id);
    if (index >= 0) this.cache.splice(index, 1);
    this.plugin.store.removeAnnotationLinks(ann.docPath, ann.id);
    this.persist();
    this.removeAnnotationEl(ann);
  }

  protected typeLabel(t: AnnotationType): string {
    return t === "highlight"
      ? "高亮"
      : t === "underline"
      ? "下划线"
      : t === "strike"
      ? "删除线"
      : t === "note"
      ? "批注"
      : t === "voice"
      ? "语音"
      : t === "region"
      ? "区域摘录"
      : "手写";
  }

  /** 把卡片同步到当前文档脑图（仿 MarginNote：摘录即节点，实时联动）。已存在对应节点则跳过。 */
  protected addCardToMindmap(card: Card): void {
    const docPath = card.docPath;
    if (this.plugin.store.nodes.some((n) => n.cardId === card.id && n.canvasId === this.plugin.store.activeCanvasId && !n.hidden)) return;
    const set=this.plugin.store.studySets.find(item=>item.id===this.plugin.store.activeStudySetId),destination=set?.excerptDestination;
    const candidate=destination&&destination.canvasId===this.plugin.store.activeCanvasId?this.plugin.store.getNode(destination.nodeId):undefined;
    const pinned=candidate?.canvasId===this.plugin.store.activeCanvasId?candidate:undefined;
    const rootId = pinned ? pinned.parentId : this.ensureRoot(docPath);
    const sibs = this.plugin.store.nodes.filter((n) => n.parentId === rootId&&n.canvasId===this.plugin.store.activeCanvasId);
    const i = sibs.length;
    // 根节点在左侧，子节点单列排布到右侧；每个分支自动分配柔和底色
    const x = pinned?.x??320;
    const y = pinned ? pinned.y + 150 : 40 + i * 150;
    const newNode:MindNode={
      id: uid("node"),
      parentId: rootId,
      title: card.front.slice(0, 60),
      cardId: card.id,
      canvasId: this.plugin.store.activeCanvasId,
      docPath,
      image: card.image,
      collapsed: false,
      x,
      y,
      color: this.branchColor(i),
    };
    if(pinned){const siblings=sibs.slice().sort((a,b)=>(a.order??0)-(b.order??0)),position=siblings.findIndex(item=>item.id===pinned.id);
      this.plugin.store.libraryTransaction("添加摘录到固定落点",()=>{this.plugin.store.addNode(newNode);this.plugin.store.reparentNode(newNode.id,rootId,position+1);});
    }else this.plugin.store.addNode(newNode);
    this.plugin.refreshMindmap();
  }

  /** 柔和分支色板（MarginNote 风格 pastel cards） */
  private branchColor(index: number): string {
    const palette = [
      "#ffe8d6", // 暖橙
      "#ffd6e0", // 粉红
      "#d4f5d4", // 浅绿
      "#d4e5ff", // 浅蓝
      "#f0d4ff", // 浅紫
      "#fff2cc", // 浅黄
      "#e2f0cb", // 青绿
      "#cfe8fc", // 天蓝
    ];
    return palette[index % palette.length];
  }

  /** 把区域摘录对应的卡片加入当前文档脑图（无卡片时自动建摘录卡） */
  protected addRegionToMindmap(ann: Annotation): void {
    let card = ann.cardId ? this.plugin.store.getCard(ann.cardId) : undefined;
    if (!card) {
      this.makeCard(ann, "excerpt", true);
      card = ann.cardId ? this.plugin.store.getCard(ann.cardId) : undefined;
    }
    if (!card) return;
    if (this.plugin.store.nodes.some((n) => n.cardId === card!.id && n.canvasId === this.plugin.store.activeCanvasId && !n.hidden)) {
      new Notice("该摘录已在脑图中");
      return;
    }
    this.addCardToMindmap(card);
    this.plugin.sidebar?.setTab("mindmap");
    new Notice("已加入脑图");
  }

  private ensureRoot(docPath: string): string {
    const existing = this.plugin.store.nodes.find((n) => n.docPath === docPath && n.parentId === null && n.canvasId === this.plugin.store.activeCanvasId && !n.hidden);
    if (existing) return existing.id;
    const id = uid("node");
    const basename = docPath.split("/").pop()?.replace(/\.(pdf|docx)$/i, "") ?? docPath;
    this.plugin.store.addNode({
      id,
      parentId: null,
      title: basename,
      docPath,
      canvasId: this.plugin.store.activeCanvasId,
      collapsed: false,
      x: 40,
      y: 40,
      color: this.branchColor(0),
    });
    return id;
  }

  protected persist(): void {
    if (!this.docPath) return;
    this.saving = true;
    try { this.plugin.store.saveAnnotationsDebounced(this.docPath, this.cache); }
    finally { this.saving = false; }
  }

  protected removePop(): void {
    this.closeCompetingMenuListener?.();this.closeCompetingMenuListener=null;
    this.closeSelectionPop?.();
    this.closeSelectionPop = null;
    if (this.popEl) {
      this.popEl.remove();
      this.popEl = null;
    }
  }

  private watchCompetingMenus():void {
    const close=()=>this.removePop();
    document.addEventListener('ms-card-menu-opening',close);
    document.addEventListener('ms-block-menu-opening',close);
    document.addEventListener('ms-reader-menu-opening',close);
    this.closeCompetingMenuListener=()=>{document.removeEventListener('ms-card-menu-opening',close);document.removeEventListener('ms-block-menu-opening',close);document.removeEventListener('ms-reader-menu-opening',close);};
  }

  protected getCache(): Annotation[] {
    return this.cache;
  }
}
