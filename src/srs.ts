// Scheduling uses the maintained ts-fsrs implementation. MarginNote's own
// scheduler has not been established; this is our independently chosen model.
import { createEmptyCard, fsrs, generatorParameters, State } from "ts-fsrs";
import type { Card as FsrsCard, Grade } from "ts-fsrs";
import type { CardState } from "./types";

export const REVIEW_ALGORITHM = "ts-fsrs/FSRS-6";
const DAY_MS = 86_400_000;
const scheduler = fsrs(generatorParameters({
  request_retention: 0.9,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
}));

export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayStr(): string { return fmtDate(new Date()); }

/** Old date-only values mean local midnight, not UTC midnight. */
export function reviewDate(value: unknown, fallback: Date = new Date()): Date {
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : value instanceof Date ? new Date(value) : typeof value === "string" || typeof value === "number" ? new Date(value) : fallback;
  return Number.isFinite(date.getTime()) ? date : new Date(fallback);
}

function finite(value: unknown, fallback: number, min = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, value) : fallback;
}

/** Preserve old progress while upgrading the representation, not its history. */
export function normalizeState(raw: any, defaultEase: number, now = new Date()): CardState {
  const interval = finite(raw?.interval, 0);
  const due = reviewDate(raw?.due, now);
  const reps = Math.floor(finite(raw?.reps, 0));
  const state = Number.isInteger(raw?.state) && raw.state >= 0 && raw.state <= 3
    ? raw.state : interval > 0 || reps > 0 ? State.Review : State.New;
  const inferredLast = new Date(due.getTime() - interval * DAY_MS);
  return {
    due: due.toISOString(),
    interval,
    ease: finite(raw?.ease, defaultEase, 1),
    reps,
    stability: finite(raw?.stability, interval),
    difficulty: Math.min(10, finite(raw?.difficulty, state === State.New ? 0 : 5)),
    lapses: Math.floor(finite(raw?.lapses, 0)),
    state,
    lastReviewed: raw?.lastReviewed ? reviewDate(raw.lastReviewed, inferredLast).toISOString()
      : state !== State.New ? inferredLast.toISOString() : undefined,
    learningSteps: Math.floor(finite(raw?.learningSteps, 0)),
    elapsedDays: finite(raw?.elapsedDays, 0),
    scheduledDays: finite(raw?.scheduledDays, interval),
    algorithm: typeof raw?.algorithm === "string" ? raw.algorithm : "legacy",
  } as CardState;
}

export function freshState(ease: number, now = new Date()): CardState {
  return normalizeState({ due: now.toISOString(), ease, state: State.New }, ease, now);
}

export function isDue(state: CardState | undefined, now: Date | string = new Date()): boolean {
  if (!state) return true;
  if (typeof now === "string" && /^\d{4}-\d{2}-\d{2}$/.test(now)) return fmtDate(reviewDate(state.due)) <= now;
  return reviewDate(state.due).getTime() <= reviewDate(now).getTime();
}

/** Exported to compare integration behaviour against upstream reference output. */
export function toFsrsCard(state: CardState, now = new Date()): FsrsCard {
  const normalized = normalizeState(state, state.ease || 2.5, now) as CardState & {
    learningSteps?: number; elapsedDays?: number; scheduledDays?: number;
  };
  if (normalized.state === State.New) return createEmptyCard(reviewDate(normalized.due, now));
  const last = reviewDate(normalized.lastReviewed, new Date(now.getTime() - normalized.interval * DAY_MS));
  return {
    due: reviewDate(normalized.due, now),
    stability: Math.max(0.1, normalized.stability),
    difficulty: Math.max(1, Math.min(10, normalized.difficulty)),
    elapsed_days: normalized.elapsedDays ?? 0,
    scheduled_days: normalized.scheduledDays ?? normalized.interval,
    learning_steps: normalized.learningSteps ?? 0,
    reps: normalized.reps,
    lapses: normalized.lapses,
    state: normalized.state as State,
    last_review: last > now ? now : last,
  };
}

/** 1=Again, 2=Hard, 3=Good, 4=Easy. Pure: preview and grading share this path. */
export function schedule(state: CardState, rating: number, now = new Date(), maxInterval?: number): CardState {
  if (![1, 2, 3, 4].includes(rating)) throw new Error("评分必须为 1–4");
  const result = scheduler.next(toFsrsCard(state, now), now, rating as Grade).card;
  if (maxInterval !== undefined && Number.isFinite(maxInterval) && maxInterval > 0 && result.due.getTime() - now.getTime() > maxInterval * DAY_MS) {
    result.due = new Date(now.getTime() + maxInterval * DAY_MS);
    result.scheduled_days = maxInterval;
  }
  return {
    due: result.due.toISOString(),
    interval: Math.max(0, (result.due.getTime() - now.getTime()) / DAY_MS),
    ease: state.ease,
    reps: result.reps,
    stability: result.stability,
    difficulty: result.difficulty,
    lapses: result.lapses,
    state: result.state,
    lastReviewed: result.last_review?.toISOString(),
    learningSteps: result.learning_steps,
    elapsedDays: result.elapsed_days,
    scheduledDays: result.scheduled_days,
    algorithm: REVIEW_ALGORITHM,
  } as CardState;
}

export function previewInterval(state: CardState, rating: number, now = new Date(), maxInterval?: number): number {
  return schedule(state, rating, now, maxInterval).interval;
}

export function intervalLabel(days: number): string {
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 1440))} 分钟`;
  if (days < 1) return `${Math.round(days * 24 * 10) / 10} 小时`;
  return `${Math.round(days * 10) / 10} 天`;
}
