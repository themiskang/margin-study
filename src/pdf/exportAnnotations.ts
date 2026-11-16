/**
 * [INPUT]: PDF 页面、批注几何和笔迹默认颜色。
 * [OUTPUT]: 批注图像及 PDF 扁平化导出。
 * [POS]: PDF 导出中的批注渲染入口。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { BlendMode, LineCapStyle, PDFDocument, PDFPage, concatTransformationMatrix, popGraphicsState, pushGraphicsState, rgb } from "pdf-lib";
import { INK_DEFAULT_COLOR } from "../annot/pen";
import type { Annotation, PdfRect } from "../types";
import { annotationGeometry, pdfRectToCssRect } from "../anchors/pdfGeometry";
import { annotationTextRuns, annotationTextStyle, applyTextStyle, renderTextRuns, textColor } from "../annot/textRuns";
import { projectPageInk } from "./pageCrop";
import type { PdfCrop } from "../types";

export interface PdfExportAnnotation { annotation: Annotation; opacity: number; }
const color = (value: string) => { const hex = textColor(value); return rgb(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255); };

/** Rasterize only a free text/image overlay. Source pages and ordinary marks stay vector. */
export async function overlayPng(ann: Annotation, width: number, height: number, textClass = ""): Promise<Uint8Array> {
  const root = document.createElement("div");
  root.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;overflow:hidden;box-sizing:border-box;border:1px solid transparent;color:${ann.color};background:${ann.overlay?.background ?? "transparent"}`;
  if (ann.overlay?.kind === "image") {
    if (!ann.image?.startsWith("data:image/")) throw new Error("图片批注缺少可导出的本地图像");
    const image = new Image(); image.src = ann.image; image.style.cssText="display:block;width:100%;height:100%;object-fit:contain"; root.append(image); await image.decode();
  } else {
    const text = document.createElement("div"); text.className=textClass; text.style.cssText="width:100%;height:100%;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.3";
    applyTextStyle(text,annotationTextStyle(ann)); renderTextRuns(text,annotationTextRuns(ann)); root.append(text);
  }
  document.body.append(root);
  let url = "";
  try {
    await document.fonts.ready;
    const copy = root.cloneNode(true) as HTMLElement;
    const originals = [root,...root.querySelectorAll("*")], copies = [copy,...copy.querySelectorAll("*")];
    originals.forEach((node,index) => {
      const style = getComputedStyle(node), target = copies[index] as HTMLElement;
      for (const property of Array.from(style)) target.style.setProperty(property,style.getPropertyValue(property));
      target.style.setProperty("-webkit-text-fill-color",style.color);
    });
    // Do not retain computed logical insets from the offscreen staging element.
    copy.style.cssText=`position:relative;left:0;top:0;width:${width}px;height:${height}px;overflow:hidden;box-sizing:border-box;border:1px solid transparent;color:${ann.color};background:${ann.overlay?.background ?? "transparent"}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(copy)}</foreignObject></svg>`;
    // A data URL keeps a self-contained SVG origin-clean in Chromium's image decoder.
    url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    const image = new Image(); image.src=url; await image.decode();
    const scale = Math.min(2,Math.sqrt(16_000_000/(width*height)));
    const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.ceil(width*scale));canvas.height=Math.max(1,Math.ceil(height*scale));
    try {canvas.getContext("2d")!.drawImage(image,0,0,canvas.width,canvas.height);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("批注无法编码")),"image/png"));return new Uint8Array(await blob.arrayBuffer());}
    finally {canvas.width=canvas.height=0;}
  } finally {root.remove();}
}

export async function flattenPdfAnnotations(output: PDFDocument, page: PDFPage, number: number, original: any, viewport: any, crop: PdfCrop, annotations: PdfExportAnnotation[], current: () => void, resolveImage: (path: string) => Promise<string>): Promise<void> {
  const source = original.marginStudySourcePage ?? original, base = source.getViewport({scale:1}), rotation = original.marginStudyRotation ?? 0;
  const rawRect = (rect: PdfRect, space?: Annotation["pdfCoordinateSpace"]): PdfRect => {
    if (space === "pdf") return rect;
    const a=base.convertToPdfPoint(rect.x,base.height-rect.y-rect.h),b=base.convertToPdfPoint(rect.x+rect.w,base.height-rect.y);
    return {x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),w:Math.abs(a[0]-b[0]),h:Math.abs(a[1]-b[1])};
  };
  for (const {annotation:ann,opacity} of annotations) {
    current(); const rects=annotationGeometry(ann).find(part=>part.page===number)?.rects ?? [];
    if (ann.page!==number&&!rects.length) continue;
    if (ann.overlay && !ann.overlay.deleted && rects[0]) {
      const box=pdfRectToCssRect(rawRect(rects[0],ann.pdfCoordinateSpace),viewport);if(!box)continue;
      const exportAnn = ann.overlay.kind === "image" && ann.image ? { ...ann, image: await resolveImage(ann.image) } : ann;
      const png=await overlayPng(exportAnn,box.width,box.height);current();const image=await output.embedPng(png);current();
      const radians=(ann.overlay.rotation??0)*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians),cx=box.left+box.width/2,cy=box.top+box.height/2;
      const point=(x:number,y:number)=>viewport.convertToPdfPoint(cx+x*cos-y*sin,cy+x*sin+y*cos);
      const left=point(-box.width/2,box.height/2),right=point(box.width/2,box.height/2),top=point(-box.width/2,-box.height/2);
      page.pushOperators(pushGraphicsState(),concatTransformationMatrix(right[0]-left[0],right[1]-left[1],top[0]-left[0],top[1]-left[1],left[0],left[1]));
      page.drawImage(image,{x:0,y:0,width:1,height:1,opacity});page.pushOperators(popGraphicsState());continue;
    }
    if (ann.type==="pen" && ann.strokes?.length) {
      const strokes=projectPageInk(ann.strokes,crop,rotation),highlight=ann.inkBrush==="highlight";
      const width=ann.inkWidth??(highlight?16:3),inkOpacity=ann.inkOpacity??(highlight?.32:1);
      for (const stroke of strokes) {
        const raw=stroke.map(point=>viewport.convertToPdfPoint(point.x*viewport.width,point.y*viewport.height));
        if (!raw.length)continue;
        const draw=(points:number[][],thickness:number)=>{const path=points.map((point,index)=>`${index?'L':'M'} ${point[0]} ${-point[1]}`).join(' ');page.drawSvgPath(path,{x:0,y:0,borderColor:color(ann.color ?? INK_DEFAULT_COLOR),borderWidth:thickness,borderOpacity:opacity*inkOpacity,borderLineCap:LineCapStyle.Round});};
        if (!highlight&&stroke.some(point=>point.pressure!==undefined)) {for(let index=1;index<raw.length;index++)draw([raw[index-1],raw[index]],width/3*(.8+5*((stroke[index-1].pressure??.5)+(stroke[index].pressure??.5))/2));}
        else draw(raw,width);
      } continue;
    }
    for (const rect of rects) {
      const raw=rawRect(rect,ann.pdfCoordinateSpace),box=pdfRectToCssRect(raw,viewport);if(!box)continue;
      if (ann.type==="highlight") page.drawRectangle({x:raw.x,y:raw.y,width:raw.w,height:raw.h,color:color(ann.color),opacity:opacity*.38,blendMode:BlendMode.Multiply});
      else if (ann.type==="underline"||ann.type==="strike") {
        const y=box.top+(ann.type==="underline"?box.height:box.height/2),a=viewport.convertToPdfPoint(box.left,y),b=viewport.convertToPdfPoint(box.left+box.width,y);
        page.drawLine({start:{x:a[0],y:a[1]},end:{x:b[0],y:b[1]},thickness:2,color:color(ann.color),opacity});
      } else page.drawRectangle({x:raw.x,y:raw.y,width:raw.w,height:raw.h,borderColor:color(ann.color),borderWidth:ann.type==="region"?2:1,borderDashArray:[4,3],borderOpacity:opacity,color:rgb(1,.84,.31),opacity:opacity*.18});
    }
    if (ann.type==="voice"&&ann.audioPath) {
      // Export the visible marker. Audio playback remains in the study document.
      const point=ann.pos??{x:.5,y:.5},raw=base.convertToPdfPoint(point.x*base.width,point.y*base.height);
      page.drawCircle({x:raw[0],y:raw[1],size:7,color:color(ann.color),opacity});
    }
  }
}
