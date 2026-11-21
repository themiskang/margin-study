import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);
const root = fileURLToPath(new URL("../../", import.meta.url));
const source = join(root, "native/src/FoundationModelsRecall.swift");
const outputDir = join(root, "native/recall"), executable = join(outputDir, "recall-hint"), stamp = join(outputDir, "source-hash.txt");
const hash = createHash("sha256").update(readFileSync(source)).update(process.arch + "foundationmodels-recall-v1").digest("hex");
if (existsSync(stamp) && existsSync(executable) && readFileSync(stamp, "utf8").trim() === hash) process.exit(0);
mkdirSync(dirname(executable), { recursive: true });
execFileSync("/usr/bin/xcrun", ["swiftc", "-parse-as-library", "-swift-version", "6", "-O",
  "-target", `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macosx26.0`, source, "-o", executable], { stdio: "inherit" });
execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", executable], { stdio: "inherit" });
writeFileSync(stamp, hash + "\n");
console.log("Built native FoundationModels recall helper (macOS 26+; " + process.arch + ")");
