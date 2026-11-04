import { sanitizeHTMLToDom } from "obsidian";
import { Unzip, UnzipInflate, strFromU8 } from "fflate";

export interface DocumentTarget { path: string; fragment: string; }
export interface DocumentTocEntry { title: string; target: DocumentTarget; depth: number; }
export interface StaticDocument {
  title: string;
  html: string;
  toc: DocumentTocEntry[];
  dispose(): void;
}

export const EPUB_LIMITS = { archive: 128 * 1024 * 1024, entry: 24 * 1024 * 1024,
  expanded: 96 * 1024 * 1024, markup: 24 * 1024 * 1024, files: 4096, chapters: 512 };

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("文档加载已取消", "AbortError");
}

/** URI references are normalized inside the document root, never against the OS. */
export function resolveDocumentTarget(base: string, reference: string): DocumentTarget | null {
  if (/^[\s]*[a-z][a-z\d+.-]*:|^[\s]*\/\//i.test(reference)) return null;
  const hash = reference.indexOf("#");
  let path: string;
  let fragment: string;
  try {
    path = decodeURIComponent((hash < 0 ? reference : reference.slice(0, hash)).split("?")[0]);
    fragment = hash < 0 ? "" : decodeURIComponent(reference.slice(hash + 1));
  } catch { return null; }
  if (/[\u0000-\u001f\\:]/.test(path) || path.startsWith("/") || fragment.includes("\u0000")) return null;
  if (!path) return { path: base, fragment };
  const parts = base.split("/").slice(0, -1);
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  return parts.length ? { path: parts.join("/"), fragment } : null;
}

function archivePath(path: string): string {
  if (!path || path.length > 512 || /[\u0000-\u001f\\:]/.test(path) || path.startsWith("/") ||
    path.split("/").some((part) => part === ".." || part === ".")) throw new Error("EPUB 包含不安全的资源路径");
  return path;
}

/** Stream in small input chunks so a false ZIP size cannot cause unbounded inflation. */
export async function unpackEpub(data: ArrayBuffer, signal?: AbortSignal): Promise<Map<string, Uint8Array>> {
  if (data.byteLength > EPUB_LIMITS.archive) throw new Error("EPUB 压缩文件超过 128 MB 限制");
  const entries = new Map<string, Uint8Array>();
  const names = new Set<string>();
  let total = 0;
  let pending = 0;
  const unzip = new Unzip((file) => {
    cancelled(signal);
    const name = archivePath(file.name);
    if (names.has(name)) throw new Error("EPUB 存在重复资源路径");
    names.add(name);
    if (names.size > EPUB_LIMITS.files) throw new Error("EPUB 资源数量超过 4096 个");
    if ((file.originalSize ?? 0) > EPUB_LIMITS.entry) throw new Error("EPUB 单个资源超过 24 MB 限制");
    const chunks: Uint8Array[] = [];
    let size = 0;
    pending++;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      cancelled(signal);
      size += chunk.length;
      total += chunk.length;
      if (size > EPUB_LIMITS.entry || total > EPUB_LIMITS.expanded) {
        file.terminate();
        throw new Error("EPUB 展开体积超过限制（单项 24 MB / 总计 96 MB）");
      }
      chunks.push(chunk);
      if (final) {
        pending--;
        if (!name.endsWith("/")) {
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
          entries.set(name, bytes);
        }
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  const bytes = new Uint8Array(data);
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    cancelled(signal);
    unzip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
    if (offset % (128 * 1024) === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (pending) throw new Error("EPUB 压缩包不完整");
  if (entries.has("META-INF/encryption.xml")) throw new Error("暂不支持加密或 DRM EPUB（包括混淆字体资源）");
  const mimetype = entries.get("mimetype");
  if (mimetype && strFromU8(mimetype).trim() !== "application/epub+zip") throw new Error("文件不是 EPUB");
  return entries;
}

function xml(text: string, label: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error(`${label} 包含不支持的 XML 声明`);
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error(`${label} XML 无法解析`);
  return doc;
}

const tags = new Set(("a abbr address article aside b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q rp rt ruby s samp section small span strong sub summary sup table tbody td th thead tfoot time tr u ul var wbr svg g path rect circle ellipse line polyline polygon text tspan defs lineargradient radialgradient stop title desc").split(" "));
const blocked = "script,style,iframe,frame,frameset,object,embed,applet,form,input,button,textarea,select,meta,link,base,head,video,audio,source,track,canvas,foreignObject,animate,animateMotion,animateTransform,set,use,image";
const attributes = new Set(("id title alt lang dir width height colspan rowspan start reversed open datetime viewbox d x y x1 x2 y1 y2 cx cy r rx ry points transform fill stroke stroke-width opacity offset stop-color stop-opacity xmlns").split(" "));

/** Static reader markup: no active elements, inline CSS, automatic remote resources or executable URLs. */
export function sanitizeStaticHtml(source: string, base: string, image: (reference: string) => string | undefined): string {
  const template = document.createElement("template");
  template.innerHTML = source;
  const scrub = (root: ParentNode) => {
    root.querySelectorAll(blocked).forEach((element) => element.remove());
    for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
      if (!tags.has(element.localName.toLowerCase())) { element.replaceWith(...Array.from(element.childNodes)); continue; }
      const href = element.localName === "a" ? element.getAttribute("href") : null;
      const src = element.localName === "img" ? element.getAttribute("src") : null;
      for (const attr of Array.from(element.attributes)) {
        if (!attributes.has(attr.name.toLowerCase()) || /url\s*\(|javascript:|expression\s*\(/i.test(attr.value)) element.removeAttribute(attr.name);
      }
      if (href) {
        if (/^https?:\/\//i.test(href)) {
          try {
            const url = new URL(href);
            element.setAttribute("href", url.href);
            element.setAttribute("target", "_blank");
            element.setAttribute("rel", "noopener noreferrer");
          } catch { /* Invalid external links remain plain text. */ }
        } else {
          const target = resolveDocumentTarget(base, href);
          if (target) {
            element.setAttribute("href", "#");
            element.dataset.msTarget = JSON.stringify(target);
          }
        }
      }
      if (src) {
        const safe = image(src);
        if (safe) {
          element.setAttribute("src", safe);
          element.setAttribute("loading", "lazy");
          element.setAttribute("decoding", "async");
        } else element.setAttribute("alt", element.getAttribute("alt") || "（已阻止外部或不支持的图片）");
      }
      if (element.localName === "img") {
        for (const dimension of ["width", "height"]) {
          const value = Number(element.getAttribute(dimension));
          if (!Number.isFinite(value) || value <= 0 || value > 20000) element.removeAttribute(dimension);
        }
      }
    }
  };
  scrub(template.content);
  // Obsidian's maintained sanitizer is a second boundary before any content is attached.
  const host = document.createElement("div");
  host.append(sanitizeHTMLToDom(template.innerHTML));
  return host.innerHTML;
}

function titleOf(markup: string): string {
  const template = document.createElement("template"); template.innerHTML = markup;
  return template.content.querySelector("title,h1,h2")?.textContent?.trim() ?? "";
}

export function wrapSection(html: string, path: string): string {
  const section = document.createElement("section");
  section.dataset.msSection = path;
  section.className = "ms-document-section";
  section.innerHTML = html;
  return section.outerHTML;
}

/** EPUB 2/3 spine and navigation. Publisher CSS is deliberately replaced by reader styling. */
export async function parseEpub(data: ArrayBuffer, signal?: AbortSignal): Promise<StaticDocument> {
  const files = await unpackEpub(data, signal);
  const text = (path: string) => {
    const bytes = files.get(path);
    if (!bytes) throw new Error(`EPUB 缺少资源：${path}`);
    return strFromU8(bytes);
  };
  const container = xml(text("META-INF/container.xml"), "EPUB container");
  const packagePath = Array.from(container.getElementsByTagName("*")).find((node) => node.localName === "rootfile")?.getAttribute("full-path");
  if (!packagePath) throw new Error("EPUB 未声明 package 文件");
  archivePath(packagePath);
  const opf = xml(text(packagePath), "EPUB package");
  const items = Array.from(opf.getElementsByTagName("*")).filter((node) => node.localName === "item");
  const manifest = new Map<string, { path: string; type: string; properties: string }>();
  for (const item of items) {
    const target = resolveDocumentTarget(packagePath, item.getAttribute("href") ?? "");
    const id = item.getAttribute("id");
    if (target && id) manifest.set(id, { path: target.path, type: item.getAttribute("media-type") ?? "", properties: item.getAttribute("properties") ?? "" });
  }
  const refs = Array.from(opf.getElementsByTagName("*")).filter((node) => node.localName === "itemref");
  if (!refs.length || refs.length > EPUB_LIMITS.chapters) throw new Error("EPUB 章节为空或超过 512 章限制");
  const resources = new Map<string, string>();
  const dispose = () => { for (const url of resources.values()) URL.revokeObjectURL(url); resources.clear(); };
  const imageFor = (base: string, reference: string): string | undefined => {
    const target = resolveDocumentTarget(base, reference);
    if (!target) return undefined;
    const bytes = files.get(target.path);
    if (!bytes) return undefined;
    // Raster resources avoid executable SVG and embedded external references.
    const ext = target.path.split(".").pop()?.toLowerCase();
    const type = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" } as Record<string, string>)[ext ?? ""];
    if (!type) return undefined;
    if (!resources.has(target.path)) resources.set(target.path, URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type })));
    return resources.get(target.path);
  };
  try {
    const toc: DocumentTocEntry[] = [];
    const chapters: string[] = [];
    const seen = new Set<string>();
    let markupSize = 0;
    for (const ref of refs) {
      cancelled(signal);
      const item = manifest.get(ref.getAttribute("idref") ?? "");
      if (!item || !/xhtml|html/.test(item.type)) throw new Error("EPUB 包含不支持的正文格式或缺少章节");
      if (seen.has(item.path)) continue;
      seen.add(item.path);
      markupSize += files.get(item.path)?.length ?? 0;
      if (markupSize > EPUB_LIMITS.markup) throw new Error("EPUB 正文超过 24 MB 阅读上限");
      const source = text(item.path);
      chapters.push(wrapSection(sanitizeStaticHtml(source, item.path, (src) => imageFor(item.path, src)), item.path));
      toc.push({ title: titleOf(source) || `第 ${toc.length + 1} 章`, target: { path: item.path, fragment: "" }, depth: 0 });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const nav = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes("nav"));
    const navEntries: DocumentTocEntry[] = [];
    if (nav) {
      const template = document.createElement("template"); template.innerHTML = text(nav.path);
      const navElement = Array.from(template.content.querySelectorAll("nav")).find((node) => (node.getAttribute("epub:type") ?? "").split(/\s+/).includes("toc")) ?? template.content.querySelector("nav");
      for (const anchor of Array.from(navElement?.querySelectorAll("a[href]") ?? [])) {
        const target = resolveDocumentTarget(nav.path, anchor.getAttribute("href")!);
        if (target && seen.has(target.path)) navEntries.push({ title: anchor.textContent?.trim() || target.path, target,
          depth: Math.max(0, ancestorCount(anchor, "ol") - 1) });
      }
    } else {
      const ncx = [...manifest.values()].find((item) => item.type === "application/x-dtbncx+xml");
      if (ncx) {
        const doc = xml(text(ncx.path), "EPUB NCX");
        for (const point of Array.from(doc.getElementsByTagName("*")).filter((node) => node.localName === "navPoint")) {
          const content = Array.from(point.children).find((node) => node.localName === "content");
          const label = Array.from(point.children).find((node) => node.localName === "navLabel");
          const target = resolveDocumentTarget(ncx.path, content?.getAttribute("src") ?? "");
          if (target && seen.has(target.path)) navEntries.push({ title: label?.textContent?.trim() || target.path, target,
            depth: ancestorCount(point, "navPoint") });
        }
      }
    }
    cancelled(signal);
    const title = Array.from(opf.getElementsByTagName("*")).find((node) => node.localName === "title")?.textContent?.trim() || "EPUB";
    return { title, html: chapters.join(""), toc: navEntries.length ? navEntries.slice(0, 2048) : toc, dispose };
  } catch (error) { dispose(); throw error; }
}

function ancestorCount(element: Element, name: string): number {
  let count = 0;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent.localName === name) count++;
  return count;
}

export function headingToc(html: string, path: string): { html: string; toc: DocumentTocEntry[] } {
  const template = document.createElement("template"); template.innerHTML = html;
  const toc: DocumentTocEntry[] = [];
  const used = new Set(Array.from(template.content.querySelectorAll("[id]")).map((node) => node.id));
  for (const heading of Array.from(template.content.querySelectorAll("h1,h2,h3,h4,h5,h6"))) {
    if (!heading.id) {
      let id = `ms-heading-${toc.length + 1}`;
      while (used.has(id)) id += "-";
      heading.id = id; used.add(id);
    }
    toc.push({ title: heading.textContent?.trim() || "未命名标题", target: { path, fragment: heading.id }, depth: Number(heading.localName.slice(1)) - 1 });
  }
  return { html: template.innerHTML, toc };
}
