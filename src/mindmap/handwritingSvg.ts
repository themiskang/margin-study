import type { MindmapHandwriting, MindmapInkLayer, MindmapInkPoint, MindmapInkStroke } from "./handwritingContracts";

const SVG_NS = "http://www.w3.org/2000/svg";
export function visibleMindmapInkLayers(data?: MindmapHandwriting): MindmapInkLayer[] {
  return data?.layers.filter((layer) => layer.id === data.activeLayerId || layer.id === data.overlayLayerId) ?? [];
}

/** Live canvas and file export share the same brush geometry and opacity. */
export function createMindmapInkStroke(stroke: MindmapInkStroke): SVGGElement {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("data-map-ink-stroke", stroke.id); group.setAttribute("data-ink-brush", stroke.tool);
  const addPath = (points: MindmapInkPoint[], width: number) => {
    const path = document.createElementNS(SVG_NS, "path");
    for (const [key, value] of Object.entries({ d: points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" "), fill: "none", stroke: stroke.color, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round" })) path.setAttribute(key, String(value));
    group.append(path);
  };
  if (stroke.opacity !== undefined) group.setAttribute("opacity", String(stroke.opacity));
  if (stroke.tool === "highlight") { if (stroke.opacity === undefined) group.setAttribute("opacity", ".32"); addPath(stroke.points, stroke.width); }
  else if (stroke.points.some((point) => point.pressure !== undefined)) {
    for (let index = 1; index < stroke.points.length; index++) {
      const previous = stroke.points[index - 1], point = stroke.points[index];
      addPath([previous, point], stroke.width * (.25 + 1.5 * ((previous.pressure ?? .5) + (point.pressure ?? .5)) / 2));
    }
  } else addPath(stroke.points, stroke.width);
  return group;
}
