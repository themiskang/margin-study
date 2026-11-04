import * as http from "http";
import * as https from "https";
import { AiError } from "./contracts";
import type { ChatTransport, CompletionBody, CompletionResult, ToolCall } from "./contracts";

export function validateEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new AiError("endpoint", "请填写完整的 Chat Completions 地址。" ); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash
    || !url.pathname.replace(/\/$/, "").endsWith("/chat/completions")) {
    throw new AiError("endpoint", "地址须为 http(s) 的完整 /chat/completions 端点，密钥请填写在独立输入框。" );
  }
  if ([...url.searchParams.keys()].some(key => /key|token|secret|authorization/i.test(key))) {
    throw new AiError("endpoint", "请将密钥从地址移至 API Key 输入框。" );
  }
  return url.href;
}

/** Desktop Node transport avoids renderer CORS and never follows credential-bearing redirects. */
export class DesktopChatTransport implements ChatTransport {
  async *stream(endpoint: string, apiKey: string, body: CompletionBody, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    if (signal?.aborted) throw new AiError("aborted", "已停止生成。" );
    const url = new URL(validateEndpoint(endpoint));
    const payload = JSON.stringify(body);
    let request: http.ClientRequest | undefined;
    let response: http.IncomingMessage | undefined;
    const abort = () => { const error = new AiError("aborted", "已停止生成。" ); response?.destroy(error); request?.destroy(error); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        request = (url.protocol === "https:" ? https : http).request(url, {
          method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream", "Content-Length": Buffer.byteLength(payload),
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        }, resolve);
        request.setTimeout(120000, () => request?.destroy(new AiError("timeout", "AI 服务响应超时，请重试。" )));
        request.on("error", reject); request.end(payload);
      });
      if (signal?.aborted) throw new AiError("aborted", "已停止生成。" );
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) { response.resume(); throw new AiError("http", `AI 服务返回 HTTP ${status}，请检查地址、模型和密钥。`); }
      if (!String(response.headers["content-type"] ?? "").toLowerCase().includes("text/event-stream")) {
        response.resume(); throw new AiError("stream", "服务未返回流式 SSE 响应，请确认兼容 Chat Completions。" );
      }
      let bytes = 0;
      for await (const chunk of response) {
        bytes += chunk.length;
        if (bytes > 12 * 1024 * 1024) throw new AiError("size", "AI 响应过长，请缩小输入范围。" );
        yield chunk;
      }
    } catch (error) {
      if (signal?.aborted) throw new AiError("aborted", "已停止生成。" );
      if (error instanceof AiError) throw error;
      throw new AiError("network", "无法连接 AI 服务，请检查服务是否运行和网络设置。" );
    } finally {
      signal?.removeEventListener("abort", abort);
      response?.destroy(); request?.destroy();
    }
  }
}

/** SSE framing tolerates CRLF, multi-line data and arbitrary UTF-8/network boundaries. */
export async function* sseData(chunks: AsyncIterable<Uint8Array | string>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = "", lines: string[] = [];
  const consume = (line: string): string | undefined => {
    if (line === "") { const data = lines.length ? lines.join("\n") : undefined; lines = []; return data; }
    if (line.startsWith("data:")) lines.push(line.slice(5).replace(/^ /, ""));
    return undefined;
  };
  for await (const chunk of chunks) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    if (buffer.length > 2 * 1024 * 1024) throw new AiError("size", "AI 流式响应片段过长。" );
    while (true) {
      const boundary = /[\r\n]/.exec(buffer); if (!boundary) break;
      const index = boundary.index;
      if (buffer[index] === "\r" && index === buffer.length - 1) break;
      const length = buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
      const line = buffer.slice(0, index); buffer = buffer.slice(index + length);
      const data = consume(line); if (data !== undefined) yield data;
    }
  }
  buffer += decoder.decode();
  if (buffer) { const data = consume(buffer.replace(/\r$/, "")); if (data !== undefined) yield data; }
  if (lines.length) yield lines.join("\n");
}

export async function streamCompletion(transport: ChatTransport, endpoint: string, key: string, body: CompletionBody,
  signal?: AbortSignal, onText?: (fragment: string) => void): Promise<CompletionResult> {
  let text = "", finished = false, done = false, emitted = false;
  const calls = new Map<number, ToolCall>();
  for await (const data of sseData(transport.stream(endpoint, key, body, signal))) {
    if (signal?.aborted) throw new AiError("aborted", "已停止生成。" );
    if (data.trim() === "[DONE]") { done = true; break; }
    let chunk: any;
    try { chunk = JSON.parse(data); } catch { throw new AiError("sse", "AI 服务返回了无效的流式 JSON。" ); }
    if (chunk.error) throw new AiError("provider", "AI 服务报告请求失败，请检查模型和额度。" );
    const choice = chunk.choices?.find((candidate: any) => candidate.index === 0) ?? chunk.choices?.[0];
    if (!choice) continue; // Usage-only chunks have no choices.
    if (choice.finish_reason != null) {
      if (!["stop", "tool_calls", "function_call"].includes(choice.finish_reason)) throw new AiError("incomplete", "AI 输出未完成，请缩小输入或重试。" );
      finished = true;
    }
    const delta = choice.delta;
    if (!delta || typeof delta !== "object") continue;
    if (typeof delta.content === "string" && delta.content) {
      text += delta.content; emitted = true;
      if (text.length > 2 * 1024 * 1024) throw new AiError("size", "AI 文本过长，请缩小输入范围。" );
      onText?.(delta.content);
    }
    if (delta.tool_calls !== undefined && !Array.isArray(delta.tool_calls)) throw new AiError("tools", "服务的流式工具格式不兼容。" );
    for (const piece of delta.tool_calls ?? []) {
      const index = piece.index;
      if (!Number.isInteger(index) || index < 0 || index > 15) throw new AiError("tools", "工具调用缺少有效序号。" );
      const call = calls.get(index) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
      if (typeof piece.id === "string") call.id += piece.id;
      if (piece.type !== undefined && piece.type !== "function") throw new AiError("tools", "仅支持 function 工具调用。" );
      if (typeof piece.function?.name === "string") call.function.name += piece.function.name;
      if (typeof piece.function?.arguments === "string") call.function.arguments += piece.function.arguments;
      if (call.id.length > 256 || call.function.name.length > 128 || call.function.arguments.length > 128 * 1024) throw new AiError("size", "工具调用内容过长。" );
      calls.set(index, call); emitted = true;
    }
  }
  if (!emitted || !done && !finished) throw new AiError("incomplete", "AI 流式响应中断或为空，请重试。" );
  const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
  if (new Set(toolCalls.map(call => call.id)).size !== toolCalls.length || toolCalls.some(call => !call.id || !call.function.name)) throw new AiError("tools", "流式工具调用缺少标识或函数名。" );
  return { text, toolCalls };
}
