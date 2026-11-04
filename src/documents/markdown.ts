import { App, Component, MarkdownRenderer } from "obsidian";
import { sanitizeStaticHtml } from "./content";

/** Render a static snapshot; executable fenced extensions and transclusions are disabled. */
export async function markdownSnapshot(app: App, source: string, path: string,
  image: (reference: string) => string | undefined): Promise<string> {
  const images: { token: string; source: string; alt: string }[] = [];
  const tokenFor = (source: string, alt: string) => {
    const token = `MSIMAGE${Math.random().toString(36).slice(2)}N${images.length}END`;
    images.push({ token, source, alt }); return token;
  };
  let safe = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  // Reserve ordinary image syntax before escaping all remaining embed markers.
  safe = safe.replace(/!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^\s)\n]+)(?:\s+["'][^\n]*?["'])?\s*\)/g,
    (_match, alt: string, url: string) => tokenFor(url.replace(/^<|>$/g, ""), alt));
  safe = safe.replace(/!\[\[([^\]\n]+)\]\]/g, (_match, target: string) => {
    const [file, alt] = target.split("|");
    return tokenFor(file, alt || file);
  });
  safe = safe.replace(/!\[/g, "\\![");
  // Raw HTML stays visible text, so it cannot initiate a fetch before sanitization.
  safe = safe.replace(/</g, "&lt;");
  let fence: { marker: string; size: number } | null = null;
  safe = safe.split("\n").map((line) => {
    const match = line.match(/^(\s{0,3})(`{3,}|~{3,})(.*)$/);
    if (!match) return line;
    if (!fence) { fence = { marker: match[2][0], size: match[2].length }; return `${match[1]}${match[2]}text`; }
    if (match[2][0] === fence.marker && match[2].length >= fence.size && !match[3].trim()) fence = null;
    return line;
  }).join("\n");
  const component = new Component();
  component.load();
  const host = document.createElement("div");
  const safeImages = new Set<string>();
  try {
    await MarkdownRenderer.render(app, safe, host, path, component);
    // Obsidian wiki links expose their original target through data-href.
    for (const anchor of Array.from(host.querySelectorAll<HTMLAnchorElement>("a.internal-link"))) {
      const target = anchor.getAttribute("data-href");
      if (target) anchor.setAttribute("href", target);
    }
    for (const item of images) {
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) if (node.textContent?.includes(item.token)) nodes.push(node as Text);
      for (const text of nodes) {
        const parts = text.data.split(item.token);
        const fragment = document.createDocumentFragment();
        parts.forEach((part, index) => {
          if (index) {
            const img = document.createElement("img");
            // Only safe local resources are assigned, even while the tree is detached.
            const resource = image(item.source);
            if (resource) { img.setAttribute("src", resource); safeImages.add(resource); }
            img.alt = item.alt;
            fragment.append(img);
          }
          fragment.append(document.createTextNode(part));
        });
        text.replaceWith(fragment);
      }
    }
    // Already-resolved resource URLs may pass through unchanged only if we created them.
    return sanitizeStaticHtml(host.innerHTML, path, (reference) => safeImages.has(reference) ? reference : image(reference));
  } finally { component.unload(); }
}
