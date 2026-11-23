import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { captureFailure, loadSupport, recoveryEntries, seedDocument } from "./b5-07-draft-survives-rename.mjs";

export async function withMainSaveTrap(store, trap, action) {
  const host = store.host;
  const original = host.saveData;
  host.saveData = async function(data) {
    trap(data);
    return original.call(this, data);
  };
  try { return await action(); } finally { host.saveData = original; }
}

export async function leaveMerge(fixture, writer, path, pendingPen) {
  const sidecar = writer.sidecarPath(path);
  const local = structuredClone(await writer.loadAnnotations(path));
  fixture.disk.set(sidecar, JSON.stringify({ annotations: [...local, pendingPen] }));
  const fault = "B5_FIXTURE_MERGE_MAIN_WRITE";
  const error = await withMainSaveTrap(writer, () => { throw new Error(fault); },
    () => captureFailure(() => writer.resolveAnnotationConflict(path, "merge")));
  const entries = (await recoveryEntries(writer, "merge-tx")).filter(entry => entry.payload.docPath === path);
  return { error, fault, entries };
}

export function unbindEvents(store, penId) {
  return store.getLocalEvents().filter(event => event.kind === "conflict-merged" &&
    event.objectIds.includes(penId) && event.detail.includes("hostAnnotationId"));
}

export function carriesUnbind(data, path, penId) {
  return (data.docMeta?.[path]?.unbindEventKeys ?? []).some(key => key.includes(`\0${penId}\0`));
}

async function mergeSurvivesRename() {
  const { run, renameFixture, pen, sourcePath, targetPath } = await loadSupport();
  await run("B5-08", async (project, check) => {
    const fixture = await renameFixture(project);
    const unrelatedPath = "unrelated.pdf";
    const unrelated = pen("untouched", unrelatedPath, .2);
    await seedDocument(fixture, unrelatedPath, [unrelated]);
    const unrelatedRaw = fixture.disk.get(fixture.sidecar(unrelatedPath));
    const pendingPen = pen("pending-unbind", sourcePath, .72, { hostAnnotationId: "absent-host" });
    const initial = await leaveMerge(fixture, fixture.store, sourcePath, pendingPen);
    check("initial merge failed after the sidecar write", initial.error, initial.fault);
    check("one unpublished journal fact before rename",
      initial.entries.map(entry => entry.payload.unbindEvents.map(event => event.penId)), [[pendingPen.id]]);
    const journal = initial.entries[0];
    const fact = journal?.payload.unbindEvents[0];
    if (!fact) return;
    check("produced journal carries an old-path fact key", fact.dedupeKey.startsWith(`${sourcePath}\0`), true);
    const committed = JSON.parse(fixture.disk.get(fixture.sidecar(sourcePath))).annotations;
    check("sidecar committed the pen unbind",
      committed.filter(item => item.id === pendingPen.id).map(item => item.hostAnnotationId ?? null), [null]);
    check("no durable unbind event before restart", unbindEvents(fixture.store, pendingPen.id).length, 0);

    let failedRecoveryWrites = 0;
    await withMainSaveTrap(fixture.store, data => {
      if (failedRecoveryWrites === 0 && carriesUnbind(data, sourcePath, pendingPen.id)) {
        failedRecoveryWrites++;
        throw new Error("B5_FIXTURE_OLD_PATH_RECOVERY_WRITE");
      }
    }, async () => {
      fixture.emitRename(sourcePath, targetPath);
      await fixture.settled();
    });
    console.log(`INFO B5-08 old-path recovery write failures: ${failedRecoveryWrites}`);
    const pendingAfter = (await recoveryEntries(fixture.store, "merge-tx"))
      .filter(entry => entry.file === journal.file || entry.payload.unbindEvents?.some(item => item.penId === pendingPen.id));
    check("any retained journal targets only the new document",
      pendingAfter.filter(entry => entry.payload.docPath !== targetPath ||
        entry.payload.sidecarPath !== fixture.sidecar(targetPath)).map(entry => entry.file), []);

    const expectedKey = targetPath + fact.dedupeKey.slice(sourcePath.length);
    for (const restart of [1, 2]) {
      const reopened = await fixture.fresh();
      check(`restart ${restart}: exactly one unbind event`, unbindEvents(reopened, pendingPen.id).length, 1);
      check(`restart ${restart}: fact belongs to new path only`, {
        old: reopened.getDocMeta(sourcePath).unbindEventKeys ?? [],
        next: reopened.getDocMeta(targetPath).unbindEventKeys ?? [],
        unrelated: reopened.getDocMeta(unrelatedPath).unbindEventKeys ?? [],
      }, { old: [], next: [expectedKey], unrelated: [] });
      check(`restart ${restart}: committed annotations moved only to new path`, {
        old: await fixture.read(sourcePath, reopened),
        next: await fixture.read(targetPath, reopened),
        unrelated: await fixture.read(unrelatedPath, reopened),
      }, {
        old: [],
        next: committed.map(item => ({ ...item, docPath: targetPath })),
        unrelated: [unrelated],
      });
      check(`restart ${restart}: new key has one unbound pen`,
        (await fixture.read(targetPath, reopened)).filter(item => item.id === pendingPen.id)
          .map(item => ({ path: item.docPath, host: item.hostAnnotationId ?? null })),
        [{ path: targetPath, host: null }]);
      check(`restart ${restart}: unrelated sidecar stays byte-identical`,
        fixture.disk.get(fixture.sidecar(unrelatedPath)), unrelatedRaw);
    }
  });
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  await mergeSurvivesRename();
}
