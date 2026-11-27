// Synthetic library and sidecars only. No installed plugin or real vault is read.
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {build} from "esbuild";

const source = fileURLToPath(new URL("../",import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(),"marginstudy-l3-store-"));
const stores = [], results = [];
async function test(name,run) {
  try { await run(); results.push({name,passed:true}); console.log("✓ "+name); }
  catch (error) { results.push({name,passed:false,error:String(error.stack)}); console.error("FAIL: "+name+"\n"+error.stack); process.exitCode = 1; }
}
try {
  const result = await build({stdin:{contents:["model/store","model/conflicts","model/reviewPending","utils/markdown","recall/session","export/exporter"].map(name=>`export * from './${name}.ts';`).join("\n"),resolveDir:source},
    platform:"node",format:"cjs",bundle:true,write:false,
    plugins:[{name:"memory-obsidian",setup(builder) {
      builder.onResolve({filter:/^obsidian$/},()=>({path:"obsidian",namespace:"memory"}));
      builder.onLoad({filter:/.*/,namespace:"memory"},()=>({contents:"export class Component {} export class App {} export class TFile {} export class Notice {} export const MarkdownRenderer={render:async()=>{}};",loader:"js"}));
    }}]});
  const bundle = path.join(temporary,"contracts.cjs"); await writeFile(bundle,result.outputFiles[0].contents);
  const api = createRequire(import.meta.url)(bundle);
  const time = "2020-01-02T03:04:05.000Z";
  const card = (id,patch={})=>({id,docPath:"fixture.pdf",type:"excerpt",front:id+" text",tags:[],links:[],createdAt:time,...patch});
  const node = (id,cardId,canvasId,parentId=null,patch={})=>({id,cardId,canvasId,parentId,title:id,collapsed:false,x:1,y:2,...patch});
  const fresh = async (seed={})=>{
    let disk = structuredClone({cards:[],nodes:[],edges:[],srs:{},reviewPending:[],...seed});
    const files = new Map();
    const host={loadData:async()=>structuredClone(disk),saveData:async value=>{disk=structuredClone(value);},app:{vault:{getAbstractFileByPath:()=>null,getFiles:()=>[],adapter:{
      exists:async name=>files.has(name),mkdir:async name=>files.set(name,""),write:async(name,value)=>files.set(name,value),read:async name=>files.get(name),
    }}}};
    const store = new api.Store(host); await store.load(); stores.push(store);
    return {store,host,files,disk:()=>structuredClone(disk),reload:async()=>{await store.flush();const next=new api.Store(host);await next.load();stores.push(next);return next;}};
  };
  const setup = async(cards=[],nodes=[])=>fresh({cards,nodes,studySets:[{id:"set",name:"Learning set",docPaths:["fixture.pdf"],createdAt:time}],
    canvases:["a","b"].map(id=>({id,studySetId:"set",name:id,createdAt:time})),activeStudySetId:"set",activeCanvasId:"a"});

  await test("opening restores the newest qualifying ordinary canvas, excluding TOC and review",async()=>{
    const {store:s}=await setup([card("c")],[node("content","c","a"),node("toc",undefined,"b",null,{kind:"toc"})]);
    const review=s.createCanvas("set","Review");s.updateCanvas(review.id,{kind:"review",lastVisitedAt:"2099-01-01"});s.addNode(node("review-node","c",review.id));
    s.updateCanvas("a",{lastVisitedAt:"2025-01-01",lastDocumentPath:"fixture.pdf"});s.updateCanvas("b",{lastVisitedAt:"2098-01-01"});
    const events=[];s.subscribeNavigation(event=>events.push(event));s.setActiveStudySet("set");
    assert.equal(s.activeCanvasId,"a");assert.deepEqual(events.at(-1),{canvasId:"a",documentPath:"fixture.pdf"});
  });
  await test("mount without opening does not restore navigation; existing empty canvas is reused and canvasless set silently initializes one without undo history",async()=>{
    const {store:s}=await setup();let count=0;s.subscribeNavigation(()=>count++);
    const revBefore=s.getLibraryHistoryState().revision;
    s.setActiveStudySet("set",{open:false});assert.equal(count,0);assert.equal(s.activeCanvasId,"a");
    s.setActiveStudySet("set",{documentPath:"chosen.epub"});
    assert.equal(s.canvases.filter(c=>c.studySetId==="set").length,2);
    assert.equal(s.getLibraryHistoryState().revision,revBefore);
    assert.equal(count,1);
    assert.equal(s.getCanvasKind(s.activeCanvasId),"document");
    const {store:s0}=await fresh({cards:[],nodes:[],studySets:[{id:"set",name:"Learning set",docPaths:["fixture.pdf"],createdAt:time}],canvases:[],activeStudySetId:undefined,activeCanvasId:undefined});
    const rev0=s0.getLibraryHistoryState().revision;
    s0.setActiveStudySet("set",{documentPath:"chosen.epub"});
    assert.equal(s0.canvases.find(c=>c.id===s0.activeCanvasId).name,"Learning set");
    assert.equal(s0.getLibraryHistoryState().revision,rev0);
    assert.equal(s0.getLibraryHistoryState().canUndo,false);
  });
  await test("removing a document preserves hidden cards, membership, pending, schedules and logs",async()=>{
    const {store:s}=await setup([card("visible"),card("hidden",{hidden:true})]);
    s.enqueueReview(["visible"],"a",new Date(time));const before=structuredClone({pending:s.reviewPending,srs:s.srs,logs:s.reviewLogs});
    s.updateStudySet("set",{docPaths:[]});assert.deepEqual(s.studySets[0].docPaths,[]);
    assert.deepEqual(new Set(s.studySets[0].cardIds),new Set(["visible","hidden"]));assert.equal(s.cards.length,2);
    assert.deepEqual({pending:s.reviewPending,srs:s.srs,logs:s.reviewLogs},before);
  });
  await test("references share latest title/excerpt/note/media/style but keep local display state",async()=>{
    const {store:s}=await setup([card("c",{page:2,anchorAnnId:"anchor",title:"Title",back:"Note",image:"one",color:"red"})],[node("origin","c","a",null,{comments:["origin"],hidden:true})]);
    const [copyId]=s.pasteSubtree(s.copySubtree(["origin"]),{canvasId:"b",mode:"reference"});
    s.updateNode(copyId,{comments:["local"],hidden:false,x:300});s.updateCard("c",{title:"Latest title",front:"Latest excerpt",back:"Latest note",image:"two",color:"blue"});
    const copy=s.getNode(copyId);assert.equal(copy.cardId,"c");assert.notEqual(copy.id,"origin");
    assert.equal(s.getCard(copy.cardId).back,"Latest note");assert.equal(s.getCard(copy.cardId).color,"blue");assert.deepEqual(s.getNode("origin").comments,["origin"]);
    const detached=s.detachNodeReference(copyId,true);assert.equal(detached.front,"Latest excerpt");assert.equal(detached.back,"Latest note");
    assert.equal(detached.anchorAnnId,undefined);assert.equal(detached.page,undefined);assert.equal(s.getCard("c").anchorAnnId,"anchor");
    s.updateCard("c",{front:"After detach"});assert.equal(detached.front,"Latest excerpt");assert.equal(copy.sourceNodeId,undefined);
  });
  await test("nonformal detach and same-canvas detach preserve source positions",async()=>{
    const {store:s}=await setup([card("c",{page:3,anchorAnnId:"source"})],[node("origin","c","a",null,{hidden:true}),node("ref","c","b",null,{reference:true,sourceNodeId:"origin"}),node("same","c","a",null,{reference:true,sourceNodeId:"origin"})]);
    assert.equal(s.detachNodeReference("ref",false).page,3);assert.equal(s.detachNodeReference("same",true).anchorAnnId,"source");
  });
  for (const part of ["title","excerpt","note"]) await test(`splitting ${part} keeps only its anchored half shared and round-trips undo`,async()=>{
    const {store:s}=await setup([card("c",{page:1,anchorAnnId:"source",title:"ABCD",front:"ABCD",back:"ABCD"})],[node("origin","c","a"),node("ref","c","b",null,{reference:true,sourceNodeId:"origin"})]);
    const created=s.splitNodeContent("ref",part,2);const old=s.getNode("ref"),added=s.getNode(created);
    const anchored=part==="title"?old:added,independent=part==="title"?added:old;
    assert.equal(anchored.cardId,"c");assert.equal(s.getCard(independent.cardId).anchorAnnId,undefined);
    assert.equal(s.getCard("c")[part==="title"?"title":part==="note"?"back":"front"],part==="title"?"CD":"AB");
    assert.equal(s.getCard(independent.cardId)[part==="title"?"title":part==="note"?"back":"front"],part==="title"?"AB":"CD");
    s.undoLibraryChange();assert.equal(s.getNode("ref").cardId,"c");assert.equal(s.getCard("c").front,"ABCD");assert.equal(s.nodes.length,2);
  });
  await test("empty excerpt head stays independent while the original tail keeps the anchor",async()=>{
    const {store:s}=await setup([card("c",{page:1})],[node("n","c","a")]);const id=s.splitNodeContent("n","excerpt",0);
    assert.equal(s.getNode("n").cardId,"c");assert.equal(s.getCard(s.getNode(id).cardId).page,undefined);
    assert.equal(s.getCard(s.getNode(id).cardId).front,"");assert.throws(()=>s.splitNodeContent("n","excerpt",s.getCard("c").front.length));
  });
  await test("merge retains anchored OR draft entities and snapshots unanchored non-drafts",async()=>{
    const {store:s,reload}=await setup([card("h",{color:undefined}),card("anchor",{page:1,color:"orange"}),card("draft",{draft:true}),card("plain"),card("empty",{front:""})]);
    s.mergeCards("h",["anchor","draft","plain","empty"]);assert.equal(s.getCard("anchor").groupId,"h");assert.equal(s.getCard("draft").groupId,"h");
    assert.equal(s.getCard("plain"),undefined);assert.ok(s.getCard("empty"));assert.equal(s.getCard("h").color,"orange");
    assert.deepEqual(s.getCard("h").mergedCards.map(c=>c.id),["h","anchor","draft","plain"]);
    const loaded=await reload();loaded.unmergeCard("h");assert.equal(loaded.cards.length,5);assert.equal(loaded.getCard("plain").front,"plain text");
    assert.ok(loaded.cards.every(c=>!c.groupId&&!c.hidden));assert.equal(loaded.getCard("h").color,undefined);
  });
  await test("merge guards reject self and members, while a head can absorb another member",async()=>{
    const {store:s}=await setup([card("h"),card("a",{page:1}),card("b")]);
    assert.throws(()=>s.mergeCards("h",["h"]));s.mergeCards("h",["a"]);assert.throws(()=>s.mergeCards("a",["b"]));assert.throws(()=>s.mergeCards("h",["a"]));
    s.mergeCards("h",["b"]);assert.equal(s.getCard("h").mergedCards.length,3);s.unmergeCard("h");assert.equal(s.cards.length,3);
  });
  await test("merging a selected reference materializes it without changing the other canvas",async()=>{
    const {store:s}=await setup([card("shared",{page:1}),card("other")],[node("original","shared","a"),node("reference","shared","b",null,{sourceNodeId:"original",reference:true}),node("other-node","other","b")]);
    s.mergeNodes(["reference","other-node"]);assert.equal(s.getNode("original").cardId,"shared");assert.equal(s.getCard("shared").front,"shared text");
    const merged=s.getCard(s.getNode("reference").cardId);assert.notEqual(merged.id,"shared");assert.ok(merged.front.includes("other text"));
    s.unmergeCard(merged.id);assert.ok(s.getNode("other-node"));assert.equal(s.getNode("original").cardId,"shared");
  });
  await test("unmerge uses current retained member data and preserves head edits without an extra duplicate",async()=>{
    const {store:s}=await setup([card("h"),card("a",{page:1,back:"original"})]);s.mergeCards("h",["a"]);
    s.updateCard("a",{front:"edited member",back:"unique note"});s.updateCard("h",{back:"edited head"});s.unmergeCard("h");
    assert.equal(s.cards.length,2);assert.equal(s.getCard("a").front,"edited member");assert.equal(s.getCard("a").back,"unique note");assert.equal(s.getCard("h").back,"edited head");
  });
  await test("unmerge restores collapsed children and labels without discarding later graph edits",async()=>{
    const {store:s}=await setup([card("h"),card("a",{page:1})],[node("head","h","a"),node("member","a","a"),node("child",undefined,"a","member"),node("unrelated",undefined,"a")]);
    s.addEdge("member","child","original-label");s.mergeNodes(["head","member"]);assert.equal(s.getNode("child").parentId,"head");
    s.addNode(node("later",undefined,"a","head"));s.reparentNode("child","unrelated");s.addEdge("later","unrelated","later-label");s.unmergeCard("h");
    assert.ok(s.getNode("member"));assert.equal(s.getNode("child").parentId,"unrelated");assert.ok(s.getNode("later"));
    assert.ok(s.edges.some(e=>e.from==="member"&&e.label==="original-label"));assert.ok(s.edges.some(e=>e.label==="later-label"));
  });
  await test("removing a group head recovers its members rather than stranding their pending rows",async()=>{
    const {store:s}=await setup([card("h"),card("a",{page:1}),card("b")]);s.enqueueReview(["a","b"],"a",new Date(time));s.mergeCards("h",["a","b"]);s.removeCard("h");
    assert.equal(s.getCard("h"),undefined);assert.ok(s.getCard("a"));assert.ok(s.getCard("b"));assert.ok(s.cards.every(c=>!c.groupId));assert.equal(s.reviewPending.length,2);
  });
  await test("automatic merge gate rejects each protected content or relationship",async()=>{
    const variants=[
      s=>s.updateCard("target",{page:1}),s=>s.updateCard("source",{page:undefined}),s=>s.updateCard("source",{title:"Title"}),s=>s.updateCard("source",{back:"Note"}),
      s=>s.addNode(node("child",undefined,"a","source-node")),s=>s.updateCard("source",{links:["target"]}),s=>s.updateCard("target",{groupMode:true}),s=>s.updateCard("target",{draft:true}),
      s=>s.addNode(node("reference","target","b",null,{sourceNodeId:"target-node",reference:true})),s=>s.createReviewCopy("source"),s=>s.updateCard("source",{groupId:"target"}),
    ];
    for (const mutate of variants) {const {store:s}=await setup([card("source",{page:1}),card("target",{front:""})],[node("source-node","source","a"),node("target-node","target","a")]);
      assert.equal(s.canAutoMerge("source","target"),true);mutate(s);assert.equal(s.canAutoMerge("source","target"),false);}
  });
  await test("mixed occlusion selection clears the group atomically with synchronized dates and undo",async()=>{
    const {store:s}=await setup([card("h",{occluded:true}),card("a",{page:1}),card("b",{occluded:false})]);s.mergeCards("h",["a"]);s.toggleCardOcclusion(["h","b"]);
    assert.equal(s.getCard("h").occluded,false);assert.equal(s.getCard("a").occluded,false);assert.equal(s.getCard("b").occluded,false);
    assert.equal(s.getCard("h").updatedAt,s.getCard("a").updatedAt);s.undoLibraryChange();assert.equal(s.getCard("h").occluded,true);
    s.toggleCardOcclusion(["a"]);assert.equal(s.getCard("h").occluded,false);
  });
  await test("local group occlusion survives materialization but stays independent of another reference",async()=>{
    const {store:s}=await setup([card("h"),card("a",{page:1})],[node("head","h","a"),node("member","a","a")]);s.mergeNodes(["head","member"]);s.toggleNodeOcclusion(["head"]);s.unmergeCard("h");
    assert.equal(s.getNode("head").occluded,true);assert.equal(s.getNode("member").occluded,true);assert.equal(s.getCard("a").occluded,true);
  });
  await test("text range add/remove is one persisted undo action and never cuts a Unicode pair",async()=>{
    const {store:s,reload}=await setup([card("c",{front:"A🙂BC"})]);s.toggleTextCloze("c","excerpt",3,4);assert.equal(s.getCard("c").front,"A🙂{{B}}C");assert.ok(s.getCard("c").updatedAt);
    s.undoLibraryChange();assert.equal(s.getCard("c").front,"A🙂BC");s.redoLibraryChange();const loaded=await reload();assert.equal(loaded.getCard("c").front,"A🙂{{B}}C");
    loaded.toggleTextCloze("c","excerpt",5,6);assert.equal(loaded.getCard("c").front,"A🙂BC");assert.throws(()=>loaded.toggleTextCloze("c","excerpt",1,2));
    assert.throws(()=>api.togglePlainCloze("{{c1::text}}",6,8));assert.equal(api.togglePlainCloze("{{answer}}",0,10),"answer");
  });
  await test("plain cloze export unwraps nested bold once and preserves cN as a separate extension",()=>{
    assert.equal(api.clozeForExport("{{**alpha**}} {{beta}} {{c1::gamma::hint}}"),"**alpha** **beta** **gamma**");
    assert.deepEqual(api.clozeIndices("{{plain}} {{c1::numbered}} {{c0::invalid}}"),[0,1]);assert.equal(api.hasCloze("{{c0::invalid}}"),false);
  });
  await test("editing an enrolled basic question into plain cloze keeps it due without inventing a review",async()=>{
    const {store:s}=await setup([card("c",{front:"answer"})]);s.enqueueReview(["c"],"a",new Date(time));
    const before=s.getReviewState("c","c::scope:a::basic"),logs=s.reviewLogs.length;
    s.toggleTextCloze("c","excerpt",0,6);assert.equal(s.pendingQuestions("a")[0].id,"c::scope:a::cloze:0");
    assert.deepEqual(s.getReviewState("c","c::scope:a::cloze:0"),before);assert.equal(s.reviewLogs.length,logs);
    s.undoLibraryChange();assert.equal(s.pendingQuestions("a")[0].id,"c::scope:a::basic");
    s.redoLibraryChange();s.toggleTextCloze("c","excerpt",0,10);assert.equal(s.pendingQuestions("a")[0].id,"c::scope:a::basic");assert.equal(s.reviewLogs.length,logs);
  });
  await test("recall keys use the evidenced rect/range formats and a reversible memory-only single peek",()=>{
    assert.equal(api.maskRectKey(2,{x:1.24,y:2.26,w:10,h:4}),"maskrect:2|1.2,2.3,10.0,4.0");assert.equal(api.maskRangeKey("note",3,5),"maskrange:note|3,5");assert.equal(api.maskRangeKey("",3,5),"");
    const session=new api.RecallSession();session.toggle("one");session.toggle("two",true);assert.equal(session.has("one"),false);assert.equal(session.has("two"),true);
    session.toggle("two",true);assert.equal(session.has("two"),false);session.toggle("");assert.equal(session.has(""),false);
  });
  await test("selected review copy content and masks are independent before enrollment",async()=>{
    const {store:s}=await setup([card("c",{title:"Title",back:"Note",image:"image",occlusions:[{id:"m1",x:0,y:0,width:.2,height:.2},{id:"m2",x:.5,y:.5,width:.2,height:.2}]})]);
    const copy=s.createReviewCopy("c","a",{parts:["title","images"],maskIds:["m2"]});assert.equal(copy.front,"");assert.equal(copy.back,undefined);assert.equal(copy.title,"Title");assert.deepEqual(copy.occlusions.map(m=>m.id),["m2"]);
    copy.occlusions[0].x=.6;assert.equal(s.getCard("c").occlusions[1].x,.5);assert.equal(s.reviewPending.length,0);assert.equal(s.getCard("c").front,"c text");
  });
  await test("conflicting group versions remap archived members, nodes, pending and reversible presentation",async()=>{
    const make=async text=>{const item=await setup([card("h"),card("plain",{front:text})],[node("head","h","a"),node("member","plain","a")]);item.store.enqueueReview(["plain"],"a",new Date(time));item.store.mergeNodes(["head","member"]);await item.store.flush();return item.disk();};
    const merged=api.mergePreservingVersions(await make("local"),await make("remote"));const {store:s}=await fresh(merged);const heads=s.cards.filter(c=>c.mergedCards?.length);assert.equal(heads.length,2);
    assert.notEqual(heads[0].mergedCards[1].id,heads[1].mergedCards[1].id);assert.notEqual(heads[0].mergeArchive.collapsedNodeIds[0],heads[1].mergeArchive.collapsedNodeIds[0]);
    for(const head of heads)s.unmergeCard(head.id);assert.equal(s.cards.length,4);assert.equal(new Set(s.nodes.map(n=>n.id)).size,4);assert.equal(s.reviewPending.length,2);
  });
  await test("conflict merge keeps each excerpt destination attached to its own canvas and node",()=>{
    const make=label=>({schemaVersion:2,revision:1,settings:{},cards:[card('c',{front:label})],nodes:[node('n','c','v',null,{title:label})],edges:[],srs:{},studySets:[{id:'s',name:label,docPaths:[],createdAt:time,excerptDestination:{canvasId:'v',nodeId:'n'}}],canvases:[{id:'v',studySetId:'s',name:label,createdAt:time}]});
    const merged=api.mergePreservingVersions(make('local'),make('remote'));
    assert.equal(merged.studySets.length,2);for(const set of merged.studySets){const target=merged.nodes.find(n=>n.id===set.excerptDestination.nodeId),canvas=merged.canvases.find(c=>c.id===set.excerptDestination.canvasId);assert.ok(target&&canvas);assert.equal(target.canvasId,canvas.id);assert.equal(canvas.studySetId,set.id);assert.equal(target.title,set.name.replace('（外部版本）',''));}
  });
  await test("newer visited pending cannot revive an older active row during conflict reconciliation",()=>{
    const row={id:"old",cardId:"c",questionId:"c",due:time,queuedAt:time};const entries=api.coalesceReviewPending([row,{...row,id:"new",queuedAt:"2020-01-03",visited:true}]);
    assert.equal(entries.length,1);assert.equal(entries[0].visited,true);
  });
  await writeFile(new URL("./l3-acceptance-results.json",import.meta.url),JSON.stringify({environment:"in-memory synthetic Store and mocked Obsidian; no original-app L4 or native integration",results},null,2)+"\n");
  console.log(`\n${results.filter(r=>r.passed).length}/${results.length} L3 model checks passed.`);
} finally {for(const store of stores)if(store.saveTimer!==null)clearTimeout(store.saveTimer);await rm(temporary,{recursive:true,force:true});}
