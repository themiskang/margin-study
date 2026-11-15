import { Notice, setIcon } from "obsidian";
import type { ReaderView } from "./readerView";
import { loadPdf } from "./pdfjs";
import { createModal } from "../utils/modal";
import { el } from "../utils/dom";

/** The source picker is a temporary preview. Nothing is written until Add is pressed. */
export function openPdfPagePicker(reader: ReaderView, afterPage: number, file: File, execute: (action: () => Promise<void>) => Promise<void>): () => void {
  const path = reader.getFilePath(), pageId = reader.getPdfPageId(afterPage), abort = new AbortController();
  let closed = false, pdf: any = null, observer: IntersectionObserver | null = null;
  const tasks = new Set<any>(), selected = new Set<number>();
  const {bg,modal,close} = createModal("Thumbnails", () => {
    if (closed) return; closed = true; abort.abort(); observer?.disconnect();
    tasks.forEach(task=>task.cancel()); tasks.clear(); if (pdf) void pdf.destroy();
  });
  bg.classList.add("ms-pdf-import-bg"); modal.classList.add("ms-pdf-import-modal");
  modal.setAttribute("role","dialog"); modal.setAttribute("aria-label","Thumbnails"); modal.setAttribute("aria-modal","true");
  const heading = modal.querySelector("h3")!;
  heading.removeAttribute("style");
  const bar = el("div",{class:"ms-pdf-import-header"});
  const cancel = el("button",{"aria-label":"关闭 PDF 选页",title:"关闭"}); setIcon(cancel,"x"); cancel.addEventListener("click",close);
  const addSelected = el("button",{text:"添加所选","aria-label":"添加所选"}); addSelected.disabled = true;
  const addAll = el("button",{text:"全部添加","aria-label":"全部添加"}); addAll.disabled = true;
  const actions = el("div",{class:"ms-pdf-import-actions"}); actions.append(addSelected,addAll); bar.append(cancel,heading,actions);
  const grid = el("div",{class:"ms-pdf-import-grid"}), status = el("div",{class:"ms-pdf-import-status",role:"status",text:"加载中…"});
  modal.append(bar,status,grid);
  const commit = (all: boolean) => {
    if (closed || !pdf) return;
    if (reader.getFilePath() !== path || reader.getPdfPageId(afterPage) !== pageId) { close(); new Notice("文档或页面已切换，插页已取消"); return; }
    const pages = all ? Array.from({length:pdf.numPages},(_,index)=>index+1) : [...selected].sort((a,b)=>a-b);
    if (!pages.length) return;
    close(); void execute(()=>reader.insertPdfPages(afterPage,file,pages));
  };
  addSelected.addEventListener("click",()=>commit(false)); addAll.addEventListener("click",()=>commit(true)); cancel.focus();
  void (async()=>{
    try {
      if (!/\.pdf$/i.test(file.name)) throw new Error("请选择 PDF 文件");
      const bytes = await file.arrayBuffer(); if (closed) return;
      pdf = await loadPdf(bytes,abort.signal);
      if (closed) { await pdf.destroy(); return; }
      if (pdf.numPages > 10000) throw new Error("PDF 页数超过可插入范围");
      status.remove(); addAll.disabled = false;
      const queue: HTMLElement[] = []; let active = 0;
      const pump = () => {
        while (!closed && active < 3 && queue.length) {
          const tile = queue.shift()!, number = Number(tile.dataset.page); active++;
          void (async()=>{
            try {
              const page = await pdf.getPage(number); if (closed) return;
              const original = page.getViewport({scale:1}), viewport = page.getViewport({scale:Math.min(1,540/Math.max(original.width,original.height))});
              const canvas = tile.querySelector("canvas")!; canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
              const task = page.render({canvasContext:canvas.getContext("2d")!,viewport}); tasks.add(task);
              try { await task.promise; } finally { tasks.delete(task); }
            } catch (error) { if (!closed) { tile.classList.add("is-error"); tile.title = String(error); addSelected.disabled = true; addAll.disabled = true; status.textContent="无法读取 PDF 页面，请关闭后重试"; modal.insertBefore(status,grid); } }
            finally { active--; pump(); }
          })();
        }
      };
      observer = new IntersectionObserver(entries=>{
        for (const entry of entries) if (entry.isIntersecting) { observer!.unobserve(entry.target); queue.push(entry.target as HTMLElement); }
        pump();
      },{root:grid,rootMargin:"300px"});
      for (let number = 1; number <= pdf.numPages; number++) {
        const tile = el("button",{class:"ms-pdf-import-page","aria-label":`Select PDF Page ${number}`,"aria-pressed":"false","data-page":String(number)});
        const check = el("span",{class:"ms-pdf-import-check","aria-hidden":"true"}), paper = el("div",{class:"ms-pdf-import-paper"}); paper.append(el("canvas"));
        tile.append(check,paper,el("span",{class:"ms-pdf-import-number",text:String(number)}));
        tile.addEventListener("click",()=>{
          if (selected.has(number)) selected.delete(number); else selected.add(number);
          tile.setAttribute("aria-pressed",String(selected.has(number))); check.textContent = selected.has(number) ? "✓" : "";
          addSelected.disabled = !selected.size || !!grid.querySelector(".is-error");
        }); grid.append(tile); observer.observe(tile);
      }
    } catch (error) { if (!closed) { addSelected.disabled = true; addAll.disabled = true; status.textContent = error instanceof Error ? error.message : String(error); if (!status.isConnected) modal.insertBefore(status,grid); } }
  })();
  return close;
}
