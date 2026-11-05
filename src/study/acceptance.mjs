// Run: node src/study/acceptance.mjs. Synthetic vault only; no user data is read.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), "marginstudy-study-"));
const stores = [];
const results = [];
const test = async (name, run) => {
  try {
    await run();
    results.push({ name, passed: true });
    process.stdout.write(`✓ ${name}\n`);
  } catch (error) {
    results.push({ name, passed: false });
    process.stdout.write(`✗ ${name}\n  ${String(error.message).replace(/\n/g, "\n  ")}\n`);
    process.exitCode = 1;
  }
};

try {
  const result = await build({
    stdin: {
      contents: 'export * from "./model/store.ts"; export * from "./study/nodeContent.ts";',
      resolveDir: root,
    },
    platform: "node", format: "cjs", bundle: true, write: false,
    plugins: [{ name: "synthetic-obsidian", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "synthetic" }));
      builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({
        contents: "export class Component {} export class App {} export class TFile {} export class Notice {} export const MarkdownRenderer = { render: async () => {} };",
        loader: "js",
      }));
    } }],
  });
  const bundle = path.join(temporary, "study.cjs");
  await writeFile(bundle, result.outputFiles[0].contents);
  const { Store, nodeContent } = createRequire(import.meta.url)(bundle);
  const fresh = async () => {
    let disk = { cards: [], nodes: [], edges: [], srs: {} };
    const files = new Map();
    const host = {
      loadData: async () => structuredClone(disk),
      saveData: async (data) => { disk = structuredClone(data); },
      app: { vault: {
        getAbstractFileByPath: () => null,
        getFiles: () => [],
        adapter: {
          exists: async (name) => files.has(name),
          mkdir: async (name) => files.set(name, ""),
          write: async (name, data) => files.set(name, data),
          read: async (name) => files.get(name),
        },
      } },
    };
    const store = new Store(host);
    await store.load();
    stores.push(store);
    return { store, host };
  };
  const card = (id, docPath, front, image) => ({
    id, docPath, type: "excerpt", front, image, tags: [id], links: [], createdAt: "2026-10-15T00:00:00.000Z",
  });
  const node = (id, parentId, cardId, order = 0) => ({
    id, parentId, cardId, order, title: `snapshot-${id}`, docPath: cardId === "b" ? "b.pdf" : "a.pdf", collapsed: false, x: 1, y: 2,
  });

  await test("subtree copy keeps descendant links and handles children stored before parents", async () => {
    const { store: s } = await fresh();
    s.addCard(card("a", "a.pdf", "A", "image-a")); s.addCard(card("b", "b.pdf", "B", "image-b"));
    s.addNodes([node("grandchild", "child", "b"), node("child", "root", "a"), node("root", null)]);
    s.addEdge("grandchild", "root", "cross");
    const fragment = s.copySubtree(["root"]);
    assert.equal(fragment.nodes.length, 3); assert.equal(fragment.edges.length, 1);
    const set = s.createStudySet("Set", ["a.pdf", "b.pdf"]);
    const canvas = s.createCanvas(set.id, "Independent"); s.setActiveCanvas(canvas.id);
    const ids = s.pasteSubtree(fragment, { canvasId: canvas.id, mode: "clone" });
    const copies = ids.map((id) => s.getNode(id));
    const root = copies.find((n) => n.title === "snapshot-root");
    const child = copies.find((n) => n.title === "snapshot-child");
    const grandchild = copies.find((n) => n.title === "snapshot-grandchild");
    assert.equal(child.parentId, root.id); assert.equal(grandchild.parentId, child.id);
    assert.ok(s.edges.some((edge) => edge.from === grandchild.id && edge.to === root.id));
    assert.notEqual(child.cardId, "a");
    s.updateCard(child.cardId, { front: "clone-only" });
    assert.equal(s.getCard("a").front, "A"); assert.equal(nodeContent(s, child).title, "clone-only");
  });

  await test("reference content is shared and paste undo/redo restores one complete operation", async () => {
    const { store: s } = await fresh(); s.addCard(card("a", "a.pdf", "A")); s.addNode(node("root", null, "a"));
    const fragment = s.copySubtree(["root"]);
    const set = s.createStudySet("Set", ["a.pdf"]); const canvas = s.createCanvas(set.id, "References"); s.setActiveCanvas(canvas.id);
    const before = s.nodes.length;
    const ids = s.pasteSubtree(fragment, { canvasId: canvas.id, mode: "reference" });
    assert.equal(s.getNode(ids[0]).cardId, "a");
    assert.equal(s.undoLibraryChange(), true); assert.equal(s.nodes.length, before); assert.ok(!s.getNode(ids[0]));
    assert.equal(s.redoLibraryChange(), true);
    s.updateCard("a", { front: "shared change" });
    assert.equal(nodeContent(s, s.getNode(ids[0])).title, "shared change");
  });

  await test("multi-document study sets exclude unrelated cards", async () => {
    const { store: s } = await fresh();
    for (const id of ["a", "b", "c"]) s.addCard(card(id, `${id}.pdf`, id));
    s.createStudySet("A+B", ["a.pdf", "b.pdf"]);
    assert.deepEqual(s.getScopedCards().map((c) => c.id).sort(), ["a", "b"]);
  });

  await test("a pasted reference belongs to the destination card and review scope", async () => {
    const { store: s } = await fresh(); s.addCard(card("a", "a.pdf", "A")); s.addNode(node("root", null, "a"));
    const fragment = s.copySubtree(["root"]); s.createStudySet("Empty", []);
    const ids = s.pasteSubtree(fragment, { canvasId: s.activeCanvasId, mode: "reference" });
    assert.ok(s.getScopedNodes().some((n) => n.id === ids[0])); assert.ok(s.getScopedCards().some((c) => c.id === "a"));
  });

  await test("merge keeps images, original sources and backlinks; undo restores originals", async () => {
    const { store: s } = await fresh();
    s.addCard(card("a", "a.pdf", "Original A", "image-a")); s.addCard(card("b", "b.pdf", "Original B", "image-b"));
    s.addCard({ ...card("c", "c.pdf", "C"), links: ["b"] });
    s.mergeCards("a", ["b"]); const merged = s.getCard("a");
    assert.equal(merged.image, "image-a");
    assert.deepEqual(merged.images, ["image-b"]);
    assert.ok(merged.front.includes("Original A") && merged.front.includes("Original B"));
    assert.deepEqual(s.getCard("c").links, ["a"]);
    assert.ok(merged.sources.some((source) => source.docPath === "a.pdf" && source.text === "Original A"));
    assert.equal(s.undoLibraryChange(), true);
    assert.equal(s.getCard("a").front, "Original A"); assert.ok(s.getCard("b")); assert.deepEqual(s.getCard("c").links, ["b"]);
  });

  await test("mixed card/plain-node merge preserves plain text and its image", async () => {
    const { store: s } = await fresh(); s.addCard(card("a", "a.pdf", "A", "image-a"));
    s.addNodes([node("root", null, "a"), { ...node("plain", null, undefined, 1), title: "Unique plain text", image: "image-plain" }]);
    const id = s.mergeNodes(["root", "plain"]); const content = nodeContent(s, s.getNode(id));
    assert.ok(content.title.includes("Unique plain text")); assert.ok(content.images.includes("image-plain"));
  });

  await test("unmerging a clone never overwrites the original merged-card schedule", async () => {
    const { store: s } = await fresh(); s.addCard(card("a", "a.pdf", "A")); s.addCard(card("b", "b.pdf", "B"));
    s.mergeCards("a", ["b"]); s.srs.a = { ...s.srs.a, reps: 42 };
    const independent = s.cloneCard("a"); s.unmergeCard(independent.id);
    assert.equal(s.srs.a.reps, 42);
  });

  await test("reference paste after source deletion recovers the full clipboard snapshot", async () => {
    const { store: s } = await fresh();
    s.addCard({ ...card("a", "a.pdf", "Complete canonical front"), back: "Complete answer", images: ["one", "two"] });
    s.addNode(node("n", null, "a")); const fragment = s.copySubtree(["n"]); s.removeCard("a");
    const ids = s.pasteSubtree(fragment, { mode: "reference" }); const restored = s.getCard(s.getNode(ids[0]).cardId);
    assert.equal(restored.front, "Complete canonical front"); assert.equal(restored.back, "Complete answer"); assert.deepEqual(restored.images, ["one", "two"]);
  });

  await test("merged connections retain every label when endpoints coincide", async () => {
    const { store: s } = await fresh(); s.addNodes([node("a", null), node("b", null), node("c", null)]);
    s.addEdge("a", "c", "label-one"); s.addEdge("b", "c", "label-two"); s.mergeNodes(["a", "b"]);
    const labels = s.edges.filter((edge) => edge.from === "a" && edge.to === "c").map((edge) => edge.label).join(" / ");
    assert.ok(labels.includes("label-one") && labels.includes("label-two"), labels);
  });

  await test("a cut plain-node fragment produces stable shared references across repeated pastes", async () => {
    const { store: s } = await fresh(); s.addNode(node("a", null)); const fragment = s.copySubtree(["a"]); s.removeNode("a");
    const one = s.pasteSubtree(fragment, { mode: "reference" })[0]; const two = s.pasteSubtree(fragment, { mode: "reference" })[0];
    assert.equal(s.getNode(one).cardId, s.getNode(two).cardId);
  });

  await test("cross-canvas parents are rejected before paste changes any data", async () => {
    const { store: s } = await fresh(); const set = s.createStudySet("Set"); const first = s.activeCanvasId;
    s.addNode({ ...node("parent", null), canvasId: first }); const second = s.createCanvas(set.id, "Other").id;
    const count = s.nodes.length;
    assert.throws(() => s.pasteSubtree({ nodes: [node("copy", null)], edges: [], cards: [] }, { canvasId: second, parentId: "parent", mode: "clone" }));
    assert.equal(s.nodes.length, count);
  });

  await test("reparent preserves requested sibling order and refuses subtree cycles atomically", async () => {
    const { store: s } = await fresh();
    s.addNodes([node("root", null), node("a", "root", undefined, 0), node("b", "root", undefined, 1), node("c", "root", undefined, 2)]);
    s.reparentNode("c", "root", 0);
    assert.deepEqual(s.nodes.filter((n) => n.parentId === "root").sort((a, b) => a.order - b.order).map((n) => n.id), ["c", "a", "b"]);
    const before = JSON.stringify(s.nodes);
    assert.throws(() => s.reparentNode("root", "a"));
    assert.equal(JSON.stringify(s.nodes), before);
  });

  await test("a persisted active study set without a selected canvas never leaks unfiled nodes", async () => {
    const { store: s, host } = await fresh(); s.addNode(node("unfiled", null));
    const set = s.createStudySet("Empty", []); const first = s.activeCanvasId;
    await s.flush();
    const load = host.loadData;
    host.loadData = async () => { const data = await load(); delete data.activeCanvasId; return data; };
    const reloaded = new Store(host); stores.push(reloaded); await reloaded.load();
    assert.equal(reloaded.activeStudySetId, set.id); assert.equal(reloaded.activeCanvasId, first);
    assert.deepEqual(reloaded.getScopedNodes(), []);
  });

  await test("study sets, canvas isolation and shared content survive save/reload", async () => {
    const { store: s, host } = await fresh(); s.addCard(card("a", "a.pdf", "A")); s.addNode(node("root", null, "a"));
    const set = s.createStudySet("Set", ["a.pdf"]); const first = s.activeCanvasId;
    const second = s.createCanvas(set.id, "Other"); s.setActiveCanvas(second.id);
    s.pasteSubtree(s.copySubtree(["root"]), { canvasId: second.id, mode: "reference" });
    s.updateCard("a", { front: "persisted shared content" }); await s.flush();
    const reloaded = new Store(host); stores.push(reloaded); await reloaded.load();
    assert.equal(reloaded.activeStudySetId, set.id); assert.equal(reloaded.activeCanvasId, second.id);
    assert.ok(reloaded.getScopedNodes().every((n) => n.canvasId === second.id));
    assert.equal(nodeContent(reloaded, reloaded.getScopedNodes()[0]).title, "persisted shared content");
    reloaded.setActiveCanvas(first); assert.ok(reloaded.getScopedNodes().every((n) => n.canvasId === first));
  });

  await test("nested reverse-order merge survives reload, unmerge and deletion recovery without losing hierarchy or links", async () => {
    const { store: s, host } = await fresh();const set=s.createStudySet("Complex");const canvasId=s.activeCanvasId;
    for (const id of ["a","b","c","d"]) s.addCard(card(id,"",id.toUpperCase()));
    s.addNodes([node("root",null,"a"),node("middle","root","b"),node("leaf","middle","c"),node("child","leaf","d")]);
    s.addEdge("root","child","outer");s.addEdge("middle","child","inner");
    const graph=(store=s)=>({nodes:store.nodes.map(n=>({id:n.id,parent:n.parentId,card:n.cardId})).sort((a,b)=>a.id.localeCompare(b.id)),edges:store.edges.map(e=>({...e})).sort((a,b)=>a.from.localeCompare(b.from))});const before=graph();
    s.mergeNodes(["leaf","root"]);assert.ok(s.getNode("child"));await s.flush();
    let reopenedDisk=await host.loadData();const reopenedHost={...host,loadData:async()=>structuredClone(reopenedDisk),saveData:async value=>{reopenedDisk=structuredClone(value);}};
    const reload=new Store(reopenedHost);stores.push(reload);await reload.load();assert.ok(reload.getCard(reload.getNode("leaf").cardId).mergedCards);
    reload.unmergeCard(reload.getNode("leaf").cardId);assert.deepEqual(graph(reload),before);await reload.flush();
    s.unmergeCard(s.getNode("leaf").cardId);assert.deepEqual(graph(),before);
    assert.equal(s.undoLibraryChange(),true);assert.ok(s.getCard(s.getNode("leaf").cardId).mergedCards);assert.equal(s.redoLibraryChange(),true);assert.deepEqual(graph(),before);
    s.removeNodes(["middle"]);assert.deepEqual(s.nodes.map(n=>n.id),["root"]);assert.equal(s.undoLibraryChange(),true);assert.deepEqual(graph(),before);
  });
  process.stdout.write(`\n${results.filter((result) => result.passed).length}/${results.length} study acceptance checks passed.\n`);
} finally {
  await Promise.all(stores.map((store) => store.flush()));
  await rm(temporary, { recursive: true, force: true });
}
