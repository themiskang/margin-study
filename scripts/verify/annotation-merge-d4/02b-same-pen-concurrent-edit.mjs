import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const worktree = resolve(process.argv[2] ?? process.cwd());
const { deleted, diskAnns, doc, durable, merge, pen, run } = await import(
  pathToFileURL(join(worktree, "scripts/verify/annotation-merge-d4/fixture-support.mjs")).href
);

function binding(annotation) {
  return {
    hasHostAnnotationId: Object.hasOwn(annotation, "hostAnnotationId"),
    hostAnnotationId: annotation.hostAnnotationId ?? null,
    bindToInkLayer: annotation.bindToInkLayer ?? null,
  };
}

function observePen(annotations) {
  const annotation = annotations.find(item => item.id === "p" && item.type === "pen");
  return annotation ? { ...binding(annotation), strokes: structuredClone(annotation.strokes) } : null;
}

const unbound = { hasHostAnnotationId: false, hostAnnotationId: null, bindToInkLayer: false };

await run("02b", async (setup, check) => {
  const original = pen("p", "deleted");
  const originalStrokes = structuredClone(original.strokes);
  const editedStrokes = [[...originalStrokes[0], { x: 0.32, y: 0.19 }]];
  const state = await setup([deleted, original], [deleted]);
  const { env, store, path } = state;
  let atSidecarWrite = null;

  env.hooks.afterWrite = async name => {
    if (name !== path || atSidecarWrite !== null) return;
    atSidecarWrite = observePen(diskAnns(state));
    const live = await store.loadAnnotations(doc);
    const samePen = live.find(item => item.id === "p" && item.type === "pen");
    samePen.strokes = structuredClone(editedStrokes);
    store.saveAnnotationsDebounced(doc, live);
  };

  try {
    await merge(store);
  } finally {
    env.hooks.afterWrite = null;
  }

  check("merge sidecar write reached with the pen already unbound", atSidecarWrite, {
    ...unbound, strokes: originalStrokes,
  });
  check("merge publishes the unbind to the concurrently edited pen", observePen(await store.loadAnnotations(doc)), {
    ...unbound, strokes: editedStrokes,
  });

  await store.flush();
  check("one flush keeps the edit and does not restore the invalid host", observePen(diskAnns(state)), {
    ...unbound, strokes: editedStrokes,
  });
  check("one unbind event remains durable for the same pen", durable(env).filter(event => event.objectIds.includes("p")).length, 1);
});
