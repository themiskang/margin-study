import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporary = await mkdtemp(join(tmpdir(), "marginstudy-a26-"));
const optional = (path, exports) => existsSync(join(root, path)) ? `export { ${exports} } from ${JSON.stringify(join(root, path))};` : "";
const contents = [
  `export { Store } from ${JSON.stringify(join(root, "src/model/store.ts"))};`,
  `export { mergePreservingVersions } from ${JSON.stringify(join(root, "src/model/conflicts.ts"))};`,
  optional("src/vocabulary/dictionary.ts", "lookupVocabulary, vocabularySize"),
  optional("src/cards/vocabulary.ts", "saveVocabularySense"),
  optional("src/vocabulary/license.ts", "vocabularyLicense"),
].join("\n");
const built = await build({ stdin: { contents, resolveDir: root }, bundle: true, platform: "node", format: "cjs", write: false,
  plugins: [{ name: "synthetic-obsidian", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "synthetic" }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: "export class App {} export class TFile {} export class Notice {} export class Component {} export const MarkdownRenderer={render:async()=>{}};" }));
  } }] });
const bundle = join(temporary, "fixture.cjs");
await writeFile(bundle, built.outputFiles[0].contents);
const product = createRequire(import.meta.url)(bundle);
const results = [];
async function check(name, run) {
  try { const detail = await run(); results.push({ name, passed: true, detail }); }
  catch (error) { results.push({ name, passed: false, error: String(error) }); }
}
async function fresh() {
  let disk = {};
  const files = new Map();
  const adapter = { exists: async path => files.has(path), mkdir: async path => files.set(path, ""),
    write: async (path, value) => files.set(path, value), read: async path => files.get(path) };
  const host = { app: { vault: { adapter, getFiles: () => [] } }, loadData: async () => structuredClone(disk),
    saveData: async value => { disk = structuredClone(value); } };
  const store = new product.Store(host);
  await store.load();
  store.createStudySet("Synthetic vocabulary", []);
  return { store, host };
}

await check("offline lemma, phonetic and senses; no fetch/http/https", async () => {
  assert.equal(typeof product.lookupVocabulary, "function", "offline lookup is absent");
  const original = { fetch: globalThis.fetch, httpRequest: http.request, httpGet: http.get, httpsRequest: https.request, httpsGet: https.get };
  let network = 0;
  const blocked = () => { network++; throw new Error("network forbidden"); };
  globalThis.fetch = blocked; http.request = blocked; http.get = blocked; https.request = blocked; https.get = blocked;
  try {
    const expected = { running: "run", studies: "study", went: "go", books: "book", climate: "climate", evidence: "evidence" };
    const found = {};
    for (const [word, lemma] of Object.entries(expected)) {
      const result = product.lookupVocabulary(word);
      assert.ok(result, `${word} missing`);
      assert.equal(result.lemma, lemma, `${word} lemma`);
      assert.ok(result.phonetic?.trim(), `${word} phonetic`);
      assert.ok(result.senses?.length && result.senses.every(sense => typeof sense === "string" && sense.trim()), `${word} senses`);
      found[word] = result.lemma;
    }
    assert.equal(product.lookupVocabulary("  RUNNING  ")?.lemma, "run");
    assert.equal(product.lookupVocabulary("running")?.phonetic, "rʌn");
    assert.ok(product.lookupVocabulary("running")?.senses.includes("跑"));
    assert.ok(product.lookupVocabulary("went")?.senses.includes("去"));
    assert.equal(product.lookupVocabulary("notawordzzzz"), undefined);
    assert.ok(product.vocabularySize >= 200, `vocabulary too small: ${product.vocabularySize}`);
    assert.equal(network, 0);
    return { found, vocabularySize: product.vocabularySize, network };
  } finally {
    globalThis.fetch = original.fetch; http.request = original.httpRequest; http.get = original.httpGet;
    https.request = original.httpsRequest; https.get = original.httpsGet;
  }
});

await check("one selected sense creates one card; repeated choice stays one", async () => {
  assert.equal(typeof product.lookupVocabulary, "function", "offline lookup is absent");
  assert.equal(typeof product.saveVocabularySense, "function", "sense-to-card action is absent");
  const { store, host } = await fresh();
  const entry = product.lookupVocabulary("running"), before = store.cards.length;
  const first = product.saveVocabularySense(store, entry, entry.senses[0], { docPath: "synthetic.pdf", example: "She is running." });
  assert.equal(store.cards.length, before + 1);
  assert.ok(store.cardsForStudySet().some(card => card.id === first.id));
  assert.ok(first.front.includes("running") && first.back.includes("run") && first.back.includes(entry.phonetic) && first.back.includes(entry.senses[0]) && first.back.includes("She is running."));
  const again = product.saveVocabularySense(store, entry, entry.senses[0], { docPath: "synthetic.pdf", example: "Do not overwrite." });
  assert.equal(again.id, first.id);
  assert.equal(store.cards.length, before + 1);
  assert.ok(!store.getCard(first.id).back.includes("Do not overwrite."));
  await store.flush();
  const reopened = new product.Store(host); await reopened.load();
  const reselected = product.saveVocabularySense(reopened, product.lookupVocabulary("run"), entry.senses[0], {});
  assert.equal(reselected.id, first.id);
  assert.equal(reopened.cards.length, before + 1);
  assert.throws(() => product.saveVocabularySense(reopened, entry, "not a listed sense", {}));
  const differentSense = product.saveVocabularySense(reopened, entry, entry.senses[1], {});
  assert.notEqual(differentSense.id, first.id);
  assert.equal(reopened.cards.length, before + 2);
  reopened.createStudySet("Other set", []);
  const otherSet = product.saveVocabularySense(reopened, entry, entry.senses[0], {});
  assert.notEqual(otherSet.id, first.id);
  assert.equal(reopened.cards.length, before + 3);
  const conflict = await fresh();
  conflict.store.installBuiltinSceneTemplate("practice-cards");
  const copied = conflict.store.copySceneTemplate("practice-cards");
  const original = product.saveVocabularySense(conflict.store, entry, entry.senses[0], {});
  conflict.store.updateCard(original.id, { templateId: copied.id });
  await conflict.store.flush();
  const local = await conflict.host.loadData(), remote = structuredClone(local);
  local.studySets[0].name = "Local set"; remote.studySets[0].name = "Remote set";
  local.sceneTemplates.find(item => item.id === copied.id).name = "Local template";
  remote.sceneTemplates.find(item => item.id === copied.id).name = "Remote template";
  const merged = product.mergePreservingVersions(local, remote);
  const remoteSet = merged.studySets.find(item => item.name === "Remote set（外部版本）");
  const remoteTemplate = merged.sceneTemplates.find(item => item.name === "Remote template（外部版本）");
  const remoteCard = merged.cards.find(item => item.id !== original.id && item.vocabulary?.studySetId === remoteSet?.id);
  assert.ok(remoteSet && remoteTemplate && remoteCard, "conflict lost remote vocabulary identity");
  assert.equal(remoteCard.templateId, remoteTemplate.id, "conflict did not remap scene-based card template");
  const mergedHost = { ...conflict.host, loadData: async () => structuredClone(merged) };
  const recovered = new product.Store(mergedHost); await recovered.load(); recovered.setActiveStudySet(remoteSet.id);
  const mergedCount = recovered.cards.length;
  assert.equal(product.saveVocabularySense(recovered, entry, entry.senses[0], {}).id, remoteCard.id);
  assert.equal(recovered.cards.length, mergedCount, "conflict recovery duplicated the same sense");
  return { before, after: store.cards.length, repeat: before + 1, otherSenseAndSet: reopened.cards.length, cardId: first.id };
});

await check("A05 installation is idempotent for both field templates", async () => {
  const { store, host } = await fresh();
  assert.equal(typeof store.installBuiltinSceneTemplate, "function", "A05 built-in installation action is absent");
  assert.equal(typeof store.getCardTemplates, "function", "installed fields are not exposed to card editor");
  const expected = { "practice-cards": ["问题", "答案", "解析", "错因"], "foreign-vocabulary": ["词", "原形", "音标", "释义", "例句"] };
  const installed = {};
  for (const [id, fields] of Object.entries(expected)) {
    const ids = Array.from({ length: 3 }, () => store.installBuiltinSceneTemplate(id).id);
    assert.deepEqual(ids, [id, id, id]);
    assert.equal(store.getSceneTemplates().filter(item => item.id === id).length, 1);
    const template = store.getCardTemplates().find(item => item.id === id);
    assert.ok(template, `${id} unavailable in card editor`);
    assert.deepEqual(template.fields, fields);
    for (const field of fields) assert.ok((template.front + template.back).includes(field), `${id} missing ${field}`);
    installed[id] = ids;
  }
  await store.flush();
  const reopened = new product.Store(host); await reopened.load();
  for (const id of Object.keys(expected)) {
    assert.equal(reopened.installBuiltinSceneTemplate(id).id, id);
    assert.equal(reopened.getSceneTemplates().filter(item => item.id === id).length, 1);
    assert.deepEqual(reopened.getCardTemplates().find(item => item.id === id).fields, expected[id]);
  }
  assert.throws(() => reopened.installBuiltinSceneTemplate("missing"));
  const collision = await fresh();
  collision.store.upsertCardTemplate({ id: "foreign-vocabulary", name: "Existing", front: "Keep this" });
  assert.throws(() => collision.store.installBuiltinSceneTemplate("foreign-vocabulary"), /占用/);
  assert.equal(collision.store.cardTemplates[0].front, "Keep this");
  return installed;
});

await check("MIT license exists and is embedded in the distributable bundle", async () => {
  const license = await readFile(join(root, "LICENSE-ECDICT.txt"), "utf8");
  assert.match(license, /MIT/i);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.equal(product.vocabularyLicense, license, "displayed license differs from packaged file");
  const bundleText = await readFile(join(root, "main.js"), "utf8");
  assert.ok(bundleText.includes("Permission is hereby granted, free of charge"), "license absent from built main.js");
  return { sourceBytes: Buffer.byteLength(license), bundled: true };
});

const report = { environment: "synthetic in-memory Store; offline network hooks", results };
await writeFile(join(temporary, "results.json"), JSON.stringify(report, null, 2) + "\n");
for (const result of results) console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}: ${JSON.stringify(result.detail ?? result.error)}`);
console.log(`${results.filter(result => result.passed).length}/${results.length} A26 checks passed`);
console.log(`Results: ${join(temporary, "results.json")}`);
if (results.some(result => !result.passed)) process.exitCode = 1;
