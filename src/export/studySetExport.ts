/**
 * [INPUT]: 读取学习集、复习状态、历史快照与库内关联文件。
 * [OUTPUT]: 提供学习集 ZIP 导出和导出对话框。ZIP 只携带该学习集的数据和模板。
 * [POS]: 在文件落盘前限定主载荷和历史 JSON 的共享范围。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { strToU8, zipSync } from "fflate";
import type MarginStudyPlugin from "../main";
import type { Store } from "../model/store";
import { sha256Hex } from "../utils/sha256";
import { uid } from "../utils/id";
import { createModal } from "../utils/modal";
import { el } from "../utils/dom";
import { readInkCommentToContent } from "../cards/inkPointsMigration";
import { imageUrl } from "../review/content";
import { cardsIncludingMembers } from "../model/reviewPending";
import type { PluginData } from "../types";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const suffix = ".marginstudy-set.zip";

function scopedContent(store: Pick<PluginData, "studySets" | "canvases" | "cards" | "nodes" | "edges" | "srs" | "reviewDecks" | "reviewLogs" | "reviewPending">, studySetId: string) {
  const set = store.studySets?.find(item => item.id === studySetId);
  if (!set) throw new Error("当前没有学习集");
  const canvases = (store.canvases ?? []).filter(canvas => canvas.studySetId === studySetId);
  const canvasIds = new Set(canvases.map(canvas => canvas.id));
  const nodes = store.nodes.filter(node => !!node.canvasId && canvasIds.has(node.canvasId));
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = store.edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const cardIds = new Set([...(set.cardIds ?? []), ...nodes.flatMap(node => node.cardId ? [node.cardId] : [])]);
  for (const card of store.cards) if (set.docPaths.includes(card.docPath) || card.sources?.some(source => set.docPaths.includes(source.docPath))) cardIds.add(card.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const card of store.cards) if (card.groupId && cardIds.has(card.groupId) && !cardIds.has(card.id)) { cardIds.add(card.id); changed = true; }
  }
  const cards = store.cards.filter(card => cardIds.has(card.id));
  const reviewCardIds = new Set(cardsIncludingMembers(cards).map(card => card.id));
  const reviewDecks = (store.reviewDecks ?? []).filter(deck =>
    (!deck.legacyScopeId || canvasIds.has(deck.legacyScopeId)) &&
    (deck.id === set.reviewDeckId || deck.studySetIds.includes(studySetId) || !!deck.legacyScopeId && canvasIds.has(deck.legacyScopeId))
  ).map(deck => ({ ...deck, studySetIds: deck.studySetIds.filter(id => id === studySetId), cardIds: deck.cardIds.filter(id => reviewCardIds.has(id)) }));
  const deckIds = new Set(reviewDecks.map(deck => deck.id));
  const scopedQuestion = (id: string): boolean => {
    const [cardId, scope = ""] = id.split("::");
    if (!reviewCardIds.has(cardId)) return false;
    if (scope.startsWith("merged:")) return scopedQuestion(id.slice(cardId.length + "::merged:".length));
    if (scope.startsWith("scope:")) return canvasIds.has(scope.slice("scope:".length));
    if (scope.startsWith("deck:")) return deckIds.has(scope.slice("deck:".length));
    return true;
  };
  const scopedReview = (row: { cardId: string; questionId: string; scopeId?: string; deckId?: string }) =>
    reviewCardIds.has(row.cardId) && typeof row.questionId === "string" && row.questionId.split("::")[0] === row.cardId &&
    scopedQuestion(row.questionId) && (!row.scopeId || canvasIds.has(row.scopeId)) && (!row.deckId || deckIds.has(row.deckId));
  const srs = Object.fromEntries(Object.entries(store.srs).filter(([id]) => scopedQuestion(id)));
  const reviewLogs = (store.reviewLogs ?? []).filter(scopedReview);
  const reviewPending = (store.reviewPending ?? []).filter(scopedReview);
  return { set, canvases, nodes, edges, cards, reviewDecks, srs, reviewLogs, reviewPending };
}

function studySetPayload(store: Parameters<typeof scopedContent>[0], studySetId: string) {
  const { set, ...content } = scopedContent(store, studySetId);
  return { ...content, studySets: [set] };
}

export function hasStudySetContent(store: Store, studySetId = store.activeStudySetId): boolean {
  if (!studySetId || !store.studySets.some(set => set.id === studySetId)) return false;
  const content = scopedContent(store, studySetId);
  return !!(content.set.docPaths.length || Object.values(content.set.documentAttachments ?? {}).some(paths => paths.length) || content.cards.length || content.nodes.length || content.canvases.some(canvas => canvas.handwriting?.layers.some(layer => layer.strokes.length)));
}

function safePath(value: string): string {
  if (!value || value.startsWith("/") || value.includes("\\") || /^[A-Za-z]:/.test(value) || /[\u0000-\u001f]/.test(value) || value.split("/").some(part => !part || part === "." || part === ".." || part === ".obsidian")) throw new Error("无效的来源路径：" + value);
  return value;
}

function collectResources(value: unknown, resources: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/_marginstudy-(?:media|audio|imports)\/[^\s"'<>()[\]{}]+/g)) resources.add(safePath(match[0]));
  } else if (Array.isArray(value)) for (const item of value) collectResources(item, resources);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectResources(item, resources);
}

function collectImportedDocuments(value: unknown, paths: Set<string>): void {
  if (Array.isArray(value)) for (const item of value) collectImportedDocuments(item, paths);
  else if (value && typeof value === "object") {
    const object = value as Record<string, unknown>, imported = object.imported as { path?: unknown } | undefined;
    if (imported && typeof imported.path === "string") paths.add(safePath(imported.path));
    for (const item of Object.values(object)) collectImportedDocuments(item, paths);
  }
}

async function buildStudySetArchive(plugin: MarginStudyPlugin, studySetId: string, includePdf: boolean, history: "none" | "recent" | "all"): Promise<{ bytes: Uint8Array; name: string }> {
  const store = plugin.store;
  if (!hasStudySetContent(store, studySetId)) throw new Error("空学习集不能导出");
  const selected = clone(studySetPayload(store, studySetId));
  const migrateCards = async (cards: typeof selected.cards) => {
    for (const card of cards) if (card.commentMedia) card.commentMedia = await Promise.all(card.commentMedia.map(item => readInkCommentToContent(item, async source => {
      const image = new Image(); image.src = imageUrl(plugin, source); await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    })));
  };
  const documentPaths = new Set<string>();
  const addDocument = (path?: string) => { if (path) documentPaths.add(safePath(path)); };
  for (const path of selected.studySets[0].docPaths) addDocument(path);
  for (const [path, attachments] of Object.entries(selected.studySets[0].documentAttachments ?? {})) { addDocument(path); for (const attachment of attachments) addDocument(attachment); }
  for (const card of cardsIncludingMembers(selected.cards)) {
    addDocument(card.docPath);
    for (const source of card.sources ?? []) addDocument(source.docPath);
    for (const block of card.excerptBlocks ?? []) addDocument(block.source?.docPath);
  }
  for (const node of selected.nodes) addDocument(node.docPath);
  const documents: typeof store.documents = [], docMeta: typeof store.docMeta = {}, annotations: Record<string, unknown> = {};
  const files: Record<string, Uint8Array> = Object.create(null), resources = new Set<string>();
  if (history !== "none") {
    const entries = store.getStudySetHistory(studySetId);
    const selectedHistory = history === "recent" ? entries.slice(-5) : entries;
    for (const [index, entry] of selectedHistory.entries()) {
      const content = clone(scopedContent(entry.data, studySetId));
      await migrateCards(content.cards);
      const paths = new Set(content.set.docPaths);
      const annotations = entry.annotations.filter(([path]) => paths.has(path));
      files[`history/${String(index + 1).padStart(3, "0")}.json`] = strToU8(JSON.stringify({ label: entry.label, ...content, annotations }, null, 2));
    }
  }
  const adapter = plugin.app.vault.adapter;
  for (const path of documentPaths) {
    if (!includePdf && /\.pdf$/i.test(path)) {
      const record = store.documents.find(document => document.path === path); if (record) documents.push(clone(record));
      if (store.docMeta[path]) { docMeta[path] = clone(store.docMeta[path]); collectImportedDocuments(docMeta[path], documentPaths); }
      annotations[path] = clone(await store.loadAnnotations(path));
      continue;
    }
    let bytes: ArrayBuffer;
    try { bytes = await adapter.readBinary(path); } catch { throw new Error("来源文档不存在或无法读取：" + path); }
    files["documents/" + path] = new Uint8Array(bytes);
    const record = store.documents.find(document => document.path === path); if (record) documents.push(clone(record));
    if (store.docMeta[path]) { docMeta[path] = clone(store.docMeta[path]); collectImportedDocuments(docMeta[path], documentPaths); }
    annotations[path] = clone(await store.loadAnnotations(path));
    if (/\.msref$/i.test(path)) {
      let collection: any;
      try { collection = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("重组文档清单无法读取：" + path); }
      if (collection?.format !== "marginstudy-page-collection" || !Array.isArray(collection.pages) || collection.pages.some((page: any) => typeof page?.sourcePath !== "string")) throw new Error("重组文档清单无效：" + path);
      for (const page of collection.pages) addDocument(page.sourcePath);
    }
  }
  const sceneId = selected.studySets[0].scene?.templateId;
  const cardTemplateIds = new Set(cardsIncludingMembers(selected.cards).flatMap(card => card.templateId ? [card.templateId] : []));
  const payload = { format: "marginstudy-study-set", version: 1, ...selected, documents, docMeta, annotations,
    cardTemplates: clone(store.cardTemplates.filter(template => cardTemplateIds.has(template.id))),
    sceneTemplates: clone(store.getSceneTemplates().filter(template => template.id === sceneId)) };
  if ("settings" in payload) throw new Error("学习集包不能包含全局设置");
  collectResources(payload, resources);
  for (const path of resources) {
    if (!includePdf && /\.pdf$/i.test(path)) continue;
    try { files[path] = new Uint8Array(await adapter.readBinary(path)); }
    catch { throw new Error("关联资源不存在或无法读取：" + path); }
  }
  if (JSON.stringify(selected) !== JSON.stringify(studySetPayload(store, studySetId))) throw new Error("打包期间学习集发生变化，请重试导出");
  for (const path of documentPaths) {
    if (JSON.stringify(docMeta[path] ?? null) !== JSON.stringify(store.docMeta[path] ?? null) || JSON.stringify(annotations[path]) !== JSON.stringify(await store.loadAnnotations(path))) throw new Error("打包期间文档批注或设置发生变化，请重试导出：" + path);
  }
  await migrateCards(selected.cards);
  files["studyset.json"] = strToU8(JSON.stringify(payload, null, 2));
  const manifest = { format: "marginstudy-study-set-manifest", version: 1, pointsVersion: 2, createdAt: new Date().toISOString(), studySetId,
    files: Object.entries(files).sort(([left], [right]) => left.localeCompare(right)).map(([path, bytes]) => ({ path, bytes: bytes.byteLength, sha256: sha256Hex(bytes) })) };
  files["MANIFEST.json"] = strToU8(JSON.stringify(manifest, null, 2));
  return { bytes: zipSync(files, { level: 6 }), name: selected.studySets[0].name };
}

export async function exportStudySet(plugin: MarginStudyPlugin, options: { includePdf?: boolean; history?: "none" | "recent" | "all" } = {}): Promise<string | null> {
  const id = plugin.store.activeStudySetId;
  if (!id || !hasStudySetContent(plugin.store, id)) throw new Error("空学习集不能导出");
  const { bytes, name } = await buildStudySetArchive(plugin, id, options.includePdf !== false, options.history ?? "recent");
  const require = (window as any).require;
  let dialog: any;
  if (typeof require === "function") { try { dialog = require("@electron/remote")?.dialog; } catch {} if (!dialog) try { dialog = require("electron")?.remote?.dialog; } catch {} }
  if (!dialog?.showSaveDialog) throw new Error("当前设备不支持系统保存对话框，请使用桌面版导出");
  const filename = (name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/, "") || "学习集") + suffix;
  const result = await dialog.showSaveDialog({ title: "导出学习集", defaultPath: filename, filters: [{ name: "MarginStudy 学习集 ZIP", extensions: ["zip"] }], properties: ["createDirectory", "showOverwriteConfirmation"] });
  if (result.canceled || !result.filePath) return null;
  const target = result.filePath.toLowerCase().endsWith(suffix) ? result.filePath : result.filePath.replace(/\.zip$/i, "") + suffix;
  const fs = require("fs").promises, path = require("path"), temporary = path.join(path.dirname(target), ".marginstudy-export-" + uid("zip") + ".tmp");
  let staged = false;
  try {
    await fs.writeFile(temporary, bytes, { flag: "wx" });
    staged = true;
    await fs.link(temporary, target);
  } catch (error: any) {
    if (error?.code === "EEXIST") throw new Error("目标文件已存在，请选择新文件名");
    throw error;
  } finally { if (staged) await fs.unlink(temporary).catch(() => {}); }
  plugin.store.recordReadOnlyLibraryAction("导出学习集");
  return target;
}

export function openStudySetExport(plugin: MarginStudyPlugin, options: { includePdf?: boolean } = {}, onComplete?: (path: string) => void): void {
  const { modal, close } = createModal("导出学习集");
  const label = el("label"), checkbox = el("input", { type: "checkbox", "aria-label": "历史版本" });
  checkbox.checked = true; label.append(checkbox, document.createTextNode("历史版本"));
  const select = el("select", { "aria-label": "历史版本范围" });
  select.append(el("option", { value: "recent", text: "最近 5 个" }), el("option", { value: "all", text: "全部版本" }));
  checkbox.addEventListener("change", () => { select.disabled = !checkbox.checked; });
  const cancel = el("button", { type: "button", text: "取消" }); cancel.addEventListener("click", close);
  const confirm = el("button", { type: "button", text: "导出" });
  confirm.addEventListener("click", () => { close(); void exportStudySet(plugin, { ...options, history: checkbox.checked ? select.value as "recent" | "all" : "none" }).then(path => { if (path) onComplete?.(path); }).catch(error => { void import("obsidian").then(({ Notice }) => new Notice("导出学习集失败：" + String(error), 10000)); }); });
  modal.append(label, select, cancel, confirm);
}
