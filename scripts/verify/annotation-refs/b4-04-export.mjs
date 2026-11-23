import { inkFixture, missingPen, otherLayer, run } from "./fixture-support.mjs";

await run("B4-04", async (project, check) => {
  const annotation = missingPen();
  const fixture = await inkFixture(project, [annotation]);
  await fixture.load();
  fixture.select(otherLayer);
  const entries = fixture.exportEntries();
  check("orphan export input", entries.map(({ annotation, opacity }) => ({ id: annotation.id, opacity })),
    [{ id: annotation.id, opacity: 1 }]);
  check("flatten, serialize and reopen PDF", await fixture.flatten(entries), { pages: 1, hasContentStream: true });
  await fixture.store.flush();
});
