/**
 * [INPUT]: 留白纸面、文字框记录、提交回调及富文本渲染器。
 * [OUTPUT]: 文字框交互、内容适配与 PNG 渲染。
 * [POS]: 以纸面为坐标基准，提交拖动时保留完成的预览。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { Annotation, PdfExtendNote } from "../types";
import { el } from "../utils/dom";
import { applyTextStyle, normalizeTextStyle, renderTextRuns } from "../annot/textRuns";
import { overlayPng } from "./exportAnnotations";
import { Notice } from "obsidian";

type TextBox = NonNullable<PdfExtendNote["textBoxes"]>[number];
const style = () => normalizeTextStyle({fontSize:16});

/** Position belongs to the paper, and does not depend on the current reader zoom. */
export function renderExtendTextBoxes(paper: HTMLElement, note: PdfExtendNote, scale: number, enabled:()=>boolean, edit:(id:string)=>void, remove:(id:string)=>void, movement?:{current:()=>boolean;latest:()=>TextBox[];save:(records:TextBox[])=>Promise<void>;cut?:(record:TextBox)=>void;copied?:()=>void}): ()=>void {
  let cancelDrag:(()=>void)|undefined;
  for(const record of note.textBoxes??[]){
    const box=el("div",{class:"ms-extend-text-box ms-extend-text","data-text-box-id":record.id,tabindex:"0",role:"button","aria-label":"留白文字框："+(record.text||"空白")});
    box.style.cssText=`left:${record.x*100}%;top:${record.y*100}%;width:${record.w*100}%;height:${record.h*100}%`;
    const content=el("div",{class:"ms-extend-text-box-content"});applyTextStyle(content,style(),scale);renderTextRuns(content,record.runs?.length?record.runs:[{text:record.text,style:style()}],scale);box.append(content);
    const menu=el("div",{class:"ms-extend-image-menu",role:"toolbar","aria-label":"文字框操作"});
    const copy=el("button",{"aria-label":"复制留白文字框",text:"复制"});
    copy.addEventListener("click",event=>{event.stopPropagation();if(enabled())void navigator.clipboard.writeText(record.text).then(()=>movement?.copied?.()).catch(error=>new Notice("复制文字框失败："+String(error)));});menu.append(copy);
    if(movement?.cut){const cut=el("button",{"aria-label":"剪切留白文字框",text:"剪切"});cut.addEventListener("click",event=>{event.stopPropagation();if(enabled())void navigator.clipboard.writeText(record.text).then(()=>{if(movement.current())movement.cut?.(record);}).catch(error=>new Notice("剪切文字框失败："+String(error)));});menu.append(cut);}
    const trash=el("button",{"aria-label":"删除留白文字框",text:"×"});trash.addEventListener("click",event=>{event.stopPropagation();if(enabled())remove(record.id);});menu.append(trash);box.append(menu);
    box.addEventListener("click",event=>{event.stopPropagation();if(enabled()){for(const other of paper.querySelectorAll(".ms-extend-text-box.is-selected"))other.classList.remove("is-selected");box.classList.add("is-selected");box.focus({preventScroll:true});}});
    const begin=(event:PointerEvent,resize:boolean)=>{
      if(event.button!==0||!enabled()||!movement)return;
      event.preventDefault();event.stopPropagation();cancelDrag?.();box.click();
      const bounds=paper.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
      const start={x:event.clientX,y:event.clientY},pointerId=event.pointerId;let next={...record},changed=false;
      const geometry=(value:TextBox)=>{box.style.left=`${value.x*100}%`;box.style.top=`${value.y*100}%`;box.style.width=`${value.w*100}%`;box.style.height=`${value.h*100}%`;};
      const move=(event:PointerEvent)=>{if(event.pointerId!==pointerId)return;const dx=event.clientX-start.x,dy=event.clientY-start.y;if(Math.abs(dx)>2||Math.abs(dy)>2)changed=true;next=resize?{...record,w:Math.min(1-record.x,Math.max(12/bounds.width,record.w+dx/bounds.width)),h:Math.min(1-record.y,Math.max(12/bounds.height,record.h+dy/bounds.height))}:{...record,x:Math.max(0,Math.min(1-record.w,record.x+dx/bounds.width)),y:Math.max(0,Math.min(1-record.h,record.y+dy/bounds.height))};geometry(next);};
      const cleanup=()=>{window.removeEventListener("pointermove",move,true);window.removeEventListener("pointerup",up,true);window.removeEventListener("pointercancel",cancel,true);window.removeEventListener("blur",cancel);window.removeEventListener("keydown",key,true);cancelDrag=undefined;};
      const cancel=()=>{cleanup();geometry(record);};const key=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();cancel();}};
      const up=(event:PointerEvent)=>{
        if(event.pointerId!==pointerId)return;
        cleanup();
        if(!changed||!movement.current()){geometry(record);return;}
        const records=movement.latest();
        const current=records.find(value=>value.id===record.id);
        if(JSON.stringify(current)!==JSON.stringify(record)){
          if(current)geometry(current);
          new Notice("留白文字框已在其他窗口更新，请重新操作");return;
        }
        void movement.save(records.map(value=>value.id===record.id?next:value)).catch(error=>{
          const current=movement.current()&&movement.latest().find(value=>value.id===record.id);
          if(current)geometry(current);
          new Notice(String(error));
        });
      };
      cancelDrag=cancel;window.addEventListener("pointermove",move,true);window.addEventListener("pointerup",up,true);window.addEventListener("pointercancel",cancel,true);window.addEventListener("blur",cancel);window.addEventListener("keydown",key,true);
    };
    box.addEventListener("pointerdown",event=>{if(!(event.target as Element).closest("button,[contenteditable],input,textarea"))begin(event,false);});
    if(movement){const grip=el("button",{class:"ms-extend-text-box-resize","aria-label":"调整留白文字框大小",title:"调整留白文字框大小"});grip.addEventListener("pointerdown",event=>begin(event,true));grip.addEventListener("dblclick",event=>event.stopPropagation());box.append(grip);}
    box.addEventListener("dblclick",event=>{event.stopPropagation();if(enabled())edit(record.id);});
    box.addEventListener("copy",event=>{if(!enabled()||event.target!==box||!event.clipboardData)return;event.preventDefault();event.stopPropagation();event.clipboardData.setData("text/plain",record.text);movement?.copied?.();});
    box.addEventListener("cut",event=>{if(!enabled()||event.target!==box||!event.clipboardData||!movement?.cut)return;event.preventDefault();event.stopPropagation();event.clipboardData.setData("text/plain",record.text);movement.cut(record);});
    box.addEventListener("keydown",event=>{if(!enabled()||event.target!==box)return;if(event.key==="Enter"){event.preventDefault();edit(record.id);}else if(event.key==="Delete"||event.key==="Backspace"){event.preventDefault();event.stopPropagation();remove(record.id);}else if(event.key==="Escape"){event.preventDefault();box.classList.remove("is-selected");}});
    paper.append(box);
  }
  return ()=>cancelDrag?.();
}

/** Fit actual runs to the available paper, without changing images or other text boxes. */
export function fitExtendTextBox(record: TextBox, width:number, height:number): TextBox {
  const measure=el("div",{class:"ms-extend-text"});measure.style.cssText=`position:fixed;left:-100000px;top:0;width:max-content;max-width:${Math.max(1,(1-record.x)*width)}px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.3;padding:0`;
  applyTextStyle(measure,style());renderTextRuns(measure,record.runs?.length?record.runs:[{text:record.text,style:style()}]);document.body.append(measure);
  try{const bounds=measure.getBoundingClientRect();return {...record,w:Math.min(1-record.x,Math.max(8,bounds.width+2)/width),h:Math.min(1-record.y,Math.max(20,bounds.height+2)/height)};}finally{measure.remove();}
}

export async function extendTextBoxPng(note: PdfExtendNote, record: TextBox, width:number): Promise<Uint8Array> {
  const annotation:Annotation={id:record.id,docPath:"",docKind:"pdf",page:1,type:"note",rects:[],text:record.text,color:"#111111",createdAt:note.createdAt,overlay:{kind:"text",fontSize:16,textRuns:record.runs}};
  return overlayPng(annotation,Math.max(1,record.w*width),Math.max(1,record.h*note.height),"ms-extend-text");
}
export async function paintExtendTextBoxes(context:CanvasRenderingContext2D,note:PdfExtendNote,width:number,offset=0):Promise<void>{
  for(const record of note.textBoxes??[]){const png=await extendTextBoxPng(note,record,width),image=await createImageBitmap(new Blob([new Uint8Array(png).buffer],{type:"image/png"}));try{context.drawImage(image,record.x*width,offset+record.y*note.height,record.w*width,record.h*note.height);}finally{image.close();}}
}
