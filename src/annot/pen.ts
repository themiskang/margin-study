/**
 * [INPUT]: 依赖笔迹几何、指针采样和调用方提供的回调。
 * [OUTPUT]: 提供手写控制器、默认笔色、绘制函数和性能采样接口。
 * [POS]: 处理手写指针输入并通知宿主保存活动状态。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { Stroke } from "../types";
import { cloneStrokes, eraseInk, selectInk, transformSelectedInk } from "./penGeometry";
import type { InkChange, InkRecord, InkSelection, PenTool } from "./penGeometry";
import { inkEndpoint, inkPoint, inkSamples, PalmGuard, predictInkPoint } from "./penInput";
import type { TimedInkPoint } from "./penInput";

let inkPredictionReader: (() => boolean) | null = null;
export const INK_DEFAULT_COLOR = "#000000";
// Lasso cut/copy must survive the controller being rebuilt by an annotation render.
let lassoClipboard: Stroke[][] = [];
export function setInkPredictionReader(reader: () => boolean): void { inkPredictionReader = reader; }

interface PerfStroke {
  down: { ts: number; now: number };
  moves: { ts: number; now: number; coalesced: number }[];
  frames: { t: number; dur: number; raf: number; start: number; end: number; painted: boolean }[];
  up?: { ts: number; now: number };
  commit?: Record<PerfSection, number | null>;
  commitMs?: number;
  timeOrigin: number;
  markPrefix: string;
  marks: Record<PerfMark, number[]>;
  heap: PerfHeapSample[];
  heapUnsupported: boolean;
  longtaskUnsupported: boolean;
  observationEnd?: number;
}
type PerfSection = "commitTotal" | "projectMs" | "staleCompareMs" | "applyMs" | "snapshotMs" | "persistMainMs" | "renderMs" | "cloneMs";
type PerfMark = "down" | "paintBatch" | "up" | "commitStart" | "commitEnd" | "renderAfterCommit";
interface PerfHeapSample { t: number; phase: "down" | "up" | "commitAfter" | "frame"; used: number | null; total: number | null }
interface PerfLongTask { start: number; dur: number; name: string; attribution: string[] }
let activeCommit: PerfStroke["commit"];
export function measurePenCommit<T>(section: PerfSection, action: () => T): T {
  if (!activeCommit) return action();
  const record = activeCommit, start = performance.now();
  try { return action(); } finally { record[section] = (record[section] ?? 0) + performance.now() - start; }
}
const perfLog: PerfStroke[] = [];
const perfLongTasks: PerfLongTask[] = [];
let perfObserver: PerformanceObserver | null = null;
let perfObserverReady = false;
let perfLongtaskUnsupported = false;
let perfSession = 0;
const perfEnabled = (): boolean => (globalThis as typeof globalThis & { __MS_PERF__?: boolean }).__MS_PERF__ === true;
function recordLongTasks(entries: PerformanceEntry[]): void {
  for (const entry of entries) {
    const task = entry as PerformanceEntry & { attribution?: ArrayLike<{ containerType?: string }> };
    perfLongTasks.push({ start: task.startTime, dur: task.duration, name: task.name,
      attribution: Array.from(task.attribution ?? [], attribution => attribution.containerType ?? "unknown") });
  }
}
function ensurePerfObserver(): void {
  if (perfObserverReady) return;
  perfObserverReady = true;
  try {
    if (typeof PerformanceObserver === "undefined" || (PerformanceObserver.supportedEntryTypes && !PerformanceObserver.supportedEntryTypes.includes("longtask"))) {
      perfLongtaskUnsupported = true; return;
    }
    const session = perfSession;
    perfObserver = new PerformanceObserver(list => { if (session === perfSession && perfEnabled()) recordLongTasks(list.getEntries()); });
    perfObserver.observe({ entryTypes: ["longtask"] });
  } catch {
    perfObserver?.disconnect(); perfObserver = null; perfLongtaskUnsupported = true;
  }
}
function perfMark(stroke: PerfStroke, phase: PerfMark): void {
  let time = performance.now();
  try {
    const name = `${stroke.markPrefix}:${phase}`;
    time = performance.mark(name).startTime; performance.clearMarks(name);
  } catch { /* older WebView */ }
  stroke.marks[phase].push(time);
}
function perfHeap(stroke: PerfStroke, phase: PerfHeapSample["phase"]): void {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number } }).memory;
  const used = typeof memory?.usedJSHeapSize === "number" && Number.isFinite(memory.usedJSHeapSize) ? memory.usedJSHeapSize : null;
  const total = typeof memory?.totalJSHeapSize === "number" && Number.isFinite(memory.totalJSHeapSize) ? memory.totalJSHeapSize : null;
  if (used === null || total === null) stroke.heapUnsupported = true;
  stroke.heap.push({ t: performance.now(), phase, used, total });
}
export function startPenPerf(): void {
  perfObserver?.disconnect(); perfObserver = null; perfObserverReady = false; perfLongtaskUnsupported = false;
  perfLongTasks.length = 0; perfSession++;
  perfLog.length = 0;
  (globalThis as typeof globalThis & { __MS_PERF__?: boolean }).__MS_PERF__ = true;
  ensurePerfObserver();
}
export function resetPenPerf(): void {
  (globalThis as typeof globalThis & { __MS_PERF__?: boolean }).__MS_PERF__ = false;
  perfObserver?.disconnect(); perfObserver = null; perfObserverReady = false; perfSession++;
}
export function exportPenPerf(): string {
  if (perfObserver) recordLongTasks(perfObserver.takeRecords());
  const now = performance.now();
  return JSON.stringify(perfLog.map(stroke => ({ ...stroke,
    longTasks: perfLongTasks.filter(task => task.start <= (stroke.observationEnd ?? now) && task.start + task.dur >= stroke.down.now)
  })), null, 2);
}
export function perfEnabledForPen(): boolean { return perfEnabled(); }
export function recordPenPersistence(start: number, end: number): void {
  if (!perfEnabled()) return;
  const stroke = [...perfLog].reverse().find(item => item.up && item.up.now <= start && item.commit);
  if (stroke?.commit) stroke.commit.persistMainMs = (stroke.commit.persistMainMs ?? 0) + end - start;
}

const SVGNS = "http://www.w3.org/2000/svg";
function normCoords(rect: DOMRect, event: PointerEvent): Stroke {
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

export function paintInkStrokes(context: CanvasRenderingContext2D, strokes: Stroke[][], width: number, height: number, color: string | undefined, brush: "pen" | "highlight" = "pen", thickness?: number, opacity?: number, reference = false): void {
  context.save();
  context.strokeStyle = color ?? INK_DEFAULT_COLOR; context.lineCap = "round"; context.lineJoin = "round";
  const alpha = Math.max(0, Math.min(1, opacity ?? 1));
  context.globalAlpha = alpha * (brush === "highlight" && opacity === undefined ? .32 : 1) * (reference ? .35 : 1);
  for (const stroke of strokes) {
    if (!stroke.length) continue;
    const pressure = brush !== "highlight" && stroke.some(point => point.pressure !== undefined);
    if (pressure) {
      for (let index = 1; index < stroke.length; index++) {
        const previous = stroke[index - 1], point = stroke[index];
        context.lineWidth = (thickness ?? 3) / 3 * (0.8 + 5 * ((previous.pressure ?? .5) + (point.pressure ?? .5)) / 2);
        context.beginPath(); context.moveTo(previous.x * width, previous.y * height); context.lineTo(point.x * width, point.y * height); context.stroke();
      }
    } else {
      context.lineWidth = thickness ?? (brush === "highlight" ? 16 : 3);
      context.beginPath();
      stroke.forEach((point, index) => index ? context.lineTo(point.x * width, point.y * height) : context.moveTo(point.x * width, point.y * height));
      if (stroke.length === 1) context.lineTo(stroke[0].x * width, stroke[0].y * height);
      context.stroke();
    }
  }
  context.restore();
}

export function inkHitTest(context: CanvasRenderingContext2D, strokes: Stroke[][], width: number, height: number, point: Stroke, brush: "pen" | "highlight" = "pen", thickness?: number): boolean {
  context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.lineCap = "round"; context.lineJoin = "round";
  try {
    for (const stroke of strokes) {
      if (!stroke.length) continue;
      const pressure = brush !== "highlight" && stroke.some(sample => sample.pressure !== undefined);
      if (pressure) {
        for (let index = 1; index < stroke.length; index++) {
          const previous = stroke[index - 1], current = stroke[index];
          context.lineWidth = (thickness ?? 3) / 3 * (0.8 + 5 * ((previous.pressure ?? .5) + (current.pressure ?? .5)) / 2);
          context.beginPath(); context.moveTo(previous.x * width, previous.y * height); context.lineTo(current.x * width, current.y * height);
          if (context.isPointInStroke(point.x, point.y)) return true;
        }
      } else {
        context.lineWidth = thickness ?? (brush === "highlight" ? 16 : 3); context.beginPath();
        stroke.forEach((sample, index) => index ? context.lineTo(sample.x * width, sample.y * height) : context.moveTo(sample.x * width, sample.y * height));
        if (stroke.length === 1) context.lineTo(stroke[0].x * width, stroke[0].y * height);
        if (context.isPointInStroke(point.x, point.y)) return true;
      }
    }
    return false;
  } finally { context.restore(); }
}

interface PenOptions {
  getColor: () => string;
  getWidth?: () => number;
  getOpacity?: () => number;
  onCommit: (strokes: Stroke[][], brush: "pen" | "highlight", width?: number, opacity?: number) => void;
  onBegin?: () => void;
  onInputActivity?: (activeChange: number) => void;
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
  private samples = new Float64Array(768);
  private sampleCount = 0;
  private previewSamples = new Uint32Array(256);
  private previewCount = 0;
  private currentGroup: SVGGElement | null = null;
  private bounds: DOMRect | null = null;
  private preview: HTMLCanvasElement | null = null;
  private prediction: HTMLCanvasElement | null = null;
  private predictionPoints: TimedInkPoint[] = [];
  private downTime = 0;
  private lastRawTime = -Infinity;
  private previewFrame: number | null = null;
  private previewLastPaint = 0;
  private previewMobile = false;
  private previewContain = "";
  private previewWillChange = "";
  private previewIndex = 1;
  private guide: SVGPathElement | null = null;
  private pointerId: number | null = null;
  private pointerType: string | null = null;
  private palm = new PalmGuard();
  private snapshot: InkRecord[] = [];
  private selection: InkSelection[] = [];
  private selectionRect: SVGRectElement | null = null;
  private toolbar: HTMLDivElement;
  private colorPalette: HTMLDivElement;
  private recognitionButton: HTMLButtonElement;
  private delta: Stroke = { x: 0, y: 0 };
  private temporary = new Map<SVGGElement, number>();
  private perfStroke: PerfStroke | null = null;
  color = "#e53935";

  constructor(private container: HTMLElement, private opts: PenOptions) {
    this.overlay = document.createElementNS(SVGNS, "svg"); this.overlay.classList.add("ms-pen-overlay");
    this.overlay.setAttribute("tabindex", "0"); this.overlay.setAttribute("role", "application");
    this.overlay.setAttribute("aria-label", "手写工具；套索选中后可拖动，Delete 删除，Esc 取消");
    this.container.append(this.overlay); this.overlay.style.pointerEvents = "none"; this.bind();
    // MN5 D-22 order: color / cut / copy / AI text / delete.
    this.toolbar = document.createElement("div");
    this.toolbar.className = "ms-pen-selection-toolbar";
    this.toolbar.setAttribute("role", "toolbar"); this.toolbar.setAttribute("aria-label", "套索工具");
    this.toolbar.style.position = "absolute"; this.toolbar.style.zIndex = "20"; this.toolbar.hidden = true;
    this.colorPalette = document.createElement("div");
    this.colorPalette.className = "ms-pen-color-palette";
    this.colorPalette.setAttribute("role", "group"); this.colorPalette.setAttribute("aria-label", "笔迹颜色");
    this.colorPalette.style.position = "absolute"; this.colorPalette.style.zIndex = "21"; this.colorPalette.hidden = true;
    for (const [label, color] of [
      ["黑色", "#000000"], ["红色", "#e53935"], ["蓝色", "#1e88e5"], ["绿色", "#43a047"], ["黄色", "#ffd54f"],
    ] as const) {
      const swatch = document.createElement("button");
      swatch.type = "button"; swatch.dataset.color = color; swatch.style.background = color;
      swatch.setAttribute("aria-label", `颜色 ${label}`); swatch.title = label;
      swatch.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); this.applySelectionColor(color); });
      this.colorPalette.append(swatch);
    }
    const action = (label: string, run: () => void): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button"; button.textContent = label; button.setAttribute("aria-label", label);
      button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); run(); });
      this.toolbar.append(button); return button;
    };
    action("颜色", () => this.toggleColorPalette());
    action("剪切", () => { this.copySelection(); this.deleteSelection(); });
    action("复制", () => this.copySelection());
    this.recognitionButton = action("AI 转文本", () => this.recognizeSelection());
    action("删除", () => this.deleteSelection());
    this.container.append(this.toolbar, this.colorPalette);
  }
  setTool(tool: PenTool): void {
    if (this.tool === tool) return;
    this.flush(tool !== "erase"); this.tool = tool; this.clearSelection(); this.overlay.dataset.tool = tool;
  }
  setActive(active: boolean): void {
    if (this.active === active) return;
    if (!active) { this.flush(); this.clearSelection(); this.clearTemporary(); }
    this.active = active; this.overlay.style.pointerEvents = active ? "auto" : "none";
    this.container.classList.toggle("ms-pen-mode", active);
  }
  get isActive(): boolean { return this.active; }
  destroy(): void { this.setActive(false); this.flush(); this.clearTemporary(); this.overlay.remove(); this.toolbar.remove(); this.colorPalette.remove(); }

  /** Unfinished drawing is committed unless explicitly cancelled; edit gestures are cancelled. */
  flush(commitDrawing = true): void {
    const gesture = this.gesture;
    if (this.pointerId !== null) this.opts.onInputActivity?.(-1);
    if (this.previewFrame !== null) cancelAnimationFrame(this.previewFrame);
    if (gesture === "draw") {
      if (this.sampleCount && this.previewSamples[this.previewCount - 1] !== this.sampleCount - 1) this.addPreviewSample(this.sampleCount - 1);
      this.paintPreview();
    }
    const stroke: Stroke[] = [];
    if (gesture === "draw" && commitDrawing) {
      for (let index = 0; index < this.sampleCount; index++) {
        const offset = index * 3, pressure = this.samples[offset + 2];
        stroke.push(Number.isNaN(pressure) ? { x: this.samples[offset], y: this.samples[offset + 1] } : { x: this.samples[offset], y: this.samples[offset + 1], pressure });
      }
    }
    this.preview?.remove();
    this.prediction?.remove(); this.prediction = null; this.predictionPoints = []; this.lastRawTime = -Infinity;
    if (gesture === "draw" && this.container.classList.contains("ms-mobile-page")) this.container.classList.remove("is-drawing");
    if (gesture === "draw") {
      this.container.style.contain = this.previewContain; this.container.style.willChange = this.previewWillChange;
    }
    this.previewFrame = null; this.preview = null; this.bounds = null; this.previewIndex = 1; this.previewLastPaint = 0;
    this.gesture = null; this.current = []; this.currentGroup?.remove(); this.currentGroup = null;
    this.guide?.remove(); this.guide = null;
    const pointer = this.pointerId; this.pointerId = null; this.pointerType = null;
    if (pointer !== null && this.overlay.hasPointerCapture?.(pointer)) this.overlay.releasePointerCapture(pointer);
    if (commitDrawing && gesture === "draw") {
      if (stroke.length === 1) stroke.push({ ...stroke[0], x: Math.min(1, stroke[0].x + 0.0001) });
      if (stroke.length) {
        if (this.tool === "draw" && this.opts.isVanishPen?.()) this.renderTemporary(stroke);
        else {
          const perfStroke = this.perfStroke && perfEnabled() ? this.perfStroke : null;
          if (perfStroke) {
            activeCommit = perfStroke.commit = { commitTotal: null, projectMs: null, staleCompareMs: null, applyMs: null, snapshotMs: null, persistMainMs: null, renderMs: null, cloneMs: null };
            perfMark(perfStroke, "commitStart");
          }
          try { measurePenCommit("commitTotal", () => this.opts.onCommit([stroke], this.tool === "highlight" ? "highlight" : "pen", this.opts.getWidth?.(), this.opts.getOpacity?.())); }
          finally {
            activeCommit = undefined;
            if (perfStroke && perfEnabled()) {
              perfMark(perfStroke, "commitEnd"); perfStroke.commitMs = perfStroke.commit?.commitTotal ?? 0; perfHeap(perfStroke, "commitAfter");
              const session = perfSession;
              requestAnimationFrame(() => {
                if (!perfEnabled() || session !== perfSession) return;
                perfMark(perfStroke, "renderAfterCommit"); perfStroke.observationEnd = performance.now();
              });
            }
          }
        }
      }
    }
    this.snapshot = []; this.delta = { x: 0, y: 0 }; this.drawSelection();
    this.perfStroke = null;
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
  private addSample(bounds: DOMRect, event: PointerEvent): void {
    if ((this.sampleCount + 1) * 3 > this.samples.length) {
      const expanded = new Float64Array(this.samples.length * 2); expanded.set(this.samples); this.samples = expanded;
    }
    const offset = this.sampleCount++ * 3;
    this.samples[offset] = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    this.samples[offset + 1] = Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height)));
    this.samples[offset + 2] = event.pointerType === "pen" ? Math.max(.05, Math.min(1, event.pressure || .5)) : NaN;
  }
  private addPreviewSample(index: number): void {
    if (this.previewCount === this.previewSamples.length) {
      const expanded = new Uint32Array(this.previewSamples.length * 2); expanded.set(this.previewSamples); this.previewSamples = expanded;
    }
    this.previewSamples[this.previewCount++] = index;
  }
  private bind(): void {
    this.overlay.addEventListener("pointerdown", (event: PointerEvent) => {
      const perfNow = perfEnabled() ? performance.now() : 0;
      if (this.palm.down(event, this.pointerType)) return;
      if (!this.active || this.gesture || event.button !== 0 || event.isPrimary === false) return;
      this.opts.onInputActivity?.(1);
      if (perfEnabled() && (this.tool === "draw" || this.tool === "highlight")) {
        ensurePerfObserver();
        this.perfStroke = { down: { ts: event.timeStamp, now: perfNow }, moves: [], frames: [], timeOrigin: performance.timeOrigin,
          markPrefix: `MarginStudy:${perfSession}:${perfLog.length + 1}`,
          marks: { down: [], paintBatch: [], up: [], commitStart: [], commitEnd: [], renderAfterCommit: [] },
          heap: [], heapUnsupported: false, longtaskUnsupported: perfLongtaskUnsupported };
        perfLog.push(this.perfStroke); perfMark(this.perfStroke, "down"); perfHeap(this.perfStroke, "down");
      }
      event.preventDefault(); event.stopPropagation(); this.overlay.focus({ preventScroll: true });
      this.bounds = this.container.getBoundingClientRect();
      this.pointerId = event.pointerId; this.pointerType = event.pointerType; this.delta = { x: 0, y: 0 };
      this.downTime = event.timeStamp; this.lastRawTime = -Infinity;
      this.predictionPoints = [{ x: event.clientX, y: event.clientY, time: event.timeStamp }];
      this.sampleCount = 0; this.previewCount = 0;
      if (this.tool === "draw" || this.tool === "highlight") { this.current = []; this.addSample(this.bounds, event); this.addPreviewSample(0); }
      else this.current = [normCoords(this.bounds, event)];
      this.snapshot = this.tool === "draw" || this.tool === "highlight" ? [] : this.records().map((record) => ({ id: record.id, strokes: cloneStrokes(record.strokes) }));
      if (this.tool === "draw" || this.tool === "highlight") {
        this.gesture = "draw"; this.opts.onBegin?.(); this.clearSelection(); this.currentGroup = document.createElementNS(SVGNS, "g"); this.overlay.append(this.currentGroup);
        if (this.container.classList.contains("ms-mobile-page")) this.container.classList.add("is-drawing");
        if (this.tool === "highlight") this.currentGroup.style.opacity = String(this.opts.getOpacity?.() ?? .32);
        else this.currentGroup.style.opacity = String(this.opts.getOpacity?.() ?? 1);
        if (this.tool !== "highlight") this.currentGroup.style.strokeWidth = String(this.opts.getWidth?.() ?? 2);
        this.previewMobile = document.body.classList.contains("is-mobile") || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        this.previewContain = this.container.style.contain; this.previewWillChange = this.container.style.willChange;
        this.container.style.contain = "layout paint"; this.container.style.willChange = "transform";
        this.preview = document.createElement("canvas");
        this.preview.className = "ms-pen-preview";
        this.preview.style.opacity = this.currentGroup.style.opacity;
        const ratio = this.previewMobile ? Math.min(window.devicePixelRatio || 1, 1.25) : window.devicePixelRatio || 1;
        this.preview.width = Math.max(1, Math.ceil(this.bounds.width * ratio)); this.preview.height = Math.max(1, Math.ceil(this.bounds.height * ratio));
        this.preview.style.width = `${this.bounds.width}px`; this.preview.style.height = `${this.bounds.height}px`;
        this.container.append(this.preview);
        this.prediction = document.createElement("canvas");
        this.prediction.className = "ms-pen-preview";
        this.prediction.style.opacity = this.preview.style.opacity;
        this.prediction.width = this.preview.width; this.prediction.height = this.preview.height;
        this.prediction.style.width = this.preview.style.width; this.prediction.style.height = this.preview.style.height;
        this.container.append(this.prediction);
      } else if (this.tool === "erase") this.gesture = "erase";
      else if (this.selection.length && this.selectionContains(this.current[0])) this.gesture = "move";
      else { this.gesture = "lasso"; this.clearSelection(); }
      if (this.gesture === "erase" || this.gesture === "lasso") {
        this.guide = document.createElementNS(SVGNS, "path"); this.guide.setAttribute("class", this.gesture === "erase" ? "ms-pen-erase-trail" : "ms-pen-lasso-trail"); this.overlay.append(this.guide);
      }
      try { this.overlay.setPointerCapture(event.pointerId); } catch { /* synthetic/older WebView */ }
    });
    const onPointerMove = (event: PointerEvent) => {
      const perfNow = this.perfStroke && perfEnabled() ? performance.now() : 0;
      if (this.palm.move(event, this.pointerType)) return;
      if (!this.gesture || event.pointerId !== this.pointerId) return;
      const raw = event.type === "pointerrawupdate";
      if (raw && this.gesture !== "draw") return;
      this.opts.onInputActivity?.(0);
      if (this.perfStroke && perfEnabled()) {
        let coalesced = 1;
        try { coalesced = raw ? 1 : event.getCoalescedEvents?.()?.length ?? 1; } catch { /* unsupported WebView */ }
        this.perfStroke.moves.push({ ts: event.timeStamp, now: perfNow, coalesced });
      }
      event.preventDefault();
      const bounds = this.bounds;
      if (!bounds) return;
      if (this.gesture === "draw") {
        const samples = raw ? [event] : inkSamples(event);
        for (const sample of samples) {
          if (!raw && sample.timeStamp <= this.lastRawTime) continue;
          this.addDrawSample(bounds, sample);
        }
        if (raw) this.lastRawTime = Math.max(this.lastRawTime, event.timeStamp);
      } else for (const sample of inkSamples(event)) this.current.push(normCoords(bounds, sample));
      if (this.gesture === "draw" && this.previewFrame === null) this.previewFrame = requestAnimationFrame((time) => this.schedulePreview(time));
      if (this.guide) this.guide.setAttribute("d", pathData(this.current, bounds.width, bounds.height));
      if (this.gesture === "move") { const last = this.current[this.current.length - 1]; this.delta = { x: last.x - this.current[0].x, y: last.y - this.current[0].y }; this.drawSelection(); }
    };
    this.overlay.addEventListener("pointermove", onPointerMove);
    if ("onpointerrawupdate" in window) this.overlay.addEventListener("pointerrawupdate", onPointerMove as EventListener);
    this.overlay.addEventListener("pointerup", (event: PointerEvent) => {
      const perfNow = this.perfStroke && perfEnabled() ? performance.now() : 0;
      this.palm.end(event, this.pointerType, this.pointerId);
      if (event.pointerId !== this.pointerId) return;
      if (this.perfStroke && perfEnabled()) {
        this.perfStroke.up = { ts: event.timeStamp, now: perfNow };
        perfMark(this.perfStroke, "up"); perfHeap(this.perfStroke, "up");
      }
      if (this.gesture === "draw" && this.bounds && this.sampleCount) {
        const offset = (this.sampleCount - 1) * 3;
        const x = Math.max(0, Math.min(1, (event.clientX - this.bounds.left) / Math.max(1, this.bounds.width)));
        const y = Math.max(0, Math.min(1, (event.clientY - this.bounds.top) / Math.max(1, this.bounds.height)));
        if (Math.abs(this.samples[offset] - x) > 1e-7 || Math.abs(this.samples[offset + 1] - y) > 1e-7) {
          const pressure = this.samples[offset + 2]; this.addSample(this.bounds, event);
          if (event.pointerType === "pen" && !event.pressure && !Number.isNaN(pressure)) this.samples[(this.sampleCount - 1) * 3 + 2] = pressure;
        }
      }
      const last = this.current[this.current.length - 1], endpoint = last && this.bounds && inkEndpoint(event, normCoords(this.bounds, event), last);
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
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") { event.preventDefault(); event.stopPropagation(); this.flush(); this.pasteInk(); }
      else if (["Delete", "Backspace"].includes(event.key) && this.selection.length) {
        event.preventDefault(); event.stopPropagation(); this.opts.onChange?.(transformSelectedInk(this.records(), this.selection, null)); this.clearSelection();
      }
    });
  }
  private addDrawSample(bounds: DOMRect, event: PointerEvent): void {
    const context = this.prediction?.getContext("2d");
    if (context && this.prediction) context.clearRect(0, 0, this.prediction.width, this.prediction.height);
    this.predictionPoints.push({ x: event.clientX, y: event.clientY, time: event.timeStamp });
    if (this.predictionPoints.length > 3) this.predictionPoints.shift();
    this.addSample(bounds, event);
    const offset = (this.sampleCount - 1) * 3, previous = this.previewSamples[this.previewCount - 1] * 3;
    if (Math.hypot((this.samples[offset] - this.samples[previous]) * bounds.width, (this.samples[offset + 1] - this.samples[previous + 1]) * bounds.height) > .75) this.addPreviewSample(this.sampleCount - 1);
  }
  private schedulePreview(time: number): void {
    const perfStroke = perfEnabled() ? this.perfStroke : null;
    const start = perfStroke ? performance.now() : 0;
    this.previewLastPaint = time; this.paintPreview();
    if (perfStroke) this.recordPerfFrame(perfStroke, time, start, true);
  }
  private recordPerfFrame(stroke: PerfStroke, raf: number, start: number, painted: boolean): void {
    const end = performance.now();
    stroke.frames.push({ t: raf, dur: end - start, raf, start, end, painted });
    if (stroke.frames.length % 10 === 0) perfHeap(stroke, "frame");
  }
  private paintPreview(): void {
    this.previewFrame = null;
    const bounds = this.bounds, canvas = this.preview, context = canvas?.getContext("2d");
    if (!bounds || !canvas || !context) return;
    if (this.perfStroke && perfEnabled()) perfMark(this.perfStroke, "paintBatch");
    context.setTransform(canvas.width / Math.max(1, bounds.width), 0, 0, canvas.height / Math.max(1, bounds.height), 0, 0);
    context.strokeStyle = this.opts.getColor(); context.lineCap = "round"; context.lineJoin = "round";
    for (; this.previewIndex < this.previewCount; this.previewIndex++) {
      const previous = this.previewSamples[this.previewIndex - 1] * 3, point = this.previewSamples[this.previewIndex] * 3;
      const pressure = this.samples[point + 2], previousPressure = this.samples[previous + 2];
      context.lineWidth = this.tool === "highlight" ? this.opts.getWidth?.() ?? 16 : Number.isNaN(pressure) ? this.opts.getWidth?.() ?? 2 :
        (this.opts.getWidth?.() ?? 3) / 3 * (0.8 + 5 * ((Number.isNaN(previousPressure) ? 0.5 : previousPressure) + pressure) / 2);
      context.beginPath(); context.moveTo(this.samples[previous] * bounds.width, this.samples[previous + 1] * bounds.height);
      context.lineTo(this.samples[point] * bounds.width, this.samples[point + 1] * bounds.height); context.stroke();
    }
    const predictionCanvas = this.prediction, predictionContext = predictionCanvas?.getContext("2d");
    if (!predictionCanvas || !predictionContext) return;
    predictionContext.clearRect(0, 0, predictionCanvas.width, predictionCanvas.height);
    if (this.pointerType !== "pen" || this.tool !== "draw" || !(inkPredictionReader?.() ?? this.previewMobile)) return;
    const predicted = predictInkPoint(this.predictionPoints, this.downTime);
    if (!predicted) return;
    const last = this.predictionPoints[this.predictionPoints.length - 1];
    predictionContext.setTransform(predictionCanvas.width / Math.max(1, bounds.width), 0, 0, predictionCanvas.height / Math.max(1, bounds.height), 0, 0);
    predictionContext.strokeStyle = this.opts.getColor(); predictionContext.lineCap = "round";
    const pressure = this.samples[(this.sampleCount - 1) * 3 + 2];
    predictionContext.lineWidth = (this.opts.getWidth?.() ?? 3) / 3 * (0.8 + 5 * (Number.isNaN(pressure) ? .5 : pressure));
    predictionContext.beginPath(); predictionContext.moveTo(last.x - bounds.left, last.y - bounds.top);
    predictionContext.lineTo(predicted.x - bounds.left, predicted.y - bounds.top); predictionContext.stroke();
  }
  private clearSelection(): void { this.selection = []; this.selectionRect?.remove(); this.selectionRect = null; this.toolbar.hidden = true; this.colorPalette.hidden = true; }
  private toggleColorPalette(): void {
    if (!this.selection.length) return;
    this.colorPalette.hidden = !this.colorPalette.hidden;
  }
  private applySelectionColor(color: string): void {
    const selected = new Map(this.selection.map(entry => [entry.id, new Set(entry.indexes)]));
    const changes: InkChange[] = this.records().flatMap((record) => {
      if (!selected.get(record.id)?.size || record.color === color) return [];
      return [{ id: record.id, before: cloneStrokes(record.strokes), after: cloneStrokes(record.strokes), color: { before: record.color, after: color } }];
    });
    this.colorPalette.hidden = true;
    if (!changes.length) return;
    this.opts.onBegin?.(); this.opts.onChange?.(changes); this.drawSelection();
  }
  private copySelection(): void {
    const selected = new Map(this.selection.map(entry => [entry.id, new Set(entry.indexes)]));
    lassoClipboard = this.records().flatMap((record) => record.strokes.filter((_, index) => selected.get(record.id)?.has(index))).map(stroke => stroke.map(point => ({ ...point })));
  }
  private deleteSelection(): void {
    if (!this.selection.length) return;
    this.opts.onBegin?.(); this.opts.onChange?.(transformSelectedInk(this.records(), this.selection, null)); this.clearSelection();
  }
  private pasteInk(): void {
    if (!lassoClipboard.length) return;
    this.opts.onBegin?.(); this.opts.onCommit(cloneStrokes(lassoClipboard), this.tool === "highlight" ? "highlight" : "pen");
  }
  private recognizeSelection(): void {
    const bounds = this.selectionBounds(); if (!bounds) return;
    const rect = this.container.getBoundingClientRect(), selected = new Map(this.selection.map(entry => [entry.id, new Set(entry.indexes)]));
    const canvas = document.createElement("canvas"), padding = 16;
    const width = Math.max(1, bounds.width * rect.width), height = Math.max(1, bounds.height * rect.height);
    const scale = Math.min(1, 2000 / Math.max(width, height));
    canvas.width = Math.ceil(width * scale + padding * 2); canvas.height = Math.ceil(height * scale + padding * 2);
    const context = canvas.getContext("2d"); if (!context) return;
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "black"; context.lineWidth = 3; context.lineCap = "round"; context.lineJoin = "round";
    for (const record of this.records()) for (const [index, stroke] of record.strokes.entries()) {
      if (!selected.get(record.id)?.has(index) || !stroke.length) continue;
      context.beginPath();
      stroke.forEach((point, pointIndex) => {
        const x = padding + (point.x - bounds.x) * rect.width * scale, y = padding + (point.y - bounds.y) * rect.height * scale;
        if (pointIndex) context.lineTo(x, y); else context.moveTo(x, y);
      });
      if (stroke.length === 1) context.lineTo(padding + (stroke[0].x - bounds.x) * rect.width * scale + .1, padding + (stroke[0].y - bounds.y) * rect.height * scale);
      context.stroke();
    }
    this.container.dispatchEvent(new CustomEvent("ms-recognize-ink", { bubbles: true, detail: { image: canvas.toDataURL("image/png") } }));
  }
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
    const bounds = this.selectionBounds(); if (!bounds) { this.toolbar.hidden = true; this.colorPalette.hidden = true; return; }
    const rect = this.container.getBoundingClientRect(), selection = document.createElementNS(SVGNS, "rect");
    selection.setAttribute("class", "ms-pen-selection"); selection.setAttribute("x", String((bounds.x + this.delta.x) * rect.width - 5));
    selection.setAttribute("y", String((bounds.y + this.delta.y) * rect.height - 5)); selection.setAttribute("width", String(bounds.width * rect.width + 10));
    selection.setAttribute("height", String(bounds.height * rect.height + 10)); this.overlay.append(selection); this.selectionRect = selection;
    this.toolbar.hidden = false;
    this.toolbar.style.left = `${Math.max(0, bounds.x * rect.width)}px`;
    this.toolbar.style.top = `${Math.max(0, bounds.y * rect.height - 32)}px`;
    this.colorPalette.style.left = `${Math.max(0, bounds.x * rect.width)}px`;
    this.colorPalette.style.top = `${Math.max(0, bounds.y * rect.height + 4)}px`;
  }

  static render(layer: HTMLElement, strokes: Stroke[][], width: number, height: number, color: string | undefined, brush: "pen" | "highlight" = "pen", thickness?: number, opacity?: number): void {
    const svg = document.createElementNS(SVGNS, "svg"); svg.classList.add("ms-pen-render");
    svg.setAttribute("width", String(width)); svg.setAttribute("height", String(height)); svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.dataset.inkBrush = brush; if (brush === "highlight" && opacity === undefined) svg.style.opacity = ".32";
    for (const stroke of strokes) renderStroke(svg, stroke, width, height, color ?? INK_DEFAULT_COLOR, brush, thickness, opacity);
    layer.append(svg);
  }
}
