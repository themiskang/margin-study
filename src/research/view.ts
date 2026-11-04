import { ItemView, WorkspaceLeaf } from "obsidian";
import type MarginStudyPlugin from "../main";
import { mountResearchBrowser, researchSession } from "./browser";
import type { ResearchHandle, ResearchSession } from "./browser";
export const VIEW_TYPE_RESEARCH = "margin-study-research";
export class ResearchView extends ItemView {
  private browser?: ResearchHandle;
  private url?: string;
  private session?: ResearchSession;
  constructor(leaf: WorkspaceLeaf, readonly plugin: MarginStudyPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_RESEARCH; }
  getDisplayText(): string { return "Research · MarginStudy"; }
  getIcon(): string { return "globe"; }
  async onOpen(): Promise<void> {
    this.contentEl.replaceChildren(); this.contentEl.classList.add("ms-research-window");
    this.browser = mountResearchBrowser(this.contentEl, this.plugin, { initialUrl: this.url, session: this.session, onSessionChanged: session => { this.session = session; this.url = session.entries[session.index]; this.app.workspace.requestSaveLayout(); }, onClose: () => this.leaf.detach(), onNewWindow: url => { void this.plugin.openResearchBrowser(url, true); } });
  }
  async onClose(): Promise<void> { this.browser?.dispose(); this.browser = undefined; }
  getState(): Record<string, unknown> { return { url: this.browser?.currentUrl() || this.url, session: this.browser?.session() ?? this.session }; }
  async setState(state: { url?: string; session?: ResearchSession }): Promise<void> { this.url = state?.url; this.session = state?.session ? researchSession(state.session) : undefined; if (this.browser) { this.browser.dispose(); this.browser = undefined; await this.onOpen(); } }
}
