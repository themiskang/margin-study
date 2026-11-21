// Card A stage 2 forensics helper: launch isolated Obsidian, drive/observe via CDP on 9333,
// and read/write-watch the plugin main state file. Observation only.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export const BUNDLE = ["main.js", "manifest.json", "styles.css", "pdf.worker.js"];
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const shaFile = file => sha256(fs.readFileSync(file));
export const jsonWrite = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const now = () => new Date().toISOString();
export const stepsLog = () => process.env.CA_STEPS_LOG;
export const note = (label, value) => {
  const line = `${now()} ${label}${value === undefined ? "" : " " + JSON.stringify(value)}`;
  if (stepsLog()) fs.appendFileSync(stepsLog(), line + "\n");
  return line;
};

export function portFree(port = 9333) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

async function pageTarget(timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const list = await (await fetch("http://127.0.0.1:9333/json/list")).json();
      const page = list.find(t => t.type === "page" && t.url.startsWith("app://obsidian.md"));
      if (page) return page;
    } catch {}
    await sleep(120);
  }
  throw new Error("CDP page target not found on 9333");
}

export class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(timeout = 90000) {
    const page = await pageTarget(timeout);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const client = new CDP(ws);
    ws.addEventListener("message", event => {
      const msg = JSON.parse(event.data);
      if (msg.id && client.pending.has(msg.id)) {
        const { resolve, reject } = client.pending.get(msg.id);
        client.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return client;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error("CDP timeout " + method)); }, 180000);
    });
  }
  async eval(expression, awaitPromise = true) {
    const out = await this.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: true, allowUnsafeEvalBlockedByCSP: true });
    if (out.exceptionDetails) throw new Error("eval failed: " + JSON.stringify(out.exceptionDetails).slice(0, 900));
    return out.result?.value;
  }
  async click(x, y) {
    note("click", { x: Math.round(x), y: Math.round(y) });
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
      await sleep(20);
    }
  }
  async key(keyName, modifiers = 0, code = keyName, text) {
    const base = { key: keyName, code, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0, modifiers };
    await this.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, ...(text ? { text } : {}), ...(text ? { unmodifiedText: text } : {}) });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await sleep(30);
  }
  close() { try { this.ws.close(); } catch {} }
}

export function launchObsidian({ root, stage }) {
  const log = path.join(root, `${stage}.obsidian.log`);
  const child = spawn("/Applications/Obsidian.app/Contents/MacOS/Obsidian",
    [`--user-data-dir=${path.join(root, "profile")}`, "--remote-debugging-port=9333"],
    { env: { ...process.env, CFFIXED_USER_HOME: path.join(root, "home") }, stdio: ["ignore", fs.openSync(log, "a"), fs.openSync(log, "a")], detached: true });
  child.unref();
  return { pid: child.pid, log };
}

export async function waitExit(pid, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { process.kill(pid, 0); } catch (e) { if (e.code === "ESRCH") return true; }
    await sleep(150);
  }
  return false;
}

export async function waitWorkspace(cdp, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const ok = await cdp.eval(`!!(window.app && app.workspace && app.vault && document.querySelector(".workspace"))`);
      if (ok) return true;
    } catch {}
    await sleep(200);
  }
  throw new Error("workspace not ready");
}

export const obsidianVersion = () => execFileSync("/usr/bin/defaults",
  ["read", "/Applications/Obsidian.app/Contents/Info.plist", "CFBundleShortVersionString"], { encoding: "utf8" }).trim();

export async function quitObsidian(pid) {
  execFileSync("/usr/bin/osascript", ["-e", 'tell application "Obsidian" to quit']);
  return waitExit(pid, 45000);
}

// ---------- main state file observation ----------
const shortDate = value => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

export function readMainState(file) {
  if (!fs.existsSync(file)) return { exists: false };
  const stat = fs.statSync(file);
  const bytes = fs.readFileSync(file);
  let parsed = null, parseError = null;
  try { parsed = JSON.parse(bytes.toString("utf8")); } catch (error) { parseError = String(error); }
  return {
    exists: true,
    path: file,
    at: now(),
    sha256: sha256(bytes),
    size: bytes.length,
    mtimeMs: stat.mtimeMs,
    mtime: new Date(stat.mtimeMs).toISOString(),
    parseError,
    revision: parsed?.revision ?? null,
    writerId: parsed?.writerId ?? null,
    savedAt: parsed?.savedAt ?? null,
    schemaVersion: parsed?.schemaVersion ?? null,
    localEventsLength: Array.isArray(parsed?.localEvents) ? parsed.localEvents.length : null,
    lastLocalEvent: Array.isArray(parsed?.localEvents) && parsed.localEvents.length ? parsed.localEvents[parsed.localEvents.length - 1] : null,
  };
}

export function mainFileCopy(file, outFile) {
  fs.copyFileSync(file, outFile);
  return { copiedTo: outFile, ...readMainState(outFile), sourceSha256: readMainState(file).sha256 };
}

export const SIX = ["sha256", "mtimeMs", "revision", "writerId", "savedAt", "localEventsLength"];

export function sixDiff(before, after) {
  const fields = {};
  for (const key of SIX) fields[key] = { before: before?.[key] ?? null, after: after?.[key] ?? null, equal: (before?.[key] ?? null) === (after?.[key] ?? null) };
  const revisionDelta = (after?.revision ?? 0) - (before?.revision ?? 0);
  const localEventsDelta = (after?.localEventsLength ?? 0) - (before?.localEventsLength ?? 0);
  return {
    fields,
    revisionDelta,
    localEventsDelta,
    allSixEqual: SIX.every(key => fields[key].equal),
  };
}

/** Records every observed content state of one file; one distinct sha transition = one write. */
export class WriteWatch {
  constructor(file, label) {
    this.file = file;
    this.label = label;
    this.states = [];
    this.rawEvents = [];
    this.startedAt = now();
    this.timer = null;
    this.closed = false;
    this.sample("open");
    this.watcher = fs.watch(path.dirname(file), (_event, name) => {
      if (name !== path.basename(file)) return;
      this.rawEvents.push(now());
      if (this.timer) return;
      this.timer = setTimeout(() => { this.timer = null; this.sample("fs-event"); }, 60);
    });
  }
  sample(reason) {
    if (this.closed) return;
    if (!fs.existsSync(this.file)) { return; }
    const stat = fs.statSync(this.file);
    const bytes = fs.readFileSync(this.file);
    const sha = sha256(bytes);
    const last = this.states[this.states.length - 1];
    if (last && last.sha256 === sha && last.mtimeMs === stat.mtimeMs && last.size === bytes.length) return;
    let revision = null;
    try { revision = JSON.parse(bytes.toString("utf8"))?.revision ?? null; } catch {}
    this.states.push({ at: now(), reason, sha256: sha, size: bytes.length, mtimeMs: stat.mtimeMs, revision });
  }
  stop() {
    this.sample("close");
    this.closed = true;
    try { this.watcher.close(); } catch {}
    if (this.timer) clearTimeout(this.timer);
    // A content write = the bytes on disk changed. A touch = mtime moved while the bytes stayed identical.
    let contentWrites = 0, touches = 0;
    for (let i = 1; i < this.states.length; i++) {
      if (this.states[i].sha256 !== this.states[i - 1].sha256) contentWrites++;
      else touches++;
    }
    return {
      file: this.file,
      label: this.label,
      startedAt: this.startedAt,
      stoppedAt: now(),
      distinctObservations: this.states.length,
      contentWrites,
      touches,
      writes: contentWrites,
      states: this.states,
      rawFsEventCount: this.rawEvents.length,
    };
  }
}

export async function waitQuiet(file, { quietMs = 5000, timeoutMs = 60000 } = {}) {
  const end = Date.now() + timeoutMs;
  let last = readMainState(file);
  let since = Date.now();
  while (Date.now() < end) {
    await sleep(250);
    const current = readMainState(file);
    if (current.sha256 !== last.sha256 || current.mtimeMs !== last.mtimeMs) { last = current; since = Date.now(); continue; }
    if (Date.now() - since >= quietMs) return { quiet: true, seconds: Math.round((Date.now() - since) / 100) / 10, state: current };
  }
  return { quiet: false, seconds: null, state: readMainState(file) };
}

export function treeHashes(dir) {
  const out = {};
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    out[name] = fs.statSync(abs).isFile() ? shaFile(abs) : "dir";
  }
  return out;
}

export function bareDates(parsed) {
  const rows = [];
  for (const [id, state] of Object.entries(parsed?.srs ?? {})) {
    if (state?.due && shortDate(state.due)) rows.push({ id, field: "due", value: state.due });
    if (state?.lastReviewed && shortDate(state.lastReviewed)) rows.push({ id, field: "lastReviewed", value: state.lastReviewed });
  }
  return rows;
}

export const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const HEX64_RE = /^[0-9a-f]{64}$/;
