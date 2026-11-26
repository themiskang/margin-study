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
  ["ego-harness-parity","scripts/verify/ego-harness-parity-acceptance.mjs"],
  ["pdf-save","scripts/verify/pdf-save-acceptance.mjs"],
  ["pdf-pinch-zoom","scripts/verify/pdf-pinch-zoom-acceptance.mjs"],
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
  ["refs-b4-01-load","scripts/verify/annotation-refs/b4-01-load.mjs"],
  ["refs-b4-02-retain-and-render","scripts/verify/annotation-refs/b4-02-retain-and-render.mjs"],
  ["refs-b4-03-switch-layer","scripts/verify/annotation-refs/b4-03-switch-layer.mjs"],
  ["refs-b4-04-export","scripts/verify/annotation-refs/b4-04-export.mjs"],
  ["refs-b4-05-shared-missing-layer","scripts/verify/annotation-refs/b4-05-shared-missing-layer.mjs"],
  ["refs-b4-06-rebind-and-delete","scripts/verify/annotation-refs/b4-06-rebind-and-delete.mjs"],
  ["refs-b5-01-counts","scripts/verify/annotation-refs/b5-01-counts.mjs"],
  ["refs-b5-02-old-key","scripts/verify/annotation-refs/b5-02-old-key.mjs"],
  ["refs-b5-03-binding","scripts/verify/annotation-refs/b5-03-binding.mjs"],
  ["refs-b5-04-target-conflict","scripts/verify/annotation-refs/b5-04-target-conflict.mjs"],
  ["refs-b5-05-rollback","scripts/verify/annotation-refs/b5-05-rollback.mjs"],
  ["refs-b5-06-two-moves","scripts/verify/annotation-refs/b5-06-two-moves.mjs"],
  ["refs-b5-07-draft-survives-rename","scripts/verify/annotation-refs/b5-07-draft-survives-rename.mjs"],
  ["refs-b5-08-merge-tx-survives-rename","scripts/verify/annotation-refs/b5-08-merge-tx-survives-rename.mjs"],
  ["refs-b5-09-prefix-collision","scripts/verify/annotation-refs/b5-09-prefix-collision.mjs"],
  ["refs-b5-10-same-count-corrupted-content","scripts/verify/annotation-refs/invariant-r/b5-10-same-count-corrupted-content.mjs"],
  ["refs-b5-11-quota-prune-other-doc","scripts/verify/annotation-refs/invariant-r/b5-11-quota-prune-other-doc.mjs"],
  ["refs-b5-12-startup-read-error-keeps-log","scripts/verify/annotation-refs/invariant-r/b5-12-startup-read-error-keeps-log.mjs"],
  ["refs-b5-13-folder-move-external-sidecar","scripts/verify/annotation-refs/invariant-r/b5-13-folder-move-external-sidecar.mjs"],
  ["refs-b5-14-rename-rollback-durable","scripts/verify/annotation-refs/invariant-r/b5-14-rename-rollback-durable.mjs"],
  ["refs-b5-15-cold-start-two-branches","scripts/verify/annotation-refs/invariant-r/b5-15-cold-start-two-branches.mjs"],
  ["refs-b5-16-proof-from-disk-not-memory","scripts/verify/annotation-refs/invariant-r/b5-16-proof-from-disk-not-memory.mjs"],
  ["refs-b5-17-merge-short-key-collision","scripts/verify/annotation-refs/invariant-r/b5-17-merge-short-key-collision.mjs"],
  ["refs-b5-18-merge-silent-write-loss","scripts/verify/annotation-refs/invariant-r/b5-18-merge-silent-write-loss.mjs"],
  ["refs-b5-19-tombstone-gc-requires-proof","scripts/verify/annotation-refs/invariant-r/b5-19-tombstone-gc-requires-proof.mjs"],
  ["refs-b5-20-disk-proof-checks-local-events","scripts/verify/annotation-refs/invariant-r/b5-20-disk-proof-checks-local-events.mjs"],
  ["refs-b5-21-sidecar-rollback-silent-write-loss","scripts/verify/annotation-refs/invariant-r/b5-21-sidecar-rollback-silent-write-loss.mjs"],
  ["refs-b5-22-tombstone-cross-tx-proof","scripts/verify/annotation-refs/invariant-r/b5-22-tombstone-cross-tx-proof.mjs"],
  ["refs-b5-23-guard-bypass-forms","scripts/verify/annotation-refs/invariant-r/b5-23-guard-bypass-forms.mjs"],
  ["refs-b5-24-rollback-cross-writer","scripts/verify/annotation-refs/invariant-r/b5-24-rollback-cross-writer.mjs"],
  ["refs-b5-25-guard-controls","scripts/verify/annotation-refs/invariant-r/b5-25-guard-controls.mjs"],
  ["refs-b5-26-sidecar-scope","scripts/verify/annotation-refs/invariant-r/b5-26-sidecar-scope.mjs"],
  ["refs-b6-01-deleted-host-not-exported","scripts/verify/annotation-refs/export-roundtrip/b6-01-deleted-host-not-exported.mjs"],
  ["refs-b6-02-opacity-contract","scripts/verify/annotation-refs/export-roundtrip/b6-02-opacity-contract.mjs"],
  ["refs-b6-03-transform-after-move-scale","scripts/verify/annotation-refs/export-roundtrip/b6-03-transform-after-move-scale.mjs"],
  ["refs-b6-04-same-pipeline","scripts/verify/annotation-refs/export-roundtrip/b6-04-same-pipeline.mjs"],
  ["refs-b7-01-roundtrip-diff-zero","scripts/verify/annotation-refs/export-roundtrip/b7-01-roundtrip-diff-zero.mjs"],
  ["refs-b7-02-explicit-false-preserved","scripts/verify/annotation-refs/export-roundtrip/b7-02-explicit-false-preserved.mjs"],
  ["refs-b7-03-cross-vault-missing-refs","scripts/verify/annotation-refs/export-roundtrip/b7-03-cross-vault-missing-refs.mjs"],
  ["recovery-delete-guard","scripts/verify/recovery-delete-guard.mjs"],
  ["reference-opacity-guard","scripts/verify/reference-opacity-guard.mjs"],
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
  ["workspace-clean-view-template","scripts/verify/clean-view-template-acceptance.mjs"],
  ["workspace-clean-view","scripts/verify/clean-view-acceptance.mjs"],
  ["pad-toolbar-layout","scripts/verify/pad-toolbar-layout-acceptance.mjs"],
  ["yan-r2-r10-surfaces","scripts/verify/yan-r2-r10-surfaces-acceptance.mjs"],
  ["anchor-lifecycle-navigation","scripts/verify/anchor-lifecycle-navigation-acceptance.mjs"],
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
  ["lasso-model-binding","scripts/verify/lasso-model-binding-acceptance.mjs"],
  ["lasso-ui-workflow","scripts/verify/lasso-ui-workflow-acceptance.mjs"],
  ["merge-annotation-parity","scripts/verify/merge-annotation-parity-acceptance.mjs"],
  ["merge-document-undo","scripts/verify/merge-document-undo-acceptance.mjs"],
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
