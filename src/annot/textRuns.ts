import type { Annotation, AnnotationTextRun, AnnotationTextStyle } from "../types";

export function textColor(value: unknown, fallback = "#111111"): string {
  if (typeof value !== "string") return fallback;
  if (/^#[\da-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[\da-f]{3}$/i.test(value)) return "#" + [...value.slice(1)].map(c => c + c).join("").toLowerCase();
  const rgb = value.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
  if (!rgb) return fallback;
  if (rgb[4] !== undefined && Number(rgb[4]) === 0) return "transparent";
  return "#" + rgb.slice(1, 4).map(c => Math.round(Math.max(0, Math.min(255, Number(c)))).toString(16).padStart(2, "0")).join("");
}
export function textFont(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.split(",")[0].replace(/["'\\;\r\n]/g, "").trim().slice(0, 100) : "Helvetica Neue";
}
export function normalizeTextStyle(value: Partial<AnnotationTextStyle>, fallback?: AnnotationTextStyle): AnnotationTextStyle {
  const base = fallback ?? { fontFamily: "Helvetica Neue", fontSize: 16, bold: false, italic: false, underline: false, color: "#111111", background: "transparent" };
  // Round below a visible subpixel: PDF scale round-trips must not turn 20 into 20.000000000000004.
  return { fontFamily: textFont(value.fontFamily ?? base.fontFamily), fontSize: Number.isFinite(value.fontSize) ? Math.round(Math.max(6, Math.min(300, value.fontSize!)) * 10_000) / 10_000 : base.fontSize,
    bold: typeof value.bold === "boolean" ? value.bold : base.bold, italic: typeof value.italic === "boolean" ? value.italic : base.italic, underline: typeof value.underline === "boolean" ? value.underline : base.underline,
    color: textColor(value.color, base.color), background: value.background === "transparent" ? "transparent" : textColor(value.background, base.background) };
}
export function annotationTextStyle(ann: Annotation): AnnotationTextStyle {
  return normalizeTextStyle({ fontFamily: ann.overlay?.fontFamily, fontSize: ann.overlay?.fontSize, color: ann.color });
}
export function normalizeTextRuns(runs: AnnotationTextRun[], fallback?: AnnotationTextStyle): AnnotationTextRun[] {
  const result: AnnotationTextRun[] = []; let remaining = 100_000;
  for (const run of runs) {
    if (!run || typeof run.text !== "string" || !remaining) continue;
    const text = run.text.slice(0, remaining), style = normalizeTextStyle(run.style ?? {}, fallback); remaining -= text.length;
    if (!text) continue; const previous = result[result.length - 1];
    if (previous && JSON.stringify(previous.style) === JSON.stringify(style)) previous.text += text;
    else result.push({ text, style });
  }
  return result;
}
export function annotationTextRuns(ann: Annotation): AnnotationTextRun[] {
  const fallback = annotationTextStyle(ann), saved = Array.isArray(ann.overlay?.textRuns) ? normalizeTextRuns(ann.overlay!.textRuns!, fallback) : [];
  // Old plugins may update plain text without knowing about runs. Never show stale rich content.
  return saved.map(run => run.text).join("") === ann.text ? saved : normalizeTextRuns([{ text: ann.text, style: fallback }]);
}
export function applyTextStyle(element: HTMLElement, style: AnnotationTextStyle, scale = 1): void {
  Object.assign(element.style, { fontFamily: `"${textFont(style.fontFamily)}", sans-serif`, fontSize: `${style.fontSize * scale}px`, fontWeight: style.bold ? "700" : "400",
    fontStyle: style.italic ? "italic" : "normal", textDecoration: style.underline ? "underline" : "none", color: style.color, backgroundColor: style.background });
  const color = textColor(style.color), rgb = /^#([\da-f]{2})\1\1$/i.exec(color);
  // Keep computed color original: the editor reads it back when saving a draft.
  element.style.webkitTextFillColor = rgb && parseInt(rgb[1], 16) <= 85 && style.background === "transparent"
    ? "var(--ms-reading-neutral-ink, currentcolor)" : "currentcolor";
}
export function renderTextRuns(element: HTMLElement, runs: AnnotationTextRun[], scale = 1): void {
  const fragment = document.createDocumentFragment();
  for (const run of runs) {
    const span = document.createElement("span"); applyTextStyle(span, run.style, scale);
    // MN4 keeps Han glyphs upright inside an italic Extend run. Keep the saved
    // run italic; only its displayed glyphs need a normal face in Chromium.
    if (run.style.italic && element.matches(".ms-extend-text,.ms-extend-text-box-content")) {
      for (const part of run.text.split(/(\p{Script=Han}+)/u)) {
        if (!part) continue;
        if (/^\p{Script=Han}/u.test(part)) {
          const upright = document.createElement("span"); upright.dataset.msUprightHan = "true";
          upright.style.fontStyle = "normal"; upright.textContent = part; span.append(upright);
        } else span.append(document.createTextNode(part));
      }
    } else span.textContent = run.text;
    fragment.append(span);
  }
  element.replaceChildren(fragment);
}
export function sliceTextRuns(runs: AnnotationTextRun[], start: number, end: number): AnnotationTextRun[] {
  const sliced: AnnotationTextRun[] = []; let at = 0;
  for (const run of runs) { const stop = at + run.text.length, text = run.text.slice(Math.max(0, start - at), Math.max(0, Math.min(stop, end) - at)); if (text) sliced.push({ text, style: { ...run.style } }); at = stop; }
  return sliced;
}

/** Only text and known style values cross the persistence boundary, never editor HTML. */
export function readTextRuns(element: HTMLElement, scale: number, fallback: AnnotationTextStyle): AnnotationTextRun[] {
  const runs: AnnotationTextRun[] = [];
  const walk = (node: Node, style: AnnotationTextStyle) => {
    if (node.nodeType === Node.TEXT_NODE) { runs.push({ text: node.textContent ?? "", style }); return; }
    if (!(node instanceof HTMLElement) || /^(SCRIPT|STYLE|IFRAME|OBJECT|IMG)$/.test(node.tagName)) return;
    if (node.tagName === "BR") { runs.push({ text: "\n", style }); return; }
    const css = getComputedStyle(node), next = normalizeTextStyle({ fontFamily: css.fontFamily, fontSize: parseFloat(css.fontSize) / Math.max(.01, scale),
      bold: Number(css.fontWeight) >= 600 || css.fontWeight === "bold", italic: css.fontStyle === "italic", underline: css.textDecorationLine.includes("underline") || style.underline,
      color: css.color, background: css.backgroundColor === "rgba(0, 0, 0, 0)" ? style.background : css.backgroundColor }, fallback);
    // This child changes glyph rendering only, not the editable style identity.
    if (node.dataset.msUprightHan === "true") next.italic = style.italic;
    if (node !== element && /^(DIV|P)$/.test(node.tagName) && runs.length && !runs[runs.length - 1].text.endsWith("\n")) runs.push({ text: "\n", style });
    for (const child of node.childNodes) walk(child, next);
  };
  walk(element, fallback); return normalizeTextRuns(runs, fallback);
}
