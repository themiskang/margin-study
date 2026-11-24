/**
 * [INPUT]: 扫描 src/** 的 TypeScript AST/符号表、src/styles/** 的 CSS 规则（含嵌套 @media/@supports），并在真实 Chromium DOM 中遍历全部参考元素断言计算透明度。
 * [OUTPUT]: 参考层选择器族覆盖 + 递归 calc 规范化数值 0.35 + TypeChecker 值表达式符号解析 + 真实 DOM 全集运行时断言，违规则报文件:行号/选择器/元素并退出 1。
 * [POS]: GAP-07b-3 参考层透明度单源、CSS 回退、token 生产者与运行时全集守卫。
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
const CANONICAL_FN_NAME = "inkLayerOpacity";
const EXPECTED_TS_COUNT = 1;
const EXPECTED_CSS_FALLBACK_COUNT = 2;
const EXPECTED_PRODUCER_COUNT = 1;
const EXPECTED_CANVAS_PRODUCER_COUNT = 1;
const EXPECTED_TOTAL = EXPECTED_TS_COUNT + EXPECTED_CSS_FALLBACK_COUNT + EXPECTED_PRODUCER_COUNT + EXPECTED_CANVAS_PRODUCER_COUNT;
const ALLOWED_CSS_SELECTORS = new Set([".ms-ink-reference", ".ms-document-notebook-reference"]);
const EXACT_CSS_FALLBACK = `var(${TOKEN_NAME}, 0.35)`;

/**
 * 生产代码 7 处参考态渲染路径反推的参考层选择器族清单（含容器与子元素类名 + 来源文件:行号）：
 * 1. .ms-ink-reference                (src/annot/baseController.ts:1142, src/pdf/annotationLayer.ts:694,720, src/word/htmlAnnot.ts:715)
 * 2. .ms-document-notebook-reference  (src/annot/baseController.ts:526, src/pdf/annotationLayer.ts:695,721,810, src/word/htmlAnnot.ts:601)
 * 3. [data-ms-reference*] / [data-ms-ink-reference*] (src/annot/baseController.ts:1749)
 * 4. .ms-html-reference-range / .ms-html-reference-segment (src/word/htmlAnnot.ts:601,680)
 * 5. .ms-ann-region                   (src/pdf/annotationLayer.ts:849, src/word/htmlAnnot.ts:731,738)
 * 6. .ms-ann-voice                    (src/pdf/annotationLayer.ts:827, src/word/htmlAnnot.ts:694)
 * 7. .ms-ann-pen                      (src/word/htmlAnnot.ts:710)
 * 8. .ms-ann-dot                      (src/pdf/annotationLayer.ts:892)
 * 9. .ms-ink-recall-mask              (src/annot/baseController.ts:539)
 * 10. .ms-free-overlay-image / .ms-free-overlay-text (src/annot/overlay.ts:59,61)
 */
const REFERENCE_SELECTOR_FAMILY = [
  { name: ".ms-ink-reference", pattern: /\.ms-ink-reference(?![\w-])/, source: "src/annot/baseController.ts:1142, src/pdf/annotationLayer.ts:694,720, src/word/htmlAnnot.ts:715" },
  { name: ".ms-document-notebook-reference", pattern: /\.ms-document-notebook-reference(?![\w-])/, source: "src/annot/baseController.ts:526, src/pdf/annotationLayer.ts:695,721,810, src/word/htmlAnnot.ts:601" },
  { name: "[data-ms-(ink-)reference]", pattern: /\[data-ms-(?:ink-)?reference[^\]]*\]/, source: "src/annot/baseController.ts:1749" },
  { name: ".ms-html-reference-range/.ms-html-reference-segment", pattern: /\.ms-html-reference-(?:range|segment)(?![\w-])/, source: "src/word/htmlAnnot.ts:601,680" },
  { name: ".ms-ann-region", pattern: /\.ms-ann-region(?![\w-])/, source: "src/pdf/annotationLayer.ts:849, src/word/htmlAnnot.ts:731,738" },
  { name: ".ms-ann-voice", pattern: /\.ms-ann-voice(?![\w-])/, source: "src/pdf/annotationLayer.ts:827, src/word/htmlAnnot.ts:694" },
  { name: ".ms-ann-pen", pattern: /\.ms-ann-pen(?![\w-])/, source: "src/word/htmlAnnot.ts:710" },
  { name: ".ms-ann-dot", pattern: /\.ms-ann-dot(?![\w-])/, source: "src/pdf/annotationLayer.ts:892" },
  { name: ".ms-ink-recall-mask", pattern: /\.ms-ink-recall-mask(?![\w-])/, source: "src/annot/baseController.ts:539" },
  { name: ".ms-free-overlay-image/.ms-free-overlay-text", pattern: /\.ms-free-overlay-(?:image|text)(?![\w-])/, source: "src/annot/overlay.ts:59,61" },
];

/** 参考态种类注册表（双向包含校验：运行时发现集合必须与注册表完全相等）。 */
export const EXPECTED_REFERENCE_KINDS = [
  "ink",
  "document-notebook",
  "overlay-image",
  "overlay-text",
  "notebook-ink-image",
  "recall-mask",
  "html-range",
  "region-excerpt",
];

const REFERENCE_CLASS_PROBE_QUERY = [
  ".ms-ink-reference",
  ".ms-document-notebook-reference",
  ".ms-html-reference-range",
].join(", ");

function matchesReferenceSelectorFamily(selector) {
  return REFERENCE_SELECTOR_FAMILY.some(entry => entry.pattern.test(selector));
}

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

/**
 * Brace-aware CSS rule parser supporting nested @media / @supports / @layer / @container blocks.
 * Returns flat list of style rules: { selectorText, selectors, body, bodyStart, atRule }.
 */
function parseCssStyleRules(cssText) {
  const rules = [];
  const len = cssText.length;

  function skipComment(pos) {
    if (cssText[pos] === "/" && cssText[pos + 1] === "*") {
      const end = cssText.indexOf("*/", pos + 2);
      return end < 0 ? len : end + 2;
    }
    return pos;
  }

  function findMatchingBrace(openPos) {
    let depth = 1;
    let i = openPos + 1;
    while (i < len && depth > 0) {
      if (cssText[i] === "/" && cssText[i + 1] === "*") { i = skipComment(i); continue; }
      if (cssText[i] === '"' || cssText[i] === "'") {
        const q = cssText[i++];
        while (i < len && cssText[i] !== q) { if (cssText[i] === "\\") i++; i++; }
        i++;
        continue;
      }
      if (cssText[i] === "{") depth++;
      else if (cssText[i] === "}") depth--;
      i++;
    }
    return i - 1;
  }

  function parseBlock(start, end, atRule) {
    let i = start;
    while (i < end) {
      while (i < end) {
        if (/\s/.test(cssText[i])) { i++; continue; }
        if (cssText[i] === "/" && cssText[i + 1] === "*") { i = skipComment(i); continue; }
        break;
      }
      if (i >= end) break;
      const headerStart = i;
      while (i < end && cssText[i] !== "{" && cssText[i] !== ";") {
        if (cssText[i] === "/" && cssText[i + 1] === "*") { i = skipComment(i); continue; }
        if (cssText[i] === '"' || cssText[i] === "'") {
          const q = cssText[i++];
          while (i < end && cssText[i] !== q) { if (cssText[i] === "\\") i++; i++; }
          i++;
          continue;
        }
        i++;
      }
      if (i >= end) break;
      if (cssText[i] === ";") { i++; continue; }
      const header = cssText.slice(headerStart, i).replace(/\/\*[\s\S]*?\*\//g, "").trim();
      const closePos = findMatchingBrace(i);
      const bodyStart = i + 1;
      if (header.startsWith("@")) {
        // Container at-rules (@media, @supports, @layer, @container, @document) contain nested style rules
        if (/^@(?:media|supports|layer|container|document|scope)\b/i.test(header)) {
          parseBlock(bodyStart, closePos, atRule ? `${atRule} > ${header}` : header);
        }
      } else if (header) {
        const selectors = header.split(",").map(s => s.trim()).filter(Boolean);
        rules.push({
          selectorText: header,
          selectors,
          body: cssText.slice(bodyStart, closePos),
          bodyStart,
          atRule,
        });
      }
      i = closePos + 1;
    }
  }

  parseBlock(0, len, null);
  return rules;
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

function resolvePropertyOnRuntimeObject(objNode, key, checker, baseDir, seen) {
  const rawObj = unwrapExpr(objNode);
  if (!rawObj) return { ok: false, reason: "缺少对象表达式" };

  if (ts.isIdentifier(rawObj)) {
    const rawSym = checker.getSymbolAtLocation(rawObj);
    const targetSym = followAliasSymbol(rawSym, checker);
    const decl = targetSym?.getDeclarations()?.[0];
    if (decl && ts.isVariableDeclaration(decl) && isConstVariableDeclaration(decl) && decl.initializer && !seen.has(decl.initializer)) {
      seen.add(decl.initializer);
      return resolvePropertyOnRuntimeObject(decl.initializer, key, checker, baseDir, seen);
    }
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

function resolveExprToCanonical(node, checker, baseDir, seen = new Set()) {
  const expr = unwrapExpr(node);
  if (!expr || seen.has(expr)) return { ok: false, reason: "缺少或循环表达式" };
  seen.add(expr);

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

  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    expr.expression.name.text === "toString" &&
    expr.arguments.length === 0
  ) {
    return resolveExprToCanonical(expr.expression.expression, checker, baseDir, seen);
  }

  if (
    ts.isTemplateExpression(expr) &&
    expr.head.text === "" &&
    expr.templateSpans.length === 1 &&
    expr.templateSpans[0].literal.text === ""
  ) {
    return resolveExprToCanonical(expr.templateSpans[0].expression, checker, baseDir, seen);
  }

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

  if (ts.isConditionalExpression(expr)) {
    const t = resolveExprToCanonical(expr.whenTrue, checker, baseDir, new Set(seen));
    if (!t.ok) return t;
    const f = resolveExprToCanonical(expr.whenFalse, checker, baseDir, new Set(seen));
    if (!f.ok) return f;
    return { ok: true };
  }

  if (ts.isPropertyAccessExpression(expr)) {
    return resolvePropertyOnRuntimeObject(expr.expression, expr.name.text, checker, baseDir, seen);
  }

  if (ts.isElementAccessExpression(expr)) {
    const key = stringLiteralValue(expr.argumentExpression);
    if (key) {
      return resolvePropertyOnRuntimeObject(expr.expression, key, checker, baseDir, seen);
    }
    return { ok: false, reason: `动态索引表达式 ${expr.getText()} 无法静态解析到规范常量` };
  }

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

function isCanonicalFunctionDeclaration(sym, baseDir) {
  if (!sym) return false;
  const decls = sym.getDeclarations() ?? [];
  return decls.some(d =>
    ts.isFunctionDeclaration(d) &&
    d.name?.text === CANONICAL_FN_NAME &&
    relative(baseDir, d.getSourceFile().fileName).replace(/\\/g, "/") === CANONICAL_SOURCE_FILE
  );
}

function enclosingFunctionHasReferenceParam(node) {
  let cur = node.parent;
  while (cur) {
    if (ts.isFunctionLike(cur)) {
      return cur.parameters.some(p => ts.isIdentifier(p.name) && /reference/i.test(p.name.text));
    }
    cur = cur.parent;
  }
  return false;
}

/**
 * Verify a reference-path `context.globalAlpha = RHS` assignment:
 * - RHS must invoke the canonical `inkLayerOpacity(...)` from `src/annot/penGeometry.ts`
 * - RHS must not contain a bare literal (e.g. `globalAlpha = 0.35`, `globalAlpha = 0.5`) or a `reference ? <literal> : ...` bypass
 */
function verifyCanvasGlobalAlphaRhs(rhs, checker, baseDir) {
  let hasCanonicalCall = false;
  let bypassDetail = null;
  walk(rhs, child => {
    if (ts.isCallExpression(child)) {
      const callee = unwrapExpr(child.expression);
      const rawSym = ts.isPropertyAccessExpression(callee)
        ? (checker.getSymbolAtLocation(callee.name) ?? checker.getSymbolAtLocation(callee))
        : checker.getSymbolAtLocation(callee);
      const target = followAliasSymbol(rawSym, checker);
      if (isCanonicalFunctionDeclaration(target, baseDir)) {
        hasCanonicalCall = true;
      }
    }
    if (ts.isConditionalExpression(child) && /reference/i.test(child.condition.getText())) {
      bypassDetail = `条件表达式绕过规范函数: ${child.getText()}`;
    }
  });
  if (bypassDetail) return { ok: false, reason: bypassDetail };
  if (!hasCanonicalCall) {
    return { ok: false, reason: `参考绘制路径 globalAlpha 赋值必须调用规范函数 ${CANONICAL_SOURCE_FILE}:${CANONICAL_FN_NAME}()，禁止字面量或非规范来源` };
  }
  return { ok: true };
}

export async function checkReferenceOpacityStatic(baseDir = root) {
  const allowedTs = [];
  const allowedCssFallback = [];
  const allowedProducers = [];
  const allowedCanvasProducers = [];
  const violations = [];

  // 1. TypeScript AST + TypeChecker over src/**/*.ts
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
            violations.push({ file: rel, line, text: node.getText(sf), reason: resolved.reason });
          }
        }
      }

      // (c) Reference-path Canvas `globalAlpha = X` must resolve to canonical inkLayerOpacity()
      if (ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(node.left) &&
          node.left.name.text === "globalAlpha") {
        const isRefPath = enclosingFunctionHasReferenceParam(node) || /reference/i.test(node.right.getText(sf));
        if (isRefPath) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const check = verifyCanvasGlobalAlphaRhs(node.right, checker, baseDir);
          if (check.ok) {
            allowedCanvasProducers.push({ file: rel, line, form: node.getText(sf) });
          } else {
            violations.push({ file: rel, line, text: node.getText(sf), reason: check.reason });
          }
        }
      }

      // (d) Disallow stroke-opacity / fill-opacity in reference rendering modules (src/annot, src/pdf, src/word)
      if (/^src\/(?:annot|pdf|word)\//.test(rel) &&
          (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
          (node.text === "stroke-opacity" || node.text === "fill-opacity")) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        violations.push({
          file: rel,
          line,
          text: node.getText(sf),
          reason: `参考渲染路径禁止直接写 ${node.text}（应由参考层统一控制）`,
        });
      }
    });

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

  // 2. CSS rules (including nested @media / @supports / @layer):
  //    Track A (selector-family): ANY `opacity` on reference-layer selectors (regardless of value or !important)
  //            must match the exact canonical whitelist.
  //    Track B (value-normalized): ANY non-:disabled `opacity` normalizing to 0.35 or unevaluable calc()
  //            anywhere in CSS must match the exact canonical whitelist.
  const cssFiles = await collectFiles(join(baseDir, "src", "styles"), ".css");
  for (const absPath of cssFiles) {
    const rel = relative(baseDir, absPath).replace(/\\/g, "/");
    const content = await readFile(absPath, "utf8");
    const rules = parseCssStyleRules(content);

    for (const rule of rules) {
      const { selectorText, selectors, body, bodyStart, atRule } = rule;
      const isDisabledOnly = selectors.length > 0 && selectors.every(s => /:disabled\b/.test(s));
      const isReferenceSelector = selectors.some(matchesReferenceSelectorFamily);
      const ctxPrefix = atRule ? `${atRule} -> ` : "";

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
            selector: selectorText,
            text: `${ctxPrefix}${selectorText} { ${prop}: ${val} }`,
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
              selector: selectorText,
              text: `${ctxPrefix}${selectorText} { ${prop}: ${val} }`,
              reason: check.kind === "unevaluable" ? "不可判定 calc() 表达式（保守拒绝）" : "归一值 0.35，禁止 CSS 变量赋值形态",
            });
          }
          continue;
        }

        if (prop === "stroke-opacity" || prop === "fill-opacity") {
          if (isReferenceSelector) {
            violations.push({
              file: rel,
              line,
              selector: selectorText,
              text: `${ctxPrefix}${selectorText} { ${prop}: ${val} }`,
              reason: `参考层选择器族上禁止 ${prop} 覆盖`,
            });
          }
          continue;
        }

        if (prop !== "opacity") continue;
        if (isDisabledOnly && !isReferenceSelector) continue;

        const isAllowedCanonical =
          rel === "src/styles/styles-reader.css" &&
          atRule === null &&
          selectors.length === 1 &&
          ALLOWED_CSS_SELECTORS.has(selectors[0]) &&
          val === EXACT_CSS_FALLBACK;

        // Track A: Reference selector family — ANY opacity declaration (any value, !important, @media, compound)
        if (isReferenceSelector) {
          if (isAllowedCanonical) {
            allowedCssFallback.push({ file: rel, line, selector: selectors[0], form: `opacity: ${val}` });
          } else {
            violations.push({
              file: rel,
              line,
              selector: selectorText,
              text: `${ctxPrefix}${selectorText} { opacity: ${val} }`,
              reason: `参考层选择器族上禁止非规范 opacity 声明（仅允许顶层精确形态 opacity: ${EXACT_CSS_FALLBACK}）`,
            });
          }
          continue;
        }

        // Track B: Non-reference selectors — normalized 0.35 or unevaluable calc()
        const check = inspectCssOpacityValue(val);
        if (check.kind === "none") continue;
        if (check.kind === "unevaluable") {
          violations.push({
            file: rel,
            line,
            selector: selectorText,
            text: `${ctxPrefix}${selectorText} { opacity: ${val} }`,
            reason: "不可判定 calc() 表达式（保守拒绝）",
          });
          continue;
        }
        violations.push({
          file: rel,
          line,
          selector: selectorText,
          text: `${ctxPrefix}${selectorText} { opacity: ${val} }`,
          normalized: TARGET_OPACITY,
          reason: `归一值 0.35，非精确白名单形态 opacity: ${EXACT_CSS_FALLBACK}`,
        });
      }
    }
  }

  const total = allowedTs.length + allowedCssFallback.length + allowedProducers.length + allowedCanvasProducers.length;
  const countOk =
    allowedTs.length === EXPECTED_TS_COUNT &&
    allowedCssFallback.length === EXPECTED_CSS_FALLBACK_COUNT &&
    allowedProducers.length === EXPECTED_PRODUCER_COUNT &&
    allowedCanvasProducers.length === EXPECTED_CANVAS_PRODUCER_COUNT &&
    total === EXPECTED_TOTAL;

  return {
    passed: violations.length === 0 && countOk,
    expected: { ts: EXPECTED_TS_COUNT, cssFallback: EXPECTED_CSS_FALLBACK_COUNT, producer: EXPECTED_PRODUCER_COUNT, canvasProducer: EXPECTED_CANVAS_PRODUCER_COUNT, total: EXPECTED_TOTAL },
    actual: { ts: allowedTs.length, cssFallback: allowedCssFallback.length, producer: allowedProducers.length, canvasProducer: allowedCanvasProducers.length, total },
    selectorFamily: REFERENCE_SELECTOR_FAMILY.map(({ name, source }) => ({ name, source })),
    allowedTs,
    allowedCssFallback,
    allowedProducers,
    allowedCanvasProducers,
    violations,
  };
}

/**
 * Runtime real-DOM assertion in Chromium (marker-driven + bidirectional registry):
 * Triggers production rendering helpers (markReferenceElement, referenceKindFor, createFreeOverlay,
 * syncReferenceOpacityToken) for all 8 reference kinds, dynamically enumerates `[data-ms-reference]`,
 * verifies NO rendered reference element lacks the marker, enforces bidirectional equality between
 * discovered kinds and EXPECTED_REFERENCE_KINDS, and asserts computed opacity === 0.35 on every element.
 */
export async function checkReferenceOpacityRuntime(baseDir = root, expectedKinds = EXPECTED_REFERENCE_KINDS, options = {}) {
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
    import { createFreeOverlay } from ${JSON.stringify(join(baseDir, "src/annot/overlay.ts"))};
    import { paintInkStrokes } from ${JSON.stringify(join(baseDir, "src/annot/pen.ts"))};
    import { INK_REFERENCE_OPACITY } from ${JSON.stringify(join(baseDir, "src/annot/penGeometry.ts"))};
    try {
      // ===== Canvas 2D draw-call interception (injected before any render) =====
      const drawLog: { op: string; alpha: number; t: number }[] = [];
      (window as any).__msDrawLog = drawLog;
      const P = CanvasRenderingContext2D.prototype as any;
      for (const op of ["stroke", "fill", "fillRect", "drawImage", "putImageData"]) {
        const orig = P[op];
        P[op] = function(...a: any[]) {
          if (this?.canvas?.dataset?.msCanvasProbe === "1") {
            drawLog.push({ op, alpha: this.globalAlpha, t: performance.now() });
          }
          return orig.apply(this, a);
        };
      }

      const runCanvasPass = (reference: boolean, mode = "clean") => {
        drawLog.length = 0;
        const width = 200, height = 100, strokeWidth = 12;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.dataset.msCanvasProbe = "1";
        const ctx = canvas.getContext("2d")!;
        const x0 = 20, x1 = 180, cy = 50;
        const strokes = [[{ x: x0 / width, y: cy / height }, { x: x1 / width, y: cy / height }]];
        paintInkStrokes(ctx, strokes, width, height, "#000000", "pen", strokeWidth, 1, reference);
        if (reference && mode === "drawimage-no-alpha") {
          const src = document.createElement("canvas");
          src.width = 10; src.height = 10;
          ctx.drawImage(src, 0, 0);
        } else if (reference && mode === "dest-out-center") {
          ctx.save();
          ctx.globalCompositeOperation = "destination-out";
          ctx.globalAlpha = 0.5;
          ctx.fillRect(85, 40, 30, 20);
          ctx.restore();
        } else if (reference && mode === "half-fade") {
          ctx.save();
          ctx.globalCompositeOperation = "destination-out";
          ctx.globalAlpha = 0.35;
          ctx.fillRect(100, 40, 90, 20);
          ctx.restore();
        } else if (reference && mode === "dest-out-035") {
          ctx.save();
          ctx.globalCompositeOperation = "destination-out";
          ctx.globalAlpha = 0.35;
          ctx.fillRect(70, 40, 60, 20);
          ctx.restore();
        }

        const data = ctx.getImageData(0, 0, width, height).data;
        const alphaAt = (x: number, y: number) => data[(y * width + x) * 4 + 3];
        const minA = reference ? 87 : 253;
        const maxA = reference ? 91 : 255;

        // 1. Sample 11 evenly-spaced interior points along centerline (endpoints + center + intermediate, dist=0 < strokeWidth/4)
        const sampleCount = 11;
        const samples: { x: number; y: number; alpha: number; ok: boolean }[] = [];
        for (let i = 0; i < sampleCount; i++) {
          const sx = Math.round((x0 + 4) + ((x1 - 4) - (x0 + 4)) * (i / (sampleCount - 1)));
          const alpha = alphaAt(sx, cy);
          samples.push({ x: sx, y: cy, alpha, ok: alpha >= minA && alpha <= maxA });
        }

        // 2. Full interior pixel sweep (distance to centerline segment < strokeWidth / 4)
        const coreDist = strokeWidth / 4;
        let interiorTotal = 0;
        let interiorInRange = 0;
        let excludedEdgePixels = 0;
        let interiorMin = 255;
        let interiorMax = 0;
        const badInterior: { x: number; y: number; alpha: number }[] = [];
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const a = alphaAt(x, y);
            const clampedX = Math.max(x0, Math.min(x1, x));
            const dist = Math.hypot(x - clampedX, y - cy);
            if (dist < coreDist) {
              interiorTotal++;
              if (a < interiorMin) interiorMin = a;
              if (a > interiorMax) interiorMax = a;
              if (a >= minA && a <= maxA) {
                interiorInRange++;
              } else if (badInterior.length < 10) {
                badInterior.push({ x, y, alpha: a });
              }
            } else if (a > 0 && a < 51) {
              excludedEdgePixels++;
            }
          }
        }
        const interiorRatio = interiorTotal > 0 ? interiorInRange / interiorTotal : 0;
        return {
          log: [...drawLog],
          samples,
          interiorTotal,
          interiorInRange,
          interiorRatio,
          interiorRange: [interiorMin, interiorMax],
          excludedEdgePixels,
          badInterior,
        };
      };

      const canvasRef = runCanvasPass(true, ${JSON.stringify(options?.canvasRefMode ?? "clean")});
      const canvasActive = runCanvasPass(false, "clean");

      const host = document.createElement("div");
      host.style.cssText = "position:relative;width:500px;height:700px;";
      document.body.appendChild(host);

      const proto = BaseAnnotationController.prototype as any;
      const fakeCtrl = {
        activeNotebookId: "default",
        isNotebookReference(ann: any) { return (ann.documentNotebookId ?? "default") !== "default"; },
        markReferenceElement: proto.markReferenceElement,
        referenceKindFor: proto.referenceKindFor,
      };
      const mark = (el: HTMLElement, ann: any) => {
        proto.markReferenceElement.call(fakeCtrl, el, true, proto.referenceKindFor.call(fakeCtrl, ann, el));
      };

      const dummyImg = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
      const surface = {
        parent: host,
        box: { left: 20, top: 20, width: 120, height: 60 },
        bounds: () => ({ width: 500, height: 700 }),
        geometry: () => null,
        fontScale: 1,
      };

      // 1. ink (reference layer pen holder with visible SVG stroke child)
      const inkAnn = { id: "ref-ink", type: "pen", inkLayerId: "layer-ref", documentNotebookId: "default" };
      const inkEl = document.createElement("div");
      inkEl.className = "ms-ann ms-ann-pen ms-ink-reference";
      inkEl.style.cssText = "position:absolute;left:0;top:0;width:100px;height:40px;";
      const inkSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      inkSvg.setAttribute("class", "ms-pen-render");
      inkSvg.setAttribute("width", "100");
      inkSvg.setAttribute("height", "40");
      inkEl.appendChild(inkSvg);
      mark(inkEl, inkAnn);
      host.appendChild(inkEl);

      // 2. document-notebook (voice annotation with visible child glyph span)
      const nbAnn = { id: "ref-voice", type: "voice", audioPath: "a.m4a", documentNotebookId: "nb-ref" };
      const nbEl = document.createElement("div");
      nbEl.className = "ms-ann ms-ann-voice ms-document-notebook-reference";
      nbEl.style.cssText = "left:40px;top:40px;";
      const voiceGlyph = document.createElement("span");
      voiceGlyph.className = "ms-ann-voice-glyph";
      voiceGlyph.textContent = "🎙";
      nbEl.appendChild(voiceGlyph);
      mark(nbEl, nbAnn);
      host.appendChild(nbEl);

      // 3. overlay-image (real createFreeOverlay in ink reference state -> contains img.ms-free-overlay-image)
      const imgAnn = {
        id: "ref-img-overlay", docPath: "doc.pdf", docKind: "pdf", page: 1, type: "note",
        rects: [{ x: 20, y: 20, w: 120, h: 60 }], text: "", color: "#111111", image: dummyImg,
        inkLayerId: "layer-ref", documentNotebookId: "default", overlay: { kind: "image" }, createdAt: "2026-11-24",
      };
      const imgOverlay = createFreeOverlay(imgAnn as any, surface as any, { readonly: true, imageSource: dummyImg });
      imgOverlay.element.classList.add("ms-ink-reference");
      mark(imgOverlay.element, imgAnn);
      host.appendChild(imgOverlay.element);

      // 4. overlay-text (real createFreeOverlay in ink reference state -> contains div.ms-free-overlay-text)
      const txtAnn = {
        id: "ref-txt-overlay", docPath: "doc.pdf", docKind: "pdf", page: 1, type: "note",
        rects: [{ x: 20, y: 100, w: 120, h: 60 }], text: "Ref text", color: "#111111",
        inkLayerId: "layer-ref", documentNotebookId: "default", overlay: { kind: "text", fontSize: 16 }, createdAt: "2026-11-24",
      };
      const txtOverlay = createFreeOverlay(txtAnn as any, surface as any, { readonly: true });
      txtOverlay.element.classList.add("ms-ink-reference");
      mark(txtOverlay.element, txtAnn);
      host.appendChild(txtOverlay.element);

      // 5. notebook-ink-image (notebook + ink reference image overlay)
      const comboAnn = {
        id: "ref-combo-img", docPath: "doc.pdf", docKind: "pdf", page: 1, type: "note",
        rects: [{ x: 20, y: 180, w: 120, h: 60 }], text: "", color: "#111111", image: dummyImg,
        inkLayerId: "layer-ref", documentNotebookId: "nb-ref", overlay: { kind: "image" }, createdAt: "2026-11-24",
      };
      const comboOverlay = createFreeOverlay(comboAnn as any, surface as any, { readonly: true, imageSource: dummyImg });
      comboOverlay.element.classList.add("ms-ink-reference", "ms-document-notebook-reference");
      mark(comboOverlay.element, comboAnn);
      host.appendChild(comboOverlay.element);

      // 6. recall-mask (highlighter recall ink mask in reference state)
      const maskAnn = { id: "ref-mask", type: "pen", inkBrush: "highlight", inkLayerId: "layer-ref", documentNotebookId: "default" };
      const maskEl = document.createElement("div");
      maskEl.className = "ms-ink-recall-mask ms-ink-reference";
      maskEl.style.cssText = "position:absolute;left:20px;top:260px;width:80px;height:20px;";
      maskEl.dataset.recallInkMask = "";
      mark(maskEl, maskAnn);
      host.appendChild(maskEl);

      // 7. html-range (HTML reference range with visible .ms-html-reference-segment child)
      const htmlAnn = { id: "ref-html", type: "highlight", documentNotebookId: "nb-ref" };
      const htmlRefEl = document.createElement("div");
      htmlRefEl.className = "ms-ann ms-html-reference-range ms-document-notebook-reference";
      htmlRefEl.style.cssText = "position:absolute;left:20px;top:300px;width:120px;height:24px;";
      const htmlSeg = document.createElement("span");
      htmlSeg.className = "ms-html-reference-segment";
      htmlSeg.style.cssText = "left:0;top:0;width:100px;height:18px;background:#ffd54f;";
      htmlRefEl.appendChild(htmlSeg);
      mark(htmlRefEl, htmlAnn);
      host.appendChild(htmlRefEl);

      // 8. region-excerpt (reference notebook region excerpt .ms-ann.ms-ann-region)
      const regionAnn = { id: "ref-region", type: "region", documentNotebookId: "nb-ref" };
      const regionEl = document.createElement("div");
      regionEl.className = "ms-ann ms-ann-region ms-document-notebook-reference";
      regionEl.style.cssText = "position:absolute;left:20px;top:340px;width:100px;height:50px;";
      mark(regionEl, regionAnn);
      host.appendChild(regionEl);

      const describeEl = (el: Element) => {
        const cls = [...el.classList].map(c => "." + c).join("");
        const kind = el.getAttribute("data-overlay-kind");
        const ref = el.getAttribute("data-ms-reference");
        return el.tagName.toLowerCase() + cls + (kind ? \`[data-overlay-kind="\${kind}"]\` : "") + (ref ? \`[data-ms-reference="\${ref}"]\` : "");
      };

      const isVisiblePainted = (el: Element) => {
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      /** Collect painted leaf nodes under a marked reference root and compute effectiveAlpha = Π(opacity) from root->leaf. */
      const collectLeaves = (rootEl: Element) => {
        const leaves: Element[] = [];
        const visit = (el: Element) => {
          if (!isVisiblePainted(el)) return;
          const visibleChildren = [...el.children].filter(isVisiblePainted);
          if (!visibleChildren.length) { leaves.push(el); return; }
          for (const child of visibleChildren) visit(child);
        };
        visit(rootEl);
        if (!leaves.length) leaves.push(rootEl);
        return leaves.map(leaf => {
          let effectiveAlpha = 1;
          const chain: string[] = [];
          for (let cur: Element | null = leaf; cur; cur = cur === rootEl ? null : cur.parentElement) {
            const st = getComputedStyle(cur);
            const op = parseFloat(st.opacity);
            effectiveAlpha *= Number.isFinite(op) ? op : 1;
            if (cur instanceof SVGElement) {
              const sop = parseFloat(st.strokeOpacity);
              if (Number.isFinite(sop) && sop < 1) effectiveAlpha *= sop;
              const fop = parseFloat(st.fillOpacity);
              if (Number.isFinite(fop) && fop < 1) effectiveAlpha *= fop;
            }
            chain.unshift(describeEl(cur));
          }
          return {
            kind: rootEl.getAttribute("data-ms-reference") || "",
            chain: chain.join(" > "),
            leafOpacity: parseFloat(getComputedStyle(leaf).opacity),
            effectiveAlpha,
          };
        });
      };

      const snapshotMarked = () => {
        const roots = [...document.querySelectorAll("[data-ms-reference]")];
        const leaves = roots.flatMap(collectLeaves);
        return {
          rootsCount: roots.length,
          kinds: [...new Set(roots.map(r => r.getAttribute("data-ms-reference") || ""))].sort(),
          leaves,
        };
      };
      const findUnmarked = () => [...document.querySelectorAll(${JSON.stringify(REFERENCE_CLASS_PROBE_QUERY)})]
        .filter(el => !el.hasAttribute("data-ms-reference"))
        .map(describeEl);

      // Phase A: Before producer runs (token absent) -> CSS fallback must yield effectiveAlpha=0.35 on ALL painted leaves
      const fallbackSnap = snapshotMarked();

      // Phase B: Run real BaseAnnotationController producer -> token & ALL painted leaves must yield effectiveAlpha=0.35
      proto.syncReferenceOpacityToken.call({});
      const tokenVal = getComputedStyle(document.documentElement).getPropertyValue("${TOKEN_NAME}").trim();
      const liveSnap = snapshotMarked();
      const unmarked = findUnmarked();

      (window as any).__probe = {
        constVal: String(INK_REFERENCE_OPACITY),
        tokenVal,
        elementsChecked: liveSnap.rootsCount,
        leavesChecked: liveSnap.leaves.length,
        kinds: liveSnap.kinds,
        unmarked,
        fallbackLeaves: fallbackSnap.leaves,
        liveLeaves: liveSnap.leaves,
        canvasRef,
        canvasActive,
      };
    } catch (e) {
      (window as any).__probe = { error: String(e) };
    }
    (window as any).__done = true;
  `);
  await writeFile(htmlFile, '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/reader.css"></head><body><script type="module" src="/probe.js"></script></body></html>');

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
    const baseCssText = await readFile(join(baseDir, "src/styles/styles-base.css"), "utf8");
    const readerCssText = await readFile(join(baseDir, "src/styles/styles-reader.css"), "utf8");
    const jsText = await readFile(bundleJs, "utf8");
    const htmlText = await readFile(htmlFile, "utf8");
    server = createServer((req, res) => {
      const path = new URL(req.url, "http://127.0.0.1").pathname;
      if (path === "/probe.js") { res.setHeader("Content-Type", "text/javascript"); res.end(jsText); return; }
      if (path === "/base.css") { res.setHeader("Content-Type", "text/css"); res.end(baseCssText); return; }
      if (path === "/reader.css") { res.setHeader("Content-Type", "text/css"); res.end(readerCssText); return; }
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
      if (probe.unmarked?.length) {
        errors.push(`渲染出的参考态元素缺少 data-ms-reference 标记: ${probe.unmarked.join(", ")}`);
      }
      const expectedSet = new Set(expectedKinds);
      const discoveredSet = new Set(probe.kinds ?? []);
      const missingKinds = [...expectedSet].filter(k => !discoveredSet.has(k));
      const extraKinds = [...discoveredSet].filter(k => !expectedSet.has(k));
      if (missingKinds.length) errors.push(`参考态种类注册表缺失（渲染未产出或缺少标记）: ${missingKinds.join(", ")}`);
      if (extraKinds.length) errors.push(`参考态种类注册表未登记多余种类: ${extraKinds.join(", ")}`);

      if (probe.constVal !== TARGET_OPACITY_STR) errors.push(`INK_REFERENCE_OPACITY=${probe.constVal} !== ${TARGET_OPACITY_STR}`);
      if (probe.tokenVal !== TARGET_OPACITY_STR || probe.tokenVal !== probe.constVal) {
        errors.push(`documentElement ${TOKEN_NAME}=${JSON.stringify(probe.tokenVal)} !== ${TARGET_OPACITY_STR} / const=${probe.constVal}`);
      }
      const ALPHA_TOL = 1e-6;
      for (const leaf of probe.liveLeaves) {
        if (Math.abs(leaf.effectiveAlpha - TARGET_OPACITY) > ALPHA_TOL) {
          errors.push(`live [${leaf.kind}] ${leaf.chain} effectiveAlpha=${leaf.effectiveAlpha} !== ${TARGET_OPACITY_STR}`);
        }
      }
      for (const leaf of probe.fallbackLeaves) {
        if (Math.abs(leaf.effectiveAlpha - TARGET_OPACITY) > ALPHA_TOL) {
          errors.push(`fallback [${leaf.kind}] ${leaf.chain} effectiveAlpha=${leaf.effectiveAlpha} !== ${TARGET_OPACITY_STR}`);
        }
      }
      // Canvas draw-call interception + full interior pixel sampling (no maxPixelAlpha!)
      const refLog = probe.canvasRef?.log ?? [];
      const activeLog = probe.canvasActive?.log ?? [];
      if (!refLog.length) errors.push("canvas reference pass recorded 0 draw calls");
      for (const rec of refLog) {
        if (Math.abs(rec.alpha - TARGET_OPACITY) > ALPHA_TOL) {
          errors.push(`canvas reference op=${rec.op} alpha=${rec.alpha} !== ${TARGET_OPACITY_STR} (totalOps=${refLog.length})`);
        }
      }
      const refSamples = probe.canvasRef?.samples ?? [];
      if (refSamples.length < 9) errors.push(`canvas reference sampleCount=${refSamples.length} < 9`);
      const badRefSamples = refSamples.filter(s => !s.ok);
      if (badRefSamples.length) {
        const failRatio = (badRefSamples.length / refSamples.length).toFixed(3);
        const detail = badRefSamples.map(s => `(${s.x},${s.y})=${s.alpha}`).join(", ");
        errors.push(`canvas reference interior samples out of [87,91] (89±2): ${badRefSamples.length}/${refSamples.length} (failRatio=${failRatio}) [${detail}]`);
      }
      if ((probe.canvasRef?.interiorRatio ?? 0) < 1) {
        const failPct = (1 - (probe.canvasRef?.interiorRatio ?? 0)).toFixed(4);
        const detail = (probe.canvasRef?.badInterior ?? []).slice(0, 5).map(p => `(${p.x},${p.y})=${p.alpha}`).join(", ");
        errors.push(`canvas reference interior pixel ratio=${probe.canvasRef?.interiorRatio} !== 1.0 (inRange=${probe.canvasRef?.interiorInRange}/${probe.canvasRef?.interiorTotal}, failRatio=${failPct}, expected=[87,91], sampleBad=[${detail}])`);
      }

      if (!activeLog.length) errors.push("canvas active pass recorded 0 draw calls");
      for (const rec of activeLog) {
        if (Math.abs(rec.alpha - 1) > ALPHA_TOL) {
          errors.push(`canvas active op=${rec.op} alpha=${rec.alpha} !== 1 (totalOps=${activeLog.length})`);
        }
      }
      const actSamples = probe.canvasActive?.samples ?? [];
      if (actSamples.length < 9) errors.push(`canvas active sampleCount=${actSamples.length} < 9`);
      const badActSamples = actSamples.filter(s => !s.ok);
      if (badActSamples.length) {
        const failRatio = (badActSamples.length / actSamples.length).toFixed(3);
        const detail = badActSamples.map(s => `(${s.x},${s.y})=${s.alpha}`).join(", ");
        errors.push(`canvas active interior samples out of [253,255]: ${badActSamples.length}/${actSamples.length} (failRatio=${failRatio}) [${detail}]`);
      }
      if ((probe.canvasActive?.interiorRatio ?? 0) < 1) {
        const failPct = (1 - (probe.canvasActive?.interiorRatio ?? 0)).toFixed(4);
        errors.push(`canvas active interior pixel ratio=${probe.canvasActive?.interiorRatio} !== 1.0 (inRange=${probe.canvasActive?.interiorInRange}/${probe.canvasActive?.interiorTotal}, failRatio=${failPct}, expected=[253,255])`);
      }
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
  const extraKindArg = args.find(a => a.startsWith("--extra-kind="));
  const extraKinds = extraKindArg ? [extraKindArg.slice("--extra-kind=".length)] : [];
  const canvasRefModeArg = args.find(a => a.startsWith("--canvas-ref-mode="));
  const canvasRefMode = canvasRefModeArg
    ? canvasRefModeArg.slice("--canvas-ref-mode=".length)
    : args.includes("--inject-ref-drawimage-no-alpha") ? "drawimage-no-alpha" : "clean";
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
          result.actual.producer !== result.expected.producer ||
          result.actual.canvasProducer !== result.expected.canvasProducer) {
        console.error(`FAIL reference-opacity-guard baseline mismatch: actual=${JSON.stringify(result.actual)} expected=${JSON.stringify(result.expected)}`);
      }
    } else {
      console.log(`PASS reference-opacity-guard(static) (${result.actual.ts} TS + ${result.actual.cssFallback} CSS fallback + ${result.actual.producer} tokenProducer + ${result.actual.canvasProducer} canvasProducer = ${result.actual.total}, selectorFamily=${result.selectorFamily.length}, 0 violations)`);
    }
  }
  if (!staticOnly) {
    const rt = await checkReferenceOpacityRuntime(targetDir, [...EXPECTED_REFERENCE_KINDS, ...extraKinds], { canvasRefMode });
    console.log("reference-opacity-guard(runtime):", JSON.stringify(rt));
    if (!rt.passed) {
      failed = true;
      for (const e of rt.errors) console.error(`FAIL reference-opacity-guard(runtime): ${e}`);
    } else {
      const cr = rt.probe.canvasRef, ca = rt.probe.canvasActive;
      console.log(`PASS reference-opacity-guard(runtime) (token=${rt.probe.tokenVal}, kinds=${rt.probe.kinds.length}, elementsChecked=${rt.probe.elementsChecked}, leavesChecked=${rt.probe.leavesChecked}, canvasRef: ops=${cr.log.length} samples=${cr.samples.length} interior=${cr.interiorInRange}/${cr.interiorTotal}(${cr.interiorRatio}) range=[${cr.interiorRange}] excludedEdge=${cr.excludedEdgePixels}, canvasActive: ops=${ca.log.length} samples=${ca.samples.length} interior=${ca.interiorInRange}/${ca.interiorTotal}(${ca.interiorRatio}) range=[${ca.interiorRange}] excludedEdge=${ca.excludedEdgePixels}, allEffectiveAlpha=${TARGET_OPACITY_STR})`);
    }
  }
  if (failed) process.exit(1);
}
