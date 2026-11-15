import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "marginstudy-dup-"));
const built = await build({ stdin: { contents: 'export * from "./duplicateIds";', resolveDir: here }, bundle: true, platform: "node", format: "cjs", write: false });
const bundle = join(temporary, "dup.cjs");
await writeFile(bundle, built.outputFiles[0].contents);
const { repairDuplicateIds } = createRequire(import.meta.url)(bundle);

const results = [];
async function test(name, run) {
  try { results.push({ name, passed: true, detail: await run() }); }
  catch (error) { results.push({ name, passed: false, error: String(error.stack || error) }); }
}

await test("identical duplicate cards collapse to one without touching other collections", () => {
  const card = { id: "c1", docPath: "a.pdf", front: "same", tags: [], links: [], createdAt: "2026-01-01T00:00:00Z" };
  const data = { cards: [card, structuredClone(card)], nodes: [{ id: "n1", parentId: null, title: "n", x: 0, y: 0 }], settings: { scale: 1 } };
  const snapshot = structuredClone(data);
  const { data: out, repaired } = repairDuplicateIds(data);
  assert.equal(out.cards.length, 1);
  assert.deepEqual(repaired, [{ collection: "cards", id: "c1", strategy: "dedupe-identical", dropped: 1 }]);
  assert.equal(out.nodes.length, 1);
  assert.deepEqual(out.settings, { scale: 1 });
  assert.deepEqual(data, snapshot, "input payload was mutated");
  return repaired[0];
});

await test("conflicting duplicate cards keep the newest version and report the drop", () => {
  const old = { id: "c2", docPath: "a.pdf", front: "old", tags: [], links: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  const fresh = { id: "c2", docPath: "a.pdf", front: "new", tags: [], links: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" };
  const { data: out, repaired } = repairDuplicateIds({ cards: [old, fresh] });
  assert.equal(out.cards.length, 1);
  assert.equal(out.cards[0].front, "new");
  assert.deepEqual(repaired, [{ collection: "cards", id: "c2", strategy: "kept-latest", dropped: 1 }]);
  return out.cards[0].front;
});

await test("item without an id is preserved and duplicates in several collections are all repaired", () => {
  const { data: out, repaired } = repairDuplicateIds({
    cards: [{ id: "d", front: "x", docPath: "", tags: [], links: [] }, { id: "d", front: "y", docPath: "", tags: [], links: [] }],
    nodes: [{ id: "n", title: "a", x: 0, y: 0 }, { id: "n", title: "b", x: 1, y: 1 }],
    reviewDecks: [{ id: "k", name: "one", cardIds: [] }, { id: "k", name: "two", cardIds: [] }],
  });
  assert.equal(out.cards.length, 1);
  assert.equal(out.nodes.length, 1);
  assert.equal(out.reviewDecks.length, 1);
  assert.equal(repaired.length, 3);
  assert.deepEqual(repaired.map(entry => entry.collection).sort(), ["cards", "nodes", "reviewDecks"]);
  return repaired.length;
});

await test("payload without duplicates is returned unchanged", () => {
  const data = { cards: [{ id: "one", front: "a", docPath: "", tags: [], links: [] }], nodes: [], settings: { scale: 1.2 } };
  const { data: out, repaired } = repairDuplicateIds(data);
  assert.deepEqual(out, data);
  assert.equal(repaired.length, 0);
  return "clean";
});

await test("repaired ids are unique so the store validator accepts the payload", () => {
  const { data: out } = repairDuplicateIds({ cards: [{ id: "z", front: "1", docPath: "", tags: [], links: [] }, { id: "z", front: "2", docPath: "", tags: [], links: [] }], nodes: [{ id: "n", title: "t", x: 0, y: 0 }, { id: "n", title: "u", x: 2, y: 2 }] });
  for (const key of ["cards", "nodes"]) {
    const ids = out[key].map(item => item.id);
    assert.equal(new Set(ids).size, ids.length, key + " still holds duplicate ids");
  }
  return "unique";
});

const failed = results.filter(result => !result.passed);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed }, null, 2));
if (failed.length) process.exitCode = 1;
else console.log(`${results.length}/${results.length} duplicate-identity repair groups passed`);
