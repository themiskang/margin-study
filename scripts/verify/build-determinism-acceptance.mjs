/**
 * [INPUT]: 依赖 esbuild.config.mjs、仓库当前构建产物（main.js/styles.css/pdf.worker.js）与本地 node_modules。
 * [OUTPUT]: 无头校验构建产物零路径泄露与跨路径 symlink 构建字节级一致性。
 * [POS]: scripts/verify/ 下的构建确定性回归套件，由 scripts/verify.mjs 在 build 之后调用。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function sha256File(filePath) {
  const buf = readFileSync(filePath);
  return { sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeJsUnicode(text) {
  return [...text].map(ch => {
    const cp = ch.codePointAt(0);
    return cp > 0x7f ? "\\u" + cp.toString(16).toUpperCase().padStart(4, "0") : ch;
  }).join("");
}

let passed = 0;
async function test(name, fn) {
  await fn();
  console.log(`PASS ${name}`);
  passed++;
}

// 1. 静态路径泄露扫描与 CJS 模块键归一化断言
await test("Static path leak scan & CJS module key normalization", () => {
  const username = userInfo().username;
  const repoDirName = basename(root);
  const parentDirName = basename(dirname(root));
  const patterns = [
    ["parent-relative-escape", /(\.\.\/){2,}/g],
    ["documents-dir", /Documents\//g],
    ["mac-users-dir", /\/Users\//g],
    ["linux-home-dir", /\/home\//g],
    ["win-drive-escaped", /(?:^|["'`\s(])[A-Za-z]:\\\\/gm],
    ["win-drive-comment", /^\/\/.*[A-Za-z]:\\/gm],
  ];
  if (username && username.length >= 3) {
    patterns.push(["host-username", new RegExp(escapeRegExp(username), "g")]);
  }
  for (const dirName of [repoDirName, parentDirName]) {
    if (!dirName || dirName.length < 4 || /^(?:src|app|tmp|var|opt|root|work|home|repo|code|build|dist|users)$/i.test(dirName)) continue;
    const raw = escapeRegExp(dirName);
    const uni = escapeRegExp(escapeJsUnicode(dirName));
    const re = raw === uni ? new RegExp(`${raw}/`, "g") : new RegExp(`(?:${raw}|${uni})/`, "g");
    patterns.push([`parent-dir:${dirName}`, re]);
  }

  for (const artifact of ["main.js", "styles.css", "pdf.worker.js"]) {
    const text = readFileSync(join(root, artifact), "utf8");
    for (const [label, re] of patterns) {
      const hits = text.match(re) || [];
      assert.equal(hits.length, 0, `${artifact} leaked pattern ${label}: ${hits.slice(0, 3).join(", ")}`);
    }
  }

  const mainText = readFileSync(join(root, "main.js"), "utf8");
  const cjsKeys = [...mainText.matchAll(/__commonJS\(\{\s*"([^"]+)"/g)].map(m => m[1]);
  assert.ok(cjsKeys.length > 0, "Expected at least one __commonJS module key in main.js");
  const badKeys = cjsKeys.filter(k => !/^(?:\(disabled\):)?(?:node_modules|src)\//.test(k));
  assert.deepEqual(badKeys, [], `Non-repo CJS module keys found: ${badKeys.slice(0, 5).join(", ")}`);
});

// 2. 跨路径 symlink 隔离复现比对断言（不跑 npm ci，不写仓库外全局路径，finally 清理）
await test("Cross-path symlink production rebuild matches current artifacts", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "marginstudy-build-repro-"));
  try {
    const fakeHome = join(tmpRoot, "home");
    const fakePrefix = join(tmpRoot, "npm-prefix");
    const fakeBin = join(tmpRoot, "bin");
    const workDir = join(tmpRoot, "nested", "depth", "repro-repo");
    mkdirSync(fakeHome, { recursive: true });
    mkdirSync(fakePrefix, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(workDir, { recursive: true });

    for (const file of ["esbuild.config.mjs", "package.json", "tsconfig.json", "manifest.json"]) {
      copyFileSync(join(root, file), join(workDir, file));
    }
    symlinkSync(join(root, "src"), join(workDir, "src"));
    symlinkSync(join(root, "scripts"), join(workDir, "scripts"));
    symlinkSync(realpathSync(join(root, "node_modules")), join(workDir, "node_modules"));

    const isolatedEnv = {
      PATH: `${fakeBin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: fakeHome,
      npm_config_prefix: fakePrefix,
      LANG: process.env.LANG || "en_US.UTF-8",
    };

    execFileSync(process.execPath, ["esbuild.config.mjs", "production"], {
      cwd: workDir,
      env: isolatedEnv,
      stdio: "pipe",
    });

    for (const artifact of ["main.js", "styles.css", "pdf.worker.js"]) {
      const current = sha256File(join(root, artifact));
      const rebuilt = sha256File(join(workDir, artifact));
      assert.equal(rebuilt.bytes, current.bytes, `${artifact} byte length mismatch: ${rebuilt.bytes} vs ${current.bytes}`);
      assert.equal(rebuilt.sha256, current.sha256, `${artifact} sha256 mismatch: ${rebuilt.sha256} vs ${current.sha256}`);
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

console.log(`${passed}/${passed} build determinism checks passed`);
