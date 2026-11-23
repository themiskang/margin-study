import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { inspect, isDeepStrictEqual } from "node:util";
import { compileFunction } from "node:vm";

export const oldPath = "a.pdf";
export const newPath = "sub/b.pdf";
export const sha256 = value => createHash("sha256").update(value).digest("hex");
export const fingerprint = (disk, key) => disk.has(key) ? sha256(disk.get(key)) : null;
export const pen = (id, docPath, props = {}) => ({
  id, docPath, docKind: "pdf", page: 1, type: "pen", text: "", rects: [], color: "#204060",
  createdAt: "2026-11-24", inkWidth: 3, strokes: [[{ x: .15, y: .3 }, { x: .5, y: .3 }]], ...props,
});

function dependencyLoader(project) {
  const local = createRequire(join(project, "package.json"));
  try { local.resolve("esbuild"); return local; }
  catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    const commonGitDir = execFileSync("git", ["-C", project, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8" }).trim();
    return createRequire(join(dirname(commonGitDir), "package.json"));
  }
}

async function loadStore(project) {
  const require = dependencyLoader(project);
  const { build } = require("esbuild");
  const { outputFiles: [bundle] } = await build({
    absWorkingDir: project, entryPoints: ["src/model/store.ts"], bundle: true,
    platform: "node", format: "cjs", write: false,
    plugins: [{
      name: "fixture-obsidian",
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "fixture" }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `
            export class Notice { constructor() {} }
            export const Platform = { isMobile:false, isDesktop:true };
            export class TFile {}
            export class Component {}
            export class Modal {}
            export const MarkdownRenderer = {};
            export function setIcon() {}
          `,
          loader: "js",
        }));
      },
    }],
  });
  const module = { exports: {} };
  const fixtureConsole = { ...console, error() {}, info() {}, warn() {} };
  const execute = compileFunction(bundle.text, ["module", "exports", "require", "__dirname", "__filename", "console"],
    { filename: "marginstudy-round11-store.cjs" });
  execute(module, module.exports, require, project, join(project, "main.js"), fixtureConsole);
  return module.exports.Store;
}

export function memoryVault(Store) {
  const disk = new Map();
  const directories = new Set();
  const hooks = { read: null, write: null, remove: null, saveData: null };
  const removals = [];
  const renames = [];
  let mainData = null;
  const adapter = {
    exists: async path => disk.has(path) || directories.has(path),
    read: async path => {
      if (!disk.has(path)) throw new Error(`ENOENT ${path}`);
      const bytes = disk.get(path);
      return hooks.read ? hooks.read(path, bytes) : bytes;
    },
    readBinary: async path => new TextEncoder().encode(await adapter.read(path)).buffer,
    write: async (path, data) => {
      const stored = hooks.write ? await hooks.write(path, data) : data;
      disk.set(path, stored);
    },
    remove: async path => {
      hooks.remove?.(path);
      removals.push(path);
      disk.delete(path);
    },
    rename: async (from, to) => {
      if (!disk.has(from) || disk.has(to)) throw new Error(`Cannot rename ${from} to ${to}`);
      renames.push([from, to]);
      disk.set(to, disk.get(from));
      disk.delete(from);
    },
    mkdir: async path => { directories.add(path); },
    rmdir: async path => { directories.delete(path); },
    list: async path => ({
      files: [...disk.keys()].filter(key => dirname(key) === path),
      folders: [...directories].filter(key => dirname(key) === path),
    }),
    stat: async path => disk.has(path) ? { type: "file", mtime: 1, size: Buffer.byteLength(disk.get(path)) } : null,
  };
  const host = {
    app: { vault: { adapter, configDir: ".obsidian", getFiles: () => [], getAbstractFileByPath: () => null } },
    manifest: { id: "margin-study", version: "0.2.0" },
    loadData: async () => structuredClone(mainData),
    saveData: async data => {
      if ((await hooks.saveData?.(data)) !== false) mainData = structuredClone(data);
    },
  };
  const open = async () => {
    const store = new Store(host);
    await store.load();
    return store;
  };
  return { disk, adapter, hooks, removals, renames, open, readMain: () => structuredClone(mainData) };
}

export async function seed(env, store, path, annotationId) {
  await env.adapter.write(path, `%PDF-1.4 ${path}`);
  store.registerDocument(path);
  store.updateDocMeta(path, { bookmarks: [1] });
  await store.loadAnnotations(path);
  await store.saveAnnotationsNow(path, [pen(annotationId, path)]);
}

export function pending(env, category, path) {
  const prefix = `_marginstudy-recovery/pending-${category}-`;
  return [...env.disk].filter(([file]) => file.startsWith(prefix) && file.endsWith(".json"))
    .map(([file, bytes]) => ({ file, bytes, value: JSON.parse(bytes) }))
    .filter(entry => path === undefined || entry.value.docPath === path);
}

export async function captureFailure(action) {
  try { await action(); } catch (error) { return error.message; }
  return null;
}

export async function stageDraft(env, writer, path, annotation) {
  await writer.loadAnnotations(path);
  const sidecar = writer.sidecarPath(path);
  const fault = "FIXTURE_DRAFT_SIDECAR_WRITE";
  env.hooks.write = (file, data) => {
    if (file === sidecar) throw new Error(fault);
    return data;
  };
  let error;
  try { error = await captureFailure(() => writer.saveAnnotationsNow(path, [annotation])); }
  finally { env.hooks.write = null; }
  const copies = pending(env, "annotations", path).filter(entry =>
    entry.value.annotations.some(item => item.id === annotation.id));
  return { error, fault, copies };
}

export async function stageMerge(env, writer, path, marker) {
  const local = structuredClone(await writer.loadAnnotations(path));
  await env.adapter.write(writer.sidecarPath(path), JSON.stringify({ annotations: [...local, marker] }));
  const fault = "FIXTURE_MERGE_MAIN_SAVE";
  env.hooks.saveData = () => { throw new Error(fault); };
  let error;
  try { error = await captureFailure(() => writer.resolveAnnotationConflict(path, "merge")); }
  finally { env.hooks.saveData = null; }
  const copies = pending(env, "merge-tx", path).filter(entry => entry.value.unbindEvents?.some(event => event.penId === marker.id));
  return { error, fault, copies };
}

export function unbindCount(store, penId) {
  return store.getLocalEvents().filter(event => event.kind === "conflict-merged" &&
    event.objectIds.includes(penId) && event.detail.includes("hostAnnotationId")).length;
}

export function factKeys(store, path, penId) {
  return (store.getDocMeta(path).unbindEventKeys ?? []).filter(key => key.includes(`\0${penId}\0`));
}

export function persistedUnbindFacts(main, tx) {
  const penIds = tx.unbindEvents.map(event => event.penId);
  return {
    keys: Object.entries(main?.docMeta ?? {}).flatMap(([path, meta]) =>
      (meta.unbindEventKeys ?? []).filter(key => penIds.some(id => key.includes(`\0${id}\0`)))
        .map(key => [path, key])),
    events: (main?.localEvents ?? []).filter(event => event.kind === "conflict-merged" &&
      event.objectIds.some(id => penIds.includes(id)) && event.detail.includes("hostAnnotationId"))
      .map(event => ({ objectIds: event.objectIds, detail: event.detail })),
  };
}

export function expectedUnbindFacts(tx) {
  return {
    keys: tx.unbindEvents.map(event => [tx.docPath, event.dedupeKey]),
    events: tx.unbindEvents.map(event => ({ objectIds: [event.penId], detail: event.detail })),
  };
}

export function watchJournalRemoval(env, journal) {
  const proofs = [];
  env.hooks.remove = path => {
    if (path !== journal.file) return;
    const tx = journal.value;
    const main = env.readMain();
    const meta = main?.docMeta?.[tx.docPath];
    const matchingEntries = (field) => Object.entries(tx[field] ?? {})
      .every(([key, value]) => isDeepStrictEqual(meta?.[field]?.[key], value));
    proofs.push({
      sidecarHash: fingerprint(env.disk, tx.sidecarPath),
      facts: persistedUnbindFacts(main, tx),
      conflictMapMatches: matchingEntries("mergeConflictIdMap"),
      processedPensMatch: matchingEntries("mergeProcessedPens"),
    });
  };
  return proofs;
}

export async function verifyRecoveredJournal(env, check, journal, penId) {
  const tx = journal.value;
  const proofs = watchJournalRemoval(env, journal);
  const originalHash = sha256(journal.bytes);
  const renameStart = env.renames.length;
  let lastRestart = 2;
  for (let restart = 1; restart <= lastRestart; restart++) {
    const deletionsBeforeOpen = proofs.length;
    const reopened = await env.open();
    if (restart === lastRestart && deletionsBeforeOpen === 0 && proofs.length === 1) lastRestart++;
    check(`clean restart ${restart}: one fact, one key at the transaction path`, {
      events: unbindCount(reopened, penId),
      keys: factKeys(reopened, tx.docPath, penId),
    }, { events: 1, keys: tx.unbindEvents.map(event => event.dedupeKey) });
    check(`clean restart ${restart}: disk holds one fact and no other-path key`,
      persistedUnbindFacts(env.readMain(), tx), expectedUnbindFacts(tx));
    const journalHash = fingerprint(env.disk, journal.file);
    check(`clean restart ${restart}: journal ${proofs.length ? "deleted" : "retained"}`,
      { originalPathSha: journalHash, deletions: proofs.length },
      proofs.length === 0
        ? { originalPathSha: originalHash, deletions: 0 }
        : { originalPathSha: null, deletions: 1 });
  }
  check("clean recovery did not rename the journal",
    env.renames.slice(renameStart).filter(([from]) => from === journal.file), []);
  check("each deletion had complete disk proof before it occurred", proofs, proofs.map(() => ({
    sidecarHash: tx.expectedSidecarHash,
    facts: expectedUnbindFacts(tx),
    conflictMapMatches: true,
    processedPensMatch: true,
  })));
}

export function injectDraftMigration(env, draftId, faultyWrite) {
  const state = { writes: 0, reads: 0, file: null };
  env.hooks.write = (file, bytes) => {
    if (!file.startsWith("_marginstudy-recovery/pending-annotations-")) return bytes;
    const content = JSON.parse(bytes);
    if (content.docPath !== newPath || !content.annotations?.some(item => item.id === draftId)) return bytes;
    state.writes++;
    state.file = file;
    return faultyWrite(content);
  };
  env.hooks.read = (file, bytes) => {
    if (file === state.file) state.reads++;
    return bytes;
  };
  return state;
}

export async function run(name, scenario) {
  const project = resolve(process.argv[2] ?? process.cwd());
  let failed = false;
  const check = (label, actual, expected) => {
    if (isDeepStrictEqual(actual, expected)) {
      console.log(`PASS ${name} ${label}`);
      return;
    }
    failed = true;
    console.error(`FAIL ${name} ${label}\n  actual:   ${inspect(actual, { depth: null })}\n  expected: ${inspect(expected, { depth: null })}`);
  };
  try {
    await scenario(await loadStore(project), check);
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error(`ERROR ${name}\n  actual:   ${error.stack ?? error}\n  expected: 场景可完成采样`);
    process.exitCode = 2;
  }
}
