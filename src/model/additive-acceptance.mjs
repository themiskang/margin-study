// Real Store and backup hashing over an in-memory host. No user's vault is read or changed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url)), temporary = await mkdtemp(join(tmpdir(), "marginstudy-additive-"));
const evidence = process.env.MARGINSTUDY_VERIFY_DIR || await mkdtemp(join(tmpdir(), "marginstudy-additive-results-")); await mkdir(evidence, { recursive: true });
const checks = [], stores = [], check = async (name, run) => { await run(); checks.push({ name, passed: true }); console.log("✓ " + name); };
const hash = value => createHash("sha256").update(value).digest("hex"), stamp = "2020-01-01T00:00:00.000Z";
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==";
const annotations = [
  { id: "overlay-text", type: "note", docPath: "doc.pdf", page: 1, rects: [], text: "Editable overlay", cardId: "source", documentNotebookId: "notebook-2", overlay: { kind: "text", box: { x: .1, y: .2, w: .3, h: .15 }, fontSize: 18, background: "#fff4b5", deleted: false } },
  { id: "overlay-image", type: "note", docPath: "doc.pdf", page: 1, rects: [], image: png, overlay: { kind: "image", box: { x: .4, y: .4, w: .2, h: .2 }, deleted: true } },
  { id: "ink", type: "ink", docPath: "doc.pdf", page: 1, rects: [], inkBrush: "highlight", inkLayerId: "sketch-2", points: [{ x: 4, y: 5 }, { x: 8, y: 10 }] },
];
const ink = { version: 1, layers: [{ id: "default", name: "Default", strokes: [{ id: "stroke", tool: "highlight", color: "#ffd54f", width: 16, points: [{ x: 50, y: 60, pressure: .4 }, { x: 100, y: 90 }] }] }], activeLayerId: "default" };
let failure;
try {
  const built = await build({ stdin: { contents: 'export {Store} from "./store.ts"; export * from "./annotationValidation.ts"; export {displayedExcerptBlocks} from "../cards/excerptBlocks.ts";', resolveDir: here }, platform: "node", format: "cjs", bundle: true, write: false,
    plugins: [{ name: "memory-host", setup(builder) { builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "memory" })); builder.onLoad({ filter: /.*/, namespace: "memory" }, () => ({ contents: "export class App {} export class TFile {} export class Notice {} export class Component {} export const MarkdownRenderer={render:async()=>{}};", loader: "js" })); } }] });
  const bundle = join(temporary, "store.cjs"); await writeFile(bundle, built.outputFiles[0].contents); const api = createRequire(import.meta.url)(bundle);
  const fresh = async () => {
    const files = new Map([["doc.pdf", Buffer.from("synthetic source")]]), directories = new Set(), writes = [];
    let disk = { cards: [{ id: "source", type: "comment", docPath: "doc.pdf", front: "Source", anchorAnnId: "overlay-text", tags: [], links: [], createdAt: stamp }], nodes: [], edges: [], srs: {}, reviewPending: [], reviewLogs: [],
      studySets: [{ id: "study", name: "Study", docPaths: ["doc.pdf"], cardIds: ["source"], createdAt: stamp }], canvases: [{ id: "canvas", studySetId: "study", name: "Main", createdAt: stamp }], activeStudySetId: "study", activeCanvasId: "canvas" };
    const binary = path => { if (!files.has(path)) throw new Error("missing synthetic file: " + path); return Buffer.from(files.get(path)); };
    const adapter = { exists: async path => files.has(path) || directories.has(path), mkdir: async path => { directories.add(path); }, read: async path => binary(path).toString(), write: async (path, text) => { writes.push(path); files.set(path, Buffer.from(text)); },
      readBinary: async path => { const data = binary(path); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); }, writeBinary: async (path, data) => { writes.push(path); files.set(path, Buffer.from(data)); }, remove: async path => files.delete(path), rename: async (from, to) => { if(files.has(to)) throw new Error("target exists"); const data=binary(from); files.set(to,data); files.delete(from); } };
    const host = { app: { vault: { adapter, getFiles: () => [...files.keys()].map(path => ({ path })) } }, loadData: async () => structuredClone(disk), saveData: async value => { disk = structuredClone(value); } };
    const store = new api.Store(host); await store.load(); stores.push(store); return { store, host, files, writes, disk: () => structuredClone(disk), reopen: async () => { const reopened = new api.Store(host); await reopened.load(); stores.push(reopened); return reopened; } };
  };
  await check("card color updates and merging preserve matching palette values", async () => {
    const f = await fresh();
    f.store.updateCard("source", { colorIndex: 15 });
    assert.equal(f.store.getCard("source").color, "#C39DE0");
    f.store.updateCard("source", { color: undefined });
    f.store.addCard({ id: "other", type: "excerpt", docPath: "doc.pdf", front: "Other", tags: [], links: [], createdAt: stamp, color: "#FFFFAA" });
    const merged = f.store.mergeCards("source", ["other"]);
    assert.equal(merged.color, "#FFFFAA");
    assert.equal(merged.colorIndex, 0);
    f.store.updateCard("source", { color: "#ffffaa" });
    f.store.unmergeCard("source");
    assert.equal(f.store.getCard("source").colorIndex, 0);
    assert.equal(f.store.getCard("source").color, "#ffffaa");
  });
  await check("edited mixed excerpts preserve order and source identities or discard stale blocks", async () => {
    const blocks = [{ id: "a", text: "Old", target: { kind: "html", range: { start: 0, end: 3 } } }, { id: "b", image: png, target: { kind: "html", range: { start: 0, end: 0, imageIndex: 1 } } }, { id: "c", text: "Text", target: { kind: "html", range: { start: 4, end: 8 } } }];
    const f = await fresh();
    f.store.updateCard("source", { front: "Old\nText", excerptBlocks: blocks, image: png });
    f.store.updateCard("source", { front: "OldText" });
    let card = f.store.getCard("source");
    assert.deepEqual(card.excerptBlocks.map(block => block.text || block.image), ["Old", png, "Text"]);
    assert.deepEqual(card.excerptBlocks.map(block => block.target), blocks.map(block => block.target));
    f.store.updateCard("source", { front: "Old\nText", excerptBlocks: blocks });
    f.store.updateCard("source", { front: "OlXext" });
    card = f.store.getCard("source");
    assert.deepEqual(card.excerptBlocks.map(block => block.text || block.image), ["OlX", png, "ext"]);
    assert.deepEqual(card.excerptBlocks.map(block => block.target), blocks.map(block => block.target));
    f.store.updateCard("source", { front: "Old\nText", excerptBlocks: blocks });
    f.store.updateCard("source", { front: "Older\nText" });
    card = f.store.getCard("source");
    assert.deepEqual(card.excerptBlocks.map(block => block.text || block.image), ["Older", png, "Text"]);
    assert.deepEqual(card.excerptBlocks.map(block => block.target), blocks.map(block => block.target));
    f.store.updateCard("source", { front: "Oldest\nText revised" });
    card = f.store.getCard("source");
    assert.deepEqual(card.excerptBlocks.map(block => block.text || block.image), ["Oldest", png, "Text revised"]);
    f.store.addCard({ id: "other", type: "excerpt", docPath: "other.html", anchorAnnId: "other-ann", front: "Other", excerptBlocks: [{ id: "other-block", text: "Other", target: blocks[0].target }], tags: [], links: [], createdAt: stamp });
    card = f.store.mergeCards("source", ["other"]);
    assert.equal(card.front, "Oldest\nText revised\n\n---\n\nOther");
    assert.deepEqual(card.excerptBlocks.filter(block => block.target).map(block => [block.id, block.source.docPath, block.source.anchorAnnId]), [
      ["a", "doc.pdf", "overlay-text"], ["b", "doc.pdf", "overlay-text"], ["c", "doc.pdf", "overlay-text"], ["other-block", "other.html", "other-ann"],
    ]);
    assert.equal(card.image, png);
    assert.deepEqual(card.images, []);
    f.store.unmergeCard("source");
    f.store.updateCard("source", { front: "Completely rewritten" });
    assert.deepEqual(f.store.getCard("source").excerptBlocks.map(block => block.text || block.image), ["Completely rewritten", png]);
    assert.equal(f.store.getCard("source").excerptBlocks[0].target, undefined);
  });
  await check("cross-block cloze masks the complete body while retaining mixed images", async () => {
    const f = await fresh();
    for (const front of ["{{alpha\nbeta}}", "{{alpha {{nested}}\nbeta}}"]) {
      const [first, second] = front.split("\n");
      const blocks = [{ id: "a", text: first }, { id: "image", image: png }, { id: "b", text: second }];
      f.store.updateCard("source", { front, excerptBlocks: blocks });
      const rendered = api.displayedExcerptBlocks(f.store.getCard("source"));
      assert.deepEqual(rendered.map(block => block.id), ["a", "image", "b"]);
      assert.equal(rendered[1].image, png);
      assert.doesNotMatch(rendered.map(block => block.text || "").join(""), /alpha|beta|nested|\{\{|\}\}/);
      assert.match(rendered[0].text, /••/);
    }
    const fallback = api.displayedExcerptBlocks({ front: "{{hidden}}", excerptBlocks: [{ id: "a", text: "unmatched" }, { id: "b", image: png }, { id: "c", text: "also unmatched" }, { id: "d", image: png }] });
    assert.deepEqual(fallback.map(block => block.id), ["a", "b", "c", "d"]);
    assert.deepEqual(fallback.filter(block => block.image).map(block => block.image), [png, png]);
    assert.doesNotMatch(fallback.map(block => block.text || "").join(""), /hidden/);
  });
  await check("saving unchanged card content preserves its timestamp, history and persisted data", async () => {
    const f = await fresh();
    f.store.updateCard("source", { back: "Saved note", updatedAt: stamp });
    await f.store.flush();
    const before = structuredClone(f.store.getCard("source")), history = f.store.getLibraryHistoryState(), saved = f.disk();
    f.store.updateCard("source", { front: "Source", back: "Saved note", tags: [], links: [], typography: undefined });
    f.store.updateCard("source", {});
    f.store.updateCard("missing", { front: "Must not create a card" });
    assert.deepEqual(f.store.getCard("source"), before);
    assert.deepEqual(f.store.getLibraryHistoryState(), history);
    await f.store.flush();
    assert.deepEqual(f.disk(), saved);
    assert.deepEqual((await f.reopen()).getCard("source"), before);
    f.store.updateCard("source", { back: "Changed note" });
    assert.equal(f.store.getCard("source").back, "Changed note");
    assert.equal(f.store.getLibraryHistoryState().revision, history.revision + 1);
    assert.equal(f.store.undoLibraryChange(), true);
    assert.deepEqual(f.store.getCard("source"), before);
    assert.equal(f.store.redoLibraryChange(), true);
    assert.equal(f.store.getCard("source").back, "Changed note");
  });
  await check("legacy annotations remain accepted without additive fields", () => api.validateAnnotationCollection([{ id: "old", type: "highlight", rects: [], text: "legacy" }]));
  await check("annotation revisions advance on saves, undo/redo and path migration", async () => {
    const f = await fresh(), path = "doc.pdf", moved = "renamed.pdf";
    const initial = f.store.getAnnotationsRevision(path);
    const live = await f.store.loadAnnotations(path);
    assert.ok(f.store.getAnnotationsRevision(path) > initial);
    const afterLoad = f.store.getAnnotationsRevision(path);
    live.push({ id: "revision-ink", type: "pen", docPath: path, page: 1, rects: [], text: "", color: "#000", createdAt: stamp, strokes: [[{ x: .1, y: .2 }, { x: .5, y: .2 }]] });
    f.store.saveAnnotationsDebounced(path, live);
    assert.ok(f.store.getAnnotationsRevision(path) > afterLoad);
    const beforeNow = f.store.getAnnotationsRevision(path);
    await f.store.saveAnnotationsNow(path, live);
    assert.ok(f.store.getAnnotationsRevision(path) > beforeNow);
    f.store.libraryTransaction("annotation edit", () => { live[0].text = "changed"; f.store.saveAnnotationsDebounced(path, live); });
    const beforeUndo = f.store.getAnnotationsRevision(path);
    assert.equal(f.store.undoLibraryChange(), true);
    assert.ok(f.store.getAnnotationsRevision(path) > beforeUndo);
    const beforeRedo = f.store.getAnnotationsRevision(path);
    assert.equal(f.store.redoLibraryChange(), true);
    assert.ok(f.store.getAnnotationsRevision(path) > beforeRedo);
    const oldRevision = f.store.getAnnotationsRevision(path), targetRevision = f.store.getAnnotationsRevision(moved);
    await f.store.renameDocument(path, moved);
    assert.ok(f.store.getAnnotationsRevision(path) > oldRevision);
    assert.ok(f.store.getAnnotationsRevision(moved) > targetRevision);
    await f.store.flush();
  });
  await check("document fingerprints are additive and refresh without changing stable document identity", async () => {
    const f = await fresh(), record = f.store.registerDocument("doc.pdf");
    assert.ok(record);
    assert.equal(record.sha256, undefined, "legacy record should remain lazy until fingerprint refresh");
    await f.store.refreshDocumentFingerprint("doc.pdf");
    assert.equal(record.sha256, hash(Buffer.from("synthetic source")));
    assert.equal(record.byteSize, Buffer.byteLength("synthetic source"));
    const id = record.id;
    f.files.set("doc.pdf", Buffer.from("replacement source"));
    await f.store.refreshDocumentFingerprint("doc.pdf");
    assert.equal(record.id, id, "fingerprint refresh replaced the document identity");
    assert.equal(record.sha256, hash(Buffer.from("replacement source")));
    await f.store.flush();
    assert.equal((await f.reopen()).documents.find(doc => doc.id === id).byteSize, Buffer.byteLength("replacement source"));
  });
  await check("missing-source recovery candidates require an exact unique content hash match", async () => {
    const f = await fresh(), record = await f.store.refreshDocumentFingerprint("doc.pdf");
    f.files.delete("doc.pdf");
    f.files.set("renamed.pdf", Buffer.from("synthetic source"));
    assert.deepEqual(await f.store.findMatchingDocumentPaths(record.id), ["renamed.pdf"]);
    f.files.set("copy.pdf", Buffer.from("synthetic source"));
    assert.deepEqual((await f.store.findMatchingDocumentPaths(record.id)).sort(), ["copy.pdf", "renamed.pdf"]);
    f.files.set("renamed.pdf", Buffer.from("changed source")); f.files.delete("copy.pdf");
    assert.deepEqual(await f.store.findMatchingDocumentPaths(record.id), []);
  });
  await check("a unique exact-content return restores the existing document identity and every Store path reference", async () => {
    const f = await fresh(), doc = await f.store.refreshDocumentFingerprint("doc.pdf"), annotations = [{ id: "ann", type: "highlight", docPath: "doc.pdf", page: 1, rects: [], text: "synthetic", color: "#ffff00", createdAt: stamp }];
    await f.store.saveAnnotationsNow("doc.pdf", annotations); f.store.markDocumentMissing("doc.pdf");
    f.files.delete("doc.pdf"); f.files.set("moved/renamed.pdf", Buffer.from("synthetic source"));
    const result = await f.store.recoverMissingDocuments();
    assert.deepEqual(result.recovered, [{ id: doc.id, oldPath: "doc.pdf", newPath: "moved/renamed.pdf" }]);
    assert.equal(f.store.documents.find(item=>item.id===doc.id).path, "moved/renamed.pdf");
    assert.equal(f.store.cards[0].docPath, "moved/renamed.pdf");
    assert.deepEqual(f.store.studySets[0].docPaths, ["moved/renamed.pdf"]);
    assert.deepEqual(JSON.parse(f.files.get("moved/renamed.pdf.mstudy.json")).annotations[0].docPath, "moved/renamed.pdf");
    await f.store.flush(); assert.equal((await f.reopen()).documents.find(item=>item.id===doc.id).missing, false);
  });
  await check("offline source moves are detected without a delete event and exact-content recovery migrates references", async () => {
    const f = await fresh(), doc = await f.store.refreshDocumentFingerprint("doc.pdf"), annotations = [{ id: "offline-ann", type: "highlight", docPath: "doc.pdf", page: 2, rects: [], text: "offline move", color: "#ffff00", createdAt: stamp }];
    await f.store.saveAnnotationsNow("doc.pdf", annotations);
    f.files.delete("doc.pdf"); f.files.set("archive/renamed.pdf", Buffer.from("synthetic source"));
    assert.equal(f.store.documents.find(item=>item.id===doc.id).missing, false, "fixture must model no delete notification");
    const result = await f.store.recoverMissingDocuments();
    assert.deepEqual(result.recovered, [{ id: doc.id, oldPath: "doc.pdf", newPath: "archive/renamed.pdf" }]);
    assert.equal(f.store.documents.find(item=>item.id===doc.id).missing, false);
    assert.equal(f.store.cards[0].docPath, "archive/renamed.pdf");
    assert.deepEqual(f.store.studySets[0].docPaths, ["archive/renamed.pdf"]);
    assert.equal(JSON.parse(f.files.get("archive/renamed.pdf.mstudy.json")).annotations[0].docPath, "archive/renamed.pdf");
    await f.store.flush(); assert.equal((await f.reopen()).documents.find(item=>item.id===doc.id).path, "archive/renamed.pdf");
  });
  await check("changed-content source stays unresolved until explicit selection, then retains identity and old-version recovery data", async () => {
    const f=await fresh(),doc=await f.store.refreshDocumentFingerprint("doc.pdf");f.store.markDocumentMissing("doc.pdf");f.files.delete("doc.pdf");f.files.set("moved/updated.pdf",Buffer.from("changed synthetic source"));
    const result=await f.store.recoverMissingDocuments();assert.equal(result.recovered.length,0);assert.deepEqual(result.ambiguous[0].identicalCandidates,[]);assert.ok(result.ambiguous[0].candidates.includes("moved/updated.pdf"));
    await assert.rejects(f.store.restoreDocumentAtPath(doc.id,"moved/updated.pdf"),/明确选择/);
    await f.store.restoreDocumentAtPath(doc.id,"moved/updated.pdf",true);
    assert.equal(f.store.documents.find(item=>item.id===doc.id).path,"moved/updated.pdf");assert.equal(f.store.documents.find(item=>item.id===doc.id).sha256,hash(Buffer.from("changed synthetic source")));
    assert.ok([...f.files.keys()].some(path=>path.startsWith("_marginstudy-recovery/document-content-change-")));
  });
  await check("a target-sidecar migration conflict preserves both copies, original references, and a recovery record", async () => {
    const f = await fresh(), oldSidecar = JSON.stringify({ annotations: [{ id: "old", type: "highlight", rects: [], text: "old source" }] }), newSidecar = JSON.stringify({ annotations: [{ id: "new", type: "note", rects: [], text: "target source" }] });
    f.files.set("doc.pdf.mstudy.json", Buffer.from(oldSidecar)); f.files.set("moved.pdf.mstudy.json", Buffer.from(newSidecar));
    await assert.rejects(f.store.renameDocument("doc.pdf", "moved.pdf"), /目标路径已有批注/);
    assert.equal(f.files.get("doc.pdf.mstudy.json").toString(), oldSidecar); assert.equal(f.files.get("moved.pdf.mstudy.json").toString(), newSidecar);
    assert.equal(f.store.cards[0].docPath, "doc.pdf"); assert.ok([...f.files.keys()].some(path => path.startsWith("_marginstudy-recovery/document-migration-failed-")));
  });
  await check("a failed main-data write rolls back a moved sidecar and retains a migration recovery snapshot", async () => {
    const f = await fresh(), raw = JSON.stringify({ annotations: [{ id: "ann", type: "highlight", docPath: "doc.pdf", page: 1, rects: [], text: "keep", color: "#ffff00", createdAt: stamp }] });
    f.files.set("doc.pdf.mstudy.json", Buffer.from(raw)); let fail = true; const save = f.host.saveData;
    f.host.saveData = async data => { if (fail) { fail = false; throw new Error("synthetic disk interruption"); } return save(data); };
    await assert.rejects(f.store.renameDocument("doc.pdf", "moved.pdf"), /synthetic disk interruption/);
    assert.equal(f.store.cards[0].docPath, "doc.pdf");
    assert.equal(f.files.get("doc.pdf.mstudy.json")?.toString(), raw);
    assert.ok([...f.files.keys()].some(path => path.startsWith("_marginstudy-recovery/document-migration-failed-")));
  });
  await check("two Store instances serialize disk commits and retain a concurrent edit as a conflict", async () => {
    const f = await fresh(), second = await f.reopen(), originalLoad = f.host.loadData, originalWrite = f.host.app.vault.adapter.write;
    let reads = 0, releaseReads;
    const gate = new Promise(resolve => { releaseReads = resolve; });
    f.host.loadData = async () => { reads++; if (reads <= 2) { if (reads === 2) releaseReads(); await gate; return structuredClone(f.disk()); } return originalLoad(); };
    f.host.app.vault.adapter.write = async (path, text) => { if (path.startsWith("_marginstudy-recovery/pending-main-")) await new Promise(resolve => setTimeout(resolve, 25)); return originalWrite(path, text); };
    f.store.updateCard("source", { front: "window one edit" });
    second.updateCard("source", { front: "window two edit" });
    const firstFlush = f.store.flush(), secondFlush = second.flush();
    await Promise.race([Promise.allSettled([firstFlush, secondFlush]), new Promise(resolve => setTimeout(resolve, 60))]);
    if (reads < 2) releaseReads();
    await Promise.allSettled([firstFlush, secondFlush]);
    assert.ok(f.store.conflictPath || second.conflictPath, "the second writer did not detect and retain the competing version");
    assert.ok(["window one edit", "window two edit"].includes(f.disk().cards[0].front), "disk content was replaced by an unrelated stale snapshot");
    f.host.loadData = originalLoad;
  });
  await check("a failed save keeps the latest edit dirty and an explicit retry persists it", async () => {
    const f = await fresh(), save = f.host.saveData; let fail = true;
    f.host.saveData = async data => { if (fail) { fail = false; throw new Error("synthetic transient write failure"); } return save(data); };
    f.store.updateCard("source", { front: "retry this edit" }); await assert.rejects(f.store.flush(), /synthetic transient write failure/);
    assert.equal(f.disk().cards[0].front, "Source");
    await f.store.flush(); assert.equal(f.disk().cards[0].front, "retry this edit");
    assert.equal(f.store.lastSaveError, null);
  });
  await check("tampered backup bytes are rejected before source or main data changes", async () => {
    const f = await fresh(), manifestPath = await f.store.backupData(true), root = manifestPath.slice(0,manifestPath.lastIndexOf("/")), manifest = JSON.parse(f.files.get(manifestPath));
    f.files.set(root+"/data.json",Buffer.from("{}")); const before=f.disk(),source=f.files.get("doc.pdf").toString(),writes=f.writes.length;
    await assert.rejects(f.store.prepareBackupRecovery(manifestPath),/主数据校验失败/);
    assert.deepEqual(f.disk(),before);assert.equal(f.files.get("doc.pdf").toString(),source);assert.equal(f.writes.length,writes);assert.ok(manifest.files.length>0);
  });
  await check("an unselected backup restore never overwrites source, sidecar, or current card", async () => {
    const f = await fresh(), ann = [{ id:"ann",type:"highlight",docPath:"doc.pdf",page:1,rects:[],text:"backup",color:"#ffff00",createdAt:stamp }];
    await f.store.saveAnnotationsNow("doc.pdf",ann);const manifestPath=await f.store.backupData(true);
    f.files.set("doc.pdf",Buffer.from("current source"));f.store.updateCard("source",{front:"current card"});await f.store.flush();
    const current=f.disk(),source=f.files.get("doc.pdf").toString(),sidecar=f.files.get("doc.pdf.mstudy.json").toString();
    await assert.rejects(f.store.restoreBackup(manifestPath),/选择要恢复的对象/);
    assert.deepEqual(f.disk(),current);assert.equal(f.files.get("doc.pdf").toString(),source);assert.equal(f.files.get("doc.pdf.mstudy.json").toString(),sidecar);assert.equal(f.store.cards[0].front,"current card");
  });
  await check("text/image overlays, deleted state, notebook identity and highlighter brush persist and reopen unchanged", async () => { const f = await fresh(); await f.store.loadAnnotations("doc.pdf"); await f.store.saveAnnotationsNow("doc.pdf", structuredClone(annotations)); const reopened = await f.reopen(); assert.deepEqual(await reopened.loadAnnotations("doc.pdf"), annotations); });
  await check("rich text styles survive Store reopen and invalid runs cannot overwrite the sidecar", async () => {
    const f = await fresh(), rich = structuredClone(annotations[0]); rich.overlay.fontFamily = "Arial";
    rich.overlay.textRuns = [{text:"Editable ",style:{fontFamily:"Arial",fontSize:14,bold:false,italic:false,underline:false,color:"#111111",background:"transparent"}}, {text:"overlay",style:{fontFamily:"Arial",fontSize:20,bold:true,italic:true,underline:true,color:"#ff0000",background:"#ffbf00"}}];
    await f.store.loadAnnotations("doc.pdf"); await f.store.saveAnnotationsNow("doc.pdf", [rich]);
    assert.deepEqual(await (await f.reopen()).loadAnnotations("doc.pdf"), [rich]);
    const original = f.files.get("doc.pdf.mstudy.json").toString();
    for (const mutate of [a=>a.overlay.textRuns[0].style.fontSize=Infinity,a=>a.overlay.textRuns[0].style.bold="yes",a=>a.overlay.textRuns[0].style.background="url(https://invalid.example/pixel)",a=>a.overlay.textRuns[0].text=42,a=>a.overlay.textRuns={}]) { const invalid = structuredClone(rich); mutate(invalid); assert.throws(()=>f.store.saveAnnotationsDebounced("doc.pdf",[invalid])); }
    await f.store.flush(); assert.equal(f.files.get("doc.pdf.mstudy.json").toString(),original);
  });
  await check("overlay soft deletion participates in one Store undo/redo while preserving the source annotation/card identity", async () => { const f = await fresh(); await f.store.loadAnnotations("doc.pdf"); await f.store.saveAnnotationsNow("doc.pdf", structuredClone(annotations)); const live = await f.store.loadAnnotations("doc.pdf"); f.store.libraryTransaction("Delete overlay", () => { live[0].overlay.deleted = true; f.store.saveAnnotationsDebounced("doc.pdf", live); }); assert.equal(live[0].overlay.deleted, true); assert.equal(f.store.undoLibraryChange(), true); assert.equal(live[0].overlay.deleted, false); assert.equal(f.store.getCard("source").anchorAnnId, "overlay-text"); assert.equal(f.store.redoLibraryChange(), true); assert.equal(live[0].overlay.deleted, true); await f.store.flush(); });
  await check("unsafe or malformed overlay edits are rejected before scheduling a sidecar overwrite", async () => { const f = await fresh(); await f.store.loadAnnotations("doc.pdf"); await f.store.saveAnnotationsNow("doc.pdf", structuredClone(annotations)); const original = f.files.get("doc.pdf.mstudy.json").toString(), count = f.writes.length;
    const invalid = [a => { a.overlay.deleted = "yes"; }, a => { a.overlay.box.x = -.1; }, a => { a.overlay.box.w = 2; }, a => { a.overlay.fontSize = Infinity; }, a => { a.overlay.background = "#fffff"; }, a => { a.overlay.kind = "image"; a.image = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="; a.overlay.deleted = true; }, a => { a.type = "highlight"; }];
    for (const mutate of invalid) { const draft = structuredClone(annotations); mutate(draft[0]); assert.throws(() => f.store.saveAnnotationsDebounced("doc.pdf", draft)); } await f.store.flush(); assert.equal(f.files.get("doc.pdf.mstudy.json").toString(), original); assert.equal(f.writes.length, count);
  });
  await check("invalid disk overlays block load and preserve the original bytes", async () => { const f = await fresh(), bad = structuredClone(annotations); bad[1].image = "javascript:bad"; const raw = JSON.stringify({ annotations: bad }); f.files.set("doc.pdf.mstudy.json", Buffer.from(raw)); await assert.rejects(f.store.loadAnnotations("doc.pdf")); assert.deepEqual(f.store.getAnnotationConflicts(), ["doc.pdf"]); assert.equal(f.files.get("doc.pdf.mstudy.json").toString(), raw); });
  await check("a live annotation mutated after scheduling is revalidated immediately before disk write", async () => { const f = await fresh(); await f.store.loadAnnotations("doc.pdf"); await f.store.saveAnnotationsNow("doc.pdf", structuredClone(annotations)); const raw = f.files.get("doc.pdf.mstudy.json").toString(), live = await f.store.loadAnnotations("doc.pdf"); f.store.saveAnnotationsDebounced("doc.pdf", live); live[0].overlay.deleted = "invalid"; await assert.rejects(f.store.flush()); assert.equal(f.files.get("doc.pdf.mstudy.json").toString(), raw); live[0].overlay.deleted = false; f.store.saveAnnotationsDebounced("doc.pdf", live); await f.store.flush(); assert.equal(f.files.get("doc.pdf.mstudy.json").toString(), raw); });
  await check("remote conflict adoption refuses unsafe overlays; choosing the valid local copy remains possible", async () => { const f = await fresh(); await f.store.loadAnnotations("doc.pdf"); await f.store.saveAnnotationsNow("doc.pdf", structuredClone(annotations)); const bad = structuredClone(annotations); bad[0].overlay.box.h = NaN; f.files.set("doc.pdf.mstudy.json", Buffer.from(JSON.stringify({ annotations: bad }))); const badRaw = f.files.get("doc.pdf.mstudy.json").toString(); await assert.rejects(f.store.resolveAnnotationConflict("doc.pdf", "remote")); assert.equal(f.files.get("doc.pdf.mstudy.json").toString(), badRaw); await f.store.resolveAnnotationConflict("doc.pdf", "local"); assert.deepEqual(JSON.parse(f.files.get("doc.pdf.mstudy.json")).annotations, annotations); });
  await check("a hash-valid backup with unsafe overlay data fails staging before any file or main-data mutation", async () => { const f = await fresh(); await f.store.loadAnnotations("doc.pdf"); await f.store.saveAnnotationsNow("doc.pdf", structuredClone(annotations)); const manifestPath = await f.store.backupData(true); assert.ok(manifestPath); const root = manifestPath.slice(0, manifestPath.lastIndexOf("/")), manifest = JSON.parse(f.files.get(manifestPath)), entry = manifest.files.find(item => item.path === "doc.pdf.mstudy.json"), bad = structuredClone(annotations); bad[1].image = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="; const payload = Buffer.from(JSON.stringify({ annotations: bad })); f.files.set(root + "/" + entry.storedPath, payload); entry.sha256 = hash(payload); entry.bytes = payload.byteLength; f.files.set(manifestPath, Buffer.from(JSON.stringify(manifest))); const beforeDisk = f.disk(), beforeSource = f.files.get("doc.pdf").toString(), writes = f.writes.length; await assert.rejects(f.store.prepareBackupRecovery(manifestPath)); assert.deepEqual(f.disk(), beforeDisk); assert.equal(f.files.get("doc.pdf").toString(), beforeSource); assert.equal(f.writes.length, writes); });
  await check("duplicate annotation identities and malformed legacy shapes cannot enter through backups or edits", () => { assert.throws(() => api.validateAnnotationCollection([annotations[0], annotations[0]])); assert.throws(() => api.validateAnnotationCollection([{ id: "x", rects: [] }])); });
  await check("a handwriting-only canvas counts as study content and survives save/reopen", async () => { const f = await fresh(); assert.equal(f.store.canvasHasNotes("canvas"), false); f.store.updateCanvas("canvas", { handwriting: structuredClone(ink) }); assert.equal(f.store.canvasHasNotes("canvas"), true); assert.equal(f.store.getCanvasKind("canvas"), "study"); await f.store.flush(); const reopened = await f.reopen(); assert.deepEqual(reopened.canvases[0].handwriting, ink); assert.equal(reopened.canvasHasNotes("canvas"), true); });
  await check("handwriting patches do not share mutable arrays and whole-stroke changes support undo/redo", async () => { const f = await fresh(), patch = structuredClone(ink); f.store.updateCanvas("canvas", { handwriting: patch }); patch.layers[0].strokes[0].points[0].x = 999; assert.equal(f.store.canvases[0].handwriting.layers[0].strokes[0].points[0].x, 50); const empty = structuredClone(ink); empty.layers[0].strokes = []; f.store.updateCanvas("canvas", { handwriting: empty }); assert.equal(f.store.canvasHasNotes("canvas"), false); f.store.undoLibraryChange(); assert.equal(f.store.canvasHasNotes("canvas"), true); f.store.redoLibraryChange(); assert.equal(f.store.canvasHasNotes("canvas"), false); await f.store.flush(); });
  await check("erasing the last default-layer stroke removes only the implicit empty container and supports undo/reopen", async () => {
    const f = await fresh();
    f.store.updateCanvas("canvas", { handwriting: structuredClone(ink) });
    await f.store.flush();
    const empty = structuredClone(ink); empty.layers[0].strokes = [];
    f.store.updateCanvas("canvas", { handwriting: empty });
    assert.equal(Object.hasOwn(f.store.canvases[0], "handwriting"), false);
    assert.equal(f.store.canvasHasNotes("canvas"), false);
    await f.store.flush();
    assert.equal(Object.hasOwn((await f.reopen()).canvases[0], "handwriting"), false);
    assert.equal(f.store.undoLibraryChange(), true);
    assert.deepEqual(f.store.canvases[0].handwriting, ink);
    assert.equal(f.store.redoLibraryChange(), true);
    assert.equal(Object.hasOwn(f.store.canvases[0], "handwriting"), false);
  });
  await check("custom empty sketch layers and legacy empty containers survive save/reopen without load-time migration", async () => {
    const empty = { version: 1, layers: [{ id: "default", name: "Default", strokes: [] }], activeLayerId: "default" };
    for (const data of [
      { ...structuredClone(empty), layers: [{ id: "default", name: "My sketch", strokes: [] }] },
      { ...structuredClone(empty), layers: [{ id: "custom", name: "Default", strokes: [] }], activeLayerId: "custom" },
      { ...structuredClone(empty), layers: [...empty.layers, { id: "reference", name: "Reference", strokes: [] }], overlayLayerId: "reference" },
    ]) {
      const f = await fresh(); f.store.updateCanvas("canvas", { handwriting: data }); await f.store.flush();
      assert.deepEqual((await f.reopen()).canvases[0].handwriting, data);
    }
    const legacy = await fresh(), saved = legacy.disk(); saved.canvases[0].handwriting = empty;
    await legacy.host.saveData(saved);
    const reopened = await legacy.reopen();
    assert.deepEqual(reopened.canvases[0].handwriting, empty);
    reopened.updateCanvas("canvas", { name: "Renamed map" }); await reopened.flush();
    assert.deepEqual((await legacy.reopen()).canvases[0].handwriting, empty);
  });
  await check("an unsupported handwriting version cannot silently erase existing ink", async () => { const f = await fresh(); f.store.updateCanvas("canvas", { handwriting: structuredClone(ink) }); const before = structuredClone(f.store.canvases[0].handwriting); assert.throws(() => f.store.updateCanvas("canvas", { handwriting: { version: 2, layers: [] } })); assert.deepEqual(f.store.canvases[0].handwriting, before); await f.store.flush(); });
} catch (error) { failure = error; process.exitCode = 1; console.error(error.stack || error); }
finally { await Promise.all(stores.map(store => store.flush().catch(() => {}))); await writeFile(join(evidence, "model-additive-results.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), environment: "real Store over synthetic in-memory files and backup hashes", checks, ...failure ? { error: String(failure.stack || failure) } : {} }, null, 2)); await rm(temporary, { recursive: true, force: true }); console.log(`${checks.length} additive-model checks passed.`); }
