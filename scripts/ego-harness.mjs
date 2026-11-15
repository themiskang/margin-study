/**
 * [INPUT]: 浏览器后端环境变量、验收脚本的会话和命令参数，以及 agent-browser 的 CDP 地址。
 * [OUTPUT]: runBrowser 和 runBrowserSync，返回兼容验收脚本的标准输出。
 * [POS]: 验收脚本与 agent-browser 或 ego TaskSpace 之间的命令适配层。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { execFile, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const executable = resolve(homedir(), ".pi/agent/bin/ego-browser");
const exec = promisify(execFile);
const initializedSessions = new Set();

function program(session, args, outputPath, initialize) {
  const [command, ...rest] = args.map(String);
  const input = JSON.stringify({ session, command, args: rest, outputPath, initialize });
  return `
{
const {session,command,args,outputPath,initialize}=${input};
const task=await taskSpace(session);
const page=task.page("p1");
let output="";
if(initialize) await page.cdp("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:2,mobile:false});
async function evaluate(expression){
  const result=await page.cdp("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
switch(command){
case "open": await page.goto(args[0]); break;
case "eval": output=JSON.stringify(await evaluate(args[0])) ?? "null"; break;
case "wait":
  if(args[0]==="--fn"){
    const deadline=Date.now()+30000;
    while(!(await evaluate(args[1]))){
      if(Date.now()>=deadline) throw new Error("Timed out waiting for: "+args[1]);
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  else await page.waitForTimeout(Number(args[0]));
  break;
case "screenshot": await page.screenshot({path:args[0]}); break;
case "click": await page.click(args[0]); break;
case "dblclick": await page.dblclick(args[0]); break;
case "fill": await page.fill(args[0],args[1]); break;
case "press": await page.keyboard.press(args[0]); break;
case "select": await page.selectOption(args[0],{value:args[1]}); break;
case "upload": await page.setInputFiles(args[0],args.slice(1)); break;
case "drag": await page.dragAndDrop(args[0],args[1]); break;
case "snapshot": output=await page.snapshot(); break;
case "get":
  if(args[0]!=="url") throw new Error("Unsupported get command: "+args[0]);
  output=await page.url();
  break;
case "scrollintoview": await page.evaluate(selector=>{const element=document.querySelector(selector);if(!element)throw new Error("Missing element: "+selector);element.scrollIntoView({block:"center",inline:"center"});},args[0]); break;
case "find":
  if(args[0]==="role"&&args[1]==="button"&&args[2]==="click"&&args[3]==="--name"&&args[5]==="--exact")
    await page.click("loc=role:button[name="+JSON.stringify(args[4])+"]");
  else if(args[0]==="label"&&args[2]==="fill")
    await page.fill("loc=css:[aria-label="+JSON.stringify(args[1])+"]",args[3]);
  else throw new Error("Unsupported find command: "+JSON.stringify(args));
  break;
case "mouse":
  if(args[0]==="move") await page.mouse.move(Number(args[1]),Number(args[2]),args[3]==="--steps"?{steps:Number(args[4])}:{});
  else if(args[0]==="click") await page.mouse.click(Number(args[1]),Number(args[2]));
  else if(args[0]==="down") await page.mouse.down();
  else if(args[0]==="up") await page.mouse.up();
  else if(args[0]==="wheel") await page.mouse.wheel(Number(args[1]),Number(args[2]));
  else throw new Error("Unsupported mouse command: "+args[0]);
  break;
case "set":
  if(args[0]!=="viewport") throw new Error("Unsupported set command: "+args[0]);
  await page.cdp("Emulation.setDeviceMetricsOverride",{width:Number(args[1]),height:Number(args[2]),deviceScaleFactor:2,mobile:false});
  break;
case "cdp": output=JSON.stringify(await page.cdp(args[0],JSON.parse(args[1]))); break;
case "close": await task.finish({keep:[]}); break;
default: throw new Error("Unsupported browser command: "+command);
}
await (await import("node:fs/promises")).writeFile(outputPath,output);
if(command==="close") process.exit();
}`;
}

const runtimeSession = session => `marginstudy-${createHash("sha256").update(session).digest("hex").slice(0, 32)}`;
const outputFile = () => join(tmpdir(), `marginstudy-ego-${randomUUID()}.txt`);

async function runEgo(session, ...args) {
  const outputPath = outputFile();
  try {
    await exec(executable, ["nodejs", "--session", runtimeSession(session), "--timeout-ms", "120000", "-e", program(session, args, outputPath, !initializedSessions.has(session))], { maxBuffer: 8 * 1024 * 1024, timeout: 125000 });
    if (args[0] === "close") initializedSessions.delete(session);
    else initializedSessions.add(session);
    return { stdout: await readFile(outputPath, "utf8"), stderr: "" };
  } finally {
    await unlink(outputPath).catch(() => {});
  }
}

function runEgoSync(session, ...args) {
  const outputPath = outputFile();
  try {
    const result = spawnSync(executable, ["nodejs", "--session", runtimeSession(session), "--timeout-ms", "120000", "-e", program(session, args, outputPath, !initializedSessions.has(session))], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 125000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `ego-browser exited with ${result.status}`);
    if (args[0] === "close") initializedSessions.delete(session);
    else initializedSessions.add(session);
    return readFileSync(outputPath, "utf8");
  } finally {
    try { unlinkSync(outputPath); } catch {}
  }
}

export async function runBrowser(session, ...args) {
  if (process.env.MARGINSTUDY_BROWSER === "ego") return runEgo(session, ...args);
  if (args[0] === "cdp" && args[1] === "Input.dispatchMouseEvent") {
    const browserUrl = (await exec("agent-browser", ["--session", session, "get", "cdp-url"])).stdout.trim();
    const pageUrl = (await exec("agent-browser", ["--session", session, "get", "url"])).stdout.trim();
    const address = new URL(browserUrl);
    const targets = await (await fetch(`http://${address.host}/json/list`)).json();
    const target = targets.find(item => item.type === "page" && item.url === pageUrl);
    if (!target?.webSocketDebuggerUrl) throw new Error(`No CDP page target for ${pageUrl}`);
    const result = await new Promise((resolve, reject) => {
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      const timer = setTimeout(() => { socket.close(); reject(new Error("CDP command timed out")); }, 30000);
      socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method: args[1], params: JSON.parse(args[2]) })));
      socket.addEventListener("message", event => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        clearTimeout(timer);
        socket.close();
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP connection failed")); });
    });
    return { stdout: JSON.stringify(result), stderr: "" };
  }
  return exec("agent-browser", ["--session", session, ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 125000 });
}

export function runBrowserSync(session, ...args) {
  if (process.env.MARGINSTUDY_BROWSER === "ego") return runEgoSync(session, ...args);
  const result = spawnSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 125000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `agent-browser exited with ${result.status}`);
  return result.stdout;
}
