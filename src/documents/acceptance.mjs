/** Isolated synthetic reader acceptance. Never attaches to the user's Obsidian or vault. */
import { readFile, writeFile, copyFile, mkdtemp, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const project = await realpath(resolve(here, "../.."));
const fixtureRoot = join(here, "acceptance-fixtures");
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-reader-")));
const sampleRoot = "/Users/tanlihen/Documents/Qoder/2026-10-14/d20fd1f9/MarginStudy开发";
for (const name of ["harness", "obsidian", "fakePdf", "fakeMammoth", "anchorCases", "recallCases", "readerCases", "speechCases", "penCases", "notebookCases", "layerCases", "documentNotebookCases", "pageCollectionCases", "overlayCases", "cropCases", "pageEditCases", "pdfExportCases", "extendCases"]) {
  const source = (await readFile(join(fixtureRoot, name + ".txt"), "utf8")).split(sampleRoot).join(project);
  await writeFile(join(temporary, name + ".ts"), source);
}
await copyFile(join(fixtureRoot, "index.html"), join(temporary, "index.html"));
await copyFile(join(fixtureRoot, "synthetic.pdf"), join(temporary, "synthetic.pdf"));
await copyFile(join(project, "styles.css"), join(temporary, "styles.css"));
await copyFile(join(project, "styles-reader.css"), join(temporary, "styles-reader.css"));
await copyFile(join(project, "pdf.worker.js"), join(temporary, "pdf.worker.js"));
await writeFile(join(temporary,"unused-network.ts"), "export function request(){throw new Error('AI network is outside isolated reader fixture');}");
await build({ entryPoints: [join(temporary, "harness.ts")], bundle: true, platform: "browser", format: "iife", target: "chrome120",
  outfile: join(temporary, "harness.js"), external: ["canvas"], plugins: [{ name: "isolated-test-adapters", setup(builder) {
    builder.onResolve({ filter: /^marginstudy-real-reader$/ }, () => ({ path: "real-reader", namespace: "real-reader" }));
    builder.onLoad({ filter: /.*/, namespace: "real-reader" }, async () => ({
      contents: (await readFile(join(project, "src/pdf/readerView.ts"), "utf8")).replace('from "./pdfjs"', 'from ' + JSON.stringify(join(project, "src/pdf/pdfjs.ts"))),
      loader: "ts", resolveDir: join(project, "src/pdf"),
    }));
    builder.onResolve({filter:/^(http|https)$/},()=>({path:join(temporary,"unused-network.ts")}));
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: join(temporary, "obsidian.ts") }));
    builder.onResolve({ filter: /^mammoth$/ }, () => ({ path: join(temporary, "fakeMammoth.ts") }));
    builder.onResolve({ filter: /^\.\/pdfjs$/ }, (args) => args.importer.endsWith("/readerView.ts") ? { path: join(temporary, "fakePdf.ts") } : null);
  } }] });

const requests = [];
const allowed = new Set(["index.html", "harness.js", "styles.css", "styles-reader.css", "pdf.worker.js", "synthetic.pdf"]);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  requests.push(pathname);
  const name = pathname === "/" ? "index.html" : pathname.slice(1);
  if (pathname.startsWith("/asset/")) {
    response.setHeader("Content-Type", "image/png");
    response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64")); return;
  }
  if (!allowed.has(name)) { response.statusCode = 404; response.end(); return; }
  try {
    response.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : name.endsWith(".pdf") ? "application/pdf" : "text/html; charset=utf-8");
    response.end(await readFile(join(temporary, name)));
  } catch { response.statusCode = 500; response.end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const session = (await exec("agent-browser", ["session", "id", "--scope", "worktree", "--prefix", "marginstudy-reader-tests"], { cwd: project })).stdout.trim();
const browser = (...args) => exec("agent-browser", ["--session", session, ...args], { cwd: project, maxBuffer: 8 * 1024 * 1024 });
let result;
try {
  await browser("open", `http://127.0.0.1:${server.address().port}`);
  const deadline = Date.now() + 90_000;
  do {
    result = JSON.parse((await browser("eval", "({done:window.done,fatal:window.fatal,results:window.results})")).stdout);
    if (result.done) break;
    await new Promise((done) => setTimeout(done, 400));
  } while (Date.now() < deadline);
  result.unexpectedAutomaticResources = requests.filter((path) => path.includes("must-not-load"));
  result.environment = "isolated Chromium; synthetic files; Obsidian/Mammoth adapters mocked; real bundled PDF.js Worker";
  const reportPath = join(temporary, "results.json");
  await writeFile(reportPath, JSON.stringify(result, null, 2));
  const failed = result.results?.filter((item) => !item.passed) ?? [];
  if (process.env.MARGINSTUDY_READER_PREVIEW) {
    await browser("eval", process.env.MARGINSTUDY_READER_PREVIEW === "overlays" ? "window.readerOverlayShowcase()" : "window.readerShowcase()");
    const settings = process.env.MARGINSTUDY_READER_PREVIEW === "handwriting";
    if (settings) await browser("eval", 'document.querySelector("[aria-label=\\"手写画笔\\"]").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');
    const previewPath = join(temporary, settings ? "reader-handwriting-preview.png" : "reader-preview.png");
    await browser("screenshot", previewPath);
    console.log(`Synthetic preview: ${previewPath}`);
  }
  console.log(`${result.results?.length - failed.length}/${result.results?.length} reader acceptance groups passed`);
  console.log(`Results: ${reportPath}`);
  console.log(`Temporary harness: ${temporary}`);
  if (!result.done || result.fatal || failed.length || result.unexpectedAutomaticResources.length) {
    console.error(JSON.stringify({ fatal: result.fatal, failed, unexpectedAutomaticResources: result.unexpectedAutomaticResources }, null, 2));
    process.exitCode = 1;
  }
} finally {
  await browser("close").catch(() => {});
  await new Promise((done) => server.close(done));
}
