import { readFile, writeFile } from "node:fs/promises";
import { publicFixture } from "../verify/fixtures.mjs";

const path = "src/workspace/anchors-502.json";
const table = JSON.parse(await readFile(path, "utf8"));
const baseline = JSON.parse(await readFile(publicFixture("baseline/BASELINE.json"), "utf8"));
const selectors = {
  "书架": '[aria-label="打开学习集与文档"]',
  "学习集": '[aria-label^="学习集："]',
  "场景模板": '[aria-label^="场景模板："]',
  "文档": '[aria-label^="文档："]',
  "脑图": '[aria-label^="脑图："]',
  "收藏": '[aria-label="收藏"]',
  "搜索": '[aria-label="全局搜索"]'
};
const labels = Object.keys(selectors);
const remaining = [];
let restored = 0;
for (const orphan of table.orphans) {
  if (!orphan.selfComparison || !(orphan.id === "context" || orphan.id?.startsWith("context-item:"))) {
    remaining.push(orphan);
    continue;
  }
  const state = baseline.states.find(item => item.id === orphan.state);
  const origin = state?.containers?.[0]?.rect?.slice(0, 2);
  const buttons = labels.map(label => state?.buttons?.find(button => button.label &&
    (button.label === label || button.label.startsWith(label + ":") || button.label.startsWith(label + "："))));
  const label = orphan.id === "context" ? "书架" : orphan.id.slice("context-item:".length);
  const item = buttons[labels.indexOf(label)];
  if (!origin || !item?.rect || (orphan.id === "context" && buttons.some(button => !button?.rect))) {
    remaining.push(orphan);
    continue;
  }
  const last = buttons.at(-1);
  const rect = orphan.id === "context"
    ? [item.rect[0], item.rect[1], last.rect[0] + last.rect[2] - item.rect[0], item.rect[3]]
    : item.rect;
  const provenance = { kind: "baseline-ax", state: state.id, collection: "buttons",
    label: item.label, axElementIndex: item.axElementIndex, coordinateSpace: "screen",
    offsetApplied: origin.map(value => value === 0 ? 0 : -value),
    ...(orphan.id === "context" ? { derivation: "first-to-last-button-bounds",
      lastAxElementIndex: last.axElementIndex, lastLabel: last.label } : {}) };
  table.anchors.push({ state: state.id, element: orphan.id,
    rect: rect.map((value, index) => index < 2 ? value - origin[index] : value),
    tolerance: 4, viewport: orphan.viewport, id: orphan.id,
    selector: orphan.id === "context" ? ".ms-workspace-context" : `.ms-workspace-context ${selectors[label]}`,
    surface: "工作区", provenance });
  restored++;
}
table.orphans = remaining;
for (const anchor of table.anchors) {
  const state = baseline.states.find(item => item.id === anchor.provenance.state);
  const origin = state?.containers?.[0]?.rect?.slice(0, 2);
  if (!origin) throw new Error(`Missing window origin: ${anchor.state}`);
  anchor.provenance.coordinateSpace = "screen";
  anchor.provenance.offsetApplied = origin.map(value => value === 0 ? 0 : -value);
}
table.coordinateSystem = "window-relative; baseline screen coordinates minus per-state window origin";
await writeFile(path, JSON.stringify(table, null, 2) + "\n");
console.log(`restored=${restored} anchors=${table.anchors.length} excluded=${remaining.filter(item => item.excludedFromAnchors).length}`);
