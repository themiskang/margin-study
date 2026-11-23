import { renameFixture, run, sourcePath, targetPath } from "./fixture-support.mjs";

await run("B5-05", async (project, check) => {
  const fixture = await renameFixture(project);
  const oldSidecar = fixture.sidecar(sourcePath), newSidecar = fixture.sidecar(targetPath);
  const before = await fixture.read(sourcePath);
  const oldBytes = fixture.disk.get(oldSidecar);
  const oldMeta = structuredClone(fixture.store.getDocMeta(sourcePath));
  let writesFailed = 0;
  let priorRename = false;
  fixture.hooks.beforeWrite = path => {
    if (path === newSidecar && writesFailed === 0) {
      writesFailed++;
      priorRename = fixture.renames.some(([from, to]) => from === oldSidecar && to === newSidecar);
      throw new Error("B5_INJECTED_DESTINATION_WRITE");
    }
  };
  try {
    await fixture.log(async () => {
      fixture.emitRename(sourcePath, targetPath);
      await fixture.settled();
    });
  } finally {
    fixture.hooks.beforeWrite = null;
  }
  check("fault reached destination sidecar write", writesFailed, 1);
  check("old sidecar bytes restored", fixture.disk.get(oldSidecar), oldBytes);
  check("no destination sidecar remains", fixture.disk.has(newSidecar), false);
  const oldObjects = await fixture.read(sourcePath);
  check("old key restored with all objects", oldObjects, before);
  check("old total, public and bound counts", fixture.counts(oldObjects), fixture.counts(before));
  check("new key has no objects", await fixture.read(targetPath), []);
  check("metadata restored to old key", [fixture.store.getDocMeta(sourcePath), fixture.store.getDocMeta(targetPath)], [oldMeta, {}]);
  const fresh = await fixture.fresh();
  check("fresh Store sees same rollback", [await fixture.read(sourcePath, fresh), await fixture.read(targetPath, fresh)], [before, []]);
  check("persisted metadata and document key restored",
    [fresh.getDocMeta(sourcePath), fresh.getDocMeta(targetPath), fresh.documents.map(doc => doc.path)],
    [oldMeta, {}, [sourcePath]]);
  console.log(`INFO B5-05 destination write happened ${priorRename ? "after" : "before"} moving the original sidecar`);
});
