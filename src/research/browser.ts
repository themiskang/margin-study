import { Menu, Notice, TFile, setIcon } from "obsidian";
import type MarginStudyPlugin from "../main";
import { el } from "../utils/dom";
import { createModal } from "../utils/modal";
import { RESEARCH_MODES, engineSearchUrl, researchPreferences, researchUrl, validateEngine } from "./contracts";
import type { ResearchEngine, ResearchMode, ResearchPreferences } from "./contracts";

/** Electron's documented webview methods; the guest never receives Node or vault access. */
interface ResearchWebview extends HTMLElement {
  src: string;
  executeJavaScript(code: string): Promise<unknown>;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  printToPDF(options: Record<string, unknown>): Promise<Uint8Array>;
}
export interface ResearchPort {
  element: HTMLElement;
  navigate(url: string): void;
  back(): void;
  forward(): void;
  reload(): void;
  canBack(): boolean;
  canForward(): boolean;
  url(): string;
  title(): string;
  pdf(): Promise<Uint8Array>;
  dispose(): void;
}
export function desktopResearchPort(ownerDocument: Document = document): ResearchPort {
  const guest = ownerDocument.createElement("webview") as ResearchWebview;
  guest.className = "ms-research-webview";
  guest.setAttribute("partition", "persist:marginstudy-research");
  guest.setAttribute("aria-label", "研究网页");
  // Search results commonly target a new tab. Obsidian owns the main process,
  // so keep ordinary HTTP links in this guest without granting popup privileges.
  const routeLinks = () => { void guest.executeJavaScript(`(() => {
    if (window.__marginStudyLinks) return;
    window.__marginStudyLinks = true;
    document.addEventListener('click', event => {
      const anchor = event.composedPath().find(node => node instanceof HTMLAnchorElement);
      if (!anchor || anchor.download || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const target = anchor.target || document.querySelector('base')?.target;
      if (!target || target === '_self') return;
      const url = new URL(anchor.href, location.href);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return;
      event.preventDefault(); event.stopImmediatePropagation(); location.assign(url.href);
    }, true);
  })()` ).catch(() => { /* Sites may restrict script execution; context menu remains available. */ }); };
  guest.addEventListener("dom-ready", routeLinks);
  const safe = <T>(read: () => T, fallback: T) => { try { return read(); } catch { return fallback; } };
  return {
    element: guest,
    navigate: url => { guest.src = researchUrl(url); },
    back: () => { if (safe(() => guest.canGoBack(), false)) guest.goBack(); },
    forward: () => { if (safe(() => guest.canGoForward(), false)) guest.goForward(); },
    reload: () => guest.reload(),
    canBack: () => safe(() => guest.canGoBack(), false), canForward: () => safe(() => guest.canGoForward(), false),
    url: () => safe(() => guest.getURL(), ""), title: () => safe(() => guest.getTitle(), ""),
    pdf: async () => {
      if (typeof guest.printToPDF !== "function") throw new Error("当前桌面环境不支持网页转 PDF，可先导入网页正文。");
      return guest.printToPDF({ printBackground: true, pageSize: "A4", preferCSSPageSize: true });
    },
    dispose: () => { guest.removeEventListener("dom-ready", routeLinks); guest.remove(); },
  };
}

export async function saveResearchPdf(plugin: MarginStudyPlugin, port: ResearchPort, studySetId = plugin.store.activeStudySetId): Promise<TFile> {
  const title = (port.title() || "Web Page").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").slice(0, 100) || "Web Page";
  const sourceUrl = researchUrl(port.url());
  const bytes = await port.pdf();
  if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("网页尚未生成有效的 PDF，请等页面载入后重试。");
  const folder = "WebDownloads";
  if (!await plugin.app.vault.adapter.exists(folder)) await plugin.app.vault.createFolder(folder);
  let path = `${folder}/${title}.pdf`, suffix = 2;
  while (await plugin.app.vault.adapter.exists(path)) path = `${folder}/${title} ${suffix++}.pdf`;
  const file = await plugin.app.vault.createBinary(path, bytes.slice().buffer as ArrayBuffer);
  plugin.store.registerDocument(file.path, sourceUrl);
  const set = plugin.store.studySets.find(set => set.id === studySetId);
  if (set) plugin.store.updateStudySet(set.id, { docPaths: [...new Set([...set.docPaths, file.path])] });
  plugin.store.save(); await plugin.store.flush(); return file;
}

export interface ResearchSession { entries: string[]; index: number; term: string; }
export function researchSession(value?: Partial<ResearchSession>): ResearchSession {
  const raw = Array.isArray(value?.entries) ? value.entries : [];
  const valid = raw.length <= 100 && raw.every(url => { try { return typeof url === "string" && !!researchUrl(url); } catch { return false; } });
  const entries = valid ? [...raw] : [];
  return { entries, index: entries.length ? Math.max(0, Math.min(entries.length - 1, Number.isInteger(value?.index) ? value!.index! : entries.length - 1)) : -1, term: typeof value?.term === "string" ? value.term.slice(0, 4000) : "" };
}
export interface ResearchOptions {
  session?: ResearchSession;
  onSessionChanged?: (session: ResearchSession) => void;
  initialUrl?: string;
  selection?: { text: string; at: number };
  selectionRoot?: HTMLElement;
  onClose?: () => void;
  onNewWindow?: (url: string) => void;
  onPdfSaved?: (file: TFile) => void;
  /** Only synthetic acceptance supplies a port. */
  port?: ResearchPort;
}
export interface ResearchHandle {
  dispose(): void;
  focus(): void;
  navigate(url: string): void;
  setSelection(text: string, at?: number): void;
  search(text: string): void;
  currentUrl(): string;
  session(): ResearchSession;
}
function button(icon: string, label: string, action: () => void): HTMLButtonElement {
  const node = el("button", { type: "button", class: "ms-research-icon", title: label, "aria-label": label });
  setIcon(node, icon); node.addEventListener("click", action); return node;
}
export function mountResearchBrowser(container: HTMLElement, plugin: MarginStudyPlugin, options: ResearchOptions = {}): ResearchHandle {
  let prefs = researchPreferences(plugin.store.settings.research), disposed = false, current = "", term = "", busy = false, loaded = false;
  const session = researchSession(options.session); term = session.term;
  const nativeHistory = session.entries.length === 0;
  let restoring = session.entries[session.index] ?? "";
  const ownerDocument = container.ownerDocument;
  let closeDialog: (() => void) | undefined;
  const port = options.port ?? desktopResearchPort(ownerDocument);
  const root = el("section", { class: "ms-research-panel", "aria-label": "研究浏览器" });
  const header = el("header", { class: "ms-research-header" });
  const mode = el("select", { "aria-label": "研究搜索类型" }), engine = el("select", { "aria-label": "研究搜索引擎" });
  header.append(mode, engine, button("x", "关闭研究浏览器", () => options.onClose?.()));
  const content = el("div", { class: "ms-research-content" });
  const empty = el("form", { class: "ms-research-start", "aria-label": "开始研究搜索" });
  const query = el("input", { type: "search", placeholder: "Search", "aria-label": "研究搜索内容" });
  const submit = el("button", { type: "submit", text: "Search", class: "ms-research-search" });
  empty.append(query, submit, el("p", { text: "选中文字后打开研究浏览器，或在此输入关键词。" }));
  content.append(empty, port.element); port.element.hidden = true;
  const status = el("div", { class: "ms-research-status", role: "status", "aria-live": "polite" }); status.hidden = true;
  const footer = el("footer", { class: "ms-research-footer" });
  const back = button("undo-2", "研究网页后退", () => travel(-1)), forward = button("redo-2", "研究网页前进", () => travel(1));
  const save = button("download", "将网页转为 PDF", () => { void exportPdf(); });
  const share = button("share", "研究网页操作", () => showActions());
  const lock = button(prefs.locked ? "lock-keyhole" : "lock-keyhole-open", "锁定研究内容", () => {
    prefs.locked = !prefs.locked; persist(); renderLock();
  });
  footer.append(back, forward, save, share, lock); root.append(header, content, status, footer); container.append(root);
  const persist = () => { plugin.store.settings.research = structuredClone(prefs); plugin.store.save(); };
  const showStatus = (message: string) => { status.textContent = message; status.hidden = !message; };
  const renderLock = () => { setIcon(lock, prefs.locked ? "lock-keyhole" : "lock-keyhole-open"); lock.setAttribute("aria-pressed", String(prefs.locked)); lock.title = prefs.locked ? "解锁并同步选中文字" : "锁定研究内容"; };
  const drawChoices = () => {
    mode.replaceChildren(...prefs.order.map(id => el("option", { value: id, text: RESEARCH_MODES.find(item => item.id === id)!.label }))); mode.value = prefs.mode;
    engine.replaceChildren(...prefs.engines.filter(item => item.mode === prefs.mode).map(item => el("option", { value: item.id, text: item.name })), el("option", { value: "__settings__", text: "Customize…" }));
    engine.value = prefs.selected[prefs.mode]!;
  };
  const updateNavigation = (readUrl = true) => {
    if (disposed) return;
    const navigated = readUrl ? port.url() : ""; if (navigated && /^https?:/i.test(navigated)) current = navigated;
    back.disabled = session.index <= 0; forward.disabled = session.index >= session.entries.length - 1; save.disabled = busy || !loaded || !current; share.disabled = !current;
  };
  const navigate = (url: string) => {
    try { const target = researchUrl(url); current = target; loaded = false; empty.hidden = true; port.element.hidden = false; showStatus(""); port.navigate(target); updateNavigation(false); }
    catch (error) { showStatus(String(error instanceof Error ? error.message : error)); }
  };
  function travel(delta: number): void {
    const index = session.index + delta;
    if (index < 0 || index >= session.entries.length) return;
    session.index = index; restoring = session.entries[index];
    if (nativeHistory && delta < 0 && port.canBack()) port.back();
    else if (nativeHistory && delta > 0 && port.canForward()) port.forward();
    else navigate(restoring);
  }
  const recordNavigation = (event?: Event) => {
    const eventUrl = (event as Event & { url?: string } | undefined)?.url;
    if (eventUrl && /^https?:/i.test(eventUrl)) current = eventUrl;
    updateNavigation(!eventUrl); if (!current) return;
    if (restoring) { session.entries[session.index] = current; }
    else if (session.entries[session.index] !== current) {
      session.entries = session.entries.slice(0, session.index + 1); session.entries.push(current);
      if (session.entries.length > 100) session.entries.shift();
      session.index = session.entries.length - 1;
    }
    updateNavigation(false);
    options.onSessionChanged?.({ entries: [...session.entries], index: session.index, term });
  };
  const search = (text: string) => {
    const selected = prefs.engines.find(item => item.id === prefs.selected[prefs.mode] && item.mode === prefs.mode);
    if (!selected || !text.trim()) return;
    term = text.trim(); query.value = term;
    try { navigate(engineSearchUrl(selected, term)); } catch (error) { showStatus(String(error)); }
  };
  const selectText = (text: string, at = Date.now()) => { if (!disposed && !prefs.locked && text.trim() && Date.now() - at <= 5_000) search(text.slice(0, 4000)); };
  const captureSelection = () => {
    const selection = ownerDocument.getSelection();
    if (!selection?.rangeCount || !options.selectionRoot?.contains(selection.anchorNode) || !options.selectionRoot.contains(selection.focusNode)) return;
    const target = selection.anchorNode?.parentElement;
    if (target?.closest("input,textarea,[contenteditable=true],.ms-research-panel,.ms-ai-panel")) return;
    if (selection.toString().trim() && selection.toString().trim() !== term) selectText(selection.toString());
  };
  const navigateDone = () => { recordNavigation(); restoring = ""; loaded = true; showStatus(""); updateNavigation(); };
  const loading = () => { root.setAttribute("aria-busy", "true"); };
  const stopped = () => { root.setAttribute("aria-busy", "false"); recordNavigation(); restoring = ""; updateNavigation(); };
  const failed = (event: Event) => {
    const failure = event as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean };
    if (failure.errorCode === -3 || failure.isMainFrame === false) return;
    loaded = false; showStatus("网页未能载入，可重试或在外部浏览器打开。"); updateNavigation();
  };
  async function exportPdf(): Promise<void> {
    if (busy || !loaded || !current) return; busy = true; updateNavigation(); showStatus("正在转存 PDF…");
    const setId = plugin.store.activeStudySetId;
    try { const file = await saveResearchPdf(plugin, port, setId); if (!disposed) { showStatus(`已保存：${file.path}`); options.onPdfSaved?.(file); } }
    catch (error) { if (!disposed) showStatus(error instanceof Error ? error.message : String(error)); }
    finally { busy = false; updateNavigation(); }
  }
  async function copyLink(url = current): Promise<void> {
    try { await navigator.clipboard.writeText(researchUrl(url)); showStatus("已复制链接。"); }
    catch { showStatus("未能复制链接，请在地址面板中手动复制。"); }
  }
  function showActions(): void {
    const menu = new Menu();
    menu.addItem(item => item.setTitle("搜索或输入网址…").setIcon("search").onClick(() => {
      closeDialog?.();
      const { modal, close } = createModal("Research", () => { closeDialog = undefined; }, ownerDocument); closeDialog = close;
      const input = el("input", { type: "text", "aria-label": "研究关键词或网址", placeholder: "Search or URL" }); input.value = term || current;
      const go = el("button", { text: "Open" }); go.addEventListener("click", () => { /^https?:\/\//i.test(input.value) ? navigate(input.value) : search(input.value); close(); });
      input.addEventListener("keydown", event => { if (event.key === "Enter") go.click(); }); modal.append(input, go); input.focus();
    }));
    menu.addItem(item => item.setTitle("重新载入").setIcon("refresh-cw").onClick(() => port.reload()));
    menu.addItem(item => item.setTitle("复制链接").setIcon("link").onClick(() => { void copyLink(); }));
    menu.addItem(item => item.setTitle("在外部浏览器打开").setIcon("external-link").onClick(() => { if (current) window.open(researchUrl(current)); }));
    if (options.onNewWindow) menu.addItem(item => item.setTitle("在独立研究窗口中打开").setIcon("app-window").onClick(() => options.onNewWindow?.(current)));
    menu.addSeparator();
    menu.addItem(item => item.setTitle("搜索引擎与顺序…").setIcon("settings-2").onClick(() => { closeDialog?.(); closeDialog = openResearchSettings(plugin, () => { prefs = researchPreferences(plugin.store.settings.research); drawChoices(); renderLock(); }, ownerDocument); }));
    const rect = share.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.top });
  }
  const contextMenu = (event: Event) => {
    const params = (event as Event & { params?: { linkURL?: string } }).params;
    if (!params?.linkURL) return; let url: string; try { url = researchUrl(params.linkURL); } catch { return; }
    const menu = new Menu();
    menu.addItem(item => item.setTitle("在此研究页面打开").onClick(() => navigate(url)));
    menu.addItem(item => item.setTitle("复制链接").onClick(() => { void copyLink(url); }));
    menu.addItem(item => item.setTitle("在外部浏览器打开").onClick(() => window.open(url)));
    if (options.onNewWindow) menu.addItem(item => item.setTitle("在独立研究窗口中打开").onClick(() => options.onNewWindow?.(url)));
    const rect = content.getBoundingClientRect(); menu.showAtPosition({ x: rect.left + 20, y: rect.top + 20 });
  };
  mode.addEventListener("change", () => { prefs.mode = mode.value as ResearchMode; persist(); drawChoices(); if (term) search(term); });
  engine.addEventListener("change", () => {
    if (engine.value === "__settings__") { engine.value = prefs.selected[prefs.mode]!; closeDialog?.(); closeDialog = openResearchSettings(plugin, () => { prefs = researchPreferences(plugin.store.settings.research); drawChoices(); }, ownerDocument); return; }
    prefs.selected[prefs.mode] = engine.value; persist(); if (term) search(term);
  });
  empty.addEventListener("submit", event => { event.preventDefault(); /^https?:\/\//i.test(query.value) ? navigate(query.value) : search(query.value); });
  const events: [string, EventListener][] = [["dom-ready", navigateDone], ["did-navigate", recordNavigation], ["did-navigate-in-page", recordNavigation], ["did-start-loading", loading], ["did-stop-loading", stopped], ["did-fail-load", failed], ["context-menu", contextMenu]];
  for (const [name, callback] of events) port.element.addEventListener(name, callback);
  ownerDocument.addEventListener("pointerup", captureSelection); ownerDocument.addEventListener("keyup", captureSelection);
  drawChoices(); renderLock(); updateNavigation();
  if (restoring) navigate(restoring); else if (options.initialUrl) navigate(options.initialUrl); else if (options.selection) selectText(options.selection.text, options.selection.at);
  return {
    dispose: () => { if (disposed) return; disposed = true; for (const [name, callback] of events) port.element.removeEventListener(name, callback); ownerDocument.removeEventListener("pointerup", captureSelection); ownerDocument.removeEventListener("keyup", captureSelection); closeDialog?.(); port.dispose(); root.remove(); },
    focus: () => { if (!current) query.focus(); else port.element.focus(); }, navigate, setSelection: selectText, search, currentUrl: () => current, session: () => ({ entries: [...session.entries], index: session.index, term }),
  };
}

export function openResearchSettings(plugin: MarginStudyPlugin, onSaved?: () => void, ownerDocument: Document = document): () => void {
  let prefs = researchPreferences(plugin.store.settings.research);
  const { modal, close } = createModal("Research", undefined, ownerDocument);
  modal.classList.add("ms-research-settings");
  const closeButton=el("button", {text:"Close",class:"ms-research-settings-close","aria-label":"关闭研究设置"});closeButton.addEventListener("click",close);modal.prepend(closeButton);
  const choices=el("div",{class:"ms-research-choices","aria-label":"研究搜索引擎设置"});
  const editor=el("div",{class:"ms-research-editor"});editor.hidden=true;
  const edit=el("button",{text:"Custom URL · 搜索引擎与顺序…",class:"ms-research-edit-link","aria-label":"编辑搜索引擎与顺序"});
  const drawChoices=()=>{
    choices.replaceChildren();
    const ids=["dictionary",...prefs.order.filter(id=>id!=="dictionary")] as ResearchMode[];
    for(const id of ids){
      const group=el("section",{class:"ms-research-choice-group",role:"radiogroup","aria-label":RESEARCH_MODES.find(mode=>mode.id===id)!.label});
      group.append(el("h4",{text:RESEARCH_MODES.find(mode=>mode.id===id)!.label}));
      for(const engine of prefs.engines.filter(engine=>engine.mode===id)){
        const selected=prefs.selected[id]===engine.id;
        const row=el("button",{class:"ms-research-choice",role:"radio","aria-label":"选择研究引擎 "+engine.id,"aria-checked":String(selected)});
        row.append(el("span",{text:engine.name}),el("span",{text:selected?"✓":"",class:"ms-research-choice-check","aria-hidden":"true"}));
        row.addEventListener("click",()=>{prefs.selected[id]=engine.id;plugin.store.settings.research=structuredClone(prefs);plugin.store.save();drawChoices();onSaved?.();});group.append(row);
      }
      choices.append(group);
    }
  };
  edit.addEventListener("click",()=>{const show=editor.hidden;editor.hidden=!show;choices.hidden=show;edit.textContent=show?"‹ Research":"Custom URL · 搜索引擎与顺序…";if(!show){prefs=researchPreferences(plugin.store.settings.research);draw();drawChoices();}});
  const order = el("div", { class: "ms-research-order" });
  const draw = () => {
    order.replaceChildren();
    for (const [index, id] of prefs.order.entries()) {
      const row = el("div", { class: "ms-research-engine-row" });
      const up = button("chevron-up", "上移 " + id, () => { [prefs.order[index - 1], prefs.order[index]] = [prefs.order[index], prefs.order[index - 1]]; draw(); }); up.disabled = index === 0;
      const down = button("chevron-down", "下移 " + id, () => { [prefs.order[index + 1], prefs.order[index]] = [prefs.order[index], prefs.order[index + 1]]; draw(); }); down.disabled = index === prefs.order.length - 1;
      row.append(el("strong", { text: RESEARCH_MODES.find(mode => mode.id === id)!.label }), up, down); order.append(row);
      for (const item of prefs.engines.filter(engine => engine.mode === id)) {
        const fields = el("div", { class: "ms-research-engine-fields" });
        const name = el("input", { type: "text", "aria-label": item.id + " 名称" }), url = el("input", { type: "text", "aria-label": item.id + " 搜索网址" }); name.value = item.name; url.value = item.url;
        name.addEventListener("input", () => { item.name = name.value; }); url.addEventListener("input", () => { item.url = url.value; }); fields.append(name, url); order.append(fields);
      }
      const add = el("button", { text: "＋ Custom URL", class: "ms-research-add-engine" }); add.addEventListener("click", () => { prefs.engines.push({ id: "custom-" + crypto.randomUUID(), mode: id, name: "Custom", url: "https://www.bing.com/search?q=%s" }); draw(); }); order.append(add);
    }
  }; draw();
  const error = el("p", { role: "status", class: "ms-research-settings-error" });
  const save = el("button", { text: "Save", class: "ms-research-search" }); save.addEventListener("click", () => {
    try { prefs.engines = prefs.engines.map(validateEngine); plugin.store.settings.research = prefs; plugin.store.save(); close(); onSaved?.(); }
    catch (failure) { error.textContent = failure instanceof Error ? failure.message : String(failure); }
  });
  editor.append(el("p", { text: "用 %s 表示搜索关键词。可调整工具顺序和各类搜索引擎。" }), order, error, save);
  drawChoices();modal.append(edit,choices,editor);
  return close;
}
