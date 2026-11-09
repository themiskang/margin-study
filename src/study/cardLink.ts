import { Notice } from "obsidian";
import type MarginStudyPlugin from "../main";
import { openDetail } from "../cards/cardView";

export function cardUrl(vault: string, cardId: string): string {
  const params = new URLSearchParams({ vault, msvault: vault, card: cardId });
  return `obsidian://margin-study-card?${params.toString()}`;
}

export function parseCardUrl(value: string): { vault: string; card: string } | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "obsidian:" || url.hostname !== "margin-study-card" || (url.pathname && url.pathname !== "/")) return;
    const vault = url.searchParams.get("msvault"), card = url.searchParams.get("card");
    if (!vault || !card || url.searchParams.getAll("msvault").length !== 1 || url.searchParams.getAll("card").length !== 1) return;
    return { vault, card };
  } catch { return; }
}

export function bindInlineCardLinks(plugin: MarginStudyPlugin, root: HTMLElement): void {
  root.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!target || !root.contains(target)) return;
    const params = parseCardUrl(target.getAttribute("href") ?? "");
    if (!params) return;
    event.preventDefault(); event.stopPropagation(); openCardLink(plugin, params);
  }, true);
}

/** Resolve only inside the vault that issued the link and look up the live card. */
export function openCardLink(plugin: MarginStudyPlugin, params: { vault?: string; card?: string }): void {
  if (!params.vault || params.vault !== plugin.app.vault.getName() || !params.card) {
    new Notice("卡片链接不完整或属于其他资料库"); return;
  }
  const card = plugin.store.getCard(params.card);
  if (!card) { new Notice("卡片不存在或已删除"); return; }
  openDetail(plugin, card);
}
