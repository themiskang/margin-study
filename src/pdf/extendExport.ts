/**
 * [INPUT]: PDF 页面、留白笔记和笔迹默认颜色。
 * [OUTPUT]: 展开留白的 PDF 导出。
 * [POS]: PDF 导出中的留白页面合成层。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { INK_DEFAULT_COLOR } from "../annot/pen";
import { clip, degrees, endPath, LineCapStyle, PDFDocument, PDFPage, popGraphicsState, pushGraphicsState, rectangle, rgb } from "pdf-lib";
import type { Annotation, Card, PdfExtendNote } from "../types";
import type { ReaderView } from "./readerView";
import { projectPagePoint } from "./pageCrop";
import { overlayPng } from "./exportAnnotations";
import { extendExportText } from "./extendText";
import { extendTextFromCard } from "./extendCardText";
import { annotationTextRuns, annotationTextStyle, applyTextStyle, renderTextRuns } from "../annot/textRuns";
import { extendTextBoxPng, paintExtendTextBoxes } from "./extendTextBoxes";
import { imageUrl, cardImages } from "../review/content";
import { cardCommentItems } from "../cards/commentOrder";

/** Export every note expanded. The source bands remain embedded vector PDF content. */
export async function exportExtendPage(output: PDFDocument, source: PDFPage, reader: ReaderView, number: number, viewport: any, notes: PdfExtendNote[], current: () => void): Promise<void> {
  const entries = notes.map(note=>({note,y:projectPagePoint(note.anchor,reader.getPageCrop(),reader.getPdfPageRotation(number)).y*viewport.height}))
    .filter(entry=>entry.y>=0&&entry.y<=viewport.height).sort((a,b)=>a.y-b.y||a.note.id.localeCompare(b.note.id));
  if (!entries.length) return;
  const [left,bottom,right,top] = viewport.viewBox, embedded = await output.embedPage(source,{left,bottom,right,top}); current();
  output.removePage(output.getPageCount()-1);
  const added = entries.reduce((sum,entry)=>sum+entry.note.height,0), height=viewport.height+added, page=output.addPage([viewport.width,height]);
  const rotation=((viewport.rotation%360)+360)%360, x=rotation===180||rotation===270?viewport.width:0, y=rotation===90||rotation===180?viewport.height:0;
  let start=0, offset=0;
  for (const entry of [...entries,{y:viewport.height,note:null}]) {
    if (entry.y>start) {
      page.pushOperators(pushGraphicsState(),rectangle(0,height-entry.y-offset,viewport.width,entry.y-start),clip(),endPath());
      page.drawPage(embedded,{x,y:y+added-offset,rotate:degrees(-rotation)}); page.pushOperators(popGraphicsState());
    }
    if (entry.note) {
      const note=entry.note,noteTop=entry.y+offset, width=viewport.width;
    for(const record of note.images??[]){
        const bytes=Uint8Array.from(atob(record.src.split(",")[1]),char=>char.charCodeAt(0));
        const image=record.src.startsWith("data:image/jpeg")?await output.embedJpg(bytes):await output.embedPng(bytes);current();
        const boxW=record.w*width,boxH=record.h*note.height,ratio=Math.min(boxW/image.width,boxH/image.height),w=image.width*ratio,h=image.height*ratio;
        page.drawImage(image,{x:record.x*width+(boxW-w)/2,y:height-noteTop-record.y*note.height-(boxH+h)/2,width:w,height:h});
      }
      if (note.text) {
        const annotation:Annotation={id:note.id,docPath:reader.getFilePath()!,docKind:"pdf",page:number,type:"note",rects:[],text:note.text,color:"#111111",createdAt:note.createdAt,overlay:extendExportText(note)};
        const png=await overlayPng(annotation,Math.max(1,width*.94-32),note.height,"ms-extend-text");current();const image=await output.embedPng(png);current();
        page.drawImage(image,{x:width*.06,y:height-noteTop-note.height,width:width*.94-32,height:note.height});
      }
      for(const record of note.textBoxes??[]){const png=await extendTextBoxPng(note,record,width);current();const image=await output.embedPng(png);current();page.drawImage(image,{x:record.x*width,y:height-noteTop-(record.y+record.h)*note.height,width:record.w*width,height:record.h*note.height});}
      for (const ink of note.ink??[]) {
        const hex=/^#[0-9a-f]{6}$/i.test(ink.color)?ink.color:"#111111", color=rgb(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);
        for (const stroke of ink.strokes) {
          const points=stroke.map(point=>({x:point.x*width,y:height-noteTop-point.y*note.height}));
          for(let index=1;index<points.length;index++)page.drawLine({start:points[index-1],end:points[index],thickness:ink.brush==="highlight"?16:stroke[index].pressure===undefined?3:.8+5*((stroke[index-1].pressure??.5)+(stroke[index].pressure??.5))/2,color,opacity:ink.brush==="highlight"?.32:1,lineCap:LineCapStyle.Round});
        }
      }
      offset+=note.height;
    }
    start=entry.y;
  }
}

/** Measure using the same runs and wrapping as the exported text, at its saved nominal size. */
async function cardTextHeight(annotation: Annotation, width: number, current: () => void): Promise<number> {
  const measure=document.createElement("div");measure.className="ms-extend-text";measure.style.cssText=`position:fixed;left:-100000px;top:0;width:${Math.max(1,width-2)}px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.3`;
  applyTextStyle(measure,annotationTextStyle(annotation));renderTextRuns(measure,annotationTextRuns(annotation));document.body.append(measure);
  try{await document.fonts.ready;current();return Math.max(24,Math.ceil(measure.getBoundingClientRect().height)+2);}finally{measure.remove();}
}

/** Explicit comment order is a display projection, never a rewrite of source pixels or Reader records. */
async function exportOrderedCard(reader:ReaderView,card:Card,width:number,format:"pdf"|"png",current:()=>void):Promise<Uint8Array>{
  const comments=cardCommentItems(card),commentImages=new Set(comments.flatMap(item=>item.image?[item.image]:[]));
  const composed=card.extendMedia?.some(item=>item.noteId===card.anchorAnnId&&item.composed);
  const blocks=[...(!composed&&card.front.trim()?[{text:card.front}]:[]),...cardImages(card).filter(image=>!commentImages.has(image)).map(image=>({image})),...comments];
  const contentWidth=Math.max(1,width*.94-32),rendered:{image:HTMLImageElement;height:number}[]=[];let height=0;
  for(const block of blocks){
    let src:string,h:number;
    if("text" in block&&block.text){const text=extendTextFromCard(block.text),annotation:Annotation={id:card.id,docPath:card.docPath,docKind:"pdf",page:card.page??1,type:"note",rects:[],text:text.text,color:"#111111",createdAt:card.createdAt,overlay:{kind:"text",fontSize:card.typography?.fontSize??16,textRuns:text.runs}};h=await cardTextHeight(annotation,contentWidth,current);const png=await overlayPng(annotation,contentWidth,h,"ms-extend-text");src="data:image/png;base64,"+btoa(Array.from(png,byte=>String.fromCharCode(byte)).join(""));}
    else if("image" in block&&block.image){src=imageUrl(reader.plugin,block.image);h=0;}else continue;
    const image=new Image();image.src=src;await image.decode();current();h=h||contentWidth*image.height/image.width;rendered.push({image,height:h});height+=h+(rendered.length>1?12:0);
  }
  height=Math.max(1,height);const scale=Math.min(2,Math.sqrt(16_000_000/(width*height))),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.ceil(width*scale));canvas.height=Math.max(1,Math.ceil(height*scale));
  try{const ctx=canvas.getContext("2d")!;ctx.scale(scale,scale);ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height);let top=0;for(const item of rendered){ctx.drawImage(item.image,width*.06,top,contentWidth,item.height);top+=item.height+12;}current();const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("留白无法编码")),"image/png")),bytes=new Uint8Array(await blob.arrayBuffer());current();if(format==="png")return bytes;const output=await PDFDocument.create(),image=await output.embedPng(bytes);output.addPage([width,height]).drawImage(image,{x:0,y:0,width,height});current();return output.save();}finally{canvas.width=canvas.height=0;}
}

/** A card export contains the saved paper content, without editing handles or host chrome. */
export async function exportExtendCard(reader: ReaderView, id: string, format: "pdf"|"png"): Promise<Uint8Array> {
  await reader.finishExtendEditing();
  const path=reader.getFilePath(),notebook=reader.getDocumentNotebookId(),note=reader.getExtendNotes().find(note=>note.id===id);
  if(!note)throw new Error("留白不存在");
  const current=()=>{if(reader.getFilePath()!==path||reader.getDocumentNotebookId()!==notebook)throw new Error("文档已变化，导出已取消");};
  const page=(reader.getPdfPageEdits()?.pages.findIndex(page=>page.id===note.pageId)??-1)+1;
  const card=reader.plugin.store.cards.find(card=>!card.hidden&&!card.groupId&&card.docPath===path&&card.anchorAnnId===(note.sourceAnnId??id)&&(card.documentNotebookId??"default")===notebook);
  if(card?.commentOrder)return exportOrderedCard(reader,card,reader.getPageBaseSize(page).width,format,current);
  // MN4's standalone text card uses a 600-point frame, rather than unused PDF paper.
  // Keep source excerpts and mixed comments on their existing composition geometry.
  const plainCard=!note.sourceAnnId&&!!note.text.trim()&&!note.images?.length&&!note.textBoxes?.length&&!note.ink?.some(record=>record.strokes.length)&&!card?.back?.trim()&&!card?.commentMedia?.length;
  const width=plainCard?600:reader.getPageBaseSize(page).width;
  // A source-card export starts with its excerpt; comments follow without repeating the preview.
  let sourceText:Annotation|undefined,sourceHeight=0;
  if(note.sourceAnnId&&card&&!card.image){const text=extendTextFromCard(card.front);sourceText={id:card.id,docPath:path!,docKind:"pdf",page,type:"note",rects:[],text:text.text,color:"#111111",createdAt:card.createdAt,overlay:{kind:"text",fontSize:16,textRuns:text.runs}};}
  const contentWidth=plainCard?522:Math.max(1,width*.94-32),comments:{image:HTMLImageElement;y:number;height:number}[]=[];
  const annotation:Annotation={id:note.id,docPath:path!,docKind:"pdf",page,type:"note",rects:[],text:note.text,color:"#111111",createdAt:note.createdAt,overlay:{kind:"text",fontSize:16,textRuns:note.runs}};
  const paperHeight=plainCard?await cardTextHeight(annotation,contentWidth,current)+6:note.text&&!note.images?.length&&!note.textBoxes?.length&&!note.ink?.length?Math.max(note.height,await cardTextHeight(annotation,contentWidth,current)):note.height;
  let sourceImage:HTMLImageElement|undefined;
  if(note.sourceAnnId&&card?.image){sourceImage=new Image();sourceImage.src=imageUrl(reader.plugin,card.image);await sourceImage.decode();current();sourceHeight=contentWidth*sourceImage.height/sourceImage.width+12;}
  else if(sourceText)sourceHeight=await cardTextHeight(sourceText,contentWidth,current)+12;
  const excerptHeight=sourceHeight;
  // Separate text identity does not determine display order: the confirmed
  // source compositions precede their independent card text, as in the card view.
  const imageOnly=!!note.sourceAnnId&&!note.text.trim()&&!!note.images?.length&&!note.textBoxes?.length&&!note.ink?.length;
  const positionedInk=!!note.sourceAnnId&&!note.text.trim()&&!!note.textBoxes?.length&&!!note.ink?.length;
  const independentBeforePaper=note.separateCardText&&!imageOnly&&!positionedInk;
  let independentText:Annotation|undefined,independentHeight=0;
  if(independentBeforePaper&&card?.back?.trim()){
    const text=extendTextFromCard(card.back);independentText={id:card.id,docPath:path!,docKind:"pdf",page,type:"note",rects:[],text:text.text,color:"#111111",createdAt:card.createdAt,overlay:{kind:"text",fontSize:16,textRuns:text.runs}};
    independentHeight=await cardTextHeight(independentText,contentWidth,current);sourceHeight+=independentHeight+12;
  }
  let height=sourceHeight+paperHeight;
  const append=async(src:string,blockHeight?:number)=>{const image=new Image();image.src=src;await image.decode();current();const h=blockHeight??contentWidth*image.height/image.width;comments.push({image,y:height+12,height:h});height+=12+h;};
  if(!independentBeforePaper&&(!note.sourceAnnId||!note.text.trim()&&(!!note.images?.length||!!note.textBoxes?.length||!!note.ink?.some(record=>record.strokes.length)))&&card?.back?.trim()){
    const text=extendTextFromCard(card.back),comment:Annotation={id:card.id,docPath:path!,docKind:"pdf",page,type:"note",rects:[],text:text.text,color:"#111111",createdAt:card.createdAt,overlay:{kind:"text",fontSize:16,textRuns:text.runs}};
    const textHeight=await cardTextHeight(comment,contentWidth,current),png=await overlayPng(comment,contentWidth,textHeight,"ms-extend-text");
    await append("data:image/png;base64,"+btoa(Array.from(png,byte=>String.fromCharCode(byte)).join("")),textHeight);
  }
  for(const media of card?.commentMedia??[])await append(imageUrl(reader.plugin,media.image));
  const scale=Math.min(2,Math.sqrt(16_000_000/(width*height))),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.ceil(width*scale));canvas.height=Math.max(1,Math.ceil(height*scale));
  const context=canvas.getContext("2d")!;context.scale(scale,scale);context.fillStyle="#fff";context.fillRect(0,0,width,height);
  try {
    if(sourceImage)context.drawImage(sourceImage,width*.06,0,contentWidth,excerptHeight-12);
    if(sourceText){const png=await overlayPng(sourceText,contentWidth,excerptHeight-12),image=await createImageBitmap(new Blob([new Uint8Array(png).buffer],{type:"image/png"}));try{current();context.drawImage(image,width*.06,0,contentWidth,excerptHeight-12);}finally{image.close();}}
    if(independentText){const png=await overlayPng(independentText,contentWidth,independentHeight,"ms-extend-text"),image=await createImageBitmap(new Blob([new Uint8Array(png).buffer],{type:"image/png"}));try{current();context.drawImage(image,width*.06,excerptHeight,contentWidth,independentHeight);}finally{image.close();}}
    for(const record of note.images??[]){const image=new Image();image.src=record.src;await image.decode();current();const w=record.w*width,h=record.h*note.height,fit=Math.min(w/image.width,h/image.height);context.drawImage(image,record.x*width+(w-image.width*fit)/2,sourceHeight+record.y*note.height+(h-image.height*fit)/2,image.width*fit,image.height*fit);}
    if(note.text){const textHeight=paperHeight-(plainCard?4:0),png=await overlayPng(annotation,contentWidth,textHeight,"ms-extend-text"),image=await createImageBitmap(new Blob([new Uint8Array(png).buffer],{type:"image/png"}));try{current();context.drawImage(image,plainCard?39:width*.06,sourceHeight+(plainCard?4:0),contentWidth,textHeight);}finally{image.close();}}
    await paintExtendTextBoxes(context,note,width,sourceHeight);current();
    for(const record of note.ink??[]){context.strokeStyle=record.color??INK_DEFAULT_COLOR;context.lineWidth=record.brush==="highlight"?16:3;context.globalAlpha=record.brush==="highlight"?.32:1;context.lineCap="round";context.lineJoin="round";
      for(const stroke of record.strokes){context.beginPath();stroke.forEach((point,index)=>{if(index)context.lineTo(point.x*width,sourceHeight+point.y*note.height);else context.moveTo(point.x*width,sourceHeight+point.y*note.height);});context.stroke();}}
    context.globalAlpha=1;for(const comment of comments)context.drawImage(comment.image,width*.06,comment.y,contentWidth,comment.height);current();const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("留白无法编码")),"image/png")),bytes=new Uint8Array(await blob.arrayBuffer());current();
    if(format==="png")return bytes;
    const output=await PDFDocument.create(),image=await output.embedPng(bytes);output.addPage([width,height]).drawImage(image,{x:0,y:0,width,height});current();return output.save();
  }finally{canvas.width=canvas.height=0;}
}
