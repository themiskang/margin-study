/**
 * [INPUT]: 卡片数据、快照图片和手写输入。
 * [OUTPUT]: 卡片快照、手写评论显示与编辑入口。
 * [POS]: 以内容坐标保存卡片手写评论，旧数据读取时迁移。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Notice } from "obsidian";
import type MarginStudyPlugin from "../main";
import type { Card } from "../types";
import { handwritingPresetWidth, handwritingPresets } from "../annot/handwritingPresets";
import { cardInkInput, segmentedCardInkInput } from "../review/drawing";
import { cardImages, commentImage, imageUrl } from "../review/content";
import { el } from "../utils/dom";
import { uid } from "../utils/id";
import { renderMarkdown } from "../utils/markdown";
import { createModal } from "../utils/modal";
import { cardCommentItems } from "./commentOrder";
import { readInkCommentToContent } from "./inkPointsMigration";
import type { CardInkMedia } from "./inkPointsMigration";

type Media = NonNullable<Card["commentMedia"]>[number];
type Snapshot = { image: string; width: number; height: number; parts: { image: string; y: number; height: number }[] };

async function embeddedImage(plugin: MarginStudyPlugin, source: string): Promise<string> {
  const image = new Image(); image.src = imageUrl(plugin, source); await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("卡片图片尺寸无效");
  const scale = Math.min(1, Math.sqrt(4_000_000 / (image.naturalWidth * image.naturalHeight)));
  const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  try { canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height); return canvas.toDataURL("image/png"); }
  finally { canvas.width = canvas.height = 0; }
}

export async function snapshotCard(plugin: MarginStudyPlugin, card: Card): Promise<Snapshot> {
  const width = 600, paper = el("div");
  Object.assign(paper.style, { position: "fixed", left: "-100000px", top: "0", width: `${width}px`, boxSizing: "border-box", padding: "24px", background: "#ffffff", color: "#222222", fontFamily: card.typography?.fontFamily ?? "Helvetica, sans-serif", fontSize: `${card.typography?.fontSize ?? 16}px`, lineHeight: "1.5", overflowWrap: "anywhere" });
  document.body.append(paper);
  try {
    const text = async (value: string, heading = false) => {
      if (!value.trim()) return;
      const block = el(heading ? "h3" : "div"); block.style.cssText = "margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere";
      await renderMarkdown(plugin.app, value, block, card.docPath); paper.append(block);
    };
    const image = async (value: string) => {
      const source = await embeddedImage(plugin, value), img = el("img", { src: source }) as HTMLImageElement;
      img.style.cssText = "display:block;max-width:100%;height:auto;margin:0 0 12px"; paper.append(img); await img.decode();
    };
    await text(card.title ?? "", true);
    const comments = cardCommentItems(card), commentImages = new Set(comments.flatMap(item => item.image ? [item.image] : []));
    const composed = card.extendMedia?.some(item => item.noteId === card.anchorAnnId && item.composed);
    if (!composed && card.excerptBlocks?.length) {
      if (!card.excerptBlocks.some(block => block.text)) await text(card.front);
      const blockImages = card.excerptBlocks.filter(block => block.image).length;
      for (const block of card.excerptBlocks) { if (block.text) await text(block.text); if (block.image) await image(block.image); }
      for (const source of cardImages(card).slice(blockImages).filter(value => !commentImages.has(value))) await image(source);
    } else {
      if (!composed) await text(card.front);
      for (const source of cardImages(card)) if (!commentImages.has(source)) await image(source);
    }
    for (const comment of comments) {
      if (comment.text) await text(comment.text);
      if (comment.image) {
        const media = card.commentMedia?.find(item => item.image === comment.image);
        for (const source of media?.parts?.length ? [...media.parts].sort((a, b) => a.y - b.y).map(part => part.image) : [comment.image]) await image(source);
      }
    }
    await document.fonts.ready;
    const height = Math.max(120, Math.ceil(paper.getBoundingClientRect().height));
    const copy = paper.cloneNode(true) as HTMLElement, originals = [...paper.querySelectorAll("*")], copies = [...copy.querySelectorAll("*")];
    const properties = ["display", "font-family", "font-size", "font-weight", "font-style", "line-height", "color", "background-color", "text-decoration", "white-space", "overflow-wrap", "text-align", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top", "border-right", "border-bottom", "border-left", "box-sizing", "max-width", "width", "height"];
    originals.forEach((node, index) => {
      const computed = getComputedStyle(node), target = copies[index] as HTMLElement;
      target.style.cssText = "";
      for (const property of properties) target.style.setProperty(property, computed.getPropertyValue(property));
      target.style.setProperty("-webkit-text-fill-color", computed.color);
      if (target instanceof HTMLImageElement) { target.style.height = "auto"; target.style.maxWidth = "100%"; }
    });
    copy.style.cssText = `position:relative;left:0;top:0;width:${width}px;height:${height}px;box-sizing:border-box;padding:24px;background:#fff;color:#222;font-family:${card.typography?.fontFamily ?? "Helvetica, sans-serif"};font-size:${card.typography?.fontSize ?? 16}px;line-height:1.5;overflow:hidden;overflow-wrap:anywhere`;
    const serialized = new XMLSerializer().serializeToString(copy);
    const parts: Snapshot["parts"] = [];
    for (let y = 0; y < height; y += 8000) {
      const partHeight = Math.min(8000, height - y);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${partHeight}"><foreignObject x="0" y="${-y}" width="${width}" height="${height}">${serialized}</foreignObject></svg>`;
      const bitmap = new Image(); bitmap.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); await bitmap.decode();
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = partHeight;
      try {
        const context = canvas.getContext("2d")!; context.drawImage(bitmap, 0, 0);
        if (!context.getImageData(0, 0, 1, 1).data[3]) throw new Error("快照渲染为空，未保存批注");
        parts.push({ image: canvas.toDataURL("image/png"), y, height: partHeight });
      } finally { canvas.width = canvas.height = 0; }
    }
    const scale = height <= 16000 ? 1 : Math.min(1, 16000 / height, Math.sqrt(12_000_000 / (width * height)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(width * scale)); canvas.height = Math.max(1, Math.ceil(height * scale));
    try {
      const context = canvas.getContext("2d")!;
      for (const part of parts) {
        const bitmap = new Image(); bitmap.src = part.image; await bitmap.decode();
        context.drawImage(bitmap, 0, part.y * scale, width * scale, part.height * scale);
      }
      return { image: canvas.toDataURL("image/png"), width, height, parts };
    }
    finally { canvas.width = canvas.height = 0; }
  } finally { paper.remove(); }
}

export function readCardInkComment(plugin: MarginStudyPlugin, item: Media): Promise<CardInkMedia> {
  return readInkCommentToContent(item, async source => {
    const image = new Image(); image.src = imageUrl(plugin, source); await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  });
}

export function cardCommentImage(plugin: MarginStudyPlugin, item: Media, options: { className?: string; style?: string; alt?: string } = {}): HTMLElement {
  let currentItem: CardInkMedia = item;
  const migrated = readCardInkComment(plugin, item).then(result => { currentItem = result; }).catch(() => {});
  const makeImage = (source: string) => el("img", { src: imageUrl(plugin, source), alt: options.alt ?? item.name ?? "手写评论", ...(options.className ? { class: options.className } : {}), ...(options.style ? { style: options.style } : {}) });
  const image = makeImage(commentImage(item) || "");
  if (item.collapsed === undefined) return image;
  const details = el("details", { class: "ms-card-ink-comment", "data-ink-comment": item.id }) as HTMLDetailsElement;
  details.open = !item.collapsed; details.addEventListener("click", event => event.stopPropagation());
  const download = el("button", { class: "ms-btn", text: item.parts?.length ? "导出 PNG 分段" : "导出 PNG" });
  download.addEventListener("click", () => { void migrated.then(() => {
    for (const [index, source] of (currentItem.parts?.length ? [...currentItem.parts].sort((a, b) => a.y - b.y).map(part => part.image) : [currentItem.image]).entries()) {
      const link = document.createElement("a"); link.href = imageUrl(plugin, source); link.download = `comment-${currentItem.id}-${index + 1}.png`; link.click();
    }
  }); });
  details.append(el("summary", { text: item.name ?? "手写评论" }), download, image); return details;
}

function offerUndo(plugin: MarginStudyPlugin, cardId: string, mediaId: string, onChanged?: () => void): void {
  document.querySelector(".ms-card-ink-undo")?.remove();
  const revision = plugin.store.getLibraryHistoryState().revision;
  const panel = el("div", { class: "ms-card-ink-undo", role: "status" });
  const undo = el("button", { class: "ms-btn", text: "撤销批注" }), dismiss = el("button", { class: "ms-btn", text: "关闭提示" });
  undo.addEventListener("click", () => {
    const state = plugin.store.getLibraryHistoryState();
    if (state.revision !== revision || !state.canUndo || !plugin.store.getCard(cardId)?.commentMedia?.some(item => item.id === mediaId)) {
      new Notice("卡片历史已变化，无法撤销此批注"); panel.remove(); return;
    }
    if (plugin.store.undoLibraryChange()) { panel.remove(); onChanged?.(); new Notice("已撤销批注"); }
  });
  dismiss.addEventListener("click", () => panel.remove()); panel.append(el("span", { text: "批注已保存" }), undo, dismiss); document.body.append(panel);
}

export function openCardInkComment(plugin: MarginStudyPlugin, cardId: string, mode: "snapshot" | "blank", onChanged?: () => void): void {
  const original = plugin.store.getCard(cardId); if (!original) { new Notice("卡片已不存在"); return; }
  const captured = structuredClone(original), { modal, close } = createModal(mode === "snapshot" ? "整卡截图批注" : "空白手写");
  modal.setAttribute("data-card-ink-editor", mode); modal.classList.add("ms-card-ink-editor");
  modal.append(el("p", { class: "ms-muted", text: mode === "snapshot" ? "快照只读，可在快照和留白处书写。" : "空白画布只保存为评论，不改变卡片正文。" }));
  const loading = el("div", { text: "正在准备画布…" }); modal.append(loading);
  const actions = el("div", { class: "ms-modal-actions" }), undo = el("button", { class: "ms-btn", text: "撤销一笔" }), clear = el("button", { class: "ms-btn", text: "清空手绘" });
  const cancel = el("button", { class: "ms-btn", text: "取消" }), save = el("button", { class: "ms-btn primary", text: "保存批注", "data-save-card-ink": "true" }) as HTMLButtonElement;
  save.disabled = true; undo.disabled = true; clear.disabled = true; cancel.addEventListener("click", close); actions.append(undo, clear, cancel, save); modal.append(actions);
  void (async () => {
    const snapshot = mode === "snapshot" ? await snapshotCard(plugin, captured) : undefined;
    if (!modal.isConnected) return;
    const margin = 120, long = !!snapshot && snapshot.height + margin * 2 > 8000;
    if (long && snapshot) {
      const width = snapshot.width, height = snapshot.height + margin * 2;
      const active = plugin.activeReader?.getActiveHandwritingPreset?.(), presets = handwritingPresets(plugin.store.settings);
      const preset = plugin.activeReader?.getHandwritingPreset?.() ?? presets.find(value => value.id === active) ?? presets.find(value => value.type !== "highlighter") ?? presets[0];
      const drawing = segmentedCardInkInput(width, height, { color: preset?.color ?? "#5269dc", width: preset ? handwritingPresetWidth(preset, "card") : 3, opacity: preset?.opacity ?? 1 }, { x: 0, y: margin });
      const viewport = el("div", { class: "ms-card-ink-viewport" });
      drawing.element.style.position = "relative"; drawing.element.style.background = "#fff";
      for (const part of snapshot.parts) {
        drawing.element.append(el("img", { src: part.image, alt: "原卡只读快照", style: `position:absolute;left:0;top:${margin + part.y}px;width:${width}px;height:${part.height}px;pointer-events:none` }));
      }
      for (const canvas of drawing.canvases) { canvas.style.position = "relative"; canvas.style.zIndex = "1"; }
      viewport.append(drawing.element); loading.replaceWith(viewport);
      undo.disabled = false; clear.disabled = false; save.disabled = false;
      undo.addEventListener("click", drawing.undo); clear.addEventListener("click", drawing.clear);
      save.addEventListener("click", async () => {
        if (save.disabled) return;
        const strokes = drawing.strokes();
        if (!strokes.length) { new Notice("请先写下批注"); return; }
        drawing.freeze(true); save.disabled = true; undo.disabled = true; clear.disabled = true;
        const frozenCanvases = drawing.canvases.map(source => {
          const canvas = document.createElement("canvas"); canvas.width = source.width; canvas.height = source.height;
          canvas.dataset.offsetY = source.dataset.offsetY; canvas.getContext("2d")!.drawImage(source, 0, 0); return canvas;
        });
        const preview = document.createElement("canvas"), scale = Math.min(1, 8000 / height);
        preview.width = Math.max(1, Math.round(width * scale)); preview.height = Math.max(1, Math.round(height * scale));
        try {
          const latest = plugin.store.getCard(cardId);
          if (!latest) throw new Error("卡片已不存在");
          if (JSON.stringify(latest) !== JSON.stringify(captured)) throw new Error("卡片已变化，请重新打开批注");
          const images = await Promise.all(snapshot.parts.map(async part => { const image = new Image(); image.src = part.image; await image.decode(); return image; }));
          const parts: NonNullable<Media["parts"]> = [];
          for (const ink of frozenCanvases) {
            const y = Number(ink.dataset.offsetY), segment = document.createElement("canvas");
            segment.width = width; segment.height = ink.height;
            try {
              const context = segment.getContext("2d")!; context.fillStyle = "#fff"; context.fillRect(0, 0, width, ink.height);
              snapshot.parts.forEach((part, index) => {
                const top = Math.max(y, margin + part.y), bottom = Math.min(y + ink.height, margin + part.y + part.height);
                if (bottom > top) context.drawImage(images[index], 0, top - margin - part.y, width, bottom - top, 0, top - y, width, bottom - top);
              });
              context.drawImage(ink, 0, 0);
              parts.push({ image: segment.toDataURL("image/png"), y, height: ink.height });
              preview.getContext("2d")!.drawImage(segment, 0, y * scale, width * scale, ink.height * scale);
            } finally { segment.width = segment.height = 0; }
          }
          if (JSON.stringify(plugin.store.getCard(cardId)) !== JSON.stringify(captured)) throw new Error("卡片已变化，请重新打开批注");
          if (JSON.stringify(drawing.strokes()) !== JSON.stringify(strokes)) throw new Error("笔迹已变化，请重新保存批注");
          // 短卡与长卡保留 viewScale=1，兼容历史快照格式和 1:1 基线。
          const media: Media = { id: uid("comment"), kind: "ink", name: "整卡截图批注", collapsed: true, image: preview.toDataURL("image/png"), strokes, parts,
            snapshot: { image: snapshot.image, x: 0, y: margin / height, width: 1, height: snapshot.height / height, viewScale: 1 } };
          plugin.store.updateCard(cardId, { commentMedia: [...(latest.commentMedia ?? []), media] });
          close(); onChanged?.(); offerUndo(plugin, cardId, media.id, onChanged);
        } catch (error) { new Notice(`批注保存失败：${String(error)}`); }
        finally { preview.width = preview.height = 0; for (const canvas of frozenCanvases) canvas.width = canvas.height = 0; drawing.freeze(false); save.disabled = false; undo.disabled = false; clear.disabled = false; }
      });
      return;
    }
    const width = snapshot ? snapshot.width + margin * 2 : 840, height = snapshot ? snapshot.height + margin * 2 : 560;
    const reference = snapshot ? { x: margin, y: margin, width: snapshot.width, height: snapshot.height } : { x: 0, y: 0, width, height };
    const paper = el("div", { class: "ms-card-ink-paper", "data-snapshot-frame": snapshot ? "true" : "false" });
    Object.assign(paper.style, { position: "relative", width: `${width}px`, height: `${height}px`, background: "#fff" });
    if (snapshot) paper.append(el("img", { src: snapshot.image, alt: "原卡只读快照", style: `position:absolute;left:${reference.x}px;top:${reference.y}px;width:${reference.width}px;height:${reference.height}px;pointer-events:none` }));
    const active = plugin.activeReader?.getActiveHandwritingPreset?.(), presets = handwritingPresets(plugin.store.settings);
    const preset = plugin.activeReader?.getHandwritingPreset?.() ?? presets.find(value => value.id === active) ?? presets.find(value => value.type !== "highlighter") ?? presets[0];
    const drawing = cardInkInput(width, height, reference, { color: preset?.color ?? "#5269dc", width: preset ? handwritingPresetWidth(preset, "card") : 3, opacity: preset?.opacity ?? 1 });
    paper.append(drawing.canvas); const viewport = el("div", { class: "ms-card-ink-viewport" }); viewport.append(paper); loading.replaceWith(viewport);
    undo.disabled = false; clear.disabled = false; save.disabled = false; undo.addEventListener("click", drawing.undo); clear.addEventListener("click", drawing.clear);
    save.addEventListener("click", async () => {
      if (save.disabled) return;
      drawing.freeze(true); save.disabled = true; undo.disabled = true; clear.disabled = true;
      const strokes = drawing.strokes(), frozenStrokes = JSON.stringify(strokes);
      const frozenCanvas = document.createElement("canvas"); frozenCanvas.width = width; frozenCanvas.height = height;
      frozenCanvas.getContext("2d")!.drawImage(drawing.canvas, 0, 0);
      const composed = document.createElement("canvas"); composed.width = width; composed.height = height;
      try {
        if (!strokes.length) { new Notice("请先写下批注"); return; }
        const latest = plugin.store.getCard(cardId); if (!latest) throw new Error("卡片已不存在");
        if (JSON.stringify(latest) !== JSON.stringify(captured)) throw new Error("卡片已变化，请重新打开批注");
        const context = composed.getContext("2d")!; context.fillStyle = "#fff"; context.fillRect(0, 0, composed.width, composed.height);
        if (snapshot) context.drawImage(paper.querySelector("img")!, reference.x, reference.y, reference.width, reference.height);
        context.drawImage(frozenCanvas, 0, 0);
        if (JSON.stringify(plugin.store.getCard(cardId)) !== JSON.stringify(captured)) throw new Error("卡片已变化，请重新打开批注");
        if (JSON.stringify(drawing.strokes()) !== frozenStrokes || drawing.canvas.toDataURL() !== frozenCanvas.toDataURL()) throw new Error("笔迹已变化，请重新保存批注");
        const media: Media = { id: uid("comment"), kind: "ink", name: snapshot ? "整卡截图批注" : "空白手写", collapsed: true, image: composed.toDataURL("image/png"), strokes,
          ...(snapshot ? { snapshot: { image: snapshot.image, x: reference.x / width, y: reference.y / height, width: reference.width / width, height: reference.height / height, viewScale: 1 } } : {}) };
        plugin.store.updateCard(cardId, { commentMedia: [...(latest.commentMedia ?? []), media] });
        close(); onChanged?.(); offerUndo(plugin, cardId, media.id, onChanged);
      } catch (error) { new Notice(`批注保存失败：${String(error)}`); }
      finally { composed.width = composed.height = 0; frozenCanvas.width = frozenCanvas.height = 0; drawing.freeze(false); save.disabled = false; undo.disabled = false; clear.disabled = false; }
    });
  })().catch(error => { if (modal.isConnected) { loading.textContent = `画布准备失败：${String(error)}`; new Notice(loading.textContent); } });
}
