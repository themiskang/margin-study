import type { Annotation } from "../types";
import { el } from "../utils/dom";
import { annotationTextRuns, annotationTextStyle, applyTextStyle, renderTextRuns } from "./textRuns";

export interface OverlayBox { left: number; top: number; width: number; height: number; }
export interface OverlayGeometry {
  page: number;
  docKind: "pdf" | "html";
  rects: Annotation["rects"];
  pdfGeometry?: Annotation["pdfGeometry"];
  pdfCoordinateSpace?: Annotation["pdfCoordinateSpace"];
  box?: { x: number; y: number; w: number; h: number };
}
export interface OverlaySurface {
  parent: HTMLElement;
  box: OverlayBox;
  fontScale?: number;
  geometry: (box: OverlayBox) => OverlayGeometry | null;
}
export function boundedOverlayBox(box: OverlayBox, width: number, height: number): OverlayBox {
  const w = Math.min(Math.max(12, box.width), Math.max(12, width));
  const h = Math.min(Math.max(12, box.height), Math.max(12, height));
  return { left: Math.max(0, Math.min(width - w, box.left)), top: Math.max(0, Math.min(height - h, box.top)), width: w, height: h };
}
export function positionOverlay(element: HTMLElement, box: OverlayBox): void {
  element.style.left = `${box.left}px`; element.style.top = `${box.top}px`;
  element.style.width = `${box.width}px`; element.style.height = `${box.height}px`;
}
export function createFreeOverlay(ann: Annotation, surface: OverlaySurface, options: {
  readonly: boolean;
  commit: (box: OverlayBox) => void;
  edit: () => void;
  crop?: () => void;
  rotate?: (angle:number) => void;
  remove: () => void;
  undo: () => void;
  redo: () => void;
  card: () => void;
}): { element: HTMLElement; dispose: () => void } {
  const element = el("div", { class: "ms-ann ms-free-overlay", tabindex: options.readonly ? "-1" : "0", role: "group", "aria-label": ann.overlay?.kind === "image" ? "图片批注" : "自由文字批注" });
  element.dataset.annId = ann.id; element.dataset.overlayKind = ann.overlay!.kind; element.dataset.inkLayerId = ann.inkLayerId ?? "default";
  positionOverlay(element, surface.box);
  if(ann.overlay?.rotation)element.style.transform=`rotate(${ann.overlay.rotation}deg)`;
  element.style.color = ann.color; element.style.background = ann.overlay?.background ?? "transparent";
  if (ann.overlay?.background && ann.overlay.background !== "transparent") element.style.setProperty("--ms-reading-neutral-ink", "initial");
  if (ann.overlay?.kind === "image") {
    const image = el("img", { class: "ms-free-overlay-image", src: ann.image!, alt: ann.text || "图片批注", draggable: "false" }); element.append(image);
  } else {
    const text = el("div", { class: "ms-free-overlay-text" });
    applyTextStyle(text, annotationTextStyle(ann), surface.fontScale ?? 1);
    renderTextRuns(text, annotationTextRuns(ann), surface.fontScale ?? 1); element.append(text);
  }
  let cleanupGesture: (() => void) | null = null;
  if (!options.readonly) {
    const tools = el("div", { class: "ms-free-overlay-tools" });
    const move = el("button", { class: "ms-free-overlay-move", text: "⠿", title: "移动批注", "aria-label": "移动批注" });
    const edit = el("button", { text: "✎", title: ann.overlay?.kind === "image" ? "替换图片批注" : "编辑文字批注", "aria-label": ann.overlay?.kind === "image" ? "替换图片批注" : "编辑文字批注" });
    const remove = el("button", { text: "×", title: "删除自由批注", "aria-label": "删除自由批注" });
    const card = el("button", { text: "◇", title: "生成批注卡片", "aria-label": "由自由批注生成卡片" });
    const resize = el("button", { class: "ms-free-overlay-resize", title: "缩放批注", "aria-label": "缩放批注", text: "◢" });
    tools.append(move, edit);
    if(options.rotate){const angle=el("input",{type:"number",min:"-360",max:"360",step:"1",value:String(ann.overlay?.rotation??0),"aria-label":"旋转批注角度",title:"旋转角度（度）"});angle.style.width="56px";
      angle.addEventListener("change",()=>{const value=Number(angle.value);if(Number.isFinite(value)&&value>=-360&&value<=360)options.rotate?.((value%360+360)%360);else angle.value=String(ann.overlay?.rotation??0);});tools.append(angle);}
    if(ann.overlay?.kind==="image"&&options.crop){const crop=el("button",{text:"Crop","aria-label":"Crop"});crop.addEventListener("click",event=>{event.stopPropagation();options.crop?.();});tools.append(crop);}
    tools.append(card, remove); element.append(tools, resize);
    edit.addEventListener("click", event => { event.stopPropagation(); options.edit(); });
    remove.addEventListener("click", event => { event.stopPropagation(); options.remove(); });
    card.addEventListener("click", event => { event.stopPropagation(); options.card(); });
    element.addEventListener("dblclick", event => { event.stopPropagation(); if (!(event.target as HTMLElement).closest("button")) options.edit(); });
    const begin = (event: PointerEvent, kind: "move" | "resize") => {
      if (event.button !== 0 || event.isPrimary === false) return;
      event.preventDefault(); event.stopPropagation(); cleanupGesture?.(); element.focus({ preventScroll: true });
      const initial = { left:parseFloat(element.style.left),top:parseFloat(element.style.top),width:parseFloat(element.style.width),height:parseFloat(element.style.height) }, startX = event.clientX, startY = event.clientY, pointerId = event.pointerId;
      let next = initial;
      const parent = surface.parent.getBoundingClientRect();
      const sx = parent.width / Math.max(1, surface.parent.clientWidth), sy = parent.height / Math.max(1, surface.parent.clientHeight);
      const update = (sample: PointerEvent) => {
        if (sample.pointerId !== pointerId) return;
        const dx = (sample.clientX - startX) / sx, dy = (sample.clientY - startY) / sy;
        if (kind === "move") {
          next = boundedOverlayBox({ ...initial, left: initial.left + dx, top: initial.top + dy }, surface.parent.clientWidth, surface.parent.clientHeight);
        } else {
          const radians = (ann.overlay?.rotation ?? 0) * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
          const size = boundedOverlayBox({ ...initial, width: initial.width + cosine * dx + sine * dy, height: initial.height - sine * dx + cosine * dy }, surface.parent.clientWidth, surface.parent.clientHeight);
          const dw = size.width - initial.width, dh = size.height - initial.height;
          // The opposite rotated corner stays fixed as the local bottom-right handle moves.
          next = boundedOverlayBox({ ...size, left: initial.left + (cosine * dw - sine * dh - dw) / 2, top: initial.top + (sine * dw + cosine * dh - dh) / 2 }, surface.parent.clientWidth, surface.parent.clientHeight);
        }
        positionOverlay(element, next);
      };
      const end = (sample: PointerEvent) => { if (sample.pointerId !== pointerId) return; update(sample); cleanup(); if (JSON.stringify(initial) !== JSON.stringify(next)) options.commit(next); };
      const cancel = () => { positionOverlay(element, initial); cleanup(); };
      const key = (sample: KeyboardEvent) => { if (sample.key === "Escape") { sample.preventDefault(); sample.stopPropagation(); cancel(); } };
      const cleanup = () => { window.removeEventListener("pointermove", update); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", cancel); document.removeEventListener("keydown", key, true); cleanupGesture = null; };
      cleanupGesture = cancel;
      window.addEventListener("pointermove", update); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", cancel); document.addEventListener("keydown", key, true);
    };
    move.addEventListener("pointerdown", event => begin(event, "move")); resize.addEventListener("pointerdown", event => begin(event, "resize"));
    element.addEventListener("pointerdown", event => { if (!(event.target as HTMLElement).closest("button,input")) begin(event, "move"); });
    element.addEventListener("keydown", event => {
      if ((event.target as HTMLElement).closest("button,input")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.stopPropagation(); cleanupGesture?.(); if (event.shiftKey) options.redo(); else options.undo(); }
      else if (["Delete","Backspace"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); options.remove(); }
      else if (event.key === "Enter") { event.preventDefault(); options.edit(); }
    });
  }
  element.addEventListener("click", event => event.stopPropagation());
  surface.parent.append(element);
  return { element, dispose: () => { cleanupGesture?.(); element.remove(); } };
}
export async function loadOverlayImage(file: File): Promise<{ image: string; width: number; height: number }> {
  if (!/^image\/(?:png|jpeg|gif|webp|avif)$/i.test(file.type) || file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error("请选择 20 MB 内的 PNG、JPEG、GIF、WebP 或 AVIF 图片");
  const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("图片读取失败")); reader.readAsDataURL(file); });
  return new Promise((resolve, reject) => { const probe = new Image(); probe.onload = () => { if (!probe.naturalWidth || !probe.naturalHeight || probe.naturalWidth * probe.naturalHeight > 64_000_000) reject(new Error("图片尺寸超出限制")); else resolve({ image, width: probe.naturalWidth, height: probe.naturalHeight }); }; probe.onerror = () => reject(new Error("图片无法解码")); probe.src = image; });
}
