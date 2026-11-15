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
store.noteInputActivity(1);
store.moveNode("node", 101, 202);
await new Promise(resolve => setTimeout(resolve, 1450));
assert.equal(writes, 1, "active input must not write");
store.noteInputActivity(0);
store.moveNode("node", 102, 204);
await new Promise(resolve => setTimeout(resolve, 500));
store.noteInputActivity(-1);
await new Promise(resolve => setTimeout(resolve, 700));
assert.equal(writes, 1, "input session must remain coalesced");
await new Promise(resolve => setTimeout(resolve, 1200));
assert.equal(writes, 2, "quiet input session must eventually write once");
await new Promise(resolve => setTimeout(resolve, 1000));
assert.equal(writes, 2, "continuous input must produce only one main write");
console.log("PASS input activity gates and coalesces automatic writes");
const largeText = ("字😀\\\"\n".repeat(50000));
const directFiles = new Map(), directDirs = new Set([".obsidian/plugins/margin-study"]);
const directAdapter = {
  exists: async path => directFiles.has(path) || directDirs.has(path),
  mkdir: async path => directDirs.add(path),
  read: async path => directFiles.get(path),
  write: async (path, value) => directFiles.set(path, value),
  remove: async path => directFiles.delete(path),
};
const dataPath = ".obsidian/plugins/margin-study/data.json";
const directHost = {
  manifest: { dir: ".obsidian/plugins/margin-study" },
  app: { vault: { adapter: directAdapter, getFiles: () => [] } },
  loadData: async () => directFiles.has(dataPath) ? JSON.parse(directFiles.get(dataPath)) : null,
  saveData: async () => { throw new Error("direct adapter write expected"); },
};
const direct = new Store(directHost);
await direct.load();
direct.saveWorkspaceState({ largeText });
let yielded = false;
setTimeout(() => { yielded = true; }, 0);
await direct.flush();
assert.equal(yielded, true, "large serialization must yield");
assert.equal(JSON.parse(directFiles.get(dataPath)).workspaceState.largeText, largeText);
const reopenedDirect = new Store(directHost);
await reopenedDirect.load();
assert.equal(reopenedDirect.getWorkspaceState().largeText, largeText);
console.log("PASS large adapter write yields and survives reopen");
const annotations = await direct.loadAnnotations("doc.pdf");
for (let index = 0; index < 6; index++) {
  direct.noteInputActivity(1);
  annotations.push({ id: `stroke-${index}`, type: "ink", docPath: "doc.pdf", page: 1, rects: [], points: [{ x: index / 10, y: .5 }] });
  direct.saveAnnotationsDebounced("doc.pdf", annotations);
  direct.noteInputActivity(-1);
}
await new Promise(resolve => setTimeout(resolve, 2000));
assert.equal(JSON.parse(directFiles.get("doc.pdf.mstudy.json")).annotations.length, 6);
const reopenedInk = new Store(directHost);
await reopenedInk.load();
assert.equal((await reopenedInk.loadAnnotations("doc.pdf")).length, 6);
console.log("PASS six synthetic strokes persist and reopen after two seconds");
