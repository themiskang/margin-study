import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type MarginStudyPlugin from "../main";
import type { HandwritingPresetId, HandwritingPresetSpec, ReaderContentsEntry } from "../types";
import type { HandwritingMode } from "../annot/penGeometry";
import type { ReaderEditHistoryState } from "../annot/baseController";
import { HtmlAnnotationController, HtmlReader } from "../word/htmlAnnot";
import { el, clear, hasBlockingHistoryOverlay } from "../utils/dom";
import { ReadingSpeechControls, documentSpeechSections } from "../audio/speechControls";
import { DocumentTarget, DocumentTocEntry, StaticDocument, headingToc, parseEpub, resolveDocumentTarget, sanitizeStaticHtml, wrapSection } from "./content";
import { markdownSnapshot } from "./markdown";
import { ReadingPositionTracker } from "./readingPosition";

export const VIEW_TYPE_DOCUMENT = "margin-study-document";
const EXTENSIONS = new Set(["epub", "html", "htm", "md"]);

export class DocumentReaderView extends ItemView implements HtmlReader {
  plugin: MarginStudyPlugin;
  private filePath: string | null = null;
  private loadedPath: string | null = null;
  private loadRevision = 0;
  private loadAbort: AbortController | null = null;
  private pendingLoad: { path: string; promise: Promise<void> } | null = null;
  private destroyed = false;
  private scrollEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private toolbarEl!: HTMLElement;
  private tocEl!: HTMLElement;
  private ann!: HtmlAnnotationController;
  private content: StaticDocument | null = null;
  private reading = new ReadingPositionTracker();
  private saveTimer: number | null = null;
  private searchTimer: number | null = null;
  private searchInput!: HTMLInputElement;
  private searchCount!: HTMLElement;
  private searchTerm = "";
  private hits: { start: number; end: number }[] = [];
  private hitIndex = -1;
  private fontScale = 1;
  private highlightName = "ms-document-search-" + Math.random().toString(36).slice(2);
  private recallCoverAll = true;
  private recallScopeEl: HTMLButtonElement | null = null;
  private speech: ReadingSpeechControls | null = null;
  private workspaceChrome = false;

  constructor(leaf: WorkspaceLeaf, plugin: MarginStudyPlugin) { super(leaf); this.plugin = plugin; }
  getViewType(): string { return VIEW_TYPE_DOCUMENT; }
  getDisplayText(): string { return this.filePath ? `📚 ${this.filePath.split("/").pop()}` : "MarginStudy 文档阅读"; }
  getIcon(): string { return "book-open"; }
  getFilePath(): string | null { return this.loadedPath; }
  getNavigationOutline(): ReaderContentsEntry[] {
    const content = this.content;
    return (content?.toc ?? []).map(entry => ({ title: entry.title, level: entry.depth, select: () => {
      if (!this.destroyed && this.content === content) this.gotoTarget(entry.target);
    } }));
  }
  getBodyEl(): HTMLElement { return this.bodyEl; }
  getScrollContainer(): HTMLElement { return this.scrollEl; }
  flashAnnotation(id: string): void { this.ann.flashAnnotation(id); }
  flashExcerptBlock(id: string, block: import("../types").ExcerptBlock): void { this.ann.flashAnnotation(id, block); }
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
  private onStandaloneHistoryKey = (event: KeyboardEvent): void => {
    if (this.destroyed || this.workspaceChrome || event.defaultPrevented) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "z") return;
    const root = this.containerEl.children[1] as HTMLElement | undefined;
    if (root?.closest(".ms-study-workspace") || this.containerEl.closest(".ms-study-workspace")) return;
    const target = event.target;
    if (target instanceof Element && target.closest("input,textarea,[contenteditable=true]")) return;
    const active = document.activeElement;
    if (active instanceof Element && active.closest("input,textarea,[contenteditable=true]")) return;
    if (event.currentTarget === window && this.app.workspace.activeLeaf !== this.leaf && !(target instanceof Node && this.containerEl.contains(target))) return;
    if (hasBlockingHistoryOverlay(document)) { event.preventDefault(); return; }
    event.preventDefault();
    void (event.shiftKey ? this.redoLastEdit() : this.undoLastEdit());
  };
  subscribeEditHistory(listener: (state: ReaderEditHistoryState) => void): () => void { return this.ann.subscribeEditHistory(listener); }

  getState(): Record<string, unknown> {
    return { filePath: this.filePath, position: this.reading.get(), fontScale: this.fontScale };
  }
  async setState(state: any): Promise<void> {
    const path = typeof state?.filePath === "string" ? state.filePath : typeof state?.file === "string" ? state.file : null;
    if (!path) return;
    if (Number.isFinite(state.fontScale)) this.fontScale = Math.min(2, Math.max(0.75, state.fontScale));
    this.reading.set(state.position);
    if (this.scrollEl && !this.destroyed) {
      await this.loadFileByPath(path);
      if (this.loadedPath === path) { this.bodyEl.style.fontSize = `${this.fontScale}em`; this.reading.restore(); }
    } else this.filePath = path;
  }
  async onLoadFile(file: TFile): Promise<void> {
    if (!EXTENSIONS.has(file.extension.toLowerCase())) return;
    if (this.scrollEl && !this.destroyed) await this.loadFileByPath(file.path);
    else this.filePath = file.path;
  }

  async onOpen(): Promise<void> {
    this.destroyed = false;
    this.register(this.plugin.store.subscribeDocumentRename?.((oldPath, newPath) => {
      if (this.destroyed) return;
      if (this.filePath === oldPath) this.filePath = newPath;
      if (this.loadedPath === oldPath) this.loadedPath = newPath;
    }) ?? (() => {}));
    const root = this.containerEl.children[1] as HTMLElement;
    clear(root); root.classList.add("ms-reader-root", "ms-document-reader");
    root.classList.toggle("ms-reader-native-chrome", this.workspaceChrome);
    this.toolbarEl = el("div", { class: "ms-toolbar", role: "toolbar", "aria-label": "阅读与批注工具" });
    this.tocEl = el("nav", { class: "ms-document-toc", "aria-label": "文档目录", style: "display:none;max-height:35%;overflow:auto;flex-shrink:0;padding:8px" });
    this.scrollEl = el("div", { class: "ms-scroll ms-word-scroll" });
    this.bodyEl = el("div", { class: "ms-word-body markdown-rendered ms-document-body" });
    this.bodyEl.style.fontSize = `${this.fontScale}em`;
    this.scrollEl.append(this.bodyEl);
    this.reading.connect(this.scrollEl, this.bodyEl);
    root.append(this.toolbarEl, this.tocEl, this.scrollEl);
    this.ann = new HtmlAnnotationController(this.plugin, this);
    this.speech = new ReadingSpeechControls({ owner: `document-${Math.random().toString(36).slice(2)}`,
      selectionRoot: () => this.bodyEl, documentSource: () => documentSpeechSections(this.bodyEl), ready: () => !!this.loadedPath });
    this.buildToolbar();
    this.scrollEl.addEventListener("pointerdown", this.activate);
    this.scrollEl.addEventListener("focusin", this.activate);
    this.scrollEl.addEventListener("scroll", this.onScroll, { passive: true });
    this.bodyEl.addEventListener("click", this.onLink);
    this.containerEl.addEventListener("keydown", this.onStandaloneHistoryKey);
    window.addEventListener("keydown", this.onStandaloneHistoryKey);
    if (this.filePath) await this.loadFileByPath(this.filePath);
  }
  private activate = () => { this.plugin.activeReader = this; };
  async onClose(): Promise<void> {
    this.speech?.dispose(); this.speech = null;
    this.destroyed = true; this.loadRevision++; this.loadAbort?.abort();
    this.reading.disconnect();
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    this.scrollEl?.removeEventListener("scroll", this.onScroll);
    this.scrollEl?.removeEventListener("pointerdown", this.activate);
    this.scrollEl?.removeEventListener("focusin", this.activate);
    this.bodyEl?.removeEventListener("click", this.onLink);
    this.containerEl?.removeEventListener("keydown", this.onStandaloneHistoryKey);
    window.removeEventListener("keydown", this.onStandaloneHistoryKey);
    if (this.plugin.activeReader === this) this.plugin.activeReader = null;
    this.clearSearchHighlight();
    try { await this.ann?.destroy(); }
    finally { this.content?.dispose(); this.content = null; this.loadedPath = null; }
  }

  private buildToolbar(): void {
    const button = (icon: string, title: string, action: () => void) => {
      const node = el("button", { class: "ms-tb-btn", title, "aria-label": title });
      setIcon(node, icon); node.addEventListener("click", action); return node;
    };
    this.searchInput = el("input", { type: "search", placeholder: "全文查找", "aria-label": "全文查找", style: "width:130px" });
    this.searchCount = el("span", { class: "ms-document-search-count", "aria-live": "polite", text: "0/0" });
    this.searchInput.addEventListener("input", () => {
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => { this.searchTimer = null; this.searchInDoc(this.searchInput.value); }, 200);
    });
    this.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); if (this.searchTerm !== this.searchInput.value.trim()) this.searchInDoc(this.searchInput.value); else this.gotoHit(event.shiftKey ? -1 : 1); }
    });
    const tools = el("div", { class: "ms-tb-ann" }); this.ann.buildToolbar(tools);
    this.recallScopeEl = el("button", { class: "ms-btn", text: "全部摘录", title: "忆模式遮挡范围：全部摘录", "aria-label": "切换忆模式遮挡范围", "aria-pressed": "true" });
    this.recallScopeEl.addEventListener("click", () => this.setRecallCoverAll(!this.recallCoverAll));
    this.syncRecallScopeButton();
    this.toolbarEl.append(
      button("list", "目录", () => { this.tocEl.style.display = this.tocEl.style.display === "none" ? "block" : "none"; }),
      button("refresh-cw", "重新加载", () => { if (this.filePath) { this.reading.set(this.reading.get()); void this.loadFileByPath(this.filePath, true); } }),
      button("undo-2", "返回上次阅读位置", () => this.ann.goBack()), button("redo-2", "前进到下一阅读位置", () => this.ann.goForward()),
      button("minus", "减小字号", () => this.resizeText(-0.1)), button("plus", "增大字号", () => this.resizeText(0.1)),
      this.searchInput, button("chevron-up", "上一个结果", () => this.gotoHit(-1)), button("chevron-down", "下一个结果", () => this.gotoHit(1)), this.searchCount,
      button("columns", "对照阅读", () => { if (this.filePath) void this.app.workspace.getLeaf("split", "horizontal").setViewState({ type: VIEW_TYPE_DOCUMENT, active: true, state: this.getState() }); }),
      button("eye-off", "忆模式：遮住摘录，点击揭示", () => this.toggleRecall()),
      this.recallScopeEl,
      this.speech!.element, el("div", { class: "ms-tb-spacer" }), tools);
  }
  toggleRecall(): void {
    this.setRecallMode(!this.getRecallMode());
  }
  private syncRecallScopeButton(): void {
    if(!this.recallScopeEl)return;
    this.recallScopeEl.textContent=this.recallCoverAll?"全部摘录":"仅标记遮挡";
    this.recallScopeEl.title=`忆模式遮挡范围：${this.recallScopeEl.textContent}`;
    this.recallScopeEl.setAttribute("aria-pressed",String(this.recallCoverAll));
  }
  private resizeText(delta: number): void {
    const position = this.reading.get(); this.fontScale = Math.min(2, Math.max(0.75, this.fontScale + delta));
    this.bodyEl.style.fontSize = `${this.fontScale}em`; this.reading.set(position); this.reading.restore(); this.onScroll();
  }
  async loadFileByPath(path: string, force = false): Promise<void> {
    if (!force && this.loadedPath === path) return;
    if (!force && this.pendingLoad?.path === path) return this.pendingLoad.promise;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || !EXTENSIONS.has(file.extension.toLowerCase())) throw new Error("请选择 EPUB / HTML / Markdown 文档");
    const revision = ++this.loadRevision;
    this.speech?.stop();
    this.loadAbort?.abort(); this.loadAbort = new AbortController();
    this.filePath = path;
    const promise = this.loadFile(file, revision, this.loadAbort.signal);
    this.pendingLoad = { path, promise };
    try { await promise; }
    finally { if (this.pendingLoad?.promise === promise) this.pendingLoad = null; }
  }
  private async loadFile(file: TFile, revision: number, signal: AbortSignal): Promise<void> {
    const current = () => !this.destroyed && !signal.aborted && revision === this.loadRevision;
    let candidate: StaticDocument | null = null;
    try {
      await this.ann.releaseDocument();
      if (!current()) return;
      this.loadedPath = null; this.content?.dispose(); this.content = null;
      this.reading.beginDocument();
      this.clearSearchHighlight(); this.hits = []; this.hitIndex = -1; this.searchCount.textContent = "0/0";
      clear(this.bodyEl); clear(this.tocEl);
      this.bodyEl.textContent = "正在加载文档…";
      if (file.extension.toLowerCase() === "epub") {
        const data = await this.app.vault.readBinary(file);
        if (!current()) return;
        candidate = await parseEpub(data, signal);
      } else {
        if (file.stat.size > 24 * 1024 * 1024) throw new Error("正文文件超过 24 MB 阅读上限");
        const source = await this.app.vault.read(file);
        if (!current()) return;
        const image = (src: string) => this.localImage(file.path, src);
        const html = file.extension.toLowerCase() === "md"
          ? await markdownSnapshot(this.app, source, file.path, image) : sanitizeStaticHtml(source, file.path, image);
        const withToc = headingToc(html, file.path);
        candidate = { title: file.basename, html: wrapSection(withToc.html, file.path), toc: withToc.toc, dispose() {} };
      }
      if (!current()) return;
      await this.ann.loadForDoc(file.path);
      if (!current()) return;
      this.content = candidate; candidate = null;
      this.ann.setHtml(this.content.html);
      this.loadedPath = file.path; this.plugin.activeReader = this;
      this.renderToc(this.content.toc); this.reading.restore();
      if (this.searchInput.value.trim()) this.searchInDoc(this.searchInput.value);
      this.plugin.refreshSidebar();
      void this.plugin.ensureSplitLayout();
    } catch (error) {
      if (current()) {
        this.bodyEl.textContent = "文档加载失败：" + (error as Error).message;
        new Notice(this.bodyEl.textContent);
        throw error;
      }
    } finally { candidate?.dispose(); }
  }
  private localImage(base: string, source: string): string | undefined {
    if (/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(source) && source.length <= 16 * 1024 * 1024) return source;
    const target = resolveDocumentTarget(base, source);
    if (!target) return undefined;
    let file = this.app.vault.getAbstractFileByPath(target.path);
    if (!(file instanceof TFile)) file = this.app.metadataCache.getFirstLinkpathDest(source.split("#")[0], base);
    if (!(file instanceof TFile) || !/^(png|jpe?g|gif|webp|avif)$/i.test(file.extension)) return undefined;
    return this.app.vault.getResourcePath(file);
  }

  private renderToc(entries: DocumentTocEntry[]): void {
    clear(this.tocEl);
    if (!entries.length) this.tocEl.append(el("p", { text: "文档没有标题目录" }));
    for (const entry of entries) {
      const button = el("button", { class: "ms-btn ms-document-toc-entry", text: entry.title, style: `display:block;margin-left:${Math.min(8, entry.depth) * 14}px` });
      button.addEventListener("click", () => this.gotoTarget(entry.target)); this.tocEl.append(button);
    }
  }
  private onLink = (event: MouseEvent): void => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[data-ms-target]");
    if (!link || !this.bodyEl.contains(link)) return;
    event.preventDefault(); event.stopPropagation();
    try { this.gotoTarget(JSON.parse(link.dataset.msTarget!)); } catch { new Notice("文档链接无效"); }
  };
  private gotoTarget(target: DocumentTarget): void {
    const section = this.sections().find((node) => node.dataset.msSection === target.path);
    if (section) {
      const destination = target.fragment ? Array.from(section.querySelectorAll<HTMLElement>("[id],a[name]")).find((node) => node.id === target.fragment || node.getAttribute("name") === target.fragment) : section;
      if (!destination) { new Notice("文档内链接目标已不存在"); return; }
      this.scrollToElement(destination); return;
    }
    if (this.filePath?.toLowerCase().endsWith(".epub")) { new Notice("链接目标不在 EPUB 正文章节中"); return; }
    const file = this.app.vault.getAbstractFileByPath(target.path) ?? this.app.metadataCache.getFirstLinkpathDest(target.path, this.filePath ?? "");
    if (file instanceof TFile) void this.app.workspace.openLinkText(file.path + (target.fragment ? `#${target.fragment}` : ""), this.filePath ?? "");
    else new Notice("本地链接目标不存在");
  }
  private sections(): HTMLElement[] { return Array.from(this.bodyEl.querySelectorAll<HTMLElement>("[data-ms-section]")); }
  private scrollToElement(element: HTMLElement): void {
    this.reading.prepareNavigation();
    this.ann.rememberLocation();
    this.scrollEl.scrollTo({ top: this.scrollEl.scrollTop + element.getBoundingClientRect().top - this.scrollEl.getBoundingClientRect().top - 24, behavior: "smooth" });
  }
  private onScroll = (): void => {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { this.saveTimer = null; if (!this.destroyed) this.app.workspace.requestSaveLayout(); }, 700);
  };

  private textNodes(): Text[] {
    const nodes: Text[] = []; const walker = document.createTreeWalker(this.bodyEl, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) if (!node.parentElement?.closest(".ms-ann,.ms-pen-overlay,script,style")) nodes.push(node as Text);
    return nodes;
  }
  searchInDoc(term: string): void {
    this.searchTerm = term.trim(); this.searchInput.value = this.searchTerm; this.hits = []; this.hitIndex = -1; this.clearSearchHighlight();
    const text = this.textNodes().map((node) => node.data).join("");
    const lowered = text.toLowerCase(); const query = this.searchTerm.toLowerCase();
    if (query) {
      let from = 0; let index: number;
      while ((index = lowered.indexOf(query, from)) >= 0 && this.hits.length < 1000) {
        this.hits.push({ start: index, end: index + query.length }); from = index + Math.max(1, query.length);
      }
    }
    this.searchCount.textContent = this.hits.length ? `0/${this.hits.length}${this.hits.length === 1000 ? "+" : ""}` : "0/0";
    if (this.hits.length) this.gotoHit(1);
  }
  private gotoHit(delta: number): void {
    if (!this.hits.length) return;
    this.hitIndex = (this.hitIndex + delta + this.hits.length) % this.hits.length;
    const hit = this.hits[this.hitIndex]; const range = document.createRange();
    let total = 0; let started = false; let ended = false;
    for (const node of this.textNodes()) {
      if (!started && hit.start < total + node.length) { range.setStart(node, hit.start - total); started = true; }
      if (started && hit.end <= total + node.length) { range.setEnd(node, hit.end - total); ended = true; break; }
      total += node.length;
    }
    if (!started || !ended) return;
    const bounds = range.getBoundingClientRect();
    this.ann.rememberLocation();
    this.scrollEl.scrollTo({ top: this.scrollEl.scrollTop + bounds.top - this.scrollEl.getBoundingClientRect().top - 40, behavior: "smooth" });
    const css = (globalThis as any).CSS; const HighlightClass = (globalThis as any).Highlight;
    if (css?.highlights && HighlightClass) css.highlights.set(this.highlightName, new HighlightClass(range));
    this.searchCount.textContent = `${this.hitIndex + 1}/${this.hits.length}${this.hits.length === 1000 ? "+" : ""}`;
  }
  private clearSearchHighlight(): void { (globalThis as any).CSS?.highlights?.delete(this.highlightName); }
}
