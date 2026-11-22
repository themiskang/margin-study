/**
 * [INPUT]: 使用 Store、合成库和磁盘适配器。
 * [OUTPUT]: 输出主数据迁移、历史备份路径兼容、恢复校验和桌面替换边界的证据。
 * [POS]: 经 Store 公开入口验证持久化协议。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { migrationDiskHost as host, verifyMigrationBackups } from "./migration-backup-acceptance.mjs";

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

async function hashes(root) {
  return Object.fromEntries(await Promise.all([mainPath, ...sidecars].map(async path => [path, hash(await readFile(join(root, path)))])));
}

async function writeEvidence(name, data) {
  await mkdir(output, { recursive: true });
  await writeFile(join(output, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
}

async function verifyBackupPathGuards() {
  const historical = "MarginStudyBackups/pre-v3-historical";
  const historicalManifest = `${historical}/manifest.json`;
  const nestedPaths = Array.from({ length: 5 }, (_, index) => `MarginStudyBackups/earlier-${index}/files/sample.md`);
  const recoveryPath = "_marginstudy-recovery/old-copy.mstudy.json";
  const internalPaths = [...nestedPaths, recoveryPath];
  const reserved = path => path.startsWith("MarginStudyBackups/") || path.startsWith("_marginstudy-recovery/");
  const today = new Date();
  const lastBackup = [today.getFullYear(), today.getMonth() + 1, today.getDate()].map(value => String(value).padStart(2, "0")).join("-");
  const current = { ...seed(3), settings: { lastBackup } };
  const root = await fixture("backup-guard-current", current);
  const source = await readFile(join(root, sourcePath));
  const fingerprint = { sha256: hash(source), byteSize: source.byteLength };
  Object.assign(current.documents[0], fingerprint);
  await writeFile(join(root, mainPath), ` ${JSON.stringify(current, null, 2)}\n`);
  const writeVaultFile = async (vault, path, content) => {
    const destination = join(vault, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  };
  const legacy = { ...seed(2), settings: { lastBackup } };
  Object.assign(legacy.documents[0], fingerprint);
  const backupText = JSON.stringify(legacy);
  const files = [];
  for (const path of [sourcePath, ...internalPaths]) {
    const content = Buffer.from(`backup bytes for ${path}\n`);
    const storedPath = `files/${path}`;
    await writeVaultFile(root, `${historical}/${storedPath}`, content);
    files.push({ path, storedPath, sha256: hash(content), bytes: content.byteLength });
  }
  const manifest = { format: "margin-study-backup", version: 2, createdAt: stamp, dataSha256: hash(backupText), files };
  await writeVaultFile(root, `${historical}/data.json`, backupText);
  await writeVaultFile(root, historicalManifest, JSON.stringify(manifest));

  const store = new Store(host(root));
  const before = await hashes(root);
  await store.load();
  const readEvents = [];
  const originalInfo = console.info;
  console.info = (...args) => { readEvents.push(args); originalInfo(...args); };
  let backupPaths;
  try { backupPaths = await store.listBackupPaths(); }
  finally { console.info = originalInfo; }
  assert.ok(backupPaths.includes(historicalManifest), "历史清单应列为恢复候选");
  assert.equal(readEvents.flat(Infinity).filter(value => internalPaths.includes(value)).length, internalPaths.length);
  assert.equal(store.loadBlocked, false);
  const after = await hashes(root);
  assert.deepEqual(after, before);
  await writeEvidence("backup-guard-P1", { root, historicalManifest, nestedPaths, loadBlocked: store.loadBlocked, before, after, readEvents });
  const hostFixture = process.env.MARGINSTUDY_BACKUP_GUARD_HOST_FIXTURE;
  if (hostFixture) await cp(root, join(hostFixture, "current"), { recursive: true, errorOnExist: true, force: false });

  legacy.studySets[0].docPaths.push(...internalPaths, ...internalPaths.map(path => `${path}.missing`));
  const affectedCards = [
    { ...legacy.cards[0], id: "backup-card", docPath: nestedPaths[0], front: "legacy excerpt" },
    { ...legacy.cards[0], id: "recovery-card", docPath: recoveryPath, sources: [{ docPath: sourcePath, text: "合法来源" }] },
  ];
  legacy.documents.push(...[nestedPaths[0], recoveryPath].map((path, index) => ({ ...legacy.documents[0], id: `internal-doc-${index}`, path })));
  legacy.cards.push(...affectedCards);
  legacy.nodes.push({ ...legacy.nodes[0], id: "backup-card-node", cardId: "backup-card" });
  legacy.studySets[0].cardIds.push(...affectedCards.map(card => card.id));
  const legacyRoot = await fixture("backup-guard-v2", legacy);
  const legacyMainBefore = await readFile(join(legacyRoot, mainPath));
  await cp(join(root, historical), join(legacyRoot, historical), { recursive: true });
  for (const path of internalPaths) {
    await writeVaultFile(legacyRoot, path, "internal file\n");
    await writeVaultFile(legacyRoot, `${path}.mstudy.json`, "internal sidecar\n");
  }
  if (hostFixture) await cp(legacyRoot, join(hostFixture, "legacy"), { recursive: true, errorOnExist: true, force: false });
  const legacyRuntime = host(legacyRoot);
  const legacyStore = new Store(legacyRuntime);
  await legacyStore.load();
  assert.equal(legacyStore.loadBlocked, false);
  assert.deepEqual(await legacyRuntime.loadData(), { ...legacy, schemaVersion: 3 });
  assert.deepEqual(legacyStore.documents, legacy.documents.filter(doc => !reserved(doc.path)));
  assert.deepEqual(legacyStore.getCard("card"), legacy.cards[0]);
  assert.equal(legacyStore.cards.length, legacy.cards.length);
  assert.equal(legacyStore.nodes.length, legacy.nodes.length);
  assert.deepEqual(legacyStore.studySets[0].cardIds, legacy.studySets[0].cardIds);
  assert.equal(legacyStore.getNode("backup-card-node").cardId, "backup-card");
  const detached = [];
  for (const card of affectedCards) {
    const live = legacyStore.getCard(card.id);
    const events = legacyStore.getLocalEvents().filter(event => event.kind === "file-missing" && event.objectIds.includes(card.id));
    assert.equal(live.docPath, "");
    assert.equal(hash(live.front), hash(card.front));
    assert.deepEqual(live.sources, card.sources);
    assert.equal(legacyStore.hasDetachedInternalSource(live), !card.sources?.length);
    assert.ok(events.some(event => event.detail.includes("来源已解除登记，正文与关系保留")));
    detached.push({ id: card.id, before: hash(card.front), after: hash(live.front), events, missingMarker: legacyStore.hasDetachedInternalSource(live) });
  }
  await writeEvidence("backup-guard-P7", {
    before: { documents: legacy.documents.length, cards: legacy.cards.length, nodes: legacy.nodes.length, members: legacy.studySets[0].cardIds.length },
    after: { documents: legacyStore.documents.length, cards: legacyStore.cards.length, nodes: legacyStore.nodes.length, members: legacyStore.studySets[0].cardIds.length },
    invalidPaths: legacyStore.cards.filter(card => reserved(card.docPath)).length, detached,
  });
  const upgradePath = (await legacyStore.listBackupPaths()).find(path => path !== historicalManifest);
  assert.ok(upgradePath);
  const manualPath = await legacyStore.backupData(true);
  assert.ok(manualPath);
  for (const path of [upgradePath, manualPath]) {
    const generated = JSON.parse(await readFile(join(legacyRoot, path), "utf8"));
    assert.equal(generated.files.filter(file => reserved(file.path)).length, 0);
    assert.equal(generated.missingFiles.filter(reserved).length, 0);
    assert.ok(generated.files.some(file => file.path === sourcePath));
    await writeEvidence(`backup-guard-P2-${path === upgradePath ? "upgrade" : "manual"}`, { path, ...generated });
  }
  const snapshotMain = path => readFile(join(legacyRoot, dirname(path), "data.json"));
  const migrationMain = await snapshotMain(upgradePath);
  assert.deepEqual(migrationMain, legacyMainBefore);
  const manual = JSON.parse(await snapshotMain(manualPath));
  const manualInternal = {
    documents: manual.documents.filter(doc => reserved(doc.path)).length,
    cards: manual.cards.filter(card => reserved(card.docPath)).length,
  };
  assert.deepEqual(manualInternal, { documents: 0, cards: 0 });
  const restore = await legacyStore.prepareBackupRecovery(upgradePath);
  const recovery = JSON.parse(await readFile(join(legacyRoot, restore.path), "utf8"));
  assert.ok(!restore.scope.some(item => item.collection === "documents" && item.id.startsWith("internal-doc-")));
  assert.equal(recovery.objects.find(item => item.collection === "cards" && item.id === "backup-card").value.docPath, "");
  assert.equal(recovery.objects.find(item => item.collection === "cards" && item.id === "backup-card").value.front, affectedCards[0].front);
  await writeEvidence("backup-guard-P8", { manualInternal, migration: { path: upgradePath, before: hash(legacyMainBefore), stored: hash(migrationMain) }, restoreScope: restore.scope });

  const invalid = [
    ["traversal", [{ ...files[1], path: `${nestedPaths[0]}/../escape.md` }], `无效的库内路径：${nestedPaths[0]}/../escape.md`],
    ["stored-traversal", [{ ...files[1], storedPath: "files/../escape.md" }], "无效的库内路径：files/../escape.md"],
    ["stored-prefix", [{ ...files[1], storedPath: "data.json" }], "备份含重复或不允许的文件路径"],
    ["duplicate", [files[1], { ...files[1], storedPath: files[2].storedPath }], "备份含重复或不允许的文件路径"],
  ];
  const rejections = [];
  for (const [sample, entries, message] of invalid) {
    const path = `MarginStudyBackups/${sample}`;
    await writeVaultFile(root, `${path}/data.json`, backupText);
    await writeVaultFile(root, `${path}/manifest.json`, JSON.stringify({ ...manifest, files: entries }));
    if (sample === "duplicate") await writeVaultFile(root, `${path}/${files[1].storedPath}`, await readFile(join(root, historical, files[1].storedPath)));
    await assert.rejects(store.prepareBackupRecovery(`${path}/manifest.json`), error => {
      rejections.push({ sample, entries, error: error.message });
      return error.message === message;
    });
  }
  await writeEvidence("backup-guard-P3", rejections);

  const integrity = [];
  for (const [sample, file] of [["sha", files[0]], ["bytes", files[0]], ["nested-sha", files[1]]]) {
    const destination = join(root, historical, file.storedPath);
    const original = await readFile(destination);
    const corrupt = sample === "bytes" ? Buffer.concat([original, Buffer.of(0)]) : Buffer.from(original);
    if (sample !== "bytes") corrupt[0] ^= 1;
    const expected = sample === "bytes" ? { ...file, sha256: hash(corrupt) } : file;
    await writeFile(destination, corrupt);
    await writeVaultFile(root, historicalManifest, JSON.stringify({ ...manifest, files: files.map(item => item === file ? expected : item) }));
    await assert.rejects(store.restoreBackup(historicalManifest, ["card"]), error => {
      integrity.push({ sample, expected, actualSha256: hash(corrupt), actualBytes: corrupt.byteLength, error: error.message });
      return error.message === `文件校验失败：${file.path}`;
    });
    await writeFile(destination, original);
  }
  await writeEvidence("backup-guard-P4", integrity);
  console.log("Backup path guards: historical recovery, clean new backups, 4 unsafe paths and 3 integrity samples passed");
}

await verifyBackupPathGuards();

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
await writeEvidence("F07-store-bundle", { sha256: hash(built.outputFiles[0].contents), bytes: built.outputFiles[0].contents.byteLength });
await verifyMigrationBackups({ Store, bundle, temporary, fixture, seed, host, hashes, hash, writeEvidence });
console.log("F07 backup fault recovery, retry deduplication and existing backup preservation passed");
await import("./desktop-replacement-acceptance.mjs");
