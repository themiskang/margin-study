import type MarginStudyPlugin from "./main";
import { ACCENTS } from "./types";

/** 应用界面主题与配色：在 body 上挂 ms-theme-* / ms-accent-* 类，由 styles.css 接管 */
export function applyTheme(plugin: MarginStudyPlugin): void {
  const s = plugin.store.settings;
  const body = document.body;

  body.classList.remove("ms-theme-light", "ms-theme-dark");
  let dark = s.theme === "dark";
  if (s.theme === "auto") {
    dark = !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  body.classList.add(dark ? "ms-theme-dark" : "ms-theme-light");

  const ids = ACCENTS.map((a) => "ms-accent-" + a.id);
  body.classList.remove(...ids);
  if (!ids.includes("ms-accent-" + s.accent)) {
    s.accent = "indigo";
    plugin.store.save();
  }
  body.classList.add("ms-accent-" + s.accent);
}
