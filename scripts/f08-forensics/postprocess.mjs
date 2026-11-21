// Fill in .resolved originals + logs for a completed A1 case dir (post-final-exit read of the vault).
import fs from "node:fs";
import path from "node:path";
import { shaFile, jsonWrite, now } from "./lib.mjs";

const out = process.env.F08_OUT;
const setup = JSON.parse(fs.readFileSync(path.join(out, "setup.json"), "utf8"));
const root = path.dirname(setup.vault);
const pluginDir = path.join(setup.vault, ".obsidian/plugins/margin-study");
const resolvedDirs = fs.readdirSync(pluginDir).filter(n => /^data\.json\.ms-replace-.*\.resolved$/.test(n));
const resolvedFiles = {};
fs.mkdirSync(path.join(out, "resolved-backup"), { recursive: true });
for (const dir of resolvedDirs) {
  resolvedFiles[dir] = {};
  for (const f of fs.readdirSync(path.join(pluginDir, dir))) {
    resolvedFiles[dir][f] = shaFile(path.join(pluginDir, dir, f));
    fs.copyFileSync(path.join(pluginDir, dir, f), path.join(out, "resolved-backup", `${path.basename(out)}.${f}`));
  }
}
for (const [src, name] of [[path.join(root, "race.log"), "external-writes.log"], [path.join(root, "initial.obsidian.log"), "obsidian-initial.log"], [path.join(root, "restart.obsidian.log"), "obsidian-restart.log"]]) {
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, name));
}
const resolved = JSON.parse(fs.readFileSync(path.join(out, "after-resolution.json"), "utf8"));
resolved.resolvedDirs = resolvedFiles;
resolved.resolvedCapturedFrom = { channel: "post-final-exit read of the isolated vault", at: now(), vault: setup.vault };
jsonWrite(path.join(out, "after-resolution.json"), resolved);
const hashes = JSON.parse(fs.readFileSync(path.join(out, "hashes.json"), "utf8"));
const first = resolvedFiles[resolvedDirs[0]] ?? {};
hashes.hashes.candidate = first["candidate.json"] ?? null;
hashes.hashes.displaced = first["displaced.json"] ?? null;
hashes.hashes.expected = first["expected.sha256"] ?? null;
hashes.resolvedFiles = resolvedFiles;
jsonWrite(path.join(out, "hashes.json"), hashes);
const expectedSha = fs.readFileSync(path.join(pluginDir, resolvedDirs[0], "expected.sha256"), "utf8").trim();
console.log(JSON.stringify({ resolvedDirs, resolvedFiles, expectedSha, matches: {
  candidateIsLocal: first["candidate.json"], displacedIsExternal: first["displaced.json"],
  expectedIsOriginal: expectedSha }, diskMain: resolved.diskMain }, null, 2));