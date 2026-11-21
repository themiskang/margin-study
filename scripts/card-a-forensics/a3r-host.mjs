// Card A · A3 re-do host: isolated vault + profile + home, install one build's four files.
// usage: node a3r-host.mjs <outRoot> <buildDir> [vaultCopyFrom]
import fs from "node:fs";
import path from "node:path";
import { BUNDLE, jsonWrite, shaFile, sha256 } from "./lib.mjs";

const [outRootArg, buildDirArg, vaultCopyFromArg] = process.argv.slice(2);
if (!outRootArg || !buildDirArg) throw new Error("usage: a3r-host.mjs <outRoot> <buildDir> [vaultCopyFrom]");
const root = path.resolve(outRootArg);
const buildDir = path.resolve(buildDirArg);
const vault = path.join(root, "vault");
const profile = path.join(root, "profile");
const home = path.join(root, "home");
const pluginRel = ".obsidian/plugins/margin-study";
const pluginDir = path.join(vault, pluginRel);
const mainFile = path.join(pluginDir, "data.json");

fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(home, { recursive: true });

let copiedFrom = null;
if (vaultCopyFromArg) {
  const from = path.resolve(vaultCopyFromArg);
  if (!fs.existsSync(from)) throw new Error("vault copy source missing: " + from);
  copiedFrom = { path: from, dataJsonSha256: shaFile(path.join(from, pluginRel, "data.json")),
    treeSize: (() => { let n = 0; const walk = rel => { for (const e of fs.readdirSync(path.join(from, rel), { withFileTypes: true })) { const child = rel ? `${rel}/${e.name}` : e.name; e.isDirectory() ? walk(child) : n++; } }; walk(""); return n; })() };
  fs.cpSync(from, vault, { recursive: true, preserveTimestamps: true });
}
fs.mkdirSync(pluginDir, { recursive: true });

const installed = {}, source = {};
for (const name of BUNDLE) {
  const from = path.join(buildDir, name);
  if (!fs.existsSync(from)) throw new Error("build artifact missing: " + from);
  const bytes = fs.readFileSync(from);
  source[name] = { path: from, sha256: sha256(bytes), size: bytes.length };
  fs.writeFileSync(path.join(pluginDir, name), bytes);
  installed[name] = { sha256: shaFile(path.join(pluginDir, name)), size: fs.statSync(path.join(pluginDir, name)).size };
}

// Obsidian profile: this vault is the only one, opened on start; plugin pre-enabled.
fs.writeFileSync(path.join(profile, "obsidian.json"),
  JSON.stringify({ vaults: { ca00000000a3r0001: { path: fs.realpathSync(vault), ts: Date.now(), open: true } } }, null, 2) + "\n");
fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
fs.writeFileSync(path.join(vault, ".obsidian/community-plugins.json"), JSON.stringify(["margin-study"]) + "\n");
if (!fs.existsSync(path.join(vault, ".obsidian/app.json"))) fs.writeFileSync(path.join(vault, ".obsidian/app.json"), JSON.stringify({ promptDelete: false }));
if (!fs.existsSync(path.join(vault, ".obsidian/core-plugins.json")))
  fs.writeFileSync(path.join(vault, ".obsidian/core-plugins.json"), JSON.stringify(["file-explorer", "global-search", "switcher", "page-preview", "command-palette", "bookmarks", "outline", "word-count", "file-recovery"]));

const setup = {
  root, vault, profile, home, pluginRel, pluginDir, mainFile,
  buildDir,
  buildSource: source,
  installed,
  installedEqualsSource: BUNDLE.every(name => source[name].sha256 === installed[name].sha256),
  copiedFrom,
  port: 9333,
  launchCommand: `env CFFIXED_USER_HOME=${home} /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir=${profile} --remote-debugging-port=9333`,
};
jsonWrite(path.join(root, "setup.json"), setup);
console.log(JSON.stringify(setup));