/**
 * [INPUT]: 扫描 src/** 的 TypeScript AST/符号表、src/styles/** 的 CSS 规则，并在真实 Chromium DOM 中执行生产者与计算样式运行时断言。
 * [OUTPUT]: 双轨静态校验（递归 calc 规范化数值 0.35 + 精确形态白名单 + 生产者侧 TypeChecker 规范来源解析）与运行时计算样式断言，违规则报文件:行号并退出 1。
 * [POS]: GAP-07b-3 参考层透明度单源、CSS 回退、token 生产者与运行时计算值守卫。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { runBrowser } from "./ego-harness.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const req = createRequire(join(root, "package.json"));
const ts = req("typescript");
const { build } = req("esbuild");

const TARGET_OPACITY = 0.35;
const TARGET_OPACITY_STR = "0.35";
const EPS = 1e-9;
const TOKEN_NAME = "--ms-ink-reference-opacity";
const CANONICAL_SOURCE_FILE = "src/annot/penGeometry.ts";
const CANONICAL_CONST_NAME = "INK_REFERENCE_OPACITY";
const EXPECTED_TS_COUNT = 1;
const EXPECTED_CSS_FALLBACK_COUNT = 2;
const EXPECTED_PRODUCER_COUNT = 1;
const EXPECTED_TOTAL = EXPECTED_TS_COUNT + EXPECTED_CSS_FALLBACK_COUNT + EXPECTED_PRODUCER_COUNT;
const ALLOWED_CSS_SELECTORS = new Set([".ms-ink-reference", ".ms-document-notebook-reference"]);
const EXACT_CSS_FALLBACK = `var(${TOKEN_NAME}, 0.35)`;

async function collectFiles(dir, ext) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "acceptance-fixtures") continue;
      out.push(...await collectFiles(full, ext));
    } else if (entry.isFile() && entry.name.endsWith(ext) && !/(?:acceptance|fixture|\.test\.)/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out.sort();
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, child => walk(child, visit));
}

function isTarget035(value) {
  return Number.isFinite(value) && Math.abs(value - TARGET_OPACITY) < EPS;
}

/** Extract top-level balanced `calc(...)` inner expressions (supports nested parens and nested calc()). */
function extractCalcInnerExpressions(str) {
  const results = [];
  const lower = str.toLowerCase();
  let i = 0;
  while (i < lower.length) {
    const idx = lower.indexOf("calc(", i);
    if (idx < 0) break;
    if (idx > 0 && /[\w-]/.test(lower[idx - 1])) { i = idx + 5; continue; }
    let depth = 1;
    let j = idx + 5;
    while (j < str.length && depth > 0) {
      if (str[j] === "(") depth++;
      else if (str[j] === ")") depth--;
      j++;
    }
    if (depth !== 0) {
      results.push({ inner: str.slice(idx + 5), unbalanced: true });
      break;
    }
    results.push({ inner: str.slice(idx + 5, j - 1), unbalanced: false });
    i = j;
  }
  return results;
}

/**
 * Recursive-descent evaluator for CSS calc() supporting numbers, percentages (35% -> 0.35),
 * scientific notation, + - * /, nested parentheses, and nested calc(...).
 * Returns finite number or NaN if unevaluable (e.g., var(--x)).
 */
function evalCalcExpr(expr) {
  const tokens = [];
  let pos = 0;
  while (pos < expr.length) {
    if (/\s/.test(expr[pos])) { pos++; continue; }
    if (expr.slice(pos, pos + 5).toLowerCase() === "calc(") {
      tokens.push({ type: "op", value: "(" });
      pos += 5;
      continue;
    }
    const numMatch = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(%?)/.exec(expr.slice(pos));
    if (numMatch) {
      const prev = tokens[tokens.length - 1];
      const isSignedAfterValue = (numMatch[1].startsWith("+") || numMatch[1].startsWith("-")) &&
        prev && (prev.type === "num" || (prev.type === "op" && prev.value === ")"));
      if (!isSignedAfterValue) {
        const n = Number(numMatch[1]);
        tokens.push({ type: "num", value: numMatch[2] === "%" ? n / 100 : n });
        pos += numMatch[0].length;
        continue;
      }
    }
    const ch = expr[pos];
    if ("+-*/()".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      pos++;
      continue;
    }
    return NaN;
  }
  if (!tokens.length) return NaN;
  let idx = 0;
  const peek = () => tokens[idx];
  const parseExpr = () => {
    let left = parseTerm();
    while (peek()?.type === "op" && (peek().value === "+" || peek().value === "-")) {
      const op = tokens[idx++].value;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };
  const parseTerm = () => {
    let left = parseFactor();
    while (peek()?.type === "op" && (peek().value === "*" || peek().value === "/")) {
      const op = tokens[idx++].value;
      const right = parseFactor();
      if (op === "/" && right === 0) return NaN;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  };
  const parseFactor = () => {
    const tok = peek();
    if (!tok) return NaN;
    if (tok.type === "num") { idx++; return tok.value; }
    if (tok.type === "op" && tok.value === "+") { idx++; return parseFactor(); }
    if (tok.type === "op" && tok.value === "-") { idx++; return -parseFactor(); }
    if (tok.type === "op" && tok.value === "(") {
      idx++;
      const v = parseExpr();
      if (peek()?.type !== "op" || peek().value !== ")") return NaN;
      idx++;
      return v;
    }
    return NaN;
  };
  const result = parseExpr();
  return idx === tokens.length && Number.isFinite(result) ? result : NaN;
}

function inspectCssOpacityValue(rawVal) {
  const cleaned = rawVal.replace(/\/\*[\s\S]*?\*\//g, "").replace(/!important\s*$/i, "").trim();
  const calcs = extractCalcInnerExpressions(cleaned);
  for (const item of calcs) {
    if (item.unbalanced) return { kind: "unevaluable" };
    const evaluated = evalCalcExpr(item.inner);
    if (!Number.isFinite(evaluated)) return { kind: "unevaluable" };
    if (isTarget035(evaluated)) return { kind: "target035" };
  }
  let withoutCalcs = cleaned;
  for (const item of calcs) withoutCalcs = withoutCalcs.replace(`calc(${item.inner})`, " ");
  for (const m of withoutCalcs.matchAll(/(?<![\w.])([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(%?)(?![\w.%])/g)) {
    const num = Number(m[1]);
    const normalized = m[2] === "%" ? num / 100 : num;
    if (isTarget035(normalized)) return { kind: "target035" };
  }
  return { kind: "none" };
}

function unwrapExpr(node) {
  while (node && (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  )) {
    node = node.expression;
  }
  return node;
}

function stringLiteralValue(node) {
  const expr = unwrapExpr(node);
  if (!expr) return null;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  return null;
}

function followAliasSymbol(sym, checker) {
  const seen = new Set();
  let cur = sym;
  while (cur && (cur.flags & ts.SymbolFlags.Alias) && !seen.has(cur)) {
    seen.add(cur);
    cur = checker.getAliasedSymbol(cur);
  }
  return cur;
}

function isCanonicalDeclaration(sym, baseDir) {
  if (!sym) return false;
  const decls = sym.getDeclarations() ?? [];
  return decls.some(d =>
    ts.isVariableDeclaration(d) &&
    ts.isIdentifier(d.name) &&
    d.name.text === CANONICAL_CONST_NAME &&
    relative(baseDir, d.getSourceFile().fileName).replace(/\\/g, "/") === CANONICAL_SOURCE_FILE
  );
}

function describeSymbolLocation(sym, baseDir) {
  const decl = sym?.getDeclarations()?.[0];
  if (!decl) return "unknown";
  const sf = decl.getSourceFile();
  return `${relative(baseDir, sf.fileName).replace(/\\/g, "/")}:${sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1}`;
}

function isConstVariableDeclaration(varDecl) {
  const list = varDecl.parent;
  return !!list && ts.isVariableDeclarationList(list) && Boolean(list.flags & ts.NodeFlags.Const);
}

function isUnshadowedGlobal(ident, checker, baseDir) {
  const sym = checker.getSymbolAtLocation(ident);
  if (!sym) return true;
  const decls = sym.getDeclarations() ?? [];
  return !decls.some(d => !d.getSourceFile().isDeclarationFile && resolve(d.getSourceFile().fileName).startsWith(resolve(baseDir, "src")));
}

/**
 * Resolve a runtime object expression (after stripping all type assertions/parens/non-null)
 * and look up property `key` ONLY from its true runtime module/object symbol, NEVER from an asserted type.
 */
function resolvePropertyOnRuntimeObject(objNode, key, checker, baseDir, seen) {
  const rawObj = unwrapExpr(objNode);
  if (!rawObj) return { ok: false, reason: "缺少对象表达式" };

  // Follow const alias of an object (e.g. `const M = G` or `const M = F as typeof G`)
  if (ts.isIdentifier(rawObj)) {
    const rawSym = checker.getSymbolAtLocation(rawObj);
    const targetSym = followAliasSymbol(rawSym, checker);
    const decl = targetSym?.getDeclarations()?.[0];
    if (decl && ts.isVariableDeclaration(decl) && isConstVariableDeclaration(decl) && decl.initializer && !seen.has(decl.initializer)) {
      seen.add(decl.initializer);
      return resolvePropertyOnRuntimeObject(decl.initializer, key, checker, baseDir, seen);
    }
    // True module namespace import (`import * as G from "..."`)
    if (targetSym && (targetSym.flags & ts.SymbolFlags.ValueModule)) {
      const exports = checker.getExportsOfModule(targetSym);
      const member = exports.find(s => s.name === key);
      const resolved = followAliasSymbol(member, checker);
      if (isCanonicalDeclaration(resolved, baseDir)) return { ok: true };
      return {
        ok: false,
        reason: `模块成员 ${rawObj.getText()}.${key} 解析来源为 ${describeSymbolLocation(resolved ?? targetSym, baseDir)}，非规范来源 ${CANONICAL_SOURCE_FILE}:${CANONICAL_CONST_NAME}`,
      };
    }
    return {
      ok: false,
      reason: `对象 ${rawObj.getText()} 解析来源为 ${describeSymbolLocation(targetSym, baseDir)}，非规范模块来源 ${CANONICAL_SOURCE_FILE}:${CANONICAL_CONST_NAME}`,
    };
  }

  // If rawObj is itself a property/element access (e.g. `(F.INK_REFERENCE_OPACITY as typeof G)['INK_REFERENCE_OPACITY']`),
  // report the real underlying symbol location (e.g. fakeOpacity.ts) and reject!
  if (ts.isPropertyAccessExpression(rawObj)) {
    const rawSym = followAliasSymbol(checker.getSymbolAtLocation(rawObj.name) ?? checker.getSymbolAtLocation(rawObj), checker);
    return {
      ok: false,
      reason: `类型断言掩盖底层取值 ${rawObj.getText()}（真实来源 ${describeSymbolLocation(rawSym, baseDir)}），非规范来源 ${CANONICAL_SOURCE_FILE}:${CANONICAL_CONST_NAME}`,
    };
  }

  return {
    ok: false,
    reason: `对象表达式 ${rawObj.getText()} 无法在剥离类型断言后解析到规范模块 ${CANONICAL_SOURCE_FILE}`,
  };
}

/**
 * Pure TypeChecker semantic resolver over VALUE expressions (never asserted types):
 * - Strips type assertions (`as`, `<T>`, `satisfies`), parens, `!`, `String(...)`, `Number(...)`,
 *   `.toString()`, and pure template interpolation `` `${x}` ``.
 * - Checks EVERY branch of `??`, `||`, and `cond ? a : b`.
 * - Resolves imports, re-export chains, namespace members (`G.INK_REFERENCE_OPACITY`),
 *   element access (`G["INK_REFERENCE_OPACITY"]`), destructuring aliases, and const aliases
 *   strictly against `src/annot/penGeometry.ts:INK_REFERENCE_OPACITY`.
 */
function resolveExprToCanonical(node, checker, baseDir, seen = new Set()) {
  const expr = unwrapExpr(node);
  if (!expr || seen.has(expr)) return { ok: false, reason: "缺少或循环表达式" };
  seen.add(expr);

  // 0a. String(x) / Number(x) wrapper calls
  if (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    (expr.expression.text === "String" || expr.expression.text === "Number") &&
    expr.arguments.length === 1
  ) {
    if (!isUnshadowedGlobal(expr.expression, checker, baseDir)) {
      return { ok: false, reason: `${expr.expression.text} 标识符被局部遮蔽` };
    }
    return resolveExprToCanonical(expr.arguments[0], checker, baseDir, seen);
  }

  // 0b. x.toString() wrapper call
  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    expr.expression.name.text === "toString" &&
    expr.arguments.length === 0
  ) {
    return resolveExprToCanonical(expr.expression.expression, checker, baseDir, seen);
  }

  // 0c. Pure template interpolation `${x}`
  if (
    ts.isTemplateExpression(expr) &&
    expr.head.text === "" &&
    expr.templateSpans.length === 1 &&
    expr.templateSpans[0].literal.text === ""
  ) {
    return resolveExprToCanonical(expr.templateSpans[0].expression, checker, baseDir, seen);
  }

  // 0d. Branching: x ?? y, x || y -> BOTH branches must resolve to canonical
  if (
    ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
     expr.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    const left = resolveExprToCanonical(expr.left, checker, baseDir, new Set(seen));
    if (!left.ok) return left;
    const right = resolveExprToCanonical(expr.right, checker, baseDir, new Set(seen));
    if (!right.ok) return right;
    return { ok: true };
  }

  // 0e. Conditional: cond ? a : b -> BOTH branches must resolve to canonical
  if (ts.isConditionalExpression(expr)) {
    const t = resolveExprToCanonical(expr.whenTrue, checker, baseDir, new Set(seen));
    if (!t.ok) return t;
    const f = resolveExprToCanonical(expr.whenFalse, checker, baseDir, new Set(seen));
    if (!f.ok) return f;
    return { ok: true };
  }

  // 1. Property access: e.g. G.INK_REFERENCE_OPACITY (must check runtime object, not asserted type)
  if (ts.isPropertyAccessExpression(expr)) {
    return resolvePropertyOnRuntimeObject(expr.expression, expr.name.text, checker, baseDir, seen);
  }

  // 2. Element access with static string key: e.g. G["INK_REFERENCE_OPACITY"]
  if (ts.isElementAccessExpression(expr)) {
    const key = stringLiteralValue(expr.argumentExpression);
    if (key) {
      return resolvePropertyOnRuntimeObject(expr.expression, key, checker, baseDir, seen);
    }
    return { ok: false, reason: `动态索引表达式 ${expr.getText()} 无法静态解析到规范常量` };
  }

  // 3. Identifier: direct import, renamed import, re-export chain, destructuring alias, or const alias
  if (ts.isIdentifier(expr)) {
    const rawSym = checker.getSymbolAtLocation(expr);
    if (!rawSym) return { ok: false, reason: `标识符 ${expr.text} 无法解析符号` };
    const target = followAliasSymbol(rawSym, checker);
    if (isCanonicalDeclaration(target, baseDir)) return { ok: true };

    const decl = target?.getDeclarations()?.[0];
    if (decl && ts.isBindingElement(decl)) {
      const pattern = decl.parent;
      const varDecl = pattern?.parent;
      if (ts.isObjectBindingPattern(pattern) && varDecl && ts.isVariableDeclaration(varDecl) && isConstVariableDeclaration(varDecl) && varDecl.initializer) {
        const propNameNode = decl.propertyName ?? decl.name;
        const propName = ts.isIdentifier(propNameNode) ? propNameNode.text : stringLiteralValue(propNameNode);
        if (propName) {
          return resolvePropertyOnRuntimeObject(varDecl.initializer, propName, checker, baseDir, seen);
        }
      }
    }
    if (decl && ts.isVariableDeclaration(decl) && isConstVariableDeclaration(decl) && decl.initializer) {
      const initCheck = resolveExprToCanonical(decl.initializer, checker, baseDir, seen);
      if (initCheck.ok) return { ok: true };
      return initCheck;
    }

    return {
      ok: false,
      reason: `标识符 ${expr.text} 解析来源为 ${describeSymbolLocation(target, baseDir)}（局部/参数遮蔽或非规范模块），非规范来源 ${CANONICAL_SOURCE_FILE}:${CANONICAL_CONST_NAME}`,
    };
  }

  return { ok: false, reason: `定义点写入 ${TOKEN_NAME} 禁止字面量/非常量表达式，必须引用规范常量 ${CANONICAL_CONST_NAME}` };
}

function verifyCanonicalProducerArg(node, checker, baseDir) {
  return resolveExprToCanonical(node, checker, baseDir);
}

export async function checkReferenceOpacityStatic(baseDir = root) {
  const allowedTs = [];
  const allowedCssFallback = [];
  const allowedProducers = [];
  const violations = [];

  // 1. Create TypeScript Program over src/**/*.ts for real symbol + import-chain resolution
  const tsFiles = await collectFiles(join(baseDir, "src"), ".ts");
  const program = ts.createProgram(tsFiles, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    allowJs: false,
  });
  const checker = program.getTypeChecker();

  for (const absPath of tsFiles) {
    const rel = relative(baseDir, absPath).replace(/\\/g, "/");
    const sf = program.getSourceFile(absPath);
    if (!sf) continue;
    const handledTokenNodes = new Set();

    walk(sf, node => {
      // (a) Numeric literals equal to 0.35
      if (ts.isNumericLiteral(node) && isTarget035(Number(node.text))) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const raw = node.getText(sf);
        const isAllowedConst =
          rel === CANONICAL_SOURCE_FILE &&
          raw === "0.35" &&
          ts.isVariableDeclaration(node.parent) &&
          ts.isIdentifier(node.parent.name) &&
          node.parent.name.text === CANONICAL_CONST_NAME;
        if (isAllowedConst) {
          allowedTs.push({ file: rel, line, form: `${CANONICAL_CONST_NAME} = 0.35` });
        } else {
          violations.push({ file: rel, line, text: raw, normalized: TARGET_OPACITY, reason: "归一值 0.35，非允许 TS 常量形态" });
        }
      }

      // (b) setProperty("--ms-ink-reference-opacity", X) producer calls with TypeChecker canonical resolution
      if (ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "setProperty" &&
          node.arguments.length >= 2) {
        const keyVal = stringLiteralValue(node.arguments[0]);
        if (keyVal === TOKEN_NAME) {
          handledTokenNodes.add(unwrapExpr(node.arguments[0]));
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const resolved = verifyCanonicalProducerArg(node.arguments[1], checker, baseDir);
          if (resolved.ok) {
            allowedProducers.push({ file: rel, line, form: node.getText(sf) });
          } else {
            violations.push({
              file: rel,
              line,
              text: node.getText(sf),
              reason: resolved.reason,
            });
          }
        }
      }
    });

    // (c) Any other string/template literal containing --ms-ink-reference-opacity
    walk(sf, node => {
      if (handledTokenNodes.has(node)) return;
      let text = null;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
      else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text;
      if (text !== null && text.includes(TOKEN_NAME)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        violations.push({
          file: rel,
          line,
          text: node.getText(sf),
          reason: `禁止通过 cssText/style/insertRule 或非 setProperty 常量引用路径写入 ${TOKEN_NAME}`,
        });
      }
    });
  }

  // 2. Scan CSS rules with dual-track: recursive calc + normalized 0.35 + exact whitelist form
  const cssFiles = await collectFiles(join(baseDir, "src", "styles"), ".css");
  for (const absPath of cssFiles) {
    const rel = relative(baseDir, absPath).replace(/\\/g, "/");
    const content = await readFile(absPath, "utf8");
    for (const ruleMatch of content.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectorText = ruleMatch[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
      const selectors = selectorText.split(",").map(s => s.trim()).filter(Boolean);
      const body = ruleMatch[2];
      const bodyStart = ruleMatch.index + ruleMatch[1].length + 1;
      const isDisabledOnly = selectors.length > 0 && selectors.every(s => /:disabled\b/.test(s));

      for (const declMatch of body.matchAll(/([-\w]+)\s*:\s*([^;]+)/g)) {
        const prop = declMatch[1].trim().toLowerCase();
        const val = declMatch[2].trim();
        const declStart = bodyStart + declMatch.index;
        const valStart = declStart + declMatch[0].indexOf(declMatch[2]);
        const line = content.slice(0, valStart).split("\n").length;

        if (prop === TOKEN_NAME) {
          violations.push({
            file: rel,
            line,
            text: `${prop}: ${val}`,
            reason: `禁止在 CSS 中直接定义 ${TOKEN_NAME}（必须由 TS 常量引用定义点写入）`,
          });
          continue;
        }

        if (prop.startsWith("--") && /reference|ink/i.test(prop)) {
          const check = inspectCssOpacityValue(val);
          if (check.kind === "target035" || check.kind === "unevaluable") {
            violations.push({
              file: rel,
              line,
              text: `${prop}: ${val}`,
              reason: check.kind === "unevaluable" ? "不可判定 calc() 表达式（保守拒绝）" : "归一值 0.35，禁止 CSS 变量赋值形态",
            });
          }
          continue;
        }

        if (prop !== "opacity") continue;
        if (isDisabledOnly) continue;

        const check = inspectCssOpacityValue(val);
        if (check.kind === "none") continue;
        if (check.kind === "unevaluable") {
          violations.push({
            file: rel,
            line,
            text: `${selectorText} { opacity: ${val} }`,
            reason: "不可判定 calc() 表达式（保守拒绝）",
          });
          continue;
        }

        const isAllowedFallback =
          rel === "src/styles/styles-reader.css" &&
          selectors.length === 1 &&
          ALLOWED_CSS_SELECTORS.has(selectors[0]) &&
          val === EXACT_CSS_FALLBACK;

        if (isAllowedFallback) {
          allowedCssFallback.push({ file: rel, line, selector: selectors[0], form: `opacity: ${val}` });
        } else {
          violations.push({
            file: rel,
            line,
            text: `${selectorText} { opacity: ${val} }`,
            normalized: TARGET_OPACITY,
            reason: `归一值 0.35，非精确白名单形态 opacity: ${EXACT_CSS_FALLBACK}`,
          });
        }
      }
    }
  }

  const total = allowedTs.length + allowedCssFallback.length + allowedProducers.length;
  const countOk =
    allowedTs.length === EXPECTED_TS_COUNT &&
    allowedCssFallback.length === EXPECTED_CSS_FALLBACK_COUNT &&
    allowedProducers.length === EXPECTED_PRODUCER_COUNT &&
    total === EXPECTED_TOTAL;

  return {
    passed: violations.length === 0 && countOk,
    expected: { ts: EXPECTED_TS_COUNT, cssFallback: EXPECTED_CSS_FALLBACK_COUNT, producer: EXPECTED_PRODUCER_COUNT, total: EXPECTED_TOTAL },
    actual: { ts: allowedTs.length, cssFallback: allowedCssFallback.length, producer: allowedProducers.length, total },
    allowedTs,
    allowedCssFallback,
    allowedProducers,
    violations,
  };
}

/**
 * Runtime real-DOM assertion in Chromium:
 * Bundles BaseAnnotationController + INK_REFERENCE_OPACITY from baseDir, runs the real
 * syncReferenceOpacityToken() producer, and verifies computed opacity on both reference classes
 * and --ms-ink-reference-opacity on documentElement match both "0.35" (independent truth) and String(INK_REFERENCE_OPACITY).
 */
export async function checkReferenceOpacityRuntime(baseDir = root) {
  const temp = await mkdtemp(join(tmpdir(), "marginstudy-ref-opacity-rt-"));
  const obsidianStub = join(temp, "obsidian.ts");
  const entryTs = join(temp, "probe.ts");
  const bundleJs = join(temp, "probe.js");
  const htmlFile = join(temp, "index.html");
  await writeFile(obsidianStub, `
    export class App {}
    export class TFile {}
    export class TFolder {}
    export class Notice {}
    export class Menu { addItem() { return this; } showAtMouseEvent() {} }
    export class Component {}
    export class ItemView {}
    export class WorkspaceLeaf {}
    export class Modal {}
    export class Plugin {}
    export class PluginSettingTab {}
    export class Setting {}
    export const Platform = { isMobile: false, isDesktop: true, isMacOS: true };
    export function setIcon() {}
    export function sanitizeHTMLToDom(s: string) { const d = document.createElement("div"); d.innerHTML = s; return d; }
    export const MarkdownRenderer = { render: async () => {} };
  `);
  await writeFile(entryTs, `
    import { BaseAnnotationController } from ${JSON.stringify(join(baseDir, "src/annot/baseController.ts"))};
    import { INK_REFERENCE_OPACITY } from ${JSON.stringify(join(baseDir, "src/annot/penGeometry.ts"))};
    try {
      const inkEl = document.createElement("div");
      inkEl.className = "ms-ink-reference";
      const nbEl = document.createElement("div");
      nbEl.className = "ms-document-notebook-reference";
      document.body.append(inkEl, nbEl);

      // 1. Before producer runs (token absent): CSS fallback must compute 0.35
      const fallbackInk = getComputedStyle(inkEl).opacity;
      const fallbackNb = getComputedStyle(nbEl).opacity;

      // 2. Run the real BaseAnnotationController producer method
      (BaseAnnotationController.prototype as any).syncReferenceOpacityToken.call({});
      const tokenVal = getComputedStyle(document.documentElement).getPropertyValue("${TOKEN_NAME}").trim();
      const liveInk = getComputedStyle(inkEl).opacity;
      const liveNb = getComputedStyle(nbEl).opacity;

      (window as any).__probe = {
        constVal: String(INK_REFERENCE_OPACITY),
        tokenVal,
        liveInk,
        liveNb,
        fallbackInk,
        fallbackNb,
      };
    } catch (e) {
      (window as any).__probe = { error: String(e) };
    }
    (window as any).__done = true;
  `);
  await writeFile(htmlFile, '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/reader.css"></head><body><script type="module" src="/probe.js"></script></body></html>');

  let server;
  const session = `marginstudy-ref-op-${process.pid}-${Date.now()}`;
  try {
    await build({
      entryPoints: [entryTs],
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "chrome120",
      nodePaths: [join(root, "node_modules")],
      outfile: bundleJs,
      plugins: [{
        name: "synthetic-host",
        setup(b) {
          b.onResolve({ filter: /^obsidian$/ }, () => ({ path: obsidianStub }));
          b.onResolve({ filter: /^(?:node:)?(?:http|https|fs|path|crypto|child_process|os|url|stream|zlib)$/ }, args => ({ path: args.path, namespace: "empty-node" }));
          b.onLoad({ filter: /.*/, namespace: "empty-node" }, () => ({ contents: "export default {}; export const request = () => {}; export const createServer = () => {}; export const randomBytes = () => ({ toString: () => '' });" }));
        },
      }],
    });
    const cssText = await readFile(join(baseDir, "src/styles/styles-reader.css"), "utf8");
    const jsText = await readFile(bundleJs, "utf8");
    const htmlText = await readFile(htmlFile, "utf8");
    server = createServer((req, res) => {
      const path = new URL(req.url, "http://127.0.0.1").pathname;
      if (path === "/probe.js") { res.setHeader("Content-Type", "text/javascript"); res.end(jsText); return; }
      if (path === "/reader.css") { res.setHeader("Content-Type", "text/css"); res.end(cssText); return; }
      res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(htmlText);
    });
    await new Promise(done => server.listen(0, "127.0.0.1", done));
    const port = server.address().port;
    await runBrowser(session, "open", `http://127.0.0.1:${port}/`);
    await runBrowser(session, "wait", "--fn", "window.__done === true");
    const probe = JSON.parse((await runBrowser(session, "eval", "window.__probe")).stdout);
    const errors = [];
    if (probe.error) errors.push(`runtime probe threw: ${probe.error}`);
    else {
      if (probe.constVal !== TARGET_OPACITY_STR) errors.push(`INK_REFERENCE_OPACITY=${probe.constVal} !== ${TARGET_OPACITY_STR}`);
      if (probe.tokenVal !== TARGET_OPACITY_STR || probe.tokenVal !== probe.constVal) errors.push(`documentElement ${TOKEN_NAME}=${JSON.stringify(probe.tokenVal)} !== ${TARGET_OPACITY_STR} / const=${probe.constVal}`);
      if (probe.liveInk !== TARGET_OPACITY_STR || probe.liveInk !== probe.constVal) errors.push(`.ms-ink-reference computed opacity=${probe.liveInk} !== ${TARGET_OPACITY_STR} / const=${probe.constVal}`);
      if (probe.liveNb !== TARGET_OPACITY_STR || probe.liveNb !== probe.constVal) errors.push(`.ms-document-notebook-reference computed opacity=${probe.liveNb} !== ${TARGET_OPACITY_STR} / const=${probe.constVal}`);
      if (probe.fallbackInk !== TARGET_OPACITY_STR) errors.push(`.ms-ink-reference fallback opacity=${probe.fallbackInk} !== ${TARGET_OPACITY_STR}`);
      if (probe.fallbackNb !== TARGET_OPACITY_STR) errors.push(`.ms-document-notebook-reference fallback opacity=${probe.fallbackNb} !== ${TARGET_OPACITY_STR}`);
    }
    return { passed: errors.length === 0, probe, errors };
  } finally {
    await runBrowser(session, "close").catch(() => {});
    if (server) await new Promise(done => server.close(done));
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const staticOnly = args.includes("--static-only");
  const runtimeOnly = args.includes("--runtime-only");
  const dirArg = args.find(a => !a.startsWith("--"));
  const targetDir = dirArg ? resolve(dirArg) : root;

  let failed = false;
  if (!runtimeOnly) {
    const result = await checkReferenceOpacityStatic(targetDir);
    console.log("reference-opacity-guard(static):", JSON.stringify(result));
    if (!result.passed) {
      failed = true;
      for (const v of result.violations) {
        console.error(`FAIL reference-opacity-guard ${v.file}:${v.line} (${v.reason}): ${v.text}`);
      }
      if (result.actual.total !== result.expected.total ||
          result.actual.ts !== result.expected.ts ||
          result.actual.cssFallback !== result.expected.cssFallback ||
          result.actual.producer !== result.expected.producer) {
        console.error(`FAIL reference-opacity-guard baseline mismatch: actual=${JSON.stringify(result.actual)} expected=${JSON.stringify(result.expected)}`);
      }
    } else {
      console.log(`PASS reference-opacity-guard(static) (${result.actual.ts} TS + ${result.actual.cssFallback} CSS fallback + ${result.actual.producer} producer = ${result.actual.total}, 0 violations)`);
    }
  }
  if (!staticOnly) {
    const rt = await checkReferenceOpacityRuntime(targetDir);
    console.log("reference-opacity-guard(runtime):", JSON.stringify(rt));
    if (!rt.passed) {
      failed = true;
      for (const e of rt.errors) console.error(`FAIL reference-opacity-guard(runtime): ${e}`);
    } else {
      console.log(`PASS reference-opacity-guard(runtime) (token=${rt.probe.tokenVal}, ink=${rt.probe.liveInk}, notebook=${rt.probe.liveNb}, fallback=${rt.probe.fallbackInk}/${rt.probe.fallbackNb})`);
    }
  }
  if (failed) process.exit(1);
}
