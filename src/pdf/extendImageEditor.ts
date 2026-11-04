import { Notice } from "obsidian";
import type { PdfExtendNote } from "../types";
import { el } from "../utils/dom";
import { openExtendImageCrop } from "./extendImageCrop";
import { setMenuIcon } from "./extendMenu";

type NoteImage = NonNullable<PdfExtendNote["images"]>[number];
interface ImageEditorOptions {
  images: NoteImage[];
  selected?: string;
  select: (id?: string) => void;
  enabled: () => boolean;
  current: () => boolean;
  latest: () => NoteImage[];
  save: (images: NoteImage[]) => Promise<void>;
  clipboard: (image: NoteImage, cut: boolean) => Promise<void>;
}

/** Image geometry is relative to the note paper, independent of PDF zoom or popup mode. */
export function renderExtendImages(box: HTMLElement, options: ImageEditorOptions): () => void {
  let cancelDrag: (() => void) | undefined;
  let closeCrop: (() => void) | undefined;
  const items = new Map<string, HTMLElement>();
  const select = (id?: string) => {
    options.select(id);
    if(id)for(const other of box.closest(".ms-extend-layer")?.querySelectorAll<HTMLElement>(".ms-extend-image.is-selected")??[])if(!items.has(other.dataset.imageId??"")){other.classList.remove("is-selected");other.setAttribute("aria-pressed","false");}
    for (const [key, item] of items) {
      item.classList.toggle("is-selected", key === id);
      item.setAttribute("aria-pressed", String(key === id));
    }
  };
  const fail = (error: unknown) => new Notice(String(error));
  const save = (image: NoteImage, patch?: Partial<NoteImage>) => {
    if (!options.current()) return;
    const images = options.latest(), latest = images.find(value => value.id === image.id);
    if (JSON.stringify(latest) !== JSON.stringify(image)) { fail("留白图片已在其他窗口更新，请重新操作"); return; }
    void options.save(patch ? images.map(value => value.id === image.id ? {...value, ...patch} : value) : images.filter(value => value.id !== image.id)).catch(fail);
  };
  const geometry = (item: HTMLElement, image: Pick<NoteImage,"x"|"y"|"w"|"h">) => {
    item.style.left = `${image.x * 100}%`; item.style.top = `${image.y * 100}%`;
    item.style.width = `${image.w * 100}%`; item.style.height = `${image.h * 100}%`;
  };
  for (const image of options.images) {
    const item = el("div", {class:"ms-extend-image", "data-image-id":image.id, role:"button", tabindex:"0", "aria-label":"留白图片"});
    geometry(item, image);
    item.append(el("img", {src:image.src, alt:"留白图片", draggable:"false"}));
    const menu = el("div", {class:"ms-extend-image-menu", role:"toolbar", "aria-label":"图片操作"});
    for(const [label,text,cut] of [["复制留白图片","Copy",false],["剪切留白图片","Cut",true]] as const){
      const button=el("button",{"aria-label":label,text});
      button.addEventListener("click",event=>{event.stopPropagation();if(options.enabled()&&options.current())void options.clipboard(image,cut).catch(fail);});menu.append(button);
    }
    const crop=el("button",{text:"Crop","aria-label":"裁剪留白图片"});
    crop.addEventListener("click",event=>{event.stopPropagation();if(!options.enabled())return;closeCrop?.();closeCrop=openExtendImageCrop(image,box,async patch=>{
      if(!options.current())throw new Error("文档或笔记本已切换");const images=options.latest();if(JSON.stringify(images.find(value=>value.id===image.id))!==JSON.stringify(image))throw new Error("留白图片已在其他窗口更新，请重新操作");
      await options.save(images.map(value=>value.id===image.id?{...value,...patch}:value));
    });});menu.append(crop);
    const remove = el("button", {"aria-label":"删除留白图片", title:"删除留白图片"});setMenuIcon(remove,"trash-2");
    remove.addEventListener("click", event => {event.stopPropagation(); save(image);}); menu.append(remove);
    const grip = el("button", {class:"ms-extend-image-resize", "aria-label":"调整留白图片大小", title:"调整留白图片大小"});
    item.append(menu, grip); items.set(image.id, item); box.append(item);
    const begin = (event: PointerEvent, resize: boolean) => {
      if (event.button !== 0 || !options.enabled()) return;
      event.preventDefault(); event.stopPropagation(); cancelDrag?.(); select(image.id);
      const bounds = box.getBoundingClientRect(), start = {x:event.clientX,y:event.clientY};
      if (!bounds.width || !bounds.height) return;
      let next = {...image}, changed = false;
      const move = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        const dx = (event.clientX - start.x) / bounds.width, dy = (event.clientY - start.y) / bounds.height;
        if (resize) {
          const factor = Math.max(16 / (bounds.width * image.w), Math.min((1-image.x)/image.w, (1-image.y)/image.h, 1 + dx/image.w));
          next = {...image,w:image.w*factor,h:image.h*factor,...(image.edit?{edit:{...image.edit,w:image.edit.w*factor,h:image.edit.h*factor}}:{})};
        } else next = {...image,x:Math.max(0,Math.min(1-image.w,image.x+dx)),y:Math.max(0,Math.min(1-image.h,image.y+dy))};
        changed = Math.abs(event.clientX-start.x)>2 || Math.abs(event.clientY-start.y)>2;
        geometry(item, next);
      };
      const pointerId = event.pointerId;
      const cleanup = () => {
        window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", cancel, true); window.removeEventListener("blur", cancel); window.removeEventListener("keydown", key, true);
        cancelDrag = undefined; geometry(item, image);
      };
      const cancel = () => cleanup();
      const key = (event: KeyboardEvent) => {if(event.key==="Escape"){event.preventDefault();event.stopPropagation();cancel();}};
      const up = (event: PointerEvent) => {if(event.pointerId!==pointerId)return; cleanup(); if(changed)save(image,next);};
      cancelDrag = cancel;
      window.addEventListener("pointermove",move,true); window.addEventListener("pointerup",up,true); window.addEventListener("pointercancel",cancel,true);
      window.addEventListener("blur",cancel); window.addEventListener("keydown",key,true);
    };
    item.addEventListener("pointerdown", event => {if(!(event.target as HTMLElement).closest("button"))begin(event,false);});
    grip.addEventListener("pointerdown", event => begin(event,true));
    item.addEventListener("click", event => {if(options.enabled()){event.stopPropagation();select(image.id);}});
    item.addEventListener("keydown", event => {
      if (!options.enabled() || (event.target as HTMLElement).closest("button")) return;
      if (event.key === "Enter" || event.key === " ") {event.preventDefault();select(image.id);}
      if (event.key === "Escape") {event.preventDefault(); select();}
      if (event.key === "Delete" || event.key === "Backspace") {event.preventDefault();event.stopPropagation();save(image);}
    });
  }
  for (const [key,item] of items) {item.classList.toggle("is-selected",key===options.selected);item.setAttribute("aria-pressed",String(key===options.selected));}
  const outside = (event: PointerEvent) => {if(!(event.target as HTMLElement).closest(".ms-extend-image"))select();};
  document.addEventListener("pointerdown",outside);
  return () => {cancelDrag?.();closeCrop?.();document.removeEventListener("pointerdown",outside);};
}
