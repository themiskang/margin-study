import { TFile, Notice } from "obsidian";
import type MarginStudyPlugin from "../main";
import { Annotation, Card, MindNode, Edge } from "../types";
import { el } from "../utils/dom";
import { createModal } from "../utils/modal";
import { clozeForExport, parseCloze } from "../utils/markdown";
import { nodeContent } from "../study/nodeContent";
import { reviewEventId } from "../model/conflicts";
import { buildApkg } from "./apkg";
import type { ApkgNoteSpec, ApkgMediaFile } from "./apkg";
import { questionsForCard, validOcclusions } from "../review/questions";
import { cardImages } from "../review/content";
import { reviewMaterial } from "../review/presentation";
import { sha1Hex } from "../utils/sha1";
import type { ImageOcclusion } from "../review/contracts";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeMd(s: string): string {
  return s.replace(/([`*_~>#])/g, "\\$1");
}

function basename(p: string): string {
  return p.split("/").pop()?.replace(/\.(pdf|docx|epub|html?|md)$/i, "") ?? p;
}

function clozeHtml(text: string): string {
  return parseCloze(text).map(token => token.type === "text" ? escapeHtml(token.text)
    : `<strong>${escapeHtml(token.text.replace(/^\*\*([\s\S]*)\*\*$/,"$1"))}</strong>`).join("");
}

function annLabel(a: Annotation): string {
  switch (a.type) {
    case "highlight": return "高亮";
    case "underline": return "下划线";
    case "strike": return "删除线";
    case "note": return "批注";
    case "voice": return "语音";
    case "pen": return "手写";
    default: return a.type;
  }
}

// ===== 数据收集 =====
async function collect(plugin: MarginStudyPlugin, ad: string) {
  const anns = await plugin.store.loadAnnotations(ad);
  const cards = plugin.store.cardsOfDoc(ad).filter(card => !card.groupId && !card.hidden);
  const nodes = plugin.store.nodes.filter(n => !n.hidden && !(n.cardId && plugin.store.getCard(n.cardId)?.groupId) && nodeContent(plugin.store,n).docPath === ad)
    .map(n => ({...n,title:nodeContent(plugin.store,n).title}));
  return { anns, cards, nodes };
}

// ===== 思维导图树 =====
function rootsOf(nodes: MindNode[]): MindNode[] {
  return nodes.filter((n) => n.parentId === null || !nodes.some(parent => parent.id === n.parentId));
}
function childrenOf(nodes: MindNode[], id: string): MindNode[] {
  return nodes.filter((n) => n.parentId === id);
}

function treeToMarkdown(roots: MindNode[], nodes: MindNode[], depth = 0): string {
  let out = "";
  for (const r of roots) {
    out += `${"  ".repeat(depth)}- ${clozeForExport(r.title)}\n`;
    out += treeToMarkdown(childrenOf(nodes, r.id), nodes, depth + 1);
  }
  return out;
}

// 简单树布局，返回 id→{x,y}
function layoutTree(roots: MindNode[], nodes: MindNode[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  let cursorY = 20;
  const layout = (node: MindNode, depth: number) => {
    const kids = node.collapsed ? [] : childrenOf(nodes, node.id);
    if (!kids.length) {
      pos.set(node.id, { x: 20 + depth * 180, y: cursorY });
      cursorY += 56;
    } else {
      kids.forEach((k) => layout(k, depth + 1));
      const first = pos.get(kids[0].id)!;
      const last = pos.get(kids[kids.length - 1].id)!;
      pos.set(node.id, { x: 20 + depth * 180, y: (first.y + last.y) / 2 });
    }
  };
  roots.forEach((r) => layout(r, 0));
  return pos;
}

// ===== Markdown 导出 =====
export async function exportMarkdown(plugin: MarginStudyPlugin, ad?: string): Promise<void> {
  await plugin.store.flush();
  const docPath = ad ?? plugin.activeReader?.getFilePath();
  if (!docPath) {
    new Notice("请先在 MarginStudy 中打开文档再导出");
    return;
  }
  const { anns, cards, nodes } = await collect(plugin, docPath);
  const fname = basename(docPath);
  const isWord = anns.some((a) => a.docKind === "html");
  const out: string[] = [];
  out.push(`# MarginStudy 导出 · ${fname}`);
  out.push("");
  out.push(`> 由 MarginStudy 插件生成（${new Date().toLocaleString()}）`);
  out.push("");

  // 标注：PDF 按页，Word 单列「全文」
  out.push(isWord ? `## 标注（全文）` : `## 标注（按页）`);
  if (!anns.length) out.push("_无标注_");
  else if (isWord) {
    out.push("");
    for (const a of anns) {
      const label = annLabel(a);
      const body = a.type === "voice" ? "🎙 语音批注" : a.type === "pen" ? "✎ 手写批注" : escapeMd(a.text);
      out.push(`> [${label}] ${body}`);
      if (a.noteText) out.push(`> 批注：${escapeMd(a.noteText)}`);
    }
  } else {
    const byPage = new Map<number, Annotation[]>();
    for (const a of anns) {
      if (!byPage.has(a.page)) byPage.set(a.page, []);
      byPage.get(a.page)!.push(a);
    }
    for (const [page, list] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
      out.push("");
      out.push(`### 第 ${page} 页`);
      for (const a of list) {
        const label = annLabel(a);
        out.push(`> [${label}] ${escapeMd(a.text)}`);
        if (a.noteText) out.push(`> 批注：${escapeMd(a.noteText)}`);
      }
    }
  }

  // 卡片
  out.push("");
  out.push(`## 卡片`);
  const flashcards = cards.filter((c) => c.type === "flashcard");
  const excerpts = cards.filter((c) => c.type === "excerpt");
  const comments = cards.filter((c) => c.type === "comment");
  out.push("");
  out.push(`### 闪卡`);
  if (!flashcards.length) out.push("_无_");
  for (const c of flashcards) out.push(`- ${clozeForExport(c.front)} :: ${clozeForExport(c.back ?? "")}`);
  out.push("");
  out.push(`### 摘录卡`);
  if (!excerpts.length) out.push("_无_");
  for (const c of excerpts) out.push(`- ${clozeForExport(c.front)}`);
  out.push("");
  out.push(`### 评论卡`);
  if (!comments.length) out.push("_无_");
  for (const c of comments) out.push(`- ${clozeForExport(c.front)}`);

  // 导图
  out.push("");
  out.push(`## 思维导图`);
  const roots = rootsOf(nodes);
  if (!roots.length) out.push("_无节点_");
  else out.push(treeToMarkdown(roots, nodes));

  const content = out.join("\n");
  await writeOut(plugin, docPath, content, "md");
}

// ===== HTML 导出（自包含） =====
export async function exportHtml(plugin: MarginStudyPlugin, ad?: string): Promise<void> {
  await plugin.store.flush();
  const docPath = ad ?? plugin.activeReader?.getFilePath();
  if (!docPath) {
    new Notice("请先在 MarginStudy 中打开文档再导出");
    return;
  }
  const { anns, cards, nodes } = await collect(plugin, docPath);
  const fname = basename(docPath);

  const annHtml = anns.length
    ? anns
        .map((a) => {
          const label = annLabel(a);
          const body =
            a.type === "voice" ? "🎙 语音批注" : a.type === "pen" ? "✎ 手写批注" : escapeHtml(a.text);
          const note = a.noteText ? `<div class="note">批注：${escapeHtml(a.noteText)}</div>` : "";
          return `<div class="ann"><span class="tag">${label}</span> <span class="hl" style="background:${a.color}">${body}</span>${note}</div>`;
        })
        .join("")
    : "<p>（无标注）</p>";

  const cardHtml = (title: string, list: Card[]) =>
    `<h3>${title}</h3>` + (list.length ? list.map((c) => `<div class="card">${clozeHtml(c.front)}${c.back ? " :: " + clozeHtml(c.back) : ""}</div>`).join("") : "<p>（无）</p>");

  // SVG 导图
  const roots = rootsOf(nodes);
  let svg = "<p>（无节点）</p>";
  if (roots.length) {
    const pos = layoutTree(roots, nodes);
    let maxX = 0;
    let maxY = 0;
    pos.forEach((p) => {
      maxX = Math.max(maxX, p.x + 160);
      maxY = Math.max(maxY, p.y + 40);
    });
    const edgesSvg = plugin.store.edges
      .filter((e) => pos.has(e.from) && pos.has(e.to))
      .map((e: Edge) => {
        const a = pos.get(e.from)!;
        const b = pos.get(e.to)!;
        return `<line x1="${a.x + 150}" y1="${a.y + 15}" x2="${b.x}" y2="${b.y + 15}" stroke="#bbb" />`;
      })
      .join("");
    const nodesSvg = nodes
      .filter((n) => pos.has(n.id))
      .map((n) => {
        const p = pos.get(n.id)!;
        const fill = n.parentId === null ? "#4c8bf5" : "#fff";
        const color = n.parentId === null ? "#fff" : "#222";
        return `<g><rect x="${p.x}" y="${p.y}" width="150" height="30" rx="8" fill="${fill}" stroke="#ccc"/><text x="${p.x + 75}" y="${p.y + 19}" text-anchor="middle" fill="${color}" font-size="12">${escapeHtml(n.title.slice(0, 16))}</text></g>`;
      })
      .join("");
    svg = `<svg width="${maxX}" height="${maxY}">${edgesSvg}${nodesSvg}</svg>`;
  }

  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>MarginStudy · ${escapeHtml(fname)}</title>
<style>
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#222;line-height:1.6}
h1{border-bottom:2px solid #4c8bf5;padding-bottom:8px}
.ann{margin:6px 0;padding:6px 10px;background:#f7f7f9;border-radius:8px}
.tag{font-size:11px;color:#888;margin-right:6px}
.hl{border-radius:3px;padding:0 2px}
.note{font-size:12px;color:#666;margin-top:2px}
.card{margin:4px 0;padding:4px 8px;background:#fafafa;border-left:3px solid #4c8bf5;border-radius:4px}
svg{background:#fff;border:1px solid #eee;border-radius:8px}
</style></head><body>
<h1>MarginStudy 导出 · ${escapeHtml(fname)}</h1>
<p><small>由 MarginStudy 插件生成 · ${new Date().toLocaleString()}</small></p>
<h2>标注</h2>${annHtml}
<h2>卡片</h2>
${cardHtml("闪卡", cards.filter((c) => c.type === "flashcard"))}
${cardHtml("摘录卡", cards.filter((c) => c.type === "excerpt"))}
${cardHtml("评论卡", cards.filter((c) => c.type === "comment"))}
<h2>思维导图</h2>${svg}
</body></html>`;

  await writeOut(plugin, docPath, html, "html");
}

async function writeOut(plugin: MarginStudyPlugin, docPath: string, content: string, ext: string): Promise<void> {
  const outPath = docPath.replace(/\.(pdf|docx|epub|html?|md)$/i, "") + `.mstudy.${ext}`;
  const existing = plugin.app.vault.getAbstractFileByPath(outPath);
  if (existing instanceof TFile) await plugin.app.vault.modify(existing, content);
  else await plugin.app.vault.create(outPath, content);
  new Notice(`已导出到 ${outPath}`);
}

// ===== 进度统计 =====
export interface Stats {
  cards: number;
  flashcards: number;
  excerpts: number;
  comments: number;
  due: number;
  reviewed: number;
  annotations: number;
  nodes: number;
  edges: number;
}

export async function computeStats(plugin: MarginStudyPlugin): Promise<Stats> {
  const cards = plugin.store.cardsForStudySet("*");
  const due = plugin.store.dueCards();
  const withdrawn = new Set(plugin.store.reviewLogs.filter(log => log.undoneAt).map(reviewEventId));
  const reviewedIds = new Set(plugin.store.reviewLogs.filter(log => !log.initialization && !log.undoneAt && !withdrawn.has(reviewEventId(log))).map(log => log.cardId));
  const reviewed = cards.filter(card => reviewedIds.has(card.id));
  // 扫描所有 sidecar 统计标注总数
  let annotations = 0;
  const files = plugin.app.vault.getFiles().filter(f => f.path.endsWith(".mstudy.json") && !/^(?:MarginStudyBackups|MarginStudyRecovery)\//.test(f.path));
  for (const f of files) {
    try {
      const txt = await plugin.app.vault.read(f);
      const obj = JSON.parse(txt) as { annotations?: Annotation[] };
      annotations += obj.annotations?.length ?? 0;
    } catch {
      /* noop */
    }
  }
  return {
    cards: cards.length,
    flashcards: cards.filter((c) => c.type === "flashcard").length,
    excerpts: cards.filter((c) => c.type === "excerpt").length,
    comments: cards.filter((c) => c.type === "comment").length,
    due: due.length,
    reviewed: reviewed.length,
    annotations,
    nodes: plugin.store.nodes.length,
    edges: plugin.store.edges.length,
  };
}

export async function openStats(plugin: MarginStudyPlugin): Promise<void> {
  const s = await computeStats(plugin);
  const { modal, close } = createModal("学习统计");
  const row = (k: string, v: number | string): HTMLElement => {
    const r = el("div", { class: "ms-stat" });
    r.append(el("span", { text: k }), el("span", { text: String(v) }));
    return r;
  };
  modal.append(
    row("总卡片", s.cards),
    row("· 闪卡", s.flashcards),
    row("· 摘录卡", s.excerpts),
    row("· 评论卡", s.comments),
    row("当前脑图到期", s.due),
    row("已复习过", s.reviewed),
    row("标注总数", s.annotations),
    row("导图节点", s.nodes),
    row("关联线", s.edges)
  );

  // ===== 复习日历热力图（近 17 周） =====
  modal.append(el("div", { class: "ms-field-label", text: "复习日历（近 17 周）" }));
  const heat = el("div", { class: "ms-heatmap" });
  const hist = plugin.store.reviewHistory;
  const days: { date: string; count: number }[] = [];
  const today = new Date();
  for (let i = 118; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const key = `${y}-${m}-${day}`;
    days.push({ date: key, count: hist[key] ?? 0 });
  }
  for (const d of days) {
    const lvl = d.count === 0 ? 0 : d.count <= 1 ? 1 : d.count <= 3 ? 2 : d.count <= 6 ? 3 : 4;
    const cell = el("div", { class: "ms-heat-cell", "data-lvl": String(lvl) }) as HTMLElement;
    cell.title = `${d.date}：${d.count} 张`;
    heat.append(cell);
  }
  modal.append(heat);
  const legend = el("div", { class: "ms-heat-legend" });
  legend.append(
    el("span", { text: "少" }),
    el("div", { class: "ms-heat-cell", style: "display:inline-block" }),
    el("div", { class: "ms-heat-cell", "data-lvl": "2", style: "display:inline-block" }),
    el("div", { class: "ms-heat-cell", "data-lvl": "4", style: "display:inline-block" }),
    el("span", { text: "多" })
  );
  modal.append(legend);

  // ===== 复习间隔分布直方图 =====
  modal.append(el("div", { class: "ms-field-label", text: "复习间隔分布" }));
  const buckets = [
    { label: "≤1天", max: 1, n: 0 },
    { label: "2-3天", max: 3, n: 0 },
    { label: "4-7天", max: 7, n: 0 },
    { label: "8-14天", max: 14, n: 0 },
    { label: "15-30天", max: 30, n: 0 },
    { label: "31-90天", max: 90, n: 0 },
    { label: ">90天", max: Infinity, n: 0 },
  ];
  const questionIds = new Set(plugin.store.reviewPending.filter(p => p.scopeId === plugin.store.activeCanvasId && p.visited !== true && plugin.store.getCard(p.cardId) && !plugin.store.getCard(p.cardId)?.groupId).map(p => p.questionId));
  for (const [key,st] of Object.entries(plugin.store.srs)) {
    if (!questionIds.has(key)) continue;
    const iv = st.interval;
    for (const b of buckets) if (iv <= b.max) { b.n++; break; }
  }
  const maxN = Math.max(1, ...buckets.map((b) => b.n));
  const histEl = el("div", { class: "ms-hist" });
  for (const b of buckets) {
    const bar = el("div", { class: "ms-hist-bar" }) as HTMLElement;
    bar.style.height = `${Math.round((b.n / maxN) * 70)}px`;
    bar.title = `${b.label}：${b.n} 张`;
    bar.append(el("span", { text: b.label }));
    histEl.append(bar);
  }
  modal.append(histEl);

  const closeBtn = el("button", { class: "ms-btn primary", text: "关闭", style: "margin-top:18px" });
  closeBtn.addEventListener("click", close);
  modal.append(closeBtn);
}

// ===== Anki 兼容 TSV 导出 =====
// 格式：每行 `正面<TAB>答案<TAB>标签`，Anki 导入时选择「制表符」分隔即可。
export async function exportAnkiTsv(plugin: MarginStudyPlugin, ad?: string): Promise<void> {
  await plugin.store.flush();
  const docPath = ad ?? plugin.activeReader?.getFilePath();
  if (!docPath) {
    new Notice("请先在 MarginStudy 中打开文档再导出");
    return;
  }
  const cards = plugin.store.cardsOfDoc(docPath).filter(c => c.type === "flashcard" && !c.hidden && !c.groupId);
  if (!cards.length) {
    new Notice("当前文档没有闪卡可导出");
    return;
  }
  const lines = cards.map((c) => {
    const front = (c.front ?? "").replace(/\t/g, " ").replace(/\n/g, " ");
    const back = (c.back ?? "").replace(/\t/g, " ").replace(/\n/g, " ");
    const tags = (c.tags ?? []).join(" ");
    return `${front}\t${back}\t${tags}`;
  });
  const content = lines.join("\n");
  const outPath = docPath.replace(/\.(pdf|docx|epub|html?|md)$/i, "") + `.mstudy.anki.tsv`;
  const existing = plugin.app.vault.getAbstractFileByPath(outPath);
  if (existing instanceof TFile) await plugin.app.vault.modify(existing, content);
  else await plugin.app.vault.create(outPath, content);
  new Notice(`已导出 ${cards.length} 张闪卡到 ${outPath}（Anki 导入选「制表符」分隔）`);
}

// ===== 全库汇总导出（单 HTML） =====
export async function exportAllHtml(plugin: MarginStudyPlugin): Promise<void> {
  await plugin.store.flush();
  const cards = plugin.store.cardsForStudySet("*");
  if (!cards.length) {
    new Notice("还没有任何卡片可导出");
    return;
  }
  // 按文档分组
  const byDoc = new Map<string, Card[]>();
  for (const c of cards) {
    if (!byDoc.has(c.docPath)) byDoc.set(c.docPath, []);
    byDoc.get(c.docPath)!.push(c);
  }
  const esc = (s: string) => escapeHtml(s ?? "");
  const sections: string[] = [];
  for (const [doc, cs] of byDoc) {
    const items = cs
      .map((c) => {
        const tags = c.tags.length ? `<div class="tags">${c.tags.map((t) => `<span>#${esc(t)}</span>`).join(" ")}</div>` : "";
        const back = c.back ? `<div class="back">${clozeHtml(c.back)}</div>` : "";
        return `<li><div class="front">${clozeHtml(c.front)}</div>${back}${tags}</li>`;
      })
      .join("\n");
    sections.push(
      `<section><h2>${esc(basename(doc))}</h2><p class="path">${esc(doc)}</p><ul>${items}</ul></section>`
    );
  }
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>MarginStudy 学习库导出</title>
<style>
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:820px;margin:32px auto;padding:0 16px;color:#1a1a1a;line-height:1.6}
h1{color:#5b6cff}h2{margin-top:28px;border-left:4px solid #5b6cff;padding-left:8px}
.path{color:#888;font-size:12px;margin-top:-6px}
ul{list-style:none;padding:0}
li{background:#f6f7ff;border:1px solid #e6e8ff;border-radius:10px;padding:10px 12px;margin:8px 0}
.front{font-weight:600}.back{color:#444;margin-top:4px}
.tags span{display:inline-block;background:#eef;color:#5b6cff;border-radius:999px;padding:1px 8px;font-size:12px;margin:4px 4px 0 0}
section{break-inside:avoid}
</style></head><body>
<h1>MarginStudy 学习库导出</h1>
<p>共 ${cards.length} 张卡，来自 ${byDoc.size} 个文档。导出时间：${new Date().toLocaleString()}</p>
${sections.join("\n")}
</body></html>`;
  const stamp = (() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  })();
  const outPath = `MarginStudy-全库导出-${stamp}.html`;
  const existing = plugin.app.vault.getAbstractFileByPath(outPath);
  if (existing instanceof TFile) await plugin.app.vault.modify(existing, html);
  else await plugin.app.vault.create(outPath, html);
  new Notice(`已导出全库 ${cards.length} 张卡到 ${outPath}`);
}


// ===== Anki APKG 导出（A22） =====

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function apkgSourceText(card: Card): string {
  const page = card.sources?.[0]?.page ?? card.page;
  return page != null ? `${card.docPath} · 第 ${page} 页` : card.docPath;
}

/** 媒体解析：data URL 直接解码；vault 路径读二进制；其余一律按「媒体缺失」失败。 */
async function resolveApkgMedia(plugin: MarginStudyPlugin, cardId: string, src: string | undefined): Promise<ApkgMediaFile> {
  const dataUrl = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(src ?? "");
  if (dataUrl) {
    const ext = dataUrl[1].toLowerCase() === "image/jpeg" || dataUrl[1].toLowerCase() === "image/jpg" ? "jpg" : dataUrl[1].split("/")[1].toLowerCase();
    const bytes = base64ToBytes(dataUrl[2]);
    if (!bytes.length) throw new Error(`媒体缺失：${cardId}（图片内容为空）`);
    return { filename: `ms-${sha1Hex(bytes).slice(0, 16)}.${ext}`, data: bytes };
  }
  const file = plugin.app.vault.getAbstractFileByPath(src ?? "");
  if (file instanceof TFile) {
    const buffer = await plugin.app.vault.readBinary(file);
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (!bytes.length) throw new Error(`媒体缺失：${cardId}（${src} 内容为空）`);
    const ext = (file.extension || "png").toLowerCase();
    return { filename: `ms-${sha1Hex(bytes).slice(0, 16)}.${ext}`, data: bytes };
  }
  if (src?.startsWith("_marginstudy-media/") && await plugin.app.vault.adapter.exists(src)) {
    const bytes = new Uint8Array(await plugin.app.vault.adapter.readBinary(src));
    if (!bytes.length) throw new Error(`媒体缺失：${cardId}（${src} 内容为空）`);
    const ext = src.split(".").pop()!.toLowerCase();
    return { filename: `ms-${sha1Hex(bytes).slice(0, 16)}.${ext}`, data: bytes };
  }
  throw new Error(`媒体缺失：${cardId}（${src || "空引用"}）`);
}

function percent(value: number): number { return Math.round(value * 10000) / 100; }

/** 遮挡元素统一画在归一化 svg（viewBox 0 0 100 100）里：正面目标纯黑遮蔽，背面全部揭示带标签。 */
function maskOverlaySvg(mask: ImageOcclusion, mode: "target-hidden" | "revealed"): string {
  const label = escapeHtml(mask.label ?? mask.id);
  const look = mode === "target-hidden"
    ? 'fill="#111" stroke="#000" stroke-width="0.6"'
    : 'fill="rgba(91,108,255,0.12)" stroke="#5b6cff" stroke-width="0.5"';
  if (mask.points?.length) {
    const points = mask.points.map((p) => `${percent(p.x)},${percent(p.y)}`).join(" ");
    return `<polygon points="${points}" ${look} data-ms-mask="${mask.id}"/>`;
  }
  const labelTag = mode === "revealed"
    ? `<text x="${percent(mask.x) + 1}" y="${percent(mask.y) + 4}" font-size="3" fill="#5b6cff">${label}</text>`
    : "";
  return `<rect x="${percent(mask.x)}" y="${percent(mask.y)}" width="${percent(mask.width)}" height="${percent(mask.height)}" ${look} data-ms-mask="${mask.id}"/>${labelTag}`;
}

function occlusionFrame(imageName: string, inner: string): string {
  return `<div class="ms-occ" style="position:relative;display:inline-block;max-width:100%">` +
    `<img src="${imageName}" style="max-width:100%;display:block">` +
    `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">${inner}</svg></div>`;
}

function occlusionFrontHtml(imageName: string, target: ImageOcclusion, others: ImageOcclusion[]): string {
  return occlusionFrame(imageName, [maskOverlaySvg(target, "target-hidden"), ...others.map((mask) => maskOverlaySvg(mask, "revealed"))].join(""));
}

function occlusionBackHtml(imageName: string, masks: ImageOcclusion[]): string {
  return occlusionFrame(imageName, masks.map((mask) => maskOverlaySvg(mask, "revealed")).join(""));
}

function imageTagsHtml(filenames: string[]): string {
  if (!filenames.length) return "";
  return `<div class="ms-occ-images">` + filenames.map((name) => `<img src="${name}" style="max-width:100%;display:block;margin:6px auto">`).join("") + `</div>`;
}

function stampText(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * 批量导出 Anki 牌组（APKG）：闪卡正反面/挖空 + 任意卡片的图片遮挡题，
 * 含模板、图片、回源文本与标签；TSV 导出保留不变。
 * 任一媒体缺失时抛错，不写任何文件。
 */
export async function exportAnkiApkg(plugin: MarginStudyPlugin, ad?: string): Promise<void> {
  await plugin.store.flush();
  const docPath = ad ?? plugin.activeReader?.getFilePath();
  const cards = (docPath ? plugin.store.cardsOfDoc(docPath) : plugin.store.cardsForStudySet("*"))
    .filter(card => !card.hidden && !card.groupId);
  const deckName = docPath ? basename(docPath) : "MarginStudy 全库";

  // 第一阶段：构建笔记规格并解析全部媒体；任何失败都在写文件之前抛出
  const notes: ApkgNoteSpec[] = [];
  const mediaByKey = new Map<string, ApkgMediaFile>();
  const useMedia = async (cardId: string, src: string | undefined): Promise<string> => {
    const key = src ?? "";
    if (!mediaByKey.has(key)) mediaByKey.set(key, await resolveApkgMedia(plugin, cardId, src));
    return mediaByKey.get(key)!.filename;
  };
  for (const card of cards) {
    const material = reviewMaterial(card);
    const source = apkgSourceText(card);
    const tags = card.tags ?? [];
    const questions = questionsForCard(card);
    const images = material.showImages ? cardImages(card) : [];
    const imageNames: string[] = [];
    for (const image of images) imageNames.push(await useMedia(card.id, image));
    if (card.type === "flashcard") {
      const basic = questions.find((question) => question.kind === "basic");
      if (basic) notes.push({
        guid: `ms${sha1Hex(card.id + "::basic").slice(0, 12)}`,
        model: "basic",
        fields: { Front: material.front + imageTagsHtml(imageNames), Back: material.back, Source: source },
        tags,
      });
      const clozeQuestions = questions.filter((question) => question.kind === "cloze");
      if (clozeQuestions.length) notes.push({
        guid: `ms${sha1Hex(card.id + "::cloze").slice(0, 12)}`,
        model: "cloze",
        fields: { Text: material.front + imageTagsHtml(imageNames), Extra: material.back, Source: source },
        tags,
        ords: [...new Set(clozeQuestions.map((question) => question.clozeIndex!))].sort((a, b) => a - b).map((index) => index - 1),
      });
    }
    const occlusionQuestions = questions.filter((question) => question.kind === "occlusion");
    if (occlusionQuestions.length) {
      const masks = validOcclusions(card);
      if (!imageNames.length) throw new Error(`媒体缺失：${card.id}（遮挡题没有底图）`);
      const imageName = imageNames[0];
      for (const question of occlusionQuestions) {
        const mask = masks.find((item) => item.id === question.maskId);
        if (!mask) continue;
        const others = masks.filter((item) => item.id !== mask.id);
        notes.push({
          guid: `ms${sha1Hex(card.id + "::occ:" + mask.id).slice(0, 12)}`,
          model: "occlusion",
          fields: {
            Occlusion: occlusionFrontHtml(imageName, mask, others),
            Reveal: occlusionBackHtml(imageName, masks),
            Extra: material.back,
            Source: source,
          },
          tags,
        });
      }
    }
  }
  if (!notes.length) {
    new Notice("没有可导出的闪卡或遮挡题");
    return;
  }

  const { data, manifest } = buildApkg({
    deckName,
    notes,
    media: [...mediaByKey.values()],
  });

  // 第二阶段：一次性写出；失败不产生伪成功文件
  const outPath = docPath
    ? docPath.replace(/\.(pdf|docx|epub|html?|md)$/i, "") + ".mstudy.apkg"
    : `MarginStudy-Anki-导出-${stampText()}.apkg`;
  const binary = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const existing = plugin.app.vault.getAbstractFileByPath(outPath);
  if (existing instanceof TFile) await plugin.app.vault.modifyBinary(existing, binary);
  else await plugin.app.vault.createBinary(outPath, binary);
  new Notice(`已导出 Anki 牌组（${manifest.noteCount} 笔记 / ${manifest.cardCount} 卡 / ${manifest.mediaCount} 媒体）到 ${outPath}`);
}
