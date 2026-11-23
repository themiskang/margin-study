import { captureFailure, fingerprint, memoryVault, newPath, oldPath, pending, pen, run, seed, sha256, stageDraft } from "./fixture-support.mjs";

await run("B5-11", async (Store, check) => {
  const env = memoryVault(Store);
  const renamer = await env.open();
  const controlPath = "keep-control.pdf", unrelatedPath = "unrelated-draft.pdf";
  for (const [path, id] of [[oldPath, "rename-base"], [controlPath, "control-base"], [unrelatedPath, "unrelated-base"]]) {
    await seed(env, renamer, path, id);
  }
  const writer = await env.open();
  const draft = pen("unique-unrelated-draft", unrelatedPath, { text: "only uncommitted copy" });
  const staged = await stageDraft(env, writer, unrelatedPath, draft);
  check("unrelated sidecar write failed and left exactly one draft",
    [staged.error, staged.copies.map(entry => entry.value.annotations)], [staged.fault, [[draft]]]);
  const original = staged.copies[0];
  if (!original) return;
  const before = pending(env, "annotations");
  check("three rolling snapshots at the quota boundary", before.map(entry => entry.value.docPath).sort(),
    [oldPath, controlPath, unrelatedPath].sort());
  check("three snapshots share the same writer", [...new Set(before.map(entry => entry.value.writerId))],
    [original.value.writerId]);
  check("durable unrelated sidecar does not contain the draft",
    JSON.parse(env.disk.get(renamer.sidecarPath(unrelatedPath))).annotations.map(item => item.id), ["unrelated-base"]);
  const removedFrom = env.removals.length;
  check("rename succeeds", await captureFailure(() => renamer.renameDocument(oldPath, newPath)), null);
  const reopened = await env.open();
  check("reopened Store contains the renamed document", reopened.documents.some(item => item.path === newPath), true);
  const beforeSha = sha256(original.bytes);
  const afterSha = fingerprint(env.disk, original.file);
  console.log(`INFO B5-11 unrelated draft SHA-256 before=${beforeSha} after=${afterSha ?? "MISSING"}`);
  check("unrelated draft file survives quota enforcement", afterSha, beforeSha);
  check("unrelated draft was never removed", env.removals.slice(removedFrom).includes(original.file), false);
});
