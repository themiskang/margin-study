import { TFile, Notice } from "obsidian";
import type MarginStudyPlugin from "../main";
import { MindNode, Edge } from "../types";
import { uid } from "../utils/id";
import { el } from "../utils/dom";
import { createModal } from "../utils/modal";
import { nodeContent } from "../study/nodeContent";

interface CanvasNode {
  id: string;
  type: "text";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}
interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  label?: string;
}
interface CanvasFile {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/** Export the same independent canvas or unfiled scope shown in the mind map. */
export async function exportCanvas(plugin: MarginStudyPlugin): Promise<void> {
  const nodes = plugin.store.getScopedNodes();
  if (!nodes.length) {
    new Notice("导图为空，无可导出节点");
    return;
  }
  const canvasNodes: CanvasNode[] = nodes.map((n) => ({
    id: n.id,
    type: "text",
    text: nodeContent(plugin.store, n).title,
    x: Math.round(n.x),
    y: Math.round(n.y),
    width: 250,
    height: 60,
    color: n.parentId === null ? "5" : undefined,
  }));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = plugin.store.edges
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((edge) => ({ ...edge }));
  for (const node of nodes) {
    if (node.parentId && ids.has(node.parentId) && !edges.some((edge) => edge.from === node.parentId && edge.to === node.id)) {
      edges.push({ from: node.parentId, to: node.id });
    }
  }
  const canvasEdges: CanvasEdge[] = edges.map((e: Edge) => ({ id: uid("ce"), fromNode: e.from, toNode: e.to, label: e.label }));

  const file: CanvasFile = { nodes: canvasNodes, edges: canvasEdges };
  const activeCanvas = plugin.store.canvases.find((canvas) => canvas.id === plugin.store.activeCanvasId);
  const name = activeCanvas ? `${activeCanvas.name.replace(/[\\/:*?"<>|]/g, "_")}-${activeCanvas.id}.canvas`
    : "marginstudy-unfiled.canvas";
  const existing = plugin.app.vault.getAbstractFileByPath(name);
  const content = JSON.stringify(file, null, 2);
  if (existing instanceof TFile) await plugin.app.vault.modify(existing, content);
  else await plugin.app.vault.create(name, content);
  new Notice(`已导出导图到 ${name}`);
}

/** 从 .canvas 文件导入为导图节点（仅文本节点） */
export async function importCanvas(plugin: MarginStudyPlugin): Promise<void> {
  const files = plugin.app.vault.getFiles().filter((f) => f.path.endsWith(".canvas"));
  if (!files.length) {
    new Notice("vault 中没有 .canvas 文件");
    return;
  }
  const { modal, close } = pickCanvas(files);
  modal.append(
    el("p", {
      text: "选择要导入的画布（其文本节点将作为导图节点）：",
      style: "color:var(--text-muted);font-size:12px",
    })
  );
  const list = document.createElement("div");
  for (const f of files) {
    const item = document.createElement("div");
    item.className = "ms-canvas-item";
    item.textContent = f.path;
    item.addEventListener("click", async () => {
      close();
      await doImport(plugin, f);
    });
    list.append(item);
  }
  modal.append(list);
}

function pickCanvas(files: TFile[]): { modal: HTMLElement; close: () => void } {
  const { modal, close } = createModal("从 Canvas 导入");
  return { modal, close };
}

async function doImport(plugin: MarginStudyPlugin, file: TFile): Promise<void> {
  try {
    const txt = await plugin.app.vault.read(file);
    const data = JSON.parse(txt) as CanvasFile;
    if (!Array.isArray(data.nodes)) throw new Error("画布缺少节点列表");
    const scope = plugin.store.activeStudySetId ? undefined : plugin.activeReader?.getFilePath() ?? undefined;
    const ids = new Set<string>();
    const nodes: MindNode[] = [];
    for (const cn of data.nodes) {
      if (cn.type !== "text" || typeof cn.id !== "string" || !cn.id || ids.has(cn.id)) continue;
      const node: MindNode = {
        id: cn.id,
        parentId: null,
        title: typeof cn.text === "string" ? cn.text : "（空）",
        docPath: scope,
        collapsed: false,
        x: Number.isFinite(cn.x) ? cn.x : 0,
        y: Number.isFinite(cn.y) ? cn.y : 0,
      };
      nodes.push(node);
      ids.add(cn.id);
    }
    const edges: Edge[] = (Array.isArray(data.edges) ? data.edges : [])
      .filter((edge) => ids.has(edge.fromNode) && ids.has(edge.toNode))
      .map((edge) => ({ from: edge.fromNode, to: edge.toNode, label: typeof edge.label === "string" ? edge.label : undefined }));
    const added = plugin.store.pasteSubtree({ nodes, edges, cards: [] }, {
      canvasId: plugin.store.activeCanvasId,
      parentId: null,
      mode: "clone",
      offset: { x: 0, y: 0 },
    }).length;
    plugin.refreshSidebar();
    plugin.refreshMindmap();
    new Notice(`已导入 ${added} 个节点，可在思维导图查看`);
  } catch (e) {
    new Notice("导入失败：" + (e as Error).message);
  }
}
