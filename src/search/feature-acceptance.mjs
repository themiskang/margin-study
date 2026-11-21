/** A06 feature-search acceptance: explicit feature index, unique actions, settings jumps, Esc/hotkey hygiene.
 *  Isolated Chromium + synthetic plugin + real settings.ts rendering; never touches a real vault. */
import { readFile, writeFile, mkdtemp, realpath, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { runBrowser } from "../../scripts/verify/ego-harness.mjs";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const project = await realpath(resolve(here, "../.."));
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-feature-search-")));
const outputIndex = process.argv.indexOf("--output-dir");
const evidence = outputIndex >= 0 && process.argv[outputIndex + 1] ? resolve(process.argv[outputIndex + 1]) : temporary;
await mkdir(evidence, { recursive: true });
await writeFile(join(temporary, "fixture.ts"), (await readFile(join(here, "feature-fixture.txt"), "utf8")).replaceAll("__PROJECT__", project));
await writeFile(join(temporary, "obsidian.ts"), await readFile(join(here, "feature-obsidian.txt"), "utf8"));
await writeFile(join(temporary, "index.html"), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>MarginStudy 功能搜索验收</title><body style="font:14px/1.5 system-ui;background:#f4f6fb"><h1>功能搜索验收 · 合成数据</h1><div id="fixtures"></div><script type="module" src="/fixture.js"></script></body></html>');
await build({
  entryPoints: [join(temporary, "fixture.ts")],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome120",
  outfile: join(temporary, "fixture.js"),
  plugins: [{
    name: "synthetic-obsidian",
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: join(temporary, "obsidian.ts") }));
    },
  }],
});
const allowed = new Set(["index.html", "fixture.js"]);
const server = createServer(async (request, response) => {
  const name = new URL(request.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
  if (!allowed.has(name)) { response.statusCode = 404; response.end(); return; }
  response.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8");
  response.end(await readFile(join(temporary, name)));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const session = `marginstudy-feature-search-${process.pid}`;
const browser = (...args) => runBrowser(session, ...args);
let failed = false;
try {
  await browser("open", `http://127.0.0.1:${server.address().port}`);
  await browser("wait", "--fn", "window.done === true || Boolean(window.fixtureError)");
  const state = JSON.parse((await browser("eval", "({done:window.done,fatal:window.fixtureError ?? null,results:window.results ?? []})")).stdout);
  const results = state.results ?? [];
  const failedChecks = results.filter((item) => !item.passed);
  console.log(`${results.length - failedChecks.length}/${results.length} A06 feature-search checks passed`);
  await writeFile(join(evidence, "results.json"), JSON.stringify({ environment: "isolated Chromium; synthetic plugin; real settings.ts rendering", fixtureError: state.fatal, results }, null, 2) + "\n");
  await browser("screenshot", join(evidence, "feature-search.png"));
  if (state.fatal || !state.done || failedChecks.length) {
    console.error(JSON.stringify({ fatal: state.fatal, failed: failedChecks }, null, 2));
    process.exitCode = 1;
    failed = true;
  }
} finally {
  await browser("close").catch(() => {});
  await new Promise((done) => server.close(done));
}
