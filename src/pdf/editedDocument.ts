import type { Annotation, DocMeta, PdfEditedPage, PdfPageEdits } from "../types";
import { annotationGeometry } from "../anchors/pdfGeometry";
import { loadPdf } from "./pdfjs";

export function originalPdfPages(count: number): PdfPageEdits {
  return { version: 1, pages: Array.from({ length: count }, (_, index) => ({ id: `source:${index + 1}`, sourcePage: index + 1 })) };
}
export function validatePdfPageEdits(value: PdfPageEdits, sourceCount: number): PdfPageEdits {
  if (value?.version !== 1 || !Array.isArray(value.pages) || !value.pages.length || value.pages.length > 10000) throw new Error("PDF 页编辑记录无效");
  const ids = new Set<string>();
  for (const page of value.pages) {
    if (!page || typeof page.id !== "string" || !page.id || ids.has(page.id)) throw new Error("PDF 页面标识无效");
    ids.add(page.id);
    if (page.rotation !== undefined && ![0,90,180,270].includes(page.rotation)) throw new Error("PDF 页面旋转角度无效");
    if (page.imported !== undefined) {
      if (page.sourcePage !== undefined || !page.id.startsWith("import:") || !/^MarginStudyImports\/page-assets\/[A-Za-z0-9_-]+\.pdf$/.test(page.imported.path) || !Number.isInteger(page.imported.page) || page.imported.page < 1 || ![page.width,page.height].every(size=>typeof size === "number" && Number.isFinite(size) && size > 0 && size <= 14400)) throw new Error("插入的 PDF 页面记录无效");
    } else if (page.sourcePage !== undefined) {
      if (!Number.isInteger(page.sourcePage) || page.sourcePage < 1 || page.sourcePage > sourceCount || page.id !== `source:${page.sourcePage}`) throw new Error("原 PDF 页面已不存在");
    } else if (!page.id.startsWith("blank:") || ![page.width, page.height].every(size => typeof size === "number" && Number.isFinite(size) && size > 0 && size <= 14400)) throw new Error("空白页面尺寸无效");
  }
  return structuredClone(value);
}
function blankPdf(width: number, height: number): ArrayBuffer {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> >>`];
  let text = "%PDF-1.7\n", offsets = [0];
  objects.forEach((object, index) => { offsets.push(text.length); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = text.length;
  text += `xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

/** A PDF.js-compatible display document. The source bytes and annotation identities stay intact. */
export class EditedPdfDocument {
  readonly edits: PdfPageEdits;
  private blanks = new Map<string, Promise<any>>();
  private imports = new Map<string, Promise<any>>();
  private destroyed = false;
  constructor(readonly source: any, edits: PdfPageEdits, private signal?: AbortSignal, private loadImported?: (path: string, signal?: AbortSignal) => Promise<any>) { this.edits = validatePdfPageEdits(edits, source.numPages); }
  get numPages(): number { return this.edits.pages.length; }
  async getPage(number: number): Promise<any> {
    const entry = this.edits.pages[number - 1];
    if (this.destroyed || this.signal?.aborted) throw new Error("PDF 阅读器已关闭");
    if (!Number.isInteger(number) || !entry) throw new Error("PDF 页码超出范围");
    if (entry.sourcePage) return this.presentPage(await this.source.getPage(entry.sourcePage), entry);
    if (entry.imported) {
      const {path,page} = entry.imported;
      let document = this.imports.get(path);
      if (!document) {
        if (!this.loadImported) throw new Error("插页 PDF 无法读取");
        document = this.loadImported(path,this.signal); this.imports.set(path,document);
      }
      const doc = await document;
      if (this.destroyed || this.signal?.aborted) throw new Error("PDF 阅读器已关闭");
      return this.presentPage(await doc.getPage(page),entry);
    }
    let document = this.blanks.get(entry.id);
    if (!document) { document = loadPdf(blankPdf(entry.width!, entry.height!), this.signal); this.blanks.set(entry.id, document); }
    const doc = await document;
    if (this.destroyed || this.signal?.aborted) throw new Error("PDF 阅读器已关闭");
    return this.presentPage(await doc.getPage(1), entry);
  }
  private presentPage(page: any, entry: PdfEditedPage): any {
    return new Proxy(page, { get(target, property) {
      if (property === "marginStudyRotation") return entry.rotation ?? 0;
      if (property === "marginStudySourcePage") return target;
      if (property === "getViewport") return (options: any) => target.getViewport({ ...options, rotation: options.rotation ?? ((target.rotate ?? 0) + (entry.rotation ?? 0)) % 360 });
      const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
    } });
  }
  private sourceIndex(index: number): number { return this.edits.pages.findIndex(page => page.sourcePage === index + 1); }
  async getOutline(): Promise<any[]> {
    const map = (items: any[]): any[] => items.map(item => ({ ...item,
      dest: Array.isArray(item.dest) && typeof item.dest[0] === "number" ? [this.sourceIndex(item.dest[0]), ...item.dest.slice(1)] : item.dest,
      items: map(item.items ?? []) }));
    return map(await this.source.getOutline?.() ?? []);
  }
  async getDestination(name: string): Promise<any> { const dest = await this.source.getDestination(name); return Array.isArray(dest) && typeof dest[0] === "number" ? [this.sourceIndex(dest[0]), ...dest.slice(1)] : dest; }
  async getPageIndex(ref: any): Promise<number> { const index = this.sourceIndex(await this.source.getPageIndex(ref)); if (index < 0) throw new Error("目录页面已移除"); return index; }
  async destroy(): Promise<void> {
    if (this.destroyed) return; this.destroyed = true;
    await Promise.allSettled([this.source.destroy(), ...[...this.blanks.values(),...this.imports.values()].map(async promise => (await promise).destroy())]);
    this.blanks.clear(); this.imports.clear();
  }
}

export function mapEditedPdfAnnotation(annotation: Annotation, edits: PdfPageEdits): Annotation {
  const pageFor = (number: number) => {
    const id = annotation.pdfReferencePages?.find(entry => entry.page === number)?.id ?? `source:${number}`;
    return edits.pages.findIndex(entry => entry.id === id) + 1;
  };
  const geometry = annotationGeometry(annotation).flatMap(part => { const page = pageFor(part.page); return page ? [{ page, rects: part.rects }] : []; });
  const page = pageFor(annotation.page ?? 1);
  return { ...annotation, page: page || -1, rects: geometry[0]?.rects ?? [], pdfGeometry: geometry };
}
export function remapEditedPdfMetadata(meta: DocMeta, previous: PdfPageEdits, next: PdfPageEdits, restored?: DocMeta): Partial<DocMeta> {
  const map = (state: DocMeta, saved?: DocMeta): Partial<DocMeta> => {
    const result: Partial<DocMeta> = {};
    for (const field of ["bookmarks", "foldedPages"] as const) if (state[field] || saved?.[field]) {
      const mapped = (state[field] ?? []).flatMap(number => {
      const id = previous.pages[number - 1]?.id, index = next.pages.findIndex(entry => entry.id === id); return index < 0 ? [] : [index + 1];
      });
      // Restore only returning pages. Keep newer choices made on surviving pages.
      for (const number of saved?.[field] ?? []) {
        const id = next.pages[number - 1]?.id;
        if (id && !previous.pages.some(page => page.id === id)) mapped.push(number);
      }
      result[field] = [...new Set(mapped)].sort((a,b) => a-b);
    }
    return result;
  };
  return { ...map(meta,restored), ...(meta.documentNotebookMeta ? { documentNotebookMeta: Object.fromEntries(Object.entries(meta.documentNotebookMeta).map(([id, state]) => [id, { ...state, ...map(state,restored?.documentNotebookMeta?.[id]) }])) } : {}) };
}
