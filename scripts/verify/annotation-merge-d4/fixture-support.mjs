import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { compileFunction } from "node:vm";

export const doc = "independent.pdf";
const base = {docPath: doc, docKind: "pdf", page: 1, text: "", color: "#000", createdAt: "2026-11-22"};
export const host = (id, props = {}) => ({id, ...base, type: "note", rects: [{x: 10, y: 20, w: 70, h: 40}], overlay: {kind: "text"}, ...props});
export const pen = (id, target, props = {}) => ({id, ...base, type: "pen", rects: [], strokes: [[{x: .12, y: .17}, {x: .24, y: .17}]], ...(target !== undefined && {hostAnnotationId: target}), ...props});
export const deleted = host("deleted", {overlay: {kind: "text", deleted: true}});
export const payload = annotations => JSON.stringify({annotations});

async function loadStore(project) {
  const require = createRequire(join(project, "package.json"));
  const { build } = require("esbuild");
  const { outputFiles: [bundle] } = await build({
    absWorkingDir: project,
    entryPoints: ["src/model/store.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins: [{
      name: "mock-obsidian",
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "mock" }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents: `export class Notice { constructor() {} } export const Platform = { isMobile: false }; export class TFile {} export class Component {} export class Modal {} export const MarkdownRenderer = {}; export function setIcon() {}`,
          loader: "js",
        }));
      },
    }],
  });
  const module = { exports: {} };
  const execute = compileFunction(bundle.text, ["module", "exports", "require", "__dirname", "__filename"], {
    filename: "marginstudy-d4-fixture-store.cjs",
  });
  execute(module, module.exports, require, project, join(project, "main.js"));
  return module.exports.Store;
}

export function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).reverse()) out[key] = reverseKeys(value[key]);
    return out;
  }
  return value;
}

function makeEnv(Store) {
  const disk = new Map();
  let savedData = null;
  const hooks = { beforeWrite: null, afterWrite: null, beforeSaveData: null };
  const adapter = {
    exists: async path => disk.has(path) || [...disk.keys()].some(key => key.startsWith(path + "/")),
    read: async path => disk.get(path) ?? "",
    write: async (path, data) => {
      if (hooks.beforeWrite) await hooks.beforeWrite(path, data, disk);
      disk.set(path, data);
      if (hooks.afterWrite) await hooks.afterWrite(path, data, disk);
    },
    mkdir: async () => {},
    list: async dir => ({ files: [...disk.keys()].filter(key => key.startsWith(dir + "/")), folders: [] }),
    stat: async path => disk.has(path) ? { type: "file", mtime: Date.now(), size: disk.get(path).length } : null,
    remove: async path => { disk.delete(path); },
  };
  const makeStore = async () => {
    const host = {
      app: { vault: { adapter, configDir: ".obsidian", getAbstractFileByPath: () => null, getFiles: () => [] } },
      loadData: async () => savedData ? JSON.parse(JSON.stringify(savedData)) : null,
      saveData: async data => {
        if (hooks.beforeSaveData) await hooks.beforeSaveData(data);
        savedData = JSON.parse(JSON.stringify(data));
      },
      manifest: { id: "margin-study", version: "0.2.0" },
    };
    const store = new Store(host);
    await store.load();
    return store;
  };
  return { disk, hooks, makeStore, getSavedData: () => savedData };
}

async function setup(Store, local, remote) {
  const env = makeEnv(Store);
  const store = await env.makeStore();
  const path = store.sidecarPath(doc);
  await store.loadAnnotations(doc);
  await store.saveAnnotationsNow(doc, local);
  const raw = payload(remote);
  env.disk.set(path, raw);
  return {env, store, path, raw};
}

const isUnbind = event => event.kind === "conflict-merged" && event.detail.includes("hostAnnotationId");
export const unbindEvents = store => (store.getLocalEvents() ?? []).filter(isUnbind);
export const durable = env => (env.getSavedData()?.localEvents ?? []).filter(isUnbind);
export const merge = store => store.resolveAnnotationConflict(doc, "merge");
export const diskAnns = ({env, path}) => JSON.parse(env.disk.get(path)).annotations;
export const parent = (annotations, id) => annotations.find(item => item.id === id)?.hostAnnotationId ?? null;
export const journals = env => [...env.disk.keys()].filter(path => path.includes("pending-merge-tx-"));
export const view = ann => ({id: ann.id, type: ann.type, host: ann.hostAnnotationId ?? null, text: ann.text});

export async function error(action) {
  try {
    await action();
    return null;
  } catch (failure) {
    return failure.message;
  }
}

export async function freshKeyOrder(setup, target, reverse) {
  const sharedHost = target === "deleted" ? deleted : host(target);
  const sharedPen = pen("shared", target);
  const shared = [sharedHost, sharedPen];
  const state = await setup(structuredClone(shared), reverse ? reverseKeys(shared) : structuredClone(shared));
  await merge(state.store);
  const annotations = diskAnns(state).map(view);
  const stored = state.env.getSavedData().docMeta[doc];
  return {
    annotations,
    eventCount: durable(state.env).length,
    conflictMap: stored.mergeConflictIdMap ?? {},
    processed: stored.mergeProcessedPens ?? {},
    keys: stored.unbindEventKeys ?? [],
  };
}

export async function run(fixture, collect) {
  const project = resolve(process.argv[2] ?? process.cwd());
  let failed = false;
  const check = (name, actual, expected) => {
    const passed = isDeepStrictEqual(actual, expected);
    failed ||= !passed;
    const result = JSON.stringify({fixture, assertion: name, actual, expected}, null, 2);
    if (passed) console.log(`PASS ${fixture} ${name}`);
    else console.error(`FAIL ${result}`);
  };
  try {
    const Store = await loadStore(project);
    await collect((local, remote) => setup(Store, local, remote), check);
    if (failed) process.exitCode = 1;
  } catch (failure) {
    console.error(`ERROR ${JSON.stringify({
      fixture, project,
      actual: { name: failure.name, message: failure.message },
      expected: "候选 Store 可加载并完成本场景采样",
    }, null, 2)}`);
    process.exitCode = 2;
  }
}
