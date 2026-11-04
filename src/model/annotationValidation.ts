/** Validate additive fields without changing legacy annotation identities or formats. */
export function validateAnnotationExtras(annotation: unknown): void {
  if (!annotation || typeof annotation !== "object") throw new Error("标注格式无效");
  const ann = annotation as Record<string, any>;
  if (ann.inkBrush !== undefined && ann.inkBrush !== "pen" && ann.inkBrush !== "highlight") throw new Error("笔刷格式无效");
  if (ann.inkRecallPurpose !== undefined && (ann.inkBrush !== "highlight" || !["mask","highlight"].includes(ann.inkRecallPurpose))) throw new Error("荧光笔用途无效");
  if (ann.overlay === undefined) return;
  const overlay = ann.overlay;
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay) || !["text", "image"].includes(overlay.kind) || ann.type !== "note") throw new Error("自由批注格式无效");
  if(overlay.rotation!==undefined&&(!Number.isFinite(overlay.rotation)||overlay.rotation<0||overlay.rotation>=360))throw new Error("自由批注旋转角度无效");
  if (overlay.deleted !== undefined && typeof overlay.deleted !== "boolean") throw new Error("自由批注删除状态无效");
  if (overlay.fontSize !== undefined && (!Number.isFinite(overlay.fontSize) || overlay.fontSize < 6 || overlay.fontSize > 300)) throw new Error("自由批注字号无效");
  if (overlay.fontFamily !== undefined && (typeof overlay.fontFamily !== "string" || !overlay.fontFamily.trim() || overlay.fontFamily.length > 100 || /[\r\n\u0000]/.test(overlay.fontFamily))) throw new Error("自由文字字体无效");
  if (overlay.textRuns !== undefined) {
    if (overlay.kind !== "text" || !Array.isArray(overlay.textRuns) || overlay.textRuns.length > 100_000) throw new Error("自由文字样式格式无效");
    let length = 0;
    for (const run of overlay.textRuns) {
      if (!run || typeof run.text !== "string" || (length += run.text.length) > 100_000) throw new Error("自由文字片段无效");
      const style = run.style;
      if (!style || typeof style !== "object" || Array.isArray(style) || typeof style.fontFamily !== "string" || !style.fontFamily.trim() || style.fontFamily.length > 100 || /[\r\n\u0000]/.test(style.fontFamily) || !Number.isFinite(style.fontSize) || style.fontSize < 6 || style.fontSize > 300 || [style.bold, style.italic, style.underline].some(value => typeof value !== "boolean")) throw new Error("自由文字样式无效");
      for (const color of [style.color, style.background]) if (typeof color !== "string" || !/^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|transparent)$/i.test(color)) throw new Error("自由文字颜色无效");
    }
  }
  if (overlay.background !== undefined && (typeof overlay.background !== "string" || !/^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|transparent)$/i.test(overlay.background))) throw new Error("自由批注背景无效");
  if (overlay.kind === "text" && typeof ann.text !== "string") throw new Error("自由文字内容无效");
  if (overlay.kind === "image" && (typeof ann.image !== "string" || !/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/i.test(ann.image))) throw new Error("自由图片须为安全的图片 data URI");
  if (overlay.box !== undefined) {
    const box = overlay.box;
    if (!box || [box.x, box.y, box.w, box.h].some(value => !Number.isFinite(value)) || box.x < 0 || box.y < 0 || box.w <= 0 || box.h <= 0 || box.x + box.w > 1.000001 || box.y + box.h > 1.000001) throw new Error("自由批注位置无效");
  }
}
export function validateAnnotationCollectionExtras(annotations: unknown[]): void { for (const annotation of annotations) validateAnnotationExtras(annotation); }

/** Same shape and identity checks at load, edit, conflict and backup boundaries. */
export function validateAnnotationCollection(annotations: unknown): asserts annotations is import("../types").Annotation[] {
  if (!Array.isArray(annotations) || annotations.some(annotation => !annotation || typeof annotation.id !== "string" || typeof annotation.type !== "string" || !Array.isArray(annotation.rects))) throw new Error("标注格式无效");
  if (new Set(annotations.map(annotation => annotation.id)).size !== annotations.length) throw new Error("标注 id 重复");
  validateAnnotationCollectionExtras(annotations);
}
