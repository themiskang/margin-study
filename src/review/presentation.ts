import type { Card } from "../types";

export interface ReviewMaterial { front: string; back: string; showImages: boolean; configured: boolean; }
const uniqueText = (parts: (string | undefined)[]): string => [...new Set(parts.filter((text): text is string => !!text?.trim()))].join("\n\n");

/** These are display projections; the underlying note/excerpt is never rewritten. */
export function reviewMaterial(card: Card): ReviewMaterial {
  const setting = card.reviewQuestion;
  const back=card.extendText?.some(item=>item.text.trim()) ? [card.back,...card.extendText.map(item=>item.text)].filter(Boolean).join("\n\n") : card.back??"";
  if (!setting) return { front: card.front, back, showImages: true, configured: false };
  const whole = uniqueText([card.title, card.front, back]);
  const fallback = card.title?.trim() || card.front.split(/\n\s*\n/)[0] || card.back?.split(/\n\s*\n/)[0] || "";
  let front: string;
  if (setting.mode === "custom") front = setting.text ?? "";
  else if (setting.mode === "whole") front = whole;
  else if (setting.mode === "emphasis") {
    const blocks = uniqueText([card.front, back]).replace(/```[\s\S]*?```/g, "").split(/\n\s*\n/);
    front = blocks.filter(block => /\{\{|\*\*|__|==/.test(block.replace(/`[^`]*`/g, ""))).join("\n\n") || fallback;
  } else front = fallback;
  return { front, back: whole, showImages: setting.includeImages ?? setting.mode === "whole", configured: true };
}
