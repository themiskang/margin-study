import { Notice, TFile } from "obsidian";
import { createModal } from "../utils/modal";
import { el } from "../utils/dom";
import { strFromU8, unzipSync } from "fflate";
import type MarginStudyPlugin from "../main";
import { repairDuplicateIds } from "../model/duplicateIds";
import { uid } from "../utils/id";

export interface StudySetImportSummary {
  studySetId: string;
  studySetName: string;
  cards: number;
  nodes: number;
  edges: number;
  documents: number;
  duplicateGroups: number;
  droppedDuplicates: number;
  renamedDocuments: number;
  pageCollectionRefs: number;
  annotations: number;
  docMeta: number;
  cardTemplates: number;
  sceneTemplates: number;
  skippedSceneTemplates: number;
  reviewDecks: number;
  reviewLogs: number;
  reviewStates: number;
}

export interface StudySetImportOptions {
  /** merge：并入现有学习集；new：新建学习集（默认）。 */
  mode?: "new" | "merge";
  studySetId?: string;
  name?: string;
}

const HEX = /^[0-9a-f]{64}$/;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

/** 校验并解析 `.marginstudy-set.zip`：清单逐文件字节与 SHA-256 必须与内容一致。 */
export async function readStudySetPackage(bytes: ArrayBuffer): Promise<{ payload: any; files: Map<string, Uint8Array>; repaired: number; duplicated: number }> {
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(new Uint8Array(bytes)); }
  catch { throw new Error("不是有效的 ZIP 文件"); }
  const manifestBytes = entries["MANIFEST.json"]; if (!manifestBytes) throw new Error("缺少 MANIFEST.json");
  let manifest: any;
  try { manifest = JSON.parse(strFromU8(manifestBytes)); } catch { throw new Error("MANIFEST.json 无法解析"); }
  if (manifest?.format !== "marginstudy-study-set-manifest" || manifest?.version !== 1) throw new Error("不支持的清单格式或版本");
  if (!Array.isArray(manifest.files)) throw new Error("清单缺少文件列表");
  for (const item of manifest.files) {
    const path = typeof item?.path === "string" ? item.path : "";
    const payload = entries[path];
    if (!path || path.includes("..") || path.startsWith("/") || !payload) throw new Error("清单条目缺失或路径无效：" + path);
    if (payload.byteLength !== item.bytes) throw new Error("清单字节数不一致：" + path);
    if (!HEX.test(String(item.sha256)) || await sha256Hex(payload) !== item.sha256) throw new Error("清单 SHA-256 不一致：" + path);
  }
  const payloadFile = entries["studyset.json"]; if (!payloadFile) throw new Error("缺少 studyset.json");
  let payload: any;
  try { payload = JSON.parse(strFromU8(payloadFile)); } catch { throw new Error("studyset.json 无法解析"); }
  if (payload?.format !== "marginstudy-study-set" || payload.version !== 1) throw new Error("不支持的学习集包格式或版本");
  for (const key of ["cards", "nodes", "edges", "studySets", "canvases"]) if (!Array.isArray(payload[key])) throw new Error("studyset.json 缺少 " + key);
  const before = ["cards", "nodes", "edges", "studySets", "canvases", "reviewDecks"].reduce((sum, key) => sum + (Array.isArray(payload[key]) ? payload[key].length : 0), 0);
  const { data, repaired } = repairDuplicateIds(payload);
  const after = ["cards", "nodes", "edges", "studySets", "canvases", "reviewDecks"].reduce((sum, key) => sum + (Array.isArray(data[key]) ? data[key].length : 0), 0);
  const files = new Map<string, Uint8Array>();
  for (const [path, value] of Object.entries(entries)) {
    if (path === "MANIFEST.json" || path === "studyset.json") continue;
    if (!path.startsWith("documents/") && !path.startsWith("_marginstudy-media/") && !path.startsWith("_marginstudy-audio/") && !path.startsWith("_marginstudy-imports/")) continue;
    files.set(path, value);
  }
  return { payload: data, files, repaired: repaired.length, duplicated: before - after };
}

/** 把学习集包写入当前库：文档落盘（同名自动重命名）、实体换新 ID 后并入或新建学习集。 */
export async function importStudySetPackage(plugin: MarginStudyPlugin, bytes: ArrayBuffer, options: StudySetImportOptions = {}): Promise<StudySetImportSummary> {
  const { payload, files, repaired, duplicated } = await readStudySetPackage(bytes);
  const store = plugin.store, vault = plugin.app.vault;
  const mode = options.mode ?? "new";
  if (mode === "merge" && !store.studySets.some(set => set.id === options.studySetId)) throw new Error("目标学习集不存在，无法并入");
  const createdFiles: TFile[] = [];
  let libraryChanged = false;
  const pathMap = new Map<string, string>();
  const collections: Array<{ file: TFile; content: Uint8Array }> = [];
  let renamedDocuments = 0;
  try {
    for (const [entryPath, content] of files) {
      const relative = entryPath.startsWith("documents/") ? entryPath.slice("documents/".length) : entryPath;
      if (!relative || relative.includes("..")) throw new Error("包内路径无效：" + entryPath);
      let target = relative, suffix = 2;
      while (vault.getAbstractFileByPath(target) || await vault.adapter.exists(target) || await vault.adapter.exists(store.sidecarPath(target))) {
        const dot = relative.lastIndexOf("."), stem = dot > 0 ? relative.slice(0, dot) : relative, ext = dot > 0 ? relative.slice(dot) : "";
        target = `${stem} (${suffix++})${ext}`; renamedDocuments++;
      }
      const file = await vault.createBinary(target, content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer);
      createdFiles.push(file); pathMap.set(relative, target);
      if (entryPath.startsWith("documents/") && /\.msref$/i.test(relative)) collections.push({ file, content });
    }
    let pageCollectionRefs = 0;
    for (const { file, content } of collections) {
      let collection: any;
      try { collection = JSON.parse(strFromU8(content)); } catch { continue; }
      if (collection?.format !== "marginstudy-page-collection" || !Array.isArray(collection.pages)) continue;
      let changed = false;
      for (const page of collection.pages) {
        if (typeof page?.sourcePath !== "string") continue;
        const mapped = pathMap.get(page.sourcePath);
        if (mapped && mapped !== page.sourcePath) {
          page.sourcePath = mapped;
          pageCollectionRefs++;
          changed = true;
        }
      }
      if (changed) {
        const encoded = new TextEncoder().encode(JSON.stringify(collection));
        await vault.modifyBinary(file, encoded.buffer as ArrayBuffer);
      }
    }
    const cardIds = new Map<string, string>(), nodeIds = new Map<string, string>(), canvasIds = new Map<string, string>();
    const fresh = (map: Map<string, string>, id: string) => { const next = map.get(id) ?? uid("import"); map.set(id, next); return next; };
    const documentPath = (path: string) => pathMap.get(path) ?? path;
    // Pre-map identities so cross references only point at objects that really come with the package.
    const importedCards = new Set((payload.cards as any[]).map(card => card.id));
    const importedNodes = new Set((payload.nodes as any[]).map(node => node.id));
    for (const card of payload.cards as any[]) fresh(cardIds, card.id);
    for (const node of payload.nodes as any[]) fresh(nodeIds, node.id);
    const summary = store.libraryTransaction("导入学习集", () => {
      const setName = options.name?.trim() || payload.studySets[0]?.name?.trim() || "导入的学习集";
      const target = mode === "merge" && options.studySetId ? store.studySets.find(set => set.id === options.studySetId) : undefined;
      const set = target ?? store.createStudySet(setName, []);
      store.setActiveStudySet(set.id);
      const canvases = (payload.canvases as any[]).length ? (payload.canvases as any[]) : [{ id: "default", name: "主脑图" }];
      for (const canvas of canvases) {
        const created = store.createCanvas(set.id, canvas.name ?? "主脑图");
        canvasIds.set(canvas.id, created.id);
      }
      for (const card of payload.cards as any[]) {
        const id = cardIds.get(card.id)!;
        store.addCard({ ...card, id, links: (card.links ?? []).filter((link: string) => importedCards.has(link)).map((link: string) => cardIds.get(link)!), docPath: documentPath(card.docPath ?? ""), sources: card.sources?.map((source: any) => ({ ...source, docPath: documentPath(source.docPath) })) });
      }
      for (const node of payload.nodes as any[]) {
        const id = nodeIds.get(node.id)!;
        store.addNode({ ...node, id, cardId: node.cardId && importedCards.has(node.cardId) ? cardIds.get(node.cardId) : undefined, parentId: node.parentId && importedNodes.has(node.parentId) ? nodeIds.get(node.parentId)! : null, canvasId: canvasIds.get(node.canvasId) ?? [...canvasIds.values()][0], docPath: node.docPath ? documentPath(node.docPath) : undefined });
      }
      for (const edge of payload.edges as any[]) if (importedNodes.has(edge.from) && importedNodes.has(edge.to)) store.addEdge(nodeIds.get(edge.from)!, nodeIds.get(edge.to)!, edge.label);
      store.updateStudySet(set.id, { docPaths: [...new Set([...set.docPaths, ...(payload.studySets[0]?.docPaths ?? []).map(documentPath)])] });
      return set;
    });
    libraryChanged = true;
    for (const file of createdFiles) store.registerDocument(file.path);
    // 文档设置与批注：只写包内确实带出的文档，引用按新 ID 重写。
    let docMetaCount = 0, annotationCount = 0;
    for (const [path, meta] of Object.entries((payload.docMeta ?? {}) as Record<string, any>)) {
      const mapped = pathMap.get(path); if (!mapped || !meta || typeof meta !== "object") continue;
      store.updateDocMeta(mapped, structuredClone(meta)); docMetaCount++;
    }
    for (const [path, list] of Object.entries((payload.annotations ?? {}) as Record<string, any[]>)) {
      const mapped = pathMap.get(path); if (!mapped || !Array.isArray(list)) continue;
      const next = list.filter(ann => ann && typeof ann.id === "string").map(ann => ({ ...ann, docPath: mapped, cardId: ann.cardId && cardIds.has(ann.cardId) ? cardIds.get(ann.cardId) : undefined }));
      if (!next.length) continue;
      await store.saveAnnotationsNow(mapped, next as any); annotationCount += next.length;
    }
    let cardTemplates = 0, sceneTemplates = 0, skippedSceneTemplates = 0;
    let reviewDecks = 0, reviewLogs = 0, reviewStates = 0;
    const deckIds = new Map<string, string>();
    store.libraryTransaction("导入模板和复习数据", () => {
    for (const template of (payload.cardTemplates ?? []) as any[]) {
      if (!template?.id || store.cardTemplates.some(item => item.id === template.id)) continue;
      store.upsertCardTemplate(template); cardTemplates++;
    }
    for (const template of (payload.sceneTemplates ?? []) as any[]) {
      if (!template?.id || store.getSceneTemplates().some(item => item.id === template.id)) { skippedSceneTemplates++; continue; }
      const copy = { ...structuredClone(template), id: /^[a-z0-9-]+$/i.test(template.id) ? template.id : uid("scene-template") };
      try { store.addSceneTemplate(copy); sceneTemplates++; } catch { skippedSceneTemplates++; }
    }
    // 复习：卡组、卡状态、日志都只保留包内卡片。
    for (const deck of (payload.reviewDecks ?? []) as any[]) {
      if (!deck?.name) continue;
      const created = store.createReviewDeck(String(deck.name), summary.id);
      if (typeof deck.id === "string") deckIds.set(deck.id, created.id);
      const live = store.reviewDecks.find(item => item.id === created.id);
      if (live) live.cardIds = (deck.cardIds ?? []).filter((id: string) => cardIds.has(id)).map((id: string) => cardIds.get(id)!);
      reviewDecks++;
    }
    const mapQuestion = (id: unknown): string | undefined => {
      if (typeof id !== "string") return undefined;
      const [cardId] = id.split("::");
      const mappedCard = cardIds.get(cardId); if (!mappedCard) return undefined;
      let mapped = mappedCard + id.slice(cardId.length);
      let valid = true;
      mapped = mapped.replace(/::(scope|deck):([^:]+)::/g, (_match, kind: string, original: string) => {
        const replacement = (kind === "scope" ? canvasIds : deckIds).get(original);
        if (!replacement) { valid = false; return ""; }
        return `::${kind}:${replacement}::`;
      });
      return valid ? mapped : undefined;
    };
    for (const [oldId, state] of Object.entries((payload.srs ?? {}) as Record<string, any>)) {
      const mapped = mapQuestion(oldId); if (!mapped || !state || typeof state !== "object") continue;
      store.srs[mapped] = structuredClone(state); reviewStates++;
    }
    for (const log of (payload.reviewLogs ?? []) as any[]) {
      const mapped = log?.cardId ? cardIds.get(log.cardId) : undefined;
      const questionId = mapQuestion(log?.questionId); if (!mapped || !questionId) continue;
      const deckId = log.deckId ? deckIds.get(log.deckId) : undefined, scopeId = log.scopeId ? canvasIds.get(log.scopeId) : undefined;
      if ((log.deckId && !deckId) || (log.scopeId && !scopeId)) continue;
      store.reviewLogs.push({ ...structuredClone(log), cardId: mapped, questionId, deckId, scopeId }); reviewLogs++;
    }
    for (const row of (payload.reviewPending ?? []) as any[]) {
      const mapped = row?.cardId ? cardIds.get(row.cardId) : undefined;
      const questionId = mapQuestion(row?.questionId); if (!mapped || !questionId) continue;
      const deckId = row.deckId ? deckIds.get(row.deckId) : undefined, scopeId = row.scopeId ? canvasIds.get(row.scopeId) : undefined;
      if ((row.deckId && !deckId) || (row.scopeId && !scopeId)) continue;
      store.reviewPending.push({ ...structuredClone(row), id: uid("pending-import"), cardId: mapped, questionId, deckId, scopeId });
    }
    });
    store.setActiveStudySet(summary.id);
    store.save();
    await store.flush();
    return {
      studySetId: summary.id, studySetName: summary.name,
      cards: payload.cards.length, nodes: payload.nodes.length, edges: payload.edges.length, documents: createdFiles.length,
      duplicateGroups: repaired, droppedDuplicates: duplicated, renamedDocuments, pageCollectionRefs,
      annotations: annotationCount, docMeta: docMetaCount, cardTemplates, sceneTemplates, skippedSceneTemplates, reviewDecks, reviewLogs, reviewStates,
    };
  } catch (error) {
    if (!libraryChanged) for (const file of createdFiles.reverse()) { try { await vault.delete(file, true); } catch { /* keep going */ } }
    if (libraryChanged) throw new Error("导入未完成，已导入的数据和文件已保留，请检查并处理：" + String((error as Error)?.message ?? error));
    throw error;
  }
}

/** 命令入口：先选择“新建/并入”，再选择文件导入。 */
export function openStudySetImport(plugin: MarginStudyPlugin, onImported?: () => void): void {
  const active = plugin.store.studySets.find(set => set.id === plugin.store.activeStudySetId);
  const { modal, close } = createModal("导入学习集");
  const status = el("p", { class: "ms-muted", role: "status", text: "包内重复卡片编号会自动修复（去重或保留最新），同名文件自动重命名。" });
  const mode = el("select", { class: "ms-select", "aria-label": "导入方式" }) as HTMLSelectElement;
  mode.append(el("option", { value: "new", text: "新建学习集" }), el("option", { value: "merge", text: active ? `并入当前学习集：${active.name}` : "并入当前学习集（需先选择）" }));
  if (!active) mode.lastElementChild?.setAttribute("disabled", "true");
  const name = el("input", { type: "text", class: "ms-search", "aria-label": "导入后的学习集名称", placeholder: "留空使用包内名称" });
  const actions = el("div", { class: "ms-modal-actions" });
  const cancel = el("button", { class: "ms-btn", text: "取消" }); cancel.addEventListener("click", close);
  const choose = el("button", { class: "ms-btn primary", text: "选择文件…" });
  choose.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".zip,.marginstudy-set.zip";
    input.addEventListener("change", () => {
      const file = input.files?.[0]; if (!file) return;
      choose.disabled = true; status.textContent = "正在读取 " + file.name + "…";
      void file.arrayBuffer()
        .then(bytes => importStudySetPackage(plugin, bytes, { mode: mode.value as "new" | "merge", studySetId: mode.value === "merge" ? active?.id : undefined, name: name.value.trim() || undefined }))
        .then(result => {
          new Notice(`已导入「${result.studySetName}」：${result.cards} 卡 / ${result.nodes} 节点 / ${result.documents} 文件${result.droppedDuplicates ? ` / 修复重复 ${result.duplicateGroups} 组` : ""}${result.skippedSceneTemplates ? ` / 跳过场景模板 ${result.skippedSceneTemplates} 个` : ""}`, 9000);
          close(); onImported?.();
        })
        .catch(error => { choose.disabled = false; status.textContent = "导入失败：" + String((error as Error)?.message ?? error); });
    });
    input.click();
  });
  actions.append(cancel, choose);
  modal.append(el("label", { text: "方式 " }), mode, el("label", { text: "名称 " }), name, status, actions);
}
