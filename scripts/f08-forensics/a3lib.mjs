// Shared A3 host bring-up: launch isolated vault, trust, enable plugin, close settings.
import { CDP, launchObsidian, waitWorkspace, sleep, now } from "./lib.mjs";
import fs from "node:fs";
import path from "node:path";

export const stepsFile = () => process.env.F08_STEPS_LOG;

export async function connect(root, stage, { trust = true, enable = true } = {}) {
  const removed = fs.readdirSync(path.join(root, "profile")).filter(n => /obsidian-.*\.asar/.test(n));
  for (const n of removed) fs.rmSync(path.join(root, "profile", n), { force: true });
  const run = launchObsidian({ root, stage });
  const cdp = await CDP.connect(90000);
  await waitWorkspace(cdp);
  const renderer = await cdp.eval("process.pid");
  const title = await cdp.eval("document.title");
  if (trust) {
    let prompt = null;
    for (let i = 0; i < 80 && !prompt; i++) {
      prompt = await cdp.eval(`(() => { const m = document.querySelector(".modal-container");
        if (!m || !m.innerText.includes("信任")) return null; const b = [...m.querySelectorAll("button")].find(x => x.innerText.includes("信任仓库作者"));
        if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), label: b.innerText.trim() }; })()`);
      if (!prompt) await sleep(250);
    }
    if (prompt) { await cdp.click(prompt.x, prompt.y); await sleep(1500); }
  }
  let toggle = null;
  if (enable) {
    for (let i = 0; i < 80 && !toggle; i++) {
      toggle = await cdp.eval(`(() => { const row = [...document.querySelectorAll(".setting-item")].find(r => r.innerText.includes("MarginStudy"));
        if (!row) return null; const t = row.querySelector(".checkbox-container"); if (!t) return null;
        const r = t.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), on: t.classList.contains("is-enabled") }; })()`);
      if (!toggle) await sleep(250);
    }
    if (!toggle) throw new Error("plugin toggle not found");
    await cdp.click(toggle.x, toggle.y);
    await sleep(2500);
    for (let i = 0; i < 40; i++) { if (await cdp.eval(`!!app.plugins.plugins["margin-study"]`)) break; await sleep(250); }
  }
  await cdp.key("Escape", 0, "Escape");
  await sleep(1200);
  return { cdp, run, renderer, title, droppedUpdateCache: removed, toggle };
}

export async function runCommand(cdp, name) {
  await cdp.key("p", 4, "KeyP", "p");
  await sleep(800);
  await cdp.type(name);
  await sleep(800);
  const hit = await cdp.eval(`(() => { const e = [...document.querySelectorAll(".prompt-results .suggestion-item")].find(x => x.innerText.trim().includes(${JSON.stringify(name)}));
    if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), label: e.innerText.trim() }; })()`);
  if (!hit) throw new Error("palette item missing: " + name);
  await cdp.key("Enter", 0, "Enter");
  await sleep(1500);
  return hit;
}