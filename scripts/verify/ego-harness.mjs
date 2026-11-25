/**
 * [INPUT]: 浏览器后端环境变量、验收脚本的会话和命令参数，以及 agent-browser 的 CDP 地址。
 * [OUTPUT]: resolveBrowserExecutable、getEgoHarnessStats、runBrowser 和 runBrowserSync，返回兼容验收脚本的标准输出。
 * [POS]: 验收脚本与 agent-browser 或 ego TaskSpace 之间的统一命令适配层与会话级持久桥接。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { execFile, spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const bridges = new Map();
const harnessStats = { spawns: 0, commands: 0, syncCommands: 0 };
let cleanupHooksInstalled = false;

function isExecutableFile(candidate) {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveBrowserExecutable(
  backend = process.env.MARGINSTUDY_BROWSER === "ego" ? "ego-browser" : "agent-browser",
) {
  const pathEntries = (process.env.PATH || "").split(delimiter).filter(Boolean);
  for (const dir of pathEntries) {
    const candidate = join(dir, backend);
    if (isExecutableFile(candidate)) {
      return { path: candidate, resolved: realpathSync(candidate) };
    }
  }
  if (backend === "ego-browser") {
    const fallback = resolve(homedir(), ".pi/agent/bin/ego-browser");
    if (isExecutableFile(fallback)) {
      return { path: fallback, resolved: realpathSync(fallback) };
    }
  }
  return null;
}

export function getEgoHarnessStats() {
  return {
    spawns: harnessStats.spawns,
    commands: harnessStats.commands,
    syncCommands: harnessStats.syncCommands,
    activeSessions: bridges.size,
  };
}

const runtimeSession = session =>
  `marginstudy-${createHash("sha256").update(session).digest("hex").slice(0, 32)}`;

function readyFilePath(session) {
  return join(tmpdir(), `marginstudy-ego-bridge-${process.pid}-${runtimeSession(session)}.json`);
}

function buildBridgeProgram(sessionName, readyFile, token, parentPid) {
  const cfg = JSON.stringify({ sessionName, readyFile, token, parentPid });
  return `
{
const cfg = ${cfg};
const http = await import("node:http");
const fs = await import("node:fs/promises");
const path = await import("node:path");
const crypto = await import("node:crypto");

const task = await taskSpace(cfg.sessionName);
const page = task.page("p1");
const state = {
  viewport: { width: 1280, height: 720 },
  mouse: { x: 0, y: 0, buttons: 0 },
  physicalDpr: 1,
};

let bridgePort = 0;
function buildCaptureHookSource(port) {
  return \`(() => {
  if (window.__msEgoCaptureInstalled) return;
  window.__msEgoCaptureInstalled = true;
  const logs = (window.__msEgoConsole = []);
  const errs = (window.__msEgoErrors = []);
  const fmt = (v) => {
    if (typeof v === "string") return v;
    try { return JSON.stringify(v); } catch { return String(v); }
  };
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const orig = console[level];
    if (typeof orig !== "function") continue;
    console[level] = function (...args) {
      logs.push("[" + level + "] " + args.map(fmt).join(" "));
      return orig.apply(this, args);
    };
  }
  window.addEventListener("error", (event) => {
    const msg = event?.error?.stack || event?.message || String(event);
    errs.push(msg);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const msg = reason?.stack || reason?.message || fmt(reason);
    errs.push(msg);
  });
  // Suppress user-profile browser extension overlays (e.g. doubao-ai-csui) and macOS classic scrollbar gutters on synthetic test pages.
  const suppressExt = () => {
    const style = document.createElement("style");
    style.setAttribute("data-ms-ego-ext-guard", "1");
    style.textContent = "doubao-ai-csui, [id^='doubao-'], [class^='doubao-'] { display: none !important; pointer-events: none !important; visibility: hidden !important; } html, body { scrollbar-width: none !important; } ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }";
    (document.head || document.documentElement)?.appendChild(style);
  };
  if (document.documentElement) suppressExt();
  else window.addEventListener("DOMContentLoaded", suppressExt, { once: true });
})();\`;
}

async function evaluate(expression) {
  const result = await page.cdp("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        JSON.stringify(result.exceptionDetails),
    );
  }
  return result.result.value;
}

async function applyEmulation() {
  await page.cdp("Emulation.setDeviceMetricsOverride", {
    width: state.viewport.width,
    height: state.viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.cdp("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  await page.cdp("Emulation.setAutoDarkModeOverride", { enabled: false }).catch(() => {});
  await page.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
}

function firstSelector(sel) {
  const s = String(sel);
  if (!s || s.startsWith("@") || s.includes(">> nth=") || s.startsWith("loc=role:")) return s;
  return s + " >> nth=0";
}

async function tagRoleTarget(role, name, exact, tag) {
  return page.evaluate(
    ({ role, name, exact, tag }) => {
      const roleSelectors = {
        button: 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]',
        checkbox: 'input[type="checkbox"], [role="checkbox"]',
        link: 'a[href], [role="link"]',
        textbox: 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, [role="textbox"]',
        combobox: 'select, [role="combobox"]',
        menuitem: '[role="menuitem"]',
        tab: '[role="tab"]',
      };
      const selector = roleSelectors[role] || \`[role="\${role}"]\`;
      const isVisible = (el) => {
        if (typeof el.checkVisibility === "function") return el.checkVisibility();
        return el.offsetParent !== null;
      };
      const getName = (el) => {
        const aria = el.getAttribute("aria-label");
        if (aria != null && aria.trim() !== "") return aria.trim();
        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          const text = labelledBy
            .split(/\\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() || "")
            .filter(Boolean)
            .join(" ");
          if (text) return text;
        }
        if (el.tagName === "INPUT" && el.value) return String(el.value).trim();
        const txt = (el.textContent || "").trim();
        if (txt) return txt;
        return (el.getAttribute("title") || "").trim();
      };
      const matches = (el) => {
        if (name == null) return true;
        const candidate = getName(el);
        return exact ? candidate === name : candidate.includes(name);
      };
      const findInRoot = (root) => {
        const all = [...root.querySelectorAll(selector)].filter(matches);
        const visible = all.filter(isVisible);
        const enabledVisible = visible.filter((el) => !el.disabled && el.getAttribute("aria-disabled") !== "true");
        return enabledVisible[0] || visible[0] || null;
      };
      const target = findInRoot(document);
      if (!target) return false;
      target.setAttribute("data-ms-ego-target", tag);
      return true;
    },
    { role, name, exact, tag },
  );
}

async function tagLabelTarget(labelText, tag) {
  return page.evaluate(
    ({ labelText, tag }) => {
      const isVisible = (el) => {
        if (typeof el.checkVisibility === "function") return el.checkVisibility();
        return el.offsetParent !== null;
      };
      const pickBest = (list) => {
        const uniq = [...new Set(list.filter(Boolean))];
        const visible = uniq.filter(isVisible);
        const modals = [...document.querySelectorAll('.ms-modal, [role="dialog"]')].filter(isVisible);
        for (let i = modals.length - 1; i >= 0; i--) {
          const inModal = visible.find((el) => modals[i].contains(el));
          if (inModal) return inModal;
        }
        return visible[0] || uniq[0] || null;
      };
      const candidates = [];
      for (const el of document.querySelectorAll("[aria-label]")) {
        if ((el.getAttribute("aria-label") || "").trim() === labelText) candidates.push(el);
      }
      for (const label of document.querySelectorAll("label")) {
        const text = (label.textContent || "").trim();
        if (text === labelText) {
          const forId = label.getAttribute("for");
          if (forId) {
            const linked = document.getElementById(forId);
            if (linked) candidates.push(linked);
          } else {
            const nested = label.querySelector("input, textarea, select");
            if (nested) candidates.push(nested);
          }
        }
      }
      for (const el of document.querySelectorAll("[aria-labelledby]")) {
        const ids = (el.getAttribute("aria-labelledby") || "").split(/\\s+/).filter(Boolean);
        const text = ids.map((id) => document.getElementById(id)?.textContent?.trim() || "").filter(Boolean).join(" ");
        if (text === labelText) candidates.push(el);
      }
      const target = pickBest(candidates);
      if (!target) return false;
      target.setAttribute("data-ms-ego-target", tag);
      return true;
    },
    { labelText, tag },
  );
}

async function clearTag(tag) {
  await page.evaluate((t) => {
    for (const el of document.querySelectorAll(\`[data-ms-ego-target="\${t}"]\`)) {
      el.removeAttribute("data-ms-ego-target");
    }
  }, tag).catch(() => {});
}

let captureHookSource = "";

async function executeCommand(command, args, cwd) {
  let output = "";
  switch (command) {
    case "open":
      await page.goto(args[0]);
      await applyEmulation();
      if (captureHookSource) await evaluate(captureHookSource).catch(() => {});
      break;
    case "eval":
      output = JSON.stringify(await evaluate(args[0])) ?? "null";
      break;
    case "wait":
      if (args[0] === "--fn") {
        const deadline = Date.now() + 30000;
        while (!(await evaluate(args[1]))) {
          if (Date.now() >= deadline) throw new Error("Timed out waiting for: " + args[1]);
          await new Promise((r) => setTimeout(r, 50));
        }
      } else {
        await page.waitForTimeout(Number(args[0]));
      }
      break;
    case "screenshot": {
      const absPath = path.resolve(cwd, args[0]);
      try {
        await page.screenshot({ path: absPath });
      } catch (err) {
        if (String(err?.message || err).includes("EGO_PAGE_UNRESPONSIVE")) {
          await page.waitForTimeout(200);
          await page.screenshot({ path: absPath });
        } else {
          throw err;
        }
      }
      break;
    }
    case "click":
      await page.click(firstSelector(args[0]));
      break;
    case "dblclick":
      await page.dblclick(firstSelector(args[0]));
      break;
    case "fill":
      await page.fill(firstSelector(args[0]), args[1] ?? "");
      break;
    case "press":
      await page.keyboard.press(args[0]);
      break;
    case "select":
      await page.selectOption(firstSelector(args[0]), { value: args[1] ?? "" });
      break;
    case "upload":
      await page.setInputFiles(
        firstSelector(args[0]),
        args.slice(1).map((file) => path.resolve(cwd, file)),
      );
      break;
    case "drag":
      await page.dragAndDrop(firstSelector(args[0]), firstSelector(args[1]));
      break;
    case "check":
    case "uncheck": {
      const wantChecked = command === "check";
      const sel = args[0];
      const info = await page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return { found: false };
        return { found: true, checked: Boolean(el.checked) };
      }, sel);
      if (!info.found) throw new Error("Missing element: " + sel);
      if (info.checked !== wantChecked) {
        await page.click(firstSelector(sel));
      }
      break;
    }
    case "snapshot":
      output = await page.snapshot();
      break;
    case "console":
      output = String((await evaluate("(window.__msEgoConsole || []).join(String.fromCharCode(10))")) ?? "");
      break;
    case "errors":
      output = String((await evaluate("(window.__msEgoErrors || []).join(String.fromCharCode(10))")) ?? "");
      break;
    case "get":
      if (args[0] !== "url") throw new Error("Unsupported get command: " + args[0]);
      output = await page.url();
      break;
    case "scrollintoview":
      await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error("Missing element: " + selector);
        element.scrollIntoView({ block: "center", inline: "center" });
      }, args[0]);
      break;
    case "find": {
      if (args[0] === "role") {
        const role = args[1];
        const action = args[2];
        const nameIdx = args.indexOf("--name");
        const name = nameIdx >= 0 ? args[nameIdx + 1] : null;
        const exact = args.includes("--exact");
        const tag = crypto.randomUUID();
        const tagged = await tagRoleTarget(role, name, exact, tag);
        const targetSel = tagged
          ? \`[data-ms-ego-target="\${tag}"]\`
          : \`loc=role:\${role}\${name != null ? "[name=" + JSON.stringify(name) + "]" : ""}\`;
        try {
          if (action === "click") await page.click(targetSel);
          else if (action === "dblclick") await page.dblclick(targetSel);
          else if (action === "hover") await page.hover(targetSel);
          else throw new Error("Unsupported find role action: " + action);
        } finally {
          if (tagged) await clearTag(tag);
        }
      } else if (args[0] === "label") {
        const labelText = args[1];
        const action = args[2];
        const value = args[3] ?? "";
        const tag = crypto.randomUUID();
        const tagged = await tagLabelTarget(labelText, tag);
        const targetSel = tagged
          ? \`[data-ms-ego-target="\${tag}"]\`
          : \`loc=css:[aria-label=\${JSON.stringify(labelText)}] >> nth=0\`;
        try {
          if (action === "fill") await page.fill(targetSel, value);
          else if (action === "click") await page.click(targetSel);
          else if (action === "select") await page.selectOption(targetSel, { value });
          else throw new Error("Unsupported find label action: " + action);
        } finally {
          if (tagged) await clearTag(tag);
        }
      } else {
        throw new Error("Unsupported find command: " + JSON.stringify(args));
      }
      break;
    }
    case "mouse":
      if (args[0] === "move") {
        const x = Number(args[1]);
        const y = Number(args[2]);
        state.mouse.x = x;
        state.mouse.y = y;
        await page.mouse.move(x, y, args[3] === "--steps" ? { steps: Number(args[4]) } : {});
      } else if (args[0] === "click") {
        const x = Number(args[1]);
        const y = Number(args[2]);
        state.mouse.x = x;
        state.mouse.y = y;
        await page.mouse.click(x, y);
      } else if (args[0] === "down") {
        state.mouse.buttons = 1;
        await page.mouse.down();
      } else if (args[0] === "up") {
        state.mouse.buttons = 0;
        await page.mouse.up();
      } else if (args[0] === "wheel") {
        await page.mouse.wheel(Number(args[1]), Number(args[2]));
      } else {
        throw new Error("Unsupported mouse command: " + args[0]);
      }
      break;
    case "set":
      if (args[0] !== "viewport") throw new Error("Unsupported set command: " + args[0]);
      state.viewport = { width: Number(args[1]), height: Number(args[2]) };
      await applyEmulation();
      break;
    case "cdp": {
      const cdpParams = JSON.parse(args[1]);
      if (args[0] === "Input.dispatchMouseEvent" && cdpParams?.type === "mouseWheel" && state.physicalDpr > 1) {
        if (typeof cdpParams.deltaX === "number") cdpParams.deltaX /= state.physicalDpr;
        if (typeof cdpParams.deltaY === "number") cdpParams.deltaY /= state.physicalDpr;
      }
      output = JSON.stringify(await page.cdp(args[0], cdpParams)) ?? "null";
      break;
    }
    case "close":
      await task.finish({ keep: [] });
      break;
    default:
      throw new Error("Unsupported browser command: " + command);
  }
  return output;
}

let queue = Promise.resolve();
const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/cmd" || req.headers["x-ego-token"] !== cfg.token) {
    res.statusCode = 403;
    res.end("forbidden");
    return;
  }
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    queue = queue.then(async () => {
      try {
        const payload = JSON.parse(body);
        const output = await executeCommand(payload.command, payload.args || [], payload.cwd || process.cwd());
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, output }));
        if (payload.command === "close") {
          clearInterval(parentWatch);
          server.close(() => process.exit(0));
          setTimeout(() => process.exit(0), 200).unref();
        }
      } catch (err) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: err?.stack || err?.message || String(err) }));
      }
    });
  });
});

const parentWatch = setInterval(async () => {
  try {
    process.kill(cfg.parentPid, 0);
  } catch {
    clearInterval(parentWatch);
    await task.finish({ keep: [] }).catch(() => {});
    process.exit(0);
  }
}, 2000);

await new Promise((done) => server.listen(0, "127.0.0.1", done));
bridgePort = server.address().port;
captureHookSource = buildCaptureHookSource(bridgePort);
state.physicalDpr = Number(await evaluate("window.devicePixelRatio").catch(() => 1)) || 1;
await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: captureHookSource });
await applyEmulation();
await evaluate(captureHookSource).catch(() => {});
const tmpReady = cfg.readyFile + ".tmp";
await fs.writeFile(tmpReady, JSON.stringify({ port: bridgePort, token: cfg.token, pid: process.pid }));
await fs.rename(tmpReady, cfg.readyFile);
await new Promise(() => {});
}
`;
}

function unlinkQuiet(filePath) {
  try {
    unlinkSync(filePath);
  } catch {}
}

function cleanupBridgeSync(session, entry) {
  if (!entry) return;
  entry.closed = true;
  bridges.delete(session);
  unlinkQuiet(entry.readyFile);
  unlinkQuiet(entry.readyFile + ".tmp");
  if (entry.child && entry.child.exitCode === null && !entry.child.killed) {
    try {
      entry.child.kill("SIGTERM");
    } catch {}
  }
}

function installCleanupHooks() {
  if (cleanupHooksInstalled) return;
  cleanupHooksInstalled = true;
  const cleanupAll = () => {
    for (const [session, entry] of [...bridges.entries()]) {
      cleanupBridgeSync(session, entry);
    }
  };
  process.on("exit", cleanupAll);
  process.on("SIGINT", () => {
    cleanupAll();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanupAll();
    process.exit(143);
  });
}

function spawnBridgeEntry(session) {
  const exe = resolveBrowserExecutable("ego-browser");
  if (!exe) {
    throw new Error("ego-browser not found in PATH or ~/.pi/agent/bin/ego-browser");
  }
  installCleanupHooks();
  const readyFile = readyFilePath(session);
  unlinkQuiet(readyFile);
  unlinkQuiet(readyFile + ".tmp");
  const token = randomUUID();
  const script = buildBridgeProgram(session, readyFile, token, process.pid);
  const child = spawn(
    exe.path,
    ["nodejs", "--session", runtimeSession(session), "--timeout-ms", "600000", "-e", script],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  harnessStats.spawns++;
  const entry = {
    child,
    readyFile,
    token,
    port: null,
    stderr: "",
    closed: false,
    readyPromise: null,
  };
  child.stderr.on("data", chunk => {
    if (entry.stderr.length < 16384) entry.stderr += String(chunk);
  });
  child.once("exit", () => {
    unlinkQuiet(readyFile);
    unlinkQuiet(readyFile + ".tmp");
    if (bridges.get(session) === entry) bridges.delete(session);
  });
  bridges.set(session, entry);
  return entry;
}

async function ensureBridgeAsync(session) {
  let entry = bridges.get(session);
  if (entry && !entry.closed && entry.child.exitCode === null) {
    if (entry.port) return entry;
    if (entry.readyPromise) return entry.readyPromise;
  }
  entry = spawnBridgeEntry(session);
  entry.readyPromise = new Promise((resolveReady, rejectReady) => {
    const deadline = Date.now() + 30000;
    const poll = () => {
      if (existsSync(entry.readyFile)) {
        try {
          const info = JSON.parse(readFileSync(entry.readyFile, "utf8"));
          entry.port = info.port;
          resolveReady(entry);
          return;
        } catch {}
      }
      if (entry.child.exitCode !== null) {
        cleanupBridgeSync(session, entry);
        rejectReady(new Error(entry.stderr.trim() || `ego-browser bridge exited early with ${entry.child.exitCode}`));
        return;
      }
      if (Date.now() >= deadline) {
        cleanupBridgeSync(session, entry);
        rejectReady(new Error(`Timed out waiting for ego-browser bridge startup. ${entry.stderr.trim()}`));
        return;
      }
      setTimeout(poll, 15);
    };
    poll();
  });
  return entry.readyPromise;
}

async function waitChildExit(child, timeoutMs = 1500) {
  if (!child || child.exitCode !== null) return;
  await new Promise(done => {
    const timer = setTimeout(done, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      done();
    });
  });
}

async function runEgo(session, ...args) {
  const [command, ...rest] = args.map(String);
  harnessStats.commands++;
  if (command === "close" && !bridges.has(session)) {
    return { stdout: "", stderr: "" };
  }
  const entry = await ensureBridgeAsync(session);
  const response = await fetch(`http://127.0.0.1:${entry.port}/cmd`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ego-token": entry.token,
    },
    body: JSON.stringify({ command, args: rest, cwd: process.cwd() }),
    signal: AbortSignal.timeout(125000),
  });
  if (!response.ok) {
    throw new Error(`ego-browser bridge HTTP ${response.status}`);
  }
  const result = await response.json();
  if (command === "close") {
    await waitChildExit(entry.child, 1500);
    cleanupBridgeSync(session, entry);
  }
  if (!result.ok) throw new Error(result.error || `ego-browser command failed: ${command}`);
  return { stdout: result.output ?? "", stderr: "" };
}

const syncClientScript = `
const fs = require("node:fs");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
(async () => {
  let port = input.port;
  if (!port) {
    const deadline = Date.now() + 30000;
    while (!fs.existsSync(input.readyFile)) {
      if (Date.now() >= deadline) throw new Error("Timed out waiting for ego-browser bridge startup");
      await new Promise(r => setTimeout(r, 15));
    }
    const info = JSON.parse(fs.readFileSync(input.readyFile, "utf8"));
    port = info.port;
  }
  const response = await fetch("http://127.0.0.1:" + port + "/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ego-token": input.token },
    body: JSON.stringify({ command: input.command, args: input.args, cwd: input.cwd }),
    signal: AbortSignal.timeout(125000),
  });
  if (!response.ok) throw new Error("ego-browser bridge HTTP " + response.status);
  const result = await response.json();
  process.stdout.write(JSON.stringify({ port, ...result }));
})().catch(err => {
  process.stderr.write(err?.stack || err?.message || String(err));
  process.exit(1);
});
`;

function runEgoSync(session, ...args) {
  const [command, ...rest] = args.map(String);
  harnessStats.commands++;
  harnessStats.syncCommands++;
  if (command === "close" && !bridges.has(session)) {
    return "";
  }
  let entry = bridges.get(session);
  if (!entry || entry.closed || entry.child.exitCode !== null) {
    entry = spawnBridgeEntry(session);
  }
  const res = spawnSync(process.execPath, ["-e", syncClientScript], {
    input: JSON.stringify({
      port: entry.port,
      readyFile: entry.readyFile,
      token: entry.token,
      command,
      args: rest,
      cwd: process.cwd(),
    }),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 130000,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    if (command === "close") cleanupBridgeSync(session, entry);
    throw new Error(res.stderr || entry.stderr || `ego-browser sync client exited with ${res.status}`);
  }
  const payload = JSON.parse(res.stdout);
  if (payload.port) entry.port = payload.port;
  if (command === "close") {
    cleanupBridgeSync(session, entry);
  }
  if (!payload.ok) throw new Error(payload.error || `ego-browser command failed: ${command}`);
  return payload.output ?? "";
}

export async function runBrowser(session, ...args) {
  if (process.env.MARGINSTUDY_BROWSER === "ego") return runEgo(session, ...args);
  if (args[0] === "cdp" && args[1] === "Input.dispatchMouseEvent") {
    const browserUrl = (await exec("agent-browser", ["--session", session, "get", "cdp-url"])).stdout.trim();
    const pageUrl = (await exec("agent-browser", ["--session", session, "get", "url"])).stdout.trim();
    const address = new URL(browserUrl);
    const targets = await (await fetch(`http://${address.host}/json/list`)).json();
    const target = targets.find(item => item.type === "page" && item.url === pageUrl);
    if (!target?.webSocketDebuggerUrl) throw new Error(`No CDP page target for ${pageUrl}`);
    const result = await new Promise((resolveCdp, rejectCdp) => {
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      const timer = setTimeout(() => {
        socket.close();
        rejectCdp(new Error("CDP command timed out"));
      }, 30000);
      socket.addEventListener("open", () =>
        socket.send(JSON.stringify({ id: 1, method: args[1], params: JSON.parse(args[2]) })),
      );
      socket.addEventListener("message", event => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        clearTimeout(timer);
        socket.close();
        if (message.error) rejectCdp(new Error(JSON.stringify(message.error)));
        else resolveCdp(message.result);
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        rejectCdp(new Error("CDP connection failed"));
      });
    });
    return { stdout: JSON.stringify(result), stderr: "" };
  }
  return exec("agent-browser", ["--session", session, ...args], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 125000,
  });
}

export function runBrowserSync(session, ...args) {
  if (process.env.MARGINSTUDY_BROWSER === "ego") return runEgoSync(session, ...args);
  const result = spawnSync("agent-browser", ["--session", session, ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 125000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `agent-browser exited with ${result.status}`);
  return result.stdout;
}
