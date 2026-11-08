import { Notice } from "obsidian";
import type MarginStudyPlugin from "../main";
import type { Card } from "../types";
import { handwritingPresetWidth, handwritingPresets } from "../annot/handwritingPresets";
import { cardInkInput } from "../review/drawing";
import { cardImages, imageUrl } from "../review/content";
import { el } from "../utils/dom";
import { uid } from "../utils/id";
import { renderMarkdown } from "../utils/markdown";
import { createModal } from "../utils/modal";
import { cardCommentItems } from "./commentOrder";

type Media = NonNullable<Card["commentMedia"]>[number];
type Snapshot = { image: string; width: number; height: number };

async function embeddedImage(plugin: MarginStudyPlugin, source: string): Promise<string> {
  const image = new Image(); image.src = imageUrl(plugin, source); await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("卡片图片尺寸无效");
  const scale = Math.min(1, Math.sqrt(4_000_000 / (image.naturalWidth * image.naturalHeight)));
  const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  try { canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height); return canvas.toDataURL("image/png"); }
  finally { canvas.width = canvas.height = 0; }
}

async function snapshotCard(plugin: MarginStudyPlugin, card: Card): Promise<Snapshot> {
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
    for (const comment of comments) { if (comment.text) await text(comment.text); if (comment.image) await image(comment.image); }
    await document.fonts.ready;
    const height = Math.max(120, Math.ceil(paper.getBoundingClientRect().height));
    if (height > 20000) throw new Error("卡片过长，无法生成完整快照");
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(copy)}</foreignObject></svg>`;
    const bitmap = new Image(); bitmap.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); await bitmap.decode();
    const scale = Math.min(1, Math.sqrt(12_000_000 / (width * height))), canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(width * scale)); canvas.height = Math.max(1, Math.ceil(height * scale));
    try {
      const context = canvas.getContext("2d")!; context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (!context.getImageData(0, 0, 1, 1).data[3]) throw new Error("快照渲染为空，未保存批注");
      return { image: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
    }
    finally { canvas.width = canvas.height = 0; }
  } finally { paper.remove(); }
}

export function cardCommentImage(plugin: MarginStudyPlugin, item: Media, options: { className?: string; style?: string; alt?: string } = {}): HTMLElement {
  const image = el("img", { src: imageUrl(plugin, item.image), alt: options.alt ?? item.name ?? "手写评论", ...(options.className ? { class: options.className } : {}), ...(options.style ? { style: options.style } : {}) });
  if (item.collapsed === undefined) return image;
  const details = el("details", { class: "ms-card-ink-comment", "data-ink-comment": item.id }) as HTMLDetailsElement;
  details.open = !item.collapsed; details.addEventListener("click", event => event.stopPropagation());
  details.append(el("summary", { text: item.name ?? "手写评论" }), image); return details;
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
  modal.append(el("p", { class: "ms-muted", text: mode === "snapshot" ? "快照只读，可在卡片四周及上方书写。" : "空白画布只保存为评论，不改变卡片正文。" }));
  const loading = el("div", { text: "正在准备画布…" }); modal.append(loading);
  const actions = el("div", { class: "ms-modal-actions" }), undo = el("button", { class: "ms-btn", text: "撤销一笔" }), clear = el("button", { class: "ms-btn", text: "清空手绘" });
  const cancel = el("button", { class: "ms-btn", text: "取消" }), save = el("button", { class: "ms-btn primary", text: "保存批注", "data-save-card-ink": "true" }) as HTMLButtonElement;
  save.disabled = true; undo.disabled = true; clear.disabled = true; cancel.addEventListener("click", close); actions.append(undo, clear, cancel, save); modal.append(actions);
  void (async () => {
    const snapshot = mode === "snapshot" ? await snapshotCard(plugin, captured) : undefined;
    if (!modal.isConnected) return;
    const margin = 120, width = snapshot ? snapshot.width + margin * 2 : 840, height = snapshot ? snapshot.height + margin * 2 : 560;
    const reference = snapshot ? { x: margin, y: margin, width: snapshot.width, height: snapshot.height } : { x: 0, y: 0, width, height };
    const paper = el("div", { class: "ms-card-ink-paper", "data-snapshot-frame": snapshot ? "true" : "false" });
    Object.assign(paper.style, { position: "relative", width: `${width}px`, height: `${height}px`, background: "#fff" });
    if (snapshot) paper.append(el("img", { src: snapshot.image, alt: "原卡只读快照", style: `position:absolute;left:${margin}px;top:${margin}px;width:${snapshot.width}px;height:${snapshot.height}px;pointer-events:none` }));
    const active = plugin.activeReader?.getActiveHandwritingPreset?.(), presets = handwritingPresets(plugin.store.settings);
    const preset = plugin.activeReader?.getHandwritingPreset?.() ?? presets.find(value => value.id === active) ?? presets.find(value => value.type !== "highlighter") ?? presets[0];
    const drawing = cardInkInput(width, height, reference, { color: preset?.color ?? "#5269dc", width: preset ? handwritingPresetWidth(preset, "card") : 3, opacity: preset?.opacity ?? 1 });
    paper.append(drawing.canvas); const viewport = el("div", { class: "ms-card-ink-viewport" }); viewport.append(paper); loading.replaceWith(viewport);
    undo.disabled = false; clear.disabled = false; save.disabled = false; undo.addEventListener("click", drawing.undo); clear.addEventListener("click", drawing.clear);
    save.addEventListener("click", () => {
      const strokes = drawing.strokes(); if (!strokes.length) { new Notice("请先写下批注"); return; }
      const latest = plugin.store.getCard(cardId); if (!latest) { new Notice("卡片已不存在"); return; }
      if (JSON.stringify(latest) !== JSON.stringify(captured)) { new Notice("卡片已变化，请重新打开批注"); return; }
      const composed = document.createElement("canvas"); composed.width = width; composed.height = height;
      try {
        const context = composed.getContext("2d")!; context.fillStyle = "#fff"; context.fillRect(0, 0, width, height);
        if (snapshot) context.drawImage(paper.querySelector("img")!, reference.x, reference.y, reference.width, reference.height);
        context.drawImage(drawing.canvas, 0, 0);
        const media: Media = { id: uid("comment"), kind: "ink", name: snapshot ? "整卡截图批注" : "空白手写", collapsed: true, image: composed.toDataURL("image/png"), strokes,
          ...(snapshot ? { snapshot: { image: snapshot.image, x: reference.x / width, y: reference.y / height, width: reference.width / width, height: reference.height / height } } : {}) };
        plugin.store.updateCard(cardId, { commentMedia: [...(latest.commentMedia ?? []), media] });
        close(); onChanged?.(); offerUndo(plugin, cardId, media.id, onChanged);
      } catch (error) { new Notice(`批注保存失败：${String(error)}`); }
      finally { composed.width = composed.height = 0; }
    });
  })().catch(error => { if (modal.isConnected) { loading.textContent = `画布准备失败：${String(error)}`; new Notice(loading.textContent); } });
}
