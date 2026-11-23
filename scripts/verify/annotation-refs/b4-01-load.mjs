import { inkFixture, missingPen, observeErrors, run } from "./fixture-support.mjs";

await run("B4-01", async (project, check) => {
  const errors = await observeErrors(async () => {
    const fixture = await inkFixture(project, [missingPen()]);
    await fixture.load();
    await fixture.store.flush();
  });
  check("load errors", errors, { thrown: null, uncaughtException: 0, unhandledRejection: 0 });
});
