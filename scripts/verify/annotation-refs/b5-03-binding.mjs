import { otherLayer, renameFixture, run, sourcePath, targetPath } from "./fixture-support.mjs";

await run("B5-03", async (project, check) => {
  const fixture = await renameFixture(project);
  const before = await fixture.read(sourcePath);
  const priorPen = before.find(item => item.id === "bound-pen");
  check("input binding", [priorPen?.hostAnnotationId, priorPen?.inkLayerId], ["bound-host", otherLayer]);
  fixture.emitRename(sourcePath, targetPath);
  await fixture.settled();
  const after = await fixture.read(targetPath, await fixture.fresh());
  const pen = after.find(item => item.id === "bound-pen");
  const hosts = after.filter(item => item.id === pen?.hostAnnotationId && item.overlay?.kind === "text" && !item.overlay.deleted);
  const layers = fixture.layerState(targetPath).layers.map(item => item.id);
  check("host identity and layer survive migration", {
    hostId: pen?.hostAnnotationId, penLayer: pen?.inkLayerId,
    resolvedHosts: hosts.map(item => ({ id: item.id, layer: item.inkLayerId, path: item.docPath })),
    layerExists: layers.includes(pen?.inkLayerId),
  }, {
    hostId: priorPen.hostAnnotationId, penLayer: priorPen.inkLayerId,
    resolvedHosts: [{ id: "bound-host", layer: otherLayer, path: targetPath }], layerExists: true,
  });
});
