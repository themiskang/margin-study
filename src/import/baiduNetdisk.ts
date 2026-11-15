import { requestUrl } from "obsidian";

/** 百度网盘开放平台配置。令牌只保存在用户自己的库设置中，不写日志。 */
export interface BaiduNetdiskSettings {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  rootPath?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface BaiduFileEntry {
  fs_id: number;
  path: string;
  server_filename: string;
  size: number;
  isdir: 0 | 1;
  server_mtime?: number;
  server_ctime?: number;
  category?: number;
  md5?: string;
}

export interface BaiduListPage { entries: BaiduFileEntry[]; start: number; limit: number; hasMore: boolean; }
export interface BaiduUploadResult { path: string; fs_id?: number; size: number; md5?: string; }

export interface CloudRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
  contentType?: string;
}
export interface CloudResponse { status: number; text?: string; arrayBuffer?: ArrayBuffer; }
export type CloudTransport = (request: CloudRequest) => Promise<CloudResponse>;

export class BaiduApiError extends Error {
  constructor(message: string, readonly code?: number, readonly status?: number) { super(message); this.name = "BaiduApiError"; }
}

const API = "https://pan.baidu.com";
const OAUTH = "https://openapi.baidu.com/oauth/2.0";
const LOCATE = "https://d.pcs.baidu.com/rest/2.0/pcs/file";
const CHUNK = 4 * 1024 * 1024;
const DEFAULT_ROOT = "/apps/MarginStudy";

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, String(value));
  return params.toString();
}
function form(values: Record<string, string | number | undefined>): string { return query(values); }
function normalizeRoot(value?: string): string {
  const root = (value?.trim() || DEFAULT_ROOT).replace(/\\/g, "/").replace(/\/+$/, "");
  if (!/^\/apps\/[^/]+(?:\/.*)?$/.test(root) || root.split("/").includes("..")) throw new BaiduApiError("授权目录必须位于 /apps/<应用名>/ 内。");
  return root;
}
export function assertBaiduPath(path: string, root?: string): string {
  const base = normalizeRoot(root), normalized = path.replace(/\\/g, "/");
  if (!normalized.startsWith("/") || normalized.includes("\u0000") || normalized.split("/").includes("..")) throw new BaiduApiError("网盘路径无效。");
  if (normalized !== base && !normalized.startsWith(base + "/")) throw new BaiduApiError("只能访问当前应用授权目录内的文件。");
  return normalized;
}
function joinPath(root: string, name: string): string {
  if (!name || name === "." || name === ".." || /[/\\\u0000-\u001f]/.test(name)) throw new BaiduApiError("文件名无效。");
  return assertBaiduPath(normalizeRoot(root) + "/" + name, root);
}
function parseJson(response: CloudResponse): any {
  if (response.status < 200 || response.status >= 300) throw new BaiduApiError(`网盘请求失败（HTTP ${response.status}）。`, undefined, response.status);
  let value: any;
  try { value = JSON.parse(response.text ?? "{}"); }
  catch { throw new BaiduApiError("网盘返回了无法解析的响应。", undefined, response.status); }
  const code = Number(value?.errno ?? value?.error_code ?? 0);
  if (code) throw new BaiduApiError(`网盘接口返回错误（${code}）。`, code, response.status);
  return value;
}
function bytesOf(value: ArrayBuffer | Uint8Array): Uint8Array { return value instanceof Uint8Array ? value : new Uint8Array(value); }
function utf8(value: string): Uint8Array { return new TextEncoder().encode(value); }
function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function multipart(name: string, data: Uint8Array): { body: ArrayBuffer; contentType: string } {
  const boundary = "----MarginStudy" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  const head = utf8(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name.replace(/["\r\n]/g, "_")}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const tail = utf8(`\r\n--${boundary}--\r\n`);
  const body = concat([head, data, tail]);
  return { body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Portable MD5 used by Baidu's precreate/create contract (works on desktop and Pad). */
export function md5Hex(input: ArrayBuffer | Uint8Array): string {
  const data = bytesOf(input), bitLength = data.length * 8;
  const paddedLength = ((data.length + 8) >> 6 << 6) + 64;
  const bytes = new Uint8Array(paddedLength); bytes.set(data); bytes[data.length] = 0x80;
  const view = new DataView(bytes.buffer); view.setUint32(paddedLength - 8, bitLength >>> 0, true); view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const shifts = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const constants = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);
  const rotate = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = Array.from({ length: 16 }, (_, i) => view.getUint32(offset + i * 4, true));
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const next = d; d = c; c = b;
      b = (b + rotate((a + f + constants[i] + words[g]) >>> 0, shifts[i])) >>> 0; a = next;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map(value => [0,8,16,24].map(shift => ((value >>> shift) & 255).toString(16).padStart(2, "0")).join("")).join("");
}

async function obsidianTransport(request: CloudRequest): Promise<CloudResponse> {
  const response = await requestUrl({ url: request.url, method: request.method ?? "GET", headers: request.headers, body: request.body, contentType: request.contentType, throw: false });
  return { status: response.status, text: response.text, arrayBuffer: response.arrayBuffer };
}

export interface BaiduClientOptions {
  settings: BaiduNetdiskSettings;
  saveSettings?: () => void | Promise<void>;
  transport?: CloudTransport;
  now?: () => number;
}

export class BaiduNetdiskClient {
  private readonly transport: CloudTransport;
  private readonly now: () => number;
  constructor(private readonly options: BaiduClientOptions) { this.transport = options.transport ?? obsidianTransport; this.now = options.now ?? Date.now; }
  get settings(): BaiduNetdiskSettings { return this.options.settings; }
  get authorized(): boolean { return !!this.settings.accessToken; }
  get root(): string { return normalizeRoot(this.settings.rootPath); }
  private async save(): Promise<void> { await this.options.saveSettings?.(); }
  private requireClient(): { clientId: string; clientSecret: string; redirectUri: string } {
    const clientId = this.settings.clientId?.trim(), clientSecret = this.settings.clientSecret?.trim(), redirectUri = this.settings.redirectUri?.trim() || "oob";
    if (!clientId || !clientSecret) throw new BaiduApiError("请先填写百度开发者应用的 AppKey 与 Secret。");
    return { clientId, clientSecret, redirectUri };
  }
  authorizationUrl(state: string): string {
    if (!state || state.length < 16) throw new BaiduApiError("授权 state 太短。");
    const { clientId, redirectUri } = this.requireClient();
    return `${OAUTH}/authorize?${query({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "basic,netdisk", state, display: "popup", qrcode: 1 })}`;
  }
  private async token(params: Record<string, string>): Promise<void> {
    const { clientId, clientSecret } = this.requireClient();
    const response = await this.transport({ url: `${OAUTH}/token?${query({ ...params, client_id: clientId, client_secret: clientSecret })}`, headers: { "User-Agent": "pan.baidu.com" } });
    const value = parseJson(response);
    if (!value.access_token) throw new BaiduApiError("授权响应缺少 access_token。");
    this.settings.accessToken = String(value.access_token);
    this.settings.refreshToken = value.refresh_token ? String(value.refresh_token) : undefined;
    this.settings.expiresAt = this.now() + Math.max(60, Number(value.expires_in ?? 2592000)) * 1000;
    await this.save();
  }
  async exchangeCode(code: string, redirectUri?: string): Promise<void> {
    if (!code.trim()) throw new BaiduApiError("请粘贴授权后的 code。");
    const config = this.requireClient();
    await this.token({ grant_type: "authorization_code", code: code.trim(), redirect_uri: redirectUri?.trim() || config.redirectUri });
  }
  async refresh(): Promise<void> {
    if (!this.settings.refreshToken) throw new BaiduApiError("授权已失效，请重新授权。");
    await this.token({ grant_type: "refresh_token", refresh_token: this.settings.refreshToken });
  }
  async logout(): Promise<void> {
    this.settings.accessToken = undefined; this.settings.refreshToken = undefined; this.settings.expiresAt = undefined;
    await this.save();
  }
  private async accessToken(): Promise<string> {
    if (!this.settings.accessToken) throw new BaiduApiError("请先完成百度网盘授权。");
    if (this.settings.expiresAt && this.settings.expiresAt <= this.now() + 60_000 && this.settings.refreshToken) await this.refresh();
    if (!this.settings.accessToken) throw new BaiduApiError("授权已失效，请重新授权。");
    return this.settings.accessToken;
  }
  private async json(url: string, init?: { method?: "POST"; body?: string | ArrayBuffer; contentType?: string }): Promise<any> {
    const response = await this.transport({ url, method: init?.method ?? "GET", body: init?.body, contentType: init?.contentType, headers: { "User-Agent": "pan.baidu.com", ...(init?.contentType ? { "Content-Type": init.contentType } : {}) } });
    return parseJson(response);
  }
  async list(dir = this.root, options: { start?: number; limit?: number; order?: "name" | "time" | "size"; desc?: 0 | 1 } = {}): Promise<BaiduListPage> {
    const path = assertBaiduPath(dir, this.root), start = Math.max(0, options.start ?? 0), limit = Math.min(1000, Math.max(1, options.limit ?? 200));
    const value = await this.json(`${API}/rest/2.0/xpan/file?${query({ method: "list", access_token: await this.accessToken(), dir: path, start, limit, order: options.order ?? "name", desc: options.desc ?? 0, web: 1 })}`);
    const entries = (value.list ?? []) as BaiduFileEntry[];
    return { entries, start, limit, hasMore: entries.length === limit };
  }
  async listAll(dir = this.root, options: { order?: "name" | "time" | "size"; desc?: 0 | 1; maxEntries?: number; pageSize?: number } = {}): Promise<BaiduFileEntry[]> {
    const result: BaiduFileEntry[] = [], max = options.maxEntries ?? 10000, pageSize = Math.min(1000, Math.max(1, options.pageSize ?? 1000));
    for (let start = 0; start < max;) {
      const page = await this.list(dir, { ...options, start, limit: Math.min(pageSize, max - start) });
      result.push(...page.entries); if (!page.hasMore) return result; start += page.entries.length;
    }
    if (result.length >= max) return result;
    throw new BaiduApiError("目录条目过多，请进入子目录后分批导入。");
  }
  private async downloadLink(fsId: number): Promise<string> {
    const value = await this.json(`${API}/rest/2.0/xpan/multimedia?${query({ method: "filemetas", access_token: await this.accessToken(), fsids: JSON.stringify([fsId]), dlink: 1 })}`);
    const link = value.list?.[0]?.dlink;
    if (!link || !/^https:\/\//.test(link)) throw new BaiduApiError("网盘未返回有效下载地址。");
    return link + (link.includes("?") ? "&" : "?") + query({ access_token: await this.accessToken() });
  }
  async download(entry: BaiduFileEntry, options: { maxBytes?: number; onProgress?: (done: number, total: number) => void } = {}): Promise<Uint8Array> {
    if (entry.isdir) throw new BaiduApiError("目录不能直接下载，请进入目录选择文件。");
    assertBaiduPath(entry.path, this.root);
    const max = options.maxBytes ?? 512 * 1024 * 1024;
    if (entry.size > max) throw new BaiduApiError(`文件超过当前导入上限 ${Math.floor(max / 1024 / 1024)} MB。`);
    const response = await this.transport({ url: await this.downloadLink(entry.fs_id), headers: { "User-Agent": "pan.baidu.com" } });
    if (response.status < 200 || response.status >= 300 || !response.arrayBuffer) throw new BaiduApiError(`下载失败（HTTP ${response.status}）。`, undefined, response.status);
    const bytes = new Uint8Array(response.arrayBuffer);
    if (bytes.length > max) throw new BaiduApiError("下载内容超过导入上限。");
    if (entry.size && bytes.length !== entry.size) throw new BaiduApiError(`下载字节数不完整：应为 ${entry.size}，实际 ${bytes.length}。`);
    options.onProgress?.(bytes.length, entry.size || bytes.length); return bytes;
  }
  private async uploadHost(path: string, uploadId: string): Promise<string> {
    const value = await this.json(`${LOCATE}?${query({ method: "locateupload", appid: 250528, access_token: await this.accessToken(), path, uploadid: uploadId, upload_version: "2.0" })}`);
    const hosts = [...(value.servers ?? []), ...(value.bak_servers ?? [])].map((item: any) => String(item.server)).filter((item: string) => /^https:\/\//.test(item));
    if (!hosts.length) throw new BaiduApiError("网盘未返回可用的 HTTPS 上传域名。");
    return hosts[0].replace(/\/$/, "");
  }
  async upload(path: string, input: ArrayBuffer | Uint8Array, options: { onProgress?: (done: number, total: number) => void } = {}): Promise<BaiduUploadResult> {
    const target = assertBaiduPath(path, this.root), bytes = bytesOf(input);
    if (!bytes.length) throw new BaiduApiError("不能上传空文件。");
    const chunks = Array.from({ length: Math.ceil(bytes.length / CHUNK) }, (_, index) => bytes.slice(index * CHUNK, Math.min(bytes.length, (index + 1) * CHUNK)));
    const blockList = chunks.map(md5Hex), blockJson = JSON.stringify(blockList);
    const precreate = await this.json(`${API}/rest/2.0/xpan/file?${query({ method: "precreate", access_token: await this.accessToken() })}`, {
      method: "POST", contentType: "application/x-www-form-urlencoded",
      body: form({ path: target, size: bytes.length, isdir: 0, autoinit: 1, block_list: blockJson, rtype: 3 }),
    });
    const uploadId = String(precreate.uploadid ?? ""); if (!uploadId) throw new BaiduApiError("预上传未返回 uploadid。");
    const host = await this.uploadHost(target, uploadId);
    for (const [partseq, chunk] of chunks.entries()) {
      const body = multipart(target.split("/").pop() ?? "document", chunk);
      await this.json(`${host}/rest/2.0/pcs/superfile2?${query({ method: "upload", type: "tmpfile", access_token: await this.accessToken(), path: target, uploadid: uploadId, partseq })}`, { method: "POST", body: body.body, contentType: body.contentType });
      options.onProgress?.(Math.min(bytes.length, (partseq + 1) * CHUNK), bytes.length);
    }
    const created = await this.json(`${API}/rest/2.0/xpan/file?${query({ method: "create", access_token: await this.accessToken() })}`, {
      method: "POST", contentType: "application/x-www-form-urlencoded",
      body: form({ path: target, size: bytes.length, isdir: 0, uploadid: uploadId, block_list: blockJson, rtype: 3 }),
    });
    return { path: created.path ?? target, fs_id: created.fs_id, size: created.size ?? bytes.length, md5: created.md5 };
  }
  async createFolder(name: string, parent = this.root): Promise<void> {
    const path = joinPath(parent, name);
    await this.json(`${API}/rest/2.0/xpan/file?${query({ method: "create", access_token: await this.accessToken() })}`, {
      method: "POST", contentType: "application/x-www-form-urlencoded", body: form({ path, isdir: 1, rtype: 3 }),
    });
  }
}
