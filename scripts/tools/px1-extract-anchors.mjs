import { readFile, writeFile } from "node:fs/promises";

const source = "evidence/mn5-5.0.2-baseline/BASELINE.json";
const baseline = JSON.parse(await readFile(source, "utf8"));
const anchors = [];
const orphans = [];
const add = (state, element, rect) => {
  const frame = state.windowFrame ?? baseline.viewports[state.viewport].windowFrame;
  anchors.push({ state: state.id, element, rect: [rect[0] - frame[0], rect[1] - frame[1], rect[2], rect[3]], tolerance: 4, viewport: state.viewport });
};
for (const state of baseline.states.filter(item => /^(01|02|03|06|07|08|09|10)-/.test(item.id))) {
  if (/^0[123]-/.test(state.id)) {
    const heading = state.texts.find(item => item.label === "学习集" && item.rect?.[2] === 60.5);
    if (heading) add(state, "home-heading", heading.rect);
    for (const [element, reason] of [["home-card", "基线未提供卡片外框 rect"], ["home-sidebar", "基线未提供侧栏外框 rect"]]) orphans.push({ state: state.id, viewport: state.viewport, element, reason });
    continue;
  }
  const labels = ["书架", "学习集", "场景模板", "文档", "脑图", "收藏", "搜索"];
  const items = labels.map(label => state.buttons.find(button => button.label && (button.label === label || button.label.startsWith(label + ":") || button.label.startsWith(label + "："))));
  for (let index = 0; index < labels.length; index++) {
    if (items[index]?.rect) add(state, `context-item:${labels[index]}`, items[index].rect);
    else orphans.push({ state: state.id, viewport: state.viewport, element: `context-item:${labels[index]}`, reason: "该状态 AX 未记录此项" });
  }
  if (items.every(item => item?.rect)) {
    const first = items[0].rect, last = items.at(-1).rect;
    add(state, "context", [first[0], first[1], last[0] + last[2] - first[0], first[3]]);
  } else orphans.push({ state: state.id, viewport: state.viewport, element: "context", reason: "该状态缺少完整的七项 AX 矩形，无法确定胶囊外接范围" });
  for (const [element, match] of [["attachment", label => label.startsWith("附件 ·")], ["floating:immersiveDocs", label => label === "immersiveDocs"], ["floating:immersiveAI", label => label === "immersiveAI"]]) {
    const button = state.buttons.find(item => item.label && match(item.label));
    if (button?.rect) add(state, element, button.rect);
    else orphans.push({ state: state.id, viewport: state.viewport, element, reason: "该状态 AX 未记录对应按钮 rect" });
  }
  for (const element of ["splitter", "reader-boundary", "map-boundary", "reader-map-gap"]) orphans.push({ state: state.id, viewport: state.viewport, element, reason: "BASELINE.json 未记录对应容器或分隔条 rect" });
}
orphans.push({element:"readerX/readerY",reason:"BASELINE.json 未记录阅读器原点。"}, {element:"header height ≤46",reason:"BASELINE.json 未记录顶栏矩形或高度。"}, {element:"bottom toolbar geometry",reason:"BASELINE.json 未记录能与插件工具栏各项一一匹配的矩形。"});
await writeFile("src/workspace/anchors-502.json", JSON.stringify({source,capturedAt:baseline.capturedAt,coordinateSystem:"window-relative; screen coordinates minus windowFrame origin",viewports:Object.fromEntries(Object.entries(baseline.viewports).map(([name, value]) => [name,value.actual])),anchors,orphans},null,2)+"\n");
console.log(`Extracted ${anchors.length} anchors; ${orphans.length} missing measurements.`);
