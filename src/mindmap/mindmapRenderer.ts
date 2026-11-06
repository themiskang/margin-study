import { applyCardTypography } from "../cards/typography";
import { Menu, Notice, setIcon } from "obsidian";
import type MarginStudyPlugin from "../main";
import { MindNode, Edge, BRANCH_STYLES } from "../types";
import type { HandwritingPresetSpec } from "../types";
import { handwritingPresetWidth, handwritingPresets } from "../annot/handwritingPresets";
import { el, clear } from "../utils/dom";
import { openTextModal, openConfirm, createModal, openImageLightbox } from "../utils/modal";
import { uid } from "../utils/id";
import { excerptSourceButton, jumpToCardSource } from "../cards/cardView";
import { displayedExcerptBlocks } from "../cards/excerptBlocks";
import { renderMarkdown, hasCloze, clozeHint } from "../utils/markdown";
import { exportMindmapPng } from "../export/mindmapExport";
import { nodeContent } from "../study/nodeContent";
import { cardCommentItems } from "../cards/commentOrder";
import { notebookMeta } from "../annot/documentNotebooks";
import { appendSources, imageUrl } from "../review/content";
import { addCommonCardActions, closeCardActionMenu, detachNode, openNodeSplit, showNodeActions, stopCardActionSpeech, trackCardActionMenu } from "../study/nodeActions";
import { ReaderView } from "../pdf/readerView";
import { maskEmphasis, revealAt } from "../study/reveal";
import { validOcclusions } from "../review/questions";
import { BOARD_DRAG_TYPE, copyBoardCards } from "../board/boardModel";
import { OutlineRenderer } from "../outline/outlineRenderer";
import { CardBoardRenderer } from "../board/cardBoardRenderer";
import { reviewDrawingInput } from "../review/drawing";
import { MindmapHandwritingController } from "./handwriting";
import type { HandwritingMode } from "./handwritingContracts";
import { cardClipboard } from "../study/cardClipboard";
import { CARD_COLORS } from "../model/cardColors";

const SVG_NS = "http://www.w3.org/2000/svg";
const PINCH_WHEEL_EXPONENT = 0.01346909075675091;
const WHEEL_LINE_HEIGHT_CSS_PX = 16;
const VIEW_OVERSCROLL_RATIO = 4;
const MIN_VIEW_OVERSCROLL_CSS = 240;
const VIEW_INITIAL_INSET_CSS = 52;

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function basename(p: string): string {
  return p.split("/").pop()?.replace(/\.pdf$/i, "") ?? p;
}

export interface MindmapRendererOptions {
  /** 是否显示顶部工具栏（侧边栏集成时建议显示） */
  showToolbar?: boolean;
  /** 子脑图：仅渲染该节点子树 */
  subtreeRoot?: string;
  /** Workspace chrome based on the native app's right-hand floating controls. */
  nativeChrome?: boolean;
  onOpenOutline?: () => void;
  onOpenBoard?: () => void;
  onHandwrite?: () => void;
  onHandwritingModeChange?: (mode: HandwritingMode) => void;
  onSelectionChange?: (nodes: readonly MindNode[]) => void;
}

/**
 * 可复用的思维导图渲染器。
 * 供 MindmapView 与 SidebarView 共用，负责 DOM、事件、渲染、交互的全部逻辑。
 */
export class MindmapRenderer {
  plugin: MarginStudyPlugin;
  private options: MindmapRendererOptions;

  private root: HTMLElement | null = null;
  private world: HTMLElement | null = null;
  private canvasWrap: HTMLElement | null = null;
  private scrollEl: HTMLElement | null = null;
  private svg: SVGElement | null = null;
  private nodeEls = new Map<string, HTMLElement>();
  private edgeEls = new Map<string, { path: SVGElement; label?: SVGElement }>();
  private connectMode = false;
  private pendingFrom: string | null = null;
  private dragged = false;
  private selectedIds = new Set<string>();
  private selectionSource: "direct" | "linked" = "direct";
  private multiSelect = false;
  private multiSelectBtn: HTMLButtonElement | null = null;
  private focusId: string | null = null;
  private reviewMode: "" | "mask" | "title" | "expand" | "recite" = "";
  private maxDepth = 1;
  private recallHierarchyDepth = 8;
  private recallCollapsed = new Set<string>();
  private wasRecallActive = false;
  private revealedIds = new Set<string>();
  private layeredOpenIds = new Set<string>();
  private revealedImageMasks = new Set<string>();
  private revealedEmphasis = new Set<string>();
  private showHidden = false;
  private transientVisibleIds = new Set<string>();
  private renderedCanvasId: string | undefined;
  private reciteIdx = 0;
  private immersive = false;
  private reviewControlBtn: HTMLButtonElement | null = null;
  private toolbarEl: HTMLElement | null = null;
  private nodeToolbarEl: HTMLElement | null = null;
  private toolbarResize: ResizeObserver | null = null;
  private positionToolbarBound = (): void => this.positionNodeToolbar();
  private nativeCanvasButton: HTMLButtonElement | null = null;
  private nativePanel: HTMLElement | null = null;
  private nativePanelKind: "outline" | "board" | null = null;
  private nativePanelRenderer: OutlineRenderer | CardBoardRenderer | null = null;
  private handwriting: MindmapHandwritingController | null = null;
  private handwritingMode: HandwritingMode = "off";
  private handwritingListeners = new Set<(mode: HandwritingMode) => void>();

  // 视图缩放/平移
  private viewScale = 1;
  private baseW = 2000;
  private baseH = 1400;
  private rafId = 0;
  private renderAfterDrag = false;
  private pinchFrame = 0;
  private pinchPending: { x: number; y: number; factor: number } | null = null;
  private pinchGeom: { scrollRect: DOMRect; worldRect: DOMRect; worldOffsetW: number; scaleStart: number; scrollLeft: number; scrollTop: number } | null = null;
  private viewportResize: ResizeObserver | null = null;
  private viewportResizeFrame = 0;
  private positionViewOnNextApply = true;
  private viewportW = 0;
  private viewportH = 0;
  private viewGutterX = 0;
  private viewGutterY = 0;

  // 绑定后的监听句柄，便于 destroy 移除
  private onWheelBound = (e: WheelEvent): void => this.onWheel(e);
  private onCanvasPointerDownBound = (e: PointerEvent): void => this.onCanvasPointerDown(e);
  private finishCanvasPan: (() => void) | null = null;
  private finishNodeDrag: (() => void) | null = null;
  private touchPoints = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;

  constructor(plugin: MarginStudyPlugin, options: MindmapRendererOptions = {}) {
    this.plugin = plugin;
    this.options = options;
  }

  /** 将导图挂载到指定父元素（可重复调用以迁移 DOM） */
  mount(parent: HTMLElement): void {
    if (!this.root) {
      this.root = el("div", {
        class: "ms-mindmap-root" + (this.options.nativeChrome ? " is-native-chrome" : ""),
        style: "display:flex;flex-direction:column;height:100%;overflow:hidden",
      });
      this.root.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && (this.multiSelect || this.selectedIds.size)) {
          event.preventDefault();
          event.stopPropagation();
          this.exitSelection();
        }
      });

      if (this.options.showToolbar !== false && !this.options.nativeChrome) {
        const toolbar = el("div", { class: "ms-toolbar" });
        this.toolbarEl = toolbar;
        this.buildToolbar(toolbar);
        this.root.append(toolbar);
        if (this.plugin.store.settings.immersive) {
          toolbar.style.display = "none";
          this.root.classList.add("is-immersive");
          this.immersive = true;
        }
      }

      this.scrollEl = el("div", { class: "ms-mindmap", style: "flex:1;min-height:0;min-width:0;touch-action:none" });
      this.canvasWrap = el("div", { class: "ms-mindmap-canvas", style: "position:relative" });
      this.world = el("div", {
        class: "ms-mindmap-world",
        style: "position:absolute;left:0;top:0;width:2000px;height:1400px;transform-origin:0 0",
      });
      this.svg = svgEl("svg", {
        class: "ms-mindmap-svg",
        style: "position:absolute;inset:0;overflow:visible;pointer-events:none",
      });
      this.world.append(this.svg);
      this.canvasWrap.append(this.world);
      this.scrollEl.append(this.canvasWrap);
      this.root.append(this.scrollEl);
      this.handwriting = new MindmapHandwritingController(this.world, this.root, {
        canvasId: () => this.currentCanvasId(),
        read: (id) => this.plugin.store.canvases.find((canvas) => canvas.id === id)?.handwriting,
        write: (id, handwriting, label) => {
          this.plugin.store.libraryTransaction(label, () => this.plugin.store.updateCanvas(id, { handwriting }));
          this.render(); this.plugin.refreshSidebar();
        },
        onModeChange: (mode) => this.setHandwritingMode(mode),
        preset: (mode) => {
          const preset = this.mindmapHandwritingPreset(mode);
          return preset ? { width: handwritingPresetWidth(preset, "mindmap") } : undefined;
        },
        updateWidth: (mode, width) => this.updateMindmapHandwritingWidth(mode, width),
        undo: () => { this.plugin.store.undoLibraryChange(); this.render(); this.plugin.refreshSidebar(); },
        redo: () => { this.plugin.store.redoLibraryChange(); this.render(); this.plugin.refreshSidebar(); },
      });
      this.handwriting.setMode(this.handwritingMode);
      if (this.options.nativeChrome) this.buildNativeChrome();

      this.nodeToolbarEl = el("div", {
        class: "ms-node-toolbar ms-selection-actions", role: "toolbar", "aria-label": "卡片选择操作",
        style: "display:none",
      });
      this.buildNodeToolbar(this.nodeToolbarEl);
      this.root.append(this.nodeToolbarEl);
      this.scrollEl.addEventListener("scroll", this.positionToolbarBound);
      this.toolbarResize = new ResizeObserver(this.positionToolbarBound);
      this.toolbarResize.observe(this.root);
      this.toolbarResize.observe(this.nodeToolbarEl);
      this.viewportResize = new ResizeObserver(() => {
        if (this.viewportResizeFrame) return;
        this.viewportResizeFrame = requestAnimationFrame(() => {
          this.viewportResizeFrame = 0;
          if (this.scrollEl && (this.scrollEl.clientWidth !== this.viewportW || this.scrollEl.clientHeight !== this.viewportH)) this.applyView();
        });
      });
      this.viewportResize.observe(this.scrollEl);

      this.scrollEl.addEventListener("dblclick", (e) => this.onCanvasDblClick(e));
      this.scrollEl.addEventListener("wheel", this.onWheelBound, { passive: false });
      this.scrollEl.addEventListener("pointerdown", this.onTouchPointerDown, true);
      this.scrollEl.addEventListener("pointerdown", this.onCanvasPointerDownBound);
      this.scrollEl.addEventListener("dragover", (e) => this.onDragOver(e));
      this.scrollEl.addEventListener("drop", (e) => this.onDrop(e));
    }

    parent.append(this.root);
    this.render();
  }

  private mindmapHandwritingPreset(mode: "pen" | "highlight"): HandwritingPresetSpec | undefined {
    const presets = handwritingPresets(this.plugin.store.getEffectiveSceneSettings());
    const activeId = this.plugin.activeReader?.getActiveHandwritingPreset?.();
    const match = presets.find(preset => preset.id === activeId);
    if ((mode === "highlight") === (match?.type === "highlighter") && match) return match;
    return presets.find(preset => (mode === "highlight") === (preset.type === "highlighter"));
  }

  private updateMindmapHandwritingWidth(mode: "pen" | "highlight", width: number): void {
    const target = this.mindmapHandwritingPreset(mode);
    if (!target) return;
    const presets = handwritingPresets(this.plugin.store.getEffectiveSceneSettings()).map(preset => preset.id === target.id ? { ...preset, mindmapWidth: width } : preset);
    this.plugin.store.setEffectiveSceneSettings({handwritingPresets:presets});
    this.plugin.store.save();
  }

  /** 清理 DOM 与事件监听 */
  destroy(): void {
    closeCardActionMenu();
    stopCardActionSpeech();
    this.finishCanvasPan?.();
    this.finishNodeDrag?.();
    this.clearTouchPointers();
    this.viewportResize?.disconnect(); this.viewportResize = null;
    if (this.viewportResizeFrame) { cancelAnimationFrame(this.viewportResizeFrame); this.viewportResizeFrame = 0; }
    this.toolbarResize?.disconnect(); this.toolbarResize = null;
    this.scrollEl?.removeEventListener("scroll", this.positionToolbarBound);
    this.handwriting?.dispose(); this.handwriting = null;
    this.handwritingListeners.clear();
    this.nativePanelRenderer?.dispose(); this.nativePanelRenderer = null;
    this.nativePanel = null; this.nativeCanvasButton = null;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.scrollEl) {
      this.scrollEl.removeEventListener("wheel", this.onWheelBound);
      this.scrollEl.removeEventListener("pointerdown", this.onTouchPointerDown, true);
      this.scrollEl.removeEventListener("pointerdown", this.onCanvasPointerDownBound);
    }
    this.root?.remove();
    this.root = null;
    this.world = null;
    this.canvasWrap = null;
    this.scrollEl = null;
    this.svg = null;
    this.nodeEls.clear();
    this.edgeEls.clear();
  }

  dispose(): void { this.destroy(); }

  getHandwritingMode(): HandwritingMode { return this.handwritingMode; }
  /** Recall hierarchy is a view-only mind-map depth, not the document mask scope. */
  setRecallHierarchy(level: number): void {
    if (!Number.isInteger(level) || level < 1 || level > 8) return;
    this.recallHierarchyDepth = level;
    this.revealedIds.clear();
    this.layeredOpenIds.clear();
    this.render();
  }
  getRecallHierarchy(): number { return this.recallHierarchyDepth; }

  clearTemporaryReveal(): void { this.transientVisibleIds.clear(); this.render(); }
  resetRecallState(): void { this.revealedIds.clear(); this.layeredOpenIds.clear(); this.revealedImageMasks.clear(); this.revealedEmphasis.clear(); this.recallCollapsed.clear(); this.render(); }
  resetRecallReveals(): void { this.revealedIds.clear(); this.revealedImageMasks.clear(); this.revealedEmphasis.clear(); this.render(); }
  setHandwritingMode(mode: HandwritingMode): void {
    if (this.handwritingMode === mode) return;
    this.handwritingMode = mode;
    if (mode !== "off") { this.connectMode = false; this.pendingFrom = null; this.exitSelection(); this.root?.classList.remove("is-connect-mode"); }
    this.handwriting?.setMode(mode);
    this.root?.querySelector('[data-native-tool="hand"]')?.classList.toggle("is-active", mode === "off");
    this.root?.querySelector('[data-native-tool="ink"]')?.classList.toggle("is-active", mode !== "off");
    this.options.onHandwritingModeChange?.(mode);
    for (const callback of this.handwritingListeners) callback(mode);
  }
  subscribeHandwritingModeChange(callback: (mode: HandwritingMode) => void): () => void { this.handwritingListeners.add(callback); return () => this.handwritingListeners.delete(callback); }

  captureViewport(): { scale: number; x: number; y: number } {
    return { scale: this.viewScale, x: (this.scrollEl?.scrollLeft ?? 0) - this.viewGutterX, y: (this.scrollEl?.scrollTop ?? 0) - this.viewGutterY };
  }
  restoreViewport(view: { scale: number; x: number; y: number }): void {
    if (!this.scrollEl || !Number.isFinite(view.scale) || !Number.isFinite(view.x) || !Number.isFinite(view.y)) return;
    this.viewScale = Math.max(.1, Math.min(6, view.scale)); this.positionViewOnNextApply = false; this.applyView();
    this.scrollEl.scrollLeft = this.viewGutterX + view.x; this.scrollEl.scrollTop = this.viewGutterY + view.y;
  }
  selectedViewNode(): MindNode | undefined { const selected=this.selectedNodes();return selected.length===1?selected[0]:undefined; }
  openSelectedChildMap(): void { this.openChildMap(); }
  captureBoardViewport(): { x: number; y: number } { const body=this.nativePanelKind==="board"?this.nativePanel?.querySelector<HTMLElement>(".ms-board-body"):null;return {x:body?.scrollLeft??0,y:body?.scrollTop??0}; }
  openFixedView(kind: "canvas" | "submap" | "board" | "local", nodeId: string | undefined, view: { scale: number; x: number; y: number }, boardView?: { x: number; y: number }): boolean {
    const node=nodeId?this.plugin.store.getNode(nodeId):undefined;
    if ((kind==="submap"||kind==="local")&&(!node||node.canvasId!==this.currentCanvasId())) return false;
    if (kind==="submap") {
      const {modal}=createModal("子脑图："+(node!.title||"(空)"),()=>child.destroy());
      const wrap=el("div",{style:"width:min(80vw,700px);height:70vh;position:relative"});
      const child=new MindmapRenderer(this.plugin,{showToolbar:true,subtreeRoot:nodeId});modal.append(wrap);child.mount(wrap);child.render();child.restoreViewport(view);return true;
    }
    this.focusId=kind==="local"?nodeId!:null;this.render();this.restoreViewport(view);
    if(kind==="board"&&this.nativePanelKind!=="board")this.toggleNativePanel("board");
    else if(kind!=="board"&&this.nativePanelKind==="board")this.toggleNativePanel("board");
    if(kind==="board"&&boardView){const body=this.nativePanel?.querySelector<HTMLElement>(".ms-board-body");if(body){body.scrollLeft=boardView.x;body.scrollTop=boardView.y;}}
    return true;
  }

  private nativeIcon(label: string, icon: string, action: (event: MouseEvent) => void): HTMLButtonElement {
    const button = el("button", { type: "button", class: "ms-native-map-icon", title: label, "aria-label": label });
    const glyphs: Record<string, string> = {
      hand: "M10.2 3.5a1.5 1.5 0 0 1 3 0v7.1l2.1.3 3.3.9a2.3 2.3 0 0 1 1.6 2.5l-.7 5.2a3.3 3.3 0 0 1-3.3 2.9h-4c-1.2 0-2.3-.5-3.1-1.3l-4.2-4.2a1.8 1.8 0 0 1 0-2.5c.6-.6 1.4-.7 2.1-.3l3.2 2V3.5Z",
      copy: "M4 7h2v12h12v2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm6-5h5.8L21 7.2V16a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm5 1.8V8h4.2L15 3.8Z",
      spline: "M2.5 11.8c2.4 8.2 5.5 10.1 6.2 5.8.5-3.3-4.1-7.4-1.5-8.1 2.4-.7 4.4 6.8 7.1 5.4 3-1.6-3.2-8.9.2-9.1 1.5-.1 3 3.2 4.7 2.6M19.2 3.3l2.3 1.8-1 2.3",
    };
    if (glyphs[icon]) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("d", glyphs[icon]);
      if (icon === "spline") {
        svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.7");
        svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
      } else { svg.setAttribute("fill", "currentColor"); svg.setAttribute("stroke", "none"); path.setAttribute("fill-rule", "evenodd"); }
      svg.append(path); button.append(svg); button.dataset.nativeGlyph = icon;
    } else setIcon(button, icon);
    button.addEventListener("click", (event) => { event.stopPropagation(); action(event); }); return button;
  }

  private buildNativeChrome(): void {
    this.nativeCanvasButton = el("button", { type: "button", class: "ms-native-canvas-menu", "aria-label": "选择脑图" });
    this.nativeCanvasButton.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem(item => item.setTitle("大纲").onClick(() => this.options.onOpenOutline ? this.options.onOpenOutline() : this.toggleNativePanel("outline")));
      menu.addItem(item => item.setTitle("卡片分组看板 ⌃⌘M").onClick(() => this.openBoard()));
      menu.addItem(item => item.setTitle("多选 ⌥⌘M").setChecked(this.multiSelect).onClick(() => this.toggleSceneMultiSelect()));
      menu.addItem(item => item.setTitle("工具 ▸").onClick((click) => this.openMapToolMenu(click)));
      for (const canvas of this.plugin.store.canvases.filter((candidate) => candidate.studySetId === this.plugin.store.activeStudySetId && candidate.kind !== "review")) {
        menu.addItem((item) => item.setTitle((canvas.id === this.currentCanvasId() ? "✓ " : "") + canvas.name).onClick(() => { this.plugin.store.setActiveCanvas(canvas.id); this.render(); this.plugin.refreshSidebar(); }));
      }
      menu.addItem((item) => item.setTitle("新建脑图…").onClick(() => {
        openTextModal({ title: "新建脑图", initial: "新脑图", onOk: (name) => {
          if (!name.trim()) return;
          const store = this.plugin.store;
          if (!store.activeStudySetId) store.createStudySet(name.trim());
          else store.setActiveCanvas(store.createCanvas(store.activeStudySetId, name.trim()).id);
          this.render(); this.plugin.refreshSidebar();
        } });
      }));
      menu.addItem((item) => item.setTitle("脑图工具与设置…").onClick(() => this.openNativeTools()));
      menu.addItem((item) => item.setTitle("新建手绘卡片…").onClick(() => this.options.onHandwrite ? this.options.onHandwrite() : this.openDrawingCard()));
      menu.showAtMouseEvent(event);
    });
    this.root!.append(this.nativeCanvasButton);
  }

  openBoard(): void {
    if (this.options.onOpenBoard) this.options.onOpenBoard(); else this.toggleNativePanel("board");
  }

  private openMapToolMenu(event: MouseEvent | KeyboardEvent): void {
    const menu = new Menu();
    menu.addItem(item => item.setTitle("手形工具").setChecked(this.handwritingMode === "off" && !this.connectMode && !this.multiSelect).onClick(() => {
      this.setHandwritingMode("off"); this.connectMode = false; this.pendingFrom = null; this.exitSelection(); this.root?.classList.remove("is-connect-mode");
    }));
    menu.addItem(item => item.setTitle("复制与粘贴 ▸").onClick(click => {
      const copy = new Menu();
      copy.addItem(entry => entry.setTitle("复制选中卡片").setDisabled(!this.selectedIds.size).onClick(() => this.copyNodes()));
      copy.addItem(entry => entry.setTitle("粘贴独立副本").setDisabled(!cardClipboard.fragment).onClick(() => this.pasteNodes("clone")));
      copy.addItem(entry => entry.setTitle("粘贴共享引用").setDisabled(!cardClipboard.fragment).onClick(() => this.pasteNodes("reference")));
      copy.showAtPosition({x: click instanceof MouseEvent ? click.clientX : 0, y: click instanceof MouseEvent ? click.clientY : 0});
    }));
    menu.addItem(item => item.setTitle("连接卡片").setChecked(this.connectMode).onClick(() => this.toggleSceneConnectMode()));
    menu.addItem(item => item.setTitle("脑图手写").setChecked(this.handwritingMode !== "off").onClick(() => this.setHandwritingMode(this.handwritingMode === "off" ? "pen" : "off")));
    menu.showAtPosition({x: event instanceof MouseEvent ? event.clientX : 0, y: event instanceof MouseEvent ? event.clientY : 0});
  }

  private toggleNativePanel(kind: "outline" | "board"): void {
    const closeOnly = this.nativePanelKind === kind;
    this.nativePanelRenderer?.dispose(); this.nativePanelRenderer = null;
    this.nativePanel?.remove(); this.nativePanel = null; this.nativePanelKind = null;
    if (closeOnly) return;
    this.nativePanelKind = kind;
    const mode = this.plugin.store.getStudyScene(this.plugin.store.activeStudySetId ?? "")?.interfaceMode;
    this.nativePanel = el("aside", { class: "ms-map-floating-panel" + (kind === "outline" ? mode === "traditional" ? " is-outline-replacement" : " is-outline-overlay" : ""), "aria-label": kind === "outline" ? "大纲面板" : "卡片分组看板面板" });
    const header = el("div", { class: "ms-map-floating-header" });
    header.append(el("span", { text: kind === "outline" ? "Outline" : "Cards" }), this.nativeIcon("关闭面板", "x", () => this.toggleNativePanel(kind)));
    const body = el("div", { class: "ms-map-floating-body" }); this.nativePanel.append(header, body); this.root!.append(this.nativePanel);
    const onSelect = (cardId: string) => {
      this.revealCard(cardId);
      this.plugin.viewEvents?.onMindmapCardSelect?.(cardId);
    };
    this.nativePanelRenderer = kind === "outline" ? new OutlineRenderer(this.plugin, { nativeChrome: true, onChange: () => this.render(), onSelect })
      : new CardBoardRenderer(this.plugin, { nativeChrome: true, onChange: () => this.render(), onSelect });
    this.nativePanelRenderer.mount(body);
  }

  private notifyUserCardSelection(cardId: string): void {
    this.nativePanelRenderer?.revealCard(cardId);
    this.plugin.viewEvents?.onMindmapCardSelect?.(cardId);
  }

  private openNativeTools(): void {
    const { modal } = createModal("脑图工具");
    const tools = el("div", { class: "ms-native-tools-menu ms-toolbar" });
    const multi = this.multiSelectBtn, review = this.reviewControlBtn;
    this.buildToolbar(tools); this.multiSelectBtn?.remove(); this.multiSelectBtn = multi; this.reviewControlBtn = review;
    modal.append(tools);
  }

  private openDrawingCard(): void {
    const { modal, close } = createModal("手绘卡片");
    const cardPen = this.mindmapHandwritingPreset("pen");
    const drawing = reviewDrawingInput(cardPen ? { color: cardPen.color, width: handwritingPresetWidth(cardPen, "card"), opacity: cardPen.opacity } : {}); (drawing.element as HTMLDetailsElement).open = true;
    drawing.element.querySelector("summary")!.textContent = "手绘内容";
    const canvas = drawing.element.querySelector("canvas")!;
    canvas.setAttribute("aria-label", "在此绘制手绘卡片");
    const save = el("button", { class: "ms-btn primary", text: "添加到脑图" });
    save.addEventListener("click", () => {
      if (!drawing.value()?.some((stroke) => stroke.length)) { new Notice("请先绘制内容"); return; }
      this.plugin.store.libraryTransaction("添加手绘卡片", () => {
        const id = uid("card");
        this.plugin.store.addCard({ id, docPath: "", type: "comment", front: "", image: canvas.toDataURL("image/png"), tags: [], links: [], createdAt: new Date().toISOString() });
        this.plugin.store.addNode({ id: uid("node"), cardId: id, title: "", canvasId: this.currentCanvasId(), parentId: null, x: 100, y: 100, collapsed: false });
      });
      close(); this.render(); this.plugin.refreshSidebar();
    });
    modal.append(drawing.element, save);
  }

  /** Locate a card inside this canvas without echoing a user-selection event. */
  revealCard(cardId: string, source: "direct" | "linked" = "direct"): boolean {
    if (!this.world) return false;
    const card = this.plugin.store.getCard(cardId);
    const targetId = card?.groupId ?? cardId;
    const candidates = this.scopedNodes().filter((node) => node.cardId === targetId && !this.isGroupedMember(node));
    const node = candidates.find((candidate) => this.nodeEls.has(candidate.id)) ?? candidates[0];
    if (!node) return false;
    const lineage: MindNode[] = [node];
    const visited = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId && !visited.has(parentId)) {
      const parent = this.plugin.store.getNode(parentId);
      if (!parent || parent.canvasId !== node.canvasId) break;
      visited.add(parent.id); lineage.push(parent); parentId = parent.parentId;
    }
    if (this.options.subtreeRoot && !visited.has(this.options.subtreeRoot)) return false;
    if (this.renderedCanvasId !== this.currentCanvasId()) { this.revealedIds.clear(); this.renderedCanvasId = this.currentCanvasId(); }
    this.focusId = null;
    this.transientVisibleIds = new Set(lineage.map((ancestor) => ancestor.id));
    if (this.reviewMode === "expand") this.maxDepth = Math.max(this.maxDepth, this.depthOf(node));
    this.setSearch("");
    const search = this.root?.querySelector<HTMLInputElement>(".ms-mm-search");
    if (search) search.value = "";
    this.multiSelect = false;
    this.selectSingle(node.id, source);
    this.render();
    const element = this.nodeEls.get(node.id);
    if (!element) return false;
    element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    this.nativePanelRenderer?.revealCard(cardId);
    return true;
  }

  // ===== 工具栏 =====
  private buildToolbar(toolbar: HTMLElement): void {
    clear(toolbar);
    const btn = (label: string, title: string, cb: () => void, toggle = false) => {
      const b = el("button", { class: "ms-tb-btn", text: label, title });
      b.style.width = "auto";
      b.style.padding = "0 8px";
      b.addEventListener("click", () => {
        cb();
        if (toggle) b.classList.toggle("is-active");
      });
      return b;
    };
    toolbar.append(
      this.multiSelectBtn = btn("多选", "进入多选模式，逐张点击卡片累计选择", () => this.setMultiSelect(!this.multiSelect)),
      btn("导入范围卡片", "把当前学习集或文档中的卡片引用到本脑图", () => this.importCards()),
      btn("新建节点", "在画布双击也可新建", () => this.newNodeAt(120, 120)),
      btn("手写", "在脑图画布上直接书写", () => this.setHandwritingMode(this.handwritingMode === "off" ? "pen" : "off")),
      btn("粘贴克隆", "把剪贴板子树作为独立内容加入本脑图", () => this.pasteNodes("clone")),
      btn("粘贴引用", "把剪贴板子树作为共享引用加入本脑图", () => this.pasteNodes("reference")),
      btn("连线模式", "开启后依次点击两个节点建立关联", () => this.toggleConnect(), true),
      btn("自动布局", "按层级重新排布", () => {
        this.autoLayout();
        this.render();
      }),
      btn("焦点", "聚焦选中节点的子树（再次点击退出）", () => this.toggleFocus(), true)
    );
    toolbar.append(btn("显示隐藏", "显示此脑图中被隐藏的节点，便于恢复", () => {
      this.showHidden = !this.showHidden;
      this.render();
    }, true));
    toolbar.append(
      btn("撤销", "撤销上一次内容或关系变更", () => {
        if (!this.plugin.store.undoLibraryChange()) new Notice("没有可撤销的变更");
        this.plugin.refreshSidebar();
        this.plugin.refreshMindmap();
      }),
      btn("重做", "重做刚才撤销的变更", () => {
        if (!this.plugin.store.redoLibraryChange()) new Notice("没有可重做的变更");
        this.plugin.refreshSidebar();
        this.plugin.refreshMindmap();
      })
    );

    // 分支样式（10 种预设）
    const layoutSel = el("select", { class: "ms-select", title: "分支样式" }) as HTMLSelectElement;
    layoutSel.append(el("option", { value: "", text: "布局" }) as HTMLOptionElement);
    for (const s of BRANCH_STYLES) layoutSel.append(el("option", { value: s.id, text: s.name }) as HTMLOptionElement);
    layoutSel.value = this.plugin.store.settings.layout;
    layoutSel.addEventListener("change", () => {
      this.plugin.store.settings.layout = layoutSel.value;
      this.plugin.store.save();
      this.render();
    });
    toolbar.append(layoutSel);

    // 脑图复习
    const reviewSel = el("select", { class: "ms-select", title: "脑图复习模式" }) as HTMLSelectElement;
    [
      ["", "复习模式"],
      ["mask", "遮挡回忆"],
      ["title", "标题抽查"],
      ["expand", "逐级展开"],
      ["recite", "子脑图默写"],
    ].forEach(([v, l]) => reviewSel.append(el("option", { value: v, text: l }) as HTMLOptionElement));
    reviewSel.addEventListener("change", () => this.setReviewMode(reviewSel.value as any));
    toolbar.append(reviewSel);
    this.reviewControlBtn = btn("下一级", "复习：展开下一级 / 下一个分支", () => this.reviewStep());
    this.reviewControlBtn.style.display = "none";
    toolbar.append(this.reviewControlBtn);

    // 节点搜索过滤
    const search = el("input", { class: "ms-mm-search ms-tb-btn", type: "text", placeholder: "搜索节点…" }) as HTMLInputElement;
    search.style.width = "130px";
    search.addEventListener("input", () => this.setSearch(search.value.trim()));
    toolbar.append(search);

    toolbar.append(
      btn("导出图", "导出脑图为 PNG / SVG", () => exportMindmapPng(this.plugin))
    );

    toolbar.append(
      btn("放大", "放大导图", () => this.zoomBy(1.2)),
      btn("缩小", "缩小导图", () => this.zoomBy(1 / 1.2)),
      btn("适应", "重置缩放与位置", () => this.resetView()),
      btn("沉浸", "沉浸模式：隐藏工具栏专注整理", () => this.toggleImmersive(), true),
      btn("清空", "删除当前范围全部节点与连线", () => this.clearAll())
    );
  }

  // ===== 节点浮动工具栏 =====
  private buildNodeToolbar(toolbar: HTMLElement): void {
    clear(toolbar);
    const item = (action: string, label: string, icon: string, title: string, cb: (event: MouseEvent) => void) => {
      const b = el("button", { class: "ms-node-tb-item", title, "aria-label": label, "data-action": action, type: "button" });
      const glyph = el("span", { class: "ms-selection-icon", "aria-hidden": "true" });
      setIcon(glyph, icon);
      b.append(glyph, el("span", { class: "ms-selection-label", text: label }));
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        cb(e);
      });
      return b;
    };
    toolbar.append(
      item("cut", "剪切", "scissors", "剪切选中卡片和子树", () => this.cutNodes()),
      item("copy", "复制", "copy", "复制选中卡片和子树", () => this.copyNodes()),
      item("color", "颜色", "palette", "设置卡片颜色", () => this.pickColor()),
      item("tag", "标签", "tag", "编辑卡片标签", () => this.editTags()),
      item("link", "链接", "link", "添加卡片链接", () => this.addLink()),
      item("summary", "概要", "brackets", "为同级卡片创建概要", () => this.createSummary()),
      item("regroup", "重新分组", "network", "将同级卡片归入新的父节点", () => this.regroupNodes()),
      item("merge", "合并", "combine", "合并多选卡片", () => this.mergeNodes()),
      item("delete", "删除", "trash-2", "删除选中卡片和子树", () => this.deleteSelectedNodes()),
      item("more", "更多", "ellipsis", "更多卡片操作", (event) => this.showSelectionMore(event)),
      item("close", "退出多选", "x", "退出选择模式", () => this.exitSelection())
    );
  }

  private updateNodeToolbar(): void {
    if (!this.nodeToolbarEl) return;
    const count = this.selectedIds.size;
    this.nodeToolbarEl.style.display = this.selectionSource === "direct" && (this.multiSelect || count > 0) ? "flex" : "none";
    this.nodeToolbarEl.setAttribute("data-selection", String(count));
    this.nodeToolbarEl.setAttribute("aria-label", `${this.multiSelect ? "多选" : "卡片"}操作，已选 ${count} 张卡片`);
    this.root?.setAttribute("data-selection-mode", this.multiSelect ? "multiple" : "single");
    this.root?.classList.toggle("is-multi-select", this.multiSelect);
    this.multiSelectBtn?.classList.toggle("is-active", this.multiSelect);
    this.multiSelectBtn?.setAttribute("aria-pressed", String(this.multiSelect));
    for (const button of this.nodeToolbarEl.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
      const action = button.dataset.action;
      const needsPair = action === "summary" || action === "regroup" || action === "merge";
      button.disabled = action === "close" ? false : needsPair ? count < 2 : count === 0;
      if (action === "merge") button.disabled ||= !this.multiSelect;
    }
    this.positionNodeToolbar();
  }

  /** Screen rectangles include zoom and scroll; overlay coordinates stay local to the map root. */
  private positionNodeToolbar(): void {
    if (this.pinchGeom) return;
    const bar = this.nodeToolbarEl, root = this.root, viewport = this.scrollEl;
    if (!bar || !root || !viewport || bar.style.display === "none") return;
    const area = viewport.getBoundingClientRect(), origin = root.getBoundingClientRect();
    const inset = 12, left = area.left + inset, right = area.right - inset;
    const top = area.top + inset, bottom = area.bottom - inset;
    bar.style.maxWidth = `${Math.max(1, right - left)}px`;
    bar.style.maxHeight = `${Math.max(1, bottom - top)}px`;
    const width = bar.offsetWidth, height = bar.offsetHeight;
    const visible = [...this.selectedIds].map(id => this.nodeEls.get(id)?.getBoundingClientRect())
      .filter((box): box is DOMRect => !!box && box.right > area.left && box.left < area.right && box.bottom > area.top && box.top < area.bottom);
    const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, Math.max(low, high)));
    let x = left + (right - left - width) / 2, y = top;
    if (visible.length) {
      const card = { left: Math.min(...visible.map(box => box.left)), right: Math.max(...visible.map(box => box.right)), top: Math.min(...visible.map(box => box.top)), bottom: Math.max(...visible.map(box => box.bottom)) };
      x = (card.left + card.right - width) / 2;
      if (card.top - height - 12 >= top) y = card.top - height - 12;
      else if (card.bottom + height + 12 <= bottom) y = card.bottom + 12;
      else if (card.right + width + 12 <= right) { x = card.right + 12; y = card.top; }
      else if (card.left - width - 12 >= left) { x = card.left - width - 12; y = card.top; }
      else y = card.top + card.bottom > top + bottom ? top : bottom - height;
    }
    bar.style.left = `${clamp(x, left, right - width) - origin.left}px`;
    bar.style.top = `${clamp(y, top, bottom - height) - origin.top}px`;
  }

  private setMultiSelect(enabled: boolean): void {
    if (enabled) this.setHandwritingMode("off");
    this.selectionSource = "direct";
    this.multiSelect = enabled;
    this.dragged = false;
    if (enabled) { this.connectMode = false; this.pendingFrom = null; }
    else this.clearSelection();
    this.updateNodeToolbar();
  }

  /** Scene-shell entry points. Keep organizer actions owned by the mindmap, anchored to the caller's tool row. */
  openSceneCopyMoveMenu(anchor: HTMLElement): void {
    const bounds = anchor.getBoundingClientRect();
    const menu = new Menu();
    menu.addItem(item => item.setTitle("复制选中卡片").setDisabled(!this.selectedIds.size).onClick(() => this.copyNodes()));
    menu.addItem(item => item.setTitle("粘贴独立副本").setDisabled(!cardClipboard.fragment).onClick(() => this.pasteNodes("clone")));
    menu.addItem(item => item.setTitle("粘贴共享引用").setDisabled(!cardClipboard.fragment).onClick(() => this.pasteNodes("reference")));
    menu.showAtPosition({ x: bounds.left, y: bounds.bottom });
  }

  toggleSceneConnectMode(): void {
    this.toggleConnect();
    this.root?.classList.toggle("is-connect-mode", this.connectMode);
  }

  toggleSceneMultiSelect(): void {
    this.setMultiSelect(!this.multiSelect);
  }

  private exitSelection(): void {
    this.multiSelect = false;
    this.clearSelection();
  }

  private showSelectionMore(event: MouseEvent): void {
    const nodes = this.selectedNodes();
    if (!nodes.length) return;
    const menu = new Menu();
    trackCardActionMenu(menu);
    addCommonCardActions(menu, this.plugin, nodes, () => this.render());
    const item = (label: string, action: () => void, disabled = false) => menu.addItem((entry) => entry.setTitle(label).setDisabled(disabled).onClick(action));
    item("粘贴卡片", () => this.pasteNodes(cardClipboard.mode), !cardClipboard.fragment);
    item("粘贴克隆", () => this.pasteNodes("clone"), !cardClipboard.fragment);
    item("粘贴引用", () => this.pasteNodes("reference"), !cardClipboard.fragment);
    item("断开引用", () => this.detachSelectedReference(), nodes.length !== 1 || !nodes[0].cardId);
    item("按内容拆分…", () => this.splitSelectedContent(), nodes.length !== 1);
    const card = nodes[0].cardId ? this.plugin.store.getCard(nodes[0].cardId) : undefined;
    item("连续摘录", () => {
      const reader = this.plugin.activeReader;
      if (!(reader instanceof ReaderView) || !card || !reader.continueExcerptInCard(card.id)) new Notice("请先在同一 PDF 中选择摘录笔");
    }, nodes.length !== 1 || !card || !(this.plugin.activeReader instanceof ReaderView) || this.plugin.activeReader.getFilePath() !== card.docPath);
    item("解除合并", () => {
      if (card) { this.plugin.store.unmergeCard(card.id); this.render(); }
    }, nodes.length !== 1 || !card?.mergedCards?.length);
    item("整卡遮挡", () => this.toggleSelectedOcclusion());
    item("在此处隐藏", () => this.hideSelected());
    item("评论", () => this.editComments(), nodes.length !== 1);
    item("打开子脑图", () => this.openChildMap(), nodes.length !== 1);
    item("折叠为子脑图", () => this.collapseToSubmap(), nodes.length !== 1);
    item("展开子脑图", () => this.expandSubmap(), nodes.length !== 1);
    menu.showAtMouseEvent(event);
  }

  // ===== 缩放/平移 =====
  private onWheel(e: WheelEvent): void {
    const target = e.target as Element | null;
    if (target?.closest("input, textarea, select, [contenteditable='true'], .ms-map-floating-panel, .ms-node-toolbar, .ms-native-map-rail, .ms-toolbar, .ms-map-ink-palette, .ms-map-ink-settings")) return;
    const scroll = this.scrollEl;
    const deltaX = this.normalizedWheelDelta(e.deltaX, e.deltaMode, scroll?.clientWidth ?? window.innerWidth);
    const deltaY = this.normalizedWheelDelta(e.deltaY, e.deltaMode, scroll?.clientHeight ?? window.innerHeight);
    if (!e.ctrlKey && !e.metaKey) {
      if (!scroll || !Number.isFinite(deltaX) || !Number.isFinite(deltaY) || deltaX === 0 || deltaY === 0) return;
      e.preventDefault();
      scroll.scrollLeft += deltaX;
      scroll.scrollTop += deltaY;
      return;
    }
    e.preventDefault();
    if (!Number.isFinite(deltaY) || deltaY === 0) return;
    const factor = Math.exp(-PINCH_WHEEL_EXPONENT * deltaY);
    this.zoomAt(e.clientX, e.clientY, factor);
  }

  /** Wheel line is 16 CSS px; wheel page spans the current map viewport on that axis. */
  private normalizedWheelDelta(delta: number, deltaMode: number, pageSize: number): number {
    if (deltaMode === 1) return delta * WHEEL_LINE_HEIGHT_CSS_PX;
    if (deltaMode === 2) return delta * Math.max(1, pageSize);
    return delta;
  }

  private onTouchPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" || this.handwritingMode !== "off") return;
    if ((event.target as Element).closest("button,input,textarea,select,[contenteditable=true],.ms-map-floating-panel")) return;
    this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.touchPoints.size === 1) {
      window.addEventListener("pointermove", this.onTouchPointerMove, true);
      window.addEventListener("pointerup", this.onTouchPointerEnd, true);
      window.addEventListener("pointercancel", this.onTouchPointerEnd, true);
      window.addEventListener("blur", this.clearTouchPointers);
    }
    if (this.touchPoints.size === 2) {
      this.finishNodeDrag?.(); this.finishCanvasPan?.();
      if (this.scrollEl && this.world && this.canvasWrap) {
        this.pinchGeom = {
          scrollRect: this.scrollEl.getBoundingClientRect(), worldRect: this.world.getBoundingClientRect(),
          worldOffsetW: this.world.offsetWidth, scaleStart: this.viewScale,
          scrollLeft: this.scrollEl.scrollLeft, scrollTop: this.scrollEl.scrollTop,
        };
        this.prepareGestureSurface(Math.max(0.1, this.viewScale * 0.5));
      }
      this.world?.classList.add("is-pinching");
      const [a,b] = [...this.touchPoints.values()]; this.pinchDistance = Math.hypot(a.x-b.x,a.y-b.y);
      event.preventDefault(); event.stopPropagation();
    }
  };
  private onTouchPointerMove = (event: PointerEvent): void => {
    if (!this.touchPoints.has(event.pointerId)) return;
    this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.touchPoints.size !== 2) return;
    const [a,b] = [...this.touchPoints.values()], distance = Math.hypot(a.x-b.x,a.y-b.y);
    if (distance > 0 && this.pinchDistance > 0) {
      const factor = distance / this.pinchDistance;
      this.pinchPending = { x: (a.x+b.x)/2, y: (a.y+b.y)/2, factor: (this.pinchPending?.factor ?? 1) * factor };
      if (!this.pinchFrame) this.pinchFrame = requestAnimationFrame(() => {
        this.pinchFrame = 0;
        const pending = this.pinchPending; this.pinchPending = null;
        if (pending) this.zoomAt(pending.x, pending.y, pending.factor);
      });
    }
    this.pinchDistance = distance; event.preventDefault(); event.stopPropagation();
  };
  private onTouchPointerEnd = (event: PointerEvent): void => {
    if (!this.touchPoints.has(event.pointerId)) return;
    if (this.pinchFrame) {
      cancelAnimationFrame(this.pinchFrame); this.pinchFrame = 0;
      const pending = this.pinchPending; this.pinchPending = null;
      if (event.type !== "pointercancel" && pending) this.zoomAt(pending.x, pending.y, pending.factor);
    }
    this.touchPoints.delete(event.pointerId); this.pinchDistance = 0;
    this.finishPinch();
    this.world?.classList.remove("is-pinching");
    if (!this.touchPoints.size) this.clearTouchPointers();
  };
  private clearTouchPointers = (): void => {
    if (this.pinchFrame) cancelAnimationFrame(this.pinchFrame);
    this.pinchFrame = 0; this.pinchPending = null;
    this.touchPoints.clear(); this.pinchDistance = 0;
    this.finishPinch();
    this.world?.classList.remove("is-pinching");
    window.removeEventListener("pointermove", this.onTouchPointerMove, true);
    window.removeEventListener("pointerup", this.onTouchPointerEnd, true);
    window.removeEventListener("pointercancel", this.onTouchPointerEnd, true);
    window.removeEventListener("blur", this.clearTouchPointers);
  };

  private onCanvasPointerDown(e: PointerEvent): void {
    if (this.handwritingMode !== "off") return;
    if ((e.target as HTMLElement).closest(".ms-node")) return;
    if (this.connectMode) return;
    if (this.finishCanvasPan) return;
    if (!this.multiSelect && !e.ctrlKey && !e.metaKey && !e.shiftKey) this.clearSelection();
    e.preventDefault();
    if (!this.scrollEl) return;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const sl = this.scrollEl.scrollLeft;
    const st = this.scrollEl.scrollTop;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!this.scrollEl) return;
      this.scrollEl.scrollLeft = sl - (ev.clientX - startX);
      this.scrollEl.scrollTop = st - (ev.clientY - startY);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", blur);
      if (this.finishCanvasPan === finish) this.finishCanvasPan = null;
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish();
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish();
    };
    const blur = () => finish();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", blur);
    this.finishCanvasPan = finish;
  }

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    if (!this.scrollEl) return;
    const next = Math.max(0.1, Math.min(6, this.viewScale * factor));
    if (next === this.viewScale) return;
    const geom = this.pinchGeom;
    if (geom && this.world) {
      const left = geom.worldRect.left + geom.scrollLeft - this.scrollEl.scrollLeft;
      const top = geom.worldRect.top + geom.scrollTop - this.scrollEl.scrollTop;
      const pointX = (clientX - left) / this.viewScale;
      const pointY = (clientY - top) / this.viewScale;
      this.viewScale = next;
      this.world.style.transform = `scale(${next})`;
      this.scrollEl.scrollLeft = this.viewGutterX + pointX * next - (clientX - geom.scrollRect.left);
      this.scrollEl.scrollTop = this.viewGutterY + pointY * next - (clientY - geom.scrollRect.top);
      return;
    }
    const point = this.viewCoordinates(clientX, clientY), rect = this.scrollEl.getBoundingClientRect();
    const ratio = next / this.viewScale;
    this.viewScale = next;
    this.applyView();
    this.scrollEl.scrollLeft = this.viewGutterX + point.worldX * next - (clientX - rect.left);
    this.scrollEl.scrollTop = this.viewGutterY + point.worldY * next - (clientY - rect.top);
    this.positionNodeToolbar();
  }

  private zoomBy(factor: number): void {
    if (!this.scrollEl) return;
    const rect = this.scrollEl.getBoundingClientRect();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  private resetView(): void {
    this.viewScale = 1;
    this.positionViewOnNextApply = true;
    this.applyView();
  }

  private prepareGestureSurface(minScale: number): void {
    if (!this.canvasWrap || !this.world) return;
    const surfaceW = Math.max(this.baseW, this.viewportW / minScale);
    const surfaceH = Math.max(this.baseH, this.viewportH / minScale);
    this.world.style.width = `${surfaceW}px`;
    this.world.style.height = `${surfaceH}px`;
    this.world.style.left = `${this.viewGutterX}px`;
    this.world.style.top = `${this.viewGutterY}px`;
    this.canvasWrap.style.width = `${Math.ceil(Math.max(this.viewportW, surfaceW * 6 + this.viewGutterX * 2))}px`;
    this.canvasWrap.style.height = `${Math.ceil(Math.max(this.viewportH, surfaceH * 6 + this.viewGutterY * 2))}px`;
  }

  private finishPinch(): void {
    if (!this.pinchGeom) return;
    this.pinchGeom = null;
    this.applyView();
    if (this.renderAfterDrag) { this.renderAfterDrag = false; this.render(); }
  }

  private applyView(): void {
    if (!this.canvasWrap || !this.world || !this.scrollEl) return;
    const viewportW = this.scrollEl.clientWidth, viewportH = this.scrollEl.clientHeight;
    const gutterX = Math.max(MIN_VIEW_OVERSCROLL_CSS, viewportW * VIEW_OVERSCROLL_RATIO);
    const gutterY = Math.max(MIN_VIEW_OVERSCROLL_CSS, viewportH * VIEW_OVERSCROLL_RATIO);
    // Preserve world coordinates until the expanded canvas can accommodate them.
    const previousX = this.scrollEl.scrollLeft - this.viewGutterX;
    const previousY = this.scrollEl.scrollTop - this.viewGutterY;
    const preservePosition = !!(this.viewportW && this.viewportH && !this.positionViewOnNextApply);
    const surfaceW = Math.max(this.baseW, viewportW / this.viewScale), surfaceH = Math.max(this.baseH, viewportH / this.viewScale);
    const contentW = Math.max(1, surfaceW * this.viewScale), contentH = Math.max(1, surfaceH * this.viewScale);
    this.world.style.width = `${surfaceW}px`;
    this.world.style.height = `${surfaceH}px`;
    this.world.style.left = `${gutterX}px`;
    this.world.style.top = `${gutterY}px`;
    this.world.style.transform = `scale(${this.viewScale})`;
    this.canvasWrap.style.width = `${Math.max(viewportW, Math.ceil(contentW + gutterX * 2))}px`;
    this.canvasWrap.style.height = `${Math.max(viewportH, Math.ceil(contentH + gutterY * 2))}px`;
    this.viewportW = viewportW; this.viewportH = viewportH;
    this.viewGutterX = gutterX; this.viewGutterY = gutterY;
    if (preservePosition) {
      this.scrollEl.scrollLeft = gutterX + previousX;
      this.scrollEl.scrollTop = gutterY + previousY;
    }
    if (this.positionViewOnNextApply && viewportW > 0 && viewportH > 0) {
      this.scrollEl.scrollLeft = gutterX - Math.min(VIEW_INITIAL_INSET_CSS, viewportW / 2);
      this.scrollEl.scrollTop = gutterY - Math.min(VIEW_INITIAL_INSET_CSS, viewportH / 2);
      this.positionViewOnNextApply = false;
    }
    this.positionNodeToolbar();
  }

  private viewCoordinates(clientX: number, clientY: number): { worldX: number; worldY: number } {
    if (!this.world) return { worldX: 0, worldY: 0 };
    const worldRect = this.world.getBoundingClientRect();
    const scale = this.world.offsetWidth > 0 ? worldRect.width / this.world.offsetWidth : this.viewScale;
    return {
      worldX: (clientX - worldRect.left) / scale,
      worldY: (clientY - worldRect.top) / scale,
    };
  }

  private toggleConnect(): void {
    this.setHandwritingMode("off");
    this.connectMode = !this.connectMode;
    this.pendingFrom = null;
    this.clearSelection();
    // Notice 通过 plugin 调用
    new Notice(this.connectMode ? "连线模式：点击源节点，再点击目标节点" : "已退出连线模式");
  }

  // ===== 数据范围 =====
  private currentScope(): string | null {
    return this.plugin.activeReader?.getFilePath() ?? null;
  }

  private currentCanvasId(): string | undefined {
    return this.options.subtreeRoot
      ? this.plugin.store.getNode(this.options.subtreeRoot)?.canvasId
      : this.plugin.store.activeCanvasId;
  }

  private scopedNodes(): MindNode[] {
    if (this.options.subtreeRoot) {
      const root = this.plugin.store.getNode(this.options.subtreeRoot);
      if (!root) return [];
      return this.plugin.store.nodes.filter((node) => root.canvasId
        ? node.canvasId === root.canvasId
        : !node.canvasId && node.docPath === root.docPath);
    }
    return this.plugin.store.getScopedNodes();
  }

  private visibleNodes(): MindNode[] {
    let all = this.scopedNodes().filter((node) => !this.isGroupedMember(node));
    // 子脑图：仅保留子树
    if (this.options.subtreeRoot) {
      const keep = new Set<string>([this.options.subtreeRoot]);
      const collect = (id: string) => {
        for (const c of all.filter((n) => n.parentId === id)) {
          if (keep.has(c.id)) continue;
          keep.add(c.id);
          collect(c.id);
        }
      };
      collect(this.options.subtreeRoot);
      all = all.filter((n) => keep.has(n.id));
    }
    // 焦点模式：仅保留焦点节点及其后代
    if (this.focusId) {
      const keep = new Set<string>([this.focusId]);
      const collect = (id: string) => {
        for (const c of all.filter((n) => n.parentId === id)) {
          if (keep.has(c.id)) continue;
          keep.add(c.id);
          collect(c.id);
        }
      };
      collect(this.focusId);
      all = all.filter((n) => keep.has(n.id));
    }
    const recallHierarchyActive = this.isRecallHierarchyActive();
    if (!recallHierarchyActive) { this.recallCollapsed.clear(); this.revealedImageMasks.clear(); this.revealedEmphasis.clear(); }
    // MN4 level 1 shows only roots; each higher level reveals one additional child layer.
    if (recallHierarchyActive) {
      all = all.filter((n) => this.depthOf(n) < this.recallHierarchyDepth);
    }
    // 复习-逐级展开：按深度限制
    if (this.reviewMode === "expand") {
      all = all.filter((n) => this.depthOf(n) <= this.maxDepth);
    }
    const hidden = new Set<string>();
    const childrenOf = (id: string) => all.filter((n) => n.parentId === id);
    const markHidden = (id: string, preserveTransient = false) => {
      for (const c of childrenOf(id)) {
        if (preserveTransient && this.transientVisibleIds.has(c.id)) continue;
        if (hidden.has(c.id)) continue;
        hidden.add(c.id);
        markHidden(c.id);
      }
    };
    for (const n of all) if (n.id !== this.options.subtreeRoot && ((recallHierarchyActive ? this.recallCollapsed.has(n.id) || (this.isLayeredRecall() && !this.layeredOpenIds.has(n.id)) : n.collapsed) || n.submap)) markHidden(n.id, true);
    if (!this.showHidden) for (const n of all) if (n.hidden && !this.transientVisibleIds.has(n.id)) { hidden.add(n.id); markHidden(n.id); }
    return all.filter((n) => !hidden.has(n.id));
  }

  // ===== 渲染 =====
  requestRender(): void {
    if (this.finishNodeDrag || this.pinchGeom) { this.renderAfterDrag = true; return; }
    this.render();
  }

  render(): void {
    if (this.finishNodeDrag || this.pinchGeom) { this.renderAfterDrag = true; return; }
    if (!this.world || !this.svg) return;
    const canvasId = this.currentCanvasId();
    const recallActive=this.isRecallHierarchyActive();if(this.wasRecallActive&&!recallActive){this.revealedIds.clear();this.layeredOpenIds.clear();}this.wasRecallActive=recallActive;
    if (canvasId !== this.renderedCanvasId) { this.revealedIds.clear(); this.layeredOpenIds.clear(); this.revealedImageMasks.clear(); this.revealedEmphasis.clear(); this.recallCollapsed.clear(); this.transientVisibleIds.clear(); this.renderedCanvasId = canvasId; }
    if (this.currentCanvas()?.singlePeek && this.revealedIds.size > 1) this.revealedIds.clear();
    const scope = new Set(this.scopedNodes().filter((node) => !this.isGroupedMember(node)).map((node) => node.id));
    this.selectedIds = new Set([...this.selectedIds].filter((id) => scope.has(id)));
    if (this.focusId && !scope.has(this.focusId)) this.focusId = null;
    if (this.pendingFrom && !scope.has(this.pendingFrom)) this.pendingFrom = null;
    const nodes = this.visibleNodes();
    for (const div of this.nodeEls.values()) div.remove();
    this.nodeEls.clear();

    let maxX = 200;
    let maxY = 200;
    for (const n of nodes) {
      const div = this.makeNodeDiv(n);
      div.style.left = `${n.x}px`;
      div.style.top = `${n.y}px`;
      this.world.append(div);
      this.nodeEls.set(n.id, div);
      // 按节点真实尺寸扩展画布，避免大卡片/图片被截断
      maxX = Math.max(maxX, n.x + div.offsetWidth + 80);
      maxY = Math.max(maxY, n.y + div.offsetHeight + 80);
    }
    const inkExtent = this.handwriting?.getExtent();
    this.baseW = Math.max(maxX + 200, (inkExtent?.right ?? 0) + 120);
    this.baseH = Math.max(maxY + 200, (inkExtent?.bottom ?? 0) + 120);
    this.world.style.width = `${this.baseW}px`;
    this.world.style.height = `${this.baseH}px`;
    this.drawEdges(nodes);
    this.applyView();
    this.handwriting?.render();
    this.updateNodeToolbar();
    if (this.nativeCanvasButton) {
      const canvas = this.plugin.store.canvases.find((candidate) => candidate.id === this.currentCanvasId());
      this.nativeCanvasButton.replaceChildren(el("span", { text: canvas?.name || "Main" }), el("span", { class: "ms-native-canvas-chevron", text: "⌄", "aria-hidden": "true" }));
    }
    this.nativePanelRenderer?.render();
  }

  private makeNodeDiv(n: MindNode): HTMLElement {
    const content = nodeContent(this.plugin.store, n);
    const card = n.cardId ? this.plugin.store.getCard(n.cardId) : undefined;
    let cls = "ms-node" + (n.parentId === null ? " is-root" : "");
    if (this.selectedIds.has(n.id)) cls += " is-selected";
    const div = el("div", { class: cls, "data-id": n.id, tabindex: "0", role: "group", "aria-label": "脑图卡片" });
    div.setAttribute("data-selected", String(this.selectedIds.has(n.id)));
    if (content.color) {
      div.style.setProperty("--ms-node-color", content.color);
      div.classList.add("has-color");
      const probe = document.createElement("canvas").getContext("2d");
      if (probe) {
        probe.fillStyle = content.color;
        const normalized = probe.fillStyle;
        const match = /^#([0-9a-f]{6})$/i.exec(normalized);
        if (match) {
          const channels = [0, 2, 4].map(index => parseInt(match[1].slice(index, index + 2), 16) / 255)
            .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
          const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
          const darkLuminance = 0.018500220128379697;
          const darkContrast = (luminance + 0.05) / (darkLuminance + 0.05);
          const blackContrast = (luminance + 0.05) / 0.05;
          div.style.setProperty("--ms-node-heading-text", darkContrast >= 4.5 ? "#252525" : blackContrast >= 4.5 ? "#000000" : "#ffffff");
        }
      }
    }
    if (n.hidden) { div.style.opacity = "0.55"; div.style.borderStyle = "dashed"; }
    if (n.hidden) div.append(el("div", { class: "ms-muted", text: "此处已隐藏" }));

    const header = el("div", { class: "ms-node-header" });
    const more = el("button", { class: "ms-node-menu", text: "•••", type: "button", "aria-label": "卡片更多操作", title: "卡片更多操作" });
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!this.selectedIds.has(n.id)) this.multiSelect ? this.toggleSelect(n.id) : this.selectSingle(n.id);
      showNodeActions(this.plugin, [...this.selectedIds], event, () => { this.revealedIds.clear(); this.render(); });
    });
    header.append(more);
    if (n.reference) header.append(el("span", { class: "ms-node-reference", text: "↔", title: "共享引用：内容与其他引用同步", "aria-label": "共享引用" }));
    if (card && (card.docPath || card.sources?.some((source) => source.docPath))) {
      const jump = el("button", { class: "ms-node-source", text: "›", type: "button", "aria-label": "跳转到原文", title: "跳转到原文" });
      jump.addEventListener("click", (event) => { event.stopPropagation(); jumpToCardSource(this.plugin, card); });
      header.append(jump);
    }
    div.append(header);

    // L4: an ink/image-only source Extend precedes text added independently to its card.
    const notes = card ? notebookMeta(this.plugin.store.getDocMeta(card.docPath), card.documentNotebookId ?? "default").pdfExtendNotes : undefined;
    const composed = !!card?.extendMedia?.some(media=>media.noteId===card.anchorAnnId&&media.composed);
    const excerptBlocks = !composed ? card?.excerptBlocks : undefined;
    const mediaBeforeNote = composed || !!card?.extendMedia?.some(media => media.noteId !== card.anchorAnnId && notes?.some(note => note.id === media.noteId && note.sourceAnnId === card.anchorAnnId && !note.text.trim() && (note.ink?.length || note.images?.length)));
    const orderedComments=card?.commentOrder ? cardCommentItems(card) : undefined;
    const orderedImages=new Set(orderedComments?.flatMap(item=>item.image?[item.image]:[])??[]);
    const attachedImages = new Set(card?.commentMedia?.map(media => media.image) ?? []);
    const leadingImages = mediaBeforeNote ? content.images.filter(image => !attachedImages.has(image)) : [];
    let imageIndex = 0;
    const appendImages = (values: string[], blockId?: string) => {
      if (!values.length) return;
      const images = el("div", { class: "ms-node-images" });
      for (const image of values) {
        const source = imageUrl(this.plugin, image);
        const img = el("img", { src: source, class: "ms-node-img", alt: "卡片图片" }) as HTMLImageElement;
        if(blockId)img.dataset.excerptBlock=blockId;
        img.title = "点击查看全景 / 放大";
        img.addEventListener("click", (event) => { event.stopPropagation(); openImageLightbox(source); });
        const firstImage = imageIndex++ === 0;
        const masks = firstImage && card && !this.revealedIds.has(n.id) && this.isRecallHierarchyActive() && this.root?.closest<HTMLElement>(".ms-study-workspace")?.hasAttribute("data-recall-mask-emphasis-images") ? validOcclusions(card) : [];
        {
          const frame = el("div", { class: "ms-node-image-frame", style: "position:relative;width:fit-content;max-width:100%" });
          frame.append(img);
          for (const mask of masks) {
            const key = `${n.id}:${mask.id}`, shown = this.revealedImageMasks.has(key);
            const button = el("button", { type: "button", class: "ms-node-image-mask", "data-image-mask": mask.id, "aria-pressed": String(shown), "aria-label": shown ? "重新遮回图片区域" : "揭开图片区域" });
            const points = mask.points?.map(point => `${((point.x-mask.x)/mask.width)*100}% ${((point.y-mask.y)/mask.height)*100}%`).join(",");
            Object.assign(button.style,{position:"absolute",left:`${mask.x*100}%`,top:`${mask.y*100}%`,width:`${mask.width*100}%`,height:`${mask.height*100}%`,padding:"0",background:shown?"transparent":"var(--interactive-accent, #5b6cff)",opacity:shown?"0":"1",clipPath:points?`polygon(${points})`:""});
            button.addEventListener("click",event=>{event.stopPropagation();if(shown)this.revealedImageMasks.delete(key);else {this.clearOtherRecalls();this.revealedImageMasks.add(key);}this.render();});
            frame.append(button);
          }
          images.append(frame);
        }
      }
      div.append(images);
    };

    const reviewing = this.reviewMode !== "";
    const depth = this.depthOf(n);
    const recallActive = this.isRecallHierarchyActive();
    const maskBody = !!this.root?.closest<HTMLElement>(".ms-study-workspace")?.hasAttribute("data-recall-mask-body");
    const maskable = !!(n.occluded ?? card?.occluded) || (recallActive && maskBody && card?.type === "flashcard" && !!card.back?.trim()) || this.reviewMode === "mask" || (this.reviewMode === "title" && depth > 0);
    const masked = maskable && !this.revealedIds.has(n.id);
    const layeredClosed=this.isLayeredRecall()&&!this.layeredOpenIds.has(n.id);
    const showQuestion = masked && this.reviewMode !== "title" && !content.heading && card?.type === "flashcard" && !!content.note;
    {
      let sectionIndex=0;
      const section = (field: string, text: string, classes: string) => {
        if (!text) return;
        const body = el("div", { class: classes, "data-field": field });
        body.dataset.recallSection=String(sectionIndex++);
        applyCardTypography(body,this.plugin.store.settings,card,field==="title");this.renderNodeText(body, field==="excerpt" && hasCloze(text) ? clozeHint(text) : text, n, showQuestion && field === "excerpt"); div.append(body);
      };
      section("title", content.heading, "ms-node-title ms-node-heading");
      if(card && excerptBlocks?.length){
        if(!excerptBlocks.some(block=>block.text))section("excerpt",content.excerpt,"ms-node-excerpt" + (!content.heading ? " ms-node-title" : ""));
        for(const block of displayedExcerptBlocks(card)){
          if(block.text)section("excerpt",block.text,"ms-node-excerpt" + (!content.heading ? " ms-node-title" : ""));
          if(block.image)appendImages([block.image],block.id);
          if(block.target)div.append(excerptSourceButton(this.plugin,card,block));
        }
      }else section("excerpt", content.excerpt, "ms-node-excerpt" + (!content.heading ? " ms-node-title" : ""));
      if(orderedComments){
        appendImages((excerptBlocks?.length ? content.images.slice(excerptBlocks.filter(block=>block.image).length) : content.images).filter(image=>!orderedImages.has(image)));
        for(const item of orderedComments){if(item.image)appendImages([item.image]);if(item.text)section(item.key==="back"?"note":"comment",item.text,item.key==="back"?"ms-node-body ms-node-note":"ms-node-body ms-node-comment");}
        for(const comment of n.comments??[])section("comment",comment,"ms-node-body ms-node-comment");
      }else{
        appendImages(leadingImages);
        section("note", content.note, "ms-node-body ms-node-note");
        for (const comment of content.comments) section("comment", comment, "ms-node-body ms-node-comment");
      }
      if (!content.heading && !content.excerpt && !content.note && !content.images.length && !content.comments.length) {
        section("empty", reviewing ? "•••" : "(空)", "ms-node-title");
      }
    }

    if (content.tags.length) {
      const tags = el("div", { class: "ms-node-tags" });
      for (const t of content.tags) {
        const tagEl = el("span", { class: "ms-node-tag", text: t });
        const col = this.plugin.store.settings.tagColors[t];
        if (col) {
          tagEl.style.background = col;
          tagEl.style.color = "#fff";
        }
        tags.append(tagEl);
      }
      div.append(tags);
    }

    if (!orderedComments) appendImages((excerptBlocks?.length ? content.images.slice(excerptBlocks.filter(block=>block.image).length) : content.images).filter(image => !leadingImages.includes(image)));
    if ((card?.sources?.length ?? 0) > 1) {
      const sources = el("div", { class: "ms-node-sources" });
      sources.addEventListener("click", (event) => event.stopPropagation());
      appendSources(sources, this.plugin, card!);
      div.append(sources);
    }
    if(layeredClosed){
      for(const child of [...div.children])if(child!==header&&child instanceof HTMLElement&&!child.classList.contains("ms-node-heading")&&!( !content.heading&&child.classList.contains("ms-node-excerpt")))child.style.visibility="hidden";
      const open=el("button",{type:"button",text:"揭开下一层","aria-label":"揭开下一层",class:"ms-cloze"});Object.assign(open.style,{position:"absolute",right:"8px",bottom:"8px",zIndex:"3"});open.addEventListener("click",event=>{event.stopPropagation();this.afterImagesReady(div,open,()=>{this.layeredOpenIds.add(n.id);this.revealNode(n.id);this.recallCollapsed.delete(n.id);this.render();});});div.append(open);
    }

    if (masked && !layeredClosed) {
      for (const child of [...div.children]) if (child !== header && child instanceof HTMLElement && (this.reviewMode === "title" || (!child.classList.contains("ms-node-heading") && !(showQuestion && child.classList.contains("ms-node-excerpt"))))) child.style.visibility = "hidden";
      const reveal = el("button", { class: "ms-cloze ms-node-reveal-overlay", text: "••• 揭晓", "aria-label": "揭晓整卡内容", type: "button" });
      Object.assign(reveal.style, { position: "absolute", right: "8px", bottom: "8px", zIndex: "2" });
      reveal.addEventListener("click", (event) => { event.stopPropagation(); this.afterImagesReady(div,reveal,()=>{this.revealNode(n.id);this.render();}); });
      div.append(reveal);
    }
    this.updateCardRemaining(div, n.id, masked);

    if (n.submap && this.plugin.store.nodes.some((c) => c.parentId === n.id)) {
      div.classList.add("is-submap");
      const badge = el("button", {
        class: "ms-node-submap-badge",
        text: "⊞ 子脑图",
        title: "在浮动视图打开该节点子树",
      });
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        this.selectedIds.clear();
        this.selectedIds.add(n.id);
        this.openChildMap();
      });
      div.append(badge);
    }

    const kids = this.plugin.store.nodes.filter((c) => c.parentId === n.id);
    const actions = el("div", { class: "ms-node-actions" });
    if (n.hidden) {
      const restore = el("button", { class: "ms-node-del", text: "显示", title: "在此处恢复显示" });
      restore.addEventListener("click", (event) => { event.stopPropagation(); this.plugin.store.setNodeHidden(n.id, false); this.render(); });
      actions.append(restore);
    }
    if (kids.length) {
      const isCollapsed=this.isRecallHierarchyActive() ? this.recallCollapsed.has(n.id) || (this.isLayeredRecall()&&!this.layeredOpenIds.has(n.id)) : n.collapsed;
      const toggle = el("button", {
        class: "ms-node-del",
        text: isCollapsed ? "▸" : "▾",
        title: "折叠/展开",
      });
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.isLayeredRecall()) {
          if(isCollapsed){this.afterImagesReady(div,toggle as HTMLButtonElement,()=>{this.layeredOpenIds.add(n.id);this.revealNode(n.id);this.recallCollapsed.delete(n.id);this.render();});return;}else{this.layeredOpenIds.delete(n.id);this.revealedIds.delete(n.id);this.recallCollapsed.add(n.id);}
        } else if (this.isRecallHierarchyActive()) {
          if (this.recallCollapsed.has(n.id)) this.recallCollapsed.delete(n.id); else this.recallCollapsed.add(n.id);
        } else this.plugin.store.updateNode(n.id, { collapsed: !n.collapsed });
        this.render();
      });
      actions.append(toggle);
    }
    if (card?.mergedCards?.length) actions.append(el("span", { class: "ms-node-merged", text: "•••", title: `已合并 ${card.mergedCards.length} 张卡片，可在更多操作中解除合并`, "aria-label": `已合并 ${card.mergedCards.length} 张卡片` }));
    if (actions.childElementCount) div.append(actions);
    if (card) {
      const decks = this.plugin.store.cardReviewDecks(card.id);
      if (decks.length) {
        const badges = el("div", { class: "ms-node-review-badges" });
        for (const deck of decks) badges.append(el("span", { class: "ms-node-review-badge", text: deck.name, "data-deck-id": deck.id, title: `已加入复习卡组：${deck.name}` }));
        div.append(badges);
      }
    }

    div.addEventListener("pointerdown", (e) => this.onNodePointerDown(e, n, div));
    div.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if (!this.multiSelect) this.editNode(n);
    });
    div.addEventListener("contextmenu", (event) => {
      event.preventDefault(); event.stopPropagation();
      if (!this.selectedIds.has(n.id)) this.multiSelect ? this.toggleSelect(n.id) : this.selectSingle(n.id);
      showNodeActions(this.plugin, [...this.selectedIds], event, () => { this.revealedIds.clear(); this.render(); });
    });
    div.addEventListener("click", (e) => {
      if(this.isLayeredRecall()&&!this.layeredOpenIds.has(n.id)&&!(e.target instanceof Element && e.target.closest("button,a,input"))){const open=div.querySelector<HTMLButtonElement>('[aria-label="揭开下一层"]');if(open&&!open.disabled)open.click();return;}
      if (this.connectMode) {
        this.onConnectClick(n, div);
        return;
      }
      if (this.dragged) return;
      if (this.multiSelect || e.ctrlKey || e.metaKey) {
        this.toggleSelect(n.id);
      } else {
        this.selectSingle(n.id);
        if (n.cardId) this.notifyUserCardSelection(n.cardId);
      }
    });
    div.addEventListener("keydown", (event) => {
      if (event.target !== div || (event.key !== " " && event.key !== "Enter")) return;
      event.preventDefault();
      if (this.multiSelect || event.ctrlKey || event.metaKey) this.toggleSelect(n.id);
      else {
        this.selectSingle(n.id);
        if (n.cardId) this.notifyUserCardSelection(n.cardId);
      }
    });
    return div;
  }

  private onNodePointerDown(e: PointerEvent, n: MindNode, div: HTMLElement): void {
    if ((e.target as HTMLElement).closest("button, a, input, textarea, [contenteditable=true]") || this.multiSelect || this.connectMode || e.button !== 0 || this.finishNodeDrag) return;
    e.preventDefault(); e.stopPropagation();
    this.dragged = false;
    const pointerId = e.pointerId, startX = e.clientX, startY = e.clientY;
    const dragScale = this.viewScale, ox = n.x, oy = n.y;
    const dragEdges = [...this.edgeEls].flatMap(([key, entry]) => {
      const [from, to] = key.split("->");
      if (from !== n.id && to !== n.id) return [];
      const a = this.nodeEls.get(from), b = this.nodeEls.get(to);
      if (!a || !b) return [];
      return [{ from, to, entry, sx: a.offsetLeft + a.offsetWidth, sy: a.offsetTop + a.offsetHeight / 2, tx: b.offsetLeft, ty: b.offsetTop + b.offsetHeight / 2 }];
    });
    let nextX = ox, nextY = oy;
    let toolbarDisplay: string | null = null;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!this.dragged && Math.hypot(ev.clientX - startX, ev.clientY - startY) < (e.pointerType === "touch" ? 12 : 4)) return;
      if (!this.dragged && this.nodeToolbarEl && this.nodeToolbarEl.style.display !== "none") {
        toolbarDisplay = this.nodeToolbarEl.style.display;
        this.nodeToolbarEl.style.display = "none";
      }
      this.dragged = true;
      div.classList.add("is-dragging");
      nextX = ox + (ev.clientX - startX) / dragScale; nextY = oy + (ev.clientY - startY) / dragScale;
      div.style.transform = `translate(${nextX - ox}px, ${nextY - oy}px)`;
      if (!this.rafId) this.rafId = requestAnimationFrame(() => {
        this.rafId = 0;
        for (const edge of dragEdges) {
          const dx = nextX - ox, dy = nextY - oy;
          const sx = edge.sx + (edge.from === n.id ? dx : 0), sy = edge.sy + (edge.from === n.id ? dy : 0);
          const tx = edge.tx + (edge.to === n.id ? dx : 0), ty = edge.ty + (edge.to === n.id ? dy : 0);
          const curve = Math.max(50, Math.abs(tx - sx) / 2);
          edge.entry.path.setAttribute("d", `M ${sx} ${sy} C ${sx + curve} ${sy}, ${tx - curve} ${ty}, ${tx} ${ty}`);
          if (edge.entry.label) { edge.entry.label.setAttribute("x", String((sx + tx) / 2)); edge.entry.label.setAttribute("y", String((sy + ty) / 2 - 4)); }
        }
      });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel); window.removeEventListener("blur", blur);
      if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
      if (this.finishNodeDrag === abort) this.finishNodeDrag = null;
      div.classList.remove("is-dragging");
      if (commit && this.dragged) { div.style.left = `${nextX}px`; div.style.top = `${nextY}px`; }
      div.style.transform = "";
      if (commit && this.dragged) { this.plugin.store.moveNode(n.id, nextX, nextY); this.drawEdgesFor(n.id); }
      else { div.style.left = `${ox}px`; div.style.top = `${oy}px`; this.drawEdgesFor(n.id); this.dragged = false; }
      if (toolbarDisplay !== null && this.nodeToolbarEl) { this.nodeToolbarEl.style.display = toolbarDisplay; this.positionNodeToolbar(); }
      if (this.renderAfterDrag) { this.renderAfterDrag = false; this.render(); }
    };
    const up = (ev: PointerEvent) => { if (ev.pointerId === pointerId) finish(true); };
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === pointerId) finish(false); };
    const abort = () => finish(false), blur = () => abort();
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel); window.addEventListener("blur", blur);
    this.finishNodeDrag = abort;
  }

  private onConnectClick(n: MindNode, div: HTMLElement): void {
    if (!this.pendingFrom) {
      this.pendingFrom = n.id;
      div.classList.add("is-selected");
    } else if (this.pendingFrom !== n.id) {
      this.plugin.store.addEdge(this.pendingFrom, n.id);
      this.pendingFrom = null;
      this.clearSelection();
      this.render();
    }
  }

  private clearSelection(): void {
    this.selectedIds.clear();
    this.applySelectionClasses();
  }

  /** 焦点模式：仅显示选中节点子树 */
  private toggleFocus(): void {
    if (this.focusId) {
      this.focusId = null;
      new Notice("已退出焦点模式");
      this.render();
      return;
    }
    const sel = this.selectedNodes();
    if (!sel.length) {
      new Notice("请先选中一个节点再聚焦");
      return;
    }
    this.focusId = sel[0].id;
    new Notice("已进入焦点模式（仅显示该节点子树）");
    this.render();
  }

  private depthOf(n: MindNode): number {
    if (n.id === this.options.subtreeRoot) return 0;
    let d = 0;
    let p = n.parentId;
    const visited = new Set<string>([n.id]);
    while (p && !visited.has(p)) {
      visited.add(p);
      d++;
      if (p === this.options.subtreeRoot) break;
      p = this.plugin.store.getNode(p)?.parentId ?? null;
    }
    return d;
  }

  private isRecallHierarchyActive(): boolean {
    return !!this.root?.closest<HTMLElement>(".ms-study-workspace")?.querySelector(".ms-reader-root.ms-recall");
  }
  private isLayeredRecall(): boolean { return this.isRecallHierarchyActive() && !!this.root?.closest<HTMLElement>(".ms-study-workspace")?.hasAttribute("data-recall-layered"); }

  /** 脑图复习模式 */
  private setReviewMode(mode: "" | "mask" | "title" | "expand" | "recite"): void {
    this.reviewMode = mode;
    this.revealedIds.clear();
    this.maxDepth = 1;
    this.reciteIdx = 0;
    if (mode) {
      new Notice(`脑图复习：${this.reviewModeName(mode)}`);
      if (mode === "recite") this.applyRecite();
    } else {
      this.focusId = null;
    }
    if (this.reviewControlBtn)
      this.reviewControlBtn.style.display = mode === "expand" || mode === "recite" ? "" : "none";
    this.render();
  }
  private reviewModeName(m: string): string {
    return m === "mask" ? "遮挡回忆" : m === "title" ? "标题抽查" : m === "expand" ? "逐级展开" : m === "recite" ? "子脑图默写" : "关闭";
  }

  /** 节点搜索过滤：不匹配的节点淡化显示 */
  private setSearch(q: string): void {
    const lower = q.toLowerCase();
    this.nodeEls.forEach((div, id) => {
      const node = this.plugin.store.nodes.find((n) => n.id === id);
      const hit = !lower || (node && nodeContent(this.plugin.store, node).title.toLowerCase().includes(lower));
      div.classList.toggle("ms-dim", !hit);
    });
  }
  private reviewStep(): void {
    if (this.reviewMode === "expand") {
      this.maxDepth += 1;
      this.render();
    } else if (this.reviewMode === "recite") {
      this.applyRecite();
    }
  }
  private applyRecite(): void {
    const scoped = this.scopedNodes();
    const ids = new Set(scoped.map((node) => node.id));
    const roots = scoped.filter((node) => !node.parentId || !ids.has(node.parentId));
    if (!roots.length) return;
    this.reciteIdx = (this.reciteIdx + 1) % roots.length;
    this.focusId = roots[this.reciteIdx].id;
    this.render();
  }

  /** 沉浸模式 */
  private toggleImmersive(): void {
    this.immersive = !this.immersive;
    this.plugin.store.settings.immersive = this.immersive;
    this.plugin.store.save();
    this.root?.classList.toggle("is-immersive", this.immersive);
    if (this.immersive) {
      this.toolbarEl?.style.setProperty("display", "none");
      this.nodeToolbarEl?.style.setProperty("display", "none");
    }
    new Notice(this.immersive ? "已进入沉浸模式" : "已退出沉浸模式");
  }

  /** 子脑图：在浮动视图打开选中节点的子树 */
  private openChildMap(): void {
    const sel = this.selectedNodes();
    if (sel.length !== 1) {
      new Notice("请选中单个节点以打开子脑图");
      return;
    }
    const { bg, modal, close } = createModal(
      "子脑图：" + (nodeContent(this.plugin.store, sel[0]).title || "(空)"),
      () => child.destroy()
    );
    const wrap = el("div", { style: "width:min(80vw,700px);height:70vh;position:relative" });
    const child = new MindmapRenderer(this.plugin, { showToolbar: true, subtreeRoot: sel[0].id });
    const pin=el("button",{text:"固定此子脑图视角", "aria-label":"固定此子脑图视角"});
    pin.addEventListener("click",()=>{const store=this.plugin.store,node=store.getNode(sel[0].id),canvas=store.canvases.find(item=>item.id===node?.canvasId),set=store.studySets.find(item=>item.id===canvas?.studySetId);if(!node||!canvas||!set)return;store.updateStudySet(set.id,{fixedViews:[...(set.fixedViews??[]),{id:uid("fixed"),name:(node.title||"未命名节点")+" · 子脑图",kind:"submap",canvasId:canvas.id,nodeId:node.id,viewport:child.captureViewport()}]});new Notice("已固定子脑图视角");});
    modal.append(pin,wrap);
    child.mount(wrap);
  }

  /** 折叠为子脑图：把选中节点的子树收拢（主视图隐藏，点击 ⊞ 在浮动视图打开） */
  private collapseToSubmap(): void {
    const sel = this.selectedNodes();
    if (sel.length !== 1) {
      new Notice("请选中单个有子节点的节点");
      return;
    }
    const n = sel[0];
    const kids = this.plugin.store.nodes.filter((c) => c.parentId === n.id);
    if (!kids.length) {
      new Notice("该节点没有子节点，无法折叠为子脑图");
      return;
    }
    this.plugin.store.updateNode(n.id, { submap: true });
    this.selectSingle(n.id);
    this.render();
    new Notice("已折叠为子脑图，点击节点上的 ⊞ 展开子树");
  }

  /** 展开子脑图：恢复为正展开的节点树 */
  private expandSubmap(): void {
    const sel = this.selectedNodes();
    if (sel.length !== 1) {
      new Notice("请选中单个节点");
      return;
    }
    this.plugin.store.updateNode(sel[0].id, { submap: false });
    this.render();
    new Notice("已展开子脑图");
  }

  private selectSingle(id: string, source: "direct" | "linked" = "direct"): void {
    this.selectionSource = source;
    this.selectedIds.clear();
    this.selectedIds.add(id);
    this.applySelectionClasses();
  }

  private toggleSelect(id: string): void {
    this.selectionSource = "direct";
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
    this.applySelectionClasses();
  }

  private applySelectionClasses(): void {
    this.nodeEls.forEach((d, id) => {
      d.classList.toggle("is-selected", this.selectedIds.has(id));
      d.setAttribute("data-selected", String(this.selectedIds.has(id)));
    });
    this.updateNodeToolbar();
    this.options.onSelectionChange?.(this.selectedNodes().map((node) => ({ ...node })));
  }

  private selectedNodes(): MindNode[] {
    return this.scopedNodes().filter((n) => this.selectedIds.has(n.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  private makeEdgePath(e: Edge, a: HTMLElement, b: HTMLElement, movedId?: string, dxMove = 0, dyMove = 0): { path: SVGElement; label?: SVGElement } {
    const sx = a.offsetLeft + a.offsetWidth + (e.from === movedId ? dxMove : 0);
    const sy = a.offsetTop + a.offsetHeight / 2 + (e.from === movedId ? dyMove : 0);
    const tx = b.offsetLeft + (e.to === movedId ? dxMove : 0);
    const ty = b.offsetTop + b.offsetHeight / 2 + (e.to === movedId ? dyMove : 0);
    const dx = Math.max(50, Math.abs(tx - sx) / 2);
    // 连线颜色跟随子节点背景色；无色则用 divider
    const stroke = b.style.backgroundColor || "var(--divider-color)";
    const path = svgEl("path", {
      d: `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`,
      fill: "none",
      stroke,
      "stroke-width": 2.5,
      "stroke-opacity": "0.75",
    });
    let label: SVGElement | undefined;
    if (e.label) {
      label = svgEl("text", {
        x: (sx + tx) / 2,
        y: (sy + ty) / 2 - 4,
        class: "ms-edge-label",
      });
      label.textContent = e.label;
    }
    return { path, label };
  }

  private drawEdges(nodes: MindNode[]): void {
    if (!this.svg) return;
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    this.edgeEls.clear();
    const ids = new Set(nodes.map((node) => node.id));
    const edges = this.plugin.store.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    for (const node of nodes) {
      if (node.parentId && ids.has(node.parentId) && !edges.some((edge) => edge.from === node.parentId && edge.to === node.id)) {
        edges.push({ from: node.parentId, to: node.id });
      }
    }
    for (const e of edges) {
      const a = this.nodeEls.get(e.from);
      const b = this.nodeEls.get(e.to);
      if (!a || !b) continue;
      const { path, label } = this.makeEdgePath(e, a, b);
      this.svg.append(path);
      if (label) this.svg.append(label);
      this.edgeEls.set(`${e.from}->${e.to}`, { path, label });
    }
  }

  /** 拖拽时只更新与该节点相连的边 */
  private drawEdgesFor(nodeId: string, dx = 0, dy = 0): void {
    for (const [key, entry] of this.edgeEls) {
      const [from, to] = key.split("->");
      if (from !== nodeId && to !== nodeId) continue;
      const a = this.nodeEls.get(from);
      const b = this.nodeEls.get(to);
      if (!a || !b) continue;
      const e = this.plugin.store.edges.find((x) => x.from === from && x.to === to) ?? { from, to };
      const { path, label } = this.makeEdgePath(e, a, b, nodeId, dx, dy);
      entry.path.setAttribute("d", path.getAttribute("d")!);
      if (entry.label && label) {
        entry.label.setAttribute("x", label.getAttribute("x")!);
        entry.label.setAttribute("y", label.getAttribute("y")!);
      }
    }
  }

  updateMovedNodes(ids: readonly string[]): void {
    for (const id of ids) {
      const node = this.plugin.store.getNode(id), element = this.nodeEls.get(id);
      if (!node || !element) continue;
      element.style.left = `${node.x}px`; element.style.top = `${node.y}px`;
      this.drawEdgesFor(id);
    }
    this.positionNodeToolbar();
  }

  // ===== 操作 =====
  private importCards(): void {
    const ad = this.currentScope();
    if (!ad && !this.plugin.store.activeStudySetId) {
      new Notice("请先选择学习集，或在 MarginStudy 中打开一份文档");
      return;
    }
    const cards = this.plugin.store.activeStudySetId ? this.plugin.store.getScopedCards() : this.plugin.store.cardsOfDoc(ad!);
    let added = 0;
    for (const c of cards) {
      if (this.scopedNodes().some((n) => n.cardId === c.id)) continue;
      const rootId = this.ensureRoot(c.docPath);
      const sibs = this.scopedNodes().filter((n) => n.parentId === rootId);
      this.plugin.store.addNode({
        id: uid("node"),
        parentId: rootId,
        title: c.front,
        cardId: c.id,
        docPath: c.docPath,
        canvasId: this.currentCanvasId(),
        reference: true,
        collapsed: false,
        x: 0,
        y: 0,
        color: this.branchColor(sibs.length),
      });
      added++;
    }
    if (added === 0) {
            new Notice("没有可导入的新卡片（已存在对应节点）");
    } else {
            new Notice(`已导入 ${added} 个节点`);
      this.autoLayout();
      this.render();
    }
  }

  private ensureRoot(ad: string): string {
    const existing = this.scopedNodes().find((n) => n.docPath === ad && n.parentId === null && !n.cardId);
    if (existing) return existing.id;
    const id = uid("node");
    this.plugin.store.addNode({
      id,
      parentId: null,
      title: basename(ad),
      docPath: ad,
      canvasId: this.currentCanvasId(),
      collapsed: false,
      x: 40,
      y: 40,
      color: this.branchColor(0),
    });
    return id;
  }

  private newNodeAt(x: number, y: number): void {
    const ad = this.currentScope() ?? undefined;
    openTextModal({
      title: "新建节点",
      placeholder: "输入节点标题",
      onOk: (v) => {
        if (!v.trim()) return;
        const sibs = this.scopedNodes().filter((n) => n.parentId === null);
        this.plugin.store.addNode({
          id: uid("node"),
          parentId: null,
          title: v.trim(),
          docPath: ad,
          canvasId: this.currentCanvasId(),
          collapsed: false,
          x,
          y,
          color: this.branchColor(sibs.length),
        });
        this.render();
      },
    });
  }

  /** 柔和分支色板（MarginNote 风格 pastel cards） */
  private branchColor(index: number): string {
    const palette = [
      "#ffe8d6", // 暖橙
      "#ffd6e0", // 粉红
      "#d4f5d4", // 浅绿
      "#d4e5ff", // 浅蓝
      "#f0d4ff", // 浅紫
      "#fff2cc", // 浅黄
      "#e2f0cb", // 青绿
      "#cfe8fc", // 天蓝
    ];
    return palette[index % palette.length];
  }

  private editNode(n: MindNode): void {
    const card = n.cardId ? this.plugin.store.getCard(n.cardId) : undefined;
    openTextModal({
      title: card ? "编辑卡片标题（同步所有引用）" : "编辑节点",
      initial: nodeContent(this.plugin.store, n).title,
      onOk: (v) => {
        if (card) this.plugin.store.updateCard(card.id, { title: v.trim() });
        else this.plugin.store.updateNode(n.id, { title: v.trim() });
        this.plugin.refreshMindmap();
        this.render();
      },
    });
  }

  private onCanvasDblClick(e: MouseEvent): void {
    if (this.handwritingMode !== "off") return;
    if (!this.world) return;
    const point = this.viewCoordinates(e.clientX, e.clientY);
    const x = point.worldX;
    const y = point.worldY;
    this.newNodeAt(Math.max(10, x), Math.max(10, y));
  }

  private onDragOver(e: DragEvent): void {
    e.preventDefault();
  }

  private onDrop(e: DragEvent): void {
    e.preventDefault();
    const boardData = e.dataTransfer?.getData(BOARD_DRAG_TYPE);
    if (boardData && this.world) {
      try {
        if (boardData.length > 65536) return;
        const payload = JSON.parse(boardData) as { version?: number; cardIds?: unknown };
        if (payload.version !== 1 || !Array.isArray(payload.cardIds) || payload.cardIds.length > 1000 || payload.cardIds.some((id) => typeof id !== "string")) return;
        const point = this.viewCoordinates(e.clientX, e.clientY);
        const ids = copyBoardCards(this.plugin.store, payload.cardIds, { canvasId: this.currentCanvasId(),
          x: Math.max(10, point.worldX - 60), y: Math.max(10, point.worldY - 20) });
        this.selectedIds = new Set(ids); this.render();
        if (ids.length) new Notice(`已从看板复制 ${ids.length} 张卡片到脑图`);
      } catch (error) { new Notice("无法从看板生成脑图：" + String(error)); }
      return;
    }
    const cardId = e.dataTransfer?.getData("text/plain").trim() || undefined;
    const annId = e.dataTransfer?.getData("application/margin-study-ann-id").trim() || undefined;
    if (!cardId && !annId) return;

    let card = cardId ? this.plugin.store.getCard(cardId) : undefined;
    if (!card && annId && this.currentScope()) {
      // 从标注 id 反查卡片（region 标注的 cardId 通常在 dragstart 时已传，但兜底）
      // Read the canonical card rather than starting an unobserved annotation load.
      card = this.plugin.store.cards.find((c) => c.anchorAnnId === annId);
    }
    if (!card) return;

    const docPath = card.docPath;
    const rootId = this.ensureRoot(docPath);
    if (this.scopedNodes().some((n) => n.cardId === card!.id)) {
      new Notice("该卡片已在当前脑图中；可复制节点后粘贴引用或独立克隆");
      return;
    }

    if (!this.world) return;
    const point = this.viewCoordinates(e.clientX, e.clientY);
    const x = point.worldX;
    const y = point.worldY;

    this.plugin.store.addNode({
      id: uid("node"),
      parentId: rootId,
      title: card.front,
      cardId: card.id,
      docPath,
      canvasId: this.currentCanvasId(),
      reference: true,
      image: card.image,
      collapsed: false,
      x: Math.max(10, x - 60),
      y: Math.max(10, y - 20),
    });
    this.plugin.sidebar?.setTab("mindmap");
    this.render();
    new Notice("已加入脑图");
  }

  private autoLayout(): void {
    const visible = this.visibleNodes();
    const scoped = this.scopedNodes().filter((node) => !this.isGroupedMember(node));
    const included = new Set(visible.map((node) => node.id));
    let count = -1;
    while (count !== included.size) {
      count = included.size;
      for (const node of scoped) if (node.parentId && included.has(node.parentId)) included.add(node.id);
    }
    const nodes = scoped.filter((node) => included.has(node.id)).map((node) => ({ ...node }));
    const children = new Map<string, MindNode[]>();
    for (const node of nodes) if (node.parentId && included.has(node.parentId)) {
      const siblings = children.get(node.parentId) ?? [];
      siblings.push(node);
      children.set(node.parentId, siblings);
    }
    const vertical = ["down", "timeline", "org"].includes(this.plugin.store.settings.layout);
    const gap = 40;
    const sizes = new Map<string, { width: number; height: number }>();
    for (const node of nodes) {
      let element = this.nodeEls.get(node.id);
      const temporary = !element;
      if (!element && this.world) {
        element = this.makeNodeDiv(node);
        element.style.visibility = "hidden";
        this.world.append(element);
      }
      const width = element?.offsetWidth ?? 0, height = element?.offsetHeight ?? 0;
      if (temporary) element?.remove();
      if (!width || !height) { new Notice("无法测量节点尺寸，请显示脑图后重试自动布局"); return; }
      sizes.set(node.id, { width, height });
    }
    const ids = new Set(nodes.map((node) => node.id));
    const roots = nodes.filter((n) => n.parentId === null || !ids.has(n.parentId));
    let rootY = 40;
    for (const root of roots) {
      const levels: number[] = [];
      const spans = new Map<string, number>();
      const measure = (node: MindNode, depth: number): number => {
        const size = sizes.get(node.id)!;
        levels[depth] = Math.max(levels[depth] ?? 0, vertical ? size.width : size.height);
        const kids = children.get(node.id) ?? [];
        const total = kids.reduce((sum, child) => sum + measure(child, depth + 1), 0) + Math.max(0, kids.length - 1) * gap;
        const span = Math.max(vertical ? size.height : size.width, total);
        spans.set(node.id, span);
        return span;
      };
      const span = measure(root, 0);
      const offsets = levels.map((_, depth) => 40 + levels.slice(0, depth).reduce((sum, level) => sum + level + gap, 0));
      const place = (node: MindNode, depth: number, start: number): void => {
        const size = sizes.get(node.id)!;
        const nodeSpan = spans.get(node.id)!;
        if (vertical) { node.x = offsets[depth]; node.y = rootY + start + (nodeSpan - size.height) / 2; }
        else { node.x = 40 + start + (nodeSpan - size.width) / 2; node.y = rootY + offsets[depth] - 40; }
        const kids = children.get(node.id) ?? [];
        const total = kids.reduce((sum, child) => sum + spans.get(child.id)!, 0) + Math.max(0, kids.length - 1) * gap;
        let cursor = start + (nodeSpan - total) / 2;
        for (const child of kids) { place(child, depth + 1, cursor); cursor += spans.get(child.id)! + gap; }
      };
      place(root, 0, 0);
      rootY += (vertical ? span : levels.reduce((sum, level) => sum + level, 0) + (levels.length - 1) * gap) + gap;
    }
    this.plugin.store.updateNodes(nodes.map((node) => ({ id: node.id, patch: { x: node.x, y: node.y } })));
  }

  private clearAll(): void {
    openConfirm("清空导图", "将删除当前范围的所有节点与连线，确定？", () => {
      this.plugin.store.removeNodes(this.scopedNodes().map((node) => node.id));
      this.render();
    });
  }

  // ===== 节点操作 =====
  private isGroupedMember(node: MindNode): boolean { return !!(node.cardId && this.plugin.store.getCard(node.cardId)?.groupId); }
  private currentCanvas() {
    return this.plugin.store.canvases.find((canvas) => canvas.id === this.currentCanvasId());
  }
  private singleRecall(): boolean { return !!this.currentCanvas()?.singlePeek || !!this.root?.closest<HTMLElement>(".ms-study-workspace")?.hasAttribute("data-recall-single"); }
  private clearOtherRecalls(): void { if(this.singleRecall()){this.revealedIds.clear();this.revealedImageMasks.clear();this.revealedEmphasis.clear();this.root?.dispatchEvent(new CustomEvent("ms-recall-reveal",{bubbles:true,detail:{source:"map"}}));} }
  private revealNode(id: string): void { this.clearOtherRecalls(); revealAt(this.revealedIds, id, false); }
  private afterImagesReady(div:HTMLElement,button:HTMLButtonElement,action:()=>void):void {
    const images=[...div.querySelectorAll<HTMLImageElement>("img.ms-node-img")];if(images.every(image=>image.complete)){action();return;}
    button.disabled=true;
    const pending=images.filter(image=>!image.complete);
    let finished=false;
    const cleanup=()=>{clearTimeout(timeout);for(const image of pending){image.removeEventListener("load",check);image.removeEventListener("error",check);}};
    const check=()=>{if(finished||!pending.every(image=>image.complete))return;finished=true;cleanup();if(div.isConnected)action();};
    const timeout=window.setTimeout(()=>{if(finished)return;finished=true;cleanup();if(div.isConnected){button.disabled=false;button.title="图片仍在加载，请稍后重试";}},10000);
    for(const image of pending){image.addEventListener("load",check);image.addEventListener("error",check);}
    check();
  }
  private updateCardRemaining(div: HTMLElement, nodeId: string, bodyMasked: boolean): void {
    let remaining = div.querySelector<HTMLElement>("[data-card-remaining]");
    const imageMasks = [...div.querySelectorAll<HTMLButtonElement>('[data-image-mask][aria-pressed="false"]')];
    const hiddenByBody = (element: Element) => bodyMasked && !!element.closest<HTMLElement>('[style*="visibility: hidden"]');
    const count = Number(bodyMasked) + imageMasks.filter(mask=>!hiddenByBody(mask)).length + [...div.querySelectorAll('[aria-label="揭晓强调内容"]')].filter(mask=>!hiddenByBody(mask)).length;
    let action=div.querySelector<HTMLButtonElement>("[data-recall-all]");
    if (!bodyMasked && this.isRecallHierarchyActive() && (count || this.revealedIds.has(nodeId))) {
      if(!action){action=el("button",{type:"button",class:"ms-cloze","data-recall-all":""}) as HTMLButtonElement;Object.assign(action.style,{position:"absolute",left:"8px",bottom:"100%",zIndex:"2"});div.append(action);}
      const allShown=this.revealedIds.has(nodeId);action.textContent=allShown?"重新遮回":"揭开本卡全部遮挡";
      action.onclick=event=>{event.stopPropagation();this.afterImagesReady(div,action!,()=>{if(allShown){this.revealedIds.delete(nodeId);for(const key of [...this.revealedImageMasks])if(key.startsWith(nodeId+":"))this.revealedImageMasks.delete(key);for(const key of [...this.revealedEmphasis])if(key.startsWith(nodeId+":"))this.revealedEmphasis.delete(key);}else this.revealNode(nodeId);this.render();});};
    } else if (!bodyMasked && this.revealedIds.has(nodeId)) {
      if(!action){action=el("button",{type:"button",class:"ms-cloze","data-recall-all":""}) as HTMLButtonElement;Object.assign(action.style,{position:"absolute",right:"8px",bottom:"100%",zIndex:"2"});div.append(action);}action.textContent="重新遮回";action.setAttribute("aria-label","重新遮回卡片内容");action.onclick=event=>{event.stopPropagation();this.revealedIds.delete(nodeId);this.render();};
    } else action?.remove();
    if (!count) { remaining?.remove(); return; }
    if (!remaining) { remaining = el("span", { "data-card-remaining": "" }); Object.assign(remaining.style, { position: "absolute", right: "8px", bottom: "100%", zIndex: "2" }); div.append(remaining); }
    remaining.textContent = `还有 ${count} 处`;remaining.setAttribute("aria-label",`本卡还有 ${count} 处遮挡`);
  }
  private renderNodeText(target: HTMLElement, text: string, node: MindNode, firstBlockOnly = false): void {
    void renderMarkdown(this.plugin.app, text, target, nodeContent(this.plugin.store, node).docPath).then(() => {
      if (firstBlockOnly) for (const child of [...target.children].slice(1)) if (child instanceof HTMLElement) { child.style.visibility = "hidden"; child.setAttribute("aria-hidden", "true"); }
      const recall = this.isRecallHierarchyActive() && this.root?.closest<HTMLElement>(".ms-study-workspace")?.hasAttribute("data-recall-mask-emphasis-images");
      if (recall && !this.revealedIds.has(node.id)) {
        const field=target.dataset.recallSection??target.dataset.field??"text",prefix=`${node.id}:${field}:`;
        const shown=new Set([...this.revealedEmphasis].filter(key=>key.startsWith(prefix)).map(key=>Number(key.slice(prefix.length))));
        maskEmphasis(target, index=>{this.clearOtherRecalls();this.revealedEmphasis.add(prefix+index);this.render();},true,shown);
      } else if (this.reviewMode && this.currentCanvas()?.emphasisCloze && !this.revealedIds.has(node.id)) {
        maskEmphasis(target, () => { this.revealNode(node.id); this.render(); }, true);
      }
      const div=target.closest<HTMLElement>(".ms-node");if(div)this.updateCardRemaining(div,node.id,!!div.querySelector('[aria-label="揭晓整卡内容"]'));
    });
  }
  private detachSelectedReference(): void {
    const nodes = this.selectedOrWarn();
    if (nodes.length !== 1) { if (nodes.length) new Notice("请选中单个节点以断开引用"); return; }
    detachNode(this.plugin, nodes[0], () => this.render());
  }
  private splitSelectedContent(): void {
    const nodes = this.selectedOrWarn();
    if (nodes.length !== 1) { if (nodes.length) new Notice("请选中单个节点以拆分内容"); return; }
    openNodeSplit(this.plugin, nodes[0], (newId) => { if (newId) this.selectSingle(newId); this.render(); });
  }
  private toggleSelectedOcclusion(): void {
    const nodes = this.selectedOrWarn();
    if (!nodes.length) return;
    this.plugin.store.toggleNodeOcclusion(nodes.map((node) => node.id));
    this.revealedIds.clear();
    this.render();
  }
  private hideSelected(): void {
    const nodes = this.selectedOrWarn();
    for (const node of nodes) this.plugin.store.setNodeHidden(node.id, true);
    this.clearSelection();
    this.render();
  }
  private selectedOrWarn(): MindNode[] {
    const nodes = this.selectedNodes();
    if (!nodes.length) new Notice("请先选中节点");
    return nodes;
  }

  private deleteSelectedNodes(): void {
    const nodes = this.selectedOrWarn();
    if (!nodes.length) return;
    openConfirm("删除节点", `删除 ${nodes.length} 个选中节点及其子节点？`, () => {
      this.plugin.store.removeNodes(nodes.map((node) => node.id));
      this.clearSelection();
      this.render();
    });
  }

  private pickColor(): void {
    const nodes = this.selectedOrWarn();
    if (!nodes.length) return;
    const { bg, modal, close } = createModal("选择节点颜色");
    const row = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px" });
    for (const [index, c] of CARD_COLORS.entries()) {
      const b = el("button", {
        style: `width:32px;height:32px;border-radius:50%;background:${c};border:2px solid var(--background-modifier-border)`,
        title: c,
      });
      b.addEventListener("click", () => {
        for (const n of nodes) {
          if (n.cardId && this.plugin.store.getCard(n.cardId)) this.plugin.store.updateCard(n.cardId, { color: c, colorIndex: index });
          else this.plugin.store.updateNode(n.id, { color: c });
        }
        this.plugin.refreshMindmap();
        this.render();
        close();
      });
      row.append(b);
    }
    const clearBtn = el("button", { class: "ms-btn", text: "清除颜色" });
    clearBtn.addEventListener("click", () => {
      for (const n of nodes) {
        if (n.cardId && this.plugin.store.getCard(n.cardId)) this.plugin.store.updateCard(n.cardId, { color: undefined });
        else this.plugin.store.updateNode(n.id, { color: undefined });
      }
      this.plugin.refreshMindmap();
      this.render();
      close();
    });
    modal.append(row, clearBtn);
    bg.append(modal);
  }

  private editTags(): void {
    const nodes = this.selectedOrWarn();
    if (!nodes.length) return;
    const allTags = Array.from(new Set(nodes.flatMap((n) => nodeContent(this.plugin.store, n).tags)));
    const { bg, modal, close } = createModal("编辑标签");
    const ta = el("textarea", {
      placeholder: "每行一个标签，或英文逗号分隔",
      style: "min-height:80px;width:100%;font-family:inherit",
    }) as HTMLTextAreaElement;
    ta.value = allTags.join(", ");
    const ok = el("button", { class: "ms-btn primary", text: "确定" });
    ok.addEventListener("click", () => {
      const tags = ta.value
        .split(/[\n,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const n of nodes) {
        if (n.cardId && this.plugin.store.getCard(n.cardId)) this.plugin.store.updateCard(n.cardId, { tags });
        else this.plugin.store.updateNode(n.id, { tags });
      }
      this.plugin.refreshMindmap();
      this.render();
      close();
    });
    const cancel = el("button", { class: "ms-btn", text: "取消" });
    cancel.addEventListener("click", close);
    const actions = el("div", { class: "ms-modal-actions" });
    actions.append(cancel, ok);
    modal.append(ta, actions);
    bg.append(modal);
    setTimeout(() => ta.focus(), 0);
  }

  private addLink(): void {
    const nodes = this.selectedOrWarn();
    if (!nodes.length) return;
    if (nodes.length === 2) {
      this.plugin.store.addEdge(nodes[0].id, nodes[1].id);
      this.render();
      new Notice("已添加关联线");
      return;
    }
    // 单选时进入连线模式
    this.toggleConnect();
  }

  private createSummary(): void {
    const nodes = this.selectedOrWarn();
    if (nodes.length < 2) {
      new Notice("请至少选中两个同级节点以创建概要");
      return;
    }
    const parentId = nodes[0].parentId;
    if (!nodes.every((n) => n.parentId === parentId)) {
      new Notice("概要只能为同一父节点下的兄弟节点创建");
      return;
    }
    openTextModal({
      title: "概要节点",
      placeholder: "输入概要内容",
      onOk: (v) => {
        if (!v.trim()) return;
        const summaryId = uid("node");
        const docPath = nodes[0].docPath;
        // 计算位置：位于选中节点上方居中
        const minX = Math.min(...nodes.map((n) => n.x));
        const maxX = Math.max(...nodes.map((n) => n.x + 220));
        const minY = Math.min(...nodes.map((n) => n.y));
        this.plugin.store.addNode({
          id: summaryId,
          parentId,
          title: v.trim(),
          docPath,
          canvasId: nodes[0].canvasId,
          order: Math.min(...nodes.map((node) => node.order ?? 0)),
          collapsed: false,
          x: (minX + maxX) / 2 - 80,
          y: Math.max(10, minY - 100),
        });
        nodes.forEach((node, index) => this.plugin.store.reparentNode(node.id, summaryId, index));
        this.clearSelection();
        this.selectSingle(summaryId);
        this.render();
      },
    });
  }

  private regroupNodes(): void {
    const nodes = this.selectedOrWarn();
    if (nodes.length < 2) {
      new Notice("请至少选中两个节点进行重组");
      return;
    }
    if (!nodes.every((node) => node.parentId === nodes[0].parentId)) {
      new Notice("请选中同级节点进行重组，以保留完整层级");
      return;
    }
    openTextModal({
      title: "重组：新建父节点",
      placeholder: "输入新父节点标题",
      onOk: (v) => {
        if (!v.trim()) return;
        const parentId = uid("node");
        const docPath = nodes[0].docPath;
        const minX = Math.min(...nodes.map((n) => n.x));
        const minY = Math.min(...nodes.map((n) => n.y));
        this.plugin.store.addNode({
          id: parentId,
          parentId: nodes[0].parentId,
          title: v.trim(),
          docPath,
          canvasId: nodes[0].canvasId,
          order: Math.min(...nodes.map((node) => node.order ?? 0)),
          collapsed: false,
          x: minX,
          y: Math.max(10, minY - 100),
        });
        nodes.forEach((node, index) => this.plugin.store.reparentNode(node.id, parentId, index));
        this.clearSelection();
        this.selectSingle(parentId);
        this.render();
      },
    });
  }

  private mergeNodes(): void {
    const nodes = this.selectedOrWarn();
    if (!this.multiSelect || nodes.length < 2) {
      new Notice("请进入多选模式并选中至少两张卡片");
      return;
    }
    try {
      const keepId = this.plugin.store.mergeNodes(nodes.map((node) => node.id));
      if (!keepId) {
        new Notice("这些节点无法合并，请重新选择同一脑图内的节点");
        return;
      }
      this.clearSelection();
      this.selectSingle(keepId);
      this.plugin.refreshSidebar();
      this.plugin.refreshMindmap();
      this.render();
    } catch (error) { new Notice("无法合并：" + String(error)); }
  }

  private editComments(): void {
    const nodes = this.selectedOrWarn();
    if (!nodes.length) return;
    const target = nodes[0];
    const { bg, modal, close } = createModal("节点评论");
    const list = el("div", { style: "max-height:200px;overflow:auto;margin-bottom:10px" });
    const refresh = () => {
      clear(list);
      const comments = target.comments ?? [];
      if (!comments.length) {
        list.append(el("div", { text: "暂无评论", style: "color:var(--text-muted);padding:8px 0" }));
      } else {
        comments.forEach((c, i) => {
          const row = el("div", { style: "padding:6px 0;border-bottom:1px solid var(--background-modifier-border)" });
          row.append(el("div", { text: c, style: "white-space:pre-wrap" }));
          const del = el("button", { class: "ms-node-del", text: "删除", style: "margin-top:4px" });
          del.addEventListener("click", () => {
            const next = [...(target.comments ?? [])];
            next.splice(i, 1);
            this.plugin.store.updateNode(target.id, { comments: next.length ? next : undefined });
            refresh();
            this.render();
          });
          row.append(del);
          list.append(row);
        });
      }
    };
    refresh();
    const ta = el("textarea", {
      placeholder: "添加新评论…",
      style: "min-height:60px;width:100%;font-family:inherit",
    }) as HTMLTextAreaElement;
    const add = el("button", { class: "ms-btn primary", text: "添加" });
    add.addEventListener("click", () => {
      const text = ta.value.trim();
      if (!text) return;
      const next = [...(target.comments ?? []), text];
      this.plugin.store.updateNode(target.id, { comments: next });
      ta.value = "";
      refresh();
      this.render();
    });
    modal.append(list, ta, add);
    bg.append(modal);
  }

  private copyNodes(): void {
    const nodes = this.selectedOrWarn();
    if (!nodes.length) return;
    cardClipboard.fragment = this.plugin.store.copySubtree(nodes.map((n) => n.id));
    cardClipboard.mode = "clone";
    cardClipboard.cut = null;
    new Notice(`已复制 ${cardClipboard.fragment.nodes.length} 个节点，可切换脑图后粘贴`);
  }

  private cutNodes(): void {
    const nodes = this.selectedOrWarn();
    if (!nodes.length) return;
    cardClipboard.fragment = this.plugin.store.copySubtree(nodes.map((n) => n.id));
    cardClipboard.cut = {store:this.plugin.store,roots:nodes.map(node=>node.id),snapshot:JSON.stringify(cardClipboard.fragment)};
    new Notice(`已剪切 ${cardClipboard.fragment.nodes.length} 个节点；成功粘贴后移动原卡片`);
  }

  private pasteNodes(mode: "reference" | "clone"): void {
    if (!cardClipboard.fragment) {
      new Notice("剪贴板为空");
      return;
    }
    const ref = this.selectedNodes()[0];
    const parentId = ref?.id ?? null;
    let newIds:string[];
    const moving = !!cardClipboard.cut;
    try {
      if (cardClipboard.cut) {
        if (cardClipboard.cut.store !== this.plugin.store) throw new Error("请在同一资料库粘贴剪切卡片");
        if (JSON.stringify(this.plugin.store.copySubtree(cardClipboard.cut.roots)) !== cardClipboard.cut.snapshot) throw new Error("待剪切卡片已变化，请重新剪切");
        newIds = this.plugin.store.moveSubtrees(cardClipboard.cut.roots,{canvasId:this.currentCanvasId(),parentId,offset:{x:40,y:40}});
        cardClipboard.cut = null; cardClipboard.fragment = null;
      } else newIds = this.plugin.store.pasteSubtree(cardClipboard.fragment, {
        canvasId: this.currentCanvasId(), parentId, mode, offset: { x: 40, y: 40 },
      });
    } catch (error) { new Notice("粘贴失败："+String(error)); return; }
    this.clearSelection();
    newIds.forEach((id) => this.selectedIds.add(id));
    this.applySelectionClasses();
    this.render();
    new Notice(moving ? `已移动 ${newIds.length} 个剪切节点` : `已粘贴 ${newIds.length} 个${mode === "reference" ? "共享引用" : "独立克隆"}节点`);
  }
}
