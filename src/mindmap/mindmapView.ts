import { ItemView, WorkspaceLeaf } from "obsidian";
import type MarginStudyPlugin from "../main";
import { MindmapRenderer } from "./mindmapRenderer";
import { renderStudyControls } from "../study/studyControls";
import { clear, el } from "../utils/dom";

export const VIEW_TYPE_MINDMAP = "margin-study-mindmap";

export class MindmapView extends ItemView {
  plugin: MarginStudyPlugin;
  private renderer: MindmapRenderer | null = null;
  private studyControlsEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: MarginStudyPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_MINDMAP;
  }
  getDisplayText(): string {
    return "MarginStudy 导图";
  }
  getIcon(): string {
    return "git-branch";
  }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    clear(root);
    root.classList.add("ms-mindmap-view");
    root.style.display = "flex";
    root.style.flexDirection = "column";
    this.studyControlsEl = el("div", { class: "ms-study-controls" });
    const map = el("div", { style: "flex:1;min-height:0" });
    root.append(this.studyControlsEl, map);
    this.renderer = new MindmapRenderer(this.plugin, { showToolbar: true });
    this.renderer.mount(map);
    this.plugin.mindmapView = this;
    this.refresh();
  }

  refresh(): void {
    if (this.studyControlsEl) renderStudyControls(this.studyControlsEl, this.plugin, () => {
      this.plugin.refreshSidebar();
      this.plugin.refreshMindmap();
    });
    this.renderer?.requestRender();
  }

  updateMovedNodes(ids: readonly string[]): void { this.renderer?.updateMovedNodes(ids); }

  async onClose(): Promise<void> {
    if (this.plugin.mindmapView === this) this.plugin.mindmapView = null;
    this.renderer?.destroy();
    this.renderer = null;
    this.studyControlsEl = null;
  }
}
