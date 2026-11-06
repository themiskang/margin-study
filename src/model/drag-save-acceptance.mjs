import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bundle = await build({ stdin: { contents: 'export {Store} from "./src/model/store";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "cjs", write: false, plugins: [{ name: "obsidian", setup(builder) { builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "mock" })); builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export class Notice {} export class TFile {} export class Component {} export const MarkdownRenderer={};" })); } }] });
const path = join(await mkdtemp(join(tmpdir(), "marginstudy-drag-")), "store.cjs");
await writeFile(path, bundle.outputFiles[0].contents);
const { Store } = createRequire(import.meta.url)(path);
let disk = { nodes: [{ id: "node", x: 0, y: 0, title: "x".repeat(Number(process.env.DRAG_SAVE_SIZE || 4)), parentId: null }], cards: [], edges: [] }, writes = 0, bytes = 0, saveMs = 0;
const files = new Map(), dirs = new Set();
const adapter = { exists: async path => files.has(path) || dirs.has(path), mkdir: async path => dirs.add(path), read: async path => files.get(path), write: async (path, data) => files.set(path, data), remove: async path => files.delete(path) };
const host = { app: { vault: { adapter, getFiles: () => [] } }, loadData: async () => structuredClone(disk), saveData: async data => { const start = performance.now(); writes++; bytes = Buffer.byteLength(JSON.stringify(data)); disk = structuredClone(data); saveMs = performance.now() - start; } };
const store = new Store(host);
await store.load();
for (let index = 1; index <= 100; index++) { store.moveNode("node", index, index * 2); await new Promise(resolve => setTimeout(resolve, 5)); }
await new Promise(resolve => setTimeout(resolve, 300));
console.log(`writes in debounce window: ${writes}`);
if (writes) console.log(`synthetic saveData: ${saveMs.toFixed(3)} ms, ${bytes} bytes`);
assert.equal(writes, 0, "writes must wait for 800ms of inactivity");
await store.flush();
assert.equal(writes, 1);
const reopened = new Store(host); await reopened.load();
assert.deepEqual({ x: reopened.getNode("node").x, y: reopened.getNode("node").y }, { x: 100, y: 200 });
console.log("PASS 100 moves coalesced and restored");
console.log(`synthetic saveData: ${saveMs.toFixed(3)} ms, ${bytes} bytes`);
