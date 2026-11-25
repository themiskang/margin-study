import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { publicFixture } from "./verify/fixtures.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(project);
const source = publicFixture("baseline/BASELINE.json");
const anchorPath = "src/workspace/anchors-502.json";
const baseline = JSON.parse(await readFile(source, "utf8"));
const args = process.argv.slice(2);
if (args.some((arg, index) => arg !== "--out" && (index === 0 || args[index - 1] !== "--out")) || (args.includes("--out") && !args[args.indexOf("--out") + 1])) {
  throw new Error("Usage: node scripts/px-gap.mjs [--out directory]");
}
const out = resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : "evidence/px-gap-502");
const table = JSON.parse(await readFile(anchorPath, "utf8"));
const orphans = [...table.orphans];
const validAnchors = [];
for (const anchor of table.anchors) {
  if (anchor.acceptanceOnly) continue;
  const provenance = anchor.provenance;
  const state = baseline.states.find(item => item.id === provenance?.state);
  const element = provenance?.kind === "baseline-ax" && state && Number.isInteger(provenance.axElementIndex) && ["buttons", "texts"].includes(provenance.collection)
    ? state[provenance.collection]?.find(item => item.axElementIndex === provenance.axElementIndex) : null;
  const origin = state?.containers?.[0]?.rect;
  const last = provenance?.derivation === "first-to-last-button-bounds"
    ? state?.buttons?.find(item => item.axElementIndex === provenance.lastAxElementIndex && item.label === provenance.lastLabel) : null;
  if (!element?.rect || !origin || provenance.state !== anchor.state || provenance.label !== (element.label ?? null) ||
      provenance.coordinateSpace !== "screen" || (provenance.derivation && !last?.rect)) {
    orphans.push({ id: anchor.id, state: anchor.state, viewport: anchor.viewport, excludedFromAnchors: true,
      reason: "来源缺失或未通过 AX 核验；不参与比较。" });
    continue;
  }
  const sourceRect = last ? [element.rect[0], element.rect[1], last.rect[0] + last.rect[2] - element.rect[0], element.rect[3]] : element.rect;
  const rect = sourceRect.map((value, index) => index < 2 ? value - origin[index] : value);
  validAnchors.push({ ...anchor, rect, provenance: { ...provenance,
    offsetApplied: origin.slice(0, 2).map(value => value === 0 ? 0 : -value) } });
}
table.anchors = validAnchors;
const audit = {
  "baseline-ax": validAnchors.filter(item => !item.provenance.derivation).length,
  "baseline-screenshot": 0,
  "baseline-derived": validAnchors.filter(item => item.provenance.derivation).length,
  orphan: orphans.length,
  excluded: orphans.filter(item => item.excludedFromAnchors).length,
  selfComparisonExcluded: orphans.filter(item => item.selfComparison).length,
  selfComparisonIncluded: 0
};
const temp = await mkdtemp(join(project, "node_modules", ".px-gap-"));
const fixture = await readFile("src/workspace/acceptance.mjs", "utf8");
const prefix = fixture.slice(0, fixture.indexOf("async function pageCdp()"))
  .replace('dirname(fileURLToPath(import.meta.url))', JSON.stringify(join(project, "src/workspace")));
const output = join(temp, "measurements.json");
const runner = `${prefix}
const anchors=${JSON.stringify(table.anchors)};
const viewports=${JSON.stringify(table.viewports)};
const measured={};
try {
  await browser("open","about:blank");
  await browser("set","viewport","1512","851");
  await browser("open",\`http://127.0.0.1:\${server.address().port}\`);
  const deadline=Date.now()+(process.env.MARGINSTUDY_BROWSER==="ego"?300000:90000);
  for (;;) {
    const status=JSON.parse((await browser("eval","({done:window.done,fatal:window.fatal})")).stdout);
    if(status.fatal) throw new Error(JSON.stringify(status.fatal));
    if(status.done) break;
    if(Date.now()>deadline) throw new Error("Fixture initialization timed out");
    await new Promise(done=>setTimeout(done,400));
  }
  for(const viewport of Object.keys(viewports)) {
    await browser("set","viewport",...viewports[viewport].map(String));
    const states=[...new Set(anchors.filter(anchor=>anchor.viewport===viewport).map(anchor=>anchor.state))];
    for(const state of states) {
      let scene;
      if(/^0[123]-/.test(state)) scene="showA30HomeScene";
      else if (/^(?:0[6789]|11)-/.test(state) || /^10-minimal/.test(state) || state==="12-document-menu") scene="showA30Scene";
      else continue;
      const selectors=anchors.filter(anchor=>anchor.viewport===viewport&&anchor.state===state).map(anchor=>anchor.selector);
      const expression=\`(async()=>{await window[\${JSON.stringify(scene)}]();const state=\${JSON.stringify(state)};if(/^07-/.test(state)){const node=document.querySelector('.ms-node[data-id="beta-node"]');if(!node)return null;node.click()}if(/^08-/.test(state)){const toggle=document.querySelector('[aria-label="immersiveDocs"]');if(!toggle)return null;toggle.click()}if(/^10-minimal/.test(state)){const handle=document.querySelector('.ms-clean-view-handle');if(!handle)return null;handle.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))}if(state==="12-document-menu")document.querySelector('.ms-workspace-context [aria-label^="文档："]').click();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));if(/^07-/.test(state)&&!document.querySelector('.ms-node.is-selected'))return null;if(/^08-/.test(state)&&!document.querySelector('.ms-document-navigation'))return null;if(/^10-minimal/.test(state)&&!document.querySelector('.ms-study-workspace.is-clean-view'))return null;return \${JSON.stringify(selectors)}.map(selector=>{const element=document.querySelector(selector);if(!element||!element.checkVisibility())return null;const rect=element.getBoundingClientRect();return [rect.x,rect.y,rect.width,rect.height]})})()\`;
      const result=JSON.parse((await browser("eval",expression)).stdout);
      if(result) measured[state]=result;
    }
  }
  await writeFile(${JSON.stringify(output)},JSON.stringify(measured));
} finally {
  await browser("close").catch(()=>{});
  await new Promise(done=>server.close(done));
}
`;
try {
  const runnerPath = join(temp, "runner.mjs");
  await writeFile(runnerPath, runner);
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [runnerPath], { cwd: project, maxBuffer: 4 * 1024 * 1024, timeout: process.env.MARGINSTUDY_BROWSER === "ego" ? 360000 : 180000, env: process.env });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  const measured = JSON.parse(await readFile(output, "utf8"));
  const indices = {};
  const rows = table.anchors.map(anchor => {
    const index = indices[anchor.state] ?? 0;
    indices[anchor.state] = index + 1;
    const actual = anchor.state in measured ? measured[anchor.state][index] : null;
    const optionalAbsent = !actual && table.optionalAnchorIds?.includes(anchor.id);
    const skipped = !(anchor.state in measured) || optionalAbsent;
    const missing = !skipped && !actual;
    const delta = actual ? Object.fromEntries(["dx", "dy", "dw", "dh"].map((key, position) => [key, Math.round((actual[position] - anchor.rect[position]) * 100) / 100])) : null;
    const maxDelta = delta ? Math.max(...Object.values(delta).map(Math.abs)) : null;
    return { id: anchor.id, state: anchor.state, viewport: anchor.viewport, surface: anchor.surface, selector: anchor.selector, provenance: anchor.provenance, target: anchor.rect, actual, delta, maxDelta, tolerance: anchor.tolerance, exceedsTolerance: maxDelta !== null && maxDelta > anchor.tolerance, missing, skipped, ...(skipped ? { reason: optionalAbsent && anchor.state in measured ? "状态依赖：仅当附件存在时校验" : "夹具尚未复现该基线状态" } : missing ? { reason: "选择器未找到可见元素" } : {}) };
  });
  const counts = { total: rows.length, passed: rows.filter(row => !row.skipped && !row.missing && !row.exceedsTolerance).length, exceeded: rows.filter(row => row.exceedsTolerance).length, missing: rows.filter(row => row.missing).length, skipped: rows.filter(row => row.skipped).length };
  const ranked = rows.filter(row => row.maxDelta !== null).sort((a, b) => b.maxDelta - a.maxDelta);
  const escape = value => String(value).replaceAll("|", "\\|");
  const lines = ["# MN5 5.0.2 几何差距", "", "## 来源审计", "", `baseline-ax：${audit["baseline-ax"]}；baseline-screenshot：${audit["baseline-screenshot"]}；baseline-derived：${audit["baseline-derived"]}；orphan：${audit.orphan}；本次剔除：${audit.excluded}。`, "", "基线为屏幕坐标，已按各状态窗口原点换算；因此 Δ=0 表示真实一致。整体 context 的目标为基线首尾按钮外接范围，并非直接测得的容器外框。", "", `已确认的自比项：剔除 ${audit.selfComparisonExcluded} 条，纳入 ${audit.selfComparisonIncluded} 条；其余缺失来源的剔除项无法据此判定是否自比。`, "", `总数：${counts.total}；通过：${counts.passed}；超差：${counts.exceeded}；缺失：${counts.missing}；跳过：${counts.skipped}。`, "", "坐标为窗口相对坐标；Δ 为实际值减基线值，单位 px。平均值按已测项目的 maxDelta 计算。缺失和跳过不计入平均值及超差。", "", "夹具模拟 Obsidian 宿主；文档菜单使用夹具的 #test-menu，几何不代表原生 Obsidian 菜单。", "", "## 按面汇总", "", "| 面 | 已测 | 平均 Δ | 最大 Δ | 缺失 | 跳过 |", "| --- | ---: | ---: | ---: | ---: | ---: |"];
  for (const surface of ["主页", "工作区", "胶囊", "分隔条", "浮动按钮", "面板"]) {
    const group = rows.filter(row => row.surface === surface), values = group.filter(row => row.maxDelta !== null).map(row => row.maxDelta);
    lines.push(`| ${surface} | ${values.length} | ${values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2) : "—"} | ${values.length ? Math.max(...values).toFixed(2) : "—"} | ${group.filter(row => row.missing).length} | ${group.filter(row => row.skipped).length} |`);
  }
  const renderRows = list => list.map(row => `| ${escape(row.id)} | ${escape(row.state)} | ${row.viewport} | ${row.maxDelta.toFixed(2)} | ${Object.values(row.delta).join(", ")} | ${row.exceedsTolerance ? "超差" : "通过"} |`);
  lines.splice(2, 0, "本轮为 PX-3 修复后版本", "");
  const header = ["| 锚点 | 状态 | 视口 | maxDelta | dx, dy, dw, dh | 结果 |", "| --- | --- | --- | ---: | --- | --- |"];
  lines.push("", "## 最差 10 项", "", ...header, ...renderRows(ranked.slice(0, 10)), "", "## 全部已测项目（按 maxDelta 降序）", "", ...header, ...renderRows(ranked), "", "## 缺失与跳过", "", ...rows.filter(row => row.missing || row.skipped).map(row => `- ${row.id} / ${row.state} / ${row.viewport}：${row.reason}`), "");
  await mkdir(out, { recursive: true });
  const coordinateConversion = { baselineSpace: "screen", domSpace: "window-relative", offset: "per-state window origin" };
  await writeFile(join(out, "gap.json"), JSON.stringify({ coordinateConversion, audit, counts, rows, orphans }, null, 2) + "\n");
  await writeFile(join(out, "gap.md"), lines.join("\n"));
  console.log(JSON.stringify(counts));
  if (counts.exceeded) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
