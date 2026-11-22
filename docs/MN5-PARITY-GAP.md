# MarginNote 5.0.2 差距

更新于 2026-11-22。实现、合成断言与对应实机证据齐备后关闭差距。采集版本、平台或范围豁免写入对应验收记录。GAP 编号沿用规划席方案。

| 编号 | 差距 | 状态 | 验收条件 | 优先级 |
| --- | --- | --- | --- | --- |
| GAP-01 | 卡 A，冷重启写盘与旧构建升级 | 已验收 8/8，适用范围见 [卡 A 收口](archive/progress/progress-legacy-202611.md#卡-a-收口--pass-88) | 新导入库重启零写盘。真实 `f78573e` 旧库首次写盘收敛，再次重启零写盘。核对主文件、备份、索引和范围豁免。 | P0 |
| GAP-02 | 卡 B，`save-now` 冲突无反馈 | 已修复，合成桌面宿主执行验收 8/8，待实机复核 | 触发并发冲突后展示明确提示和恢复入口，保全较新的外部写入，自动用例全绿。 | P0 |
| GAP-EGO-01 | ego-harness 适配 ego-browser 后端 | 待办（GAP-07a 实测触发） | ego 后端下 `verify:public` 48/53、`px-gap` fixture 初始化超时。根因五条：① 严格选择器遇重复元素报 `ElementResolutionError`（需 nth/first 语义）② `deviceScaleFactor:2` 致像素 4 倍 ③ 每次调用拉起 `ego-browser nodejs` 子进程（379 次/跑）致超时 ④ 跨子进程鼠标拖拽坐标归零 ⑤ 暗色主题与 DPR=2 下断言基线差异。验收：ego 后端下 `verify:public` 53/53、`px-gap` 292/298 且 top-3 3px/4px，与默认后端一致。 | P1 |
| GAP-03 | 卡 C，`pdf-hw-eraser` 间歇失败 | **已修复（C2 PASS）**：根因为留白几何的权威写入排在重型预览渲染之后（`extendNotes.ts` 的 `commitNotes`），高负载下突破夹具裸 `wait(80)`。修法：几何同步提交在前 → 权威写入 → 预览异步生成（失败只发 Notice）；夹具改条件等待 + 两帧诊断；新增 `extendGeometry` 延迟单测。**附带修复**：`hw-eraser-acceptance.mjs` 的夹具注入自 `2bfb044`（2026-11-15 `const`→`let`）起匹配零次，两组断言从未运行，断言数 245→247。验收：受控负载 30/30、低负载 10/10、`px-gap` 298 行零差异、主树连续两轮 `verify:public` 各 53/53 且 `pdf-hw-eraser` 247/247。 | P0 已完成 |
| GAP-04 | 编辑器内容坐标偏差 | **已核对，未复现**（合成宿主 A1/A2/A3 偏差 0 px；真实隔离库 A4 最大轴差 0.5 px；`px-gap` 三轮同为最大差 3 px / 阈值 4 px，节点 `.ms-study-home-screen .ms-native-popover-head strong`，`exceedsTolerance=false`）。余量仅 1 px，列为跟踪项 | 在缩放、滚动与编辑状态下，坐标与渲染边界偏差 ≤2 px，点击、选区和批注定位全部命中。复核文本框字号、越界把手与窄页裁字。 | P1 |
| GAP-05 | A23 三按钮实机可达性 | 合成验收有记录，待实机 | 逐个验证可见、无遮挡、真实点击及状态变化。按 [遮挡审计](specs/overlap-audit.md) 补测滚动控件、窄页签与各视口次文字色。页签状态沿用审计原文。 | P1 |
| GAP-06a | PDF-01，桌面导入通道与错误反馈 | **已验收**：系统选择器（Electron `showOpenDialog`）+ 直接路径输入（`data-ms-import-path-input`/`submit`）+ 六类失败原因可判定提示 + 同名冲突三选一复用。异厂复核（antigravity）PASS，A1–A7 全过。附带修复：暂存改名不再回滚学习集成员。业主 5 项实机签收未覆盖（TCC 弹窗、真实 NSOpenPanel 多选/取消、iCloud 占位、只读卷、Finder 粘贴路径） | 系统选择器和直接路径均可载入并生成摘录。权限拒绝或路径无效时显示原因。复核文件选区级合并、撤销及真实宿主导入。 | P1 |
| GAP-06b | PDF-01，文件选区级合并与撤销复核 | **已核对，零代码结案**（A1/A2/A4/A5/A6 全成立；A3 经异厂复核判定**断言超范围**并已修订，见下） | A1 合并后独立卡片 −1、主卡 sources=2、两段矩形与页码偏差 0；A2 `undo→redo→undo` 三态 `diff=∅`；A4 源与库内原件 `SHA/size/mtime` 全等且导出写独立路径；A5 两路重载无幽灵；A6 `verify:public` 53/53、`px-gap` 292/298。**A3 修订依据**：`src/documents/acceptance-fixtures/pageCollectionCases.txt:75` 的冻结回归要求「map live excerpts, snapshot other notes」（摘录实时链接、其他笔记才快照）且断言源 PDF 未被写；`D-05` 记录 MN5 仅有「追加到末尾/拼成新文档」，无「把摘录副本写进无关 PDF」。故 A3 原断言（目标文档落盘文本摘录副本）超出产品形态，不得据此判失败 | P1 |
| GAP-06c | PDF-01，合并入口撤销与批注携带一致性 | 待办（复核席建议的最小补齐项） | `openMergeIntoDocument` 的撤销栈覆盖与 PDF/`.msref` 批注携带一致性。 | P1 |
| GAP-07a | PDF-02，MN5 对齐的图层能力 | **已验收，异厂复核两轮 PASS 7/7**。①`Handwriting on Top` 层叠阶梯 `ann/ink 2..4 < handles(5) < extend(6) < floating(≥10)`，非手写态 ink `pointer-events:none`，导出仅调 `flattenPdfAnnotations` 绘制顺序（ON 态手写算子偏移 261 < 高亮 467）；②`Blank Background` 独立 `.ms-blank-bg`，底图 ΔRGB=223、几何与 pageCrop 投影 0 偏差、批注层 Δ=0；③独立阅读器留白入口 `data-ms-reader-extend-btn`（30×30），与工作区状态双向同步；④`bindToInkLayer?: boolean`：`undefined` 视为 `true`，`false` 为全层公共（可见可交互、`/ca 1` 不进 0.35、删层零误删、显示与导出同一过滤）。首轮 FAIL 为句柄被笔迹视觉遮挡（像素采样发现，`elementFromPoint` 仍命中故不可由命中断言发现），`a0f141b` 修复后复判通过。宿主证据：Obsidian 1.15.1 加载 `pluginLoaded=true`、命令 41 条（首页隐 `export-edited-pdf` 故列 40）、异常 0。**业主实机签收项未计入**（Pad 手感、肉眼观感、窄分屏）。 | P1 已完成 |
| GAP-07b | PDF-02，文本框/图片绑定手写层的完整语义 | 待定标 | 绑定层随宿主对象移动/缩放/删除时的跟随与导出语义。 | P1 |
| GAP-07c/d | PDF-02，逐层显隐/锁定/z-order | **超 MN5 增强，后置登记** | 探查确认 7 维属 MN5 之外的增强（MN5 无 Photoshop 式逐层控制）。仅在用户明确要求时排期。 | P3 |
| HOST-P2 | 宿主弹窗销毁卫生 | 待排查 | 1.12.7 基线宿主整轮抛 7 次 `e.isShown is not a function`（`app.js:1`，栈内无插件帧）；1.15.1 上未复现。属宿主自定义 modal 销毁边界。 | P2 |
| GAP-08 | PDF-03，套索选择 | 待核对 | 圈选笔迹和区域后验证移动、删除、转摘录、解绑保全及撤销重做。逐条复核工具条与实际菜单动作。 | P1 |
| GAP-09 | PDF-04，简洁显示 | 已有合成覆盖，待实机 | 循环验证三态、快捷键、重载与精简笔条。复核长按阈值、状态栏模板默认值和窄窗可达性。 | P1 |
| GAP-10 | YAN-01，R2–R10 锚点 | 待核对 | 九个锚点全部落在目标可见区，页码和偏移符合对应验收阈值。复核跨页、改名、工作区重开和缺源恢复。 | P1 |
| GAP-11 | YAN-02，冷启动耗时 | 待采样 | 五次干净冷启动的中位数、P95 符合验收阈值，首屏可交互。另记录大型学习集、书脊及 PDF 渲染的规模和性能。 | P2 |
| GAP-12 | A3，379 项原生菜单与场景对齐 | 等待 MN5 5.0.2 原生采集 | 按 [采集计划](specs/mn502-capture-plan.md) 和 [菜单矩阵](specs/page-menu-state-matrix.md) 逐项比对标签、顺序、图标、启用态、快捷键和动作。剩余宿主差异写入 [架构决策](architecture/decisions-mn502.md)。 | P2 |
| GAP-13 | A6，Pad 全流程验收 | Pad 离线 | 真机验证触控、笔压、掌触、分屏、同步与导出，逐项保存证据。另按设备核实 Sidecar、数位笔和 OPPO 真笔。 | P2 |

## GAP-12 的规格基线

以下待核范围归到 GAP-12 的对应表面。采集表按原规格的条目编号保留来源。

- **工作区与组织**。场景模板和工具位置、书脊封面及键盘浏览、目录折页键位、同步中心真实分组、脑图连线和拖放、卡片与模板矩阵。核对场景探测登记的 3 项容器差异、1 项行为差异及 10 项标签差异。阅读场景的书签、笔尖与回忆入口单列复核。
- **摘录与复习**。首次摘录定位与重复摘录撤销、遮挡默认值、长复习卡快照与手写、键盘与收尾菜单、自由形状遮挡。实现清单中的 **I-04** 指长复习卡，按 [实现差异](architecture/implementation-deltas.md#i-04--长复习卡显示策略d-11影响最大) 对照，GAP-04 保留规划席的编辑器坐标定义。
- **导入、导出与系统能力**。大包和重复 ID、专有格式兼容、百度网盘真实授权与大文件、复杂网页和登录态、AI 与 Claudian 实机链路、OCR 与录音、图库与相机边界、真实跨端同步。记录每项的设备、宿主和数据条件。

## 来源

- [全量表面与验收定义](specs/full-mn5-replication.md) · [5.0.2 增量](specs/mn5-5.0.2-delta.md) · [实现差异](architecture/implementation-deltas.md)
- [历史工作清单](archive/progress/backlog-20261026.md) · [历史进度](archive/progress/progress-legacy-202611.md) · [遮挡审计](specs/overlap-audit.md)
- `当前功能与剩余差距.md` 和 `scene-tools-gaps.json` 的原件可从整理前提交 `59bc94f` 追溯。
