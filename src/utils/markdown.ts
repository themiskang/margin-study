import { MarkdownRenderer, Component, App } from "obsidian";

/** 用 Obsidian 原生渲染器把 Markdown 渲染进 el（支持标题/列表/加粗/代码/公式） */
export async function renderMarkdown(app: App, md: string, el: HTMLElement, sourcePath = ""): Promise<void> {
  el.empty();
  await MarkdownRenderer.render(app, md ?? "", el, sourcePath, new Component());
  // 让内部链接等在新窗口打开，避免跳走
  el.querySelectorAll("a.internal-link").forEach((a) => {
    (a as HTMLElement).setAttribute("target", "_blank");
  });
}

/** Plain {{answer}} shares question 0; explicit cN questions stay independent. */
export interface ClozeToken {
  type: "text" | "cloze";
  text: string;
  index?: number;
  hint?: string;
}
export function parseCloze(src: string): ClozeToken[] {
  const tokens: ClozeToken[] = [];
  const re = /\{\{/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const numbered = /^c([1-9]\d*)::/.exec(src.slice(re.lastIndex));
    const start = re.lastIndex + (numbered?.[0].length ?? 0);
    let end = start;
    let braces = 0;
    let divider = -1;
    for (; end < src.length; end++) {
      if (braces === 0 && src.slice(end, end + 2) === "}}") break;
      if (numbered && braces === 0 && divider < 0 && src.slice(end, end + 2) === "::") divider = end;
      if (src[end] === "{") braces++;
      else if (src[end] === "}" && braces > 0) braces--;
    }
    if (end >= src.length) break;
    // Invalid numbered syntax is ordinary text, never silently question 0.
    if ((!numbered && /^c(?:\d*|-\d+)::/.test(src.slice(re.lastIndex))) || end === start) {
      re.lastIndex = end + 2;
      continue;
    }
    if (m.index > last) tokens.push({ type: "text", text: src.slice(last, m.index) });
    tokens.push({ type: "cloze", text: src.slice(start, divider < 0 ? end : divider),
      hint: divider < 0 ? undefined : src.slice(divider + 2, end), index: numbered ? parseInt(numbered[1], 10) : 0 });
    re.lastIndex = end + 2;
    last = re.lastIndex;
  }
  if (last < src.length) tokens.push({ type: "text", text: src.slice(last) });
  return tokens;
}
export function hasCloze(src: string): boolean {
  return parseCloze(src).some((token) => token.type === "cloze");
}
/** 取填空提示（隐藏答案，显示 [..n..]） */
export function clozeHint(src: string): string {
  return parseCloze(src).map((token) => token.type === "text" ? token.text : `[${token.hint || `••${token.index}••`}]`).join("");
}

/** Only the chosen question is hidden; other answers remain as context. */
export function clozeForQuestion(src: string, index: number, revealed = false): string {
  return parseCloze(src).map((token) => token.type === "text" || revealed || token.index !== index
    ? token.text : `[${token.hint || "•••"}]`).join("");
}

export function clozeIndices(...sources: string[]): number[] {
  return [...new Set(sources.flatMap((src) => parseCloze(src)
    .filter((token) => token.type === "cloze").map((token) => token.index!)))].sort((a, b) => a - b);
}

/** Export conversion does not mutate the stored text. */
export function clozeForExport(src: string): string {
  return parseCloze(src).map(token => token.type === "text" ? token.text
    : /^\*\*[\s\S]*\*\*$/.test(token.text) ? token.text : `**${token.text}**`).join("");
}

/** A saved plain cloze is edited as one range operation, never a view reveal. */
export function togglePlainCloze(src: string, start: number, end: number): string {
  const cutsPair = (index: number) => index > 0 && index < src.length && /[\uD800-\uDBFF]/.test(src[index-1]) && /[\uDC00-\uDFFF]/.test(src[index]);
  if (![start,end].every(Number.isInteger) || start < 0 || end > src.length || start >= end || cutsPair(start) || cutsPair(end)) throw new Error("请选择完整的文本范围");
  let selected = src.slice(start,end);
  if (!selected.trim()) throw new Error("空白不能用作挖空答案");
  if (selected.startsWith("{{") && selected.endsWith("}}") && !/^\{\{c[1-9]\d*::/.test(selected)) selected = selected.slice(2,-2);
  else if (src.slice(start-2,start) === "{{" && src.slice(end,end+2) === "}}") { start -= 2; end += 2; }
  else {
    const before = src.slice(0,start);
    if (selected.includes("{{") || selected.includes("}}") || before.lastIndexOf("{{") > before.lastIndexOf("}}")) throw new Error("请先选择完整挖空，避免嵌套或切断标记");
    selected = "{{"+selected+"}}";
  }
  return src.slice(0,start)+selected+src.slice(end);
}
