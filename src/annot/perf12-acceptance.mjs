import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { runBrowserSync } from "../../scripts/ego-harness.mjs";

const directory = mkdtempSync(join(tmpdir(), "marginstudy-perf12-"));
try {
  const output = join(directory, "penInput.mjs");
  await build({ entryPoints: ["src/annot/penInput.ts"], outfile: output, bundle: true, platform: "node", format: "esm" });
  const { predictInkPoint } = await import(pathToFileURL(output));
  const point = (x, y, time) => ({ x, y, time });
  assert.deepEqual(predictInkPoint([point(0, 0, 0), point(10, 0, 20), point(20, 0, 40)], 0), point(26, 0, 52));
  assert.equal(predictInkPoint([point(0, 0, 0), point(1, 0, 10), point(2, 0, 20)], 0), null);
  assert.equal(predictInkPoint([point(0, 0, 0), point(.1, 0, 20), point(.2, 0, 40)], 0), null);
  assert.equal(predictInkPoint([point(0, 0, 0), point(10, 0, 20), point(0, 0, 40)], 0), null);
  assert.equal(predictInkPoint([point(0, 0, 0), point(10, 0, 20), point(50, 0, 40)], 0), null);
  assert.equal(predictInkPoint([point(0, 0, 0), point(10, 0, 20), point(20, 0, 20)], 0), null);
  console.log("PERF-12 prediction: 6/6");
  await build({ entryPoints: ["src/annot/pen.ts"], outfile: join(directory, "pen.js"), bundle: true, format: "iife", globalName: "PenModule" });
  writeFileSync(join(directory, "index.html"), '<div id="host" style="width:500px;height:300px;position:relative"></div><script src="pen.js"></script>');
  const browser = (...args) => runBrowserSync(`perf12-${process.pid}`, ...args);
  try {
    browser("open", pathToFileURL(join(directory, "index.html")).href);
    const result = JSON.parse(browser("eval", `(async () => {
      const removed = [];
      for (let target=window; target; target=Object.getPrototypeOf(target)) {
        const descriptor=Object.getOwnPropertyDescriptor(target,"onpointerrawupdate");
        if (descriptor?.configurable) { removed.push([target,descriptor]); delete target.onpointerrawupdate; }
      }
      if ("onpointerrawupdate" in window) throw Error("unable to simulate unsupported raw events");
      let fallbackCount = 0;
      const fallbackHost=document.createElement("div"); fallbackHost.style.cssText="width:500px;height:300px;position:relative";
      document.body.append(fallbackHost);
      const fallbackController=new PenModule.PenController(fallbackHost,{getColor:()=>"black",onCommit:strokes=>fallbackCount=strokes[0].length});
      fallbackController.setActive(true);
      const fallbackSurface=fallbackHost.querySelector("svg");
      for (const [type,x] of [["pointerdown",10],["pointermove",20],["pointerup",30]])
        fallbackSurface.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:4,pointerType:"pen",isPrimary:true,button:0,clientX:x,clientY:30,pressure:.5}));
      fallbackController.destroy(); fallbackHost.remove();
      for (const [target,descriptor] of removed) Object.defineProperty(target,"onpointerrawupdate",descriptor);
      Object.defineProperty(window, "onpointerrawupdate", {value:null, configurable:true});
      let enabled = true, committed = [];
      PenModule.setInkPredictionReader(() => enabled);
      const host = document.querySelector("#host");
      const controller = new PenModule.PenController(host, {getColor:() => "black", onCommit: strokes => committed.push(strokes)});
      controller.setActive(true);
      PenModule.startPenPerf();
      const surface = host.querySelector("svg"), base = performance.now();
      const send = (type,x,time,id=1) => {
        const event = new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:"pen",isPrimary:true,button:0,clientX:x,clientY:30,pressure:.5});
        if (type === "pointerrawupdate") Object.defineProperty(event,"getCoalescedEvents",{value:() => { throw Error("raw expanded"); }});
        Object.defineProperty(event,"timeStamp",{value:base+time}); surface.dispatchEvent(event);
      };
      const stroke = async prediction => {
        enabled = prediction;
        send("pointerdown",10,0);
        send("pointerrawupdate",20,20);
        send("pointermove",20,20);
        send("pointerrawupdate",30,40);
        send("pointermove",30,40);
        send("pointerrawupdate",100,41,2);
        await new Promise(resolve => requestAnimationFrame(resolve));
        const canvas = host.querySelectorAll("canvas")[1];
        const pixels = canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data;
        const predicted = pixels.some(value => value !== 0);
        send("pointerup",30,50);
        return {predicted, remaining:host.querySelectorAll("canvas").length};
      };
      const on = await stroke(true), off = await stroke(false);
      send("pointerdown",10,100); send("pointermove",20,120); send("pointermove",30,140); send("pointerup",30,150);
      PenModule.startPenPerf();
      send("pointerdown",10,200);
      for (let index=1; index<=12; index++) {
        send("pointermove",10+index*2,200+index*16);
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      send("pointerup",34,410);
      const render = strokes => {
        const canvas = document.createElement("canvas"); canvas.width=500; canvas.height=300;
        PenModule.paintInkStrokes(canvas.getContext("2d"),strokes,500,300,"black");
        return canvas.toDataURL();
      };
      const perf = JSON.parse(PenModule.exportPenPerf())[0];
      return {fallbackCount,on,off, counts:committed.slice(0,3).map(strokes=>strokes[0].length), pixelsEqual:render(committed[0])===render(committed[1]),
        frameDurations:perf.frames.map(frame=>frame.dur),
        eventToPaint:perf.marks.paintBatch.map(mark=>mark-Math.max(...perf.moves.filter(move=>move.now<=mark).map(move=>move.now))).filter(Number.isFinite)};
    })()`));
    assert.equal(result.on.predicted, true);
    assert.equal(result.fallbackCount, 3);
    assert.equal(result.off.predicted, false);
    assert.equal(result.on.remaining + result.off.remaining, 0);
    assert.deepEqual(result.counts, [3, 3, 3]);
    assert.equal(result.pixelsEqual, true);
    console.log("PERF-12 browser: raw dedup, prediction, cleanup and final pixels passed");
    const percentile = (values, ratio) => [...values].sort((left,right)=>left-right)[Math.ceil(values.length*ratio)-1];
    console.log(`Synthetic browser (${result.frameDurations.length} frames) JS median/P90: ${percentile(result.frameDurations,.5)}/${percentile(result.frameDurations,.9)} ms; event to paint mark median/P90: ${percentile(result.eventToPaint,.5)}/${percentile(result.eventToPaint,.9)} ms`);
  } finally {
    browser("close");
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
