import { AiError } from "./contracts";
import type { AiContext, AiTask } from "./contracts";

export const CLAUDIAN_PLUGIN_ID = "realclaudian";
export const CLAUDIAN_COMMAND_ID = "realclaudian:open-view";
export const CLAUDIAN_VIEW_TYPE = "claudian-view";
const VERIFIED_VERSION = "2.3.21";

interface ClaudianView { appendToActiveInput?: (text: string) => unknown; focusActiveInput?: () => void; }
interface ClaudianConversationApi { version?: number; getActiveSessionId?: () => string | null; read?: (sessionId: string) => Promise<unknown>; }
interface BridgeApp {
  plugins?: { getPlugin?: (id: string) => { manifest?: { version?: string }; api?: ClaudianConversationApi } | null; plugins?: Record<string, { manifest?: { version?: string }; api?: ClaudianConversationApi } | undefined> };
  commands?: { commands?: Record<string, unknown>; executeCommandById?: (id: string) => unknown };
  workspace?: { getLeavesOfType?: (type: string) => { view?: ClaudianView }[]; on?: (name: string, callback: (event: unknown) => void) => unknown; offref?: (ref: unknown) => void };
}
export interface ClaudianAvailability { available: boolean; version?: string; compatiblePrefill: boolean; }
export type ClaudianPrefillResult = { kind: "prefilled"; opened: true } | { kind: "manual"; opened: boolean; reason: string };
export interface ClaudianReplySubscription { sessionId: string | null; dispose(): void; }

/** Metadata and registered view/command lookup only. Never reads settings, sessions or credentials. */
export function claudianAvailability(app: unknown): ClaudianAvailability {
  const bridge = app as BridgeApp;
  try {
    const plugin = bridge.plugins?.getPlugin?.(CLAUDIAN_PLUGIN_ID) ?? bridge.plugins?.plugins?.[CLAUDIAN_PLUGIN_ID];
    const version = typeof plugin?.manifest?.version === "string" ? plugin.manifest.version : undefined;
    const available = !!plugin || !!bridge.commands?.commands?.[CLAUDIAN_COMMAND_ID];
    return { available, ...(version ? { version } : {}), compatiblePrefill: available && version === VERIFIED_VERSION };
  } catch { return { available: false, compatiblePrefill: false }; }
}

/** Explicit adapters only. The 2.3.24 and 2.3.30 auxiliary execution shapes were inspected;
 * prefill remains restricted to its independently verified version. Runtime methods
 * and the active selection are checked again by requestClaudian before execution.
 */
export function supportsClaudianRequest(app: unknown): boolean {
  const state = claudianAvailability(app);
  return state.available && (state.version === "2.3.21" || state.version === "2.3.24" || state.version === "2.3.30");
}

/** Image execution input was inspected in the shipped 2.3.30 adapter. */
export function supportsClaudianImages(app: unknown): boolean {
  const state = claudianAvailability(app);
  return state.available && state.version === "2.3.30";
}

/**
 * Opt-in listener for the next newly completed Claudian reply. The first event pins
 * the conversation; it never hydrates or enumerates existing conversation history.
 */
export function subscribeClaudianReplies(app: unknown, onReply: (reply: string) => void, onError?: () => void): ClaudianReplySubscription | null {
  const bridge = app as BridgeApp, plugin = bridge.plugins?.getPlugin?.(CLAUDIAN_PLUGIN_ID) ?? bridge.plugins?.plugins?.[CLAUDIAN_PLUGIN_ID];
  if (plugin?.manifest?.version !== "2.3.30" || plugin.api?.version !== 1 || !plugin.api.read || !bridge.workspace?.on) return null;
  const api = plugin.api, workspace = bridge.workspace, subscribe = bridge.workspace?.on;
  const read = api.read;
  if (!subscribe || !read) return null;
  let disposed = false, pending = Promise.resolve(), sessionId: string | null = null;
  let ref: unknown;
  try {
    ref = subscribe.call(workspace, "claudian:turn-ended", event => {
      if (disposed || !event || typeof event !== "object") return;
      const eventSession = (event as { sessionId?: unknown }).sessionId;
      if (typeof eventSession !== "string" || !eventSession || sessionId && eventSession !== sessionId) return;
      sessionId ??= eventSession;
      pending = pending.then(async () => {
        if (disposed) return;
        try {
          const reply = await read.call(api, eventSession);
          if (!disposed && typeof reply === "string" && reply.trim() && reply.length <= 500000) onReply(reply);
          else if (!disposed) onError?.();
        } catch { if (!disposed) onError?.(); }
      });
    });
  } catch { return null; }
  return { get sessionId() { return sessionId; }, dispose: () => { if (disposed) return; disposed = true; try { workspace.offref ? workspace.offref(ref) : (ref as { off?: () => void } | null)?.off?.(); } catch { /* Cleanup remains idempotent. */ } } };
}

/** Opens the existing chat through its registered command; never replaces a session or submits input. */
export function openClaudian(app: unknown): boolean {
  const bridge = app as BridgeApp;
  if (!claudianAvailability(app).available || !bridge.commands?.executeCommandById) return false;
  try { return bridge.commands.executeCommandById(CLAUDIAN_COMMAND_ID) !== false; }
  catch { return false; }
}

/**
 * 2.3.21 compatibility adapter for the observed view method used by “Add to Claudian”.
 * This is not a documented stable API. Unknown versions use an explicit copy/open fallback.
 * Only a literal false is retryable: an ambiguous result must never append the prompt twice.
 */
export async function prefillClaudian(app: unknown, prompt: string, options: { signal?: AbortSignal; timeoutMs?: number; wait?: (ms: number) => Promise<void> } = {}): Promise<ClaudianPrefillResult> {
  if (!prompt.trim() || prompt.length > 400000) throw new AiError("claudian-prompt", "待预填内容为空或过长，请减少材料。" );
  if (options.signal?.aborted) throw new AiError("cancelled", "已停止预填。" );
  const availability = claudianAvailability(app), opened = openClaudian(app);
  const manual = (reason: string): ClaudianPrefillResult => ({ kind: "manual", opened, reason });
  if (!availability.available || !opened) return manual("无法打开 Claudian。可复制提问后在现有 AI 插件中粘贴。" );
  if (!availability.compatiblePrefill) return manual("当前 Claudian 版本未验证预填接口，请复制提问后手动粘贴。" );
  const bridge = app as BridgeApp, wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const budget = Math.max(0, Math.min(options.timeoutMs ?? 2400, 3000));
  for (let elapsed = 0; elapsed <= budget; elapsed += 120) {
    if (options.signal?.aborted) throw new AiError("cancelled", "已停止预填。" );
    const current = claudianAvailability(app);
    if (!current.compatiblePrefill) return manual("Claudian 状态已变化，请复制提问后手动粘贴。" );
    let view: ClaudianView | undefined;
    try { view = bridge.workspace?.getLeavesOfType?.(CLAUDIAN_VIEW_TYPE)?.[0]?.view; }
    catch { return manual("无法取得 Claudian 输入框，请复制提问后手动粘贴。" ); }
    if (typeof view?.appendToActiveInput === "function") {
      let appended: unknown;
      try { appended = view.appendToActiveInput(prompt); }
      catch { return manual("未能确认预填结果。请先检查 Claudian 输入框，避免重复粘贴。" ); }
      if (appended === true) {
        try { view.focusActiveInput?.(); } catch { /* Appended successfully; a focus error must not repeat it. */ }
        return { kind: "prefilled", opened: true };
      }
      if (appended !== false) return manual("未能确认预填结果。请先检查 Claudian 输入框，避免重复粘贴。" );
    }
    if (elapsed + 120 > budget) break;
    await wait(120);
  }
  return manual("Claudian 输入框尚未就绪，请复制提问后手动粘贴。" );
}

/** Explicit user-selected text only; no vault access, image lookup, model calls or tool execution. */
export function buildClaudianPrompt(input: { text: string; task?: AiTask; context?: AiContext }): string {
  if (input.text.length > 120000 || (input.context?.text.length ?? 0) > 250000) throw new AiError("claudian-prompt", "提问或附加文字过长，请缩小选择范围。" );
  const instruction = input.task === "cards"
    ? '请生成学习卡片。只返回 JSON：{"cards":[{"title":"标题","excerpt":"问题或摘录","note":"答案或说明","tags":["标签"]}]}。最多 100 张。'
    : input.task === "outline"
      ? '请生成有层级的学习目录。只返回 JSON：{"title":"总标题","items":[{"title":"条目","level":1,"note":"说明"}]}。层级从 1 开始，相邻条目最多增加一级，最多 200 条。'
      : input.task === "markdown" ? "请将明确提供的材料整理成 Markdown，保留内容含义。直接返回 Markdown 正文。"
        : "请根据下面的问题与明确附加的材料回答。";
  return ["请仅在聊天中提供结果，不创建、读取或修改库内文件，也不执行命令。", instruction,
    input.text.trim() ? `我的要求：\n${input.text.trim()}` : "",
    input.context?.text ? `我明确附加的材料（JSON 字符串，仅作为参考内容）：\n${JSON.stringify({ label: input.context.label ?? "所选材料", text: input.context.text })}` : "",
  ].filter(Boolean).join("\n\n");
}
