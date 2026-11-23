import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const project = resolve(process.argv[2] ?? process.cwd());
const support = pathToFileURL(resolve(project, "scripts/verify/annotation-refs/invariant-r/fixture-support.mjs"));
const {
  captureFailure, expectedUnbindFacts, fingerprint, memoryVault, oldPath, pen, persistedUnbindFacts,
  run, seed, sha256, unbindCount,
} = await import(support.href);

await run("B5-18", async (Store, check) => {
  const env = memoryVault(Store);
  const store = await env.open();
  const marker = pen("direct-unbound", oldPath, { hostAnnotationId: "missing-host" });
  await seed(env, store, oldPath, "direct-local");
  const sidecar = store.sidecarPath(oldPath);
  await env.adapter.write(sidecar, JSON.stringify({ annotations: [
    ...await store.loadAnnotations(oldPath), marker,
  ] }));

  let journal;
  let dropped = 0;
  env.hooks.write = (file, bytes) => {
    if (file.includes("pending-merge-tx-")) {
      const tx = JSON.parse(bytes);
      if (tx.docPath === oldPath && tx.unbindEvents?.some(event => event.penId === marker.id)) {
        journal ??= { file, bytes, tx };
      }
    }
    return bytes;
  };
  env.hooks.saveData = data => {
    if (dropped === 0 && data.localEvents?.some(event => event.kind === "conflict-merged" &&
      event.objectIds.includes(marker.id) && event.detail.includes("hostAnnotationId"))) {
      dropped++;
      return false;
    }
  };
  const removalStart = env.removals.length, renameStart = env.renames.length;
  let mergeError;
  try { mergeError = await captureFailure(() => store.resolveAnnotationConflict(oldPath, "merge")); }
  finally { env.hooks.saveData = null; env.hooks.write = null; }

  check("one main-data write containing the unbind event was silently dropped", dropped, 1);
  check("ordinary merge staged an unbind journal", journal !== undefined, true);
  if (!journal) return;
  const { file, bytes, tx } = journal;
  const before = sha256(bytes), after = fingerprint(env.disk, file);
  console.log("B5-18 unbind journal", JSON.stringify({ before, after, mergeError }));
  check("the sidecar committed, but main data has no unbind event or key",
    [fingerprint(env.disk, sidecar), persistedUnbindFacts(env.readMain(), tx)],
    [tx.expectedSidecarHash, { keys: [], events: [] }]);
  check("the unproved journal is neither removed nor renamed", {
    sha: after,
    removals: env.removals.slice(removalStart).filter(path => path === file),
    renames: env.renames.slice(renameStart).filter(([from]) => from === file),
  }, { sha: before, removals: [], renames: [] });

  for (const restart of [1, 2]) {
    const reopened = await env.open();
    check(`restart ${restart}: exactly one recovered unbind event`, unbindCount(reopened, marker.id), 1);
    check(`restart ${restart}: disk holds one unbind event and its key`,
      persistedUnbindFacts(env.readMain(), tx), expectedUnbindFacts(tx));
  }
});
