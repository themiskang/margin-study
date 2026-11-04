import type { RecallHintRequest } from "../types";
import type { App } from "obsidian";

interface DeviceRecallHintRuntime {
  available?: boolean | (() => boolean);
  generate?: (request: RecallHintRequest) => Promise<string[] | { lines?: unknown }>;
}

function runtime(): DeviceRecallHintRuntime | undefined {
  const candidate = (globalThis as typeof globalThis & { marginStudyDeviceAI?: DeviceRecallHintRuntime }).marginStudyDeviceAI;
  if (!candidate || typeof candidate.generate !== "function") return undefined;
  if (typeof candidate.available === "function" && !candidate.available()) return undefined;
  if (candidate.available === false) return undefined;
  return candidate;
}

export function hasDeviceRecallHintProvider(app?: App): boolean {
  return !!runtime() || !!nativeHelper(app);
}

function nativeHelper(app?: App): string | undefined {
  const require = (window as any).require;
  const base = (app?.vault.adapter as any)?.getBasePath?.();
  if (!require || !app || !base) return undefined;
  const path = require("path") as typeof import("path");
  const fs = require("fs") as typeof import("fs");
  const helper = path.join(base, app.vault.configDir, "plugins", "margin-study", "native", "recall", "recall-hint");
  return fs.existsSync(helper) ? helper : undefined;
}

/** Device models are optional host capabilities; no credentials or network are accessed here. */
export async function requestDeviceRecallHint(request: RecallHintRequest, app?: App): Promise<string[]> {
  const provider = runtime();
  let values: unknown[] = [];
  if (provider?.generate) {
    const result = await provider.generate({ ...request, keywords: [...request.keywords] });
    values = Array.isArray(result) ? result : Array.isArray(result?.lines) ? result.lines : [];
  } else {
    const helper = nativeHelper(app);
    if (!helper) throw new Error("device-ai-unavailable");
    const cp = (window as any).require("child_process") as typeof import("child_process");
    const payload = Buffer.from(JSON.stringify({ ...request, keywords: [...request.keywords] }), "utf8").toString("base64");
    const output = await new Promise<string>((resolve, reject) => {
      cp.execFile(helper, [payload], { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        if (error) { reject(error); return; }
        resolve(String(stdout).trim());
      });
    });
    const response = JSON.parse(output) as { lines?: unknown[]; error?: string; availability?: string };
    if (response.error) throw new Error(response.error + (response.availability ? ":" + response.availability : ""));
    values = Array.isArray(response.lines) ? response.lines : [];
  }
  const normalized = request.excerpt.trim().replace(/\s+/g, " ").toLowerCase();
  return values
    .filter((line): line is string => typeof line === "string")
    .map(line => line.replace(/^[-*#\d.\s]+/, "").trim())
    .filter(line => line && line.length <= 320)
    .filter(line => !normalized || !line.replace(/\s+/g, " ").toLowerCase().includes(normalized))
    .slice(0, 4);
}
