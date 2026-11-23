import {
  captureFailure, expectedUnbindFacts, fingerprint, memoryVault, oldPath, pen, persistedUnbindFacts,
  run, seed, sha256, stageMerge, verifyRecoveredJournal,
} from "./fixture-support.mjs";

await run("B5-16", async (Store, check) => {
  const env = memoryVault(Store);
  const writer = await env.open();
  await seed(env, writer, oldPath, "durable");
  const marker = pen("disk-proof-unbound", oldPath, { hostAnnotationId: "missing-host" });
  const staged = await stageMerge(env, writer, oldPath, marker);
  check("one genuine journal fact after main save failed",
    [staged.error, staged.copies.map(entry => entry.value.unbindEvents.map(event => event.penId))],
    [staged.fault, [[marker.id]]]);
  const journal = staged.copies[0];
  if (!journal) return;
  const tx = journal.value;
  check("sidecar matches the journal before main data is persisted",
    fingerprint(env.disk, tx.sidecarPath), tx.expectedSidecarHash);

  const beforeMain = env.readMain();
  const saveAttempts = [];
  const removalStart = env.removals.length;
  const renameStart = env.renames.length;
  env.hooks.saveData = data => {
    saveAttempts.push(persistedUnbindFacts(data, tx));
    return false;
  };
  let bootError;
  try { bootError = await captureFailure(() => env.open()); }
  finally { env.hooks.saveData = null; }
  check("startup completes after adapter acknowledges a discarded main write", bootError, null);
  check("discarded main write carried the complete unbind event and key",
    saveAttempts.filter(attempt => attempt.events.length !== 0), [expectedUnbindFacts(tx)]);
  check("proof is absent: disk main has no unbind event or key and did not change", {
    facts: persistedUnbindFacts(env.readMain(), tx),
    mainSha: sha256(JSON.stringify(env.readMain())),
  }, { facts: { keys: [], events: [] }, mainSha: sha256(JSON.stringify(beforeMain)) });
  check("no proof after silent drop: the original journal bytes and path survive",
    fingerprint(env.disk, journal.file), sha256(journal.bytes));
  check("no proof after silent drop: journal was neither removed nor renamed", {
    removals: env.removals.slice(removalStart).filter(file => file === journal.file),
    renames: env.renames.slice(renameStart).filter(([from]) => from === journal.file),
  }, { removals: [], renames: [] });

  await verifyRecoveredJournal(env, check, journal, marker.id);
});
