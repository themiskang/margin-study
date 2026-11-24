/**
 * [INPUT]: 依赖 Store、scenes 与 mn5SceneTemplates，零私有夹具依赖。
 * [OUTPUT]: 验证 GAP-09 模板 statusBar 三档契约、mn5 零泄漏边界与 cleanView 状态规范化。
 * [POS]: 公开无头验收套件 workspace-clean-view-template，覆盖 G9-05 模型规范化与 G9-06 模板契约。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, "../..");
const temporary = await mkdtemp(join(tmpdir(), "marginstudy-clean-view-template-"));
const stamp = "2026-11-24T00:00:00Z";

try {
  const built = await build({
    stdin: {
      contents: [
        'export { Store } from "./src/model/store";',
        'export { isSupportedSceneTemplate } from "./src/workspace/scenes";',
        'export { exportMn5SceneTemplate } from "./src/workspace/mn5SceneTemplates";',
      ].join("\n"),
      resolveDir: project,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins: [{
      name: "synthetic-host",
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "memory" }));
        builder.onLoad({ filter: /.*/, namespace: "memory" }, () => ({
          contents: "export class App {} export class TFile {} export class Notice {} export class Component {} export const MarkdownRenderer={render:async()=>{}};",
        }));
      },
    }],
  });
  const bundle = join(temporary, "bundle.cjs");
  await writeFile(bundle, built.outputFiles[0].contents);
  const { Store, isSupportedSceneTemplate, exportMn5SceneTemplate } = createRequire(import.meta.url)(bundle);

  let disk = {
    cards: [],
    nodes: [],
    edges: [],
    srs: {},
    studySets: [{ id: "set-1", name: "Set 1", docPaths: ["synthetic.pdf"], createdAt: stamp }],
    canvases: [{ id: "canvas-1", studySetId: "set-1", name: "Main", createdAt: stamp }],
    activeStudySetId: "set-1",
    activeCanvasId: "canvas-1",
  };
  let writes = 0;
  const files = new Map();
  const directories = new Set();
  const adapter = {
    exists: async (p) => files.has(p) || directories.has(p),
    mkdir: async (p) => { directories.add(p); },
    write: async (p, v) => { files.set(p, v); },
    read: async (p) => { if (!files.has(p)) throw new Error("Missing " + p); return files.get(p); },
    remove: async (p) => { files.delete(p); },
  };
  const host = {
    app: { vault: { adapter, getFiles: () => [] } },
    loadData: async () => structuredClone(disk),
    saveData: async (v) => { writes++; disk = structuredClone(v); },
  };
  const store = new Store(host);
  await store.load();

  // 1. G9-06: default template has undefined statusBar (resolves to "full" at runtime)
  const builtin = store.getSceneTemplates().find((item) => item.id === "standard");
  assert.ok(builtin, "standard built-in template missing");
  assert.equal(builtin.statusBar, undefined, "built-in template should not hardcode statusBar");

  // 2. G9-06: margin-study roundtrip preserves all three statusBar tiers; mn5 schema 3 leaks nothing
  const roundtripReport = {};
  for (const tier of ["full", "compact", "hidden"]) {
    const copy = store.copySceneTemplate("standard");
    copy.name = `StatusBar ${tier}`;
    copy.statusBar = tier;
    store.saveSceneTemplate(copy);

    const msJson = store.exportSceneTemplate(copy.id, "margin-study");
    const msParsed = JSON.parse(msJson);
    assert.equal(msParsed.template.statusBar, tier, `margin-study export lost statusBar=${tier}`);
    assert.equal(isSupportedSceneTemplate(msParsed.template), true, `isSupportedSceneTemplate rejected ${tier}`);

    // Import into a fresh store
    let importDisk = {};
    const importStore = new Store({
      app: host.app,
      loadData: async () => structuredClone(importDisk),
      saveData: async (v) => { importDisk = structuredClone(v); },
    });
    await importStore.load();
    const imported = importStore.importSceneTemplate(msJson);
    assert.equal(imported.statusBar, tier, `margin-study import lost statusBar=${tier}`);

    // MN5 schema 3 export must NEVER include statusBar
    const mn5Raw = exportMn5SceneTemplate(copy);
    const mn5Json = JSON.parse(store.exportSceneTemplate(copy.id, "mn5"));
    assert.equal("statusBar" in mn5Raw, false, `exportMn5SceneTemplate leaked statusBar for ${tier}`);
    assert.equal("statusBar" in mn5Json, false, `store.exportSceneTemplate(mn5) leaked statusBar for ${tier}`);
    assert.equal(mn5Json.schema, 3, "mn5 export schema must be 3");

    roundtripReport[tier] = {
      marginStudyRoundtrip: imported.statusBar === tier,
      mn5Schema: mn5Json.schema,
      mn5HasStatusBar: "statusBar" in mn5Json,
    };
  }

  // 3. G9-06: invalid statusBar value ("mini") is rejected
  const badCopy = store.copySceneTemplate("standard");
  const badExport = JSON.parse(store.exportSceneTemplate(badCopy.id, "margin-study"));
  badExport.template.id = "invalid-statusbar-template";
  badExport.template.statusBar = "mini";
  assert.equal(isSupportedSceneTemplate(badExport.template), false, "isSupportedSceneTemplate accepted statusBar='mini'");
  let invalidRejected = false;
  try {
    store.importSceneTemplate(JSON.stringify(badExport));
  } catch (error) {
    invalidRejected = /无效/.test(String(error));
  }
  assert.equal(invalidRejected, true, "importSceneTemplate did not reject statusBar='mini'");

  // 4. G9-05: cleanView normalization & zero-write on identical state
  const normTrue = store.normalizeWorkspaceState({ tabs: [], cleanView: true });
  const normFalse = store.normalizeWorkspaceState({ tabs: [], cleanView: false });
  const normBad = store.normalizeWorkspaceState({ tabs: [], cleanView: "bad" });
  const normNull = store.normalizeWorkspaceState({ tabs: [], cleanView: null });
  const normMissing = store.normalizeWorkspaceState({ tabs: [] });
  assert.equal(normTrue.cleanView, true, "normalizeWorkspaceState dropped cleanView=true");
  assert.equal(normFalse.cleanView, false, "normalizeWorkspaceState dropped cleanView=false");
  assert.equal(normBad.cleanView, false, "normalizeWorkspaceState did not degrade cleanView='bad' to false");
  assert.equal(normNull.cleanView, false, "normalizeWorkspaceState did not degrade cleanView=null to false");
  assert.equal("cleanView" in normMissing, false, "normalizeWorkspaceState should not inject cleanView when absent");

  store.saveWorkspaceState({ tabs: [], cleanView: true });
  await store.flush();
  const writesAfterSave = writes;
  store.saveWorkspaceState({ tabs: [], cleanView: true });
  await store.flush();
  const zeroWriteDelta = writes - writesAfterSave;
  assert.equal(zeroWriteDelta, 0, `identical saveWorkspaceState caused ${zeroWriteDelta} extra writes`);

  const summary = {
    passed: true,
    g906TemplateContract: {
      defaultStatusBarField: builtin.statusBar ?? null,
      roundtrip: roundtripReport,
      invalidMiniRejected: invalidRejected,
    },
    g905ModelNormalization: {
      truePreserved: normTrue.cleanView === true,
      falsePreserved: normFalse.cleanView === false,
      badDegradedToFalse: normBad.cleanView === false,
      nullDegradedToFalse: normNull.cleanView === false,
      zeroWriteDelta,
    },
  };

  if (process.env.MARGINSTUDY_EVIDENCE_DIR) {
    const outDir = resolve(process.env.MARGINSTUDY_EVIDENCE_DIR, "gap-09");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "g9-06-template-contract.json"), JSON.stringify(summary, null, 2) + "\n");
  }
  console.log("PASS workspace-clean-view-template: statusBar tiers, mn5 zero-leak, invalid rejection, and cleanView normalization verified");
} finally {
  await rm(temporary, { recursive: true, force: true }).catch(() => {});
}
