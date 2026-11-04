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
