import type { StudySceneTemplate } from "../types";
import { builtinSceneTemplates } from "./scenes";

const behaviors = ["read", "write", "recall"] as const;
type Behavior = typeof behaviors[number];
const sceneIds = { read: "reading", write: "writing", recall: "recall" } as const;
const labels = { read: "阅读", write: "书写", recall: "回忆" };
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

export function importMn5SceneTemplate(value: any): StudySceneTemplate {
  const modes = value?.bottom?.modes;
  const tabs = value?.toolbar?.tabs;
  if (value?.schema !== 3 || typeof value.id !== "string" || !value.id.trim() || typeof value.name !== "string" || !value.name.trim()
    || (value.base !== undefined && typeof value.base !== "string") || !Array.isArray(modes) || !modes.length || !strings(tabs)
    || !modes.every((mode: any) => mode && typeof mode.id === "string" && mode.id && behaviors.includes(mode.behavior)
      && (mode.tools === undefined || strings(mode.tools)) && (mode.overflow === undefined || strings(mode.overflow)))
    || new Set(modes.map((mode: any) => mode.id)).size !== modes.length
    || new Set(modes.map((mode: any) => mode.behavior)).size !== modes.length
    || new Set(tabs).size !== tabs.length || tabs.length !== modes.length || !tabs.every(tab => modes.some((mode: any) => mode.id === tab))
    || typeof value.home !== "string" || !Array.isArray(value.plugins)
    || !strings(value.surfaces?.bottomRead?.visible) || !strings(value.surfaces?.dock?.visible) || !strings(value.surfaces?.dockPinned)
    || typeof value.surfaces?.excerptResultBar !== "boolean" || typeof value.review?.autoAdd !== "string"
    || typeof value.review?.rule?.excludeGroupChildren !== "boolean" || typeof value.review?.rule?.excludeToc !== "boolean"
    || typeof value.resume?.card !== "string" || typeof value.coach?.enabled !== "boolean") throw new Error("模板版本或内容无效");
  const defaults = builtinSceneTemplates().find(template => template.id === "read-write-recall")!;
  const scenes = tabs.map(tab => {
    const mode = modes.find((entry: any) => entry.id === tab);
    const behavior = mode.behavior as Behavior;
    const fallback = defaults.scenes.find(scene => scene.id === sceneIds[behavior])!;
    return { id: sceneIds[behavior], label: labels[behavior], tools: [...fallback.tools] };
  });
  return JSON.parse(JSON.stringify({
    id: value.id, version: 1, name: value.name, schema: 3, scenes,
    mn5: { id: value.id, ...(value.base === undefined ? {} : { base: value.base }), tabs, modes: modes.map((mode: any) => ({
      id: mode.id, behavior: mode.behavior, tools: mode.tools ?? [], overflow: mode.overflow ?? [],
    })), home: value.home, plugins: value.plugins },
    surfaces: value.surfaces, review: value.review, resume: value.resume, coach: value.coach,
  }));
}

export function exportMn5SceneTemplate(template: StudySceneTemplate): object {
  const modes = template.mn5?.modes ?? behaviors.filter(behavior => template.scenes.some(scene =>
    behavior === "read" ? ["reading", "excerpt"].includes(scene.id) : behavior === "write" ? ["writing", "handwriting", "organize"].includes(scene.id) : scene.id === "recall"
  )).map(behavior => ({ id: behavior, behavior, tools: [], overflow: [] }));
  return {
    ...(template.mn5?.base === undefined ? {} : { base: template.mn5.base }),
    id: template.mn5?.id ?? template.id, name: template.name, schema: 3,
    toolbar: { tabs: template.mn5?.tabs ?? modes.map(mode => mode.id) }, bottom: { modes },
    surfaces: template.surfaces ?? { bottomRead: { visible: ["theme", "titleLinks", "blockSelect"] }, dock: { visible: ["contents", "ai", "research"] }, dockPinned: ["contents", "ai"], excerptResultBar: true },
    review: template.review ?? { autoAdd: "off", rule: { excludeGroupChildren: true, excludeToc: true } },
    resume: template.resume ?? { card: "silent" }, coach: template.coach ?? { enabled: false },
    home: template.mn5?.home ?? "studyset", plugins: template.mn5?.plugins ?? [],
  };
}
