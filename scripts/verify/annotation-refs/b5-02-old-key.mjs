import { renameFixture, run, sourcePath, targetPath } from "./fixture-support.mjs";

await run("B5-02", async (project, check) => {
  const fixture = await renameFixture(project);
  fixture.emitRename(sourcePath, targetPath);
  await fixture.settled();
  const fresh = await fixture.fresh();
  check("old annotation key has no content", [await fixture.read(sourcePath), await fixture.read(sourcePath, fresh)], [[], []]);
  check("old sidecar absent", fixture.disk.has(fixture.sidecar(sourcePath)), false);
  check("old metadata absent", [fixture.store.getDocMeta(sourcePath), fresh.getDocMeta(sourcePath)], [{}, {}]);
  check("document lookup uses new path", fresh.documents.map(doc => doc.path), [targetPath]);
  check("new sidecar has the four moved annotations", (await fixture.read(targetPath, fresh)).map(item => item.docPath),
    [targetPath, targetPath, targetPath, targetPath]);
});
