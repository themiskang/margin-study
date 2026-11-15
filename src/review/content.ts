import { applyCardTypography } from "../cards/typography";
import { Notice, TFile } from "obsidian";
import type MarginStudyPlugin from "../main";
import type { Card } from "../types";
import { el } from "../utils/dom";
import { renderMarkdown, clozeForQuestion, clozeIndices } from "../utils/markdown";
import type { ReviewQuestion } from "./questions";
import { validOcclusions } from "./questions";
import { maskEmphasis } from "../study/reveal";
import { createSpeechSession, speechTextFromMarkdown } from "../audio/speech";
import { reviewMaterial } from "./presentation";
import { cardCommentImage } from "../cards/inkComment";

export function commentImage(item: NonNullable<Card["commentMedia"]>[number]): string | undefined {
  return item.image || (item.parts?.length ? item.parts.reduce((first, part) => part.y < first.y ? part : first).image : undefined);
}

export function cardImages(card: Card): string[] {
  const composed=card.extendMedia?.some(media=>media.noteId===card.anchorAnnId&&media.composed);
  const images = !composed ? card.images ?? [] : [];
  const sourceImages = [card.image, ...images].filter((image): image is string => !!image);
  const primary = card.excerptBlocks?.length ? sourceImages : [...new Set(sourceImages)];
  const extra = [...new Set([...(card.sources ?? []).map((source) => source.image), ...(card.extendMedia ?? []).map(item => item.image), ...(card.commentMedia ?? []).map(commentImage)].filter((image): image is string => !!image))].filter(image => !primary.includes(image));
  return [...primary, ...extra];
}

export function collapsibleCardComment(card: Card, image: string): NonNullable<Card["commentMedia"]>[number] | undefined {
  const source = [card.image, ...(card.images ?? []), ...(card.sources ?? []).map(value => value.image), ...(card.extendMedia ?? []).map(value => value.image)].includes(image);
  return source ? undefined : card.commentMedia?.find(item => commentImage(item) === image && (item.collapsed !== undefined || !!item.parts?.length));
}

export function imageUrl(plugin: MarginStudyPlugin, path: string): string {
  if (/^(data:|blob:|https?:|app:)/i.test(path)) return path;
  const file = plugin.app.vault.getAbstractFileByPath(path);
  return file instanceof TFile ? plugin.app.vault.getResourcePath(file) : path.startsWith("_marginstudy-media/") ? plugin.app.vault.adapter.getResourcePath(path) : path;
}

export async function openReviewCardDocument(plugin: MarginStudyPlugin, card: Card): Promise<void> {
  const source = card.sources?.find(item => item.docPath) ?? card;
  if (!source.docPath) throw new Error("这张卡片没有来源文档");
  const file = plugin.app.vault.getAbstractFileByPath(source.docPath);
  if (!(file instanceof TFile)) throw new Error("源文档不存在");
  const reader = await plugin.openDocument(file);
  const notebook = source.documentNotebookId ?? "default";
  if ((reader as any).getDocumentNotebookId?.() !== notebook) await (reader as any).selectDocumentNotebook?.(notebook);
  if (source.anchorAnnId) reader.flashAnnotation(source.anchorAnnId);
  else if (source.page) { if (reader.gotoSourcePage) reader.gotoSourcePage(source.page); else reader.gotoPage?.(source.page); }
}

export function appendSources(container: HTMLElement, plugin: MarginStudyPlugin, card: Card): void {
  const sources = card.sources?.length ? card.sources : [{ docPath: card.docPath, anchorAnnId: card.anchorAnnId, page: card.page }];
  const row = el("div", { class: "ms-review-sources", style: "display:flex;flex-wrap:wrap;gap:6px;margin:8px 0" });
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source.docPath) continue;
    const key = `${source.docPath}::${source.anchorAnnId ?? source.page ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const button = el("button", { class: "ms-btn", text: `${source.docPath}${source.page ? ` · p${source.page}` : ""}` });
    button.addEventListener("click", () => {
      void (async () => {
        const file = plugin.app.vault.getAbstractFileByPath(source.docPath);
        if (!(file instanceof TFile)) throw new Error("源文档不存在");
        const reader = await plugin.openDocument(file);
        if (source.anchorAnnId) reader.flashAnnotation(source.anchorAnnId);
        else if (source.page) { if (reader.gotoSourcePage) reader.gotoSourcePage(source.page); else reader.gotoPage?.(source.page); }
      })().catch((error) => new Notice(`无法打开来源：${String(error)}`));
    });
    row.append(button);
  }
  if (seen.size) container.append(row);
}

export function questionText(card: Card, question: ReviewQuestion, revealed: boolean, clozeVisible = true): string {
  const material = reviewMaterial(card);
  if (question.kind === "cloze") {
    const front = clozeForQuestion(material.front, question.clozeIndex!, revealed || !clozeVisible);
    const backContainsQuestion = !material.configured && clozeIndices(material.back).includes(question.clozeIndex!);
    const back = material.back && (revealed || backContainsQuestion) ? clozeForQuestion(material.back, question.clozeIndex!, revealed || !clozeVisible) : "";
    return back && back !== front ? `${front}\n\n${back}` : front;
  }
  if (question.kind === "occlusion") {
    const label = validOcclusions(card).find((mask) => mask.id === question.maskId)?.label;
    return revealed ? [...new Set([material.front, material.back].filter(Boolean))].join("\n\n") : label || "回忆遮挡区域中的内容";
  }
  return revealed ? (material.back || material.front || card.title || "（请在卡片详情补充答案）") : material.front || card.title || (cardImages(card).length ? "看图回忆，然后显示答案" : "回忆笔记内容，然后显示答案");
}

export async function renderQuestion(container: HTMLElement, plugin: MarginStudyPlugin, card: Card, question: ReviewQuestion, revealed: boolean, clozeVisible = true): Promise<void> {
  const text = el("div", { class: "ms-review-question-text" });applyCardTypography(text,plugin.store.settings,card);
  container.append(text);
  await renderMarkdown(plugin.app, questionText(card, question, revealed, clozeVisible), text, card.docPath);
  if (!revealed && clozeVisible && question.scopeId && plugin.store.canvases.find(canvas => canvas.id === question.scopeId)?.emphasisCloze) {
    const original = [...text.childNodes].map(node => node.cloneNode(true));
    maskEmphasis(text, () => text.replaceChildren(...original));
  }
  const images = revealed || question.kind === "occlusion" || reviewMaterial(card).showImages ? cardImages(card) : [];
  for (let i = 0; i < images.length; i++) {
    const imageWrap = el("div", { class: "ms-review-image", style: "position:relative;display:block;width:fit-content;max-width:100%;margin:10px 0" });
    const image = el("img", { src: imageUrl(plugin, images[i]), style: "display:block;max-width:100%;height:auto", alt: "卡片图片" }) as HTMLImageElement;
    image.draggable = false;
    const media = collapsibleCardComment(card, images[i]) ?? card.commentMedia?.find(item => item.collapsed === undefined && !item.parts?.length && commentImage(item) === images[i]);
    const displayed = media ? cardCommentImage(plugin, media, { alt: "卡片图片", style: "display:block;max-width:100%;height:auto" }) : image;
    if (displayed instanceof HTMLImageElement) displayed.draggable = false;
    imageWrap.append(displayed);
    if (question.kind === "occlusion" && i === 0 && !revealed) {
      const mask = validOcclusions(card).find((item) => item.id === question.maskId);
      if (mask) {
        const points = mask.points?.map((point) =>
          `${((point.x - mask.x) / mask.width) * 100}% ${((point.y - mask.y) / mask.height) * 100}%`).join(",");
        imageWrap.append(el("div", {
          class: "ms-image-occlusion",
          style: `position:absolute;left:${mask.x * 100}%;top:${mask.y * 100}%;width:${mask.width * 100}%;height:${mask.height * 100}%;background:var(--interactive-accent,#5b6cff);border:2px solid var(--text-normal);box-sizing:border-box;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold${points ? `;clip-path:polygon(${points})` : ""}`,
          text: "?", role: "img", "aria-label": "待回忆的遮挡区域",
        }));
      }
    }
    // An occlusion question never exposes an unmasked duplicate of the target.
    if (question.kind !== "occlusion" || i === 0 || revealed) container.append(imageWrap);
  }
}

const cardSpeech = createSpeechSession("card-detail");
export function stopCardSpeech(): void { cardSpeech.stop(); }

export function speakCardText(text: string): void {
  void cardSpeech.start(speechTextFromMarkdown(text)).then(started => {
    if (!started && cardSpeech.state.error) new Notice(cardSpeech.state.error);
  });
}
