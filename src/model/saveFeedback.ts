/**
 * [INPUT]: 依赖 Store 的桌面停写状态与保存异常。
 * [OUTPUT]: 提供内存修改反馈、保存失败文案和冲突错误类型。
 * [POS]: 区分学习库暂存、保存失败与需要处理的写入冲突。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { DesktopMainConflict } from "./desktopMainReplacement";
import type { Store } from "./store";

const MEMORY_ONLY_SAVE = "修改已保留在内存，未写入磁盘。请运行「处理保存冲突」。";

export function saveFeedback(store: Pick<Store, "hasDesktopMainConflict">, success: string, memoryOnly = MEMORY_ONLY_SAVE): string {
  return store.hasDesktopMainConflict() ? memoryOnly : success;
}

export class LibrarySaveConflict extends Error {}

export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function saveFailureText(error: unknown): string {
  const desktop = error instanceof DesktopMainConflict;
  const conflict = desktop || error instanceof LibrarySaveConflict;
  const reason = desktop ? "保存冲突（发现主数据外部修改，已暂停写入）" : errorDetail(error).replace(/[。；;]+$/, "");
  const disk = desktop ? "原版本已保留" : conflict ? "原文件未改" : "未确认写入磁盘";
  const action = conflict ? "处理保存冲突" : "重试保存";
  return `保存未完成：${reason}；修改仍在内存，${disk}。→ ${action}`;
}
