import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtemp, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "marginstudy-occlusion-"));
try {
  const built = await build({
    stdin: {contents: 'export {Store} from "../model/store";', resolveDir: here},
    bundle: true, platform: "node", format: "cjs", write: false,
    plugins: [{name: "synthetic-host", setup(builder) {
      builder.onResolve({filter: /^obsidian$/}, () => ({path: "obsidian", namespace: "memory"}));
      builder.onLoad({filter: /.*/, namespace: "memory"}, () => ({contents: "export class App {} export class TFile {} export class Notice {} export class Component {} export const MarkdownRenderer={render:async()=>{}};"}));
    }}],
  });
  const bundle = join(temporary, "store.cjs");
  await writeFile(bundle, built.outputFiles[0].contents);
  const {Store} = createRequire(import.meta.url)(bundle);
  const stamp = "2026-10-29T00:00:00Z";
  let disk = {
    cards: [false, true, undefined].map((occluded, index) => ({id: `card-${index}`, type: "excerpt", docPath: "synthetic.pdf", front: `Excerpt ${index}`, tags: [], links: [], createdAt: stamp, occluded})),
    nodes: [false, true, undefined].map((occluded, index) => ({id: `node-${index}`, cardId: `card-${index}`, canvasId: "canvas", parentId: null, title: `Excerpt ${index}`, collapsed: false, x: 0, y: 0, occluded})),
    edges: [], srs: {}, studySets: [{id: "study", name: "Study", docPaths: ["synthetic.pdf"], createdAt: stamp}],
    canvases: [{id: "canvas", studySetId: "study", name: "Main", createdAt: stamp}], activeStudySetId: "study", activeCanvasId: "canvas",
  };
  const files = new Map(), directories = new Set();
  const adapter = {exists: async path => files.has(path) || directories.has(path), mkdir: async path => directories.add(path),
    write: async (path, value) => files.set(path, value), read: async path => {if (!files.has(path)) throw new Error(`Missing ${path}`); return files.get(path);}, remove: async path => files.delete(path)};
  const host = {app: {vault: {adapter, getFiles: () => []}}, loadData: async () => structuredClone(disk), saveData: async value => {disk = structuredClone(value);}};
  const store = new Store(host);
  await store.load();
  const snapshot = current => ({cards: current.cards.map(card => [card.id, card.occluded]), nodes: current.nodes.map(node => [node.id, node.occluded])});
  const initial = snapshot(store);
  const custom = store.copySceneTemplate("standard");
  for (const [template, scenes] of [[custom.id, ["excerpt", "handwriting", "organize", "recall"]], ["read-write-recall", ["reading", "writing", "recall"]], ["standard", ["excerpt", "handwriting", "organize", "recall"]]]) {
    for (const scene of scenes) {
      store.selectStudyScene("study", template, scene);
      assert.deepEqual(snapshot(store), initial, `${template}/${scene} changed an existing occluded value`);
    }
  }
  for (const [id, expected] of [["node-0", false], ["node-1", true]]) {
    for (const mode of ["reference", "clone"]) {
      const [pasted] = store.pasteSubtree(store.copySubtree([id]), {canvasId: "canvas", mode});
      assert.equal(store.getNode(pasted).occluded, expected, `${mode} paste lost ${expected}`);
    }
  }
  const beforeSave = snapshot(store);
  await store.flush();
  const reopened = new Store(host);
  await reopened.load();
  assert.deepEqual(snapshot(reopened), beforeSave, "save/reopen changed occluded values");
  console.log("PASS scene/template switching preserves each false, true and undefined value; reference/clone paste and save/reopen preserve values");
} finally {
  await rm(temporary, {recursive: true, force: true});
}
