/**
 * [INPUT]: 扫描 src/** 的 TypeScript AST 与 src/styles/** 的 CSS 规则。
 * [OUTPUT]: 双轨校验（递归 calc 规范化数值 0.35 + 精确形态白名单 + 生产者侧 token 定义点常量引用校验）与基线计数（1 TS 常量 + 2 CSS 回退 + 1 定义点 = 4），违规则报文件:行号并退出 1。
 * [POS]: GAP-07b-3 参考层透明度单源、CSS 回退与 token 生产者静态守卫。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("../../", import.meta.url));
const req = createRequire(join(root, "package.json"));
const ts = req("typescript");

const TARGET_OPACITY = 0.35;
const EPS = 1e-9;
const TOKEN_NAME = "--ms-ink-reference-opacity";
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
    // Nested calc( treated as grouping (
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

/**
 * Inspect a CSS value for opacity 0.35 or unevaluable calc().
 * Returns { kind: "none" | "target035" | "unevaluable" }.
 */
function inspectCssOpacityValue(rawVal) {
  const cleaned = rawVal.replace(/\/\*[\s\S]*?\*\//g, "").replace(/!important\s*$/i, "").trim();
  // 1. Check all calc(...) expressions (recursive, supports nested parens and nested calc())
  const calcs = extractCalcInnerExpressions(cleaned);
  for (const item of calcs) {
    if (item.unbalanced) return { kind: "unevaluable" };
    const evaluated = evalCalcExpr(item.inner);
    if (!Number.isFinite(evaluated)) return { kind: "unevaluable" };
    if (isTarget035(evaluated)) return { kind: "target035" };
  }
  // 2. Check standalone numeric / percentage tokens outside calc()
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
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))) {
    node = node.expression;
  }
  return node;
}

/** Valid producer value: INK_REFERENCE_OPACITY or String(INK_REFERENCE_OPACITY). */
function isValidConstantProducerArg(node) {
  const expr = unwrapExpr(node);
  if (!expr) return false;
  if (ts.isIdentifier(expr) && expr.text === "INK_REFERENCE_OPACITY") return true;
  if (ts.isCallExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === "String" &&
      expr.arguments.length === 1) {
    const arg = unwrapExpr(expr.arguments[0]);
    return !!arg && ts.isIdentifier(arg) && arg.text === "INK_REFERENCE_OPACITY";
  }
  return false;
}

function stringLiteralValue(node) {
  const expr = unwrapExpr(node);
  if (!expr) return null;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  return null;
}

export async function checkReferenceOpacity(baseDir = root) {
  const allowedTs = [];
  const allowedCssFallback = [];
  const allowedProducers = [];
  const violations = [];

  // 1. Scan TypeScript AST:
  //    a) Numeric literals normalizing to 0.35
  //    b) All writes / mentions of --ms-ink-reference-opacity (producer-side validation)
  const tsFiles = await collectFiles(join(baseDir, "src"), ".ts");
  for (const absPath of tsFiles) {
    const rel = relative(baseDir, absPath).replace(/\\/g, "/");
    const content = await readFile(absPath, "utf8");
    const sf = ts.createSourceFile(rel, content, ts.ScriptTarget.Latest, true);
    const handledTokenNodes = new Set();

    walk(sf, node => {
      // (a) Numeric literals equal to 0.35
      if (ts.isNumericLiteral(node) && isTarget035(Number(node.text))) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const raw = node.getText(sf);
        const isAllowedConst =
          rel === "src/annot/penGeometry.ts" &&
          raw === "0.35" &&
          ts.isVariableDeclaration(node.parent) &&
          ts.isIdentifier(node.parent.name) &&
          node.parent.name.text === "INK_REFERENCE_OPACITY";
        if (isAllowedConst) {
          allowedTs.push({ file: rel, line, form: "INK_REFERENCE_OPACITY = 0.35" });
        } else {
          violations.push({ file: rel, line, text: raw, normalized: TARGET_OPACITY, reason: "归一值 0.35，非允许 TS 常量形态" });
        }
      }

      // (b) setProperty("--ms-ink-reference-opacity", X) producer calls
      if (ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "setProperty" &&
          node.arguments.length >= 2) {
        const keyVal = stringLiteralValue(node.arguments[0]);
        if (keyVal === TOKEN_NAME) {
          handledTokenNodes.add(unwrapExpr(node.arguments[0]));
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const valArg = node.arguments[1];
          if (isValidConstantProducerArg(valArg)) {
            allowedProducers.push({ file: rel, line, form: node.getText(sf) });
          } else {
            violations.push({
              file: rel,
              line,
              text: node.getText(sf),
              reason: `定义点写入 ${TOKEN_NAME} 禁止字面量/非常量表达式，必须引用常量 INK_REFERENCE_OPACITY`,
            });
          }
        }
      }
    });

    // (c) Any other string/template literal containing --ms-ink-reference-opacity (cssText, <style>, insertRule, etc.)
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

        // Disallow defining --ms-ink-reference-opacity directly in CSS (must be defined only by TS producer)
        if (prop === TOKEN_NAME) {
          violations.push({
            file: rel,
            line,
            text: `${prop}: ${val}`,
            reason: `禁止在 CSS 中直接定义 ${TOKEN_NAME}（必须由 TS 常量引用定义点写入）`,
          });
          continue;
        }

        // Disallow any other reference/ink CSS custom property resolving to 0.35 or unevaluable calc()
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

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const targetDir = process.argv[2] ? resolve(process.argv[2]) : root;
  const result = await checkReferenceOpacity(targetDir);
  console.log("reference-opacity-guard:", JSON.stringify(result));
  if (!result.passed) {
    for (const v of result.violations) {
      console.error(`FAIL reference-opacity-guard ${v.file}:${v.line} (${v.reason}): ${v.text}`);
    }
    if (result.actual.total !== result.expected.total ||
        result.actual.ts !== result.expected.ts ||
        result.actual.cssFallback !== result.expected.cssFallback ||
        result.actual.producer !== result.expected.producer) {
      console.error(`FAIL reference-opacity-guard baseline mismatch: actual=${JSON.stringify(result.actual)} expected=${JSON.stringify(result.expected)}`);
    }
    process.exit(1);
  }
  console.log(`PASS reference-opacity-guard (${result.actual.ts} TS + ${result.actual.cssFallback} CSS fallback + ${result.actual.producer} producer = ${result.actual.total}, 0 violations)`);
}
