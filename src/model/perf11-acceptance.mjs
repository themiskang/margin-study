import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runBrowserSync } from "../../scripts/verify/ego-harness.mjs";

const directory = await mkdtemp(join(tmpdir(), "margin-perf11-"));
const browser = (...args) => runBrowserSync(`margin-perf11-${process.pid}`, ...args);
try {
  await build({
    stdin: { contents: 'export {Store} from "./src/model/store.ts";', resolveDir: process.cwd() },
    outfile: join(directory, "store.js"), bundle: true, format: "iife", globalName: "StoreModule", platform: "browser",
    plugins: [{ name: "obsidian", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export class Notice {} export class TFile {} export class Component {} export const MarkdownRenderer={};" }));
    } }],
  });
  await writeFile(join(directory, "test.html"), `<!doctype html><body><script src="store.js"></script><script>
  (async () => {
    const results = [], files = new Map(), dirs = new Set();
    let disk = null, writes = 0, adapterWrites = 0;
    const adapter = {exists: async p => files.has(p) || dirs.has(p), mkdir: async p => dirs.add(p),
      read: async p => files.get(p), write: async (p, v) => { adapterWrites++; files.set(p, v); }, remove: async p => files.delete(p)};
    const host = {app:{vault:{adapter,getFiles:()=>[]}},loadData:async()=>structuredClone(disk),
      saveData:async value=>{writes++;disk=structuredClone(value)}};
    const store = new StoreModule.Store(host), wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
    await store.load();
    store.noteInputActivity(1); store.saveWorkspaceState({sequence:1});
    await wait(1450); results.push({name:"active input",pass:writes===0 && adapterWrites===0});
    store.noteInputActivity(0); store.saveWorkspaceState({sequence:2});
    await wait(450); store.noteInputActivity(-1);
    await wait(700); results.push({name:"continuous input",pass:writes===0 && adapterWrites===0});
    await wait(1500); results.push({name:"quiet write",pass:writes===1});
    await wait(900); results.push({name:"one write",pass:writes===1});
    const reopened = new StoreModule.Store(host); await reopened.load();
    results.push({name:"reopen",pass:reopened.getWorkspaceState().sequence===2});
    document.body.dataset.result=JSON.stringify(results);
  })().catch(error => document.body.dataset.result=JSON.stringify({error:String(error)}));
  </script></body>`);
  browser("open", `file://${join(directory, "test.html")}`);
  browser("wait", "5500");
  const results = JSON.parse(JSON.parse(browser("eval", "document.body.dataset.result")));
  console.log(JSON.stringify(results));
  if (!Array.isArray(results) || results.some(result => !result.pass)) throw new Error("Chromium persistence gate failed");
} finally {
  try { browser("close"); } catch {}
  await rm(directory, { recursive: true, force: true });
}
