/**
 * [INPUT]: 扫描 src/** 的 TypeScript AST 与 src/styles/** 的 CSS 规则。
 * [OUTPUT]: 校验参考层不透明度 0.35 精确形态与基线计数（1 TS + 2 CSS 回退 = 3），违规则报文件:行号并退出 1。
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

const EXPECTED_TS_COUNT = 1;
const EXPECTED_CSS_FALLBACK_COUNT = 2;
const EXPECTED_TOTAL = EXPECTED_TS_COUNT + EXPECTED_CSS_FALLBACK_COUNT;
const ALLOWED_CSS_SELECTORS = new Set([".ms-ink-reference", ".ms-document-notebook-reference"]);

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

export async function checkReferenceOpacity(baseDir = root) {
  const allowedTs = [];
  const allowedCssFallback = [];
  const violations = [];

  // 1. Scan TypeScript AST for any numeric literal equal to 0.35 (including .35, 0.350, 3.5e-1)
  const tsFiles = await collectFiles(join(baseDir, "src"), ".ts");
  for (const absPath of tsFiles) {
    const rel = relative(baseDir, absPath).replace(/\\/g, "/");
    const content = await readFile(absPath, "utf8");
    const sf = ts.createSourceFile(rel, content, ts.ScriptTarget.Latest, true);
    walk(sf, node => {
      if (!ts.isNumericLiteral(node) || Number(node.text) !== 0.35) return;
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
        violations.push({ file: rel, line, text: raw, reason: "disallowed TS 0.35 literal" });
      }
    });
  }

  // 2. Scan CSS rules for reference/opacity 0.35 / .35 / 0.350 / 35%
  const cssFiles = await collectFiles(join(baseDir, "src", "styles"), ".css");
  const literalRe = /(?<![\w.])(?:0?\.350*|35%)(?![\w.%])/g;
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

        // Check custom property assignments for reference/ink opacity
        if (prop.startsWith("--") && /reference|ink/i.test(prop) && literalRe.test(val)) {
          literalRe.lastIndex = 0;
          violations.push({ file: rel, line, text: `${prop}: ${val}`, reason: "disallowed CSS variable 0.35 assignment" });
          continue;
        }
        literalRe.lastIndex = 0;

        if (prop !== "opacity") continue;
        if (isDisabledOnly) continue;

        const hasLiteral = literalRe.test(val);
        literalRe.lastIndex = 0;
        if (!hasLiteral) continue;

        const isAllowedFallback =
          rel === "src/styles/styles-reader.css" &&
          selectors.length === 1 &&
          ALLOWED_CSS_SELECTORS.has(selectors[0]) &&
          val === "var(--ms-ink-reference-opacity, 0.35)";

        if (isAllowedFallback) {
          allowedCssFallback.push({ file: rel, line, selector: selectors[0], form: `opacity: ${val}` });
        } else {
          violations.push({ file: rel, line, text: `${selectorText} { opacity: ${val} }`, reason: "disallowed CSS opacity 0.35 form" });
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
