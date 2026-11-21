// Explore/observe the live renderer: dump clickable UI, notices, plugin state.
import { CDP, waitWorkspace, jsonWrite, shaFile, sleep } from "./lib.mjs";
import fs from "node:fs";

const out = process.argv[2];
const cdp = await CDP.connect();
await waitWorkspace(cdp);
const info = await cdp.eval(`(() => {
  const rows = [...document.querySelectorAll('button, .checkbox-container, .vertical-tab-nav-item, .side-dock-ribbon-action, .clickable-icon, .menu-item, .modal')]
    .filter(el => el.offsetParent !== null || el.getClientRects().length)
    .map(el => { const r = el.getBoundingClientRect(); return { tag: el.tagName, cls: el.className && String(el.className).slice(0,80), label: (el.getAttribute('aria-label') || el.innerText || el.textContent || '').trim().slice(0,60), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter(r => r.w > 0 && r.h > 0);
  return {
    rendererPid: process.pid,
    appVersion: app.vault.getName ? app.vault.getName() : null,
    windowTitle: document.title,
    vaultBase: app.vault.adapter.getBasePath ? app.vault.adapter.getBasePath() : null,
    plugins: Object.keys(app.plugins.plugins),
    enabledPlugins: [...(app.plugins.enabledPlugins ?? [])],
    communityPluginsConfig: (() => { try { return JSON.parse(document.querySelector('x')?.x ?? 'null'); } catch { return null; } })(),
    restricted: app.plugins.isEnabled ? null : null,
    safeMode: (() => { try { return app.plugins.isEnabled('margin-study'); } catch (e) { return 'err:' + String(e); } })(),
    modalOpen: !!document.querySelector('.modal-container'),
    notices: [...document.querySelectorAll('.notice')].map(n => n.textContent),
    viewTypes: app.workspace.getLeavesOfType ? app.workspace.getLeavesOfType('').length : null,
    leaves: app.workspace.getLeavesOfType ? [] : [],
    rects: rows,
  };
})()`);
if (out) jsonWrite(out, info);
console.log(JSON.stringify({ ...info, rects: undefined }, null, 2));
console.log("--- clickables");
for (const r of info.rects) console.log(`${r.x},${r.y}\t${r.tag}\t${r.cls}\t${r.label}`);
cdp.close();