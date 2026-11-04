import { AiError } from "./contracts";
import type { AiDraft } from "./contracts";
import { validateDraft } from "./drafts";

/** Explicit pasted reply -> editable preview. Does not read plugin history or save data. */
export function draftFromPastedReply(kind: AiDraft["kind"], reply: string): AiDraft {
  const text = reply.trim();
  if (!text || text.length > 500000) throw new AiError("draft", "请粘贴非空的 AI 回复，最多 50 万字符。" );
  const fence = text.match(/^```(?:json|markdown|md)?\s*\n([\s\S]*?)\n```$/i), raw = fence?.[1]?.trim() ?? text;
  if (raw.startsWith("{")) {
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { if (kind !== "markdown") throw new AiError("draft", "JSON 不完整，请修正后再生成预览。" ); }
    if (value) return validateDraft(kind, value);
  }
  if (kind === "cards") return validateDraft(kind, { cards: [{ title: "", excerpt: raw, note: "", tags: [] }] });
  if (kind === "markdown") return validateDraft(kind, { title: raw.match(/^#\s+(.+)$/m)?.[1]?.trim() || "AI 笔记", markdown: raw });
  const lines = raw.split(/\r?\n/), items: { title: string; level: number; note: string }[] = [];
  let title = "AI 目录", previous = 0, headingBase: number | undefined;
  for (const line of lines) {
    if (!line.trim()) { if (items.length) items[items.length - 1].note += "\n"; continue; }
    const heading = line.match(/^(#{1,8})\s+(.+)$/), bullet = line.match(/^(\s*)(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
    if (!items.length && heading?.[1] === "#" && title === "AI 目录") { title = heading[2].trim(); headingBase = 1; continue; }
    if (heading || bullet) {
      if (heading && headingBase === undefined) headingBase = heading[1].length - 1;
      const requested = heading ? Math.max(1, heading[1].length - headingBase!) : 1 + Math.floor(bullet![1].replace(/\t/g, "  ").length / 2);
      const level = Math.min(8, previous + 1, requested);
      items.push({ title: (heading?.[2] ?? bullet![2]).trim(), level, note: "" }); previous = level;
    } else if (items.length) items[items.length - 1].note += (items[items.length - 1].note ? "\n" : "") + line;
    else throw new AiError("draft", "目录请粘贴 JSON、Markdown 标题或列表。正文可改用卡片或 Markdown 预览。" );
  }
  return validateDraft(kind, { title, items: items.map(item => ({ ...item, note: item.note.trim() })) });
}
