import { createModal } from "../utils/modal";
import { el } from "../utils/dom";
import type { Store } from "../model/store";

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

export function openSyncStatusPanel(store: Store, actions: { findSource: () => void; resolveConflict: () => void; backupPaths: () => string[]; notify: (message: string) => void }): void {
  let unsubscribe = () => {};
  const { modal, close } = createModal("本地状态与保护", () => unsubscribe());
  modal.classList.add("ms-sync-status");
  const content = el("div"); modal.append(content);
  const showBackups = () => {
    const picker = createModal("选择完整备份");
    picker.modal.append(el("p", { text: "校验备份后选择具体对象；不会覆盖整个学习库或源文件。" }));
    const paths = actions.backupPaths();
    if (!paths.length) picker.modal.append(el("p", { text: "没有完整备份。" }));
    for (const path of paths) {
      const button = el("button", { class: "ms-btn", text: path });
      button.addEventListener("click", () => {
        button.disabled = true;
        void store.prepareBackupRecovery(path).then(() => { picker.close(); return showSnapshots(); })
          .catch(error => { button.disabled = false; actions.notify("备份校验未通过：" + String(error)); });
      });
      picker.modal.append(button);
    }
    const done = el("button", { class: "ms-btn", text: "关闭" }); done.addEventListener("click", picker.close); picker.modal.append(done);
  };
  const showSnapshots = async () => {
    try {
      const snapshots = await store.listProtectionSnapshots();
      const picker = createModal("选择保护快照"); picker.modal.classList.add("ms-sync-status");
      picker.modal.append(el("p", { text: "只恢复勾选的对象，不回滚整个学习库；源文件和未选择的关联数据不会改变。" }));
      if (!snapshots.length) picker.modal.append(el("p", { text: "暂无可读取的保护快照。" }));
      for (const snapshot of snapshots) {
        const section = el("section", { class: "ms-sync-snapshot" });
        section.append(el("h4", { text: `${snapshot.createdAt}  ${snapshot.reason}` }));
        const selected = new Map<string, HTMLInputElement>(), duplicates = new Set(snapshot.scope.filter((item, index, items) => items.some((other, otherIndex) => otherIndex !== index && other.id === item.id)).map(item => item.id));
        for (const item of snapshot.scope) {
          const label = el("label", { class: "ms-sync-object" }), checkbox = el("input", { type: "checkbox" });
          checkbox.disabled = duplicates.has(item.id); selected.set(item.id, checkbox);
          label.append(checkbox, el("span", { text: `${item.collection}：${item.id}${item.docPath ? "（" + item.docPath + "）" : ""}${checkbox.disabled ? "（ID 不唯一，不能选择）" : ""}` }));
          section.append(label);
        }
        const restore = el("button", { class: "ms-btn", text: "恢复选中对象" });
        restore.addEventListener("click", () => {
          const ids = [...selected].filter(([, checkbox]) => checkbox.checked && !checkbox.disabled).map(([id]) => id);
          if (!ids.length) { actions.notify("请先勾选要恢复的对象。"); return; }
          restore.disabled = true;
          void store.restoreProtectionSnapshot(snapshot.path, ids).then(async () => {
            try { await store.flush(); actions.notify(`已恢复并保存 ${ids.length} 个选中对象。`); }
            catch (error) { actions.notify("对象已恢复到当前窗口，但尚未保存：" + String(error)); }
            picker.close();
          }).catch(error => { restore.disabled = false; actions.notify("恢复未完成：" + String(error)); });
        });
        section.append(restore); picker.modal.append(section);
      }
      const done = el("button", { class: "ms-btn", text: "关闭" }); done.addEventListener("click", picker.close); picker.modal.append(done);
    } catch (error) { actions.notify("无法读取保护快照：" + String(error)); }
  };
  const render = () => {
    content.replaceChildren();
    for (const item of store.getSyncStatus()) {
      const row = el("section", { class: "ms-sync-row", "data-status": item.key, "data-evidence-event-ids": item.evidenceEventIds.join(",") });
      row.append(el("div", { text: item.text }));
      if (item.action) {
        const labels: Record<string, string> = {
          "find-source": "查找或重定位来源文件", "resolve-conflict": "处理冲突", "show-deletions": "查看可恢复对象",
          "save-local": "立即保存", "relink-source": "重新链接来源文件", "reimport-source": "重新导入来源文件",
        };
        const button = el("button", { class: "ms-btn", text: labels[item.action] });
        button.addEventListener("click", () => {
          if (item.action === "find-source" || item.action === "relink-source") actions.findSource();
          else if (item.action === "resolve-conflict") actions.resolveConflict();
          else if (item.action === "save-local") void store.flush().then(() => actions.notify("本地修改已保存。")).catch(error => actions.notify("本地修改尚未保存：" + String(error)));
          else if (item.action === "reimport-source") actions.notify("请从学习集「管理文档…」或「从文件」重新导入来源文档。");
          else void showSnapshots();
        });
        row.append(button);
      }
      row.append(el("small", { text: "本地事件：" + item.evidenceEventIds.join("、") }));
      content.append(row);
    }
    const history = el("details", { class: "ms-sync-history" }); history.append(el("summary", { text: "查看最近本地事件" }));
    for (const event of store.getLocalEvents().slice(-10).reverse()) history.append(el("p", { text: `${event.at}  ${event.detail}  [${event.id}]` }));
    const snapshots = el("button", { class: "ms-btn", text: "查看保护快照" }); snapshots.addEventListener("click", () => { void showSnapshots(); });
    const backups = el("button", { class: "ms-btn", text: "从完整备份选择对象" }); backups.addEventListener("click", showBackups);
    const done = el("button", { class: "ms-btn", text: "关闭" }); done.addEventListener("click", close);
    content.append(history, snapshots, backups, done);
  };
  const unsubscribeStore = store.subscribe(render), unsubscribeStatus = store.subscribeLocalStatus(render);
  unsubscribe = () => { unsubscribeStore(); unsubscribeStatus(); };
  render();
}
