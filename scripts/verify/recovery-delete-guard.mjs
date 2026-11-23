/**
 * [INPUT]: src/ 生产源码（经 TypeScript AST 解析）与内存编译的 Store 实例。
 * [OUTPUT]: 恢复文件删除 AST 静态扫描（精确调用点基线清单）与运行时哨兵断言结果。
 * [POS]: 强制收口所有批注恢复文件删除至 canDeleteRecovery/deleteRecoveryIfProved 单一闸门，杜绝正则绕过与方法级白名单。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import {
  memoryVault, oldPath, pen, run, seed, stageMerge,
} from "./annotation-refs/invariant-r/fixture-support.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const DELETE_METHOD_NAMES = new Set([
  "remove", "rename", "unlink", "unlinkSync", "renameSync", "rm", "rmSync", "removeFile",
]);
const DELETE_VERB_RE = /(?:remove|delete|unlink|purge|drop|clear|clean|erase|\brm(?:Sync)?\b|^rm(?=[A-Z_]))/i;
const RECOVERY_TOKEN_RE = /(?:pending|journal|tx|recover|tombstone|superseded|quarantine|_marginstudy-recovery|legacyPending)/i;
const RECOVERY_HELPER_RE = /^(?:pendingAnnotationsPath|legacyPendingAnnotationsPath|pendingMergeTxPath|legacyPendingMergeTxPath)$/;

/**
 * Exact call-site allowlist: { file, method, expr, reason }.
 * Method-level or file-level exemptions are strictly forbidden.
 * Any addition or removal of a call site MUST update this exact baseline.
 */
export const ALLOWLIST = [
  {
    file: "src/model/store.ts",
    method: "pruneRecoveries",
    expr: "adapter.remove(file.path)",
    reason: "Main-data rolling snapshot quota (category === 'main' else-branch only; annotation recovery uses deleteRecoveryIfProved).",
  },
  {
    file: "src/model/store.ts",
    method: "deleteRecoveryIfProved",
    expr: "this.host.app.vault.adapter.remove?.(file)",
    reason: "Single disk-proved deletion gate; only executes after canDeleteRecovery() returns true.",
  },
  {
    file: "src/model/store.ts",
    method: "supersedeRecoveryFile",
    expr: "adapter.rename(exactPath, tombstone)",
    reason: "Two-phase tombstone rename (<exact>.superseded-<ts>); preserves bytes until disk-proved GC.",
  },
  {
    file: "src/model/store.ts",
    method: "recoverPendingAnnotationMerges",
    expr: "adapter.remove?.(tx.sidecarPath)",
    reason: "Deletes partially-written document sidecar on rollback when previousDiskRaw === null (target is sidecar, not recovery log).",
  },
  {
    file: "src/model/store.ts",
    method: "renameDocument",
    expr: "adapter.rename(supersededOldPending, oldPendingPath)",
    reason: "Rollback restores tombstone back to original exact oldPendingPath (restoration, not deletion).",
  },
  {
    file: "src/model/store.ts",
    method: "renameDocument",
    expr: "adapter.rename(supersededOldTx, oldTxPath)",
    reason: "Rollback restores tombstone back to original exact oldTxPath (restoration, not deletion).",
  },
];

function unwrap(node) {
  let cur = node;
  while (cur) {
    if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isTypeAssertionExpression(cur) ||
      ts.isNonNullExpression(cur) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(cur))) {
      cur = cur.expression;
    } else {
      break;
    }
  }
  return cur;
}

function evalConstString(node, constStrings) {
  const n = unwrap(node);
  if (!n) return null;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isIdentifier(n)) return constStrings.has(n.text) ? constStrings.get(n.text) : null;
  if (ts.isTemplateExpression(n)) {
    let out = n.head.text;
    for (const span of n.templateSpans) {
      const val = evalConstString(span.expression, constStrings);
      if (val === null) return null;
      out += val + span.literal.text;
    }
    return out;
  }
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evalConstString(n.left, constStrings);
    const right = evalConstString(n.right, constStrings);
    if (left !== null && right !== null) return left + right;
  }
  return null;
}

function isFsOrAdapterReceiver(node, adapterAliases) {
  const n = unwrap(node);
  if (!n) return false;
  if (ts.isIdentifier(n)) {
    return /^(?:adapter|fs|fsp|promises)$/.test(n.text) || adapterAliases.has(n.text);
  }
  if (ts.isPropertyAccessExpression(n)) {
    return /^(?:adapter|promises|fs)$/.test(n.name.text) || isFsOrAdapterReceiver(n.expression, adapterAliases);
  }
  if (ts.isCallExpression(n)) {
    // e.g. Object.assign({}, adapter)
    const callee = unwrap(n.expression);
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "assign") {
      return n.arguments.some(arg => isFsOrAdapterReceiver(arg, adapterAliases));
    }
  }
  return false;
}

function exprMentionsRecovery(node, taintedVars, constStrings) {
  if (!node) return false;
  const n = unwrap(node);
  if (ts.isIdentifier(n)) {
    return taintedVars.has(n.text) || RECOVERY_TOKEN_RE.test(n.text);
  }
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
    return RECOVERY_TOKEN_RE.test(n.text);
  }
  if (ts.isTemplateExpression(n)) {
    if (RECOVERY_TOKEN_RE.test(n.head.text)) return true;
    for (const span of n.templateSpans) {
      if (RECOVERY_TOKEN_RE.test(span.literal.text) || exprMentionsRecovery(span.expression, taintedVars, constStrings)) return true;
    }
    const evaluated = evalConstString(n, constStrings);
    return evaluated !== null && RECOVERY_TOKEN_RE.test(evaluated);
  }
  if (ts.isPropertyAccessExpression(n)) {
    return RECOVERY_TOKEN_RE.test(n.name.text) || exprMentionsRecovery(n.expression, taintedVars, constStrings);
  }
  if (ts.isCallExpression(n)) {
    const callee = unwrap(n.expression);
    if (ts.isIdentifier(callee) && (RECOVERY_HELPER_RE.test(callee.text) || RECOVERY_TOKEN_RE.test(callee.text))) return true;
    if (ts.isPropertyAccessExpression(callee) && (RECOVERY_HELPER_RE.test(callee.name.text) || RECOVERY_TOKEN_RE.test(callee.name.text))) return true;
    return n.arguments.some(arg => exprMentionsRecovery(arg, taintedVars, constStrings));
  }
  if (ts.isBinaryExpression(n)) {
    return exprMentionsRecovery(n.left, taintedVars, constStrings) || exprMentionsRecovery(n.right, taintedVars, constStrings);
  }
  if (ts.isConditionalExpression(n)) {
    return exprMentionsRecovery(n.whenTrue, taintedVars, constStrings) || exprMentionsRecovery(n.whenFalse, taintedVars, constStrings);
  }
  if (ts.isElementAccessExpression(n)) {
    return exprMentionsRecovery(n.expression, taintedVars, constStrings) || exprMentionsRecovery(n.argumentExpression, taintedVars, constStrings);
  }
  return false;
}

function resolveDeleteCallee(expr, deleteAliases, adapterAliases, constStrings) {
  const n = unwrap(expr);
  if (!n) return null;
  if (ts.isPropertyAccessExpression(n)) {
    const name = n.name.text;
    if (DELETE_METHOD_NAMES.has(name) && isFsOrAdapterReceiver(n.expression, adapterAliases)) {
      return name;
    }
    if (DELETE_VERB_RE.test(name) && RECOVERY_TOKEN_RE.test(name) && name !== "canDeleteRecovery" && name !== "deleteRecoveryIfProved" && name !== "supersedeRecoveryFile" && name !== "gcSupersededRecoveries" && name !== "pruneRecoveries") {
      return name;
    }
    return null;
  }
  if (ts.isElementAccessExpression(n)) {
    if (!isFsOrAdapterReceiver(n.expression, adapterAliases)) return null;
    const key = evalConstString(n.argumentExpression, constStrings);
    if (key !== null) {
      return DELETE_METHOD_NAMES.has(key) ? key : null;
    }
    // Fail-closed: dynamic computed property access on adapter/fs with recovery arg is flagged.
    return "<dynamic-element-access>";
  }
  if (ts.isIdentifier(n)) {
    if (deleteAliases.has(n.text)) return deleteAliases.get(n.text);
    if (DELETE_METHOD_NAMES.has(n.text)) return n.text;
    if (DELETE_VERB_RE.test(n.text) && RECOVERY_TOKEN_RE.test(n.text) && n.text !== "canDeleteRecovery" && n.text !== "deleteRecoveryIfProved" && n.text !== "supersedeRecoveryFile" && n.text !== "gcSupersededRecoveries" && n.text !== "pruneRecoveries") {
      return n.text;
    }
    return null;
  }
  return null;
}

function getFunctionName(node) {
  if (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) {
    return node.name && ts.isIdentifier(node.name) ? node.name.text : "<anonymous>";
  }
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text;
  }
  return null;
}

export function scanSourceText(code, relPath) {
  const sf = ts.createSourceFile(relPath, code, ts.ScriptTarget.Latest, true, relPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings = [];

  function visitScope(node, enclosingMethod, parentTainted, parentDeleteAliases, parentAdapterAliases, parentConstStrings, parentWrappers) {
    const taintedVars = new Set(parentTainted);
    const deleteAliases = new Map(parentDeleteAliases);
    const adapterAliases = new Set(parentAdapterAliases);
    const constStrings = new Map(parentConstStrings);
    const wrapperFns = new Map(parentWrappers);

    function detectDeleteWrapper(fnNode, fnName) {
      if (!fnNode.parameters?.length) return;
      const paramIndexByName = new Map();
      fnNode.parameters.forEach((param, idx) => {
        if (ts.isIdentifier(param.name)) paramIndexByName.set(param.name.text, idx);
      });
      if (!paramIndexByName.size) return;
      const paramOps = [];
      const inspectBody = (n) => {
        if (ts.isCallExpression(n)) {
          const op = resolveDeleteCallee(n.expression, deleteAliases, adapterAliases, constStrings);
          if (op) {
            for (const arg of n.arguments) {
              const u = unwrap(arg);
              if (ts.isIdentifier(u) && paramIndexByName.has(u.text)) {
                const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
                paramOps.push({ paramIndex: paramIndexByName.get(u.text), line: line + 1, op, expr: n.getText(sf).replace(/\s+/g, " ").trim(), method: fnName });
              }
            }
          }
        }
        ts.forEachChild(n, inspectBody);
      };
      if (fnNode.body) inspectBody(fnNode.body);
      if (paramOps.length) wrapperFns.set(fnName, paramOps);
    }

    function walkNode(n) {
      const fnName = getFunctionName(n);
      if (fnName && n !== node) {
        detectDeleteWrapper(n, fnName);
        visitScope(n, fnName, taintedVars, deleteAliases, adapterAliases, constStrings, wrapperFns);
        return;
      }

      if (ts.isVariableDeclaration(n) && n.initializer) {
        const init = unwrap(n.initializer);
        if (ts.isIdentifier(n.name)) {
          const varName = n.name.text;
          const strVal = evalConstString(init, constStrings);
          if (strVal !== null) constStrings.set(varName, strVal);
          if (exprMentionsRecovery(init, taintedVars, constStrings)) taintedVars.add(varName);
          if (isFsOrAdapterReceiver(init, adapterAliases)) adapterAliases.add(varName);
          // Alias: const rm = adapter.remove | adapter['remove'] | adapter.remove.bind(adapter)
          let aliasTarget = init;
          if (ts.isCallExpression(init)) {
            const c = unwrap(init.expression);
            if (ts.isPropertyAccessExpression(c) && c.name.text === "bind") aliasTarget = unwrap(c.expression);
          }
          const resolved = resolveDeleteCallee(aliasTarget, deleteAliases, adapterAliases, constStrings);
          if (resolved) deleteAliases.set(varName, resolved);
        } else if (ts.isObjectBindingPattern(n.name) && isFsOrAdapterReceiver(init, adapterAliases)) {
          for (const el of n.name.elements) {
            const propName = el.propertyName ? (ts.isIdentifier(el.propertyName) ? el.propertyName.text : evalConstString(el.propertyName, constStrings)) : (ts.isIdentifier(el.name) ? el.name.text : null);
            if (propName && DELETE_METHOD_NAMES.has(propName) && ts.isIdentifier(el.name)) {
              deleteAliases.set(el.name.text, propName);
            }
          }
        }
      }

      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left)) {
        if (exprMentionsRecovery(n.right, taintedVars, constStrings)) taintedVars.add(n.left.text);
      }

      if (ts.isCallExpression(n)) {
        const calleeId = unwrap(n.expression);
        if (ts.isIdentifier(calleeId) && wrapperFns.has(calleeId.text)) {
          for (const entry of wrapperFns.get(calleeId.text)) {
            const arg = n.arguments[entry.paramIndex];
            if (arg && exprMentionsRecovery(arg, taintedVars, constStrings)) {
              findings.push({ file: relPath, line: entry.line, method: entry.method, op: entry.op, expr: entry.expr });
            }
          }
        }
        const op = resolveDeleteCallee(n.expression, deleteAliases, adapterAliases, constStrings);
        if (op) {
          const recoveryArg = n.arguments.some(arg => exprMentionsRecovery(arg, taintedVars, constStrings)) ||
            (DELETE_VERB_RE.test(op) && RECOVERY_TOKEN_RE.test(op)) ||
            (enclosingMethod === "pruneRecoveries" && op === "remove") ||
            (enclosingMethod === "deleteRecoveryIfProved" && op === "remove");
          if (recoveryArg) {
            const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
            const exprText = n.getText(sf).replace(/\s+/g, " ").trim();
            findings.push({ file: relPath, line: line + 1, method: enclosingMethod, op, expr: exprText });
          }
        }
      }

      ts.forEachChild(n, walkNode);
    }

    ts.forEachChild(node, walkNode);
  }

  visitScope(sf, "<top-level>", new Set(), new Map(), new Set(), new Map(), new Map());
  return findings;
}

async function walkSrc(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "acceptance-fixtures" || entry.name.endsWith("-evidence")) continue;
      out.push(...await walkSrc(full));
    } else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name) && !/(?:acceptance|fixture|\.test\.)/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export async function scanProject(projectRoot = defaultRoot) {
  const srcRoot = join(projectRoot, "src");
  const files = await walkSrc(srcRoot);
  const allFindings = [];
  for (const file of files) {
    const rel = relative(projectRoot, file).replace(/\\/g, "/");
    const code = await readFile(file, "utf8");
    allFindings.push(...scanSourceText(code, rel));
  }
  const allowKeys = new Set(ALLOWLIST.map(item => `${item.file}\u0000${item.method}\u0000${item.expr}`));
  const matchedAllowKeys = new Set();
  const violations = [];
  for (const f of allFindings) {
    const key = `${f.file}\u0000${f.method}\u0000${f.expr}`;
    if (allowKeys.has(key)) matchedAllowKeys.add(key);
    else violations.push(`${f.file}:${f.line} (${f.method}): ${f.expr}`);
  }
  const staleAllowlist = ALLOWLIST
    .filter(item => !matchedAllowKeys.has(`${item.file}\u0000${item.method}\u0000${item.expr}`))
    .map(item => `${item.file} (${item.method}): ${item.expr}`);
  return { allFindings, violations, staleAllowlist, matchedCount: matchedAllowKeys.size };
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  await run("recovery-delete-guard", async (Store, check) => {
    const project = resolve(process.argv[2] ?? defaultRoot);
    const { allFindings, violations, staleAllowlist, matchedCount } = await scanProject(project);
    console.log(`INFO recovery-delete-guard scanned call-sites (${allFindings.length}):`);
    for (const f of allFindings) console.log(`  - ${f.file}:${f.line} (${f.method}): ${f.expr}`);
    check("AST static scan: zero unguarded recovery delete/rename calls in src/**", violations, []);
    check("AST static scan: exact allowlist baseline count matches", { matchedCount, staleAllowlist }, { matchedCount: ALLOWLIST.length, staleAllowlist: [] });

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
}
