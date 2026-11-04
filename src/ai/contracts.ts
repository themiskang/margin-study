import type { App } from "obsidian";
import type { Store } from "../model/store";

export type ModelTier = "mini" | "normal";
export type AiTask = "chat" | "cards" | "outline" | "markdown" | "condense";
export interface AiContext { text: string; label?: string; docPath?: string; }
export interface AiHost { app: App; store: Store; }
export interface AiProfile {
  id: string;
  endpoint: string;
  miniModel: string;
  normalModel: string;
  revision: number;
  bound?: { revision: number; passedAt: string };
}
export interface AiConfiguration extends AiProfile { hasSavedKey: boolean; }
export interface ProfileInput { endpoint: string; miniModel: string; normalModel: string; /** Omit to retain an existing secret; empty explicitly clears it. */ apiKey?: string; }
export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string }; }
export type MessagePart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | MessagePart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface ToolDefinition { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown>; strict?: boolean }; }
export interface CompletionBody {
  model: string;
  messages: ChatMessage[];
  stream: true;
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
}
export interface CompletionResult { text: string; toolCalls: ToolCall[]; }
export interface ChatTransport {
  stream(endpoint: string, apiKey: string, body: CompletionBody, signal?: AbortSignal): AsyncIterable<Uint8Array | string>;
}
export interface CardProposal { title: string; excerpt: string; note: string; tags: string[]; }
export interface OutlineProposal { title: string; items: { title: string; level: number; note: string }[]; }
export type AiDraft =
  | { kind: "cards"; cards: CardProposal[] }
  | { kind: "outline"; title: string; items: OutlineProposal["items"] }
  | { kind: "markdown"; title: string; markdown: string };
export interface AiRequest {
  text: string;
  task?: AiTask;
  tier?: ModelTier;
  context?: AiContext;
  images?: string[];
  history?: ChatMessage[];
  signal?: AbortSignal;
  onText?: (fragment: string) => void;
  onDraft?: (draft: AiDraft) => void;
}
export interface AiResponse { text: string; messages: ChatMessage[]; drafts: AiDraft[]; }
export class AiError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "AiError"; }
}
/** Never surface provider response bodies, request headers or arbitrary caught text. */
export function aiErrorText(error: unknown): string {
  return error instanceof AiError ? error.message : "AI 请求未完成，请检查连接后重试。";
}
