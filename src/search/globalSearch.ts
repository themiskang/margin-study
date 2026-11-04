import type MarginStudyPlugin from "../main";
import { TFile, Notice } from "obsidian";
import { el, clear } from "../utils/dom";
import { createModal } from "../utils/modal";
import { jumpToCardSource } from "../cards/cardView";

interface SearchHit {
  kind: "card" | "ann";
  title: string;
  sub: string;
  docPath: string;
  cardId?: string;
  annId?: string;
}

/** 全局检索：跨卡片与所有文档批注，结果可一键回源 */
export function openGlobalSearch(plugin: MarginStudyPlugin): void {
  let timer: number | null = null, revision = 0, closed = false;
  const { modal, close } = createModal("全局检索（卡片 + 批注）", () => {
    closed = true; revision++; if (timer !== null) window.clearTimeout(timer);
  });
  const search = el("input", {
    class: "ms-search",
    type: "text",
    placeholder: "输入关键词（空格=AND，OR，减号 - 排除）…",
  }) as HTMLInputElement;
  const list = el("div", { style: "margin-top:8px;max-height:60vh;overflow:auto" });
  modal.append(search, list);
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
