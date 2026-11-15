import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runBrowserSync } from "../../scripts/ego-harness.mjs";

const dir = await mkdtemp(join(tmpdir(), "margin-perf1-"));
try {
  await build({ entryPoints: ["src/annot/pen.ts"], outfile: join(dir, "pen.js"), bundle: true, format: "iife", globalName: "PenModule", platform: "browser" });
  await writeFile(join(dir, "test.html"), `<!doctype html><style>.ms-pen-path{fill:none;stroke-linecap:round;stroke-linejoin:round}.host{position:relative;width:1000px;height:500px}</style><div class="host"></div><script src="pen.js"></script><script>
  const host = document.querySelector(".host"), svgNS = "http://www.w3.org/2000/svg";
  const points = Array.from({length:2000}, (_, i) => ({x: 10+i*.45, y: 250+50*Math.sin(i/40), pressure:.5+.4*Math.sin(i/30)}));
  function oldRun() {
    const svg = document.createElementNS(svgNS,"svg"); host.append(svg);
    let work=0, start=performance.now();
    let previous=points[0];svg.addEventListener("pointermove",event=>{const bounds=host.getBoundingClientRect(),rect=host.getBoundingClientRect(),point={x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height)),pressure:event.pressure};const path=document.createElementNS(svgNS,"path");path.setAttribute("class","ms-pen-path");path.setAttribute("stroke","black");path.setAttribute("d","M "+previous.x+" "+previous.y+" L "+point.x*bounds.width+" "+point.y*bounds.height);path.style.strokeWidth=String(.8+5*(previous.pressure+point.pressure)/2);svg.append(path);previous={x:point.x*bounds.width,y:point.y*bounds.height,pressure:point.pressure};});previous={x:points[0].x,y:points[0].y,pressure:points[0].pressure};
    for(let frame=0;frame<250;frame++){const tick=performance.now(); for(let j=0;j<8;j++){const i=frame*8+j;if(!i)continue;const p=points[i];svg.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerId:1,pointerType:"pen",clientX:p.x,clientY:p.y,pressure:p.pressure}));}work+=performance.now()-tick;}
    const total=performance.now()-start,nodes=svg.querySelectorAll("*").length;const bounds=host.getBoundingClientRect(), saved=points.map(p=>({x:Math.max(0,Math.min(1,(p.x-bounds.left)/bounds.width)),y:Math.max(0,Math.min(1,(p.y-bounds.top)/bounds.height)),pressure:new PointerEvent("pointermove",{pointerType:"pen",pressure:p.pressure}).pressure}));const layer=document.createElement("div"),tick=performance.now();PenModule.PenController.render(layer,[saved],1000,500,"black","pen",3);const commit=performance.now()-tick;const result={nodes,total,frame:work/250,commit,totalWithCommit:total+commit}; svg.remove();return result;
  }
  async function newRun() {
    const originalRAF=window.requestAnimationFrame;let paintWork=0;window.requestAnimationFrame=callback=>originalRAF.call(window,time=>{const tick=performance.now();callback(time);paintWork+=performance.now()-tick;});
    let committed;const controller=new PenModule.PenController(host,{getColor:()=>"black",getWidth:()=>3,onCommit:s=>committed=s});controller.setActive(true);
    const svg=host.querySelector("svg"), event=(type,p)=>new PointerEvent(type,{bubbles:true,pointerId:1,pointerType:"pen",isPrimary:true,button:0,clientX:p.x,clientY:p.y,pressure:p.pressure});
    svg.dispatchEvent(event("pointerdown",points[0]));let work=0, maxNodes=0, start=performance.now();
    for(let frame=0;frame<250;frame++){const tick=performance.now();for(let j=0;j<8;j++){const i=frame*8+j;if(i)svg.dispatchEvent(event("pointermove",points[i]));}work+=performance.now()-tick;await new Promise(resolve=>originalRAF.call(window,resolve));maxNodes=Math.max(maxNodes,svg.querySelectorAll("*").length);}
    const elapsed=performance.now()-start;window.requestAnimationFrame=originalRAF;const total=work+paintWork,commitStart=performance.now();svg.dispatchEvent(event("pointerup",points[1999]));const layer=document.createElement("div");host.append(layer);PenModule.PenController.render(layer,committed,1000,500,"black","pen",3);const commit=performance.now()-commitStart;
    const paths=layer.querySelectorAll("path");let exact=paths.length===committed[0].length-1;
    paths.forEach((path,i)=>{const a=committed[0][i],b=committed[0][i+1];exact=exact && path.getAttribute("d")==="M "+a.x*1000+" "+a.y*500+" L "+b.x*1000+" "+b.y*500 && Math.abs(Number(path.style.strokeWidth)-(.8+5*((a.pressure??.5)+(b.pressure??.5))/2))<.00001;});
    const oldPoints=points.map(p=>({x:Math.max(0,Math.min(1,(p.x-host.getBoundingClientRect().left)/1000)),y:Math.max(0,Math.min(1,(p.y-host.getBoundingClientRect().top)/500)),pressure:new PointerEvent("pointermove",{pointerType:"pen",pressure:p.pressure}).pressure}));
    const oldLayer=document.createElement("div");PenModule.PenController.render(oldLayer,[oldPoints],1000,500,"black","pen",3);
    async function pixels(svg){svg=svg.cloneNode(true);svg.setAttribute("xmlns",svgNS);svg.querySelectorAll("path").forEach(path=>{path.setAttribute("fill","none");path.setAttribute("stroke-linecap","round");path.setAttribute("stroke-linejoin","round");});const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:"image/svg+xml"}));const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});const canvas=document.createElement("canvas");canvas.width=1000;canvas.height=500;const ctx=canvas.getContext("2d");ctx.drawImage(img,0,0);URL.revokeObjectURL(url);return ctx.getImageData(0,0,1000,500).data;}
    const oldPixels=await pixels(oldLayer.querySelector("svg")),newPixels=await pixels(layer.querySelector("svg"));let changedPixels=0,inkPixels=0;for(let i=3;i<oldPixels.length;i+=4){if(oldPixels[i]||newPixels[i])inkPixels++;if(oldPixels[i]!==newPixels[i])changedPixels++;}
    controller.destroy();layer.remove();return {nodes:maxNodes,total,frame:total/250,commit,totalWithCommit:total+commit,elapsed,committed:committed[0].length,exact,changedPixels,inkPixels};
  }
  (async()=>{const baseline=oldRun(),optimized=await newRun();document.body.setAttribute("data-result",JSON.stringify({baseline,optimized}));})();
  </script>`);
  const browser = (...args) => runBrowserSync(`margin-perf1-${process.pid}`, ...args);
  let result;
  try {
    browser("open", `file://${join(dir, "test.html")}`);
    browser("wait", "6000");
    const output = browser("eval", "document.body.getAttribute('data-result')");
    result = JSON.parse(JSON.parse(output));
  } finally {
    browser("close");
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.optimized.exact || result.optimized.nodes > 3 || result.optimized.committed !== 2000 || result.optimized.changedPixels !== 0) throw new Error("Preview, point count, or final pixel assertion failed");
} finally {
  await rm(dir, { recursive: true, force: true });
}
