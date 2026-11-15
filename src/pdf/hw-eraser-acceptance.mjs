import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const documents = resolve(here, "../documents");
const fixture = await readFile(resolve(here, "hw-eraser-fixture.txt"), "utf8");
let runner = await readFile(resolve(documents, "acceptance.mjs"), "utf8");
runner = runner.replace('from "esbuild"', `from ${JSON.stringify(import.meta.resolve("esbuild"))}`);
runner = runner.replace('const here = dirname(fileURLToPath(import.meta.url));', `const here = ${JSON.stringify(documents)};`);
process.env.MARGINSTUDY_READER_SESSION_PREFIX = `marginstudy-pdf-eraser-${process.pid}`;
runner = runner.replace('const source = (await readFile(join(fixtureRoot, name + ".txt"), "utf8")).split(sampleRoot).join(project);',
  () => `let source = (await readFile(join(fixtureRoot, name + ".txt"), "utf8")).split(sampleRoot).join(project);
  if (name === "penCases") source = source.replace("export async function runPenAcceptance({test,assert,wait,plugin,add,app,htmlController}:any){", "$&\\n" + ${JSON.stringify(fixture)});`);
await import("data:text/javascript," + encodeURIComponent(runner));
