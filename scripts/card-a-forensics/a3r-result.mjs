// Card A · A3 re-do: RESULT.json for evidence/card-A/forensics/a3-legacy-real/
// Every file in the package (recursively, except RESULT.json itself) listed with its SHA-256;
// the account is proven by comparing the listing against the disk.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const ROOT = path.join(REPO, "evidence/card-A/forensics/a3-legacy-real");
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const walk = rel => {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(child));
    else out.push(child);
  }
  return out;
};
const all = walk("").sort();
const files = {};
for (const rel of all) {
  if (rel === "RESULT.json") continue;
  const abs = path.join(ROOT, rel);
  files[rel] = { sha256: sha(abs), size: fs.statSync(abs).size };
}

const identity = JSON.parse(fs.readFileSync(path.join(ROOT, "bundle-identity.json"), "utf8"));
const summary = JSON.parse(fs.readFileSync(path.join(ROOT, "summary.json"), "utf8"));

const result = {
  scope: "卡 A · A3 重做：用真旧构建（commit f78573e）产出的历史旧库，跑三个场景的宿主冷启取证（只采集，不判定）",
  producedBy: "scripts/card-a-forensics/{a3r-old-import,a3r-scenario1,a3r-scenario2,a3r-scenario3,a3r-summary,a3r-bundle-identity,a3r-result}.mjs + a3r-lib/a3r-host/a3r-fixture/a3r-scenario-common.mjs",
  verdictPolicy: "本包不含 PASS/FAIL；判据由复核席按 summary.json 与各场景 report.json 的数字自行判定",
  builds: {
    old: { role: "产出真旧库", commit: "f78573e8b5f5660bdf19af26fc9fd0ac75cd14db", worktree: "/tmp/card-a-old（已清理）",
      mainJs: identity.builds.old.artifacts["main.js"].sha256,
      artifacts: Object.fromEntries(Object.entries(identity.builds.old.artifacts).map(([name, row]) => [name, row.sha256])) },
    new: { role: "冷启观察", commit: summary.builds.new.commit, buildDir: "evidence/card-A/exec/build",
      mainJs: identity.builds.new.artifacts["main.js"].sha256,
      artifacts: Object.fromEntries(Object.entries(identity.builds.new.artifacts).map(([name, row]) => [name, row.sha256])) },
    identitySheet: "bundle-identity.json",
  },
  legacyLibrary: {
    origin: "旧构建真实导入产出（plugin.importStudySetBytes，与命令「导入学习集（.marginstudy-set.zip）」共用 importStudySetPackage），非脚本拼 JSON",
    dataJson: summary.legacyLibrary.dataJson,
    importArchive: summary.legacyLibrary.importArchive,
    shape: summary.legacyLibrary.shape,
    perScenarioOriginals: {
      "scenario-1": "scenario-1/legacy-library/data.json",
      "scenario-2": "scenario-2/legacy-library/data.json",
      "scenario-3": "scenario-3/legacy-library/data.json",
    },
  },
  scenarios: {
    "scenario-1": { name: "真旧库 → 新构建冷启#1/#2", report: "scenario-1/report.json", keyNumbers: "scenario-1/key-numbers.json",
      observed: {
        coldStart1: { dataJsonContentWrites: summary.scenarios["scenario-1"].numbers.coldStart1.contentWrites,
          revisionDelta: summary.scenarios["scenario-1"].numbers.coldStart1.revisionDelta,
          documentsAllFingerprintedAfter: summary.scenarios["scenario-1"].numbers.coldStart1.documentsAllFingerprinted,
          bareDateCountAfter: summary.scenarios["scenario-1"].numbers.coldStart1.bareDateCount,
          backupDirsAdded: summary.scenarios["scenario-1"].numbers.coldStart1.backupDirsAdded },
        coldStart2: { dataJsonContentWrites: summary.scenarios["scenario-1"].numbers.coldStart2.contentWrites,
          revisionDelta: summary.scenarios["scenario-1"].numbers.coldStart2.revisionDelta,
          allSixEqual: summary.scenarios["scenario-1"].numbers.coldStart2.allSixEqual,
          backupDirsAdded: summary.scenarios["scenario-1"].numbers.coldStart2.backupDirsAdded },
      } },
    "scenario-2": { name: "每日备份隔离（真实 UI 开关 + 真实备份命令）", report: "scenario-2/report.json", keyNumbers: "scenario-2/key-numbers.json",
      observed: {
        toggleSession: { dataJsonContentWrites: summary.scenarios["scenario-2"].numbers.toggleSession.mainStateContentWrites,
          backupDirsAdded: summary.scenarios["scenario-2"].numbers.toggleSession.backupDirsAdded,
          backupFilesWritten: summary.scenarios["scenario-2"].numbers.toggleSession.backupFilesWritten.length },
        coldStart2: { dataJsonContentWrites: summary.scenarios["scenario-2"].numbers.coldStart2.contentWrites,
          revisionDelta: summary.scenarios["scenario-2"].numbers.coldStart2.revisionDelta,
          allSixEqual: summary.scenarios["scenario-2"].numbers.coldStart2.allSixEqual,
          backupDirsAdded: summary.scenarios["scenario-2"].numbers.coldStart2.backupDirsAdded },
        coldStart3: { dataJsonContentWrites: summary.scenarios["scenario-2"].numbers.coldStart3.contentWrites,
          revisionDelta: summary.scenarios["scenario-2"].numbers.coldStart3.revisionDelta,
          allSixEqual: summary.scenarios["scenario-2"].numbers.coldStart3.allSixEqual,
          backupDirsAdded: summary.scenarios["scenario-2"].numbers.coldStart3.backupDirsAdded },
      } },
    "scenario-3": { name: "源文件缺失 / 已移动 / 不可读（子案 A 未回填指纹、子案 B 已回填指纹）", report: "scenario-3/report.json", keyNumbers: "scenario-3/key-numbers.json",
      observed: {
        A_coldStart1: { dataJsonContentWrites: summary.scenarios["scenario-3"].numbers.A_unfingerprinted.coldStart1.contentWrites,
          revisionDelta: summary.scenarios["scenario-3"].numbers.A_unfingerprinted.coldStart1.revisionDelta,
          missingDocuments: summary.scenarios["scenario-3"].numbers.A_unfingerprinted.coldStart1.missingDocuments.length,
          notices: summary.scenarios["scenario-3"].numbers.A_unfingerprinted.coldStart1.notices.length },
        A_coldStart2: { dataJsonContentWrites: summary.scenarios["scenario-3"].numbers.A_unfingerprinted.coldStart2.contentWrites,
          revisionDelta: summary.scenarios["scenario-3"].numbers.A_unfingerprinted.coldStart2.revisionDelta,
          allSixEqual: summary.scenarios["scenario-3"].numbers.A_unfingerprinted.coldStart2.allSixEqual },
        B_coldStart1: { dataJsonContentWrites: summary.scenarios["scenario-3"].numbers.B_afterUpgrade.coldStart1.contentWrites,
          revisionDelta: summary.scenarios["scenario-3"].numbers.B_afterUpgrade.coldStart1.revisionDelta,
          missingDocuments: summary.scenarios["scenario-3"].numbers.B_afterUpgrade.coldStart1.missingDocuments.length,
          notices: summary.scenarios["scenario-3"].numbers.B_afterUpgrade.coldStart1.notices.length },
        B_coldStart2: { dataJsonContentWrites: summary.scenarios["scenario-3"].numbers.B_afterUpgrade.coldStart2.contentWrites,
          revisionDelta: summary.scenarios["scenario-3"].numbers.B_afterUpgrade.coldStart2.revisionDelta,
          allSixEqual: summary.scenarios["scenario-3"].numbers.B_afterUpgrade.coldStart2.allSixEqual },
      } },
  },
  summary: "summary.json",
  note: "note.md",
  scripts: {},
  scriptsNote: "取证脚本不在 evidence 内，按纪律不进本包；这里只登记它们当时的 SHA-256，便于复现时核对",
  fileCount: Object.keys(files).length,
  diskFileCount: all.length,
  accounting: "磁盘文件数 = 清单条目数 + 1（RESULT.json 自身）",
  files,
};
for (const rel of ["a3r-lib.mjs", "a3r-host.mjs", "a3r-fixture.mjs", "a3r-scenario-common.mjs",
  "a3r-old-import.mjs", "a3r-scenario1.mjs", "a3r-scenario2.mjs", "a3r-scenario3.mjs",
  "a3r-bundle-identity.mjs", "a3r-summary.mjs", "a3r-result.mjs",
  "lib.mjs", "host.mjs", "bootstrap.mjs", "mkfixture.mjs"]) {
  const file = path.join(REPO, "scripts/card-a-forensics", rel);
  if (fs.existsSync(file)) result.scripts[`scripts/card-a-forensics/${rel}`] = sha(file);
}
fs.writeFileSync(path.join(ROOT, "RESULT.json"), JSON.stringify(result, null, 2) + "\n");

const diskAfter = walk("").length;
const listed = Object.keys(files).length;
console.log(JSON.stringify({ listed, diskFileCount: diskAfter, accountingHolds: diskAfter === listed + 1,
  mismatched: Object.entries(files).filter(([rel, row]) => sha(path.join(ROOT, rel)) !== row.sha256).map(([rel]) => rel) }, null, 2));