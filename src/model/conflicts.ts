import type { Card, CardState, Edge, MindNode, PluginData } from "../types";
import type { ReviewLog, ReviewPending } from "../review/contracts";
import { uid } from "../utils/id";
import { cardsIncludingMembers, coalesceReviewPending, reviewPendingForData } from "./reviewPending";
import { reviewDecksForData } from "./reviewDecks";

/** Several retained card versions can refer to the same historical review event. */
type RetainedReviewLog = ReviewLog & { conflictEventId?: string };
type Collection = "cards" | "nodes" | "studySets" | "canvases" | "documents" | "cardTemplates" | "sceneTemplates" | "reviewLogs" | "practiceAttempts" | "reviewPending" | "reviewDecks";
type RecordWithId = { id: string; [field: string]: unknown };
type IdMaps = Record<Collection, Map<string, string>>;
const collections: Collection[] = ["cards", "nodes", "studySets", "canvases", "documents", "cardTemplates", "sceneTemplates", "reviewLogs", "practiceAttempts", "reviewPending", "reviewDecks"];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// Object insertion order has no bearing on a conflict; list order still does.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(item => canonical(item ?? null)).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
const same = (left: unknown, right: unknown): boolean => canonical(left) === canonical(right);
const rows = (data: PluginData, collection: Collection): RecordWithId[] => (data[collection] ?? []) as unknown as RecordWithId[];

/** Stable across a conflict copy, so a shared past review is never counted twice. */
export function reviewEventId(log: ReviewLog): string {
  return (log as RetainedReviewLog).conflictEventId || log.id;
}

function reviewDay(log: ReviewLog): string | undefined {
  if (log.initialization) return undefined;
  const date = new Date(log.reviewedAt);
  if (!Number.isFinite(date.getTime()) || !Number.isInteger(log.rating) || log.rating < 1 || log.rating > 4) return undefined;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** A withdrawal on either copy wins over an older, still-active copy of an event. */
export function effectiveReviewCounts(logs: ReviewLog[]): Record<string, number> {
  const events = new Map<string, { day?: string; undone: boolean }>();
  for (const log of logs) {
    const id = reviewEventId(log);
    if (!id) continue;
    const previous = events.get(id);
    if (previous) {
      previous.undone ||= !!log.undoneAt;
      previous.day ??= reviewDay(log);
    } else events.set(id, { day: reviewDay(log), undone: !!log.undoneAt });
  }
  const counts: Record<string, number> = {};
  for (const { day, undone } of events.values()) if (day && !undone) counts[day] = (counts[day] ?? 0) + 1;
  return counts;
}

/**
 * Keep both sides of an explicit conflict, including the remote graph and schedules.
 * Mappings propagate until stable: an otherwise equal child also needs a remote copy
 * when its card, parent, canvas or study set has been copied.
 *
 * Settings and same-path document metadata prefer local values. The caller archives
 * the complete input snapshots before offering this merge, including those values.
 */
export function mergePreservingVersions(local: PluginData, remote: PluginData): PluginData {
  // Each side must migrate independently. An explicit [] on one side cannot
  // suppress a missing-field legacy queue on the other side.
  local = {...local,reviewPending:reviewPendingForData(local)};
  remote = {...remote,reviewPending:reviewPendingForData(remote)};
  local.reviewDecks = reviewDecksForData(local, local.reviewPending!);
  remote.reviewDecks = reviewDecksForData(remote, remote.reviewPending!);
  const maps = Object.fromEntries(collections.map(key => [key, new Map<string, string>()])) as IdMaps;
  const submapIds = new Map<string, string>();
  const localRows = Object.fromEntries(collections.map(key => [key, new Map(rows(local, key).map(item => [item.id, item]))])) as Record<Collection, Map<string, RecordWithId>>;
  const reserved = new Set(collections.flatMap(key => [...rows(local, key), ...rows(remote, key)].map(item => item.id)));
  for (const canvas of [...local.canvases ?? [], ...remote.canvases ?? []]) for (const submap of canvas.submaps ?? []) reserved.add(submap.id);
  const mapped = (collection: Collection, id: string): string => maps[collection].get(id) ?? id;
  const allocate = (collection: Collection, id: string): boolean => {
    if (maps[collection].has(id)) return false;
    let next: string;
    do { next = uid(collection + "-conflict"); } while (reserved.has(next));
    maps[collection].set(id, next); reserved.add(next);
    return true;
  };
  const cardRoot = (questionId: string): string => questionId.split("::", 1)[0];
  const questionId = (original: string): string => {
    // Only the card portions change; cloze indices and mask IDs are local to a card.
    const merged = original.indexOf("::merged:");
    if (merged >= 0) return questionId(original.slice(0, merged)) + "::merged:" + questionId(original.slice(merged + "::merged:".length));
    const suffix = original.indexOf("::");
    const result = suffix < 0 ? mapped("cards", original) : mapped("cards", original.slice(0, suffix)) + original.slice(suffix);
    return result.replace(/::scope:([^:]+)::/, (_match, id: string) => "::scope:" + mapped("canvases", id) + "::")
      .replace(/::deck:([^:]+)::/, (_match, id: string) => "::deck:" + mapped("reviewDecks", id) + "::");
  };
  const states = (source: Record<string, CardState>): Record<string, CardState> => Object.fromEntries(Object.entries(source).map(([key, state]) => [questionId(key), clone(state)]));
  const node = (original: MindNode): MindNode => {
    const item = clone(original);
    item.id = mapped("nodes", original.id);
    if (item.cardId) item.cardId = mapped("cards", item.cardId);
    if (item.parentId) item.parentId = mapped("nodes", item.parentId);
    if (item.canvasId) item.canvasId = mapped("canvases", item.canvasId);
    if (item.sourceNodeId) item.sourceNodeId = mapped("nodes", item.sourceNodeId);
    if (item.submapId && item.canvasId) item.submapId = submapIds.get(`${original.canvasId}:${item.submapId}`) ?? item.submapId;
    return item;
  };
  const edge = (original: Edge): Edge => ({ ...clone(original), from: mapped("nodes", original.from), to: mapped("nodes", original.to) });
  const card = (original: Card): Card => {
    const item = clone(original);
    item.id = mapped("cards", original.id);
    item.links = (original.links ?? []).map(id => mapped("cards", id));
    if (original.groupId) item.groupId = mapped("cards", original.groupId);
    if (original.sourceCardId) item.sourceCardId = mapped("cards", original.sourceCardId);
    if (original.templateId) item.templateId = rows(remote, "sceneTemplates").some(template => template.id === original.templateId && template.cardTemplate)
      ? mapped("sceneTemplates", original.templateId) : mapped("cardTemplates", original.templateId);
    if (original.vocabulary?.studySetId) item.vocabulary = { ...original.vocabulary, studySetId: mapped("studySets", original.vocabulary.studySetId) };
    if (original.mergedCards) item.mergedCards = original.mergedCards.map(card);
    if (original.mergedReviewStates) item.mergedReviewStates = states(original.mergedReviewStates);
    if (original.mergeArchive) item.mergeArchive = {
      ...clone(original.mergeArchive),
      nodes: original.mergeArchive.nodes.map(node),
      edges: original.mergeArchive.edges.map(edge),
      memberships: original.mergeArchive.memberships.map(membership => ({
        ...clone(membership), studySetId: mapped("studySets", membership.studySetId),
        ...(membership.cardIds && { cardIds: membership.cardIds.map(id => mapped("cards", id)) }),
      })),
      ...(original.mergeArchive.presentation && {presentation:{...clone(original.mergeArchive.presentation),
        ...(original.mergeArchive.presentation.links && {links:original.mergeArchive.presentation.links.map(id => mapped("cards",id))})}}),
      ...(original.mergeArchive.collapsedNodeIds && {collapsedNodeIds:original.mergeArchive.collapsedNodeIds.map(id => mapped("nodes",id))}),
      ...(original.mergeArchive.movedParents && {movedParents:original.mergeArchive.movedParents.map(move => ({id:mapped("nodes",move.id),before:move.before?mapped("nodes",move.before):null,after:move.after?mapped("nodes",move.after):null}))}),
      ...(original.mergeArchive.mappedEdges && {mappedEdges:original.mergeArchive.mappedEdges.map(edge)}),
      ...(original.mergeArchive.cardLinks && {cardLinks:original.mergeArchive.cardLinks.map(entry => ({cardId:mapped("cards",entry.cardId),links:entry.links.map(id => mapped("cards",id)),mergedLinks:entry.mergedLinks.map(id => mapped("cards",id))}))}),
    };
    return item;
  };
  const transform = (collection: Collection, original: RecordWithId): RecordWithId => {
    const item = collection === "cards" ? card(original as unknown as Card) as unknown as RecordWithId :
      collection === "nodes" ? node(original as unknown as MindNode) as unknown as RecordWithId : clone(original);
    item.id = mapped(collection, original.id);
    if (collection === "studySets") {
      if (Array.isArray(item.cardIds)) item.cardIds = (item.cardIds as string[]).map(id => mapped("cards", id));
      if (item.reviewDeckId) item.reviewDeckId = mapped("reviewDecks", item.reviewDeckId as string);
      const practice = item.practiceSettings as { deckId?: string } | undefined;
      if (practice?.deckId) practice.deckId = mapped("reviewDecks", practice.deckId);
      const scene = item.scene as { templateId?: string } | undefined;
      if (scene && typeof scene.templateId === "string") scene.templateId = mapped("sceneTemplates", scene.templateId);
      const destination = item.excerptDestination as { canvasId?: string; nodeId?: string } | undefined;
      if (destination && typeof destination.canvasId === "string" && typeof destination.nodeId === "string") {
        destination.canvasId = mapped("canvases", destination.canvasId);
        destination.nodeId = mapped("nodes", destination.nodeId);
      }
    } else if (collection === "reviewDecks") {
      item.cardIds = ((item.cardIds ?? []) as string[]).map(id => mapped("cards", id));
      item.studySetIds = ((item.studySetIds ?? []) as string[]).map(id => mapped("studySets", id));
      if (typeof item.legacyScopeId === "string") item.legacyScopeId = mapped("canvases", item.legacyScopeId);
    } else if (collection === "canvases") {
      item.studySetId = mapped("studySets", item.studySetId as string);
      if (Array.isArray(item.submaps)) item.submaps = (item.submaps as { id: string; rootNodeId: string }[]).map(submap => ({
        ...submap, id: submapIds.get(`${original.id}:${submap.id}`) ?? submap.id, rootNodeId: mapped("nodes", submap.rootNodeId),
      }));
    } else if (collection === "reviewLogs") {
      const log = item as unknown as RetainedReviewLog;
      log.cardId = mapped("cards", log.cardId);
      log.questionId = questionId(log.questionId);
      if (log.scopeId) log.scopeId = mapped("canvases", log.scopeId);
      if (log.deckId) log.deckId = mapped("reviewDecks", log.deckId);
      if (log.cardSnapshot) log.cardSnapshot = card(log.cardSnapshot);
      const saved = log as ReviewLog & { pendingBefore?: ReviewPending };
      if (saved.pendingBefore) saved.pendingBefore = { ...saved.pendingBefore, cardId: mapped("cards", saved.pendingBefore.cardId), questionId: questionId(saved.pendingBefore.questionId), scopeId: saved.pendingBefore.scopeId ? mapped("canvases", saved.pendingBefore.scopeId) : undefined,
        ...(saved.pendingBefore.deckId && { deckId: mapped("reviewDecks", saved.pendingBefore.deckId) }) };
      if (item.id !== original.id) log.conflictEventId = reviewEventId(original as unknown as ReviewLog);
    } else if (collection === "practiceAttempts") {
      if (typeof item.cardId === "string") item.cardId = mapped("cards", item.cardId);
      if (typeof item.studySetId === "string") item.studySetId = mapped("studySets", item.studySetId);
      if (typeof item.questionId === "string") item.questionId = questionId(item.questionId);
      if (typeof item.correctionOf === "string") item.correctionOf = mapped("practiceAttempts", item.correctionOf);
    } else if (collection === "reviewPending") {
      const pending = item as unknown as ReviewPending;
      pending.cardId = mapped("cards", pending.cardId); pending.questionId = questionId(pending.questionId);
      if (pending.scopeId) pending.scopeId = mapped("canvases", pending.scopeId);
      if (pending.deckId) pending.deckId = mapped("reviewDecks", pending.deckId);
    }
    return item;
  };
  const comparable = (collection: Collection, item: RecordWithId): unknown => {
    if (collection !== "cards") return item;
    // Store normalizes these defaults on load; absence alone is not a second card.
    return { ...item, links: item.links ?? [], tags: item.tags ?? [], keywords: item.keywords ?? [] };
  };

  // Equal card text with divergent schedules still represents two valuable versions.
  for (const [key, state] of Object.entries(remote.srs ?? {})) {
    if (Object.prototype.hasOwnProperty.call(local.srs ?? {}, key) && !same(local.srs[key], state)) allocate("cards", cardRoot(key));
  }
  let changed: boolean;
  do {
    changed = false;
    for (const canvas of remote.canvases ?? []) for (const submap of canvas.submaps ?? []) {
      const key = `${canvas.id}:${submap.id}`;
      if (!submapIds.has(key) && (maps.canvases.has(canvas.id) || maps.nodes.has(submap.rootNodeId))) {
        let next: string;
        do { next = uid("submap-conflict"); } while (reserved.has(next));
        reserved.add(next); submapIds.set(key, next); changed = true;
      }
    }
    for (const collection of collections) for (const original of rows(remote, collection)) {
      if (maps[collection].has(original.id)) continue;
      const existing = localRows[collection].get(original.id);
      if (existing && !same(comparable(collection, existing), comparable(collection, transform(collection, original)))) changed = allocate(collection, original.id) || changed;
    }
    // Archived materialized identities belong to their own group version too.
    // They are absent from the live cards collection after an unanchored merge.
    for (const root of remote.cards ?? []) if (maps.cards.has(root.id)) {
      for (const member of cardsIncludingMembers(root.mergedCards ?? [])) if (member.id !== root.id && !rows(remote,"cards").some(card => card.id === member.id)) changed = allocate("cards",member.id) || changed;
      for (const archived of root.mergeArchive?.nodes ?? []) if (!rows(remote,"nodes").some(node => node.id === archived.id)) changed = allocate("nodes",archived.id) || changed;
    }
  } while (changed);

  const result = { ...clone(remote), ...clone(local) };
  for (const collection of collections) {
    if (collection === "sceneTemplates" && local.sceneTemplates === undefined && remote.sceneTemplates === undefined) continue;
    const entries = new Map(rows(local, collection).map(item => [item.id, clone(item)]));
    for (const original of rows(remote, collection)) {
      const item = transform(collection, original);
      if (entries.has(item.id)) continue;
      if (item.id !== original.id && typeof item.name === "string") item.name += "（外部版本）";
      entries.set(item.id, item);
    }
    (result as unknown as Record<Collection, RecordWithId[]>)[collection] = [...entries.values()];
  }
  result.srs = { ...clone(local.srs ?? {}), ...states(remote.srs ?? {}) };
  result.reviewPending = coalesceReviewPending(result.reviewPending ?? []);
  result.edges = [...new Map([
    ...(local.edges ?? []).map(edge => clone(edge)),
    ...(remote.edges ?? []).map(edge),
  ].map(edge => [canonical(edge), edge] as [string, Edge])).values()];
  result.settings = { ...clone(remote.settings ?? {}), ...clone(local.settings ?? {}) };
  if (remote.settings?.tagColors || local.settings?.tagColors) result.settings.tagColors = { ...(remote.settings?.tagColors ?? {}), ...(local.settings?.tagColors ?? {}) };
  result.docMeta = { ...clone(remote.docMeta ?? {}), ...clone(local.docMeta ?? {}) };
  result.activeStudySetId = local.activeStudySetId ?? (remote.activeStudySetId && mapped("studySets", remote.activeStudySetId));
  result.activeCanvasId = local.activeCanvasId ?? (remote.activeCanvasId && mapped("canvases", remote.activeCanvasId));
  result.activeReviewDeckId = local.activeReviewDeckId ?? (remote.activeReviewDeckId && mapped("reviewDecks", remote.activeReviewDeckId));

  const logs = result.reviewLogs ?? [];
  const withdrawals = new Map<string, string>();
  for (const log of logs) if (log.undoneAt) withdrawals.set(reviewEventId(log), log.undoneAt);
  for (const log of logs) {
    const undoneAt = withdrawals.get(reviewEventId(log));
    if (undoneAt && !log.undoneAt) log.undoneAt = undoneAt;
  }
  const localCounts = effectiveReviewCounts(local.reviewLogs ?? []), remoteCounts = effectiveReviewCounts(remote.reviewLogs ?? []);
  const mergedCounts = effectiveReviewCounts(logs);
  result.reviewHistory = {};
  // Old daily totals have no event IDs. Treat their overlap as shared (max), then
  // add the deduplicated logged events, rather than summing two whole histories.
  const days = new Set([...Object.keys(local.reviewHistory ?? {}), ...Object.keys(remote.reviewHistory ?? {}), ...Object.keys(mergedCounts)]);
  const count = (value: number | undefined): number => Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
  for (const day of days) {
    const legacy = Math.max(0, count(local.reviewHistory?.[day]) - (localCounts[day] ?? 0), count(remote.reviewHistory?.[day]) - (remoteCounts[day] ?? 0));
    result.reviewHistory[day] = legacy + (mergedCounts[day] ?? 0);
  }
  return result;
}
