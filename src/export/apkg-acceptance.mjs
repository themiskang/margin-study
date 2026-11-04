/** A22 APKG acceptance: pure builder + independent SQLite/zip verification (python3 stdlib) + wrapper failure semantics. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, realpath, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const project = await realpath(resolve(here, "../.."));
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-apkg-")));
const outputIndex = process.argv.indexOf("--output-dir");
const evidence = outputIndex >= 0 && process.argv[outputIndex + 1] ? resolve(process.argv[outputIndex + 1]) : temporary;
await mkdir(evidence, { recursive: true });

// 1x1 red PNG
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);

const { buildApkg } = await (async () => {
  await build({ entryPoints: [join(project, "src/export/apkg.ts")], bundle: true, platform: "neutral", format: "esm", outfile: join(temporary, "apkg.mjs") });
  return import(join(temporary, "apkg.mjs"));
})();

// 包装器（bundle exporter.ts，obsidian 以桩替换）
const exporter = await (async () => {
  const obsidian = join(temporary, "obsidian-stub.ts");
  await writeFile(obsidian, [
    "export class TFile { path = ''; extension = 'png'; }",
    "export const notices: string[] = [];",
    "export class Notice { constructor(message: string) { notices.push(message); } hide() {} }",
    "export class Component {}",
    "export class App {}",
    "export class Menu {}",
    "export class MarkdownRenderer { static async render() {} }",
    "export const Platform = { isMobile: false };",
    "export function setIcon() {}",
    "export function normalizePath(path: string) { return path; }",
  ].join("\n"));
  await build({
    entryPoints: [join(project, "src/export/exporter.ts")],
    bundle: true, platform: "neutral", format: "esm", outfile: join(temporary, "exporter.mjs"),
    plugins: [{ name: "stub-obsidian", setup(b) { b.onResolve({ filter: /^obsidian$/ }, () => ({ path: obsidian })); } }],
  });
  return import(join(temporary, "exporter.mjs"));
})();

const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, passed: true }); console.log("✓ " + name); }
  catch (error) { checks.push({ name, passed: false, info: String(error) }); console.error("✗ " + name + "\n  " + error); }
}
async function verifyWithPython(apkgPath, manifestPath) {
  const args = [join(project, "scripts/apkg-verify.py"), apkgPath];
  if (manifestPath) args.push("--manifest", manifestPath);
  const { stdout } = await exec("python3", args, { cwd: project });
  return JSON.parse(stdout);
}

// ===== 场景 A：builder 全类型 + manifest 一致性 + 独立 SQLite 核验 =====
const pngName = `ms-${Buffer.from(PNG).toString("hex").slice(0, 0)}placeholder.png`;
// 与写入器同名规则保持一致：由内容 sha1 前 16 位命名（用 Node crypto 对照）
const { createHash } = await import("node:crypto");
const pngSha1 = createHash("sha1").update(PNG).digest("hex").slice(0, 16);
const jpegSha1 = createHash("sha1").update(JPEG).digest("hex").slice(0, 16);
const pngFile = `ms-${pngSha1}.png`;
const jpegFile = `ms-${jpegSha1}.jpg`;

const occFront = (name, targetId) =>
  `<div class="ms-occ"><img src="${name}"><svg viewBox="0 0 100 100"><rect x="10" y="20" width="30" height="40" fill="#111" stroke="#000" stroke-width="0.6" data-ms-mask="${targetId}"/></svg></div>`;
const occBack = (name) =>
  `<div class="ms-occ"><img src="${name}"><svg viewBox="0 0 100 100"><rect x="10" y="20" width="30" height="40" fill="rgba(91,108,255,0.12)" stroke="#5b6cff" stroke-width="0.5" data-ms-mask="m1"/><text x="11" y="24" font-size="3" fill="#5b6cff">答案</text></svg></div>`;

const input = {
  deckName: "MarginStudy 验收牌组",
  builtAt: 1793340000000,
  notes: [
    { guid: "gnote-basic", model: "basic", fields: { Front: "什么是 APKG？", Back: "Anki 的牌组包格式", Source: "docs/anki.pdf · 第 3 页" }, tags: ["anki", "导入导出"] },
    { guid: "gnote-cloze", model: "cloze", fields: { Text: "APKG 基于 {{c1::SQLite}} 与 {{c2::ZIP}}。", Extra: "collection.anki2 + media", Source: "docs/anki.pdf · 第 4 页" }, tags: ["anki"], ords: [0, 1] },
    { guid: "gnote-occ1", model: "occlusion", fields: { Occlusion: occFront(pngFile, "m1"), Reveal: occBack(pngFile), Extra: "", Source: "img/card.png · 第 1 页" }, tags: ["遮挡"] },
    { guid: "gnote-occ2", model: "occlusion", fields: { Occlusion: occFront(pngFile, "m2"), Reveal: occBack(pngFile), Extra: "", Source: "img/card.png · 第 1 页" }, tags: ["遮挡"] },
    { guid: "gnote-img", model: "basic", fields: { Front: "看图作答" + `<div><img src="${jpegFile}"></div>`, Back: "JPEG 媒体", Source: "img/j.jpg" }, tags: [] },
  ],
  media: [
    { filename: pngFile, data: PNG },
    { filename: jpegFile, data: JPEG },
  ],
};
const { data, manifest } = buildApkg(input);
const apkgPath = join(temporary, "acceptance.apkg");
const manifestPath = join(temporary, "manifest.json");
await writeFile(apkgPath, data);
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

check("manifest counts match the built input (cards/templates/media)", () => {
  assert.equal(manifest.noteCount, 5);
  assert.equal(manifest.cardCount, 6); // 1 basic + 2 cloze + 2 occlusion + 1 basic-with-image
  assert.equal(manifest.modelCount, 3);
  assert.equal(manifest.mediaCount, 2);
});

const report = await verifyWithPython(apkgPath, manifestPath).catch(error => ({ ok: false, error: String(error) }));
check("independent python sqlite/zip verification passes against the manifest", () => {
  assert.equal(report.ok, true, "python report: " + JSON.stringify(report).slice(0, 2000));
  assert.equal(report.integrity.join(","), "ok");
  assert.equal(report.ver, 11);
  assert.equal(report.counts.notes, 5);
  assert.equal(report.counts.cards, 6);
  assert.equal(report.counts.models, 3);
  assert.equal(report.counts.media, 2);
});
check("python sees decks, tags, source text and occlusion rules inside the collection", () => {
  assert.ok(report.decks.includes("MarginStudy 验收牌组"), "deck missing: " + report.decks.join(","));
  const byGuid = Object.fromEntries(report.notes.map(n => [n.guid, n]));
  assert.deepEqual(byGuid["gnote-basic"].tags, ["anki", "导入导出"]);
  assert.ok(byGuid["gnote-basic"].fields[2].includes("docs/anki.pdf · 第 3 页"), "source text missing");
  assert.deepEqual(byGuid["gnote-cloze"].ords, [0, 1]);
  assert.ok(byGuid["gnote-cloze"].fields[0].includes("{{c1::SQLite}}"), "cloze text missing");
  const front = byGuid["gnote-occ1"].fields[0];
  assert.ok(front.includes('data-ms-mask="m1"') && front.includes('fill="#111"'), "front must hide the target mask");
  assert.ok(!front.includes("答案"), "front must not reveal labels");
  const back = byGuid["gnote-occ1"].fields[1];
  assert.ok(back.includes(">答案</text>") && back.includes('stroke="#5b6cff"'), "back must reveal the label");
});

// ===== 场景 B：媒体去重（同一张图两条遮挡题 → 1 个媒体文件） =====
check("duplicate media content is stored once", () => {
  assert.equal(manifest.mediaCount, 2);
  const names = manifest.media.map(m => m.filename);
  assert.equal(new Set(names).size, 2);
});

// ===== 场景 C：builder 级媒体缺失 → 抛错且不产出 =====
check("builder rejects notes referencing missing media", () => {
  assert.throws(() => buildApkg({
    deckName: "坏牌组", notes: [{ guid: "g", model: "basic", fields: { Front: "<img src=\"ms-ffff.png\">", Back: "", Source: "" }, tags: [] }], media: [],
  }), /媒体缺失/);
});

// ===== 场景 D：包装器级缺失媒体 → 拒绝且不写文件 =====
{
  const writes = [];
  const vault = {
    files: new Map(),
    getAbstractFileByPath(path) { return this.files.get(path) ?? null; },
    async readBinary(file) { return file.bytes; },
    async createBinary(path, buffer) { writes.push({ path, buffer }); this.files.set(path, { path }); return { path }; },
    async modifyBinary(file, buffer) { writes.push({ path: file.path, buffer }); },
  };
  const plugin = {
    manifest: { id: "margin-study" },
    activeReader: null,
    app: { vault },
    store: {
      cardsOfDoc: () => [],
      cardsForStudySet: () => ([
        { id: "c1", docPath: "d.pdf", type: "flashcard", front: "正", back: "反", tags: ["t"], links: [] },
        { id: "c2", docPath: "d.pdf", type: "excerpt", front: "遮挡卡", back: "", tags: [], links: [], image: "data:image/png;base64,####不是base64", occlusions: [{ id: "m1", x: 0.1, y: 0.1, width: 0.2, height: 0.2 }] },
      ]),
    },
  };
  let threw = null;
  try { await exporter.exportAnkiApkg(plugin); } catch (error) { threw = error; }
  check("wrapper fails on missing media and writes no pseudo-success file", () => {
    assert.ok(threw, "expected exportAnkiApkg to reject");
    assert.ok(String(threw).includes("媒体缺失"), "error should mention 媒体缺失: " + threw);
    assert.equal(writes.length, 0, "vault must not receive any binary write");
  });
}

// ===== 场景 E：包装器成功路径（写出的包再次被 python 独立核验） =====
{
  const writes = [];
  const vault = {
    files: new Map(),
    getAbstractFileByPath(path) { return this.files.get(path) ?? null; },
    async readBinary(file) { return file.bytes; },
    async createBinary(path, buffer) { writes.push({ path, buffer }); return { path }; },
    async modifyBinary() { throw new Error("should not modify"); },
  };
  const pngDataUrl = "data:image/png;base64," + Buffer.from(PNG).toString("base64");
  const plugin = {
    manifest: { id: "margin-study" },
    activeReader: { getFilePath: () => "deck.pdf" },
    app: { vault },
    store: {
      cardsOfDoc: () => ([
        { id: "k1", docPath: "deck.pdf", page: 2, type: "flashcard", front: "正反面", back: "背面", tags: ["标签A"], links: [] },
        { id: "k2", docPath: "deck.pdf", page: 2, type: "flashcard", front: "挖空 {{c1::甲}} 与 {{c2::乙}}", back: "扩展", tags: [], links: [] },
        { id: "k3", docPath: "deck.pdf", type: "excerpt", front: "图", back: "", tags: [], links: [], image: pngDataUrl, occlusions: [{ id: "m1", x: 0.05, y: 0.1, width: 0.3, height: 0.25 }, { id: "m2", x: 0.5, y: 0.5, width: 0.2, height: 0.2 }] },
      ]),
      cardsForStudySet: () => { throw new Error("unexpected whole-library path"); },
    },
  };
  await exporter.exportAnkiApkg(plugin);
  const outPath = "deck.mstudy.apkg";
  check("wrapper success path writes one binary file with TSV kept separate", () => {
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, outPath);
  });
  const wrapperApkg = join(temporary, "wrapper.apkg");
  await writeFile(wrapperApkg, Buffer.from(writes[0].buffer));
  const wrapperReport = await verifyWithPython(wrapperApkg).catch(error => ({ ok: false, error: String(error) }));
  check("wrapper output passes independent python verification with expected counts", () => {
    assert.equal(wrapperReport.ok, true, JSON.stringify(wrapperReport).slice(0, 2000));
    // k1 basic(1卡) + k2 cloze(2卡) + k3 遮挡2张(2笔记2卡) = 4 笔记 5 卡
    assert.equal(wrapperReport.counts.notes, 4);
    assert.equal(wrapperReport.counts.cards, 5);
    assert.equal(wrapperReport.counts.media, 1);
    const byGuid = Object.fromEntries(wrapperReport.notes.map(n => [n.guid, n]));
    assert.ok(byGuid["ms" + createHash("sha1").update("k1::basic").digest("hex").slice(0, 12)], "basic note guid missing");
    assert.ok(byGuid["ms" + createHash("sha1").update("k2::cloze").digest("hex").slice(0, 12)].ords.every(o => [0, 1].includes(o)));
    const source = byGuid["ms" + createHash("sha1").update("k1::basic").digest("hex").slice(0, 12)].fields[2];
    assert.ok(source.includes("deck.pdf · 第 2 页"), "source text must reference doc+page: " + source);
  });
}

// ===== 汇总 =====
const failed = checks.filter(c => !c.passed);
console.log(`${checks.length - failed.length}/${checks.length} A22 apkg checks passed`);
await writeFile(join(evidence, "results.json"), JSON.stringify({ environment: "node; synthetic data; independent python sqlite3/zipfile verification", pythonReport: report, checks }, null, 2) + "\n");
if (failed.length) process.exitCode = 1;
