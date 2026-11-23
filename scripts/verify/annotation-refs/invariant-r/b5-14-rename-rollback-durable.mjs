import { captureFailure, fingerprint, injectDraftMigration, memoryVault, newPath, oldPath, pending, pen, run, seed, sha256, stageDraft } from "./fixture-support.mjs";

await run("B5-14", async (Store, check) => {
  for (const mode of ["write-reject", "readback-count-mismatch"]) {
    const env = memoryVault(Store);
    const writer = await env.open();
    await seed(env, writer, oldPath, "durable");
    const oldSidecar = writer.sidecarPath(oldPath), newSidecar = writer.sidecarPath(newPath);
    const originalSidecar = fingerprint(env.disk, oldSidecar);
    const draft = pen("rollback-draft", oldPath, { text: "survive failed move" });
    const staged = await stageDraft(env, writer, oldPath, draft);
    check(`${mode}: one real pending draft`,
      [staged.error, staged.copies.map(entry => entry.value.annotations)], [staged.fault, [[draft]]]);
    const original = staged.copies[0];
    if (!original) continue;
    const renamer = await env.open();
    const fault = injectDraftMigration(env, draft.id, content => {
      if (mode === "write-reject") throw new Error("FIXTURE_NEW_PENDING_WRITE");
      return JSON.stringify({ ...content, annotations: [] });
    });
    let failure;
    try { failure = await captureFailure(() => renamer.renameDocument(oldPath, newPath)); }
    finally { env.hooks.read = null; env.hooks.write = null; }
    check(`${mode}: target pending write reached`, fault.writes > 0, true);
    if (mode === "readback-count-mismatch") check(`${mode}: corrupted record was read back`, fault.reads > 0, true);
    check(`${mode}: rename reported failure`, !!failure, true);
    const reopened = await env.open();
    check(`${mode}: cold start registry and sidecar agree on the original path`, {
      registered: reopened.documents.map(item => item.path),
      oldSidecar: fingerprint(env.disk, oldSidecar),
      newSidecar: fingerprint(env.disk, newSidecar),
      oldIds: (await reopened.loadAnnotations(oldPath)).map(item => item.id),
      newIds: (await reopened.loadAnnotations(newPath)).map(item => item.id),
    }, { registered: [oldPath], oldSidecar: originalSidecar, newSidecar: null, oldIds: ["durable"], newIds: [] });
    const beforeSha = sha256(original.bytes), afterSha = fingerprint(env.disk, original.file);
    console.log(`INFO B5-14 ${mode} old draft SHA-256 before=${beforeSha} after=${afterSha ?? "MISSING"}`);
    check(`${mode}: old draft remains byte-identical and readable after restart`, {
      digest: afterSha, drafts: pending(env, "annotations", oldPath).flatMap(entry => entry.value.annotations)
        .filter(item => item.id === draft.id),
    }, { digest: beforeSha, drafts: [draft] });
  }
});
