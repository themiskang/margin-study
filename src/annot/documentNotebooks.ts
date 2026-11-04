import type { Annotation, DocMeta } from "../types";
import type MarginStudyPlugin from "../main";
import { el, clear } from "../utils/dom";
import { createModal } from "../utils/modal";
import { setIcon } from "obsidian";

export interface DocumentNotebookState { notebooks: { id: string; name: string }[]; active: string; overlay?: string; }
export function documentNotebookState(meta: DocMeta): DocumentNotebookState {
  const notebooks = [{ id: "default", name: "主笔记本" }];
  for (const item of meta.documentNotebooks ?? []) {
    if (!item || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim()) continue;
    const existing = notebooks.find((candidate) => candidate.id === item.id); if (existing) existing.name = item.name; else notebooks.push({ id: item.id, name: item.name });
  }
  const active = notebooks.some((item) => item.id === meta.activeDocumentNotebookId) ? meta.activeDocumentNotebookId! : "default";
  const overlay = meta.overlayDocumentNotebookId !== active && notebooks.some((item) => item.id === meta.overlayDocumentNotebookId) ? meta.overlayDocumentNotebookId : undefined;
  return { notebooks, active, overlay };
}
export function annotationNotebook(annotation: Annotation): string { return annotation.documentNotebookId || "default"; }
export function notebookMeta(meta: DocMeta, notebookId = documentNotebookState(meta).active): DocMeta {
  return notebookId === "default" ? meta : meta.documentNotebookMeta?.[notebookId] ?? {};
}
export function updateNotebookMeta(plugin: MarginStudyPlugin, path: string, patch: Partial<DocMeta>, notebookId?: string): void {
  const meta = plugin.store.getDocMeta(path), id = notebookId ?? documentNotebookState(meta).active;
  if (id === "default") plugin.store.updateDocMeta(path, patch);
  else plugin.store.updateDocMeta(path, { documentNotebookMeta: { ...meta.documentNotebookMeta, [id]: { ...notebookMeta(meta, id), ...patch } } });
}
interface NotebookActions {
  state: () => DocumentNotebookState;
  select: (id: string) => void;
  create: (name: string) => boolean;
  overlay: (id?: string) => void;
  rename: (id: string, name: string) => boolean;
  remove: (id: string) => void;
}
export class DocumentNotebookControls {
  readonly element: HTMLButtonElement;
  private body: HTMLElement | null = null;
  private closePanel: (() => void) | null = null;
  private closeEditor: (() => void) | null = null;
  private editing = false;
  constructor(private actions: NotebookActions) {
    this.element = el("button", { class: "ms-tb-btn", title: "文档笔记本", "aria-label": "文档笔记本" }); setIcon(this.element, "layers");
    this.element.addEventListener("click", () => this.show());
  }
  refresh(): void { this.element.title = "文档笔记本 · " + this.actions.state().notebooks.find((item) => item.id === this.actions.state().active)?.name; if (this.body) this.render(); }
  close(): void { this.closeEditor?.(); this.closePanel?.(); }
  show(): void {
    this.close(); this.editing = false;
    const { modal, close } = createModal("文档笔记本", () => { this.closeEditor?.(); this.body = null; this.closePanel = null; }); this.closePanel = close;
    modal.classList.add("ms-document-notebook-modal"); this.body = el("div"); modal.append(this.body); this.render();
  }
  private render(): void {
    if (!this.body) return; clear(this.body); const state = this.actions.state();
    const edit = el("button", { class: "ms-ink-layer-edit", text: this.editing ? "完成" : "编辑", "aria-label": "编辑文档笔记本" });
    edit.addEventListener("click", () => { this.editing = !this.editing; this.render(); }); this.body.append(edit);
    const add = el("button", { class: "ms-ink-layer-new", text: "+ 新建文档笔记本" }); add.addEventListener("click", () => this.nameEditor()); this.body.append(add);
    const list = el("div", { class: "ms-ink-layer-list" }); this.body.append(list);
    for (const item of state.notebooks) {
      const row = el("div", { class: "ms-document-notebook-row", "data-notebook-id": item.id });
      const eye = el("button", { class: "ms-tb-btn", "aria-label": `叠加笔记本 ${item.name}`, "aria-pressed": String(state.active === item.id || state.overlay === item.id) });
      eye.disabled = state.active === item.id; setIcon(eye, state.active === item.id || state.overlay === item.id ? "eye" : "eye-off"); eye.addEventListener("click", () => this.actions.overlay(state.overlay === item.id ? undefined : item.id));
      const select = el("button", { class: "ms-ink-layer-name" + (state.active === item.id ? " is-active" : ""), text: item.name, "aria-label": `切换笔记本 ${item.name}`, "aria-pressed": String(state.active === item.id) });
      select.addEventListener("click", () => this.actions.select(item.id)); row.append(eye, select);
      if (this.editing) {
        const rename = el("button", { class: "ms-tb-btn", title: "重命名", "aria-label": `重命名笔记本 ${item.name}` }); setIcon(rename, "pencil"); rename.addEventListener("click", () => this.nameEditor(item));
        const remove = el("button", { class: "ms-tb-btn ms-ink-layer-delete", title: "删除", "aria-label": `删除笔记本 ${item.name}` }); setIcon(remove, "minus-circle"); remove.addEventListener("click", () => this.confirmDelete(item)); row.append(rename, remove);
      }
      list.append(row);
    }
    const close = el("button", { class: "ms-ink-layer-dismiss", text: "关闭" }); close.addEventListener("click", () => this.close()); this.body.append(close);
  }
  private nameEditor(item?: { id: string; name: string }): void {
    this.closeEditor?.(); const { modal, close } = createModal(item ? "重命名文档笔记本" : "新建文档笔记本", () => { this.closeEditor = null; }); this.closeEditor = close;
    modal.classList.add("ms-document-notebook-name-modal"); const name = el("input", { type: "text", value: item?.name ?? "", placeholder: "笔记本名称", maxlength: "80", "aria-label": "文档笔记本名称" });
    const status = el("div", { role: "status", class: "ms-notebook-status" }), actions = el("div", { class: "ms-modal-actions" }), cancel = el("button", { class: "ms-btn", text: "取消" }), save = el("button", { class: "ms-btn primary", text: "确定" });
    const submit = () => { if (!name.value.trim()) return; if (item ? this.actions.rename(item.id, name.value) : this.actions.create(name.value)) close(); else status.textContent = item ? "请使用不重复的笔记本名称" : "当前笔记本为空，请先添加笔记"; };
    cancel.addEventListener("click", close); save.addEventListener("click", submit); name.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); }); actions.append(cancel, save); modal.append(name, status, actions); name.focus(); name.select();
  }
  private confirmDelete(item: { id: string; name: string }): void {
    this.closeEditor?.(); const current = item.id === this.actions.state().active;
    const { modal, close } = createModal(current ? "清空当前笔记本" : "删除文档笔记本", () => { this.closeEditor = null; }); this.closeEditor = close;
    modal.classList.add("ms-document-notebook-delete-modal"); modal.append(el("p", { text: current ? `清空「${item.name}」中的所有笔记？笔记本仍会保留。` : `删除「${item.name}」及其中的所有笔记？` }));
    const actions = el("div", { class: "ms-modal-actions" }), cancel = el("button", { class: "ms-btn", text: "取消" }), remove = el("button", { class: "ms-btn primary", text: current ? "清空" : "删除" });
    cancel.addEventListener("click", close); remove.addEventListener("click", () => { this.actions.remove(item.id); close(); }); actions.append(cancel, remove); modal.append(actions);
  }
}
