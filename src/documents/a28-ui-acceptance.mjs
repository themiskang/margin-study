import { readFile, writeFile, mkdtemp, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { runBrowser } from "../../scripts/ego-harness.mjs";

const exec = promisify(execFile), here = dirname(fileURLToPath(import.meta.url)), root = await realpath(resolve(here, "../.."));
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-a28-ui-")));
await writeFile(join(temporary, "fixture.ts"), (await readFile(join(here, "a28-ui-fixture.txt"), "utf8")).replaceAll("__PROJECT__", root));
await writeFile(join(temporary, "obsidian.ts"), "export class App {} export class TFile {} export class Notice {} export class Component {} export const MarkdownRenderer={render:async()=>{}};");
await writeFile(join(temporary, "index.html"), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><body><script type="module" src="/fixture.js"></script></body></html>');
await build({ entryPoints: [join(temporary, "fixture.ts")], bundle: true, platform: "browser", format: "esm", target: "chrome120", outfile: join(temporary, "fixture.js"),
  plugins: [{ name: "synthetic-obsidian", setup(builder) { builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: join(temporary, "obsidian.ts") })); } }] });
const server = createServer(async (request, response) => {
  const name = new URL(request.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
  if (!["index.html", "fixture.js", "styles.css"].includes(name)) { response.statusCode = 404; response.end(); return; }
  response.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
  response.end(await readFile(name === "styles.css" ? join(root, name) : join(temporary, name)));
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const session = `marginstudy-a28-${process.pid}`;
const browser = (...args) => runBrowser(session, ...args);
try {
  await browser("open", `http://127.0.0.1:${server.address().port}`);
  await browser("wait", "--fn", "window.done === true");
  const report = JSON.parse((await browser("eval", "({fatal:window.fatal ?? null,results:window.results})")).stdout);
  await writeFile(join(temporary, "results.json"), JSON.stringify({ environment: "isolated Chromium, synthetic Store and in-memory vault", ...report }, null, 2) + "\n");
  await browser("screenshot", join(temporary, "status.png"));
  const failed = report.results.filter(result => !result.passed);
  console.log(`${report.results.length - failed.length}/${report.results.length} A28 synthetic UI checks passed`);
  console.log(`Results: ${join(temporary, "results.json")}`);
  console.log(`Screenshot: ${join(temporary, "status.png")}`);
  if (report.fatal || failed.length) { console.error(JSON.stringify({ fatal: report.fatal, failed }, null, 2)); process.exitCode = 1; }
} finally { await browser("close").catch(() => {}); await new Promise(done => server.close(done)); }
