import { inkFixture, missingPen, run } from "./fixture-support.mjs";

await run("B4-02", async (project, check) => {
  const input = [missingPen()];
  const fixture = await inkFixture(project, input);
  await fixture.load();
  const loaded = fixture.cached();
  check("input and loaded counts", [input.length, loaded.length], [1, 1]);
  check("identity and strokes retained", loaded.map(({ id, strokes }) => ({ id, strokes })),
    input.map(({ id, strokes }) => ({ id, strokes })));
  check("center alpha", fixture.alpha(.25), 255);
});
