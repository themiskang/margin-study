import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, stat, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "marginstudy-a29-"));
const bundle = join(temporary, "fixture.cjs");
const built = await build({ stdin: { contents: 'export {Store} from "../model/store"; export * as imports from "./webImport"; export {TFile} from "obsidian";', resolveDir: here }, bundle: true, platform: "node", format: "cjs", write: false,
  plugins: [{ name: "synthetic-obsidian", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "synthetic" }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: 'export class App {} export class Notice {} export class TFolder {} export class TFile { constructor(path) { this.path=path; this.name=path.split("/").pop(); this.extension=this.name.split(".").pop(); this.basename=this.name.replace(/\\.[^.]+$/,""); this.stat={size:0}; } } export class Component {} export const MarkdownRenderer={render:async()=>{}}; export function sanitizeHTMLToDom(){} export async function requestUrl(){}' }));
  } }] });
await writeFile(bundle, built.outputFiles[0].contents);
const { Store, TFile, imports } = createRequire(import.meta.url)(bundle);
const results = [];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const stamp = "2020-01-01T00:00:00.000Z";

async function check(name, run) {
  try { results.push({ name, passed: true, detail: await run() }); }
  catch (error) { results.push({ name, passed: false, error: String(error.stack || error) }); }
}

async function fresh() {
  const root = await mkdtemp(join(temporary, "vault-"));
  const files = new Map(), folders = new Map();
  let failCreate = "", nullCreate = "", failRename = "", failRenameAfter = "", failRenameBeforeIndex = "", raceTarget = "", failStagingCreate = false, failStagingDelete = false, unindexedStaging = false, failRecovery = false;
  const stagingPaths = [];
  const absolute = path => join(root, path);
  const hidden = path => path.split("/").some(part => part.startsWith("."));
  await mkdir(absolute("MarginStudyImports"));
  const seed = Buffer.from("synthetic original document\n");
  await writeFile(absolute("MarginStudyImports/seed.pdf"), seed);
  files.set("MarginStudyImports/seed.pdf", new TFile("MarginStudyImports/seed.pdf"));
  files.get("MarginStudyImports/seed.pdf").stat.size = seed.length;
  folders.set("MarginStudyImports", { path: "MarginStudyImports" });
  const adapter = {
    exists: async path => !!(await stat(absolute(path)).catch(() => null)),
    mkdir: async path => { await mkdir(absolute(path), { recursive: true }); folders.set(path, { path }); },
    list: async path => {
      const entries = await readdir(absolute(path), { withFileTypes: true });
      return { files: entries.filter(entry => entry.isFile()).map(entry => `${path}/${entry.name}`), folders: entries.filter(entry => entry.isDirectory()).map(entry => `${path}/${entry.name}`) };
    },
    read: async path => readFile(absolute(path), "utf8"),
    readBinary: async path => { const value = await readFile(absolute(path)); return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength); },
    write: async (path, value) => { if (failRecovery && path.includes("pending-main")) { failRecovery = false; throw new Error("synthetic adapter failure"); } await writeFile(absolute(path), value); },
    rmdir: async path => { await rm(absolute(path), { recursive: true }); for (const key of [...files.keys()]) if (key.startsWith(path + "/")) files.delete(key); folders.delete(path); },
  };
  const vault = {
    adapter,
    getFiles: () => [...files.values()],
    getAbstractFileByPath: path => files.get(path) ?? folders.get(path) ?? null,
    readBinary: async file => adapter.readBinary(file.path),
    createFolder: async path => {
      await mkdir(absolute(path));
      if (path.startsWith("MarginStudyImports/") && /(?:^|\/)\.?import-/.test(path)) stagingPaths.push(path);
      if (failStagingCreate && path.startsWith("MarginStudyImports/import-")) throw new Error("synthetic folder creation failure");
      if (hidden(path) || (unindexedStaging && path.startsWith("MarginStudyImports/import-"))) return null;
      const folder = { path, children: [] }; folders.set(path, folder); return folder;
    },
    createBinary: async (path, bytes) => {
      await writeFile(absolute(path), new Uint8Array(bytes), { flag: "wx" });
      if (path.endsWith(failCreate) && failCreate) throw new Error("synthetic file write failure");
      if (hidden(path) || (nullCreate && path.endsWith(nullCreate))) return null;
      const file = new TFile(path); file.stat.size = bytes.byteLength; files.set(path, file); return file;
    },
    rename: async (file, path) => {
      if (raceTarget && path.endsWith(raceTarget)) { await writeFile(absolute(path), "external collision"); throw new Error("target exists"); }
      if (path.endsWith(failRename) && failRename) throw new Error("synthetic rename failure");
      if (await adapter.exists(path)) throw new Error("target exists");
      await rename(absolute(file.path), absolute(path));
      if (failRenameBeforeIndex && path.endsWith(failRenameBeforeIndex)) throw new Error("synthetic move before index update");
      files.delete(file.path); file.path = path; files.set(path, file);
      if (path.endsWith(failRenameAfter) && failRenameAfter) throw new Error("synthetic post-rename failure");
    },
    delete: async entry => {
      if (failStagingDelete && entry.path.startsWith("MarginStudyImports/import-")) { failStagingDelete = false; throw new Error("synthetic staging deletion failure"); }
      await rm(absolute(entry.path), { recursive: true }); for (const path of [...files.keys()]) if (path === entry.path || path.startsWith(entry.path + "/")) files.delete(path); folders.delete(entry.path);
    },
  };
  let disk = { settings: { backupEnabled: false }, cards: [], nodes: [], edges: [], srs: {},
    studySets: [{ id: "a", name: "A", docPaths: ["MarginStudyImports/seed.pdf"], createdAt: stamp }, { id: "b", name: "B", docPaths: [], createdAt: stamp }], canvases: [],
    documents: [{ id: "seed", path: "MarginStudyImports/seed.pdf", kind: "pdf", createdAt: stamp, sourceUrl: "https://example.invalid/source", sha256: hash(seed), byteSize: seed.length, missing: false }] };
  const host = { app: { vault }, loadData: async () => structuredClone(disk), saveData: async value => { disk = structuredClone(value); } };
  const store = new Store(host); await store.load();
  const plugin = { app: host.app, store, openDocument: async () => {} };
  return { root, store, plugin, seed, files, adapter, stagingPaths,
    failCreate: name => { failCreate = name; }, nullCreate: name => { nullCreate = name; },
    failRename: name => { failRename = name; }, failRenameAfter: name => { failRenameAfter = name; },
    failRenameBeforeIndex: name => { failRenameBeforeIndex = name; }, raceTarget: name => { raceTarget = name; },
    failStagingCreate: () => { failStagingCreate = true; }, failStagingDelete: () => { failStagingDelete = true; },
    unindexedStaging: () => { unindexedStaging = true; }, failRecovery: () => { failRecovery = true; }, disk: () => structuredClone(disk) };
}

function api(fixture) {
  assert.equal(typeof fixture.store.changeStudySetDocuments, "function", "atomic study-set document transaction unavailable");
  assert.equal(typeof imports.importLocalDocuments, "function", "atomic local document import unavailable");
}
const state = store => structuredClone({ studySets: store.studySets, documents: store.documents });
const set = (store, id) => store.studySets.find(item => item.id === id);
const input = (name, contents) => new File([contents], name);
const importFiles = (fixture, names, policy = "reject") => imports.importLocalDocuments(fixture.plugin, names, { studySetId: "b", conflict: policy });

await check("1 shared reference has one record and one unchanged disk file", async () => {
  const f = await fresh(); api(f); const path = "MarginStudyImports/seed.pdf", before = hash(await readFile(join(f.root, path)));
  await f.store.changeStudySetDocuments("b", [path]);
  assert.ok(set(f.store, "a").docPaths.includes(path) && set(f.store, "b").docPaths.includes(path));
  assert.equal(f.store.documents.filter(document => document.path === path).length, 1);
  assert.deepEqual(await readdir(join(f.root, "MarginStudyImports")), ["seed.pdf"]);
  assert.equal(hash(await readFile(join(f.root, path))), before);
  return { paths: 2, records: 1, files: 1, sha256: before };
});

await check("2 removing a shared member leaves the other set and source untouched", async () => {
  const f = await fresh(); api(f); const path = "MarginStudyImports/seed.pdf", before = hash(f.seed);
  await f.store.changeStudySetDocuments("b", [path]); await f.store.changeStudySetDocuments("a", []);
  assert.deepEqual(set(f.store, "a").docPaths, []); assert.deepEqual(set(f.store, "b").docPaths, [path]);
  assert.equal(hash(await readFile(join(f.root, path))), before);
  return { otherSetIntact: true, sha256: before };
});

await check("3 explicit reuse creates no file and refusal changes nothing", async () => {
  const f = await fresh(); api(f); const path = "MarginStudyImports/seed.pdf", before = hash(f.seed), original = structuredClone(f.store.documents);
  const reused = await importFiles(f, [input("seed.pdf", "different external content")], "reuse");
  assert.equal(reused[0].path, path); assert.deepEqual(await readdir(join(f.root, "MarginStudyImports")), ["seed.pdf"]);
  assert.deepEqual(f.store.documents, original); assert.ok(set(f.store, "b").docPaths.includes(path));
  const snapshot = state(f.store), disk = f.disk();
  await assert.rejects(importFiles(f, [input("seed.pdf", "another external version")], "reject"), /同名|存在/);
  assert.deepEqual(state(f.store), snapshot); assert.deepEqual(f.disk(), disk);
  assert.deepEqual(await readdir(join(f.root, "MarginStudyImports")), ["seed.pdf"]); assert.equal(hash(await readFile(join(f.root, path))), before);
  return { reuseNewFiles: 0, rejectChanges: 0, sha256: before };
});

await check("4 write and adapter failures roll back membership and all record fields", async () => {
  const f = await fresh(); api(f); const before = state(f.store), disk = f.disk(); f.failCreate("second.pdf");
  await assert.rejects(importFiles(f, [input("first.pdf", "first"), input("second.pdf", "second")]), /write failure/);
  assert.deepEqual(state(f.store), before); assert.deepEqual(f.disk(), disk); assert.deepEqual(await readdir(join(f.root, "MarginStudyImports")), ["seed.pdf"]);
  f.failCreate(""); f.failRecovery();
  await assert.rejects(importFiles(f, [input("first.pdf", "first")]), /adapter failure/);
  assert.deepEqual(state(f.store), before); assert.deepEqual(f.disk().studySets, disk.studySets); assert.deepEqual(f.disk().documents, disk.documents);
  assert.deepEqual(await readdir(join(f.root, "MarginStudyImports")), ["seed.pdf"]);
  f.failRecovery(); await assert.rejects(f.store.changeStudySetDocuments("b", ["MarginStudyImports/seed.pdf"]), /adapter failure/);
  assert.deepEqual(state(f.store), before); assert.deepEqual(f.disk().studySets, disk.studySets); assert.deepEqual(f.disk().documents, disk.documents);
  const partial = await fresh(), partialBefore = state(partial.store), saveData = partial.store.host.saveData; let savedThenFailed = false;
  partial.store.host.saveData = async value => { await saveData(value); if (!savedThenFailed) { savedThenFailed = true; throw new Error("synthetic uncertain save"); } };
  await assert.rejects(importFiles(partial, [input("uncertain.pdf", "source")]), /恢复后的数据尚未保存/);
  assert.deepEqual(state(partial.store), partialBefore); assert.equal(await readFile(join(partial.root, "MarginStudyImports/uncertain.pdf"), "utf8"), "source");
  assert.ok(partial.disk().documents.some(document => document.path === "MarginStudyImports/uncertain.pdf"));
  return { fileFailure: true, importAdapterFailure: true, membershipAdapterFailure: true, uncertainCommitSourcePreserved: true };
});

await check("5 multi-add and multi-remove each undo as one transaction", async () => {
  const f = await fresh(); api(f); const before = state(f.store);
  await importFiles(f, [input("first.pdf", "first"), input("second.md", "second")]);
  assert.equal(set(f.store, "b").docPaths.length, 2); assert.ok(f.store.undoLibraryChange()); assert.deepEqual(state(f.store), before);
  assert.deepEqual((await readdir(join(f.root, "MarginStudyImports"))).sort(), ["first.pdf", "second.md", "seed.pdf"]);
  assert.ok(f.store.redoLibraryChange()); await f.store.flush(); const added = state(f.store);
  await f.store.changeStudySetDocuments("b", []); assert.deepEqual(set(f.store, "b").docPaths, []);
  assert.ok(f.store.undoLibraryChange()); assert.deepEqual(state(f.store), added);
  return { batchImportUndo: true, batchRemoveUndo: true, sourceFilesPreserved: 3 };
});

const extensions = [];
async function extra(name, run) {
  try { extensions.push({ name, passed: true, detail: await run() }); }
  catch (error) { extensions.push({ name, passed: false, error: String(error.stack || error) }); }
}
await extra("unsupported packages and renamed SQLite databases are rejected atomically", async () => {
  const f = await fresh(), before = state(f.store);
  for (const file of [input("export.marginpkg", "package"), input("mn3.db", "database"), input("mn4.sqlite", "database"), input("disguised.pdf", "SQLite format 3\0synthetic"), input("seed.pdf", "SQLite format 3\0synthetic")]) {
    await assert.rejects(importFiles(f, [input("valid.md", "valid"), file], "reuse"), /不支持|数据库/);
    assert.deepEqual(state(f.store), before); assert.deepEqual(await readdir(join(f.root, "MarginStudyImports")), ["seed.pdf"]);
  }
  const hidden = Buffer.from("SQLite format 3\0synthetic"), path = "MarginStudyImports/hidden.pdf";
  await writeFile(join(f.root, path), hidden); const existing = new TFile(path); existing.stat.size = hidden.length; f.files.set(path, existing);
  await assert.rejects(importFiles(f, [input("hidden.pdf", "ordinary document")], "reuse"), /数据库/);
  assert.deepEqual(state(f.store), before); assert.equal(hash(await readFile(join(f.root, path))), hash(hidden));
  return { forbiddenCases: 6, sourceSha256: hash(await readFile(join(f.root, "MarginStudyImports/seed.pdf"))) };
});
await extra("rename policy keeps old bytes, duplicate names are preflighted, and stale changes are refused", async () => {
  const f = await fresh(), path = "MarginStudyImports/seed.pdf", before = hash(f.seed);
  const files = await importFiles(f, [input("seed.pdf", "replacement")], "rename");
  assert.equal(files[0].path, "MarginStudyImports/seed (1).pdf"); assert.equal(hash(await readFile(join(f.root, path))), before);
  const snapshot = state(f.store);
  await assert.rejects(importFiles(f, [input("duplicate.md", "first"), input("duplicate.md", "second")], "reject"), /同名/);
  assert.deepEqual(state(f.store), snapshot); assert.ok(!(await f.adapter.exists("MarginStudyImports/duplicate.md")));
  await assert.rejects(f.store.changeStudySetDocuments("b", [], { expectedPaths: [] }), /已发生变化/); assert.deepEqual(state(f.store), snapshot);
  return { renamed: files[0].path, collisionPreflight: true, staleProtection: true };
});

const defectResults = [];
async function defect(name, run) {
  try { defectResults.push({ name, passed: true, detail: await run() }); }
  catch (error) { defectResults.push({ name, passed: false, error: String(error.stack || error) }); }
}
async function diskTree(root, path = "") {
  const entries = await readdir(join(root, path), { withFileTypes: true });
  const tree = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path ? `${path}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { tree.push({ path: child, kind: "directory" }); tree.push(...await diskTree(root, child)); }
    else tree.push({ path: child, kind: "file", sha256: hash(await readFile(join(root, child))) });
  }
  return tree;
}
const importTree = root => diskTree(root, "MarginStudyImports");

await defect("DEF-A29-1.1 hidden-path-null host imports a new file", async () => {
  const f = await fresh();
  const imported = await importFiles(f, [input("normal.md", "host-visible source")]);
  assert.equal(imported[0].path, "MarginStudyImports/normal.md");
  return { path: imported[0].path, hiddenPathsReturnNull: true };
});
await defect("DEF-A29-1.2 source hash and document registration match", async () => {
  const f = await fresh(), source = Buffer.from([0, 1, 127, 128, 255, 10, 42]);
  const count = f.store.documents.length, path = "MarginStudyImports/hash.pdf";
  await importFiles(f, [input("hash.pdf", source)]);
  assert.equal(hash(await readFile(join(f.root, path))), hash(source));
  assert.equal(f.store.documents.length, count + 1);
  assert.equal(f.store.documents.filter(document => document.path === path).length, 1);
  assert.ok(set(f.store, "b").docPaths.includes(path));
  return { sha256: hash(source), recordsAdded: 1, memberAdded: true };
});
await defect("DEF-A29-1.3 failures restore members, records, and disk", async () => {
  const cases = [
    ["createBinary returns null after writing", f => f.nullCreate("second.md"), /无法|失败|null/i],
    ["createBinary throws after writing", f => f.failCreate("second.md"), /write failure/],
    ["rename throws before moving", f => f.failRename("second.md"), /rename failure/],
    ["rename throws after moving", f => f.failRenameAfter("second.md"), /post-rename failure/],
    ["unindexed staging folder and null return", f => { f.unindexedStaging(); f.nullCreate("second.md"); }, /无法|失败|null/i],
  ];
  for (const [name, configure, expected] of cases) {
    const f = await fresh(), before = state(f.store), disk = f.disk(), tree = await importTree(f.root);
    configure(f);
    await assert.rejects(importFiles(f, [input("first.md", "first"), input("second.md", "second")]), expected, name);
    assert.deepEqual(state(f.store), before, `${name}: memory`);
    assert.deepEqual(f.disk().studySets, disk.studySets, `${name}: persisted members`);
    assert.deepEqual(f.disk().documents, disk.documents, `${name}: persisted records`);
    assert.deepEqual(await importTree(f.root), tree, `${name}: filesystem count and hashes`);
  }
  return { cases: cases.map(([name]) => name), membersRecordsAndDiskRestored: true };
});
await defect("DEF-A29-1.4 staging folders are visible and removed", async () => {
  for (const unindexed of [false, true]) {
    const f = await fresh(); if (unindexed) f.unindexedStaging();
    await importFiles(f, [input("visible.md", "source")]);
    assert.equal(f.stagingPaths.length, 1);
    assert.match(f.stagingPaths[0], /^MarginStudyImports\/import-[^/]+$/);
    assert.equal(await f.adapter.exists(f.stagingPaths[0]), false);
  }
  return { visible: true, indexedAndUnindexedFoldersRemoved: true };
});
await defect("DEF-A29-1.5 two new imports undo as one transaction", async () => {
  const f = await fresh(), before = state(f.store), disk = f.disk();
  const first = Buffer.from("first source"), second = Buffer.from("second source");
  await importFiles(f, [input("first.pdf", first), input("second.md", second)]);
  assert.equal(f.store.documents.length, before.documents.length + 2);
  for (const [name, bytes] of [["first.pdf", first], ["second.md", second]]) {
    const path = `MarginStudyImports/${name}`;
    assert.ok(set(f.store, "b").docPaths.includes(path));
    assert.equal(hash(await readFile(join(f.root, path))), hash(bytes));
  }
  assert.ok(f.store.undoLibraryChange()); assert.deepEqual(state(f.store), before);
  await f.store.flush();
  assert.deepEqual(f.disk().studySets, disk.studySets); assert.deepEqual(f.disk().documents, disk.documents);
  assert.equal(f.store.undoLibraryChange(), false);
  assert.deepEqual((await readdir(join(f.root, "MarginStudyImports"))).sort(), ["first.pdf", "second.md", "seed.pdf"]);
  return { files: 2, recordsAdded: 2, undos: 1, sourceFilesPreserved: true };
});
await extra("partially created or temporarily undeletable staging folders are rolled back", async () => {
  for (const [name, configure, expected] of [
    ["create folder after disk write", f => f.failStagingCreate(), /folder creation failure/],
    ["delete staging once", f => f.failStagingDelete(), /staging deletion failure/],
  ]) {
    const f = await fresh(), before = state(f.store), disk = f.disk(), tree = await importTree(f.root);
    configure(f);
    await assert.rejects(importFiles(f, [input("first.md", "first")]), expected, name);
    assert.deepEqual(state(f.store), before, name);
    assert.deepEqual(f.disk().studySets, disk.studySets, name); assert.deepEqual(f.disk().documents, disk.documents, name);
    assert.deepEqual(await importTree(f.root), tree, name);
  }
  return { partiallyCreatedFolderRemoved: true, transientDeleteRetried: true };
});
await extra("rollback removes a newly created import root without touching other files", async () => {
  const f = await fresh(), before = state(f.store), disk = f.disk();
  await f.plugin.app.vault.delete(f.plugin.app.vault.getAbstractFileByPath("MarginStudyImports"), true);
  f.nullCreate("second.md");
  await assert.rejects(importFiles(f, [input("first.md", "first"), input("second.md", "second")]), /无法|失败|null/i);
  assert.deepEqual(state(f.store), before); assert.deepEqual(f.disk().studySets, disk.studySets); assert.deepEqual(f.disk().documents, disk.documents);
  assert.equal(await f.adapter.exists("MarginStudyImports"), false);
  return { createdRootRemoved: true };
});
await extra("ambiguous rename and external collisions preserve unowned files", async () => {
  const partial = await fresh(), before = state(partial.store);
  partial.failRenameBeforeIndex("first.md");
  await assert.rejects(importFiles(partial, [input("first.md", "import bytes")]), /无法确认目标文件是否属于本次导入/);
  assert.deepEqual(state(partial.store), before);
  assert.equal(await readFile(join(partial.root, "MarginStudyImports/first.md"), "utf8"), "import bytes");
  assert.deepEqual((await readdir(join(partial.root, "MarginStudyImports"))).sort(), ["first.md", "seed.pdf"]);
  const collision = await fresh(), collisionBefore = state(collision.store);
  collision.raceTarget("first.md");
  await assert.rejects(importFiles(collision, [input("first.md", "import bytes")]), /target exists/);
  assert.deepEqual(state(collision.store), collisionBefore);
  assert.equal(await readFile(join(collision.root, "MarginStudyImports/first.md"), "utf8"), "external collision");
  assert.deepEqual((await readdir(join(collision.root, "MarginStudyImports"))).sort(), ["first.md", "seed.pdf"]);
  return { ambiguousTargetPreservedAndReported: true, concurrentExternalTargetPreserved: true };
});

await writeFile(join(temporary, "results.json"), JSON.stringify({ results, extensions, defectResults }, null, 2) + "\n");
for (const result of results) console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}${result.passed ? "" : "\n" + result.error}`);
for (const result of extensions) console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}${result.passed ? "" : "\n" + result.error}`);
for (const result of defectResults) console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}${result.passed ? "" : "\n" + result.error}`);
console.log(`${results.filter(result => result.passed).length}/5 A29 acceptance groups passed; results: ${join(temporary, "results.json")}`);
console.log(`${defectResults.filter(result => result.passed).length}/5 DEF-A29-1 acceptance groups passed`);
if ([...results, ...extensions, ...defectResults].some(result => !result.passed)) process.exitCode = 1;
