import type { StudySceneSelection, StudySceneTemplate } from "../types";
import type { Store } from "../model/store";

export function toggleStudyInterface(store: Store): boolean {
  const id = store.activeStudySetId;
  const current = id && store.getStudyScene(id);
  if (!id || !current) return false;
  store.setStudyInterface(id, current.interfaceMode === "scenes" ? "traditional" : "scenes");
  return true;
}

/** Mac MN5 5.0.0 evidence: evidence/mn5-alignment-20261029/step1-desktop/A01-desktop-contract.json.
 * These semantic tool keys identify our adapters; they are not MN proprietary serialization IDs.
 */
const templates: StudySceneTemplate[] = [
  { id: "standard", version: 1, name: "标准", scenes: [
    { id: "excerpt", label: "摘录", tools: ["excerpt.hand", "excerpt.text", "excerpt.rectangle", "excerpt.more", "continuous-excerpt", "ink", "undo", "redo", "title-links", "block-selection", "document-notebook", "more"] },
    { id: "handwriting", label: "手写", tools: ["pen.1", "pen.2", "highlighter", "pencil", "lasso", "eraser", "hand", "text-box", "image-box", "undo", "redo", "ink-layers", "more"] },
    { id: "organize", label: "整理", tools: ["board", "hierarchy", "copy-move", "links", "selection", "ink", "undo", "redo", "more"] },
    { id: "recall", label: "回忆", tools: ["hierarchy", "recall-reset", "ai-hint", "recall-settings", "ink", "auto-review", "review", "more"] },
  ] },
  { id: "read-write-recall", version: 1, name: "读写忆（样例）", scenes: [
    { id: "reading", label: "阅读", tools: ["theme", "title-links", "block-selection", "more"] },
    { id: "writing", label: "书写", tools: ["excerpt.text", "excerpt.rectangle", "excerpt.extend", "continuous-excerpt", "pen.1", "pen.2", "highlighter", "pen.more", "lasso", "eraser", "hand", "undo", "redo", "more"] },
    { id: "recall", label: "回忆", tools: ["hierarchy", "recall-reset", "ai-hint", "recall-settings", "ink", "auto-review"] },
  ] },
  { id: "practice-cards", version: 1, name: "刷题卡片", scenes: [
    { id: "recall", label: "回忆", tools: ["hierarchy", "recall-reset", "ai-hint", "recall-settings", "ink", "auto-review", "review", "more"] },
  ], cardTemplate: { fields: ["问题", "答案", "解析", "错因"], front: "问题：{{front}}", back: "答案：{{back}}\n解析：\n错因：" } },
  { id: "foreign-vocabulary", version: 1, name: "外刊生词", scenes: [
    { id: "reading", label: "阅读", tools: ["theme", "title-links", "block-selection", "more"] },
    { id: "recall", label: "回忆", tools: ["hierarchy", "recall-reset", "ai-hint", "recall-settings", "ink", "auto-review", "review", "more"] },
  ], cardTemplate: { fields: ["词", "原形", "音标", "释义", "例句"], front: "词：{{front}}", back: "原形：\n音标：\n释义：{{back}}\n例句：" } },
];

export const installableSceneTemplateIds = ["practice-cards", "foreign-vocabulary"] as const;

/** Callers may edit their copy without mutating a built-in or another studyset. */
export function builtinSceneTemplates(): StudySceneTemplate[] {
  return JSON.parse(JSON.stringify(templates));
}

export function defaultStudyScene(): StudySceneSelection {
  return { templateId: "standard", sceneId: "excerpt", interfaceMode: "scenes" };
}

/** Unsupported versions remain stored but are never rendered as actionable templates. */
export function isSupportedSceneTemplate(value: unknown): value is StudySceneTemplate {
  if (!value || typeof value !== "object") return false;
  const item = value as StudySceneTemplate;
  if (item.version !== 1 || typeof item.id !== "string" || !item.id.trim() || typeof item.name !== "string" || !item.name.trim() || !Array.isArray(item.scenes) || !item.scenes.length) return false;
  if (item.colors !== undefined && (!Array.isArray(item.colors) || !item.colors.length || item.colors.length > 32 || !item.colors.every(color => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)))) return false;
  if (item.excerptPopup !== undefined && typeof item.excerptPopup !== "boolean") return false;
  if (item.statusBar !== undefined && !["full", "compact", "hidden"].includes(item.statusBar)) return false;
  if (item.textSelectionMenuActions !== undefined && (!Array.isArray(item.textSelectionMenuActions) || item.textSelectionMenuActions.length > 40 || !item.textSelectionMenuActions.every(id => typeof id === "string" && id.length > 0 && id.length < 100))) return false;
  if (item.cardTemplate !== undefined && (!item.cardTemplate || typeof item.cardTemplate.front !== "string" || typeof item.cardTemplate.back !== "string" || !Array.isArray(item.cardTemplate.fields) || !item.cardTemplate.fields.length || item.cardTemplate.fields.length > 20 || !item.cardTemplate.fields.every(field => typeof field === "string" && field.trim().length > 0 && field.length <= 100) || new Set(item.cardTemplate.fields).size !== item.cardTemplate.fields.length)) return false;
  if (item.handwritingPresets !== undefined && (!Array.isArray(item.handwritingPresets) || !item.handwritingPresets.length || item.handwritingPresets.length > 32 || !item.handwritingPresets.every(p => p && typeof p.id === "string" && p.id.length > 0 && typeof p.label === "string" && p.label.length > 0 && ["ballpoint","fountain","pencil","highlighter"].includes(p.type) && /^#[0-9a-f]{6}$/i.test(p.color) && Number.isFinite(p.width) && p.width >= .5 && p.width <= (p.type === "highlighter" ? 64 : 24) && Number.isFinite(p.opacity) && p.opacity >= 0 && p.opacity <= 1 && [p.documentWidth,p.mindmapWidth,p.cardWidth].every(width => width === undefined || Number.isFinite(width) && width >= .5 && width <= (p.type === "highlighter" ? 64 : 24))))) return false;
  if (item.handwritingPresets && new Set(item.handwritingPresets.map(p => p.id)).size !== item.handwritingPresets.length) return false;
  if (item.handwritingPresets?.some(p => p.recallPurpose !== undefined && !["mask","highlight"].includes(p.recallPurpose))) return false;
  const ids = new Set<string>();
  const knownTools = new Set(templates.flatMap(template => template.scenes.flatMap(scene => scene.tools)));
  return item.scenes.every(scene => {
    if (!scene || !["reading", "writing", "excerpt", "handwriting", "organize", "recall"].includes(scene.id) || ids.has(scene.id) || typeof scene.label !== "string" || !scene.label.trim() || !Array.isArray(scene.tools) || !scene.tools.every(tool => knownTools.has(tool))) return false;
    ids.add(scene.id); return true;
  });
}
