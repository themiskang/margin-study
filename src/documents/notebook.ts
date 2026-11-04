import { Notice, TFile } from "obsidian";
import type MarginStudyPlugin from "../main";
import { createModal } from "../utils/modal";
import { el, clear } from "../utils/dom";
import { uid } from "../utils/id";
import { createNotebookBytes, NOTEBOOK_STYLES, readNotebookMetadata } from "./notebookFormat";
import type { NotebookMetadata, NotebookStyle } from "./notebookFormat";

export interface NewNotebookOptions { title: string; style: NotebookStyle; pageCount: number; folder?: string; studySetId?: string; studySetName?: string; }
const edits = new Set<string>();
function folderPath(value: string): string {
  const path = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (path.startsWith("/") || path.split("/").some((part) => part === "." || part === "..") || /[:\u0000-\u001f]/.test(path)) throw new Error("请选择笔记库内的普通文件夹路径");
  return path.split("/").filter(Boolean).join("/");
}
export async function createNotebook(plugin: MarginStudyPlugin, options: NewNotebookOptions): Promise<TFile> {
  const title = options.title.trim();
  if (!title || title.length > 120 || !Number.isInteger(options.pageCount) || options.pageCount < 1 || options.pageCount > 500) throw new Error("请填写名称，并将初始页数设为 1–500");
  const store = plugin.store, vault = plugin.app.vault;
  if (options.studySetId && !store.studySets.some((set) => set.id === options.studySetId)) throw new Error("目标学习集已不存在");
  const folder = folderPath(options.folder ?? "MarginStudy 笔记本");
  let current = "";
  for (const part of folder.split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!await vault.adapter.exists(current)) await vault.createFolder(current);
  }
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/, "") || "笔记本";
  let path = `${folder ? folder + "/" : ""}${name}.pdf`, suffix = 2;
  while (await vault.adapter.exists(path)) path = `${folder ? folder + "/" : ""}${name} ${suffix++}.pdf`;
  const metadata: NotebookMetadata = { format: "marginstudy-notebook", version: 1, id: uid("notebook"), title, style: options.style,
    pageCount: options.pageCount, width: 595, height: 842, createdAt: new Date().toISOString() };
  const file = await vault.createBinary(path, createNotebookBytes(metadata));
  const set = options.studySetId ? store.studySets.find((candidate) => candidate.id === options.studySetId)!
    : store.createStudySet(options.studySetName?.trim() || "我的学习集");
  store.updateStudySet(set.id, { docPaths: [...new Set([...set.docPaths, file.path])] });
  store.setActiveStudySet(set.id); store.registerDocument(file.path); store.save(); await store.flush();
  plugin.refreshSidebar(); plugin.refreshMindmap(); return file;
}

export async function updateNotebook(plugin: MarginStudyPlugin, file: TFile, patch: { style?: NotebookStyle; pageCount?: number }): Promise<NotebookMetadata> {
  if (edits.has(file.path)) throw new Error("此笔记本正在更新，请稍后再试");
  edits.add(file.path);
  try {
    await plugin.store.flush();
    const original = await plugin.app.vault.readBinary(file), metadata = readNotebookMetadata(original);
    if (!metadata) throw new Error("此文件不是可编辑模板的 MarginStudy 笔记本");
    const expected = new Uint8Array(createNotebookBytes(metadata)), actual = new Uint8Array(original);
    if (expected.length !== actual.length || expected.some((byte, index) => byte !== actual[index])) throw new Error("PDF 已被外部程序修改，不能直接重建纸张模板；已有内容保持完整");
    if (patch.pageCount !== undefined && patch.pageCount < metadata.pageCount) throw new Error("此入口只支持追加页面");
    const next = { ...metadata, ...patch };
    await plugin.app.vault.modifyBinary(file, createNotebookBytes(next)); return next;
  } finally { edits.delete(file.path); }
}

/** Public entry for main/workspace commands; creation is reviewable in this compact form. */
export function openNewNotebook(plugin: MarginStudyPlugin): void {
  const { modal, close } = createModal("新建空白笔记本"); modal.classList.add("ms-notebook-modal");
  const field = (label: string, input: HTMLElement) => { const row = el("label", { class: "ms-notebook-field" }); row.append(el("span", { text: label }), input); modal.append(row); };
  const title = el("input", { type: "text", value: "学习笔记", "aria-label": "笔记本名称", maxlength: "120" });
  const folder = el("input", { type: "text", value: "MarginStudy 笔记本", "aria-label": "保存文件夹" });
  const style = el("select", { "aria-label": "纸张样式" }); NOTEBOOK_STYLES.forEach((option) => style.append(el("option", { value: option.id, text: option.name })));
  const pages = el("input", { type: "number", min: "1", max: "500", value: "10", "aria-label": "初始页数" });
  const set = el("select", { "aria-label": "加入学习集" }); plugin.store.studySets.forEach((item) => set.append(el("option", { value: item.id, text: item.name })));
  set.append(el("option", { value: "", text: "新建学习集" })); set.value = plugin.store.activeStudySetId ?? "";
  const setName = el("input", { type: "text", value: "我的学习集", "aria-label": "新学习集名称" }); setName.hidden = !!set.value;
  set.addEventListener("change", () => { setName.hidden = !!set.value; });
  field("名称", title); field("纸张", style); field("页数", pages); field("文件夹", folder); field("学习集", set); modal.append(setName);
  const preview = el("div", { class: "ms-notebook-paper-preview", "data-style": "blank", "aria-hidden": "true" });
  style.addEventListener("change", () => { preview.dataset.style = style.value; }); modal.append(preview);
  const status = el("div", { role: "status", class: "ms-notebook-status" }); modal.append(status);
  const actions = el("div", { class: "ms-modal-actions" }), cancel = el("button", { class: "ms-btn", text: "取消" }), create = el("button", { class: "ms-btn primary", text: "创建并打开" });
  cancel.addEventListener("click", close); create.addEventListener("click", async () => {
    create.disabled = true; status.textContent = "正在创建…";
    try {
      const file = await createNotebook(plugin, { title: title.value, folder: folder.value, style: style.value as NotebookStyle, pageCount: Number(pages.value), studySetId: set.value || undefined, studySetName: setName.value });
      close();
      try { await plugin.openDocument(file); new Notice("笔记本已创建并加入学习集"); }
      catch (error) { new Notice(`已创建 ${file.path}，打开失败：${(error as Error).message}`); }
    } catch (error) { status.textContent = (error as Error).message; create.disabled = false; }
  }); actions.append(cancel, create); modal.append(actions); title.focus(); title.select();
}

export function renderNotebookControls(container: HTMLElement, metadata: NotebookMetadata | null, onUpdate: (patch: { style?: NotebookStyle; pageCount?: number }) => Promise<void>): void {
  clear(container); container.hidden = !metadata; if (!metadata) return;
  const style = el("select", { "aria-label": "笔记本纸张", title: "更改纸张不会移动笔迹" });
  NOTEBOOK_STYLES.forEach((option) => style.append(el("option", { value: option.id, text: option.name }))); style.value = metadata.style;
  const status = el("span", { class: "ms-speech-status", role: "status" });
  const update = async (patch: { style?: NotebookStyle; pageCount?: number }) => {
    style.disabled = true; append.disabled = true;
    try { await onUpdate(patch); } catch (error) { style.value = metadata.style; status.textContent = (error as Error).message; }
    finally { style.disabled = false; append.disabled = metadata.pageCount >= 500; }
  };
  style.addEventListener("change", () => { void update({ style: style.value as NotebookStyle }); });
  const append = el("button", { class: "ms-btn", text: "+ 页面", title: "在笔记本末尾追加一页" }); append.disabled = metadata.pageCount >= 500;
  append.addEventListener("click", () => { void update({ pageCount: metadata.pageCount + 1 }); }); container.append(style, append, status);
}
