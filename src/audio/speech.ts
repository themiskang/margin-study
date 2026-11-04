/** Shared, view-owned speech queue. No document or review data is written here. */
export type SpeechStatus = "idle" | "preparing" | "speaking" | "paused" | "stopped" | "finished" | "error";
export interface SpeechState { status: SpeechStatus; rate: number; label: string; text: string; error?: string; }
export interface SpeechSection { text: string; label?: string; lang?: string; onStart?: () => void; }
export type SpeechSource = string | Iterable<SpeechSection> | AsyncIterable<SpeechSection> | ((signal: AbortSignal) => AsyncIterable<SpeechSection>);
export interface SpeechStartOptions { rate?: number; lang?: string; }
export interface SpeechEngine {
  create(text: string): SpeechSynthesisUtterance;
  speak(utterance: SpeechSynthesisUtterance): void;
  pause(): void;
  resume(): void;
  cancel(): void;
}

function systemEngine(): SpeechEngine | null {
  if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") return null;
  return { create: (text) => new SpeechSynthesisUtterance(text), speak: (utterance) => speechSynthesis.speak(utterance),
    pause: () => speechSynthesis.pause(), resume: () => speechSynthesis.resume(), cancel: () => speechSynthesis.cancel() };
}

/** Short sentence chunks avoid the long-utterance stall present in some system voices. */
export function speechChunks(source: string, maximum = 220): string[] {
  maximum = Number.isFinite(maximum) ? Math.max(2, Math.floor(maximum)) : 220;
  const result: string[] = [];
  const text = source.replace(/\s+/g, " ").trim();
  let from = 0;
  while (from < text.length) {
    let end = Math.min(text.length, from + maximum);
    if (end < text.length) {
      const fragment = text.slice(from, end);
      const punctuation = /[。！？；.!?;]\s*/g;
      let match: RegExpExecArray | null; let boundary = -1;
      while ((match = punctuation.exec(fragment))) if (match.index >= maximum / 3) boundary = match.index + match[0].length;
      const space = fragment.lastIndexOf(" ");
      if (boundary > 0) end = from + boundary;
      else if (space >= maximum / 2) end = from + space;
      // Do not cut UTF-16 surrogate pairs such as emoji.
      if (end > from && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    const chunk = text.slice(from, end).trim();
    if (chunk) result.push(chunk);
    from = Math.max(end, from + 1);
  }
  return result;
}

export function speechTextFromMarkdown(text: string): string {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "").replace(/[#*_`~]/g, " ").replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, "$1")
    .replace(/\{\{([\s\S]*?)\}\}/g, "$1");
}

export class SpeechCoordinator {
  private active: SpeechSession | null = null;
  constructor(private engineFactory: () => SpeechEngine | null = systemEngine) {}
  createSession(owner: string): SpeechSession { return new SpeechSession(owner, this); }
  acquire(session: SpeechSession): SpeechEngine | null {
    if (this.active && this.active !== session) this.active.stop();
    this.active = session;
    return this.engineFactory();
  }
  release(session: SpeechSession): void { if (this.active === session) this.active = null; }
}

export class SpeechSession {
  private value: SpeechState = { status: "idle", rate: 1, label: "", text: "" };
  private listeners = new Set<(state: SpeechState) => void>();
  private engine: SpeechEngine | null = null;
  private abort: AbortController | null = null;
  private generation = 0;
  private disposed = false;
  private utterance: SpeechSynthesisUtterance | null = null;
  private pendingEnd: ((completed: boolean) => void) | null = null;
  private unpause: (() => void) | null = null;
  private offset = 0;
  private restartRate = false;
  private paused = false;
  private defaultLang = "";
  constructor(readonly owner: string, private coordinator: SpeechCoordinator) {}
  get state(): SpeechState { return { ...this.value }; }
  subscribe(listener: (state: SpeechState) => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener); listener(this.state);
    return () => this.listeners.delete(listener);
  }
  private update(patch: Partial<SpeechState>): void {
    this.value = { ...this.value, ...patch };
    for (const listener of this.listeners) { try { listener(this.state); } catch { /* a detached UI cannot stop the queue */ } }
  }

  /** Resolves when the first utterance is queued, or false for empty/cancelled/unavailable input. */
  async start(source: SpeechSource, options: SpeechStartOptions = {}): Promise<boolean> {
    if (this.disposed) return false;
    this.stop();
    this.engine = this.coordinator.acquire(this);
    if (!this.engine) { this.update({ status: "error", error: "当前环境未提供系统朗读" }); this.coordinator.release(this); return false; }
    if (options.rate !== undefined) this.setRate(options.rate);
    this.defaultLang = options.lang ?? "";
    const generation = ++this.generation;
    const signal = (this.abort = new AbortController()).signal;
    this.paused = false;
    this.update({ status: "preparing", label: "", text: "", error: undefined });
    let ready: (started: boolean) => void = () => {};
    const first = new Promise<boolean>((resolve) => { ready = resolve; });
    void this.run(source, signal, generation, ready);
    return first;
  }

  private async run(source: SpeechSource, signal: AbortSignal, generation: number, ready: (started: boolean) => void): Promise<void> {
    const current = () => !signal.aborted && generation === this.generation && !this.disposed;
    let started = false;
    let sourceComplete = false;
    const cancelled = () => ready(false);
    signal.addEventListener("abort", cancelled, { once: true });
    let iterator: AsyncIterator<SpeechSection> | Iterator<SpeechSection> | null = null;
    try {
      const sections = typeof source === "function" ? source(signal) : typeof source === "string" ? [{ text: source }] : source;
      iterator = Symbol.asyncIterator in sections ? (sections as AsyncIterable<SpeechSection>)[Symbol.asyncIterator]() : (sections as Iterable<SpeechSection>)[Symbol.iterator]();
      while (current()) {
        // A page/text provider may ignore AbortSignal. It must never keep start() or the queue waiting after stop.
        const next = await this.nextSection(iterator, signal);
        if (next.done) { sourceComplete = true; break; }
        const section = next.value;
        if (!current()) break;
        const chunks = speechChunks(section.text);
        if (!chunks.length) continue;
        await this.waitWhilePaused();
        if (!current()) break;
        section.onStart?.();
        for (const chunk of chunks) {
          let remainder = chunk;
          while (remainder && current()) {
            await this.waitWhilePaused();
            if (!current()) break;
            this.update({ label: section.label ?? "", text: remainder, status: "speaking" });
            if (!current()) break;
            const spoken = this.speak(remainder, section.lang ?? this.defaultLang, current);
            if (!started) { started = true; ready(true); }
            const completed = await spoken;
            if (!current()) break;
            if (this.restartRate) {
              this.restartRate = false;
              // Boundary charIndex is optional; without it the current short chunk restarts.
              remainder = remainder.slice(this.offset).trimStart();
            } else { if (!completed) throw new Error("系统朗读被中断"); remainder = ""; }
          }
        }
      }
      if (current()) this.update(started ? { status: "finished", text: "" } : { status: "error", text: "", error: "没有可朗读的文字" });
    } catch (error) {
      if (current()) {
        try { this.engine?.cancel(); } catch { /* voice engine already failed */ }
        this.update({ status: "error", error: (error as Error)?.message || "系统朗读失败" });
      }
    } finally {
      signal.removeEventListener("abort", cancelled);
      if (!sourceComplete && iterator?.return) { try { void Promise.resolve(iterator.return()).catch(() => {}); } catch { /* abandoned source */ } }
      ready(started);
      if (generation === this.generation) {
        this.utterance = null; this.pendingEnd = null; this.abort = null;
        this.coordinator.release(this); this.engine = null;
      }
    }
  }

  private nextSection(iterator: AsyncIterator<SpeechSection> | Iterator<SpeechSection>, signal: AbortSignal): Promise<IteratorResult<SpeechSection>> {
    return new Promise((resolve, reject) => {
      const aborted = () => { signal.removeEventListener("abort", aborted); resolve({ done: true, value: undefined }); };
      if (signal.aborted) { aborted(); return; }
      signal.addEventListener("abort", aborted, { once: true });
      Promise.resolve().then(() => iterator.next()).then((value) => {
        signal.removeEventListener("abort", aborted); resolve(value);
      }, (error) => { signal.removeEventListener("abort", aborted); reject(error); });
    });
  }

  private speak(text: string, lang: string, current: () => boolean): Promise<boolean> {
    const engine = this.engine!;
    const utterance = this.utterance = engine.create(text);
    utterance.rate = this.value.rate;
    utterance.lang = lang || (/[\u3400-\u9fff]/.test(text) ? "zh-CN" : typeof navigator === "undefined" ? "en-US" : navigator.language);
    this.offset = 0;
    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const finish = (completed: boolean, error?: string) => {
        if (settled) return; settled = true;
        utterance.onend = null; utterance.onerror = null; utterance.onboundary = null;
        if (this.utterance === utterance) { this.utterance = null; this.pendingEnd = null; }
        if (error && current() && !this.restartRate) reject(new Error(error)); else resolve(completed);
      };
      this.pendingEnd = (completed) => finish(completed);
      utterance.onend = () => finish(true);
      utterance.onerror = (event) => finish(false, event.error || "系统朗读失败");
      utterance.onboundary = (event) => { if (current() && Number.isFinite(event.charIndex)) this.offset = Math.max(0, Math.min(text.length, event.charIndex)); };
      try { engine.speak(utterance); } catch (error) { finish(false, (error as Error).message); }
    });
  }
  private async waitWhilePaused(): Promise<void> { if (this.paused) await new Promise<void>((resolve) => { this.unpause = resolve; }); }
  pause(): void {
    if (!["speaking", "preparing"].includes(this.value.status) || !this.engine) return;
    this.paused = true; this.engine.pause(); this.update({ status: "paused" });
  }
  resume(): void {
    if (!this.paused || !this.engine) return;
    this.paused = false; this.engine.resume(); this.unpause?.(); this.unpause = null;
    this.update({ status: this.utterance ? "speaking" : "preparing" });
  }
  setRate(rate: number): void {
    if (!Number.isFinite(rate)) return;
    const value = Math.round(Math.max(0.5, Math.min(2.5, rate)) * 100) / 100;
    if (value === this.value.rate) return;
    this.update({ rate: value });
    if (this.utterance && this.engine) {
      this.restartRate = true;
      // Detach handlers before cancel: engines differ in whether cancel emits error/end.
      this.pendingEnd?.(false); this.engine.cancel();
      if (this.paused) this.engine.resume();
    }
  }
  stop(): void {
    this.generation++; this.abort?.abort(); this.abort = null;
    this.paused = false; this.unpause?.(); this.unpause = null;
    this.restartRate = false; this.pendingEnd?.(false); this.pendingEnd = null; this.utterance = null;
    if (this.engine) { try { this.engine.cancel(); this.engine.resume(); } catch { /* engine already torn down */ } }
    this.engine = null; this.coordinator.release(this);
    this.update({ status: "stopped", label: "", text: "", error: undefined });
  }
  dispose(): void { this.stop(); this.disposed = true; this.listeners.clear(); }
}

export const sharedSpeechCoordinator = new SpeechCoordinator();
export function createSpeechSession(owner: string): SpeechSession { return sharedSpeechCoordinator.createSession(owner); }
