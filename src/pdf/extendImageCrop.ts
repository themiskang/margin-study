import { Notice, setIcon } from "obsidian";
import type { PdfCrop, PdfExtendNote } from "../types";
import { el } from "../utils/dom";
import { createModal } from "../utils/modal";

type NoteImage = NonNullable<PdfExtendNote["images"]>[number];
const full = (): PdfCrop => ({left:0,top:0,right:1,bottom:1});

/** Each invocation starts from the committed image. History retains earlier pixels. */
export function openExtendImageCrop(image: NoteImage, paper: HTMLElement, commit:(patch:Partial<NoteImage>)=>Promise<void>):()=>void {
  const original={source:image.src,crop:full(),rotation:0 as 0|90|180|270,w:image.w,h:image.h};
  let crop={...original.crop},rotation=original.rotation,closed=false,moving:(()=>void)|undefined,ready=false,busy=false;
  const previousFocus=document.activeElement as HTMLElement|null;
  const {bg,modal,close}=createModal("",()=>{if(closed)return;closed=true;moving?.();observer.disconnect();pixels.width=pixels.height=0;if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});});
  bg.classList.add("ms-image-crop-bg");modal.classList.add("ms-image-crop-modal");modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");modal.setAttribute("aria-label","图片裁剪");
  const header=el("header"),cancel=el("button",{text:"Cancel","aria-label":"Cancel"}),done=el("button",{text:"Done","aria-label":"Done"});header.append(cancel,done);
  const controls=el("div",{class:"ms-image-crop-controls",role:"toolbar","aria-label":"裁剪操作"});
  const action=(label:string,icon:string,run:()=>void)=>{const button=el("button",{"aria-label":label,title:label});setIcon(button,icon);button.addEventListener("click",()=>{if(ready&&!busy){moving?.();run();paint();}});controls.append(button);return button;};
  const stage=el("div",{class:"ms-image-crop-stage"}),preview=el("canvas",{"aria-label":"原始图片预览"}) as HTMLCanvasElement,pixels=document.createElement("canvas"),selection=el("div",{class:"ms-image-crop-selection"});stage.append(preview,selection);modal.replaceChildren(header,controls,stage);
  const rotate=(direction:number)=>{rotation=((rotation+direction+360)%360) as typeof rotation;crop=direction>0?{left:1-crop.bottom,top:crop.left,right:1-crop.top,bottom:crop.right}:{left:crop.top,top:1-crop.right,right:crop.bottom,bottom:1-crop.left};draw();};
  action("rotate left","rotate-ccw",()=>rotate(-90));
  const reset=action("Reset","rotate-ccw-square",()=>{rotation=0;crop=full();ratio.value="free";draw();});
  const ratio=el("select",{"aria-label":"裁剪比例"}) as HTMLSelectElement;
  for(const [value,label] of [["free","Freeform"],["original","Original"],["1","Square"],["1.3333333333333333","4:3"],["1.7777777777777777","16:9"]])ratio.append(el("option",{value,text:label}));
  controls.append(ratio);action("rotate right","rotate-cw",()=>rotate(90));
  let paperBounds={left:0,top:0,width:1,height:1};
  const changed=()=>rotation!==0||JSON.stringify(crop)!==JSON.stringify(full());
  const paint=()=>{
    if(closed)return;const fit=Math.min(Math.max(1,stage.clientWidth-32)/Math.max(1,pixels.width),Math.max(1,stage.clientHeight-32)/Math.max(1,pixels.height));
    paperBounds={width:pixels.width*fit,height:pixels.height*fit,left:(stage.clientWidth-pixels.width*fit)/2,top:(stage.clientHeight-pixels.height*fit)/2};
    Object.assign(preview.style,{left:`${paperBounds.left}px`,top:`${paperBounds.top}px`,width:`${paperBounds.width}px`,height:`${paperBounds.height}px`});
    Object.assign(selection.style,{left:`${paperBounds.left+crop.left*paperBounds.width}px`,top:`${paperBounds.top+crop.top*paperBounds.height}px`,width:`${(crop.right-crop.left)*paperBounds.width}px`,height:`${(crop.bottom-crop.top)*paperBounds.height}px`});
    reset.disabled=!ready||!changed()||busy;done.disabled=!ready||busy;ratio.disabled=!ready||busy;
  };
  const source=new Image();
  const draw=()=>{
    const swap=rotation===90||rotation===270;pixels.width=swap?source.naturalHeight:source.naturalWidth;pixels.height=swap?source.naturalWidth:source.naturalHeight;
    const context=pixels.getContext("2d")!;context.translate(pixels.width/2,pixels.height/2);context.rotate(rotation*Math.PI/180);context.drawImage(source,-source.naturalWidth/2,-source.naturalHeight/2);
    preview.width=pixels.width;preview.height=pixels.height;preview.getContext("2d")!.drawImage(pixels,0,0);paint();
  };
  const applyRatio=()=>{
    if(ratio.value==="free")return;const aspect=ratio.value==="original"?pixels.width/pixels.height:Number(ratio.value),normalized=aspect*pixels.height/pixels.width;
    let w=crop.right-crop.left,h=crop.bottom-crop.top;if(w/h>normalized)w=h*normalized;else h=w/normalized;const x=(crop.left+crop.right)/2,y=(crop.top+crop.bottom)/2;crop={left:x-w/2,top:y-h/2,right:x+w/2,bottom:y+h/2};
  };
  ratio.addEventListener("change",()=>{moving?.();applyRatio();paint();});
  const adjust=(start:PdfCrop,edges:(keyof PdfCrop)[],dx:number,dy:number)=>{
    crop={...start};const minimumX=Math.min(.01,1/Math.max(1,pixels.width)),minimumY=Math.min(.01,1/Math.max(1,pixels.height));
    for(const edge of edges){const value=start[edge]+(edge==="left"||edge==="right"?dx:dy);crop[edge]=edge==="left"?Math.max(0,Math.min(start.right-minimumX,value)):edge==="right"?Math.min(1,Math.max(start.left+minimumX,value)):edge==="top"?Math.max(0,Math.min(start.bottom-minimumY,value)):Math.min(1,Math.max(start.top+minimumY,value));}
    applyRatio();paint();
  };
  const handles:[string,number,number,(keyof PdfCrop)[]][]=[["左上边界",0,0,["left","top"]],["上边界",.5,0,["top"]],["右上边界",1,0,["right","top"]],["右边界",1,.5,["right"]],["右下边界",1,1,["right","bottom"]],["下边界",.5,1,["bottom"]],["左下边界",0,1,["left","bottom"]],["左边界",0,.5,["left"]]];
  for(const [label,x,y,edges] of handles){
    const handle=el("button",{class:"ms-image-crop-handle","aria-label":"裁剪"+label});Object.assign(handle.style,{left:`${x*100}%`,top:`${y*100}%`,cursor:edges.length===1?(x===.5?"ns-resize":"ew-resize"):x===y?"nwse-resize":"nesw-resize"});selection.append(handle);
    handle.addEventListener("pointerdown",event=>{if(event.button!==0||!ready||busy)return;event.preventDefault();event.stopPropagation();moving?.();const start={...crop},point={x:event.clientX,y:event.clientY},id=event.pointerId;
      const move=(event:PointerEvent)=>{if(event.pointerId===id)adjust(start,edges,(event.clientX-point.x)/paperBounds.width,(event.clientY-point.y)/paperBounds.height);};
      const cleanup=()=>{window.removeEventListener("pointermove",move,true);window.removeEventListener("pointerup",up,true);window.removeEventListener("pointercancel",abort,true);window.removeEventListener("blur",abort);moving=undefined;};
      const abort=()=>{crop=start;cleanup();paint();};const up=(event:PointerEvent)=>{if(event.pointerId===id)cleanup();};moving=abort;window.addEventListener("pointermove",move,true);window.addEventListener("pointerup",up,true);window.addEventListener("pointercancel",abort,true);window.addEventListener("blur",abort);
    });
    handle.addEventListener("keydown",event=>{if(!ready||busy||!event.key.startsWith("Arrow"))return;event.preventDefault();const step=event.shiftKey?.05:.01;adjust(crop,edges,event.key==="ArrowLeft"?-step:event.key==="ArrowRight"?step:0,event.key==="ArrowUp"?-step:event.key==="ArrowDown"?step:0);});
  }
  cancel.addEventListener("click",()=>{if(!busy)close();});
  done.addEventListener("click",async()=>{
    if(!ready||busy||closed)return;moving?.();if(rotation===original.rotation&&JSON.stringify(crop)===JSON.stringify(original.crop)){close();return;}busy=true;paint();
    const output=document.createElement("canvas");
    try{const left=Math.round(crop.left*pixels.width),top=Math.round(crop.top*pixels.height);output.width=Math.max(1,Math.round(crop.right*pixels.width)-left);output.height=Math.max(1,Math.round(crop.bottom*pixels.height)-top);output.getContext("2d")!.drawImage(pixels,left,top,output.width,output.height,0,0,output.width,output.height);
      const bounds=paper.getBoundingClientRect(),swap=rotation===90||rotation===270;let w=(swap?original.h*bounds.height/bounds.width:original.w)*(crop.right-crop.left),h=(swap?original.w*bounds.width/bounds.height:original.h)*(crop.bottom-crop.top);const fit=Math.min(1,(1-image.x)/w,(1-image.y)/h);w*=fit;h*=fit;
      await commit({src:output.toDataURL("image/png"),w,h,edit:undefined});close();
    }catch(error){if(!closed){busy=false;paint();new Notice("图片裁剪未保存："+String(error));}}finally{output.width=output.height=0;}
  });
  const observer=new ResizeObserver(()=>{if(!moving)paint();});observer.observe(stage);source.src=original.source;done.disabled=true;reset.disabled=true;
  void source.decode().then(()=>{if(closed)return;ready=true;draw();done.focus();}).catch(error=>{if(!closed){new Notice("图片预览未加载："+String(error));close();}});
  return close;
}
