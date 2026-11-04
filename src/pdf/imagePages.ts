import { zlibSync } from "fflate";

export const PAGE_IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif";
export function isPageImage(file: File): boolean { return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name); }

/** Self-contained, lossless RGB pages. Browser decoding applies image orientation. */
export async function imagePagesPdf(files: File[], current: () => void): Promise<File> {
  if (!files.length || files.length > 100) throw new Error("请选择1至100张图片");
  const encode = (text: string) => new TextEncoder().encode(text), chunks: Uint8Array[] = [], offsets = [0];
  let length = 0;
  const append = (bytes: Uint8Array) => { chunks.push(bytes); length += bytes.byteLength; };
  const object = (id: number, parts: Uint8Array[]) => {
    offsets[id] = length; append(encode(`${id} 0 obj\n`)); parts.forEach(append); append(encode("\nendobj\n"));
  };
  append(encode("%PDF-1.7\n"));
  object(1,[encode("<< /Type /Catalog /Pages 2 0 R >>")]);
  object(2,[encode(`<< /Type /Pages /Count ${files.length} /Kids [${files.map((_,i)=>`${3+i*3} 0 R`).join(" ")}] >>`)]);
  let totalPixels = 0;
  for (const [index,file] of files.entries()) {
    current(); if (!isPageImage(file) || file.size > 100_000_000) throw new Error(`不支持的图片或文件过大：${file.name}`);
    const bytes = await file.arrayBuffer(); current();
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(new Blob([bytes],{type:file.type}),{imageOrientation:"from-image"}); }
    catch { throw new Error(`无法解码图片：${file.name}`); }
    const canvas = document.createElement("canvas");
    try {
      current(); const width = bitmap.width, height = bitmap.height; totalPixels += width*height;
      if (!width || !height || width > 14400 || height > 14400 || width*height > 32_000_000 || totalPixels > 64_000_000) throw new Error("图片尺寸过大，请缩小后再插入");
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d"); if (!context) throw new Error("无法创建图片页面");
      context.fillStyle = "#fff"; context.fillRect(0,0,width,height); context.drawImage(bitmap,0,0);
      const rgba = context.getImageData(0,0,width,height).data, rgb = new Uint8Array(width*height*3);
      for (let pixel=0, channel=0; pixel<rgba.length; pixel+=4) { rgb[channel++]=rgba[pixel]; rgb[channel++]=rgba[pixel+1]; rgb[channel++]=rgba[pixel+2]; }
      const compressed = zlibSync(rgb), page = 3+index*3;
      const content = encode(`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\n`);
      object(page,[encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${page+2} 0 R >> >> /Contents ${page+1} 0 R >>`)]);
      object(page+1,[encode(`<< /Length ${content.length} >>\nstream\n`),content,encode("endstream")]);
      object(page+2,[encode(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`),compressed,encode("\nendstream")]);
    } finally { bitmap.close(); canvas.width=0; canvas.height=0; }
  }
  current(); const xref = length, count = offsets.length;
  append(encode(`xref\n0 ${count}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  const output = new Uint8Array(length); let at = 0; for (const chunk of chunks) { output.set(chunk,at); at+=chunk.length; }
  return new File([output.buffer],"image-pages.pdf",{type:"application/pdf"});
}
