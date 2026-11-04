# P0 界面与工作区恢复阶段验收

日期：2026-10-16。对应 [后续工作清单](后续工作清单.md) 01—03。主代理独立修改、检查和实机验收；没有派发新的辅助任务，没有向 Qoder 发送任务书。

开发版只装在 MarginStudy验收库，实机宿主为 Obsidian 1.14.4。版本文字勘误：实际 manifest 与宿主插件列表均为 1.2.12，package.json 为 0.2.0；之前把 package 版本误写成 manifest 版本。构建以实际部署文件摘要与禁用/启用后运行行为确认，见 [检查点](verification-checkpoint.json)。

## 本阶段完成的行为

| 清单 | 修复与结果 | 实际验收 |
|---|---|---|
| 01 菜单遮挡 | 脑图滚动视口位于顶部选择条下方，长名称单行省略，卡片不再滚到选择条点击区下面 | 实际拖动滚动条，把根卡菜单移到视口顶部边界；按截图位置点击，打开的是卡片菜单。选择条打开脑图菜单，关闭后卡片菜单仍正常；证据 30、42 |
| 02 看板 Markdown | 使用 Obsidian 自身的 MarkdownRenderer；渲染组件随视图重绘/关闭释放，来源路径参与链接解析，失败保留原文 | 合成笔记的粗体、二级标题、列表在编辑预览、脑图和看板呈现；保存及插件重载后保留，底层 Markdown 未改写；证据 28—31、37—42 |
| 03 文档恢复 | 保存独立工作区状态，缺少宿主标签状态时恢复；显式空标签保持为空。缓存最近有效阅读位置，在隐藏/分离/样式已移除时不误写顶部；隐藏打开等待有效布局，Word 保存比例，PDF 保存页码/位置/缩放；宿主显式状态能更新已打开阅读器 | PDF/HTML/Word 三标签经插件禁用/启用后恢复；Word 仍在第 38 段，HTML 比例约 0.9455，PDF 第 2 页、1.138 倍缩放。宿主标签关闭整个工作区后，从命令面板重开也恢复；证据 34—41 |

工作区状态随主数据写入，使用相同保存队列和冲突保护；普通学习库撤销不回滚阅读状态。重命名会同步已保存的标签与路径，但“连续改名与卸载/关闭交错”仍属于未完成的清单 04。

## 失败记录及修复过程

| 证据 | 实际问题 | 最终通过记录 |
|---|---|---|
| [看板失败](evidence/verification/board-markdown-red/results.json) | 看板直接显示 Markdown 标记，15/16 | [组织界面 17/17](evidence/verification/organize-priority-green/results.json)，原生证据 29、31 |
| [菜单失败](evidence/verification/selector-hit-red/results.json) | 实际 DOM 命中测试显示卡片菜单被选择条覆盖，16/17 | 组织界面 17/17，原生证据 42 |
| [标签恢复失败](evidence/verification/workspace-restore-red/results.json) | 空宿主状态重开后丢失标签与活动文档，34/35 | [工作区 40/40](evidence/verification/workspace-priority-green/results.json) |
| [分离关闭失败](evidence/verification/workspace-detach-red/results.json) | 活动文档脱离 DOM 后关闭，HTML 和 PDF 位置被覆盖；Word 无位置状态 | 工作区 40/40，原生证据 36—41 |
| [隐藏/宿主状态失败](evidence/verification/workspace-hidden-host-red/results.json) | 隐藏 PDF 丢失待恢复页内位置；已打开阅读器忽略新的宿主状态 | 工作区 40/40，包含恢复后的实际滚动视口检查 |
| [移除样式失败](evidence/verification/workspace-styles-unload-red/results.json) | 第一轮自动检查通过后，实机仍发现先移除样式再关闭会覆盖位置；新增回归复现，39/40 | 最后一轮 40/40；原生关闭前后 JSON 和恢复截图 36—41 |

早期原生失败 JSON：`34-position-retest-before-state.json` 为 HTML 约 0.9455，`34-position-retest-closed-state.json` 变为 0；Word 的 `35-word-before-reload-state.json` 为约 0.5367，`35-word-closed-failed-state.json` 变为 0。它们均保留在实机证据目录，未写成通过。

## 最终原生恢复结果

| 文档 | 重载前 | 重载后 |
|---|---|---|
| 合成 Word | 可见第 38 段，比例 0.5367492650146997，为活动文档 | 仍为活动文档，截图中仍见第 38 段，比例相同 |
| 第二份资料 HTML | 比例 0.9455337690631809，章节偏移 0.7565732574219418 | 切回后比例、章节和偏移相同，截图中的滚动条仍在相同位置 |
| 合成 PDF | 第 2 页，页内偏移 0，横向位置 0，缩放 1.138，单页连续 | 切回后相同，实际工具面板页码为 2；缩放由宿主状态确认 |

源记录：[关闭前](evidence/native-max-l4/36-three-documents-before-state.json)、[关闭后](evidence/native-max-l4/36-three-documents-closed-state.json)、[重载后切回 PDF](evidence/native-max-l4/39-three-documents-restored-state.json)。三个标签及其状态逐项相同；切换标签会正常改变活动文档。

整个工作区关闭重开另用 [关闭前状态](evidence/native-max-l4/40-before-workspace-close-state.json)、[重开后状态](evidence/native-max-l4/41-workspace-reopened-state.json) 和 [比对结果](evidence/native-max-l4/41-workspace-reopen-comparison.json) 验证标签与活动文档。这里关闭的是 Obsidian 的整个学习工作区标签，不是内部文档标签。

截图及操作边界见 [实机索引](evidence/native-max-l4/README.md)。

## 自动检查与边界

最后一次完整运行：20 个套件全部通过，结束于 2026-10-16 02:53:10 UTC；工作区 40 项、组织界面 17 项、复习 UI 34 项、阅读器 70 组。详细日志见 [统一结果](evidence/verification/results.json)。单位不同，不相加为功能覆盖率。

工作区套件使用真实插件模块和合成库；PDF 解析/Word 转换及部分宿主接口使用替身。单独阅读器套件包含真实 PDF.js。原生验收实际转换了合成 DOCX、加载了本地 PDF/HTML，并通过实际插件开关和宿主标签完成恢复，未由替身代替。

原生 Markdown/EPUB 未在本轮逐格式重载；它们与 HTML 共用位置恢复实现，仍不能外推复杂样式、图片晚加载及文档重排全部通过。PDF 非零页内偏移有自动回归，本轮原生恢复用例的页内偏移和横向位置均为 0。

旋转 PDF 在当前窄栏和缩放下正文未见，原因需另核实裁切与渲染。本轮确认页码和状态恢复，未确认该场景正文显示；已列入清单 16。其他菜单、模板、默认脑图密度与原版的差距仍按清单继续，不宣称完整等价。

## 下一步

处理清单 04 的连续重命名、卸载与异步关闭交错，然后建立 05 的逐页/菜单/状态对照，继续 06—10。Qoder 任务书继续保持草案，任务级协同校准尚未通过；当前无需用户发送文件。
