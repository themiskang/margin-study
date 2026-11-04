import { DEFAULT_HANDWRITING_PRESETS } from "../types";
import type { HandwritingPresetSpec, MarginStudySettings } from "../types";

export type HandwritingContext = "document" | "mindmap" | "card";

export function clampHandwritingWidth(type: HandwritingPresetSpec["type"], value: number): number {
  return Math.max(.5, Math.min(type === "highlighter" ? 64 : 24, value));
}

export function handwritingPresetWidth(preset: HandwritingPresetSpec, context: HandwritingContext): number {
  const value = context === "document" ? preset.documentWidth : context === "mindmap" ? preset.mindmapWidth : preset.cardWidth;
  return Number.isFinite(value) ? Number(value) : preset.width;
}

/** Legacy three-pen settings gain an effective marker without being rewritten on read. */
export function handwritingPresets(settings: MarginStudySettings): HandwritingPresetSpec[] {
  const presets = settings.handwritingPresets?.length ? settings.handwritingPresets : DEFAULT_HANDWRITING_PRESETS;
  if (settings.handwritingPresetsVersion === 2 || presets.some(item => item.type === "highlighter")) return presets;
  const result = presets.slice(), marker = DEFAULT_HANDWRITING_PRESETS.find(item => item.type === "highlighter")!;
  result.splice(Math.min(2, result.length), 0, { ...marker });
  return result;
}

/** Only an explicit management action materializes the complete list, including deletions. */
export function saveHandwritingPresets(settings: MarginStudySettings, presets: HandwritingPresetSpec[]): void {
  settings.handwritingPresets = presets;
  settings.handwritingPresetsVersion = 2;
}
