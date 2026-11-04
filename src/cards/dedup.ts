import { Notice } from "obsidian";
import type MarginStudyPlugin from "../main";
import { Card } from "../types";
import { createModal } from "../utils/modal";
import { el, clear } from "../utils/dom";
import { renderMarkdown } from "../utils/markdown";

/** 检测并列出内容重复的卡片，支持一键合并 */
export function detectDuplicateCards(plugin: MarginStudyPlugin): void {
  const norm = (s: string) =>
    (s ?? "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/\{\{c\d+::/g, "")
      .replace(/\}\}/g, "");
  const groups = new Map<string, Card[]>();
  for (const c of plugin.store.getScopedCards()) {
    const k = norm(c.front);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  const dups = [...groups.values()].filter((g) => g.length > 1);

  const { modal, close } = createModal(`检测重复卡片（${dups.length} 组）`);
  const undo = el("button", { class: "ms-btn", text: "撤销最近操作", style: "margin-bottom:8px" });
  undo.addEventListener("click", () => {
    if (!plugin.store.undoLibraryChange()) {
      new Notice("没有可撤销的变更");
      return;
    }
    plugin.refreshSidebar();
    plugin.refreshMindmap();
    close();
    detectDuplicateCards(plugin);
  });
  modal.append(undo);
  if (!dups.length) {
    modal.append(el("p", { text: "没有发现内容重复的卡片 👍", style: "color:var(--text-muted)" }));
    const ok = el("button", { class: "ms-btn primary", text: "关闭", style: "margin-top:10px" });
    ok.addEventListener("click", close);
    modal.append(ok);
    return;
  }

  const list = el("div", {});
  const renderGroup = (cards: Card[]) => {
    const box = el("div", { class: "ms-dedup-group", style: "border:1px solid var(--ms-line);border-radius:10px;padding:8px;margin-bottom:8px" });
    const head = el("div", { text: `${cards.length} 张内容相同`, style: "font-size:12px;color:var(--text-muted);margin-bottom:4px" });
    box.append(head);
    for (const c of cards) {
      const row = el("div", { class: "ms-dedup-item", style: "display:flex;gap:8px;align-items:flex-start;padding:4px 0" });
      const prev = el("div", { class: "ms-card-front", style: "flex:1" });
      void renderMarkdown(plugin.app, c.front.slice(0, 120), prev, c.docPath);
      prev.append(el("div", { class: "ms-muted", text: c.docPath || "独立卡片" }));
      const merge = el("button", { class: "ms-btn", text: "合并到此", style: "font-size:11px;padding:2px 8px" });
      merge.addEventListener("click", () => {
        const keep = plugin.store.mergeCards(c.id, cards.filter((other) => other.id !== c.id).map((other) => other.id));
        if (!keep) {
          new Notice("卡片已变更，请重新检测");
          return;
        }
        plugin.refreshSidebar();
        plugin.refreshMindmap();
        new Notice("已合并，来源、图片和关联已保留；可撤销恢复");
        close();
        detectDuplicateCards(plugin); // 刷新
      });
      row.append(prev, merge);
      box.append(row);
    }
    return box;
  };
  for (const g of dups) list.append(renderGroup(g));
  modal.append(list);
  const closeBtn = el("button", { class: "ms-btn primary", text: "关闭", style: "margin-top:8px" });
  closeBtn.addEventListener("click", close);
  modal.append(closeBtn);
}
