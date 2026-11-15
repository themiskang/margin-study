import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "marginstudy-baidu-"));
const built = await build({ stdin: { contents: 'export * from "./baiduNetdisk";', resolveDir: here }, bundle: true, platform: "node", format: "cjs", write: false,
  plugins: [{ name: "synthetic-obsidian", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "synthetic" }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: 'export async function requestUrl(){throw new Error("network disabled in protocol tests")}' }));
  } }] });
const bundle = join(temporary, "fixture.cjs");
await writeFile(bundle, built.outputFiles[0].contents);
const { BaiduNetdiskClient, BaiduApiError, md5Hex, assertBaiduPath } = createRequire(import.meta.url)(bundle);
const results = [];
async function test(name, run) {
  try { results.push({ name, passed: true, detail: await run() }); }
  catch (error) { results.push({ name, passed: false, error: String(error.stack || error) }); }
}
const json = (value, status = 200) => ({ status, text: JSON.stringify(value) });
const entry = (fs_id, name, size = 4, isdir = 0) => ({ fs_id, path: `/apps/MarginStudy/${name}`, server_filename: name, size, isdir });
const settings = () => ({ clientId: "client-id", clientSecret: "client-secret", redirectUri: "oob", rootPath: "/apps/MarginStudy", accessToken: "access-old", refreshToken: "refresh-token", expiresAt: 9999999999999 });
const md5 = bytes => createHash("md5").update(bytes).digest("hex");

await test("portable MD5 matches Node for empty text, abc and binary chunks", () => {
  for (const bytes of [new Uint8Array(), new TextEncoder().encode("abc"), new TextEncoder().encode("The quick brown fox jumps over the lazy dog"), Uint8Array.from({ length: 4 * 1024 * 1024 + 17 }, (_, i) => i % 251)]) {
    assert.equal(md5Hex(bytes), md5(bytes));
  }
  return "4 vectors";
});

await test("OAuth URL, code exchange, expiry refresh and logout persist only token state", async () => {
  const config = settings(), calls = []; let saves = 0;
  config.expiresAt = 1000;
  const client = new BaiduNetdiskClient({ settings: config, now: () => 100000, saveSettings: () => { saves++; }, transport: async request => {
    calls.push(request.url);
    if (request.url.includes("grant_type=authorization_code")) return json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
    if (request.url.includes("grant_type=refresh_token")) return json({ access_token: "refreshed-access", refresh_token: "next-refresh", expires_in: 3600 });
    if (request.url.includes("method=list")) return json({ errno: 0, list: [] });
    throw new Error("unexpected " + request.url);
  } });
  const url = client.authorizationUrl("1234567890abcdef");
  assert(url.includes("response_type=code") && url.includes("client_id=client-id") && url.includes("scope=basic%2Cnetdisk") && url.includes("state=1234567890abcdef"));
  await client.exchangeCode("one-time-code");
  assert.equal(config.accessToken, "new-access"); assert.equal(config.refreshToken, "new-refresh"); assert.equal(saves, 1);
  config.expiresAt = 1000;
  await client.list();
  assert(calls.some(value => value.includes("grant_type=refresh_token")));
  assert(calls.some(value => value.includes("access_token=refreshed-access")));
  await client.logout(); assert(!client.authorized && !config.refreshToken && !config.expiresAt); assert.equal(saves, 3);
  assert(!calls.filter(value => value.includes("method=list")).join("\n").includes("client-secret"));
  return `${calls.length} calls`;
});

await test("directory pagination preserves order and stops after a short page", async () => {
  const starts = [];
  const client = new BaiduNetdiskClient({ settings: settings(), transport: async request => {
    const url = new URL(request.url), start = Number(url.searchParams.get("start")); starts.push(start);
    return json({ errno: 0, list: start === 0 ? [entry(1, "a.pdf"), entry(2, "b.pdf")] : [entry(3, "c.pdf")] });
  } });
  const entries = await client.listAll(undefined, { maxEntries: 3, pageSize: 2 });
  assert.deepEqual(entries.map(item => item.fs_id), [1, 2, 3]); assert.deepEqual(starts, [0, 2]);
  return starts.join(",");
});

await test("path guard rejects escaping the authorized app directory", () => {
  assert.equal(assertBaiduPath("/apps/MarginStudy/a.pdf"), "/apps/MarginStudy/a.pdf");
  for (const path of ["/apps/Other/a.pdf", "/apps/MarginStudy/../secret.pdf", "relative.pdf", "/etc/passwd"]) assert.throws(() => assertBaiduPath(path), BaiduApiError);
  const client = new BaiduNetdiskClient({ settings: settings(), transport: async () => { throw new Error("must not request"); } });
  return client.download(entry(1, "../secret.pdf")).then(() => assert.fail("escape accepted"), error => assert(error instanceof BaiduApiError));
});

await test("download follows signed dlink with required User-Agent and validates byte count", async () => {
  const requests = [], bytes = new TextEncoder().encode("PDF!");
  const client = new BaiduNetdiskClient({ settings: settings(), transport: async request => {
    requests.push(request);
    if (request.url.includes("method=filemetas")) return json({ list: [{ dlink: "https://download.example/file?sign=abc" }] });
    return { status: 200, arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  } });
  const result = await client.download(entry(42, "a.pdf", bytes.length));
  assert.deepEqual([...result], [...bytes]);
  assert(requests[1].url.startsWith("https://download.example/file?sign=abc&access_token="));
  assert.equal(requests[1].headers["User-Agent"], "pan.baidu.com");
  await assert.rejects(client.download(entry(42, "a.pdf", 99)), /字节数不完整/);
  return requests.map(request => request.url.split("?")[0]).join(" -> ");
});

await test("upload uses precreate, dynamic HTTPS host, 4MB chunks and create with matching MD5", async () => {
  const bytes = Uint8Array.from({ length: 4 * 1024 * 1024 + 123 }, (_, i) => i % 253), calls = [], progress = [];
  const client = new BaiduNetdiskClient({ settings: settings(), transport: async request => {
    calls.push(request);
    if (request.url.includes("method=precreate")) {
      const body = new URLSearchParams(request.body);
      assert.deepEqual(JSON.parse(body.get("block_list")), [md5(bytes.slice(0, 4 * 1024 * 1024)), md5(bytes.slice(4 * 1024 * 1024))]);
      return json({ uploadid: "upload-1" });
    }
    if (request.url.includes("method=locateupload")) return json({ servers: [{ server: "http://unsafe.example" }, { server: "https://upload.example" }] });
    if (request.url.includes("method=create")) return json({ path: "/apps/MarginStudy/big.pdf", fs_id: 88, size: bytes.length });
    if (request.url.includes("method=upload")) { assert(request.contentType.startsWith("multipart/form-data; boundary=")); return json({}); }
    throw new Error("unexpected " + request.url);
  } });
  const result = await client.upload("/apps/MarginStudy/big.pdf", bytes, { onProgress: (done, total) => progress.push([done, total]) });
  assert.equal(result.fs_id, 88);
  assert.deepEqual(progress, [[4 * 1024 * 1024, bytes.length], [bytes.length, bytes.length]]);
  const parts = calls.filter(request => request.url.includes("partseq="));
  assert.equal(parts.length, 2); assert(parts.every(request => request.url.startsWith("https://upload.example/")));
  assert.equal(new URL(calls[0].url).searchParams.get("access_token"), "access-old");
  assert(!JSON.stringify(calls.map(request => request.url)).includes("client-secret"));
  return `${parts.length} parts`;
});

await test("API errors are bounded and never echo token or signed URL", async () => {
  const client = new BaiduNetdiskClient({ settings: settings(), transport: async () => json({ errno: 31045, show_msg: "access-old must not leak", access_token: "access-old" }) });
  await assert.rejects(client.list(), error => {
    assert(error instanceof BaiduApiError); assert.equal(error.code, 31045);
    assert(!error.message.includes("access-old") && !error.message.includes("show_msg"));
    return true;
  });
  return "redacted";
});

const failed = results.filter(result => !result.passed);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed }, null, 2));
if (failed.length) process.exitCode = 1;
else console.log(`${results.length}/${results.length} Baidu Netdisk protocol groups passed`);
