export type NotebookStyle = "blank" | "dots" | "grid" | "lines";
export interface NotebookMetadata {
  format: "marginstudy-notebook";
  version: 1;
  id: string;
  title: string;
  style: NotebookStyle;
  pageCount: number;
  width: number;
  height: number;
  createdAt: string;
}
export const NOTEBOOK_STYLES: { id: NotebookStyle; name: string }[] = [
  { id: "blank", name: "空白" }, { id: "dots", name: "点阵" }, { id: "grid", name: "方格" }, { id: "lines", name: "横线" },
];
function validMetadata(value: any): value is NotebookMetadata {
  return value?.format === "marginstudy-notebook" && value.version === 1 && typeof value.id === "string" && value.id.length <= 120 &&
    typeof value.title === "string" && value.title.length <= 200 && NOTEBOOK_STYLES.some((style) => style.id === value.style) &&
    Number.isInteger(value.pageCount) && value.pageCount >= 1 && value.pageCount <= 500 &&
    Number.isFinite(value.width) && value.width >= 300 && value.width <= 1200 && Number.isFinite(value.height) && value.height >= 300 && value.height <= 1600 && typeof value.createdAt === "string";
}
export function readNotebookMetadata(bytes: ArrayBuffer): NotebookMetadata | null {
  const header = new TextDecoder().decode(bytes.slice(0, 16384));
  const encoded = /^%MSNOTEBOOK ([^\r\n]+)$/m.exec(header)?.[1];
  if (!header.startsWith("%PDF-") || !encoded) return null;
  try { const value = JSON.parse(decodeURIComponent(encoded)); return validMetadata(value) ? value : null; } catch { return null; }
}
/** A standard self-contained PDF; paper templates never change the page's coordinate space. */
export function createNotebookBytes(metadata: NotebookMetadata): ArrayBuffer {
  if (!validMetadata(metadata)) throw new Error("笔记本页面设置无效");
  const { width, height, pageCount, style } = metadata;
  let pattern = "0.83 0.86 0.89 RG 0.83 0.86 0.89 rg 0.45 w\n";
  if (style === "dots") pattern += "12.8 12 m 12.8 12.442 12.442 12.8 12 12.8 c 11.558 12.8 11.2 12.442 11.2 12 c 11.2 11.558 11.558 11.2 12 11.2 c 12.442 11.2 12.8 11.558 12.8 12 c f\n";
  else if (style === "grid") pattern += "0 0 m 24 0 l S 0 0 m 0 24 l S\n";
  else if (style === "lines") pattern += "0 0 m 24 0 l S\n";
  const stream = style === "blank" ? "" : `q /Pattern cs /Paper scn 0 0 ${width} ${height} re f Q\n`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${index + 5} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    `<< /Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 24 24] /XStep 24 /YStep 24 /Resources << >> /Length ${pattern.length} >>\nstream\n${pattern}endstream`,
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    ...Array.from({ length: pageCount }, () => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Pattern << /Paper 3 0 R >> >> /Contents 4 0 R >>`)];
  let source = `%PDF-1.7\n%MarginStudy notebook\n%MSNOTEBOOK ${encodeURIComponent(JSON.stringify(metadata))}\n`;
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(source.length); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(source).buffer as ArrayBuffer;
}
