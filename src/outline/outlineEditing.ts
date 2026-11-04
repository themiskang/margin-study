import type { Store } from "../model/store";
import type { Card, MindNode } from "../types";
import { uid } from "../utils/id";
import type { NodeContentPart } from "../study/nodeActions";

export function outlineText(store: Store, node: MindNode, part: NodeContentPart): string {
  const card = node.cardId ? store.getCard(node.cardId) : undefined;
  return card ? (part === "title" ? card.title : part === "note" ? card.back : card.front) ?? "" : part === "title" ? node.title : "";
}

export function setOutlineText(store: Store, id: string, part: NodeContentPart, text: string): void {
  const node = store.getNode(id);
  if (!node || outlineText(store, node, part) === text) return;
  if (node.cardId) store.updateCard(node.cardId, { [part === "title" ? "title" : part === "note" ? "back" : "front"]: text });
  else if (part === "title") store.updateNode(id, { title: text });
}

export function outlineSiblings(store: Store, node: MindNode, visibleOnly = false): MindNode[] {
  return store.getScopedNodes().filter((candidate) => candidate.parentId === node.parentId && candidate.canvasId === node.canvasId
    && (!visibleOnly || (!candidate.hidden && !(candidate.cardId && store.getCard(candidate.cardId)?.groupId))))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function indentOutlineNode(store: Store, id: string, outdent = false): boolean {
  const node = store.getNode(id);
  if (!node) return false;
  if (outdent) {
    const parent = node.parentId ? store.getNode(node.parentId) : undefined;
    if (!parent) return false;
    const index = outlineSiblings(store, parent).findIndex((candidate) => candidate.id === parent.id) + 1;
    store.reparentNode(id, parent.parentId, index);
  } else {
    const siblings = outlineSiblings(store, node, true);
    const index = siblings.findIndex((candidate) => candidate.id === id);
    if (index <= 0) return false;
    const parent = siblings[index - 1];
    store.libraryTransaction("大纲缩进", () => {
      store.reparentNode(id, parent.id);
      if (parent.collapsed) store.updateNode(parent.id, { collapsed: false });
    });
  }
  return true;
}

export function addOutlineNode(store: Store, after?: MindNode, child = false): string {
  return store.libraryTransaction("大纲新增节点", () => {
    const card: Card = { id: uid("card"), docPath: after?.docPath ?? "", type: "comment", front: "", tags: [], links: [], blank: true, createdAt: new Date().toISOString() };
    const node: MindNode = { id: uid("node"), cardId: card.id, canvasId: after?.canvasId ?? store.activeCanvasId,
      docPath: card.docPath, parentId: child ? after?.id ?? null : after?.parentId ?? null, title: "", collapsed: false,
      x: (after?.x ?? 40) + (child ? 280 : 0), y: (after?.y ?? 0) + 160 };
    const index = after && !child ? outlineSiblings(store, after).findIndex((candidate) => candidate.id === after.id) + 1 : undefined;
    store.addCard(card); store.addNode(node); store.reparentNode(node.id, node.parentId, index);
    if (child && after?.collapsed) store.updateNode(after.id, { collapsed: false });
    return node.id;
  });
}

/** Enter splits at the caret, replacing a selected range. The tail receives focus. */
export function splitOutlineNode(store: Store, id: string, part: NodeContentPart, start: number, end = start): { headId: string; tailId: string } | undefined {
  const node = store.getNode(id);
  if (!node) return;
  const text = outlineText(store, node, part);
  if (start < 0 || end < start || end > text.length) return;
  return store.libraryTransaction("大纲回车拆分", () => {
    if (start === text.length) return { headId: id, tailId: addOutlineNode(store, node) };
    if (!node.cardId) {
      const tailId = addOutlineNode(store, node);
      setOutlineText(store, id, "title", text.slice(0, start));
      const tail = store.getNode(tailId)!;
      setOutlineText(store, tailId, "excerpt", text.slice(end));
      if (tail.cardId) store.updateCard(tail.cardId, { blank: false });
      return { headId: id, tailId };
    }
    // The shared Store split inserts its head before the existing tail and
    // retains source/identity metadata on the appropriate content half.
    const children = store.nodes.filter((candidate) => candidate.parentId === id).map((candidate) => candidate.id);
    const headId = store.splitNodeContent(id, part, start, end - start);
    if (!headId) return;
    for (const childId of children) store.reparentNode(childId, headId);
    return { headId, tailId: id };
  });
}

/** Uses the recoverable merge so sources, comments, images and children survive. */
export function mergeOutlinePrevious(store: Store, id: string, previousId: string, part: NodeContentPart): { id: string; part: NodeContentPart; caret: number } | undefined {
  const node = store.getNode(id), previous = store.getNode(previousId);
  if (!node || !previous || id === previousId || node.canvasId !== previous.canvasId) return;
  return store.libraryTransaction("大纲退格合并", () => {
    const head = outlineText(store, previous, part), tail = outlineText(store, node, part);
    const bothLocal = !node.cardId && !previous.cardId;
    const keepId = store.mergeNodes([previousId, id]);
    const keep = keepId ? store.getNode(keepId) : undefined;
    if (!keep?.cardId) return;
    // Keep field boundaries when merging heterogeneous cards. Identical fields
    // concatenate at the caret just like deleting the boundary in an editor.
    if (head || !tail) setOutlineText(store, keep.id, part, head + tail);
    if (bothLocal && part === "title") store.updateCard(keep.cardId, { front: "" });
    const card = store.getCard(keep.cardId)!;
    const focusPart = head || !tail ? part : card.title ? "title" : card.front ? "excerpt" : "note";
    return { id: keep.id, part: focusPart, caret: head.length };
  });
}
