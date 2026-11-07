import { el } from "../utils/dom";
import { uid } from "../utils/id";
import { eraseInk, selectInk } from "../annot/penGeometry";
import { openTextModal, openConfirm } from "../utils/modal";
import type { HandwritingMode, MindmapHandwriting, MindmapInkPoint, MindmapInkStroke } from "./handwritingContracts";
import { createMindmapInkStroke, visibleMindmapInkLayers } from "./handwritingSvg";

const SVG_NS = "http://www.w3.org/2000/svg";
function svg<T extends keyof SVGElementTagNameMap>(name: T, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[T] {
  const result = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, String(value));
  return result;
}
function emptyInk(): MindmapHandwriting { return { version: 1, layers: [{ id: "default", name: "Default", strokes: [] }], activeLayerId: "default" }; }
function cloneInk(data?: MindmapHandwriting): MindmapHandwriting { return data ? JSON.parse(JSON.stringify(data)) : emptyInk(); }
function path(points: MindmapInkPoint[]): string { return points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" "); }

interface CanvasInkOptions {
  canvasId(): string | undefined;
  read(canvasId: string): MindmapHandwriting | undefined;
  write(canvasId: string, data: MindmapHandwriting, label: string): void;
  onModeChange(mode: HandwritingMode): void;
  preset(mode: "pen" | "highlight"): { width: number } | undefined;
  updateWidth(mode: "pen" | "highlight", width: number): void;
  undo(): void;
  redo(): void;
}

/** Canvas ink owns pointer gestures and its palette; persistence stays behind the map adapter. */
export class MindmapHandwritingController {
  private surface = svg("svg", { class: "ms-map-ink", tabindex: "0", role: "application", "aria-label": "脑图手写画布" });
  private saved = svg("g");
  private live = svg("g");
  private preview: { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; buffer: HTMLCanvasElement | null; bufferContext: CanvasRenderingContext2D | null; rendered: number; left: number; top: number; scale: number; dpr: number; width: number; height: number; frame: number } | null = null;
  private selectionGroup = svg("g");
  private palette = el("div", { class: "ms-map-ink-palette", role: "toolbar", "aria-label": "脑图手写工具" });
  private mode: HandwritingMode = "off";
  private renderedCanvasId: string | undefined;
  private pointerId: number | null = null;
  private drawing: { canvasId: string; data: MindmapHandwriting; stroke: MindmapInkStroke; lineMode: "off" | "auto" | "always" } | null = null;
  private editing: { kind: "erase" | "lasso" | "move"; canvasId: string; data: MindmapHandwriting; trail: MindmapInkPoint[] } | null = null;
  private selected = new Set<string>();
  private deleteButton = el("button", { type: "button", "aria-label": "删除选中笔迹", title: "删除选中笔迹", text: "×" });
  private penColor = "#30343b";
  private highlightColor = "#ffd54f";
  private penWidth = 3;
  private highlightWidth = 16;
  private penOpacity = 1;
  private highlightOpacity = .32;
  private lineMode: "off" | "auto" | "always" = "off";
  private colorInput = el("input", { type: "color", "aria-label": "脑图笔迹颜色", title: "笔迹颜色" });
  private widthInput = el("input", { type: "range", min: ".5", max: "24", step: ".1", "aria-label": "脑图笔迹粗细", title: "笔迹粗细" });
  private settings: HTMLElement | null = null;
  private editingLayers = false;

  constructor(private world: HTMLElement, private root: HTMLElement, private options: CanvasInkOptions) {
    this.surface.append(this.saved, this.live, this.selectionGroup); world.append(this.surface); root.append(this.palette);
    const settings = el("button", { type: "button", text: "A•", "aria-label": "脑图手写设置", title: "脑图手写设置" });
    settings.addEventListener("click", () => { if (this.settings) this.closeSettings(); else { this.settings = el("section", { class: "ms-map-ink-settings", role: "region", "aria-label": "脑图手写设置面板" }); this.root.append(this.settings); this.renderSettings(); } }); this.palette.append(settings);
    for (const [mode, label, glyph] of [
      ["pen", "画笔", "M5 19l3.5-1L20 6.5 16.5 3 5 14.5V19ZM14 5.5l3.5 3.5"],
      ["highlight", "荧光笔", "M6 15l8-11 6 5-9 10-5-4ZM5 16l-2 5h7l1-2M13 6l5 4"],
      ["eraser", "整笔橡皮", "M3 13l10-10 8 8-10 10H7l-4-4v-4ZM8 8l8 8M10 21h11"],
      ["lasso", "套索", "M20 12c0 5-9 8-14 4C0 11 5 4 13 5c8 1 10 9 3 14-3 2-6 0-5-2 1-3 5-1 5 2"],
      ["off", "结束脑图手写", "M8 12V5a1.5 1.5 0 0 1 3 0v7-9a1.5 1.5 0 0 1 3 0v9-6a1.5 1.5 0 0 1 3 0v7-3a1.5 1.5 0 0 1 3 0v5c0 4-2 7-6 7h-2c-3 0-5-3-7-6l-2-3a1.5 1.5 0 0 1 2-2l3 2Z"],
    ] as [HandwritingMode, string, string][]) {
      const button = el("button", { type: "button", "aria-label": label, title: label });
      const icon = svg("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
      icon.append(svg("path", { d: glyph })); button.append(icon);
      button.dataset.inkMode = mode; button.addEventListener("click", () => options.onModeChange(mode)); this.palette.append(button);
    }
    this.colorInput.addEventListener("change", () => { if (this.mode === "highlight") this.highlightColor = this.colorInput.value; else this.penColor = this.colorInput.value; });
    this.widthInput.addEventListener("input", () => {
      const width = Number(this.widthInput.value);
      if (this.mode === "highlight") this.highlightWidth = width; else this.penWidth = width;
      if (this.mode === "pen" || this.mode === "highlight") this.options.updateWidth(this.mode, width);
    });
    this.palette.append(this.colorInput, this.widthInput);
    this.deleteButton.hidden = true; this.deleteButton.addEventListener("click", () => this.deleteSelection()); this.palette.append(this.deleteButton);
    for (const [label, glyph, action] of [
      ["撤销脑图手写", "M8 5l-5 5 5 5M3 10h10a7 7 0 0 1 7 7", () => this.history(false)],
      ["重做脑图手写", "M16 5l5 5-5 5M21 10H11a7 7 0 0 0-7 7", () => this.history(true)],
    ] as [string, string, () => void][]) {
      const button = el("button", { type: "button", "aria-label": label, title: label }), icon = svg("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
      icon.append(svg("path", { d: glyph })); button.append(icon); button.addEventListener("click", action); this.palette.append(button);
    }
    this.surface.addEventListener("pointerdown", (event) => this.down(event));
    this.surface.addEventListener("pointermove", (event) => this.move(event));
    this.surface.addEventListener("pointerup", (event) => this.up(event));
    const cancel = (event: PointerEvent) => { if (event.pointerId === this.pointerId) this.cancel(); };
    this.surface.addEventListener("pointercancel", cancel);
    this.surface.addEventListener("lostpointercapture", cancel);
    this.surface.addEventListener("dblclick", (event) => { if (this.mode !== "off") { event.preventDefault(); event.stopPropagation(); } });
    this.surface.addEventListener("keydown", (event) => {
      if (this.mode === "off") return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.stopPropagation(); this.history(event.shiftKey); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.cancel(); this.clearSelection(); }
      else if (["Delete", "Backspace"].includes(event.key) && this.selected.size) { event.preventDefault(); event.stopPropagation(); this.deleteSelection(); }
    });
    this.setMode("off");
  }

  setMode(mode: HandwritingMode): void {
    if (this.mode !== mode) { this.commitDrawing(); this.cancel(); this.clearSelection(); }
    this.mode = mode; this.surface.style.pointerEvents = mode === "off" ? "none" : "auto";
    this.palette.hidden = mode === "off"; this.root.classList.toggle("is-map-handwriting", mode !== "off");
    if (mode === "off") this.closeSettings();
    if (mode === "pen" || mode === "highlight") {
      const preset = this.options.preset(mode);
      if (preset) {
        if (mode === "highlight") this.highlightWidth = preset.width;
        else this.penWidth = preset.width;
      }
    }
    this.surface.dataset.inkMode = mode;
    this.colorInput.value = mode === "highlight" ? this.highlightColor : this.penColor;
    this.widthInput.max = mode === "highlight" ? "64" : "24";
    this.widthInput.value = String(mode === "highlight" ? this.highlightWidth : this.penWidth);
    this.renderSettings();
    this.palette.querySelectorAll<HTMLElement>("[data-ink-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.inkMode === mode)));
  }

  render(): void {
    const canvasId = this.options.canvasId();
    if (canvasId !== this.renderedCanvasId) { this.commitDrawing(); this.clearSelection(); this.renderedCanvasId = canvasId; }
    const data = canvasId ? cloneInk(this.options.read(canvasId)) : emptyInk(); this.saved.replaceChildren();
    for (const layer of visibleMindmapInkLayers(data)) {
      const group = svg("g", { "data-map-ink-layer": layer.id });
      if (layer.id !== data.activeLayerId) group.setAttribute("opacity", ".55");
      for (const stroke of layer.strokes) group.append(createMindmapInkStroke(stroke)); this.saved.append(group);
    }
    this.drawSelection();
    this.renderSettings();
  }

  getExtent(): { right: number; bottom: number } {
    const id = this.options.canvasId(), data = id ? this.options.read(id) : undefined;
    let right = 0, bottom = 0;
    for (const point of data?.layers.flatMap((layer) => layer.strokes.flatMap((stroke) => stroke.points)) ?? []) { right = Math.max(right, point.x); bottom = Math.max(bottom, point.y); }
    return { right, bottom };
  }

  dispose(): void { this.commitDrawing(); this.cancel(); this.closeSettings(); this.surface.remove(); this.palette.remove(); this.root.classList.remove("is-map-handwriting"); }

  private closeSettings(): void { this.settings?.remove(); this.settings = null; this.editingLayers = false; }
  private changeData(label: string, action: (data: MindmapHandwriting) => void): void {
    this.commitDrawing(); this.cancel(); this.clearSelection(); const canvasId = this.options.canvasId(); if (!canvasId) return;
    const data = cloneInk(this.options.read(canvasId)); action(data); this.options.write(canvasId, data, label); this.render();
  }
  private renderSettings(): void {
    if (!this.settings) return;
    const canvasId = this.options.canvasId(), data = canvasId ? cloneInk(this.options.read(canvasId)) : emptyInk();
    this.settings.replaceChildren(); const header = el("div", { class: "ms-map-ink-settings-header" });
    const close = el("button", { type: "button", text: "×", "aria-label": "关闭脑图手写设置" }); close.addEventListener("click", () => this.closeSettings());
    header.append(el("strong", { text: "MindMap Handwriting Settings" }), close); this.settings.append(header);
    const brush = el("fieldset", { class: "ms-map-brush-settings" });
    brush.append(el("legend", { text: this.mode === "highlight" ? "荧光笔设置" : "画笔设置" }));
    const opacityLabel = el("label", { text: "Opacity / 透明度" }), opacity = el("input", { type: "range", min: "0", max: "1", step: ".05", "aria-label": "脑图画笔透明度" });
    opacity.value = String(this.mode === "highlight" ? this.highlightOpacity : this.penOpacity);
    const amount = el("output", { text: opacity.value });
    opacity.addEventListener("input", () => { const value = Number(opacity.value); if (this.mode === "highlight") this.highlightOpacity = value; else this.penOpacity = value; amount.textContent = opacity.value; });
    opacityLabel.append(opacity, amount);
    const lineLabel = el("label", { text: "Straight Line / 直线" }), line = el("select", { "aria-label": "脑图直线模式" });
    for (const [value, text] of [["off", "Off"], ["auto", "Auto"], ["always", "Always"]]) line.append(el("option", { value, text }));
    line.value = this.lineMode; line.addEventListener("change", () => { this.lineMode = line.value as typeof this.lineMode; }); lineLabel.append(line);
    brush.append(opacityLabel, lineLabel, el("p", { class: "ms-map-ink-layer-hint", text: "仅影响新脑图笔迹。Auto 将接近直线的轨迹拉直；偏好保留至关闭此视图。文档与卡片画笔独立。" }));
    this.settings.append(brush);
    const title = el("div", { class: "ms-map-ink-layer-title" }), edit = el("button", { type: "button", text: this.editingLayers ? "完成" : "Edit", "aria-label": "编辑手写图层", "aria-pressed": String(this.editingLayers) });
    edit.addEventListener("click", () => { this.editingLayers = !this.editingLayers; this.renderSettings(); }); title.append(el("span", { text: "Sketch Layers" }), edit); this.settings.append(title);
    const list = el("div", { class: "ms-map-ink-layers", role: "radiogroup", "aria-label": "当前编辑的手写图层" });
    for (const layer of data.layers) {
      const row = el("div", { class: "ms-map-ink-layer-row" }), choose = el("button", { type: "button", role: "radio", "aria-checked": String(layer.id === data.activeLayerId), "aria-label": `编辑图层 ${layer.name}`, "data-ink-layer": layer.id });
      choose.append(el("span", { text: layer.name }), el("span", { class: "ms-map-ink-layer-check", text: layer.id === data.activeLayerId ? "✓" : "" }));
      choose.addEventListener("click", () => this.changeData("切换脑图手写图层", (next) => { next.activeLayerId = layer.id; if (next.overlayLayerId === layer.id) delete next.overlayLayerId; })); row.append(choose);
      if (this.editingLayers) {
        const actions = el("div", { class: "ms-map-ink-layer-actions" });
        const rename = el("button", { type: "button", text: "重命名", "aria-label": `重命名图层 ${layer.name}` });
        rename.addEventListener("click", () => openTextModal({ title: "重命名手写图层", initial: layer.name, onOk: (name) => { if (name.trim()) this.changeData("重命名脑图手写图层", (next) => { const target = next.layers.find((candidate) => candidate.id === layer.id); if (target) target.name = name.trim().slice(0, 120); }); } }));
        const remove = el("button", { type: "button", text: "删除", "aria-label": `删除图层 ${layer.name}` }); remove.disabled = data.layers.length < 2;
        remove.addEventListener("click", () => openConfirm("删除手写图层", `删除手写图层“${layer.name}”及其中笔迹？`, () => this.changeData("删除脑图手写图层", (next) => { next.layers = next.layers.filter((candidate) => candidate.id !== layer.id); if (next.activeLayerId === layer.id) next.activeLayerId = next.layers[0].id; if (next.overlayLayerId === layer.id || next.overlayLayerId === next.activeLayerId) delete next.overlayLayerId; })));
        actions.append(rename, remove);
        if (layer.id !== data.activeLayerId) {
          const merge = el("button", { type: "button", text: "合并至当前", "aria-label": `合并图层 ${layer.name} 到当前图层` });
          merge.addEventListener("click", () => this.changeData("合并脑图手写图层", (next) => {
            const target = next.layers.find((candidate) => candidate.id === next.activeLayerId), source = next.layers.find((candidate) => candidate.id === layer.id); if (!target || !source) return;
            target.strokes.push(...source.strokes); next.layers = next.layers.filter((candidate) => candidate.id !== layer.id); if (next.overlayLayerId === layer.id) delete next.overlayLayerId;
          })); actions.append(merge);
        }
        row.append(actions);
      }
      list.append(row);
    }
    this.settings.append(list);
    const create = el("button", { type: "button", class: "ms-map-ink-new-layer", "aria-label": "新建手写图层", text: "+  New Sketch Layer" });
    create.addEventListener("click", () => openTextModal({ title: "新建手写图层", initial: `Sketch Layer ${data.layers.length + 1}`, onOk: (name) => { if (name.trim()) this.changeData("新建脑图手写图层", (next) => { const id = uid("ink-layer"); next.layers.push({ id, name: name.trim().slice(0, 120), strokes: [] }); next.activeLayerId = id; }); } }));
    this.settings.append(create);
    const overlayLabel = el("label", { class: "ms-map-ink-overlay-label", text: "只读叠加图层" }), overlay = el("select", { "aria-label": "只读叠加手写图层" });
    overlay.append(el("option", { value: "", text: "不叠加" })); for (const layer of data.layers.filter((candidate) => candidate.id !== data.activeLayerId)) overlay.append(el("option", { value: layer.id, text: layer.name }));
    overlay.value = data.overlayLayerId ?? ""; overlay.addEventListener("change", () => this.changeData("切换脑图只读叠加图层", (next) => { if (overlay.value) next.overlayLayerId = overlay.value; else delete next.overlayLayerId; }));
    overlayLabel.append(overlay); this.settings.append(overlayLabel, el("p", { class: "ms-map-ink-layer-hint", text: "笔迹保存在当前图层；叠加图层仅供参考。" }));
  }

  private point(event: PointerEvent): MindmapInkPoint {
    const bounds = this.world.getBoundingClientRect(), scale = bounds.width / Math.max(1, this.world.offsetWidth);
    return { x: Math.max(0, (event.clientX - bounds.left) / scale), y: Math.max(0, (event.clientY - bounds.top) / scale),
      ...(event.pointerType === "pen" ? { pressure: Math.min(1, Math.max(.05, event.pressure || .5)) } : {}) };
  }
  private down(event: PointerEvent): void {
    const canvasId = this.options.canvasId();
    if (this.mode === "off" || this.pointerId !== null || !canvasId || event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault(); event.stopPropagation(); this.surface.focus({ preventScroll: true }); this.pointerId = event.pointerId;
    if (this.mode === "pen" || this.mode === "highlight") { this.clearSelection(); this.drawing = { canvasId, data: cloneInk(this.options.read(canvasId)), lineMode: this.lineMode, stroke: { id: uid("ink"), opacity: this.mode === "highlight" ? this.highlightOpacity : this.penOpacity, tool: this.mode, color: this.mode === "highlight" ? this.highlightColor : this.penColor, width: this.mode === "highlight" ? this.highlightWidth : this.penWidth, points: [this.point(event)] } }; }
    else if (this.mode === "eraser") { this.clearSelection(); this.editing = { kind: "erase", canvasId, data: cloneInk(this.options.read(canvasId)), trail: [this.point(event)] }; }
    else if (this.mode === "lasso") {
      const point = this.point(event), bounds = this.selectionBounds(), moving = bounds && point.x >= bounds.left - 8 && point.x <= bounds.right + 8 && point.y >= bounds.top - 8 && point.y <= bounds.bottom + 8;
      if (!moving) this.clearSelection();
      this.editing = { kind: moving ? "move" : "lasso", canvasId, data: cloneInk(this.options.read(canvasId)), trail: [point] };
    }
    this.drawLive(); try { this.surface.setPointerCapture(event.pointerId); } catch { /* Synthetic dispatch and older WebViews lack active pointer capture. */ }
  }
  private move(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault(); const samples = event.getCoalescedEvents?.() ?? [];
    for (const sample of samples.length ? samples : [event]) {
      const point = this.point(sample); this.drawing?.stroke.points.push(point); this.editing?.trail.push(point);
    }
    this.drawLive();
  }
  private up(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    if (this.drawing) {
      const point = this.point(event), previous = this.drawing.stroke.points[this.drawing.stroke.points.length - 1];
      if (event.pointerType === "pen" && !event.pressure) point.pressure = previous.pressure;
      this.drawing.stroke.points.push(point);
      this.paintPreview();
    }
    if (this.editing) {
      const edit = this.editing; edit.trail.push(this.point(event)); this.cancel();
      const layer = edit.data.layers.find((layer) => layer.id === edit.data.activeLayerId);
      const current = cloneInk(this.options.read(edit.canvasId)), target = current.layers.find((candidate) => candidate.id === edit.data.activeLayerId);
      if (layer && target) {
        const records = layer.strokes.map((stroke) => ({ id: stroke.id, strokes: [stroke.points] }));
        if (edit.kind === "erase") {
          const removed = new Set(eraseInk(records, edit.trail, 1, 1).filter((change) => !change.after.length).map((change) => change.id));
          if (removed.size) { target.strokes = target.strokes.filter((stroke) => !removed.has(stroke.id)); this.options.write(edit.canvasId, current, "擦除脑图笔画"); }
        } else if (edit.kind === "lasso") this.selected = new Set(selectInk(records, edit.trail).map((selection) => selection.id));
        else {
          const delta = this.moveDelta(edit.trail);
          if (delta.x || delta.y) {
            for (const stroke of target.strokes.filter((stroke) => this.selected.has(stroke.id))) stroke.points = stroke.points.map((point) => ({ ...point, x: point.x + delta.x, y: point.y + delta.y }));
            this.options.write(edit.canvasId, current, "移动脑图笔迹");
          }
        }
      }
      this.render(); return;
    }
    this.commitDrawing();
  }
  private drawLive(): void {
    if (this.drawing) {
      if (!this.preview) this.startPreview();
      this.paintPreview();
      return;
    }
    this.live.replaceChildren();
    if (this.editing?.kind === "erase") this.live.append(svg("path", { d: path(this.editing.trail), fill: "none", stroke: "#777", "stroke-width": "18", "stroke-linecap": "round", opacity: ".25" }));
    else if (this.editing?.kind === "lasso") this.live.append(svg("path", { d: path(this.editing.trail), fill: "none", stroke: "#448aff", "stroke-width": "1.5", "stroke-dasharray": "5 4" }));
    if (this.editing?.kind === "move") {
      const delta = this.moveDelta(this.editing.trail);
      this.saved.querySelectorAll<SVGElement>("[data-map-ink-stroke]").forEach((group) => { if (this.selected.has(group.dataset.mapInkStroke!)) group.setAttribute("transform", `translate(${delta.x} ${delta.y})`); });
      this.drawSelection(delta);
    }
  }
  private startPreview(): void {
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
    if (!context) return;
    canvas.className = "ms-map-ink-preview";
    this.root.append(canvas);
    const opacity = this.drawing?.stroke.opacity ?? (this.drawing?.stroke.tool === "highlight" ? .32 : 1);
    const buffer = opacity < 1 ? document.createElement("canvas") : null, bufferContext = buffer?.getContext("2d") ?? null;
    if (buffer && !bufferContext) { canvas.remove(); return; }
    this.preview = { canvas, context, buffer, bufferContext, rendered: 0, left: NaN, top: NaN, scale: NaN, dpr: 0, width: 0, height: 0, frame: 0 };
    window.addEventListener("resize", this.resizePreview);
    const tick = () => {
      if (!this.preview) return;
      this.paintPreview();
      if (this.preview) this.preview.frame = requestAnimationFrame(tick);
    };
    this.preview.frame = requestAnimationFrame(tick);
  }
  private resizePreview = (): void => { this.paintPreview(true); };
  private paintPreview(force = false): void {
    const preview = this.preview, drawing = this.drawing;
    if (!preview || !drawing) return;
    const bounds = this.world.getBoundingClientRect(), scale = bounds.width / Math.max(1, this.world.offsetWidth);
    const dpr = window.devicePixelRatio || 1, width = window.innerWidth, height = window.innerHeight;
    const rootBounds = this.root.getBoundingClientRect();
    const offsetLeft = `${-rootBounds.left - this.root.clientLeft + this.root.scrollLeft}px`, offsetTop = `${-rootBounds.top - this.root.clientTop + this.root.scrollTop}px`;
    if (preview.canvas.style.left !== offsetLeft) preview.canvas.style.left = offsetLeft;
    if (preview.canvas.style.top !== offsetTop) preview.canvas.style.top = offsetTop;
    const viewport = this.world.closest(".ms-mindmap")?.getBoundingClientRect() ?? this.root.getBoundingClientRect();
    const rectangle = (bounds: DOMRect) => `M ${bounds.left} ${bounds.top} H ${bounds.right} V ${bounds.bottom} H ${bounds.left} Z`;
    const clip = `path(evenodd, "${rectangle(viewport)}")`;
    if (preview.canvas.style.clipPath !== clip) preview.canvas.style.clipPath = clip;
    const sizeChanged = preview.dpr !== dpr || preview.width !== width || preview.height !== height;
    const changed = sizeChanged || preview.left !== bounds.left || preview.top !== bounds.top || preview.scale !== scale;
    if (sizeChanged) {
      preview.canvas.width = Math.round(width * dpr); preview.canvas.height = Math.round(height * dpr);
      preview.context.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (preview.buffer && preview.bufferContext) {
        preview.buffer.width = preview.canvas.width; preview.buffer.height = preview.canvas.height;
        preview.bufferContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
    if (changed || force || drawing.lineMode !== "off") {
      preview.context.clearRect(0, 0, width, height); preview.rendered = 0;
      preview.bufferContext?.clearRect(0, 0, width, height);
    }
    preview.left = bounds.left; preview.top = bounds.top; preview.scale = scale; preview.dpr = dpr; preview.width = width; preview.height = height;
    const stroke = this.straightStroke(drawing.stroke, drawing.lineMode), points = stroke.points, context = preview.bufferContext ?? preview.context;
    context.lineCap = "round"; context.lineJoin = "round"; context.strokeStyle = stroke.color; context.globalAlpha = preview.buffer ? 1 : (stroke.opacity ?? (stroke.tool === "highlight" ? .32 : 1));
    const pressure = stroke.tool !== "highlight" && points.some((point) => point.pressure !== undefined);
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (let index = Math.max(1, preview.rendered); index < points.length; index++) {
      const previous = points[index - 1], point = points[index];
      context.lineWidth = stroke.width * scale * (pressure ? .25 + 1.5 * ((previous.pressure ?? .5) + (point.pressure ?? .5)) / 2 : 1);
      const x1 = bounds.left + previous.x * scale, y1 = bounds.top + previous.y * scale, x2 = bounds.left + point.x * scale, y2 = bounds.top + point.y * scale, margin = context.lineWidth / 2 + 2 / dpr;
      context.beginPath(); context.moveTo(x1, y1);
      context.lineTo(x2, y2); context.stroke();
      if (preview.buffer) {
        left = Math.min(left, x1 - margin, x2 - margin); top = Math.min(top, y1 - margin, y2 - margin);
        right = Math.max(right, x1 + margin, x2 + margin); bottom = Math.max(bottom, y1 + margin, y2 + margin);
      }
    }
    if (preview.buffer && left < right && top < bottom) {
      const x = Math.max(0, Math.floor(left * dpr)), y = Math.max(0, Math.floor(top * dpr));
      const endX = Math.min(preview.canvas.width, Math.ceil(right * dpr)), endY = Math.min(preview.canvas.height, Math.ceil(bottom * dpr));
      if (endX > x && endY > y) {
        preview.context.clearRect(x / dpr, y / dpr, (endX - x) / dpr, (endY - y) / dpr);
        preview.context.globalAlpha = stroke.opacity ?? (stroke.tool === "highlight" ? .32 : 1);
        preview.context.drawImage(preview.buffer, x, y, endX - x, endY - y, x / dpr, y / dpr, (endX - x) / dpr, (endY - y) / dpr);
      }
    }
    preview.rendered = points.length;
  }
  private history(redo: boolean): void { this.commitDrawing(); this.cancel(); this.clearSelection(); if (redo) this.options.redo(); else this.options.undo(); this.render(); }
  private clearSelection(): void { this.selected.clear(); this.selectionGroup.replaceChildren(); this.deleteButton.hidden = true; }
  private selectionBounds(): { left: number; right: number; top: number; bottom: number } | null {
    const id = this.options.canvasId(), data = id ? this.options.read(id) : undefined;
    const points = data?.layers.find((layer) => layer.id === data.activeLayerId)?.strokes.filter((stroke) => this.selected.has(stroke.id)).flatMap((stroke) => stroke.points) ?? [];
    if (!points.length) return null;
    const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    for (const point of points) { bounds.left = Math.min(bounds.left, point.x); bounds.right = Math.max(bounds.right, point.x); bounds.top = Math.min(bounds.top, point.y); bounds.bottom = Math.max(bounds.bottom, point.y); }
    return bounds;
  }
  private moveDelta(trail: MindmapInkPoint[]): MindmapInkPoint {
    const bounds = this.selectionBounds(), last = trail[trail.length - 1];
    return { x: Math.max(-(bounds?.left ?? 0), last.x - trail[0].x), y: Math.max(-(bounds?.top ?? 0), last.y - trail[0].y) };
  }
  private drawSelection(delta: MindmapInkPoint = { x: 0, y: 0 }): void {
    this.selectionGroup.replaceChildren(); const bounds = this.selectionBounds(); this.deleteButton.hidden = !bounds;
    if (!bounds) return;
    this.selectionGroup.append(svg("rect", { "aria-label": "已选中的脑图笔迹", x: bounds.left + delta.x - 5, y: bounds.top + delta.y - 5, width: bounds.right - bounds.left + 10, height: bounds.bottom - bounds.top + 10, fill: "#448aff0c", stroke: "#448aff", "stroke-width": "1.5", "stroke-dasharray": "5 4" }));
  }
  private deleteSelection(): void {
    const canvasId = this.options.canvasId(); if (!canvasId || !this.selected.size) return;
    this.cancel(); const data = cloneInk(this.options.read(canvasId)), layer = data.layers.find((layer) => layer.id === data.activeLayerId);
    if (layer) { layer.strokes = layer.strokes.filter((stroke) => !this.selected.has(stroke.id)); this.clearSelection(); this.options.write(canvasId, data, "删除脑图笔迹"); this.render(); }
  }
  private straightStroke(stroke: MindmapInkStroke, mode: "off" | "auto" | "always"): MindmapInkStroke {
    if (mode === "off" || stroke.points.length < 3) return stroke;
    const first = stroke.points[0], last = stroke.points[stroke.points.length - 1];
    const dx = last.x - first.x, dy = last.y - first.y, length = Math.hypot(dx, dy);
    // Auto accepts only small deviations from the finite start/end segment.
    const nearLine = length >= 12 && stroke.points.every(point => {
      const t = Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / (length * length)));
      return Math.hypot(point.x - first.x - t * dx, point.y - first.y - t * dy) <= Math.max(3, length * .025);
    });
    return mode === "always" || nearLine ? { ...stroke, points: [first, last] } : stroke;
  }
  private commitDrawing(): void {
    const drawing = this.drawing; this.drawing = null; this.cancel();
    if (!drawing) return;
    const current = cloneInk(this.options.read(drawing.canvasId)), layer = current.layers.find((layer) => layer.id === drawing.data.activeLayerId);
    if (!layer) return;
    if (drawing.stroke.points.length === 1) drawing.stroke.points.push({ ...drawing.stroke.points[0], x: drawing.stroke.points[0].x + .01 });
    layer.strokes.push(this.straightStroke(drawing.stroke, drawing.lineMode)); this.options.write(drawing.canvasId, current, "脑图手写"); this.render();
  }
  private cancel(): void {
    this.drawing = null; this.editing = null; const pointer = this.pointerId; this.pointerId = null; this.live.replaceChildren();
    if (this.preview) { cancelAnimationFrame(this.preview.frame); this.preview.canvas.remove(); this.preview = null; window.removeEventListener("resize", this.resizePreview); }
    this.saved.querySelectorAll<SVGElement>("[transform]").forEach((group) => group.removeAttribute("transform")); this.drawSelection();
    if (pointer !== null && this.surface.hasPointerCapture?.(pointer)) this.surface.releasePointerCapture(pointer);
  }
}
