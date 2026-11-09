import type { Card, CardState, CardType, Stroke } from "../types";

/** An enrolled question has one live pending record; nil/false both mean pending. */
export interface ReviewPending {
  id: string;
  cardId: string;
  questionId: string;
  scopeId?: string;
  deckId?: string;
  due: string;
  queuedAt: string;
  visited?: boolean | null;
}

/** A question owns its schedule; several questions may share the source card. */
export interface ReviewLog {
  id: string;
  cardId: string;
  questionId: string;
  scopeId?: string;
  deckId?: string;
  rating: number;
  reviewedAt: string;
  elapsedMs: number;
  before: CardState;
  after: CardState;
  previousWrong: boolean;
  undoneAt?: string;
  algorithm: string;
  cardSnapshot?: Card;
  commentText?: string;
  drawing?: Stroke[][];
  /** Setup is kept for undo, but is not a completed review or a daily count. */
  initialization?: boolean;
}

export type PracticeVerdict = "correct" | "wrong" | "partial";

export interface PracticeAttempt {
  id: string;
  cardId: string;
  studySetId: string;
  at: string;
  answer: string;
  verdict: PracticeVerdict;
  mistake?: string;
  correctionOf?: string;
  questionId?: string;
  questionKind?: "basic" | "cloze" | "occlusion";
}

export interface PracticeAttemptInput extends Omit<PracticeAttempt, "id" | "at"> {}

export interface StudySetPracticeSettings {
  deckId?: string;
  tags?: string[];
  favorite?: boolean;
}

export interface GradeOptions {
  questionId?: string;
  elapsedMs?: number;
  now?: Date;
  scopeId?: string;
  deckId?: string;
  commentText?: string;
  drawing?: Stroke[][];
}

/** Templates contain text, never executable code. */
export interface CardTemplate {
  id: string;
  name: string;
  front: string;
  back?: string;
  fields?: string[];
  type?: CardType;
  createdAt?: string;
}

export interface ImageOcclusion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  /** Optional freehand polygon in normalized source-image coordinates. */
  points?: { x: number; y: number }[];
}

export interface ReviewOptions {
  presentation?: "browse" | "score";
  wrong?: boolean;
  studySetId?: string;
  docPaths?: string[];
  cardIds?: string[];
  scopeId?: string;
  deckId?: string;
  favorite?: boolean;
  tags?: string[];
  colors?: string[];
  ratings?: number[];
  order?: "added" | "due" | "position" | "text" | "random";
  shuffleSeed?: string;
}

export interface StudySetReviewSettings {
  dueOnly: boolean;
  favorite?: boolean;
  tags?: string[];
  docPaths?: string[];
  colors?: string[];
  ratings?: number[];
  order?: ReviewOptions["order"];
  shuffleSeed?: string;
}

export interface ReviewDeckSummary {
  cards: number;
  questions: number;
  due: number;
  learning: number;
  reviewedToday: number;
  nextDue?: string;
}
