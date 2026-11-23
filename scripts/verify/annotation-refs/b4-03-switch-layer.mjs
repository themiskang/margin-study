import { inkFixture, missingPen, otherLayer, run } from "./fixture-support.mjs";

await run("B4-03", async (project, check) => {
  const annotation = missingPen();
  const fixture = await inkFixture(project, [annotation]);
  await fixture.load();
  const sample = async () => ({
    active: fixture.active(), ids: fixture.cached().map(item => item.id),
    effectiveMembership: (await fixture.layerMemberships()).get(annotation.id), alpha: fixture.alpha(.25),
  });
  fixture.select(otherLayer);
  const away = await sample();
  fixture.select("default");
  const back = await sample();
  const common = { ids: [annotation.id], effectiveMembership: [], alpha: 255 };
  check("switch to L2 then back", [away, back],
    [{ active: otherLayer, ...common }, { active: "default", ...common }]);
  await fixture.store.flush();
});
