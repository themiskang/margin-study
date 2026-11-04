import type { PdfCrop, Stroke } from "../types";

export const fullPageCrop: Readonly<PdfCrop> = Object.freeze({ left: 0, top: 0, right: 1, bottom: 1 });

export function readPageCrop(value: unknown): PdfCrop {
  const crop = value as PdfCrop | undefined;
  if (!crop || ![crop.left, crop.top, crop.right, crop.bottom].every(Number.isFinite)
    || crop.right - crop.left < .01 || crop.bottom - crop.top < .01
    || Math.min(crop.left, crop.top) < -2 || Math.max(crop.right, crop.bottom) > 3) return { ...fullPageCrop };
  return { left: crop.left, top: crop.top, right: crop.right, bottom: crop.bottom };
}

/** Keep PDF.js' own inverse, rotation, rawDims and text-layer clone semantics. */
export function croppedPageViewport(page: any, scale: number, crop: PdfCrop): any {
  const original = page.getViewport({ scale });
  crop = rotatePageCrop(crop, page.marginStudyRotation ?? 0);
  if (crop.left === 0 && crop.top === 0 && crop.right === 1 && crop.bottom === 1) return original;
  const first = original.convertToPdfPoint(original.width * crop.left, original.height * crop.top);
  const last = original.convertToPdfPoint(original.width * crop.right, original.height * crop.bottom);
  return new original.constructor({
    viewBox: [Math.min(first[0], last[0]), Math.min(first[1], last[1]), Math.max(first[0], last[0]), Math.max(first[1], last[1])],
    scale: original.scale, rotation: original.rotation,
  });
}

export function rotatePagePoint<T extends {x:number;y:number}>(point: T, rotation: number): T {
  return rotation === 90 ? { ...point, x: 1-point.y, y: point.x } : rotation === 180 ? { ...point, x: 1-point.x, y: 1-point.y } : rotation === 270 ? { ...point, x: point.y, y: 1-point.x } : { ...point };
}
export function rotatePageCrop(crop: PdfCrop, rotation: number): PdfCrop {
  const a = rotatePagePoint({x:crop.left,y:crop.top},rotation), b = rotatePagePoint({x:crop.right,y:crop.bottom},rotation);
  return {left:Math.min(a.x,b.x),top:Math.min(a.y,b.y),right:Math.max(a.x,b.x),bottom:Math.max(a.y,b.y)};
}
export function projectPagePoint<T extends { x: number; y: number }>(point: T, crop: PdfCrop, rotation = 0): T {
  return rotatePagePoint({ ...point, x: (point.x - crop.left) / (crop.right - crop.left), y: (point.y - crop.top) / (crop.bottom - crop.top) },rotation);
}
export function sourcePagePoint<T extends { x: number; y: number }>(point: T, crop: PdfCrop, rotation = 0): T {
  const unrotated = rotatePagePoint(point,(360-rotation)%360);
  return { ...unrotated, x: crop.left + unrotated.x * (crop.right - crop.left), y: crop.top + unrotated.y * (crop.bottom - crop.top) };
}
export function projectPageInk(strokes: Stroke[][], crop: PdfCrop, rotation = 0): Stroke[][] {
  return strokes.map(stroke => stroke.map(point => projectPagePoint(point, crop, rotation)));
}
export function sourcePageInk(strokes: Stroke[][], crop: PdfCrop, rotation = 0): Stroke[][] {
  return strokes.map(stroke => stroke.map(point => sourcePagePoint(point, crop, rotation)));
}
