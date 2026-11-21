// Launch the isolated host for a scenario, record env.json (vault, profile, version, PIDs, port, 4-file hashes).
import fs from "node:fs";
import path from "node:path";
import { CDP, launchObsidian, waitWorkspace, obsidianVersion, shaFile, jsonWrite, portFree, sleep } from "./lib.mjs";

const [root, scenario, stage, envFile, hashesFile] = process.argv.slice(2);
const setup = JSON.parse(fs.readFileSync(path.join(root, "setup.json"), "utf8"));
if (!(await portFree())) throw new Error("port 9333 busy before launch");
const before = {};
for (const name of ["main.js", "manifest.json", "styles.css", "pdf.worker.js"]) before[name] = shaFile(path.join(setup.vault, ".obsidian/plugins/margin-study", name));
const { pid, log } = launchObsidian({ root, stage });
const startedAt = new Date().toISOString();
const cdp = await CDP.connect(90000);
await waitWorkspace(cdp);
const renderer = await cdp.eval("process.pid");
const version = await cdp.eval("(document.title.match(/Obsidian ([0-9.]+)/) || [])[1] || null");
const env = {
  scenario, root, vault: setup.vault, profile: setup.profile, home: setup.home,
  obsidian: { version, bundleVersion: await obsidianVersion(), appPath: "/Applications/Obsidian.app", windowTitle: await cdp.eval("document.title") },
  pid: { host: pid, renderer }, port: 9333, stage,
  startedAt, launchedWith: `CFFIXED_USER_HOME=${setup.home} /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir=${setup.profile} --remote-debugging-port=9333`,
  installed: before,
  expectedInstalled: setup.installed,
  installedMatches: Object.keys(before).every(name => before[name] === setup.installed[name]),
  setup,
};
if (envFile) jsonWrite(envFile, env);
if (hashesFile) fs.writeFileSync(hashesFile, Object.entries(before).map(([n, h]) => `${h}  .obsidian/plugins/margin-study/${n}`).join("\n") + "\n");
console.log(JSON.stringify({ pid: env.pid, version, installedMatches: env.installedMatches, log }));
cdp.close();