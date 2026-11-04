import { el } from "./dom";

export interface TextModalOpts {
  title: string;
  placeholder?: string;
  initial?: string;
  okText?: string;
  onOk: (value: string) => void;
}

/** 轻量文本编辑模态（复用 .ms-modal 样式） */
export function openTextModal(opts: TextModalOpts): void {
  const bg = el("div", { class: "ms-modal-bg" });
  const modal = el("div", { class: "ms-modal" });
  modal.append(el("h3", { text: opts.title, style: "margin:0 0 10px" }));

  const ta = el("textarea", { placeholder: opts.placeholder ?? "" }) as HTMLTextAreaElement;
  ta.value = opts.initial ?? "";
  ta.style.minHeight = "120px";
  ta.style.fontFamily = "inherit";

  const actions = el("div", { class: "ms-modal-actions" });
  const cancel = el("button", { class: "ms-btn", text: "取消" });
  const ok = el("button", { class: "ms-btn primary", text: opts.okText ?? "确定" });
  cancel.addEventListener("click", () => bg.remove());
  ok.addEventListener("click", () => {
    opts.onOk(ta.value);
    bg.remove();
  });
  actions.append(cancel, ok);

  modal.append(ta, actions);
  bg.append(modal);
  document.body.append(bg);
  setTimeout(() => ta.focus(), 0);
}

/** 确认对话框 */
export function openConfirm(title: string, message: string, onYes: () => void, yesText = "确定"): void {
  const bg = el("div", { class: "ms-modal-bg" });
  const modal = el("div", { class: "ms-modal" });
  modal.append(el("h3", { text: title, style: "margin:0 0 8px" }));
  modal.append(el("p", { text: message, style: "margin:0 0 12px; color:var(--text-muted)" }));
  const actions = el("div", { class: "ms-modal-actions" });
  const cancel = el("button", { class: "ms-btn", text: "取消" });
  const ok = el("button", { class: "ms-btn primary", text: yesText });
  cancel.addEventListener("click", () => bg.remove());
  ok.addEventListener("click", () => {
    onYes();
    bg.remove();
  });
  actions.append(cancel, ok);
  modal.append(actions);
  bg.append(modal);
  document.body.append(bg);
}

/** 通用模态容器：返回元素与关闭函数（支持 Esc / 点击背景关闭） */
export function createModal(
  title: string,
  onClose?: () => void,
  ownerDocument: Document = document
): {
  bg: HTMLElement;
  modal: HTMLElement;
  close: () => void;
} {
  const bg = el("div", { class: "ms-modal-bg" });
  const modal = el("div", { class: "ms-modal" });
  modal.append(el("h3", { text: title, style: "margin:0 0 10px" }));
  // 关闭时一并移除 document 上的 Esc 监听，避免点背景/按钮关闭后监听器残留（内存泄漏）
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const layers = ownerDocument.querySelectorAll(".ms-modal-bg");
    if (layers[layers.length - 1] !== bg) return;
    e.preventDefault(); close();
  };
  const close = () => {
    ownerDocument.removeEventListener("keydown", onKey);
    bg.remove();
    if (onClose) onClose();
  };
  bg.addEventListener("mousedown", (e) => {
    if (e.target === bg) close();
  });
  ownerDocument.addEventListener("keydown", onKey);
  bg.append(modal);
  ownerDocument.body.append(bg);
  return { bg, modal, close };
}

/**
 * 图片灯箱：全屏查看图片，支持滚轮缩放、点击放大/还原、点击背景或空白处关闭。
 * 用于套索（区域）摘录卡片的截图全景查看。
 *
 * 实现要点：直接按“窗口适应比例 × 用户缩放”设置图片的显式像素尺寸，
 * 容器 overflow:auto 自动出现滚动条，可平移查看被放大的整张图（不再被裁切）。
 */
export function openImageLightbox(src: string, title = "图片查看 · 滚轮缩放 / 点击放大 / 点击背景关闭"): void {
  const { bg, modal, close } = createModal(title);
  bg.classList.add("ms-lightbox-bg");
  modal.classList.add("ms-lightbox-modal");

  const img = el("img", { src, class: "ms-lightbox-img" }) as HTMLImageElement;
  let fit = 1; // 窗口适应比例（保证初始完整可见）
  let userZoom = 1; // 用户缩放倍率
  const apply = () => {
    const w = (img.naturalWidth * fit * userZoom) || 0;
    img.style.width = w ? `${w}px` : "";
    img.style.height = "auto";
  };
  img.addEventListener("load", () => {
    const cw = modal.clientWidth || Math.floor(window.innerWidth * 0.9);
    const ch = modal.clientHeight || Math.floor(window.innerHeight * 0.9);
    fit = Math.min(cw / img.naturalWidth, ch / img.naturalHeight, 1);
    userZoom = 1;
    apply();
  });
  img.addEventListener("wheel", (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    userZoom = Math.max(0.2, Math.min(8, userZoom * factor));
    apply();
  }, { passive: false });
  // 点击图片在「适应窗口」与「2倍」之间切换；不冒泡，避免触发关闭
  img.addEventListener("click", (e) => {
    e.stopPropagation();
    userZoom = userZoom > 1.05 ? 1 : 2;
    apply();
  });
  // 点击 modal 内空白处（图片之外）也可关闭
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  modal.append(img);
}
