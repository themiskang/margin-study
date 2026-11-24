import { docPath, imageOverlay, pen, readerFixture, run, seededVault } from "./fixture-support.mjs";
import { readPagePaint } from "./pdf-content.mjs";

await run("B6-01", async (api, check) => {
  const host = imageOverlay("deleted-host", 60, 100, { inkLayerId: "default" });
  const bound = pen("bound-pen", "#214365", [[80, 120], [140, 150]], { inkLayerId: "default", hostAnnotationId: host.id });
  const survivor = pen("surviving-control", "#684624", [[80, 300], [140, 330]], { bindToInkLayer: false });
  const vault = await seededVault(api, [host, bound, survivor]);
  const reader = await readerFixture(api, vault.plugin);
  const before = await readPagePaint(api.pdf, await reader.exportPdf());
  reader.controller.deleteFreeOverlay(host.id);
  await vault.store.flush();
  const durable = await (await vault.reopen()).loadAnnotations(docPath);
  const after = await readPagePaint(api.pdf, await reader.exportPdf());
  const locate = (paints, annotation) => paints
    .filter(item => item.kind === "stroke" && item.color === annotation.color)
    .map(({ op, location }) => ({ op, location }));
  const locations = { before: locate(before, bound), after: locate(after, bound), control: locate(after, survivor) };
  console.log("B6-01 decoded paint locations", JSON.stringify(locations));
  const savedHost = durable.find(item => item.id === host.id);
  check("delete was committed to the source vault", !savedHost || savedHost.overlay?.deleted === true, true);
  check("bound strokes were measurable before deletion and are absent after it", [
    locations.before.length, locations.after.length, locations.control.length,
  ], [1, 0, 1]);
});
