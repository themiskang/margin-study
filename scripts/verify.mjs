/**
 * [INPUT]: 验收套件入口、运行模式与公开套件下限。
 * [OUTPUT]: 套件日志、三态验收结果与 CI 摘要。
 * [POS]: 构建门禁与验收套件的统一入口。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import {spawn} from "node:child_process";
import {appendFile,mkdir,readFile,writeFile} from "node:fs/promises";
import {fileURLToPath,pathToFileURL} from "node:url";
import {resolve,relative,sep} from "node:path";
import {tmpdir} from "node:os";
import {missingPrivateFixture,missingPrivateFixtureExitCode,privateFixture,requirePrivateFixture} from "./verify/fixtures.mjs";
const root=fileURLToPath(new URL("../",import.meta.url));
// 证据护栏：默认写到临时目录，禁止默认覆盖 evidence/（2026-11-06 事故：14 个套件日志被覆盖）。
const defaultDir=`${tmpdir()}${sep}marginstudy-verify-${Date.now()}`;
const outDir=resolve(root,process.env.MARGINSTUDY_VERIFY_DIR||defaultDir);
if(outDir.startsWith(resolve(root,"evidence")+sep)&&process.env.MARGINSTUDY_ALLOW_EVIDENCE!=="1")throw new Error(`拒绝写入 evidence/：${relative(root,outDir)}；如确有需要设 MARGINSTUDY_ALLOW_EVIDENCE=1`);
const output=pathToFileURL(outDir+sep);
await mkdir(output,{recursive:true});
console.log(`verify output: ${relative(root,outDir)}`);
const automatedSuites=[
  ["typecheck","node_modules/typescript/bin/tsc","--noEmit"],
  ["build","esbuild.config.mjs","production"],
  ["build-determinism","scripts/verify/build-determinism-acceptance.mjs"],
  ["pdf-save","scripts/verify/pdf-save-acceptance.mjs"],
  ["pdf-hw-eraser","src/pdf/hw-eraser-acceptance.mjs"],
  ["word-hw-eraser","src/word/hw-eraser-acceptance.mjs"],
  ["review","src/review/acceptance.mjs","--audit"],
  ["pending","src/review/pending-acceptance.mjs"],
  ["decks","src/review/deck-acceptance.mjs"],
  ["review-a20","src/review/a20-acceptance.mjs"],
  ["review-a21","src/review/a21-acceptance.mjs"],
  ["model-l3","src/model/l3-acceptance.mjs"],
  ["drag-save","src/model/drag-save-acceptance.mjs"],
  ["media-migration","src/model/media-migration-acceptance.mjs"],
  ["model-additive","src/model/additive-acceptance.mjs"],
  ["model-duplicate-ids","src/model/duplicate-ids-acceptance.mjs"],
  ["model-a28","src/model/a28-acceptance.mjs"],
  ["model-schema-migration","src/model/schema-migration-acceptance.mjs"],
  ["merge-d4-02-concurrent-writes","scripts/verify/annotation-merge-d4/02-concurrent-writes.mjs"],
  ["merge-d4-02b-same-pen-concurrent-edit","scripts/verify/annotation-merge-d4/02b-same-pen-concurrent-edit.mjs"],
  ["merge-d4-03-recovery-same-store","scripts/verify/annotation-merge-d4/03-recovery-same-store.mjs"],
  ["merge-d4-04-shared-host-replay","scripts/verify/annotation-merge-d4/04-shared-host-replay.mjs"],
  ["merge-d4-05-shared-pen-single-unbind","scripts/verify/annotation-merge-d4/05-shared-pen-single-unbind.mjs"],
  ["merge-d4-07-forked-host-keeps-remote-pen","scripts/verify/annotation-merge-d4/07-forked-host-keeps-remote-pen.mjs"],
  ["merge-d4-key-order-invariance","scripts/verify/annotation-merge-d4/key-order-invariance.mjs"],
  ["status-a28-ui","src/documents/a28-ui-acceptance.mjs"],
  ["mobile-sha256","src/model/sha256-acceptance.mjs"],
  ["study","src/study/acceptance.mjs"],
  ["study-ui","src/study/l3-ui-acceptance.mjs"],
  ["study-observed-ui","src/study/l4-ui-acceptance.mjs"],
  ["card-ink-ui","src/study/a16-ui-acceptance.mjs"],
  ["organize-ui","src/study/organize-ui-acceptance.mjs"],
  ["review-ui","src/review/ui-acceptance.mjs"],
  ["review-long","src/review/long-card-acceptance.mjs"],
  ["reader","src/documents/acceptance.mjs"],
  ["web-import","src/import/acceptance.mjs"],
  ["import-a29","src/import/a29-acceptance.mjs"],
  ["baidu-netdisk","src/import/baiduNetdisk-acceptance.mjs"],
  ["workspace","src/workspace/acceptance.mjs"],
  ["workspace-scenes","src/workspace/scene-acceptance.mjs"],
  ["workspace-occlusion-default","src/workspace/occlusion-default-acceptance.mjs"],
  ["workspace-a26","src/workspace/a26-acceptance.mjs"],
  ["mindmap-layout","src/mindmap/layout-acceptance.mjs"],
  ["mindmap-a18","src/mindmap/a18-acceptance.mjs"],
  ["mindmap-a19","src/mindmap/a19-acceptance.mjs"],
  ["mindmap-ink-export","src/mindmap/handwriting-acceptance.mjs"],
  ["card-flow","src/export/cardFlow-acceptance.mjs"],
  ["ai","src/ai/acceptance.mjs"],
  ["ai-a23","src/ai/a23-acceptance.mjs"],
  ["ai-a24","src/ai/a24-acceptance.mjs"],
  ["ai-a27","src/ai/a27-acceptance.mjs"],
  ["ai-condense","src/ai/condense-acceptance.mjs"],
  ["claudian","src/ai/claudian-acceptance.mjs"],
  ["ai-ui","src/ai/ui-acceptance.mjs"],
  ["research","src/research/acceptance.mjs"],
  ["search-features","src/search/feature-acceptance.mjs"],
  ["search-global","src/search/global-acceptance.mjs"],
  ["apkg","src/export/apkg-acceptance.mjs"],
  ["study-set-export","src/export/studySet-acceptance.mjs"],
  ["study-set-export-ui","src/export/studySet-ui-acceptance.mjs"],
  ["study-set-import","src/export/studySetImport-acceptance.mjs"],
];
const replaySuites=[
  ["document-more","scripts/verify/compare-document-more-evidence.py"],
  ["navigation","scripts/verify/compare-navigation-evidence.py"],
  ["pdf-crop","scripts/verify/compare-pdf-crop-evidence.py"],
  ["pen-undo","scripts/verify/compare-pen-undo-evidence.py"],
  ["read-settings","scripts/verify/compare-read-settings-evidence.py"],
];
const options=process.argv.slice(2);
const strict=options.includes("--strict")||process.env.VERIFY_STRICT==="1";
const replay=options.includes("--replay");
const publicRun=options.includes("--public")&&!replay;
const selected=options.filter(option=>!["--strict","--public","--replay"].includes(option));
const allSuites=replay?replaySuites:automatedSuites;
if(selected.some(name=>!allSuites.some(suite=>suite[0]===name)))throw new Error("Unknown suite: "+selected.filter(name=>!allSuites.some(suite=>suite[0]===name)).join(", "));
const suites=selected.length?allSuites.filter(suite=>selected.includes(suite[0])):allSuites;
const mode=replay?(strict?"replay-strict":"replay"):strict?"strict":publicRun?"public":"default";
const result={startedAt:new Date().toISOString(),scope:replay?"saved native evidence":"automated acceptance",mode,completeRun:!selected.length,suites:[]};
const executable=replay?"python3":process.execPath;
const env=replay?{...process.env,MARGINSTUDY_EVIDENCE_DIR:privateFixture(""),MARGINSTUDY_REPLAY_REPORT_DIR:outDir}:process.env;
for(const [name,...suiteArgs] of suites) {
  const args=replay?["-B","scripts/verify/replay_support.py",...suiteArgs]:suiteArgs;
  const start=Date.now();let stdout="",stderr="";
  const code=await new Promise(done=>{
    const child=spawn(executable,args,{cwd:root,env});
    child.stdout.on("data",chunk=>stdout+=chunk);
    child.stderr.on("data",chunk=>stderr+=chunk);
    child.once("error",error=>{stderr+=String(error);done(1);});
    child.once("close",done);
  });
  let status=code===0?"passed":"failed";
  let missingPath;
  if(replay&&code===missingPrivateFixtureExitCode){
    try {
      const {missingPrivateFixture: path}=JSON.parse(stdout);
      if(typeof path!=="string"||!path)throw new Error("Replay did not report a missing fixture path");
      missingPath=path;
      if(requirePrivateFixture(path,name,strict)===missingPrivateFixture)status="skipped";
      else stderr+=`${name}: fixture became available during replay (${path})`;
    } catch(error) {
      stderr+=error.message;
    }
  }
  const logFile=new URL(name+".log",output);
  await writeFile(logFile,stdout+(stderr?"\nSTDERR\n"+stderr+"\n":""));
  result.suites.push({name,args,status,exitCode:status==="failed"&&missingPath?1:code,elapsedMs:Date.now()-start,log:relative(root,fileURLToPath(logFile)),...(missingPath?{missingPrivateFixture:missingPath}:{})});
  if(status!=="skipped")console.log(`${status==="passed"?"PASS":"FAIL"} ${name} (${((Date.now()-start)/1000).toFixed(1)}s)`);
  const counts=stdout.match(/^.*\d+\s*\/\s*\d+.*$/gm);if(counts)console.log(counts.join("\n"));
  if(status==="failed"&&stderr)console.error(stderr.trimEnd());
}
const counts={passed:0,skipped:0,failed:0,total:result.suites.length};
for(const suite of result.suites)counts[suite.status]++;
let publicFloorMet=true;
if(publicRun&&!selected.length){
  const {minimumPassed}=JSON.parse(await readFile(new URL("./verify/public-baseline.json",import.meta.url),"utf8"));
  publicFloorMet=counts.passed>=minimumPassed;
  if(!publicFloorMet)console.error(`FAIL public suite floor: ${counts.passed} passed, expected at least ${minimumPassed}`);
}
result.counts=counts;
result.completedAt=new Date().toISOString();
result.passed=counts.failed===0&&publicFloorMet;
console.log(`passed: ${counts.passed} / skipped (missing private fixtures): ${counts.skipped} / failed: ${counts.failed} / total: ${counts.total}`);
if(!result.passed)process.exitCode=1;
await writeFile(new URL("results.json",output),JSON.stringify(result,null,2)+"\n");
if(publicRun&&process.env.GITHUB_STEP_SUMMARY){
  await appendFile(process.env.GITHUB_STEP_SUMMARY,[
    "| Passed | Skipped (private) | Failed | Total |",
    "| ---: | ---: | ---: | ---: |",
    `| ${counts.passed} | ${counts.skipped} | ${counts.failed} | ${counts.total} |`,
    "",
  ].join("\n"));
}
