import { build } from "esbuild";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const temp = await mkdtemp(join(tmpdir(), "marginstudy-layout-"));
const stub = join(temp, "obsidian.mjs");
await writeFile(stub, "export class Notice {} export class Menu {} export class ItemView {} export class Plugin {} export class Modal {} export class PluginSettingTab {} export class Setting {} export class TFile {} export class TFolder {} export class Component {} export const MarkdownRenderer = {}; export const Platform = {}; export function sanitizeHTMLToDom() {} export function setIcon() {} export function normalizePath(x){return x} export function addIcon() {}");
await build({ stdin: { contents: 'export { MindmapRenderer } from "./src/mindmap/mindmapRenderer"; export { Store } from "./src/model/store";', resolveDir: resolve("."), loader: "ts" }, outfile: join(temp, "renderer.mjs"), bundle: true, platform: "browser", format: "esm", plugins: [{ name: "host", setup(builder) { builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: stub })); if (process.env.LAYOUT_BASELINE) builder.onLoad({ filter: /mindmapRenderer\.ts$/ }, async args => ({ contents: await readFile(process.env.LAYOUT_BASELINE, "utf8"), loader: "ts", resolveDir: resolve(args.path, "..") })); } }] });
const { MindmapRenderer, Store } = await import(pathToFileURL(join(temp, "renderer.mjs")));
const make = (id, parentId, width = 230, height = 76, collapsed = false) => ({ id, parentId, title: id, width, height, collapsed, x: 1000 + id.length * 300, y: 1000 });
const shapes = {
  two_roots: [make("a", null), make("a1", "a"), make("a2", "a"), make("b", null), make("b1", "b"), make("b2", "b")],
  tall: [make("root", null), make("tall", "root", 230, 183), make("short", "root"), make("grand", "tall", 230, 94)],
  collapsed: [make("root", null), make("fold", "root", 230, 76, true), make("hidden", "fold", 230, 94), make("hidden2", "fold"), make("sibling", "root")],
  deep_roots: [make("a", null), make("a1", "a"), make("a2", "a1"), make("a3", "a2"), make("b", null), make("b1", "b"), make("b2", "b1"), make("b3", "b2"), make("c", null), make("c1", "c"), make("c2", "c1"), make("c3", "c2")],
};
function overlap(nodes) {
  let pairs = 0, area = 0;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j], intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    if (intersection) { pairs++; area += intersection; }
  }
  return { pairs, area };
}
let failed = false;
for (const [name, fixture] of Object.entries(shapes)) for (const direction of ["right", "down"]) {
  let disk = { nodes: structuredClone(fixture) };
  const files = new Map();
  const store = new Store({ loadData: async () => structuredClone(disk), saveData: async value => { disk = structuredClone(value); }, app: { vault: { adapter: { exists: async name => files.has(name), mkdir: async name => files.set(name, ""), write: async (name, value) => files.set(name, value), read: async name => files.get(name) } } } });
  await store.load();
  store.settings.layout = direction;
  const nodes = () => store.nodes;
  const visible = () => nodes().filter(node => { let parent = nodes().find(candidate => candidate.id === node.parentId); while (parent) { if (parent.collapsed) return false; parent = nodes().find(candidate => candidate.id === parent.parentId); } return true; });
  const element = node => ({ offsetWidth: node.width, offsetHeight: node.height, style: {}, remove() {} });
  const renderer = Object.create(MindmapRenderer.prototype);
  renderer.plugin = { store };
  renderer.options = {};
  renderer.world = { append() {} };
  renderer.nodeEls = new Map(visible().map(node => [node.id, element(node)]));
  renderer.visibleNodes = visible;
  renderer.scopedNodes = nodes;
  renderer.isGroupedMember = () => false;
  renderer.isRecallHierarchyActive = () => false;
  renderer.makeNodeDiv = element;
  const before = JSON.stringify(nodes().map(({ x, y }) => ({ x, y })));
  renderer.autoLayout();
  const result = overlap(nodes()), first = JSON.stringify(nodes().map(({ x, y }) => ({ x, y })));
  const roots = nodes().filter(node => node.parentId === null);
  const separatedRoots = new Set(roots.map(node => node.y)).size === roots.length;
  const orientation = nodes().every(node => { const parent = nodes().find(candidate => candidate.id === node.parentId); return !parent || (direction === "down" ? node.x > parent.x : node.y > parent.y); });
  const hiddenMoved = name !== "collapsed" || nodes().find(node => node.id === "hidden").y !== fixture.find(node => node.id === "hidden").y;
  const undo = store.undoLibraryChange() && before === JSON.stringify(nodes().map(({ x, y }) => ({ x, y })));
  renderer.autoLayout();
  const deterministic = first === JSON.stringify(nodes().map(({ x, y }) => ({ x, y })));
  await store.flush();
  const pass = !result.pairs && deterministic && undo && separatedRoots && orientation && hiddenMoved;
  console.log(JSON.stringify({ name, direction, ...result, deterministic, undo, separatedRoots, orientation, hiddenMoved, pass }));
  if (!pass) failed = true;
}
if (failed) process.exitCode = 1;
