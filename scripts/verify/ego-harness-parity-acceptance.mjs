/**
 * [INPUT]: scripts/verify/ego-harness.mjs（runBrowser、runBrowserSync、getEgoHarnessStats）。
 * [OUTPUT]: 双后端（agent-browser / ego）适配层契约验收结果（DPR/主题/焦点、选择器、命令全集、鼠标拖拽、单进程复用与零泄漏）。
 * [POS]: 常驻公开验收套件（GAP-EGO-01a），锁定 ego-harness.mjs 与默认后端的行为等效契约。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { getEgoHarnessStats, runBrowser, runBrowserSync } from "./ego-harness.mjs";

const isEgo = process.env.MARGINSTUDY_BROWSER === "ego";
const scratch = await mkdtemp(join(tmpdir(), "marginstudy-ego-parity-"));

const page1Html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { margin: 0; font-family: sans-serif; padding: 12px; }
  #drag-pad { width: 320px; height: 180px; background: #e8eef5; border: 1px solid #999; touch-action: none; }
  .ms-modal { border: 1px solid #333; padding: 8px; margin-top: 8px; }
</style>
</head>
<body>
  <button class="dup-btn" id="dup-btn-1" onclick="window.__hits.push('dup1')">DupBtn</button>
  <button class="dup-btn" id="dup-btn-2" onclick="window.__hits.push('dup2')">DupBtn</button>
  <input class="dup-input" id="dup-in-1" />
  <input class="dup-input" id="dup-in-2" />
  <select class="dup-select" id="dup-sel-1"><option value="a">A</option><option value="b">B</option></select>
  <select class="dup-select" id="dup-sel-2"><option value="a">A</option><option value="b">B</option></select>
  <input type="checkbox" class="dup-check" id="dup-chk-1" />
  <input type="checkbox" class="dup-check" id="dup-chk-2" />

  <button style="display:none" onclick="window.__hits.push('hidden-save')">保存</button>
  <button id="visible-save" onclick="window.__hits.push('visible-save')">保存</button>

  <button id="outside-action" onclick="window.__hits.push('outside-action')">操作</button>
  <div class="ms-modal">
    <button id="modal-action" onclick="window.__hits.push('modal-action')">操作</button>
  </div>

  <input aria-label="API 地址" id="aria-in" />
  <label for="for-in">用户名</label>
  <input id="for-in" />

  <input type="checkbox" id="cb-idem" />
  <input type="file" id="file-in" />

  <div id="drag-pad"></div>

  <script>
    window.__hits = [];
    window.__dragEvents = [];
    window.__uploaded = [];
    document.getElementById("file-in").addEventListener("change", (e) => {
      window.__uploaded = [...(e.target.files || [])].map(f => f.name);
    });
    const pad = document.getElementById("drag-pad");
    for (const type of ["pointerdown", "pointermove", "pointerup"]) {
      pad.addEventListener(type, (e) => {
        window.__dragEvents.push({
          type,
          x: Math.round(e.clientX),
          y: Math.round(e.clientY),
          trusted: e.isTrusted,
          buttons: e.buttons,
        });
      });
    }
    console.log("parity-console-marker");
    setTimeout(() => { throw new Error("parity-error-marker"); }, 20);
    window.__ready = true;
  </script>
</body>
</html>`;

const page2Html = `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body><div id="p2">Page Two</div><script>window.__page2 = true;</script></body>
</html>`;

const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.url === "/page2") res.end(page2Html);
  else res.end(page1Html);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const session = `marginstudy-ego-parity-${process.pid}`;
const syncSession = `marginstudy-ego-parity-sync-${process.pid}`;
const browser = (...args) => runBrowser(session, ...args);
const evalJson = async expr => JSON.parse((await browser("eval", expr)).stdout);

const checks = [];
function check(name, fn) {
  fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}

const uploadFixtureAbs = join(scratch, "upload-sample.txt");
await writeFile(uploadFixtureAbs, "ego-parity-upload-fixture");
const uploadFixtureRel = relative(process.cwd(), uploadFixtureAbs);
const screenshotAbs = join(scratch, "parity-shot.png");
const screenshotRel = relative(process.cwd(), screenshotAbs);

let error;
try {
  // 1. Initial open: DPR=1, light color scheme, focus emulation
  await browser("open", origin);
  await browser("wait", "--fn", "window.__ready === true");
  const env1 = await evalJson(
    "({dpr: devicePixelRatio, light: matchMedia('(prefers-color-scheme: light)').matches, dark: matchMedia('(prefers-color-scheme: dark)').matches, focused: document.hasFocus()})",
  );
  check("initial open enforces DPR=1, light theme, and focus", () => {
    assert.equal(env1.dpr, 1);
    assert.equal(env1.light, true);
    assert.equal(env1.dark, false);
    assert.equal(env1.focused, true);
  });

  // 2. Viewport resize preserves DPR=1
  await browser("set", "viewport", "1512", "851");
  const env2 = await evalJson("({w: innerWidth, h: innerHeight, dpr: devicePixelRatio})");
  check("set viewport applies exact dimensions with DPR=1", () => {
    assert.equal(env2.w, 1512);
    assert.equal(env2.h, 851);
    assert.equal(env2.dpr, 1);
  });

  // 3. Second navigation preserves DPR=1, light theme, focus, and viewport
  await browser("open", `${origin}/page2`);
  await browser("wait", "--fn", "window.__page2 === true");
  const env3 = await evalJson(
    "({w: innerWidth, h: innerHeight, dpr: devicePixelRatio, light: matchMedia('(prefers-color-scheme: light)').matches, dark: matchMedia('(prefers-color-scheme: dark)').matches, focused: document.hasFocus()})",
  );
  check("subsequent navigation preserves viewport, DPR=1, light theme, and focus", () => {
    assert.equal(env3.w, 1512);
    assert.equal(env3.h, 851);
    assert.equal(env3.dpr, 1);
    assert.equal(env3.light, true);
    assert.equal(env3.dark, false);
    assert.equal(env3.focused, true);
  });

  // Return to page 1 for command & interaction parity
  await browser("open", origin);
  await browser("wait", "--fn", "window.__ready === true");
  await browser("wait", "60");

  // 4. Non-strict duplicate CSS selectors (click, fill, select, check, uncheck)
  await browser("click", ".dup-btn");
  await browser("fill", ".dup-input", "first-value");
  await browser("select", ".dup-select", "b");
  await browser("check", ".dup-check");
  const dupState1 = await evalJson(
    "({hits: window.__hits, in1: document.getElementById('dup-in-1').value, in2: document.getElementById('dup-in-2').value, sel1: document.getElementById('dup-sel-1').value, chk1: document.getElementById('dup-chk-1').checked, chk2: document.getElementById('dup-chk-2').checked})",
  );
  await browser("uncheck", ".dup-check");
  const dupUnchecked = await evalJson("document.getElementById('dup-chk-1').checked");
  check("duplicate CSS selectors resolve to first match for click/fill/select/check/uncheck", () => {
    assert.deepEqual(dupState1.hits, ["dup1"]);
    assert.equal(dupState1.in1, "first-value");
    assert.equal(dupState1.in2, "");
    assert.equal(dupState1.sel1, "b");
    assert.equal(dupState1.chk1, true);
    assert.equal(dupState1.chk2, false);
    assert.equal(dupUnchecked, false);
  });

  // 5. find role button with duplicate names (hidden+visible & modal-priority)
  await browser("find", "role", "button", "click", "--name", "保存", "--exact");
  await browser("find", "role", "button", "click", "--name", "操作", "--exact");
  const roleHits = await evalJson("window.__hits");
  check("find role button clicks visible target without ambiguity", () => {
    assert.ok(roleHits.includes("visible-save"), JSON.stringify(roleHits));
    assert.ok(!roleHits.includes("hidden-save"), JSON.stringify(roleHits));
    assert.ok(
      roleHits.includes("modal-action") || roleHits.includes("outside-action"),
      JSON.stringify(roleHits),
    );
  });

  // 6. find label supports both aria-label and <label for>
  await browser("find", "label", "API 地址", "fill", "https://example.invalid");
  await browser("find", "label", "用户名", "fill", "alice");
  const labels = await evalJson(
    "({aria: document.getElementById('aria-in').value, htmlFor: document.getElementById('for-in').value})",
  );
  check("find label fills both aria-label and <label for> controls", () => {
    assert.equal(labels.aria, "https://example.invalid");
    assert.equal(labels.htmlFor, "alice");
  });

  // 7. check / uncheck idempotency
  await browser("check", "#cb-idem");
  await browser("check", "#cb-idem");
  const afterDoubleCheck = await evalJson("document.getElementById('cb-idem').checked");
  await browser("uncheck", "#cb-idem");
  await browser("uncheck", "#cb-idem");
  const afterDoubleUncheck = await evalJson("document.getElementById('cb-idem').checked");
  check("check and uncheck are idempotent", () => {
    assert.equal(afterDoubleCheck, true);
    assert.equal(afterDoubleUncheck, false);
  });

  // 8. Persistent cross-call mouse drag
  const pad = await evalJson(
    "(()=>{const r=document.getElementById('drag-pad').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};})()",
  );
  const startX = Math.round(pad.left + 30);
  const startY = Math.round(pad.top + 30);
  const endX = Math.round(pad.left + 210);
  const endY = Math.round(pad.top + 120);
  await browser("mouse", "move", String(startX), String(startY));
  await browser("mouse", "down");
  await browser("mouse", "move", String(endX), String(endY), "--steps", "8");
  await browser("mouse", "up");
  const dragEvents = await evalJson("window.__dragEvents");
  check("cross-call mouse drag dispatches trusted pointerdown/pointermove/pointerup with exact endpoints", () => {
    const down = dragEvents.find(e => e.type === "pointerdown");
    const moves = dragEvents.filter(e => e.type === "pointermove" && e.buttons === 1);
    const up = dragEvents.findLast(e => e.type === "pointerup");
    assert.ok(down && down.trusted, `missing trusted pointerdown: ${JSON.stringify(dragEvents)}`);
    assert.ok(moves.length >= 2, `missing continuous pointermove: ${JSON.stringify(dragEvents)}`);
    assert.ok(up && up.trusted, `missing trusted pointerup: ${JSON.stringify(dragEvents)}`);
    assert.ok(Math.abs(down.x - startX) <= 1 && Math.abs(down.y - startY) <= 1, JSON.stringify({ down, startX, startY }));
    assert.ok(Math.abs(up.x - endX) <= 1 && Math.abs(up.y - endY) <= 1, JSON.stringify({ up, endX, endY }));
  });

  // 9. console, errors, snapshot -i
  const consoleOut = (await browser("console")).stdout;
  const errorsOut = (await browser("errors")).stdout;
  const snapOut = (await browser("snapshot", "-i")).stdout;
  check("console, errors, and snapshot -i return expected outputs", () => {
    assert.ok(consoleOut.includes("parity-console-marker"), `console=${JSON.stringify(consoleOut)}`);
    assert.ok(errorsOut.trim().length > 0, `errors=${JSON.stringify(errorsOut)}`);
    if (isEgo) {
      assert.ok(errorsOut.includes("parity-error-marker"), `errors=${JSON.stringify(errorsOut)}`);
    }
    assert.ok(snapOut.trim().length > 0, "snapshot -i returned empty output");
  });

  // 10. Relative-path screenshot and upload
  await browser("screenshot", screenshotRel);
  const shotStat = await stat(screenshotAbs);
  await browser("upload", "#file-in", uploadFixtureRel);
  const uploaded = await evalJson("window.__uploaded");
  check("relative-path screenshot and upload succeed", () => {
    assert.ok(shotStat.size > 100, `screenshot too small: ${shotStat.size}`);
    assert.deepEqual(uploaded, ["upload-sample.txt"]);
  });

  // 11. 10 consecutive eval latency & single-process reuse
  const evalStart = performance.now();
  for (let i = 0; i < 10; i++) {
    const val = await evalJson(`${i} + 1`);
    assert.equal(val, i + 1);
  }
  const avgEvalMs = (performance.now() - evalStart) / 10;
  const statsBeforeClose = getEgoHarnessStats();
  check("10 consecutive evals reuse single session bridge within latency budget", () => {
    if (isEgo) {
      assert.equal(statsBeforeClose.spawns, 1, `expected 1 ego spawn, got ${statsBeforeClose.spawns}`);
      assert.ok(avgEvalMs <= 50, `avg eval ${avgEvalMs.toFixed(2)}ms exceeded 50ms`);
    }
    console.log(`  metric: backend=${isEgo ? "ego" : "agent-browser"} avgEvalMs=${avgEvalMs.toFixed(2)} spawns=${statsBeforeClose.spawns} commands=${statsBeforeClose.commands}`);
  });

  // 12. Close leaves zero active sessions & zero temp IPC files
  await browser("close");
  const statsAfterClose = getEgoHarnessStats();
  const leftoverTmp = (await readdir(tmpdir())).filter(name =>
    name.startsWith(`marginstudy-ego-bridge-${process.pid}-`),
  );
  check("close cleans up bridge session and tmpdir IPC files", () => {
    assert.equal(statsAfterClose.activeSessions, 0);
    assert.deepEqual(leftoverTmp, []);
  });

  // 13. runBrowserSync smoke (open, eval, wait, close) using file:// URL (same pattern as perf*-acceptance.mjs, avoids blocking in-process HTTP server)
  const syncHtmlAbs = join(scratch, "sync-smoke.html");
  await writeFile(syncHtmlAbs, "<!doctype html><html><body><div id='s'>sync-ok</div></body></html>");
  runBrowserSync(syncSession, "open", `file://${syncHtmlAbs}`);
  runBrowserSync(syncSession, "wait", "50");
  const syncVal = JSON.parse(runBrowserSync(syncSession, "eval", "1 + 2"));
  runBrowserSync(syncSession, "close");
  const statsAfterSync = getEgoHarnessStats();
  const leftoverAfterSync = (await readdir(tmpdir())).filter(name =>
    name.startsWith(`marginstudy-ego-bridge-${process.pid}-`),
  );
  check("runBrowserSync supports open/wait/eval/close with zero leakage", () => {
    assert.equal(syncVal, 3);
    assert.equal(statsAfterSync.activeSessions, 0);
    assert.deepEqual(leftoverAfterSync, []);
    if (isEgo) assert.equal(statsAfterSync.spawns, 2, `expected 1 async + 1 sync spawn, got ${statsAfterSync.spawns}`);
  });
} catch (err) {
  error = err;
  console.error(err?.stack || err);
  process.exitCode = 1;
} finally {
  await browser("close").catch(() => {});
  try { runBrowserSync(syncSession, "close"); } catch {}
  await new Promise(done => server.close(done));
  await rm(scratch, { recursive: true, force: true }).catch(() => {});
}

if (!error) {
  console.log(`${checks.length}/${checks.length} ego-harness parity checks passed (${isEgo ? "ego" : "agent-browser"}).`);
}
