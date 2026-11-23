import {
  captureFailure, expectedUnbindFacts, factKeys, fingerprint, memoryVault, pending, pen,
  persistedUnbindFacts, run, seed, sha256, stageMerge, unbindCount, verifyRecoveredJournal,
} from "./fixture-support.mjs";

await run("B5-13", async (Store, check) => {
  const env = memoryVault(Store);
  const store = await env.open();
  const oldPath = "old/a.pdf", newPath = "relocated/sub/a.pdf";
  await seed(env, store, oldPath, "folder-base");
  const marker = pen("folder-unbound", oldPath, { hostAnnotationId: "missing-host" });
  const staged = await stageMerge(env, store, oldPath, marker);
  check("one actual journal with one fact before host move",
    [staged.error, staged.copies.map(entry => entry.value.unbindEvents.map(event => event.penId))],
    [staged.fault, [[marker.id]]]);
  const original = staged.copies[0];
  if (!original) return;
  const originalHash = fingerprint(env.disk, store.sidecarPath(oldPath));
  check("original sidecar digest matches the journal claim", originalHash, original.value.expectedSidecarHash);
  await env.adapter.rename(oldPath, newPath);
  await env.adapter.rename(store.sidecarPath(oldPath), store.sidecarPath(newPath));
  check("host already moved the sidecar before Store rename",
    [env.disk.has(store.sidecarPath(oldPath)), fingerprint(env.disk, store.sidecarPath(newPath))], [false, originalHash]);
  check("Store folder-child migration succeeds", await captureFailure(() => store.renameDocument(oldPath, newPath)), null);
  const moved = pending(env, "merge-tx", newPath).filter(entry =>
    entry.value.unbindEvents?.some(event => event.penId === marker.id));
  const nextHash = fingerprint(env.disk, store.sidecarPath(newPath));
  check("new sidecar really has a different byte digest", nextHash !== null && nextHash !== originalHash, true);
  check("migrated journal claims the actual current sidecar digest",
    moved.map(entry => ({ path: entry.value.sidecarPath, hash: entry.value.expectedSidecarHash })),
    [{ path: store.sidecarPath(newPath), hash: nextHash }]);
  const journal = moved[0];
  if (!journal || journal.value.expectedSidecarHash !== nextHash) return;
  const expectedKey = newPath + original.value.unbindEvents[0].dedupeKey.slice(oldPath.length);
  check("migrated journal key names the new path only",
    journal.value.unbindEvents.map(event => event.dedupeKey), [expectedKey]);
  await verifyRecoveredJournal(env, check, journal, marker.id);

  const movedSidecar = store.sidecarPath(newPath);
  const committedBytes = env.disk.get(movedSidecar);
  const externalBytes = JSON.stringify(JSON.parse(committedBytes), null, 2) + "\n";
  if (!env.disk.has(journal.file)) await env.adapter.write(journal.file, journal.bytes);
  await env.adapter.write(movedSidecar, externalBytes);
  check("proof is absent: external serialization preserves records but changes the expected hash", {
    sameRecords: JSON.stringify(JSON.parse(externalBytes)) === JSON.stringify(JSON.parse(committedBytes)),
    hashMatches: fingerprint(env.disk, movedSidecar) === journal.value.expectedSidecarHash,
    journalSha: fingerprint(env.disk, journal.file),
  }, { sameRecords: true, hashMatches: false, journalSha: sha256(journal.bytes) });
  const removalStart = env.removals.length;
  const renameStart = env.renames.length;
  for (const restart of [1, 2]) {
    const reopened = await env.open();
    check(`mismatch restart ${restart}: exactly one fact at the new path only`, {
      count: unbindCount(reopened, marker.id),
      old: factKeys(reopened, oldPath, marker.id),
      next: factKeys(reopened, newPath, marker.id),
    }, { count: 1, old: [], next: [expectedKey] });
    check(`mismatch restart ${restart}: disk fact and key are complete and unique`,
      persistedUnbindFacts(env.readMain(), journal.value), expectedUnbindFacts(journal.value));
    check(`mismatch restart ${restart}: keep journal and external sidecar at original paths`,
      [fingerprint(env.disk, journal.file), fingerprint(env.disk, movedSidecar)],
      [sha256(journal.bytes), sha256(externalBytes)]);
  }
  check("hash mismatch: journal was neither removed nor renamed", {
    removals: env.removals.slice(removalStart).filter(file => file === journal.file),
    renames: env.renames.slice(renameStart).filter(([from]) => from === journal.file),
  }, { removals: [], renames: [] });
});
