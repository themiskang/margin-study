import { docPath, pen, referenceLayer, roundTrip, run } from "./fixture-support.mjs";
import { falseLossLocations } from "./static-checks.mjs";

await run("B7-02", async (api, check) => {
  const samples = [
    pen("explicit-false", "#214365", [[60, 120], [140, 120]], { bindToInkLayer: false, inkLayerId: referenceLayer }),
    pen("explicit-true", "#684624", [[60, 220], [140, 220]], { bindToInkLayer: true, inkLayerId: referenceLayer }),
    pen("missing-field", "#234567", [[60, 320], [140, 320]], { inkLayerId: referenceLayer }),
  ];
  const result = await roundTrip(api, samples);
  const states = annotations => annotations.map(item => ({
    id: item.id, own: Object.hasOwn(item, "bindToInkLayer"), value: item.bindToInkLayer,
  })).sort((left, right) => left.id.localeCompare(right.id));
  const expected = [
    { id: "explicit-false", own: true, value: false },
    { id: "explicit-true", own: true, value: true },
    { id: "missing-field", own: false, value: undefined },
  ];
  check("library import succeeds", result.error, null);
  check("ZIP payload preserves false, true, and absence separately", states(result.archive.payload.annotations?.[docPath] ?? []), expected);
  check("reopened target distinguishes false, true, and absence", states(result.after), expected);
  const losses = await falseLossLocations();
  console.log("B7-02 truthiness-copy inventory", JSON.stringify(losses));
  check("no truthiness-dependent transfer of bindToInkLayer", losses, []);
});
