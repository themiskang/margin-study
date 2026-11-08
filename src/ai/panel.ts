import { AiError, aiErrorText } from "./contracts";
import type { AiContext, AiDraft, AiHost, AiTask, ChatMessage } from "./contracts";
import { AiService } from "./service";
import { defaultMarkdownFilename, saveLibraryDraft, saveMarkdownDraft, validateDraft } from "./drafts";
import { clear, el } from "../utils/dom";
import { createModal } from "../utils/modal";
import { buildClaudianPrompt, claudianAvailability, supportsClaudianRequest, supportsClaudianImages, openClaudian, subscribeClaudianReplies } from "./claudianBridge";
import { requestClaudian } from "./claudianRequest";
import { draftFromPastedReply } from "./resultImport";
import { Notice } from "obsidian";
import { saveAnswerBranch, writeAnswerSelection } from "./a23";

const services = new WeakMap<object, AiService>();
export function aiServiceFor(host: AiHost): AiService {
  let service = services.get(host);
  if (!service) { service = new AiService(host.app); services.set(host, service); }
  return service;
}
const ICONS: Record<string, string> = {
  history: '<path d="M3 5v5h5M3.5 10a9 9 0 1 1 1 7M12 6v6l-3 3"/>',
  plus: '<path d="M12 4v16M4 12h16"/>', close: '<path d="m5 5 14 14M19 5 5 19"/>',
  attachment: '<path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l10-10M6 15l9-9"/>',
  more: '<circle cx="12" cy="12" r="9" fill="currentColor" stroke="none"/><g fill="white" stroke="none"><circle cx="7" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="17" cy="12" r="1"/></g>',
  down: '<path d="m6 9 6 6 6-6"/>', sync: '<path d="M20 7v5h-5M4 17v-5h5M5.5 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.5-3"/>',
};
function iconButton(label: string, icon: string): HTMLButtonElement {
  const button = el("button", { class: "ms-ai-icon", type: "button", title: label, "aria-label": label });
  button.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
  return button;
}
function field(label: string, input: HTMLElement): HTMLElement {
  return el("label", { class: "ms-ai-field" }, [el("span", { text: label }), input]);
}
export function openAiSettings(host: AiHost, onBound?: () => void, suppliedService?: AiService): () => void {
  const service = suppliedService ?? aiServiceFor(host), config = service.configuration();
  let controller: AbortController | undefined, closed = false;
  const { modal, close } = createModal("自定义 AI", () => { closed = true; controller?.abort(); apiKey.value = ""; onBound?.(); });
  modal.classList.add("ms-ai-settings"); modal.setAttribute("aria-label", "自定义 AI 设置");
  const endpoint = el("input", { type: "url", placeholder: "https://…/v1/chat/completions", "aria-label": "Base URL", spellcheck: "false" }); endpoint.value = config.endpoint;
  const mini = el("input", { type: "text", placeholder: "服务端的准确模型名称", "aria-label": "Mini 模型", spellcheck: "false" }); mini.value = config.miniModel;
  const normal = el("input", { type: "text", placeholder: "服务端的准确模型名称", "aria-label": "Normal 模型", spellcheck: "false" }); normal.value = config.normalModel;
  const apiKey = el("input", { type: "password", "aria-label": "API Key", autocomplete: "off", spellcheck: "false", placeholder: config.hasSavedKey ? "已保存在密钥存储；留空保持" : "本地服务可留空" });
  const clearKey = el("input", { type: "checkbox", "aria-label": "清除已保存密钥" });
  const status = el("div", { class: "ms-ai-settings-status", role: "status", "aria-live": "polite", text: service.isBound() ? `已绑定 Mini：${config.miniModel} · Normal：${config.normalModel}` : "填写后测试流式文本、图片、工具调用与工具结果回传。" });
  const help = el("p", { class: "ms-ai-settings-help", text: "填写完整 Chat Completions 端点。密钥使用 Obsidian 密钥存储（1.11.4+）。更换地址、密钥或模型后需要重新测试。" });
  const cancel = el("button", { type: "button", text: "关闭" }), test = el("button", { type: "button", text: "测试并绑定自定义 AI", class: "ms-ai-primary" });
  let invalidated = false;
  const changed = () => { if (!invalidated) { service.unbind(); invalidated = true; onBound?.(); } status.textContent = "配置已修改，请重新测试并绑定。"; };
  for (const input of [endpoint, mini, normal, apiKey, clearKey]) input.addEventListener("input", changed);
  cancel.addEventListener("click", close);
  test.addEventListener("click", async () => {
    if (controller) { controller.abort(); return; }
    controller = new AbortController(); test.textContent = "停止测试";
    const controls = [endpoint, mini, normal, apiKey, clearKey]; controls.forEach(input => input.disabled = true);
    try {
      service.configure({ endpoint: endpoint.value, miniModel: mini.value, normalModel: normal.value,
        ...(clearKey.checked ? { apiKey: "" } : apiKey.value ? { apiKey: apiKey.value } : {}) });
      apiKey.value = "";
      await service.testAndBind({ signal: controller.signal, onProgress: message => { if (!closed) status.textContent = message; } });
      invalidated = false; apiKey.placeholder = service.configuration().hasSavedKey ? "已保存在密钥存储；留空保持" : "本地服务可留空";
      onBound?.();
    } catch (error) { if (!closed) status.textContent = aiErrorText(error); }
    finally { controller = undefined; if (!closed) { test.textContent = "测试并绑定自定义 AI"; controls.forEach(input => input.disabled = false); } }
  });
  modal.append(help, field("Base URL", endpoint), field("API Key", apiKey), el("label", { class: "ms-ai-clear-key" }, [clearKey, "清除已保存密钥"]),
    field("Mini 模型", mini), field("Normal 模型", normal), status, el("div", { class: "ms-ai-settings-actions" }, [cancel, test]));
  return close;
}

export interface AiPanelOptions {
  mode?: "ask" | "chat";
  initialText?: string;
  context?: AiContext;
  getContext?: () => AiContext | undefined | Promise<AiContext | undefined>;
  getSelectedNodeId?: () => string | undefined;
  onClose?: () => void;
  onExternalView?: () => void;
  onSaved?: (result: { kind: AiDraft["kind"]; ids?: string[]; path?: string }) => void;
  /** Injection for isolated local acceptance; never carries credentials. */
  service?: AiService;
}
export interface AiPanelHandle {
  dispose(): void;
  suspend(): void;
  resume(container: HTMLElement): void;
  focus(): void;
  setContext(context?: AiContext): void;
}
interface Conversation { label: string; history: ChatMessage[]; elements: HTMLElement[]; }

/** Native AI sidebar skeleton measured from 11-ai-chat-reference.png (440 CSS px). */
export function mountAiPanel(container: HTMLElement, host: AiHost, options: AiPanelOptions = {}): AiPanelHandle {
  const service = options.service ?? aiServiceFor(host);
  let disposed = false, suspended = false, controller: AbortController | undefined, context = options.context, images: string[] = [], settingClose: (() => void) | undefined;
  let replySubscription: ReturnType<typeof subscribeClaudianReplies> = null;
  const bridge = claudianAvailability(host.app);
  let provider: "claudian" | "custom" = bridge.available ? "claudian" : "custom";
  const root = el("section", { class: "ms-ai-panel", "aria-label": "AI 学习助手" });
  const header = el("header", { class: "ms-ai-header" });
  const historyButton = iconButton("本次会话历史", "history"), newButton = iconButton("新建 AI 对话", "plus"), closeButton = iconButton("关闭 AI 侧栏", "close");
  const mode = el("select", { class: "ms-ai-mode", "aria-label": "AI 对话模式" }, [el("option", { value: "chat", text: "Chat" }), el("option", { value: "ask", text: "Ask" })]); mode.value = options.mode ?? "chat";
  header.append(historyButton, newButton, mode, closeButton);
  const template = el("select", { class: "ms-ai-template", "aria-label": "AI 提问模板" });
  for (const [value, text] of [["", "Template: None"], ["guide", "Template: Guide Mode"], ["quiz", "Template: Quiz Mode"], ["explain", "Template: Explain Mode"]]) template.append(el("option", { value, text }));
  const body = el("div", { class: "ms-ai-body", "aria-label": "AI 对话内容" });
  const empty = el("div", { class: "ms-ai-empty", text: "拖入卡片、选中文字或图片，提问并生成可编辑的目录、卡片与 Markdown。保存前可修改。" });
  const sessions: Conversation[] = [], drawer = el("div", { class: "ms-ai-history", "aria-label": "本次会话历史列表" }); drawer.hidden = true;
  let current: Conversation = { label: "新对话", history: [], elements: [] }; sessions.push(current);
  const connection = el("button", { type: "button", class: "ms-ai-connect", text: "连接自定义 AI" });
  const composer = el("div", { class: "ms-ai-composer" }), attachments = el("div", { class: "ms-ai-attachments" });
  const tools = el("div", { class: "ms-ai-tools" }), mini = el("button", { class: "ms-ai-tier", type: "button", text: "Mini ›", "aria-label": "使用 Mini 模型", "aria-pressed": "false" }), normal = el("button", { class: "ms-ai-tier", type: "button", text: "Normal", "aria-label": "使用 Normal 模型", "aria-pressed": "true" });
  let tier: "mini" | "normal" = "normal";
  const providerSelect = el("select", { class: "ms-ai-service", "aria-label": "AI 服务" }, [el("option", { value: "claudian", text: "Claudian（现有插件）" }), el("option", { value: "custom", text: "自定义 API" })]);
  providerSelect.value = provider; providerSelect.hidden = !bridge.available;
  const attachmentButton = iconButton("附加文字或图片", "attachment"), attachmentMenu = el("div", { class: "ms-ai-attachment-menu" }); attachmentMenu.hidden = true;
  const pasteText = el("button", { type: "button", text: "附加文字" }), fromSelection = el("button", { type: "button", text: "使用当前选择" }), chooseImage = el("button", { type: "button", text: "附加图片" }), pasteReply = el("button", { type: "button", text: "粘贴 AI 回复" });
  fromSelection.hidden = !options.getContext; attachmentMenu.append(fromSelection, pasteText, chooseImage, pasteReply);
  const imageInput = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", multiple: true, "aria-label": "选择 AI 图片" }); imageInput.hidden = true;
  const task = el("select", { class: "ms-ai-task", "aria-label": "AI 任务" }, [el("option", { value: "chat", text: "Ask" }), el("option", { value: "outline", text: "AI 目录" }), el("option", { value: "cards", text: "生成卡片" }), el("option", { value: "markdown", text: "识别为 Markdown" })]);
  const syncReplies = iconButton("自动接收下一条 Claudian 回复", "sync");
  tools.append(providerSelect, mini, normal, task, attachmentButton, syncReplies);
  const row = el("div", { class: "ms-ai-input-row" }), settings = iconButton("AI 设置", "more"), input = el("textarea", { class: "ms-ai-input", rows: 1, placeholder: "Ask a question", "aria-label": "AI 问题" }), down = iconButton("滚动到最新回复", "down"), send = el("button", { class: "ms-ai-send", type: "button", text: "Send", "aria-label": "发送 AI 请求" });
  input.value = options.initialText ?? "";
  const status = el("div", { class: "ms-ai-status", role: "status", "aria-live": "polite" });
  row.append(settings, input, down, send); composer.append(attachments, tools, row, status, attachmentMenu, imageInput);
  root.append(header, el("div", { class: "ms-ai-template-row" }, [template]), drawer, body, composer); container.append(root);
  const scrollBottom = () => { body.scrollTop = body.scrollHeight; };
  const refresh = () => {
    const claudian = provider === "claudian", bound = service.isBound();
    send.disabled = !controller && ((!claudian && !bound) || claudian && images.length > 0 && !supportsClaudianImages(host.app) || !input.value.trim() && !context?.text && !images.length);
    send.textContent = controller ? "Stop" : "Send"; send.setAttribute("aria-label", controller ? "停止 AI 生成" : "发送 AI 请求");
    connection.hidden = claudian || bound;
    for (const control of [providerSelect, mini, normal, task, mode, attachmentButton, template, newButton, historyButton]) control.disabled = !!controller;
    input.disabled = !!controller;
    attachments.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = !!controller);
    mini.hidden = normal.hidden = claudian;
    if (claudian) mode.value = "chat";
    mode.disabled = !!controller || claudian;
    chooseImage.disabled = claudian && !supportsClaudianImages(host.app);
    chooseImage.title = chooseImage.disabled ? "请在 Claudian 聊天中手动附加图片" : "";
    empty.textContent = claudian ? supportsClaudianImages(host.app) ? "使用 Claudian 已选模型处理文字和图片，回复显示在此处；目录和卡片先预览再保存。" : "使用 Claudian 已选模型直接生成，回复显示在此处；目录和卡片先预览再保存。图片请在 Claudian 中附加。" : "拖入卡片、选中文字或图片，提问并生成可编辑的目录、卡片与 Markdown。保存前可修改。";
    mini.disabled = !!controller || task.value === "cards" || task.value === "outline";
    syncReplies.hidden = !claudian || bridge.version !== "2.3.30";
    syncReplies.disabled = !!controller;
    syncReplies.title = replySubscription ? "停止同步 Claudian 回复" : "自动接收下一条 Claudian 回复";
    syncReplies.setAttribute("aria-label", syncReplies.title);
    syncReplies.setAttribute("aria-pressed", String(!!replySubscription));
  };
  const showConversation = () => {
    clear(body); body.append(connection); if (!current.elements.length) body.append(empty);
    for (const element of current.elements) body.append(element); scrollBottom();
  };
  const attachmentView = () => {
    clear(attachments);
    if (context) {
      const chip = el("button", { type: "button", class: "ms-ai-context-chip", "aria-label": "移除文字上下文", text: `${context.label ?? "附加文字"} · ${context.text.length} 字 ×` });
      chip.title = context.text.slice(0, 500); chip.addEventListener("click", () => { context = undefined; attachmentView(); }); attachments.append(chip);
    }
    images.forEach((image, index) => {
      const chip = el("button", { class: "ms-ai-image-chip", type: "button", "aria-label": `移除图片 ${index + 1}`, title: "移除图片" }, [el("img", { src: image, alt: `附加图片 ${index + 1}` }), "×"]);
      chip.addEventListener("click", () => { images.splice(index, 1); attachmentView(); }); attachments.append(chip);
    });
    refresh();
  };
  const openSettings = () => { settingClose?.(); settingClose = openAiSettings(host, () => { if (!disposed) refresh(); }, service); };
  const openPromptFallback = (prompt: string, message: string) => {
    settingClose?.();
    const { modal, close } = createModal("在 Claudian 中继续", () => { settingClose = undefined; }); settingClose = close;
    modal.classList.add("ms-ai-bridge-modal");
    const editor = el("textarea", { rows: 12, "aria-label": "待粘贴到 Claudian 的提问" }); editor.value = prompt;
    const hint = el("p", { role: "status", text: message });
    const copy = el("button", { type: "button", text: "复制提问" }), open = el("button", { type: "button", text: "打开 Claudian" }), done = el("button", { type: "button", text: "关闭" });
    copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(editor.value); hint.textContent = "已复制，请在 Claudian 输入框粘贴并确认发送。"; } catch { editor.focus(); editor.select(); hint.textContent = "内容已选中，请手动复制后粘贴到 Claudian。"; } });
    open.addEventListener("click", () => { options.onExternalView?.(); if (!openClaudian(host.app)) hint.textContent = "Claudian 未就绪，请从 Obsidian 的命令面板打开。"; });
    done.addEventListener("click", close); modal.append(hint, editor, el("div", { class: "ms-ai-bridge-actions" }, [copy, open, done]));
  };
  const addMessage = (role: "user" | "assistant", text: string): HTMLElement => {
    empty.remove();
    const message = el("article", { class: `ms-ai-message ms-ai-message-${role}`, "aria-label": role === "user" ? "我的问题" : "AI 回复" }, [el("div", { class: "ms-ai-message-text", text })]);
    current.elements.push(message); body.append(message); scrollBottom(); return message;
  };
  const draftView = (draft: AiDraft, sourceDocPath?: string) => {
    const box = el("section", { class: "ms-ai-draft", "aria-label": "AI 可编辑预览", "data-ai-draft": draft.kind }), content = el("div", { class: "ms-ai-draft-content" });
    box.append(el("strong", { text: draft.kind === "cards" ? `卡片预览（${draft.cards.length}）` : draft.kind === "outline" ? "目录预览" : "Markdown 预览" }));
    const resultStatus = el("div", { class: "ms-ai-draft-status", role: "status" });
    let collect: () => AiDraft, filename: HTMLInputElement | undefined;
    if (draft.kind === "cards") {
      const rows = draft.cards.map((card, index) => {
        const title = el("input", { "aria-label": `卡片 ${index + 1} 标题`, placeholder: "标题" }); title.value = card.title;
        const excerpt = el("textarea", { "aria-label": `卡片 ${index + 1} 正文`, rows: 3, placeholder: "正文 / 问题" }); excerpt.value = card.excerpt;
        const note = el("textarea", { "aria-label": `卡片 ${index + 1} 笔记`, rows: 2, placeholder: "笔记 / 答案" }); note.value = card.note;
        const tags = el("input", { "aria-label": `卡片 ${index + 1} 标签`, placeholder: "标签，以逗号分隔" }); tags.value = card.tags.join(", ");
        content.append(el("div", { class: "ms-ai-preview-card" }, [title, excerpt, note, tags])); return { title, excerpt, note, tags };
      });
      collect = () => validateDraft("cards", { cards: rows.map(row => ({ title: row.title.value, excerpt: row.excerpt.value, note: row.note.value, tags: row.tags.value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) })) });
    } else if (draft.kind === "outline") {
      const title = el("input", { "aria-label": "AI 目录总标题" }); title.value = draft.title; content.append(title);
      const rows = draft.items.map((item, index) => {
        const level = el("select", { "aria-label": `目录 ${index + 1} 层级` });
        for (let value = 1; value <= 8; value++) level.append(el("option", { value, text: String(value) })); level.value = String(item.level);
        const title = el("input", { "aria-label": `目录 ${index + 1} 标题` }); title.value = item.title;
        const note = el("textarea", { "aria-label": `目录 ${index + 1} 笔记`, rows: 2, placeholder: "笔记" }); note.value = item.note;
        content.append(el("div", { class: "ms-ai-preview-outline" }, [level, title, note])); return { level, title, note };
      });
      collect = () => validateDraft("outline", { title: title.value, items: rows.map(row => ({ title: row.title.value, level: Number(row.level.value), note: row.note.value })) });
    } else {
      const title = el("input", { "aria-label": "Markdown 标题" }); title.value = draft.title;
      const editor = el("textarea", { class: "ms-ai-markdown-editor", "aria-label": "Markdown 预览正文", rows: 10 }); editor.value = draft.markdown + (sourceDocPath ? `\n\n[来源文档](<${sourceDocPath.split("/").map(encodeURIComponent).join("/")}>)` : "");
      filename = el("input", { "aria-label": "新 Markdown 文件名" }); filename.value = defaultMarkdownFilename(draft.title);
      content.append(title, editor, field("新笔记文件名", filename)); collect = () => validateDraft("markdown", { title: title.value, markdown: editor.value });
    }
    const save = el("button", { type: "button", class: "ms-ai-preview-save", text: draft.kind === "markdown" ? "另存为新笔记" : draft.kind === "cards" ? "保存卡片" : "保存目录" });
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const edited = collect();
        const saved = edited.kind === "markdown" ? { kind: edited.kind, path: await saveMarkdownDraft(host, edited, filename!.value) }
          : { kind: edited.kind, ids: saveLibraryDraft(host, edited, sourceDocPath) };
        resultStatus.textContent = edited.kind === "markdown" ? `已保存：${"path" in saved ? saved.path : ""}` : "已保存到当前学习集，可撤销。";
        save.textContent = "已保存";
        content.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select").forEach(control => control.disabled = true);
        try { options.onSaved?.(saved); } catch { /* A workspace refresh failure must not repeat a completed save. */ }
      } catch (error) { resultStatus.textContent = aiErrorText(error); save.disabled = false; }
    });
    box.append(content, el("div", { class: "ms-ai-preview-actions" }, [el("span", { text: draft.kind === "markdown" ? "保存前可编辑；同名文件不会覆盖。" : "保存到当前学习集；卡片不会自动加入复习。" }), save]), resultStatus);
    current.elements.push(box); empty.remove(); body.append(box); scrollBottom();
  };
  const stopReplySync = (announce = false) => {
    if (!replySubscription) return;
    replySubscription.dispose(); replySubscription = null; refresh();
    if (announce && !disposed) status.textContent = "已停止同步 Claudian 回复。";
  };
  const addAnswerActions = (message: HTMLElement, reply: string, sourceDocPath?: string) => {
    const branch = el("button", { type: "button", text: "回答转脑图分支" });
    branch.addEventListener("click", () => {
      try { const ids = saveAnswerBranch(host, reply, sourceDocPath); branch.disabled = true; options.onSaved?.({ kind: "outline", ids }); }
      catch { new Notice("转换失败，请检查回答内容后手动重试。"); }
    });
    message.append(branch);
    for (const [kind, label] of [["comment", "选段写评论"], ["title", "选段设标题"]] as const) {
      const button = el("button", { type: "button", text: label });
      button.addEventListener("mousedown", event => event.preventDefault());
      button.addEventListener("click", () => {
        const selection = document.getSelection();
        const text = selection && message.contains(selection.anchorNode) && message.contains(selection.focusNode) ? selection.toString() : "";
        try { writeAnswerSelection(host, options.getSelectedNodeId?.() ?? "", text, kind); options.onSaved?.({ kind: "outline" }); }
        catch { new Notice("请选择回答文字和一个脑图节点后手动重试。"); }
      });
      message.append(button);
    }
  };
  syncReplies.addEventListener("click", () => {
    if (replySubscription) { stopReplySync(true); return; }
    const sourceDocPath = context?.docPath;
    const subscription = subscribeClaudianReplies(host.app, raw => {
      if (disposed || suspended) return;
      const reply = raw.trim(); if (!reply) return;
      const replyMessage = addMessage("assistant", reply);
      if (task.value === "chat") {
        const preview = el("button", { type: "button", class: "ms-ai-response-to-card", text: "制作卡片预览" });
        preview.addEventListener("click", () => { if (preview.disabled) return; draftView({ kind: "cards", cards: [{ title: "", excerpt: reply, note: "", tags: [] }] }, sourceDocPath); preview.disabled = true; });
        replyMessage.append(preview);
        addAnswerActions(replyMessage, reply, sourceDocPath);
      } else {
        try { draftView(draftFromPastedReply(task.value as AiDraft["kind"], reply), sourceDocPath); }
        catch { status.textContent = "Claudian 回复已回流；内容未能解析为所选预览类型，请切换到 Ask 查看原文。"; }
      }
      if (!suspended) status.textContent = "Claudian 回复已自动回流到 MarginStudy。";
    }, () => { if (!disposed && !suspended) status.textContent = "未能读取这条 Claudian 回复；请检查当前会话后重试。"; });
    if (!subscription) { status.textContent = "无法连接 Claudian 回复事件。请确认 Claudian 2.3.30 已启用，再重试。"; return; }
    replySubscription = subscription;
    current = { label: "Claudian 自动回流", history: [], elements: [] }; sessions.push(current);
    drawer.hidden = true; input.value = ""; context = undefined; images = []; attachmentView(); showConversation();
    status.textContent = "已开始监听；下一条 Claudian 新回复会自动显示在此处，并锁定该会话。"; refresh();
  });
  const addImages = async (files: File[]) => {
    if (controller || disposed) return;
    if (provider === "claudian" && !supportsClaudianImages(host.app)) { status.textContent = "此 Claudian 版本尚未验证图片直连，请在 Claudian 中附加图片。"; return; }
    try {
      const next = [...images];
      for (const file of files) {
        if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 9 * 1024 * 1024) throw new AiError("image", "请选择 PNG、JPEG、WebP 或 GIF 图片，单张不超过 9 MB。" );
        if (next.length >= 4) throw new AiError("image", "最多附加 4 张图片。" );
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
        next.push(data);
      }
      if (next.reduce((sum, image) => sum + image.length, 0) > 12 * 1024 * 1024) throw new AiError("image", "图片总大小超过约 9 MB，请减少附加图片。" );
      if (!disposed) { images = next; attachmentView(); status.textContent = "图片已附加，点击 Send 后发送。"; }
    } catch (error) { if (!disposed) status.textContent = aiErrorText(error); }
  };
  const submit = async () => {
    if (controller) { controller.abort(); return; }
    if (provider === "claudian" && images.length && !supportsClaudianImages(host.app)) { status.textContent = "请先移除图片；Claudian 此处仅支持文字，图片请在 Claudian 中手动附加。"; return; }
    if (provider === "custom" && !service.isBound()) { openSettings(); return; }
    const typed = input.value, selectedTask = task.value as AiTask, selectedContext = context ? { ...context } : undefined, selectedImages = [...images];
    const prefixes: Record<string, string> = { guide: "请用引导式问题帮助我逐步理解当前材料。每次只问一个问题，等待我的回答后再继续，先不要直接给出完整答案。", explain: "请解释核心概念，并给出例子。", quiz: "请用问题帮助我检验理解，先不要展示答案。" };
    const text = [prefixes[template.value] ?? "", typed].filter(Boolean).join("\n");
    if (!text.trim() && !selectedContext?.text && !selectedImages.length) return;
    if(provider === "claudian" && !supportsClaudianRequest(host.app)){
      const prompt=buildClaudianPrompt({text,task:selectedTask,context:selectedContext});
      status.textContent="当前 Claudian 版本未验证直接调用，请使用手动提问。";openPromptFallback(prompt,status.textContent);return;
    }
    current.label = typed.trim().slice(0, 36) || selectedContext?.label || "图片与学习材料";
    addMessage("user", typed || (selectedTask === "cards" ? "生成卡片" : selectedTask === "outline" ? "生成目录" : selectedTask === "markdown" ? "识别为 Markdown" : "处理附加材料"));
    const reply = addMessage("assistant", ""), replyText = reply.querySelector<HTMLElement>(".ms-ai-message-text")!;
    if (selectedImages.length) reply.dataset.imageCount = String(selectedImages.length);
    input.value = ""; images = []; context = undefined; controller = new AbortController(); status.textContent = "正在生成…"; attachmentView(); refresh();
    try {
      const onText=(fragment:string)=>{if(!disposed&&!controller?.signal.aborted){replyText.textContent+=fragment;scrollBottom();}};
      const history=mode.value === "chat" && selectedTask === "chat" ? current.history : [];
      const result=provider === "claudian" ? await (async()=>{
        const previous=history.length?`本次 MarginStudy 对话上下文（JSON，仅供参考）：\n${JSON.stringify(history)}\n\n`:"";
        const output=await requestClaudian(host.app,previous+buildClaudianPrompt({text,task:selectedTask,context:selectedContext}),{signal:controller!.signal,onText,images:selectedImages});
        const drafts=selectedTask === "chat" || selectedTask === "condense"?[]:[draftFromPastedReply(selectedTask,output)];
        return {text:output,messages:[...history,{role:"user" as const,content:text},{role:"assistant" as const,content:output}],drafts};
      })():await service.request({text,task:selectedTask,tier,context:selectedContext,images:selectedImages,history,signal:controller.signal,onText});
      if (controller.signal.aborted) throw new AiError("cancelled", "已停止生成。");
      if (!disposed) {
        for (const draft of result.drafts) draftView(draft,selectedContext?.docPath);
        if (mode.value === "chat" && selectedTask === "chat") current.history = result.messages;
        if (!result.text) replyText.textContent = result.drafts.length ? "预览已准备好。请检查并保存。" : "未收到文本。";
        if (result.text && selectedTask === "chat") {
          const previewCard = el("button", { type: "button", class: "ms-ai-response-to-card", text: "制作卡片预览" });
          previewCard.addEventListener("click", () => { if (previewCard.disabled) return; draftView({ kind: "cards", cards: [{ title: "", excerpt: result.text, note: "", tags: [] }] }, selectedContext?.docPath); previewCard.disabled = true; }); reply.append(previewCard);
          addAnswerActions(reply, result.text, selectedContext?.docPath);
        }
        status.textContent = "";
      }
    } catch (error) { if (!disposed) { input.value = typed; images = selectedImages; context = selectedContext; attachmentView(); status.textContent = aiErrorText(error); if (!replyText.textContent) replyText.textContent = status.textContent; } }
    finally { controller = undefined; if (!disposed) { refresh(); if (!suspended) input.focus(); } }
  };
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(150, Math.max(36, input.scrollHeight)) + "px"; refresh(); });
  input.addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submit(); } });
  input.addEventListener("paste", event => { const files = [...(event.clipboardData?.files ?? [])]; if (files.length) { event.preventDefault(); void addImages(files); } });
  send.addEventListener("click", () => void submit()); settings.addEventListener("click", openSettings); connection.addEventListener("click", openSettings); down.addEventListener("click", scrollBottom);
  providerSelect.addEventListener("change", () => { provider = providerSelect.value === "claudian" ? "claudian" : "custom"; if (provider !== "claudian") stopReplySync(); status.textContent = provider === "claudian" ? images.length && !supportsClaudianImages(host.app) ? "请移除这里的图片，再在 Claudian 中附加。" : "直接使用 Claudian 已选模型，回复会显示在这里。" : ""; refresh(); });
  mini.addEventListener("click", () => { tier = "mini"; mini.setAttribute("aria-pressed", "true"); normal.setAttribute("aria-pressed", "false"); });
  normal.addEventListener("click", () => { tier = "normal"; mini.setAttribute("aria-pressed", "false"); normal.setAttribute("aria-pressed", "true"); });
  task.addEventListener("change", () => { if (task.value === "cards" || task.value === "outline") { tier = "normal"; mini.setAttribute("aria-pressed", "false"); normal.setAttribute("aria-pressed", "true"); } refresh(); });
  attachmentButton.addEventListener("click", () => { attachmentMenu.hidden = !attachmentMenu.hidden; });
  chooseImage.addEventListener("click", () => { attachmentMenu.hidden = true; imageInput.click(); });
  imageInput.addEventListener("change", () => { void addImages([...imageInput.files ?? []]); imageInput.value = ""; });
  pasteText.addEventListener("click", () => {
    attachmentMenu.hidden = true; settingClose?.();
    const { modal, close } = createModal("附加文字上下文", () => { settingClose = undefined; }); settingClose = close; modal.classList.add("ms-ai-text-context");
    const text = el("textarea", { rows: 10, "aria-label": "待发送的文字上下文", placeholder: "粘贴当前需要处理的文字" }); text.value = context?.text ?? "";
    const use = el("button", { type: "button", text: "附加文字" }); use.addEventListener("click", () => { context = text.value.trim() ? { text: text.value, label: "附加文字" } : undefined; attachmentView(); close(); }); modal.append(text, use);
  });
  pasteReply.addEventListener("click", () => {
    attachmentMenu.hidden = true; settingClose?.();
    const sourceDocPath = context?.docPath;
    const { modal, close } = createModal("粘贴 AI 回复", () => { settingClose = undefined; }); settingClose = close;
    modal.classList.add("ms-ai-bridge-modal");
    const kind = el("select", { "aria-label": "回复预览类型" }, [el("option", { value: "cards", text: "卡片" }), el("option", { value: "outline", text: "目录" }), el("option", { value: "markdown", text: "Markdown" })]); kind.value = task.value === "chat" ? "cards" : task.value;
    const text = el("textarea", { rows: 12, "aria-label": "粘贴的 AI 回复", placeholder: "粘贴你选择的回复。卡片可用 JSON 或整段正文；目录可用 JSON、Markdown 标题或列表。" });
    const hint = el("p", { role: "status", text: "只处理你粘贴的内容。先生成可编辑预览，再单独保存。" });
    const prepare = el("button", { type: "button", text: "生成可编辑预览" }), cancel = el("button", { type: "button", text: "取消" });
    prepare.addEventListener("click", () => { try { const draft = draftFromPastedReply(kind.value as AiDraft["kind"], text.value); draftView(draft, sourceDocPath); close(); } catch (error) { hint.textContent = aiErrorText(error); } });
    cancel.addEventListener("click", close); modal.append(kind, text, hint, el("div", { class: "ms-ai-bridge-actions" }, [cancel, prepare])); text.focus();
  });
  fromSelection.addEventListener("click", async () => {
    attachmentMenu.hidden = true;
    try { context = await options.getContext?.(); if (!disposed) { attachmentView(); status.textContent = context ? "当前选择已附加，点击 Send 后发送。" : "当前没有选中文字或卡片。"; } }
    catch { if (!disposed) status.textContent = "无法取得当前选择，请直接粘贴文字。"; }
  });
  newButton.addEventListener("click", () => { stopReplySync(); current = { label: "新对话", history: [], elements: [] }; sessions.push(current); drawer.hidden = true; input.value = ""; context = undefined; images = []; attachmentView(); showConversation(); });
  historyButton.addEventListener("click", () => {
    clear(drawer); drawer.hidden = !drawer.hidden;
    for (const session of [...sessions].reverse()) { const button = el("button", { type: "button", text: session.label }); button.addEventListener("click", () => { stopReplySync(); current = session; drawer.hidden = true; showConversation(); }); drawer.append(button); }
  });
  closeButton.addEventListener("click", () => { if (options.onClose) options.onClose(); else handle.dispose(); });
  const onDragOver = (event: DragEvent) => { if (event.dataTransfer) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; root.classList.add("ms-ai-dragover"); } };
  const onDrop = (event: DragEvent) => {
    event.preventDefault(); root.classList.remove("ms-ai-dragover"); if (controller || !event.dataTransfer) return;
    const files = [...event.dataTransfer.files]; if (files.length) { void addImages(files); return; }
    const plain = event.dataTransfer.getData("text/plain"); let cardIds: string[] = [];
    try { const board = JSON.parse(event.dataTransfer.getData("application/margin-study-board-cards")); if (Array.isArray(board.cardIds)) cardIds = board.cardIds.filter((id: unknown): id is string => typeof id === "string").slice(0, 100); } catch { /* Plain text remains supported. */ }
    if (!cardIds.length && host.store.getCard(plain.trim())) cardIds = [plain.trim()];
    const cards = cardIds.map(id => host.store.getCard(id)).filter((card): card is NonNullable<typeof card> => !!card);
    context = cards.length ? { label: `${cards.length} 张卡片`, docPath: cards.every(card => card.docPath === cards[0].docPath) ? cards[0].docPath : undefined,
      text: cards.map(card => [card.title, card.front, card.back].filter(Boolean).join("\n")).join("\n\n") } : plain ? { text: plain, label: "拖入文字" } : undefined;
    const attachedImages = cards.flatMap(card => [card.image, ...card.images ?? []]).filter((image): image is string => !!image && image.startsWith("data:image/"));
    if (attachedImages.length) images = attachedImages.slice(0, 4);
    attachmentView(); status.textContent = context ? "材料已附加，点击 Send 后发送。" : "请拖入文字、卡片或图片。";
  };
  root.addEventListener("dragover", onDragOver); root.addEventListener("drop", onDrop); root.addEventListener("dragleave", () => root.classList.remove("ms-ai-dragover"));
  const handle: AiPanelHandle = {
    focus: () => { if (!disposed && !suspended) input.focus(); }, setContext: next => { if (!disposed) { context = next; attachmentView(); } },
    suspend: () => { if (disposed || suspended) return; suspended = true; stopReplySync(); controller?.abort(); settingClose?.(); attachmentMenu.hidden = drawer.hidden = true; root.remove(); },
    resume: nextContainer => { if (disposed) return; suspended = false; nextContainer.append(root); refresh(); },
    dispose: () => { if (disposed) return; stopReplySync(); disposed = true; controller?.abort(); settingClose?.(); current.history = []; sessions.length = 0; images = []; context = undefined; root.remove(); },
  };
  showConversation(); attachmentView(); refresh(); return handle;
}
