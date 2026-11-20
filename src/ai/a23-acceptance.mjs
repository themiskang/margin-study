import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const output = await build({ stdin: { contents: 'export * from "./a23.ts"; export { DesktopChatTransport } from "./transport.ts"; export { Store } from "../model/store.ts";', resolveDir: here }, platform: "node", format: "cjs", bundle: true, write: false, plugins: [{ name: "obsidian", setup(builder) {
  builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "mock" }));
  builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export class Notice {} export class TFile {} export class Component {} export class App {} export const MarkdownRenderer = {};", loader: "js" }));
} }] });
const dir = await mkdtemp(join(tmpdir(), "a23-test-")), path = join(dir, "test.cjs");
await writeFile(path, output.outputFiles[0].contents);
const api = createRequire(import.meta.url)(path);
const disk = { cards: [], nodes: [], edges: [], srs: {}, reviewPending: [], reviewLogs: [], studySets: [{ id: "s", name: "S", docPaths: [], cardIds: [], createdAt: "2020" }], canvases: [{ id: "m", name: "M", studySetId: "s", createdAt: "2020" }], activeStudySetId: "s", activeCanvasId: "m" };
const adapter = { exists: async () => false };
const app = { vault: { adapter, getFiles: () => [], getAbstractFileByPath: () => null }, loadLocalStorage: () => null, saveLocalStorage: () => {} };
const host = { app, loadData: async () => structuredClone(disk), saveData: async () => {} };
host.store = new api.Store(host); await host.store.load();
const sample = "# 根\n## 子一\n### 孙\n## 子二";
const snapshot = () => structuredClone({ cards: host.store.cards, nodes: host.store.nodes });
const checks = {
  transport() {
    let calls = 0;
    const original = api.DesktopChatTransport.prototype.stream;
    api.DesktopChatTransport.prototype.stream = function () { calls++; throw new Error("transport called"); };
    try {
      const ids = api.saveAnswerBranch(host, sample);
      api.writeAnswerSelection(host, ids[0], "选段", "comment");
      api.writeAnswerSelection(host, ids[0], "选段", "title");
      assert.equal(calls, 0);
    } finally { api.DesktopChatTransport.prototype.stream = original; }
  },
  hierarchy() {
    const ids = api.saveAnswerBranch(host, sample), nodes = ids.map(id => host.store.getNode(id));
    assert.deepEqual(nodes.map(node => node.title), ["根", "子一", "孙", "子二"]);
    assert.deepEqual(nodes.map(node => node.parentId), [null, ids[0], ids[1], ids[0]]);
  },
  undo() {
    host.store.addCard({ id: "existing-card", docPath: "", type: "comment", title: "原卡片标题", front: "正文", back: "原评论", colorIndex: 0, tags: [], links: [], createdAt: "2020" });
    host.store.addNode({ id: "existing-node", cardId: "existing-card", canvasId: "m", parentId: null, title: "原节点标题", comments: ["原节点评论"], collapsed: false, x: 1, y: 2 });
    const before = snapshot();
    api.saveAnswerBranch(host, sample);
    assert.equal(host.store.undoLibraryChange(), true);
    assert.deepEqual(snapshot(), before);
    const ids = api.saveAnswerBranch(host, sample);
    for (const kind of ["comment", "title"]) {
      const original = snapshot();
      api.writeAnswerSelection(host, ids[1], "选中文字", kind);
      assert.equal(kind === "comment" ? host.store.getNode(ids[1]).comments.at(-1) : host.store.getNode(ids[1]).title, "选中文字");
      assert.equal(host.store.undoLibraryChange(), true);
      assert.deepEqual(snapshot(), original);
    }
  },
  failure() {
    const before = snapshot();
    assert.throws(() => api.saveAnswerBranch(host, "# 根\n### 跳级"));
    assert.deepEqual(snapshot(), before);
    const addNode = host.store.addNode.bind(host.store);
    host.store.addNode = () => { throw new Error("synthetic failure"); };
    assert.throws(() => api.saveAnswerBranch(host, sample));
    host.store.addNode = addNode;
    assert.deepEqual(snapshot(), before);
  }
};
for (const name of process.argv[2] ? [process.argv[2]] : Object.keys(checks)) {
  checks[name]();
  console.log(`PASS ${name}`);
}
