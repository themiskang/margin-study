import type { ReaderView } from "./readerView";
import type { PdfPageEdits } from "../types";
import { buildEditedPdf } from "./editedPdfExport";
import { loadPdf } from "./pdfjs";

export interface LongImageOptions {
  /** Display pages to include, in the same form as the PDF export. */
  pages?: number[];
  /** Pixel density of the widest page relative to its PDF point size. Defaults to 2. */
  scale?: number;
  /** Background painted behind every page. */
  background?: string;
  /** Abort a long export; an aborted export never produces bytes. */
  signal?: AbortSignal;
  /** Stacked-sheet height cap in pixels. Defaults to the production limit. */
  maxHeight?: number;
  /** Total pixel cap for the stacked sheet. Defaults to the production limit. */
  maxPixels?: number;
}

export interface LongImageResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  pages: number;
}

const MAX_HEIGHT = 32_000;
const MAX_PIXELS = 64_000_000;

/**
 * Render the edited document exactly as the PDF export renders it (page order,
 * crop, rotation, flattened annotations and Extend notes), then stack every page
 * vertically on one white sheet. Nothing is written; the caller owns the save.
 *
 * MarginNote 4 exports every page at one shared width: portrait pages get taller
 * and rotated/landscape pages get shorter, with no side margins and no page gaps.
 * Pages are therefore scaled per page to the common width instead of sharing one
 * pixel scale (which would leave white margins on narrower pages).
 */
export async function buildEditedPdfLongImage(reader: ReaderView, edits: PdfPageEdits, options: LongImageOptions, current: () => void): Promise<LongImageResult> {
  const signal = options.signal, scale = options.scale ?? 2;
  const limitHeight = Math.max(1, Math.floor(options.maxHeight ?? MAX_HEIGHT));
  const limitPixels = Math.max(1, Math.floor(options.maxPixels ?? MAX_PIXELS));
  const cancelled = () => { if (signal?.aborted) throw new Error("导出已取消"); };
  cancelled();
  // Reuse the verified export pipeline so the long image and the PDF agree on
  // content. The produced bytes are flattened and self-contained.
  const pdfBytes = await buildEditedPdf(reader, edits, { pages: options.pages, signal }, current);
  cancelled(); current();
  const pdf = await loadPdf(pdfBytes.slice().buffer);
  let sheet: HTMLCanvasElement | null = null, currentCanvas: HTMLCanvasElement | null = null;
  try {
    // Measure every edited page first, then choose the common width and the one
    // scale that fits the canvas limits. The stack height uses the common-width
    // layout, so a narrow page is not silently shrunk twice and a very tall
    // document never allocates oversized intermediate canvases.
    const plans: { page: any; width: number; height: number }[] = [];
    let fullWidth = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      cancelled(); current();
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const width = Math.max(1, viewport.width), height = Math.max(1, viewport.height);
      plans.push({ page, width, height });
      fullWidth = Math.max(fullWidth, width * scale);
      current();
    }
    if (!plans.length) throw new Error("没有可导出的页面");
    const fullHeight = plans.reduce((sum, plan) => sum + plan.height * fullWidth / plan.width, 0);
    // floor() rounding guarantees the last page is never clipped to meet a cap.
    const ratio = Math.min(1, limitHeight / fullHeight, Math.sqrt(limitPixels / (fullWidth * fullHeight)));
    const width = Math.max(1, Math.floor(fullWidth * ratio));
    const pageHeights = plans.map(plan => Math.max(1, Math.floor(plan.height * width / plan.width)));
    const height = pageHeights.reduce((sum, value) => sum + value, 0);
    sheet = document.createElement("canvas");
    sheet.width = width; sheet.height = height;
    const context = sheet.getContext("2d");
    if (!context) throw new Error("无法创建长图画布");
    context.fillStyle = options.background ?? "#ffffff";
    context.fillRect(0, 0, width, height);
    let y = 0;
    for (const [index, plan] of plans.entries()) {
      cancelled(); current();
      const pageHeight = pageHeights[index];
      currentCanvas = document.createElement("canvas");
      currentCanvas.width = width; currentCanvas.height = pageHeight;
      const renderScale = width / plan.width;
      const task = plan.page.render({ canvasContext: currentCanvas.getContext("2d")!, viewport: plan.page.getViewport({ scale: renderScale }) });
      const abortRender = () => { try { task.cancel(); } catch { /* noop */ } };
      signal?.addEventListener("abort", abortRender, { once: true });
      try { await task.promise; } catch (error) { if (signal?.aborted) throw new Error("导出已取消"); throw error; }
      finally { signal?.removeEventListener("abort", abortRender); }
      cancelled();
      context.drawImage(currentCanvas, 0, 0, width, pageHeight, 0, y, width, pageHeight);
      // The sheet already owns these pixels; release each page bitmap at once so
      // memory stays bounded by the sheet instead of growing with the page count.
      currentCanvas.width = currentCanvas.height = 0; currentCanvas = null;
      y += pageHeight;
      current();
    }
    cancelled();
    const blob = await new Promise<Blob>((resolve, reject) => sheet!.toBlob(value => value ? resolve(value) : reject(new Error("长图无法编码")), "image/png"));
    cancelled();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { bytes, width, height, pages: plans.length };
  } finally {
    if (currentCanvas) currentCanvas.width = currentCanvas.height = 0;
    if (sheet) sheet.width = sheet.height = 0;
    await pdf.destroy();
  }
}
