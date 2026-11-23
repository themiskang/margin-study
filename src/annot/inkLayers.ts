import type { Annotation, DocMeta, HandwritingPresetId, HandwritingPresetSpec } from "../types";
import { handwritingPresetWidth } from "./handwritingPresets";
import { el, clear } from "../utils/dom";
import { createModal } from "../utils/modal";
import { setIcon } from "obsidian";

export interface InkLayerState { layers: { id: string; name: string }[]; active: string; overlay?: string; }
export function inkLayerState(meta: DocMeta): InkLayerState {
  const layers: { id: string; name: string }[] = [];
  for (const item of meta.handwritingLayers ?? []) {
    if (!item || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim()) continue;
    const existing = layers.find((layer) => layer.id === item.id);
    if (existing) existing.name = item.name; else layers.push({ id: item.id, name: item.name });
  }
  if (!layers.some((layer) => layer.id === "default")) layers.unshift({ id: "default", name: "默认图层" });
  const active = layers.some((layer) => layer.id === meta.activeHandwritingLayerId) ? meta.activeHandwritingLayerId! : "default";
  const overlay = meta.overlayHandwritingLayerId !== active && layers.some((layer) => layer.id === meta.overlayHandwritingLayerId) ? meta.overlayHandwritingLayerId : undefined;
  return { layers, active, overlay };
}
export function annotationInkLayer(annotation: Annotation, state: InkLayerState): string {
  return state.layers.some((layer) => layer.id === annotation.inkLayerId) ? annotation.inkLayerId! : "default";
}
export function isInkLayerBound(annotation: Annotation): boolean {
  return (annotation.type === "pen" || !!annotation.overlay) && annotation.bindToInkLayer !== false;
}
export interface InkLayerActions {
  state: () => InkLayerState;
  select: (id: string) => void;
  overlay: (id?: string) => void;
  create: (name: string) => void;
  rename: (id: string, name: string) => void;
  merge: (source: string, target: string) => void;
  remove: (id: string) => void;
  reorder?: (order: string[]) => void;
  move?: (id: string, offset: number) => void;
  presets: () => HandwritingPresetSpec[];
  activePreset: () => HandwritingPresetId;
  selectPreset: (id: HandwritingPresetId) => void;
  activatePreset: (id: HandwritingPresetId) => void;
  updatePreset: (id: HandwritingPresetId, patch: Partial<HandwritingPresetSpec>) => void;
  movePreset: (id: HandwritingPresetId, offset: number) => void;
  copyPreset: (id: HandwritingPresetId) => void;
  deletePreset: (id: HandwritingPresetId) => void;
  syncPreference: () => boolean;
  syncAvailable: () => boolean;
  setSyncPreference: (enabled: boolean) => void;
  vanishPen: () => boolean;
  setVanishPen: (enabled: boolean) => void;
}

export class InkLayerControls {
  readonly element: HTMLElement;
  private select: HTMLSelectElement;
  private modalBody: HTMLElement | null = null;
  private closePanel: (() => void) | null = null;
  private closeEditor: (() => void) | null = null;
  private editing = false;
  private actionLayer: string | null = null;
  private positionPanel: (() => void) | null = null;
  private presetsOnly = false;
  private cancelPresetDrag: (() => void) | null = null;
  private panelAnchor: HTMLElement | undefined;
  constructor(private actions: InkLayerActions) {
    this.element = el("div", { class: "ms-ink-layer-controls" });
    this.select = el("select", { "aria-label": "当前手写图层", title: "只有当前图层可编辑" });
    this.select.addEventListener("change", () => actions.select(this.select.value));
    const manage = el("button", { class: "ms-btn", text: "图层", title: "手写设置", "aria-label": "手写设置" });
    manage.addEventListener("click", () => this.show(manage)); this.element.append(this.select, manage); this.refresh();
  }
  refresh(): void {
    const state = this.actions.state(); clear(this.select);
    state.layers.forEach((layer) => this.select.append(el("option", { value: layer.id, text: layer.name }))); this.select.value = state.active;
    if (this.modalBody) this.renderPanel();
  }
  close(): void { this.closeEditor?.(); this.closePanel?.(); }
  showPresets(anchor?: HTMLElement): void { this.show(anchor, true); }
  show(anchor?: HTMLElement, presetsOnly = false): void {
    this.close();
    this.panelAnchor = anchor;
    const anchorLabel=anchor?.getAttribute("aria-label"),workspace=anchor?.closest(".ms-study-workspace");
    const currentAnchor=()=>anchor?.isConnected?anchor:anchorLabel&&workspace?.isConnected?[...workspace.querySelectorAll<HTMLElement>("button")].find(item=>item.getAttribute("aria-label")===anchorLabel):undefined;
    this.presetsOnly = presetsOnly;
    this.editing = false; this.actionLayer = null;
    const bg = el("div", { class: "ms-modal-bg ms-ink-layer-backdrop" });
    const modal = el("div", { class: "ms-modal ms-ink-layer-modal" + (presetsOnly ? " ms-ink-presets-modal" : ""), role: presetsOnly ? "menu" : "dialog", "aria-label": presetsOnly ? "手写预设列表" : "文档手写设置", "aria-modal": "false" });
    modal.append(el("h3", { text: "文档手写设置" }));
    this.modalBody = el("div", { class: "ms-ink-layer-body" }); modal.append(this.modalBody); bg.append(modal); document.body.append(bg);
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      this.cancelPresetDrag?.();
      this.closeEditor?.(); this.modalBody = null; this.closePanel = null; this.positionPanel = null;
      document.removeEventListener("keydown", key); window.removeEventListener("resize", place); bg.remove();
      currentAnchor()?.focus();
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !this.closeEditor) { event.preventDefault(); close(); } };
    const place = () => {
      const bounds = currentAnchor()?.getBoundingClientRect() ?? null;
      const valid = bounds && bounds.width > 0 && bounds.height > 0;
      const width = modal.offsetWidth, height = modal.offsetHeight;
      const center = valid ? bounds.left + bounds.width / 2 : window.innerWidth / 2;
      const left = Math.min(Math.max(8, center - width / 2), Math.max(8, window.innerWidth - width - 8));
      const above = !!valid && bounds.bottom + height + 12 > window.innerHeight - 8 && bounds.top > height + 12;
      const top = valid ? above ? bounds.top - height - 12 : Math.min(bounds.bottom + 12, Math.max(8, window.innerHeight - height - 8)) : Math.min(70, Math.max(8, window.innerHeight - height - 8));
      modal.style.left = `${left}px`; modal.style.top = `${top}px`;
      modal.style.setProperty("--ms-ink-popover-arrow", `${Math.min(width - 18, Math.max(18, center - left))}px`);
      modal.classList.toggle("is-above", above);
    };
    this.closePanel = close; this.positionPanel = place;
    bg.addEventListener("mousedown", (event) => { if (event.target === bg) close(); });
    document.addEventListener("keydown", key); window.addEventListener("resize", place);
    this.renderPanel();
  }
  private renderPanel(): void {
    const body = this.modalBody; if (!body) return; clear(body);
    if (this.presetsOnly) { this.renderPresetMenu(body); this.positionPanel?.(); return; }
    const state = this.actions.state();
    const header = el("div", { class: "ms-ink-layer-header" });
    const edit = el("button", { class: "ms-ink-layer-edit", text: this.editing ? "完成" : "编辑", "aria-label": "编辑手写图层" });
    edit.addEventListener("click", () => { this.editing = !this.editing; this.actionLayer = null; this.renderPanel(); }); header.append(el("span", { text: "手写图层" }), edit); body.append(header);
    this.renderPresets(body);
    const list = el("div", { class: "ms-ink-layer-list", "aria-label": "手写图层" }); body.append(list);
    for (const layer of state.layers) {
      const row = el("div", { class: "ms-ink-layer-row", "data-layer-id": layer.id });
      const active = el("button", { class: "ms-ink-layer-name" + (layer.id === state.active ? " is-active" : ""), "aria-label": `切换到 ${layer.name}`, "aria-pressed": String(layer.id === state.active) });
      const check = el("span", { class: "ms-ink-layer-check", "aria-hidden": "true" }); if (layer.id === state.active) setIcon(check, "check");
      active.append(document.createTextNode(layer.name), check);
      active.addEventListener("click", () => this.actions.select(layer.id));
      row.append(active);
      if (this.editing) {
        const more = el("button", { class: "ms-ink-layer-more", title: "图层选项", "aria-label": `编辑图层 ${layer.name}`, "aria-expanded": String(this.actionLayer === layer.id) }); setIcon(more, "ellipsis");
        more.addEventListener("click", () => { this.actionLayer = this.actionLayer === layer.id ? null : layer.id; this.renderPanel(); }); row.append(more);
        if (this.actionLayer === layer.id) {
          const options = el("div", { class: "ms-ink-layer-options" });
          const rename = el("button", { text: "重命名或合并" }); rename.addEventListener("click", () => this.openNameEditor(layer)); options.append(rename);
          if (this.actions.move) {
            const index = state.layers.findIndex((item) => item.id === layer.id);
            const up = el("button", { text: "上移", "aria-label": `上移图层 ${layer.name}` }) as HTMLButtonElement;
            up.disabled = index <= 0;
            up.addEventListener("click", () => { this.actions.move?.(layer.id, -1); this.renderPanel(); });
            const down = el("button", { text: "下移", "aria-label": `下移图层 ${layer.name}` }) as HTMLButtonElement;
            down.disabled = index >= state.layers.length - 1;
            down.addEventListener("click", () => { this.actions.move?.(layer.id, 1); this.renderPanel(); });
            options.append(up, down);
          }
          if (layer.id !== "default") { const remove = el("button", { class: "ms-ink-layer-delete", text: "删除手写图层" }); remove.addEventListener("click", () => this.confirmDelete(layer)); options.append(remove); }
          row.append(options);
        }
      }
      list.append(row);
    }
    const create = el("button", { class: "ms-ink-layer-new", "aria-label": "新建手写图层" });
    const plus = el("span", { class: "ms-ink-layer-plus", "aria-hidden": "true" }); setIcon(plus, "plus"); create.append(plus, document.createTextNode("新建手写图层"));
    create.addEventListener("click", () => this.openNameEditor()); body.append(create);
    if (state.layers.length > 1) {
      const overlayRow = el("label", { class: "ms-ink-layer-reference" }), overlay = el("select", { "aria-label": "叠加层" });
      overlay.append(el("option", { value: "", text: "无" })); state.layers.filter((layer) => layer.id !== state.active).forEach((layer) => overlay.append(el("option", { value: layer.id, text: layer.name })));
      overlay.value = state.overlay ?? ""; overlay.addEventListener("change", () => this.actions.overlay(overlay.value || undefined)); overlayRow.append(el("span", { text: "叠加层" }), overlay); body.append(overlayRow);
    }
    const vanish = el("div", { class: "ms-ink-layer-sync ms-ink-layer-vanish" });
    const vanishToggle = el("button", { class: "ms-ink-layer-vanish-toggle", "aria-label": "消失笔", role: "switch", "aria-checked": String(this.actions.vanishPen()), text: this.actions.vanishPen() ? "开启" : "关闭" });
    vanishToggle.addEventListener("click", () => { const enabled = !this.actions.vanishPen(); this.actions.setVanishPen(enabled); vanishToggle.setAttribute("aria-checked", String(enabled)); vanishToggle.textContent = enabled ? "开启" : "关闭"; });
    const vanishText = el("span", { text: "消失笔" }); vanishText.append(el("small", { text: "仅影响当前文档；笔迹约 4 秒后消失，不保存" }));
    vanish.append(vanishText, vanishToggle); body.append(vanish);
    const sync = el("label", { class: "ms-ink-layer-sync" });
    const available = this.actions.syncAvailable();
    const checkbox = el("input", { type: "checkbox", "aria-label": "同步文档与脑图手写开关" }); checkbox.checked = this.actions.syncPreference(); checkbox.disabled = !available;
    checkbox.addEventListener("change", () => { if (this.actions.syncAvailable()) this.actions.setSyncPreference(checkbox.checked); });
    const syncText = el("span", { text: "同步脑图与文档的手写开关状态" });
    if (!available) syncText.append(el("small", { text: "当前未连接脑图手写，同步不生效" })); sync.append(syncText, checkbox); body.append(sync);
    this.positionPanel?.();
  }
  private renderPresetMenu(body: HTMLElement): void {
    this.cancelPresetDrag?.();
    const presets=this.actions.presets(),ids=presets.map(item=>item.id),list=el("div",{class:"ms-ink-preset-menu-list"});
    for(const preset of presets){
      const row=el("div",{class:"ms-ink-preset-menu-row","data-preset-id":preset.id}),choice=el("button",{type:"button",class:"ms-ink-preset-choice","aria-label":"选择手写预设 "+preset.label,role:"menuitemradio","aria-checked":String(preset.id===this.actions.activePreset())});
      const icon=el("span",{class:"ms-ink-preset-menu-icon","aria-hidden":"true"});setIcon(icon,preset.type==="highlighter"?"highlighter":preset.type==="pencil"?"pencil":"pen-tool");if(preset.type==="highlighter")icon.style.color="#b38b00";
      const check=el("span",{class:"ms-ink-preset-menu-check","aria-hidden":"true"});if(preset.id===this.actions.activePreset())setIcon(check,"check");
      choice.append(icon,document.createTextNode(preset.label),check);choice.addEventListener("click",()=>{this.actions.activatePreset(preset.id);this.closePanel?.();});
      const handle=el("button",{type:"button",class:"ms-ink-preset-grip","aria-label":"拖动手写预设 "+preset.label,title:"拖动排序；方向键上移或下移"});setIcon(handle,"menu");
      handle.addEventListener("keydown",event=>{if(event.key!=="ArrowUp"&&event.key!=="ArrowDown")return;event.preventDefault();this.actions.movePreset(preset.id,event.key==="ArrowUp"?-1:1);this.renderPanel();});
      handle.addEventListener("pointerdown",event=>{
        if(event.button!==0||event.isPrimary===false)return;event.preventDefault();event.stopPropagation();this.cancelPresetDrag?.();
        const original=ids.indexOf(preset.id),pointer=event.pointerId;let target=original;row.classList.add("is-dragging");
        const move=(next:PointerEvent)=>{if(next.pointerId!==pointer)return;next.preventDefault();const rows=[...list.children] as HTMLElement[];let distance=Infinity;rows.forEach((item,index)=>{const r=item.getBoundingClientRect(),d=Math.abs(next.clientY-r.top-r.height/2);if(d<distance){distance=d;target=index;}item.classList.remove("is-drop-target");});rows[target]?.classList.add("is-drop-target");};
        const cancel=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);window.removeEventListener("pointercancel",cancel);window.removeEventListener("blur",cancel);list.querySelectorAll(".is-dragging,.is-drop-target").forEach(item=>item.classList.remove("is-dragging","is-drop-target"));this.cancelPresetDrag=null;};
        const up=(next:PointerEvent)=>{if(next.pointerId!==pointer)return;move(next);cancel();if(this.modalBody===body&&JSON.stringify(ids)===JSON.stringify(this.actions.presets().map(item=>item.id))&&target!==original){this.actions.movePreset(preset.id,target-original);this.renderPanel();}};
        this.cancelPresetDrag=cancel;window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);window.addEventListener("pointercancel",cancel);window.addEventListener("blur",cancel);
      });
      row.append(choice,handle);list.append(row);
    }
    const settings=el("button",{type:"button",class:"ms-ink-preset-menu-settings",text:"手写设置…"});settings.addEventListener("click",()=>this.show(this.panelAnchor));
    body.append(list,settings);
  }
  private renderPresets(body: HTMLElement): void {
    const presets = this.actions.presets(), activeId = this.actions.activePreset();
    const active = presets.find(preset => preset.id === activeId) ?? presets[0];
    if (!active) return;
    const section = el("section", { class: "ms-ink-preset-settings", "aria-label": "手写预设设置" });
    const header = el("div", { class: "ms-ink-preset-header" });
    const select = el("select", { "aria-label": "手写预设" });
    for (const preset of presets) select.append(el("option", { value: preset.id, text: preset.label }));
    select.value = active.id;
    select.addEventListener("change", () => { this.actions.selectPreset(select.value); this.renderPanel(); });
    header.append(el("strong", { text: "手写预设" }), select); section.append(header);
    const editor = el("div", { class: "ms-ink-preset-editor" });
    const name = el("input", { type: "text", value: active.label, maxlength: "80", "aria-label": "手写预设名称" }) as HTMLInputElement;
    name.addEventListener("change", () => {
      const label = name.value.trim().slice(0, 80);
      if (!label) { name.value = active.label; return; }
      this.actions.updatePreset(active.id, { label });
    });
    const type = el("select", { "aria-label": "手写预设类型" });
    for (const [value, text] of [["ballpoint", "原子笔"], ["fountain", "墨水笔"], ["pencil", "铅笔"], ["highlighter", "荧光笔"]] as const) type.append(el("option", { value, text }));
    type.value = active.type;
    type.addEventListener("change", () => { this.actions.updatePreset(active.id, { type: type.value as HandwritingPresetSpec["type"] }); this.renderPanel(); });
    if(active.type==="highlighter"){
      const purpose=el("select",{"aria-label":"荧光笔用途"}) as HTMLSelectElement;
      purpose.append(el("option",{value:"mask",text:"回忆遮挡"}),el("option",{value:"highlight",text:"仅标记"}));
      purpose.value=active.recallPurpose??"mask";purpose.addEventListener("change",()=>this.actions.updatePreset(active.id,{recallPurpose:purpose.value==="highlight"?"highlight":"mask"}));editor.append(purpose);
    }
    const color = el("input", { type: "color", value: active.color, "aria-label": "手写预设颜色", title: "颜色" }) as HTMLInputElement;
    color.addEventListener("change", () => this.actions.updatePreset(active.id, { color: color.value }));
    const width = (label: string, context: "document" | "mindmap" | "card") => {
      const input = el("input", { type: "range", min: ".5", max: active.type === "highlighter" ? "64" : "24", step: ".1", value: String(handwritingPresetWidth(active, context)), "aria-label": `手写预设${label}粗细` }) as HTMLInputElement;
      const caption = el("span", { text: `${label}: ${Number(input.value).toFixed(1)}` });
      input.addEventListener("input", () => this.actions.updatePreset(active.id, context === "document"
        ? { width: Number(input.value), documentWidth: Number(input.value) }
        : context === "mindmap" ? { mindmapWidth: Number(input.value) } : { cardWidth: Number(input.value) }));
      input.addEventListener("input", () => { caption.textContent = `${label}: ${Number(input.value).toFixed(1)}`; });
      const row = el("label", { class: "ms-ink-preset-row ms-ink-preset-width-row" }); row.append(caption, input); return row;
    };
    const opacity = el("input", { type: "range", min: "0", max: "1", step: ".05", value: String(active.opacity), "aria-label": "手写预设透明度" }) as HTMLInputElement;
    opacity.addEventListener("change", () => this.actions.updatePreset(active.id, { opacity: Number(opacity.value) }));
    const line = (label: string, control: HTMLElement) => { const row = el("label", { class: "ms-ink-preset-row" }); row.append(el("span", { text: label }), control); return row; };
    editor.append(line("名称", name), line("类型", type), line("颜色", color),
      width("文档", "document"), width("脑图", "mindmap"), width("卡片", "card"), line("透明度", opacity));
    const index = presets.findIndex(preset => preset.id === active.id);
    const actions = el("div", { class: "ms-ink-preset-actions" });
    const copy = el("button", { text: "复制为新工具", "aria-label": "复制为新工具" });
    copy.addEventListener("click", () => { this.actions.copyPreset(active.id); this.renderPanel(); });
    const up = el("button", { text: "上移", "aria-label": "向上移动手写预设" }); up.disabled = index <= 0;
    up.addEventListener("click", () => { this.actions.movePreset(active.id, -1); this.renderPanel(); });
    const down = el("button", { text: "下移", "aria-label": "向下移动手写预设" }); down.disabled = index >= presets.length - 1;
    down.addEventListener("click", () => { this.actions.movePreset(active.id, 1); this.renderPanel(); });
    const remove = el("button", { class: "ms-ink-preset-delete", text: "删除", "aria-label": "删除手写预设" }); remove.disabled = presets.length <= 1;
    remove.addEventListener("click", () => { this.actions.deletePreset(active.id); this.renderPanel(); });
    actions.append(copy, up, down, remove); section.append(editor, actions);
    body.append(section);
  }
  private openNameEditor(layer?: { id: string; name: string }): void {
    this.closeEditor?.();
    const { modal, close } = createModal(layer ? "重命名或合并" : "新建手写图层", () => { this.closeEditor = null; }); this.closeEditor = close;
    modal.classList.add("ms-ink-layer-name-modal");
    const name = el("input", { type: "text", value: layer?.name ?? "", placeholder: "图层名称", maxlength: "80", "aria-label": layer ? "修改手写图层名称" : "新手写图层名称" });
    const actions = el("div", { class: "ms-modal-actions" }), cancel = el("button", { class: "ms-btn", text: "取消" }), submit = el("button", { class: "ms-btn primary", text: "确定" });
    const refresh = () => { const value = name.value.trim(); submit.disabled = !value; submit.textContent = layer && this.actions.state().layers.some((other) => other.id !== layer.id && other.name === value) ? "合并到现有图层" : "确定"; };
    const save = () => { if (submit.disabled) return; if (layer) this.actions.rename(layer.id, name.value); else this.actions.create(name.value); close(); };
    name.addEventListener("input", refresh); name.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); save(); } });
    cancel.addEventListener("click", close); submit.addEventListener("click", save); actions.append(cancel, submit); modal.append(name, actions); refresh(); name.focus(); name.select();
  }
  private confirmDelete(layer: { id: string; name: string }): void {
    this.closeEditor?.();
    const { modal, close } = createModal("删除手写图层", () => { this.closeEditor = null; }); this.closeEditor = close;
    modal.classList.add("ms-ink-layer-delete-modal"); modal.append(el("p", { text: `删除「${layer.name}」及其中的手写？此操作无法撤销。` }));
    const actions = el("div", { class: "ms-modal-actions" }), cancel = el("button", { class: "ms-btn", text: "取消" }), remove = el("button", { class: "ms-btn primary", text: "删除" });
    cancel.addEventListener("click", close); remove.addEventListener("click", () => { this.actions.remove(layer.id); close(); }); actions.append(cancel, remove); modal.append(actions);
  }
}
