import { captureFailure, fingerprint, injectDraftMigration, memoryVault, newPath, oldPath, pending, pen, run, seed, sha256, stageDraft } from "./fixture-support.mjs";

await run("B5-10", async (Store, check) => {
  const env = memoryVault(Store);
  const writer = await env.open();
  await seed(env, writer, oldPath, "durable");
  const draft = pen("sole-draft", oldPath, { text: "original draft body" });
  const staged = await stageDraft(env, writer, oldPath, draft);
  check("one genuine draft produced by the injected sidecar failure",
    [staged.error, staged.copies.map(entry => entry.value.annotations)], [staged.fault, [[draft]]]);
  const original = staged.copies[0];
  if (!original) return;
  const beforeSha = sha256(original.bytes);
  const renamer = await env.open();
  let injectedShape;
  const fault = injectDraftMigration(env, draft.id, content => {
    content.annotations[0].text = "corrupted body with identical record count";
    injectedShape = { path: content.docPath, annotationPaths: content.annotations.map(item => item.docPath),
      ids: content.annotations.map(item => item.id), count: content.annotations.length, body: content.annotations[0].text };
    return JSON.stringify(content);
  });
  let error;
  try { error = await captureFailure(() => renamer.renameDocument(oldPath, newPath)); }
  finally { env.hooks.read = null; env.hooks.write = null; }
  check("injected write was read back", [fault.writes > 0, fault.reads > 0], [true, true]);
  check("only the draft body differs in the readback",
    injectedShape, { path: newPath, annotationPaths: [newPath], ids: [draft.id], count: 1,
      body: "corrupted body with identical record count" });
  const afterSha = fingerprint(env.disk, original.file);
  console.log(`INFO B5-10 old snapshot SHA-256 before=${beforeSha} after=${afterSha ?? "MISSING"}, rename=${error ?? "success"}`);
  check("original snapshot still exists byte-for-byte", afterSha, beforeSha);
  check("original snapshot was never removed", env.removals.includes(original.file), false);
  check("no published destination draft contains corrupted text",
    pending(env, "annotations", newPath).flatMap(entry => entry.value.annotations)
      .filter(item => item.id === draft.id && item.text !== draft.text), []);
});
