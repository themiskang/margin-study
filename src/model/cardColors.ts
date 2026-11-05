export const CARD_COLORS = ["#FFFFAA", "#BEFFBE", "#ADD2FF", "#FFAABE", "#FFFF00", "#00FF00", "#00BEFF", "#FF0000", "#FF8000", "#008040", "#003EB3", "#CF1B11", "#FFFFFF", "#DADADA", "#B4B4B4", "#C39DE0"];

export function cardColorIndex(color?: string): number | undefined {
  const index = CARD_COLORS.findIndex(item => item.toLowerCase() === color?.toLowerCase());
  return index < 0 ? undefined : index;
}

export function syncCardColor<T extends { color?: string; colorIndex?: number }>(value: T): T {
  if ("color" in value) return { ...value, colorIndex: cardColorIndex(value.color) };
  if ("colorIndex" in value) return { ...value, color: value.colorIndex === undefined ? undefined : CARD_COLORS[value.colorIndex] };
  return value;
}
