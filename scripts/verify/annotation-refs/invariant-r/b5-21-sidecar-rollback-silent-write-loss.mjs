import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const project = resolve(process.argv[2] ?? process.cwd());
const support = pathToFileURL(resolve(project, "scripts/verify/annotation-refs/invariant-r/fixture-support.mjs"));
const {
  captureFailure, expectedUnbindFacts, fingerprint, memoryVault, oldPath, pen, persistedUnbindFacts,
  run, seed, sha256, stageMerge, verifyRecoveredJournal,
} = await import(support.href);

await run("B5-21", async (Store, check) => {
  const env = memoryVault(Store);
  const writer = await env.open();
  const marker = pen("rollback-fact", oldPath, { hostAnnotationId: "missing-host" });
  await seed(env, writer, oldPath, "rollback-base");
  const staged = await stageMerge(env, writer, oldPath, marker);
  check("one pending fact after the main save fails",
    [staged.error, staged.copies.map(entry => entry.value.unbindEvents.map(event => event.penId))],
    [staged.fault, [[marker.id]]]);
  const journal = staged.copies[0];
  if (!journal) return;
  const tx = journal.value;
  const committedSidecar = env.disk.get(tx.sidecarPath);
  check("sidecar was committed while main data is still missing the event",
    [sha256(committedSidecar), persistedUnbindFacts(env.readMain(), tx)],
    [tx.expectedSidecarHash, { keys: [], events: [] }]);

  const partial = '{"annotations":[';
  await env.adapter.write(tx.sidecarPath, partial);
  let dropped = 0;
  env.hooks.write = (file, bytes) => {
    if (file === tx.sidecarPath && bytes === tx.previousDiskRaw) {
      dropped++;
      return partial;
    }
    return bytes;
  };
  const removalStart = env.removals.length;
  const renameStart = env.renames.length;
  let openError;
  try { openError = await captureFailure(() => env.open()); }
  finally { env.hooks.write = null; }
  const expectedRollbackSha = sha256(tx.previousDiskRaw);
  const actualSidecarSha = fingerprint(env.disk, tx.sidecarPath);
  check("rollback adapter acknowledged one write and left truncated bytes on disk",
    [openError, dropped, actualSidecarSha, actualSidecarSha === expectedRollbackSha],
    [null, 1, sha256(partial), false]);

  const before = sha256(journal.bytes);
  const after = fingerprint(env.disk, journal.file);
  console.log("B5-21 journal SHA", JSON.stringify({ before, after, expectedRollbackSha, actualSidecarSha }));
  check("without a proved rollback the original journal stays at its exact path", {
    sha: after,
    removals: env.removals.slice(removalStart).filter(file => file === journal.file),
    renames: env.renames.slice(renameStart).filter(([from]) => from === journal.file),
  }, { sha: before, removals: [], renames: [] });

  await env.adapter.write(tx.sidecarPath, committedSidecar);
  check("repair restores the original committed sidecar bytes", fingerprint(env.disk, tx.sidecarPath), tx.expectedSidecarHash);
  await verifyRecoveredJournal(env, check, journal, marker.id);
});
