type Attrs = Record<string, string | number | boolean>;

/** 轻量 DOM 构造器 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  children?: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === "class") e.className = String(v);
      else if (k === "text") e.textContent = String(v);
      else if (k === "html") e.innerHTML = String(v);
      else e.setAttribute(k, String(v));
    }
  }
  if (children) {
    for (const c of children) e.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function qs<T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T | null {
  return root.querySelector<T>(sel);
}

const HISTORY_BLOCKING_OVERLAY_SELECTOR = [
  ".ms-modal-bg",
  ".modal-container",
  ".ms-pdf-camera-bg",
  ".ms-ink-layer-modal",
  ".ms-native-popover",
  ".ms-bottom-overflow-menu",
  ".ms-text-style-popover",
  ".ms-overlay-text-editor",
  ".ms-reader-extend-popover",
  ".ms-recall-hint",
  ".ms-pdf-add-page-menu",
  ".menu",
].join(",");

/** 判断是否存在打开的模态框、菜单或浮层，防止 Cmd/Ctrl+Z 误撤背后文档 */
export function hasBlockingHistoryOverlay(doc: Document = document): boolean {
  for (const node of doc.querySelectorAll<HTMLElement>(HISTORY_BLOCKING_OVERLAY_SELECTOR)) {
    if (node.hidden || node.style.display === "none") continue;
    return true;
  }
  return false;
}
