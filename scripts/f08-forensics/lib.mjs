// F08 forensics helper: launch isolated Obsidian, drive/observe via CDP on port 9333.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const shaFile = file => sha256(fs.readFileSync(file));
export const jsonWrite = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const now = () => new Date().toISOString();

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
  static async connect(timeout = 60000) {
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
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error("CDP timeout " + method)); }, 120000);
    });
  }
  async eval(expression, awaitPromise = true) {
    const out = await this.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: true, allowUnsafeEvalBlockedByCSP: true });
    if (out.exceptionDetails) throw new Error("eval failed: " + JSON.stringify(out.exceptionDetails).slice(0, 900));
    return out.result?.value;
  }
  async screenshot(file) {
    const out = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(out.data, "base64"));
  }
  async click(x, y) {
    fs.appendFileSync(process.env.F08_STEPS_LOG, `${now()} click ${Math.round(x)},${Math.round(y)}\n`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
      await sleep(20);
    }
  }
  async doubleClick(x, y) {
    await this.click(x, y);
    await sleep(40);
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 2 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 2 });
  }
  async key(keyName, modifiers = 0, code = keyName, text) {
    const base = { key: keyName, code, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0, modifiers };
    await this.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, ...(text ? { text } : {}), ...(text ? { unmodifiedText: text } : {}) });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await sleep(30);
  }
  async type(text) {
    fs.appendFileSync(process.env.F08_STEPS_LOG, `${now()} type ${JSON.stringify(text)}\n`);
    for (const ch of text) await this.send("Input.insertText", { text: ch });
    await sleep(30);
  }
  async typeKeys(text) {
    for (const ch of text) {
      const code = /[a-zA-Z]/.test(ch) ? `Key${ch.toUpperCase()}` : ch === " " ? "Space" : "";
      await this.key(ch, 0, code, ch);
    }
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

export async function obsidianVersion() {
  return (await import("node:child_process")).execFileSync("/usr/bin/defaults", ["read", "/Applications/Obsidian.app/Contents/Info.plist", "CFBundleShortVersionString"], { encoding: "utf8" }).trim();
}

export async function rendererPid(cdp) { return await cdp.eval("process.pid"); }

export async function waitWorkspace(cdp, timeout = 90000) {
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

export function treeHashes(dir) {
  const out = {};
  for (const name of fs.readdirSync(dir)) out[name] = shaFile(path.join(dir, name));
  return out;
}

export function vaultHashes(vault) {
  const rows = {};
  const walk = rel => {
    for (const entry of fs.readdirSync(path.join(vault, rel), { withFileTypes: true })) {
      const next = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) rows[next] = shaFile(path.join(vault, next));
    }
  };
  walk("");
  return rows;
}

