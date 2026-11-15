/**
 * [INPUT]: 依赖复习数据、卡片内容和 Obsidian 插件服务。
 * [OUTPUT]: 提供复习卡组浏览与操作界面。
 * [POS]: 连接卡组管理、卡片预览和复习流程。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type MarginStudyPlugin from "../main";
import type { Card } from "../types";
import { Notice } from "obsidian";
import { el, clear } from "../utils/dom";
import { createModal } from "../utils/modal";
import { startReview, questionsForReview } from "./reviewView";
import type { ReviewOptions, StudySetReviewSettings } from "./contracts";
import { appendSources, cardImages, collapsibleCardComment, imageUrl } from "./content";
import { createSpeechSession } from "../audio/speech";
import { clozeForQuestion, renderMarkdown } from "../utils/markdown";
import { filterReviewCards, filterAndOrderReviewQuestions } from "./selection";
import { reviewFilterControls } from "./filters";
import { uid } from "../utils/id";
import { reviewMaterial } from "./presentation";
import { nativeReviewStage, reviewIconButton, setReviewFavorite } from "./nativeStage";
import { cardCommentImage, openCardInkComment } from "../cards/inkComment";
import { openPractice } from "./practice";

type CardEditor = (plugin: MarginStudyPlugin, card: Card, onChanged?: () => void) => void;
let cardEditor: CardEditor | undefined;
/** The card surface supplies editing without pulling reader runtimes into review. */
export function registerReviewCardEditor(editor: CardEditor): void { cardEditor = editor; }
export function editReviewCard(plugin: MarginStudyPlugin, card: Card, onChanged?: () => void): boolean {
  if (!cardEditor) { new Notice("请从卡片盒打开这张卡片进行编辑"); return false; }
  cardEditor(plugin, card, onChanged); return true;
}

export interface DeckPickerOptions {
  cardIds?: string[];
  studySetId?: string;
  scopeId?: string;
  onEnrolled?: () => void;
}

/** The same entry point handles an empty library and choosing an existing deck. */
export function openReviewDecks(plugin: MarginStudyPlugin, options: DeckPickerOptions = {}): void {
  const store = plugin.store, studySetId = options.studySetId ?? store.activeStudySetId;
  const set = store.studySets.find(set => set.id === studySetId);
  let chosen = store.reviewDeckForStudySet(studySetId)?.id ?? (!studySetId ? store.activeReviewDeckId ?? store.reviewDecks[0]?.id : undefined);
  let unsubscribe = () => {};
  const { modal, close } = createModal(options.cardIds?.length ? "加入复习卡组" : "复习卡组", () => unsubscribe());
  modal.classList.add("ms-deck-modal"); modal.setAttribute("data-review-decks", "true");
  const body = el("div"); modal.append(body);
  const draw = () => {
    clear(body);
    const label = el("label", { class: "ms-review-field", text: "选择复习卡组" });
    const select = el("select", { class: "ms-select", "aria-label": "选择复习卡组" }) as HTMLSelectElement;
    select.append(el("option", { value: "", text: store.reviewDecks.length ? "选择现有卡组或新建…" : "还没有复习卡组，请先新建" }));
    for (const deck of store.reviewDecks) select.append(el("option", { value: deck.id, text: deck.name }));
    select.value = chosen ?? ""; select.addEventListener("change", () => { chosen = select.value || undefined; draw(); });
    label.append(select); body.append(label);

    const create = el("form", { class: "ms-deck-create" });
    const name = el("input", { class: "ms-search", type: "text", placeholder: "新卡组名称", "aria-label": "新卡组名称" }) as HTMLInputElement;
    const add = el("button", { class: "ms-btn", type: "submit", text: "新建卡组" });
    create.append(name, add); create.addEventListener("submit", event => {
      event.preventDefault(); if (!name.value.trim()) { name.focus(); return; }
      chosen = store.createReviewDeck(name.value, studySetId).id; draw();
    }); body.append(create);

    const deck = chosen ? store.getReviewDeck(chosen) : undefined;
    if (!deck) {
      body.append(el("p", { class: "ms-muted", text: set ? "当前学习集尚未选择复习卡组。请选择现有卡组或新建，确认后再使用。" : "先建立卡组，再将学习卡片加入其中；复习进度会按卡组分别保存。" }));
      const practice = el("button", { class: "ms-btn", text: "刷题练习" }); practice.addEventListener("click", () => { close(); openPractice(plugin, { studySetId }); }); body.append(practice);
      const cancel = el("button", { class: "ms-btn", text: "关闭" }); cancel.addEventListener("click", close); body.append(cancel); return;
    }
    const summary = store.reviewDeckSummary(deck.id);
    const stats = el("div", { class: "ms-deck-summary", "data-deck-id": deck.id });
    for (const [value, text] of [[summary.cards, "张卡片"], [summary.questions, "道题目"], [summary.due, "题到期"], [summary.reviewedToday, "次今日完成"]]) {
      const cell = el("div"); cell.append(el("strong", { text: String(value) }), el("span", { text: String(text) })); stats.append(cell);
    }
    body.append(stats);
    if (summary.nextDue) body.append(el("p", { class: "ms-muted", text: `下次到期：${new Date(summary.nextDue).toLocaleString()}` }));
    const bindLabel = el("label", { class: "ms-deck-bind" });
    const bind = el("input", { type: "checkbox", "aria-label": "绑定到当前学习集" }) as HTMLInputElement;
    bind.checked = !!set; bind.disabled = !set;
    bindLabel.append(bind, set ? `${set.reviewDeckId === deck.id ? "已绑定到学习集" : "确认后绑定到学习集"}「${set.name}」` : "当前没有打开学习集"); body.append(bindLabel);
    if (set && deck.studySetIds.some(id => id !== set.id)) body.append(el("p", { class: "ms-muted", text: "此卡组已关联其他学习集。绑定后会共享已有成员，复习进度保持不变。" }));
    if (options.cardIds?.length) body.append(el("p", { class: "ms-muted", text: `将加入 ${new Set(options.cardIds).size} 张卡片。重复加入会使题目立即到期。` }));

    const use = () => { store.setActiveReviewDeck(deck.id); if (set && bind.checked) store.bindReviewDeck(deck.id, set.id); };
    const actions = el("div", { class: "ms-modal-actions ms-deck-actions" });
    const choose = el("button", { class: "ms-btn", text: "使用此卡组" });
    choose.addEventListener("click", () => { use(); new Notice(`已选择「${deck.name}」`); options.onEnrolled?.(); close(); });
    if (options.cardIds?.length) {
      const enroll = el("button", { class: "ms-btn primary", text: "加入此卡组" });
      enroll.addEventListener("click", () => {
        try { use(); const rows = store.enqueueReviewInDeck(options.cardIds!, deck.id, options.scopeId ?? store.activeCanvasId);
          new Notice(`已加入 ${new Set(rows.map(row => row.cardId)).size} 张卡片，共 ${rows.length} 道题`); options.onEnrolled?.(); close(); }
        catch (error) { new Notice(`无法加入复习：${String(error)}`); }
      }); actions.append(enroll);
    }
    const start = el("button", { class: "ms-btn primary", text: "开始到期复习" }) as HTMLButtonElement;
    start.disabled = summary.due === 0; start.addEventListener("click", () => { use(); close(); startReview(plugin, { deckId: deck.id, studySetId }); });
    const cancel = el("button", { class: "ms-btn", text: "关闭" }); cancel.addEventListener("click", close);
    const browse = el("button", { class: "ms-btn", text: "浏览全部卡片" });
    browse.addEventListener("click", () => { close(); openReviewDeckBrowser(plugin, deck.id, { studySetId }); });
    const practice = el("button", { class: "ms-btn", text: "刷题练习" }); practice.addEventListener("click", () => { close(); openPractice(plugin, { studySetId }); });
    actions.append(choose, browse, start, practice, cancel); body.append(actions);

    const members = el("details", { class: "ms-deck-members" }); members.append(el("summary", { text: `卡组成员 · ${deck.cardIds.length} 张` }));
    for (const id of deck.cardIds) {
      const card = store.getCard(id); if (!card) continue;
      const row = el("div", { class: "ms-deck-member", "data-deck-member": id });
      row.append(el("span", { text: card.title || card.front.slice(0, 100) || "图片卡片" }));
      if (card.hidden || card.groupId) row.append(el("span", { class: "ms-muted", text: card.groupId ? "合并组员 · 暂停单独复习" : "已隐藏 · 暂停复习" }));
      const remove = el("button", { class: "ms-btn", text: "移出卡组", "aria-label": `移出卡组：${card.title || card.front.slice(0, 30) || "图片卡片"}` });
      remove.addEventListener("click", () => { store.removeCardsFromReviewDeck([id], deck.id); options.onEnrolled?.(); }); row.append(remove);
      members.append(row);
    }
    body.append(members);
    const renameForm = el("form", { class: "ms-deck-create" });
    const rename = el("input", { class: "ms-search", type: "text", "aria-label": "卡组新名称" }) as HTMLInputElement; rename.value = deck.name;
    renameForm.append(rename, el("button", { class: "ms-btn", type: "submit", text: "重命名" }));
    renameForm.addEventListener("submit", event => { event.preventDefault(); store.renameReviewDeck(deck.id, rename.value); draw(); }); body.append(renameForm);
    const intervalForm = el("form", { class: "ms-deck-create" });
    const interval = el("input", { class: "ms-search", type: "number", min: "1", step: "1", placeholder: "留空使用默认调度", "aria-label": "卡组最长间隔（天）" }) as HTMLInputElement;
    interval.value = deck.maxInterval?.toString() ?? "";
    const intervalLabel = el("label", { class: "ms-review-field", text: "最长间隔（天）" }); intervalLabel.append(interval);
    intervalForm.append(intervalLabel, el("button", { class: "ms-btn", type: "submit", text: "保存最长间隔" }));
    intervalForm.addEventListener("submit", event => {
      event.preventDefault();
      try { store.setReviewDeckMaxInterval(deck.id, interval.value.trim() ? Number(interval.value) : undefined); new Notice("卡组最长间隔已保存"); }
      catch (error) { new Notice(`无法保存最长间隔：${String(error)}`); }
    }); body.append(intervalForm);
  };
  unsubscribe = store.subscribe(() => { if (!modal.isConnected) return; if (chosen && !store.getReviewDeck(chosen)) chosen = store.reviewDeckForStudySet(studySetId)?.id ?? (!studySetId ? store.reviewDecks[0]?.id : undefined); draw(); });
  draw();
}

export function enrollCardsForReview(plugin: MarginStudyPlugin, cardIds: string[], onEnrolled?: () => void): void {
  const deck = plugin.store.reviewDeckForStudySet() ?? (!plugin.store.activeStudySetId && plugin.store.activeReviewDeckId ? plugin.store.getReviewDeck(plugin.store.activeReviewDeckId) : undefined);
  if (!deck) { openReviewDecks(plugin, { cardIds, onEnrolled }); return; }
  try {
    const rows = plugin.store.enqueueReviewInDeck(cardIds, deck.id, plugin.store.activeCanvasId);
    new Notice(`已将 ${new Set(rows.map(row => row.cardId)).size} 张卡片加入「${deck.name}」`); onEnrolled?.();
  } catch (error) { new Notice(`无法加入复习：${String(error)}`); }
}

/** Browsing membership never grades, re-enrolls or hides future-due cards. */
export async function openReviewDeckBrowser(plugin: MarginStudyPlugin, deckId: string, options: ReviewOptions = {}): Promise<void> {
  await plugin.store.flush();
  const store = plugin.store, deck = store.getReviewDeck(deckId); if (!deck) return;
  const speech = createSpeechSession("review-browser");
  const studySetId = options.studySetId ?? (options.scopeId ? store.canvases.find(canvas => canvas.id === options.scopeId)?.studySetId : undefined) ?? store.activeStudySetId;
  const saved = store.studySets.find(set => set.id === studySetId)?.reviewSettings;
  const { dueOnly: savedDueOnly, ...savedFilters } = saved ?? { dueOnly: undefined };
  let unsubscribe = () => {}, index = 0, generation = 0, closed = false, dueOnly = savedDueOnly ?? options.presentation === "browse";
  let selection: ReviewOptions = { ...savedFilters, ...options, studySetId, deckId, order: options.order ?? saved?.order ?? "due", shuffleSeed: options.shuffleSeed ?? saved?.shuffleSeed ?? uid("shuffle") }, filtersOpen = false, toolsOpen = false;
  const saveSelection = () => {
    if (!studySetId) return;
    const settings: StudySetReviewSettings = { dueOnly, favorite: selection.favorite, tags: selection.tags, docPaths: selection.docPaths,
      colors: selection.colors, ratings: selection.ratings, order: selection.order, shuffleSeed: selection.order === "random" ? selection.shuffleSeed : undefined };
    store.setStudySetReviewSettings(studySetId, settings);
  };
  const { modal, bg, close } = createModal(deck.name, () => { closed = true; generation++; unsubscribe(); speech.dispose(); });
  modal.classList.add("ms-review-modal", "ms-review-browser");
  const draw = async () => {
    if (closed) return; const current = ++generation; speech.stop(); clear(modal);
    const dueQuestions = questionsForReview(plugin, { ...selection, presentation: "score" });
    const dueIds = new Set(dueQuestions.map(question => question.cardId));
    const setCardIds = studySetId ? new Set(store.cardsForStudySet(studySetId).map(card => card.id)) : undefined;
    const deckCards = deck.cardIds.map(id => store.getCard(id)).filter((card): card is NonNullable<typeof card> => !!card && !card.hidden && !card.groupId && (!setCardIds || setCardIds.has(card.id)));
    const filtered = filterReviewCards(deckCards, selection), byId = new Map(filtered.map(card => [card.id, card]));
    const ordered = filterAndOrderReviewQuestions(store, filtered.flatMap(card => store.deckQuestionsForCard(card.id, deck.id)), selection);
    let cards = [...new Set(ordered.map(question => question.cardId))].map(id => byId.get(id)!);
    if (dueOnly) cards = cards.filter(card => dueIds.has(card.id));
    index = Math.max(0, Math.min(index, cards.length - 1));
    const stage = nativeReviewStage(modal, bg, { name: deck.name, count: `${cards.length ? index + 1 : 0} / ${cards.length}`, detail: dueOnly ? "到期卡片" : "全部卡片，包含尚未到期", closeLabel: "关闭浏览", presentation: "browse", onClose: close });
    stage.inspector.hidden = !toolsOpen; stage.notes.setAttribute("aria-expanded", String(toolsOpen));
    stage.notes.addEventListener("click", () => { toolsOpen = !stage.inspector.hidden; });
    const filter = el("label", { class: "ms-deck-bind" }), due = el("input", { type: "checkbox", "aria-label": "仅浏览到期卡片" }) as HTMLInputElement;
    due.checked = dueOnly; due.addEventListener("change", () => { dueOnly = due.checked; index = 0; saveSelection(); void draw(); }); filter.append(due, "仅到期");
    stage.inspector.append(filter);
    const filters = reviewFilterControls(deckCards, selection, patch => { selection = { ...selection, ...patch, shuffleSeed: patch.order === "random" ? uid("shuffle") : selection.shuffleSeed }; index = 0; saveSelection(); void draw(); });
    filters.open = filtersOpen; filters.addEventListener("toggle", () => { if (filters.isConnected) filtersOpen = filters.open; }); stage.inspector.append(filters);
    const card = cards[index];
    if (card) {
      if (card.typography) { stage.content.style.fontFamily = card.typography.fontFamily; stage.content.style.fontSize = `${card.typography.fontSize}px`; }
      const toolbar = el("div", { class: "ms-review-tools" });
      for (const [mode, label] of [["snapshot", "整卡截图批注"], ["blank", "空白手写"]] as const) {
        const entry = el("button", { class: "ms-btn", text: label });
        entry.addEventListener("click", () => openCardInkComment(plugin, card.id, mode)); toolbar.append(entry);
      }
      stage.edit.addEventListener("click", () => { editReviewCard(plugin, card, () => { void draw(); }); });
      setReviewFavorite(stage.favorite, !!card.favorite);
      stage.favorite.addEventListener("click", () => store.updateCard(card.id, { favorite: !card.favorite }));
      const speak = el("button", { class: "ms-btn", text: "朗读卡片" });
      speak.addEventListener("click", () => { void speech.start([card.title, clozeForQuestion(card.front, 0, true), card.back ? clozeForQuestion(card.back, 0, true) : ""].filter(Boolean).join("\n\n")); });
      const remove = el("button", { class: "ms-btn", text: "移出卡组" });
      remove.addEventListener("click", () => store.removeCardsFromReviewDeck([card.id], deck.id));
      toolbar.append(speak, remove); stage.inspector.append(toolbar); appendSources(stage.inspector, plugin, card);
      const page = el("article", { class: "ms-review-browser-card", "data-browse-card": card.id });
      const material = reviewMaterial(card);
      if (card.title && material.front !== card.title) page.append(el("h2", { text: card.title }));
      const front = el("div", { class: "ms-review-question-text", "data-review-browser-face": "question" }); page.append(front);
      await renderMarkdown(plugin.app, clozeForQuestion(material.front, 0, true), front, card.docPath);
      if (closed || current !== generation) return;
      if (material.back && material.back !== material.front) { const back = el("div", { class: "ms-review-browser-answer", "data-review-browser-face": "answer" }); await renderMarkdown(plugin.app, clozeForQuestion(material.back, 0, true), back, card.docPath); page.append(back); }
      if (closed || current !== generation) return;
      for (const image of cardImages(card)) {
        const media = collapsibleCardComment(card, image);
        page.append(media ? cardCommentImage(plugin, media, { alt: "卡片图片", style: "display:block;max-width:100%;height:auto;margin-top:12px" }) : el("img", { src: imageUrl(plugin, image), alt: "卡片图片", style: "display:block;max-width:100%;height:auto;margin-top:12px" }));
      }
      stage.content.append(page);
    } else { stage.edit.disabled = true; stage.favorite.disabled = true; stage.content.append(el("p", { class: "ms-muted", text: dueOnly ? "当前没有到期卡片。取消「仅到期」可浏览卡组中的全部卡片。" : "卡组还没有可浏览的卡片。请从卡片盒或脑图显式加入。" })); }
    const actions = stage.footer; actions.classList.add("ms-review-browser-actions");
    const previous = el("button", { type: "button", class: "ms-native-review-icon ms-native-review-previous", text: "上一张", "aria-label": "上一张" }), next = el("button", { type: "button", class: "ms-native-review-icon ms-native-review-next", text: "下一张", "aria-label": "下一张" });
    previous.disabled = index === 0; next.disabled = index >= cards.length - 1;
    previous.addEventListener("click", () => { index--; void draw(); }); next.addEventListener("click", () => { index++; void draw(); });
    const score = reviewIconButton(`进入问答评分 · ${dueQuestions.length} 题`, "aq", "primary ms-native-review-mode");
    score.disabled = !dueQuestions.length; score.addEventListener("click", () => { close(); startReview(plugin, { ...selection, presentation: "score" }); });
    actions.append(score, previous, next, stage.exit);
  };
  unsubscribe = store.subscribe(() => { void draw(); }); void draw();
}
