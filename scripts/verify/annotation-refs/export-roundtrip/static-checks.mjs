import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { dependencies, project } from "./fixture-support.mjs";

async function sourceFiles(directory) {
  const candidates = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(candidates.map(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "acceptance-fixtures") return sourceFiles(path);
    if (entry.isFile() && /\.(?:ts|css)$/.test(entry.name) && !/(?:acceptance|fixture|\.test\.)/i.test(entry.name)) return [path];
    return [];
  }));
  return paths.flat().sort();
}

function walk(ts, node, visit) {
  visit(node);
  ts.forEachChild(node, child => walk(ts, child, visit));
}

async function findTypeScript(collect) {
  const ts = dependencies()("typescript");
  const found = [];
  for (const path of await sourceFiles(join(project, "src"))) {
    if (!path.endsWith(".ts")) continue;
    const file = ts.createSourceFile(relative(project, path), await readFile(path, "utf8"), ts.ScriptTarget.Latest, true);
    const report = (node, text, context) => found.push({
      file: file.fileName, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, text, context,
    });
    collect(ts, file, report);
  }
  return found;
}

const referenceClasses = ["ms-ink-reference", "ms-document-notebook-reference"];

async function readerCss() {
  const rules = [];
  const variables = new Map();
  for (const path of await sourceFiles(join(project, "src", "styles"))) {
    if (!path.endsWith(".css")) continue;
    const text = await readFile(path, "utf8");
    for (const match of text.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) variables.set(match[1], match[2].trim());
    for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = match[1].split(",").map(selector => selector.replace(/\/\*[\s\S]*?\*\//g, "").trim());
      const opacity = /\bopacity\s*:\s*([^;}!]+)/.exec(match[2])?.[1].trim();
      const classes = referenceClasses.filter(name => selectors.includes(`.${name}`));
      if (!opacity || !classes.length) continue;
      const position = match.index + match[1].length + 1 + match[2].indexOf(opacity);
      rules.push({ classes, opacity, file: relative(project, path), line: text.slice(0, position).split("\n").length });
    }
  }
  return { rules, variables };
}

export async function overlayOpacityReader() {
  const { rules, variables } = await readerCss();
  return element => {
    let value = String(element.style.opacity ?? rules.filter(rule => rule.classes.some(name => element.classList.contains(name))).at(-1)?.opacity ?? "1");
    for (let count = 0; count < 8 && value.startsWith("var("); count++) {
      const match = /^var\((--[\w-]+)\s*(?:,\s*([^)]*))?\)$/.exec(value);
      if (!match) return null;
      value = element.style[match[1]] ?? variables.get(match[1]) ?? match[2] ?? "";
    }
    return value.endsWith("%") ? Number(value.slice(0, -1)) / 100 : value ? Number(value) : null;
  };
}

export async function opacityLiteralLocations() {
  const allTs = await findTypeScript((ts, file, report) => walk(ts, file, node => {
    if (!ts.isNumericLiteral(node) || Number(node.text) !== .35) return;
    let clause = node.parent;
    while (clause && !ts.isStatement(clause)) clause = clause.parent;
    report(node, node.getText(file), /opacity|alpha|reference/i.test(clause?.getText(file) ?? "")
      ? "reference/opacity candidate" : "unrelated");
  }));
  const { rules } = await readerCss();
  const allCss = [];
  for (const path of await sourceFiles(join(project, "src", "styles"))) {
    if (!path.endsWith(".css")) continue;
    const text = await readFile(path, "utf8");
    for (const match of text.matchAll(/(?<![\w.])(?:0?\.35|35%)(?![\w.%])/g)) {
      const file = relative(project, path);
      const line = text.slice(0, match.index).split("\n").length;
      const relevant = rules.some(rule => rule.file === file && rule.line === line && rule.opacity === match[0]) ||
        /--[\w-]*(?:reference|ink)[\w-]*\s*:\s*$/.test(text.slice(text.lastIndexOf("\n", match.index) + 1, match.index));
      allCss.push({ file, line, text: match[0], context: relevant ? "reference/opacity candidate" : "unrelated" });
    }
  }
  return [...allTs, ...allCss];
}

export async function fullOpacityBranchLocations() {
  return findTypeScript((ts, file, report) => walk(ts, file, node => {
    if (!ts.isConditionalExpression(node) || !/reference/i.test(node.condition.getText(file))) return;
    const alternatives = [node.whenTrue, node.whenFalse];
    if (!alternatives.some(arm => ts.isNumericLiteral(arm) && Number(arm.text) === 1)) return;
    let clause = node.parent;
    while (clause && !ts.isStatement(clause)) clause = clause.parent;
    const alpha = alternatives.some(arm => ts.isNumericLiteral(arm) && Number(arm.text) === .35) ||
      /opacity|globalAlpha/i.test(clause?.getText(file) ?? "");
    if (alpha) report(node, node.getText(file), "reference choice with literal full opacity");
  }));
}

export async function falseLossLocations() {
  return findTypeScript((ts, file, report) => {
    const unwrap = node => {
      while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
      return node;
    };
    const refName = node => {
      node = unwrap(node);
      if (node && ts.isPropertyAccessExpression(node) && node.name.text === "bindToInkLayer") return node.getText(file);
      if (node && ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === "bindToInkLayer") return node.getText(file);
      return null;
    };
    const scope = node => {
      while (node && !ts.isFunctionLike(node) && !ts.isSourceFile(node)) node = node.parent;
      return node;
    };
    const aliases = new Map();
    walk(ts, file, node => {
      const names = aliases.get(scope(node)) ?? new Set();
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && refName(node.initializer)) names.add(node.name.text);
      if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && (node.propertyName ?? node.name).getText(file) === "bindToInkLayer") names.add(node.name.text);
      if (names.size) aliases.set(scope(node), names);
    });
    const binding = node => {
      const ref = unwrap(node);
      return refName(ref) ?? (ref && ts.isIdentifier(ref) && aliases.get(scope(ref))?.has(ref.text) ? ref.text : null);
    };
    const copies = (node, source) => {
      let copied = false;
      walk(ts, node, child => {
        if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken && binding(child.right) === source ||
          (ts.isPropertyAssignment(child) || ts.isVariableDeclaration(child)) && binding(child.initializer) === source ||
          ts.isShorthandPropertyAssignment(child) && binding(child.name) === source ||
          ts.isReturnStatement(child) && binding(child.expression) === source) copied = true;
      });
      return copied;
    };
    walk(ts, file, node => {
      const direct = ts.isIfStatement(node) || ts.isConditionalExpression(node);
      const guard = direct ? node.expression : ts.isBinaryExpression(node) ? node.left : undefined;
      const source = binding(guard);
      if (!source) return;
      const body = ts.isIfStatement(node) ? node.thenStatement : ts.isConditionalExpression(node) ? node.whenTrue : node.right;
      const fallback = ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken;
      const logical = ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken;
      if (fallback || (direct || logical) && (binding(body) === source || copies(body, source))) report(node, node.getText(file));
    });
  });
}
