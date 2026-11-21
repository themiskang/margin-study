// Card A · A3 re-do: build identity sheet for the two builds used in this package.
// Reads the four artifacts of each build, extracts the compiled backfill function, and cross-checks
// the runtime-observed backfill source SHA-256 recorded during the sessions.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const OUT = path.join(REPO, "evidence/card-A/forensics/a3-legacy-real/bundle-identity.json");
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const builds = {
  old: { label: "旧构建（真旧库产出者）", buildDir: path.join(REPO, "evidence/card-A/forensics/a3-legacy-real/build-old"),
    commit: "f78573e8b5f5660bdf19af26fc9fd0ac75cd14db" },
  new: { label: "新构建（冷启观察者）", buildDir: path.join(REPO, "evidence/card-A/exec/build"),
    commit: "f1366fcb2aaeee917bda7a68b54f0013000c0f4e" },
};

const slice = (text, needle, length) => {
  const at = text.indexOf(needle);
  return at < 0 ? null : text.slice(at, at + length);
};

const out = { capturedAt: new Date().toISOString(), what: "本包两个构建的四件套身份与代码片段对照（只记录，不判定）", builds: {} };
for (const [key, build] of Object.entries(builds)) {
  const files = {};
  for (const name of ["main.js", "manifest.json", "styles.css", "pdf.worker.js"]) {
    const file = path.join(build.buildDir, name);
    files[name] = { path: path.relative(REPO, file), sha256: sha(file), size: fs.statSync(file).size };
  }
  const main = fs.readFileSync(path.join(build.buildDir, "main.js"), "utf8");
  out.builds[key] = {
    label: build.label, commit: build.commit, buildDir: path.relative(REPO, build.buildDir), artifacts: files,
    mainJsHasDocumentFingerprintIdentifier: main.includes("hasDocumentFingerprint"),
    mainJsBackfillSourceFragment: slice(main, "backfillDocumentFingerprints()", 700),
    mainJsHasBatchedBackfillMap: /const updates = \/\* @__PURE__ \*\/ new Map\(\)/.test(main),
  };
}

// Runtime values recorded during the sessions (function source SHA-256 as computed inside the renderer).
const runtime = {};
for (const file of ["scenario-1/c1-detail.json", "scenario-1/c2-detail.json",
  "scenario-3/unfingerprinted/c1-detail.json", "scenario-3/after-upgrade/c1-detail.json"]) {
  const full = path.join(REPO, "evidence/card-A/forensics/a3-legacy-real", file);
  if (!fs.existsSync(full)) continue;
  const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
  runtime[file] = {
    installedMainJsSha256: parsed?.session?.bundle?.installed?.["main.js"]?.sha256 ?? null,
    backfillSourceLength: parsed?.session?.bundle?.probe?.storeApi?.backfillSourceLength ?? null,
    backfillSourceSha256: parsed?.session?.bundle?.probe?.backfillSourceSha256 ?? null,
    obsidianVersion: parsed?.session?.bundle?.probe?.obsidianVersion ?? null,
    documentTitle: parsed?.session?.bundle?.probe?.documentTitle ?? null,
  };
}
const oldImport = JSON.parse(fs.readFileSync(path.join(REPO, "evidence/card-A/forensics/a3-legacy-real/scenario-1/legacy-library/old-import.json"), "utf8"));
runtime["scenario-1/legacy-library/old-import.json (旧构建会话，导入时)"] = {
  installedMainJsSha256: oldImport?.bundleAtImport?.installed?.["main.js"]?.sha256 ?? null,
  backfillSourceSha256: oldImport?.bundleAtImport?.backfillSourceSha256 ?? null,
  backfillHasHasDocumentFingerprint: oldImport?.bundleAtImport?.backfillHasHasDocumentFingerprint ?? null,
  obsidianVersion: oldImport?.bundleAtImport?.obsidianVersion ?? null,
};
out.runtimeObservedBackfillSource = runtime;

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({
  out: path.relative(REPO, OUT),
  old: { mainJs: out.builds.old.artifacts["main.js"].sha256, hasIdentifier: out.builds.old.mainJsHasDocumentFingerprintIdentifier, batched: out.builds.old.mainJsHasBatchedBackfillMap },
  new: { mainJs: out.builds.new.artifacts["main.js"].sha256, hasIdentifier: out.builds.new.mainJsHasDocumentFingerprintIdentifier, batched: out.builds.new.mainJsHasBatchedBackfillMap },
  runtime,
}, null, 2));