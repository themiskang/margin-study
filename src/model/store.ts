import { App, TFile, Notice } from "obsidian";
import { sha256Hex } from "../utils/sha256";
import {
  Annotation, Card, CardState, DEFAULT_HANDWRITING_PRESETS, DEFAULT_SETTINGS, DocMeta, Edge,
  MarginStudySettings, MindNode, PluginData, StudySet, MindCanvas,
  MindmapFragment, PasteOptions, CardSource, DocumentRecord, ReviewDeck, HandwritingPresetSpec, StudySceneId, StudySceneSelection, StudySceneTemplate,
} from "../types";
import { freshState, schedule, todayStr, normalizeState, isDue, fmtDate } from "../srs";
import type { ReviewLog, ReviewPending, CardTemplate, GradeOptions, ReviewDeckSummary } from "../review/contracts";
import { uid } from "../utils/id";
import { questionsForCard, ReviewQuestion } from "../review/questions";
import { mergePreservingVersions, reviewEventId, effectiveReviewCounts } from "./conflicts";
import { cardsIncludingMembers, coalesceReviewPending, reviewPendingForData } from "./reviewPending";
import { togglePlainCloze } from "../utils/markdown";
import { reviewDecksForData } from "./reviewDecks";
import { validateAnnotationCollection } from "./annotationValidation";
import { mindmapHasHandwriting, normalizeMindmapHandwriting } from "../mindmap/handwritingContracts";
import { clampHandwritingWidth } from "../annot/handwritingPresets";
import { builtinSceneTemplates, defaultStudyScene, isSupportedSceneTemplate } from "../workspace/scenes";
import { syncCardColor } from "./cardColors";
import { editedExcerptBlocks } from "../cards/excerptBlocks";

interface StoreHost {
  app: App;
  loadData(): Promise<any>;
  saveData(data: any): Promise<void>;
}
type LibrarySnapshot = { data: PluginData; annotations: [string, Annotation[]][] };
type HistoryEntry = { label: string; before: LibrarySnapshot; after: LibrarySnapshot } | { label: string; nodeMove: { id: string; before: {x:number;y:number}; after: {x:number;y:number} } };
type BackupFile = { path: string; storedPath: string; sha256: string; bytes: number };
type BackupManifest = { format: "margin-study-backup"; version: 2; createdAt: string; dataSha256: string; files: BackupFile[]; missingFiles?: string[] };
const clone = <T>(value: T): T => value == null ? value : JSON.parse(JSON.stringify(value));
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const sha = (data: string | ArrayBuffer): string => sha256Hex(data);
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
  private queue: Promise<void> = Promise.resolve();
  private annCache = new Map<string, Annotation[]>();
  private annLoads = new Map<string, Promise<Annotation[]>>();
  private annBase = new Map<string, string | null>();
  private annDirty = new Map<string, number>();
  private annBlocked = new Set<string>();
  private jobs = new Set<Promise<unknown>>();
  private loadBlocked = false;
  private listeners = new Set<() => void>();
  private navigationListeners = new Set<(event: { canvasId: string; documentPath?: string }) => void>();
  private documentRenameListeners = new Set<(oldPath: string, newPath: string) => void>();
  private annListeners = new Map<string, Set<() => void>>();
  private notificationPending = false;
  private history: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private libraryHistoryRevision = 0;
  private transactionDepth = 0;
  private pendingConflict: { local: PluginData; remote: PluginData } | null = null;
  private restoring = false;

  constructor(host: StoreHost) { this.host = host; }

  async load(): Promise<void> {
    let data: any;
    try {
      data = await this.host.loadData();
      if (data != null) this.validateData(data);
    } catch (error) {
      this.loadBlocked = true;
      this.report("主数据读取失败，已暂停写入以保留原文件。可从备份恢复。", error);
      throw error;
    }
    this.baseline = clone(data);
    this.applyData(data ?? {});
  }

  private validateData(data: any): asserts data is PluginData {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("数据必须是对象");
    if (data.schemaVersion != null && (!Number.isInteger(data.schemaVersion) || data.schemaVersion > 2)) throw new Error("数据来自较新版本，请先更新插件");
    for (const key of ["cards", "nodes", "edges", "studySets", "canvases", "reviewLogs", "reviewPending", "reviewDecks", "cardTemplates", "documents"]) {
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
      if (c.handwriting !== undefined) {
        const handwriting = normalizeMindmapHandwriting(c.handwriting);
        if (!handwriting) throw new Error("脑图手写格式或版本不支持");
        c.handwriting = handwriting;
      }
    }
    for (const deck of data.reviewDecks ?? []) if (typeof deck.name !== "string" || !Array.isArray(deck.cardIds) || deck.cardIds.some((id: unknown) => typeof id !== "string") || !Array.isArray(deck.studySetIds) || deck.studySetIds.some((id: unknown) => typeof id !== "string")) throw new Error("复习卡组格式无效");
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
    this.workspaceState = data.workspaceState ? clone(data.workspaceState) : undefined;
    this.revision = data.revision ?? 0;
    this.repairGraph();
  }

  private data(): PluginData {
    return clone({ schemaVersion: 2, revision: this.revision, writerId: this.writerId,
      settings: this.settings, cards: this.cards, nodes: this.nodes, edges: this.edges,
      srs: this.srs, docMeta: this.docMeta, reviewHistory: this.reviewHistory,
      reviewLogs: this.reviewLogs, reviewPending: this.reviewPending, cardTemplates: this.cardTemplates,
      reviewDecks: this.reviewDecks, activeReviewDeckId: this.activeReviewDeckId,
      ...(this.sceneTemplates !== undefined ? { sceneTemplates: this.sceneTemplates } : {}),
      studySets: this.studySets, canvases: this.canvases,
      activeStudySetId: this.activeStudySetId, activeCanvasId: this.activeCanvasId,
      documents: this.documents,
      workspaceState: this.workspaceState,
    });
  }

  getWorkspaceState(): Record<string, unknown> | undefined { return clone(this.workspaceState); }
  getSceneTemplates(): StudySceneTemplate[] {
    const builtins = builtinSceneTemplates(), ids = new Set(builtins.map(template => template.id));
    const personal = Array.isArray(this.sceneTemplates) ? this.sceneTemplates.filter(template => {
      if (!isSupportedSceneTemplate(template) || ids.has(template.id)) return false;
      ids.add(template.id); return true;
    }) : [];
    return [...builtins, ...clone(personal)];
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
  exportSceneTemplate(templateId: string): string {
    const template = this.getSceneTemplates().find(item => item.id === templateId);
    if (!template) throw new Error("场景模板不存在");
    return JSON.stringify({ format: "margin-study-scene-template", version: 1, template }, null, 2);
  }
  importSceneTemplate(text: string): StudySceneTemplate {
    let document: any;
    try { document = JSON.parse(text); } catch { throw new Error("模板 JSON 无效"); }
    if (!document || document.format !== "margin-study-scene-template" || document.version !== 1 || !isSupportedSceneTemplate(document.template)) throw new Error("模板版本或内容无效");
    const template: StudySceneTemplate = clone(document.template);
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

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  subscribeNavigation(listener: (event: { canvasId: string; documentPath?: string }) => void): () => void { this.navigationListeners.add(listener); return () => this.navigationListeners.delete(listener); }
  subscribeDocumentRename(listener: (oldPath: string, newPath: string) => void): () => void {
    this.documentRenameListeners.add(listener); return () => this.documentRenameListeners.delete(listener);
  }
  subscribeAnnotations(path: string, listener: () => void): () => void {
    const listeners = this.annListeners.get(path) ?? new Set();
    listeners.add(listener); this.annListeners.set(path, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.annListeners.delete(path); };
  }
  private changed(): void {
    if (this.notificationPending) return;
    this.notificationPending = true;
    queueMicrotask(() => { this.notificationPending = false; for (const f of this.listeners) { try { f(); } catch (e) { console.error(e); } } });
  }
  private annotationsChanged(path: string): void {
    for (const f of this.annListeners.get(path) ?? []) { try { f(); } catch (e) { console.error(e); } }
  }
  private report(message: string, error: unknown): void {
    this.lastSaveError = message + " " + String(error);
    console.error("MarginStudy:", message, error);
    new Notice(this.lastSaveError, 12000);
  }
  private track<T>(job: Promise<T>): void { this.jobs.add(job); void job.catch(e => this.report("关联数据保存失败", e)).finally(() => this.jobs.delete(job)); }
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.queue.then(fn);
    this.queue = job.then(() => {}, () => {});
    return job;
  }
  private scheduleFlush(): void {
    if (this.restoring) return;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.flush().catch(() => {}); }, 150);
  }
  save(): void { this.mainDirty = true; this.mainVersion++; this.changed(); this.scheduleFlush(); }

  /** Flush includes edits arriving while an earlier disk write is in progress. */
  async flush(): Promise<void> {
    if (this.saveTimer !== null) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.jobs.size) await Promise.allSettled([...this.jobs]);
    await this.enqueue(async () => {
      try {
        if (this.loadBlocked) throw new Error("主数据未成功读取，写入已锁定");
        // Commit source sidecars first; main cards must never claim an unwritten source.
        while (this.annDirty.size || this.mainDirty) {
          for (const path of [...this.annDirty.keys()]) await this.persistAnnotations(path);
          if (this.mainDirty) await this.persistMain();
        }
        this.lastSaveError = null;
      } catch (e) { this.report("尚有修改未保存；原文件已保留，请重试保存或处理冲突。", e); throw e; }
    });
  }

  private async persistMain(): Promise<void> {
    return withSharedCommitLock(this.host.app.vault.adapter, async () => {
    const version = this.mainVersion;
    const local = this.data();
    const disk = await this.host.loadData();
    if (!same(disk, this.baseline)) {
      if (disk != null) this.validateData(disk);
      // Preserve both versions before stopping. Choosing a winner is an explicit user action.
      const path = await this.writeRecovery("main-conflict", { local, remote: disk, baseline: this.baseline });
      this.pendingConflict = { local, remote: disk ?? {} as PluginData };
      this.conflictPath = path;
      throw new Error("发现外部修改。两份版本已保存到 " + path + "；请运行「处理保存冲突」。");
    }
    local.revision = this.revision + 1;
    local.savedAt = new Date().toISOString();
    await this.writeRecovery("pending-main", local, true);
    await this.host.saveData(local);
    this.baseline = clone(local);
    this.revision = local.revision;
    if (this.mainVersion === version) this.mainDirty = false;
    });
  }

  /** Resolve only after the UI presents the retained versions. */
  async resolveDataConflict(strategy: "local" | "remote" | "merge"): Promise<void> {
    if (!this.pendingConflict) return;
    await this.enqueue(async () => {
      const remote = await this.host.loadData();
      if (remote != null) this.validateData(remote);
      const current = this.data();
      const resolved = strategy === "remote" ? remote ?? {} : strategy === "local" ? current : mergePreservingVersions(current, remote ?? {});
      this.baseline = clone(remote);
      this.applyData(resolved);
      this.pendingConflict = null;
      this.conflictPath = null;
      this.mainDirty = true; this.mainVersion++;
      await this.persistMain();
      this.changed();
    });
  }

  private async ensureDir(path: string): Promise<void> {
    const adapter = this.host.app.vault.adapter;
    let current = "";
    for (const part of safePath(path).split("/")) { current = current ? current + "/" + part : part; if (!await adapter.exists(current)) await adapter.mkdir(current); }
  }
  private async writeRecovery(label: string, payload: unknown, rolling = false): Promise<string> {
    const dir = "_marginstudy-recovery";
    await this.ensureDir(dir);
    const path = `${dir}/${label}-${rolling ? this.writerId : uid("snapshot")}.json`;
    await this.host.app.vault.adapter.write(path, JSON.stringify(payload, null, 2));
    return path;
  }

  sidecarPath(path: string): string { return path + ".mstudy.json"; }
  async loadAnnotations(path: string): Promise<Annotation[]> {
    if (this.annCache.has(path)) return this.annCache.get(path)!;
    if (this.annLoads.has(path)) return this.annLoads.get(path)!;
    const job = (async () => {
      const adapter = this.host.app.vault.adapter;
      const sidecar = this.sidecarPath(path);
      const text = await adapter.exists(sidecar) ? await adapter.read(sidecar) : null;
      try {
        const obj = text === null ? { annotations: [] } : JSON.parse(text);
        validateAnnotationCollection(obj?.annotations);
        const anns = obj.annotations as Annotation[];
        this.annCache.set(path, anns); this.annBase.set(path, text); this.annBlocked.delete(path);
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
    this.annDirty.set(path, (this.annDirty.get(path) ?? 0) + 1);
    this.annotationsChanged(path);
    this.scheduleFlush();
  }
  async saveAnnotationsNow(path: string, anns: Annotation[]): Promise<void> { this.saveAnnotationsDebounced(path, anns); await this.flush(); }
  private async persistAnnotations(path: string): Promise<void> {
    if (this.annBlocked.has(path)) throw new Error("标注文件已锁定：" + path);
    const version = this.annDirty.get(path);
    if (version == null) return;
    const anns = clone(this.annCache.get(path) ?? []);
    validateAnnotationCollection(anns);
    const sidecar = this.sidecarPath(path);
    const adapter = this.host.app.vault.adapter;
    const disk = await adapter.exists(sidecar) ? await adapter.read(sidecar) : null;
    if (disk !== (this.annBase.get(path) ?? null)) {
      const recovery = await this.writeRecovery("annotation-conflict", { docPath: path, local: { annotations: anns }, remote: disk });
      this.annBlocked.add(path);
      throw new Error("标注被外部修改，已保留两份版本：" + recovery);
    }
    const content = JSON.stringify({ schemaVersion: 2, annotations: anns }, null, 2);
    // A rolling recovery copy also covers a partial host write or forced process exit.
    await this.writeRecovery("pending-annotations-" + sha(path).slice(0, 12), { docPath: path, annotations: anns }, true);
    await adapter.write(sidecar, content);
    this.annBase.set(path, content);
    if (this.annDirty.get(path) === version) this.annDirty.delete(path);
  }

  getAnnotationConflicts(): string[] { return [...this.annBlocked]; }

  async resolveAnnotationConflict(path: string, strategy: "local" | "remote" | "merge"): Promise<void> {
    await this.enqueue(async () => {
      const adapter = this.host.app.vault.adapter, sidecar = this.sidecarPath(path);
      const disk = await adapter.exists(sidecar) ? await adapter.read(sidecar) : null;
      const local = clone(this.annCache.get(path) ?? []);
      let remote: Annotation[] = [];
      try { const obj = disk == null ? { annotations: [] } : JSON.parse(disk); validateAnnotationCollection(obj?.annotations); remote = obj.annotations; }
      catch (e) { if (strategy !== "local") throw new Error("磁盘标注无法解析。可先保留损坏文件，再采用当前窗口版本；或从完整备份恢复。"); }
      await this.writeRecovery("resolved-annotation-conflict", { docPath: path, local, remoteRaw: disk });
      const merged = strategy === "local" ? local : strategy === "remote" ? remote : [...local];
      if (strategy === "merge") for (const a of remote) { const existing = merged.find(x => x.id === a.id); if (!existing) merged.push(a); else if (!same(existing,a)) merged.push({ ...a, id: uid("ann-conflict"), cardId: undefined }); }
      const cached = this.annCache.get(path); if (cached) cached.splice(0,cached.length,...merged); else this.annCache.set(path,merged);
      this.annBase.set(path,disk); this.annBlocked.delete(path); this.annDirty.set(path,(this.annDirty.get(path) ?? 0)+1);
      await this.persistAnnotations(path); this.annotationsChanged(path); this.changed();
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

  private snapshot(): LibrarySnapshot { return { data: this.data(), annotations: [...this.annCache].map(([p, a]) => [p, clone(a)]) }; }
  private restoreSnapshot(snapshot: LibrarySnapshot, previous?: LibrarySnapshot): void {
    const current = this.data();
    this.applyData(clone(snapshot.data));
    // Reading tabs and positions are not library edits and must survive its undo.
    this.workspaceState = current.workspaceState;
    if (previous) {
      // Library undo cannot rewind reviews or settings made since that edit.
      this.settings = current.settings;
      this.reviewLogs = current.reviewLogs ?? [];
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
      this.annDirty.set(path, (this.annDirty.get(path) ?? 0) + 1);
      this.annotationsChanged(path);
    }
    this.save();
  }
  private mutate<T>(label: string, action: () => T): T {
    if (this.transactionDepth) return action();
    const before = this.snapshot();
    this.transactionDepth++;
    try {
      const result = action(); this.repairGraph();
      const after = this.snapshot();
      if (!same(before, after)) { this.history.push({ label, before, after }); if (this.history.length > 20) this.history.shift(); this.future = []; this.libraryHistoryRevision++; this.save(); }
      return result;
    } catch (e) { this.restoreSnapshot(before); throw e; }
    finally { this.transactionDepth--; }
  }
  getLibraryHistoryState(): {canUndo:boolean;canRedo:boolean;undoLabel?:string;redoLabel?:string;revision:number} {
    return {canUndo:this.history.length>0,canRedo:this.future.length>0,undoLabel:this.history[this.history.length-1]?.label,redoLabel:this.future[this.future.length-1]?.label,revision:this.libraryHistoryRevision};
  }
  undoLibraryChange(): boolean { const item = this.history.pop(); if (!item) return false; this.future.push(item); this.libraryHistoryRevision++; if ('nodeMove' in item) { const node=this.getNode(item.nodeMove.id); if(node) Object.assign(node,item.nodeMove.before); this.save(); } else { this.restoreSnapshot(item.before, item.after); this.restoreCardAnchors(); } return true; }
  libraryTransaction<T>(label: string, action: () => T): T { return this.mutate(label, action); }
  redoLibraryChange(): boolean { const item = this.future.pop(); if (!item) return false; this.history.push(item); this.libraryHistoryRevision++; if ('nodeMove' in item) { const node=this.getNode(item.nodeMove.id); if(node) Object.assign(node,item.nodeMove.after); this.save(); } else { this.restoreSnapshot(item.after, item.before); this.restoreCardAnchors(); } return true; }
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
    this.history.push({ label: "移动节点", nodeMove: { id, before, after: { x, y } } });
    if (this.history.length > 20) this.history.shift(); this.future = []; this.libraryHistoryRevision++; this.save();
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
    const after = schedule(before, grade, now);
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
  registerDocument(path: string, sourceUrl?: string): DocumentRecord | undefined {
    if (!path) return undefined;
    let doc = this.documents.find(d => d.path === path);
    if (!doc) { doc = { id: uid("doc"), path, kind: path.split(".").pop()?.toLowerCase() ?? "", createdAt: new Date().toISOString(), sourceUrl }; this.documents.push(doc); }
    if (sourceUrl) doc.sourceUrl = sourceUrl; doc.missing = false; return doc;
  }
  /** Lazily fingerprint a source through the vault adapter while retaining its existing identity. */
  async refreshDocumentFingerprint(path: string): Promise<DocumentRecord | undefined> {
    const adapter = this.host.app.vault.adapter;
    if (!await adapter.exists(path)) return undefined;
    const bytes = await adapter.readBinary(path), record = this.registerDocument(path);
    if (!record) return undefined;
    const byteSize = bytes.byteLength, digest = sha(bytes);
    if (record.sha256 !== digest || record.byteSize !== byteSize || record.missing) {
      this.mutate("更新来源指纹", () => { record.sha256 = digest; record.byteSize = byteSize; record.missing = false; });
    }
    return record;
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
    for (const doc of [...this.documents]) if (!doc.missing && await adapter.exists(doc.path)) await this.refreshDocumentFingerprint(doc.path);
  }
  /** Auto-relocate only a single byte-identical candidate; ambiguity remains explicit and untouched. */
  async recoverMissingDocuments(): Promise<{ recovered: { id: string; oldPath: string; newPath: string }[]; ambiguous: { id: string; oldPath: string; candidates: string[]; identicalCandidates: string[] }[] }> {
    const recovered: { id: string; oldPath: string; newPath: string }[] = [], ambiguous: { id: string; oldPath: string; candidates: string[]; identicalCandidates: string[] }[] = [];
    const adapter = this.host.app.vault.adapter;
    for (const doc of [...this.documents].filter(item => !!item.sha256 && Number.isSafeInteger(item.byteSize))) {
      // A move made while Obsidian or the plugin was offline has no delete event
      // to set `missing`. Reconcile the registered path against disk before
      // deciding whether this record needs exact-content recovery.
      if (!doc.missing && await adapter.exists(doc.path)) continue;
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
  }
  async renameDocument(oldPath: string, newPath: string): Promise<void> {
    if (oldPath === newPath) return;
    await this.flush();
    const before = this.snapshot(); let movedSidecar = false, originalSidecarText: string | null = null;
    try {
    await this.enqueue(async () => {
      // Disk operations share the save queue; no flush can recreate a sidecar while it moves.
      await Promise.all([...this.annLoads.values()]);
      const adapter = this.host.app.vault.adapter, oldSidecar = this.sidecarPath(oldPath), newSidecar = this.sidecarPath(newPath);
      if (await adapter.exists(oldSidecar)) {
        if (await adapter.exists(newSidecar)) throw new Error("目标路径已有批注，已保留两份文件，需先处理");
        originalSidecarText = await adapter.read(oldSidecar);
        await adapter.rename(oldSidecar, newSidecar);
        movedSidecar = true;
      }
      const text = await adapter.exists(newSidecar) ? await adapter.read(newSidecar) : null;
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
        if (this.docMeta[oldPath]) { this.docMeta[newPath] = this.docMeta[oldPath]; delete this.docMeta[oldPath]; }
      });
      if (anns) {
        this.annCache.delete(oldPath); this.annBase.delete(oldPath); this.annDirty.delete(oldPath);
        this.annCache.set(newPath, anns); this.annBase.set(newPath, text);
        for (const annotation of anns) annotation.docPath = newPath;
        this.saveAnnotationsDebounced(newPath, anns);
      }
      for (const listener of this.documentRenameListeners) {
        try { listener(oldPath, newPath); } catch (error) { console.error(error); }
      }
    });
    await this.flush();
    } catch (error) {
      try { await this.writeRecovery("document-migration-failed", { oldPath, newPath, error: String(error), snapshot: before, oldSidecar: this.sidecarPath(oldPath), oldSidecarText: originalSidecarText, newSidecar: this.sidecarPath(newPath) }); } catch { /* retain the original error */ }
      if (movedSidecar) try {
        const adapter = this.host.app.vault.adapter, from = this.sidecarPath(newPath), to = this.sidecarPath(oldPath);
        if (await adapter.exists(from) && !await adapter.exists(to)) await adapter.rename(from, to);
        if (originalSidecarText !== null) await adapter.write(to, originalSidecarText);
        this.annCache.delete(newPath); this.annBase.delete(newPath); this.annDirty.delete(newPath);
        this.annCache.delete(oldPath); this.annBase.delete(oldPath); this.annDirty.delete(oldPath);
        for (const [path, annotations] of before.annotations) { this.annCache.set(path, clone(annotations)); this.annBase.set(path, await adapter.exists(this.sidecarPath(path)) ? await adapter.read(this.sidecarPath(path)) : null); }
      } catch { /* recovery record above describes the partial migration */ }
      this.restoreSnapshot(before);
      throw error;
    }
  }
  markDocumentMissing(path: string): void {
    // A delete notification for an unrelated/transient file must not add it to the library.
    const doc = this.documents.find(d => d.path === path);
    if (!doc || doc.missing) return;
    doc.missing = true; this.save();
  }

  /** A self-contained backup includes source documents, annotations and recordings. */
  async backupData(silent = false, includePending = false): Promise<string> {
    try {
      if (!includePending) await this.flush();
      const dir = "MarginStudyBackups/" + new Date().toISOString().replace(/[:.]/g,"-") + "-" + uid("backup");
      await this.ensureDir(dir + "/files");
      const dataText = JSON.stringify(this.data(), null, 2), adapter = this.host.app.vault.adapter;
      await adapter.write(dir + "/data.json", dataText);
      const paths = new Set<string>();
      for (const c of this.cards) for (const s of this.sources(c)) paths.add(s.docPath);
      for (const set of this.studySets) for (const p of set.docPaths) paths.add(p);
      for (const d of this.documents) if (!d.missing) paths.add(d.path);
      for (const f of this.host.app.vault.getFiles()) if (!f.path.startsWith("MarginStudyBackups/") && !f.path.startsWith("_marginstudy-recovery/") && (f.path.endsWith(".mstudy.json") || f.path.startsWith("_marginstudy-audio/") || f.path.startsWith("_marginstudy-imports/"))) paths.add(f.path);
      if (includePending) for (const path of this.annCache.keys()) paths.add(this.sidecarPath(path));
      for (const p of [...paths]) if (!p.endsWith(".mstudy.json") && await adapter.exists(this.sidecarPath(p))) paths.add(this.sidecarPath(p));
      const files: BackupFile[] = [], missingFiles: string[] = [];
      for (const p of paths) {
        safePath(p);
        const cached = p.endsWith(".mstudy.json") ? this.annCache.get(p.slice(0,-".mstudy.json".length)) : undefined;
        if (!await adapter.exists(p) && !(includePending && cached)) { missingFiles.push(p); continue; }
        const content = includePending && cached ? new TextEncoder().encode(JSON.stringify({ schemaVersion: 2, annotations: cached },null,2)).buffer : await adapter.readBinary(p), storedPath = "files/" + p;
        const parent = (dir + "/" + storedPath).split("/").slice(0,-1).join("/"); await this.ensureDir(parent);
        await adapter.writeBinary(dir + "/" + storedPath, content); files.push({ path: p, storedPath, sha256: sha(content), bytes: content.byteLength });
      }
      const manifest: BackupManifest = { format: "margin-study-backup", version: 2, createdAt: new Date().toISOString(), dataSha256: sha(dataText), files, missingFiles };
      const result = dir + "/manifest.json"; await adapter.write(result, JSON.stringify(manifest,null,2));
      if (!silent) new Notice("备份已保存：" + result + (missingFiles.length ? `（${missingFiles.length} 个来源文件原本已缺失，清单已记录）` : "")); return result;
    } catch (e) { this.report("备份失败，本次未记为成功",e); return ""; }
  }

  async restoreBackup(manifestPath: string): Promise<void> {
    const adapter = this.host.app.vault.adapter; safePath(manifestPath);
    const root = manifestPath.split("/").slice(0,-1).join("/");
    const manifest = JSON.parse(await adapter.read(manifestPath)) as BackupManifest;
    if (manifest.format !== "margin-study-backup" || manifest.version !== 2 || !Array.isArray(manifest.files)) throw new Error("备份清单格式不支持");
    const dataText = await adapter.read(root + "/data.json"); if (sha(dataText) !== manifest.dataSha256) throw new Error("主数据校验失败");
    const data = JSON.parse(dataText); this.validateData(data);
    const staged: { path: string; bytes: ArrayBuffer; before: ArrayBuffer | null }[] = []; const seen = new Set<string>();
    for (const item of manifest.files) {
      const path = safePath(item.path), storedPath = safePath(item.storedPath);
      if (path.startsWith("MarginStudyBackups/") || path.startsWith("_marginstudy-recovery/") || !storedPath.startsWith("files/") || seen.has(path)) throw new Error("备份含重复或不允许的文件路径");
      seen.add(path); const bytes = await adapter.readBinary(root + "/" + storedPath);
      if (sha(bytes) !== item.sha256 || bytes.byteLength !== item.bytes) throw new Error("文件校验失败：" + path);
      if (path.endsWith(".mstudy.json")) {
        const sidecar = JSON.parse(new TextDecoder().decode(bytes));
        validateAnnotationCollection(sidecar?.annotations);
      }
      staged.push({ path, bytes, before: null });
    }
    // The entire restore shares the write queue. All bytes are verified before mutation.
    await this.enqueue(async () => {
      this.restoring = true;
      if (this.saveTimer !== null) { clearTimeout(this.saveTimer); this.saveTimer = null; }
      const before = this.snapshot(), diskData = clone(await this.host.loadData());
      const oldBases = new Map(this.annBase), oldBlocked = new Set(this.annBlocked), oldDirty = new Map(this.annDirty);
      const written: typeof staged = [];
      try {
        for (const item of staged) item.before = await adapter.exists(item.path) ? await adapter.readBinary(item.path) : null;
        // Preserve disk and in-memory variants even when a conflict prevented normal flushing.
        await this.writeRecovery("before-restore", { data: before.data, diskData, annotations: before.annotations, diskAnnotations: await Promise.all([...this.annCache.keys()].map(async path => ({ path, content: await adapter.exists(this.sidecarPath(path)) ? await adapter.read(this.sidecarPath(path)) : null }))) });
        const safety = await this.backupData(true,true); if (!safety) throw new Error("恢复前备份失败，恢复已取消");
        for (const item of staged) { const parent = item.path.split("/").slice(0,-1).join("/"); if (parent) await this.ensureDir(parent); await adapter.writeBinary(item.path,item.bytes); written.push(item); }
        this.applyData(data); this.mainDirty = true; this.mainVersion++; this.loadBlocked = false;
        this.baseline = diskData; this.pendingConflict = null; this.conflictPath = null;
        await this.persistMain();
        // Keep view-held arrays live, replacing their content rather than abandoning them.
        for (const [path, anns] of this.annCache) {
          const text = await adapter.exists(this.sidecarPath(path)) ? await adapter.read(this.sidecarPath(path)) : null;
          const recovered = text == null ? [] : JSON.parse(text).annotations;
          anns.splice(0,anns.length,...recovered); this.annBase.set(path,text); this.annotationsChanged(path);
        }
        this.annDirty.clear(); this.annBlocked.clear(); this.history = []; this.future = []; this.libraryHistoryRevision++;
        this.changed(); new Notice("学习库已恢复；恢复前版本保存在：" + safety);
      } catch (error) {
        const failures: string[] = [];
        for (const item of written.reverse()) try { if (item.before !== null) await adapter.writeBinary(item.path,item.before); else if (await adapter.exists(item.path)) await adapter.remove(item.path); } catch (e) { failures.push(item.path + ": " + String(e)); }
        try { await this.host.saveData(diskData); this.baseline = clone(diskData); } catch (e) { failures.push("主数据：" + String(e)); }
        this.applyData(before.data);
        for (const [path,annotations] of before.annotations) { const cached = this.annCache.get(path); if (cached) cached.splice(0,cached.length,...annotations); else this.annCache.set(path,annotations); this.annotationsChanged(path); }
        this.annBase = oldBases; this.annBlocked = oldBlocked; this.annDirty = oldDirty;
        this.mainDirty = true; this.mainVersion++;
        // No flush from within our queue. A caller can retry immediately after rollback.
        if (failures.length) throw new Error(String(error) + "；部分回滚失败，恢复点已保留：" + failures.join("；"));
        throw error;
      } finally { this.restoring = false; if (this.mainDirty || this.annDirty.size) this.scheduleFlush(); }
    });
  }

}

function uniqueSources(sources: CardSource[]): CardSource[] { const seen = new Set<string>(); return sources.filter(s => { const key = [s.docPath,s.anchorAnnId ?? "",s.page ?? "",s.text ?? "",s.image ?? ""].join("\u0000"); if (seen.has(key)) return false; seen.add(key); return true; }); }
