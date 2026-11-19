/**
 * [INPUT]: 读取学习集包文件、目标库路径与插件侧车路径。
 * [OUTPUT]: 提供导入串行锁、文件计划、恢复清单及文件回滚。
 * [POS]: 先落盘恢复清单，再写入原件和批注，供主数据提交前后核对。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { strFromU8, strToU8 } from "fflate";
import type { Vault } from "obsidian";
import { sha256Hex } from "../utils/sha256";

interface ImportFile {
  path: string;
  bytes: Uint8Array;
  sidecar?: boolean;
}

const journalDir = "_marginstudy-recovery/study-set-imports";
const tails = new Map<object | string, Promise<unknown>>();

export async function withStudySetImportLock<T>(vault: Vault, action: () => Promise<T>): Promise<T> {
  const adapter = vault.adapter as Vault["adapter"] & { getBasePath?: () => string };
  const key = adapter.getBasePath?.() || adapter;
  const request = (tails.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
  tails.set(key, request);
  try { return await request; }
  finally { if (tails.get(key) === request) tails.delete(key); }
}

export function safeStudySetPath(path: string): string {
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || /[\\\u0000-\u001f]/.test(path) ||
      path.split("/").some(part => !part || /^(?:\.{1,2}|\.obsidian|\.git|_marginstudy-recovery)$/i.test(part))) {
    throw new Error("包内路径无效：" + path);
  }
  return path;
}

export async function planStudySetFiles(vault: Vault, files: Map<string, Uint8Array>, sidecarPath: (path: string) => string) {
  const pathMap = new Map<string, string>(), writes: ImportFile[] = [], originals = new Map<string, Uint8Array>();
  const documentEntries = new Map<string, ImportFile>(), documentPaths = new Set<string>(), reserved = new Set<string>();
  let renamedDocuments = 0, pageCollectionRefs = 0;
  for (const [entry, bytes] of files) {
    const document = entry.startsWith("documents/");
    const relative = safeStudySetPath(document ? entry.slice("documents/".length) : entry);
    if (pathMap.has(relative)) {
      if (sha256Hex(originals.get(relative)!) !== sha256Hex(bytes)) throw new Error("包内路径重复且内容不同：" + relative);
      if (document) documentPaths.add(relative);
      continue;
    }
    if (!document && /^_marginstudy-media\/[a-f0-9]{64}\.[a-z0-9]+$/i.test(relative) && await vault.adapter.exists(relative)) {
      const hash = sha256Hex(bytes);
      const canonical = relative.replace(/\/[a-f0-9]{64}\./i, `/${hash}.`);
      if (sha256Hex(await vault.adapter.readBinary(relative)) === hash) {
        pathMap.set(relative, relative);
      } else if (!await vault.adapter.exists(canonical) && !reserved.has(canonical)) {
        pathMap.set(relative, canonical);
        writes.push({ path: canonical, bytes });
      } else if (await vault.adapter.exists(canonical) && sha256Hex(await vault.adapter.readBinary(canonical)) === hash) {
        pathMap.set(relative, canonical);
      } else {
        throw new Error("库中已有同名且内容不同的图片：" + relative);
      }
      reserved.add(pathMap.get(relative)!);
      originals.set(relative, bytes);
      continue;
    }
    let target = relative, suffix = 2;
    const endOfName = relative.lastIndexOf("."), hasExtension = endOfName > relative.lastIndexOf("/") + 1;
    const stem = hasExtension ? relative.slice(0, endOfName) : relative, ext = hasExtension ? relative.slice(endOfName) : "";
    while (reserved.has(target) || reserved.has(sidecarPath(target)) || vault.getAbstractFileByPath(target) ||
      await vault.adapter.exists(target) || await vault.adapter.exists(sidecarPath(target))) {
      target = document ? `${stem} (${suffix++})${ext}` : `${stem}-${suffix++}${ext}`;
    }
    if (target !== relative && document) renamedDocuments++;
    reserved.add(target); reserved.add(sidecarPath(target));
    pathMap.set(relative, target);
    originals.set(relative, bytes);
    const write = { path: target, bytes };
    writes.push(write);
    if (document) {
      documentEntries.set(relative, write);
      documentPaths.add(relative);
    }
  }
  for (const [path, file] of documentEntries) {
    if (!/\.msref$/i.test(path)) continue;
    let collection: { format?: string; pages?: { sourcePath?: string }[] };
    try { collection = JSON.parse(strFromU8(file.bytes)); } catch { continue; }
    if (collection?.format !== "marginstudy-page-collection" || !Array.isArray(collection.pages)) continue;
    let changed = false;
    for (const page of collection.pages) {
      const mapped = page?.sourcePath && pathMap.get(page.sourcePath);
      if (mapped && mapped !== page.sourcePath) { page.sourcePath = mapped; pageCollectionRefs++; changed = true; }
    }
    if (changed) file.bytes = strToU8(JSON.stringify(collection));
  }
  return { pathMap, writes, documentPaths, renamedDocuments, pageCollectionRefs };
}

async function ensureParent(vault: Vault, path: string): Promise<void> {
  const parts = path.split("/");
  parts.pop();
  let folder = "";
  for (const part of parts) {
    folder = folder ? `${folder}/${part}` : part;
    if (!await vault.adapter.exists(folder)) await vault.adapter.mkdir(folder);
  }
}

export async function writeStudySetFiles(vault: Vault, files: ImportFile[]): Promise<void> {
  for (const { path, bytes, sidecar } of files) {
    await ensureParent(vault, path);
    if (await vault.adapter.exists(path) || vault.getAbstractFileByPath(path)) throw new Error("导入目标文件已存在：" + path);
    if (sidecar) await vault.adapter.write(path, strFromU8(bytes));
    else await vault.createBinary(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }
}

interface JournalFile { path: string; sha256: string }

export class StudySetImportJournal {
  private path: string;
  constructor(private vault: Vault, key: string) { this.path = `${journalDir}/${key}.json`; }

  async begin(files: ImportFile[]): Promise<void> {
    const { adapter } = this.vault;
    await ensureParent(this.vault, this.path);
    if (await adapter.exists(this.path)) throw new Error("同一学习集包已有待恢复的导入");
    const planned = files.map(file => ({ path: file.path, sha256: sha256Hex(file.bytes) }));
    await adapter.write(this.path, JSON.stringify(planned));
  }

  async finish(): Promise<void> {
    const { adapter } = this.vault;
    if (await adapter.exists(this.path)) await adapter.remove(this.path);
  }

  async rollback(): Promise<void> {
    const { adapter } = this.vault;
    if (!await adapter.exists(this.path)) return;
    const planned: JournalFile[] = JSON.parse(await adapter.read(this.path));
    if (!Array.isArray(planned) || planned.some(file => !file || typeof file.path !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256) || safeStudySetPath(file.path) !== file.path)) {
      throw new Error("导入恢复清单无效：" + this.path);
    }
    for (const { path, sha256 } of planned) {
      if (await adapter.exists(path) && sha256Hex(await adapter.readBinary(path)) !== sha256) {
        throw new Error("导入文件已发生变化，请检查后重试：" + path);
      }
    }
    for (const { path } of planned.reverse()) {
      if (!await adapter.exists(path)) continue;
      const file = this.vault.getAbstractFileByPath(path);
      if (file) await this.vault.delete(file, true);
      else await adapter.remove(path);
    }
    await this.finish();
  }
}
