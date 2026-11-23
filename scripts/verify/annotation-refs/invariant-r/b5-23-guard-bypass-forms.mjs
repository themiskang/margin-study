import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";

const project = resolve(process.argv[2] ?? process.cwd());
const revision = process.argv[3];
const here = dirname(fileURLToPath(import.meta.url));
const evidence = process.env.MARGINSTUDY_EVIDENCE_DIR;
const fixtureRoot = evidence ? resolve(evidence, "gap-07b/round14/fixtures") :
  (basename(here) === "fixtures" && basename(dirname(here)) === "round14" ? here : null);
const guardPath = "scripts/verify/recovery-delete-guard.mjs";
const uncoveredPath = "scripts/verify/recovery-delete-guard-uncovered.json";
const probePath = "src/__guard_probe.ts";
const forms = [
  { id: "bracket", lines: ["return adapter['remove'](p);"] },
  { id: "template-member", lines: ['return adapter[`re${"move"}`](p);'] },
  { id: "aliased-method", lines: ["const rm = adapter.remove;", "return rm(p);"], anchor: "binding" },
  { id: "destructured-method", lines: ["const { remove } = adapter;", "return remove(p);"], anchor: "binding" },
  { id: "cast-receiver", lines: ["return (adapter as any).remove(p);"] },
  { id: "assigned-receiver", lines: ["return Object.assign({}, adapter).remove(p);"] },
  { id: "fs-promises-rm", lines: ["return fs.promises.rm(p);"] },
  { id: "fs-rm-sync", lines: ["return fs.rmSync(p);"] },
  { id: "vault-adapter", lines: ["return vault.adapter.remove(p);"] },
  { id: "wrapper", lines: ["function discard(file: string) { return adapter.remove(file); }", "return discard(p);"], anchor: "wrapper" },
  { id: "path-variable", lines: ["const target = p;", "return adapter.remove(target);"] },
];

function probeSource(lines) {
  return [
    "export function probe(adapter: any, fs: any, vault: any, docPath: string) {",
    '  const p = `_marginstudy-recovery/pending-merge-tx-${docPath}.json`;',
    ...lines.map(line => `  ${line}`),
    "}",
    "",
  ].join("\n");
}

function readGuardOutput(mirror) {
  const child = spawnSync(process.execPath, [join(mirror, guardPath), mirror], { cwd: mirror, encoding: "utf8" });
  if (child.error) throw child.error;
  const output = `${child.stdout}\n${child.stderr}`;
  const lineNumbers = [...new Set([...output.matchAll(/src\/__guard_probe\.ts:(\d+)\b/g)].map(match => Number(match[1])))];
  return { exitCode: child.status, signal: child.signal, lineNumbers, output };
}

async function uncoveredForms(mirror) {
  let bytes;
  try { bytes = await readFile(join(mirror, uncoveredPath), "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }
  const { forms: entries } = JSON.parse(bytes);
  if (!Array.isArray(entries)) throw new Error(`Invalid forms in ${uncoveredPath}`);
  const allowed = new Map();
  for (const { id, reason } of entries) {
    if (!forms.some(form => form.id === id) || allowed.has(id) || typeof reason !== "string" || !reason.trim()) {
      throw new Error(`Invalid or duplicate uncovered form: ${id}`);
    }
    allowed.set(id, reason);
  }
  return allowed;
}

async function productionSources(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await productionSources(file));
    else if (entry.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name)) files.push(file);
  }
  return files;
}

async function scanAbsentForm(mirror, form, source) {
  const require = createRequire(join(project, "package.json"));
  const ts = require("typescript");
  const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const shape = (node, tree) => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const member = ts.isPropertyAccessExpression(parent) && parent.name === node;
      const binding = ts.isBindingElement(parent) && ts.isObjectBindingPattern(parent.parent);
      return [node.kind, member || binding ? node.text : "$identifier"];
    }
    if (ts.isStringLiteralLike(node) || node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle || node.kind === ts.SyntaxKind.TemplateTail) {
      return [node.kind, node.text];
    }
    return [node.kind, ...node.getChildren(tree).map(child => shape(child, tree))];
  };
  const probe = parse(probePath, source);
  const body = probe.statements[0].body.statements;
  let anchor = body[body.length - 1].expression;
  if (form.anchor === "binding") anchor = body[1].declarationList.declarations[0];
  if (form.anchor === "wrapper") anchor = body[1].body.statements[0].expression;
  const fingerprint = JSON.stringify(shape(anchor, probe));
  const matches = [];
  for (const file of await productionSources(join(mirror, "src"))) {
    if (file === join(mirror, probePath)) continue;
    const tree = parse(file, await readFile(file, "utf8"));
    const visit = node => {
      if (node.kind === anchor.kind && JSON.stringify(shape(node, tree)) === fingerprint) {
        const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
        matches.push(`${relative(mirror, file)}:${line}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return matches;
}

let failures = 0;
function check(label, passed, actual, expected) {
  if (passed) console.log(`PASS B5-23 ${label}`);
  else {
    failures++;
    console.error(`FAIL B5-23 ${label}\n  actual:   ${inspect(actual, { depth: null })}\n  expected: ${inspect(expected, { depth: null })}`);
  }
}

let mirror;
try {
  if (!fixtureRoot) throw new Error("Set MARGINSTUDY_EVIDENCE_DIR to provide the fixture mirror location");
  await mkdir(fixtureRoot, { recursive: true });
  mirror = await mkdtemp(join(fixtureRoot, "tmp-src-"));
  const inputs = ["src", "scripts", "package.json", "tsconfig.json"];
  if (revision) {
    const archive = execFileSync("git", ["archive", revision, ...inputs], { cwd: project, maxBuffer: 48 * 1024 * 1024 });
    execFileSync("tar", ["-xf", "-", "-C", mirror], { input: archive });
  } else {
    for (const item of inputs) await cp(join(project, item), join(mirror, item), { recursive: true, verbatimSymlinks: true });
  }
  await symlink(join(project, "node_modules"), join(mirror, "node_modules"), "dir");

  const baseline = readGuardOutput(mirror);
  check("unmodified source passes the guard", baseline.exitCode === 0 && baseline.signal === null,
    { exitCode: baseline.exitCode, signal: baseline.signal, output: baseline.output }, { exitCode: 0, signal: null });

  const file = join(mirror, probePath);
  const uncovered = await uncoveredForms(mirror);
  const controlSource = probeSource(["const pendingPath = p;", "return adapter.remove(pendingPath);"]);
  await writeFile(file, controlSource, { flag: "wx" });
  const direct = readGuardOutput(mirror);
  check("direct-dot positive control reports the probe file and line", direct.exitCode > 0 && direct.lineNumbers.length > 0,
    { exitCode: direct.exitCode, lineNumbers: direct.lineNumbers }, { exitCode: "nonzero", lineNumbers: "probe source line" });

  for (const form of forms) {
    const source = probeSource(form.lines);
    await writeFile(file, source);
    const observed = readGuardOutput(mirror);
    const lineCount = source.trimEnd().split("\n").length;
    const reported = observed.lineNumbers.some(line => line >= 2 && line < lineCount);
    if (observed.exitCode > 0 && reported) {
      check(form.id, true);
      continue;
    }
    const declared = uncovered.has(form.id);
    const occurrences = observed.exitCode === 0 && declared ? await scanAbsentForm(mirror, form, source) : null;
    const allowedAbsentForm = observed.exitCode === 0 && declared && occurrences?.length === 0;
    check(form.id, allowedAbsentForm, {
      exitCode: observed.exitCode, signal: observed.signal, lineNumbers: observed.lineNumbers, declared, occurrences,
    }, { detection: "nonzero + injected source line", uncovered: "explicit reason + zero source matches" });
    if (allowedAbsentForm) console.log(`B5-23 uncovered ${form.id}: ${uncovered.get(form.id)}`);
  }
  if (failures) process.exitCode = 1;
} catch (error) {
  console.error(`ERROR B5-23\n  actual:   ${error.stack ?? error}\n  expected: mirror and probes can run`);
  process.exitCode = 2;
} finally {
  if (mirror) await rm(mirror, { recursive: true, force: true });
}
