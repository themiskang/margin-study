import type { PdfRect, RecallOptionKey } from "../types";

export function maskRectKey(page: number, rect: PdfRect): string {
  const one = (value: number) => Object.is(value,-0) ? "-0.0" : value.toFixed(1);
  return `maskrect:${page}|${[rect.x,rect.y,rect.w,rect.h].map(one).join(",")}`;
}
export function maskRangeKey(noteId: string, start: number, length: number): string {
  return noteId ? `maskrange:${noteId}|${start},${length}` : "";
}

/** View session only: never included in PluginData, sidecars or review history. */
export class RecallSession {
  private revealed = new Set<string>();
  private options: Record<RecallOptionKey, boolean> = {
    maskCardBody: true,
    maskEmphasisImages: true,
    maskHighlighter: true,
    maskDocumentExcerpts: true,
    maskMindMapTitles: false,
    blurExcerpts: false,
    singleReveal: false,
    structuredHint: true,
    onDeviceAiHint: false,
  };
  has(key: string): boolean { return this.revealed.has(key); }
  clear(): void { this.revealed.clear(); }
  getOption(key: RecallOptionKey): boolean { return this.options[key]; }
  setOption(key: RecallOptionKey, on: boolean): void { this.options[key] = on; }
  toggle(key: string, singlePeek = false): void {
    if (!key) return;
    if (this.revealed.has(key)) this.revealed.delete(key);
    else { if (singlePeek) this.revealed.clear(); this.revealed.add(key); }
  }
}
