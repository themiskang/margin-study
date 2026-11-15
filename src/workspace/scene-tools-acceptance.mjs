/**
 * Candidate acceptance for A04: frozen A01 ordered controls -> product stable ID/action.
 * Real Store + real StudyWorkspaceView + synthetic in-memory host; no native-app claim.
 * Expectations come from A01-A04-id-action-map.json (candidate map), which is derived
 * from the frozen A01 input and validated against src/workspace/studyWorkspace.ts.
 *
 * Run: node src/workspace/scene-tools-acceptance.mjs [map.json]
 */
import { readFile, writeFile, mkdtemp, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { runBrowser } from "../../scripts/ego-harness.mjs";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const project = await realpath(resolve(here, "../.."));
const mapPath = resolve(process.argv[2] ?? join(project,
  "evidence/mn5-alignment-20261029/limit-candidates/step1-recovery/Hermes-DeepSeek-V4.1-Flash-20261030-1220/A01-A04-id-action-map.json"));
const map = JSON.parse(await readFile(mapPath, "utf8"));
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-scene-tools-")));

for (const name of ["acceptance-fixture", "obsidian-fixture"])
  await writeFile(join(temporary, name + ".ts"),
    (await readFile(join(here, name + ".txt"), "utf8")).replaceAll("__PROJECT__", project));
for (const name of ["fakePdf", "fakeMammoth"])
  await writeFile(join(temporary, name + ".ts"),
    await readFile(join(project, "src/documents/acceptance-fixtures", name + ".txt"), "utf8"));
const fixturePaths = ["Alpha.html", "Middle.html", "Final.html", "Beta.md", "Gamma.docx", "Delta.pdf", "Slow.html"];
const hashes = Object.fromEntries(fixturePaths.map(path => [path, createHash("sha256").update(path).digest("hex")]));
await writeFile(join(temporary, "fakePdf.ts"),
  (await readFile(join(temporary, "fakePdf.ts"), "utf8")) + "\nexport async function initPdfWorker() {}\n");
await writeFile(join(temporary, "crypto.ts"),
  `const hashes=${JSON.stringify(hashes)};export function createHash(){let input;return{update(value){input=value;return this;},digest(){if(!(input in hashes))throw new Error('Unlisted synthetic hash input: '+input);return hashes[input];}}}`);
await writeFile(join(temporary, "unused-network.ts"),
  "export function request(){throw new Error('AI network transport is outside this fixture');}");
const styles = await Promise.all(["styles.css", "styles-reader.css", "styles-mindmap.css", "styles-organize.css", "styles-workspace.css"]
  .map(name => readFile(join(project, name), "utf8")));
await writeFile(join(temporary, "styles.css"), styles.join("\n"));
await writeFile(join(temporary, "index.html"),
  '<!doctype html><meta charset="utf-8"><title>MarginStudy scene tools candidate</title><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0;height:100%}#fixtures{height:100vh;width:100vw}.test-item-view{height:100%;width:100%;display:flex;flex-direction:column}.test-item-view>.view-content{height:100%;width:100%;overflow:hidden}</style><main id="fixtures"></main><script type="module" src="/fixture.js"></script>');
await build({ entryPoints: [join(temporary, "acceptance-fixture.ts")], bundle: true, platform: "browser", format: "esm", target: "chrome120", outfile: join(temporary, "fixture.js"),
  plugins: [{ name: "public-synthetic-host-adapters", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: join(temporary, "obsidian-fixture.ts") }));
    builder.onResolve({ filter: /^crypto$/ }, () => ({ path: join(temporary, "crypto.ts") }));
    builder.onResolve({ filter: /^(?:http|https)$/ }, () => ({ path: join(temporary, "unused-network.ts") }));
    builder.onResolve({ filter: /^mammoth$/ }, () => ({ path: join(temporary, "fakeMammoth.ts") }));
    builder.onResolve({ filter: /\/pdfjs$/ }, () => ({ path: join(temporary, "fakePdf.ts") }));
  } }] });
const allowed = new Set(["index.html", "fixture.js", "styles.css"]);
const server = createServer(async (request, response) => {
  const name = new URL(request.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
  if (!allowed.has(name)) { response.statusCode = 404; response.end(); return; }
  response.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
  response.end(await readFile(join(temporary, name)));
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const session = `marginstudy-scene-tools-${process.pid}`;
const browser = (...args) => runBrowser(session, ...args);
const results = [];
const record = (name, passed, error) => results.push({ name, passed, ...(passed ? {} : { error }) });

try {
  await browser("open", "about:blank");
  await browser("set", "viewport", "1512", "949");
  await browser("open", `http://127.0.0.1:${server.address().port}`);
  const deadline = Date.now() + 240000;
  let state = { done: false, fatal: null };
  for (;;) {
    state = JSON.parse((await browser("eval", "({done:window.done,fatal:window.fatal||null})")).stdout);
    if (state.done || Date.now() > deadline) break;
    await new Promise(done => setTimeout(done, 500));
  }
  if (!state.done) throw new Error("fixture did not finish within 240s");
  if (state.fatal) throw new Error("fixture fatal: " + state.fatal);

  const probe = JSON.parse((await browser("eval", "window.sceneToolsProbe()")).stdout);
  await writeFile(join(project, "scene-tools-probe.json"), JSON.stringify(probe, null, 2));
  const own = JSON.parse((await browser("eval", "({results:window.results||[],errors:window.testErrors||[]})")).stdout);
  const ownFailed = (own.results ?? []).filter(item => !item.passed);

  const scenes = Object.fromEntries(map.scenes.map(scene => [scene.sceneId, scene]));
  const snap = probe.snapshots;
  const restored = probe.restored;
  const actions = probe.actions;

  record("Scene interface renders exactly one capsule shell", restored.capsuleCount === 1, "capsule shells: " + restored.capsuleCount);
  record("Standard template exposes the four frozen scenes in order",
    snap.excerpt.tabs.map(tab => tab.sceneId).join("|") === "excerpt|handwriting|organize|recall",
    JSON.stringify(snap.excerpt.tabs));
  record("Every scene tab is role=tab with aria-selected/aria-pressed and a data-scene-id",
    snap.excerpt.tabs.every(tab => tab.role === "tab" && tab.selected !== null && tab.pressed !== null && !!tab.sceneId),
    JSON.stringify(snap.excerpt.tabs));
  record("Only one tools row is exposed at a time in every scene",
    ["excerpt", "handwriting", "organize", "recall"].every(id => snap[id].activeRows === 1),
    JSON.stringify(Object.fromEntries(["excerpt", "handwriting", "organize", "recall"].map(id => [id, snap[id].activeRows]))));

  for (const sceneId of ["excerpt", "handwriting", "organize", "recall"]) {
    const expected = scenes[sceneId].productExpectedTools;
    const actual = snap[sceneId].tools.map(tool => tool.label);
    record(`[${sceneId}] ordered tools match the A01-derived map exactly`,
      JSON.stringify(actual) === JSON.stringify(expected),
      JSON.stringify({ expected, actual }));
    record(`[${sceneId}] tool count equals the mapped count (${expected.length})`, actual.length === expected.length, actual.length);
    record(`[${sceneId}] no duplicate tool labels`, new Set(actual).size === actual.length, JSON.stringify(actual));
    record(`[${sceneId}] collapse control is last, labelled and exposes aria-expanded`,
      !!snap[sceneId].collapse.label && snap[sceneId].collapse.expanded !== null, JSON.stringify(snap[sceneId].collapse));
  }

  // --- template scenes: read-write-recall (reading / writing) — only when the map carries them ---
  const tplSnaps = probe.templateSnapshots ?? {};
  for (const sceneId of ["reading", "writing"]) {
    const mapped = scenes[sceneId];
    if (!mapped || mapped.template !== "read-write-recall") continue;
    const snap = tplSnaps["read-write-recall:" + sceneId];
    record(`[${sceneId}] template row exposed by the host`, !!snap, snap ? "ok" : "missing template snapshot");
    if (!snap) continue;
    const expected = mapped.productExpectedTools;
    const actual = snap.tools.map(tool => tool.label);
    record(`[${sceneId}] ordered tools match the A01-derived map exactly`,
      JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify({ expected, actual }));
    record(`[${sceneId}] tool count equals the mapped count (${expected.length})`, actual.length === expected.length, actual.length);
    record(`[${sceneId}] no duplicate tool labels`, new Set(actual).size === actual.length, JSON.stringify(actual));
    record(`[${sceneId}] nav and collapse are present in the template bar`,
      snap.tabs.length > 0 && !!snap.collapse.label, JSON.stringify({ tabs: snap.tabs.length, collapse: snap.collapse }));
    const rowLabels = (snap.allRows ?? []).flatMap(row => row.labels ?? []);
    const extraRowTools = rowLabels.filter(label => !actual.includes(label));
    record(`[${sceneId}] no sibling row hides additional tools`,
      extraRowTools.length === 0, JSON.stringify({ extraRowTools, rows: (snap.allRows ?? []).length }));
    record(`[${sceneId}] declared-but-unrendered tools appear in no row of the bar`,
      (mapped.notExposed ?? []).every(label => !rowLabels.includes(label)),
      JSON.stringify({ notExposed: mapped.notExposed ?? [], rowLabels }));
    record(`[${sceneId}] every declared key is rendered, aliased or explicitly unreachable`,
      (mapped.declaredKeys ?? []).every(key => [...(mapped.renderedKeys ?? []), ...(mapped.notRenderedKeys ?? []),
        ...(mapped.collapseAliasedKeys ?? [])].includes(key)),
      JSON.stringify({ declared: mapped.declaredKeys, rendered: mapped.renderedKeys,
                       notRendered: mapped.notRenderedKeys, aliased: mapped.collapseAliasedKeys }));
    record(`[${sceneId}] collapse toggles closed then back open`,
      (snap.collapsedState?.collapsed ?? null) === "false" && (snap.reExpandedState?.collapsed ?? null) === "true",
      JSON.stringify({ closed: snap.collapsedState?.collapsed ?? null, reopened: snap.reExpandedState?.collapsed ?? null }));
  }

  const business = (scene) => JSON.stringify({ cards: scene.cards, nodes: scene.nodes, annotations: scene.annotations });
  const businessBaseline = business(snap.excerpt);
  record("Scene switching changes no card, node or annotation",
    ["handwriting", "organize", "recall", "restored"].every(id => business(id === "restored" ? restored : snap[id]) === businessBaseline),
    "business snapshot drifted");

  const step = (key) => actions[key]?.after ?? {};
  record("[excerpt] 手型 selects the hand tool", step("手型（摘录笔盒）").readerTool === "hand", step("手型（摘录笔盒）").readerTool);
  record("[excerpt] 文本 selects the text tool", step("文本").readerTool === "text", step("文本").readerTool);
  record("[excerpt] 矩形 selects the region tool", step("矩形").readerTool === "region", step("矩形").readerTool);
  record("[excerpt] 更多 opens exactly one document-more popover",
    actions["更多"]?.clicked && /ms-document-more/.test(step("更多").popup?.className ?? ""), JSON.stringify(actions["更多"]?.after?.popup ?? null));
  record("[excerpt] 标题链接 toggles on then off (restored)",
    step("标题链接").titleLinks === true && step("标题链接.restore").titleLinks === false,
    JSON.stringify({ on: step("标题链接").titleLinks, off: step("标题链接.restore").titleLinks }));
  record("[excerpt] 块选择 toggles on then off (restored)",
    step("块选择").blockSelection === true && step("块选择.restore").blockSelection === false,
    JSON.stringify({ on: step("块选择").blockSelection, off: step("块选择.restore").blockSelection }));
  record("[handwriting] 普通笔 1 and 普通笔 2 select distinct presets",
    step("handwriting:普通笔 1").readerTool === "pen" && step("handwriting:普通笔 2").readerTool === "pen" &&
    step("handwriting:普通笔 1").preset !== step("handwriting:普通笔 2").preset,
    JSON.stringify({ one: step("handwriting:普通笔 1").preset, two: step("handwriting:普通笔 2").preset }));
  record("[handwriting] 荧光笔 selects the highlighter mode", step("handwriting:荧光笔").readerTool === "highlight", step("handwriting:荧光笔").readerTool);
  record("[handwriting] 套索 selects lasso", step("handwriting:套索").readerTool === "lasso", step("handwriting:套索").readerTool);
  record("[handwriting] 橡皮擦 selects eraser", step("handwriting:橡皮擦").readerTool === "eraser", step("handwriting:橡皮擦").readerTool);
  record("[handwriting] 手形工具 selects hand", step("handwriting:手形工具").readerTool === "hand", step("handwriting:手形工具").readerTool);
  record("[recall] AI提示 toggles on then off (restored)",
    step("recall:AI提示").aiHint === true && step("recall:AI提示.restore").aiHint === false,
    JSON.stringify({ on: step("recall:AI提示").aiHint, off: step("recall:AI提示.restore").aiHint }));
  record("[recall] 回忆设置 shows the native recall-option menu",
    (step("recall:回忆设置").menu ?? []).some(text => String(text).includes("遮挡全部摘录")) &&
    (step("recall:回忆设置").menu ?? []).some(text => String(text).includes("单项揭示")),
    JSON.stringify(step("recall:回忆设置").menu ?? null));
  record("[organize] 层级 shows the native hierarchy menu",
    (step("organize:层级").menu ?? []).filter(Boolean).length > 0, JSON.stringify(step("organize:层级").menu ?? null));
  record("[organize] every non-history scene tool is enabled in a reader-backed document",
    (probe.organizeUntouched ?? []).filter(item => !["撤销", "重做"].includes(item.label)).every(item => item.disabled === false),
    JSON.stringify(probe.organizeUntouched));
  record("Final state is the standard/excerpt scene", restored.scene?.sceneId === "excerpt" && restored.scene?.interfaceMode === "scenes",
    JSON.stringify(restored.scene));

  // Declared gaps are part of the candidate: they must be reported, not hidden.
  record("Shared workspace fixture suite still passes with the additive probe seam",
    ownFailed.length === 0 && (own.errors ?? []).length === 0,
    JSON.stringify({ failed: ownFailed.map(item => item.name), errors: own.errors }));

  const gaps = map.scenes.flatMap(scene => scene.controls
    .filter(control => control.status !== "mapped")
    .map(control => ({ sceneId: scene.sceneId, order: control.order, nativeLabel: control.nativeLabel,
      status: control.status, note: control.note, contractKey: control.contractKey })));
  const gapSummary = map.totals;
  await writeFile(join(project, "scene-tools-gaps.json"), JSON.stringify({ totals: gapSummary, gaps }, null, 2));

  const report = {
    schema: "a04-scene-tools-candidate-result-v1",
    status: "候选；不是Codex终端验收，也不是npm run verify",
    generatedAt: new Date().toISOString(),
    mapPath,
    mapSha256: createHash("sha256").update(await readFile(mapPath)).digest("hex"),
    environment: "Chromium via ego-browser; real Store + StudyWorkspaceView; synthetic in-memory host; PDF/Word adapters mocked",
    limitations: [
      "Obsidian host lifecycle is mocked; native MarginNote appearance is not asserted here",
      "No ink is created; pen checks assert tool/preset state only",
      "Board, review, copy-move and link tools are presence-checked only, never clicked",
    ],
    checks: results,
    totals: { checks: results.length, passed: results.filter(item => item.passed).length, failed: results.filter(item => !item.passed).length },
    declaredGaps: gapSummary,
    gapDetail: gaps,
    fixtureSuite: { checks: (own.results ?? []).length, failed: ownFailed.length, errors: own.errors ?? [] },
    probe,
  };
  await writeFile(join(project, "scene-tools-results.json"), JSON.stringify(report, null, 2));

  console.log(`${report.totals.passed}/${report.totals.checks} scene-tool checks passed`);
  console.log(`declared gaps: ${JSON.stringify(gapSummary)}`);
  console.log(`Results: ${join(project, "scene-tools-results.json")}`);
  console.log(`Gaps: ${join(project, "scene-tools-gaps.json")}`);
  console.log(`Probe: ${join(project, "scene-tools-probe.json")}`);
  if (state.fatal || report.totals.failed) {
    console.error(JSON.stringify(results.filter(item => !item.passed), null, 2));
    process.exitCode = 1;
  }
} finally {
  await browser("close").catch(() => {});
  await new Promise(done => server.close(done));
}
