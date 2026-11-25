/**
 * [INPUT]: 环境变量 MARGINSTUDY_BROWSER 与 ego-harness.mjs 的统一路径解析器。
 * [OUTPUT]: 后端名称、实际解析路径、版本，以及是否为仓库外稳定安装。
 * [POS]: 在跑验收前确认浏览器后端路径口径与 harness 一致且未落入临时 worktree/node_modules。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { spawnSync } from "node:child_process";
import { resolveBrowserExecutable } from "./ego-harness.mjs";

const backend = process.env.MARGINSTUDY_BROWSER === "ego" ? "ego-browser" : "agent-browser";
const found = resolveBrowserExecutable(backend);
if (!found) {
  console.error(
    `[browser-backend] 未找到 ${backend}。agent-browser 需在 /opt/homebrew/bin，ego-browser 需在 PATH 或 ~/.pi/agent/bin。`,
  );
  process.exit(1);
}
const { path, resolved } = found;
const versionProbe = spawnSync(path, ["--version"], { encoding: "utf8" });
const version =
  (versionProbe.stdout || versionProbe.stderr || "").split("\n")[0]?.trim() || "(无输出)";
const stablePrefixes = [
  "/opt/homebrew/lib/node_modules/",
  "/opt/homebrew/bin/",
  "/Users/",
  "/usr/local/lib/node_modules/",
];
const inWorktree =
  /\/orca\/workspaces\//.test(resolved) ||
  (resolved.includes("/node_modules/") &&
    !stablePrefixes.some(prefix => prefix.endsWith("node_modules/") && resolved.startsWith(prefix)));
console.log(`[browser-backend] backend=${backend} path=${path} resolved=${resolved} version=${version}`);
if (inWorktree) {
  console.error(
    "[browser-backend] 后端解析到 worktree/node_modules 内的副本，说明全局 bin 被 postinstall 重链。修复：ln -sfn /opt/homebrew/lib/node_modules/agent-browser/bin/agent-browser-darwin-arm64 /opt/homebrew/bin/agent-browser",
  );
  process.exit(1);
}
