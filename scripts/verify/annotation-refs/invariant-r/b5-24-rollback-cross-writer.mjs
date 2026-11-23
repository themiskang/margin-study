import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const project = resolve(process.argv[2] ?? process.cwd());
const support = pathToFileURL(resolve(project, "scripts/verify/annotation-refs/invariant-r/fixture-support.mjs"));
const {
  captureFailure, fingerprint, memoryVault, newPath, oldPath, pending, pen, run, seed, sha256, stageDraft,
} = await import(support.href);

await run("B5-24", async (Store, check) => {
  const env = memoryVault(Store);
  const peer = memoryVault(Store);
  const writer = await env.open();
  const peerWriter = await peer.open();
  await seed(env, writer, oldPath, "shared-committed");
  await seed(peer, peerWriter, oldPath, "shared-committed");
  const localPen = pen("local-rollback-draft", oldPath, { text: "local unsaved strokes" });
  const peerPen = pen("peer-rollback-draft", oldPath, { text: "peer unsaved strokes" });
  const localStage = await stageDraft(env, writer, oldPath, localPen);
  const peerStage = await stageDraft(peer, peerWriter, oldPath, peerPen);
  check("independent writers each left one unsaved draft for the same source document", {
    failures: [localStage.error, peerStage.error], local: localStage.copies.length, peer: peerStage.copies.length,
  }, { failures: [localStage.fault, peerStage.fault], local: 1, peer: 1 });
  const localOriginal = localStage.copies[0], peerOriginal = peerStage.copies[0];
  if (!localOriginal || !peerOriginal) return;
  check("draft transactions have separate identities",
    [localOriginal.value.docPath, peerOriginal.value.docPath,
      typeof localOriginal.value.txId === "string" && typeof peerOriginal.value.txId === "string" &&
      localOriginal.value.txId !== peerOriginal.value.txId],
    [oldPath, oldPath, true]);

  const peerRenamer = await peer.open();
  await peerRenamer.loadAnnotations(oldPath);
  await peerRenamer.renameDocument(oldPath, newPath);
  const peerCopies = pending(peer, "annotations", newPath)
    .filter(entry => entry.value.annotations.some(annotation => annotation.id === peerPen.id));
  check("peer writer stages its own pending version for the rename destination", peerCopies.length, 1);
  const peerMoved = peerCopies[0];
  if (!peerMoved) return;

  const renamer = await env.open();
  await renamer.loadAnnotations(oldPath);
  check("peer bytes have not arrived at the shared destination slot", env.disk.has(peerMoved.file), false);
  let replaced = 0;
  let localTxAtDestination;
  env.hooks.write = (file, bytes) => {
    if (file !== peerMoved.file) return bytes;
    const value = JSON.parse(bytes);
    if (value.docPath === newPath && value.annotations?.some(annotation => annotation.id === localPen.id)) {
      replaced++;
      localTxAtDestination = value.txId;
      return peerMoved.bytes;
    }
    return bytes;
  };
  let error;
  try { error = await captureFailure(() => renamer.renameDocument(oldPath, newPath)); }
  finally { env.hooks.write = null; }
  check("readback of our migrated draft encountered the peer's competing write and triggered rollback", {
    replaced, ourTransaction: localTxAtDestination,
    peerTransactionDiffers: localTxAtDestination !== peerMoved.value.txId, failed: !!error,
  }, { replaced: 1, ourTransaction: localOriginal.value.txId, peerTransactionDiffers: true, failed: true });

  const before = sha256(peerMoved.bytes);
  const after = fingerprint(env.disk, peerMoved.file);
  console.log("B5-24 peer draft", JSON.stringify({ before, after, replaced, error }));
  check("rename rollback preserves the peer draft at the shared slot byte-for-byte", after, before);
  check("rename rollback preserves the original local draft",
    fingerprint(env.disk, localOriginal.file), sha256(localOriginal.bytes));
  check("the rolled-back sidecar exists only at the old path",
    [env.disk.has(renamer.sidecarPath(oldPath)), env.disk.has(renamer.sidecarPath(newPath))], [true, false]);

  for (const restart of [1, 2]) {
    const reopened = await env.open();
    const copies = pending(env, "annotations");
    const pathsFor = id => copies.filter(entry => entry.value.annotations.some(annotation => annotation.id === id))
      .map(entry => entry.value.docPath).sort();
    check(`restart ${restart}: exactly the two expected pending facts, with no local destination artifact`, {
      localDrafts: pathsFor(localPen.id), peerDrafts: pathsFor(peerPen.id),
      peerSha: fingerprint(env.disk, peerMoved.file),
    }, { localDrafts: [oldPath], peerDrafts: [newPath], peerSha: before });
    check(`restart ${restart}: only the old path and its committed annotation are active`, {
      documents: reopened.documents.map(doc => doc.path),
      oldAnnotations: (await reopened.loadAnnotations(oldPath)).map(annotation => annotation.id),
      newAnnotations: (await reopened.loadAnnotations(newPath)).map(annotation => annotation.id),
    }, { documents: [oldPath], oldAnnotations: ["shared-committed"], newAnnotations: [] });
  }
});
