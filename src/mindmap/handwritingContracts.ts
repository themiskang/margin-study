export type HandwritingMode = "off" | "pen" | "highlight" | "eraser" | "lasso";

/** Coordinates and pen widths are in mind-map world pixels, independent of zoom. */
export interface MindmapInkPoint { x: number; y: number; pressure?: number; }
export interface MindmapInkStroke {
  id: string;
  tool: "pen" | "highlight";
  color: string;
  width: number;
  opacity?: number;
  points: MindmapInkPoint[];
}
export interface MindmapInkLayer { id: string; name: string; strokes: MindmapInkStroke[]; }
export interface MindmapHandwriting {
  version: 1;
  layers: MindmapInkLayer[];
  activeLayerId: string;
  overlayLayerId?: string;
}

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const bounded = (value: unknown, low: number, high: number, fallback: number): number => typeof value === "number" && Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;
function uniqueId(value: unknown, fallback: string, used: Set<string>): string {
  const base = typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : fallback;
  let id = base, suffix = 2; while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id); return id;
}

/** Recover valid ink from imported or older saved JSON without sharing mutable arrays. */
export function normalizeMindmapHandwriting(value: unknown): MindmapHandwriting | undefined {
  const data = object(value); if (!data || data.version !== 1 || !Array.isArray(data.layers)) return undefined;
  const layers: MindmapInkLayer[] = [], layerIds = new Set<string>(), strokeIds = new Set<string>();
  for (const [layerIndex, candidate] of data.layers.entries()) {
    const layer = object(candidate); if (!layer || !Array.isArray(layer.strokes)) continue;
    const id = uniqueId(layer.id, `layer-${layerIndex + 1}`, layerIds), strokes: MindmapInkStroke[] = [];
    for (const [strokeIndex, entry] of layer.strokes.entries()) {
      const stroke = object(entry); if (!stroke || !Array.isArray(stroke.points) || !["pen", "highlight"].includes(String(stroke.tool))) continue;
      const points: MindmapInkPoint[] = [];
      for (const sample of stroke.points) {
        const point = object(sample); if (!point || typeof point.x !== "number" || typeof point.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
        points.push({ x: bounded(point.x, 0, 1e7, 0), y: bounded(point.y, 0, 1e7, 0), ...(typeof point.pressure === "number" && Number.isFinite(point.pressure) ? { pressure: bounded(point.pressure, .05, 1, .5) } : {}) });
      }
      if (!points.length) continue;
      if (points.length === 1) points.push({ ...points[0], x: points[0].x + .01 });
      strokes.push({ id: uniqueId(stroke.id, `${id}-stroke-${strokeIndex + 1}`, strokeIds), tool: stroke.tool as "pen" | "highlight", color: typeof stroke.color === "string" && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(stroke.color) ? stroke.color : stroke.tool === "highlight" ? "#ffd54f" : "#30343b", width: bounded(stroke.width, .5, 64, stroke.tool === "highlight" ? 16 : 3), points, ...(typeof stroke.opacity === "number" && Number.isFinite(stroke.opacity) ? { opacity: bounded(stroke.opacity, 0, 1, 1) } : {}) });
    }
    layers.push({ id, name: typeof layer.name === "string" && layer.name.trim() ? layer.name.trim().slice(0, 120) : layerIndex ? `Sketch Layer ${layerIndex + 1}` : "Default", strokes });
  }
  if (!layers.length) layers.push({ id: "default", name: "Default", strokes: [] });
  const activeLayerId = layers.some((layer) => layer.id === data.activeLayerId) ? data.activeLayerId as string : layers[0].id;
  const overlayLayerId = typeof data.overlayLayerId === "string" && data.overlayLayerId !== activeLayerId && layers.some((layer) => layer.id === data.overlayLayerId) ? data.overlayLayerId : undefined;
  return { version: 1, layers, activeLayerId, ...(overlayLayerId ? { overlayLayerId } : {}) };
}

export function mindmapHasHandwriting(data?: MindmapHandwriting): boolean { return !!data?.layers.some((layer) => layer.strokes.some((stroke) => stroke.points.length)); }
