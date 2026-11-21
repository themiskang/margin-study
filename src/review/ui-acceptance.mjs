/** Real browser input over a synthetic Store; never reads an Obsidian vault. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, realpath, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { runBrowser } from "../../scripts/verify/ego-harness.mjs";

const exec = promisify(execFile), here = dirname(fileURLToPath(import.meta.url));
const project = await realpath(resolve(here, "../.."));
const temporary = await realpath(await mkdtemp(join(tmpdir(), "marginstudy-review-ui-")));
const outputIndex = process.argv.indexOf("--output-dir");
const evidence = outputIndex >= 0 && process.argv[outputIndex + 1] ? resolve(process.argv[outputIndex + 1]) : temporary;
const nativeOnly = process.argv.includes("--native-only");
await mkdir(evidence, { recursive: true });
await writeFile(join(temporary, "fixture.ts"), (await readFile(join(here, "ui-fixture.txt"), "utf8")).replaceAll("__PROJECT__", project));
await writeFile(join(temporary, "obsidian.ts"), [
  "export class Component {} export class App {} export class TFile {} export function setIcon() {} export class Notice { constructor(message: string) { ((window as any).notices ??= []).push(message); } }",
  "const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');",
  "export class MarkdownRenderer { static async render(app: any, markdown: string, host: HTMLElement) {",
  "host.innerHTML = markdown.split(/(`[^`]*`)/g).map(part => part.startsWith('`') ? '<code>' + escape(part.slice(1,-1)) + '</code>' : escape(part).replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>').replace(/==(.+?)==/g, '<mark>$1</mark>')).join(''); } }",
].join("\n"));
// Obsidian 1.14.4 app.css: this higher-specificity host rule caused native
// Prev/Next and icon controls to acquire opaque button backgrounds. Keep the
// actual host selector/declarations here, with deterministic fixture variables.
const hostButtonStyles = 'button:not(.clickable-icon){color:var(--text-color);background-color:var(--interactive-normal);box-shadow:var(--input-shadow)}';
await writeFile(join(temporary, "index.html"), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>MarginStudy 复习交互验收</title><link rel="stylesheet" href="/styles.css"><style>:root{--background-primary:#fff;--background-secondary:#f4f6fb;--background-modifier-border:#d8deeb;--text-normal:#1d2433;--text-muted:#606c80;--interactive-accent:#5269dc;--text-color:#222;--interactive-normal:#efefef;--input-shadow:0 1px 2px #0002}body{padding:24px;font:16px/1.5 system-ui;color:#1d2433;background:#f4f6fb}.scope{margin:16px 0;padding:16px;background:#fff;border-radius:10px}' + hostButtonStyles + '</style><body><h1>复习交互验收 · 合成数据</h1><button id="begin">打开复习</button> <button id="history">打开复习记录</button><div class="scope"><h2>画布 A · 强调即挖空</h2><div id="scope-a"></div></div><div class="scope"><h2>画布 B · 普通强调</h2><div id="scope-b"></div></div><div id="cards" class="scope"></div><script type="module" src="/fixture.js"></script></body></html>');
await writeFile(join(temporary, "styles.css"), (await readFile(join(project, "styles.css"), "utf8")) + "\n" + (await readFile(join(project, "src/styles/styles-review.css"), "utf8")));
await build({ entryPoints: [join(temporary, "fixture.ts")], bundle: true, platform: "browser", format: "esm", target: "chrome120", outfile: join(temporary, "fixture.js"),
  plugins: [{ name: "synthetic-host", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: join(temporary, "obsidian.ts") }));
    builder.onResolve({ filter: /^crypto$/ }, () => ({ path: "unused-crypto", namespace: "synthetic" }));
    builder.onResolve({ filter: /\/(?:pdf\/readerView|word\/wordReader)$/ }, () => ({ path: "reader-types", namespace: "synthetic" }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic" }, ({ path }) => ({ contents: path === "reader-types" ? "export class ReaderView {} export const VIEW_TYPE_READER='synthetic-pdf'; export const VIEW_TYPE_WORD='synthetic-word';" : "export function createHash() { throw new Error('This UI test does not use backup hashing'); }", loader: "js" }));
  } }] });
const allowed = new Set(["index.html", "fixture.js", "styles.css"]);
const server = createServer(async (request, response) => {
  const name = new URL(request.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
  if (!allowed.has(name)) { response.statusCode = 404; response.end(); return; }
  response.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
  response.end(await readFile(join(temporary, name)));
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const session = `marginstudy-review-ui-${process.pid}`;
const browser = (...args) => runBrowser(session, ...args);
const evaluate = async source => JSON.parse((await browser("eval", source)).stdout);
const inspect = () => evaluate("window.reviewFixture.inspect()");
const checks = [];
function check(name, run) { run(); checks.push({ name, passed: true }); console.log("✓ " + name); }
const visible = async () => evaluate("({text:document.querySelector('.ms-review-question-text')?.textContent, modalText:document.querySelector('.ms-modal .ms-review-question-text')?.textContent,masks:document.querySelectorAll('.ms-modal .ms-cloze').length,gradesVisible:[...document.querySelectorAll('.ms-grade')].some(item=>item.offsetParent!==null),revealDisabled:[...document.querySelectorAll('.ms-modal button')].find(item=>item.textContent==='显示答案')?.disabled})");
const clickButton = async name => {
  await evaluate(`(()=>{const modals=[...document.querySelectorAll('.ms-modal')];const root=modals[modals.length-1]||document;const target=[...root.querySelectorAll('button')].find(button=>(button.getAttribute('aria-label')===${JSON.stringify(name)}||button.textContent===${JSON.stringify(name)})&&button.offsetParent!==null);target?.scrollIntoView({block:'nearest'});return true})()`);
  return browser("find", "role", "button", "click", "--name", name, "--exact");
};
const checkInput = async (selector, checked) => {
  await evaluate(`(()=>{document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'});return true})()`);
  if (selector.startsWith('[data-copy-')) {
    const hit = await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)}),panel=input.closest('.ms-native-card-advanced'),rect=input.getBoundingClientRect(),bounds=panel.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2;return {inPanel:x>=bounds.left&&x<=bounds.right&&y>=bounds.top&&y<=bounds.bottom,inViewport:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,uncovered:document.elementFromPoint(x,y)===input}})()`);
    assert.deepEqual(hit, { inPanel: true, inViewport: true, uncovered: true }, `${selector} is clipped or covered`);
  }
  return browser(checked ? "check" : "uncheck",selector);
};
const clickSelector = async selector => { await browser("scrollintoview",selector); return browser("click",selector); };
const draw = async () => {
  await browser("scrollintoview", ".ms-modal canvas");
  const bounds = await evaluate("(()=>{const r=document.querySelector('.ms-modal canvas').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};})()");
  await browser("mouse", "move", Math.round(bounds.left + bounds.width * 0.1), Math.round(bounds.top + bounds.height * 0.3));
  await browser("mouse", "down");
  // macOS daemon IPC can transiently return EAGAIN after a long suite. Only
  // retry this position update; never replay a save, grade or navigation.
  for (let attempt = 0; ; attempt++) {
    try { await browser("mouse", "move", Math.round(bounds.left + bounds.width * 0.7), Math.round(bounds.top + bounds.height * 0.7)); break; }
    catch (error) { if (attempt >= 2 || !String(error).includes("Resource temporarily unavailable")) throw error; }
  }
  await browser("mouse", "up");
};
let error;
try {
  await browser("open", `http://127.0.0.1:${server.address().port}`);
  await browser("set", "viewport", "1512", "949");
  await browser("wait", "--fn", "Boolean(window.reviewFixture?.ready || window.fixtureError)");
  const fatal = await evaluate("window.fixtureError || null"); if (fatal) throw new Error(fatal);
  if (!nativeOnly) {
  const initial = await inspect();
  check("emphasis masking follows question scope while code and stored text stay intact", () => {
    assert.equal(initial.scopeAMasks, 2); assert.equal(initial.scopeBMasks, 0); assert.equal(initial.codeMasked, false); assert.equal(initial.unchanged, true);
  });
  await browser("snapshot", "-i"); await browser("click", "#begin");
  await browser("wait", "--fn", "document.querySelector('.ms-modal textarea') !== null");
  await clickButton("批注与工具");
  await clickButton("隐藏挖空");
  await browser("wait", "--fn", "document.querySelector('.ms-modal .ms-review-question-text')?.textContent.includes('记忆内容')");
  const hidden = await visible(), afterHide = await inspect();
  check("hiding cloze reveals view text without revealing the back, allowing a grade or writing data", () => {
    assert.equal(hidden.masks, 0); assert.equal(hidden.gradesVisible, false); assert.equal(hidden.revealDisabled, false);
    assert.ok(!hidden.modalText.includes("独立的背面答案")); assert.equal(afterHide.unchanged, true); assert.equal(afterHide.logs.length, initial.logs.length); assert.equal(afterHide.questionId, initial.questionId);
  });
  await clickButton("显示挖空");
  await browser("wait", "--fn", "document.querySelectorAll('.ms-modal .ms-cloze').length === 2");
  const shown = await visible(), afterShow = await inspect();
  check("showing cloze restores masking with the same question and stored source", () => {
    assert.ok(!shown.modalText.includes("记忆内容")); assert.equal(shown.masks, 2); assert.equal(shown.gradesVisible, false);
    assert.equal(afterShow.questionId, initial.questionId); assert.equal(afterShow.unchanged, true); assert.equal(afterShow.logs.length, initial.logs.length);
  });
  await browser("click", ".ms-modal .ms-cloze");
  const peek = await visible(), afterPeek = await inspect();
  check("a temporary emphasis peek keeps explicit cloze and grading concealed", () => {
    assert.ok(peek.modalText.includes("强调内容")); assert.ok(!peek.modalText.includes("记忆内容")); assert.equal(peek.gradesVisible, false); assert.equal(afterPeek.unchanged, true);
  });
  await browser("find", "label", "本次复习批注", "fill", "先理解关联，再复述。合成验收批注。");
  await browser("click", ".ms-modal details summary");
  await draw(); await clickButton("撤销一笔"); await draw(); await clickButton("清空手绘"); await draw();
  await clickButton("显示答案");
  await browser("wait", "--fn", "document.querySelector('.ms-grade.good')?.offsetParent !== null");
  const revealed = await visible();
  check("show answer remains the independent gate for grading", () => { assert.equal(revealed.gradesVisible, true); assert.ok(revealed.modalText.includes("记忆内容")); });
  await browser("screenshot", join(evidence, "review.png"));
  await browser("click", ".ms-grade.good");
  await browser("wait", "--fn", "window.reviewFixture.inspect().logs.some(item=>!item.initialization)");
  const graded = await inspect(), record = graded.logs.find(item => !item.initialization);
  check("real drawing input and text feedback attach to one completed review and keep raw cloze", () => {
    assert.equal(record.commentText, "先理解关联，再复述。合成验收批注。"); assert.equal(record.drawing.length, 1); assert.ok(record.drawing[0].length >= 2);
    assert.ok(Math.abs(record.drawing[0][0].x - 0.1) < 0.02); assert.equal(record.cardSnapshot.front, graded.front);
    assert.equal(graded.unchanged, true); assert.equal(graded.dailyCount, 1); assert.equal(graded.pending.length, 1);
  });
  await browser("press", "Escape"); await browser("click", "#history");
  await browser("wait", "--fn", "document.querySelector('.ms-modal canvas') !== null");
  const history = await evaluate("({text:document.querySelector('.ms-modal').textContent,canvas:document.querySelectorAll('.ms-modal canvas').length})");
  check("completed history renders saved feedback and drawing while hiding initialization audits", () => { assert.ok(history.text.includes(record.commentText)); assert.equal(history.canvas, 1); assert.ok(!history.text.includes("2020/1/2")); });
  await browser("screenshot", join(evidence, "history.png"));
  await browser("press", "Escape");
  await clickSelector('#cards [data-card-id="copy-source"] .ms-card-type');
  await browser("wait", "--fn", "document.querySelector('[data-card-part=excerpt]') !== null");
  await browser("screenshot", join(evidence, "card-editor.png")); await clickButton("更多卡片操作");
  const select = (part, start, end) => evaluate(`(()=>{const input=document.querySelector('[data-card-part="${part}"]');input.scrollIntoView({block:'center'});input.focus();input.setSelectionRange(${start},${end});return true;})()`);
  const savedSource = async () => (await inspect()).cards.find(item => item.id === "copy-source");
  await select("excerpt", 2, 4); await browser("click", '[data-cloze-part="excerpt"]');
  const wrapped = await savedSource();
  check("selected saved excerpt text is wrapped through the Store API", () => { assert.equal(wrapped.front, "复制{{正文}}"); });
  await select("excerpt", 4, 6); await browser("click", '[data-cloze-part="excerpt"]');
  const unwrapped = await savedSource();
  check("selecting the inner text cancels a saved plain cloze", () => { assert.equal(unwrapped.front, "复制正文"); });
  await browser("fill", '[data-card-part="excerpt"]', "尚未保存的草稿");
  await select("excerpt", 0, 4); await browser("click", '[data-cloze-part="excerpt"]');
  const guarded = await savedSource(), draft = await evaluate("document.querySelector('[data-card-part=excerpt]').value");
  check("cloze controls leave both unsaved draft text and saved source untouched", () => { assert.equal(guarded.front, "复制正文"); assert.equal(draft, "尚未保存的草稿"); });
  await browser("fill", '[data-card-part="excerpt"]', "复制正文");
  await select("note", 2, 4); await browser("click", '[data-cloze-part="note"]');
  assert.equal((await savedSource()).back, "复制{{笔记}}", JSON.stringify(await evaluate("({notices:window.notices,selection:[document.querySelector('[data-card-part=note]').selectionStart,document.querySelector('[data-card-part=note]').selectionEnd]})")));
  await select("note", 2, 8); await browser("click", '[data-cloze-part="note"]');
  const noteRestored = await savedSource();
  check("saved note text has the same wrap and unwrap control", () => { assert.equal(noteRestored.back, "复制笔记"); });
  const palette = await evaluate("(()=>{const chips=[...document.querySelectorAll('.ms-native-card-advanced .ms-colorrow .ms-colorchip')];return chips.map(chip=>({x:chip.offsetLeft,y:chip.offsetTop,width:chip.offsetWidth,height:chip.offsetHeight}))})()");
  check("the card editor retains 16 colors in two compact eight-color rows", () => {
    assert.equal(palette.length, 16);
    assert.ok(palette.every(chip => chip.width === 24 && chip.height === 24));
    assert.ok(palette.slice(0,8).every(chip => chip.y === palette[0].y));
    assert.ok(palette.slice(8).every(chip => chip.y === palette[8].y));
    assert.ok(palette[8].y > palette[0].y);
    assert.ok(palette.slice(0,8).every((chip,index) => chip.x === palette[index+8].x));
  });
  await clickSelector(".ms-review-copy-options summary");
  await browser("wait", "--fn", "(()=>{const input=document.querySelector('[data-copy-part=title]'),r=input.getBoundingClientRect(),panel=input.closest('.ms-native-card-advanced').getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return y>=panel.top&&y<=panel.bottom&&document.elementFromPoint(x,y)===input})()");
  const defaults = await evaluate("[...document.querySelectorAll('[data-copy-part],[data-copy-mask]')].every(input=>input.checked)");
  check("review copy defaults to all content and image masks", () => { assert.equal(defaults, true); });
  await browser("set", "viewport", "800", "600");
  await checkInput('[data-copy-part="note"]',false); await checkInput('[data-copy-part="note"]',true);
  await checkInput('[data-copy-part="images"]',false); await checkInput('[data-copy-part="images"]',true);
  await checkInput('[data-copy-mask="left"]',false); await checkInput('[data-copy-mask="left"]',true);
  const smallViewportChoices = await evaluate("[...document.querySelectorAll('[data-copy-part],[data-copy-mask]')].every(input=>input.checked)");
  check("review copy choices and masks remain scrollable and clickable in a smaller viewport", () => { assert.equal(smallViewportChoices, true); });
  await browser("set", "viewport", "1512", "949");
  await checkInput('[data-copy-part="title"]',false); await checkInput('[data-copy-part="excerpt"]',false); await checkInput('[data-copy-mask="right"]',false);
  const beforeCopy = await savedSource();
  await browser("screenshot", join(evidence, "copy-selection.png"));
  await clickButton("复制为复习卡");
  await browser("wait", "--fn", "window.reviewFixture.inspect().cards.some(item=>item.sourceCardId==='copy-source')");
  await browser("wait", "--fn", "document.querySelector('[data-review-decks]') !== null");
  await browser("find", "label", "新卡组名称", "fill", "界面验收复习卡组"); await clickButton("新建卡组");
  const createdDecks = await inspect(), createdDeck = createdDecks.decks.find(item => item.name === "界面验收复习卡组");
  check("no-deck enrollment opens a picker and creating a deck binds the learning set without implicit membership", () => {
    assert.ok(createdDeck); assert.deepEqual(createdDeck.cardIds, []); assert.equal(createdDecks.studySets[0].reviewDeckId, createdDeck.id);
    const createdCopy = createdDecks.cards.find(item => item.sourceCardId === "copy-source"); assert.ok(!createdDecks.pending.some(item => item.cardId === createdCopy.id));
  });
  await browser("screenshot", join(evidence, "deck-created.png")); await clickButton("加入此卡组");
  await browser("wait", "--fn", "document.querySelector('[data-review-decks]') === null");
  const copies = await inspect(), copy = copies.cards.find(item => item.sourceCardId === "copy-source");
  check("selected copy parts and masks enroll with independent identity without changing the source", () => {
    assert.deepEqual(copies.cards.find(item => item.id === "copy-source"), beforeCopy);
    assert.equal(copy.title, undefined); assert.equal(copy.front, ""); assert.equal(copy.back, "复制笔记"); assert.ok(copy.image);
    assert.deepEqual(copy.occlusions.map(item => item.id), ["left"]);
    assert.ok(copies.pending.some(item => item.cardId === copy.id && item.questionId === `${copy.id}::deck:${createdDeck.id}::occlusion:left`));
    assert.ok(copies.decks.find(item => item.id === createdDeck.id).cardIds.includes(copy.id));
  });
  const badges = await evaluate(`document.querySelectorAll('#cards [data-card-id="${copy.id}"] [data-review-deck="${createdDeck.id}"]').length`);
  check("explicitly enrolled cards show persistent deck-name badges", () => { assert.equal(badges, 1); });
  await clickSelector(`#cards [data-card-id="${copy.id}"] .ms-card-type`);
  await clickButton("更多卡片操作");
  await clickButton("创建 / 编辑图片遮挡");
  const occlusionTools = await evaluate("[...document.querySelectorAll('.ms-modal button')].map(button=>button.textContent.trim())");
  check("image occlusion editor offers a free-shape tool beside rectangles", () => {
    assert.ok(occlusionTools.includes("自由形状遮挡"), JSON.stringify(occlusionTools));
  });
  await clickButton("自由形状遮挡");
  await browser("scrollintoview","[data-occlusion-overlay]");
  const occlusionBounds = await evaluate("(()=>{const r=document.querySelector('[data-occlusion-overlay]').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()");
  const pathPoints = [[.4,.2],[.57,.23],[.53,.5],[.43,.55],[.4,.2]];
  await browser("mouse","move",Math.round(occlusionBounds.left+pathPoints[0][0]*occlusionBounds.width),Math.round(occlusionBounds.top+pathPoints[0][1]*occlusionBounds.height)); await browser("mouse","down");
  for(const [x,y] of pathPoints.slice(1)) await browser("mouse","move",Math.round(occlusionBounds.left+x*occlusionBounds.width),Math.round(occlusionBounds.top+y*occlusionBounds.height));
  await browser("mouse","up");
  await clickButton("调整遮挡");
  const vertexBefore=await evaluate("(()=>{const r=document.querySelector('[aria-label=\"遮挡顶点 2\"]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()");
  await browser("mouse","move",Math.round(vertexBefore.x),Math.round(vertexBefore.y)); await browser("mouse","down"); await browser("mouse","move",Math.round(vertexBefore.x+5),Math.round(vertexBefore.y+4)); await browser("mouse","up");
  const polygonBeforeSave = await evaluate("(()=>({count:document.querySelectorAll('[aria-label^=\"遮挡顶点\"]').length,vertex:(()=>{const r=document.querySelector('[aria-label=\"遮挡顶点 2\"]').getBoundingClientRect();return r.left+r.width/2})()}))()");
  await clickButton("保存遮挡题");
  const withPolygon = await inspect(), polygonCard=withPolygon.cards.find(item=>item.sourceCardId==="copy-source");
  check("freehand image mask saves normalized vertices on the independent copy",()=>{
    assert.equal(polygonBeforeSave.count,5); assert.ok(polygonBeforeSave.vertex>vertexBefore.x+3); assert.equal(polygonCard.occlusions.length,2); assert.ok(polygonCard.occlusions[1].points.length>=3);
    assert.ok(polygonCard.occlusions[1].points.every(point=>point.x>=0&&point.x<=1&&point.y>=0&&point.y<=1));
    assert.deepEqual(withPolygon.cards.find(item=>item.id==="copy-source"),beforeCopy);
  });
  await evaluate("window.reviewFixture.renderOcclusion("+JSON.stringify(copy.id)+","+JSON.stringify(polygonCard.occlusions[1].id)+")");
  await browser("wait","--fn","document.querySelector('#occlusion-render-check .ms-image-occlusion')!==null");
  const polygonRender=await evaluate("document.querySelector('#occlusion-render-check .ms-image-occlusion').style.clipPath");
  check("freehand mask renders as a clipped polygon over its source image",()=>{assert.match(polygonRender,/^polygon\(/);assert.ok(polygonRender.includes("%"));});
  await browser("press","Escape");
  await clickSelector(`#cards [data-card-id="${copy.id}"] .ms-card-type`); await clickButton("更多卡片操作"); await clickButton("创建 / 编辑图片遮挡");
  await clickButton("调整遮挡"); await browser("scrollintoview","[data-occlusion-overlay]");
  const polygonCenter=await evaluate("(()=>{const r=document.querySelector('[data-occlusion-overlay] [title=\"遮挡 2\"]').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()");
  await browser("mouse","move",Math.round(polygonCenter.x),Math.round(polygonCenter.y)); await browser("mouse","down"); await browser("mouse","up");
  await clickButton("删除图片遮挡 2");
  await clickButton("删除图片遮挡 1"); await clickButton("保存遮挡题");
  const edited = await inspect();
  check("editing the copied image mask leaves all source masks intact", () => {
    assert.deepEqual(edited.cards.find(item => item.id === "copy-source"), beforeCopy);
    assert.deepEqual(edited.cards.find(item => item.id === copy.id).occlusions, []);
  });
  await browser("press", "Escape");
  await clickSelector('#cards [data-card-id="copy-source"] .ms-card-type');
  await browser("wait", "--fn", "document.querySelector('[data-card-part=note]')!==null");
  await browser("fill", '[data-card-part="note"]', "来源更新后的笔记"); await clickButton("保存");
  await clickSelector(`#cards [data-card-id="${copy.id}"] .ms-card-type`); await clickButton("更多卡片操作"); await clickButton("从来源刷新内容");
  await browser("screenshot", join(evidence, "copy-refresh.png")); await clickButton("刷新选中内容");
  const refreshed = await inspect(), refreshedCopy = refreshed.cards.find(item => item.id === copy.id);
  check("explicit source refresh applies selected note and masks while keeping omitted title and excerpt", () => {
    assert.equal(refreshedCopy.back, "来源更新后的笔记"); assert.equal(refreshedCopy.front, ""); assert.equal(refreshedCopy.title, undefined);
    assert.deepEqual(refreshedCopy.occlusions.map(mask => mask.id), ["left"]); assert.ok(refreshedCopy.sourceSyncedAt);
  });
  await browser("press", "Escape"); await clickButton("复习卡组");
  await browser("screenshot", join(evidence, "decks.png")); await clickButton("开始到期复习");
  await browser("wait", "--fn", "document.querySelector('[data-browse-card]') !== null");
  const beforeMode = await inspect(), browsing = await evaluate("({card:document.querySelector('[data-browse-card]')?.getAttribute('data-browse-card'),grades:document.querySelectorAll('.ms-grade').length})");
  check("deck review first opens a read-only due-card browser before the explicit question-rating mode gate", () => { assert.equal(browsing.card, copy.id); assert.equal(browsing.grades, 0); assert.equal(beforeMode.dailyCount, refreshed.dailyCount); });
  await browser("screenshot", join(evidence, "deck-browse-due.png")); await browser("click", ".ms-review-browser-actions .primary");
  await browser("wait", "--fn", "document.querySelector('.ms-review-question-panel') !== null");
  const reviewDeckTitle = await evaluate("document.querySelector('.ms-review-identity h3')?.textContent");
  check("the deck picker starts its isolated due queue and shows the selected deck identity", () => { assert.equal(reviewDeckTitle, createdDeck.name); });
  await clickButton("显示答案"); await browser("wait", "--fn", "document.querySelector('.ms-review-answer-panel')?.offsetParent !== null");
  await browser("click", ".ms-grade.easy");
  await browser("wait", "--fn", `window.reviewFixture.inspect().logs.some(item=>!item.initialization&&item.deckId==='${createdDeck.id}')`);
  await clickButton("结束复习"); await clickButton("复习卡组");
  const future = await evaluate("({stats:document.querySelector('.ms-deck-summary')?.innerText,startDisabled:[...document.querySelectorAll('button')].find(item=>item.textContent==='开始到期复习')?.disabled})");
  const afterFuture = await inspect(), futureMembership = afterFuture.decks.find(item => item.id === createdDeck.id).cardIds;
  check("completed future-due cards remain deck members while the due start action becomes unavailable", () => { assert.equal(future.startDisabled, true); assert.ok(futureMembership.includes(copy.id)); });
  await clickButton("浏览全部卡片"); await browser("wait", "--fn", "document.querySelector('[data-browse-card]') !== null");
  const all = await evaluate("({card:document.querySelector('[data-browse-card]')?.getAttribute('data-browse-card'),dueOnly:document.querySelector('[aria-label=\"仅浏览到期卡片\"]')?.checked,grades:document.querySelectorAll('.ms-grade').length})");
  check("all-card browsing still includes a future-due member without opening grading controls", () => { assert.equal(all.card, copy.id); assert.equal(all.dueOnly, false); assert.equal(all.grades, 0); });
  await clickButton("☆ 收藏"); await browser("wait", "--fn", "document.querySelector('.ms-review-browser [aria-label=\"★ 已收藏\"]')?.getAttribute('aria-pressed')==='true'");
  const favoriteState = await inspect();
  check("the deck browser favorite action persists on the card without adding a review", () => { assert.equal(favoriteState.logs.length, afterFuture.logs.length); assert.equal(favoriteState.cards.find(item => item.id === copy.id).favorite, true); });
  const logsBeforeEdit = favoriteState.logs.length;
  await clickButton("编辑卡片"); await browser("wait", "--fn", "document.querySelector('[data-card-part=\"note\"]') !== null");
  await clickButton("保存");
  await browser("wait", "--fn", "document.querySelectorAll('.ms-modal-bg').length === 1 && document.querySelector('[data-browse-card]') !== null");
  const editedFromBrowser = await inspect();
  check("browser editing returns to the same card and does not create a review", () => { assert.equal(editedFromBrowser.logs.length, logsBeforeEdit); assert.equal(editedFromBrowser.cards.find(item => item.id === copy.id).back, "来源更新后的笔记"); });
  await browser("screenshot", join(evidence, "deck-browse-all.png")); await clickButton("关闭浏览");
  await browser("fill", '#cards input[placeholder="搜索卡片…"]', "复制正文"); await clickButton("加入复习");
  await browser("fill", '#cards input[placeholder="搜索卡片…"]', ""); await clickButton("复习卡组"); await clickButton("浏览全部卡片");
  await browser("wait", "--fn", "document.querySelector('[data-browse-card]') !== null");
  const firstId = await evaluate("document.querySelector('[data-browse-card]')?.getAttribute('data-browse-card')");
  await clickButton("下一张");
  await browser("wait", "--fn", `document.querySelector('[data-browse-card]')?.getAttribute('data-browse-card') !== '${firstId}'`);
  const nextId = await evaluate("document.querySelector('[data-browse-card]')?.getAttribute('data-browse-card')");
  await clickButton("上一张"); await browser("wait", "--fn", `document.querySelector('[data-browse-card]')?.getAttribute('data-browse-card') === '${firstId}'`);
  check("previous and next navigate persistent membership including both future and due cards", () => { assert.deepEqual([firstId, nextId].sort(), [copy.id, "copy-source"].sort()); });
  await clickButton("批注与工具"); await browser("click", ".ms-review-filters summary"); await checkInput('[aria-label="只看收藏卡片"]',true);
  await browser("fill", '[aria-label="复习筛选标签"]', "focus"); await browser("select", '[aria-label="复习筛选颜色"]', "#fc9959");
  await browser("select", '[aria-label="复习筛选评分"]', "4"); await browser("select", '[aria-label="复习排序"]', "text"); await clickButton("应用筛选排序");
  await browser("wait", "--fn", `document.querySelector('[data-browse-card]')?.getAttribute('data-browse-card') === '${copy.id}'`);
  const filteredIdentity = await evaluate("document.querySelector('.ms-review-identity')?.textContent");
  check("browser filters intersect favorite, tag, color and rating while retaining future members", () => { assert.ok(filteredIdentity.includes("1 / 1")); assert.ok(filteredIdentity.includes("全部卡片")); });
  await browser("screenshot", join(evidence, "deck-filters.png")); await clickButton("清除筛选");
  await browser("wait", "--fn", "document.querySelector('.ms-review-identity')?.textContent.includes('1 / 2')");
  const currentBrowserCard = await evaluate("document.querySelector('[data-browse-card]')?.getAttribute('data-browse-card')");
  if (currentBrowserCard !== "copy-source") await clickButton("下一张");
  const beforeQuestion = (await inspect()).cards.find(item => item.id === "copy-source");
  await clickButton("编辑卡片"); await clickButton("更多卡片操作"); await browser("click", ".ms-review-question-settings summary");
  await browser("select", '[aria-label="复习问题来源"]', "custom"); await browser("fill", '[aria-label="自定义复习问题"]', "只用于复习显示的独立问题？");
  await browser("screenshot", join(evidence, "question-editor.png")); await clickButton("保存");
  await browser("wait", "--fn", "document.querySelector('[data-review-browser-face=\"question\"]')?.textContent.includes('只用于复习显示的独立问题')");
  const configuredQuestion = (await inspect()).cards.find(item => item.id === "copy-source");
  check("manual review-question editing changes the projected face while leaving source title, excerpt and note intact", () => {
    assert.equal(configuredQuestion.reviewQuestion.text, "只用于复习显示的独立问题？"); assert.equal(configuredQuestion.title, beforeQuestion.title);
    assert.equal(configuredQuestion.front, beforeQuestion.front); assert.equal(configuredQuestion.back, beforeQuestion.back);
  });
  await clickButton("关闭浏览"); await clickButton("提取问题"); await clickButton("应用问题规则");
  const batchQuestions = await inspect();
  check("batch question extraction preserves an existing manual override and sets the other cards", () => {
    assert.equal(batchQuestions.cards.find(item => item.id === "copy-source").reviewQuestion.mode, "custom");
    assert.equal(batchQuestions.cards.find(item => item.id === "fixture-card").reviewQuestion.mode, "title");
  });
  }
  await browser("set", "viewport", "1512", "859"); await clickSelector("#native-visual-browse");
  await browser("wait", "--fn", "document.querySelector('.ms-native-review-browse [data-browse-card]')!==null");
  const browseLayout = await evaluate("(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return{paper:rect('.ms-native-review-paper'),content:rect('.ms-native-review-content'),font:getComputedStyle(document.querySelector('.ms-native-review-content')).fontSize,previousRect:rect('.ms-native-review-previous'),nextRect:rect('.ms-native-review-next'),previous:document.querySelector('.ms-native-review-previous').textContent,next:document.querySelector('.ms-native-review-next').textContent,previousDisabled:document.querySelector('.ms-native-review-previous').disabled,nextDisabled:document.querySelector('.ms-native-review-next').disabled,grades:document.querySelectorAll('.ms-grade').length}})()");
  check("native pre-AQ browsing has its separate 1188 by 679 white card, 20px text, previous/next footer and no scoring",()=>{
    assert.ok(Math.abs(browseLayout.paper.x-162)<2); assert.equal(browseLayout.paper.y,80); assert.ok(Math.abs(browseLayout.paper.width-1188)<3); assert.equal(browseLayout.paper.height,679);
    assert.ok(Math.abs(browseLayout.content.x-200)<2); assert.equal(browseLayout.font,"20px"); assert.equal(browseLayout.previous,"上一张"); assert.equal(browseLayout.next,"下一张"); assert.equal(browseLayout.previousDisabled,true); assert.equal(browseLayout.nextDisabled,true); assert.equal(browseLayout.grades,0);
    assert.ok(Math.abs(browseLayout.previousRect.x+browseLayout.previousRect.width/2-564)<3); assert.ok(Math.abs(browseLayout.nextRect.x+browseLayout.nextRect.width/2-948)<3);
  });
  const browseButtons = await evaluate("[...document.querySelectorAll('.ms-native-review-footer button,.ms-native-review-paper-tools button')].map(button=>{const css=getComputedStyle(button);return{label:button.getAttribute('aria-label'),background:css.backgroundColor,color:css.color,shadow:css.boxShadow}})");
  check("Obsidian host button styles leave browse navigation and icons transparent with readable labels",()=>{
    assert.equal(browseButtons.length,7);
    for(const button of browseButtons){assert.equal(button.background,"rgba(0, 0, 0, 0)",button.label);assert.equal(button.shadow,"none",button.label);}
    assert.deepEqual(browseButtons.filter(button=>["上一张","下一张","关闭浏览"].includes(button.label)).map(button=>button.color),Array(3).fill("rgb(222, 223, 225)"));
    assert.equal(browseButtons.find(button=>button.label==="编辑卡片").color,"rgb(116, 123, 133)");
  });
  await browser("screenshot",join(evidence,"browse-native-reference.png")); await clickButton("关闭浏览"); await browser("set","viewport","1512","949");
  await clickSelector("#native-visual-score");
  await browser("wait", "--fn", "document.querySelector('.ms-native-review-paper')!==null"); await clickButton("显示答案");
  await browser("wait", "--fn", "document.querySelector('.ms-grade.easy')?.offsetParent!==null");
  const stageLayout = await evaluate("(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {paper:rect('.ms-native-review-paper'),title:document.querySelector('.ms-review-card-title')?.textContent,titleRect:rect('.ms-review-card-title'),grades:[...document.querySelectorAll('.ms-grade')].map(b=>({label:b.textContent,color:getComputedStyle(b).backgroundColor,...rect('.ms-grade.'+[...b.classList].find(c=>c!=='ms-grade'))})),text:document.querySelector('.ms-native-review-content').textContent,labels:document.querySelectorAll('.ms-native-review-content .ms-review-section-label').length}})()");
  check("native reference scoring uses the measured full white card, top counter and four equal bottom controls", () => {
    assert.ok(Math.abs(stageLayout.paper.x-162)<2); assert.ok(Math.abs(stageLayout.paper.y-80.5)<2); assert.ok(Math.abs(stageLayout.paper.width-1188)<3); assert.ok(Math.abs(stageLayout.paper.height-768.5)<3);
    assert.ok(stageLayout.grades.every(grade=>Math.abs(grade.y-874)<2 && Math.abs(grade.height-44)<1));
    assert.ok(Math.max(...stageLayout.grades.map(g=>g.width))-Math.min(...stageLayout.grades.map(g=>g.width))<1);
    assert.deepEqual(stageLayout.grades.map(g=>g.color),["rgb(22, 146, 254)","rgb(244, 105, 108)","rgb(79, 201, 135)","rgb(129, 129, 129)"]);
    assert.equal(stageLayout.title,"验收卡片标题"); assert.ok(stageLayout.titleRect.width>0 && stageLayout.titleRect.height>0);
    assert.deepEqual(stageLayout.grades.map(g=>g.label.split(" ")[0]),["重复","难","良好","易"]);
    assert.ok(stageLayout.text.includes("Unique sentence U2: beta marker.")); assert.equal(stageLayout.labels,0);
  });
  await browser("screenshot",join(evidence,"review-native-reference.png")); await clickButton("结束复习");
  await evaluate("window.reviewFixture.setHandwritingWidths(2,6,10)");await clickSelector("#native-visual-editor");
  await evaluate("(()=>{document.querySelector('[data-card-part=excerpt]').focus();return true})()");
  const editorLayout = await evaluate("(()=>{const r=document.querySelector('.ms-native-card-editor').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,advancedHidden:document.querySelector('.ms-native-card-advanced').hidden,formatBottom:document.querySelector('.ms-native-card-formatbar').getBoundingClientRect().bottom}})()");
  check("native Note Card editor retains the 520 by 560 floating template and full-width bottom format bar",()=>{
    assert.ok(Math.abs(editorLayout.x-336)<2); assert.ok(Math.abs(editorLayout.y-180)<2); assert.equal(editorLayout.width,520); assert.equal(editorLayout.height,560); assert.equal(editorLayout.advancedHidden,true); assert.equal(editorLayout.formatBottom,949);
  });
  await browser("screenshot",join(evidence,"card-editor-native-reference.png"));
  await evaluate("(()=>{const input=document.querySelector('[data-card-part=excerpt]');input.focus();input.setSelectionRange(0,6);return true})()");
  await clickButton("加粗"); await browser("select",'[aria-label="卡片字体"]',"Georgia"); await browser("select",'[aria-label="卡片字号"]',"18"); await clickButton("保存");
  const formatted = (await inspect()).cards.find(card=>card.id==="native-style-card");
  check("native formatting controls update the selected excerpt and persist card typography through the existing save path",()=>{assert.ok(formatted.front.startsWith("**Unique** sentence")); assert.deepEqual(formatted.typography,{fontFamily:"Georgia",fontSize:18});assert.equal(formatted.back,"");});
  await clickSelector("#native-visual-editor"); await evaluate("(()=>{document.querySelector('[data-card-part=excerpt]').focus();return true})()"); await browser("click",".ms-native-card-formatbar button:first-child");
  await browser("wait","--fn","document.querySelector('.ms-native-card-rich-preview strong')!==null");
  const renderedPreview = await evaluate("document.querySelector('.ms-native-card-rich-preview strong')?.textContent");
  check("Markdown preview renders the saved emphasis without rewriting the excerpt",()=>{assert.equal(renderedPreview,"Unique");});
  await browser("click",".ms-native-card-formatbar button:first-child");await clickButton("手写批注");await draw();
  const inkThickness=await evaluate("(()=>{const c=document.querySelector('.ms-modal canvas'),x=c.getContext('2d'),data=x.getImageData(0,0,c.width,c.height).data;let max=0;for(let col=0;col<c.width;col+=8){let run=0,best=0;for(let row=0;row<c.height;row++){if(data[(row*c.width+col)*4+3]){run++;best=Math.max(best,run);}else run=0;}max=Math.max(max,best);}return max;})()");
  await clickButton("插入手写批注"); await clickButton("保存");
  const handwritten=(await inspect()).cards.find(card=>card.id==="native-style-card");
  check("the native pen control honors the persisted preset width and saves the drawn image as an ink comment",()=>{assert.ok(inkThickness>=8,`card canvas stroke thickness was ${inkThickness}`);assert.ok(handwritten.commentMedia.some(item=>item.kind==="ink"&&item.image.startsWith("data:image/png;base64,")));assert.equal(handwritten.front,formatted.front);});
  check("A15 card ink persists vector strokes with identity and style",()=>{const ink=handwritten.commentMedia.find(item=>item.kind==="ink");assert.ok(ink.strokes?.length,"card ink has no vector strokes");const stroke=ink.strokes[0];assert.ok(stroke.id&&stroke.points.length&&stroke.color&&Number.isFinite(stroke.width)&&Number.isFinite(stroke.opacity));});
} catch (caught) { error = caught; console.error(caught.stack || caught); process.exitCode = 1;
  const diagnostics = await Promise.allSettled([browser("get", "url"), browser("console"), browser("errors"), evaluate("({url:location.href, width:innerWidth,height:innerHeight,fixture:!!window.reviewFixture,body:document.body?.textContent?.slice(0,4000)})")]);
  await writeFile(join(evidence, "failure-diagnostics.json"), JSON.stringify(diagnostics.map(result => result.status === "fulfilled" ? result.value : String(result.reason)),null,2));
  await writeFile(join(evidence, "failure-snapshot.txt"), (await browser("snapshot", "-i").catch(() => ({stdout:"snapshot unavailable"}))).stdout);
  await browser("screenshot", join(evidence, "failure.png")).catch(() => {});
}
finally {
  await writeFile(join(evidence, "results.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), environment: "isolated Chromium; in-memory Store; synthetic Obsidian/Markdown renderer", checks, error: error ? String(error.stack || error) : undefined }, null, 2));
  console.log(`${checks.length} review UI checks passed. Evidence: ${evidence}`);
  await browser("close").catch(() => {}); await new Promise(done => server.close(done));
}
