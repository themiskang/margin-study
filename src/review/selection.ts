import type { Card } from "../types";
import type { Store } from "../model/store";
import type { ReviewOptions } from "./contracts";
import type { ReviewQuestion } from "./questions";
import { reviewMaterial } from "./presentation";

export function filterReviewCards(cards: Card[], options: ReviewOptions): Card[] {
  return cards.filter(card => !card.hidden && !card.groupId &&
    (!options.cardIds || options.cardIds.includes(card.id)) &&
    (!options.docPaths || options.docPaths.includes(card.docPath) || card.sources?.some(source => options.docPaths!.includes(source.docPath))) &&
    (!options.favorite || card.favorite) && (!options.tags?.length || options.tags.every(tag => card.tags.some(candidate => candidate === tag || !tag.includes("/") && candidate.startsWith(tag + "/")))) &&
    (!options.colors?.length || options.colors.includes(card.color ?? "")));
}

function shuffledKey(id: string, seed: string): number {
  let value = 2166136261;
  for (const char of seed + ":" + id) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d); value ^= value >>> 15;
  return value >>> 0;
}

/** The browser and scoring share the same intersection and stable session order. */
export function filterAndOrderReviewQuestions(store: Store, questions: ReviewQuestion[], options: ReviewOptions): ReviewQuestion[] {
  const latest = new Map<string, { rating: number; reviewedAt: string }>();
  for (const log of store.reviewLogs) if (!log.initialization && !log.undoneAt) {
    const previous = latest.get(log.questionId); if (!previous || previous.reviewedAt <= log.reviewedAt) latest.set(log.questionId, log);
  }
  const result = questions.filter(question => !options.ratings?.length || options.ratings.includes(latest.get(question.id)?.rating ?? 0));
  const order = options.order; if (!order) return result;
  const deck = options.deckId ? store.getReviewDeck(options.deckId) : undefined;
  const card = (question: ReviewQuestion) => store.getCard(question.cardId)!;
  const due = (question: ReviewQuestion) => new Date(store.getReviewState(question.cardId, question.id).due).getTime();
  const compare = (left: ReviewQuestion, right: ReviewQuestion): number => {
    if (order === "random") return shuffledKey(left.id, options.shuffleSeed ?? "default") - shuffledKey(right.id, options.shuffleSeed ?? "default");
    if (order === "due") return due(left) - due(right);
    const a = card(left), b = card(right);
    if (order === "added") return deck ? deck.cardIds.indexOf(a.id) - deck.cardIds.indexOf(b.id) : a.createdAt.localeCompare(b.createdAt);
    if (order === "text") return reviewMaterial(a).front.localeCompare(reviewMaterial(b).front);
    return (a.docPath || a.sources?.[0]?.docPath || "").localeCompare(b.docPath || b.sources?.[0]?.docPath || "") ||
      (a.page ?? a.sources?.[0]?.page ?? 0) - (b.page ?? b.sources?.[0]?.page ?? 0);
  };
  return result.slice().sort((a,b) => compare(a,b) || a.id.localeCompare(b.id));
}
