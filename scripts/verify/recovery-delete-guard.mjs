/**
 * [INPUT]: src/ 生产源码与内存编译的 Store 实例。
 * [OUTPUT]: 恢复文件删除静态扫描与运行时哨兵断言结果。
 * [POS]: 强制收口所有批注恢复文件删除至 canDeleteRecovery/deleteRecoveryIfProved 单一闸门。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  memoryVault, oldPath, pen, run, seed, stageMerge,
} from "./annotation-refs/invariant-r/fixture-support.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const srcRoot = join(root, "src");

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "acceptance-fixtures" || entry.name.endsWith("-evidence")) continue;
      out.push(...await walk(full));
    } else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name) &&
      !/(?:acceptance|fixture|\.test\.)/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const DELETE_OR_RENAME_RE = /\b(?:(?:adapter|vault\.adapter|fs|fsp|promises)\s*(?:\?\.|\.)\s*(?:remove|rename|unlink|unlinkSync|renameSync|rm|rmSync|removeFile)|(?:unlink|unlinkSync|rmSync|removeFile))\s*(?:\?\.)?\s*\(([^;\n]*)\)/g;
const RECOVERY_TOKEN_RE = /\b\w*(?:pending|journal|tx|recover|tombstone|superseded|quarantine)\w*\b|_marginstudy-recovery|pending-|legacyPending|\.superseded-|\.quarantine-/i;
const METHOD_HEADER_RE = /^\s*(?:(?:public|private|protected|static|async|export)\s+)*(?:function\s+)?([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::[^{]*)?\{/;

// Explicit, non-wildcard allowlist with documented rationale.
function isAllowedRecoveryOp(relPath, methodName, fullMatch, line) {
  if (relPath === "src/model/store.ts") {
    if (methodName === "deleteRecoveryIfProved") return true; // Single disk-proved deletion gate
    if (methodName === "supersedeRecoveryFile") return true; // Two-phase tombstone rename (<exact>.superseded-<ts>)
    if (methodName === "renameDocument" &&
      /adapter\.rename\(\s*(?:supersededOldPending\s*,\s*oldPendingPath|supersededOldTx\s*,\s*oldTxPath)\s*\)/.test(fullMatch)) {
      return true; // Rollback restores tombstone back to original exact path (not a deletion)
    }
    if (methodName === "pruneRecoveries" && line.includes("adapter.remove(file.path)") && !line.includes("pending-annotations")) {
      return true; // Main-data rolling snapshot quota (category === "main"), not annotation recovery
    }
    if (methodName === "recoverPendingAnnotationMerges" && /adapter\.remove\?\.\(\s*tx\.sidecarPath\s*\)/.test(fullMatch)) {
      return true; // Deletes partially-written document sidecar when previousDiskRaw === null, not a recovery file
    }
  }
  return false;
}

async function runStaticScan() {
  const files = await walk(srcRoot);
  const violations = [];
  for (const file of files) {
    const rel = relative(root, file).replace(/\\/g, "/");
    const lines = (await readFile(file, "utf8")).split(/\r?\n/);
    let currentMethod = "<top-level>";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      const header = METHOD_HEADER_RE.exec(line);
      if (header && !["if", "for", "while", "switch", "catch", "try", "else"].includes(header[1])) {
        currentMethod = header[1];
      }
      DELETE_OR_RENAME_RE.lastIndex = 0;
      let match;
      while ((match = DELETE_OR_RENAME_RE.exec(line)) !== null) {
        const args = match[1] ?? "";
        if (!RECOVERY_TOKEN_RE.test(args)) continue;
        if (isAllowedRecoveryOp(rel, currentMethod, match[0], line)) continue;
        violations.push(`${rel}:${i + 1} (${currentMethod}): ${trimmed}`);
      }
    }
  }
  return violations;
}

await run("recovery-delete-guard", async (Store, check) => {
  const violations = await runStaticScan();
  check("static scan: zero unguarded recovery delete/rename calls in src/**", violations, []);

  // Runtime sentinel: wrap adapter.remove and assert every annotation recovery deletion increments Store.recoveryDeleteGateApprovals.
  const env = memoryVault(Store);
  const isAnnotationRecovery = (file) =>
    /^_marginstudy-recovery\/(?:pending-annotations-|pending-merge-tx-)/.test(file);
  let lastApprovals = Store.recoveryDeleteGateApprovals;
  let guardedDeletions = 0;
  const unguardedDeletions = [];
  const origRemove = env.adapter.remove;
  env.adapter.remove = async (file) => {
    if (isAnnotationRecovery(file)) {
      if (Store.recoveryDeleteGateApprovals > lastApprovals) {
        guardedDeletions++;
        lastApprovals = Store.recoveryDeleteGateApprovals;
      } else {
        unguardedDeletions.push(file);
      }
    }
    return origRemove.call(env.adapter, file);
  };

  // Flow 1: merge journal recovery + disk-proved deletion
  const store = await env.open();
  await seed(env, store, oldPath, "sentinel-base");
  const marker = pen("sentinel-unbound", oldPath, { hostAnnotationId: "missing-host" });
  await stageMerge(env, store, oldPath, marker);
  await env.open();

  // Flow 2: rename migration creates tombstone + 2 clean cold boots GC tombstone through gate
  const store2 = await env.open();
  const nextDoc = "sub/sentinel-moved.pdf";
  const marker2 = pen("sentinel-unbound-2", oldPath, { hostAnnotationId: "missing-host-2" });
  await stageMerge(env, store2, oldPath, marker2);
  await store2.renameDocument(oldPath, nextDoc);
  await env.open();
  await env.open();
  await env.open();

  check("runtime sentinel: every annotation recovery deletion passed through canDeleteRecovery", unguardedDeletions, []);
  check("runtime sentinel: at least one proved deletion was observed", guardedDeletions >= 1, true);
});
