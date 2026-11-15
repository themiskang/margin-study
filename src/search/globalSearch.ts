import type MarginStudyPlugin from "../main";
import { TFile, Notice } from "obsidian";
import { el, clear } from "../utils/dom";
import { createModal } from "../utils/modal";
import { jumpToCardSource } from "../cards/cardView";
import { openSettingAndReveal, queryFeatures, runFeature } from "./featureSearch";

interface SearchHit {
  kind: "card" | "ann";
  title: string;
  sub: string;
  docPath: string;
  cardId?: string;
  annId?: string;
}

/** 全局检索：跨卡片与所有文档批注，结果可一键回源 */
export function openGlobalSearch(plugin: MarginStudyPlugin, getReader: () => import("../types").ReaderLike | null = () => plugin.activeReader, nativeCategoriesOnly = false): void {
  let timer: number | null = null, revision = 0, closed = false;
  let category: "mindmap" | "outline" | "text" | "feature" | "legacy" = "mindmap";
  const { modal, close } = createModal("全局搜索", () => {
    closed = true; revision++; if (timer !== null) window.clearTimeout(timer);
  });
  const search = el("input", {
    class: "ms-search",
    type: "text",
    placeholder: "输入关键词（空格=AND，OR，减号 - 排除）…",
  }) as HTMLInputElement;
  search.setAttribute("aria-label", "搜索关键词");
  const tabs = el("div", { class: "ms-search-categories", role: "tablist", "aria-label": "搜索分类" });
  const categories = [["mindmap", "脑图"], ["outline", "文档目录"], ["text", "文档正文"], ["feature", "功能"], ["legacy", "卡片与批注"]] as const;
  for (const [id, label] of categories) {
    if (nativeCategoriesOnly && id === "legacy") continue;
    const button = el("button", { type: "button", role: "tab", text: label, "aria-selected": String(id === category) });
    button.addEventListener("click", () => { category = id; for (const tab of tabs.querySelectorAll("[role=tab]")) tab.setAttribute("aria-selected", String(tab === button)); void draw(); });
    tabs.append(button);
  }
  const list = el("div", { style: "margin-top:8px;max-height:60vh;overflow:auto" });
  modal.append(search, tabs, list);
  setTimeout(() => search.focus(), 0);

  const draw = async () => {
    const current = ++revision;
    if (closed) return;
    clear(list);
    const raw = search.value.trim().toLowerCase();
    if (!raw) {
      list.append(el("p", { text: "输入关键词开始检索（空格=AND，OR，减号 - 排除）。", style: "color:var(--text-muted);font-size:12px" }));
      return;
    }
    // 解析查询：AND（默认空格）/ OR / -排除，对齐 MN「全局检索高级规则」
    const orMode = /\bor\b/.test(raw);
    const tokens = raw.split(/\s+/).filter(Boolean);
    const exclude = tokens.filter((t) => t.startsWith("-")).map((t) => t.slice(1));
    const include = tokens.filter((t) => !t.startsWith("-") && t !== "or");
    const match = (hay: string): boolean => {
      if (include.length && (orMode ? !include.some((t) => hay.includes(t)) : !include.every((t) => hay.includes(t)))) return false;
      if (exclude.some((t) => hay.includes(t))) return false;
      return true;
    };
    const row = (title: string, sub: string, action: () => void) => {
      const button = el("button", { type: "button", class: "ms-card ms-search-result" });
      button.append(el("div", { class: "ms-card-front", text: title }), el("div", { class: "ms-muted", text: sub }));
      button.addEventListener("click", action); list.append(button);
    };
    if (category === "feature") {
      for (const entry of queryFeatures(raw)) row(entry.title, entry.description, () => {
        close();
        const success = entry.kind === "command" ? runFeature(plugin, entry.id) : !!entry.setting && openSettingAndReveal(plugin, entry.setting);
        if (!success) new Notice("该功能当前不可用：" + entry.title);
      });
    } else if (category === "mindmap") {
      for (const node of plugin.store.nodes) {
        const card = node.cardId ? plugin.store.getCard(node.cardId) : undefined;
        if (!match([node.title, card?.title, card?.front, card?.back].filter(Boolean).join(" ").toLowerCase())) continue;
        const canvas = plugin.store.canvases.find(item => item.id === node.canvasId);
        row(node.title || card?.title || card?.front || "无标题", canvas?.name ?? "脑图", () => {
          close();
          if (canvas && plugin.store.activeStudySetId !== canvas.studySetId) plugin.store.setActiveStudySet(canvas.studySetId);
          if (canvas) plugin.store.setActiveCanvas(canvas.id);
          plugin.refreshMindmap();
        });
      }
    } else if (category === "outline" || category === "text") {
      const reader = getReader(), path = reader?.getFilePath();
      if (!reader || !path) { list.append(el("p", { text: "请先打开文档。" })); return; }
      if (category === "outline") {
        const editable = reader.getEditableOutline ? await reader.getEditableOutline() : undefined;
        if (closed || revision !== current) return;
        if (editable) {
          for (const item of editable) if (match(item.title.toLowerCase())) row(item.title, path, () => { close(); reader.navigateToOutline?.(item); });
        } else {
          for (const item of reader.getNavigationOutline?.() ?? []) if (match(item.title.toLowerCase())) row(item.title, path, () => { close(); item.select(); });
        }
      } else {
        const doc = reader.getDoc?.();
        if (doc) {
          for (let page = 1; page <= doc.numPages; page++) {
            const content = await (await doc.getPage(page)).getTextContent();
            if (closed || revision !== current) return;
            const text = content.items.map((item: { str?: string }) => item.str ?? "").join(" ");
            if (match(text.toLowerCase())) row(text.slice(0, 160), `${path} · 第 ${page} 页`, () => { close(); reader.gotoPage?.(page); });
          }
        } else {
          const text = reader.getScrollContainer().textContent ?? "";
          if (match(text.toLowerCase())) row(text.slice(0, 160), path, () => close());
        }
      }
    }
    if (category !== "legacy") {
      if (!list.childElementCount) list.append(el("p", { text: "没有匹配结果。" }));
      return;
    }
    const hits: SearchHit[] = [];

    for (const c of plugin.store.cards) {
      const hay = (c.front + " " + (c.back ?? "") + " " + c.tags.join(" ")).toLowerCase();
      if (match(hay)) {
        hits.push({ kind: "card", title: c.front.slice(0, 80), sub: `卡片 · ${c.docPath}`, docPath: c.docPath, cardId: c.id });
      }
    }

    // 扫描所有 .mstudy.json 侧车中的批注
    const files = plugin.app.vault.getFiles().filter((f) => f.path.endsWith(".mstudy.json") && !f.path.startsWith("MarginStudyBackups/") && !f.path.startsWith("_marginstudy-recovery/"));
    const paths = new Set([...files.map(f => f.path.replace(/\.mstudy\.json$/, "")), ...plugin.store.documents.filter(d => !d.missing).map(d => d.path)]);
    for (const docPath of paths) {
      try {
        const annotations = await plugin.store.loadAnnotations(docPath);
        if (closed || revision !== current) return;
        for (const a of annotations) {
          const hay = ((a.text ?? "") + " " + (a.noteText ?? "")).toLowerCase();
          if (match(hay)) {
            hits.push({
              kind: "ann",
              title: (a.text || a.noteText || "(批注)").slice(0, 80),
              sub: `批注 · ${docPath}`,
              docPath,
              annId: a.id,
            });
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (closed || revision !== current) return;

    if (!hits.length) {
      list.append(el("p", { text: "没有匹配结果。", style: "color:var(--text-muted);font-size:12px" }));
      return;
    }
    for (const h of hits) {
      const item = el("div", { class: "ms-card" });
      item.append(
        el("div", { class: "ms-card-type", text: h.kind === "card" ? "卡片" : "批注" }),
        el("div", { class: "ms-card-front", text: h.title }),
        el("div", { class: "ms-muted", text: h.sub })
      );
      item.addEventListener("click", () => {
        close();
        if (h.kind === "card" && h.cardId) {
          const card = plugin.store.getCard(h.cardId);
          if (card) jumpToCardSource(plugin, card);
          else new Notice("卡片不存在");
        } else if (h.annId) {
          const file = plugin.app.vault.getAbstractFileByPath(h.docPath);
          if (!(file instanceof TFile)) {
            new Notice("源文档不存在");
            return;
          }
          void plugin.openDocument(file).then(view => view.flashAnnotation(h.annId!)).catch(error => new Notice("无法打开来源：" + String(error)));
        }
      });
      list.append(item);
    }
  };

  // 输入防抖：避免每敲一键就同步扫描所有 sidecar（大 vault 会卡顿）
  search.addEventListener("input", () => {
    revision++;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => void draw(), 250);
  });
  void draw();
}
