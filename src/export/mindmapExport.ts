import { Notice } from "obsidian";
import type MarginStudyPlugin from "../main";
import type { MindNode } from "../types";
import { createModal } from "../utils/modal";
import { createMindmapInkStroke, visibleMindmapInkLayers } from "../mindmap/handwritingSvg";
import { projectBoundInk } from "../annot/penGeometry";
import { buildCardFlowPdf } from "./cardFlow";

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_W = 240;
const NODE_H = 84;

function svgToPng(svg: SVGSVGElement, width: number, height: number, filename: string, done: () => void): void {
  const data = new XMLSerializer().serializeToString(svg);
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(data);
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) { new Notice("PNG 导出失败"); return; }
      downloadBlob(blob, filename);
      new Notice("已导出 PNG");
      done();
    }, "image/png");
  };
  img.onerror = () => new Notice("PNG 渲染失败");
  img.src = url;
}

function svgToString(svg: SVGSVGElement): string { return new XMLSerializer().serializeToString(svg); }

/** 导出当前思维导图（含连线 + 节点）为自包含 SVG（节点是 HTML div，不在 svg 内，故需按数据重建） */
export async function exportMindmapPng(plugin: MarginStudyPlugin): Promise<void> {
  await plugin.store.flush();
  const built = buildExportSvg(plugin);
  if (!built) {
    new Notice("脑图为空，没有可导出的内容");
    return;
  }
  const { svg, width, height } = built;

  const { modal, close } = createModal("导出脑图");
  modal.append(el_text("选择导出格式："));
  const row = document.createElement("div");
  row.className = "ms-modal-actions";

  const pngBtn = document.createElement("button");
  pngBtn.className = "ms-btn primary";
  pngBtn.textContent = "PNG 图片";
  pngBtn.addEventListener("click", () => svgToPng(svg, width, height, `marginstudy-mindmap-${Date.now()}.png`, close));

  const svgBtn = document.createElement("button");
  svgBtn.className = "ms-btn";
  svgBtn.textContent = "SVG 矢量";
  svgBtn.addEventListener("click", () => {
    downloadBlob(new Blob([svgToString(svg)], { type: "image/svg+xml" }), `marginstudy-mindmap-${Date.now()}.svg`);
    new Notice("已导出 SVG");
    close();
  });

  const pdfBtn = document.createElement("button");
  pdfBtn.className = "ms-btn"; pdfBtn.textContent = "PDF 卡片流";
  const inkLabel = document.createElement("label");
  const ink = document.createElement("input"); ink.type="checkbox"; ink.checked=true;
  inkLabel.append(ink, document.createTextNode(" 包含卡片手写"));
  pdfBtn.addEventListener("click",()=>{pdfBtn.disabled=true;void buildCardFlowPdf(plugin,{columns:2,includeInk:ink.checked}).then(result=>{downloadBlob(new Blob([result.bytes as BlobPart],{type:"application/pdf"}),`marginstudy-card-flow-${Date.now()}.pdf`);new Notice(`已导出 ${result.pageCount} 页卡片流 PDF`);close();}).catch(error=>new Notice(`卡片流导出失败：${String(error)}`)).finally(()=>{pdfBtn.disabled=false;});});
  row.append(pngBtn, svgBtn, pdfBtn);
  modal.append(row);
  modal.append(inkLabel);
}

/** 导出选中分支或单张卡片：复用同一 SVG 重建，只保留选中节点及其之间的连线与绑定手写。 */
export async function exportMindmapNodes(plugin: MarginStudyPlugin, nodeIds: string[], kind: "branch" | "card"): Promise<void> {
  const ids = new Set(nodeIds);
  if (!ids.size) { new Notice("请先选中卡片"); return; }
  await plugin.store.flush();
  const built = buildExportSvg(plugin, ids);
  if (!built) { new Notice("没有可导出的内容"); return; }
  const { svg, width, height } = built;
  const label = kind === "branch" ? "分支" : "卡片";
  const { modal, close } = createModal("导出" + label);
  modal.append(el_text(`导出 ${ids.size} 个节点的${label}，仅包含所选节点及其连线。`));
  const row = document.createElement("div");
  row.className = "ms-modal-actions";
  const pngBtn = document.createElement("button");
  pngBtn.className = "ms-btn primary"; pngBtn.textContent = "PNG 图片";
  pngBtn.addEventListener("click", () => svgToPng(svg, width, height, `marginstudy-${kind}-${Date.now()}.png`, close));
  const svgBtn = document.createElement("button");
  svgBtn.className = "ms-btn"; svgBtn.textContent = "SVG 矢量";
  svgBtn.addEventListener("click", () => {
    downloadBlob(new Blob([svgToString(svg)], { type: "image/svg+xml" }), `marginstudy-${kind}-${Date.now()}.svg`);
    new Notice("已导出 SVG");
    close();
  });
  row.append(pngBtn, svgBtn);
  modal.append(row);
}

/** 按 store 的 nodes/edges 重建一张自包含 SVG（含白底、连线、节点） */
function buildExportSvg(plugin: MarginStudyPlugin, includeIds?: Set<string>): { svg: SVGSVGElement; width: number; height: number } | null {
  const all = plugin.store.getScopedNodes().filter(node => !includeIds || includeIds.has(node.id));
  const handwriting = plugin.store.canvases.find((canvas) => canvas.id === plugin.store.activeCanvasId)?.handwriting;
  const visibleInk = visibleMindmapInkLayers(handwriting).map(layer => ({ ...layer, strokes: layer.strokes.filter(stroke => !includeIds
    || (!!stroke.focusNodeId && includeIds.has(stroke.focusNodeId))
    || (!!stroke.targetCardId && all.some(node => node.cardId === stroke.targetCardId))) }));
  if (!all.length && !visibleInk.some((layer) => layer.strokes.some((stroke) => stroke.points.length))) return null;

  // 尽量读取界面内实际渲染的节点尺寸（脑图节点为内容自适应宽高），让导出与屏幕一致；
  // 若当前脑图未打开（DOM 中无 .ms-node），回退到固定尺寸。
  const domSizes = new Map<string, { w: number; h: number }>();
  document.querySelectorAll<HTMLElement>(".ms-node").forEach((el) => {
    const id = el.getAttribute("data-id");
    if (id) domSizes.set(id, { w: el.offsetWidth || NODE_W, h: el.offsetHeight || NODE_H });
  });
  const sizeOf = (n: MindNode): { w: number; h: number } =>
    domSizes.get(n.id) ?? { w: NODE_W, h: NODE_H };
  const inkLayers = visibleInk.map(layer => ({ ...layer, strokes: layer.strokes.map(stroke => {
    const node = stroke.focusNodeId ? all.find(item => item.id === stroke.focusNodeId) : stroke.targetCardId ? all.find(item => item.cardId === stroke.targetCardId) : undefined;
    const size = node && sizeOf(node), frame = node && size && (!stroke.targetCardId || stroke.targetCardId === node.cardId) ? { x: node.x, y: node.y, width: size.w, height: size.h } : undefined;
    return { ...stroke, points: projectBoundInk(stroke.points, stroke.targetFrame, frame) };
  }) }));

  // 计算整体包围盒
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of all) {
    const { w, h } = sizeOf(n);
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w);
    maxY = Math.max(maxY, n.y + h);
  }
  for (const stroke of inkLayers.flatMap((layer) => layer.strokes)) for (const point of stroke.points) {
    minX = Math.min(minX, point.x - stroke.width); minY = Math.min(minY, point.y - stroke.width);
    maxX = Math.max(maxX, point.x + stroke.width); maxY = Math.max(maxY, point.y + stroke.width);
  }
  const pad = 40;
  const x0 = minX - pad;
  const y0 = minY - pad;
  const width = Math.ceil(maxX - minX + pad * 2);
  const height = Math.ceil(maxY - minY + pad * 2);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `${x0} ${y0} ${width} ${height}`);

  // 白底（暗色模式下也清晰）
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", String(x0));
  bg.setAttribute("y", String(y0));
  bg.setAttribute("width", String(width));
  bg.setAttribute("height", String(height));
  bg.setAttribute("fill", "#ffffff");
  svg.append(bg);

  const nodeMap = new Map(all.map((n) => [n.id, n]));

  // 连线（与界面内 makeEdgePath 同源：源点右中 → 目标点左中，三次贝塞尔）
  for (const e of plugin.store.edges) {
    const a = nodeMap.get(e.from);
    const b = nodeMap.get(e.to);
    if (!a || !b) continue;    const sa = sizeOf(a);
    const sb = sizeOf(b);
    const sx = a.x + sa.w;
    const sy = a.y + sa.h / 2;
    const tx = b.x;
    const ty = b.y + sb.h / 2;
    const dx = Math.max(40, Math.abs(tx - sx) / 2);
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#c4c4c4");
    path.setAttribute("stroke-width", "1.5");
    svg.append(path);
    if (e.label) {
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String((sx + tx) / 2));
      t.setAttribute("y", String((sy + ty) / 2 - 4));
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("font-size", "11");
      t.setAttribute("fill", "#888");
      t.textContent = e.label;
      svg.append(t);
    }
  }

  // 节点（圆角矩形 + 多行标题 + 标签）
  for (const n of all) {
    const { w, h } = sizeOf(n);
    const g = document.createElementNS(SVG_NS, "g");
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(n.x));
    rect.setAttribute("y", String(n.y));
    rect.setAttribute("width", String(w));
    rect.setAttribute("height", String(h));
    rect.setAttribute("rx", "10");
    rect.setAttribute("ry", "10");
    rect.setAttribute("fill", n.color || "#eef1f6");
    rect.setAttribute("stroke", "#d0d4dc");
    rect.setAttribute("stroke-width", "1");
    g.append(rect);

    const title = document.createElementNS(SVG_NS, "text");
    title.setAttribute("x", String(n.x + 12));
    title.setAttribute("y", String(n.y + 26));
    title.setAttribute("font-family", "system-ui, -apple-system, 'Segoe UI', sans-serif");
    title.setAttribute("font-size", "14");
    title.setAttribute("fill", "#1a1a1a");
    const lines = wrapText(n.title || "(空)", 30, 3);
    lines.forEach((ln, i) => {
      const ts = document.createElementNS(SVG_NS, "tspan");
      ts.setAttribute("x", String(n.x + 12));
      ts.setAttribute("y", String(n.y + 26 + i * 19));
      ts.textContent = ln;
      title.append(ts);
    });
    g.append(title);

    if (n.tags?.length) {
      let tagX = n.x + 12;
      const tagY = n.y + h - 22;
      for (const t of n.tags) {
        const col = plugin.store.settings.tagColors[t] || "#8a8f98";
        const tw = Math.max(20, t.length * 8 + 14);
        const tg = document.createElementNS(SVG_NS, "rect");
        tg.setAttribute("x", String(tagX));
        tg.setAttribute("y", String(tagY));
        tg.setAttribute("width", String(tw));
        tg.setAttribute("height", "17");
        tg.setAttribute("rx", "8.5");
        tg.setAttribute("fill", col);
        g.append(tg);
        const tt = document.createElementNS(SVG_NS, "text");
        tt.setAttribute("x", String(tagX + tw / 2));
        tt.setAttribute("y", String(tagY + 12));
        tt.setAttribute("text-anchor", "middle");
        tt.setAttribute("font-size", "10");
        tt.setAttribute("fill", "#ffffff");
        tt.textContent = t;
        g.append(tt);
        tagX += tw + 6;
      }
    }
    svg.append(g);
  }

  for (const layer of inkLayers) {
    const group = document.createElementNS(SVG_NS, "g"); group.setAttribute("data-map-ink-layer", layer.id);
    if (layer.id !== handwriting?.activeLayerId) group.setAttribute("opacity", ".55");
    for (const stroke of layer.strokes) group.append(createMindmapInkStroke(stroke)); svg.append(group);
  }

  return { svg, width, height };
}

/** 按字符宽度（CJK=2）折行，最多 maxLines 行，超出在末行加省略号 */
function wrapText(text: string, maxHalf: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  let width = 0;
  for (const ch of text) {
    const cw = ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
    if (width + cw > maxHalf && line) {
      if (lines.length >= maxLines - 1) {
        lines.push(line + "…");
        return lines;
      }
      lines.push(line);
      line = "";
      width = 0;
    }
    line += ch;
    width += cw;
  }
  if (line) lines.push(line);
  return lines;
}

function el_text(s: string): HTMLElement {
  const p = document.createElement("p");
  p.textContent = s;
  p.style.margin = "0 0 10px";
  p.style.color = "var(--text-muted)";
  return p;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
