import type MarginStudyPlugin from "../main";
import type { Card } from "../types";
import { Notice } from "obsidian";
import { el } from "../utils/dom";
import { uid } from "../utils/id";
import { renderMarkdown } from "../utils/markdown";
import { VoiceRecorder, saveVoiceBlob, chooseVoiceInput } from "../audio/voice";
import { reviewDrawingInput } from "../review/drawing";
import { orderedCommentKeys } from "./commentOrder";
import { handwritingPresetWidth, handwritingPresets } from "../annot/handwritingPresets";
import { cardCommentImage, openCardInkComment } from "./inkComment";
import { bindInlineCardLinks } from "../study/cardLink";

const ICONS: Record<string, string> = {
  pen: '<circle cx="12" cy="12" r="9.3"/><path d="m8 18 4-14 4 14M9.5 13h5M10 20l2-3 2 3"/>',
  camera: '<path d="M3 6h4l1.4-2h7.2L17 6h4v14H3Z" fill="currentColor" stroke="none"/><circle cx="12" cy="12.5" r="4" stroke="white"/><path d="M18 8.5h1" stroke="white"/>',
  mic: '<rect x="9.5" y="2" width="5" height="13" rx="2.5" fill="currentColor" stroke="none"/><path d="M6.5 10.5v2a5.5 5.5 0 0 0 11 0v-2M12 18v4M8.5 22h7"/>',
  tag: '<path d="m3 12 9-9h8v8l-9 9Z" fill="currentColor" stroke="none"/><circle cx="16.5" cy="6.5" r="1" fill="white" stroke="none"/>',
  rich: '<path d="M7 4h10M7 4v15h10M7 11h8M5 22h14" stroke-width="3"/>',
  more: '<circle cx="4" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="20" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  save: '<circle cx="12" cy="12" r="9" fill="currentColor" stroke="none"/><path d="m9 11 3 3 3-3" stroke="white" stroke-width="1.5"/>',
};

function iconButton(label: string, icon: string): HTMLButtonElement {
  const button = el("button", { class: "ms-native-card-icon", type: "button", "aria-label": label, title: label });
  button.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
  return button;
}

/** Keeps editing operations on the same title/excerpt/note controls and save path. */
export function mountNativeCardEditor(plugin: MarginStudyPlugin, options: {
  modal: HTMLElement; bg: HTMLElement; card: Card; title: HTMLInputElement; front: HTMLTextAreaElement;
  back: HTMLTextAreaElement; save: HTMLButtonElement; tags: HTMLInputElement; onChanged?: () => void;
}): { typography(): Card["typography"]; commentMedia(): Card["commentMedia"]; extendText(): Card["extendText"]; commentOrder(): Card["commentOrder"]; dispose(): void } {
  const { modal, bg, card, title, front, back, save, tags } = options;
  const titleLabel = title.parentElement;
  const images = [...modal.querySelectorAll<HTMLElement>(":scope > .ms-card-img")];
  const comments = [...modal.querySelectorAll<HTMLElement>(":scope > .ms-card-extend-comment")];
  const commentActions = comments.flatMap(block => [...block.querySelectorAll<HTMLElement>(".ms-modal-actions")]);
  for (const actions of commentActions) actions.hidden = true;
  const advanced = el("div", { class: "ms-native-card-advanced", "aria-label": "更多卡片操作" }); advanced.hidden = true;
  for (const node of [...modal.children]) {
    if (node === titleLabel || node === front || node === back || images.includes(node as HTMLElement) || comments.includes(node as HTMLElement) || node.classList.contains("ms-md-preview") ||
      node.tagName === "H3" || node.tagName === "LABEL" && /^(正面 \/ 摘录|答案（Markdown|区域截图|来源图片)/.test(node.textContent || "")) continue;
    advanced.append(node);
  }
  save.remove(); modal.replaceChildren(); modal.classList.add("ms-native-card-editor"); bg.classList.add("ms-native-card-editor-bg");
  modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-label", "卡片详情");
  const top = el("div", { class: "ms-native-card-top" });
  const type = el("button", { class: "ms-native-card-type", text: plugin.store.cardReviewDecks(card.id).length ? "Review Card ▾" : "Note Card ▾", "aria-label": "卡片模板与类型", title: "卡片模板与复习问题设置" });
  const handle = el("span", { class: "ms-native-card-handle", "aria-hidden": "true" });
  save.className = "ms-native-card-icon ms-native-card-save"; save.setAttribute("aria-label", "保存"); save.title = "保存并关闭";
  save.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${ICONS.save}</svg>`;
  top.append(type, handle, save);
  const sheet = el("div", { class: "ms-native-card-sheet" });
  title.className = "ms-native-card-title"; title.placeholder = "CARD TITLE";title.style.textTransform=plugin.store.settings.cardTitleUppercase?"uppercase":"none";
  const composed=card.extendMedia?.some(media=>media.noteId===card.anchorAnnId&&media.composed);
  if(composed&&!front.value.trim())front.style.display="none";
  front.className = "ms-native-card-excerpt"; front.style.minHeight = "54px"; front.placeholder = "Excerpt";
  back.className = "ms-native-card-note"; back.style.minHeight = "180px"; back.placeholder = "Add Comment";
  const textComment = el("div", { class: "ms-card-text-comment" }); textComment.append(back);
  const textActions = el("div", { class: "ms-modal-actions" }); textActions.hidden = true;
  const removeText = el("button", { class: "ms-card-comment-remove", text: "⊖", "aria-label": "移除文字评论", title: "移除文字评论" });
  const cancelText = el("button", { class: "ms-btn", text: "取消移除文字" }); cancelText.hidden = true;
  let confirmingText = false;
  const resetTextRemoval = () => { confirmingText = false; removeText.textContent = "⊖"; removeText.setAttribute("aria-label", "移除文字评论"); cancelText.hidden = true; textComment.classList.remove("is-confirming"); };
  cancelText.addEventListener("click", resetTextRemoval);
  removeText.addEventListener("click", () => {
    if (!confirmingText) { confirmingText = true; removeText.textContent = "删除"; removeText.setAttribute("aria-label", "删除文字评论"); cancelText.hidden = false; textComment.classList.add("is-confirming"); return; }
    back.value = ""; resetTextRemoval(); back.dispatchEvent(new Event("input"));
  });
  textActions.append(removeText, cancelText); textComment.append(textActions);
  // Separate source text stays after the independent comment, matching the L4 creation order.
  const sourceTexts=(card.extendText??[]).filter(item=>item.text.trim()).map(item=>{
    const input=el("textarea",{class:"ms-native-card-note","aria-label":"来源留白文字"}) as HTMLTextAreaElement;input.value=item.text;
    const block=el("div",{class:"ms-card-text-comment"});block.append(input);
    const actions=el("div",{class:"ms-modal-actions"});actions.hidden=true;
    const remove=el("button",{class:"ms-card-comment-remove",text:"⊖","aria-label":"移除来源留白文字"});
    const cancel=el("button",{class:"ms-btn",text:"取消移除来源文字"});cancel.hidden=true;
    let confirming=false;
    const reset=()=>{confirming=false;remove.textContent="⊖";remove.setAttribute("aria-label","移除来源留白文字");cancel.hidden=true;block.classList.remove("is-confirming");};
    cancel.addEventListener("click",reset);
    remove.addEventListener("click",()=>{if(!confirming){confirming=true;remove.textContent="删除";remove.setAttribute("aria-label","删除来源留白文字");cancel.hidden=false;block.classList.add("is-confirming");return;}input.value="";reset();input.dispatchEvent(new Event("input"));});
    actions.append(remove,cancel);block.append(actions);return {noteId:item.noteId,input,block,actions,reset};
  });
  const hasText=()=>!!back.value.trim()||sourceTexts.some(item=>item.input.value.trim());
  if(title.value.trim())sheet.append(title);else advanced.prepend(title);
  sheet.append(front, ...images, ...comments, textComment,...sourceTexts.map(item=>item.block));
  const preview = el("div", { class: "ms-native-card-rich-preview" }); preview.hidden = true; bindInlineCardLinks(plugin, preview);
  const tools = el("div", { class: "ms-native-card-footer" });
  const pen = iconButton("手写批注", "pen"), camera = iconButton("插入图片", "camera"), mic = iconButton("录制语音批注", "mic"), tag = iconButton("编辑标签", "tag"), rich = iconButton("切换 Markdown / 预览", "rich"), more = iconButton("更多卡片操作", "more");
  let attached = (card.commentMedia ?? []).map(item => ({ ...item }));
  let knownStored = new Set(attached.map(item => item.id));
  const attachedRoot = el("div", { class: "ms-card-attached-comments" }); sheet.append(attachedRoot);
  const comment = el("button", { class: "ms-native-card-comment", text: "Edit Comments", "aria-label": "编辑评论" }); comment.disabled = !hasText() && !comments.length && !attached.length;
  let editingComments = false, orderChanged=false;
  let commentOrder=[...(card.commentOrder??[])];
  let cancelCommentDrag: (() => void) | undefined;
  comment.addEventListener("click", () => {
    if (editingComments || hasText() || comments.length || attached.length) {
      editingComments = !editingComments;
      for (const actions of commentActions) actions.hidden = !editingComments;
      textActions.hidden = !editingComments || !back.value.trim();
      comment.textContent = editingComments ? "Done" : "Edit Comments";
      comment.setAttribute("aria-pressed", String(editingComments));
      modal.classList.toggle("is-editing-comments", editingComments);
      formatBar.hidden = editingComments;
      resetTextRemoval();
      sourceTexts.forEach(item=>item.reset());
      drawAttached();
      if (editingComments) (comments[0] ?? attachedRoot).scrollIntoView({ block: "nearest" });
    } else { back.focus(); back.setSelectionRange(back.value.length, back.value.length); }
  });
  function drawAttached(): void {
    cancelCommentDrag?.();
    const rows:{key:string;block:HTMLElement;actions:HTMLElement;label:string}[]=[];
    for(const block of comments){const noteId=block.dataset.extendComment;if(noteId)rows.push({key:"extend-media:"+noteId,block,actions:block.querySelector<HTMLElement>(".ms-modal-actions")!,label:"留白评论"});}
    if(back.value.trim())rows.push({key:"back",block:textComment,actions:textActions,label:"文字评论"});
    for(const item of sourceTexts)if(item.input.value.trim())rows.push({key:"extend-text:"+item.noteId,block:item.block,actions:item.actions,label:"来源留白文字"});
    for(const item of attached){
      const block=el("div",{class:"ms-card-extend-comment","data-card-comment":item.id});
      const media=cardCommentImage(plugin,item,{alt:item.name??(item.kind==="ink"?"手写评论":"图片评论"),style:item.collapsed === undefined ? "display:block;width:120px;max-width:100%;max-height:160px;object-fit:contain;margin:auto" : "display:block;width:100%;height:auto;margin:8px auto"});
      media.querySelector("img")?.setAttribute("aria-label","卡片附加图片"); if(media instanceof HTMLImageElement)media.setAttribute("aria-label","卡片附加图片"); block.append(media);
      const actions=el("div",{class:"ms-modal-actions"}),remove=el("button",{class:"ms-card-comment-remove",text:"⊖","aria-label":"移除图片评论",title:"移除图片评论"}),cancel=el("button",{class:"ms-btn",text:"取消移除图片"});cancel.hidden=true;let confirming=false;
      cancel.addEventListener("click",()=>{confirming=false;remove.textContent="⊖";remove.setAttribute("aria-label","移除图片评论");block.classList.remove("is-confirming");cancel.hidden=true;});
      remove.addEventListener("click",()=>{if(!confirming){confirming=true;remove.textContent="删除";remove.setAttribute("aria-label","删除图片评论");block.classList.add("is-confirming");cancel.hidden=false;return;}attached=attached.filter(value=>value.id!==item.id);drawAttached();});
      actions.append(remove,cancel);block.append(actions);rows.push({key:"media:"+item.id,block,actions,label:"图片评论"});
    }
    const keys=orderedCommentKeys(rows.map(row=>row.key),commentOrder),ordered=keys.map(key=>rows.find(row=>row.key===key)!);
    // Detach reused fields first so rebuilding media never discards their text/selection.
    for(const row of rows)row.block.remove();textComment.remove();sourceTexts.forEach(item=>item.block.remove());
    attachedRoot.replaceChildren();
    const reorder=(from:number,to:number)=>{if(from===to||to<0||to>=keys.length)return;const next=[...keys],[key]=next.splice(from,1);next.splice(to,0,key);commentOrder=next;orderChanged=true;drawAttached();};
    ordered.forEach((row,index)=>{
      const {block,actions,label}=row;block.dataset.commentKey=row.key;actions.hidden=!editingComments;
      actions.querySelector(":scope > .ms-card-comment-order")?.remove();
      const order=el("div",{class:"ms-card-comment-order"});
      const grip=el("button",{class:"ms-card-comment-drag",type:"button",text:"≡","aria-label":"拖动排序"+label,title:"拖动排序"+label});
      grip.addEventListener("pointerdown",event=>{
        if(event.button!==0||keys.length<2)return;cancelCommentDrag?.();event.preventDefault();event.stopPropagation();const start=event.clientY;let target=index,moved=false;
        try{grip.setPointerCapture(event.pointerId);}catch{/* Synthetic pointer input has no native capture. */}
        const clear=()=>ordered.forEach(item=>item.block.classList.remove("is-drop-before","is-drop-after"));
        const update=(next:PointerEvent)=>{if(next.pointerId!==event.pointerId)return;moved=Math.abs(next.clientY-start)>4;clear();target=index;if(!moved)return;block.classList.add("is-dragging-comment");const others=ordered.filter(item=>item!==row);target=others.filter(item=>{const rect=item.block.getBoundingClientRect();return next.clientY>rect.top+rect.height/2;}).length;if(target!==index){const before=others[target];(before??others[others.length-1])?.block.classList.add(before?"is-drop-before":"is-drop-after");}};
        const cancel=()=>{clear();block.classList.remove("is-dragging-comment");window.removeEventListener("pointermove",update,true);window.removeEventListener("pointerup",finish,true);window.removeEventListener("pointercancel",cancelled,true);window.removeEventListener("blur",cancel);window.removeEventListener("keydown",escape,true);grip.removeEventListener("lostpointercapture",cancelled);if(grip.hasPointerCapture(event.pointerId))grip.releasePointerCapture(event.pointerId);cancelCommentDrag=undefined;};
        const finish=(next:PointerEvent)=>{if(next.pointerId!==event.pointerId)return;update(next);const to=target,commit=moved&&to!==index;cancel();if(commit)reorder(index,to);};
        const cancelled=(next:PointerEvent)=>{if(next.pointerId===event.pointerId)cancel();};const escape=(next:KeyboardEvent)=>{if(next.key==="Escape"){next.preventDefault();next.stopPropagation();cancel();}};
        window.addEventListener("pointermove",update,true);window.addEventListener("pointerup",finish,true);window.addEventListener("pointercancel",cancelled,true);window.addEventListener("blur",cancel);window.addEventListener("keydown",escape,true);grip.addEventListener("lostpointercapture",cancelled);cancelCommentDrag=cancel;
      });
      order.append(grip);
      for(const offset of [-1,1]){const move=el("button",{class:"ms-card-comment-move",text:offset<0?"⌃":"⌄","aria-label":(offset<0?"上移":"下移")+label,title:(offset<0?"上移":"下移")+label});move.disabled=index+offset<0||index+offset>=keys.length;move.addEventListener("click",()=>reorder(index,index+offset));order.append(move);}
      actions.append(order);attachedRoot.append(block);
    });
    if(!back.value.trim())sheet.append(textComment);
    for(const item of sourceTexts)if(!item.input.value.trim())sheet.append(item.block);
    comment.disabled=!editingComments&&!hasText()&&!comments.length&&!attached.length;sheet.classList.toggle("has-media-comments",!!attached.length||!!comments.length);sizeComment();
  }
  function sizeComment(): void {
    const compact = editingComments || !!attached.length || !!comments.length || !!sourceTexts.length;
    for(const item of sourceTexts){item.actions.hidden=!editingComments||!item.input.value.trim();item.input.style.minHeight="0px";item.input.style.height="0px";item.input.style.height=`${Math.max(36,item.input.scrollHeight)}px`;item.block.classList.toggle("has-text",!!item.input.value.trim());}
    back.style.minHeight = compact ? "0px" : "180px";
    back.placeholder = compact ? "" : "Add Comment";
    if (compact) { back.style.height = "0px"; back.style.height = `${Math.max(back.value.trim() ? 36 : 20, back.scrollHeight)}px`; }
    else back.style.removeProperty("height");
    textComment.classList.toggle("has-text", !!back.value.trim());
    textActions.hidden = !editingComments || !back.value.trim();
  }
  const addMedia = (image: string, kind: "image" | "ink", name?: string, strokes?: NonNullable<Card["commentMedia"]>[number]["strokes"]) => { attached.push({ id: uid("comment"), image, kind, name, ...(strokes ? { strokes } : {}) }); drawAttached(); attachedRoot.lastElementChild?.scrollIntoView({block:"nearest"}); };
  drawAttached();
  for(const input of [back,...sourceTexts.map(item=>item.input)])input.addEventListener("input", () => { comment.disabled = !editingComments && !hasText() && !comments.length && !attached.length; sizeComment(); });
  const addInk = (mode: "snapshot" | "blank") => openCardInkComment(plugin, card.id, mode, () => {
    const latest = plugin.store.getCard(card.id)?.commentMedia ?? [];
    const latestIds = new Set(latest.map(item => item.id));
    attached = [...attached.filter(item => !knownStored.has(item.id) || latestIds.has(item.id)), ...latest.filter(item => !knownStored.has(item.id) && !attached.some(value => value.id === item.id)).map(item => ({ ...item }))];
    knownStored = latestIds;
    drawAttached(); options.onChanged?.();
  });
  const snapshot = el("button", { class: "ms-native-card-icon", type: "button", text: "截图批注", "aria-label": "整卡截图批注", title: "整卡截图批注" });
  const blank = el("button", { class: "ms-native-card-icon", type: "button", text: "空白", "aria-label": "空白手写", title: "空白手写" });
  snapshot.addEventListener("click", () => addInk("snapshot")); blank.addEventListener("click", () => addInk("blank"));
  tools.append(pen, camera, mic, tag, rich, comment, more);
  const formatBar = el("div", { class: "ms-native-card-formatbar", "aria-label": "文字格式" }); formatBar.hidden=true;
  const markdown = el("button", { text: "Markdown", "aria-label": "切换 Markdown / 预览" });
  const family = el("select", { "aria-label": "卡片字体" });
  for (const face of ["Helvetica", "Georgia", "Courier New"]) family.append(el("option", { value: face, text: `▴ ${face}` }));
  const size = el("select", { "aria-label": "卡片字号" });
  for (const value of [12,14,16,18,20,24,28,32]) size.append(el("option", { value, text: `▴ ${value}` }));
  family.value = card.typography?.fontFamily ?? plugin.store.settings.cardFontFamily ?? "Helvetica"; size.value = String(card.typography?.fontSize ?? plugin.store.settings.cardBaseFontSize ?? 16);
  let styleChanged = false;
  const style = () => { for (const target of [sheet, title, front, back,...sourceTexts.map(item=>item.input), preview]) { target.style.fontFamily = family.value; target.style.fontSize = `${size.value}px`; } };
  family.addEventListener("change", () => { styleChanged = true; style(); }); size.addEventListener("change", () => { styleChanged = true; style(); }); style();
  let active: HTMLTextAreaElement = back, markdownMode = true, disposed = false, previewGeneration = 0;
  for (const input of [front, back,...sourceTexts.map(item=>item.input)]) input.addEventListener("focus", () => { active = input; formatBar.hidden=editingComments||!!plugin.store.settings.hideKeyboardAccessoryBar; });
  const insert = (before: string, after = "", fallback = "") => {
    const start = active.selectionStart, end = active.selectionEnd, selected = active.value.slice(start,end) || fallback;
    active.setRangeText(before + selected + after, start, end, "select"); active.focus(); active.setSelectionRange(start + before.length, start + before.length + selected.length); active.dispatchEvent(new Event("input"));
  };
  const formatting = (label: string, text: string, before: string, after = before) => {
    const button = el("button", { text, "aria-label": label, title: label });
    button.addEventListener("mousedown", event => event.preventDefault()); button.addEventListener("click", () => insert(before, after, "文字")); return button;
  };
  const bold = formatting("加粗", "B", "**"), italic = formatting("斜体", "I", "*"), underline = formatting("下划线", "U", "<u>", "</u>");
  bold.style.fontWeight = "700"; italic.style.fontStyle = "italic"; underline.style.textDecoration = "underline";
  const highlight = formatting("背景高亮", "▣", "=="), color = el("button", { text: "A", "aria-label": "文字颜色", title: "文字颜色", style: "text-decoration:underline;text-decoration-thickness:3px" });
  const colorInput = el("input", { type: "color", value: "#007aff", "aria-label": "选择文字颜色", style: "display:none" });
  color.addEventListener("mousedown", event => event.preventDefault()); color.addEventListener("click", () => colorInput.click());
  colorInput.addEventListener("input", () => insert(`<span style="color:${colorInput.value}">`, "</span>", "文字"));
  formatBar.append(markdown, family, size, bold, italic, underline, highlight, color, colorInput);
  const togglePreview = async () => {
    markdownMode = !markdownMode; const generation = ++previewGeneration;
    sheet.hidden = !markdownMode; preview.hidden = markdownMode; markdown.setAttribute("aria-pressed", String(markdownMode));
    if (!markdownMode) {
      const staging = el("div");
      if (title.value) staging.append(el("h3", { text: title.value }));
      const excerpt = el("div"), note = el("div");
      await renderMarkdown(plugin.app, front.value, excerpt, card.docPath);
      await renderMarkdown(plugin.app, back.value, note, card.docPath);
      const mediaCopy = (node: HTMLElement) => {
        const copy = node.cloneNode(true) as HTMLElement;
        copy.querySelectorAll(".ms-modal-actions").forEach(actions => actions.remove());
        return copy;
      };
      staging.append(excerpt, ...images.map(mediaCopy), ...comments.map(mediaCopy), note);
      for(const item of sourceTexts){const text=el("div");await renderMarkdown(plugin.app,item.input.value,text,card.docPath);staging.append(text);}
      staging.append(mediaCopy(attachedRoot));
      if (!disposed && generation === previewGeneration) preview.replaceChildren(...staging.childNodes);
    }
  };
  rich.addEventListener("click", () => { void togglePreview(); }); markdown.addEventListener("click", () => { void togglePreview(); });
  const openAdvanced = (target?: HTMLElement) => {
    advanced.hidden = false; more.setAttribute("aria-expanded", "true");
    if (target) { target.scrollIntoView({block:"nearest"}); target.focus(); }
  };
  more.setAttribute("aria-expanded", "false");
  more.addEventListener("mousedown", event => event.preventDefault());
  more.addEventListener("click", () => { advanced.hidden = !advanced.hidden; more.setAttribute("aria-expanded", String(!advanced.hidden)); });
  for (const details of advanced.querySelectorAll("details")) details.addEventListener("toggle", () => {
    if (!details.open || advanced.hidden) return;
    if (!details.classList.contains("ms-review-copy-options")) { details.scrollIntoView({block:"nearest"}); return; }
    const target = details.querySelector<HTMLElement>("input") ?? details;
    const panelBounds = advanced.getBoundingClientRect(), targetBounds = target.getBoundingClientRect();
    advanced.scrollTop += targetBounds.top - panelBounds.top - (advanced.clientHeight - targetBounds.height) / 2;
  });
  type.addEventListener("click", () => { openAdvanced(advanced.querySelector<HTMLElement>(".ms-template-controls select") ?? undefined); });
  tag.addEventListener("click", () => openAdvanced(tags));
  const file = el("input", { type: "file", accept: "image/*", "aria-label": "选择卡片图片", style: "display:none" });
  camera.addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const selected = file.files?.[0]; if (!selected) return;
    const reader = new FileReader();
    reader.onload = () => { if (!disposed && typeof reader.result === "string") addMedia(reader.result, "image", selected.name); };
    reader.readAsDataURL(selected); file.value = "";
  });
  const handwriting = el("div", { class: "ms-native-card-handwriting" }); handwriting.hidden = true;
  const activePreset = plugin.activeReader?.getActiveHandwritingPreset?.();
  const presets = handwritingPresets(plugin.store.settings);
  const cardPen = plugin.activeReader?.getHandwritingPreset?.()
    ?? presets.find(preset => preset.id === activePreset)
    ?? presets.find(preset => preset.type !== "highlighter")
    ?? presets[0];
  const drawing = reviewDrawingInput(cardPen ? { color: cardPen.color, width: handwritingPresetWidth(cardPen, "card"), opacity: cardPen.opacity } : {}); (drawing.element as HTMLDetailsElement).open = true;
  const addDrawing = el("button", { class: "ms-btn", text: "插入手写批注" });
  addDrawing.addEventListener("click", () => {
    const canvas = drawing.element.querySelector("canvas"); if (!canvas || !drawing.value()?.length) { new Notice("请先写下批注"); return; }
    addMedia(canvas.toDataURL("image/png"), "ink", "手写评论", drawing.vectorStrokes()); handwriting.hidden = true;
  });
  const inkEntries = el("div", { class: "ms-modal-actions" }); inkEntries.append(snapshot, blank);
  handwriting.append(inkEntries, drawing.element, addDrawing);
  pen.addEventListener("click", () => { handwriting.hidden = !handwriting.hidden; });
  const recorder = new VoiceRecorder(); let stopping = false, recordingStarted = false;
  mic.addEventListener("click", () => {
    if (stopping) return;
    void (async () => {
      if (!recordingStarted) { stopping = true; const input=await chooseVoiceInput(); if(input===null||disposed)return; await recorder.start(input); recordingStarted=true; stopping=false; if (disposed) { await recorder.stop(); return; } mic.classList.add("is-recording"); mic.setAttribute("aria-label", "停止并插入录音"); mic.title = "停止并插入录音"; }
      else { stopping = true; const blob = await recorder.stop().finally(() => { recordingStarted = false; }); if (!disposed) { const path = await saveVoiceBlob(plugin.app, card.docPath || card.id, blob); if (!disposed) insert(`\n![[${path}]]\n`); } }
    })().catch(error => new Notice(`录音失败：${String(error)}`)).finally(() => { if (!recorder.isRecording) { stopping = false; mic.classList.remove("is-recording"); mic.setAttribute("aria-label", "录制语音批注"); mic.title = "录制语音批注"; } });
  });
  const resize = el("div", { class: "ms-native-card-resize", title: "调整卡片编辑器大小", "aria-hidden": "true" });
  const drag = (grip: HTMLElement, resizing: boolean) => {
    grip.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      const bounds = modal.getBoundingClientRect(), start = {x:event.clientX,y:event.clientY};
      grip.setPointerCapture(event.pointerId); event.preventDefault();
      const move = (next: PointerEvent) => {
        if (next.pointerId !== event.pointerId) return;
        if (resizing) {
          modal.style.setProperty("width", `${Math.max(360,Math.min(window.innerWidth-bounds.left-12,bounds.width+next.clientX-start.x))}px`, "important");
          modal.style.height = `${Math.max(320,Math.min(window.innerHeight-bounds.top-48,bounds.height+next.clientY-start.y))}px`;
        } else {
          modal.style.left = `${Math.max(8,Math.min(window.innerWidth-bounds.width-8,bounds.left+next.clientX-start.x))}px`;
          modal.style.top = `${Math.max(8,Math.min(window.innerHeight-bounds.height-48,bounds.top+next.clientY-start.y))}px`;
        }
      };
      const end = (next: PointerEvent) => { if (next.pointerId !== event.pointerId) return; grip.removeEventListener("pointermove",move); grip.removeEventListener("pointerup",end); grip.removeEventListener("pointercancel",end); if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId); };
      grip.addEventListener("pointermove",move); grip.addEventListener("pointerup",end); grip.addEventListener("pointercancel",end);
    });
  }; drag(handle,false); drag(resize,true);
  modal.append(top, sheet, preview, tools, advanced, handwriting, file, resize); bg.append(formatBar); sizeComment();
  return {
    extendText: () => card.extendText?.map(item=>({ ...item,text:sourceTexts.find(draft=>draft.noteId===item.noteId)?.input.value??item.text })),
    commentMedia: () => orderedCommentKeys(attached.map(item=>"media:"+item.id),commentOrder).map(key=>({...attached.find(item=>"media:"+item.id===key)!})),
    commentOrder: () => card.commentOrder||orderChanged ? orderedCommentKeys([...attachedRoot.children].map(node=>(node as HTMLElement).dataset.commentKey).filter((key):key is string=>!!key),commentOrder) : undefined,
    typography: () => styleChanged || card.typography ? { fontFamily: family.value as NonNullable<Card["typography"]>["fontFamily"], fontSize: Number(size.value) } : undefined,
    dispose: () => { disposed = true; previewGeneration++; cancelCommentDrag?.(); if (recorder.isRecording && !stopping) { stopping = true; void recorder.stop().catch(() => {}); } },
  };
}
