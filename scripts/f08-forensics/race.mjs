// External writer: races the plugin's desktop main replacement for F08 A1/A3 scenes.
// Watches the plugin dir for a replacement stage dir, then rewrites data.json atomically
// from a prepared external.json as soon as expected.sha256 appears (after the plugin's
// own compare step), repeatedly for `durationMs` to span the atomic swap.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const [root, mode = "burst", durationArg = "700"] = process.argv.slice(2);
const setup = JSON.parse(fs.readFileSync(path.join(root, "setup.json"), "utf8"));
const main = setup.main;
const dir = path.dirname(main);
const external = path.join(root, "external.json");
const stamp = path.join(root, "external.tmp");
const log = path.join(root, "race.log");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const note = row => fs.appendFileSync(log, JSON.stringify({ at: Date.now(), iso: new Date().toISOString(), ...row }) + "\n");
const write = () => {
  fs.copyFileSync(external, stamp);
  const started = Date.now();
  fs.renameSync(stamp, main);
  note({ event: "external-write", pid: process.pid, mainAfter: sha(fs.readFileSync(main)), tookMs: Date.now() - started });
};

let stageDir = null;
const poll = () => {
  const entries = fs.readdirSync(dir).filter(name => /^data\.json\.ms-replace-[0-9a-f]+-\d+-[0-9a-f-]+$/.test(name));
  for (const entry of entries) {
    const marker = path.join(dir, entry, "expected.sha256");
    if (fs.existsSync(marker)) return path.join(dir, entry);
  }
  return null;
};

note({ event: "armed", pid: process.pid, main, external, mainBefore: sha(fs.readFileSync(main)) });
const deadline = Date.now() + 120000;
while (!stageDir && Date.now() < deadline) {
  try { stageDir = poll(); } catch {}
}
if (!stageDir) { note({ event: "no-stage-timeout" }); process.exit(3); }
note({ event: "stage-seen", stageDir, expected: fs.readFileSync(path.join(stageDir, "expected.sha256"), "utf8"), mainAtSeen: sha(fs.readFileSync(main)) });

if (mode === "once") { write(); }
else {
  const span = Number(durationArg);
  const end = Date.now() + span;
  let count = 0;
  while (Date.now() < end) { try { write(); count++; } catch (error) { note({ event: "write-error", error: String(error) }); } await new Promise(r => setTimeout(r, 8)); }
  note({ event: "burst-done", count });
}
await new Promise(r => setTimeout(r, 1200));
note({ event: "final", mainAfter: sha(fs.readFileSync(main)), displaced: fs.existsSync(path.join(stageDir, "displaced.json")) ? sha(fs.readFileSync(path.join(stageDir, "displaced.json"))) : null, candidate: fs.existsSync(path.join(stageDir, "candidate.json")) ? sha(fs.readFileSync(path.join(stageDir, "candidate.json"))) : null });