import type MarginStudyPlugin from "../main";
import { Notice } from "obsidian";
import { el, clear } from "../utils/dom";
import { createModal } from "../utils/modal";
import { intervalLabel, isDue, previewInterval } from "../srs";
import type { ReviewLog, ReviewOptions } from "./contracts";
import { questionsForCard, questionWasWrong, ReviewSession } from "./questions";
import type { ReviewQuestion } from "./questions";
import { appendSources, questionText, renderQuestion } from "./content";
import { appendReviewDrawing, reviewDrawingInput } from "./drawing";
import { handwritingPresetWidth, handwritingPresets } from "../annot/handwritingPresets";
import { openReviewDecks, openReviewDeckBrowser, editReviewCard } from "./decks";
import { createSpeechSession, speechTextFromMarkdown } from "../audio/speech";
import { filterReviewCards, filterAndOrderReviewQuestions } from "./selection";
import { uid } from "../utils/id";
import { nativeReviewStage, reviewIconButton, setReviewFavorite } from "./nativeStage";

export function completedReviewHistory(logs: ReviewLog[], cardId?: string, scopeId?: string): ReviewLog[] {
  return logs.filter(log => !log.initialization && (!cardId || log.cardId === cardId) && log.scopeId === scopeId)
    .slice().sort((left, right) => right.reviewedAt.localeCompare(left.reviewedAt));
}

export function openReviewHistory(plugin: MarginStudyPlugin, cardId?: string, deckId?: string): void {
  const deck = deckId ? plugin.store.getReviewDeck(deckId) : plugin.store.reviewDeckForStudySet();
  const records = deck ? plugin.store.reviewLogsForDeck(deck.id).filter(log => !log.initialization && (!cardId || log.cardId === cardId)).slice().sort((a,b) => b.reviewedAt.localeCompare(a.reviewedAt)) : completedReviewHistory(plugin.store.reviewLogs, cardId, plugin.store.activeCanvasId);
  const { modal } = createModal("逐次复习记录");
  const list = el("div", { style: "max-height:65vh;overflow:auto" });
  const more = el("button", { class: "ms-btn", text: "再显示 50 条" }) as HTMLButtonElement;
  let shown = 0;
  const append = () => {
    for (const log of records.slice(shown, shown + 50)) {
      const row = el("div", { class: "ms-card", style: "margin:8px 0" });
      const name = (log.cardSnapshot?.front || plugin.store.getCard(log.cardId)?.front)?.slice(0, 60) || log.cardId;
      row.append(el("div", { text: name }), el("div", { class: "ms-muted", text: `${new Date(log.reviewedAt).toLocaleString()} · ${["", "重来", "困难", "良好", "简单"][log.rating] || log.rating} · ${Math.round(log.elapsedMs / 1000)} 秒${log.undoneAt ? " · 已撤销" : ""}` }),
        el("div", { class: "ms-muted", text: `${log.questionId} · 间隔 ${intervalLabel(log.before.interval)} → ${intervalLabel(log.after.interval)} · ${log.algorithm}` }));
      if (log.commentText) row.append(el("p", { text: log.commentText, style: "white-space:pre-wrap" }));
      if (log.drawing?.length) appendReviewDrawing(row, log.drawing);
      list.append(row);
    }
    shown += 50; more.disabled = shown >= records.length; more.style.display = more.disabled ? "none" : "";
  };
  if (!records.length) list.append(el("p", { text: "还没有逐次复习记录。旧版每日计数继续保留，但不能还原成逐卡历史。", class: "ms-muted" }));
  more.addEventListener("click", append); modal.append(list, more); append();
}

export async function startReview(plugin: MarginStudyPlugin, options: ReviewOptions = {}): Promise<void> {
  await plugin.store.flush();
  if (options.order === "random" && !options.shuffleSeed) options = { ...options, shuffleSeed: uid("shuffle") };
  if (!options.scopeId && !options.deckId && !options.wrong && plugin.store.reviewDeckForStudySet && !plugin.store.reviewDeckForStudySet(options.studySetId) && (plugin.store.activeStudySetId || !plugin.store.activeReviewDeckId)) {
    openReviewDecks(plugin, { studySetId: options.studySetId, cardIds: options.cardIds }); return;
  }
  const questions = questionsForReview(plugin, options);
  if (!questions.length) { new Notice(options.wrong ? "当前范围没有错题" : "当前范围没有到期的复习题。可先选择卡片加入复习。"); return; }
  const deckId = questions[0].deckId;
  if (deckId && options.presentation !== "score") { openReviewDeckBrowser(plugin, deckId, { ...options, presentation: "browse" }); return; }
  new ReviewModal(plugin, questions, options).open();
}

/** Normal review requires enrollment; wrong-question practice can ignore due times. */
export function questionsForReview(plugin: MarginStudyPlugin, options: ReviewOptions = {}): ReviewQuestion[] {
  const scopeId = options.scopeId ?? plugin.store.activeCanvasId;
  const scopeSet = scopeId ? plugin.store.canvases.find(canvas => canvas.id === scopeId)?.studySetId : undefined;
  const deck = options.deckId ? plugin.store.getReviewDeck(options.deckId) : !options.scopeId ? plugin.store.reviewDeckForStudySet?.(options.studySetId ?? scopeSet) ?? (!plugin.store.activeStudySetId && plugin.store.activeReviewDeckId ? plugin.store.getReviewDeck(plugin.store.activeReviewDeckId) : undefined) : undefined;
  if (options.deckId && !deck) return [];
  const cards = filterReviewCards(deck ? plugin.store.cards.filter(card => deck.cardIds.includes(card.id)) : plugin.store.cardsForStudySet(options.studySetId ?? scopeSet), options);
  if (options.wrong) return filterAndOrderReviewQuestions(plugin.store, cards.flatMap(card => (deck ? plugin.store.deckQuestionsForCard(card.id, deck.id) : questionsForCard(card, scopeId)).filter(question => questionWasWrong(card, question, plugin.store.reviewLogs))), { ...options, deckId: deck?.id });
  const allowed = new Set(cards.map(card => card.id));
  return filterAndOrderReviewQuestions(plugin.store, (deck ? plugin.store.pendingQuestionsForDeck(deck.id) : plugin.store.pendingQuestions(scopeId)).filter(question => allowed.has(question.cardId) && isDue(plugin.store.getReviewState(question.cardId, question.id))), { ...options, deckId: deck?.id });
}

const RATINGS = [
  { grade: 1, label: "Again", className: "again" },
  { grade: 2, label: "Hard", className: "hard" },
  { grade: 3, label: "Good", className: "good" },
  { grade: 4, label: "Easy", className: "easy" },
];

class ReviewModal {
  private session: ReviewSession;
  private modal!: HTMLElement;
  private bg!: HTMLElement;
  private close!: () => void;
  private timer: number | undefined;
  private closed = false;
  private generation = 0;
  private clozeVisible = true;
  private speech = createSpeechSession("review");
  private unsubscribeSpeech = () => {};

  constructor(private plugin: MarginStudyPlugin, private questions: ReviewQuestion[], private options: ReviewOptions) { this.session = new ReviewSession(questions); }

  open(): void {
    const result = createModal("复习", () => { this.closed = true; this.generation++; this.clearTimer(); this.unsubscribeSpeech(); this.speech.dispose(); });
    this.modal = result.modal; this.bg = result.bg; this.close = result.close;
    void this.render();
  }

  private clearTimer(): void { if (this.timer !== undefined) window.clearTimeout(this.timer); this.timer = undefined; }
  private latestLogId(): string | undefined { return this.plugin.store.getLatestReviewLog()?.id; }

  private undoButton(): HTMLButtonElement {
    const button = el("button", { class: "ms-btn", text: "撤销上次评分" });
    button.disabled = !this.session.lastLogId || this.latestLogId() !== this.session.lastLogId;
    button.addEventListener("click", () => {
      if (this.latestLogId() !== this.session.lastLogId) { new Notice("复习记录已变化，请重新打开复习"); return; }
      if (this.plugin.store.undoLastReview()) { this.session.undo(); this.speech.stop(); void this.render(); }
    });
    return button;
  }

  private async render(): Promise<void> {
    if (this.closed) return;
    this.clearTimer(); this.speech.stop(); this.unsubscribeSpeech();
    const generation = ++this.generation;
    clear(this.modal);
    const question = this.session.current(), deckId = question?.deckId ?? this.questions[0]?.deckId;
    const name = deckId ? this.plugin.store.getReviewDeck(deckId)?.name || "复习" : "复习";
    const stage = nativeReviewStage(this.modal, this.bg, { name, count: `${Math.min(this.session.answered + 1, this.questions.length)} / ${this.questions.length}`, detail: `已评分 ${this.session.answered} 次 · 待复习 ${this.session.remaining} 题`, closeLabel: "结束复习", onClose: this.close });
    this.modal.classList.add("ms-review-score");
    stage.inspector.append(this.undoButton());
    const fullscreen = el("button", { class: "ms-btn", text: this.bg.classList.contains("is-fullscreen") ? "退出全屏" : "全屏" });
    fullscreen.addEventListener("click", () => { this.bg.classList.toggle("is-fullscreen"); fullscreen.textContent = this.bg.classList.contains("is-fullscreen") ? "退出全屏" : "全屏"; });
    stage.inspector.append(fullscreen);
    const mode = reviewIconButton(deckId ? "浏览卡组" : "问答评分模式", "aq", "ms-native-review-mode is-active");
    mode.addEventListener("click", () => { if (deckId) { this.close(); openReviewDeckBrowser(this.plugin, deckId, this.options); } });
    stage.footer.append(mode, stage.exit);
    if (!question) {
      stage.edit.disabled = true; stage.favorite.disabled = true;
      const completion = el("div", { class: "ms-native-review-completion", role: "status" });
      if (!this.session.remaining) {
        completion.append(el("h3", { text: "本轮复习完成" }));
        const actions = el("div", { class: "ms-native-review-completion-actions" });
        const restart = el("button", { text: "Start Over", "aria-label": "重新开始本轮复习" });
        restart.addEventListener("click", () => { this.session = new ReviewSession(this.questions); void this.render(); });
        const done = el("button", { text: "Done", "aria-label": "完成" }); done.addEventListener("click", this.close);
        actions.append(restart, done); completion.append(actions);
      } else {
        completion.append(el("p", { text: "短期学习中，到期后继续。" }));
        const remaining = el("div"); completion.append(remaining);
        const update = () => {
          if (this.closed || generation !== this.generation) return;
          const seconds = Math.max(0, Math.ceil((this.session.nextReadyAt - Date.now()) / 1000));
          if (!seconds) { void this.render(); return; }
          remaining.textContent = `下一题约 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒后到期`;
          this.timer = window.setTimeout(update, 1000);
        }; update();
        const done = el("button", { class: "ms-btn", text: "完成" }); done.addEventListener("click", this.close); completion.append(done);
      }
      stage.paper.append(completion); return;
    }
    const card = this.plugin.store.getCard(question.cardId);
    if (!card || card.hidden || card.groupId) { this.session.discard(question.id); void this.render(); return; }
    if (card.typography) { stage.content.style.fontFamily = card.typography.fontFamily; stage.content.style.fontSize = `${card.typography.fontSize}px`; }
    stage.edit.addEventListener("click", () => {
      if (editReviewCard(this.plugin, card, () => { this.close(); startReview(this.plugin, { ...this.options, presentation: "score" }); })) this.speech.stop();
    });
    setReviewFavorite(stage.favorite, !!card.favorite);
    stage.favorite.addEventListener("click", () => { const favorite = !this.plugin.store.getCard(card.id)?.favorite; this.plugin.store.updateCard(card.id, { favorite }); setReviewFavorite(stage.favorite, favorite); });
    appendSources(stage.inspector, this.plugin, card);
    let revealed = false;
    const content = el("div", { class: "ms-review-q" }); stage.content.append(content);
    const face = el("section", { class: "ms-review-question-panel", "aria-label": "复习问题" }); content.append(face);
    let contentGeneration = 0;
    const renderContent = async () => {
      const current = ++contentGeneration, staging = el("div");
      await renderQuestion(staging, this.plugin, card, question, revealed, this.clozeVisible);
      if (!this.closed && generation === this.generation && current === contentGeneration) {
        face.replaceChildren(...staging.childNodes); face.classList.toggle("ms-review-answer-panel", revealed); face.setAttribute("aria-label", revealed ? "复习答案" : "复习问题");
      }
    };
    await renderContent();
    if (this.closed || generation !== this.generation) return;
    const startedAt = Date.now();
    const comment = el("textarea", { class: "ms-input", placeholder: "记录本次复习的想法（可选）", "aria-label": "本次复习批注" });
    const activePreset = this.plugin.activeReader?.getActiveHandwritingPreset?.();
    const presets = handwritingPresets(this.plugin.store.settings);
    const cardPen = this.plugin.activeReader?.getHandwritingPreset?.()
      ?? presets.find(preset => preset.id === activePreset)
      ?? presets.find(preset => preset.type !== "highlighter")
      ?? presets[0];
    const drawing = reviewDrawingInput(cardPen ? { color: cardPen.color, width: handwritingPresetWidth(cardPen, "card"), opacity: cardPen.opacity } : {});
    const response = el("section", { class: "ms-review-response" }); response.append(comment, drawing.element); stage.inspector.append(response);
    const tools = el("div", { class: "ms-review-tools" });
    const speak = el("button", { class: "ms-btn", text: "朗读当前内容" });
    speak.addEventListener("click", () => { void this.speech.start(speechTextFromMarkdown(content.textContent || questionText(card, question, revealed, this.clozeVisible))).then(started => { if (!started && this.speech.state.error) new Notice(this.speech.state.error); }); });
    const pause = el("button", { class: "ms-btn", text: "暂停朗读" });
    pause.addEventListener("click", () => this.speech.state.status === "paused" ? this.speech.resume() : this.speech.pause());
    const stop = el("button", { class: "ms-btn", text: "停止朗读" }); stop.addEventListener("click", () => this.speech.stop());
    const rate = el("select", { class: "ms-select", "aria-label": "复习朗读速度" });
    for (const value of [0.5,0.75,1,1.25,1.5,2,2.5]) rate.append(el("option", { value: String(value), text: `${value}×` }));
    rate.value = String(this.speech.state.rate); rate.addEventListener("change", () => this.speech.setRate(Number(rate.value)));
    this.unsubscribeSpeech = this.speech.subscribe(state => { pause.textContent = state.status === "paused" ? "继续朗读" : "暂停朗读"; pause.disabled = !["speaking", "preparing", "paused"].includes(state.status); });
    const clozeToggle = el("button", { class: "ms-btn", text: this.clozeVisible ? "隐藏挖空" : "显示挖空", "aria-pressed": String(this.clozeVisible), title: "切换当前文本挖空显示；显示答案后方可评分" });
    clozeToggle.addEventListener("click", () => {
      if (revealed) return;
      this.clozeVisible = !this.clozeVisible;
      clozeToggle.textContent = this.clozeVisible ? "隐藏挖空" : "显示挖空"; clozeToggle.setAttribute("aria-pressed", String(this.clozeVisible));
      this.speech.stop(); void renderContent();
    });
    tools.append(clozeToggle, speak, pause, stop, rate); stage.inspector.append(tools);
    const reveal = el("button", { class: "ms-native-review-reveal", text: "显示答案" });
    const grades = el("div", { class: "ms-review-btns", style: "display:none" });
    reveal.addEventListener("click", () => {
      revealed = true; this.speech.stop(); void renderContent(); clozeToggle.disabled = true;
      reveal.disabled = true; reveal.hidden = true; grades.style.display = "grid"; stage.hideTools();
    });
    const state = this.plugin.store.getReviewState(card.id, question.id), previewAt = new Date();
    for (const rating of RATINGS) {
      const interval = previewInterval(state, rating.grade, previewAt);
      const intervalText = intervalLabel(interval).replace(" 分钟", "m").replace(" 小时", "h").replace(" 天", "d");
      const button = el("button", { class: `ms-grade ${rating.className}`, text: `${rating.label} ${intervalText}` });
      button.addEventListener("click", () => {
        if (!revealed || this.closed || generation !== this.generation) return;
        for (const node of grades.querySelectorAll("button")) (node as HTMLButtonElement).disabled = true;
        try {
          const next = this.plugin.store.gradeCard(card.id, rating.grade, { questionId: question.id, scopeId: question.scopeId, deckId: question.deckId, elapsedMs: Math.max(0, Date.now() - startedAt), commentText: comment.value.trim() || undefined, drawing: drawing.value() });
          const logId = this.latestLogId(); if (!logId) throw new Error("评分日志未写入");
          this.session.grade(question, next, logId); this.speech.stop(); void this.render();
        } catch (error) { new Notice(`评分失败：${String(error)}`); for (const node of grades.querySelectorAll("button")) (node as HTMLButtonElement).disabled = false; }
      }); grades.append(button);
    }
    stage.footer.append(reveal, grades);
  }
}
