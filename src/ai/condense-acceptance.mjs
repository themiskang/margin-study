import assert from "node:assert/strict";
import { build } from "esbuild";
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,dirname } from "node:path";
import { fileURLToPath } from "node:url";
globalThis.crypto ??= webcrypto;
const dir=await mkdtemp(join(tmpdir(),"ms-condense-"));
try {
  const built=await build({entryPoints:[join(dirname(fileURLToPath(import.meta.url)),"condense.ts")],bundle:true,platform:"node",format:"cjs",write:false});
  const path=join(dir,"condense.cjs");await writeFile(path,built.outputFiles[0].contents);
  const {CondenseService}=createRequire(import.meta.url)(path);
  let calls=0,revision=1,fail=false,waiting=false;
  const ai={configuration:()=>({id:"test",revision,endpoint:"synthetic",normalModel:"synthetic-model"}),isBound:()=>true,request:async input=>{
    calls++;if(fail){fail=false;throw new Error("synthetic failure");}
    if(waiting)await new Promise((resolve,reject)=>{input.signal.addEventListener("abort",()=>reject(new Error("aborted")),{once:true});setTimeout(resolve,50);});
    return {text:"结果 "+input.text};
  }};
  const service=new CondenseService(ai),base={text:"合成材料",language:"中文",level:"sentence"};
  const first=await service.request(base);assert.equal(first.cached,false);assert.equal((await service.request(base)).cached,true);assert.equal(calls,1);
  await service.request({...base,level:"points"});const detailed=await service.request({...base,level:"outline"});assert.match(detailed.text,/详细叙述/);assert.equal(calls,3);
  await assert.rejects(service.request({...base,text:"字".repeat(200001)}),/输入过长/);
  await assert.rejects(service.request({...base,images:Array(5).fill("data:image/png;base64,YQ==")}),/最多附加 4 张/);
  await service.request({...base,language:"English"});revision++;await service.request(base);assert.equal(calls,5);
  fail=true;await assert.rejects(service.request({...base,text:"失败后重试"}));await service.request({...base,text:"失败后重试"});assert.equal(calls,7);
  waiting=true;const a=new AbortController(),b=new AbortController(),one=service.request({...base,text:"并发",signal:a.signal}),two=service.request({...base,text:"并发",signal:b.signal});
  await new Promise(resolve=>setTimeout(resolve,10));a.abort();await assert.rejects(one);await two;assert.equal(calls,8);
  const c=new AbortController(),aborted=service.request({...base,text:"取消",signal:c.signal});await new Promise(resolve=>setTimeout(resolve,10));c.abort();await assert.rejects(aborted);waiting=false;await service.request({...base,text:"取消"});assert.equal(calls,10);
  const image={...base,text:"",images:["data:image/png;base64,YQ=="]};await service.request(image);await service.request(image);await service.request({...image,images:["data:image/png;base64,Yg=="]});assert.equal(calls,12);
  console.log("7/7 condensation cache, tier, configuration, image, retry and cancellation groups passed");
} finally {await rm(dir,{recursive:true,force:true});}
