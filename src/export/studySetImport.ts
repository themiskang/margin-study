/**
 * [INPUT]: 读取 v1 学习集 ZIP。依赖 Store 的来源指纹和 SRS 日期规范化。
 * [OUTPUT]: 提供包校验、学习集导入和导入对话框。
 * [POS]: 重映射资料引用。主数据有待处理冲突时保留候选引用的文件。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Notice } from "obsidian";
import { createModal } from "../utils/modal";
import { el } from "../utils/dom";
import { strFromU8, strToU8, unzipSync } from "fflate";
import type MarginStudyPlugin from "../main";
import { repairDuplicateIds } from "../model/duplicateIds";
import { cardsIncludingMembers } from "../model/reviewPending";
import { validateAnnotationCollection } from "../model/annotationValidation";
import { DesktopMainConflict } from "../model/desktopMainReplacement";
import type { Store } from "../model/store";
import { normalizeState } from "../srs";
import type { Annotation, Card, CardSource, Edge, MindCanvas, MindNode, PluginData, StudySet } from "../types";
import { uid } from "../utils/id";
import { sha256Hex } from "../utils/sha256";
import { planStudySetFiles, safeStudySetPath, StudySetImportJournal, withStudySetImportLock, writeStudySetFiles } from "./studySetImportFiles";

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
  reused?: boolean;
}

export interface StudySetImportOptions {
  /** merge：并入现有学习集；new：新建学习集（默认）。 */
  mode?: "new" | "merge";
  studySetId?: string;
  name?: string;
}

const HEX = /^[0-9a-f]{64}$/;

async function packageHash(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) return sha256Hex(bytes);
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

type ImportPayload = Pick<PluginData, "cards" | "nodes" | "edges" | "cardTemplates" | "sceneTemplates" |
  "docMeta" | "documents" | "reviewDecks" | "reviewLogs" | "reviewPending"> &
  Partial<Pick<PluginData, "srs">> & { studySets: StudySet[]; canvases: MindCanvas[]; annotations?: Record<string, Annotation[]> };

/** 校验并解析 `.marginstudy-set.zip`：清单逐文件字节与 SHA-256 必须与内容一致。 */
export async function readStudySetPackage(bytes: ArrayBuffer): Promise<{ payload: ImportPayload; files: Map<string, Uint8Array>; repaired: number; duplicated: number }> {
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(new Uint8Array(bytes)); }
  catch { throw new Error("不是有效的 ZIP 文件"); }
  const manifestBytes = entries["MANIFEST.json"]; if (!manifestBytes) throw new Error("缺少 MANIFEST.json");
  let manifest: any;
  try { manifest = JSON.parse(strFromU8(manifestBytes)); } catch { throw new Error("MANIFEST.json 无法解析"); }
  if (manifest?.format !== "marginstudy-study-set-manifest" || manifest?.version !== 1) throw new Error("不支持的清单格式或版本");
  if (!Array.isArray(manifest.files)) throw new Error("清单缺少文件列表");
  const listed = new Set<string>();
  for (const item of manifest.files) {
    const path = typeof item?.path === "string" ? item.path : "";
    const payload = Object.prototype.hasOwnProperty.call(entries, path) ? entries[path] : undefined;
    if (!payload || listed.has(path)) throw new Error("清单条目缺失或路径无效：" + path);
    safeStudySetPath(path);
    listed.add(path);
    if (payload.byteLength !== item.bytes) throw new Error("清单字节数不一致：" + path);
    if (!HEX.test(String(item.sha256)) || await packageHash(payload) !== item.sha256) throw new Error("清单 SHA-256 不一致：" + path);
  }
  const payloadFile = entries["studyset.json"]; if (!payloadFile || !listed.has("studyset.json")) throw new Error("缺少 studyset.json");
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
    if (!listed.has(path)) throw new Error("包内文件不在清单中：" + path);
    files.set(path, value);
  }
  return { payload: data as ImportPayload, files, repaired: repaired.length, duplicated: before - after };
}

function emptySummary(studySetId: string, studySetName: string): StudySetImportSummary {
  return { studySetId, studySetName, cards: 0, nodes: 0, edges: 0, documents: 0, duplicateGroups: 0,
    droppedDuplicates: 0, renamedDocuments: 0, pageCollectionRefs: 0, annotations: 0, docMeta: 0,
    cardTemplates: 0, sceneTemplates: 0, skippedSceneTemplates: 0, reviewDecks: 0, reviewLogs: 0, reviewStates: 0 };
}

function warnAboutLegacyImport(store: Store, payload: ImportPayload, targetId?: string): void {
  const candidates = store.studySets.filter(set => !set.id.startsWith("study-import-") && (!targetId || set.id === targetId));
  for (const set of candidates) {
    const members = new Set(set.cardIds ?? []);
    const olderCards = store.cards.filter(card => (members.has(card.id) || set.docPaths.includes(card.docPath)) && card.id.startsWith("import-"));
    if (olderCards.some(card => payload.cards.some(source =>
      source.front === card.front && source.back === card.back && source.type === card.type &&
      source.anchorAnnId === card.anchorAnnId && source.createdAt === card.createdAt
    ))) throw new Error(`发现疑似旧版导入「${set.name}」，无法确认资料归属。请先核对该学习集的文件和卡片。`);
  }
}

function rewriteResourcePaths<T>(input: T, paths: Map<string, string>): T {
  if (typeof input === "string") {
    return input.replace(/_marginstudy-(?:media|audio|imports)\/[^\s"'<>()[\]{}]+/g, path => paths.get(path) ?? path) as T;
  }
  if (Array.isArray(input)) return input.map(value => rewriteResourcePaths(value, paths)) as T;
  if (input && typeof input === "object") {
    const output = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, rewriteResourcePaths(value, paths)]));
    const imported = (input as { imported?: { path?: string } }).imported;
    if (imported?.path && paths.has(imported.path)) output.imported = { ...(output.imported as object), path: paths.get(imported.path) };
    return output as T;
  }
  return input;
}

/** 按整包字节和导入目标识别重试。首张导入画布是主数据内的提交凭据。 */
export async function importStudySetPackage(plugin: MarginStudyPlugin, bytes: ArrayBuffer, options: StudySetImportOptions = {}): Promise<StudySetImportSummary> {
  const { payload, files, repaired, duplicated } = await readStudySetPackage(bytes);
  const { store, app: { vault } } = plugin;
  const merging = options.mode === "merge";
  if (merging && !options.studySetId) throw new Error("目标学习集不存在，无法并入");
  const key = sha256Hex(JSON.stringify([await packageHash(new Uint8Array(bytes)), merging ? options.studySetId : null]));
  const setId = merging ? options.studySetId! : "study-import-" + key;
  const firstCanvasId = `canvas-import-${key}-0`;
  const journal = new StudySetImportJournal(vault, key);
  return withStudySetImportLock(vault, async () => {
    store.assertNoDesktopMainConflict();
    const committedSet = async () => {
      const disk: PluginData | null = await store.host.loadData();
      return !merging || disk?.canvases?.some(canvas => canvas.id === firstCanvasId && canvas.studySetId === setId)
        ? disk?.studySets?.find(set => set.id === setId) : undefined;
    };
    const existing = await committedSet();
    if (existing) {
      await journal.finish().catch(error => console.warn("导入恢复清单尚未清除", error));
      return { ...emptySummary(existing.id, existing.name), reused: true };
    }
    await journal.rollback();
    const target = merging ? store.studySets.find(set => set.id === setId) : undefined;
    if (merging && !target) throw new Error("目标学习集不存在，无法并入");
    if (files.size) warnAboutLegacyImport(store, payload, target?.id);
    const sourceSet = payload.studySets[0];
    const name = target?.name ?? (options.name?.trim() || sourceSet?.name?.trim() || "导入的学习集");
    const plan = await planStudySetFiles(vault, files, path => store.sidecarPath(path));
    const { pathMap, documentPaths, writes } = plan;
    const sourceBytes = new Map(writes.map(file => [file.path, file.bytes]));
    const summary = Object.assign(emptySummary(setId, name), { cards: payload.cards.length, nodes: payload.nodes.length,
      edges: payload.edges.length, documents: documentPaths.size, duplicateGroups: repaired, droppedDuplicates: duplicated,
      renamedDocuments: plan.renamedDocuments, pageCollectionRefs: plan.pageCollectionRefs });
    const allCards = cardsIncludingMembers(payload.cards);
    const cardIds = new Map(allCards.map(card => [card.id, uid("card-import")]));
    const now = new Date().toISOString();
    const canvases: MindCanvas[] = payload.canvases.length ? payload.canvases
      : [{ id: "default", studySetId: setId, name: "主脑图", createdAt: now }];
    const canvasIds = new Map(canvases.map((canvas, index) => [canvas.id, `canvas-import-${key}-${index}`]));
    const archivedNodes = allCards.flatMap(card => (card.mergeArchive?.nodes ?? []).filter(node => canvasIds.has(node.canvasId ?? "")));
    const nodeIds = new Map([...new Set([...payload.nodes, ...archivedNodes].map(node => node.id))].map(id => [id, uid("import")]));
    const submapIds = new Map(canvases.flatMap(canvas => (canvas.submaps ?? []).map(submap => [submap.id, uid("submap")] as const)));
    const deckIds = new Map((payload.reviewDecks ?? []).filter(deck => !!deck?.name).map(deck => [deck.id, uid("deck")]));
    const documentPath = (path: string) => path ? (pathMap.get(path) ?? safeStudySetPath(path)) : "";
    const remapStrings = <T>(value: T): T => rewriteResourcePaths(value, pathMap);
    const mappedDocumentPaths = (sourceSet?.docPaths ?? []).map(documentPath);
    const documentAttachments: Record<string, string[]> = Object.create(null);
    for (const [path, attachments] of Object.entries(sourceSet?.documentAttachments ?? {})) {
      const mapped = documentPath(path);
      for (const attachment of attachments) {
        const next = documentPath(attachment);
        if (pathMap.has(attachment) || await vault.adapter.exists(next)) (documentAttachments[mapped] ??= []).push(next);
      }
    }
    const referencedDocPaths = new Set<string>([
      ...documentPaths,
      ...(sourceSet?.docPaths ?? []).map(safeStudySetPath),
      ...(payload.documents ?? []).map(document => safeStudySetPath(document.path)),
    ]);
    const writtenSidecars = new Set<string>();
    const importedAnnotationPaths = new Set<string>();
    for (const [path, list] of Object.entries(payload.annotations ?? {})) {
      if (!Array.isArray(list) || !list.length) continue;
      const safe = safeStudySetPath(path);
      const inPackage = documentPaths.has(safe);
      if (!inPackage && !referencedDocPaths.has(safe)) continue;
      const mapped = pathMap.get(safe) ?? safe;
      const sidecar = store.sidecarPath(mapped);
      if (!inPackage && (writtenSidecars.has(sidecar) || await vault.adapter.exists(sidecar))) continue;
      writtenSidecars.add(sidecar);
      importedAnnotationPaths.add(safe);
      const annotations = list.map(annotation => ({
        ...remapStrings(annotation), docPath: mapped, cardId: annotation.cardId ? cardIds.get(annotation.cardId) : undefined,
      }));
      validateAnnotationCollection(annotations);
      writes.push({ path: sidecar, sidecar: true,
        bytes: strToU8(JSON.stringify({ schemaVersion: 2, annotations })) });
      summary.annotations += annotations.length;
    }
    const questionId = (id: string | undefined): string | undefined => {
      if (typeof id !== "string") return;
      const [card, scope, ...rest] = id.split("::");
      const mapped = cardIds.get(card);
      if (!mapped) return;
      if (!scope) return mapped;
      if (scope.startsWith("merged:")) {
        const original = questionId(id.slice(card.length + "::merged:".length));
        return original ? `${mapped}::merged:${original}` : undefined;
      }
      if (scope.startsWith("scope:") || scope.startsWith("deck:")) {
        const kind = scope.startsWith("scope:") ? "scope" : "deck";
        const identity = (kind === "scope" ? canvasIds : deckIds).get(scope.slice(kind.length + 1));
        return identity ? [mapped, `${kind}:${identity}`, ...rest].join("::") : undefined;
      }
      return [mapped, scope, ...rest].join("::");
    };
    const mapScope = (row: { cardId: string; questionId: string; deckId?: string; scopeId?: string }) => {
      if (typeof row?.questionId !== "string" || row.questionId.split("::")[0] !== row.cardId) return;
      const cardId = cardIds.get(row.cardId), question = questionId(row.questionId);
      const deckId = row.deckId ? deckIds.get(row.deckId) : undefined, scopeId = row.scopeId ? canvasIds.get(row.scopeId) : undefined;
      if (!cardId || !question || row.deckId && !deckId || row.scopeId && !scopeId) return;
      return { cardId, questionId: question, deckId, scopeId };
    };
    const nodeCopy = (node: MindNode): MindNode => ({
      ...remapStrings(node), id: nodeIds.get(node.id)!, canvasId: canvasIds.get(node.canvasId ?? "") ?? firstCanvasId,
      cardId: cardIds.get(node.cardId ?? ""), parentId: nodeIds.get(node.parentId ?? "") ?? null,
      sourceNodeId: nodeIds.get(node.sourceNodeId ?? ""), submapId: submapIds.get(node.submapId ?? ""),
      docPath: node.docPath ? documentPath(node.docPath) : undefined,
    });
    const cardTemplateIds = new Map<string, string>(), sceneTemplateIds = new Map<string, string>();
    const mapLinks = (links: string[]) => links.flatMap(id => cardIds.get(id) ?? []);
    const mapSource = (source: CardSource): CardSource => ({ ...remapStrings(source), docPath: documentPath(source.docPath) });
    const mapEdge = (edge: Edge): Edge[] => {
      const from = nodeIds.get(edge.from), to = nodeIds.get(edge.to);
      return from && to ? [{ ...edge, from, to }] : [];
    };
    const mapCardFields = (card: Partial<Card>): Partial<Card> => ({
      ...remapStrings(card),
      ...(card.docPath !== undefined && { docPath: documentPath(card.docPath) }),
      ...(card.links && { links: mapLinks(card.links) }),
      ...(card.sources && { sources: card.sources.map(mapSource) }),
      ...(card.excerptBlocks && { excerptBlocks: card.excerptBlocks.map(block => ({
        ...remapStrings(block), ...(block.source && { source: mapSource(block.source) }),
      })) }),
      ...(card.templateId && { templateId: cardTemplateIds.get(card.templateId) ?? card.templateId }),
      ...(card.vocabulary && { vocabulary: { ...card.vocabulary, studySetId: card.vocabulary.studySetId === sourceSet?.id ? setId : undefined } }),
    });
    const cardCopy = (card: Card): Card => {
      const archive = card.mergeArchive;
      return { ...card, ...mapCardFields(card), id: cardIds.get(card.id)!, docPath: documentPath(card.docPath ?? ""),
        groupId: cardIds.get(card.groupId ?? ""), sourceCardId: cardIds.get(card.sourceCardId ?? ""),
        mergedCards: card.mergedCards?.map(cardCopy),
        mergedReviewStates: card.mergedReviewStates && Object.fromEntries(Object.entries(card.mergedReviewStates).flatMap(([id, state]) => {
          const mapped = questionId(id);
          return mapped ? [[mapped, state]] : [];
        })),
        mergeArchive: archive && {
          nodes: archive.nodes.filter(node => canvasIds.has(node.canvasId ?? "")).map(nodeCopy),
          edges: archive.edges.flatMap(mapEdge),
          memberships: archive.memberships.filter(entry => entry.studySetId === sourceSet?.id)
            .map(entry => ({ studySetId: setId, cardIds: mapLinks(entry.cardIds ?? []) })),
          presentation: archive.presentation && mapCardFields(archive.presentation),
          collapsedNodeIds: archive.collapsedNodeIds?.flatMap(id => nodeIds.get(id) ?? []),
          movedParents: archive.movedParents?.flatMap(move => {
            const id = nodeIds.get(move.id);
            return id ? [{ id, before: nodeIds.get(move.before ?? "") ?? null, after: nodeIds.get(move.after ?? "") ?? null }] : [];
          }),
          mappedEdges: archive.mappedEdges?.flatMap(mapEdge),
          cardLinks: archive.cardLinks?.flatMap(entry => {
            const cardId = cardIds.get(entry.cardId);
            return cardId ? [{ cardId, links: mapLinks(entry.links), mergedLinks: mapLinks(entry.mergedLinks) }] : [];
          }),
        },
      };
    };
    await journal.begin(writes);
    try {
      await writeStudySetFiles(vault, writes);
      await store.commitStudySetImport(firstCanvasId, () => {
        const current = merging ? store.studySets.find(set => set.id === setId) : undefined;
        if (merging && !current) throw new Error("目标学习集不存在，无法并入");
        const set: StudySet = current ?? { id: setId, name, docPaths: [], createdAt: sourceSet?.createdAt ?? now };
        if (!current) store.studySets.push(set);
        for (const template of payload.cardTemplates ?? []) {
          if (!template?.id) continue;
          const existing = store.cardTemplates.find(item => item.id === template.id);
          const id = existing && JSON.stringify(existing) !== JSON.stringify(template) ? uid("card-template") : template.id;
          cardTemplateIds.set(template.id, id);
          if (!existing || id !== existing.id) { store.upsertCardTemplate({ ...template, id }); summary.cardTemplates++; }
        }
        for (const template of payload.sceneTemplates ?? []) {
          if (!template?.id) { summary.skippedSceneTemplates++; continue; }
          const existing = store.getSceneTemplates().find(item => item.id === template.id);
          const id = existing && JSON.stringify(existing) !== JSON.stringify(template) || !/^[a-z0-9-]+$/i.test(template.id)
            ? uid("scene-template") : template.id;
          try {
            if (!existing || id !== existing.id) { store.addSceneTemplate({ ...template, id }); summary.sceneTemplates++; }
            else summary.skippedSceneTemplates++;
            sceneTemplateIds.set(template.id, id);
          } catch { summary.skippedSceneTemplates++; }
        }
        for (const canvas of canvases) {
          store.canvases.push({ ...remapStrings(canvas), id: canvasIds.get(canvas.id)!, name: canvas.name || "主脑图", studySetId: set.id,
            lastDocumentPath: canvas.lastDocumentPath ? documentPath(canvas.lastDocumentPath) : undefined,
            submaps: canvas.submaps?.flatMap(submap => {
              const rootNodeId = nodeIds.get(submap.rootNodeId);
              return rootNodeId ? [{ ...submap, id: submapIds.get(submap.id)!, rootNodeId }] : [];
            }) });
        }
        store.activeStudySetId = set.id;
        store.activeCanvasId = firstCanvasId;
        for (const card of payload.cards) store.addCard(cardCopy(card));
        for (const node of payload.nodes) store.addNode(nodeCopy(node));
        for (const edge of payload.edges) {
          const from = nodeIds.get(edge.from), to = nodeIds.get(edge.to);
          if (from && to) store.addEdge(from, to, edge.label);
        }
        set.docPaths = [...new Set([...set.docPaths, ...mappedDocumentPaths])];
        if (Object.keys(documentAttachments).length) {
          set.documentAttachments = { ...set.documentAttachments };
          for (const [path, attachments] of Object.entries(documentAttachments)) {
            set.documentAttachments[path] = [...new Set([...(set.documentAttachments[path] ?? []), ...attachments])];
          }
        }
        for (const path of new Set([...documentPaths, ...importedAnnotationPaths])) {
          const inPackage = documentPaths.has(path);
          const metadata = payload.documents?.find(document => document.path === path);
          const mapped = documentPath(path);
          if (inPackage) store.registerDocument(mapped, metadata?.sourceUrl, sourceBytes.get(mapped));
          const meta = payload.docMeta?.[path];
          if (meta && typeof meta === "object" && (inPackage || !store.docMeta[mapped])) {
            const mappedMeta = remapStrings(meta);
            const edits = mappedMeta.pdfPageEdits;
            if (edits?.version === 1 && Array.isArray(edits.pages) && edits.pages.length === 0) delete mappedMeta.pdfPageEdits;
            store.updateDocMeta(mapped, mappedMeta);
            summary.docMeta++;
          }
        }
        for (const deck of payload.reviewDecks ?? []) {
          const id = deckIds.get(deck?.id);
          if (!id) continue;
          const legacyScopeId = deck.legacyScopeId ? canvasIds.get(deck.legacyScopeId) : deck.legacyScopeId;
          store.reviewDecks.push({
            ...deck, id, legacyScopeId, studySetIds: deck.studySetIds?.includes(sourceSet?.id) && !set.reviewDeckId ? [set.id] : [],
            cardIds: (deck.cardIds ?? []).flatMap(card => cardIds.get(card) ?? []),
            createdAt: deck.createdAt ?? now,
          });
          summary.reviewDecks++;
        }
        const boundDeck = deckIds.get(sourceSet?.reviewDeckId ?? "") ?? (!current && deckIds.size === 1 ? [...deckIds.values()][0] : undefined);
        if (boundDeck && !set.reviewDeckId) {
          set.reviewDeckId = boundDeck;
          store.activeReviewDeckId = boundDeck;
          store.reviewDecks.find(deck => deck.id === boundDeck)!.studySetIds = [set.id];
        }
        if (!current && sourceSet) {
          const scene = sourceSet.scene;
          if (scene) set.scene = { ...scene, templateId: sceneTemplateIds.get(scene.templateId ?? "") ?? scene.templateId };
          set.recallSettings = sourceSet.recallSettings;
          if (sourceSet.reviewSettings) set.reviewSettings = { ...sourceSet.reviewSettings, docPaths: sourceSet.reviewSettings.docPaths?.map(documentPath) };
          if (sourceSet.practiceSettings) set.practiceSettings = { ...sourceSet.practiceSettings, deckId: deckIds.get(sourceSet.practiceSettings.deckId ?? "") };
          const destination = sourceSet.excerptDestination;
          if (destination) set.excerptDestination = { ...destination, canvasId: canvasIds.get(destination.canvasId ?? ""), nodeId: nodeIds.get(destination.nodeId ?? "") };
          set.fixedViews = sourceSet.fixedViews?.flatMap(view => {
            const canvasId = canvasIds.get(view.canvasId);
            return canvasId ? [{ ...view, id: uid("view"), canvasId, nodeId: nodeIds.get(view.nodeId ?? "") }] : [];
          });
        }
        for (const [oldId, state] of Object.entries(payload.srs ?? {})) {
          const mapped = questionId(oldId);
          if (mapped && state && typeof state === "object") {
            store.srs[mapped] = normalizeState(state, store.settings.defaultEase);
            summary.reviewStates++;
          }
        }
        for (const log of payload.reviewLogs ?? []) {
          const scope = mapScope(log);
          if (!scope) continue;
          store.reviewLogs.push({ ...log, ...scope, id: uid("review-import"),
            cardSnapshot: log.cardSnapshot && cardIds.has(log.cardSnapshot.id) ? cardCopy(log.cardSnapshot) : undefined });
          summary.reviewLogs++;
        }
        for (const row of payload.reviewPending ?? []) {
          const scope = mapScope(row);
          if (scope) store.reviewPending.push({ ...row, ...scope, id: uid("pending-import") });
        }
      });
    } catch (error) {
      if (error instanceof DesktopMainConflict) {
        await journal.finish().catch(cleanup => console.warn("导入恢复清单尚未清除", cleanup));
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      let committed: StudySet | undefined;
      try { committed = await committedSet(); if (!committed) await journal.rollback(); }
      catch (cleanup) { throw new Error(`导入未完成，恢复清单已保留。请检查后重试。${detail}；${String(cleanup)}`); }
      if (!committed) throw new Error("导入失败，已回滚：" + detail);
    }
    await journal.finish().catch(error => console.warn("导入恢复清单尚未清除", error));
    return summary;
  });
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
          new Notice(result.reused ? `此包已导入「${result.studySetName}」` : `已导入「${result.studySetName}」：${result.cards} 卡 / ${result.nodes} 节点 / ${result.documents} 文件${result.droppedDuplicates ? ` / 修复重复 ${result.duplicateGroups} 组` : ""}${result.skippedSceneTemplates ? ` / 跳过场景模板 ${result.skippedSceneTemplates} 个` : ""}`, 9000);
          close(); onImported?.();
        })
        .catch(error => { choose.disabled = false; status.textContent = "导入失败：" + String((error as Error)?.message ?? error); });
    });
    input.click();
  });
  actions.append(cancel, choose);
  modal.append(el("label", { text: "方式 " }), mode, el("label", { text: "名称 " }), name, status, actions);
}
