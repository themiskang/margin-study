/**
 * [INPUT]: 依赖 Store、保存反馈、卡片编辑组件和 Obsidian 宿主。
 * [OUTPUT]: 提供卡片列表、卡片详情和来源跳转。
 * [POS]: 卡片详情将修改交给 Store。桌面冲突期间提示修改仅保留在内存。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { applyCardTypography } from "./typography";
import type MarginStudyPlugin from "../main";
import { bindInlineCardLinks } from "../study/cardLink";
import { TFile, Notice } from "obsidian";
import { Card, CardType } from "../types";
import { el, clear } from "../utils/dom";
import { createModal, openTextModal, openConfirm, openImageLightbox } from "../utils/modal";
import { isDue } from "../srs";
import { startReview, openReviewHistory } from "../review/reviewView";
export { startReview } from "../review/reviewView";
import { questionsForCard, questionWasWrong, validOcclusions } from "../review/questions";
import { cardImages, imageUrl, appendSources, speakCardText, stopCardSpeech } from "../review/content";
import { openOcclusionEditor } from "../review/occlusionEditor";
import { mountTemplateControls } from "../review/templates";
import { openVocabularyLookup } from "../vocabulary/view";
import { enrollCardsForReview, openReviewDecks, registerReviewCardEditor } from "../review/decks";
import { renderMarkdown, parseCloze, hasCloze, clozeHint } from "../utils/markdown";
import { ReaderView, VIEW_TYPE_READER } from "../pdf/readerView";
import { notebookMeta } from "../annot/documentNotebooks";
import { VIEW_TYPE_WORD } from "../word/wordReader";
import { reviewQuestionEditor } from "../review/questionEditor";
import { mountNativeCardEditor } from "./nativeEditor";
import { displayedExcerptBlocks } from "./excerptBlocks";
import type { ExcerptBlock } from "../types";
import { CARD_COLORS } from "../model/cardColors";
import { saveFeedback } from "../model/saveFeedback";

registerReviewCardEditor((plugin, card, onChanged) => openDetail(plugin, card, onChanged));

function typeLabel(t: CardType): string {
  return t === "excerpt" ? "摘录卡" : t === "comment" ? "评论卡" : "闪卡";
}

/** 区域（套索）摘录卡片的截图：全景可见，点击打开灯箱放大 */
function buildRegionImage(image: string, thumb = false): HTMLElement {
  const wrap = el("div", { class: "ms-card-img" + (thumb ? " is-thumb" : "") });
  const img = el("img", { src: image, class: "ms-card-img-el" }) as HTMLImageElement;
  img.title = "点击查看全景 / 放大";
  img.addEventListener("click", (e) => {
    e.stopPropagation();
    openImageLightbox(image);
  });
  wrap.append(img);
  return wrap;
}

export function isDueCard(plugin: MarginStudyPlugin, card: Card): boolean {
  const deck = plugin.store.reviewDeckForStudySet();
  return (deck ? plugin.store.pendingQuestionsForDeck(deck.id) : plugin.store.pendingQuestions(plugin.store.activeCanvasId)).some(question => question.cardId === card.id && isDue(plugin.store.getReviewState(card.id, question.id)));
}

function appendDeckBadges(container: HTMLElement, plugin: MarginStudyPlugin, cardId: string): void {
  const decks = plugin.store.cardReviewDecks(cardId); if (!decks.length) return;
  const badges = el("div", { class: "ms-review-deck-badges" });
  for (const deck of decks) badges.append(el("span", { class: "ms-review-deck-badge", text: deck.name, "data-review-deck": deck.id, title: `属于复习卡组「${deck.name}」` }));
  container.append(badges);
}

/** Wait for the matching reader to finish opening before navigating. */
export function jumpToCardSource(plugin: MarginStudyPlugin, card: Card, block?: ExcerptBlock): void {
  const source = block?.source ?? (block ? card : card.sources?.[0] ?? card);
  if (!source.docPath) { new Notice("这张卡片没有来源文档"); return; }
  void (async () => {
    const file = plugin.app.vault.getAbstractFileByPath(source.docPath);
    if (!(file instanceof TFile)) throw new Error("源文档不存在");
    const reader = await plugin.openDocument(file);
    const notebook = source.documentNotebookId ?? "default";
    if ((reader as any).getDocumentNotebookId?.() !== notebook) await (reader as any).selectDocumentNotebook?.(notebook);
    if (source.anchorAnnId && block?.target && typeof (reader as any).flashExcerptBlock === "function") (reader as any).flashExcerptBlock(source.anchorAnnId, block);
    else if (source.anchorAnnId) reader.flashAnnotation(source.anchorAnnId);
    else if (source.page) { if (reader.gotoSourcePage) reader.gotoSourcePage(source.page); else reader.gotoPage?.(source.page); }
  })().catch((error) => new Notice(`无法跳转原文：${String(error)}`));
}

export function excerptSourceButton(plugin: MarginStudyPlugin, card: Card, block: ExcerptBlock): HTMLElement {
  const button = el("button", { type: "button", text: "定位原文", "aria-label": "定位块原文", "data-excerpt-source": block.id });
  button.addEventListener("click", event => { event.stopPropagation(); jumpToCardSource(plugin, card, block); });
  return button;
}

/** 关键词标题链接：在正在阅读该文档的阅读器中高亮定位关键词 */
export function searchKeywordInDoc(plugin: MarginStudyPlugin, docPath: string, kw: string): void {
  const find = (type: string): any => {
    const leaf = plugin.app.workspace.getLeavesOfType(type).find((l) => {
      const v = l.view as any;
      return typeof v?.getFilePath === "function" && v.getFilePath() === docPath;
    });
    return leaf?.view as any;
  };
  const view = find(VIEW_TYPE_READER) ?? find(VIEW_TYPE_WORD);
  if (!view) {
    new Notice("请先在阅读器中打开「" + docPath.split("/").pop() + "」再定位关键词");
    return;
  }
  if (typeof view.searchInDoc === "function") view.searchInDoc(kw);
  else new Notice("该阅读器暂不支持关键词跳转");
}

function allTags(plugin: MarginStudyPlugin): string[] {
  const set = new Set<string>();
  for (const c of plugin.store.cardsForStudySet()) for (const t of c.tags) set.add(t);
  return [...set].sort();
}

/** 卡片盒/分组看板视图（可筛选/分组/批量） */
export function renderCardList(container: HTMLElement, plugin: MarginStudyPlugin): void {
  clear(container);
  const header = el("div", {
    style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px",
  });
  const count = el("span", { class: "ms-chip", text: `${plugin.store.cardsForStudySet().length} 张` });
  const right = el("div", { style: "display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px" });
  const batchBtn = el("button", { class: "ms-btn", text: "批量" });
  const enroll = el("button", { class: "ms-btn", text: "加入复习", title: "将所选卡片加入学习集绑定的复习卡组；未选择时使用筛选结果。再次加入会立即到期。" });
  enroll.addEventListener("click", () => {
    const ids = selected.size ? [...selected] : filtered().map(card => card.id);
    if (!ids.length) { new Notice("请先选择或筛选需要复习的卡片"); return; }
    enrollCardsForReview(plugin, ids, draw);
  });
  const reviewBtn = el("button", { class: "ms-btn", text: "复习" });
  reviewBtn.addEventListener("click", () => startReview(plugin, { cardIds: selected.size ? [...selected] : filtered().map((card) => card.id), wrong: wrongOnly }));
  const create = el("button", { class: "ms-btn", text: "新建闪卡" });
  create.addEventListener("click", () => {
    const card: Card = { id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, docPath: plugin.activeReader?.getFilePath() ?? "", type: "flashcard", front: "", back: "", reviewQuestion: { mode: "title" }, links: [], tags: [], createdAt: new Date().toISOString() };
    openDetail(plugin, card, () => { count.textContent = `${plugin.store.cardsForStudySet().length} 张`; draw(); });
  });
  const vocabulary = el("button", { class: "ms-btn", text: "外刊生词" });
  vocabulary.addEventListener("click", () => openVocabularyLookup(plugin, "", plugin.activeReader?.getFilePath() ?? ""));
  const decks = el("button", { class: "ms-btn", text: "复习卡组" });
  decks.addEventListener("click", () => openReviewDecks(plugin, { onEnrolled: draw }));
  const questionRule = el("button", { class: "ms-btn", text: "提取问题" });
  questionRule.addEventListener("click", () => openQuestionRulePicker(plugin, selected.size ? [...selected] : filtered().map(card => card.id), draw));
  right.append(create, vocabulary, batchBtn, questionRule, enroll, decks, reviewBtn);
  header.append(count, right);

  const search = el("input", {
    class: "ms-search",
    type: "text",
    placeholder: "搜索卡片…",
  }) as HTMLInputElement;

  // 筛选/分组状态
  const activeTags = new Set<string>();
  const activeColors = new Set<string>();
  let dueOnly = false;
  let wrongOnly = false;
  let groupBy: "none" | "tag" | "doc" = "none";
  let sortBy: "new" | "old" = "new";
  let batchMode = false;
  const selected = new Set<string>();

  const tagBar = el("div", { class: "ms-tagbar" });
  const dueToggle = el("label", { class: "ms-toggle" }) as HTMLLabelElement;
  const dueChk = el("input", { type: "checkbox" }) as HTMLInputElement;
  dueChk.addEventListener("change", () => {
    dueOnly = dueChk.checked;
    draw();
  });
  dueToggle.append(dueChk, document.createTextNode(" 仅到期"));

  const wrongToggle = el("label", { class: "ms-toggle" }) as HTMLLabelElement;
  const wrongChk = el("input", { type: "checkbox" }) as HTMLInputElement;
  wrongChk.addEventListener("change", () => {
    wrongOnly = wrongChk.checked;
    draw();
  });
  wrongToggle.append(wrongChk, document.createTextNode(" 仅错题"));

  const colorChips = el("div", { class: "ms-tagbar" });
  const groupSel = el("select", { class: "ms-select" }) as HTMLSelectElement;
  ["none:不分组", "tag:按标签", "doc:按文档"].forEach((o) => {
    const [v, l] = o.split(":");
    const op = el("option", { value: v, text: l }) as HTMLOptionElement;
    groupSel.append(op);
  });
  groupSel.addEventListener("change", () => {
    groupBy = groupSel.value as any;
    draw();
  });
  const sortSel = el("select", { class: "ms-select" }) as HTMLSelectElement;
  ["new:最新", "old:最早"].forEach((o) => {
    const [v, l] = o.split(":");
    sortSel.append(el("option", { value: v, text: l }) as HTMLOptionElement);
  });
  sortSel.addEventListener("change", () => {
    sortBy = sortSel.value as any;
    draw();
  });

  const listEl = el("div", {});
  const batchBar = el("div", { class: "ms-batchbar", style: "display:none" });

  const distinctColors = (): string[] => {
    const set = new Set<string>();
    for (const c of plugin.store.cardsForStudySet()) if (c.color) set.add(c.color);
    return [...set];
  };

  const drawColors = () => {
    clear(colorChips);
    for (const col of distinctColors()) {
      const chip = el("span", {
        class: "ms-colorchip" + (activeColors.has(col) ? " is-active" : ""),
        style: `background:${col}`,
        title: col,
      });
      chip.addEventListener("click", () => {
        if (activeColors.has(col)) activeColors.delete(col);
        else activeColors.add(col);
        drawColors();
        draw();
      });
      colorChips.append(chip);
    }
  };

  const drawTags = () => {
    clear(tagBar);
    tagBar.append(dueToggle, wrongToggle);
    for (const t of allTags(plugin)) {
      const chip = el("span", {
        class: "ms-tag" + (activeTags.has(t) ? " is-active" : ""),
        text: t,
      });
      chip.addEventListener("click", () => {
        if (activeTags.has(t)) activeTags.delete(t);
        else activeTags.add(t);
        drawTags();
        draw();
      });
      tagBar.append(chip);
    }
  };

  const filtered = (): Card[] => {
    const q = search.value.trim().toLowerCase();
    let cards = plugin.store.cardsForStudySet().filter((c) => {
      if (q && !c.front.toLowerCase().includes(q) && !(c.back ?? "").toLowerCase().includes(q)) return false;
      if (activeTags.size && !c.tags.some((t) => activeTags.has(t))) return false;
      if (activeColors.size && !(c.color && activeColors.has(c.color))) return false;
      if (dueOnly && !isDueCard(plugin, c)) return false;
      const deck = plugin.store.reviewDeckForStudySet();
      if (wrongOnly && !(deck ? plugin.store.deckQuestionsForCard(c.id, deck.id) : questionsForCard(c, plugin.store.activeCanvasId)).some((question) => questionWasWrong(c, question, plugin.store.reviewLogs))) return false;
      return true;
    });
    cards.sort((a, b) => (sortBy === "new" ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
    return cards;
  };

  const makeItem = (c: Card): HTMLElement => {
    const item = el("div", { class: "ms-card", "data-card-id": c.id });
    const appendImage = (source: string) => {
      item.append(buildRegionImage(imageUrl(plugin, source), true));
    };
    bindInlineCardLinks(plugin, item);
    if (c.color) item.style.borderLeft = `4px solid ${c.color}`;
    if (batchMode) {
      const chk = el("input", { type: "checkbox", class: "ms-card-chk" }) as HTMLInputElement;
      chk.checked = selected.has(c.id);
      chk.addEventListener("change", () => {
        if (chk.checked) selected.add(c.id);
        else selected.delete(c.id);
      });
      item.append(chk);
    }
    item.append(el("div", { class: "ms-card-type", text: typeLabel(c.type) }));
    appendDeckBadges(item, plugin, c.id);
    if (c.wrong)
      item.append(el("div", { class: "ms-card-wrong", text: "错题" }));
    if(c.excerptBlocks?.length){
      if(c.front && !c.excerptBlocks.some(block=>block.text)){const front=el("div",{class:"ms-card-front"});applyCardTypography(front,plugin.store.settings,c);item.append(front);void renderMarkdown(plugin.app,hasCloze(c.front)?clozeHint(c.front):c.front,front,c.docPath);}
      for(const block of displayedExcerptBlocks(c)){
        if(block.image){const image=buildRegionImage(imageUrl(plugin,block.image),true);image.dataset.excerptBlock=block.id;item.append(image);}
        if(block.text){const front=el("div",{class:"ms-card-front","data-excerpt-block":block.id});applyCardTypography(front,plugin.store.settings,c);item.append(front);void renderMarkdown(plugin.app,hasCloze(block.text)?clozeHint(block.text):block.text,front,c.docPath);}
        if(block.target)item.append(excerptSourceButton(plugin,c,block));
      }
      for(const image of cardImages(c).slice(c.excerptBlocks.filter(block=>block.image).length))appendImage(image);
    }else{
      for (const image of cardImages(c)) appendImage(image);
      const front = el("div", { class: "ms-card-front" });applyCardTypography(front,plugin.store.settings,c);
      item.append(front);
      const preview = hasCloze(c.front) ? clozeHint(c.front) : c.front.slice(0, 160);
      void renderMarkdown(plugin.app, preview, front, c.docPath);
    }
    if (c.type === "flashcard" && c.back)
      item.append(el("div", { class: "ms-card-back", text: "答案：" + clozeHint(c.back).slice(0, 80) }));
    if (c.tags.length) {
      const tg = el("div", { class: "ms-card-tags" });
      for (const t of c.tags) {
        const col = plugin.store.settings.tagColors[t];
        const tagEl = el("span", { class: "ms-tag", text: t });
        if (col) {
          tagEl.style.background = col;
          tagEl.style.color = "#fff";
          tagEl.style.borderColor = "transparent";
        }
        tg.append(tagEl);
      }
      item.append(tg);
    }
    if (c.links.length) item.append(el("div", { class: "ms-card-links", text: `关联 ${c.links.length}` }));
    item.addEventListener("click", (e) => {
      if (batchMode && (e.target as HTMLElement).tagName !== "INPUT") return;
      if (batchMode) return;
      openDetail(plugin, c, draw);
    });
    return item;
  };

  const draw = () => {
    clear(listEl);
    const cards = filtered();
    if (!cards.length) {
      listEl.append(
        el("p", {
          text: "没有匹配的卡片。在 PDF 中选中文字 → 高亮/批注 → 点标注选「摘录卡/闪卡」即可生成。",
          style: "color:var(--text-muted);font-size:12px",
        })
      );
      return;
    }
    if (groupBy === "none") {
      for (const c of cards) listEl.append(makeItem(c));
    } else {
      const groups = new Map<string, Card[]>();
      for (const c of cards) {
        const keys =
          groupBy === "tag"
            ? c.tags.length
              ? c.tags
              : ["（无标签）"]
            : [c.docPath || "（无来源文档）"];
        for (const k of keys) {
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k)!.push(c);
        }
      }
      for (const [k, cs] of groups) {
        listEl.append(el("div", { class: "ms-group-head", text: `${k} · ${cs.length}` }));
        for (const c of cs) listEl.append(makeItem(c));
      }
    }
  };

  // 批量工具条
  const refreshBatch = () => {
    clear(batchBar);
    batchBar.style.display = batchMode ? "flex" : "none";
    if (!batchMode) return;
    const info = el("span", { class: "ms-muted", text: `已选 ${selected.size}` });
    const tagB = el("button", { class: "ms-btn", text: "打标签" });
    tagB.addEventListener("click", () => {
      if (!selected.size) return;
      openTextModal({
        title: "批量打标签",
        placeholder: "标签，逗号分隔",
        onOk: (v) => {
          const tags = v.split(",").map((s) => s.trim()).filter(Boolean);
          for (const id of selected) {
            const c = plugin.store.getCard(id);
            if (c) plugin.store.updateCard(id, { tags: Array.from(new Set([...c.tags, ...tags])) });
          }
          batchMode = false;
          draw();
        },
      });
    });
    const colorB = el("button", { class: "ms-btn", text: "设颜色" });
    colorB.addEventListener("click", () => {
      if (!selected.size) return;
      const row = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap" });
      const modal = createModal("批量设颜色");
      for (const [index, col] of CARD_COLORS.entries()) {
        const b = el("button", { "aria-label": `卡片颜色 ${index + 1}`, style: `width:28px;height:28px;border-radius:50%;background:${col};border:1px solid var(--divider-color)` });
        b.addEventListener("click", () => {
          for (const id of selected) plugin.store.updateCard(id, { color: col, colorIndex: index });
          modal.close();
          batchMode = false;
          draw();
        });
        row.append(b);
      }
      modal.modal.append(row);
    });
    const delB = el("button", { class: "ms-btn", text: "删除" });
    delB.addEventListener("click", () => {
      if (!selected.size) return;
      for (const id of selected) plugin.store.removeCard(id);
      selected.clear();
      batchMode = false;
      draw();
    });
    batchBar.append(info, tagB, colorB, delB);
  };

  batchBtn.addEventListener("click", () => {
    batchMode = !batchMode;
    batchBtn.classList.toggle("is-active", batchMode);
    if (!batchMode) selected.clear();
    refreshBatch();
    draw();
  });

  search.addEventListener("input", draw);
  const row = el("div", { class: "ms-row" });
  row.append(el("span", { class: "ms-muted", text: "分组" }), groupSel, el("span", { class: "ms-muted", text: "排序" }), sortSel);
  container.append(header, search, tagBar, colorChips, row, batchBar, listEl);
  drawTags();
  drawColors();
  refreshBatch();
  draw();
}

function basename(p: string): string {
  return p.split("/").pop()?.replace(/\.(pdf|docx)$/i, "") ?? p;
}

export function openCardManager(plugin: MarginStudyPlugin): void {
  const { modal } = createModal("卡片盒（分组看板）");
  const wrap = el("div", { style: "max-height:70vh;overflow:auto" });
  renderCardList(wrap, plugin);
  modal.append(wrap);
}

export function openDetail(plugin: MarginStudyPlugin, card: Card, onChanged?: () => void): void {
  let nativeEditor: ReturnType<typeof mountNativeCardEditor> | undefined;
  const { modal, bg, close } = createModal("卡片详情", () => { stopCardSpeech(); nativeEditor?.dispose(); });
  let templateId = card.templateId;
  let refreshCopyMasks = () => {};
  appendSources(modal, plugin, card);
  modal.append(el("div", { class: "ms-card-type", text: plugin.store.cardReviewDecks(card.id).length ? "复习卡" : typeLabel(card.type) }));
  appendDeckBadges(modal, plugin, card.id);
  const titleLabel = el("label", { class: "ms-review-field", text: "标题" });
  const titleInput = el("input", { class: "ms-search", type: "text", "aria-label": "卡片标题", "data-card-part": "title" }) as HTMLInputElement;
  titleInput.value = card.title ?? ""; titleLabel.append(titleInput); modal.append(titleLabel);
  const savedClozeAction = (input: HTMLTextAreaElement, part: "excerpt" | "note", sync: () => void): HTMLElement => {
    const button = el("button", { class: "ms-btn", text: "挖空/取消挖空", "data-cloze-part": part,
      "aria-label": `${part === "excerpt" ? "正面" : "答案"}选中文字挖空或取消挖空`, title: "选中文字后操作；仅对已经保存的内容生效" }) as HTMLButtonElement;
    // Formatting controls keep the textarea selection when the button is pressed.
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", () => {
      const current = plugin.store.getCard(card.id), field = part === "excerpt" ? "front" : "back";
      if (!current) { new Notice("请先保存这张卡片，再选择文字设置挖空"); return; }
      if (input.value !== (current[field] ?? "")) { new Notice("这段文字有未保存的编辑，请先保存后再设置挖空"); return; }
      const start = input.selectionStart, end = input.selectionEnd;
      if (end <= start) { new Notice("请先在文本框内选中需要挖空或取消挖空的文字"); return; }
      try {
        const before = input.value;
        plugin.store.toggleTextCloze(card.id, part, start, end);
        input.value = plugin.store.getCard(card.id)?.[field] ?? "";
        let prefix = 0, suffix = 0;
        while (prefix < Math.min(before.length, input.value.length) && before[prefix] === input.value[prefix]) prefix++;
        while (suffix < Math.min(before.length, input.value.length) - prefix && before[before.length - suffix - 1] === input.value[input.value.length - suffix - 1]) suffix++;
        input.focus(); input.setSelectionRange(prefix, input.value.length - suffix);
        sync(); onChanged?.(); new Notice("已更新所选文字的挖空标记");
      } catch (error) { new Notice(`无法修改挖空：${String(error)}`); }
    });
    return button;
  };

  // 正面
  modal.append(el("label", { text: "正面 / 摘录（Markdown）", style: "font-size:12px;color:var(--text-muted);display:block;margin-top:6px" }));
  const frontPrev = el("div", { class: "ms-md-preview" });
  bindInlineCardLinks(plugin, frontPrev);
  const front = el("textarea", { "aria-label": "卡片正面或摘录", "data-card-part": "excerpt" }) as HTMLTextAreaElement;
  front.value = card.front;
  front.style.minHeight = "70px";
  const syncFront = () => void renderMarkdown(plugin.app, front.value || "*（空）*", frontPrev, card.docPath);
  front.addEventListener("input", syncFront);
  modal.append(front, savedClozeAction(front, "excerpt", syncFront), frontPrev);
  syncFront();

  // Source images and editable Extend comments have different identities.
  const sourceImages = cardImages({...card,extendMedia:card.extendMedia?.filter(media=>media.noteId===card.anchorAnnId),commentMedia:undefined});
  if (sourceImages.length) {
    modal.append(el("label", { text: "来源图片（点击放大）", class: "ms-field-label" }));
    for (const image of sourceImages) modal.append(buildRegionImage(imageUrl(plugin, image)));
  }
  for (const media of (card.extendMedia ?? []).filter(media => media.noteId !== card.anchorAnnId)) {
    const note = notebookMeta(plugin.store.getDocMeta(card.docPath), card.documentNotebookId ?? "default").pdfExtendNotes?.find(note => note.id === media.noteId);
    const block = el("div", { class: "ms-card-extend-comment", "data-extend-comment": media.noteId });
    block.append(el("label", { text: "留白评论", class: "ms-field-label" }), buildRegionImage(imageUrl(plugin, media.image)));
    const actions = el("div", { class: "ms-modal-actions" });
    const getReader = async (): Promise<ReaderView> => {
      let reader = plugin.activeReader;
      if (!(reader instanceof ReaderView) || reader.getFilePath() !== card.docPath) {
        const file = plugin.app.vault.getAbstractFileByPath(card.docPath);
        if (!(file instanceof TFile)) throw new Error("来源文档不存在");
        reader = await plugin.openDocument(file);
      }
      if (!(reader instanceof ReaderView)) throw new Error("请在 PDF 阅读器中编辑留白评论");
      await reader.selectDocumentNotebook(card.documentNotebookId ?? "default");
      const current = reader.getExtendNotes().find(note => note.id === media.noteId);
      if (!current || (current.sourceAnnId ?? current.id) !== card.anchorAnnId) throw new Error("留白评论已改变，请重新打开卡片");
      return reader;
    };
    if (note) {
      const locate = el("button", { class: "ms-btn", text: "定位留白评论" });
      locate.addEventListener("click", () => { void getReader().then(reader => { close(); reader.flashAnnotation(media.noteId); }).catch(error => new Notice(String(error))); });
      actions.append(locate);
    }
    // L4 confirms image-only, positioned-text/ink and three-tool source
    // compositions as single removable comments, separate from independent text.
    const imageComment = !!note?.images?.length && !note.ink?.length && !note.textBoxes?.length;
    const positionedComment = !!note?.textBoxes?.length && !!note.ink?.length && !note.images?.length;
    const tripleComment = !!note?.images?.length && !!note.textBoxes?.length && !!note.ink?.length;
    if (note && note.sourceAnnId === card.anchorAnnId && !note.text && (imageComment || positionedComment || tripleComment || (!note.images?.length && !note.textBoxes?.length && note.ink?.length))) {
      const commentLabel = imageComment || positionedComment || tripleComment ? "留白评论" : "手写评论";
      const remove = el("button", { class: "ms-btn", text: `移除${commentLabel}` }) as HTMLButtonElement;
      const cancel = el("button", { class: "ms-btn", text: "取消移除" }); cancel.hidden = true;
      let confirming = false;
      cancel.addEventListener("click", () => { confirming = false; remove.textContent = `移除${commentLabel}`; remove.classList.remove("mod-warning"); cancel.hidden = true; });
      remove.addEventListener("click", () => {
        if (!confirming) { confirming = true; remove.textContent = `删除${commentLabel}`; remove.classList.add("mod-warning"); cancel.hidden = false; return; }
        remove.disabled = true;
        void (async () => {
          const reader = await getReader(), current = reader.getExtendNotes().find(note => note.id === media.noteId);
          if (!current || current.sourceAnnId !== card.anchorAnnId || current.text ||
              (imageComment ? (!current.images?.length || current.ink?.length || current.textBoxes?.length) : positionedComment ? (current.images?.length || !current.textBoxes?.length || !current.ink?.length) : tripleComment ? (!current.images?.length || !current.textBoxes?.length || !current.ink?.length) : (current.images?.length || current.textBoxes?.length))) throw new Error("评论内容已改变，请在阅读器中编辑");
          await reader.removeExtend(media.noteId); close(); onChanged?.(); plugin.refreshMindmap(); plugin.refreshSidebar();
        })().catch(error => { remove.disabled = false; new Notice(String(error)); });
      });
      actions.append(remove, cancel);
    }
    block.append(actions); modal.append(block);
  }

  // 答案
  let back: HTMLTextAreaElement | null = null;
  {
    modal.append(el("label", { text: "答案（Markdown，留空时使用摘录内容）", style: "font-size:12px;color:var(--text-muted);display:block;margin-top:6px" }));
    back = el("textarea", { "aria-label": "卡片答案或笔记", "data-card-part": "note" }) as HTMLTextAreaElement;
    back.value = card.back ?? "";
    back.style.minHeight = "70px";
    const backPrev = el("div", { class: "ms-md-preview" });
    bindInlineCardLinks(plugin, backPrev);
    const syncBack = () => void renderMarkdown(plugin.app, back!.value || "*（空）*", backPrev, card.docPath);
    back.addEventListener("input", syncBack);
    modal.append(back, savedClozeAction(back, "note", syncBack), backPrev);
    syncBack();
  }

  // 标签
  modal.append(el("label", { text: "标签（逗号分隔）", style: "font-size:12px;color:var(--text-muted);display:block;margin-top:6px" }));
  const tagsInput = el("input", { type: "text", class: "ms-search" }) as HTMLInputElement;
  tagsInput.value = card.tags.join(", ");
  modal.append(tagsInput);

  // 颜色
  modal.append(el("label", { text: "颜色", style: "font-size:12px;color:var(--text-muted);display:block;margin-top:6px" }));
  const colorRow = el("div", { class: "ms-colorrow" });
  const renderColors = () => {
    clear(colorRow);
    const colorGrid = el("div", { class: "ms-card-color-grid" });
    for (const [index, col] of CARD_COLORS.entries()) {
      const b = el("button", {
        class: "ms-colorchip" + (card.colorIndex === index || card.color?.toLowerCase() === col.toLowerCase() ? " is-active" : ""),
        "aria-label": `卡片颜色 ${index + 1}`,
        style: `background:${col}`,
        title: col,
      });
      b.addEventListener("click", () => {
        plugin.store.updateCard(card.id, { color: col, colorIndex: index });
        card.color = col;
        card.colorIndex = index;
        renderColors();
      });
      colorGrid.append(b);
    }
    const clr = el("button", { class: "ms-btn", text: "清除" });
    clr.addEventListener("click", () => {
      plugin.store.updateCard(card.id, { color: undefined });
      card.color = undefined;
      card.colorIndex = undefined;
      renderColors();
    });
    colorRow.append(colorGrid, clr);
  };
  renderColors();
  modal.append(colorRow);

  // 关键词标题链接
  modal.append(el("label", { text: "关键词（触发解释卡，逗号分隔）", style: "font-size:12px;color:var(--text-muted);display:block;margin-top:6px" }));
  const kwInput = el("input", { type: "text", class: "ms-search" }) as HTMLInputElement;
  kwInput.value = (card.keywords ?? []).join(", ");
  modal.append(kwInput);

  // 关键词标题链接：蓝虚线 chips，点击在文档中定位（MN4 风格）
  const kwChips = el("div", { class: "ms-kwchips" });
  const drawKw = () => {
    clear(kwChips);
    for (const kw of card.keywords ?? []) {
      const chip = el("span", { class: "ms-kwchip", text: kw, title: "在文档中定位此关键词" });
      chip.addEventListener("click", () => searchKeywordInDoc(plugin, card.docPath, kw));
      kwChips.append(chip);
    }
  };
  drawKw();
  modal.append(kwChips);

  // Plain cloze plus independently scheduled cN questions are both supported.
  if (card.type === "flashcard") {
    const clozeRow = el("div", { class: "ms-cloze-row", style: "margin-top:6px" });
    const templates: { label: string; code: string }[] = [
      { label: "文本挖空", code: "{{答案}}" },
      { label: "独立填空", code: "{{c1::答案}}" },
      { label: "两个独立填空", code: "{{c1::A}} 与 {{c2::B}}" },
      { label: "选择", code: "下列关于___的说法，{{c1::正确}}的是" },
      { label: "判断", code: "{{c1::应当}} 由甲承担责任" },
    ];
    for (const t of templates) {
      const b = el("button", { class: "ms-btn ms-cloze-tpl", text: t.label });
      b.addEventListener("click", () => {
        front.value = (front.value ? front.value + " " : "") + t.code;
        syncFront();
        new Notice("已插入填空模板：" + t.label);
      });
      clozeRow.append(b);
    }
    modal.append(el("div", { class: "ms-field-label", text: "填空卡模板" }), clozeRow);
  }

  mountTemplateControls(modal, plugin, card, front, back, () => {
    front.dispatchEvent(new Event("input")); back?.dispatchEvent(new Event("input"));
  }, (id) => { templateId = id; });
  const questionEditor = reviewQuestionEditor(plugin, card, () => ({ ...card, title: titleInput.value, front: front.value, back: back?.value }), [{ label: "正文", input: front }, ...(back ? [{ label: "笔记", input: back }] : [])]);
  modal.append(questionEditor.element);
  const actions = el("div", { class: "ms-modal-actions", style: "flex-wrap:wrap" });
  const save = el("button", { class: "ms-btn primary", text: "保存" });
  const saveCard = (): boolean => {
    const commentMedia = nativeEditor?.commentMedia() ?? card.commentMedia;
    const extendText = nativeEditor?.extendText() ?? card.extendText;
    const commentOrder = nativeEditor?.commentOrder() ?? card.commentOrder;
    if (!front.value.trim() && !back?.value.trim() && !titleInput.value.trim() && !cardImages({ ...card, commentMedia }).length) { new Notice("请先填写卡片内容或添加图片"); return false; }
    const tags = tagsInput.value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const keywords = kwInput.value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    let reviewQuestion: Card["reviewQuestion"];
    try { reviewQuestion = questionEditor.value(); } catch (error) { new Notice(String(error)); return false; }
    if (!plugin.store.getCard(card.id)) plugin.store.addCard(card);
    const current = plugin.store.getCard(card.id)!;
    const nextBack = back ? back.value : card.back, nextTitle = titleInput.value.trim() || undefined;
    const typography = nativeEditor?.typography() ?? card.typography;
    if (current.title !== nextTitle || current.front !== front.value || (current.back ?? "") !== (nextBack ?? "") ||
      JSON.stringify(current.tags) !== JSON.stringify(tags) || JSON.stringify(current.keywords ?? []) !== JSON.stringify(keywords) || current.templateId !== templateId || JSON.stringify(current.reviewQuestion) !== JSON.stringify(reviewQuestion) || JSON.stringify(current.typography) !== JSON.stringify(typography) || JSON.stringify(current.commentMedia ?? []) !== JSON.stringify(commentMedia ?? []) || JSON.stringify(current.extendText ?? []) !== JSON.stringify(extendText ?? []) || JSON.stringify(current.commentOrder ?? []) !== JSON.stringify(commentOrder ?? [])) {
      plugin.store.updateCard(card.id, { title: nextTitle, front: front.value, back: nextBack, tags, keywords, templateId, reviewQuestion, typography, commentMedia, extendText, commentOrder });
    }
    onChanged?.();
    return true;
  };
  save.addEventListener("click", () => {
    if (!saveCard()) return;
    new Notice(saveFeedback(plugin.store, "已保存"));
    close();
  });
  const jump = el("button", { class: "ms-btn", text: "跳转原文" });
  jump.addEventListener("click", () => {
    close();
    jumpToCardSource(plugin, card);
  });
  const link = el("button", { class: "ms-btn", text: "关联卡片" });
  link.addEventListener("click", () => openLinkPicker(plugin, card));
  const del = el("button", { class: "ms-btn", text: "删除" });
  del.addEventListener("click", () => {
    openConfirm("删除卡片", "确定删除这张卡片？", () => {
      plugin.store.removeCard(card.id);
      new Notice("已删除");
      onChanged?.();
      close();
    });
  });
  const speak = el("button", { class: "ms-btn", text: "朗读" });
  speak.addEventListener("click", () => speakCardText([titleInput.value, front.value, back?.value].filter(Boolean).join("\n\n")));
  const stop = el("button", { class: "ms-btn", text: "停止朗读" }); stop.addEventListener("click", stopCardSpeech);
  actions.append(save, jump, link, speak, stop);
  if (cardImages(card).length) {
    const occlusion = el("button", { class: "ms-btn", text: "创建 / 编辑图片遮挡" });
    occlusion.addEventListener("click", () => openOcclusionEditor(plugin, card, () => { refreshCopyMasks(); onChanged?.(); })); actions.append(occlusion);
  }
  const review = el("button", { class: "ms-btn", text: "复习此卡" });
  review.addEventListener("click", () => startReview(plugin, { studySetId: "*", cardIds: [card.id] }));
  const enroll = el("button", { class: "ms-btn", text: "加入复习", title: "保存当前内容并加入复习卡组；再次加入会立即到期。" });
  enroll.addEventListener("click", () => {
    if (!saveCard()) return;
    enrollCardsForReview(plugin, [card.id], () => { onChanged?.(); close(); });
  });
  const history = el("button", { class: "ms-btn", text: "复习记录" });
  history.addEventListener("click", () => openReviewHistory(plugin, card.id));
  const copySelection = el("details", { class: "ms-review-copy-options", style: "margin-top:12px" });
  copySelection.append(el("summary", { text: "复习副本内容", style: "cursor:pointer" }));
  const partInputs: { part: "title" | "excerpt" | "note" | "images"; input: HTMLInputElement }[] = [];
  const choices = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;margin:8px 0" });
  for (const [part, name] of [["title", "标题"], ["excerpt", "正文"], ["note", "笔记 / 答案"], ["images", "图片"]] as const) {
    const label = el("label", { style: "display:flex;align-items:center;gap:4px" });
    const input = el("input", { type: "checkbox", "data-copy-part": part }) as HTMLInputElement;
    input.checked = true; label.append(input, name); choices.append(label); partInputs.push({ part, input });
  }
  copySelection.append(choices);
  const maskInputs: { id: string; input: HTMLInputElement }[] = [];
  const maskChoices = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;margin:8px 0" });
  const maskLabel = el("div", { class: "ms-muted", text: "要复制的图片遮挡" });
  const imagePart = partInputs.find(item => item.part === "images")!.input;
  refreshCopyMasks = () => {
    const selected = new Map(maskInputs.map(item => [item.id, item.input.checked]));
    maskInputs.length = 0; clear(maskChoices);
    for (const [index, mask] of validOcclusions(plugin.store.getCard(card.id) ?? card).entries()) {
      const label = el("label", { style: "display:flex;align-items:center;gap:4px" });
      const input = el("input", { type: "checkbox", "data-copy-mask": mask.id }) as HTMLInputElement;
      input.checked = selected.get(mask.id) ?? true; label.append(input, mask.label || `遮挡 ${index + 1}`); maskChoices.append(label); maskInputs.push({ id: mask.id, input });
    }
    maskLabel.style.display = maskInputs.length && imagePart.checked ? "block" : "none";
    maskChoices.style.display = imagePart.checked ? "flex" : "none";
  };
  copySelection.append(maskLabel, maskChoices); imagePart.addEventListener("change", refreshCopyMasks); refreshCopyMasks();
  modal.append(copySelection);
  const copyForReview = el("button", { class: "ms-btn", text: "复制为复习卡", title: "保留来源卡片，在当前脑图创建独立副本并加入复习" });
  copyForReview.addEventListener("click", () => {
    const parts = partInputs.filter(item => item.input.checked).map(item => item.part);
    if (!parts.length) { new Notice("请至少选择一类要复制的内容"); return; }
    if (!saveCard()) return;
    const copy = plugin.store.createReviewCopy(card.id, plugin.store.activeCanvasId, { parts, maskIds: maskInputs.length ? maskInputs.filter(item => item.input.checked).map(item => item.id) : undefined });
    if (!copy) return;
    new Notice("已创建独立复习副本"); onChanged?.();
    enrollCardsForReview(plugin, [copy.id], () => { onChanged?.(); close(); });
  });
  actions.append(enroll, copyForReview, review, history, del);
  if (card.sourceCardId) {
    const source = plugin.store.getCard(card.sourceCardId);
    const provenance = el("div", { class: "ms-review-copy-source" });
    provenance.append(el("p", { class: "ms-muted", text: source ? `来源：${source.title || source.front.slice(0, 60) || "图片卡片"}${card.sourceSyncedAt ? ` · 上次取用 ${new Date(card.sourceSyncedAt).toLocaleString()}` : ""}。副本可独立修改；来源变化后需手动刷新。` : "来源卡片已删除，现有副本仍可独立使用。" }));
    const refresh = el("button", { class: "ms-btn", text: "从来源刷新内容" }) as HTMLButtonElement;
    refresh.disabled = !source;
    refresh.addEventListener("click", () => { if (saveCard()) openReviewCopyRefresh(plugin, card, updated => { onChanged?.(); close(); openDetail(plugin, updated, onChanged); }); });
    provenance.append(refresh); modal.append(provenance);
  }
  if (card.mergedCards?.length) {
    const unmerge = el("button", { class: "ms-btn", text: "解除合并" });
    unmerge.addEventListener("click", () => openConfirm("解除合并", "恢复合并前各张卡片的内容和复习状态？", () => {
      const restored = plugin.store.unmergeCard(card.id); new Notice(`已恢复 ${restored.length} 张卡片`); onChanged?.(); close();
    }));
    actions.append(unmerge);
  }
  modal.append(actions);

  if (card.links.length) {
    const linksEl = el("div", { class: "ms-card-links", style: "margin-top:8px" });
    for (const lid of card.links) {
      const lc = plugin.store.getCard(lid);
      const row = el("span", { class: "ms-chip" });
      const chip = el("button", { type: "button", text: lc ? (lc.title || lc.front).slice(0, 20) : "(已删除)" });
      chip.addEventListener("click", () => {
        const current = plugin.store.getCard(lid); if (current) openDetail(plugin, current);
      });
      const remove = el("button", { type: "button", text: "×", "aria-label": `断开到${lc?.title || lc?.front || lid}的关联` });
      remove.addEventListener("click", () => {
        if (plugin.store.unlinkCards(card.id, lid)) { row.remove(); onChanged?.(); new Notice("已断开此方向关联"); }
      });
      row.append(chip, remove); linksEl.append(row);
    }
    modal.append(
      el("div", { text: "关联：", style: "font-size:12px;color:var(--text-muted);margin-top:8px" }),
      linksEl
    );
  }
  nativeEditor = mountNativeCardEditor(plugin, { modal, bg, card, title: titleInput, front, back: back!, save, tags: tagsInput, onChanged });
}

function openQuestionRulePicker(plugin: MarginStudyPlugin, ids: string[], onChanged: () => void): void {
  if (!ids.length) { new Notice("请先选择或筛选需要设置的卡片"); return; }
  const { modal, close } = createModal("批量提取复习问题");
  modal.append(el("p", { class: "ms-muted", text: `将设置 ${new Set(ids).size} 张卡片的复习正面，来源标题、正文、笔记保持原样。` }));
  const mode = el("select", { class: "ms-select", "aria-label": "批量提取问题规则" }) as HTMLSelectElement;
  for (const [value, text] of [["title","标题作为问题"],["emphasis","重点作为问题"],["whole","整个卡片作为问题"],["legacy","恢复原有正反面"]]) mode.append(el("option", { value, text }));
  const label = el("label", { class: "ms-deck-bind" }), preserve = el("input", { type: "checkbox", "aria-label": "保留单卡自定义问题" }) as HTMLInputElement;
  preserve.checked = true; label.append(preserve, "保留单卡自定义问题（优先于批量规则）");
  const actions = el("div", { class: "ms-modal-actions" }), apply = el("button", { class: "ms-btn primary", text: "应用问题规则" });
  apply.addEventListener("click", () => {
    const count = plugin.store.updateReviewQuestions(ids, mode.value === "legacy" ? undefined : { mode: mode.value as "title" | "emphasis" | "whole" }, preserve.checked);
    new Notice(`已设置 ${count} 张卡片；单卡自定义问题按所选规则保留`); onChanged(); close();
  });
  const cancel = el("button", { class: "ms-btn", text: "取消" }); cancel.addEventListener("click", close); actions.append(apply, cancel); modal.append(mode, label, actions);
}

function openReviewCopyRefresh(plugin: MarginStudyPlugin, copy: Card, onRefreshed: (card: Card) => void): void {
  const source = copy.sourceCardId ? plugin.store.getCard(copy.sourceCardId) : undefined; if (!source) return;
  const { modal, close } = createModal("从来源刷新复习副本");
  modal.append(el("p", { text: "选中的部分会替换为来源卡片的最新内容；其他部分保留副本中的编辑。已有题目的复习进度继续保留。", class: "ms-muted" }));
  const selectedParts = copy.reviewCopySelection?.parts ?? ["title", "excerpt", "note", "images"];
  const parts: { part: "title" | "excerpt" | "note" | "images"; input: HTMLInputElement }[] = [];
  for (const [part, labelText] of [["title","标题"],["excerpt","正文"],["note","笔记 / 答案"],["images","图片"]] as const) {
    const label = el("label", { class: "ms-deck-bind" }), input = el("input", { type: "checkbox", "data-refresh-part": part }) as HTMLInputElement;
    input.checked = selectedParts.includes(part); label.append(input, labelText); parts.push({ part, input }); modal.append(label);
  }
  const masks: { id: string; input: HTMLInputElement }[] = [];
  for (const [index, mask] of validOcclusions(source).entries()) {
    const label = el("label", { class: "ms-deck-bind" }), input = el("input", { type: "checkbox", "data-refresh-mask": mask.id }) as HTMLInputElement;
    input.checked = !copy.reviewCopySelection?.maskIds || copy.reviewCopySelection.maskIds.includes(mask.id);
    label.append(input, mask.label || `遮挡 ${index + 1}`); masks.push({ id: mask.id, input }); modal.append(label);
  }
  const actions = el("div", { class: "ms-modal-actions" });
  const refresh = el("button", { class: "ms-btn primary", text: "刷新选中内容" });
  refresh.addEventListener("click", () => {
    const chosen = parts.filter(item => item.input.checked).map(item => item.part); if (!chosen.length) { new Notice("请至少选择一类来源内容"); return; }
    try { const updated = plugin.store.refreshReviewCopy(copy.id, { parts: chosen, maskIds: masks.length ? masks.filter(item => item.input.checked).map(item => item.id) : undefined });
      if (updated) { close(); new Notice("已从来源刷新所选内容"); onRefreshed(updated); }
    } catch (error) { new Notice(`无法刷新副本：${String(error)}`); }
  });
  const cancel = el("button", { class: "ms-btn", text: "取消" }); cancel.addEventListener("click", close);
  actions.append(refresh, cancel); modal.append(actions);
}

function openLinkPicker(plugin: MarginStudyPlugin, card: Card): void {
  const { modal } = createModal("关联卡片（点击添加）");
  const search = el("input", { class: "ms-search", type: "text", placeholder: "搜索…" }) as HTMLInputElement;
  const direction = el("select", { class: "ms-select", "aria-label": "关联方向" }) as HTMLSelectElement;
  direction.append(el("option", { value: "two-way", text: "双向关联" }), el("option", { value: "one-way", text: "单向关联" }));
  const list = el("div", {});
  const draw = () => {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const others = plugin.store.cards.filter(
      (c) => c.id !== card.id && (!q || c.front.toLowerCase().includes(q))
    );
    for (const c of others) {
      const current = plugin.store.getCard(card.id); if (!current) continue;
      const item = el("div", { class: "ms-card", "data-link-card-id": c.id });
      item.append(el("div", { class: "ms-card-front", text: c.front.slice(0, 80) }));
      item.append(el("div", { class: "ms-card-type", text: current.links.includes(c.id) ? "已关联 ✓" : "" }));
      if (current.links.includes(c.id) || direction.value === "two-way" && c.links.includes(current.id)) {
        const unlink = el("button", { type: "button", class: "ms-btn", text: direction.value === "two-way" ? "断开双向关联" : "断开单向关联" });
        unlink.addEventListener("click", event => {
          event.stopPropagation();
          if (plugin.store.unlinkCards(current.id, c.id, direction.value === "two-way")) { new Notice("已断开关联"); draw(); }
        });
        item.append(unlink);
      }
      item.addEventListener("click", () => {
        if (plugin.store.linkCards(card.id, c.id, direction.value === "two-way")) { new Notice("已关联"); draw(); }
      });
      list.append(item);
    }
  };
  search.addEventListener("input", draw); direction.addEventListener("change", draw);
  modal.append(direction, search, list);
  draw();
}
