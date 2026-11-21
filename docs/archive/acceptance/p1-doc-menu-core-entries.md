# 文档菜单五个核心入口与状态恢复验收

更新：2026-10-17。本阶段把顶部三个点改为 `Document - More` 弹层，接入五个已有实际能力的入口。仅安装到 MarginStudy验收库。**这是完整原版菜单的核心子集；完整菜单、全部弹框和整插件仍未达到 MN4 等价。** 原开发源码、yan 正式插件保持保护基线，未复制 Claudian 配置或凭证。

## 采用的原版行为

原版为 MN4 4.4.6，Qoder 静态 L3 仍为 4.4.5。175、180 实际打开的是顶部三个点的 `Document - More`，与 macOS 菜单栏 `Document` 系统菜单分开记录。此前 59、128、166 的系统菜单 AX 不能用来代替这个弹层。

- 弹层锚定文档三个点，下方箭头、居中标题、左侧图标及左对齐行文字。
- 当前页有书签时显示 `Remove Bookmark`，无书签时显示 `Add Bookmark`。
- `Go to Page` 打开居中浅灰框、空输入与 `OK`。178 明确输入值为 1，179 点击后第一页面标题与 `1 / 4` 出现。177 的首次输入尝试没有成功跳页，保留为失败操作，不作通过证据。
- `Show Document Tabs` 通过右侧勾选框隐藏/恢复标签，菜单保持打开（182—183）。原版点击行文字只高亮；插件当前整行 checkbox 可点击，点击区域仍有差异。
- 181 只观察了 `Read Settings` 的翻页方式、五种主题和 More Settings，没有切换这些设置，不能写成这些功能已完成实测。

原版完整菜单还有 Export Document、Toggle Toolbar Mode、Edit PDF Pages、Crop、Extend、Margin Comment Area、Blank Background、Read Settings、Bi-Article Comparison、Attached Notebook、Show Scroll Bar、Handwriting on Top 等。本阶段没有把这些行加入菜单，也没有用无功能按钮补齐外观。

## 实现与实际入口

`Document - More` 当前按原版相对顺序接入：

| 入口 | 本阶段结果 |
|---|---|
| Add Bookmark / Remove Bookmark | PDF 或 msref 当前页添加/移除，重开菜单后更新标签；捕获文档、页码及笔记本身份，换源后不写到另一文档 |
| Go to Page | PDF 或 msref 页码弹框；有效页跳正文，非法范围保留输入并纠错，Enter 提交，Escape/背景取消；换文档、关最后标签和卸载时关闭 |
| Document Notebooks | 打开现有文档笔记本管理器；此阶段只核对入口，没有宣称管理器全部呈现与原版相同 |
| Card Grouping Board | 从复习面板切到 Cards 看板；此阶段只核对路由，没有宣称看板全部状态等价 |
| Show Document Tabs | 勾选状态随标签显示更新，菜单保持打开；偏好持久化，文档记录及阅读状态保留 |

HTML 等流式文档不显示固定页码/书签行。原有工作区管理移至 **学习集更多设置 → 工作区设置…**；原阅读工具的新路径为 **学习集更多设置 → 工作区设置… → 阅读与批注的全部工具**。199 已实点打开，页码仍为 3、缩放等工具保留。

生产修改：`src/workspace/studyWorkspace.ts`、`src/pdf/readerView.ts`、`styles-workspace.css`。工作区增加三组公开 UI 行为回归（`src/workspace/acceptance-fixture.txt`），原有布局用例改走新的工作区管理路径。使用插件自己的阅读器和数据模型，没有引入原版私有类或 CoreData。

## 失败、修复与自动回归

| 保存目录/编号 | 观察与修复 |
|---|---|
| `document-more-bookmark-red/green` | 初始 69/70，没有 Document - More；接入锚点和当前页书签后 70/70 |
| `document-more-page-jump-red/green` | 初始 70/71，没有页码弹框；接入有效/非法/取消/换源检查后 71/71 |
| `document-more-routing-red/green` | 初始 71/72，仍混入工作区管理且顺序不符；五个入口与工作区管理分开后 72/72 |
| `document-more-last-tab-red/` | 新增最后文档关闭场景后 71/72，页码弹框仍残留；集中在释放阅读器时关闭，最终全套 72/72 |
| 原生 186 → 187 | 初版合成检查通过后，真实 Obsidian 的默认按钮样式把行内容居中。186 保存失败截图/AX；补显式左对齐后重新构建、完整检查、停用/安装/启用，187 实机截图确认修正 |

以上自动记录均在 `evidence/verification/`。页码弹框曾受到旧 `.ms-modal` 样式覆盖，已限定样式；真实宿主验证不能由隔离浏览器替代。

最终完整验收在左对齐修正后运行，完成于 **2026-10-17 00:54:32 UTC / 北京时间 08:54:32**：**20 套件通过；工作区 72/72、阅读器 78/78 组、组织 UI 17、复习 UI 34、AI UI 18，类型检查与构建通过。** 稳定副本为 [document-more-final-green](evidence/verification/document-more-final-green/results.json)，含全部套件日志和工作区结果/截图。这些数字不是原版覆盖率。

## 真实 Obsidian 验收

环境：Obsidian 1.14.4、合成四文档学习集。所有桌面操作通过原生界面；模型/源文件仅按白名单只读捕获。

| 编号 | 操作与观察 |
|---|---|
| 184 | 本轮操作前，保存八个源/sidecar 哈希及 12 个模型区段 |
| 185—186 | 旧混合菜单与初版居中失败；均不作为最终通过 |
| 187 | 最终菜单，实际查看截图确认左对齐和文档按钮锚点 |
| 188 | 第 1 页 Add Bookmark 后，重开菜单为 Remove Bookmark，docMeta 为 `[1]`；随后通过菜单移除，恢复原空列表 |
| 189—191 | 空跳页框 → 明确输入 3 → OK；191 截图正文实际出现 Chapter 2 与两色图片，不仅核对 AX 中已加载的页面文本 |
| 192 | Document Notebooks 打开现有管理器，主笔记本可见；关闭，未更改笔记本 |
| 193—194 | 先切到 Review，再从文档菜单 Card Grouping Board 回到 Cards，看板可见 |
| 195 | 隐藏标签，菜单仍打开、勾选为 false；保存完整工作区状态 |
| 196—197 | 真实设置停用/启用插件，重开工作区；仍为四文档记录、PDF 第 3 页、0.432 缩放、手写导航和 Cards，标签保持隐藏。停用文件首次读取早于异步落盘，随后确认停用列表再保存正式 196 记录 |
| 198 | 从菜单恢复标签，菜单保持打开、勾选 true |
| 199 | 实点新工作区路径下的原阅读工具，页码为 3 |
| 200—201 | 关闭工具，保留正常学习界面及标签；无 Claudian 浮动输入框遮挡；保存最终白名单数据和部署核对 |
| 202 | 保存证据的 17 项限定比较全部通过 |

187—200 共 14 份 AX、截图与原样 PDF sidecar，195—197 另存完整工作区状态；188 另存书签元数据。比较脚本首轮把 14 份误计为 13，纠正文件数量后通过，未据此修改产品或清理资料。

## 数据、部署与封存

[202 的比较结果](evidence/native-max-l4/202-document-more-reload-comparison.json) 确认八个源/sidecar 与本轮前相同、14 份捕获的 PDF sidecar 字节相同、12 个模型区段含 docMeta 回到基线；隐藏状态在停用前/停用后/重载后完整相等，最终仅恢复 `showTabs: true`。四个部署产物匹配最终安装凭证，两处受保护插件 main.js 保持原基线。

可从保存证据重放，无需读取当前资料库：

```sh
python3 scripts/compare-document-more-evidence.py
```

最终安装凭证：[20261017-document-more-final-deployment.json](evidence/checkpoints/20261017-document-more-final-deployment.json)。开发与验收库 main.js SHA-256：`aad82ee0b9a3e16d69a9edc0613618112f58bd5ee9ca96182942ad4684db11dc`；styles.css：`4e4906f652d0c1579fdc812b3520c3c0d639bf5b6686b4da536493a103356271`。初版 `20261017-document-more-deployment.json` 对应 186 失败样式，不能作为最终凭证。

修改前代码/构建/checkpoint 保存在 `evidence/checkpoints/20261017-document-more-before/`，实际安装前四构建另存 `20261017-document-more-installed-before/`。本阶段封存为 `20261017-document-more-verified.tar.gz`，索引和摘要在 [snapshot](evidence/checkpoints/20261017-document-more-snapshot.json)。

整份 data.json 字节相等不在结论中，阅读页码和标签偏好有正常变化。历史空 pen `ann-mvb9jx0m-z47ea4` 与空书签列表继续保留；没有迁移或手工清理。

## 仍未完成

完整 Document - More 的剩余行、全部文档类型的可用/禁用条件、子面板、图标和点击区域仍按清单 05—07 继续。原版与插件虽均保存 3024×1710 桌面截图，文档宽度、缩放、节点内容不同，不能作整图像素等价结论。非法页码、取消、换源和关闭最后标签的精确场景来自隔离自动回归，没有全部在原生重复。

随后继续阅读设置、PDF 页编辑/裁边/扩展，再推进目录编辑/AI TOC、Cards 底栏与卡片模板。清单 05—08 未勾完；本阶段未派发新辅助任务、未向 Qoder 交接，协同校准仍未通过，当前无需用户转交文件。
