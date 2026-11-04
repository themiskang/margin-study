import { Notice, setIcon } from "obsidian";
import type MarginStudyPlugin from "../main";
import type { MindNode } from "../types";
import { el, clear } from "../utils/dom";
import { openTextModal } from "../utils/modal";
import { jumpToCardSource } from "../cards/cardView";
import { nodeContent } from "../study/nodeContent";
import { showNodeActions, type NodeContentPart } from "../study/nodeActions";
import { revealAt } from "../study/reveal";
import { addOutlineNode, indentOutlineNode, mergeOutlinePrevious, outlineSiblings, outlineText, setOutlineText, splitOutlineNode } from "./outlineEditing";

export interface OutlineRendererOptions {
  nativeChrome?: boolean;
  onChange?: () => void;
  onSelect?: (cardId: string) => void;
}
type Caret = { id: string; part?: NodeContentPart; start?: number; end?: number };

/** A locally owned outline; mounting never claims the plugin's sidebar pointer. */
export class OutlineRenderer {
  private root: HTMLElement | null = null;
  private tree: HTMLElement | null = null;
  private colorBar: HTMLElement | null = null;
  private search: HTMLInputElement | null = null;
  private selectedId: string | null = null;
  private editing = false;
  private gestures = false;
  private singleLine = false;
  private showHidden = false;
  private temporaryVisible = new Set<string>();
  private activeColors = new Set<string>();
  private combination: "or" | "and" = "or";
  private sortBy = "order";
  private revealedIds = new Set<string>();
  private rows: string[] = [];
  private pendingFocus: Caret | null = null;
  private dragStartX = 0;
  private renderBusy = false;

  constructor(private plugin: MarginStudyPlugin, private options: OutlineRendererOptions = {}) {}

  mount(parent: HTMLElement): void {
    if (!this.root) this.build();
    parent.append(this.root!); this.render();
  }

  dispose(): void { this.commitEditors(); this.root?.remove(); this.root = null; this.tree = null; }
  destroy(): void { this.dispose(); }

  private build(): void {
    this.root = el("section", { class: "ms-outline-renderer" + (this.options.nativeChrome ? " is-native" : ""), "aria-label": "脑图大纲" });
    const controls = el("div", { class: "ms-outline-controls" });
    this.search = el("input", { class: "ms-search", type: "search", placeholder: "搜索标题、摘录、笔记、评论…", "aria-label": "搜索大纲" });
    this.search.addEventListener("input", () => this.render());
    const filters = el("div", { class: "ms-outline-filters" });
    const choice = (name: string, values: [string, string][], change: (value: string) => void) => {
      const select = el("select", { class: "ms-select", "aria-label": name });
      for (const [value, text] of values) select.append(el("option", { value, text }));
      select.addEventListener("change", () => { change(select.value); this.render(); });
      return select;
    };
    const checkbox = (label: string, aria: string, change: (value: boolean) => void) => {
      const wrapper = el("label", { class: "ms-toggle" });
      const input = el("input", { type: "checkbox", "aria-label": aria });
      input.addEventListener("change", () => { change(input.checked); this.render(); });
      wrapper.append(input, document.createTextNode(label)); return wrapper;
    };
    filters.append(choice("筛选组合", [["or", "并集"], ["and", "交集"]], (value) => this.combination = value as "or" | "and"),
      choice("大纲排序", [["order", "层级"], ["title", "标题"], ["color", "颜色"]], (value) => this.sortBy = value),
      checkbox("单行", "单行大纲", (value) => this.singleLine = value),
      checkbox("显示隐藏", "显示隐藏节点", (value) => { this.showHidden = value; this.temporaryVisible.clear(); }));
    this.colorBar = el("div", { class: "ms-tagbar ms-outline-colors" });
    if (this.options.nativeChrome) {
      const header = el("div", { class: "ms-organize-native-search" });
      const filter = this.button("", "筛选大纲", () => this.root?.classList.toggle("show-filters"), "ms-organize-native-icon");
      setIcon(filter, "filter"); header.append(filter, this.search); controls.append(header, filters, this.colorBar);
    } else controls.append(this.search, filters, this.colorBar);
    this.tree = el("div", { class: "ms-outline-tree", role: "tree", "aria-label": "大纲节点" });
    const footer = el("div", { class: "ms-outline-footer" });
    const edit = el("button", { class: "ms-btn", text: this.options.nativeChrome ? "Edit" : "编辑", "aria-label": "编辑大纲", "aria-pressed": "false" });
    edit.addEventListener("click", () => {
      this.commitEditors(); this.editing = !this.editing;
      edit.textContent = this.options.nativeChrome ? this.editing ? "Done" : "Edit" : this.editing ? "完成" : "编辑"; edit.setAttribute("aria-pressed", String(this.editing));
      if (this.editing && this.selectedId) this.pendingFocus = { id: this.selectedId };
      this.render();
    });
    const gesture = checkbox("大纲缩进手势", "大纲缩进手势", (value) => this.gestures = value);
    const add = el("button", { class: "ms-btn", text: "新增一张卡片", "data-action": "outline-add" });
    add.addEventListener("click", () => {
      const nodes = this.plugin.store.getScopedNodes().filter((node) => !node.parentId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      this.perform(() => { const id = addOutlineNode(this.plugin.store, nodes[nodes.length - 1]); this.selectedId = id; this.pendingFocus = { id }; });
    });
    footer.append(gesture, add, edit); this.root.append(controls, this.tree, footer);
  }

  private commitEditors(): void {
    const editors = this.root?.querySelectorAll<HTMLTextAreaElement>("textarea[data-node-id]");
    if (!editors?.length) return;
    this.plugin.store.libraryTransaction("编辑大纲内容", () => {
      for (const editor of editors) if (editor.dataset.dirty === "true") {
        setOutlineText(this.plugin.store, editor.dataset.nodeId!, editor.dataset.part as NodeContentPart, editor.value);
        delete editor.dataset.dirty;
      }
    });
  }

  private captureCaret(): Caret | null {
    const focused = document.activeElement;
    if (focused instanceof HTMLTextAreaElement && this.root?.contains(focused) && focused.dataset.nodeId) {
      return { id: focused.dataset.nodeId, part: focused.dataset.part as NodeContentPart, start: focused.selectionStart, end: focused.selectionEnd };
    }
    if (focused instanceof HTMLElement && focused.classList.contains("ms-ol-node") && this.root?.contains(focused)) return { id: focused.dataset.id! };
    return null;
  }

  render(): void {
    if (!this.root || !this.tree || this.renderBusy) return;
    this.renderBusy = true;
    const caret = this.pendingFocus ?? this.captureCaret(); this.pendingFocus = null;
    this.commitEditors(); clear(this.tree); this.rows = [];
    this.root.classList.toggle("is-editing", this.editing);
    this.root.querySelector<HTMLElement>('[data-action="outline-add"]')!.hidden = !this.editing;
    const nodes = this.plugin.store.getScopedNodes().filter((node) => !(node.cardId && this.plugin.store.getCard(node.cardId)?.groupId));
    const ids = new Set(nodes.map((node) => node.id));
    if (this.selectedId && !ids.has(this.selectedId)) this.selectedId = null;
    this.drawColors(nodes);
    const childrenOf = (parent: string | null) => nodes.filter((node) => parent === null ? !node.parentId || !ids.has(node.parentId) : node.parentId === parent)
      .sort((a, b) => this.sortBy === "title" ? nodeContent(this.plugin.store, a).title.localeCompare(nodeContent(this.plugin.store, b).title)
        : this.sortBy === "color" ? (nodeContent(this.plugin.store, a).color ?? "").localeCompare(nodeContent(this.plugin.store, b).color ?? "") : (a.order ?? 0) - (b.order ?? 0));
    const query = this.search!.value.trim().toLocaleLowerCase();
    const visited = new Set<string>();
    const walk = (node: MindNode, depth: number) => {
      if (visited.has(node.id)) return; visited.add(node.id);
      if (node.hidden && !this.showHidden && !this.temporaryVisible.has(node.id)) return;
      const content = nodeContent(this.plugin.store, node);
      const textMatch = !query || [content.heading, content.excerpt, content.note, ...content.comments, ...content.tags].join("\n").toLocaleLowerCase().includes(query);
      const colorMatch = !this.activeColors.size || !!content.color && this.activeColors.has(content.color);
      const match = query && this.activeColors.size ? this.combination === "and" ? textMatch && colorMatch : textMatch || colorMatch : textMatch && colorMatch;
      if (match) { this.rows.push(node.id); this.tree!.append(this.renderRow(node, depth)); }
      if (!node.collapsed || query || this.activeColors.size) for (const child of childrenOf(node.id)) walk(child, match ? depth + 1 : depth);
    };
    for (const root of childrenOf(null)) walk(root, 0);
    if (!this.rows.length) this.tree.append(el("p", { class: "ms-muted", text: nodes.length ? "没有匹配的节点。" : "当前脑图没有节点。点击编辑后可新增卡片，也可从原文摘录。" }));
    for (const editor of this.tree.querySelectorAll<HTMLTextAreaElement>("textarea.ms-outline-editor")) this.sizeEditor(editor);
    this.renderBusy = false;
    if (caret) this.restoreCaret(caret);
  }

  private drawColors(nodes: MindNode[]): void {
    clear(this.colorBar!);
    const colors = new Set([...nodes.map((node) => nodeContent(this.plugin.store, node).color).filter((color): color is string => !!color), ...this.activeColors]);
    for (const color of colors) {
      const chip = el("button", { class: "ms-colorchip" + (this.activeColors.has(color) ? " is-active" : ""), title: color, "aria-label": `筛选颜色 ${color}`, "aria-pressed": String(this.activeColors.has(color)) });
      chip.style.backgroundColor = color;
      chip.addEventListener("click", () => { this.activeColors.has(color) ? this.activeColors.delete(color) : this.activeColors.add(color); this.render(); });
      this.colorBar!.append(chip);
    }
  }

  private renderRow(node: MindNode, depth: number): HTMLElement {
    const content = nodeContent(this.plugin.store, node), card = node.cardId ? this.plugin.store.getCard(node.cardId) : undefined;
    const masked = !!(node.occluded ?? card?.occluded) && !this.revealedIds.has(node.id);
    const row = el("div", { class: "ms-ol-node" + (this.singleLine ? " is-compact" : "") + (this.selectedId === node.id ? " is-sel" : ""),
      tabindex: "0", role: "treeitem", "aria-level": depth + 1, "aria-selected": String(this.selectedId === node.id), "data-id": node.id });
    row.style.setProperty("--ms-outline-indent", `${depth * 18}px`);
    row.style.paddingLeft = `${6 + depth * 18}px`;
    if (content.color) row.style.borderLeftColor = content.color;
    if (node.hidden) row.classList.add("is-hidden-node");
    const children = this.plugin.store.nodes.some((candidate) => candidate.parentId === node.id);
    if (children) {
      row.setAttribute("aria-expanded", String(!node.collapsed));
      row.append(this.button(node.collapsed ? "▸" : "▾", "折叠/展开节点", () => this.perform(() => this.plugin.store.updateNode(node.id, { collapsed: !node.collapsed })), "ms-outline-collapse"));
    } else row.append(el("span", { class: "ms-outline-bullet", text: "·", "aria-hidden": "true" }));
    const body = el("div", { class: "ms-outline-node-body" });
    if (masked) {
      body.append(this.button("••• 揭晓", "揭晓整卡内容", () => {
        const canvas = this.plugin.store.canvases.find((candidate) => candidate.id === node.canvasId);
        revealAt(this.revealedIds, node.id, !!canvas?.singlePeek); this.render();
      }, "ms-cloze"));
    } else if (this.editing) {
      const parts: [NodeContentPart, string][] = card
        ? [...(card.title ? [["title", "标题"]] as [NodeContentPart, string][] : []), ["excerpt", card.title ? "摘录" : "卡片内容"], ...(card.back ? [["note", "笔记"]] as [NodeContentPart, string][] : [])]
        : [["title", "节点内容"]];
      for (const [part, label] of parts) {
        const editor = el("textarea", { class: "ms-outline-editor", rows: "1", "data-node-id": node.id, "data-part": part, "aria-label": label });
        editor.value = outlineText(this.plugin.store, node, part);
        editor.addEventListener("input", () => { editor.dataset.dirty = "true"; this.sizeEditor(editor); });
        editor.addEventListener("blur", () => { if (editor.dataset.dirty === "true") { this.commitEditors(); this.options.onChange?.(); this.plugin.refreshMindmap(); } });
        editor.addEventListener("focus", () => this.select(node.id));
        editor.addEventListener("keydown", (event) => this.editorKey(event, node, part, editor));
        body.append(editor);
      }
    } else {
      body.append(el("span", { class: "ms-ol-title", text: content.title || "(空)" }));
      if (content.heading && content.excerpt) body.append(el("div", { class: "ms-outline-excerpt", text: content.excerpt }));
      if (content.note) body.append(el("div", { class: "ms-outline-note", text: content.note }));
      for (const comment of content.comments) body.append(el("div", { class: "ms-outline-note", text: comment }));
    }
    if (node.hidden) body.append(el("span", { class: "ms-muted", text: "[已隐藏]" }));
    const metadata = el("div", { class: "ms-outline-metadata" });
    if (!masked) for (const tag of content.tags) metadata.append(el("span", { class: "ms-tag", text: tag }));
    if (card) for (const deck of this.plugin.store.cardReviewDecks(card.id)) metadata.append(el("span", { class: "ms-ol-review-badge", text: deck.name, "data-deck-id": deck.id, title: `已加入复习卡组：${deck.name}` }));
    if (metadata.childElementCount) body.append(metadata);
    row.append(body);
    const tools = el("div", { class: "ms-ol-tools" });
    if (card && (card.docPath || card.sources?.some((source) => source.docPath))) tools.append(this.button("›", "跳转到原文", () => jumpToCardSource(this.plugin, card)));
    tools.append(this.button("+子", "新建子节点", () => this.perform(() => { const id = addOutlineNode(this.plugin.store, node, true); this.pendingFocus = { id }; this.selectedId = id; })),
      this.button("缩进", "缩进", () => this.indent(node.id)), this.button("升级", "升级", () => this.indent(node.id, true)),
      this.button("改名", "改名", () => this.rename(node)),
      this.button("更多", "更多", (event) => showNodeActions(this.plugin, [node.id], event, () => this.changed())),
      this.button("删", "删除此节点及子节点", () => this.perform(() => this.plugin.store.removeNode(node.id))));
    row.append(tools);
    row.addEventListener("click", (event) => { if ((event.target as HTMLElement).closest("button,textarea,a")) return; this.select(node.id, true); row.focus(); });
    row.addEventListener("contextmenu", (event) => { if ((event.target as HTMLElement).closest("textarea")) return; event.preventDefault(); event.stopPropagation(); showNodeActions(this.plugin, [node.id], event, () => this.changed()); });
    row.addEventListener("keydown", (event) => {
      if (event.target !== row) return;
      if (event.key === "Tab" && (this.editing || this.gestures)) { event.preventDefault(); this.pendingFocus = { id: node.id }; this.indent(node.id, event.shiftKey); }
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); const next = this.rows[this.rows.indexOf(node.id) + (event.key === "ArrowDown" ? 1 : -1)];
        if (next) { this.select(next, true); this.restoreCaret({ id: next }); }
      } else if (event.key === "Enter" && this.editing) { event.preventDefault(); this.pendingFocus = { id: node.id }; this.render(); }
      else if (event.key === "F2") { event.preventDefault(); this.rename(node); }
    });
    this.bindDrag(row, node);
    return row;
  }

  private button(text: string, label: string, action: (event: MouseEvent) => void, cls = "ms-ol-btn"): HTMLButtonElement {
    const button = el("button", { class: cls, text, type: "button", title: label, "aria-label": label });
    button.addEventListener("click", (event) => { event.stopPropagation(); action(event); }); return button;
  }

  private editorKey(event: KeyboardEvent, node: MindNode, part: NodeContentPart, editor: HTMLTextAreaElement): void {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Tab") {
      event.preventDefault(); this.pendingFocus = { id: node.id, part, start: editor.selectionStart, end: editor.selectionEnd }; this.indent(node.id, event.shiftKey);
    } else if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault(); const start = editor.selectionStart, end = editor.selectionEnd;
      this.perform(() => { const split = splitOutlineNode(this.plugin.store, node.id, part, start, end); if (split) { this.selectedId = split.tailId; this.pendingFocus = { id: split.tailId, part, start: 0, end: 0 }; } });
    } else if (event.key === "Backspace" && editor.selectionStart === 0 && editor.selectionEnd === 0 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const previous = this.rows[this.rows.indexOf(node.id) - 1];
      if (!previous || this.search?.value.trim() || this.activeColors.size || this.sortBy !== "order") return;
      event.preventDefault(); this.perform(() => { const merged = mergeOutlinePrevious(this.plugin.store, node.id, previous, part); if (merged) { this.selectedId = merged.id; this.pendingFocus = { id: merged.id, part: merged.part, start: merged.caret, end: merged.caret }; } });
    }
  }

  private bindDrag(row: HTMLElement, node: MindNode): void {
    row.draggable = this.gestures && !this.editing;
    const handle = row.firstElementChild as HTMLElement | null;
    if (handle && this.gestures) { handle.draggable = true; handle.title = "拖动调整大纲层级与顺序"; handle.style.cursor = "grab"; }
    row.addEventListener("dragstart", (event) => { this.dragStartX = event.clientX; event.dataTransfer?.setData("application/margin-study-outline-node", node.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"; });
    const position = (event: DragEvent): "before" | "after" | "inside" => {
      if (event.clientX - this.dragStartX > 24) return "inside";
      return event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2 ? "after" : "before";
    };
    row.addEventListener("dragover", (event) => { if (!this.gestures || !event.dataTransfer?.types.includes("application/margin-study-outline-node")) return; event.preventDefault(); row.dataset.drop = position(event); });
    row.addEventListener("dragleave", () => delete row.dataset.drop);
    row.addEventListener("drop", (event) => {
      if (!this.gestures) return; const id = event.dataTransfer?.getData("application/margin-study-outline-node"); delete row.dataset.drop;
      if (!id || id === node.id) return; event.preventDefault();
      this.perform(() => {
        if (event.clientX - this.dragStartX < -24) { indentOutlineNode(this.plugin.store, id, true); return; }
        const target = position(event);
        if (target === "inside") { this.plugin.store.reparentNode(id, node.id); this.plugin.store.updateNode(node.id, { collapsed: false }); }
        else { const siblings = outlineSiblings(this.plugin.store, node).filter((candidate) => candidate.id !== id); const index = siblings.findIndex((candidate) => candidate.id === node.id) + (target === "after" ? 1 : 0); this.plugin.store.reparentNode(id, node.parentId, index); }
        this.selectedId = id;
      });
    });
  }

  private select(id: string, notify = false): void {
    this.selectedId = id;
    this.tree?.querySelectorAll<HTMLElement>(".ms-ol-node").forEach((row) => { const selected = row.dataset.id === id; row.classList.toggle("is-sel", selected); row.setAttribute("aria-selected", String(selected)); });
    const cardId = this.plugin.store.getNode(id)?.cardId; if (notify && cardId) this.options.onSelect?.(cardId);
  }

  private indent(id: string, outdent = false): void {
    this.perform(() => { if (!indentOutlineNode(this.plugin.store, id, outdent)) new Notice(outdent ? "已在最顶级" : "前面没有同级节点可缩进到其下"); });
  }

  private rename(node: MindNode): void {
    const card = node.cardId ? this.plugin.store.getCard(node.cardId) : undefined;
    openTextModal({ title: card ? "编辑卡片标题（同步所有引用）" : "重命名节点", initial: nodeContent(this.plugin.store, node).title,
      onOk: (value) => { if (value.trim()) this.perform(() => setOutlineText(this.plugin.store, node.id, "title", value.trim())); } });
  }

  private perform(action: () => void): void {
    try { this.commitEditors(); this.plugin.store.libraryTransaction("编辑大纲", action); this.changed(); }
    catch (error) { new Notice("无法编辑大纲：" + String(error)); this.render(); }
  }

  private changed(): void { this.render(); this.options.onChange?.(); this.plugin.refreshMindmap(); }

  private restoreCaret(caret: Caret): void {
    const row = [...(this.tree?.querySelectorAll<HTMLElement>(".ms-ol-node") ?? [])].find((element) => element.dataset.id === caret.id);
    if (!row) return;
    const editors = [...row.querySelectorAll<HTMLTextAreaElement>("textarea[data-part]")];
    for (const editor of editors) this.sizeEditor(editor);
    const editor = editors.find((candidate) => candidate.dataset.part === caret.part) ?? editors[0];
    if (editor) { editor.focus({ preventScroll: true }); const start = Math.min(caret.start ?? editor.value.length, editor.value.length); editor.setSelectionRange(start, Math.min(caret.end ?? start, editor.value.length)); }
    else row.focus({ preventScroll: true });
    row.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  private sizeEditor(editor: HTMLTextAreaElement): void { editor.style.height = "auto"; editor.style.height = `${Math.max(28, editor.scrollHeight)}px`; }

  revealCard(cardId: string): boolean {
    const canonical = this.plugin.store.getCard(cardId)?.groupId ?? cardId;
    const node = this.plugin.store.getScopedNodes().find((candidate) => candidate.cardId === canonical);
    if (!node) return false;
    const ancestors: MindNode[] = [node], visited = new Set([node.id]); let parentId = node.parentId;
    while (parentId && !visited.has(parentId)) { const parent = this.plugin.store.getNode(parentId); if (!parent) break; visited.add(parentId); ancestors.push(parent); parentId = parent.parentId; }
    this.temporaryVisible = new Set(ancestors.map((ancestor) => ancestor.id));
    this.plugin.store.updateNodes(ancestors.slice(1).filter((ancestor) => ancestor.collapsed).map((ancestor) => ({ id: ancestor.id, patch: { collapsed: false } })));
    this.search!.value = ""; this.activeColors.clear(); this.selectedId = node.id; this.pendingFocus = { id: node.id }; this.render(); return this.rows.includes(node.id);
  }
}
