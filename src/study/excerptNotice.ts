import { Menu, Notice } from "obsidian";
import type MarginStudyPlugin from "../main";

export function showExcerptNotice(plugin: MarginStudyPlugin, cardId: string, options: { timeout?: number } = {}): Notice {
  const notice = new Notice("已加入脑图", options.timeout ?? 6000);
  const host = notice.noticeEl;
  if (!host) return notice;
  const workspace = plugin.studyWorkspace;
  const node = plugin.store.nodes.find(item => item.cardId === cardId && item.canvasId === plugin.store.activeCanvasId);
  const addButton = (label: string, action: (button: HTMLButtonElement) => void) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ms-excerpt-notice-locate";
    button.textContent = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", event => { event.stopPropagation(); action(button); });
    host.append(button);
  };
  if (workspace && node && !workspace.isMindmapVisible()) {
    addButton("打开脑图", () => {
      notice.hide();
      const locate = plugin.locateCard;
      void Promise.resolve(locate ? locate.call(plugin, cardId) : workspace.revealCardInMap(cardId))
        .then(found => { if (!found) throw new Error("no card"); })
        .catch(() => new Notice("未能定位摘录卡"));
    });
  } else if (workspace && node && workspace.isMindmapVisible()) {
    workspace.revealCardInMap(cardId);
  }
  addButton("撤回", () => {
    if (!node || !plugin.store.removeExcerptFromMindmap(node.id)) {
      new Notice("未找到摘录节点");
      return;
    }
    plugin.refreshMindmap();
    notice.setMessage("已撤回入图，原文摘录保留");
  });
  addButton("摘录操作", button => {
    const menu = new Menu();
    menu.addItem(item => item.setTitle("复制摘录文本").onClick(() => {
      const text = plugin.store.getCard(cardId)?.front ?? "";
      void navigator.clipboard.writeText(text).catch(() => new Notice("复制失败"));
    }));
    const box = button.getBoundingClientRect();
    menu.showAtPosition({ x: box.left, y: box.bottom });
  });
  addButton("摘录去向", () => {
    const target = workspace?.containerEl.querySelector<HTMLButtonElement>('[aria-label="跟着选中"]');
    if (target) target.click();
    else new Notice("请先打开学习集工作区");
  });
  return notice;
}
