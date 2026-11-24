/**
 * [INPUT]: 扫描 src/** 的 TypeScript AST 与 src/styles/** 的 CSS 规则。
 * [OUTPUT]: 双轨校验（规范化数值 0.35 + 精确形态白名单）与基线计数（1 TS + 2 CSS 回退 = 3），违规则报文件:行号与「归一值 0.35」并退出 1。
 * [POS]: GAP-07b-3 参考层透明度单源与 CSS 回退静态守卫。
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
const EXPECTED_TS_COUNT = 1;
const EXPECTED_CSS_FALLBACK_COUNT = 2;
const EXPECTED_TOTAL = EXPECTED_TS_COUNT + EXPECTED_CSS_FALLBACK_COUNT;
const ALLOWED_CSS_SELECTORS = new Set([".ms-ink-reference", ".ms-document-notebook-reference"]);
const EXACT_CSS_FALLBACK = "var(--ms-ink-reference-opacity, 0.35)";

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

/** Safe recursive-descent evaluator for pure numeric/percentage calc() expressions. */
function evalCalcExpr(expr) {
  const tokens = [];
  const tokenRe = /\s*(?:([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(%?)|([+\-*/()]))/gy;
  let pos = 0;
  while (pos < expr.length) {
    if (/\s/.test(expr[pos])) { pos++; continue; }
    tokenRe.lastIndex = pos;
    const m = tokenRe.exec(expr);
    if (!m) return NaN;
    pos = tokenRe.lastIndex;
    if (m[1] !== undefined) {
      const n = Number(m[1]);
      tokens.push({ type: "num", value: m[2] === "%" ? n / 100 : n });
    } else {
      tokens.push({ type: "op", value: m[3] });
    }
  }
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
  return idx === tokens.length ? result : NaN;
}

/**
 * Normalize all numeric/percentage/calc() values inside a CSS value string and
 * return whether any resolves to 0.35 (covering 0.35, .35, 0.350, 35%, 35.0%, 0.35e0, calc(...)).
 */
function hasNormalized035(rawVal) {
  const cleaned = rawVal.replace(/\/\*[\s\S]*?\*\//g, "").replace(/!important\s*$/i, "").trim();
  // 1. Check calc(...) expressions
  for (const m of cleaned.matchAll(/\bcalc\(([^()]*)\)/gi)) {
    const evaluated = evalCalcExpr(m[1]);
    if (isTarget035(evaluated)) return true;
  }
  // 2. Check all standalone numeric / percentage tokens (including scientific notation)
  for (const m of cleaned.matchAll(/(?<![\w.])([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(%?)(?![\w.%])/g)) {
    const num = Number(m[1]);
    const normalized = m[2] === "%" ? num / 100 : num;
    if (isTarget035(normalized)) return true;
  }
  return false;
}

export async function checkReferenceOpacity(baseDir = root) {
  const allowedTs = [];
  const allowedCssFallback = [];
  const violations = [];

  // 1. Scan TypeScript AST for any numeric literal normalizing to 0.35 (0.35, .35, 0.350, 3.5e-1, etc.)
  const tsFiles = await collectFiles(join(baseDir, "src"), ".ts");
  for (const absPath of tsFiles) {
    const rel = relative(baseDir, absPath).replace(/\\/g, "/");
    const content = await readFile(absPath, "utf8");
    const sf = ts.createSourceFile(rel, content, ts.ScriptTarget.Latest, true);
    walk(sf, node => {
      if (!ts.isNumericLiteral(node) || !isTarget035(Number(node.text))) return;
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
    });
  }

  // 2. Scan CSS rules with dual-track: normalized 0.35 + exact whitelist form
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

        // Disallow any CSS custom property assignment for reference/ink opacity normalizing to 0.35
        if (prop.startsWith("--") && /reference|ink/i.test(prop) && hasNormalized035(val)) {
          violations.push({ file: rel, line, text: `${prop}: ${val}`, normalized: TARGET_OPACITY, reason: "归一值 0.35，禁止 CSS 变量赋值形态" });
          continue;
        }

        if (prop !== "opacity") continue;
        if (isDisabledOnly) continue;
        if (!hasNormalized035(val)) continue;

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
            reason: "归一值 0.35，非精确白名单形态 opacity: var(--ms-ink-reference-opacity, 0.35)",
          });
        }
      }
    }
  }

  const total = allowedTs.length + allowedCssFallback.length;
  const countOk =
    allowedTs.length === EXPECTED_TS_COUNT &&
    allowedCssFallback.length === EXPECTED_CSS_FALLBACK_COUNT &&
    total === EXPECTED_TOTAL;

  return {
    passed: violations.length === 0 && countOk,
    expected: { ts: EXPECTED_TS_COUNT, cssFallback: EXPECTED_CSS_FALLBACK_COUNT, total: EXPECTED_TOTAL },
    actual: { ts: allowedTs.length, cssFallback: allowedCssFallback.length, total },
    allowedTs,
    allowedCssFallback,
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
        result.actual.cssFallback !== result.expected.cssFallback) {
      console.error(`FAIL reference-opacity-guard baseline mismatch: actual=${JSON.stringify(result.actual)} expected=${JSON.stringify(result.expected)}`);
    }
    process.exit(1);
  }
  console.log(`PASS reference-opacity-guard (${result.actual.ts} TS + ${result.actual.cssFallback} CSS fallback = ${result.actual.total}, 0 violations)`);
}
