import { TFile } from "obsidian";
import { PDFDocument, degrees } from "pdf-lib";
import type { ReaderView } from "./readerView";
import type { PdfPageEdits } from "../types";
import { croppedPageViewport } from "./pageCrop";
import { flattenPdfAnnotations } from "./exportAnnotations";
import { copyInteractivePage, preservePdfInteractions, writeDocumentOutline, type ExportedSourcePage } from "./pdfInteractiveExport";
import { exportExtendPage } from "./extendExport";

export interface EditedPdfExportOptions {
  pages?: number[];
  includeAnnotations?: boolean;
  signal?: AbortSignal;
}

/** Build completely in memory. The caller owns the final save; sources are read-only. */
export async function buildEditedPdf(reader: ReaderView, edits: PdfPageEdits, options: EditedPdfExportOptions, current: () => void): Promise<Uint8Array> {
  const output = await PDFDocument.create(), source = reader.getDoc(), crop = reader.getPageCrop();
  const annotations = options.includeAnnotations === false ? [] : reader.getPdfExportAnnotations();
  const pages = options.pages === undefined ? edits.pages.map((_, index) => index + 1) : [...new Set(options.pages)].sort((a,b) => a-b);
  if (!pages.length || pages.some(page => !Number.isSafeInteger(page) || page < 1 || page > edits.pages.length)) throw new Error("请选择有效的导出页面");
  const documents = new Map<string, Promise<PDFDocument>>();
  const open = (path: string) => {
    let document = documents.get(path);
    if (!document) {
      document = (async () => {
        const file = reader.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new Error(`导出来源不存在：${path}`);
        const bytes = await reader.app.vault.readBinary(file); current();
        return PDFDocument.load(bytes);
      })(); documents.set(path, document);
    }
    return document;
  };
  const exportedSources: ExportedSourcePage[]=[];
  for (const number of pages) {
    current(); const entry = edits.pages[number - 1];
    const original = await source.getPage(number); current();
    const viewport = croppedPageViewport(original, 1, crop), box = viewport.viewBox;
    const path = entry.imported?.path ?? reader.getFilePath()!, pageNumber = entry.imported?.page ?? entry.sourcePage;
    const page = pageNumber === undefined ? output.addPage([entry.width!,entry.height!]) : copyInteractivePage(await open(path),pageNumber,output);
    current();
    if (pageNumber !== undefined) { output.addPage(page);exportedSources.push({source:await open(path),sourcePage:pageNumber,page}); }
    page.setMediaBox(box[0],box[1],box[2]-box[0],box[3]-box[1]);
    page.setCropBox(box[0],box[1],box[2]-box[0],box[3]-box[1]);
    page.setRotation(degrees(viewport.rotation));
    if (annotations.length) await flattenPdfAnnotations(output,page,number,original,viewport,crop,annotations,current,async path => {
      if (!path.startsWith("_marginstudy-media/")) return path;
      const bytes = new Uint8Array(await reader.app.vault.adapter.readBinary(path));
      const mime = path.endsWith(".jpg") ? "jpeg" : path.slice(path.lastIndexOf(".") + 1);
      let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      return `data:image/${mime};base64,${btoa(binary)}`;
    });
    if(options.includeAnnotations!==false){const notes=reader.getExtendNotes().filter(note=>note.pageId===entry.id);if(notes.length)await exportExtendPage(output,page,reader,number,viewport,notes,current);}
  }
  current();preservePdfInteractions(output,exportedSources);
  if(reader.plugin.store.getDocMeta(reader.getFilePath()!).documentOutline !== undefined) writeDocumentOutline(output,await reader.getEditableOutline(),pages);
  current(); output.setProducer("MarginStudy");
  const bytes = await output.save(); current(); return bytes;
}
