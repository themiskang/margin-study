import { Menu, Notice } from "obsidian";
import type MarginStudyPlugin from "../main";
import type { MindNode } from "../types";
import { el } from "../utils/dom";
import { createModal } from "../utils/modal";
import { ReaderView } from "../pdf/readerView";
import { openDetail } from "../cards/cardView";
import { enrollCardsForReview } from "../review/decks";
import { openExtendSpeech } from "../pdf/extendSpeech";
import { copySingleCard } from "./cardClipboard";
import { cardUrl } from "./cardLink";
import { extendTextFromCard } from "../pdf/extendCardText";
import { CARD_COLORS } from "../model/cardColors";
import { openCardInkComment } from "../cards/inkComment";

export type NodeContentPart = "title" | "excerpt" | "note";

// MN5 outline color-strip measurements; rendered samples can vary slightly by card.
let activeCardMenu: Menu | null = null;
let closeCardSpeech: (() => void) | null = null;
export function stopCardActionSpeech(): void { closeCardSpeech?.(); closeCardSpeech = null; }
export function closeCardActionMenu(): void {
  const menu = activeCardMenu;
  activeCardMenu = null;
  menu?.hide();
}
export function trackCardActionMenu(menu: Menu): void {
  closeCardActionMenu();
  document.dispatchEvent(new Event("ms-card-menu-opening"));
  menu.setUseNativeMenu(false);
  activeCardMenu = menu;
  const closeForBlock = () => closeCardActionMenu();
  document.addEventListener("ms-block-menu-opening", closeForBlock);
  document.addEventListener("ms-reader-menu-opening", closeForBlock);
  menu.onHide(() => { document.removeEventListener("ms-block-menu-opening", closeForBlock); document.removeEventListener("ms-reader-menu-opening", closeForBlock); if (activeCardMenu === menu) activeCardMenu = null; });
}

/** Card actions shared by the graph toolbar, graph card menu and outline. */
export function addCommonCardActions(menu: Menu, plugin: MarginStudyPlugin, nodes: MindNode[], onChange: () => void): void {
  const cardId = nodes.length === 1 ? nodes[0].cardId : undefined;
  const card = cardId ? plugin.store.getCard(cardId) : undefined;
  if (!card) return;
  for (const [mode, label] of [["clone", "复制卡片克隆"], ["reference", "复制卡片引用"]] as const) {
    menu.addItem(item => item.setTitle(label).onClick(() => {
      if (copySingleCard(plugin, nodes[0].id, mode)) new Notice(`已复制卡片${mode === "clone" ? "克隆" : "引用"}，可在脑图中粘贴`);
    }));
  }
  menu.addItem(item => item.setTitle("复制卡片URL").onClick(() => {
    if (!plugin.store.getCard(card.id)) return;
    void navigator.clipboard.writeText(cardUrl(plugin.app.vault.getName(), card.id))
      .then(() => new Notice("已复制卡片链接"))
      .catch(error => new Notice("无法复制卡片链接：" + String(error)));
  }));
  menu.addItem(item => item.setTitle("删除").setDisabled(!!card.groupId || !!card.mergedCards?.length).onClick(() => {
    if (!plugin.store.getCard(card.id)) return;
    const { modal, close } = createModal("删除卡片");
    modal.append(el("p", { text: "删除卡片及其各脑图引用，并从复习卡组移除。子节点提升到原父节点，源文档和标注保留。" }));
    const cancel = el("button", { type: "button", text: "取消" });
    const remove = el("button", { type: "button", text: "确认删除卡片" });
    cancel.addEventListener("click", close);
    remove.addEventListener("click", () => {
      if (!plugin.store.getCard(card.id)) { close(); return; }
      remove.setAttribute("disabled", "");
      try {
        plugin.store.libraryTransaction("删除卡片及脑图引用", () => {
          for (const node of [...plugin.store.nodes].filter(node => node.cardId === card.id)) plugin.store.removeExcerptFromMindmap(node.id);
          plugin.store.removeCard(card.id);
        });
        close(); onChange();
      } catch (error) { remove.removeAttribute("disabled"); new Notice("无法删除卡片：" + String(error)); }
    });
    modal.append(cancel, remove);
  }));
  menu.addItem(item => item.setTitle("颜色").onClick(() => {
    const { modal, close } = createModal("选择卡片颜色");
    for (const [index, color] of CARD_COLORS.entries()) {
      const option = el("button", { type: "button", "aria-label": `卡片颜色 ${index + 1}`, title: color, style: `width:32px;height:32px;margin:4px;border-radius:50%;background:${color}` });
      option.addEventListener("click", () => {
        if (plugin.store.getCard(card.id)) { plugin.store.updateCard(card.id, { color, colorIndex: index }); onChange(); }
        close();
      });
      modal.append(option);
    }
    const cancel = el("button", { type: "button", text: "取消" });
    cancel.addEventListener("click", close); modal.append(cancel);
  }));
  menu.addItem(item => item.setTitle("标签").onClick(() => {
    const current = plugin.store.getCard(card.id); if (!current) return;
    const { modal, close } = createModal("编辑卡片标签");
    const input = el("textarea", { "aria-label": "卡片标签", placeholder: "每行一个标签，或用逗号分隔" }) as HTMLTextAreaElement;
    input.value = current.tags.join(", ");
    const cancel = el("button", { type: "button", text: "取消" });
    const save = el("button", { type: "button", text: "保存标签" });
    cancel.addEventListener("click", close);
    save.addEventListener("click", () => {
      if (plugin.store.getCard(card.id)) { plugin.store.updateCard(card.id, { tags: [...new Set(input.value.split(/[\n,，]/).map(tag => tag.trim()).filter(Boolean))] }); onChange(); }
      close();
    });
    modal.append(input, cancel, save);
  }));
  menu.addItem(item => item.setTitle("编辑标题").onClick(() => {
    const current = plugin.store.getCard(card.id);
    if (!current) return;
    const { modal, close } = createModal("编辑卡片标题");
    const input = el("input", { type: "text", "aria-label": "编辑卡片标题", class: "ms-search" }) as HTMLInputElement;
    input.value = current.title ?? "";
    const cancel = el("button", { type: "button", text: "取消" });
    const save = el("button", { type: "button", text: "保存标题" });
    cancel.addEventListener("click", close);
    save.addEventListener("click", () => {
      if (!plugin.store.getCard(card.id)) { close(); new Notice("卡片已不存在"); return; }
      plugin.store.updateCard(card.id, { title: input.value.trim() });
      close(); onChange();
    });
    modal.append(input, cancel, save);
  }));
  menu.addItem(item => item.setTitle("编辑卡片").onClick(() => {
    const current = plugin.store.getCard(card.id);
    if (current) openDetail(plugin, current, onChange);
  }));
  for (const [mode, label] of [["snapshot", "整卡截图批注"], ["blank", "空白手写"]] as const) {
    menu.addItem(item => item.setTitle(label).onClick(() => openCardInkComment(plugin, card.id, mode, onChange)));
  }
  menu.addItem(item => item.setTitle("追加批注").onClick(() => {
    if (!plugin.store.getCard(card.id)) return;
    const { modal, close } = createModal("追加卡片批注");
    const input = el("textarea", { "aria-label": "追加卡片批注", placeholder: "输入批注" }) as HTMLTextAreaElement;
    const cancel = el("button", { type: "button", text: "取消" });
    const save = el("button", { type: "button", text: "添加批注" });
    cancel.addEventListener("click", close);
    save.addEventListener("click", () => {
      const current = plugin.store.getCard(card.id), text = input.value.trim();
      if (!current) { close(); new Notice("卡片已不存在"); return; }
      if (!text) { new Notice("请输入批注"); return; }
      plugin.store.updateCard(card.id, { back: [current.back, text].filter(Boolean).join("\n\n") });
      close(); onChange();
    });
    modal.append(input, cancel, save);
  }));
  if (!card.image && !card.images?.length && card.front.trim()) menu.addItem(item => item.setTitle("文本转标题").onClick(() => {
    const current = plugin.store.getCard(card.id);
    if (!current || current.image || current.images?.length || !current.front.trim()) return;
    const source = current.front;
    const { modal, close } = createModal("文本转标题");
    const input = el("textarea", { "aria-label": "文本转标题内容" }) as HTMLTextAreaElement;
    input.value = source;
    const cancel = el("button", { type: "button", text: "取消" });
    const save = el("button", { type: "button", text: "设为标题" });
    cancel.addEventListener("click", close);
    save.addEventListener("click", () => {
      const latest = plugin.store.getCard(card.id);
      if (!latest || latest.front !== source || latest.image || latest.images?.length) { close(); new Notice("卡片内容已变化，请重新选择"); return; }
      const title = input.value.trim(); if (!title) { new Notice("标题不能为空"); return; }
      plugin.store.updateCard(card.id, { title }); close(); onChange();
    });
    modal.append(input, cancel, save);
  }));
  menu.addItem(item => item.setTitle("朗读").onClick(() => {
    const current = plugin.store.getCard(card.id); if (!current) return;
    stopCardActionSpeech();
    closeCardSpeech = openExtendSpeech(document.body, [current.title, current.front, current.back].filter(Boolean).join("\n\n"), "卡片朗读");
  }));
  menu.addItem(item => item.setTitle("清除富文本格式").onClick(() => {
    const current = plugin.store.getCard(card.id); if (!current) return;
    const front = current.front, back = current.back;
    const plainFront = extendTextFromCard(front).text, plainBack = back === undefined ? undefined : extendTextFromCard(back).text;
    const { modal, close } = createModal("清除富文本格式");
    modal.append(el("p", { text: "清除卡片正文与批注中受支持的文字格式，保留文字和图片。" }));
    const cancel = el("button", { type: "button", text: "取消" });
    const confirm = el("button", { type: "button", text: "确认清除格式" });
    cancel.addEventListener("click", close);
    confirm.addEventListener("click", () => {
      const latest = plugin.store.getCard(card.id);
      if (!latest || latest.front !== front || latest.back !== back) { close(); new Notice("卡片内容已变化，请重新选择"); return; }
      if (plainFront !== front || plainBack !== back) { plugin.store.updateCard(card.id, { front: plainFront, back: plainBack }); onChange(); }
      close();
    });
    modal.append(cancel, confirm);
  }));
  menu.addItem(item => item.setTitle("重置尺寸和字体比例").onClick(() => {
    const current = plugin.store.getCard(card.id); if (!current?.typography) return;
    const fontSize = plugin.store.settings.cardBaseFontSize ?? 16;
    if (current.typography.fontSize !== fontSize) { plugin.store.updateCard(card.id, { typography: { ...current.typography, fontSize } }); onChange(); }
  }));
  menu.addItem(item => item.setTitle("添加到复习").onClick(() => {
    if (plugin.store.getCard(card.id)) enrollCardsForReview(plugin, [card.id], onChange);
  }));
  menu.addItem(item => item.setTitle("摘录遮挡").setChecked(!!(nodes[0].occluded ?? card.occluded)).onClick(() => {
    const current = plugin.store.getNode(nodes[0].id);
    if (!current || current.cardId !== card.id || !plugin.store.getCard(card.id)) return;
    plugin.store.toggleNodeOcclusion([current.id]); onChange();
  }));
  menu.addItem(item => item.setTitle("从脑图中移除").onClick(() => {
    const current = plugin.store.getNode(nodes[0].id);
    if (!current || current.cardId !== card.id) return;
    if (plugin.store.removeExcerptFromMindmap(current.id)) { onChange(); new Notice("已从脑图中移除，卡片和源标注保留"); }
  }));
}

/** These parts must match splitNodeContent; local node comments are separate. */
export function nodePartText(plugin: Pick<MarginStudyPlugin, "store">, node: MindNode, part: NodeContentPart): string {
  const card = node.cardId ? plugin.store.getCard(node.cardId) : undefined;
  if (part === "title") return card ? card.title ?? "" : node.title;
  if (part === "excerpt") return card?.front ?? "";
  return card?.back ?? "";
}

export function detachNode(plugin: MarginStudyPlugin, node: MindNode, onChange: () => void): void {
  try {
    if (!plugin.store.detachNodeReference(node.id, true)) {
      new Notice("该节点没有可断开的引用");
      return;
    }
    onChange();
    new Notice("已断开此处引用，后续编辑独立保存");
  } catch (error) {
    new Notice("无法断开引用：" + String(error));
  }
}

export function openNodeSplit(plugin: MarginStudyPlugin, node: MindNode, onChange: (newId?: string) => void): void {
  const { modal, close } = createModal("按内容拆分");
  const parts: [NodeContentPart, string][] = [["title", "标题"], ["excerpt", "摘录"], ["note", "笔记"]];
  const selection = el("select", { class: "ms-select", "aria-label": "拆分内容部分" });
  for (const [value, label] of parts) selection.append(el("option", { value, text: label }));
  selection.value = parts.find(([part]) => nodePartText(plugin, node, part).length)?.[0] ?? "title";
  const preview = el("textarea", { readonly: true, "aria-label": "待拆分内容", style: "min-height:100px;width:100%" });
  const countLabel = el("label", { text: "断点前的字符数", style: "display:block;margin-top:8px" });
  const count = el("input", { type: "number", min: "0", step: "1", class: "ms-search", "aria-label": "断点前的字符数" });
  const hint = el("p", { class: "ms-muted", role: "status" });
  const actions = el("div", { class: "ms-modal-actions" });
  const cancel = el("button", { class: "ms-btn", text: "取消" });
  const split = el("button", { class: "ms-btn primary", text: "拆分" });
  const refresh = () => {
    const current = plugin.store.getNode(node.id);
    preview.value = current ? nodePartText(plugin, current, selection.value as NodeContentPart) : "";
    const length = Array.from(preview.value).length;
    count.max = String(Math.max(0, length - 1));
    count.value = String(Math.floor(length / 2));
    hint.textContent = length ? `共 ${length} 个字符；断点前后分别生成两部分。` : "该部分没有可拆分的内容，请选择其他部分。";
    split.disabled = !length;
  };
  selection.addEventListener("change", refresh);
  cancel.addEventListener("click", close);
  split.addEventListener("click", () => {
    const current = plugin.store.getNode(node.id);
    if (!current) { new Notice("节点已不存在"); close(); return; }
    const text = nodePartText(plugin, current, selection.value as NodeContentPart);
    if (text !== preview.value) { refresh(); new Notice("内容已更新，请核对新的断点再拆分"); return; }
    const characters = Array.from(text);
    const position = Number(count.value);
    if (count.value.trim() === "" || !Number.isInteger(position) || position < 0 || position >= characters.length) {
      hint.textContent = `请输入 0 到 ${Math.max(0, characters.length - 1)} 之间的整数。`;
      return;
    }
    try {
      // The Store takes a string offset; count visible characters without cutting a surrogate pair.
      const offset = characters.slice(0, position).join("").length;
      const newId = plugin.store.splitNodeContent(node.id, selection.value as NodeContentPart, offset, 0);
      if (!newId) { hint.textContent = "当前节点无法拆分，请检查所选部分和断点。"; return; }
      close();
      onChange(newId);
      new Notice("已拆分并更新引用关系");
    } catch (error) {
      hint.textContent = "无法拆分：" + String(error);
    }
  });
  actions.append(cancel, split);
  countLabel.append(count);
  modal.append(selection, preview, countLabel, hint, actions);
  refresh();
}

/** Reused by graph and outline so both views expose the same content operations. */
export function showNodeActions(plugin: MarginStudyPlugin, ids: string[], event: MouseEvent, onChange: () => void): void {
  const nodes = [...new Set(ids)].map((id) => plugin.store.getNode(id)).filter((node): node is MindNode => !!node);
  if (!nodes.length) return;
  const first = nodes[0];
  const menu = new Menu();
  trackCardActionMenu(menu);
  addCommonCardActions(menu, plugin, nodes, onChange);
  menu.addItem((item) => item.setTitle("断开引用").setDisabled(nodes.length !== 1 || !first.cardId)
    .onClick(() => detachNode(plugin, first, onChange)));
  menu.addItem((item) => item.setTitle("按内容拆分…").setDisabled(nodes.length !== 1)
    .onClick(() => openNodeSplit(plugin, first, onChange)));
  const merged = first.cardId ? plugin.store.getCard(first.cardId) : undefined;
  menu.addItem(item=>item.setTitle("连续摘录").setDisabled(nodes.length!==1||!merged||!(plugin.activeReader instanceof ReaderView)||plugin.activeReader.getFilePath()!==merged.docPath).onClick(()=>{
    const reader=plugin.activeReader;
    if(!(reader instanceof ReaderView)||!first.cardId||!reader.continueExcerptInCard(first.cardId))new Notice("请先在同一 PDF 中选择摘录笔");
  }));
  menu.addItem((item) => item.setTitle("解除合并").setDisabled(nodes.length !== 1 || !merged?.mergedCards?.length).onClick(() => {
    if (!first.cardId) return;
    try {
      const restored = plugin.store.unmergeCard(first.cardId);
      onChange();
      new Notice(`已解除合并，恢复 ${restored.length} 张卡片`);
    } catch (error) { new Notice("无法解除合并：" + String(error)); }
  }));
  menu.addItem((item) => item.setTitle("切换整卡遮挡").onClick(() => {
    plugin.store.toggleNodeOcclusion(nodes.map((node) => node.id));
    onChange();
  }));
  const show = nodes.some((node) => node.hidden);
  menu.addItem((item) => item.setTitle(show ? "在此处显示" : "在此处隐藏").onClick(() => {
    for (const node of nodes) plugin.store.setNodeHidden(node.id, !show);
    onChange();
  }));
  menu.showAtMouseEvent(event);
}
