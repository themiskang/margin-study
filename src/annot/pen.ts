import type { Stroke } from "../types";
import { cloneStrokes, eraseInk, selectInk, transformSelectedInk } from "./penGeometry";
import type { InkChange, InkRecord, InkSelection, PenTool } from "./penGeometry";
import { inkEndpoint, inkPoint, inkSamples, PalmGuard } from "./penInput";

const SVGNS = "http://www.w3.org/2000/svg";
function normCoords(container: HTMLElement, event: PointerEvent): Stroke {
  const rect = container.getBoundingClientRect();
  return inkPoint(event, Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
    Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))));
}
function pathData(points: Stroke[], width: number, height: number): string {
  return points.map((point, index) => `${index ? "L" : "M"} ${point.x * width} ${point.y * height}`).join(" ");
}
function inkPath(parent: SVGElement, points: Stroke[], width: number, height: number, color: string, thickness?: number): SVGPathElement {
  const path = document.createElementNS(SVGNS, "path"); path.setAttribute("class", "ms-pen-path"); path.setAttribute("stroke", color);
  path.setAttribute("d", pathData(points, width, height)); if (thickness !== undefined) path.style.strokeWidth = String(thickness);
  parent.append(path); return path;
}
function renderStroke(parent: SVGElement, stroke: Stroke[], width: number, height: number, color: string, brush = "pen", thickness?: number, opacity?: number): void {
  if (!stroke.length) return;
  if (brush === "highlight") { const path = inkPath(parent, stroke, width, height, color, thickness ?? 16); if (opacity !== undefined) path.style.opacity = String(opacity); return; }
  if (!stroke.some((point) => point.pressure !== undefined)) { const path = inkPath(parent, stroke, width, height, color, thickness); if (opacity !== undefined) path.style.opacity = String(opacity); return; }
  const scale = (thickness ?? 3) / 3;
  for (let index = 1; index < stroke.length; index++) {
    const path = inkPath(parent, [stroke[index - 1], stroke[index]], width, height, color,
      scale * (0.8 + 5 * ((stroke[index - 1].pressure ?? 0.5) + (stroke[index].pressure ?? 0.5)) / 2));
    if (opacity !== undefined) path.style.opacity = String(opacity);
  }
}

interface PenOptions {
  getColor: () => string;
  getWidth?: () => number;
  getOpacity?: () => number;
  onCommit: (strokes: Stroke[][], brush: "pen" | "highlight", width?: number, opacity?: number) => void;
  isVanishPen?: () => boolean;
  vanishDelayMs?: number;
  getInk?: () => InkRecord[];
  onChange?: (changes: InkChange[]) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

/** Normalized ink, real stylus pressure, whole-stroke erasing and lasso move/delete. */
export class PenController {
  private overlay: SVGSVGElement;
  private active = false;
  private tool: PenTool = "draw";
  private gesture: "draw" | "erase" | "lasso" | "move" | null = null;
  private current: Stroke[] = [];
  private currentGroup: SVGGElement | null = null;
  private guide: SVGPathElement | null = null;
  private pointerId: number | null = null;
  private pointerType: string | null = null;
  private palm = new PalmGuard();
  private snapshot: InkRecord[] = [];
  private selection: InkSelection[] = [];
  private selectionRect: SVGRectElement | null = null;
  private delta: Stroke = { x: 0, y: 0 };
  private temporary = new Map<SVGGElement, number>();
  color = "#e53935";

  constructor(private container: HTMLElement, private opts: PenOptions) {
    this.overlay = document.createElementNS(SVGNS, "svg"); this.overlay.classList.add("ms-pen-overlay");
    this.overlay.setAttribute("tabindex", "0"); this.overlay.setAttribute("role", "application");
    this.overlay.setAttribute("aria-label", "手写工具；套索选中后可拖动，Delete 删除，Esc 取消");
    this.container.append(this.overlay); this.overlay.style.pointerEvents = "none"; this.bind();
  }
  setTool(tool: PenTool): void {
    if (this.tool === tool) return;
    this.flush(); this.tool = tool; this.clearSelection(); this.overlay.dataset.tool = tool;
  }
  setActive(active: boolean): void {
    if (this.active === active) return;
    if (!active) { this.flush(); this.clearSelection(); this.clearTemporary(); }
    this.active = active; this.overlay.style.pointerEvents = active ? "auto" : "none";
    this.container.classList.toggle("ms-pen-mode", active);
  }
  get isActive(): boolean { return this.active; }
  destroy(): void { this.setActive(false); this.flush(); this.clearTemporary(); this.overlay.remove(); }

  /** Only unfinished drawing is committed on close/switch; an unfinished edit gesture is cancelled. */
  flush(): void {
    const gesture = this.gesture, stroke = this.current;
    this.gesture = null; this.current = []; this.currentGroup?.remove(); this.currentGroup = null;
    this.guide?.remove(); this.guide = null;
    const pointer = this.pointerId; this.pointerId = null; this.pointerType = null;
    if (pointer !== null && this.overlay.hasPointerCapture?.(pointer)) this.overlay.releasePointerCapture(pointer);
    if (gesture === "draw") {
      if (stroke.length === 1) stroke.push({ ...stroke[0], x: Math.min(1, stroke[0].x + 0.0001) });
      if (stroke.length) {
        if (this.tool === "draw" && this.opts.isVanishPen?.()) this.renderTemporary(stroke);
        else this.opts.onCommit([stroke], this.tool === "highlight" ? "highlight" : "pen", this.opts.getWidth?.(), this.opts.getOpacity?.());
      }
    }
    this.snapshot = []; this.delta = { x: 0, y: 0 }; this.drawSelection();
  }

  private renderTemporary(stroke: Stroke[]): void {
    const bounds = this.container.getBoundingClientRect(), group = document.createElementNS(SVGNS, "g");
    group.setAttribute("class", "ms-pen-temporary-stroke"); group.setAttribute("data-ms-temporary-ink", "true"); group.setAttribute("aria-hidden", "true");
    renderStroke(group, stroke, bounds.width, bounds.height, this.opts.getColor(), "pen", this.opts.getWidth?.(), this.opts.getOpacity?.()); this.overlay.append(group);
    const timeout = window.setTimeout(() => { group.remove(); this.temporary.delete(group); }, this.opts.vanishDelayMs ?? 4000);
    this.temporary.set(group, timeout);
  }

  private clearTemporary(): void {
    for (const [group, timeout] of this.temporary) { window.clearTimeout(timeout); group.remove(); }
    this.temporary.clear();
  }

  private records(): InkRecord[] { return this.opts.getInk?.() ?? []; }
  private bind(): void {
    this.overlay.addEventListener("pointerdown", (event: PointerEvent) => {
      if (this.palm.down(event, this.pointerType)) return;
      if (!this.active || this.gesture || event.button !== 0 || event.isPrimary === false) return;
      event.preventDefault(); event.stopPropagation(); this.overlay.focus({ preventScroll: true });
      this.pointerId = event.pointerId; this.pointerType = event.pointerType; this.current = [normCoords(this.container, event)]; this.delta = { x: 0, y: 0 };
      this.snapshot = this.records().map((record) => ({ id: record.id, strokes: cloneStrokes(record.strokes) }));
      if (this.tool === "draw" || this.tool === "highlight") {
        this.gesture = "draw"; this.clearSelection(); this.currentGroup = document.createElementNS(SVGNS, "g"); this.overlay.append(this.currentGroup);
        if (this.tool === "highlight") this.currentGroup.style.opacity = String(this.opts.getOpacity?.() ?? .32);
        else this.currentGroup.style.opacity = String(this.opts.getOpacity?.() ?? 1);
        if (this.tool !== "highlight") this.currentGroup.style.strokeWidth = String(this.opts.getWidth?.() ?? 2);
      } else if (this.tool === "erase") this.gesture = "erase";
      else if (this.selection.length && this.selectionContains(this.current[0])) this.gesture = "move";
      else { this.gesture = "lasso"; this.clearSelection(); }
      if (this.gesture === "erase" || this.gesture === "lasso") {
        this.guide = document.createElementNS(SVGNS, "path"); this.guide.setAttribute("class", this.gesture === "erase" ? "ms-pen-erase-trail" : "ms-pen-lasso-trail"); this.overlay.append(this.guide);
      }
      try { this.overlay.setPointerCapture(event.pointerId); } catch { /* synthetic/older WebView */ }
    });
    this.overlay.addEventListener("pointermove", (event: PointerEvent) => {
      if (this.palm.move(event, this.pointerType)) return;
      if (!this.gesture || event.pointerId !== this.pointerId) return;
      event.preventDefault();
      const bounds = this.container.getBoundingClientRect();
      for (const sample of inkSamples(event)) {
        const point = normCoords(this.container, sample), previous = this.current[this.current.length - 1];
        this.current.push(point);
        if (this.gesture === "draw" && this.currentGroup) inkPath(this.currentGroup, [previous, point], bounds.width, bounds.height, this.opts.getColor(),
          this.tool === "highlight" ? this.opts.getWidth?.() ?? 16 : point.pressure === undefined ? undefined : (this.opts.getWidth?.() ?? 3) / 3 * (0.8 + 5 * ((previous.pressure ?? 0.5) + point.pressure) / 2));
      }
      if (this.guide) this.guide.setAttribute("d", pathData(this.current, bounds.width, bounds.height));
      if (this.gesture === "move") { const last = this.current[this.current.length - 1]; this.delta = { x: last.x - this.current[0].x, y: last.y - this.current[0].y }; this.drawSelection(); }
    });
    this.overlay.addEventListener("pointerup", (event: PointerEvent) => {
      this.palm.end(event, this.pointerType, this.pointerId);
      if (event.pointerId !== this.pointerId) return;
      const last = this.current[this.current.length - 1], endpoint = last && inkEndpoint(event, normCoords(this.container, event), last);
      if (endpoint) {
        this.current.push(endpoint);
        if (this.gesture === "move") this.delta = { x: endpoint.x - this.current[0].x, y: endpoint.y - this.current[0].y };
      }
      const gesture = this.gesture;
      if (gesture === "erase") {
        const bounds = this.container.getBoundingClientRect(); this.opts.onChange?.(eraseInk(this.snapshot, this.current, bounds.width, bounds.height));
      } else if (gesture === "lasso") {
        this.selection = selectInk(this.snapshot, this.current); this.drawSelection();
      } else if (gesture === "move") this.opts.onChange?.(transformSelectedInk(this.snapshot, this.selection, this.delta));
      this.flush();
    });
    const cancel = (event: PointerEvent) => { this.palm.end(event, this.pointerType, this.pointerId); if (event.pointerId === this.pointerId) this.flush(); };
    this.overlay.addEventListener("pointercancel", cancel); this.overlay.addEventListener("lostpointercapture", cancel);
    this.overlay.addEventListener("keydown", (event: KeyboardEvent) => {
      if (!this.active) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault(); event.stopPropagation(); this.flush(); this.clearSelection();
        if (event.shiftKey) this.opts.onRedo?.(); else this.opts.onUndo?.();
      } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.flush(); this.clearSelection(); }
      else if (["Delete", "Backspace"].includes(event.key) && this.selection.length) {
        event.preventDefault(); event.stopPropagation(); this.opts.onChange?.(transformSelectedInk(this.records(), this.selection, null)); this.clearSelection();
      }
    });
  }
  private clearSelection(): void { this.selection = []; this.selectionRect?.remove(); this.selectionRect = null; }
  private selectionBounds(): { x: number; y: number; width: number; height: number } | null {
    const selected = new Map(this.selection.map((entry) => [entry.id, new Set(entry.indexes)]));
    const points = this.records().flatMap((record) => record.strokes.filter((_, index) => selected.get(record.id)?.has(index)).flat());
    if (!points.length) return null;
    let left = 1, top = 1, right = 0, bottom = 0;
    for (const point of points) { left = Math.min(left, point.x); top = Math.min(top, point.y); right = Math.max(right, point.x); bottom = Math.max(bottom, point.y); }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  private selectionContains(point: Stroke): boolean {
    const bounds = this.selectionBounds(), rect = this.container.getBoundingClientRect();
    return !!bounds && point.x >= bounds.x - 8 / rect.width && point.x <= bounds.x + bounds.width + 8 / rect.width && point.y >= bounds.y - 8 / rect.height && point.y <= bounds.y + bounds.height + 8 / rect.height;
  }
  private drawSelection(): void {
    this.selectionRect?.remove(); this.selectionRect = null;
    const bounds = this.selectionBounds(); if (!bounds) return;
    const rect = this.container.getBoundingClientRect(), selection = document.createElementNS(SVGNS, "rect");
    selection.setAttribute("class", "ms-pen-selection"); selection.setAttribute("x", String((bounds.x + this.delta.x) * rect.width - 5));
    selection.setAttribute("y", String((bounds.y + this.delta.y) * rect.height - 5)); selection.setAttribute("width", String(bounds.width * rect.width + 10));
    selection.setAttribute("height", String(bounds.height * rect.height + 10)); this.overlay.append(selection); this.selectionRect = selection;
  }

  static render(layer: HTMLElement, strokes: Stroke[][], width: number, height: number, color: string, brush: "pen" | "highlight" = "pen", thickness?: number, opacity?: number): void {
    const svg = document.createElementNS(SVGNS, "svg"); svg.classList.add("ms-pen-render");
    svg.setAttribute("width", String(width)); svg.setAttribute("height", String(height)); svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.dataset.inkBrush = brush; if (brush === "highlight" && opacity === undefined) svg.style.opacity = ".32";
    for (const stroke of strokes) renderStroke(svg, stroke, width, height, color, brush, thickness, opacity);
    layer.append(svg);
  }
}
