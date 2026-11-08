import type { Card } from "../types";
import type { ReviewOptions } from "./contracts";
import { el } from "../utils/dom";

export function reviewFilterControls(cards: Card[], current: ReviewOptions, onApply: (options: Partial<ReviewOptions>) => void): HTMLDetailsElement {
  const details = el("details", { class: "ms-review-filters" }); details.append(el("summary", { text: "组合筛选与排序" }));
  const form = el("form", { class: "ms-review-filter-grid" });
  const field = (title: string, element: HTMLElement) => { const label = el("label", { class: "ms-review-field", text: title }); label.append(element); form.append(label); };
  const favoriteLabel = el("label", { class: "ms-deck-bind" }), favorite = el("input", { type: "checkbox", "aria-label": "只看收藏卡片" }) as HTMLInputElement;
  favorite.checked = !!current.favorite; favoriteLabel.append(favorite, "只看收藏卡片"); form.append(favoriteLabel);
  const tags = el("input", { class: "ms-search", type: "text", "aria-label": "复习筛选标签", placeholder: "标签完整路径，多个用逗号分隔" }) as HTMLInputElement;
  tags.value = current.tags?.join(", ") ?? ""; field("标签", tags);
  const select = (label: string, choices: [string,string][], selected: string): HTMLSelectElement => {
    const element = el("select", { class: "ms-select", "aria-label": label }) as HTMLSelectElement;
    for (const [value, text] of choices) element.append(el("option", { value, text })); element.value = selected; return element;
  };
  const documents = [...new Set(cards.flatMap(card => [card.docPath, ...(card.sources ?? []).map(source => source.docPath)]).filter(Boolean))].sort();
  const doc = select("复习筛选文档", [["","全部文档"], ...documents.map(path => [path,path] as [string,string])], current.docPaths?.[0] ?? ""); field("来源文档", doc);
  const colors = [...new Set(cards.map(card => card.color).filter((color): color is string => !!color))];
  const color = select("复习筛选颜色", [["","全部颜色"], ...colors.map(color => [color,color] as [string,string])], current.colors?.[0] ?? ""); field("卡片颜色", color);
  const rating = select("复习筛选评分", [["","任意评分"],["0","尚未完成复习"],["1","重来"],["2","困难"],["3","良好"],["4","简单"]], current.ratings?.[0]?.toString() ?? ""); field("最近一次评分", rating);
  const order = select("复习排序", [["due","到期时间"],["added","加入卡组顺序"],["position","文档位置"],["text","问题文本"],["random","随机顺序"]], current.order ?? "due"); field("排序", order);
  const actions = el("div", { class: "ms-review-tools" });
  const apply = el("button", { class: "ms-btn primary", type: "submit", text: "应用筛选排序" });
  const reset = el("button", { class: "ms-btn", type: "button", text: "清除筛选" });
  reset.addEventListener("click", () => onApply({ favorite: false, tags: undefined, docPaths: undefined, colors: undefined, ratings: undefined, order: "due" }));
  actions.append(apply, reset); form.append(actions);
  form.addEventListener("submit", event => {
    event.preventDefault(); const chosenTags = tags.value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean);
    onApply({ favorite: favorite.checked, tags: chosenTags.length ? chosenTags : undefined, docPaths: doc.value ? [doc.value] : undefined,
      colors: color.value ? [color.value] : undefined, ratings: rating.value ? [Number(rating.value)] : undefined, order: order.value as ReviewOptions["order"] });
  });
  details.append(el("p", { class: "ms-muted", text: "各项条件取交集。父标签包含其后代，带 / 的完整路径精确匹配。浏览可包含未到期卡片，评分仅包含到期题。" }), form); return details;
}
