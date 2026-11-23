/**
 * [INPUT]: src/ 生产源码（经 TypeScript AST 解析）与内存编译的 Store 实例。
 * [OUTPUT]: 恢复文件删除 AST 静态扫描（精确调用点出现次数基线清单）与运行时证明-目标绑定哨兵断言结果。
 * [POS]: 强制收口所有批注恢复文件删除至 canDeleteRecovery/deleteRecoveryIfProved 单一闸门，杜绝间接调用/动态导入/重复白名单绕过。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createHash } from "node:crypto";
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
const FS_MODULE_RE = /^(?:node:)?fs(?:\/promises)?$/;

/**
 * Exact call-site allowlist: { file, method, expr, reason }.
 * Method-level or file-level exemptions are strictly forbidden.
 * Every occurrence is counted; duplicating an allowlisted call site is rejected.
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
    expr: "adapter.remove?.(targetSidecar)",
    reason: "Deletes partially-written document sidecar on rollback after recomputing sidecarPath(docPath) and asserting non-recovery + invalid half-write.",
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
    } else if (ts.isBinaryExpression(cur) && cur.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      cur = cur.right;
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

function isFsModuleImportCall(node, constStrings) {
  const n = unwrap(node);
  if (!n || !ts.isCallExpression(n) || !n.arguments.length) return false;
  const isDynamicImport = n.expression.kind === ts.SyntaxKind.ImportKeyword;
  const callee = unwrap(n.expression);
  const isRequire = ts.isIdentifier(callee) && callee.text === "require";
  if (!isDynamicImport && !isRequire) return false;
  const spec = evalConstString(n.arguments[0], constStrings);
  return spec !== null && FS_MODULE_RE.test(spec);
}

function isFsOrAdapterReceiver(node, adapterAliases, constStrings) {
  const n = unwrap(node);
  if (!n) return false;
  if (ts.isAwaitExpression(n)) {
    return isFsOrAdapterReceiver(n.expression, adapterAliases, constStrings);
  }
  if (isFsModuleImportCall(n, constStrings)) {
    return true;
  }
  if (ts.isIdentifier(n)) {
    return /^(?:adapter|fs|fsp|promises)$/.test(n.text) || adapterAliases.has(n.text);
  }
  if (ts.isPropertyAccessExpression(n)) {
    return /^(?:adapter|promises|fs)$/.test(n.name.text) || isFsOrAdapterReceiver(n.expression, adapterAliases, constStrings);
  }
  if (ts.isCallExpression(n)) {
    // e.g. Object.assign({}, adapter)
    const callee = unwrap(n.expression);
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "assign") {
      return n.arguments.some(arg => isFsOrAdapterReceiver(arg, adapterAliases, constStrings));
    }
  }
  return false;
}

function exprMentionsRecovery(node, taintedVars, constStrings) {
  if (!node) return false;
  const n = unwrap(node);
  if (ts.isAwaitExpression(n) || ts.isSpreadElement(n)) {
    return exprMentionsRecovery(n.expression, taintedVars, constStrings);
  }
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
  if (ts.isArrayLiteralExpression(n)) {
    return n.elements.some(el => exprMentionsRecovery(el, taintedVars, constStrings));
  }
  if (ts.isObjectLiteralExpression(n)) {
    return n.properties.some(prop => {
      if (ts.isPropertyAssignment(prop)) return exprMentionsRecovery(prop.initializer, taintedVars, constStrings);
      if (ts.isShorthandPropertyAssignment(prop)) return exprMentionsRecovery(prop.name, taintedVars, constStrings);
      if (ts.isSpreadAssignment(prop)) return exprMentionsRecovery(prop.expression, taintedVars, constStrings);
      return false;
    });
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
  if (ts.isCallExpression(n)) {
    // Handle fn.bind(...) and Function.prototype.call.bind(adapter.remove) / Reflect.apply.bind(null, adapter.remove)
    const callee = unwrap(n.expression);
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "bind") {
      const boundDirect = resolveDeleteCallee(callee.expression, deleteAliases, adapterAliases, constStrings);
      if (boundDirect) return boundDirect;
      const target = unwrap(callee.expression);
      if (ts.isPropertyAccessExpression(target) && (target.name.text === "call" || target.name.text === "apply")) {
        for (const arg of n.arguments) {
          const boundTarget = resolveDeleteCallee(arg, deleteAliases, adapterAliases, constStrings);
          if (boundTarget) return boundTarget;
        }
      }
    }
    return null;
  }
  if (ts.isPropertyAccessExpression(n)) {
    const name = n.name.text;
    if (name === "call" || name === "apply") {
      const indirect = resolveDeleteCallee(n.expression, deleteAliases, adapterAliases, constStrings);
      if (indirect) return indirect;
    }
    if (DELETE_METHOD_NAMES.has(name) && isFsOrAdapterReceiver(n.expression, adapterAliases, constStrings)) {
      return name;
    }
    if (DELETE_VERB_RE.test(name) && RECOVERY_TOKEN_RE.test(name) && name !== "canDeleteRecovery" && name !== "deleteRecoveryIfProved" && name !== "supersedeRecoveryFile" && name !== "gcSupersededRecoveries" && name !== "pruneRecoveries") {
      return name;
    }
    return null;
  }
  if (ts.isElementAccessExpression(n)) {
    if (!isFsOrAdapterReceiver(n.expression, adapterAliases, constStrings)) return null;
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

      if (ts.isImportDeclaration(n) && n.importClause && ts.isStringLiteral(n.moduleSpecifier) && FS_MODULE_RE.test(n.moduleSpecifier.text)) {
        if (n.importClause.name) adapterAliases.add(n.importClause.name.text);
        const bindings = n.importClause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          adapterAliases.add(bindings.name.text);
        } else if (bindings && ts.isNamedImports(bindings)) {
          for (const spec of bindings.elements) {
            const imported = spec.propertyName ? spec.propertyName.text : spec.name.text;
            if (DELETE_METHOD_NAMES.has(imported)) deleteAliases.set(spec.name.text, imported);
          }
        }
      }

      if (ts.isVariableDeclaration(n) && n.initializer) {
        const init = unwrap(n.initializer);
        if (ts.isIdentifier(n.name)) {
          const varName = n.name.text;
          const strVal = evalConstString(init, constStrings);
          if (strVal !== null) constStrings.set(varName, strVal);
          if (exprMentionsRecovery(init, taintedVars, constStrings)) taintedVars.add(varName);
          if (isFsOrAdapterReceiver(init, adapterAliases, constStrings)) adapterAliases.add(varName);
          const resolved = resolveDeleteCallee(init, deleteAliases, adapterAliases, constStrings);
          if (resolved) deleteAliases.set(varName, resolved);
        } else if (ts.isObjectBindingPattern(n.name) && isFsOrAdapterReceiver(init, adapterAliases, constStrings)) {
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
        const callee = unwrap(n.expression);

        // Dynamic import('node:fs').then(m => m.unlink(p)) or modPromise.then(({ unlink }) => unlink(p))
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === "then" &&
          isFsOrAdapterReceiver(callee.expression, adapterAliases, constStrings) && n.arguments.length >= 1) {
          const cb = unwrap(n.arguments[0]);
          if (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) {
            const cbAdapterAliases = new Set(adapterAliases);
            const cbDeleteAliases = new Map(deleteAliases);
            const firstParam = cb.parameters[0];
            if (firstParam) {
              if (ts.isIdentifier(firstParam.name)) {
                cbAdapterAliases.add(firstParam.name.text);
              } else if (ts.isObjectBindingPattern(firstParam.name)) {
                for (const el of firstParam.name.elements) {
                  const propName = el.propertyName ? (ts.isIdentifier(el.propertyName) ? el.propertyName.text : evalConstString(el.propertyName, constStrings)) : (ts.isIdentifier(el.name) ? el.name.text : null);
                  if (propName && DELETE_METHOD_NAMES.has(propName) && ts.isIdentifier(el.name)) {
                    cbDeleteAliases.set(el.name.text, propName);
                  }
                }
              }
            }
            walkNode(callee.expression);
            visitScope(cb, enclosingMethod, taintedVars, cbDeleteAliases, cbAdapterAliases, constStrings, wrapperFns);
            for (let i = 1; i < n.arguments.length; i++) walkNode(n.arguments[i]);
            return;
          }
        }

        // Reflect.apply(adapter.remove, adapter, [p])
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === "apply" &&
          ts.isIdentifier(unwrap(callee.expression)) && unwrap(callee.expression).text === "Reflect" &&
          n.arguments.length >= 1) {
          const op = resolveDeleteCallee(n.arguments[0], deleteAliases, adapterAliases, constStrings);
          if (op) {
            const recoveryArg = n.arguments.slice(1).some(arg => exprMentionsRecovery(arg, taintedVars, constStrings));
            if (recoveryArg) {
              const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
              const exprText = n.getText(sf).replace(/\s+/g, " ").trim();
              findings.push({ file: relPath, line: line + 1, method: enclosingMethod, op, expr: exprText });
            }
          }
        }

        if (ts.isIdentifier(callee) && wrapperFns.has(callee.text)) {
          for (const entry of wrapperFns.get(callee.text)) {
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
  const expectedCounts = new Map();
  for (const item of ALLOWLIST) {
    const key = `${item.file}\u0000${item.method}\u0000${item.expr}`;
    expectedCounts.set(key, (expectedCounts.get(key) ?? 0) + 1);
  }
  const seenCounts = new Map();
  const violations = [];
  let matchedCount = 0;
  for (const f of allFindings) {
    const key = `${f.file}\u0000${f.method}\u0000${f.expr}`;
    const limit = expectedCounts.get(key) ?? 0;
    const next = (seenCounts.get(key) ?? 0) + 1;
    seenCounts.set(key, next);
    if (limit > 0 && next <= limit) {
      matchedCount++;
    } else if (limit > 0) {
      violations.push(`DUPLICATE ALLOWLIST (${next}/${limit}): ${f.file}:${f.line} (${f.method}): ${f.expr}`);
    } else {
      violations.push(`${f.file}:${f.line} (${f.method}): ${f.expr}`);
    }
  }
  const staleAllowlist = [];
  for (const item of ALLOWLIST) {
    const key = `${item.file}\u0000${item.method}\u0000${item.expr}`;
    if ((seenCounts.get(key) ?? 0) < (expectedCounts.get(key) ?? 0)) {
      staleAllowlist.push(`${item.file} (${item.method}): ${item.expr}`);
    }
  }
  return { allFindings, violations, staleAllowlist, matchedCount };
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  await run("recovery-delete-guard", async (Store, check) => {
    const project = resolve(process.argv[2] ?? defaultRoot);
    const { allFindings, violations, staleAllowlist, matchedCount } = await scanProject(project);
    console.log(`INFO recovery-delete-guard scanned call-sites (${allFindings.length}):`);
    for (const f of allFindings) console.log(`  - ${f.file}:${f.line} (${f.method}): ${f.expr}`);
    check("AST static scan: zero unguarded or duplicated recovery delete/rename calls in src/**", violations, []);
    check(
      "AST static scan: exact allowlist occurrence count matches",
      { totalFindings: allFindings.length, matchedCount, staleAllowlist },
      { totalFindings: ALLOWLIST.length, matchedCount: ALLOWLIST.length, staleAllowlist: [] },
    );

    // Runtime sentinel: wrap adapter.remove and assert every annotation recovery deletion
    // is bound to an exact { path, contentDigest, proofTxId } proof record matching the file on disk.
    const env = memoryVault(Store);
    const isAnnotationRecovery = (file) =>
      /^_marginstudy-recovery\/(?:pending-annotations-|pending-merge-tx-)/.test(file);
    let lastProofIdx = Store.recoveryDeleteProofLog.length;
    const verifiedProofs = [];
    const bindingViolations = [];
    const origRemove = env.adapter.remove;
    env.adapter.remove = async (file) => {
      if (isAnnotationRecovery(file)) {
        const rawBefore = env.disk.get(file);
        const actualDigest = typeof rawBefore === "string" ? sha256(rawBefore) : null;
        let actualTxId = null;
        if (typeof rawBefore === "string") {
          try {
            const parsed = JSON.parse(rawBefore);
            actualTxId =
              (typeof parsed?.txId === "string" && parsed.txId) ? parsed.txId :
              (typeof parsed?.contentDigest === "string" && parsed.contentDigest) ? parsed.contentDigest :
              actualDigest;
          } catch { actualTxId = null; }
        }
        const newProofs = Store.recoveryDeleteProofLog.slice(lastProofIdx);
        lastProofIdx = Store.recoveryDeleteProofLog.length;
        if (newProofs.length !== 1) {
          bindingViolations.push({ file, reason: "missing-or-ambiguous-proof", count: newProofs.length });
        } else {
          const proof = newProofs[0];
          const pathMatch = proof.path === file;
          const digestMatch = actualDigest !== null && proof.contentDigest === actualDigest;
          const txMatch = actualTxId !== null && typeof proof.proofTxId === "string" && proof.proofTxId.length > 0 && proof.proofTxId === actualTxId;
          if (!pathMatch || !digestMatch || !txMatch) {
            bindingViolations.push({ file, proof, actualDigest, actualTxId, pathMatch, digestMatch, txMatch });
          } else {
            verifiedProofs.push({ path: proof.path, contentDigest: proof.contentDigest, proofTxId: proof.proofTxId });
          }
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

    check("runtime sentinel: every annotation recovery deletion has exact {path, contentDigest, proofTxId} proof binding", bindingViolations, []);
    check("runtime sentinel: observed proved deletions across merge-tx and tombstone flows", verifiedProofs.length >= 2, true);
  });
}
