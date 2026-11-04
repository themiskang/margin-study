import { el } from "../utils/dom";
import { setIcon } from "obsidian";

export interface ContextAction {
  id: string;
  label: string;
  icon?: string;
  color?: string;
  group: string;
  visible?: boolean;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

/** Menu actions keep their captured context and cannot execute twice after dismissal. */
export function contextActionButton(action: ContextAction, lifecycle: {
  current: () => boolean;
  close: () => void;
  error: (error: unknown) => void;
}): HTMLButtonElement | null {
  if (action.visible === false) return null;
  const button = el("button", { type: "button", title: action.label, "aria-label": action.label,
    "data-action-id": action.id, "data-action-group": action.group });
  if (action.icon && !action.color) {
    const glyph = el("span", { class: "ms-context-glyph", "aria-hidden": "true" });
    setIcon(glyph, action.icon); button.append(glyph); button.classList.add("has-icon");
  }
  button.append(el("span", { class: "ms-context-label", text: action.label }));
  button.disabled = !!action.disabled;
  if (action.color) {
    button.classList.add("ms-context-color");
    button.style.backgroundColor = action.color;
    button.style.color = "transparent";
    button.title = action.label;
  }
  let consumed = false;
  button.addEventListener("mousedown", event => event.preventDefault());
  button.addEventListener("click", event => {
    event.stopPropagation();
    if (consumed || button.disabled || !button.isConnected || !lifecycle.current()) return;
    consumed = true;
    button.disabled = true;
    try {
      const result = action.run();
      lifecycle.close();
      void Promise.resolve(result).catch(error => { if (lifecycle.current()) lifecycle.error(error); });
    } catch (error) {
      consumed = false;
      button.disabled = !!action.disabled;
      if (lifecycle.current()) lifecycle.error(error);
    }
  });
  return button;
}

export function renderContextActionMenu(host: HTMLElement, actions: ContextAction[], options: {
  primaryIds: readonly string[];
  savePrimaryIds: (ids: string[]) => void;
  current: () => boolean;
  close: () => void;
  error: (error: unknown) => void;
  layout: () => void;
}): void {
  let ids = [...new Set(options.primaryIds)], more = false, customizing = false;
  host.classList.add("ms-context-selection");
  host.setAttribute("aria-label", "文字选区菜单");
  const available = actions.filter(action => action.visible !== false);
  const draw = () => {
    host.replaceChildren();
    const primary = el("div", { class: "ms-context-primary", role: "toolbar", "aria-label": "选区操作" });
    const append = (parent: HTMLElement, action: ContextAction) => {
      const button = contextActionButton(action, options); if (button) parent.append(button);
    };
    for (const id of ids.filter(id => id !== "research")) {
      const action = available.find(action => action.id === id); if (action) append(primary, action);
    }
    const toggle = el("button", { type: "button", text: "更多", "aria-label": "更多", "aria-expanded": String(more), "data-action-id": "more" });
    toggle.addEventListener("click", () => { if (!options.current()) return; more = !more; customizing = false; draw(); options.layout(); });
    primary.append(toggle);
    const research = available.find(action => action.id === "research");
    if (research && ids.includes("research")) append(primary, research);
    host.append(primary);
    if (!more) return;
    const secondary = el("div", { class: "ms-context-secondary", "aria-label": customizing ? "自定义选区菜单" : "更多选区操作" });
    if (customizing) {
      for (const action of available.filter(action => action.id !== "copy")) {
        const row = el("label", { class: "ms-context-pin", text: action.label });
        const input = el("input", { type: "checkbox", "aria-label": "常驻：" + action.label });
        input.checked = ids.includes(action.id);
        input.addEventListener("change", () => {
          if (!options.current()) return;
          ids = input.checked ? [...new Set([...ids, action.id])] : ids.filter(id => id !== action.id);
          options.savePrimaryIds(ids);
        });
        row.append(input); secondary.append(row);
      }
    } else for (const action of available.filter(action => !ids.includes(action.id))) append(secondary, action);
    const customize = el("button", { type: "button", text: customizing ? "完成自定义" : "自定义", "aria-label": customizing ? "完成自定义" : "自定义" });
    customize.addEventListener("click", () => { if (!options.current()) return; customizing = !customizing; if (!customizing) more = false; draw(); options.layout(); });
    secondary.append(customize); host.append(secondary);
  };
  draw();
}
