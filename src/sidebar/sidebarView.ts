import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type MarginStudyPlugin from "../main";
import { el, clear } from "../utils/dom";
import { renderCardList, startReview, jumpToCardSource, isDueCard } from "../cards/cardView";
import { getOutline } from "../pdf/outline";
import { OutlineRenderer } from "../outline/outlineRenderer";
import { CardBoardRenderer } from "../board/cardBoardRenderer";
import { MindmapRenderer } from "../mindmap/mindmapRenderer";
import { renderStudyControls } from "../study/studyControls";
import { openPractice } from "../review/practice";

export const VIEW_TYPE_SIDEBAR = "margin-study-sidebar";

type Tab = "mindmap" | "cards" | "outline" | "review";

const TAB_LABELS: Record<Tab, string> = {
  mindmap: "脑图",
  cards: "卡片",
  outline: "大纲",
  review: "复习",
};

export class SidebarView extends ItemView {
  plugin: MarginStudyPlugin;
  tab: Tab = "mindmap";
  private tabsEl!: HTMLElement;
  private studyControlsEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private mindmapRenderer: MindmapRenderer | null = null;
  private outlineMode: "mind" | "toc" = "mind";
  private outlineGeneration = 0;
  private outlineRenderer: OutlineRenderer | null = null;
  private boardRenderer: CardBoardRenderer | null = null;
  private cardsMode: "board" | "list" = "board";

  constructor(leaf: WorkspaceLeaf, plugin: MarginStudyPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SIDEBAR;
  }
  getDisplayText(): string {
    return "MarginStudy";
  }
  getIcon(): string {
    return "network";
  }

  async onOpen(): Promise<void> {
    this.plugin.sidebar = this;
    const root = this.containerEl.children[1] as HTMLElement;
    clear(root);
    root.classList.add("ms-sidebar");

    this.tabsEl = el("div", { class: "ms-sidebar-tabs" });
    this.studyControlsEl = el("div", { class: "ms-study-controls" });
    this.bodyEl = el("div", { class: "ms-sidebar-body" });
    root.append(this.studyControlsEl, this.tabsEl, this.bodyEl);
    this.renderTab();
  }

  async onClose(): Promise<void> {
    this.outlineGeneration++;
    if (this.plugin.sidebar === this) this.plugin.sidebar = null;
    this.mindmapRenderer?.destroy();
    this.mindmapRenderer = null;
    this.outlineRenderer?.dispose(); this.outlineRenderer = null;
    this.boardRenderer?.dispose(); this.boardRenderer = null;
  }

  setTab(t: Tab): void {
    this.tab = t;
    this.renderTab();
  }

  refresh(): void {
    this.renderTab();
  }

  /** 轻量重绘脑图（仅当脑图页签激活），用于批注实时联动，不重置缩放/平移视图状态 */
  refreshMindmap(): void {
    if (this.tab === "mindmap" && this.mindmapRenderer) {
      this.mindmapRenderer.render();
    }
  }

  private renderTab(): void {
    this.outlineGeneration++;
    this.mindmapRenderer?.destroy();
    this.mindmapRenderer = null;
    this.outlineRenderer?.dispose(); this.outlineRenderer = null;
    this.boardRenderer?.dispose(); this.boardRenderer = null;
    renderStudyControls(this.studyControlsEl, this.plugin, () => {
      this.plugin.refreshSidebar();
      this.plugin.refreshMindmap();
    });
    clear(this.tabsEl);
    (Object.keys(TAB_LABELS) as Tab[]).forEach((t) => {
      const b = el("button", {
        class: "ms-sidebar-tab" + (t === this.tab ? " is-active" : ""),
        text: TAB_LABELS[t],
      });
      b.addEventListener("click", () => this.setTab(t));
      this.tabsEl.append(b);
    });
    clear(this.bodyEl);
    if (this.tab === "mindmap") this.renderMindmap();
    else if (this.tab === "outline") this.renderOutline();
    else if (this.tab === "cards") this.renderCards();
    else this.renderReview();
  }

  private renderMindmap(): void {
    this.mindmapRenderer?.destroy();
    this.mindmapRenderer = new MindmapRenderer(this.plugin, { showToolbar: true });
    this.mindmapRenderer.mount(this.bodyEl);
  }

  private renderCards(): void {
    const controls = el("div", { class: "ms-seg ms-outline-top" });
    for (const [value, label] of [["board", "分组看板"], ["list", "卡片列表"]] as const) {
      const button = el("button", { class: "ms-seg-btn" + (this.cardsMode === value ? " is-active" : ""), text: label });
      button.addEventListener("click", () => { this.cardsMode = value; this.renderTab(); }); controls.append(button);
    }
    this.bodyEl.append(controls);
    const host = el("div", { class: "ms-organize-host" }); this.bodyEl.append(host);
    if (this.cardsMode === "list") renderCardList(host, this.plugin);
    else { this.boardRenderer = new CardBoardRenderer(this.plugin); this.boardRenderer.mount(host); }
  }

  // The same instance-independent component can also live in the study workspace.
  private async renderOutline(): Promise<void> {
    const generation = ++this.outlineGeneration;
    this.outlineRenderer?.dispose(); this.outlineRenderer = null;
    clear(this.bodyEl);
    const top = el("div", { class: "ms-outline-top ms-seg" });
    for (const [mode, label] of [["mind", "脑图大纲"], ["toc", "文档目录"]] as const) {
      const button = el("button", { class: "ms-seg-btn" + (this.outlineMode === mode ? " is-active" : ""), text: label });
      button.addEventListener("click", () => { this.outlineMode = mode; void this.renderOutline(); }); top.append(button);
    }
    this.bodyEl.append(top);
    if (this.outlineMode === "toc") { await this.renderToc(generation); return; }
    const host = el("div", { class: "ms-organize-host" }); this.bodyEl.append(host);
    this.outlineRenderer = new OutlineRenderer(this.plugin); this.outlineRenderer.mount(host);
  }

  private async renderToc(generation: number): Promise<void> {
    const reader = this.plugin.activeReader;
    if (!reader || !reader.getDoc) {
      this.bodyEl.append(
        el("p", { text: "请先在 MarginStudy 中打开一个 PDF 查看文档目录。", style: "color:var(--text-muted);font-size:12px" })
      );
      return;
    }
    const loading = el("p", { text: "加载文档目录中…", style: "color:var(--text-muted);font-size:12px" });
    this.bodyEl.append(loading);
    let items: Awaited<ReturnType<typeof getOutline>>;
    try {
      items = await getOutline(reader.getDoc());
    } catch (error) {
      if (generation === this.outlineGeneration && this.tab === "outline") loading.textContent = "无法读取文档目录：" + String(error);
      return;
    }
    if (generation !== this.outlineGeneration || this.tab !== "outline") return;
    loading.remove();
    if (!items.length) {
      this.bodyEl.append(el("p", { text: "该 PDF 没有大纲/书签。", style: "color:var(--text-muted);font-size:12px" }));
      return;
    }
    for (const it of items) {
      const item = el("div", {
        class: "ms-outline-item",
        text: it.title,
        style: `padding-left:${4 + it.level * 14}px`,
        title: `第 ${it.page} 页`,
      });
      item.addEventListener("click", () => {
        if (it.page > 0) reader.gotoPage?.(it.page);
      });
      this.bodyEl.append(item);
    }
  }

  private renderReview(): void {
    const cards = this.plugin.store.getScopedCards();
    const due = cards.filter((card) => isDueCard(this.plugin, card));
    const reviewable = due;

    this.bodyEl.append(
      el("div", { class: "ms-stat", html: `<span>范围内卡片</span><span>${cards.length}</span>` })
    );
    this.bodyEl.append(
      el("div", { class: "ms-stat", html: `<span>今日到期</span><span>${reviewable.length}</span>` })
    );

    const btn = el("button", { class: "ms-btn primary", text: "开始复习", style: "margin:10px 0;width:100%" });
    btn.addEventListener("click", () => startReview(this.plugin));
    this.bodyEl.append(btn);
    const practice = el("button", { class: "ms-btn", text: "刷题练习", style: "margin:0 0 10px;width:100%" });
    practice.addEventListener("click", () => openPractice(this.plugin)); this.bodyEl.append(practice);

    if (!reviewable.length) {
      this.bodyEl.append(
        el("p", { text: "今天没有待复习的卡 🎉", style: "color:var(--text-muted);font-size:12px" })
      );
      return;
    }
    for (const c of reviewable) {
      const item = el("div", { class: "ms-card" });
      item.append(el("div", { class: "ms-card-type", text: c.type === "flashcard" ? "闪卡" : "需复习" }));
      item.append(el("div", { class: "ms-card-front", text: c.front.slice(0, 100) }));
      item.addEventListener("click", () => jumpToCardSource(this.plugin, c));
      this.bodyEl.append(item);
    }
  }
}
