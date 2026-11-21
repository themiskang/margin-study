// Card A · A3 re-do: aggregate summary.json for the three scenarios (numbers only, no verdicts).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const OUT_ROOT = path.join(REPO, "evidence/card-A/forensics/a3-legacy-real");
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = rel => JSON.parse(fs.readFileSync(path.join(OUT_ROOT, rel), "utf8"));

const identity = read("bundle-identity.json");
const key1 = read("scenario-1/key-numbers.json");
const key2 = read("scenario-2/key-numbers.json");
const key3 = read("scenario-3/key-numbers.json");
const legacy1 = read("scenario-1/legacy-library/legacy-library.json");
const oldImport = read("scenario-1/legacy-library/old-import.json");

const summary = {
  capturedAt: new Date().toISOString(),
  package: "evidence/card-A/forensics/a3-legacy-real",
  what: "卡 A · A3 重做：用真旧构建（commit f78573e）产出的库造历史旧库，而不是用脚本拼 JSON；三个场景全部由真实宿主会话观察得出",
  verdictPolicy: "只记录观察到什么，不写 PASS/FAIL；判据由复核席按下方数字自行判定",
  builds: {
    old: {
      role: "旧构建：唯一用来产出「真旧库」的构建",
      commit: identity.builds.old.commit == null ? null : "f78573e8b5f5660bdf19af26fc9fd0ac75cd14db",
      worktree: "/tmp/card-a-old (git worktree, 已清理)",
      mainJs: identity.builds.old.artifacts["main.js"].sha256,
      artifacts: Object.fromEntries(Object.entries(identity.builds.old.artifacts).map(([name, row]) => [name, row.sha256])),
      hasDocumentFingerprintIdentifier: identity.builds.old.mainJsHasDocumentFingerprintIdentifier,
      batchedBackfill: identity.builds.old.mainJsHasBatchedBackfillMap,
      runtimeBackfillSourceSha256: identity.runtimeObservedBackfillSource["scenario-1/legacy-library/old-import.json (旧构建会话，导入时)"].backfillSourceSha256,
    },
    new: {
      role: "新构建：唯一用来做冷启观察的构建，加载前四件套逐项核对",
      commit: "f1366fcb2aaeee917bda7a68b54f0013000c0f4e",
      buildDir: "evidence/card-A/exec/build",
      mainJs: identity.builds.new.artifacts["main.js"].sha256,
      artifacts: Object.fromEntries(Object.entries(identity.builds.new.artifacts).map(([name, row]) => [name, row.sha256])),
      hasDocumentFingerprintIdentifier: identity.builds.new.mainJsHasDocumentFingerprintIdentifier,
      batchedBackfill: identity.builds.new.mainJsHasBatchedBackfillMap,
      runtimeBackfillSourceSha256: identity.runtimeObservedBackfillSource["scenario-1/c1-detail.json"].backfillSourceSha256,
    },
  },
  legacyLibrary: {
    producedBy: "旧构建 44c324b8 在全新隔离宿主里走真实导入入口 plugin.importStudySetBytes（与命令「导入学习集（.marginstudy-set.zip）」同一函数 importStudySetPackage）",
    importArchive: { file: "scenario-1/legacy-library/import-archive.zip", sha256: oldImport.fixture.archiveSha256, size: oldImport.fixture.archiveSize },
    importSummary: oldImport.import.summary,
    dataJson: { file: "scenario-1/legacy-library/data.json", sha256: legacy1.dataJson.sha256, size: legacy1.dataJson.size },
    shape: {
      schemaVersion: legacy1.inspection.body.schemaVersion,
      revision: legacy1.inspection.body.revision,
      writerId: legacy1.inspection.body.writerId,
      savedAt: legacy1.inspection.body.savedAt,
      localEvents: legacy1.inspection.body.graph.localEvents,
      keys: legacy1.inspection.body.keys,
      objectGraph: legacy1.inspection.body.graph,
      documentsWithoutFingerprint: legacy1.inspection.body.documentsWithoutFingerprint,
      bareDateCount: legacy1.inspection.body.bareDateCount,
      bareDateEntries: legacy1.inspection.body.bareDateEntries,
      srsEntries: legacy1.inspection.body.srs.map(row => ({ id: row.questionId, due: row.due, lastReviewed: row.lastReviewed, keys: row.keys })),
      settings: legacy1.inspection.body.settings,
      legacyBackupDirProducedByOldBuildLoad: oldImport.L0.backupTree.dirs,
    },
  },
  environment: {
    host: "macOS Obsidian 1.12.7（每次会话记录 document.title 与 CFBundleShortVersionString 一致）",
    port: 9333,
    instancesConcurrent: 1,
    launchCommandTemplate: "env CFFIXED_USER_HOME=<root>/home /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir=<root>/profile --remote-debugging-port=9333",
    asarLockClearing: "每次启动前删除 profile 内 obsidian-*.asar（1.15.1 更新包）",
    note: "每次会话结束都 osascript quit 并确认进程消失、端口释放后才启动下一次",
  },
  scenarios: {
    "scenario-1": {
      name: "真旧库 → 新构建冷启#1 / 冷启#2",
      hostRoot: "/tmp/a3r-s1",
      numbers: key1,
    },
    "scenario-2": {
      name: "每日备份隔离（真实 UI 开关 + 真实备份动作）",
      hostRoot: "/tmp/a3r-s2",
      numbers: key2,
    },
    "scenario-3": {
      name: "源文件缺失 / 已移动 / 不可读（子案 A 未回填指纹、子案 B 已回填指纹）",
      hostRoots: { A: "/tmp/a3r-s3a", B: "/tmp/a3r-s3b" },
      numbers: key3,
    },
  },
  boundaryNotes: [
    "旧构建 commit f78573e 本身已写 schemaVersion=3，且总是写出 reviewPending / reviewDecks（空数组）；因此「schemaVersion<3 的双写迁移」与「reviewPending/reviewDecks 缺失形态」无法由这个构建产出。本包按统筹指定的构建取证，这两个形态在 L0 里可核到的实际值是 schemaVersion=3、reviewPending=[]、reviewDecks=[]。",
    "场景 2 的主状态零写盘判据作用在 data.json 上；备份侧车写在 vault 的 MarginStudyBackups/ 下，两者分开列（见 scenario-2/report.json 的 backupWrites / backup 字段）。",
    "旧库 L0 里的备份目录是旧构建那次加载的每日自动备份产物（settings.lastBackup 已等于当天），因此新构建冷启不会重复触发每日备份；备份动作在本包里由命令「备份数据（MarginStudy）」经命令面板真实执行一次来观察。",
  ],
  files: { identity: "bundle-identity.json", "scenario-1": "scenario-1/report.json", "scenario-2": "scenario-2/report.json", "scenario-3": "scenario-3/report.json" },
  sha256: {},
};
for (const rel of ["bundle-identity.json", "scenario-1/report.json", "scenario-2/report.json", "scenario-3/report.json",
  "scenario-1/key-numbers.json", "scenario-2/key-numbers.json", "scenario-3/key-numbers.json"]) {
  summary.sha256[rel] = sha(path.join(OUT_ROOT, rel));
}
fs.writeFileSync(path.join(OUT_ROOT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({
  summary: path.relative(REPO, path.join(OUT_ROOT, "summary.json")),
  old: summary.builds.old.mainJs, new: summary.builds.new.mainJs,
  L0: summary.legacyLibrary.dataJson.sha256,
  s1: { c1Writes: key1.coldStart1.contentWrites, c2Writes: key1.coldStart2.contentWrites, c2SixEqual: key1.coldStart2.allSixEqual },
  s2: { c1Writes: key2.toggleSession.mainStateContentWrites, c2Writes: key2.coldStart2.contentWrites, c3Writes: key2.coldStart3.contentWrites },
  s3: { Aw1: key3.A_unfingerprinted.coldStart1.contentWrites, Aw2: key3.A_unfingerprinted.coldStart2.contentWrites,
    Bw1: key3.B_afterUpgrade.coldStart1.contentWrites, Bw2: key3.B_afterUpgrade.coldStart2.contentWrites },
}, null, 2));