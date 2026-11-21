# 对话 01：Extend完整闭环

这是可以直接交给新对话执行的任务书。先读 [共用规则](00-总控与交接规则.md) 和 [实时清单](../后续工作清单.md)，然后实施本包；不读取整个旧聊天。

第一包：不需要上一包报告，使用本任务指定的检查点。

2026-10-22执行补充：本包初次实施使用下述初始检查点；续接以实时清单和`验收报告/01-结果.md`为准，不把初始红例当成当前失败。用户已授权01/02交替开发：本包未关闭时也可在停止执行、保存版本和停点后切到02，再按最新共享源码切回。遵守总控规则的单包执行与交接要求；切换不代表本包完成。

## 范围（原清单 11.8）

直接区域摘录、普通留白成卡、评论与卡片双向联动、多脑图归属、完整 Basic/Advanced/Favorites、颜色标签、图片/相机、独立评论区、Normal/Margin/Collapse、拖动高度、虚拟页/导航及自动展开。

先读取 `evidence/checkpoints/20261019-multichat-handoff/checkpoint.json`。当前源码已有大量未部署改动，不能重写一套，也不能把安装版当当前源码。

已实现待收尾：直接区域拖选，普通留白卡片同步/当前脑图去重，菜单页签/颜色/收藏，图片插入/导出，独立评论区，虚拟页/缩略图/跳页，来源笔记本标记。

先处理最新红例：Reader135/136，失败 `cancelled image import saved content`；线索是 ReaderView.insertExtendImages 未向 ExtendNotes 透传 AbortSignal，应核实公共接口并保留有意义测试。其余隐藏状态断言尚未全走到。Workspace83/83 是最近通过记录，当前 build 不包含最新源码。

MN4 当前可能仍打开自动展开确认弹窗，详见检查点及 `evidence/extend-complete-20261019/mn4-collapse-autoexpand-alert-ax.txt`。在全局 Collapse 点击自动展开会询问是否切换嵌入模式；当前实现尚无此确认。最近新增的合成空留白仍在第3页，未加入脑图，需通过正常 UI 清理并恢复 Normal，不能删用户已有内容。

接着完成：原版 T/自动展开/侧边菜单/拖动/高度柄布局；已入当前脑图后 Add to MindMap 隐藏；入脑图操作与 Reader 历史；全局 Collapse 自动展开确认；虚拟页底部跳转与笔记本来源定位；来源摘录评论和源卡的完整关系（先取证，别猜测写 back）；原版 Export Card 当前插件仅 Markdown 对话框，尚未完整对齐。

多图不重叠的补丁已写入，但取消检查失败；不要跳过测试部署。临时源码快照仅供回退比较，不能盲目覆盖最新目录。

## 按需读的代码

src/pdf/extendNotes.ts、extendMenu.ts、extendNavigation.ts、extendExport.ts、readerView.ts、annotationLayer.ts；src/annot/baseController.ts；src/cards/cardView.ts；src/workspace/documentNavigation.ts、studyWorkspace.ts；src/types.ts；styles-reader.css；src/documents/acceptance-fixtures/extendCases.txt。

以上路径均相对开发目录 `${MARGINSTUDY_REPO}`；只读取本次需要的文件和函数，不批量输出整个目录。

## 具体关闭要求

完成同一留白的创建→编辑→入脑图→修改卡片回写→定位→撤销重做→保存重开→导出；覆盖来源摘录/普通/页边、三模式、重复操作、多脑图、删除恢复。自动 Reader/Workspace 与真实宿主分开记录。

同时满足共用规则的功能、呈现、数据、证据和保护要求。现有能力先核对，补差距并完成整包流程；对不确定原版规则做针对性实测。完成当前改动后跑适当自动检查、build、验收库真实宿主验证，清理合成测试内容。

## 交付给下一对话

使用 [报告模板](验收报告模板.md)，写 `验收报告/01-结果.md`，更新 `后续工作清单.md` 本包状态。报告明确代码/安装版哈希、相关数据变更、实际通过/失败/未测、剩余缺口及下一步最小读取集合。未达到标准时继续本包或明确阻塞，不能用测试数量折算覆盖率。
