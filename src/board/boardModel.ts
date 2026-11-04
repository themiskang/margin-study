import type { Store } from "../model/store";
import type { Card, MindNode } from "../types";
import type { OutlineItem } from "../pdf/outline";
import { uid } from "../utils/id";

export type BoardGrouping = "none" | "document" | "color" | "tag" | "created" | "modified" | "titlelink" | "directory" | "query" | "mapstate" | "blank";
export type BoardSource = { kind: "all" } | { kind: "studyset" | "canvas" | "document"; id: string };
export interface BoardQuery { id: string; label: string; query: string; }
export interface BoardContext { queries?: BoardQuery[]; outlines?: Map<string, OutlineItem[]>; }
export type BoardCard = Card & { boardNodeId?: string };
export interface BoardGroupValue { key: string; label: string; color?: string; hierarchy?: { key: string; label: string }[]; }
export interface BoardBucket extends BoardGroupValue { path: string; cards: Card[]; children: BoardBucket[]; }
export const BOARD_GROUPINGS: [BoardGrouping, string][] = [
  ["none", "不分组"], ["document", "文档"], ["color", "颜色"], ["tag", "标签"], ["directory", "文档目录"],
  ["created", "创建日期"], ["modified", "修改日期"], ["titlelink", "标题链接"], ["query", "复合搜索"], ["mapstate", "脑图状态"], ["blank", "留白 / 摘录"],
];
export const BOARD_DRAG_TYPE = "application/margin-study-board-cards";

const sourcePaths = (card: Card): string[] => [...new Set([card.docPath, ...(card.sources ?? []).map((source) => source.docPath)].filter(Boolean))];
const basename = (path: string) => path.split("/").pop() || path;

export function resolveBoardCard(store: Store, id: string): BoardCard | undefined {
  const card = store.getCard(id); if (card) return card;
  const node = id.startsWith("board-node:") ? store.getNode(id.slice(11)) : undefined;
  if (!node || node.cardId || node.hidden) return;
  return { id, boardNodeId: node.id, docPath: node.docPath ?? "", type: "comment", front: node.title,
    image: node.image, color: node.color, tags: node.tags ?? [], links: [], createdAt: "", updatedAt: node.updatedAt, occluded: node.occluded };
}

/** Local nodes are converted only when the user edits them, never while reading. */
export function materializeBoardCards(store: Store, ids: string[]): string[] {
  return store.libraryTransaction("将大纲节点作为卡片编辑", () => ids.flatMap((id) => {
    const card = resolveBoardCard(store, id); if (!card) return [];
    if (!card.boardNodeId) return [id];
    const copy = store.detachNodeReference(card.boardNodeId, false); if (!copy) return [];
    store.updateCard(copy.id, { title: undefined, front: card.front }); return [copy.id];
  }));
}

export function cardsFromBoardSource(store: Store, source: BoardSource): BoardCard[] {
  const cards = source.kind === "studyset" ? store.cardsForStudySet(source.id) : store.cards;
  const set = source.kind === "studyset" ? store.studySets.find((candidate) => candidate.id === source.id) : undefined;
  const canvases = new Set(store.canvases.filter((canvas) => canvas.studySetId === set?.id).map((canvas) => canvas.id));
  const local = store.nodes.filter((node) => !node.cardId && !node.hidden
    && (source.kind !== "studyset" || (node.canvasId ? canvases.has(node.canvasId) : !!node.docPath && !!set?.docPaths.includes(node.docPath)))
    && (source.kind !== "canvas" || node.canvasId === source.id))
    .map((node) => resolveBoardCard(store, `board-node:${node.id}`)!).filter(Boolean);
  const inCanvas = source.kind === "canvas" ? new Set(store.nodes.filter((node) => node.canvasId === source.id).map((node) => node.cardId)) : null;
  return [...cards.filter((card) => !card.hidden && !card.groupId
    && (source.kind !== "document" || sourcePaths(card).includes(source.id))
    && (!inCanvas || inCanvas.has(card.id))), ...local.filter((card) => source.kind !== "document" || sourcePaths(card).includes(source.id))];
}

/** Space = AND, spaced | = OR, -term = exclusion. Quoted values remain intact. */
export function boardMatchesQuery(store: Store, card: Card, query: string): boolean {
  if (!query.trim()) return true;
  const comments = store.nodes.filter((node) => node.cardId === card.id || node.id === (card as BoardCard).boardNodeId).flatMap((node) => node.comments ?? []);
  const full = [card.title, card.front, card.back, ...comments, ...card.tags, ...(card.keywords ?? [])].filter(Boolean).join("\n").toLocaleLowerCase();
  return query.split(/\s+\|\s+/).some((arm) => {
    const pattern = /(-?)(?:(title|tag|doc|note|link|color|is):)?(?:"([^"]*)"|(\S+))/g;
    let match: RegExpExecArray | null, count = 0;
    while ((match = pattern.exec(arm))) {
      count++;
      const [, minus, field, quoted, raw] = match, value = (quoted ?? raw ?? "").toLocaleLowerCase();
      let found: boolean;
      if (field === "is") {
        const mapped = !!(card as BoardCard).boardNodeId || store.nodes.some((node) => node.cardId === card.id);
        found = value === "mapped" ? mapped : value === "unmapped" ? !mapped : value === "blank" ? !!card.blank : value === "favorite" ? !!card.favorite : false;
      } else {
        const haystack = field === "title" ? card.title ?? "" : field === "tag" ? card.tags.join("\n") : field === "doc" ? sourcePaths(card).join("\n")
          : field === "note" ? [card.back ?? "", ...comments].join("\n") : field === "link" ? (card.keywords ?? []).join("\n") : field === "color" ? card.color ?? "" : full;
        found = haystack.toLocaleLowerCase().includes(value);
      }
      if (minus ? found : !found) return false;
    }
    return count > 0;
  });
}

export function boardGroupValues(store: Store, card: Card, grouping: BoardGrouping, context: BoardContext = {}): BoardGroupValue[] {
  const value = (key: string, label = key, color?: string): BoardGroupValue => ({ key, label, color });
  if (grouping === "none") return [value("all", "全部卡片")];
  if (grouping === "color") return [card.color ? value(card.color.toLowerCase(), card.color.toUpperCase(), card.color) : value("none", "无颜色")];
  if (grouping === "tag") return card.tags.length ? [...new Set(card.tags)].map((tag) => value(tag, `#${tag.replace(/^#/, "")}`)) : [value("none", "无标签")];
  if (grouping === "document") return sourcePaths(card).length ? sourcePaths(card).map((path) => value(path, basename(path))) : [value("none", "无来源文档")];
  if (grouping === "created" || grouping === "modified") {
    const date = grouping === "created" ? card.createdAt : card.updatedAt;
    return [value(date?.slice(0, 10) || "none", date?.slice(0, 10) || (grouping === "created" ? "无创建记录" : "无修改记录"))];
  }
  if (grouping === "titlelink") return card.keywords?.length ? [...new Set(card.keywords)].map((keyword) => value(keyword)) : [value("none", "无标题链接")];
  if (grouping === "mapstate") return [(card as BoardCard).boardNodeId || store.nodes.some((node) => node.cardId === card.id) ? value("mapped", "已加入脑图") : value("unmapped", "未加入脑图")];
  if (grouping === "blank") return [card.blank ? value("blank", "留白") : value("excerpt", "摘录 / 笔记")];
  if (grouping === "query") {
    const matches = (context.queries ?? []).filter((query) => boardMatchesQuery(store, card, query.query)).map((query) => value(query.id, query.label));
    return matches.length ? matches : [value("unmatched", context.queries?.length ? "未匹配搜索组" : "尚未设置搜索组")];
  }
  const entries = sourcePaths(card).flatMap((path) => {
    const items = context.outlines?.get(path);
    if (!items) return [value(`${path}:unavailable`, `${basename(path)} · 目录未加载`)];
    const page = path === card.docPath ? card.page : card.sources?.find((source) => source.docPath === path)?.page;
    const stack: OutlineItem[] = [];
    for (const item of items) if (item.page > 0 && item.page <= (page ?? 0)) { while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop(); stack.push(item); }
    if (!stack.length) return [value(`${path}:none`, `${basename(path)} · 无目录位置`)];
    const hierarchy = [{ key: `${path}:document`, label: basename(path) }, ...stack.map((item, index) => ({
      key: `${path}:${stack.slice(0, index + 1).map((ancestor) => ancestor.title).join("/")}`, label: item.title,
    }))];
    return [{ key: hierarchy[hierarchy.length - 1].key, label: hierarchy.map((item) => item.label).join(" › "), hierarchy }];
  });
  return entries.length ? entries : [value("none", "无来源目录")];
}

export function groupBoardCards(store: Store, cards: Card[], first: BoardGrouping, second: BoardGrouping, context: BoardContext = {}, filters: { first?: Set<string>; second?: Set<string> } = {}): BoardBucket[] {
  const groups: BoardBucket[] = [];
  const insert = (items: BoardBucket[], value: BoardGroupValue, card: Card, prefix: string[] = []): BoardBucket => {
    let bucket: BoardBucket | undefined;
    for (const step of value.hierarchy ?? [value]) {
      bucket = items.find((item) => item.key === step.key);
      if (!bucket) { bucket = { ...step, color: value.color, path: JSON.stringify([...prefix, step.key]), cards: [], children: [] }; items.push(bucket); }
      if (!bucket.cards.some((item) => item.id === card.id)) bucket.cards.push(card);
      prefix = [...prefix, step.key]; items = bucket.children;
    }
    return bucket!;
  };
  for (const card of cards) for (const primary of boardGroupValues(store, card, first, context)) {
    if (filters.first && !filters.first.has(primary.key)) continue;
    const secondary = second === "none" ? [] : boardGroupValues(store, card, second, context).filter((item) => !filters.second || filters.second.has(item.key));
    if (second !== "none" && !secondary.length) continue;
    const root = insert(groups, primary, card);
    for (const value of secondary) insert(root.children, value, card, JSON.parse(root.path) as string[]);
  }
  const sort = (items: BoardBucket[]) => items.sort((a, b) => a.key === "none" ? 1 : b.key === "none" ? -1 : a.label.localeCompare(b.label, "zh-CN", { numeric: true }));
  const sortTree = (items: BoardBucket[]) => { sort(items); for (const group of items) sortTree(group.children); };
  sortTree(groups); return groups;
}

/** Board drag and its explicit button both materialize independent card copies. */
export function copyBoardCards(store: Store, cardIds: string[], options: { canvasId?: string; parentId?: string | null; x?: number; y?: number } = {}): string[] {
  return store.libraryTransaction("从看板复制卡片到脑图", () => {
    const ids: string[] = [], canvasId = options.canvasId ?? store.activeCanvasId;
    for (const cardId of [...new Set(cardIds)]) {
      const source = resolveBoardCard(store, cardId); if (!source || source.groupId || source.hidden) continue;
      let copy: Card | undefined;
      if (source.boardNodeId) { const { boardNodeId: _nodeId, ...content } = source; copy = { ...content, id: uid("card"), createdAt: new Date().toISOString() }; store.addCard(copy); }
      else copy = store.cloneCard(cardId);
      if (!copy) continue;
      const node: MindNode = { id: uid("node"), cardId: copy.id, canvasId, parentId: options.parentId ?? null, title: copy.title || copy.front,
        docPath: copy.docPath, collapsed: false, reference: false, x: options.x ?? 80, y: (options.y ?? 80) + ids.length * 170 };
      store.addNode(node); ids.push(node.id);
    }
    return ids;
  });
}
