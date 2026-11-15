import type MarginStudyPlugin from "../main";

export async function exportStudySetToNotes(plugin: MarginStudyPlugin): Promise<string> {
  const store = plugin.store, set = store.studySets.find(item => item.id === store.activeStudySetId);
  if (!set) throw new Error("请先选择学习集");
  const cards = store.cardsForStudySet();
  const clean = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
  const lines = [`# ${clean(set.name) || "学习集"}`, ""];
  for (const card of cards) {
    lines.push(`## ${clean(card.title || card.front || "无标题").slice(0, 120)}`, "");
    if (card.front) lines.push(card.front, "");
    if (card.back) lines.push(card.back, "");
    if (card.docPath) lines.push(`来源：[[${card.docPath.replace(/[\[\]|]/g, "")}]]`, "");
  }
  const base = (set.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/, "") || "学习集") + " - 学习笔记";
  let path = `${base}.md`, index = 2;
  while (plugin.app.vault.getAbstractFileByPath(path) || await plugin.app.vault.adapter.exists(path)) path = `${base} (${index++}).md`;
  await plugin.app.vault.create(path, lines.join("\n"));
  return path;
}
