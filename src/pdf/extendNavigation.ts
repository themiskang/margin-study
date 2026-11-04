import type { ReaderView } from "./readerView";
import { regionFoldBands, foldCoordinates } from "./regionFolds";
import type { Annotation, PdfDisplayPage } from "../types";
import { overlayPng } from "./exportAnnotations";
import { extendExportText } from "./extendText";

/** Display-only segments. Physical PDF page numbers and canonical anchors never change. */
export function extendDisplayPages(reader: ReaderView): PdfDisplayPage[] {
  const entries:PdfDisplayPage[]=[];
  for(const page of reader.getPageNumbers()){
    const base=reader.getPageBaseSize(page),gaps=reader.getExtendGaps(page,base);let top=0;
    const append=(start:number,height:number,noteId?:string)=>{if(height>.001)entries.push({number:entries.length+1,page,top:start,height,...(noteId?{noteId}:{})});};
    for(const gap of gaps){append(top,gap.top-top);append(gap.top,gap.height,gap.note.id);top=gap.top+gap.height;}
    append(top,foldCoordinates(regionFoldBands(reader,page,base)).down(base.height)+gaps.reduce((sum,gap)=>sum+gap.height,0)-top);
  }
  return entries;
}
export async function renderExtendThumbnail(reader: ReaderView, number:number, canvas:HTMLCanvasElement):Promise<void>{
  const entry=reader.getDisplayPages().find(entry=>entry.number===number);if(!entry)return;
  const base=reader.getPageBaseSize(entry.page),ratio=220/base.width,path=reader.getFilePath(),notebook=reader.getDocumentNotebookId();
  const current=()=>{if(reader.getFilePath()!==path||reader.getDocumentNotebookId()!==notebook)throw new Error("文档已变化");};
  canvas.width=220;canvas.height=Math.max(1,Math.ceil(entry.height*ratio-1e-7));const context=canvas.getContext("2d");if(!context)return;context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);
  if(!entry.noteId){await reader.renderPage(entry.page);current();const record=reader.getPageRecord(entry.page);if(!record?.canvas.width)return;const scale=record.canvas.width/base.width;context.drawImage(record.canvas,0,entry.top*scale,record.canvas.width,entry.height*scale,0,0,canvas.width,canvas.height);return;}
  const note=reader.getExtendNotes().find(note=>note.id===entry.noteId);if(!note)return;
  if(note.text){const annotation:Annotation={id:note.id,docPath:path!,docKind:"pdf",page:entry.page,type:"note",rects:[],text:note.text,color:"#111111",createdAt:note.createdAt,overlay:extendExportText(note)};
    const png=await overlayPng(annotation,Math.max(1,base.width*.94-32),entry.height,"ms-extend-text"),image=await createImageBitmap(new Blob([new Uint8Array(png).buffer],{type:"image/png"}));try{current();context.drawImage(image,canvas.width*.06,0,(base.width*.94-32)*ratio,canvas.height);}finally{image.close();}}
  for(const record of note.images??[]){const image=new Image();image.src=record.src;await image.decode();current();const width=record.w*canvas.width,height=record.h*canvas.height,fit=Math.min(width/image.width,height/image.height),w=image.width*fit,h=image.height*fit;context.drawImage(image,record.x*canvas.width+(width-w)/2,record.y*canvas.height+(height-h)/2,w,h);}
  for(const record of note.ink??[]){context.strokeStyle=record.color;context.lineWidth=(record.brush==="highlight"?16:3)*ratio;context.globalAlpha=record.brush==="highlight"?.32:1;context.lineCap="round";for(const stroke of record.strokes){context.beginPath();stroke.forEach((point,index)=>{const x=point.x*canvas.width,y=point.y*canvas.height;if(index)context.lineTo(x,y);else context.moveTo(x,y);});context.stroke();}}context.globalAlpha=1;
}
