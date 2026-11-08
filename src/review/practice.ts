import type MarginStudyPlugin from "../main";
import { Notice } from "obsidian";
import { el, clear } from "../utils/dom";
import { createModal } from "../utils/modal";
import type { PracticeAttempt, PracticeVerdict, StudySetPracticeSettings } from "./contracts";
import { questionsForCard } from "./questions";
import type { ReviewQuestion } from "./questions";
import { renderQuestion } from "./content";
import { filterReviewCards } from "./selection";

const verdictLabels: Record<PracticeVerdict, string> = { correct: "正确", wrong: "错误", partial: "部分正确" };

export function openPractice(plugin: MarginStudyPlugin, options: { studySetId?: string } = {}): void {
  const store = plugin.store;
  let studySetId: string | undefined = options.studySetId ?? store.activeStudySetId ?? store.studySets[0]?.id;
  let selection: StudySetPracticeSettings = structuredClone(store.studySets.find(set => set.id === studySetId)?.practiceSettings ?? {});
  let index = 0, phase: "answer" | "judge" | "done" = "answer", correctionOf: PracticeAttempt | undefined;
  let submittedAnswer = "", submittedMistake = "", lastAttempt: PracticeAttempt | undefined, generation = 0, closed = false;
  const { modal, close } = createModal("刷题练习", () => { closed = true; generation++; });
  modal.classList.add("ms-practice-modal");
  const body = el("div"); modal.append(body);
  const reset = () => { phase = "answer"; correctionOf = undefined; submittedAnswer = ""; submittedMistake = ""; lastAttempt = undefined; };
  const draw = () => {
    if (closed) return;
    const current = ++generation; clear(body);
    const scope = el("section", { class: "ms-practice-scope", "aria-label": "练习范围" });
    const fields = el("div", { class: "ms-practice-scope-fields" });
    const field = (title: string, control: HTMLElement) => { const label = el("label", { class: "ms-review-field", text: title }); label.append(control); fields.append(label); };
    const sets = el("select", { class: "ms-select", "aria-label": "练习学习集" });
    if (!store.studySets.length) sets.append(el("option", { value: "", text: "请先创建学习集" }));
    for (const set of store.studySets) sets.append(el("option", { value: set.id, text: set.name }));
    sets.value = studySetId ?? "";
    sets.addEventListener("change", () => {
      studySetId = sets.value || undefined; selection = structuredClone(store.studySets.find(set => set.id === studySetId)?.practiceSettings ?? {});
      index = 0; reset(); draw();
    }); field("学习集", sets);
    const decks = el("select", { class: "ms-select", "aria-label": "练习卡组范围" });
    decks.append(el("option", { value: "", text: "学习集全部卡片" }));
    for (const deck of store.reviewDecks) decks.append(el("option", { value: deck.id, text: deck.name }));
    if (selection.deckId && !store.getReviewDeck(selection.deckId)) decks.append(el("option", { value: selection.deckId, text: "已保存的卡组不存在" }));
    decks.value = selection.deckId ?? ""; field("卡组", decks);
    const tags = el("input", { class: "ms-search", type: "text", "aria-label": "练习筛选标签", placeholder: "标签，多个用逗号分隔" });
    tags.value = selection.tags?.join(", ") ?? ""; field("标签", tags);
    const favoriteLabel = el("label", { class: "ms-deck-bind" });
    const favorite = el("input", { type: "checkbox", "aria-label": "练习只看收藏" }); favorite.checked = !!selection.favorite;
    favoriteLabel.append(favorite, "只看收藏"); fields.append(favoriteLabel);
    const apply = el("button", { class: "ms-btn", type: "button", text: "应用练习范围" });
    apply.disabled = !studySetId;
    apply.addEventListener("click", () => {
      const chosenTags = tags.value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean);
      selection = { ...(decks.value && { deckId: decks.value }), ...(chosenTags.length && { tags: chosenTags }), ...(favorite.checked && { favorite: true }) };
      if (studySetId) store.setStudySetPracticeSettings(studySetId, selection);
      index = 0; reset(); draw();
    });
    scope.append(fields, apply, el("p", { class: "ms-muted", text: "条件取交集；父标签包含后代。练习不改变复习进度。" })); body.append(scope);

    const deck = selection.deckId ? store.getReviewDeck(selection.deckId) : undefined;
    const cards = studySetId ? filterReviewCards(store.cardsForStudySet(studySetId), { tags: selection.tags, favorite: selection.favorite }) : [];
    const questions = selection.deckId && !deck ? [] : cards.filter(card => !deck || deck.cardIds.includes(card.id)).flatMap(card => questionsForCard(card));
    index = Math.max(0, Math.min(index, questions.length - 1));
    const question = questions[index], card = question && store.getCard(question.cardId);
    const header = el("div", { class: "ms-practice-header" });
    header.append(el("strong", { text: `练习 ${questions.length ? index + 1 : 0} / ${questions.length}` }));
    const navigation = el("div", { class: "ms-review-tools" });
    const previous = el("button", { class: "ms-btn", type: "button", text: "上一题" }); previous.disabled = index === 0;
    const next = el("button", { class: "ms-btn", type: "button", text: "下一题" }); next.disabled = index >= questions.length - 1;
    previous.addEventListener("click", () => { index--; reset(); draw(); }); next.addEventListener("click", () => { index++; reset(); draw(); });
    navigation.append(previous, next); header.append(navigation); body.append(header);
    if (!question || !card || !studySetId) {
      body.append(el("p", { class: "ms-muted", text: studySetId ? "当前范围没有可练习的卡片，请调整卡组或筛选。" : "请先创建学习集，再开始练习。" }));
    } else {
      const panel = el("section", { class: "ms-practice-question", "data-practice-card": card.id, "data-practice-question": question.id });
      panel.append(el("div", { class: "ms-review-section-label", text: question.kind === "cloze" ? "填空题" : question.kind === "occlusion" ? "图片遮挡题" : "问答题" }));
      const questionHost = el("div"); panel.append(questionHost);
      void renderQuestion(questionHost, plugin, card, question, false).catch(error => {
        if (!closed && generation === current) questionHost.textContent = `无法显示题目：${String(error)}`;
      });
      if (correctionOf) panel.append(el("p", { class: "ms-practice-correction", text: `订正 ${new Date(correctionOf.at).toLocaleString()} 的作答；原记录会保留。` }));
      const form = el("div", { class: "ms-practice-response" });
      const answerLabel = el("label", { class: "ms-review-field", text: "你的答案" });
      const answer = el("textarea", { class: "ms-input", "aria-label": "练习答案", placeholder: question.kind === "occlusion" ? "描述遮挡区域" : "写下你的答案" });
      answer.value = submittedAnswer; answer.disabled = phase !== "answer"; answerLabel.append(answer);
      const mistakeLabel = el("label", { class: "ms-review-field", text: "错因（可选）" });
      const mistake = el("textarea", { class: "ms-input", "aria-label": "练习错因", placeholder: "例如：混淆概念或遗漏条件" });
      mistake.value = submittedMistake; mistake.disabled = phase !== "answer"; mistakeLabel.append(mistake);
      form.append(answerLabel, mistakeLabel);
      if (phase === "answer") {
        const submit = el("button", { class: "ms-btn primary", type: "button", text: "提交答案" });
        submit.addEventListener("click", () => {
          if (!answer.value.trim()) { new Notice("请先填写练习答案"); answer.focus(); return; }
          submittedAnswer = answer.value; submittedMistake = mistake.value.trim(); phase = "judge"; draw();
        }); form.append(submit);
        if (correctionOf) {
          const cancel = el("button", { class: "ms-btn", type: "button", text: "取消订正" }); cancel.addEventListener("click", () => { reset(); draw(); }); form.append(cancel);
        }
      } else {
        const reference = el("section", { class: "ms-practice-reference", "aria-label": "参考答案" });
        reference.append(el("strong", { text: "参考答案" })); const referenceHost = el("div"); reference.append(referenceHost); form.append(reference);
        void renderQuestion(referenceHost, plugin, card, question, true).catch(error => {
          if (!closed && generation === current) referenceHost.textContent = `无法显示参考答案：${String(error)}`;
        });
        if (phase === "judge") {
          form.append(el("p", { class: "ms-muted", text: "对照参考内容自行判定；图片及开放题不会自动评分。" }));
          const actions = el("div", { class: "ms-practice-verdicts" });
          for (const verdict of ["correct", "wrong", "partial"] as const) {
            const judge = el("button", { class: "ms-btn", type: "button", text: `判为${verdictLabels[verdict]}` });
            judge.addEventListener("click", () => {
              if (phase !== "judge") return;
              try {
                lastAttempt = store.addPracticeAttempt({ cardId: card.id, studySetId: studySetId!, answer: submittedAnswer, verdict,
                  ...(submittedMistake && verdict !== "correct" && { mistake: submittedMistake }), ...(correctionOf && { correctionOf: correctionOf.id }),
                  questionId: question.id, questionKind: question.kind });
                phase = "done"; draw();
              } catch (error) { new Notice(`无法保存练习：${String(error)}`); }
            }); actions.append(judge);
          }
          const revise = el("button", { class: "ms-btn", type: "button", text: "修改答案" }); revise.addEventListener("click", () => { phase = "answer"; draw(); });
          actions.append(revise); form.append(actions);
        } else {
          form.append(el("p", { role: "status", text: `已记录：${verdictLabels[lastAttempt!.verdict]}` }));
          const retry = el("button", { class: "ms-btn primary", type: "button", text: "再做一次" }); retry.addEventListener("click", () => { reset(); draw(); }); form.append(retry);
        }
      }
      panel.append(form); body.append(panel);
      const history = el("details", { class: "ms-practice-history", open: true });
      const attempts = store.practiceAttempts.filter(attempt => attempt.studySetId === studySetId && attempt.cardId === card.id).slice().reverse();
      history.append(el("summary", { text: `本卡作答记录（${attempts.length}）` }));
      if (!attempts.length) history.append(el("p", { class: "ms-muted", text: "还没有练习记录。" }));
      for (const attempt of attempts) {
        const row = el("article", { class: "ms-practice-history-row", "data-practice-attempt": attempt.id });
        row.append(el("strong", { text: `${new Date(attempt.at).toLocaleString()} · ${verdictLabels[attempt.verdict]}${attempt.correctionOf ? " · 订正" : ""}` }),
          el("p", { text: `答案：${attempt.answer}`, style: "white-space:pre-wrap" }));
        if (attempt.mistake) row.append(el("p", { text: `错因：${attempt.mistake}`, style: "white-space:pre-wrap" }));
        if (attempt.verdict !== "correct") {
          const correct = el("button", { class: "ms-btn", type: "button", text: "订正此记录", "data-correct-attempt": attempt.id });
          const target = questions.findIndex(item => item.cardId === attempt.cardId && item.id === attempt.questionId);
          correct.disabled = target < 0;
          if (target < 0) correct.title = "原题已变化，无法继续订正";
          correct.addEventListener("click", () => { if (target < 0) return; index = target; reset(); correctionOf = attempt; draw(); }); row.append(correct);
        }
        history.append(row);
      }
      body.append(history);
    }
    const actions = el("div", { class: "ms-modal-actions" });
    const exit = el("button", { class: "ms-btn", type: "button", text: "关闭练习" }); exit.addEventListener("click", close); actions.append(exit); body.append(actions);
  };
  draw();
}
