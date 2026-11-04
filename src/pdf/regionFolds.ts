import type { ReaderView } from "./readerView";
import { notebookMeta } from "../annot/documentNotebooks";
import { el } from "../utils/dom";

export interface FoldBand { top: number; bottom: number; height: number; ids: string[]; }

/** Resolve stable source-page IDs and canonical PDF coordinates only when rendering. */
export function regionFoldBands(reader: ReaderView, page: number, base: any): FoldBand[] {
  const projection = base?.convertToViewportRectangle ? base : reader.getPageRecord(page)?.baseViewport;
  if (!projection?.convertToViewportRectangle) return [];
  const ratio = base.height / projection.height, scale = base.scale ?? (projection.scale ?? reader.getScale()) * ratio;
  const meta = notebookMeta(reader.plugin.store.getDocMeta(reader.getFilePath() ?? ""));
  const bands: FoldBand[] = [];
  for (const fold of meta.pdfRegionFolds ?? []) {
    if (fold.pageId !== reader.getPdfPageId(page) || !fold.rects?.length) continue;
    const ys = fold.rects.flatMap(rect => {
      const box = projection.convertToViewportRectangle([rect.x, rect.y, rect.x + rect.w, rect.y + rect.h]);
      return [box[1] * ratio, box[3] * ratio];
    });
    const top = Math.max(0, Math.min(...ys)), bottom = Math.min(base.height, Math.max(...ys));
    const height = Math.min(6 * scale, bottom - top);
    if ([top, bottom].every(Number.isFinite) && bottom - top > height + .01) bands.push({ top, bottom, height, ids: [fold.id] });
  }
  const merged: FoldBand[] = [];
  for (const band of bands.sort((a, b) => a.top - b.top)) {
    const last = merged[merged.length - 1];
    if (last && band.top <= last.bottom) { last.bottom = Math.max(last.bottom, band.bottom); last.ids.push(...band.ids); }
    else merged.push({ ...band, ids: [...band.ids] });
  }
  return merged;
}

export function foldCoordinates(bands: FoldBand[]) {
  const down = (y: number) => {
    let removed = 0;
    for (const band of bands) {
      if (y <= band.top) break;
      if (y < band.bottom) return band.top - removed + (y - band.top) / (band.bottom - band.top) * band.height;
      removed += band.bottom - band.top - band.height;
    }
    return y - removed;
  };
  const up = (y: number) => {
    let removed = 0;
    for (const band of bands) {
      const top = band.top - removed;
      if (y <= top) break;
      if (y < top + band.height) return band.top + (y - top) / band.height * (band.bottom - band.top);
      removed += band.bottom - band.top - band.height;
    }
    return y + removed;
  };
  return { down, up };
}

export function renderRegionFolds(reader: ReaderView, page: number): void {
  const rec = reader.getPageRecord(page); if (!rec?.baseViewport || !rec.viewport) return;
  rec.wrapper.querySelectorAll(":scope > .ms-region-fold").forEach(item => item.remove());
  for (const band of regionFoldBands(reader, page, rec.baseViewport)) {
    const row = el("div", { class: "ms-region-fold" });
    row.style.top = `${(rec.viewport as any).extendDown(band.top)}px`;
    row.style.height = `${band.height}px`;
    const expand = el("button", { type: "button", "aria-label": "展开折叠区域", title: "展开折叠区域", text: "展开" });
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) row.addEventListener(type, event => event.stopPropagation());
    expand.addEventListener("click", () => { expand.disabled = true; void reader.expandRegionFolds(band.ids); });
    row.append(expand); rec.wrapper.append(row);
  }
}
