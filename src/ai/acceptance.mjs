// Real Node HTTP/SSE + real Store against a synthetic localhost provider. No account or vault is read.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url)), project = resolve(here, "../.."), temporary = await mkdtemp(join(tmpdir(), "marginstudy-ai-"));
const evidence = join(process.env.MARGINSTUDY_VERIFY_DIR || tmpdir(), "ai-acceptance-evidence"); await mkdir(evidence, { recursive: true });
const checks = [], requests = [], stores = [];
const check = async (name, run) => { await run(); checks.push({ name, passed: true }); console.log("✓ " + name); };
const SYNTHETIC_KEY = "synthetic-local-test-key-never-save-to-profile";
const red = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==";
const frame = delta => `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\r\n\r\n`;
const final = reason => `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: reason }] })}\r\n\r\ndata: [DONE]\r\n\r\n`;
const responseText = text => ": heartbeat\r\n\r\n" + [...text].map(content => frame({ content })).join("") + final("stop");
const toolStream = (name, args, id = "synthetic-call") => {
  const encoded = JSON.stringify(args), midpoint = Math.floor(encoded.length / 2);
  return frame({ tool_calls: [{ index: 0, id, type: "function", function: { name: name.slice(0, 7), arguments: encoded.slice(0, midpoint) } }] })
    + frame({ tool_calls: [{ index: 0, function: { name: name.slice(7), arguments: encoded.slice(midpoint) } }] }) + final("tool_calls");
};
const sendBytes = async (response, text) => {
  const bytes = Buffer.from(text);
  // Deliberately split CRLF, JSON and multi-byte Chinese characters.
  for (let offset = 0; offset < bytes.length && !response.destroyed; offset += 11) {
    response.write(bytes.subarray(offset, offset + 11)); await new Promise(done => setImmediate(done));
  }
  if (!response.destroyed) response.end();
};
const server = createServer(async (request, response) => {
  const buffers = []; for await (const chunk of request) buffers.push(chunk);
  let body; try { body = JSON.parse(Buffer.concat(buffers)); } catch { response.writeHead(400).end(); return; }
  const url = request.url, entry = { url, body, authorization: request.headers.authorization }; requests.push(entry);
  if (url.startsWith("/reject/")) { response.writeHead(401, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: `echo ${SYNTHETIC_KEY}` })); return; }
  if (url.startsWith("/redirect/")) { response.writeHead(302, { Location: "/v1/chat/completions" }); response.end(); return; }
  if (url.startsWith("/not-stream/")) { response.writeHead(200, { "Content-Type": "application/json" }); response.end('{"choices":[]}'); return; }
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  if (url.startsWith("/cut/")) { response.end(frame({ content: "partial" })); return; }
  if (url.startsWith("/broken/")) { response.end("data: {bad-json}\n\n"); return; }
  if (url.startsWith("/slow/")) { response.write(frame({ content: "开始" })); const timer = setTimeout(() => response.end(final("stop")), 15000); response.on("close", () => clearTimeout(timer)); return; }
  if (url.startsWith("/interleave/")) {
    await sendBytes(response, frame({ tool_calls: [
      { index: 1, id: "second", type: "function", function: { name: "second_", arguments: '{"b":' } },
      { index: 0, id: "first", type: "function", function: { name: "first_", arguments: '{"a":' } },
    ] }) + frame({ tool_calls: [{ index: 0, function: { name: "tool", arguments: '"中文"}' } }, { index: 1, function: { name: "tool", arguments: '2}' } }] }) + final("tool_calls")); return;
  }
  const last = body.messages.at(-1), content = typeof last.content === "string" ? last.content : last.content?.find(part => part.type === "text")?.text ?? "";
  if (content.startsWith("Binding vision test.")) {
    const nonce = content.match(/RED_([a-z0-9-]+)/)[1], picture = last.content.find(part => part.type === "image_url").image_url.url;
    await sendBytes(response, responseText((url.startsWith("/no-image/") ? "OTHER" : picture.endsWith(red) ? "RED" : "BLUE") + "_" + nonce)); return;
  }
  if (last.role === "tool") {
    const data = JSON.parse(last.content);
    if (url.startsWith("/unknown-tool/") && !data.reply) { await sendBytes(response, toolStream("write_file", { path: "never.md", content: "bad" })); return; }
    await sendBytes(response, responseText(data.reply ? url.startsWith("/bad-roundtrip/") ? "wrong" : data.reply : "预览已准备，请检查后保存。")); return;
  }
  if (body.tools?.[0]?.function.name === "marginstudy_binding_probe") {
    if (url.startsWith("/no-tools/")) { await sendBytes(response, responseText("No tools")); return; }
    await sendBytes(response, toolStream("marginstudy_binding_probe", { challenge: content.match(/challenge exactly ([a-z0-9-]+)/)[1] })); return;
  }
  if (url.startsWith("/unknown-tool/")) { await sendBytes(response, toolStream("write_file", { path: "never.md", content: "bad" })); return; }
  const selectedTool = body.tool_choice?.function?.name;
  if (selectedTool === "propose_cards") { await sendBytes(response, toolStream(selectedTool, { cards: [{ title: "合成卡片", excerpt: "问题？", note: "答案。", tags: ["synthetic"] }] })); return; }
  if (selectedTool === "propose_outline") { await sendBytes(response, toolStream(selectedTool, { title: "合成目录", items: [{ title: "第一章", level: 1, note: "笔记" }, { title: "子主题", level: 2, note: "" }, { title: "第二章", level: 1, note: "" }] })); return; }
  if (body.messages[0]?.content.includes("Transcribe/convert")) { await sendBytes(response, responseText("# 识别结果\n\n| 项目 | 内容 |\n| --- | --- |\n| A | 中文 |")); return; }
  await sendBytes(response, responseText("合成流式回答：中文与 emoji 🧠。"));
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
let failure;
try {
  const result = await build({ stdin: { contents: ['export * from "./service.ts";', 'export * from "./transport.ts";', 'export * from "./drafts.ts";', 'export * from "./contracts.ts";', 'export * from "./condense.ts";', 'export {Store} from "../model/store.ts";'].join("\n"), resolveDir: here },
    platform: "node", format: "cjs", bundle: true, write: false, plugins: [{ name: "memory-host", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "memory" }));
      builder.onLoad({ filter: /.*/, namespace: "memory" }, () => ({ contents: "export class App {} export class TFile {} export class Notice {} export class Component {} export const MarkdownRenderer = {render: async () => {}};", loader: "js" }));
    } }] });
  const bundle = join(temporary, "ai.cjs"); await writeFile(bundle, result.outputFiles[0].contents);
  const api = createRequire(import.meta.url)(bundle);
  const fresh = async () => {
    const local = new Map(), secrets = new Map(), files = new Map();
    let disk = { cards: [{ id: "canary", docPath: "private.md", front: "NEVER_UPLOAD_WHOLE_LIBRARY", type: "comment", tags: [], links: [], createdAt: "2020-01-01T00:00:00.000Z" }],
      nodes: [], edges: [], srs: {}, reviewPending: [], reviewLogs: [], studySets: [{ id: "study", name: "Study", docPaths: [], cardIds: ["canary"], createdAt: "2020-01-01T00:00:00.000Z" }],
      canvases: [{ id: "canvas", name: "Main", studySetId: "study", createdAt: "2020-01-01T00:00:00.000Z" }], activeStudySetId: "study", activeCanvasId: "canvas" };
    const app = { loadLocalStorage: key => structuredClone(local.get(key) ?? null), saveLocalStorage: (key, data) => local.set(key, structuredClone(data)),
      secretStorage: { getSecret: key => secrets.get(key) ?? null, setSecret: (key, value) => secrets.set(key, value) },
      vault: { getFiles: () => [], getAbstractFileByPath: path => files.has(path) ? { path } : null,
        create: async (path, text) => { if (files.has(path)) throw new Error("exists"); files.set(path, text); return { path }; },
        adapter: { exists: async path => files.has(path), mkdir: async path => files.set(path, ""), write: async (path, text) => files.set(path, text), read: async path => files.get(path), remove: async path => files.delete(path) } } };
    const host = { app, loadData: async () => structuredClone(disk), saveData: async data => { disk = structuredClone(data); } };
    host.store = new api.Store(host); await host.store.load(); stores.push(host.store);
    const service = new api.AiService(app);
    return { app, local, secrets, files, host, service, disk: () => structuredClone(disk) };
  };
  const configure = (service, prefix = "/v1", apiKey = SYNTHETIC_KEY) => service.configure({ endpoint: base + prefix + "/chat/completions", miniModel: "synthetic-mini", normalModel: "synthetic-normal", apiKey });
  const f = await fresh();
  await check("unbound chat is rejected before any request", async () => { const count = requests.length; await assert.rejects(f.service.request({ text: "Hello" }), error => error.code === "unbound"); assert.equal(requests.length, count); });
  await check("API keys live only in public secret storage and profiles expose only saved-key state", () => {
    const config = configure(f.service); assert.equal(config.hasSavedKey, true); assert.ok(!JSON.stringify(config).includes(SYNTHETIC_KEY));
    assert.ok(!JSON.stringify([...f.local]).includes(SYNTHETIC_KEY)); assert.deepEqual([...f.secrets.values()], [SYNTHETIC_KEY]);
    assert.ok([...f.secrets.keys()].every(id => /^[a-z0-9-]+$/.test(id)));
  });
  await check("Mini and Normal each stream vision/text; Normal streams a function and receives the matching tool result", async () => {
    const before = requests.length; await f.service.testAndBind(); assert.equal(f.service.isBound(), true);
    const tested = requests.slice(before); assert.equal(tested.length, 4);
    assert.deepEqual(tested.slice(0, 2).map(item => item.body.model), ["synthetic-mini", "synthetic-normal"]);
    assert.ok(tested.slice(0, 2).every(item => item.body.stream && item.body.messages[0].content.some(part => part.type === "image_url")));
    const sent = tested[3].body.messages; assert.equal(sent.at(-1).role, "tool"); assert.equal(sent.at(-1).tool_call_id, sent.at(-2).tool_calls[0].id);
    assert.ok(tested.every(item => item.authorization === `Bearer ${SYNTHETIC_KEY}`));
  });
  await check("a recreated service retains nonsecret binding without putting the key in profile storage", () => { const next = new api.AiService(f.app); assert.equal(next.isBound(), true); assert.equal(next.configuration().hasSavedKey, true); });
  await check("condensation uses the real bound transport once per missing tier and never sends tools", async () => {
    const service=new api.CondenseService(f.service),input={text:"ONLY_SELECTED_PARAGRAPH",language:"简体中文",level:"sentence"},before=requests.length;
    assert.deepEqual(service.status(),{service:new URL(base).host,model:"synthetic-normal",bound:true});assert.equal(requests.length,before);
    const first=await service.request(input),hit=await service.request(input);assert.equal(first.cached,false);assert.equal(first.service,new URL(base).host);assert.equal(first.model,"synthetic-normal");assert.equal(hit.cached,true);assert.equal(requests.length,before+1);
    await service.request({...input,level:"points"});await service.request({...input,level:"outline"});assert.equal(requests.length,before+3);
    const sent=requests.slice(before);assert.ok(sent.every(item=>item.body.model==="synthetic-normal"&&item.body.tools===undefined&&JSON.stringify(item.body).includes("ONLY_SELECTED_PARAGRAPH")));
  });
  await check("condensation sends only the selected image through the bound real transport", async () => {
    const service=new api.CondenseService(f.service),before=requests.length;
    await service.request({text:"",images:[`data:image/png;base64,${red}`],language:"简体中文",level:"sentence"});
    assert.equal(requests.length,before+1);const request=requests.at(-1).body;
    assert.equal(request.tools,undefined);assert.equal(request.messages.at(-1).content.filter(part=>part.type==="image_url").length,1);
    assert.equal(request.messages.at(-1).content.find(part=>part.type==="image_url").image_url.url,`data:image/png;base64,${red}`);
    assert.ok(!JSON.stringify(request).includes("NEVER_UPLOAD_WHOLE_LIBRARY"));
  });
  await check("SSE reconstructs split UTF-8 Chinese/emoji and streams fragments before completion", async () => {
    const fragments = [], response = await f.service.request({ text: "Explain", onText: text => fragments.push(text) });
    assert.equal(response.text, "合成流式回答：中文与 emoji 🧠。"); assert.ok(fragments.length > 3); assert.equal(fragments.join(""), response.text);
  });
  await check("only explicitly supplied context/images are sent and Mini uses the configured Mini model", async () => {
    await f.service.request({ text: "请解释", context: { text: "ONLY_SELECTED_PARAGRAPH", docPath: "private.md" }, images: [`data:image/png;base64,${red}`], tier: "mini" });
    const request = requests.at(-1); assert.equal(request.body.model, "synthetic-mini"); assert.equal(request.body.tools, undefined);
    assert.ok(JSON.stringify(request.body).includes("ONLY_SELECTED_PARAGRAPH")); assert.ok(!JSON.stringify(requests).includes("NEVER_UPLOAD_WHOLE_LIBRARY"));
  });
  let cards;
  await check("streamed card tools return editable previews and round-trip preview results without writing or enrolling", async () => {
    const count = f.host.store.cards.length, previews = [], response = await f.service.request({ text: "Generate", task: "cards", tier: "mini", onDraft: draft => previews.push(draft) });
    cards = response.drafts[0]; assert.equal(cards.kind, "cards"); assert.equal(previews.length, 1); assert.equal(f.host.store.cards.length, count); assert.deepEqual(f.host.store.reviewPending, []);
    const call = requests.at(-1); assert.equal(call.body.model, "synthetic-normal"); assert.equal(call.body.messages.at(-1).role, "tool");
    assert.equal(JSON.parse(call.body.messages.at(-1).content).pending_user_save, true);
  });
  await check("user-edited card preview saves through real Store as one undoable change and persists across reload", async () => {
    cards.cards[0].excerpt = "用户改过的问题"; const ids = api.saveLibraryDraft(f.host, cards, "selected.pdf");
    assert.equal(f.host.store.getCard(ids[0]).front, "用户改过的问题"); assert.equal(f.host.store.getCard(ids[0]).docPath, "selected.pdf");
    assert.ok(f.host.store.studySets[0].cardIds.includes(ids[0])); assert.deepEqual(f.host.store.reviewPending, []);
    await f.host.store.flush(); const reloaded = new api.Store(f.host); await reloaded.load(); stores.push(reloaded); assert.equal(reloaded.getCard(ids[0]).front, "用户改过的问题");
    f.host.store.undoLibraryChange(); assert.equal(f.host.store.getCard(ids[0]), undefined); f.host.store.redoLibraryChange(); assert.ok(f.host.store.getCard(ids[0]));
  });
  let outline;
  await check("AI outline streams a hierarchical proposal and explicit save creates real parent/child nodes", async () => {
    const before = f.host.store.nodes.length; outline = (await f.service.request({ text: "Outline", task: "outline" })).drafts[0]; assert.equal(f.host.store.nodes.length, before);
    const ids = api.saveLibraryDraft(f.host, outline, "selected.pdf"), [root, first, child, second] = ids.map(id => f.host.store.getNode(id));
    assert.equal(root.title, "合成目录"); assert.equal(first.parentId, root.id); assert.equal(child.parentId, first.id); assert.equal(second.parentId, root.id);
    assert.ok(ids.every(id => f.host.store.getNode(id).canvasId === "canvas"));
    f.host.store.undoLibraryChange(); assert.equal(f.host.store.nodes.length, before);
  });
  await check("invalid outline levels and a mid-batch Store failure cannot leave partial content", () => {
    assert.throws(() => api.validateDraft("outline", { title: "Bad", items: [{ title: "Skip", level: 2, note: "" }] }), error => error.code === "draft");
    const before = f.host.store.cards.length, original = f.host.store.addCard.bind(f.host.store); let seen = 0;
    f.host.store.addCard = card => { if (++seen === 2) throw new Error("synthetic transaction failure"); original(card); };
    try { assert.throws(() => api.saveLibraryDraft(f.host, { kind: "cards", cards: [cards.cards[0], cards.cards[0]] })); assert.equal(f.host.store.cards.length, before); }
    finally { f.host.store.addCard = original; }
  });
  await check("image/text Markdown recognition produces an editable draft and saves only to a new explicit filename", async () => {
    await f.host.store.flush();
    const before = f.files.size, response = await f.service.request({ text: "识别", task: "markdown", images: [`data:image/png;base64,${red}`] });
    const draft = response.drafts[0]; assert.equal(draft.kind, "markdown"); assert.ok(draft.markdown.includes("| A | 中文 |")); assert.equal(f.files.size, before);
    draft.markdown += "\n\n用户补充"; await api.saveMarkdownDraft(f.host, draft, "识别结果.md"); assert.ok(f.files.get("识别结果.md").includes("用户补充"));
    await assert.rejects(api.saveMarkdownDraft(f.host, draft, "识别结果.md"), error => error.code === "exists");
    await assert.rejects(api.saveMarkdownDraft(f.host, draft, "../outside.md"), error => error.code === "filename");
  });
  await check("endpoint/model/key changes invalidate binding, while an unchanged saved key is retained", async () => {
    f.service.configure({ endpoint: base + "/v1/chat/completions", miniModel: "another-mini", normalModel: "synthetic-normal" }); assert.equal(f.service.isBound(), false); assert.equal(f.service.configuration().hasSavedKey, true);
    await f.service.testAndBind(); f.service.configure({ endpoint: base + "/v1/chat/completions", miniModel: "another-mini", normalModel: "synthetic-normal", apiKey: "changed-synthetic-key" }); assert.equal(f.service.isBound(), false);
    configure(f.service); await f.service.testAndBind(); f.service.configure({ endpoint: base + "/other/chat/completions", miniModel: "synthetic-mini", normalModel: "synthetic-normal" }); assert.equal(f.service.isBound(), false);
  });
  await check("failed vision, streamed tools or tool-result checks each leave chat unavailable", async () => {
    for (const path of ["/no-image", "/no-tools", "/bad-roundtrip"]) { configure(f.service, path); await assert.rejects(f.service.testAndBind()); assert.equal(f.service.isBound(), false); await assert.rejects(f.service.request({ text: "Gate" }), error => error.code === "unbound"); }
  });
  await check("in-flight profile edits cannot bind an obsolete configuration", async () => {
    configure(f.service); let changed = false;
    await assert.rejects(f.service.testAndBind({ onProgress: text => { if (!changed && text.startsWith("Normal")) { changed = true; f.service.configure({ endpoint: base + "/v1/chat/completions", miniModel: "updated-mini", normalModel: "synthetic-normal" }); } } }), error => error.code === "changed");
    assert.equal(f.service.isBound(), false);
  });
  await check("local no-key services work and clearing a key does not serialize it into profile or Store backups", async () => {
    configure(f.service, "/v1", ""); await f.service.testAndBind(); assert.equal(f.service.configuration().hasSavedKey, false); assert.equal(requests.at(-1).authorization, undefined);
    await f.host.store.flush(); assert.ok(!JSON.stringify(f.disk()).includes(SYNTHETIC_KEY)); assert.ok(!JSON.stringify([...f.files]).includes(SYNTHETIC_KEY)); assert.ok(!JSON.stringify([...f.local]).includes(SYNTHETIC_KEY));
  });
  const direct = path => api.streamCompletion(new api.DesktopChatTransport(), base + path + "/chat/completions", SYNTHETIC_KEY, { model: "synthetic", stream: true, messages: [{ role: "user", content: "Direct" }] });
  await check("HTTP error bodies and redirects cannot expose a key or forward it to another endpoint", async () => {
    const before = requests.length;
    for (const path of ["/reject", "/redirect"]) { let caught; try { await direct(path); } catch (error) { caught = error; } assert.ok(caught); assert.ok(!api.aiErrorText(caught).includes(SYNTHETIC_KEY)); assert.ok(!String(caught.stack).includes(SYNTHETIC_KEY)); }
    assert.equal(requests.length - before, 2);
    assert.throws(() => api.validateEndpoint("https://example.invalid/v1/chat/completions?api_key=secret"));
  });
  await check("nonstreaming, malformed SSE and truncated content are rejected instead of reported complete", async () => { for (const path of ["/not-stream", "/broken", "/cut"]) await assert.rejects(direct(path)); });
  await check("interleaved tool-call indices, names and argument fragments reconstruct in original index order", async () => {
    const result = await direct("/interleave"); assert.deepEqual(result.toolCalls.map(call => call.id), ["first", "second"]);
    assert.deepEqual(result.toolCalls.map(call => call.function.name), ["first_tool", "second_tool"]); assert.deepEqual(result.toolCalls.map(call => JSON.parse(call.function.arguments)), [{ a: "中文" }, { b: 2 }]);
  });
  await check("abort stops an in-flight stream and returns a stable cancellation error", async () => {
    const controller = new AbortController();
    await assert.rejects(api.streamCompletion(new api.DesktopChatTransport(), base + "/slow/chat/completions", "", { model: "synthetic", stream: true, messages: [{ role: "user", content: "Cancel" }] }, controller.signal, () => controller.abort()), error => error.code === "aborted");
  });
  await check("unsupported tools never execute or write files, and repeated invalid calls stop at the round limit", async () => {
    configure(f.service, "/unknown-tool", ""); await f.service.testAndBind(); const files = [...f.files];
    await assert.rejects(f.service.request({ text: "Unknown tool" }), error => error.code === "rounds"); assert.deepEqual([...f.files], files);
    assert.ok(JSON.parse(requests.at(-1).body.messages.at(-1).content).error);
  });
  await check("profiles in separate vault-local stores use different secret identifiers", async () => { const other = await fresh(); configure(other.service); assert.notEqual([...f.secrets.keys()][0], [...other.secrets.keys()][0]); });
} catch (error) { failure = error; process.exitCode = 1; console.error(error.stack || error); }
finally {
  for (const store of stores) await store.flush().catch(() => {});
  await writeFile(join(evidence, "results.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), environment: "synthetic localhost provider; real Node HTTP/SSE and Store; no external account or user vault", checks, ...(failure ? { error: String(failure.stack || failure).replaceAll(SYNTHETIC_KEY, "[redacted]") } : {}) }, null, 2));
  server.closeAllConnections(); await new Promise(done => server.close(done)); await rm(temporary, { recursive: true, force: true });
  console.log(`${checks.length} AI acceptance checks passed.`);
}
