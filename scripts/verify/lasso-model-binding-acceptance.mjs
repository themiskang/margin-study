/**
 * [INPUT]: 依赖 export-roundtrip/fixture-support、pdf-content、PenController 与 AnnotationController，零私有夹具依赖。
 * [OUTPUT]: 无头验证 G8-04 解绑保全、G8-05 四层隔离与双视图并发 penRevision、G8-06 复合撤重与导出 PDF 同步。
 * [POS]: 公开验收套件 lasso-model-binding，固化 GAP-08 模型层与并发护栏二值断言。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import {
  docPath, height, imageOverlay, layers, pen, readerFixture, referenceLayer, run, seededVault, width,
} from "./annotation-refs/export-roundtrip/fixture-support.mjs";
import { readPagePaint } from "./annotation-refs/export-roundtrip/pdf-content.mjs";

const evidenceDir = process.env.MARGINSTUDY_EVIDENCE_DIR ? resolve(process.env.MARGINSTUDY_EVIDENCE_DIR, "gap-08") : null;
async function mergeEvidence(filename, sectionKey, payload) {
  if (!evidenceDir) return;
  await mkdir(evidenceDir, { recursive: true });
  const target = join(evidenceDir, filename);
  let existing = {};
  try { existing = JSON.parse(await readFile(target, "utf8")); } catch { /* new file */ }
  existing[sectionKey] = payload;
  await writeFile(target, JSON.stringify(existing, null, 2) + "\n");
}

function strokeDiff(a, b) {
  if (a.length !== b.length) return Infinity;
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return Infinity;
    for (let j = 0; j < a[i].length; j++) {
      max = Math.max(max, Math.abs(a[i][j].x - b[i][j].x), Math.abs(a[i][j].y - b[i][j].y));
    }
  }
  return max;
}

await run("GAP-08-MODEL", async (api, check) => {
  // ===== G8-04: 文档侧绑定宿主笔迹解绑保全与原子撤重 =====
  {
    const hostA = imageOverlay("host-a", 80, 100, { inkLayerId: "default" });
    const hostB = imageOverlay("host-b", 220, 100, { inkLayerId: "default" });
    const penA = pen("pen-a", "#1e88e5", [[100, 130], [160, 130]], { inkLayerId: "default", hostAnnotationId: "host-a" });
    const penB = pen("pen-b", "#e53935", [[240, 130], [300, 130]], { inkLayerId: "default", hostAnnotationId: "host-b" });
    const vault = await seededVault(api, [hostA, hostB, penA, penB]);
    vault.store.addCard({
      id: "card-pen-a", docPath, type: "excerpt", color: "#1e88e5",
      front: "[手写批注]", links: [], tags: [], anchorAnnId: "pen-a", page: 1, createdAt: "2026-11-24",
    });
    const reader = await readerFixture(api, vault.plugin);
    const ctrl = reader.controller;
    const find = id => reader.model().find(a => a.id === id);

    // 1. 显式解绑 -> 坐标误差 <= 1e-6, ann.id/card不变, 移动/缩放/删除原宿主不影响该笔迹
    const beforeUnbindStrokes = structuredClone(find("pen-a").strokes);
    const unbound = ctrl.bindInkToHost("pen-a", undefined);
    check("G8-04 explicit unbind returns true", unbound, true);
    check("G8-04 explicit unbind clears hostAnnotationId", find("pen-a").hostAnnotationId, undefined);
    check("G8-04 explicit unbind preserves strokes <= 1e-6", strokeDiff(find("pen-a").strokes, beforeUnbindStrokes) <= 1e-6, true);
    check("G8-04 explicit unbind preserves card anchorAnnId", vault.store.getCard("card-pen-a")?.anchorAnnId, "pen-a");

    // Undo 显式解绑 -> 恢复 hostAnnotationId；Redo -> 再解绑
    ctrl.undoPenChange();
    check("G8-04 undo explicit unbind restores hostAnnotationId", find("pen-a").hostAnnotationId, "host-a");
    ctrl.redoPenChange();
    check("G8-04 redo explicit unbind clears hostAnnotationId again", find("pen-a").hostAnnotationId, undefined);

    // 移动 & 缩放 hostA，已解绑的 penA 必须零变化
    reader.gesture("host-a", "move", 40, 30);
    reader.gesture("host-a", "resize", 30, 20);
    check("G8-04 move/resize host after unbind leaves pen-a unchanged", strokeDiff(find("pen-a").strokes, beforeUnbindStrokes) === 0, true);

    // 重新绑定（或 Undo 回到绑定态）再移宿主，验证重新跟随；随后再次显式解绑并删除原宿主
    ctrl.undoOverlayChange();
    ctrl.undoOverlayChange();
    ctrl.undoPenChange();
    check("G8-04 second undo restores host-a before follow check", find("pen-a").hostAnnotationId, "host-a");
    reader.gesture("host-a", "move", 20, 10);
    check("G8-04 after undo unbind, moving host moves pen-a again", strokeDiff(find("pen-a").strokes, beforeUnbindStrokes) > 0.01, true);
    const afterFollowStrokes = structuredClone(find("pen-a").strokes);
    ctrl.bindInkToHost("pen-a", undefined);
    const hostACurrent = ctrl.cache.find(a => a.id === "host-a");
    ctrl.deleteAnn(hostACurrent);
    check("G8-04 delete host after unbind preserves pen-a", !!find("pen-a") && strokeDiff(find("pen-a").strokes, afterFollowStrokes) === 0, true);

    // 2. 框内平移保留 hostAnnotationId vs 拖出宿主外自动解绑（原子 1 次 Undo/Redo）
    const penB0 = structuredClone(find("pen-b").strokes);
    const inBoxMoved = penB0.map(s => s.map(p => ({ ...p, x: p.x + 0.01, y: p.y + 0.01 })));
    ctrl.beginPenGesture();
    ctrl.commitPenChanges([{ id: "pen-b", before: penB0, after: inBoxMoved }]);
    check("G8-04 move inside host preserves hostAnnotationId", find("pen-b").hostAnnotationId, "host-b");

    const outBoxMoved = inBoxMoved.map(s => s.map(p => ({ ...p, x: p.x - 0.4, y: p.y + 0.3 })));
    ctrl.beginPenGesture();
    ctrl.commitPenChanges([{ id: "pen-b", before: inBoxMoved, after: outBoxMoved }]);
    check("G8-04 drag out of host auto-unbinds hostAnnotationId", find("pen-b").hostAnnotationId, undefined);
    ctrl.undoPenChange();
    check("G8-04 1x undo drag-out restores position and hostAnnotationId atomically",
      find("pen-b").hostAnnotationId === "host-b" && strokeDiff(find("pen-b").strokes, inBoxMoved) <= 1e-6, true);
    ctrl.redoPenChange();
    check("G8-04 1x redo drag-out moves out and unbinds atomically",
      find("pen-b").hostAnnotationId === undefined && strokeDiff(find("pen-b").strokes, outBoxMoved) <= 1e-6, true);

    // 3. 套索删除绑定笔迹不删宿主，Undo 恢复笔迹与 hostAnnotationId
    ctrl.undoPenChange(); // 回到绑定态
    const boundBeforeDel = structuredClone(find("pen-b").strokes);
    ctrl.beginPenGesture();
    ctrl.commitPenChanges([{ id: "pen-b", before: boundBeforeDel, after: [] }]);
    check("G8-04 lasso delete bound pen keeps host-b alive", !!find("host-b") && !find("host-b").overlay?.deleted, true);
    check("G8-04 lasso delete bound pen clears strokes but retains record", find("pen-b").strokes.length, 0);
    ctrl.undoPenChange();
    check("G8-04 undo delete restores strokes and hostAnnotationId",
      find("pen-b").hostAnnotationId === "host-b" && strokeDiff(find("pen-b").strokes, boundBeforeDel) <= 1e-6, true);

    await vault.store.flush();
    await mergeEvidence("g8-04-unbind-preservation.json", "headless", {
      passed: true,
      explicitUnbind: true,
      hostMoveResizeDeletePreserved: true,
      undoRedoExplicitUnbind: true,
      insideMoveKeptBound: true,
      outsideDragAutoUnboundAtomicUndoRedo: true,
      deleteBoundKeptHostAndRestoredOnUndo: true,
    });
  }

  // ===== G8-05: 四层重叠隔离 + 双分屏并发 penRevision 拒绝 =====
  {
    const activePen = pen("pen-active", "#112233", [[80, 120], [180, 120]], { inkLayerId: "default", documentNotebookId: "default" });
    const refLayerPen = pen("pen-ref-layer", "#445566", [[80, 125], [180, 125]], { inkLayerId: referenceLayer, documentNotebookId: "default" });
    const refNbPen = pen("pen-ref-nb", "#778899", [[80, 130], [180, 130]], { inkLayerId: "default", documentNotebookId: "nb-ref" });
    const orphanPen = pen("pen-orphan", "#aabbcc", [[80, 135], [180, 135]], { inkLayerId: "deleted-layer-404", documentNotebookId: "default" });
    const vault = await seededVault(api, [activePen, refLayerPen, refNbPen, orphanPen]);
    vault.store.updateDocMeta(docPath, {
      handwritingLayers: layers,
      activeHandwritingLayerId: "default",
      overlayHandwritingLayerId: referenceLayer,
      documentNotebooks: [{ id: "default", name: "Default" }, { id: "nb-ref", name: "RefNB" }],
      activeDocumentNotebookId: "default",
      overlayDocumentNotebookId: "nb-ref",
    });
    const viewA = await readerFixture(api, vault.plugin);
    const viewB = await readerFixture(api, vault.plugin);
    const ctrlA = viewA.controller, ctrlB = viewB.controller;

    // 检查 getPenRecords 只返回活跃层笔迹（排除参考层、参考笔记本、孤儿层）
    const recordsA = ctrlA.getPenRecords(1);
    check("G8-05 getPenRecords isolates only active layer pen", recordsA.map(r => r.id), ["pen-active"]);

    const snapshotProtected = () => [refLayerPen.id, refNbPen.id, orphanPen.id].map(id =>
      structuredClone(viewA.model().find(a => a.id === id))
    );
    const protectedBefore = snapshotProtected();

    // 在 viewA 对可圈选的记录执行改色/平移/删除
    ctrlA.penMode = true;
    ctrlA.penTool = "select";
    ctrlA.beginPenGesture();
    const s0 = structuredClone(recordsA[0].strokes);
    const s1 = s0.map(st => st.map(p => ({ ...p, x: p.x + 0.05 })));
    ctrlA.commitPenChanges([{ id: "pen-active", before: s0, after: s1, color: { before: "#112233", after: "#e53935" } }]);
    const protectedAfter = snapshotProtected();
    check("G8-05 reference layer, reference notebook, orphan layer byte-identical", isDeepStrictEqual(protectedAfter, protectedBefore), true);

    // 并发冲突：viewA 改色 (R0 -> R1，保持选区 penRevision = R1) -> viewB 写入 (R1 -> R2) -> viewA 同选区再操作被 100% 拒绝
    const r1 = vault.store.getAnnotationsRevision(docPath);
    await viewB.controller.loadForDoc(docPath);
    ctrlB.beginPenGesture();
    const bStroke = structuredClone(viewB.model().find(a => a.id === "pen-active").strokes);
    ctrlB.commitPenChanges([{ id: "pen-active", before: bStroke, after: bStroke, color: { before: "#e53935", after: "#43a047" } }]);
    const r2 = vault.store.getAnnotationsRevision(docPath);
    check("G8-05 viewB advanced revision", r2 > r1, true);

    // viewA 同选区二次改色（模拟点击工具条颜色）
    ctrlA.ensurePenRevision();
    ctrlA.commitPenChanges([{ id: "pen-active", before: s1, after: s1, color: { before: "#e53935", after: "#1e88e5" } }]);
    await vault.store.flush();
    const afterStaleColor = (await vault.store.loadAnnotations(docPath)).find(a => a.id === "pen-active");
    check("G8-05 stale toolbar color rejected, viewB data preserved", afterStaleColor.color, "#43a047");
    check("G8-05 stale toolbar color clears viewA edit history (canUndo===false)", ctrlA.getEditHistoryState().canUndo, false);

    // 同理验证同选区再点删除/粘贴也被拒绝
    await ctrlA.loadForDoc(docPath);
    ctrlA.penMode = true; ctrlA.penTool = "select";
    ctrlA.beginPenGesture();
    const curS = structuredClone(viewA.model().find(a => a.id === "pen-active").strokes);
    ctrlA.commitPenChanges([{ id: "pen-active", before: curS, after: curS, color: { before: "#43a047", after: "#000000" } }]);
    // viewB 再次写入
    await ctrlB.loadForDoc(docPath);
    ctrlB.beginPenGesture();
    ctrlB.commitPenChanges([{ id: "pen-active", before: curS, after: curS, color: { before: "#000000", after: "#ffd54f" } }]);
    // viewA 尝试粘贴（模拟直接 Ctrl/Cmd+V）
    ctrlA.ensurePenRevision();
    ctrlA.pushPastedPenAnnotations([pen("pen-stale-paste", "#000000", [[10, 10], [20, 20]])]);
    await vault.store.flush();
    const afterStalePaste = await vault.store.loadAnnotations(docPath);
    check("G8-05 stale paste rejected, no new pen written", afterStalePaste.some(a => a.id === "pen-stale-paste"), false);
    check("G8-05 viewB yellow color intact after stale paste", afterStalePaste.find(a => a.id === "pen-active").color, "#ffd54f");
    check("G8-05 viewA canUndo===false after stale paste", ctrlA.getEditHistoryState().canUndo, false);

    await mergeEvidence("g8-05-isolation-and-concurrency.json", "headless", {
      passed: true,
      isolatedActiveIds: recordsA.map(r => r.id),
      protectedThreeClassesZeroDiff: true,
      staleColorRejected: true,
      stalePasteRejected: true,
      viewBPreserved: true,
      viewACanUndoFalse: true,
    });
  }

  // ===== G8-06: 复合流程逐次全 Undo -> 全 Redo + PDF 导出流解包比对 =====
  {
    const host = imageOverlay("host-compound", 60, 80, { inkLayerId: "default" });
    const vault = await seededVault(api, [host]);
    vault.plugin.refreshSidebar = () => {};
    vault.plugin.refreshMindmap = () => {};
    const reader = await readerFixture(api, vault.plugin);
    const ctrl = reader.controller;
    ctrl.showExcerptMenu = () => {};
    ctrl.penMode = true; ctrl.penTool = "select";
    const origSync = ctrl.syncInkRaster.bind(ctrl);
    ctrl.syncInkRaster = (...args) => {
      const res = origSync(...args);
      const raster = ctrl.inkRasters?.get(1)?.canvas;
      const ctx = raster?.getContext?.("2d");
      if (ctx && !ctx.rect) { ctx.rect = () => {}; ctx.clip = () => {}; }
      return res;
    };
    ctrl.syncInkRaster(1);

    const snap = () => structuredClone(reader.model()).map(({ createdAt, ...rest }) => rest);
    const states = [snap()];

    // Step 1: 画笔（落在宿主内自动绑定）
    ctrl.beginPenGesture();
    const drawn = pen("pen-compound", "#112233", [[80, 110], [140, 110]], { inkLayerId: "default", hostAnnotationId: "host-compound" });
    ctrl.pushAnnotation(drawn);
    states.push(snap());

    // Step 2: 套索框内平移
    const st1 = structuredClone(reader.model().find(a => a.id === "pen-compound").strokes);
    const st2 = st1.map(s => s.map(p => ({ ...p, x: p.x + 0.02, y: p.y + 0.02 })));
    ctrl.commitPenChanges([{ id: "pen-compound", before: st1, after: st2 }]);
    states.push(snap());

    // Step 3: 改色
    ctrl.commitPenChanges([{ id: "pen-compound", before: st2, after: st2, color: { before: "#112233", after: "#1e88e5" } }]);
    states.push(snap());

    // Step 4: 复制粘贴（单次 Undo）
    const pasted = pen("pen-pasted", "#1e88e5", [[100, 140], [160, 140]], { inkLayerId: "default" });
    ctrl.pushPastedPenAnnotations([pasted]);
    states.push(snap());

    // Step 5: 显式解绑
    ctrl.unbindInkAnnotations(["pen-compound"]);
    states.push(snap());

    // Step 6: 转摘录 (commitRegion)
    ctrl.commitRegion({ kind: "pdf", pageNum: 1, rects: [{ x: 80, y: 350, w: 60, h: 40 }], pdfCoordinateSpace: "pdf" }, "data:image/png;base64,iVBORw0KGgo=", "");
    states.push(snap());

    // Step 7: 剪切（删除粘贴的笔迹）
    const pastedBeforeCut = structuredClone(reader.model().find(a => a.id === "pen-pasted").strokes);
    ctrl.commitPenChanges([{ id: "pen-pasted", before: pastedBeforeCut, after: [] }]);
    states.push(snap());

    // Step 8: 删除原笔迹
    const compBeforeDel = structuredClone(reader.model().find(a => a.id === "pen-compound").strokes);
    ctrl.commitPenChanges([{ id: "pen-compound", before: compBeforeDel, after: [] }]);
    states.push(snap());

    // 逐次全 Undo 回到初始态
    for (let i = states.length - 2; i >= 0; i--) {
      await ctrl.undoLastEdit();
      check(`G8-06 compound undo step ${i}`, isDeepStrictEqual(snap(), states[i]), true);
    }
    check("G8-06 canUndo is false at initial state", ctrl.getEditHistoryState().canUndo, false);

    // 逐次全 Redo 回到终态
    for (let i = 1; i < states.length; i++) {
      await ctrl.redoLastEdit();
      check(`G8-06 compound redo step ${i}`, isDeepStrictEqual(snap(), states[i]), true);
    }
    check("G8-06 canRedo is false at final state", ctrl.getEditHistoryState().canRedo, false);

    // 回到第 5 步（解绑后、剪切删除前），导出 PDF 并解包比对颜色与坐标误差 <= 1pt
    await ctrl.undoLastEdit(); // undo delete
    await ctrl.undoLastEdit(); // undo cut
    await nextTurn();
    const pdfBytes = await reader.exportPdf();
    const paints = await readPagePaint(api.pdf, pdfBytes);
    const strokePaints = paints.filter(p => p.kind === "stroke");
    check("G8-06 exported PDF contains 2 strokes", strokePaints.length >= 2, true);
    const expectedColor = "#1e88e5";
    const matched = strokePaints.filter(p => p.color.toLowerCase() === expectedColor);
    check("G8-06 exported PDF stroke colors match #1e88e5", matched.length >= 2, true);
    // 校验 pen-compound 坐标（归一化 -> PDF 点）误差 <= 1pt
    const compAnn = reader.model().find(a => a.id === "pen-compound");
    const expectedPts = compAnn.strokes[0].map(pt => [pt.x * width, height - pt.y * height]);
    const minPtError = Math.min(...matched.map(p => {
      if (p.points.length < 2) return Infinity;
      const first = p.points[0], last = p.points[p.points.length - 1];
      return Math.max(
        Math.hypot(first[0] - expectedPts[0][0], first[1] - expectedPts[0][1]),
        Math.hypot(last[0] - expectedPts[1][0], last[1] - expectedPts[1][1]),
      );
    }));
    check("G8-06 exported PDF stroke coords within <= 1pt", minPtError <= 1, true);

    await vault.store.flush();
    await mergeEvidence("g8-06-compound-undo-reload-export.json", "headless", {
      passed: true,
      compoundSteps: states.length - 1,
      fullUndoRedoZeroDiff: true,
      exportedStrokeCount: strokePaints.length,
      exportedColorMatched: matched.length,
      exportedCoordMaxErrorPt: Number(minPtError.toFixed(4)),
    });
  }
});
