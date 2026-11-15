import { applyCardTypography } from "../cards/typography";
import { Component, MarkdownRenderer, Notice, setIcon } from "obsidian";
import type MarginStudyPlugin from "../main";
import type { Card } from "../types";
import { clear, el } from "../utils/dom";
import { createModal, openTextModal } from "../utils/modal";
import { jumpToCardSource, openDetail } from "../cards/cardView";
import { imageUrl, cardImages } from "../review/content";
import { getOutline } from "../pdf/outline";
import { revealAt } from "../study/reveal";
import { CARD_COLORS } from "../model/cardColors";
import { bindInlineCardLinks } from "../study/cardLink";
import { BOARD_DRAG_TYPE, BOARD_GROUPINGS, boardGroupValues, boardMatchesQuery, cardsFromBoardSource, copyBoardCards, groupBoardCards, materializeBoardCards, referenceBoardCards, resolveBoardCard,
  type BoardBucket, type BoardContext, type BoardGrouping, type BoardSource } from "./boardModel";

export interface CardBoardRendererOptions {
  nativeChrome?: boolean;
  onChange?: () => void;
  onSelect?: (cardId: string) => void;
  onCreateMindmap?: (canvasId: string, nodeIds: string[]) => void;
  context?: BoardContext;
}

/** Two-level card grouping with local view state and no global sidebar ownership. */
export class CardBoardRenderer {
  private root: HTMLElement | null = null;
  private sourceSelect!: HTMLSelectElement;
  private firstSelect!: HTMLSelectElement;
  private secondSelect!: HTMLSelectElement;
  private search!: HTMLInputElement;
  private body!: HTMLElement;
  private filters!: HTMLElement;
  private footer!: HTMLElement;
  private counter!: HTMLElement;
  private sourceValue = "current";
  private first: BoardGrouping = "document";
  private second: BoardGrouping = "color";
  private firstFilter: Set<string> | undefined;
  private secondFilter: Set<string> | undefined;
  private filterOpen: "first" | "second" | null = null;
  private multiSelect = false;
  private selected = new Set<string>();
  private visibleCards: Card[] = [];
  private collapsed = new Set<string>();
  private context: BoardContext;
  private outlineLoading = new Set<string>();
  private outlineFailures = new Set<string>();
  private revealedIds = new Set<string>();
  private renderedScope = "";
  private generation = 0;
  private markdown: Component | null = null;
  private stopStore: (() => void) | null = null;

  constructor(private plugin: MarginStudyPlugin, private options: CardBoardRendererOptions = {}) {
    this.context = { queries: options.context?.queries ?? [], outlines: options.context?.outlines ?? new Map() };
    if (options.nativeChrome) this.first = this.second = "none";
  }

  mount(parent: HTMLElement): void { if (!this.root) { this.build(); this.stopStore = this.plugin.store.subscribe(change => { if (!change) this.render(); }); } parent.append(this.root!); this.render(); }
  dispose(): void { this.stopStore?.(); this.stopStore = null; this.generation++; this.markdown?.unload(); this.markdown = null; this.root?.remove(); this.root = null; }
  destroy(): void { this.dispose(); }

  private build(): void {
    this.root = el("section", { class: "ms-card-board" + (this.options.nativeChrome ? " is-native" : ""), "aria-label": "卡片分组看板" });
    const controls = el("div", { class: "ms-board-controls" });
    this.sourceSelect = el("select", { class: "ms-select", "aria-label": "卡片来源" });
    this.sourceSelect.addEventListener("change", () => {
      this.sourceValue = this.sourceSelect.value; this.firstFilter = this.secondFilter = undefined; this.selected.clear();
      if (!this.sourceValue.startsWith("doc:")) {
        if (["mapstate", "blank"].includes(this.first)) this.first = "document";
        if (["mapstate", "blank"].includes(this.second)) this.second = "color";
      }
      this.render();
    });
    const grouping = (level: "first" | "second", label: string) => {
      const row = el("label", { class: "ms-board-grouping" }); row.append(document.createTextNode(label));
      const select = el("select", { class: "ms-select", "aria-label": label });
      select.addEventListener("change", () => {
        this[level] = select.value as BoardGrouping;
        if (this.first !== "none" && this.first === this.second) this.second = "none";
        if (level === "first") this.firstFilter = undefined; else this.secondFilter = undefined;
        this.render();
      });
      const filter = this.button("筛选组别", `筛选${label}组别`, () => { this.filterOpen = this.filterOpen === level ? null : level; this.render(); });
      row.append(select, filter); return { row, select };
    };
    const first = grouping("first", "一级分组"), second = grouping("second", "二级分组");
    this.firstSelect = first.select; this.secondSelect = second.select;
    this.search = el("input", { type: "search", class: "ms-search", placeholder: "搜索标题、摘录、评论、标签…", "aria-label": "搜索看板卡片" });
    this.search.addEventListener("input", () => this.render());
    const searchGroups = this.button("搜索组", "设置复合搜索组", () => this.editQueries());
    if (this.options.nativeChrome) {
      const nativeSearch = el("div", { class: "ms-organize-native-search" });
      const filter = this.button("", "看板来源与分组", () => this.root?.classList.toggle("show-filters")); setIcon(filter, "filter"); filter.classList.add("ms-organize-native-icon");filter.style.setProperty("padding","5px","important");const filterIcon=filter.querySelector<SVGElement>("svg");if(filterIcon){filterIcon.style.setProperty("flex-shrink","0");filterIcon.style.setProperty("min-width","1em");}
      this.search.placeholder = "搜索卡片"; nativeSearch.append(filter, this.search);
      searchGroups.classList.add("ms-board-query-settings"); controls.append(nativeSearch, this.sourceSelect, first.row, second.row, searchGroups);
    } else controls.append(this.sourceSelect, first.row, second.row, this.search, searchGroups);
    this.filters = el("div", { class: "ms-board-filter-panel" });
    const tools = el("div", { class: "ms-board-selection-tools" });
    const multi = this.button("多选", "多选看板卡片", () => { this.multiSelect = !this.multiSelect; if (!this.multiSelect) this.selected.clear(); this.updateSelection(); });
    multi.dataset.action = "board-multiselect"; multi.setAttribute("aria-pressed", "false");
    this.counter = el("span", { class: "ms-muted", role: "status", "aria-live": "polite" });
    tools.append(multi, this.button("全选筛选结果", "全选筛选结果", () => { this.multiSelect = true; this.selected = new Set(this.visibleCards.map((card) => card.id)); this.updateSelection(); }),
      this.button("清除选择", "清除看板选择", () => { this.selected.clear(); this.updateSelection(); }), this.counter);
    this.body = el("div", { class: "ms-board-body" });
    this.footer = el("div", { class: "ms-board-actions", role: "toolbar", "aria-label": "看板批量操作" });
    const action = (id: string, text: string, run: () => void) => { const button = this.button(text, text, run); button.dataset.action = id; return button; };
    this.footer.append(action("color", "颜色", () => this.colors()), action("tags", "标签", () => this.tags()),
      action("merge", "合并", () => this.mutate("看板批量合并", () => { const ids = materializeBoardCards(this.plugin.store, this.selectionIds()); if (ids.length < 2) return; const keep = this.plugin.store.mergeCards(ids[0], ids.slice(1)); this.selected = new Set(keep ? [keep.id] : []); })),
      action("delete", "删除", () => this.mutate("看板批量删除", () => {
        const store = this.plugin.store, ids = materializeBoardCards(store, this.selectionIds());
        const nodes = store.nodes.filter((node) => node.cardId && ids.includes(node.cardId)); const removed = new Set(nodes.map((node) => node.id));
        for (const node of store.nodes) if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) {
          let parentId = store.getNode(node.parentId)?.parentId ?? null; const visited = new Set<string>();
          while (parentId && removed.has(parentId) && !visited.has(parentId)) { visited.add(parentId); parentId = store.getNode(parentId)?.parentId ?? null; }
          store.reparentNode(node.id, parentId);
        }
        store.removeNodes([...removed]); for (const id of ids) store.removeCard(id); this.selected.clear();
      })),
      action("reference-map", "引用到脑图", () => {
        const ids = this.selectionIds(); if (!ids.length) return;
        let count = 0;
        const created = this.mutate("从看板引用卡片到脑图", () => { count = referenceBoardCards(this.plugin.store, ids).length; });
        if (created && count) new Notice(`已将 ${count} 张卡片作为引用加入当前脑图`);
      }),
      action("create-map", "生成脑图", () => this.createMindmap()),
      action("undo", "撤销", () => { this.plugin.store.undoLibraryChange(); this.changed(); }));
    this.root.append(controls, this.filters, tools, this.body, this.footer);
    if (this.options.nativeChrome) {
      const nativeFooter = el("div", { class: "ms-board-native-footer" });
      nativeFooter.append(this.button("Select", "选择看板卡片", () => { this.multiSelect = !this.multiSelect; if (!this.multiSelect) this.selected.clear(); this.updateSelection(); }),
        this.button("Edit", "编辑选中卡片", () => { const id = this.selectionIds()[0]; if (id) this.editCard(id); else new Notice("先选择一张卡片"); }),
        this.button("•••", "看板操作", () => { this.multiSelect = !this.multiSelect; this.updateSelection(); }));
      this.root.append(nativeFooter);
    }
    this.root.addEventListener("keydown", (event) => { if (event.key === "Escape") { this.selected.clear(); this.multiSelect = false; this.updateSelection(); } });
  }

  private source(): BoardSource {
    const value = this.sourceValue;
    if (value === "current") return this.plugin.store.activeStudySetId ? { kind: "studyset", id: this.plugin.store.activeStudySetId } : { kind: "all" };
    if (value === "canvas") return this.plugin.store.activeCanvasId ? { kind: "canvas", id: this.plugin.store.activeCanvasId } : { kind: "all" };
    if (value.startsWith("study:")) return { kind: "studyset", id: value.slice(6) };
    if (value.startsWith("map:")) return { kind: "canvas", id: value.slice(4) };
    if (value.startsWith("doc:")) return { kind: "document", id: value.slice(4) };
    return { kind: "all" };
  }

  render(): void {
    if (!this.root) return;
    this.markdown?.unload(); this.markdown = new Component(); this.markdown.load();
    const scope = `${this.sourceValue}:${this.plugin.store.activeCanvasId ?? ""}`;
    if (scope !== this.renderedScope) { this.revealedIds.clear(); this.renderedScope = scope; }
    this.drawSources(); this.drawGrouping(this.firstSelect, this.first); this.drawGrouping(this.secondSelect, this.second);
    const sourceCards = cardsFromBoardSource(this.plugin.store, this.source());
    const matches = sourceCards.filter((card) => boardMatchesQuery(this.plugin.store, card, this.search.value));
    this.requestCurrentOutline(); this.drawFilters(matches);
    const groups = groupBoardCards(this.plugin.store, matches, this.first, this.second, this.context, { first: this.firstFilter, second: this.secondFilter });
    this.visibleCards = [...new Map(groups.flatMap((group) => group.cards).map((card) => [card.id, card])).values()];
    const visible = new Set(this.visibleCards.map((card) => card.id)); this.selected = new Set([...this.selected].filter((id) => visible.has(id)));
    clear(this.body);
    for (const group of groups) this.body.append(this.renderGroup(group, 0));
    if (!groups.length) this.body.append(el("p", { class: "ms-muted ms-board-empty", text: sourceCards.length ? "没有符合来源、搜索和组别筛选的卡片。" : "这个来源中还没有卡片。" }));
    this.updateSelection();
  }

  private drawSources(): void {
    const values: [string, string][] = [["current", "当前学习集"], ["canvas", "当前脑图"], ["all", "全部卡片"]];
    for (const set of this.plugin.store.studySets) values.push([`study:${set.id}`, `学习集 · ${set.name}`]);
    for (const map of this.plugin.store.canvases) values.push([`map:${map.id}`, `脑图 · ${map.name}`]);
    const paths = new Set([...this.plugin.store.cards.flatMap((card) => [card.docPath, ...(card.sources ?? []).map((source) => source.docPath)]), ...this.plugin.store.nodes.map((node) => node.docPath ?? "")].filter(Boolean));
    for (const doc of this.plugin.store.documents) paths.add(doc.path);
    for (const path of paths) values.push([`doc:${path}`, `文档 · ${path.split("/").pop()}`]);
    if (!values.some(([value]) => value === this.sourceValue)) this.sourceValue = "current";
    clear(this.sourceSelect);
    for (const [value, text] of values) this.sourceSelect.append(el("option", { value, text, title: value.startsWith("doc:") ? value.slice(4) : text }));
    this.sourceSelect.value = this.sourceValue;
  }

  private drawGrouping(select: HTMLSelectElement, selected: BoardGrouping): void {
    clear(select);
    for (const [value, text] of BOARD_GROUPINGS) if (this.source().kind === "document" || !["mapstate", "blank"].includes(value)) select.append(el("option", { value, text }));
    select.value = selected;
  }

  private drawFilters(cards: Card[]): void {
    clear(this.filters); this.filters.hidden = !this.filterOpen;
    if (!this.filterOpen) return;
    const level = this.filterOpen, grouping = this[level], selected = level === "first" ? this.firstFilter : this.secondFilter;
    const values = [...new Map(cards.flatMap((card) => boardGroupValues(this.plugin.store, card, grouping, this.context)).map((value) => [value.key, value])).values()];
    this.filters.append(this.button("显示全部组别", "重置组别筛选", () => { if (level === "first") this.firstFilter = undefined; else this.secondFilter = undefined; this.render(); }));
    for (const value of values) {
      const label = el("label", { class: "ms-board-filter-option" });
      const input = el("input", { type: "checkbox", "aria-label": `显示组别 ${value.label}`, "data-group-key": value.key });
      input.checked = !selected || selected.has(value.key);
      input.addEventListener("change", () => {
        const filter = new Set(selected ?? values.map((item) => item.key)); input.checked ? filter.add(value.key) : filter.delete(value.key);
        if (level === "first") this.firstFilter = filter; else this.secondFilter = filter; this.render();
      });
      label.append(input, document.createTextNode(value.label)); this.filters.append(label);
    }
  }

  private renderGroup(group: BoardBucket, depth: number): HTMLElement {
    const section = el("section", { class: "ms-board-group" + (depth ? " is-secondary" : ""), "data-group-path": group.path });
    const header = el("header", { class: "ms-board-group-header" });
    const heading = this.button(`${this.collapsed.has(group.path) ? "▸" : "▾"} ${group.label}`, `展开或折叠分组 ${group.label}`, () => { this.collapsed.has(group.path) ? this.collapsed.delete(group.path) : this.collapsed.add(group.path); this.render(); });
    heading.setAttribute("aria-expanded", String(!this.collapsed.has(group.path)));
    if (group.color) { const dot = el("span", { class: "ms-board-color-dot", "aria-hidden": "true" }); dot.style.backgroundColor = group.color; heading.prepend(dot); }
    header.append(heading, el("span", { class: "ms-muted ms-board-group-count", text: String(group.cards.length) }),
      this.button("全选此组", `全选分组 ${group.label}`, () => { this.multiSelect = true; group.cards.forEach((card) => this.selected.add(card.id)); this.updateSelection(); }));
    section.append(header);
    if (!this.collapsed.has(group.path)) {
      const nestedIds = new Set(group.children.flatMap((child) => child.cards.map((card) => card.id)));
      const directCards = group.cards.filter((card) => !nestedIds.has(card.id));
      if (directCards.length) {
        const cards = el("div", { class: "ms-board-group-cards" });
        for (const card of directCards) cards.append(this.renderCard(card));
        section.append(cards);
      }
      for (const child of group.children) section.append(this.renderGroup(child, depth + 1));
    }
    return section;
  }

  private renderCard(card: Card): HTMLElement {
    const item = el("article", { class: "ms-board-card", tabindex: "0", "data-card-id": card.id, role: "group", "aria-label": card.title || card.front || "空白卡片" });
    if (card.color) item.style.setProperty("--ms-board-card-color", card.color);
    const header = el("div", { class: "ms-board-card-header" });
    if (card.docPath || card.sources?.some((source) => source.docPath)) header.append(this.button("›", "跳转到原文", () => jumpToCardSource(this.plugin, card)));
    header.append(this.button("•••", "编辑卡片", () => this.editCard(card.id))); item.append(header);
    const masked = card.occluded && !this.revealedIds.has(card.id);
    if (masked) item.append(this.button("••• 揭晓", "揭晓整卡内容", () => {
      const canvas = this.plugin.store.canvases.find((candidate) => candidate.id === this.plugin.store.activeCanvasId);
      revealAt(this.revealedIds, card.id, !!canvas?.singlePeek); this.render();
    }));
    else {
      const text = (value: string | undefined, className: string) => {
        if (!value) return;
        const body = el("div", { class: className });applyCardTypography(body,this.plugin.store.settings,card,className==="ms-board-card-title"); bindInlineCardLinks(this.plugin, body); item.append(body);
        void MarkdownRenderer.render(this.plugin.app, value, body, card.docPath || card.sources?.find(source => source.docPath)?.docPath || "", this.markdown!)
          .catch(() => { body.textContent = value; });
      };
      text(card.title, "ms-board-card-title"); text(card.front, "ms-board-card-excerpt"); text(card.back, "ms-board-card-note");
      if (!card.title && !card.front && !card.back && !cardImages(card).length) item.append(el("span", { class: "ms-muted", text: "空白卡片" }));
      for (const source of cardImages(card)) item.append(el("img", { src: imageUrl(this.plugin, source), alt: "卡片图片", loading: "lazy", draggable: false }));
    }
    const metadata = el("div", { class: "ms-board-card-metadata" });
    if (!masked) for (const tag of card.tags) metadata.append(el("span", { class: "ms-tag", text: tag }));
    for (const deck of this.plugin.store.cardReviewDecks(card.id)) metadata.append(el("span", { class: "ms-ol-review-badge", text: deck.name, "data-deck-id": deck.id }));
    if (card.mergedCards?.length) metadata.append(el("span", { class: "ms-muted", text: `合并 ${card.mergedCards.length}` }));
    if (metadata.childElementCount) item.append(metadata);
    item.addEventListener("click", (event) => { if ((event.target as HTMLElement).closest("button,a")) return; this.select(card.id, event.ctrlKey || event.metaKey); });
    item.addEventListener("keydown", (event) => { if (event.target === item && ["Enter", " "].includes(event.key)) { event.preventDefault(); this.select(card.id, event.ctrlKey || event.metaKey); } });
    item.addEventListener("dblclick", (event) => { if (!this.multiSelect && !(event.target as HTMLElement).closest("button,a")) this.editCard(card.id); });
    item.draggable = true;
    item.addEventListener("dragstart", (event) => {
      const cardIds = this.selected.has(card.id) ? this.selectionIds() : [card.id];
      event.dataTransfer?.setData(BOARD_DRAG_TYPE, JSON.stringify({ version: 1, cardIds }));
      event.dataTransfer?.setData("text/plain", cardIds[0]); if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    });
    return item;
  }

  private select(id: string, additive = false): void {
    if (this.multiSelect || additive) this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id);
    else { this.selected = new Set([id]); this.options.onSelect?.(id); }
    this.updateSelection();
  }

  private updateSelection(): void {
    if (!this.root) return;
    this.root.querySelectorAll<HTMLElement>(".ms-board-card").forEach((element) => { const selected = this.selected.has(element.dataset.cardId!); element.classList.toggle("is-selected", selected); element.setAttribute("aria-selected", String(selected)); });
    const multi = this.root.querySelector<HTMLElement>('[data-action="board-multiselect"]')!;
    multi.setAttribute("aria-pressed", String(this.multiSelect)); multi.classList.toggle("is-active", this.multiSelect);
    this.root.dataset.selectionMode = this.multiSelect ? "multiple" : "single";
    this.root.classList.toggle("is-multi-select", this.multiSelect);
    this.counter.textContent = `${this.visibleCards.length} 张卡片 · 已选 ${this.selected.size}`;
    for (const action of this.footer.querySelectorAll<HTMLButtonElement>("button")) action.disabled = action.dataset.action === "undo" ? false : action.dataset.action === "merge" ? this.selected.size < 2 : !this.selected.size;
  }

  private selectionIds(): string[] { return [...this.selected].filter((id) => resolveBoardCard(this.plugin.store, id) && this.visibleCards.some((card) => card.id === id)); }
  private editCard(id: string): void {
    try { const [materialized] = materializeBoardCards(this.plugin.store, [id]); const card = this.plugin.store.getCard(materialized); if (card) { this.selected = new Set([materialized]); this.render(); openDetail(this.plugin, card, () => this.changed()); } }
    catch (error) { new Notice("无法编辑卡片：" + String(error)); }
  }
  private button(text: string, label: string, action: () => void): HTMLButtonElement {
    const button = el("button", { class: "ms-btn", type: "button", text, title: label, "aria-label": label });
    button.addEventListener("click", (event) => { event.stopPropagation(); action(); }); return button;
  }
  private mutate(label: string, action: () => void): boolean { try { this.plugin.store.libraryTransaction(label, action); this.changed(); return true; } catch (error) { new Notice("看板操作失败：" + String(error)); return false; } }
  private changed(): void { this.render(); this.options.onChange?.(); this.plugin.refreshMindmap(); }

  private colors(): void {
    const ids = this.selectionIds(); if (!ids.length) return;
    const { modal, close } = createModal(`修改 ${ids.length} 张卡片的颜色`);
    const palette = el("div", { class: "ms-board-palette" });
    const apply = (color?: string, colorIndex?: number) => { this.mutate("看板批量修改颜色", () => { const real = materializeBoardCards(this.plugin.store, ids); real.forEach((id) => this.plugin.store.updateCard(id, { color, colorIndex })); this.selected = new Set(real); }); close(); };
    for (const [index, color] of CARD_COLORS.entries()) { const button = this.button("", `使用颜色 ${color}`, () => apply(color, index)); button.style.backgroundColor = color; palette.append(button); }
    const custom = el("input", { type: "color", "aria-label": "自选卡片颜色", value: CARD_COLORS[0] });
    modal.append(palette, custom, this.button("使用自选颜色", "使用自选颜色", () => apply(custom.value)), this.button("清除颜色", "清除颜色", () => apply(undefined)), this.button("取消", "取消", close));
  }

  private tags(): void {
    const ids = this.selectionIds(); if (!ids.length) return;
    const { modal, close } = createModal(`修改 ${ids.length} 张卡片的标签`);
    const mode = el("select", { class: "ms-select", "aria-label": "批量标签操作" });
    for (const [value, text] of [["add", "添加标签"], ["remove", "移除标签"], ["replace", "替换全部标签"]]) mode.append(el("option", { value, text }));
    const input = el("textarea", { "aria-label": "批量标签", placeholder: "用逗号或换行分隔标签" });
    modal.append(mode, input, this.button("确定", "确定", () => {
      const tags = [...new Set(input.value.split(/[,，\n]+/).map((value) => value.trim().replace(/^#/, "")).filter(Boolean))];
      this.mutate("看板批量修改标签", () => { const real = materializeBoardCards(this.plugin.store, ids); this.selected = new Set(real); for (const id of real) { const card = this.plugin.store.getCard(id); if (!card) continue;
        this.plugin.store.updateCard(id, { tags: mode.value === "replace" ? tags : mode.value === "remove" ? card.tags.filter((tag) => !tags.includes(tag.replace(/^#/, ""))) : [...new Set([...card.tags, ...tags])] }); } });
      close();
    }), this.button("取消", "取消", close));
  }

  private editQueries(): void {
    openTextModal({ title: "复合搜索组", placeholder: '每行：组名 = 搜索条件\n例如：重点 = tag:重点 -tag:掌握\n空格同时满足， | 任一，支持 title/tag/doc/note/link/color/is',
      initial: this.context.queries?.map((query) => `${query.label} = ${query.query}`).join("\n"),
      onOk: (text) => {
        const lines = text.split("\n").filter((line) => line.trim());
        if (lines.some((line) => !line.includes("=") || !line.slice(0, line.indexOf("=")).trim())) { new Notice("每行请按“组名 = 搜索条件”填写"); return; }
        this.context.queries = lines.map((line, index) => ({ id: `query-${index}`, label: line.slice(0, line.indexOf("=")).trim(), query: line.slice(line.indexOf("=") + 1).trim() }));
        this.firstFilter = this.secondFilter = undefined; this.render();
      } });
  }

  private createMindmap(): void {
    const ids = this.selectionIds(); if (!ids.length) return;
    openTextModal({ title: `从 ${ids.length} 张卡片生成独立脑图`, initial: "卡片集锦", onOk: (name) => {
      if (!name.trim()) return;
      let canvasId = "", nodeIds: string[] = [];
      const created = this.mutate("从看板生成脑图", () => {
        const store = this.plugin.store;
        if (!store.activeStudySetId) { store.createStudySet(name.trim()); canvasId = store.activeCanvasId!; }
        else canvasId = store.createCanvas(store.activeStudySetId, name.trim()).id;
        nodeIds = copyBoardCards(store, ids, { canvasId }); store.setActiveCanvas(canvasId);
      });
      if (created && nodeIds.length) { this.options.onCreateMindmap?.(canvasId, nodeIds); this.plugin.refreshSidebar(); this.plugin.refreshMindmap(); new Notice(`已复制 ${nodeIds.length} 张卡片到新脑图`); }
    } });
  }

  private requestCurrentOutline(): void {
    if (this.first !== "directory" && this.second !== "directory") return;
    const reader = this.plugin.activeReader, path = reader?.getFilePath();
    if (!reader?.getDoc || !path || this.context.outlines!.has(path) || this.outlineLoading.has(path) || this.outlineFailures.has(path)) return;
    const generation = this.generation; this.outlineLoading.add(path);
    void getOutline(reader.getDoc()).then((items) => { if (generation !== this.generation || !this.root) return; this.context.outlines!.set(path, items); this.render(); })
      .catch(() => { if (generation === this.generation && this.root) { this.outlineFailures.add(path); new Notice("当前文档目录无法读取，卡片仍可按其他属性分组"); } })
      .finally(() => this.outlineLoading.delete(path));
  }

  revealCard(cardId: string): boolean {
    if (!this.root) return false;
    const canonical = this.plugin.store.getCard(cardId)?.groupId ?? cardId;
    this.render(); const element = [...this.root.querySelectorAll<HTMLElement>(".ms-board-card")].find((card) => card.dataset.cardId === canonical);
    if (!element) return false; this.selected = new Set([canonical]); this.updateSelection(); element.scrollIntoView({ block: "nearest" }); return true;
  }
}
