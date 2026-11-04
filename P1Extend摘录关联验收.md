# 11.8 Extend 摘录关联阶段

2026-10-19。仅部署 MarginStudy验收库。11.8 仍为部分完成。

## 本轮已实现

- PDF 选中文字的弹出菜单新增 Extend；保留原文高亮，创建正文为空的关联留白。自动成卡/自动入脑图沿用插件已有设置，没有把原文塞进留白评论正文。
- 已有高亮、下划线、区域等几何摘录的菜单可以打开 Extend。同一摘录重复打开会编辑同一个留白，保留独立文字和稳定页 ID。
- 关联留白菜单可 Add to MindMap 和定位摘录；复用来源卡片和已有节点。删除留白、撤销或恢复留白均保留独立的来源摘录和卡片。
- 当前笔记本隔离；裁边、旋转、正文已有留白及页移动使用阅读器统一投影。
- 修复自动成卡后顶部撤销切到脑图历史的问题；修复留白工具截走已有批注点击的问题；区域边框改为包含在保存的矩形范围内，避免留白与边框重叠。

模型仅新增插件自己的 `PdfExtendNote.sourceAnnId`，复用已有 Annotation/Card/MindNode；没有照搬原版私有类、存储或 API。

## 原版实测范围

原版窗口 L4SampleSet，合成文档 l4-sample-alpha，第 3 页。

01–03：选中的是单词 **Unique**，没有把长距离拖动冒充整句选区。点击选区菜单 Extend 后，原文出现高亮，空白留白编辑区出现，当前设置下自动出现 Unique 脑图卡。留白三点菜单为 Basic/Advanced/Favorites 和图标操作。

04：通过留白三点菜单删除留白，原文高亮及 Unique 卡片仍存在。之后通过源卡片删除菜单清理测试来源。

05 是追加的撤销探索截图，**不能当作清理完成或完整撤销契约**：连续点击顶部 Undo 的中间状态涉及来源、留白和此前删除。完整 MN4 跨对象撤销顺序仍未确认。后续通过来源菜单删除完成清理。

非文字区域拖动本轮只出现点按菜单，未取得可信的矩形选区创建结果；不将直接框选区域→Extend 标为原版实测通过。

## 自动回归

沿用已确认的公开 ReaderView、可见 DOM/PointerEvent、文件适配边界。隔离 Chromium 使用合成资料；Reader 使用真实 bundled PDF.js Worker，Workspace 的 PDF 解析与 Obsidian 宿主为适配替身。

- Reader **129/129**；Workspace **83/83**；类型检查与生产构建通过。
- 文字选区→空正文/源高亮/卡片、评论独立、重复加入脑图、删除/Undo 保留来源。
- 已有区域摘录菜单→关联留白；裁边旋转页的锚点、已有留白、重复打开、移动页、笔记本隔离。
- 真实工作区选区流程中，自动成卡/入脑图之后顶部 Undo 仍撤销留白。
- `text-source-red.json`、`region-anchor-red.json`、`auto-card-history-red.json`、`source-click-red.json` 保留失败；最终结果见同目录的 Reader/Workspace final-green。

不是全套 20 套件重跑，数字不代表 MN4 覆盖率。最后仅修正页栏排除选择器拼写并重新构建；最终实机运行该构建。

## 真实 Obsidian

- 10：验收 PDF 选中 Unique，打开选区 Extend。
- 11–12：空正文输入并保存 Excerpt linked comment，源卡仍为 Unique；Add to MindMap 提示已有，定位回原文并闪烁高亮。第一次中文 typeText 未形成可见输入，不算通过；之后 paste 的可见输入及保存通过。
- 13：真实停用/启用插件后，评论与源卡同时保留。
- 14–15：新选 quick，自动成卡后顶部显示“撤销添加留白”；实际 Undo/Redo/最终 Undo 操作仅增减留白。删除 Unique 留白后两个来源卡仍在。
- 清理时复现已有高亮点击被留白放置截走，误建空留白通过 Undo 清理。修复后重新停用/部署/启用。
- 16：最终构建在留白工具下点击既有 U2 高亮，出现 Extend 来源菜单，没有误建空留白。执行后复用原摘录，临时留白通过 Undo 移除。
- 18–19：回到 PDF页编辑验收首页、0.432、文本工具，导航关闭、Cards 打开、AI 隐藏。17 是切回目标标签未成功的中间图，不是最终验收图。

所有临时留白/高亮/卡片/文档根节点通过正常 UI 清理；新生成的空 PDF页编辑验收.pdf.mstudy.json 在停用插件后由 Finder 移至废纸篓。没有覆盖 data.json 或 Claudian 配置。

最终 **26/26** 比较通过：19 个业务/设置/工作区区段与本轮 before-data 精确一致；源 PDF、两处受保护 main.js 未变，目标 sidecar 恢复不存在，部署 JS/CSS 一致，启用状态已落盘。只有 revision/writerId/savedAt 更新。

最终构建 SHA256：

- main.js：`e3cc90446fe013996d21db4f7a2cfc43b85c59bc7c67ff3e9dbc90c41999a372`
- styles.css：`e1335935d6769438bbc85a8881ee3304ff4ccd75a1467fab1b8428c3e5a0bdde`

证据目录：[extend-excerpts-20261019](evidence/extend-excerpts-20261019/README.md)。

## 明确未完成

直接非文字拖选→区域关联留白；普通空留白 Add to MindMap；留白评论与卡片内容的完整联动；多脑图/跨画布规则；完整 Basic/Advanced/Favorites、颜色和标签菜单及精确视觉；图片/相机进入留白；独立 Margin Comment Area 开关；Normal 虚拟页计数和导航投影；自动展开；原版完整持久化、位置/高度与导出/历史规则。11.8 不关闭，下一步仍补直接区域流程和完整菜单，再处理上述剩余项。
