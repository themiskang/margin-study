/**
 * [INPUT]: 依赖 DOM 工具与原生图标渲染（../utils/dom、./nativeIcons）。
 * [OUTPUT]: 导出底部工具栏安全区计算函数 computeBottomBarClearance、响应式溢出纯函数 computeBottomToolbarOverflow 与溢出菜单协调器 BottomToolbarOverflowController。
 * [POS]: 学习工作区底部胶囊工具栏的布局让位与超宽溢出收口模块，被 studyWorkspace.ts 调用。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { el } from "../utils/dom";
import { setNativeIcon } from "./nativeIcons";

export interface BottomToolbarItemMetric {
  id: string;
  width: number;
  pinned?: boolean;
}

export interface BottomToolbarOverflowPlan {
  visibleIds: string[];
  overflowIds: string[];
}

export interface ClearanceRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface BottomClearanceOptions {
  cleanView: boolean;
  statusBarHidden: boolean;
  collapsed: boolean;
  capsuleVisible: boolean;
  gap?: number;
  minReaderHeight?: number;
}

/** 计算底部胶囊与阅读区重叠时所需的底部安全区高度（px）。 */
export function computeBottomBarClearance(
  readerRect: ClearanceRect | null,
  capsuleRect: ClearanceRect | null,
  options: BottomClearanceOptions,
): number {
  if (
    options.cleanView ||
    options.statusBarHidden ||
    options.collapsed ||
    !options.capsuleVisible ||
    !readerRect ||
    !capsuleRect
  ) {
    return 0;
  }
  if (
    capsuleRect.width <= 0 ||
    capsuleRect.height <= 0 ||
    readerRect.width <= 0 ||
    readerRect.height <= 0
  ) {
    return 0;
  }
  const horizontalOverlap =
    capsuleRect.left < readerRect.right && capsuleRect.right > readerRect.left;
  if (!horizontalOverlap) return 0;
  if (readerRect.bottom <= capsuleRect.top) return 0;

  const gap = options.gap ?? 8;
  const raw = Math.max(0, Math.ceil(readerRect.bottom - capsuleRect.top + gap));
  const minReaderHeight = options.minReaderHeight ?? 64;
  const maxAllowed = Math.max(0, Math.floor(readerRect.height - minReaderHeight));
  return Math.min(raw, maxAllowed);
}

/** 按可用宽度与优先级计算底部工具行的可见项与溢出项；不超宽时零溢出。 */
export function computeBottomToolbarOverflow(
  items: BottomToolbarItemMetric[],
  availableWidth: number,
  toggleWidth: number,
  gap = 0,
): BottomToolbarOverflowPlan {
  if (items.length === 0 || availableWidth <= 0) {
    return { visibleIds: items.map(item => item.id), overflowIds: [] };
  }
  const totalWidth =
    items.reduce((sum, item) => sum + Math.max(0, item.width), 0) +
    gap * Math.max(0, items.length - 1);
  if (totalWidth <= availableWidth + 1) {
    return { visibleIds: items.map(item => item.id), overflowIds: [] };
  }

  const budget = Math.max(0, availableWidth - Math.max(0, toggleWidth) - gap);
  const chosen = new Set<string>();
  let used = 0;
  let chosenCount = 0;

  for (const item of items) {
    if (!item.pinned) continue;
    const width = Math.max(0, item.width);
    const next = width + (chosenCount > 0 ? gap : 0);
    if (used + next <= budget + 0.5) {
      chosen.add(item.id);
      used += next;
      chosenCount++;
    }
  }

  for (const item of items) {
    if (chosen.has(item.id)) continue;
    const width = Math.max(0, item.width);
    const next = width + (chosenCount > 0 ? gap : 0);
    if (used + next <= budget + 0.5) {
      chosen.add(item.id);
      used += next;
      chosenCount++;
    } else {
      break;
    }
  }

  const visibleIds = items.filter(item => chosen.has(item.id)).map(item => item.id);
  const overflowIds = items.filter(item => !chosen.has(item.id)).map(item => item.id);
  if (overflowIds.length === 0) {
    return { visibleIds: items.map(item => item.id), overflowIds: [] };
  }
  return { visibleIds, overflowIds };
}

function outerWidth(node: HTMLElement): number {
  const cs = getComputedStyle(node);
  const ml = parseFloat(cs.marginLeft) || 0;
  const mr = parseFloat(cs.marginRight) || 0;
  return node.getBoundingClientRect().width + ml + mr;
}

function syncDividers(tools: HTMLElement, toggle: HTMLElement | null): void {
  const children = [...tools.children].filter(
    node => node !== toggle && node instanceof HTMLElement,
  ) as HTMLElement[];
  for (const child of children) {
    if (child.classList.contains("ms-bottom-divider")) {
      child.classList.remove("is-bottom-overflow-divider-hidden");
    }
  }
  let seenVisibleButton = false;
  let lastVisibleDivider: HTMLElement | null = null;
  for (const child of children) {
    if (child.classList.contains("ms-bottom-divider")) {
      if (!seenVisibleButton || lastVisibleDivider) {
        child.classList.add("is-bottom-overflow-divider-hidden");
      } else {
        lastVisibleDivider = child;
      }
    } else if (!child.classList.contains("is-bottom-overflowed")) {
      seenVisibleButton = true;
      lastVisibleDivider = null;
    }
  }
  if (lastVisibleDivider) {
    lastVisibleDivider.classList.add("is-bottom-overflow-divider-hidden");
  }
}

/** 底部工具栏响应式溢出协调器：宽屏零改动，窄屏收口至向上弹出菜单。 */
export class BottomToolbarOverflowController {
  private menu: HTMLElement | null = null;
  private toggle: HTMLButtonElement | null = null;
  private overflowButtons: HTMLButtonElement[] = [];
  private open = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly dock: HTMLElement,
  ) {}

  getToggle(): HTMLButtonElement | null {
    return this.toggle;
  }

  getOverflowCount(): number {
    return this.overflowButtons.length;
  }

  isOpen(): boolean {
    return this.open;
  }

  closeMenu(): void {
    this.open = false;
    this.menu?.remove();
    this.menu = null;
    this.toggle?.setAttribute("aria-expanded", "false");
  }

  dispose(): void {
    this.closeMenu();
    this.toggle = null;
    this.overflowButtons = [];
  }

  handleOutsidePointerDown(target: Node | null): void {
    if (!this.open || !target) return;
    if (this.menu?.contains(target) || this.toggle?.contains(target)) return;
    this.closeMenu();
  }

  handleEscape(): boolean {
    if (!this.open) return false;
    this.closeMenu();
    return true;
  }

  syncItemStates(): void {
    if (!this.open || !this.menu) return;
    const items = this.menu.querySelectorAll<HTMLButtonElement>(".ms-bottom-overflow-item");
    items.forEach((item, index) => {
      const source = this.overflowButtons[index];
      if (!source) return;
      item.disabled = source.disabled;
      if (source.hasAttribute("aria-pressed")) {
        item.setAttribute("aria-pressed", source.getAttribute("aria-pressed") ?? "false");
      } else {
        item.removeAttribute("aria-pressed");
      }
      if (source.title) item.title = source.title;
    });
  }

  sync(): void {
    if (
      !this.root.isConnected ||
      !this.dock.isConnected ||
      this.root.classList.contains("is-clean-view") ||
      this.root.dataset.statusBar === "hidden" ||
      this.root.dataset.statusBar === "compact" ||
      this.dock.dataset.collapsed === "true"
    ) {
      this.closeMenu();
      return;
    }
    if (typeof this.dock.checkVisibility === "function" && !this.dock.checkVisibility()) {
      this.closeMenu();
      return;
    }
    const primary = this.dock.querySelector<HTMLElement>(".ms-bottom-primary");
    if (!primary || primary.clientWidth <= 0) {
      this.closeMenu();
      return;
    }
    const tools = this.findActiveToolsContainer(primary);
    if (!tools) {
      this.closeMenu();
      return;
    }

    const wasOpen = this.open;
    tools.querySelectorAll(".ms-bottom-overflow-toggle").forEach(node => node.remove());
    const buttons = [...tools.children].filter(
      (node): node is HTMLButtonElement =>
        node instanceof HTMLButtonElement && !node.classList.contains("ms-bottom-overflow-toggle"),
    );
    for (const btn of buttons) {
      btn.classList.remove("is-bottom-overflowed");
      delete btn.dataset.overflowHidden;
    }
    for (const div of tools.querySelectorAll<HTMLElement>(".ms-bottom-divider")) {
      div.classList.remove("is-bottom-overflow-divider-hidden");
    }
    primary.classList.remove("has-bottom-overflow");

    if (buttons.length === 0 || primary.scrollWidth <= primary.clientWidth + 1) {
      this.overflowButtons = [];
      this.toggle = null;
      this.closeMenu();
      return;
    }

    primary.classList.add("has-bottom-overflow");
    if (primary.scrollWidth <= primary.clientWidth + 1) {
      primary.classList.remove("has-bottom-overflow");
      if (primary.scrollWidth <= primary.clientWidth + 1) {
        this.overflowButtons = [];
        this.toggle = null;
        this.closeMenu();
        return;
      }
      primary.classList.add("has-bottom-overflow");
    }

    const primaryStyle = getComputedStyle(primary);
    const padX =
      (parseFloat(primaryStyle.paddingLeft) || 0) + (parseFloat(primaryStyle.paddingRight) || 0);
    const primaryGap = parseFloat(primaryStyle.columnGap || primaryStyle.gap) || 0;
    const primarySiblings = [...primary.children].filter(
      (node): node is HTMLElement =>
        node instanceof HTMLElement &&
        node !== tools &&
        getComputedStyle(node).display !== "none",
    );
    const siblingsWidth =
      primarySiblings.reduce((sum, node) => sum + outerWidth(node), 0) +
      primaryGap * primarySiblings.length;
    const availableToolsWidth = Math.max(0, primary.clientWidth - padX - siblingsWidth);

    const toolsStyle = getComputedStyle(tools);
    const toolsGap = parseFloat(toolsStyle.columnGap || toolsStyle.gap) || 0;
    const metrics: BottomToolbarItemMetric[] = buttons.map((btn, index) => {
      const isHistory =
        btn.dataset.bottomAction === "undo" ||
        btn.dataset.bottomAction === "redo" ||
        btn.dataset.msTool === "undo" ||
        btn.dataset.msTool === "redo";
      return {
        id: String(index),
        width: outerWidth(btn),
        pinned: index === 0 || isHistory,
      };
    });

    const toggleWidth = 36;
    const plan = computeBottomToolbarOverflow(metrics, availableToolsWidth, toggleWidth, toolsGap);
    const overflowSet = new Set<string>(plan.overflowIds);

    const applyHiddenSet = () => {
      buttons.forEach((btn, index) => {
        const hidden = overflowSet.has(String(index));
        btn.classList.toggle("is-bottom-overflowed", hidden);
        if (hidden) btn.dataset.overflowHidden = "true";
        else delete btn.dataset.overflowHidden;
      });
    };

    const toggle = el("button", {
      type: "button",
      class: "ms-bottom-action ms-bottom-overflow-toggle",
      title: "更多工具",
      "aria-label": "更多工具",
      "aria-haspopup": "menu",
      "aria-expanded": "false",
    }) as HTMLButtonElement;
    setNativeIcon(toggle, "ellipsis");
    toggle.addEventListener("click", event => {
      event.stopPropagation();
      if (this.open) this.closeMenu();
      else this.openMenu();
    });

    applyHiddenSet();
    tools.append(toggle);
    syncDividers(tools, toggle);

    // 兜底校验：若存在非零边距或子像素舍入导致仍超宽，逐个把尾部可见项收进溢出列表。
    for (let guard = 0; guard < buttons.length && primary.scrollWidth > primary.clientWidth + 1; guard++) {
      let candidate = -1;
      for (let i = buttons.length - 1; i >= 0; i--) {
        if (!overflowSet.has(String(i)) && !metrics[i].pinned) {
          candidate = i;
          break;
        }
      }
      if (candidate === -1) {
        for (let i = buttons.length - 1; i >= 0; i--) {
          if (!overflowSet.has(String(i))) {
            candidate = i;
            break;
          }
        }
      }
      if (candidate === -1) break;
      overflowSet.add(String(candidate));
      applyHiddenSet();
      syncDividers(tools, toggle);
    }

    this.overflowButtons = buttons.filter((_, index) => overflowSet.has(String(index)));
    if (this.overflowButtons.length === 0) {
      toggle.remove();
      primary.classList.remove("has-bottom-overflow");
      this.toggle = null;
      this.closeMenu();
      return;
    }

    this.toggle = toggle;
    if (wasOpen) this.openMenu();
  }

  private findActiveToolsContainer(primary: HTMLElement): HTMLElement | null {
    const sceneTools = primary.querySelector<HTMLElement>(".ms-bottom-scene-tools");
    if (sceneTools && getComputedStyle(sceneTools).display !== "none") return sceneTools;
    const mode = this.dock.dataset.mode ?? "reading";
    const selector =
      mode === "writing"
        ? ".ms-bottom-writing"
        : mode === "recall"
          ? ".ms-bottom-recall"
          : ".ms-bottom-reading";
    const group = primary.querySelector<HTMLElement>(selector);
    if (group && getComputedStyle(group).display !== "none") return group;
    return null;
  }

  private openMenu(): void {
    if (!this.toggle || this.overflowButtons.length === 0) return;
    this.menu?.remove();
    const menu = el("div", {
      class: "ms-bottom-overflow-menu",
      role: "menu",
      "aria-label": "更多工具",
    });

    for (const source of this.overflowButtons) {
      const label =
        source.getAttribute("aria-label") || source.title || source.textContent?.trim() || "工具";
      const item = el("button", {
        type: "button",
        class: "ms-bottom-overflow-item",
        role: "menuitem",
        title: source.title || label,
      }) as HTMLButtonElement;
      if (source.hasAttribute("aria-pressed")) {
        item.setAttribute("aria-pressed", source.getAttribute("aria-pressed") ?? "false");
      }
      if (source.hasAttribute("aria-current")) {
        item.setAttribute("aria-current", source.getAttribute("aria-current") ?? "false");
      }
      if (source.dataset.msTool) item.dataset.msTool = source.dataset.msTool;
      if (source.dataset.bottomAction) item.dataset.bottomAction = source.dataset.bottomAction;
      item.disabled = source.disabled;

      const iconWrap = el("span", { class: "ms-bottom-overflow-item-icon", "aria-hidden": "true" });
      const svg = source.querySelector("svg");
      if (svg) iconWrap.append(svg.cloneNode(true));
      item.append(iconWrap, el("span", { class: "ms-bottom-overflow-item-label", text: label }));

      item.addEventListener("click", event => {
        event.stopPropagation();
        if (source.disabled) return;
        this.closeMenu();
        source.click();
      });
      menu.append(item);
    }

    this.root.append(menu);
    this.menu = menu;
    this.open = true;
    this.toggle.setAttribute("aria-expanded", "true");
    this.positionMenu(menu, this.toggle);
  }

  private positionMenu(menu: HTMLElement, toggle: HTMLButtonElement): void {
    const rootRect = this.root.getBoundingClientRect();
    const toggleRect = toggle.getBoundingClientRect();
    const pad = 8;

    const availAbove = Math.max(80, Math.floor(toggleRect.top - rootRect.top - pad * 2));
    menu.style.maxHeight = `${availAbove}px`;

    const menuRect = menu.getBoundingClientRect();
    const menuWidth = Math.min(menuRect.width, Math.max(120, rootRect.width - pad * 2));
    const menuHeight = Math.min(menuRect.height, availAbove);

    let left = toggleRect.right - rootRect.left - menuWidth;
    left = Math.max(pad, Math.min(left, rootRect.width - menuWidth - pad));

    let top = toggleRect.top - rootRect.top - menuHeight - pad;
    if (top < pad) top = pad;
    if (top + menuHeight > rootRect.height - pad) {
      top = Math.max(pad, rootRect.height - menuHeight - pad);
    }

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }
}
