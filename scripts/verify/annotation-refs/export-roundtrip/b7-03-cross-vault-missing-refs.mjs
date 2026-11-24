import { setImmediate as nextTurn } from "node:timers/promises";
import { docPath, imageOverlay, pen, readerFixture, roundTrip, run } from "./fixture-support.mjs";
import { imagePaintsById, readPagePaint } from "./pdf-content.mjs";
import { overlayOpacityReader } from "./static-checks.mjs";

await run("B7-03", async (api, check) => {
  const layer = "deleted-layer-404";
  const host = imageOverlay("orphan-host", 60, 100, { inkLayerId: layer, bindToInkLayer: true });
  const bound = pen("orphan-pen", "#214365", [[80, 120], [140, 150]], {
    inkLayerId: layer, bindToInkLayer: true, hostAnnotationId: host.id,
  });
  let uncaught = 0;
  let unhandled = 0;
  const onException = () => { uncaught++; };
  const onRejection = () => { unhandled++; };
  process.on("uncaughtException", onException);
  process.on("unhandledRejection", onRejection);
  try {
    const result = await roundTrip(api, [host, bound], { includePdf: false });
    check("annotation-only package imports without throwing and target original PDF stays absent", {
      error: result.error, targetBefore: result.targetBefore,
      hasOriginalInZip: result.archive.files.has(`documents/${docPath}`),
      hasOriginalAfter: result.target.files.has(docPath),
    }, { error: null, targetBefore: { files: 0, annotations: 0 }, hasOriginalInZip: false, hasOriginalAfter: false });
    const binding = annotations => annotations.map(item => ({
      id: item.id, inkLayerId: item.inkLayerId, bindToInkLayer: item.bindToInkLayer,
      hostAnnotationId: item.hostAnnotationId, strokes: item.strokes, overlay: item.overlay,
    })).sort((left, right) => left.id.localeCompare(right.id));
    check("annotation-only ZIP contains both complete unresolved references",
      binding(result.archive.payload.annotations?.[docPath] ?? []), binding([host, bound]));
    check("both objects and their unresolved reference data survive reload", binding(result.after), binding([host, bound]));
    const reader = await readerFixture(api, { ...result.target.plugin, store: result.reopened });
    const readOpacity = await overlayOpacityReader();
    const readLayer = () => reader.controller.getInkLayers().layers;
    check("missing layer remains outside normal layer membership", readLayer().some(item => item.id === layer), false);
    if (readLayer().length < 2) reader.controller.createInkLayer("visibility-control");
    const second = readLayer().find(item => item.id !== "default")?.id;
    if (!second) throw new Error("Expected a second normal layer for the switch control");
    for (const [label, active] of [["default", "default"], ["second", second]]) {
      reader.controller.selectInkLayer(active);
      await nextTurn();
      const render = {
        overlay: reader.overlays().filter(item => item.dataset.annId === host.id).map(readOpacity),
        pen: reader.canvasStrokes().filter(item => item.color === bound.color).map(item => item.alpha),
      };
      const paints = await readPagePaint(api.pdf, await reader.exportPdf({ copySource: false }));
      const exportAlphas = {
        overlay: imagePaintsById([host], paints).filter(item => item.id === host.id).map(item => item.alpha),
        pen: paints.filter(item => item.kind === "stroke" && item.color === bound.color).map(item => item.CA),
      };
      console.log("B7-03 orphan visibility", JSON.stringify({ layer: label, render, export: exportAlphas }));
      check(`layer ${label}: both retained objects render at full opacity`, render, { overlay: [1], pen: [1] });
      check(`layer ${label}: both retained objects export at full opacity`, exportAlphas, { overlay: [1], pen: [1] });
    }
    await result.reopened.flush();
    await nextTurn();
    check("zero uncaught exceptions or unhandled rejections", { uncaught, unhandled }, { uncaught: 0, unhandled: 0 });
  } finally {
    process.off("uncaughtException", onException);
    process.off("unhandledRejection", onRejection);
  }
});
