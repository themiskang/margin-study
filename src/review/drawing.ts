/**
 * [INPUT]: 指针事件、画布尺寸和手写样式。
 * [OUTPUT]: 复习手绘与卡片评论手写输入。
 * [POS]: 卡片评论采集及绘制使用相对快照的内容坐标。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { Stroke } from "../types";
import { el } from "../utils/dom";
import { inkEndpoint, inkPoint, inkSamples, PalmGuard } from "../annot/penInput";
import type { MindmapInkStroke } from "../mindmap/handwritingContracts";
import { uid } from "../utils/id";

export interface DrawingStyle { color: string; width: number; opacity: number; }
const DEFAULT_DRAWING_STYLE: DrawingStyle = { color: "#5269dc", width: 3, opacity: 1 };

function paint(canvas: HTMLCanvasElement, strokes: Stroke[][], style: DrawingStyle = DEFAULT_DRAWING_STYLE): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = style.color; context.fillStyle = style.color; context.globalAlpha = style.opacity;
  context.lineWidth = style.width; context.lineCap = "round"; context.lineJoin = "round";
  for (const stroke of strokes) {
    if (!stroke.length) continue;
    if (stroke.length === 1) {
      context.beginPath(); context.arc(stroke[0].x * canvas.width, stroke[0].y * canvas.height, Math.max(1, style.width / 2), 0, Math.PI * 2); context.fill();
    } else {
      for (let index = 1; index < stroke.length; index++) {
        const previous = stroke[index - 1], point = stroke[index], pressure = point.pressure ?? previous.pressure;
        context.lineWidth = pressure === undefined ? style.width : Math.max(.5, style.width * (.45 + pressure * 1.1));
        context.beginPath(); context.moveTo(previous.x * canvas.width, previous.y * canvas.height);
        context.lineTo(point.x * canvas.width, point.y * canvas.height); context.stroke();
      }
    }
  }
  context.globalAlpha = 1;
}

function drawingCanvas(): HTMLCanvasElement {
  const canvas = el("canvas", { style: "display:block;width:100%;height:160px;border:1px solid var(--background-modifier-border);border-radius:8px;background:var(--background-primary)" }) as HTMLCanvasElement;
  canvas.width = 960; canvas.height = 320;
  return canvas;
}

export function appendReviewDrawing(container: HTMLElement, drawing: Stroke[][]): void {
  if (!drawing.some(stroke => stroke.length)) return;
  const canvas = drawingCanvas(); canvas.setAttribute("aria-label", "本次复习的手绘批注");
  container.append(canvas); paint(canvas, drawing);
}

/** Own-format normalized points; no native app drawing format is used. */
export function reviewDrawingInput(options: Partial<DrawingStyle> = {}): { element: HTMLElement; value(): Stroke[][] | undefined; vectorStrokes(): MindmapInkStroke[] } {
  const style: DrawingStyle = {
    color: options.color ?? DEFAULT_DRAWING_STYLE.color,
    width: Number.isFinite(options.width) ? Math.max(.5, Math.min(24, Number(options.width))) : DEFAULT_DRAWING_STYLE.width,
    opacity: Number.isFinite(options.opacity) ? Math.max(0, Math.min(1, Number(options.opacity))) : DEFAULT_DRAWING_STYLE.opacity,
  };
  const element = el("details", { style: "margin:8px 0" });
  element.append(el("summary", { text: "手绘批注（可选）", style: "cursor:pointer;margin-bottom:6px" }));
  const canvas = drawingCanvas(); canvas.style.touchAction = "none"; canvas.style.cursor = "crosshair";
  canvas.setAttribute("aria-label", "在此绘制本次复习批注");
  const strokes: Stroke[][] = [];
  const ids: string[] = [];
  let current: Stroke[] | undefined, pointerId: number | undefined, pointerType: string | null = null;
  const palm = new PalmGuard();
  const point = (event: PointerEvent): Stroke => {
    const bounds = canvas.getBoundingClientRect();
    return inkPoint(event, Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))), Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height))));
  };
  canvas.addEventListener("pointerdown", event => {
    if (palm.down(event, pointerType)) return;
    if (pointerId !== undefined || event.button !== 0) return;
    pointerId = event.pointerId; pointerType = event.pointerType; current = [point(event)]; strokes.push(current); ids.push(uid("ink"));
    canvas.setPointerCapture(event.pointerId); event.preventDefault(); paint(canvas, strokes, style);
  });
  canvas.addEventListener("pointermove", event => {
    if (palm.move(event, pointerType)) return;
    if (!current || pointerId !== event.pointerId) return;
    current.push(...inkSamples(event).map(point)); paint(canvas, strokes, style);
  });
  const finish = (event: PointerEvent) => {
    palm.end(event, pointerType, pointerId ?? null);
    if (pointerId !== event.pointerId) return;
    if (event.type === "pointerup" && current?.length) {
      const endpoint = inkEndpoint(event, point(event), current[current.length - 1]);
      if (endpoint) { current.push(endpoint); paint(canvas, strokes, style); }
    }
    current = undefined; pointerId = undefined; pointerType = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener("pointerup", finish); canvas.addEventListener("pointercancel", finish); canvas.addEventListener("lostpointercapture", finish);
  const actions = el("div", { style: "display:flex;gap:8px;margin-top:6px" });
  const undo = el("button", { class: "ms-btn", text: "撤销一笔" });
  undo.addEventListener("click", () => { strokes.pop(); ids.pop(); current = undefined; pointerId = undefined; pointerType = null; paint(canvas, strokes, style); });
  const clear = el("button", { class: "ms-btn", text: "清空手绘" });
  clear.addEventListener("click", () => { strokes.length = 0; ids.length = 0; current = undefined; pointerId = undefined; pointerType = null; paint(canvas, strokes, style); });
  actions.append(undo, clear); element.append(canvas, actions);
  return { element, value: () => strokes.length ? strokes.map(stroke => stroke.map(item => ({ ...item }))) : undefined,
    vectorStrokes: () => strokes.map((points, index) => ({ id: ids[index], tool: "pen", color: style.color, width: style.width, opacity: style.opacity, points: points.map(point => ({ ...point })) })) };
}

export function cardInkInput(width: number, height: number, reference: { x: number; y: number; width: number; height: number }, style: DrawingStyle): {
  canvas: HTMLCanvasElement; strokes(): MindmapInkStroke[]; undo(): void; clear(): void; freeze(value: boolean): void;
} {
  const canvas = el("canvas", { "aria-label": "卡片批注画布" }) as HTMLCanvasElement;
  canvas.width = width; canvas.height = height;
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", touchAction: "none", cursor: "crosshair" });
  const context = canvas.getContext("2d")!;
  const strokes: MindmapInkStroke[] = [];
  const palm = new PalmGuard();
  let current: MindmapInkStroke | undefined, pointerId: number | null = null, pointerType: string | null = null, frozen = false;
  const point = (event: PointerEvent): Stroke => {
    const bounds = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(width, (event.clientX - bounds.left) * width / Math.max(1, bounds.width)));
    const y = Math.max(0, Math.min(height, (event.clientY - bounds.top) * height / Math.max(1, bounds.height)));
    return inkPoint(event, x - reference.x, y - reference.y);
  };
  const position = (value: Stroke) => ({ x: reference.x + value.x, y: reference.y + value.y });
  const segment = (stroke: MindmapInkStroke, previous: Stroke, next?: Stroke) => {
    const start = position(previous), end = next && position(next), pressure = next?.pressure ?? previous.pressure;
    context.strokeStyle = stroke.color; context.fillStyle = stroke.color; context.globalAlpha = stroke.opacity ?? 1;
    context.lineWidth = pressure === undefined ? stroke.width : Math.max(.5, stroke.width * (.45 + pressure * 1.1));
    context.lineCap = "round"; context.lineJoin = "round"; context.beginPath();
    if (end) { context.moveTo(start.x, start.y); context.lineTo(end.x, end.y); context.stroke(); }
    else { context.arc(start.x, start.y, Math.max(.5, context.lineWidth / 2), 0, Math.PI * 2); context.fill(); }
    context.globalAlpha = 1;
  };
  const repaint = () => {
    context.clearRect(0, 0, width, height);
    for (const stroke of strokes) if (stroke.points.length) {
      segment(stroke, stroke.points[0]);
      for (let index = 1; index < stroke.points.length; index++) segment(stroke, stroke.points[index - 1], stroke.points[index]);
    }
  };
  canvas.addEventListener("pointerdown", event => {
    if (frozen) return;
    if (palm.down(event, pointerType) || pointerId !== null || event.button !== 0) return;
    pointerId = event.pointerId; pointerType = event.pointerType;
    current = { id: uid("ink"), tool: "pen", color: style.color, width: style.width, opacity: style.opacity, points: [point(event)] };
    strokes.push(current); segment(current, current.points[0]);
    try { canvas.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  });
  canvas.addEventListener("pointermove", event => {
    if (frozen) return;
    if (palm.move(event, pointerType) || !current || pointerId !== event.pointerId) return;
    for (const sample of inkSamples(event)) { const next = point(sample), previous = current.points[current.points.length - 1]; current.points.push(next); segment(current, previous, next); }
  });
  const finish = (event: PointerEvent) => {
    if (frozen) return;
    palm.end(event, pointerType, pointerId);
    if (pointerId !== event.pointerId) return;
    if (event.type === "pointerup" && current) {
      const previous = current.points[current.points.length - 1], next = inkEndpoint(event, point(event), previous);
      if (next) { current.points.push(next); segment(current, previous, next); }
    }
    current = undefined; pointerId = null; pointerType = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener("pointerup", finish); canvas.addEventListener("pointercancel", finish); canvas.addEventListener("lostpointercapture", finish);
  return { canvas, strokes: () => strokes.map(stroke => ({ ...stroke, pointsVersion: 2, points: stroke.points.map(value => ({ ...value })) })),
    undo: () => { if (frozen || pointerId !== null) return; strokes.pop(); repaint(); },
    clear: () => { if (frozen || pointerId !== null) return; strokes.length = 0; repaint(); },
    freeze: value => { frozen = value; if (value) { current = undefined; pointerId = null; pointerType = null; } } };
}

export function segmentedCardInkInput(width: number, height: number, style: DrawingStyle, reference: { x: number; y: number }): {
  element: HTMLElement; canvases: HTMLCanvasElement[]; strokes(): MindmapInkStroke[]; undo(): void; clear(): void; freeze(value: boolean): void;
} {
  const element = el("div", { style: `width:${width}px` });
  const canvases: HTMLCanvasElement[] = [];
  for (let y = 0; y < height; y += 8000) {
    const canvas = el("canvas", { "aria-label": "卡片批注画布" }) as HTMLCanvasElement;
    canvas.width = width; canvas.height = Math.min(8000, height - y);
    Object.assign(canvas.style, { display: "block", width: `${width}px`, height: `${canvas.height}px`, touchAction: "none", cursor: "crosshair" });
    canvas.dataset.offsetY = String(y); element.append(canvas); canvases.push(canvas);
  }
  const strokes: MindmapInkStroke[] = [], palm = new PalmGuard();
  let current: MindmapInkStroke | undefined, pointerId: number | null = null, pointerType: string | null = null, frozen = false;
  const point = (event: PointerEvent, canvas: HTMLCanvasElement): Stroke => {
    const bounds = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(width, (event.clientX - bounds.left) * width / bounds.width));
    const y = Math.max(0, Math.min(height, Number(canvas.dataset.offsetY) + (event.clientY - bounds.top) * canvas.height / bounds.height));
    return inkPoint(event, x - reference.x, y - reference.y);
  };
  const draw = (stroke: MindmapInkStroke, previous: Stroke, next?: Stroke) => {
    const startY = previous.y + reference.y, endY = (next?.y ?? previous.y) + reference.y;
    for (const canvas of canvases) {
      const offset = Number(canvas.dataset.offsetY);
      if (Math.max(startY, endY) + stroke.width < offset || Math.min(startY, endY) - stroke.width > offset + canvas.height) continue;
      const context = canvas.getContext("2d")!, pressure = next?.pressure ?? previous.pressure;
      context.strokeStyle = stroke.color; context.fillStyle = stroke.color; context.globalAlpha = stroke.opacity ?? 1;
      context.lineWidth = pressure === undefined ? stroke.width : Math.max(.5, stroke.width * (.45 + pressure * 1.1));
      context.lineCap = "round"; context.lineJoin = "round"; context.beginPath();
      if (next) { context.moveTo(previous.x + reference.x, startY - offset); context.lineTo(next.x + reference.x, endY - offset); context.stroke(); }
      else { context.arc(previous.x + reference.x, startY - offset, Math.max(.5, context.lineWidth / 2), 0, Math.PI * 2); context.fill(); }
      context.globalAlpha = 1;
    }
  };
  const repaint = () => {
    for (const canvas of canvases) canvas.getContext("2d")!.clearRect(0, 0, width, canvas.height);
    for (const stroke of strokes) if (stroke.points.length) {
      draw(stroke, stroke.points[0]);
      for (let index = 1; index < stroke.points.length; index++) draw(stroke, stroke.points[index - 1], stroke.points[index]);
    }
  };
  for (const canvas of canvases) {
    canvas.addEventListener("pointerdown", event => {
      if (frozen || palm.down(event, pointerType) || pointerId !== null || event.button !== 0) return;
      pointerId = event.pointerId; pointerType = event.pointerType;
      current = { id: uid("ink"), tool: "pen", color: style.color, width: style.width, opacity: style.opacity, points: [point(event, canvas)] };
      strokes.push(current); draw(current, current.points[0]);
      try { canvas.setPointerCapture(event.pointerId); } catch {}
      event.preventDefault();
    });
    canvas.addEventListener("pointermove", event => {
      if (frozen || palm.move(event, pointerType) || !current || pointerId !== event.pointerId) return;
      for (const sample of inkSamples(event)) { const next = point(sample, canvas), previous = current.points[current.points.length - 1]; current.points.push(next); draw(current, previous, next); }
    });
    const finish = (event: PointerEvent) => {
      if (frozen) return;
      palm.end(event, pointerType, pointerId);
      if (pointerId !== event.pointerId) return;
      if (event.type === "pointerup" && current) {
        const previous = current.points[current.points.length - 1], next = inkEndpoint(event, point(event, canvas), previous);
        if (next) { current.points.push(next); draw(current, previous, next); }
      }
      current = undefined; pointerId = null; pointerType = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener("pointerup", finish); canvas.addEventListener("pointercancel", finish); canvas.addEventListener("lostpointercapture", finish);
  }
  return { element, canvases, strokes: () => strokes.map(stroke => ({ ...stroke, pointsVersion: 2, points: stroke.points.map(value => ({ ...value })) })),
    undo: () => { if (!frozen && pointerId === null) { strokes.pop(); repaint(); } },
    clear: () => { if (!frozen && pointerId === null) { strokes.length = 0; repaint(); } },
    freeze: value => { frozen = value; if (value) { current = undefined; pointerId = null; pointerType = null; } } };
}
