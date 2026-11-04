import type { Card, CardState } from "../types";
import { clozeIndices } from "../utils/markdown";
import type { ImageOcclusion, ReviewLog } from "./contracts";
import { reviewMaterial } from "./presentation";

export interface ReviewQuestion {
  id: string;
  cardId: string;
  scopeId?: string;
  deckId?: string;
  kind: "basic" | "cloze" | "occlusion";
  clozeIndex?: number;
  maskId?: string;
}

export function validOcclusions(card: Card): ImageOcclusion[] {
  return (card.occlusions ?? []).filter((mask) => {
    if (!mask.id || ![mask.x, mask.y, mask.width, mask.height].every(Number.isFinite) ||
      mask.x < 0 || mask.y < 0 || mask.width <= 0 || mask.height <= 0 ||
      mask.x + mask.width > 1.000001 || mask.y + mask.height > 1.000001) return false;
    if (!mask.points) return true;
    return mask.points.length >= 3 && mask.points.every((point) =>
      Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
  });
}

export function questionsForCard(card: Card, scopeId?: string, deckId?: string): ReviewQuestion[] {
  const prefix = deckId ? `${card.id}::deck:${deckId}::` : scopeId ? `${card.id}::scope:${scopeId}::` : `${card.id}::`;
  const material = reviewMaterial(card);
  const questions: ReviewQuestion[] = clozeIndices(material.front, material.configured ? "" : material.back).map((index) => ({
    id: `${prefix}cloze:${index}`, cardId: card.id, ...(scopeId && { scopeId }), ...(deckId && { deckId }), kind: "cloze", clozeIndex: index,
  }));
  const hasImages = !!(card.image || card.images?.length || card.sources?.some(source => source.image) ||
    card.extendMedia?.some(media => media.image) || card.commentMedia?.some(media => media.image));
  if (material.showImages && hasImages) for (const mask of validOcclusions(card)) questions.push({
    id: `${prefix}occlusion:${mask.id}`, cardId: card.id, ...(scopeId && { scopeId }), ...(deckId && { deckId }), kind: "occlusion", maskId: mask.id,
  });
  return questions.length ? questions : [{ id: scopeId || deckId ? `${prefix}basic` : card.id, cardId: card.id, ...(scopeId && { scopeId }), ...(deckId && { deckId }), kind: "basic" }];
}

export function questionWasWrong(card: Card, question: ReviewQuestion, logs: ReviewLog[]): boolean {
  let latest: ReviewLog | undefined;
  for (const log of logs) if (!log.undoneAt && !log.initialization && log.questionId === question.id &&
    (!latest || log.reviewedAt >= latest.reviewedAt)) latest = log;
  return latest?.rating === 1;
}

interface PendingQuestion { question: ReviewQuestion; readyAt: number; }

/** Session ordering and undo live together, independent of rendering or storage. */
export class ReviewSession {
  private pending: PendingQuestion[];
  private history: { pending: PendingQuestion[]; answered: number; logId: string }[] = [];
  answered = 0;

  constructor(questions: ReviewQuestion[]) {
    this.pending = questions.map((question) => ({ question, readyAt: 0 }));
  }

  get remaining(): number { return this.pending.length; }
  get lastLogId(): string | undefined { return this.history[this.history.length - 1]?.logId; }
  get nextReadyAt(): number { return this.pending.length ? Math.min(...this.pending.map((item) => item.readyAt)) : 0; }
  current(now = Date.now()): ReviewQuestion | undefined { return this.pending.find((item) => item.readyAt <= now)?.question; }

  grade(question: ReviewQuestion, state: CardState, logId: string, now = Date.now()): void {
    this.history.push({ pending: this.pending.map((item) => ({ ...item })), answered: this.answered, logId });
    const index = this.pending.findIndex((item) => item.question.id === question.id);
    if (index >= 0) this.pending.splice(index, 1);
    this.answered++;
    const readyAt = new Date(state.due).getTime();
    if ((state.state === 1 || state.state === 3) && Number.isFinite(readyAt) && readyAt < now + 86_400_000) {
      this.pending.push({ question, readyAt: Math.max(now + 1000, readyAt) });
    }
  }

  discard(questionId: string): void { this.pending = this.pending.filter((item) => item.question.id !== questionId); }
  undo(): void {
    const previous = this.history.pop();
    if (previous) { this.pending = previous.pending; this.answered = previous.answered; }
  }
}
