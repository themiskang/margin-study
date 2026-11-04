import type { Card, MarginStudySettings } from "../types";

/** Display defaults never rewrite card text or a card's explicit formatting. */
export function applyCardTypography(target:HTMLElement,settings:MarginStudySettings,card?:Card,title=false):void {
  const font=card?.typography?.fontFamily??settings.cardFontFamily,size=card?.typography?.fontSize??settings.cardBaseFontSize;
  if(font&&["Helvetica","Georgia","Courier New"].includes(font))target.style.fontFamily=font;
  if(size&&Number.isFinite(size))target.style.fontSize=`${Math.max(12,Math.min(32,size))}px`;
  if(title)target.style.textTransform=settings.cardTitleUppercase?"uppercase":"none";
}
