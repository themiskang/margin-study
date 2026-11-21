/** Isolated synthetic reader acceptance. Never attaches to the user's Obsidian or vault. */
import { readFile, writeFile, rename, copyFile, mkdtemp, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const project = await realpath(resolve(here, "../.."));
const { runBrowser } = await import(pathToFileURL(join(project, "scripts/verify/ego-harness.mjs")).href);
const fixtureRoot = join(here, "acceptance-fixtures");
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-reader-")));
const reportPath = join(temporary, "results.json");
const pollLogPath = join(temporary, "acceptance-poll.log");
const READY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 250;
for (const name of ["harness", "obsidian", "fakePdf", "fakeMammoth", "anchorCases", "recallCases", "readerCases", "speechCases", "penCases", "notebookCases", "layerCases", "documentNotebookCases", "pageCollectionCases", "overlayCases", "cropCases", "pageEditCases", "pdfExportCases", "extendCases"]) {
  let source = (await readFile(join(fixtureRoot, name + ".txt"), "utf8")).replaceAll("__PROJECT__", () => project);
  const labels = [["Add Blank Page","添加空白页"],["Add Page From Files","从文件添加页面"],["Add Page From Photos","从相册添加页面"],["Add Page From Camera","拍照添加页面"],["Rotate Page","旋转页面"],["Add Selected","添加所选"],["Add All","全部添加"],["Close PDF Page Picker","关闭 PDF 选页"],["Cancel Camera","取消拍照"],["Capture Page","拍摄页面"],["Camera Device","相机设备"],["Done","完成"]];
  for (const [before, after] of labels) source = source.replaceAll(`aria-label="${before}"`, `aria-label="${after}"`);
  source = source.replaceAll("button(2,'Rotate Page')", "button(2,'旋转页面')").replaceAll("textContent==='Extend'", "textContent==='留白'");
  if (name === "extendCases") {
    for (const [before, after] of [["Cancel","取消"],["No","否"],["Yes","是"]]) source = source.replaceAll(`aria-label="${before}"`, `aria-label="${after}"`);
  }
  if (name === "overlayCases") source = source.replaceAll("control(dialog,'Done')", "control(dialog,'完成')");
  await writeFile(join(temporary, name + ".ts"), source);
}
await copyFile(join(fixtureRoot, "index.html"), join(temporary, "index.html"));
await copyFile(join(fixtureRoot, "synthetic.pdf"), join(temporary, "synthetic.pdf"));
await copyFile(join(project, "styles.css"), join(temporary, "styles.css"));
await copyFile(join(project, "src/styles/styles-reader.css"), join(temporary, "styles-reader.css"));
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
const pageOrigin = `http://127.0.0.1:${server.address().port}`;
// 每个进程独立 session，避免与旧的 reader/eraser 运行残留标签页或并发套件互相干扰。
const sessionPrefix = process.env.MARGINSTUDY_READER_SESSION_PREFIX || `marginstudy-reader-tests-${process.pid}`;
const session = `${sessionPrefix}-${process.pid}`;
const browser = (...args) => runBrowser(session, ...args);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const pollLog = [];
const notePoll = (message) => {
  pollLog.push(`${new Date().toISOString()} ${message}`);
  if (pollLog.length > 500) pollLog.splice(0, pollLog.length - 500);
};
async function pollLogTail(count = 20) {
  await writeFile(pollLogPath, pollLog.join("\n") + (pollLog.length ? "\n" : ""));
  return pollLog.slice(-count);
}
function resultProblems(candidate) {
  const problems = [];
  if (!candidate || typeof candidate !== "object") {
    problems.push("result object (window.done / window.fatal / window.results)");
    return problems;
  }
  if (candidate.done !== true) problems.push("done (expected window.done === true)");
  if (!Array.isArray(candidate.results)) problems.push("results (expected window.results to be an array)");
  else if (candidate.results.length === 0) problems.push("results (expected a non-empty window.results array)");
  else if (candidate.results.some((item) => !item || typeof item !== "object" || typeof item.passed !== "boolean")) problems.push("results[].passed (expected a boolean on every result)");
  if (typeof candidate.url !== "string" || !candidate.url.startsWith(pageOrigin)) problems.push(`url (expected the fixture at ${pageOrigin}, got ${String(candidate.url)})`);
  return problems;
}
async function failResultStructure(problems, observed) {
  const lastLogLines = await pollLogTail();
  console.error(JSON.stringify({
    error: "reader acceptance result is incomplete or malformed",
    missingOrInvalidFields: problems,
    file: reportPath,
    pollLog: pollLogPath,
    temporaryHarness: temporary,
    observed,
    lastLogLines,
  }, null, 2));
  process.exitCode = 1;
}
let result;
let problems = ["result (not read yet)"];
try {
  try { await browser("open", pageOrigin); }
  catch (error) { notePoll(`open failed: ${String(error?.stderr || error?.message || error)}`); }
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let attempts = 0;
  // 条件轮询：只有 done === true 且 results 为非空数组时才统计；不使用固定等待。
  while (Date.now() < deadline) {
    attempts++;
    try {
      const raw = (await browser("eval", "({url:location.href,done:window.done,fatal:window.fatal,results:window.results})")).stdout.trim();
      try { result = JSON.parse(raw); }
      catch (error) {
        result = undefined;
        problems = [`result (eval output is not valid JSON: ${String(error?.message || error)})`];
        notePoll(`attempt=${attempts} invalid JSON (${raw.length} bytes): ${raw.slice(0, 200)}`);
      }
      if (result !== undefined) {
        problems = resultProblems(result);
        if (problems.length === 0) break;
        notePoll(`attempt=${attempts} not ready: ${problems.join("; ")}`);
      }
    } catch (error) {
      problems = [`result (browser eval failed: ${String(error?.stderr || error?.message || error)})`];
      notePoll(`attempt=${attempts} eval failed: ${String(error?.stderr || error?.message || error)}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  if (problems.length !== 0) {
    await failResultStructure(problems, result);
  } else {
    result.unexpectedAutomaticResources = requests.filter((path) => path.includes("must-not-load"));
    result.environment = "isolated Chromium; synthetic files; Obsidian/Mammoth adapters mocked; real bundled PDF.js Worker";
    const reportTempPath = reportPath + ".tmp";
    await writeFile(reportTempPath, JSON.stringify(result, null, 2) + "\n");
    await rename(reportTempPath, reportPath);
    // 原子写入后回读文件，只有文件存在、可解析且结构完整时才计数，避免读到半截 JSON。
    let report;
    let readProblems = [`results file (${reportPath} not read yet)`];
    while (Date.now() < deadline) {
      try {
        const parsed = JSON.parse(await readFile(reportPath, "utf8"));
        const issues = resultProblems(parsed);
        if (issues.length === 0) { report = parsed; readProblems = []; break; }
        readProblems = issues.map((issue) => `results file ${reportPath}: ${issue}`);
      } catch (error) {
        readProblems = [`results file ${reportPath}: ${String(error?.message || error)}`];
      }
      notePoll(`results.json not complete: ${readProblems.join("; ")}`);
      await sleep(POLL_INTERVAL_MS);
    }
    if (!report) {
      await failResultStructure(readProblems, result);
    } else {
      const failed = report.results.filter((item) => !item.passed);
      if (process.env.MARGINSTUDY_READER_PREVIEW) {
        await browser("eval", process.env.MARGINSTUDY_READER_PREVIEW === "overlays" ? "window.readerOverlayShowcase()" : "window.readerShowcase()");
        const settings = process.env.MARGINSTUDY_READER_PREVIEW === "handwriting";
        if (settings) await browser("eval", 'document.querySelector("[aria-label=\\"手写画笔\\"]").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');
        const previewPath = join(temporary, settings ? "reader-handwriting-preview.png" : "reader-preview.png");
        await browser("screenshot", previewPath);
        console.log(`Synthetic preview: ${previewPath}`);
      }
      console.log(`${report.results.length - failed.length}/${report.results.length} reader acceptance groups passed`);
      console.log(`Results: ${reportPath}`);
      console.log(`Temporary harness: ${temporary}`);
      if (!report.done || report.fatal || failed.length || report.unexpectedAutomaticResources.length) {
        console.error(JSON.stringify({ fatal: report.fatal, failed, unexpectedAutomaticResources: report.unexpectedAutomaticResources }, null, 2));
        process.exitCode = 1;
      }
    }
  }
} finally {
  await browser("close").catch(() => {});
  await new Promise((done) => server.close(done));
}
