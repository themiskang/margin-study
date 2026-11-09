import { Notice, TFile, requestUrl } from "obsidian";
import { Readability } from "@mozilla/readability";
import type MarginStudyPlugin from "../main";
import { sanitizeStaticHtml } from "../documents/content";
import { isStudyDocumentPath } from "../documents/formats";
import { DocumentCommitRollbackError } from "../model/store";
import { el } from "../utils/dom";
import { createModal } from "../utils/modal";
import { uid } from "../utils/id";

type ImportHost = Pick<MarginStudyPlugin, "app" | "store" | "openDocument">;
export interface WebImportInput {
  url?: string;
  /** Supplied markup takes precedence over fetching the URL. The URL still records its origin. */
  html?: string;
  title?: string;
  downloadImages?: boolean;
  /** Omitted uses the current study set; null explicitly leaves the document unfiled. */
  studySetId?: string | null;
  openAfterImport?: boolean;
}
export interface WebImportResult {
  file: TFile;
  title: string;
  sourceUrl?: string;
  imageCount: number;
  warnings: string[];
  opened: boolean;
}
export interface WebFetchResponse { status: number; headers: Record<string, string>; data: ArrayBuffer; }
export interface WebImportOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  /** A transport seam for deterministic fixtures. Production uses Obsidian's requestUrl. */
  fetch?: (url: string, kind: "page" | "image") => Promise<WebFetchResponse>;
  timeoutMs?: number;
}
export class WebImportError extends Error {
  constructor(message: string, public savedPath?: string) { super(message); this.name = "WebImportError"; }
}

const LIMITS = { html: 12 * 1024 * 1024, image: 12 * 1024 * 1024, images: 60, totalImages: 48 * 1024 * 1024 };
const PLACEHOLDER_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const DANGEROUS_ELEMENTS = "script,style,iframe,frame,frameset,object,embed,applet,link,meta,base,noscript,form,input,button,textarea,select,audio,video,source,track,canvas,svg,math";
const CHECK_PAGE = /环境异常|访问过于频繁|请完成验证|安全验证|验证码|请在微信客户端打开|请先登录|登录后查看|开启\s*JavaScript|enable\s+javascript|access denied|checking your browser|verify (?:you are|that you)|captcha/i;

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("导入已取消", "AbortError");
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function sourceUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new WebImportError("请输入完整的 http 或 https 网页地址。"); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new WebImportError("网页地址需使用 http 或 https，且不能包含登录凭据。");
  url.hash = "";
  return url.href;
}
function absoluteImage(reference: string, base?: string): string | undefined {
  if (/^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(reference)) return reference;
  try {
    const url = base ? new URL(reference, base) : new URL(reference);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
function header(headers: Record<string, string>, name: string): string {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? "";
}
async function defaultFetch(url: string, kind: "page" | "image"): Promise<WebFetchResponse> {
  const response = await requestUrl({ url, method: "GET", throw: false,
    headers: { Accept: kind === "page" ? "text/html,application/xhtml+xml;q=0.9" : "image/avif,image/webp,image/png,image/jpeg,image/gif" } });
  return { status: response.status, headers: response.headers, data: response.arrayBuffer };
}
async function fetchWithLimit(url: string, kind: "page" | "image", options: WebImportOptions): Promise<WebFetchResponse> {
  aborted(options.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(new DOMException("导入已取消", "AbortError"));
      options.signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => reject(new WebImportError(kind === "page" ? "网页读取超时，可改用粘贴 HTML。" : "图片读取超时。")), options.timeoutMs ?? 30_000);
    });
    const response = await Promise.race([(options.fetch ?? defaultFetch)(url, kind), cancelled]);
    aborted(options.signal);
    if (response.status < 200 || response.status >= 300) throw new WebImportError(`服务器返回 HTTP ${response.status}${kind === "page" ? "，可在浏览器打开后使用粘贴 HTML。" : "。"}`);
    if (response.data.byteLength > (kind === "page" ? LIMITS.html : LIMITS.image)) throw new WebImportError(kind === "page" ? "网页正文超过 12 MB，暂未导入。" : "图片超过 12 MB。");
    return response;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (cancel) options.signal?.removeEventListener("abort", cancel);
  }
}
function decodeHtml(response: WebFetchResponse): string {
  const contentType = header(response.headers, "content-type");
  if (contentType && !/html|xhtml|text\/plain/i.test(contentType)) throw new WebImportError("该地址返回的不是 HTML 网页，请使用原文章链接。");
  const declared = /charset\s*=\s*["']?([^\s;"'>]+)/i.exec(contentType)?.[1];
  const firstBytes = new TextDecoder("utf-8").decode(response.data.slice(0, 4096));
  const charset = declared ?? /<meta[^>]+charset\s*=\s*["']?([^\s;"'>]+)/i.exec(firstBytes)?.[1] ?? "utf-8";
  try { return new TextDecoder(charset).decode(response.data); }
  catch { return new TextDecoder("utf-8").decode(response.data); }
}

interface Article { title: string; html: string; images: Map<string, string | undefined>; }
/** Parse in an inert template, remove active resources before Readability sees a document. */
function extractArticle(html: string, origin: string | undefined, title: string | undefined, pasted: boolean): Article {
  if (new TextEncoder().encode(html).byteLength > LIMITS.html) throw new WebImportError("HTML 超过 12 MB，暂未导入。");
  const template = document.createElement("template"); template.innerHTML = html;
  const originalTitle = (template.content.querySelector("#activity-name") ?? template.content.querySelector("h1") ?? template.content.querySelector("title"))?.textContent?.trim() ?? "";
  template.content.querySelectorAll(DANGEROUS_ELEMENTS).forEach(node => node.remove());
  const images = new Map<string, string | undefined>();
  for (const node of template.content.querySelectorAll<HTMLElement>("*")) {
    for (const attr of [...node.attributes]) if (/^on/i.test(attr.name) || ["style", "srcdoc", "ping", "background"].includes(attr.name.toLowerCase())) node.removeAttribute(attr.name);
    if (node.localName === "img") {
      const candidate = ["data-src", "data-original", "data-lazy-src", "src"].map(name => node.getAttribute(name)).find(value => value && !value.startsWith("data:image/gif"))
        ?? node.getAttribute("srcset")?.split(",")[0]?.trim().split(/\s+/)[0] ?? node.getAttribute("src") ?? "";
      const key = `ms-import-image-${images.size + 1}`;
      images.set(key, absoluteImage(candidate, origin));
      node.id = key;
      for (const attr of [...node.attributes]) if (!(["id", "alt", "title", "width", "height"].includes(attr.name.toLowerCase()))) node.removeAttribute(attr.name);
      node.setAttribute("src", PLACEHOLDER_IMAGE);
    } else if (node.localName === "a") {
      const href = node.getAttribute("href");
      if (href && !href.startsWith("#") && origin) {
        try { node.setAttribute("href", new URL(href, origin).href); } catch { node.removeAttribute("href"); }
      }
    } else {
      // Even custom tags and CSS backgrounds never get an automatic remote source.
      for (const attr of ["src", "srcset", "poster", "href", "xlink:href"]) node.removeAttribute(attr);
    }
  }
  const doc = document.implementation.createHTMLDocument(originalTitle);
  template.content.querySelectorAll("title").forEach(node => node.remove());
  doc.body.append(template.content.cloneNode(true));
  const bodyText = doc.body.textContent?.trim() ?? "";
  const wechat = doc.querySelector<HTMLElement>("#js_content");
  if (!wechat && bodyText.length < 1500 && CHECK_PAGE.test(`${originalTitle}\n${bodyText}`)) throw new WebImportError("读到的是登录或验证页面，尚未取得文章正文。请在浏览器打开文章后粘贴 HTML。");
  let content: string | undefined;
  let articleTitle = title?.trim() || originalTitle;
  if (wechat && ((wechat.textContent?.trim().length ?? 0) > 0 || wechat.querySelector("img"))) content = wechat.innerHTML;
  else {
    const article = new Readability(doc.cloneNode(true) as Document, { charThreshold: 80, maxElemsToParse: 40_000, disableJSONLD: true }).parse();
    if (article?.content && ((article.textContent?.trim().length ?? 0) >= 40 || article.content.includes("<img"))) {
      content = article.content; articleTitle = title?.trim() || article.title?.trim() || originalTitle;
    } else {
      const semantic = doc.querySelector("article,main,[role='main']");
      if (semantic && ((semantic.textContent?.trim().length ?? 0) >= 40 || semantic.querySelector("img"))) content = semantic.innerHTML;
      else if (pasted && (bodyText.length > 0 || doc.querySelector("img"))) content = doc.body.innerHTML;
    }
  }
  if (!content) throw new WebImportError("未能提取文章正文，网页可能依赖登录或脚本。请改用粘贴 HTML。");
  return { title: articleTitle || (origin ? new URL(origin).hostname : "粘贴的网页"), html: content, images };
}
function imageExtension(bytes: Uint8Array): string | undefined {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  if (bytes.length >= 8 && bytes[0] === 137 && ascii(1, 3) === "PNG" && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return "png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(0, 6))) return "gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";
  if (bytes.length >= 16 && ascii(4, 4) === "ftyp" && /avif|avis/.test(ascii(8, 24))) return "avif";
  return undefined;
}
function dataImage(reference: string): ArrayBuffer {
  const encoded = reference.slice(reference.indexOf(",") + 1).replace(/\s/g, "");
  if (encoded.length > LIMITS.image * 1.4) throw new WebImportError("图片超过 12 MB。");
  const binary = atob(encoded), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
function escaped(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function filename(title: string): string {
  return title.replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").replace(/^\.+|[. ]+$/g, "").slice(0, 80).trim() || "网页";
}
async function ensureFolder(host: ImportHost, path: string): Promise<void> {
  const vault = host.app.vault;
  if (vault.getAbstractFileByPath(path) instanceof TFile) throw new WebImportError(`无法建立导入目录：${path} 已是文件。`);
  if (await vault.adapter.exists(path)) return;
  try { await vault.createFolder(path); }
  catch (error) { if (!(await vault.adapter.exists(path))) throw error; }
}

export type ImportConflictPolicy = "reject" | "reuse" | "rename";
export interface LocalImportOptions { studySetId?: string | null; conflict: ImportConflictPolicy; }

export async function importLocalDocuments(host: ImportHost, inputs: File[], options: LocalImportOptions): Promise<TFile[]> {
  if (!inputs.length) return [];
  const setId = options.studySetId === null ? undefined : options.studySetId ?? host.store.activeStudySetId;
  if (setId && !host.store.studySets.some(set => set.id === setId)) throw new Error("目标学习集已不存在。");
  if (!["reject", "reuse", "rename"].includes(options.conflict)) throw new Error("请选择同名文件处理方式。");
  const vault = host.app.vault, dir = "MarginStudyImports", reserved = new Set<string>();
  const planned: { path: string; input?: File; existing?: TFile }[] = [];
  for (const input of inputs) {
    if (!isStudyDocumentPath(input.name)) throw new Error("不支持的文件格式：" + input.name);
    const name = input.name.replace(/[\u0000-\u001f\\/:*?"<>|]/g, "_").replace(/^\.+|[. ]+$/g, "");
    if (!name || !isStudyDocumentPath(name)) throw new Error("无效的文件名：" + input.name);
    const dot = name.lastIndexOf("."), stem = name.slice(0, dot), extension = name.slice(dot);
    let path = `${dir}/${name}`, count = 1;
    while (reserved.has(path) || await vault.adapter.exists(path)) {
      if (options.conflict === "reject") throw new Error("目标已有同名文件，已拒绝覆盖：" + path);
      if (options.conflict === "reuse") {
        const existing = vault.getAbstractFileByPath(path);
        if (!(existing instanceof TFile)) throw new Error("同名目标不是可复用的既有文档：" + path);
        if (existing.stat.size >= 16) {
          const existingBytes = await vault.readBinary(existing);
          if (new TextDecoder().decode(existingBytes.slice(0, 16)) === "SQLite format 3\u0000") throw new Error("不复用数据库文件：" + path);
        }
        planned.push({ path, existing }); break;
      }
      path = `${dir}/${stem} (${count++})${extension}`;
    }
    if (!planned.some(item => item.path === path)) { reserved.add(path); planned.push({ path, input }); }
  }
  const created: { file: TFile; target: string }[] = [], files: TFile[] = [];
  let createdFolder = false, stagingPath: string | undefined;
  const removeStaging = async (path: string): Promise<void> => {
    if (!await vault.adapter.exists(path)) return;
    const staging = vault.getAbstractFileByPath(path);
    if (staging) await vault.delete(staging, true);
    else await vault.adapter.rmdir(path, true);
    if (await vault.adapter.exists(path)) throw new Error(`暂存目录仍然存在：${path}`);
  };
  const removeCreated = async ({ file, target }: { file: TFile; target: string }): Promise<void> => {
    if (file.path !== target) {
      if (await vault.adapter.exists(file.path)) {
        await vault.delete(file, true);
        if (await vault.adapter.exists(file.path)) throw new Error(`暂存文件仍然存在：${file.path}`);
      } else if (await vault.adapter.exists(target)) {
        throw new Error(`无法确认目标文件是否属于本次导入：${target}`);
      }
      return;
    }
    if (await vault.adapter.exists(target)) await vault.delete(file, true);
    if (await vault.adapter.exists(target)) throw new Error(`导入文件仍然存在：${target}`);
  };
  try {
    for (const input of inputs) {
      const signature = new TextDecoder().decode(await input.slice(0, 16).arrayBuffer());
      if (signature === "SQLite format 3\u0000") throw new Error("不导入数据库文件：" + input.name);
    }
    if (planned.some(item => item.input) && !await vault.adapter.exists(dir)) { await vault.createFolder(dir); createdFolder = true; }
    if (planned.some(item => item.input)) {
      let candidate: string;
      do { candidate = `${dir}/${uid("import")}`; } while (await vault.adapter.exists(candidate));
      stagingPath = candidate;
      try { await vault.createFolder(candidate); }
      catch (error) {
        if (message(error).toLowerCase().includes("already exists")) stagingPath = undefined;
        throw error;
      }
    }
    for (const item of planned) {
      if (item.existing) files.push(item.existing);
      else {
        const temporaryPath = `${stagingPath}/${item.path.split("/").pop()}`;
        const file = await vault.createBinary(temporaryPath, await item.input!.arrayBuffer());
        if (!(file instanceof TFile)) throw new Error(`无法创建暂存文件：${temporaryPath}`);
        if (await vault.adapter.exists(item.path)) throw new Error("目标已有同名文件，已拒绝覆盖：" + item.path);
        created.push({ file, target: item.path });
        await vault.rename(file, item.path);
        files.push(file);
      }
    }
    if (stagingPath) { await removeStaging(stagingPath); stagingPath = undefined; }
    await host.store.changeStudySetDocuments(setId, files.map(file => file.path), { mode: "append" });
    return files;
  } catch (error) {
    if (error instanceof DocumentCommitRollbackError) throw new Error(`${message(error)}；为避免删除可能已登记的来源，保留新文件：${created.map(item => item.file.path).join("、")}`);
    const failures: string[] = [];
    for (const item of created.reverse()) try { await removeCreated(item); } catch (cleanupError) { failures.push(`${item.target}（${message(cleanupError)}）`); }
    if (stagingPath) try { await removeStaging(stagingPath); } catch { failures.push(stagingPath); }
    if (createdFolder && !failures.length) {
      try {
        const contents = await vault.adapter.list(dir);
        if (!contents.files.length && !contents.folders.length) await removeStaging(dir);
      } catch { failures.push(dir); }
    }
    if (failures.length) throw new Error(`导入失败：${message(error)}；未能清理新建文件：${failures.join("、")}`);
    throw error;
  }
}

/** Fetch/extract first, write only local static content, then register and open the saved file. */
export async function importWebArticle(host: ImportHost, input: WebImportInput, options: WebImportOptions = {}): Promise<WebImportResult> {
  const origin = sourceUrl(input.url);
  const pasted = !!input.html?.trim();
  if (!pasted && !origin) throw new WebImportError("请输入网页地址，或粘贴网页 HTML。");
  const setId = input.studySetId === null ? undefined : input.studySetId ?? host.store.activeStudySetId;
  const targetSet = () => setId ? host.store.studySets.find(set => set.id === setId) : undefined;
  if (setId && !targetSet()) throw new WebImportError("目标学习集已不存在，请重新选择。");
  aborted(options.signal); options.onProgress?.(pasted ? "正在提取粘贴的正文…" : "正在读取网页…");
  const html = pasted ? input.html! : decodeHtml(await fetchWithLimit(origin!, "page", options));
  const article = extractArticle(html, origin, input.title, pasted);
  const content = document.createElement("template"); content.innerHTML = article.html;
  const imageFiles: { path: string; bytes: ArrayBuffer }[] = [];
  const downloaded = new Map<string, string>();
  const warnings: string[] = [];
  let total = 0;
  const images = [...content.content.querySelectorAll<HTMLImageElement>("img")];
  for (let i = 0; i < images.length; i++) {
    aborted(options.signal);
    const node = images[i], reference = article.images.get(node.id);
    node.removeAttribute("src"); node.removeAttribute("srcset");
    if (input.downloadImages === false) { node.setAttribute("alt", node.alt || "（图片未下载）"); continue; }
    try {
      if (!reference) throw new WebImportError("无法解析图片地址。");
      if (downloaded.has(reference)) { node.src = downloaded.get(reference)!; continue; }
      if (imageFiles.length >= LIMITS.images) throw new WebImportError("正文图片超过 60 张，其余图片未保存。");
      options.onProgress?.(`正在保存正文图片 ${i + 1}/${images.length}…`);
      const bytes = reference.startsWith("data:") ? dataImage(reference) : (await fetchWithLimit(reference, "image", options)).data;
      const extension = imageExtension(new Uint8Array(bytes));
      if (!extension) throw new WebImportError("图片不是受支持的静态图片格式。");
      if (total + bytes.byteLength > LIMITS.totalImages) throw new WebImportError("图片总计超过 48 MB，其余图片未保存。");
      const path = `assets/image-${String(imageFiles.length + 1).padStart(3, "0")}.${extension}`;
      total += bytes.byteLength; imageFiles.push({ path, bytes }); downloaded.set(reference, path); node.setAttribute("src", path);
    } catch (error) {
      aborted(options.signal);
      warnings.push(`第 ${i + 1} 张图片未保存：${message(error)}`); node.setAttribute("alt", node.alt || "（图片保存失败）");
    }
  }
  if (input.downloadImages === false && images.length) warnings.push(`${images.length} 张正文图片未下载。`);
  const permittedImages = new Set(imageFiles.map(file => file.path));
  const body = sanitizeStaticHtml(content.innerHTML, "article.html", reference => permittedImages.has(reference) ? reference : undefined);
  const probe = document.createElement("template"); probe.innerHTML = body;
  if (!(probe.content.textContent?.trim()) && !probe.content.querySelector("img[src]")) throw new WebImportError("提取结果没有可保存的正文或图片，暂未创建文档。");
  const folder = `MarginStudyImports/${filename(article.title)}-${uid("web")}`;
  const path = `${folder}/${filename(article.title)}.html`;
  const documentHtml = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escaped(article.title)}</title></head><body><article><h1>${escaped(article.title)}</h1>${origin ? `<p><a href="${escaped(origin)}" target="_blank" rel="noopener noreferrer">原文链接</a></p>` : ""}${body}</article></body></html>`;
  let created = false;
  let file: TFile;
  try {
    aborted(options.signal); if (setId && !targetSet()) throw new WebImportError("目标学习集已不存在，请重新选择。");
    options.onProgress?.("正在保存本地文档…");
    await ensureFolder(host, "MarginStudyImports");
    await host.app.vault.createFolder(folder); created = true;
    if (imageFiles.length) await host.app.vault.createFolder(`${folder}/assets`);
    for (const image of imageFiles) { aborted(options.signal); await host.app.vault.createBinary(`${folder}/${image.path}`, image.bytes); }
    aborted(options.signal); file = await host.app.vault.create(path, documentHtml);
    aborted(options.signal); if (setId && !targetSet()) throw new WebImportError("目标学习集已不存在，本次导入已取消。");
    await host.store.changeStudySetDocuments(setId, [file.path], { mode: "append", sourceUrls: origin ? { [file.path]: origin } : undefined });
  } catch (error) {
    if (error instanceof DocumentCommitRollbackError) throw new WebImportError(`${message(error)}；为避免删除可能已登记的来源，保留导入目录 ${folder}。`, folder);
    if (created) {
      const owned = host.app.vault.getAbstractFileByPath(folder);
      try { if (owned) await host.app.vault.delete(owned, true); }
      catch { throw new WebImportError(`导入失败：${message(error)}。未完成的文件保留在 ${folder}。`, folder); }
    }
    throw error;
  }
  let opened = false;
  if (input.openAfterImport !== false && !options.signal?.aborted) {
    options.onProgress?.("正在打开文档…");
    try { await host.openDocument(file); opened = true; }
    catch (error) { warnings.push(`已保存，但未能打开：${message(error)}`); }
  }
  return { file, title: article.title, sourceUrl: origin, imageCount: imageFiles.length, warnings, opened };
}

/** Public command entry point. A failed fetch leaves this form available for pasted HTML. */
export function openWebImport(host: ImportHost): void {
  const controller = new AbortController();
  const { modal, close } = createModal("导入网页或微信文章", () => controller.abort());
  modal.classList.add("ms-web-import");
  const url = el("input", { type: "url", class: "ms-search", placeholder: "https://…", "aria-label": "文章网址" });
  const title = el("input", { type: "text", class: "ms-search", placeholder: "留空使用文章标题", "aria-label": "文档标题" });
  const pasted = el("textarea", { class: "ms-search", placeholder: "无法抓取时，可在这里粘贴网页 HTML。", "aria-label": "粘贴网页 HTML" });
  const set = el("select", { class: "ms-select", "aria-label": "导入到学习集" });
  set.append(el("option", { value: "", text: "不加入学习集" }));
  for (const studySet of host.store.studySets) set.append(el("option", { value: studySet.id, text: studySet.name }));
  set.value = host.store.activeStudySetId ?? "";
  const images = el("input", { type: "checkbox" }); images.checked = true;
  const imagesLabel = el("label", { class: "ms-web-import-check" }); imagesLabel.append(images, document.createTextNode("下载正文图片，供离线阅读"));
  const status = el("div", { class: "ms-web-import-status", role: "status", "aria-live": "polite" });
  const cancel = el("button", { class: "ms-btn", text: "取消" }); cancel.addEventListener("click", close);
  const submit = el("button", { class: "ms-btn primary", text: "导入并打开" });
  let finished = false;
  const field = (text: string, input: HTMLElement) => { const label = el("label", { class: "ms-web-import-field" }); label.append(document.createTextNode(text), input); return label; };
  const fallback = el("details", { class: "ms-web-import-fallback" }); fallback.append(el("summary", { text: "粘贴 HTML 备用入口" }), field("网页 HTML", pasted));
  const actions = el("div", { class: "ms-modal-actions" }); actions.append(cancel, submit);
  modal.append(field("文章网址", url), field("文档标题", title), field("导入到学习集", set), imagesLabel, fallback, status, actions);
  submit.addEventListener("click", () => {
    if (finished) { close(); return; }
    if (submit.disabled) return;
    submit.disabled = true; status.classList.remove("is-error");
    for (const control of [url, title, pasted, set, images]) control.disabled = true;
    void importWebArticle(host, { url: url.value, title: title.value, html: pasted.value, downloadImages: images.checked, studySetId: set.value || null }, {
      signal: controller.signal, onProgress: text => status.textContent = text,
    }).then(result => {
      if (controller.signal.aborted) return;
      if (result.warnings.length || !result.opened) {
        status.textContent = `已保存：${result.file.path}\n${result.warnings.join("\n")}`;
        finished = true; submit.textContent = "完成"; submit.disabled = false;
        new Notice(result.opened ? "文章已导入，部分内容需查看导入提示" : "文章已保存，未能自动打开，请查看导入提示");
      } else { new Notice(`已导入「${result.title}」`); close(); }
    }).catch(error => {
      if (controller.signal.aborted) return;
      status.classList.add("is-error"); status.textContent = message(error); fallback.open = true; submit.disabled = false;
      for (const control of [url, title, pasted, set, images]) control.disabled = false;
    });
  });
  url.focus();
}
