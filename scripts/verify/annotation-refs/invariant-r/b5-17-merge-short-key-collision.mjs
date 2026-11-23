import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const project = resolve(process.argv[2] ?? process.cwd());
const support = pathToFileURL(resolve(project, "scripts/verify/annotation-refs/invariant-r/fixture-support.mjs"));
const {
  captureFailure, fingerprint, memoryVault, pen, persistedUnbindFacts, run, seed, sha256,
  stageMerge, verifyRecoveredJournal,
} = await import(support.href);

await run("B5-17", async (Store, check) => {
  const first = "collision-0-0018f25f.pdf";
  const second = "collision-0-00e756b3.pdf";
  const firstHash = sha256(first), secondHash = sha256(second);
  check("different full hashes share the expected 48-bit prefix",
    [firstHash !== secondHash, firstHash.slice(0, 12), secondHash.slice(0, 12)],
    [true, "2ed69fa2644e", "2ed69fa2644e"]);

  const env = memoryVault(Store);
  const store = await env.open();
  await seed(env, store, first, "first-local");
  await seed(env, store, second, "second-local");
  const marker = pen("second-unbound", second, { hostAnnotationId: "missing-host" });
  const staged = await stageMerge(env, store, second, marker);
  check("second document owns one pending unbind fact",
    [staged.error, staged.copies.map(entry => entry.value.unbindEvents.map(event => event.penId))],
    [staged.fault, [[marker.id]]]);
  const journal = staged.copies[0];
  if (!journal) return;
  const tx = journal.value;
  check("the second sidecar is committed, but the main data has no event or key",
    [fingerprint(env.disk, tx.sidecarPath), persistedUnbindFacts(env.readMain(), tx)],
    [tx.expectedSidecarHash, { keys: [], events: [] }]);

  const local = await store.loadAnnotations(first);
  await env.adapter.write(store.sidecarPath(first), JSON.stringify({
    annotations: [...local, pen("first-remote", first)],
  }));
  const foreignWrites = [];
  env.hooks.write = (file, bytes) => {
    if (file === journal.file && bytes !== journal.bytes) foreignWrites.push(JSON.parse(bytes).docPath);
    return bytes;
  };
  let mergeError;
  try { mergeError = await captureFailure(() => store.resolveAnnotationConflict(first, "merge")); }
  finally { env.hooks.write = null; }

  const before = sha256(journal.bytes);
  const after = fingerprint(env.disk, journal.file);
  console.log("B5-17 foreign journal before reopen", JSON.stringify({ before, after, mergeError }));
  check("merging the first document never overwrites the second journal key", foreignWrites, []);
  check("the second journal keeps its original SHA before any recovery", after, before);
  await verifyRecoveredJournal(env, check, journal, marker.id);
});
