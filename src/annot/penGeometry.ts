/**
 * [INPUT]: 依赖笔迹坐标类型。
 * [OUTPUT]: 提供笔迹选区、变换和变更数据。
 * [POS]: 为手写控制器提供与界面无关的笔迹几何运算。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { Stroke } from "../types";

export type PenTool = "draw" | "highlight" | "erase" | "select";
export type HandwritingMode = "pen" | "highlight" | "eraser" | "lasso" | "off";
export interface InkRecord { id: string; strokes: Stroke[][]; color?: string; brush?: "pen" | "highlight"; width?: number; opacity?: number; hostAnnotationId?: string; }
export interface InkChange { id: string; before: Stroke[][]; after: Stroke[][]; color?: { before?: string; after: string }; hostBinding?: { before?: string; after?: string }; }
export interface InkSelection { id: string; indexes: number[]; }
export interface InkClipboardEntry { strokes: Stroke[][]; brush: "pen" | "highlight"; color?: string; width?: number; opacity?: number; }
export const cloneStrokes = (strokes: Stroke[][]): Stroke[][] => strokes.map((stroke) => stroke.map((point) => ({ ...point })));
export const INK_ACTIVE_OPACITY = 1;
export const INK_REFERENCE_OPACITY = 0.35;
export function inkLayerOpacity(reference: boolean): number {
  return reference ? INK_REFERENCE_OPACITY : INK_ACTIVE_OPACITY;
}

export interface InkFrame { x: number; y: number; width: number; height: number; }
export function projectBoundInk<T extends Stroke>(points: T[], original?: InkFrame, current?: InkFrame): T[] {
  if (!original || !current || original.width <= 0 || original.height <= 0) return points.map(point => ({ ...point }));
  return points.map(point => ({ ...point, x: current.x + (point.x - original.x) * current.width / original.width, y: current.y + (point.y - original.y) * current.height / original.height }));
}
export function unprojectBoundInkDelta(delta: Stroke, original?: InkFrame, current?: InkFrame): Stroke {
  if (!original || !current || current.width <= 0 || current.height <= 0) return delta;
  return { x: delta.x * original.width / current.width, y: delta.y * original.height / current.height };
}

function distanceToSegment(point: Stroke, start: Stroke, end: Stroke): number {
  const dx = end.x - start.x, dy = end.y - start.y;
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}
function intersects(a: Stroke, b: Stroke, c: Stroke, d: Stroke): boolean {
  const cross = (p: Stroke, q: Stroke, r: Stroke) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const first = cross(a, b, c), second = cross(a, b, d), third = cross(c, d, a), fourth = cross(c, d, b);
  if (first * second < 0 && third * fourth < 0) return true;
  return distanceToSegment(a, c, d) < 1e-7 || distanceToSegment(b, c, d) < 1e-7 || distanceToSegment(c, a, b) < 1e-7 || distanceToSegment(d, a, b) < 1e-7;
}
export function pointInPolygon(point: Stroke, polygon: Stroke[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (distanceToSegment(point, a, b) < 1e-7) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function selectInk(records: InkRecord[], polygon: Stroke[]): InkSelection[] {
  if (polygon.length < 3) return [];
  return records.map((record) => ({ id: record.id, indexes: record.strokes.flatMap((stroke, index) => {
    const hit = stroke.some((point) => pointInPolygon(point, polygon)) || stroke.slice(1).some((point, at) =>
      polygon.some((edge, edgeIndex) => intersects(stroke[at], point, edge, polygon[(edgeIndex + 1) % polygon.length])));
    return hit ? [index] : [];
  }) })).filter((record) => record.indexes.length);
}
export function eraseInk(records: InkRecord[], trail: Stroke[], width: number, height: number, radius = 9): InkChange[] {
  const pixel = (point: Stroke) => ({ x: point.x * width, y: point.y * height });
  const eraser = trail.map(pixel);
  if (!eraser.length) return [];
  const hit = (stroke: Stroke[]) => {
    const points = stroke.map(pixel);
    return points.some((point) => eraser.some((sample, index) => index ? distanceToSegment(point, eraser[index - 1], sample) <= radius : Math.hypot(point.x - sample.x, point.y - sample.y) <= radius)) ||
      points.slice(1).some((point, index) => eraser.some((sample, at) => at ? intersects(points[index], point, eraser[at - 1], sample) ||
        Math.min(distanceToSegment(sample, points[index], point), distanceToSegment(eraser[at - 1], points[index], point)) <= radius : distanceToSegment(sample, points[index], point) <= radius));
  };
  return records.flatMap((record) => {
    const after = record.strokes.filter((stroke) => !hit(stroke));
    return after.length === record.strokes.length ? [] : [{ id: record.id, before: cloneStrokes(record.strokes), after: cloneStrokes(after) }];
  });
}
export function transformSelectedInk(records: InkRecord[], selection: InkSelection[], delta: Stroke | null): InkChange[] {
  const selected = new Map(selection.map((entry) => [entry.id, new Set(entry.indexes)]));
  const points = records.flatMap((record) => record.strokes.filter((_, index) => selected.get(record.id)?.has(index)).flat());
  if (!points.length) return [];
  let left = 1, right = 0, top = 1, bottom = 0;
  for (const point of points) { left = Math.min(left, point.x); right = Math.max(right, point.x); top = Math.min(top, point.y); bottom = Math.max(bottom, point.y); }
  // Cropping can hide the ends of an otherwise intact stroke. Preserve those
  // ends instead of pulling the whole stroke into view on a perpendicular move.
  const dx = delta ? Math.max(Math.min(0, -left), Math.min(Math.max(0, 1 - right), delta.x)) : 0;
  const dy = delta ? Math.max(Math.min(0, -top), Math.min(Math.max(0, 1 - bottom), delta.y)) : 0;
  return records.flatMap((record) => {
    const indexes = selected.get(record.id); if (!indexes?.size) return [];
    const after = record.strokes.flatMap((stroke, index) => !indexes.has(index) ? [stroke] : delta ? [stroke.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy }))] : []);
    return [{ id: record.id, before: cloneStrokes(record.strokes), after: cloneStrokes(after) }];
  });
}
