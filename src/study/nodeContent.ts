import type { Store } from "../model/store";
import type { MindNode } from "../types";
import { cardImages } from "../review/content";

/** Card-backed nodes share canonical content; a cloned card has a separate identity. */
export function nodeContent(store: Store, node: MindNode): {
  title: string;
  heading: string;
  excerpt: string;
  note: string;
  comments: string[];
  docPath: string;
  color?: string;
  tags: string[];
  images: string[];
} {
  const card = node.cardId ? store.getCard(node.cardId) : undefined;
  return {
    title: card ? card.title || card.front : node.title,
    heading: card ? card.title ?? "" : node.title,
    excerpt: card?.extendMedia?.some(media=>media.noteId===card.anchorAnnId&&media.composed)?"":card?.front ?? "",
    note: card?.back ?? "",
    comments: [...(card?.extendText??[]).map(item=>item.text).filter(Boolean),...(node.comments ?? [])],
    docPath: card?.docPath ?? node.docPath ?? "",
    color: card ? card.color : node.color,
    tags: card?.tags ?? node.tags ?? [],
    images: card ? cardImages(card) : node.image ? [node.image] : [],
  };
}
