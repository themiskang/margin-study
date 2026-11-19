/**
 * [INPUT]: 依赖库适配器、设备本地存储和备份内容校验。
 * [OUTPUT]: 提供升级备份暂存、发布、去重、回收和恢复候选路径。
 * [POS]: 隔离未发布的升级备份，保留已发布备份和其他进程的暂存目录。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { App, DataAdapter } from "obsidian";
import { uid } from "../utils/id";
import { sha256Hex } from "../utils/sha256";

export type BackupFile = { path: string; storedPath: string; sha256: string; bytes: number };
export type BackupManifest = { format: "margin-study-backup"; version: 2; createdAt: string; dataSha256: string; files: BackupFile[]; missingFiles?: string[] };
export const BACKUP_ROOT = "MarginStudyBackups";
const stagePrefix = `${BACKUP_ROOT}/_migration-v3-staging-`;
const stagePattern = new RegExp(`^${stagePrefix}([a-f0-9]{64})-(\\d+)-stage-[a-z0-9]+-[a-z0-9]{1,6}$`);
const localOwnerKey = "margin-study.migration-backup-owner";
const runtimeKey = Symbol.for("margin-study.active-migration-backups");
const runtime = globalThis as typeof globalThis & { [runtimeKey]?: Set<string> };
const activeDirectories = runtime[runtimeKey] ??= new Set<string>();

function stageOwner(app: App): { owner: string; pid: number } {
  if (typeof process !== "undefined" && process.versions?.node) {
    const { hostname } = require("os") as typeof import("os");
    return { owner: sha256Hex(hostname()), pid: process.pid };
  }
  const vaultStorage = typeof app.loadLocalStorage === "function" && typeof app.saveLocalStorage === "function";
  let owner = vaultStorage ? app.loadLocalStorage(localOwnerKey) : localStorage.getItem(localOwnerKey);
  if (typeof owner !== "string" || !/^[a-f0-9]{64}$/.test(owner)) {
    owner = sha256Hex(uid("device"));
    if (vaultStorage) app.saveLocalStorage(localOwnerKey, owner);
    else localStorage.setItem(localOwnerKey, owner);
  }
  return { owner, pid: 0 };
}

export function isStagedMigrationBackup(path: string): boolean {
  return path.toLowerCase().startsWith(stagePrefix.toLowerCase());
}

export function isMigrationBackup(path: string): boolean {
  return /^MarginStudyBackups\/pre-v3-[^/]+\/manifest\.json$/.test(path);
}

async function backupFolders(adapter: DataAdapter): Promise<string[]> {
  return typeof adapter.list === "function" && await adapter.exists(BACKUP_ROOT) ? (await adapter.list(BACKUP_ROOT)).folders : [];
}

export async function migrationBackupPaths(adapter: DataAdapter): Promise<string[]> {
  return (await backupFolders(adapter)).map(folder => `${folder}/manifest.json`).filter(isMigrationBackup);
}

async function removeStage(adapter: DataAdapter, path: string): Promise<void> {
  try {
    if (await adapter.exists(path)) await adapter.rmdir(path, true);
  } catch (error) {
    if (await adapter.exists(path)) throw error;
  }
}

export async function clearAbandonedMigrationBackups(app: App): Promise<void> {
  const adapter = app.vault.adapter;
  const stages = (await backupFolders(adapter)).flatMap(path => {
    const match = stagePattern.exec(path);
    return match ? [{ path, owner: match[1], pid: Number(match[2]) }] : [];
  });
  if (!stages.length) return;
  const current = stageOwner(app);
  for (const { path, owner, pid } of stages) {
    if (owner !== current.owner || activeDirectories.has(path)) continue;
    if (pid === 0 && current.pid === 0) {
      await removeStage(adapter, path);
    } else if (pid > 0 && current.pid > 0) {
      try { process.kill(pid, 0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") await removeStage(adapter, path);
      }
    }
  }
}

function backupFingerprint(manifest: BackupManifest): string {
  const files = manifest.files.map(file => [file.path, file.sha256, file.bytes]).sort();
  return sha256Hex(JSON.stringify([manifest.dataSha256, files, [...new Set(manifest.missingFiles ?? [])].sort()]));
}

export async function publishMigrationBackup(
  app: App,
  write: (dir: string) => Promise<BackupManifest>,
  verify: (manifestPath: string) => Promise<BackupManifest>,
): Promise<void> {
  const adapter = app.vault.adapter;
  await clearAbandonedMigrationBackups(app);
  const { owner, pid } = stageOwner(app);
  const stage = `${stagePrefix}${owner}-${pid}-${uid("stage")}`;
  activeDirectories.add(stage);
  try {
    const expected = await write(stage);
    const verified = await verify(`${stage}/manifest.json`);
    if (JSON.stringify(verified) !== JSON.stringify(expected)) throw new Error("升级前备份的清单校验失败");
    const fingerprint = backupFingerprint(verified);
    const matches = async (path: string) => {
      try {
        const candidate = JSON.parse(await adapter.read(path)) as BackupManifest;
        return backupFingerprint(candidate) === fingerprint && backupFingerprint(await verify(path)) === fingerprint;
      } catch {
        return false;
      }
    };
    for (const path of await migrationBackupPaths(adapter)) if (await matches(path)) return;
    const preferred = `${BACKUP_ROOT}/pre-v3-${fingerprint}`;
    const occupied = await adapter.exists(preferred);
    if (occupied && await matches(`${preferred}/manifest.json`)) return;
    const destination = occupied ? `${preferred}-${uid("backup")}` : preferred;
    try {
      await adapter.rename(stage, destination);
    } catch (error) {
      if (!await matches(`${destination}/manifest.json`)) throw error;
    }
  } finally {
    try { await removeStage(adapter, stage); }
    finally { activeDirectories.delete(stage); }
  }
}
