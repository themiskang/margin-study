import { renameFixture, run, sourcePath, targetPath } from "./fixture-support.mjs";

await run("B5-01", async (project, check) => {
  const fixture = await renameFixture(project);
  const before = await fixture.read(sourcePath);
  check("fixture counts", fixture.counts(before), { total: 4, public: 2, bound: 2 });
  fixture.emitRename(sourcePath, targetPath);
  await fixture.settled();
  const after = await fixture.read(targetPath);
  check("total, public and bound counts", fixture.counts(after), fixture.counts(before));
  check("no migration error", fixture.notices(), []);
});
