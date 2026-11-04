import type MarginStudyPlugin from "../main";
import type { MindmapFragment } from "../types";

/** Shared between outline and graph so copied cards survive a view change. */
export const cardClipboard: {
  fragment: MindmapFragment | null;
  mode: "clone" | "reference";
  cut: { store: MarginStudyPlugin["store"]; roots: string[]; snapshot: string } | null;
} = { fragment: null, mode: "clone", cut: null };

export function copySingleCard(plugin: MarginStudyPlugin, nodeId: string, mode: "clone" | "reference"): boolean {
  const node = plugin.store.getNode(nodeId), card = node?.cardId ? plugin.store.getCard(node.cardId) : undefined;
  if (!node || !card) return false;
  cardClipboard.fragment = structuredClone({ nodes: [node], edges: [], cards: [card] });
  cardClipboard.mode = mode;
  cardClipboard.cut = null;
  return true;
}
