// Card A stage 2: create an isolated Obsidian host (vault + profile + home) and install the
// four verified build artifacts. Prints the host root as JSON on stdout.
// usage: node bootstrap.mjs <vaultMode: fresh|legacy> <outRoot>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLE, jsonWrite, shaFile } from "./lib.mjs";

const REPO = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const MANIFEST = path.join(REPO, "evidence/card-A/exec/build-manifest.json");
const BUILD = path.join(REPO, "evidence/card-A/exec/build");
const [mode = "fresh", outRoot] = process.argv.slice(2);
if (!outRoot) throw new Error("usage: bootstrap.mjs <fresh|legacy> <outRoot>");
if (!["fresh", "legacy"].includes(mode)) throw new Error("mode must be fresh|legacy");

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const root = path.resolve(outRoot);
const vault = path.join(root, "vault");
const profile = path.join(root, "profile");
const home = path.join(root, "home");
const pluginRel = ".obsidian/plugins/margin-study";
const pluginDir = path.join(vault, pluginRel);
const mainFile = path.join(pluginDir, "data.json");

fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(pluginDir, { recursive: true });
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(home, { recursive: true });

const installed = {};
const expected = {};
const sourceCopy = {};
for (const name of BUNDLE) {
  const fromBuild = path.join(BUILD, name);
  const fromRepo = path.join(REPO, name);
  const bytes = fs.readFileSync(fromBuild);
  installed[name] = shaFile(fromBuild);
  expected[name] = manifest.artifacts[name];
  sourceCopy[name] = { build: shaFile(fromBuild), repoRoot: fs.existsSync(fromRepo) ? shaFile(fromRepo) : null };
  fs.writeFileSync(path.join(pluginDir, name), bytes);
}
const installedAfter = Object.fromEntries(BUNDLE.map(name => [name, shaFile(path.join(pluginDir, name))]));

// Obsidian profile: register the isolated vault as the only vault, plugin pre-enabled.
fs.writeFileSync(path.join(profile, "obsidian.json"),
  JSON.stringify({ vaults: { ca00000000000001: { path: fs.realpathSync(vault), ts: Date.now(), open: true } } }, null, 2) + "\n");
fs.writeFileSync(path.join(vault, ".obsidian", "community-plugins.json"), JSON.stringify(["margin-study"]) + "\n");
fs.writeFileSync(path.join(vault, ".obsidian", "app.json"), JSON.stringify({ promptDelete: false }) + "\n");
fs.writeFileSync(path.join(vault, ".obsidian", "core-plugins.json"), JSON.stringify(["file-explorer", "global-search", "switcher", "graph", "backlink", "outgoing-link", "tag-pane", "page-preview", "daily-notes", "templates", "note-composer", "command-palette", "editor-status", "bookmarks", "outline", "word-count", "file-recovery"]) + "\n");

const setup = {
  mode, root, vault, profile, home, pluginRel, pluginDir, mainFile,
  manifestCommit: manifest.commit,
  manifestArtifacts: expected,
  buildDirectory: BUILD,
  installed, installedAfterInstall: installedAfter,
  installedEqualsManifest: BUNDLE.every(name => installed[name] === expected[name]),
  sourceCopy,
  port: 9333,
  launchCommand: `CFFIXED_USER_HOME=${home} /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir=${profile} --remote-debugging-port=9333`,
};
jsonWrite(path.join(root, "setup.json"), setup);
console.log(JSON.stringify(setup));
