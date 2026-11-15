import { Notice } from "obsidian";
import type { ReaderView } from "./readerView";
import type { PdfCrop } from "../types";
import { el } from "../utils/dom";
import { createModal } from "../utils/modal";
import { fullPageCrop, rotatePageCrop } from "./pageCrop";

/** Native Crop sheet: original paper, eight edge/corner handles, one Done action. */
export function openPageCropEditor(reader: ReaderView, page: any, onClose: () => void): { close: () => void; ready: Promise<void> } {
  const source = reader.getDoc(), path = reader.getFilePath();
  const rotation = page.marginStudyRotation ?? 0;
  let draft = rotatePageCrop(reader.getPageCrop(), rotation), closed = false, task: any = null, moving: (() => void) | null = null;
  const original = page.getViewport({ scale: 1 });
  const { bg, modal, close } = createModal("裁剪", () => {
    if (closed) return; closed = true; moving?.(); observer.disconnect();
    try { task?.cancel(); } catch { /* noop */ } onClose();
  });
  bg.classList.add("ms-crop-backdrop"); modal.classList.add("ms-crop-modal");
  modal.setAttribute("role", "dialog"); modal.setAttribute("aria-label", "裁剪"); modal.setAttribute("aria-modal", "true");
  const header = el("header", { class: "ms-crop-header" }), title = el("h3", { text: "裁剪" });
  const done = el("button", { text: "完成", "aria-label": "完成" }); header.append(title, done);
  const stage = el("div", { class: "ms-crop-stage" }), band = el("div", { class: "ms-crop-band" });
  const selection = el("div", { class: "ms-crop-selection" });
  const canvas = el("canvas", { class: "ms-crop-paper", "aria-label": "原始页面预览" }) as HTMLCanvasElement;
  stage.append(band, selection, canvas); modal.replaceChildren(header, stage);
  let paper = { left: 0, top: 0, width: 1, height: 1 };
  const paint = () => {
    const left = paper.left + draft.left * paper.width, top = paper.top + draft.top * paper.height;
    const width = (draft.right - draft.left) * paper.width, height = (draft.bottom - draft.top) * paper.height;
    Object.assign(selection.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    Object.assign(band.style, { top: `${top - 38}px`, height: `${height + 76}px` });
    canvas.style.clipPath = `inset(${Math.max(0, draft.top) * 100}% ${Math.max(0, 1 - draft.right) * 100}% ${Math.max(0, 1 - draft.bottom) * 100}% ${Math.max(0, draft.left) * 100}%)`;
  };
  const fit = () => {
    if (closed || moving) return;
    const minX = Math.min(0, draft.left), minY = Math.min(0, draft.top), maxX = Math.max(1, draft.right), maxY = Math.max(1, draft.bottom);
    const scale = Math.min(stage.clientWidth * .4 / original.width, stage.clientHeight * .6 / original.height,
      Math.max(1, stage.clientWidth - 40) / (original.width * (maxX - minX)), Math.max(1, stage.clientHeight - 40) / (original.height * (maxY - minY)));
    paper = { width: original.width * scale, height: original.height * scale,
      left: (stage.clientWidth - original.width * scale * (maxX + minX)) / 2,
      top: (stage.clientHeight - original.height * scale * (maxY + minY)) / 2 };
    Object.assign(canvas.style, { left: `${paper.left}px`, top: `${paper.top}px`, width: `${paper.width}px`, height: `${paper.height}px` }); paint();
  };
  const handles: { label: string; x: number; y: number; edges: (keyof PdfCrop)[] }[] = [
    { label: "调整左上边界", x: 0, y: 0, edges: ["left", "top"] }, { label: "调整上边界", x: .5, y: 0, edges: ["top"] },
    { label: "调整右上边界", x: 1, y: 0, edges: ["right", "top"] }, { label: "调整右边界", x: 1, y: .5, edges: ["right"] },
    { label: "调整右下边界", x: 1, y: 1, edges: ["right", "bottom"] }, { label: "调整下边界", x: .5, y: 1, edges: ["bottom"] },
    { label: "调整左下边界", x: 0, y: 1, edges: ["left", "bottom"] }, { label: "调整左边界", x: 0, y: .5, edges: ["left"] },
  ];
  const adjust = (start: PdfCrop, edges: (keyof PdfCrop)[], dx: number, dy: number) => {
    const next = { ...start };
    for (const edge of edges) {
      const value = start[edge] + (edge === "left" || edge === "right" ? dx : dy);
      // MN4 allows a corner to collapse exactly onto the opposite corner (crop to a
      // point); Done then restores the initial page instead of keeping a sliver.
      next[edge] = edge === "left" ? Math.max(-2, Math.min(start.right, value)) : edge === "right" ? Math.min(3, Math.max(start.left, value))
        : edge === "top" ? Math.max(-2, Math.min(start.bottom, value)) : Math.min(3, Math.max(start.top, value));
    }
    draft = next; paint();
  };
  for (const item of handles) {
    const handle = el("button", { class: "ms-crop-handle", "aria-label": item.label });
    Object.assign(handle.style, { left: `${item.x * 100}%`, top: `${item.y * 100}%`, cursor: item.edges.length === 1 ? (item.x === .5 ? "ns-resize" : "ew-resize") : (item.x === item.y ? "nwse-resize" : "nesw-resize") });
    handle.addEventListener("pointerdown", event => {
      if (done.disabled || event.button !== 0) return; event.preventDefault(); moving?.();
      const start = { ...draft }, x = event.clientX, y = event.clientY, id = event.pointerId;
      const move = (next: PointerEvent) => { if (next.pointerId === id) adjust(start, item.edges, (next.clientX - x) / paper.width, (next.clientY - y) / paper.height); };
      const up = (next: PointerEvent) => { if (next.pointerId !== id) return; moving?.(); fit(); };
      const cancel = (next: PointerEvent) => { if (next.pointerId !== id) return; draft = start; moving?.(); fit(); };
      moving = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); moving = null; };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
    });
    handle.addEventListener("keydown", event => {
      if (done.disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); const step = event.shiftKey ? .05 : .01;
      adjust(draft, item.edges, event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0); fit();
    }); selection.append(handle);
  }
  done.addEventListener("click", async () => {
    if (done.disabled || closed || reader.getDoc() !== source || reader.getFilePath() !== path) return;
    moving?.(); done.disabled = true;
    try { const collapsed = draft.right - draft.left < 1e-6 || draft.bottom - draft.top < 1e-6;
      await reader.setPageCrop(collapsed ? { ...fullPageCrop } : rotatePageCrop(draft, (360-rotation)%360)); close(); }
    catch (error) { if (!closed) { done.disabled = false; new Notice("裁边未保存：" + String(error)); } }
  });
  const observer = new ResizeObserver(fit); observer.observe(stage); fit(); done.focus();
  const viewport = page.getViewport({ scale: Math.min(1, 1200 / Math.max(original.width, original.height)) });
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  task = page.render({ canvasContext: canvas.getContext("2d")!, viewport });
  const ready = task.promise.catch((error: Error) => { if (!closed) { new Notice("页面预览未加载：" + String(error)); close(); } });
  return { close, ready };
}
