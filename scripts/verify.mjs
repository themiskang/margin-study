// All fixtures are synthetic. This runner never installs into an Obsidian vault.
import {spawn} from "node:child_process";
import {mkdir,writeFile} from "node:fs/promises";
import {fileURLToPath,pathToFileURL} from "node:url";
import {resolve,relative,sep} from "node:path";
import {tmpdir} from "node:os";
const root=fileURLToPath(new URL("../",import.meta.url));
// 证据护栏：默认写到临时目录，禁止默认覆盖 evidence/（2026-11-06 事故：14 个套件日志被覆盖）。
const defaultDir=`${tmpdir()}${sep}marginstudy-verify-${Date.now()}`;
const outDir=resolve(root,process.env.MARGINSTUDY_VERIFY_DIR||defaultDir);
if(outDir.startsWith(resolve(root,"evidence")+sep)&&process.env.MARGINSTUDY_ALLOW_EVIDENCE!=="1")throw new Error(`拒绝写入 evidence/：${relative(root,outDir)}；如确有需要设 MARGINSTUDY_ALLOW_EVIDENCE=1`);
const output=pathToFileURL(outDir+sep);
await mkdir(output,{recursive:true});
console.log(`verify output: ${relative(root,outDir)}`);
const allSuites=[
  ["typecheck","node_modules/typescript/bin/tsc","--noEmit"],
  ["build","esbuild.config.mjs","production"],
  ["pdf-save","scripts/pdf-save-acceptance.mjs"],
  ["review","src/review/acceptance.mjs","--audit"],
  ["pending","src/review/pending-acceptance.mjs"],
  ["decks","src/review/deck-acceptance.mjs"],
  ["review-a20","src/review/a20-acceptance.mjs"],
  ["model-l3","src/model/l3-acceptance.mjs"],
  ["drag-save","src/model/drag-save-acceptance.mjs"],
  ["media-migration","src/model/media-migration-acceptance.mjs"],
  ["model-additive","src/model/additive-acceptance.mjs"],
  ["mobile-sha256","src/model/sha256-acceptance.mjs"],
  ["study","src/study/acceptance.mjs"],
  ["study-ui","src/study/l3-ui-acceptance.mjs"],
  ["study-observed-ui","src/study/l4-ui-acceptance.mjs"],
  ["card-ink-ui","src/study/a16-ui-acceptance.mjs"],
  ["organize-ui","src/study/organize-ui-acceptance.mjs"],
  ["review-ui","src/review/ui-acceptance.mjs"],
  ["reader","src/documents/acceptance.mjs"],
  ["web-import","src/import/acceptance.mjs"],
  ["workspace","src/workspace/acceptance.mjs"],
  ["workspace-scenes","src/workspace/scene-acceptance.mjs"],
  ["mindmap-layout","src/mindmap/layout-acceptance.mjs"],
  ["mindmap-ink-export","src/mindmap/handwriting-acceptance.mjs"],
  ["card-flow","src/export/cardFlow-acceptance.mjs"],
  ["ai","src/ai/acceptance.mjs"],
  ["ai-a23","src/ai/a23-acceptance.mjs"],
  ["ai-a24","src/ai/a24-acceptance.mjs"],
  ["ai-condense","src/ai/condense-acceptance.mjs"],
  ["claudian","src/ai/claudian-acceptance.mjs"],
  ["ai-ui","src/ai/ui-acceptance.mjs"],
  ["research","src/research/acceptance.mjs"],
  ["search-features","src/search/feature-acceptance.mjs"],
  ["apkg","src/export/apkg-acceptance.mjs"],
];
const selected=process.argv.slice(2);
if(selected.some(name=>!allSuites.some(suite=>suite[0]===name)))throw new Error("Unknown suite: "+selected.filter(name=>!allSuites.some(suite=>suite[0]===name)).join(", "));
const suites=selected.length?allSuites.filter(suite=>selected.includes(suite[0])):allSuites;
const result={startedAt:new Date().toISOString(),scope:"development copy; synthetic fixtures; real native-app evidence is documented separately",completeRun:!selected.length,suites:[]};
for(const [name,...args] of suites) {
  const start=Date.now();let stdout="",stderr="";
  const code=await new Promise((done,reject)=>{const child=spawn(process.execPath,args,{cwd:root});child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);child.once("error",reject);child.once("close",done);});
  await writeFile(new URL(name+".log",output),stdout+(stderr?"\nSTDERR\n"+stderr:""));
  result.suites.push({name,args,exitCode:code,elapsedMs:Date.now()-start,log:relative(root,fileURLToPath(new URL(name+".log",output)))});
  console.log(`${code===0?"PASS":"FAIL"} ${name} (${((Date.now()-start)/1000).toFixed(1)}s)`);
  const counts=stdout.match(/^.*\d+\s*\/\s*\d+.*$/gm);if(counts)console.log(counts.join("\n"));
  if(code!==0){process.exitCode=1;break;}
}
result.completedAt=new Date().toISOString();result.passed=result.suites.length===suites.length&&result.suites.every(suite=>suite.exitCode===0);
await writeFile(new URL("results.json",output),JSON.stringify(result,null,2)+"\n");
