/**
 * [INPUT]: 依赖 esbuild.config.mjs、仓库当前构建产物（main.js/styles.css/pdf.worker.js）与本地 node_modules。
 * [OUTPUT]: 在仓库内隔离镜像中无头校验构建产物零路径泄露、realpath 边界、原生能力探测与跨路径 symlink 构建一致性。
 * [POS]: scripts/verify/ 下的构建确定性回归套件，由 scripts/verify.mjs 在 build 之后调用。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
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

function snapshotGlobalBins() {
  const dirs = ["/opt/homebrew/bin", "/usr/local/bin"];
  const parts = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const entries = readdirSync(dir).sort();
    const lines = entries.map(name => {
      const full = join(dir, name);
      try {
        const st = lstatSync(full);
        return `${name}:${st.isSymbolicLink() ? "L:" + realpathSync(full) : "F:" + st.size}`;
      } catch {
        return `${name}:broken`;
      }
    });
    parts.push(`${dir}\n${lines.join("\n")}`);
  }
  return createHash("sha256").update(parts.join("\n---\n")).digest("hex");
}

function snapshotTmpBuildEntries() {
  if (!existsSync("/tmp")) return [];
  return readdirSync("/tmp")
    .filter(name => /GAP-BUILD-01|marginstudy-build-repro/i.test(name))
    .sort();
}

function probeNativeSwiftc(probeDir, isolatedEnv) {
  if (process.platform !== "darwin") {
    return { available: false, skipped: true, reason: `non-darwin platform (${process.platform})` };
  }
  mkdirSync(probeDir, { recursive: true });
  const src = join(probeDir, "probe.swift");
  const out = join(probeDir, "probe-bin");
  writeFileSync(src, "print(1)\n", "utf8");
  const res = spawnSync("/usr/bin/xcrun", ["swiftc", "-O", src, "-o", out], {
    cwd: probeDir,
    env: isolatedEnv,
    encoding: "utf8",
  });
  if (res.status === 0 && !res.signal && existsSync(out)) {
    return { available: true, skipped: false, reason: "ok" };
  }
  const detail = [
    res.signal ? `signal=${res.signal}` : null,
    res.status !== null ? `status=${res.status}` : null,
    res.error ? `error=${res.error.message}` : null,
    res.stderr ? `stderr=${res.stderr.trim().slice(0, 160)}` : null,
  ].filter(Boolean).join(", ");
  return { available: false, skipped: true, reason: `xcrun swiftc unavailable in isolated mirror (${detail || "unknown"})` };
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
  // 生产构建开启压缩后，esbuild 会省略 CJS 模块键（仅调试用信息），因此以两条等价护栏为准：
  //   ① 产物内零绝对/越界路径（上面的 patterns 扫描，覆盖 /Users、/home、Documents、../ 与盘符）；
  //   ② 若存在模块键，则必须是仓库内相对路径且不含 `..`。
  const collectRepoModuleKeys = (text) =>
    [...text.matchAll(/"((?:\(disabled\):)?(?:node_modules|src)\/[^"\n]{1,200}?\.(?:js|mjs|cjs|json))"/g)].map((m) => m[1]);
  const repoKeys = collectRepoModuleKeys(mainText);
  const escapingKeys = repoKeys.filter((k) => k.includes(".."));
  assert.deepEqual(escapingKeys, [], `Module keys escaping the repo: ${escapingKeys.slice(0, 5).join(", ")}`);
  const probe = '"node_modules/a/index.js" "(disabled):src/b.js" "../escape.js"';
  assert.deepEqual(collectRepoModuleKeys(probe), ["node_modules/a/index.js", "(disabled):src/b.js"], "Module-key detector self-check failed");
  console.log(
    `  module-keys: ${repoKeys.length}${repoKeys.length === 0 ? " (elided by minified build; absolute-path scan governs)" : ""}`,
  );});

// 2. 仓库内隔离镜像 + 跨路径 symlink 复现比对断言（不写仓外路径、真实复制源码与脚本、realpath 越界防护、finally 清理）
await test("In-repo isolated mirror cross-path symlink rebuild matches current artifacts", () => {
  const globalBinBefore = snapshotGlobalBins();
  const tmpBefore = snapshotTmpBuildEntries();
  const runId = `${Date.now()}-${process.pid}-${randomBytes(4).toString("hex")}`;
  const tmpParent = join(root, ".tmp", "build-determinism");
  const runRoot = join(tmpParent, runId);

  try {
    const fakeHome = join(runRoot, "home");
    const fakePrefix = join(runRoot, "npm-prefix");
    const fakeBin = join(runRoot, "bin");
    const fakeTmp = join(runRoot, "tmp");
    const probeDir = join(runRoot, "probe");
    const workDir = join(runRoot, "nested", "depth", "repro-repo");
    for (const dir of [fakeHome, fakePrefix, fakeBin, fakeTmp, workDir]) {
      mkdirSync(dir, { recursive: true });
    }

    const isolatedEnv = {
      PATH: `${fakeBin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: fakeHome,
      TMPDIR: fakeTmp,
      npm_config_prefix: fakePrefix,
      LANG: process.env.LANG || "en_US.UTF-8",
    };

    // 真实复制入口、源码与构建脚本（禁止符号链接 scripts/src，杜绝沿链接写回调用方工作树）
    for (const file of ["esbuild.config.mjs", "package.json", "tsconfig.json", "manifest.json", "ocr.swift"]) {
      copyFileSync(join(root, file), join(workDir, file));
    }
    cpSync(join(root, "src"), join(workDir, "src"), { recursive: true, dereference: false });
    mkdirSync(join(workDir, "scripts"), { recursive: true });
    cpSync(join(root, "scripts", "build"), join(workDir, "scripts", "build"), { recursive: true, dereference: false });

    // macOS 原生编译能力探测：不可用时显式 SKIP 并写明原因，绝不静默通过
    const nativeProbe = probeNativeSwiftc(probeDir, isolatedEnv);
    if (nativeProbe.available) {
      mkdirSync(join(workDir, "native"), { recursive: true });
      cpSync(join(root, "native", "src"), join(workDir, "native", "src"), { recursive: true, dereference: false });
      console.log("PASS Native cold-build capability probe (xcrun swiftc available)");
    } else {
      console.log(`SKIP native-cold-build: ${nativeProbe.reason}`);
      // 在镜像内真实复制已构建的 native/（含 source-hash.txt），确保构建脚本仅校验镜像内产物而不写回主树
      if (existsSync(join(root, "native"))) {
        cpSync(join(root, "native"), join(workDir, "native"), { recursive: true, dereference: false });
      }
    }

    // 仅 node_modules 使用符号链接（正是本卡要验证的 worktree 场景）
    symlinkSync(realpathSync(join(root, "node_modules")), join(workDir, "node_modules"));
    assert.equal(lstatSync(join(workDir, "node_modules")).isSymbolicLink(), true, "node_modules must be a symlink");

    // 显式 realpath 边界防护：子进程启动前断言所有源码/脚本入口均落在镜像根内
    const realWorkDir = realpathSync(workDir);
    const guardEntries = [
      "esbuild.config.mjs",
      "src/main.ts",
      "scripts/build/build-native-photos.mjs",
      "scripts/build/build-native-camera.mjs",
      "scripts/build/build-native-recall.mjs",
      "native/src",
    ];
    for (const rel of guardEntries) {
      const resolved = realpathSync(join(workDir, rel));
      assert.ok(
        resolved === realWorkDir || resolved.startsWith(realWorkDir + sep),
        `Mirror boundary violation: ${rel} resolved outside mirror (${resolved})`
      );
    }

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
    rmSync(runRoot, { recursive: true, force: true });
    if (existsSync(tmpParent) && readdirSync(tmpParent).length === 0) {
      rmSync(tmpParent, { recursive: true, force: true });
    }
    const dotTmp = join(root, ".tmp");
    if (existsSync(dotTmp) && readdirSync(dotTmp).length === 0) {
      rmSync(dotTmp, { recursive: true, force: true });
    }
  }

  // 结束时断言：仓库内临时根已删、/tmp 无新增、全局 bin 快照不变
  assert.equal(existsSync(runRoot), false, `In-repo temp root was not cleaned: ${runRoot}`);
  assert.deepEqual(snapshotTmpBuildEntries(), tmpBefore, "/tmp gained unexpected GAP-BUILD-01 entries");
  assert.equal(snapshotGlobalBins(), globalBinBefore, "Global bin directory changed during test");
});

console.log(`${passed}/${passed} build determinism checks passed`);
