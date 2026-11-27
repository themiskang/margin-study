/**
 * [INPUT]: 依赖阅读器宿主或滚动容器 DOM、设置开关回调与选区/多选状态查询。
 * [OUTPUT]: 导出 SWIPE_GUARD_THRESHOLD_PX、ReaderSwipeGuardOptions 与 attachReaderSwipeGuard。
 * [POS]: 位于 src/utils/，为 PDF/Word/HTML/EPUB 阅读器与学习工作区阅读宿主提供统一的单指水平防侧栏拉出守卫。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */

export const SWIPE_GUARD_THRESHOLD_PX = 8;

const EXCLUDED_SWIPE_TARGET_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[contenteditable='']",
  ".ms-toolbar",
  ".ms-workspace-toolbar",
  ".ms-bottom-capsule-shell",
  ".ms-workspace-tabs",
  ".ms-workspace-reader-tab-row",
  ".ms-workspace-map",
  ".ms-workspace-auxiliary",
  ".ms-workspace-library",
  ".ms-card-panel",
  ".ms-mindmap",
  ".ms-thumb-panel",
  ".ms-document-toc",
  ".ms-native-popover",
  ".ms-overlay-text-editor",
  ".ms-modal-bg",
  ".modal-container",
].join(",");

export interface ReaderSwipeGuardOptions {
  /** 是否开启拦截（对应 settings.blockSidebarSwipe !== false）。 */
  isEnabled: () => boolean;
  /** 返回当前阅读滚动容器，用于检测横向可滚动余量。 */
  getScrollEl?: () => HTMLElement | null;
  /** 返回当前是否处于多指/多选/选区拖拽中；为 true 时不拦截。 */
  isSelectionOrMultiSelectActive?: () => boolean;
  /** 判定滑动方向的最小位移阈值（px），默认 8。 */
  thresholdPx?: number;
}

interface SwipeGestureState {
  startX: number;
  startY: number;
  touchId: number;
  decision: "pending" | "block" | "allow";
}

function targetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function isExcludedSwipeTarget(target: EventTarget | null): boolean {
  const el = targetElement(target);
  return !!el?.closest(EXCLUDED_SWIPE_TARGET_SELECTOR);
}

function hasActiveTextSelection(): boolean {
  const selection = typeof window !== "undefined" ? window.getSelection?.() : null;
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  return selection.toString().length > 0;
}

function resolveScrollSurface(
  target: EventTarget | null,
  boundaryEl: HTMLElement,
  getScrollEl?: () => HTMLElement | null,
): HTMLElement {
  const el = targetElement(target);
  const closestScroll = el?.closest<HTMLElement>(".ms-scroll") ?? null;
  if (closestScroll && boundaryEl.contains(closestScroll)) return closestScroll;
  return getScrollEl?.() ?? boundaryEl;
}

function hasHorizontalScrollRoom(
  target: EventTarget | null,
  boundaryEl: HTMLElement,
  getScrollEl?: () => HTMLElement | null,
): boolean {
  const surface = resolveScrollSurface(target, boundaryEl, getScrollEl);
  if (surface.scrollWidth > surface.clientWidth + 1) return true;
  let cur = targetElement(target) as HTMLElement | null;
  while (cur && cur !== surface && surface.contains(cur)) {
    if (cur.scrollWidth > cur.clientWidth + 1) {
      const overflowX = getComputedStyle(cur).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

function findTrackedTouch(touches: TouchList, touchId: number): Touch | null {
  for (let i = 0; i < touches.length; i++) {
    const touch = touches[i];
    if (touch && touch.identifier === touchId) return touch;
  }
  return touches[0] ?? null;
}

/**
 * 在阅读区域挂载单指水平滑动拦截器，防止平板书写时误拉出 Obsidian 左右侧栏。
 * 仅在同时满足以下条件时对 touchmove 调用 preventDefault()：
 * 1. 设置已启用（isEnabled() 为 true）
 * 2. 单指触摸（touches.length === 1）
 * 3. 水平位移 > 竖直位移且超过阈值（默认 8px）
 * 4. 当前阅读面无横向可滚动余量（scrollWidth <= clientWidth + 1）
 * 5. 不在排除区域（工具栏/卡片/脑图/输入框）且无活动选区或多选手势
 */
export function attachReaderSwipeGuard(
  targetEl: HTMLElement,
  options: ReaderSwipeGuardOptions,
): () => void {
  const threshold = options.thresholdPx ?? SWIPE_GUARD_THRESHOLD_PX;
  let gesture: SwipeGestureState | null = null;

  const allowRestOfGesture = () => {
    if (gesture) gesture.decision = "allow";
    else gesture = { startX: 0, startY: 0, touchId: -1, decision: "allow" };
  };

  const onTouchStart = (event: TouchEvent): void => {
    if (!options.isEnabled()) {
      gesture = null;
      return;
    }
    if (event.touches.length !== 1) {
      allowRestOfGesture();
      return;
    }
    if (
      isExcludedSwipeTarget(event.target) ||
      hasActiveTextSelection() ||
      options.isSelectionOrMultiSelectActive?.()
    ) {
      allowRestOfGesture();
      return;
    }
    const touch = event.touches[0];
    if (!touch) {
      gesture = null;
      return;
    }
    gesture = {
      startX: touch.clientX,
      startY: touch.clientY,
      touchId: touch.identifier,
      decision: "pending",
    };
  };

  const onTouchMove = (event: TouchEvent): void => {
    if (!options.isEnabled()) return;
    if (event.touches.length !== 1) {
      allowRestOfGesture();
      return;
    }
    if (!gesture || gesture.decision === "allow") return;
    if (
      isExcludedSwipeTarget(event.target) ||
      hasActiveTextSelection() ||
      options.isSelectionOrMultiSelectActive?.()
    ) {
      gesture.decision = "allow";
      return;
    }
    if (gesture.decision === "block") {
      if (hasHorizontalScrollRoom(event.target, targetEl, options.getScrollEl)) {
        gesture.decision = "allow";
        return;
      }
      if (event.cancelable) event.preventDefault();
      return;
    }

    const touch = findTrackedTouch(event.touches, gesture.touchId);
    if (!touch) return;
    const dx = Math.abs(touch.clientX - gesture.startX);
    const dy = Math.abs(touch.clientY - gesture.startY);
    if (Math.max(dx, dy) < threshold) return;

    if (dx > dy) {
      if (hasHorizontalScrollRoom(event.target, targetEl, options.getScrollEl)) {
        gesture.decision = "allow";
        return;
      }
      gesture.decision = "block";
      if (event.cancelable) event.preventDefault();
    } else {
      gesture.decision = "allow";
    }
  };

  const onTouchEndOrCancel = (event: TouchEvent): void => {
    if (event.touches.length === 0) gesture = null;
    else allowRestOfGesture();
  };

  targetEl.addEventListener("touchstart", onTouchStart, { passive: true });
  targetEl.addEventListener("touchmove", onTouchMove, { passive: false });
  targetEl.addEventListener("touchend", onTouchEndOrCancel, { passive: true });
  targetEl.addEventListener("touchcancel", onTouchEndOrCancel, { passive: true });

  return () => {
    gesture = null;
    targetEl.removeEventListener("touchstart", onTouchStart);
    targetEl.removeEventListener("touchmove", onTouchMove);
    targetEl.removeEventListener("touchend", onTouchEndOrCancel);
    targetEl.removeEventListener("touchcancel", onTouchEndOrCancel);
  };
}
