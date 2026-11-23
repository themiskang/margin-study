import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

await run();

async function run() {
  const project = resolve(process.argv[2] ?? process.cwd());
  const support = "scripts/verify/annotation-refs/invariant-r/fixture-support.mjs";
  const {
    captureFailure, fingerprint, memoryVault, oldPath, pen, run: runFixture, seed, sha256, stageMerge,
    unbindCount, verifyRecoveredJournal,
  } = await import(pathToFileURL(resolve(project, support)).href);

  await runFixture("B5-26", async (Store, check) => {
    const env = memoryVault(Store);
    const writer = await env.open();
    const otherPath = "z-other.pdf";
    await seed(env, writer, oldPath, "first-base");
    await seed(env, writer, otherPath, "other-base");
    const first = pen("first-pending", oldPath, { hostAnnotationId: "missing-first" });
    const other = pen("other-pending", otherPath, { hostAnnotationId: "missing-other" });
    const stagedFirst = await stageMerge(env, writer, oldPath, first);
    const stagedOther = await stageMerge(env, writer, otherPath, other);
    check("two real pending transactions precede the invalid sidecar reference", [
      stagedFirst.error, stagedOther.error,
      stagedFirst.copies.map(item => item.value.unbindEvents.map(event => event.penId)),
      stagedOther.copies.map(item => item.value.unbindEvents.map(event => event.penId)),
    ], [stagedFirst.fault, stagedOther.fault, [[first.id]], [[other.id]]]);
    const journal = stagedFirst.copies[0], otherJournal = stagedOther.copies[0];
    if (!journal || !otherJournal) return;

    const { contentDigest, ...payload } = journal.value;
    const wrongSidecar = { ...payload, sidecarPath: otherJournal.file, previousDiskRaw: null };
    const digest = value => sha256(JSON.stringify(value, (_key, entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      return Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]]));
    }));
    check("digest calculation matches the real journal's format", digest(payload), contentDigest);
    await env.adapter.write(journal.file, JSON.stringify({ ...wrongSidecar, contentDigest: digest(wrongSidecar) }));

    const before = fingerprint(env.disk, otherJournal.file);
    const removalStart = env.removals.length;
    let refusedSaves = 0;
    env.hooks.saveData = data => {
      if (data.localEvents?.some(event => event.objectIds.includes(other.id))) {
        refusedSaves++;
        throw new Error("FIXTURE_OTHER_TRANSACTION_MAIN_SAVE_BLOCKED");
      }
    };
    let started;
    let error;
    try { error = await captureFailure(async () => { started = await env.open(); }); }
    finally { env.hooks.saveData = null; }
    const after = fingerprint(env.disk, otherJournal.file);
    const removals = env.removals.slice(removalStart).filter(file => file === otherJournal.file).length;
    console.log("B5-26 other journal", JSON.stringify({ before, after, removals, refusedSaves }));
    check("failed main save prevents cleanup on behalf of the legitimate transaction",
      [error, refusedSaves, started ? unbindCount(started, other.id) : null], [null, 1, 0]);
    check("invalid sidecar reference leaves the other journal at its original path with zero deletes",
      { after, removals }, { after: before, removals: 0 });

    await verifyRecoveredJournal(env, check, otherJournal, other.id);
  });
}
