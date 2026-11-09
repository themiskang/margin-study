import { Plugin, WorkspaceLeaf, TFile, TFolder, Notice, Menu, Platform } from "obsidian";
import { Store } from "./model/store";
import { ReaderView, VIEW_TYPE_READER } from "./pdf/readerView";
import { WordReaderView, VIEW_TYPE_WORD } from "./word/wordReader";
import { DocumentReaderView, VIEW_TYPE_DOCUMENT } from "./documents/documentReader";
import { openCardManager, startReview } from "./cards/cardView";
import { SidebarView, VIEW_TYPE_SIDEBAR } from "./sidebar/sidebarView";
import { MindmapView, VIEW_TYPE_MINDMAP } from "./mindmap/mindmapView";
import { exportMarkdown, exportHtml, openStats, exportAnkiTsv, exportAllHtml, exportAnkiApkg } from "./export/exporter";
import { exportMindmapPng } from "./export/mindmapExport";
import { detectDuplicateCards } from "./cards/dedup";
import { exportPdfOutline } from "./pdf/outline";
import { exportCanvas, importCanvas } from "./canvas/canvasIo";
import { MarginStudySettingTab } from "./settings";
import { openGlobalSearch } from "./search/globalSearch";
import { openFeatureSearch, installFeatureSearchHotkey } from "./search/featureSearch";
import { toggleStudyInterface } from "./workspace/scenes";
import { ReaderLike } from "./types";
import { initPdfWorker } from "./pdf/pdfjs";
import { applyTheme } from "./theme";
import { todayStr } from "./srs";
import { createModal } from "./utils/modal";
import { el } from "./utils/dom";
import { StudyWorkspaceView, VIEW_TYPE_STUDY_WORKSPACE } from "./workspace/studyWorkspace";
import { openWebImport } from "./import/webImport";
import { ResearchView, VIEW_TYPE_RESEARCH } from "./research/view";
import { updatePageCollectionSourcePath } from "./documents/pageCollection";
import { openReviewDecks } from "./review/decks";
import { openPractice } from "./review/practice";
import { SourceRecoveryPrompts } from "./documents/recoveryPrompts";
import { openCardLink } from "./study/cardLink";
import { aiServiceFor } from "./ai/panel";
import { condenseServiceFor } from "./ai/condense";
import type { LocalCliService } from "./ai/contracts";

/** 视图间事件回调（侧边栏大纲需要监听阅读器翻页） */
export interface ViewEvents {
  onPageChange?: (n: number) => void;
  onDocumentCardSelect?: (cardId: string) => void;
  onMindmapCardSelect?: (cardId: string) => void;
}

export default class MarginStudyPlugin extends Plugin {
  condenseService() { return condenseServiceFor(aiServiceFor(this)); }
  store!: Store;
  localCli: LocalCliService | null = null;
  private localCliLoading: Promise<LocalCliService> | null = null;
  private localCliUnloaded = false;
  viewEvents: ViewEvents = {};
  activeReader: ReaderLike | null = null;
  sidebar: SidebarView | null = null;
  mindmapView: MindmapView | null = null;
  studyWorkspace: StudyWorkspaceView | null = null;
  private replacingLeaves = new WeakSet<WorkspaceLeaf>();
  private layoutTimer: number | null = null;
  private refreshTimer: number | null = null;
  private documentRenames: Promise<void> = Promise.resolve();
  private renameRevision = 0;
  private pendingRenames: {oldPath:string;newPath:string}[] = [];
  private renamedCollections = new Set<string>();
  private sourceRecovery: Promise<void> = Promise.resolve();
  private recoveryPrompts = new SourceRecoveryPrompts(async (id, path, changed) => {
    const oldPath = this.store.documents.find(doc => doc.id === id)?.path;
    await this.store.restoreDocumentAtPath(id, path, changed);
    if (oldPath) await this.finishRecoveredMove(oldPath, path);
  }, text => { new Notice(text, 10000); });

  async onload(): Promise<void> {
    this.localCliUnloaded = false;
    await initPdfWorker(this.app);
    this.store = new Store(this);
    await this.store.load();
    applyTheme(this);

    this.registerView(VIEW_TYPE_READER, (leaf) => new ReaderView(leaf, this));
    this.registerView(VIEW_TYPE_WORD, (leaf) => new WordReaderView(leaf, this));
    this.registerView(VIEW_TYPE_DOCUMENT, (leaf) => new DocumentReaderView(leaf, this));
    this.registerView(VIEW_TYPE_SIDEBAR, (leaf) => new SidebarView(leaf, this));
    this.registerView(VIEW_TYPE_MINDMAP, (leaf) => new MindmapView(leaf, this));
    this.registerView(VIEW_TYPE_RESEARCH, leaf => new ResearchView(leaf, this));
    this.registerExtensions(["msref"], VIEW_TYPE_READER);
    this.registerView(VIEW_TYPE_STUDY_WORKSPACE, (leaf) => new StudyWorkspaceView(leaf, this));
    this.registerObsidianProtocolHandler("margin-study-card", params => openCardLink(this, { vault: params["msvault"], card: params["card"] }));

    // Replace views in their existing tabs; each callback checks the current setting.
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (file instanceof TFile && this.isReaderFile(file)) this.scheduleNativeTakeover();
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.scheduleNativeTakeover();
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view instanceof StudyWorkspaceView) {
        this.studyWorkspace = leaf.view;
        this.activeReader = leaf.view.getReader();
        leaf.view.refresh();
        return;
      }
      const view = leaf?.view as unknown as ReaderLike | undefined;
      if (view && typeof view.getFilePath === "function" && typeof view.flashAnnotation === "function") {
        this.activeReader = view;
        this.refreshSidebar();
        this.refreshMindmap();
      }
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (oldPath.endsWith(".mstudy.json") || (!(file instanceof TFile) && !(file instanceof TFolder))) return;
      const newPath=file.path, moves: {oldPath:string;newPath:string}[] = file instanceof TFolder
        ? this.documentPathsUnder(oldPath).map(path=>({oldPath:path,newPath:newPath+path.slice(oldPath.length)}))
        : [{oldPath,newPath}], revision=++this.renameRevision;
      this.documentRenames=this.documentRenames.catch(()=>{}).then(async()=>{
        for(const move of moves){
          await this.store.renameDocument(move.oldPath,move.newPath);
          for(const path of await updatePageCollectionSourcePath(this,move.oldPath,move.newPath))this.renamedCollections.add(path);
          this.pendingRenames.push(move);
        }
        if(revision!==this.renameRevision)return;
        const renames=this.pendingRenames.splice(0),collections=new Set(this.renamedCollections);this.renamedCollections.clear();
        const leaves:WorkspaceLeaf[]=[];this.app.workspace.iterateAllLeaves(leaf=>leaves.push(leaf));
        for(const leaf of leaves){
          if(leaf.view instanceof StudyWorkspaceView){await leaf.view.remapDocuments(renames,collections);continue;}
          const path=this.leafFilePath(leaf);let next=path;
          for(const rename of renames)if(next===rename.oldPath)next=rename.newPath;
          if(next&&next!==path)await leaf.setViewState({...leaf.getViewState(),state:{...leaf.getViewState().state,filePath:next,file:next}});
          else if(path&&collections.has(path)&&leaf.view instanceof ReaderView)await leaf.view.refreshPageCollection();
        }
      }).catch(e=>{new Notice("文档已移动，但关联更新需要处理："+String(e),10000);});
    }));
    this.registerEvent(this.app.vault.on("create", file => {
      if (file instanceof TFile && this.isSupportedDocument(file)
        && !file.path.startsWith("MarginStudyBackups/") && !file.path.startsWith("_marginstudy-recovery/")) void this.recoverMissingSources(file.path);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof TFile && this.isReaderFile(file)) this.store.markDocumentMissing(file.path);
    }));
    this.register(this.store.subscribe(change => {
      if (change) { this.mindmapView?.updateMovedNodes(change.movedNodeIds); return; }
      if (this.refreshTimer !== null) return;
      this.refreshTimer = window.setTimeout(() => {
        this.refreshTimer = null;
        this.sidebar?.refresh();
        this.mindmapView?.refresh();
        // StudyWorkspace subscribes to the store itself and schedules its own refresh.
      }, 50);
    }));
    void this.reconcileMissingSources();
    this.register(this.store.subscribeNavigation(({canvasId,documentPath}) => {
      this.refreshSidebar(); this.refreshMindmap();
      if (!documentPath) return;
      const file = this.app.vault.getAbstractFileByPath(documentPath);
      if (file instanceof TFile && this.isSupportedDocument(file) && this.store.activeCanvasId === canvasId) {
        void this.openDocument(file).catch(error => new Notice("恢复阅读位置失败："+String(error)));
      }
    }));
    this.registerDomEvent(window, "beforeunload", () => { void this.store.flush().catch(() => {}); });
    this.registerDomEvent(window, "blur", () => { void this.store.flush().catch(() => {}); });
    this.registerDomEvent(document, "visibilitychange", () => { if (document.visibilityState === "hidden") void this.store.flush().catch(() => {}); });

    this.addCommand({
      id: "open-reader",
      name: "在 MarginStudy 中打开当前 PDF",
      callback: () => this.openCurrentPdf(),
    });
    this.addCommand({
      id: "pdf-search",
      name: "在 PDF 中搜索（Ctrl+F）",
      callback: () => {
        const r = this.activeReader;
        if (r instanceof ReaderView) r.openSearch();
        else new Notice("请先在 MarginStudy 中打开一个 PDF");
      },
    });
    this.addCommand({
      id: "open-word-reader",
      name: "在 MarginStudy 中打开当前 Word 文档",
      callback: () => this.openCurrentWord(),
    });
    this.addCommand({ id: "open-document-reader", name: "在 MarginStudy 中打开当前文档（PDF / Word / EPUB / HTML / Markdown）", callback: () => this.openCurrentDocument() });
    this.addCommand({ id: "open-study-workspace", name: "打开 MarginStudy 学习工作区", callback: () => { void this.openStudyWorkspace().catch(error => new Notice("打开学习工作区失败：" + String(error))); } });
    this.addCommand({ id: "toggle-interface-mode", name: "切换界面模式", hotkeys: [{ modifiers: ["Mod", "Alt"], key: "I" }], callback: () => {
      if (this.studyWorkspace) this.studyWorkspace.toggleInterfaceMode();
      else if (!toggleStudyInterface(this.store)) new Notice("请先选择学习集");
    } });
    this.addCommand({ id: "recover-document-sources", name: "处理待恢复的原文档来源", callback: () => this.recoveryPrompts.openPending() });
    this.addCommand({ id: "import-web-article", name: "导入网页 / 微信文章", callback: () => openWebImport(this) });
    this.addCommand({id:"open-research-browser",name:"打开研究浏览器",callback:()=>{void this.openResearchBrowser();}});
    this.addCommand({ id: "manage-review-decks", name: "新建与管理复习卡组", callback: () => openReviewDecks(this) });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (file instanceof TFile && this.isSupportedDocument(file)) {
          menu.addItem((item) =>
            item
              .setTitle("在 MarginStudy 中打开")
              .setIcon("book-open")
              .onClick(() => { void this.openDocument(file).catch(e => new Notice("打开文档失败：" + String(e))); })
          );
        }
      })
    );

    this.addRibbonIcon("book-open", "MarginStudy 学习工作区", () => {
      const file = this.app.workspace.getActiveFile();
      void this.openStudyWorkspace(file instanceof TFile && this.isSupportedDocument(file) ? file : undefined)
        .catch(error => new Notice("打开学习工作区失败：" + String(error)));
    });

    this.addCommand({
      id: "open-cards",
      name: "打开卡片管理",
      callback: () => openCardManager(this),
    });
    this.addCommand({
      id: "start-review",
      name: "开始复习（到期的卡）",
      callback: () => startReview(this),
    });
    this.addCommand({ id: "start-practice", name: "刷题练习（不改变复习进度）", callback: () => openPractice(this) });

    this.addCommand({
      id: "open-sidebar",
      name: "打开 MarginStudy 侧边栏",
      callback: () => this.openSidebar(),
    });

    this.addCommand({
      id: "open-mindmap",
      name: "打开 MarginStudy 思维导图",
      callback: () => this.openMindmap(),
    });

    this.addCommand({
      id: "export-markdown",
      name: "导出当前文档为 Markdown",
      callback: () => exportMarkdown(this),
    });
    this.addCommand({
      id: "export-edited-pdf",
      name: "导出编辑后的 PDF",
      checkCallback: checking => {
        const reader=this.activeReader;
        if(!(reader instanceof ReaderView)||!reader.getPdfPageEdits())return false;
        if(!checking)reader.openPdfExport();return true;
      },
    });
    this.addCommand({
      id: "export-html",
      name: "导出当前文档为 HTML",
      callback: () => exportHtml(this),
    });
    this.addCommand({
      id: "export-canvas",
      name: "导出当前导图为 Canvas",
      callback: () => exportCanvas(this),
    });
    this.addCommand({
      id: "import-canvas",
      name: "从 Canvas 导入为导图",
      callback: () => importCanvas(this),
    });
    this.addCommand({
      id: "show-stats",
      name: "查看学习统计",
      callback: () => openStats(this),
    });

    this.addCommand({
      id: "global-search",
      name: "全局检索（卡片 + 批注）",
      callback: () => openGlobalSearch(this),
    });

    this.addCommand({
      id: "feature-search",
      name: "功能搜索（设置与操作索引）",
      callback: () => openFeatureSearch(this),
    });
    installFeatureSearchHotkey(this);

    this.addCommand({
      id: "export-anki-tsv",
      name: "导出 Anki 兼容 TSV（当前文档）",
      callback: () => exportAnkiTsv(this),
    });

    this.addCommand({
      id: "export-anki-apkg",
      name: "导出 Anki 牌组（APKG，含图片与遮挡）",
      callback: () => void exportAnkiApkg(this).catch(error => new Notice("APKG 导出失败：" + String(error))),
    });

    this.addCommand({
      id: "review-wrong",
      name: "复习错题",
      callback: () => startReview(this, { wrong: true }),
    });

    this.addCommand({
      id: "backup-data",
      name: "备份数据（MarginStudy）",
      callback: () => void this.store.backupData(),
    });

    this.addCommand({
      id: "export-all-html",
      name: "导出全部学习库为 HTML",
      callback: () => exportAllHtml(this),
    });

    this.addCommand({
      id: "export-mindmap-png",
      name: "导出脑图为 PNG/SVG",
      callback: () => exportMindmapPng(this),
    });

    this.addCommand({
      id: "dedup-cards",
      name: "检测重复卡片",
      callback: () => detectDuplicateCards(this),
    });

    this.addCommand({
      id: "export-pdf-outline",
      name: "导出 PDF 目录为笔记",
      callback: () => exportPdfOutline(this),
    });
    this.addCommand({
      id: "toggle-recall",
      name: "切换忆模式（遮住摘录，点击揭示）",
      callback: () => {
        const view = this.activeReader as unknown as { toggleRecall?: () => void } | undefined;
        if (view && typeof view.toggleRecall === "function") view.toggleRecall();
        else new Notice("请先打开一个 MarginStudy 文档");
      },
    });

    this.addSettingTab(new MarginStudySettingTab(this.app, this));

    this.addCommand({ id: "save-now", name: "立即保存学习库", callback: () => { void this.store.flush().then(() => new Notice("学习库已保存")).catch(() => {}); } });
    this.addCommand({ id: "restore-backup", name: "恢复完整学习库备份", callback: () => this.chooseBackup() });
    this.addCommand({ id: "resolve-save-conflict", name: "处理保存冲突", callback: () => this.showSaveConflict() });
    this.addCommand({ id: "undo-library", name: "撤销最近一次学习库操作", callback: () => { if (!this.store.undoLibraryChange()) new Notice("没有可撤销的操作"); } });
    this.addCommand({ id: "redo-library", name: "重做最近一次学习库操作", callback: () => { if (!this.store.redoLibraryChange()) new Notice("没有可重做的操作"); } });
    this.app.workspace.onLayoutReady(() => {
      this.scheduleNativeTakeover();
      if(this.studyWorkspace)this.studyWorkspace.showStudyHome();
      else void this.openStudyWorkspace().catch(error=>new Notice("打开学习集主页失败："+String(error)));
      const day = todayStr();
      if (this.store.settings.backupEnabled && this.store.settings.lastBackup !== day) {
        void this.store.backupData(true).then(path => { if (path) { this.store.settings.lastBackup = day; this.store.save(); } });
      }
    });
  }

  onunload(): void {
    this.localCliUnloaded = true;
    void this.localCli?.stop().catch(() => {});
    this.recoveryPrompts.dispose();
    if (this.layoutTimer !== null) window.clearTimeout(this.layoutTimer);
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    // A rename may still be updating references when Obsidian unloads the views.
    void this.documentRenames.then(() => this.store?.flush()).catch(() => {});
  }

  async enableLocalCli(): Promise<void> {
    if (Platform.isMobile) throw new Error("移动端不支持本地 CLI 连接。");
    if (this.localCliUnloaded) throw new Error("插件已卸载。");
    if (!this.localCliLoading) this.localCliLoading = import("./ai/localCliServer").then(({ createLocalCliServer }) => createLocalCliServer(this.store)).catch(error => { this.localCliLoading = null; throw error; });
    const service = await this.localCliLoading;
    if (this.localCliUnloaded) throw new Error("插件已卸载。");
    this.localCli = service;
    await service.start();
    if (this.localCliUnloaded) { await service.stop(); throw new Error("插件已卸载。"); }
  }

  private isReaderFile(file: TFile): boolean { return ["pdf", "msref", "docx", "epub", "html", "htm"].includes(file.extension.toLowerCase()); }
  private isSupportedDocument(file: TFile): boolean { return this.isReaderFile(file) || file.extension.toLowerCase() === "md"; }

  private chooseBackup(): void {
    const files = this.app.vault.getFiles().filter(f => f.path.startsWith("MarginStudyBackups/") && f.name === "manifest.json").sort((a,b) => b.path.localeCompare(a.path));
    const { modal, close } = createModal("恢复学习库");
    modal.append(el("p", { text: "选择备份。恢复前会先完整备份当前学习库，校验通过后才开始恢复。" }));
    if (!files.length) modal.append(el("p", { text: "还没有完整备份，请先运行「备份数据」。" }));
    for (const file of files) {
      const b = el("button", { class: "ms-btn", text: file.parent?.name ?? file.path });
      b.addEventListener("click", () => { b.setAttribute("disabled", "true"); void this.store.restoreBackup(file.path).then(close).catch(e => { b.removeAttribute("disabled"); new Notice("恢复未完成：" + String(e), 12000); }); });
      modal.append(b);
    }
  }

  private showSaveConflict(): void {
    const annotations = this.store.getAnnotationConflicts();
    if (!this.store.conflictPath && !annotations.length) { new Notice("当前没有保存冲突。文件恢复点保存在 _marginstudy-recovery 目录。"); return; }
    const { modal, close } = createModal("处理保存冲突");
    modal.append(el("p", { text: "另一处修改了磁盘文件。处理前会保留两份版本，恢复点位于 _marginstudy-recovery。" }));
    const choices: ["local" | "remote" | "merge", string][] = [["merge", "合并，保留冲突内容为独立副本"], ["local", "采用当前窗口版本"], ["remote", "采用磁盘版本"]];
    const section = (title: string, resolve: (mode: "local" | "remote" | "merge") => Promise<void>) => {
      const box = el("div", { class: "ms-conflict-options" }); box.append(el("h4", { text: title }));
      for (const [mode,label] of choices) {
        const b = el("button", { class: "ms-btn", text: label });
        b.addEventListener("click", () => {
          box.querySelectorAll("button").forEach(node => { node.disabled = true; });
          void resolve(mode).then(() => { box.replaceChildren(el("p", { text: title + "：已处理" })); if (!this.store.conflictPath && !this.store.getAnnotationConflicts().length) close(); })
            .catch(e => { box.querySelectorAll("button").forEach(node => { node.disabled = false; }); new Notice(String(e)); });
        }); box.append(b);
      }
      modal.append(box);
    };
    if (this.store.conflictPath) section("卡片、脑图与复习记录", mode => this.store.resolveDataConflict(mode));
    for (const path of annotations) section("文档批注：" + path, mode => this.store.resolveAnnotationConflict(path, mode));
  }

  /** 通用接管匹配：扫描工作区所有窗口，找出持有该文件且不是 MarginStudy 视图的 leaf。
   *  兼容原生 "pdf"、pdf-plus 等第三方 PDF 视图、markdown 型 docx 等任意类型——避免只认
   *  "pdf" 导致被 pdf-plus 接管的 PDF 永远不被接管，停在空白 + 第三方分屏布局里。*/
  /** 从任意 leaf 提取其打开的文件路径。第三方 PDF 插件（如 pdf-plus）的视图通常不暴露
   *  `leaf.view.file`，但 Obsidian 标准文件视图都会把路径存在 viewState.state.file / .filePath。
   *  之前只认 .file 导致 pdf-plus 的 leaf 匹配不到、接管失败、停在空白 + 上下布局。*/
  private leafFilePath(leaf: WorkspaceLeaf): string | null {
    try {
      const view: any = leaf.view;
      if (view?.file instanceof TFile) return view.file.path;
      const st = (leaf.getViewState?.() as any)?.state;
      if (st) {
        if (typeof st.file === "string" && st.file.length) return st.file;
        if (typeof st.filePath === "string" && st.filePath.length) return st.filePath;
      }
    } catch {
      /* leaf 可能尚未就绪 / getViewState 抛错，忽略 */
    }
    return null;
  }

  private ownView(leaf: WorkspaceLeaf): boolean { return [VIEW_TYPE_READER, VIEW_TYPE_WORD, VIEW_TYPE_DOCUMENT, VIEW_TYPE_STUDY_WORKSPACE].includes(leaf.view?.getViewType?.()); }

  private async replaceLeaf(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    if (!this.store.settings.replaceNativeReader || this.ownView(leaf) || this.replacingLeaves.has(leaf)) return;
    this.replacingLeaves.add(leaf);
    const previous = leaf.getViewState();
    try { await this.openDocument(file, { leaf, reveal: false }); }
    catch (e) { await leaf.setViewState(previous); new Notice("阅读器加载失败，已恢复原标签页：" + String(e)); }
    finally { this.replacingLeaves.delete(leaf); }
  }

  private scheduleNativeTakeover(): void {
    // file-open is dispatched inside Obsidian's native view transition. Changing
    // that leaf synchronously can be overwritten when the transition resumes.
    // Share the layout debounce so takeover starts after the host has settled.
    if (this.layoutTimer !== null) window.clearTimeout(this.layoutTimer);
    this.layoutTimer = window.setTimeout(() => {
      this.layoutTimer = null;
      void this.takeOverAllNative();
    }, 250);
  }

  private async takeOverAllNative(): Promise<void> {
    if (!this.store.settings.replaceNativeReader) return;
    const targets: { leaf: WorkspaceLeaf; file: TFile }[] = [];
    this.app.workspace.iterateAllLeaves(leaf => { if (this.ownView(leaf)) return; const path = this.leafFilePath(leaf); if (!path) return; const file = this.app.vault.getAbstractFileByPath(path); if (file instanceof TFile && this.isReaderFile(file)) targets.push({ leaf,file }); });
    for (const {leaf,file} of targets) await this.replaceLeaf(leaf,file);
  }

  async openMindmap(): Promise<void> {
    const { workspace } = this.app;
    // 强制放进右侧栏：与反向链接/大纲等右侧插件面板并列成 tab，左阅读/右脑图，绝不上下分屏。
    let leaf = workspace.getRightLeaf(true);
    if (!leaf) leaf = workspace.getLeavesOfType(VIEW_TYPE_MINDMAP)[0] ?? null;
    if (!leaf) leaf = workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_MINDMAP, active: true });
    workspace.revealLeaf(leaf);
  }

  refreshSidebar(): void {
    this.sidebar?.refresh();
    this.studyWorkspace?.refresh();
  }

  async openSidebar(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR)[0] ?? null;
    if (!leaf) {
      // 强制左右：把侧栏放进 Obsidian 右侧栏（右边缘竖向面板，物理上就是左阅读/右脑图，
      // 不受 getLeaf("split") 分裂基准 leaf 影响，绝不会变成上下分屏）。
      const right = workspace.getRightLeaf(true);
      leaf = right ?? workspace.getLeaf("split", "horizontal");
      await leaf.setViewState({ type: VIEW_TYPE_SIDEBAR, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  openCurrentPdf(): void {
    const f = this.app.workspace.getActiveFile();
    if (f instanceof TFile && f.extension === "pdf") this.openReader(f);
    else new Notice("请在 PDF 文件上运行，或右键 PDF 选择「在 MarginStudy 中打开」");
  }

  openCurrentDocument(): void {
    const file = this.app.workspace.getActiveFile() ?? this.app.vault.getAbstractFileByPath(this.activeReader?.getFilePath() ?? "");
    if (file instanceof TFile && this.isSupportedDocument(file)) void this.openDocument(file).catch(e => new Notice("打开文档失败：" + String(e)));
    else void this.openStudyWorkspace().catch(error => new Notice("打开学习工作区失败：" + String(error)));
  }

  openCurrentWord(): void {
    const f = this.app.workspace.getActiveFile();
    if (f instanceof TFile && f.extension === "docx") this.openWord(f);
    else new Notice("请在 Word(.docx) 文件上运行，或右键选择「在 MarginStudy 中打开」");
  }

  private documentPathsUnder(prefix: string): string[] {
    const root = prefix.replace(/\/$/, "") + "/", paths = new Set<string>();
    const add = (path: unknown) => { if (typeof path === "string" && path.startsWith(root)) paths.add(path); };
    for (const doc of this.store.documents) add(doc.path);
    for (const card of this.store.cards) { add(card.docPath); for (const source of card.sources ?? []) add(source.docPath); }
    for (const node of this.store.nodes) add(node.docPath);
    for (const set of this.store.studySets) for (const path of set.docPaths) add(path);
    for (const canvas of this.store.canvases) add(canvas.lastDocumentPath);
    for (const path of Object.keys(this.store.docMeta)) add(path);
    const workspace = this.store.getWorkspaceState();
    if (workspace) { add(workspace.activePath); if (Array.isArray(workspace.tabs)) for (const tab of workspace.tabs) add(tab?.path); }
    return [...paths].sort((a,b)=>a.localeCompare(b));
  }

  private async reconcileMissingSources(backfill = true): Promise<void> {
    this.sourceRecovery = this.sourceRecovery.catch(()=>{}).then(async()=>{
      if(backfill)await this.store.backfillDocumentFingerprints();
      const result = await this.store.recoverMissingDocuments();
      for (const move of result.recovered) await this.finishRecoveredMove(move.oldPath,move.newPath);
      this.recoveryPrompts.replaceIssues(result.ambiguous);
    });
    await this.sourceRecovery;
  }

  private async recoverMissingSources(_createdPath: string): Promise<void> {
    try { await this.reconcileMissingSources(false); }
    catch (error) { new Notice("来源恢复扫描未完成；原登记和批注仍保留，可稍后重试："+String(error),10000); }
  }

  private async finishRecoveredMove(oldPath: string,newPath: string): Promise<void> {
    for(const path of await updatePageCollectionSourcePath(this,oldPath,newPath))this.renamedCollections.add(path);
    const renames=[{oldPath,newPath}],leaves:WorkspaceLeaf[]=[];this.app.workspace.iterateAllLeaves(leaf=>leaves.push(leaf));
    for(const leaf of leaves){
      if(leaf.view instanceof StudyWorkspaceView){await leaf.view.remapDocuments(renames,new Set(this.renamedCollections));continue;}
      const path=this.leafFilePath(leaf);if(path===oldPath)await leaf.setViewState({...leaf.getViewState(),state:{...leaf.getViewState().state,filePath:newPath,file:newPath}});
    }
    this.renamedCollections.clear();
  }

  async openDocument(file: TFile, options: { leaf?: WorkspaceLeaf; newLeaf?: boolean; reveal?: boolean } = {}): Promise<ReaderLike> {
    const type = ["pdf", "msref"].includes(file.extension.toLowerCase()) ? VIEW_TYPE_READER : file.extension.toLowerCase() === "docx" ? VIEW_TYPE_WORD : this.isSupportedDocument(file) ? VIEW_TYPE_DOCUMENT : null;
    if (!type) throw new Error("此文件格式暂不支持：" + file.extension);
    const { workspace } = this.app;
    if (this.studyWorkspace && !options.leaf && !options.newLeaf) {
      const study = this.studyWorkspace;
      const reader = await study.openFile(file);
      if (options.reveal !== false) {
        await workspace.revealLeaf(study.leaf);
        workspace.setActiveLeaf(study.leaf, { focus: true });
      }
      return reader;
    }
    let leaf = options.leaf;
    if (!leaf && !options.newLeaf) leaf = workspace.getLeavesOfType(type).find(l => this.leafFilePath(l) === file.path);
    leaf ??= workspace.getLeaf(true);
    await leaf.setViewState({ type, active: options.reveal !== false, state: { filePath: file.path } });
    // Native file-open takeover can run while Obsidian is still replacing the
    // leaf's view. setViewState may resolve before the new view exposes its path;
    // fail only after giving that asynchronous handoff time to finish.
    const readyBy = Date.now() + 5000;
    let view = leaf.view as unknown as ReaderLike;
    while (Date.now() < readyBy) {
      view = leaf.view as unknown as ReaderLike;
      if (typeof view.getFilePath === "function" && view.getFilePath() === file.path) break;
      await new Promise<void>(resolve => window.setTimeout(resolve, 40));
    }
    if (typeof view.getFilePath !== "function" || view.getFilePath() !== file.path) throw new Error("文档未完成加载");
    this.store.registerDocument(file.path);
    void this.store.refreshDocumentFingerprint(file.path).catch(error=>new Notice("来源指纹未能更新，自动恢复不会按文件名猜测："+String(error),8000));
    const canvas = this.store.canvases.find(c => c.id === this.store.activeCanvasId);
    if (canvas && options.reveal !== false) canvas.lastDocumentPath = file.path;
    this.store.save();
    if (options.reveal !== false) { this.activeReader = view; await workspace.revealLeaf(leaf); workspace.setActiveLeaf(leaf, { focus: true }); await this.ensureSplitLayout(); }
    return view;
  }

  async openResearchBrowser(url?:string,newWindow=false):Promise<void>{
    if(!newWindow&&this.studyWorkspace&&!url){this.studyWorkspace.openAuxiliary("research");return;}
    const leaf=this.app.workspace.getLeaf(newWindow?"window":true);
    await leaf.setViewState({type:VIEW_TYPE_RESEARCH,active:true,state:{url}});
    await this.app.workspace.revealLeaf(leaf);
  }

  async openReader(file: TFile): Promise<void> { await this.openDocument(file); }
  async openWord(file: TFile): Promise<void> { await this.openDocument(file); }

  async openStudyWorkspace(file?: TFile): Promise<StudyWorkspaceView> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_STUDY_WORKSPACE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_STUDY_WORKSPACE, active: true });
    }
    const view = leaf.view;
    if (!(view instanceof StudyWorkspaceView)) throw new Error("学习工作区未完成加载");
    this.studyWorkspace = view;
    if (file) await view.openFile(file);
    else view.showStudyHome();
    await workspace.revealLeaf(leaf); workspace.setActiveLeaf(leaf, { focus: true });
    return view;
  }

  /**
   * 打开阅读器时，确保右侧出现独立的脑图视图（无 tab 栏），与左侧阅读器形成
   * 「左阅读 / 右脑图」的左右布局，严格对齐截图格式。
   *
   * 关键：脑图视图一律放进 Obsidian **右侧栏**（getRightLeaf(true)）——右侧栏是右边缘
   * 的竖向面板，物理上必然是左右布局，不受 getLeaf("split") 分裂基准 leaf 影响，
   * 从根本上杜绝「上下分屏」。
   */
  async ensureSplitLayout(): Promise<void> { if (!this.studyWorkspace) await this.openSidebar(); }

  /** 刷新当前激活的脑图视图（右侧独立脑图或侧边栏脑图页签） */
  refreshMindmap(): void {
    this.sidebar?.refreshMindmap();
    this.mindmapView?.refresh();
    this.studyWorkspace?.refresh();
  }
}
