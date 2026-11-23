import {
  captureFailure, expectedUnbindFacts, factKeys, fingerprint, memoryVault, newPath, oldPath,
  pending, pen, persistedUnbindFacts, run, seed, sha256, stageMerge, unbindCount,
} from "./fixture-support.mjs";

function changeBody(bytes) {
  const copy = JSON.parse(bytes);
  copy.annotations[0].text = "different but valid sidecar with same IDs and count";
  return JSON.stringify(copy);
}

await run("B5-15", async (Store, check) => {
  for (const mode of ["old-matches", "new-matches", "both-match"]) {
    const env = memoryVault(Store);
    const writer = await env.open();
    await seed(env, writer, oldPath, "ordinary-annotation");
    const marker = pen("fork-unbound", oldPath, { hostAnnotationId: "missing-host" });
    const staged = await stageMerge(env, writer, oldPath, marker);
    check(`${mode}: one real unbind fact was journaled before rename`,
      [staged.error, staged.copies.map(entry => entry.value.unbindEvents.map(event => event.penId))],
      [staged.fault, [[marker.id]]]);
    const before = staged.copies[0];
    if (!before) continue;
    const oldSidecar = writer.sidecarPath(oldPath), newSidecar = writer.sidecarPath(newPath);
    const oldCommitted = env.disk.get(oldSidecar);
    check(`${mode}: original journal has the committed sidecar digest`, sha256(oldCommitted), before.value.expectedSidecarHash);
    check(`${mode}: public rename finishes`, await captureFailure(() => writer.renameDocument(oldPath, newPath)), null);
    const newCommitted = env.disk.get(newSidecar);
    if (newCommitted === undefined) throw new Error("Rename did not write a destination sidecar");
    const after = pending(env, "merge-tx", newPath).find(entry =>
      entry.value.unbindEvents?.some(event => event.penId === marker.id));
    const oldHash = sha256(oldPath), newHash = sha256(newPath);
    const newJournal = after?.file ?? before.file.replace(oldHash, newHash).replace(oldHash.slice(0, 12), newHash.slice(0, 12));
    const oldFactKey = before.value.unbindEvents[0].dedupeKey;
    const newFactKey = newPath + oldFactKey.slice(oldPath.length);
    const movedJournal = {
      ...before.value, ...after?.value, txId: before.value.txId, docPath: newPath, sidecarPath: newSidecar,
      expectedSidecarHash: sha256(newCommitted),
      unbindEvents: before.value.unbindEvents.map(event => ({
        ...event, dedupeKey: newPath + event.dedupeKey.slice(oldPath.length),
      })),
    };
    await env.adapter.write(oldSidecar, mode === "new-matches" ? changeBody(oldCommitted) : oldCommitted);
    await env.adapter.write(newSidecar, mode === "old-matches" ? changeBody(newCommitted) : newCommitted);
    await env.adapter.write(before.file, before.bytes);
    await env.adapter.write(newJournal, JSON.stringify(movedJournal));
    const protectedFiles = [oldSidecar, newSidecar, before.file, newJournal];
    const originalHashes = protectedFiles.map(file => fingerprint(env.disk, file));
    const removalStart = env.removals.length;
    const renameStart = env.renames.length;
    check(`${mode}: both branches exist and matching is decided by the content digest`, {
      distinctFiles: new Set(protectedFiles).size, oldMatch: originalHashes[0] === before.value.expectedSidecarHash,
      newMatch: originalHashes[1] === movedJournal.expectedSidecarHash,
    }, { distinctFiles: 4, oldMatch: mode !== "new-matches", newMatch: mode !== "old-matches" });
    const authorities = [];
    for (const restart of [1, 2]) {
      const reopened = await env.open();
      const oldKeys = factKeys(reopened, oldPath, marker.id), newKeys = factKeys(reopened, newPath, marker.id);
      check(`${mode} restart ${restart}: exactly one unbind event`, unbindCount(reopened, marker.id), 1);
      check(`${mode} restart ${restart}: one authoritative key across both branches`, oldKeys.length + newKeys.length, 1);
      if (mode === "old-matches") check(`${mode} restart ${restart}: match selected`, [oldKeys, newKeys], [[oldFactKey], []]);
      if (mode === "new-matches") check(`${mode} restart ${restart}: match selected`, [oldKeys, newKeys], [[], [newFactKey]]);
      const authority = oldKeys.length === 1 ? before.value : movedJournal;
      check(`${mode} restart ${restart}: disk has exactly the authoritative fact`,
        persistedUnbindFacts(env.readMain(), authority), expectedUnbindFacts(authority));
      authorities.push([...oldKeys, ...newKeys]);
      check(`${mode} restart ${restart}: both sidecars and both journals stay byte-identical`,
        protectedFiles.map(file => ({ file, sha256: fingerprint(env.disk, file) })),
        protectedFiles.map((file, index) => ({ file, sha256: originalHashes[index] })));
    }
    check(`${mode}: authority is stable across restarts`, authorities[1], authorities[0]);
    check(`${mode}: no cleanup proof while both branches exist`, {
      removals: env.removals.slice(removalStart).filter(file => protectedFiles.includes(file)),
      renames: env.renames.slice(renameStart).filter(([from]) => protectedFiles.includes(from)),
    }, { removals: [], renames: [] });
  }
});
