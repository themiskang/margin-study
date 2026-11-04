import type { App } from "obsidian";

export function hasNativePhotoPicker(app: App): boolean {
  try { return (window as any).require("process").platform === "darwin" && typeof (app.vault.adapter as any).getBasePath === "function"; }
  catch { return false; }
}

/** Only explicitly selected item-provider copies are read, never the Photos library. */
export async function pickNativePhotos(app: App, signal: AbortSignal): Promise<File[]> {
  return pickNativeImages(app, signal, "photos");
}

export async function pickNativeCamera(app: App, signal: AbortSignal): Promise<File[]> {
  return pickNativeImages(app, signal, "camera");
}

async function pickNativeImages(app: App, signal: AbortSignal, source: "photos" | "camera"): Promise<File[]> {
  const require = (window as any).require;
  const fs = (require("fs") as typeof import("fs")).promises;
  const path = require("path") as typeof import("path");
  const os = require("os") as typeof import("os");
  const cp = require("child_process") as typeof import("child_process");
  const camera = source === "camera", title = camera ? "系统相机" : "系统照片选择器";
  const bundle = path.join((app.vault.adapter as any).getBasePath(), app.vault.configDir, "plugins", "margin-study", "native", camera ? "MarginStudy Camera.app" : "MarginStudy Photos.app");
  const executable = path.join(bundle, "Contents", "MacOS", camera ? "MarginStudyCamera" : "MarginStudyPhotos");
  if (signal.aborted) return [];
  try { await fs.access(executable); }
  catch { throw new Error(`${title}组件缺失，请重新安装 MarginStudy；也可通过 Files 选择图片`); }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), `marginstudy-${source}-`));
  try {
    if (signal.aborted) return [];
    const stdout = await new Promise<string>((resolve, reject) => {
      // LaunchServices gives Camera its own app identity for macOS authorization.
      const child = cp.execFile(camera ? "/usr/bin/open" : executable, camera ? ["-W", "-n", "-a", bundle, "--args", temporary] : [temporary], { encoding: "utf8", timeout: 600_000, maxBuffer: 64 * 1024 }, async (error, output) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) { resolve(""); return; }
        if (camera) {
          try {
            const result = await fs.readFile(path.join(temporary, "result.json"), "utf8");
            if (result.length > 64 * 1024) throw new Error("camera result too large");
            resolve(result);
          } catch { reject(new Error(`${title}未完成，请重试`)); }
          return;
        }
        if (error) { reject(new Error(`${title}未完成，请重试`)); return; }
        resolve(output);
      });
      const abort = () => child.kill();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    if (signal.aborted) return [];
    let result: {version?: number;status?: string;files?: unknown;message?: string};
    try { result = JSON.parse(stdout); } catch { throw new Error(`${title}返回的数据不完整`); }
    if (result.version !== 1) throw new Error(`${title}版本不匹配`);
    if (result.status === "cancelled") return [];
    if (result.status === "error") throw new Error(result.message || "无法读取所选照片");
    if (result.status !== "selected" || !Array.isArray(result.files) || !result.files.length || result.files.length > (camera ? 1 : 100) || new Set(result.files).size !== result.files.length) throw new Error("系统照片选择结果无效");
    const files: File[] = [];
    for (const name of result.files) {
      if (signal.aborted) return [];
      if (typeof name !== "string" || !/^\d{4}\.png$/.test(name)) throw new Error("系统照片选择结果包含无效文件");
      const filePath = path.join(temporary, name), stat = await fs.stat(filePath);
      if (stat.size <= 0 || stat.size > 100_000_000) throw new Error("所选照片过大或无效");
      const data = await fs.readFile(filePath);
      files.push(new File([new Uint8Array(data)], name, { type: "image/png" }));
    }
    return signal.aborted ? [] : files;
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
