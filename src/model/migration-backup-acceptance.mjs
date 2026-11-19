/**
 * [INPUT]: 使用 Store 合成磁盘夹具及可终止的子进程。
 * [OUTPUT]: 记录备份发布各阶段中断、重开清理及恢复结果。
 * [POS]: 从迁移与恢复公开入口验证升级备份的生命周期。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const backupRoot = "MarginStudyBackups";
const manifestName = "/manifest.json";
const mediaPath = "_marginstudy-media/f07-fixture.png";
const abortCode = 23;
const faults = {
  "main-write": "throw",
  "asset-write": "throw",
  "manifest-before": "throw",
  "manifest-read": "throw",
  "publication": "throw",
  "manifest-before-killed": "kill",
  "manifest-read-killed": "kill",
  "commit": "throw",
};
const manifestPath = path => path.startsWith(`${backupRoot}/`) && path.endsWith(manifestName);
const [childMode, bundlePath, childRoot, childStage, hitPath] = process.argv.slice(2);

export function migrationDiskHost(root, stage) {
  const pluginDir = ".obsidian/plugins/margin-study";
  const mainPath = `${pluginDir}/data.json`;
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
      if (stage === "snapshot" && manifestPath(path)) throw new Error("F05 snapshot injection");
      if (stage === "commit" && path.startsWith(`${mainPath}.`) && path.endsWith(".tmp")) throw new Error("F05 commit injection");
      return writeFile(join(root, path), value);
    },
    writeBinary: (path, value) => writeFile(join(root, path), Buffer.from(value)),
    stat: path => stat(join(root, path)).then(info => ({ type: info.isFile() ? "file" : "folder", mtime: info.mtimeMs, size: info.size })),
    rename: (source, target) => rename(join(root, source), join(root, target)),
    remove: path => rm(join(root, path)),
    rmdir: (path, recursive) => rm(join(root, path), { recursive }),
  };
  return {
    manifest: { dir: pluginDir },
    app: { vault: { adapter, getFiles: () => [
      "sample.md",
      ...readdirSync(root, { recursive: true }).filter(path => manifestPath(path) || path === mediaPath),
    ].map(path => ({ path })) } },
    loadData: async () => JSON.parse(await adapter.read(mainPath)),
    saveData: () => assert.fail("desktop migration must use the vault adapter"),
  };
}

if (childMode === "--f07-child") {
  const { Store } = createRequire(import.meta.url)(bundlePath);
  const store = new Store(migrationDiskHost(childRoot));
  const adapter = store.host.app.vault.adapter;
  const recordHit = (path, checkpoint) => {
    const event = { stage: childStage, checkpoint, path, pid: process.pid };
    writeFileSync(hitPath, JSON.stringify(event));
    return event;
  };
  const hit = (path, checkpoint) => {
    recordHit(path, checkpoint);
    if (faults[childStage] === "kill") process.kill(process.pid, "SIGKILL");
    throw new Error(`F07 injection ${childStage}`);
  };
  const { write, writeBinary, read, rename } = adapter;
  const verifiedManifests = new Set();
  adapter.write = async (path, content) => {
    if (childStage === "main-write" && path.startsWith(`${backupRoot}/`) && path.endsWith("/data.json")) {
      await write(path, content.slice(0, 14));
      hit(path, "partial-main-bytes");
    }
    if (childStage.startsWith("manifest-before") && manifestPath(path)) hit(path, "before-manifest-write");
    if (childStage === "commit" && path.startsWith(".obsidian/plugins/margin-study/data.json.") && path.endsWith(".tmp")) hit(path, "before-main-commit");
    return write(path, content);
  };
  adapter.writeBinary = async (path, content) => {
    if (childStage === "asset-write" && path.endsWith(`/files/${mediaPath}`)) {
      await writeBinary(path, content.slice(0, 3));
      hit(path, "partial-asset-bytes");
    }
    return writeBinary(path, content);
  };
  adapter.read = async path => {
    const bytes = await read(path);
    if (manifestPath(path)) {
      if (childStage === "active") {
        process.send(recordHit(path, "active-before-verification"));
        await once(process, "message");
      }
      if (childStage.startsWith("manifest-read")) hit(path, "manifest-on-disk-before-verification");
      verifiedManifests.add(path);
    }
    return bytes;
  };
  adapter.rename = async (source, target) => {
    if (childStage === "publication" && verifiedManifests.has(source + manifestName)) hit(source, "verified-before-publication");
    return rename(source, target);
  };
  try { await store.load(); }
  catch (error) {
    if (!String(error).includes(`F07 injection ${childStage}`)) throw error;
    process.exitCode = abortCode;
  }
}

export async function verifyMigrationBackups({ Store, bundle, temporary, fixture, seed, host, hashes, hash, writeEvidence }) {
  const media = Buffer.from("F07 binary fixture media", "utf8");
  const addMedia = async root => {
    await mkdir(join(root, "_marginstudy-media"), { recursive: true });
    await writeFile(join(root, mediaPath), media);
  };
  const source = await fixture("f07-source", seed(3));
  await addMedia(source);
  const manualStore = new Store(host(source));
  await manualStore.load();
  const manual = await manualStore.backupData(true);
  assert.ok(manual);

  const otherData = seed(2);
  otherData.cards[0].front = "independent backup";
  const preexisting = await fixture("f07-other", otherData);
  await addMedia(preexisting);
  const otherStore = new Store(host(preexisting));
  await otherStore.load();
  const otherName = (await readdir(join(preexisting, backupRoot)))[0];
  const other = `${backupRoot}/${otherName}${manifestName}`;
  await cp(join(preexisting, backupRoot, otherName), join(source, backupRoot, otherName), { recursive: true });
  const seededPaths = [manual, other].sort();

  const reopenReadOnly = async root => {
    const runtime = host(root);
    const load = runtime.loadData;
    runtime.loadData = async () => {
      const data = await load();
      return { ...data, settings: { ...data.settings, diagnosticNoPersist: true } };
    };
    const store = new Store(runtime);
    await store.load();
    return store;
  };

  const tree = async root => {
    const base = join(root, backupRoot), rows = {};
    for (const path of (await readdir(base, { recursive: true })).sort()) {
      const absolute = join(base, path), info = await stat(absolute);
      rows[path] = info.isDirectory() ? { type: "directory" } : {
        type: "file", bytes: info.size, sha256: hash(await readFile(absolute)),
      };
    }
    return rows;
  };
  const listed = async store => (await store.listBackupPaths()).sort();
  const preserved = async store => {
    const paths = [];
    for (const path of seededPaths) {
      const snapshot = await store.prepareBackupRecovery(path);
      assert.ok(snapshot.scope.some(item => item.id === "card"));
      paths.push({ path, scope: snapshot.scope, status: "readable" });
    }
    return paths;
  };
  const delta = (before, after, beforePaths, afterPaths) => {
    const added = Object.keys(after).filter(path => !Object.hasOwn(before, path));
    return {
      added, removed: Object.keys(before).filter(path => !Object.hasOwn(after, path)),
      changed: Object.keys(before).filter(path => Object.hasOwn(after, path) && JSON.stringify(before[path]) !== JSON.stringify(after[path])),
      directories: added.filter(path => after[path].type === "directory").length,
      files: added.filter(path => after[path].type === "file").length,
      bytes: added.reduce((sum, path) => sum + (after[path].bytes ?? 0), 0),
      recoveryEntries: afterPaths.filter(path => !beforePaths.includes(path)).length,
    };
  };
  const initialStore = await reopenReadOnly(source);
  const initialReadable = await preserved(initialStore);
  const frozenTree = await tree(source);
  assert.deepEqual(await listed(initialStore), seededPaths);
  const failures = [];
  for (const [stage, mode] of Object.entries(faults)) {
    const root = await fixture(`f07-${stage}`, seed(2));
    await addMedia(root);
    await cp(join(source, backupRoot), join(root, backupRoot), { recursive: true });
    const original = await hashes(root), rounds = [];
    assert.deepEqual(await tree(root), frozenTree);
    let stable = { tree: frozenTree, paths: seededPaths };
    for (const attempt of [1, 2, 3]) {
      const path = join(temporary, `${stage}-${attempt}.json`);
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--f07-child", bundle, root, stage, path], { encoding: "utf8", timeout: 10000 });
      assert.equal(child.error, undefined);
      assert.equal(child.status, mode === "kill" ? null : abortCode, child.stderr);
      assert.equal(child.signal, mode === "kill" ? "SIGKILL" : null);
      const hit = JSON.parse(readFileSync(path, "utf8"));
      assert.equal(hit.stage, stage);
      assert.deepEqual(await hashes(root), original);
      const immediate = await tree(root), inspector = new Store(host(root));
      const immediatePaths = await listed(inspector);
      let directRecovery;
      if (stage !== "commit") {
        assert.equal(immediatePaths.length, seededPaths.length);
        assert.deepEqual(immediatePaths, seededPaths);
        const candidate = hit.path.split("/").slice(0, 2).join("/") + manifestName;
        if (stage === "manifest-read-killed") {
          const written = JSON.parse(await readFile(join(root, candidate), "utf8"));
          assert.equal(written.format, "margin-study-backup");
          assert.equal(written.dataSha256, original[".obsidian/plugins/margin-study/data.json"]);
        }
        await assert.rejects(inspector.prepareBackupRecovery(candidate), error => {
          directRecovery = { path: candidate, error: String(error) };
          return /尚未发布/.test(String(error));
        });
      }
      const reopened = await reopenReadOnly(root);
      const reopenedPaths = await listed(reopened), reopenedTree = await tree(root);
      const change = delta(stable.tree, reopenedTree, stable.paths, reopenedPaths);
      assert.deepEqual(change.removed, []);
      assert.deepEqual(change.changed, []);
      if (stage !== "commit" || attempt > 1) {
        assert.deepEqual(change, { added: [], removed: [], changed: [], directories: 0, files: 0, bytes: 0, recoveryEntries: 0 });
        assert.deepEqual(reopenedPaths, stable.paths);
      } else {
        assert.equal(change.recoveryEntries, 1);
        const published = reopenedPaths.find(entry => !seededPaths.includes(entry));
        const readable = await reopened.prepareBackupRecovery(published);
        assert.ok(readable.scope.some(item => item.id === "card"));
        stable = { tree: reopenedTree, paths: reopenedPaths };
      }
      assert.deepEqual(await hashes(root), original);
      rounds.push({
        attempt, hit, process: { exitCode: child.status, signal: child.signal },
        original, immediate: { tree: immediate, recovery: immediatePaths }, directRecovery,
        reopened: { tree: reopenedTree, recovery: reopenedPaths, hashes: await hashes(root) }, change,
      });
    }
    failures.push({ stage, rounds });
  }
  await writeEvidence("F07-A1-fault-boundaries", { baselineRecovery: seededPaths, failures });
  await writeEvidence("F07-A2-retry-deltas", failures.map(({ stage, rounds }) => ({ stage, deltas: rounds.map(round => round.change) })));

  const recoveryRoot = join(temporary, "f07-publication");
  const success = new Store(host(recoveryRoot));
  await success.load();
  const finalTree = await tree(recoveryRoot), finalPaths = await listed(success);
  const change = delta(frozenTree, finalTree, seededPaths, finalPaths);
  assert.deepEqual(change.changed, []);
  assert.deepEqual(change.removed, []);
  assert.equal(change.recoveryEntries, 1);
  const published = finalPaths.find(path => !seededPaths.includes(path));
  const publishedDir = published.slice(0, -manifestName.length);
  const manifest = JSON.parse(await readFile(join(recoveryRoot, published), "utf8"));
  const expectedFiles = new Set(["data.json", "manifest.json", ...manifest.files.map(file => file.storedPath)]);
  assert.ok(expectedFiles.has(`files/${mediaPath}`));
  assert.equal(manifest.files.filter(file => file.path.endsWith(".mstudy.json")).length, 2);
  const publishedFiles = Object.keys(finalTree).filter(path => finalTree[path].type === "file" && path.startsWith(relative(backupRoot, publishedDir) + "/"));
  assert.deepEqual(new Set(publishedFiles.map(path => relative(relative(backupRoot, publishedDir), path))), expectedFiles);
  const beforeMain = await readFile(join(recoveryRoot, publishedDir, "data.json"));
  assert.equal(hash(beforeMain), manifest.dataSha256);
  for (const entry of manifest.files) {
    const bytes = await readFile(join(recoveryRoot, publishedDir, entry.storedPath));
    assert.equal(bytes.byteLength, entry.bytes);
    assert.equal(hash(bytes), entry.sha256);
  }
  const recovered = await success.prepareBackupRecovery(published);
  assert.ok(recovered.scope.some(item => item.id === "card"));
  assert.equal(recovered.scope.filter(item => item.collection === "annotations").length, 2);
  const reopened = new Store(host(recoveryRoot));
  await reopened.load();
  assert.equal((await host(recoveryRoot).loadData()).schemaVersion, 3);
  assert.deepEqual(await listed(reopened), finalPaths);
  assert.deepEqual(await tree(recoveryRoot), finalTree);
  reopened.updateCard("card", { front: "after-upgrade" });
  await reopened.restoreBackup(published, ["card"]);
  await reopened.flush();
  assert.equal(reopened.getCard("card").front, seed(2).cards[0].front);
  assert.deepEqual(await tree(recoveryRoot), finalTree);
  await writeEvidence("F07-A3-preservation-recovery", {
    before: frozenTree, after: finalTree, initialReadable, currentReadable: await preserved(reopened),
    published, manifest, recovered, change, schemaVersion: 3, recovery: finalPaths,
    restoredSelectedCard: reopened.getCard("card"),
  });

  const isolationRoot = await fixture("f07-cleanup-isolation", seed(2));
  await addMedia(isolationRoot);
  await cp(join(source, backupRoot), join(isolationRoot, backupRoot), { recursive: true });
  const legacyDir = `${backupRoot}/pre-v3-invalid-legacy`;
  await cp(join(isolationRoot, other.slice(0, -manifestName.length)), join(isolationRoot, legacyDir), { recursive: true });
  await writeFile(join(isolationRoot, legacyDir, "data.json"), "{}");
  const legacy = legacyDir + manifestName;
  const isolationTree = await tree(isolationRoot);
  const isolationHitPath = join(temporary, "active-stage.json");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--f07-child", bundle, isolationRoot, "active", isolationHitPath],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const exit = once(child, "exit");
  let active, whileActive;
  try {
    [active] = await once(child, "message", { signal: AbortSignal.timeout(5000) });
    whileActive = await tree(isolationRoot);
    assert.ok(whileActive[relative(backupRoot, active.path)]);
    const observer = await reopenReadOnly(isolationRoot);
    assert.deepEqual(await tree(isolationRoot), whileActive);
    assert.deepEqual(await listed(observer), seededPaths);
    await assert.rejects(observer.prepareBackupRecovery(active.path), /尚未发布/);
    await assert.rejects(observer.prepareBackupRecovery(active.path.toUpperCase()), /尚未发布/);
    await assert.rejects(observer.prepareBackupRecovery(legacy), /主数据校验失败/);
  } finally {
    child.kill("SIGKILL");
    await exit;
  }
  assert.deepEqual(await exit, [null, "SIGKILL"]);
  const afterOwnerExit = await reopenReadOnly(isolationRoot);
  assert.deepEqual(await tree(isolationRoot), isolationTree);
  assert.deepEqual(await listed(afterOwnerExit), seededPaths);
  await writeEvidence("F07-cleanup-isolation", {
    active, activeOwnerExited: { exitCode: null, signal: "SIGKILL" },
    whileActive, reopened: await tree(isolationRoot), legacyPreserved: legacy, recovery: await listed(afterOwnerExit),
  });
}
