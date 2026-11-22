/**
 * [INPUT]: 依赖 Electron 目录选择器与 Obsidian 本地设置。
 * [OUTPUT]: 提供外部来源目录登记界面。
 * [POS]: 保存外部来源目录列表，独立于学习文档的导入事务。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Notice } from "obsidian";
import type MarginStudyPlugin from "../main";
import { createModal } from "../utils/modal";
import { el } from "../utils/dom";
import { getDesktopOpenDialog } from "./desktopDocumentPicker";

const key = "marginstudy-external-sources";

export function openExternalSources(plugin: MarginStudyPlugin): void {
  const { modal, close } = createModal("添加外部源");
  const list = el("div", { "aria-label": "外部来源列表" });
  const read = (): string[] => {
    const value = plugin.app.loadLocalStorage(key);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  };
  const draw = () => {
    list.replaceChildren();
    for (const path of read()) {
      const row = el("div"), remove = el("button", { type: "button", text: "移除", "aria-label": "移除外部源：" + path });
      row.append(el("span", { text: path }), remove); list.append(row);
      remove.addEventListener("click", () => { plugin.app.saveLocalStorage(key, read().filter(item => item !== path)); draw(); });
    }
  };
  const add = el("button", { type: "button", text: "选择文件夹" });
  add.addEventListener("click", () => {
    void (async () => {
      const dialog = getDesktopOpenDialog();
      if (!dialog) throw new Error("当前设备不支持选择本地文件夹");
      const result = await dialog.showOpenDialog({ title: "添加外部源", properties: ["openDirectory"] });
      const path = result.canceled ? undefined : result.filePaths?.[0];
      if (typeof path === "string" && path) { plugin.app.saveLocalStorage(key, [...new Set([...read(), path])]); draw(); }
    })().catch(error => new Notice("添加外部源失败：" + String(error), 10000));
  });
  const done = el("button", { type: "button", text: "完成" }); done.addEventListener("click", close);
  modal.append(list, add, done); draw();
}
