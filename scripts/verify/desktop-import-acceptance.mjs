/**
 * [INPUT]: 工作区合成宿主、真实 PDF.js、临时文件和桌面导入验收场景。
 * [OUTPUT]: A1–A5 验收结果，含落盘哈希、文档回指和 Notice。
 * [POS]: 在隔离 Chromium 会话内验证导入入口。Node 端仅开放固定夹具与临时库。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { runBrowser } from "./ego-harness.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const evidenceRoot = process.env.MARGINSTUDY_EVIDENCE_DIR;
if (!evidenceRoot || resolve(evidenceRoot).startsWith(root)) throw Error("需要仓库外的 MARGINSTUDY_EVIDENCE_DIR");
const out = resolve(evidenceRoot, "gap-06");
const scratch = await mkdtemp(join(root, "node_modules", ".desktop-import-"));
const workspace = join(root, "src/workspace");
const server = createServer();
const browser = (...args) => runBrowser(`marginstudy-desktop-import-${process.pid}`, ...args);
const permissionCodes = new Map();
const allowedSources = new Set(["/tmp"]);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const writeJson = (name, data) => writeFile(join(out, name), `${JSON.stringify(data, null, 2)}\n`);
const cases = {};
let locked;

try {
  for (const [key, name] of Object.entries({
    system: "系统 选择.pdf", plain: "plain.pdf", quoted: "路径 引号.pdf", original: "original/Same.pdf",
    duplicate: "duplicate/Same.pdf", missing: "missing.pdf", unsupported: "unsupported.xyz", locked: "locked.pdf",
    EACCES: "EACCES.pdf", EPERM: "EPERM.pdf", EIO: "EIO.pdf",
  })) {
    const path = join(scratch, "sources", name);
    await mkdir(resolve(path, ".."), { recursive: true });
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([380, 440]).drawText(`Desktop import selection: ${key}`, { x: 45, y: 385, size: 16, font });
    const bytes = await pdf.save();
    if (key !== "missing") await writeFile(path, bytes);
    allowedSources.add(path);
    cases[key] = { path, name: basename(path), sha256: sha256(bytes) };
  }
  for (const code of ["EACCES", "EPERM", "EIO"]) permissionCodes.set(cases[code].path, code);
  locked = cases.locked.path;
  await chmod(locked, 0);
  const permissionFixtureMode = (await stat(locked)).mode & 0o777;
  const vaultDir = join(scratch, "vault");
  await mkdir(vaultDir);
  const vaultFile = path => {
    if (typeof path !== "string" || !/^MarginStudyImports\/(?:[^\x00/]+\/)?[^/\x00]+$/.test(path)) throw Error("Unexpected vault path");
    const result = resolve(vaultDir, path);
    if (!result.startsWith(vaultDir + sep)) throw Error("Unexpected vault path");
    return result;
  };
  const staticFiles = new Map([
    ["/", ["index.html", "text/html"]], ["/fixture.js", ["fixture.js", "text/javascript"]],
    ["/styles.css", ["styles.css", "text/css"]],
    ["/pdf.worker.js", [join(root, "pdf.worker.js"), "text/javascript"]],
  ]);
  server.on("request", async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (staticFiles.has(pathname)) {
        const [file, type] = staticFiles.get(pathname);
        response.setHeader("Content-Type", type);
        response.end(await readFile(isAbsolute(file) ? file : join(scratch, file)));
        return;
      }
      if (pathname !== "/fixture-fs" || request.method !== "POST") { response.writeHead(404).end(); return; }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const { op, path, bytes, next } = JSON.parse(Buffer.concat(chunks).toString());
      let value;
      if (op === "stat" || op === "readFile") {
        if (!allowedSources.has(path)) throw Error(`Unexpected source path ${path}`);
        const source = await stat(path);
        if (op === "stat") value = { directory: source.isDirectory(), file: source.isFile(), mtimeMs: source.mtimeMs };
        else {
          const code = permissionCodes.get(path);
          if (code) throw Object.assign(new Error("Injected filesystem read failure"), { code });
          value = [...await readFile(path)];
        }
      } else if (op === "write") {
        const file = vaultFile(path);
        await mkdir(resolve(file, ".."), { recursive: true });
        await writeFile(file, Uint8Array.from(bytes));
      } else if (op === "rename") {
        await rename(vaultFile(path), vaultFile(next));
      } else if (op === "delete") {
        await rm(vaultFile(path), { force: true, recursive: true });
      } else if (op === "hash") {
        value = sha256(await readFile(vaultFile(path)));
      } else if (op === "clear") {
        await rm(vaultDir, { force: true, recursive: true });
        await mkdir(vaultDir);
      } else throw Error("Unexpected filesystem operation");
      response.end(JSON.stringify({ value }));
    } catch (error) {
      response.end(JSON.stringify({ error: { code: error.code, message: error.message } }));
    }
  });

  const source = await readFile(join(workspace, "acceptance-fixture.txt"), "utf8");
  const marker = source.indexOf("\nfunction mindmapScale");
  if (marker < 0) throw Error("找不到工作区夹具入口");
  const scenario = await readFile(new URL("./desktop-import-fixture.txt", import.meta.url), "utf8");
  await writeFile(join(scratch, "fixture.ts"), (source.slice(0, marker) + scenario).replaceAll("__PROJECT__", root));
  await writeFile(join(scratch, "unused.ts"), "export function request() { throw Error('Unused fixture transport'); }");
  const styles = await Promise.all(["styles.css", "src/styles/styles-reader.css", "src/styles/styles-mindmap.css", "src/styles/styles-organize.css", "src/styles/styles-workspace.css"].map(name => readFile(join(root, name), "utf8")));
  await writeFile(join(scratch, "styles.css"), styles.join("\n"));
  await writeFile(join(scratch, "index.html"), `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0;height:100%}#fixtures{height:100vh;width:100vw}.test-item-view{height:100%;width:100%;display:flex;flex-direction:column}.test-item-view>.view-content{height:100%;width:100%;overflow:hidden}</style><main id="fixtures"></main><script type="module" src="/fixture.js"></script>`);
  await build({
    entryPoints: [join(scratch, "fixture.ts")], bundle: true, platform: "browser", target: "chrome120",
    outfile: join(scratch, "fixture.js"),
    plugins: [{ name: "desktop-import-fixture", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: join(workspace, "obsidian-fixture.txt"), namespace: "fixture" }));
      builder.onResolve({ filter: /^(?:crypto|http|https)$/ }, () => ({ path: join(scratch, "unused.ts") }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, async args => ({ contents: await readFile(args.path, "utf8"), loader: "ts", resolveDir: workspace }));
    } }],
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  await browser("open", `http://127.0.0.1:${server.address().port}`);
  await browser("wait", "--fn", "typeof window.runDesktopImportAcceptance === 'function'");
  const { stdout } = await browser("eval", `window.runDesktopImportAcceptance(${JSON.stringify(cases)}, ${JSON.stringify(join(scratch, "sources"))})`);
  const result = JSON.parse(stdout);
  await chmod(locked, 0o600);
  await rm(locked);
  result.a5.permissionFixture = { mode: permissionFixtureMode, removed: await stat(locked).then(() => false, error => error.code === "ENOENT") };
  locked = undefined;
  await mkdir(out, { recursive: true });
  for (const [slot, name] of Object.entries({
    a1: "a1-system-picker-excerpt", a2: "a2-direct-path-excerpt", a3: "a3-conflict-modes",
    a4: "a4-invalid-path-errors", a5: "a5-permission-denied-errors", extra: "desktop-import-extra",
  })) {
    const group = result[slot];
    const passed = group.cases.filter(item => item.passed).length;
    const cleanupPassed = slot !== "a5" || (group.permissionFixture.mode === 0 && group.permissionFixture.removed);
    await writeJson(`${name}.json`, { ...group, passed, total: group.cases.length, cleanupPassed });
    console.log(`${slot} ${passed}/${group.cases.length}${cleanupPassed ? "" : " cleanup failed"}`);
    if (passed !== group.cases.length || !cleanupPassed) {
      console.error(group.cases.filter(item => !item.passed));
      process.exitCode = 1;
    }
  }
} finally {
  if (locked) {
    await chmod(locked, 0o600);
    await rm(locked, { force: true });
  }
  if (server.listening) {
    await browser("close").catch(() => {});
    await new Promise(done => server.close(done));
  }
  await rm(scratch, { force: true, recursive: true });
}
