/**
 * [INPUT]: 依赖 ReaderView、Store 与默认 agent-browser 后端，零私有夹具依赖。
 * [OUTPUT]: 执行 ANNOT-02 统一标注撤销模型验收（B1~B10：5类标注原子撤重、跨页、连续摘录、与笔迹交错、文档根共享、编辑/合并/FSRS保护、并发拒绝、手动建卡单事务、撤销后外部改卡重做保护与未改卡复原、自动复习初始快照撤重、跨文档合并组员撤重锚点与解除合并归属、store.history 零污染）。
 * [POS]: 公开浏览器验收套件 annot-undo-atomicity，固化 ANNOT-02 全部二值断言。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { readFile, writeFile, mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { runBrowser } from "./ego-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const project = await realpath(resolve(here, "../.."));
const docFixtures = join(project, "src/documents/acceptance-fixtures");
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-annot-undo-")));

const fixtureSource = `
import { TFile } from "obsidian";
import { Store } from "${project}/src/model/store";
import { ReaderView } from "${project}/src/pdf/readerView";

(HTMLElement.prototype as any).empty = function () { this.replaceChildren(); };
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};

const frame = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const assert = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };
const errors: string[] = [];
window.addEventListener("error", e => errors.push(String(e.error ?? e.message)));
window.addEventListener("unhandledrejection", e => errors.push(String(e.reason)));

const fixturesHost = document.getElementById("fixtures")!;

function makeEnv(filesMap: Record<string, string | object>) {
  const sources = new Map<string, { file: TFile; content: string }>();
  for (const [path, val] of Object.entries(filesMap)) {
    const content = typeof val === "string" ? val : JSON.stringify(val);
    sources.set(path, { file: new TFile(path, content.length), content });
  }
  const adapterFiles = new Map<string, string>();
  const folders = new Set<string>();
  const app: any = {
    vault: {
      configDir: ".obsidian",
      getFiles: () => [...sources.values()].map(v => v.file),
      getAbstractFileByPath: (p: string) => sources.get(p)?.file ?? null,
      async read(file: TFile) { return sources.get(file.path)!.content; },
      async readBinary(file: TFile) { return new TextEncoder().encode(sources.get(file.path)!.content).buffer; },
      getResourcePath: (file: TFile) => "/synthetic/" + encodeURIComponent(file.path),
      on() { return { off() {} }; },
      adapter: {
        async exists(p: string) { return adapterFiles.has(p) || sources.has(p) || folders.has(p); },
        async read(p: string) { if (!adapterFiles.has(p)) throw new Error("Missing " + p); return adapterFiles.get(p)!; },
        async write(p: string, v: string) { adapterFiles.set(p, v); },
        async mkdir(p: string) { folders.add(p); },
        async remove(p: string) { adapterFiles.delete(p); },
        async rename(from: string, to: string) { adapterFiles.set(to, adapterFiles.get(from)!); adapterFiles.delete(from); },
      },
    },
    metadataCache: { getFirstLinkpathDest: () => null },
    commands: { commands: {}, executeCommandById: () => false },
    workspace: {
      on() { return { off() {} }; },
      offref() {},
      onLayoutReady(cb: any) { cb(); },
      getMostRecentLeaf() { return null; },
      requestSaveLayout() {},
      getLeaf() { return { setViewState: async () => {} }; },
      getLeavesOfType() { return []; },
      revealLeaf() {},
      setActiveLeaf() {},
    },
  };
  let savedData: any = null;
  const plugin: any = {
    app,
    async loadData() { return savedData; },
    async saveData(d: any) { savedData = structuredClone(d); },
    refreshSidebar() {},
    refreshMindmap() {},
    async ensureMindMapOpen() {},
    async openStudyWorkspace() { return null; },
    async openDocumentInReader() {},
    activeReader: null,
    studyWorkspace: null,
  };
  const store = new Store(plugin);
  plugin.store = store;
  return { app, plugin, store };
}

async function openPdf(path: string, pages = 2) {
  fixturesHost.replaceChildren();
  const env = makeEnv({ [path]: { name: path, pages } });
  await env.store.load();
  const leaf: any = { app: env.app, view: null, containerEl: document.createElement("div") };
  const view = new ReaderView(leaf, env.plugin);
  leaf.view = view;
  view.containerEl.style.cssText = "position:relative;width:820px;height:760px;";
  fixturesHost.append(view.containerEl);
  await view.onOpen();
  await view.loadFileByPath(path);
  view.setScale(1);
  for (let p = 1; p <= pages; p++) await view.renderPage(p);
  await frame();
  return { ...env, view, ctrl: (view as any).annController };
}

function historySnapshot(store: any) {
  const st = store.getLibraryHistoryState();
  return {
    len: (store as any).history.length,
    futureLen: (store as any).future.length,
    revision: st.revision,
    labels: (store as any).history.map((h: any) => h.label),
  };
}

(window as any).runAll = async () => {
  const report: Record<string, any> = {};

  // ===== B1: 五类标注新建（highlight / underline / strike / note / region）原子 Undo/Redo + store.history 零污染 =====
  {
    const types = ["highlight", "underline", "strike", "note", "region"] as const;
    const results: Record<string, any> = {};
    for (const type of types) {
      const path = \`b1-\${type}.pdf\`;
      const { view, ctrl, store } = await openPdf(path, 1);
      try {
        const hist0 = historySnapshot(store);
        const rect = { x: 80, y: 500, w: 160, h: 20 };
        const target = { kind: "pdf", pageNum: 1, rects: [rect], pdfGeometry: [{ page: 1, rects: [rect] }], pdfCoordinateSpace: "pdf" };
        if (type === "region") {
          ctrl.commitRegion(target, "data:image/png;base64,AA==", "区域摘录正文测试");
        } else {
          ctrl.commitAnnotation(target, type, "#ffd54f", \`测试\${type}摘录内容\`);
        }
        const anns1 = await store.loadAnnotations(path);
        assert(anns1.length === 1, \`B1 \${type}: expected 1 ann\`);
        const expectsCard = type === "highlight" || type === "underline" || type === "region";
        if (expectsCard) {
          assert(store.cards.length === 1 && store.nodes.length === 2, \`B1 \${type}: expected 1 card + 2 nodes\`);
        }
        const snapAnn = structuredClone(anns1[0]);
        const snapCard = store.cards[0] ? structuredClone(store.cards[0]) : null;
        const snapNodes = structuredClone(store.nodes);
        const histAfterCreate = historySnapshot(store);
        assert(JSON.stringify(histAfterCreate) === JSON.stringify(hist0), \`B1 \${type}: create polluted store.history: \${JSON.stringify(histAfterCreate)}\`);

        // 1x Undo
        await view.undoLastEdit();
        const undoAnnCount = (await store.loadAnnotations(path)).length;
        const undoCardCount = store.cards.length;
        const undoNodeCount = store.nodes.length;
        const histAfterUndo = historySnapshot(store);
        assert(undoAnnCount === 0 && undoCardCount === 0 && undoNodeCount === 0,
          \`B1 \${type}: undo left remnants ann=\${undoAnnCount} card=\${undoCardCount} node=\${undoNodeCount}\`);
        assert(JSON.stringify(histAfterUndo) === JSON.stringify(hist0), \`B1 \${type}: undo polluted store.history\`);

        // 1x Redo
        await view.redoLastEdit();
        const annsAfterRedo = await store.loadAnnotations(path);
        const histAfterRedo = historySnapshot(store);
        assert(annsAfterRedo.length === 1 && annsAfterRedo[0].id === snapAnn.id && annsAfterRedo[0].color === snapAnn.color
          && JSON.stringify(annsAfterRedo[0].rects) === JSON.stringify(snapAnn.rects),
          \`B1 \${type}: redo annotation mismatch\`);
        if (expectsCard) {
          const c = store.cards[0];
          assert(c && c.id === snapCard!.id && c.front === snapCard!.front && c.anchorAnnId === snapAnn.id && annsAfterRedo[0].cardId === c.id,
            \`B1 \${type}: redo card mismatch\`);
          assert(store.nodes.length === snapNodes.length && store.nodes.every((n: any, i: number) => n.id === snapNodes[i].id && n.x === snapNodes[i].x && n.y === snapNodes[i].y),
            \`B1 \${type}: redo nodes mismatch\`);
        }
        assert(JSON.stringify(histAfterRedo) === JSON.stringify(hist0), \`B1 \${type}: redo polluted store.history\`);
        results[type] = {
          created: { ann: 1, card: snapCard ? 1 : 0, node: snapNodes.length },
          afterUndo: { ann: undoAnnCount, card: undoCardCount, node: undoNodeCount },
          afterRedo: { ann: annsAfterRedo.length, card: store.cards.length, node: store.nodes.length },
          historyDelta: histAfterRedo.revision - hist0.revision,
        };
      } finally { await view.onClose(); }
    }
    report.B1 = results;
  }

  // ===== B2: 跨页高亮原子 Undo/Redo =====
  {
    const path = "b2-cross.pdf";
    const { view, ctrl, store } = await openPdf(path, 2);
    try {
      const hist0 = historySnapshot(store);
      const geom = [{ page: 1, rects: [{ x: 80, y: 120, w: 200, h: 18 }] }, { page: 2, rects: [{ x: 80, y: 700, w: 180, h: 18 }] }];
      ctrl.commitAnnotation({ kind: "pdf", pageNum: 1, rects: geom[0].rects, pdfGeometry: geom, pdfCoordinateSpace: "pdf" }, "highlight", "#80cbc4", "跨页两页完整高亮文本");
      const anns1 = await store.loadAnnotations(path);
      assert(anns1.length === 1 && anns1[0].pdfGeometry?.length === 2 && store.cards.length === 1 && store.nodes.length === 2, "B2 create failed");
      await view.undoLastEdit();
      assert((await store.loadAnnotations(path)).length === 0 && store.cards.length === 0 && store.nodes.length === 0, "B2 undo failed");
      await view.redoLastEdit();
      const anns2 = await store.loadAnnotations(path);
      assert(anns2.length === 1 && JSON.stringify(anns2[0].pdfGeometry) === JSON.stringify(geom) && store.cards.length === 1 && store.cards[0].anchorAnnId === anns2[0].id, "B2 redo failed");
      assert(JSON.stringify(historySnapshot(store)) === JSON.stringify(hist0), "B2 history polluted");
      report.B2 = { pagesAfterRedo: anns2[0].pdfGeometry.length, afterUndo: { ann: 0, card: 0, node: 0 }, historyDelta: 0 };
    } finally { await view.onClose(); }
  }

  // ===== B3: 连续摘录 3 笔逐笔 Undo/Redo + continueExcerptInCard 保护 =====
  {
    const path = "b3-continuous.pdf";
    const { view, ctrl, store } = await openPdf(path, 1);
    try {
      const hist0 = historySnapshot(store);
      ctrl.setContinuousExcerpt(true);
      const mkTarget = (y: number) => ({ kind: "pdf", pageNum: 1, rects: [{ x: 80, y, w: 150, h: 18 }], pdfGeometry: [{ page: 1, rects: [{ x: 80, y, w: 150, h: 18 }] }], pdfCoordinateSpace: "pdf" });
      ctrl.commitAnnotation(mkTarget(600), "highlight", "#ffd54f", "第一段摘录");
      ctrl.commitAnnotation(mkTarget(560), "highlight", "#ffd54f", "第二段");
      ctrl.commitAnnotation(mkTarget(520), "highlight", "#ffd54f", "第三段");
      assert(ctrl.getContinuousExcerpt().count === 3 && store.cards[0].front === "第一段摘录\\n\\n第二段\\n\\n第三段", "B3 3-step create failed");

      await view.undoLastEdit();
      assert(ctrl.getContinuousExcerpt().count === 2 && store.cards[0].front === "第一段摘录\\n\\n第二段", "B3 undo 1 failed");
      await view.undoLastEdit();
      assert(ctrl.getContinuousExcerpt().count === 1 && store.cards[0].front === "第一段摘录", "B3 undo 2 failed");
      await view.undoLastEdit();
      assert(ctrl.getContinuousExcerpt().count === 0 && (await store.loadAnnotations(path)).length === 0 && store.cards.length === 0 && store.nodes.length === 0, "B3 undo 3 failed");

      await view.redoLastEdit();
      assert(ctrl.getContinuousExcerpt().count === 1 && store.cards[0].front === "第一段摘录", "B3 redo 1 failed");
      await view.redoLastEdit();
      assert(ctrl.getContinuousExcerpt().count === 2 && store.cards[0].front === "第一段摘录\\n\\n第二段", "B3 redo 2 failed");
      await view.redoLastEdit();
      assert(ctrl.getContinuousExcerpt().count === 3 && store.cards[0].front === "第一段摘录\\n\\n第二段\\n\\n第三段", "B3 redo 3 failed");
      assert(JSON.stringify(historySnapshot(store)) === JSON.stringify(hist0), "B3 history polluted");

      // continueExcerptInCard 保护旧卡
      ctrl.setContinuousExcerpt(false);
      const oldCardId = store.cards[0].id;
      const oldFront = store.cards[0].front;
      const oldNodeCount = store.nodes.length;
      assert(ctrl.continueExcerptInCard(oldCardId) === true, "B3 continueExcerptInCard failed");
      ctrl.commitAnnotation(mkTarget(480), "highlight", "#ffd54f", "追加旧卡内容");
      assert(store.cards[0].front === oldFront + "\\n\\n追加旧卡内容" && (await store.loadAnnotations(path)).length === 2, "B3 old-card append failed");
      await view.undoLastEdit();
      assert(store.cards.length === 1 && store.cards[0].id === oldCardId && store.cards[0].front === oldFront && store.nodes.length === oldNodeCount && (await store.loadAnnotations(path)).length === 1,
        "B3 undo continueExcerptInCard damaged old card");
      report.B3 = { stepsUndone: 3, stepsRedone: 3, oldCardPreserved: true, historyDelta: 0 };
    } finally { await view.onClose(); }
  }

  // ===== B4: 与笔迹 pen 交错严格 LIFO 保序 =====
  {
    const path = "b4-interleave.pdf";
    const { view, ctrl, store } = await openPdf(path, 1);
    try {
      const t1 = { kind: "pdf", pageNum: 1, rects: [{ x: 80, y: 600, w: 140, h: 18 }], pdfGeometry: [{ page: 1, rects: [{ x: 80, y: 600, w: 140, h: 18 }] }], pdfCoordinateSpace: "pdf" };
      const t2 = { kind: "pdf", pageNum: 1, rects: [{ x: 80, y: 520, w: 140, h: 18 }], pdfGeometry: [{ page: 1, rects: [{ x: 80, y: 520, w: 140, h: 18 }] }], pdfCoordinateSpace: "pdf" };
      ctrl.commitAnnotation(t1, "highlight", "#ffd54f", "首条高亮内容");
      ctrl.createPenAnnotation(1, [[{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }]]);
      ctrl.commitAnnotation(t2, "highlight", "#80cbc4", "第二条高亮内容");
      const activeIds = async () => (await store.loadAnnotations(path)).filter((a: any) => a.type !== "pen" || (a.strokes?.length ?? 0) > 0).map((a: any) => a.type);
      assert(JSON.stringify(await activeIds()) === JSON.stringify(["highlight", "pen", "highlight"]), "B4 initial order wrong");

      await view.undoLastEdit();
      assert(JSON.stringify(await activeIds()) === JSON.stringify(["highlight", "pen"]) && store.cards.length === 1, "B4 undo 1 (highlight C) failed");
      await view.undoLastEdit();
      assert(JSON.stringify(await activeIds()) === JSON.stringify(["highlight"]) && store.cards.length === 1, "B4 undo 2 (pen B) failed");
      await view.undoLastEdit();
      assert((await activeIds()).length === 0 && store.cards.length === 0 && store.nodes.length === 0, "B4 undo 3 (highlight A) failed");

      await view.redoLastEdit();
      assert(JSON.stringify(await activeIds()) === JSON.stringify(["highlight"]) && store.cards.length === 1, "B4 redo 1 failed");
      await view.redoLastEdit();
      assert(JSON.stringify(await activeIds()) === JSON.stringify(["highlight", "pen"]) && store.cards.length === 1, "B4 redo 2 failed");
      await view.redoLastEdit();
      assert(JSON.stringify(await activeIds()) === JSON.stringify(["highlight", "pen", "highlight"]) && store.cards.length === 2, "B4 redo 3 failed");
      report.B4 = { lifoVerified: true, finalCards: store.cards.length };
    } finally { await view.onClose(); }
  }

  // ===== B5: 伴生文档根节点共享保护 =====
  {
    const path = "b5-root.pdf";
    const { view, ctrl, store } = await openPdf(path, 1);
    try {
      const t1 = { kind: "pdf", pageNum: 1, rects: [{ x: 80, y: 600, w: 140, h: 18 }], pdfGeometry: [{ page: 1, rects: [{ x: 80, y: 600, w: 140, h: 18 }] }], pdfCoordinateSpace: "pdf" };
      const t2 = { kind: "pdf", pageNum: 1, rects: [{ x: 80, y: 540, w: 140, h: 18 }], pdfGeometry: [{ page: 1, rects: [{ x: 80, y: 540, w: 140, h: 18 }] }], pdfCoordinateSpace: "pdf" };
      ctrl.commitAnnotation(t1, "highlight", "#ffd54f", "文档根首条摘录");
      ctrl.commitAnnotation(t2, "highlight", "#ffd54f", "文档根次条摘录");
      assert(store.nodes.length === 3, "B5 expected root + 2 card nodes");
      await view.undoLastEdit();
      assert(store.nodes.length === 2 && store.cards.length === 1, "B5 undo 2nd should keep root + 1st node");
      await view.undoLastEdit();
      assert(store.nodes.length === 0 && store.cards.length === 0, "B5 undo 1st should remove empty root");
      report.B5 = { afterTwo: 3, afterUndoSecond: 2, afterUndoFirst: 0 };
    } finally { await view.onClose(); }
  }

  // ===== B6: 已编辑 / 已合并 / 有 FSRS 进度卡片绝不误删 =====
  {
    const cases: Record<string, any> = {};
    for (const kind of ["edited", "merged", "fsrs"] as const) {
      const path = \`b6-\${kind}.pdf\`;
      const { view, ctrl, store } = await openPdf(path, 1);
      try {
        const t = { kind: "pdf", pageNum: 1, rects: [{ x: 80, y: 600, w: 140, h: 18 }], pdfGeometry: [{ page: 1, rects: [{ x: 80, y: 600, w: 140, h: 18 }] }], pdfCoordinateSpace: "pdf" };
        ctrl.commitAnnotation(t, "highlight", "#ffd54f", \`受保护卡片\${kind}测试\`);
        const card = store.cards[0];
        const cardId = card.id;
        if (kind === "edited") {
          card.back = "用户手写笔记";
          card.tags = ["重点"];
        } else if (kind === "merged") {
          card.groupId = "merge-group-1";
        } else {
          store.srs[cardId] = { ease: 2.5, interval: 4, reps: 2, lapses: 0, due: "2026-12-01", lastReviewed: "2026-11-26" } as any;
        }
        await view.undoLastEdit();
        const annAfterUndoCount = (await store.loadAnnotations(path)).length;
        const liveCard = store.getCard(cardId);
        const cardNodeExists = store.nodes.some((n: any) => n.cardId === cardId);
        assert(annAfterUndoCount === 0, \`B6 \${kind}: annotation should still be undone\`);
        assert(!!liveCard && cardNodeExists, \`B6 \${kind}: protected card or node was deleted!\`);
        if (kind === "fsrs") assert(store.srs[cardId]?.reps === 2, "B6 fsrs state was deleted!");
        await view.redoLastEdit();
        const annsRedo = await store.loadAnnotations(path);
        assert(annsRedo.length === 1 && annsRedo[0].cardId === cardId && store.getCard(cardId)?.anchorAnnId === annsRedo[0].id,
          \`B6 \${kind}: redo did not relink protected card\`);
        cases[kind] = { annAfterUndo: annAfterUndoCount, cardPreserved: !!liveCard, nodePreserved: cardNodeExists };
      } finally { await view.onClose(); }
    }
    report.B6 = cases;
  }

  // ===== B7: 跨视图并发修改拒绝覆盖并清空撤销栈 =====
  {
    const path = "b7-concurrency.pdf";
    const { view, ctrl, store } = await openPdf(path, 1);
    try {
      const t = { kind: "pdf", pageNum: 1, rects: [{ x: 80, y: 600, w: 140, h: 18 }], pdfGeometry: [{ page: 1, rects: [{ x: 80, y: 600, w: 140, h: 18 }] }], pdfCoordinateSpace: "pdf" };
      ctrl.commitAnnotation(t, "highlight", "#ffd54f", "并发修改测试内容");
      const anns = await store.loadAnnotations(path);
      anns[0].text = "外部视图已修改";
      anns[0].color = "#ff8a80";
      await view.undoLastEdit();
      const after = await store.loadAnnotations(path);
      assert(after.length === 1 && after[0].text === "外部视图已修改" && !view.getEditHistoryState().canUndo && !view.getEditHistoryState().canRedo,
        "B7 concurrent modification was overwritten or history not cleared");
      report.B7 = { externalEditPreserved: true, historyCleared: true };
    } finally { await view.onClose(); }
  }

  // ===== B8: 手动 makeCard 合并为单条 store.history 事务 =====
  {
    const path = "b8-manual-card.pdf";
    const { view, ctrl, store } = await openPdf(path, 1);
    try {
      store.settings.autoCardOnHighlight = false;
      const t = { kind: "pdf", pageNum: 1, rects: [{ x: 80, y: 600, w: 140, h: 18 }], pdfGeometry: [{ page: 1, rects: [{ x: 80, y: 600, w: 140, h: 18 }] }], pdfCoordinateSpace: "pdf" };
      ctrl.commitAnnotation(t, "highlight", "#ffd54f", "手动建卡单事务测试");
      const ann = (await store.loadAnnotations(path))[0];
      const beforeHist = historySnapshot(store);
      ctrl.makeCard(ann, "excerpt");
      const afterHist = historySnapshot(store);
      assert(afterHist.len - beforeHist.len === 1 && afterHist.revision - beforeHist.revision === 1,
        \`B8 manual makeCard created \${afterHist.len - beforeHist.len} history entries instead of 1\`);
      assert(store.cards.length === 1 && store.nodes.length === 2, "B8 manual makeCard missing card/nodes");
      assert(store.undoLibraryChange() === true, "B8 undoLibraryChange failed");
      assert(store.cards.length === 0 && store.nodes.length === 0, "B8 1x library undo did not remove card and nodes");
      report.B8 = { historyAdded: 1, undoneInOneStep: true };
    } finally { await view.onClose(); }
  }

  // ===== B9: 撤销连续摘录后编辑卡片再重做（两条路径）不得覆盖用户编辑 + autoReview 原子撤重 =====
  {
    const mkTarget = (y: number) => ({ kind: "pdf", pageNum: 1, rects: [{ x: 80, y, w: 150, h: 18 }], pdfGeometry: [{ page: 1, rects: [{ x: 80, y, w: 150, h: 18 }] }], pdfCoordinateSpace: "pdf" });
    // Path 1: same-session append -> undo -> edit card front & sources -> redo refused, user edit preserved
    const path1 = "b9-same-session-redo.pdf";
    const env1 = await openPdf(path1, 1);
    try {
      env1.ctrl.setContinuousExcerpt(true);
      env1.ctrl.commitAnnotation(mkTarget(600), "highlight", "#ffd54f", "摘录原文内容");
      env1.ctrl.commitAnnotation(mkTarget(560), "highlight", "#ffd54f", "将被撤回的追加");
      await env1.view.undoLastEdit();
      const card1 = env1.store.cards[0];
      const extSource = { docPath: "external.pdf", page: 9, text: "外部来源片段" };
      env1.store.updateCard(card1.id, { front: "卡片视图写入的独立正文", sources: [...(card1.sources ?? []), extSource] });
      await env1.view.redoLastEdit();
      const live1 = env1.store.getCard(card1.id)!;
      assert(live1.front === "卡片视图写入的独立正文" && live1.sources?.some((s: any) => s.docPath === "external.pdf"),
        "B9 path1 redo overwrote user-edited card: " + JSON.stringify({ front: live1.front, sources: live1.sources }));
      assert(!env1.view.getEditHistoryState().canRedo, "B9 path1 redo stack not cleared on conflict");
    } finally { await env1.view.onClose(); }

    // Path 2: continueExcerptInCard -> undo -> edit card front & sources -> redo refused, user edit preserved
    const path2 = "b9-old-card-redo.pdf";
    const env2 = await openPdf(path2, 1);
    try {
      env2.ctrl.commitAnnotation(mkTarget(600), "highlight", "#ffd54f", "旧卡原始摘录");
      const oldCardId = env2.store.cards[0].id;
      assert(env2.ctrl.continueExcerptInCard(oldCardId) === true, "B9 path2 continueExcerptInCard failed");
      env2.ctrl.commitAnnotation(mkTarget(560), "highlight", "#ffd54f", "追加到旧卡的片段");
      await env2.view.undoLastEdit();
      const card2 = env2.store.getCard(oldCardId)!;
      const extSource2 = { docPath: "external-2.pdf", page: 3, text: "旧卡外部来源" };
      env2.store.updateCard(card2.id, { front: "旧卡独立编辑正文", sources: [...(card2.sources ?? []), extSource2] });
      await env2.view.redoLastEdit();
      const live2 = env2.store.getCard(oldCardId)!;
      assert(live2.front === "旧卡独立编辑正文" && live2.sources?.some((s: any) => s.docPath === "external-2.pdf"),
        "B9 path2 redo overwrote user-edited old card: " + JSON.stringify({ front: live2.front, sources: live2.sources }));
      assert((await env2.store.loadAnnotations(path2)).length === 1, "B9 path2 redo recreated conflicting annotation");
    } finally { await env2.view.onClose(); }

    // Path 1b & 2b: unmodified card redo MUST still 100% restore (same-session + old-card)
    const path1b = "b9-unmodified-redo.pdf";
    const env1b = await openPdf(path1b, 1);
    try {
      env1b.ctrl.setContinuousExcerpt(true);
      env1b.ctrl.commitAnnotation(mkTarget(600), "highlight", "#ffd54f", "未改卡片原文");
      env1b.ctrl.commitAnnotation(mkTarget(560), "highlight", "#ffd54f", "未改卡片追加");
      const snapAfterAppend = {
        front: env1b.store.cards[0].front,
        sources: structuredClone(env1b.store.cards[0].sources),
        count: env1b.ctrl.getContinuousExcerpt().count,
      };
      await env1b.view.undoLastEdit();
      assert(env1b.store.cards[0].front === "未改卡片原文", "B9 unmodified same-session undo failed");
      await env1b.view.redoLastEdit();
      assert(env1b.store.cards[0].front === snapAfterAppend.front
        && JSON.stringify(env1b.store.cards[0].sources) === JSON.stringify(snapAfterAppend.sources)
        && env1b.ctrl.getContinuousExcerpt().count === snapAfterAppend.count,
        "B9 unmodified same-session redo did not 100% restore");
    } finally { await env1b.view.onClose(); }

    const path2b = "b9-unmodified-old-card-redo.pdf";
    const env2b = await openPdf(path2b, 1);
    try {
      env2b.ctrl.commitAnnotation(mkTarget(600), "highlight", "#ffd54f", "未改旧卡原文");
      const oldId = env2b.store.cards[0].id;
      assert(env2b.ctrl.continueExcerptInCard(oldId) === true, "B9 path2b continueExcerptInCard failed");
      env2b.ctrl.commitAnnotation(mkTarget(560), "highlight", "#ffd54f", "未改旧卡追加");
      const snap2b = {
        front: env2b.store.getCard(oldId)!.front,
        sources: structuredClone(env2b.store.getCard(oldId)!.sources),
        anns: (await env2b.store.loadAnnotations(path2b)).length,
      };
      await env2b.view.undoLastEdit();
      assert(env2b.store.getCard(oldId)!.front === "未改旧卡原文" && (await env2b.store.loadAnnotations(path2b)).length === 1,
        "B9 unmodified old-card undo failed");
      await env2b.view.redoLastEdit();
      assert(env2b.store.getCard(oldId)!.front === snap2b.front
        && JSON.stringify(env2b.store.getCard(oldId)!.sources) === JSON.stringify(snap2b.sources)
        && (await env2b.store.loadAnnotations(path2b)).length === snap2b.anns,
        "B9 unmodified old-card redo did not 100% restore");
    } finally { await env2b.view.onClose(); }

    // autoReview=true: brand-new auto-enqueued card must still undo cleanly to 0/0/0/0 and redo back to 1/1/2/1
    const path3 = "b9-auto-review.pdf";
    const env3 = await openPdf(path3, 1);
    try {
      const set3 = env3.store.createStudySet("自动复习集", [path3]);
      const deck = env3.store.createReviewDeck("自动复习测试卡组", set3.id);
      env3.store.settings.autoReview = true;
      env3.ctrl.commitAnnotation(mkTarget(600), "highlight", "#ffd54f", "自动复习入队撤重测试");
      assert((await env3.store.loadAnnotations(path3)).length === 1 && env3.store.cards.length === 1
        && env3.store.nodes.length === 2 && env3.store.reviewPending.length === 1
        && Object.keys(env3.store.srs).length === 1 && env3.store.reviewLogs.length === 1
        && env3.store.getReviewDeck(deck.id)!.cardIds.length === 1,
        "B9 autoReview initial create failed");
      await env3.view.undoLastEdit();
      assert((await env3.store.loadAnnotations(path3)).length === 0 && env3.store.cards.length === 0
        && env3.store.nodes.length === 0 && env3.store.reviewPending.length === 0
        && Object.keys(env3.store.srs).length === 0 && env3.store.reviewLogs.length === 0
        && env3.store.getReviewDeck(deck.id)!.cardIds.length === 0,
        "B9 autoReview undo left remnants");
      await env3.view.redoLastEdit();
      assert((await env3.store.loadAnnotations(path3)).length === 1 && env3.store.cards.length === 1
        && env3.store.nodes.length === 2 && env3.store.reviewPending.length === 1
        && Object.keys(env3.store.srs).length === 1 && env3.store.reviewLogs.length === 1
        && env3.store.getReviewDeck(deck.id)!.cardIds.length === 1,
        "B9 autoReview redo failed");
      // Real user review after auto-enqueue MUST still trigger review protection
      const reviewedCardId = env3.store.cards[0].id;
      env3.store.gradeCard(reviewedCardId, 3, { deckId: deck.id, now: new Date("2026-04-06T10:00:00Z") });
      await env3.view.undoLastEdit();
      assert((await env3.store.loadAnnotations(path3)).length === 0 && env3.store.cards.length === 1
        && env3.store.nodes.length === 2 && env3.store.reviewPending.length === 1,
        "B9 autoReview real user review was not protected on undo");
    } finally { await env3.view.onClose(); }

    // autoReview=false: undo/redo quad 1/1/2/0 -> 0/0/0/0 -> 1/1/2/0
    const path4 = "b9-no-auto-review.pdf";
    const env4 = await openPdf(path4, 1);
    try {
      const set4 = env4.store.createStudySet("非自动复习集", [path4]);
      env4.store.createReviewDeck("非自动复习卡组", set4.id);
      env4.store.settings.autoReview = false;
      env4.ctrl.commitAnnotation(mkTarget(600), "highlight", "#ffd54f", "关闭自动复习撤重测试");
      assert((await env4.store.loadAnnotations(path4)).length === 1 && env4.store.cards.length === 1
        && env4.store.nodes.length === 2 && env4.store.reviewPending.length === 0,
        "B9 autoReview=false create failed");
      await env4.view.undoLastEdit();
      assert((await env4.store.loadAnnotations(path4)).length === 0 && env4.store.cards.length === 0
        && env4.store.nodes.length === 0 && env4.store.reviewPending.length === 0,
        "B9 autoReview=false undo failed");
      await env4.view.redoLastEdit();
      assert((await env4.store.loadAnnotations(path4)).length === 1 && env4.store.cards.length === 1
        && env4.store.nodes.length === 2 && env4.store.reviewPending.length === 0,
        "B9 autoReview=false redo failed");
    } finally { await env4.view.onClose(); }

    report.B9 = {
      sameSessionRedoProtected: true,
      oldCardRedoProtected: true,
      unmodifiedRedoRestored: true,
      autoReviewAtomicUndoRedo: true,
      autoReviewRealProgressProtected: true,
      noAutoReviewAtomicUndoRedo: true,
    };
  }

  // ===== B10: 跨文档合并组员撤重后保留组首来源锚点、组员原锚点与解除合并归属 =====
  {
    const docA = "b10-member.pdf";
    const docB = "b10-head.pdf";
    const mkRect = (y: number) => ({ kind: "pdf", pageNum: 1, rects: [{ x: 80, y, w: 150, h: 18 }], pdfGeometry: [{ page: 1, rects: [{ x: 80, y, w: 150, h: 18 }] }], pdfCoordinateSpace: "pdf" });
    fixturesHost.replaceChildren();
    const env = makeEnv({ [docA]: { name: docA, pages: 1 }, [docB]: { name: docB, pages: 1 } });
    await env.store.load();
    const openDoc = async (docPath: string) => {
      const leaf: any = { app: env.app, view: null, containerEl: document.createElement("div") };
      const view = new ReaderView(leaf, env.plugin);
      leaf.view = view;
      view.containerEl.style.cssText = "position:relative;width:820px;height:760px;";
      fixturesHost.append(view.containerEl);
      await view.onOpen();
      await view.loadFileByPath(docPath);
      view.setScale(1);
      await view.renderPage(1);
      await frame();
      return { view, ctrl: (view as any).annController };
    };
    const rA = await openDoc(docA);
    const rB = await openDoc(docB);
    try {
      rB.ctrl.commitAnnotation(mkRect(600), "highlight", "#ffd54f", "组首文档摘录");
      const headId = env.store.cards[0].id;
      const headAnnId = (await env.store.loadAnnotations(docB))[0].id;
      rA.ctrl.commitAnnotation(mkRect(560), "highlight", "#ffd54f", "组员文档摘录");
      const memberId = env.store.cards[1].id;
      const memberAnnId = (await env.store.loadAnnotations(docA))[0].id;
      env.store.mergeCards(headId, [memberId]);
      await env.store.flush();
      assert((await env.store.loadAnnotations(docA))[0].cardId === headId, "B10 setup member ann not bound to head");
      await rA.view.undoLastEdit();
      await env.store.flush();
      assert((await env.store.loadAnnotations(docA)).length === 0, "B10 undo did not remove member ann");
      assert(!env.store.getCard(memberId)?.anchorAnnId, "B10 undo left member anchorAnnId");
      assert(!env.store.getCard(headId)?.sources?.find((s: any) => s.docPath === docA)?.anchorAnnId, "B10 undo left head source anchorAnnId");
      await rA.view.redoLastEdit();
      await env.store.flush();
      const redoneAnn = (await env.store.loadAnnotations(docA))[0];
      const redoneHead = env.store.getCard(headId)!;
      const redoneMember = env.store.getCard(memberId)!;
      assert(redoneAnn?.id === memberAnnId && redoneAnn?.cardId === headId, "B10 redo member ann binding wrong");
      assert(redoneHead.anchorAnnId === headAnnId, "B10 redo overwrote head own anchorAnnId");
      assert(redoneHead.sources?.find((s: any) => s.docPath === docA)?.anchorAnnId === memberAnnId, "B10 redo missing head source anchorAnnId");
      assert(redoneMember.anchorAnnId === memberAnnId, "B10 redo missing member anchorAnnId");
      env.store.unmergeCard(headId);
      await env.store.flush();
      const unmergedAnnA = (await env.store.loadAnnotations(docA))[0];
      const unmergedAnnB = (await env.store.loadAnnotations(docB))[0];
      assert(unmergedAnnA?.cardId === memberId && env.store.getCard(memberId)?.anchorAnnId === memberAnnId && unmergedAnnB?.cardId === headId,
        "B10 unmerge did not restore member annotation ownership");
      report.B10 = { crossDocMergeMemberRedoAndUnmerge: true };
    } finally {
      await rA.view.onClose();
      await rB.view.onClose();
    }
  }

  return report;
};

(window as any).getErrors = () => errors;
(window as any).ready = true;
`;

try {
  for (const name of ["obsidian", "fakePdf", "fakeMammoth"]) {
    let src = (await readFile(join(docFixtures, name + ".txt"), "utf8")).replaceAll("__PROJECT__", () => project);
    if (name === "obsidian") {
      if (!src.includes("requestUrl")) src += "\nexport async function requestUrl(){throw new Error('offline');}\n";
      src += "\nif (!(ItemView.prototype as any).registerEvent) (ItemView.prototype as any).registerEvent = function(){};\n";
      src += "if (!(ItemView.prototype as any).registerDomEvent) (ItemView.prototype as any).registerDomEvent = function(el:any,ev:any,cb:any){el?.addEventListener?.(ev,cb);};\n";
      src += "if (!(ItemView.prototype as any).load) (ItemView.prototype as any).load = function(){};\n";
      src += "if (!(ItemView.prototype as any).register) (ItemView.prototype as any).register = function(){};\n";
    }
    await writeFile(join(temporary, name + ".ts"), src);
  }
  await writeFile(join(temporary, "unused-network.ts"), "export function request(){throw new Error('offline');}");
  await writeFile(join(temporary, "crypto.ts"), "export function createHash(){return{update(){return this;},digest(){return '0000000000000000';}};}");
  await writeFile(join(temporary, "annot-undo-fixture.ts"), fixtureSource);

  const styles = await Promise.all([
    "src/styles/styles-base.css",
    "src/styles/styles-reader.css",
    "src/styles/styles-mindmap.css",
    "src/styles/styles-organize.css",
    "src/styles/styles-workspace.css",
  ].map(name => readFile(join(project, name), "utf8")));
  await writeFile(join(temporary, "styles.css"), styles.join("\n"));
  await writeFile(
    join(temporary, "index.html"),
    '<!doctype html><meta charset="utf-8"><title>MarginStudy ANNOT-02 undo atomicity acceptance</title><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0;height:100%}#fixtures{position:relative;width:100vw;height:100vh;overflow:auto}</style><main id="fixtures"></main><script type="module" src="/fixture.js"></script>',
  );

  await build({
    entryPoints: [join(temporary, "annot-undo-fixture.ts")],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "chrome120",
    outfile: join(temporary, "fixture.js"),
    plugins: [{
      name: "annot-undo-adapters",
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: join(temporary, "obsidian.ts") }));
        builder.onResolve({ filter: /^crypto$/ }, () => ({ path: join(temporary, "crypto.ts") }));
        builder.onResolve({ filter: /^(?:http|https)$/ }, () => ({ path: join(temporary, "unused-network.ts") }));
        builder.onResolve({ filter: /^mammoth$/ }, () => ({ path: join(temporary, "fakeMammoth.ts") }));
        builder.onResolve({ filter: /\/pdfjs$/ }, () => ({ path: join(temporary, "fakePdf.ts") }));
      },
    }],
  });

  const allowed = new Set(["index.html", "fixture.js", "styles.css"]);
  const server = createServer(async (req, res) => {
    const name = new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
    if (!allowed.has(name)) { res.statusCode = 404; res.end(); return; }
    res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
    res.end(await readFile(join(temporary, name)));
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const session = `marginstudy-annot-undo-${process.pid}`;
  const browser = (...args) => runBrowser(session, ...args);

  try {
    await browser("open", "about:blank");
    await browser("set", "viewport", "1280", "960");
    await browser("open", `http://127.0.0.1:${server.address().port}`);
    await browser("wait", "--fn", "window.ready === true");
    const result = JSON.parse((await browser("eval", "window.runAll()")).stdout);
    const errs = JSON.parse((await browser("eval", "window.getErrors()")).stdout);
    if (errs.length) throw new Error("Unhandled browser errors: " + JSON.stringify(errs));
    console.log("PASS annot-undo-atomicity:", JSON.stringify(result));
  } finally {
    await browser("close").catch(() => {});
    await new Promise(done => server.close(done));
  }
} finally {
  await rm(temporary, { recursive: true, force: true }).catch(() => {});
}
