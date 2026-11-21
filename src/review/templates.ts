/**
 * [INPUT]: 依赖 Store、卡片内容与学习库保存反馈。
 * [OUTPUT]: 提供卡片模板展开和编辑控件。
 * [POS]: 展开模板文本并将模板修改交给 Store。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type MarginStudyPlugin from "../main";
import type { Card } from "../types";
import type { CardTemplate } from "./contracts";
import { el, clear } from "../utils/dom";
import { openConfirm, openTextModal, createModal } from "../utils/modal";
import { Notice } from "obsidian";
import { saveFeedback } from "../model/saveFeedback";

export function applyTemplate(template: CardTemplate, card: Pick<Card, "front" | "back" | "docPath">, now = new Date()): { front: string; back: string } {
  const values: Record<string, string> = { front: card.front, back: card.back ?? "", source: card.docPath, date: now.toLocaleDateString() };
  const expand = (text: string) => text.replace(/\{\{(front|back|source|date)\}\}/g, (_match, key: string) => values[key]);
  return { front: expand(template.front), back: expand(template.back ?? "") };
}

export function mountTemplateControls(container: HTMLElement, plugin: MarginStudyPlugin, card: Card,
  front: HTMLTextAreaElement, back: HTMLTextAreaElement | null, onChange: () => void, onApplied: (id: string) => void): void {
  const row = el("div", { class: "ms-template-controls", style: "display:flex;flex-wrap:wrap;gap:6px;margin:10px 0" });
  const select = el("select", { class: "ms-select", "aria-label": "卡片模板" }) as HTMLSelectElement;
  const fill = () => {
    const current = select.value;
    clear(select); select.append(el("option", { value: "", text: "选择保存的模板…" }));
    for (const template of plugin.store.getCardTemplates()) select.append(el("option", { value: template.id, text: template.name }));
    select.value = current;
  };
  const use = el("button", { class: "ms-btn", text: "应用模板" });
  use.addEventListener("click", () => {
    const template = plugin.store.getCardTemplates().find((item) => item.id === select.value);
    if (!template) { new Notice("先选择一个模板"); return; }
    const result = applyTemplate(template, { ...card, front: front.value, back: back?.value });
    front.value = result.front; if (back) back.value = result.back;
    onApplied(template.id); onChange();
  });
  const save = el("button", { class: "ms-btn", text: "存为模板" });
  save.addEventListener("click", () => openTextModal({
    title: "保存卡片模板", placeholder: "模板名称", onOk: (name) => {
      if (!name.trim()) return;
      const template: CardTemplate = { id: `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: name.trim(), front: front.value, back: back?.value, type: card.type, createdAt: new Date().toISOString() };
      plugin.store.upsertCardTemplate(template); fill(); select.value = template.id; onApplied(template.id);
      new Notice(saveFeedback(plugin.store, "模板已保存，可在其他卡片中使用"));
    },
  }));
  const edit = el("button", { class: "ms-btn", text: "编辑模板" });
  edit.addEventListener("click", () => {
    const template = plugin.store.cardTemplates.find((item) => item.id === select.value);
    if (!template) { new Notice("场景内置卡片模板请先复制场景后编辑"); return; }
    const { modal, close } = createModal("编辑卡片模板");
    const name = el("input", { class: "ms-search", type: "text", "aria-label": "模板名称" }) as HTMLInputElement; name.value = template.name;
    const templateFront = el("textarea", { "aria-label": "模板正面" }) as HTMLTextAreaElement; templateFront.value = template.front;
    const templateBack = el("textarea", { "aria-label": "模板答案" }) as HTMLTextAreaElement; templateBack.value = template.back ?? "";
    const confirm = el("button", { class: "ms-btn primary", text: "保存模板" });
    confirm.addEventListener("click", () => {
      if (!name.value.trim()) { new Notice("模板名称不能为空"); return; }
      plugin.store.upsertCardTemplate({ ...template, name: name.value.trim(), front: templateFront.value, back: templateBack.value }); fill(); close();
    });
    modal.append(name, el("p", { text: "正面与答案可使用 {{front}}、{{back}}、{{source}}、{{date}}。支持 {{c1::答案::提示}} 挖空。", class: "ms-muted" }), templateFront, templateBack, confirm);
  });
  const remove = el("button", { class: "ms-btn", text: "删除模板" });
  remove.addEventListener("click", () => {
    const template = plugin.store.cardTemplates.find((item) => item.id === select.value);
    if (template) openConfirm("删除模板", `删除「${template.name}」？已创建的卡片内容会保留。`, () => { plugin.store.removeCardTemplate(template.id); fill(); });
    else if (select.value) new Notice("场景内置卡片模板不能从这里删除");
  });
  row.append(select, use, save, edit, remove); fill(); select.value = card.templateId ?? ""; container.append(row);
}
