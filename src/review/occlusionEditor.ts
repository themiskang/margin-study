/**
 * [INPUT]: 依赖卡片图片、Store 和学习库保存反馈。
 * [OUTPUT]: 提供图片遮挡题编辑器。
 * [POS]: 以图片相对坐标编辑遮挡，并将修改交给 Store。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type MarginStudyPlugin from "../main";
import type { Card } from "../types";
import type { ImageOcclusion } from "./contracts";
import { el } from "../utils/dom";
import { createModal } from "../utils/modal";
import { Notice } from "obsidian";
import { saveFeedback } from "../model/saveFeedback";
import { cardImages, imageUrl } from "./content";

type Tool = "rectangle" | "free" | "adjust";
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const uid = () => `mask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Edit image masks in normalized source-image coordinates so geometry survives display resizing. */
export function openOcclusionEditor(plugin: MarginStudyPlugin, card: Card, onChanged?: () => void): void {
  const source = plugin.store.getCard(card.id) ?? card;
  const images = cardImages(source);
  if (!images.length) { new Notice("卡片没有图片"); return; }
  let masks: ImageOcclusion[] = structuredClone(source.occlusions ?? []);
  let tool: Tool = "rectangle", selected = 0;
  let drag: { start: {x:number;y:number}; current: {x:number;y:number}; path?: {x:number;y:number}[]; kind: "draw"|"move"|"resize"|"vertex"; index?:number; origin?: ImageOcclusion } | null = null;
  const { modal, close } = createModal("创建 / 编辑图片遮挡");
  modal.style.maxWidth = "min(920px, 94vw)";
  const help = el("p", { class:"ms-muted", text:"拖动创建矩形或自由形状；调整模式可移动遮挡、拖动顶点或调整矩形大小。保存后遮挡题独立进入复习。" });
  const tools = el("div", { class:"ms-modal-actions" });
  const toolButtons: [Tool,string][] = [["rectangle","矩形遮挡"],["free","自由形状遮挡"],["adjust","调整遮挡"]];
  for (const [mode,label] of toolButtons) { const b=el("button",{class:"ms-btn",text:label}) as HTMLButtonElement; b.addEventListener("click",()=>{tool=mode; draw();}); tools.append(b); }
  const labelInput = el("input", { class:"ms-input", placeholder:"遮挡名称（可选）", style:"width:100%;margin:8px 0" }) as HTMLInputElement;
  const frame = el("div", { class:"ms-occlusion-frame", style:"position:relative;width:100%;max-height:65vh;overflow:auto;text-align:center;background:#111" });
  const canvas = el("div", { style:"position:relative;display:inline-block;max-width:100%;vertical-align:top" });
  const img = el("img", { src:imageUrl(plugin, images[0]), style:"display:block;max-width:100%;max-height:65vh;width:auto;height:auto;margin:auto;user-select:none" }) as HTMLImageElement;
  const layer = el("div", { "data-occlusion-overlay":"", style:"position:absolute;inset:0;touch-action:none;cursor:crosshair" });
  canvas.append(img,layer); frame.append(canvas); modal.append(help,tools,labelInput,frame);
  const actions=el("div",{class:"ms-modal-actions"});
  const remove=el("button",{class:"ms-btn",text:"删除选中遮挡"});
  remove.addEventListener("click",()=>{if(masks[selected]){masks.splice(selected,1);selected=Math.max(0,selected-1);draw();}});
  const save=el("button",{class:"ms-btn primary",text:"保存遮挡题"});
  save.addEventListener("click",()=>{plugin.store.updateCard(card.id,{occlusions:structuredClone(masks)});onChanged?.();new Notice(saveFeedback(plugin.store, "图片遮挡已保存"));close();});
  const cancel=el("button",{class:"ms-btn",text:"取消"}); cancel.addEventListener("click",close);
  actions.append(remove,save,cancel);modal.append(actions);
  const pos=(e:PointerEvent)=>{const r=layer.getBoundingClientRect();return{x:clamp((e.clientX-r.left)/r.width),y:clamp((e.clientY-r.top)/r.height)};};
  const draw=()=>{
    layer.replaceChildren();
    remove.textContent=masks.length?`删除图片遮挡 ${selected+1}`:"删除选中遮挡";
    const buttons=[...tools.querySelectorAll("button")]; buttons.forEach((b,i)=>b.classList.toggle("primary",toolButtons[i][0]===tool));
    masks.forEach((m,i)=>{
      const shape=el("div",{title:m.label||`遮挡 ${i+1}`,style:`position:absolute;left:${m.x*100}%;top:${m.y*100}%;width:${m.width*100}%;height:${m.height*100}%;background:#172033eF;border:2px solid ${i===selected?"#ffd166":"#8fa4c8"};box-sizing:border-box;cursor:${tool==="adjust"?"move":"crosshair"};pointer-events:${tool==="adjust"?"auto":"none"};`});
      if(m.points?.length) shape.style.clipPath=`polygon(${m.points.map(p=>`${((p.x-m.x)/m.width)*100}% ${((p.y-m.y)/m.height)*100}%`).join(",")})`;
      shape.addEventListener("pointerdown",e=>{if(tool!=="adjust")return;e.stopPropagation();selected=i;labelInput.value=m.label??"";drag={start:pos(e),current:pos(e),kind:"move",origin:structuredClone(m)};layer.setPointerCapture(e.pointerId);});
      layer.append(shape);
      if(tool==="adjust"&&i===selected){
        if(m.points?.length) m.points.forEach((p,j)=>{const h=el("button",{type:"button","aria-label":`遮挡顶点 ${j+1}`,style:`position:absolute;left:${p.x*100}%;top:${p.y*100}%;width:12px;height:12px;padding:0;border:2px solid white;border-radius:50%;background:#5269dc;transform:translate(-50%,-50%);z-index:3`});h.addEventListener("pointerdown",e=>{e.stopPropagation();drag={start:pos(e),current:pos(e),kind:"vertex",index:j,origin:structuredClone(m)};layer.setPointerCapture(e.pointerId);});layer.append(h);});
        else {const h=el("button",{type:"button", "aria-label":"调整矩形大小",style:`position:absolute;left:${(m.x+m.width)*100}%;top:${(m.y+m.height)*100}%;width:14px;height:14px;padding:0;background:#ffd166;border:2px solid white;transform:translate(-50%,-50%);z-index:3`});h.addEventListener("pointerdown",e=>{e.stopPropagation();drag={start:pos(e),current:pos(e),kind:"resize",origin:structuredClone(m)};layer.setPointerCapture(e.pointerId);});layer.append(h);}
      }
    });
  };
  layer.addEventListener("pointerdown",e=>{if((e.target as HTMLElement)!==layer||tool==="adjust")return;labelInput.value="";const p=pos(e);drag={start:p,current:p,path:[p],kind:"draw"};layer.setPointerCapture(e.pointerId);});
  layer.addEventListener("pointermove",e=>{if(!drag)return;drag.current=pos(e);const d=drag, m=d.origin;
    if(d.kind==="draw"){if(tool==="rectangle"){const x=Math.min(d.start.x,d.current.x),y=Math.min(d.start.y,d.current.y);const w=Math.abs(d.current.x-d.start.x),h=Math.abs(d.current.y-d.start.y);let preview=layer.querySelector("[data-preview]") as HTMLElement|null;if(!preview){preview=el("div",{"data-preview":"",style:"position:absolute;background:#172033cc;border:2px dashed #ffd166;pointer-events:none"});layer.append(preview);}Object.assign(preview.style,{left:`${x*100}%`,top:`${y*100}%`,width:`${w*100}%`,height:`${h*100}%`});}else{const last=d.path?.[d.path.length-1];if(!last||Math.hypot(d.current.x-last.x,d.current.y-last.y)>.008)d.path?.push(d.current);let preview=layer.querySelector("[data-preview]") as HTMLElement|null;if(!preview){preview=el("div",{"data-preview":"",style:"position:absolute;inset:0;background:#ffd16622;pointer-events:none"});layer.append(preview);}preview.style.clipPath=`polygon(${(d.path??[]).map(p=>`${p.x*100}% ${p.y*100}%`).join(",")})`;}}
    else if(m){const dx=d.current.x-d.start.x,dy=d.current.y-d.start.y;const next=structuredClone(m);if(d.kind==="move"){next.x=clamp(m.x+dx);next.y=clamp(m.y+dy);next.x=Math.min(next.x,1-next.width);next.y=Math.min(next.y,1-next.height);if(next.points)next.points=next.points.map(p=>({x:clamp(p.x+dx),y:clamp(p.y+dy)}));}else if(d.kind==="vertex"&&next.points&&d.index!==undefined){next.points[d.index]=d.current;const xs=next.points.map(p=>p.x),ys=next.points.map(p=>p.y);next.x=Math.min(...xs);next.y=Math.min(...ys);next.width=Math.max(.01,Math.max(...xs)-next.x);next.height=Math.max(.01,Math.max(...ys)-next.y);}else{next.width=Math.max(.01,Math.min(1-next.x,m.width+dx));next.height=Math.max(.01,Math.min(1-next.y,m.height+dy));}masks[selected]=next;draw();}
  });
  layer.addEventListener("pointerup",e=>{if(!drag)return;const d=drag;drag=null;if(d.kind==="draw"){const b=pos(e);if(tool==="free"){const last=d.path?.[d.path.length-1];if(!last||Math.hypot(b.x-last.x,b.y-last.y)>.008)d.path?.push(b);const pts=d.path??[],xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;if(pts.length<3||w<.01||h<.01){draw();return;}masks.push({id:uid(),x,y,width:w,height:h,label:labelInput.value.trim()||undefined,points:pts});}else{const a=d.start,x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(b.x-a.x),h=Math.abs(b.y-a.y);if(w<.01||h<.01){draw();return;}masks.push({id:uid(),x,y,width:w,height:h,label:labelInput.value.trim()||undefined});}selected=masks.length-1;labelInput.value=masks[selected].label??"";}else if(masks[selected])masks[selected].label=labelInput.value.trim()||undefined;draw();});
  labelInput.addEventListener("input",()=>{if(masks[selected])masks[selected].label=labelInput.value.trim()||undefined;});
  const fitLayer=()=>{if(!img.clientWidth||!img.clientHeight)return;canvas.style.width=`${img.clientWidth}px`;layer.style.width=`${img.clientWidth}px`;layer.style.height=`${img.clientHeight}px`;draw();};
  img.addEventListener("load",fitLayer); new ResizeObserver(fitLayer).observe(img); requestAnimationFrame(fitLayer);
  masks[selected]&&(labelInput.value=masks[selected].label??"");draw();
}
