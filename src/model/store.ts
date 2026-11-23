/**
 * [INPUT]: 依赖 Obsidian 存储适配器、模型、标注、升级备份、macOS 主数据交换和保存反馈。
 * [OUTPUT]: 提供 Store、来源指纹登记、主数据迁移、学习集导入提交和冲突恢复。
 * [POS]: 串行提交主数据和侧车。加载与备份解除内部来源登记，迁移备份保留原字节。桌面冲突暂停写入。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { App, TFile, Notice } from "obsidian";
import { sha256Hex } from "../utils/sha256";
import {
  Annotation, Card, CardState, DEFAULT_HANDWRITING_PRESETS, DEFAULT_SETTINGS, DocMeta, Edge,
  MarginStudySettings, MindNode, PluginData, StudySet, MindCanvas, MindSubmap,
  MindmapFragment, PasteOptions, CardSource, DocumentRecord, ReviewDeck, HandwritingPresetSpec, StudySceneId, StudySceneSelection, StudySceneTemplate, LocalEvent, LocalEventKind, SyncStatusItem,
} from "../types";
import { freshState, schedule, todayStr, normalizeState, isDue, fmtDate } from "../srs";
import type { ReviewLog, ReviewPending, CardTemplate, GradeOptions, ReviewDeckSummary, PracticeAttempt, PracticeAttemptInput } from "../review/contracts";
import { uid } from "../utils/id";
import { questionsForCard, ReviewQuestion } from "../review/questions";
import { mergePreservingVersions, reviewEventId, effectiveReviewCounts } from "./conflicts";
import { cardsIncludingMembers, coalesceReviewPending, reviewPendingForData } from "./reviewPending";
import { togglePlainCloze } from "../utils/markdown";
import { reviewDecksForData } from "./reviewDecks";
import { validateAnnotationCollection } from "./annotationValidation";
import { repairDuplicateIds } from "./duplicateIds";
import { mindmapHasHandwriting, normalizeMindmapHandwriting } from "../mindmap/handwritingContracts";
import { clampHandwritingWidth } from "../annot/handwritingPresets";
import { builtinSceneTemplates, defaultStudyScene, installableSceneTemplateIds, isSupportedSceneTemplate } from "../workspace/scenes";
import { exportMn5SceneTemplate, importMn5SceneTemplate } from "../workspace/mn5SceneTemplates";
import { syncCardColor } from "./cardColors";
import { editedExcerptBlocks } from "../cards/excerptBlocks";
import { applyMediaReplacements, externalizeMedia, hasInlineMedia } from "./mediaMigration";
import { BACKUP_ROOT, clearAbandonedMigrationBackups, isMigrationBackup, isStagedMigrationBackup, migrationBackupPaths, publishMigrationBackup } from "./migrationBackup";
import type { BackupFile, BackupManifest } from "./migrationBackup";
import { DesktopMainConflict, recoverDesktopMainReplacement, replaceMacMain, resolveDesktopMainReplacement } from "./desktopMainReplacement";
import { errorDetail, LibrarySaveConflict, saveFailureText } from "./saveFeedback";
import { ProtectedObject, ProtectionSnapshot, ProtectionSnapshotInfo, protectedCollections, protectedObjects, protectedAnnotations, signProtectionSnapshot, validateProtectionSnapshot } from "./localProtection";
import { isStudyDocumentPath } from "../documents/formats";
import { measurePenCommit, perfEnabledForPen, recordPenPersistence } from "../annot/pen";

interface StoreHost {
  app: App;
  manifest?: { dir?: string };
  loadData(): Promise<any>;
  saveData(data: any): Promise<void>;
}
type LibrarySnapshot = { data: PluginData; annotations: [string, Annotation[]][] };
type HistoryEntry = { label: string; before: LibrarySnapshot; after: LibrarySnapshot } | { label: string; nodeMove: { id: string; before: {x:number;y:number}; after: {x:number;y:number} } } | { label: string; readOnly: true };
export class DocumentCommitRollbackError extends Error {
  constructor(error: unknown, rollbackError: unknown) {
    super(`文档操作失败：${String(error)}；内存已回滚，但恢复后的数据尚未保存：${String(rollbackError)}`);
    this.name = "DocumentCommitRollbackError";
  }
}
const clone = <T>(value: T): T => value == null ? value : JSON.parse(JSON.stringify(value));
const cloneSnapshot = <T>(value: T): T => typeof structuredClone === "function" ? structuredClone(value) : clone(value);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const SAVE_DEBOUNCE_MS = 800;
const INPUT_QUIET_MS = 1200;
const CONFLICT_NOTICE_COOLDOWN_MS = 10000;
const SERIALIZE_CHUNK = 64 * 1024;
const MAIN_SCHEMA_VERSION = 3;
const SIDECAR_SCHEMA_VERSION = 2;
async function serializeData(value: unknown, onYield?: () => Promise<void>): Promise<string> {
  const parts: string[] = [];
  let pending = 0;
  const ancestors = new Set<object>();
  function* visit(input: any, key: string, inArray: boolean): Generator<string> {
    if (input && typeof input === "object" && typeof input.toJSON === "function") input = input.toJSON(key);
    if (typeof input === "string") {
      yield '"';
      for (let start = 0; start < input.length;) {
        let end = Math.min(start + SERIALIZE_CHUNK / 4, input.length);
        if (end < input.length && input.charCodeAt(end - 1) >= 0xd800 && input.charCodeAt(end - 1) <= 0xdbff && input.charCodeAt(end) >= 0xdc00 && input.charCodeAt(end) <= 0xdfff) end--;
        yield JSON.stringify(input.slice(start, end)).slice(1, -1);
        start = end;
      }
      yield '"';
      return;
    }
    if (!input || typeof input !== "object") {
      const result = JSON.stringify(input);
      yield result === undefined ? (inArray ? "null" : "") : result;
      return;
    }
    if (ancestors.has(input)) throw new TypeError("Converting circular structure to JSON");
    ancestors.add(input);
    if (Array.isArray(input)) {
      yield "[";
      for (let index = 0; index < input.length; index++) {
        if (index) yield ",";
        yield* visit(input[index], String(index), true);
      }
      yield "]";
    } else {
      yield "{";
      let first = true;
      for (const property of Object.keys(input)) {
        const item = input[property];
        if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
        if (!first) yield ",";
        first = false;
        yield JSON.stringify(property); yield ":";
        yield* visit(item, property, false);
      }
      yield "}";
    }
    ancestors.delete(input);
  }
  for (const part of visit(value, "", false)) {
    parts.push(part);
    pending += part.length * 2;
    if (pending >= SERIALIZE_CHUNK) {
      pending = 0;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (onYield) await onYield();
    }
  }
  return parts.join("");
}
const HISTORY_LIMIT_BYTES = 32 * 1024 * 1024;
const sha = (data: string | ArrayBuffer): string => sha256Hex(data);
const documentFingerprint = (bytes: ArrayBuffer | Uint8Array) => ({ byteSize: bytes.byteLength, sha256: sha256Hex(bytes) });
const hasDocumentFingerprint = (doc: DocumentRecord) => typeof doc.sha256 === "string" && /^[a-f0-9]{64}$/.test(doc.sha256)
  && Number.isSafeInteger(doc.byteSize) && doc.byteSize! >= 0;
function normalizeHandwritingPresets(value: unknown): HandwritingPresetSpec[] {
  if (!Array.isArray(value)) return DEFAULT_HANDWRITING_PRESETS.map(preset => ({ ...preset }));
  const ids = new Set<string>();
  const presets = value.flatMap((item): HandwritingPresetSpec[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<HandwritingPresetSpec>, id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const label = typeof candidate.label === "string" ? candidate.label.trim().slice(0, 80) : "";
    const type = candidate.type;
    if (!id || ids.has(id) || !label || !["ballpoint", "fountain", "pencil", "highlighter"].includes(String(type))) return [];
    if (!Number.isFinite(candidate.width) || !Number.isFinite(candidate.opacity) || typeof candidate.color !== "string" || !candidate.color.trim()) return [];
    ids.add(id);
    const presetType = type as HandwritingPresetSpec["type"], width = clampHandwritingWidth(presetType, Number(candidate.width));
    const result: HandwritingPresetSpec = { id, label, type: presetType, color: candidate.color.trim(), width,
      opacity: Math.max(0, Math.min(1, Number(candidate.opacity))) };
    if (Number.isFinite(candidate.documentWidth)) result.documentWidth = clampHandwritingWidth(presetType, Number(candidate.documentWidth));
    if (Number.isFinite(candidate.mindmapWidth)) result.mindmapWidth = clampHandwritingWidth(presetType, Number(candidate.mindmapWidth));
    if (Number.isFinite(candidate.cardWidth)) result.cardWidth = clampHandwritingWidth(presetType, Number(candidate.cardWidth));
    if (candidate.recallPurpose === "mask" || candidate.recallPurpose === "highlight") result.recallPurpose = candidate.recallPurpose;
    return [result];
  });
  return presets.length ? presets : DEFAULT_HANDWRITING_PRESETS.map(preset => ({ ...preset }));
}
const safePath = (path: string): string => {
  if (!path || path.startsWith("/") || path.includes("\\") || /^[A-Za-z]:/.test(path) || path.split("/").some(p => p === ".." || p === "." || p === ".obsidian" || p === "")) throw new Error("无效的库内路径：" + path);
  return path;
};
const isBackupInternalPath = (path: unknown): boolean => typeof path === "string" && (path.startsWith(`${BACKUP_ROOT}/`) || path.startsWith("_marginstudy-recovery/"));
const detachedSourceDetail = "卡片来源位于备份或恢复目录，来源已解除登记，正文与关系保留";
type SkippedSource = { id: string; detail: string };
const sharedCommitTails = new WeakMap<object, Promise<void>>();
async function withSharedCommitLock<T>(key: object, action: () => Promise<T>): Promise<T> {
  const prior = sharedCommitTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const tail = prior.then(() => held);
  sharedCommitTails.set(key, tail);
  await prior;
  try { return await action(); }
  finally { release(); if (sharedCommitTails.get(key) === tail) sharedCommitTails.delete(key); }
}

/** Main data, sidecars and library operations share one serialized write lifecycle. */
export class Store {
  host: StoreHost;
  settings: MarginStudySettings = clone(DEFAULT_SETTINGS);
  cards: Card[] = [];
  nodes: MindNode[] = [];
  edges: Edge[] = [];
  srs: Record<string, CardState> = {};
  docMeta: Record<string, DocMeta> = {};
  reviewHistory: Record<string, number> = {};
  reviewLogs: ReviewLog[] = [];
  practiceAttempts: PracticeAttempt[] = [];
  reviewPending: ReviewPending[] = [];
  reviewDecks: ReviewDeck[] = [];
  activeReviewDeckId?: string;
  cardTemplates: CardTemplate[] = [];
  private sceneTemplates?: StudySceneTemplate[];
  studySets: StudySet[] = [];
  canvases: MindCanvas[] = [];
  activeStudySetId?: string;
  activeCanvasId?: string;
  documents: DocumentRecord[] = [];
  private workspaceState?: Record<string, unknown>;
  lastSaveError: string | null = null;
  conflictPath: string | null = null;

  private writerId = uid("device");
  private revision = 0;
  private baseline: any = null;
  private mainDirty = false;
  private mainVersion = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveIdle: number | null = null;
  private lastInputAt = 0;
  private activeInputs = 0;
  private queue: Promise<void> = Promise.resolve();
  private annCache = new Map<string, Annotation[]>();
  private annotationRevisions = new Map<string, number>();
  private annLoads = new Map<string, Promise<Annotation[]>>();
  private annBase = new Map<string, string | null>();
  private annDirty = new Map<string, number>();
  private annBlocked = new Set<string>();
  private jobs = new Set<Promise<unknown>>();
  private loadBlocked = false;
  private listeners = new Set<(change?: { movedNodeIds: string[] }) => void>();
  private statusListeners = new Set<() => void>();
  private pendingMoves = new Set<string>();
  private pendingGeneralChange = false;
  private navigationListeners = new Set<(event: { canvasId: string; documentPath?: string }) => void>();
  private documentRenameListeners = new Set<(oldPath: string, newPath: string) => void>();
  private annListeners = new Map<string, Set<() => void>>();
  private notificationPending = false;
  private history: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private historySizes = new WeakMap<HistoryEntry, number>();
  private libraryHistoryRevision = 0;
  private transactionDepth = 0;
  private documentCommitPending = false;
  private documentCommitOwner = false;
  private studySetImportCanvasId?: string;
  private pendingConflict: { local: PluginData; remote: PluginData } | null = null;
  private desktopConflict: DesktopMainConflict | null = null;
  private lastExplicitConflictNotice: { text: string; at: number } | null = null;
  private localEvents: LocalEvent[] = [];
  private protectionSnapshots: ProtectionSnapshotInfo[] = [];

  constructor(host: StoreHost) { this.host = host; }

  async load(): Promise<void> {
    try {
      await withSharedCommitLock(this.host.app.vault.adapter, async () => {
        await clearAbandonedMigrationBackups(this.host.app);
        const location = this.desktopMainLocation();
        let conflict = location && await recoverDesktopMainReplacement(location.base, location.path);
        let data = await this.host.loadData();
        if (data != null) this.validateData(data);
        this.applyLoadedData(data ?? {});
        if (!conflict && !this.settings.diagnosticNoPersist && this.needsMainMigration(data)) {
          try { data = await this.migrateMain(data); }
          catch (error) {
            if (!(error instanceof DesktopMainConflict)) throw error;
            conflict = error;
            data = await this.host.loadData();
            this.validateData(data);
            this.applyLoadedData(data);
          }
        }
        this.baseline = clone(data);
        this.loadBlocked = false;
        if (conflict) this.markDesktopConflict(conflict);
      });
    } catch (error) {
      this.loadBlocked = true;
      this.report("主数据读取失败，已暂停写入以保留原文件。可从备份恢复。", error);
      throw error;
    }
    this.recordLocalEvent("loaded", [], "已读取本地数据；云端状态无法由本插件确认。");
    for (const doc of this.documents) if (doc.missing && !this.localEvents.some(event => event.kind === "file-missing" && event.objectIds.includes(doc.id))) this.recordLocalEvent("file-missing", [doc.id], "已登记来源文件缺失：" + doc.path);
    await this.recoverPendingAnnotationMerges();
    await this.gcSupersededRecoveries();
    if (hasInlineMedia(this)) this.save();
  }

  private needsMainMigration(data: PluginData | null | undefined): data is PluginData {
    return data != null && (data.schemaVersion ?? (this.host.manifest?.dir ? 1 : MAIN_SCHEMA_VERSION)) < MAIN_SCHEMA_VERSION;
  }

  private async migrateMain(data: PluginData): Promise<PluginData> {
    const path = this.host.manifest?.dir ? `${this.host.manifest.dir}/data.json` : undefined;
    const originalText = path ? await this.host.app.vault.adapter.read(path) : JSON.stringify(data);
    if (!same(JSON.parse(originalText), data)) throw new Error("备份前主数据发生变化，请重新打开学习库");
    await publishMigrationBackup(
      this.host.app,
      async dir => (await this.writeBackup(data, originalText, false, dir, true)).manifest,
      async path => (await this.readBackup(path, false)).manifest,
    );
    const upgraded = { ...data, schemaVersion: MAIN_SCHEMA_VERSION };
    try {
      if (path) {
        await this.commitMainReplacement(path, data, await serializeData(upgraded), uid("migration"), originalText);
      } else {
        if (!same(await this.host.loadData(), data)) throw new Error("提交前主数据发生变化，请重新打开学习库");
        await this.host.saveData(upgraded);
      }
    } catch (error) {
      if (error instanceof DesktopMainConflict) throw error;
      const committed = await this.host.loadData().catch(() => null);
      if (!same(committed, upgraded)) throw error;
    }
    return upgraded;
  }

  private validateData(data: any): asserts data is PluginData {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("数据必须是对象");
    if (data.schemaVersion != null && (!Number.isInteger(data.schemaVersion) || data.schemaVersion > MAIN_SCHEMA_VERSION)) throw new Error("主数据版本不兼容，请先更新插件");
    for (const key of ["cards", "nodes", "edges", "studySets", "canvases", "reviewLogs", "practiceAttempts", "reviewPending", "reviewDecks", "cardTemplates", "documents", "localEvents"]) {
      if (data[key] != null && !Array.isArray(data[key])) throw new Error(key + " 格式无效");
    }
    for (const key of ["settings", "srs", "docMeta", "reviewHistory", "workspaceState"]) {
      if (data[key] != null && (typeof data[key] !== "object" || Array.isArray(data[key]))) throw new Error(key + " 格式无效");
    }
    for (const key of ["cards", "nodes", "studySets", "canvases", "documents", "reviewDecks"]) {
      const ids = new Set<string>();
      for (const item of data[key] ?? []) {
        if (!item || typeof item.id !== "string" || ids.has(item.id)) throw new Error(key + " 含无效或重复 id");
        ids.add(item.id);
      }
    }
    for (const c of data.cards ?? []) {
      if (typeof c.front !== "string" || typeof c.docPath !== "string" || (c.links != null && (!Array.isArray(c.links) || c.links.some((v: unknown) => typeof v !== "string"))) || (c.tags != null && (!Array.isArray(c.tags) || c.tags.some((v: unknown) => typeof v !== "string")))) throw new Error("卡片内容格式无效");
    }
    for (const n of data.nodes ?? []) if (typeof n.title !== "string" || !Number.isFinite(n.x) || !Number.isFinite(n.y) || (n.parentId != null && typeof n.parentId !== "string")) throw new Error("脑图节点格式无效");
    for (const e of data.edges ?? []) if (!e || typeof e.from !== "string" || typeof e.to !== "string") throw new Error("脑图连线格式无效");
    for (const s of data.studySets ?? []) if (typeof s.name !== "string" || !Array.isArray(s.docPaths) || s.docPaths.some((p: unknown) => typeof p !== "string")) throw new Error("学习集格式无效");
    for (const c of data.canvases ?? []) {
      if (typeof c.name !== "string" || typeof c.studySetId !== "string") throw new Error("画布格式无效");
      if (c.submaps !== undefined) {
        if (!Array.isArray(c.submaps)) throw new Error("子脑图格式无效");
        const ids = new Set<string>(), roots = new Set<string>();
        for (const submap of c.submaps) {
          if (!submap || typeof submap.id !== "string" || !submap.id || ids.has(submap.id) || typeof submap.name !== "string" || !submap.name.trim() || typeof submap.rootNodeId !== "string" || roots.has(submap.rootNodeId) || typeof submap.createdAt !== "string") throw new Error("子脑图格式无效");
          ids.add(submap.id); roots.add(submap.rootNodeId);
        }
      }
      if (c.display !== undefined) {
        const display = c.display;
        if (!display || typeof display !== "object" || Array.isArray(display) || (display.hideLinks !== undefined && typeof display.hideLinks !== "boolean") || (display.cardWidth !== undefined && (!Number.isFinite(display.cardWidth) || display.cardWidth < 120 || display.cardWidth > 600)) || (display.handwritingBackground !== undefined && !["plain", "lines", "grid", "dots"].includes(display.handwritingBackground))) throw new Error("脑图显示设置格式无效");
      }
      if (c.handwriting !== undefined) {
        const handwriting = normalizeMindmapHandwriting(c.handwriting);
        if (!handwriting) throw new Error("脑图手写格式或版本不支持");
        c.handwriting = handwriting;
      }
    }
    for (const deck of data.reviewDecks ?? []) if (typeof deck.name !== "string" || !Array.isArray(deck.cardIds) || deck.cardIds.some((id: unknown) => typeof id !== "string") || !Array.isArray(deck.studySetIds) || deck.studySetIds.some((id: unknown) => typeof id !== "string")) throw new Error("复习卡组格式无效");
    const attempts = new Set<string>();
    for (const attempt of data.practiceAttempts ?? []) {
      if (!attempt || typeof attempt.id !== "string" || !attempt.id || attempts.has(attempt.id) || typeof attempt.cardId !== "string" || typeof attempt.studySetId !== "string" || typeof attempt.at !== "string" || typeof attempt.answer !== "string" || !["correct", "wrong", "partial"].includes(attempt.verdict) || (attempt.mistake !== undefined && typeof attempt.mistake !== "string") || (attempt.correctionOf !== undefined && typeof attempt.correctionOf !== "string")) throw new Error("练习记录格式无效");
      attempts.add(attempt.id);
    }
    const eventIds = new Set<string>();
    for (const event of data.localEvents ?? []) {
      if (!event || typeof event.id !== "string" || !event.id || eventIds.has(event.id) || typeof event.at !== "string" || !Number.isFinite(Date.parse(event.at)) ||
          !["loaded", "pending", "saved", "file-missing", "object-deleted", "conflict-detected", "conflict-merged", "external-applied", "restored"].includes(event.kind) ||
          !Array.isArray(event.objectIds) || event.objectIds.some((id: unknown) => typeof id !== "string") || typeof event.detail !== "string") throw new Error("本地事件记录格式无效");
      eventIds.add(event.id);
    }
  }

  private applyData(data: Partial<PluginData>): void {
    this.settings = { ...clone(DEFAULT_SETTINGS), ...data.settings };
    for (const key of Object.keys(DEFAULT_SETTINGS)) if ((this.settings as any)[key] === undefined) (this.settings as any)[key] = (DEFAULT_SETTINGS as any)[key];
    this.settings.handwritingPresets = normalizeHandwritingPresets(this.settings.handwritingPresets);
    this.cards = (data.cards ?? []).map(c => ({ ...c, tags: c.tags ?? [], links: c.links ?? [] }));
    this.nodes = data.nodes ?? [];
    this.edges = data.edges ?? [];
    this.srs = {};
    for (const [id, state] of Object.entries(data.srs ?? {})) this.srs[id] = normalizeState(state, this.settings.defaultEase);
    this.docMeta = data.docMeta ?? {};
    this.reviewHistory = data.reviewHistory ?? {};
    this.reviewLogs = data.reviewLogs ?? [];
    this.practiceAttempts = data.practiceAttempts ?? [];
    // Legacy schedules are retained as enrolled questions. New ordinary cards are
    // not enrolled until the user asks; presence of a fresh state is not enrollment.
    const knownCards = new Set(cardsIncludingMembers(this.cards).map(card => card.id));
    this.reviewPending = coalesceReviewPending(reviewPendingForData(data)).filter(entry => entry.visited !== true && knownCards.has(entry.cardId));
    this.cardTemplates = data.cardTemplates ?? [];
    this.sceneTemplates = clone(data.sceneTemplates);
    this.studySets = data.studySets ?? [];
    this.canvases = data.canvases ?? [];
    this.reviewDecks = reviewDecksForData(data, this.reviewPending);
    this.activeReviewDeckId = this.reviewDecks.some(deck => deck.id === data.activeReviewDeckId) ? data.activeReviewDeckId : undefined;
    for (const set of this.studySets) {
      if (set.reviewDeckId && !this.reviewDecks.some(deck => deck.id === set.reviewDeckId)) delete set.reviewDeckId;
      if (!set.reviewDeckId && !data.reviewDecks) set.reviewDeckId = this.reviewDecks.find(deck => deck.studySetIds.includes(set.id))?.id;
      if (set.reviewDeckId) {
        const deck = this.reviewDecks.find(deck => deck.id === set.reviewDeckId)!;
        deck.studySetIds = [...new Set([...deck.studySetIds, set.id])];
      }
    }
    this.activeStudySetId = data.activeStudySetId;
    this.activeCanvasId = data.activeCanvasId;
    this.documents = data.documents ?? [];
    this.localEvents = clone(data.localEvents ?? []);
    this.workspaceState = data.workspaceState ? clone(data.workspaceState) : undefined;
    this.revision = data.revision ?? 0;
    this.repairGraph();
  }

  private applyLoadedData(data: Partial<PluginData>): void {
    const active = cloneSnapshot(data);
    const skipped = this.detachBackupSources(active);
    this.applyData(active);
    this.recordSkippedSources(skipped);
  }

  private data(copy = true): PluginData {
    const data: PluginData = { schemaVersion: MAIN_SCHEMA_VERSION, revision: this.revision, writerId: this.writerId,
      settings: this.settings, cards: this.cards, nodes: this.nodes, edges: this.edges,
      srs: this.srs, docMeta: this.docMeta, reviewHistory: this.reviewHistory,
      reviewLogs: this.reviewLogs, practiceAttempts: this.practiceAttempts, reviewPending: this.reviewPending, cardTemplates: this.cardTemplates,
      reviewDecks: this.reviewDecks, activeReviewDeckId: this.activeReviewDeckId,
      ...(this.sceneTemplates !== undefined ? { sceneTemplates: this.sceneTemplates } : {}),
      studySets: this.studySets, canvases: this.canvases,
      activeStudySetId: this.activeStudySetId, activeCanvasId: this.activeCanvasId,
      documents: this.documents,
      workspaceState: this.workspaceState,
      localEvents: this.localEvents,
    };
    return copy ? clone(data) : data;
  }

  private recordLocalEvent(kind: LocalEventKind, objectIds: string[], detail: string): LocalEvent {
    const event = { id: uid("local-event"), at: new Date().toISOString(), kind, objectIds: [...new Set(objectIds)], detail };
    this.localEvents.push(event);
    if (this.localEvents.length > 500) {
      const pinned = new Set<string>();
      for (const doc of this.documents.filter(item => item.missing)) {
        const event = [...this.localEvents].reverse().find(item => item.kind === "file-missing" && item.objectIds.includes(doc.id));
        if (event) pinned.add(event.id);
      }
      const unlinkedCards = new Set(this.cards.filter(card => !card.docPath && !card.sources?.some(source => source.docPath)).map(card => card.id));
      for (const event of [...this.localEvents].reverse()) {
        if (event.kind === "file-missing" && event.detail.startsWith(detachedSourceDetail) && event.objectIds.some(id => unlinkedCards.delete(id))) pinned.add(event.id);
      }
      const latestLoaded = [...this.localEvents].reverse().find(item => item.kind === "loaded");
      if (latestLoaded) pinned.add(latestLoaded.id);
      const latestConflict = [...this.localEvents].reverse().find(item => item.kind === "conflict-detected");
      if (latestConflict && (this.conflictPath || this.annBlocked.size)) pinned.add(latestConflict.id);
      this.localEvents = this.localEvents.filter((item, index) => index >= this.localEvents.length - 500 || pinned.has(item.id));
    }
    return event;
  }
  private localEventUnion(...groups: LocalEvent[][]): LocalEvent[] {
    const events = new Map<string, LocalEvent>();
    for (const event of groups.flat()) {
      const existing = events.get(event.id);
      if (existing && !same(existing, event)) throw new Error("本地事件 ID 冲突，已拒绝合并");
      if (!existing) events.set(event.id, clone(event));
    }
    return [...events.values()];
  }
  getLocalEvents(): LocalEvent[] { return clone(this.localEvents); }
  getSyncStatus(): SyncStatusItem[] {
    const latest = (predicate: (event: LocalEvent) => boolean): LocalEvent | undefined => [...this.localEvents].reverse().find(predicate);
    const fallback = latest(event => event.kind === "loaded") ?? this.localEvents[0];
    if (!fallback) throw new Error("本地状态尚未加载");
    const evidence = (event?: LocalEvent): string[] => [(event ?? fallback).id];
    const pending = this.mainDirty || this.annDirty.size > 0;
    const local = latest(event => pending ? ["pending", "file-missing", "object-deleted", "restored", "conflict-detected", "conflict-merged", "external-applied"].includes(event.kind) : event.kind === "saved");
    const missingDocs = this.documents.filter(doc => doc.missing);
    const missingEvidence = missingDocs.map(doc => latest(event => event.kind === "file-missing" && event.objectIds.includes(doc.id))?.id ?? fallback.id);
    const conflict = !!this.conflictPath || this.annBlocked.size > 0;
    const conflictEvent = latest(event => event.kind === (conflict ? "conflict-detected" : "external-applied"));
    const deleted = latest(event => event.kind === "object-deleted"), currentIds = new Set(protectedCollections.flatMap(collection => ((this[collection] ?? []) as { id: string }[]).map(item => item.id)));
    const deletedObjects = deleted?.objectIds.filter(id => !currentIds.has(id)) ?? [];
    const activity = this.localEvents.slice(-10).reverse();
    const pendingEvent = latest(event => event.kind === "pending");
    const pendingCount = this.annDirty.size + (this.mainDirty ? 1 : 0);
    return [
      { key: "local", text: this.desktopConflict ? "本地写入已暂停（待处理冲突）" : pending ? "本地待保存" : local ? "本地已保存" : "本地已读取（尚无本次保存记录）", evidenceEventIds: evidence(this.desktopConflict ? conflictEvent : local), ...(pending && !this.desktopConflict ? { action: "save-local" as const } : {}) },
      { key: "pending-upload", text: pending ? `等待上传：${pendingCount} 项本地修改尚未落盘（保存后由宿主同步机制处理）` : "等待上传：无未落盘的本地修改", evidenceEventIds: evidence(pending ? pendingEvent : local) },
      { key: "missing", text: missingDocs.length ? `本机未找到 ${missingDocs.length} 个来源文件；iCloud 是否仍有副本无法由本插件确认` : "文件缺失：本机未发现缺失来源", evidenceEventIds: missingEvidence.length ? missingEvidence : evidence(), ...(missingDocs.length ? { action: "relink-source" as const } : {}) },
      { key: "conflict", text: conflict ? "冲突：需要处理" : "冲突：当前未发现", evidenceEventIds: evidence(conflictEvent), ...(conflict ? { action: "resolve-conflict" as const } : {}) },
      { key: "deleted", text: deleted ? (deletedObjects.length ? "最近删除记录（对象已删除）：" : "最近删除记录（对象已恢复或重新出现）：") + deleted.detail : "对象已删除：无近期记录", evidenceEventIds: evidence(deleted), ...(deleted ? { action: "show-deletions" as const } : {}) },
      { key: "activity", text: "最近活动：" + (activity[0]?.detail ?? fallback.detail), evidenceEventIds: evidence(activity[0]) },
      { key: "cloud", text: "云端状态：无法确认（本插件不接入云端）", evidenceEventIds: evidence(fallback) },
    ];
  }

  getWorkspaceState(): Record<string, unknown> | undefined { return clone(this.workspaceState); }
  getSceneTemplates(): StudySceneTemplate[] {
    const builtins = builtinSceneTemplates().filter(template => !installableSceneTemplateIds.some(id => id === template.id)), ids = new Set(builtins.map(template => template.id));
    const personal = Array.isArray(this.sceneTemplates) ? this.sceneTemplates.filter(template => {
      if (!isSupportedSceneTemplate(template) || ids.has(template.id)) return false;
      ids.add(template.id); return true;
    }) : [];
    return [...builtins, ...clone(personal)];
  }
  installBuiltinSceneTemplate(id: string): StudySceneTemplate {
    const source = builtinSceneTemplates().find(template => template.id === id && installableSceneTemplateIds.some(item => item === id));
    if (!source) throw new Error("内置模板不存在");
    if (this.cardTemplates.some(template => template.id === id)) throw new Error("模板 ID 已被其他卡片模板占用");
    const installed = this.getSceneTemplates().find(template => template.id === id);
    if (installed) {
      if (!same(installed, source)) throw new Error("模板 ID 已被其他模板占用");
      return installed;
    }
    if ((this.sceneTemplates ?? []).some(template => template.id === id)) throw new Error("模板 ID 已被无效模板占用");
    this.mutate("安装内置模板", () => { this.sceneTemplates = [...(this.sceneTemplates ?? []), clone(source)]; });
    return clone(source);
  }
  getCardTemplates(): CardTemplate[] {
    const personal = clone(this.cardTemplates), ids = new Set(personal.map(template => template.id));
    for (const template of this.getSceneTemplates()) {
      if (template.cardTemplate && !ids.has(template.id)) {
        personal.push({ id: template.id, name: template.name, type: "flashcard", ...clone(template.cardTemplate) });
        ids.add(template.id);
      }
    }
    return personal;
  }
  copySceneTemplate(templateId: string): StudySceneTemplate {
    const source = this.getSceneTemplates().find(template => template.id === templateId);
    if (!source) throw new Error("场景模板不存在");
    const copy = { ...clone(source), id: uid("scene-template"), name: source.name + " 副本" };
    this.mutate("复制场景模板", () => { this.sceneTemplates = [...(this.sceneTemplates ?? []), copy]; });
    return clone(copy);
  }
  copyStudySetSceneTemplate(studySetId: string): StudySceneTemplate {
    const selection = this.getStudyScene(studySetId);
    if (!selection) throw new Error("学习集不存在");
    const source = this.getSceneTemplates().find(template => template.id === selection.templateId)!;
    const set = this.studySets.find(item => item.id === studySetId)!;
    const effective = studySetId === this.activeStudySetId ? this.getEffectiveSceneSettings() : this.settings;
    const copy = { ...clone(source), id: uid("scene-template"), name: set.name + " 的场景", colors: clone(source.colors ?? effective.colors), excerptPopup: source.excerptPopup ?? effective.excerptPopup ?? false, ...(source.textSelectionMenuActions ?? effective.textSelectionMenuActions ? { textSelectionMenuActions: clone(source.textSelectionMenuActions ?? effective.textSelectionMenuActions) } : {}), handwritingPresets: clone(source.handwritingPresets ?? effective.handwritingPresets ?? DEFAULT_HANDWRITING_PRESETS) };
    if (!isSupportedSceneTemplate(copy)) throw new Error("学习集配置无效");
    this.mutate("从学习集复制场景模板", () => { this.sceneTemplates = [...(this.sceneTemplates ?? []), copy]; });
    return clone(copy);
  }
  saveSceneTemplate(template: StudySceneTemplate): void {
    if (builtinSceneTemplates().some(item => item.id === template.id)) throw new Error("内置模板不可直接编辑，请先复制");
    if (!isSupportedSceneTemplate(template)) throw new Error("模板内容无效");
    const index = (this.sceneTemplates ?? []).findIndex(item => item.id === template.id);
    if (index < 0) throw new Error("场景模板不存在");
    this.mutate("编辑场景模板", () => { this.sceneTemplates![index] = clone(template); });
  }
  /** 导入新场景模板（只新增，不改已有同 ID 模板）。 */
  addSceneTemplate(template: StudySceneTemplate): void {
    if (builtinSceneTemplates().some(item => item.id === template.id)) throw new Error("内置模板不可直接导入，请先复制");
    if (!isSupportedSceneTemplate(template)) throw new Error("模板内容无效");
    if ((this.sceneTemplates ?? []).some(item => item.id === template.id)) throw new Error("模板已存在");
    this.mutate("导入场景模板", () => { this.sceneTemplates = [...(this.sceneTemplates ?? []), clone(template)]; });
  }
  removeSceneTemplate(id: string): void {
    if (builtinSceneTemplates().some(item => item.id === id)) throw new Error("内置模板不可删除");
    if (!(this.sceneTemplates ?? []).some(item => item.id === id)) throw new Error("场景模板不存在");
    this.mutate("删除场景模板", () => {
      const standard = builtinSceneTemplates().find(item => item.id === "standard")!;
      for (const set of this.studySets) if (set.scene?.templateId === id) {
        const sceneId = standard.scenes.some(scene => scene.id === set.scene!.sceneId) ? set.scene.sceneId : standard.scenes[0].id;
        set.scene = { ...set.scene, templateId: "standard", sceneId };
      }
      this.sceneTemplates = this.sceneTemplates!.filter(item => item.id !== id);
    });
  }
  getEffectiveSceneSettings(): MarginStudySettings {
    const selected = this.activeStudySetId ? this.getStudyScene(this.activeStudySetId) : undefined;
    const template = selected?.interfaceMode === "scenes" ? this.getSceneTemplates().find(item => item.id === selected.templateId) : undefined;
    if (!template) return this.settings;
    const colors = template.colors ?? this.settings.colors;
    return { ...this.settings, colors, defaultColor: colors.includes(this.settings.defaultColor) ? this.settings.defaultColor : colors[0],
      excerptPopup: template.excerptPopup ?? this.settings.excerptPopup,
      textSelectionMenuActions: template.textSelectionMenuActions ?? this.settings.textSelectionMenuActions,
      handwritingPresets: template.handwritingPresets ?? this.settings.handwritingPresets,
      handwritingPresetsVersion: template.handwritingPresets ? 2 : this.settings.handwritingPresetsVersion };
  }
  setEffectiveSceneSettings(patch: Pick<Partial<StudySceneTemplate>, "colors" | "excerptPopup" | "textSelectionMenuActions" | "handwritingPresets">): void {
    const selected = this.activeStudySetId ? this.getStudyScene(this.activeStudySetId) : undefined;
    const template = selected?.interfaceMode === "scenes" ? this.getSceneTemplates().find(item => item.id === selected.templateId) : undefined;
    if (template && !builtinSceneTemplates().some(item => item.id === template.id)) {
      this.saveSceneTemplate({ ...template, ...clone(patch) });
    } else {
      Object.assign(this.settings, clone(patch));
      if (patch.handwritingPresets) this.settings.handwritingPresetsVersion = 2;
      this.save();
    }
  }
  exportSceneTemplate(templateId: string, format: "margin-study" | "mn5" = "margin-study"): string {
    const template = this.getSceneTemplates().find(item => item.id === templateId);
    if (!template) throw new Error("场景模板不存在");
    return JSON.stringify(format === "mn5" ? exportMn5SceneTemplate(template) : { format: "margin-study-scene-template", version: 1, template }, null, 2);
  }
  importSceneTemplate(text: string): StudySceneTemplate {
    let document: any;
    try { document = JSON.parse(text); } catch { throw new Error("模板 JSON 无效"); }
    const isMn5 = document?.schema === 3;
    if (!isMn5 && (!document || document.format !== "margin-study-scene-template" || document.version !== 1 || !isSupportedSceneTemplate(document.template))) throw new Error("模板版本或内容无效");
    const template: StudySceneTemplate = isMn5 ? importMn5SceneTemplate(document) : clone(document.template);
    if (isMn5 && this.getSceneTemplates().some(item => item.id === template.id)) template.id = uid("scene-template");
    if (this.getSceneTemplates().some(item => item.id === template.id)) throw new Error("模板 ID 已存在");
    this.mutate("导入场景模板", () => { this.sceneTemplates = [...(this.sceneTemplates ?? []), template]; });
    return clone(template);
  }
  getStudyScene(id: string): StudySceneSelection | undefined {
    const set = this.studySets.find(item => item.id === id);
    if (!set) return undefined;
    const selected = set.scene;
    const template = selected && this.getSceneTemplates().find(item => item.id === selected.templateId);
    if (!template?.scenes.some(scene => scene.id === selected?.sceneId)) return defaultStudyScene();
    return { templateId: template.id, sceneId: selected!.sceneId,
      interfaceMode: selected!.interfaceMode === "traditional" ? "traditional" : "scenes" };
  }
  selectStudyScene(id: string, templateId: string, sceneId: StudySceneId): void {
    const set = this.studySets.find(item => item.id === id);
    if (!set) throw new Error("学习集不存在");
    const template = this.getSceneTemplates().find(item => item.id === templateId);
    if (!template?.scenes.some(scene => scene.id === sceneId)) throw new Error("场景不属于所选模板");
    const next: StudySceneSelection = { templateId, sceneId, interfaceMode: this.getStudyScene(id)!.interfaceMode };
    if (!same(set.scene, next)) this.updateStudySet(id, { scene: next });
  }
  setStudyInterface(id: string, interfaceMode: StudySceneSelection["interfaceMode"]): void {
    if (interfaceMode !== "scenes" && interfaceMode !== "traditional") throw new Error("界面模式无效");
    const current = this.getStudyScene(id);
    if (!current) throw new Error("学习集不存在");
    if (current.interfaceMode === interfaceMode) return;
    this.updateStudySet(id, { scene: { ...current, interfaceMode } });
  }
  /** Stable document identity also repairs snapshots captured before an asynchronous rename. */
  normalizeWorkspaceState(state: Record<string, unknown>): Record<string, unknown> {
    const next = clone(state);
    if (!Array.isArray(next.tabs)) return next;
    const active = next.tabs.find(tab => tab?.path === next.activePath);
    for (const tab of next.tabs) {
      if (!tab || typeof tab.path !== "string") continue;
      const document = typeof tab.documentId === "string" ? this.documents.find(doc => doc.id === tab.documentId)
        : this.documents.find(doc => doc.path === tab.path);
      if (!document) continue;
      tab.documentId = document.id; tab.path = document.path;
      if (tab.state && typeof tab.state === "object") {
        tab.state.filePath = document.path;
        if (typeof tab.state.file === "string") tab.state.file = document.path;
      }
    }
    if (active) next.activePath = active.path;
    next.tabs = next.tabs.filter((tab, index, tabs) => !tab || tabs.findIndex(other => other?.path === tab.path) === index);
    return next;
  }
  saveWorkspaceState(state: Record<string, unknown>): void {
    state = this.normalizeWorkspaceState(state);
    if (same(this.workspaceState, state)) return;
    this.workspaceState = clone(state); this.save();
  }

  subscribe(listener: (change?: { movedNodeIds: string[] }) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  subscribeLocalStatus(listener: () => void): () => void { this.statusListeners.add(listener); return () => this.statusListeners.delete(listener); }
  private localStatusChanged(): void { for (const listener of this.statusListeners) { try { listener(); } catch (error) { console.error(error); } } }
  subscribeNavigation(listener: (event: { canvasId: string; documentPath?: string }) => void): () => void { this.navigationListeners.add(listener); return () => this.navigationListeners.delete(listener); }
  subscribeDocumentRename(listener: (oldPath: string, newPath: string) => void): () => void {
    this.documentRenameListeners.add(listener); return () => this.documentRenameListeners.delete(listener);
  }
  subscribeAnnotations(path: string, listener: () => void): () => void {
    const listeners = this.annListeners.get(path) ?? new Set();
    listeners.add(listener); this.annListeners.set(path, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.annListeners.delete(path); };
  }
  private changed(nodeId?: string): void {
    if (nodeId) this.pendingMoves.add(nodeId); else this.pendingGeneralChange = true;
    if (this.notificationPending) return;
    this.notificationPending = true;
    queueMicrotask(() => { this.notificationPending = false; const change = this.pendingGeneralChange ? undefined : { movedNodeIds: [...this.pendingMoves] }; this.pendingGeneralChange = false; this.pendingMoves.clear(); for (const f of this.listeners) { try { f(change); } catch (e) { console.error(e); } } });
  }
  private annotationsChanged(path: string): void {
    for (const f of this.annListeners.get(path) ?? []) { try { f(); } catch (e) { console.error(e); } }
  }
  private report(message: string, error: unknown): void {
    const detail = errorDetail(error);
    this.publishError(!detail || message.includes(detail) ? message : `${message} ${detail}`, error);
  }
  private publishError(text: string, error: unknown): void {
    this.lastSaveError = text;
    console.error("MarginStudy:", text, error);
    new Notice(text, 12000);
  }
  private notifyExplicitConflict(conflict: DesktopMainConflict): void {
    const text = saveFailureText(conflict), now = Date.now(), previous = this.lastExplicitConflictNotice;
    if (previous?.text === text && now - previous.at < CONFLICT_NOTICE_COOLDOWN_MS) return;
    this.lastExplicitConflictNotice = { text, at: now };
    new Notice(text, CONFLICT_NOTICE_COOLDOWN_MS);
  }
  private track<T>(job: Promise<T>): void { this.jobs.add(job); void job.catch(e => this.report("关联数据保存失败", e)).finally(() => this.jobs.delete(job)); }
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.queue.then(fn);
    this.queue = job.then(() => {}, () => {});
    return job;
  }
  noteInputActivity(activeChange = 0): void {
    this.lastInputAt = Date.now();
    this.activeInputs = Math.max(0, this.activeInputs + activeChange);
    if (this.mainDirty || this.annDirty.size) this.scheduleFlush();
  }
  private async waitForInputQuiet(requireQuiet: boolean): Promise<void> {
    while (this.activeInputs || (requireQuiet && Date.now() - this.lastInputAt < INPUT_QUIET_MS)) {
      const remaining = INPUT_QUIET_MS - (Date.now() - this.lastInputAt);
      await new Promise<void>(resolve => setTimeout(resolve, Math.max(50, Math.min(INPUT_QUIET_MS, remaining || 50))));
    }
  }
  private scheduleFlush(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    if (this.saveIdle !== null && typeof cancelIdleCallback === "function") cancelIdleCallback(this.saveIdle);
    this.saveTimer = null;
    this.saveIdle = null;
    if (this.settings.diagnosticNoPersist || this.studySetImportCanvasId || this.desktopConflict) return;
    const attempt = () => {
      this.saveTimer = null;
      const remaining = INPUT_QUIET_MS - (Date.now() - this.lastInputAt);
      if (this.activeInputs || remaining > 0) {
        this.saveTimer = setTimeout(attempt, remaining > 0 ? remaining : SAVE_DEBOUNCE_MS);
        return;
      }
      if (typeof requestIdleCallback === "function") {
        this.saveIdle = requestIdleCallback(() => {
          this.saveIdle = null;
          if (this.activeInputs || Date.now() - this.lastInputAt < INPUT_QUIET_MS) { this.scheduleFlush(); return; }
          void this.flush(true).catch(() => {});
        }, { timeout: SAVE_DEBOUNCE_MS });
      } else void this.flush(true).catch(() => {});
    };
    this.saveTimer = setTimeout(attempt, SAVE_DEBOUNCE_MS);
  }
  save(): void {
    if (!this.mainDirty) this.recordLocalEvent("pending", [], "本地修改等待保存。");
    this.mainDirty = true; this.mainVersion++;
    if (!this.studySetImportCanvasId) this.changed();
    this.scheduleFlush();
  }

  /** Flush includes edits arriving while an earlier disk write is in progress. */
  async flush(automatic = false, { notifyExistingConflict = false } = {}): Promise<void> {
    if (this.saveTimer !== null) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.saveIdle !== null && typeof cancelIdleCallback === "function") cancelIdleCallback(this.saveIdle);
    this.saveIdle = null;
    if (this.settings.diagnosticNoPersist) return;
    if (this.jobs.size) await Promise.allSettled([...this.jobs]);
    await this.enqueue(async () => {
      try {
        if (this.loadBlocked) throw new Error("主数据未成功读取，写入已锁定");
        this.assertNoDesktopMainConflict();
        const legacy = this.baseline;
        if ((this.annDirty.size || this.mainDirty) && this.needsMainMigration(legacy)) {
          this.baseline = await withSharedCommitLock(this.host.app.vault.adapter, () => this.migrateMain(legacy));
        }
        // Commit source sidecars first; main cards must never claim an unwritten source.
        while (!this.settings.diagnosticNoPersist && (this.annDirty.size || this.mainDirty)) {
          for (const path of [...this.annDirty.keys()]) {
            if (this.settings.diagnosticNoPersist) return;
            await this.persistAnnotations(path, automatic);
          }
          if (!this.settings.diagnosticNoPersist && this.mainDirty) await this.persistMain(automatic);
        }
        this.lastSaveError = null;
      } catch (e) {
        if (e instanceof DesktopMainConflict) {
          if (this.desktopConflict !== e) {
            this.markDesktopConflict(e);
            if (notifyExistingConflict) this.lastExplicitConflictNotice = { text: saveFailureText(e), at: Date.now() };
          } else if (notifyExistingConflict) this.notifyExplicitConflict(e);
        } else if (!this.studySetImportCanvasId) {
          this.publishError(saveFailureText(e), e);
        }
        throw e;
      }
    });
  }

  private desktopMainLocation(): { base: string; path: string } | null {
    if (typeof process === "undefined" || process.platform !== "darwin" || !this.host.manifest?.dir) return null;
    const adapter = this.host.app.vault.adapter as App["vault"]["adapter"] & { getBasePath?: () => string };
    const base = adapter.getBasePath?.();
    return base ? { base, path: `${this.host.manifest.dir}/data.json` } : null;
  }

  assertNoDesktopMainConflict(): void {
    if (this.desktopConflict) throw this.desktopConflict;
  }

  hasDesktopMainConflict(): boolean { return this.desktopConflict !== null; }

  private markDesktopConflict(conflict: DesktopMainConflict, notify = true): void {
    this.desktopConflict = conflict;
    this.conflictPath = conflict.path;
    this.pendingConflict = null;
    let objectIds: string[] = [];
    try {
      const local = JSON.parse(conflict.local), remote = JSON.parse(conflict.remote);
      this.validateData(local);
      this.validateData(remote);
      this.pendingConflict = { local, remote };
      objectIds = protectedObjects(local).map(item => item.id);
    } catch {
      notify = true;
    }
    this.recordLocalEvent("conflict-detected", objectIds, "检测到主数据外部修改；本地候选与外部版本已保留：" + conflict.path);
    if (notify) this.publishError(saveFailureText(conflict), conflict);
    this.localStatusChanged();
  }

  private async commitMainReplacement(path: string, disk: unknown, content: string, stamp: string, expectedText?: string): Promise<void> {
    const adapter = this.host.app.vault.adapter as App["vault"]["adapter"] & { getBasePath?: () => string };
    const basePath = adapter.getBasePath?.();
    const checkCurrent = (current: string) => {
      if (expectedText === undefined ? !same(JSON.parse(current), disk) : current !== expectedText) {
        throw new Error(expectedText === undefined ? "导入期间主数据发生变化，请重试。" : "迁移提交前主数据发生变化，请重新打开学习库。");
      }
    };
    if (disk != null && this.desktopMainLocation() && basePath) {
      await replaceMacMain(adapter, basePath, path, content, checkCurrent);
      return;
    }
    if (disk != null && !basePath) {
      await adapter.process(path, current => { checkCurrent(current); return content; });
      return;
    }
    const staged = path + "." + stamp + ".tmp";
    try {
      await adapter.write(staged, content);
      if (disk != null && basePath) {
        if (expectedText !== undefined) checkCurrent(await adapter.read(path));
        const fs = (require("fs") as typeof import("fs")).promises;
        const { join } = require("path") as typeof import("path");
        await fs.rename(join(basePath, staged), join(basePath, path));
      } else {
        await adapter.rename(staged, path);
      }
    } catch (error) {
      if (await adapter.exists(staged)) await adapter.remove(staged);
      throw error;
    }
  }

  private async persistMain(automatic = false, resolvingDesktopConflict = false): Promise<void> {
    const started = perfEnabledForPen() ? performance.now() : 0;
    try { return await withSharedCommitLock(this.host.app.vault.adapter, async () => {
    const version = this.mainVersion;
    const yieldForInput = () => this.waitForInputQuiet(automatic);
    const local = JSON.parse(await serializeData(cloneSnapshot(this.data(false)), yieldForInput)) as PluginData;
    const disk = await this.host.loadData();
    if (await serializeData(disk, yieldForInput) !== await serializeData(this.baseline, yieldForInput)) {
      if (resolvingDesktopConflict) throw new Error("处理冲突期间主数据再次变化；请重新选择。");
      if (disk != null) this.validateData(disk);
      // Preserve both versions before stopping. Choosing a winner is an explicit user action.
      const path = await this.writeRecovery("main-conflict", { local, remote: disk, baseline: this.baseline });
      this.pendingConflict = { local, remote: disk ?? {} as PluginData };
      this.conflictPath = path;
      this.recordLocalEvent("conflict-detected", protectedObjects(local).map(item => item.id), "检测到主数据外部修改；两份版本已保留：" + path);
      this.localStatusChanged();
      throw new LibrarySaveConflict("发现主数据外部修改。两份版本保留于 " + path);
    }
    const importCanvasId = this.studySetImportCanvasId;
    const media = importCanvasId ? undefined : await externalizeMedia(local, this.host.app.vault.adapter);
    local.revision = this.revision + 1;
    local.savedAt = new Date().toISOString();
    const savedEvent: LocalEvent = { id: uid("local-event"), at: local.savedAt, kind: "saved", objectIds: [], detail: "本地数据已落盘。" };
    local.localEvents = [...(local.localEvents ?? []), savedEvent];
    if (!importCanvasId) await this.writeRecovery("pending-main", local, true, automatic);
    if ((importCanvasId || resolvingDesktopConflict) && this.host.manifest?.dir) {
      const path = this.host.manifest.dir + "/data.json";
      const content = await serializeData(local, yieldForInput);
      await this.commitMainReplacement(path, disk, content, importCanvasId ?? uid("resolution"));
    } else if (this.host.manifest?.dir) {
      const content = await serializeData(local, yieldForInput);
      await this.waitForInputQuiet(automatic);
      await this.host.app.vault.adapter.write(this.host.manifest.dir + "/data.json", content);
    } else {
      await this.waitForInputQuiet(automatic);
      await this.host.saveData(local);
    }
    this.localEvents.push(savedEvent);
    if (media) {
      applyMediaReplacements(this, media.replacements);
      if (media.count) console.info(`MarginStudy: 图片外置 ${media.count} 项，${media.bytes} 字节，耗时 ${media.elapsedMs} ms`);
    }
    this.baseline = cloneSnapshot(local);
    this.revision = local.revision;
    if (this.mainVersion === version) this.mainDirty = false;
    this.localStatusChanged();
    }); } finally { if (started) recordPenPersistence(started, performance.now()); }
  }

  /** Resolve only after the UI presents the retained versions. */
  async resolveDataConflict(strategy: "local" | "remote" | "merge"): Promise<void> {
    await this.enqueue(async () => {
      if (!this.pendingConflict) {
        if (this.desktopConflict) throw new Error("冲突版本未通过主数据校验。请检查保留的原始文件：" + this.desktopConflict.path);
        return;
      }
      const remote = await this.host.loadData();
      if (remote != null) this.validateData(remote);
      const current = this.data();
      const version = this.mainVersion;
      const desktop = this.desktopConflict, location = desktop && this.desktopMainLocation();
      const pending = this.pendingConflict;
      const local = desktop ? pending.local : current;
      const external = desktop ? pending.remote : remote;
      if (desktop) await this.createProtectionSnapshot("主数据冲突：外部版本", protectedObjects(pending.remote), pending.remote);
      if (desktop && this.mainDirty) await this.createProtectionSnapshot("处理主数据冲突前的窗口修改", protectedObjects(current), current);
      const protection = await this.createProtectionSnapshot(desktop ? "主数据冲突：本地候选" : "处理主数据外部修改", protectedObjects(local), local, remote);
      if (version !== this.mainVersion) throw new Error("生成保护快照期间本地数据发生变化；请重新处理冲突");
      const resolved = strategy === "remote" ? clone(external ?? {}) : strategy === "local" ? local : mergePreservingVersions(local, external ?? {});
      const localEvents = this.localEventUnion(remote?.localEvents ?? [], this.localEvents);
      const previousBaseline = this.baseline;
      this.applyData(resolved);
      this.localEvents = localEvents;
      const objectIds = protection.scope.map(item => item.id);
      if (strategy === "merge") this.recordLocalEvent("conflict-merged", objectIds, "已合并外部冲突；保护快照：" + protection.path);
      this.recordLocalEvent("external-applied", objectIds, "已选择" + (strategy === "remote" ? "磁盘版本" : strategy === "local" ? "当前窗口版本" : "合并版本") + "；保护快照：" + protection.path);
      this.baseline = clone(remote);
      this.mainDirty = true; this.mainVersion++;
      const resolvingVersion = this.mainVersion;
      try { await this.persistMain(false, !!desktop); }
      catch (error) {
        const events = this.localEvents.filter(event => event.kind !== "conflict-merged" && event.kind !== "external-applied" || !event.detail.includes(protection.path));
        if (this.mainVersion === resolvingVersion) this.applyData(current);
        this.localEvents = this.localEventUnion(current.localEvents ?? [], events); this.baseline = previousBaseline;
        this.mainDirty = true; this.mainVersion++;
        if (error instanceof DesktopMainConflict) this.markDesktopConflict(error);
        this.changed(); throw error;
      }
      if (desktop && location) await resolveDesktopMainReplacement(location.base, desktop);
      this.pendingConflict = null;
      this.conflictPath = null;
      this.desktopConflict = null;
      this.lastExplicitConflictNotice = null;
      if (desktop) this.lastSaveError = null;
      const next = location && await recoverDesktopMainReplacement(location.base, location.path);
      if (next) this.markDesktopConflict(next);
      if (this.mainDirty || this.annDirty.size) this.scheduleFlush();
      this.changed();
    });
  }

  private async createProtectionSnapshot(reason: string, objects: ProtectedObject[], data?: PluginData, remote?: unknown): Promise<ProtectionSnapshotInfo> {
    const id = uid("protection"), createdAt = new Date().toISOString();
    const scope = objects.map(({ collection, id: objectId, docPath }) => ({ collection, id: objectId, ...(docPath ? { docPath } : {}) }));
    const snapshot = signProtectionSnapshot({ format: "margin-study-protection", version: 1, id, createdAt, reason, scope, objects: clone(objects), ...(data ? { data: clone(data) } : {}), ...(remote !== undefined ? { remote: clone(remote) } : {}) });
    const path = await this.writeRecovery("protection", snapshot);
    const read = validateProtectionSnapshot(JSON.parse(await this.host.app.vault.adapter.read(path)));
    if (read.id !== id) throw new Error("保护快照回读不一致，已取消应用外部修改");
    const info = { path, id, createdAt, reason, scope };
    this.protectionSnapshots.push(info);
    return clone(info);
  }

  async listProtectionSnapshots(): Promise<ProtectionSnapshotInfo[]> {
    const adapter = this.host.app.vault.adapter;
    const paths = new Set(this.protectionSnapshots.map(snapshot => snapshot.path));
    if (adapter.list && await adapter.exists("_marginstudy-recovery")) for (const path of (await adapter.list("_marginstudy-recovery")).files) {
      if (/^_marginstudy-recovery\/protection-[a-zA-Z0-9-]+\.json$/.test(path)) paths.add(path);
    }
    const snapshots: ProtectionSnapshotInfo[] = [];
    for (const path of paths) {
      try {
        const snapshot = validateProtectionSnapshot(JSON.parse(await adapter.read(path)));
        snapshots.push({ path, id: snapshot.id, createdAt: snapshot.createdAt, reason: snapshot.reason, scope: clone(snapshot.scope) });
      } catch (error) { console.warn("MarginStudy: 无法读取保护快照", path, error); }
    }
    return snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async restoreProtectionSnapshot(path: string, objectIds: string[]): Promise<void> {
    if (!/^_marginstudy-recovery\/protection-[a-zA-Z0-9-]+\.json$/.test(path)) throw new Error("不是有效的保护快照路径");
    if (!Array.isArray(objectIds) || !objectIds.length || new Set(objectIds).size !== objectIds.length || objectIds.some(id => typeof id !== "string" || !id)) throw new Error("请选择要恢复的对象");
    await this.enqueue(async () => {
      const snapshot = validateProtectionSnapshot(JSON.parse(await this.host.app.vault.adapter.read(path)));
    const selected = objectIds.map(id => {
        const matches = snapshot.objects.filter(item => item.id === id);
        if (matches.length !== 1) throw new Error("选定对象不在快照中或 ID 不唯一：" + id);
        return matches[0];
      });
      const beforeData = this.data();
      const changes = selected.filter(item => item.collection !== "annotations").map(item => {
        const collection = item.collection as typeof protectedCollections[number];
        const live = (this[collection] ?? []) as unknown as Record<string, unknown>[];
        const index = live.findIndex(value => value.id === item.id);
        return { collection, live, index, value: clone(item.value) };
      });
      const next = this.data();
      for (const change of changes) {
        const target = ((next[change.collection] ??= []) as unknown as Record<string, unknown>[]);
        if (change.index < 0) target.push(clone(change.value)); else target[change.index] = clone(change.value);
      }
      this.validateData(next);
      const annotationChanges = new Map<string, Annotation[]>();
      for (const item of selected.filter(item => item.collection === "annotations")) {
        const docPath = safePath(item.docPath!);
        if (this.annBlocked.has(docPath)) throw new Error("该文档存在待处理的批注冲突：" + docPath);
        const draft = annotationChanges.get(docPath) ?? clone(await this.loadAnnotations(docPath));
        const index = draft.findIndex(annotation => annotation.id === item.id);
        if (index < 0) draft.push(clone(item.value) as unknown as Annotation); else draft[index] = clone(item.value) as unknown as Annotation;
        validateAnnotationCollection(draft); annotationChanges.set(docPath, draft);
      }
      if (!same(beforeData, this.data())) throw new Error("恢复准备期间本地数据发生变化；请重新选择对象");
      const annotationVersions = new Map([...annotationChanges].map(([docPath]) => [docPath, { value: clone(this.annCache.get(docPath) ?? []), version: this.annDirty.get(docPath) }]));
      const rollbackObjects: ProtectedObject[] = changes.flatMap(change => change.index < 0 ? [] : [{ collection: change.collection, id: change.value.id as string, value: clone(change.live[change.index]) }]);
      for (const [docPath] of annotationChanges) {
        const ids = new Set(selected.filter(item => item.collection === "annotations" && item.docPath === docPath).map(item => item.id));
        rollbackObjects.push(...protectedAnnotations(docPath, (this.annCache.get(docPath) ?? []).filter(annotation => ids.has(annotation.id))));
      }
      await this.createProtectionSnapshot("恢复选定对象之前", rollbackObjects);
      if (!same(beforeData, this.data())) throw new Error("生成恢复前快照期间本地数据发生变化；请重新选择对象");
      for (const [docPath, previous] of annotationVersions) if (previous.version !== this.annDirty.get(docPath) || !same(previous.value, this.annCache.get(docPath) ?? [])) throw new Error("生成恢复前快照期间批注发生变化；请重新选择对象");
      for (const change of changes) {
        if (change.collection === "sceneTemplates" && !this.sceneTemplates) this.sceneTemplates = [];
        const live = this[change.collection] as unknown as Record<string, unknown>[];
        if (change.index < 0) live.push(change.value); else live[change.index] = change.value;
      }
      for (const [docPath, annotations] of annotationChanges) {
        const live = this.annCache.get(docPath)!;
        for (const item of selected.filter(entry => entry.collection === "annotations" && entry.docPath === docPath)) {
          const index = live.findIndex(annotation => annotation.id === item.id), value = annotations.find(annotation => annotation.id === item.id)!;
          if (index < 0) live.push(value); else live[index] = value;
        }
        this.saveAnnotationsDebounced(docPath, live);
      }
      this.recordLocalEvent("restored", objectIds, "已从保护快照恢复选定对象：" + path);
      this.save();
    });
  }

  private async ensureDir(path: string): Promise<void> {
    const adapter = this.host.app.vault.adapter;
    let current = "";
    for (const part of safePath(path).split("/")) { current = current ? current + "/" + part : part; if (!await adapter.exists(current)) await adapter.mkdir(current); }
  }
  private async writeRecovery(label: string, payload: unknown, rolling = false, automatic = false): Promise<string> {
    const dir = "_marginstudy-recovery";
    await this.ensureDir(dir);
    const recoveryWriter = "device-rolling-000001";
    const path = `${dir}/${label}-${rolling ? recoveryWriter : uid("snapshot")}.json`;
    const isPendingAnn = rolling && label !== "pending-main" && payload && typeof (payload as { docPath?: unknown }).docPath === "string" && Array.isArray((payload as { annotations?: unknown }).annotations);
    const content = rolling
      ? {
          ...(payload as object),
          writerId: recoveryWriter,
          ...(isPendingAnn ? { txId: uid("pending"), contentDigest: this.pendingAnnotationsDigest((payload as { docPath: string }).docPath, (payload as { annotations: Annotation[] }).annotations) } : {}),
        }
      : payload;
    const text = rolling ? await serializeData(content, () => this.waitForInputQuiet(automatic)) : JSON.stringify(content, null, 2);
    if (rolling) await this.waitForInputQuiet(automatic);
    await this.host.app.vault.adapter.write(path, text);
    if (rolling) {
      await this.pruneRecoveries(path, label === "pending-main" ? "main" : "annotations", recoveryWriter).catch(error => console.warn("MarginStudy recovery cleanup failed", error));
    }
    return path;
  }

  private async pruneRecoveries(currentPath: string, category: "main" | "annotations", writerId?: string): Promise<void> {
    const adapter = this.host.app.vault.adapter;
    if (!adapter.list || !adapter.stat || !adapter.remove) return;
    const candidates: { path: string; mtime: number; size: number }[] = [];
    for (const path of (await adapter.list("_marginstudy-recovery")).files) {
      const match = (category === "main" ? /^_marginstudy-recovery\/pending-main-(device-[a-z0-9]+-[a-z0-9]{1,6})\.json$/ : /^_marginstudy-recovery\/pending-annotations-(?:[a-f0-9]{12}|[a-f0-9]{64})-(device-[a-z0-9]+-[a-z0-9]{1,6})\.json$/).exec(path);
      if (!match) continue;
      if (category === "annotations" && writerId && match[1] !== writerId) continue;
      const stat = await adapter.stat(path);
      if (!stat || stat.type !== "file") continue;
      try {
        const data = JSON.parse(await adapter.read(path));
        if (data?.writerId !== match[1] || (category === "main" ? ![2, MAIN_SCHEMA_VERSION].includes(data?.schemaVersion) : typeof data?.docPath !== "string" || !Array.isArray(data?.annotations))) continue;
        // Invariant R: never prune a pending annotations snapshot unless its own document's authoritative sidecar covers all its facts.
        if (category === "annotations" && path !== currentPath && !await this.canDeleteRecovery("pending-annotations", path)) continue;
      } catch { continue; }
      candidates.push({ path, mtime: stat.mtime, size: stat.size });
    }
    candidates.sort((left, right) => Number(right.path === currentPath) - Number(left.path === currentPath) || right.mtime - left.mtime);
    let count = 0, size = 0;
    for (const file of candidates) {
      if (file.path === currentPath || (count < 3 && size + file.size < 2 * 1024 * 1024)) {
        count++; size += file.size;
      } else if (category === "annotations") {
        if (await this.deleteRecoveryIfProved("pending-annotations", file.path)) {
          console.info("MarginStudy recovery removed", file.path, file.size);
        }
      } else {
        await adapter.remove(file.path);
        console.info("MarginStudy recovery removed", file.path, file.size);
      }
    }
  }

  sidecarPath(path: string): string { return path + ".mstudy.json"; }
  getAnnotationsRevision(path: string): number { return this.annotationRevisions.get(path) ?? 0; }
  private bumpAnnotationsRevision(path: string): void { this.annotationRevisions.set(path, this.getAnnotationsRevision(path) + 1); }
  async loadAnnotations(path: string): Promise<Annotation[]> {
    if (this.annCache.has(path)) return this.annCache.get(path)!;
    if (this.annLoads.has(path)) return this.annLoads.get(path)!;
    const job = (async () => {
      await this.recoverPendingAnnotationMerges(path);
      const adapter = this.host.app.vault.adapter;
      const sidecar = this.sidecarPath(path);
      const text = await adapter.exists(sidecar) ? await adapter.read(sidecar) : null;
      try {
        if (this.annCache.has(path)) return this.annCache.get(path)!;
        const obj = text === null ? { annotations: [] } : JSON.parse(text);
        validateAnnotationCollection(obj?.annotations);
        const anns = obj.annotations as Annotation[];
        this.annCache.set(path, anns); this.bumpAnnotationsRevision(path); this.annBase.set(path, text); this.annBlocked.delete(path);
        return anns;
      } catch (e) {
        this.annBlocked.add(path);
        this.report("标注文件损坏，已暂停该文档写入，原文件保持完整：" + sidecar, e);
        throw e;
      }
    })();
    this.annLoads.set(path, job);
    try { return await job; } finally { this.annLoads.delete(path); }
  }

  saveAnnotationsDebounced(path: string, anns: Annotation[]): void {
    validateAnnotationCollection(anns);
    if (this.annBlocked.has(path)) { this.report("此文档的标注文件尚未修复，不能覆盖", path); return; }
    const cached = this.annCache.get(path);
    if (cached && cached !== anns) cached.splice(0, cached.length, ...anns);
    else if (!cached) this.annCache.set(path, anns);
    this.bumpAnnotationsRevision(path);
    if (!this.annDirty.size && !this.mainDirty) this.recordLocalEvent("pending", anns.map(annotation => annotation.id), "文档批注等待保存：" + path);
    this.annDirty.set(path, (this.annDirty.get(path) ?? 0) + 1);
    this.annotationsChanged(path);
    this.scheduleFlush();
  }
  async saveAnnotationsNow(path: string, anns: Annotation[]): Promise<void> {
    if (this.annBlocked.has(path)) throw new Error("标注文件已锁定：" + path);
    this.saveAnnotationsDebounced(path, anns); await this.flush();
  }
  private async persistAnnotations(path: string, automatic = false): Promise<void> {
    if (this.annBlocked.has(path)) throw new Error("标注文件已锁定：" + path);
    const version = this.annDirty.get(path);
    if (version == null) return;
    const anns = JSON.parse(await serializeData(cloneSnapshot(this.annCache.get(path) ?? []), () => this.waitForInputQuiet(automatic))) as Annotation[];
    validateAnnotationCollection(anns);
    const sidecar = this.sidecarPath(path);
    const adapter = this.host.app.vault.adapter;
    const disk = await adapter.exists(sidecar) ? await adapter.read(sidecar) : null;
    if (disk !== (this.annBase.get(path) ?? null)) {
      const recovery = await this.writeRecovery("annotation-conflict", { docPath: path, local: { annotations: anns }, remote: disk });
      this.annBlocked.add(path);
      this.recordLocalEvent("conflict-detected", anns.map(annotation => annotation.id), "检测到文档批注外部修改：" + path);
      this.localStatusChanged();
      throw new LibrarySaveConflict("标注被外部修改，已保留两份版本：" + recovery);
    }
    const media = await externalizeMedia({ annotations: anns }, adapter);
    const content = await serializeData({ schemaVersion: SIDECAR_SCHEMA_VERSION, annotations: anns }, () => this.waitForInputQuiet(automatic));
    // A rolling recovery copy also covers a partial host write or forced process exit.
    await this.writeRecovery("pending-annotations-" + sha(path), { docPath: path, annotations: anns }, true, automatic);
    await this.waitForInputQuiet(automatic);
    await adapter.write(sidecar, content);
    this.recordLocalEvent("saved", anns.map(annotation => annotation.id), "文档批注已落盘：" + path);
    this.save();
    if (media.replacements.size) {
      applyMediaReplacements({ annotations: this.annCache.get(path) ?? [] }, media.replacements);
      this.bumpAnnotationsRevision(path);
    }
    this.annBase.set(path, content);
    if (this.annDirty.get(path) === version) this.annDirty.delete(path);
  }

  getAnnotationConflicts(): string[] { return [...this.annBlocked]; }

  private pendingAnnotationsPath(path: string): string {
    return `_marginstudy-recovery/pending-annotations-${sha(path)}-device-rolling-000001.json`;
  }

  private legacyPendingAnnotationsPath(path: string): string {
    return `_marginstudy-recovery/pending-annotations-${sha(path).slice(0, 12)}-device-rolling-000001.json`;
  }

  private pendingMergeTxPath(path: string): string {
    return `_marginstudy-recovery/pending-merge-tx-${sha(path)}.json`;
  }

  private legacyPendingMergeTxPath(path: string): string {
    return `_marginstudy-recovery/pending-merge-tx-${sha(path).slice(0, 12)}.json`;
  }

  private pendingAnnotationsDigest(docPath: string, annotations: Annotation[]): string {
    return sha(this.canonicalJson({ docPath, annotations }));
  }

  private pendingTxDigest(tx: {
    txId?: string;
    docPath: string;
    sidecarPath: string;
    expectedSidecarHash?: string;
    previousDiskRaw?: string | null;
    protectionPath?: string;
    localIds?: string[];
    mergeConflictIdMap?: Record<string, string>;
    mergeProcessedPens?: Record<string, unknown>;
    unbindEvents?: { dedupeKey: string; penId: string; oldHostId: string; reason: string; detail: string }[];
  }): string {
    return sha(this.canonicalJson({
      txId: tx.txId ?? "",
      docPath: tx.docPath,
      sidecarPath: tx.sidecarPath,
      expectedSidecarHash: tx.expectedSidecarHash ?? "",
      previousDiskRaw: tx.previousDiskRaw ?? null,
      protectionPath: tx.protectionPath ?? "",
      localIds: tx.localIds ?? [],
      mergeConflictIdMap: tx.mergeConflictIdMap ?? {},
      mergeProcessedPens: tx.mergeProcessedPens ?? {},
      unbindEvents: tx.unbindEvents ?? [],
    }));
  }

  private async sidecarCoversAnnotations(docPath: string, pendingAnns: Annotation[]): Promise<boolean> {
    const adapter = this.host.app.vault.adapter;
    const sidecar = this.sidecarPath(docPath);
    if (!await adapter.exists(sidecar)) return false;
    try {
      const parsed = JSON.parse(await adapter.read(sidecar));
      if (!Array.isArray(parsed?.annotations)) return false;
      const byId = new Map<string, Annotation>();
      for (const item of parsed.annotations as Annotation[]) if (item && typeof item.id === "string") byId.set(item.id, item);
      for (const ann of pendingAnns) {
        if (!ann || typeof ann.id !== "string") return false;
        const authoritative = byId.get(ann.id);
        if (!authoritative || this.canonicalJson(authoritative) !== this.canonicalJson(ann)) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private docMetaCoversTx(docPath: string, tx: {
    mergeConflictIdMap?: Record<string, string>;
    mergeProcessedPens?: Record<string, unknown>;
    unbindEvents?: { dedupeKey: string }[];
  }): boolean {
    const meta = this.docMeta[docPath];
    if (!meta) return false;
    const keySet = new Set<string>(meta.unbindEventKeys ?? []);
    for (const ev of tx.unbindEvents ?? []) if (!keySet.has(ev.dedupeKey)) return false;
    const map = meta.mergeConflictIdMap ?? {};
    for (const [k, v] of Object.entries(tx.mergeConflictIdMap ?? {})) if (map[k] !== v) return false;
    const processed = meta.mergeProcessedPens ?? {};
    for (const [k, v] of Object.entries(tx.mergeProcessedPens ?? {})) {
      if (this.canonicalJson(processed[k]) !== this.canonicalJson(v)) return false;
    }
    return true;
  }

  private async diskCoversTx(tx: {
    docPath: string;
    sidecarPath: string;
    expectedSidecarHash: string;
    mergeConflictIdMap?: Record<string, string>;
    mergeProcessedPens?: Record<string, unknown>;
    unbindEvents?: { dedupeKey: string; penId: string; oldHostId: string; reason: string; detail: string }[];
  }): Promise<boolean> {
    const adapter = this.host.app.vault.adapter;
    try {
      if (!await adapter.exists(tx.sidecarPath)) return false;
      const diskSidecar = await adapter.read(tx.sidecarPath);
      if (sha(diskSidecar) !== tx.expectedSidecarHash) return false;
      const parsedSidecar = JSON.parse(diskSidecar);
      validateAnnotationCollection(parsedSidecar?.annotations);
      const diskMain = await this.host.loadData() as Partial<PluginData> | null | undefined;
      const diskMeta = diskMain?.docMeta?.[tx.docPath];
      if (!diskMeta) return false;
      const keySet = new Set<string>(diskMeta.unbindEventKeys ?? []);
      const diskEvents = Array.isArray(diskMain?.localEvents) ? diskMain.localEvents : [];
      for (const ev of tx.unbindEvents ?? []) {
        if (!keySet.has(ev.dedupeKey)) return false;
        const matchedEvent = diskEvents.some(item =>
          item && item.kind === "conflict-merged" &&
          Array.isArray(item.objectIds) && item.objectIds.includes(ev.penId) &&
          item.detail === ev.detail
        );
        if (!matchedEvent) return false;
      }
      const map = diskMeta.mergeConflictIdMap ?? {};
      for (const [k, v] of Object.entries(tx.mergeConflictIdMap ?? {})) if (map[k] !== v) return false;
      const processed = diskMeta.mergeProcessedPens ?? {};
      for (const [k, v] of Object.entries(tx.mergeProcessedPens ?? {})) {
        if (this.canonicalJson(processed[k]) !== this.canonicalJson(v)) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  static recoveryDeleteGateApprovals = 0;

  /**
   * Single gate for deleting ANY annotation recovery file (Invariant R).
   * All recovery deletions MUST pass disk-level field-by-field proof through this gate.
   */
  private async canDeleteRecovery(
    kind: "merge-tx" | "merge-tx-rolled-back" | "pending-annotations" | "tombstone" | "rollback-artifact",
    file: string,
    context?: {
      multiBranch?: boolean;
      expectedDocPath?: string;
      expectedWriterId?: string;
      expectedTxId?: string;
      expectedArtifactDigest?: string;
      expectedArtifactKind?: "pending-annotations" | "merge-tx";
      expectedRestoredPath?: string;
      expectedRestoredDigest?: string;
      restoredKind?: "pending-annotations" | "merge-tx";
    },
  ): Promise<boolean> {
    const adapter = this.host.app.vault.adapter;
    const approve = (ok: boolean): boolean => {
      if (ok) Store.recoveryDeleteGateApprovals++;
      return ok;
    };
    try {
      if (!await adapter.exists(file)) return false;
      if (kind === "merge-tx") {
        if (context?.multiBranch) return false;
        const tx = JSON.parse(await adapter.read(file));
        if (!tx || typeof tx.docPath !== "string" || typeof tx.sidecarPath !== "string") return false;
        return approve(await this.diskCoversTx(tx));
      }
      if (kind === "merge-tx-rolled-back") {
        const tx = JSON.parse(await adapter.read(file));
        if (!tx || typeof tx.docPath !== "string" || typeof tx.sidecarPath !== "string") return false;
        const diskSidecar = await adapter.exists(tx.sidecarPath) ? await adapter.read(tx.sidecarPath) : null;
        if (tx.previousDiskRaw === null) {
          if (diskSidecar === null) return approve(true);
        } else if (diskSidecar !== null && sha(diskSidecar) === sha(tx.previousDiskRaw)) {
          return approve(true);
        }
        // Also allow if a valid third-party sidecar update superseded the uncommitted merge (not corrupted, not our expectedSidecarHash).
        if (diskSidecar !== null && sha(diskSidecar) !== tx.expectedSidecarHash) {
          try {
            const parsed = JSON.parse(diskSidecar);
            validateAnnotationCollection(parsed?.annotations);
            return approve(true);
          } catch {
            return false;
          }
        }
        return false;
      }
      if (kind === "pending-annotations") {
        const data = JSON.parse(await adapter.read(file));
        if (!data || typeof data.docPath !== "string" || !Array.isArray(data.annotations)) return false;
        return approve(await this.sidecarCoversAnnotations(data.docPath, data.annotations));
      }
      if (kind === "tombstone") {
        const data = JSON.parse(await adapter.read(file));
        if (!data || typeof data.docPath !== "string") return false;
        const txSuccessorCoversTombstone = (tomb: any, succ: any): boolean => {
          if (typeof tomb.txId === "string" && tomb.txId && succ.txId !== tomb.txId) return false;
          const oldPrefix = `${tomb.docPath}\u0000`, newPrefix = `${succ.docPath}\u0000`;
          const succEvents = Array.isArray(succ.unbindEvents) ? succ.unbindEvents : [];
          for (const ev of Array.isArray(tomb.unbindEvents) ? tomb.unbindEvents : []) {
            const expectedKey = typeof ev.dedupeKey === "string" && ev.dedupeKey.startsWith(oldPrefix)
              ? newPrefix + ev.dedupeKey.slice(oldPrefix.length) : ev.dedupeKey;
            const matched = succEvents.some((item: any) =>
              item && item.penId === ev.penId && item.oldHostId === ev.oldHostId &&
              item.reason === ev.reason && item.detail === ev.detail && item.dedupeKey === expectedKey
            );
            if (!matched) return false;
          }
          const succMap = succ.mergeConflictIdMap ?? {};
          for (const [k, v] of Object.entries(tomb.mergeConflictIdMap ?? {})) if (succMap[k] !== v) return false;
          const succProcessed = succ.mergeProcessedPens ?? {};
          for (const [k, v] of Object.entries(tomb.mergeProcessedPens ?? {})) {
            if (this.canonicalJson(succProcessed[k]) !== this.canonicalJson(v)) return false;
          }
          return true;
        };
        const annSuccessorCoversTombstone = (tomb: any, succ: any): boolean => {
          if (!Array.isArray(tomb.annotations) || !Array.isArray(succ.annotations)) return false;
          const byId = new Map<string, any>();
          for (const item of succ.annotations) if (item && typeof item.id === "string") byId.set(item.id, item);
          for (const ann of tomb.annotations) {
            if (!ann || typeof ann.id !== "string") return false;
            const expected = ann.docPath === tomb.docPath ? { ...ann, docPath: succ.docPath } : ann;
            const candidate = byId.get(ann.id);
            if (!candidate || this.canonicalJson(candidate) !== this.canonicalJson(expected)) return false;
          }
          return true;
        };
        if (typeof data.supersededBy === "string" && typeof data.supersededDigest === "string") {
          if (await adapter.exists(data.supersededBy)) {
            const successor = JSON.parse(await adapter.read(data.supersededBy));
            if (successor && typeof successor.docPath === "string") {
              if (file.includes("/pending-annotations-") && Array.isArray(successor.annotations) &&
                this.pendingAnnotationsDigest(successor.docPath, successor.annotations) === data.supersededDigest &&
                annSuccessorCoversTombstone(data, successor)) {
                return approve(true);
              }
              if (file.includes("/pending-merge-tx-") && typeof successor.sidecarPath === "string" &&
                this.pendingTxDigest(successor) === data.supersededDigest &&
                txSuccessorCoversTombstone(data, successor)) {
                return approve(true);
              }
            }
          }
          // Successor missing, digest mismatch, or does not cover tombstone's own facts: ONLY allow if disk independently covers THIS tombstone's own facts.
          if (file.includes("/pending-annotations-") && Array.isArray(data.annotations)) {
            return approve(await this.sidecarCoversAnnotations(data.docPath, data.annotations));
          }
          if (file.includes("/pending-merge-tx-") && typeof data.sidecarPath === "string") {
            return approve(await this.diskCoversTx(data));
          }
          return false;
        }
        if (file.includes("/pending-annotations-") && Array.isArray(data.annotations)) {
          return approve(await this.sidecarCoversAnnotations(data.docPath, data.annotations));
        }
        if (file.includes("/pending-merge-tx-") && typeof data.sidecarPath === "string") {
          return approve(await this.diskCoversTx(data));
        }
        return false;
      }
      if (kind === "rollback-artifact") {
        const data = JSON.parse(await adapter.read(file));
        if (!data || typeof data.docPath !== "string") return false;
        if (!context?.expectedDocPath || data.docPath !== context.expectedDocPath) return false;
        if (!context.expectedArtifactDigest || !context.expectedArtifactKind) return false;
        if (context.expectedArtifactKind === "pending-annotations") {
          if (!context.expectedWriterId || data.writerId !== context.expectedWriterId) return false;
          if (!Array.isArray(data.annotations)) return false;
          if (this.pendingAnnotationsDigest(data.docPath, data.annotations) !== context.expectedArtifactDigest) return false;
        } else if (context.expectedArtifactKind === "merge-tx") {
          if (context.expectedTxId && data.txId !== context.expectedTxId) return false;
          if (typeof data.sidecarPath !== "string") return false;
          if (this.pendingTxDigest(data) !== context.expectedArtifactDigest) return false;
        } else {
          return false;
        }
        if (context.expectedRestoredPath && context.expectedRestoredDigest) {
          if (!await adapter.exists(context.expectedRestoredPath)) return false;
          const restored = JSON.parse(await adapter.read(context.expectedRestoredPath));
          if (context.restoredKind === "pending-annotations") {
            if (!restored || typeof restored.docPath !== "string" || !Array.isArray(restored.annotations)) return false;
            return approve(this.pendingAnnotationsDigest(restored.docPath, restored.annotations) === context.expectedRestoredDigest);
          }
          if (context.restoredKind === "merge-tx") {
            if (!restored || typeof restored.docPath !== "string" || typeof restored.sidecarPath !== "string") return false;
            return approve(this.pendingTxDigest(restored) === context.expectedRestoredDigest);
          }
          return false;
        }
        return approve(true);
      }
      return false;
    } catch {
      return false;
    }
  }

  private async deleteRecoveryIfProved(
    kind: "merge-tx" | "merge-tx-rolled-back" | "pending-annotations" | "tombstone" | "rollback-artifact",
    file: string,
    context?: Parameters<Store["canDeleteRecovery"]>[2],
  ): Promise<boolean> {
    if (!await this.canDeleteRecovery(kind, file, context)) return false;
    await this.host.app.vault.adapter.remove?.(file).catch(() => {});
    return true;
  }

  private async supersedeRecoveryFile(exactPath: string, supersededBy?: string, supersededDigest?: string): Promise<string | null> {
    const adapter = this.host.app.vault.adapter;
    if (!await adapter.exists(exactPath)) return null;
    const tombstone = `${exactPath}.superseded-${Date.now()}`;
    await adapter.rename(exactPath, tombstone);
    if (supersededBy && supersededDigest) {
      try {
        const parsed = JSON.parse(await adapter.read(tombstone));
        await adapter.write(tombstone, JSON.stringify({ ...parsed, supersededBy, supersededDigest }));
      } catch { /* retain renamed tombstone as-is */ }
    }
    return tombstone;
  }

  private async gcSupersededRecoveries(): Promise<void> {
    const adapter = this.host.app.vault.adapter;
    if (!adapter.list || !adapter.remove || !await adapter.exists("_marginstudy-recovery")) return;
    const statePath = "_marginstudy-recovery/superseded-gc-state.json";
    let counts: Record<string, number> = {};
    if (await adapter.exists(statePath)) {
      try {
        const parsed = JSON.parse(await adapter.read(statePath));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) counts = parsed;
      } catch { counts = {}; }
    }
    const tombstones = (await adapter.list("_marginstudy-recovery")).files.filter(file =>
      /^_marginstudy-recovery\/(?:pending-annotations-(?:[a-f0-9]{12}|[a-f0-9]{64})-device-[a-z0-9]+-[a-z0-9]{1,6}\.json|pending-merge-tx-(?:[a-f0-9]{12}|[a-f0-9]{64})\.json)\.superseded-\d+$/.test(file)
    );
    if (!tombstones.length) return;
    let changed = false;
    for (const file of tombstones) {
      const proved = await this.canDeleteRecovery("tombstone", file);
      if (proved) {
        const next = (counts[file] ?? 0) + 1;
        if (next >= 2) {
          if (await this.deleteRecoveryIfProved("tombstone", file)) delete counts[file];
        } else {
          counts[file] = next;
        }
        changed = true;
      } else if (counts[file]) {
        counts[file] = 0;
        changed = true;
      }
    }
    for (const key of Object.keys(counts)) {
      if (!tombstones.includes(key)) { delete counts[key]; changed = true; }
    }
    if (changed) {
      try { await adapter.write(statePath, JSON.stringify(counts)); } catch { /* non-fatal */ }
    }
  }

  private canonicalJson(value: unknown): string {
    const normalize = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(normalize);
      if (v && typeof v === "object") {
        const record = v as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(record).sort()) {
          if (record[key] !== undefined) sorted[key] = normalize(record[key]);
        }
        return sorted;
      }
      return v;
    };
    return JSON.stringify(normalize(value));
  }

  private async recoverPendingAnnotationMerges(docPath?: string): Promise<void> {
    const adapter = this.host.app.vault.adapter;
    const txPaths: string[] = [];
    if (docPath) {
      for (const candidate of [this.pendingMergeTxPath(docPath), this.legacyPendingMergeTxPath(docPath)]) {
        if (!txPaths.includes(candidate) && await adapter.exists(candidate)) txPaths.push(candidate);
      }
    } else if (adapter.list && await adapter.exists("_marginstudy-recovery")) {
      const listed = await adapter.list("_marginstudy-recovery");
      for (const file of listed.files) {
        if (/^_marginstudy-recovery\/pending-merge-tx-(?:[a-f0-9]{12}|[a-f0-9]{64})\.json$/.test(file)) txPaths.push(file);
      }
    }
    const seenCommittedTxIds = new Set<string>();
    for (const meta of Object.values(this.docMeta)) {
      const committed = (meta as DocMeta & { committedMergeTxIds?: string[] }).committedMergeTxIds;
      if (Array.isArray(committed)) for (const id of committed) seenCommittedTxIds.add(id);
    }
    const loadedTxs: { txPath: string; rawTx: string; tx: {
      txId: string;
      docPath: string;
      sidecarPath: string;
      expectedSidecarHash: string;
      previousDiskRaw: string | null;
      protectionPath: string;
      localIds: string[];
      mergeConflictIdMap: Record<string, string>;
      mergeProcessedPens?: Record<string, { finalPenId: string; bindingId: string; oldHostId?: string; reason?: string }>;
      unbindEvents: { dedupeKey: string; penId: string; oldHostId: string; reason: string; detail: string }[];
    } }[] = [];
    for (const txPath of txPaths) {
      let rawTx: string;
      try { rawTx = await adapter.read(txPath); }
      catch (readError) {
        this.report("读取待恢复合并事务失败，已保留原文件：" + txPath, readError);
        continue;
      }
      let tx: (typeof loadedTxs)[number]["tx"];
      try { tx = JSON.parse(rawTx); }
      catch (parseError) {
        const quarantinePath = `${txPath}.quarantine-${Date.now()}`;
        try { await adapter.write(quarantinePath, rawTx); } catch { /* retain original */ }
        this.report("待恢复合并事务解析失败，已保留原文件并隔离副本：" + quarantinePath, parseError);
        continue;
      }
      if (!tx || typeof tx.docPath !== "string" || typeof tx.sidecarPath !== "string") {
        const quarantinePath = `${txPath}.quarantine-${Date.now()}`;
        try { await adapter.write(quarantinePath, rawTx); } catch { /* retain original */ }
        this.report("待恢复合并事务结构无效，已保留原文件并隔离副本：" + quarantinePath, new Error("invalid pending merge tx shape"));
        continue;
      }
      if (docPath && tx.docPath !== docPath) continue;
      loadedTxs.push({ txPath, rawTx, tx });
    }
    // Prefer branches whose docPath is currently registered in this.documents so two-branch recovery is deterministic.
    const registeredPaths = new Set(this.documents.map(doc => doc.path));
    const txIdCounts = new Map<string, number>();
    for (const entry of loadedTxs) if (entry.tx.txId) txIdCounts.set(entry.tx.txId, (txIdCounts.get(entry.tx.txId) ?? 0) + 1);
    loadedTxs.sort((a, b) => Number(registeredPaths.has(b.tx.docPath)) - Number(registeredPaths.has(a.tx.docPath)) || a.tx.docPath.localeCompare(b.tx.docPath));
    for (const { txPath, tx } of loadedTxs) {
      const multiBranch = !!tx.txId && (txIdCounts.get(tx.txId) ?? 0) > 1;
      const allEventsPresent = (tx.unbindEvents ?? []).every(ev =>
        this.localEvents.some(item =>
          item && item.kind === "conflict-merged" &&
          Array.isArray(item.objectIds) && item.objectIds.includes(ev.penId) &&
          item.detail === ev.detail
        )
      );
      if (tx.txId && seenCommittedTxIds.has(tx.txId) && allEventsPresent) {
        continue;
      }
      const diskText = await adapter.exists(tx.sidecarPath) ? await adapter.read(tx.sidecarPath) : null;
      let diskValid = false;
      if (diskText !== null) {
        try {
          const parsed = JSON.parse(diskText);
          validateAnnotationCollection(parsed?.annotations);
          diskValid = true;
        } catch { diskValid = false; }
      }
      const sidecarCommitted = diskValid && diskText !== null && sha(diskText) === tx.expectedSidecarHash;
      if (sidecarCommitted) {
        // Roll forward: sidecar is valid and matches committed hash; persist merge metadata & unbind events.
        // Only remove txPath AFTER persistMain succeeds; if persistMain fails, roll back in-memory docMeta/events
        // so subsequent recovery attempts on the same Store still retry persistMain and preserve the journal.
        const hadDocMeta = Object.prototype.hasOwnProperty.call(this.docMeta, tx.docPath);
        const prevDocMeta = hadDocMeta ? clone(this.docMeta[tx.docPath]) : undefined;
        const prevLocalEvents = clone(this.localEvents);
        const prevMainDirty = this.mainDirty;
        const prevMainVersion = this.mainVersion;

        const meta = this.docMeta[tx.docPath] ?? {};
        const nextMap = { ...(meta.mergeConflictIdMap ?? {}), ...(tx.mergeConflictIdMap ?? {}) };
        const nextProcessed = { ...(meta.mergeProcessedPens ?? {}), ...(tx.mergeProcessedPens ?? {}) };
        const keySet = new Set<string>(meta.unbindEventKeys ?? []);
        let addedEvents = false;
        for (const ev of tx.unbindEvents ?? []) {
          const hasEvent = this.localEvents.some(item =>
            item && item.kind === "conflict-merged" &&
            Array.isArray(item.objectIds) && item.objectIds.includes(ev.penId) &&
            item.detail === ev.detail
          );
          if (keySet.has(ev.dedupeKey) && hasEvent) continue;
          keySet.add(ev.dedupeKey);
          if (!hasEvent) this.recordLocalEvent("conflict-merged", [ev.penId], ev.detail);
          addedEvents = true;
        }
        const committedIds = new Set<string>((meta as DocMeta & { committedMergeTxIds?: string[] }).committedMergeTxIds ?? []);
        if (tx.txId) committedIds.add(tx.txId);
        this.docMeta[tx.docPath] = { ...meta, mergeConflictIdMap: nextMap, mergeProcessedPens: nextProcessed, unbindEventKeys: [...keySet], ...(committedIds.size ? { committedMergeTxIds: [...committedIds] } : {}) } as DocMeta;
        let mainPersisted = true;
        if (addedEvents || Object.keys(tx.mergeConflictIdMap ?? {}).length || Object.keys(tx.mergeProcessedPens ?? {}).length || !!tx.txId) {
          this.mainDirty = true; this.mainVersion++;
          if (!this.settings.diagnosticNoPersist) {
            try { await this.persistMain(false); }
            catch {
              mainPersisted = false;
              if (hadDocMeta) this.docMeta[tx.docPath] = prevDocMeta!;
              else delete this.docMeta[tx.docPath];
              this.localEvents = prevLocalEvents;
              this.mainDirty = prevMainDirty;
              this.mainVersion = prevMainVersion;
            }
          }
        }
        if (mainPersisted && tx.txId) seenCommittedTxIds.add(tx.txId);
        this.annBase.set(tx.docPath, diskText);
        this.annBlocked.delete(tx.docPath);
        if (mainPersisted) await this.deleteRecoveryIfProved("merge-tx", txPath, { multiBranch });
      } else if (diskValid && diskText !== tx.previousDiskRaw) {
        // A valid third-party or externally moved sidecar exists on disk: NEVER overwrite it AND NEVER drop uncommitted journal facts!
        if (!await this.deleteRecoveryIfProved("merge-tx", txPath, { multiBranch })) {
          this.annBlocked.add(tx.docPath);
          this.report("待恢复合并事务与当前侧车摘要不一致，已保留事务日志等待处理：" + txPath, new Error("pending merge tx sidecar hash mismatch"));
        }
      } else {
        // Roll back: sidecar was partially written or corrupted; restore previous disk raw and keep conflict state.
        let diskClean = true;
        try {
          if (tx.previousDiskRaw !== null) {
            if (diskText !== tx.previousDiskRaw) await adapter.write(tx.sidecarPath, tx.previousDiskRaw);
          } else if (diskText !== null) {
            await adapter.remove?.(tx.sidecarPath);
          }
        } catch { diskClean = false; }
        this.annBlocked.add(tx.docPath);
        if (diskClean) await this.deleteRecoveryIfProved("merge-tx-rolled-back", txPath);
      }
    }
  }

  async resolveAnnotationConflict(path: string, strategy: "local" | "remote" | "merge"): Promise<void> {
    await this.enqueue(async () => {
      await this.recoverPendingAnnotationMerges(path);
      const adapter = this.host.app.vault.adapter, sidecar = this.sidecarPath(path);
      const disk = await adapter.exists(sidecar) ? await adapter.read(sidecar) : null;
      const localSnapshot = clone(this.annCache.get(path) ?? []);
      const version = this.annDirty.get(path);
      let remote: Annotation[] = [];
      try { const obj = disk == null ? { annotations: [] } : JSON.parse(disk); validateAnnotationCollection(obj?.annotations); remote = obj.annotations; }
      catch (e) { if (strategy !== "local") throw new Error("磁盘标注无法解析。可先保留损坏文件，再采用当前窗口版本；或从完整备份恢复。"); }
      const protection = await this.createProtectionSnapshot("处理文档批注外部修改：" + path, protectedAnnotations(path, localSnapshot), undefined, { docPath: path, remoteRaw: disk });
      await this.writeRecovery("resolved-annotation-conflict", { docPath: path, local: localSnapshot, remoteRaw: disk });
      if (version !== this.annDirty.get(path) || !same(localSnapshot, this.annCache.get(path) ?? [])) throw new Error("生成保护快照期间批注发生变化；请重新处理冲突");
      const currentDisk = await adapter.exists(sidecar) ? await adapter.read(sidecar) : null;
      if (currentDisk !== disk) throw new Error("磁盘批注再次变化；请重新处理冲突");
      if (version !== this.annDirty.get(path) || !same(localSnapshot, this.annCache.get(path) ?? [])) throw new Error("检查磁盘批注期间本地内容发生变化；请重新处理冲突");

      const metaBefore = this.docMeta[path] ?? {};
      const conflictIdMap: Record<string, string> = { ...(metaBefore.mergeConflictIdMap ?? {}) };
      const processedPens: Record<string, { finalPenId: string; bindingId: string; oldHostId?: string; reason?: string }> = { ...(metaBefore.mergeProcessedPens ?? {}) };
      const existingUnbindKeys = new Set<string>(metaBefore.unbindEventKeys ?? []);
      const candidate: Annotation[] = strategy === "local" ? clone(localSnapshot) : strategy === "remote" ? clone(remote) : clone(localSnapshot);
      const pendingUnbinds: { dedupeKey: string; penId: string; oldHostId: string; reason: string; detail: string }[] = [];

      if (strategy === "merge") {
        const canonicalSame = (a: unknown, b: unknown): boolean => this.canonicalJson(a) === this.canonicalJson(b);
        const remoteIdMap = new Map<string, string>();
        const remoteNonPens = remote.filter(a => a.type !== "pen");
        const remotePens = remote.filter(a => a.type === "pen");

        // Pass 1: merge non-pen annotations with canonical key-order-independent equality and stable conflict IDs.
        for (const a of remoteNonPens) {
          const existing = candidate.find(x => x.id === a.id);
          const canonicalKey = "host:" + a.id + ":" + sha(this.canonicalJson(a));
          if (!existing) {
            const knownId = conflictIdMap[canonicalKey];
            if (knownId && candidate.some(x => x.id === knownId)) {
              remoteIdMap.set(a.id, knownId);
            } else {
              candidate.push(clone(a));
              remoteIdMap.set(a.id, a.id);
            }
          } else if (canonicalSame(existing, a)) {
            remoteIdMap.set(a.id, existing.id);
          } else {
            const knownId = conflictIdMap[canonicalKey];
            if (knownId && candidate.some(x => x.id === knownId)) {
              remoteIdMap.set(a.id, knownId);
            } else {
              const nextId = knownId ?? uid("ann-conflict");
              conflictIdMap[canonicalKey] = nextId;
              candidate.push({ ...clone(a), id: nextId, cardId: undefined });
              remoteIdMap.set(a.id, nextId);
            }
          }
        }

        const effectiveInkLayer = (notebookId: string, inkLayerId?: string): string => {
          const scoped = notebookId === "default" ? metaBefore : metaBefore.documentNotebookMeta?.[notebookId];
          const validIds = new Set<string>(["default"]);
          for (const item of scoped?.handwritingLayers ?? []) {
            if (item && typeof item.id === "string" && item.id && typeof item.name === "string" && item.name.trim()) validIds.add(item.id);
          }
          return inkLayerId && validIds.has(inkLayerId) ? inkLayerId : "default";
        };

        // Helper: validate/normalize a pen's hostAnnotationId against the complete merged host set.
        // Priority (Item 08 & 10): missing -> ineligible-host -> soft-deleted-host -> cross-notebook-host -> public-pen.
        const validatePenHost = (
          pen: Annotation,
          mapRemote: boolean,
        ): { oldHostId: string; reason: "missing" | "ineligible-host" | "soft-deleted-host" | "cross-notebook-host" | "public-pen" } | null => {
          if (pen.hostAnnotationId === undefined) return null;
          const oldHostId = pen.hostAnnotationId;
          const targetHostId = mapRemote ? (remoteIdMap.get(oldHostId) ?? oldHostId) : oldHostId;
          const resolvedTarget = candidate.find(item => item.id === targetHostId);
          if (!resolvedTarget) {
            delete pen.hostAnnotationId;
            return { oldHostId, reason: "missing" };
          }
          if (!resolvedTarget.overlay || resolvedTarget.bindToInkLayer === false || (!!resolvedTarget.docPath && resolvedTarget.docPath !== path)) {
            delete pen.hostAnnotationId;
            pen.bindToInkLayer = false;
            return { oldHostId, reason: "ineligible-host" };
          }
          if (resolvedTarget.overlay.deleted === true) {
            delete pen.hostAnnotationId;
            pen.bindToInkLayer = false;
            return { oldHostId, reason: "soft-deleted-host" };
          }
          const hostNb = resolvedTarget.documentNotebookId ?? "default";
          const penNb = pen.documentNotebookId ?? "default";
          if (hostNb !== penNb) {
            delete pen.hostAnnotationId;
            pen.bindToInkLayer = false;
            return { oldHostId, reason: "cross-notebook-host" };
          }
          if (pen.bindToInkLayer === false) {
            delete pen.hostAnnotationId;
            return { oldHostId, reason: "public-pen" };
          }
          pen.hostAnnotationId = resolvedTarget.id;
          // Item 10: align pen's effective layer with host's effective layer in host's notebook without altering already-aligned fields.
          const hostLayer = effectiveInkLayer(hostNb, resolvedTarget.inkLayerId);
          const penLayer = effectiveInkLayer(hostNb, pen.inkLayerId);
          if (penLayer !== hostLayer) pen.inkLayerId = hostLayer;
          return null;
        };

        const makeUnbindDedupeKey = (pen: Annotation, issue: { oldHostId: string; reason: string }) => {
          const bindingId = pen.hostBindingId ?? "initial";
          return `${path}\u0000${pen.id}\u0000${bindingId}\u0000${issue.oldHostId}\u0000${issue.reason}`;
        };

        const queueUnbind = (finalPen: Annotation, issue: { oldHostId: string; reason: string }) => {
          const dedupeKey = makeUnbindDedupeKey(finalPen, issue);
          if (existingUnbindKeys.has(dedupeKey) || pendingUnbinds.some(u => u.dedupeKey === dedupeKey)) return;
          pendingUnbinds.push({
            dedupeKey,
            penId: finalPen.id,
            oldHostId: issue.oldHostId,
            reason: issue.reason,
            detail: `合并批注冲突时已解绑无效 hostAnnotationId：${finalPen.id}(${issue.oldHostId}，原因：${issue.reason})`,
          });
        };

        // Pass 2: normalize local pens in candidate and track their unbind facts.
        const localPenUnbinds = new Map<string, { oldHostId: string; reason: string }>();
        for (const localPen of candidate) {
          if (localPen.type !== "pen" || localPen.hostAnnotationId === undefined) continue;
          const issue = validatePenHost(localPen, false);
          if (issue) localPenUnbinds.set(localPen.id, issue);
        }

        // Pass 3: normalize remote pens and reconcile shared same-ID pens using persisted canonical raw-pen + resolved-host identity.
        for (const a of remotePens) {
          const mappedHostId = a.hostAnnotationId !== undefined ? (remoteIdMap.get(a.hostAnnotationId) ?? a.hostAnnotationId) : "";
          const rawPenKey = "pen-raw:" + a.id + ":" + mappedHostId + ":" + sha(this.canonicalJson(a));
          const prior = processedPens[rawPenKey];
          if (prior && (candidate.some(x => x.id === prior.finalPenId) || (prior.oldHostId !== undefined && prior.reason !== undefined && existingUnbindKeys.has(`${path}\u0000${prior.finalPenId}\u0000${prior.bindingId}\u0000${prior.oldHostId}\u0000${prior.reason}`)))) {
            // Exact same historical remote pen version for the same resolved host (key-order-independent) was already processed & committed:
            // reuse its committed outcome without recomputing reasons, duplicating pens, or overwriting newer rebinds.
            continue;
          }
          const normRemote = clone(a);
          const remoteIssue = validatePenHost(normRemote, true);
          const existingLocal = candidate.find(x => x.id === normRemote.id);
          if (!existingLocal) {
            candidate.push(normRemote);
            if (remoteIssue) queueUnbind(normRemote, remoteIssue);
            processedPens[rawPenKey] = { finalPenId: normRemote.id, bindingId: normRemote.hostBindingId ?? "initial", ...(remoteIssue ? { oldHostId: remoteIssue.oldHostId, reason: remoteIssue.reason } : {}) };
          } else {
            const localIssue = localPenUnbinds.get(existingLocal.id) ?? null;
            const alreadyCommittedSameUnbind =
              localIssue === null && remoteIssue !== null &&
              existingUnbindKeys.has(makeUnbindDedupeKey(existingLocal, remoteIssue));
            if (canonicalSame(existingLocal, normRemote) && (canonicalSame(localIssue, remoteIssue) || alreadyCommittedSameUnbind)) {
              // Identical normalized pen & unbind fact (or replay of already-committed unbind): retain one object and at most one event.
              processedPens[rawPenKey] = { finalPenId: existingLocal.id, bindingId: existingLocal.hostBindingId ?? "initial", ...(remoteIssue ? { oldHostId: remoteIssue.oldHostId, reason: remoteIssue.reason } : {}) };
              continue;
            }
            const knownId = conflictIdMap[rawPenKey];
            if (knownId && candidate.some(x => x.id === knownId)) {
              // Replay of an already-merged conflict pen: do not duplicate.
              processedPens[rawPenKey] = { finalPenId: knownId, bindingId: normRemote.hostBindingId ?? "initial", ...(remoteIssue ? { oldHostId: remoteIssue.oldHostId, reason: remoteIssue.reason } : {}) };
              continue;
            }
            const finalId = knownId ?? uid("ann-conflict");
            conflictIdMap[rawPenKey] = finalId;
            const forked: Annotation = { ...normRemote, id: finalId, cardId: undefined };
            candidate.push(forked);
            if (remoteIssue) queueUnbind(forked, remoteIssue);
            processedPens[rawPenKey] = { finalPenId: finalId, bindingId: forked.hostBindingId ?? "initial", ...(remoteIssue ? { oldHostId: remoteIssue.oldHostId, reason: remoteIssue.reason } : {}) };
          }
        }

        for (const [localId, issue] of localPenUnbinds) {
          const pen = candidate.find(x => x.id === localId);
          if (pen) queueUnbind(pen, issue);
        }
      }

      // Commit phase: serialize candidate independently, re-check live disk & cache, write tx journal, then write sidecar.
      const toWrite = JSON.parse(await serializeData(cloneSnapshot(candidate))) as Annotation[];
      validateAnnotationCollection(toWrite);
      const media = await externalizeMedia({ annotations: toWrite }, adapter);
      const content = await serializeData({ schemaVersion: SIDECAR_SCHEMA_VERSION, annotations: toWrite });
      const expectedSidecarHash = sha(content);
      const txPath = this.pendingMergeTxPath(path);

      await withSharedCommitLock(adapter, async () => {
        const liveDiskBeforeWrite = await adapter.exists(sidecar) ? await adapter.read(sidecar) : null;
        if (liveDiskBeforeWrite !== disk) throw new Error("磁盘批注在提交前发生变化；请重新处理冲突");
        if (version !== this.annDirty.get(path) || !same(localSnapshot, this.annCache.get(path) ?? [])) throw new Error("合并提交前本地批注发生变化；请重新处理冲突");

        if (strategy === "merge") {
          await this.ensureDir("_marginstudy-recovery");
          const txPayload = {
            txId: uid("merge-tx"),
            docPath: path,
            sidecarPath: sidecar,
            expectedSidecarHash,
            previousDiskRaw: disk,
            protectionPath: protection.path,
            localIds: localSnapshot.map(item => item.id),
            mergeConflictIdMap: conflictIdMap,
            mergeProcessedPens: processedPens,
            unbindEvents: pendingUnbinds,
          };
          await adapter.write(txPath, JSON.stringify({ ...txPayload, contentDigest: this.pendingTxDigest(txPayload) }));
        }

        // Tightened boundary check (Item 02): re-verify disk & local cache IMMEDIATELY after tx journal write
        // so any external write or local edit landing between last check and journal write aborts cleanly.
        const diskRightBeforeCommit = await adapter.exists(sidecar) ? await adapter.read(sidecar) : null;
        if (diskRightBeforeCommit !== disk) {
          if (strategy === "merge") await this.deleteRecoveryIfProved("merge-tx", txPath);
          this.annBlocked.add(path);
          throw new LibrarySaveConflict("磁盘批注在写入事务日志后发生变化；已中止合并以保留最新磁盘版本");
        }
        if (version !== this.annDirty.get(path) || !same(localSnapshot, this.annCache.get(path) ?? [])) {
          if (strategy === "merge") await this.deleteRecoveryIfProved("merge-tx", txPath);
          throw new Error("合并提交前本地批注发生变化；请重新处理冲突");
        }

        try {
          await adapter.write(sidecar, content);
        } catch (writeError) {
          // Roll back only partial/corrupted disk writes; NEVER overwrite a valid third-party sidecar update.
          let diskClean = true;
          const afterFailDisk = await adapter.exists(sidecar) ? await adapter.read(sidecar).catch(() => null) : null;
          if (afterFailDisk !== disk) {
            let afterFailValid = false;
            if (afterFailDisk !== null) {
              try {
                const parsed = JSON.parse(afterFailDisk);
                validateAnnotationCollection(parsed?.annotations);
                afterFailValid = true;
              } catch { afterFailValid = false; }
            }
            if (afterFailValid && afterFailDisk !== null && sha(afterFailDisk) === expectedSidecarHash) {
              diskClean = false;
            } else if (afterFailValid) {
              this.annBlocked.add(path);
              diskClean = true;
            } else {
              diskClean = false;
              try {
                if (disk !== null) await adapter.write(sidecar, disk);
                else await adapter.remove?.(sidecar);
                diskClean = true;
              } catch {}
            }
          }
          if (strategy === "merge" && diskClean) await this.deleteRecoveryIfProved("merge-tx-rolled-back", txPath);
          throw writeError;
        }
      });

      // Sidecar is durably on disk! Publish candidate; if a concurrent local edit arrived during sidecar write,
      // preserve BOTH the newer local edits AND merge mutations/additions so the next flush() cannot drop or revert them.
      const concurrentLocalEdit = version !== this.annDirty.get(path) || !same(localSnapshot, this.annCache.get(path) ?? []);
      if (!concurrentLocalEdit) {
        const published = clone(toWrite);
        if (media.replacements.size) applyMediaReplacements({ annotations: published }, media.replacements);
        const cached = this.annCache.get(path);
        if (cached) cached.splice(0, cached.length, ...published); else this.annCache.set(path, published);
        this.bumpAnnotationsRevision(path);
        this.annDirty.delete(path);
      } else {
        const liveCache = this.annCache.get(path);
        if (liveCache) {
          const published = clone(toWrite);
          if (media.replacements.size) applyMediaReplacements({ annotations: published }, media.replacements);
          const snapshotById = new Map(localSnapshot.map(item => [item.id, item]));
          const liveById = new Map(liveCache.map((item, index) => [item.id, index]));
          let changed = false;
          for (const mergedItem of published) {
            const snapItem = snapshotById.get(mergedItem.id);
            const liveIndex = liveById.get(mergedItem.id);
            if (snapItem === undefined) {
              if (liveIndex === undefined) {
                liveCache.push(mergedItem);
                liveById.set(mergedItem.id, liveCache.length - 1);
                changed = true;
              }
            } else if (liveIndex !== undefined && !same(mergedItem, snapItem)) {
              const liveItem = liveCache[liveIndex];
              if (same(liveItem, snapItem)) {
                liveCache[liveIndex] = mergedItem;
                changed = true;
              } else {
                // Concurrent edit touched the same annotation while merge committed binding/layer normalization:
                // keep the concurrent content edit, and publish committed binding/layer updates that were not
                // explicitly changed by the concurrent edit so a later flush cannot restore an invalid host.
                const nextLive: Annotation = { ...liveItem };
                let itemChanged = false;
                if (snapItem.hostAnnotationId !== mergedItem.hostAnnotationId && liveItem.hostAnnotationId === snapItem.hostAnnotationId) {
                  if (mergedItem.hostAnnotationId === undefined) delete nextLive.hostAnnotationId;
                  else nextLive.hostAnnotationId = mergedItem.hostAnnotationId;
                  itemChanged = true;
                }
                if (snapItem.bindToInkLayer !== mergedItem.bindToInkLayer && liveItem.bindToInkLayer === snapItem.bindToInkLayer) {
                  if (mergedItem.bindToInkLayer === undefined) delete nextLive.bindToInkLayer;
                  else nextLive.bindToInkLayer = mergedItem.bindToInkLayer;
                  itemChanged = true;
                }
                if (snapItem.inkLayerId !== mergedItem.inkLayerId && liveItem.inkLayerId === snapItem.inkLayerId) {
                  if (mergedItem.inkLayerId === undefined) delete nextLive.inkLayerId;
                  else nextLive.inkLayerId = mergedItem.inkLayerId;
                  itemChanged = true;
                }
                if (itemChanged) {
                  liveCache[liveIndex] = nextLive;
                  changed = true;
                }
              }
            }
          }
          if (changed) this.bumpAnnotationsRevision(path);
        }
      }
      this.annBase.set(path, content);
      this.annBlocked.delete(path);

      const hadDocMetaBefore = Object.prototype.hasOwnProperty.call(this.docMeta, path);
      const prevDocMeta = hadDocMetaBefore ? clone(this.docMeta[path]) : undefined;
      const prevLocalEvents = clone(this.localEvents);
      const prevMainDirty = this.mainDirty;
      const prevMainVersion = this.mainVersion;

      if (strategy === "merge") {
        const nextKeys = new Set<string>(existingUnbindKeys);
        this.recordLocalEvent("conflict-merged", localSnapshot.map(item => item.id), "已合并批注冲突；保护快照：" + protection.path);
        for (const item of pendingUnbinds) {
          if (nextKeys.has(item.dedupeKey)) continue;
          nextKeys.add(item.dedupeKey);
          this.recordLocalEvent("conflict-merged", [item.penId], item.detail);
        }
        this.docMeta[path] = { ...metaBefore, mergeConflictIdMap: conflictIdMap, mergeProcessedPens: processedPens, unbindEventKeys: [...nextKeys] };
      }
      this.recordLocalEvent("saved", toWrite.map(annotation => annotation.id), "文档批注已落盘：" + path);
      this.recordLocalEvent("external-applied", localSnapshot.map(item => item.id), "已处理批注外部修改；保护快照：" + protection.path);
      this.mainDirty = true; this.mainVersion++;
      if (!this.settings.diagnosticNoPersist) {
        try {
          await this.persistMain(false);
        } catch (mainError) {
          if (hadDocMetaBefore) this.docMeta[path] = prevDocMeta!;
          else delete this.docMeta[path];
          this.localEvents = prevLocalEvents;
          this.mainDirty = prevMainDirty;
          this.mainVersion = prevMainVersion;
          throw mainError;
        }
      }
      if (strategy === "merge") await this.deleteRecoveryIfProved("merge-tx", txPath);
      this.annotationsChanged(path); this.changed();
    });
  }

  removeAnnotationLinks(docPath: string, annId: string): void {
    this.mutate("删除标注关联", () => {
      for (const c of this.cards) {
        if (c.docPath === docPath && c.anchorAnnId === annId) c.anchorAnnId = undefined;
        for (const s of c.sources ?? []) if (s.docPath === docPath && s.anchorAnnId === annId) s.anchorAnnId = undefined;
      }
    });
  }

  private snapshot(): LibrarySnapshot { return measurePenCommit("snapshotMs", () => ({ data: this.data(), annotations: [...this.annCache].map(([p, a]) => [p, clone(a)]) })); }
  private restoreSnapshot(snapshot: LibrarySnapshot, previous?: LibrarySnapshot): void {
    const current = this.data();
    this.applyData(clone(snapshot.data));
    this.localEvents = current.localEvents ?? [];
    // Reading tabs and positions are not library edits and must survive its undo.
    this.workspaceState = current.workspaceState;
    if (previous) {
      // Library undo cannot rewind reviews or settings made since that edit.
      this.settings = current.settings;
      this.reviewLogs = current.reviewLogs ?? [];
      this.practiceAttempts = current.practiceAttempts ?? [];
      this.reviewPending = clone(current.reviewPending ?? []);
      const currentPending = new Map(this.reviewPending.map(p => [p.questionId,p]));
      const targetPending = new Map((snapshot.data.reviewPending ?? []).map(p => [p.questionId,p]));
      const previousPending = new Map((previous.data.reviewPending ?? []).map(p => [p.questionId,p]));
      for (const key of new Set([...targetPending.keys(), ...previousPending.keys()])) {
        if (!same(targetPending.get(key), previousPending.get(key)) && same(currentPending.get(key), previousPending.get(key))) {
          this.reviewPending = this.reviewPending.filter(p => p.questionId !== key);
          const target = targetPending.get(key); if (target) this.reviewPending.push(clone(target));
        }
      }
      this.reviewHistory = current.reviewHistory ?? {};
      // A library undo may restore its own deck edit, but cannot discard later
      // enrollment or a deck created since that edit.
      const priorDecks = new Map((previous.data.reviewDecks ?? []).map(deck => [deck.id, deck]));
      const targetDecks = new Map((snapshot.data.reviewDecks ?? []).map(deck => [deck.id, deck]));
      this.reviewDecks = clone(current.reviewDecks ?? []);
      for (const id of new Set([...priorDecks.keys(), ...targetDecks.keys()])) {
        const live = this.reviewDecks.find(deck => deck.id === id);
        if (!same(priorDecks.get(id), targetDecks.get(id)) && same(live, priorDecks.get(id))) {
          this.reviewDecks = this.reviewDecks.filter(deck => deck.id !== id);
          const target = targetDecks.get(id); if (target) this.reviewDecks.push(clone(target));
        } else if (live && priorDecks.has(id) && targetDecks.has(id)) {
          // Restore only membership changes owned by this edit, retaining later
          // additions to the same deck even when its updatedAt has changed.
          for (const key of ["cardIds", "studySetIds"] as const) {
            const prior = priorDecks.get(id)![key], target = targetDecks.get(id)![key];
            for (const member of new Set([...prior, ...target])) if (prior.includes(member) !== target.includes(member) && live[key].includes(member) === prior.includes(member)) {
              live[key] = live[key].filter(value => value !== member); if (target.includes(member)) live[key].push(member);
            }
          }
        }
      }
      this.activeReviewDeckId = this.reviewDecks.some(deck => deck.id === current.activeReviewDeckId) ? current.activeReviewDeckId : snapshot.data.activeReviewDeckId;
      for (const set of this.studySets) {
        const live = current.studySets?.find(item => item.id === set.id), prior = previous.data.studySets?.find(item => item.id === set.id);
        if (live && (set.reviewDeckId === prior?.reviewDeckId || live.reviewDeckId !== prior?.reviewDeckId)) set.reviewDeckId = live.reviewDeckId;
        if (live && (same(set.reviewSettings, prior?.reviewSettings) || !same(live.reviewSettings, prior?.reviewSettings))) {
          if (live.reviewSettings === undefined) delete set.reviewSettings; else set.reviewSettings = clone(live.reviewSettings);
        }
        if (live && (same(set.practiceSettings, prior?.practiceSettings) || !same(live.practiceSettings, prior?.practiceSettings))) {
          if (live.practiceSettings === undefined) delete set.practiceSettings; else set.practiceSettings = clone(live.practiceSettings);
        }
        if (set.reviewDeckId && !this.getReviewDeck(set.reviewDeckId)) delete set.reviewDeckId;
      }
      // Restore only template changes owned by this history entry. Unrelated
      // library undo must not rewind a template saved after that entry.
      this.cardTemplates = clone(current.cardTemplates ?? []);
      const priorTemplates = new Map((previous.data.cardTemplates ?? []).map(t => [t.id,t]));
      const targetTemplates = new Map((snapshot.data.cardTemplates ?? []).map(t => [t.id,t]));
      for (const id of new Set([...priorTemplates.keys(), ...targetTemplates.keys()])) {
        const live = this.cardTemplates.find(t => t.id === id);
        if (!same(priorTemplates.get(id),targetTemplates.get(id)) && same(live,priorTemplates.get(id))) {
          this.cardTemplates = this.cardTemplates.filter(t => t.id !== id);
          const target = targetTemplates.get(id); if (target) this.cardTemplates.push(clone(target));
        }
      }
      this.docMeta = current.docMeta ?? {};
      this.srs = current.srs;
      const targetStates = snapshot.data.srs, priorStates = previous.data.srs;
      for (const key of new Set([...Object.keys(targetStates), ...Object.keys(priorStates)])) {
        if (!same(targetStates[key], priorStates[key]) && same(current.srs[key], priorStates[key])) {
          if (targetStates[key]) this.srs[key] = clone(targetStates[key]); else delete this.srs[key];
        }
      }
      for (const card of this.cards) if (this.reviewLogs.some(l => l.cardId === card.id && !l.undoneAt)) card.wrong = this.cardHasWrongQuestion(card);
    }
    for (const [path, annotations] of snapshot.annotations) {
      if (previous && same(annotations, previous.annotations.find(([p]) => p === path)?.[1])) continue;
      const cached = this.annCache.get(path);
      if (cached) cached.splice(0, cached.length, ...clone(annotations));
      else this.annCache.set(path, clone(annotations));
      this.bumpAnnotationsRevision(path);
      this.annDirty.set(path, (this.annDirty.get(path) ?? 0) + 1);
      this.annotationsChanged(path);
    }
    this.save();
  }
  private mutate<T>(label: string, action: () => T, revertOnError = true): T {
    if (this.documentCommitPending && !this.documentCommitOwner && !this.transactionDepth) throw new Error("文档操作正在保存，请稍后重试。");
    if (this.transactionDepth) return action();
    const before = this.snapshot();
    this.transactionDepth++;
    try {
      const result = action(); this.repairGraph();
      const after = this.snapshot();
      if (!same(before, after)) {
        this.pushHistory({ label, before, after }); this.libraryHistoryRevision++;
        if (/^(删除|移除|清空)/.test(label)) {
          const remaining = new Set(protectedObjects(after.data).map(item => item.collection + ":" + item.id));
          const removed = protectedObjects(before.data).filter(item => !remaining.has(item.collection + ":" + item.id));
          if (removed.length) this.recordLocalEvent("object-deleted", removed.map(item => item.id), `${label}（${removed.length} 个对象）；可查看恢复记录。`);
        }
        this.save();
      }
      return result;
    } catch (e) { if (revertOnError) this.restoreSnapshot(before); throw e; }
    finally { this.transactionDepth--; }
  }
  private pushHistory(entry: HistoryEntry): void {
    this.future = [];
    this.history.push(entry);
    this.historySizes.set(entry, new TextEncoder().encode(JSON.stringify(entry)).byteLength);
    if (this.history.length > 20) this.history.shift();
    let bytes = this.history.reduce((total, item) => total + (this.historySizes.get(item) ?? 0), 0), discarded = 0;
    while (bytes > HISTORY_LIMIT_BYTES && this.history.length) {
      const oldest = this.history.shift()!;
      bytes -= this.historySizes.get(oldest) ?? 0;
      discarded++;
    }
    if (discarded) console.info("MarginStudy: history-byte-limit", { discarded, bytes, limit: HISTORY_LIMIT_BYTES });
  }
  getLibraryHistoryState(): {canUndo:boolean;canRedo:boolean;undoLabel?:string;redoLabel?:string;revision:number} {
    return {canUndo:this.history.length>0,canRedo:this.future.length>0,undoLabel:this.history[this.history.length-1]?.label,redoLabel:this.future[this.future.length-1]?.label,revision:this.libraryHistoryRevision};
  }
  getStudySetHistory(studySetId: string): { label: string; data: LibrarySnapshot["data"]; annotations: LibrarySnapshot["annotations"] }[] {
    return this.history.flatMap(entry => {
      if (!("before" in entry) || !entry.before.data.studySets?.some(set => set.id === studySetId)) return [];
      return [{ label: entry.label, data: clone(entry.before.data), annotations: clone(entry.before.annotations) }];
    });
  }
  recordReadOnlyLibraryAction(label: string): void {
    this.pushHistory({ label, readOnly: true }); this.libraryHistoryRevision++; this.changed();
  }
  getRevision(): number { return this.revision; }
  undoLibraryChange(): boolean { if (this.documentCommitPending) throw new Error("文档操作正在保存，请稍后重试。"); const item = this.history.pop(); if (!item) return false; this.future.push(item); this.libraryHistoryRevision++; if ('readOnly' in item) this.changed(); else if ('nodeMove' in item) { const node=this.getNode(item.nodeMove.id); if(node) Object.assign(node,item.nodeMove.before); this.save(); } else { this.restoreSnapshot(item.before, item.after); this.restoreCardAnchors(); } return true; }
  libraryTransaction<T>(label: string, action: () => T): T { return this.mutate(label, action); }
  async commitStudySetImport<T>(canvasId: string, action: () => T): Promise<T> {
    this.assertNoDesktopMainConflict();
    if (this.documentCommitPending || this.settings.diagnosticNoPersist) throw new Error("当前无法保存学习集导入。");
    this.documentCommitPending = true;
    try {
      if (this.mainDirty || this.annDirty.size || this.jobs.size || this.loadBlocked) await this.flush();
      const before = this.data(), oldHistory = [...this.history], oldFuture = [...this.future];
      const historyRevision = this.libraryHistoryRevision;
      let result: T | undefined, applied = false;
      this.studySetImportCanvasId = canvasId;
      try {
        this.documentCommitOwner = true;
        try {
          result = this.mutate("导入学习集", () => {
            const imported = action();
            this.validateData(this.data(false));
            return imported;
          }, false);
          applied = true;
        }
        finally { this.documentCommitOwner = false; }
        await this.flush();
        return result!;
      } catch (error) {
        const disk: PluginData | null = applied ? await this.host.loadData().catch(() => null) : null;
        if (disk?.canvases?.some(canvas => canvas.id === canvasId)) {
          this.baseline = cloneSnapshot(disk);
          this.applyData(disk);
          this.mainDirty = false;
          if (error instanceof DesktopMainConflict) {
            this.markDesktopConflict(error, false);
            throw error;
          }
          this.lastSaveError = null;
          return result!;
        }
        const workspaceState = this.workspaceState, settings = this.settings, events = this.localEvents;
        this.applyData(before);
        this.workspaceState = workspaceState;
        this.settings = settings;
        this.localEvents = this.pendingConflict ? events : before.localEvents ?? [];
        this.history = oldHistory;
        this.future = oldFuture;
        this.libraryHistoryRevision = historyRevision;
        this.mainDirty = !same(workspaceState, before.workspaceState) || !same(settings, before.settings);
        throw error;
      } finally {
        this.studySetImportCanvasId = undefined;
        this.changed();
        if (this.mainDirty || this.annDirty.size) this.scheduleFlush();
      }
    } finally { this.documentCommitPending = false; }
  }
  redoLibraryChange(): boolean { if (this.documentCommitPending) throw new Error("文档操作正在保存，请稍后重试。"); const item = this.future.pop(); if (!item) return false; this.history.push(item); this.libraryHistoryRevision++; if ('readOnly' in item) this.changed(); else if ('nodeMove' in item) { const node=this.getNode(item.nodeMove.id); if(node) Object.assign(node,item.nodeMove.after); this.save(); } else { this.restoreSnapshot(item.after, item.before); this.restoreCardAnchors(); } return true; }
  private restoreCardAnchors(): void {
    for (const c of this.cards.filter(c => !c.groupId)) for (const source of this.sources(c)) {
      if (!source.anchorAnnId) continue;
      this.track(this.loadAnnotations(source.docPath).then(anns => {
        if (!this.getCard(c.id)) return;
        const ann = anns.find(a => a.id === source.anchorAnnId);
        if (ann && ann.cardId !== c.id) { ann.cardId = c.id; this.saveAnnotationsDebounced(source.docPath, anns); }
      }));
    }
  }

  getCard(id: string): Card | undefined { return this.cards.find(c => c.id === id); }
  addCard(c: Card): void {
    if (c.colorIndex !== undefined && (!Number.isInteger(c.colorIndex) || c.colorIndex < 0 || c.colorIndex > 15)) throw new Error("卡片颜色序号无效");
    Object.assign(c, syncCardColor(c.color !== undefined ? { color: c.color } : { colorIndex: c.colorIndex }));
    this.mutate("添加卡片", () => { if (this.getCard(c.id)) throw new Error("卡片 id 已存在"); this.cards.push(c); this.registerDocument(c.docPath); const set = this.studySets.find(s => s.id === this.activeStudySetId); if (set) set.cardIds = [...new Set([...(set.cardIds ?? []), c.id])]; });
  }
  updateCard(id: string, patch: Partial<Card>): void {
    if (patch.colorIndex !== undefined && (!Number.isInteger(patch.colorIndex) || patch.colorIndex < 0 || patch.colorIndex > 15)) throw new Error("卡片颜色序号无效");
    patch = syncCardColor(patch);
    const card = this.getCard(id);
    if (card && patch.front !== undefined && !("excerptBlocks" in patch) && card.excerptBlocks?.length) {
      patch = { ...patch, excerptBlocks: editedExcerptBlocks(card, patch.front) };
    }
    if (!card || Object.entries({ ...patch, id }).every(([key, value]) => same(card[key as keyof Card], value))) return;
    this.mutate("编辑卡片", () => { const c = this.getCard(id); if (c) { const before = clone(c); Object.assign(c, patch, { id, updatedAt: new Date().toISOString() }); this.reconcileReviewQuestions(before,c); } });
  }
  setReviewQuestion(id: string, question: Card["reviewQuestion"]): void { this.updateReviewQuestions([id], question, false); }
  updateReviewQuestions(ids: string[], question: Card["reviewQuestion"], preserveCustom = true): number {
    if (question && (!["title", "emphasis", "whole", "custom"].includes(question.mode) || question.mode === "custom" && !question.text?.trim())) throw new Error("请填写有效的复习问题");
    return this.mutate("设置复习问题", () => {
      let changed = 0;
      for (const id of new Set(ids)) {
        const card = this.getCard(id); if (!card || preserveCustom && card.reviewQuestion?.mode === "custom") continue;
        if (same(card.reviewQuestion, question)) continue;
        this.updateCard(id, { reviewQuestion: clone(question) }); changed++;
      }
      return changed;
    });
  }
  private reconcileReviewQuestions(before: Card, after: Card): void {
    const rows = this.reviewPending.filter(p => p.cardId === before.id && p.visited !== true);
    const groups = new Map<string, ReviewPending[]>();
    for (const row of rows) { const key = JSON.stringify([row.deckId, row.scopeId]); const group = groups.get(key) ?? []; group.push(row); groups.set(key, group); }
    for (const group of groups.values()) {
      const { scopeId: scope, deckId } = group[0];
      const deck = deckId ? this.getReviewDeck(deckId) : undefined;
      const forCard = (card: Card) => deck ? this.questionsInDeck(card, deck, scope) : questionsForCard(card, scope);
      const oldIds = new Set(forCard(before).map(q => q.id));
      const enrolled = group.filter(p => oldIds.has(p.questionId)); if (!enrolled.length) continue;
      const questions = forCard(after), ids = new Set(questions.map(q => q.id));
      const removed = enrolled.filter(p => !ids.has(p.questionId));
      this.reviewPending = this.reviewPending.filter(p => !removed.some(row => row.id === p.id));
      for (const question of questions) if (!this.reviewPending.some(p => p.questionId === question.id)) {
        const donor = removed.shift() ?? enrolled[0];
        const state = clone(this.srs[donor.questionId] ?? (!scope && !deckId ? this.srs[before.id] : undefined) ?? freshState(this.settings.defaultEase));
        state.due = donor.due; this.srs[question.id] = state;
        this.reviewPending.push({...clone(donor),id:uid("pending-edit"),questionId:question.id,queuedAt:new Date().toISOString()});
      }
    }
  }
  removeCard(id: string): void {
    const card = this.getCard(id); if (!card) return;
    this.mutate("删除卡片", () => {
      if (card.groupId) throw new Error("请先解除合并，再删除组员");
      if (card.mergedCards?.length) this.unmergeCard(id);
      for (const node of this.nodes) if (node.cardId === id) { node.title = card.front; node.image = card.image; node.cardId = undefined; node.reference = false; }
      this.cards = this.cards.filter(c => c.id !== id);
      for (const c of this.cards) c.links = c.links.filter(link => link !== id);
      for (const key of Object.keys(this.srs)) if (key === id || key.startsWith(id + "::")) delete this.srs[key];
      this.reviewPending = this.reviewPending.filter(entry => entry.cardId !== id);
      for (const set of this.studySets) set.cardIds = set.cardIds?.filter(x => x !== id);
      for (const deck of this.reviewDecks) deck.cardIds = deck.cardIds.filter(x => x !== id);
      for (const [path, anns] of this.annCache) if (anns.some(a => a.cardId === id)) { for (const a of anns) if (a.cardId === id) a.cardId = undefined; this.saveAnnotationsDebounced(path, anns); }
    });
    for (const path of new Set(this.sources(card).map(s => s.docPath))) this.track(this.loadAnnotations(path).then(anns => {
      if (this.getCard(id)) return;
      if (anns.some(a => a.cardId === id)) { for (const a of anns) if (a.cardId === id) a.cardId = undefined; this.saveAnnotationsDebounced(path, anns); }
    }));
  }
  cardsOfDoc(path: string): Card[] { return this.cards.filter(c => c.docPath === path || c.sources?.some(s => s.docPath === path)); }
  cloneCard(id: string): Card | undefined { const c = this.getCard(id); if (!c) return undefined; const copy = this.independentCard(c); this.addCard(copy); return copy; }
  private sources(c: Card): CardSource[] { return uniqueSources([{ docPath: c.docPath, anchorAnnId: c.anchorAnnId, page: c.page, text: c.front, image: c.image }, ...(c.sources ?? [])].filter(s => !!s.docPath)); }
  private hasCardAnchor(card: Card): boolean { return this.sources(card).some(source => !!source.anchorAnnId || (source.page ?? 0) > 0); }
  private clearCardPositions(card: Card): void {
    delete card.page; delete card.anchorAnnId;
    if (card.sources) card.sources = card.sources.map(source => { const copy = { ...source }; delete copy.page; delete copy.anchorAnnId; return copy; });
  }
  private independentCard(source: Card): Card {
    const copy = clone(source); copy.id = uid("card"); copy.createdAt = copy.updatedAt = new Date().toISOString(); copy.wrong = false;
    delete copy.groupId; delete copy.mergedCards; delete copy.mergedReviewStates; delete copy.mergeArchive;
    return copy;
  }
  detachNodeReference(id: string, formal = true): Card | undefined {
    return this.mutate("断开卡片引用", () => {
      const node = this.getNode(id); if (!node) return undefined;
      const source = node.cardId ? this.getCard(node.cardId) : undefined;
      const origin = node.sourceNodeId ? this.getNode(node.sourceNodeId) : this.nodes.find(n => n.id !== id && n.cardId === node.cardId && !n.sourceNodeId);
      const copy = source ? this.independentCard(source) : { id: uid("card"), docPath: node.docPath ?? "", type: "comment" as const, title: node.title, front: node.title, color: node.color, image: node.image, tags: clone(node.tags ?? []), links: [], createdAt: new Date().toISOString() };
      copy.hidden = node.hidden ?? false; copy.occluded = node.occluded ?? source?.occluded;
      if (formal && origin && origin.canvasId !== node.canvasId && (origin.hidden || source?.hidden)) this.clearCardPositions(copy);
      this.cards.push(copy); node.cardId = copy.id; node.reference = false; delete node.sourceNodeId; node.updatedAt = new Date().toISOString();
      const canvas = this.canvases.find(c => c.id === node.canvasId), set = this.studySets.find(s => s.id === canvas?.studySetId);
      if (set) set.cardIds = [...new Set([...(set.cardIds ?? []),copy.id])];
      return copy;
    });
  }
  splitNodeContent(id: string, part: "title" | "excerpt" | "note", at: number, separatorLength = 0): string | undefined {
    return this.mutate("分割卡片内容", () => {
      const node = this.getNode(id); if (!node) return undefined;
      let source = node.cardId ? this.getCard(node.cardId) : undefined;
      if (!source) { source = { id: uid("card"), docPath: node.docPath ?? "", type: "comment", title: node.title, front: node.title, color: node.color, image: node.image, tags: clone(node.tags ?? []), links: [], createdAt: new Date().toISOString() }; this.cards.push(source); node.cardId = source.id; }
      if (source.groupId) throw new Error("请先解除合并，再分割组员内容");
      const field = part === "title" ? "title" : part === "note" ? "back" : "front", text = source[field] ?? "";
      if (!Number.isInteger(at) || !Number.isInteger(separatorLength) || at < 0 || at >= text.length || separatorLength < 0 || at + separatorLength > text.length) throw new Error("分割位置超出所选内容");
      const head = text.slice(0,at), tail = text.slice(at + separatorLength), before = clone(source);
      const copy = this.independentCard(before), newNode = clone(node); newNode.id = uid("node"); newNode.comments = []; newNode.x += 40; newNode.y -= 40; newNode.updatedAt = new Date().toISOString();
      if (part === "title") {
        source.title = tail; copy.title = head; copy.front = ""; delete copy.back; delete copy.image; delete copy.images; this.clearCardPositions(copy);
        newNode.cardId = copy.id; newNode.reference = false; delete newNode.sourceNodeId;
      } else if (part === "excerpt" && !head) {
        source.front = tail; copy.front = ""; delete copy.back; this.clearCardPositions(copy);
        newNode.cardId = copy.id; newNode.reference = false; delete newNode.sourceNodeId;
      } else {
        // The anchored half retains the existing shared content identity. The
        // unanchored half is materialized locally and cannot keep syncing it.
        source[field] = head;
        copy[field] = tail; delete copy.title; this.clearCardPositions(copy);
        if (part === "excerpt") delete source.back;
        else { copy.front = ""; delete copy.image; delete copy.images; }
        newNode.cardId = source.id; newNode.reference = node.reference; newNode.sourceNodeId = node.sourceNodeId;
        node.cardId = copy.id; node.reference = false; delete node.sourceNodeId;
      }
      source.updatedAt = copy.updatedAt = node.updatedAt = new Date().toISOString();
      this.cards.push(copy); this.nodes.push(newNode);
      const siblings = this.nodes.filter(n => n.canvasId === node.canvasId && n.parentId === node.parentId && n.id !== newNode.id).sort((a,b) => (a.order ?? 0)-(b.order ?? 0));
      siblings.splice(Math.max(0,siblings.findIndex(n => n.id === node.id)),0,newNode); siblings.forEach((n,index) => n.order = index);
      const canvas = this.canvases.find(c => c.id === node.canvasId), set = this.studySets.find(s => s.id === canvas?.studySetId);
      if (set) set.cardIds = [...new Set([...(set.cardIds ?? []),copy.id])];
      return newNode.id;
    });
  }
  setNodeHidden(id: string, hidden: boolean): void { this.updateNode(id, { hidden, updatedAt: new Date().toISOString() }); }
  toggleTextCloze(id: string, part: "excerpt" | "note", start: number, end: number): void {
    this.mutate("增删文本挖空", () => {
      const card = this.getCard(id); if (!card || card.groupId) throw new Error("请先选择独立卡片或合并组头");
      const before = clone(card);
      const field = part === "note" ? "back" : "front";
      const text = togglePlainCloze(card[field] ?? "",start,end);
      if (field === "front" && card.excerptBlocks?.length) card.excerptBlocks = editedExcerptBlocks(card, text);
      card[field] = text; card.updatedAt = new Date().toISOString();
      this.reconcileReviewQuestions(before,card);
    });
  }
  toggleCardOcclusion(ids: string[]): void { this.mutate("切换整组遮挡", () => {
    const requested = [...new Set(ids)].map(id => this.getCard(id)).filter((c): c is Card => !!c);
    const selected = requested.length === 1 && requested[0].groupId ? [this.getCard(requested[0].groupId) ?? requested[0]] : requested;
    const next = !selected.some(c => c.occluded), now = new Date().toISOString();
    const apply = (card: Card) => { card.occluded = next; card.updatedAt = now; for (const member of card.mergedCards ?? []) if (member.id !== card.id) apply(member); };
    for (const card of selected) { apply(card); for (const member of this.cards.filter(c => c.groupId === card.id)) apply(member); }
  }); }
  toggleNodeOcclusion(ids: string[]): void { this.mutate("切换选中卡片遮挡", () => {
    const selected = [...new Set(ids)].map(id => this.getNode(id)).filter((n): n is MindNode => !!n), next = !selected.some(n => n.occluded ?? (n.cardId ? this.getCard(n.cardId)?.occluded : false)), now = new Date().toISOString();
    for (const node of selected) { node.occluded = next; node.updatedAt = now; const card = node.cardId ? this.getCard(node.cardId) : undefined; if (card?.mergedCards) for (const member of card.mergedCards) { member.occluded = next; member.updatedAt = now; const live = this.getCard(member.id); if (live && live.id !== card.id) { live.occluded = next; live.updatedAt = now; } } }
  }); }
  canAutoMerge(sourceId: string, targetId: string): boolean {
    const source = this.getCard(sourceId), target = this.getCard(targetId); if (!source || !target || sourceId === targetId) return false;
    const sourceNodes = new Set(this.nodes.filter(n => n.cardId === sourceId).map(n => n.id));
    const targetNodes = this.nodes.filter(n => n.cardId === targetId);
    return !this.hasCardAnchor(target) && !target.mergedCards?.some(c => this.hasCardAnchor(c)) && this.hasCardAnchor(source)
      && !source.links.length && !this.nodes.some(n => n.parentId && sourceNodes.has(n.parentId)) && !this.edges.some(e => sourceNodes.has(e.from))
      && !source.title && !source.back && !source.mergedCards?.length && !target.groupMode && !target.draft
      && !targetNodes.some(n => n.sourceNodeId) && !this.nodes.some(n => n.sourceNodeId && targetNodes.some(t => t.id === n.sourceNodeId))
      && !this.cards.some(c => c.sourceCardId === sourceId && c.type === "flashcard") && !source.groupId && !target.groupId;
  }

  private groupPresentation(cards: Card[]): Partial<Card> {
    const images = [...new Set(cards.flatMap(c => [c.image, ...(c.images ?? [])].filter((v): v is string => !!v)))];
    const ids = new Set(cards.map(c => c.id));
    const hasBlocks = cards.some(c => c.excerptBlocks?.length);
    const excerptBlocks = hasBlocks ? cards.flatMap((card, cardIndex) => {
      const source = { docPath: card.docPath, anchorAnnId: card.anchorAnnId, documentNotebookId: card.documentNotebookId, page: card.page };
      const blocks: import("../types").ExcerptBlock[] = card.excerptBlocks?.length ? card.excerptBlocks.map(block => ({ ...block, source: block.source ?? source })) :
        (card.front ? [{ id: `merged-${card.id}`, text: card.front, source }] : []);
      if (card.front && !blocks.some(block => block.text)) blocks.unshift({ id: `merged-${card.id}`, text: card.front, source });
      if (card.front && cards.slice(0, cardIndex).some(previous => previous.front)) blocks.unshift({ id: `separator-${card.id}`, text: "\n\n---\n\n", source });
      return blocks;
    }) : undefined;
    const blockImages = excerptBlocks?.flatMap(block => block.image ? [block.image] : []) ?? [];
    const orderedImages = [...blockImages, ...images.filter(image => !blockImages.includes(image))];
    return syncCardColor({
      front: cards.map(c => c.front).filter(Boolean).join("\n\n---\n\n"),
      back: [...new Set(cards.map(c => c.back ?? "").filter(Boolean))].join("\n\n---\n\n") || undefined,
      title: [...new Set(cards.map(c => c.title).filter(Boolean))].join("; ") || undefined,
      sources: uniqueSources(cards.flatMap(c => this.sources(c))), images: orderedImages.slice(1), image: orderedImages[0], excerptBlocks,
      tags: [...new Set(cards.flatMap(c => c.tags))], keywords: [...new Set(cards.flatMap(c => c.keywords ?? []))],
      links: [...new Set(cards.flatMap(c => c.links).filter(id => !ids.has(id)))],
      color: cards.find(c => c.color)?.color,
    });
  }
  private materializeGroupHead(card: Card): Card {
    const copy = clone(card), original = card.mergedCards?.find(c => c.id === card.id);
    if (original) {
      const presentation = card.mergeArchive?.presentation ?? this.groupPresentation(card.mergedCards!);
      for (const key of Object.keys(presentation) as (keyof Card)[]) {
        // Generated presentation is reversible; an edit to the head stays on the
        // head itself. Never manufacture an extra combined card on unmerge.
        if (same(copy[key], presentation[key])) (copy as any)[key] = clone(original[key]);
      }
    }
    Object.assign(copy, syncCardColor({ color: copy.color }));
    delete copy.groupId; delete copy.mergedCards; delete copy.mergedReviewStates; delete copy.mergeArchive;
    return copy;
  }
  mergeCards(keepId: string, otherIds: string[], nodeIds?: string[]): Card | undefined {
    return this.mutate("合并卡片", () => {
      const keep = this.getCard(keepId); if (!keep) return undefined;
      if (otherIds.includes(keepId)) throw new Error("不能将卡片与自身合并");
      if (keep.groupId) throw new Error("请先解除组员的合并关系");
      const candidates = [...new Set(otherIds)].map(id => this.getCard(id)).filter((c): c is Card => !!c);
      if (candidates.some(c => c.groupId)) throw new Error("已在合并组中的卡片不能再次并入");
      const others = candidates.filter(c => this.hasCardAnchor(c) || !!(c.front || c.back || c.title || c.image || c.images?.length || c.blank));
      if (!others.length) return keep;
      const allIds = new Set([keepId,...others.map(c => c.id)]);
      const chosen = new Set(nodeIds ?? [...allIds].flatMap(id => {
        const nodes = this.nodes.filter(n => n.cardId === id);
        const node = nodes.find(n => n.canvasId === this.activeCanvasId) ?? nodes[0];
        return node ? [node.id] : [];
      }));
      // A shared display outside this operation first receives its own latest
      // content. Merging here cannot silently edit another canvas's instance.
      for (const node of [...this.nodes]) if (node.cardId && allIds.has(node.cardId) && !chosen.has(node.id)) this.detachNodeReference(node.id,false);
      const prior = clone(keep.mergeArchive);
      const members = (card: Card): Card[] => card.mergedCards?.length
        ? [this.materializeGroupHead(card), ...card.mergedCards.filter(c => c.id !== card.id).map(c => clone(this.getCard(c.id)?.groupId === card.id ? this.getCard(c.id)! : c))]
        : [clone(card)];
      const originals = [...new Map([keep,...others].flatMap(members).map(c => [c.id,c])).values()];
      for (const member of originals) { delete member.groupId; member.hidden = keep.hidden ?? false; member.occluded = keep.occluded ?? false; }
      const mergedIds = new Set(originals.filter(c => c.id !== keepId).map(c => c.id));
      const affected = this.descendants(this.nodes.filter(n => chosen.has(n.id)).map(n => n.id));
      const archivedNodes = new Map((prior?.nodes ?? []).map(n => [n.id,n]));
      for (const node of this.nodes) if (affected.has(node.id) && !archivedNodes.has(node.id)) archivedNodes.set(node.id,clone(node));
      const archivedEdges = [...(prior?.edges ?? []),...clone(this.edges.filter(e => affected.has(e.from) || affected.has(e.to)))];
      const archive: NonNullable<Card["mergeArchive"]> = {
        nodes: [...archivedNodes.values()], edges: archivedEdges,
        memberships: prior?.memberships ?? clone(this.studySets.map(s => ({ studySetId:s.id,cardIds:s.cardIds }))),
        collapsedNodeIds: [...(prior?.collapsedNodeIds ?? [])], movedParents: [...(prior?.movedParents ?? [])],
        mappedEdges: [...(prior?.mappedEdges ?? [])], cardLinks: [...(prior?.cardLinks ?? [])],
      };
      const now = new Date().toISOString();
      for (const member of originals) if (member.id !== keepId) {
        const live = this.getCard(member.id);
        // Gate B was replayed from the supplied disassembly: anchor OR draft
        // retains the entity. Unanchored non-draft keeps only its member record.
        if (this.hasCardAnchor(member) || member.draft) {
          const retained = live ?? clone(member); if (!live) this.cards.push(retained);
          retained.groupId = keepId; retained.hidden = keep.hidden ?? false; retained.occluded = keep.occluded ?? false; retained.updatedAt = now;
          delete retained.mergedCards; delete retained.mergedReviewStates; delete retained.mergeArchive;
        } else this.cards = this.cards.filter(c => c.id !== member.id);
      }
      const beforeHead = clone(keep), presentation = this.groupPresentation(originals);
      Object.assign(keep,presentation); keep.mergedCards = originals; keep.updatedAt = now;
      this.reconcileReviewQuestions(beforeHead,keep);
      keep.mergedReviewStates = clone(Object.fromEntries(Object.entries(this.srs).filter(([key]) => originals.some(c => key === c.id || key.startsWith(c.id+"::")))));
      archive.presentation = clone(presentation); keep.mergeArchive = archive;
      for (const card of this.cards) if (!mergedIds.has(card.id)) {
        const links = [...new Set(card.links.map(id => mergedIds.has(id) ? keepId : id))].filter(id => id !== card.id);
        if (!same(links,card.links)) { archive.cardLinks!.push({cardId:card.id,links:clone(card.links),mergedLinks:clone(links)}); card.links = links; }
      }
      const collapse = new Set(this.nodes.filter(n => chosen.has(n.id) && n.cardId && mergedIds.has(n.cardId)).map(n => n.id));
      const headNode = this.nodes.find(n => chosen.has(n.id) && n.cardId === keepId);
      // If the head is below a selected ancestor, move it above that branch
      // before moving the ancestor's remaining children beneath it. Otherwise
      // an intermediate parent becomes its own descendant and graph repair
      // would discard a parent link that unmerge needs to recover.
      if (headNode) {
        let parent = headNode.parentId, nextParent = parent;
        const visited = new Set<string>();
        while (parent && !visited.has(parent)) {
          visited.add(parent); const ancestor = this.getNode(parent);
          if (!ancestor) break;
          if (collapse.has(parent)) nextParent = ancestor.parentId;
          parent = ancestor.parentId;
        }
        if (nextParent !== headNode.parentId) {
          archive.movedParents!.push({id:headNode.id,before:headNode.parentId,after:nextParent});
          headNode.parentId = nextParent;
        }
      }
      for (const node of this.nodes) if (!collapse.has(node.id) && node.parentId && collapse.has(node.parentId)) {
        let parent: string | null = headNode && headNode.canvasId === node.canvasId && headNode.id !== node.id ? headNode.id : null;
        if (node.id === headNode?.id) { parent = this.getNode(node.parentId)?.parentId ?? null; while (parent && collapse.has(parent)) parent = this.getNode(parent)?.parentId ?? null; }
        archive.movedParents!.push({id:node.id,before:node.parentId,after:parent}); node.parentId = parent;
      }
      archive.collapsedNodeIds!.push(...collapse);
      const mapped = this.edges.filter(e => collapse.has(e.from) || collapse.has(e.to)).flatMap(e => {
        if (!headNode) return [];
        return [{...e,from:collapse.has(e.from)?headNode.id:e.from,to:collapse.has(e.to)?headNode.id:e.to}].filter(x => x.from !== x.to);
      });
      archive.mappedEdges!.push(...clone(mapped));
      this.edges = [...this.edges.filter(e => !collapse.has(e.from) && !collapse.has(e.to)),...mapped];
      this.nodes = this.nodes.filter(n => !collapse.has(n.id));
      for (const set of this.studySets) if (set.cardIds?.some(id => mergedIds.has(id))) set.cardIds = [...new Set([...set.cardIds,keepId])];
      for (const source of keep.sources ?? []) if (source.anchorAnnId) this.track(this.loadAnnotations(source.docPath).then(anns => {
        if (!this.getCard(keepId)?.mergedCards) return;
        const ann = anns.find(a => a.id === source.anchorAnnId); if (ann) { ann.cardId = keepId; this.saveAnnotationsDebounced(source.docPath,anns); }
      }));
      return keep;
    });
  }

  unmergeCard(id: string): Card[] {
    return this.mutate("解除合并", () => {
      const current = this.getCard(id); if (!current?.mergedCards?.length) return [];
      const records = clone(current.mergedCards), states = clone(current.mergedReviewStates ?? {});
      const archive = clone(current.mergeArchive ?? {nodes:[],edges:[],memberships:[]});
      const beforeHead = clone(current), head = this.materializeGroupHead(current), now = new Date().toISOString();
      Object.keys(current).forEach(key => delete (current as any)[key]); Object.assign(current,head,{hidden:false,updatedAt:now});
      this.reconcileReviewQuestions(beforeHead,current);
      const restored = [current];
      for (const record of records) if (record.id !== id) {
        const live = this.getCard(record.id);
        const member = live?.groupId === id ? live : clone(record);
        if (live && live.groupId !== id) throw new Error("组员标识已被其它卡片占用，未解除合并");
        delete member.groupId; member.hidden = false; member.updatedAt = now;
        if (!live) this.cards.push(member); restored.push(member);
      }
      // State is not an undo snapshot: reviews completed while merged stay
      // authoritative. Old checkpoints only provide a missing-state fallback.
      for (const [key,state] of Object.entries(states)) if (!this.srs[key]) this.srs[key] = state;
      for (const key of Object.keys(this.srs)) if (key.startsWith(id+"::merged:")) {
        const originalKey = key.slice((id+"::merged:").length); if (!this.srs[originalKey]) this.srs[originalKey] = this.srs[key]; delete this.srs[key];
      }
      const collapsed = new Set(archive.collapsedNodeIds ?? archive.nodes.map(n => n.id));
      for (const node of archive.nodes) {
        const live = this.getNode(node.id);
        const occluded = node.cardId ? this.getCard(node.cardId)?.occluded : undefined;
        if (!live && collapsed.has(node.id)) this.nodes.push({...node,hidden:false,occluded:occluded??node.occluded,updatedAt:now});
        else if (live && collapsed.has(node.id)) { live.cardId = node.cardId; live.hidden = false; live.occluded = occluded??live.occluded; live.updatedAt = now; }
      }
      for (const move of [...(archive.movedParents ?? [])].reverse()) { const node = this.getNode(move.id); if (node?.parentId === move.after) node.parentId = move.before; }
      this.edges = this.edges.filter(edge => !(archive.mappedEdges ?? []).some(mapped => same(mapped,edge)));
      this.edges.push(...archive.edges.filter(edge => this.getNode(edge.from) && this.getNode(edge.to)));
      for (const entry of [...(archive.cardLinks ?? [])].reverse()) {
        const card = this.getCard(entry.cardId); if (!card) continue;
        card.links = same(card.links,entry.mergedLinks) ? entry.links : [...new Set([...card.links,...entry.links])];
      }
      for (const entry of archive.memberships) { const set = this.studySets.find(s => s.id === entry.studySetId); if (set) set.cardIds = [...new Set([...(set.cardIds??[]),...(entry.cardIds??[])])]; }
      for (const set of this.studySets) if (set.cardIds?.includes(id)) set.cardIds = [...new Set([...set.cardIds,...restored.map(c => c.id)])];
      this.restoreCardAnchors(); return restored;
    });
  }

  getNode(id: string): MindNode | undefined { return this.nodes.find(n => n.id === id); }
  moveNode(id: string, x: number, y: number): void {
    const node = this.getNode(id); if (!node || !Number.isFinite(x) || !Number.isFinite(y) || (node.x === x && node.y === y)) return;
    const before = { x: node.x, y: node.y }; node.x = x; node.y = y;
    this.pushHistory({ label: "移动节点", nodeMove: { id, before, after: { x, y } } });
    this.libraryHistoryRevision++; this.mainDirty = true; this.mainVersion++; this.changed(id); this.scheduleFlush();
  }
  addNode(n: MindNode): void { this.mutate("添加节点", () => {
    if (this.getNode(n.id)) throw new Error("节点 id 已存在");
    const parent = n.parentId ? this.getNode(n.parentId) : undefined;
    n.canvasId ??= parent?.canvasId ?? this.activeCanvasId;
    n.order ??= this.nodes.filter(x => x.parentId === n.parentId && x.canvasId === n.canvasId).length;
    if (n.cardId) n.reference ??= true;
    this.nodes.push(n);
  }); }
  addNodes(nodes: MindNode[]): void { this.mutate("添加节点", () => { for (const node of nodes) this.addNode(node); }); }
  updateNode(id: string, patch: Partial<MindNode>): void { this.mutate("编辑节点", () => {
    const n = this.getNode(id); if (!n) return;
    if (patch.parentId !== undefined) this.assertParent(id, patch.parentId);
    Object.assign(n, patch, { id });
  }); }
  updateNodes(patches: { id: string; patch: Partial<MindNode> }[]): void { this.mutate("编辑节点", () => { for (const p of patches) this.updateNode(p.id, p.patch); }); }
  private descendants(ids: string[]): Set<string> {
    const found = new Set(ids.filter(id => this.getNode(id))); const queue = [...found];
    while (queue.length) { const id = queue.shift()!; for (const n of this.nodes) if (n.parentId === id && !found.has(n.id)) { found.add(n.id); queue.push(n.id); } }
    return found;
  }
  removeNode(id: string): void { this.removeNodes([id]); }
  removeExcerptFromMindmap(id: string): boolean {
    const node=this.getNode(id);if(!node||!node.cardId)return false;
    this.mutate("撤出脑图",()=>{for(const child of this.nodes)if(child.parentId===id)child.parentId=node.parentId;
      this.nodes=this.nodes.filter(item=>item.id!==id);this.edges=this.edges.filter(edge=>edge.from!==id&&edge.to!==id);});return true;
  }
  removeNodes(ids: string[]): void { this.mutate("删除节点", () => {
    const removed = this.descendants(ids); this.nodes = this.nodes.filter(n => !removed.has(n.id)); this.edges = this.edges.filter(e => !removed.has(e.from) && !removed.has(e.to));
  }); }
  linkCards(from: string, to: string, bidirectional = false): boolean {
    const source = this.getCard(from), target = this.getCard(to);
    if (!source || !target || from === to) return false;
    return this.mutate("关联卡片", () => {
      this.updateCard(from, { links: [...new Set([...source.links, to])] });
      if (bidirectional) this.updateCard(to, { links: [...new Set([...target.links, from])] });
      return true;
    });
  }
  unlinkCards(from: string, to: string, bidirectional = false): boolean {
    const source = this.getCard(from), target = this.getCard(to);
    if (!source || !target || from === to) return false;
    return this.mutate("断开卡片关联", () => {
      const matches = (edge: Edge) => {
        const a = this.getNode(edge.from)?.cardId, b = this.getNode(edge.to)?.cardId;
        return a === from && b === to || bidirectional && a === to && b === from;
      };
      this.edges = this.edges.filter(edge => !matches(edge));
      this.updateCard(from, { links: source.links.filter(id => id !== to) });
      if (bidirectional) this.updateCard(to, { links: target.links.filter(id => id !== from) });
      return true;
    });
  }
  connectNodes(from: string, to: string): boolean {
    const source = this.getNode(from), target = this.getNode(to);
    if (!source || !target || source.canvasId !== target.canvasId || from === to || !source.cardId || !target.cardId || source.cardId === target.cardId || !this.getCard(source.cardId) || !this.getCard(target.cardId)) return false;
    if (source.parentId === to || target.parentId === from) return false;
    return this.mutate("绘制卡片关联", () => {
      this.addEdge(from, to); this.linkCards(source.cardId!, target.cardId!); return true;
    });
  }
  disconnectNodes(from: string, to: string): boolean {
    const edge = this.edges.find(item => item.from === from && item.to === to);
    if (!edge) return false;
    return this.mutate("断开脑图关联", () => {
      const source = this.getNode(from)?.cardId, target = this.getNode(to)?.cardId;
      this.removeEdge(from, to);
      const remaining = source && target && this.edges.some(item => this.getNode(item.from)?.cardId === source && this.getNode(item.to)?.cardId === target);
      const card = source ? this.getCard(source) : undefined;
      if (card && target && !remaining) this.updateCard(card.id, { links: card.links.filter(id => id !== target) });
      return true;
    });
  }
  private assertParent(id: string, parentId: string | null): void {
    if (parentId === null) return;
    const parent = this.getNode(parentId); const node = this.getNode(id);
    if (!parent || parentId === id || this.descendants([id]).has(parentId) || (node && node.canvasId !== parent.canvasId)) throw new Error("不能建立循环或跨画布父子关系");
  }
  reparentNode(id: string, parentId: string | null, index?: number): void { this.mutate("移动分支", () => {
    this.assertParent(id, parentId); const n = this.getNode(id); if (!n) return;
    n.parentId = parentId; const siblings = this.nodes.filter(x => x.id !== id && x.parentId === parentId && x.canvasId === n.canvasId).sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
    siblings.splice(Math.max(0, Math.min(index ?? siblings.length, siblings.length)), 0, n); siblings.forEach((s, i) => s.order = i);
  }); }
  addEdge(from: string, to: string, label?: string): void { this.mutate("添加关联", () => {
    const a = this.getNode(from), b = this.getNode(to); if (!a || !b || a.canvasId !== b.canvasId || from === to) return;
    const existing = this.edges.find(e => e.from === from && e.to === to);
    if (existing) { existing.label = [...new Set([existing.label, label].filter(Boolean))].join("\n") || undefined; return; }
    // A direct parent-child relationship already renders a structural edge.
    // Keep explicit links from adding its reverse visual duplicate.
    if (!label && (a.parentId === to || b.parentId === from)) return;
    this.edges.push({ from, to, label });
  }); }
  removeEdge(from: string, to: string): void { this.mutate("删除关联", () => { this.edges = this.edges.filter(e => !(e.from === from && e.to === to)); }); }

  copySubtree(ids: string[]): MindmapFragment { const all = this.descendants(ids); const cards = new Set(this.nodes.filter(n => all.has(n.id)).map(n => n.cardId)); return clone({ nodes: this.nodes.filter(n => all.has(n.id)), edges: this.edges.filter(e => all.has(e.from) && all.has(e.to)), cards: this.cards.filter(c => cards.has(c.id)) }); }
  pasteSubtree(fragment: MindmapFragment, options: PasteOptions): string[] {
    return this.mutate(options.mode === "clone" ? "粘贴独立克隆" : "粘贴引用", () => {
      const ids = new Map(fragment.nodes.map(n => [n.id, uid("node")])); const cardIds = new Map<string, string>();
      const targetCanvas = options.canvasId ?? (options.parentId ? this.getNode(options.parentId)?.canvasId : this.activeCanvasId);
      if (options.parentId && !this.getNode(options.parentId)) throw new Error("目标父节点不存在");
      if (options.parentId && this.getNode(options.parentId)?.canvasId !== targetCanvas) throw new Error("目标父节点不属于此画布");
      if (options.mode === "clone") for (const card of fragment.cards) { const c = this.independentCard(card); cardIds.set(card.id, c.id); this.addCard(c); }
      for (const id of cardIds.values()) { const c = this.getCard(id)!; c.links = c.links.map(link => cardIds.get(link) ?? link); }
      const offset = options.offset ?? { x: 40, y: 40 };
      // Build every ID first, then parents. Fragment storage order is immaterial.
      for (const n of fragment.nodes) {
        const copy = clone(n); copy.id = ids.get(n.id)!; copy.parentId = n.parentId && ids.has(n.parentId) ? ids.get(n.parentId)! : options.parentId ?? null;
        copy.canvasId = targetCanvas; copy.x += offset.x; copy.y += offset.y; copy.sourceNodeId = options.mode === "reference" ? n.id : undefined;
        if (copy.submapId) {
          const source = this.canvases.find(canvas => canvas.id === n.canvasId)?.submaps?.find(submap => submap.id === n.submapId && submap.rootNodeId === n.id);
          const target = this.canvases.find(canvas => canvas.id === targetCanvas);
          delete copy.submapId;
          if (source && target) {
            const submap = { id: uid("submap"), name: source.name, rootNodeId: copy.id, createdAt: new Date().toISOString() };
            (target.submaps ??= []).push(submap); copy.submapId = submap.id;
          }
        }
        copy.cardId = n.cardId ? cardIds.get(n.cardId) ?? (this.getCard(n.cardId) ? n.cardId : undefined) : undefined; copy.reference = options.mode === "reference";
        if (options.mode === "reference" && !copy.cardId) {
          const source = this.getNode(n.id);
          const previousReference = this.nodes.find(x => x.reference && x.sourceNodeId === n.id && x.cardId);
          const existing = source?.cardId ? this.getCard(source.cardId) : previousReference?.cardId ? this.getCard(previousReference.cardId) : n.cardId && cardIds.has(n.cardId) ? this.getCard(cardIds.get(n.cardId)!) : undefined;
          const archived = fragment.cards.find(c => c.id === n.cardId);
          const shared = existing ?? (archived ? { ...clone(archived), id: uid("card-reference") } : { id: uid("card"), docPath: n.docPath ?? "", front: n.title, title: n.title, color: n.color, image: n.image, tags: clone(n.tags ?? []), links: [], type: "comment" as const, createdAt: new Date().toISOString() });
          if (!existing) this.addCard(shared);
          copy.cardId = shared.id;
          if (n.cardId) cardIds.set(n.cardId, shared.id);
          if (source) { source.cardId = shared.id; source.reference = true; }
        }
        this.nodes.push(copy);
      }
      for (const e of fragment.edges) if (ids.has(e.from) && ids.has(e.to)) this.edges.push({ ...e, from: ids.get(e.from)!, to: ids.get(e.to)! });
      return [...ids.values()];
    });
  }
  moveSubtrees(ids: string[], options: Omit<PasteOptions, "mode">): string[] {
    if (!ids.length || ids.some(id => !this.getNode(id))) throw new Error("待剪切节点已变化，请重新剪切");
    const moved = this.descendants(ids), parentId = options.parentId ?? null;
    if (parentId && moved.has(parentId)) throw new Error("不能粘贴到自身或子节点中");
    const parent = parentId ? this.getNode(parentId) : undefined;
    const canvasId = options.canvasId ?? parent?.canvasId ?? this.activeCanvasId;
    if (!canvasId || !this.canvases.some(canvas => canvas.id === canvasId)) throw new Error("目标脑图不存在");
    if (parentId && (!parent || parent.canvasId !== canvasId)) throw new Error("目标父节点不属于此画布");
    return this.mutate("粘贴剪切卡片", () => {
      const roots = this.nodes.filter(node => moved.has(node.id) && (!node.parentId || !moved.has(node.parentId)));
      const siblings = this.nodes.filter(node => !moved.has(node.id) && node.canvasId === canvasId && node.parentId === parentId);
      const offset = options.offset ?? {x:40,y:40};
      const target = this.canvases.find(canvas => canvas.id === canvasId)!;
      for (const source of this.canvases) if (source.id !== canvasId && source.submaps?.some(submap => moved.has(submap.rootNodeId))) {
        const transferring = source.submaps.filter(submap => moved.has(submap.rootNodeId));
        source.submaps = source.submaps.filter(submap => !moved.has(submap.rootNodeId));
        (target.submaps ??= []).push(...transferring);
      }
      for (const node of this.nodes) if (moved.has(node.id)) { node.canvasId = canvasId; node.x += offset.x; node.y += offset.y; }
      roots.forEach((node,index) => { node.parentId = parentId; node.order = siblings.length + index; });
      // Internal links travel with the branch; explicit links cannot cross canvases.
      this.edges = this.edges.filter(edge => this.getNode(edge.from)?.canvasId === this.getNode(edge.to)?.canvasId);
      return this.nodes.filter(node => moved.has(node.id)).map(node => node.id);
    });
  }
  mergeNodes(ids: string[]): string | undefined { return this.mutate("合并节点", () => {
    const selected = [...new Set(ids)].map(id => this.getNode(id)).filter((n): n is MindNode => !!n);
    if (selected.length < 2) return selected[0]?.id;
    const keep = selected[0]; if (selected.some(n => n.canvasId !== keep.canvasId)) throw new Error("请在同一画布合并节点");
    const removed = new Set(selected.slice(1).map(n => n.id));
    for (const n of selected) {
      if (n.cardId && this.nodes.some(other => other.id !== n.id && other.cardId === n.cardId)) this.detachNodeReference(n.id,false);
      if (!n.cardId) { const c: Card = { id: uid("card"), docPath: n.docPath ?? "", type: "comment", front: n.title, image: n.image, tags: n.tags ?? [], links: [], createdAt: new Date().toISOString() }; this.addCard(c); n.cardId = c.id; }
    }
      const cardIds = [...new Set(selected.map(n => n.cardId).filter((id): id is string => !!id))];
    if (cardIds.length) { const c = this.mergeCards(cardIds[0], cardIds.slice(1),selected.map(n => n.id)); if (c) { keep.cardId = c.id; keep.reference = true; keep.title = c.title || c.front; keep.image = c.image; } }
    else keep.title = [...new Set(selected.map(n => n.title))].join("\n\n");
    keep.tags = [...new Set(selected.flatMap(n => n.tags ?? []))]; keep.comments = selected.flatMap(n => n.comments ?? []);
    // A selected ancestor may be removed: walk to its first surviving parent.
    let parent = keep.parentId; const visited = new Set<string>(); while (parent && removed.has(parent) && !visited.has(parent)) { visited.add(parent); parent = this.getNode(parent)?.parentId ?? null; } keep.parentId = parent === keep.id ? null : parent;
    for (const n of this.nodes) if (!removed.has(n.id) && n.id !== keep.id && n.parentId && removed.has(n.parentId)) n.parentId = keep.id;
    this.nodes = this.nodes.filter(n => !removed.has(n.id));
    this.edges = this.edges.map(e => ({ ...e, from: removed.has(e.from) ? keep.id : e.from, to: removed.has(e.to) ? keep.id : e.to }));
    return keep.id;
  }); }

  private repairGraph(): void {
    const cards = new Set(this.cards.map(c => c.id)), nodes = new Map(this.nodes.map(n => [n.id,n]));
    for (const c of this.cards) c.links = [...new Set(c.links ?? [])].filter(id => id !== c.id && cards.has(id));
    for (const n of this.nodes) {
      if (n.cardId && !cards.has(n.cardId)) n.cardId = undefined;
      if (n.parentId && (!nodes.has(n.parentId) || nodes.get(n.parentId)?.canvasId !== n.canvasId)) n.parentId = null;
      const chain = new Set([n.id]); let p = n.parentId;
      while (p) { if (chain.has(p)) { n.parentId = null; break; } chain.add(p); p = nodes.get(p)?.parentId ?? null; }
    }
    for (const canvas of this.canvases) if (canvas.submaps) canvas.submaps = canvas.submaps.filter(submap => {
      const root = nodes.get(submap.rootNodeId);
      return root?.canvasId === canvas.id && root.submapId === submap.id;
    });
    for (const node of this.nodes) if (node.submapId && !this.canvases.find(canvas => canvas.id === node.canvasId)?.submaps?.some(submap => submap.id === node.submapId && submap.rootNodeId === node.id)) delete node.submapId;
    const seen = new Map<string, Edge>(); this.edges = this.edges.filter(e => { const key = e.from + ":" + e.to; if (!nodes.has(e.from) || !nodes.has(e.to) || e.from === e.to || nodes.get(e.from)?.canvasId !== nodes.get(e.to)?.canvasId) return false; const existing = seen.get(key); if (existing) { existing.label = [...new Set([...(existing.label ?? "").split("\n"), ...(e.label ?? "").split("\n")].filter(Boolean))].join("\n") || undefined; return false; } seen.set(key,e); return true; });
    if (this.activeStudySetId && !this.studySets.some(s => s.id === this.activeStudySetId)) { this.activeStudySetId = undefined; this.activeCanvasId = undefined; }
    if (this.activeCanvasId && !this.canvases.some(c => c.id === this.activeCanvasId && c.studySetId === this.activeStudySetId)) this.activeCanvasId = this.canvases.find(c => c.studySetId === this.activeStudySetId)?.id;
    if (this.activeStudySetId && !this.activeCanvasId) this.activeCanvasId = this.canvases.find(c => c.studySetId === this.activeStudySetId)?.id;
  }

  createStudySet(name: string, docPaths: string[] = []): StudySet { return this.mutate("创建学习集", () => {
    const set: StudySet = { id: uid("study"), name: name.trim() || "未命名学习集", docPaths: [...new Set(docPaths)], createdAt: new Date().toISOString() };
    this.studySets.push(set); const canvas = this.createCanvas(set.id, "主脑图"); this.activeStudySetId = set.id; this.activeCanvasId = canvas.id; this.importUnassigned(set.docPaths, canvas.id); return set;
  }); }
  updateStudySet(id: string, patch: Partial<StudySet>): void { this.mutate("编辑学习集", () => {
    const set = this.studySets.find(s => s.id === id); if (!set) return;
    // Removing a book changes tabs, never the already-associated card membership.
    if (patch.docPaths) set.cardIds = [...new Set([...(set.cardIds ?? []), ...this.cards.filter(c => set.docPaths.includes(c.docPath) || c.sources?.some(source => set.docPaths.includes(source.docPath))).map(c => c.id), ...this.cardsForStudySet(id).map(c => c.id)])];
    const added = (patch.docPaths ?? []).filter(p => !set.docPaths.includes(p)); Object.assign(set, patch, { id }); set.docPaths = [...new Set(set.docPaths)];
    const first = this.canvases.find(c => c.studySetId === id); if (first && added.length) this.importUnassigned(added, first.id);
  }); }
  async changeStudySetDocuments(id: string | undefined, paths: string[], options: { mode?: "append" | "replace"; sourceUrls?: Record<string, string>; expectedPaths?: string[] } = {}): Promise<void> {
    if (this.documentCommitPending) throw new Error("另一项文档操作正在保存，请稍后重试。");
    this.documentCommitPending = true;
    let before: LibrarySnapshot | undefined, after: LibrarySnapshot | undefined;
    let oldHistory: HistoryEntry[] = [], oldFuture: HistoryEntry[] = [], oldRevision = 0;
    try {
      await this.flush();
      const set = id ? this.studySets.find(item => item.id === id) : undefined;
      if (id && !set) throw new Error("目标学习集已不存在。");
      if (set && options.expectedPaths && !same(set.docPaths, options.expectedPaths)) throw new Error("学习集文档已发生变化，请重新打开成员管理。");
      const next = [...new Set(options.mode === "append" && set ? [...set.docPaths, ...paths] : paths)];
      const added = id ? next.filter(path => !set!.docPaths.includes(path)) : next;
      for (const path of added) {
        if (!isStudyDocumentPath(path) || !(this.host.app.vault.getAbstractFileByPath(path) instanceof TFile)) throw new Error("文档不存在或格式不受支持：" + path);
      }
      before = this.snapshot(); oldHistory = [...this.history]; oldFuture = [...this.future]; oldRevision = this.libraryHistoryRevision;
      this.documentCommitOwner = true;
      try {
        this.mutate("管理学习集文档", () => {
          for (const path of added) if (!this.documents.some(document => document.path === path)) this.registerDocument(path, options.sourceUrls?.[path]);
          if (set && !same(set.docPaths, next)) this.updateStudySet(set.id, { docPaths: next });
        });
        after = this.snapshot();
      } finally { this.documentCommitOwner = false; }
      await this.flush();
    } catch (error) {
      if (before) {
        this.history = oldHistory; this.future = oldFuture; this.libraryHistoryRevision = oldRevision;
        this.restoreSnapshot(before, after);
        try { await this.flush(); }
        catch (rollbackError) { throw new DocumentCommitRollbackError(error, rollbackError); }
      }
      throw error;
    } finally { this.documentCommitPending = false; }
  }
  setStudySetReviewSettings(id: string, settings: NonNullable<StudySet["reviewSettings"]>): void {
    const set = this.studySets.find(item => item.id === id); if (!set || same(set.reviewSettings, settings)) return;
    set.reviewSettings = clone(settings); this.save();
  }
  setStudySetPracticeSettings(id: string, settings: NonNullable<StudySet["practiceSettings"]>): void {
    const set = this.studySets.find(item => item.id === id); if (!set || same(set.practiceSettings, settings)) return;
    set.practiceSettings = clone(settings); this.save();
  }
  addPracticeAttempt(input: PracticeAttemptInput): PracticeAttempt {
    if (!this.studySets.some(set => set.id === input.studySetId) || !this.cardsForStudySet(input.studySetId).some(card => card.id === input.cardId)) throw new Error("卡片不在所选学习集中");
    if (typeof input.answer !== "string" || !input.answer.trim() || !["correct", "wrong", "partial"].includes(input.verdict)) throw new Error("请填写答案并选择判定结果");
    if (input.correctionOf) {
      const original = this.practiceAttempts.find(attempt => attempt.id === input.correctionOf);
      if (!original || original.cardId !== input.cardId || original.studySetId !== input.studySetId || original.questionId !== input.questionId || original.verdict === "correct") throw new Error("原作答不存在或无法订正");
    }
    let id: string;
    do { id = uid("attempt"); } while (this.practiceAttempts.some(attempt => attempt.id === id));
    const attempt: PracticeAttempt = { id, cardId: input.cardId, studySetId: input.studySetId, at: new Date().toISOString(), answer: input.answer,
      verdict: input.verdict, ...(input.mistake && { mistake: input.mistake }), ...(input.correctionOf && { correctionOf: input.correctionOf }),
      ...(input.questionId && { questionId: input.questionId }), ...(input.questionKind && { questionKind: input.questionKind }) };
    this.practiceAttempts.push(attempt); this.save(); return clone(attempt);
  }
  private importUnassigned(paths: string[], canvasId: string): void {
    const ids = this.nodes.filter(n => !n.canvasId && n.docPath && paths.includes(n.docPath)).map(n => n.id);
    if (ids.length) this.pasteSubtree(this.copySubtree(ids), { canvasId, mode: "reference", offset: { x: 0, y: 0 } });
  }
  removeStudySet(id: string): void { this.mutate("移除学习集", () => {
    const canvases = new Set(this.canvases.filter(c => c.studySetId === id).map(c => c.id));
    this.removeNodes(this.nodes.filter(n => n.canvasId && canvases.has(n.canvasId)).map(n => n.id));
    this.canvases = this.canvases.filter(c => c.studySetId !== id); this.studySets = this.studySets.filter(s => s.id !== id);
    for (const deck of this.reviewDecks) deck.studySetIds = deck.studySetIds.filter(setId => setId !== id);
    if (this.activeStudySetId === id) { this.activeStudySetId = undefined; this.activeCanvasId = undefined; }
  }); }
  setActiveStudySet(id?: string, options: { open?: boolean; documentPath?: string } = {}): void {
    const set = this.studySets.find(s => s.id === id); if (id && !set) return;
    if (options.open === false) return;
    this.activeStudySetId = id;
    if (!set) { this.activeCanvasId = undefined; this.save(); return; }
    const candidates = this.canvases.filter(c => c.studySetId === id && c.kind !== "review" && this.canvasHasNotes(c.id));
    candidates.sort((a,b) => (b.lastVisitedAt ?? "").localeCompare(a.lastVisitedAt ?? ""));
    const canvas = candidates[0] ?? this.createCanvas(set.id, set.name);
    this.setActiveCanvas(canvas.id, options.documentPath);
  }
  createCanvas(studySetId: string, name: string): MindCanvas { return this.mutate("创建脑图", () => {
    if (!this.studySets.some(s => s.id === studySetId)) throw new Error("学习集不存在");
    const canvas: MindCanvas = { id: uid("canvas"), studySetId, name: name.trim() || "未命名脑图", createdAt: new Date().toISOString() }; this.canvases.push(canvas); return canvas;
  }); }
  setActiveCanvas(id: string, documentPath?: string): void {
    const c = this.canvases.find(c => c.id === id); if (!c) return;
    this.activeStudySetId = c.studySetId; this.activeCanvasId = c.id; c.lastVisitedAt = new Date().toISOString();
    if (documentPath) c.lastDocumentPath = documentPath;
    this.save(); for (const listener of this.navigationListeners) listener({ canvasId: id, documentPath: documentPath ?? c.lastDocumentPath });
  }
  updateCanvas(id: string, patch: Partial<MindCanvas>): void { this.mutate("修改脑图选项", () => {
    const canvas = this.canvases.find(c => c.id === id);
    const next = "handwriting" in patch ? { ...patch, handwriting: normalizeMindmapHandwriting(patch.handwriting) } : patch;
    if (patch.handwriting !== undefined && !next.handwriting) throw new Error("脑图手写格式或版本不支持");
    if (canvas) {
      Object.assign(canvas, next, { id: canvas.id, studySetId: canvas.studySetId });
      // A default layer is implicit. Keep named/custom empty layers and overlay choices.
      if ("handwriting" in patch) {
        const ink = canvas.handwriting, layer = ink?.layers[0];
        if (!ink || ink.layers.length === 1 && layer?.id === "default" && layer.name === "Default" && !layer.strokes.length && ink.activeLayerId === "default" && !ink.overlayLayerId) delete canvas.handwriting;
      }
    }
  }); }
  createSubmap(rootNodeId: string, name: string): MindSubmap { return this.mutate("创建子脑图", () => {
    const node = this.getNode(rootNodeId), canvas = this.canvases.find(item => item.id === node?.canvasId);
    if (!node || !canvas) throw new Error("子脑图根节点不存在");
    if (node.submapId || canvas.submaps?.some(item => item.rootNodeId === rootNodeId)) throw new Error("该节点已有子脑图");
    const title = name.trim(); if (!title) throw new Error("子脑图名称不能为空");
    const used = new Set(this.canvases.flatMap(item => (item.submaps ?? []).map(submap => submap.id)));
    let id: string; do { id = uid("submap"); } while (used.has(id));
    const submap: MindSubmap = { id, name: title, rootNodeId, createdAt: new Date().toISOString() };
    (canvas.submaps ??= []).push(submap); node.submapId = submap.id; node.submap = true;
    return clone(submap);
  }); }
  renameSubmap(canvasId: string, submapId: string, name: string): void { this.mutate("重命名子脑图", () => {
    const submap = this.canvases.find(canvas => canvas.id === canvasId)?.submaps?.find(item => item.id === submapId);
    if (!submap) throw new Error("子脑图不存在");
    const title = name.trim(); if (!title) throw new Error("子脑图名称不能为空");
    submap.name = title;
  }); }
  deleteSubmap(canvasId: string, submapId: string): void { this.mutate("删除子脑图", () => {
    const canvas = this.canvases.find(item => item.id === canvasId), submap = canvas?.submaps?.find(item => item.id === submapId);
    if (!canvas || !submap) throw new Error("子脑图不存在");
    canvas.submaps = canvas.submaps!.filter(item => item.id !== submapId);
    for (const node of this.nodes) if (node.canvasId === canvasId && node.submapId === submapId) { delete node.submapId; node.submap = false; }
  }); }
  canvasHasNotes(id: string, visibleOnly = false): boolean {
    if (mindmapHasHandwriting(this.canvases.find(canvas => canvas.id === id)?.handwriting)) return true;
    return this.nodes.some(node => {
      if (node.canvasId !== id || node.kind === "toc" || (visibleOnly && node.hidden)) return false;
      const card = node.cardId ? this.getCard(node.cardId) : undefined;
      return card ? !card.groupId && (!visibleOnly || !card.hidden) && !!(card.title || card.front || card.back || card.image || card.images?.length || card.blank || this.hasCardAnchor(card)) : !!(node.title || node.image);
    });
  }
  getCanvasKind(id: string): "empty" | "document" | "study" | "review" { const canvas = this.canvases.find(c => c.id === id); return canvas?.kind === "review" ? "review" : this.canvasHasNotes(id) ? "study" : canvas?.kind === "document" || canvas?.lastDocumentPath ? "document" : "empty"; }
  cardsForStudySet(id: string | undefined = this.activeStudySetId): Card[] {
    const set = id && id !== "*" ? this.studySets.find(s => s.id === id) : undefined;
    if (!set) return this.cards.filter(c => !c.groupId && !c.hidden);
    const canvasIds = new Set(this.canvases.filter(c => c.studySetId === set.id).map(c => c.id));
    const nodeCards = new Set(this.nodes.filter(n => n.canvasId && canvasIds.has(n.canvasId)).map(n => n.cardId));
    return this.cards.filter(c => !c.groupId && !c.hidden && (set.docPaths.includes(c.docPath) || c.sources?.some(s => set.docPaths.includes(s.docPath)) || set.cardIds?.includes(c.id) || nodeCards.has(c.id)));
  }
  getScopedCards(): Card[] { return this.cardsForStudySet(); }
  getScopedNodes(): MindNode[] { return this.activeStudySetId ? this.nodes.filter(n => n.canvasId === this.activeCanvasId) : this.nodes.filter(n => !n.canvasId); }

  getReviewState(id: string, questionId?: string): CardState {
    const key = questionId ?? id;
    return clone(this.srs[key] ?? (!key.includes("::scope:") && !key.includes("::deck:") ? this.srs[id] : undefined) ?? freshState(this.settings.defaultEase));
  }
  getLatestReviewLog(): ReviewLog | undefined {
    const withdrawn = new Set(this.reviewLogs.filter(l => l.undoneAt).map(reviewEventId));
    return this.reviewLogs.reduce<ReviewLog | undefined>((latest, item) => item.undoneAt || withdrawn.has(reviewEventId(item)) ? latest : !latest || item.reviewedAt >= latest.reviewedAt ? item : latest, undefined);
  }
  getReviewDeck(id: string): ReviewDeck | undefined { return this.reviewDecks.find(deck => deck.id === id); }
  reviewDeckForStudySet(id: string | undefined = this.activeStudySetId): ReviewDeck | undefined {
    const deckId = this.studySets.find(set => set.id === id)?.reviewDeckId;
    return deckId ? this.getReviewDeck(deckId) : undefined;
  }
  createReviewDeck(name: string, studySetId?: string): ReviewDeck {
    return this.mutate("创建复习卡组", () => {
      const deck: ReviewDeck = { id: uid("deck"), name: name.trim() || "未命名复习卡组", studySetIds: [], cardIds: [], createdAt: new Date().toISOString() };
      this.reviewDecks.push(deck); this.activeReviewDeckId = deck.id;
      if (studySetId) this.bindReviewDeck(deck.id, studySetId);
      return deck;
    });
  }
  renameReviewDeck(id: string, name: string): void { this.mutate("重命名复习卡组", () => {
    const deck = this.getReviewDeck(id); if (!deck || !name.trim()) return;
    deck.name = name.trim(); deck.updatedAt = new Date().toISOString();
  }); }
  setReviewDeckMaxInterval(id: string, maxInterval?: number): void {
    if (maxInterval !== undefined && (!Number.isSafeInteger(maxInterval) || maxInterval < 1)) throw new Error("最长间隔须为大于等于 1 的整数天数");
    const deck = this.getReviewDeck(id); if (!deck) throw new Error("复习卡组不存在");
    if (deck.maxInterval === maxInterval) return;
    this.mutate("设置复习卡组最长间隔", () => {
      if (maxInterval === undefined) delete deck.maxInterval; else deck.maxInterval = maxInterval;
      deck.updatedAt = new Date().toISOString();
    });
  }
  bindReviewDeck(deckId: string, studySetId: string): void { this.mutate("绑定复习卡组", () => {
    const deck = this.getReviewDeck(deckId), set = this.studySets.find(set => set.id === studySetId);
    if (!deck || !set) throw new Error("复习卡组或学习集不存在");
    for (const other of this.reviewDecks) if (other.id !== deckId) other.studySetIds = other.studySetIds.filter(id => id !== studySetId);
    set.reviewDeckId = deck.id; deck.studySetIds = [...new Set([...deck.studySetIds, studySetId])];
    deck.updatedAt = new Date().toISOString(); this.activeReviewDeckId = deck.id;
  }); }
  setActiveReviewDeck(id: string): void { if (this.getReviewDeck(id)) { this.activeReviewDeckId = id; this.save(); } }
  /** Membership survives completion and future due times. It is never a due badge. */
  cardReviewDecks(cardId: string): { id: string; name: string }[] {
    return this.reviewDecks.filter(deck => deck.cardIds.includes(cardId)).map(({ id, name }) => ({ id, name }));
  }
  removeCardsFromReviewDeck(cardIds: string[], deckId: string): void { this.mutate("移出复习卡组", () => {
    const deck = this.getReviewDeck(deckId); if (!deck) return; const ids = new Set(cardIds);
    deck.cardIds = deck.cardIds.filter(id => !ids.has(id)); deck.updatedAt = new Date().toISOString();
    this.reviewPending = this.reviewPending.filter(row => !(ids.has(row.cardId) && this.pendingInDeck(row, deck)));
    // Retain schedules and history for audit/undo. Membership alone controls the
    // browse surface, while a future explicit enrollment creates a fresh queue.
  }); }
  private questionsInDeck(card: Card, deck: ReviewDeck, scopeId?: string): ReviewQuestion[] {
    const legacy = Object.prototype.hasOwnProperty.call(deck, "legacyScopeId");
    return questionsForCard(card, legacy ? deck.legacyScopeId ?? undefined : scopeId, legacy ? undefined : deck.id)
      .map(question => ({ ...question, deckId: deck.id }));
  }
  deckQuestionsForCard(cardId: string, deckId: string, scopeId?: string): ReviewQuestion[] {
    const card = this.getCard(cardId), deck = this.getReviewDeck(deckId);
    if (!card || !deck) return [];
    const origin = scopeId ?? this.reviewPending.find(row => row.cardId === cardId && this.pendingInDeck(row, deck))?.scopeId;
    return this.questionsInDeck(card, deck, origin);
  }
  private pendingInDeck(row: ReviewPending | ReviewLog, deck: ReviewDeck): boolean {
    return row.deckId ? row.deckId === deck.id : Object.prototype.hasOwnProperty.call(deck, "legacyScopeId") && row.scopeId === (deck.legacyScopeId ?? undefined);
  }
  private legacyPendingInScope(row: ReviewPending, scopeId?: string): boolean {
    if (row.scopeId !== scopeId) return false;
    if (!row.deckId) return true;
    const deck = this.getReviewDeck(row.deckId);
    return !!deck && Object.prototype.hasOwnProperty.call(deck, "legacyScopeId") && (deck.legacyScopeId ?? undefined) === scopeId;
  }
  reviewLogsForDeck(deckId: string): ReviewLog[] {
    const deck = this.getReviewDeck(deckId); return deck ? this.reviewLogs.filter(log => this.pendingInDeck(log, deck)) : [];
  }
  pendingQuestionsForDeck(deckId: string, now = new Date()): ReviewQuestion[] {
    const deck = this.getReviewDeck(deckId); if (!deck) return [];
    return this.reviewPending.filter(row => row.visited !== true && this.pendingInDeck(row, deck) && isDue({ due: row.due } as CardState, now)).flatMap(row => {
      const card = this.getCard(row.cardId);
      if (!card || card.hidden || card.groupId || !deck.cardIds.includes(card.id)) return [];
      const question = this.questionsInDeck(card, deck, row.scopeId).find(question => question.id === row.questionId);
      return question ? [question] : [];
    });
  }
  reviewDeckSummary(deckId: string, now = new Date()): ReviewDeckSummary {
    const deck = this.getReviewDeck(deckId); if (!deck) return { cards: 0, questions: 0, due: 0, learning: 0, reviewedToday: 0 };
    const cards = deck.cardIds.map(id => this.getCard(id)).filter((card): card is Card => !!card && !card.hidden && !card.groupId);
    const ids = new Set(cards.map(card => card.id));
    const liveQuestions = new Set(cards.flatMap(card => this.deckQuestionsForCard(card.id, deckId).map(question => question.id)));
    const pending = this.reviewPending.filter(row => row.visited !== true && this.pendingInDeck(row, deck) && ids.has(row.cardId) && liveQuestions.has(row.questionId));
    const future = pending.map(row => row.due).filter(due => new Date(due).getTime() > now.getTime()).sort();
    const logs = this.reviewLogs.filter(log => this.pendingInDeck(log, deck));
    return { cards: cards.length, questions: pending.length,
      due: pending.filter(row => isDue({ due: row.due } as CardState, now)).length,
      learning: pending.filter(row => [1,3].includes(this.getReviewState(row.cardId, row.questionId).state ?? 0)).length,
      reviewedToday: effectiveReviewCounts(logs)[fmtDate(now)] ?? 0, ...(future[0] && { nextDue: future[0] }) };
  }
  enqueueReviewInDeck(cardIds: string[], deckId: string, scopeId?: string, now = new Date()): ReviewPending[] {
    const deck = this.getReviewDeck(deckId); if (!deck) throw new Error("复习卡组不存在");
    if (scopeId && !this.canvases.some(canvas => canvas.id === scopeId)) throw new Error("目标脑图不存在");
    const enrolled: ReviewPending[] = [];
    for (const id of new Set(cardIds)) {
      const card = this.getCard(id); if (!card || card.hidden || card.groupId) continue;
      deck.cardIds = [...new Set([...deck.cardIds, id])];
      for (const question of this.questionsInDeck(card, deck, scopeId)) {
        const state = this.gradeCard(id, 1, { questionId: question.id, scopeId: question.scopeId, deckId, now });
        state.due = now.toISOString(); this.srs[question.id] = state;
        const pending = this.reviewPending.find(row => row.questionId === question.id)!; pending.due = state.due;
        const log = this.getLatestReviewLog(); if (log?.questionId === question.id) log.after = clone(state);
        enrolled.push(clone(pending));
      }
    }
    deck.updatedAt = now.toISOString(); this.activeReviewDeckId = deck.id; this.save(); return enrolled;
  }
  pendingQuestions(scopeId?: string): ReviewQuestion[] {
    return this.reviewPending.filter(p => p.visited !== true && this.legacyPendingInScope(p, scopeId) && isDue({ due: p.due } as CardState)).flatMap(p => {
      const card = this.getCard(p.cardId);
      if (!card || card.hidden || card.groupId) return [];
      const question = questionsForCard(card, scopeId).find(q => q.id === p.questionId);
      return question ? [question] : [];
    });
  }
  enqueueReview(cardIds: string[], scopeId?: string, now = new Date()): ReviewPending[] {
    if (scopeId && !this.canvases.some(c => c.id === scopeId)) throw new Error("目标脑图不存在");
    const enqueued: ReviewPending[] = [];
    let compatibility = this.reviewDecks.find(deck => Object.prototype.hasOwnProperty.call(deck, "legacyScopeId") && (deck.legacyScopeId ?? undefined) === scopeId);
    for (const id of new Set(cardIds)) {
      const card = this.getCard(id); if (!card || card.groupId) continue;
      if (!compatibility) {
        const canvas = this.canvases.find(canvas => canvas.id === scopeId);
        const generatedId = `review-legacy-${scopeId ?? "unscoped"}`;
        compatibility = { id: this.getReviewDeck(generatedId) ? uid("review-legacy") : generatedId, name: canvas ? `${canvas.name} · 旧版复习` : "旧版复习卡组", cardIds: [], studySetIds: canvas ? [canvas.studySetId] : [], createdAt: now.toISOString(), legacyScopeId: scopeId ?? null };
        this.reviewDecks.push(compatibility);
      }
      if (!compatibility.cardIds.includes(id)) compatibility.cardIds.push(id);
      for (const question of questionsForCard(card, scopeId)) {
        const state = this.gradeCard(id, 1, { questionId: question.id, scopeId, now });
        state.due = now.toISOString(); this.srs[question.id] = state;
        const pending = this.reviewPending.find(p => p.questionId === question.id)!; pending.due = state.due;
        // The explicit redue override is part of the resulting persisted state.
        const log = this.getLatestReviewLog(); if (log?.questionId === question.id) log.after = clone(state);
        enqueued.push(clone(pending));
      }
    }
    this.save(); return enqueued;
  }
  createReviewCopy(id: string, scopeId?: string, selection?: {parts?: ("title"|"excerpt"|"note"|"images")[]; maskIds?: string[]}): Card | undefined {
    return this.mutate("复制为独立复习卡", () => {
      const source = this.getCard(id); if (!source) return undefined;
      const copy = clone(source); copy.id = uid("card-review"); copy.sourceCardId = source.id; copy.type = "flashcard";
      copy.hidden = false; delete copy.groupId; delete copy.mergedCards; delete copy.mergedReviewStates; delete copy.mergeArchive;
      copy.wrong = false; copy.createdAt = copy.updatedAt = new Date().toISOString();
      copy.reviewCopySelection = clone(selection ?? { parts: ["title", "excerpt", "note", "images"] });
      copy.sourceSyncedAt = copy.updatedAt;
      if (selection?.parts) {
        if (!selection.parts.includes("title")) delete copy.title;
        if (!selection.parts.includes("excerpt")) copy.front = "";
        if (!selection.parts.includes("note")) delete copy.back;
        if (!selection.parts.includes("images")) { delete copy.image; delete copy.images; delete copy.occlusions; if (copy.sources) copy.sources = copy.sources.map(source => ({...source,image:undefined})); }
      }
      if (selection?.maskIds) copy.occlusions = copy.occlusions?.filter(mask => selection.maskIds!.includes(mask.id));
      this.addCard(copy);
      if (scopeId) { const canvas = this.canvases.find(c => c.id === scopeId); if (!canvas) throw new Error("目标脑图不存在"); const set = this.studySets.find(s => s.id === canvas.studySetId); if (set) set.cardIds = [...new Set([...(set.cardIds ?? []),copy.id])]; }
      return copy;
    });
  }
  /** Refresh is explicit: a source edit never silently overwrites a review copy. */
  refreshReviewCopy(id: string, selection?: Card["reviewCopySelection"]): Card | undefined {
    return this.mutate("从来源刷新复习副本", () => {
      const copy = this.getCard(id), source = copy?.sourceCardId ? this.getCard(copy.sourceCardId) : undefined;
      if (!copy || !source) throw new Error("来源卡片不存在，无法刷新副本");
      const before = clone(copy), chosen: NonNullable<Card["reviewCopySelection"]> = clone(selection ?? copy.reviewCopySelection ?? { parts: ["title", "excerpt", "note", "images"] });
      const parts = chosen.parts ?? ["title", "excerpt", "note", "images"];
      if (parts.includes("title")) copy.title = source.title;
      if (parts.includes("excerpt")) copy.front = source.front;
      if (parts.includes("note")) copy.back = source.back;
      if (parts.includes("images")) {
        copy.image = source.image; copy.images = clone(source.images);
        copy.sources = clone(source.sources);
        copy.occlusions = clone(source.occlusions?.filter(mask => !chosen.maskIds || chosen.maskIds.includes(mask.id)));
      }
      copy.reviewCopySelection = chosen; copy.sourceSyncedAt = copy.updatedAt = new Date().toISOString();
      this.reconcileReviewQuestions(before, copy); return copy;
    });
  }
  gradeCard(id: string, grade: number, options: GradeOptions = {}): CardState {
    const card = this.getCard(id); if (!card) throw new Error("卡片不存在");
    if (card.groupId || card.hidden) throw new Error("隐藏卡片或合并组员不能单独评分");
    if (![1,2,3,4].includes(grade)) throw new Error("评分必须为 1–4");
    const deck = options.deckId ? this.getReviewDeck(options.deckId) : undefined;
    if (options.deckId && !deck) throw new Error("复习卡组不存在");
    const questions = deck ? this.questionsInDeck(card, deck, options.scopeId) : questionsForCard(card, options.scopeId);
    const key = options.questionId ?? questions[0].id;
    if (!questions.some(q => q.id === key)) throw new Error("题目不属于这张卡片或此复习范围");
    const pendingBefore = this.reviewPending.find(p => p.questionId === key && (deck ? this.pendingInDeck(p, deck) : this.legacyPendingInScope(p, options.scopeId)) && p.visited !== true);
    const effectiveDeckId = options.deckId ?? pendingBefore?.deckId;
    const before = pendingBefore ? this.getReviewState(id, key) : freshState(this.settings.defaultEase, options.now);
    const present = Object.prototype.hasOwnProperty.call(this.srs, key), now = options.now ?? new Date();
    const after = schedule(before, grade, now, (deck ?? (effectiveDeckId ? this.getReviewDeck(effectiveDeckId) : undefined))?.maxInterval);
    const log: ReviewLog & { stateWasPresent: boolean; stateBefore?: CardState; pendingBefore?: ReviewPending } = {
      id: uid("review"), cardId: id, questionId: key, scopeId: options.scopeId, ...(effectiveDeckId && { deckId: effectiveDeckId }), rating: grade,
      reviewedAt: now.toISOString(), elapsedMs: Math.max(0, options.elapsedMs ?? 0), before, after: clone(after),
      cardSnapshot: clone(card), previousWrong: !!card.wrong, stateWasPresent: present, stateBefore: present ? clone(this.srs[key]) : undefined,
      initialization: !pendingBefore, pendingBefore: pendingBefore ? clone(pendingBefore) : undefined,
      commentText: pendingBefore ? options.commentText : undefined, drawing: pendingBefore && options.drawing ? clone(options.drawing) : undefined,
      algorithm: after.algorithm ?? "ts-fsrs",
    };
    this.srs[key] = after; this.reviewLogs.push(log);
    this.reviewPending = this.reviewPending.filter(p => p.questionId !== key);
    this.reviewPending.push({ id: uid("pending"), cardId: id, questionId: key, scopeId: options.scopeId, ...(effectiveDeckId && { deckId: effectiveDeckId }), due: after.due, queuedAt: now.toISOString() });
    if (deck && !deck.cardIds.includes(id)) deck.cardIds.push(id);
    card.wrong = this.cardHasWrongQuestion(card);
    if (pendingBefore) { const day = fmtDate(now); this.reviewHistory[day] = (this.reviewHistory[day] ?? 0) + 1; }
    this.save(); return after;
  }
  undoLastReview(): ReviewLog | undefined {
    const log = this.getLatestReviewLog(); if (!log) return undefined;
    const beforeCounts = effectiveReviewCounts(this.reviewLogs), eventId = reviewEventId(log), undoneAt = new Date().toISOString();
    for (const copy of this.reviewLogs.filter(l => reviewEventId(l) === eventId)) {
      const saved = copy as ReviewLog & { stateWasPresent?: boolean; stateBefore?: CardState; pendingBefore?: ReviewPending };
      if (saved.stateWasPresent === false) delete this.srs[copy.questionId]; else this.srs[copy.questionId] = clone(saved.stateBefore ?? copy.before);
      this.reviewPending = this.reviewPending.filter(p => p.questionId !== copy.questionId);
      if (saved.pendingBefore) this.reviewPending.push(clone(saved.pendingBefore));
      else if (!copy.initialization) this.reviewPending.push({ id: uid("pending-undo"), cardId: copy.cardId, questionId: copy.questionId, scopeId: copy.scopeId, ...(copy.deckId && { deckId: copy.deckId }), due: copy.before.due, queuedAt: copy.reviewedAt });
      const card = this.getCard(copy.cardId); if (card) card.wrong = copy.previousWrong;
      copy.undoneAt = undoneAt;
    }
    const afterCounts = effectiveReviewCounts(this.reviewLogs);
    for (const day of Object.keys(beforeCounts)) this.reviewHistory[day] = Math.max(0, (this.reviewHistory[day] ?? 0) - beforeCounts[day] + (afterCounts[day] ?? 0));
    this.save(); return log;
  }
  private cardHasWrongQuestion(card: Card): boolean {
    const latest = new Map<string, ReviewLog>();
    for (const log of this.reviewLogs) if (log.cardId === card.id && !log.undoneAt && !log.initialization) { const prior = latest.get(log.questionId); if (!prior || prior.reviewedAt <= log.reviewedAt) latest.set(log.questionId,log); }
    return [...latest.values()].some(log => log.rating === 1);
  }
  dueCards(): Card[] { const deck = this.reviewDeckForStudySet(); const ids = new Set((deck ? this.pendingQuestionsForDeck(deck.id) : this.pendingQuestions(this.activeCanvasId)).map(q => q.cardId)); return this.cardsForStudySet().filter(c => ids.has(c.id)); }
  upsertCardTemplate(template: CardTemplate): void { this.mutate("保存卡片模板", () => { const i = this.cardTemplates.findIndex(t => t.id === template.id); if (i < 0) this.cardTemplates.push(clone(template)); else this.cardTemplates[i] = clone(template); }); }
  removeCardTemplate(id: string): void { this.mutate("删除卡片模板", () => { this.cardTemplates = this.cardTemplates.filter(t => t.id !== id); }); }

  getDocMeta(path: string): DocMeta { return this.docMeta[path] ?? {}; }
  updateDocMeta(path: string, patch: Partial<DocMeta>): void { this.docMeta[path] = { ...this.getDocMeta(path), ...patch }; this.save(); }
  toggleFoldPage(path: string, page: number): void { const values = new Set(this.getDocMeta(path).foldedPages ?? []); values.has(page) ? values.delete(page) : values.add(page); this.updateDocMeta(path, { foldedPages: [...values].sort((a,b) => a-b) }); }
  toggleBookmark(path: string, page: number): void { const values = new Set(this.getDocMeta(path).bookmarks ?? []); values.has(page) ? values.delete(page) : values.add(page); this.updateDocMeta(path, { bookmarks: [...values].sort((a,b) => a-b) }); }
  registerDocument(path: string, sourceUrl?: string, bytes?: Uint8Array): DocumentRecord | undefined {
    if (!path) return undefined;
    let doc = this.documents.find(d => d.path === path);
    if (this.documentCommitPending && !this.documentCommitOwner && !this.transactionDepth) {
      if (doc && !doc.missing && !bytes && (!sourceUrl || sourceUrl === doc.sourceUrl)) return doc;
      throw new Error("文档操作正在保存，请稍后重试。");
    }
    if (!doc) { doc = { id: uid("doc"), path, kind: path.split(".").pop()?.toLowerCase() ?? "", createdAt: new Date().toISOString(), sourceUrl }; this.documents.push(doc); }
    if (sourceUrl) doc.sourceUrl = sourceUrl;
    if (bytes) Object.assign(doc, documentFingerprint(bytes));
    doc.missing = false;
    return doc;
  }
  /** Lazily fingerprint a source through the vault adapter while retaining its existing identity. */
  async refreshDocumentFingerprint(path: string): Promise<DocumentRecord | undefined> {
    const adapter = this.host.app.vault.adapter;
    if (!await adapter.exists(path)) return undefined;
    const fingerprint = documentFingerprint(await adapter.readBinary(path));
    const record = this.documents.find(doc => doc.path === path);
    if (record && record.sha256 === fingerprint.sha256 && record.byteSize === fingerprint.byteSize && !record.missing) return record;
    return this.mutate("更新来源指纹", () => {
      const target = this.registerDocument(path);
      if (target) Object.assign(target, fingerprint);
      return target;
    });
  }
  /** Candidates are ordered by vault path and match bytes exactly; names and timestamps never participate. */
  async findMatchingDocumentPaths(documentId: string): Promise<string[]> {
    const record = this.documents.find(item => item.id === documentId);
    if (!record?.sha256 || !Number.isSafeInteger(record.byteSize) || record.byteSize! < 0) return [];
    const adapter = this.host.app.vault.adapter as any, extension = record.kind.toLowerCase();
    const files = this.host.app.vault.getFiles().filter((file: any) => file.path !== record.path
      && !file.path.startsWith("MarginStudyBackups/") && !file.path.startsWith("_marginstudy-recovery/")
      && file.path.split("/").pop()?.toLowerCase().endsWith("." + extension));
    const matches: string[] = [];
    for (const file of files) {
      try {
        const stat = await adapter.stat?.(file.path);
        if (stat?.size != null && stat.size !== record.byteSize) continue;
        const bytes = await adapter.readBinary(file.path);
        if (bytes.byteLength === record.byteSize && sha(bytes) === record.sha256) matches.push(file.path);
      } catch { /* A disappearing or unreadable candidate is not evidence of identity. */ }
    }
    return matches.sort((a,b) => a.localeCompare(b));
  }
  findPotentialDocumentPaths(documentId: string): string[] {
    const record = this.documents.find(item => item.id === documentId);
    if (!record?.kind) return [];
    return this.host.app.vault.getFiles().filter((file: any) => !file.path.startsWith("MarginStudyBackups/")
      && !file.path.startsWith("_marginstudy-recovery/")
      && file.path.split("/").pop()?.toLowerCase().endsWith("." + record.kind.toLowerCase()))
      .map((file: any) => file.path).sort((a,b)=>a.localeCompare(b));
  }
  async backfillDocumentFingerprints(): Promise<void> {
    const adapter = this.host.app.vault.adapter;
    const updates = new Map<DocumentRecord, { path: string; fingerprint: ReturnType<typeof documentFingerprint> }>();
    for (const doc of this.documents) {
      if (doc.missing || hasDocumentFingerprint(doc)) continue;
      const path = doc.path;
      if (!await adapter.exists(path).catch(() => false)) continue;
      const bytes = await adapter.readBinary(path).catch(() => undefined);
      if (bytes) updates.set(doc, { path, fingerprint: documentFingerprint(bytes) });
    }
    const pending = this.documents.filter(doc => !doc.missing && !hasDocumentFingerprint(doc) && updates.get(doc)?.path === doc.path);
    if (pending.length) this.mutate("更新来源指纹", () => {
      for (const doc of pending) Object.assign(doc, updates.get(doc)!.fingerprint);
    });
  }
  /** Auto-relocate only a single byte-identical candidate; ambiguity remains explicit and untouched. */
  async recoverMissingDocuments(): Promise<{ recovered: { id: string; oldPath: string; newPath: string }[]; ambiguous: { id: string; oldPath: string; candidates: string[]; identicalCandidates: string[] }[] }> {
    const recovered: { id: string; oldPath: string; newPath: string }[] = [], ambiguous: { id: string; oldPath: string; candidates: string[]; identicalCandidates: string[] }[] = [];
    const adapter = this.host.app.vault.adapter;
    for (const doc of [...this.documents].filter(item => !!item.sha256 && Number.isSafeInteger(item.byteSize))) {
      // A move made while Obsidian or the plugin was offline has no delete event
      // to set `missing`. Reconcile the registered path against disk before
      // deciding whether this record needs exact-content recovery.
      if (!doc.missing && await adapter.exists(doc.path).catch(() => true)) continue;
      if (!doc.missing) this.markDocumentMissing(doc.path);
      const candidates = await this.findMatchingDocumentPaths(doc.id);
      if (candidates.length > 1) { ambiguous.push({ id: doc.id, oldPath: doc.path, candidates, identicalCandidates: candidates }); continue; }
      if (candidates.length === 0) {
        const potential = this.findPotentialDocumentPaths(doc.id);
        if (potential.length) ambiguous.push({ id: doc.id, oldPath: doc.path, candidates: potential, identicalCandidates: [] });
        continue;
      }
      const oldPath = doc.path, newPath = candidates[0];
      try { await this.renameDocument(oldPath, newPath); recovered.push({ id: doc.id, oldPath, newPath }); }
      catch (error) { ambiguous.push({ id: doc.id, oldPath, candidates: [newPath], identicalCandidates: [newPath] }); this.report("来源内容已找到，但目标关联存在冲突；原批注和恢复记录已保留。", error); }
      if (recovered.some(item => item.id === doc.id)) {
        this.recordLocalEvent("restored", [doc.id], "已自动重定位内容一致的来源文件：" + newPath); this.save();
        try { await this.flush(); } catch {}
      }
    }
    return { recovered, ambiguous };
  }
  async restoreDocumentAtPath(documentId: string, path: string, acceptChangedContent = false): Promise<void> {
    const doc = this.documents.find(item => item.id === documentId);
    if (!doc) throw new Error("原文档登记已不存在");
    const exact = (await this.findMatchingDocumentPaths(documentId)).includes(path);
    if (!exact && (!acceptChangedContent || !this.findPotentialDocumentPaths(documentId).includes(path))) throw new Error("候选文件内容已变化；需要明确选择后才可作为新版本接回");
    if (!exact) {
      const adapter = this.host.app.vault.adapter;
      const bytes = await adapter.readBinary(path);
      await this.writeRecovery("document-content-change", { document: clone(doc), selectedPath: path, selectedSha256: sha(bytes), selectedByteSize: bytes.byteLength, oldSidecarText: await adapter.exists(this.sidecarPath(doc.path)) ? await adapter.read(this.sidecarPath(doc.path)) : null });
    }
    await this.renameDocument(doc.path, path);
    if (!exact) await this.refreshDocumentFingerprint(path);
    this.recordLocalEvent("restored", [documentId], "已重定位缺失的来源文件：" + path); this.save();
    try { await this.flush(); } catch {}
  }
  async renameDocument(oldPath: string, newPath: string): Promise<void> {
    if (oldPath === newPath) return;
    await this.flush();
    const adapter = this.host.app.vault.adapter;
    const newPendingPath = this.pendingAnnotationsPath(newPath);
    const newTxPath = this.pendingMergeTxPath(newPath);
    const readJsonIfExists = async (filePath: string): Promise<{ path: string; raw: string; parsed: any } | null> => {
      if (!await adapter.exists(filePath)) return null;
      const raw = await adapter.read(filePath);
      try { return { path: filePath, raw, parsed: JSON.parse(raw) }; } catch { return { path: filePath, raw, parsed: null }; }
    };
    const findOwnedRecovery = async (candidates: string[], kind: "pending-annotations" | "merge-tx") => {
      for (const candidate of candidates) {
        const entry = await readJsonIfExists(candidate);
        if (!entry?.parsed || entry.parsed.docPath !== oldPath) continue;
        if (kind === "pending-annotations" && Array.isArray(entry.parsed.annotations)) return entry;
        if (kind === "merge-tx" && typeof entry.parsed.sidecarPath === "string") return entry;
      }
      return null;
    };
    const pendingAnnMigration = await findOwnedRecovery([this.pendingAnnotationsPath(oldPath), this.legacyPendingAnnotationsPath(oldPath)], "pending-annotations");
    const oldPendingPath = pendingAnnMigration?.path ?? this.pendingAnnotationsPath(oldPath);
    const pendingTxMigration = await findOwnedRecovery([this.pendingMergeTxPath(oldPath), this.legacyPendingMergeTxPath(oldPath)], "merge-tx");
    const oldTxPath = pendingTxMigration?.path ?? this.pendingMergeTxPath(oldPath);
    const oldPendingDigest = pendingAnnMigration ? this.pendingAnnotationsDigest(oldPath, pendingAnnMigration.parsed.annotations) : undefined;
    const oldTxDigest = pendingTxMigration ? this.pendingTxDigest(pendingTxMigration.parsed) : undefined;
    const hadNewPendingBefore = await adapter.exists(newPendingPath);
    const hadNewTxBefore = await adapter.exists(newTxPath);
    if (newPendingPath !== oldPendingPath && hadNewPendingBefore) {
      const existing = await readJsonIfExists(newPendingPath);
      if (existing?.parsed && typeof existing.parsed.docPath === "string" && existing.parsed.docPath !== oldPath && existing.parsed.docPath !== newPath) {
        throw new Error("目标路径存在其他文档的待保存恢复文件（哈希冲突），已保留原文件");
      }
    }
    if (pendingTxMigration && newTxPath !== oldTxPath && hadNewTxBefore) {
      const existing = await readJsonIfExists(newTxPath);
      if (existing?.parsed && typeof existing.parsed.docPath === "string" && existing.parsed.docPath !== oldPath && existing.parsed.docPath !== newPath) {
        throw new Error("目标路径存在其他文档的待恢复合并事务（哈希冲突），已保留原文件");
      }
    }
    const before = this.snapshot();
    let movedSidecar = false, originalSidecarText: string | null = null, preRewriteSidecarText: string | null = null, notifiedListeners = false;
    let wroteNewPending = false, writtenNewPendingDigest: string | undefined, writtenNewPendingWriterId: string | undefined;
    let supersededOldPending: string | null = null, wroteNewTx = false, writtenNewTxDigest: string | undefined, writtenNewTxId: string | undefined, supersededOldTx: string | null = null;
    let flushedNewAnns: Annotation[] | undefined;
    try {
    await this.enqueue(async () => {
      // Disk operations share the save queue; no flush can recreate a sidecar while it moves.
      await Promise.all([...this.annLoads.values()]);
      const oldSidecar = this.sidecarPath(oldPath), newSidecar = this.sidecarPath(newPath);
      if (await adapter.exists(oldSidecar)) {
        if (await adapter.exists(newSidecar)) throw new Error("目标路径已有批注，已保留两份文件，需先处理");
        originalSidecarText = await adapter.read(oldSidecar);
        const slash = newSidecar.lastIndexOf("/");
        if (slash > 0 && typeof adapter.mkdir === "function") {
          await this.ensureDir(newSidecar.slice(0, slash));
        }
        await adapter.rename(oldSidecar, newSidecar);
        movedSidecar = true;
      }
      const text = await adapter.exists(newSidecar) ? await adapter.read(newSidecar) : null;
      preRewriteSidecarText = originalSidecarText ?? text;
      const anns = this.annCache.get(oldPath) ?? (text !== null ? await this.loadAnnotations(newPath) : undefined);
      // Finish all I/O first. Cache, references and live readers then change in one synchronous step.
      this.mutate("移动文档", () => {
        for (const c of this.cards) { if (c.docPath === oldPath) c.docPath = newPath; for (const s of c.sources ?? []) if (s.docPath === oldPath) s.docPath = newPath; }
        for (const n of this.nodes) if (n.docPath === oldPath) n.docPath = newPath;
        for (const set of this.studySets) {
          set.docPaths = set.docPaths.map(p => p === oldPath ? newPath : p);
          if (set.documentAttachments) set.documentAttachments = Object.fromEntries(Object.entries(set.documentAttachments).map(([main, attachments]) => [main === oldPath ? newPath : main, attachments.map(path => path === oldPath ? newPath : path)]));
        }
        for (const doc of this.documents) if (doc.path === oldPath) { doc.path = newPath; doc.missing = false; }
        for (const canvas of this.canvases) if (canvas.lastDocumentPath === oldPath) canvas.lastDocumentPath = newPath;
        if (this.workspaceState) {
          if (this.workspaceState.activePath === oldPath) this.workspaceState.activePath = newPath;
          if (Array.isArray(this.workspaceState.tabs)) for (const tab of this.workspaceState.tabs) if (tab?.path === oldPath) {
            tab.path = newPath;
            if (tab.state && typeof tab.state === "object") { tab.state.filePath = newPath; if (tab.state.file === oldPath) tab.state.file = newPath; }
          }
        }
        if (this.docMeta[oldPath]) {
          const movedMeta = this.docMeta[oldPath];
          if (Array.isArray(movedMeta.unbindEventKeys)) {
            const oldPrefix = `${oldPath}\u0000`, newPrefix = `${newPath}\u0000`;
            movedMeta.unbindEventKeys = movedMeta.unbindEventKeys.map(key => key.startsWith(oldPrefix) ? newPrefix + key.slice(oldPrefix.length) : key);
          }
          this.docMeta[newPath] = movedMeta;
          delete this.docMeta[oldPath];
        }
      });
      if (anns) {
        this.annCache.delete(oldPath); this.annBase.delete(oldPath); this.annDirty.delete(oldPath);
        this.bumpAnnotationsRevision(oldPath);
        this.annCache.set(newPath, anns); this.annBase.set(newPath, text);
        for (const annotation of anns) annotation.docPath = newPath;
        flushedNewAnns = clone(anns);
        this.saveAnnotationsDebounced(newPath, anns);
      }
      notifiedListeners = true;
      for (const listener of this.documentRenameListeners) {
        try { listener(oldPath, newPath); } catch (error) { console.error(error); }
      }
    });
    await this.flush();
    if (flushedNewAnns) {
      writtenNewPendingDigest = this.pendingAnnotationsDigest(newPath, flushedNewAnns);
      writtenNewPendingWriterId = "device-rolling-000001";
    }
    if (pendingAnnMigration) {
      const migratedAnns = (pendingAnnMigration.parsed.annotations as Annotation[]).map(ann =>
        ann && typeof ann === "object" && ann.docPath === oldPath ? { ...ann, docPath: newPath } : ann
      );
      const expectedDigest = this.pendingAnnotationsDigest(newPath, migratedAnns);
      const migratedWriterId = typeof pendingAnnMigration.parsed.writerId === "string" && pendingAnnMigration.parsed.writerId
        ? pendingAnnMigration.parsed.writerId : "device-rolling-000001";
      const migratedPending = {
        ...clone(pendingAnnMigration.parsed),
        txId: typeof pendingAnnMigration.parsed.txId === "string" && pendingAnnMigration.parsed.txId ? pendingAnnMigration.parsed.txId : uid("pending"),
        docPath: newPath,
        writerId: migratedWriterId,
        annotations: migratedAnns,
        contentDigest: expectedDigest,
      };
      await this.ensureDir("_marginstudy-recovery");
      await adapter.write(newPendingPath, JSON.stringify(migratedPending));
      wroteNewPending = true;
      writtenNewPendingDigest = expectedDigest;
      writtenNewPendingWriterId = migratedWriterId;
      const verified = JSON.parse(await adapter.read(newPendingPath));
      const actualDigest = verified && typeof verified.docPath === "string" && Array.isArray(verified.annotations)
        ? this.pendingAnnotationsDigest(verified.docPath, verified.annotations) : "";
      if (!verified || verified.docPath !== newPath || verified.contentDigest !== expectedDigest || actualDigest !== expectedDigest) {
        throw new Error("迁移待保存恢复文件摘要校验失败，已保留原文件");
      }
      if (newPendingPath !== oldPendingPath && await adapter.exists(oldPendingPath)) {
        supersededOldPending = await this.supersedeRecoveryFile(oldPendingPath, newPendingPath, expectedDigest);
      }
    }
    if (pendingTxMigration) {
      const oldPrefix = `${oldPath}\u0000`, newPrefix = `${newPath}\u0000`;
      const oldSidecarStr = this.sidecarPath(oldPath), newSidecarStr = this.sidecarPath(newPath);
      const currentNewSidecarText = await adapter.exists(newSidecarStr) ? await adapter.read(newSidecarStr) : null;
      const migratedTxBase = {
        ...clone(pendingTxMigration.parsed),
        docPath: newPath,
        sidecarPath: pendingTxMigration.parsed.sidecarPath === oldSidecarStr ? newSidecarStr : pendingTxMigration.parsed.sidecarPath,
        expectedSidecarHash: preRewriteSidecarText !== null && currentNewSidecarText !== null && pendingTxMigration.parsed.expectedSidecarHash === sha(preRewriteSidecarText)
          ? sha(currentNewSidecarText)
          : pendingTxMigration.parsed.expectedSidecarHash,
        unbindEvents: Array.isArray(pendingTxMigration.parsed.unbindEvents)
          ? pendingTxMigration.parsed.unbindEvents.map((ev: any) =>
              ev && typeof ev === "object" && typeof ev.dedupeKey === "string" && ev.dedupeKey.startsWith(oldPrefix)
                ? { ...ev, dedupeKey: newPrefix + ev.dedupeKey.slice(oldPrefix.length) }
                : ev
            )
          : pendingTxMigration.parsed.unbindEvents,
      };
      const expectedTxDigest = this.pendingTxDigest(migratedTxBase);
      const migratedTx = { ...migratedTxBase, contentDigest: expectedTxDigest };
      await this.ensureDir("_marginstudy-recovery");
      await adapter.write(newTxPath, JSON.stringify(migratedTx));
      wroteNewTx = true;
      writtenNewTxDigest = expectedTxDigest;
      writtenNewTxId = typeof migratedTx.txId === "string" ? migratedTx.txId : undefined;
      const verifiedTx = JSON.parse(await adapter.read(newTxPath));
      const actualTxDigest = verifiedTx && typeof verifiedTx.docPath === "string" && typeof verifiedTx.sidecarPath === "string"
        ? this.pendingTxDigest(verifiedTx) : "";
      if (!verifiedTx || verifiedTx.docPath !== newPath || verifiedTx.sidecarPath !== migratedTx.sidecarPath ||
        verifiedTx.contentDigest !== expectedTxDigest || actualTxDigest !== expectedTxDigest) {
        throw new Error("迁移待恢复合并事务摘要校验失败，已保留原文件");
      }
      if (newTxPath !== oldTxPath && await adapter.exists(oldTxPath)) {
        supersededOldTx = await this.supersedeRecoveryFile(oldTxPath, newTxPath, expectedTxDigest);
      }
    }
    } catch (error) {
      try { await this.writeRecovery("document-migration-failed", { oldPath, newPath, error: String(error), snapshot: before, oldSidecar: this.sidecarPath(oldPath), oldSidecarText: originalSidecarText, newSidecar: this.sidecarPath(newPath) }); } catch { /* retain the original error */ }
      try {
        const from = this.sidecarPath(newPath), to = this.sidecarPath(oldPath);
        if (movedSidecar) {
          if (await adapter.exists(from)) {
            if (!await adapter.exists(to)) await adapter.rename(from, to);
            else if (typeof adapter.remove === "function") await adapter.remove(from);
          }
          if (originalSidecarText !== null) await adapter.write(to, originalSidecarText);
        } else if (preRewriteSidecarText !== null && await adapter.exists(from)) {
          // Host (e.g. TFolder) had already moved the sidecar before renameDocument; restore its pre-rewrite bytes.
          await adapter.write(from, preRewriteSidecarText);
        }
        const oldPendingWriterId = typeof pendingAnnMigration?.parsed?.writerId === "string" ? pendingAnnMigration.parsed.writerId : "device-rolling-000001";
        const oldTxId = typeof pendingTxMigration?.parsed?.txId === "string" ? pendingTxMigration.parsed.txId : undefined;
        if (supersededOldPending && await adapter.exists(supersededOldPending)) {
          if (!await adapter.exists(oldPendingPath)) await adapter.rename(supersededOldPending, oldPendingPath);
          else await this.deleteRecoveryIfProved("rollback-artifact", supersededOldPending, {
            expectedDocPath: oldPath, expectedWriterId: oldPendingWriterId,
            expectedArtifactDigest: oldPendingDigest, expectedArtifactKind: "pending-annotations",
            expectedRestoredPath: oldPendingPath, expectedRestoredDigest: oldPendingDigest, restoredKind: "pending-annotations",
          });
        }
        if (pendingAnnMigration && (supersededOldPending || newPendingPath === oldPendingPath)) {
          await adapter.write(oldPendingPath, pendingAnnMigration.raw);
        }
        if (newPendingPath !== oldPendingPath && (wroteNewPending || (!hadNewPendingBefore && !!writtenNewPendingDigest)) && await adapter.exists(newPendingPath)) {
          await this.deleteRecoveryIfProved("rollback-artifact", newPendingPath, {
            expectedDocPath: newPath, expectedWriterId: writtenNewPendingWriterId,
            expectedArtifactDigest: writtenNewPendingDigest, expectedArtifactKind: "pending-annotations",
            ...(pendingAnnMigration ? { expectedRestoredPath: oldPendingPath, expectedRestoredDigest: oldPendingDigest, restoredKind: "pending-annotations" as const } : {}),
          });
        }
        if (supersededOldTx && await adapter.exists(supersededOldTx)) {
          if (!await adapter.exists(oldTxPath)) await adapter.rename(supersededOldTx, oldTxPath);
          else await this.deleteRecoveryIfProved("rollback-artifact", supersededOldTx, {
            expectedDocPath: oldPath, expectedTxId: oldTxId,
            expectedArtifactDigest: oldTxDigest, expectedArtifactKind: "merge-tx",
            expectedRestoredPath: oldTxPath, expectedRestoredDigest: oldTxDigest, restoredKind: "merge-tx",
          });
        }
        if (pendingTxMigration && (supersededOldTx || newTxPath === oldTxPath)) {
          await adapter.write(oldTxPath, pendingTxMigration.raw);
        }
        if (newTxPath !== oldTxPath && wroteNewTx && await adapter.exists(newTxPath)) {
          await this.deleteRecoveryIfProved("rollback-artifact", newTxPath, {
            expectedDocPath: newPath, expectedTxId: writtenNewTxId,
            expectedArtifactDigest: writtenNewTxDigest, expectedArtifactKind: "merge-tx",
            ...(pendingTxMigration ? { expectedRestoredPath: oldTxPath, expectedRestoredDigest: oldTxDigest, restoredKind: "merge-tx" as const } : {}),
          });
        }
        this.annCache.delete(newPath); this.bumpAnnotationsRevision(newPath); this.annBase.delete(newPath); this.annDirty.delete(newPath); this.annBlocked.delete(newPath);
        this.annCache.delete(oldPath); this.bumpAnnotationsRevision(oldPath); this.annBase.delete(oldPath); this.annDirty.delete(oldPath); this.annBlocked.delete(oldPath);
        for (const [path, annotations] of before.annotations) { this.annCache.set(path, clone(annotations)); this.bumpAnnotationsRevision(path); this.annBase.set(path, await adapter.exists(this.sidecarPath(path)) ? await adapter.read(this.sidecarPath(path)) : null); }
      } catch { /* recovery record above describes the partial migration */ }
      this.restoreSnapshot(before);
      // Avoid redundant sidecar rewrites during rollback flush; persist rolled-back main data durably so cold restart has no split-brain.
      for (const [path] of before.annotations) this.annDirty.delete(path);
      this.annDirty.delete(newPath);
      this.mainDirty = true; this.mainVersion++;
      try { await this.flush(); } catch { /* retain original migration error */ }
      if (notifiedListeners) {
        for (const listener of this.documentRenameListeners) {
          try { listener(newPath, oldPath); } catch (rollbackError) { console.error(rollbackError); }
        }
      }
      throw error;
    }
  }
  markDocumentMissing(path: string): void {
    // A delete notification for an unrelated/transient file must not add it to the library.
    const doc = this.documents.find(d => d.path === path);
    if (!doc || doc.missing) return;
    doc.missing = true; this.recordLocalEvent("file-missing", [doc.id], "来源文件缺失：" + path); this.save();
  }

  private detachBackupSources(data: Partial<PluginData>): SkippedSource[] {
    const skipped: SkippedSource[] = [];
    const detachPath = (path: string): string => {
      if (!isBackupInternalPath(path)) return path;
      safePath(path);
      return "";
    };
    if (data.documents) data.documents = data.documents.filter(doc => {
      if (detachPath(doc.path) === doc.path) return true;
      skipped.push({ id: doc.id, detail: "已跳过备份或恢复目录中的文档登记：" + doc.path });
      return false;
    });
    const internalCardPaths = new Map<string, string[]>();
    for (const card of cardsIncludingMembers(data.cards ?? [])) {
      const paths = [...new Set([
        card.docPath,
        ...(card.sources ?? []).map(source => source.docPath),
        ...(card.excerptBlocks ?? []).flatMap(block => block.source ? [block.source.docPath] : []),
      ].filter(isBackupInternalPath))];
      if (!paths.length) continue;
      internalCardPaths.set(card.id, this.sources(card).map(source => source.docPath).filter(isBackupInternalPath));
      card.docPath = detachPath(card.docPath);
      for (const source of card.sources ?? []) source.docPath = detachPath(source.docPath);
      for (const block of card.excerptBlocks ?? []) if (block.source) block.source.docPath = detachPath(block.source.docPath);
      skipped.push({ id: card.id, detail: `${detachedSourceDetail}：${paths.join("、")}` });
    }
    for (const set of data.studySets ?? []) {
      const removed = new Set(set.docPaths.filter(isBackupInternalPath));
      if (!removed.size) continue;
      set.docPaths = set.docPaths.filter(path => detachPath(path) === path);
      const canvases = new Set((data.canvases ?? []).filter(canvas => canvas.studySetId === set.id).map(canvas => canvas.id));
      const linkedCards = new Set((data.nodes ?? []).filter(node => node.canvasId && canvases.has(node.canvasId)).map(node => node.cardId));
      for (const card of data.cards ?? []) {
        if (!internalCardPaths.get(card.id)?.some(path => removed.has(path))) continue;
        if (set.cardIds?.includes(card.id) || linkedCards.has(card.id) || this.sources(card).some(source => set.docPaths.includes(source.docPath))) continue;
        (set.cardIds ??= []).push(card.id);
      }
    }
    return skipped;
  }

  private recordSkippedSources(skipped: SkippedSource[]): void {
    for (const { id, detail } of skipped) {
      if (!this.localEvents.some(event => event.kind === "file-missing" && event.detail === detail && event.objectIds.includes(id))) {
        this.recordLocalEvent("file-missing", [id], detail);
      }
    }
  }

  hasDetachedInternalSource(card: Card): boolean {
    return !card.docPath && !card.sources?.some(source => source.docPath) && this.localEvents.some(event =>
      event.kind === "file-missing" && event.detail.startsWith(detachedSourceDetail) && event.objectIds.includes(card.id));
  }

  /** A self-contained backup includes source documents, annotations and recordings. */
  async backupData(silent = false, includePending = false): Promise<string> {
    try {
      if (!includePending) await this.flush();
      await clearAbandonedMigrationBackups(this.host.app);
      const data = this.data();
      this.recordSkippedSources(this.detachBackupSources(data));
      data.localEvents = clone(this.localEvents);
      const dir = `${BACKUP_ROOT}/${new Date().toISOString().replace(/[:.]/g, "-")}-${uid("backup")}`;
      const { path, manifest } = await this.writeBackup(data, JSON.stringify(data, null, 2), includePending, dir);
      const missing = manifest.missingFiles?.length ?? 0;
      if (!silent) new Notice("备份已保存：" + path + (missing ? `（${missing} 个来源文件原本已缺失，清单已记录）` : ""));
      return path;
    } catch (e) { this.report("备份失败，本次未记为成功",e); return ""; }
  }

  private async writeBackup(data: Partial<PluginData>, dataText: string, includePending: boolean, dir: string, migration = false): Promise<{ path: string; manifest: BackupManifest }> {
    const vault = this.host.app.vault, adapter = vault.adapter;
    const paths = new Set<string>();
    for (const card of data.cards ?? []) for (const source of this.sources(card)) paths.add(source.docPath);
    for (const set of data.studySets ?? []) for (const path of set.docPaths) paths.add(path);
    for (const doc of data.documents ?? []) if (!doc.missing) paths.add(doc.path);
    const isBackupAsset = (path: string) => !isBackupInternalPath(path)
      && (path.endsWith(".mstudy.json") || path.startsWith("_marginstudy-audio/") || path.startsWith("_marginstudy-imports/") || path.startsWith("_marginstudy-media/"));
    for (const file of vault.getFiles()) if (isBackupAsset(file.path)) paths.add(file.path);
    if (migration && this.host.manifest?.dir) {
      const folders = [""];
      const excluded = new Set([vault.configDir, ".obsidian", ".git", ".trash", BACKUP_ROOT, "_marginstudy-recovery"]);
      for (const folder of folders) {
        const entries = await adapter.list(folder);
        for (const path of entries.files) if (isBackupAsset(path)) paths.add(path);
        for (const path of entries.folders) if (!excluded.has(path)) folders.push(path);
      }
    }
    if (includePending) for (const path of this.annCache.keys()) paths.add(this.sidecarPath(path));
    for (const path of paths) {
      safePath(path);
      if (isBackupInternalPath(path)) paths.delete(path);
      else if (!path.endsWith(".mstudy.json") && await adapter.exists(this.sidecarPath(path))) paths.add(this.sidecarPath(path));
    }
    await this.ensureDir(dir + "/files");
    const dataPath = dir + "/data.json";
    // 迁移备份以升级前原字节作为回滚依据。来源登记只在读取副本时解除。
    await adapter.write(dataPath, dataText);
    const files: BackupFile[] = [], missingFiles: string[] = [];
    for (const path of paths) {
      const cached = path.endsWith(".mstudy.json") ? this.annCache.get(path.slice(0,-".mstudy.json".length)) : undefined;
      if (!await adapter.exists(path) && !(includePending && cached)) {
        if (migration && isBackupAsset(path)) throw new Error("升级前备份期间文件已移动：" + path);
        missingFiles.push(path);
        continue;
      }
      const content = includePending && cached ? new TextEncoder().encode(JSON.stringify({ schemaVersion: SIDECAR_SCHEMA_VERSION, annotations: cached }, null, 2)).buffer : await adapter.readBinary(path);
      const storedPath = "files/" + path, destination = dir + "/" + storedPath;
      await this.ensureDir(destination.slice(0, destination.lastIndexOf("/")));
      await adapter.writeBinary(destination, content);
      const sha256 = sha(content);
      files.push({ path, storedPath, sha256, bytes: content.byteLength });
    }
    const manifest: BackupManifest = { format: "margin-study-backup", version: 2, createdAt: new Date().toISOString(), dataSha256: sha(dataText), files, missingFiles };
    const path = dir + "/manifest.json", manifestText = JSON.stringify(manifest, null, 2);
    await adapter.write(path, manifestText);
    return { path, manifest };
  }

  async listBackupPaths(): Promise<string[]> {
    const vault = this.host.app.vault;
    const paths = vault.getFiles().map(file => file.path).filter(path => path.startsWith(`${BACKUP_ROOT}/`) &&
      path.endsWith("/manifest.json") && !isStagedMigrationBackup(path) && !isMigrationBackup(path));
    for (const path of await migrationBackupPaths(vault.adapter)) {
      try { await this.readBackup(path, false); }
      catch { continue; }
      paths.push(path);
    }
    return paths.sort((left, right) => right.localeCompare(left));
  }

  private async readBackup(manifestPath: string, collectObjects: boolean): Promise<{ manifest: BackupManifest; objects: ProtectedObject[] }> {
    const adapter = this.host.app.vault.adapter;
    safePath(manifestPath);
    if (!manifestPath.startsWith(`${BACKUP_ROOT}/`) || !manifestPath.endsWith("/manifest.json")) throw new Error("不是有效的备份清单路径");
    const root = manifestPath.slice(0, manifestPath.lastIndexOf("/"));
    const manifest = JSON.parse(await adapter.read(manifestPath)) as BackupManifest;
    if (manifest.format !== "margin-study-backup" || manifest.version !== 2 || !Array.isArray(manifest.files)) throw new Error("备份清单格式不支持");
    const dataText = await adapter.read(root + "/data.json");
    if (sha(dataText) !== manifest.dataSha256) throw new Error("主数据校验失败");
    const parsed = JSON.parse(dataText);
    // 5.0.2：备份里若出现重复卡片编号，先修复再校验，避免整包恢复失败。
    const repaired = repairDuplicateIds(parsed);
    const data = repaired.data;
    if (collectObjects && repaired.repaired.length) this.recordLocalEvent("restored", repaired.repaired.map(entry => entry.id), "备份含重复 ID，已修复 " + repaired.repaired.length + " 组：" + repaired.repaired.map(entry => `${entry.collection}/${entry.id}(${entry.strategy})`).join("、"));
    this.validateData(data);
    const seen = new Set<string>(), skipped: string[] = [], annotations: ProtectedObject[] = [];
    for (const item of manifest.files) {
      const path = safePath(item.path), storedPath = safePath(item.storedPath);
      if (!storedPath.startsWith("files/") || seen.has(path)) throw new Error("备份含重复或不允许的文件路径");
      seen.add(path);
      const bytes = await adapter.readBinary(root + "/" + storedPath);
      if (sha(bytes) !== item.sha256 || bytes.byteLength !== item.bytes) throw new Error("文件校验失败：" + path);
      if (isBackupInternalPath(path)) {
        skipped.push(path);
        continue;
      }
      if (path.endsWith(".mstudy.json")) {
        const sidecar = JSON.parse(new TextDecoder().decode(bytes)); validateAnnotationCollection(sidecar?.annotations);
        if (collectObjects) annotations.push(...protectedAnnotations(path.slice(0, -".mstudy.json".length), sidecar.annotations));
      }
    }
    if (skipped.length) console.info("MarginStudy: 已跳过历史备份中的内部路径", manifestPath, skipped);
    const detached = this.detachBackupSources(data);
    if (detached.length) console.info("MarginStudy: 已跳过历史备份中的内部来源登记", manifestPath, detached);
    if (collectObjects) this.recordSkippedSources(detached);
    const objects = collectObjects ? [...protectedObjects(data), ...annotations] : [];
    return { manifest, objects };
  }

  async prepareBackupRecovery(manifestPath: string): Promise<ProtectionSnapshotInfo> {
    if (isStagedMigrationBackup(manifestPath)) throw new Error("升级备份尚未发布");
    const { objects } = await this.readBackup(manifestPath, true);
    return this.createProtectionSnapshot("从完整备份选择对象：" + manifestPath, objects);
  }

  async restoreBackup(manifestPath: string, objectIds?: string[]): Promise<void> {
    if (!objectIds?.length) throw new Error("整库覆盖恢复已停用；请先选择要恢复的对象。");
    const snapshot = await this.prepareBackupRecovery(manifestPath);
    await this.restoreProtectionSnapshot(snapshot.path, objectIds);
  }

}

function uniqueSources(sources: CardSource[]): CardSource[] { const seen = new Set<string>(); return sources.filter(s => { const key = [s.docPath,s.anchorAnnId ?? "",s.page ?? "",s.text ?? "",s.image ?? ""].join("\u0000"); if (seen.has(key)) return false; seen.add(key); return true; }); }
