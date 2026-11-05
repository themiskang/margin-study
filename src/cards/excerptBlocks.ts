import type { Card, ExcerptBlock } from "../types";
import { clozeHint, hasCloze, parseCloze } from "../utils/markdown";

export function displayedExcerptBlocks(card: Card): ExcerptBlock[] {
  const blocks = card.excerptBlocks ?? [];
  if (!hasCloze(card.front)) return blocks;
  const spans: { start: number; end: number; hint: string }[] = [];
  let offset = 0;
  for (const token of parseCloze(card.front)) {
    if (token.type === "text") { offset += token.text.length; continue; }
    const length = 4 + token.text.length + (token.index ? `c${token.index}::`.length : 0) + (token.hint === undefined ? 0 : 2 + token.hint.length);
    spans.push({ start: offset, end: offset + length, hint: clozeHint(card.front.slice(offset, offset + length)) });
    offset += length;
  }
  let cursor = 0;
  const ranges = blocks.map(block => {
    if (!block.text) return undefined;
    const start = card.front.indexOf(block.text, cursor);
    if (start < 0) return undefined;
    cursor = start + block.text.length;
    return { start, end: cursor };
  });
  if (blocks.some((block, index) => block.text && !ranges[index])) {
    let placed = false;
    return blocks.map(block => {
      if (!block.text) return block;
      const text = placed ? "" : clozeHint(card.front);
      placed = true;
      return { ...block, text };
    });
  }
  const inserted = new Set<number>();
  return blocks.map((block, index) => {
    const range = ranges[index];
    if (!range) return block;
    let text = "", position = range.start;
    for (const [spanIndex, span] of spans.entries()) {
      if (span.end <= range.start || span.start >= range.end) continue;
      text += card.front.slice(position, Math.max(position, span.start));
      if (!inserted.has(spanIndex)) { text += span.hint; inserted.add(spanIndex); }
      position = Math.min(range.end, span.end);
    }
    return { ...block, text: text + card.front.slice(position, range.end) };
  });
}

export function editedExcerptBlocks(card: Card, front: string): ExcerptBlock[] | undefined {
  const blocks = card.excerptBlocks;
  if (!blocks?.length || front === card.front) return blocks;
  const positions: { index: number; start: number; end: number }[] = [];
  let cursor = 0;
  for (const [index, block] of blocks.entries()) {
    if (!block.text) continue;
    const start = card.front.indexOf(block.text, cursor);
    if (start < 0) return anchoredBlocks(blocks, front);
    positions.push({ index, start, end: start + block.text.length });
    cursor = start + block.text.length;
  }
  let start = 0;
  while (start < card.front.length && start < front.length && card.front[start] === front[start]) start++;
  let oldEnd = card.front.length, newEnd = front.length;
  while (oldEnd > start && newEnd > start && card.front[oldEnd - 1] === front[newEnd - 1]) { oldEnd--; newEnd--; }
  const position = positions.find(item => start >= item.start && oldEnd <= item.end);
  if (!position) {
    const left = positions.find(item => item.start < start && start <= item.end);
    const right = positions.find(item => item.start <= oldEnd && oldEnd < item.end);
    if (left && right && left.index < right.index) {
      const replacement = front.slice(start, newEnd);
      return blocks.flatMap((block, index) => {
        if (!block.text || index < left.index || index > right.index) return [block];
        const text = index === left.index ? block.text.slice(0, start - left.start) + replacement
          : index === right.index ? block.text.slice(oldEnd - right.start) : "";
        return text ? [{ ...block, text, ...(text !== block.text ? { sourceText: block.sourceText ?? block.text } : {}) }] : [];
      });
    }
    if (positions.length < 2 || positions[0].start !== 0 || positions[positions.length - 1].end !== card.front.length) return anchoredBlocks(blocks, front);
    const separators = positions.slice(1).map((item, index) => card.front.slice(positions[index].end, item.start));
    if (separators.some(separator => !separator || separator !== separators[0])) return anchoredBlocks(blocks, front);
    const parts = front.split(separators[0]);
    if (parts.length !== positions.length || parts.some(part => !part)) return anchoredBlocks(blocks, front);
    return blocks.map((block, index) => {
      const part = positions.findIndex(item => item.index === index);
      return part < 0 || block.text === parts[part] ? block : { ...block, sourceText: block.sourceText ?? block.text, text: parts[part] };
    });
  }
  const text = blocks[position.index].text!;
  return blocks.map((block, index) => index === position.index
    ? { ...block, sourceText: block.sourceText ?? block.text, text: text.slice(0, start - position.start) + front.slice(start, newEnd) + text.slice(oldEnd - position.start) }
    : block);
}

function anchoredBlocks(blocks: ExcerptBlock[], front: string): ExcerptBlock[] {
  const anchors: { index: number; start: number; end: number }[] = [];
  let cursor = 0;
  for (const [index, block] of blocks.entries()) {
    if (!block.text) continue;
    const start = front.indexOf(block.text, cursor);
    if (start < 0) continue;
    anchors.push({ index, start, end: start + block.text.length });
    cursor = start + block.text.length;
  }
  if (!anchors.length) {
    const first = blocks.find(block => block.text);
    const replacement = first && front ? { id: first.id, text: front } : undefined;
    let inserted = false;
    return blocks.flatMap(block => {
      if (!block.text) return [block];
      if (!inserted && replacement) { inserted = true; return [replacement]; }
      return [];
    });
  }
  return blocks.flatMap((block, index) => {
    if (!block.text) return [block];
    const anchorIndex = anchors.findIndex(anchor => anchor.index === index);
    if (anchorIndex < 0) return [];
    const anchor = anchors[anchorIndex];
    const start = anchorIndex === 0 ? 0 : anchor.start;
    const end = anchorIndex + 1 === anchors.length ? front.length : anchors[anchorIndex + 1].start;
    const text = front.slice(start, end);
    return [{ ...block, text, ...(text !== block.text ? { sourceText: block.sourceText ?? block.text } : {}) }];
  });
}
