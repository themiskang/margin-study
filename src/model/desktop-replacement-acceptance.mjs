/**
 * [INPUT]: 使用合成磁盘库、Store、学习集包和真实文件替换。
 * [OUTPUT]: 记录替换边界、主数据哈希、进程退出和重开结果。
 * [POS]: 从升级和导入入口验证 macOS 主数据替换。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { strToU8, zipSync } from "fflate";
import { migrationDiskHost } from "./migration-backup-acceptance.mjs";

const require = createRequire(import.meta.url);
const script = fileURLToPath(import.meta.url);
const pluginDir = ".obsidian/plugins/margin-study";
const mainPath = `${pluginDir}/data.json`;
const createdAt = "2026-11-19T10:00:00.000Z";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
const [mode, ...args] = process.argv.slice(2);

function diskHost(root) {
  const host = migrationDiskHost(root);
  const { vault } = host.app;
  vault.getAbstractFileByPath = () => null;
  vault.createBinary = async (path, bytes) => {
    await vault.adapter.writeBinary(path, bytes);
    return { path };
  };
  return host;
}

function archive() {
  const files = {
    "documents/import.md": strToU8("F08 imported source"),
    "studyset.json": strToU8(JSON.stringify({
      format: "marginstudy-study-set", version: 1,
      cards: [{ id: "import-card", docPath: "import.md", anchorAnnId: "import-ann", front: "F08 candidate", tags: [], links: [], createdAt }],
      nodes: [{ id: "import-node", cardId: "import-card", canvasId: "import-canvas", title: "Imported", x: 0, y: 0 }],
      edges: [], studySets: [{ id: "import-set", name: "F08 imported", docPaths: ["import.md"], createdAt }],
      canvases: [{ id: "import-canvas", studySetId: "import-set", name: "Imported", createdAt }],
      annotations: { "import.md": [{ id: "import-ann", cardId: "import-card", type: "note", page: 1, text: "import anchor", rects: [] }] },
    })),
  };
  files["MANIFEST.json"] = strToU8(JSON.stringify({
    format: "marginstudy-study-set-manifest", version: 1, studySetId: "import-set", createdAt,
    files: Object.entries(files).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: hash(bytes) })),
  }));
  return Uint8Array.from(zipSync(files, { mtime: new Date(createdAt) })).buffer;
}

if (mode === "--external") {
  const [main, expected, replacement] = args;
  const fs = require("node:fs");
  fs.renameSync(replacement, main);
  assert.equal(hash(fs.readFileSync(main)), expected);
  console.log(JSON.stringify({ pid: process.pid, sha256: expected }));
} else if (mode === "--worker") {
  const [bundle, root, flow, scenario, eventPath, externalPath] = args;
  const { Store, importStudySetPackage } = require(bundle);
  const fs = require("node:fs"), subprocess = require("node:child_process");
  const main = join(root, mainPath);
  const host = diskHost(root);
  const store = new Store(host);
  const notices = globalThis.f08Notices = [];
  const baseline = hash(fs.readFileSync(main));
  let hit = false;
  const before = (staged, comparisonSha256) => {
    assert.equal(hit, false);
    hit = true;
    const event = { process: process.pid, checkpoint: "before-rename", comparisonSha256, A: hash(fs.readFileSync(main)), B: hash(fs.readFileSync(staged)) };
    assert.equal(event.A, baseline);
    if (scenario.startsWith("concurrent")) {
      const expected = hash(fs.readFileSync(externalPath));
      const writer = spawnSync(process.execPath, [script, "--external", main, expected, externalPath], { encoding: "utf8" });
      assert.equal(writer.status, 0, writer.stderr);
      event.external = JSON.parse(writer.stdout);
      assert.notEqual(event.external.pid, process.pid);
      assert.equal(hash(fs.readFileSync(main)), expected);
    }
    fs.writeFileSync(eventPath, json(event));
    if (scenario === "kill-before") process.kill(process.pid, "SIGKILL");
  };
  const after = () => {
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    fs.writeFileSync(eventPath, json({ ...event, checkpoint: "after-rename", mainAfter: hash(fs.readFileSync(main)) }));
    if (scenario.endsWith("kill-after")) process.kill(process.pid, "SIGKILL");
  };
  const { rename } = fs.promises;
  fs.promises.rename = async (source, target) => {
    if (target !== main) return rename(source, target);
    before(source);
    await rename(source, scenario === "failure" ? join(root, "missing", "data.json") : target);
    after();
  };
  const { execFile } = subprocess;
  subprocess.execFile = (file, argv, callback) => {
    if (file !== "/usr/bin/osascript" || argv.at(-1) !== main) return execFile(file, argv, callback);
    const staged = argv.at(-2);
    const comparisonSha256 = fs.readFileSync(join(staged.slice(0, -4), "expected.sha256"), "utf8");
    assert.equal(comparisonSha256, baseline);
    before(staged, comparisonSha256);
    if (scenario === "failure") argv = [...argv.slice(0, -1), join(root, "missing", "data.json")];
    return execFile(file, argv, (error, stdout, stderr) => {
      if (!error) after();
      callback(error, stdout, stderr);
    });
  };
  try {
    await store.load();
    if (flow === "import") await importStudySetPackage({ app: host.app, store }, archive());
    console.log(JSON.stringify({ returned: true, conflictPath: store.conflictPath, message: store.lastSaveError, notices }));
  } catch (error) {
    console.log(JSON.stringify({ returned: false, conflictPath: store.conflictPath, message: String(error), notices }));
    process.exitCode = 23;
  }
} else if (process.platform === "darwin") {
  const temporary = await mkdtemp(join(tmpdir(), "marginstudy-f08-"));
  const output = resolve(process.env.MARGINSTUDY_F08_DIR ?? temporary);
  await mkdir(output, { recursive: true });
  const built = await build({
    stdin: { contents: 'export { Store } from "./store"; export { importStudySetPackage } from "../export/studySetImport";', resolveDir: dirname(script) },
    bundle: true, platform: "node", format: "cjs", write: false,
    plugins: [{ name: "synthetic-obsidian", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "synthetic" }));
      builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: "export class Notice{constructor(text){globalThis.f08Notices?.push(text)}}; export class App{}; export class TFile{}; export class Component{}; export const MarkdownRenderer={render:async()=>{}};" }));
    } }],
  });
  const bundle = join(temporary, "store.cjs");
  await writeFile(bundle, built.outputFiles[0].contents);
  const { Store, importStudySetPackage } = require(bundle);
  const cases = [];
  for (const flow of ["upgrade", "import"]) {
    for (const scenario of ["concurrent", "failure", "kill-before", "kill-after", "concurrent-kill-after"]) {
      const id = `${flow}-${scenario}`, root = join(temporary, id);
      await mkdir(join(root, pluginDir), { recursive: true });
      const original = {
        schemaVersion: flow === "upgrade" ? 2 : 3, revision: 7,
        cards: [{ id: "card", type: "excerpt", docPath: "sample.md", anchorAnnId: "ann", front: "F08 original", tags: [], links: [], createdAt }],
        nodes: [{ id: "node", cardId: "card", canvasId: "canvas", title: "Original", x: 0, y: 0 }],
        edges: [], studySets: [{ id: "set", name: "Original", docPaths: ["sample.md"], cardIds: ["card"], createdAt }],
        canvases: [{ id: "canvas", studySetId: "set", name: "Original", createdAt }],
        documents: [{ id: "doc", path: "sample.md", kind: "md", createdAt }],
      };
      const main = join(root, mainPath), originalText = json(original);
      const external = structuredClone(original);
      external.cards[0].front = "F08 external same revision";
      assert.equal(external.revision, original.revision);
      const externalText = json(external), externalPath = join(temporary, `${id}-external.json`);
      await writeFile(main, originalText);
      await writeFile(externalPath, externalText);
      await writeFile(join(root, "sample.md"), "F08 original source");
      const originalSidecar = join(root, "sample.md.mstudy.json");
      const sidecarText = json({ schemaVersion: 2, annotations: [{ id: "ann", type: "note", page: 1, text: "original anchor", rects: [] }] });
      await writeFile(originalSidecar, sidecarText);
      const otherName = `data.json.ms-replace-${hash(hostname())}-${process.ppid}-bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb`;
      const otherDir = join(root, pluginDir, otherName);
      await mkdir(otherDir);
      await writeFile(join(otherDir, "candidate.json"), "active writer candidate");
      const otherStage = otherDir + ".tmp";
      await writeFile(otherStage, "other writer");
      const eventPath = join(output, `${id}-barrier.json`);
      const worker = spawnSync(process.execPath, [script, "--worker", bundle, root, flow, scenario, eventPath, externalPath], { encoding: "utf8", timeout: 15000 });
      const barrier = JSON.parse(await readFile(eventPath, "utf8"));
      const exit = { code: worker.status, signal: worker.signal, stdout: worker.stdout, stderr: worker.stderr };
      const after = hash(await readFile(main));
      const sidecarHash = hash(await readFile(originalSidecar));
      assert.equal(sidecarHash, hash(sidecarText));
      assert.ok(!worker.error, String(worker.error));
      await writeFile(join(output, `${id}-observed.json`), json({ root, barrier, exit, after, E: hash(externalText) }));
      assert.equal(barrier.A, hash(originalText));
      assert.equal(barrier.comparisonSha256, barrier.A);
      const host = diskHost(root), reopened = new Store(host);
      const interrupted = scenario.includes("kill");
      if (interrupted) assert.deepEqual([exit.code, exit.signal], [null, "SIGKILL"]);
      if (!scenario.startsWith("concurrent")) {
        const afterRename = scenario === "kill-after";
        assert.equal(barrier.checkpoint, afterRename ? "after-rename" : "before-rename");
        assert.equal(after, afterRename ? barrier.B : barrier.A);
        if (scenario === "failure") {
          const result = JSON.parse(worker.stdout);
          assert.equal(exit.code, 23);
          assert.equal(result.returned, false);
          assert.match(result.message, /主数据原子交换失败/);
          if (flow === "upgrade") assert.ok(result.notices.some(notice => /失败/.test(notice)));
        }
        await reopened.load();
        assert.equal(reopened.conflictPath, null);
        assert.equal((await host.loadData()).schemaVersion, 3);
        assert.equal(reopened.getNode("node").cardId, "card");
        assert.equal((await reopened.loadAnnotations("sample.md"))[0].id, reopened.getCard("card").anchorAnnId);
        const reopenedFiles = await readdir(join(root, pluginDir));
        assert.deepEqual(reopenedFiles.sort(), ["data.json", otherName, otherName + ".tmp"].sort());
        let retry = null;
        if (flow === "import") {
          retry = await importStudySetPackage({ app: host.app, store: reopened }, archive());
          assert.equal(!!retry.reused, afterRename);
          const duplicate = await importStudySetPackage({ app: host.app, store: reopened }, archive());
          assert.equal(duplicate.reused, true);
          const reloaded = new Store(diskHost(root));
          await reloaded.load();
          const imported = reloaded.cards.filter(card => card.front === "F08 candidate");
          assert.equal(imported.length, 1);
          assert.equal(reloaded.studySets.filter(set => set.name === "F08 imported").length, 1);
          assert.equal(reloaded.nodes.filter(node => node.cardId === imported[0].id).length, 1);
          assert.equal((await reloaded.loadAnnotations(imported[0].docPath))[0].cardId, imported[0].id);
          assert.equal(await readFile(join(root, imported[0].docPath), "utf8"), "F08 imported source");
        }
        assert.equal(hash(await readFile(originalSidecar)), sidecarHash);
        assert.equal(await readFile(otherStage, "utf8"), "other writer");
        assert.equal(await readFile(join(otherDir, "candidate.json"), "utf8"), "active writer candidate");
        const pluginFiles = await readdir(join(root, pluginDir));
        assert.deepEqual(pluginFiles.sort(), ["data.json", otherName, otherName + ".tmp"].sort());
        cases.push({ id, barrier, exit, after, sidecarHash, retry, reopened: hash(await readFile(main)), reopenedFiles, pluginFiles });
        continue;
      }
      assert.equal(barrier.external.sha256, hash(externalText));
      assert.equal(barrier.checkpoint, "after-rename");
      assert.equal(after, barrier.B);
      if (!interrupted) {
        const result = JSON.parse(worker.stdout);
        assert.ok(result.conflictPath);
        assert.ok(result.notices.some(notice => /冲突.*暂停/.test(notice)));
        assert.equal(result.returned, flow === "upgrade");
        assert.equal(exit.code, flow === "upgrade" ? 0 : 23);
      }
      await reopened.load();
      assert.ok(reopened.conflictPath, id);
      const conflictPath = reopened.conflictPath;
      const retained = {
        external: hash(await readFile(join(root, conflictPath, "displaced.json"))),
        candidate: hash(await readFile(join(root, conflictPath, "candidate.json"))),
      };
      assert.equal(retained.external, hash(externalText));
      assert.equal(retained.candidate, barrier.B);
      assert.equal(reopened.getSyncStatus().find(item => item.key === "conflict").action, "resolve-conflict");
      await assert.rejects(reopened.flush(), /冲突/);
      if (flow === "import") await assert.rejects(importStudySetPackage({ app: host.app, store: reopened }, archive()), /冲突/);
      assert.equal(hash(await readFile(main)), after);
      assert.equal((await reopened.loadAnnotations("sample.md"))[0].id, reopened.getCard("card").anchorAnnId);
      const candidate = await host.loadData();
      const candidateRoot = join(temporary, `${id}-select-candidate`);
      await cp(root, candidateRoot, { recursive: true });
      const chosen = new Store(diskHost(candidateRoot));
      await chosen.load();
      await chosen.resolveDataConflict("local");
      assert.deepEqual(chosen.cards, candidate.cards);
      assert.deepEqual(chosen.canvases, candidate.canvases);
      assert.equal(chosen.conflictPath, null);
      await reopened.resolveDataConflict("remote");
      assert.equal(hash(await readFile(join(root, conflictPath + ".resolved", "displaced.json"))), retained.external);
      assert.equal(reopened.getCard("card").front, external.cards[0].front);
      const snapshots = await reopened.listProtectionSnapshots();
      const local = snapshots.find(item => item.reason.includes("本地候选"));
      assert.ok(local);
      const restored = new Store(diskHost(root));
      await restored.load();
      const candidateCard = flow === "import" ? candidate.cards.find(card => card.front === "F08 candidate") : candidate.cards[0];
      await restored.restoreProtectionSnapshot(local.path, [candidateCard.id]);
      await restored.flush();
      assert.equal(restored.getCard(candidateCard.id).front, candidateCard.front);
      if (flow === "import") {
        const path = candidateCard.docPath;
        assert.equal(await readFile(join(root, path), "utf8"), "F08 imported source");
        assert.equal((await restored.loadAnnotations(path))[0].cardId, candidateCard.id);
      }
      assert.equal(hash(await readFile(originalSidecar)), sidecarHash);
      assert.equal(await readFile(otherStage, "utf8"), "other writer");
      assert.equal(await readFile(join(otherDir, "candidate.json"), "utf8"), "active writer candidate");
      cases.push({ id, barrier, exit, after, retained, recovery: { local: local.path, localWholeVersion: true, remote: reopened.getCard("card").front }, pluginFiles: await readdir(join(root, pluginDir)) });
    }
  }
  await writeFile(join(output, "desktop-replacement.json"), json({ cases, storeBundle: hash(built.outputFiles[0].contents) }));
  console.log(`${cases.length} F08 desktop replacement groups passed in ${output}`);
}
