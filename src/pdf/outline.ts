import { Notice, TFile } from "obsidian";
import type MarginStudyPlugin from "../main";

export interface OutlineItem {
  title: string;
  page: number; // 1-based
  level: number;
}

/** 提取 PDF 大纲（书签），解析 dest → 页码 */
export async function getOutline(doc: any): Promise<OutlineItem[]> {
  let outline: unknown;
  try { outline = typeof doc?.getOutline === "function" ? await doc.getOutline() : doc?.outline; }
  catch { outline = doc?.outline; }
  if (!outline || !Array.isArray(outline)) return [];
  const items: OutlineItem[] = [];

  const walk = async (nodes: any[], level: number): Promise<void> => {
    for (const n of nodes) {
      let page = 0;
      if (n.dest !== undefined && n.dest !== null) {
        try {
          const dest = typeof n.dest === "string" ? await doc.getDestination(n.dest) : n.dest;
          const ref = Array.isArray(dest) ? dest[0] : dest;
          if (Number.isInteger(ref) && ref >= 0) page = ref + 1;
          else if (ref && typeof ref === "object") page = (await doc.getPageIndex(ref)) + 1;
          if (!Number.isInteger(page) || page < 1 || (Number.isInteger(doc.numPages) && page > doc.numPages)) {
            page = 0;
          }
        } catch {
          /* 忽略无法解析的书签 */
        }
      }
      items.push({ title: n.title || "(无标题)", page, level });
      if (Array.isArray(n.items) && n.items.length && level < 100) await walk(n.items, level + 1);
    }
  };

  await walk(outline, 0);
  return items;
}

/** 导出当前 PDF 的目录为 Markdown 笔记 */
export async function exportPdfOutline(plugin: MarginStudyPlugin): Promise<void> {
  await plugin.store.flush();
  const reader = plugin.activeReader;
  const doc = reader?.getDoc?.();
  if (!reader || !doc) {
    new Notice("请先在 MarginStudy 中打开一个 PDF");
    return;
  }
  const items = reader.getEditableOutline ? await reader.getEditableOutline() : await getOutline(doc);
  if (!items.length) {
    new Notice("该 PDF 没有内嵌目录");
    return;
  }
  const lines = ["# PDF 目录", ""];
  for (const it of items) {
    lines.push(`${"  ".repeat(it.level)}- ${it.title} — 第 ${it.page} 页`);
  }
  const content = lines.join("\n");
  const base = (reader.getFilePath() ?? "pdf").split("/").pop()!.replace(/\.pdf$/i, "");
  const name = `${base}-目录.md`;
  const existing = plugin.app.vault.getAbstractFileByPath(name);
  if (existing instanceof TFile) await plugin.app.vault.modify(existing, content);
  else await plugin.app.vault.create(name, content);
  new Notice(`已导出目录到 ${name}`);
}
