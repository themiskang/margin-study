import { freshKeyOrder, run } from "./fixture-support.mjs";

await run("key-order-invariance", async (setup, check) => {
  for (const target of ["live", "deleted"]) {
    const sameOrder = await freshKeyOrder(setup, target, false);
    const reversed = await freshKeyOrder(setup, target, true);
    check(`${target}: control counts [object, unbind event]`, [sameOrder.annotations.length, sameOrder.eventCount], [
      2, target === "deleted" ? 1 : 0,
    ]);
    check(`${target}: recursive JSON key reversal preserves first merge`, reversed, sameOrder);
  }
});
