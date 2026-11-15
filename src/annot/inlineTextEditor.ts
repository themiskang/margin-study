import { el } from "../utils/dom";
import type { AnnotationTextRun, AnnotationTextStyle } from "../types";
import { applyTextStyle, normalizeTextRuns, normalizeTextStyle, readTextRuns, renderTextRuns, sliceTextRuns } from "./textRuns";
import { textFontFamilies } from "./textFonts";

export interface InlineTextDraft { text: string; fontSize: number; color: string; background: string; runs?: AnnotationTextRun[]; }
interface TextSelection { start: number; end: number; }
interface DraftState { runs: AnnotationTextRun[]; selection: TextSelection; }
const colors = ["#ff0000", "#ff8000", "#ffbf00", "#dfff00", "#80ff00", "#00ff00", "#00ff40", "#00ffbf", "#00dfff", "#00a0ff", "#0040ff", "#4000ff", "#8000ff", "#df00ff", "#ff00bf", "#ff0040", "#000000", "#555555", "#aaaaaa", "#ffffff"];
const clone = (state: DraftState): DraftState => ({ runs: state.runs.map(run => ({ text: run.text, style: { ...run.style } })), selection: { ...state.selection } });

/** A reader-owned draft, independent of the recyclable PDF/HTML annotation DOM. */
export function openInlineTextEditor(options: {
  scroll: HTMLElement;
  anchor: () => HTMLElement | null;
  fontScale: () => number;
  draft: InlineTextDraft;
  save: (draft: InlineTextDraft) => void;
  label?: string;
  textClass?: string;
}): () => void {
  const host = options.scroll.closest<HTMLElement>(".ms-study-workspace") ?? options.scroll.closest<HTMLElement>(".ms-reader-root") ?? options.scroll.parentElement!;
  const root = el("div", { class: "ms-overlay-text-editor" });
  const layer = el("div", { class: "ms-overlay-editor-layer" }), box = el("div", { class: "ms-overlay-inline-box" });
  const text = el("div", { class: `ms-overlay-inline-text ${options.textClass ?? ""}`, contenteditable: "true", role: "textbox", "aria-multiline": "true", "aria-label": options.label ?? "自由文字内容", spellcheck: "false" });
  const bar = el("div", { class: "ms-overlay-stylebar", role: "toolbar", "aria-label": "文字样式" });
  const font = el("button", { class: "ms-text-font", "aria-label": "文字字体", "aria-haspopup": "listbox" });
  const sizeGroup = el("div", { class: "ms-text-size" });
  const size = el("input", { type: "number", min: "6", max: "300", "aria-label": "文字批注字号" });
  const sizes = el("button", { text: "▴", "aria-label": "选择文字字号", "aria-haspopup": "listbox" });
  const bold = el("button", { class: "ms-text-bold", text: "B", "aria-label": "粗体", title: "粗体（⌘/Ctrl+B）" });
  const italic = el("button", { class: "ms-text-italic", text: "I", "aria-label": "斜体", title: "斜体（⌘/Ctrl+I）" });
  const underline = el("button", { class: "ms-text-underline", text: "U", "aria-label": "下划线", title: "下划线（⌘/Ctrl+U）" });
  const back = el("button", { class: "ms-text-backcolor", "aria-label": "文字背景色", "aria-haspopup": "dialog" });
  back.append(el("span", { text: "A" }));
  const fore = el("button", { class: "ms-text-forecolor", text: "A", "aria-label": "文字前景色", "aria-haspopup": "dialog" });
  const background = el("input", { type: "checkbox", "aria-label": "文字批注白色背景" }); background.checked = options.draft.background === "#ffffff";
  const legacyBackground = el("label", { class: "ms-text-box-background", text: "白色框底" }); legacyBackground.prepend(background);
  const done = el("button", { class: "ms-text-done", text: "✓", "aria-label": "完成文字编辑", title: "完成文字编辑（⌘/Ctrl+Enter）" });
  let boxBackground = options.draft.background;
  let closed = false, frame = 0, composing = false, compositionBefore: DraftState | null = null, popup: HTMLElement | null = null;
  let compositionStyle: AnnotationTextStyle | null = null;
  let pending: AnnotationTextStyle | null = null, lastScale = options.fontScale();
  const fallback = normalizeTextStyle({ fontSize: options.draft.fontSize, color: options.draft.color });
  let state: DraftState = { runs: normalizeTextRuns(options.draft.runs ?? [{ text: options.draft.text, style: fallback }], fallback), selection: { start: 0, end: options.draft.text.length } };
  const undo: DraftState[] = [], redo: DraftState[] = [];
  const length = () => state.runs.reduce((sum, run) => sum + run.text.length, 0);
  const rememberSelection = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!text.contains(range.startContainer) || !text.contains(range.endContainer)) return;
    const prefix = range.cloneRange(); prefix.selectNodeContents(text); prefix.setEnd(range.startContainer, range.startOffset);
    state.selection = { start: Math.min(length(), prefix.toString().length), end: Math.min(length(), prefix.toString().length + range.toString().length) };
  };
  const restoreSelection = () => {
    if (closed) return; text.focus({ preventScroll: true });
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT), nodes: Text[] = []; let node: Node | null;
    while ((node = walker.nextNode())) nodes.push(node as Text);
    if (!nodes.length) { const empty = document.createTextNode(""); text.append(empty); nodes.push(empty); }
    const point = (offset: number): [Text, number] => { for (const node of nodes) { if (offset <= node.length) return [node, offset]; offset -= node.length; } const last = nodes[nodes.length - 1]; return [last, last.length]; };
    const range = document.createRange(); range.setStart(...point(state.selection.start)); range.setEnd(...point(state.selection.end));
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  };
  const selectedStyles = (): AnnotationTextStyle[] => {
    if (pending && state.selection.start === state.selection.end) return [pending];
    if (state.selection.start !== state.selection.end) return sliceTextRuns(state.runs, state.selection.start, state.selection.end).map(run => run.style);
    let at = 0;
    for (const run of state.runs) { at += run.text.length; if (at >= state.selection.start) return [run.style]; }
    return [state.runs[state.runs.length - 1]?.style ?? fallback];
  };
  const updateBar = () => {
    const styles = selectedStyles(), first = styles[0] ?? fallback;
    font.textContent = `▴ ${first.fontFamily}`; font.title = first.fontFamily;
    size.value = styles.every(style => style.fontSize === first.fontSize) ? String(first.fontSize) : ""; size.placeholder = "—";
    for (const [button, key] of [[bold, "bold"], [italic, "italic"], [underline, "underline"]] as const) {
      const count = styles.filter(style => style[key]).length;
      button.setAttribute("aria-pressed", count === styles.length ? "true" : count ? "mixed" : "false");
    }
    fore.style.setProperty("--ms-text-color", first.color); back.style.setProperty("--ms-text-color", first.background === "transparent" ? "#555555" : first.background);
  };
  const checkpoint = (before: DraftState) => { undo.push(clone(before)); if (undo.length > 100) undo.shift(); redo.length = 0; };
  const render = () => { applyTextStyle(text, fallback, options.fontScale()); renderTextRuns(text, state.runs, options.fontScale()); restoreSelection(); updateBar(); };
  const readInput = (record = true) => {
    const next = readTextRuns(text, lastScale, fallback);
    if (JSON.stringify(next) !== JSON.stringify(state.runs)) { if (record && !composing) checkpoint(state); state.runs = next; }
    rememberSelection(); updateBar();
  };
  const format = (patch: Partial<AnnotationTextStyle>) => {
    if (closed || composing) return; readInput(); rememberSelection();
    const { start, end } = state.selection;
    if (start === end) { pending = normalizeTextStyle({ ...selectedStyles()[0], ...patch }, fallback); updateBar(); restoreSelection(); return; }
    const next = normalizeTextRuns([...sliceTextRuns(state.runs, 0, start), ...sliceTextRuns(state.runs, start, end).map(run => ({ text: run.text, style: normalizeTextStyle({ ...run.style, ...patch }, fallback) })), ...sliceTextRuns(state.runs, end, length())], fallback);
    if (JSON.stringify(next) !== JSON.stringify(state.runs)) { checkpoint(state); state.runs = next; }
    pending = null; render();
  };
  const replaceSelection = (value: string, html?: string) => {
    readInput(); rememberSelection(); const { start, end } = state.selection, available = 100_000 - (length() - end + start);
    const base = pending ?? selectedStyles()[0] ?? fallback;
    let insertedRuns: AnnotationTextRun[] = [];
    if (html) {
      const documentFragment = new DOMParser().parseFromString(html, "text/html");
      const walk = (node: Node, style: AnnotationTextStyle) => {
        if (node.nodeType === Node.TEXT_NODE) { insertedRuns.push({ text: node.textContent ?? "", style }); return; }
        if (!(node instanceof HTMLElement) || /^(SCRIPT|STYLE|IFRAME|OBJECT|IMG)$/.test(node.tagName)) return;
        if (node.tagName === "BR") { insertedRuns.push({ text: "\n", style }); return; }
        const size = node.style.fontSize.match(/^([\d.]+)(px|pt|em|rem|%)$/i);
        const number = size ? Number(size[1]) : 0;
        const fontSize = size ? number * (size[2].toLowerCase() === "pt" ? 4 / 3 : size[2].toLowerCase() === "em" ? style.fontSize : size[2].toLowerCase() === "rem" ? 16 : size[2] === "%" ? style.fontSize / 100 : 1) : style.fontSize;
        const nextStyle = normalizeTextStyle({ ...style, fontSize }, base);
        if (/^(DIV|P)$/.test(node.tagName) && insertedRuns.length && !insertedRuns[insertedRuns.length - 1].text.endsWith("\n")) insertedRuns.push({ text: "\n", style });
        for (const child of node.childNodes) walk(child, nextStyle);
      };
      for (const child of documentFragment.body.childNodes) walk(child, base);
      if (value && insertedRuns.map(run => run.text).join("").replace(/\r\n?/g, "\n") !== value.replace(/\r\n?/g, "\n")) insertedRuns = [];
    }
    if (!insertedRuns.length) insertedRuns = [{ text: value.replace(/\r\n?/g, "\n"), style: base }];
    let remaining = Math.max(0, available);
    insertedRuns = insertedRuns.map(run => { const text = run.text.replace(/\r\n?/g, "\n").slice(0, remaining); remaining -= text.length; return { text, style: run.style }; });
    const insertedLength = insertedRuns.reduce((sum, run) => sum + run.text.length, 0);
    const next = normalizeTextRuns([...sliceTextRuns(state.runs, 0, start), ...insertedRuns, ...sliceTextRuns(state.runs, end, length())], fallback);
    if (JSON.stringify(next) !== JSON.stringify(state.runs)) { checkpoint(state); state.runs = next; }
    state.selection = { start: start + insertedLength, end: start + insertedLength }; render();
  };
  const history = (forward: boolean) => {
    if (composing) return; const source = forward ? redo : undo, destination = forward ? undo : redo, previous = source.pop();
    if (!previous) return; destination.push(clone(state)); state = clone(previous); pending = null; render();
  };
  const closePopup = () => { popup?.remove(); popup = null; for (const button of [font, sizes, fore, back]) button.setAttribute("aria-expanded", "false"); };
  const openPopup = (button: HTMLElement, kind: string) => {
    rememberSelection(); const same = popup?.dataset.kind === kind; closePopup(); if (same) return null;
    popup = el("div", { class: "ms-text-style-popover", role: kind === "font" || kind === "size" ? "listbox" : "dialog", "aria-label": kind === "font" ? "选择字体" : kind === "size" ? "选择字号" : "选择文字颜色" }); popup.dataset.kind = kind;
    bar.append(popup); button.setAttribute("aria-expanded", "true");
    const bounds = bar.getBoundingClientRect(), at = button.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(bounds.width - 324, at.left - bounds.left))}px`;
    popup.addEventListener("pointerdown", event => { if (!(event.target as HTMLElement).closest("input")) event.preventDefault(); });
    return popup;
  };
  font.addEventListener("click", () => {
    const menu = openPopup(font, "font"); if (!menu) return;
    const search = el("input", { type: "search", placeholder: "查找字体", "aria-label": "查找文字字体" }), list = el("div", { class: "ms-text-font-list" });
    const draw = () => { list.replaceChildren(); for (const name of [...new Set([...state.runs.map(run => run.style.fontFamily), ...textFontFamilies])].sort((a, b) => a.localeCompare(b)).filter(name => name.toLowerCase().includes(search.value.toLowerCase()))) {
      const choice = el("button", { role: "option", text: name, "aria-label": `字体 ${name}` }); choice.style.fontFamily = `"${name}", sans-serif`;
      choice.addEventListener("click", () => { format({ fontFamily: name }); closePopup(); }); list.append(choice);
    } }; search.addEventListener("input", draw); menu.append(search, list); draw();
  });
  sizes.addEventListener("click", () => { const menu = openPopup(sizes, "size"); if (!menu) return; menu.classList.add("ms-text-size-list"); for (let value = 8; value <= 30; value += 2) {
    const choice = el("button", { role: "option", text: String(value), "aria-label": `字号 ${value}` }); choice.style.fontSize = `${value}px`;
    choice.addEventListener("click", () => { format({ fontSize: value }); closePopup(); }); menu.append(choice);
  } });
  size.addEventListener("focus", rememberSelection); size.addEventListener("change", () => { const value = Number(size.value); if (Number.isFinite(value) && value >= 6 && value <= 300) format({ fontSize: value }); else updateBar(); });
  for (const [button, key] of [[bold, "bold"], [italic, "italic"], [underline, "underline"]] as const) button.addEventListener("click", () => { rememberSelection(); format({ [key]: !selectedStyles().every(style => style[key]) }); closePopup(); });
  for (const [button, key] of [[fore, "color"], [back, "background"]] as const) button.addEventListener("click", () => {
    const menu = openPopup(button, key); if (!menu) return; menu.classList.add("ms-text-color-menu"); const grid = el("div", { class: "ms-text-color-grid" });
    for (const value of colors) { const swatch = el("button", { "aria-label": `文字颜色 ${value}`, title: value }); swatch.style.background = value; swatch.addEventListener("click", () => { format({ [key]: value }); closePopup(); }); grid.append(swatch); }
    const custom = el("input", { type: "color", value: key === "color" ? selectedStyles()[0]?.color ?? fallback.color : "#ffffff", "aria-label": "文字批注颜色" });
    custom.addEventListener("change", () => { format({ [key]: custom.value }); closePopup(); });
    menu.append(grid, custom);
    if (key === "background") { const clear = el("button", { text: "清除文字背景色", "aria-label": "清除文字背景色" }); clear.addEventListener("click", () => { format({ background: "transparent" }); closePopup(); }); menu.append(clear, legacyBackground); }
  });
  for (const button of [font, sizes, bold, italic, underline, fore, back, done]) button.addEventListener("pointerdown", event => { rememberSelection(); event.preventDefault(); });
  text.addEventListener("beforeinput", event => {
    rememberSelection(); if (event.isComposing || composing) return;
    if (["insertParagraph", "insertLineBreak"].includes(event.inputType)) { event.preventDefault(); replaceSelection("\n"); }
    else if (event.inputType === "insertText" && pending && event.data !== null) { event.preventDefault(); replaceSelection(event.data); }
    else if (event.inputType === "historyUndo" || event.inputType === "historyRedo") { event.preventDefault(); history(event.inputType === "historyRedo"); }
  });
  text.addEventListener("input", () => readInput());
  const finishComposition = () => {
    if (!composing) return; readInput(false); composing = false;
    if (compositionBefore) {
      const start = compositionBefore.selection.start, removed = compositionBefore.selection.end - start;
      const inserted = length() - (compositionBefore.runs.reduce((sum, run) => sum + run.text.length, 0) - removed);
      if (compositionStyle && inserted > 0) state.runs = normalizeTextRuns([
        ...sliceTextRuns(state.runs, 0, start), ...sliceTextRuns(state.runs, start, start + inserted).map(run => ({ text: run.text, style: { ...compositionStyle! } })), ...sliceTextRuns(state.runs, start + inserted, length())], fallback);
      if (JSON.stringify(compositionBefore.runs) !== JSON.stringify(state.runs)) checkpoint(compositionBefore);
    }
    compositionBefore = null; compositionStyle = null; render();
  };
  text.addEventListener("compositionstart", () => { readInput(); rememberSelection(); compositionBefore = clone(state); compositionStyle = pending ? { ...pending } : null; composing = true; });
  text.addEventListener("compositionend", finishComposition);
  text.addEventListener("copy", event => {
    if (!event.clipboardData) return;
    readInput(); rememberSelection();
    const runs = sliceTextRuns(state.runs, state.selection.start, state.selection.end);
    if (!runs.length) return;
    const container = document.createElement("div"); renderTextRuns(container, runs);
    event.clipboardData.setData("text/plain", runs.map(run => run.text).join(""));
    event.clipboardData.setData("text/html", container.innerHTML);
    event.preventDefault();
  });
  text.addEventListener("paste", event => { event.preventDefault(); replaceSelection(event.clipboardData?.getData("text/plain") ?? "", event.clipboardData?.getData("text/html")); });
  text.addEventListener("drop", event => { event.preventDefault(); const value = event.dataTransfer?.getData("text/plain"); if (value) replaceSelection(value); });
  const selectionChanged = () => { if (composing) return; const selection = window.getSelection(); if (!selection?.anchorNode || !text.contains(selection.anchorNode)) return; const previous = state.selection; rememberSelection(); if (previous.start !== state.selection.start || previous.end !== state.selection.end) pending = null; updateBar(); };
  const outside = (event: PointerEvent) => { if (popup && !bar.contains(event.target as Node)) closePopup(); };
  const layout = () => {
    frame = 0; if (closed) return;
    const anchor = options.anchor(), viewport = options.scroll.getBoundingClientRect(), bounds = root.getBoundingClientRect();
    const clipBottom = Math.min(viewport.bottom, bounds.bottom - bar.getBoundingClientRect().height);
    layer.style.clipPath = `inset(${Math.max(0, viewport.top - bounds.top)}px ${Math.max(0, bounds.right - viewport.right)}px ${Math.max(0, bounds.bottom - clipBottom)}px ${Math.max(0, viewport.left - bounds.left)}px)`;
    box.hidden = !anchor;
    if (anchor) {
      anchor.classList.add("is-editing-source"); const at = anchor.getBoundingClientRect();
      Object.assign(box.style, { left: `${at.left - bounds.left}px`, top: `${at.top - bounds.top}px`, width: `${at.width}px`, height: `${at.height}px`, background: boxBackground });
      box.style.setProperty("--ms-reading-neutral-ink", boxBackground === "transparent" ? "inherit" : "initial");
    }
    const scale = options.fontScale();
    if (Math.abs(lastScale - scale) > .0001 && !composing) { lastScale = scale; applyTextStyle(text, fallback, scale); renderTextRuns(text, state.runs, scale); if (text === document.activeElement) restoreSelection(); }
  };
  const queue = () => { if (!closed && !frame) frame = requestAnimationFrame(layout); };
  const observer = new MutationObserver(queue), resize = new ResizeObserver(queue);
  const finish = () => {
    if (closed) return; finishComposition(); readInput(); closed = true;
    if (frame) cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect();
    document.removeEventListener("scroll", queue, true); window.removeEventListener("resize", queue); document.removeEventListener("selectionchange", selectionChanged); document.removeEventListener("pointerdown", outside, true);
    options.anchor()?.classList.remove("is-editing-source"); root.remove();
    const first = state.runs[0]?.style ?? pending ?? fallback;
    options.save({ text: state.runs.map(run => run.text).join(""), runs: normalizeTextRuns(state.runs, fallback), fontSize: first.fontSize, color: first.color, background: boxBackground });
  };
  done.addEventListener("click", finish); background.addEventListener("change", () => { boxBackground = background.checked ? "#ffffff" : "transparent"; layout(); });
  root.addEventListener("keydown", event => {
    if (event.isComposing || composing) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (popup) { closePopup(); restoreSelection(); } else finish(); }
    else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); event.stopPropagation(); finish(); }
    else if (text.contains(event.target as Node) && (event.metaKey || event.ctrlKey)) {
      const key = event.key.toLowerCase(), style = { b: "bold", i: "italic", u: "underline" }[key] as "bold" | "italic" | "underline" | undefined;
      if (style) { event.preventDefault(); event.stopPropagation(); format({ [style]: !selectedStyles().every(value => value[style]) }); }
      else if (key === "z") { event.preventDefault(); event.stopPropagation(); history(event.shiftKey); }
      else if (key === "y") { event.preventDefault(); event.stopPropagation(); history(true); }
    }
  });
  sizeGroup.append(sizes, size); box.append(text); layer.append(box); bar.append(font, sizeGroup, bold, italic, underline, back, fore, done); root.append(layer, bar); host.append(root);
  observer.observe(options.scroll, { childList: true, subtree: true }); resize.observe(options.scroll); resize.observe(host);
  document.addEventListener("scroll", queue, true); window.addEventListener("resize", queue); document.addEventListener("selectionchange", selectionChanged); document.addEventListener("pointerdown", outside, true);
  render(); layout();
  return finish;
}
