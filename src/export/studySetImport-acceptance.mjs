import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "marginstudy-set-import-"));
const built = await build({ stdin: { contents: 'export { readStudySetPackage, importStudySetPackage } from "./studySetImport"; export { Store } from "../model/store";', resolveDir: here }, bundle: true, platform: "node", format: "cjs", write: false,
  plugins: [{ name: "synthetic-obsidian", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "synthetic" }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: 'export class Notice{};export class TFile{};export class App{};export class Component{};export const MarkdownRenderer={render:async()=>{}};' }));
  } }] });
const bundle = join(temporary, "fixture.cjs");
await writeFile(bundle, built.outputFiles[0].contents);
const { readStudySetPackage, importStudySetPackage, Store } = createRequire(import.meta.url)(bundle);

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const results = [];
async function test(name, run) {
  try { results.push({ name, passed: true, detail: await run() }); }
  catch (error) { results.push({ name, passed: false, error: String(error.stack || error) }); }
}

function pack({ payload, documents = {}, corrupt = "" }) {
  const files = { ...documents };
  files["studyset.json"] = strToU8(JSON.stringify(payload));
  const manifest = {
    format: "marginstudy-study-set-manifest", version: 1, createdAt: "2026-11-11T00:00:00Z", studySetId: payload.studySets[0]?.id ?? "set",
    files: Object.entries(files).map(([path, bytes]) => ({ path, bytes: bytes.byteLength, sha256: corrupt === path ? "0".repeat(64) : sha(bytes) })),
  };
  files["MANIFEST.json"] = strToU8(JSON.stringify(manifest));
  const bytes = zipSync(files);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
const payload = (cards = [{ id: "c1", front: "a", docPath: "a.pdf", tags: [], links: [] }]) => ({
  format: "marginstudy-study-set", version: 1, cards, nodes: [{ id: "n1", cardId: "c1", parentId: null, title: "t", x: 0, y: 0, canvasId: "v1" }],
  edges: [{ from: "n1", to: "n1", label: "self" }], studySets: [{ id: "s1", name: "Imported", docPaths: ["a.pdf"], createdAt: "2026-01-01T00:00:00Z" }],
  canvases: [{ id: "v1", studySetId: "s1", name: "主脑图" }], settings: { scale: 1 },
});

await test("valid package exposes payload, documents and zero repairs", async () => {
  const bytes = pack({ payload: payload(), documents: { "documents/a.pdf": strToU8("%PDF-1.4 imported") } });
  const result = await readStudySetPackage(bytes);
  assert.equal(result.payload.studySets[0].name, "Imported");
  assert.equal(result.files.size, 1);
  assert.ok(result.files.has("documents/a.pdf"));
  assert.equal(result.repaired, 0);
  return "ok";
});

await test("manifest hash mismatch is rejected before any import", async () => {
  const bytes = pack({ payload: payload(), documents: { "documents/a.pdf": strToU8("x") }, corrupt: "documents/a.pdf" });
  await assert.rejects(readStudySetPackage(bytes), /SHA-256/);
  return "rejected";
});

await test("missing listed file is rejected", async () => {
  const entries = { "studyset.json": strToU8(JSON.stringify(payload())), "MANIFEST.json": strToU8(JSON.stringify({ format: "marginstudy-study-set-manifest", version: 1, files: [{ path: "documents/gone.pdf", bytes: 1, sha256: "0".repeat(64) }] })) };
  const zip = zipSync(entries);
  await assert.rejects(readStudySetPackage(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength)), /清单条目缺失|路径无效/);
  return "rejected";
});

await test("page collection references follow imported document renames only", async () => {
  const collection = { format: "marginstudy-page-collection", version: 1, id: "collection", title: "Pages", pages: [
    { id: "one", sourcePath: "X.pdf", sourcePage: 1 },
    { id: "two", sourcePath: "external.pdf", sourcePage: 1 },
  ] };
  for (const collision of [true, false]) {
    const existing = new Map(collision ? [["X.pdf", strToU8("existing")]] : []);
    const vault = {
      getAbstractFileByPath: path => existing.has(path) ? { path } : null,
      adapter: { exists: async path => existing.has(path) },
      createBinary: async (path, bytes) => { existing.set(path, new Uint8Array(bytes)); return { path }; },
      modifyBinary: async (file, bytes) => { existing.set(file.path, new Uint8Array(bytes)); },
      delete: async file => { existing.delete(file.path); },
    };
    const store = {
      studySets: [], cardTemplates: [], reviewDecks: [], srs: {}, reviewLogs: [], reviewPending: [],
      libraryTransaction: (_name, run) => run(),
      sidecarPath: path => path + ".mstudy.json",
      createStudySet: name => ({ id: "new-set", name, docPaths: [] }),
      createCanvas: () => ({ id: "new-canvas" }),
      addCard() {}, addNode() {}, addEdge() {}, updateStudySet() {}, registerDocument() {},
      getSceneTemplates: () => [], setActiveStudySet() {}, save() {}, flush: async () => {},
    };
    const bytes = pack({ payload: payload(), documents: {
      "documents/pages.msref": strToU8(JSON.stringify(collection)),
      "documents/X.pdf": strToU8("%PDF"),
    } });
    const summary = await importStudySetPackage({ app: { vault }, store }, bytes);
    const result = JSON.parse(new TextDecoder().decode(existing.get("pages.msref")));
    assert.equal(result.pages[0].sourcePath, collision ? "X (2).pdf" : "X.pdf");
    assert.equal(result.pages[1].sourcePath, "external.pdf");
    assert.equal(summary.pageCollectionRefs, collision ? 1 : 0);
    if (!collision) assert.equal(new TextDecoder().decode(existing.get("pages.msref")), JSON.stringify(collection));
  }
  return "mapped";
});

await test("import persists remapped review data and skips incompatible scene templates", async () => {
  let disk = { revision: 4, cards: [], nodes: [], edges: [], srs: {}, studySets: [], canvases: [], documents: [] };
  const files = new Map(), directories = new Set();
  const adapter = {
    exists: async path => files.has(path) || directories.has(path),
    mkdir: async path => directories.add(path),
    list: async path => ({ files: [...files.keys()].filter(name => name.startsWith(path + "/")), folders: [] }),
    read: async path => files.get(path),
    write: async (path, content) => files.set(path, content),
  };
  const vault = { adapter, getFiles: () => [], getAbstractFileByPath: path => files.has(path) ? { path } : null,
    createBinary: async (path, data) => { files.set(path, new Uint8Array(data)); return { path }; },
    modifyBinary: async (file, data) => files.set(file.path, new Uint8Array(data)),
    delete: async file => files.delete(file.path) };
  const host = { app: { vault }, loadData: async () => structuredClone(disk), saveData: async value => { disk = structuredClone(value); } };
  const store = new Store(host); await store.load();
  const template = { ...structuredClone(store.getSceneTemplates()[0]), id: "test-personal" };
  assert.throws(() => store.addSceneTemplate(store.getSceneTemplates()[0]), /内置模板/);
  assert.throws(() => store.addSceneTemplate({ id: "bad" }), /模板内容无效/);
  store.addSceneTemplate(template);
  assert.throws(() => store.addSceneTemplate(template), /模板已存在/);
  const data = payload();
  data.cardTemplates = [{ id: "custom", name: "Custom" }];
  data.sceneTemplates = [{ id: "invalid", name: "Invalid" }];
  data.reviewDecks = [{ id: "deck-old", name: "Deck", cardIds: ["c1"] }];
  data.srs = { "c1::deck:deck-old::basic": { due: "2026-01-01T00:00:00.000Z" } };
  data.reviewLogs = [{ id: "log", cardId: "c1", questionId: "c1::deck:deck-old::basic", deckId: "deck-old" }];
  data.reviewPending = [{ id: "pending", cardId: "c1", questionId: "c1::deck:deck-old::basic", deckId: "deck-old", due: "2026-01-01T00:00:00.000Z", queuedAt: "2026-01-01T00:00:00.000Z" }];
  data.annotations = { "a.pdf": [{ id: "ann", type: "highlight", rects: [], cardId: "c1" }] };
  const existingSidecar = JSON.stringify({ annotations: [] });
  files.set("a.pdf.mstudy.json", existingSidecar);
  const result = await importStudySetPackage({ app: { vault }, store }, pack({ payload: data, documents: { "documents/a.pdf": strToU8("%PDF") } }));
  assert.ok(store.getRevision() > 4);
  assert.equal(result.skippedSceneTemplates, 1);
  assert.equal(disk.cardTemplates[0].id, "custom");
  const cardId = disk.cards[0].id, deckId = disk.reviewDecks[0].id, questionId = `${cardId}::deck:${deckId}::basic`;
  assert.ok(disk.srs[questionId]);
  assert.equal(disk.reviewLogs[0].questionId, questionId);
  assert.equal(disk.reviewPending[0].questionId, questionId);
  assert.deepEqual(disk.reviewDecks[0].cardIds, [cardId]);
  assert.equal(files.get("a.pdf.mstudy.json"), existingSidecar);
  assert.equal(JSON.parse(files.get("a (2).pdf.mstudy.json")).annotations[0].cardId, cardId);
  const merged = await importStudySetPackage({ app: { vault }, store }, pack({ payload: payload() }), { mode: "merge", studySetId: result.studySetId });
  assert.equal(merged.studySetId, result.studySetId);
  assert.equal(store.studySets.find(set => set.id === result.studySetId).cardIds.length, 2);
  await assert.rejects(importStudySetPackage({ app: { vault }, store }, pack({ payload: payload() }), { mode: "merge", studySetId: "missing" }), /目标学习集不存在/);
  return "revision and persisted references verified";
});

await test("duplicate card ids inside the package are repaired and counted", async () => {
  const duplicateCards = [
    { id: "c1", front: "old", docPath: "a.pdf", tags: [], links: [], updatedAt: "2026-01-01T00:00:00Z" },
    { id: "c1", front: "new", docPath: "a.pdf", tags: [], links: [], updatedAt: "2026-02-01T00:00:00Z" },
  ];
  const bytes = pack({ payload: payload(duplicateCards) });
  const result = await readStudySetPackage(bytes);
  assert.equal(result.payload.cards.length, 1);
  assert.equal(result.payload.cards[0].front, "new");
  assert.equal(result.repaired, 1);
  assert.equal(result.duplicated, 1);
  return "repaired";
});

await test("unknown format or version is rejected", async () => {
  const wrongFormat = { ...payload(), format: "other" };
  await assert.rejects(readStudySetPackage(pack({ payload: wrongFormat })), /不支持的学习集包格式/);
  const wrongVersion = { ...payload(), version: 2 };
  await assert.rejects(readStudySetPackage(pack({ payload: wrongVersion })), /不支持的学习集包格式/);
  return "rejected";
});

const failed = results.filter(result => !result.passed);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed }, null, 2));
if (failed.length) process.exitCode = 1;
else console.log(`${results.length}/${results.length} study-set import groups passed`);
