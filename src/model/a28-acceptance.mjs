import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "marginstudy-a28-"));
const stamp = "2020-01-01T00:00:00.000Z";
const built = await build({ stdin: { contents: 'export {Store} from "./store.ts";', resolveDir: here }, bundle: true, platform: "node", format: "cjs", write: false,
  plugins: [{ name: "synthetic-obsidian", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "synthetic" }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: "export class App {} export class TFile {} export class Notice {} export class Component {} export const MarkdownRenderer={render:async()=>{}};" }));
  } }] });
const bundle = join(temporary, "store.cjs");
await writeFile(bundle, built.outputFiles[0].contents);
const { Store } = createRequire(import.meta.url)(bundle);
const stores = [], results = [];

async function check(name, run) {
  try { results.push({ name, passed: true, detail: await run() }); }
  catch (error) { results.push({ name, passed: false, error: String(error.stack || error) }); }
}

async function fresh() {
  let disk = { revision: 4, cards: [
    { id: "card-one", type: "excerpt", docPath: "source.pdf", front: "original one", tags: ["keep"], links: [], createdAt: stamp },
    { id: "card-two", type: "excerpt", docPath: "source.pdf", front: "original two", tags: ["other"], links: [], createdAt: stamp },
  ], nodes: [], edges: [], srs: {}, studySets: [], canvases: [], documents: [{ id: "doc-one", path: "source.pdf", kind: "pdf", createdAt: stamp }] };
  const files = new Map(), directories = new Set(), writes = [];
  const adapter = { exists: async path => files.has(path) || directories.has(path), mkdir: async path => directories.add(path), list: async path => ({ files: [...files.keys()].filter(name => name.startsWith(path + "/")), folders: [] }),
    read: async path => { if (!files.has(path)) throw new Error("synthetic file missing: " + path); return files.get(path); },
    write: async (path, content) => { writes.push({ path, content }); files.set(path, content); } };
  const host = { app: { vault: { adapter, getFiles: () => [] } }, loadData: async () => structuredClone(disk), saveData: async value => { disk = structuredClone(value); } };
  const store = new Store(host); await store.load(); stores.push(store);
  return { store, host, files, writes, disk: () => structuredClone(disk), external: value => { disk = structuredClone(value); },
    reopen: async () => { const next = new Store(host); await next.load(); stores.push(next); return next; } };
}

function requireStatus(store) {
  assert.equal(typeof store.getSyncStatus, "function", "local status panel is absent");
  assert.equal(typeof store.getLocalEvents, "function", "local event ledger is absent");
}
function requireProtection(store) {
  assert.equal(typeof store.listProtectionSnapshots, "function", "recoverable protection snapshots are absent");
  assert.equal(typeof store.restoreProtectionSnapshot, "function", "selected-object recovery is absent");
}
function assertEvidence(store) {
  const events = store.getLocalEvents(), ids = new Set(events.map(event => event.id)), status = store.getSyncStatus();
  assert.ok(events.length);
  for (const event of events) {
    assert.ok(event.id && event.at && event.kind && Array.isArray(event.objectIds) && typeof event.detail === "string");
  }
  assert.ok(status.length >= 5);
  for (const item of status) {
    assert.ok(item.evidenceEventIds?.length, `missing evidence for ${item.key}`);
    for (const id of item.evidenceEventIds) assert.ok(ids.has(id), `unknown event ${id} for ${item.key}`);
  }
  return status;
}
async function makeConflict(fixture) {
  const external = fixture.disk(); external.cards[0].front = "external one";
  fixture.external(external); fixture.store.updateCard("card-one", { front: "local one" });
  await assert.rejects(fixture.store.flush(), /外部修改/);
}

await check("1 status items trace to persisted local events", async () => {
  const f = await fresh(); requireStatus(f.store);
  assertEvidence(f.store);
  f.store.updateCard("card-one", { back: "pending" });
  assert.match(assertEvidence(f.store).find(item => item.key === "local").text, /待保存/);
  await f.store.flush();
  assert.match(assertEvidence(f.store).find(item => item.key === "local").text, /已保存/);
  f.store.markDocumentMissing("source.pdf"); await f.store.flush();
  const missing = assertEvidence(f.store).find(item => item.key === "missing");
  assert.match(missing.text, /文件缺失/);
  assert.ok(f.disk().localEvents.some(event => event.kind === "file-missing" && event.objectIds.includes("doc-one")));
  const reopened = await f.reopen(); assertEvidence(reopened);
  assert.ok(reopened.getLocalEvents().some(event => event.kind === "file-missing" && event.objectIds.includes("doc-one")));
  return { pending: true, saved: true, missing: true, reopened: true };
});

await check("2 snapshot exists before external merge and failure refuses application", async () => {
  const f = await fresh(); requireProtection(f.store); await makeConflict(f);
  let duringWrite;
  const originalSave = f.host.saveData;
  f.host.saveData = async data => { duringWrite = await f.store.listProtectionSnapshots(); await originalSave(data); };
  await f.store.resolveDataConflict("merge");
  assert.ok(duringWrite?.length, "snapshot missing before merged write");
  const snapshot = duringWrite[0];
  assert.ok(snapshot.createdAt && snapshot.scope.some(item => item.id === "card-one"));
  const raw = JSON.parse(f.files.get(snapshot.path));
  assert.equal(raw.objects.find(item => item.id === "card-one").value.front, "local one");
  assert.ok(f.store.cards.some(card => card.front === "external one"));
  assert.ok(f.store.getLocalEvents().some(event => event.kind === "conflict-merged"));
  assert.ok(f.store.getLocalEvents().some(event => event.kind === "external-applied"));
  assert.ok((await f.reopen()).getLocalEvents().some(event => event.kind === "external-applied"));
  assert.ok((await f.reopen()).listProtectionSnapshots, "snapshot discovery unavailable after reopen");
  assert.ok((await (await f.reopen()).listProtectionSnapshots()).some(item => item.path === snapshot.path));
  const failed = await fresh(); await makeConflict(failed);
  const before = structuredClone(failed.store.cards), beforeDisk = failed.disk(), originalWrite = failed.host.app.vault.adapter.write;
  failed.host.app.vault.adapter.write = async (path, content) => {
    if (path.includes("protection-")) throw new Error("synthetic snapshot failure");
    return originalWrite(path, content);
  };
  await assert.rejects(failed.store.resolveDataConflict("merge"), /snapshot failure/);
  assert.deepEqual(failed.store.cards, before); assert.deepEqual(failed.disk(), beforeDisk);
  assert.ok(failed.store.conflictPath);
  const race = await fresh(); await makeConflict(race);
  const raceWrite = race.host.app.vault.adapter.write; let edited = false;
  race.host.app.vault.adapter.write = async (path, content) => { await raceWrite(path, content); if (path.includes("protection-") && !edited) { edited = true; race.store.updateCard("card-two", { front: "concurrent edit" }); } };
  await assert.rejects(race.store.resolveDataConflict("merge"), /期间本地数据发生变化/);
  assert.equal(race.store.getCard("card-two").front, "concurrent edit"); assert.ok(race.store.conflictPath);
  const raceAfterRead = await fresh(); await makeConflict(raceAfterRead);
  const originalRead = raceAfterRead.host.app.vault.adapter.read; let changedAfterRead = false;
  raceAfterRead.host.app.vault.adapter.read = async path => { const content = await originalRead(path); if (path.includes("protection-") && !changedAfterRead) { changedAfterRead = true; raceAfterRead.store.updateCard("card-two", { front: "changed during snapshot verification" }); } return content; };
  await assert.rejects(raceAfterRead.store.resolveDataConflict("merge"), /期间本地数据发生变化/);
  assert.equal(raceAfterRead.store.getCard("card-two").front, "changed during snapshot verification");
  const sidecar = await fresh();
  const original = [{ id: "ann-one", type: "highlight", docPath: "source.pdf", page: 1, rects: [], text: "original", color: "#ffff00", createdAt: stamp }];
  const other = { ...original[0], id: "ann-two", text: "untouched" };
  sidecar.files.set("source.pdf.mstudy.json", JSON.stringify({ annotations: [...original, other] }));
  const annotations = await sidecar.store.loadAnnotations("source.pdf"); annotations[0].text = "local annotation"; sidecar.store.saveAnnotationsDebounced("source.pdf", annotations);
  sidecar.files.set("source.pdf.mstudy.json", JSON.stringify({ annotations: [{ ...original[0], text: "external annotation" }, other] }));
  await assert.rejects(sidecar.store.flush(), /外部修改/);
  const sidecarWrite = sidecar.host.app.vault.adapter.write; let seenBeforeSidecar = false;
  sidecar.host.app.vault.adapter.write = async (path, content) => { if (path === "source.pdf.mstudy.json") seenBeforeSidecar = (await sidecar.store.listProtectionSnapshots()).some(item => item.scope.some(entry => entry.id === "ann-one")); return sidecarWrite(path, content); };
  await sidecar.store.resolveAnnotationConflict("source.pdf", "merge"); await sidecar.store.flush();
  assert.ok(seenBeforeSidecar); const [annotationSnapshot] = await sidecar.store.listProtectionSnapshots();
  const live = await sidecar.store.loadAnnotations("source.pdf"); live.find(item => item.id === "ann-one").text = "later edit"; live.find(item => item.id === "ann-two").text = "other later edit";
  sidecar.store.saveAnnotationsDebounced("source.pdf", live); await sidecar.store.flush();
  const otherBefore = structuredClone(live.filter(item => item.id !== "ann-one"));
  await sidecar.store.restoreProtectionSnapshot(annotationSnapshot.path, ["ann-one"]); await sidecar.store.flush();
  assert.equal(live.find(item => item.id === "ann-one").text, "local annotation"); assert.deepEqual(live.filter(item => item.id !== "ann-one"), otherBefore);
  const blockedSidecar = await fresh(); blockedSidecar.files.set("source.pdf.mstudy.json", JSON.stringify({ annotations: original }));
  const localAnnotation = await blockedSidecar.store.loadAnnotations("source.pdf"); localAnnotation[0].text = "local pending"; blockedSidecar.store.saveAnnotationsDebounced("source.pdf", localAnnotation);
  const remoteText = JSON.stringify({ annotations: [{ ...original[0], text: "external pending" }] }); blockedSidecar.files.set("source.pdf.mstudy.json", remoteText);
  await assert.rejects(blockedSidecar.store.flush(), /外部修改/);
  const normalWrite = blockedSidecar.host.app.vault.adapter.write;
  blockedSidecar.host.app.vault.adapter.write = async (path, content) => { if (path.includes("protection-")) throw new Error("synthetic annotation protection failure"); return normalWrite(path, content); };
  await assert.rejects(blockedSidecar.store.resolveAnnotationConflict("source.pdf", "merge"), /annotation protection failure/);
  assert.equal(localAnnotation[0].text, "local pending"); assert.equal(blockedSidecar.files.get("source.pdf.mstudy.json"), remoteText); assert.ok(blockedSidecar.store.getAnnotationConflicts().includes("source.pdf"));
  return { snapshotBeforeWrite: true, scope: snapshot.scope.length, failureRejected: true, concurrentEditRetained: true, sidecarProtected: true, annotationFailureRejected: true, annotationSelectedOnly: true };
});

await check("3 missing file and deleted object use different text and actions", async () => {
  const f = await fresh(); requireStatus(f.store);
  f.store.markDocumentMissing("source.pdf"); f.store.removeCard("card-one");
  const status = assertEvidence(f.store), missing = status.find(item => item.key === "missing"), deleted = status.find(item => item.key === "deleted");
  assert.match(missing.text, /文件缺失/); assert.doesNotMatch(missing.text, /删除/);
  assert.match(deleted.text, /对象已删除/); assert.doesNotMatch(deleted.text, /缺失/);
  assert.ok(missing.action && deleted.action); assert.notEqual(missing.action, deleted.action);
  assert.ok(f.store.getLocalEvents().some(event => event.kind === "object-deleted" && event.objectIds.includes("card-one")));
  await f.store.flush();
  return { missingText: missing.text, missingAction: missing.action, deletedText: deleted.text, deletedAction: deleted.action };
});

await check("4 selected recovery leaves all other objects unchanged", async () => {
  const f = await fresh(); requireProtection(f.store); await makeConflict(f); await f.store.resolveDataConflict("merge");
  const [snapshot] = await f.store.listProtectionSnapshots();
  f.store.updateCard("card-one", { front: "edited after merge" });
  f.store.updateCard("card-two", { front: "keep later edit", tags: ["untouched", "later"] });
  await f.store.flush();
  const before = structuredClone({ cards: f.store.cards.filter(item => item.id !== "card-one"), nodes: f.store.nodes, edges: f.store.edges,
    documents: f.store.documents, sets: f.store.studySets, canvases: f.store.canvases, srs: f.store.srs, settings: f.store.settings });
  await f.store.restoreProtectionSnapshot(snapshot.path, ["card-one"]); await f.store.flush();
  assert.equal(f.store.getCard("card-one").front, "local one");
  assert.deepEqual({ cards: f.store.cards.filter(item => item.id !== "card-one"), nodes: f.store.nodes, edges: f.store.edges,
    documents: f.store.documents, sets: f.store.studySets, canvases: f.store.canvases, srs: f.store.srs, settings: f.store.settings }, before);
  assert.ok(f.store.getLocalEvents().some(event => event.kind === "restored" && JSON.stringify(event.objectIds) === '["card-one"]'));
  await assert.rejects(f.store.restoreProtectionSnapshot(snapshot.path, []));
  await assert.rejects(f.store.restoreProtectionSnapshot(snapshot.path, ["not-in-snapshot"]));
  const beforeTamper = structuredClone(f.store.cards), content = f.files.get(snapshot.path), tampered = JSON.parse(content);
  tampered.objects[0].value.front = "tampered"; f.files.set(snapshot.path, JSON.stringify(tampered));
  await assert.rejects(f.store.restoreProtectionSnapshot(snapshot.path, ["card-one"]), /校验/);
  assert.deepEqual(f.store.cards, beforeTamper); f.files.set(snapshot.path, content);
  await assert.rejects(f.store.restoreBackup("MarginStudyBackups/synthetic/manifest.json"), /选择要恢复的对象/);
  return { restored: ["card-one"], otherObjectsDeepEqual: true, tamperRejected: true, wholeLibraryRejected: true };
});

await check("5 cloud status never claims upload or cloud sync", async () => {
  const f = await fresh(); requireStatus(f.store);
  const cloud = assertEvidence(f.store).find(item => item.key === "cloud");
  assert.match(cloud.text, /无法确认/); assert.match(cloud.text, /本插件不接入云端/);
  assert.doesNotMatch(cloud.text, /已上传|已同步云端|已同步到云端/);
  return { text: cloud.text };
});

await check("6 snapshot failures, retries, concurrent edits and legacy loads stay safe", async () => {
  const f = await fresh();
  const legacy = f.disk(); legacy.documents[0].missing = true; f.external(legacy);
  const reopened = await f.reopen();
  assert.ok(reopened.getSyncStatus().find(item => item.key === "missing").evidenceEventIds.some(id => reopened.getLocalEvents().some(event => event.id === id && event.kind === "file-missing")));
  f.store.updateCard("card-one", { front: "local retry" }); await assert.rejects(f.store.flush(), /外部修改/);
  const originalSave = f.host.saveData; let fail = true;
  f.host.saveData = async data => { if (fail) { fail = false; throw new Error("synthetic main save failure"); } return originalSave(data); };
  await assert.rejects(f.store.resolveDataConflict("merge"), /main save failure/);
  assert.equal(f.store.getCard("card-one").front, "local retry"); assert.ok(f.store.conflictPath);
  await f.store.resolveDataConflict("merge");
  const snapshot = (await f.store.listProtectionSnapshots()).find(item => item.reason === "处理主数据外部修改");
  f.store.updateCard("card-one", { front: "current before retry" }); await f.store.flush();
  const before = structuredClone(f.store.cards), write = f.host.app.vault.adapter.write;
  f.host.app.vault.adapter.write = async (path, content) => { if (path.includes("protection-")) throw new Error("synthetic pre-restore failure"); return write(path, content); };
  await assert.rejects(f.store.restoreProtectionSnapshot(snapshot.path, ["card-one"]), /pre-restore failure/);
  assert.deepEqual(f.store.cards, before);
  f.host.app.vault.adapter.write = write;
  await f.store.restoreProtectionSnapshot(snapshot.path, ["card-one"]); await f.store.flush();
  const prior = (await f.store.listProtectionSnapshots()).find(item => item.reason === "恢复选定对象之前");
  assert.ok(prior); assert.equal(JSON.parse(f.files.get(prior.path)).objects.find(item => item.id === "card-one").value.front, "current before retry");
  return { legacyEvidence: true, mergeWriteRetry: true, restoreSafetyFailureRejected: true, priorSelectedVersionRetained: true };
});

await check("7 missing-source recovery preserves identity and records local recovery", async () => {
  const f = await fresh();
  const contents = new TextEncoder().encode("same synthetic document");
  f.files.set("relocated.pdf", new TextDecoder().decode(contents));
  f.host.app.vault.adapter.readBinary = async path => { const value = f.files.get(path); if (value === undefined) throw new Error("not found"); return new TextEncoder().encode(value).buffer; };
  f.host.app.vault.getFiles = () => [...f.files.keys()].map(path => ({ path }));
  f.store.findMatchingDocumentPaths = async id => id === "doc-one" ? ["relocated.pdf"] : [];
  f.store.markDocumentMissing("source.pdf");
  await f.store.restoreDocumentAtPath("doc-one", "relocated.pdf");
  assert.equal(f.store.documents.find(doc => doc.id === "doc-one").path, "relocated.pdf");
  assert.ok(f.store.getLocalEvents().some(event => event.kind === "restored" && event.objectIds.includes("doc-one")));
  assert.ok(f.disk().localEvents.some(event => event.kind === "restored" && event.objectIds.includes("doc-one")));
  return { identityPreserved: true, eventPersisted: true };
});

await check("8 status evidence survives conflict choices, reload and repeated saves", async () => {
  const f = await fresh(); requireStatus(f.store);
  f.store.markDocumentMissing("source.pdf");
  await f.store.flush();
  const external = f.disk(); external.cards[0].front = "external chosen"; external.documents[0].missing = true;
  f.external(external); f.store.updateCard("card-one", { front: "local preserved" }); await assert.rejects(f.store.flush(), /外部修改/);
  const eventBefore = f.store.getSyncStatus().find(item => item.key === "conflict").evidenceEventIds[0];
  await f.store.resolveDataConflict("remote");
  assert.ok(f.disk().localEvents.some(event => event.id === eventBefore));
  assert.equal(f.store.getCard("card-one").front, "external chosen");
  for (let index = 0; index < 30; index++) { f.store.updateCard("card-two", { front: `changed ${index}` }); await f.store.flush(); }
  const status = assertEvidence(f.store), missing = status.find(item => item.key === "missing");
  assert.ok(missing.evidenceEventIds.some(id => f.store.getLocalEvents().some(event => event.id === id && event.kind === "file-missing" && event.objectIds.includes("doc-one"))));
  assertEvidence(await f.reopen());
  const collide = await fresh(); await collide.store.flush();
  collide.store.updateCard("card-one", { front: "pending for duplicate" }); await collide.store.flush();
  const diskWithCollision = collide.disk();
  diskWithCollision.localEvents[0].detail = "conflicting event payload";
  collide.external(diskWithCollision); collide.store.updateCard("card-one", { front: "local survives duplicate" });
  await assert.rejects(collide.store.flush(), /外部修改/);
  await assert.rejects(collide.store.resolveDataConflict("merge"), /事件 ID 冲突/);
  assert.equal(collide.store.getCard("card-one").front, "local survives duplicate"); assert.ok(collide.store.conflictPath);
  return { conflictEventPersisted: true, remoteChoice: true, missingEvidenceRetained: true, writes: 30, duplicateEventIdRejected: true };
});

for (const store of stores) if (store.saveTimer !== null) clearTimeout(store.saveTimer);
const report = { environment: "synthetic in-memory host and files; no user vault", results };
await writeFile(join(temporary, "results.json"), JSON.stringify(report, null, 2) + "\n");
for (const result of results) console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}: ${JSON.stringify(result.detail ?? result.error)}`);
console.log(`${results.slice(0, 5).filter(result => result.passed).length}/5 A28 checks passed`);
console.log(`${results.slice(5).filter(result => result.passed).length}/${results.length - 5} A28 extra safety checks passed`);
console.log(`Results: ${join(temporary, "results.json")}`);
if (results.some(result => !result.passed)) process.exitCode = 1;
