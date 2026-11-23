import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const project = resolve(process.argv[2] ?? process.cwd());
const support = pathToFileURL(resolve(project, "scripts/verify/annotation-refs/invariant-r/fixture-support.mjs"));
const {
  expectedUnbindFacts, fingerprint, memoryVault, oldPath, pen, persistedUnbindFacts,
  run, seed, sha256, stageMerge, unbindCount,
} = await import(support.href);

await run("B5-19", async (Store, check) => {
  const env = memoryVault(Store);
  const writer = await env.open();
  await seed(env, writer, oldPath, "gc-local");
  const marker = pen("gc-unbound", oldPath, { hostAnnotationId: "missing-host" });
  const staged = await stageMerge(env, writer, oldPath, marker);
  check("one genuine journal fact after main save failed",
    [staged.error, staged.copies.map(entry => entry.value.unbindEvents.map(event => event.penId))],
    [staged.fault, [[marker.id]]]);
  const journal = staged.copies[0];
  if (!journal) return;
  const tx = journal.value;
  const recovered = await env.open();
  check("cold recovery persists exactly one fact before staging the tombstone", {
    count: unbindCount(recovered, marker.id), facts: persistedUnbindFacts(env.readMain(), tx),
  }, { count: 1, facts: expectedUnbindFacts(tx) });

  const tombstone = `${journal.file}.superseded-${Date.now()}`;
  await env.adapter.write(tombstone, journal.bytes);
  const before = fingerprint(env.disk, tombstone);
  await env.open();
  check("one clean observation leaves the tombstone available for the next startup",
    fingerprint(env.disk, tombstone), before);
  const sidecar = JSON.parse(env.disk.get(tx.sidecarPath));
  const ink = sidecar.annotations.find(annotation => annotation.id === marker.id);
  ink.strokes[0][0].x += 0.05;
  await env.adapter.write(tx.sidecarPath, JSON.stringify(sidecar));
  check("changed strokes invalidate the transaction's sidecar hash",
    fingerprint(env.disk, tx.sidecarPath) === tx.expectedSidecarHash, false);

  const removalStart = env.removals.length, renameStart = env.renames.length;
  const mismatched = await env.open();
  const afterMismatch = fingerprint(env.disk, tombstone);
  check("hash mismatch: the original tombstone bytes and the single fact survive",
    [afterMismatch, unbindCount(mismatched, marker.id)], [sha256(journal.bytes), 1]);

  let readErrors = 0;
  env.hooks.read = (file, bytes) => {
    if (file === tombstone && readErrors === 0) {
      readErrors++;
      throw new Error("FIXTURE_TOMBSTONE_READ_ERROR");
    }
    return bytes;
  };
  let afterFault;
  try { afterFault = await env.open(); }
  finally { env.hooks.read = null; }
  const afterError = fingerprint(env.disk, tombstone);
  console.log("B5-19 tombstone", JSON.stringify({ before, afterMismatch, afterError, readErrors }));
  check("a subsequent startup reaches the injected tombstone read error", readErrors, 1);
  check("read error: the original tombstone bytes and the single fact survive",
    [afterError, unbindCount(afterFault, marker.id)], [sha256(journal.bytes), 1]);
  check("tombstone was never removed or renamed without proof", {
    removals: env.removals.slice(removalStart).filter(file => file === tombstone),
    renames: env.renames.slice(renameStart).filter(([from]) => from === tombstone),
    facts: persistedUnbindFacts(env.readMain(), tx),
  }, { removals: [], renames: [], facts: expectedUnbindFacts(tx) });
});
