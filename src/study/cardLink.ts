import { Notice } from "obsidian";
import type MarginStudyPlugin from "../main";
import { openDetail } from "../cards/cardView";

export function cardUrl(vault: string, cardId: string): string {
  const params = new URLSearchParams({ vault, msvault: vault, card: cardId });
  return `obsidian://margin-study-card?${params.toString()}`;
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
