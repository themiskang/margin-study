import type MarginStudyPlugin from "../main";
import { aiErrorText } from "../ai/contracts";
import { aiServiceFor } from "../ai/panel";
import { el } from "../utils/dom";
import { createModal } from "../utils/modal";

export function recognizeInk(plugin: MarginStudyPlugin, image: string): void {
  if (!/^data:image\/png;base64,/.test(image)) return;
  const abort = new AbortController();
  const { modal, close } = createModal("AI 转文本", () => abort.abort());
  const status = el("p", { role: "status", text: "正在识别选中的笔迹…" });
  const text = el("textarea", { "aria-label": "识别文字", rows: 10 });
  const copy = el("button", { type: "button", text: "复制文字" });
  copy.disabled = true;
  copy.addEventListener("click", () => { void navigator.clipboard.writeText(text.value).then(() => { status.textContent = "已复制识别文字。"; }).catch(() => { text.focus(); text.select(); status.textContent = "无法写入剪贴板，请手动复制。"; }); });
  const dismiss = el("button", { type: "button", text: "关闭" }); dismiss.addEventListener("click", close);
  modal.append(status, text, copy, dismiss);
  void aiServiceFor(plugin).request({ text: "请识别图片中的手写文字。", task: "markdown", images: [image], signal: abort.signal }).then(result => {
    if (abort.signal.aborted) return;
    text.value = result.text; copy.disabled = !text.value.trim(); status.textContent = "识别完成，请校对文字。";
  }).catch(error => { if (!abort.signal.aborted) status.textContent = aiErrorText(error); });
}
