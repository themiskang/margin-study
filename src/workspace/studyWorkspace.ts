import { ItemView, Menu, Notice, Scope, TFile, WorkspaceLeaf, setIcon, Platform } from "obsidian";
import { setNativeIcon } from "./nativeIcons";
import { builtinSceneTemplates } from "./scenes";
import { clearOcrBuffer } from "../ocr/ocr";
import { useStudySidebarSpace } from "./hostSidebars";
import { DocumentNavigation, documentNavigationTabs } from "./documentNavigation";
import type { DocumentNavigationTab } from "./documentNavigation";
import type MarginStudyPlugin from "../main";
import { handwritingPresets } from "../annot/handwritingPresets";
import { editDocuments } from "../study/studyControls";
import { closeCardActionMenu } from "../study/nodeActions";
import type { HandwritingPresetId, HandwritingPresetSpec, MindNode, ReaderLike, ReadingTheme, StudySceneId, StudySceneSelection, StudySceneTemplate } from "../types";
import { CardBoardRenderer } from "../board/cardBoardRenderer";
import { openNewNotebook } from "../documents/notebook";
import { ReaderView } from "../pdf/readerView";
import { WordReaderView } from "../word/wordReader";
import { DocumentReaderView } from "../documents/documentReader";
import { MindmapRenderer } from "../mindmap/mindmapRenderer";
import { jumpToCardSource, openDetail, renderCardList, startReview } from "../cards/cardView";
import { openReviewDeckBrowser, openReviewDecks } from "../review/decks";
import { imageUrl } from "../review/content";
import { mountResearchBrowser, researchSession } from "../research/browser";
import type { ResearchHandle, ResearchSession } from "../research/browser";
import { mountAiPanel, openAiSettings } from "../ai";
import type { AiPanelHandle, AiContext } from "../ai";
import { openWebImport } from "../import/webImport";
import { openGlobalSearch } from "../search/globalSearch";
import { openSettingAndReveal } from "../search/featureSearch";
import { toggleStudyInterface } from "./scenes";
import { createModal, openConfirm, openTextModal } from "../utils/modal";
import { el } from "../utils/dom";
import { hasDeviceRecallHintProvider, requestDeviceRecallHint } from "../recall/deviceProvider";
import { uid } from "../utils/id";

export const VIEW_TYPE_STUDY_WORKSPACE = "margin-study-workspace";
type ChildReader = ReaderView | WordReaderView | DocumentReaderView;
type AuxiliaryKind="cards"|"review"|"research"|"ai"|"none";
type LinkMode = "both" | "document" | "mindmap" | "off";
type BottomMode = "reading" | "writing" | "recall";
interface DocumentTab { path: string; documentId?: string; state?: Record<string, unknown>; }
interface WorkspaceState {
  tabs: DocumentTab[]; activePath?: string;
  library: boolean; auxiliary: AuxiliaryKind;
  auxiliaryWidths: Record<Exclude<AuxiliaryKind,"none">,number>;
  researchUrl?: string;
  researchSession?: ResearchSession;
  reader: boolean; mindmap: boolean; ratio: number;
  libraryWidth: number; auxiliaryWidth: number; linkMode: LinkMode;
  placement: "left" | "right" | "bottom"; tabLimit: number; showTabs: boolean;
  documentNavigation: boolean; documentNavigationTab: DocumentNavigationTab;
  bottomMode: BottomMode; bottomCollapsed: boolean;
}
const defaults = (): WorkspaceState => ({
  tabs: [], library: false, auxiliary: "cards", reader: true, mindmap: true, ratio: 0.5,
  libraryWidth: 206, auxiliaryWidth: 320, auxiliaryWidths:{cards:320,review:320,research:440,ai:440}, linkMode: "both", placement: "left", tabLimit: 7, showTabs: true, documentNavigation: false, documentNavigationTab: "contents",
  bottomMode: "reading", bottomCollapsed: false,
});
const supported = (file: TFile) => ["pdf", "msref", "docx", "epub", "html", "htm", "md"].includes(file.extension.toLowerCase());
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const readingThemes: {id: ReadingTheme; label: string}[] = [
  {id:"white",label:"White"},{id:"sepia",label:"Sepia"},{id:"gray",label:"Gray"},{id:"dark",label:"Dark"},{id:"green",label:"Green"},
];

/** One owned reader at a time; its public view state survives tab switches. */
export class StudyWorkspaceView extends ItemView {
  private state: WorkspaceState = defaults();
  private stateProvided = false;
  private root!: HTMLElement;
  private toolbar!: HTMLElement;
  private workspaceToolsOpen = false;
  private bottomCapsule!: HTMLElement;
  private workspaceFloatingActions!: HTMLElement;
  private body!: HTMLElement;
  private library!: HTMLElement;
  private libraryList!: HTMLElement;
  private libraryQuery = "";
  private readerPane!: HTMLElement;
  private readerHost!: HTMLElement;
  private comparisonReader: ChildReader | null = null;
  private comparisonPanel: HTMLElement | null = null;
  private comparisonCleanup: (() => void) | null = null;
  private tabBar!: HTMLElement;
  private readerTabRow!: HTMLElement;
  private documentNavigation: DocumentNavigation | null = null;
  private tabResize: ResizeObserver | null = null;
  private releaseHostSidebars: (() => void) | null = null;
  private mapPane!: HTMLElement;
  private mapHost!: HTMLElement;
  private fixedViewsHost!: HTMLElement;
  private fixedViewsOpen = false;
  private fixedViewsSignature = "";
  private recallSettingsSetId: string | undefined | null = null;
  private recallDisplayMode: "in-place" | "layered" = "in-place";
  private auxiliary!: HTMLElement;
  private renderer: MindmapRenderer | null = null;
  private board: CardBoardRenderer | null = null;
  private research: ResearchHandle | null = null;
  private ai: AiPanelHandle | null = null;
  private selection: { text: string; at: number } | null = null;
  private mapAiContext?: AiContext;
  private contextSource: "reader" | "mindmap" | "note" | null = null;
  private readerHandwritingDisposers:(()=>void)[]=[];
  private syncingHandwriting=false;
  private historyScope:"reader"|"library"="library";
  private libraryHistorySignature="";
  private undoButton:HTMLButtonElement|null=null;
  private redoButton:HTMLButtonElement|null=null;
  private auxiliaryKind = "";
  private popup: HTMLElement | null = null;
  private closePageDialog: (() => void) | null = null;
  private closeSpeechDialog: (() => void) | null = null;
  private readerTool = "text";
  private focusedStage = false;
  private focusAnchor: Comment | null = null;
  private deckFilter = false;
  private deckQuery = "";
  private outsidePopup = (event: PointerEvent) => {
    if (this.workspaceToolsOpen && this.toolbar && !this.toolbar.contains(event.target as Node)) {
      this.workspaceToolsOpen = false;
      const controls = this.toolbar.querySelector<HTMLElement>(".ms-workspace-toolbar-controls");
      if (controls && this.toolbar.classList.contains("has-scene-header")) controls.hidden = true;
      this.toolbar.querySelector<HTMLButtonElement>(".ms-workspace-extra-tools-toggle")?.setAttribute("aria-expanded", "false");
    }
    if (this.popup && !this.popup.classList.contains("ms-study-home-screen") && !this.popup.contains(event.target as Node) && !(event.target as HTMLElement).closest("[data-popup-trigger]")) this.dismissPopup();
  };
  private reader: ChildReader | null = null;
  private openChain: Promise<unknown> = Promise.resolve();
  private pending = new Map<string, Promise<ReaderLike>>();
  private closed = true;
  private renderTimer: number | null = null;
  private linkedCard: string | null = null;
  private librarySignature = "";
  private toolbarSignature = "";
  private auxiliarySignature = "";
  private headerTitle = "";
  private workspaceNoticeLayer: HTMLElement | null = null;
  private workspaceNoticeTimer: number | null = null;
  private bottomPressDisposers: (() => void)[] = [];
  private documentHook = (cardId: string) => {
    if (this.state.linkMode === "both" || this.state.linkMode === "document") {
      this.state.mindmap = true; this.applyLayout(); this.renderer?.revealCard(cardId, "linked");
    }
  };
  private mindmapHook = (cardId: string) => {
    if (this.state.linkMode !== "both" && this.state.linkMode !== "mindmap") return;
    const card = this.plugin.store.getCard(cardId);
    if (card) { if (!this.state.reader) { this.state.reader = true; this.applyLayout(); } jumpToCardSource(this.plugin, card); }
  };

  constructor(leaf: WorkspaceLeaf, readonly plugin: MarginStudyPlugin) {
    super(leaf);
    this.scope = new Scope(this.app.scope);
    this.scope.register(["Mod"], "f", event => {
      const target=event.target;
      if(target instanceof Element&&target.closest("input,textarea,[contenteditable=true]"))return;
      this.openReaderSearch();return false;
    });
  }
  getViewType(): string { return VIEW_TYPE_STUDY_WORKSPACE; }
  getIcon(): string { return "panels-top-left"; }
  getDisplayText(): string {
    const set = this.plugin.store.studySets.find(set => set.id === this.plugin.store.activeStudySetId);
    return set ? set.name + " · MarginStudy" : "MarginStudy 学习工作区";
  }
  getReader(): ReaderLike | null { return this.reader; }
  getState(): Record<string, unknown> {
    if(!this.closed)this.captureReader();
    if(this.research){this.state.researchUrl=this.research.currentUrl();this.state.researchSession=this.research.session();}
    return this.plugin.store.normalizeWorkspaceState({ ...this.state, auxiliaryWidths:{...this.state.auxiliaryWidths}, tabs: this.state.tabs.map(tab => ({ ...tab })) });
  }
  async setState(value: any): Promise<void> {
    if (!value || typeof value !== "object") return;
    // Obsidian can reopen the command with no custom view state after a plugin reload.
    // An explicit [] is the user's closed-tabs state and must not use the fallback.
    if (!Array.isArray(value.tabs)) value = { ...this.plugin.store.getWorkspaceState(), ...value };
    value = this.plugin.store.normalizeWorkspaceState(value);
    this.stateProvided = true;
    const next = defaults();
    if (Array.isArray(value.tabs)) next.tabs = value.tabs.filter((tab: any) => tab && typeof tab.path === "string")
      .map((tab: any) => ({ path: tab.path, documentId: typeof tab.documentId === "string" ? tab.documentId : undefined, state: tab.state && typeof tab.state === "object" ? tab.state : undefined }))
      .filter((tab: DocumentTab, index: number, tabs: DocumentTab[]) => tabs.findIndex(item => item.path === tab.path) === index).slice(0, 100);
    if (typeof value.activePath === "string") next.activePath = value.activePath;
    if(typeof value.researchUrl==="string"&&/^https?:\/\//.test(value.researchUrl))next.researchUrl=value.researchUrl;
    if(value.researchSession)next.researchSession=researchSession(value.researchSession);
    for (const key of ["library", "reader", "mindmap", "showTabs"] as const) if (typeof value[key] === "boolean") next[key] = value[key];
    if (!next.reader && !next.mindmap) next.reader = true;
    if (["cards", "review", "research", "ai", "none"].includes(value.auxiliary)) next.auxiliary = value.auxiliary;
    if (["both", "document", "mindmap", "off"].includes(value.linkMode)) next.linkMode = value.linkMode;
    if (["left", "right", "bottom"].includes(value.placement)) next.placement = value.placement;
    if (Number.isFinite(value.ratio)) next.ratio = clamp(value.ratio, 0.2, 0.8);
    if (Number.isFinite(value.libraryWidth)) next.libraryWidth = clamp(value.libraryWidth, 160, 420);
    if (Number.isFinite(value.auxiliaryWidth)) next.auxiliaryWidth = clamp(value.auxiliaryWidth, 240, 640);
    for(const kind of ["cards","review","research","ai"] as const)if(Number.isFinite(value.auxiliaryWidths?.[kind]))next.auxiliaryWidths[kind]=clamp(value.auxiliaryWidths[kind],240,640);
    if(next.auxiliary!=="none"){if(!value.auxiliaryWidths&&Number.isFinite(value.auxiliaryWidth))next.auxiliaryWidths[next.auxiliary]=next.auxiliaryWidth;next.auxiliaryWidth=next.auxiliaryWidths[next.auxiliary];}
    if (Number.isFinite(value.tabLimit)) next.tabLimit = clamp(Math.floor(value.tabLimit), 1, 30);
    if (typeof value.documentNavigation === "boolean") next.documentNavigation = value.documentNavigation;
    if (documentNavigationTabs.some(tab => tab.id === value.documentNavigationTab)) next.documentNavigationTab = value.documentNavigationTab;
    if (["reading", "writing", "recall"].includes(value.bottomMode)) next.bottomMode = value.bottomMode;
    if (typeof value.bottomCollapsed === "boolean") next.bottomCollapsed = value.bottomCollapsed;
    if (!this.closed) await this.openChain.catch(() => {});
    this.state = next;
    if (!this.closed) {
      this.applyLayout(); this.refresh(true);
      const file = this.app.vault.getAbstractFileByPath(next.activePath ?? next.tabs[0]?.path ?? "");
      if (file instanceof TFile && supported(file)) {
        if (this.reader?.getFilePath() === file.path) {
          await this.reader.setState({ ...next.tabs.find(tab => tab.path === file.path)?.state, filePath: file.path });
          this.saveLayout();
        } else {
          // Incoming host state owns all tab positions; do not capture the old view over it.
          await this.releaseReader(); await this.openFile(file);
        }
      }
      else if (this.reader) { await this.releaseReader(); this.showEmptyReader("上次打开的文档已移动或不存在，请从文档列表重新打开。"); }
    }
  }
  async onOpen(): Promise<void> {
    if (!this.stateProvided) await this.setState({});
    this.closed = false;
    this.plugin.studyWorkspace = this;
    this.root = this.contentEl ?? this.containerEl.children[1] as HTMLElement;
    this.root.replaceChildren(); this.root.classList.add("ms-study-workspace");
    this.toolbar = el("header", { class: "ms-workspace-toolbar", "aria-label": "学习工作区" });
    this.body = el("div", { class: "ms-workspace-body" });
    this.library = el("aside", { class: "ms-workspace-library", "aria-label": "学习集文档" });
    const libraryHead = el("div", { class: "ms-workspace-panel-head" });
    libraryHead.append(el("strong", { text: "StudySet" }), this.toolbarButton("plus", "添加文档", () => this.chooseDocument()), this.toolbarButton("download", "从电脑导入文档", () => this.importFiles()));
    const search = el("input", { type: "search", class: "ms-search", placeholder: "查找文档", "aria-label": "查找学习集文档" });
    search.addEventListener("input", () => { this.libraryQuery = search.value; this.drawLibrary(); });
    this.libraryList = el("div", { class: "ms-workspace-document-list" });
    const web = el("button", { class: "ms-btn ms-workspace-import-web", text: "导入网页 / 微信文章" });
    web.addEventListener("click", () => openWebImport(this.plugin));
    this.library.append(libraryHead, search, this.libraryList, web);
    this.readerPane = el("section", { class: "ms-workspace-reader", "aria-label": "文档阅读区" });
    this.tabBar = el("nav", { class: "ms-workspace-tabs", "aria-label": "已打开的文档", role: "tablist" });
    this.readerHost = el("div", { class: "ms-workspace-reader-host" });
    this.readerTabRow = el("div", { class: "ms-workspace-reader-tab-row" }); this.readerTabRow.append(this.tabBar);
    this.readerPane.append(this.readerTabRow, this.readerHost);
    this.tabResize = new ResizeObserver(() => this.revealActiveTab());
    this.tabResize.observe(this.tabBar);
    // Pen and overlay controls stop bubbling; observe their original gesture first.
    this.registerDomEvent(this.readerHost,"pointerdown",()=>{this.historyScope="reader";this.syncHistoryButtons();},true);
    const blockSelectionChanged=()=>this.drawToolbar();this.readerHost.addEventListener("ms-block-selection-change",blockSelectionChanged);this.register(()=>this.readerHost.removeEventListener("ms-block-selection-change",blockSelectionChanged));
    const recallReveal=(event:Event)=>{const source=(event as CustomEvent<{source:string}>).detail?.source;if(source==="reader")this.renderer?.resetRecallReveals();else if(source==="map")this.reader?.clearRecallReveals();};
    this.root.addEventListener("ms-recall-reveal",recallReveal);this.register(()=>this.root.removeEventListener("ms-recall-reveal",recallReveal));
    this.mapPane = el("section", { class: "ms-workspace-map", "aria-label": "脑图区" });
    this.mapHost = el("div", { class: "ms-workspace-map-host" }); this.mapPane.append(this.mapHost);
    this.auxiliary = el("aside", { class: "ms-workspace-auxiliary", "aria-label": "卡片与复习" });
    for(const pane of [this.mapPane,this.auxiliary])this.registerDomEvent(pane,"pointerdown",()=>{this.historyScope="library";this.syncHistoryButtons();},true);
    this.body.append(this.library, this.splitter("library"), this.readerPane, this.splitter("main"), this.mapPane, this.splitter("auxiliary"), this.auxiliary);
    this.bottomCapsule = el("nav", { class: "ms-bottom-capsule-shell", "aria-label": "MN4 阅读工具栏" });
    this.workspaceNoticeLayer = el("div", { class: "ms-workspace-notice-layer", "aria-live": "polite", "aria-atomic": "true" });
    this.workspaceFloatingActions=el("div",{class:"ms-workspace-floating-actions",role:"toolbar","aria-label":"文档与 AI 快捷入口"});
    const documentShortcut=this.toolbarButton("file-search","immersiveDocs",()=>this.toggleDocumentNavigation());
    const aiShortcut=this.toolbarButton("sparkles","immersiveAI",()=>this.openAuxiliary("ai"));
    documentShortcut.classList.add("ms-workspace-floating-action");aiShortcut.classList.add("ms-workspace-floating-action");
    this.workspaceFloatingActions.append(documentShortcut,aiShortcut);
    this.mapPane.append(this.workspaceFloatingActions);
    this.root.append(this.toolbar, this.body, this.bottomCapsule, this.workspaceNoticeLayer);
    this.renderer = new MindmapRenderer(this.plugin, { nativeChrome: true, onSelectionChange: nodes => this.onMindmapSelectionChange(nodes) }); this.renderer.mount(this.mapHost);
    this.fixedViewsHost=el("div",{class:"ms-fixed-views"});this.mapPane.append(this.fixedViewsHost);this.drawFixedViews();
    this.register(this.renderer.subscribeHandwritingModeChange(mode=>{if(this.reader&&!this.syncingHandwriting&&this.reader.getHandwritingSyncPreference()){this.syncingHandwriting=true;try{this.reader.setHandwritingMode(mode);}finally{this.syncingHandwriting=false;}}}));
    this.readerHost.append(this.readerLayersButton());
    this.registerDomEvent(document, "pointerdown", this.outsidePopup);
    const captureSelection=()=>{const selection=document.getSelection();if(selection?.rangeCount&&this.root.contains(selection.anchorNode)&&this.root.contains(selection.focusNode)&&selection.toString().trim()&&!selection.anchorNode?.parentElement?.closest("input,textarea,[contenteditable=true],.ms-ai-panel,.ms-research-panel")){this.selection={text:selection.toString().slice(0,4000),at:Date.now()};this.contextSource="reader";this.ai?.setContext(this.selectedContext());}};
    this.registerDomEvent(document,"pointerup",captureSelection);this.registerDomEvent(document,"keyup",captureSelection);
    // Child editors and reader placements handle Escape at the document first.
    this.registerDomEvent(window, "keydown", event => {
      if(!event.defaultPrevented&&(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==="f"&&this.app.workspace.activeLeaf===this.leaf&&!document.querySelector(".ms-modal-bg,.modal-container")){
        const target=event.target;if(!(target instanceof Element&&target.closest("input,textarea,[contenteditable=true]"))){event.preventDefault();event.stopPropagation();this.openReaderSearch();return;}
      }
    },true);
    this.registerDomEvent(window, "keydown", event => {
      if (!event.defaultPrevented && event.metaKey && event.altKey && !event.shiftKey && (event.code==="KeyM" || event.key.toLowerCase()==="m") && this.app.workspace.activeLeaf===this.leaf) {
        const target=event.target;
        if (!(target instanceof Element && target.closest("input,textarea,[contenteditable=true]"))) { event.preventDefault(); event.stopPropagation(); this.renderer?.toggleSceneMultiSelect(); return; }
      }
      if (!event.defaultPrevented && event.metaKey && event.altKey && (event.code==="KeyK" || event.key.toLowerCase()==="k")) {
        const target=event.target;
        if (!(target instanceof Element && target.closest("input,textarea,[contenteditable=true]")) && this.canContinuousExcerpt()) { event.preventDefault(); this.toggleContinuousExcerpt(); return; }
      }
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector(".ms-modal-bg,.modal-container")) return;
      if (this.popup) { event.preventDefault(); this.dismissPopup(); return; }
      if (this.reader?.getBlockSelectionMode()) { event.preventDefault();this.reader.setBlockSelectionMode(false);this.drawToolbar();return; }
      if (this.focusedStage) { event.preventDefault(); this.toggleFocus(); }
    });
    this.plugin.viewEvents.onDocumentCardSelect = this.documentHook;
    this.plugin.viewEvents.onMindmapCardSelect = this.mindmapHook;
    this.libraryHistorySignature=JSON.stringify(this.plugin.store.getLibraryHistoryState());
    this.register(this.plugin.store.subscribe(change => {
      const signature=JSON.stringify(this.plugin.store.getLibraryHistoryState());
      if(signature!==this.libraryHistorySignature){this.libraryHistorySignature=signature;this.historyScope="library";}
      this.syncHistoryButtons();
      if (change) this.renderer?.updateMovedNodes(change.movedNodeIds); else this.scheduleRefresh();
    }));
    this.registerEvent(this.app.vault.on("create", file => { if (file.path !== "_marginstudy-recovery" && !file.path.startsWith("_marginstudy-recovery/")) this.scheduleRefresh(); }));
    this.registerEvent(this.app.vault.on("delete", file => { if (file.path !== "_marginstudy-recovery" && !file.path.startsWith("_marginstudy-recovery/")) this.scheduleRefresh(); }));
    this.registerDomEvent(this.root, "keydown", event => {
      const target=event.target as HTMLElement;
      if(!event.defaultPrevented&&(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==="f"&&!target.closest("input,textarea,[contenteditable=true]")){event.preventDefault();this.openReaderSearch();return;}
      if(!event.defaultPrevented&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="z"&&!target.closest("input,textarea,[contenteditable=true]")){
        event.preventDefault();this.applyHistory(event.shiftKey);return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w" && this.state.activePath) {
        event.preventDefault(); event.stopPropagation(); void this.closeTab(this.state.activePath);
      }
    });
    this.registerDomEvent(this.root, "focusout", () => this.scheduleRefresh());
    this.readerHost.addEventListener("dragover", event => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); });
    this.readerHost.addEventListener("drop", event => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault(); void this.importFileList([...event.dataTransfer.files]);
    });
    this.showEmptyReader(); this.applyLayout(); this.refresh(true);
    this.releaseHostSidebars = useStudySidebarSpace(this.app.workspace, this.leaf);
    this.register(() => { this.releaseHostSidebars?.(); this.releaseHostSidebars = null; });
    const initial = this.app.vault.getAbstractFileByPath(this.state.activePath ?? this.state.tabs[0]?.path ?? "");
    if (initial instanceof TFile && supported(initial)) await this.openFile(initial);
  }
  async onClose(): Promise<void> {
    this.bottomPressDisposers.splice(0).forEach(dispose=>dispose());
    this.closePageDialog?.();
    this.captureReader(); this.closed = true;
    this.releaseHostSidebars?.(); this.releaseHostSidebars = null;
    this.tabResize?.disconnect(); this.tabResize = null;
    this.plugin.store.saveWorkspaceState(this.getState());
    if(this.focusedStage)this.toggleFocus(false);
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    if (this.workspaceNoticeTimer !== null) window.clearTimeout(this.workspaceNoticeTimer);
    this.workspaceNoticeTimer = null; this.workspaceNoticeLayer = null;
    if (this.plugin.studyWorkspace === this) this.plugin.studyWorkspace = null;
    if (this.plugin.viewEvents.onDocumentCardSelect === this.documentHook) delete this.plugin.viewEvents.onDocumentCardSelect;
    if (this.plugin.viewEvents.onMindmapCardSelect === this.mindmapHook) delete this.plugin.viewEvents.onMindmapCardSelect;
    this.dismissPopup(); this.board?.dispose(); this.board = null; this.research?.dispose(); this.research=null; this.ai?.dispose(); this.ai=null;
    await this.openChain.catch(() => {});
    await this.closeComparison();
    await this.releaseReader();
    this.renderer?.destroy(); this.renderer = null;
  }
  openFile(file: TFile): Promise<ReaderLike> {
    if (!supported(file)) return Promise.reject(new Error("不支持的文档格式：" + file.extension));
    const pending = this.pending.get(file.path); if (pending) return pending;
    const task = this.openChain.catch(() => {}).then(async () => {
      if (this.closed) throw new Error("学习工作区已关闭");
      if (this.reader?.getFilePath() === file.path) { this.plugin.activeReader = this.reader; return this.reader; }
      this.dismissPopup(); this.captureReader(); await this.closeComparison(); await this.releaseReader();
      if (this.closed) throw new Error("学习工作区已关闭");
      let tab = this.state.tabs.find(tab => tab.path === file.path);
      if (!tab) { tab = { path: file.path }; this.state.tabs.push(tab); }
      // Host layout snapshots can populate tab.state while the new reader loads.
      // Only a state that existed before loading represents a saved user zoom.
      const restoredTabState = tab.state;
      tab.documentId ??= this.plugin.store.registerDocument(file.path)?.id;
      this.state.activePath = file.path; this.state.reader = true; this.linkedCard = null;
      this.readerHost.replaceChildren(el("p", { class: "ms-workspace-loading", text: "正在打开 " + file.name + "…" }));
      const reader = ["pdf", "msref"].includes(file.extension.toLowerCase()) ? new ReaderView(this.leaf, this.plugin)
        : file.extension.toLowerCase() === "docx" ? new WordReaderView(this.leaf, this.plugin) : new DocumentReaderView(this.leaf, this.plugin);
      const host = el("div", { class: "ms-workspace-child-view" }), content = el("div", { class: "view-content" });
      host.append(el("div", { class: "ms-workspace-child-header", style: "display:none" }), content);
      // ItemView exposes both containers publicly; no fake WorkspaceLeaf or private view APIs.
      reader.containerEl.replaceWith(host); reader.containerEl = host; reader.contentEl = content;
      this.readerHost.replaceChildren(host); this.reader = reader; this.addChild(reader);
      try {
        // Reserve the saved navigation column before the reader measures its restored position.
        this.readerPane.classList.toggle("has-document-navigation", this.state.documentNavigation);
        reader.setWorkspaceChrome(true);
        await reader.setState({ ...restoredTabState, filePath: file.path }); await reader.onOpen();
        reader.setWorkspaceChrome(true);
        if (this.closed) throw new Error("学习工作区已关闭");
        if (reader.getFilePath() !== file.path) throw new Error("文档未完成加载");
        this.plugin.activeReader = reader; this.plugin.store.registerDocument(file.path);
        const canvas = this.plugin.store.canvases.find(canvas => canvas.id === this.plugin.store.activeCanvasId);
        if (canvas) canvas.lastDocumentPath = file.path;
        this.plugin.store.save(); this.applyLayout(); this.drawTabs(); this.drawLibrary();
        if (reader instanceof ReaderView && !restoredTabState) await reader.fitWidth();
        reader.setRecallHintProvider?.(this.recallHintProvider);
        this.recallSettingsSetId = null;
        this.restoreRecallSettings();
        this.readerHost.append(this.readerLayersButton()); this.connectHandwriting(reader);this.drawToolbar(); this.syncDocumentNavigation();
        this.saveLayout(); return reader;
      } catch (error) {
        await this.releaseReader();
        if (!this.closed) { this.showEmptyReader("文档未能打开：" + String(error)); this.drawTabs(); }
        throw error;
      }
    });
    this.openChain = task; this.pending.set(file.path, task);
    void task.finally(() => { if (this.pending.get(file.path) === task) this.pending.delete(file.path); }).catch(() => {});
    return task;
  }
  async openMobileComparison(file: TFile, sync: boolean): Promise<void> {
    if (!this.reader || file.path === this.reader.getFilePath()) throw new Error("请选择另一份文档");
    await this.closeComparison();
    const reader = ["pdf", "msref"].includes(file.extension.toLowerCase()) ? new ReaderView(this.leaf, this.plugin) : file.extension.toLowerCase() === "docx" ? new WordReaderView(this.leaf, this.plugin) : new DocumentReaderView(this.leaf, this.plugin);
    const panel = el("section", { "aria-label": "对照阅读面板", style: "flex:1 1 50%;width:50%;height:100%;display:flex;flex-direction:column;min-width:0;min-height:0;max-width:80%;background:var(--background-primary);border-left:1px solid var(--background-modifier-border);overflow:hidden" });
    const close = el("button", { text: "关闭对照", "aria-label": "关闭对照" }); close.addEventListener("click",()=>{void this.closeComparison();});
    const syncLabel = el("label", { text: "同步滚动" }), syncToggle = el("input", { type: "checkbox", "aria-label": "同步滚动" }) as HTMLInputElement;
    syncToggle.checked = sync; syncLabel.prepend(syncToggle);
    const host=el("div",{class: "ms-workspace-child-view",style: "flex:1;min-height:0"}), content=el("div",{class: "view-content"}); host.append(el("div",{style: "display:none"}),content); reader.containerEl.replaceWith(host);reader.containerEl=host;reader.contentEl=content;panel.append(close,syncLabel,host);this.readerHost.append(panel);const primary=this.reader.containerEl;primary.style.flex="1 1 50%";primary.style.width="50%";const divider=el("div",{role: "separator","aria-label": "调整对照文档宽度",style: "width:8px;flex:0 0 8px;cursor:col-resize;touch-action:none;background:var(--background-modifier-border)"});this.readerHost.insertBefore(divider,panel);divider.addEventListener("pointerdown",event=>{event.preventDefault();divider.setPointerCapture(event.pointerId);});divider.addEventListener("pointermove",event=>{if(!divider.hasPointerCapture(event.pointerId))return;const rect=this.readerHost.getBoundingClientRect();const ratio=Math.max(.2,Math.min(.8,(event.clientX-rect.left)/rect.width));primary.style.flex="1 1 0";panel.style.flex="0 0 "+(100*(1-ratio))+"%";});this.comparisonReader=reader;this.comparisonPanel=panel;this.addChild(reader);
    try {reader.setWorkspaceChrome(true);await reader.setState({filePath:file.path});await reader.onOpen();if(reader.getFilePath()!==file.path)throw new Error("对照文档未加载");{const a=this.reader.getScrollContainer(),b=reader.getScrollContainer();let busy=false;const move=(from:HTMLElement,to:HTMLElement)=>{if(busy||!syncToggle.checked)return;busy=true;const range=from.scrollHeight-from.clientHeight;to.scrollTop=range>0?from.scrollTop/range*Math.max(0,to.scrollHeight-to.clientHeight):0;requestAnimationFrame(()=>busy=false);};const ab=()=>move(a,b),ba=()=>move(b,a);a.addEventListener("scroll",ab);b.addEventListener("scroll",ba);this.comparisonCleanup=()=>{a.removeEventListener("scroll",ab);b.removeEventListener("scroll",ba);};}}catch(error){await this.closeComparison();throw error;}
  }
  private async closeComparison(): Promise<void> {this.comparisonCleanup?.();this.comparisonCleanup=null;const reader=this.comparisonReader;this.comparisonReader=null;if(reader){try{await reader.onClose();}finally{this.removeChild(reader);}}this.comparisonPanel?.previousElementSibling?.remove();this.comparisonPanel?.remove();this.comparisonPanel=null;if(this.reader){this.plugin.activeReader=this.reader;this.reader.containerEl.style.flex="";this.reader.containerEl.style.width="";}}
  private captureReader(): void {
    if (!this.reader) return;
    const path = this.reader.getFilePath();
    const tab = this.state.tabs.find(tab => tab.path === path || tab.documentId && this.plugin.store.documents.some(doc => doc.id === tab.documentId && doc.path === path));
    if (tab) tab.state = this.reader.getState();
  }
  private async releaseReader(): Promise<void> {
    this.closePageDialog?.();
    this.closeSpeechDialog?.();
    if (this.popup?.classList.contains("ms-read-settings")) this.dismissPopup();
    this.documentNavigation?.dispose(); this.documentNavigation = null; this.readerPane?.classList.remove("has-document-navigation");
    const reader = this.reader; if (!reader) return;
    this.readerHandwritingDisposers.splice(0).forEach(dispose=>dispose());
    if("setHandwritingSyncAvailable"in reader)(reader as ChildReader & {setHandwritingSyncAvailable(value:boolean):void}).setHandwritingSyncAvailable(false);
    this.reader = null;
    try { await reader.onClose(); } finally { this.removeChild(reader); reader.containerEl.remove(); }
  }
  /** The plugin serializes source and reference updates before refreshing open documents. */
  async remapDocuments(renames: {oldPath:string;newPath:string}[], collections: Set<string>): Promise<void> {
    await this.openChain.catch(()=>{}); if(this.closed)return;
    this.captureReader();
    for(const {oldPath,newPath} of renames){
      for(const tab of this.state.tabs)if(tab.path===oldPath){tab.path=newPath;if(tab.state)tab.state.filePath=newPath;}
      if(this.state.activePath===oldPath)this.state.activePath=newPath;
    }
    const path=this.state.activePath;
    if(path&&this.reader?.getFilePath()!==path){const file=this.app.vault.getAbstractFileByPath(path);if(file instanceof TFile)await this.openFile(file);}
    else if(path&&collections.has(path)&&this.reader instanceof ReaderView)await this.reader.refreshPageCollection();
    this.refresh(true);this.saveLayout();
  }
  private connectHandwriting(reader:ChildReader):void {
    const scene = this.plugin.store.getStudyScene(this.plugin.store.activeStudySetId ?? "");
    if (scene?.interfaceMode === "scenes") reader.setRecallMode(scene.sceneId === "recall");
    reader.setAutomaticTextExcerpt(scene?.interfaceMode === "scenes" && (scene.sceneId === "excerpt" || scene.sceneId === "writing") && this.readerTool === "text");
    this.readerHandwritingDisposers.splice(0).forEach(dispose=>dispose());
    if(reader instanceof ReaderView){reader.setContinuousExcerptListener(()=>{if(!this.closed&&this.reader===reader)this.drawToolbar();});this.readerHandwritingDisposers.push(()=>reader.setContinuousExcerptListener(null));}
    if (reader instanceof ReaderView) this.readerHandwritingDisposers.push(reader.subscribeReadingStateChange(() => {
      if (!this.closed && this.reader === reader) this.saveLayout();
    }));
    this.readerHandwritingDisposers.push(reader.subscribeHandwritingModeChange(mode=>{
      this.readerTool=mode==="off"?"text":mode;
      if(!this.syncingHandwriting&&reader.getHandwritingSyncPreference()&&this.renderer){this.syncingHandwriting=true;try{this.renderer.setHandwritingMode(mode);}finally{this.syncingHandwriting=false;}}
      this.drawToolbar();
    }),reader.subscribeHandwritingSyncPreference(enabled=>{if(enabled&&this.renderer)this.renderer.setHandwritingMode(reader.getHandwritingMode());}),reader.subscribeEditHistory(state=>{if(state.canUndo||state.canRedo)this.historyScope="reader";this.syncHistoryButtons();}));
    if("setHandwritingSyncAvailable"in reader)(reader as ChildReader & {setHandwritingSyncAvailable(value:boolean):void}).setHandwritingSyncAvailable(!!this.renderer);
    if(reader.getHandwritingSyncPreference())this.renderer?.setHandwritingMode(reader.getHandwritingMode());
    this.readerTool=reader.getHandwritingMode()==="off"?"text":reader.getHandwritingMode();
  }
  private recallHintProvider = async (request: import("../types").RecallHintRequest): Promise<import("../types").RecallHintResult> => {
    const english = request.language === "en";
    const fallback = english ? [
      request.title ? `Key concept: ${request.title}` : "",
      request.parentTitle ? `Hierarchy: ${request.parentTitle}` : "",
      request.keywords.length ? `Related terms: ${request.keywords.slice(0, 4).join(", ")}` : "",
      request.excerpt ? `Context cue: recall the definition, structure, or conclusion of this ${request.excerptLength}-character excerpt.` : "This is an image or area excerpt. Recall its surrounding context.",
    ].filter(Boolean) : [
      request.title ? `关键概念：${request.title}` : "",
      request.parentTitle ? `所在层级：${request.parentTitle}` : "",
      request.keywords.length ? `关联词：${request.keywords.slice(0, 4).join("、")}` : "",
      request.excerpt ? `内容提示：先回忆这段 ${request.excerptLength} 字摘录的定义、结构或结论。` : "这是一处图片或区域摘录，先回忆它所在的上下文。",
    ].filter(Boolean);
    if (!hasDeviceRecallHintProvider(this.plugin.app)) return { lines: fallback, source: "structured" };
    const lines = await requestDeviceRecallHint(request, this.plugin.app);
    return lines.length ? { lines, source: "device" } : { lines: fallback, source: "structured" };
  };
  private showEmptyReader(message = "选择学习文档，边读边摘录到脑图。"): void {
    const empty = el("div", { class: "ms-workspace-empty" });
    const open = el("button", { class: "ms-btn primary", text: "打开文档" }); open.addEventListener("click", () => this.chooseDocument());
    const load = el("button", { class: "ms-btn", text: "从电脑导入" }); load.addEventListener("click", () => this.importFiles());
    empty.append(el("strong", { text: "文档阅读" }), el("p", { text: message }), open, load);
    this.readerHost.replaceChildren(empty);
  }
  refresh(force = false): void {
    if (this.closed) return;
    const title=this.getDisplayText();
    if(title!==this.headerTitle){
      const previous=this.headerTitle,owner=this.containerEl.ownerDocument;
      this.headerTitle=title;
      // Obsidian caches the leaf title separately from the view's display text.
      (this.leaf as WorkspaceLeaf & {updateHeader?:()=>void}).updateHeader?.();
      const heading=this.containerEl.querySelector<HTMLElement>(".view-header-title");
      if(heading)heading.textContent=title;
      // Preserve the host's vault/version suffix and never rename another active view.
      if(previous&&this.app.workspace.activeLeaf===this.leaf&&owner.title.startsWith(previous+" - "))owner.title=title+owner.title.slice(previous.length);
    }
    this.applyReadingTheme();
    const focused = document.activeElement;
    const editing = focused instanceof HTMLElement && !!focused.closest("input,textarea,[contenteditable=true]");
    const store = this.plugin.store;
    this.restoreRecallSettings();
    const fixedKey=JSON.stringify([store.activeStudySetId,store.activeCanvasId,store.studySets.find(set=>set.id===store.activeStudySetId)?.fixedViews,store.canvases.map(canvas=>[canvas.id,canvas.studySetId]),store.nodes.map(node=>[node.id,node.canvasId])]);
    if(fixedKey!==this.fixedViewsSignature){this.fixedViewsSignature=fixedKey;this.drawFixedViews();}
    const toolbarKey = this.currentToolbarSignature();
    if ((force || toolbarKey !== this.toolbarSignature) && (!editing || !this.toolbar.contains(focused))) { this.drawToolbar(); this.toolbarSignature = toolbarKey; }
    const libraryKey = JSON.stringify([store.activeStudySetId, store.activeCanvasId, store.studySets.find(set => set.id === store.activeStudySetId), store.canvases, store.documents, this.state.activePath]);
    if (force || libraryKey !== this.librarySignature) { this.drawLibrary(); this.librarySignature = libraryKey; }
    if (!editing || force) this.renderer?.requestRender();
    const auxiliaryKey = JSON.stringify([this.state.auxiliary,store.activeStudySetId,store.activeReviewDeckId,store.reviewDecks,store.cards,store.srs]);
    if ((force || auxiliaryKey !== this.auxiliarySignature) && (this.auxiliaryKind !== this.state.auxiliary || !this.auxiliary.contains(focused))) { this.drawAuxiliary(); this.auxiliarySignature = auxiliaryKey; }
    this.drawTabs(); this.syncDocumentNavigation();
  }
  private syncDocumentNavigation(): void {
    if (!this.reader || !this.state.documentNavigation) {
      this.documentNavigation?.dispose(); this.documentNavigation = null;
      this.readerPane?.classList.remove("has-document-navigation"); return;
    }
    if (this.documentNavigation) { this.documentNavigation.setTab(this.state.documentNavigationTab); return; }
    this.documentNavigation = new DocumentNavigation(this.plugin, this.reader, this.state.documentNavigationTab, tab => { this.state.documentNavigationTab = tab; this.saveLayout(); });
    this.readerTabRow.append(this.documentNavigation.tabs); this.readerPane.append(this.documentNavigation.element);
    this.readerPane.classList.add("has-document-navigation");
  }
  private toggleDocumentNavigation(tab?: DocumentNavigationTab): void {
    if (!this.reader) { this.chooseDocument(); return; }
    const fitted = this.reader instanceof ReaderView && this.reader.isFittedToWidth();
    this.dismissPopup();
    if (tab) {
      this.state.documentNavigationTab = tab;
      this.state.documentNavigation = true;
    } else this.state.documentNavigation = !this.state.documentNavigation;
    this.syncDocumentNavigation();
    if (fitted && this.reader instanceof ReaderView) this.reader.fitWidth();
    this.drawToolbar(); this.saveLayout();
  }
  private scheduleRefresh(): void {
    if (this.closed || this.renderTimer !== null) return;
    this.renderTimer = window.setTimeout(() => { this.renderTimer = null; this.refresh(); }, 60);
  }
  private toolbarButton(icon: string, label: string, callback: () => void, active?: boolean): HTMLButtonElement {
    const button = el("button", { type: "button", class: "ms-tb-btn" + (active ? " is-active" : ""), title: label, "aria-label": label });
    if (active !== undefined) button.setAttribute("aria-pressed", String(active));
    button.style.setProperty("padding", "5px", "important");setNativeIcon(button, icon); button.addEventListener("click", callback); return button;
  }
  private syncHistoryButtons():void {
    const state=this.historyScope==="reader"?this.reader?.getEditHistoryState():this.plugin.store.getLibraryHistoryState();
    if(this.undoButton){this.undoButton.disabled=!state?.canUndo;this.undoButton.title=state?.undoLabel?"撤销"+state.undoLabel:this.historyScope==="reader"?"没有可撤销的手写、批注或页编辑":"没有可撤销的卡片或脑图变更";}
    if(this.redoButton){this.redoButton.disabled=!state?.canRedo;this.redoButton.title=state?.redoLabel?"重做"+state.redoLabel:this.historyScope==="reader"?"没有可重做的手写、批注或页编辑":"没有可重做的卡片或脑图变更";}
    const undo=this.bottomCapsule?.querySelector<HTMLButtonElement>('[data-bottom-action="undo"]'),redo=this.bottomCapsule?.querySelector<HTMLButtonElement>('[data-bottom-action="redo"]');
    if(undo){undo.disabled=!state?.canUndo;undo.title=this.undoButton?.title??"撤销";}
    if(redo){redo.disabled=!state?.canRedo;redo.title=this.redoButton?.title??"重做";}
  }
  private applyHistory(redo:boolean):void {
    if(this.historyScope==="reader"){if(redo)this.reader?.redoLastEdit();else this.reader?.undoLastEdit();}
    else{if(redo)this.plugin.store.redoLibraryChange();else this.plugin.store.undoLibraryChange();}
    this.syncHistoryButtons();this.scheduleRefresh();
  }
  private drawToolbar(): void {
    this.root.dataset.readerTool=this.readerTool;
    const store = this.plugin.store;
    this.toolbar.replaceChildren();
    const main = el("div", { class: "ms-native-main-tools" });
    const divider = () => el("span", { class: "ms-native-tool-divider", "aria-hidden": "true" });
    const tool = (icon: string, label: string, action: () => void, active?: boolean) => this.toolbarButton(icon,label,action,active);
    const map = el("button", { class: "ms-native-text-tool" + (this.state.mindmap ? " is-active" : ""), text: "MindMap", "aria-label": "显示或隐藏脑图", "aria-pressed": String(this.state.mindmap) });
    map.addEventListener("click", () => { this.state.mindmap=!this.state.mindmap; if(!this.state.mindmap)this.state.reader=true; this.layoutChanged(); });
    const selectTool = (icon:string, label:string, mode:string) => {
      const button=tool(icon,label,()=>this.useReaderTool(mode),this.readerTool===mode);
      button.dataset.readerTool=mode; return button;
    };
    const pen=selectTool("pencil","手写画笔与设置","pen"); pen.addEventListener("dblclick",()=>this.reader?.openHandwritingSettings(pen));
    this.undoButton=tool("undo-2","撤销",()=>this.applyHistory(false));
    this.redoButton=tool("redo-2","重做",()=>this.applyHistory(true));
    main.append(
      tool("panel-left","显示或隐藏学习集列表",()=>{this.state.library=!this.state.library;this.layoutChanged();},this.state.library),
      tool("house","学习集与文档",()=>this.showStudyHome()),
      this.undoButton,this.redoButton,
      map,divider(),tool("settings-2","文档与脑图联动设置",()=>this.cycleLinkMode()),
      selectTool("hand","移动与选择","hand"),selectTool("baseline","文本摘录","text"),
      selectTool("scan","区域摘录","region"),selectTool("between-horizontal-start","留白","extend"),divider(),pen,
      tool("type","文字批注",()=>this.readerAction("文字批注")),tool("image","插入图片批注",()=>this.readerAction("插入图片批注")),divider(),
      el("span",{class:"ms-workspace-spacer"}),
      tool(this.focusedStage?"minimize":"scan-line","专注工作区",()=>this.toggleFocus(),this.focusedStage),
      tool("columns","双文对照",()=>{if(this.reader instanceof ReaderView)this.reader.compare((file,sync)=>this.openMobileComparison(file,sync));else new Notice("请先打开 PDF 文档");}),
      tool("file-search","文档内搜索",()=>this.openReaderSearch()),
      tool("scan-text","识别当前扫描页",()=>{if(this.reader instanceof ReaderView)void this.reader.recognizeCurrentPage();else new Notice("请先打开 PDF 文档");}),
      tool("book-marked","文档目录与书签",()=>this.toggleDocumentNavigation(),this.state.documentNavigation),
      tool("more-vertical","文档与工作区设置",()=>this.openLayoutMenu())
    );
    const side=el("div",{class:"ms-native-side-tools"});
    if(this.state.auxiliary!=="none")for(const [key,label] of [["cards","Cards"],["review","Review"]] as const){
      const button=el("button",{class:"ms-native-text-tool"+(this.state.auxiliary===key?" is-active":""),text:label,"aria-label":key==="cards"?"卡片列表":"复习卡组","aria-pressed":String(this.state.auxiliary===key)});
      button.addEventListener("click",()=>{this.selectAuxiliary(this.state.auxiliary===key?"none":key);}); side.append(button);
    }
    side.append(tool("sparkles","AI 学习助手",()=>this.openAuxiliary("ai"),this.state.auxiliary==="ai"));
    if(this.state.auxiliary!=="none")side.append(tool("globe","研究浏览器",()=>this.openAuxiliary("research"),this.state.auxiliary==="research"));
    side.append(tool("ellipsis","学习集更多设置",()=>this.openStudyMore()));
    const activeSet=store.studySets.find(set=>set.id===store.activeStudySetId);
    const selection=activeSet?store.getStudyScene(activeSet.id):undefined;
    const template=selection?store.getSceneTemplates().find(item=>item.id===selection.templateId):undefined;
    const sceneHeader=selection?.interfaceMode==="scenes";
    this.toolbar.classList.toggle("has-scene-header",sceneHeader);
    this.root.classList.toggle("has-scene-header",sceneHeader);
    const canvas=store.canvases.find(item=>item.id===store.activeCanvasId);
    const context=el("div",{class:"ms-workspace-context", "aria-label":"当前工作区信息"});
    const contextIcon=(icon:string,label:string,action:()=>void)=>{const button=this.toolbarButton(icon,label,action);button.classList.add("ms-workspace-context-icon");return button;};
    context.append(contextIcon("house","打开学习集与文档",()=>this.showStudyHome()));
    const contextItem=(label:string,value:string,icon:string|undefined,action:(item:HTMLButtonElement)=>void)=>{
      const item=el("button",{type:"button",class:"ms-workspace-context-item","aria-label":label+"："+value,title:value}) as HTMLButtonElement;
      if(icon){const glyph=el("span",{class:"ms-workspace-context-glyph","aria-hidden":"true"});setNativeIcon(glyph,icon);item.append(glyph);}
      const text=el("span",{class:"ms-workspace-context-text"});text.append(el("span",{class:"ms-workspace-context-label",text:label}),el("span",{class:"ms-workspace-context-value",text:value}));
      item.append(text,el("span",{class:"ms-workspace-context-chevron","aria-hidden":"true",text:"⌄"}));item.addEventListener("click",()=>action(item));context.append(item);
    };
    contextItem("学习集",activeSet?.name??"未选择",undefined,()=>this.openStudyMenu());
    contextItem("场景模板",template?.name??"传统界面",undefined,()=>this.openStudyMore());
    contextItem("文档",this.state.activePath?.split("/").pop()??"未打开","file-text",()=>this.chooseDocument());
    contextItem("脑图",canvas?.name??"未选择","share-2",item=>{const target=this.mapPane.querySelector<HTMLButtonElement>('[aria-label="选择脑图"]');if(target){const rect=item.getBoundingClientRect();target.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:rect.left,clientY:rect.bottom}));}});
    context.append(contextIcon("star","固定视图入口",()=>{this.fixedViewsOpen=!this.fixedViewsOpen;this.drawFixedViews();}),contextIcon("search","搜索文档",()=>this.openReaderSearch()));
    const controlsId=uid("workspace-tools");
    const controls=el("div",{class:"ms-workspace-toolbar-controls",id:controlsId});controls.append(main,side);
    controls.hidden=sceneHeader&&!this.workspaceToolsOpen;
    const extraTools=this.toolbarButton("ellipsis","工作区工具",()=>{this.workspaceToolsOpen=!this.workspaceToolsOpen;controls.hidden=!this.workspaceToolsOpen;extraTools.setAttribute("aria-expanded",String(this.workspaceToolsOpen));});
    extraTools.classList.add("ms-workspace-extra-tools-toggle");extraTools.textContent="⋯";extraTools.style.fontSize="24px";extraTools.style.lineHeight="1";extraTools.setAttribute("aria-expanded",String(this.workspaceToolsOpen));extraTools.setAttribute("aria-controls",controlsId);
    this.toolbar.append(context);if(sceneHeader){this.toolbar.append(extraTools);const destination=activeSet?.excerptDestination,target=destination&&destination.canvasId===store.activeCanvasId?store.getNode(destination.nodeId):undefined;
      const label=target?`固定 · ${target.title}`:"目录 · 屏幕位置";const button=el("button",{type:"button",class:"ms-excerpt-destination","aria-label":"摘录落点："+label,title:label,text:label+" ▾"});button.addEventListener("click",()=>this.openExcerptDestination());this.toolbar.append(button);}
    this.toolbar.append(controls);
    this.syncHistoryButtons();
    this.drawBottomCapsule();
    this.toolbarSignature=this.currentToolbarSignature();
  }
  private currentToolbarSignature():string {
    const store=this.plugin.store;
    return JSON.stringify([store.activeStudySetId,store.activeCanvasId,store.studySets.map(set=>[set.id,set.name,set.excerptDestination]),store.getStudyScene(store.activeStudySetId??""),store.canvases.map(canvas=>[canvas.id,canvas.name]),this.state.library,this.state.reader,this.state.mindmap,this.state.auxiliary,this.state.linkMode,this.state.bottomMode,this.state.bottomCollapsed,this.getReadingTheme(),this.readerTool,this.reader?.getFilePath(),this.reader?.getBlockSelectionMode(),this.historyScope,this.handwritingPresets(),this.reader?.getActiveHandwritingPreset?.()]);
  }
  private openExcerptDestination():void {
    const store=this.plugin.store,set=store.studySets.find(item=>item.id===store.activeStudySetId);if(!set)return;
    const pane=this.popover("摘录落点"),selected=this.renderer?.selectedViewNode(),fixed=set.excerptDestination;
    const describe=fixed?store.getNode(fixed.nodeId):undefined;
    pane.append(el("p",{text:describe?`当前固定到：${describe.title}`:"当前：目录 · 屏幕位置"}));
    const pin=el("button",{text:selected?`固定到「${selected.title}」`:"先在脑图中选中一张卡","aria-label":"固定摘录落点"}) as HTMLButtonElement;pin.disabled=!selected||!selected.cardId;
    pin.addEventListener("click",()=>{if(!selected||!selected.cardId||selected.canvasId!==store.activeCanvasId)return;store.updateStudySet(set.id,{excerptDestination:{canvasId:selected.canvasId!,nodeId:selected.id}});this.dismissPopup();this.drawToolbar();});pane.append(pin);
    if(fixed){const clear=el("button",{text:"取消固定","aria-label":"取消固定摘录落点"});clear.addEventListener("click",()=>{store.updateStudySet(set.id,{excerptDestination:undefined});this.dismissPopup();this.drawToolbar();});pane.append(clear);}
  }
  private drawBottomCapsule(): void {
    if (!this.bottomCapsule) return;
    this.bottomPressDisposers.splice(0).forEach(dispose=>dispose());
    const dock=this.bottomCapsule;
    dock.dataset.mode=this.state.bottomMode;
    dock.dataset.collapsed=String(this.state.bottomCollapsed);
    dock.replaceChildren();
    const collapse=el("button",{type:"button",class:"ms-bottom-collapse",title:this.state.bottomCollapsed?"展开底部工具栏":"收合底部工具栏","aria-label":this.state.bottomCollapsed?"展开底部工具栏":"收合底部工具栏","aria-expanded":String(!this.state.bottomCollapsed)});
    collapse.dataset.msCollapse="true";
    collapse.append(el("span",{"aria-hidden":"true"}));
    collapse.addEventListener("click",()=>{this.state.bottomCollapsed=!this.state.bottomCollapsed;if(this.state.bottomCollapsed)this.reader?.setBlockSelectionMode(false);this.drawToolbar();this.saveLayout();});

    const action=(icon:string,label:string,callback:(button:HTMLButtonElement)=>void,active?:boolean,disabled=false)=>{
      const item=el("button",{type:"button",class:"ms-bottom-action",title:disabled?label+"（暂不可用）":label,"aria-label":label}) as HTMLButtonElement;
      if(active!==undefined)item.setAttribute("aria-pressed",String(active));
      item.disabled=disabled;setNativeIcon(item,icon);item.addEventListener("click",()=>callback(item));return item;
    };
    const store=this.plugin.store,activeSet=store.studySets.find(set=>set.id===store.activeStudySetId),selection=activeSet?store.getStudyScene(activeSet.id):undefined;
    const sceneTemplate=selection?store.getSceneTemplates().find(template=>template.id===selection.templateId):undefined;
    if(selection?.interfaceMode==="scenes"&&sceneTemplate&&activeSet){
      dock.setAttribute("aria-label","学习场景工具栏");
      this.drawSceneBottomCapsule(dock,collapse,action,sceneTemplate,selection,activeSet.id);
      this.syncHistoryButtons();
      return;
    }
    dock.setAttribute("aria-label","MN4 阅读工具栏");
    const primary=el("div",{class:"ms-bottom-primary",role:"group","aria-label":"阅读模式"});
    primary.append(
      action("book-open","阅读",()=>this.activateBottomMode("reading"),this.state.bottomMode==="reading"),
      action("bottom-writing","书写",()=>this.activateBottomMode("writing"),this.state.bottomMode==="writing"),
      action("bottom-recall","回忆",()=>this.activateBottomMode("recall"),this.state.bottomMode==="recall"),
      el("span",{class:"ms-bottom-divider",role:"separator","aria-hidden":"true"}),
    );
    const reading=el("div",{class:"ms-bottom-reading",role:"group","aria-label":"阅读工具"});
    reading.append(action("circle-half","主题",()=>this.cycleReadingTheme()));
    const titleLinksOn=this.reader?.getTitleLinksEnabled?.()??false;
    const titleLinks=action(titleLinksOn?"bottom-title-link-on":"bottom-title-link","标题链接",()=>{
      if(!this.reader)return;
      const on=!this.reader.getTitleLinksEnabled?.();
      this.reader.setTitleLinksEnabled?.(on);
      this.drawToolbar();
      this.showWorkspaceNotice(on?"已启用标题链接\n文档中的标题匹配现在可点击":"已关闭标题链接\n文档标题链接已隐藏");
    },titleLinksOn,!this.reader);
    titleLinks.title=titleLinksOn?"关闭标题链接":"开启标题链接";
    reading.append(titleLinks);
    const block=action("bottom-blocks","块选择",()=>this.toggleBlockSelection(),this.reader?.getBlockSelectionMode()??false,!this.reader);reading.append(block);

    const hasReader=!!this.reader;
    const canExtend=hasReader&&this.reader instanceof ReaderView&&!!this.reader.getPdfPageEdits();
    const normalPens=this.handwritingPresets().filter(preset=>preset.type!=="pencil"&&preset.type!=="highlighter");
    const penOne=normalPens[0],penTwo=normalPens[1];
    const marker=this.handwritingPresets().find(preset=>preset.type==="highlighter");
    const writing=el("div",{class:"ms-bottom-expanded ms-bottom-writing",role:"toolbar","aria-label":"书写工具","aria-hidden":String(this.state.bottomMode!=="writing")});
    writing.append(
      action("baseline","文本",()=>this.useReaderTool("text"),this.readerTool==="text",!hasReader),
      action("scan","矩形",()=>this.useReaderTool("region"),this.readerTool==="region",!hasReader),
      action("between-horizontal-start","留白",()=>this.useReaderTool("extend"),this.readerTool==="extend",!canExtend),
      el("span",{class:"ms-bottom-divider",role:"separator","aria-hidden":"true"}),
      action("bottom-pen","普通笔 1",()=>{if(penOne)this.setReaderHandwritingPreset(penOne.id);},this.readerTool==="pen"&&!!penOne&&this.reader?.getActiveHandwritingPreset?.()===penOne.id,!hasReader||!penOne),
      action("bottom-pen","普通笔 2",()=>{if(penTwo)this.setReaderHandwritingPreset(penTwo.id);},this.readerTool==="pen"&&!!penTwo&&this.reader?.getActiveHandwritingPreset?.()===penTwo.id,!hasReader||!penTwo),
      action("bottom-highlighter","荧光笔",()=>{if(marker)this.setReaderHandwritingPreset(marker.id);},this.readerTool==="highlight",!hasReader||!marker),
      action("bottom-more","更多",button=>this.openHandwritingPresets(button),false,!hasReader),
      action("bottom-lasso","套索",()=>this.setReaderHandwritingMode("lasso"),this.readerTool==="lasso",!hasReader),
      action("eraser","橡皮",()=>this.setReaderHandwritingMode("eraser"),this.readerTool==="eraser",!hasReader),
      action("bottom-hand","手形",()=>this.useReaderTool("hand"),this.readerTool==="hand",!hasReader),
      el("span",{class:"ms-bottom-divider",role:"separator","aria-hidden":"true"}),
      action("bottom-undo","撤销",()=>{this.applyHistory(false);this.drawToolbar();},false,!this.currentHistoryState()?.canUndo),
      action("bottom-redo","重做",()=>{this.applyHistory(true);this.drawToolbar();},false,!this.currentHistoryState()?.canRedo),
    );
    writing.querySelector('[aria-label="撤销"]')?.setAttribute("data-bottom-action","undo");
    writing.querySelector('[aria-label="重做"]')?.setAttribute("data-bottom-action","redo");
    for(const [label,preset] of [["普通笔 1",penOne],["普通笔 2",penTwo],["荧光笔",marker]] as const){
      const button=writing.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
      if(button&&preset)this.bindPresetLongPress(button,preset.id,label);
    }

    const recall=el("div",{class:"ms-bottom-expanded ms-bottom-recall",role:"toolbar","aria-label":"回忆工具","aria-hidden":String(this.state.bottomMode!=="recall")});
    const hierarchy=action("bottom-hierarchy","层级",button=>this.openRecallHierarchy(button),false,!hasReader);
    hierarchy.title="应用脑图层级";
    const aiHintActive=this.reader?.getRecallAiHint?.()??false;
    const aiHint=action(aiHintActive?"bottom-hint-on":"bottom-hint","AI提示",()=>{
      if(!this.reader)return;
      const on=!this.reader.getRecallAiHint?.();
      this.reader.setRecallAiHint?.(on);
      this.drawToolbar();
      this.showWorkspaceNotice(on?"已启用 AI 提示模式\n遮挡内容会先打开 AI 提示。":"已关闭 AI 提示模式\n点遮挡内容会直接揭开。");
    },aiHintActive,!hasReader);
    aiHint.title=aiHintActive?"关闭 AI 提示模式":"开启 AI 提示模式";
    recall.append(
      hierarchy,
      action("bottom-reset","重置",()=>this.resetRecall(),false,!this.isRecallActive()),
      aiHint,
      action("sliders-horizontal","回忆设置",button=>this.openRecallSettings(button),false,!hasReader),
      action("bottom-writing","手写",()=>{this.setRecallActive(false);this.setReaderHandwritingMode("pen");},this.readerTool==="pen",!hasReader),
    );
    primary.append(reading,writing,recall);
    dock.append(collapse,primary);
    this.syncHistoryButtons();
  }
  private drawSceneBottomCapsule(
    dock:HTMLElement,
    collapse:HTMLButtonElement,
    action:(icon:string,label:string,callback:(button:HTMLButtonElement)=>void,active?:boolean,disabled?:boolean)=>HTMLButtonElement,
    template:StudySceneTemplate,
    selection:StudySceneSelection,
    studySetId:string,
  ):void {
    const primary=el("div",{class:"ms-bottom-primary ms-bottom-scenes",role:"group","aria-label":"学习场景"});
    const sceneNav=el("div",{class:"ms-bottom-scene-nav",role:"tablist","aria-label":"场景模板："+template.name});
    const activateScene=(sceneId:StudySceneId)=>{
      if(sceneId!==selection.sceneId)this.plugin.store.selectStudyScene(studySetId,template.id,sceneId);
      if(sceneId==="recall"){this.reader?.setHandwritingMode("off");this.readerTool="text";if(this.reader instanceof ReaderView)this.reader.stopExtend();}
      this.setRecallActive(sceneId==="recall");
      this.reader?.setAutomaticTextExcerpt((sceneId==="excerpt"||sceneId==="writing")&&this.readerTool==="text");
      this.drawToolbar();this.saveLayout();
    };
    const openScenePicker=()=>{
      const pane=this.popover("切换场景");
      for(const scene of template.scenes){const option=el("button",{type:"button",class:"ms-native-menu-row","aria-pressed":String(scene.id===selection.sceneId),text:scene.label});option.addEventListener("click",()=>{this.dismissPopup();activateScene(scene.id);});pane.append(option);}
    };
    for(const scene of template.scenes){
      const active=scene.id===selection.sceneId;
      const tab=el("button",{type:"button",class:"ms-bottom-action ms-bottom-scene-tab"+(active?" is-active":""),title:scene.label,"aria-label":scene.label,role:"tab","aria-selected":String(active),"aria-pressed":String(active),"data-scene-id":scene.id}) as HTMLButtonElement;
      if(template.scenes.some(item=>item.id==="excerpt")) tab.textContent=scene.label;
      else setNativeIcon(tab,scene.id==="reading"?"book-open":scene.id==="writing"||scene.id==="handwriting"?"bottom-writing":scene.id==="organize"?"panels-top-left":scene.id==="recall"?"bottom-recall":"example");
      tab.setAttribute("aria-expanded","false");
      tab.addEventListener("click",()=>{if(active&&this.root.clientWidth<=900){openScenePicker();tab.setAttribute("aria-expanded","true");return;}if(active&&(scene.id!=="recall"||this.isRecallActive()))return;closeCardActionMenu();activateScene(scene.id);});
      sceneNav.append(tab);
    }
    sceneNav.append(el("span",{class:"ms-bottom-divider",role:"separator","aria-hidden":"true"}));
    const tools=el("div",{class:"ms-bottom-scene-tools",role:"toolbar","aria-label":template.scenes.find(scene=>scene.id===selection.sceneId)?.label+"工具","data-scene-id":selection.sceneId});
    const hasReader=!!this.reader;
    const toolKeys:Record<string,string>=selection.sceneId==="reading"?{"主题":"theme","标题链接":"title-links","块选择":"block-selection"}:selection.sceneId==="excerpt"?{"手型（摘录笔盒）":"excerpt.hand","文本":"excerpt.text","矩形":"excerpt.rectangle","留白":"excerpt.extend","套索":"lasso","连续摘录":"continuous-excerpt","铅笔笔尖":"ink","撤销":"undo","重做":"redo","标题链接":"title-links","块选择":"block-selection","文档笔记本":"document-notebook","更多":"excerpt.more"}:selection.sceneId==="handwriting"?{"普通笔 1":"pen.1","普通笔 2":"pen.2","荧光笔":"highlighter","铅笔":"pencil","套索":"lasso","橡皮擦":"eraser","手形工具":"hand","文本框":"text-box","图片框":"image-box","撤销":"undo","重做":"redo","手写层":"ink-layers"}:selection.sceneId==="writing"?{"文本":"excerpt.text","矩形":"excerpt.rectangle","留白":"excerpt.extend","连续摘录":"continuous-excerpt","普通笔 1":"pen.1","普通笔 2":"pen.2","荧光笔":"highlighter","更多":"pen.more","套索":"lasso","橡皮擦":"eraser","手形工具":"hand","撤销":"undo","重做":"redo"}:selection.sceneId==="organize"?{"卡片分组看板":"board","层级":"hierarchy","复制移动":"copy-move","链接":"links","选择":"selection","铅笔笔尖":"ink","撤销":"undo","重做":"redo"}: {"层级":"hierarchy","重置":"recall-reset","AI提示":"ai-hint","回忆设置":"recall-settings","手写":"ink","自动加入复习":"auto-review","复习":"review"};
    const add=(icon:string,label:string,callback:(button?:HTMLButtonElement)=>void,active?:boolean,disabled=false)=>{const item=action(icon,label,button=>callback(button),active,disabled);const key=toolKeys[label];if(key)item.dataset.msTool=key;if((selection.sceneId==="excerpt"||selection.sceneId==="writing")&&(key==="excerpt.text"||key==="excerpt.rectangle"))item.setAttribute("aria-current",String(!!active));tools.append(item);return item;};
    if(selection.sceneId==="excerpt"){
      add("hand","手型（摘录笔盒）",()=>this.useReaderTool("hand"),this.readerTool==="hand",!hasReader);
      add("baseline","文本",()=>this.useReaderTool("text"),this.readerTool==="text",!hasReader);
      add("scan","矩形",()=>this.useReaderTool("region"),this.readerTool==="region",!hasReader);
      add("between-horizontal-start","留白",()=>this.useReaderTool("extend"),this.readerTool==="extend",!(this.reader instanceof ReaderView&&!!this.reader.getPdfPageEdits()));
      add("bottom-lasso","套索",()=>this.setReaderHandwritingMode("lasso"),this.readerTool==="lasso",!hasReader);
      add("copy-plus","连续摘录",()=>this.toggleContinuousExcerpt(),this.continuousExcerptActive(),!this.canContinuousExcerpt());
      add("pencil","铅笔笔尖",()=>this.setReaderHandwritingMode("pen"),this.readerTool==="pen",!hasReader);
      add("undo-2","撤销",()=>this.applyHistory(false),false,!this.currentHistoryState()?.canUndo);
      add("redo-2","重做",()=>this.applyHistory(true),false,!this.currentHistoryState()?.canRedo);
      add("character-bubble","标题链接",()=>{const on=!this.reader?.getTitleLinksEnabled?.();this.reader?.setTitleLinksEnabled?.(on);this.drawToolbar();},this.reader?.getTitleLinksEnabled?.()??false,!hasReader);
      add("bottom-blocks","块选择",()=>this.toggleBlockSelection(),this.reader?.getBlockSelectionMode()??false,!hasReader);
      add("notebook","文档笔记本",()=>this.toggleDocumentNavigation(),false,!hasReader);
      add("chevron-right","更多",()=>this.openLayoutMenu(),false,!hasReader);
    }else if(selection.sceneId==="handwriting"||selection.sceneId==="writing"){
      const normalPens=this.handwritingPresets().filter(preset=>preset.type!=="pencil"&&preset.type!=="highlighter"),marker=this.handwritingPresets().find(preset=>preset.type==="highlighter");
      const pencil=this.handwritingPresets().find(preset=>preset.type==="pencil");
      if(selection.sceneId==="writing"){
        add("baseline","文本",()=>this.useReaderTool("text"),this.readerTool==="text",!hasReader);
        add("scan","矩形",()=>this.useReaderTool("region"),this.readerTool==="region",!hasReader);
        add("between-horizontal-start","留白",()=>this.useReaderTool("extend"),this.readerTool==="extend",!(this.reader instanceof ReaderView&&this.reader.getPdfPageEdits()));
        add("copy-plus","连续摘录",()=>this.toggleContinuousExcerpt(),this.continuousExcerptActive(),!this.canContinuousExcerpt());
      }
      add("bottom-pen","普通笔 1",()=>{const preset=normalPens[0];if(preset)this.setReaderHandwritingPreset(preset.id);},this.readerTool==="pen"&&!!normalPens[0]&&this.reader?.getActiveHandwritingPreset?.()===normalPens[0].id,!hasReader||!normalPens[0]);
      add("bottom-pen","普通笔 2",()=>{const preset=normalPens[1];if(preset)this.setReaderHandwritingPreset(preset.id);},this.readerTool==="pen"&&!!normalPens[1]&&this.reader?.getActiveHandwritingPreset?.()===normalPens[1].id,!hasReader||!normalPens[1]);
      add("bottom-highlighter","荧光笔",()=>{if(marker)this.setReaderHandwritingPreset(marker.id);},this.readerTool==="highlight",!hasReader||!marker);
      if(selection.sceneId==="writing")add("bottom-more","更多",button=>{if(button)this.openHandwritingPresets(button);},false,!hasReader);
      if(selection.sceneId==="handwriting"){
        add("pencil","铅笔",()=>{if(pencil)this.setReaderHandwritingPreset(pencil.id);},this.readerTool==="pen"&&!!pencil&&this.reader?.getActiveHandwritingPreset?.()===pencil.id,!hasReader||!pencil);
      }
      add("bottom-lasso","套索",()=>this.setReaderHandwritingMode("lasso"),this.readerTool==="lasso",!hasReader);
      add("eraser","橡皮擦",()=>this.setReaderHandwritingMode("eraser"),this.readerTool==="eraser",!hasReader);
      add("bottom-hand","手形工具",()=>this.useReaderTool("hand"),this.readerTool==="hand",!hasReader);
      if(selection.sceneId==="handwriting"){
        add("type","文本框",()=>this.readerAction("文字批注"),false,!hasReader);
        add("image","图片框",()=>this.readerAction("插入图片批注"),false,!hasReader);
      }
      add("undo-2","撤销",()=>this.applyHistory(false),false,!this.currentHistoryState()?.canUndo);
      add("redo-2","重做",()=>this.applyHistory(true),false,!this.currentHistoryState()?.canRedo);
      if(selection.sceneId==="handwriting")add("layers","手写层",button=>this.reader?.openHandwritingSettings(button),false,!hasReader);
    }else if(selection.sceneId==="organize"){
      add("panels-top-left","卡片分组看板",()=>this.renderer?.openBoard());
      add("bottom-hierarchy","层级",()=>this.openRecallHierarchy(tools));
      add("copy","复制移动",button=>{if(button)this.renderer?.openSceneCopyMoveMenu(button);});
      add("link","链接",()=>this.renderer?.toggleSceneConnectMode());
      add("pencil","铅笔笔尖",()=>this.setReaderHandwritingMode("pen"),this.readerTool==="pen",!hasReader);
      add("undo-2","撤销",()=>this.applyHistory(false),false,!this.currentHistoryState()?.canUndo);
      add("redo-2","重做",()=>this.applyHistory(true),false,!this.currentHistoryState()?.canRedo);
    }else if(selection.sceneId==="recall"){
      add("bottom-hierarchy","层级",button=>{if(button)this.openRecallHierarchy(button);},false,!hasReader);
      add("bottom-reset","重置",()=>this.resetRecall(),false,!this.isRecallActive());
      add("bottom-hint","AI提示",()=>{const on=!this.reader?.getRecallAiHint?.();this.reader?.setRecallAiHint?.(on);this.drawToolbar();},this.reader?.getRecallAiHint?.()??false,!hasReader);
      add("sliders-horizontal","回忆设置",button=>{if(button)this.openRecallSettings(button);},false,!hasReader);
      add("bottom-writing","手写",()=>this.setReaderHandwritingMode("pen"),this.readerTool==="pen",!hasReader);
      add("clipboard-check","自动加入复习",()=>{
        const store=this.plugin.store;
        store.settings.autoReview=!store.settings.autoReview;store.save();this.drawToolbar();
        const currentDeck=store.reviewDeckForStudySet()??(!store.activeStudySetId&&store.activeReviewDeckId?store.getReviewDeck(store.activeReviewDeckId):undefined);
        if(store.settings.autoReview&&!currentDeck)openReviewDecks(this.plugin);
      },this.plugin.store.settings.autoReview,!hasReader);
      add("clipboard-list","复习",()=>this.selectAuxiliary("review"),false,!hasReader);
    }else if(selection.sceneId!=="reading"){
      for(const scene of template.scenes.filter(scene=>scene.id===selection.sceneId))for(const tool of scene.tools)tools.append(el("span",{class:"ms-bottom-scene-capability",text:tool,"aria-label":tool}));
    }
    if(selection.sceneId==="reading"){
      add("circle-half","主题",()=>this.cycleReadingTheme());
      add("character-bubble","标题链接",()=>{const on=!this.reader?.getTitleLinksEnabled?.();this.reader?.setTitleLinksEnabled?.(on);this.drawToolbar();},this.reader?.getTitleLinksEnabled?.()??false,!hasReader);
      add("bottom-blocks","块选择",()=>this.toggleBlockSelection(),this.reader?.getBlockSelectionMode()??false,!hasReader);
    }
    if(!["standard","read-write-recall"].includes(template.id)){
      const order=template.scenes.find(scene=>scene.id===selection.sceneId)?.tools??[];
      const items=[...tools.querySelectorAll<HTMLElement>("[data-ms-tool]")];
      for(const item of items)if(!order.includes(item.dataset.msTool!))item.remove();
      for(const key of order){const item=items.find(candidate=>candidate.dataset.msTool===key);if(item&&item.parentElement===tools)tools.append(item);}
    }
    const continuous=this.reader instanceof ReaderView?this.reader.getContinuousExcerpt():null;
    if(continuous?.active){const status=el("div",{role:"status",text:`连续摘录中 · ${continuous.count} 段`});const finish=el("button",{type:"button",text:"完成","aria-label":"完成连续摘录"});finish.addEventListener("click",()=>{if(!(this.reader instanceof ReaderView))return;const count=this.reader.getContinuousExcerpt().count;this.reader.setContinuousExcerpt(false);if(count)new Notice(`已合并 ${count} 段摘录`);});status.append(finish);primary.append(status);}
    primary.append(sceneNav,tools);
    dock.replaceChildren(collapse,primary);
  }
  private bindPresetLongPress(button:HTMLButtonElement,presetId:HandwritingPresetId,label:string):void {
    let timer:number|null=null,pointerId:number|null=null,startX=0,startY=0,consumed=false;
    const cancel=()=>{if(timer!==null)window.clearTimeout(timer);timer=null;pointerId=null;window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",release);window.removeEventListener("pointercancel",release);window.removeEventListener("blur",cancel);window.removeEventListener("keydown",key);};
    const open=()=>{
      if(this.closed||button.disabled||!button.isConnected||!this.reader)return;
      consumed=true;
      const mode=this.handwritingPresets().find(item=>item.id===presetId)?.type==="highlighter"?"highlight":"pen";
      this.reader.setActiveHandwritingPreset?.(presetId);this.reader.setHandwritingMode(mode);
      const anchor=this.bottomCapsule.querySelector<HTMLElement>(`[aria-label="${label}"]`)??button;
      this.reader.openHandwritingSettings(anchor);
    };
    const down=(event:PointerEvent)=>{if(event.button!==0||event.isPrimary===false||button.disabled)return;cancel();consumed=false;pointerId=event.pointerId;startX=event.clientX;startY=event.clientY;window.addEventListener("pointermove",move);window.addEventListener("pointerup",release);window.addEventListener("pointercancel",release);window.addEventListener("blur",cancel);window.addEventListener("keydown",key);timer=window.setTimeout(()=>{timer=null;open();},650);};
    const move=(event:PointerEvent)=>{if(event.pointerId===pointerId&&Math.hypot(event.clientX-startX,event.clientY-startY)>8)cancel();};
    const release=(event:PointerEvent)=>{if(event.pointerId===pointerId)cancel();};
    const click=(event:MouseEvent)=>{if(consumed){consumed=false;event.preventDefault();event.stopImmediatePropagation();}};
    const menu=(event:MouseEvent)=>{event.preventDefault();cancel();open();};
    const key=(event:KeyboardEvent)=>{if(event.key==="Escape")cancel();};
    button.addEventListener("pointerdown",down);button.addEventListener("click",click,true);button.addEventListener("contextmenu",menu);
    this.bottomPressDisposers.push(()=>{cancel();button.removeEventListener("pointerdown",down);button.removeEventListener("click",click,true);button.removeEventListener("contextmenu",menu);window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",release);window.removeEventListener("pointercancel",release);window.removeEventListener("blur",cancel);window.removeEventListener("keydown",key);});
  }
  private currentHistoryState():{canUndo?:boolean;canRedo?:boolean}|undefined {
    return this.historyScope==="reader"?this.reader?.getEditHistoryState():this.plugin.store.getLibraryHistoryState();
  }
  private activateBottomMode(mode:BottomMode):void {
    this.reader?.setBlockSelectionMode(false);this.reader?.setRegionMode(false);
    this.reader?.setRecallHintProvider?.(this.recallHintProvider);
    if(mode!=="recall")this.setRecallActive(false);
    if(mode==="reading"||mode==="recall"){
      this.reader?.setHandwritingMode("off");this.readerTool="text";
      if(this.reader instanceof ReaderView)this.reader.stopExtend();
    }
    this.state.bottomMode=mode;this.state.bottomCollapsed=false;
    if(mode==="recall")this.setRecallActive(true);
    this.drawToolbar();this.saveLayout();
  }
  private isRecallActive():boolean {
    return this.reader?.getRecallMode()??false;
  }
  private setRecallActive(on:boolean):void {
    if(!this.reader||this.isRecallActive()===on)return;
    this.reader.setRecallMode(on);
    this.renderer?.requestRender();
  }
  private resetRecall():void {
    if(!this.isRecallActive())return;
    this.setRecallActive(false);this.setRecallActive(true);this.renderer?.resetRecallState();this.drawBottomCapsule();
  }
  /** MN4 places these two-line confirmations above the bottom capsule. */
  private showWorkspaceNotice(text:string,duration=5000):void {
    if(!this.workspaceNoticeLayer)return;
    if(this.workspaceNoticeTimer!==null)window.clearTimeout(this.workspaceNoticeTimer);
    const notice=el("div",{class:"ms-workspace-notice",role:"status"});
    notice.textContent=text;
    this.workspaceNoticeLayer.replaceChildren(notice);
    this.workspaceNoticeTimer=window.setTimeout(()=>{
      this.workspaceNoticeTimer=null;
      if(this.workspaceNoticeLayer?.contains(notice))this.workspaceNoticeLayer.replaceChildren();
    },duration);
  }
  private setReaderHandwritingMode(mode:"pen"|"highlight"|"eraser"|"lasso"|"off"):void {
    if(!this.reader){this.chooseDocument();return;}
    this.reader.setAutomaticTextExcerpt(false);
    if(this.reader instanceof ReaderView)this.reader.setContinuousExcerptPen("inactive");
    this.reader.setBlockSelectionMode(false);this.reader.setRegionMode(false);
    const current=this.reader.getHandwritingMode();
    this.reader.setHandwritingMode(current===mode?"off":mode);
    this.readerTool=this.reader.getHandwritingMode()==="off"?"text":this.reader.getHandwritingMode();
    this.state.bottomMode="writing";this.drawToolbar();
  }
  private setReaderHandwritingPreset(preset:HandwritingPresetId):void {
    if(!this.reader){this.chooseDocument();return;}
    this.reader.setAutomaticTextExcerpt(false);
    if(this.reader instanceof ReaderView)this.reader.setContinuousExcerptPen("inactive");
    this.reader.setBlockSelectionMode(false);this.reader.setRegionMode(false);
    const mode=this.handwritingPresets().find(item=>item.id===preset)?.type==="highlighter"?"highlight":"pen";
    const same=this.reader.getHandwritingMode()===mode&&this.reader.getActiveHandwritingPreset?.()===preset;
    this.reader.setActiveHandwritingPreset?.(preset);
    this.reader.setHandwritingMode(same?"off":mode);
    this.readerTool=this.reader.getHandwritingMode()==="off"?"text":this.reader.getHandwritingMode();
    this.state.bottomMode="writing";this.drawToolbar();
  }
  private handwritingPresets():HandwritingPresetSpec[] {
    return handwritingPresets(this.plugin.store.getEffectiveSceneSettings());
  }
  private openHandwritingPresets(anchor:HTMLElement):void {
    this.reader?.openHandwritingPresets(anchor);
  }
  private canContinuousExcerpt():boolean { return this.reader instanceof ReaderView && !!this.reader.getFilePath() && (this.readerTool==="text"||this.readerTool==="region"); }
  private continuousExcerptActive():boolean { return this.reader instanceof ReaderView && this.reader.getContinuousExcerpt().active; }
  private toggleContinuousExcerpt():void { if(this.canContinuousExcerpt() && this.reader instanceof ReaderView)this.reader.setContinuousExcerpt(!this.reader.getContinuousExcerpt().active); }
  private cycleReadingTheme():void {
    const index=readingThemes.findIndex(theme=>theme.id===this.getReadingTheme());
    this.setReadingTheme(readingThemes[(index+1)%readingThemes.length].id);this.drawToolbar();
  }
  private toggleBlockSelection():void {
    if(!this.reader)return;
    this.reader.setAutomaticTextExcerpt(false);
    const on=!this.reader.getBlockSelectionMode();
    if(on){closeCardActionMenu();if(this.reader instanceof ReaderView)this.reader.stopExtend();this.setRecallActive(false);this.reader.setRegionMode(false);this.reader.setHandwritingMode("off");this.readerTool="text";}
    this.reader.setBlockSelectionMode(on);this.drawToolbar();
  }
  private openRecallSettings(anchor:HTMLElement):void {
    if(!this.reader){new Notice("当前阅读器没有可用的回忆设置");return;}
    const all=this.reader.getRecallCoverAll(),menu=new Menu();
    for(const [mode,label] of [["in-place","原位遮挡"],["layered","逐层回忆"]] as const)menu.addItem(item=>item.setTitle(label).setChecked(this.recallDisplayMode===mode).onClick(()=>{this.recallDisplayMode=mode;this.syncRecallDisplayMode();}));
    menu.addItem(item=>item.setTitle("遮挡全部摘录").setChecked(all).onClick(()=>{if(!all)this.reader?.setRecallCoverAll(true);}));
    menu.addItem(item=>item.setTitle("仅标记遮挡").setChecked(!all).onClick(()=>{if(all)this.reader?.setRecallCoverAll(false);}));
    const setting=(key:import("../types").RecallOptionKey,title:string)=>menu.addItem(item=>item.setTitle(title).setChecked(this.reader?.getRecallSetting?.(key)??false).onClick(()=>{
      if(this.reader)this.reader.setRecallSetting?.(key,!this.reader.getRecallSetting?.(key));this.renderer?.requestRender();
    }));
    setting("maskCardBody","遮挡卡片正文");
    setting("maskEmphasisImages","遮挡划重点与图片");
    setting("maskHighlighter","遮挡荧光笔笔迹");
    setting("maskDocumentExcerpts","遮挡文档摘录");
    setting("maskMindMapTitles","遮挡脑图（仅标题）");
    setting("blurExcerpts","模糊摘录");
    setting("singleReveal","单项揭示");
    setting("structuredHint","结构化提示");
    setting("onDeviceAiHint","设备端 AI 提示");
    const setId=this.plugin.store.activeStudySetId;
    if(setId)menu.addItem(item=>item.setTitle("保存回忆设置到当前学习集").onClick(()=>{
      const reader=this.reader;if(!reader)return;
      const keys: import("../types").RecallOptionKey[]=["maskCardBody","maskEmphasisImages","maskHighlighter","maskDocumentExcerpts","maskMindMapTitles","blurExcerpts","singleReveal","structuredHint","onDeviceAiHint"];
      const options=Object.fromEntries(keys.map(key=>[key,reader.getRecallSetting?.(key)??false])) as Record<import("../types").RecallOptionKey,boolean>;
      this.plugin.store.updateStudySet(setId,{recallSettings:{options,coverAll:reader.getRecallCoverAll(),hintLanguage:reader.getRecallHintLanguage?.()??"auto",mode:this.recallDisplayMode}});
      new Notice("已保存当前学习集的回忆设置");
    }));
    if(setId&&this.plugin.store.studySets.find(set=>set.id===setId)?.recallSettings)menu.addItem(item=>item.setTitle("恢复默认回忆设置").onClick(()=>{
      this.recallSettingsSetId=null;
      this.plugin.store.updateStudySet(setId,{recallSettings:undefined});
      this.restoreRecallSettings();
      new Notice("已恢复默认回忆设置");
    }));
    const language=this.reader.getRecallHintLanguage?.()??"auto";
    const nextLanguage=language==="auto"?"zh":language==="zh"?"en":"auto";
    const languageLabels={auto:"自动",zh:"简体中文",en:"English"} as const;
    menu.addItem(item=>item.setTitle(`提示语言：${languageLabels[language]}`).onClick(()=>{
      this.reader?.setRecallHintLanguage?.(nextLanguage);
      this.showWorkspaceNotice(nextLanguage==="auto"?"提示语言：自动\n按摘录语言选择中文或 English。":`提示语言：${languageLabels[nextLanguage]}\n新提示将使用此语言。`);
    }));
    const box=anchor.getBoundingClientRect();menu.showAtPosition({x:box.left,y:box.top-8});
  }
  private restoreRecallSettings():void {
    const reader=this.reader,id=this.plugin.store.activeStudySetId;
    if(!reader||this.recallSettingsSetId===id)return;
    this.recallSettingsSetId=id;
    const saved=this.plugin.store.studySets.find(set=>set.id===id)?.recallSettings;
    this.recallDisplayMode=saved?.mode==="layered"?"layered":"in-place";
    const defaults:Record<import("../types").RecallOptionKey,boolean>={maskCardBody:true,maskEmphasisImages:true,maskHighlighter:true,maskDocumentExcerpts:true,maskMindMapTitles:false,blurExcerpts:false,singleReveal:false,structuredHint:true,onDeviceAiHint:false};
    for(const key of Object.keys(defaults) as import("../types").RecallOptionKey[])reader.setRecallSetting?.(key,typeof saved?.options?.[key]==="boolean"?saved.options[key]:defaults[key]);
    reader.setRecallCoverAll(saved?.coverAll??true);
    reader.setRecallHintLanguage?.(saved?.hintLanguage??"auto");
    this.syncRecallDisplayMode();
  }
  private syncRecallDisplayMode():void { this.root?.toggleAttribute("data-recall-layered",this.recallDisplayMode==="layered");this.renderer?.resetRecallState(); }
  private openRecallHierarchy(anchor:HTMLElement):void {
    if(!this.reader)return;
    const menu=new Menu(),current=this.reader.getRecallHierarchy?.()??1;
    menu.addItem(item=>item.setTitle("应用脑图层级").setDisabled(true));
    for(let level=1;level<=8;level++)menu.addItem(item=>item.setTitle(`层级 ${level}`).setChecked(current===level).onClick(()=>{
      this.reader?.setRecallHierarchy?.(level);this.renderer?.setRecallHierarchy(level);
      if (this.state.mindmap) this.refresh(true);
    }));
    const box=anchor.getBoundingClientRect();menu.showAtPosition({x:box.left,y:box.top-8});
  }
  private selectAuxiliary(kind:AuxiliaryKind):void {
    if(this.state.auxiliary!=="none")this.state.auxiliaryWidths[this.state.auxiliary]=this.state.auxiliaryWidth;
    this.state.auxiliary=kind;
    if(kind!=="none")this.state.auxiliaryWidth=this.state.auxiliaryWidths[kind];
    this.layoutChanged();
  }
  openAuxiliary(kind:"ai"|"research"): void { this.selectAuxiliary(this.state.auxiliary===kind?"none":kind); }
  showResearchText(text:string):void {
    const query=text.trim().slice(0,4000);if(!query)return;
    // An explicit paper action must not first navigate a previously selected passage.
    this.selection=null;this.state.researchUrl=undefined;this.state.researchSession=undefined;this.selectAuxiliary("research");
    this.selection={text:query,at:Date.now()};this.research?.search(query);
  }
  private noteAiContext?: AiContext;
  showAiContext(context: AiContext): void { this.noteAiContext=context;this.contextSource="note";this.ai?.setContext(context);this.selectAuxiliary("ai"); }
  private onMindmapSelectionChange(nodes: readonly MindNode[]): void {
    if(this.fixedViewsOpen)this.drawFixedViews();
    const entries=nodes.map((node,index)=>{
      const card=node.cardId?this.plugin.store.getCard(node.cardId):undefined;
      const content=[`脑图卡片 ${index+1}：${node.title}`,card?.title&&card.title!==node.title?`卡片标题：${card.title}`:"",card?.front?`正文：${card.front}`:"",card?.back?`笔记/答案：${card.back}`:"",...(node.comments??[]).map((comment,commentIndex)=>`卡片评论 ${commentIndex+1}：${comment}`)].filter(Boolean);
      return {node,card,text:content.join("\n")};
    }).filter(entry=>entry.text);
    this.mapAiContext=entries.length?{
      label:`脑图中 ${entries.length} 张卡片`,
      text:entries.map(entry=>entry.text).join("\n\n"),
      ...(entries.length&&entries.every(entry=>(entry.node.docPath??entry.card?.docPath)===(entries[0].node.docPath??entries[0].card?.docPath))&&(entries[0].node.docPath??entries[0].card?.docPath)?{docPath:entries[0].node.docPath??entries[0].card?.docPath}:{}),
    }:undefined;
    if(entries.length)this.contextSource="mindmap";
    else if(this.contextSource==="mindmap")this.contextSource=null;
    this.ai?.setContext(this.selectedContext());
  }

  private drawFixedViews(): void {
    if(!this.fixedViewsHost)return;
    this.fixedViewsHost.replaceChildren();
    if(!this.fixedViewsOpen)return;
    const panel=el("div",{class:"ms-fixed-views-panel","aria-label":"固定视图列表"});this.fixedViewsHost.append(panel);this.positionFixedPanel();
    const store=this.plugin.store,set=store.studySets.find(item=>item.id===store.activeStudySetId),canvas=store.canvases.find(item=>item.id===store.activeCanvasId);
    const chosen=this.renderer?.selectedViewNode();
    for(const [kind,label] of [["canvas","固定当前脑图"],["submap","固定选中子脑图"],["board","固定当前看板"],["local","固定局部视角"]] as const){
      const add=el("button",{text:label}) as HTMLButtonElement;add.disabled=!set||!canvas||((kind==="submap"||kind==="local")&&!chosen);
      add.addEventListener("click",()=>{if(!set||!canvas||!this.renderer)return;const node=this.renderer.selectedViewNode();if((kind==="submap"||kind==="local")&&!node)return;if(kind==="submap"){this.renderer.openSelectedChildMap();return;}const name=kind==="canvas"?canvas.name:kind==="board"?canvas.name+" · 看板":(node!.title||"未命名节点")+" · 局部";store.updateStudySet(set.id,{fixedViews:[...(set.fixedViews??[]),{id:uid("fixed"),name,kind,canvasId:canvas.id,...(node&&kind==="local"?{nodeId:node.id}:{}),viewport:this.renderer.captureViewport(),...(kind==="board"?{boardViewport:this.renderer.captureBoardViewport()}:{})}]});this.drawFixedViews();});panel.append(add);
    }
    for(const fixed of set?.fixedViews??[]){const row=el("div",{class:"ms-fixed-view-row"});const entry=el("button",{text:fixed.name,"data-fixed-view":fixed.id}) as HTMLButtonElement;entry.disabled=!store.canvases.some(item=>item.id===fixed.canvasId&&item.studySetId===set?.id)||!!(fixed.nodeId&&!store.nodes.some(node=>node.id===fixed.nodeId&&node.canvasId===fixed.canvasId));entry.addEventListener("click",()=>{if(entry.disabled)return;store.setActiveCanvas(fixed.canvasId);this.state.mindmap=true;this.applyLayout();this.renderer?.openFixedView(fixed.kind,fixed.nodeId,fixed.viewport,fixed.boardViewport);});const remove=el("button",{"aria-label":`移除固定视图：${fixed.name}`,text:"×"});remove.addEventListener("click",()=>{if(set)store.updateStudySet(set.id,{fixedViews:(set.fixedViews??[]).filter(item=>item.id!==fixed.id)});this.drawFixedViews();});row.append(entry,remove);panel.append(row);}
  }
  private positionFixedPanel(): void {
    const panel=this.fixedViewsHost.querySelector<HTMLElement>(".ms-fixed-views-panel");if(!panel)return;
    const host=this.fixedViewsHost.getBoundingClientRect(),pane=this.mapPane.getBoundingClientRect();
    panel.style.left=host.left-pane.left>pane.width*.55?"auto":"46px";panel.style.right=host.left-pane.left>pane.width*.55?"46px":"auto";
    panel.style.top=host.top-pane.top<pane.height*.3?"0":"auto";panel.style.bottom=host.top-pane.top<pane.height*.3?"auto":"0";
  }
  private selectedContext(): AiContext|undefined {
    const recent=this.selection&&Date.now()-this.selection.at<=5000?this.selection:undefined;
    if(this.contextSource==="mindmap"&&this.mapAiContext)return this.mapAiContext;
    if(this.contextSource==="note"&&this.noteAiContext?.docPath===this.state.activePath)return this.noteAiContext;
    if(this.contextSource==="reader"&&recent)return{text:recent.text,label:"选中文字",docPath:this.state.activePath};
    if(recent)return{text:recent.text,label:"选中文字",docPath:this.state.activePath};
    return this.noteAiContext?.docPath===this.state.activePath?this.noteAiContext:undefined;
  }
  public toggleInterfaceMode(): void {
    if (!toggleStudyInterface(this.plugin.store)) { new Notice("请先选择学习集"); return; }
    const scene = this.plugin.store.getStudyScene(this.plugin.store.activeStudySetId ?? "");
    this.reader?.setAutomaticTextExcerpt(scene?.interfaceMode === "scenes" && (scene.sceneId === "excerpt" || scene.sceneId === "writing") && this.readerTool === "text");
    this.reader?.refreshSceneSettings?.();
    this.refresh(true);
  }
  private openStudyMore():void {
    const pane=this.popover("StudySet - More");pane.classList.add("ms-native-study-more");
    const action=(text:string,icon:string,callback:()=>void)=>{const row=el("button",{class:"ms-native-menu-row",text});const glyph=el("span",{class:"ms-native-menu-icon"});setIcon(glyph,icon);row.prepend(glyph);row.addEventListener("click",()=>{this.dismissPopup();callback();});pane.append(row);};
    action(this.focusedStage?"Exit Immersive Mode":"Enter Immersive Mode","scan-line",()=>this.toggleFocus());
    action("Cards","panels-top-left",()=>this.selectAuxiliary("cards"));
    action("Review","clipboard-list",()=>this.selectAuxiliary("review"));
    action("Research","globe",()=>this.selectAuxiliary("research"));
    action("AI","sparkles",()=>this.selectAuxiliary("ai"));
    action("自定义 AI…","settings-2",()=>openAiSettings(this.plugin));
    action("全局搜索…","search",()=>openGlobalSearch(this.plugin));
    action("管理复习卡组…","clipboard-list",()=>openReviewDecks(this.plugin));
    action("导入网页 / 微信文章…","download",()=>openWebImport(this.plugin));
    const studySetId=this.plugin.store.activeStudySetId;
    action("切换界面模式","layout-template",()=>this.toggleInterfaceMode());
    action("固定视图…","pin",()=>{this.fixedViewsOpen=!this.fixedViewsOpen;this.drawFixedViews();});
    if(studySetId)for(const template of this.plugin.store.getSceneTemplates())action(`场景模板：${template.name}`,"layout-template",()=>{this.plugin.store.selectStudyScene(studySetId,template.id,template.scenes[0].id);this.reader?.refreshSceneSettings?.();this.drawToolbar();this.saveLayout();});
    action("管理场景模板…","layout-template",()=>this.openSceneTemplateManager());
    action("工作区设置…","settings-2",()=>this.openWorkspaceSettings());
  }
  private openSceneTemplateManager():void {
    const pane=this.popover("场景模板管理"),store=this.plugin.store;
    pane.append(el("p",{text:"复制模板后可编辑；从学习集复制会带入当前颜色。"}));
    const setId=store.activeStudySetId;
    if(setId){const copy=el("button",{text:"从当前学习集复制"});copy.addEventListener("click",()=>this.editSceneTemplate(store.copyStudySetSceneTemplate(setId)));pane.append(copy);}
    for(const template of store.getSceneTemplates()){
      const row=el("div",{class:"ms-scene-template-row"});row.append(el("span",{text:template.name}));
      const copy=el("button",{text:"复制"+template.name});copy.addEventListener("click",()=>this.editSceneTemplate(store.copySceneTemplate(template.id)));row.append(copy);
      if(!builtinSceneTemplates().some(item=>item.id===template.id)){
        const edit=el("button",{text:"编辑"+template.name});edit.addEventListener("click",()=>this.editSceneTemplate(template));row.append(edit);
        const remove=el("button",{text:"删除"+template.name});remove.addEventListener("click",()=>{
          const active=setId&&store.getStudyScene(setId)?.templateId===template.id;
          openConfirm("删除场景模板",`删除「${template.name}」？仅删除模板，已使用该模板的学习集数据会保留。${active?"当前活动模板将先切回标准（standard）。":""}其他使用此模板的学习集也将切回标准。`,()=>{
            try{store.removeSceneTemplate(template.id);this.reader?.refreshSceneSettings?.();this.drawToolbar();this.openSceneTemplateManager();new Notice("模板已删除");}
            catch(error){new Notice("删除失败："+String(error));}
          },"删除模板");
        });row.append(remove);
      }
      const download=el("button",{text:"导出"+template.name});download.addEventListener("click",()=>{const url=URL.createObjectURL(new Blob([store.exportSceneTemplate(template.id)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="margin-study-scene-template.json";a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);});row.append(download);pane.append(row);
    }
    const input=el("input",{type:"file",accept:"application/json,.json","aria-label":"导入模板文件"}) as HTMLInputElement;
    input.addEventListener("change",()=>{const file=input.files?.[0];if(!file)return;void file.text().then(text=>{const imported=store.importSceneTemplate(text);new Notice("模板已导入");this.editSceneTemplate(imported);}).catch(error=>new Notice("导入失败："+String(error)));});pane.append(input);
  }
  private editSceneTemplate(template:StudySceneTemplate):void {
    const pane=this.popover("编辑场景模板"),draft:StudySceneTemplate=JSON.parse(JSON.stringify(template));
    pane.append(el("p",{text:"修改名称、场景工具及颜色，保存后可在场景模板菜单中使用。"}));
    const name=el("input",{type:"text","aria-label":"模板名称"}) as HTMLInputElement;name.value=draft.name;pane.append(name);
    for(const scene of draft.scenes){
      const group=el("fieldset");group.append(el("legend",{text:scene.label}));
      const choices=[...new Set([...builtinSceneTemplates().flatMap(item=>item.scenes.filter(source=>source.id===scene.id).flatMap(source=>source.tools)),...scene.tools])];
      const toolLabels:Record<string,string>={"excerpt.hand":"手型","excerpt.text":"文本","excerpt.rectangle":"矩形","excerpt.extend":"留白","excerpt.more":"更多摘录工具","continuous-excerpt":"连续摘录","pen.1":"普通笔 1","pen.2":"普通笔 2","pen.more":"更多手写工具",highlighter:"荧光笔",pencil:"铅笔",lasso:"套索",eraser:"橡皮擦",hand:"手形工具",ink:"手写",undo:"撤销",redo:"重做","title-links":"标题链接","block-selection":"块选择","document-notebook":"文档笔记本","text-box":"文本框","image-box":"图片框","ink-layers":"手写层",board:"看板",hierarchy:"层级","copy-move":"复制移动",links:"链接",selection:"选择",theme:"主题","recall-reset":"重置","ai-hint":"AI 提示","recall-settings":"回忆设置","auto-review":"自动加入复习",review:"复习",more:"更多"};
      for(const tool of choices.filter(item=>item!=="more")){const label=el("label"),checkbox=el("input",{type:"checkbox","data-template-tool":tool}) as HTMLInputElement;checkbox.checked=scene.tools.includes(tool);checkbox.addEventListener("change",()=>{if(checkbox.checked&&!scene.tools.includes(tool))scene.tools.push(tool);else if(!checkbox.checked)scene.tools=scene.tools.filter(item=>item!==tool);});label.append(checkbox,document.createTextNode(toolLabels[tool]??tool));group.append(label);}
      pane.append(group);
    }
    const colors=el("input",{type:"text","aria-label":"摘录颜色"}) as HTMLInputElement;colors.value=(draft.colors??this.plugin.store.settings.colors).join(", ");pane.append(el("label",{text:"摘录颜色（#RRGGBB，逗号分隔）"}),colors);
    const popup=el("input",{type:"checkbox","aria-label":"摘录后显示浮窗"}) as HTMLInputElement;popup.checked=draft.excerptPopup??this.plugin.store.settings.excerptPopup??false;const popupLabel=el("label",{text:"摘录后显示浮窗"});popupLabel.prepend(popup);pane.append(popupLabel);
    const menuGroup=el("fieldset");menuGroup.append(el("legend",{text:"选区菜单"}));const menuIds=draft.textSelectionMenuActions??this.plugin.store.settings.textSelectionMenuActions??["copy","fold","extend-ink","extend-text","ask","research"];
    let menuChanged=false;const menuOptions=[["copy","复制"],["fold","折叠"],["extend-ink","手写留白"],["extend-text","文字留白"],["ask","向 AI 提问"],["research","研究"],["speech","朗读"]] as const;const menuInputs=menuOptions.map(([id,label])=>{const box=el("input",{type:"checkbox","aria-label":"选区菜单："+label}) as HTMLInputElement;box.checked=menuIds.includes(id);box.addEventListener("change",()=>{menuChanged=true;});const row=el("label",{text:label});row.prepend(box);menuGroup.append(row);return{id,box};});pane.append(menuGroup);
    const presets=JSON.parse(JSON.stringify(draft.handwritingPresets??handwritingPresets(this.plugin.store.settings))) as HandwritingPresetSpec[];
    const penInputs=presets.map(preset=>{const row=el("div"),label=el("input",{type:"text","aria-label":"笔名称 "+preset.id}) as HTMLInputElement,color=el("input",{type:"color","aria-label":"笔颜色 "+preset.id}) as HTMLInputElement,width=el("input",{type:"number",min:"0.5",max:preset.type==="highlighter"?"64":"24",step:"0.1","aria-label":"笔宽 "+preset.id}) as HTMLInputElement;label.value=preset.label;color.value=preset.color;width.value=String(preset.width);row.append(label,color,width);pane.append(row);return{preset,label,color,width};});
    const save=el("button",{text:"保存模板"});save.addEventListener("click",()=>{try{draft.name=name.value.trim();draft.colors=colors.value.split(",").map(value=>value.trim());draft.excerptPopup=popup.checked;if(menuChanged||draft.textSelectionMenuActions)draft.textSelectionMenuActions=[...menuInputs.filter(item=>item.box.checked).map(item=>item.id),...menuIds.filter(id=>!menuOptions.some(option=>option[0]===id))];draft.handwritingPresets=penInputs.map(({preset,label,color,width})=>({...preset,label:label.value.trim(),color:color.value,width:Number(width.value),...(Number(width.value)===preset.width?{}:{documentWidth:Number(width.value),mindmapWidth:Number(width.value),cardWidth:Number(width.value)})}));this.plugin.store.saveSceneTemplate(draft);this.reader?.refreshSceneSettings?.();this.drawToolbar();new Notice("模板已保存");this.openSceneTemplateManager();}catch(error){new Notice("保存失败："+String(error));}});pane.append(save);
  }
  private toggleFocus(restoreReader = true): void {
    const reader=this.reader, state=restoreReader?reader?.getState():null;
    this.focusedStage=!this.focusedStage;
    if(this.focusedStage){this.focusAnchor=document.createComment("MarginStudy workspace host");this.root.before(this.focusAnchor);document.body.append(this.root);}
    else if(this.focusAnchor){this.focusAnchor.replaceWith(this.root);this.focusAnchor=null;}
    this.root.classList.toggle("is-focused-stage",this.focusedStage);this.drawToolbar();
    if(reader&&state)void reader.setState(state).catch(error=>{if(!this.closed&&this.reader===reader)new Notice("恢复阅读位置失败："+String(error));});
  }
  private dismissPopup(): void { this.popup?.remove();this.popup=null; }
  private popover(title:string): HTMLElement {
    this.dismissPopup();
    const pane=el("section",{class:"ms-native-popover",role:"dialog","aria-label":title});
    const head=el("header",{class:"ms-native-popover-head"});head.append(el("strong",{text:title}),this.toolbarButton("x","关闭工具面板",()=>this.dismissPopup()));
    pane.append(head);this.root.append(pane);this.popup=pane;return pane;
  }
  private homeSection: "学习集" | "卡组" | "资料库" = "学习集";
  private homeSelectMode=false;
  private homeSearchQuery="";
  public showStudyHome(): void { this.openStudyMenu();if(this.popup&&!this.popup.classList.contains("ms-study-home-screen"))this.enhanceStudyHome(this.popup); }
  private enhanceStudyHome(pane:HTMLElement):void {
    pane.classList.add("ms-study-home-screen");
    const navigation=el("nav",{class:"ms-study-home-navigation","aria-label":"主页导航"});
    navigation.append(el("strong",{class:"ms-study-home-brand",text:"MarginStudy"}));
    const messages=this.toolbarButton("bell","消息",()=>new Notice("暂无新消息"));messages.classList.add("ms-study-home-header-action");
    const guide=this.toolbarButton("circle-help","引导",()=>new Notice("选择学习集进入工作区；顶部切换场景，底部选择工具。"));guide.classList.add("ms-study-home-header-action");
    navigation.append(messages,guide);
    const heading=pane.querySelector<HTMLElement>(".ms-native-popover-head strong");if(heading)heading.textContent=this.homeSection;
    const header=pane.querySelector<HTMLElement>(".ms-native-popover-head");
    const filters=[...pane.querySelectorAll<HTMLElement>(".ms-study-home-filter")];
    if(header&&filters.length){
      const tools=el("div",{class:"ms-study-home-header-tools"});tools.append(...filters);
      const choose=el("button",{type:"button",class:"ms-study-home-select","aria-label":"选择学习集","aria-pressed":String(this.homeSelectMode),text:"选择"}) as HTMLButtonElement;
      choose.addEventListener("click",()=>{this.homeSelectMode=!this.homeSelectMode;pane.classList.toggle("is-select-mode",this.homeSelectMode);choose.setAttribute("aria-pressed",String(this.homeSelectMode));});tools.append(choose);
      const search=el("button",{type:"button",class:"ms-study-home-search-button","aria-label":"搜索学习集",title:"搜索学习集"}) as HTMLButtonElement;setNativeIcon(search,"search");
      search.addEventListener("click",()=>{let input=tools.querySelector<HTMLInputElement>(".ms-study-home-search");if(input){this.homeSearchQuery="";input.remove();for(const card of pane.querySelectorAll<HTMLElement>(".ms-study-home-card"))card.hidden=false;return;}input=el("input",{type:"search",class:"ms-study-home-search","aria-label":"搜索学习集名称",placeholder:"搜索学习集"}) as HTMLInputElement;input.addEventListener("input",()=>{const query=input!.value.trim().toLocaleLowerCase("zh-CN");this.homeSearchQuery=query;for(const card of pane.querySelectorAll<HTMLElement>(".ms-study-home-card")){const set=this.plugin.store.studySets.find(item=>item.id===card.dataset.studyCover);card.hidden=!!query&&!(set?.name??"").toLocaleLowerCase("zh-CN").includes(query);}});tools.append(input);input.focus();});tools.append(search);
      const create=el("button",{type:"button",class:"ms-study-home-create","aria-label":"新建学习集",text:"新建"}) as HTMLButtonElement;create.addEventListener("click",()=>this.openNewStudySet());tools.append(create);
      header.insertBefore(tools,header.lastElementChild);
    }
    const sections=[...pane.querySelectorAll<HTMLElement>("[data-home-section]")];
    const chooseSection=(label:"学习集"|"卡组"|"资料库")=>{this.homeSection=label;if(heading)heading.textContent=label;for(const section of sections)section.hidden=section.dataset.homeSection!==label;for(const button of navigation.querySelectorAll<HTMLButtonElement>("[data-home-section-button]"))button.setAttribute("aria-pressed",String(button.dataset.homeSectionButton===label));};
    for(const label of ["学习集","卡组"] as const){const control=el("button",{type:"button",text:label==="卡组"?"复习卡组":label,"aria-label":label==="卡组"?"复习卡组":label,"aria-pressed":String(this.homeSection===label),"data-home-section-button":label}) as HTMLButtonElement;
      control.addEventListener("click",()=>chooseSection(label));navigation.append(control);}
    const recent=el("section",{class:"ms-study-home-recent","aria-label":"最近"});recent.append(el("span",{class:"ms-study-home-recent-label",text:"最近"}));
    for(const source of [...pane.querySelectorAll<HTMLElement>(".ms-study-home-card")].slice(0,5)){
      const setId=source.dataset.studyCover,sourceButton=source.querySelector<HTMLButtonElement>(".ms-native-menu-row");if(!setId||!sourceButton)continue;
      const item=el("button",{type:"button",class:"ms-study-home-recent-item",text:sourceButton.textContent?.trim()??"", "aria-label":`最近学习集：${sourceButton.textContent?.trim()??""}`});
      item.addEventListener("click",()=>{const current=this.plugin.store.canvases.find(canvas=>canvas.id===this.plugin.store.activeCanvasId&&canvas.studySetId===setId&&canvas.kind!=="review");if(setId!==this.plugin.store.activeStudySetId||!current)this.plugin.store.setActiveStudySet(setId);this.dismissPopup();this.refresh(true);this.saveLayout();});recent.append(item);
    }
    navigation.append(recent);
    const footer=el("div",{class:"ms-study-home-footer","aria-label":"主页底部导航"});
    const library=el("button",{type:"button",text:"资料库","aria-label":"资料库","aria-pressed":String(this.homeSection==="资料库"),"data-home-section-button":"资料库"}) as HTMLButtonElement;
    library.addEventListener("click",()=>chooseSection("资料库"));
    const versions=el("button",{type:"button",class:"ms-study-home-version-link",text:"版本库","aria-label":"版本库"});versions.addEventListener("click",()=>this.openVersionLibrary());
    const bottom=el("div",{class:"ms-study-home-footer-bottom"});
    const settings=this.toolbarButton("settings-2","设置",()=>{openSettingAndReveal(this.plugin,"每日自动备份");});settings.classList.add("ms-study-home-footer-icon");
    const more=this.toolbarButton("more-horizontal","主页更多",()=>this.openStudyMore());more.classList.add("ms-study-home-footer-icon");
    bottom.append(settings,more);footer.append(library,versions,bottom);navigation.append(footer);
    for(const section of sections)section.hidden=section.dataset.homeSection!==this.homeSection;
    pane.prepend(navigation);
  }
  private openVersionLibrary():void {
    const pane=this.popover("版本库");
    pane.append(el("p",{text:"MarginStudy 学习库备份"}));
    const commands=(this.app as unknown as {commands:{executeCommandById(id:string):boolean}}).commands;
    const backup=el("button",{class:"ms-native-menu-row",text:"立即备份"});backup.addEventListener("click",()=>{this.dismissPopup();void commands.executeCommandById("margin-study:backup-data");});pane.append(backup);
    const restore=el("button",{class:"ms-native-menu-row",text:"恢复完整学习库备份"});restore.addEventListener("click",()=>{this.dismissPopup();void commands.executeCommandById("margin-study:restore-backup");});pane.append(restore);
  }
  private openStudyMenu(): void {
    const homeScreen=!!this.popup?.classList.contains("ms-study-home-screen");
    const pane=this.popover("StudySet");
    pane.classList.add("ms-study-home");
    if(homeScreen)pane.classList.add("ms-study-home-screen");
    const store=this.plugin.store;
    const sections=el("div",{class:"ms-study-home-sections"});pane.append(sections);
    const section=(label:string)=>{const node=el("section",{"data-home-section":label,"aria-label":label,class:"ms-study-home-section"});node.append(el("h3",{text:label}));sections.append(node);return node;};
    const study=section("学习集"),review=section("卡组"),library=section("资料库");
    const group=(label:string)=>{const node=el("div",{"data-home-group":label});node.append(el("h4",{text:label}));study.append(node);return node;};
    const pinned=group("置顶学习集"),all=group("全部学习集");
    const filter=el("select",{class:"ms-select ms-study-home-filter","aria-label":"筛选学习集分类"}) as HTMLSelectElement;
    filter.append(el("option",{value:"",text:"全部分类"}));
    for(const category of [...new Set(store.studySets.map(set=>set.category?.trim()).filter((value):value is string=>!!value))].sort((a,b)=>a.localeCompare(b,"zh-CN")))filter.append(el("option",{value:category,text:category}));
    filter.value=store.settings.studyHomeCategory??"";
    filter.addEventListener("change",()=>{store.settings.studyHomeCategory=filter.value;store.save();this.openStudyMenu();});all.append(filter);
    const sorting=el("select",{class:"ms-select ms-study-home-filter","aria-label":"学习集排序"}) as HTMLSelectElement;
    sorting.append(el("option",{value:"recent",text:"最近创建"}),el("option",{value:"name",text:"名称"}));sorting.value=store.settings.studyHomeSort??"recent";
    sorting.addEventListener("change",()=>{store.settings.studyHomeSort=sorting.value==="name"?"name":"recent";store.save();this.openStudyMenu();});all.append(sorting);
    const matches=(set:typeof store.studySets[number])=>(!store.settings.studyHomeCategory||set.category===store.settings.studyHomeCategory)&&(!this.homeSearchQuery||set.name.toLocaleLowerCase("zh-CN").includes(this.homeSearchQuery.toLocaleLowerCase("zh-CN")));
    const sorted=[...store.studySets].sort((a,b)=>store.settings.studyHomeSort==="name"?a.name.localeCompare(b.name,"zh-CN"):b.createdAt.localeCompare(a.createdAt));
    const drawSet=(set:typeof store.studySets[number],target:HTMLElement)=>{
      const card=el("article",{class:"ms-study-home-card","data-study-cover":set.id});
      const cover=el("div",{class:"ms-study-home-cover"});
      const docCount=new Set(set.docPaths).size;
      const docs=el("div",{class:"ms-study-home-cover-doc","data-cover-documents":"true","data-document-count":String(docCount)});
      docs.append(el("span",{text:"文档"}),el("strong",{text:String(docCount)}));
      if(set.docPaths[0])docs.append(el("span",{class:"ms-study-home-preview",text:set.docPaths[0].split('/').pop()??set.docPaths[0]}));
      const webCount=new Set(set.docPaths.filter(path=>!!store.documents.find(doc=>doc.path===path)?.sourceUrl)).size;
      docs.append(el("span",{"data-source-group":"local",text:`本地 ${docCount-webCount}`}),el("span",{"data-source-group":"web",text:`网页 ${webCount}`}));
      const canvas=store.canvases.find(item=>item.studySetId===set.id&&item.kind!=="review");
      const map=el("div",{class:"ms-study-home-cover-map","data-cover-mindmap":"true"});map.append(el("span",{text:"脑图"}),el("strong",{text:canvas?.name??"暂无脑图"}));
      const firstNode=canvas&&store.nodes.find(node=>node.canvasId===canvas.id&&!node.hidden);if(firstNode)map.append(el("span",{class:"ms-study-home-preview",text:firstNode.title}));
      cover.append(docs,map);card.append(cover);
      const group=el("div",{class:"ms-study-home-item"});
      const row=el("button",{class:"ms-native-menu-row"+(set.id===store.activeStudySetId?" is-active":""),text:set.name});
      row.addEventListener("click",()=>{
        const current=store.canvases.find(canvas=>canvas.id===store.activeCanvasId&&canvas.studySetId===set.id&&canvas.kind!=="review");
        if(set.id!==store.activeStudySetId||!current)store.setActiveStudySet(set.id);
        this.dismissPopup();this.refresh(true);this.saveLayout();
      });group.append(row);
      row.addEventListener("contextmenu",event=>{event.preventDefault();event.stopPropagation();openConfirm("移除学习集",`移除「${set.name}」及其脑图？关联卡片内容会保留。`,()=>{store.removeStudySet(set.id);this.dismissPopup();this.refresh(true);this.saveLayout();},"移除学习集");});
      const pin=el("button",{type:"button",class:"ms-study-home-pin","aria-label":`${set.pinned?"取消置顶":"置顶"}学习集：${set.name}`,"aria-pressed":String(!!set.pinned),text:set.pinned?"★":"☆"}) as HTMLButtonElement;
      pin.addEventListener("click",()=>{store.updateStudySet(set.id,{pinned:!set.pinned});this.openStudyMenu();});group.append(pin);
      const members=el("button",{type:"button",class:"ms-study-home-members","aria-label":`管理文档：${set.name}`,text:"文档"});members.addEventListener("click",()=>{this.dismissPopup();editDocuments(this.plugin,set.id,()=>this.refresh(true));});group.append(members);
      const category=el("input",{type:"text",class:"ms-study-home-category","data-home-category-for":set.id,"aria-label":`学习集分类：${set.name}`,placeholder:"分类"}) as HTMLInputElement;category.value=set.category??"";
      category.addEventListener("change",()=>{const old=set.category;store.updateStudySet(set.id,{category:category.value.trim()||undefined});if(old&&store.settings.studyHomeCategory===old&&!store.studySets.some(item=>item.category===old)){store.settings.studyHomeCategory="";store.save();}this.openStudyMenu();});group.append(category);card.append(group);target.append(card);
    };
    for(const set of sorted.filter(set=>set.pinned&&matches(set)))drawSet(set,pinned);
    for(const set of sorted.filter(matches))drawSet(set,all);
    const due=store.reviewDeckForStudySet();const count=due?store.reviewDeckSummary(due.id).due:0;
    const reviewButton=el("button",{class:"ms-native-menu-row",text:`当前学习集今日待复习 ${count}`,"aria-label":"打开今日复习"});reviewButton.addEventListener("click",()=>{this.dismissPopup();this.selectAuxiliary("review");});review.append(reviewButton);
    for(const deck of store.reviewDecks){const dueCount=store.reviewDeckSummary(deck.id).due;const entry=el("button",{class:"ms-native-menu-row",text:`${deck.name}（待复习 ${dueCount}）`,"aria-label":`打开卡组：${deck.name}`});entry.addEventListener("click",()=>{this.dismissPopup();openReviewDeckBrowser(this.plugin,deck.id);});review.append(entry);}
    const decks=el("button",{class:"ms-native-menu-row",text:`管理卡组（${store.reviewDecks.length}）`,"aria-label":"管理首页卡组"});decks.addEventListener("click",()=>{this.dismissPopup();openReviewDecks(this.plugin);});review.append(decks);
    const libraryPaths=[...new Set([...this.app.vault.getFiles().filter(file=>supported(file)&&!file.path.startsWith("MarginStudyBackups/")).map(file=>file.path),...store.documents.map(doc=>doc.path)])].sort((a,b)=>a.localeCompare(b,"zh-CN"));
    for(const [kind,title] of [["local","本地文档"],["web","网页来源"]] as const){const paths=libraryPaths.filter(path=>!!store.documents.find(doc=>doc.path===path)?.sourceUrl===(kind==="web"));const node=el("div",{"data-library-source":kind,class:"ms-study-home-library"});node.append(el("h4",{text:`${title}（${paths.length}）`}));for(const path of paths){const file=this.app.vault.getAbstractFileByPath(path),item=el("button",{class:"ms-native-menu-row",text:path.split('/').pop()??path,"aria-label":`打开资料：${path}`}) as HTMLButtonElement;item.disabled=!(file instanceof TFile);item.addEventListener("click",()=>{if(file instanceof TFile){this.dismissPopup();void this.openFile(file);}});node.append(item);}library.append(node);}
    const create=el("button",{class:"ms-native-menu-row",text:"＋ 新建学习集"});
    create.addEventListener("click",()=>this.openNewStudySet());
    const open=el("button",{class:"ms-native-menu-row",text:"打开文档…"});open.addEventListener("click",()=>{this.dismissPopup();this.chooseDocument();});
    const notebook=el("button",{class:"ms-native-menu-row",text:"新建空白笔记本…"});notebook.addEventListener("click",()=>{this.dismissPopup();openNewNotebook(this.plugin);});
    pane.append(create,open,notebook);
    const sourceUrl=store.documents.find(doc=>doc.path===this.state.activePath)?.sourceUrl;
    if(sourceUrl){
      const source=el("button",{class:"ms-native-menu-row",text:"打开来源网页","aria-label":"打开来源网页"});
      source.addEventListener("click",()=>{this.dismissPopup();this.selectAuxiliary("research");this.research?.navigate(sourceUrl);this.saveLayout();});pane.append(source);
    }
    const reader=this.reader;
    if(reader instanceof ReaderView&&reader.getPdfPageEdits()){
      const path=reader.getFilePath(),exportDocument=el("button",{class:"ms-native-menu-row",text:"Export Document…","aria-label":"Export Document"});
      exportDocument.addEventListener("click",()=>{this.dismissPopup();if(this.reader===reader&&reader.getFilePath()===path)reader.openPdfExport();});pane.append(exportDocument);
    }
    if(homeScreen)this.enhanceStudyHome(pane);
  }
  private openNewStudySet(): void {
    this.dismissPopup();
    const paths=this.state.tabs.map(tab=>tab.path),{modal,close}=createModal("新建学习集");
    modal.setAttribute("role","dialog");modal.setAttribute("aria-label","新建学习集");
    const form=el("form",{class:"ms-workspace-new-study"});
    const name=el("input",{type:"text","aria-label":"学习集名称",placeholder:"学习集名称"});
    const include=el("input",{type:"checkbox","aria-label":"包含当前打开的文档"});include.disabled=!paths.length;
    const choice=el("label",{class:"ms-workspace-study-choice"});choice.append(include,el("span",{text:`包含当前打开的 ${paths.length} 份文档`}));
    const cancel=el("button",{type:"button",class:"ms-btn",text:"取消"});cancel.addEventListener("click",close);
    const submit=el("button",{type:"submit",class:"ms-btn primary",text:"创建学习集"});
    const actions=el("div",{class:"ms-modal-actions"});actions.append(cancel,submit);
    form.addEventListener("submit",event=>{
      event.preventDefault();
      if(!name.value.trim()){name.setAttribute("aria-invalid","true");name.focus();return;}
      this.plugin.store.createStudySet(name.value.trim(),include.checked?paths:[]);
      close();this.refresh(true);this.saveLayout();
    });
    name.addEventListener("input",()=>name.removeAttribute("aria-invalid"));
    form.append(name,choice,el("p",{class:"ms-muted",text:"默认创建空学习集。当前阅读标签仍可使用，勾选后会将这些文档加入新学习集。"}),actions);
    modal.append(form);name.focus();
  }
  private useReaderTool(mode:string): void {
    if(!this.reader){this.chooseDocument();return;}
    const scene=this.plugin.store.getStudyScene(this.plugin.store.activeStudySetId??"");
    this.reader.setAutomaticTextExcerpt(mode==="text"&&scene?.interfaceMode==="scenes"&&(scene.sceneId==="excerpt"||scene.sceneId==="writing"));
    if(this.reader instanceof ReaderView)this.reader.setContinuousExcerptPen(mode);
    this.reader.setBlockSelectionMode(false);
    const controls=this.reader.getReaderToolbar();
    if (this.reader instanceof ReaderView) this.reader.stopExtend();
    if(mode==="text"||mode==="hand"||mode==="extend") {
      this.reader.setHandwritingMode("off");
      this.reader.setRegionMode(false);
      for(const active of controls.querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]'))
        if(/手写画笔|手写橡皮|手写套索|区域摘录/.test(active.getAttribute("aria-label")??""))active.click();
    } else if(mode==="pen") {this.reader.setHandwritingMode(this.reader.getHandwritingMode()==="pen"?"off":"pen");mode=this.reader.getHandwritingMode()==="off"?"text":"pen";}
    else if(mode==="region") {this.reader.setHandwritingMode("off");this.reader.setRegionMode(true);}
    if (mode === "extend") { if (!(this.reader instanceof ReaderView) || !this.reader.getPdfPageEdits()) { new Notice("请先打开 PDF 后添加留白"); return; } this.reader.beginExtend(); }
    this.readerTool=mode;this.drawToolbar();
  }
  private readerAction(label:string): void {
    if(!this.reader){this.chooseDocument();return;}
    const control=[...this.reader.getReaderToolbar().querySelectorAll<HTMLButtonElement>("button")].find(button=>button.getAttribute("aria-label")===label||button.title===label);
    if(control&&!control.disabled)control.click();
  }
  private openSpeechControls(): void {
    this.closeSpeechDialog?.();
    const reader=this.reader,control=reader?.getReaderToolbar().querySelector<HTMLElement>('.ms-speech-controls');
    if(!reader||!control){new Notice("当前文档不支持朗读");return;}
    const anchor=control.ownerDocument.createComment("speech toolbar location");control.before(anchor);
    const {modal,close}=createModal("Speech",()=>{
      control.querySelector<HTMLButtonElement>('[aria-label="停止朗读"]')?.click();
      if(anchor.parentNode)anchor.replaceWith(control);else control.remove();
      this.closeSpeechDialog=null;
    },this.root.ownerDocument);
    this.closeSpeechDialog=close;modal.setAttribute("role","dialog");modal.setAttribute("aria-label","文档朗读");
    control.style.flexWrap="wrap";
    const dismiss=el("button",{text:"关闭","aria-label":"关闭朗读"});dismiss.addEventListener("click",close);modal.append(control,dismiss);
  }
  private openReaderSearch(): void {
    if(!this.reader){this.chooseDocument();return;}
    if(this.reader instanceof ReaderView){this.reader.openSearch();return;}
    this.openReaderTools("search");
  }
  private openReaderTools(kind:"all"|"annotation"|"document"|"search"="all"): void {
    if(!this.reader){this.chooseDocument();return;}
    const pane=this.popover(kind==="annotation"?"Excerpt & Handwriting":kind==="search"?"Search":"Document");
    const list=el("div",{class:"ms-native-reader-actions"});pane.append(list);
    const source=this.reader.getReaderToolbar();
    for(const control of source.querySelectorAll<HTMLButtonElement|HTMLSelectElement|HTMLInputElement>("button,select,input")){
      const name=control.getAttribute("aria-label")||control.title||control.textContent?.trim()||"";if(!name)continue;
      const isAnnotation=/手写|标注|摘录|笔记本|图层|纸张|朗读|语音/.test(name),isSearch=/查找|搜索|结果/.test(name);
      if(kind==="annotation"&&!isAnnotation||kind==="document"&&(isAnnotation||isSearch)||kind==="search"&&!isSearch)continue;
      if(control instanceof HTMLButtonElement){
        const button=el("button",{class:"ms-native-menu-row",text:name,"aria-label":name});button.disabled=control.disabled;
        if(control.classList.contains("ms-swatch")){button.classList.add("ms-native-color-choice");button.style.setProperty("--swatch",control.style.background);}
        button.addEventListener("click",()=>{control.click();this.dismissPopup();});list.append(button);
      }else{
        const label=el("label",{class:"ms-native-control-row",text:name});const input=control.cloneNode(true) as HTMLSelectElement|HTMLInputElement;input.value=control.value;
        for(const event of ["input","change"])input.addEventListener(event,()=>{control.value=input.value;control.dispatchEvent(new Event(event,{bubbles:true}));});label.append(input);list.append(label);
      }
    }
    if(kind==="annotation"){
      const settings=el("button",{class:"ms-native-menu-row",text:"Handwriting Settings…","aria-label":"手写设置"});settings.addEventListener("click",()=>{this.dismissPopup();this.reader?.openHandwritingSettings();});list.append(settings);
    }
    if(!list.childElementCount)list.append(el("p",{class:"ms-muted",text:"此类文档没有可用的相关工具。"}));
  }
  private readerLayersButton(): HTMLElement {
    const button=this.toolbarButton("layers","文档笔记本",()=>this.reader?.openDocumentNotebooks());button.classList.add("ms-native-reader-layers");return button;
  }
  private cycleLinkMode(): void {
    if (!this.state.reader || !this.state.mindmap) return;
    const modes: LinkMode[] = ["both", "document", "mindmap", "off"];
    this.state.linkMode = modes[(modes.indexOf(this.state.linkMode) + 1) % modes.length];
    this.renderer?.clearTemporaryReveal();
    this.layoutChanged();
    new Notice(this.linkModeLabel(), 1200);
  }
  private linkModeLabel(): string {
    return {both:"Two-way Sync", document:"Doc → Mind Map", mindmap:"Mind Map → Doc", off:"Sync Off"}[this.state.linkMode];
  }
  private drawTabs(): void {
    if (!this.tabBar) return; this.tabBar.replaceChildren();
    this.tabBar.append(this.toolbarButton("panel-left", "选择文档与笔记本", () => { this.state.library=!this.state.library;this.layoutChanged(); }));
    const strip = el("div", { class: "ms-workspace-tab-strip", role: "presentation" });
    this.tabBar.append(strip);
    let visible = this.state.tabs.slice(0, this.state.tabLimit);
    const current = this.state.tabs.find(tab => tab.path === this.state.activePath);
    if (current && !visible.includes(current)) visible = [...visible.slice(0, Math.max(0,this.state.tabLimit - 1)),current];
    for (const tab of visible) {
      const item = el("div", { class: "ms-workspace-tab" + (tab.path === this.state.activePath ? " is-active" : ""), draggable: "true", "data-path": tab.path });
      const open = el("button", { role: "tab", "aria-selected": String(tab.path === this.state.activePath), title: tab.path, text: (tab.path.split("/").pop() ?? tab.path).replace(/\.[^.]+$/, "") });
      open.addEventListener("click", () => this.openPath(tab.path));
      const close = this.toolbarButton("x", "关闭文档标签：" + (tab.path.split("/").pop() ?? ""), () => { void this.closeTab(tab.path); });
      item.append(open, close);
      const relation = this.toolbarButton("chevron-down", "文档附件：" + tab.path, () => {
        const store = this.plugin.store, set = store.studySets.find(s => s.id === store.activeStudySetId);
        if (!set) { new Notice("请先选择学习集"); return; }
        const menu = new Menu();
        const parents = Object.entries(set.documentAttachments ?? {}).filter(([, paths]) => paths.includes(tab.path));
        for (const [parent] of parents) menu.addItem(entry => entry.setTitle("从 " + parent + " 取下附件").onClick(() => {
          const links = { ...(set.documentAttachments ?? {}) }; links[parent] = (links[parent] ?? []).filter(path => path !== tab.path); if (!links[parent].length) delete links[parent]; store.updateStudySet(set.id, { documentAttachments: links }); this.drawTabs();
        }));
        for (const parent of set.docPaths.filter(path => path !== tab.path && !parents.some(([existing]) => existing === path))) menu.addItem(entry => entry.setTitle("夹到 " + parent).onClick(() => {
          const links = { ...(set.documentAttachments ?? {}) }; for (const key of Object.keys(links)) { links[key] = links[key].filter(path => path !== tab.path); if (!links[key].length) delete links[key]; } links[parent] = [...(links[parent] ?? []), tab.path]; store.updateStudySet(set.id, { documentAttachments: links }); this.drawTabs();
        }));
        menu.showAtMouseEvent(new MouseEvent("click", { clientX: relation.getBoundingClientRect().left, clientY: relation.getBoundingClientRect().bottom }));
      });
      item.append(relation);
      item.addEventListener("dragstart", event => { event.dataTransfer?.setData("application/x-marginstudy-tab",tab.path); });
      item.addEventListener("dragover", event => { if (event.dataTransfer?.types.includes("application/x-marginstudy-tab")) event.preventDefault(); });
      item.addEventListener("drop", event => {
        const from = event.dataTransfer?.getData("application/x-marginstudy-tab"); if (!from || from === tab.path) return;
        event.preventDefault(); const old = this.state.tabs.findIndex(item => item.path === from), target = this.state.tabs.indexOf(tab);
        if (old < 0 || target < 0) return; this.state.tabs.splice(target,0,this.state.tabs.splice(old,1)[0]); this.drawTabs(); this.saveLayout();
      }); strip.append(item);
    }
    const set = this.plugin.store.studySets.find(item => item.id === this.plugin.store.activeStudySetId);
    for (const path of set?.documentAttachments?.[this.state.activePath ?? ""] ?? []) {
      const attachment = this.toolbarButton("paperclip", "附件：" + path, () => { void this.openPath(path); });
      const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) attachment.setAttribute("disabled", "");
      this.tabBar.append(attachment);
    }
    this.tabBar.append(this.toolbarButton("chevrons-up-down", "管理文档标签", () => this.manageTabs()), this.toolbarButton("plus", "打开或添加文档", () => this.chooseDocument()));
    this.drawReaderAttachmentCapsule();
    this.revealActiveTab();
  }
  private drawReaderAttachmentCapsule():void {
    const existing=this.readerPane?.querySelector<HTMLButtonElement>(".ms-workspace-attachment-capsule");existing?.remove();
    if(!this.readerPane||!this.root.classList.contains("has-scene-header"))return;
    const set=this.plugin.store.studySets.find(item=>item.id===this.plugin.store.activeStudySetId),paths=set?.documentAttachments?.[this.state.activePath??""]??[];
    if(!paths.length)return;
    const path=paths[0],button=this.toolbarButton("paperclip","附件 · "+(path.split("/").pop()??path),()=>{void this.openPath(path);});
    button.classList.add("ms-workspace-attachment-capsule");button.title=path;this.readerPane.append(button);
  }
  private revealActiveTab(): void {
    const strip = this.tabBar?.querySelector<HTMLElement>(".ms-workspace-tab-strip");
    const active = strip?.querySelector<HTMLElement>(".ms-workspace-tab.is-active");
    if (!strip || !active || strip.clientWidth <= 0) return;
    const viewport = strip.getBoundingClientRect(), tab = active.getBoundingClientRect();
    if (tab.left < viewport.left || tab.width > viewport.width) strip.scrollLeft += tab.left - viewport.left;
    else if (tab.right > viewport.right) strip.scrollLeft += tab.right - viewport.right;
  }
  private async closeTab(path: string): Promise<void> {
    await this.openChain.catch(() => {}); this.captureReader();
    const index = this.state.tabs.findIndex(tab => tab.path === path); if (index < 0) return;
    this.state.tabs.splice(index,1);
    if (path === this.state.activePath) {
      await this.releaseReader(); this.state.activePath = undefined;
      const next = this.state.tabs[Math.min(index,this.state.tabs.length-1)];
      if (next) await this.openPath(next.path); else this.showEmptyReader();
    }
    this.drawTabs(); this.drawLibrary(); this.saveLayout();
  }
  private async openPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) { new Notice("文档不存在：" + path); return; }
    try { await this.openFile(file); } catch(error) { new Notice("打开文档失败：" + String(error)); }
  }
  private documents(): TFile[] {
    const set = this.plugin.store.studySets.find(set => set.id === this.plugin.store.activeStudySetId);
    const paths = set?.docPaths ?? this.plugin.store.documents.map(doc => doc.path);
    return paths.map(path => this.app.vault.getAbstractFileByPath(path)).filter((file): file is TFile => file instanceof TFile && supported(file));
  }
  private drawLibrary(): void {
    if (!this.libraryList) return; this.libraryList.replaceChildren();
    const store=this.plugin.store,set=store.studySets.find(item=>item.id===store.activeStudySetId);
    const current=el("button",{type:"button",class:"ms-workspace-study-name",text:set?.name??"选择学习集","aria-label":set?`当前学习集：${set.name}`:"选择学习集"});
    current.addEventListener("click",()=>this.openStudyMenu());this.libraryList.append(current);
    if(set){
      const maps=el("div",{class:"ms-workspace-library-group"});
      maps.append(el("strong",{text:"MindMaps"}),this.toolbarButton("plus","新建脑图",()=>openTextModal({title:"新建脑图",initial:"新脑图",onOk:name=>{
        if(!name.trim()||!store.studySets.some(item=>item.id===set.id))return;
        store.setActiveCanvas(store.createCanvas(set.id,name.trim()).id);this.refresh(true);this.saveLayout();
      }})));this.libraryList.append(maps);
      for(const canvas of store.canvases.filter(item=>item.studySetId===set.id&&item.kind!=="review")){
        const row=el("button",{type:"button",class:"ms-workspace-canvas","aria-label":`打开脑图：${canvas.name}`,"aria-current":String(canvas.id===store.activeCanvasId)});
        row.append(el("span",{class:"ms-workspace-file-name",text:canvas.name}));
        row.addEventListener("click",()=>{if(store.activeCanvasId!==canvas.id)store.setActiveCanvas(canvas.id);this.refresh(true);this.saveLayout();});this.libraryList.append(row);
      }
    }
    const documents=el("div",{class:"ms-workspace-library-group"});
    documents.append(el("strong",{text:"Documents"}),this.toolbarButton("plus","添加学习集文档",()=>this.chooseDocument()));this.libraryList.append(documents);
    const files = this.documents().filter(file => file.path.toLocaleLowerCase().includes(this.libraryQuery.toLocaleLowerCase()));
    for (const file of files) {
      const row = el("button", { class: "ms-workspace-document" + (file.path === this.state.activePath ? " is-active" : ""), title: file.path });
      const icon = el("span", { class: "ms-workspace-file-icon", text: file.extension.toUpperCase() });
      const text = el("span", { class: "ms-workspace-file-name", text: file.basename });
      row.append(icon,text); row.addEventListener("click", () => { void this.openPath(file.path); });
      row.addEventListener("contextmenu", event => {
        event.preventDefault(); const menu = new Menu();
        menu.addItem(item => item.setTitle("在文档标签中打开").onClick(() => { void this.openPath(file.path); }));
        const set = this.plugin.store.studySets.find(set => set.id === this.plugin.store.activeStudySetId);
        if (set) menu.addItem(item => item.setTitle("从此学习集移除文档").onClick(() => {
          this.plugin.store.updateStudySet(set.id,{docPaths:set.docPaths.filter(path => path !== file.path)}); this.refresh(true);
        }));
        menu.showAtMouseEvent(event);
      }); this.libraryList.append(row);
    }
    if (!files.length) this.libraryList.append(el("p", { class: "ms-workspace-library-empty", text: this.libraryQuery ? "没有匹配的文档" : "点击 + 添加学习资料" }));
  }
  private chooseDocument(): void {
    const {modal,close} = createModal("添加学习文档");
    const query = el("input", { type: "search", class: "ms-search", placeholder: "按名称查找库内文档", "aria-label": "按名称查找库内文档" });
    const list = el("div", { class: "ms-workspace-file-picker" });
    const draw = () => {
      list.replaceChildren();
      const files = this.app.vault.getFiles().filter(supported).filter(file => file.path.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()));
      for (const file of files) {
        const button = el("button", { class: "ms-workspace-picker-row", text: file.path });
        button.addEventListener("click", () => { this.attachDocument(file); close(); void this.openPath(file.path); }); list.append(button);
      }
      if (!files.length) list.append(el("p", { text: "没有找到文档，可从电脑导入。" }));
    };
    const load = el("button", { class: "ms-btn", text: "从电脑导入文档" }); load.addEventListener("click", () => { close(); this.importFiles(); });
    query.addEventListener("input",draw); modal.append(query,list,load); draw(); query.focus();
  }
  private attachDocument(file: TFile): void {
    this.plugin.store.registerDocument(file.path);
    const set = this.plugin.store.studySets.find(set => set.id === this.plugin.store.activeStudySetId);
    if (set && !set.docPaths.includes(file.path)) this.plugin.store.updateStudySet(set.id,{docPaths:[...set.docPaths,file.path]});
  }
  private importFiles(): void {
    const input = el("input", { type: "file", multiple: "true", accept: ".pdf,.msref,.docx,.epub,.html,.htm,.md" });
    input.addEventListener("change", () => { if(input.files?.length) void this.importFileList([...input.files]); }); input.click();
  }
  private async importFileList(files: File[]): Promise<void> {
    let latest: TFile | undefined;
    try {
      const dir = "MarginStudyImports"; if (!await this.app.vault.adapter.exists(dir)) await this.app.vault.createFolder(dir);
      for (const input of files) {
        if (!/\.(pdf|msref|docx|epub|html?|md)$/i.test(input.name)) { new Notice("跳过不支持的文件：" + input.name); continue; }
        const name = input.name.replace(/[\\/:*?"<>|]/g,"_"), dot = name.lastIndexOf("."), stem = name.slice(0,dot), extension = name.slice(dot);
        let path = dir + "/" + name, count = 1;
        while (await this.app.vault.adapter.exists(path)) path = dir + "/" + stem + " (" + count++ + ")" + extension;
        latest = await this.app.vault.createBinary(path,await input.arrayBuffer()); this.attachDocument(latest);
      }
      this.refresh(true); if (latest) await this.openFile(latest);
    } catch(error) { new Notice("导入未完成：" + String(error),10000); }
  }
  private drawAuxiliary(): void {
    const kind=this.state.auxiliary;
    if(kind==="cards"&&this.auxiliaryKind===kind&&this.board){this.board.render();return;}
    if(kind==="research"&&this.auxiliaryKind===kind&&this.research)return;
    if(kind==="ai"&&this.auxiliaryKind===kind&&this.ai)return;
    if(this.research){this.state.researchUrl=this.research.currentUrl();this.state.researchSession=this.research.session();}
    this.research?.dispose();this.research=null;this.ai?.suspend();
    this.board?.dispose();this.board=null;this.auxiliary.replaceChildren();this.auxiliaryKind=kind;
    if(kind==="none")return;
    const close=()=>this.selectAuxiliary("none");
    if(kind==="research"){this.research=mountResearchBrowser(this.auxiliary,this.plugin,{initialUrl:this.state.researchUrl,session:this.state.researchSession,onSessionChanged:session=>{this.state.researchSession=session;this.state.researchUrl=session.entries[session.index];this.saveLayout();},selection:this.selection??undefined,selectionRoot:this.root,onClose:close,onNewWindow:url=>{void this.plugin.openResearchBrowser(url,true);},onPdfSaved:file=>{this.refresh(true);void this.openFile(file);}});return;}
    if(kind==="ai"){
      if(this.ai)this.ai.resume(this.auxiliary);
      else this.ai=mountAiPanel(this.auxiliary,this.plugin,{context:this.selectedContext(),getContext:()=>this.selectedContext(),onClose:close,onExternalView:()=>{if(this.focusedStage)this.toggleFocus();},onSaved:()=>this.refresh(true)});
      return;
    }
    if(kind==="cards"){
      this.board=new CardBoardRenderer(this.plugin,{nativeChrome:true,onChange:()=>this.refresh(true),onSelect:id=>{this.renderer?.revealCard(id);if(this.state.linkMode==="both"||this.state.linkMode==="mindmap"){const card=this.plugin.store.getCard(id);if(card)jumpToCardSource(this.plugin,card);}},onCreateMindmap:()=>this.refresh(true)});
      this.board.mount(this.auxiliary);const closeCards=this.toolbarButton("x","关闭卡片面板",close);closeCards.style.cssText="position:absolute;top:8px;right:8px;z-index:10;width:36px;height:36px;padding:5px!important;background:var(--background-primary,#fff)";this.auxiliary.style.position="relative";this.auxiliary.append(closeCards);return;
    }
    const store=this.plugin.store, selected=store.reviewDeckForStudySet()?.id??(!store.activeStudySetId?store.activeReviewDeckId:undefined);
    const deck=store.getReviewDeck(selected??"");
    const head=el("header",{class:"ms-native-deck-head"});
    const play=this.toolbarButton("play","浏览复习卡组",()=>{if(deck)openReviewDeckBrowser(this.plugin,deck.id,{presentation:"browse"});});play.disabled=!deck;
    const choose=el("button",{class:"ms-native-deck-name",text:(deck?.name??"Select Review Card Deck")+" ▾","aria-label":"选择复习卡组"});choose.addEventListener("click",()=>openReviewDecks(this.plugin));
    head.append(play,choose,this.toolbarButton("x","关闭复习面板",()=>this.selectAuxiliary("none")));this.auxiliary.append(head);
    const controls=el("div",{class:"ms-native-deck-controls"});
    const sort=el("button",{class:"ms-native-quiet",text:"Sort","aria-label":"复习卡片排序"});sort.addEventListener("click",()=>{this.deckFilter=!this.deckFilter;this.drawAuxiliary();});
    const count=deck?store.reviewDeckSummary(deck.id).due:0;
    const filter=this.toolbarButton("filter",`筛选到期复习卡片（${count}）`,()=>{this.deckFilter=!this.deckFilter;this.drawAuxiliary();},this.deckFilter);filter.prepend(el("span",{text:`(${count})`}));
    controls.append(sort,el("span",{class:"ms-workspace-spacer"}),filter);this.auxiliary.append(controls);
    if(this.deckFilter){const query=el("input",{type:"search",class:"ms-search ms-native-deck-search",placeholder:"Search Cards","aria-label":"筛选复习卡片"});query.value=this.deckQuery;query.addEventListener("input",()=>{this.deckQuery=query.value;draw();});this.auxiliary.append(query);}
    const list=el("div",{class:"ms-native-deck-list"});this.auxiliary.append(list);
    const draw=()=>{
      list.replaceChildren();if(!deck){const add=el("button",{class:"ms-native-add-deck",text:"＋ Add Review Card Deck"});add.addEventListener("click",()=>openReviewDecks(this.plugin));list.append(add);return;}
      const ids=new Set(store.pendingQuestionsForDeck(deck.id).map(question=>question.cardId));
      for(const id of deck.cardIds){const card=store.getCard(id);if(!card||!ids.has(id)||this.deckQuery&&![card.title,card.front,card.back,card.tags.join(" ")].join(" ").toLowerCase().includes(this.deckQuery.toLowerCase()))continue;
        const row=el("article",{class:"ms-native-list-card","data-review-card":id,tabindex:"0"});row.style.setProperty("--card-color",card.color??"#ffffad");
        if(card.title)row.append(el("strong",{text:card.title}));row.append(el("div",{text:card.front}));
        if(card.image)row.append(el("img",{src:imageUrl(this.plugin,card.image),alt:"卡片图片"}));
        row.addEventListener("dblclick",()=>openDetail(this.plugin,card,()=>this.refresh(true)));row.addEventListener("click",()=>this.renderer?.revealCard(id));
        row.append(this.toolbarButton("chevron-right","回到卡片原文",()=>jumpToCardSource(this.plugin,card)));list.append(row);
      }
    };draw();
    const footer=el("footer",{class:"ms-native-deck-footer"});
    const select=el("button",{class:"ms-native-quiet",text:"Select","aria-label":"选择复习卡片"});select.addEventListener("click",()=>{if(deck)openReviewDeckBrowser(this.plugin,deck.id);});
    footer.append(this.toolbarButton("list-filter","复习筛选与排序",()=>{this.deckFilter=!this.deckFilter;this.drawAuxiliary();}),select,el("span",{class:"ms-workspace-spacer"}),this.toolbarButton("ellipsis","管理复习卡组",()=>openReviewDecks(this.plugin)));this.auxiliary.append(footer);
  }
  private openLayoutMenu(): void {
    const pane = this.popover("Document - More"); pane.classList.add("ms-document-more");
    pane.querySelector(".ms-native-popover-head button")?.remove();
    const list = el("div", { class: "ms-document-more-list" }); pane.append(list);
    const reader = this.reader, path = reader?.getFilePath(), notebook = reader?.getDocumentNotebookId();
    const current = () => this.reader === reader && reader?.getFilePath() === path && reader?.getDocumentNotebookId() === notebook;
    const checks: Array<() => void> = [];
    const syncChecks = () => { if (current()) checks.forEach(sync => sync()); };
    const row = (text: string, icon: string, callback: () => void | Promise<void>, disabled = false, checked?: () => boolean) => {
      const button = el("button", { class: "ms-document-more-row", text, "aria-label": text });
      const glyph = el("span", { class: "ms-document-more-icon", "aria-hidden": "true" }); setNativeIcon(glyph, icon); button.prepend(glyph); button.disabled = disabled;
      if (checked) {
        button.setAttribute("role", "checkbox"); button.setAttribute("aria-checked", String(checked()));
        checks.push(() => button.setAttribute("aria-checked", String(checked())));
        button.append(el("span", { class: "ms-document-more-checkbox", "aria-hidden": "true", text: "✓" }));
      }
      button.addEventListener("click", async () => {
        if (!checked) this.dismissPopup();
        if (!current()) return;
        if (checked) button.disabled = true;
        try {
          await callback();
        } catch (error) {
          if (current()) new Notice("操作失败：" + String(error));
        } finally {
          if (checked && current()) {
            syncChecks();
            button.disabled = disabled;
          }
        }
      }); list.append(button);
    };
    for (const tab of documentNavigationTabs) {
      row(tab.label, tab.icon, () => this.toggleDocumentNavigation(tab.id), !reader);
    }
    list.append(el("div", { class: "ms-document-more-divider", role: "separator" }));
    const pdf = reader instanceof ReaderView ? reader : null;
    const page = Number((pdf?.getState().position as {page?: number} | undefined)?.page ?? 1);
    if (pdf) {
      const bookmarked = pdf.isPageBookmarked(page);
      row(bookmarked ? "Remove Bookmark" : "Add Bookmark", "bookmark", () => pdf.setPageBookmarked(page, !bookmarked));
      if (pdf.getPdfPageEdits()) row("Edit PDF Pages", "file-pen", () => pdf.openPdfPageEditor());
      row("Crop", "crop", () => { void pdf.openCrop().catch(error => new Notice("无法打开裁边：" + String(error))); });
      row("Go to Page", "file-input", () => this.openPageJump(pdf));
    }
    row("Document Notebooks", "layers", () => reader?.openDocumentNotebooks(), !reader);
    row("Card Grouping Board", "panels-top-left", () => this.selectAuxiliary("cards"), !reader);
    const divider = el("div", { class: "ms-document-more-divider", role: "separator" }); list.append(divider);
    if (pdf?.getPdfPageEdits()) {
      const row = el("div", {class:"ms-document-more-extend"});
      const glyph = el("span",{class:"ms-document-more-icon","aria-hidden":"true"});setNativeIcon(glyph,"between-horizontal-start");
      const choices = el("div",{class:"ms-reading-segments",role:"group","aria-label":"Extend"});
      row.append(glyph,el("span",{text:"Extend"}),choices);list.append(row);
      for (const [mode,label] of [["normal","Normal"],["margin","Margin"],["collapse","Collapse"]] as const) {
        const button = el("button",{text:label,"aria-label":label,"aria-pressed":String(pdf.getExtendMode()===mode)});
        button.addEventListener("click",async()=>{
          if(!current())return;choices.querySelectorAll<HTMLButtonElement>("button").forEach(node=>node.disabled=true);
          try { await pdf.setExtendMode(mode);if(current()){choices.querySelectorAll<HTMLButtonElement>("button").forEach(node=>node.setAttribute("aria-pressed",String(node===button)));syncChecks();} }
          catch(error){if(current())new Notice("切换留白失败："+String(error));}
          finally{if(current())choices.querySelectorAll<HTMLButtonElement>("button").forEach(node=>node.disabled=false);}
        });choices.append(button);
      }
    }
    if(pdf?.getPdfPageEdits())row("Margin Comment Area","panel-right",()=>pdf.setMarginCommentArea(!pdf.getMarginCommentArea()),false,()=>pdf.getMarginCommentArea());
    row("Audio & Video", "music", () => this.readerAction("添加音视频"), !reader);
    row("录制语音批注", "mic", () => this.readerAction("语音批注"), !reader?.getReaderToolbar().querySelector('[aria-label="语音批注"]'));
    row("朗读控制", "volume-2", () => this.openSpeechControls(), !reader);
    row("Read Settings", "type", () => this.openReadSettings(), !reader);
    row("Show Document Tabs", "panel-top", () => { this.state.showTabs = !this.state.showTabs; this.layoutChanged(); }, false, () => this.state.showTabs);
    this.anchorDocumentPopup(pane);
  }
  private getReadingTheme(): ReadingTheme {
    const saved = this.plugin.store.settings.readingTheme;
    return readingThemes.some(theme => theme.id === saved) ? saved! : "white";
  }
  private applyReadingTheme(): void {
    if (this.root) this.root.dataset.readingTheme = this.getReadingTheme();
  }
  private setReadingTheme(theme: ReadingTheme): void {
    this.plugin.store.settings.readingTheme = theme; this.applyReadingTheme(); this.plugin.store.save();
  }
  private openReadSettings(): void {
    const pane = this.popover("Read Settings"); pane.classList.add("ms-read-settings");
    pane.querySelector(".ms-native-popover-head")?.remove();
    const reader = this.reader, path = reader?.getFilePath(), notebook = reader?.getDocumentNotebookId();
    const current = () => this.reader === reader && reader?.getFilePath() === path && reader?.getDocumentNotebookId() === notebook;
    const group = (label: string) => {
      const section = el("section", {class:"ms-reading-setting-group"}); section.append(el("h3",{text:label}));
      const choices = el("div",{class:"ms-reading-segments",role:"group","aria-label":label});section.append(choices);pane.append(section);return choices;
    };
    const pages = group("Turn Document Page"), pdf = reader instanceof ReaderView ? reader : null;
    for (const [continuous,label] of [[false,"Horizontal Flip"],[true,"Vertical Scroll"]] as const) {
      const button = el("button", {text:label,"aria-label":label,"aria-pressed":String(pdf?.getPageLayout().continuous === continuous)});
      button.disabled = !pdf;
      button.addEventListener("click", async () => {
        if (!pdf || !current()) return;
        pages.querySelectorAll<HTMLButtonElement>("button").forEach(node => node.disabled = true);
        try {
          await pdf.setPageLayout(pdf.getPageLayout().layout, continuous);
          if (current()) { this.saveLayout(); pages.querySelectorAll<HTMLButtonElement>("button").forEach(node => node.setAttribute("aria-pressed",String(node === button))); }
        } catch (error) { if (current()) new Notice("切换翻页方式失败：" + String(error)); }
        finally { if (current()) pages.querySelectorAll<HTMLButtonElement>("button").forEach(node => node.disabled = false); }
      });pages.append(button);
    }
    const themes = group("Theme");
    for (const theme of readingThemes) {
      const button = el("button", {text:theme.label,"aria-label":theme.label,"aria-pressed":String(this.getReadingTheme() === theme.id)});
      button.addEventListener("click", () => { if (current()) { this.setReadingTheme(theme.id); this.dismissPopup(); } });themes.append(button);
    }
    const more = el("button",{class:"ms-reading-more",text:"More Settings","aria-label":"More Settings"});
    more.addEventListener("click",()=>{if(current())this.openReadingPreferences();});pane.append(more);
    this.anchorDocumentPopup(pane,350);
  }
  private openReadingPreferences(): void {
    const pane = this.popover("Settings"); pane.classList.add("ms-reading-preferences");
    pane.querySelector(".ms-native-popover-head")?.remove();
    const close = el("button",{text:"Close","aria-label":"Close"});close.addEventListener("click",()=>this.dismissPopup());
    const head = el("header",{class:"ms-reading-preferences-head"}), title = el("div");
    title.append(close,el("strong",{text:"Settings"}));head.append(title,el("strong",{text:"UI Theme"}));
    const body = el("div",{class:"ms-reading-preferences-body"}), sidebar = el("nav",{"aria-label":"设置类别"});
    const content = el("section",{class:"ms-reading-theme-preferences","aria-label":"UI Theme"});
    const categories: HTMLButtonElement[]=[];
    const show=(name:string)=>{
      content.replaceChildren();content.setAttribute("aria-label",name);head.lastElementChild!.textContent=name;
      categories.forEach(button=>button.setAttribute("aria-pressed",String(button.textContent===name)));
      const heading=(text:string)=>content.append(el("h3",{text}));
      const toggle=(label:string,key:"showFootnotesLinksOnMargin"|"hideMarginNumbers"|"tapPageEdges"|"assistiveExcerpt"|"excerptPopup"|"excerptLockColors"|"excerptAutoExpandRect"|"autoCardOnHighlight"|"autoCardOnRegion"|"appleOcrEngine"|"ocrSelectionCorrection")=>{
        const row=el("label",{class:"ms-reading-preference-row"}),input=el("input",{type:"checkbox","aria-label":label});input.checked=!!this.plugin.store.settings[key];
        input.addEventListener("change",()=>{this.plugin.store.settings[key]=input.checked;this.plugin.store.save();if(key==="appleOcrEngine"&&this.reader instanceof ReaderView)this.reader.refreshOcr();});row.append(el("span",{text:label}),input);content.append(row);
      };
      if(name==="Card Style"){
        const fontLabel="Card font - (Title & Highlight & Comments)",row=el("label",{class:"ms-reading-preference-row"}),font=el("select",{"aria-label":fontLabel});
        for(const face of ["Helvetica","Georgia","Courier New"])font.append(el("option",{text:face,value:face}));
        font.value=this.plugin.store.settings.cardFontFamily??"Helvetica";
        font.addEventListener("change",()=>{this.plugin.store.settings.cardFontFamily=font.value as "Helvetica"|"Georgia"|"Courier New";this.plugin.store.save();});row.append(el("span",{text:fontLabel}),font);content.append(row);
        const upperRow=el("label",{class:"ms-reading-preference-row"}),upper=el("input",{type:"checkbox","aria-label":"Title uppercase"});upper.checked=!!this.plugin.store.settings.cardTitleUppercase;
        upper.addEventListener("change",()=>{this.plugin.store.settings.cardTitleUppercase=upper.checked;this.plugin.store.save();});upperRow.append(el("span",{text:"Title uppercase"}),upper);content.append(upperRow);
        const sizeRow=el("label",{class:"ms-reading-preference-row"}),size=el("input",{type:"number",min:"12",max:"32",step:"1","aria-label":"Base Font Size",value:String(this.plugin.store.settings.cardBaseFontSize??16)});
        size.addEventListener("change",()=>{const value=Number(size.value);if(!Number.isInteger(value)||value<12||value>32){size.value=String(this.plugin.store.settings.cardBaseFontSize??16);return;}this.plugin.store.settings.cardBaseFontSize=value;this.plugin.store.save();});sizeRow.append(el("span",{text:"Base Font Size"}),size);content.append(sizeRow);
      }else if(name==="Margin"){
        heading("Footnotes & Links");toggle("Show footnotes & links on margin","showFootnotesLinksOnMargin");toggle("Hide margin numbers on document","hideMarginNumbers");heading("Turning Pages");toggle("Tap Page Edges to Turn Pages (Legacy)","tapPageEdges");
      }else if(name==="OCR"){
        heading("OCR");toggle("Selection Correction","ocrSelectionCorrection");toggle("Apple OCR Engine","appleOcrEngine");
        const clear=el("button",{text:"Clear OCR Buffer","aria-label":"Clear OCR Buffer"});clear.addEventListener("click",()=>{clearOcrBuffer(this.app);if(this.reader instanceof ReaderView)this.reader.refreshOcr(true);new Notice("已清除 OCR 缓存");});content.append(clear);
      }else if(name==="Keyboard"){
        heading("Hide Accessory Bar");const row=el("label",{class:"ms-reading-preference-row"}),hide=el("input",{type:"checkbox","aria-label":"Hide Accessory Bar"});hide.checked=!!this.plugin.store.settings.hideKeyboardAccessoryBar;
        hide.addEventListener("change",()=>{this.plugin.store.settings.hideKeyboardAccessoryBar=hide.checked;this.plugin.store.save();});row.append(el("span",{text:"Hide Accessory Bar"}),hide);content.append(row);
      }else if(name==="UI Theme"){
        heading("UI theme select");
        for(const theme of readingThemes){
          const row=el("button",{text:theme.label,"aria-label":theme.label,"aria-pressed":String(this.getReadingTheme()===theme.id)});row.append(el("span",{text:"✓","aria-hidden":"true"}));
          row.addEventListener("click",()=>{this.setReadingTheme(theme.id);content.querySelectorAll("button").forEach(button=>button.setAttribute("aria-pressed",String(button===row)));});content.append(row);
        }
      }else if(name==="Excerpt"){
        heading("Assistive Excerpt");toggle("Assistive Excerpt","assistiveExcerpt");
        heading("Highlight operation");toggle("Pop up menu after add excerpt","excerptPopup");toggle("Auto expand the rect selection horizontally","excerptAutoExpandRect");
        heading("Excerpt color shortcuts");
        const reset=el("button",{text:"Reset excerpt color shortcuts","aria-label":"Reset excerpt color shortcuts"});reset.addEventListener("click",()=>{
          this.plugin.store.settings.colors=["#ffd54f","#ff8a80","#80cbc4","#9fa8da","#ce93d8","#a5d6a7"];this.plugin.store.settings.defaultColor="#ffd54f";this.plugin.store.save();new Notice("已重置摘录颜色快捷栏");
        });content.append(reset);toggle("Lock excerpt color shortcuts","excerptLockColors");
        heading("摘录卡片");toggle("文字摘录自动成卡","autoCardOnHighlight");toggle("区域摘录自动成卡","autoCardOnRegion");
      }else if(name==="Handwriting"){
        heading("Document Handwriting");const open=el("button",{text:"Document Handwriting Settings…","aria-label":"Document Handwriting Settings"});open.disabled=!this.reader;
        open.addEventListener("click",()=>{this.dismissPopup();this.reader?.openHandwritingSettings();});content.append(open);
      }
    };
    sidebar.append(el("h3",{text:"UI Style"}));
    for(const name of ["Card Style","UI Theme","Handwriting","Keyboard","OCR","Margin","Excerpt"]){if(name==="OCR")sidebar.append(el("h3",{text:"Read & Excerpt"}));const button=el("button",{text:name,"aria-label":name});button.addEventListener("click",()=>show(name));categories.push(button);sidebar.append(button);}
    show("UI Theme");
    body.append(sidebar,content);pane.append(head,body);
  }
  private anchorDocumentPopup(pane: HTMLElement, preferredWidth = 320): void {
    const trigger = this.toolbar.querySelector<HTMLElement>('[aria-label="文档与工作区设置"]');
    if (!trigger) return;
    const root = this.root.getBoundingClientRect(), anchor = trigger.getBoundingClientRect();
    const width = Math.min(preferredWidth, Math.max(0, root.width - 24)), center = anchor.left + anchor.width / 2 - root.left;
    const left = clamp(center - width / 2, 12, Math.max(12, root.width - width - 12));
    const top = anchor.bottom - root.top + 12;
    pane.style.left = left + "px"; pane.style.top = top + "px"; pane.style.width = width + "px";
    pane.style.setProperty("--ms-document-menu-height", Math.max(70, root.height - top - 12) + "px");
    pane.style.setProperty("--ms-document-menu-arrow", clamp(center - left, 16, width - 16) + "px");
  }
  private openPageJump(reader: ReaderView): void {
    this.closePageDialog?.();
    const path = reader.getFilePath(), notebook = reader.getDocumentNotebookId();
    const { bg, modal, close } = createModal("Go to Page", () => { this.closePageDialog = null; });
    this.closePageDialog = close; bg.classList.add("ms-native-page-jump-bg"); modal.classList.add("ms-native-page-jump");
    modal.setAttribute("role", "dialog"); modal.setAttribute("aria-label", "Go to Page"); modal.setAttribute("aria-modal", "true");
    const input = el("input", { type: "text", inputmode: "numeric", "aria-label": "跳转到页码", autocomplete: "off" });
    const error = el("p", { class: "ms-native-page-jump-error", role: "status" }); error.hidden = true;
    const submit = () => {
      if (this.reader !== reader || reader.getFilePath() !== path || reader.getDocumentNotebookId() !== notebook) { close(); return; }
      const value = input.value.trim(), page = Number(value), total = reader.getDisplayPages().length;
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(page) || page < 1 || page > total) {
        input.setAttribute("aria-invalid", "true"); error.textContent = `请输入 1 至 ${total} 的页码`; error.hidden = false; input.focus(); return;
      }
      void reader.gotoDisplayPage(page); close();
    };
    input.addEventListener("input", () => { input.removeAttribute("aria-invalid"); error.hidden = true; });
    input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); submit(); } });
    const ok = el("button", { text: "OK", class: "ms-native-page-jump-ok" }); ok.addEventListener("click", submit);
    modal.append(input, error, ok); input.focus();
  }
  private openWorkspaceSettings(): void {
    const menu = new Menu();
    menu.addItem(item=>item.setTitle("阅读与批注的全部工具").onClick(()=>this.openReaderTools()));
    menu.addItem(item=>item.setTitle("文档笔记本…").onClick(()=>this.reader?.openDocumentNotebooks()));
    if(this.reader instanceof ReaderView)menu.addItem(item=>item.setTitle("书页重组…").onClick(()=>{if(this.reader instanceof ReaderView)this.reader.openPageReorganization();}));
    menu.addItem(item=>item.setTitle("新建空白笔记本…").onClick(()=>openNewNotebook(this.plugin)));
    menu.addItem(item=>item.setTitle("导入网页 / 微信文章…").onClick(()=>openWebImport(this.plugin)));
    for (const [value,label] of [["left","文档置于左侧"],["right","文档置于右侧"],["bottom","文档置于底部"]] as const)
      menu.addItem(item => item.setTitle((this.state.placement === value ? "✓ " : "") + label).onClick(() => { this.state.placement=value; this.layoutChanged(); }));
    menu.addItem(item => item.setTitle(this.state.showTabs ? "隐藏文档标签" : "显示文档标签").onClick(() => { this.state.showTabs=!this.state.showTabs; this.layoutChanged(); }));
    menu.addItem(item => item.setTitle("管理文档标签与数量").onClick(() => this.manageTabs()));
    menu.addItem(item => item.setTitle("恢复工作区布局").onClick(() => { this.state={...defaults(),tabs:this.state.tabs,activePath:this.state.activePath}; this.layoutChanged(); }));
    const bounds = this.toolbar.lastElementChild?.getBoundingClientRect();
    menu.showAtPosition({x:bounds?.left ?? 0,y:bounds?.bottom ?? 0});
  }
  private manageTabs(): void {
    const {modal} = createModal("管理文档标签");
    modal.append(el("p",{class:"ms-muted",text:"关闭标签只收起阅读页面。文档与笔记仍保留在学习集中。拖动顶部标签可调整顺序。"}));
    const label = el("label",{text:"最多显示标签数 "}), limit = el("input",{type:"number",min:"1",max:"30","aria-label":"最多显示标签数"});
    limit.value=String(this.state.tabLimit); limit.addEventListener("change",() => { this.state.tabLimit=clamp(Number(limit.value)||7,1,30); this.drawTabs(); this.saveLayout(); }); label.append(limit); modal.append(label);
    for(const tab of [...this.state.tabs]) {
      const row=el("div",{class:"ms-workspace-manage-tab"}), close=el("button",{class:"ms-btn",text:"关闭标签"});
      close.addEventListener("click",() => { void this.closeTab(tab.path); row.remove(); });
      row.append(el("span",{text:tab.path}),close); modal.append(row);
    }
  }
  private layoutChanged(): void { this.applyLayout(); this.refresh(true); this.saveLayout(); }
  private applyLayout(): void {
    if (!this.body) return;
    this.root.dataset.library=String(this.state.library); this.root.dataset.auxiliary=this.state.auxiliary;
    this.root.dataset.reader=String(this.state.reader); this.root.dataset.mindmap=String(this.state.mindmap);
    this.root.dataset.placement=this.state.placement; this.root.dataset.tabs=String(this.state.showTabs);
    const link=this.root.querySelector<HTMLElement>(".ms-native-divider-link");if(link){(link as HTMLButtonElement).disabled=!this.state.reader||!this.state.mindmap;link.title=this.linkModeLabel();link.setAttribute("aria-description",this.linkModeLabel());link.textContent=this.state.linkMode==="both"?"⇄":this.state.linkMode==="document"?"→":this.state.linkMode==="mindmap"?"←":"·";link.dataset.link=this.state.linkMode;}
    this.root.dataset.link=this.state.linkMode;
    this.root.style.setProperty("--ms-library-width",this.state.libraryWidth+"px");
    if(this.state.auxiliary!=="none")this.state.auxiliaryWidths[this.state.auxiliary]=this.state.auxiliaryWidth;
    this.root.style.setProperty("--ms-auxiliary-width",this.state.auxiliaryWidth+"px");
    this.root.style.setProperty("--ms-reader-ratio",String(this.state.ratio));
    this.root.style.setProperty("--ms-map-ratio",String(1-this.state.ratio));
  }
  private splitter(kind:"library"|"main"|"auxiliary"): HTMLElement {
    const node=el("div",{class:"ms-workspace-splitter ms-workspace-splitter-"+kind,role:"separator",tabindex:"0","aria-label":kind==="main"?"调整文档与脑图比例":kind==="library"?"调整文档列表宽度":"调整卡片面板宽度","aria-orientation":"vertical"});
    const adjust=(delta:number) => {
      if(kind==="library") this.state.libraryWidth=clamp(this.state.libraryWidth+delta,160,420);
      else if(kind==="auxiliary") this.state.auxiliaryWidth=clamp(this.state.auxiliaryWidth-delta,240,640);
      else this.state.ratio=clamp(this.state.ratio+delta,0.2,0.8);
      this.applyLayout();
    };
    if(kind==="main"){
      node.setAttribute("role","group");
      const link=el("button",{class:"ms-native-divider-link",text:"⇄","aria-label":"设置文档与脑图联动",title:"联动模式"});link.addEventListener("pointerdown",event=>event.stopPropagation());link.addEventListener("click",()=>this.cycleLinkMode());
      const visibility=el("div",{class:"ms-native-divider-visibility"});
      const hide=(icon:string,label:string,key:"reader"|"mindmap")=>{const b=this.toolbarButton(icon,label,()=>{this.state[key]=!this.state[key];if(!this.state.reader&&!this.state.mindmap)this.state[key==="reader"?"mindmap":"reader"]=true;this.layoutChanged();});b.addEventListener("pointerdown",event=>event.stopPropagation());return b;};
      visibility.append(hide("chevron-left","隐藏文档","reader"),el("span",{text:"·"}),hide("chevron-right","隐藏脑图","mindmap"));node.append(link,visibility);
    }
    node.addEventListener("keydown",event => {
      if(event.target!==node||!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) return;
      event.preventDefault(); const direction=event.key==="ArrowRight"||event.key==="ArrowDown"?1:-1;
      adjust(direction*(kind==="main"?0.025:10)); this.saveLayout();
    });
    node.addEventListener("pointerdown",event => {
      if(event.button!==0)return; event.preventDefault(); node.setPointerCapture(event.pointerId);
      const startX=event.clientX,startY=event.clientY,original=kind==="library"?this.state.libraryWidth:kind==="auxiliary"?this.state.auxiliaryWidth:this.state.ratio;
      const move=(next:PointerEvent) => {
        const vertical=kind==="main"&&(this.state.placement==="bottom"||getComputedStyle(this.body).flexDirection==="column"), reverse=kind==="main"&&this.state.placement!=="left";
        const size=vertical?this.readerPane.clientHeight+this.mapPane.clientHeight:this.readerPane.clientWidth+this.mapPane.clientWidth;
        const delta=(vertical?next.clientY-startY:next.clientX-startX)*(reverse?-1:1);
        if(kind==="main")this.state.ratio=clamp(original+delta/Math.max(1,size),0.2,0.8);
        else if(kind==="library")this.state.libraryWidth=clamp(original+delta,160,420);
        else this.state.auxiliaryWidth=clamp(original-delta,240,640);
        this.applyLayout();
      };
      const end=() => { node.removeEventListener("pointermove",move); node.removeEventListener("pointerup",end); node.removeEventListener("pointercancel",end); this.saveLayout(); };
      node.addEventListener("pointermove",move); node.addEventListener("pointerup",end); node.addEventListener("pointercancel",end);
    }); return node;
  }
  private saveLayout(): void {
    this.plugin.store.saveWorkspaceState(this.getState()); this.app.workspace.requestSaveLayout();
  }
}
