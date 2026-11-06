// Synthetic compatibility views only. No real plugin instance, file, credential or provider is used.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url)), temporary = await mkdtemp(join(tmpdir(), "marginstudy-claudian-"));
const evidence = join(process.env.MARGINSTUDY_VERIFY_DIR || tmpdir(), "claudian-acceptance-evidence"); await mkdir(evidence, { recursive: true });
const checks = [], check = async (name, run) => { await run(); checks.push({ name, passed: true }); console.log("✓ " + name); };
let failure;
try {
  const result = await build({ stdin: { contents: 'export * from "./claudianBridge.ts"; export * from "./resultImport.ts"; export * from "./claudianRequest.ts";', resolveDir: here }, platform: "node", format: "cjs", bundle: true, write: false });
  const bundle = join(temporary, "bridge.cjs"); await writeFile(bundle, result.outputFiles[0].contents);
  const api = createRequire(import.meta.url)(bundle);
  const fresh = (version = "2.3.21", append) => {
    const calls = [], drafts = [];
    const plugin = { manifest: { version }, get settings() { throw new Error("settings must not be read"); }, get sessions() { throw new Error("history must not be read"); } };
    const view = { appendToActiveInput: append ?? (text => { drafts.push(text); return true; }), focusActiveInput: () => calls.push("focus") };
    const app = { plugins: { getPlugin: id => id === "realclaudian" ? plugin : null },
      commands: { commands: { "realclaudian:open-view": {} }, executeCommandById: id => { calls.push(id); return true; } },
      workspace: { getLeavesOfType: type => { assert.equal(type, "claudian-view"); return [{ view }]; } },
      get vault() { throw new Error("vault must not be read"); }, get secretStorage() { throw new Error("secrets must not be read"); } };
    return { app, plugin, view, calls, drafts };
  };
  await check("missing plugin has no available bridge and opens no command", () => { assert.deepEqual(api.claudianAvailability({}), { available: false, compatiblePrefill: false }); assert.equal(api.openClaudian({}), false); });
  await check("2.3.21 metadata enables the observed compatibility adapter without touching settings, sessions or secrets", () => { const f = fresh(); assert.deepEqual(api.claudianAvailability(f.app), { available: true, version: "2.3.21", compatiblePrefill: true }); });
  await check("prefill invokes only the open-view command, appends once and focuses without a submit", async () => { const f = fresh(); assert.deepEqual(await api.prefillClaudian(f.app, "explicit text"), { kind: "prefilled", opened: true }); assert.deepEqual(f.drafts, ["explicit text"]); assert.deepEqual(f.calls, ["realclaudian:open-view", "focus"]); });
  await check("unknown versions open the existing chat and use manual fallback without invoking its input method", async () => { const f = fresh("2.3.22"); const result = await api.prefillClaudian(f.app, "explicit"); assert.equal(result.kind, "manual"); assert.equal(result.opened, true); assert.deepEqual(f.drafts, []); assert.deepEqual(f.calls, ["realclaudian:open-view"]); });
  await check("explicit false readiness is retried but only a successful append changes the input", async () => { let attempts = 0, appended = 0; const f = fresh("2.3.21", () => { attempts++; if (attempts < 3) return false; appended++; return true; }); let waits = 0; const result = await api.prefillClaudian(f.app, "x", { wait: async () => { waits++; } }); assert.equal(result.kind, "prefilled"); assert.equal(attempts, 3); assert.equal(appended, 1); assert.equal(waits, 2); });
  await check("ambiguous append results and exceptions never retry a possibly completed append", async () => { for (const implementation of [() => undefined, () => { throw new Error("opaque failure"); }]) { let attempts = 0; const f = fresh("2.3.21", () => { attempts++; return implementation(); }); const result = await api.prefillClaudian(f.app, "x", { wait: async () => {} }); assert.equal(result.kind, "manual"); assert.equal(attempts, 1); } });
  await check("readiness has a bounded timeout and absence of the observed method uses manual fallback", async () => { const f = fresh(); delete f.view.appendToActiveInput; let waits = 0; assert.equal((await api.prefillClaudian(f.app, "x", { timeoutMs: 240, wait: async () => { waits++; } })).kind, "manual"); assert.equal(waits, 2); });
  await check("abort prevents opening or a later input append", async () => { const stopped = new AbortController(); stopped.abort(); const f = fresh(); await assert.rejects(api.prefillClaudian(f.app, "x", { signal: stopped.signal }), e => e.code === "cancelled"); assert.deepEqual(f.calls, []); const running = new AbortController(); f.view.appendToActiveInput = () => false; await assert.rejects(api.prefillClaudian(f.app, "x", { signal: running.signal, wait: async () => { running.abort(); } }), e => e.code === "cancelled"); assert.deepEqual(f.drafts, []); });
  await check("a version change during readiness cancels the compatibility adapter", async () => { let attempts = 0; const f = fresh("2.3.21", () => { attempts++; return false; }); const result = await api.prefillClaudian(f.app, "x", { wait: async () => { f.plugin.manifest.version = "future"; } }); assert.equal(result.kind, "manual"); assert.equal(attempts, 1); });
  await check("the prompt carries only explicit text/context, requests chat output and supplies task schemas", () => { const prompt = api.buildClaudianPrompt({ text: "selected question", task: "cards", context: { text: "SELECTED_ONLY", label: "paragraph", docPath: "private/path.md" } }); assert.ok(prompt.includes("selected question") && prompt.includes("SELECTED_ONLY") && prompt.includes('"cards"')); assert.ok(!prompt.includes("private/path.md")); assert.ok(prompt.includes("不创建、读取或修改")); assert.ok(api.buildClaudianPrompt({ text: "x", task: "outline" }).includes('"level":1')); assert.throws(() => api.buildClaudianPrompt({ text: "x".repeat(120001) })); });
  await check("pasted JSON and fenced JSON become validated card/outline drafts without saving", () => { const card = api.draftFromPastedReply("cards", '{"cards":[{"title":"Q","excerpt":"Question","note":"Answer","tags":["t"]}]}'); assert.equal(card.cards[0].note, "Answer"); const outline = api.draftFromPastedReply("outline", '```json\n{"title":"Topic","items":[{"title":"A","level":1,"note":""},{"title":"B","level":2,"note":""}]}\n```'); assert.deepEqual(outline.items.map(x => x.level), [1, 2]); });
  await check("plain replies preserve content as one editable card or Markdown document", () => { const raw = "A reply\n\nwith detail."; assert.equal(api.draftFromPastedReply("cards", raw).cards[0].excerpt, raw); const markdown = api.draftFromPastedReply("markdown", "```markdown\n# Title\n\nBody\n```"); assert.equal(markdown.title, "Title"); assert.equal(markdown.markdown, "# Title\n\nBody"); });
  await check("Markdown outline preserves nested headings and notes while normalizing skipped levels", () => { const outline = api.draftFromPastedReply("outline", "# Topic\n## A\nA note.\n#### B\n## C"); assert.equal(outline.title, "Topic"); assert.deepEqual(outline.items.map(x => x.level), [1, 2, 1]); assert.equal(outline.items[0].note, "A note."); assert.deepEqual(api.draftFromPastedReply("outline", "## A\n### B").items.map(x => x.level), [1, 2]); });
  await check("invalid, empty, oversized or ambiguous imports cannot create a draft", () => { for (const [kind, raw] of [["cards", ""], ["cards", "{broken"], ["outline", "unstructured prose"], ["outline", '{"title":"T","items":[{"title":"A","level":2,"note":""}]}'], ["markdown", "x".repeat(500001)]]) assert.throws(() => api.draftFromPastedReply(kind, raw)); });
  await check("direct Claudian request streams only its ephemeral run without reading history or consuming the composer", async () => {
    const seen = [], chunks = []; let released=0;
    const run={turnId:'owned-turn',cancel:()=>seen.push('cancel'),events:(async function*(){yield {type:'text_delta',text:'UNRELATED',scope:{turnId:'other-turn'}};yield {type:'text_delta',text:'Actual '};yield {type:'text_delta',text:'reply'};yield {type:'turn_completed',reason:'completed'};})()};
    const backend={providerId:'test'};
    const registry={acquire(b,config,owner){assert.equal(b,backend);assert.equal(config.lifecycle,'ephemeral');assert.equal(config.nativePersistence,'disabled-if-supported');assert.equal(owner,'margin-study');assert.equal(config.vaultWorkingDirectory,'/synthetic');return {session:{execute(request){seen.push(request);assert.equal(request.configuration.model,'test-model');assert.deepEqual(request.toolPolicy,{kind:'passive'});assert.equal(request.conversationHistory,undefined);assert.equal(request.context,undefined);assert.deepEqual(request.input,[{type:'text',text:'Explicit prompt'}]);return run;}},onInvalidated(){return ()=>{};},isCurrent:()=>true,release:async()=>{released++;}};}};
    const model={ensureExecutionInitialized:async()=>true,get state(){throw Error('existing messages must not be read');}};
    const runtime={model,executionCoordinator:{deps:{resolveBackend:provider=>{assert.equal(provider,'test');return backend;},lifecycleRegistry:registry,vaultWorkingDirectory:'/synthetic'}}};
    const view={getActiveTab:()=>({session:{runtime}}),appendToActiveInput:()=>{throw Error('composer must not be changed');}};
    const plugin={manifest:{version:'2.3.21'},chatHost:{getActiveModelSelection:()=>({providerId:'test',model:'test-model'})},get settings(){throw Error('credentials/settings must not be read');}};
    const app={plugins:{getPlugin:()=>plugin},workspace:{getLeavesOfType:()=>[{view}]},get vault(){throw Error('vault must not be read');}};
    const reply=await api.requestClaudian(app,'Explicit prompt',{onText:text=>chunks.push(text)});
    assert.equal(reply,'Actual reply');assert.deepEqual(chunks,['Actual ','reply']);assert.equal(released,1);assert.equal(seen.length,1);
  });
  const requestFixture = (events,selection={providerId:'test',model:'test-model'}) => {
    const metrics={executions:0,releases:0,cancels:0};let invalidate=()=>{};
    const runtime={model:{ensureExecutionInitialized:async()=>true},executionCoordinator:{deps:{resolveBackend:()=>({providerId:'test'}),vaultWorkingDirectory:'/synthetic',lifecycleRegistry:{acquire:()=>({isCurrent:()=>true,onInvalidated:fn=>{invalidate=fn;return()=>{};},release:async()=>{metrics.releases++;},session:{execute(request){metrics.executions++;return {turnId:'owned',cancel:()=>{metrics.cancels++;},events:events(request)};}}})}}}};
    const plugin={manifest:{version:'2.3.21'},chatHost:{getActiveModelSelection:()=>selection}};
    const app={plugins:{getPlugin:()=>plugin},workspace:{getLeavesOfType:()=>[{view:{getActiveTab:()=>({session:{runtime}})}}]}};
    return {app,metrics,plugin,invalidate:()=>invalidate()};
  };
  await check("2.3.24 direct request uses an isolated passive run while prefill stays unverified",async()=>{
    const f=requestFixture(()=>({async *[Symbol.asyncIterator](){yield {type:'text_delta',text:'P10 response'};yield {type:'turn_completed',reason:'completed'};}}));
    f.plugin.manifest.version='2.3.24';
    Object.defineProperty(f.plugin,'settings',{get(){throw Error('settings must not be read');}});
    assert.equal(api.claudianAvailability(f.app).compatiblePrefill,false);
    assert.equal(await api.requestClaudian(f.app,'P10 synthetic material'),'P10 response');
    assert.equal(f.metrics.executions,1);assert.equal(f.metrics.releases,1);
  });
  await check("2.3.30 direct request uses an isolated passive run while prefill stays unverified",async()=>{
    const f=requestFixture(()=>({async *[Symbol.asyncIterator](){yield {type:'text_delta',text:'P10 response 2330'};yield {type:'turn_completed',reason:'completed'};}}));
    f.plugin.manifest.version='2.3.30';
    Object.defineProperty(f.plugin,'settings',{get(){throw Error('settings must not be read');}});
    assert.equal(api.claudianAvailability(f.app).compatiblePrefill,false);
    assert.equal(await api.requestClaudian(f.app,'P10 synthetic material'),'P10 response 2330');
    assert.equal(f.metrics.executions,1);assert.equal(f.metrics.releases,1);
  });
  await check("2.3.30 forwards only explicitly attached images with text through the isolated passive session",async()=>{
    const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
    const f=requestFixture(request=>({async *[Symbol.asyncIterator](){
      assert.deepEqual(request.input,[{type:'text',text:'Describe attached image'},{type:'image',image:{id:'margin-study-image-1',name:'image-1.png',mediaType:'image/png',data,size:70,source:'paste'}}]);
      assert.deepEqual(request.toolPolicy,{kind:'passive'});assert.equal(request.context,undefined);assert.equal(request.conversationHistory,undefined);
      yield {type:'text_delta',text:'A synthetic image'};yield {type:'turn_completed',reason:'completed'};
    }}));
    f.plugin.manifest.version='2.3.30';Object.defineProperty(f.plugin,'settings',{get(){throw Error('settings must not be read');}});
    assert.equal(await api.requestClaudian(f.app,'Describe attached image',{images:['data:image/png;base64,'+data]}),'A synthetic image');
    assert.equal(f.metrics.releases,1);
  });
  await check("image requests stop if Claudian changes to an unverified image adapter while initializing",async()=>{
    const f=requestFixture(()=>{throw Error('must not execute an unverified image adapter');});f.plugin.manifest.version='2.3.30';
    f.app.workspace.getLeavesOfType()[0].view.getActiveTab().session.runtime.model.ensureExecutionInitialized=async()=>{f.plugin.manifest.version='2.3.24';return true;};
    await assert.rejects(api.requestClaudian(f.app,'Image',{images:['data:image/png;base64,AAAA']}),error=>error.code==='claudian-changed');
    assert.equal(f.metrics.executions,0);assert.equal(f.metrics.releases,0);
  });
  await check("unsupported image versions, remote URLs, malformed data and oversized attachments never start execution",async()=>{
    for(const [version,images] of [['2.3.24',['data:image/png;base64,AAAA']],['2.3.30',['https://example.invalid/private.png']],['2.3.30',['data:image/svg+xml;base64,AAAA']],['2.3.30',['data:image/png;base64,not_base64']],['2.3.30',Array(5).fill('data:image/png;base64,AAAA')],['2.3.30',['data:image/png;base64,'+'A'.repeat(12*1024*1024)]]]){
      const f=requestFixture(()=>{throw Error('invalid image must not execute');});f.plugin.manifest.version=version;
      await assert.rejects(api.requestClaudian(f.app,'Image',{images}),error=>error.code==='image');assert.equal(f.metrics.executions,0);assert.equal(f.metrics.releases,0);
    }
  });
  await check("Claudian reply sync reads the next newly completed turn and pins that conversation",async()=>{
    const calls=[],replies=[];let listener,active=true;
    const plugin={manifest:{version:'2.3.30'},api:{version:1,read:async id=>{calls.push(id);return "P10 reply";}}};
    const app={plugins:{getPlugin:id=>id==='realclaudian'?plugin:null},workspace:{on:(name,callback)=>{assert.equal(name,'claudian:turn-ended');listener=callback;return{off:()=>{active=false;}};}}};
    const subscription=api.subscribeClaudianReplies(app,reply=>replies.push(reply));
    assert.equal(subscription?.sessionId,null);assert.equal(calls.length,0);
    listener({sessionId:'synthetic-session-a'});await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(subscription?.sessionId,'synthetic-session-a');listener({sessionId:'other-session'});await Promise.resolve();
    assert.deepEqual(calls,['synthetic-session-a']);assert.deepEqual(replies,['P10 reply']);
    subscription.dispose();assert.equal(active,false);
  });
  await check("unavailable models and unsupported versions fail before opening an execution session",async()=>{
    for(const [selection,version] of [[null,'2.3.21'],[{providerId:'x',model:'x'},'future']]){
      const f=requestFixture(()=>{throw Error('must not execute');},selection);f.plugin.manifest.version=version;
      await assert.rejects(api.requestClaudian(f.app,'Explicit'),error=>['claudian-model','claudian-adapter'].includes(error.code));assert.equal(f.metrics.executions,0);assert.equal(f.metrics.releases,0);
    }
  });
  await check("cancel, timeout and provider invalidation stop a blocked stream and release its session",async()=>{
    for(const mode of ['cancel','timeout','invalidate']){
      let started;const ready=new Promise(resolve=>started=resolve),f=requestFixture(()=>({[Symbol.asyncIterator](){return {next:()=>{started();return new Promise(()=>{});},return:async()=>({done:true})};}}));const controller=new AbortController();
      const pending=api.requestClaudian(f.app,'Explicit',{signal:controller.signal,timeoutMs:mode==='timeout'?15:1000});await ready;
      if(mode==='cancel')controller.abort();if(mode==='invalidate')f.invalidate();
      await assert.rejects(pending,error=>['cancelled','timeout','claudian-changed'].includes(error.code));assert.equal(f.metrics.releases,1);assert.ok(f.metrics.cancels>=1);
    }
  });
  await check("unfinished and provider-error streams cannot return a successful reply or expose backend errors",async()=>{
    for(const events of [[{type:'text_delta',text:'partial'}],[{type:'execution_error',message:'sensitive-provider-body'}],[{type:'text_delta',text:'partial'},{type:'turn_completed',reason:'max_tokens'}]]){
      const f=requestFixture(()=>({async *[Symbol.asyncIterator](){yield* events;}}));await assert.rejects(api.requestClaudian(f.app,'Explicit'),error=>!error.message.includes('sensitive-provider-body')&&['incomplete','claudian-provider'].includes(error.code));assert.equal(f.metrics.releases,1);
    }
  });
} catch (error) { failure = error; process.exitCode = 1; console.error(error.stack || error); }
finally { await writeFile(join(evidence, "results.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), environment: "synthetic Claudian views and commands; no native app, credentials or model request", checks, ...failure ? { error: String(failure.stack || failure) } : {} }, null, 2)); await rm(temporary, { recursive: true, force: true }); console.log(`${checks.length} Claudian checks passed.`); }
