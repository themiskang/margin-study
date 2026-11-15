/** Isolated research behavior; simulated webview, no external sites/accounts or real vault. */
import { readFile, writeFile, mkdtemp, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { runBrowser } from "../../scripts/ego-harness.mjs";
const exec=promisify(execFile),here=dirname(fileURLToPath(import.meta.url)),project=await realpath(resolve(here,"../..")),temporary=await realpath(await mkdtemp(join(tmpdir(),"marginstudy-research-")));
await writeFile(join(temporary,"fixture.ts"),(await readFile(join(here,"acceptance-fixture.txt"),"utf8")).replaceAll("__PROJECT__",project));
await writeFile(join(temporary,"obsidian.ts"),await readFile(join(project,"src/workspace/obsidian-fixture.txt"),"utf8"));
await writeFile(join(temporary,"styles.css"),await readFile(join(project,"styles-research.css"),"utf8"));
await writeFile(join(temporary,"index.html"),'<!doctype html><meta charset="utf-8"><title>Research synthetic acceptance</title><link rel="stylesheet" href="/styles.css"><style>body{margin:0}#fixtures{width:440px;height:859px}#test-menu{position:fixed;top:30px;left:450px;background:white;border:1px solid #ddd;display:flex;flex-direction:column}</style><main id="fixtures"></main><script src="/fixture.js"></script>');
await build({entryPoints:[join(temporary,"fixture.ts")],outfile:join(temporary,"fixture.js"),bundle:true,platform:"browser",target:"chrome120",plugins:[{name:"public-host-fixture",setup(builder){builder.onResolve({filter:/^obsidian$/},()=>({path:join(temporary,"obsidian.ts")}));}}]});
const server=createServer(async(req,res)=>{const name=new URL(req.url,"http://127.0.0.1").pathname.slice(1)||"index.html";if(!["index.html","fixture.js","styles.css"].includes(name)){res.writeHead(404).end();return;}res.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":"text/html; charset=utf-8");res.end(await readFile(join(temporary,name)));});await new Promise(done=>server.listen(0,"127.0.0.1",done));
const session=`marginstudy-research-${process.pid}`;
const browser=(...args)=>runBrowser(session,...args);
try{await browser("open",`http://127.0.0.1:${server.address().port}`);await browser("wait","--fn","window.done===true");const result=JSON.parse((await browser("eval","({done:window.done,fatal:window.fatal,results:window.results,errors:window.testErrors})")).stdout);result.environment="Isolated Chromium; synthetic webview/PDF bytes and in-memory host; real research module; no native Electron webview or external-engine claim";await writeFile(join(temporary,"results.json"),JSON.stringify(result,null,2));const failed=result.results?.filter(item=>!item.passed)??[];console.log(`${result.results?.length-failed.length}/${result.results?.length} research checks passed`);console.log(`Results: ${join(temporary,"results.json")}`);if(result.fatal||!result.done||failed.length||result.errors?.length){console.error(JSON.stringify({fatal:result.fatal,failed,errors:result.errors},null,2));process.exitCode=1;}}
finally{await browser("close").catch(()=>{});await new Promise(done=>server.close(done));}
