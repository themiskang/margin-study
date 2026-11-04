import type { PluginData, ReviewDeck } from "../types";
import type { ReviewPending } from "../review/contracts";

/** Derive a compatibility container without rewriting old schedules or history. */
export function reviewDecksForData(data: Partial<PluginData>, pending: ReviewPending[]): ReviewDeck[] {
  if (data.reviewDecks) return data.reviewDecks.map(deck => ({ ...deck, cardIds: [...new Set(deck.cardIds ?? [])], studySetIds: [...new Set(deck.studySetIds ?? [])] }));
  const groups = new Map<string | undefined, ReviewPending[]>();
  for (const row of pending) if (!row.deckId && row.visited !== true) {
    const entries = groups.get(row.scopeId) ?? []; entries.push(row); groups.set(row.scopeId, entries);
  }
  return [...groups].map(([scopeId, entries]) => {
    const canvas = data.canvases?.find(item => item.id === scopeId);
    const studySetId = canvas?.studySetId;
    return { id: `review-legacy-${scopeId ?? "unscoped"}`, name: canvas ? `${canvas.name} · 旧版复习` : "旧版复习卡组",
      cardIds: [...new Set(entries.map(item => item.cardId))], studySetIds: studySetId ? [studySetId] : [],
      createdAt: entries.map(item => item.queuedAt).sort()[0] || "1970-01-01T00:00:00.000Z", legacyScopeId: scopeId ?? null };
  });
}
