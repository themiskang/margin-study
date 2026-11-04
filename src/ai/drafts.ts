import { AiError } from "./contracts";
import type { AiDraft, AiHost, ToolDefinition } from "./contracts";
import type { MindNode } from "../types";
import { uid } from "../utils/id";

const textProperty = { type: "string" };
const objectSchema = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const DRAFT_TOOLS: ToolDefinition[] = [
  { type: "function", function: { name: "propose_cards", description: "Prepare editable study cards. This creates a preview only; the user saves it explicitly.", strict: true,
    parameters: objectSchema({ cards: { type: "array", minItems: 1, maxItems: 100, items: objectSchema({ title: textProperty, excerpt: textProperty, note: textProperty, tags: { type: "array", items: textProperty } }) } }) } },
  { type: "function", function: { name: "propose_outline", description: "Prepare a title and ordered outline. Levels start at 1 and increase by at most one per row. Preview only.", strict: true,
    parameters: objectSchema({ title: textProperty, items: { type: "array", minItems: 1, maxItems: 200, items: objectSchema({ title: textProperty, level: { type: "integer", minimum: 1, maximum: 8 }, note: textProperty }) } }) } },
  { type: "function", function: { name: "propose_markdown", description: "Prepare a Markdown note for editable preview. Never writes a file automatically.", strict: true,
    parameters: objectSchema({ title: textProperty, markdown: textProperty }) } },
];

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiError("draft", "预览须是有效的 JSON 对象。" );
  return value as Record<string, any>;
}
function text(value: unknown, label: string, required = false, limit = 60000): string {
  if (typeof value !== "string" || value.length > limit || required && !value.trim()) throw new AiError("draft", `${label}为空、格式错误或过长。`);
  return value;
}
export function validateDraft(kind: AiDraft["kind"], value: unknown): AiDraft {
  const input = object(value);
  if (kind === "cards") {
    if (!Array.isArray(input.cards) || input.cards.length < 1 || input.cards.length > 100) throw new AiError("draft", "请提供 1 至 100 张卡片。" );
    return { kind, cards: input.cards.map((item: unknown) => {
      const card = object(item);
      const excerpt = text(card.excerpt, "卡片正文", false), note = text(card.note ?? "", "卡片笔记", false);
      if (!excerpt.trim() && !note.trim()) throw new AiError("draft", "每张卡片至少需要正文或笔记。" );
      const tags = card.tags ?? [];
      if (!Array.isArray(tags) || tags.length > 30) throw new AiError("draft", "卡片标签格式错误。" );
      return { title: text(card.title ?? "", "卡片标题", false, 500), excerpt, note,
        tags: [...new Set(tags.map((tag: unknown) => text(tag, "标签", true, 100).trim()))] };
    }) };
  }
  if (kind === "outline") {
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 200) throw new AiError("draft", "目录需要 1 至 200 行。" );
    let previous = 0;
    const items = input.items.map((item: unknown) => {
      const row = object(item), level = row.level;
      if (!Number.isInteger(level) || level < 1 || level > 8 || level > previous + 1) throw new AiError("draft", "目录层级从 1 开始，每行最多增加一级。" );
      previous = level;
      return { title: text(row.title, "目录标题", true, 500), level, note: text(row.note ?? "", "目录笔记") };
    });
    return { kind, title: text(input.title, "总标题", true, 500), items };
  }
  return { kind: "markdown", title: text(input.title ?? "AI 笔记", "笔记标题", true, 500), markdown: text(input.markdown, "Markdown", true, 500000) };
}

export function draftFromTool(name: string, argumentsText: string): AiDraft {
  const kind = name === "propose_cards" ? "cards" : name === "propose_outline" ? "outline" : name === "propose_markdown" ? "markdown" : undefined;
  if (!kind) throw new AiError("tool", "模型请求了未提供的工具。" );
  let parsed: unknown;
  try { parsed = JSON.parse(argumentsText); } catch { throw new AiError("draft", "模型返回的预览 JSON 无法解析，请重试。" ); }
  return validateDraft(kind, parsed);
}
export function draftEditorText(draft: AiDraft): string {
  if (draft.kind === "markdown") return draft.markdown;
  const { kind, ...value } = draft;
  return JSON.stringify(value, null, 2);
}
export function editedDraft(original: AiDraft, editorText: string, title?: string): AiDraft {
  if (original.kind === "markdown") return validateDraft("markdown", { title: title ?? original.title, markdown: editorText });
  let value: unknown;
  try { value = JSON.parse(editorText); } catch { throw new AiError("draft", "预览中的 JSON 格式不完整，请修正后保存。" ); }
  return validateDraft(original.kind, value);
}

/** The only data-changing boundary. Call after a user has edited/reviewed and clicked Save. */
export function saveLibraryDraft(host: AiHost, proposal: AiDraft, docPath = ""): string[] {
  const draft = validateDraft(proposal.kind, proposal);
  if (draft.kind === "markdown") throw new AiError("draft", "Markdown 请另存为新笔记。" );
  return host.store.libraryTransaction(draft.kind === "cards" ? "保存 AI 卡片预览" : "保存 AI 目录预览", () => {
    const ids: string[] = [];
    if (draft.kind === "cards") {
      for (const card of draft.cards) {
        const id = uid("card"); ids.push(id);
        host.store.addCard({ id, docPath, type: "flashcard", title: card.title || undefined, front: card.excerpt,
          back: card.note, tags: card.tags, links: [], createdAt: new Date().toISOString() });
      }
      return ids;
    }
    const canvasId = host.store.activeCanvasId;
    const root: MindNode = { id: uid("node"), title: draft.title, parentId: null, canvasId, collapsed: false, x: 40, y: 40, docPath };
    host.store.addNode(root); ids.push(root.id);
    const parents = [root.id];
    for (const [index, item] of draft.items.entries()) {
      const id = uid("node"), cardId = uid("card"); ids.push(id);
      host.store.addCard({ id: cardId, docPath, type: "comment", title: item.title, front: "", back: item.note,
        tags: [], links: [], createdAt: new Date().toISOString() });
      host.store.addNode({ id, cardId, canvasId, parentId: parents[item.level - 1], title: item.title, collapsed: false,
        x: 40 + item.level * 280, y: 40 + (index + 1) * 100, docPath });
      parents[item.level] = id; parents.length = item.level + 1;
    }
    return ids;
  });
}

export function defaultMarkdownFilename(title: string): string {
  return (title.replace(/[\\/:*?"<>|\x00-\x1f]/g, " ").replace(/^\.+/, "").trim().slice(0, 100) || "AI 笔记") + ".md";
}
export async function saveMarkdownDraft(host: AiHost, proposal: AiDraft, filename: string): Promise<string> {
  const draft = validateDraft("markdown", proposal);
  if (draft.kind !== "markdown") throw new AiError("draft", "Markdown 格式错误。" );
  const name = filename.trim();
  if (!name || name.includes("/") || name.includes("\\") || name.startsWith(".") || /[\x00-\x1f:*?"<>|]/.test(name) || !name.toLowerCase().endsWith(".md")) {
    throw new AiError("filename", "请填写当前库根目录中的新 .md 文件名。" );
  }
  if (host.app.vault.getAbstractFileByPath(name)) throw new AiError("exists", "同名笔记已存在，请更换文件名后保存。" );
  try { await host.app.vault.create(name, draft.markdown); }
  catch { throw new AiError("save", "新笔记保存失败，请检查文件名和库的写入权限。" ); }
  return name;
}
