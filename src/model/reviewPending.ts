import type { Card, PluginData } from "../types";
import type { ReviewPending } from "../review/contracts";
import { questionsForCard } from "../review/questions";

export function cardsIncludingMembers(cards: Card[]): Card[] {
  const all = new Map<string,Card>();
  const visit = (card: Card) => {
    if (all.has(card.id)) return;
    all.set(card.id,card);
    for (const member of card.mergedCards ?? []) if (member.id !== card.id) visit(member);
  };
  cards.forEach(visit); return [...all.values()];
}

/** Missing field means legacy migration; an explicit empty list means unenrolled. */
export function reviewPendingForData(data: Partial<PluginData>): ReviewPending[] {
  if (data.reviewPending) return data.reviewPending.map(entry => ({...entry}));
  return cardsIncludingMembers(data.cards ?? []).flatMap(card => questionsForCard(card).flatMap(question => {
    const state = data.srs?.[question.id] ?? data.srs?.[card.id];
    return state ? [{id:"pending-legacy:"+question.id,cardId:card.id,questionId:question.id,due:state.due,
      queuedAt:state.lastReviewed ?? data.savedAt ?? card.updatedAt ?? card.createdAt ?? "1970-01-01T00:00:00.000Z"}] : [];
  }));
}

/** Resolve a question's latest row before discarding completed/visited rows. */
export function coalesceReviewPending(entries: ReviewPending[]): ReviewPending[] {
  const latest = new Map<string,ReviewPending>();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== "string" || typeof entry.cardId !== "string" || typeof entry.questionId !== "string" || !Number.isFinite(Date.parse(entry.due))) continue;
    const previous = latest.get(entry.questionId);
    const time = Date.parse(entry.queuedAt), previousTime = previous ? Date.parse(previous.queuedAt) : -Infinity;
    if (!previous || (Number.isFinite(time) ? time : -Infinity) > (Number.isFinite(previousTime) ? previousTime : -Infinity)
      || time === previousTime && entry.visited === true && previous.visited !== true) latest.set(entry.questionId,{...entry});
  }
  return [...latest.values()];
}
