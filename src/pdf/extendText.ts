import type { PdfExtendNote } from "../types";

export function isExtendTextBand(note: PdfExtendNote): boolean {
  return !!note.text.trim() && !note.images?.length && !note.textBoxes?.length && !note.ink?.some(record => record.strokes.length);
}
/** MN4 embeds text-only comments at 3/4 of the editor's nominal text size. */
export function extendTextScale(note: PdfExtendNote): number { return isExtendTextBand(note) ? .75 : 1; }
export function extendExportText(note: PdfExtendNote) {
  const scale = extendTextScale(note);
  return { kind: "text" as const, fontSize: 16 * scale, textRuns: note.runs?.map(run => ({ ...run, style: { ...run.style, fontSize: run.style.fontSize * scale } })) };
}
