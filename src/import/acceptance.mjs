/** Local HTTP articles and an in-memory vault; never attaches to a native app. */
import { readFile, writeFile, mkdtemp, realpath } from "node:fs/promises";
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
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-web-import-")));
await writeFile(join(temporary, "fixture.ts"), (await readFile(join(here, "acceptance-fixture.txt"), "utf8")).replaceAll("__PROJECT__", project));
const obsidian = await readFile(join(project, "src/documents/acceptance-fixtures/obsidian.txt"), "utf8");
await writeFile(join(temporary, "obsidian.ts"), obsidian + `
export async function requestUrl(input: any) {
  const response=await fetch(input.url,{headers:input.headers});const bytes=await response.arrayBuffer();
  return {status:response.status,headers:Object.fromEntries(response.headers.entries()),arrayBuffer:bytes,text:new TextDecoder().decode(bytes)};
}
`);
await writeFile(join(temporary, "styles.css"), [await readFile(join(project, "styles.css"), "utf8"), await readFile(join(project, "src/styles/styles-import.css"), "utf8")].join("\n"));
await writeFile(join(temporary, "index.html"), '<!doctype html><meta charset="utf-8"><title>Web import acceptance</title><link rel="stylesheet" href="/styles.css"><body><main id="fixtures"></main><script type="module" src="/fixture.js"></script>');
await build({ entryPoints: [join(temporary, "fixture.ts")], bundle: true, platform: "browser", format: "esm", target: "chrome120", outfile: join(temporary, "fixture.js"), plugins: [{ name: "isolated-obsidian", setup(builder) {
  builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: join(temporary, "obsidian.ts") }));
  builder.onResolve({ filter: /^crypto$/ }, () => ({ path: "unused-crypto", namespace: "synthetic" }));
  builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: "export function createHash() { throw new Error('Hashing is outside this fixture'); }", loader: "js" }));
} }] });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
const paragraphs = Array.from({ length: 7 }, (_, i) => `<p>Paragraph ${i + 1}. This synthetic article explains the relationship between reading, excerpts and a local study set. A saved article keeps its words available without executing publisher scripts.</p>`).join("");
const requests = [];
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname; requests.push(path);
  if (path === "/asset.png") { response.setHeader("Content-Type", "image/png"); response.end(png); return; }
  if (path === "/bad-image") { response.setHeader("Content-Type", "image/png"); response.end('<svg onload="alert(1)"></svg>'); return; }
  if (path === "/forbidden") { response.statusCode = 403; response.end("Forbidden"); return; }
  if (path === "/not-html") { response.setHeader("Content-Type", "application/pdf"); response.end("%PDF-1.7"); return; }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (path === "/article") {
    response.end(`<!doctype html><html><head><title>Synthetic article</title><link rel="stylesheet" href="/must-not-load.css"><script src="/must-not-load.js"></script></head><body><nav>UNRELATED NAVIGATION</nav><article><h1>Synthetic article</h1>${paragraphs}<img src="/asset.png" alt="sample"><img src="/asset.png" onload="window.importExecuted=true"><a href="/source">explicit source link</a><a href="javascript:alert(1)">unsafe link</a><iframe src="/must-not-load-frame"></iframe><style>@import url(/must-not-load.css)</style></article></body></html>`); return;
  }
  if (path === "/wechat") { response.end(`<html><head><title>WeChat page</title></head><body><h1 id="activity-name">合成微信文章</h1><div id="js_content"><p>微信正文保留在这里。这是供本地验收使用的合成样例，内容应当与导航和页面脚本分开。</p>${paragraphs}<img data-src="/asset.png" src="/must-not-load-tracker" data-type="png"><img data-src="/bad-image" alt="失败示例"></div><aside>UNRELATED WECHAT FOOTER</aside><script>window.importExecuted=true</script></body></html>`); return; }
  if (path === "/blocked") { response.end('<html><head><title>安全验证</title></head><body><main>环境异常，请完成验证后查看文章。</main></body></html>'); return; }
  if (path === "/empty") { response.end('<html><body><div id="app"></div><script src="/must-not-load-app"></script></body></html>'); return; }
  if (path.includes("must-not-load")) { response.end("Unexpected automatic load"); return; }
  const name = path.slice(1) || "index.html";
  if (!["index.html", "fixture.js", "styles.css"].includes(name)) { response.statusCode = 404; response.end(); return; }
  response.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html");
  response.end(await readFile(join(temporary, name)));
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const session = `marginstudy-web-import-${process.pid}`;
const browser = (...args) => runBrowser(session, ...args);
try {
  await browser("open", `http://127.0.0.1:${server.address().port}`); await browser("wait", "--fn", "window.done === true");
  const result = JSON.parse((await browser("eval", "({done:window.done,fatal:window.fatal,results:window.results})")).stdout);
  result.environment = "isolated Chromium; real Readability and local HTTP; Obsidian transport/vault mocked";
  result.unexpectedAutomaticRequests = requests.filter(path => path.includes("must-not-load"));
  await writeFile(join(temporary, "results.json"), JSON.stringify(result, null, 2));
  await browser("screenshot", join(temporary, "fallback-form.png"));
  const failed = result.results?.filter(row => !row.passed) ?? [];
  console.log(`${(result.results?.length ?? 0) - failed.length}/${result.results?.length} web import acceptance groups passed`);
  console.log(`Results: ${join(temporary, "results.json")}`); console.log(`Screenshot: ${join(temporary, "fallback-form.png")}`);
  if (!result.done || result.fatal || failed.length || result.unexpectedAutomaticRequests.length) { console.error(JSON.stringify({ fatal: result.fatal, failed, unexpectedAutomaticRequests: result.unexpectedAutomaticRequests }, null, 2)); process.exitCode = 1; }
} finally { await browser("close").catch(() => {}); await new Promise(done => server.close(done)); }
