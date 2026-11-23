import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const project = resolve(process.argv[2] ?? process.cwd());
const support = pathToFileURL(resolve(project, "scripts/verify/annotation-refs/invariant-r/fixture-support.mjs"));
const {
  captureFailure, expectedUnbindFacts, fingerprint, memoryVault, oldPath, pen, persistedUnbindFacts,
  run, seed, sha256, stageMerge, unbindCount,
} = await import(support.href);

await run("B5-20", async (Store, check) => {
  const env = memoryVault(Store);
  const writer = await env.open();
  await seed(env, writer, oldPath, "event-proof-local");
  const marker = pen("event-proof-unbound", oldPath, { hostAnnotationId: "missing-host" });
  const staged = await stageMerge(env, writer, oldPath, marker);
  check("one genuine journal fact after main save failed",
    [staged.error, staged.copies.map(entry => entry.value.unbindEvents.map(event => event.penId))],
    [staged.fault, [[marker.id]]]);
  const journal = staged.copies[0];
  if (!journal) return;
  const { file, bytes, value: tx } = journal;
  const expected = expectedUnbindFacts(tx);

  const drops = [];
  env.hooks.saveData = data => {
    const facts = persistedUnbindFacts(data, tx);
    if (facts.events.length === 0) return;
    drops.push(facts);
    data.localEvents = data.localEvents.filter(event => !(event.kind === "conflict-merged" &&
      event.objectIds.includes(marker.id) && event.detail.includes("hostAnnotationId")));
  };
  const removalStart = env.removals.length, renameStart = env.renames.length;
  let bootError;
  try { bootError = await captureFailure(() => env.open()); }
  finally { env.hooks.saveData = null; }
  check("faulting restart completes and attempted to persist the actual event",
    [bootError, drops[0]], [null, expected]);
  check("disk proof is incomplete: matching sidecar and dedupeKey, but no event object", {
    sidecarSha: fingerprint(env.disk, tx.sidecarPath), facts: persistedUnbindFacts(env.readMain(), tx),
  }, { sidecarSha: tx.expectedSidecarHash, facts: { keys: expected.keys, events: [] } });
  const before = sha256(bytes), after = fingerprint(env.disk, file);
  console.log("B5-20 event proof journal", JSON.stringify({ before, after, eventWritesStripped: drops.length }));
  check("journal is retained without being renamed while the disk event is missing", {
    sha: after,
    removals: env.removals.slice(removalStart).filter(path => path === file),
    renames: env.renames.slice(renameStart).filter(([from]) => from === file),
  }, { sha: before, removals: [], renames: [] });

  for (const restart of [1, 2]) {
    const reopened = await env.open();
    check(`restart ${restart}: one recovered event despite the pre-existing key`,
      unbindCount(reopened, marker.id), 1);
    check(`restart ${restart}: disk holds the exact event and key once`,
      persistedUnbindFacts(env.readMain(), tx), expected);
  }
});
