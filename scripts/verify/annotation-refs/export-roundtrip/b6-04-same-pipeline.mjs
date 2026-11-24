import { setImmediate as nextTurn } from "node:timers/promises";
import { imageOverlay, pen, readerFixture, referenceLayer, run, seededVault } from "./fixture-support.mjs";
import { imagePaintsById, readPagePaint } from "./pdf-content.mjs";
import { fullOpacityBranchLocations, opacityLiteralLocations, overlayOpacityReader } from "./static-checks.mjs";

await run("B6-04", async (api, check) => {
  const images = [
    imageOverlay("image-public", 15, 25, { bindToInkLayer: false, inkLayerId: referenceLayer }),
    imageOverlay("image-default", 65, 125, { inkLayerId: "default" }),
    imageOverlay("image-reference", 115, 225, { inkLayerId: referenceLayer }),
  ];
  const pens = [
    pen("pen-public", "#214365", [[40, 110], [120, 110]], { bindToInkLayer: false, inkLayerId: referenceLayer }),
    pen("pen-default", "#648213", [[40, 210], [120, 210]], { inkLayerId: "default" }),
    pen("pen-reference", "#365274", [[40, 310], [120, 310]], { inkLayerId: referenceLayer }),
  ];
  const vault = await seededVault(api, [...images, ...pens]);
  const reader = await readerFixture(api, vault.plugin);
  const readOpacity = await overlayOpacityReader();
  const penId = new Map(pens.map(item => [item.color, item.id]));
  const sort = rows => rows.sort(([left], [right]) => left.localeCompare(right));
  for (const [state, active, reference] of [
    ["default", "default", undefined],
    ["default + reference", "default", referenceLayer],
    ["reference + default", referenceLayer, "default"],
  ]) {
    reader.controller.selectInkLayer(active);
    reader.controller.setInkOverlay(reference);
    await nextTurn();
    const expected = sort([...images, ...pens]
      .filter(item => item.bindToInkLayer === false || item.inkLayerId === active || item.inkLayerId === reference)
      .map(item => [item.id, item.bindToInkLayer !== false && item.inkLayerId === reference ? .35 : 1]));
    const canvas = reader.canvasStrokes().map(item => [penId.get(item.color) ?? item.color, item.alpha]);
    const css = reader.overlays().map(element => [element.dataset.annId, readOpacity(element)]);
    const paints = await readPagePaint(api.pdf, await reader.exportPdf());
    const pdfImages = imagePaintsById(images, paints).map(item => [item.id, item.alpha]);
    const pdfInk = paints.filter(item => item.kind === "stroke").map(item => [penId.get(item.color) ?? item.color, item.CA]);
    const render = sort([...canvas, ...css]);
    const pdf = sort([...pdfInk, ...pdfImages]);
    console.log("B6-04 opacity by object", JSON.stringify({ state, render, pdf, expected }));
    check(`${state}: rendered objects have the specified opacity`, render, expected);
    check(`${state}: each decoded /ca or /CA matches rendered opacity`, pdf, render);
  }
  await vault.store.flush();
  const literals = await opacityLiteralLocations();
  console.log("B6-04 0.35 literal inventory", JSON.stringify(literals));
  const referenceLiterals = literals.filter(item => item.context === "reference/opacity candidate");
  check("reference opacity has at most one literal source", referenceLiterals.length <= 1 ? true : referenceLiterals, true);
  const fullOpacityBranches = await fullOpacityBranchLocations();
  console.log("B6-04 reference-vs-full opacity branch inventory", JSON.stringify(fullOpacityBranches));
  check("reference-vs-full selection has at most one literal-1 branch",
    fullOpacityBranches.length <= 1 ? true : fullOpacityBranches, true);
});
