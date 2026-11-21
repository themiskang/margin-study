/** UI contracts added after the L3 audit. Runs with synthetic data in an isolated browser. */
import { readFile, writeFile, mkdtemp, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { runBrowser } from "../../scripts/verify/ego-harness.mjs";

export async function runUIAcceptance({fixtureName, prefix, label, pdfArtifactPath}) {
const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const project = await realpath(resolve(here, "../.."));
const temporary = await realpath(await mkdtemp(join(tmpdir(), `${prefix}-`)));
const fixture = await readFile(join(here, fixtureName), "utf8");
await writeFile(join(temporary, "fixture.ts"), fixture.replaceAll("__PROJECT__", project));
const obsidian = await readFile(join(project, "src/documents/acceptance-fixtures/obsidian.txt"), "utf8");
const mockedObsidian = obsidian.replace(/export class Menu \{[\s\S]*?(?=\nexport )/, `export class Menu {
  items: any[] = [];
  setUseNativeMenu(_value: boolean) { return this; }
  hidden: () => void = () => {};
  hide() { document.querySelector('#test-menu')?.remove(); this.hidden(); return this; }
  onHide(callback: () => void) { this.hidden = callback; }
  addItem(cb: any) { const item: any = {title:'',disabled:false,action:()=>{},setTitle(value:any){this.title=value;return this;},setDisabled(value:any){this.disabled=value;return this;},setChecked(value:any){this.checked=value;return this;},setIsLabel(value:any){this.isLabel=value;return this;},onClick(value:any){this.action=value;return this;}};cb(item);this.items.push(item);return this; }
  addSeparator() { return this; }
  showAtMouseEvent() { document.querySelector('#test-menu')?.remove(); const menu=document.createElement('div');menu.id='test-menu';menu.setAttribute('role','menu');for(const item of this.items){const button=document.createElement('button');button.textContent=item.title;button.disabled=item.disabled;button.setAttribute('aria-checked',String(!!item.checked));button.onclick=(event)=>{menu.remove();item.action(event);};menu.append(button);}document.body.append(menu); }
  showAtPosition() { this.showAtMouseEvent(); }
}`).replace(/export function setIcon\([\s\S]*?(?=\nexport )/, `export function setIcon(element: HTMLElement, icon: string) {
  const paths: Record<string,string> = {
    list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    'panels-top-left':'M3 3h18v18H3zM3 10h18M10 10v11',hand:'M8 13V6a2 2 0 0 1 4 0v6V3a2 2 0 0 1 4 0v9V7a2 2 0 0 1 4 0v8c0 4-2 7-6 7h-2c-3 0-4-2-6-5l-3-4a2 2 0 0 1 3-3l2 3',
    spline:'M4 4c14-7 14 20 1 15C-1 15 14 7 19 16c5 7 4-14 1-12',filter:'M3 4h18l-7 8v8l-4-2v-6z',
    scissors:'M8 8L20 20M8 16L20 4M6 3a3 3 0 1 0 0 6a3 3 0 0 0 0-6M6 15a3 3 0 1 0 0 6a3 3 0 0 0 0-6',
    copy:'M8 8h12v13H8zM16 8V3H3v13h5',palette:'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4c-1-1 0-3 2-3h2a3 3 0 0 0 3-3a9 9 0 0 0-9-8M7 9h.01M10 6h.01M15 6h.01M18 9h.01',
    tag:'M3 3h8l10 10l-8 8L3 11zM7 7h.01',link:'M10 13l4-4M8 15l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M14 9l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
    brackets:'M8 3H4v18h4M16 3h4v18h-4',network:'M9 2h6v6H9zM2 16h6v6H2zM16 16h6v6h-6zM12 8v4M5 16v-4h14v4',combine:'M3 3h6v6H3zM15 15h6v6h-6zM9 9l6 6M4 15v5h5M15 4h5v5',
    'trash-2':'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',ellipsis:'M5 12h.01M12 12h.01M19 12h.01',x:'M5 5l14 14M19 5L5 19'
  };
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[icon]||paths.ellipsis);svg.append(path);element.setAttribute('data-icon',icon);element.replaceChildren(svg);
}`);
await writeFile(join(temporary, "obsidian.ts"), mockedObsidian);
await writeFile(join(temporary, "index.html"), '<!doctype html><meta charset="utf-8"><title>MarginStudy UI acceptance</title><link rel="stylesheet" href="/styles.css"><body><main id="fixtures" style="height:95vh;background:#fff;color:#17252a"></main><script type="module" src="/fixture.js"></script>');
await writeFile(join(temporary, "styles.css"), [await readFile(join(project, "styles.css"), "utf8"), await readFile(join(project, "src/styles/styles-mindmap.css"), "utf8"), await readFile(join(project, "src/styles/styles-organize.css"), "utf8")].join("\n"));
await writeFile(join(temporary, "unused-network.ts"), "export function request(){throw new Error('AI network transport is outside this UI fixture');}\nexport function get(){}");
await build({ entryPoints: [join(temporary, "fixture.ts")], bundle: true, platform: "browser", format: "esm", target: "chrome120", outfile: join(temporary, "fixture.js"),
  plugins: [{ name: "synthetic-obsidian", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: join(temporary, "obsidian.ts") }));
    builder.onResolve({ filter: /^crypto$/ }, () => ({ path: "unused-crypto", namespace: "synthetic" }));
    builder.onResolve({ filter: /^(?:http|https|node:http|node:https)$/ }, () => ({ path: join(temporary, "unused-network.ts") }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: "export function createHash() { throw new Error('Hashing is outside this UI fixture'); }", loader: "js" }));
  } }] });
const allowed = new Set(["index.html", "fixture.js", "styles.css"]);
const server = createServer(async (request, response) => {
  const name = new URL(request.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
  if (!allowed.has(name)) { response.statusCode = 404; response.end(); return; }
  response.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
  response.end(await readFile(join(temporary, name)));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const session = `${prefix}-${process.pid}`;
const browser = (...args) => runBrowser(session, ...args);
try {
  await browser("open", `http://127.0.0.1:${server.address().port}`);
  await browser("wait", "--fn", "window.done === true");
  const result = JSON.parse((await browser("eval", "({done:window.done,fatal:window.fatal,results:window.results})")).stdout);
  if(pdfArtifactPath && !result.fatal && result.results?.every(item=>item.passed)) {
    const encoded=JSON.parse((await browser("eval", "window.cardFlowPdf")).stdout);
    await writeFile(resolve(project,pdfArtifactPath),Buffer.from(encoded,"base64"));
  }
  result.environment = "isolated Chromium; synthetic in-memory Store; mocked Obsidian UI";
  await writeFile(join(temporary, "results.json"), JSON.stringify(result, null, 2));
  await browser("screenshot", join(temporary, "ui.png"));
  const scenes = JSON.parse((await browser("eval", "window.acceptanceScenes || []")).stdout);
  for (const scene of scenes) {
    if (!/^[a-z0-9-]+$/.test(scene)) throw new Error("Invalid scene name");
    await browser("eval", `window.showAcceptanceScene(${JSON.stringify(scene)})`);
    await browser("screenshot", join(temporary, `${scene}.png`));
  }
  const failed = result.results?.filter((item) => !item.passed) ?? [];
  console.log(`${result.results?.length - failed.length}/${result.results?.length} ${label} UI checks passed`);
  console.log(`Results: ${join(temporary, "results.json")}`);
  console.log(`Screenshot: ${join(temporary, "ui.png")}`);
  if (result.fatal || !result.done || failed.length) { console.error(JSON.stringify({ fatal: result.fatal, failed }, null, 2)); process.exitCode = 1; }
} finally {
  await browser("close").catch(() => {});
  await new Promise((done) => server.close(done));
}

}
