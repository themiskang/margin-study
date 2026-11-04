import { Notice, setIcon } from "obsidian";
import { createSpeechSession, SpeechSession, SpeechSource, SpeechState, SpeechSection } from "./speech";

export interface ReadingSpeechOptions {
  owner: string;
  selectionRoot: () => HTMLElement | null;
  documentSource: () => SpeechSource;
  ready: () => boolean;
}

/** One toolbar and one owned queue per reading view; closing an unrelated view cannot cancel it. */
export class ReadingSpeechControls {
  readonly element: HTMLElement;
  readonly session: SpeechSession;
  private scope: HTMLSelectElement;
  private pauseButton: HTMLButtonElement;
  private stopButton: HTMLButtonElement;
  private status: HTMLElement;
  private unsubscribe: () => void;
  constructor(private options: ReadingSpeechOptions) {
    this.session = createSpeechSession(options.owner);
    this.element = document.createElement("div"); this.element.className = "ms-speech-controls";
    this.element.setAttribute("role", "group"); this.element.setAttribute("aria-label", "朗读控制");
    this.scope = document.createElement("select"); this.scope.setAttribute("aria-label", "朗读范围");
    this.scope.add(new Option("全文", "document")); this.scope.add(new Option("选区", "selection"));
    const button = (icon: string, title: string, action: () => void) => {
      const node = document.createElement("button"); node.className = "ms-tb-btn"; node.title = title; node.setAttribute("aria-label", title);
      setIcon(node, icon); node.addEventListener("mousedown", (event) => event.preventDefault()); node.addEventListener("click", action); return node;
    };
    const start = button("volume-2", "开始朗读", () => { void this.start(); });
    this.pauseButton = button("pause", "暂停朗读", () => this.session.state.status === "paused" ? this.session.resume() : this.session.pause());
    this.stopButton = button("square", "停止朗读", () => this.stop());
    const rate = document.createElement("select"); rate.setAttribute("aria-label", "朗读速度"); rate.title = "朗读速度";
    [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5].forEach((value) => rate.add(new Option(`${value} 倍`, String(value))));
    rate.value = "1"; rate.addEventListener("change", () => this.session.setRate(Number(rate.value)));
    this.status = document.createElement("span"); this.status.className = "ms-speech-status"; this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");
    this.element.append(this.scope, start, this.pauseButton, this.stopButton, rate, this.status);
    this.unsubscribe = this.session.subscribe((state) => this.render(state));
  }
  async start(scope = this.scope.value): Promise<boolean> {
    if (!this.options.ready()) { new Notice("请先加载文档"); return false; }
    let source: SpeechSource;
    if (scope === "selection") {
      const selection = window.getSelection(), root = this.options.selectionRoot();
      if (!root || !selection?.rangeCount || !root.contains(selection.getRangeAt(0).commonAncestorContainer) || !selection.toString().trim()) {
        new Notice("请先在当前文档中选择要朗读的文字"); return false;
      }
      source = selection.toString();
    } else {
      try { source = this.options.documentSource(); }
      catch (error) { new Notice("无法读取朗读内容：" + (error as Error).message); return false; }
    }
    return this.session.start(source);
  }
  stop(): void { this.session.stop(); }
  dispose(): void { this.unsubscribe(); this.session.dispose(); }
  private render(state: SpeechState): void {
    const running = ["preparing", "speaking", "paused"].includes(state.status);
    this.pauseButton.disabled = !running; this.stopButton.disabled = !running;
    const paused = state.status === "paused", title = paused ? "继续朗读" : "暂停朗读";
    this.pauseButton.title = title; this.pauseButton.setAttribute("aria-label", title); setIcon(this.pauseButton, paused ? "play" : "pause");
    const labels: Record<SpeechState["status"], string> = { idle: "", preparing: "准备朗读", speaking: "正在朗读", paused: "已暂停", stopped: "已停止", finished: "朗读完成", error: "朗读失败" };
    this.status.textContent = state.error ?? [labels[state.status], running ? state.label : ""].filter(Boolean).join(" · ");
    this.status.title = this.status.textContent;
  }
}

/** Text markers and annotation buttons are not part of the book's spoken content. */
export function readableDomText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script,style,svg,button,audio,video,.ms-ann-note,.ms-ann-voice,.ms-recall-mask,.ms-pen-overlay,[aria-hidden=true]").forEach((node) => node.remove());
  clone.querySelectorAll("br,p,div,section,article,h1,h2,h3,h4,h5,h6,li,tr,blockquote,pre").forEach((node) => node.append(document.createTextNode("\n")));
  return (clone.textContent ?? "").replace(/[\t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

export function* documentSpeechSections(root: HTMLElement): Generator<SpeechSection> {
  const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-ms-section]")).filter((node) => !node.parentElement?.closest("[data-ms-section]"));
  for (const section of sections.length ? sections : [root]) {
    const label = section.querySelector("h1,h2,h3")?.textContent?.trim() ?? "正文";
    yield { text: readableDomText(section), label, lang: section.lang || root.lang || undefined };
  }
}
