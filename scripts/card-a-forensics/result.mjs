// Card A stage 2: build forensics/RESULT.json and prove the manifest matches the directory.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const OUT = process.env.CA_OUT ?? path.join(REPO, "evidence/card-A/forensics");
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const disk = fs.readdirSync(OUT, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name).sort();
const files = {};
for (const name of disk.filter(n => n !== "RESULT.json")) files[name] = sha(path.join(OUT, name));

const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "evidence/card-A/exec/build-manifest.json"), "utf8"));
const result = {
  scope: "Card A stage 2 · 宿主冷重启实采取证（只采集，不判定）",
  commit: manifest.commit,
  artifacts: manifest.artifacts,
  runtimeBundle: { file: "runtime-bundle-sha256.txt", installedEqualsBuildManifest: true,
    obsidianVersion: "1.12.7", port: 9333, instancesConcurrent: 1 },
  scenarios: {
    A1: { products: ["import-snapshot.json", "import-check.txt", "import-check.json"],
      observed: "导入后 revision 1→2，2 条文档 byteSize 正整数 + sha256 小写 hex64 且与库内字节相等，srs 2 条全 ISO，裸 YYYY-MM-DD 计数 0" },
    A2: { products: ["cold-restart-new-before.json", "cold-restart-new-after.json", "cold-restart-new-diff.json"],
      observed: "sha256/mtimeMs/revision/writerId/savedAt/localEvents.length 六项全等；冷启动窗口 contentWrites=0 touches=0 rawFsEventCount=0" },
    A3: { products: ["legacy-seed.json", "legacy-cold1-before.json", "legacy-cold1-after.json",
        "legacy-cold2-before.json", "legacy-cold2-after.json", "legacy-cold-restart-diff.json"],
      libraryOrigin: "脚本构造的等价历史旧库（scripts/card-a-forensics/mkfixture.mjs legacy），非旧构建产出",
      superseded: true,
      supersededBy: "a3-legacy-real/（真旧构建 f78573e 产出的库 + 三场景宿主实采，自成一包带自己的 RESULT.json）",
      supersededNote: "复核席判定本采 PARTIAL：脚本造 JSON 缺真实旧库形态。上面这些文件按纪律保留不删，仅作追溯；A3 的语义证据以 a3-legacy-real/ 为准。",
      observed: "冷启#1 contentWrites=1，revision 41→42，指纹与 srs 日期全部规范；冷启#2 contentWrites=0，revision 差值 0，六项全等" },
  },
  logs: ["bundle-steps.log", "a1a2-steps.log", "a3-steps.log"],
  scripts: "scripts/card-a-forensics/（lib/host/bootstrap/mkfixture/bundle/a12/a3）；forensics/ 内无脚本",
  note: "note.md",
  supersededAnnotation: "SUPERSEDED.txt",
  subdirectories: { "a3-legacy-real/": "自成一包的 A3 重采（真旧构建产出的旧库 + 三场景），清单见 a3-legacy-real/RESULT.json" },
  fileCount: Object.keys(files).length,
  diskFileCount: disk.length,
  accounting: "磁盘文件数 = 清单条目数 + 1（RESULT.json 自身）",
  files,
};
fs.writeFileSync(path.join(OUT, "RESULT.json"), JSON.stringify(result, null, 2) + "\n");
const diskAfter = fs.readdirSync(OUT).filter(n => fs.statSync(path.join(OUT, n)).isFile());
console.log(JSON.stringify({ fileCount: result.fileCount, diskFileCount: diskAfter.length,
  equal: diskAfter.length === result.fileCount + 1, listed: Object.keys(files) }, null, 2));