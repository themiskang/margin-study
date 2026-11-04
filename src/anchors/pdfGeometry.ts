import type { Annotation, PdfPageGeometry, PdfRect } from "../types";

/** The two conversions belong to PDF.js: they include CropBox, rotation and its Y convention. */
export interface PdfViewport {
  width: number;
  height: number;
  scale: number;
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportRectangle(rect: number[]): number[];
}

export interface CssRect { left: number; top: number; width: number; height: number; }
export interface ClientBox extends CssRect { right: number; bottom: number; }

export function validPdfRect(rect: PdfRect | null | undefined): rect is PdfRect {
  return !!rect && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) && rect.w > 0 && rect.h > 0;
}

/** Old sidecars use the displayed page at scale 1. Never silently reinterpret those as raw PDF. */
export function annotationGeometry(annotation: Annotation): PdfPageGeometry[] {
  const entries = Array.isArray(annotation.pdfGeometry) && annotation.pdfGeometry.length ? annotation.pdfGeometry : [{ page: annotation.page, rects: annotation.rects }];
  const pages = new Map<number, PdfRect[]>();
  for (const entry of entries) {
    if (!entry || !Number.isInteger(entry.page) || entry.page < 1) continue;
    const rects = Array.isArray(entry.rects) ? entry.rects.filter(validPdfRect) : [];
    const page = pages.get(entry.page) ?? [];
    for (const rect of rects) page.push(rect);
    pages.set(entry.page, page);
  }
  return [...pages].map(([page, rects]) => ({ page, rects })).sort((a, b) => a.page - b.page);
}

/** Client selection geometry is clipped to the actual canvas before the inverse projection. */
export function clientRectToPdfRect(rect: ClientBox, canvas: ClientBox, viewport: PdfViewport): PdfRect | null {
  if (canvas.width <= 0 || canvas.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return null;
  const left = Math.max(rect.left, canvas.left);
  const right = Math.min(rect.right, canvas.right);
  const top = Math.max(rect.top, canvas.top);
  const bottom = Math.min(rect.bottom, canvas.bottom);
  if (right - left < 0.01 || bottom - top < 0.01) return null;
  const sx = viewport.width / canvas.width;
  const sy = viewport.height / canvas.height;
  const points = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y]) =>
    viewport.convertToPdfPoint((x - canvas.left) * sx, (y - canvas.top) * sy));
  if (points.some((point) => point.length < 2 || !point.slice(0, 2).every(Number.isFinite))) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const result = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  return validPdfRect(result) ? result : null;
}

export function pdfRectToCssRect(rect: PdfRect, viewport: PdfViewport, size = { width: viewport.width, height: viewport.height }): CssRect | null {
  if (!validPdfRect(rect) || viewport.width <= 0 || viewport.height <= 0) return null;
  const coordinates = viewport.convertToViewportRectangle([rect.x, rect.y, rect.x + rect.w, rect.y + rect.h]);
  if (coordinates.length < 4 || !coordinates.every(Number.isFinite)) return null;
  const sx = size.width / viewport.width;
  const sy = size.height / viewport.height;
  return { left: Math.min(coordinates[0], coordinates[2]) * sx, top: Math.min(coordinates[1], coordinates[3]) * sy,
    width: Math.abs(coordinates[2] - coordinates[0]) * sx, height: Math.abs(coordinates[3] - coordinates[1]) * sy };
}

export function legacyRectToCssRect(rect: PdfRect, pageHeight: number, scale: number): CssRect | null {
  if (!validPdfRect(rect) || !Number.isFinite(pageHeight) || pageHeight <= 0) return null;
  return { left: rect.x * scale, top: (pageHeight - rect.y - rect.h) * scale, width: rect.w * scale, height: rect.h * scale };
}

/** PDF point tolerance is independent of zoom and devicePixelRatio. */
export function pdfRectsIntersect(first: PdfRect, second: PdfRect, tolerance = 2): boolean {
  if (!validPdfRect(first) || !validPdfRect(second)) return false;
  const gap = Math.max(0, tolerance);
  return first.x <= second.x + second.w + gap && first.x + first.w + gap >= second.x &&
    first.y <= second.y + second.h + gap && first.y + first.h + gap >= second.y;
}

export function unionCssRects(rects: CssRect[]): CssRect | null {
  let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
  for (const rect of rects) {
    if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) continue;
    left = Math.min(left, rect.left); top = Math.min(top, rect.top);
    right = Math.max(right, rect.left + rect.width); bottom = Math.max(bottom, rect.top + rect.height);
  }
  return Number.isFinite(left) ? { left, top, width: right - left, height: bottom - top } : null;
}

export function uniquePdfRects(rects: PdfRect[]): PdfRect[] {
  const seen = new Set<string>();
  return rects.filter((rect) => {
    const key = [rect.x, rect.y, rect.w, rect.h].map((value) => value.toFixed(3)).join(",");
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
