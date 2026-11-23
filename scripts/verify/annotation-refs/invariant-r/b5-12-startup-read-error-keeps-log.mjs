import {
  captureFailure, fingerprint, memoryVault, oldPath, pen, persistedUnbindFacts, run, seed,
  sha256, stageMerge, verifyRecoveredJournal,
} from "./fixture-support.mjs";

await run("B5-12", async (Store, check) => {
  const env = memoryVault(Store);
  const writer = await env.open();
  await seed(env, writer, oldPath, "durable");
  const marker = pen("startup-unbound", oldPath, { hostAnnotationId: "missing-host" });
  const staged = await stageMerge(env, writer, oldPath, marker);
  check("one genuine journal fact after main save failed",
    [staged.error, staged.copies.map(entry => entry.value.unbindEvents.map(event => event.penId))],
    [staged.fault, [[marker.id]]]);
  const original = staged.copies[0];
  if (!original) return;
  check("journal describes an already committed sidecar",
    fingerprint(env.disk, writer.sidecarPath(oldPath)), original.value.expectedSidecarHash);
  check("disk main data does not yet cover the transaction",
    persistedUnbindFacts(env.readMain(), original.value), { keys: [], events: [] });
  const removalStart = env.removals.length;
  const renameStart = env.renames.length;
  let failures = 0;
  env.hooks.read = (file, bytes) => {
    if (file === original.file && failures === 0) {
      failures++;
      throw new Error("FIXTURE_TRANSIENT_JOURNAL_READ");
    }
    return bytes;
  };
  let firstError;
  try { firstError = await captureFailure(() => env.open()); }
  finally { env.hooks.read = null; }
  check("startup experienced exactly one transient read error", failures, 1);
  check("first Store startup completes", firstError, null);
  check("no proof after read error: journal survives at its original path",
    fingerprint(env.disk, original.file), sha256(original.bytes));
  check("no proof after read error: journal was neither removed nor renamed", {
    removals: env.removals.slice(removalStart).filter(file => file === original.file),
    renames: env.renames.slice(renameStart).filter(([from]) => from === original.file),
  }, { removals: [], renames: [] });
  await verifyRecoveredJournal(env, check, original, marker.id);
});
