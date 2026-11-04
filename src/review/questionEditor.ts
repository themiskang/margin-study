import type MarginStudyPlugin from "../main";
import type { Card } from "../types";
import { Notice } from "obsidian";
import { el, clear } from "../utils/dom";
import { renderMarkdown } from "../utils/markdown";
import { reviewMaterial } from "./presentation";

export function reviewQuestionEditor(plugin: MarginStudyPlugin, card: Card, draft: () => Card, sources: { label: string; input: HTMLTextAreaElement }[]): { element: HTMLElement; value(): Card["reviewQuestion"] } {
  const element = el("details", { class: "ms-review-question-settings" });
  element.append(el("summary", { text: "复习正面设置", style: "cursor:pointer" }), el("p", { class: "ms-muted", text: "标题是 MarginNote 手册的默认问题。已有卡片可保留原来的正反面；下面的设置只影响复习显示。" }));
  const mode = el("select", { class: "ms-select", "aria-label": "复习问题来源", "data-review-question-mode": "true" }) as HTMLSelectElement;
  for (const [value, text] of [["legacy","保留原有正反面"],["title","标题作为问题"],["emphasis","重点作为问题"],["whole","整个卡片作为问题"],["custom","自定义问题"]]) mode.append(el("option", { value, text }));
  mode.value = card.reviewQuestion?.mode ?? "legacy";
  const custom = el("textarea", { class: "ms-input", "aria-label": "自定义复习问题", placeholder: "只编辑复习问题，不修改来源卡片", style: "width:100%;min-height:70px" }) as HTMLTextAreaElement;
  custom.value = card.reviewQuestion?.text ?? "";
  const imageLabel = el("label", { class: "ms-deck-bind" }), images = el("input", { type: "checkbox", "aria-label": "复习正面显示图片" }) as HTMLInputElement;
  images.checked = reviewMaterial(card).showImages; imageLabel.append(images, "问题正面显示卡片图片 / 图片遮挡");
  const preview = el("div", { class: "ms-review-question-preview", "aria-label": "复习问题预览" });
  const value = (): Card["reviewQuestion"] => {
    if (mode.value === "legacy") return undefined;
    if (mode.value === "custom" && !custom.value.trim()) throw new Error("请先填写自定义复习问题");
    return { mode: mode.value as NonNullable<Card["reviewQuestion"]>["mode"], ...(mode.value === "custom" && { text: custom.value }), includeImages: images.checked };
  };
  const draw = () => {
    custom.style.display = mode.value === "custom" ? "" : "none"; images.disabled = mode.value === "legacy"; clear(preview);
    let question: Card["reviewQuestion"];
    try { question = value(); } catch { preview.append(el("span", { class: "ms-muted", text: "填写问题后可在这里预览。" })); return; }
    void renderMarkdown(plugin.app, reviewMaterial({ ...draft(), reviewQuestion: question }).front || "*（当前没有问题文字）*", preview, card.docPath);
  };
  mode.addEventListener("change", () => { images.checked = ["legacy", "whole"].includes(mode.value); draw(); });
  custom.addEventListener("input", draw); images.addEventListener("change", draw);
  const extracts = el("div", { class: "ms-review-tools" });
  for (const source of sources) {
    const button = el("button", { class: "ms-btn", text: `用所选${source.label}作为问题` });
    button.addEventListener("click", () => {
      const text = source.input.value.slice(source.input.selectionStart, source.input.selectionEnd);
      if (!text.trim()) { new Notice(`请先在${source.label}文本框里选择问题文字`); return; }
      mode.value = "custom"; custom.value = text; images.checked = false; draw(); element.open = true;
    }); extracts.append(button);
  }
  const refresh = el("button", { class: "ms-btn", text: "更新问题预览" }); refresh.addEventListener("click", draw);
  element.append(mode, custom, imageLabel, extracts, refresh, preview); draw(); return { element, value };
}
