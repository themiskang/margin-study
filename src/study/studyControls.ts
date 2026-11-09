import { Notice, TFile } from "obsidian";
import type MarginStudyPlugin from "../main";
import type { MindCanvas } from "../types";
import { clear, el } from "../utils/dom";
import { createModal, openTextModal } from "../utils/modal";
import { isStudyDocumentPath } from "../documents/formats";

const CANVAS_KINDS = { study: "学习脑图", document: "文档脑图", review: "复习脑图" } as const;

/** Shared study-set and canvas controls; the Store owns membership and selection. */
export function renderStudyControls(container: HTMLElement, plugin: MarginStudyPlugin, onChange: () => void): void {
  clear(container);
  container.classList.add("ms-study-controls");
  const store = plugin.store;
  const active = store.studySets.find((set) => set.id === store.activeStudySetId);
  const row = el("div", { class: "ms-study-row ms-row" });
  const selection = el("select", { class: "ms-select", "aria-label": "学习集", title: "学习集范围适用于卡片、大纲和复习" });
  selection.append(el("option", { value: "", text: "未归档内容" }));
  for (const set of store.studySets) selection.append(el("option", { value: set.id, text: set.name }));
  selection.value = active?.id ?? "";
  selection.addEventListener("change", () => {
    store.setActiveStudySet(selection.value || undefined);
    onChange();
  });
  const create = el("button", { class: "ms-btn", text: "+ 学习集" });
  create.addEventListener("click", () => {
    openTextModal({
      title: "新建学习集",
      placeholder: "例如：民法总论",
      onOk: (value) => {
        if (!value.trim()) return;
        const path = plugin.activeReader?.getFilePath();
        const set = store.createStudySet(value.trim(), path ? [path] : []);
        store.setActiveStudySet(set.id);
        onChange();
      },
    });
  });
  row.append(selection, create);
  container.append(row);

  if (!active) {
    container.append(el("div", { class: "ms-study-summary ms-muted", text: "显示未归档脑图和全库卡片；创建学习集可一起整理多份文档。" }));
    return;
  }

  const members = el("button", { class: "ms-btn", text: `文档 ${active.docPaths.length}`, title: "管理学习集中的文档" });
  members.addEventListener("click", () => editDocuments(plugin, active.id, onChange));
  const rename = el("button", { class: "ms-btn", text: "改名" });
  rename.addEventListener("click", () => {
    openTextModal({
      title: "学习集名称",
      initial: active.name,
      onOk: (value) => {
        if (!value.trim()) return;
        store.updateStudySet(active.id, { name: value.trim() });
        onChange();
      },
    });
  });
  row.append(members, rename);

  const canvasRow = el("div", { class: "ms-study-row ms-row" });
  const canvasSelection = el("select", { class: "ms-select", "aria-label": "脑图", title: "同一学习集可以有多个独立脑图" });
  for (const canvas of store.canvases.filter((candidate) => candidate.studySetId === active.id)) {
    canvasSelection.append(el("option", { value: canvas.id, text: `${canvas.name} · ${CANVAS_KINDS[canvas.kind ?? "study"]}` }));
  }
  canvasSelection.value = store.activeCanvasId ?? "";
  canvasSelection.addEventListener("change", () => {
    store.setActiveCanvas(canvasSelection.value);
    onChange();
  });
  const createCanvas = el("button", { class: "ms-btn", text: "+ 脑图" });
  createCanvas.addEventListener("click", () => {
    openTextModal({
      title: "新建独立脑图",
      placeholder: "例如：章节结构 / 考点关系",
      onOk: (value) => {
        if (!value.trim()) return;
        const canvas = store.createCanvas(active.id, value.trim());
        store.setActiveCanvas(canvas.id);
        onChange();
      },
    });
  });
  canvasRow.append(canvasSelection, createCanvas);
  container.append(canvasRow);
  const canvas = store.canvases.find((candidate) => candidate.id === store.activeCanvasId && candidate.studySetId === active.id);
  if (!canvas) return;
  const details = el("div", { class: "ms-study-row ms-row", style: "flex-wrap:wrap" });
  const kind = el("select", { class: "ms-select", "aria-label": "脑图类型" });
  for (const [value, label] of Object.entries(CANVAS_KINDS)) kind.append(el("option", { value, text: label }));
  kind.value = canvas.kind ?? "study";
  kind.addEventListener("change", () => {
    store.updateCanvas(canvas.id, { kind: kind.value as MindCanvas["kind"] });
    onChange();
  });
  const visited = canvas.lastVisitedAt ? new Date(canvas.lastVisitedAt) : undefined;
  details.append(kind, el("span", { class: "ms-muted", text: visited && Number.isFinite(visited.getTime())
    ? `最近访问 ${visited.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "尚无访问记录" }));
  const options = el("div", { class: "ms-study-row ms-row", style: "flex-wrap:wrap" });
  const toggle = (key: "emphasisCloze" | "singlePeek", label: string, title: string) => {
    const control = el("label", { class: "ms-toggle", title });
    const checkbox = el("input", { type: "checkbox", "aria-label": label });
    checkbox.checked = !!canvas[key];
    checkbox.addEventListener("change", () => {
      store.updateCanvas(canvas.id, { [key]: checkbox.checked });
      onChange();
    });
    control.append(checkbox, document.createTextNode(` ${label}`));
    return control;
  };
  options.append(
    toggle("emphasisCloze", "强调即挖空", "在脑图复习中遮住加粗和高亮文字，点击后揭晓"),
    toggle("singlePeek", "单处揭晓", "同一张脑图中同时只暂时揭晓一处遮挡内容")
  );
  container.append(details, options);
}

export function editDocuments(plugin: MarginStudyPlugin, studySetId: string, onChange: () => void, onImport?: () => void): void {
  const set = plugin.store.studySets.find((candidate) => candidate.id === studySetId);
  if (!set) return;
  const originalPaths = [...set.docPaths];
  const paths = new Set(set.docPaths);
  const files = plugin.app.vault.getFiles().filter((file) => isStudyDocumentPath(file.path) && !file.path.startsWith("MarginStudyBackups/") && !file.path.startsWith("_marginstudy-recovery/"));
  const allPaths = [...new Set([...set.docPaths, ...files.map((file) => file.path)])].sort();
  const { modal, close } = createModal(`学习集文档 · ${set.name}`);
  modal.append(el("p", { class: "ms-muted", text: "勾选或取消勾选多份文档后一起保存；移出不会删除源文件或已整理的卡片。可将勾选的文档复用到其他学习集，不复制文件。" }));
  const search = el("input", { class: "ms-search", type: "search", placeholder: "筛选文档路径…" });
  const list = el("div", { style: "max-height:45vh;overflow:auto" });
  const draw = () => {
    clear(list);
    const query = search.value.trim().toLowerCase();
    const matches=allPaths.filter((value) => !query || value.toLowerCase().includes(query));
    for(const [kind,title] of [["local","本地文档"],["web","网页来源"]] as const){
      const groupPaths=matches.filter(path=>(!!plugin.store.documents.find(doc=>doc.path===path)?.sourceUrl)===(kind==="web"));
      if(!groupPaths.length)continue;
      const group=el("section",{"data-document-source":kind,"aria-label":title});group.append(el("h4",{text:title}));list.append(group);
    for (const path of groupPaths) {
      const row = el("div", { class: "ms-study-row ms-row", style: "padding:5px 0" });
      const label = el("label", { style: "display:flex;gap:8px;align-items:center;flex:1;min-width:0" });
      const checkbox = el("input", { type: "checkbox" });
      checkbox.checked = paths.has(path);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) paths.add(path);
        else paths.delete(path);
      });
      label.append(checkbox, el("span", { text: path, style: "overflow-wrap:anywhere" }));
      row.append(label);
      const open = el("button", { class: "ms-btn", text: "打开" });
      open.addEventListener("click", async () => {
        const file = plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          new Notice("文档已不存在");
          return;
        }
        try {
          await plugin.openDocument(file);
        } catch (error) {
          new Notice("打开文档失败：" + String(error));
        }
      });
      row.append(open);
      if (set.docPaths.includes(path)) {
        const drag = el("button", { type: "button", class: "ms-btn", draggable: "true", text: "拖动复用", "aria-label": `拖动文档：${path}` });
        drag.addEventListener("dragstart", event => {
          if (!event.dataTransfer) return;
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("application/x-marginstudy-document-paths", JSON.stringify({ setId: studySetId, paths: [path] }));
          close();
        });
        row.append(drag);
      }
      group.append(row);
    }
    }
    if (!list.childElementCount) list.append(el("p", { class: "ms-muted", text: "没有匹配的文档。" }));
  };
  search.addEventListener("input", draw);
  const actions = el("div", { class: "ms-modal-actions" });
  const save = el("button", { class: "ms-btn primary", text: "保存文档成员" });
  save.addEventListener("click", () => {
    save.disabled = true;
    void plugin.store.changeStudySetDocuments(studySetId, [...paths], { expectedPaths: originalPaths }).then(() => {
      close(); onChange();
    }).catch(error => { save.disabled = false; new Notice("保存文档成员失败：" + String(error), 10000); });
  });
  const cancel = el("button", { class: "ms-btn", text: "取消" });
  cancel.addEventListener("click", close);
  const destination = el("select", { class: "ms-select", "aria-label": "复用到学习集" }) as HTMLSelectElement;
  destination.append(el("option", { value: "", text: "选择复用目标学习集" }));
  for (const other of plugin.store.studySets.filter(candidate => candidate.id !== studySetId)) destination.append(el("option", { value: other.id, text: other.name }));
  const reuse = el("button", { class: "ms-btn", text: "复用勾选文档" });
  reuse.addEventListener("click", () => {
    if (!destination.value || !paths.size) { new Notice("请选择目标学习集并勾选文档。"); return; }
    reuse.disabled = true;
    void plugin.store.changeStudySetDocuments(destination.value, [...paths], { mode: "append" }).then(() => {
      new Notice("已复用勾选的文档，源文件未复制。"); onChange();
    }).catch(error => new Notice("复用文档失败：" + String(error), 10000)).finally(() => { reuse.disabled = false; });
  });
  const selection = el("div", { class: "ms-study-row ms-row", style: "flex-wrap:wrap" });
  const selectAll = el("button", { class: "ms-btn", text: "勾选筛选结果" });
  selectAll.addEventListener("click", () => { const query = search.value.trim().toLowerCase(); for (const path of allPaths) if (!query || path.toLowerCase().includes(query)) paths.add(path); draw(); });
  const deselectAll = el("button", { class: "ms-btn", text: "取消筛选结果" });
  deselectAll.addEventListener("click", () => { const query = search.value.trim().toLowerCase(); for (const path of allPaths) if (!query || path.toLowerCase().includes(query)) paths.delete(path); draw(); });
  selection.append(selectAll, deselectAll, destination, reuse);
  if (onImport) {
    const load = el("button", { class: "ms-btn", text: "从电脑导入多份文档" });
    load.addEventListener("click", () => { close(); onImport(); });
    selection.append(load);
  }
  actions.append(cancel, save);
  modal.append(search, selection, list, actions);
  draw();
}
