import { inkFixture, observeErrors, otherLayer, overlay, pen, run, sourcePath } from "./fixture-support.mjs";

const noErrors = { thrown: null, uncaughtException: 0, unhandledRejection: 0 };
const routineSaveMessages = new Map([
  ["pending", "本地修改等待保存。"],
  ["saved", "本地数据已落盘。"],
]);

function exported(fixture, id) {
  return fixture.exportEntries()
    .filter(entry => entry.annotation.id === id)
    .map(({ annotation, opacity }) => ({ id: annotation.id, opacity }));
}

await run("B4-06", async (project, check) => {
  const dataErrors = await observeErrors(async () => {
    const host = overlay("original-host", sourcePath, { inkLayerId: "default", bindToInkLayer: true });
    const annotation = pen("orphan-pen", sourcePath, .25, {
      inkLayerId: "default", bindToInkLayer: true, hostAnnotationId: host.id,
    });
    const fixture = await inkFixture(project, [host, annotation]);
    await fixture.load();

    const createdLayers = new Set(fixture.controller.getInkLayers().layers.map(layer => layer.id));
    const snapshots = [];
    for (const round of [1, 2]) {
      fixture.controller.createInkLayer(`B4 metadata removal ${round}`);
      const layerId = fixture.active();
      check(`round ${round} newly created layer`, !!layerId && !createdLayers.has(layerId), true);
      createdLayers.add(layerId);
      check(`round ${round} host and pen rebound`, [
        fixture.controller.rebindAnnotationInkLayer(host.id, layerId),
        fixture.controller.rebindAnnotationInkLayer(annotation.id, layerId),
      ], [true, true]);
      check(`round ${round} pen uses the active real layer before removal`, {
        layer: fixture.cached().find(item => item.id === annotation.id)?.inkLayerId,
        alpha: fixture.alpha(.25),
      }, { layer: layerId, alpha: 255 });
      fixture.select(otherLayer);
      await fixture.store.flush();
      check(`round ${round} pen hidden on unrelated layer before removal`,
        { exported: exported(fixture, annotation.id), alpha: fixture.alpha(.25) }, { exported: [], alpha: 0 });

      const previousEventIds = new Set(fixture.store.getLocalEvents().map(event => event.id));
      const meta = fixture.store.getDocMeta(sourcePath);
      fixture.store.updateDocMeta(sourcePath, {
        handwritingLayers: meta.handwritingLayers.filter(layer => layer.id !== layerId),
      });
      await fixture.store.flush();
      check(`round ${round} metadata no longer lists the layer`,
        fixture.store.getDocMeta(sourcePath).handwritingLayers.map(layer => layer.id), ["default", otherLayer]);

      const expectVisible = [{ id: annotation.id, opacity: 1 }];
      const snapshot = {
        ids: fixture.cached().map(item => item.id).sort(),
        export: exported(fixture, annotation.id),
        alpha: fixture.alpha(.25),
        membership: (await fixture.layerMemberships()).get(annotation.id),
      };
      check(`round ${round} data-only orphan stays visible and unassigned`, snapshot, {
        ids: [host.id, annotation.id].sort(), export: expectVisible, alpha: 255, membership: [],
      });
      snapshots.push(snapshot);

      const after = fixture.cached().find(item => item.id === annotation.id);
      check(`round ${round} raw layer, bind flag, host reference and strokes preserved`, after, { ...annotation, inkLayerId: layerId });

      const added = fixture.store.getLocalEvents().filter(event => !previousEventIds.has(event.id));
      const routine = event => event.objectIds.length === 0 && routineSaveMessages.get(event.kind) === event.detail;
      check(`round ${round} no orphan or annotation events`, added.filter(event => !routine(event)), []);
      const repeated = [...routineSaveMessages.keys()].filter(kind =>
        added.filter(event => routine(event) && event.kind === kind).length > 1);
      check(`round ${round} no duplicate metadata save events`, repeated, []);
    }
    check("repeat preserves count, visibility and ownership", snapshots[1], snapshots[0]);
  });
  check("data-only removal errors", dataErrors, noErrors);

  const deletionErrors = await observeErrors(async () => {
    const annotation = overlay("explicit-delete-note", sourcePath, { inkLayerId: otherLayer, bindToInkLayer: true });
    const fixture = await inkFixture(project, [annotation]);
    await fixture.load();
    fixture.select(otherLayer);
    check("explicit-delete note visible before action", exported(fixture, annotation.id),
      [{ id: annotation.id, opacity: 1 }]);
    fixture.controller.deleteInkLayer(otherLayer);
    await fixture.controller.undoLastEdit();
    await fixture.store.flush();
    check("explicit deletion removes layer", fixture.controller.getInkLayers().layers.map(layer => layer.id), ["default"]);
    check("explicit deletion keeps soft-deleted source even after undo",
      fixture.cached(), [{ ...annotation, overlay: { ...annotation.overlay, deleted: true } }]);
    check("explicitly deleted note excluded from export", exported(fixture, annotation.id), []);
  });
  check("explicit deletion errors", deletionErrors, noErrors);
});
