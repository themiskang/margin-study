import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { unzipSync, strFromU8 } from "fflate";

const root = process.cwd();
const output = process.env.STUDY_SET_EXPORT_RESULT_DIR ?? await fs.mkdtemp(path.join(tmpdir(), "marginstudy-set-export-"));
await fs.mkdir(output, {recursive:true});
const implementation = path.join(root, "src/export/studySetExport.ts");
const built = await build({
  stdin:{contents:'export {Store} from "./src/model/store"; export {exportStudySet} from "./src/export/studySetExport"; export {exportStudySetToNotes} from "./src/export/studySetNotes";',resolveDir:root,loader:"ts"},
  bundle:true,platform:"node",format:"cjs",write:false,
  plugins:[{name:"synthetic-obsidian",setup(builder){
    builder.onResolve({filter:/^obsidian$/},()=>({path:"obsidian",namespace:"test"}));
    builder.onLoad({filter:/.*/,namespace:"test"},()=>({contents:"export class TFile {} export class Notice {} export class Component {} export const MarkdownRenderer = {};",loader:"js"}));
    builder.onResolve({filter:/studySetExport$/},args=>existsSync(implementation)?undefined:{path:args.path,namespace:"missing-export"});
    builder.onLoad({filter:/.*/,namespace:"missing-export"},()=>({contents:"export const exportStudySet = undefined;",loader:"js"}));
  }}],
});
const bundle=path.join(output,"fixture.cjs");await fs.writeFile(bundle,built.outputFiles[0].contents);
const api=createRequire(import.meta.url)(bundle),requireNode=createRequire(import.meta.url);
const results=[];
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const test=async(name,run)=>{try{await run();results.push({name,passed:true});console.log("PASS "+name);}catch(error){results.push({name,passed:false,error:String(error.stack)});console.error("FAIL "+name+": "+error.message);process.exitCode=1;}};
const requireExport=()=>assert.equal(typeof api.exportStudySet,"function","study set export entry does not exist");
const time="2026-01-02T03:04:05.000Z";

async function fixture(name) {
  const folder=path.join(output,name),vault=path.join(folder,"vault");await fs.mkdir(vault,{recursive:true});
  const source={
    "Documents/中文.pdf":Buffer.from("%PDF synthetic source\n"),
    "Documents/sheets.msref":Buffer.from(JSON.stringify({format:"marginstudy-page-collection",version:1,id:"pages",title:"Pages",createdAt:time,pages:[{id:"page",sourcePath:"Documents/referenced.pdf",sourcePage:1,sourceNotebookId:"default",annotations:"include",origin:"page"}]})),
    "Documents/referenced.pdf":Buffer.from("%PDF referenced original\n"),
    "Documents/attachment.pdf":Buffer.from("attachment original\n"),
    "_marginstudy-media/example.png":Buffer.from([137,80,78,71,1,2,3,4,5]),
    "_marginstudy-media/annotation.png":Buffer.from([137,80,78,71,6,7,8]),
    "_marginstudy-audio/voice.webm":Buffer.from([1,3,5,7]),
  };
  const annotation={id:"ann",docPath:"Documents/中文.pdf",docKind:"pdf",page:1,type:"region",rects:[],text:"excerpt",color:"yellow",image:"_marginstudy-media/annotation.png",audioPath:"_marginstudy-audio/voice.webm",createdAt:time};
  source["Documents/中文.pdf.mstudy.json"]=Buffer.from(JSON.stringify({annotations:[annotation]}));
  for(const [name,bytes] of Object.entries(source)){const file=path.join(vault,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
  const card=(id,docPath,extra={})=>({id,docPath,type:"excerpt",front:id,tags:[],links:[],createdAt:time,...extra});
  const node=(id,cardId,canvasId)=>({id,cardId,canvasId,title:id,parentId:null,x:1,y:2,collapsed:false});
  const data={cards:[card("visible","Documents/中文.pdf",{image:"_marginstudy-media/example.png"}),card("hidden","Documents/中文.pdf",{hidden:true,groupId:"visible"}),card("other","Other/private.pdf")],
    nodes:[node("one","visible","canvas"),node("two","hidden","canvas"),node("other-node","other","other-canvas")],edges:[{from:"one",to:"two",label:"link"}],srs:{},
    studySets:[{id:"set",name:"Study 测试",docPaths:["Documents/中文.pdf","Documents/sheets.msref"],documentAttachments:{"Documents/中文.pdf":["Documents/attachment.pdf"]},cardIds:["visible","hidden"],createdAt:time},{id:"other-set",name:"Other",docPaths:["Other/private.pdf"],createdAt:time}],
    canvases:[{id:"canvas",studySetId:"set",name:"Main",createdAt:time},{id:"other-canvas",studySetId:"other-set",name:"Other",createdAt:time}],activeStudySetId:"set",activeCanvasId:"canvas",documents:[]};
  const adapter={getBasePath:()=>vault,mkdir:async value=>fs.mkdir(path.join(vault,value),{recursive:true}),write:async(value,content)=>fs.writeFile(path.join(vault,value),content),exists:async value=>!!(await fs.stat(path.join(vault,value)).catch(()=>null)),read:async value=>fs.readFile(path.join(vault,value),"utf8"),readBinary:async value=>{const bytes=await fs.readFile(path.join(vault,value));return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}};
  let disk=structuredClone(data),writes=0;
  const app={vault:{adapter,getFiles:()=>[],getAbstractFileByPath:()=>null}};
  const store=new api.Store({app,loadData:async()=>structuredClone(disk),saveData:async value=>{writes++;disk=structuredClone(value);}});await store.load();
  let response={canceled:false,filePath:path.join(folder,"output.marginstudy-set.zip")},dialogs=0;
  globalThis.window={require:name=>name==="@electron/remote"?{dialog:{showSaveDialog:async()=>{dialogs++;return response;}}}:requireNode(name)};
  const plugin={store,app};
  return {folder,vault,source,store,plugin,adapter,annotation,output:response.filePath,setResponse:value=>{response=value;},writes:()=>writes,dialogs:()=>dialogs};
}
const state=store=>JSON.parse(JSON.stringify({cards:store.cards,nodes:store.nodes,edges:store.edges,studySets:store.studySets,canvases:store.canvases,settings:store.settings,documents:store.documents,cardTemplates:store.cardTemplates,sceneTemplates:store.getSceneTemplates()}));

await test("legacy and modern ink export content coordinates in current and historical cards",async()=>{
  const item=await fixture("ink-migration");
  const stroke={id:"ink",tool:"pen",color:"#000",width:3,points:[{x:.25,y:.5}]};
  const media={id:"comment",kind:"ink",image:"data:image/png;base64,AA==",snapshot:{image:"data:image/png;base64,AQ==",x:0,y:.1,width:1,height:.8},parts:[{image:"data:image/png;base64,Ag==",y:0,height:600},{image:"data:image/png;base64,Aw==",y:600,height:600}],strokes:[stroke]};
  item.store.getCard("visible").commentMedia=[media];
  item.store.libraryTransaction("snapshot",()=>item.store.updateStudySet("set",{name:"After"}));
  item.store.getCard("visible").commentMedia.push({...media,id:"modern",strokes:[{...stroke,pointsVersion:2,points:[{x:200,y:480}]}]});
  const before=state(item.store), previous=globalThis.Image;
  globalThis.Image=class { naturalWidth=800; naturalHeight=600; async decode() {} };
  try { await api.exportStudySet(item.plugin,{history:"all"}); } finally { globalThis.Image=previous; }
  const entries=unzipSync(await fs.readFile(item.output)),payload=JSON.parse(strFromU8(entries["studyset.json"])),manifest=JSON.parse(strFromU8(entries["MANIFEST.json"]));
  const comments=payload.cards.find(card=>card.id==="visible").commentMedia;
  assert.deepEqual(comments.map(comment=>comment.strokes[0].points[0]),[{x:200,y:480},{x:200,y:480}]);
  assert.ok(comments.every(comment=>comment.strokes[0].pointsVersion===2));
  const history=JSON.parse(strFromU8(entries["history/001.json"]));
  assert.deepEqual(history.cards.find(card=>card.id==="visible").commentMedia[0].strokes[0].points[0],{x:200,y:480});
  assert.equal(history.cards.find(card=>card.id==="visible").commentMedia[0].strokes[0].pointsVersion,2);
  assert.equal(manifest.pointsVersion,2);assert.deepEqual(state(item.store),before);
});
await test("history options export recent, all, or no scoped snapshots",async()=>{
  const item=await fixture("versions");
  for(let index=0;index<7;index++)item.store.libraryTransaction("edit "+index,()=>item.store.updateStudySet("set",{name:"Version "+index}));
  for(const [option,count] of [["recent",5],["all",7],["none",0]]){
    const target=path.join(item.folder,option+".marginstudy-set.zip");item.setResponse({canceled:false,filePath:target});
    await api.exportStudySet(item.plugin,{history:option});
    const entries=unzipSync(await fs.readFile(target)),history=Object.keys(entries).filter(name=>name.startsWith("history/"));
    assert.equal(history.length,count,option);
    for(const name of history){const value=JSON.parse(strFromU8(entries[name]));assert.equal(value.set.id,"set");assert.ok(!JSON.stringify(value).includes("Other/private.pdf"));}
  }
});
await test("shared ZIP excludes global settings from the payload and every history entry", async () => {
  const item = await fixture("f04-share");
  const credentialKeys = ["clientId", "clientSecret", "accessToken", "refreshToken"];
  const preferenceKeys = ["studyHomeCategory", "accent", "layout"];
  const fakeSettings = stage => ({
    baiduNetdisk: Object.fromEntries(credentialKeys.map(key => [key, `F04-FAKE-${stage}-${key}`])),
    ...Object.fromEntries(preferenceKeys.map(key => [key, `F04-FAKE-${stage}-${key}`])),
  });
  const historical = fakeSettings("history");
  const current = fakeSettings("current");
  Object.assign(item.store.settings, historical);
  item.store.updateStudySet("set", { name: "Updated set" });
  Object.assign(item.store.settings, current);
  assert.deepEqual(item.store.getStudySetHistory("set").map(entry => entry.data.settings.baiduNetdisk), [historical.baiduNetdisk]);

  await api.exportStudySet(item.plugin, { history: "all" });
  const entries = unzipSync(await fs.readFile(item.output));
  const history = Object.keys(entries).filter(name => /^history\/.*\.json$/.test(name));
  const forbiddenKeys = ["settings", "baiduNetdisk", ...credentialKeys, ...preferenceKeys];
  const markers = [historical, current].flatMap(value => [
    ...Object.values(value.baiduNetdisk),
    ...preferenceKeys.map(key => value[key]),
  ]);
  const scan = ["studyset.json", ...history].map(name => {
    const json = strFromU8(entries[name]);
    JSON.parse(json);
    return {
      name,
      forbiddenKeyHits: forbiddenKeys.filter(key => new RegExp(`"${key}"\\s*:`).test(json)),
      markerHits: markers.filter(marker => json.includes(marker)),
    };
  });
  const evidence = path.join(item.folder, "F04-01-02-scan.json");
  await fs.writeFile(evidence, JSON.stringify({ history, forbiddenKeys, markers, scan }, null, 2) + "\n");
  console.log(`F04 export evidence: ${evidence}`);
  assert.equal(history.length, 1);
  assert.equal(JSON.parse(strFromU8(entries[history[0]])).set.name, "Study 测试");
  assert.deepEqual(scan.flatMap(entry => entry.forbiddenKeyHits), []);
  assert.deepEqual(scan.flatMap(entry => entry.markerHits), []);
});
await test("notes export writes cards into a new vault note without overwriting",async()=>{
  const item=await fixture("notes"),files=new Map([["Study 测试 - 学习笔记.md","existing"]]);
  item.plugin.app.vault.getAbstractFileByPath=name=>files.has(name)?{}:null;
  item.plugin.app.vault.create=async(name,content)=>{if(files.has(name))throw new Error("exists");files.set(name,content);};
  const path=await api.exportStudySetToNotes(item.plugin);
  assert.equal(path,"Study 测试 - 学习笔记 (2).md");assert.equal(files.get("Study 测试 - 学习笔记.md"),"existing");
  assert.ok(files.get(path).includes("visible")&&files.get(path).includes("[[Documents/中文.pdf]]"));
});
await test("exported ZIP contains precisely the current set and unchanged store objects",async()=>{
  requireExport();const item=await fixture("scope"),before=state(item.store);
  assert.equal(await api.exportStudySet(item.plugin),item.output);
  const bytes=await fs.readFile(item.output);execFileSync("unzip",["-t",item.output]);
  const entries=unzipSync(bytes),data=JSON.parse(strFromU8(entries["studyset.json"]));
  assert.deepEqual(data.studySets,[before.studySets[0]]);assert.deepEqual(data.cards,before.cards.slice(0,2));
  assert.deepEqual(data.nodes,before.nodes.slice(0,2));assert.deepEqual(data.edges,before.edges);
  assert.deepEqual(data.canvases,[before.canvases[0]]);assert.equal(Object.hasOwn(data,"settings"),false);
  assert.deepEqual(state(item.store),before);assert.equal(item.writes(),0);assert.equal(item.dialogs(),1);
});
await test("archive files and manifest hashes match original documents and referenced media",async()=>{
  requireExport();const item=await fixture("assets");await api.exportStudySet(item.plugin);
  const entries=unzipSync(await fs.readFile(item.output)),manifest=JSON.parse(strFromU8(entries["MANIFEST.json"]));
  for(const sourcePath of ["Documents/中文.pdf","Documents/sheets.msref","Documents/referenced.pdf","Documents/attachment.pdf","_marginstudy-media/example.png","_marginstudy-media/annotation.png","_marginstudy-audio/voice.webm"]){
    const archivePath=sourcePath.startsWith("Documents/")?"documents/"+sourcePath:sourcePath;
    assert.ok(entries[archivePath],"missing "+archivePath);assert.equal(hash(entries[archivePath]),hash(item.source[sourcePath]));
  }
  const records=new Map(manifest.files.map(file=>[file.path,file]));
  for(const [name,bytes] of Object.entries(entries))if(name!=="MANIFEST.json"){assert.equal(records.get(name)?.sha256,hash(bytes),name);assert.equal(records.get(name)?.bytes,bytes.length,name);}
  assert.equal(records.size,Object.keys(entries).length-1);
  const payload=JSON.parse(strFromU8(entries["studyset.json"]));assert.deepEqual(payload.annotations["Documents/中文.pdf"],[item.annotation]);
});
await test("backup without PDF omits PDF files but retains annotations and other documents",async()=>{
  const item=await fixture("without-pdf");await api.exportStudySet(item.plugin,{includePdf:false});
  const entries=unzipSync(await fs.readFile(item.output)),payload=JSON.parse(strFromU8(entries["studyset.json"]));
  assert.ok(!Object.keys(entries).some(name=>name.startsWith("documents/")&&/\.pdf$/i.test(name)));
  assert.ok(entries["documents/Documents/sheets.msref"]);
  assert.deepEqual(payload.annotations["Documents/中文.pdf"],[item.annotation]);
});
await test("export and history undo/redo never change business data or source files",async()=>{
  requireExport();const item=await fixture("history"),before=state(item.store),hashes=Object.fromEntries(Object.entries(item.source).map(([name,bytes])=>[name,hash(bytes)]));
  const objectHashes=Object.fromEntries(["cards","nodes","edges","studySets","canvases","cardTemplates","sceneTemplates"].map(key=>[key,hash(JSON.stringify(before[key]))]));
  await api.exportStudySet(item.plugin);const exported=hash(await fs.readFile(item.output));assert.equal(item.store.getLibraryHistoryState().undoLabel,"导出学习集");
  assert.equal(item.store.undoLibraryChange(),true);assert.equal(item.store.getLibraryHistoryState().redoLabel,"导出学习集");assert.deepEqual(state(item.store),before);
  assert.equal(item.store.redoLibraryChange(),true);assert.deepEqual(state(item.store),before);assert.equal(hash(await fs.readFile(item.output)),exported);
  const after=state(item.store);for(const [key,expected] of Object.entries(objectHashes))assert.equal(hash(JSON.stringify(after[key])),expected,key);
  for(const [name,expected] of Object.entries(hashes))assert.equal(hash(await fs.readFile(path.join(item.vault,name))),expected,name);
  assert.equal(item.writes(),0);
});
await test("cancel, missing assets, and preexisting targets never create a history entry or overwrite files",async()=>{
  requireExport();const item=await fixture("safety"),history=structuredClone(item.store.getLibraryHistoryState());
  item.setResponse({canceled:true});assert.equal(await api.exportStudySet(item.plugin),null);assert.deepEqual(item.store.getLibraryHistoryState(),history);
  item.setResponse({canceled:false,filePath:item.output});await fs.writeFile(item.output,"EXISTING");
  await assert.rejects(()=>api.exportStudySet(item.plugin),/存在/);assert.equal(await fs.readFile(item.output,"utf8"),"EXISTING");assert.deepEqual(item.store.getLibraryHistoryState(),history);
  await fs.rename(path.join(item.vault,"_marginstudy-media/example.png"),path.join(item.folder,"removed.png"));
  await assert.rejects(()=>api.exportStudySet(item.plugin),/example\.png/);assert.deepEqual(item.store.getLibraryHistoryState(),history);
});
await test("save panel cannot replace a source path, hardlink, or existing suffixed name",async()=>{
  requireExport();const item=await fixture("aliases"),sourcePath=path.join(item.vault,"Documents/中文.pdf"),hardlink=path.join(item.folder,"hardlink.marginstudy-set.zip"),symlink=path.join(item.folder,"symlink.marginstudy-set.zip");
  await fs.link(sourcePath,hardlink);await fs.symlink(sourcePath,symlink);
  const bare=path.join(item.folder,"bare"),bareTarget=bare+".marginstudy-set.zip";await fs.writeFile(bareTarget,"UNTOUCHED");
  for(const target of [sourcePath,hardlink,symlink,bare]){
    if(target===sourcePath)await fs.writeFile(sourcePath+".marginstudy-set.zip","SOURCE-NEIGHBOR");
    item.setResponse({canceled:false,filePath:target});await assert.rejects(()=>api.exportStudySet(item.plugin),/存在/);
  }
  assert.equal(hash(await fs.readFile(sourcePath)),hash(item.source["Documents/中文.pdf"]));assert.equal(await fs.readFile(bareTarget,"utf8"),"UNTOUCHED");
  assert.equal(item.store.getLibraryHistoryState().canUndo,false);assert.deepEqual((await fs.readdir(item.folder)).filter(name=>name.endsWith(".tmp")),[]);
});
await test("pending annotations and edited page imports are packaged without flushing",async()=>{
  requireExport();const item=await fixture("pending"),additional="Documents/imported.pdf",imported=Buffer.from("imported page original");
  await fs.writeFile(path.join(item.vault,additional),imported);
  item.store.docMeta["Documents/中文.pdf"]={pdfPageEdits:{version:1,pages:[{id:"import",imported:{path:additional,page:1}}]}};
  const annotations=await item.store.loadAnnotations("Documents/中文.pdf");annotations[0].text="unsaved change";item.store.saveAnnotationsDebounced("Documents/中文.pdf",annotations);
  const before=state(item.store);await api.exportStudySet(item.plugin);
  const entries=unzipSync(await fs.readFile(item.output)),payload=JSON.parse(strFromU8(entries["studyset.json"]));
  assert.equal(payload.annotations["Documents/中文.pdf"][0].text,"unsaved change");assert.equal(hash(entries["documents/"+additional]),hash(imported));
  assert.deepEqual(state(item.store),before);assert.equal(item.writes(),0);clearTimeout(item.store.saveTimer);
});
await test("changes during packaging abort before save without changing history",async()=>{
  requireExport();const item=await fixture("concurrent"),read=item.adapter.readBinary;let injected=false;
  item.adapter.readBinary=async name=>{const bytes=await read(name);if(name==="_marginstudy-media/example.png"&&!injected){injected=true;item.store.getCard("visible").front="concurrent user edit";}return bytes;};
  await assert.rejects(()=>api.exportStudySet(item.plugin),/发生变化/);assert.equal(item.dialogs(),0);assert.equal(item.store.getLibraryHistoryState().canUndo,false);
});
await test("empty study set is rejected without opening a save dialog",async()=>{
  requireExport();const item=await fixture("empty");item.store.studySets[0].docPaths=[];item.store.studySets[0].documentAttachments={};item.store.studySets[0].cardIds=[];item.store.nodes=item.store.nodes.filter(node=>node.canvasId!=="canvas");
  await assert.rejects(()=>api.exportStudySet(item.plugin),/空/);assert.equal(item.dialogs(),0);
});

await fs.writeFile(path.join(output,"results.json"),JSON.stringify({environment:"synthetic Store and disposable files; native save dialog mocked",results},null,2)+"\n");
console.log(`${results.filter(item=>item.passed).length}/${results.length} study set export checks passed`);
console.log(`Results: ${path.join(output,"results.json")}`);
