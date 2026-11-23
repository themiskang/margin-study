import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const project = resolve(process.argv[2] ?? process.cwd());
const support = pathToFileURL(resolve(project, "scripts/verify/annotation-refs/invariant-r/fixture-support.mjs"));
const {
  expectedUnbindFacts, fingerprint, memoryVault, newPath, oldPath, pending, pen, persistedUnbindFacts,
  run, seed, sha256, stageMerge, unbindCount,
} = await import(support.href);

function transactionDigest(tx) {
  const { contentDigest, ...payload } = tx;
  const canonical = JSON.stringify(payload, (_key, entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    return Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]]));
  });
  return sha256(canonical);
}

await run("B5-22", async (Store, check) => {
  for (const mode of ["self-consistent-link", "mismatched-link-with-durable-other-tx"]) {
    const env = memoryVault(Store);
    const writer = await env.open();
    const originalPen = pen("migration-fact", oldPath, { hostAnnotationId: "missing-host" });
    await seed(env, writer, oldPath, "migration-base");
    const staged = await stageMerge(env, writer, oldPath, originalPen);
    check(`${mode}: original transaction contains one pending unbind fact`,
      [staged.error, staged.copies.map(entry => entry.value.unbindEvents.map(event => event.penId))],
      [staged.fault, [[originalPen.id]]]);
    const original = staged.copies[0];
    if (!original) continue;
    await writer.renameDocument(oldPath, newPath);
    const destination = pending(env, "merge-tx", newPath)[0];
    const tombstone = [...env.disk.keys()].find(file => file.startsWith(`${original.file}.superseded-`));
    check(`${mode}: the real rename produces a tombstone and successor`, [!!tombstone, !!destination], [true, true]);
    if (!tombstone || !destination) continue;
    const tomb = JSON.parse(await env.adapter.read(tombstone));
    check(`${mode}: production link names the original transaction's successor and digest`,
      [tomb.supersededBy, tomb.supersededDigest, tomb.txId],
      [destination.file, destination.value.contentDigest, destination.value.txId]);

    const otherVault = memoryVault(Store);
    const otherWriter = await otherVault.open();
    const otherPen = pen("unrelated-fact", newPath, { hostAnnotationId: "different-host" });
    await seed(otherVault, otherWriter, newPath, "other-base");
    const stagedOther = await stageMerge(otherVault, otherWriter, newPath, otherPen);
    check(`${mode}: a different transaction journals its own fact`,
      [stagedOther.error, stagedOther.copies.map(entry => entry.value.unbindEvents.map(event => event.penId))],
      [stagedOther.fault, [[otherPen.id]]]);
    const other = stagedOther.copies[0];
    if (!other) continue;
    const tx = other.value;
    const digest = transactionDigest(tx);
    check(`${mode}: the replacement is self-consistent and unrelated`,
      [digest, tx.txId === tomb.txId, tx.unbindEvents.some(event => event.penId === originalPen.id)],
      [tx.contentDigest, false, false]);
    await env.adapter.write(tx.sidecarPath, otherVault.disk.get(tx.sidecarPath));
    await env.adapter.write(destination.file, other.bytes);
    if (mode === "self-consistent-link") {
      await env.adapter.write(tombstone, JSON.stringify({ ...tomb, supersededDigest: digest }));
    }
    const storedTomb = JSON.parse(await env.adapter.read(tombstone));
    check(`${mode}: both cases use the real successor path, with the intended digest relation`,
      [storedTomb.supersededBy, storedTomb.supersededDigest === digest,
        persistedUnbindFacts(env.readMain(), original.value)],
      [destination.file, mode === "self-consistent-link", { keys: [], events: [] }]);

    const before = fingerprint(env.disk, tombstone);
    const removalStart = env.removals.length;
    const renameStart = env.renames.length;
    env.hooks.remove = file => {
      if (file === destination.file) throw new Error("FIXTURE_KEEP_OTHER_SUCCESSOR_FOR_GC");
    };
    try {
      for (const restart of [1, 2]) {
        const reopened = await env.open();
        const after = fingerprint(env.disk, tombstone);
        const diskMain = env.readMain();
        const diskMeta = diskMain?.docMeta?.[tx.docPath];
        const mappingsMatch = ["mergeConflictIdMap", "mergeProcessedPens"].every(field =>
          Object.entries(tx[field] ?? {}).every(([key, value]) => isDeepStrictEqual(diskMeta?.[field]?.[key], value)));
        console.log(`B5-22 ${mode} restart ${restart}`, JSON.stringify({
          before, after, linkedDigest: storedTomb.supersededDigest, otherDigest: digest,
          originalEvents: unbindCount(reopened, originalPen.id), otherEvents: unbindCount(reopened, otherPen.id),
        }));
        check(`${mode} restart ${restart}: the other transaction alone has proof on disk`, {
          sidecarSha: fingerprint(env.disk, tx.sidecarPath),
          facts: persistedUnbindFacts(diskMain, tx),
          otherEvents: unbindCount(reopened, otherPen.id),
          mappingsMatch,
          originalFacts: persistedUnbindFacts(diskMain, original.value),
        }, { sidecarSha: tx.expectedSidecarHash, facts: expectedUnbindFacts(tx), otherEvents: 1,
          mappingsMatch: true, originalFacts: { keys: [], events: [] } });
        check(`${mode} restart ${restart}: the original tombstone retains its exact bytes`, after, before);
      }
    } finally { env.hooks.remove = null; }
    check(`${mode}: no remove or rename of the original tombstone`, {
      removals: env.removals.slice(removalStart).filter(file => file === tombstone),
      renames: env.renames.slice(renameStart).filter(([from]) => from === tombstone),
    }, { removals: [], renames: [] });
  }
});
