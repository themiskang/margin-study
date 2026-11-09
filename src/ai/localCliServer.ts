import * as http from "http";
import * as crypto from "crypto";
import type { Store } from "../model/store";
import type { LocalCliOrganizeRequest, LocalCliService, LocalCliState } from "./contracts";

const MAX_BODY_BYTES = 64 * 1024;
type Handler = (request: http.IncomingMessage, response: http.ServerResponse) => void;
type ServerFactory = (handler: Handler) => http.Server;

function respond(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(body));
}

function validAddress(request: http.IncomingMessage, port: number | null): boolean {
  const host = request.headers.host;
  if (request.socket.remoteAddress !== "127.0.0.1" || !host || (host !== "127.0.0.1" && host !== `127.0.0.1:${port}`)) return false;
  return !["origin", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip"].some(header => request.headers[header] !== undefined);
}

function validToken(header: string | undefined, token: string | null): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const supplied = header.slice(7);
  if (supplied.length !== token.length) return false;
  let difference = 0;
  for (let index = 0; index < token.length; index++) difference |= supplied.charCodeAt(index) ^ token.charCodeAt(index);
  return difference === 0;
}

function organizeInput(value: unknown): LocalCliOrganizeRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["action", "cardIds", "tags"].includes(key)) || input.action !== "add-tags") return null;
  if (!Array.isArray(input.cardIds) || !input.cardIds.length || input.cardIds.length > 100 || input.cardIds.some(id => typeof id !== "string" || !id || id.length > 200)) return null;
  if (!Array.isArray(input.tags) || !input.tags.length || input.tags.length > 50 || input.tags.some(tag => typeof tag !== "string" || !tag.trim() || tag.length > 200)) return null;
  return { action: "add-tags", cardIds: [...new Set(input.cardIds)] as string[], tags: [...new Set(input.tags.map(tag => tag.trim()))] as string[] };
}

export function createLocalCliServer(store: Store, factory: ServerFactory = handler => http.createServer(handler)): LocalCliService {
  let server: http.Server | null = null;
  let starting: Promise<void> | null = null;
  let stopping: Promise<void> | null = null;
  let state: LocalCliState = { enabled: false, port: null, token: null, allowWrites: false };
  const token = () => crypto.randomBytes(32).toString("hex");

  const handle: Handler = (request, response) => {
    void (async () => {
      if (!state.enabled || !validAddress(request, state.port)) { respond(response, 403, { error: "forbidden" }); return; }
      if (!validToken(request.headers.authorization, state.token)) { respond(response, 401, { error: "unauthorized" }); return; }
      if (request.method === "GET" && request.url === "/status") {
        respond(response, 200, { enabled: true, allowWrites: state.allowWrites, revision: store.getRevision() }); return;
      }
      if (request.method === "GET" && request.url === "/documents") { respond(response, 200, { documents: store.documents }); return; }
      if (request.method === "GET" && request.url === "/cards") { respond(response, 200, { cards: store.cards }); return; }
      if (request.method !== "POST" || request.url !== "/organize") { respond(response, 404, { error: "not found" }); return; }
      if (!state.allowWrites) { respond(response, 403, { error: "writing disabled" }); return; }
      if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers["content-type"] ?? "")) { respond(response, 415, { error: "JSON required" }); return; }
      const requestToken = state.token;
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_BODY_BYTES) { respond(response, 413, { error: "body too large" }); return; }
        chunks.push(bytes);
      }
      if (!state.enabled || !state.allowWrites || !validAddress(request, state.port)) { respond(response, 403, { error: "forbidden" }); return; }
      if (requestToken !== state.token || !validToken(request.headers.authorization, state.token)) { respond(response, 401, { error: "unauthorized" }); return; }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { respond(response, 400, { error: "invalid JSON" }); return; }
      const input = organizeInput(body);
      if (!input || input.cardIds.some(id => !store.getCard(id))) { respond(response, 400, { error: "invalid organize command" }); return; }
      let changed = 0;
      store.libraryTransaction("本地连接：添加标签", () => {
        for (const id of input.cardIds) {
          const card = store.getCard(id)!;
          const tags = [...new Set([...card.tags, ...input.tags])];
          if (tags.length !== card.tags.length) { store.updateCard(id, { tags }); changed++; }
        }
      });
      respond(response, 200, { changed });
    })().catch(() => { if (!response.headersSent) respond(response, 500, { error: "request failed" }); else response.destroy(); });
  };

  return {
    async start() {
      if (server || stopping) throw new Error("本地连接正在运行或启动中。");
      const next = factory(handle); server = next;
      try {
        starting = new Promise<void>((resolve, reject) => {
          const fail = (error: Error) => { next.removeListener("error", fail); reject(error); };
          next.once("error", fail);
          next.listen(0, "127.0.0.1", () => { next.removeListener("error", fail); resolve(); });
        });
        await starting;
        if (stopping) throw new Error("本地连接已关闭。");
        const address = next.address();
        if (!address || typeof address === "string" || address.address !== "127.0.0.1") throw new Error("本地连接未绑定 IPv4 回环地址。");
        state = { enabled: true, port: address.port, token: token(), allowWrites: false };
        next.on("error", () => { void this.stop().catch(() => {}); });
        next.on("close", () => {
          if (server === next && !stopping) { server = null; state = { enabled: false, port: null, token: null, allowWrites: false }; }
        });
      } catch (error) {
        if (!stopping) {
          if (server === next) server = null;
          if (next.listening) next.close();
        }
        throw error;
      } finally {
        starting = null;
      }
    },
    async stop() {
      state = { enabled: false, port: null, token: null, allowWrites: false };
      if (stopping) return stopping;
      const current = server;
      if (!current) return;
      stopping = (async () => {
        try { await starting; } catch { /* startup failed before listening */ }
        if (current.listening) await new Promise<void>((resolve, reject) => {
          current.close(error => error ? reject(error) : resolve());
          current.closeAllConnections?.();
        });
        if (server === current) server = null;
      })();
      try { await stopping; } finally { stopping = null; }
    },
    getState() { return { ...state }; },
    rotateToken() {
      if (!state.enabled) throw new Error("请先启用本地连接。");
      state.token = token(); return state.token;
    },
    setWriteEnabled(enabled) {
      if (!state.enabled && enabled) throw new Error("请先启用本地连接。");
      state.allowWrites = enabled;
    },
  };
}
