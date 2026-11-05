// ===== 间隔重复状态（FSRS 风格：难度 + 稳定度模型） =====
export interface CardState {
  due: string; // 下次复习日期 YYYY-MM-DD
  interval: number; // 当前间隔天数（展示用）
  ease: number; // 兼容旧数据/展示，新调度以 difficulty 为准
  reps: number; // 总复习次数
  // FSRS 新增
  stability: number; // 稳定度（天），间隔的核心依据
  difficulty: number; // 难度 1..10
  lapses: number; // 遗忘次数
  state: number; // 0 新卡 / 1 学习中 / 2 复习中 / 3 重新学习
  lastReviewed?: string; // 上次复习日期
  learningSteps?: number;
  elapsedDays?: number;
  scheduledDays?: number;
  algorithm?: string;
}

// ===== 标注 =====
export type AnnotationType = "highlight" | "underline" | "strike" | "note" | "voice" | "pen" | "region";
export type HandwritingPresetId = string;
export interface HandwritingPresetSpec {
  id: HandwritingPresetId;
  label: string;
  type: "ballpoint" | "fountain" | "pencil" | "highlighter";
  color: string;
  /** Legacy document width retained for existing settings and exports. */
  width: number;
  documentWidth?: number;
  mindmapWidth?: number;
  cardWidth?: number;
  opacity: number;
  /** Highlight strokes may opt out of recall masking without changing their visual brush. */
  recallPurpose?: "mask" | "highlight";
}
export const DEFAULT_HANDWRITING_PRESETS: HandwritingPresetSpec[] = [
  { id: "pen-1", label: "原子笔 1", type: "ballpoint", color: "#000000", width: 3.4, documentWidth: 3.4, mindmapWidth: 3.4, cardWidth: 3.4, opacity: 1 },
  { id: "pen-2", label: "墨水笔 1", type: "fountain", color: "#000000", width: 2.6, documentWidth: 2.6, mindmapWidth: 2.6, cardWidth: 2.6, opacity: 1 },
  { id: "highlight-1", label: "荧光笔 1", type: "highlighter", color: "#ffd54f", width: 21, documentWidth: 21, mindmapWidth: 21, cardWidth: 21, opacity: .8 },
  { id: "pencil-1", label: "铅笔 1", type: "pencil", color: "#696969", width: 1.8, documentWidth: 1.8, mindmapWidth: 1.8, cardWidth: 1.8, opacity: 0.85 },
];
export const HANDWRITING_PRESETS: Record<HandwritingPresetId, HandwritingPresetSpec> = Object.fromEntries(
  DEFAULT_HANDWRITING_PRESETS.map((preset) => [preset.id, preset])
);

/** PDF 坐标，原点左下，单位 pt */
export interface PdfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Canonical PDF coordinates grouped by page, including cross-page selections. */
export interface PdfPageGeometry { page: number; rects: PdfRect[]; }

/** Page-relative ink. PDF uses the original displayed page as its basis; extended margins may exceed 0..1. */
export interface Stroke {
  x: number;
  y: number;
  pressure?: number;
}

/** Word/HTML 文字批注的字符偏移范围（相对渲染后文本） */
export interface DomRange {
  imageIndex?: number;
  imageSource?: string;
  start: number;
  end: number;
  /** Text quote anchors survive edits before the selected text. */
  exact?: string;
  prefix?: string;
  suffix?: string;
  section?: string;
  /** Plugin-defined chapter-relative ratio (0..1), for EPUB navigation fallback. */
  sectionRatio?: number;
}

/** Plugin-owned text runs. Plain annotation text remains the searchable/source-card value. */
export interface AnnotationTextStyle {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  background: string;
}
export interface AnnotationTextRun { text: string; style: AnnotationTextStyle; }

export interface ExcerptBlock {
  id: string;
  target?: import("./annot/baseController").SelTarget;
  source?: CardSource;
  sourceText?: string;
  text?: string;
  image?: string;
}

export interface Annotation {
  id: string;
  docPath: string;
  docKind: "pdf" | "html"; // 来源文档类型
  page: number; // 1-based（PDF）；Word 恒为 0
  type: AnnotationType;
  rects: PdfRect[]; // PDF 坐标（用于 pdf 类型及 voice/pen 在 PDF 上的定位）
  pdfGeometry?: PdfPageGeometry[];
  pdfCoordinateSpace?: "pdf" | "legacy-viewport";
  range?: DomRange; // HTML/Word 文字批注：字符偏移
  strokes?: Stroke[][]; // 手写：多条笔画，每条为点序列（归一化坐标）
  inkLayerId?: string;
  inkBrush?: "pen" | "highlight";
  inkWidth?: number;
  inkOpacity?: number;
  inkPreset?: HandwritingPresetId;
  inkRecallPurpose?: "mask" | "highlight";
  overlay?: { kind: "text" | "image"; rotation?: number; box?: { x: number; y: number; w: number; h: number }; fontSize?: number; fontFamily?: string; textRuns?: AnnotationTextRun[]; background?: string; deleted?: boolean };
  documentNotebookId?: string;
  pdfReferencePages?: { id: string; page: number }[];
  mediaKind?: "audio" | "video";
  mediaName?: string;
  mediaDeleted?: boolean;
  audioPath?: string; // 语音批注：vault 内音频文件路径
  pos?: { x: number; y: number }; // HTML/Word 中语音/手写锚点（归一化坐标）
  text: string; // 选区文本 / 语音留空 / 区域 OCR 文本
  color: string; // hex
  noteText?: string; // 文字批注 / 备注
  cardId?: string; // 关联卡片
  image?: string; // 区域摘录截图（base64 data URL）
  images?: string[]; // 同一摘录中的其他图片
  excerptBlocks?: ExcerptBlock[];
  createdAt: string;
}

// ===== 卡片 =====
export type CardType = "excerpt" | "comment" | "flashcard";

export interface Card {
  id: string;
  docPath: string;
  type: CardType;
  front: string; // 摘录文本 / 评论内容 / 闪卡题干（支持 Markdown，支持 {{c1::答案}} 填空）
  title?: string;
  back?: string; // 闪卡答案（支持 Markdown）
  links: string[]; // 关联卡片 id
  tags: string[]; // 标签
  color?: string; // 卡片颜色 hex（用于卡片盒/看板筛选与展示）
  colorIndex?: number; // 卡片色板序号 0–15
  keywords?: string[]; // 关键词标题链接：在文档/卡片中触发解释卡
  wrong?: boolean; // 错题标记（复习点「重来」置真，点「良好/简单」清除）
  favorite?: boolean;
  anchorAnnId?: string; // 源标注
  documentNotebookId?: string;
  page?: number;
  image?: string; // 区域摘录截图（base64 data URL）
  images?: string[];
  excerptBlocks?: ExcerptBlock[];
  /** Derived Extend comment previews, separate from source excerpts and manually added images. */
  extendMedia?: { noteId: string; image: string; composed?: boolean }[];
  /** Reader text kept separate when the source card already has an independent note. */
  extendText?: { noteId: string; text: string }[];
  /** Media added in the card editor; never written back into Reader Extend content. */
  commentMedia?: { id: string; image: string; kind: "image" | "ink"; name?: string }[];
  /** Explicit comment order; missing/stale keys leave legacy content and identities intact. */
  commentOrder?: string[];
  sources?: CardSource[];
  occlusions?: import("./review/contracts").ImageOcclusion[];
  templateId?: string;
  updatedAt?: string;
  hidden?: boolean;
  occluded?: boolean;
  groupId?: string;
  groupMode?: boolean;
  draft?: boolean;
  blank?: boolean;
  sourceCardId?: string;
  /** A review-only face. Absence retains the plugin's historical front/back display. */
  reviewQuestion?: { mode: "title" | "emphasis" | "whole" | "custom"; text?: string; includeImages?: boolean };
  typography?: { fontFamily: "Helvetica" | "Georgia" | "Courier New"; fontSize: number };
  /** Explicit selection retained for later, user-requested source refresh. */
  reviewCopySelection?: { parts?: ("title" | "excerpt" | "note" | "images")[]; maskIds?: string[] };
  sourceSyncedAt?: string;
  /** Originals remain recoverable after closing and reopening the app. */
  mergedCards?: Card[];
  mergedReviewStates?: Record<string, CardState>;
  mergeArchive?: {
    nodes: MindNode[];
    edges: Edge[];
    memberships: { studySetId: string; cardIds?: string[] }[];
    presentation?: Partial<Card>;
    collapsedNodeIds?: string[];
    movedParents?: { id: string; before: string | null; after: string | null }[];
    mappedEdges?: Edge[];
    cardLinks?: { cardId: string; links: string[]; mergedLinks: string[] }[];
  };
  createdAt: string;
}

// ===== 思维导图 =====
export interface MindNode {
  id: string;
  parentId: string | null;
  title: string;
  cardId?: string;
  docPath?: string;
  image?: string; // 区域摘录截图（base64 data URL）
  canvasId?: string;
  order?: number;
  reference?: boolean;
  sourceNodeId?: string;
  hidden?: boolean;
  occluded?: boolean;
  kind?: "content" | "toc";
  updatedAt?: string;
  color?: string; // 节点背景色 hex
  tags?: string[]; // 节点标签
  comments?: string[]; // 节点评论/对话记录
  layout?: string; // 分支样式（mini/logic/right/left/tree…）
  collapsed: boolean;
  submap?: boolean; // 已折叠为子脑图（点击节点在浮动视图打开子树，对齐 MN「子脑图层级」）
  x: number;
  y: number;
}

export interface Edge {
  from: string;
  to: string;
  label?: string;
}

export interface CardSource {
  docPath: string;
  documentNotebookId?: string;
  anchorAnnId?: string;
  page?: number;
  text?: string;
  image?: string;
}

export type StudySceneId = "reading" | "writing" | "excerpt" | "handwriting" | "organize" | "recall";
export interface StudySceneSelection {
  templateId: string;
  sceneId: StudySceneId;
  interfaceMode: "scenes" | "traditional";
}
export interface StudySceneTemplate {
  id: string;
  version: 1;
  name: string;
  scenes: { id: StudySceneId; label: string; tools: string[] }[];
  colors?: string[];
  excerptPopup?: boolean;
  textSelectionMenuActions?: string[];
  handwritingPresets?: HandwritingPresetSpec[];
}

export interface StudySet {
  id: string;
  name: string;
  docPaths: string[];
  documentAttachments?: Record<string, string[]>;
  cardIds?: string[];
  reviewDeckId?: string;
  createdAt: string;
  /** Optional home metadata; absent legacy values do not require migration. */
  pinned?: boolean;
  category?: string;
  fixedViews?: FixedMindmapView[];
  excerptDestination?: { canvasId: string; nodeId: string };
  /** Absent in legacy data. Merely reading defaults never writes a migration. */
  scene?: StudySceneSelection;
  recallSettings?: { options: Record<RecallOptionKey, boolean>; coverAll: boolean; hintLanguage: "auto" | "zh" | "en"; mode?: "in-place" | "layered" };
}

export interface FixedMindmapView {
  id: string;
  name: string;
  kind: "canvas" | "submap" | "board" | "local";
  canvasId: string;
  nodeId?: string;
  viewport: { scale: number; x: number; y: number };
  boardViewport?: { x: number; y: number };
}

/** Membership remains stable when every question is scheduled in the future. */
export interface ReviewDeck {
  id: string;
  name: string;
  studySetIds: string[];
  cardIds: string[];
  createdAt: string;
  updatedAt?: string;
  /** Compatibility decks retain old question keys; null denotes unscoped keys. */
  legacyScopeId?: string | null;
}

export interface MindCanvas {
  id: string;
  studySetId: string;
  name: string;
  createdAt: string;
  kind?: "study" | "document" | "review";
  lastVisitedAt?: string;
  lastDocumentPath?: string;
  emphasisCloze?: boolean;
  singlePeek?: boolean;
  handwriting?: import("./mindmap/handwritingContracts").MindmapHandwriting;
}

export interface MindmapFragment {
  nodes: MindNode[];
  edges: Edge[];
  cards: Card[];
}

export interface PasteOptions {
  canvasId?: string;
  parentId?: string | null;
  mode: "reference" | "clone";
  offset?: { x: number; y: number };
}

export interface DocumentRecord {
  id: string;
  path: string;
  kind: string;
  sourceUrl?: string;
  createdAt: string;
  missing?: boolean;
  /** Content identity for deterministic recovery when external files move. */
  sha256?: string;
  byteSize?: number;
}

// ===== 设置 =====
export type ThemeMode = "light" | "dark" | "auto";
export type ReadingTheme = "white" | "sepia" | "gray" | "dark" | "green";
export interface MarginStudySettings {
  fixedViewPosition?: { x: number; y: number };
  studyHomeCategory?: string;
  studyHomeSort?: "name" | "recent";
  cardFontFamily?: "Helvetica" | "Georgia" | "Courier New";
  cardBaseFontSize?: number;
  cardTitleUppercase?: boolean;
  hideKeyboardAccessoryBar?: boolean;
  appleOcrEngine?: boolean;
  ocrSelectionCorrection?: boolean;
  readingTheme?: ReadingTheme; // 学习工作区的阅读主题；不改变 Obsidian 宿主主题
  showFootnotesLinksOnMargin?: boolean;
  hideMarginNumbers?: boolean;
  tapPageEdges?: boolean;
  assistiveExcerpt?: boolean;
  excerptPopup?: boolean;
  textSelectionMenuActions?: string[];
  excerptLockColors?: boolean;
  excerptAutoExpandRect?: boolean;
  research?: import("./research/contracts").ResearchPreferences;
  colors: string[];
  defaultColor: string;
  scale: number; // 默认缩放
  defaultEase: number;
  pageGap: number; // 页间距 px
  layout: string; // 全局脑图分支样式
  immersive: boolean; // 沉浸模式
  theme: ThemeMode; // 界面主题：亮/暗/跟随系统
  accent: string; // 主题色预设 id（见 ACCENTS）
  autoCardOnHighlight: boolean; // 高亮/下划线后自动生成摘录卡
  autoCardOnRegion: boolean; // 区域摘录（套索框选）后自动生成摘录卡
  autoReview: boolean; // 阅读器新卡自动加入当前复习卡组
  autoNodeOnCard: boolean; // 生成卡片时自动在脑图创建对应节点（仿 MN 实时联动）
  tagColors: Record<string, string>; // 标签 → 颜色 hex
  backupEnabled: boolean; // 每日自动备份 data.json
  lastBackup?: string; // 上次自动备份日期 YYYY-MM-DD（按天去重）
  replaceNativeReader: boolean; // 用 MarginStudy 阅读器替代 Obsidian 原生 PDF/Word 查看器（双击即开本插件）
  handwritingPresets?: HandwritingPresetSpec[];
  handwritingPresetsVersion?: 2;
}

export const DEFAULT_SETTINGS: MarginStudySettings = {
  colors: ["#ffd54f", "#ff8a80", "#80cbc4", "#9fa8da", "#ce93d8", "#a5d6a7"],
  defaultColor: "#ffd54f",
  scale: 1.4,
  defaultEase: 2.5,
  pageGap: 24,
  layout: "right",
  immersive: false,
  theme: "light",
  readingTheme: "white",
  assistiveExcerpt: true,
  excerptPopup: true,
  excerptLockColors: false,
  excerptAutoExpandRect: true,
  appleOcrEngine: true,
  ocrSelectionCorrection: false,
  accent: "indigo",
  autoCardOnHighlight: true, // 对齐 MN：每画一笔摘录即自动成卡（旧用户 data.json 已存值不受影响）
  autoCardOnRegion: true,
  autoReview: false,
  autoNodeOnCard: true,
  tagColors: {},
  backupEnabled: true,
  replaceNativeReader: true, // 默认替代原生查看器（原生查看器会被本插件注入的 pdf worker 干扰而空白，故默认开）
  handwritingPresets: DEFAULT_HANDWRITING_PRESETS.map((preset) => ({ ...preset })),
};

/** 主题色预设（对应 MN4 的多配色） */
export const ACCENTS: { id: string; name: string; color: string }[] = [
  { id: "indigo", name: "靛蓝", color: "#5b6cff" },
  { id: "blue", name: "天蓝", color: "#2f9bff" },
  { id: "green", name: "翠绿", color: "#1fb98c" },
  { id: "purple", name: "紫", color: "#9b5bff" },
  { id: "amber", name: "琥珀", color: "#ff9f43" },
  { id: "rose", name: "玫红", color: "#ff5b8a" },
];

/** 单文档元数据：书页折叠、书签、阅读视图（亮度/联动比例） */
export interface PdfCrop { left: number; top: number; right: number; bottom: number; }
export interface PdfEditedPage {
  id: string;
  /** Original page numbers never change. Imported sheets use their own immutable copy. */
  sourcePage?: number;
  imported?: { path: string; page: number };
  width?: number;
  height?: number;
  rotation?: 0 | 90 | 180 | 270;
}
export interface PdfPageEdits { version: 1; pages: PdfEditedPage[]; }
export type PdfExtendMode = "normal" | "margin" | "collapse";
export interface PdfDisplayPage { number: number; page: number; top: number; height: number; noteId?: string; }
/** Plugin-owned note anchored to an immutable sheet, in its original normalized coordinates. */
export interface PdfExtendNote {
  id: string;
  pageId: string;
  /** Original excerpt; its text/card remain independent of this comment. */
  sourceAnnId?: string;
  /** The source card already had an independent back; this text uses Card.extendText. */
  separateCardText?: boolean;
  placement?: "margin";
  anchor: { x: number; y: number };
  height: number;
  text: string;
  runs?: AnnotationTextRun[];
  color?: string;
  tags?: string[];
  /** Independently positioned text inside the paper; separate from card comments. */
  textBoxes?: { id: string; text: string; runs?: AnnotationTextRun[]; x: number; y: number; w: number; h: number }[];
  images?: { id: string; src: string; x: number; y: number; w: number; h: number;
    /** Original pixels remain available when reopening a non-destructive image crop. */
    edit?: { source: string; crop: PdfCrop; rotation: 0 | 90 | 180 | 270; w: number; h: number };
  }[];
  ink?: { id: string; strokes: Stroke[][]; color: string; brush: "pen" | "highlight" }[];
  collapsed?: boolean;
  createdAt: string;
}
export interface DocumentOutlineItem { id: string; title: string; page: number; level: number; pageId?: string; rects?: PdfRect[]; }

export interface DocMeta {
  /** Document-wide user TOC. Undefined uses embedded TOC; [] is deliberately empty. */
  documentOutline?: DocumentOutlineItem[];
  foldedPages?: number[]; // 已折叠（隐藏）的页码
  /** Source PDF geometry; optional until an explicit region-fold action. */
  pdfRegionFolds?: { id: string; pageId: string; rects: PdfRect[] }[];
  bookmarks?: number[]; // 书签页码
  brightness?: number; // 0.4..1.4
  pdfLayout?: "single" | "spread";
  pdfContinuous?: boolean;
  /** Display-oriented bounds relative to the original page; outside 0..1 extends paper. Shared by all pages/notebooks. */
  pdfCrop?: PdfCrop;
  pdfPageEdits?: PdfPageEdits;
  pdfExtendNotes?: PdfExtendNote[];
  pdfExtendMode?: PdfExtendMode;
  pdfMarginCommentArea?: boolean;
  pdfExtendFavorites?: string[];
  handwritingLayers?: { id: string; name: string }[];
  activeHandwritingLayerId?: string;
  overlayHandwritingLayerId?: string;
  handwritingSyncEnabled?: boolean;
  documentNotebooks?: { id: string; name: string }[];
  activeDocumentNotebookId?: string;
  overlayDocumentNotebookId?: string;
  documentNotebookMeta?: Record<string, Omit<DocMeta, "documentNotebookMeta" | "documentNotebooks" | "activeDocumentNotebookId" | "overlayDocumentNotebookId" | "handwritingSyncEnabled">>;
}

export const BRANCH_STYLES: { id: string; name: string }[] = [
  { id: "right", name: "向右" },
  { id: "left", name: "向左" },
  { id: "both", name: "双向" },
  { id: "tree", name: "鱼骨" },
  { id: "logic", name: "逻辑图" },
  { id: "mind", name: "经典" },
  { id: "mini", name: "紧凑" },
  { id: "down", name: "向下" },
  { id: "org", name: "组织架构" },
  { id: "timeline", name: "时间轴" },
];

// ===== 阅读器抽象（PDF / Word 共用，供侧边栏/导图/导出定位当前文档） =====
export interface ReaderContentsEntry { title: string; level: number; select(): void; }
export interface RecallHintRequest {
  title?: string;
  parentTitle?: string;
  keywords: string[];
  excerpt: string;
  excerptLength: number;
  hasImage: boolean;
  language?: "zh" | "en";
}
export interface RecallHintResult { lines: string[]; source: "ai" | "device" | "structured"; }
export interface ReaderLike {
  refreshSceneSettings?(): void;
  getScrollContainer(): HTMLElement;
  getFilePath(): string | null;
  getState?(): Record<string, unknown>;
  flashAnnotation(annId: string): void;
  /** Reader-local title-link state. Matching never mutates card or learning data. */
  getTitleLinksEnabled?(): boolean;
  setTitleLinksEnabled?(on: boolean): void;
  /** Public view-session recall actions; never mutate persisted learning data. */
  getRecallMode?(): boolean;
  setRecallMode?(on: boolean): void;
  getRecallCoverAll?(): boolean;
  setRecallCoverAll?(on: boolean): void;
  getRecallHierarchy?(): number;
  setRecallHierarchy?(level: number): void;
  getRecallAiHint?(): boolean;
  setRecallAiHint?(on: boolean): void;
  getRecallHintLanguage?(): "auto" | "zh" | "en";
  setRecallHintLanguage?(language: "auto" | "zh" | "en"): void;
  setRecallHintProvider?(provider?: (request: RecallHintRequest) => Promise<RecallHintResult>): void;
  getRecallSetting?(key: RecallOptionKey): boolean;
  setRecallSetting?(key: RecallOptionKey, on: boolean): void;
  getActiveHandwritingPreset?(): HandwritingPresetId;
  setActiveHandwritingPreset?(preset: HandwritingPresetId): void;
  getHandwritingPreset?(): HandwritingPresetSpec;
  openHandwritingPresets?(anchor?: HTMLElement): void;
  /** PDF 专有：返回 pdf.js 文档对象（Word 无，故可选） */
  getDoc?(): any;
  getCurrentPage?(): number;
  subscribeCurrentPageChange?(listener: () => void): () => void;
  /** Reader-owned paper projection, shared by main view and navigation previews. */
  getPageViewport?(page: any, scale: number): any;
  getDisplayPages?(): PdfDisplayPage[];
  gotoDisplayPage?(number: number): Promise<void>;
  renderDisplayThumbnail?(number: number, canvas: HTMLCanvasElement): Promise<void>;
  /** PDF 专有：跳转到某页（Word 无，故可选） */
  gotoPage?(n: number): void;
  gotoSourcePage?(n: number): void;
  getDisplayAnnotation?(annotation: Annotation): Annotation;
  subscribePageChanges?(listener: () => void): () => void;
  /** Reader-owned targets remain valid only while their source document is open. */
  getNavigationOutline?(): ReaderContentsEntry[];
  getEditableOutline?(): Promise<DocumentOutlineItem[]>;
  setEditableOutline?(items: DocumentOutlineItem[]): Promise<void>;
  navigateToOutline?(item: DocumentOutlineItem): void;
}

export type RecallOptionKey =
  | "maskCardBody"
  | "maskEmphasisImages"
  | "maskHighlighter"
  | "maskDocumentExcerpts"
  | "maskMindMapTitles"
  | "blurExcerpts"
  | "singleReveal"
  | "structuredHint"
  | "onDeviceAiHint";

// ===== 持久化结构 =====
export interface PluginData {
  settings: MarginStudySettings;
  cards: Card[];
  nodes: MindNode[];
  edges: Edge[];
  srs: Record<string, CardState>;
  docMeta?: Record<string, DocMeta>;
  reviewHistory?: Record<string, number>; // 日期(YYYY-MM-DD) → 当日复习张数
  schemaVersion?: number;
  revision?: number;
  writerId?: string;
  savedAt?: string;
  reviewLogs?: import("./review/contracts").ReviewLog[];
  reviewPending?: import("./review/contracts").ReviewPending[];
  reviewDecks?: ReviewDeck[];
  activeReviewDeckId?: string;
  cardTemplates?: import("./review/contracts").CardTemplate[];
  /** User scene templates are additive; built-ins are resolved without persisting defaults. */
  sceneTemplates?: StudySceneTemplate[];
  studySets?: StudySet[];
  canvases?: MindCanvas[];
  activeStudySetId?: string;
  activeCanvasId?: string;
  documents?: DocumentRecord[];
  workspaceState?: Record<string, unknown>;
}

export interface AnnotationSidecar {
  annotations: Annotation[];
}
