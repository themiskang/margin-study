/**
 * [INPUT]: 依赖 macOS 原子交换、库路径和主数据字节。
 * [OUTPUT]: 提供替换、未完成暂存回收和冲突版本读取。
 * [POS]: 保留替换实际移出的文件。仅回收本次或已退出写入者的暂存。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { DataAdapter } from "obsidian";
import { sha256Hex } from "../utils/sha256";

const exchangeScript = `
ObjC.bindFunction("renamex_np", ["int", ["char *", "char *", "unsigned int"]]);
function run(paths) {
  const RENAME_SWAP = 2;
  if ($.renamex_np(paths[0], paths[1], RENAME_SWAP) !== 0) throw Error("主数据原子交换失败");
}
`;
const activeKey = Symbol.for("margin-study.active-main-replacements");
const runtime = globalThis as typeof globalThis & { [activeKey]?: Set<string> };
const active = runtime[activeKey] ??= new Set<string>();
const notFound = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

export class DesktopMainConflict extends Error {
  #local: string;
  #remote: string;

  constructor(readonly path: string, local: string, remote: string) {
    super("发现主数据外部修改，已暂停写入。两份版本已保留，请运行「处理保存冲突」。");
    this.#local = local;
    this.#remote = remote;
  }

  get local(): string { return this.#local; }
  get remote(): string { return this.#remote; }
}

function desktopFiles(base: string, path: string) {
  const fs = (require("fs") as typeof import("fs")).promises;
  const paths = require("path") as typeof import("path");
  const { hostname } = require("os") as typeof import("os");
  const main = paths.join(base, path);
  const prefix = `${paths.basename(main)}.ms-replace-${sha256Hex(hostname())}-`;
  return { fs, paths, main, prefix };
}

async function takeDisplaced(fs: typeof import("fs").promises, dir: string, join: typeof import("path").join) {
  const displaced = join(dir, "displaced.json");
  await fs.rename(dir + ".tmp", displaced).catch(error => { if (!notFound(error)) throw error; });
  return fs.readFile(displaced).catch(error => { if (!notFound(error)) throw error; return null; });
}

function bytesHash(bytes: Buffer): string {
  return sha256Hex(Uint8Array.from(bytes).buffer);
}

async function inspectStage(base: string, path: string, name: string, recover: boolean): Promise<DesktopMainConflict | null> {
  const { fs, paths } = desktopFiles(base, path);
  const dir = paths.join(base, name);
  const displaced = recover
    ? await takeDisplaced(fs, dir, paths.join)
    : await fs.readFile(paths.join(dir, "displaced.json")).catch(error => { if (!notFound(error)) throw error; return null; });
  if (displaced) {
    const expected = await fs.readFile(paths.join(dir, "expected.sha256"), "utf8").catch(error => { if (!notFound(error)) throw error; return ""; });
    const hash = bytesHash(displaced);
    if (expected && hash !== expected) {
      const candidate = await fs.readFile(paths.join(dir, "candidate.json"));
      if (hash !== bytesHash(candidate)) return new DesktopMainConflict(name, candidate.toString("utf8"), displaced.toString("utf8"));
    }
  }
  if (recover) await fs.rm(dir, { recursive: true, force: true });
  return null;
}

export async function recoverDesktopMainReplacement(base: string, path: string): Promise<DesktopMainConflict | null> {
  const { fs, paths, main, prefix } = desktopFiles(base, path);
  const folder = paths.dirname(main);
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(error => { if (!notFound(error)) throw error; return []; });
  let conflict: DesktopMainConflict | null = null;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const match = /^([1-9]\d*)-[a-f0-9-]{36}$/.exec(entry.name.slice(prefix.length));
    if (!match) continue;
    const pid = Number(match[1]), dir = paths.join(folder, entry.name);
    if (active.has(dir)) continue;
    let recover = pid === process.pid;
    if (!recover) {
      try { process.kill(pid, 0); }
      catch (error) { recover = (error as NodeJS.ErrnoException).code === "ESRCH"; }
    }
    const candidate = await inspectStage(base, path, paths.relative(base, dir), recover);
    conflict ??= candidate;
  }
  return conflict;
}

export async function resolveDesktopMainReplacement(base: string, conflict: DesktopMainConflict): Promise<void> {
  const { rename } = (require("fs") as typeof import("fs")).promises;
  const { join } = require("path") as typeof import("path");
  const dir = join(base, conflict.path);
  await rename(dir, dir + ".resolved");
}

export async function replaceMacMain(
  adapter: DataAdapter, base: string, path: string, content: string, checkCurrent: (text: string) => void,
): Promise<void> {
  const { fs, paths, main, prefix } = desktopFiles(base, path);
  const { randomUUID } = require("crypto") as typeof import("crypto");
  const { execFile } = require("child_process") as typeof import("child_process");
  const dir = paths.join(paths.dirname(main), `${prefix}${process.pid}-${randomUUID()}`);
  const relative = paths.relative(base, dir);
  active.add(dir);
  let failure: unknown;
  try {
    await fs.mkdir(dir);
    await fs.writeFile(paths.join(dir, "candidate.json"), content);
    await adapter.write(relative + ".tmp", content);
    if (await fs.readFile(dir + ".tmp", "utf8") !== content) throw new Error("主数据暂存回读不一致");
    const current = await fs.readFile(main);
    checkCurrent(current.toString("utf8"));
    await fs.writeFile(paths.join(dir, "expected.sha256"), bytesHash(current));
    await new Promise<void>((resolve, reject) => {
      execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", exchangeScript, dir + ".tmp", main],
        error => error ? reject(error) : resolve());
    });
  } catch (error) { failure = error; }
  try {
    const conflict = await inspectStage(base, path, relative, true);
    if (conflict) throw conflict;
    if (failure) throw failure;
  } finally { active.delete(dir); }
}
