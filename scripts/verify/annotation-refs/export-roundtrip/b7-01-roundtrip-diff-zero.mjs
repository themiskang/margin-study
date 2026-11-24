import { docPath, imageOverlay, pen, referenceLayer, roundTrip, run } from "./fixture-support.mjs";

function differences(before, after, path = "$") {
  if (Object.is(before, after)) return [];
  if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) !== Array.isArray(after)) {
    return [{ path, before, after }];
  }
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => {
    const field = `${path}.${key}`;
    if (!Object.hasOwn(before, key) || !Object.hasOwn(after, key)) {
      return [{ path: field, before: before[key], after: after[key], missing: Object.hasOwn(before, key) ? "after" : "before" }];
    }
    return differences(before[key], after[key], field);
  });
}

await run("B7-01", async (api, check) => {
  const host = imageOverlay("bound-host", 60, 100, {
    inkLayerId: referenceLayer, bindToInkLayer: true, overlay: { kind: "image", rotation: 12, background: "#abcdef" },
  });
  const bound = pen("bound-pen", "#214365", [[80, 120], [140, 150]], {
    inkLayerId: referenceLayer, hostAnnotationId: host.id, hostBindingId: "original-bind-id",
  });
  const publicInk = pen("public-pen", "#684624", [[80, 300], [140, 330]], { bindToInkLayer: false, inkLayerId: "default" });
  const result = await roundTrip(api, [host, bound, publicInk]);
  const normalize = annotations => JSON.parse(JSON.stringify(annotations)).sort((left, right) => left.id.localeCompare(right.id));
  check("target starts empty and import succeeds", { ...result.targetBefore, error: result.error }, { files: 0, annotations: 0, error: null });
  check("production archive includes the source PDF and all annotation JSON", {
    pdf: result.archive.files.has(`documents/${docPath}`),
    annotations: normalize(result.archive.payload.annotations?.[docPath] ?? []),
  }, { pdf: true, annotations: normalize(result.before) });
  const diff = differences(normalize(result.before), normalize(result.after));
  console.log("B7-01 reopened JSON", JSON.stringify({ before: result.before.length, after: result.after.length, diff: diff.length }));
  check("reopened target annotation JSON has zero field differences", diff, []);
});
