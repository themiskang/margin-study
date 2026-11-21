/**
 * [INPUT]: 使用合成学习集包、Store 和库适配器。
 * [OUTPUT]: 验证复习往返、文件回链、故障恢复、主数据迁移后的导入重试和冷启写盘次数。
 * [POS]: 从导入与导出的公开入口执行学习集回归。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "marginstudy-set-import-"));
async function loadFixtureApi(source, filename) {
  const built = await build({ stdin: { contents: 'export { readStudySetPackage, importStudySetPackage } from "./studySetImport"; export { exportStudySet } from "./studySetExport"; export { Store } from "../model/store";', resolveDir: source }, bundle: true, platform: "node", format: "cjs", write: false,
    plugins: [{ name: "synthetic-obsidian", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "synthetic" }));
      builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: 'export class Notice{};export class TFile{};export class App{};export class Component{};export const MarkdownRenderer={render:async()=>{}};' }));
    } }] });
  const bundle = join(temporary, filename);
  await writeFile(bundle, built.outputFiles[0].contents);
  return createRequire(import.meta.url)(bundle);
}
const currentApi = await loadFixtureApi(here, "fixture.cjs");
const { readStudySetPackage, importStudySetPackage, exportStudySet, Store } = currentApi;

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
    const { host, files: existing } = storeFixture();
    if (collision) existing.set("X.pdf", strToU8("existing"));
    const store = new Store(host);
    await store.load();
    const bytes = pack({ payload: payload(), documents: {
      "documents/pages.msref": strToU8(JSON.stringify(collection)),
      "documents/X.pdf": strToU8("%PDF"),
    } });
    const summary = await importStudySetPackage({ app: host.app, store }, bytes);
    const result = JSON.parse(new TextDecoder().decode(existing.get("pages.msref")));
    assert.equal(result.pages[0].sourcePath, collision ? "X (2).pdf" : "X.pdf");
    assert.equal(result.pages[1].sourcePath, "external.pdf");
    assert.equal(summary.pageCollectionRefs, collision ? 1 : 0);
    if (!collision) assert.equal(new TextDecoder().decode(existing.get("pages.msref")), JSON.stringify(collection));
  }
  return "mapped";
});

function storeFixture(settings, seed = {}) {
  let disk = { schemaVersion: 3, revision: 4, cards: [], nodes: [], edges: [], srs: {}, studySets: [], canvases: [], documents: [], settings, ...seed };
  const files = new Map(), directories = new Set();
  let mainWrites = 0;
  const adapter = {
    exists: async path => files.has(path) || directories.has(path),
    mkdir: async path => directories.add(path),
    list: async path => ({
      files: [...files.keys()].filter(name => name.startsWith(path + "/")),
      folders: [...directories].filter(name => dirname(name) === path),
    }),
    read: async path => files.get(path),
    write: async (path, content) => files.set(path, content),
    readBinary: async path => {
      assert.ok(files.has(path), path);
      return Uint8Array.from(Buffer.from(files.get(path))).buffer;
    },
    writeBinary: async (path, content) => files.set(path, new Uint8Array(content)),
    remove: async path => files.delete(path),
    rmdir: async path => {
      for (const file of files.keys()) if (file.startsWith(path + "/")) files.delete(file);
      for (const dir of directories) if (dir === path || dir.startsWith(path + "/")) directories.delete(dir);
    },
    rename: async (source, target) => {
      if (files.has(target) || directories.has(target)) throw new Error("Destination file already exists!");
      if (directories.has(source)) {
        for (const dir of [...directories]) {
          if (dir !== source && !dir.startsWith(source + "/")) continue;
          directories.delete(dir);
          directories.add(target + dir.slice(source.length));
        }
        for (const [file, content] of [...files]) {
          if (!file.startsWith(source + "/")) continue;
          files.delete(file);
          files.set(target + file.slice(source.length), content);
        }
        return;
      }
      assert.ok(files.has(source));
      files.set(target, files.get(source));
      files.delete(source);
    },
    process: async (path, change) => {
      assert.ok(files.has(path));
      const content = change(files.get(path));
      files.set(path, content);
      return content;
    },
  };
  const vault = { adapter, getFiles: () => [], getAbstractFileByPath: path => files.has(path) ? { path } : null,
    createBinary: async (path, data) => { files.set(path, new Uint8Array(data)); return { path }; },
    modifyBinary: async (file, data) => files.set(file.path, new Uint8Array(data)),
    delete: async file => files.delete(file.path) };
  const host = { app: { vault }, loadData: async () => structuredClone(disk), saveData: async value => {
    mainWrites++;
    disk = JSON.parse(JSON.stringify(value));
  } };
  return { host, files, readDisk: () => structuredClone(disk), mainWrites: () => mainWrites };
}

const coldStart = async fixture => {
  const before = fixture.readDisk(), writes = fixture.mainWrites();
  const store = new Store(fixture.host);
  await store.load();
  await store.backfillDocumentFingerprints();
  await store.recoverMissingDocuments();
  await store.flush();
  const after = fixture.readDisk();
  return { writes: fixture.mainWrites() - writes, revisionDelta: after.revision - before.revision, diskUnchanged: JSON.stringify(after) === JSON.stringify(before) };
};

const noColdStartWrite = { writes: 0, revisionDelta: 0, diskUnchanged: true };
const oneColdStartWrite = { writes: 1, revisionDelta: 1, diskUnchanged: false };
const legacySchedule = { due: "2026-12-01", lastReviewed: "2026-11-25", interval: 6, reps: 1, ease: 2.5 };
const legacyDocument = (path, fingerprint = {}) => ({ id: path, path, kind: "pdf", createdAt: "2026-11-01T00:00:00.000Z", ...fingerprint });
const sourceBytes = strToU8("%PDF-1.4 cold-start source");
const sourceFingerprint = { byteSize: sourceBytes.byteLength, sha256: sha(sourceBytes) };
const coldResult = (id, values) => {
  console.log(`${id} ${JSON.stringify(values)}`);
  return values;
};

await test("A1 import commits exact final source fingerprints and UTC ISO review dates", async () => {
  const fixture = storeFixture();
  const store = new Store(fixture.host);
  await store.load();
  fixture.files.set("a.pdf", strToU8("collision"));
  const collection = strToU8(JSON.stringify({ format: "marginstudy-page-collection", version: 1, pages: [{ sourcePath: "a.pdf" }] }));
  await importStudySetPackage({ app: fixture.host.app, store }, pack({
    payload: { ...payload(), srs: { c1: legacySchedule } },
    documents: { "documents/a.pdf": sourceBytes, "documents/pages.msref": collection },
  }));
  const disk = fixture.readDisk();
  assert.deepEqual(disk.documents.map(document => document.path).sort(), ["a (2).pdf", "pages.msref"]);
  for (const doc of disk.documents) {
    const bytes = fixture.files.get(doc.path);
    assert.equal(doc.byteSize, bytes.byteLength);
    assert.equal(doc.sha256, sha(bytes));
  }
  assert.notEqual(disk.documents.find(document => document.path === "pages.msref").sha256, sha(collection));
  const schedule = disk.srs[disk.cards[0].id];
  assert.equal(schedule.due, new Date(2026, 11, 1).toISOString());
  assert.equal(schedule.lastReviewed, new Date(2026, 10, 25).toISOString());
  return coldResult("A1", { documents: disk.documents.length, due: schedule.due, lastReviewed: schedule.lastReviewed });
});

await test("A2 imported library stays byte-identical through two cold starts", async () => {
  const fixture = storeFixture();
  const store = new Store(fixture.host);
  await store.load();
  await importStudySetPackage({ app: fixture.host.app, store }, pack({
    payload: { ...payload(), srs: { c1: legacySchedule } }, documents: { "documents/a.pdf": sourceBytes },
  }));
  const first = await coldStart(fixture), second = await coldStart(fixture);
  assert.deepEqual(first, noColdStartWrite);
  assert.deepEqual(second, noColdStartWrite);
  return coldResult("A2", { first, second });
});

await test("A3 legacy fingerprints and review dates are persisted together once", async () => {
  const fixture = storeFixture(undefined, {
    cards: payload().cards,
    documents: [legacyDocument("a.pdf"), legacyDocument("blocked.pdf"), legacyDocument("slow.pdf")],
    srs: { c1: legacySchedule },
  });
  for (const doc of fixture.readDisk().documents) fixture.files.set(doc.path, sourceBytes);
  const adapter = fixture.host.app.vault.adapter, readBinary = adapter.readBinary;
  adapter.readBinary = async path => {
    if (path === "blocked.pdf") throw new Error("EACCES");
    if (path === "slow.pdf") await new Promise(resolve => setTimeout(resolve, 850));
    return readBinary(path);
  };
  const first = await coldStart(fixture), second = await coldStart(fixture);
  assert.deepEqual(first, oneColdStartWrite);
  assert.deepEqual(second, noColdStartWrite);
  const disk = fixture.readDisk();
  assert.equal(disk.documents[0].sha256, sourceFingerprint.sha256);
  assert.equal(disk.documents[1].sha256, undefined);
  assert.equal(disk.documents[2].sha256, sourceFingerprint.sha256);
  assert.equal(disk.srs.c1.due, new Date(2026, 11, 1).toISOString());
  assert.equal(disk.srs.c1.lastReviewed, new Date(2026, 10, 25).toISOString());
  return coldResult("A3", { first, second, unreadableSourceSha256Persisted: false });
});

await test("A4 absent source is stable on the second cold start", async () => {
  const fixture = storeFixture(undefined, { documents: [
    legacyDocument("gone.pdf", { ...sourceFingerprint, missing: false }),
    legacyDocument("never-fingerprinted.pdf"),
  ] });
  const first = await coldStart(fixture), second = await coldStart(fixture);
  assert.deepEqual(first, oneColdStartWrite);
  assert.deepEqual(second, noColdStartWrite);
  assert.equal(fixture.readDisk().documents[0].missing, true);
  return coldResult("A4", { first, second });
});

const sourcePath = "EV01-主流程.pdf", attachmentPath = "EV01-附件.pdf", supplementPath = "EV01-补充.docx";
const seedTime = "2026-11-01T00:00:00.000Z";
const dueDates = ["2026-12-01T00:00:00.000Z", "2026-11-25T00:00:00.000Z"];
const question = id => `${id}::deck:deck-a::basic`;
const sourceCards = ["card-a", "card-b"].map((id, index) => ({
  id, docPath: sourcePath, front: `EV01 卡片 ${index + 1}`, page: index + 1, anchorAnnId: `ann-${index + 1}`,
  links: index ? [] : ["card-b"], tags: ["ev01"], createdAt: seedTime,
}));
const sourceAnnotations = sourceCards.map(card => ({
  id: card.anchorAnnId, docPath: sourcePath, page: card.page, cardId: card.id, type: "highlight",
  rects: [{ x: .1, y: card.page / 10, w: .3, h: .02 }], createdAt: seedTime,
}));
sourceAnnotations.push({ id: "ann-ink", docPath: sourcePath, page: 2, type: "ink", rects: [], createdAt: seedTime });
const f02Seed = {
  cards: [...sourceCards, { id: "outside", docPath: "", front: "Outside", links: [], createdAt: seedTime }],
  nodes: sourceCards.map((card, index) => ({
    id: `node-${index}`, cardId: card.id, canvasId: "canvas-a", title: card.front, parentId: index ? "node-0" : null, x: 10, y: 20 + index,
  })),
  edges: [{ from: "node-0", to: "node-1", label: "分支" }],
  studySets: [{ id: "set-a", name: "EV01 学习集", docPaths: [sourcePath, supplementPath],
    documentAttachments: { [sourcePath]: [attachmentPath] }, cardIds: sourceCards.map(card => card.id), reviewDeckId: "deck-a", createdAt: seedTime }],
  canvases: [{ id: "canvas-a", studySetId: "set-a", name: "主脑图", createdAt: seedTime }],
  activeStudySetId: "set-a",
  reviewDecks: [
    { id: "deck-a", name: "EV01 牌组", studySetIds: ["set-a", "outside-set"], cardIds: ["card-a", "card-b", "outside"], createdAt: seedTime },
    { id: "outside-deck", name: "Outside", studySetIds: ["outside-set"], cardIds: ["outside", "card-a"], createdAt: seedTime },
  ],
  srs: { [question("card-a")]: { due: dueDates[0] }, [question("card-b")]: { due: dueDates[1] },
    [question("outside")]: { due: dueDates[0] }, "card-a::deck:outside-deck::basic": { due: dueDates[0] } },
  reviewLogs: [{ id: "log-1", cardId: "card-a", questionId: question("card-a"), deckId: "deck-a", rating: 3, reviewedAt: seedTime },
    { id: "outside-log", cardId: "outside", questionId: question("outside"), deckId: "deck-a", reviewedAt: seedTime }],
  reviewPending: [{ id: "pending-1", cardId: "card-a", questionId: question("card-a"), deckId: "deck-a", due: dueDates[0], queuedAt: seedTime },
    { id: "outside-pending", cardId: "outside", questionId: question("outside"), deckId: "deck-a", due: dueDates[0], queuedAt: seedTime }],
};
const f02Files = {
  [sourcePath]: strToU8("%PDF-1.4 EV01 main"), [attachmentPath]: strToU8("%PDF-1.4 EV01 attachment"), [supplementPath]: strToU8("docx bytes"),
};
const openStore = async host => { const store = new Store(host); await store.load(); return store; };
const importInto = (host, store, bytes, options) => importStudySetPackage({ app: host.app, store }, bytes, options);
async function f02Evidence(id, data) {
  const file = join(temporary, `F02-${id}.json`);
  await writeFile(file, JSON.stringify(data, null, 2) + "\n");
  console.log(`F02 ${id} evidence: ${file}`);
}

await test("EV01: scoped review schedules survive archive, import and reopen; attachment and anchors remain reachable", async () => {
  const source = storeFixture(undefined, f02Seed);
  for (const [path, bytes] of Object.entries(f02Files)) source.files.set(path, bytes);
  source.files.set(sourcePath + ".mstudy.json", JSON.stringify({ schemaVersion: 2, annotations: sourceAnnotations }));
  const sourceStore = await openStore(source.host);
  const zipPath = join(temporary, "F02-EV01.marginstudy-set.zip");
  const hostRequire = createRequire(import.meta.url);
  globalThis.window = { require: name => name === "@electron/remote"
    ? { dialog: { showSaveDialog: async () => ({ canceled: false, filePath: zipPath }) } } : hostRequire(name) };
  try { await exportStudySet({ store: sourceStore, app: source.host.app }, { history: "all" }); }
  finally { delete globalThis.window; }
  const bytes = Uint8Array.from(await readFile(zipPath)).buffer;
  const { payload: exported } = await readStudySetPackage(bytes);
  assert.deepEqual([exported.reviewDecks?.length, Object.keys(exported.srs ?? {}).length, exported.reviewLogs?.length, exported.reviewPending?.length], [1, 2, 1, 1]);
  assert.deepEqual(exported.reviewDecks[0].studySetIds, ["set-a"]);
  assert.deepEqual(exported.reviewDecks[0].cardIds, ["card-a", "card-b"]);
  const target = storeFixture(), original = strToU8("%PDF-1.4 EV01 preexisting");
  target.files.set(sourcePath, original);
  const imported = await importInto(target.host, await openStore(target.host), bytes);
  const reopened = await openStore(target.host);
  const counts = [reopened.reviewDecks.length, Object.keys(reopened.srs).length, reopened.reviewLogs.length, reopened.reviewPending.length];
  assert.deepEqual(counts, [1, 2, 1, 1]);
  const set = reopened.studySets.find(item => item.id === imported.studySetId);
  const [cardA, cardB] = reopened.cards;
  const deck = reopened.reviewDecks[0], questionA = `${cardA.id}::deck:${deck.id}::basic`;
  assert.deepEqual([reopened.srs[questionA].due, reopened.srs[`${cardB.id}::deck:${deck.id}::basic`].due], dueDates);
  assert.equal(reopened.reviewLogs[0].questionId, questionA);
  assert.equal(reopened.reviewPending[0].questionId, questionA);
  assert.deepEqual(deck.studySetIds, [set.id]);
  assert.deepEqual(deck.cardIds, [cardA.id, cardB.id]);
  assert.ok(reopened.reviewDecks.every(item => item.id !== "outside-deck"));
  await f02Evidence("A1", { counts, dueDates, sourceDeck: exported.reviewDecks[0], importedDeck: deck, questionA,
    importedSchedules: reopened.srs, archive: zipPath, outOfScopeRecords: 0 });
  const renamed = "EV01-主流程 (2).pdf";
  assert.equal(cardA.docPath, renamed);
  assert.deepEqual(set.documentAttachments, { [renamed]: [attachmentPath] });
  const attachmentHash = sha(Buffer.from(await target.host.app.vault.adapter.readBinary(set.documentAttachments[renamed][0])));
  assert.equal(attachmentHash, sha(f02Files[attachmentPath]));
  assert.equal(sha(target.files.get(sourcePath)), sha(original));
  const annotations = await reopened.loadAnnotations(renamed);
  for (const [index, card] of reopened.cards.entries()) {
    const annotation = annotations.find(item => item.id === card.anchorAnnId);
    assert.equal(annotation.cardId, card.id);
    assert.equal(annotation.page, card.page);
    assert.deepEqual(annotation.rects, sourceAnnotations[index].rects);
  }
  assert.deepEqual(cardA.links, [cardB.id]);
  assert.equal(reopened.nodes.find(node => node.cardId === cardA.id).canvasId, reopened.nodes.find(node => node.cardId === cardB.id).canvasId);
  assert.equal(reopened.edges.length, 1);
  await f02Evidence("A2-store", { attachments: set.documentAttachments, attachmentHash, originalSha256: sha(original),
    targetSha256: sha(target.files.get(sourcePath)), annotations, cards: reopened.cards.map(({id, docPath, page, anchorAnnId}) => ({id, docPath, page, anchorAnnId})) });
  return "1/2/1/1, exact due dates, scoped deck, renamed source, attachment bytes and remapped anchors";
});

await test("legacy empty PDF page edits do not block the original pages after import and reopen", async () => {
  const data = payload();
  data.studySets[0].docPaths.push("edited.pdf");
  const edits = { version: 1, pages: [{ id: "source:2", sourcePage: 2, rotation: 90 }, { id: "source:1", sourcePage: 1 }] };
  data.docMeta = {
    "a.pdf": { bookmarks: [2], pdfPageEdits: { version: 1, pages: [] } },
    "edited.pdf": { pdfPageEdits: edits },
  };
  const bytes = pack({ payload: data, documents: {
    "documents/a.pdf": strToU8("%PDF-1.4 original"),
    "documents/edited.pdf": strToU8("%PDF-1.4 reordered"),
  } });
  const target = storeFixture();
  const originalMeta = { brightness: .8, pdfPageEdits: edits };
  target.files.set("a.pdf", strToU8("%PDF-1.4 preexisting"));
  const store = await openStore(target.host);
  store.updateDocMeta("a.pdf", originalMeta);
  await store.flush();
  await importInto(target.host, store, bytes);
  const reopened = await openStore(target.host);
  const imported = reopened.getDocMeta("a (2).pdf");
  assert.deepEqual(imported, { bookmarks: [2] });
  assert.deepEqual(reopened.getDocMeta("edited.pdf").pdfPageEdits, edits);
  assert.deepEqual(reopened.getDocMeta("a.pdf"), originalMeta);
  await f02Evidence("A2-pdf-page-edits", { imported, nonempty: reopened.getDocMeta("edited.pdf"), original: reopened.getDocMeta("a.pdf") });
  return "empty metadata removed from the renamed copy, bookmarks and ordered pages preserved";
});

function interruptionPackage() {
  const data = payload();
  data.studySets[0].docPaths.push("b.pdf");
  data.annotations = { "a.pdf": [{ id: "ann", type: "highlight", rects: [], cardId: "c1" }] };
  return pack({ payload: data, documents: { "documents/a.pdf": strToU8("a"), "documents/b.pdf": strToU8("b") } });
}

function importedState(target, store) {
  return { cards: store.cards.length, studySets: store.studySets.length, nodes: store.nodes.length, canvases: store.canvases.length,
    files: [...target.files.keys()].filter(path => !path.startsWith("_marginstudy-recovery/")).sort() };
}

await test("all three failed import writes leave no partial data after reopen", async () => {
  const cases = [];
  for (const phase of ["second-file", "annotation", "flush"]) {
    const target = storeFixture(), store = await openStore(target.host);
    const { vault } = target.host.app;
    const createBinary = vault.createBinary, write = vault.adapter.write, saveData = target.host.saveData;
    let files = 0;
    vault.createBinary = async (path, bytes) => {
      if (phase === "second-file" && ++files === 2) throw new Error("injected " + phase);
      if (phase === "annotation" && path.endsWith(".mstudy.json")) throw new Error("injected " + phase);
      return createBinary(path, bytes);
    };
    vault.adapter.write = async (path, content) => {
      if (phase === "annotation" && path.endsWith(".mstudy.json")) throw new Error("injected " + phase);
      return write(path, content);
    };
    target.host.saveData = async data => {
      if (phase === "flush" && data.studySets.length) throw new Error("injected " + phase);
      return saveData(data);
    };
    let error;
    const before = target.readDisk();
    await assert.rejects(importInto(target.host, store, interruptionPackage()), caught => {
      error = caught.message;
      return error.includes("injected " + phase) && error.includes("已回滚");
    });
    await store.flush();
    const reopened = await openStore(target.host);
    const state = importedState(target, reopened);
    assert.deepEqual(state, { cards: 0, studySets: 0, nodes: 0, canvases: 0, files: [] });
    assert.deepEqual(target.readDisk(), before);
    assert.deepEqual([...target.files.keys()], []);
    cases.push({ phase, error, state, unchangedMainData: true });
  }
  await f02Evidence("A3", cases);
  return "file, sidecar and final save failures leave the pre-import disk state";
});

await test("desktop adapter refusing overwrite can import into an existing data.json", async () => {
  const base = await mkdtemp(join(temporary, "desktop-"));
  const target = storeFixture();
  target.host.manifest = { dir: ".obsidian/plugins/margin-study" };
  const folder = join(base, target.host.manifest.dir);
  await mkdir(folder, { recursive: true });
  const mainPath = target.host.manifest.dir + "/data.json";
  const actualPath = join(base, mainPath);
  await writeFile(actualPath, JSON.stringify(target.readDisk()));
  target.host.loadData = async () => JSON.parse(await readFile(actualPath, "utf8"));
  const { adapter } = target.host.app.vault;
  const { exists, write, remove } = adapter;
  const isPluginData = path => path === mainPath || path.startsWith(mainPath + ".");
  adapter.getBasePath = () => base;
  adapter.exists = async path => isPluginData(path) ? access(join(base, path)).then(() => true, () => false) : exists(path);
  adapter.write = async (path, content) => isPluginData(path) ? writeFile(join(base, path), content) : write(path, content);
  adapter.remove = async path => isPluginData(path) ? unlink(join(base, path)) : remove(path);
  adapter.rename = async (source, destination) => {
    assert.ok(isPluginData(source));
    if (await adapter.exists(destination)) throw new Error("Destination file already exists!");
    assert.fail("unexpected adapter rename");
  };
  const result = await importInto(target.host, await openStore(target.host), interruptionPackage());
  const reopened = await openStore(target.host);
  assert.equal(result.cards, 1);
  assert.equal(reopened.cards.length, 1);
  assert.equal(reopened.getRevision(), 5);
  const pluginFiles = await readdir(folder);
  assert.deepEqual(pluginFiles, ["data.json"]);
  await f02Evidence("A3-desktop-replace", { cards: reopened.cards.length, revision: reopened.getRevision(), pluginFiles });
  return "desktop atomic replacement succeeds under a strict Obsidian-style adapter";
});

await test("adapter commits handle first save and distinguish failures before and after the write", async () => {
  const cases = [];
  for (const phase of ["new-file", "before-write", "after-write"]) {
    const target = storeFixture();
    target.host.manifest = { dir: ".obsidian/plugins/margin-study" };
    const mainPath = target.host.manifest.dir + "/data.json";
    const original = JSON.stringify(target.readDisk());
    if (phase !== "new-file") target.files.set(mainPath, original);
    target.host.loadData = async () => target.files.has(mainPath) ? JSON.parse(target.files.get(mainPath)) : null;
    const { adapter } = target.host.app.vault;
    const process = adapter.process;
    if (phase !== "new-file") {
      adapter.process = async (path, change) => {
        assert.equal(path, mainPath);
        if (phase === "after-write") await process(path, change);
        throw new Error("injected process result");
      };
    }
    const store = await openStore(target.host);
    const result = importInto(target.host, store, interruptionPackage());
    const committed = phase !== "before-write";
    if (committed) assert.equal((await result).cards, 1);
    else await assert.rejects(result, /已回滚.*injected process result/);
    const reopened = await openStore(target.host);
    assert.equal(reopened.cards.length, committed ? 1 : 0);
    assert.equal(target.files.get(mainPath) === original, !committed);
    assert.equal([...target.files.keys()].some(path => path.endsWith(".tmp")), false);
    cases.push({ phase, cards: reopened.cards.length, originalMainData: target.files.get(mainPath) === original });
  }
  await f02Evidence("A3-atomic-main", cases);
  return "first save, rollback and completed writes are distinguished on reopen";
});

await test("retries after interruption and concurrent submissions yield one import per target", async () => {
  const bytes = interruptionPackage();
  const target = storeFixture(), firstStore = await openStore(target.host);
  const vault = target.host.app.vault, remove = vault.delete, createBinary = vault.createBinary;
  let fileWrites = 0;
  vault.createBinary = async (path, content) => {
    if (++fileWrites === 2) throw new Error("injected second write");
    return createBinary(path, content);
  };
  vault.delete = async () => { throw new Error("injected cleanup interruption"); };
  await assert.rejects(importInto(target.host, firstStore, bytes), /injected second write/);
  assert.ok([...target.files.keys()].some(path => path.endsWith("a.pdf")));
  vault.delete = remove;
  vault.createBinary = createBinary;
  const first = await importInto(target.host, await openStore(target.host), bytes);
  const firstState = importedState(target, await openStore(target.host));
  const secondStore = await openStore(target.host), staleStore = await openStore(target.host);
  const repeated = await importInto(target.host, secondStore, bytes);
  assert.equal(repeated.studySetId, first.studySetId);
  assert.deepEqual(importedState(target, await openStore(target.host)), firstState);
  const merge = { mode: "merge", studySetId: first.studySetId };
  const [merged, concurrent] = await Promise.all([importInto(target.host, secondStore, bytes, merge), importInto(target.host, staleStore, bytes, merge)]);
  const final = importedState(target, await openStore(target.host));
  assert.equal(merged.studySetId, concurrent.studySetId);
  assert.equal(first.duplicateGroups + repeated.duplicateGroups + merged.duplicateGroups + concurrent.duplicateGroups, 0);
  assert.deepEqual(firstState, { cards: 1, studySets: 1, nodes: 1, canvases: 1, files: ["a.pdf", "a.pdf.mstudy.json", "b.pdf"] });
  assert.deepEqual(final, { cards: 2, studySets: 1, nodes: 2, canvases: 2,
    files: ["a (2).pdf", "a (2).pdf.mstudy.json", "a.pdf", "a.pdf.mstudy.json", "b (2).pdf", "b.pdf"] });
  await f02Evidence("A4", { firstState, afterRetry: firstState, final, results: [first, repeated, merged, concurrent] });
  return "journal survives interrupted cleanup; retries and concurrent submits converge";
});

await test("a v2 import receipt survives schema migration and retries into the same target", async () => {
  const baselineRoot = process.env.MARGINSTUDY_SCHEMA_BASELINE_DIR;
  const priorApi = baselineRoot ? await loadFixtureApi(resolve(baselineRoot, "src/export"), "f02-baseline.cjs") : currentApi;
  const bytes = interruptionPackage(), initial = storeFixture(undefined, { schemaVersion: baselineRoot ? 2 : 3 });
  const initialStore = new priorApi.Store(initial.host);
  await initialStore.load();
  const studySetId = initialStore.createStudySet("F05 target").id;
  await initialStore.flush();
  const options = { mode: "merge", studySetId };
  const imported = await priorApi.importStudySetPackage({ app: initial.host.app, store: initialStore }, bytes, options);
  const disk = initial.readDisk();
  if (baselineRoot) assert.equal(disk.schemaVersion, 2);
  else disk.schemaVersion = 2;
  const legacy = storeFixture(undefined, disk);
  for (const [path, content] of initial.files) legacy.files.set(path, content);
  const migrated = await openStore(legacy.host);
  assert.equal(legacy.readDisk().schemaVersion, 3);
  const pathsBefore = [...legacy.files].filter(([path]) => /^(a|b)\.pdf/.test(path)).map(([path, content]) => [path, sha(content)]);
  const stateBefore = importedState(legacy, migrated);
  assert.equal(stateBefore.cards, 1);
  const repeated = await importInto(legacy.host, migrated, bytes, options);
  const reopened = await openStore(legacy.host);
  const stateAfter = importedState(legacy, reopened);
  const pathsAfter = [...legacy.files].filter(([path]) => /^(a|b)\.pdf/.test(path)).map(([path, content]) => [path, sha(content)]);
  assert.equal(repeated.studySetId, imported.studySetId);
  assert.deepEqual(stateAfter, stateBefore);
  assert.deepEqual(pathsAfter, pathsBefore);
  await f02Evidence("F05-A1-retry", { priorImport: baselineRoot ? "frozen F02 Store" : "v2 version fixture", legacyVersion: 2, upgradedVersion: 3, imported, repeated, stateBefore, stateAfter, pathsBefore, pathsAfter });
  return "same target and bundle keep one import and the same file hashes";
});

await test("ambiguous legacy partial import is reported and existing data is preserved", async () => {
  const data = payload();
  const target = storeFixture(undefined, {
    studySets: [{ ...data.studySets[0], id: "study-old", cardIds: ["import-old"] }],
    cards: [{ ...data.cards[0], id: "import-old" }],
  });
  target.files.set("a.pdf", strToU8("a"));
  const before = target.readDisk();
  const message = await importInto(target.host, await openStore(target.host), interruptionPackage())
    .then(() => "", error => error.message);
  assert.match(message, /旧版导入.*无法确认/);
  assert.deepEqual(target.readDisk(), before);
  assert.deepEqual([...target.files.keys()], ["a.pdf"]);
  await f02Evidence("A5-legacy-partial", { message, unchangedMainData: true, files: ["a.pdf"] });
  return "legacy partial import requires manual identification";
});

await test("legacy v1 settings leave target settings intact after create, merge and reload", async () => {
  const fakeNetdisk = scope => Object.fromEntries(
    ["clientId", "clientSecret", "accessToken", "refreshToken"].map(key => [key, `F04-FAKE-${scope}-${key}`]),
  );
  const { host } = storeFixture({
    studyHomeCategory: "F04-FAKE-target-category", accent: "teal", layout: "tree",
    baiduNetdisk: fakeNetdisk("target"),
  });
  const legacy = payload();
  legacy.settings = {
    studyHomeCategory: "F04-FAKE-source-category", accent: "violet", layout: "right", scale: 1.5,
    baiduNetdisk: fakeNetdisk("source"),
  };
  const bytes = pack({ payload: legacy });
  let store = new Store(host);
  await store.load();
  const snapshots = { beforeCreate: structuredClone(store.settings) };
  const created = await importStudySetPackage({ app: host.app, store }, bytes, { mode: "new" });
  store = new Store(host);
  await store.load();
  const createdSet = store.studySets.find(set => set.id === created.studySetId);
  assert.equal(createdSet.cardIds.length, 1);
  snapshots.afterCreateReload = structuredClone(store.settings);
  snapshots.beforeMerge = structuredClone(store.settings);
  const merged = await importStudySetPackage({ app: host.app, store }, bytes, { mode: "merge", studySetId: created.studySetId });
  store = new Store(host);
  await store.load();
  assert.equal(merged.studySetId, created.studySetId);
  assert.equal(store.studySets.find(set => set.id === merged.studySetId).cardIds.length, 2);
  snapshots.afterMergeReload = structuredClone(store.settings);

  const evidence = join(temporary, "F04-03-settings-snapshots.json");
  await writeFile(join(temporary, "F04-03-legacy.marginstudy-set.zip"), new Uint8Array(bytes));
  await writeFile(evidence, JSON.stringify(snapshots, null, 2) + "\n");
  console.log(`F04 import evidence: ${evidence}`);
  assert.deepEqual(snapshots.afterCreateReload, snapshots.beforeCreate);
  assert.deepEqual(snapshots.afterMergeReload, snapshots.beforeMerge);
  return "target settings identical after both v1 import modes and reload";
});

await test("import persists remapped review data and skips incompatible scene templates", async () => {
  const { host, files, readDisk } = storeFixture();
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
  const result = await importStudySetPackage({ app: host.app, store }, pack({ payload: data, documents: { "documents/a.pdf": strToU8("%PDF") } }));
  assert.ok(store.getRevision() > 4);
  assert.equal(result.skippedSceneTemplates, 1);
  const disk = readDisk();
  assert.equal(disk.cardTemplates[0].id, "custom");
  const cardId = disk.cards[0].id, deckId = disk.reviewDecks[0].id, questionId = `${cardId}::deck:${deckId}::basic`;
  assert.ok(disk.srs[questionId]);
  assert.equal(disk.reviewLogs[0].questionId, questionId);
  assert.equal(disk.reviewPending[0].questionId, questionId);
  assert.deepEqual(disk.reviewDecks[0].cardIds, [cardId]);
  assert.equal(files.get("a.pdf.mstudy.json"), existingSidecar);
  assert.equal(JSON.parse(files.get("a (2).pdf.mstudy.json")).annotations[0].cardId, cardId);
  const merged = await importStudySetPackage({ app: host.app, store }, pack({ payload: payload() }), { mode: "merge", studySetId: result.studySetId });
  assert.equal(merged.studySetId, result.studySetId);
  assert.equal(store.studySets.find(set => set.id === result.studySetId).cardIds.length, 2);
  await assert.rejects(importStudySetPackage({ app: host.app, store }, pack({ payload: payload() }), { mode: "merge", studySetId: "missing" }), /目标学习集不存在/);
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
