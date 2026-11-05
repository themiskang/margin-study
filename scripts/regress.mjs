// 回归门控：跑验证套件 → 记录断言与构建指纹 → 与冻结基线比对。
// 默认模式：跑套件并与 baseline/last-green.json 比对，不一致即非零退出。
// --freeze ：要求工作区干净 + 全集跑通，把当前指纹写进基线（需人工提交）。
// --no-baseline：只跑不比对（首次冒烟用）。
// --suites a,b：只跑指定套件（此时不比对，只报告）。
import {spawn} from "node:child_process";
import {readFile, writeFile, mkdir, stat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {resolve, relative, sep} from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const argv = process.argv.slice(2);
const freeze = argv.includes("--freeze");
const noBaseline = argv.includes("--no-baseline");
const suiteAt = argv.indexOf("--suites");
const suites = suiteAt >= 0 && argv[suiteAt + 1] ? argv[suiteAt + 1].split(",").map(s => s.trim()).filter(Boolean) : [];
const BASELINE = "baseline/last-green.json";
const ARTIFACTS = ["main.js", "styles.css", "pdf.worker.js"];

function run(cmd, args, opts = {}) {
  return new Promise(done => {
    const child = spawn(cmd, args, {cwd: root, ...opts});
    let stdout = "", stderr = "";
    child.stdout.on("data", c => { stdout += c; });
    child.stderr.on("data", c => { stderr += c; });
    child.once("error", e => done({code: -1, stdout, stderr: stderr + String(e)}));
    child.once("close", code => done({code, stdout, stderr}));
  });
}

async function digest(rel) {
  try {
    const buf = await readFile(resolve(root, rel));
    return {sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length};
  } catch {
    return null;
  }
}

const gitHead = await run("git", ["rev-parse", "HEAD"]);
const gitBranch = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
const gitStatus = await run("git", ["status", "--porcelain"]);
const dirty = gitStatus.stdout.trim().length > 0;
const preDirty = new Set(gitStatus.stdout.split("\n").filter(Boolean).map(line => line.slice(3).trim()));

// 部分套件会把 verifiedAt 时间戳写回各自 acceptance-evidence/results.json（属运行产物）。
// 只复原「运行前干净」的这一类文件，不碰用户任何未提交改动。
const GENERATED = /(^|\/)([^/]*-)?acceptance-evidence\/results\.json$/;
async function restoreGenerated() {
  const post = await run("git", ["status", "--porcelain"]);
  const touched = post.stdout.split("\n").filter(Boolean).map(line => line.slice(3).trim())
    .filter(p => !preDirty.has(p) && GENERATED.test(p));
  if (!touched.length) return [];
  await run("git", ["checkout", "--", ...touched]);
  return touched;
}

const startedAt = new Date().toISOString();
console.log(`\n[regress] ${startedAt}  ${gitBranch.stdout.trim() || "?"}@${(gitHead.stdout.trim() || "?").slice(0, 7)}  ${dirty ? "工作区有未提交改动" : "工作区干净"}${suites.length ? `  子集=${suites.join(",")}` : "  全集"}\n`);

const verify = await run(process.execPath, ["scripts/verify.mjs", ...suites]);
process.stdout.write(verify.stdout);
if (verify.stderr.trim()) process.stderr.write(verify.stderr);

const restored = await restoreGenerated();
if (restored.length) console.log(`[regress] 已复原 ${restored.length} 个套件写回的证据时间戳，工作区保持干净：${restored.join(", ")}`);

// 断言行：verify 各套件打印的 "N/M" 计数行，逐行保留以做严格比对
const pairs = [];
for (const line of verify.stdout.split("\n")) {
  const m = line.match(/(\d+)\s*\/\s*(\d+)(?![\d/])/);
  if (m) pairs.push([Number(m[1]), Number(m[2])]);
}
const shortLines = pairs.filter(([n, m]) => n !== m).length;

const artifacts = {};
for (const rel of ARTIFACTS) artifacts[rel] = await digest(rel);

const record = {
  startedAt,
  finishedAt: new Date().toISOString(),
  git: {head: gitHead.stdout.trim(), branch: gitBranch.stdout.trim(), dirty},
  scope: suites.length ? suites : "all",
  exitCode: verify.code,
  pairs,
  artifacts,
};
const outDir = resolve(root, process.env.MARGINSTUDY_VERIFY_DIR || "evidence/verification");
await mkdir(outDir, {recursive: true});
const stamp = startedAt.replace(/[:.]/g, "-");
const recordPath = resolve(outDir, `regress-${stamp}.json`);
await writeFile(recordPath, JSON.stringify(record, null, 2) + "\n");

console.log(`\n[regress] 套件退出码 ${verify.code}  断言行 ${pairs.length} 条（未全过 ${shortLines} 条）  记录 ${relative(root, recordPath)}`);

if (verify.code !== 0) {
  console.log("[regress] 结论 FAIL：有套件失败，已停在该套件（verify 内置 break）。");
  process.exit(1);
}

if (freeze) {
  if (suites.length) { console.log("[regress] 拒绝冻结：--freeze 必须跑全集，不能带 --suites。"); process.exit(3); }
  if (dirty) { console.log("[regress] 拒绝冻结：工作区有未提交改动，先提交再冻结（基线必须对应一个可复现的 HEAD）。"); process.exit(3); }
  const residual = (await run("git", ["status", "--porcelain"])).stdout.trim();
  if (residual) { console.log("[regress] 拒绝冻结：跑完后工作区仍有非时间戳类改动，先提交或纳入忽略："); console.log(residual); process.exit(3); }
  await mkdir(resolve(root, "baseline"), {recursive: true});
  await writeFile(resolve(root, BASELINE), JSON.stringify(record, null, 2) + "\n");
  console.log(`[regress] 已冻结基线 ${BASELINE}（head ${record.git.head.slice(0, 7)}，断言行 ${pairs.length} 条）。请连同基线一起提交。`);
  process.exit(0);
}

if (noBaseline || suites.length) {
  console.log(suites.length ? "[regress] 子集运行，不做基线比对。" : "[regress] --no-baseline，跳过比对。");
  process.exit(0);
}

let base;
try {
  base = JSON.parse(await readFile(resolve(root, BASELINE), "utf8"));
} catch {
  console.log("[regress] 尚无基线，跳过比对。首次建立基线请跑：node scripts/regress.mjs --freeze");
  process.exit(0);
}

const problems = [];
const basePairs = JSON.stringify(base.pairs), nowPairs = JSON.stringify(pairs);
if (basePairs !== nowPairs) {
  const n = Math.max(base.pairs.length, pairs.length);
  const diff = [];
  for (let i = 0; i < n; i++) {
    const a = base.pairs[i] ? base.pairs[i].join("/") : "—", b = pairs[i] ? pairs[i].join("/") : "—";
    if (a !== b) diff.push(`  #${i + 1} 基线 ${a} → 现在 ${b}`);
  }
  problems.push(`断言集与基线不一致（${base.pairs.length} 条 → ${pairs.length} 条）：\n${diff.slice(0, 10).join("\n")}${diff.length > 10 ? `\n  ……共 ${diff.length} 处` : ""}`);
}

const warned = [];
for (const rel of ARTIFACTS) {
  const a = base.artifacts?.[rel], b = artifacts[rel];
  if (!a || !b) continue;
  if (a.sha256 !== b.sha256) warned.push(`  ${rel} ${a.sha256.slice(0, 12)} → ${b.sha256.slice(0, 12)}`);
}

if (problems.length) {
  console.log("\n[regress] 结论 REGRESSION：");
  for (const p of problems) console.log("  " + p);
  console.log("  基线来自 " + (base.git?.head || "?").slice(0, 7) + "（" + base.finishedAt + "）。断言集变化必须是有意的：确认后跑 --freeze 重立基线。");
  process.exit(2);
}

console.log(`[regress] 结论 PASS：与基线一致（head ${(base.git?.head || "?").slice(0, 7)}，断言行 ${pairs.length} 条）。`);
if (warned.length) {
  console.log("[regress] 提示：构建产物与基线不同（源码可能变了，需人工确认是否需要重建基线）：");
  console.log(warned.join("\n"));
  const h = await stat(resolve(root, "main.js")).then(s => s.mtime.toISOString()).catch(() => "?");
  console.log(`  main.js mtime ${h}`);
}
process.exit(0);
