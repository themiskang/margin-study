import { Notice } from "obsidian";
import type MarginStudyPlugin from "../main";
import { saveVocabularySense } from "../cards/vocabulary";
import { el, clear } from "../utils/dom";
import { createModal } from "../utils/modal";
import { lookupVocabulary, vocabularySize } from "./dictionary";
import { vocabularyLicense } from "./license";

export function openVocabularyLookup(plugin: MarginStudyPlugin, initial = "", docPath = ""): void {
  const { modal, close } = createModal("外刊生词 · 离线查询");
  const form = el("form"), input = el("input", { type: "text", "aria-label": "查询英文单词", placeholder: "输入英文单词或词形", class: "ms-search" });
  input.value = initial;
  const search = el("button", { type: "submit", class: "ms-btn primary", text: "查询" });
  const example = el("textarea", { "aria-label": "词卡例句", placeholder: "例句（可选）" });
  const results = el("div", { "aria-live": "polite", "data-vocabulary-results": "true" });
  const status = el("p", { class: "ms-muted", text: `离线词表 ${vocabularySize} 个原形；未收录的词不会联网查询。` });
  const license = el("button", { type: "button", class: "ms-btn", text: "词表与许可证" });
  license.addEventListener("click", () => {
    const info = createModal("词表来源与 MIT 许可证");
    const content = el("pre", { text: vocabularyLicense });
    content.style.whiteSpace = "pre-wrap";
    const dismiss = el("button", { type: "button", class: "ms-btn", text: "关闭" });
    dismiss.addEventListener("click", info.close);
    info.modal.append(content, dismiss);
  });
  form.addEventListener("submit", event => {
    event.preventDefault(); clear(results);
    const entry = lookupVocabulary(input.value);
    if (!entry) { results.append(el("p", { text: input.value.trim() ? "离线词表未收录此词。" : "请输入英文单词。" })); return; }
    results.append(el("p", { text: `词：${entry.word}　原形：${entry.lemma}　音标：/${entry.phonetic}/` }));
    const list = el("div", { "aria-label": "释义列表" });
    for (const sense of entry.senses) {
      const row = el("div"), label = el("span", { text: sense }), add = el("button", { type: "button", class: "ms-btn", text: "写入词卡", "aria-label": `写入词卡：${sense}` });
      add.addEventListener("click", () => {
        try {
          const before = plugin.store.cards.length;
          const card = saveVocabularySense(plugin.store, entry, sense, { docPath, example: example.value });
          status.textContent = plugin.store.cards.length === before ? `已存在词卡：${card.front}；未覆盖原内容。` : `已写入一张词卡：${card.front}`;
          new Notice(plugin.store.cards.length === before ? "这条释义已有词卡，未覆盖" : "已写入一张词卡");
        } catch (error) { status.textContent = `写入失败：${String(error)}`; new Notice(status.textContent); }
      });
      row.append(label, add); list.append(row);
    }
    results.append(list);
  });
  form.append(input, search);
  const dismiss = el("button", { type: "button", class: "ms-btn", text: "关闭" });
  dismiss.addEventListener("click", close);
  modal.append(form, example, results, status, license, dismiss);
  if (initial) form.requestSubmit();
  window.setTimeout(() => input.focus(), 0);
}
