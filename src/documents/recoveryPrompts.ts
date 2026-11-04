import { createModal } from "../utils/modal";
import { el } from "../utils/dom";

export interface SourceRecoveryIssue {
  id: string;
  oldPath: string;
  candidates: string[];
  identicalCandidates: string[];
}

/** Owns the visible recovery prompts for one plugin load. */
export class SourceRecoveryPrompts {
  private closers = new Set<() => void>();
  private pending = new Map<string, SourceRecoveryIssue>();
  private disposed = false;
  constructor(private restore: (id: string, path: string, acceptChanged: boolean) => Promise<void>, private notify: (text: string) => void) {}

  show(issue: SourceRecoveryIssue): void {
    if (!this.disposed && issue.candidates.length) this.pending.set(issue.id, issue);
  }

  replaceIssues(issues: SourceRecoveryIssue[]): void {
    this.pending.clear();
    for (const issue of issues) this.show(issue);
  }

  openPending(): void {
    if (this.disposed) return;
    if (!this.pending.size) { this.notify("没有需要手动选择的原文档来源。"); return; }
    const { modal, close } = createModal("待恢复的原文档", () => this.closers.delete(close));
    this.closers.add(close);
    for (const issue of this.pending.values()) {
      const button = el("button", { class: "ms-btn", text: issue.oldPath });
      button.addEventListener("click", () => { close(); this.openIssue(issue); });
      modal.append(button);
    }
  }

  private openIssue(issue: SourceRecoveryIssue): void {
    const { id, oldPath, candidates, identicalCandidates } = issue;
    const { modal, close } = createModal("选择恢复的原文档", () => this.closers.delete(close));
    this.closers.add(close);
    const allIdentical = candidates.every(path => identicalCandidates.includes(path));
    modal.append(el("p", { text: allIdentical ? `“${oldPath}”存在多个内容完全相同的候选文件。请选择正确来源；关闭此窗口会保留缺源登记。` : `“${oldPath}”没有唯一的字节一致来源。完全一致的候选可直接选择；其他文件只有在你明确选择“采用已变化内容”后才会接回。关闭此窗口会保留缺源登记。` }));
    for (const path of candidates) {
      const identical = identicalCandidates.includes(path), button = el("button", { class: "ms-btn", text: (identical ? "内容一致：" : "采用已变化内容：") + path });
      button.addEventListener("click", () => {
        button.setAttribute("disabled", "true");
        void this.restore(id, path, !identical).then(() => {
          this.pending.delete(id); close(); this.notify(identical ? "来源已恢复并保留原文档身份。" : "已按你的选择接回内容已变化的来源；旧指纹与侧车副本保存在恢复目录。");
        }).catch(error => { button.removeAttribute("disabled"); this.notify("来源恢复未完成；两份批注与恢复记录已保留：" + String(error)); });
      });
      modal.append(button);
    }
    const cancel = el("button", { class: "ms-btn", text: "稍后处理" }); cancel.addEventListener("click", close); modal.append(cancel);
  }

  dispose(): void { this.disposed = true; this.pending.clear(); for (const close of [...this.closers]) close(); }
}
