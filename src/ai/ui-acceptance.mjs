// Real browser input over a synthetic provider/host. Never connects to a user account or vault.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { runBrowser } from "../../scripts/verify/ego-harness.mjs";
const exec = promisify(execFile), here = dirname(fileURLToPath(import.meta.url)), project = resolve(here,"../.."), temporary = await mkdtemp(join(tmpdir(),"marginstudy-ai-ui-"));
const evidence=join(process.env.MARGINSTUDY_VERIFY_DIR||tmpdir(),"ai-ui-acceptance-evidence");await mkdir(evidence,{recursive:true});
const red="iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==";
await writeFile(join(temporary,"fixture.ts"),(await readFile(join(here,"ui-fixture.txt"),"utf8")).replaceAll("__PROJECT__",project));
await writeFile(join(temporary,"red.png"),Buffer.from(red,"base64"));
await writeFile(join(temporary,"styles.css"),(await readFile(join(project,"src/styles/styles-base.css"),"utf8"))+"\n"+(await readFile(join(project,"src/styles/styles-ai.css"),"utf8")));
await writeFile(join(temporary,"index.html"),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>AI 侧栏交互验收</title><link rel="stylesheet" href="/styles.css"><style>:root{--background-primary:#fff;--background-secondary:#f7f7f7;--background-modifier-border:#d8d8dc;--text-normal:#141416;--text-muted:#7b8490}*{box-sizing:border-box}body{margin:0;font:14px -apple-system,sans-serif;background:#f2f2f2}.top{height:71px;background:white;border-bottom:1px solid #ddd;padding:24px;color:#7b8490}.document{position:absolute;left:0;top:71px;width:725px;height:788px;background:white;border-right:1px solid #ddd;padding:72px 60px}.document h1{font-size:20px}.document p{max-width:530px;line-height:1.8}#host{position:absolute;right:0;top:71px;width:440px;height:788px;border-left:1px solid #ddd}#drag-card{position:absolute;left:870px;top:570px;width:170px;background:#ffffa6;border:1px solid #e3e2ac;padding:12px;border-radius:5px}#undo{position:absolute;left:870px;top:700px}</style><body><div class="top">MarginStudy · 合成阅读工作区</div><article class="document"><h1>L4 Sample Document - Alpha</h1><p>Synthetic test PDF for MarginStudy runtime verification.</p><p>Only the selected paragraph or dragged card is attached to the AI request.</p></article><div id="drag-card" draggable="true">Selected card<br>EXPLICIT_DRAG_CARD</div><button id="undo">撤销库变更</button><div id="host"></div><script type="module" src="/fixture.js"></script></body></html>');
await build({entryPoints:[join(temporary,"fixture.ts")],bundle:true,platform:"browser",format:"esm",target:"chrome120",outfile:join(temporary,"fixture.js"),plugins:[{name:"synthetic-host",setup(builder){
  builder.onResolve({filter:/^(obsidian|crypto|http|https)$/},args=>({path:args.path,namespace:"synthetic"}));
  builder.onLoad({filter:/.*/,namespace:"synthetic"},({path})=>({contents:path==="obsidian"?"export class App {} export class TFile {} export class Notice {} export class Component {} export const MarkdownRenderer={render:async()=>{}};":path==="crypto"?"export function createHash(){throw new Error('not used in UI acceptance');}":"export function request(){throw new Error('native transport must not run in browser acceptance');}",loader:"js"}));
}}]});
const requests=[],timers=new Set();
const frame=delta=>`data: ${JSON.stringify({choices:[{index:0,delta}]})}\n\n`;
const finish=reason=>`data: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:reason}]})}\n\ndata: [DONE]\n\n`;
const respond=async(response,text)=>{for(const part of [text.slice(0,5),text.slice(5)]){if(response.destroyed)return;response.write(frame({content:part}));await new Promise(done=>setTimeout(done,30));}if(!response.destroyed)response.end(finish("stop"));};
const tool=(response,name,args)=>{const data=JSON.stringify(args),middle=Math.floor(data.length/2);response.end(frame({tool_calls:[{index:0,id:"ui-call",type:"function",function:{name:name.slice(0,5),arguments:data.slice(0,middle)}}]})+frame({tool_calls:[{index:0,function:{name:name.slice(5),arguments:data.slice(middle)}}]})+finish("tool_calls"));};
const server=createServer(async(request,response)=>{
  const pathname=new URL(request.url,"http://127.0.0.1").pathname;
  if(pathname==="/v1/chat/completions"){
    const buffers=[];for await(const chunk of request)buffers.push(chunk);const body=JSON.parse(Buffer.concat(buffers));requests.push(body);response.writeHead(200,{"Content-Type":"text/event-stream"});
    const last=body.messages.at(-1),text=typeof last.content==="string"?last.content:last.content?.find(part=>part.type==="text")?.text??"";
    if(text.startsWith("Binding vision test.")){const nonce=text.match(/RED_([a-z0-9-]+)/)[1],image=last.content.find(part=>part.type==="image_url").image_url.url;await respond(response,(image.endsWith(red)?"RED":"BLUE")+"_"+nonce);return;}
    if(last.role==="tool"){const data=JSON.parse(last.content);await respond(response,data.reply??"预览已准备好，请检查后保存。");return;}
    if(body.tools?.[0]?.function.name==="marginstudy_binding_probe"){tool(response,"marginstudy_binding_probe",{challenge:text.match(/challenge exactly ([a-z0-9-]+)/)[1]});return;}
    if(text.includes("CANCEL_TEST")){response.write(frame({content:"生成中…"}));const timer=setTimeout(()=>response.end(finish("stop")),15000);timers.add(timer);response.on("close",()=>{clearTimeout(timer);timers.delete(timer);});return;}
    if(body.tool_choice?.function?.name==="propose_cards"){tool(response,"propose_cards",{cards:[{title:"合成问题",excerpt:"原始问题？",note:"原始答案。",tags:["test"]}]});return;}
    if(body.tool_choice?.function?.name==="propose_outline"){tool(response,"propose_outline",{title:"目录",items:[{title:"第一章",level:1,note:""},{title:"子主题",level:2,note:""},{title:"第二章",level:1,note:""}]});return;}
    await respond(response,body.messages[0].content.includes("Transcribe/convert")?"# 图片识别\n\n合成 Markdown 内容。":"合成 AI 回复。只使用你明确附加的材料。");return;
  }
  const name=pathname.slice(1)||"index.html";if(!["index.html","fixture.js","styles.css"].includes(name)){response.writeHead(404).end();return;}
  response.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":"text/html;charset=utf-8");response.end(await readFile(join(temporary,name)));
});await new Promise(done=>server.listen(0,"127.0.0.1",done));
const origin=`http://127.0.0.1:${server.address().port}`,session=`marginstudy-ai-ui-${process.pid}`;
const browser=(...args)=>runBrowser(session,...args);
const evaluate=async source=>JSON.parse((await browser("eval",source)).stdout),inspect=()=>evaluate("window.aiFixture.inspect()");
const click=async name=>{await browser("find","role","button","click","--name",name,"--exact");};
const fill=(label,value)=>browser("find","label",label,"fill",value);
const idle=()=>browser("wait","--fn","!document.querySelector('[aria-label=\"停止 AI 生成\"]') && !document.querySelector('.ms-ai-status')?.textContent");
const checks=[];let failure;
const check=(name,run)=>{run();checks.push({name,passed:true});console.log("✓ "+name);};
try{
  await browser("open",origin);await browser("set","viewport",1512,859);await browser("wait","--fn","Boolean(window.aiFixture?.ready||window.fixtureError)");const fatal=await evaluate("window.fixtureError||null");if(fatal)throw new Error(fatal);
  check("unbound sidebar disables Send and makes no provider request",()=>{assert.equal(requests.length,0);});assert.equal(await evaluate("document.querySelector('.ms-ai-send').disabled"),true);
  await click("AI 设置");await fill("Base URL",origin+"/v1/chat/completions");await fill("API Key","synthetic-ui-key");await fill("Mini 模型","synthetic-mini");await fill("Normal 模型","synthetic-normal");await click("测试并绑定自定义 AI");await browser("wait","--fn","window.aiFixture.inspect().bound && document.querySelector('.ms-ai-settings-status').textContent.includes('已通过并绑定')");
  const bound=await inspect();check("settings performs all four compatibility requests and stores the key outside plugin/local data",()=>{assert.equal(requests.length,4);assert.equal(bound.keyLeaked,false);assert.equal(bound.secretCount,1);assert.equal(bound.config.hasSavedKey,true);});await click("关闭");
  const layout=await evaluate("(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}};return{panel:rect('.ms-ai-panel'),header:rect('.ms-ai-header'),template:rect('.ms-ai-template'),color:getComputedStyle(document.querySelector('.ms-ai-body')).backgroundColor,mode:document.querySelector('.ms-ai-mode').value}})()");
  check("native sidebar keeps the 440-wide pane, 32-high header, Template row and bottom composer",()=>{assert.ok(Math.abs(layout.panel.w-440)<=1);assert.equal(layout.header.h,32);assert.equal(layout.template.h,24);assert.equal(layout.mode,"chat");});await browser("screenshot",join(evidence,"ai-chat-native-reference.png"));
  await click("附加文字或图片");await click("使用当前选择");await fill("AI 问题","解释当前选择");await click("发送 AI 请求");await idle();
  check("real composer sends only explicit selected text and keeps the library unchanged",()=>{assert.ok(JSON.stringify(requests.at(-1)).includes("ONLY_SELECTED_PARAGRAPH"));assert.ok(!JSON.stringify(requests).includes("CANARY_NOT_SELECTED"));});assert.equal((await inspect()).cards.length,2);
  await fill("AI 问题","继续解释");await click("发送 AI 请求");await idle();assert.equal(requests.at(-1).messages.length,4);
  const draggedReply=await evaluate("(()=>{const message=document.querySelector('.ms-ai-message-assistant');const data=new DataTransfer();message.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:data}));return {draggable:message.draggable,payload:JSON.parse(data.getData('application/x-marginstudy-ai-reply'))}})()");
  check("AI reply exposes its text as a draggable mindmap payload",()=>{assert.equal(draggedReply.draggable,true);assert.ok(draggedReply.payload.text.includes("合成 AI 回复"));});
  await browser("select","[aria-label=\"AI 对话模式\"]","ask");await fill("AI 问题","独立问答");await click("发送 AI 请求");await idle();
  check("Chat includes the previous exchange and Ask starts a separate request",()=>assert.equal(requests.at(-1).messages.length,2));
  const presets=await evaluate("[...document.querySelector('[aria-label=\"AI 提问模板\"]').options].map(option=>option.textContent)");
  check("AI presets include None, Guide, Quiz, Explain and Mind Map",()=>assert.deepEqual(presets,["模板：无","模板：引导模式","模板：测验模式","模板：解释模式","模板：脑图"]));
  await click("管理 AI 模板");assert.ok(await evaluate("Boolean(document.querySelector('[aria-label=\"整理成脑图提示词\"]'))"));await click("完成");
  await click("更多 AI 功能");assert.ok(await evaluate("[...document.querySelectorAll('[aria-label=\"更多 AI 功能菜单\"] button')].map(button=>button.textContent).join('|')==='对当前文档|AI 生成目录'"));await click("AI 生成目录");
  assert.ok((await evaluate("document.querySelector('.ms-ai-status').textContent")).includes('请先打开当前文档'));
  await evaluate("window.aiFixture.setReader(true); true");await click("更多 AI 功能");await click("AI 生成目录");await browser("wait","--fn","document.querySelector('.ms-ai-context-chip')?.textContent.includes('当前文档')");assert.equal(await evaluate("document.querySelector('[aria-label=\"AI 任务\"]').value"),"outline");
  await click("移除文字上下文");await evaluate("window.aiFixture.setReader(false); true");
  await browser("select","[aria-label=\"AI 提问模板\"]","mindmap");assert.equal(await evaluate("document.querySelector('[aria-label=\"AI 任务\"]').value"),"outline");await browser("select","[aria-label=\"AI 任务\"]","chat");
  await click("附加文字或图片");await click("使用当前选择");await browser("select","[aria-label=\"AI 提问模板\"]","guide");await fill("AI 问题","Guide this synthetic concept");await click("发送 AI 请求");await idle();
  check("Guide requests one step at a time using only explicitly attached context",()=>{const sent=JSON.stringify(requests.at(-1));assert.ok(sent.includes("Guide this synthetic concept")&&sent.includes("每次只问一个问题"));assert.ok(sent.includes("ONLY_SELECTED_PARAGRAPH")&&!sent.includes("CANARY_NOT_SELECTED"));assert.equal((requests.at(-1)).messages.length,2);});
  await browser("select","[aria-label=\"AI 提问模板\"]","");
  await browser("select","[aria-label=\"AI 任务\"]","cards");await fill("AI 问题","从这段合成资料生成卡片");await click("发送 AI 请求");await idle();const beforeCard=await inspect();assert.equal(beforeCard.cards.length,2);await fill("卡片 1 正文","用户在预览中改过的问题");await click("保存卡片");
  const savedCard=await inspect();check("card tools show an editable preview and only an explicit save creates a card without review enrollment",()=>{assert.equal(savedCard.cards.length,3);assert.equal(savedCard.cards.at(-1).front,"用户在预览中改过的问题");assert.deepEqual(savedCard.pending,[]);});await browser("screenshot",join(evidence,"ai-card-preview.png"));
  await browser("select","[aria-label=\"AI 任务\"]","outline");await fill("AI 问题","从合成资料生成目录");await click("发送 AI 请求");await idle();await fill("AI 目录总标题","用户编辑的目录");await fill("目录 2 标题","用户编辑的子主题");await click("保存目录");const savedOutline=await inspect();
  check("outline preview edits save real hierarchy and undo removes the whole generated outline",()=>{assert.equal(savedOutline.nodes.length,4);assert.equal(savedOutline.nodes[0].title,"用户编辑的目录");assert.equal(savedOutline.nodes[2].parentId,savedOutline.nodes[1].id);});await browser("click","#undo");assert.equal((await inspect()).nodes.length,0);
  await click("附加文字或图片");await click("使用当前选择");await browser("select","[aria-label=\"AI 任务\"]","markdown");await browser("upload","[aria-label=\"选择 AI 图片\"]",join(temporary,"red.png"));await browser("wait","--fn","document.querySelectorAll('.ms-ai-image-chip').length===1");await fill("AI 问题","识别这张图");await click("发送 AI 请求");await idle();
  assert.ok(requests.at(-1).messages.at(-1).content.some(part=>part.type==="image_url"));assert.ok((await evaluate("document.querySelector('[aria-label=\"Markdown 预览正文\"]').value")).includes("[来源文档](<selected.pdf>)"));check("Markdown previews include an editable source link when selected material has a document",()=>{});await fill("Markdown 预览正文","# 用户编辑的识别结果\n\n已核对图片。");await fill("新 Markdown 文件名","浏览器识别验收.md");await click("另存为新笔记");await browser("wait","--fn","window.aiFixture.inspect().files.some(([name])=>name==='浏览器识别验收.md')");
  const savedMarkdown=await inspect();check("real image upload uses multimodal input and user-edited Markdown saves to a new file",()=>assert.equal(savedMarkdown.files.find(([name])=>name==="浏览器识别验收.md")[1],"# 用户编辑的识别结果\n\n已核对图片。"));
  await click("AI 设置");assert.equal(await evaluate("document.querySelector('[aria-label=\"API Key\"]').value"),"");await fill("Normal 模型","synthetic-other");assert.equal((await inspect()).bound,false);await click("关闭");assert.equal(await evaluate("document.querySelector('.ms-ai-send').disabled"),true);
  check("editing a model immediately unbinds chat and reopening settings never reveals the saved key",()=>{});
  await click("AI 设置");await fill("Normal 模型","synthetic-normal");await click("测试并绑定自定义 AI");await browser("wait","--fn","window.aiFixture.inspect().bound");await click("关闭");
  await click("新建 AI 对话");await browser("select","[aria-label=\"AI 任务\"]","chat");await browser("drag","#drag-card",".ms-ai-body");await browser("wait","--fn","document.querySelector('.ms-ai-context-chip')?.textContent.includes('1 张卡片')");await fill("AI 问题","解释拖入卡片");await click("发送 AI 请求");await idle();
  check("dragging one source card attaches that card and never uploads other library content",()=>{assert.ok(JSON.stringify(requests.at(-1)).includes("EXPLICIT_DRAG_CARD"));assert.ok(!JSON.stringify(requests).includes("CANARY_NOT_SELECTED"));});
  await fill("AI 问题","CANCEL_TEST");await click("发送 AI 请求");await browser("wait","--fn","document.querySelector('.ms-ai-message-assistant:last-child .ms-ai-message-text')?.textContent.includes('生成中')");await click("停止 AI 生成");await browser("wait","--fn","!document.querySelector('[aria-label=\"停止 AI 生成\"]')");
  check("Stop cancels a live stream without saving generated content",()=>{});assert.equal((await inspect()).cards.length,3);
  assert.equal(await evaluate("document.querySelector('[aria-label=\"AI 问题\"]').value"),"CANCEL_TEST");check("cancel restores the submitted question for an explicit retry",()=>{});
  await fill("AI 问题","CANCEL_TEST suspended panel");await click("发送 AI 请求");await browser("wait","--fn","document.querySelector('.ms-ai-message-assistant:last-child .ms-ai-message-text')?.textContent.includes('生成中')");
  const requestsBeforeSuspension=requests.length;await evaluate("window.aiFixture.suspend(); true");assert.equal(await evaluate("document.querySelectorAll('.ms-ai-panel').length"),0);await evaluate("window.aiFixture.resume(); true");await browser("wait","--fn","!document.querySelector('[aria-label=\"停止 AI 生成\"]')");
  check("hiding the panel aborts the live stream and reopening preserves partial replies without sending another request",()=>{assert.equal(requests.length,requestsBeforeSuspension);assert.equal(timers.size,0);});assert.ok((await evaluate("document.querySelector('.ms-ai-body').textContent")).includes('生成中'));assert.equal((await inspect()).cards.length,3);
  await click("关闭 AI 侧栏");assert.equal(await evaluate("document.querySelectorAll('.ms-ai-panel').length"),0);check("closing the sidebar disposes its UI and in-memory conversation state",()=>{});
  const beforeBridgeRequests=requests.length;
  await browser("open",origin+"/?claudian");await browser("wait","--fn","Boolean(window.aiFixture?.ready||window.fixtureError)");
  assert.equal(await evaluate("document.querySelector('[aria-label=\"AI 服务\"]').value"),"claudian");
  check("an enabled Claudian defaults to direct generation and hides the custom Mini/Normal controls",()=>{});
  assert.equal(await evaluate("document.querySelector('.ms-ai-tier').hidden"),true);
  await browser("select","[aria-label=\"AI 任务\"]","cards");await click("附加文字或图片");await click("使用当前选择");await fill("AI 问题","生成学习卡片");await click("发送 AI 请求");await browser("wait","--fn","Boolean(document.querySelector('[aria-label=\"卡片 1 正文\"]'))");
  const prefilled=await inspect();
  check("Claudian directly streams selected content back into an editable preview without altering its existing draft",()=>{assert.equal(requests.length,beforeBridgeRequests);assert.equal(prefilled.bridge.prefills.length,0);assert.equal(prefilled.bridge.input,"已有草稿");assert.ok(prefilled.bridge.requests[0].includes("ONLY_SELECTED_PARAGRAPH"));assert.ok(!prefilled.bridge.requests[0].includes("CANARY_NOT_SELECTED"));assert.equal(prefilled.bridge.sends,1);assert.equal(prefilled.cards.length,2);});await browser("screenshot",join(evidence,"ai-claudian-direct.png"));
  await fill("卡片 1 正文","核对后的直连问题");await click("保存卡片");const directSaved=await inspect();assert.equal(directSaved.cards.at(-1).front,"核对后的直连问题");assert.equal(directSaved.cards.at(-1).docPath,"selected.pdf");assert.equal(await evaluate("document.querySelector('.ms-ai-preview-save').disabled"),true);check("direct replies retain their selected source and cannot be saved twice from the same preview",()=>{});
  await click("附加文字或图片");await click("使用当前选择");await fill("AI 问题","FAIL_REQUEST keep draft");await click("发送 AI 请求");await browser("wait","--fn","!document.querySelector('[aria-label=\"停止 AI 生成\"]')");assert.equal(await evaluate("document.querySelector('[aria-label=\"AI 问题\"]').value"),"FAIL_REQUEST keep draft");assert.ok(await evaluate("Boolean(document.querySelector('[aria-label=\"移除文字上下文\"]'))"));assert.equal((await inspect()).cards.length,3);assert.equal(await evaluate("document.querySelectorAll('.ms-ai-draft').length"),1);check("Claudian provider failure restores the question and selected source without a new import",()=>{});
  await evaluate("window.aiFixture.setClaudianVersion('2.3.21'); true");
  const beforeImage=(await inspect()).bridge.sends;await evaluate("(()=>{const dt=new DataTransfer();dt.items.add(new File(['synthetic'],'test.png',{type:'image/png'}));document.querySelector('[aria-label=\"AI 问题\"]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:dt}));return true;})()");assert.equal(await evaluate("document.querySelectorAll('.ms-ai-image-chip').length"),0);assert.equal((await inspect()).bridge.sends,beforeImage);assert.equal(await evaluate("document.querySelector('[aria-label=\"AI 问题\"]').value"),"FAIL_REQUEST keep draft");check("Claudian image paste is rejected before consuming the draft or making a request",()=>{});
  await evaluate("window.aiFixture.setClaudianVersion('2.3.30'); true");await click("自动接收下一条 Claudian 回复");assert.equal((await inspect()).bridge.replyReads.length,0);await evaluate("window.aiFixture.emitReply('synthetic-session'); true");await browser("wait","--fn","document.body.textContent.includes('SYNTHETIC_CLAUDIAN_REPLY')");await evaluate("window.aiFixture.emitReply('other-session'); true");await new Promise(resolve=>setTimeout(resolve,20));assert.ok(await evaluate("document.querySelector('[aria-label=\"卡片 1 正文\"]')?.value.includes('SYNTHETIC_CLAUDIAN_REPLY')"));assert.deepEqual((await inspect()).bridge.replyReads,["synthetic-session"]);check("opt-in native Claudian replies from the linked session automatically appear in MarginStudy; unrelated sessions and prior history are not read",()=>{});await click("停止同步 Claudian 回复");
  await click("新建 AI 对话");await browser("select","[aria-label=\"AI 任务\"]","chat");
  await browser("upload","[aria-label=\"选择 AI 图片\"]",join(temporary,"red.png"));
  await browser("wait","--fn","document.querySelectorAll('.ms-ai-image-chip').length===1");
  await fill("AI 问题","Describe explicitly attached image");await click("发送 AI 请求");await idle();
  const imageResult=await inspect(),imageInput=imageResult.bridge.inputs.at(-1);
  check("Claudian 2.3.30 image upload sends a real image block and displays the streamed reply in the same panel",()=>{
    assert.equal(imageInput.length,2);assert.equal(imageInput[1].type,'image');assert.equal(imageInput[1].image.mediaType,'image/png');assert.ok(imageInput[1].image.data.length>10);
    assert.equal(imageResult.bridge.input,'已有草稿');assert.equal(imageResult.cards.length,3);
  });
  assert.ok(await evaluate("document.querySelector('.ms-ai-message-assistant:last-child .ms-ai-message-text').textContent.includes('Direct streamed answer')"));
  assert.equal(await evaluate("document.querySelectorAll('.ms-ai-image-chip').length"),0);
  await browser("open",origin+"/?claudian&manual");await browser("wait","--fn","Boolean(window.aiFixture?.ready||window.fixtureError)");
  await click("附加文字或图片");await click("粘贴 AI 回复");await fill("粘贴的 AI 回复",'{"cards":[{"title":"AI问题","excerpt":"粘贴的问题","note":"粘贴的答案","tags":[]}]}');await click("生成可编辑预览");assert.equal((await inspect()).cards.length,2);await fill("卡片 1 正文","用户核对后的问题");await click("保存卡片");
  check("a pasted Claudian reply is editable and only Save creates a card without review enrollment",()=>{});const pastedCard=await inspect();assert.equal(pastedCard.cards.at(-1).front,"用户核对后的问题");assert.deepEqual(pastedCard.pending,[]);
  await click("附加文字或图片");await click("粘贴 AI 回复");await browser("select","[aria-label=\"回复预览类型\"]","outline");await fill("粘贴的 AI 回复","# 粘贴目录\n## 第一章\n### 子主题\n## 第二章");await click("生成可编辑预览");await click("保存目录");assert.equal((await inspect()).nodes.length,4);await browser("click","#undo");assert.equal((await inspect()).nodes.length,0);
  check("a manually pasted Markdown outline saves real hierarchy and remains one undoable transaction",()=>{});
  await evaluate("window.aiFixture.setClaudianVersion('future')");await fill("AI 问题","版本回退提问");await click("发送 AI 请求");await browser("wait","--fn","Boolean(document.querySelector('[aria-label=\"待粘贴到 Claudian 的提问\"]'))");assert.ok(await evaluate("document.querySelector('[aria-label=\"待粘贴到 Claudian 的提问\"]').value.includes('版本回退提问')"));
  check("unknown Claudian versions show an editable manual-copy fallback without appending or sending",()=>{});const fallback=await inspect();assert.equal(fallback.bridge.prefills.length,0);assert.equal(fallback.bridge.sends,0);assert.equal(requests.length,beforeBridgeRequests);await click("关闭");await click("关闭 AI 侧栏");
}catch(error){failure=error;process.exitCode=1;console.error(error.stack||error);await writeFile(join(evidence,"failure-snapshot.txt"),(await browser("snapshot","-i").catch(()=>({stdout:"snapshot unavailable"}))).stdout);await browser("screenshot",join(evidence,"failure.png")).catch(()=>{});}
finally{await writeFile(join(evidence,"results.json"),JSON.stringify({verifiedAt:new Date().toISOString(),environment:"isolated Chromium; localhost synthetic SSE provider; real AI UI/Store with synthetic Obsidian",checks,...failure?{error:String(failure.stack||failure)}:{}},null,2));console.log(`${checks.length} AI UI checks passed.`);await browser("close").catch(()=>{});for(const timer of timers)clearTimeout(timer);server.closeAllConnections();await new Promise(done=>server.close(done));await rm(temporary,{recursive:true,force:true});}
