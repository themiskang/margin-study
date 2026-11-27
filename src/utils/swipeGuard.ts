/**
 * [INPUT]: 依赖阅读区域宿主 DOM 与 Store 设置订阅接口。
 * [OUTPUT]: 导出 IGNORE_SWIPE_ATTR、applyIgnoreSwipeAttr 与 attachReaderSwipeGuard。
 * [POS]: 位于 src/utils/，为 PDF/Word/HTML/EPUB 阅读器与学习工作区阅读宿主同步 Obsidian 官方 data-ignore-swipe 属性。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */

export const IGNORE_SWIPE_ATTR = "data-ignore-swipe";

export interface SwipeGuardStoreLike {
  settings: { blockSidebarSwipe?: boolean };
  subscribe?: (listener: () => void) => () => void;
}

const activeGuardTargets = new Set<HTMLElement>();

/** 同步目标元素上的 data-ignore-swipe 属性；关闭时必须 removeAttribute，避免 "false" 字符串仍被 Obsidian 判真。 */
export function applyIgnoreSwipeAttr(targetEl: HTMLElement, enabled: boolean): void {
  if (enabled) targetEl.setAttribute(IGNORE_SWIPE_ATTR, "true");
  else targetEl.removeAttribute(IGNORE_SWIPE_ATTR);
}

/** 立即同步全部已挂载阅读区宿主上的 data-ignore-swipe 属性（供设置面板开关同步调用）。 */
export function syncReaderSwipeGuards(enabled: boolean): void {
  for (const targetEl of activeGuardTargets) applyIgnoreSwipeAttr(targetEl, enabled);
}

/**
 * 在阅读区域宿主上挂载 Obsidian 官方 data-ignore-swipe 属性守卫，
 * 并订阅 Store 设置变更即时增删属性；卸载时移除属性并取消订阅。
 */
export function attachReaderSwipeGuard(
  targetEl: HTMLElement,
  store: SwipeGuardStoreLike,
): () => void {
  activeGuardTargets.add(targetEl);
  const sync = () => applyIgnoreSwipeAttr(targetEl, store.settings.blockSidebarSwipe !== false);
  sync();
  const unsubscribe = store.subscribe?.(sync) ?? (() => {});
  return () => {
    unsubscribe();
    activeGuardTargets.delete(targetEl);
    targetEl.removeAttribute(IGNORE_SWIPE_ATTR);
  };
}
