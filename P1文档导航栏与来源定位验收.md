# P1 文档导航栏与来源定位验收

更新：2026-10-17。本阶段把顶部书本入口改为阅读区内的五标签导航，完成下表列明的浏览和来源定位范围。最终构建已装到 MarginStudy验收库并通过实际插件停用/启用复核。整体功能、视觉与模板仍未全面等价，清单 05—08、14、16 不勾为完成。

## 原版依据与本次实现

原版运行版本为 MN4 4.4.6，证据 128—140；[官方导航手册](https://manual.marginnote.com.cn/mn4/search-view-document-table-contents-thumbnails/) 的文本快照在 `evidence/official-sources/manual-document-navigation.txt`。原版实机、官方描述、插件自动回归分别记录，不把某一来源扩大为全部操作已通过。

| 范围 | 已实现与验证 | 尚未覆盖 |
|---|---|---|
| 布局与入口 | 顶部“文档目录与书签”书本按钮开关阅读区右侧导航；五标签与文档标签同一行，依次为目录、缩略图、书签、手写标注、卡片 | 原版所有按钮间距、字体、菜单、底栏及尺寸组合未做完整像素验收 |
| PDF 浏览 | 真实 PDF 目录数据；两列缩略图、统一纸框且旋转页不拉伸；点击定位；书签仅列已收藏页面 | 原版空目录的 AI TOC、目录编辑；文档重组与长按拖动 |
| 非 PDF 目录 | HTML、Markdown、静态 EPUB、Word 标题目录与章节定位；换文档清除旧目录 | 实际 Word 样例无标题，本轮实机仅验证空态；标题点击由合成 Word 回归覆盖。复杂格式、动态内容仍待验收 |
| 标注与卡片 | 当前笔记本文字/笔迹预览，点击定位原页；当前文档的来源卡片与定位，保留异步 Markdown 渲染后的附图 | 原版 Cards 的 Select、排序等底栏操作，全部筛选/多选状态及媒体组合 |
| 状态可靠性 | 切文档取消旧预览与订阅；导航标签保存；手动缩放开关导航保持；适应宽度随导航空间变化；插件重载恢复标签、活动文档、位置与缩放 | 适应宽度意图只在当前阅读器内保存，夹到最小缩放的双页 fit 模式没有跨重载契约或实机验收 |

页码、缩放等既有工具移到“文档与工作区设置 → 阅读与批注的全部工具”。书本按钮不再打开旧纵向工具列表。该列表和原版 Document 系统菜单的顺序、分组、禁用条件仍有差距。

实现使用插件自己的文档、批注、卡片与工作区模型，没有复制原版类名、CoreData 或私有 API。新增模块为 `src/workspace/documentNavigation.ts`，阅读器通过自有公开接口提供目录、页预览和定位。

## 复现与修复

- 导航最初没有按原版构成阅读区分栏；新增五标签布局、来源过滤、状态恢复和任务清理。失败记录为 `document-navigation-panel-red`、`pages-red`、`notes-red`、`width-red`、`headings-red`（均带 `document-navigation-` 前缀）。
- Word 目录点击在加载/重绘期间引用了旧节点。保留 `document-navigation-word-first-failure` 和 `document-navigation-word-target-only-failure`，修复 loadedPath 加载顺序与有效节点定位。
- 导航开关会重新适应宽度而改变用户手动缩放。`document-navigation-manual-zoom-red` 先失败；改为仅当阅读器处于适应宽度时重新计算。
- 双页适应宽度在窄导航下夹到最小缩放，关闭后曾不能恢复。`document-navigation-spread-fit-red` 复现后，阅读器保存当前实例内的 fit 意图；整个双页宽度包含页间距和内边距。没有新增持久化标志。
- 旋转页曾改变缩略图纸框高度。`document-navigation-thumbnail-frame-red` 复现；固定纸框，用 contain 保持页图比例。测试先修正了误把默认 canvas 宽度当加载完成的判断，然后才记录真正纸框失败。
- 宿主异步 Markdown 渲染曾清掉来源卡片附图。`document-navigation-media-red` 复现；渲染完成后只在当前有效任务中追加图片，并用可延迟渲染的宿主替身防回归。

双页回归也先修正测试遗漏的页间距，再确认真正 fit 恢复缺陷。PDF 目录自动用例选择中间页避开滚动底部限制，不表示最后一页总能顶端对齐。

## 自动验收

最终完整运行：**2026-10-16 17:40:27 UTC（北京时间 10 月 17 日）**，20 套件全部通过。工作区 **66/66**，阅读器 **78/78 组**，组织 UI 17、复习 UI 34、AI UI 18。

稳定结果、20 套件日志、工作区截图和阅读器结果保存在 [最终通过目录](evidence/verification/document-navigation-final-green/results.json)。统一入口仍为 [统一结果](evidence/verification/results.json)。工作区主要使用合成文档和宿主生命周期替身；阅读器另有真实 PDF.js Worker 回归。计数不代表 MN4 覆盖率，隔离浏览器不替代实际 Obsidian 验收。

## 原版与真实 Obsidian

| 证据 | 实际结果与边界 |
|---|---|
| MN4 128—135 | Document 菜单、目录分栏、书签空态、Annotations、Cards 与来源卡定位；130—131 是切换中间态，书签稳定结果以 132 为准 |
| MN4 136—140 | 文字与一次性笔迹区域预览、四个等高缩略纸框、点击第 3 页、加入书签后仅该页出现；未宣称原版 Go to Page 输入流程已完整重放 |
| 插件 144—146 | 四个统一纸框；关/开导航保留手动 0.36 缩放，活跃状态依据 host-state 文件；145 的旧插件 data 快照不能作为实际缩放依据 |
| 插件 147—150 | 从书签空列表给第 3 页添加书签，仅出现该页；点击后正文 Chapter 2 位于顶部；再次取消后恢复空列表 |
| 插件 151—154 | 152 为文字来源与富文字预览稳定状态；153 新建一次性黄色笔迹并点预览回原页；154 顶部撤销后预览消失、恢复手形。151 是定位中间态 |
| 插件 155—158 | U2 来源卡回第 1 页；切 HTML 不残留 PDF 来源卡；“能量转换”章节定位通过；Word 无标题时为空目录，无 HTML 残留 |
| 插件 159—163 | 关/开导航、通过设置停用/启用插件并重开后，四标签、活动 PDF、第 3 页、0.432 缩放和缩略图标签均保持；163 有最终完整 AX 与截图 |

截图和 AX 见 [实机索引](evidence/native-max-l4/README.md)。原版与插件的页码、选区、缩放和卡片内容并非始终相同，没有据此声称整图像素一致。

## 数据比较与已知空记录

[最终数据比较](evidence/native-max-l4/164-navigation-reload-comparison.json) 的 16 项限定检查通过：

- 159/160/161 的导航开关只改变可见标志；161、162 保存状态、163 重载状态及最终宿主状态完整相同。
- 停用前后到最终重载的四源文档与四 sidecar 摘要相同。整个最终实机测试期间，四源文档、三个非 PDF sidecar 和 11 个核心模型区段保持基线；PDF 原有三条批注逐项相同。
- 四部署文件与最终安装凭证一致，原开发 main.js 与 yan 正式插件 main.js 保持开发前摘要。

**不宣称整个阶段 data.json 和 PDF sidecar 字节不变。** 添加再取消书签留下 `docMeta[PDF].bookmarks: []`；一次性笔迹撤销后留下空 pen 容器 `ann-mvb9jx0m-z47ea4`，其 `strokes: []`，界面没有测试笔迹，但这是撤销清理的已知缺口。没有手工删除或恢复 sidecar 来制造撤销完全恢复的结果。工作区位置与导航选择也随测试有意变化。

PDF 基线由最终测试前的真实摘要与旧备份中完全匹配的副本建立；旧 `20261016-document-navigation-before/baseline-hashes.json` 实际为空，没有用作摘要证据。比较可在当前合成样例上用 `python3 scripts/compare-navigation-evidence.py` 重放；之后若修改样例，应先另存本报告和比较结果。

## 部署、回退与继续工作

[最终安装凭证](evidence/checkpoints/20261017-document-navigation-final-deployment.json) 对应 main.js 摘要 `acb6ae944812f48114a937cf87c7a057eef6796c8f08a9ccceb1d6b7b004dee6`。更早 `20261017-document-navigation-deployment.json` 为修复前历史凭证。仅验收库安装了开发版，未复制 Claudian API 配置。

阶段前构建在 `evidence/checkpoints/20261016-document-navigation-before/`；通过宿主设置停用插件后恢复其中 main.js、styles.css、manifest.json、pdf.worker.js，再启用即可回退程序。不要覆盖后续主数据或 sidecar。

本阶段固定快照为 `evidence/checkpoints/20261017-document-navigation-verified.tar.gz`，摘要与范围在同目录 `20261017-document-navigation-snapshot.json`，源码与证据索引见 [检查点](verification-checkpoint.json)。

下一步先补 Document 菜单的分组、状态与实际动作，并处理撤销空笔迹的清理；随后核对目录编辑/AI TOC、Cards 底栏及卡片模板。AI TOC、目录编辑、长按拖到标签栏重组和 Cards Select/排序当前未实现，未放置无功能按钮。脑图默认卡片密度、透明文字覆盖/重排语义和全部尺寸组合继续保留为差距。本阶段未派发新辅助任务，无需用户转交 Qoder 文件。
