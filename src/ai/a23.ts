import { AiError } from "./contracts";
import type { AiHost } from "./contracts";
import { uid } from "../utils/id";

export function saveAnswerBranch(host: AiHost, reply: string, docPath = ""): string[] {
  const text = reply.trim();
  if (!text || text.length > 500000) throw new AiError("draft", "回答为空或过长，请手动重试。");
  const rows: { title: string; level: number; note: string }[] = [];
  let base = 0;
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const depth = heading[1].length;
      if (!rows.length) base = depth;
      const level = depth - base;
      if (level < 0 || rows.length && (level === 0 || level > rows[rows.length - 1].level + 1)) throw new AiError("draft", "标题层级无法转换，请手动重试。");
      rows.push({ title: heading[2], level, note: "" });
    } else if (line.trim()) {
      if (!rows.length) { rows.push({ title: line.trim(), level: 0, note: "" }); base = 0; }
      else rows[rows.length - 1].note += (rows[rows.length - 1].note ? "\n" : "") + line;
    }
  }
  if (!rows.length || rows.length > 200 || rows.some(row => row.title.length > 500 || row.note.length > 60000)) throw new AiError("draft", "回答无法转换，请手动重试。");
  return host.store.libraryTransaction("回答转脑图分支", () => {
    const ids: string[] = [], parents: string[] = [];
    for (const [index, row] of rows.entries()) {
      const id = uid("node"), cardId = uid("card");
      host.store.addCard({ id: cardId, docPath, type: "comment", title: row.title, front: "", back: row.note, tags: [], links: [], createdAt: new Date().toISOString() });
      const card = host.store.getCard(cardId)!;
      if (card.color === undefined) delete card.color;
      if (card.colorIndex === undefined) delete card.colorIndex;
      host.store.addNode({ id, cardId, docPath, canvasId: host.store.activeCanvasId, parentId: row.level ? parents[row.level - 1] : null, title: row.title, collapsed: false, x: 40 + row.level * 280, y: 40 + index * 100 });
      ids.push(id); parents[row.level] = id; parents.length = row.level + 1;
    }
    return ids;
  });
}

export function writeAnswerSelection(host: AiHost, nodeId: string, selection: string, kind: "comment" | "title"): void {
  const text = selection.trim(), node = host.store.getNode(nodeId);
  if (!node || !text) throw new AiError("draft", "请选择回答文字和一个脑图节点，再手动重试。");
  host.store.libraryTransaction(kind === "comment" ? "选段写评论" : "选段设标题", () => {
    if (kind === "comment") host.store.updateNode(nodeId, { comments: [...node.comments ?? [], text] });
    else host.store.updateNode(nodeId, { title: text });
  });
}
