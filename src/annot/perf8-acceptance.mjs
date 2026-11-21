import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runBrowserSync } from "../../scripts/verify/ego-harness.mjs";
import { publicFixture } from "../../scripts/verify/fixtures.mjs";

const directory = mkdtempSync(join(tmpdir(), "marginstudy-perf8-"));
const browser = (...args) => runBrowserSync(`perf8-${process.pid}`, ...args);
const evaluate = expression => JSON.parse(browser("eval", expression));
const assert = (value, message) => { if (!value) throw new Error(message); };

try {
  await build({ entryPoints: ["src/annot/pen.ts"], outfile: join(directory, "pen.js"), bundle: true, format: "iife", globalName: "PenModule" });
  writeFileSync(join(directory, "index.html"), '<div id="host" style="width:500px;height:300px;position:relative"></div><script src="pen.js"></script>');
  browser("open", pathToFileURL(join(directory, "index.html")).href);
  const initial = evaluate(`(async () => {
    const host = document.querySelector("#host");
    window.testController = new PenModule.PenController(host, {getColor: () => "black", onCommit: () => {}});
    testController.setActive(true);
    window.testSvg = host.querySelector("svg");
    window.testEvent = (type, x) => new PointerEvent(type, {bubbles:true,pointerId:1,pointerType:"pen",isPrimary:true,button:0,clientX:x,clientY:30,pressure:.5});
    window.testStroke = async () => {
      testSvg.dispatchEvent(testEvent("pointerdown", 10));
      for (let index = 1; index <= 12; index++) {
        testSvg.dispatchEvent(testEvent("pointermove", 10 + index));
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      const start = performance.now(); while (performance.now() - start < 85) {}
      testSvg.dispatchEvent(testEvent("pointerup", 25));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise(resolve => setTimeout(resolve, 40));
    };
    await testStroke();
    return { log: JSON.parse(PenModule.exportPenPerf()), marks: performance.getEntriesByType("mark").filter(entry => entry.name.startsWith("MarginStudy:")) };
  })()`);
  assert(initial.log.length === 0 && initial.marks.length === 0, "diagnostics must be disabled by default");

  const supported = evaluate(`(async () => {
    const originalMark = performance.mark.bind(performance), observedMarks = [];
    performance.mark = name => { observedMarks.push(name); return originalMark(name); };
    PenModule.startPenPerf(); await testStroke();
    const log = JSON.parse(PenModule.exportPenPerf());
    performance.mark = originalMark;
    return { stroke: log[0], count: log.length, performanceMarks: observedMarks, supported: PerformanceObserver.supportedEntryTypes.includes("longtask") };
  })()`);
  const stroke = supported.stroke;
  assert(supported.count === 1, "one stroke must produce one log entry");
  assert(stroke.frames.length >= 10 && stroke.frames.every(frame => Number.isFinite(frame.t) && frame.dur >= 0), "frame timestamps and durations are missing");
  assert(["down", "up", "commitAfter", "frame"].every(phase => stroke.heap.some(sample => sample.phase === phase && "used" in sample && "total" in sample)), "heap phases are missing");
  assert(["down", "paintBatch", "up", "commitStart", "commitEnd", "renderAfterCommit"].every(phase => stroke.marks[phase].length && supported.performanceMarks.includes(`${stroke.markPrefix}:${phase}`)), "performance marks are missing");
  assert(stroke.marks.up[0] <= stroke.marks.commitStart[0] && stroke.marks.commitStart[0] <= stroke.marks.commitEnd[0] && stroke.marks.commitEnd[0] <= stroke.marks.renderAfterCommit[0], "commit marks are out of order");
  const markSet = Object.values(stroke.marks).flat();
  assert(stroke.longTasks.some(task => markSet.some(time => time >= task.start && time <= task.start + task.dur)), "long-task entries must be comparable to marks");
  assert(Number.isFinite(stroke.commitMs) && Number.isFinite(stroke.timeOrigin), "commit duration or time origin missing");
  assert(supported.supported ? !stroke.longtaskUnsupported && stroke.longTasks.some(task => task.dur >= 50 && Array.isArray(task.attribution)) : stroke.longtaskUnsupported, "long-task capture or unsupported flag is missing");

  const reset = evaluate(`(async () => { PenModule.resetPenPerf(); const before = JSON.parse(PenModule.exportPenPerf()).length; await testStroke(); return {before, after:JSON.parse(PenModule.exportPenPerf()).length}; })()`);
  assert(reset.before === reset.after, "reset must stop recording");
  const unsupported = evaluate(`(async () => {
    const observer = window.PerformanceObserver;
    window.PerformanceObserver = undefined;
    try { PenModule.startPenPerf(); await testStroke(); return JSON.parse(PenModule.exportPenPerf())[0]; }
    finally { PenModule.resetPenPerf(); window.PerformanceObserver = observer; }
  })()`);
  assert(unsupported.longtaskUnsupported === true && unsupported.longTasks.length === 0, "unsupported observer must be explicit");

  const previousFrame = evaluate(`(async () => {
    PenModule.startPenPerf(); await testStroke(); await testStroke();
    return JSON.parse(PenModule.exportPenPerf()).map(stroke => ({end:stroke.observationEnd, render:stroke.marks.renderAfterCommit, marks:stroke.marks}));
  })()`);
  assert(previousFrame.length === 2 && previousFrame.every(stroke => stroke.end >= stroke.render[0]), "each stroke must retain its own post-commit frame");

  const retry = evaluate(`(async () => {
    PenModule.resetPenPerf();
    const observer = window.PerformanceObserver;
    let attempts = 0;
    class RetryObserver {
      static supportedEntryTypes = ["longtask"];
      constructor(callback) { this.callback = callback; }
      observe() { if (++attempts === 1) throw new Error("temporary observer failure"); }
      disconnect() {}
      takeRecords() { return []; }
    }
    window.PerformanceObserver = RetryObserver;
    try {
      PenModule.startPenPerf(); await testStroke(); PenModule.startPenPerf(); await testStroke();
      return { attempts, unsupported:JSON.parse(PenModule.exportPenPerf())[0].longtaskUnsupported };
    } finally { PenModule.resetPenPerf(); window.PerformanceObserver = observer; }
  })()`);
  assert(retry.attempts === 2 && retry.unsupported === false, "a new recording must retry an unavailable observer");

  const observerReset = evaluate(`(async () => {
    PenModule.resetPenPerf();
    const observer = window.PerformanceObserver, saved = [];
    class FakeObserver {
      static supportedEntryTypes = ["longtask"];
      constructor(callback) { this.callback = callback; saved.push(this); }
      observe() {}
      disconnect() {}
      takeRecords() { return []; }
    }
    window.PerformanceObserver = FakeObserver;
    try {
      PenModule.startPenPerf(); const old = saved[0]; PenModule.resetPenPerf(); PenModule.startPenPerf();
      old.callback({ getEntries: () => [{ startTime:performance.now(), duration:80, name:"stale", attribution:[] }] });
      await testStroke(); return JSON.parse(PenModule.exportPenPerf())[0].longTasks;
    } finally { PenModule.resetPenPerf(); window.PerformanceObserver = observer; }
  })()`);
  assert(observerReset.length === 0, "callbacks from a disconnected observer must not pollute a later recording");

  browser("open", pathToFileURL(publicFixture("perf/harness.html")).href);
  const harness = evaluate(`(async () => {
    const surface = document.querySelector("#surface");
    const event = (type, x, pressure=.5) => new PointerEvent(type, {bubbles:true,pointerId:7,pointerType:"pen",isPrimary:true,button:0,clientX:x,clientY:100,pressure});
    surface.dispatchEvent(event("pointerdown", 10));
    for (let index = 1; index <= 12; index++) {
      surface.dispatchEvent(event("pointermove", 10 + index * 4, index / 12));
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    const start = performance.now(); while (performance.now() - start < 85) {}
    surface.dispatchEvent(event("pointerup", 62, 0));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise(resolve => setTimeout(resolve, 550));
    const data = MarginStudyHarness.export(), canvas = document.querySelector("#committed"), context = canvas.getContext("2d");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return {data, panel:document.querySelector("#stats").textContent, painted:pixels.some((value,index) => index % 4 === 3 && value > 0)};
  })()`);
  assert(harness.data.strokes.length === 1 && harness.data.strokes[0].frames.length >= 10 && harness.painted, "harness must draw and measure a stroke");
  assert(harness.panel.includes("rAF 最大间隔") && harness.panel.includes("堆峰值") && harness.panel.includes("Long task"), "harness statistics are not visible");
  assert(harness.data.longtaskUnsupported || harness.data.longTasks.some(task => task.dur >= 50), "harness long-task capture failed");
  assert(harness.data.longtaskUnsupported || /Long task [1-9]/.test(harness.panel), "harness long-task list must update on screen");
  assert(["down", "up", "commitAfter", "frame"].every(phase => harness.data.strokes[0].heap.some(sample => sample.phase === phase)), "harness heap phases are missing");
  console.log(JSON.stringify({ passed: true, disabled: true, pluginFrames: stroke.frames.length, pluginLongTasks: stroke.longTasks,
    unsupportedFallback: unsupported.longtaskUnsupported, previousFrame: previousFrame.length, observerReset: true, observerRetry: retry.attempts, harnessFrames: harness.data.strokes[0].frames.length,
    harnessLongTasks: harness.data.longTasks, harnessPanel: harness.panel, heapUnsupported: stroke.heapUnsupported }, null, 2));
} finally {
  try { browser("close"); } catch {}
  rmSync(directory, { recursive: true, force: true });
}
