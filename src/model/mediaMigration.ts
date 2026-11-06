import { sha256Hex } from "../utils/sha256";

const directory = "_marginstudy-media";
const limit = 64 * 1024;
const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/svg+xml": "svg", "image/bmp": "bmp", "image/x-icon": "ico", "image/tiff": "tiff" };

type Adapter = { exists(path: string): Promise<boolean>; mkdir(path: string): Promise<void>; writeBinary(path: string, data: ArrayBuffer): Promise<void>; readBinary(path: string): Promise<ArrayBuffer> };
type Slot = { object: any; key: string | number };

function slots(data: any): Slot[] {
  const result: Slot[] = [];
  const add = (object: any, key: string | number) => { if (object && typeof object[key] === "string" && /^data:/i.test(object[key])) result.push({ object, key }); };
  const visitCard = (card: any) => {
    if (!card || typeof card !== "object") return;
    add(card, "image");
    for (let index = 0; index < (card.images?.length ?? 0); index++) add(card.images, index);
    for (const key of ["commentMedia", "extendMedia", "excerptBlocks", "sources"]) for (const item of card[key] ?? []) add(item, "image");
    for (const child of card.mergedCards ?? []) visitCard(child);
  };
  for (const card of data.cards ?? []) visitCard(card);
  for (const node of data.nodes ?? []) add(node, "image");
  for (const ann of data.annotations ?? []) {
    visitCard(ann);
    add(ann.overlay, "image");
  }
  return result;
}

export function hasInlineMedia(data: any): boolean {
  return slots(data).some(({ object, key }) => object[key].length > limit);
}

export async function externalizeMedia(data: any, adapter: Adapter): Promise<{ count: number; bytes: number; elapsedMs: number; replacements: Map<string, string> }> {
  const started = Date.now(), replacements = new Map<string, string>(), failed = new Set<string>();
  let count = 0, bytes = 0;
  for (const { object, key } of slots(data)) {
    const source = object[key] as string;
    if (replacements.has(source)) { object[key] = replacements.get(source)!; count++; continue; }
    if (failed.has(source) || source.length <= limit) continue;
    try {
      const match = /^data:(image\/[^;,]+)((?:;[^,]*)?),(.*)$/is.exec(source);
      if (!match) continue;
      const mime = match[1].toLowerCase();
      const extension = extensions[mime] ?? (/^image\/[a-z0-9]+$/.test(mime) ? mime.slice(6) : undefined);
      if (!extension) continue;
      let binary: Uint8Array;
      if (/;base64(?:;|$)/i.test(match[2])) {
        const decoded = atob(match[3]);
        binary = Uint8Array.from(decoded, char => char.charCodeAt(0));
      } else {
        const encoded = match[3].replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        if (/[^\x00-\xff]/.test(encoded)) throw new Error("Invalid data URL");
        binary = Uint8Array.from(encoded, char => char.charCodeAt(0));
      }
      if (binary.byteLength <= limit) continue;
      const hash = sha256Hex(binary), path = `${directory}/${hash}.${extension}`;
      if (!await adapter.exists(directory)) await adapter.mkdir(directory);
      let written = await adapter.exists(path) ? await adapter.readBinary(path) : null;
      if (!written || written.byteLength !== binary.byteLength || sha256Hex(written) !== hash) {
        await adapter.writeBinary(path, binary.buffer as ArrayBuffer);
        written = await adapter.readBinary(path);
      }
      if (written.byteLength !== binary.byteLength || sha256Hex(written) !== hash) throw new Error("媒体文件校验失败");
      replacements.set(source, path);
      object[key] = path;
      count++; bytes += binary.byteLength;
    } catch (error) {
      failed.add(source);
      console.error("MarginStudy: 图片外置失败，保留原数据", error);
    }
  }
  return { count, bytes, elapsedMs: Date.now() - started, replacements };
}

export function applyMediaReplacements(data: any, replacements: Map<string, string>): void {
  for (const { object, key } of slots(data)) {
    const path = replacements.get(object[key]);
    if (path) object[key] = path;
  }
}
