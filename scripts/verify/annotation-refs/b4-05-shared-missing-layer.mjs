import { inkFixture, missingPen, otherLayer, run } from "./fixture-support.mjs";

await run("B4-05", async (project, check) => {
  const input = [missingPen("orphan-one", .25), missingPen("orphan-two", .65)];
  const fixture = await inkFixture(project, input);
  await fixture.load();
  const sample = async () => {
    const loaded = fixture.cached();
    const memberships = await fixture.layerMemberships();
    return [.25, .65].map((y, index) => {
      const original = input[index];
      const copy = loaded.find(item => item.id === original.id);
      return { id: copy?.id, strokes: copy?.strokes, membership: memberships.get(original.id), alpha: fixture.alpha(y) };
    });
  };
  const first = await sample();
  fixture.select(otherLayer);
  const second = await sample();
  const expected = input.map(({ id, strokes }) => ({ id, strokes, membership: [], alpha: 255 }));
  check("both objects independently degrade on both layers", [first, second], [expected, expected]);
  check("both identities retained exactly once", fixture.cached().map(item => item.id).sort(), input.map(item => item.id).sort());
  await fixture.store.flush();
});
