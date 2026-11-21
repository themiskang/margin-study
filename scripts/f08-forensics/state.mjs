// Read-only observation snapshot of the live store + notices. Writes JSON to argv[2].
import fs from "node:fs";
import path from "node:path";
import { CDP, jsonWrite, shaFile, now } from "./lib.mjs";

const [outFile, note] = process.argv.slice(2);
const cdp = await CDP.connect();
const obs = await cdp.eval(`(() => {
  const p = app.plugins.plugins["margin-study"], s = p && p.store;
  const notices = [...document.querySelectorAll(".notice")].map(n => n.textContent);
  const tail = str => str && str.slice(str.length - 27);
  const stage = s && s.conflictPath ? s.conflictPath.split("/").pop() : null;
  return {
    rendererPid: process.pid, windowTitle: document.title, notices,
    plugin: !!p, pluginEnabled: !!(app.plugins.enabledPlugins && app.plugins.enabledPlugins.has && app.plugins.enabledPlugins.has("margin-study")),
    store: s ? {
      hasDesktopMainConflict: s.hasDesktopMainConflict(), conflictPath: s.conflictPath, lastSaveError: s.lastSaveError,
      mainDirty: s.mainDirty, saveTimer: s.saveTimer, saveIdle: !!s.saveIdle, loadBlocked: s.loadBlocked,
      revision: s.getRevision ? s.getRevision() : null,
      pendingConflict: s.pendingConflict ? { localCardFront: s.pendingConflict.local?.cards?.[0]?.front, remoteCardFront: s.pendingConflict.remote?.cards?.[0]?.front } : null,
      counts: { cards: s.cards.length, nodes: s.nodes.length, edges: s.edges.length, studySets: s.studySets.length,
        canvases: s.canvases.length, reviewLogs: (s.reviewLogs ?? []).length, reviewPending: Object.keys(s.reviewPending ?? {}).length,
        documents: s.documents.length, localEvents: (s.localEvents ?? []).length },
      schemaVersion: (s.data ? s.data(false) : {}).schemaVersion,
      cardFronts: s.cards.map(c => c.front),
      stageDir: stage,
    } : null,
  };
})()`);
const vault = path.join(JSON.parse(fs.readFileSync(path.join(process.env.F08_ROOT, "setup.json"), "utf8")).vault);
const pluginDir = path.join(vault, ".obsidian/plugins/margin-study");
const disk = { dataJson: shaFile(path.join(pluginDir, "data.json")) };
for (const name of fs.readdirSync(pluginDir).filter(n => n.startsWith("data.json.ms-replace-") && !n.endsWith(".resolved") && !n.endsWith(".tmp"))) {
  const stage = {};
  for (const f of fs.readdirSync(path.join(pluginDir, name))) {
    const p = path.join(pluginDir, name, f);
    stage[f] = fs.statSync(p).isFile() ? shaFile(p) : "dir";
  }
  disk[name] = stage;
}
const snapshot = { capturedAt: now(), note, process: obs, disk, vaultFiles: fs.readdirSync(vault).sort() };
jsonWrite(outFile, snapshot);
console.log(JSON.stringify({ at: snapshot.capturedAt, note, store: obs.store, disk, notices: obs.notices }, null, 2).slice(0, 2600));
cdp.close();