import { renameFixture, run, sourcePath, targetPath } from "./fixture-support.mjs";

await run("B5-06", async (project, check) => {
  const fixture = await renameFixture(project);
  const finalPath = "sub/c.pdf";
  const before = fixture.counts(await fixture.read(sourcePath));
  check("fixture counts", before, { total: 4, public: 2, bound: 2 });
  fixture.emitRename(sourcePath, targetPath);
  fixture.emitRename(targetPath, finalPath);
  await fixture.settled();
  const fresh = await fixture.fresh();
  check("counts after two queued rename events", fixture.counts(await fixture.read(finalPath, fresh)), before);
  check("old and intermediate keys empty", [await fixture.read(sourcePath, fresh), await fixture.read(targetPath, fresh)], [[], []]);
  check("no migration error", fixture.notices(), []);
});
