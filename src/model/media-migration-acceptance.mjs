import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const bundle = await build({ stdin: { contents: 'export {Store} from "./src/model/store"; export {imageUrl} from "./src/review/content";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "cjs", write: false, plugins: [{ name: "obsidian", setup(builder) {
  builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "mock" }));
  builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export class Notice {} export class TFile {} export class Component {} export const MarkdownRenderer={};" }));
} }] });
const bundlePath = join(await mkdtemp(join(tmpdir(), "marginstudy-media-")), "test.cjs");
await writeFile(bundlePath, bundle.outputFiles[0].contents);
const { Store, imageUrl } = createRequire(import.meta.url)(bundlePath);
const imageBytes = Buffer.alloc(14 * 1024 * 1024, 42);
const source = "data:image/png;base64," + imageBytes.toString("base64");
const card = { id: "card", docPath: "sample.pdf", front: "", tags: [], links: [], image: source };
let disk = { cards: [card], nodes: [{ id: "node", title: "node", x: 0, y: 0 }], edges: [] };
const before = Buffer.byteLength(JSON.stringify(disk));
const files = new Map(), dirs = new Set(), modified = new Map();
const interruptedPath = "_marginstudy-media/" + createHash("sha256").update(imageBytes).digest("hex") + ".png";
files.set(interruptedPath, Buffer.from("interrupted"));
let failWrite = false;
const adapter = {
  exists: async path => files.has(path) || dirs.has(path),
  mkdir: async path => dirs.add(path),
  writeBinary: async (path, bytes) => { if (failWrite) throw new Error("synthetic write failure"); files.set(path, Buffer.from(bytes)); },
  readBinary: async path => Uint8Array.from(files.get(path)).buffer,
  write: async (path, text) => { files.set(path, text); modified.set(path, Date.now()); },
  read: async path => files.get(path),
  list: async path => ({ files: [...files.keys()].filter(file => file.startsWith(path + "/")), folders: [] }),
  stat: async path => files.has(path) ? { type: "file", size: Buffer.byteLength(files.get(path)), mtime: modified.get(path) ?? 0 } : null,
  remove: async path => files.delete(path),
  getResourcePath: path => "mock:///" + path,
};
const vault = { adapter, getFiles: () => [], getAbstractFileByPath: () => null };
const host = { app: { vault }, loadData: async () => structuredClone(disk), saveData: async data => { disk = structuredClone(data); } };
const plugin = { app: { vault } };
const load = src => src.startsWith("data:") ? Buffer.from(src.split(",")[1], "base64") : files.get(src.replace("mock:///", ""));
assert.deepEqual(load(imageUrl(plugin, source)), imageBytes);
const store = new Store(host);
await store.load();
await store.flush();
const after = Buffer.byteLength(JSON.stringify(disk));
assert.ok(before > 18 * 1024 * 1024 && after < 1024 * 1024, `${before} -> ${after}`);
const external = disk.cards[0].image;
assert.match(external, /^_marginstudy-media\/[a-f0-9]{64}\.png$/);
assert.deepEqual(load(imageUrl(plugin, external)), imageBytes);
const fileCount = [...files.keys()].filter(path => path.startsWith("_marginstudy-media/")).length;
store.save();
await store.flush();
assert.equal(disk.cards[0].image, external);
assert.equal([...files.keys()].filter(path => path.startsWith("_marginstudy-media/")).length, fileCount);
const duplicate = "data:image/jpeg;base64," + Buffer.alloc(70000, 17).toString("base64");
store.cards[0].images = [duplicate];
store.cards[0].commentMedia = [{ id: "comment", kind: "image", image: duplicate }];
store.cards[0].extendMedia = [{ noteId: "note", image: duplicate }];
store.cards[0].excerptBlocks = [{ id: "block", image: duplicate }];
store.cards[0].sources = [{ docPath: "sample.pdf", image: duplicate }];
store.nodes[0].image = duplicate;
store.save();
await store.flush();
const saved = disk.cards[0].images[0];
assert.equal(disk.cards[0].commentMedia[0].image, saved);
assert.equal(disk.cards[0].extendMedia[0].image, saved);
assert.equal(disk.cards[0].excerptBlocks[0].image, saved);
assert.equal(disk.cards[0].sources[0].image, saved);
assert.equal(disk.nodes[0].image, saved);
assert.equal([...files.keys()].filter(path => path.startsWith("_marginstudy-media/")).length, fileCount + 1);
const failed = "data:image/png;base64," + Buffer.alloc(70001, 9).toString("base64");
failWrite = true;
store.cards[0].image = failed;
store.save();
await store.flush();
assert.equal(disk.cards[0].image, failed);
assert.equal(store.cards[0].image, failed);
console.log(`PASS synthetic migration ${before} -> ${after} bytes; idempotence, failure fallback, rendering and all fields`);
await new Promise(resolve => setTimeout(resolve, 50));
for (const path of [...files.keys()]) if (path.startsWith("_marginstudy-recovery/")) files.delete(path);
for (let index = 0; index < 3; index++) {
  const writerId = `device-old${index}-abc123`;
  await adapter.write(`_marginstudy-recovery/pending-main-${writerId}.json`, JSON.stringify({ schemaVersion: 2, writerId, padding: "x".repeat(19_200_000) }));
}
const foreign = "_marginstudy-recovery/other-user-file.json";
await adapter.write(foreign, "do not delete");
disk = { cards: [], nodes: [], edges: [] };
failWrite = false;
for (let index = 0; index < 10; index++) {
  const session = new Store(host);
  await session.load();
  session.save();
  await session.flush();
  for (let attempt = 0; attempt < 100 && [...files.keys()].filter(path => path.startsWith("_marginstudy-recovery/pending-main-")).length > 3; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
}
await new Promise(resolve => setTimeout(resolve, 100));
const recoveries = [...files.entries()].filter(([path]) => path.startsWith("_marginstudy-recovery/pending-main-"));
const recoveryBytes = recoveries.reduce((sum, [, value]) => sum + Buffer.byteLength(value), 0);
assert.ok(recoveries.length <= 3 && recoveryBytes < 1_000_000, `${recoveries.length} files, ${recoveryBytes} bytes`);
assert.equal(files.get(foreign), "do not delete");
console.log(`PASS 10 sessions: ${recoveries.length} recovery files, ${recoveryBytes} bytes; unrelated file retained`);
const pictures = [1, 2, 3].map(value => "data:image/jpeg;base64," + Buffer.alloc(2 * 1024 * 1024, value).toString("base64"));
const annotations = pictures.map((image, index) => ({ id: `ann-${index}`, docPath: "sample.pdf", type: "region", rects: [], image }));
const sidecarBefore = Buffer.byteLength(JSON.stringify({ annotations }));
const annotationStore = new Store(host);
await annotationStore.load();
await annotationStore.loadAnnotations("sample.pdf");
await annotationStore.saveAnnotationsNow("sample.pdf", annotations);
const sidecarPath = "sample.pdf.mstudy.json", firstSidecar = files.get(sidecarPath);
assert.ok(Buffer.byteLength(firstSidecar) < 200_000);
const savedAnnotations = JSON.parse(firstSidecar).annotations;
const reloadedStore = new Store(host);
await reloadedStore.load();
assert.deepEqual(await reloadedStore.loadAnnotations("sample.pdf"), savedAnnotations);
for (let index = 0; index < pictures.length; index++) {
  assert.match(savedAnnotations[index].image, /^_marginstudy-media\/[a-f0-9]{64}\.jpg$/);
  assert.deepEqual(load(imageUrl(plugin, savedAnnotations[index].image)), Buffer.alloc(2 * 1024 * 1024, index + 1));
}
await annotationStore.saveAnnotationsNow("sample.pdf", savedAnnotations);
assert.equal(files.get(sidecarPath), firstSidecar);
failWrite = true;
const failedAnnotation = { id: "failed", type: "region", rects: [], image: "data:image/png;base64," + Buffer.alloc(70002, 4).toString("base64") };
await annotationStore.saveAnnotationsNow("sample.pdf", [failedAnnotation]);
assert.equal(JSON.parse(files.get(sidecarPath)).annotations[0].image, failedAnnotation.image);
failWrite = false;
for (let index = 0; index < 10; index++) {
  const session = new Store(host), path = `document-${index}.pdf`;
  await session.load();
  await session.loadAnnotations(path);
  await session.saveAnnotationsNow(path, [{ id: `ann-${index}`, type: "region", rects: [], image: pictures[index % 3] }]);
}
const annRecoveries = [...files.entries()].filter(([path]) => path.startsWith("_marginstudy-recovery/pending-annotations-"));
const annBytes = annRecoveries.reduce((sum, [, value]) => sum + Buffer.byteLength(value), 0);
assert.ok(annRecoveries.length <= 3 && annBytes < 2 * 1024 * 1024, `${annRecoveries.length} files, ${annBytes} bytes`);
console.log(`PASS annotations ${sidecarBefore} -> ${Buffer.byteLength(firstSidecar)} bytes; 10 sessions: ${annRecoveries.length} files, ${annBytes} bytes; idempotence, failure fallback, rendering`);
