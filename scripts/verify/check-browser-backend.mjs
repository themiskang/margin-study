/**
 * [INPUT]: 环境变量 MARGINSTUDY_BROWSER 与 PATH 中的浏览器后端可执行文件。
 * [OUTPUT]: 后端名称、实际解析路径、版本，以及是否为仓库外稳定安装。
 * [POS]: 在跑验收前确认浏览器后端没有被 node_modules 的 postinstall 重链到临时目录。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

const backend = process.env.MARGINSTUDY_BROWSER === "ego" ? "ego-browser" : "agent-browser";
const which = spawnSync("command", ["-v", backend], { shell: "/bin/sh", encoding: "utf8" });
const path = which.stdout.trim();
if (!path) {
  console.error(`[browser-backend] ${backend} 不在 PATH 中。agent-browser 需在 /opt/homebrew/bin，ego-browser 在 ~/.pi/agent/bin。`);
  process.exit(1);
}
let resolved = path;
try { resolved = realpathSync(path); } catch { console.error(`[browser-backend] ${backend} 的链接目标不存在：${path}`); process.exit(1); }
const version = spawnSync(path, ["--version"], { encoding: "utf8" }).stdout?.split("\n")[0]?.trim() ?? "(无输出)";
const stablePrefixes = ["/opt/homebrew/lib/node_modules/", "/opt/homebrew/bin/", "/Users/", "/usr/local/lib/node_modules/"];
const inWorktree = /\/orca\/workspaces\//.test(resolved) || (resolved.includes("/node_modules/") && !stablePrefixes.some(prefix => prefix.endsWith("node_modules/") && resolved.startsWith(prefix)));
console.log(`[browser-backend] backend=${backend} path=${path} resolved=${resolved} version=${version}`);
if (inWorktree) {
  console.error("[browser-backend] 后端解析到 worktree/node_modules 内的副本，说明全局 bin 被 postinstall 重链。修复：ln -sfn /opt/homebrew/lib/node_modules/agent-browser/bin/agent-browser-darwin-arm64 /opt/homebrew/bin/agent-browser");
  process.exit(1);
}
