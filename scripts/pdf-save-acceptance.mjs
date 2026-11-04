// Public save entry + real disposable filesystem; only the OS dialog is substituted.
import {build} from 'esbuild';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const folder=await fs.mkdtemp(path.join(os.tmpdir(),'marginstudy-save-test-'));
await build({entryPoints:['src/pdf/pdfExportSave.ts'],bundle:true,platform:'node',format:'esm',outfile:path.join(folder,'save.mjs')});
const {savePdfExport}=await import(path.join(folder,'save.mjs'));
const req=createRequire(import.meta.url),source=path.join(folder,'source.pdf'),target=path.join(folder,'export.pdf');
await fs.writeFile(source,'ORIGINAL SOURCE');await fs.writeFile(target,'OLD EXPORT');
let result={canceled:false,filePath:target};
globalThis.window={require:name=>name==='@electron/remote'?{dialog:{showSaveDialog:async()=>result}}:req(name)};
const reader={getFilePath:()=> 'source.pdf',app:{vault:{adapter:{getBasePath:()=>folder}}}};
let passed=0;
const test=async(name,run)=>{await run();console.log('PASS '+name);passed++;};
try {
 await test('Replace selected by native Save publishes the complete new export',async()=>{
  assert.equal(await savePdfExport(reader,new TextEncoder().encode('NEW EXPORT'),()=>{}),target);
  assert.equal(await fs.readFile(target,'utf8'),'NEW EXPORT');
  assert.equal(await fs.readFile(source,'utf8'),'ORIGINAL SOURCE');
  assert.deepEqual((await fs.readdir(folder)).filter(x=>x.endsWith('.tmp')),[]);
 });
 await test('Cancel preserves an existing export and creates no staged file',async()=>{
  result={canceled:true,filePath:target};
  assert.equal(await savePdfExport(reader,new Uint8Array([0]),()=>{}),null);
  assert.equal(await fs.readFile(target,'utf8'),'NEW EXPORT');
  assert.deepEqual((await fs.readdir(folder)).filter(x=>x.endsWith('.tmp')),[]);
 });
 await test('PNG save adds its suffix without replacing an unconfirmed suffixed file',async()=>{
  const bare=path.join(folder,'image');result={canceled:false,filePath:bare};
  assert.equal(await savePdfExport(reader,new Uint8Array([137,80,78,71]),()=>{},undefined,undefined,'png'),bare+'.png');
  await assert.rejects(savePdfExport(reader,new Uint8Array([0]),()=>{},undefined,undefined,'png'),/已存在/);
  assert.deepEqual([...await fs.readFile(bare+'.png')],[137,80,78,71]);
 });
 await test('Source path, symlink and hardlink cannot replace the current document',async()=>{
  const symlink=path.join(folder,'source-alias.pdf'),hardlink=path.join(folder,'source-hardlink.pdf');
  await fs.symlink(source,symlink);await fs.link(source,hardlink);
  for(const filePath of [source,symlink,hardlink]){
   result={canceled:false,filePath};await assert.rejects(savePdfExport(reader,new Uint8Array([0]),()=>{}),/源文件/);
  }
  assert.equal(await fs.readFile(source,'utf8'),'ORIGINAL SOURCE');
 });
 await test('A stale export after staging preserves the previous complete export and cleans staging',async()=>{
  result={canceled:false,filePath:target};let checks=0;
  await assert.rejects(savePdfExport(reader,new Uint8Array([0]),()=>{if(++checks===2)throw Error('STALE EXPORT');}),/STALE EXPORT/);
  assert.equal(await fs.readFile(target,'utf8'),'NEW EXPORT');
  assert.deepEqual((await fs.readdir(folder)).filter(x=>x.endsWith('.tmp')),[]);
 });
 console.log(`${passed}/${passed} save behavior groups passed`);
} finally {await fs.rm(folder,{recursive:true,force:true});}
