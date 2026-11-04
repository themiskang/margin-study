import type { Annotation, PdfExtendNote } from "../types";

import { paintExtendTextBoxes } from "./extendTextBoxes";
import { overlayPng } from "./exportAnnotations";

/** A derived card preview. The editable strokes and image geometry remain in the note. */
export async function extendMediaImage(note: PdfExtendNote, width: number, composed = false): Promise<string | undefined> {
  if (!note.images?.length && !note.textBoxes?.length && !note.ink?.some(record => record.strokes.some(stroke => stroke.length))) return;
  const height = note.height, scale = Math.min(2, Math.sqrt(16_000_000 / (width * height)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width * scale)); canvas.height = Math.max(1, Math.ceil(height * scale));
  const context = canvas.getContext("2d")!;
  context.scale(scale, scale); context.fillStyle = "#fff"; context.fillRect(0, 0, width, height);
  try {
    for (const record of note.images ?? []) {
      const image = new Image(); image.src = record.src; await image.decode();
      const w = record.w * width, h = record.h * height, fit = Math.min(w / image.width, h / image.height);
      context.drawImage(image, record.x * width + (w - image.width * fit) / 2, record.y * height + (h - image.height * fit) / 2, image.width * fit, image.height * fit);
    }
    if(composed&&note.text){const annotation:Annotation={id:note.id,docPath:"",docKind:"pdf",page:1,type:"note",rects:[],text:note.text,color:"#111111",createdAt:note.createdAt,overlay:{kind:"text",fontSize:16,textRuns:note.runs}};const png=await overlayPng(annotation,Math.max(1,width*.94-32),height,"ms-extend-text"),image=await createImageBitmap(new Blob([new Uint8Array(png).buffer],{type:"image/png"}));try{context.drawImage(image,width*.06,0,Math.max(1,width*.94-32),height);}finally{image.close();}}
    await paintExtendTextBoxes(context,note,width);
    for (const record of note.ink ?? []) {
      context.strokeStyle = record.color; context.lineWidth = record.brush === "highlight" ? 16 : 3;
      context.globalAlpha = record.brush === "highlight" ? .32 : 1; context.lineCap = "round"; context.lineJoin = "round";
      for (const stroke of record.strokes) {
        context.beginPath(); stroke.forEach((point, index) => {
          if (index) context.lineTo(point.x * width, point.y * height); else context.moveTo(point.x * width, point.y * height);
        }); context.stroke();
      }
    }
    return canvas.toDataURL("image/png");
  } finally { canvas.width = canvas.height = 0; }
}
