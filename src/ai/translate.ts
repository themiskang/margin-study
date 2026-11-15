import type MarginStudyPlugin from "../main";
import { aiServiceFor } from "./panel";
import { AiError } from "./contracts";
import { ReaderView } from "../pdf/readerView";

export interface TranslateResult { text: string; service: string; model: string; }
export interface TranslateInput { text: string; language: string; signal?: AbortSignal; }
export interface TranslateIntoPageResult { noteId: string; boxId: string; }

const MAX_TRANSLATE_CHARS = 20000;

function serviceName(endpoint: string): string {
  try { return new URL(endpoint).host || "自定义服务"; } catch { return "自定义服务"; }
}

/** 通过既有 AI 通道生成译文；不打开外部网页，不读取 Claudian 历史。 */
export async function translateSelection(plugin: MarginStudyPlugin, input: TranslateInput): Promise<TranslateResult> {
  const text = input.text.trim(), language = input.language.trim();
  if (!text) throw new AiError("empty", "请先选择要翻译的文字。");
  if (!language) throw new AiError("empty", "请先选择译文语言。");
  if (text.length > MAX_TRANSLATE_CHARS) throw new AiError("size", `一次最多翻译 ${MAX_TRANSLATE_CHARS} 个字符，请缩小选区。`);
  const service = aiServiceFor(plugin);
  if (!service.isBound()) throw new AiError("unbound", "页内翻译需要先在 AI 设置中测试并绑定服务；不会打开外部翻译网页。");
  if (input.signal?.aborted) throw new AiError("aborted", "已取消翻译。");
  const response = await service.request({
    task: "chat",
    tier: "normal",
    text: `把下面内容翻译成${language}。只输出译文本身，不要解释、不要保留原文、不要添加标题。`,
    context: { text },
    signal: input.signal,
  });
  if (input.signal?.aborted) throw new AiError("aborted", "已取消翻译。");
  const translated = response.text.trim();
  if (!translated) throw new AiError("empty-result", "服务未返回译文。");
  return { text: translated, service: serviceName(service.configuration().endpoint), model: service.configuration().normalModel };
}

/** 当前阅读器是否为可插入页内译文的 PDF。 */
export function canTranslateInPage(plugin: MarginStudyPlugin): boolean {
  const reader = plugin.activeReader;
  return reader instanceof ReaderView && !!reader.getPdfPageEdits();
}

/** 把译文作为可编辑文字框插入当前 PDF 页；一次历史，撤销只移除本次译文。 */
export async function translateIntoPage(plugin: MarginStudyPlugin, input: TranslateInput & { sourceAnnId?: string }): Promise<TranslateIntoPageResult> {
  const reader = plugin.activeReader;
  if (!(reader instanceof ReaderView) || !reader.getPdfPageEdits()) throw new AiError("unsupported", "页内翻译只支持 PDF 文档。");
  return reader.translateSelectionIntoPage({ text: input.text, language: input.language, sourceAnnId: input.sourceAnnId, signal: input.signal });
}
