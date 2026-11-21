import { mkdir, writeFile, copyFile, cp, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { privateFixture } from "../verify/fixtures.mjs";

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const vault = resolve(process.argv[2] ?? privateFixture("package09-20261025/stability-vault"));
try { await stat(vault); throw new Error(`Refusing to overwrite existing test vault: ${vault}`); } catch (error) { if (error.code !== "ENOENT") throw error; }
const put = async (path, data) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, data); };
const sha = data => createHash("sha256").update(data).digest("hex");
await mkdir(vault, { recursive: true });
const long = await PDFDocument.create(), font = await long.embedFont(StandardFonts.Helvetica);
for (let pageNo = 1; pageNo <= 500; pageNo++) {
  const page = long.addPage([612, 792]);
  page.drawText(`P09 SYNTHETIC TEXT PAGE ${pageNo}`, { x: 48, y: 740, size: 14, font, color: rgb(.1,.1,.1) });
  for (let line = 0; line < 12; line++) page.drawText(`Recovery stress fixture line ${line+1}; stable anchors and annotations remain synthetic.`, { x: 48, y: 700-line*38, size: 10, font });
}
const longBytes = await long.save(); await put(join(vault,"p09-long-text.pdf"),longBytes);
const scan = await PDFDocument.create(), scanImage = await scan.embedPng(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p6sAAAAASUVORK5CYII=","base64"));
for (let pageNo = 1; pageNo <= 200; pageNo++) { const page=scan.addPage([612,792]);page.drawImage(scanImage,{x:0,y:0,width:612,height:792});page.drawText(`P09 SCANNED FIXTURE PAGE ${pageNo}`,{x:30,y:30,size:1,color:rgb(1,1,1)}); }
const scanBytes=await scan.save();await put(join(vault,"p09-scan-200.pdf"),scanBytes);
const collection={format:"marginstudy-page-collection",version:1,id:"p09-collection",title:"P09 Synthetic 1000 Page References",createdAt:"2026-10-25T00:00:00.000Z",pages:Array.from({length:1000},(_,i)=>({id:`p09-ref-${i+1}`,sourcePath:"p09-long-text.pdf",sourcePage:(i%500)+1,sourceNotebookId:"default",annotations:"clean",origin:"document"}))};
await put(join(vault,"p09-1000-refs.msref"),JSON.stringify(collection,null,2));
const cards=[],annotations=[];
for(let i=0;i<5000;i++){const id=`p09-card-${String(i+1).padStart(4,"0")}`,annId=`p09-ann-${String(i+1).padStart(4,"0")}`,page=i%500+1;
  cards.push({id,docPath:"p09-long-text.pdf",type:"comment",front:`P09 synthetic card ${i+1}`,links:[],tags:["p09-synthetic"],anchorAnnId:annId,page,createdAt:"2026-10-25T00:00:00.000Z"});
  annotations.push({id:annId,type:"note",docPath:"p09-long-text.pdf",page,rects:[],text:`P09 synthetic annotation ${i+1}`,color:"#fff176",noteText:`Synthetic note ${i+1}`,cardId:id,createdAt:"2026-10-25T00:00:00.000Z"});
}
const sidecar=Buffer.from(JSON.stringify({schemaVersion:2,annotations}));await put(join(vault,"p09-long-text.pdf.mstudy.json"),sidecar);
const stamp="2026-10-25T00:00:00.000Z",data={schemaVersion:2,revision:0,writerId:"p09-synthetic-seed",settings:{},cards,nodes:[],edges:[],srs:{},docMeta:{},reviewHistory:{},reviewLogs:[],reviewPending:[],cardTemplates:[],reviewDecks:[],studySets:[{id:"p09-study",name:"P09 Synthetic Stability",docPaths:["p09-long-text.pdf","p09-scan-200.pdf","p09-1000-refs.msref"],cardIds:cards.map(card=>card.id),createdAt:stamp}],canvases:[{id:"p09-canvas",studySetId:"p09-study",name:"P09 Main",createdAt:stamp}],activeStudySetId:"p09-study",activeCanvasId:"p09-canvas",documents:[
  {id:"p09-doc-text",path:"p09-long-text.pdf",kind:"pdf",createdAt:stamp,sha256:sha(longBytes).toString(),byteSize:longBytes.byteLength},
  {id:"p09-doc-scan",path:"p09-scan-200.pdf",kind:"pdf",createdAt:stamp,sha256:sha(scanBytes),byteSize:scanBytes.byteLength},
  {id:"p09-doc-refs",path:"p09-1000-refs.msref",kind:"msref",createdAt:stamp,sha256:sha(Buffer.from(JSON.stringify(collection,null,2))),byteSize:Buffer.byteLength(JSON.stringify(collection,null,2))}
]};
await put(join(vault,".obsidian/community-plugins.json"),JSON.stringify(["margin-study"],null,2));
const plugin=join(vault,".obsidian/plugins/margin-study");await mkdir(plugin,{recursive:true});
for(const file of ["main.js","styles.css","manifest.json","pdf.worker.js","ocr.swift"])await copyFile(join(root,file),join(plugin,file));
await cp(join(root,"native"),join(plugin,"native"),{recursive:true});
await put(join(plugin,"data.json"),JSON.stringify(data));
const report={vault,createdAt:new Date().toISOString(),syntheticOnly:true,documents:[{path:"p09-long-text.pdf",pages:500,bytes:longBytes.byteLength,sha256:sha(longBytes)},{path:"p09-scan-200.pdf",pages:200,bytes:scanBytes.byteLength,sha256:sha(scanBytes)},{path:"p09-1000-refs.msref",references:collection.pages.length,bytes:Buffer.byteLength(JSON.stringify(collection,null,2)),sha256:sha(Buffer.from(JSON.stringify(collection,null,2)))}],annotations:annotations.length,cards:cards.length,associationCount:annotations.filter(a=>cards.some(card=>card.anchorAnnId===a.id)).length,sidecar:{bytes:sidecar.byteLength,sha256:sha(sidecar)},seedData:{bytes:Buffer.byteLength(JSON.stringify(data)),sha256:sha(Buffer.from(JSON.stringify(data)))} };
await put(privateFixture("package09-20261025/stability-vault.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
