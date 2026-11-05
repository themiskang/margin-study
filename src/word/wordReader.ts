import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type MarginStudyPlugin from "../main";
import type { HandwritingPresetId, HandwritingPresetSpec, ReaderContentsEntry } from "../types";
import type { HandwritingMode } from "../annot/penGeometry";
import type { ReaderEditHistoryState } from "../annot/baseController";
import { HtmlAnnotationController, HtmlReader } from "./htmlAnnot";
import { el, clear } from "../utils/dom";
import * as mammoth from "mammoth";
import { ReadingSpeechControls, documentSpeechSections } from "../audio/speechControls";
import { ReadingPositionTracker } from "../documents/readingPosition";

export const VIEW_TYPE_WORD = "margin-study-word";

export class WordReaderView extends ItemView implements HtmlReader {
  plugin: MarginStudyPlugin;
  private filePath: string | null = null;
  private loadedPath: string | null = null;
  private loadRevision = 0;
  private pendingLoad: { path: string; promise: Promise<void> } | null = null;
  private scrollEl!: HTMLElement;
  private toolbarEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private ann!: HtmlAnnotationController;
  private destroyed = false;
  private recallCoverAll = true;
  private recallScopeEl: HTMLButtonElement | null = null;
  private speech: ReadingSpeechControls | null = null;
  private workspaceChrome = false;
  private reading = new ReadingPositionTracker();
  private saveTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: MarginStudyPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_WORD;
  }
  getDisplayText(): string {
    return this.filePath ? `📄 ${this.filePath.split("/").pop()}` : "MarginStudy 文档";
  }
  getIcon(): string {
    return "file-text";
  }
  getReaderToolbar(): HTMLElement { return this.toolbarEl; }
  setWorkspaceChrome(enabled: boolean): void {
    this.workspaceChrome = enabled;
    (this.containerEl.children[1] as HTMLElement | undefined)?.classList.toggle("ms-reader-native-chrome", enabled);
  }
  openHandwritingSettings(anchor?: HTMLElement): void { this.ann.openHandwritingSettings(anchor); }
  getTitleLinksEnabled(): boolean { return this.ann.getTitleLinksEnabled(); }
  setTitleLinksEnabled(on: boolean): void { this.ann.setTitleLinksEnabled(on); }
  getRecallMode(): boolean { return !!(this.containerEl.children[1] as HTMLElement | undefined)?.classList.contains("ms-recall"); }
  setRecallMode(on: boolean): void { this.ann.setRecallMode(on); }
  clearRecallReveals(): void { this.ann.clearRecallReveals(); }
  getRecallCoverAll(): boolean { return this.recallCoverAll; }
  setRecallCoverAll(on: boolean): void { this.recallCoverAll = on; this.ann.setRecallCoverAll(on); this.syncRecallScopeButton(); }
  getRecallHierarchy(): number { return this.ann.getRecallHierarchy(); }
  setRecallHierarchy(level: number): void { this.ann.setRecallHierarchy(level); }
  getRecallAiHint(): boolean { return this.ann.getRecallAiHint(); }
  setRecallAiHint(on: boolean): void { this.ann.setRecallAiHint(on); }
  getRecallHintLanguage(): "auto" | "zh" | "en" { return this.ann.getRecallHintLanguage(); }
  setRecallHintLanguage(language: "auto" | "zh" | "en"): void { this.ann.setRecallHintLanguage(language); }
  setRecallHintProvider(provider?: (request: import("../types").RecallHintRequest) => Promise<import("../types").RecallHintResult>): void { this.ann.setRecallHintProvider(provider); }
  getRecallSetting(key: import("../types").RecallOptionKey): boolean { return this.ann.getRecallSetting(key); }
  setRecallSetting(key: import("../types").RecallOptionKey, on: boolean): void { this.ann.setRecallSetting(key, on); }
  getHandwritingMode(): HandwritingMode { return this.ann.getHandwritingMode(); }
  getActiveHandwritingPreset(): HandwritingPresetId { return this.ann.getActiveHandwritingPreset(); }
  refreshSceneSettings(): void { this.ann.refreshSceneSettings();const tools=this.toolbarEl?.querySelector<HTMLElement>(".ms-tb-ann");if(tools)this.ann.buildToolbar(tools); }
  getHandwritingPreset(): HandwritingPresetSpec { return this.ann.getHandwritingPreset(); }
  openHandwritingPresets(anchor?: HTMLElement): void { this.ann.openHandwritingPresets(anchor); }
  setActiveHandwritingPreset(preset: HandwritingPresetId): void { this.ann.setActiveHandwritingPreset(preset); }
  getBlockSelectionMode():boolean { return this.ann.getBlockSelectionMode(); }
  setBlockSelectionMode(on:boolean):void { this.ann.setBlockSelectionMode(on); }
  setAutomaticTextExcerpt(on:boolean):void { this.ann.setAutomaticTextExcerpt(on); }
  setRegionMode(on:boolean):void { this.ann.setRegionMode(on); }
  setHandwritingMode(mode: HandwritingMode): void { this.ann.setHandwritingMode(mode); }
  subscribeHandwritingModeChange(listener: (mode: HandwritingMode) => void): () => void { return this.ann.subscribeHandwritingModeChange(listener); }
  getHandwritingSyncPreference(): boolean { return this.ann.getHandwritingSyncPreference(); }
  setHandwritingSyncAvailable(available: boolean): void { this.ann.setHandwritingSyncAvailable(available); }
  setHandwritingSyncPreference(enabled: boolean): void { this.ann.setHandwritingSyncPreference(enabled); }
  subscribeHandwritingSyncPreference(listener: (enabled: boolean) => void): () => void { return this.ann.subscribeHandwritingSyncPreference(listener); }
  openDocumentNotebooks(): void { this.ann.openDocumentNotebooks(); }
  selectDocumentNotebook(id: string): void { this.ann.selectDocumentNotebook(id); }
  createDocumentNotebook(name: string): boolean { return this.ann.createDocumentNotebook(name); }
  getDocumentNotebookId(): string { return this.ann.getDocumentNotebookId(); }
  beginTextAnnotation(): void { this.ann.beginTextAnnotation(); }
  insertImageAnnotation(file: File): Promise<void> { return this.ann.insertImageAnnotation(file); }
  undoOverlayChange(): void { this.ann.undoOverlayChange(); }
  redoOverlayChange(): void { this.ann.redoOverlayChange(); }
  getEditHistoryState(): ReaderEditHistoryState { return this.ann.getEditHistoryState(); }
  undoLastEdit(): void | Promise<void> { return this.ann.undoLastEdit(); }
  redoLastEdit(): void | Promise<void> { return this.ann.redoLastEdit(); }
  subscribeEditHistory(listener: (state: ReaderEditHistoryState) => void): () => void { return this.ann.subscribeEditHistory(listener); }

  async setState(state: any): Promise<void> {
    if (state && (typeof state.filePath === "string" || typeof state.file === "string")) {
      const p = (state.filePath ?? state.file) as string;
      this.reading.set(state.position);
      if (this.scrollEl && !this.destroyed) { await this.loadFileByPath(p); this.reading.restore(); }
      else this.filePath = p;
    }
  }

  /** 双击文件（registerExtensions 接管默认打开）时由 Obsidian 调用 */
  async onLoadFile(file: TFile): Promise<void> {
    if (file.extension !== "docx") return;
    if (this.scrollEl && !this.destroyed) await this.loadFileByPath(file.path);
    else this.filePath = file.path;
  }

  getState(): Record<string, unknown> { return { filePath: this.filePath, position: this.reading.get() }; }

  async onOpen(): Promise<void> {
    this.destroyed = false;
    this.register(this.plugin.store.subscribeDocumentRename?.((oldPath, newPath) => {
      if (this.destroyed) return;
      if (this.filePath === oldPath) this.filePath = newPath;
      if (this.loadedPath === oldPath) this.loadedPath = newPath;
    }) ?? (() => {}));
    const root = this.containerEl.children[1] as HTMLElement;
    clear(root);
    root.classList.add("ms-reader-root");
    root.classList.toggle("ms-reader-native-chrome", this.workspaceChrome);

    this.toolbarEl = el("div", { class: "ms-toolbar", role: "toolbar", "aria-label": "阅读与批注工具" });
    this.scrollEl = el("div", { class: "ms-scroll ms-word-scroll" });
    root.append(this.toolbarEl, this.scrollEl);

    this.bodyEl = el("div", { class: "ms-word-body markdown-rendered" });
    this.reading.connect(this.scrollEl, this.bodyEl);
    this.scrollEl.addEventListener("scroll", this.onScroll, { passive: true });
    this.scrollEl.addEventListener("pointerdown", () => { this.plugin.activeReader = this; });
    this.scrollEl.addEventListener("focusin", () => { this.plugin.activeReader = this; });

    this.ann = new HtmlAnnotationController(this.plugin, this);
    this.speech = new ReadingSpeechControls({ owner: `word-${Math.random().toString(36).slice(2)}`,
      selectionRoot: () => this.bodyEl, documentSource: () => documentSpeechSections(this.bodyEl), ready: () => !!this.loadedPath });
    this.buildToolbar();

    if (this.filePath) await this.loadFileByPath(this.filePath);
  }

  async onClose(): Promise<void> {
    this.speech?.dispose(); this.speech = null;
    this.destroyed = true;
    this.reading.disconnect();
    this.scrollEl?.removeEventListener("scroll", this.onScroll);
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.loadRevision++;
    this.loadedPath = null;
    if (this.plugin.activeReader === this) this.plugin.activeReader = null;
    await this.ann.destroy();
  }

  private buildToolbar(): void {
    clear(this.toolbarEl);
    const btn = (icon: string, title: string, cb: () => void) => {
      const b = el("button", { class: "ms-tb-btn", title, "aria-label": title });
      setIcon(b, icon);
      b.addEventListener("click", cb);
      return b;
    };
    const reload = btn("refresh-cw", "重新加载", () => { if (this.filePath) { this.reading.set(this.reading.get()); void this.loadFileByPath(this.filePath, true); } });
    const compareBtn = btn("columns", "对照", () => this.compare());
    const recallBtn = btn("eye-off", "忆模式：模糊高亮，点击揭示", () => this.toggleRecall());
    this.recallScopeEl = el("button", { class: "ms-btn", text: "全部摘录", title: "忆模式遮挡范围：全部摘录", "aria-label": "切换忆模式遮挡范围", "aria-pressed": "true" });
    this.recallScopeEl.addEventListener("click", () => this.setRecallCoverAll(!this.recallCoverAll));
    this.syncRecallScopeButton();
    const spacer = el("div", { class: "ms-tb-spacer" });
    const annTools = el("div", { class: "ms-tb-ann" });
    this.ann.buildToolbar(annTools);
    this.toolbarEl.append(reload, btn("undo-2", "返回上次阅读位置", () => this.ann.goBack()), btn("redo-2", "前进到下一阅读位置", () => this.ann.goForward()), compareBtn, recallBtn, this.recallScopeEl, this.speech!.element, spacer, annTools);
  }

  /** 忆模式（对齐 MN4「沉浸·忆」）：模糊全部高亮，点击揭示，主动回忆后再看答案 */
  toggleRecall(): void {
    const on = !this.getRecallMode();
    this.setRecallMode(on);
    new Notice(on ? "已进入忆模式：摘录已遮住，点击揭示" : "已退出忆模式");
  }
  private syncRecallScopeButton(): void {
    if(!this.recallScopeEl)return;
    this.recallScopeEl.textContent=this.recallCoverAll?"全部摘录":"仅标记遮挡";
    this.recallScopeEl.title=`忆模式遮挡范围：${this.recallScopeEl.textContent}`;
    this.recallScopeEl.setAttribute("aria-pressed",String(this.recallCoverAll));
  }

  private compare(): void {
    if (!this.filePath) return;
    const leaf = this.app.workspace.getLeaf("split", "horizontal");
    void leaf
      .setViewState({ type: VIEW_TYPE_WORD, active: true, state: { filePath: this.filePath } })
      .then(() => new Notice("已开启对照视图（拖动中间分隔条调节比例）"));
  }

  async loadFileByPath(path: string, force = false): Promise<void> {
    // 已加载同一文档时跳过（避免 onLoadFile 与 setState 重复触发导致双加载）
    if (!force && this.loadedPath === path) return;
    if (!force && this.pendingLoad?.path === path) return this.pendingLoad.promise;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "docx") {
      new Notice("请选择 Word(.docx) 文件");
      return;
    }
    const revision = ++this.loadRevision;
    this.speech?.stop();
    this.filePath = path;
    const promise = this.loadFile(file, revision);
    this.pendingLoad = { path, promise };
    try { await promise; }
    finally { if (this.pendingLoad?.promise === promise) this.pendingLoad = null; }
  }

  private async loadFile(file: TFile, revision: number): Promise<void> {
    const current = () => !this.destroyed && revision === this.loadRevision;
    try {
      await this.ann.releaseDocument();
      if (!current()) return;
      this.loadedPath = null;
      this.reading.beginDocument();
      clear(this.scrollEl);
      clear(this.bodyEl);
      this.scrollEl.append(this.bodyEl);
      new Notice(`正在转换 ${file.name} …`);
      const buf = await this.app.vault.readBinary(file);
      if (!current()) return;
      const result = await mammoth.convertToHtml({ arrayBuffer: buf });
      if (!current()) return;
      await this.ann.loadForDoc(file.path);
      if (!current()) return;
      this.plugin.activeReader = this;
      this.ann.setHtml(result.value); // 渲染 HTML 并叠加已存标注
      this.reading.restore();
      this.loadedPath = file.path;
      this.plugin.refreshSidebar();
      if (result.messages.length) console.warn("MarginStudy mammoth:", result.messages);
      new Notice(`已加载 ${file.name}`);
      // 打开即自动左右分栏各占一半（仿 MarginNote）
      void this.plugin.ensureSplitLayout();
    } catch (e) {
      if (current()) {
        console.error(e);
        new Notice("Word 转换失败：" + (e as Error).message);
      }
    }
  }

  // ===== HtmlReader 接口 =====
  private onScroll = (): void => {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { this.saveTimer = null; if (!this.destroyed) this.app.workspace.requestSaveLayout(); }, 700);
  };
  getScrollContainer(): HTMLElement {
    return this.scrollEl;
  }
  getBodyEl(): HTMLElement {
    return this.bodyEl;
  }
  getNavigationOutline(): ReaderContentsEntry[] {
    const path = this.loadedPath;
    const headings = () => [...this.bodyEl.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")].filter(heading => !heading.closest("[data-ann-id]"));
    return headings().map((heading, index) => ({
      title: heading.textContent?.trim() || "(无标题)", level: Number(heading.tagName.slice(1)) - 1, select: () => {
        // Annotation redraws replace the source DOM while the document stays open.
        const target = headings()[index]; if (this.destroyed || path !== this.loadedPath || !target) return;
        this.reading.prepareNavigation();
        this.ann.rememberLocation();
        this.scrollEl.scrollTo({ top: this.scrollEl.scrollTop + target.getBoundingClientRect().top - this.scrollEl.getBoundingClientRect().top - 24, behavior: "smooth" });
      },
    }));
  }
  getFilePath(): string | null {
    return this.filePath;
  }

  flashAnnotation(annId: string): void {
    this.ann.flashAnnotation(annId);
  }

  flashExcerptBlock(annId: string, block: import("../types").ExcerptBlock): void {
    this.ann.flashAnnotation(annId, block);
  }

  /** 关键词定位：在文档正文中查找首个匹配并平滑滚动到该处 */
  searchInDoc(term: string): void {
    if (!term) return;
    const walker = document.createTreeWalker(this.bodyEl, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) nodes.push(n as Text);
    let first: Range | null = null;
    for (const node of nodes) {
      const idx = (node.textContent || "").toLowerCase().indexOf(term.toLowerCase());
      if (idx >= 0) {
        first = document.createRange();
        first.setStart(node, idx);
        first.setEnd(node, idx + term.length);
        break;
      }
    }
    if (first) {
      this.ann.rememberLocation();
      const rect = first.getBoundingClientRect();
      this.scrollEl.scrollTo({ top: this.scrollEl.scrollTop + rect.top - this.scrollEl.getBoundingClientRect().top - 40, behavior: "smooth" });
      new Notice(`已定位：${term}`);
    } else {
      new Notice("文档中未找到：" + term);
    }
  }
}
