import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { networkInterfaces } from "node:os";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { PassThrough, Writable } from "node:stream";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporary = await mkdtemp(join(tmpdir(), "marginstudy-a27-"));
const serverPath = join(root, "src/ai/localCliServer.ts");
const optionalServer = existsSync(serverPath) ? `export { createLocalCliServer } from ${JSON.stringify(serverPath)};` : "";
const built = await build({ stdin: { contents: `export { Store } from ${JSON.stringify(join(root, "src/model/store.ts"))};\n${optionalServer}`, resolveDir: root },
  bundle: true, platform: "node", format: "cjs", write: false, plugins: [{ name: "synthetic-obsidian", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "synthetic" }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: "export class App {} export class TFile {} export class Notice {} export class Component {} export const MarkdownRenderer={render:async()=>{}};" }));
  } }] });
const bundle = join(temporary, "fixture.cjs");
await writeFile(bundle, built.outputFiles[0].contents);
const product = createRequire(import.meta.url)(bundle);
const results = [];

async function check(name, run) {
  try { results.push({ name, passed: true, detail: await run() }); }
  catch (error) { results.push({ name, passed: false, error: String(error) }); }
}

function requireServer() {
  assert.equal(typeof product.createLocalCliServer, "function", "A27 desktop local service is absent");
}

async function fresh() {
  const disk = { revision: 12, cards: [
    { id: "card-1", docPath: "synthetic.md", type: "excerpt", front: "First", back: "Answer", tags: ["old"], links: [], createdAt: "2020-01-01T00:00:00Z" },
    { id: "card-2", docPath: "synthetic.md", type: "excerpt", front: "Second", tags: [], links: [], createdAt: "2020-01-01T00:00:00Z" },
  ], documents: [{ id: "doc-1", path: "synthetic.md", kind: "markdown", name: "Synthetic" }], studySets: [], nodes: [], edges: [] };
  let saved = structuredClone(disk);
  const files = new Map();
  const adapter = { exists: async path => files.has(path), mkdir: async path => files.set(path, ""), write: async (path, value) => files.set(path, value), read: async path => files.get(path) };
  const store = new product.Store({ app: { vault: { getFiles: () => [], adapter } }, loadData: async () => structuredClone(saved), saveData: async value => { saved = structuredClone(value); } });
  await store.load();
  return store;
}

class StubTransport extends EventEmitter {
  constructor(handler) { super(); this.handler = handler; this.listening = false; this.bind = null; }
  listen(port, host, callback) { this.bind = { port, host }; this.listening = true; queueMicrotask(callback); return this; }
  address() { return this.listening ? { address: this.bind.host, family: "IPv4", port: 45678 } : null; }
  close(callback) { this.listening = false; queueMicrotask(() => callback?.()); return this; }
  async request({ destination = "127.0.0.1", source = "127.0.0.1", host = `${destination}:45678`, token, method = "GET", path = "/status", body, headers = {}, beforeBody } = {}) {
    if (!this.listening || ![this.bind.host, "0.0.0.0"].includes(destination)) throw Object.assign(new Error("connection refused by stub transport"), { code: "ECONNREFUSED" });
    const request = new PassThrough();
    request.method = method; request.url = path; request.socket = { remoteAddress: source };
    request.headers = { host, ...(token === undefined ? {} : { authorization: `Bearer ${token}` }), ...headers };
    const chunks = [];
    const response = new Writable({ write(chunk, _encoding, next) { chunks.push(Buffer.from(chunk)); next(); } });
    response.writeHead = (status, values) => { response.statusCode = status; response.headers = values; return response; };
    const finished = new Promise((resolveResponse, reject) => { response.on("finish", () => resolveResponse({ status: response.statusCode, headers: response.headers, body: JSON.parse(Buffer.concat(chunks).toString() || "{}") })); response.on("error", reject); });
    this.handler(request, response);
    if (beforeBody) await beforeBody();
    request.end(body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));
    return finished;
  }
}

async function realSmoke() {
  const generic = createServer((_request, response) => response.end("ok"));
  try { await new Promise((resolveListening, reject) => { generic.once("error", reject); generic.listen(0, "127.0.0.1", resolveListening); }); }
  catch (error) { return { attempted: true, bound: false, code: error.code, message: error.message }; }
  const address = generic.address();
  await new Promise(resolveClose => generic.close(resolveClose));
  assert.equal(address.address, "127.0.0.1");
  const store = await fresh();
  const service = product.createLocalCliServer(store);
  await service.start();
  const state = service.getState();
  const request = (destination, path = "/status", token = state.token, method = "GET", body, extraHeaders = {}) => new Promise(resolveRequest => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ host: destination, port: state.port, path, method, timeout: 1500, agent: false,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}), ...extraHeaders } }, response => {
      const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.on("end", () => resolveRequest({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    req.on("error", error => resolveRequest({ error: error.code })); req.end(payload);
  });
  try {
    assert.equal((await request("127.0.0.1")).status, 200);
    assert.equal((await request("127.0.0.1", "/status", "wrong")).status, 401);
    assert.equal((await request("0.0.0.0")).status, 403);
    assert.equal((await request("0.0.0.0", "/status", state.token, "GET", undefined, { Host: `127.0.0.1:${state.port}` })).status, 200);
    assert.equal((await request("::1")).error, "ECONNREFUSED");
    const interfaces = Object.values(networkInterfaces()).flat().filter(item => item && item.family === "IPv4" && !item.internal).map(item => item.address);
    const nonloopback = [];
    for (const destination of interfaces) {
      const result = await request(destination); nonloopback.push({ destination, ...result });
      assert.ok(result.error, `${destination} unexpectedly connected`);
    }
    const before = structuredClone(store.cards), revision = store.getRevision();
    for (let index = 0; index < 20; index++) assert.equal((await request("127.0.0.1", "/cards")).status, 200);
    assert.equal(store.getRevision(), revision);
    const command = { action: "add-tags", cardIds: ["card-1", "card-2"], tags: ["network"] };
    assert.equal((await request("127.0.0.1", "/organize", state.token, "POST", command)).status, 403);
    service.setWriteEnabled(true);
    assert.equal((await request("127.0.0.1", "/organize", state.token, "POST", command)).status, 200);
    assert.equal(store.undoLibraryChange(), true); assert.deepEqual(store.cards, before);
    await store.flush();
    await service.stop();
    const stopped = (await request("127.0.0.1")).error;
    assert.equal(stopped, "ECONNREFUSED");
    return { attempted: true, bound: true, genericBind: address, productBind: "127.0.0.1", ipv4: 200, unspecifiedHost: 403, unspecifiedWithLoopbackHost: 200, ipv6: "ECONNREFUSED", nonloopback, reads: 20, revision, writeUndo: true, stopped };
  } finally { await service.stop(); }
}

async function fixture() {
  requireServer();
  const store = await fresh();
  let transport;
  const service = product.createLocalCliServer(store, handler => (transport = new StubTransport(handler)));
  return { store, service, transport: () => transport };
}

await check("1 IPv4 loopback binding and source/Host rejection", async () => {
  const f = await fixture();
  await f.service.start();
  try {
    const transport = f.transport(), token = f.service.getState().token;
    assert.deepEqual(transport.bind, { port: 0, host: "127.0.0.1" });
    for (const destination of ["192.168.1.9", "::", "::1"]) await assert.rejects(transport.request({ destination, token }), { code: "ECONNREFUSED" });
    assert.equal((await transport.request({ destination: "0.0.0.0", token })).status, 403);
    assert.equal((await transport.request({ token })).status, 200);
    for (const host of ["0.0.0.0:45678", "192.168.1.9:45678", "[::1]:45678", "evil.test:45678", "127.0.0.1.evil.test:45678"]) assert.equal((await transport.request({ token, host })).status, 403, host);
    for (const source of ["192.168.1.9", "::1", "::ffff:192.168.1.9"]) assert.equal((await transport.request({ token, source })).status, 403, source);
    assert.equal((await transport.request({ token, headers: { origin: "https://evil.test" } })).status, 403);
    assert.equal((await transport.request({ token, headers: { origin: "http://127.0.0.1:1234" } })).status, 403);
    return { transport: "stub", bind: transport.bind, refusedDestinations: 3, unspecifiedHost: 403, rejectedHosts: 5, rejectedSources: 3 };
  } finally { await f.service.stop(); }
});

await check("2 disabled, authentication, write gate and rotation", async () => {
  const f = await fixture();
  assert.equal(f.service.getState().enabled, false);
  assert.equal(f.transport(), undefined, "server factory called before explicit enable");
  await f.service.start();
  const transport = f.transport(), first = f.service.getState().token;
  try {
    assert.ok(first && first.length >= 32);
    assert.equal((await transport.request()).status, 401);
    assert.equal((await transport.request({ token: "wrong" })).status, 401);
    assert.equal((await transport.request({ token: first })).status, 200);
    assert.equal((await transport.request({ token: first, method: "POST", path: "/organize", body: { action: "add-tags", cardIds: ["card-1"], tags: ["new"] }, headers: { "content-type": "application/json" } })).status, 403);
    const next = f.service.rotateToken();
    assert.notEqual(next, first);
    assert.equal((await transport.request({ token: first })).status, 401);
    assert.equal((await transport.request({ token: next })).status, 200);
    assert.ok(!JSON.stringify((await transport.request({ token: next })).body).includes(next));
    f.service.setWriteEnabled(true);
    const command = { action: "add-tags", cardIds: ["card-1"], tags: ["pending"] };
    assert.equal((await transport.request({ token: next, method: "POST", path: "/organize", body: command, headers: { "content-type": "application/json" }, beforeBody: () => f.service.setWriteEnabled(false) })).status, 403);
    f.service.setWriteEnabled(true);
    assert.equal((await transport.request({ token: next, method: "POST", path: "/organize", body: command, headers: { "content-type": "application/json" }, beforeBody: () => f.service.rotateToken() })).status, 401);
    assert.deepEqual(f.store.getCard("card-1").tags, ["old"]);
  } finally { await f.service.stop(); }
  await assert.rejects(transport.request({ token: first }), { code: "ECONNREFUSED" });
  await f.service.start();
  assert.notEqual(f.service.getState().token, first);
  assert.equal(f.service.getState().allowWrites, false);
  await f.service.stop();
  const racing = await fixture();
  const opening = racing.service.start(), closing = racing.service.stop();
  await assert.rejects(opening, /关闭/); await closing;
  assert.equal(racing.service.getState().enabled, false);
  assert.equal(racing.transport().listening, false);
  return { transport: "stub", missingOrWrong: 401, correct: 200, writeDisabled: 403, tokenRotated: true };
});

await check("3 twenty reads preserve Store revision and all business data", async () => {
  const f = await fixture(); await f.service.start();
  try {
    const token = f.service.getState().token, before = structuredClone({ revision: f.store.revision, cards: f.store.cards, documents: f.store.documents, history: f.store.getLibraryHistoryState() });
    for (let index = 0; index < 20; index++) {
      const response = await f.transport().request({ token, path: "/cards" });
      assert.equal(response.status, 200); assert.deepEqual(response.body.cards, before.cards);
    }
    const documents = await f.transport().request({ token, path: "/documents" });
    assert.equal(documents.status, 200); assert.deepEqual(documents.body.documents, before.documents);
    await f.store.flush();
    assert.deepEqual({ revision: f.store.revision, cards: f.store.cards, documents: f.store.documents, history: f.store.getLibraryHistoryState() }, before);
    return { transport: "stub", reads: 20, revisionBefore: before.revision, revisionAfter: f.store.revision };
  } finally { await f.service.stop(); }
});

await check("4 one organize command and one undo restore every field", async () => {
  const f = await fixture(); await f.service.start(); f.service.setWriteEnabled(true);
  try {
    const token = f.service.getState().token, before = structuredClone({ cards: f.store.cards, documents: f.store.documents, studySets: f.store.studySets, nodes: f.store.nodes, edges: f.store.edges });
    const history = f.store.getLibraryHistoryState().revision;
    const invalid = await f.transport().request({ token, method: "POST", path: "/organize", headers: { "content-type": "application/json" }, body: { action: "add-tags", cardIds: ["card-1", "missing"], tags: ["new"] } });
    assert.equal(invalid.status, 400); assert.deepEqual(f.store.cards, before.cards);
    const response = await f.transport().request({ token, method: "POST", path: "/organize", headers: { "content-type": "application/json" }, body: { action: "add-tags", cardIds: ["card-1", "card-2"], tags: ["new", "study"] } });
    assert.equal(response.status, 200); assert.deepEqual(f.store.getCard("card-1").tags, ["old", "new", "study"]); assert.deepEqual(f.store.getCard("card-2").tags, ["new", "study"]);
    assert.equal(f.store.getLibraryHistoryState().revision, history + 1);
    assert.equal(f.store.undoLibraryChange(), true);
    assert.deepEqual({ cards: f.store.cards, documents: f.store.documents, studySets: f.store.studySets, nodes: f.store.nodes, edges: f.store.edges }, before);
    assert.equal(f.store.getLibraryHistoryState().revision, history + 2);
    await f.store.flush();
    return { transport: "stub", cards: 2, historyEntries: 1, undo: 1, fieldsRestored: true };
  } finally { await f.service.stop(); }
});

await check("5 mobile plugin startup skips desktop server module and port", async () => {
  requireServer();
  const { runMobileStartup } = await import("./a27-mobile-fixture.mjs");
  return runMobileStartup(root, temporary);
});

let realNetwork;
if (process.env.A27_REAL_SMOKE === "1" && typeof product.createLocalCliServer === "function") {
  try { realNetwork = await realSmoke(); console.log(`REAL NETWORK ${JSON.stringify(realNetwork)}`); }
  catch (error) { realNetwork = { attempted: true, failure: String(error) }; results.push({ name: "real network smoke", passed: false, error: String(error) }); }
}
const report = { environment: "synthetic Store and injected transport; mobile synthetic host", results, ...(realNetwork ? { realNetwork } : {}) };
await writeFile(join(temporary, "results.json"), JSON.stringify(report, null, 2) + "\n");
for (const result of results) console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}: ${JSON.stringify(result.detail ?? result.error)}`);
console.log(`${results.filter(result => result.passed).length}/${results.length} A27 checks passed`);
console.log(`Results: ${join(temporary, "results.json")}`);
if (results.some(result => !result.passed)) process.exitCode = 1;
