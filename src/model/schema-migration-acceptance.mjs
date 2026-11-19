/**
 * [INPUT]: 使用 Store、合成库和磁盘适配器。
 * [OUTPUT]: 输出主数据迁移、失败保全、备份恢复和冲突三方的证据。
 * [POS]: 经 Store 公开入口验证持久化协议。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "marginstudy-schema-"));
const output = resolve(process.env.MARGINSTUDY_SCHEMA_VERIFY_DIR ?? process.env.MARGINSTUDY_VERIFY_DIR ?? temporary);
const stamp = "2026-11-01T10:00:00.000Z";
const pluginDir = ".obsidian/plugins/margin-study";
const mainPath = `${pluginDir}/data.json`;
const sourcePath = "sample.md";
const sidecars = [`${sourcePath}.mstudy.json`, "unlinked.md.mstudy.json"];
const hash = content => createHash("sha256").update(content).digest("hex");
const built = await build({
  entryPoints: [join(here, "store.ts")], platform: "node", format: "cjs", bundle: true, write: false,
  plugins: [{ name: "synthetic-obsidian", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "synthetic" }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: "export class Notice{}; export class App{}; export class TFile{}; export class Component{}; export const MarkdownRenderer={render:async()=>{}};" }));
  } }],
});
const bundle = join(temporary, "store.cjs");
await writeFile(bundle, built.outputFiles[0].contents);
const { Store } = createRequire(import.meta.url)(bundle);

function seed(version) {
  return {
    schemaVersion: version, revision: 7,
    cards: [{ id: "card", type: "excerpt", docPath: sourcePath, anchorAnnId: "ann-1", front: "F05 preserved excerpt", tags: ["fixture"], links: [], createdAt: stamp }],
    nodes: [
      { id: "node", cardId: "card", canvasId: "canvas", title: "F05 node", x: 7, y: 11 },
      { id: "ref", cardId: "card", canvasId: "canvas", sourceNodeId: "node", reference: true, title: "F05 ref", x: 17, y: 21 },
    ],
    edges: [{ from: "node", to: "ref", label: "fixture reference" }],
    studySets: [{ id: "set", name: "F05 fixture", docPaths: [sourcePath], cardIds: ["card"], createdAt: stamp }],
    canvases: [{ id: "canvas", studySetId: "set", name: "F05 canvas", createdAt: stamp }],
    documents: [{ id: "doc", path: sourcePath, kind: "md", createdAt: stamp }],
    activeStudySetId: "set", activeCanvasId: "canvas",
    ...(version >= 2 ? {
      practiceAttempts: [{ id: "attempt", cardId: "card", studySetId: "set", at: stamp, answer: "F05 answer", verdict: "correct" }],
      localEvents: [{ id: "existing-event", at: stamp, kind: "saved", objectIds: ["card", "node"], detail: "F05 existing local event" }],
    } : {}),
  };
}

async function fixture(name, data) {
  const root = join(temporary, name);
  await mkdir(join(root, pluginDir), { recursive: true });
  const bytes = ` ${JSON.stringify(data, null, 2)}\n`;
  await writeFile(join(root, mainPath), bytes);
  await writeFile(join(root, sourcePath), "# F05 source\n\nF05 preserved excerpt\n");
  for (const [index, sidecar] of sidecars.entries()) {
    await writeFile(join(root, sidecar), ` ${JSON.stringify({ schemaVersion: 2, annotations: [{ id: `ann-${index + 1}`, type: "note", page: 1, text: "original", rects: [] }] })}\n`);
  }
  return root;
}

function host(root, stage) {
  const adapter = {
    getBasePath: () => root,
    exists: async path => access(join(root, path)).then(() => true, () => false),
    mkdir: path => mkdir(join(root, path)),
    list: async path => {
      const files = [], folders = [];
      for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
        (entry.isDirectory() ? folders : files).push(path ? `${path}/${entry.name}` : entry.name);
      }
      return { files, folders };
    },
    read: path => readFile(join(root, path), "utf8"),
    readBinary: async path => Uint8Array.from(await readFile(join(root, path))).buffer,
    write: (path, value) => {
      if (stage === "snapshot" && path.startsWith("MarginStudyBackups/") && path.endsWith("/manifest.json")) throw new Error("F05 snapshot injection");
      if (stage === "commit" && path.startsWith(`${mainPath}.`) && path.endsWith(".tmp")) throw new Error("F05 commit injection");
      return writeFile(join(root, path), value);
    },
    writeBinary: (path, value) => writeFile(join(root, path), Buffer.from(value)),
    stat: path => stat(join(root, path)).then(info => ({ type: info.isFile() ? "file" : "folder", mtime: info.mtimeMs, size: info.size })),
    rename: (source, target) => rename(join(root, source), join(root, target)),
    remove: path => rm(join(root, path)),
  };
  return {
    manifest: { dir: pluginDir },
    app: { vault: { adapter, getFiles: () => [{ path: sourcePath }] } },
    loadData: async () => JSON.parse(await adapter.read(mainPath)),
    saveData: () => assert.fail("desktop migration must use the vault adapter"),
  };
}

async function hashes(root) {
  return Object.fromEntries(await Promise.all([mainPath, ...sidecars].map(async path => [path, hash(await readFile(join(root, path)))])));
}

async function writeEvidence(name, data) {
  await mkdir(output, { recursive: true });
  await writeFile(join(output, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
}

const upgrades = [];
for (const version of [1, 2]) {
  const original = seed(version), root = await fixture(`v${version}`, original);
  const originalHashes = await hashes(root);
  const runtime = host(root);
  const store = new Store(runtime);
  await store.load();
  const reopened = new Store(runtime);
  await reopened.load();
  assert.deepEqual(await runtime.loadData(), { ...original, schemaVersion: 3 });
  assert.deepEqual(reopened.getCard("card"), original.cards[0]);
  assert.equal(reopened.getNode("node").cardId, "card");
  assert.equal((await reopened.loadAnnotations(sourcePath))[0].id, reopened.getCard("card").anchorAnnId);
  assert.deepEqual(reopened.practiceAttempts, original.practiceAttempts ?? []);
  for (const event of original.localEvents ?? []) assert.deepEqual(reopened.getLocalEvents().find(item => item.id === event.id), event);
  const after = await hashes(root);
  for (const path of sidecars) assert.equal(after[path], originalHashes[path]);
  upgrades.push({ version, original, reopened: await runtime.loadData(), originalHashes, after });
}
await writeEvidence("A1-upgrade", upgrades);

const failures = [];
for (const stage of ["snapshot", "commit"]) {
  const original = seed(2), root = await fixture(stage, original), before = await hashes(root);
  const brokenHost = host(root, stage);
  for (const attempt of [1, 2]) {
    const store = new Store(brokenHost);
    await assert.rejects(store.load(), new RegExp(`F05 ${stage} injection`));
    await assert.rejects(store.flush(), /写入已锁定/);
    assert.deepEqual(await hashes(root), before, `after failure ${stage}/${attempt}`);
    assert.deepEqual(await brokenHost.loadData(), original);
  }
  const afterFailure = await hashes(root);
  const retryHost = host(root);
  await new Store(retryHost).load();
  assert.deepEqual(await retryHost.loadData(), { ...original, schemaVersion: 3 });
  failures.push({ stage, before, afterFailure, retry: await hashes(root) });
}
await writeEvidence("A2-failure-preservation", failures);

const source = join(temporary, "v2");
const backupRoot = join(source, "MarginStudyBackups");
const backups = await readdir(backupRoot);
assert.equal(backups.length, 1);
const backup = join(backupRoot, backups[0]);
const manifest = JSON.parse(await readFile(join(backup, "manifest.json"), "utf8"));
const main = await readFile(join(backup, "data.json"));
assert.equal(hash(main), manifest.dataSha256);
assert.equal(hash(main), upgrades[1].originalHashes[mainPath]);
const backupReader = new Store(host(source));
await backupReader.load();
const stagedBackup = await backupReader.prepareBackupRecovery(`MarginStudyBackups/${backups[0]}/manifest.json`);
assert.ok(stagedBackup.scope.some(item => item.collection === "practiceAttempts" && item.id === "attempt"));
assert.ok(stagedBackup.scope.some(item => item.collection === "annotations" && item.docPath === "unlinked.md"));
const restoreRoot = join(temporary, "restored");
await mkdir(join(restoreRoot, pluginDir), { recursive: true });
await writeFile(join(restoreRoot, mainPath), main);
for (const file of manifest.files) {
  const bytes = await readFile(join(backup, file.storedPath));
  assert.equal(bytes.byteLength, file.bytes);
  assert.equal(hash(bytes), file.sha256);
  await mkdir(dirname(join(restoreRoot, file.path)), { recursive: true });
  await writeFile(join(restoreRoot, file.path), bytes);
}
assert.deepEqual(await hashes(restoreRoot), upgrades[1].originalHashes);
if (process.env.MARGINSTUDY_SCHEMA_HOST_FIXTURE) await cp(restoreRoot, process.env.MARGINSTUDY_SCHEMA_HOST_FIXTURE, { recursive: true, errorOnExist: true, force: false });
const restored = new Store(host(restoreRoot));
await restored.load();
assert.deepEqual(restored.practiceAttempts, seed(2).practiceAttempts);
assert.equal(restored.getNode("node").cardId, "card");
assert.equal((await restored.loadAnnotations(sourcePath))[0].id, restored.getCard("card").anchorAnnId);
const originalHost = host(source);
const current = new Store(originalHost);
await current.load();
const external = await originalHost.loadData();
external.cards[0].front = "remote";
await writeFile(join(source, mainPath), JSON.stringify(external));
current.updateCard("card", { front: "local" });
await assert.rejects(current.flush(), /外部修改/);
const conflict = JSON.parse(await originalHost.app.vault.adapter.read(current.conflictPath));
assert.equal(conflict.baseline.cards[0].front, seed(2).cards[0].front);
assert.equal(conflict.local.cards[0].front, "local");
assert.equal(conflict.remote.cards[0].front, "remote");
for (const party of Object.values(conflict)) {
  assert.deepEqual(party.practiceAttempts, seed(2).practiceAttempts);
  assert.ok(party.localEvents.some(event => event.id === "existing-event"));
  assert.equal(party.nodes[0].cardId, party.cards[0].id);
}
await writeEvidence("A4-backup-conflict", { manifest, stagedBackup, restored: await host(restoreRoot).loadData(), restoredHashes: await hashes(restoreRoot), conflict });
console.log("F05 Store migration, two failure stages, backup restore and conflict passed");
