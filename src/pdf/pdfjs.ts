import * as pdfjsLib from "pdfjs-dist";
import type { App } from "obsidian";

let workerCode: string | null = null;
let workerSupported: boolean | null = null;
let isolatedHandler: unknown = null;

/** 仅读取插件自己的 worker，不在 Obsidian 主窗口注册 pdfjsWorker 或改写 fetch。 */
export async function initPdfWorker(app: App): Promise<void> {
  if (workerCode) return;
  const workerPath = `${app.vault.configDir}/plugins/margin-study/pdf.worker.js`;
  workerCode = await app.vault.adapter.read(workerPath);
}

function abortError(): Error { return new DOMException("文档加载已取消", "AbortError"); }

/** CSP 允许时使用真正的后台 Worker；ready 探测失败后及时释放并降级。 */
async function tryWorker(signal?: AbortSignal): Promise<Worker | null> {
  if (!workerCode || workerSupported === false || typeof Worker === "undefined") return null;
  if (signal?.aborted) throw abortError();
  let worker: Worker;
  let url: string;
  try {
    url = URL.createObjectURL(new Blob([workerCode], { type: "application/javascript" }));
    try { worker = new Worker(url); }
    catch (error) { URL.revokeObjectURL(url); throw error; }
  } catch {
    workerSupported = false;
    return null;
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (ready: boolean, aborted = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener("message", message);
      worker.removeEventListener("error", error);
      signal?.removeEventListener("abort", abort);
      URL.revokeObjectURL(url);
      if (!ready) worker.terminate();
      if (aborted) { reject(abortError()); return; }
      workerSupported = ready;
      resolve(ready ? worker : null);
    };
    const message = (event: MessageEvent) => { if (event.data?.action === "ready") finish(true); };
    const error = (event: ErrorEvent) => { event.preventDefault(); finish(false); };
    const abort = () => finish(false, true);
    const timer = setTimeout(() => finish(false), 3000);
    worker.addEventListener("message", message);
    worker.addEventListener("error", error);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/**
 * 旧版 Obsidian 的 CSP 可能禁止 Worker。兼容降级在私有容器内解释固定版本的
 * PDF.js worker：self/globalThis/fetch/module 全部局部化，字体 fetch 钩子也不泄漏。
 */
function prepareIsolatedFallback(): void {
  if (isolatedHandler) return;
  if (!workerCode) throw new Error("PDF worker 尚未加载，请检查插件安装文件");
  const sandbox = Object.create(globalThis) as Record<string, any>;
  sandbox.fetch = globalThis.fetch.bind(globalThis);
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const localModule = { exports: {} as Record<string, unknown> };
  const evaluate = new Function("self", "globalThis", "module", "exports", "require", "fetch", "window", "process",
    workerCode + "\nreturn module.exports;");
  const exports = evaluate.call(sandbox, sandbox, sandbox, localModule, localModule.exports, undefined,
    (...args: Parameters<typeof fetch>) => sandbox.fetch(...args), {}, undefined);
  isolatedHandler = exports.WorkerMessageHandler;
  if (!isolatedHandler) throw new Error("PDF worker 缺少 WorkerMessageHandler");
  // 固定 PDF.js 3.11 的私有降级 Seam，只作用于本插件打包的 PDFWorker 类。
  Object.defineProperty(pdfjsLib.PDFWorker, "_mainThreadWorkerMessageHandler", {
    get: () => isolatedHandler, configurable: true,
  });
  pdfjsLib.GlobalWorkerOptions.workerSrc = "ms-isolated://margin-study-worker";
}

export async function loadPdf(data: ArrayBuffer, signal?: AbortSignal): Promise<pdfjsLib.PDFDocumentProxy> {
  if (signal?.aborted) throw abortError();
  const nativeWorker = await tryWorker(signal);
  if (signal?.aborted) { nativeWorker?.terminate(); throw abortError(); }
  if (!nativeWorker) prepareIsolatedFallback();
  // 3.11 随包声明把 port 错误地推断为 null，运行时支持标准 Worker。
  const WorkerConstructor = pdfjsLib.PDFWorker as unknown as new (options: { port?: Worker }) => pdfjsLib.PDFWorker;
  const worker = nativeWorker ? new WorkerConstructor({ port: nativeWorker }) : new WorkerConstructor({});
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try { await worker.destroy(); }
    finally { nativeWorker?.terminate(); }
  };
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(data), worker,
    cMapUrl: "ms-local://cmaps/", cMapPacked: true,
    standardFontDataUrl: "ms-local://fonts/", useWorkerFetch: true,
  });
  const abort = () => { void loadingTask.destroy().catch(() => {}).finally(cleanup); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const doc = await loadingTask.promise;
    if (signal?.aborted) { await doc.destroy(); throw abortError(); }
    const destroy = doc.destroy.bind(doc);
    doc.destroy = async () => { try { await destroy(); } finally { await cleanup(); } };
    return doc;
  } catch (error) {
    await cleanup();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export { pdfjsLib };
