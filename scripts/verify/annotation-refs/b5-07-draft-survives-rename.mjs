import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const recoveryDir = "_marginstudy-recovery";
export const sha256 = value => createHash("sha256").update(value).digest("hex");

export async function loadSupport() {
  const project = resolve(process.argv[2] ?? process.cwd());
  const entry = resolve(project, "scripts/verify/annotation-refs/fixture-support.mjs");
  return import(pathToFileURL(entry));
}

export async function recoveryEntries(store, category) {
  const adapter = store.host.app.vault.adapter;
  const prefix = `${recoveryDir}/pending-${category}-`;
  const { files } = await adapter.list(recoveryDir);
  return Promise.all(files.filter(file => file.startsWith(prefix) && file.endsWith(".json")).map(async file => {
    const bytes = await adapter.read(file);
    return { file, bytes, payload: JSON.parse(bytes) };
  }));
}

export async function captureFailure(action) {
  try { await action(); } catch (error) { return error.message; }
  return null;
}

export async function seedDocument(fixture, path, annotations) {
  fixture.addPdf(path, `%PDF-1.4 ${path}`);
  fixture.store.registerDocument(path);
  fixture.store.updateDocMeta(path, { bookmarks: [1] });
  await fixture.store.loadAnnotations(path);
  await fixture.store.saveAnnotationsNow(path, annotations);
}

export async function leaveDraft(fixture, writer, path, draft) {
  const sidecar = writer.sidecarPath(path);
  const fault = "B5_FIXTURE_DRAFT_SIDECAR_WRITE";
  const priorHook = fixture.hooks.beforeWrite;
  let error;
  fixture.hooks.beforeWrite = file => {
    if (file === sidecar) throw new Error(fault);
    return priorHook?.(file);
  };
  try {
    await fixture.log(async () => {
      error = await captureFailure(() => writer.saveAnnotationsNow(path, [draft]));
    });
  } finally { fixture.hooks.beforeWrite = priorHook; }
  const entries = await draftsFor(writer, path, draft.id);
  return { error, fault, entries };
}

async function draftsFor(store, path, id) {
  return (await recoveryEntries(store, "annotations")).filter(entry =>
    entry.payload.docPath === path && entry.payload.annotations.some(item => item.id === id));
}

export function useReopenedStore(fixture, store) {
  fixture.store.host.store = store;
}

async function draftSurvivesRename() {
  const { run, renameFixture, pen, sourcePath, targetPath } = await loadSupport();
  await run("B5-07", async (project, check) => {
    const fixture = await renameFixture(project);
    const draft = pen("only-unsaved-draft", sourcePath, .43, { text: "唯一未保存的批注草稿" });
    const baseline = structuredClone(await fixture.store.loadAnnotations(sourcePath));
    const before = await leaveDraft(fixture, fixture.store, sourcePath, draft);
    check("initial sidecar write really failed", before.error, before.fault);
    check("one pending draft before rename", before.entries.map(entry => entry.payload.annotations), [[draft]]);
    const original = before.entries[0];
    if (!original) return;
    check("initial filename uses old document hash", original.file.startsWith(
      `${recoveryDir}/pending-annotations-${sha256(sourcePath).slice(0, 12)}`), true);
    check("draft exists only in the recovery copy before rename",
      JSON.parse(fixture.disk.get(fixture.sidecar(sourcePath))).annotations, baseline);

    const renamer = await fixture.fresh();
    useReopenedStore(fixture, renamer);
    fixture.emitRename(sourcePath, targetPath);
    await fixture.settled();
    check("rename completed without a notice", fixture.notices().filter(text => text.includes("关联更新")), []);
    check("exact old recovery file cleaned", fixture.disk.has(original.file), false);

    const reopened = await fixture.fresh();
    const newDrafts = await draftsFor(reopened, targetPath, draft.id);
    const expectedDraft = { ...draft, docPath: targetPath };
    check("one pending draft after restart, with identical content apart from docPath",
      newDrafts.map(entry => entry.payload.annotations), [[expectedDraft]]);
    check("draft is readable at the new path hash", newDrafts.map(entry => entry.file.startsWith(
      `${recoveryDir}/pending-annotations-${sha256(targetPath).slice(0, 12)}`)), [true]);
    check("no old-path recovery entries", (await recoveryEntries(reopened, "annotations"))
      .filter(entry => entry.payload.docPath === sourcePath).map(entry => entry.file), []);
    check("reopened document owns the new path",
      { old: await fixture.read(sourcePath, reopened), documents: reopened.documents.map(doc => doc.path) },
      { old: [], documents: [targetPath] });
  });
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  await draftSurvivesRename();
}
