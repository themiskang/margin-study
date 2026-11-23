import { rejects } from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";

await run();

async function run() {
  const project = resolve(process.argv[2] ?? process.cwd());
  const revision = process.argv[3] ?? "HEAD";
  const scratch = join(project, ".tmp", "guard-controls");
  const guardPath = "scripts/verify/recovery-delete-guard.mjs";
  const probePath = "src/__guard_extra.ts";
  const cases = [
    ["reflect-apply", "return Reflect.apply(adapter.remove, adapter, [p]);"],
    ["optional-chain", "return adapter?.remove?.(p);"],
    ["comma-call", "return (0, adapter.remove)(p);"],
    ["call-bind", "const invoke = Function.prototype.call.bind(adapter.remove);\n  return invoke(adapter, p);"],
    ["dynamic-import", 'const io = await import("node:fs");\n  return io.unlink(p, (error: any) => { if (error) throw error; });'],
  ];
  let failures = 0;
  let mirror;

  function check(label, passed, actual, expected) {
    if (passed) console.log(`PASS B5-25 ${label}`);
    else {
      failures++;
      console.error(`FAIL B5-25 ${label}\n  actual:   ${inspect(actual, { depth: null })}\n  expected: ${inspect(expected, { depth: null })}`);
    }
  }

  function guard() {
    const child = spawnSync(process.execPath, [join(mirror, guardPath), mirror], { cwd: mirror, encoding: "utf8" });
    if (child.error) throw child.error;
    return { exitCode: child.status, signal: child.signal, stderr: child.stderr };
  }

  try {
    const archive = execFileSync("git", ["archive", revision, "src", "scripts", "package.json", "tsconfig.json"], {
      cwd: project, maxBuffer: 48 * 1024 * 1024,
    });
    await mkdir(scratch, { recursive: true });
    mirror = await mkdtemp(join(scratch, "run-"));
    execFileSync("tar", ["-xf", "-", "-C", mirror], { input: archive });
    await symlink(join(project, "node_modules"), join(mirror, "node_modules"), "dir");
    const { scanProject } = await import(pathToFileURL(join(mirror, guardPath)).href);
    const baseline = await scanProject(mirror);
    const baselineRun = guard();
    check("unmodified mirror passes the guard", baselineRun.exitCode === 0 && baseline.violations.length === 0,
      { exitCode: baselineRun.exitCode, violations: baseline.violations, stderr: baselineRun.stderr }, { exitCode: 0, violations: [] });

    const probe = join(mirror, probePath);
    for (const [name, body] of cases) {
      await writeFile(probe, [
        "export async function probe(adapter: any, doc: string) {",
        '  const p = `_marginstudy-recovery/pending-merge-tx-${doc}.json`;',
        `  ${body}`,
        "}",
        "",
      ].join("\n"));
      const observed = guard();
      const reports = [...new Set(observed.stderr.match(/src\/__guard_extra\.ts:\d+/g) ?? [])];
      check(name, observed.exitCode > 0 && reports.length > 0,
        { exitCode: observed.exitCode, signal: observed.signal, reports },
        { exitCode: "nonzero", reports: [`${probePath}:<line>`] });
    }

    await rm(probe);
    const sourcePath = "src/model/store.ts";
    const fullPath = join(mirror, sourcePath);
    const source = await readFile(fullPath, "utf8");
    const site = "    await this.host.app.vault.adapter.remove?.(file).catch(() => {});";
    const index = source.indexOf(site);
    if (index === -1 || source.indexOf(site, index + site.length) !== -1) throw new Error("Expected exactly one baseline deletion expression");
    const firstLine = source.slice(0, index).split("\n").length;
    const locations = [firstLine, firstLine + 1].map(line => `${sourcePath}:${line}`);
    await writeFile(fullPath, source.replace(site, `${site}\n${site}`));
    const duplicate = await scanProject(mirror);
    const observed = guard();
    const expectedCount = baseline.allFindings.length + 1;
    const staticReport = duplicate.violations.some(entry => locations.some(location => entry.startsWith(`${location} `)));
    const cliReport = locations.some(location => observed.stderr.includes(`${location} `));
    check("duplicate allowlisted expression must add a site and be rejected by the static guard",
      duplicate.allFindings.length === expectedCount && staticReport && cliReport && observed.exitCode > 0, {
        baselineSites: baseline.allFindings.length, scannedSites: duplicate.allFindings.length,
        matchedCount: duplicate.matchedCount, violations: duplicate.violations, exitCode: observed.exitCode,
        reportsDuplicateLocation: cliReport, stderr: observed.stderr,
      }, { scannedSites: expectedCount, staticViolation: locations, exitCode: "nonzero", reportsDuplicateLocation: true });
    if (failures) process.exitCode = 1;
  } catch (error) {
    console.error(`ERROR B5-25\n  actual:   ${error.stack ?? error}\n  expected: mirror and source probes can run`);
    process.exitCode = 2;
  } finally {
    if (mirror) {
      await rm(mirror, { recursive: true, force: true });
      await rejects(lstat(mirror), { code: "ENOENT" }, `Mirror still exists: ${mirror}`);
    }
  }
}
