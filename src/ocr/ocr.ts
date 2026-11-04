import { App, Notice } from "obsidian";

export interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
}

let swiftAvailable: Promise<boolean> | null = null;
const buffers=new WeakMap<App,Map<string,OcrWord[]>>();
export function clearOcrBuffer(app:App):void {buffers.delete(app);}

function checkSwift(): Promise<boolean> {
  if (swiftAvailable !== null) return swiftAvailable;
  swiftAvailable = new Promise((resolve) => {
    try {
      const cp = (window as any).require("child_process") as typeof import("child_process");
      cp.execFile("/usr/bin/swift", ["--version"], { timeout: 5000 }, (error) => resolve(!error));
    } catch {
      resolve(false);
    }
  });
  return swiftAvailable;
}

function pluginDir(app: App): string {
  return (app.vault.adapter as any).getBasePath
    ? `${(app.vault.adapter as any).getBasePath()}/${app.vault.configDir}/plugins/margin-study`
    : `${app.vault.configDir}/plugins/margin-study`;
}

/** base64 data URL → Uint8Array（不依赖 Node Buffer，兼容 Obsidian 渲染进程） */
function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function recognizeWithSwift(app: App, imageDataUrl: string): Promise<OcrWord[]> {
  const scriptPath = `${pluginDir(app)}/ocr.swift`;
  const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, "");
  const bytes = base64ToBytes(base64);
  const cp = (window as any).require("child_process") as typeof import("child_process");
  const fs = (window as any).require("fs") as typeof import("fs");
  const pathMod = (window as any).require("path") as typeof import("path");
  const os = (window as any).require("os") as typeof import("os");
  // 写系统临时目录（避免 vault adapter 路径限制与 Buffer 依赖；用 fs 直接落盘）
  const tmpPath = pathMod.join(os.tmpdir(), `ms-ocr-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`);
  await fs.promises.writeFile(tmpPath, bytes);
  return new Promise((resolve, reject) => {
    cp.execFile("/usr/bin/swift", [scriptPath, tmpPath], { encoding: "utf8", timeout: 90000, maxBuffer: 16 * 1024 * 1024 }, (err: any, stdout: string) => {
      void fs.promises.unlink(tmpPath).catch(() => {});
      if (err) {
        reject(err);
        return;
      }
      try {
        const arr = JSON.parse(stdout || "[]") as OcrWord[];
        if (!Array.isArray(arr)) throw new Error("OCR 输出格式不正确");
        resolve(arr);
      } catch (e) {
        reject(e);
      }
    });
  });
}

/** 对图片进行 OCR；macOS 优先走 Vision/Swift，失败或跨平台时返回空数组（调用方自行提示） */
export async function recognizeImage(app: App, imageDataUrl: string,enabled=true,current:()=>boolean=()=>true): Promise<OcrWord[]> {
  if(!enabled||!current())return [];
  let buffer=buffers.get(app);if(!buffer){buffer=new Map();buffers.set(app,buffer);}
  const saved=buffer.get(imageDataUrl);if(saved)return saved.map(word=>({...word}));
  if (!(await checkSwift())) {
    if(!current())return [];
    new Notice("OCR：未检测到 /usr/bin/swift，当前仅支持 macOS 系统 OCR。");
    return [];
  }
  if(!current())return [];
  try {
    const words=await recognizeWithSwift(app, imageDataUrl);
    if(!current())return [];
    if(imageDataUrl.length<=4_000_000){
      while(buffer.size&&(buffer.size>=8||[...buffer.keys()].reduce((sum,key)=>sum+key.length,0)+imageDataUrl.length>16_000_000))buffer.delete(buffer.keys().next().value!);
      buffer.set(imageDataUrl,words);
    }
    return words.map(word=>({...word}));
  } catch (e) {
    if(!current())return [];
    console.error("MarginStudy OCR failed:", e);
    new Notice("OCR 识别失败：" + (e as Error).message);
    return [];
  }
}

/** Vision 的坐标原点在左下角：从高 y 到低 y 排行，同一行从左到右。 */
export function mergeOcrWords(words: OcrWord[]): string {
  const valid = words.filter((word) => word.text?.trim() && word.w > 0 && word.h > 0 &&
    [word.x, word.y, word.w, word.h].every(Number.isFinite));
  return orderOcrBlock(valid).join("\n");
}

/** Conservative whitespace cut: require three rows on each side of a real gutter.
 * Spanning headings/footers divide the page into independent reading bands.
 * Sparse labels and ordinary spaces keep their original row order. Boxes stay untouched.
 */
function orderOcrBlock(words: OcrWord[], depth = 0): string[] {
  if (depth < 8 && words.length >= 6) {
    const cuts = [...new Set(words.flatMap(word => [word.x, word.x + word.w]))].sort((a,b)=>a-b);
    let best: {left: OcrWord[]; right: OcrWord[]; spanning: OcrWord[]; gap: number} | null = null;
    for (let i=0;i<cuts.length-1;i++) {
      const cut=(cuts[i]+cuts[i+1])/2;
      const left=words.filter(w=>w.x+w.w<=cut),right=words.filter(w=>w.x>=cut);
      const rows=(items:OcrWord[])=>new Set(items.map(w=>Math.round((w.y+w.h/2)/Math.max(.01,w.h)))).size;
      if(rows(left)<3||rows(right)<3)continue;
      const gap=Math.min(...right.map(w=>w.x))-Math.max(...left.map(w=>w.x+w.w));
      if(gap<.06)continue;
      const spanning=words.filter(w=>w.x<cut&&w.x+w.w>cut);
      if(spanning.some(s=>[...left,...right].some(w=>Math.min(s.y+s.h,w.y+w.h)-Math.max(s.y,w.y)>Math.min(s.h,w.h)*.5)))continue;
      if(!best||gap>best.gap)best={left,right,spanning,gap};
    }
    if(best) {
      const {left,right,spanning}=best;
      if(!spanning.length)return [...orderOcrBlock(left,depth+1),...orderOcrBlock(right,depth+1)];
      const bands=[...spanning].sort((a,b)=>b.y-a.y),result:string[]=[];
      let remaining=words.filter(w=>!spanning.includes(w));
      for(const heading of bands){
        const above=remaining.filter(w=>w.y+w.h/2>heading.y+heading.h/2);
        result.push(...orderOcrBlock(above,depth+1),heading.text.trim());
        remaining=remaining.filter(w=>!above.includes(w));
      }
      return [...result,...orderOcrBlock(remaining,depth+1)];
    }
  }
  const sorted = [...words]
    .sort((a, b) => (b.y + b.h / 2) - (a.y + a.h / 2) || a.x - b.x);
  const lines: { words: OcrWord[]; center: number; height: number }[] = [];
  for (const word of sorted) {
    const center = word.y + word.h / 2;
    const line = lines.find((candidate) =>
      Math.abs(candidate.center - center) <= Math.max(0.002, Math.min(candidate.height, word.h) * 0.55));
    if (line) {
      line.center = (line.center * line.words.length + center) / (line.words.length + 1);
      line.height = Math.max(line.height, word.h);
      line.words.push(word);
    } else {
      lines.push({ words: [word], center, height: word.h });
    }
  }
  return lines.sort((a, b) => b.center - a.center)
    .map((line) => line.words.sort((a, b) => a.x - b.x).map((word) => word.text.trim()).join(" "));
}
