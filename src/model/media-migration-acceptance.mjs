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
const files = new Map(), dirs = new Set();
const interruptedPath = "_marginstudy-media/" + createHash("sha256").update(imageBytes).digest("hex") + ".png";
files.set(interruptedPath, Buffer.from("interrupted"));
let failWrite = false;
const adapter = {
  exists: async path => files.has(path) || dirs.has(path),
  mkdir: async path => dirs.add(path),
  writeBinary: async (path, bytes) => { if (failWrite) throw new Error("synthetic write failure"); files.set(path, Buffer.from(bytes)); },
  readBinary: async path => Uint8Array.from(files.get(path)).buffer,
  write: async (path, text) => files.set(path, text),
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
