import { el } from "../utils/dom";

type ReviewIcon = "star" | "star-filled" | "notes" | "close" | "aq" | "previous" | "next";
const ICONS: Record<ReviewIcon, string> = {
  star: '<path d="m12 2.5 2.8 6 6.6.7-4.9 4.5 1.4 6.5-5.9-3.4-5.9 3.4 1.4-6.5-4.9-4.5 6.6-.7Z"/>',
  "star-filled": '<path fill="currentColor" d="m12 2.5 2.8 6 6.6.7-4.9 4.5 1.4 6.5-5.9-3.4-5.9 3.4 1.4-6.5-4.9-4.5 6.6-.7Z"/>',
  notes: '<circle cx="10" cy="6.2" r="3.2" fill="currentColor" stroke="none"/><path d="M3 18v-2.2c0-3 3.1-4.4 7-4.4 1.6 0 3 .2 4.2.7L10 18Z" fill="currentColor" stroke="none"/><path d="m13 19 1-3.6 6.1-6.1 2.1 2.1-6.1 6.1L13 19ZM18.8 10.6l2.1 2.1"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  aq: '<rect x="3" y="10" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/><path d="M8 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6m1 4 3 3" stroke="#727272" stroke-width="1.3"/><rect x="8" y="2" width="14" height="13" rx="1.5" fill="currentColor" stroke="#727272" stroke-width=".7"/><path d="m12 11 3-6 3 6m-5-2h4" stroke="#727272" stroke-width="1.2"/>',
  previous: '<path d="m14.5 4.5-7 7.5 7 7.5"/>',
  next: '<path d="m9.5 4.5 7 7.5-7 7.5"/>',
};

/** Native review chrome, measured from the 1512 × 949 desktop reference. */
export function reviewIconButton(label: string, icon: ReviewIcon, className = ""): HTMLButtonElement {
  const button = el("button", { class: `ms-native-review-icon ${className}`, type: "button", "aria-label": label, title: label });
  button.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
  return button;
}

export function setReviewFavorite(button: HTMLButtonElement, favorite: boolean): void {
  const label = favorite ? "★ 已收藏" : "☆ 收藏";
  button.setAttribute("aria-label", label); button.title = label;
  button.setAttribute("aria-pressed", String(favorite));
  button.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true">${ICONS[favorite ? "star-filled" : "star"]}</svg>`;
}

export function nativeReviewStage(modal: HTMLElement, bg: HTMLElement, options: { name: string; count: string; detail: string; closeLabel: string; presentation?: "browse" | "score"; onClose(): void }) {
  bg.classList.add("ms-native-review-bg");
  modal.classList.add("ms-review-modal", "ms-native-review");
  modal.classList.toggle("ms-native-review-browse", options.presentation === "browse");
  modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-label", options.name);
  const identity = el("div", { class: "ms-review-identity ms-native-review-counter", "aria-live": "polite" });
  identity.append(el("h3", { class: "ms-review-visually-hidden", text: options.name }), el("span", { text: options.count }), el("span", { class: "ms-review-visually-hidden", text: ` · ${options.detail}` }));
  const paper = el("article", { class: "ms-native-review-paper" });
  const toolbar = el("div", { class: "ms-native-review-paper-tools" });
  const edit = el("button", { class: "ms-native-review-edit", text: "Edit", type: "button", "aria-label": "编辑卡片", title: "编辑卡片" });
  const favorite = reviewIconButton("☆ 收藏", "star", "ms-native-review-favorite");
  const notes = reviewIconButton("批注与工具", "notes", "ms-native-review-notes"); notes.setAttribute("aria-expanded", "false");
  toolbar.append(edit, favorite, notes);
  const content = el("div", { class: "ms-native-review-content" });
  const inspector = el("div", { class: "ms-native-review-inspector", "aria-label": "复习工具" }); inspector.hidden = true;
  const hideTools = () => { inspector.hidden = true; notes.setAttribute("aria-expanded", "false"); };
  notes.addEventListener("click", () => { inspector.hidden = !inspector.hidden; notes.setAttribute("aria-expanded", String(!inspector.hidden)); });
  paper.append(toolbar, content, inspector);
  const footer = el("div", { class: "ms-native-review-footer" });
  const exit = reviewIconButton(options.closeLabel, "close", "ms-native-review-close"); exit.addEventListener("click", options.onClose);
  modal.append(identity, paper, footer);
  return { identity, paper, content, inspector, footer, edit, favorite, notes, exit, hideTools };
}
