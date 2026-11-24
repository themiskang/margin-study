import { imageOverlay, readerFixture, referenceLayer, run, seededVault } from "./fixture-support.mjs";
import { imagePaintsById, readPagePaint } from "./pdf-content.mjs";

await run("B6-02", async (api, check) => {
  const annotations = [
    imageOverlay("public", 15, 25, { bindToInkLayer: false, inkLayerId: referenceLayer }),
    imageOverlay("active", 65, 125, { bindToInkLayer: true, inkLayerId: "default" }),
    imageOverlay("reference", 115, 225, { inkLayerId: referenceLayer }),
    imageOverlay("deleted-control", 165, 325, { inkLayerId: "default", overlay: { kind: "image", deleted: true } }),
  ];
  const vault = await seededVault(api, annotations);
  const reader = await readerFixture(api, vault.plugin);
  reader.controller.setInkOverlay(referenceLayer);
  const paints = imagePaintsById(annotations, await readPagePaint(api.pdf, await reader.exportPdf()));
  const counts = paints.reduce((out, item) => {
    const key = String(item.alpha);
    out[key] = (out[key] ?? 0) + 1;
    return out;
  }, {});
  console.log("B6-02 decoded /ca", JSON.stringify({ paints, counts }));
  check("each live image draw resolves to the required /ca", paints.map(({ id, alpha }) => [id, alpha]).sort(),
    [["active", 1], ["public", 1], ["reference", .35]]);
  check("count image draws by resolved /ca and exclude the deleted control", counts, { "1": 2, "0.35": 1 });
});
