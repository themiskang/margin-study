/**
 * [INPUT]: 仓库内公开夹具、私有夹具目录环境变量与套件所需的相对路径。
 * [OUTPUT]: 公开夹具与私有夹具的解析路径，以及私有夹具缺失标记。
 * [POS]: 验收脚本共享的夹具路径入口。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { existsSync, globSync } from "node:fs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const missingPrivateFixture = Symbol("missing private fixture");
export const missingPrivateFixtureExitCode = 77;

export function publicFixture(relPath) {
  return resolve(root, "tests/fixtures", relPath);
}

export function privateFixture(relPath) {
  return resolve(root, process.env.MARGINSTUDY_EVIDENCE_DIR || "evidence", relPath);
}

export function requirePrivateFixture(relPath, suite, strict = process.env.VERIFY_STRICT === "1") {
  const path = privateFixture(relPath);
  const present = relPath.includes("*")
    ? globSync(relPath, { cwd: privateFixture("") }).length > 0
    : existsSync(path);
  if (present) return path;
  const reason = `requires private fixture (${relPath})`;
  if (strict) throw new Error(`${suite}: ${reason}`);
  console.log(`[SKIP] ${suite}: ${reason}`);
  return missingPrivateFixture;
}
