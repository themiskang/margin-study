import type { AnnotationTextRun, AnnotationTextStyle, PdfExtendNote } from "../types";
import { normalizeTextRuns, normalizeTextStyle } from "../annot/textRuns";

const base = () => normalizeTextStyle({ fontSize: 16 });
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\*_`[\]]/g, "\\$&");

/** Cards use Markdown; Reader notes keep plain searchable text and bounded style runs. */
export function extendCardText(note: Pick<PdfExtendNote, "text" | "runs">): string {
  const runs = normalizeTextRuns(note.runs ?? []), defaults = base();
  if (runs.map(run => run.text).join("") !== note.text || !runs.some(run => JSON.stringify(run.style) !== JSON.stringify(defaults))) return note.text;
  return runs.map(({ text, style }) => {
    let value = escaped(text);
    if (style.bold && style.italic) value = `***${value}***`;
    else if (style.bold) value = `**${value}**`;
    else if (style.italic) value = `*${value}*`;
    if (style.underline) value = `<u>${value}</u>`;
    const css = [style.fontFamily !== defaults.fontFamily ? `font-family:${style.fontFamily}` : "", style.fontSize !== defaults.fontSize ? `font-size:${style.fontSize}px` : "",
      style.color !== defaults.color ? `color:${style.color}` : "", style.background !== defaults.background ? `background-color:${style.background}` : ""].filter(Boolean).join(";");
    return css ? `<span style="${css}">${value}</span>` : value;
  }).join("");
}

/** Only the inline formats produced by the card editor are interpreted. No HTML is executed. */
export function extendTextFromCard(source: string): Pick<PdfExtendNote, "text" | "runs"> {
  const runs: AnnotationTextRun[] = [];
  const entity = (text: string) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }[name as string] ?? _));
  const append = (text: string, style: AnnotationTextStyle) => { if (text) runs.push({ text: entity(text), style: { ...style } }); };
  const closingTag = (text: string, name: string, start: number) => {
    const tags = /<\/?([a-z]+)(?:\s+[^<>]*)?>/gi; tags.lastIndex = start;
    let depth = 1, match: RegExpExecArray | null;
    while ((match = tags.exec(text))) {
      if (match[1].toLowerCase() !== name) continue;
      depth += match[0][1] === "/" ? -1 : 1;
      if (!depth) return match.index;
    }
    return -1;
  };
  const parse = (text: string, style: AnnotationTextStyle, depth: number) => {
    if (depth > 32) { append(text, style); return; }
    let at = 0, plain = "";
    const flush = () => { append(plain, style); plain = ""; };
    while (at < text.length) {
      if (text[at] === "\\" && /[\\*_`[\]<>]/.test(text[at + 1] ?? "")) { plain += text.slice(at + 1, at + 2); at += 2; continue; }
      const tag = /^<(span\s+style="([^"]*)"|u|b|strong|i|em|mark)>/i.exec(text.slice(at));
      if (tag) {
        const name = tag[1].split(/\s/)[0].toLowerCase(), end = closingTag(text, name, at + tag[0].length);
        if (end >= 0) {
          const next = { ...style };
          if (name === "u") next.underline = true;
          if (name === "b" || name === "strong") next.bold = true;
          if (name === "i" || name === "em") next.italic = true;
          if (name === "mark") next.background = "#ffff00";
          if (name === "span") for (const declaration of tag[2].split(";")) {
            const colon = declaration.indexOf(":"), key = declaration.slice(0, colon).trim().toLowerCase(), value = declaration.slice(colon + 1).trim();
            if (key === "font-family") next.fontFamily = value;
            if (key === "font-size" && /^\d+(?:\.\d+)?px$/.test(value)) next.fontSize = parseFloat(value);
            if (key === "color") next.color = value;
            if (key === "background-color") next.background = value;
          }
          flush(); parse(text.slice(at + tag[0].length, end), normalizeTextStyle(next), depth + 1); at = end + name.length + 3; continue;
        }
      }
      const marker = ["***", "**", "*", "=="].find(value => text.startsWith(value, at));
      if (marker) {
        let end = text.indexOf(marker, at + marker.length);
        while (end >= 0 && text[end - 1] === "\\") end = text.indexOf(marker, end + marker.length);
        if (end > at + marker.length) {
          flush(); parse(text.slice(at + marker.length, end), { ...style, ...(marker === "***" ? { bold: true, italic: true } : marker === "**" ? { bold: true } : marker === "*" ? { italic: true } : { background: "#ffff00" }) }, depth + 1);
          at = end + marker.length; continue;
        }
      }
      plain += text[at++];
    }
    flush();
  };
  parse(source, base(), 0);
  const normalized = normalizeTextRuns(runs);
  return { text: normalized.map(run => run.text).join(""), runs: normalized.some(run => JSON.stringify(run.style) !== JSON.stringify(base())) ? normalized : undefined };
}
