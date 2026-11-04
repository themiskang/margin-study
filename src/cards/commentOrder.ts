import type { Card } from "../types";

export interface CardCommentItem { key: string; text?: string; image?: string; }

/** New or restored comments append in their legacy order; stale and duplicate keys are ignored. */
export function orderedCommentKeys(keys: string[], preferred: readonly string[] = []): string[] {
  const available=new Set(keys);
  return [...new Set([...preferred.filter(key=>available.has(key)),...keys])];
}

/** Sources and composed excerpts remain outside the movable comment sequence. */
export function cardCommentItems(card: Card): CardCommentItem[] {
  const items: CardCommentItem[]=[
    ...(card.extendMedia??[]).filter(item=>item.noteId!==card.anchorAnnId).map(item=>({key:"extend-media:"+item.noteId,image:item.image})),
    ...(card.back?.trim()?[{key:"back",text:card.back}]:[]),
    ...(card.extendText??[]).filter(item=>item.text.trim()).map(item=>({key:"extend-text:"+item.noteId,text:item.text})),
    ...(card.commentMedia??[]).map(item=>({key:"media:"+item.id,image:item.image})),
  ];
  return orderedCommentKeys(items.map(item=>item.key),card.commentOrder).map(key=>items.find(item=>item.key===key)!);
}
