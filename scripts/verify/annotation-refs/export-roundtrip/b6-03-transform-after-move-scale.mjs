import { docPath, height, imageOverlay, pen, readerFixture, run, seededVault, width } from "./fixture-support.mjs";
import { readPagePaint } from "./pdf-content.mjs";

await run("B6-03", async (api, check) => {
  const host = imageOverlay("transform-host", 60, 100, { inkLayerId: "default" });
  const bound = pen("transform-pen", "#214365", [[80, 120], [140, 150], [155, 160]], {
    hostAnnotationId: host.id, inkLayerId: "default",
  });
  const vault = await seededVault(api, [host, bound]);
  const reader = await readerFixture(api, vault.plugin);
  reader.gesture(host.id, "move", 40, 30);
  check("host moved down 30pt and right 40pt", reader.model().find(item => item.id === host.id)?.rects,
    [{ x: 100, y: 290, w: 120, h: 80 }]);
  reader.gesture(host.id, "resize", 60, 40);
  const model = reader.model();
  check("host size is 1.5× at the same top-left anchor", model.find(item => item.id === host.id)?.rects,
    [{ x: 100, y: 250, w: 180, h: 120 }]);
  const live = model.find(item => item.id === bound.id);
  const toPdf = annotation => annotation?.strokes?.[0]?.map(({ x, y }) => [x * width, height - y * height]) ?? [];
  const livePoints = toPdf(live);
  const expected = [[130, 340], [220, 295], [242.5, 280]];
  const deviation = (actual, wanted) => actual.length === wanted.length
    ? Math.max(0, ...wanted.map(([x, y], index) => Math.hypot(actual[index][0] - x, actual[index][1] - y))) : Infinity;
  check("bound ink moved and scaled to the independent expected points",
    livePoints.map(point => point.map(value => Number(value.toFixed(6)))), expected);
  await vault.store.flush();
  const reopened = await vault.reopen();
  const durable = (await reopened.loadAnnotations(docPath)).find(item => item.id === bound.id);
  check("reopened store retains the in-memory strokes and binding", {
    points: toPdf(durable), host: durable?.hostAnnotationId,
  }, { points: livePoints, host: host.id });
  const strokes = (await readPagePaint(api.pdf, await reader.exportPdf())).filter(item => item.kind === "stroke" && item.color === bound.color);
  const maxDeviationPt = strokes.length === 1 ? deviation(strokes[0].points, livePoints) : Infinity;
  console.log("B6-03 decoded CTM and transformed points", JSON.stringify({
    expected, live: livePoints, strokes, maxDeviationPt: Number.isFinite(maxDeviationPt) ? maxDeviationPt : "Infinity",
  }));
  check("one decoded stroke and max Euclidean deviation ≤1pt", maxDeviationPt <= 1 ? true : {
    count: strokes.length, maxDeviationPt, points: strokes.map(item => item.points),
  }, true);
});
