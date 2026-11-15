/** Real workspace/Store/components; isolated files and public Obsidian host adapters. */
import { readFile, writeFile, mkdtemp, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { runBrowser } from "../../scripts/ego-harness.mjs";

const exec=promisify(execFile),here=dirname(fileURLToPath(import.meta.url)),project=await realpath(resolve(here,"../.."));
const workspaceAnchors=JSON.parse(await readFile(join(here,"anchors-502.json"),"utf8")).anchors;
const anchorRect=(state,element)=>{const anchor=workspaceAnchors.find(item=>item.state===state&&item.element===element);if(!anchor)throw new Error(`Missing 5.0.2 anchor: ${state} / ${element}`);return anchor.rect;};
const temporary=await realpath(await mkdtemp(join(tmpdir(),"marginstudy-workspace-ui-")));
for(const name of ["acceptance-fixture","obsidian-fixture"]){
  let source=(await readFile(join(here,name+".txt"),"utf8")).replaceAll("__PROJECT__",project);
  if(name==="acceptance-fixture"){
    source=source.replaceAll('aria-label="StudySet"','aria-label="学习集"')
      .replaceAll('aria-label="AI TOC"','aria-label="AI 目录"')
      .replaceAll("button(nav,'AI TOC')","button(nav,'AI 目录')")
      .replaceAll("button(nav,'Indent')","button(nav,'增加缩进')")
      .replaceAll("button(nav,'Outdent')","button(nav,'减少缩进')")
      .replaceAll("button(nav,'Delete')","button(nav,'删除')")
      .replaceAll("button(settings,'Close')","button(settings,'关闭')")
      .replaceAll("button(prefs,'Close')","button(prefs,'关闭')")
      .replaceAll("textContent==='Extend'","textContent==='留白'")
      .replaceAll("node=>node.textContent==='留白'","node=>node.dataset.actionId==='extend'")
      .replaceAll("button(modal,'Cancel')","button(modal,'取消')")
      .replaceAll("button(document.querySelector('[aria-label=\"AI 目录\"]')!,'Cancel')","button(document.querySelector('[aria-label=\"AI 目录\"]')!,'取消')")
      .replaceAll("input.value='Renamed';button(dialog,'OK')","input.value='Renamed';button(dialog,'确定')");
  }
  await writeFile(join(temporary,name+".ts"),source);
}
for(const name of ["fakePdf","fakeMammoth"])await writeFile(join(temporary,name+".ts"),await readFile(join(project,"src/documents/acceptance-fixtures",name+".txt"),"utf8"));
const fixturePaths=["Alpha.html","Middle.html","Final.html","Beta.md","Gamma.docx","Delta.pdf","Slow.html"];
const hashes=Object.fromEntries(fixturePaths.map(path=>[path,createHash("sha256").update(path).digest("hex")]));
await writeFile(join(temporary,"fakePdf.ts"),(await readFile(join(temporary,"fakePdf.ts"),"utf8"))+"\nexport async function initPdfWorker() {}\n");
await writeFile(join(temporary,"crypto.ts"),`const hashes=${JSON.stringify(hashes)};export function createHash(){let input;return{update(value){input=value;return this;},digest(){if(!(input in hashes))throw new Error('Unlisted synthetic hash input: '+input);return hashes[input];}}}`);
await writeFile(join(temporary,"unused-network.ts"),"export function request(){throw new Error('AI network transport is outside this workspace UI fixture');}");
const styles=await Promise.all(["styles.css","styles-reader.css","styles-mindmap.css","styles-organize.css","styles-workspace.css"].map(name=>readFile(join(project,name),"utf8")));
await writeFile(join(temporary,"styles.css"),styles.join("\n"));
await writeFile(join(temporary,"index.html"),'<!doctype html><meta charset="utf-8"><title>MarginStudy workspace synthetic acceptance</title><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0;height:100%}#fixtures{height:100vh;width:100vw}.test-item-view{height:100%;width:100%;display:flex;flex-direction:column}.test-item-view>.view-content{height:100%;width:100%;overflow:hidden}#test-menu{position:fixed;top:65px;right:8px;z-index:9999;background:white;border:1px solid #aaa;display:flex;flex-direction:column}#test-menu button{padding:8px}</style><main id="fixtures"></main><script type="module" src="/fixture.js"></script>');
await build({entryPoints:[join(temporary,"acceptance-fixture.ts")],bundle:true,platform:"browser",format:"esm",target:"chrome120",outfile:join(temporary,"fixture.js"),plugins:[{name:"public-synthetic-host-adapters",setup(builder){
  builder.onResolve({filter:/^obsidian$/},()=>({path:join(temporary,"obsidian-fixture.ts")}));
  builder.onResolve({filter:/^crypto$/},()=>({path:join(temporary,"crypto.ts")}));
  builder.onResolve({filter:/^(?:http|https)$/},()=>({path:join(temporary,"unused-network.ts")}));
  builder.onResolve({filter:/^mammoth$/},()=>({path:join(temporary,"fakeMammoth.ts")}));
  builder.onResolve({filter:/\/pdfjs$/},()=>({path:join(temporary,"fakePdf.ts")}));
}}]});
const allowed=new Set(["index.html","fixture.js","styles.css"]);
const server=createServer(async(request,response)=>{const name=new URL(request.url,"http://127.0.0.1").pathname.slice(1)||"index.html";if(name==="_capacitor_file_/_marginstudy-media/test.png"){response.setHeader("Content-Type","image/png");response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aN0AAAAASUVORK5CYII=","base64"));return;}if(!allowed.has(name)){response.statusCode=404;response.end();return;}response.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":"text/html; charset=utf-8");response.end(await readFile(join(temporary,name)));});
await new Promise(done=>server.listen(0,"127.0.0.1",done));
const session=`marginstudy-workspace-${process.pid}`;
const browser=(...args)=>runBrowser(session,...args);
async function pageCdp(){
  return {send:(method,params={})=>browser("cdp",method,JSON.stringify(params)),close:()=>{}};
}
try{
  await browser("open","about:blank");
  await browser("set","viewport","1512","949");
  await browser("open",`http://127.0.0.1:${server.address().port}`);
  const deadline=Date.now()+300000;
  for(;;){const snapshot=JSON.parse((await browser("eval","({done:window.done,fatal:window.fatal})")).stdout);if(snapshot.done||snapshot.fatal||Date.now()>deadline)break;await new Promise(done=>setTimeout(done,400));}
  const wheelBefore=JSON.parse((await browser("eval","window.showWheelScrollScene()")).stdout);
  const cdp=await pageCdp(),wheelX=Math.round(wheelBefore.rect.left+wheelBefore.rect.width/2),wheelY=Math.round(wheelBefore.rect.top+wheelBefore.rect.height/2);
  try{
    await cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:wheelX,y:wheelY,button:"none"});
    await cdp.send("Input.dispatchMouseEvent",{type:"mouseWheel",x:wheelX,y:wheelY,deltaX:0,deltaY:120,button:"none"});await new Promise(done=>setTimeout(done,120));
    const wheelAfterVertical=JSON.parse((await browser("eval","({scrollLeft:document.querySelector('.ms-mindmap').scrollLeft,scrollTop:document.querySelector('.ms-mindmap').scrollTop})")).stdout);
    await cdp.send("Input.dispatchMouseEvent",{type:"mouseWheel",x:wheelX,y:wheelY,deltaX:120,deltaY:0,button:"none"});await new Promise(done=>setTimeout(done,120));
    const wheelBeforeDiagonal=JSON.parse((await browser("eval","(()=>{const scroll=document.querySelector('.ms-mindmap'),world=document.querySelector('.ms-mindmap-world');return {scrollLeft:scroll.scrollLeft,scrollTop:scroll.scrollTop,transform:world.style.transform,nodes:JSON.stringify(window.wheelSceneStore.nodes)};})()")).stdout);
    await cdp.send("Input.dispatchMouseEvent",{type:"mouseWheel",x:wheelX,y:wheelY,deltaX:60,deltaY:-80,button:"none"});await new Promise(done=>setTimeout(done,120));
  await browser("eval",`(()=>{const scroll=document.querySelector('.ms-mindmap'),world=document.querySelector('.ms-mindmap-world'),nodes=JSON.stringify(window.wheelSceneStore.nodes),events=window.wheelProbe?.events??[],before=${JSON.stringify(wheelBefore)},vertical=${JSON.stringify(wheelAfterVertical)},beforeDiagonal=${JSON.stringify(wheelBeforeDiagonal)},after={scrollLeft:scroll.scrollLeft,scrollTop:scroll.scrollTop,transform:world.style.transform,nodes},verticalEvents=events.filter(event=>event.deltaY>0&&event.deltaX===0),horizontalEvents=events.filter(event=>event.deltaX>0&&event.deltaY===0),diagonalEvents=events.filter(event=>event.deltaX===60&&event.deltaY===-80);window.results.push({name:'Trusted automated mouse wheel moves the map vertically and horizontally without changing scale or node coordinates',passed:verticalEvents.length>0&&horizontalEvents.length>0&&[...verticalEvents,...horizontalEvents].every(event=>event.trusted&&!event.defaultPrevented&&!event.ctrlKey&&!event.metaKey)&&vertical.scrollTop>before.scrollTop&&beforeDiagonal.scrollTop===vertical.scrollTop&&beforeDiagonal.scrollLeft>vertical.scrollLeft&&world.style.transform===before.transform&&nodes===before.nodes,error:JSON.stringify({before,vertical,beforeDiagonal,after,probe:window.wheelProbe})});window.results.push({name:'Trusted automated diagonal mouse wheel moves both map axes without changing scale or node coordinates',passed:diagonalEvents.length===1&&diagonalEvents.every(event=>event.trusted&&event.defaultPrevented&&!event.ctrlKey&&!event.metaKey)&&after.scrollLeft>beforeDiagonal.scrollLeft&&after.scrollTop<beforeDiagonal.scrollTop&&after.transform===beforeDiagonal.transform&&after.nodes===beforeDiagonal.nodes,error:JSON.stringify({beforeDiagonal,after,diagonalEvents,probe:window.wheelProbe})});})()`);
  }finally{cdp.close();}
  await browser("eval","window.showTocDragScene()");
  await browser("eval",`window.dragEvents=[];for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,event=>window.dragEvents.push({type,x:event.clientX,y:event.clientY,target:event.target.outerHTML?.slice(0,250),hit:document.elementFromPoint(event.clientX,event.clientY)?.outerHTML?.slice(0,250)}),true)`);
  const dragPoints=JSON.parse((await browser("eval",`(()=>{const a=document.querySelector('[aria-label="拖动目录 Drag last"]').getBoundingClientRect(),b=document.querySelector('[aria-label="Drag first"]').getBoundingClientRect();return {from:[a.x+a.width/2,a.y+a.height/2],to:[b.x+b.width/2,b.y+2]};})()`)).stdout);
  await browser("mouse","move",...dragPoints.from.map(value=>String(Math.round(value))));await browser("mouse","down");
  await browser("mouse","move",...dragPoints.to.map(value=>String(Math.round(value))),"--steps","12");await browser("mouse","up");
  await browser("eval",`new Promise(resolve=>setTimeout(()=>{const order=[...document.querySelectorAll('.ms-toc-row .ms-document-outline-entry')].map(node=>node.textContent);window.results.push({name:'PDF TOC reorders using trusted browser mouse drag',passed:order.join('|')==='Drag last|Drag first',error:order.join('|'),events:window.dragEvents});resolve();},100))`);
  await browser("eval","window.showWorkspaceScene()");
  const capsuleGeometry=[];
  for(const [width,height] of [[1280,800],[1024,768],[800,600]]) {
    await browser("set","viewport",String(width),String(height));
    const modes=[];
    for(const [mode,label,expectedWidth] of [["reading","阅读",282],["writing","书写",614],["recall","回忆",378]]) {
      const geometry=JSON.parse((await browser("eval",`(async()=>{document.querySelector('.ms-bottom-capsule-shell [aria-label="${label}"]').click();if('${mode}'==='reading')document.querySelector('.ms-bottom-capsule-shell [aria-label="标题链接"]').click();await new Promise(resolve=>requestAnimationFrame(resolve));const root=document.querySelector('.ms-study-workspace').getBoundingClientRect(),pill=document.querySelector('.ms-bottom-primary').getBoundingClientRect(),collapse=document.querySelector('.ms-bottom-collapse').getBoundingClientRect(),notice=document.querySelector('.ms-workspace-notice')?.getBoundingClientRect(),buttons=[...document.querySelectorAll('.ms-bottom-action')].filter(item=>item.checkVisibility()).map(item=>({label:item.getAttribute('aria-label'),...item.getBoundingClientRect().toJSON()}));return {mode:'${mode}',viewport:[innerWidth,innerHeight],root:root.toJSON(),pill:pill.toJSON(),collapse:collapse.toJSON(),notice:notice?.toJSON(),buttons};})()`)).stdout);
      geometry.passed=geometry.viewport[0]===width&&geometry.viewport[1]===height&&Math.abs(geometry.pill.width-expectedWidth)<=4&&Math.abs(geometry.pill.height-45)<=2&&Math.abs(geometry.root.bottom-geometry.pill.bottom-24)<=2&&Math.abs(geometry.pill.top-geometry.collapse.bottom-5)<=2&&geometry.pill.left>=geometry.root.left-1&&geometry.pill.right<=geometry.root.right+1&&(mode!=='reading'||!!geometry.notice&&Math.abs(geometry.pill.top-geometry.notice.bottom)<=4)&&geometry.buttons.every(item=>item.left>=geometry.pill.left-1&&item.right<=geometry.pill.right+1&&Math.abs(item.top+item.height/2-geometry.pill.top-geometry.pill.height/2)<=2);
      modes.push(geometry);
      await browser("screenshot",join(temporary,`capsule-${width}x${height}-${mode}.png`));
    }
    capsuleGeometry.push(...modes);
    await browser("eval",`window.results.push(${JSON.stringify({name:`Bottom capsule remains aligned and reachable in all three modes at ${width}×${height}`,passed:modes.every(mode=>mode.passed),error:JSON.stringify(modes)})})`);
  }
  const a07Geometry=[];
  for(const [width,height] of [[1512,949],[1292,914],[1024,768],[756,855],[380,700]]){
    await browser("set","viewport",String(width),String(height));await browser("eval","window.showA07Scene()");
    const geometry=JSON.parse((await browser("eval","(()=>{const pane=document.querySelector('[aria-label=\"学习集\"]');const box=pane.getBoundingClientRect();return {viewport:[innerWidth,innerHeight],box:box.toJSON(),create:pane.querySelector('.ms-study-home-create')?.getBoundingClientRect().toJSON(),scrollWidth:pane.scrollWidth,clientWidth:pane.clientWidth,sections:[...pane.querySelectorAll('[data-home-section]')].map(x=>x.getAttribute('data-home-section'))};})()")).stdout);
    geometry.passed=geometry.viewport[0]===width&&geometry.viewport[1]===height&&geometry.box.left>=0&&geometry.box.right<=width+1&&geometry.create?.left>=0&&geometry.create?.right<=width&&geometry.scrollWidth<=geometry.clientWidth+1&&geometry.sections.join('|')==='学习集|卡组|资料库';
    a07Geometry.push(geometry);await browser("screenshot",join(temporary,`a07-home-${width}x${height}.png`));
    await browser("eval",`window.results.push(${JSON.stringify({name:`A07 home fits ${width}×${height} without horizontal overflow`,passed:geometry.passed,error:JSON.stringify(geometry)})})`);
  }
  for(const [width,height] of [[1512,949],[1024,768],[380,700]]){
    await browser("set","viewport",String(width),String(height));await browser("eval","window.showA30Scene()");
    const sceneHeader=JSON.parse((await browser("eval",`(()=>{const root=document.querySelector('.ms-study-workspace').getBoundingClientRect(),header=document.querySelector('.ms-workspace-toolbar.has-scene-header').getBoundingClientRect(),context=document.querySelector('.ms-workspace-context'),toggle=document.querySelector('[aria-label="工作区工具"]'),button=toggle.getBoundingClientRect(),closed=!document.querySelector('.ms-workspace-toolbar-controls').checkVisibility();toggle.click();const controls=document.querySelector('.ms-workspace-toolbar-controls'),tools=controls.getBoundingClientRect(),opened=controls.checkVisibility()&&toggle.getAttribute('aria-expanded')==='true';return {viewport:[innerWidth,innerHeight],root:root.toJSON(),header:header.toJSON(),button:button.toJSON(),tools:tools.toJSON(),closed,opened,contextScrollable:context.scrollWidth>=context.clientWidth};})()`)).stdout);
    sceneHeader.reachabilityPassed=sceneHeader.viewport[0]===width&&sceneHeader.viewport[1]===height&&sceneHeader.closed&&sceneHeader.opened&&sceneHeader.button.left>=sceneHeader.root.left-1&&sceneHeader.button.right<=sceneHeader.root.right+1&&sceneHeader.tools.left>=sceneHeader.root.left-1&&sceneHeader.tools.right<=sceneHeader.root.right+1;
    sceneHeader.headerHeightProductPassed=sceneHeader.viewport[0]===width&&sceneHeader.viewport[1]===height&&sceneHeader.header.height<=46;
    await browser("screenshot",join(temporary,`a30-header-${width}x${height}.png`));
    await browser("eval",`window.results.push(${JSON.stringify({name:`A30 product reachability: scene header tools ${width}×${height}`,passed:sceneHeader.reachabilityPassed,error:JSON.stringify(sceneHeader)})})`);
    await browser("eval",`window.results.push(${JSON.stringify({name:`A30 product threshold: header height ≤46 at ${width}×${height}`,passed:sceneHeader.headerHeightProductPassed,error:JSON.stringify({viewport:sceneHeader.viewport,height:sceneHeader.header.height})})})`);
  }
  for(const [width,height,expected] of [[1512,855,"row"],[756,855,"column"],[756,427,"row"]]){
    await browser("set","viewport",String(width),String(height));await browser("eval","window.showA30Scene()");
    const split=JSON.parse((await browser("eval",`(()=>{const root=document.querySelector('.ms-study-workspace'),body=root.querySelector('.ms-workspace-body'),reader=root.querySelector('.ms-workspace-reader'),map=root.querySelector('.ms-workspace-map'),divider=root.querySelector('.ms-workspace-splitter-main');return {viewport:[innerWidth,innerHeight],direction:getComputedStyle(body).flexDirection,reader:reader.getBoundingClientRect().toJSON(),map:map.getBoundingClientRect().toJSON(),divider:divider.getBoundingClientRect().toJSON()};})()`)).stdout);
    const passed=split.viewport[0]===width&&split.viewport[1]===height&&split.direction===expected&&(expected==='column'?split.reader.bottom<=split.map.top+1:split.reader.right<=split.map.left+1);
    await browser("eval",`window.results.push(${JSON.stringify({name:`A30 document/map orientation ${width}×${height}`,passed,error:JSON.stringify(split)})})`);
  }
  const a30Geometry=[];
  for(const [width,height] of [[1512,855],[756,855],[756,852],[756,427]]){
    await browser("set","viewport",String(width),String(height));await browser("eval","window.showA30Scene()");
    const work=JSON.parse((await browser("eval",`(()=>{const root=document.querySelector('.ms-study-workspace'),context=root.querySelector('.ms-workspace-context'),row=root.querySelector('.ms-bottom-scene-tools[data-scene-id="excerpt"]'),tools=[...row.querySelectorAll('[data-ms-tool]')],tabs=[...root.querySelectorAll('.ms-bottom-scene-tab')],reader=root.querySelector('.ms-workspace-reader').getBoundingClientRect(),map=root.querySelector('.ms-workspace-map').getBoundingClientRect(),divider=root.querySelector('.ms-workspace-splitter-main').getBoundingClientRect(),floating=[...root.querySelectorAll('.ms-workspace-floating-action')].map(node=>({label:node.getAttribute('aria-label'),rect:node.getBoundingClientRect().toJSON()})),attachment=root.querySelector('.ms-workspace-attachment-capsule')?.getBoundingClientRect().toJSON()??null;return {viewport:[innerWidth,innerHeight],root:root.getBoundingClientRect().toJSON(),context:context.getBoundingClientRect().toJSON(),contextItems:[...context.querySelectorAll('button')].map(node=>({label:node.getAttribute('aria-label'),rect:node.getBoundingClientRect().toJSON()})),tabs:tabs.map(node=>({label:node.getAttribute('aria-label'),rect:node.getBoundingClientRect().toJSON()})),toolbar:tools.map(node=>({id:node.dataset.msTool,rect:node.getBoundingClientRect().toJSON()})),reader:reader.toJSON(),map:map.toJSON(),divider:divider.toJSON(),floating,attachment,outlineClosed:!root.querySelector('.ms-map-floating-panel')&&!root.querySelector('.ms-document-navigation')};})()`)).stdout);
    const ref=width===1512?{contextX:407,contextW:698,contextY:45,split:757.25}:height>=650?{contextX:29,contextW:698,contextY:45,split:468}:{contextX:29,contextW:698,contextY:45,split:377.5};
    const actualHeight=work.viewport[1],bottomOffset=width===756&&actualHeight===852?3:0,tallNarrow=width===756&&height>=650;
    const contextError=Math.abs(work.context.x-ref.contextX),contextWidthError=Math.abs(work.context.width-ref.contextW),contextYError=Math.abs(work.context.y-ref.contextY),splitPosition=tallNarrow?work.divider.y+work.divider.height/2:work.divider.x+work.divider.width/2,splitError=Math.abs(splitPosition-(tallNarrow?ref.split-bottomOffset:ref.split));
    const capItemRefs=width===1512?[[407,44],[454,122],[593,71.5],[679.5,217],[907.5,83.5],[1006,44],[1061,44]]:[[29,44],[76,122],[215,71.5],[301.5,217],[529.5,83.5],[628,44],[683,44]];
    work.capItemErrors=work.contextItems.map((item,index)=>({x:Math.abs(item.rect.x-capItemRefs[index][0]),width:Math.abs(item.rect.width-capItemRefs[index][1]),y:Math.abs(item.rect.y-45),height:Math.abs(item.rect.height-40)}));
    work.capItemError=Math.max(...work.capItemErrors.flatMap(item=>Object.values(item)));
    work.capRightError=Math.abs(work.context.right-(width===1512?1105:727));
    work.capItemCountError=Math.abs(work.contextItems.length-7);
    // 来源：BASELINE.json 06-workspace、06-workspace-medium、06-workspace-short。
    const workspaceState=width===1512?"06-workspace":height>=650?"06-workspace-medium":"06-workspace-short";
    const floatRefs=["floating:immersiveDocs","floating:immersiveAI"].map(element=>{const rect=anchorRect(workspaceState,element);return [rect[0],rect[1]-bottomOffset];});
    work.floatingErrors=work.floating.map((item,index)=>({x:Math.abs(item.rect.x-floatRefs[index][0]),y:Math.abs(item.rect.y-floatRefs[index][1]),width:Math.abs(item.rect.width-44),height:Math.abs(item.rect.height-44)}));
    work.floatingError=Math.max(...work.floatingErrors.flatMap(item=>Object.values(item)));
    const attachmentRect=anchorRect(workspaceState,"attachment"),attachmentRef={x:attachmentRect[0],y:attachmentRect[1],w:attachmentRect[2],h:attachmentRect[3]};
    work.attachmentError=work.attachment?Math.max(Math.abs(work.attachment.x-attachmentRef.x),Math.abs(work.attachment.y-attachmentRef.y),Math.abs(work.attachment.width-attachmentRef.w),Math.abs(work.attachment.height-attachmentRef.h)):Infinity;
    work.canvasBottomError=tallNarrow?Math.abs(work.map.bottom-(786.5-bottomOffset)):0;
    work.canvasSplitEdgeErrors=tallNarrow?{docBottom:Math.abs(work.reader.bottom-(468-bottomOffset)),canvasTop:Math.abs(work.map.top-(468-bottomOffset)),gap:Math.abs(work.map.top-work.reader.bottom)}:{docRight:Math.abs(work.reader.right-(width===1512?754.5:375)),canvasLeft:Math.abs(work.map.left-(width===1512?760:380)),gap:Math.abs((work.map.left-work.reader.right)-(width===1512?5.5:5))};
    work.canvasSplitEdgeError=Math.max(...Object.values(work.canvasSplitEdgeErrors));
    const findTool=id=>work.toolbar.find(item=>item.id===id)?.rect,tab=work.tabs[0]?.rect,toolRefs=width===1512?{tabX:387,tabW:42,hand:588,text:625,rectangle:662,extend:699,lasso:736,ink:820,title:955,block:1006,more:1105,moreW:22}:{tabX:68,tabW:56,hand:149,text:186,rectangle:223,extend:260,lasso:297,ink:381,title:516,block:567,more:666,moreW:22};
    const toolbarY=(height===427?365:793)-bottomOffset;
    const bottomErrors={tabX:Math.abs((tab?.x??Infinity)-toolRefs.tabX),tabWidth:Math.abs((tab?.width??Infinity)-toolRefs.tabW),tabY:Math.abs((tab?.y??Infinity)-toolbarY),hand:Math.abs((findTool('excerpt.hand')?.x??Infinity)-toolRefs.hand),text:Math.abs((findTool('excerpt.text')?.x??Infinity)-toolRefs.text),rectangle:Math.abs((findTool('excerpt.rectangle')?.x??Infinity)-toolRefs.rectangle),extend:Math.abs((findTool('excerpt.extend')?.x??Infinity)-toolRefs.extend),lasso:Math.abs((findTool('lasso')?.x??Infinity)-toolRefs.lasso),ink:Math.abs((findTool('ink')?.x??Infinity)-toolRefs.ink),title:Math.abs((findTool('title-links')?.x??Infinity)-toolRefs.title),block:Math.abs((findTool('block-selection')?.x??Infinity)-toolRefs.block),more:Math.abs((findTool('excerpt.more')?.x??Infinity)-toolRefs.more),moreWidth:Math.abs((findTool('excerpt.more')?.width??Infinity)-toolRefs.moreW),toolY:Math.abs((findTool('excerpt.hand')?.y??Infinity)-toolbarY),toolbarHeight:Math.abs((findTool('excerpt.hand')?.height??Infinity)-32),toolbarBottom:Math.abs(work.viewport[1]-((findTool('excerpt.hand')?.y??0)+32)-30)};
    work.contextError=contextError;work.contextWidthError=contextWidthError;work.contextYError=contextYError;work.splitError=splitError;work.bottomErrors=bottomErrors;work.bottomError=Math.max(...Object.values(bottomErrors));work.bottomOffsetForHostHeight=bottomOffset;
    let scenePickerPass=true;
    if(width===756){await browser("eval",`(()=>{const root=document.querySelector('.ms-study-workspace'),active=root.querySelector('.ms-bottom-scene-tab[aria-selected="true"]');active.click();const menu=root.querySelector('[aria-label="切换场景"]');if(!menu)throw new Error('compact scene picker did not open');const option=[...menu.querySelectorAll('button')].find(button=>button.textContent==='手写');if(!option)throw new Error('compact scene picker omitted the handwriting scene');option.click();})()`);scenePickerPass=JSON.parse((await browser("eval",`(()=>({opened:!!document.querySelector('[aria-label="切换场景"]'),selected:document.querySelector('.ms-bottom-scene-tools')?.dataset.sceneId}))()`)).stdout).selected==='handwriting';}
    work.scenePickerPass=scenePickerPass;work.referencePassed=work.viewport[0]===width&&work.viewport[1]===height&&contextError<=4&&contextWidthError<=4&&contextYError<=4&&splitError<=4&&work.bottomError<=4&&work.capItemError<=4&&work.capItemCountError===0&&work.capRightError<=4&&work.floatingError<=4&&work.attachmentError<=4&&work.canvasBottomError<=4&&work.canvasSplitEdgeError<=4&&work.outlineClosed;
    a30Geometry.push(work);
    await browser("eval",`window.results.push(${JSON.stringify({name:`A30 workspace reference alignment and actual viewport ${width}×${height}`,passed:work.referencePassed,error:JSON.stringify(work)})})`);
    await browser("eval",`window.results.push(${JSON.stringify({name:`A30 product reachability: compact scene picker ${width}×${height}`,passed:work.scenePickerPass,error:JSON.stringify({viewport:work.viewport,passed:work.scenePickerPass})})})`);
    await browser("eval","window.showA30HomeScene()");
    const home=JSON.parse((await browser("eval","window.readA30HomeGeometry()" )).stdout);
    const card=home.cards[0],next=home.cards[1];
    const expectedColumns=width===1512?5:1;
    const actualColumns=home.grid.trim().split(/\s+/).filter(Boolean).length;
    home.expectedColumns=expectedColumns;home.actualColumns=actualColumns;
    home.cardError=card?{x:Math.abs(card.rect.x-309.5),y:Math.abs(card.rect.y-139),width:Math.abs(card.rect.width-(width===1512?216:357)),height:Math.abs(card.rect.height-200)}:null;
    home.cardRightError=card?Math.abs(card.rect.right-(width===1512?525.5:666.5)):Infinity;
    const lastColumn=home.cards[Math.min(expectedColumns-1,home.cards.length-1)];
    home.gridRightError=lastColumn?Math.abs(lastColumn.rect.right-(width===1512?1482.5:666.5)):Infinity;
    home.pitchError=next?(expectedColumns===5?Math.abs((next.rect.x-card.rect.x)-239.5):Math.abs((next.rect.y-card.rect.y)-235)):Infinity;
    home.columnGapError=expectedColumns===5&&next?Math.abs((next.rect.left-card.rect.right)-22.5):0;
    const nextRow=width===1512?home.cards[5]:home.cards[1];home.rowPitchError=nextRow&&card?Math.abs((nextRow.rect.y-card.rect.y)-235):Infinity;
    home.rightMarginError=lastColumn?Math.abs(width-lastColumn.rect.right-(width===1512?29.5:89.5)):Infinity;
    home.sidebarErrors=home.nav?{left:Math.abs(home.nav.x-7.5),right:Math.abs(home.nav.right-272.5),width:Math.abs(home.nav.width-265)}:null;
    const byNav=label=>home.navItems.find(item=>item.aria===label||item.label===label),byFooter=label=>home.footerItems.find(item=>item.label===label),navStudy=byNav('学习集'),navReview=byNav('复习卡组'),footerLibrary=byFooter('资料库'),footerVersion=byFooter('版本库'),footerSettings=byFooter('设置'),footerMore=byFooter('主页更多'),hBottomOffset=855-home.viewport[1];
    home.appActionErrors=home.appActions.map((item,index)=>({x:Math.abs(item.rect.x-(index===0?202:234)),y:Math.abs(item.rect.y-46),width:Math.abs(item.rect.width-30),height:Math.abs(item.rect.height-30)}));
    home.appActionError=home.appActionErrors.length===2?Math.max(...home.appActionErrors.flatMap(item=>Object.values(item))):Infinity;
    home.sidebarAnchorErrors={brandX:Math.abs((home.brandText?.x??Infinity)-22),brandY:Math.abs((home.brandText?.y??Infinity)-51),studyX:Math.abs((navStudy?.textRect?.x??Infinity)-58),studyY:Math.abs((navStudy?.textRect?.y??Infinity)-102),reviewX:Math.abs((navReview?.textRect?.x??Infinity)-58),reviewY:Math.abs((navReview?.textRect?.y??Infinity)-140),recentX:Math.abs((home.recentLabel?.x??Infinity)-21),recentY:Math.abs((home.recentLabel?.y??Infinity)-184),libraryX:Math.abs((footerLibrary?.textRect?.x??Infinity)-58),libraryY:Math.abs((footerLibrary?.textRect?.y??Infinity)-(731-hBottomOffset)),versionX:Math.abs((footerVersion?.rect.x??Infinity)-14),versionY:Math.abs((footerVersion?.rect.y??Infinity)-(773-hBottomOffset)),versionW:Math.abs((footerVersion?.rect.width??Infinity)-252),versionH:Math.abs((footerVersion?.rect.height??Infinity)-34),settingsX:Math.abs((footerSettings?.rect.x??Infinity)-20),settingsY:Math.abs((footerSettings?.rect.y??Infinity)-(809-hBottomOffset)),moreX:Math.abs((footerMore?.rect.x??Infinity)-230),moreY:Math.abs((footerMore?.rect.y??Infinity)-(809-hBottomOffset))};
    home.sidebarAnchorErrors.versionTextX=Math.abs((footerVersion?.textRect?.x??Infinity)-(footerLibrary?.textRect?.x??Infinity));
    // 来源：BASELINE.json 01-1512x855-library、02-756x855-library、03-756x427-library；旧值 308 为 5.0.0 遗留（窄视口）。
    const homeState=width===1512?"01-1512x855-library":height<=600?"03-756x427-library":"02-756x855-library";
    home.sidebarAnchorErrors.headingX=Math.abs((home.headTitle?.x??Infinity)-anchorRect(homeState,"home-heading")[0]);
    home.sidebarAnchorErrors.headingY=Math.abs((home.headTitle?.y??Infinity)-59.5);
    home.sidebarAnchorError=Math.max(...Object.values(home.sidebarAnchorErrors));
    const field=label=>home.headerFields.find(item=>item.label===label),categoryField=field('筛选学习集分类'),sortField=field('学习集排序'),selectField=field('选择学习集'),searchField=field('搜索学习集'),newField=field('新建学习集'),headerAnchor=id=>{const anchor=workspaceAnchors.find(item=>item.state===homeState&&item.id===id);if(!anchor)throw new Error(`Missing 5.0.2 anchor: ${homeState} / ${id}`);return anchor.rect;},categoryRef=headerAnchor("home.filter"),sortRef=headerAnchor("home.sort"),selectRef=headerAnchor("home.select"),searchRef=headerAnchor("home.search-text");
    home.headerAnchorErrors={categoryX:Math.abs((categoryField?.rect.x??Infinity)-categoryRef[0]),categoryY:Math.abs((categoryField?.rect.y??Infinity)-categoryRef[1]),categoryW:Math.abs((categoryField?.rect.width??Infinity)-categoryRef[2]),categoryH:Math.abs((categoryField?.rect.height??Infinity)-categoryRef[3]),sortX:Math.abs((sortField?.rect.x??Infinity)-sortRef[0]),sortY:Math.abs((sortField?.rect.y??Infinity)-sortRef[1]),sortW:Math.abs((sortField?.rect.width??Infinity)-sortRef[2]),sortH:Math.abs((sortField?.rect.height??Infinity)-sortRef[3]),selectX:Math.abs((selectField?.rect.x??Infinity)-selectRef[0]),selectY:Math.abs((selectField?.rect.y??Infinity)-selectRef[1]),selectW:Math.abs((selectField?.rect.width??Infinity)-selectRef[2]),selectH:Math.abs((selectField?.rect.height??Infinity)-selectRef[3]),searchX:Math.abs((searchField?.iconRect?.x??Infinity)-(searchRef[0]-21)),searchY:Math.abs((searchField?.iconRect?.y??Infinity)-(searchRef[1]+1.5)),searchW:Math.abs((searchField?.iconRect?.width??Infinity)-12.5),searchH:Math.abs((searchField?.iconRect?.height??Infinity)-13)};
    home.headerAnchorError=Math.max(...Object.values(home.headerAnchorErrors));
    home.newButtonReferenceError=width===1512&&newField?Math.max(Math.abs(newField.rect.x-1404),Math.abs(newField.rect.y-54),Math.abs(newField.rect.width-80.5),Math.abs(newField.rect.height-36)):0;
    home.headerProductReachable=!!newField&&newField.rect.left>=0&&newField.rect.right<=width&&newField.rect.top>=0&&newField.rect.bottom<=home.viewport[1]&&!home.horizontalOverflow;
    home.colors={page:home.pageBackground,sidebar:home.sidebarBackground,card:card?.background};
    home.colorPassed=home.colors.page==='rgb(249, 249, 249)'&&home.colors.sidebar==='rgb(252, 252, 252)'&&home.colors.card==='rgb(254, 254, 254)';
    home.referencePassed=home.viewport[0]===width&&home.viewport[1]===height&&actualColumns===expectedColumns&&!!card&&Object.values(home.cardError).every(value=>value<=4)&&home.cardRightError<=4&&home.gridRightError<=4&&home.pitchError<=.5&&home.columnGapError<=1&&home.rowPitchError<=4&&home.rightMarginError<=4&&!!home.sidebarErrors&&Object.values(home.sidebarErrors).every(value=>value<=4)&&home.colorPassed&&home.sidebarAnchorError<=4&&home.appActionError<=4&&home.headerAnchorError<=4&&home.newButtonReferenceError<=4;
    home.reachabilityPassed=home.headerProductReachable;
    home.passed=home.referencePassed;
    a30Geometry.push(home);
    await browser("eval",`window.results.push(${JSON.stringify({name:`A30 home reference alignment ${width}×${height}`,passed:home.referencePassed,error:JSON.stringify(home)})})`);
    await browser("eval",`window.results.push(${JSON.stringify({name:`A30 home product reachability ${width}×${height}`,passed:home.reachabilityPassed,error:JSON.stringify({viewport:home.viewport,horizontalOverflow:home.horizontalOverflow})})})`);
  }
  await browser("set","viewport","380","700");await browser("eval","window.showA09Scene()");
  const a09Geometry=JSON.parse((await browser("eval",`(()=>{const root=document.querySelector('.ms-study-workspace').getBoundingClientRect(),panel=document.querySelector('[aria-label="对照阅读面板"]').getBoundingClientRect(),divider=document.querySelector('[aria-label="调整对照文档宽度"]').getBoundingClientRect();return {viewport:[innerWidth,innerHeight],root:root.toJSON(),panel:panel.toJSON(),divider:divider.toJSON()};})()`)).stdout);
  a09Geometry.passed=a09Geometry.panel.width>0&&a09Geometry.panel.left>=a09Geometry.root.left-1&&a09Geometry.panel.right<=a09Geometry.root.right+1&&a09Geometry.panel.bottom<=a09Geometry.root.bottom+1&&a09Geometry.divider.width>0;
  await browser("screenshot",join(temporary,"a09-mobile-380x700.png"));
  await browser("eval","window.results.push("+JSON.stringify({name:"A09 comparison stays inside 380×700 mobile viewport",passed:a09Geometry.passed,error:JSON.stringify(a09Geometry)})+")");
  const result=JSON.parse((await browser("eval","({done:window.done,fatal:window.fatal,results:window.results,errors:window.testErrors})")).stdout);
  result.a09Geometry=a09Geometry;
  result.a07Geometry=a07Geometry;
  result.a30Geometry=a30Geometry;
  result.capsuleGeometry=capsuleGeometry;
  result.environment="Isolated Chromium; real workspace, Store, readers, mindmap and board; synthetic in-memory vault; public Obsidian host adapters; PDF.js/Mammoth adapters mocked; no native-app equivalence assertion";
  result.limitations=["Obsidian host lifecycle is mocked","PDF parsing/rendering and Word conversion are mocked","Trusted wheel checks use automated Chromium mouse-wheel input, not a physical trackpad","Synthetic pointer capture does not verify OS hardware input","Markdown rendering is a minimal host adapter","Native MarginNote and real Obsidian appearance are verified separately"];
  await writeFile(join(temporary,"results.json"),JSON.stringify(result,null,2));
  await browser("set","viewport","1512","949");
  await browser("eval","window.showWorkspaceScene && window.showWorkspaceScene()");
  await browser("screenshot",join(temporary,"workspace.png"));
  for (const [mode,label] of [["reading","阅读"],["writing","书写"],["recall","回忆"]]) {
    await browser("eval",`document.querySelector('.ms-bottom-capsule-shell [aria-label="${label}"]').click()`);
    await browser("screenshot",join(temporary,`capsule-${mode}.png`));
  }
  const failed=result.results?.filter(item=>!item.passed)??[];
  console.log(`${result.results?.length-failed.length}/${result.results?.length} workspace UI contract checks passed`);
  console.log(`Results: ${join(temporary,"results.json")}`);console.log(`Screenshot: ${join(temporary,"workspace.png")}`);
  if(result.fatal||!result.done||failed.length||result.errors?.length){console.error(JSON.stringify({fatal:result.fatal,failed,errors:result.errors},null,2));process.exitCode=1;}
}finally{await browser("close").catch(()=>{});await new Promise(done=>server.close(done));}
