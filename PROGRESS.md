## 2026-11-08（CC-A23-FINAL · A23 第 2–5 项实机验收，只读串行）

- 前置断言：`Debugger.getScriptSource` 取 `plugin:margin-study` 运行时源码，活跃 scriptId **335**（sha `b3e26d69b495`、5 044 691 字符）内 `addAnswerActions` 命中 **3** 次、`saveAnswerBranch` 2 次；188（`bcb44f8d56fa`）命中 0 为旧构建残留。前置满足，本轮**未重载插件**。
- 送答链路：`.ms-native-side-tools button[aria-label="AI 学习助手"]` 点击开面板 → `.ms-ai-service=custom`（已绑定，未重新握手）→ mode=chat / task=Ask → 页内包装 `require('node:http').request` 的本地 SSE 桩（仅匹配 `ms-a23-stub`，其余放行，并计数 fetch/xhr/ws/realPass）→ 气泡原文 `# 根\n## 子一\n### 孙\n## 子二`，四按钮齐全。
- 四项结论 **全部 pass**：① 层级转分支 4 节点，titles `根/子一/孙/子二`，`parentId=[null, id0, id1, id0]`，深度 `[0,1,2,1]`，rootCount 1、**无额外总标题根**，cards 22→26 / nodes 18→22；② 转换前后 `stubHits/realPass/fetch/xhr/ws` 增量全 **0**（`libraryHistoryRevision` 0→1 一次事务，revision 2500→2501 为异步保存）；③ 带守卫（`undoLabel==="回答转脑图分支"` 才点，避免 DEF-A23-2）点 `title="撤销回答转脑图分支"`（`.ms-tb-btn`）一次后 cards 22/nodes 18 **逐字段深比较 identical**（added/missing/changedFields 均空、nodeComments 0→0、非空 card.back 3→3、title 多重集合相等、A23 标题残留空）；④ 桩返回 3 空格 → 气泡文本 `"   "`、按钮可用，点击后 Notice 逐字 `转换失败，请检查回答内容后手动重试。`（+150ms/+750ms 均在），`noNewObjects=true`、未新增事务、失败按钮不禁用。
- 过程如实登记：第 4 项首次误点上一条已 `disabled` 的按钮（空操作，store 与计数零变化），改定位最后一条气泡后取数。
- 交付：`evidence/acceptance-20261106/CC-A23-FINAL.md`（前置命中数 + 四项逐条 pass/fail + 原始读数值）。截图 **0 张提交**：`Page.captureScreenshot` 返回 `eaef5d654215`（278 076 B），与 DEF 轮登记的陈旧帧**字节相同**，窗口遮挡期间 Chromium 不产帧，不作证据；临时 PNG 只留 `/tmp/cc-a23-final/`。
- 收尾：撤销已把本轮 4 卡 4 节点完全回退，终检 `leftoverNode/Card = 0`；页内桩与 `fetch/XHR/WebSocket` 全部还原（`stubGone=true`）并删除 `window.__ccA23*`；侧栏关闭、回学习集主页 `A17-验收-B`。最终读数 **revision 2502**（本轮基线 2499，+3 为写计数器偏移，如实登记）、cards 22 / nodes 18 / edges 2 / comments 0 / canvases 9 / studySets 5 与基线逐字段一致。未改产品代码、未提交、未改既有 evidence。
- 首个下一步（总控/执行席）：A23 宿主 UI 验收项已闭合，整卡再审时仍须处理 PROGRESS 2026-11-08 A23 小节登记的「改前红灯证据」缺口；DEF-A23-1 按上一轮建议改判为「环境错位（未重载）」，A23 验收脚本已把「运行时 `addAnswerActions` 命中」固化为第 0 步前置断言。

## 2026-11-08（CC-A23-DEF · DEF-A23-1 最小判定）

- 完成：只读判定 DEF-A23-1。结论「按钮真没进 DOM」成立、「上一轮检索口径错」不成立，但**不是产品缺陷**——宿主 Obsidian 进程 02:18:38 启动时载入的是 A23 之前的构建（`plugin:margin-study` scriptId 188，sha `bcb44f8d56fa…`，包内 `addAnswerActions`/`saveAnswerBranch`/标签出现次数均为 0），磁盘 `0ff1fc4d…` 构建 03:08:01 装入后从未重载。破案点是 append 探针抓到的栈号 `submit (plugin:margin-study:101530)` 与磁盘行号 101614 不符。
- 正向确认：`disablePlugin/enablePlugin` 重载后同一条本地 SSE 桩链路一次通过，气泡子节点为 `[text, 制作卡片预览, 回答转脑图分支, 选段写评论, 选段设标题]`，append 探针 3 次命中 `addAnswerActions (101456/101471)`，按钮 rect 非零且 `display=inline-flex`（也排除「进 DOM 但被隐藏」）。上一轮四项「已排除因素」都是对磁盘包的核对，据此判产品缺陷是错的。
- 交付：`evidence/acceptance-20261106/CC-A23-DEF.md` + `CC-A23-DEF-raw-olddom.json` + `CC-A23-DEF-raw-reloaded.json`。截图通道故障如实登记（`Page.captureScreenshot` 三次返回字节相同的陈旧帧、cua CGWindow 截图同样未画出侧栏，窗口被全遮挡期间 Chromium 不产帧），故本轮不提交图片证据，已删除误名 PNG。
- 收尾：append monkey patch 已移除、上一轮遗留的 http/https 桩一并还原为 `_http_client.request` 原生实现（`httpRestored=true`）、侧栏关闭、回学习集主页 `A17-验收-B`。读数 revision 2492→2499，cards/nodes/edges 22/18/2 逐字段未变，未点击任何 A23 按钮、未新建对象；未改产品代码、未提交。
- 方法学建议（已写入交付件）：验收前置必须核对**运行时脚本身份**（`Debugger.getScriptSource` 比对 sha 或栈行号与磁盘行号一致性），磁盘装入时间晚于宿主启动即先重载插件。
- 完成定义：判定二值结论 + 三类 dump 证据 + 一句话根因指向均已交付并登记。首个下一步：执行席按 A23 卡补测第 2～5 项（现已有实机可达入口）。

## 2026-11-07（手写预览视口定位）

- 完成：预览 canvas 挂到所属 document 的 body，避开 `.workspace-leaf` 的 `contain: strict`；保持 fixed、z-index 35 和原有逐帧重投影及抬笔交接。按脑图可视区裁剪，并挖除工具栏和设置面板区域，避免跨层遮挡；canvas 不接收指针事件。
- 改前隔离 Chromium 模拟 `contain: strict` 与 80px 位移，预览 rect 为 `(8, 88, 1280, 633)`，视口几何断言失败。改后视口误差不超过 1px；同点序列交接掩膜双向 chamfer：笔 0、荧光笔 0.001224 CSS px，包含实际 canvas 定位的独立几何断言。工具栏、设置面板挖空及脑图边界裁剪断言通过。
- 笔、荧光笔各连续 120 帧，整个手写 SVG 子树均无写入；荧光笔隔离 Chromium 事件处理均值 0.170ms、最大 0.300ms、超过 9ms 为 0。此数据不代表真机性能。
- 完整 `MARGINSTUDY_VERIFY_DIR=/tmp/marginstudy-ink-final-20261107 npm run verify` 全通过，手写 23/23；详细数据位于 `/private/var/folders/t6/drs3g4rn65584bfmzxqhq4_r0000gn/T/marginstudy-map-ink-U3Tm3r/results.json`。构建 `main.js` SHA-256 `09acf8a6ff4e9eb0dfdcb5d9bbb97262da3af42b2c24300bd17da93f08396d92`。
- 完成定义：四项断言均通过；未操作 adb、安装、真实库或 evidence，未提交。下一步第一动作：无。

## 2026-11-07（CC-A05 宿主侧模板编辑器 + JSON 真实往返验收）
- 隔离库实机 6 项：①编辑器可达/编辑 PASS（名称、工具删 `continuous-excerpt`、首色 `#123456`、浮窗 false、选区菜单加 `speech`、笔名 `验收红笔`；笔颜色 color well 未改成功）；②真实保存对话框导出 PASS（`~/Downloads/CC-A05-template-20261107.json`，2639 B，`version:1`，6 色均合法）；③导入 FAIL/部分：仅改 `template.name` 不改 id 时被 `模板 ID 已存在` 拒绝（rev 2440 不变），删除源模板后同文件导入成功且与文件 deep-equal（rev 2442），再次导入被拒且 rev 不变；④非法 version 999 / `#12345` 均未写入且 rev 2442（颜色用例 toast 未捕获）；⑤启用后工具栏 10 项（标准 13 项，隐藏留白/套索/连续摘录）、选区菜单含“朗读”、新摘录卡颜色 `#123456`、无摘录浮窗、笔盒显示 `验收红笔`；切回标准后 13 项与默认设置恢复（rev 2448）；⑥界面无删除模板入口（实装与源码均无删除 API），删除需求判 FAIL，已用 Store API 清理自建模板/摘录卡/标注/节点至 22 卡/18 节点/4 标注，rev 2450，回到学习集主页。
- 构建：实装 `main.js` `b7a99bf8ce77a938ebd73c725e489697d02b61692fcb893550b654c3d16429b4`，与任务卡 `c6ff1a92…` 及仓库 `76d56e18…` 均不一致，结论只对实装构建成立。
- 证据：`evidence/acceptance-20261106/CC-A05-RESULT.md` + `CC-A05-01…05` 截图；未改产品代码、未提交、未改既有 evidence。

## 2026-11-07（注释图片外置与恢复目录治理）

- 注释保存前复用媒体外置，写后读回校验；失败保留原值。sidecar 与新恢复快照共享外置结果；自由图片显示、裁剪与 PDF 导出兼容媒体路径。
- 两类恢复快照使用固定滚动 writer，按类型保留最多 3 份、总量小于 2 MiB，当前文件保留；只清理文件名与内容 writerId 匹配的文件并记录日志。正在写入的文件自身过大时优先保留；旧注释快照不含 writerId 时无法按授权规则删除。
- 合成测试：3 张各 2 MiB 图片，sidecar 8,388,926 → 686 字节；重载、幂等、写失败保留通过。10 次会话后注释恢复 3 份、831 字节，主数据恢复 1 份、2173 字节。
- 完整 `npm run verify` 全通过，日志 `/tmp/marginstudy-annotation-verify-20261107-full/`；增加重载断言后专项复测通过，日志 `/tmp/marginstudy-annotation-reload-20261107/`。构建 `main.js` SHA-256 `76d56e18d53bf1d4c242f4ff801d9c18697a5bb32f9afbd03be043303ae436c1`。
- 全局写入点检查：留白页 `pdfExtendNotes[].images[].src` 仍可在主数据中保存内联图片；本卡未覆盖。未操作 Pad、安装或修改真实库及 evidence。

## 2026-11-06（CC 实机测量 · 脑图右侧浮层遮挡）
- 完成：按卡只读测量指定构建（`main.js 826086f7…`、`styles.css c0d0f85f…`）的 A–F 六项，场景/传统各一轮；报告 `evidence/acceptance-20261106/CC-LAYOUT-RESULT.md`，截图 4 张（`CC-LAYOUT-01…04`），另存原始 CDP 返回值 2 份、E 受控滚动试验返回 1 份、cua 窗口记录 1 份（均为 gitignored evidence）。
- 结论：A 正常（`.ms-mindmap` 未裁切，内容右界 1497）；B/C/D/E/F 遮挡——rail 1455–1503（48×275）压内容 42×275、压竖滚动条 6×275（未裁切）；两浮钮各压 rail 41×44，2/6 图标中心被接管；Select 1454–1503 压滚动条 6×49、压画布 43×49；图钉 928.19/521.1（38×38）在内容区，场景受控滚动后遮节点 7.83%（传统未实测，同滚动量推算约 7.04%）；可用宽 661.59（损失 5.97% 内容宽 / 7.93% pane），并集面积损失 3.16%/3.19%。
- 现场恢复：interfaceMode=`scenes`、`light`/`white`、scrollTop 2712 / scrollLeft 2764、fixedViewPosition 未改；未改产品代码、未提交。data.json 因模式往返 savedAt/revision 前进（本席最后 06:09:28.730Z / 2412；外部任务随后写到 06:37:47.841Z / 2419）。
- 并发事实：测量后 14:22:48 外部把 `25ca5bf7…`/`200f4e58…` 安装进隔离库并重载；A–F 数值只对应 826086f7 构建，报告已单列“测量后外部并发改动”。
- 审计：独立三路审计 + 裁决，0 blocker/major；3 minor/2 nit 已修（E 场景限定与传统推算、trial 原始证据与时间戳、data.json UTC/版本、pane 7px 归因、截图说明）。
- 下一步第一动作：无（本卡交付完成）；若需复核其他构建，另开测量卡按同协议复测。

## 2026-11-06（脑图右侧浮层遮挡修复）

- 完成：rail、Select 内缩至 19px；快捷浮钮相对脑图区定位并与 rail 间隔 15px；固定视图默认停靠顶部留白，旧内容区位置回到停靠点，拖动范围限制在顶部留白并保存。
- 验证：历史实机改前数据见 `evidence/acceptance-20261106/CC-LAYOUT-RESULT.md`；新增场景与传统模式的滚动条、浮钮、图标命中及图钉断言；完整验收 27/27，Workspace 293/293，Reader 214/214，日志 `/private/tmp/marginstudy-layout-full/`。
- 实机改后 rect（x,y,w,h，CSS px）：场景 rail `(1445,223.59,48,275)`、Select `(1444,548.59,49,49)`、浮钮组 `(1386,376.5,44,100)`、图钉 `(1455,97,38,38)`；传统 rail `(1445,229.34,48,275)`、Select `(1444,554.34,49,49)`、浮钮组 `(1386,380,44,100)`、图钉 `(1455,104,38,38)`。两模式滚动条宽 15，rail 和 Select 右缘 1493，浮钮右缘 1430，6 个图标中心全部命中自身。受控滚动至节点与图钉横向对齐、节点到达可见区上缘：场景节点 `(1454.85,148.96,230,80.19)`，传统节点 `(1454.85,155.96,230,80.19)`，均与图钉零相交；滚动位置已恢复。
- 安装：隔离库 `main.js` SHA-256 `25ca5bf7dbed1d1f2362de09f58965c189a8f4dc1567d44f5c92a53cde3e1329`，`styles.css` SHA-256 `200f4e5877675eb44daaea6af089c51c3a24937e7c1552baa85e45eb5d2001e4`；宿主已重载，恢复 `light`、`white`、`scenes`。
- 注意：首次启动验收时遗漏临时输出目录，运行器写入了被忽略的 `evidence/verification/`；发现后已中止，后续日志均写入 `/private/tmp/`。原目录内容未备份，无法确认或恢复被覆盖的旧日志。
- 完成定义：A–D 的布局、命中、受控滚动与完整验收均已通过。

## 2026-11-04 A30 参考矩阵与几何验收分工

接收后备资料辅助席（Hermes IDE 终端 × Claude Code，实际模型 `deepseek-v4.1-flash[1m]`）的 `official-reference/A30-REFERENCE-MATRIX.md`：44,767 B，SHA-256 `365bbfb779ec7bf4b4001c5b479ed2d190460fe45d97f6001fbffba68c159830`。官方 manifest 已增至 35 项。矩阵明确 MN5 实机六图用于几何、原生导出仅用于计数、官网多数图片仅定性，以及等价样本非原件。

规划裁定：§7.1 中**有明确参考来源的缺口纳入 A30 二值断言**；产品可达性阈值与参考对齐分开，1024 分支、无来源 readerX/readerY 和 P1/P3/P4 等未知不补造参考值。宿主视口必须记录并断言实际 innerWidth/innerHeight；756×852 与 756×855 的底边仅按实际高度差换算，其余值不硬凑。

Codex 当前合成几何对齐（卡片 ≤0.6px、顶部/底部与分栏 ≤1px）只代表合成阶段进展，不等于 A30 通过。Codex 继续完整验证、构建安装及桌面/Pad 实测；终端 RESULT 必须标“等价样本非原件”。资料席/Hermes 负责修正 pixel-geometry 单位与算术、索引过期、HANDOFF 导出状态、counts.json 文档键和边距表述，不让文档勘误阻塞实现。OPPO 与 P1/P3/P4 未完成前 A30 父卡不关闭。

## 2026-11-04 A30 原生导出解除计数 unknown

原生导出已落成并核验：`a30-sample-20261103/native-export/P10-Isolated-20261025(2026-11-04-14-03-00).marginpkg`，910,112 B，SHA-256 `f66dd890a61bc486898aded91e787d34b63404901e21bf747f8f886ac9e26e23`，zip 291 项完整性通过。

按 `native-export/EXPORT-RECEIPT.md` 与 `counts.json` 登记：文档 **6**、topic **8**、note/卡片 **26**（带标题 5）、媒体 **21**、评论 **0**；上述计数不再为 unknown。UI 的“12 节点”“8 份文档”未与单表对齐，仍不作断言。

MN5 导出与隔离库 4 文档/9 节点/3 卡片仍为不同结构族：布局、锚点和分栏可用等价样本并标注“等价样本非原件”，结构与计数不得混比。自动导出失败历史保留，但当前阻塞已解除；Codex 可按 `A30-CODEX-HANDOFF.md` 使用导出计数精修并运行完整 `npm run verify`。

## 2026-11-01 官方资料后备辅助席与 A30 样本裁定

设立官方资料后备辅助席，证据包为 `evidence/mn5-alignment-20261029/official-reference/`：四个指定官网页面的 HTML、正文提取、原始图片与 34 项哈希已保存。辅助席只维护官方资料与增量建议，不持 MN5 锁、不改代码、不替代实机验收；Codex 实现、Hermes 实机、规划席裁定。

A30 采用 **A 口径**：布局/锚点/分栏可用官方实际截图＋等价样本精修，标注“等价样本非原件”；MN5 首页 6 文档/12 节点、工作区 8 份文档与隔离库 4 文档/9 节点不一致，所有对象计数在原生导出前保持 unknown。原生导出仅用于后续计数补证，不阻塞 Codex 当前视觉精修；不得把四次未落成的导出写成成功。

## 2026-11-01 后续统一 Pad 验收门槛

用户要求后续功能也必须可在 Pad 使用。现登记为统一规则：涉及 Pad 交互的任务卡必须通过真实 Pad 关键路径验收，桌面测试、窄视口或通用 PointerEvent 不再单独构成完成依据；桌面专属功能可明确例外。不承诺绝对零 bug，但已知阻断、严重数据风险或核心流程不可用未解决时不得关卡，其余已知问题必须登记。PLAN.md、GOALS.md 与 Pad 专项说明已同步更新。

## 2026-11-01 官网增量登记与 Pad 脑图专项

四个指定官网页面的增量已登记到 `evidence/mn5-alignment-20261029/OFFICIAL-INCREMENTS-AND-PAD-20261101.md`：A26 模板包、A11 公开 API 回读、A14–A17/A21 手写与练习接口、A27 资源模型及视频笔记候选均只安排后续，不重开已完成卡。

用户实测 Pad 脑图存在严重问题，现按高优先级兼容专项处理，不等 A30。静态审查已发现画布缺少完整触控手势状态机、节点拖动阈值低且缺少 pointercancel 配对、菜单/拖放依赖桌面事件、手写缺少明确掌触分流，以及测试未覆盖真实 touch/pen 输入。用户已确认 **Codex 通过 USB 调试连接 Pad**，改由 Codex 直接复现并修复，不再以用户录屏为开工前提；补 touch/pen 测试、完整回归和 Pad 实测后才能关闭专项，桌面行为不得回归。当前未宣称唯一根因或已修复。

## 2026-11-01 A30 后续补充：主页同态对齐

用户确认将 MN5 主页同态对齐补入后续 A30，不重开 A07、不影响当前 A17。届时按同学习集、同对象、同窗口、同缩放对照主页整体布局、入口层级、学习集／卡组／资料库容器关系、封面、置顶、分类、筛选和空态，并在隔离 Obsidian 实测；不只以插件自有三分区存在作为对齐通过。PLAN.md 与 GOALS.md 已同步更新。

## 2026-11-01 恢复文档提示修复登记

用户反馈每次打开都会弹出“恢复文档”提示，该问题已直接提交 Codex 修复；用户随后确认已修复完成。本席仅登记结果，未独立复验，不改变当前主线或其他卡片完成状态。

## 2026-11-01 A30 后续补充：主页启动导航

用户明确不重开已收尾的 A07。将主页启动导航补入后续 A30：启动插件默认显示学习集主页，选择学习集后进入工作区，工作区保留返回主页入口；设置继续沿用现有入口。PLAN.md 与 GOALS.md 已同步更新。当前仍按主线执行 A17，本项不提前插卡。

## 2026-11-01 A08 止损后诊断裁定

A08 仍未完成。当前空白证据来自修复前保存的旧固定项，旧项可能仍含错误的主脑图视口；RESULT 明确未证明修复后新建固定项同样失败，因此不再盲目修改挂载顺序。

下一执行席为 **Codex**：只做一组修复后新建子脑图固定项的干净验证。设置缩放／视口后新建固定项，核对保存值来自子脑图自身，重启隔离 Obsidian 后重开，并对比保存／恢复的 scale、x、y 与目标节点可见位置。通过后跑完整验证并复核关闭 A08；仍空白则凭实际数值做一次定向修复。无需 Hermes、CC 或 MN5 实机补证。

## 2026-11-01 A08 放行与视觉切片顺序修订

用户裁定按实际依赖放行 A08：A02 的文档／目录／页面／书脊容器证据（24–28）、固定主脑图对象 ID／重开／取消固定（41–44）及已收尾的 A04 已覆盖直接输入；A02 其余浮窗、OCR、附件回源和移动缺口分别留 A09/A10/A14 及后续移动验收，不再阻塞 A08。A02 父卡不因此写成通过。

用户批准将 A30-UI 顶部／底部视觉切片排在 **A09 后、A05 前**：只改布局、图标、状态与样式，不改工具 ID、动作绑定或 Store 数据契约；完成后构建安装到隔离 Obsidian 对照。后续 A05 → A10/A11 → A17 → A25 顺序不变，A30 仍负责三视口、窄窗与 ≤4 CSS px 精修。PLAN.md 与 GOALS.md 已同步修订。

当前下一张仍为 A08，尚未登记执行结果；本段只记录派工与顺序决定，不构成任何新卡完成。

## 2026-11-01 A08 执行中

用户授权按 A08 原范围继续，A02 其他缺口不返工。Codex 已实现书脊预览与进度、固定视图统一入口、四类固定项及看板滚动；完整 `npm run verify` 24/24（Workspace 216/216、Reader 210/210），最终构建已安装隔离 Obsidian。子脑图固定已改为记录自身视口，但隔离宿主对修复前保存的固定项重开两次仍显示空白；合成测试通过不能替代宿主结果。按 A08 原卡两次修复后视口恢复仍失败的止损条款，A08 **阻塞、不转正**，停止继续修复。测试固定项已移除，保留浮球位置设置和 lastVisitedAt 变化。详细边界见 `evidence/mn5-alignment-20261029/a08-execution-20261101/RESULT.md`。

## 2026-11-01 A07 首页执行与验收

Codex × GPT-6（运行子型号未披露）完成 A07：首页学习集、卡组、资料库三分区，置顶/分类/筛选/排序、今日复习、文档及脑图封面、来源分组和批量文档成员。完整 `npm run verify` 24/24（Workspace 211/211，Reader 210/210），三视口合成截图已留存；置顶和筛选重载、两份文档批量更改后逐字段撤销在合成 Store/UI 验证。最终构建已安装隔离 Obsidian，实机读取三分区及当前学习集 4 份文档；六项业务集合哈希一致。实机未修改置顶/分类或批量成员；不把合成验证写成对应实机操作。A07 原完成断言在上述证据范围内通过，详见 `evidence/mn5-alignment-20261029/a07-execution-20261101/RESULT.md`。未操作 MN5、未复验 A06/A22、未部署正式库。

下一张 A08 原依赖 A02/A04；A04 按用户裁定收尾，A02 尚未通过，A08 原依赖未解锁，未派工。A01 首页项已由 A07 接续，模板编辑器仍留 A05；不因此宣称 A01、步骤1或总目标完成。

## 2026-11-01 A04 收尾裁定及 A07 启动

用户裁定：A01 尚未完成的首页工作留在 A07，模板编辑器工作留在 A05；不因此返工 A04、不新增补证，并授权主线进入下一张卡。A04 自身原断言及用户明确接受的状态限定像素映射已完成终端验证和隔离宿主验证，A04 收尾通过；A01 原完成断言、原依赖及路线不修改，也不把 A01 写成通过。按用户明确决定，允许在 A01 首页/模板部分仍未完成时继续 A07；未完成项分别由 A07/A05 承接。A04Complete=true；step1Complete=false、goalComplete=false。原 v4 51/56、派生对账 56/56、历史红灯重放和原件不可得的证据边界继续有效。A07 后续结果见本节上方登记。

## 2026-11-01 A04 收尾与父卡复核

Hermes × deepseek-v4-1-flash-economy-261017 查找回执：指定用户目录、归档和项目范围未找到两份冻结原件；原件不可得为历史限制，不以替代文件冒充。Codex 本轮完整 npm run verify 24/24 通过（Reader 210/210、Workspace 206/206），最终构建 6de450e9… 已复制至隔离 Obsidian 并重启；重开标准/摘录，两条既有恢复提示延后。六场景 ID 按 v4 及用户接受的指定状态像素补充逐项对账一致；原 v4 51/56 与派生目标 56/56 原样分别登记。六项业务集合及 62 个批注侧车前后哈希一致，未新增摘录/卡片/ink。A04 自身验证已收尾；**父卡仍未关闭**：原直接依赖 A01 的场景与首页/模板取证在 matrix 中仍为 desktop-evidence，尚未达到原 A01 完成断言。遵用户要求，其他补证和支线停止；不改依赖或断言，A04Complete / step1Complete / goalComplete 保持 false。详见 evidence/mn5-alignment-20261029/a04-closeout-20261101/RESULT.md。

## 2026-11-01 R1 历史红灯终端重放

Codex 独立对 Hermes × deepseek-v4-1-flash-261017 保存的历史产品探针重放：两次选笔后均双 true，R1 及所选笔互斥断言失败；修复后 Codex 探针分别 true/false、false/true。该结果是历史输出的终端重放，不是 Codex 对旧源码的现场运行，也不证明 R4–R7 修复前失败。项目 evidence 具名源码副本未找到匹配冻结 SHA f1046508… 的文件；项目内具名 main.js 未找到冻结 SHA 721ad1b6…，临时目录搜索部分被拒，不能宣称全盘不存在。A04 父卡仍未转正；三个完成标志不变。详见 evidence/mn5-alignment-20261029/a04-writing-pixel-20261101/R1-RED-AUDIT.md。

## 2026-11-01 writing 空档像素证据与验证

接受用户确认的 Hermes × deepseek-v4-1-flash-economy-261017 像素对照（46 项索引哈希一致）：writing-sketch-more 状态第一空档连续摘录，第二空档撤销/重做；writing-native-more 状态三枚未绘制，AX 均不暴露，不要求全状态常驻。此前 writing 两个额外工具 ID 的身份阻塞解除；原 AX 未知报告保留，原 v4 及其 51/56 保留，修复后派生对照 56/56 不冒充原测试。Codex 未操作 MN5、未改源码；完整 npm run verify 24/24，reader 210/210、workspace 206/206，R-C3 与 R1–R7 均绿。R1–R7 历史夹具失败非产品红灯，不可冒充；本轮父卡仍未转正，三个完成标志不变。详见 evidence/mn5-alignment-20261029/a04-writing-pixel-20261101/RESULT.md。

## 2026-11-01 A04 v4 修复后对账

规划席保留原 v4 及 51/56 原始失败；依据冻结顺序和 Hermes 连续摘录原文派生修复后测试输入，同一套脚本 56/56，非新 MN5 证据、不替代原结果。六场景冻结工具 ID 顺序和唯一性补充核对通过，但 writing 额外 undo/redo 对应两处空档仍未证，不能把子序列当完全一致。当前 6de450e9… 构建已安装并重启隔离库，文本/矩形独立记忆双向实机复核通过；六项业务集合哈希一致，无摘录/卡片/ink 操作。R1–R7 历史旧 DOM 夹具失败不是产品红灯。A04 父卡仍未转正，三个完成标志保持 false；详见 evidence/mn5-alignment-20261029/a04-rc3-20261101/RECONCILIATION.md。

## 2026-11-01 A04 R-C3 红绿与父卡复核

用户接受文本／矩形两笔独立记忆的 MN5 证据，不外推其他工具或跨重开。Codex 执行席取消跨笔继承，加入稳定 ID 的 aria-current 和连续摘录 aria-pressed 测试；先后复现属性缺失及错误继承两个真实红灯，修复后 R-C3 与 R1–R7 绿灯。完整 npm run verify 24/24，reader 210/210、workspace 206/206；R-C3 合成测试前后 cards/nodes/annotations 一致，本批未操作 MN5 或隔离库。v4 原文件复跑 51/56，5 项仍固化修复前宿主行及不可见列表；不把失败改记通过。R1–R7 历史夹具红灯非产品红灯，不能冒充。A04 父卡未转正，三个完成标志保持 false。详情 evidence/mn5-alignment-20261029/a04-rc3-20261101/RESULT.md。

## 2026-11-01 A04 最终构建补记

最终 verify-reading 完整通过（reader 210/210、workspace 205/205）；源码构建与隔离库 main.js 的 SHA256 均为 c7246b4daf994a456fdd248ef2f03902868b52b67214df9890bb078c9f6a8d26。模板选择已可从学习集菜单进入，书写场景双笔互斥实机复点；阅读行的重复内部占位已修复并实机复点。v4 原始测试重跑 51/56：五项固化了修复前宿主行；追加目标序列核对摘录/书写/阅读均一致，但不能代替原测试通过。独立摘录笔的按笔记忆未闭合，A04 父卡和三个完成标志仍未通过。详见 evidence/mn5-alignment-20261029/a04-continuous-excerpt-20261101/RESULT.md。

## 2026-11-01 A04 连续摘录执行复核

Codex 执行席已完成连续摘录主体、writing 补入口、完整 verify（退出码 0；reader 210/210、workspace 205/205）和隔离 Obsidian 局部实测。实测一张合成卡含两段，随后已有卡续摘至三段；手形禁用、⌘⌥K 修复后实机开关通过。测试新增一张卡、三条批注及自动脑图节点。v4 原文件复跑 51/56，五项失败对应新增入口与冻结旧宿主行/不可达列表不一致；原断言未改。独立摘录笔身份的按笔记忆和 writing 场景本批实机动作仍未闭合。A04 父卡不转正，三项完成标志仍 false。详情见 evidence/mn5-alignment-20261029/a04-continuous-excerpt-20261101/RESULT.md。

## 2026-11-01 连续摘录原文证据

接收 Hermes × deepseek-v4-1-flash-economy-261017 的连续摘录原文证据（limit-candidates/step1-recovery/Hermes-deepseek-v4-1-flash-economy-261017-continuous-excerpt/）：PDF 中以摘录笔启动，第一段为主卡，后续文字和框选并入，完成后结束；按笔记忆，快捷键 ⌘⌥K。该批未激活功能，属于原始说明证据，非行为验收。Hermes 报告 studySets 哈希与基线不同，并将其归因于 17:33/17:45 插件部署；该归因尚未独立核实。Codex 负责实现及 R-C1–R-C5，A04 仍未通过。

## 2026-11-01 A04 v4 执行中

用户裁定 v4 替代 v3，56/56 仅证明采集与映射一致；writing 五项为缺陷，连续摘录应接正确菜单动作；reading 主题状态独立于 R1–R7。Codex 已接入 writing 文本、矩形、留白和笔盒更多至现有动作，尚未完成行为验收；连续摘录尚未找到可确认动作，不得宣称接通。v4 复测 53/56：三项失败均因旧映射把已新增的四项写为不可见并冻结旧行；须基于变更更新验收口径，不能当通过。完整 npm run verify 退出码 0（workspace 204/204）；该验证不覆盖连续摘录及更新后的 v4 行，父卡未通过；原完成标志不变。 

# MarginStudy PROGRESS

## MN5 实施状态（2026-10-29）
### A04 最终复核与隔离 Obsidian 验收（2026-10-31）
- Codex × GPT-6（运行子型号未暴露）完成完整`npm run verify`：24/24 suites、Workspace UI 204/204、生产构建通过；当前`main.js`已安装到`MarginStudy阶段一隔离库-20261026`。Obsidian 1.14.5 重载读回该库及插件 manifest 1.2.40；安装程序 SHA256=`b9ba97a459bd711b80953d9d338e5cc02f20922e8a95581fdf67492a0987b6c7`，与构建一致。正式部署未做。
- 实机验收覆盖标准模板摘录/手写/整理/回忆：唯一活动工具行、双笔互斥、荧光笔/手形切换、收合、整理链接/多选/复制移动菜单/层级菜单、摘录工具可逆切换；回忆`autoReview`开关为true后重载保持，再关回false；重载前回忆场景恢复成功，最终界面恢复标准/摘录。截图与AX原始读数在`evidence/mn5-alignment-20261029/a04-final-acceptance-20261031/`。
- 保护审计：卡片18、节点11、边2、复习记录/牌组/文档等业务集合逐项SHA与UI验收前一致；无新卡、节点或笔迹。测试设置保留显式`standard/excerpt`，`autoReview=false`。启动/重载时发现旧来源恢复提示，全部选择“稍后处理”而未猜源；两份`_marginstudy-recovery/pending-main-device-*`快照改变/新增，另列于`protection-diff.json`，不记为业务集合通过。
- **规划席复核：A04父卡仍未完成/不转正，step1Complete仍false。** 采用Hermes map v2为后续复核基准；标准四行的本次实际验收与合成v2 38/38通过，但read-write-recall/reading host row仍为null，writing host row没有冻结材料。未以标准模板验收或`missing=0`推断未采宿主行。该缺口需另批MN5采集。
- A06/A22未单独复验；其现有套件随全量verify执行。未操作MN5；MN5操作锁归属不变。下一步：Hermes按现有MN5锁协调补采reading/writing完整有序宿主行及状态材料，规划席据此更新对照并复核A04父卡。
### A04 映射 v2 与 R1–R7 Codex验收（2026-10-31）
- 规划席采用 Hermes × `deepseek-v4-1-flash-economy-261017` 的 `A01-A04-id-action-map-v2.json` 作为 A04 父卡后续复核的映射基准，SHA256 `75355383adb8305cce125ffe61a4730ec86152d686f8038ca976943ae6d2cf49`。口径64项：导航标签16、导航目标3、收合5、工具40（36已映射、3容器错、1机制不同、missing 0）、显示名差异10。只适用有证据覆盖的冻结控件；四个宿主有序行子序断言为true，read-write-recall/reading 行为null。
- **reading 与 writing 宿主完整有序行另批补采。** 本席选择单独补采，不由v2的`missing 0`推断未观察行；未改变A00–A31、原依赖或路线。本批未操作MN5。
- Codex × GPT-6（运行子型号未暴露）补充R1–R7合成断言：普通笔pressed互斥、笔1/笔2状态、荧光笔/手形切换、收合重绘后`aria-expanded=false`且活动preset与唯一true一致、annotations逐字段无变化/零ink。定向Workspace 204/204；带v2映射运行原`scene-tools-acceptance.mjs` 38/38、退出码0，原脚本未改；完整`npm run verify` 24/24、Workspace 204/204。运行记录、stdout/stderr/退出码、机读JSON哈希见`limit-candidates/A04/Codex-GPT-6-r1r7/`。
- 本批唯一源改动是`src/workspace/acceptance-fixture.txt`；scene-tools验收脚本、场景清单及工具渲染实现未改，测试已验证现有pressed行为。A04父卡和step1Complete仍false；候选映射采用作复核基准，不代表MN5宿主实机通过。
### A04 自动加入复习补完（2026-10-31，自动复习代码已转正；父卡未完成）
- 按用户本轮裁定完成最小扩围：`src/types.ts`增加全局`autoReview`设置（默认false）；回忆工具行以`data-ms-tool=auto-review`暴露开关，开启且无当前卡组时复用`openReviewDecks()`；阅读器`BaseController.makeCard()`仅对后续新卡复用`reviewDeckForStudySet()`与`enqueueReviewInDeck()`。不隐式建组、不补旧卡，关闭不移除既有成员；其他建卡路径不变。修订依据及限制见`planning-desk-20261030/A04-ALLOWLIST-AMENDMENT-2.md`。
- 新合成夹具覆盖开关两态重开持久化、稳定ID/aria状态、无卡组选择器/不隐式建组/未入组提示、开关启停入组与既有成员保留。新断言先红（202/203，默认值失败），接线后绿（Workspace UI 203/203）。完整`npm run verify`通过24/24套件，退出码0；本次构建更新`main.js`。日志和逐文件SHA在`a04-execution-20261031/auto-review-completion/`及`verify-auto-review/`。
- 来源登记：Codex × GPT-6（运行子型号未暴露）。规划席依据Codex终端验收将本批自动复习代码实现登记为**已转正**，范围限本节所列合成/终端行为，不扩展成MN5实机通过或A04父卡完成。只相对原冻结249文件核出6个变化：`src/types.ts`、`src/annot/baseController.ts`、`src/workspace/studyWorkspace.ts`、`src/workspace/acceptance-fixture.txt`、`src/mindmap/mindmapRenderer.ts`、构建生成`main.js`；无其他基线文件变化。`manifest.json`、`versions.json`未改。未操作MN5、未安装/部署；未单独重验A06/A22，其现有套件随全量verify运行。
- **A04父卡仍未完成/未转正**：本批闭合自动加入复习代码缺口，不替代原验收要求的Hermes隔离宿主证据及完整契约核对；原断言和路线不变。无新的MN5操作批次放行。
### A04 Codex核心修复（2026-10-31，执行结果）
- 按用户指令由当前Codex执行A04。根据原包“必要扩围由规划席修订”守卫，增加`src/mindmap/mindmapRenderer.ts`最小桥接白名单，具体见`planning-desk-20261030/A04-ALLOWLIST-AMENDMENT-1.md`。
- 已实现场景工具本地稳定ID、导航目标`data-scene-id`、独立收合标记；双普通笔pressed身份跟随实际preset并互斥；连接已有阅读器的writing/handwriting入口；回忆内手写保持回忆覆盖；整理场景复制移动/链接/多选从场景工具行直接调用mindmap接口。
- 新增合成Workspace UI断言覆盖导航/工具ID、双笔互斥、零业务副作用、回忆手写覆盖和整理场景动作。最终完整`npm run verify` 24/24套件全通过，Workspace UI 202/202；日志和文件索引见`a04-execution-20261031/`。未操作MN5、未安装/部署，版本1.2.40不变。
- 本节记录首轮A04执行收尾状态：当时`auto-review`缺授权接口，未造占位。用户后续已裁定最小接口，现状以本文件上方“A04自动加入复习补完”登记为准。A04父卡原完成断言保留，仍待隔离宿主证据。
- 冻结249文件中本轮变化为`studyWorkspace.ts`、`acceptance-fixture.txt`、`mindmapRenderer.ts`及构建生成`main.js`。fixture在本批前已有记录的附加候选。本轮未保存精确before副本，原冻结SHA仍保留，流程缺口记录于RESULT；A06/A22不重验。
### A04 Codex执行登记（2026-10-31）
- 用户明确将A04核心修复交给当前Codex。本批Codex × `gpt-6-luna`：为已渲染场景工具加入稳定本地ID与独立收合标记；修正双笔活动身份；接通现有阅读器的可复用笔/批注/手写设置入口；回忆内手写不再退出回忆。新增Workspace UI断言覆盖目标场景ID、双笔互斥、无笔迹副作用及回忆覆盖态。
- 最终完整`npm run verify`通过24/24套件，Workspace UI 202/202。日志和报告见`evidence/mn5-alignment-20261029/a04-execution-20261031/`。构建生成`main.js`；源改动限`studyWorkspace.ts`与已登记候选fixture。
- 本节是首轮执行登记：当时自动复习接口缺口及整理动作桥接尚未完成。后续最小扩围与自动复习终端验收见上方两次白名单修订及补完记录；A04原验收中隔离宿主证据仍阻塞父卡，本轮全回归绿不等于A04整体通过。
- 249冻结文件差异为`src/workspace/studyWorkspace.ts`、`src/workspace/acceptance-fixture.txt`、构建生成`main.js`；fixture在本批前已有先前登记的添加式候选。本批未留逐文件before副本，原冻结SHA及该流程缺口写入`a04-execution-20261031/RESULT.md`。未操作MN5、未安装/部署；A06/A22不重验。
### A04 Codex执行结果（2026-10-31）
- 用户明确改派当前Codex执行A04核心工具/场景动作修复；本批来源Codex × `gpt-6-luna`。已在A04白名单内为已渲染控件加稳定`data-ms-tool`、导航`data-scene-id`和独立收合标记；修正双普通笔活动身份；新增场景工具ID/双笔互斥/无业务副作用测试；回忆手写保留回忆覆盖状态，并接通可复用的现有工具入口。
- **完整`npm run verify`通过24/24套件；Workspace UI 202/202。** 日志及执行结果见`evidence/mn5-alignment-20261029/a04-execution-20261031/`。
- **A04仍未完成，未转正。** `auto-review`缺现有接口；organize复制移动/链接/选择仍代理legacy根工具栏，改为正确容器动作需要扩`MindmapRenderer`，该文件不在A04白名单。下一步需规划席评估并批准最小白名单扩展后再继续；不删原断言、不做占位。无MN5实机验收，不安装/部署。
- 基线249文件现差异3项：`src/workspace/studyWorkspace.ts`、`src/workspace/acceptance-fixture.txt`、构建生成`main.js`；fixture在本批开始前已有先前登记的附加候选。本批开始前未保全逐文件before副本，原冻结SHA清单仍留存；此流程缺口已登记，不伪称字节级before快照。
### CC操作锁释放（2026-10-31，第13次登记）
- 接受CC `LOCK-RELEASE.{md,json}`：CC已释放MN5操作锁；锁按默认规则回归Hermes。回执记录MN5/MN4/Frida无进程，MN5最后可见标准/摘录、Independent文档、内容未遮；偏好净变更0，34项交付索引完整。以上按回执记录，不扩大成对私有存储的证明。
- RE-1仍部分完成、工具恢复目标态未答；MN4完整动态对照因0天许可阻塞。RE-4是候选控制图完成（零GUI），不解锁writing现场采集。菜单/传统界面候选追认和操作事故仍保留。详见`planning-desk-20261030/CC-LOCK-RELEASE-REGISTRATION.md`。
- CC桌面批已停。无新现场任务自动开始；后续批次须规划席另行放行。P2/P3、A04状态不变。
### CC逆向批次规划裁决（2026-10-31，第12次登记）
- 已复核CC最终批次包，34项索引路径/字节/SHA256一致。详细五项裁决见`planning-desk-20261030/CC-BATCH-REVIEW-DECISION.md`。
- RE-1第五问保持blocked/当前条件不可答；静态读取点不等于运行结论。不可通过改签名/硬化绕过Frida阻塞。
- A04规范口径保持64条控件、40工具槽位；菜单镜像只作旁证，不扩分母。A04 v2 `tool-missing=7` 指插件场景壳缺入口；RE-3已在Standard试用13天状态观察7个入口可见。F11仅要求菜单AX缺席判断需结合截图/灰显及授权前置，不触发整表重采。
- 按本轮授权说明，追认CC额外菜单观察与`⌘⌥I`传统界面切换为候选取证范围；回切AX一致。记录操作事故，不把MN5传统界面当MN4实测或契约验收。
- RE-4接受为候选控制图完成（仅预备、零GUI），未重采冻结16条；不解锁writing实机采集或A04。RE4选择器/地址和控件到机制绑定按原证据等级保留。
- CC报告MN5已退出、无进程；当前桌面操作停止，MN5锁仍登记CC持有，待明确交锁/恢复交接。MN4动态对照因许可blocked。P2/P3、A04、三个完成flag保持原状；A06/A22不重验。
### CC定向逆向与MN5锁转交（2026-10-30，第9次规划登记）
- 用户明确要求CC按`/Users/tanlihen/.workbuddy/plans/cosmic-beacon-darwin-2Ef-HQZQ.md`执行难点MN4/MN5逆向，并授权规划席转移MN5操作锁。**规划席批准锁从Hermes转给Claude Code，限本批RE-0、RE-1、受限RE-2路由分析、RE-3。** 交接条件、操作边界及输出见`planning-desk-20261030/CC-REA-LOCK-HANDOFF.md`。
- CC在任何原生应用操作前须提交接锁回执，确认Hermes已停止并交锁、当前现场对齐最新恢复证据、实际客户端×模型、两版应用身份/哈希与隔离样本。回执前不操作MN4/MN5，防止双席并发。用户授权任务范围内，CC可按计划对隔离合成样本做Frida/REA受控动态对照。
- 用户计划明定P2/P3不自动解锁；故本批不做逐层/遮挡公式（P2）或浮窗跨重开/撤销（P3）。RE-2仅做不产生笔迹/不揭示卡片内容的工具路由实验。其余计划外项目、私有库、付费AI及绕过行为均不放行。
- P2/P3仍未放行；A04依赖仍未解锁、不得派Codex或改代码/测试。写入锁仍归规划席。此次只是逆向证据批次与操作锁交接，不改变A00–A31卡或三个完成flag。
- CC接锁回执已收到，客户端×模型为Claude Code × `qoder-cn/dfmodel[1m]`。规划席现登记MN5操作锁归CC；Hermes不可并行操作。Hermes release证据仅PARTIAL（无活动cua-driver会话、Hermes进程空闲，未有独立release确认）；CC开实验前须经共享调度确认Hermes停手。
- MN5/MN4当前均未运行，P10-Isolated-20261025未从UI核实；此前记录现场与当前不一致。用户计划已授权CC启动隔离实例，首步限正常启动、路径/哈希识别、UI确认样本及恢复基线；对不上即停止，不开始hook实验。试用只可正常继续，不绕过。
- 用户已补充授权放宽隔离样本要求：用户从未使用MN4/MN5且无个人文件，CC可浏览两版当前UI可见内容，并创建明确标记的合成文档做对照；发现疑似他人/用户内容则跳过。无需寻找P10隔离库。两版仍须顺序运行、固定同一合成文档哈希，并恢复本批临时材料；不读私有数据库、不碰账户/授权绕过或收费/联网AI。
- 接锁回执披露CC已将cua-driver升级至0.38.0并停掉Hermes旧daemon，Hermes侧路径仍旧。记录于`planning-desk-20261030/CC-REA-LOCK-RECEIPT-RULING.md`；Hermes后续使用GUI前需自行确认驱动路径，避免双daemon。
- RE-0静态符号图已交（readTools/saveTools、胶囊、hit-test候选）且Frida后端自报就绪；不能据此声称动态机制已证。接锁包`AUTHORIZATION-OVERRIDE.md`记录22:23点击MN5「继续试验」曾被用户拒绝。后续“可浏览应用内容/免隔离”未明确撤销该具体拒绝，故RE-1实机点击、启动MN5及Frida attach暂不放行；CC只可离线准备逐步实验与恢复方案。待用户明确允许正常继续试验后，先核对MN5现场，再由规划席放行RE-1动态批。见`planning-desk-20261030/CC-RE1-PREFLIGHT-RULING.md`。
- **更正并替代上条授权解释：** 用户说明被拒的是系统对CC代点的操作，用户本人随后已点击“继续试验”。RE-0 scene baseline核实MN5样本/场景/文档/主脑图/落点与登记恢复现场匹配。规划席现放行CC执行RE-1六步动态对照，范围、hook限制、恢复与停手条件见`planning-desk-20261030/CC-RE1-DISPATCH-RULING.md`。先前“因用户拒绝而阻塞”判定作废。
- **正式登记（第10次）：RE-0证据已接收；RE-1按“部分完成＋明确不可答”关闭本轮批次。** 来源CC × `qoder-cn/dfmodel[1m]`。MN5部分popup/胶囊/场景切换与单次重开观察已记录；Frida attach/spawn被拒，未绕过签名/硬化，工具路由动态调用链不可答。MN4完整对照子项单独因许可阻塞；零散UI观察不冒充对照完成。
- **RE-1结束恢复状态未知。** 报告有误点无标签AXButton导致MN5主窗口关闭、随后重开；结束状态有材料冲突且无统一最终恢复审计。本席不写恢复通过、不推断锁释放。CC已停止桌面操作；MN5锁仍记CC持有并冻结新操作，先补无歧义恢复回执。正式登记见`planning-desk-20261030/CC-REA-RE0-RE1-REGISTRATION.md`。
- **第11次更新：直接放行CC执行RE-4 writing候选控制图。** 可正常导航、检查UI/AX、查看相关菜单并做必要的可逆控件观察；采集合成场景下控件、入口、状态依赖和hook候选。核心边界：不重采/改写已冻结16条切片，不写内容/绘制/保存/导出，不揭示答案，不改持久偏好，不宣称完整映射。MN5锁归CC，留before/after并恢复本批瞬时状态。P2/P3、writing序列重采和A04仍未放行。范围见`planning-desk-20261030/CC-RE4-WRITING-CANDIDATE-RULING.md`。
### reading候选与A04依赖复审（2026-10-30，第8次规划登记）
- Hermes × `deepseek-v4-1-flash-economy-261017`提交read-write-recall/reading有序候选。5项索引全部通过；7项与冻结A01序列一致：导航3、工具3、末端收合1。只整理历史个人副本AX，没有新MN5交互；Help与Identifier均按历史来源登记。
- 接受其“序列候选与冻结A01相符”，不转正为当前MN5属性/动作验收。bounds、enabled、选中态、当前AX ID及隐藏项仍未知；`scenes.ts`第四项more与原生末端更多关系仍待定。无需为纯序列候选另开MN5补采；若未来验收要求几何/可用态，须另批明确放行。
- **A04依赖未解锁，不进入Codex派发准备。** completion-gap-matrix的goalComplete/step1Complete/A04Complete仍false；A04 v2虽修正导航目标ID、64项互斥分类和R1–R7候选，但read-write-recall/reading刚补的仍是历史候选，工具动作未验证，矩阵中其他步骤1缺口也未关闭。writing只冻结可见切片；不可据此宣称A01全映射完成。
- 允许继续离线完善A04候选文档；不得改代码/测试/冻结卡或派Codex。P2/P3及MN5新交互未放行。P4/A04批次和本次reading复审记录见各自候选包及planning-desk-20261030目录；状态由本席登记。
- MN5锁仍归Hermes；本席未操作MN5、未改代码/测试、未运行`npm run verify`。A06/A22不重验。

### 步骤1核对与下一批裁决（2026-10-30，第7次规划登记）
- 接受Hermes按原HANDOFF及completion-gap-matrix所作的只读核对：goalComplete、step1Complete、A04Complete均false；P0已按声明未知接受，P1按候选材料收尾；P2/P3未放行；P4只读整理原已允许但尚未交付。A01其余场景/模板输入与动作状态、A02各缺口、A03公式/AI/cache/导出身份、宿主视口及工具动作仍按矩阵状态，不以writing切片替代。
- **现在放行P4只读外部阻塞清单**，负责人Hermes；按移动、私有字段、模型/AI/cache、止损路线四类列出所需真实材料或不同可判别机制、当前边界与不执行事项。仅文档，不碰MN5，不伪造证据。
- **放行A04离线纯文本候选补强**，负责人Hermes；只在独立规划候选目录提交导航/工具/原生末端更多/收合分类、完整目标序列建议和双普通笔互斥红断言设计；原45/10/3/6仅为候选统计，须与冻结输入及AX逐项对齐。不得改源码、测试、A04卡、既有冻结包或PROGRESS；不得称映射正确、依赖解锁或验收通过。
- P4及A04候选均交RESULT/HANDOFF/snippet和哈希索引，由本席审核；A04父卡仍`BLOCKED_NOT_DISPATCHED`，不派Codex。P2/P3及所有MN5新交互仍未放行。writing可见输入切片保持第6次冻结；空档、工具动作和缺失属性仍为候选/未知。
- MN5操作锁继续归Hermes；纯文本A04可与P4并行离线做。未转交Claude。三项完成flag仍false；38/38、195项仅Hermes证据；A06/A22不重验。当前不运行`npm run verify`。
- 派工与交付标准见`planning-desk-20261030/HERMES-P4-A04-OFFLINE-HANDOFF.md`。本席仅规划登记，未操作MN5、未改代码/测试。

### writing有序输入当前裁决（2026-10-30，第6次规划登记）
- **冻结本批观察到的writing可见有序输入切片。** Hermes Agent CLI × `deepseek-v4-1-flash-economy-261017`（RESULT/HANDOFF自报）。17项索引待核；原AX顺序为导航3项、可见工具10项、收合1项，另2项为空档候选，共16条。回执写工具9项是计数错误，以原始AX为准。
- 冻结范围仅限可见顺序及已记录属性。两个空档身份仍是候选；AXIdentifier全null、AXHelp未知、selected=false不作互斥证据；自绘更多浮层内容缺失；scenes.ts键是语义候选，不是MN5内部ID。**不代表完整工具映射或A01验收通过。**
- P1按前次裁决收尾。P2/P3未放行。A04仍BLOCKED_NOT_DISPATCHED：步骤1前置、完整动作映射和双笔互斥验收仍未解锁。38/38与195项仍仅Hermes证据；不转正，A06/A22不重验。
- 下一步由Hermes按步骤1原HANDOFF未完成项继续，先核对原依赖及剩余候选是否解锁；不得重复writing或扩展到未放行项目。MN5锁仍归Hermes，PROGRESS锁归本席。
- 本席审核17项索引、原始AX/截图及恢复回执；250个产品/测试文件与旧快照一致。未操作MN5、未改产品代码，未运行npm run verify。


- **接受两项复位，P1按“候选材料交付完成、保留声明未知”收尾。** 来源Hermes Agent CLI × `deepseek-v4-1-flash-economy-261017`（RESULT/HANDOFF自报）。restore2正式索引6项路径/字节/SHA256一致，目录全部10文件另留哈希。AX明确主文档为P10-Independent-Review-20261025，截图确认标准/摘录、主脑图、目录·屏幕位置；脑图操作浮条关闭，无可见搜索面板/编辑器/卡片浮层。执行经过按回执登记，不冒记本席现场操作或旁观。
- **附件页签当前未呈现，原因及附件关系保留未知。** 未点击/未解绑为Hermes自报，不能据此独立证明关系仍在，也不能仅由AX缺项判定已解绑。此项不阻塞有限P1材料收尾，不追加附件/蓝框/字段/退出原因实验。旧蓝框身份、机制与持久化，CHILD-02字段1/字段2语义及P0来源，16:26退出原因均保持未知；旧视口/偏好等历史未知继续保留，不宣称恢复原样或MN5零持久写入。
- 审计8业务集合/25允许文件无差异、受保护数据写0次，只覆盖MarginStudy隔离宿主。审计operator仍为非economy型号，源脚本第62行硬编码旧标签；本批实际模型采用RESULT/HANDOFF的economy自报，元数据差异登记，不改原件、不为标签重跑实机。
- **明确放行下一批仅Hermes的writing/书写有序输入采集候选。** 只经正常UI选择已有阅读/书写/回忆模板及writing场景，取完整顺序/容器/标识或null/状态/锚点和原始AX/PNG，再回标准/摘录与Independent并审计。不执行业务工具，不新建/编辑模板，不用个人副本或handwriting冒充。责任人Hermes，本席审核后冻结；当前输入仍未冻结、不得宣称完整映射。派工单已落共享目录，尚无签收/启动回执。
- **P2/P3仍未放行，A04继续BLOCKED_NOT_DISPATCHED。** P1收尾不解除writing冻结输入、完整映射/双笔互斥测试候选及步骤1适用前置门槛。data-ms-tool仍按既定本地契约适用；五卡源链已接收，源ID—标记—PDF位置仍候选，A03.export未通过、不重复导出。38/38与195项仍仅Hermes证据，代码转正等Codex执行席终端验收及当批完整npm run verify；A06/A22不重验。
- MN5操作锁连续归Hermes，未释放/转交Claude Code；PROGRESS唯一写入锁归本席。本轮只读审核现成证据并写规划，250产品/测试文件与review-01快照一致；未操作MN5/Obsidian、未改产品代码/原卡、未运行候选/verify或REA。裁决、下一批范围及来源状态见planning-desk-20261030/hermes-review-04/DECISION-P1-CLOSEOUT.md、HERMES-WRITING-HANDOFF.md及intake-register.json。

### P1收尾补证前轮裁决（2026-10-30，第4次规划登记；已由第5次收尾裁决更新）
- 本批来源Hermes Agent CLI × `deepseek-v4-1-flash-economy-261017`，与上一批非economy型号分开登记。43项索引载荷路径/字节/SHA256一致，另3份说明与索引本身由本席快照留哈希；未把新取证冒记首轮原始输出。
- **接受五卡重新取证的原始链。** 五份编辑器AX包含对应唯一标记，正常菜单均有复制卡片URL，逐卡两份剪贴板原文/ID一致，与旧五行候选一致。此项不再退回，不要求重跑；它不构成导出器身份绑定或代码验收通过。
- **不继续追蓝框具体对象。** 当前图不见旧蓝框，历史对象身份/机制/持久化状态保留未知；不采纳“已证明非新对象、未持久化”，也不为此开REA或对象编辑/删除实验。
- **恢复仍仅差两项正常UI复位：** after/restored.ax.txt与PNG显示当前主文档为P10-Rich-Tables-Charts-20261026，应切回既定P10-Independent-Review-20261025；脑图操作浮条仍可见（新建卡片/粘贴/排列/缩放至合适大小等），须正常关闭。现有state-checks未覆盖该浮条和主文档，不能采用“无浮层、恢复完成”的总结。Hermes持锁执行这两项，交新恢复AX/PNG、允许范围审计及snippet，本席复核回写前不开下一实机批。
- 报告文字须收窄，不增取证任务：CHILD-02原AX只证首字段mnacj、第二字段标记，不能凭顺序证明“不是标题”；标题/正文语义及P0来源保留未知。全部折叠/适合大小/展开层级等真实变更登记保留，不宣称MN5无持久写入。应用先前退出原因未知，缺崩溃报告不等于排除崩溃；正常启动和继续试验过程单列，不作跨重开ID稳定性验收。
- 两项复位交回后可按“P1候选材料完成、保留声明”再判收尾；**writing排下一批但尚未放行，P2/P3仍未放行，A04继续BLOCKED_NOT_DISPATCHED。** 原PDF不重导，A03.export未通过，38/38与195项仍仅Hermes证据，A06/A22不重验。MN5锁继续Hermes持有，PROGRESS锁归本席，无转交Claude。
- 派工与来源登记：planning-desk-20261030/hermes-review-03/DECISION-MINIMAL-RESTORE.md、evidence-review.json、intake-register.json。本席仅审核现成文件/图像，未操作原生应用、未改产品代码、未运行npm run verify；本轮未用REA。

### P1前轮回传裁决（2026-10-30，第3次规划登记；已由第4次补证裁决更新）
- 已收到Hermes Agent CLI × `deepseek-v4-1-flash-261017`的P1 RESULT/HANDOFF/snippet；14项正式索引路径/字节/SHA256一致（目录15文件含索引本身）。五行公开ID—标记—PDF位置登记为候选，02/03曾由OCR位置推反、再用编辑器读回纠正的历史保留。当前不宣称五卡身份已独立验收或P1全部完成标准通过。
- PDF侧只读复核与回传一致：原哈希c8725f15…、两页、五标记各一次、页码坐标吻合；重新渲染查看，所查结构无对象ID关联。接受按原范围停止该PDF路线，不重复导出，不关闭A03.export；该文件未取得关联不等于PDF格式无法承载ID。
- **P1退回收尾补证，尚不放行下一实机批。** 逐卡两次公开URL原始结果及带字段归属的标题/正文AX未在包中留存，现有capture-log是候选汇总。恢复图另有三项未解释变化：文档左上蓝色矩形/控制点、脑图视口变化、CHILD-02黄色区额外字样（图像近似mnaq…，归属未明）。暂不判定数据被改，也不能沿用“仅焦点变化、无编辑”的全净结论。八集合/25文件审计仅覆盖MarginStudy宿主，不能排除MN5变化。
- **立即范围仅Hermes的P1收尾补证/可逆状态核对。** 优先归档已有原始调用输出，解释蓝框、额外文字和字段归属，按正常UI恢复可确认临时状态并交AX/PNG/审计。归属和精确Undo项均明确才可按既有守卫撤销，不盲撤、不删除或手改回填；原始记录缺失就注明，不将汇总改名冒充原始。视口可声明保留，不猜值恢复。新补件另存，不覆盖原包。详见hermes-review-02/DECISION-AND-NEXT.md。
- **后续次序：P1收尾回写后，writing排为下一实机批；P2/P3均未放行。** writing仍由Hermes补实际样例有序输入、本席审核冻结；当前只许只读整理历史材料。A04映射/测试可离线补候选，禁止继续写共享源码/测试。完整目标序列、双笔互斥等仍缺，原依赖未解锁，A04继续BLOCKED_NOT_DISPATCHED，38/38及195项仅Hermes证据，A06/A22不重验。
- **REA按问题选用，当前无新增逆向批。** UI/AX负责公开身份和场景状态，PDF脚本负责已有文件，有源码先读源码；REA只为明确内部机制疑点准备静态问题包，保留目标哈希、Evidence ID、限制和耗时收益。合成程序反编译成功不代表MN5取证提速，不开启受调试MN5、不读私有库、不自动重试旧止损路线。
- MN5操作锁继续归Hermes，未释放/转交Claude；PROGRESS唯一写入锁归本席。本次只读审核、PDF解析/派生渲染及规划文件回写，未操作MN5/Obsidian、未改产品代码/原卡、未运行npm run verify。复审源模型、状态和补件登记见hermes-review-02/intake-register.json。

### REA深度引擎接通（2026-10-30；不改变下方任务门禁）
- 用户追加授权接通REA深度分析引擎。本席已复用既有REA 6.5.0、Ghidra 12.1.4和OpenJDK 21.0.12.1，实测合成arm64 Mach-O函数搜索与反编译，得到`x * 7 + 11`，关闭目标后open=false。证据`ev_d76c99138e36c6d01fdba182d76d12a3b3f9907af531971630cd8faeedf288db`；这是工具链能力验证，不是MN5/项目功能验收。
- 已经授权备份并仅给现有Codex REA注册增加GHIDRA_INSTALL_DIR及JAVA_HOME；从实际注册命令/环境新启服务复核Ghidra=available。现有运行代理需重连才能读取新配置，不能声称内置工具表已热加载。共享CLI入口为`.tools/rea-ghidra`；本次未改Hermes配置，Hermes是否加载自身MCP仍须实际回执。
- 后续有明确内部机制问题时可分派REA静态/资源分析，保留目标哈希、Evidence ID、限制和候选解释；P1公开ID/PDF及writing现场冻结仍按既有范围执行，不用逆向替代可见行为、恢复审计或Codex完整npm run verify。本次未启动MN5、未读实际库、未调用observe_native_calls，MN5锁继续归Hermes；A04仍冻结禁发，A06/A22不重验。详情见planning-desk-20261030/rea-readiness-20261030/RESULT.md。

### Hermes前轮回传裁决（2026-10-30，第2次规划登记；P1状态以第3次为准）
- **P0接受为passed-with-declared-unknowns，放行有限范围P1。** 来源Hermes Agent CLI × `deepseek-v4-1-flash-261017`（依据RESULT/HANDOFF自报运行时，本席未独立核服务端日志）。已核正式索引23项路径/字节/SHA256一致，并查看前后AX/PNG：确认样本、标准/摘录、目录·屏幕位置、附件收起、无可见试用或临时对话框。八集合/25允许文件审计无登记差异只覆盖MarginStudy隔离宿主，不证明MN5私有数据。P0仅是恢复门槛，不是步骤1或功能验收通过。
- 四项已声明未知/未恢复继续保留：笔宽原值、脑图原视口、自动离线OCR原偏好、DevTools停靠偏好；本批未新开回忆设置、未逐张复核父卡正文评论，不写成新证实。Hermes“全程零写入”收窄为审计脚本对允许宿主数据写0，不推定MN5切场景零保存。以上不阻塞P1只读身份核对；遇未解释对象/内容/设置差异立即停手回报。
- **P1负责人Hermes × `deepseek-v4-1-flash-261017`。** 仅对既有父卡MN5-A03-PROMPT、MN5-LAYER-CHILD-20261029及MN5-PAGE-CHILD-02/03/04补公开源ID、唯一标记、源顺序，并只读比对已有MN5-five-cards-grid.pdf的页码/文本坐标/逐页渲染顺序及结构化ID关联。五行身份与证据、PDF检查、边界、恢复后AX/PNG和保护审计齐备才算“P1材料交付完成（候选）”；缺源ID则交部分结果及阻塞。若PDF仍无结构化ID，止于“源ID—标记—PDF位置”候选，不宣布A03.export通过。不得重复导出、编辑/新增/删除对象或改设置。发放已落共享目录，尚未收到P1启动/完成回执；P2/P3仍不放行。
- **采纳data-ms-tool作为A04本地场景工具按钮DOM稳定ID方案，未采纳整份映射正确或代码通过。** 身份按模板ID+场景ID+本地工具键定位，活动工具行内唯一；导航继续data-scene-id，收合与原生末端更多单列，不能按图标合并。须以审定冻结序列核对完整有序ID/数量/唯一性/容器及实际动作、退出清理、双笔互斥、重开和无业务副作用，之后由Codex执行席红绿+完整npm run verify及对应真实隔离宿主证据验收。当前不落代码、不解除A04冻结。
- **writing/书写冻结输入主责指定Hermes，规划席审核冻结。** 先只读复核旧18-copy-writing-tools（个人副本，不能冒充样例）；新MN5采证排在P1恢复收尾且本席回写后另行开始。须明确read-write-recall模板/writing选中状态、完整控件顺序/原生ID或null/本地键/容器/状态/锚点及原始AX/PNG哈希，候选另存，不覆盖A01旧契约。不得用handwriting或源码补形，冻结前不宣称全部场景完整映射。
- **A04继续BLOCKED_NOT_DISPATCHED。** 映射与测试均已收到，登记候选并退回补齐，不再记“未收到”。Hermes所报45 mapped/10 missing/3 wrong-container/6 different-behavior保留为候选数字；reading前三项在原AX的Help为阅读/书写/回忆，应按场景导航纠正归类；多个tab键为null。整理动作代理和收合差异需核对实际行为，不能直接把内部代理判成错误，也不能把按钮存在判通过。writing未冻结、原步骤1整体前置与其余功能证据仍未解锁。
- **38/38与195项仅登记Hermes证据。** 38项只比现有部分工具及不同preset；其probe显示笔1、笔2在两次切换后仍同时aria-pressed=true，缺互斥红断言。未覆盖完整A01、reading/writing和若干动作；195不是历史201项或完整回归。测试候选须补强，未完成npm run verify，未有Codex终端验收或代码转正。
- **锁继续：** Hermes已于12:22（+08:00）接MN5操作锁并持续持有，未释放/转交Claude；本席保留PROGRESS唯一写入锁，不操作MN5。每批恢复、留证并由本席当场回写后才能开下一批或转锁。候选修订只能另存独立目录，冻结期间不继续改共享源码/测试。
- 复审材料：evidence/mn5-alignment-20261029/planning-desk-20261030/hermes-review-01/DECISION.md、evidence-review.json及intake-register.json。原始证据登记“原始证据”，映射/公式/机械对比和测试登记“候选”；补件退回是材料完整性判定，不是代码终验失败。A06/A22已转正记录不变、不重验。本轮未运行候选或verify、未构建安装、未改产品代码/原卡、未操作原生应用。

### 额度期协作规则v2与前轮判定（2026-10-30；冲突项由上方复审覆盖）
- 本轮用户指定当前会话为规划判定席及 PROGRESS 唯一主写者。来源客户端×实际模型：Codex × GPT-6（具体运行子型号未暴露，不冒记 Kimi 或 gpt-6.1-sol）。本席不执行核心代码、终端验收或 MN5 操作；预案中的 Kimi 主写职责由本轮用户指令指定给本席，不存在两个并行规划结论。
- 现行分工按 evidence/mn5-alignment-20261029/额度期协作预案-v2.md；A00–A31卡内容、顺序、估时、依赖、完成断言和路线A/B不变。步骤1由 Hermes Agent × DeepSeek V4.1 Flash 接手；Codex执行席下一窗口仅预留A04核心工具/场景动作批。A00及已转正A06/A22不重做，093–106不重复补账。
- **两个唯一锁：** PROGRESS写入锁归本轮规划判定席，其他席位仅交RESULT/HANDOFF/PROGRESS-snippet，原Kimi席位不得并发主写；MN5操作锁默认归Hermes × DeepSeek V4.1 Flash，尚未收到实际接锁回执。只有Hermes明确忙不过来、本席登记转交、前任完成恢复并释放后，Claude Code才能接锁；本轮未转交。每批结束均须恢复本批临时状态（登记保留样本除外）、交恢复证据并由本席回写；未完成不得开下一批或释放操作锁。
- **Hermes发放：** planning-desk-20261030/HERMES-STEP1-HANDOFF.md 已落共享目录，未取得签收；无直达Hermes会话通道，不记为已送达会话或已执行。立即范围仅P0现场核对/恢复；P1五卡导出身份映射、P2遮挡最小新判别组、P3一个浮窗可逆缺口须等P0回报、保护范围无新差异与本席明确放行，P4整理外部阻塞。公式、映射及机械对比均先登记候选。
- **A04门禁：禁止派发。** A04-PACKET.md 已冻结已有A01有序输入、双笔同时活动/工具缺项证据、249个源码配置程序文件及43个参考输入的哈希、白名单、原A04断言、测试提纲和验收路径。直接依赖A01具有Mac可见证据切片依据；原路线步骤1整体未解锁，精确产品ID/动作映射与本批可执行测试候选仍不齐。该包是材料冻结，不是可执行放行，不得派给Codex或写A04父卡通过。
- **窗口规则：** 后续仅在适用原依赖明确解锁、候选完整且基线兼容后放行A04同一核心批；Codex做必要红绿、实跑当批完整npm run verify并交终端RESULT，Hermes另供新宿主证据。不让Codex窗口内取证、检索、对比或整理，不夹带其他卡，不重复验收A06/A22；完整verify自然包含既有套件不等于另开重复验收卡。
- **现场纠正：** 最新已存round-closeout-20261030/mn5-current.png/.ax.txt显示Standard试用弹窗，优先于下方旧“学习集首页”文字；不是本席当前实时观测。Hermes先留当前AX/截图，只通过正常UI“继续试验”进入确认样本；不能进入即停，不购买、不激活、不绕过。四项未知/未恢复分别保留：笔宽原值、脑图原视口、自动离线OCR原偏好、DevTools停靠偏好。不猜值回填，不宣称全部恢复干净，不删除保留合成样本。
- **材料登记：** planning-desk-20261030/intake-register.json记录来源客户端×实际模型、模型自证限制与原始证据/候选/已转正/已退回状态。历史A06/A22采用Codex ACCEPTANCE的已转正结论，不照抄旧snippet中的待验和规划席验收建议；Hermes新RESULT和A04测试补丁尚未收到。候选、自验、机械复点、同族互查均不构成验收，代码转正只据Codex终端验收。
- 本轮仅维护规划材料与本文件，未运行npm run verify、未构建安装、未改产品代码、未操作MN5/Obsidian。详情：evidence/mn5-alignment-20261029/planning-desk-20261030/RESULT.md；下方既有时序记录保留，冲突的旧“下一步”不再执行。

### 历史实施记录（以本节上方现行判定为准）
- 2026-10-30 本轮收尾：A03五卡两页导出、逐层节点收展和单卡遮挡对照已登记；步骤1和A04仍未完成，移动对比按用户决定延期。目标状态当前为 usageLimited，需由系统或用户恢复后继续。
- 已用父卡及四个唯一标记子卡实测2×2卡片流跨两页：5个标记各一次、顺序一致；3个新增子卡保留在隔离学习集。该合成分支通过局部对照，步骤1/A04仍未完成。
- 新建并保留隔离合成子卡 MN5-LAYER-CHILD-20261029；逐层回忆下父卡分支圆点收起/再次展开子卡可见，仅单分支证据，完整A03和步骤1仍未通过。
- 用户决定：移动端对比暂缓，待 MarginStudy 做好后在安卓实测；步骤1继续处理其余桌面断言。此决定覆盖移动端时间顺序，不代表桌面未通过断言已完成。
- 用户澄清：手头安卓设备用于验收 Obsidian 中的 MarginStudy，不能运行 MN5。此前要求在安卓设备打开 MN5 是错误指令；不再要求。MN5参考取证继续使用已确认的电脑端，安卓实机只证明 MarginStudy 的移动表现。原计划A02移动形态断言及其他缺口保留，待确定可用的对应参考材料，不将安卓宿主冒充 MN5。
- 已按原A01/A02/A03断言收敛当前桌面契约，旧汇总留快照。A03公开ID两次一致，正文冒号误录已按旧/新AX纠正；只改文档不改卡片。原断言仍有缺失，步骤1/A04保持未完成。
- 隔离1.2.40新增真实CSS测量：三视口1512×855、756×855、756×427（DPR2），短窗四场景共6状态；均唯一底栏/工具行。当前48个可见工具按钮中心命中且在视口内，但A01入口缺失未解，步骤1/A04未完成。
- A03追加单评论计数对照：同一卡评论折叠/展开均剩1处，揭开正文后菜单为遮回本卡。只冻结该合成卡关系，通用公式、独立评论遮挡和步骤1/A04仍未完成。
- 原目标继续：单页扫描PDF显式OCR正负搜索及命中定位已取证；步骤1/A04未完成。ocr-probe/RESULT.json记录搜索自动离线OCR开启的可见副作用，原偏好值未知，不猜回填。
- 用户前置第一、二步已完成：A06/A22已转正；093–106分组补账和新现场/保护审计完成。按用户要求续接原步骤1目标；步骤1/A04仍未完成。
- 历史记录（已由本轮第二步完成报告替代）：第二步进行中：新现场确认摘录落点目录/屏幕位置、回忆跟随默认/原位遮挡、无残留导出对话框；093–106逐组原证据补账尚未全部完成，暂不进入第三步。
- 用户席位变更生效：Kimi K3.1 Pro只规划；A06、A22由Codex终端验收。两包现为A类已转正（执行 AutoClaw × GLM / 验收 Codex）。第一步已完成，下一步才补093–106账与现场。
- 新增086–092：Selection既有合成摘录卡原文定位/高亮/返回/再次定位已证，公开URL两次一致。导出精确对象身份仍未证，步骤1/A04未完成。
- 当前：064–085手写/整理/回忆入口证据已收口；两支普通笔同时活动、手写入口不全及窄窗溢出均未通过。步骤1/A04保持未完成，后续旧“下一步”只作历史。
- 宿主052–061补窄窗摘录7类工具AX动作与恢复；截图确认底栏窄窗溢出，不能判全部指针可达。A04/步骤1继续未完成。
- A02新增046–051：已见附件笔迹绑定原书页提示，实际页签回源两种交互未证，止损；临时笔迹已Undo，附件收起，恢复标准摘录。步骤1/A04仍未完成。
- 新卡创建Undo探针041–045未通过：撤销只清空正文，第二次撤销及重做无可见效果；重进空白编辑再Escape后临时空卡消失，未执行删除。目标保持active。
- 追加034–040已证新建整卡截图评论保存关闭后Undo/Redo；最终Undo恢复原一条评论及标准摘录。步骤1/A04保持未完成。
- A03追加026–033证实已有截图评论笔迹编辑保存后Undo/Redo；临时横线经最终Undo清理，原斜线保留，恢复标准摘录。步骤1/A04仍未完成。
- 窄窗追加018–025：四场景、收合/展开、回忆设置菜单已取得宿主AX/JPEG；3次场景编辑经正常Undo清理，八集合和27文件哈希一致。
- 证据索引续作：A02/A03契约更新导致2项旧哈希过期，已保全旧索引并按新契约刷新；原始截图/AX未改。步骤1/A04仍未完成。
- A03追加012–017证实合成卡标题保存后Undo/Redo及撤销后重开原标题，最终恢复标准摘录。步骤1/A04仍未完成。
- 续作追加：正常UI再撤销2次场景编辑后，学习集scene字段与基线恢复；八集合、27份源文件哈希全部一致。步骤1/A04仍未完成，逐项缺口在continuation-20261029/completion-gap-matrix.json。
- 续作证据见continuation-20261029/RESULT.md：浮窗同会话重开已补，三档宿主AX/JPEG已保存；步骤1/A04仍未完成。
- 用户已授权：新对话使用 gpt-6.1-sol 实施 MN5 对齐，分步骤列为目标；采用路线 B 优先，再续路线 A。
- 步骤0 / A00 已完成基线、证据索引与依赖审计；未修改产品源码、未安装新版本。计划原样保留：evidence/mn5-alignment-20261029/PLAN.md；步骤：GOALS.md；审计：a00/RESULT.md、validation.json、dependency-audit.json。
- A00记录身份：当时源码/构建1.2.38，继承完整21/21，旧日志独立保全；A00未重跑。当前源码/构建已推进1.2.40，完整22/22、Workspace201/201、Reader209/209；最近冻结候选仍1.2.37，阶段一隔离安装已推进到1.2.40。package.json的0.2.0仅为遗留元数据。
- 步骤1目标已创建，在MN5 5.0.0（50010）已确认的P10-Isolated-20261025合成样本继续A01–A03。MN4/MN5共享bundle ID，必须用/Applications/MarginNote 5.app选取。标准模板实见摘录/手写/整理/回忆，阅读在读写忆样例中。
- 旧 MN4 三栏菜单、D07 等“下一步”仅保留历史，不再作为当前执行指令；旧 M1 未完成事实不改写。
- 步骤1进行中：step1-desktop/已保存137个编号状态的Mac AX/PNG、索引和实际MN5卡片流PDF。A01冻结五类场景、首页三分区和模板编辑器；A02以`A02-desktop-contract.json`冻结Mac可见导航、主附件、浮窗、搜索与OCR空态；A03以`A03-desktop-contract.json`冻结新合成卡的正文、截图评论保存重开、原位遮挡与部分逐层行为。明确未知项写在两个契约的`notFrozen`，步骤1目标保持active。
- 已完成仅依赖A01的独立A04.1模型切片：源码/构建1.2.39，旧1.2.38的274个源码/程序文件保存在round-1.2.39/before/，1.2.39的276文件身份另在round-1.2.40/before/保全。场景注册表、每学习集场景/传统界面选择、无写入默认与冲突引用底座已实现；完整22/22通过，Workspace200/200、Reader209/209、脑图手写13/13，审计见round-1.2.39/RESULT.md与audit.json。底栏仍未接入，A04整卡不计通过；1.2.39未冻结、未安装。
- 1.2.39已完整保全到round-1.2.40/before，276个源码/程序文件逐文件哈希一致。1.2.40接入A04.2公共场景底栏：标准模板唯一底栏显示摘录/手写/整理/回忆，读写忆显示阅读/书写/回忆；切换只更新学习集场景，卡片、节点、文档批注和Reader业务状态无变化，传统三模式路径保留。红测从1项失败转绿，完整22/22、Workspace201/201；见round-1.2.40/RESULT.md与audit.json。
- 1.2.40仅安装到阶段一隔离库。Obsidian 1.14.5实见唯一场景底栏、四场景切换、回忆场景关闭重开恢复和最终回摘录；业务集合及27份源文件哈希与A00一致，四次场景编辑历史用正常Undo回滚。三视口、窄窗、完整工具锚点和移动端仍未验收，1.2.40未冻结。
- Mac 已装 MN5，代理应先自行取得可访问的实机证据，不能仅因用户未上传截图就阻塞全部任务；只在确认的隔离合成样本上操作。平板真实手感和实际 Obsidian 跨端同步仍需相应设备证据。
- PROGRESS.md 继续作为唯一状态入口；每批更新原有五段结构，历史严格审计失败保留。正式库部署与第10包关闭仍需最终用户签收。


## 已完成及验证方法
- 第4次规划登记：五卡编辑器原始标记与10份剪贴板URL链已核，43项索引载荷哈希一致；原始链缺口解除。蓝框身份停止追查、保留未知。恢复图/AX仍明确显示Rich主文档和脑图操作浮条，本席仅发两项界面复位，不把审计或候选报告写成MN5全净/功能通过。
- 第3次规划登记：P1正式14项索引身份一致，五行候选入账；本席只读核对PDF标记/结构并逐页渲染查看，原PDF未改。恢复原图与P0对照后发现未解释状态，已发P1收尾补证范围，未把候选或宿主审计当成MN5功能通过。
- REA→Ghidra已做真实合成程序分析和伪代码验证，持久配置读回及新服务binary_session复核通过；未执行合成目标、未分析MN5。首次沙箱缓存权限失败和函数名解析失败均保留，授权后按返回地址验证成功。原卡、源码和既有功能验收状态不因此改变。
- 第2次规划登记：已审核Hermes P0回传并接受有限恢复门槛，正式索引23项文件身份一致、前后AX/PNG已查看；已放行P1材料取证并采纳本地data-ms-tool身份表达方案。此为规划裁决，不是代码/功能通过。具体模型来源、边界、P1完成标准和writing责任见本文件顶部及hermes-review-01/DECISION.md。
- 已登记Hermes落盘的两个未转正测试候选：acceptance-fixture.txt附加probe及新增scene-tools-acceptance.mjs。只读重建确认移除附加段后原fixture与前轮冻结哈希一致，新入口与交付副本相同；前轮其余248文件及43参考输入未变。本席未应用、回滚或执行候选；原249文件基线不静默刷新，变化单列留痕。
- 2026-10-30规划席已完成只读接管、Hermes共享目录交接和A04已有材料身份冻结；来源Codex × GPT-6（具体子型号未暴露）。249源码/配置/程序文件与43参考输入的逐文件SHA256见planning-desk-20261030/baseline-hashes.json；原始A01序列单独保留。仅核对文档/文件身份与范围，不构成功能验收；原卡、路线、源码和既有原始证据未改。
- A06/A22的RESULT/HANDOFF/PROGRESS-snippet已登记历史来源AutoClaw × GLM系列（具体型号未自证）及Codex终端验收（具体型号原文件未记载）。沿用已转正结论和24/24历史结果；本轮未重复执行或转正。其他未自报实际模型的历史材料标来源待补，不凭授权模型名推定。
- 本轮收尾复核：桌面证据索引及续作证据393项检查无失败；仅证明文件身份与存在性，不构成功能验收。新保护审计八个隔离宿主业务集合和25个允许文件均与A00基线一致，事先排除2个Claudian文件；见 round-closeout-20261030/protection-audit.json。
- 五卡两页分支证据已同步A03契约及缺口矩阵；其他对象/布局与全图身份断言仍未通过。
- multipage-branch-probe/RESULT.json：实际MN5分支导出A4两页，独立文本提取及144dpi逐页渲染：第一页4卡、第二页1卡，原截图评论斜线完整。八集合/25允许文件审计通过；不外推无ID的其他分支。
- 父子分支导出的子卡唯一标记已通过MN5公开复制URL对应到 8C06C687-8865-40A0-9737-D5442D55609E（单次复制）；PDF本身无结构化对象ID清单，全图身份仍未证明。搜索词已恢复并关闭。
- 父子分支导出证据已同步A03契约及缺口矩阵；全图对象身份、顺序和分页仍未通过。
- 合成父子分支实际卡片流导出：1页A4、父标题及唯一子卡标记各一次且父在前；144dpi渲染证实父卡评论斜线与两卡完整可见。仅限该两对象样本，不证明全图身份/顺序/分页；审计见 branch-export-probe/RESULT.json。
- 正文遮挡开关单卡对照已同步 A03 桌面契约；原通用公式仍未冻结。
- 正文遮挡开关对照：临时关闭后A03三行正文可见且菜单无计数；恢复默认后AX确认跟随默认、原位遮挡和正文开关开启。八集合/25允许文件审计见 body-mask-toggle-probe/RESULT.json；不推广成通用公式。
- 两评论对照已同步A03桌面契约和缺口矩阵；仅单卡有效，通用计数公式仍未证明。
- 两条截图评论计数对照：同一合成父卡两条折叠评论时仍显示还有1处；正常撤销新评论，重开确认原评论1。八集合/25允许文件保护审计见 two-comment-count-probe/RESULT.json；通用公式仍未证明。
- 默认原位遮挡对照：新合成单行子卡内容可见，菜单无剩余遮挡标签；父卡正文仍有遮罩。只证明该对照，不外推通用公式。证据 layered-child-probe/11–12。
- A03 桌面契约已登记新建合成父子分支的收起/展开可见证据；原逐层答案揭示断言仍未通过。
- layered-child-probe/03–05截图记录父子连线、收起和再次展开；06确认回忆恢复跟随默认/原位遮挡，07恢复摘录。八集合及25允许文件保护审计见RESULT.json；新子卡保留。
- step1-closure-review-20261029/ASSERTION-REVIEW.json逐条保留原断言：A01五场景有序ID/原始AX/图像尺寸及首页模板锚点已检查；A02/A03按完整范围保留缺口。A03公开URL两次782F8294-3F53-4A68-98FF-0D83308DB63F，间隔重开只读确认原标题/三行正文/单评论。搜索词Question恢复并关闭；八集合/25允许文件一致。
- host-css-probe/RESULT.json由正常DevTools只读DOM几何生成：底栏相对工作区居中误差0、距视口底24 CSS px。先前截图像素不再当CSS；本次窄窗摘录未复现旧广义溢出判断，旧图保留并限定范围。四次场景切换经精确标签守卫Undo，八集合/25允许文件恢复一致。
- comment-count-probe/01–09保存标题/正文/单评论状态及两个1处菜单、揭示后遮回本卡。评论折叠后重开保持；最终一条评论折叠、标准摘录及Independent主文档恢复。本批未编辑标题/正文/笔迹，未创建删除对象。八集合/25允许文件保护审计通过。
- OCR专用样本经独立解析为1页1图、文字层为空。首次搜索提示扫描页未搜；点击“识别并搜索”后482917命中第1页，点击后1/1且数字橙色高亮，739205负对照无结果。已恢复Question查询、关闭搜索、回Independent主文档；新合成文档保留。保护审计八集合/25允许文件一致，见ocr-probe/protection-audit.json。
- 093–095固定落点、096–097离开重开保留、098–101取消固定恢复目录均由AX和截图交叉核对；两个首页计数一致。102–104导出设置/预览/保存路径核对，新PDF独立解析并重新渲染两页，A03标题三段正文和截图评论斜线可见。105–106原AX不足以证明退出，用native-current/native-restored新现场补强而不覆盖。详见codex-terminal-acceptance-20261029/093-106-GROUP-REVIEW.json。保护复审八集合/25允许文件一致，Claudian两文件排除。
- Codex新增native-current/native-recall-default/native-restored AX与截图。设置只读核对后退出并恢复摘录；093–106之后保护审计见codex-terminal-acceptance-20261029/post-093-106-protection.json：八集合和25允许文件比对，Claudian两文件排除。
- 采用两包PROGRESS-snippet并按当前集成状态校正：A06显式功能索引48条（34命令+14设置），Cmd/Ctrl+Shift+P、设置定位、旧ID拒绝、Esc清理经10/10合成UI检查；A22三模板APKG、图片/回源/标签与保留TSV，缺媒体写前失败经8/8检查。Codex实跑完整24/24，96项索引核对无未解释差异；独立sqlite3读两个APKG均integrity_check=ok，builder 5笔记/6卡/3模板/2媒体、wrapper 4笔记/5卡/3模板/1媒体。证据：codex-terminal-acceptance-20261029/ACCEPTANCE.json。来源：执行 AutoClaw × GLM / 验收 Codex。
- A02.navigation.excerptSourceLocation记录公开note ID CEFA3CD9-96F8-466E-B07A-0AC5C81874FC、源文档第1/4页、蓝色选区、高亮、原主文档返回。只用正常UI读取复制链接，未访问MN5私有存储。
- scene-tool-actions.json逐状态核对064–085；所有19组AX状态断言匹配，但其中包含缺陷/禁用态，不等于功能通过。4次标签守卫Undo后八集合及25允许文件与A00一致，见scene-tool-protection-audit.json。
- 本批宿主初审studySets不一致，旧失败报告保留；062–063两次标签守卫正常UI Undo后，八集合及25允许文件恢复A00一致。新审计narrow-tools-protection-restored.json。
- narrow-tool-actions.json记录手型/矩形/文本/更多/标题链接/块选择/文档笔记本的实际入口和状态断言；工具初态及宽窗已恢复，八集合与25允许源文件审计一致。
- 附件新增笔迹后MN5明确提示记住原书页；点击及长按未见回源。精确“撤销文档手写”守卫Undo后笔迹消失、Undo禁用。八宿主集合和25允许源文件哈希与A00一致，两个Claudian路径排除不重读。
- 新卡探针失败已按实际状态记录A03.cardCreation.creationUndoProbe；041–045保留失败及最终空卡消失证据，不计为功能通过。
- 新建截图评论：明确选择新建入口、画一横线、Done后评论2默认折叠；关闭后Undo移除、Redo恢复，最终Undo重开仅原评论。A03契约newCommentCreationUndo及034–040留证；隔离宿主八集合与27文件审计见new-comment-protection-audit.json。
- MN5-A03-PROMPT已有截图评论加一横线后Done保存并关闭卡片，全局Undo后重开一笔，Redo后重开两笔，最终Undo后重开一笔；原标题及三段正文仍可见。证据026–033，A03契约已补。
- continuation-20261029/narrow-host-observation.json记录标准四场景唯一活动工具行、收合后展开恢复回忆、设置菜单打开并Escape退出；均为真实隔离宿主。3次标签守卫Undo后保护审计通过。
- 新增continuation-20261029/verify-evidence.py复核三个桌面索引及A03标题续作文件；运行结果在evidence-integrity.json。校验只证明证据文件身份与存在性，不是功能通过。
- A03标题编辑：MN5-A03-PROMPT临时加-UNDO-PROBE，Escape提交后菜单撤销恢复原标题、底栏重做恢复标记、再撤销并重开确认原标题；证据continuation-20261029/012–017，已补A03契约。
- 续作011与protection-audit-restored.json证明八个业务集合及27份文档/侧车/导出均与A00一致。上轮8次Undo后尚有差异，本批再逐条撤销2次后恢复；旧protection-audit.json严格失败保留。
- 续作003/004证实独立主文档浮窗同会话取消/重开保持几何，005恢复主文档；006–010保存宽屏/半屏/短窗与Undo现场。cards/nodes/edges/srs/reviewDecks/documents/canvases哈希与1.2.40一致，studySets仍有差异，详见protection-audit.json。
- MN5实机：标准四场景与读写忆样例的阅读、首页学习集/复习卡组/资料库、分类/置顶菜单、空筛选态、模板复制/重命名、文档与目录/页面/可加入卡片、书脊和双文对照均留AX/PNG。创建个人模板副本P10-MN5-Evidence-20261029；原样例保留，当前学习集恢复标准/摘录。复制学习集配置在此样本无已存字段，实机按钮禁用，只冻结该空态，不宣称复制成功。
- MN5固定主脑图临时项6E750112-05AF-487E-9CDE-66804248F240重开后ID一致；正常UI取消固定并确认完成，浮球消失，主脑图保留。回忆方式临时改逐层后经恢复默认回到跟随默认/原位遮挡。临时双文对照已关闭，主文档保留。
- MN5主附件：侧文档标签的独立下拉箭头可执行「夹到另一份文档上」；P10-Rich夹到Independent后，离开并重开仍保持。菜单可取下附件并恢复双文；关闭侧文后重开只要主文。夹附时全局Undo禁用，原生撤销和内部持久字段不推测。证据66–71推翻旧「找不到入口」阻塞，历史50现场保留。
- MN5卡片与回忆：在标准整理场景新建可写合成卡`MN5-A03-PROMPT`，原生换行输入的三段正文重开后保留；整卡截图评论写入一笔，编辑器撤销/重做通过，保存后显示`评论 1 · 整卡截图批注`、默认折叠，重开仍有笔迹。原位遮挡显示标题和答案遮罩，状态`还有 1 处`；揭开、遮回本卡、整卡揭开、只重新遮挡均已验证。逐层能收成标题，但具体下一层展开手势未证明，不作通过。
- MN5卡片流参考：MN5-P10-card-flow-2col-A4.pdf经真实UI保存，2页、A4 595.28×841.89pt、PDF1.4、无加密，SHA256 ad3fb66fbffb16f7a8c7a36bbe339575d63e8af7d07ce260c46878425e1acc9d；两页已解析并渲染。文字抽取不能证明对象身份、排序或每对象恰好一次，故保留该导出断言未冻结，不当作MarginStudy A25验收。
- MN5回忆设置只读补证：模式有原位遮挡/逐层回忆，四类遮挡开关均存在；单项揭示默认关闭。AI提示默认关闭，结构化提示和设备端优先禁用，设备状态显示`模型仍在下载中`；未发起联网或收费调用。
- A04.1合成Store测试4组红→绿：旧数据读取零保存；两学习集场景独立重开且卡片/节点/手写容器不变；传统界面保留场景、非法/重复选择不写入不增撤销；可选模板注册表与冲突版本/引用保留。完整22/22通过，Workspace200/200、Reader209/209、脑图手写13/13；新目录round-1.2.39/verification/。22隔离安装载荷、27既有文件、实际data.json及全部保护业务集合相较A00哈希不变。没有安装新版本。
- A04.2公共UI红→绿：新增断言要求默认标准模板四场景顺序、唯一底栏、仅一个活动工具行、切换不改卡片/节点/批注且场景重开恢复。首次失败为缺少场景底栏；实现后201/201。首次全量类型检查发现两处按钮参数收窄错误，修正后完整22/22。证据在round-1.2.40/ui-red-green/与verification/。
- MN5追加取证56–137已由`step1-extension-evidence-index.json`逐文件登记SHA256；66–71主附件、72–76搜索/OCR、78–122新合成卡评论与回忆、123–136多命中搜索与逐层止损、137最终标准摘录恢复均在索引中。索引可由脚本复核。
- A00：33旧ID唯一处置为仍成立6/目标已变23/作废4，76页主归属唯一，P067排除；24个N项有官方来源、页面快照哈希、待取证字段，32原卡完整索引。a00/audit由audit-a00.py可复核；不计功能验收通过。
- A00保护审计：27既有文档/侧车/导出哈希不变，保护节点、全部卡片、reviewDecks、documents与1.2.37宿主结束状态一致；实际data.json/侧车未手改。A00源码哈希与各业务集合哈希已留档，历史严格审计ok:false保留。
- A00依赖：A08导航与子图/看板固定拆卡，完整固定依赖A18.0/A19.0；A11.1普通动作与A11.2浓缩接入拆卡，后者依赖A24；A07批量成员事务保留B前置；A25.core与新手写导出拆卡；A30/A31明确B候选和A完整范围，父卡断言全部保留。
- 1.2.36选区行为的早期局部证据保留于round-1.2.36/more-green.log与more-local-results.json；该版本随后已完整回归、冻结并隔离安装。
- 区域折叠基础闭环已通过Workspace197/197、Reader208/208；再补Extend/缩放/隐藏文字不进入新摘录检查后198/198。新增导航分段断言发现仍计隐藏高度，已修正共享投影，局部198/198、Reader208/208通过；尚未宿主/视觉验收。
- 核查纠正：PDF selectionActions已有Insert into TOC，调用真实setEditableOutline并进入目录撤销链；复用，不重复开发。
- P0完成：执行入口evidence/efficient-alignment-20261028/PLAN.md；scope-map.json覆盖33闭环、76个唯一实施页面，程序断言无遗漏无重复，P067排除。页面归属不等于验收通过。
- 历史源码及隔离安装为1.2.34，完整回归21/21；Workspace186/186、Reader208/208。证据入口：evidence/package10-20261028-handoff/DELIVERY-1.2.34.md。
- 1.2.35切片完成：文档菜单五入口接通原有唯一五tab，HTML标题链接多结果断言修正。完整21/21、Workspace187/187；真实宿主五入口选中/关闭/单实例验证通过。
- 历史隔离安装1.2.36，完整21/21；Workspace198/198、Reader209/209、L4公共UI10/10。历史交付evidence/efficient-alignment-20261028/round-1.2.36/DELIVERY.md。
- 1.2.36真实宿主验证选区/更多及单词所在区段折叠；临时fold-mvsc4ljw-1urbrn已通过正常Undo清理。25源文档/侧车哈希不变，保护节点不变。保存元数据和lastBackup逐字段登记；历史严格审计差异保留。
- MN4参考侧卡片真实导出补证（不是MarginStudy产品验收）：在`P10-Isolated-20261025`的合成卡片经真实UI写入临时鼠标笔迹、`Export Branch`导出并保存为1页PDF；144 DPI渲染确认笔迹存在且无裁切。随后通过`⌘Z`撤销，截图确认笔迹消失。当前画布stroke为0，画布数量恢复为4，业务数据除保存元数据外与1.2.36基线差异为0。证据见`evidence/efficient-alignment-20261028/round-1.2.36/CARD-EXPORT-ROUND.md`。
- 历史隔离安装1.2.35。证据evidence/efficient-alignment-20261028/round-1.2.35/DELIVERY.md、verification/、native-verification.json、host-audit.json。
- 新轮次相较当前基线业务/设置不变，25文档/侧车哈希一致；两项工作区视图变化逐字段登记。历史严格审计失败仍保留。

## 未完成及原因
- 第5次现行：P1有限材料/恢复门槛已收尾，仍是候选材料，不代表A03.export或步骤1通过。writing采集已放行但未有新回执，输入仍待审核冻结，完整映射/双笔互斥测试及原适用前置仍缺；P2/P3未放行，A04仍冻结。附件页签缺失与历史蓝框/字段/退出/视口偏好等未知保留，不追加P1实验。
- 第4次历史：当时原始链接收后两项界面复位待回；第5次已接受复位与文字收窄，放行仅writing采集。P2/P3未放行、A04仍冻结。
- 第3次历史：当时P1候选的源侧原始链及恢复疑点待补证；第4次已接收原始链，剩两项界面复位。writing/P2/P3及A04未放行事实不变；公开ID跨设备/重开稳定性和标题→ID保存路径仍只保留边界，不额外塞入P1写入实验。
- 第2次历史：当时P1已发放但未收到回执，writing输入未冻结；现已由第3次P1候选及收尾判定替代。A04未通过事实不变。
- 前轮历史（P0已于本次接受、P1本次已放行）：当时Hermes尚无P0接锁/恢复回执，A04映射和测试候选尚未收到；原冻结提纲不是可执行放行。
- 步骤1的原逐层答案揭示、遮挡通用关系、附件笔迹回源、导出全图对象身份等仍缺足够证据；A04完整工具及同态视觉锚点未完成。已证合成样本不得外推为原断言整体通过。
- 混合正文/划重点计数样本：尝试可访问文本选择和可见文字拖选后均未看到可辨认选区；未执行重点动作，退出编辑器，该选区路径止损，不能计混合遮挡通过。
- 本轮选择合成父卡“导出本卡”后，菜单关闭且当前窗口未显示导出或保存对话框；未取得文件，不计单卡导出通过，也不据此推断导出目的地。
- 两段子卡输入尝试因焦点/选区与预期不同未形成可验证两段；已恢复并重开确认原单行，相关输入路径止损，不计遮挡公式通过。见 layered-child-probe/RESULT.json。
- 单分支圆点展开不证明点击标题揭示答案与下一层的完整动作、内部字段或通用遮挡公式。
- 原断言审计仍未满足每状态持久字段/对象ID/撤销、移动、逐层下一层、创建Undo、通用遮挡公式、AI/cache、精确导出对象顺序。公开卡ID只能证明输入身份，不能反推导出文件中的对象映射。
- CSS测量只证明当前可见工具几何/中心命中，不证明缺失工具、全部动作或与MN5同态锚点误差≤4 CSS px。手写缺铅笔/文本框/图片框/手写层/更多等入口；双笔同时活动旧缺陷未复测，不宣称已修。
- 单评论计数对照不能证明多评论/荧光笔/摘录等通用公式；未出现独立评论遮挡控制，不以正文整卡揭示代替该断言。
- OCR本批只证单页英文/数字显式识别和定位；多语言、时序、重启缓存与偏好作用域未证。识别后UI显示搜索自动离线OCR开启，原值未记录；不能声明MN5全部偏好恢复。
- 本次PDF只补A03单合成评论可见导出；全图精确对象顺序/每对象一次、移动端、逐层等原缺口仍未通过。笔宽原值未知、脑图视口未回原值原样保留。
- 历史记录（已由本轮第二步完成报告替代）：第二步剩余：093–101原始固定/重开/取消固定组，以及102–106导出保存组须逐组核验并补账；尤其不能以PDF文件存在代替导出内容断言通过。
- A06合成Chromium/settings.ts验证不冒充Obsidian实机；A22未做Anki桌面或移动实机导入/渲染，不能写Anki实机通过。A01–A03与A04父卡状态不因本次转正改变。
- Selection回源仅覆盖一张既有桌面摘录卡；摘录落点固定、连续摘录归属及跨页仍缺。现有卡片流PDF无链接注释/命名目标/身份清单，文本和内容截图不能证明精确对象顺序及每对象一次。
- 当前新增缺口：场景两支普通笔同时活动；手写缺铅笔/文本框/图片框/手写层/更多等A01入口；回忆重置当前禁用未执行。全部工具效果、ID对齐、指针可达、CSS锚点和移动仍未证明。
- 新增可见问题：窄窗底栏有控件越过右边界；AX可激活不能代替指针可达。矩形入口toast写套索模式，未验证几何摘录。全手写/整理/回忆工具、CSS锚点及移动仍缺。
- A02实际源页跳转/高亮/临时返回仍未证；当前主文档只有一页，跨原书页测试缺多页合成材料。首次拖动误入笔宽滑条，事后显示文档1.3，原值未知，因此不宣称MN5偏好恢复。
- 新卡创建撤销重做仍未证：该路径只见正文清空与退出空白编辑后移除，缺创建对象撤销和恢复闭环。
- 更新：截图评论保存后Undo已分别覆盖已有笔迹编辑和新评论创建，下面旧条目的该项缺口已解除。新卡创建Undo、评论独立遮挡计数、逐层下一层、AI缓存、精确导出及移动端仍缺。
- 已有评论笔迹保存后Undo已证；新评论创建Undo仍未隔离。独立遮挡计数、逐层下一层、AI转换/缓存、精确导出对象顺序及移动端仍缺，不将已有评论编辑等同于全部卡片Undo。
- 窄窗仅场景切换、收合/展开和回忆设置入口完成；全部工具动作、每按钮指针可达、CSS比例与≤4px锚点、移动端仍未证明，A04父卡不通过。
- 证据索引一致不代表步骤1完成；completion-gap-matrix.json新增titleUndo单项通过，评论Undo、逐层、AI/缓存、移动和正式窄窗断言仍未通过。
- A03保存后标题撤销已证，但不覆盖新卡创建撤销、截图评论保存后撤销、独立遮挡计数或逐层下一层；这些断言仍未完成。
- 当前已补源文件27/27审计。步骤1尚缺移动形态、附件回源、若干对象/持久字段与保存后Undo、逐层下一层、AI转换/浓缩缓存与精确卡片流断言；宿主窄窗CSS锚点及全部工具动作未完成。
- 续作图像尺寸3024×1710、1514×1710、1512×856仅为图像像素；此前“点数/完整通过”的聊天表述纠正。≤4 CSS px锚点、完整工具动作、窄窗矩阵和移动端仍缺；27份文档本轮未复核。
- A04.1模型与A04.2合成公共UI底栏已通过完整回归，并有单个真实Obsidian隔离宿主观察；三视口与窄窗锚点、完整工具状态及移动布局仍待做。当前源码/构建1.2.40并仅隔离安装，A00时冻结候选仍1.2.37；1.2.40未冻结，A04父卡不计通过。
- A02桌面契约已写但未整体签收：主附件保存重开与解绑可逆已证，原生撤销未知；移动形态、浮窗重开尺寸和附件回源未冻结。搜索唯一/多命中及双向二次按键循环已证；扫描件自动OCR未证。
- A03桌面契约已写但未整体签收：评论与正文持久化可证，保存后卡片级Undo未隔离；逐层下一层展开、截图评论独立计数、收费/联网AI输出及卡片流精确对象排序仍缺证据。它们只阻塞对应断言，不阻塞已冻结部分进入开发。
- A03逐层路径连续两次停损：标题卡普通点击只选中，双击进入标题编辑，“展开到层级”只打开1–8级菜单。已在默认原位遮挡恢复并留证，不把层级菜单当作下一层内容展开。
- A01只冻结Mac可见结构，不声称平板或三端通过。Mac可访问部分继续自主取证，移动形态、OPPO手感和真实跨端仅阻塞对应验收。所有功能原卡均未因A00映射而通过。
- 原计划卡工时求和A134–219/B59–96小时正确；并行112–177/47–76缺调度证明，未校准；新增前移依赖影响B完整范围预算，按实耗重估，不作完成时间承诺。
- P1–P6整体未完成。P0已建账和主要责任映射；各页具体断言仍需按闭环核查，不能按映射覆盖率算完成率。
- M1仍缺设备模型、Pencil和视觉证据；MarginStudy脑图真实导出鼠标闭环已补，卡片PDF仅为MN4参考侧证据；MarginStudy卡片带手写导出仍未证明，也不等于Pencil压感通过。历史严格数据审计ok:false，卡片保存时间与视图差异保留；空手写容器已通过1.2.37真实UI擦除流程移除，未回填旧值。

## 当前阻塞
- 第7次现行：goalComplete/step1Complete/A04Complete均false。P4只读清单与A04离线文本候选已放行、待Hermes交付和本席复核；不得改源码/测试或派Codex。P2/P3、MN5新交互仍未放行；A04原依赖与完整动作/互斥证据未满足。
- 第5次现行门禁：P1限定材料及两项复位不再阻塞下一批。仅writing采集获放行，冻结输入/完整映射/双笔互斥测试候选与步骤1适用前置仍未齐，A04禁发；P2/P3仍待单独放行。附件页签关系与历史未知不转正，也不作为有限P1无限追查理由；八集合/25文件审计不覆盖MN5状态。
- 第4次历史门禁：当时只剩Independent主文档/脑图浮条复位；第5次已接受回执，不再作为当前阻塞。
- 第3次历史门禁：当时蓝框/额外文字/视口及原始链待补；第4次已接收原始链并以保留未知收敛历史解释，只剩主文档/浮条复位。writing、完整A04目标映射/双笔测试及原依赖门槛继续保留，PDF同一路线停止。
- REA深度引擎“未接通”已解除；当前代理内置MCP工具表未热加载、Hermes自身MCP接入未验证属于客户端连接状态，不再写作Ghidra未安装或不可用。此工具链接通不解除A04原依赖、writing输入或完整行为测试缺口。
- 第2次历史门禁：P0接受后曾限定放行P1；当前P1已回传，按第3次裁决先补收尾。A04未解锁事实不变。
- 回传元数据待Hermes新修订：RESULT内嵌索引引用不存在的before/01-excerpt.png（正式23项索引已使用00-current，未失败）；映射generatedAt含12:5x占位。允许随P1只读整理补正，不重做P0，不伪造重复原始文件。四项未知偏好仍分别登记，不将其泛化为必须猜值恢复的阻塞。
- 前轮历史门禁（本次P0已接受、P1已放行）：当时无P0回执，最新已存现场为Standard试用弹窗，A04映射/测试未收到；该前轮状态已由本次回传和裁决替代，A04禁止派发仍有效。
- 历史现场（已由round-closeout-20261030试用弹窗替代）：MN5曾显示学习集首页，无可见导出对话框；该现场不证明回忆设置或摘录落点当前值，相关已恢复记录见此前证据。笔宽原值未知、脑图视口未回原值继续保留；DevTools停靠偏好未复原。
- 历史分页准备失败（后续五卡两页样本已另有证据，原失败保留）：误点卡片工具后MN5打开Bing并查询合成标题 MN5-A03-PROMPT，已关闭面板。仅该合成标题可见，未发现AI调用；具体网络传输细节未审计。该失败批未创建分页子卡，不计其分页断言通过。
- 本轮设备工具复核：`adb` 不在 PATH，`xcrun simctl list devices booted` 返回找不到 simctl，`system_profiler SPUSBDataType` 无输出；这不能证明没有物理设备或已有录屏。已向用户询问可用设备或资料位置，移动实证仍缺。
- 桌面契约的过时搜索/OCR/评论Undo缺口已校正；真正剩余是停止重试的原生路线、私有字段边界、移动/模型材料和宿主工具/同态锚点，不以继续追加相同截图充作进展。
- 宿主CSS坐标未知缺口已缩小；同态MN5参考标尺、完整工具ID/动作和移动材料仍缺。DevTools为测量改为独立窗口后关闭，dock-right偏好未复原，不能记所有宿主偏好完全不变。
- 本轮重新读取设备状态仍为“模型仍在下载中”；AI提示关闭，未开启或发起模型调用。证据comment-count-probe/10-model-status。
- 计数关系现有单卡证据；通用公式和独立遮挡仍缺可区分材料。原逐层、附件回源及新卡Undo路径继续止损。
- 扫描件显式OCR缺口已缩小，仍不具备调用计数/跨语言/持久作用域证据；不会用单页结果关闭A02父卡。
- 第一二步前置阻塞解除；原目标仍受真实移动材料、逐层/附件回源止损路径、AI缓存和导出对象身份不足约束，不降低断言。
- 继续保留笔宽原值未知和脑图适合大小视口未回原值两项；不猜测回填。现场默认回忆与未固定落点已取得新证据。
- A06/A22原卡终端验收缺口已解除；预案原“规划判定席验收”由用户决定覆盖为Codex验收，不将其旧自述作为通过依据。
- PDF的结构化身份映射不足已确认；公开Selection卡URL不能反推出当前PDF内对象ID。附件笔迹回源既有止损保持，不能用普通摘录回源替代。
- 已取得的入口证据不足以通过工具完整性：同时高亮与入口缺失由实机和源码对应。仅属于宿主1.2.40问题，不据此改写MN5参考契约或关闭A04。
- 本轮场景配置残留已按2次标签守卫Undo清理；宿主业务保护复审通过。MN5笔宽原值未知的问题仍保留，不与宿主审计混淆。
- 宿主底栏溢出和CSS比例证据不足，A04父卡不能关闭；本批只取证，不跨入未解锁的实现步骤。
- 附件源页签在手形点击与长按路径均未出现；该路径止损。临时笔迹已清理，但MN5笔宽原值缺证，未猜值恢复。
- 新卡Undo探针不满足原断言，同路径停止重复；仍可继续A02附件回源、宿主工具动作及导出对象核对。
- 更新：截图评论保存后Undo阻塞已解除；不可将其扩大为A03全通过。逐层两次失败路径维持止损，收费AI、私有数据库和移动端边界不变。
- A03已有截图评论笔迹的保存后Undo阻塞解除；新建评论撤销与独立计数仍需单独取证。逐层路径保持此前两次止损。
- 右边界拖动尝试报windowNotFoundAtPosition，已停止该拖动路径并使用系统半屏继续；不把未成功拖动后的尺寸写为实际最小宽度。
- 两契约旧哈希过期已修复，原索引快照保存在extension-index-before-contract-refresh.json；不把索引维护当作业务功能完成。
- A03标题Undo取证已解除；截图评论保存后Undo需单独隔离对象事务，不能用标题路径代替。逐层路径此前两次失败仍止损。
- 续作场景清理阻塞已解除：新增2次带标签守卫的正常UI Undo后，studySets与全部保护业务集合恢复。历史8次Undo未完全恢复的失败记录保留，不再列为当前阻塞。
- 场景清理未完成：正常UI撤销8次学习集编辑后，P10-Luna的scene仍为organize，studySets哈希与基线不同；严格审计false保留，不手改实际data.json。须先核清Undo余项再清理，不能盲目越过其他动作。
- A02.attachment旧AX阻塞已由独立下拉箭头解决，夹附/重开/解绑均有证据；不再把“入口未知”列为当前阻塞。原生持久字段与夹附撤销仍未知，A09回源仍待做。
- 审计偏差：Obsidian最初自动恢复上次使用的`MarginStudy验收库`，随后立即切换至阶段一隔离库；错误库未执行内容/设置操作，但宿主可能写入其工作区状态，不能记工作区文件完全未变。isolated库业务集合和27份源文件哈希仍与A00一致。
- A08完整固定子图/看板待A18.0/A19.0稳定身份；A11浓缩待A24；A25新手写评论导出待A14/A16。普通导航、普通动作和核心卡片流可按各自证据独立推进，未通过子项不标父卡通过。
- 软件切片无外部阻塞；设备、模型、USB、跨设备只阻塞对应实机验收。

## 下一步第一动作
- 当前无新桌面派工。CC若结束其席位批次，下一步只提交MN5锁释放及恢复交接回执；在交接前不启动新MN4/MN5批次。若后续需恢复RE-1第五问，先提供合法可注入环境；MN4对照需许可条件变化。A04继续不派发，P2/P3未放行。
- 当前无CC桌面批在执行；CC已释放锁，默认操作锁归Hermes。任何新实机批由规划席单独书面放行；RE-1未答项、MN4许可阻塞、P2/P3和A04门禁照旧。
- 当前第一动作：Hermes并行完成P4四类外部阻塞只读清单及A04纯文本候选补强，按第7次派工单交RESULT/HANDOFF/snippet与哈希索引；不改源码/测试，不操作MN5。规划席审核后再判是否解锁A04，未解锁不得派Codex。
- 当前第一动作：持MN5锁的Hermes按hermes-review-04/HERMES-WRITING-HANDOFF.md采集已有阅读/书写/回忆模板的writing有序输入候选，交before/active/after原始AX/PNG、有序JSON、索引/哈希、允许范围审计及RESULT/HANDOFF/snippet。本席收到后判冻结，不将本单落盘记成已签收或执行。
- P1原始链不重取、PDF不重导，附件页签/蓝框/字段/退出原因不追加实验；不盲撤或手改mnacj。P2/P3继续排队，A04保持禁发；离线候选另存，不写共享源码/测试、不启动受调试MN5，A06/A22不另开验收批。

### 历史下一步（本轮不作为派工指令）
- 恢复目标后，从已确认的 P10-Isolated-20261025 合成样本继续未完成桌面断言，优先寻找与既有止损路径不同且可判别的新机制；每批保留证据、做保护审计并更新本文件。移动对比待MarginStudy做好后在安卓实测。
- 查到官方 MN4 手册介绍节点收缩符号和附属笔记本回源，仅作为寻找不同可判别交互的线索，不当作 MN5 证据；在确认新路径及保护恢复方式后继续，原两次失败路径不重复。
- 根据原断言审计仅尝试有新材料或不同可判别机制的缺口；若安全桌面路径已尽，保留目标未完成并登记需外部材料的具体项。禁止重复逐层/附件回源/新卡Undo止损路线。
- 优先对齐同文档/同对象/同窗口/同缩放的MN5参考锚点，或审计剩余对象/持久字段证据。当前宿主已宽窗摘录、四次场景编辑已撤销；不重复已测三视口几何。
- 按原A01/A02/A03断言收敛剩余材料清单：优先可访问的对象身份/重开字段；移动、AI缓存、通用遮挡与精确导出缺口保留，不重复已证OCR和单评论计数。
- 继续A03截图评论独立遮挡计数的可区分证据，或按原断言审计可访问缺口。已止损的逐层/附件回源/新卡Undo不重试。
- 续接原目标：按completion-gap-matrix逐条核对剩余可访问断言。已补摘录落点固定/重开/取消和A03截图评论导出，不重复旧工具入口循环。
- 历史记录（已由本轮第二步完成报告替代）：完成093–106逐组原证据复核与PDF内容核验，写回PROGRESS后再继续步骤1；A06/A22已转正，无需重复验收。
- 历史记录（已由本轮第二步完成报告替代）：按用户第二步逐组核验093–106原始证据、现场摘录落点/回忆默认/无导出对话框，并补后续保护审计；完成后再继续步骤1。
- 对原计划A01/A02/A03完成断言逐条审计，重点检查还可访问的摘录落点固定与导出范围。当前MN5主文档已恢复，适合大小脑图缩放保留。
- 核对原计划A02/A03剩余的可访问导航/导出断言；不重复已经留证的工具入口循环。MN5逐层、附件回源和新卡Undo既有止损路径保持停止。
- 补隔离宿主手写/整理/回忆各工具的实际入口；按真实结果保留窄窗溢出缺陷，之后逐条核对原计划缺口，不用AX可点替代指针验收。
- 转向1.2.40隔离宿主窄窗具体工具动作矩阵，或复核导出对象范围；不重复已止损附件回源及逐层路径。MN5附件收起、标准摘录。
- 转向A02附件回源的可见UI证据，或宿主窄窗具体工具动作。当前MN5标准摘录，临时新卡已在空白退出后消失，脑图视口有平移。
- 优先补A03新卡创建保存后Undo或A02附件回源；不重复已证标题及截图评论Undo循环。
- 下一项A02附件回源，或A03新建截图评论的创建撤销。当前合成评论已恢复原一笔、原标题和标准摘录，不重复本轮编辑撤销循环。
- 继续A02附件回源和A03截图评论保存后Undo；宿主窄窗余项按narrow-host-observation.json列出，不重复已证四场景循环。
- 继续A02附件回源或隔离宿主窄窗工具状态，A03标题Undo不重复。每次契约改动运行verify-evidence.py，再刷新续作索引。
- 继续宿主窄窗工具动作矩阵或A02附件回源；A03下一项隔离截图评论保存后Undo。合成卡标题和标准摘录均已恢复，不重做已证标题循环。
- 基线已恢复，按completion-gap-matrix.json继续：优先A03新合成卡保存后Undo与宿主窄窗工具矩阵，再补附件回源。逐层已两次止损路径保持停损；不启收费AI、不读私有数据库、不正式部署。
- 先核清当前场景Undo余项、恢复A00学习集基线并复核27份源文件；再补窄窗工具矩阵与A03独立合成卡保存后Undo。A03逐层止损不重试。
- 1.2.39模型与1.2.40公共场景底栏均已完成合成回归，1.2.40也完成单窗口隔离宿主观察。下一步补三视口、窄窗、工具可达与视觉锚点；通过后才考虑冻结。A02/A03剩余未知项继续补证，步骤1与A04父卡不提前关闭。
- 当前执行：步骤1，MN5隔离合成样本A01–A03采证；从标准模板与读写忆样例模板工具序列开始，逐状态保存AX、截图、对象与恢复/撤销证据。随后仅启动契约已冻结的独立模块。以下旧MN4动作仅为历史记录。
- 当前先收敛M1。1.2.37已完整21/21、Workspace199/199、脑图手写13/13、Additive27项通过，冻结并隔离安装。真实卡片无改动保存逐字段不变；实际擦除最后一笔、撤销/重做和宿主重载通过。27既有文件哈希、保护节点、全部卡片/牌组/文档登记不变。见round-1.2.37/DELIVERY.md与host-audit.json。下一源码轮次1.2.38。
- P1卡片菜单：按P040冻结契约接入Basic/Advanced/Favorites三栏，复用当前剪贴板、卡片编辑/复习和节点业务动作；先从公共UI断言单容器、切页不改业务与卡型可见性开始。
- 真实PDF.js验证通过：CropBox与0/90/180/270°旋转下收缩画布、移除对应文字像素、撤销恢复尺寸且源字节不变；Reader209/209。测试前置改为完成同步导航，避免平滑滚动未结束时对离屏页断言。
- 卡片剪切已改为会话内待移动，成功粘贴才移动原节点，挂到所选目标卡下；非法后代拒绝且无业务变化、一次撤销恢复、跨脑图保留内部链接与卡片ID、源已变化拒绝旧剪切均通过，L4公共UI10/10。拒绝路径预检移到事务前，去除可选keywords字段的加载自动补写。
- 历史时点源码及隔离安装1.2.37；现已核清源码1.2.38、安装1.2.37。1.2.36/1.2.37冻结候选保留，MN5实现使用后续新版本、新轮次。
- 每15分钟记录差异、复现或阻碍；同题两次失败后检查输入与状态归属。

## 禁区清单
- 本轮规划席不写核心代码、不做终端验收、不操作MN5/Obsidian；其他席位不得写PROGRESS。候选不齐或原依赖未解锁不得派给Codex；公式、映射、复点与同族互查不得升级为通过；A06/A22不重复验收。
- 执行席只在阶段一隔离库写测试；当前MN5仅用P10-Isolated-20261025（旧MN4记录留历史），须明确应用路径/版本。保护正式yan、异常验收库、WorkBuddy、Question卡、保护节点、P10牌组和missing登记。
- 不手改实际data.json/侧车，不恢复旧快照抹差异；不读Claudian凭据/聊天，不发送真实草稿。
- 不以合成硬件或模型冒充实机通过；不覆盖冻结候选；正式部署与第10包关闭仍需用户签收。

## A08 修复后新建项复核补记

隔离宿主新建子脑图固定项 fixed-mvxouvir-x0xt1r，保存 scale 1.2 / x -2740 / y 565；新建前子脑图已视觉空白，重启后打开仍空白，AX 列出目标节点。恢复时实际视口、gutter 和节点矩形尚未取得，不能认定数值偏差或验收通过。未修改源码；A08 保持未关闭。详见 evidence/mn5-alignment-20261029/a08-execution-20261101/RESULT.md。

## A08 后续修复尝试

Codex 调整脑图视口尺寸变化时的滚动恢复顺序、延迟零尺寸初始定位，并调整滚动容器 flex 最小尺寸；构建并安装至隔离库。实际打开子脑图仍空白，故修复未验证通过。尚未取得恢复时 gutter、节点矩形和实际视口数值，不能确认根因；本轮未运行完整 verify。A08 未关闭。

## A08 子脑图空白修复及验证

实测空白时 viewport 685×503、gutter 2740×2012、scroll 0×0；去除已挂载模态框的重复 append 后子脑图首次打开可见。新固定项 fixed-mvxpgzl2-m446cw 保存 scale 1.2 / x 7.5 / y 14，重启隔离 Obsidian 后目标节点可见。恢复时数值和节点矩形未实测，子图独立平移尚未证明；看板与局部视角真实宿主重开仍待原断言复核，A08 不提前关闭。完整 npm run verify 退出 0，Workspace 216/216、Reader 210/210；构建与隔离安装哈希一致，详见 A08 RESULT。

## A08 隔离宿主补充复核

重启后看板固定项能打开看板，局部视角固定项显示目标节点及子节点；看板样本保存 boardViewport 0/0，未证非零滚动恢复。新增子图 fixed-mvxq3281-8msei0 保存 scale 1.2 / x 7.5 / y -10.5，重启后节点可见；未取得恢复时数值与保存前节点矩形，不能断言精确视口恢复。新增固定项仅为隔离库样本，现保留。完整 verify 沿用上一轮退出 0 的结果，本轮未改代码。A08 原断言仍待上述数值和非零滚动核对，未关闭。

## A08 看板非零位置复核

隔离宿主滚动看板后新建 fixed-mvxqcv3j-ulqan9，持久化 boardViewport 为 x 0 / y 158.5；重启后打开该项，底部目标卡与滚动条位置在视觉上回到保存时位置。此为宿主视觉复核，恢复时 DOM scrollTop 未直接读取。子图 fixed-mvxq3281-8msei0 重启目标可见；精确恢复数值仍待量测。无代码变更。

## A08 完成复核（2026-11-01）

子图样本 fixed-mvxq3281-8msei0 保存 scale 1.2 / x 7.5 / y -10.5；隔离 Obsidian 重启后临时诊断实测同值，节点矩形 (552.5, 280.703, 276, 122.625) 位于视口 (512, 222.203, 700, 518.297) 内。看板非零位置保存 y 158.5，重启视觉位置一致；合成验收另核对非零 scrollTop。局部视角及看板重启可打开，固定对象 ID、入口计数、对象删除后的不可达与不误删由 Workspace 合成验收覆盖，浮球拖动重开已在宿主验证。完整 verify 24/24、Workspace 216/216、Reader 210/210；临时诊断已移除，重建后主程序与隔离安装 SHA256 均为 cbd034c4ad27d090c3d1af49a63ccb0ce4181e4a9435752da6e1767cb1f1f7be，与完整验证构建一致。A08 按原断言完成，隔离库保留测试固定项，未正式部署。

## A09 执行中（2026-11-01）

旧 Reader 对照同文件改为选择不同文件：桌面调用 openPopoutLeaf，移动调用工作区分屏，选择时可启用按比例同步滚动。学习集增加 documentAttachments 关系，文档标签菜单可绑定/解绑，文档重命名更新关系；合成测试验证绑定持久化及解绑保留文件和卡片，Workspace 217/217。此前完整 verify 通过但早于新增验收测试；真实桌面与移动仿真尚未完成。当前实现尚未把附件关系接入重开时自动呈现，不满足 A09 主附件重开断言；工作区内也尚未提供对照入口。A09 未完成，不得转正。隔离库已安装候选构建，未正式部署。


## A09 续作交接（2026-11-01）

已接通工作区 PDF 双文入口与主文档附件按钮，类型检查通过，完整 npm run verify 退出 0，Workspace 217/217、Reader 210/210。候选已安装隔离库；真实桌面从 P10-Independent-Review 打开 P10-Rich-Tables-Charts 独立 popout，第二文件 5 页。附件关系持久化有合成测试。尚未完成：移动工作区内阅读面板及边界、附件重开 UI 和解绑真实宿主审计、双文同步独立滚动与拖动缩放验收；当前移动仍调用 workspace split，不可宣称满足原断言。下一步第一动作：在 studyWorkspace 内实现受工作区约束的第二阅读器，接通清理及同步控制，再补行为测试、完整 verify 与隔离宿主验收。A09 未完成，不得转正。

## A09 同屏双文纠正（2026-11-01）

用户指出第二文档应与主文档同屏；旧桌面 popout 不作为验收。实测旧入口仍打开独立窗口，已将工作区双文入口直接绑定当前工作区。完整 npm run verify 退出 0，Reader 210/210、Workspace 218/218；已构建并安装隔离库。重启后实测主 PDF 与第二 PDF 同一窗口并排，但阅读区较窄。拖动宽度、同步与独立滚动、移动窄屏、附件重开与解绑保护尚未完成真实宿主验收，A09 未关闭。下一步第一动作：检查并修正双文面板宽度调整及同步控制，再完成宿主验收。

## A09 分隔条续记（2026-11-01）

已加入双文宽度分隔条；完整 npm run verify 再次退出 0，Reader 210/210、Workspace 218/218，构建已安装隔离库。重启后同窗打开两份不同 PDF，AX 可见调整对照文档宽度分隔器和两份正文。尚未实测拖动效果、同步和独立滚动、窄屏、附件重开及解绑保护；A09 未完成。下一步第一动作：在当前隔离宿主拖动两文之间分隔器并记录前后宽度，再完成剩余宿主验收。

## A09 完成复核（2026-11-01）

用户明确要求桌面双文同一工作区并排，替代原卡 popout 断言。隔离 Obsidian 中两份不同 PDF 同窗显示，前台拖动分隔条 AX x 424→545 pt；附件绑定重启后入口保留，解绑后附件标签和脑图卡片仍可见。同步/独立滚动、关闭恢复主 Reader、解绑保留合成源文件/卡片/笔迹由真实组件合成测试覆盖；真实宿主未量测同步滚动比例和逐笔笔迹。380×700 移动视口仿真边界通过，不代表移动实机。完整 npm run verify 退出 0，Reader 210/210、Workspace 221/221；构建及隔离安装 SHA256 均为 072b18073d4ce21958701a6958ffa980b23236e9ccc545150bd94118853dbe01。A09 按用户修订断言完成，未正式部署。证据见 evidence/mn5-alignment-20261029/a09-execution-20261101/RESULT.md。下一张按用户已批准顺序为 A30-UI 视觉切片。

## A30-UI 视觉切片续记（2026-11-01）

已将顶部学习集／模板／文档／脑图信息组织为胶囊，标准场景底栏改为文字、分组及白色选中态；原有工具入口、ID 和动作保留。隔离 Obsidian 实测同一 P10-Independent-Review-20261025.pdf，摘录→手写→摘录切换有效；构建与安装哈希一致。完整 npm run verify 最终退出 0，Reader 210/210、Workspace 221/221。两次辅助摘录测试失败后恢复原顶栏高度，重跑通过；根因未证明。详见 evidence/mn5-alignment-20261029/a30-ui-20261101/RESULT.md。

A30-UI 尚未关闭：MN5 参考与宿主截图同文档但视口、学习集和双文状态不同；四张原图未全部定位。当前顶部信息是静态展示，参考具有下拉与单行布局。下一步第一动作：定位四张原图及拍摄条件，逐项核对顶部交互与布局，在不改工具 ID、动作或数据契约前提下完成差异并复验。

## A30-UI 四图复核与最终构建（2026-11-01）

用户提供的四张原图已定位，MS 图片为前一天截图。顶部胶囊已接入学习集、模板、文档、脑图、固定视图和搜索既有入口；隔离 Obsidian 实测模板菜单、文档选择器与脑图菜单，脑图菜单位置已修复。此前“信息静态展示”“原图未定位”记录已被本条修正。

同一 P10-Independent-Review PDF 下，摘录、手写、整理、回忆四场景依次切换，工具行及选中态随之变化。四场景截图及最终构建截图见 `evidence/mn5-alignment-20261029/a30-ui-20261101/RESULT.md`。参考和宿主的学习集、窗口、视口、对象和缩放并不完全一致，只能作结构对照。插件保留胶囊下方旧工具行，仍与 MN5 的单行顶部有可见差异；完整 A30 的三视口、窄窗及 ≤4 CSS px 未验收。

最后修改后完整 `npm run verify` 退出 0，Reader 210/210、Workspace 221/221；沙箱首次尝试因本地监听 EPERM 失败，获准后完整重跑通过。当前构建与隔离安装 SHA256 一致：main.js `507c3c9ee63fabd3b9788edba0a6b4a80c581acf61cedfe43c9ebf96fe762168`，styles.css `194ebf0aa09f1d4c251b96b54c141d506f75a5a0b3d122d9e121cc8b73cf068c`。未正式部署。A30-UI 切片已完成结构和场景切换工作；顶部单行差异与同条件精修留待完整 A30，不宣称完整 A30 通过。

## A30 顶部单行与三窗口进展（2026-11-01）

用户纠正当前继续 A30，不按旧的 A30-UI 后续顺序转 A05。场景界面顶部改为单行胶囊，原工具可从“工作区工具”展开，传统界面保留原布局；窄窗场景文字不再换行。未改业务动作或 Store 契约。

隔离 Obsidian 1.14.5 已安装并重载当前构建，在 P10-Independent-Review PDF 验证工具面板展开与收起；1512×859、1024×768、800×700 pt 窗口截图已保存，窗口恢复 1512×859。已有两条缺源提示选择“稍后处理”。Chromium 的 1512×949、1024×768、380×700 三宽度新检查通过，不等同实机或同态像素验收。完整 `npm run verify` 退出 0，Reader 210/210、Workspace 225/225；随后重新 build 使生成样式包含运行期间补充的不换行修正。构建与隔离安装 main.js `ed03b92d71f2f24d57c31dcd60e0ffa6abacdb0caa71c18ef98dd75cff30e0c4`、styles.css `09b546546c572e34e4ddd8dbd0622e1e35c130846fc807217802a374155c4e5a` 一致。详见 `evidence/mn5-alignment-20261029/a30-single-row-20261101/RESULT.md`。

A30 父卡仍未通过：MN5 同态三视口及 ≤4 CSS px 未测，全部工具逐项真实可达未验，OPPO 实机未验；本机 `adb` 缺失，手机连接状态未知。下一步第一动作：核对既有 MN5 三视口同态原图和锚点，进行桌面几何测量并修复实际差异；移动实机另需可用 Android 连接环境。不得将 Chromium 仿真写成 OPPO 通过。

A30 后续核对：现有 `step1-desktop/STEP1-CONTRACT.md` 明确记载同文档／同对象／同窗口／同缩放的 ≤4 CSS px 比较缺失；既有三视口结果属于旧版 Obsidian 宿主探测，不是 MN5 同态三视口基准。故当前无法据现有记录计算 A30 误差。MN5 操作锁默认仍归 Hermes；需其协调后提供对应参考，不能擅自操作。OPPO 链路方面，常见路径、PATH 和 REA 均未找到 adb，不能推断设备是否连接。下一步第一动作：取得 Hermes 的三视口同态基准与锚点，及可用的 OPPO 实机连接环境，再执行比较和实机验收；目前 A30 保持未完成。

## 2026-11-01 用户调整执行顺序

顶部／底部视觉修改与隔离 Obsidian 检查后，主线直接进入 A05；A30 父卡保持未关闭。正式 MN5 同态三视口锚点、≤4 CSS px 精修、窄窗及 OPPO 实机验收统一排至 A25 后；现在不派 Hermes 取证，不处理 OPPO／ADB。此前“下一步取得 Hermes 基准与 OPPO 环境”由本条替代，不更改原 A30 完成断言。

## A05 复制、编辑与 JSON 分享（2026-11-01）

完成模板复制、从学习集复制、编辑场景工具及颜色／菜单／摘录浮窗／手写笔盒、版本化 JSON 导入导出。个人模板在场景中应用配置，不覆盖全局偏好；内置模板先复制再编辑。模型检查覆盖新 ID、源模板不变、导出导入深度相等、无效版本与越界颜色拒绝且 revision／持久数据不变；Workspace 检查配置生效和 Store 重开。完整 `npm run verify` 退出 0，Reader 210/210、Workspace 226/226。最初 reader 回归因合成宿主缺新增 Store 接口失败，适配后完整通过。

隔离 Obsidian 已安装构建，复制并命名“A05 隔离验收模板”，保存重载后仍可见且能启用；结束时切回标准模板，保留隔离验收副本。宿主验证范围为名称、重开和启用，JSON 文件选择器及各具体配置未逐项实机操作。main.js 哈希 `74bdd076b7718b60bd424349387f800cfe7a343445383730556e35ebd4fb972c`、styles.css `e8db93aff6de9e805922de537d071b519e1d394e3fdaec88d017de4e1c962c0b` 与隔离安装一致；未正式部署。详见 `evidence/mn5-alignment-20261029/a05-execution-20261101/RESULT.md`。A05 完成；A30 父卡依用户决定待 A25 后继续。

## A10 用户暂停交接（2026-11-02）

用户为切换模型要求本轮暂停；A10 未完成，A11 尚未开始。开发目录有未完成改动，隔离 Obsidian 仍是上一张 A05 已验收构建，尚未安装 A10。不要把当前代码、局部测试或 A05 的完整回归当作 A10 验收。

已做：阅读器普通渲染取消自动扫描 OCR，加入“识别当前扫描页”显式入口及文档／revision／请求校验；区域摘录取消自动 OCR；配置启用时另提供显式“识别选区并高亮”；加入 Cmd/Ctrl+F；尝试实现学习集固定摘录落点、按选中节点之后插入，以及撤出脑图但保留源标注并提升子节点。相关实现仍需复核，包括 OCR 在切换文档后不可写缓存、落点顺序和节点身份。

测试现状：旧版扫描测试先红灯（打开扫描页触发 OCR），首次修复后的 Reader 211/211 通过；之后增加 OCR 成功和过期缓存断言及其他代码，该结果不覆盖最新改动。一次 Workspace 为 228/229，固定落点测试因 `mapCard(p)` 为 null 而失败（样本父节点默认折叠，需先展开或用可见节点）；在其后又改动落点实现，尚未重跑。一次 typecheck 报 destination 可能为 undefined，已调整条件但尚未重跑。最后运行的 Reader 211/211 使用启动时源码，并不覆盖随后全部变更。完整 `npm run verify` 尚未运行，A10 未构建安装／宿主验收。

下一步第一动作：先读取本条和 A10 原卡；确认最新源码类型检查，再修正固定落点测试的可见节点前置并重跑 Workspace/Reader。核对真实 MN5 冻结证据中的落点语义；补全扫描 OCR 显式入口、成功／失效缓存、普通区域零调用、撤出保留同一标注 ID 等行为测试。全部通过后执行完整 `npm run verify`，构建安装并在隔离 Obsidian 验收，完成 A10 才进入 A11。A30 的同态三视口及 OPPO 验收仍按用户决定排到 A25 后，本轮不取证。

## A10 宿主快捷键阻塞（2026-11-02）

A10 已完成按需 OCR、区域零自动 OCR、扫描页显式识别与过期回调隔离、固定落点、撤出节点保留标注等候选实现。完整 `npm run verify` 退出 0，Reader 211/211、Workspace 230/230、模型 26/26；日志已复制至 `evidence/mn5-alignment-20261029/a10-execution-20261102/`。构建安装隔离库并重载；main.js `8a3e9828d75a8a430e9e2a3a62ab2dd96d72d281c5d01a69f937df5c78e04b4d`、styles.css `df279adbea872f00bee26e028969dd9490f50f9cb386e8e497d9fd00e2607197` 与安装一致。实机已看到落点入口、未选择卡时禁止固定、显式 OCR 入口及搜索按钮。

A10 未完成：隔离 Obsidian 中 Cmd+F 两轮实现／安装复测均未观察到搜索框；直接搜索按钮可以打开。第二轮合成快捷键测试通过但真实宿主无效，不能写为通过。须查清 Obsidian 活动 leaf 与键盘事件实际焦点／命令路由；按项目止损约定暂停同一问题继续盲修。实机扫描页 OCR 结果、固定落点与撤出完整真实交互仍未完成；A11 尚未开始。下一步第一动作：在隔离宿主采集 Cmd+F 的实际焦点和 Obsidian 命令处理证据，定位快捷键冲突后再修复并重跑完整回归与宿主验收。A30 留待 A25 后。

## A10 快捷键修复与复核（2026-11-02）

定位 Cmd+F：工作区仅靠 DOM keydown 无法可靠覆盖 Obsidian 原生快捷键路由；使用 Obsidian 的视图 Scope 注册 Mod+F 后，隔离 Obsidian 实测按 Cmd+F 打开“搜索本文档”，先前两轮阻塞解除。隔离宿主选择现有合成卡后固定摘录落点，顶部显示所选卡，取消后恢复“目录 · 屏幕位置”；显式扫描识别入口可见。普通区域不预识别且不自动 OCR、主动 OCR 成功和跨文档失效、撤出保留原标注及子节点、落点顺序和重开，由 Reader／Workspace 合成测试验证；未在真实宿主执行扫描图 OCR 或实际撤出标注。完整 `npm run verify` 退出 0，Reader 211/211、Workspace 230/230、模型 26/26；日志在 `evidence/mn5-alignment-20261029/a10-execution-20261102/`。构建与隔离安装 main.js `0449aaff098f3ff6168bcfc47826b66050fdfd5b9087b4c8c585b82469b7f912`、styles.css `df279adbea872f00bee26e028969dd9490f50f9cb386e8e497d9fd00e2607197` 一致。

A10 已完成上述原二值断言与隔离宿主入口验证，实机扫描识别质量和撤出操作未额外宣称。下一张 A11，浓缩仍需 A24 接口，不能虚报该部分通过。

## A11 执行中（2026-11-02）

开始核对场景化卡片动作与块选择。现有实现仅允许单个文字块转为原生选区，多块和图片仍被禁止提交；原 A01 证据只证明块选择入口及“按块选出一段内容，再摘录、浓缩或折页”，尚未找到多块／图片提交的对象数量契约。A00 依赖审计明确 A11.2 浓缩依赖 A24，A11 父卡不能提前关闭。当前未改源码，正在核对现有菜单和动作、寻找可验证契约；不得把 disabled 占位或既有回归视作 A11 通过。

### A11 续作交接（2026-11-02）

补齐脑图选择工具栏“更多”中的连续摘录入口，复用既有 Reader 行为并限制当前 PDF 与卡片来源相同；新增合成检查验证同 PDF 可用及非 PDF 禁用，Workspace 231/231。完整 `npm run verify` 退出 0，Reader 211/211、Workspace 231/231、模型 26/26。已安装候选 main.js 至隔离库，构建与安装 SHA256 均为 `6da00edb2263ac7444cd7df2333d63464f33a740b87e3cc4d58351964ad9be0b`。已向隔离 Obsidian 发送 Cmd+R，但重载和新增菜单入口未得到确认，不能记作宿主验收。未操作 MN5。

A11 未完成：场景及卡型动作矩阵、唯一主菜单和无副作用审计、多块／图片提交及其对象数量、完整宿主验收尚未完成；浓缩依赖 A24。下一步第一动作：在隔离 Obsidian 确认插件重载，选择同 PDF 的卡片并检查工具栏“更多”中的连续摘录入口，再核对各卡型动作与现有契约；查明多块／图片的对象数量依据后实现和验证，不能猜测或以禁用占位通过。A11 父卡保持未关闭。

### A11 宿主复核续记（2026-11-02）

隔离 Obsidian 执行 Force Reload 后，打开现有 PDF 卡片自身的“卡片更多操作”，AX 可见“连续摘录”；此入口原本已存在，不能据此证明新增的选择工具栏入口已加载。尝试从该菜单切到选择工具栏“更多”时 Escape 清除了选择，随后的旧元素操作失败，未修改业务对象。下一步第一动作：重新选中同 PDF 卡片，从新鲜 AX 状态打开选择工具栏“更多”，确认其中的“连续摘录”，再继续卡型动作和多块契约核对。完整回归与安装哈希沿用上条；A11 保持未完成。

### A11 续记：宿主候选未确认（2026-11-02）

重新选择卡片并打开选择工具栏“更多”，可见“粘贴克隆”，但 AX 未见新增的“连续摘录”。所选卡片来源未确认，禁用菜单项是否被 AX 暴露也未确认；Force Reload 调用和快捷键均无可靠重载确认，不能据此认定代码失败或宿主验收通过。旧 `evidence/package10-20261028-handoff/DELIVERY-1.2.23.md` 同样明确多块、图片、浓缩、编辑动作待冻结；现有 MN5 材料未找到多块提交对象数量或各卡型完整动作契约。A11.2 另依赖 A24。候选构建完整回归 231/231 Workspace、211/211 Reader，但 A11.1 和父卡均未完成。下一步第一动作：确认隔离宿主实际重载并以确定同 PDF 来源的卡片复核入口；随后补齐多块／图片对象数量与卡型动作契约，再实现并验收。不得将旧入口或合成检查当作父卡通过。

### A11 菜单互斥候选与宿主检查（2026-11-02）

隔离 Obsidian 先完整退出并重启，选中当前 PDF 的卡片，在选择工具栏“更多”中看到可用的“连续摘录”，确认上一候选入口已加载；未执行摘录。新增卡片菜单互斥管理，切换场景或销毁脑图时关闭已跟踪菜单；合成检查验证菜单替换、切场景关闭及卡片／节点／标注无变化。完整 `npm run verify` 最终退出 0，Reader 211/211、Workspace 232/232、模型 26/26；首次回归因 study-ui 的 Obsidian Menu 测试替身缺少 onHide/hide 失败，补齐后完整重跑通过。新构建已安装隔离库并重启，构建与安装 main.js SHA256 均为 `30b9013df92d8ff6802489ffbfeb8843866d2d5b1ad68cbd77347f515790ea59`。宿主确认选择工具栏菜单可打开，但切场景关闭与对象审计未实测，不能扩写为完整宿主验收。

未完成：A11.1 的多块／图片提交及对象数量契约、各卡型动作矩阵和宿主审计；A11.2 的浓缩依赖 A24。历史证据明确完整动作待冻结，MN5 操作锁不在本席，不能猜测对象数量，也不能以现有禁用状态充当完成。下一步第一动作：在隔离宿主实测菜单切换／场景切换的关闭与对象不变；之后由持 MN5 锁的取证席补多块／图片及卡型契约，A24 完成后再接浓缩。A11 父卡未关闭。

### A11 场景切换宿主修复（2026-11-02）

隔离 Obsidian 实测原生卡片菜单打开后切换手写，手写已选但旧菜单仍在 AX，故此前合成菜单关闭检查不能代表宿主通过。将受管理卡片菜单切换为 Obsidian DOM 菜单并复用原关闭生命周期；补齐两个合成宿主的菜单接口。完整 `npm run verify` 退出 0，Reader 211/211、Workspace 232/232、模型 26/26。安装并重启隔离宿主后，打开卡片菜单（AX 可见菜单中的“连续摘录”），从手写切到摘录，菜单文字从 AX 消失、摘录工具出现；卡片、节点、边、SRS、docMeta、复习记录／日志／待处理／卡组、画布和文档 11 集合的磁盘哈希与本轮开始相同；此审计不覆盖标注侧车及学习集场景状态。构建和隔离安装 main.js SHA256 均为 `e7332562010e287b2fcae038d494ca533dd5897f87aff33d7d01be8728ddf2f7`。此为一次宿主切场景验证，不等于各菜单、各卡型全部通过。

A11 仍未完成：多块／图片提交数量与各卡型动作契约缺实机证据；浓缩依赖 A24。下一步第一动作：由 MN5 锁持有席基于隔离样本采集多块文字、图片、混合选择后的菜单、提交前后对象数及各卡型动作；收到证据后 Codex 实现、完整回归并做隔离宿主验收。未重验 A06/A22 的实机成果；本轮完整 verify 中既有套件正常运行。

### A11 Hermes 证据接收与相邻文字块候选（2026-11-02）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 `limit-candidates/step1-recovery/Hermes-deepseek-v4-1-flash-economy-261017-a11-selection-menus/`，60 项索引哈希全部一致。原始材料记录三张文本卡及一张区域卡的菜单，文本卡多一项“文本转标题”；单次矩形框选在大纲中 10→11 行。清理回执记录四张测试卡逐张删除，行数 11→10→9→8→7。源 PDF 未改变的回执依据为文件大小与 mtime，不扩大为哈希证明。现有证据中的跨行文字拖选与区域框选并非块选择模式下的多块／混合块提交，不能把单次区域 +1 外推为后者契约；浓缩未采。

实现候选：块选择中相邻文字候选可合成一个原生选区，操作前逐块验证范围、内容和文档目标；非相邻块、图片及混合选择仍受保护。Workspace 合成检查覆盖两块内容、选择不创建卡片／节点／标注、撤销及过期内容拒绝。完整 `npm run verify` 退出 0，Reader 211/211、Workspace 232/232、模型 26/26。安装并重启隔离 Obsidian，在 P10 PDF 的 Question 与 Answer 两个相邻文字候选上选择后，识别框退出且 AX 出现“选区操作／留白”；未对选区执行创建动作，也未从宿主直接读回选区文本。与前次审计基线相比 11 个业务集合磁盘哈希不变（不覆盖标注侧车）。构建及安装 main.js SHA256 均为 `de580fe1f45ec3f61d45f4b045ed8447809dd4973cc4c1dfd50218f531e47835`。

A11 父卡未完成：候选文本选区未证明与 MN5 块选择同态；图片／混合块提交、卡型菜单及其动作未接完，浓缩仍依赖 A24。下一步第一动作：据本证据完成文本／区域卡型菜单的实际动作并验收；块选择下图片／混合块及精确对象数量需对应实测或明确产品契约，A24 接口就绪后接入浓缩。不得以索引一致、单次区域 +1 或候选宿主入口关闭父卡。

### A11 卡片菜单共用动作续作（2026-11-02）

脑图卡片、选择工具栏和大纲的卡片菜单共用“编辑标题”“编辑卡片”“添加到复习”，分别接到现有标题字段、卡片详情和复习卡组接口；非单卡节点不提供这组动作。合成测试验证取消标题不写入、保存只改变目标卡、打开卡片详情、添加复习只影响目标卡。完整 `npm run verify` 退出 0，Reader 211/211、Workspace 233/233、模型 26/26。已安装并重启隔离 Obsidian，实测卡片菜单可打开标题编辑器并取消；标题保存及复习加入仅有合成验证。构建与安装 main.js SHA256 均为 `d96084af3d20315b571ec21ae88f7d7aa8a656eeee715319d5d01c71586df6cd`。

A11 未完成：卡型动作矩阵仍未完整接通和验收；图片／混合块选择与对象计数缺直接契约；浓缩依赖 A24。下一步第一动作：按 Hermes 的文本／区域卡菜单继续接入能复用现有实现的动作，验证文本特有的“文本转标题”语义后实现；然后完成完整回归与隔离宿主验收。不得将本批三项或菜单显示写作父卡通过。

### A11 移除脑图入口（2026-11-02）

共用卡片菜单新增“从脑图中移除”，调用现有撤出接口；合成检查覆盖目标节点移除、子节点提升、卡片和源标注保留。完整 `npm run verify` 退出 0，Reader 211/211、Workspace 233/233、模型 26/26。已安装并重启隔离 Obsidian，卡片菜单 AX 可见该入口，未在宿主执行移除；构建与安装 main.js SHA256 均为 `11a6821ffb25213d2febf369d0d2b8356c825a4debd6f4f5ae281cb27969ec0c`。A11 仍未完成；下一步继续完成其他卡片菜单动作、图片／混合块及 A24 浓缩，按原断言验收。

### A11 颜色与标签续作（2026-11-02）

脑图卡片、选择工具栏和大纲共用菜单新增颜色与标签动作，颜色使用当前场景配置，标签保存时去空与去重。合成测试验证只修改选中卡片；完整 `npm run verify` 退出 0，Reader 211/211、Workspace 233/233、模型 26/26。隔离 Obsidian 已安装并重启，实测颜色菜单可打开并显示当前 6 色，未在宿主保存颜色或标签。MN5 样本菜单有 16 个颜色项，本次复用当前配置并非 16 色验收。构建与隔离安装 main.js SHA256 均为 `484c016a974d0438e98d9dca3be88158a98a75728826269d12de3db791596a3b`。

A11 仍未完成：其他卡型菜单动作及 16 色差异、图片／混合块提交、浓缩与父卡完整宿主验收仍待完成。下一步第一动作：继续对照 Hermes 菜单接入现有卡片操作，并处理文本转标题、图片块选择及 A24 依赖；不能用本次颜色／标签入口或测试覆盖冒充整卡通过。

### A11 批注与标题转换候选（2026-11-02）

共用卡片菜单增加追加批注、文本转标题和朗读。追加批注保存时读取当前 back 并追加，避免覆盖期间新增内容；文本转标题提供可编辑预览、保留摘录正文，来源改变则拒绝提交；图片卡不显示该入口。此转换是插件候选行为：Hermes 证据确认文本卡有入口、区域卡无入口，未验证 MN5 执行后正文和原有标题如何变化，不能写成行为已对齐。朗读使用现有朗读会话并在脑图销毁时停止，尚未实测声音。Workspace 合成检查覆盖追加时的并发内容保留、目标卡隔离、文本转标题和过期拒绝及图片卡不显示；完整 `npm run verify` 退出 0，Reader 211/211、Workspace 233/233、模型 26/26。隔离 Obsidian 已安装重启，实测批注弹窗可打开并取消，文本转标题弹窗读回所选卡正文后取消；未在宿主提交数据。构建和隔离安装 main.js SHA256 均为 `57ff4550320ab49e212e36469544735b6f793eefcf23aec0abf07aa1ef378b71`。

A11 未完成：卡片复制克隆／引用／URL等动作、图片／混合块提交、16 色契约与 A24 浓缩等仍待处理。下一步第一动作：核对现有脑图剪贴板和卡片身份路由，接入复制动作并验证克隆与引用的身份及取消无副作用；随后继续其余动作，按原断言完整验收。

### A11 单卡复制续作（2026-11-02）

卡片菜单新增“复制卡片克隆／引用”，与脑图剪贴板共用状态；只复制选中卡片，不复制其子树。选择工具栏新增“粘贴卡片”，按复制时选定的克隆或引用方式粘贴；原有显式粘贴克隆／引用与剪切入口保留。合成验收验证复制时零新增对象、引用粘贴共享 card ID、克隆粘贴新建独立 card ID，且均不复制子节点。完整 `npm run verify` 退出 0，Reader 211/211、Workspace 234/234、模型 26/26；隔离 Obsidian 重启后实测可执行“复制卡片引用”，并显示“已复制卡片引用”及“粘贴卡片”入口；未在宿主实际粘贴或审计其对象数。构建和隔离安装 main.js SHA256 均为 `86c88d7b9f58dfd3178aea043938d109c6b2bc1736cce3ea921d5bb61ded8ee7`。

A11 仍未完成：卡片 URL 及其余菜单动作、图片／混合块、16 色和 A24 浓缩，以及完整宿主验收未关闭。下一步第一动作：检查 Obsidian 协议入口和卡片 ID 路由，建立可回到目标卡的 URL 再接复制；不得把菜单标签或单次合成测试当成 A11 父卡通过。

### A11 卡片链接续作（2026-11-02）

新增“复制卡片URL”和 `obsidian://margin-study-card` 协议，带资料库及卡片 ID，打开时校验资料库并读取当前卡片；错误资料库或已删除卡片不会打开。合成检查覆盖中文和特殊字符 URL 往返、正确／错误身份及打开不修改卡片节点。首次隔离宿主实测系统打开链接失败；临时诊断确认 Obsidian 路由后传给插件的字段只有 action、card，已加入独立 msvault 字段并移除诊断。最终完整 `npm run verify` 退出 0，Reader 211/211、Workspace 235/235、模型 26/26；隔离 Obsidian 安装重启后，菜单复制链接，再通过系统打开，AX 读回目标卡的“卡片正面或摘录”与原文一致，Escape 退出。初次检查只查隐藏的标题输入而漏查可见正文，后以实际卡片正面确认成功。构建和隔离安装 main.js SHA256 均为 `244123bce0d005319d65820fe77dd7e82264aefd86c2bb257124068e041f4f09`。

A11 仍未完成：部分卡片动作、16 色、图片／混合块和 A24 浓缩及完整宿主验收待处理。下一步第一动作：核对删除、遮挡、格式重置等现有动作的语义，接通有依据的卡片菜单项；保留多块混合对象数与浓缩的依赖边界。

### A11 删除与格式动作候选（2026-11-02）

共用卡片菜单接入删除、清除富文本格式、重置尺寸和字体比例。删除需确认；现阶段对合并卡禁用，确认后移除卡片及其脑图引用，提升子节点并保留源标注，作为一个撤销事务。清除格式仅解析既有支持的内联格式，先确认并校验内容未过期；尺寸重置当前实现只恢复卡片字体大小、保留字体家族，尚未证明 MN5 的尺寸语义一致。合成测试覆盖删除取消、源标注和子节点保留、一次撤销恢复，以及格式清理保留文字和锚点。完整 `npm run verify` 退出 0，Reader 211/211、Workspace 237/237、模型 26/26；隔离 Obsidian 已安装并重启，AX 可见格式清理入口及删除确认框，取消后未执行删除。构建与安装 main.js SHA256 均为 `27556cadece6163e9a574d6c739bedbe5c885b5b002192a5995cd793a8a9dc80`。

A11 未完成：图片／混合块提交与对象数量、各卡型完整动作和 A24 浓缩尚未完成。下一步第一动作：检查图片候选的有效性及提交接口，形成不损失来源的单图片候选路径；多图片／混合对象数量仍需直接证据。完成后做完整回归和隔离宿主验收。

### A11 单图片块候选（2026-11-02）

块选择中单个图片候选可调用既有区域摘录流程；提交前重新查找同一来源、读取图片，并检查文档、revision 和会话，失效或不可读取时不写入；多图片与图文混合仍禁用。合成测试在 `autoCardOnRegion=true`、`autoNodeOnCard=false` 的明确前置下验证新增 1 条区域标注、1 张卡、0 个节点，来源 imageIndex／src 和图片数据保留；重复点击旧按钮不重复写，移除原图后拒绝过期提交。第一次测试误将自动创建文档根节点算成 1 个节点，已明确关闭自动建节点后重跑通过。完整 `npm run verify` 退出 0，Reader 211/211、Workspace 238/238、模型 26/26。构建与隔离安装 main.js SHA256 均为 `6dce99ca425e29d42f89a705e9e86e01afd95423fc3eee85b278a86cf3beaa09`。隔离宿主重启后检查 P10 Rich HTML/PDF 的块选择均未发现图片候选，未执行图片块提交；现已切回 P10 Independent PDF。故此路径只有合成验证，不宣称宿主或 MN5 同态通过。

A11 仍未完成：需可识别图片的隔离宿主样本完成单图片验证；多图片／混合块对象数量、完整卡型菜单和 A24 浓缩仍未完成。下一步第一动作：准备隔离库中的可识别合成图片文档，从宿主实际选图并核对提交前后标注／卡片／节点，再处理多块契约和剩余菜单；不得拿区域框选 +1 冒充混合块契约。

### A11 单图片块宿主验证（2026-11-02）

只读解析既有隔离样本 P10-Rich-Tables-Charts PDF，图片位于第 5 页。隔离 Obsidian 跳到第 5 页后，块选择出现图片候选，选择并提交后提示“已添加区域摘录”；磁盘前后差为 1 条 page 5 region 标注、1 张锚定该标注的卡、1 个关联节点，标注含图片数据，原有标注逐项不变。重启隔离 Obsidian 后再次读取磁盘，三个身份及关联各存在一次；AX 可见卡片图片，但未单独定位新卡截图。测试样本保留在隔离库，未删除；源 PDF 本轮读到 SHA256 `9a70cb82b52c134a7d139ba9ed274eb664a81826919097723cc985b257cad498`，无提交前哈希，不作前后不变断言。原有完整 verify 和构建安装哈希见上一条。此验证只覆盖单图及当时配置，不扩展为图文混合或多图片。

A11 仍未完成：多图／混合块契约、卡型完整动作与 A24 浓缩仍未完成。下一步第一动作：核对现有块选择数据模型能否表达多个分离区域，处理图片／文字混合时防重复和对象数；并在原 A24 依赖与证据边界下继续推进，不将本次单图结果外推。

### A11 数据模型与依赖核对（2026-11-02）

当前块选择只接受连续文字候选或单张图片，混合及多图禁用；每条 Annotation 仅有一个 DOM range 和一份 image。卡片虽有 sources/images，但不足以确定多块提交的标注、卡片数量及来源绑定。Hermes 材料记录跨行文字拖选和单次区域框选，未覆盖块选择的多图／混合提交。PLAN 要求按契约规定数量验收；GOALS 明确 A24 接口未完成时浓缩保持未完成。本次未改代码、未操作 MN5。

A11 父卡未关闭：缺多图／混合块提交的对象数量与来源绑定契约、完整卡型动作验证及 A24 浓缩接口。下一步第一动作：取得持 MN5 操作锁席对多图／混合块提交前后对象数及来源关联的原始证据，按证据实现验收；A24 接口就绪后接入浓缩。单图片宿主重开结果见上一条，不外推。

### A11 块选择回执与续采授权（2026-11-02）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 a11-block-selection 包；23 项索引哈希核对一致。此前同会期 AX 证明块选择控件及帮助文字存在；本批 AX 截断、点击无状态变化，其他入口与图表文档均未打开。多图／混合提交及对象数量、来源绑定仍为 unknown；未新建卡或删除，现场恢复标准场景、无浮条菜单。snippet 日期与 RESULT 时间不一致，本登记采用 RESULT 的 2026-11-02。证据归原始取证及未采到结论，非验收通过。

放行 Hermes 在现有 MN5 锁下切换文档及 PDF 阅读／翻页阅读模式，指定 P10-Rich-Tables-Charts-20261026；可通过正常 UI 查找、打开，必要时用现有 P10 隔离样本中的其他含多图 PDF。不得预断块选择只在某模式可用；须以实际 UI 确认。以块选择真实动作采多图及图文混合前后数量和来源，记录测试对象并清理仅本批明确创建的对象；不得代以普通框选。入口仍不可达则停止并交证据，不无限盲试。A11 父卡及 A24 依赖保持未完成。

### A11 块选择实测与非 AI 续采（2026-11-02）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-BLOCK；更新后 55 项索引哈希一致。P10-Rich-Tables-Charts PDF 中进入真实块选择，横幅指示先点起始块再点结束块，计数 1→3；操作条和更多菜单以该包原始 AX 为准。该次选区未见摘录按钮，不能外推其他选区。多图与混合提交、来源绑定仍 unknown；大纲 7→7 仅证明该容器行数未增，不证明全部对象未变化。

单独记账：一次点击浓缩后显示“正在浓缩 · MN AI…”，约两秒内中止；是否实际联网、计费或产生后台记录未知，不能以中止断言未发请求。未完成块提交；恢复标准／主脑图、退出块选择、无浮层，按回执未创建测试对象。A11 父卡及 A24 依赖未关闭。

放行 Hermes 在现有 MN5 锁下对真实块选择使用“文本”和“折页”分别取证，并观察纯文本选区有无摘录入口；仅对 P10 隔离样本操作，记录各动作前后、来源与本批创建对象，完成后按身份清理本批对象。若动作出现 AI、联网或收费提示则中止并记录，不触发浓缩或 OCR；不把折页、文本结果直接等同摘录对象契约。若不能得到对应提交，保留 unknown，回传原始证据。下一步收到结果后按实际契约继续 A11 实现与验收。

### A11 活动文档阻塞与续采（2026-11-02）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-TEXTFOLD，69 项索引哈希一致。文本、折页未执行，纯文本摘录入口未验证，均为 unknown。本轮图表文档活动状态无法稳定恢复，点击未登记选块；此前窗口 1 活动时曾选中三块，此对照提示活动文档可能相关，尚不足证明其是唯一原因。大纲 7→7；回执称本轮无创建、无 AI/OCR，现场已退出块选择并恢复标准／主脑图。不能据此关闭 A11。

放行 Hermes 在原 MN5 锁下用窗口 1 的 P10 图表文档及适合的纯文本文档续采；允许通过正常 UI 切换传统界面并在结束后恢复原界面。先确认活动文档和块计数，再按上一条授权执行文本／折页及观察纯文本摘录；不调用 AI/OCR，不将其他动作冒充摘录。记录前后状态及本批对象，清理本批明确创建对象。若正常切换后仍无法形成选区，停止并保留 unknown；不得以该回执宣称 A11 完成。下一步收到材料后 Codex 对照真实契约推进实现和验收。

### A11 块选择槽位对照（2026-11-02）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-TEXTFOLD-v2；87 项索引哈希一致。图表文档已成功设为窗口 2 活动文档，真实块选择横幅出现，但若干点击未形成选区；此前窗口 1 下曾选中三块。两次状态存在槽位差异，尚不能排除布局、坐标或其他条件，固定槽位机制仅为候选。文本／折页未执行、纯文本摘录入口未验证，均为 unknown；本批未触发 AI/OCR，最终大纲行数未复核，不能证明全部对象未变化。现场退出块选择、标准场景，左窗格仍为图表文档而非基线 Independent，右窗格为 OCR 样本，恢复未完成。

授权 Hermes 按正常 UI 将图表文档放回窗口 1；可关闭并重开窗口 2，记录原有文档及窗格状态，结束尽力恢复基线，不宣称无法验证的恢复结果。优先利用此前窗口 1 成功的同一模式和页面形成真实块选区，再依前项授权采文本、折页与纯文本摘录入口；必要时允许切换 PDF 翻页／滚动模式，但是否为前置条件须实测，不能预断。不执行 AI 或 OCR，记录对象和来源并仅清理本批明确创建对象；如仍无法形成选区，停止并保留 unknown。A11 父卡未关闭，下一步接收证据后继续实现与验收。

### A11 纯文本块选择证据（2026-11-02）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-TEXTFOLD-v3，128 项索引哈希一致。一次纯文本块选择的操作条及更多菜单未出现摘录、折页、浓缩；另一次图表选区出现浓缩和折页，属各自状态下的观测，不能断言全部块型菜单。纯文本执行一次“文本”，同一大纲 7→9，新增文档名行与哈希行，逐行删除后 9→8→7；哈希行来源及两行各自对象类型、关联、增量原因未确证，不能将两行等同两张独立卡或固定为 +2 卡契约。折页未执行；本批未触发 AI/OCR。现场左图表右 Independent，未恢复基线左 Independent 右 OCR，详见原回执。

对照现有 baseController：逐块独立切换和“选择”转原生选区／单图直接提交，均与已见的起点→终点区间和按选区显示动作存在差异；不得把现有合成检查当 MN5 同态。多图／混合来源及对象数量、折页仍未知，A24 浓缩依赖未解，A11 父卡未关闭。本轮未改源码或运行验证。下一步第一动作：需要持锁席区分一次纯文本“文本”后新增两行的对象类型、父子及锚点关系，并采实际图像块折页；获得契约后按起终块交互修正和验收。不能把单次大纲行数推断成固定卡片数量。

### A11 区间选择候选（2026-11-02）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-TEXTFOLD-v4，182 项索引哈希一致。文本动作两次均见大纲 7→9，清理后 7；URL 形状不同不足以证明对象类型、父子、锚点或标注增量。图像选区执行折页后大纲 7→7、渲染变化，其语义与其他对象变化仍未知；不能以大纲行数认定零业务对象。前台与阅读模式相关现象属该批条件下观测，不外推为唯一机制。MN5 现场为单文档，原窗格未复原，OCR 附件出现原因未知，未删除。

块选择候选改为首尾点击包含中间块，新增 UI 行为断言先红（238/239），修改后 Workspace 239/239；完整 npm run verify 退出 0，Reader 211/211、Workspace 239/239、模型 26/26。main.js 构建及隔离安装 SHA256 均为 99ee3cab54a7632a413fc544f4218f881f5a42f9af0d34fd56ae90e4ca5b3cf8。隔离 Obsidian 已发送 Cmd+R，打开块选择仅看到当前 PDF 单张图片候选后退出；未验证三块区间，不能称宿主验收通过。未操作 MN5。

A11 未完成：区间宿主实测、块操作条与文本动作、图像／混合提交及来源数量、完整卡型菜单、A24 浓缩接口仍待验收。下一步第一动作：在隔离宿主打开可见至少三段文字候选的文档，首尾点击确认中间块与计数，再按现有直接证据实现块动作；对未知对象关系不猜测。

### A11 区间选择隔离宿主复测（2026-11-02）

首次在隔离 Obsidian HTML 样本首尾点击时，中间块仍为 false，确认先前 Cmd+R 未可靠加载新构建；完整退出并重启宿主后重测，同一连续序列的第 54、55、56 块分别为 R09、Gamma、29，点击第 54 和 56 块后，三者 AX 值均为 1；随后 Escape 退出块选择。本次确认三块选中状态，未单独读回计数条或审计磁盘对象。沿用上一条完整 verify 及安装哈希；未修改源码、未操作 MN5。

源码核对显示“选择”现仍转原生选区、单图直接区域提交，尚无 MN5 实测的按块类型操作条；文本动作的真实对象绑定和折页语义仍未知，A24 接口未就绪。A11 父卡保持未完成。下一步第一动作：依据实测菜单接入能确定语义的复制、颜色和朗读，保持无写入的选择过程；对文本提交的对象数量及折页不作无依据实现，并完成回归与宿主验证。

### A11 块文本复制候选（2026-11-02）

块工具栏增加纯文本区间复制，复制前检查范围仍连接、原文与来源仍匹配，失效时拒绝；目前只覆盖连续文字块，图文混合及图片复制未接。完整 npm run verify 退出 0（Reader 211/211、Workspace 239/239）；随后补充区间复制内容与源内容变化后拒绝复制的行为检查，Workspace 单独重跑 239/239。测试替换剪贴板实现，不构成真实系统剪贴板验收。构建安装隔离库并重启，SHA256 均为 0200a87e2319651bbc5d306478e5b6d9253608e9db785ecb3275a6ec41e7ab7b；宿主再次确认 13/14/15 三块首尾选择后均为选中，复制按钮与真实剪贴板未核验（AX 树截断），Escape 已退出。未操作 MN5。

A11 尚未完成：颜色、朗读、按块类型菜单、文本与多图／混合提交、完整卡型动作及 A24 浓缩仍需处理；源对象与折页未知保持原边界。下一步第一动作：使用更短的隔离文字样本实机点击复制并读回粘贴内容，之后接入并验证颜色与朗读，完成整卡回归和宿主验收；A24 接口及无法证实的对象关系不得虚报。

### A11 块复制宿主复测（2026-11-02）

隔离 Obsidian 打开第二份资料 HTML，选择第 1 至 3 块，三块 AX 值均为 1；点击“块选择：复制”，退出后在全文查找框粘贴，读回“细胞结构与功能细胞膜控制物质进出细胞。细胞核携带遗传信息。能量转换”，包含三个块且顺序正确。已清空并关闭搜索面板；剪贴板内容随复制改变，未审计业务对象。构建、自动检查及哈希沿用上一条。A11 父卡未完成；下一步第一动作是接通块选区颜色与朗读并验其动作，再处理其余菜单及原依赖。

### A11 块文本动作集中执行（2026-11-02）

本轮按用户要求集中实现与统一验证。纯文字块新增颜色、朗读、文本动作；范围提交前校验原块和来源，文本动作生成一条标注与来源关联的卡片并加入脑图，重复点击旧入口不重复提交，连续摘录进行时禁用该文本动作以避免混入已有卡片。此为插件候选契约，MN5 两条大纲行的对象类别与锚点仍不明，不宣称对象数量已与 MN5 完全一致。图片／混合块未接该动作。

完整 npm run verify 退出 0，Reader 211/211、Workspace 241/241、模型 26/26；新增行为检查覆盖颜色范围、文本来源关联和重复点击。构建与隔离安装 main.js SHA256 均为 9174423a642b5389070f45bb62ddc233e826cd70b5015855c19af7d998200583。隔离宿主打开纯文字块后确认颜色、朗读入口；朗读显示控制条，颜色动作生成一张同文档卡；最终构建执行一次文本动作，磁盘 cards 21→22、nodes 15→16，新卡带来源标注 ID 且恰有一个关联节点，脑图可见对应文本。颜色及文本测试对象留在隔离库；未单独枚举标注侧车或验证重开后来源跳转。未操作 MN5。

A11 父卡未完成：多图片／混合块提交对象数量和来源契约无直接证据，仍受保护；块操作条与各卡型菜单未完全达到原契约（包括折页与颜色差异）；A11 浓缩依赖 A24，当前 src/ai 无该接口。原计划禁止 disabled 占位通过，故不能按回归通过关闭父卡。下一步第一动作：在不改变原卡依赖的前提下取得混合提交契约并继续实现块操作，待 A24 接口就绪后接浓缩，再统一执行完整回归、隔离宿主及逐字段审计。

### A11 块菜单与折页续作（2026-11-02）

按屏幕位置排序块候选，增加清空重选、退出和更多菜单；块菜单与卡片菜单互斥。PDF 单图片块折页复用现有 PDF 折叠区域接口，纯文字块不展示该入口；此为基于既有折页能力和 MN5 可见渲染变化的候选，未宣称 MN5 内部语义一致。新增检查覆盖清空撤销、菜单互斥、一次折页及无新增卡片／节点／标注。完整 npm run verify 退出 0，Reader 211/211、Workspace 243/243、模型 26/26。

隔离宿主首次复核发现更多菜单被横向展开且文字块显示折页：原因是直接改生成文件 styles.css 被构建覆盖。已改样式源 styles-reader.css 并补隐藏状态检查；再次完整 verify 退出 0，安装并重启后纯文字块更多菜单仅显示颜色 3/4、朗读、文本、清空重选，卡片菜单与块菜单双向替换；图表 PDF 图片块实机出现折页入口，点击后出现“展开折叠区域”，点击展开后该入口消失。未审计此次折页前后全部业务集合；现有测试证明合成 PDF 未新增卡、节点、标注，实机不外推该计数。main.js SHA256 fd638224c04b11d77728c304a2aca912d27c140665d33aba304901f88349fc1c，styles.css SHA256 3c6984e15ea36a0ad2a7c74d890a97ad9236303c430b66a5827389083f3ecf75，构建与隔离安装一致。MN5 未操作。

A11 未完成：MN5 多图片／图文混合提交的对象数量与来源关系未知，未实现；各卡型菜单仍缺已观测的摘录遮挡及 16 色等动作或完整语义，现有候选菜单不能算契约完全一致；浓缩依赖 A24 尚未实现。下一步第一动作：核实现有回忆遮挡的数据语义是否能正确复用到卡片“摘录遮挡”，以及 16 色是否有可用证据；补齐可确认部分后再集中回归与宿主审计。A24 与未知混合提交不得以占位或猜测关闭。

### A11 卡片遮挡候选（2026-11-02）

卡片菜单接入“摘录遮挡”，复用现有节点遮挡标记；作用于当前脑图引用，可再次切换或通过库撤销恢复。现有实现会遮挡整卡显示并供阅读器“仅标记遮挡”使用，MN5 此菜单的执行语义未直接采到，因此仅记插件候选，不宣称完全一致。合成检查覆盖只改变目标引用及撤销；首次完整 verify 因 study-ui 的 Menu 测试替身缺少 setChecked 失败，补足替身后完整重跑退出 0：Reader 211/211、Workspace 244/244、模型 26/26。隔离 Obsidian 用上批生成的测试卡实测菜单入口，执行后显示“揭晓整卡内容”，再执行一次恢复原卡文字；未审计所有业务字段。

构建与隔离安装 main.js SHA256 01fd9db3df84b8ba54fe13eeb4651d3ca067033349b9865ffad75b0d6ad5a327；styles.css SHA256 3c6984e15ea36a0ad2a7c74d890a97ad9236303c430b66a5827389083f3ecf75，双方一致。上一批 PDF 图片块折页后展开，隔离库当前 cards 22、nodes 16，目标文档 pdfRegionFolds 为空；无可比的标注侧车前后基线。MN5 未操作。

16 色：现有卡片菜单使用场景设置的颜色（当前 6 项）；MN5 菜单 AX 仅给 16 个序号，现有截图中的 16 色属于摘录笔设置，未证明与卡片菜单颜色映射相同，不能把它冒充卡片色值。A11 父卡仍未完成：16 色卡片菜单与遮挡语义、图文／多图提交对象与来源契约、A24 浓缩接口及最终逐字段宿主审计未闭合。下一步第一动作：在原计划范围内取得或裁定这些缺失契约；A24 接口按原依赖就绪后接入，再运行完整 verify 并完成隔离宿主验收。

### A24 浓缩接口提前执行（用户授权）

用户授权只提前 A24 的三档浓缩、缓存、取消／失败状态和防重复请求，以接通 A11；A23 不提前，A25／A30 顺序不变。A24 父卡必须满足原全部断言后才能关闭；A11 的多图／混合来源关系和 16 色仍独立未决。当前正在实现，未标通过、未调用真实 AI；下一步继续合成服务验证与 A11 宿主接入。

### A24 浓缩及 A11 接入验证（2026-11-02）

完成一句话／要点／脉络三档，使用现有自定义 AI Normal 通道；缓存键覆盖材料（文字及图片）、档位、语言、服务地址、模型及配置修订。相同请求合并进行中的任务，全部调用方取消时中止，失败和取消不缓存或自动重试；显示样式只变更呈现。缓存仅驻留当前插件会话内，重启后清空；不声称 MN5 缓存实现相同。服务面板显示实际地址主机、模型和绑定状态，错误采用现有脱敏提示。单图片块提供浓缩入口，文字块依本批 MN5 菜单不显示；多图／混合块仍未接通。未连接或调用真实 AI。

完整 npm run verify 退出 0：Reader 211/211、Workspace 248/248、模型 26/26，ai-condense 7/7；本地合成 SSE 真传输验证同档一次、新档仅新增一次、无工具调用，界面合成验证样式切换不请求、缓存命中、取消、失败和单图片输入。隔离 Obsidian 图片块实测可打开浓缩，三档可见；最终构建确认“自定义服务 · 未配置模型 · 未绑定”，点击生成显示“请先在 AI 设置中测试并绑定自定义服务”，未触发真实请求；文字块菜单不显示浓缩／折页。服务是自定义 API，不自动使用 Claudian，界面明确显示；实际收费服务输出质量和跨重启缓存未验证。完整日志在 evidence/mn5-alignment-20261029/a24-a11-condense-20261102/verify/。

构建与隔离安装 main.js SHA256 23e17a585964c0d8c287c9f7a140ab9e9b547db279e7d19762bb4b6b6e75e0d2，styles.css SHA256 3c6984e15ea36a0ad2a7c74d890a97ad9236303c430b66a5827389083f3ecf75，双方一致。A24 原四项二值断言按合成服务和界面检查通过，原生宿主仅验入口及未绑定状态；A24 标记实现及自动断言完成，父卡是否关闭须再审全部原验收依据，不能把未做的真实模型质量验成通过。A11 浓缩子项在单图范围接通，父卡仍因多图片／图文混合对象契约、16 色映射与逐字段验收未完成。下一步第一动作：复核 A24 原验收依据与实现差异，并继续 A11 未依赖外部取证的宿主审计；不动 A23、A25、A30。

### A24 本地传输补验与父卡复核（2026-11-02）

新增真实本地 Node HTTP/SSE 传输的图片路径验证：单张合成图片只发送一次、不传工具、不包含其他库内容。单独运行因沙箱拒绝绑定 localhost，改用已授权完整 npm run verify 成功退出 0；Reader 211/211、Workspace 248/248、浓缩单元 7/7，所有套件通过，日志更新至 a24-a11-condense-20261102/verify。该次只新增测试，构建与安装哈希沿用上一条。

PLAN 的 A24 四项计数断言均有合成服务证据，真实隔离宿主仅验证图片入口、三档和未绑定提示；MN5 原设置及三档结果截图尚未取得，当前实现仅自定义 API、会话内缓存。为避免将合成或未绑定状态冒充三档实机结果，A24 父卡暂不关闭；A11 浓缩单图接入已验证到相同边界，混合块及 16 色仍不通过。下一步第一动作：继续 A11 中不依赖 MN5 未知契约的菜单与逐字段审计；取得 MN5 既有浓缩设置及三档结果后再按原依据复核 A24，不触发收费重生成。

### Hermes 只读续采 v5（2026-11-02）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-READONLY-v5；223 项索引哈希核对一致。块选区未形成，浓缩设置、三档分别结果、16 色色值和多图／混合提交继续 unknown。此前原始 AX 有“一句话／要点清单／详述”三个标签及一条既有结果，只能证明该面板当时存在一条结果，不能冒充三档结果；文字标签与插件“要点／脉络”仍为实现差异。16 个颜色序号有 AX 证据，色值与序号对应未证。大纲仍 7 行只证该视图行数，回执称零 AI/OCR、无新对象；附件及窗格偏差沿用前次登记。MN5 锁仍由 Hermes 持有。

两轮继续采集均未形成所需块选区，停止重复盲试。A11／A24 父卡保持未关闭；不将证据包完整性当成果通过。下一步第一动作：待出现可观察块选区的新条件或新的菜单覆盖层采集手段，再由锁持有席按同一文档、页码、模式记录原始证据；Codex 继续复核已实现功能及自动／宿主审计，不更改 A23、A25、A30 顺序。

### A11 阅读器菜单互斥（2026-11-02）

补齐阅读器标注／文本菜单与卡片菜单之间的双向互斥，并在销毁菜单时移除监听。合成检查验证两方向替换、关闭及卡片／节点／标注不变；完整 npm run verify 退出 0，Reader 211/211、Workspace 249/249、浓缩 7/7。隔离 Obsidian 重启后，用第 5 页既有区域标注打开标注菜单，再打开测试卡菜单，标注菜单消失；再次打开标注菜单，卡片菜单消失；未执行菜单业务动作，本次未进行磁盘逐字段审计。构建及隔离 main.js SHA256 均为 2dcd9a812fb60eff9fa6bebaf031e1dd5d3823325a9c3c20c6049d07e2d5fa70，styles.css 均为 3c6984e15ea36a0ad2a7c74d890a97ad9236303c430b66a5827389083f3ecf75。日志在 a24-a11-condense-20261102/verify。

A11 仍未关闭：多图／混合提交契约、16 色映射、各卡型完整动作及逐字段宿主审计未完成；A24 原四项自动断言通过但 MN5 三档已有结果和原设置证据仍缺。下一步第一动作：继续核对已存在卡片菜单动作和颜色实现，完成可独立执行的审计；等待新的可观察条件取证，不重复盲试或把 unknown 写成通过。

### A11 菜单源码复核及停点（2026-11-02）

复核现有源码：卡片通用菜单已有复制、编辑标题与卡片、颜色、追加批注、文本转标题、连续摘录及摘录遮挡入口；合并和链接在脑图多选工具栏，标题链接在阅读器场景工具及卡片详情。颜色仍使用当前场景颜色列表，不能冒充 MN5 的 16 色序号及色值映射；摘录遮挡仍为候选语义。Workspace 合成检查覆盖卡片／块／阅读器菜单互斥及部分对象不变，不等于隔离宿主全部卡型逐字段审计。本次仅复核源码，未修改代码、运行新的验证或操作 MN5。

A11 未达到原完成定义：多图及图文混合提交的对象数量与来源契约未知，16 色对应色值未知，各卡型完整菜单契约及宿主逐字段审计未闭合。A24 提前部分和单图浓缩不能替代这些断言。Hermes 多轮未能稳定形成所需块选区，重复同路径缺乏新条件，按硬阻塞停下，不将 unknown 转为通过。下一步第一动作：取得可稳定形成对应块选区的新条件及能记录系统菜单色片的采集通道，由 Hermes 持 MN5 锁补多图／混合提交与 16 色原始证据；Codex 再按契约实现并执行完整 verify、隔离宿主逐字段审计及父卡复核。A23、A25、A30 顺序不变。

### A11 Hermes V6 证据登记（2026-11-02）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-V6，247 项索引逐项 SHA256 核对一致。多图／图文混合块未形成选区，提交与对象数量、来源关系仍为 unknown；回执称未提交、无新增对象，大纲为 7 行。多组页面、窗格、点位及前台条件下未成功，说明已有复现条件不足以稳定形成选区；尚不足以排除缩放、页面布局、事件投递及应用内部状态，也不能把原因确定为应用缺陷。

颜色 1–16 的 AX 序号有证，菜单覆盖层未获得可归属色片的图像，色值仍 unknown。AX 中存在不证明真实菜单已经绘制；全屏帧差过大也不证明无法经其他通道捕获。回执称本批零 AI/OCR；现场为标准、左图表右 Independent，块选择已退出且无浮条，仍与左 Independent／右 OCR 的原基线不同。MN5 锁沿用 Hermes，未操作 MN5。

A11 保持未完成，不重复扫描点位。下一步由持锁席先确认新采集通道：可尝试使用系统 Swift/CoreGraphics 枚举可见窗口及 layer、记录屏幕坐标和截图，与真实菜单打开状态同帧对应；仅捕获能证明归属的色片，不安装依赖亦不猜色值。块选择先取得失败与成功状态的可比较参数或实际新复现条件，再作有界验证；无新条件则继续记 unknown。取得契约后 Codex 接续实现、完整回归和隔离宿主逐字段验收。

### A11 Hermes V7 与颜色采集放行（2026-11-02）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-V7，264 项索引逐项 SHA256 核对一致。ScreenCaptureKit 枚举菜单层，前台区域截图取得菜单像素；本批子菜单截图及采样未见色片，#3478F6 为悬停高亮，不能作为色值。16 项色值仍为 unknown；不能仅凭采样点断言所有可能状态均无色片。块选择成功／失败的已记录条件相近，成功态页码未记录，缩放、偏移和事件投递等仍未排除，不能断定原因必在应用内部。回执称未触发 AI/OCR、无新增对象；现场左图表右 Independent，未恢复原基线。MN5 操作锁仍归 Hermes。

为闭合 A11 颜色映射，放行 Hermes 在既有 P10 隔离样本内使用明确身份的专用临时测试卡，逐项应用颜色 1–16 并记录每项实际卡片渲染和可观察颜色值；先记录初始状态，逐项确认动作、身份与结果，不用悬停或选中高亮作色值。测试后按明确身份删除仅本批创建的测试卡，并核对前后大纲及可观察状态；如无法创建、辨识颜色、可靠还原或出现意外关联，停止并保留 unknown，不操作其他对象。记录有无颜色随场景或授权变化，不外推未测试状态。无需新增 AI/OCR。块选择继续暂停重复点位，直到有新的可检验条件。A11 保持未关闭，取得结果后 Codex 接续实现和完整验收。

### MN5 操作授权调整（2026-11-02）

用户明确说明 MN5 内没有其个人资料，授权执行席为项目取证自由使用 MN5，无需逐项申请创建、修改、删除测试对象或调整场景、窗格和应用状态。上一条仅限专用卡、仅删除本批对象及必须恢复现场的限制撤销；执行席自行选择高效的实验路径并记录足以支持结论的原始证据、重要操作和实际状态。涉及收费或联网 AI 的既有边界不因本条对 MN5 数据操作的授权自动解除。MN5 唯一操作锁仍归 Hermes，转交或并行操作须先协调。未知项仍须如实登记，不能将候选当验收通过；A11 完成定义不变。

### A11 十六色实测与实现（2026-11-02）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-V9，303 项索引逐项 SHA256 一致。两张卡逐项测量大纲色条，色值存在细小渲染差异；采用卡 A 的 16 项中位色作为插件候选值，口径为屏幕渲染样本而非 MN5 内部颜色常量。Question 复原至颜色 1；P10 Independent 样本原色未知，现为颜色 16，未复原。回执称本批未创建对象、未调用 AI/OCR，混合块仍未形成选区、对象关系 unknown。

卡片颜色菜单改为 16 项样本色，取代场景颜色列表；其他摘录笔颜色设置不变。Workspace 行为检查先红（249/250，缺少 16 色），修改后完整 npm run verify 退出 0，Reader 211/211、Workspace 250/250、浓缩 7/7。main.js 已安装隔离库，构建和安装 SHA256 均为 30c4a7a62899023745d849cb98cca5aa93f80a2bc28048d1edf0b79f1d484246。隔离宿主已发送重载，但菜单点击因 AX 快照过期被拒，尚未验证实际宿主菜单或颜色写入；不能据此认定该子项宿主验收通过。

A11 未完成：混合／多图提交契约仍未知，各卡型完整菜单及逐字段宿主审计未完成。下一步第一动作：刷新隔离 Obsidian AX 快照并在同一会话点击卡片颜色菜单，核验 16 项与选择后实际卡片颜色；随后处理剩余可独立验证项。Hermes 继续持 MN5 锁，混合块需新的可复现条件，不重复盲点。

### A11 颜色隔离宿主复核（2026-11-02）

发现 Cmd+R 后宿主仍显示旧六色，完整退出重启 Obsidian 后加载已安装构建；两处原文档恢复选择均选择稍后处理，未改变缺源登记。隔离样本“细胞结构与功能”打开卡片颜色菜单，AX 读到 1–16 及对应样本色，选择 16 后隔离库 data.json 该卡 color 为 #C3A0E0；本次未审计其他字段或逐项测试 16 色写入。此样本颜色已改变。完整回归和构建哈希沿用上一条。A11 父卡仍未关闭，多图／混合提交契约与各卡型逐字段验收未完成；下一步在现有证据允许范围内继续宿主菜单与对象审计，同时等待 Hermes 对混合块提出新的可复现条件。

### A11 Hermes V10 阻塞复核（2026-11-02）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-V10，316 项索引逐项 SHA256 一致。正常退出重开应用、换 PDF、不同窗格、前台、悬停及不同工具态均未形成块选区；双击因工具 schema 拒绝并未执行。坐标对照只表明额外缩放的那个点未触发已知按钮，不能单凭它排除所有坐标或事件投递问题。未提交，回执称大纲 7 行、未新建对象、未触发 AI/OCR；MN5 仍为左图表／右 Independent。多图及图文混合的对象数量、类型和来源继续 unknown。

只读检索现有 CC REA 报告未找到可直接使用的块检测就绪或 PDF 缩放观测点；先前 Frida 注入因硬化运行时失败，不能声称现有运行时探针可用。A11 原断言不得用现有部分证据替代，父卡保持未关闭。下一步交 CC（Claude Code × 实际模型须回报）做只读静态 REA：定位块选择起止点击、块检测就绪条件、坐标变换与缩放读取的候选符号及可复核地址，判断是否存在无需注入即可观察的公开 UI 或日志路径；不修改签名、不绕过硬化、不操作 MN5（操作锁仍归 Hermes）。找到可执行新机制后再协调 Hermes 取证；若无则如实交不可答，不再盲点。

### A11 静态 REA 回传与续采（2026-11-02）

接收 Claude Code × qoder-cn/dfmodel[1m] 的 A11-BLOCK-SELECTION-STATIC，反编译文件 SHA256 复核为 77009492465c658b21807349d091001bb8a633a9db71139c705f949c6fe0b210；53 地址 0 不符为执行席报告，本席未独立重跑地址校验。反编译显示 anchor/end 与扩展 end 的静态路径；异步检测、就绪时序和引导功能的具体效果仍为候选，资源含检测进度及无块提示不等于当前状态必然可见。此前 Hermes 已在真实成功态观察“已选 1 块→已选 3 块”，无需重复证明计数存在。图片及混合提交、跨页计数与对象关系仍 unknown；三个检查过的函数未见数量门控，不等于整个动作链无上限。

核对插件当前实现：连续纯文本区间已支持多块，并非只能选择一个文字块；单图片入口确实限制为一个，混合／多图片动作尚未接。现有点击在形成区间后第三次重置起点，与静态报告的持续移动 end 不同，作为后续待验证差异；不得仅凭静态材料推断提交对象数。MN5 操作锁仍归 Hermes，用户已授权正常测试写入。下一步请 Hermes 基于检测 HUD、未识别提示、应用内引导及摘录辅助耦合做有界新机制实验，优先恢复可选块状态并采多图／混合提交的对象和来源；端侧识别是否触发此前 AI 禁令尚无明确豁免，不主动启动可能触发 AI 的识别或浓缩，若无法区分则记录状态并停止。A11 父卡未关闭。

### A11 Hermes V11 与授权口径更正（2026-11-03）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-V11，334 项索引逐项 SHA256 一致。所测失败状态下 12 次 AX 与一次截图 OCR 未见检测进度或无块提示；仅证明本次条件下未观察到，不能判定任何状态的 HUD 或数量永不进入 AX。引导的所测 10 步未见块选择入口；摘录全部块未出现，摘录辅助耦合未能动态验证。文本摘录创建一张卡，回执称按身份删除，大纲 8→7；多图／混合提交和第三次点击动态行为仍 unknown。不能从界面未显示推断检测必然未执行或未产出。

更正上一条对端侧识别的限制：用户既有边界是禁止收费／联网 AI，不是禁止 MN5 本机端侧块识别；为取得块选择结果，允许持锁席使用应用正常的本地块检测，不需逐次申请。浓缩、OCR 或其他操作如会触发收费／联网 AI，继续遵守原边界，是否联网未知时不得断言零联网。既有 MN5 自由操作及测试写入授权继续有效。

A11 父卡仍未关闭。下一步请 CC 基于已有静态资产继续追踪 generateBlocks 的调用入口、输入与就绪条件、超时和 HUD 实际显示分支，交可复核地址与不需注入的新实验；Hermes 持锁以该机制选择合适样本与本地检测条件验证，已有点位不再盲扫。若仍无可执行新机制，记录硬阻塞，不能以静态材料推断多图提交对象契约。

### A11 块检测执行单接收（2026-11-03）

接收 Claude Code × qoder-cn/dfmodel[1m] 的 a11/A11-NEXT-STEP-HANDOFF.md，作为静态分析派生的实验方案；本席已读取执行单，未独立核验其反编译判据及索引。MN5 锁仍归 Hermes，由其按 E1–E6 尝试记录同状态截图、AX、时间和实际前置条件；未能确认页面识别历史或 HUD 未出现时据实记 unknown，不将未观察到的现象当作超时或就绪通过。E4 需存在可点块，无法满足时不得编造。执行单完成只代表该批观察交付，不关闭 A11 父卡；用户此前对 MN5 的一般操作授权不因本单只读范围而撤销。本地块检测可用，收费／联网 AI 沿用既有边界。若有新的可复现选区，再由 Hermes 依据既有授权补多图／混合提交与来源证据。

### A11 Hermes E1–E7 回执（2026-11-03）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 a11/exec-20261103/RESULT.md，85 项索引逐项 SHA256 核对一致。E1–E4 的 HUD 出现、AX 暴露及超时仍 unknown；E5 为所测页面无 HUD 的有限观察，E6 翻页后记录到已选 2 块，但未证翻页或等待是充分条件。E7 执行一次“文本”后大纲 7→9，两个新增行公开 URL 不同，逐项删除后 9→7；菜单中同时出现折页和文本不单独证明两块分别为图片及文字，行标题与所属脑图亦不足以证明对象具体类型、父子关系或 PDF 页码／区域锚点。混合类型、来源细节及多图提交仍需直接证据，不能将两行直接推广成固定两对象契约。六次点击计数未变化不证明点击成功命中，也不能推断第三次点击行为。回执称未调用浓缩或 OCR；是否发生网络请求未独立审计。

下一步 Hermes 持锁利用本批可形成选区的路径，先逐块记录可见文字与图片、起止及页码，再提交并打开两条新增行读回内容、来源与锚点；另采至少两张图片区间。记录同一大纲前后及每项完整身份，未取得的类型或关系标 unknown。用户已授权 MN5 测试写入；收费／联网 AI 仍依原边界。A11 父卡保持未关闭，收到可核对契约后 Codex 继续实现、完整回归和隔离宿主验收。

### A11 单块提交与坐标排查（2026-11-03）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-BLOCK-RANGE，136 项索引逐项 SHA256 一致。AX 切换场景成功，坐标点击正文得到已选 1 块；遗留页码模态和空白页也曾干扰。本批是有效新路径，但两种坐标点均未成功点击同一已知按钮，尚不足单独证明换算比例或所有旧失败的根因；点击坐标须按具体工具文档和当前截图实测校准。

该次单块执行“文本”后大纲 7→9，新增 PDF 名行及哈希标题行，各取得公开 note URL，清理后 9→7。编辑器分别显示一个 PDF 名字段和无文本域；文档节点、区域／图像卡及页码／坐标来源关系仍是候选，不能仅凭字段或标题断定。哈希标题变化需核对是否同一对象，已采公开 URL 供交叉确认。第二次点击计数不变不足证明该页只有一个块或点击命中。多块、至少两张图片以及混合区间提交仍 unknown；A11 未关闭。

下一步 Hermes 持锁按当前截图像素通道先用可见已知控件校准坐标和窗口／模态状态，选择包含多块、多图的合适 PDF，记录页号与每块可见内容、计数变化，再提交并读回对象内容和来源锚点；不得把失败点击当成不存在。必要时可依既有授权新建测试样本。Codex 待证据到达后完成实现、完整回归和隔离宿主验收。

### A11 点击通道与样本（2026-11-03）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-CALIB-SAMPLE，141 项索引逐项 SHA256 核对一致。六种坐标尝试无可见状态变化，AX 点击成功；这证明本次尝试未使目标动作生效，尚不足区分坐标、事件投递与应用状态。无 AXSheet/AXDialog 也不能排除全部遮挡。新样本 PDF 已交付，导入未成功；多块与混合提交仍 unknown。此前截图点击成功的机制及比例仍未确定。

只读核对本机 cua-driver click 的当前说明：窗口坐标为新鲜 get_window_state 截图内的局部像素；可指定 capture_id、debug_image_out 和 delivery_mode，先后台、再前台，每次回读；也支持桌面截图坐标和 zoom/from_zoom。下一步 Hermes 持锁在同一 session 使用新截图及 capture_id，对已知可见按钮作有限校准，记录交叉线、工具返回、前后状态，必要时对比前台模式或桌面目标；若通道确实失败按工具故障分流，不因单次无变化重置权限或盲点。导入可经正常 UI、系统打开方式或其他已有授权渠道；成功形成选区后继续多块及混合提交取证。A11 未关闭。

### A11 通道恢复与三块提交（2026-11-03）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-CHANNEL-FIX，172 项索引逐项 SHA256 一致。回执记录 cua-driver 曾停止、MN5 重启时出现闪退恢复提示，执行席重新启动守护进程并强制结束旧 MN5 进程后重开；工具与应用当时分别对失败的具体贡献不能逐次追溯。交叉线校准及恢复后成功选块否定先前“已证全部失败源于坐标换算”的说法。用户自由操作授权覆盖现场操作，闪退原因及旧进程内未保存状态影响未知。

新样本经系统打开导入，选区计数 1→3，执行“文本”后大纲 7→9，再按公开 URL 身份删除回 7；菜单及可见选区提供文字至图片方向的候选证据，但尚未独立证明每个被选块的类型、图片是否包含在生成内容、两行对象类型与精确 PDF 锚点。字段、标题及脑图归属不能单独证明这些关系。纯文字多块复测未成功，两图提交未知；此前色值与自动回归继续沿用各自边界，A11 未关闭。

下一步 Hermes 持锁先保持驱动与 MN5 响应，使用样本分开采纯文字多块、跨图文及两图区间；每次记录可见选中内容、页码及选前／选后计数，提交后读回对象内容和来源锚点。对不可读的图片内容或未暴露的关系保留 unknown，不重复追逐哈希标题；有结果后 Codex 依据已证范围完成实现、完整回归及隔离宿主验收。

### A11 三类区间回执（2026-11-03）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-THREE-RANGES，191 项索引逐项 SHA256 一致。一次选区计数 1→6，执行文本后大纲 7→9、按公开 URL 逐行删除回 7；选区两端为文字，不足以证明区间内部无图片，故记为六块区间提交，纯文字性质待核。此前 1→3 的文字至图片方向区间为候选混合证据，选中块的具体类型与生成卡内容仍未直接读回。两图区间未形成；页码、生成卡正文、精确源锚点及两行对象类型仍 unknown，不能将两行归纳为普遍固定对象数。A11 父卡未关闭。

下一步 Hermes 持锁使用更易区分的样本：纯文字页放至少三段，另一页同屏放两张明显不同的图片及可辨文字；记录 PDF 页号与两端及中间可见内容，再分别提交纯文字、图文、两图区间，读回内容及来源；确实无法读回则保留 unknown。用户已授权新建和导入样本及测试写入。取得结果后 Codex 依据原完成断言继续实现和完整验收。

### A11 两页样本回执（2026-11-03）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-TWO-PAGE，212 项索引逐项 SHA256 一致。纯文字样本页 1/2 选区计数 1→4，文本操作后大纲 7→9，再删除回 7；一行公开 ID 已取，另一行 ID 未取，无法确认其对象类型、内容及来源锚点。支持该次纯文字多块操作出现两条大纲行，不能外推通用对象数量。页码可通过转到指定页码面板在该批状态读回。

第 2 页图文和两图区间点击未登记，检测是否就绪、是否存在块以及事件是否命中仍 unknown，不将其断言为检测未产出。下一步 Hermes 持锁在第 2 页观察 20–40 秒后进行一次有界复测，同时记录截图、前台、坐标及选择计数；若仍失败，保持 unknown，不以等待时间推断原因。若形成选区，采图文与两图提交及内容、来源。A11 父卡未关闭。

### A11 第二页复测（2026-11-03）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-PAGE2-RETEST，235 项索引逐项 SHA256 一致。该次等待约 25 秒后，第 2 页点击文字区及图片区，选区计数 1→3；执行文本后大纲 7→9，清理回 7。一条新增行取得公开 URL，另一条未取；生成内容及精确来源锚点仍 unknown。等待后成功是实测现象，尚未证明等待 25 秒是必要条件或此前失败的唯一原因。

两图操作多次计数保持 1，覆盖范围跨越图片区域；可能是合为一块，也可能未命中其他块，原因 unknown。下一步 Hermes 持锁对当前覆盖两图的单块执行一次文本提交，记录图像可见范围、提交前后大纲、新增行公开 URL、卡片内容及来源；不以块数为 1 排除两图内容。若能设计可分别命中的两图区间，也采其结果；无法读回的内容、对象关系或锚点继续记 unknown。A11 父卡未关闭。

### A11 覆盖两图单块提交（2026-11-03）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-SINGLE-BLOCK-TWOIMG，254 项索引逐项 SHA256 一致。第 2 页单块覆盖两图所在区域，执行文本后大纲 7→9，两个新增行均取得公开 URL，清理回 7；截图覆盖及文字描述不能证明最终卡片包含两张图，编辑器未暴露可读正文或内容图。源文档及提交页面为操作上下文，生成对象的持久化页码和区域锚点未读回；对象类型与父子关系仍为候选。分别选择两图区间未成功，保留 unknown。回执称未点浓缩／OCR，未独立审计联网。

下一步 Hermes 持锁以现有公开界面查看生成卡片在脑图或大纲的实际可见内容及跳回原文，不局限编辑器 AX；保留截图、点击前后页码与定位状态，比较两图区内标记是否保留。若仍不可观察，按 unknown 交付并停止重复该路径，由 Codex 对照已取得的确定行为继续 A11；父卡在原断言未满足前保持未关闭。

### A11 卡片回读路径收束（2026-11-03）

接收 Hermes × deepseek-v4-1-flash-economy-261017 的 RESULT-JUMP-PATH-CLOSED，260 项索引逐项 SHA256 一致。此前生成的两行已清理，一次重建未形成选区，因此卡片渲染、两图保留和来源跳转均 unknown；现存卡的卡片菜单及右键菜单未见跳回原文，不等于其他界面没有入口。该取证路径按指示停止。大纲 7 行，块选择已退，回执称未点浓缩／OCR。

A11 仍未满足原完成断言：多图片／混合提交的对象内容、来源和数量契约缺乏直接证据，部分卡型与逐字段宿主验收未完成。此前原卡要求二值断言齐全，不能以候选代替通过。下一步由 Codex 对照现有证据完成可独立执行的实现与隔离宿主审计；需要新的直接证据之处维持阻塞，不要求 Hermes 重复已关闭路径。

### 主线转入 A17（2026-11-03，用户裁定）

用户允许 A11 混合提交缺口不再阻塞主线，A11 父卡仍未关闭；大纲 +2 为候选现象，不认定两张卡或对象关系。图片内容、对象类型、父子关系和来源锚点未知；其他已取得菜单及动作成果保留。后续仅补一组明确验收：图文混合输入及两图输入，确认对象数量、卡型、父子与来源文档／页码／锚点，并验证一次撤销恢复；期望值来自新的 MN5 可回读证据或用户明确批准的 MarginStudy 本地契约。停止重试已止损的公开界面路径。主线直接进入 A17，按原卡完成原位遮挡、逐层回忆、学习集设置及原验收断言。

### A17 执行中（2026-11-03）

已核对原卡：现有整卡遮挡以替换内容方式渲染，尚不能保证几何不变；回忆设置原为阅读器会话状态。正在接入可选保存至学习集及切换恢复；src/types.ts 与 src/workspace/studyWorkspace.ts 已作初步修改，npx tsc --noEmit 通过，尚无行为测试、完整 verify 或宿主验收。A17 未完成。下一步第一动作：为两个学习集保存、切换和重开写行为验证并修正，再实现原位几何、逐层、四类遮挡、计数与荧光笔用途，最后完整 verify、构建安装隔离宿主并逐项验收。

补充：新增跨学习集设置行为检查；两次 Workspace 运行均为 250/251，新增检查在第二次调用保存时因测试中无法取得工具栏或菜单失败（第一次菜单节点为 null；调整后工具栏节点为 null）。尚不能判定是测试生命周期还是实现问题，必须先定位学习集切换后的视图与阅读器状态，不能认定设置通过。依据 AGENTS.md 同一问题连续修两轮不过的止损规则，本轮停在此处；代码与新增检查保留，未执行完整 verify、未构建安装。下一步第一动作：检查 createStudySet 后 workspace 状态及工具栏挂载时机，修复测试或实际切换问题，重跑 Workspace，再继续原位几何等 A17 断言。

续查更正：上条把首次失败和一次修正误记为两轮修复，止损判断过早。第二学习集默认使用另一界面模式，测试现明确设为与第一学习集一致的传统界面；Workspace 重跑 251/251，覆盖两个学习集切换及阅读器重开，不等于宿主重启持久化验收。A17 继续，下一步原位遮挡几何及剩余断言。

新增整卡遮挡几何候选：保留内容布局并隐藏，以绝对定位按钮揭示；合成 Workspace 单卡检查揭示前后 x/y/宽/高相等且业务卡与节点不变。原 study-ui 的 textContent 断言改为检查实际可见 innerText，因为隐藏内容仍在 DOM；这改变了测试口径，应注意隐藏文本仍可被开发者工具读取，且未验证所有卡型与辅助技术。完整 npm run verify 最终退出 0，Reader 211/211、Workspace 252/252、study-ui 10/10；未安装隔离库，未做宿主验收。生成的 main.js 由 verify 构建，属于当前候选。

A17 尚未完成：此整卡候选把标题也隐藏，与已采原位状态“显示标题和答案遮挡”仍有差异；逐层下一层交互、四类遮挡和通用剩余数、重新遮回、荧光笔用途、两学习集宿主重启验证均未完成。A03 证据明确逐层下一层操作及通用公式尚未冻结，已有两条逐层路径止损，不得当 MN5 已验。下一步第一动作：修正原位候选为保留标题及其几何，构造正文／强调／图片／荧光笔实际遮挡和计数，再测试逐层不写 collapsed 与两个学习集真正重启；静态未知项保持候选，最后完成完整回归、隔离安装与宿主验收。

A17 续做：整卡遮挡现在保留独立标题，遮住答案及附属内容；标题抽查模式仍遮住标题。新增合成检查：带独立标题的卡在揭示前后边界框不变；三级回忆层级切换不更改节点数据。修正无活动学习集时恢复默认设置的哨兵状态。study-ui 12/12，完整 npm run verify 退出 0（Reader 211/211、Workspace 252/252）；该结果仅为合成验证。未安装或重启隔离 Obsidian。

A17 仍未完成：正文／强调／图片／荧光笔四类混合遮挡与未揭示掩码计数、逐层交互的 MN5 契约、遮回与整卡揭开、荧光笔用途切换及两个学习集的宿主重启验收仍需完成。标题保留及几何只覆盖单张合成卡，异步图片与辅助技术未实测；不得将通过的测试当成整卡通过。下一步第一动作：核对现有四类遮挡数据模型及 A03 的已证行为，接通可证的各类遮挡、揭示和计数，再完成真实宿主验收；未知的逐层和混合计数不伪称 MN5 契约。

A17 本轮续做（2026-11-03）：对文档摘录遮挡增加明确限定范围的“还有 N 处摘录遮挡”，按当前文档中符合范围的摘录身份计数，跨页片段同属一条摘录；揭示和遮回即时更新，不声称涵盖脑图强调或图片内部掩码，也不声称为 MN5 通用公式。新增三条摘录、跨页、揭示／遮回及仅标记范围的合成断言。脑图整卡增加重新遮回按钮，且强调遮挡保留布局，新增单卡几何行为检查；study-ui 12/12。文档测试仍在运行，完整 verify 需要在本次全部修改后重新运行。此时尚未安装隔离宿主；A17 保持未完成。下一步第一动作：核对文档测试结果并修复，再完成四类混合遮挡及完整剩余数、荧光笔用途切换、宿主重启验收。强调的布局仅在短文本合成样本验证，长段换行、异步图片及辅助技术未验证。

用户反馈：隔离 Obsidian 每次启动自动弹出多个“选择恢复的原文档”，遮挡工作区。已定位到每次来源扫描将每个歧义结果直接打开模态框；现改为后台记录待处理项目，通过命令“处理待恢复的原文档来源”按需选择，保留原有完全一致／采用已变化内容的明确确认与缺源记录。自动扫描不再弹窗，扫描结果会替换过期候选。新增对应工作区行为测试，正在运行；完整 verify、重新构建安装与真实宿主重启验收尚未完成。A17 前述未完成项继续保留；先完成本次弹窗修复并验证，然后继续 A17。

缺源弹窗修复验证：工作区 252/252、完整 npm run verify 退出 0；构建已安装到指定隔离库，完全退出并重启后没有自动恢复对话框。在真实宿主命令面板执行“处理待恢复的原文档来源”，可见待恢复列表及 P10-TOC-POSITION-20261025.pdf，随后关闭列表；未选择或变更任何来源。原安装构建备份位于 a17-execution-20261103/preinstall。

A17 宿主检查发现标准场景的“回忆”只切换工具栏，未激活阅读器遮挡；已接通场景切换及重开阅读器时的回忆状态，并在进入时退出手写。新增场景切换、重开及退出断言；调整自动加入复习测试先回到摘录场景再建卡，以符合真实的回忆点击语义。Workspace 253/253；完整 verify 正在重跑，尚未重新安装本次场景修复。下一步第一动作：确认 verify，安装并重启隔离宿主，验证场景遮挡及计数；随后继续 A17 四类遮挡、设置及父卡验收。

A17 宿主续验：完整 npm run verify 退出 0（Workspace 253/253、Reader 211/211、study-ui 12/12）；新构建及样式已安装，隔离 Obsidian 完整重启。标准回忆场景自动启用文档遮挡，当前合成 PDF 区域点击前后计数 2→1→2，截图 host-scene-recall.png、host-revealed.png；此数仅统计文档摘录，不代表脑图混合掩码总数。为重启验收在隔离库新建 A17-验收-A/B（包含已打开的 7 个测试文档），A 保存模糊摘录，B 保存单项揭示；退出 Obsidian 再重开后，分别在 B 和 A 菜单实见对应勾选、另一项未勾选，截图 set-B-menu.png、set-A-menu.png。测试学习集目前保留，回忆菜单仍打开；未完成四类混合遮挡及其计数、荧光笔用途和其余宿主验收，A17 未关闭。下一步第一动作：关闭菜单，继续实现并验收剩余四类遮挡及整卡行为；完成后处理或保留两条明确标记的隔离测试学习集，更新交付记录。

A17 进一步修正：标题模式此前仅模糊正文，仍可被读取；改为保留标题、隐藏答案且保留布局，合成检查通过。强调遮挡改为保留原文本布局，短文本与跨行长文本揭示前后卡片边界框相等，study-ui 14/14。场景回忆与手写联动曾使 A04 已测的“回忆场景手写叠加且保留回忆”回归失败；已恢复叠加行为并增加切换验证，Workspace 253/253。上述最新改动尚未进行完整 verify、重新安装和宿主验收；A17 仍未关闭。下一步第一动作：完成剩余掩码类型、计数和荧光笔用途的实现与验证，再统一完整 verify、安装宿主并复核；保持逐层／混合计数 MN5 未知边界。

补充合成验证：带图片的卡片在图片加载完成后遮挡、揭开前后边界框相等；全卡单一整体遮挡增加“还有 1 处”，揭示后不再计入、重新遮回后恢复，覆盖原位单正文单例。此数字明确只表示本卡整体遮挡，不作为多类型／多处公式；study-ui 15/15。最新代码与样式尚未完整 verify、安装隔离库，宿主卡片几何和独立类型尚未验收。

隔离宿主图像卡几何补测：在 A17-验收-A 的 P10-Rich-Tables-Charts PDF 空白区新建一条临时区域摘录及卡片 card-mw04whsv-i1yrzl；对该卡切换整卡遮挡并揭开，截图 host-card-masked.png 与 host-card-revealed.png 中选中边框像素 bbox 均为 (938,434)-(1148,575)，同态差值为零；重新遮回入口在 AX 中可见。样本是图片卡单例，不能外推混合遮挡或全部卡型。测试卡和源标注目前仍保留在隔离库，后续按该身份及该 PDF 第 3 页矩形位置 (截图 130,530)-(300,600) 清理，先删除卡片再删除对应新标注，勿动原有区域标注。当前界面 A17-验收-A，卡片已揭开；无业务库操作。

A17 续做：按已采回忆设置文案接入文档摘录与正文开关；无标题问答卡保留首段问题，隐藏后续答案，并经合成几何测试。图片已有遮挡框可单独揭示、遮回；强调内容可逐项揭示；卡片显示当前本地剩余掩码数及整卡揭开／遮回入口，单项揭示在脑图遮挡之间互斥。已添加荧光笔笔画视图遮挡：每条笔画单独覆盖，普通笔不覆盖，PDF 合成 Reader 212/212；该实现和混合计数是 MarginStudy 本地实现，不宣称已验证 MN5 通用计数。回忆时分支箭头改为会话态，不写 collapsed，合成测试通过。学习集新增“恢复默认回忆设置”，Workspace 253/253（后续新开关与混合测试仍需重跑）。最新代码尚未完整回归、构建安装及宿主验收；自动写入的 A17 临时卡与源标注尚需清理。下一步第一动作：验证多类型混合计数、单项揭示和异步渲染，再跑完整 verify，安装并在隔离宿主实测四类与设置；荧光笔用途切换的具体 MN5 行为仍缺证，不得伪称对齐。

A17 本轮继续：依据 MN5 回忆设置 AX 原文，增加“正文、荧光笔、划重点与图片、文档摘录”的可选开关，荧光笔以每条已存笔画的视图遮罩揭开／遮回，不修改笔迹；绘制时遮罩不截获笔事件。原图已有遮挡框、粗体／高亮文本支持单项揭示、整卡揭开／遮回和本卡剩余数，混合图＋文字合成测试 2→1→0→2；这是本地计数口径，MN5 混合通用公式仍未知。两个学习集设置可恢复默认；回忆时分支折叠为临时状态。已对异步图片、长文本几何和两种独立遮挡写合成检查。当前 Reader/Workspace 定向回归正在运行；本轮最新代码尚未完整 verify、安装或宿主验收。临时区域卡和标注仍在隔离库，身份见上一条；必须在原卡闭合前按身份处理。下一步第一动作：确认两个定向回归结果，检查笔迹用途切换和跨类型单项揭示，再完整 verify、安装隔离宿主及复核 A17。

A17 候选完整 npm run verify 已退出 0：study-ui 21/21、Reader 212/212、Workspace 254/254；构建 main.js/styles.css 已安装隔离库并重启。真实宿主验证：切换逐层回忆后根节点出现“揭开下一层”，点开后其子卡出现，截图 layered-open.png；这验证插件行为，MN5 下一层具体操作仍未冻结。真实 PDF 画一条测试荧光笔后进入回忆，显示“还有 1 处荧光笔遮挡”，点击后该数消失，再点恢复为 1。按身份删除本次测试卡 card-mw04whsv-i1yrzl、区域标注 ann-mw04whst-r6kcgs 与荧光笔标注 ann-mw0742m0-zza0l0，回读 data.json 与 PDF sidecar 均确认对应 ID 不存在；未删别的对象。A17-验收-A/B 两个空测试学习集仍保留用于重启设置验收。A17 未完成：需要验证荧光笔用途切换、混合掩码宿主行为及跨文档／脑图单项揭示，审计所有卡片几何与真实持久状态；不可将合成通过写成父卡关闭。下一步第一动作：查现有 MN5 静态／公开证据是否定义荧光笔用途切换，完成能自主验证的剩余工作，并保持未知口径。

A17 本轮补强：逐层模式已接入回忆设置，插件内卡片可显示标题、展开答案和下一层，分支临时开合不写 collapsed；依据 MN5 文案实现，具体点击手势仍标本地候选。四类开关已接入；新增荧光笔预设“回忆遮挡／仅标记”用途，写入新笔迹并保留旧笔迹用途，预设经 Store 重开保留（首轮发现规范化丢字段，修正后 Workspace 256/256；Reader 213/213）。用途的 MN5 等价语义仍无证，仅为插件本地行为。增加跨文档／脑图单项揭示，合成 Workspace 255/255；下一次完整 verify 正在执行。上一条宿主样本清理已完成，两个标记测试学习集保留。下一步第一动作：确认本次完整 verify，安装重启隔离宿主，实测最新逐层、荧光笔用途切换及设置回读，并按父卡逐条审计。

最新完整 npm run verify 退出 0：Reader 213/213、Workspace 256/256、study-ui 21/21；构建已安装并重启隔离库。宿主中将荧光笔用途切为“仅标记”，实际新笔迹回读 inkRecallPurpose=highlight，进入回忆仍可见且无荧光遮罩；随后按新标注 ann-mw082ihb-v1yfys 删除，sidecar 回读确认不存在，预设用途已改回“回忆遮挡”。自动来源恢复弹窗仍未复现。新增跨阅读器／脑图的单项揭示同步，定向 Workspace 255/255，已包含在完整 verify。当前还有 A17-验收-A/B 两个标记测试学习集和 A 中自动创建的文档根节点；均留在隔离库。后续第一动作：处理异步图片加载前后的几何稳定性、实际掩码类型与剩余数的对照及默认／独立设置重启，再完成最终构建宿主验收；荧光笔用途与逐层精确手势仅属本地候选，MN5 口径未冻结。


A17 续验（2026-11-03）：异步图片、评论身份和退出回忆重置已增加合成检查。逐层展开与单项揭示状态已分离，组合测试通过且不改业务节点。完整 npm run verify 退出 0：study-ui 25/25、Reader 213/213、Workspace 256/256；最新构建已安装隔离库并完全重启，未自动弹出来源恢复选择。宿主逐层根节点可揭开；此样本无子卡，多层单项组合仅经合成测试。

A17 未关闭：最新构建仍需宿主验证混合掩码计数、几何和两学习集新设置重启；MN5 逐层精确手势、混合计数通用公式与荧光笔用途语义仍未知。隔离库保留 A17-验收-A/B 及 A 的文档根节点。下一步第一动作：在隔离库建立可精确清理的混合类型与父子卡样本，检查几何、单项揭示和计数，重启核对设置；随后按 ID 清理并复核原卡。图片永久 pending 时的揭示行为仍需审计。

A17 续验（2026-11-03，图片等待修复）：图片请求永久 pending 曾使揭示按钮永久禁用；现等待 10 秒后恢复按钮并提示重试，正常加载仍等待布局稳定再揭示。新增停滞后重试行为检查，study-ui 26/26；完整 npm run verify 退出 0（Reader 213/213、Workspace 256/256），构建已安装隔离库并完全重启，未见自动来源恢复对话框。A17 未关闭：最新构建真实宿主的混合掩码、父子逐层组合和两学习集新四类设置跨重启尚未验证；斜线荧光笔外接矩形可能遮挡额外内容，隐藏文本辅助技术行为尚需审计。隔离 Obsidian 当前 A17-验收-A，PID 83508、窗口 24522，根节点菜单打开；A/B 验收学习集及 A 的文档根节点保留。下一步第一动作：关闭菜单，建立可按 ID 清理的混合类型父子卡，实测单项及整卡揭示、遮回、计数、边框和 collapsed 不变，再验证 A/B 新设置重启恢复；清理并完成必要修复后重跑完整 verify、安装复验。

A17 本轮（2026-11-03）：移除长期 pending 图片揭示死锁后，完整 `npm run verify` 再次退出 0（study-ui 26/26、Reader 213/213、Workspace 256/256 及其余套件全绿），main.js/styles.css 已重新安装隔离库。尝试继续真实宿主重启验收时，Cua Driver 守护进程已退出且重启受 macOS TCC Accessibility/Screen Recording 权限门控；现有 socket 被占用、替代 socket 也无权限，无法读取或操作 Obsidian。此前已有宿主证据仍有效：逐层根节点揭开、荧光笔仅标记／回忆遮挡、图片卡几何、来源恢复弹窗修复、A/B 学习集设置重启恢复。未伪称本轮混合父子样本宿主验收通过。当前硬阻塞是 Cua Driver 权限／守护进程外部状态，下一步第一动作是恢复已有 Cua Driver 会话后继续宿主混合掩码与 A/B 设置复核。

A17 宿主续验（2026-11-03）：更正上条权限归因，macOS「设备控制和数据访问」中 CuaDriver 已授权，守护进程访问受执行环境差异影响；现已恢复。隔离 A 学习集用一次区域摘录建出两张共享标注的测试卡，实测逐层揭开父节点后揭开图片子卡，父节点保持展开；持久化读取三节点 collapsed 均保持 false。按身份删除两节点并从页边删除测试标注，回读两张临时卡及标注均不存在。A 设置逐层、正文遮挡关闭、其余三类开启并保存；完全退出重启后截图 a17-settings-a.png 显示逐层及对应四开关恢复，切到 B 截图 a17-b2.png 显示原位、四开关开启、单项揭示开启，两个学习集未串值。截图在本卡 evidence 目录。现仍缺真实宿主同卡强调＋图片混合掩码几何计数、斜线荧光笔覆盖与辅助技术审计；A17 未关闭。下一步第一动作：建立可精确清理的混合卡，量同态几何及计数，再完成其余审计。

更正及续验：上条「两张临时卡不存在」不准确：删除标注会解除关联但保留两张孤立卡 card-mw0c10vx-fzbfr7、card-mw0c269u-w2xpse，两节点及标注已删除；这两张卡仍需在资料库按 ID 清理。另在 B 建立图片＋强调文本卡 card-mw0e5mch-az1q45，宿主回忆模式遮挡强调时显示还有 1 处、AX 未暴露隐藏答案；点击后出现答案且计数消失。此卡未设置图片遮挡，因此不是混合掩码验收。该卡及节点 ann-mw0e5mcc-nhhlqy 对应标注均已删除，B 留下自动文档根 node-mw0e5mcw-1ocwz6。下一步第一动作：按 ID 清理 A 中两张孤立测试卡，再通过卡片详情图片遮挡编辑器建立同卡图片＋强调样本，继续几何与计数验收。

两张孤立卡已在卡片管理逐张删除，data.json 回读确认 card-mw0c10vx-fzbfr7、card-mw0c269u-w2xpse 均不存在；未删除其他卡。当前 Obsidian 留在卡片管理，A/B 测试学习集及各自自动文档根仍保留。下一步第一动作：关闭卡片管理，建立同卡图片遮挡＋强调样本并记录卡片及标注 ID、揭示前后边框及计数，完成后通过卡片删除和标注删除分别清理。

A17 混合遮挡宿主验收：B 的测试卡 card-mw0hbuh0-rcyfs8 含强调及图片遮挡 mask-mw0i3ofe-ldhyji；初始还有 2 处，单项揭示强调后 1，因 B 的单项揭示策略改揭图片后仍 1，整卡揭开后计数消失，重新遮回恢复 2。截图 a17-mix-before.png、a17-mix-after.png 的选中边框均为 (938,434)-(1148,615)，像素差 0；这是一个实际卡例。屏幕阅读树在隐藏时只暴露揭示按钮、揭示后暴露答案。该卡、节点和标注 ann-mw0hbugx-sfqe2k 已通过界面分别删除，data.json 与 sidecar 检索确认不存在。下一步第一动作：审计荧光笔斜线遮罩过大，修复并定向验证后完整 verify、安装重启；按原卡断言核对后决定关闭。

更正混合卡几何：上条坐标为目测；以截图颜色阈值机械提取，揭示前 bbox (938,433)-(1148,615)，揭示后 (938,434)-(1148,615)，顶边相差 1 截图像素；可能混入遮罩像素，尚不能证明卡片真实 CSS 边界不变，不得当作 0 差值通过。斜线荧光笔遮罩仍为外接矩形；尝试设计路径多边形但曲折笔画可能自交及漏遮，未保留修改。A17 未关闭；下一步第一动作：在合成样本与宿主取得卡节点真实 DOM 或可靠边框几何，确认 1 像素差异来源；再采用能完整覆盖曲折笔迹的描边遮罩并测试，最后完整回归和隔离宿主复验。

A17 几何核实（2026-11-03）：原宿主混合卡两张截图的顶边部分受其他界面元素遮挡，颜色阈值获得的 1 像素差不能证明真实 DOM 几何变化。为强调＋图片遮挡混合卡补充 getBoundingClientRect 比较，覆盖单项揭示、整卡揭开和遮回；定向 study-ui 两次运行均 25/26，新增断言发现边界不一致：一例从 (100,220,230,231.140625) 变为 (100,220,230,365.140625)，等待初始图片 decode 后复测仍不一致（y 220→221.09375，高 231.140625→365.140625）。目前尚未分清图片重新挂载／加载时机与实际布局缺陷，不能断言已修复或通过；测试保留为失败证据。下一步第一动作：定位首次发生变化的操作及渲染／图片加载时序，修正后重跑混合几何和宿主验证，再处理斜线遮罩与完整回归。未安装新构建。

A17 几何继续定位：确认整卡揭示前有图片遮挡框容器，揭示后图片直接作为 flex 子项导致宽度拉伸、卡高增加 134 CSS px；现保留图片外层容器，复测卡高相等。位置仍不稳定：测试观察 y 相差约 1.09 CSS px；尝试图片解码后重新渲染、关闭滚动锚定，定向 study-ui 仍为 25/26，关闭滚动锚定的无效改动已撤销。尚未确定位置变化来自视口、布局时序还是实际节点移动。按 AGENTS.md 同一问题连续修两轮不过的止损条件暂停；保留图片容器修复和失败断言，未运行完整 verify，未安装新构建。下一步第一动作：分别记录卡片相对 world 坐标、world 屏幕坐标、scrollTop 和视口 gutter，区分节点与视口位移；定位后修复并复测，再执行荧光笔遮罩、完整回归和隔离宿主验收。A17 未关闭。

A17 完成复核（2026-11-03）：卡片混合测试的纵向偏差由测试界面工具栏尚未稳定导致，记录到 world 坐标不变、画布 viewport 高度和屏幕位置改变；等待字体与界面稳定后，混合卡单项揭示、整卡揭示、遮回前后 DOM 边界 x/y/宽/高相等。真实缺陷为揭示时图片脱离框容器成为 flex 子项，导致卡高增 134 CSS px；现统一容器，合成测试通过。斜线荧光笔遮罩改为 SVG 沿笔画描边，折线几何与背景命中检查通过；隔离宿主实测斜线覆盖、区域外点击与揭示计数 1→0。测试标注 ann-mw0jp00i-xjd1kd 的笔迹已擦除，关闭宿主后仅移除该空标注，重开侧文件回读不存在，其余两条保留。完整 npm run verify 退出 0（study-ui 26/26、Reader 213/213、Workspace 256/256，其余通过）；main.js/styles.css 已安装隔离库并完整重启。四项断言、证据范围及未冻结的 MN5 语义见 a17-execution-20261103/RESULT.md；A17 按本地实现和验收关闭，不宣称未知 MN5 语义已对齐。A17-验收-A/B 与自动文档根保留隔离库。下一步按主线进入 A18。

A25 完成复核（2026-11-03）：脑图导出增加 A4 双栏 PDF 卡片流，包含文本、图片、评论与可选卡片手写；层级遍历、折叠后代、引用去重与图片加载失败显式报错。三卡合成样本含父子、重复引用、中文、评论、跨页长文本和两组双色图片，实际 PDF 3 页逐页渲染，图片两端均可见，页面内容处于页边距内，源 cards/nodes 前后相同。完整 npm run verify 退出 0（card-flow 1/1、Reader 213/213、Workspace 256/256 等）；构建安装隔离 Obsidian 后实际导出一页脑图 PDF 并渲染核对。详细证据及限制见 a25-execution-20261103/RESULT.md。PDF 内容为图像，文字不可选择搜索；MN5 全图顺序与分页没有冻结证据，本实现为本地契约。A25 按该范围关闭，下一步进入 A30 主页同态、三视口、精修和 OPPO 验收。

A30 执行进展（2026-11-03）：接入启动学习集主页、从主页选择学习集进入工作区、工作区房子入口返回主页；首次没有既有工作区时在 layout ready 后打开工作区主页。主页加入学习集／卡组／资料库分区导航，并改为侧栏加卡片网格；分类筛选和排序重绘时保留主页状态。新增导航行为检查，三视口 1512×949、756×855、380×700 横向溢出检查通过。完整 npm run verify 退出 0，Workspace 257/257、Reader 213/213、card-flow 1/1；最新 main.js/styles.css 已安装隔离 Obsidian 并重启，实测启动主页、选择 A17-验收-B、返回主页、切换卡组／资料库。当前视觉仍与 MN5 单视口参考有明显差异，封面预览、筛选和新建入口布局等尚未同态对齐；三视口测试仅证明插件内不横向溢出，不证明与 MN5 ≤4 CSS px。

A30 硬阻塞：找到 O+Connect 自带 `/Applications/O+Connect.app/Contents/Resources/daemon/bin/adb`（35.0.2），经授权在沙箱外启动 adb 并运行 `adb devices -l`，设备列表为空，不能做 OPPO 实机验收；此前「本机无 adb」已更正。现有材料缺同学习集、同对象、同窗口、同缩放的 MN5 三视口参考及锚点，且 MN5 操作锁归 Hermes，不能推断几何通过。A30 保持未关闭。下一步第一动作：取得 OPPO 连接及调试授权，取得 Hermes 持锁采集的同态三视口参考图／视口尺寸／缩放与锚点；再按其数值完成主页和工作区精修、真实可达检查、完整 verify、隔离宿主与 OPPO 验收。现有 A25 本地 PDF 按先前结果交付，A30 改动尚未正式部署。

A30 OPPO 续验（2026-11-03）：设备 `OPD2409` 已连接，adb 设备状态为 device，安装有 Obsidian 1.14.4。已将本地构建及合成 PDF 复制到手机独立目录 `Documents/MarginStudy-A30-Isolated`，通过 Obsidian 选择该文件夹；当前停在“你是否信任这个仓库的作者？”提示，需启用本项目插件后才能继续验收。打开 Obsidian 时意外恢复了用户现有库并显示同步删除提示；没有点击确认删除。一次尝试点“暂时忽略”时误把缩小后的截图坐标当作原始设备像素，实际落点不是该按钮；随后弹窗消失，无法从现有观测确定它为何消失或是否发生任何同步动作，不作零影响断言。已切换离开原有库，误截到原库的项目目录截图已删除；其余导航截图只存系统临时目录。A30 尚未完成：等待用户处理当前信任提示，再检查插件能否加载、实测手机布局与导航；MN5 同态三视口基准仍缺。下一步第一动作：确认已启用隔离库插件，截图核验库名和主页，继续实机验收。


A30 OPPO 手势续验（2026-11-03）：移动 PDF 阅读器内阻止触摸事件冒泡到宿主侧栏，不取消默认滚动和选择；构建并安装手机隔离库。OPPO 在摘录场景从左边缘右滑侧栏未弹出，手写测试笔迹切换场景及强停重启后仍可见。截图见 a30-oppo-fixture/a30-oppo-reopened.png、a30-oppo-excerpt-edge.png；文字选区完成、纵向滚动及侧栏按钮仍需进一步实测。完整 npm run verify 退出 0，Reader 213/213、Workspace 258/258。A30 未关闭：仍需同态三视口基准及 ≤4 CSS px 精修、窄窗验收，继续检查 OPPO 选择与滚动。下一步先在手机测试文字选区与纵向滚动，再取得可用的同态参考并完成视觉验收。

A30 OPPO 系统菜单修复：移动 PDF 文本层阻止 contextmenu 默认动作，保留选区；重启隔离库后长按文字实测，系统复制／全选菜单未出现，选区手柄和插件操作条可见并生成测试卡。证据 a30-oppo-fixture/a30-oppo-menu-test.png。完整 npm run verify 退出 0，Reader 213/213、Workspace 258/258；测试数据仅在手机隔离库。A30 同态三视口及视觉精修仍未完成，下一步检查纵向滚动及侧栏按钮，再对照现有 MN5 参考继续精修。

OPPO 后续：合成 PDF 上长按文字成功选区并生成测试卡，系统菜单未出现；纵向滑动后页面内容上移，侧栏按钮仍可打开。隔离库保留测试笔迹和两张测试摘录卡。A30 未关闭，下一步继续三视口同态参考、精修与验收。


Pad 脑图触控专项（进行中）：OPPO 隔离库拖动测试节点后画面大幅跳动，节点跑到视野边缘；尚未证明具体根因。已修改节点拖动按 pointerId 配对，取消/失焦回滚、触摸阈值 12px；增加双指缩放输入处理并禁止浏览器抢占画布手势。已构建推送手机并重启；重启后脑图空白，尚未完成修复后拖动验证，不能宣称问题已修复。现有完整 npm run verify 退出 0（Reader 213/213、Workspace 258/258），但尚未添加本专项多指/取消/掌触测试。未完成：定位重启后节点不可见及拖动跳动数值、验证单指/双指/取消/笔与掌触，触摸菜单编辑及添加卡片入口，新增行为测试，重新完整回归并在 Pad 验收。下一步第一动作：恢复隔离脑图可见节点，测量拖动前后节点坐标和视口 scroll/gutter，依据实际偏差修复。A30 和本专项均未关闭。


Pad 脑图触控续修（2026-11-04）：实机命中卡片正文确认旧版本画布 touch-action=auto，系统接管触摸、卡片坐标不变；此前两次误触分隔线不能作为卡片拖动结果。现将脑图滚动容器 touch-action 设为 none，缩放范围从 0.3–3 扩为 0.1–6，更新最低缩放测试并新增 touch 卡片双轴拖动、pointercancel 回滚、双指缩放不移动卡片行为测试。完整 npm run verify 退出 0，Workspace 259/259、Reader 213/213；main.js 已构建安装 OPPO 隔离库并重启，实测垂直拖动卡片自身 top 733.492→792.941（约 59 CSS px）。斜向拖动一次 X 改变而 Y 未明显变化，需在稳定视口再复测。尚未验证 Pad 物理双指、触控笔与掌触、节点菜单、添加卡片入口及桌面宿主回归；专项不关闭。下一步第一动作：在隔离 Pad 稳定视口重测卡片斜向拖动并记录指针轨迹，再测双指与其余交互。


Pad 摘录套索续修（2026-11-04）：用户明确指摘录场景区域框选，不是手写套索。修复 PDF/HTML 区域框选 pointerId 配对及取消，启用期间为阅读器设置 touch-action:none，退出恢复。已构建安装隔离 Pad，真实触摸框选后生成一张 [区域摘录] 卡，截图 /private/tmp/a30-oppo-region-test.png；完整 npm run verify 退出 0（Reader 213/213、Workspace 259/259）。隔离库保留这张测试卡。尚缺专门多指/取消行为测试、Pad 实机双指与笔和掌触、卡片菜单与添加卡片触摸验收以及桌面回归；Pad 专项未关闭。下一步：补区域摘录多指与取消测试，检查触摸入口并完成实机验收。

补充：新增 PDF 摘录套索 touch 多指干扰、pointercancel、取消后重选和退出恢复触摸的行为断言，Workspace 260/260；完整 npm run verify 退出 0。Pad 专项其余物理多指、笔与掌触、菜单和添加卡片仍未验，不关闭。


Pad 面板可见性修复（2026-11-04）：定位宿主移动端按钮左右 padding 各 20px，导致工具栏 SVG 实际宽 0；统一防止工作区原生图标被 flex 压缩，并修正工具按钮及 Cards 筛选图标内边距。顶栏三点恢复可见，Cards 增加直接关闭按钮；Pad 隔离库实机确认三点展开后图标可见、Cards 筛选图标可见、右上角关闭可关闭面板，截图 /private/tmp/a30-oppo-panel-visible.png、cards-enter.png、cards-closed.png。自动测试包含多视口入口与图标宽度、Cards 重开关闭；完整 npm run verify 退出 0，Reader 213/213、Workspace 261/261。其他未打开面板和全部动作未逐一实机覆盖，不宣称所有面板均已验证；Pad 触控专项保持进行中。


A30 续验（2026-11-04）：已读取 a30-mn5-ref-20261103 的 HANDOFF、RESULT、anchors 与 pixel-geometry；参考包存在，纠正先前称缺参考的旧记录。按参考在 styles-workspace.css 加入首页 265px 侧栏及卡片网格候选，完整 npm run verify 退出 0（Reader 213/213、Workspace 261/261），main.js/styles.css 已安装桌面隔离库并重载。隔离 Obsidian 请求 756×855 时系统实回 756×852；实际首页分类控件 x=248，显示当前候选样式尚未按预期生效（或宿主布局/缩放存在差异），未达到同态锚点，不可判通过。尚未完成三视口逐项测量、宽高不同的上下分栏、≤4px 精修和 OPPO 全项验收；P1–P6 unknown 保持。下一步第一动作：检查隔离 Obsidian 加载的样式规则、实际工作区宽度及 zoom，定位 265px 规则未生效原因，再采同态几何。A30 未关闭。

A30 真实宿主补充：756×852 隔离窗口首页仍出现两列（卡片分类输入 x=261 和 x=502），而参考 756×855 为一列、侧栏 265；候选未生效不能计通过。窗口已恢复 1512×852。下一步需先确认屏幕 zoom 和生效样式后再修；不得用当前结果替代三视口验收。

A30 宿主样式更正：完整退出并重启隔离 Obsidian 后，在 756×852 窗口首页读到两张卡片分类控件均为 x=359，纵向 y=553/793，确认候选样式生效且为单列；上条“候选未生效”的判断仅适用于重载前缓存，不适用于重启后。距离 MN5 参考的卡片位置、首行高度及其他锚点仍未通过，且窗口高度差 3pt、宿主工作区边界不同，不能当同态通过。下一步继续量化主页各锚点和工作区三视口分栏，保留 A30 未关闭。

A30 首页续修：将学习集筛选和排序移动到主页标题行，空置顶分组不再占位，保留操作入口；工作区定向 261/261。完整 verify 第一次阅读器定位文本框尺寸检查失败，单独复测 213/213 后完整 verify 再跑退出 0（Reader 213/213、Workspace 261/261）。新 main.js/styles.css 已安装并完整重启隔离 Obsidian：756×852 首页两条分类输入同 x=359，y=392/632（此前 553/793），为单列且整体上移 161pt；这不是参考卡片边缘锚点，不能认定 ≤4px。A30 未关闭，下一步第一动作：在隔离宿主逐项测量首页首卡外框和工作区分栏，按参考修正，再覆盖三视口及 OPPO。

A30 续修：在文档和脑图同时打开且无侧栏/辅助面板的默认左置布局下，高窄窗口改为文档上、脑图下；短窗保持左右。分隔线拖动按实际纵向布局计算，阈值为插件适配选择，MN5 的切换阈值依然 unknown。隔离 Obsidian 756×852 实见上下、756×427 实见左右，截图 a30-execution-20261104/a30-split-real.png 与 a30-split-short.png；分界与参考尚有偏差，不能计 ≤4px。新增三视口方向合成断言，完整 npm run verify 退出 0（Reader 213/213、Workspace 264/264），构建安装桌面隔离库与 OPPO 隔离库。OPPO 启动后显示多个学习集；尝试进入 A30 样本后显示未选择学习集，故本次并未证明目标学习集或 OPPO 全项验收通过，需重新确认隔离库身份和选中状态再继续。下一步第一动作：确认 OPPO 当前仓库和学习集，安全回到 A30 样本；再量化三视口锚点，校验分界和用户可拖动交互。A30 保持未关闭。

OPPO 后续：只读确认当前仓库为 /storage/emulated/0/Documents/MarginStudy-A30-Isolated，正确选中 A30-OPPO。测试卡命中正文后以 ADB 单指斜向拖动 132×106 设备像素（DPR 2.625），节点坐标从 (236.953,665.491) 到 (286.987,705.669)，变化 (50.034,40.178) CSS px，符合位移约 (50.286,40.381)。该实测覆盖单指斜向拖动，不覆盖物理双指、触控笔与掌触。A30 同态锚点和其余 OPPO 验收仍未通过。
Pad 测试卡的“卡片更多操作”可通过实际触摸打开，菜单边框在屏幕内；本次只验证打开和可见，未逐项执行菜单动作。

A30 续验：新增三个指定视口的文档/脑图方向检查，工作区 264/264，完整 npm run verify 退出 0；桌面隔离宿主高窄上下、短窗左右均已实见，但分界与参考仍有差距。OPPO 只读确认隔离仓库并选中 A30-OPPO，真实单指斜拖测试卡两轴位移与输入一致；卡片更多菜单通过触摸打开。精确同态对照仍缺桌面隔离库中 P10-Isolated-20261025 学习集，检索其插件 data.json 无该名称；不能把 A17 学习集截图冒充同学习集。下一步第一动作：查找已有可复用的 P10-Isolated 隔离学习集数据或构造可核验的同对象样本，量化首卡/工具/分界与参考误差；其后继续 OPPO 双指/笔/掌及完整复核。A30 仍未关闭。


A30 续修（2026-11-04 15:39）：修订几何口径全部纳入合成断言；真实viewport、756×852底锚-3px、产品可达性与参考对齐分开。新增主页消息/引导/最近及对应锚点，修复Obsidian ribbon占宽和Pad中等宽度新建按钮出屏。最终完整 npm run verify 27套件全绿（Workspace 285/285、Reader 213/213），构建安装两端。桌面重载已看到主页与等价P10-Luna切换；最后中等宽度样式补丁已复制桌面但未再次重载。OPPO重启后实际触摸新建能打开窗口且已取消，未创建对象；主页截图入包。结论为“等价样本非原件”。A30父卡仍未关闭，真实桌面三视口误差表、Pad物理双指/笔/掌触及P1/P3/P4未验。RESULT与完整日志在a30-execution-20261104/。下一步第一动作：桌面隔离库重载最新样式，记录实际viewport和插件容器偏移，完成真实三视口逐项测量；再完成Pad剩余触控验收。

A30 桌面续修（2026-11-04）：用户要求先完成桌面范围。真实 Obsidian 发现自身两层标题栏让主页首卡 y=194.56（参考 139），为桌面学习工作区隐藏重复 view-header 并将该活动标签栏设为 22px；限定非移动端。长标题不再撑高卡片，缩短封面 5px，最终构建已安装桌面隔离库并重载。实际 innerWidth×innerHeight=1512×848，首页五卡 x=309.5/548.59/787.70/1026.80/1265.90、y=138.40、宽约216.6、高200；756×848 时首卡 x=309.5、y=138.40、宽357、高200，此窄窗读数来自临时注入等价规则的宿主，尚需对最终安装再次复测。工作区将 DOM 比例临时设为 .5/.5 测得：756×848 上下分界 reader bottom=464.34、map top=465.34；756×427 左右分界 375.5/380.5、顶部胶囊 29–727、工具按钮 y=364.5；1512×848 左右分界 753.25/758.75、胶囊 407–1105、工具按钮 y=785.5。等价样本非原件；临时修改比例没有作为持久设置验收。最新完整 npm run verify 退出 0，Workspace 285/285、Reader 213/213。真实宿主截图通道此时只返回白色小图，重置 cua 会话、重启 Obsidian 后仍如此；AX 和 DevTools 仍可读 DOM。尚缺最终安装后三视口截图及其全部参考锚点逐项复核，不得关闭桌面或 A30 父卡。下一步第一动作：恢复桌面截图通道，确认最终安装的 756×848 和 756×427 首页及工作区真实截图，再逐项比对 §7.1；注意本次 1512 高度实际为 848，不得伪称 855。Pad 实机和未知项继续留父卡。

A30 续修：用户指出资料库／版本库未对齐及整理／回忆／手写右侧空白，撤回先前桌面已完成的说法。当前代码分别校正侧栏底部入口与设置、更多按钮，最近一次失败报告中资料库／版本库误差已为零，设置／更多仍差 7px；新修正已写入，完整 npm run verify 正在运行，尚未确认结果及安装。右侧空白尚未用多卡 P10-Luna 样本复测，禁止断定已修复。下一步第一动作：确认运行中的完整验证结果，必要时修复；构建安装隔离库后对多卡样本逐一检查三场景及侧栏。A30 未关闭。

A30 继续：侧栏修正后的完整 verify 已通过（Workspace 285/285、Reader 213/213），样式已安装桌面隔离库。P10-Luna 多卡样本真实宿主回忆场景显示工具行固定宽度造成右侧大段空白，同时脑图节点有重叠／出视野现象。现为回忆、整理、手写工具栏按内容收缩；最新样式已构建并复制隔离库，尚未重载或逐场景验收，改动后的完整 verify 正运行。下一步第一动作：确认 verify 结果，重载隔离宿主，检查三个场景工具栏是否可达无空白及节点重叠问题，再对照主页及参考三视口；A30 仍未关闭。

A30 续验：最新完整 npm run verify 退出 0，Workspace 285/285、Reader 213/213；本次样式已安装并重载桌面隔离库。P10-Luna 实际切换回忆、整理、手写，三个工具栏均随工具数量收缩，右端不再保留大段无工具空白，控件均可见。该样本脑图节点仍明显重叠且部分出视野，原因未定位；尚未完成主页侧栏实际三视口量测和 A30 全断言复核，A30 仍未关闭。下一步第一动作：检查 P10-Luna 持久化节点坐标与视口，区分原样本重叠和渲染问题，不擅自重排用户节点，再完成桌面三视口验收。等价样本非原件。

A30 样本坐标核对：只读隔离库 data.json，P10-Luna 主脑图九个节点中两节点持久坐标同为 (40,40)、两节点同为 (320,40)、三节点同为 (320,190)，所以该样本的节点重叠有持久数据依据；这不证明所有脑图的渲染均正常。未改动节点。下一步第一动作：用自动布局入口在隔离样本验证可见性及坐标变化，并检查三视口主页侧栏和三个场景；完成全部验收后再决定 A30 桌面关闭。

A30 桌面继续（2026-11-04）：在 P10-Luna 隔离样本调用自动布局后仍有高卡重叠，故不能将该动作当作节点布局通过；本操作改变了该隔离样本节点位置。实测发现宿主按钮默认居中使资料库和版本库文字未对齐，已修为左对齐；短窗 756×427 两者文字 x 均为 58。按参考补充学习集、卡组、最近、资料库、版本库图标，长最近项截断处理。修正前一次完整验证因文字垂直位置失败，增加垂直居中后 285/285 通过；最新截断样式的完整 npm run verify 正在运行，构建样式已复制桌面隔离库，尚需重载验收。宽窗实测 1512×848 侧栏宽 265、首卡 x=309.5、宽 216.59；高窄 756×855 首卡 x=309.5、宽 357；短窗 756×427 同宽，工具行底距 30.5。P10-Luna 分栏比例是用户已存的非 50% 状态，不能将其 392.78 边界与参考的 375 直接判同态。等价样本非原件。A30 桌面尚未关闭：最新安装需重载、完整验证结束后确认，仍需逐项补全真实宿主参考差值和结果记录；自动布局重叠问题需单独定位。下一步第一动作：确认进行中的 verify，重载桌面隔离库检查导航图标、文字截断和三视口，核对未通过断言。

A30 桌面补修：真实宿主再次点击主页入口曾叠加两组导航与标题控件，原因是 showStudyHome 重复增强，现已修复并加入重复打开断言；安装后实见仅一组。资料库／版本库文字 x=58，导航图标实见，长名称省略显示。主区标题此前未被几何断言覆盖，按参考下移 21px 并增加标题 x/y 断言，样式已装入桌面隔离库并重载；最新完整 npm run verify 正在运行。此前完整 verify 已全绿，但不覆盖最新标题改动。仍需确认当前 verify，完成真实三视口锚点逐项表，尤其以 50% 同态分栏测量；等价样本非原件。P10-Luna 自动布局仍可能使高卡重叠，记录为独立问题，不将其误称已修复。

A30 桌面进一步核验：最新完整 npm run verify 退出 0，Workspace 285/285、Reader 213/213；最终构建已安装并重载隔离 Obsidian。宽窗 1512×852、高窄 756×852、短窗 756×427 分别实测等比例文档／脑图边界、顶部七项、摘录工具及浮动按钮；三尺寸附件胶囊使用 A17-验收-B 临时附件关系实测后已取下，data.json 回读附件关系为空。主页品牌、侧栏、标题、三视口主要控件、网格、背景色也已实测，数值及误差见 a30-execution-20261104/RESULT.md。等价样本非原件。桌面任务仍未关闭：截图已通过桌面工具目视但本轮未持久保存完整六图，且 RESULT 尚未形成逐项完整误差表；P10-Luna 自动布局重叠属已观察的独立问题。下一步第一动作：保存最终三视口主页／工作区截图并按 RESULT 中参考逐项生成真实宿主误差表，完成后核对桌面关闭条件；Pad 及 P1/P3/P4 保持父卡未验。

A30 桌面范围复核完成（2026-11-04）：前条所缺六张最终安装版截图已存入 a30-execution-20261104，分别为主页／工作区 wide、tall、short；实际 CSS 视口分别 1512×852、756×852、756×427。RESULT 增加真实宿主参考组的误差表、截图与高度差口径，完整版 verify 摘要和 workspace 日志已留档。所列参考组实测偏差均 ≤4px；窄窗新建入口按产品可达性单独登记。完整 npm run verify 退出 0（Workspace 285/285、Reader 213/213），桌面隔离库已安装重载。截图使用 A17-验收-B／图表 PDF：等价样本非原件；50% 分栏仅作临时同态设置。资料库／版本库对齐、主页导航重复及长名称截断已修复，三场景工具栏无尾部大块空白已实见。桌面范围到此停点；A30 父卡不关闭，Pad 完整验收及 P1/P3/P4 仍未验。另记 P10-Luna 自动布局后高卡重叠，未在本视觉批次宣称修复。

A30 Pad 续验（2026-11-04）：隔离仓库 A30-OPPO、合成文档 A30-synthetic；最新构建已在 Pad 运行。真实 ADB 单指平移后找回脑图节点，斜向拖动节点时持久坐标从 (286.987,705.669) 至 (336.265,745.471)，变化 (49.278,39.802) CSS px，对应物理输入 (130,105) px、DPR 2.625；画布滚动未变。真实触摸可打开节点更多菜单、打开及关闭 Cards；手写、整理、回忆工具栏切换均可见且无尾部大块空白。CDP 双指合成从 scale 1 到 1.4 再回 1，节点坐标不变，回程 scroll 横向偏移约 5.3 CSS px；此项不等于物理双指验收。摘录套索先前已在同一隔离库真实触摸生成区域卡。Cards 的批量操作可触摸展开，源码确认“生成脑图”创建独立脑图，尚未证明将现有卡片直接加入当前脑图的触摸入口。物理双指、触控笔与掌触尚未验，不能关闭 Pad 专项或 A30 父卡。下一步：在 Pad 上实际双指缩放、笔写与掌触测试，并继续验证当前脑图添加卡片入口；保留实测与合成输入的区分。截图临时文件 /private/tmp/a30-oppo-pad-current.png、pad-organize.png、pad-recall.png 等包含其他标签标题，未作为公开证据复制。桌面最新完整 verify 仍为 285/285、Reader 213/213，本轮未改代码。

Pad 遮挡与缩放续修（2026-11-04）：对照 MN5 原图确认横贯屏幕的展开工具行并非 MN5 默认顶部布局。现增加触碰工具行外自动收起，保留三点入口；Pad 安装新 main.js 并重启后，实际点开再点脑图背景，工具行收起、信息胶囊可见。双指缩放改为每动画帧合并 pointermove，减少重复布局计算；这是性能修复候选，未测得物理手势帧率，不能宣称卡顿已解决。完整 npm run verify 退出 0（Workspace 285/285、Reader 213/213）；之后新增工具行外点击关闭断言，单跑 workspace 285/285。已构建并安装 Pad 隔离库。A30 与 Pad 专项未关闭；下一步需在 Pad 物理双指缩放实测卡顿，再按结果继续分析；笔与掌触、添加现有卡片到当前脑图触摸验收仍未完成。

Pad 用户复测（2026-11-04）：用户报告物理双指仍“特别特别卡”，上一轮动画帧合并未通过，性能根因未定位，禁止宣称已解决。用户指搜索无法关闭：Pad 实测原搜索框关闭叉被宿主移动端按钮内边距挤没；styles-reader.css 固定搜索控件宽度和图标尺寸并限制容器宽度，已构建推送隔离 Pad、重启，实机看到叉并点按成功关闭（临时截图 /private/tmp/a30-oppo-search-fixed.png、search-closed.png）。MN5 实机有底部场景工具栏及顶部信息胶囊，额外横向工作区工具行非默认 MN5；前次回答未清楚区分。完整 npm run verify 最终退出 0（Reader 213/213，Workspace 285/285）；第一次新增测试依赖测试桩 SVG 而失败，已改为测实际按钮尺寸并重跑全绿，Pad 实图另行证明 SVG。下一步第一动作：针对 Pad 物理缩放录制性能轨迹或采样帧耗时，区分 PDF 与脑图缩放及浏览器合成／布局开销，修复后完整验证并安装；用户反馈的严重卡顿尚未解决，A30 和 Pad 专项均不关闭。

Pad 卡顿继续排查（2026-11-04）：用户上次确认物理双指缩放依旧严重卡顿。隔离 Pad 上用 CDP 连续 80 次合成双指移动采集 requestAnimationFrame 间隔，约 16.6–16.8ms、无 longtask；此仅是小样本合成输入，无法复现或否定用户的物理卡顿，不能作为通过。检查发现节点拖动每次 pointermove 读取 getBoundingClientRect/offsetWidth 强制布局，改为手势开始时记录比例并直接用指针位移计算；构建并安装 Pad 后 ADB 实机拖动卡片有位移，完整 npm run verify 退出 0（Reader 213/213、Workspace 285/285）。此修复针对卡片拖动，尚未证明解决物理双指卡顿。下一步第一动作：让用户在当前隔离 Pad 上复现物理双指的同时采集 DevTools trace 或 Android gfxinfo，将实际事件、主线程与合成帧耗时对应；定位后再修，不以合成 60fps 冒充实机通过。A30 与 Pad 专项仍未关闭。

Pad 卡片拖动卡顿修复（2026-11-04）：用户反馈刚开始拖动就卡。Pad WebView Performance 对同一 50 次合成触摸移动采样：修改前 LayoutCount=42、LayoutDuration=13.857ms、TaskDuration=288.519ms；拖动期间改用 transform 预览、抬手才提交坐标，并对连线应用位移后，同类采样 LayoutCount=1、LayoutDuration=0.426ms、TaskDuration=179.83ms。合成性能数据不代表物理手感已通过。完整 npm run verify 退出 0（Reader 213/213、Workspace 285/285），新 main.js 已安装并重启 Pad 隔离库，合成拖动实测可执行。下一步第一动作：用户在当前隔离 Pad 真实拖动卡片并反馈是否跟手；仍卡则采集物理手势 trace。双指缩放的真实卡顿依旧未关闭，A30 父卡未关闭。

Pad 选中卡片卡顿继续修复（2026-11-04）：用户实测指出选中时仍卡。自动点选采样得到 2 次布局、35ms 总任务；该合成样本不能说明真实触摸流畅。代码复核发现默认双向联动每次选卡均调用布局更新和当前笔记本同步；现仅在阅读器未显示时更新布局，目标笔记本已是当前笔记本时跳过重复切换与同步，保留文档打开/原文定位语义。曾尝试复用 activeReader，但联动测试发现改变打开语义，已撤回。另禁止拖动中的 transform 过渡并新增触摸断言。完整 npm run verify 最终退出 0（Reader 213/213、Workspace 285/285），最新 main.js/styles.css 已安装并重启 Pad 隔离库。用户上一轮反馈针对旧版，最新选中与拖动的物理手感仍需验证，不宣称卡顿已解决；A30/Pad 专项未关闭。下一步第一动作：在当前版本真实点选并拖动卡片，若仍卡需采集用户手势期间 trace，区分源文档定位、绘制和系统输入。

Pad 拖动松手闪回修复（2026-11-04）：用户反馈松手后卡片先回原位置再瞬移。原因是清除 transform 预览时尚未把 DOM 坐标设为目标值；现先写入最终 left/top 再清除 transform 并保存。新增触摸松手前后矩形差小于 1px 断言，完整 npm run verify 退出 0（Reader 213/213、Workspace 285/285）。已构建并安装 Pad 隔离库、重启；尚需用户真实拖动确认闪回与手感，A30/Pad 专项仍未关闭。

Pad 已选卡片纵向拖动排查（2026-11-04）：用户反馈选中后上下拖动仍卡。相同 Pad 合成拖动选中态 LayoutCount 43，未选中态此前约 1；尝试预缓存相连边几何并在拖动时临时隐藏操作栏，复测仍 42，说明二者不是已确认根因，不得宣称根治。20 步纵向合成 trace：Layerize 43 次合计25.5ms、UpdateLayoutTree 16次12.0ms、Paint 34次10.9ms、Layout 14次1.8ms；仅合成输入，不代表实际手感。上述候选已构建安装隔离 Pad，完整 npm run verify 退出 0（Reader 213/213、Workspace 285/285）。用户物理卡顿尚未解决，A30/Pad 专项未关闭。下一步第一动作：检查选中态真实卡片 DOM 和宿主渲染层为何触发逐帧 layerize/paint，做有/无底部 backdrop-filter 的隔离对照，针对结果修复；不要再要求用户反复试未经量化的候选。

## 2026-11-04 迁入 edict 交接完成

交接包 `handoff-to-edict/` 已完成，`verify-handoff.sh` 机械验收 12 项全部 PASS；收尾完整 `npm run verify` 退出 0，Workspace 285/285、Reader 213/213。Git 基线 tag 为 `handoff-20261104`，bundle 已复核。edict 侧 8 席 SOUL 与 agents.json 改动已形成 `patches/edict-margin-local.patch`，未运行 install.sh。切换后旧 IDE 仅保留查证据与答问，不再接开发任务；src 写操作只能经 edict 兵部的 Codex 包装器，禁止双写。A30、Pad 及其他未关闭项仍按 `handoff-to-edict/ASSERTIONS.csv` 保留，不因交接完成而写成通过。

Pad 连续拖动补验（2026-11-04）：第一次拖动结束后的延迟刷新可能在第二次拖动中替换节点；已在拖动期间延后脑图重绘并增加连续第二次拖动中强制刷新断言。完整 npm run verify 退出 0（Reader 213/213、Workspace 285/285），构建安装 Pad 隔离库。重新启动后以 CDP 连续执行两次触摸拖动，节点中心第一次从 x=1073.29 移至 x=1146.79，第二次亦完成；每次合成采样仍约 42 次布局，不能证明物理手感流畅或问题根治。A30 和 Pad 专项保持未关闭；下一步需真实连续拖动检查，若卡顿仍存，采集真实手势系统帧轨迹。当前设备在隔离学习集 A30-OPPO。

Pad 二次选中拖动补充（2026-11-04）：用户明确复现顺序是选中、拖动、取消选中、重新选中、再拖动后卡顿。已将该顺序加入 workspace 触摸行为测试，285/285 通过；此测试只验证事件和坐标，不测物理帧率，尚未复现卡顿。此前延迟刷新修复已安装，用户确认仍卡，故不能关闭或宣称解决。下一步应在隔离 Pad 真实触摸该顺序时采集事件时间及渲染轨迹，关联实际卡片内容和选中状态，定位延迟来源后修复；本次只改测试，未重新安装。

Pad 真实手势追踪修复（2026-11-04）：用户复现后采集到 12588 条 trace，pointerup 两次耗时约 232ms / 239ms，后续定时刷新约 109–122ms。拖动松手原先通过通用事务两次复制全部数据和标注；现节点移动采用坐标差值历史，保留撤销/重做，避免每次移动全量快照。完整 npm run verify 退出 0（Reader 213/213、Workspace 285/285），已构建并推送 Pad 隔离库并重启。真实手势性能和二次选中后的手感仍待测，后续刷新耗时也尚待分析；禁止宣称完全解决，A30/Pad 专项未关闭。

Pad 真实操作第二次性能跟踪（2026-11-04）：采集 16522 条事件，修复节点移动快照后主要长任务转为主插件 store 订阅定时刷新（约 97–119ms）；主插件此前连续调用 refreshSidebar 和 refreshMindmap，而两者均刷新 StudyWorkspace，此外 StudyWorkspace 自己也订阅 store，造成重复刷新。现主插件定时回调只刷新独立侧栏和独立脑图，StudyWorkspace 保留自身订阅。完整 npm run verify 全通过（Reader 213/213、Workspace 285/285），已推送新 main.js 到 Pad 隔离库并重启。仍需确认重新选中拖动的真实手感与最终帧耗时，A30 未关闭。

A30 验收裁定（2026-11-04）：用户明确裁定双指缩放、触控笔与掌触按完成记录，并决定 Pad 卡片二次选中后拖动的剩余卡顿后续再修，要求先记录通过。按用户验收裁定关闭 A30；该状态是有遗留问题的接受，不代表上述触控项逐项实测通过，也不代表拖动卡顿已修复。保留独立遗留问题：Pad 取消选中后重新选中卡片再拖动仍卡；最新候选已安装，需后续实际复测和继续排查。桌面对照为等价样本非原件；P1/P3/P4 原参考未采集的事实保持不变。

## 2026-11-05 23:56
- 完成：A11 收尾完成并提交，进入 B 路线剩余项
- 结论：结论：A11 已提交 de2e02a；完整 verify 27/27、Workspace 288/288、Reader 214/214；未做 Obsidian/Pad 实机验收
- 下一步第一动作：在新会话里执行 ctx brief --write 后继续 A30：先处理 Pad 触控（物理双指卡顿、笔/掌触）再补 P1/P3/P4
- [ ] [ ] A30 Pad 物理双指缩放卡顿未解决
- [ ] [ ] A30 P1 缩放/P3 大纲开态/P4 深浅色未验
- [ ] [ ] Pi Web 独立实例（MODE=safari）后需确认 Dock Chrome 归位

## 2026-11-06 00:07
- 完成：卡片颜色统一16色并安装隔离库
- 结论：结论：提交 afa80b9；卡片详情/批量/看板/脑图均16色写入colorIndex；验证27/27（Workspace 288/288、Reader 214/214）；main.js 054d5bc5 已装隔离库
- 下一步第一动作：重载隔离 Obsidian 确认卡片颜色显示16个，再继续 A30 Pad 触控
- [ ] [ ] 用户实机确认16色与复习副本可点
- [ ] [ ] A30 Pad 物理双指缩放卡顿未解决
- [ ] [ ] P1/P3/P4 未验


## 2026-11-06 00:52（验收端 · cua-driver 实机比照）
- 完成：16 色四入口（卡片详情/批量设颜色/看板/脑图）实机逐项取样通过；复习副本展开与 `复习记录` 弹窗可点通过
- 结论：结论：`054d5bc5` 构建在隔离库真实 GUI 中 4 个入口各 16 色，取样 RGB 与 CARD_COLORS 全项一致（最大 ΔRGB=7）；复习副本组 4 勾选项 + 9 动作存在且可点，实点 `复习记录` 弹出“逐次复习记录”。P4 **不通过**：插件 `界面主题=暗色` 时 A30 主页与工作区仍为浅色（styles.css 暗色选择器不含 .ms-study-workspace/主页），"深色外观已验证"不成立。P3 插件侧大纲开态三分区已实测（文档 0–777 | 脑图 778–1070 | Outline 1106–1450），MN5 侧无“大纲”入口（卡片/复习/脑图菜单与 AX 均无），开态参考仍缺。P1 仍缺 MN5 精确百分比（MN5 显示菜单仅有进入全屏幕，无缩放读数，cua-driver 无捏合输入）。Pad 双指因 `adb devices` 为空无法验收。
- 证据：evidence/acceptance-20261106/RESULT.md 与 12 张真实窗口截图
- 现场恢复：插件主题回 `亮色`、Obsidian 基础颜色回 `跟随系统`；未写卡片数据、未改代码、未提交
- 下一步第一动作：由 Codex 修 A30 深色外观（把 .ms-study-workspace 与学习主页纳入 ms-theme-dark 配色）并在隔离宿主重载复验；P1/P3 需 Hermes 侧补 MN5 缩放百分比与大纲开态参考后再判
- [ ] [ ] A30 P4 深色外观（A30 界面无深色，实测不通过）
- [ ] [ ] A30 P1 缩放百分比（缺 MN5 参考）、P3 大纲开态（缺 MN5 参考）
- [ ] [ ] A30 Pad 物理双指缩放（adb 无设备，待用户连接 OPD2409）

## 2026-11-06（A30 P4 深色实现）
- 完成：补齐暗色主页、工作区、脑图、文档容器与大纲面板样式；卡片详情未选中色块增加描边。保留上述验收端原结论，不改变 P1/P3/Pad 判定。
- 验证：真实隔离 Obsidian 使用暗色设置重启后，主页与工作区/大纲截图位于 `evidence/implementation-20261106-a30-dark/`；最终 Chromium 计算样式断言要求主页和工作区背景 RGB 每分量小于 100 且不同于亮色，并检查主页侧栏、卡片、封面、脑图、节点、文档容器、底部胶囊和大纲标题。`npm run verify` 27/27 套件通过，Workspace 289/289、Reader 214/214，包含 A30 三视口自动检查。
- 主页截图同一背景采样点 (700,500)：亮色 RGB (249,249,249)，暗色 RGB (29,31,38)；亮色截图为同宿主本轮最终小幅暗色修订前的画面，暗色截图为最终安装构建。
- 安装：构建的 `main.js` 与 `styles.css` 已复制到隔离库插件目录，main.js SHA-256 `054d5bc5f8f633a48f49df7dfe4534a1fa2df91ccb1d01a62c05b818e9cf4b76`；原插件文件备份在 `/tmp/marginstudy-a30-before-20261106/`。
- 数据：实机验证后关闭隔离 Obsidian，`data.json` 从验证前备份逐字节恢复并用 cmp 通过，主题当前为 `light`。最终样式的大纲标题经实机截图和浏览器计算样式检查；其他阅读配色组合未逐一实机验收。
- 下一步第一动作：如需再次查看，打开隔离库，在插件设置切换暗色；Pad 物理双指以及 P1/P3 仍按验收端既有记录另行处理。

## 2026-11-06 01:32（验收端复验 · P4 深色）
- 完成：兵部实现 P4 深色后，验收端在隔离宿主独立复验
- 结论：结论：插件 `界面主题=暗色` 时主页/工作区/大纲均实际变深色，8 个取样点浅→深色差 >190 色阶（如主页背景 (249,249,249)→(29,31,38)，脑图画布 (255,255,255)→(29,31,38)）；`styles.css` 37db1c73 仓库与隔离库一致；兵部报告 verify 27/27（Workspace 289/289、Reader 214/214）。A30-P4 的“深色外观”半句成立并登记为 P4-DARK-01=pass；“其他场景模板”与自定义节点色对比度未验，A30-P4-01 仍不整条通过。现场已把插件主题切回 `亮色`。
- 证据：evidence/acceptance-20261106/RESULT.md §9 与 5 张复验截图（P4复验-*）
- 下一步第一动作：等用户明天把 OPPO（OPD2409）接上后做 Pad 物理双指（PAD-PINCH-01）与笔/掌触；P1/P3 仍需 MN5 参考
- [ ] [ ] A30 Pad 物理双指缩放（待设备连接）
- [ ] [ ] A30 P1 缩放百分比 / P3 大纲开态（缺 MN5 参考）
- [ ] [ ] A30 P4 其他场景模板与自定义节点色深色对比度（未验）

## 2026-11-06（P4 深色外观返工）
- 完成：补深色交互态、主色和低对比度文字；白色阅读主题转换深色纸面，sepia/green 保留自身纸面、画布和边框。收紧透明度、按下态、工具栏、资料库和文字对比度断言，结束时恢复主题设置。
- 验证：隔离副本使用原样式和最终断言，等待动画结束后按下态以 `rgb(201, 201, 203)` 失败；修后完整 `npm run verify` 27/27 套件通过，Workspace 289/289、Reader 214/214。记录与各项对比度见 `evidence/p4-dark-rework-20261106/RESULT.md`；阅读配色组合为合成 Chromium 检查，未逐项真实宿主复验。
- 安装：隔离库 `styles.css` SHA-256 `28530c1aaf3eb43515acd71922a26b5cfa0836472c5577a0a4bfb27516dc23cc`；`main.js` 未变。回退样式位于 `/private/tmp/marginstudy-p4-rollback-20261106/styles.css`。

## 2026-11-06（P4-DARK-03 节点对比度）
- 完成：彩色脑图标题和菜单根据颜色计算前景色；正文按实际纸面配色，保留卡片外观和 16 色值。修复工作区对彩色标题的覆盖。
- 验证：新增真实渲染节点的浅色、暗色和自选色对比度断言，修前 289/290、修后 290/290；修前失败记录 `/private/tmp/p4-contrast-before/workspace.log`，完整修后记录 `/private/tmp/p4-contrast-final/`。`npm run verify` 27/27 套件通过，Reader 214/214。
- 安装：隔离库 `main.js` SHA-256 `2b51e886cb3047393a1a2417053e70d310004ee93ae266bd6d3857ff1c804302`，`styles.css` SHA-256 `5f1559568d38bb20fa8f350436a39f293201b98ce61e3adc7f6871e095f033bd`，与构建文件一致。
- 下一步第一动作：验收端重载隔离宿主复验 P4-DARK-03；本次未做真实宿主视觉复验，未提交。

## 2026-11-06（MN5 大纲与暗色外壳）
- 完成：脑图菜单增加大纲入口；沉浸式大纲在脑图区右侧按 472/753 比例覆盖，传统界面覆盖整块脑图区，关闭恢复原布局。暗色外壳与 Sepia/Green 纸面分离，保留阅读纸面颜色。
- 改前：工作区验收 289/291，Sepia 顶栏为 `rgb(245, 239, 223)`，沉浸式大纲宽 342、距右 67，均不符合新断言；记录 `/private/tmp/marginstudy-outline-dark-before.log`。此前 Green 实机结果见 `evidence/acceptance-20261106/RESULT.md` §14。
- 改后：首轮工作区 291/291；完整验收 27 套件、Reader 214/214、Workspace 291/291。末轮补充两栏数量断言后复验结果保存在 `/private/tmp/marginstudy-outline-dark-final/`。验收使用合成宿主和 Chromium，未对最终安装版本进行真实 Obsidian 像素复验。
- 安装：隔离库 `main.js` SHA-256 `3026fea5917c4bd444863ebd74f9d142594eb471b9ed9fe644e0ac50008e53dc`；`styles.css` SHA-256 `c0d0f85f3d7cb9bc95efbb39160e7e72c091febfb80ec4da6b5029935311b0a4`。隔离库设置为 `light` + `white`。

## 2026-11-06（CC 终验 · MN5 对齐后）
- 完成：只读实机复验 6 项；安装构建 hashes 与卡面一致（main.js `3026fea5…`、styles.css `c0d0f85f…`）。报告 `evidence/acceptance-20261106/CC-FINAL-RESULT.md`，截图 `CC-FINAL-01…06` 共 6 张。
- 结论：第 2–6 项 pass（传统界面整栏替换、Sepia/Green 暗色外壳与纸面、节点白字 5.05:1、亮色同点无回退）。第 1 项 fail：沉浸式大纲宽 450.43=718.59×472/753、两栏与关闭恢复均通过，但右缘距窗口 **9px**，不满足卡面 ≤4px（CSS 明写 `right:9px`，需规划席确认口径）。
- 限制：大纲入口为脑图右侧工具栏「大纲」按钮（脑图下拉无此项）；传统界面无 UI 入口/快捷键，用 store.setStudyInterface 临时切换并已恢复 `scenes`；界面主题经设置窗口 select 的 change 事件切换。
- 现场恢复：`light` + `white`、大纲关闭、interfaceMode=`scenes`；未改产品代码、未改旧 evidence、未提交。

## 2026-11-06（A30-TRAD-ENTRY-01）
- 完成：注册「切换界面模式」命令及 `Cmd+Alt+I` 默认快捷键，加入功能搜索和学习集更多设置；切换当前学习集的场景/传统界面，刷新工作区并持久化。
- 改前：新增工作区行为断言 291/292，因命令未注册失败；记录 `/private/tmp/marginstudy-trad-before/workspace.log`。改后：工作区 292/292，覆盖命令、快捷键映射、搜索、菜单、往返与重建；完整 `npm run verify` 27/27，Reader 214/214、功能搜索 10/10；记录 `/private/tmp/marginstudy-trad-complete/`。验收为合成宿主和 Chromium，未对安装后的真实 Obsidian 执行快捷键复验。
- 安装：隔离库 `main.js` SHA-256 `826086f7a50b34955b18f1d0f0331a1e6ddc2003b309a093daac922b08840dd0`，`styles.css` SHA-256 `c0d0f85f3d7cb9bc95efbb39160e7e72c091febfb80ec4da6b5029935311b0a4`；与构建文件一致。未提交，未修改 `evidence/**`，未操作 Pad 双指。

## 2026-11-06 14:33 证据目录被覆盖事故（登记）
- 事实：兵部本轮首次启动工作区验收时未指定临时输出目录，运行器把 14 个套件日志写入 `evidence/verification/`（build/decks/mobile-sha256/model-additive/model-l3/organize-ui/pdf-save/pending/review-ui/review/study-observed-ui/study-ui/study/typecheck，时间 14:16–14:17），覆盖了 2026-11-05 A11 收尾同名的逐套件日志。兵部发现后中止，未备份，无法还原原件。
- 存活：`evidence/verification/results.json`、`workspace.log`、`reader.log` 仍是 11-05 原件；更早的含日期目录（10-17 / 10-23 / 11-05）未受影响。
- 影响：A11 的证据链以 `results.json` 为主仍成立；但同名逐套件日志已不对应 A11 那次运行，不得再引用它们作为 A11 证据。
- 后续：所有 verify 必须显式给 `MARGINSTUDY_VERIFY_DIR`（临时目录），并加脚本级护栏防止再写入 `evidence/`。
## 2026-11-06（工作区移除自造浮动入口）

- 完成：移除固定视图图钉、脑图右栏与 Select 胶囊；固定视图进入「学习集更多设置」，脑图下拉提供大纲、看板、多选及工具二级菜单。整理工具栏及旧工具弹窗不再提供多选入口，`⌥⌘M` 切换多选。保留顶部胶囊、两个 immersive 圆钮和场景标签。
- 改前实测沿用上一卡 `25ca5bf7…` 构建：场景下图钉 `(1455,97,38,38)`、rail `(1445,223.59,48,275)`、Select `(1444,548.59,49,49)`；六个 rail 图标中心命中自身，详细记录见本文件下一节。三个元素存在，违反本卡不存在断言。
- 改后最终构建实测：三个选择器数量均为 0，故无 rect；旧图钉中心 `(1474,116)` 命中 `ms-mindmap-root`，旧 rail 区 `(1469,241)` 和 Select 中心 `(1468.5,573)` 命中 `ms-mindmap-world`。脑图内容右界 `1497.40625`，滚动条宽 `15`，滚动条 `(1504,502)` 命中 `ms-mindmap`。两个保留圆钮 rect 分别为 `(1386,376.5,44,44)`、`(1386,432.5,44,44)`，中心均命中自身；圆钮坐标测于本轮第一次安装，最终构建未改其样式或位置。
- 菜单实机：学习集更多设置里的固定视图打开原面板；脑图下拉的大纲、看板分别打开对应面板，多选显示「已选 0 张卡片」工具栏，`⌥⌘M` 关闭多选；工具二级菜单包含手形、复制与粘贴、连接卡片、脑图手写，手写进入画笔后手形可退出。整理工具栏实机已无「选择」。
- 验证：`MARGINSTUDY_VERIFY_DIR=/tmp/marginstudy-mn5-final2 npm run verify` 全部 27 套通过；工作区 295/295、阅读器 214/214、脑图手写 13/13、整理界面 27/27。修正卡片流验收默认输出路径，防止写入 `evidence/`。完整日志 `/tmp/marginstudy-mn5-final2/`。
- 安装并重载隔离库：`main.js` SHA-256 `f556b9f53f24eac0080cf55d462323fb8b73c974f360151985402cef43dcf105`，`styles.css` SHA-256 `ad344a0f16c0f8749b333928cd0892418a69532e2649d5896daf072b663cd44d`。现场为 `light`、`white`、`scenes`、摘录场景。
- MN5 无对应登记：画布固定视图图钉、整列脑图工具、Select 胶囊、插件的固定视图功能及本次工具二级菜单。当前插件宿主没有 MN5 独立的系统菜单栏「脑图」，上述功能位于已有的「脑图」下拉；工具菜单以点击打开第二级菜单实现。

## 2026-11-06（immersive 快捷入口右距）

- 完成：浮动入口右距由 82px 调整为 16px；更新四种视口的旧参考坐标，增加场景与传统界面的两按钮宽度、右距及移除控件断言。
- 验证：`MARGINSTUDY_VERIFY_DIR=/tmp/marginstudy-float-20261106-final2 npm run verify` 27/27 套件通过，工作区 295/295、阅读器 214/214。Chromium 1512×855 实测两按钮分别为 `(1452,376.5,44,44)`、`(1452,432.5,44,44)`；此坐标来自前一次运行中仅因旧参考值失败的日志 `/tmp/marginstudy-float-20261106-final/workspace.log`。真实宿主重载后截图可见两按钮移至右侧，场景界面仍在；未重新实测真实宿主两模式的精确滚动条宽度与坐标，上一卡实测内容右界 1497.40625、滚动条 15px。
- 安装：隔离库 `main.js` SHA-256 `f556b9f53f24eac0080cf55d462323fb8b73c974f360151985402cef43dcf105`，`styles.css` SHA-256 `5d1a64e887a47505c9f09aad562b2692a94061297290f6316d34a5d1bf68a3fd`；安装文件与构建文件一致。设置为 `light`、`white`，现场为 `scenes`。未提交、未修改 `evidence/`。
- 未完成：真实宿主场景/传统双模式精确坐标、内容右界及滚动条宽度复测；下一步第一动作是在隔离 Obsidian 使用可用的几何读取通道逐模式测量并恢复 `scenes`。

## 2026-11-06 17:10 A30 B 范围收口（桌面侧）
- 完成：A30-HOME-01 / A30-P1-01 / A30-P4-01 三项收口；A30 的桌面部分至此不再有待办
- 结论：结论：主页参考屏口径澄清后所有锚点 Δ=0（Hermes），插件主页锚点 Δ≤4px、行距 235、标题行 Δ=0（CC）；P1 双方都无百分比读数（MN5 穷举无读数，插件仅有隐藏 DOM `110%`）；P4 三套场景模板暗色+Gray/Dark 纸面+16 色实机对比度（最小 5.046:1）全部通过
- 证据：evidence/acceptance-20261106/{HERMES-HOME-REF-RESULT.md, CC-A30-CLOSE-RESULT.md, RESULT.md §17}
- 下一步第一动作：等用户接上 OPPO（OPD2409）后跑 Pad 六项（PAD-PINCH/DRAG/PEN/ADD/LAYOUT、A30-OPPO-01）；桌面侧下一张是 A05 补完（JSON 导入导出、笔盒、摘录颜色）
- [ ] [ ] Pad 六项（需真机）
- [ ] [ ] A05 剩余：JSON 文件选择器、笔盒与摘录颜色、导入导出闭环
- [ ] [ ] 路线 B 步骤 1（A01/A02/A03）与 A04 转正

## 2026-11-06（PAD-LAYOUT-01 自动布局）
- 完成：自动布局按节点 DOM 实测宽高与固定 40px 间距排布，多根按子树高度纵向堆叠，折叠后代纳入布局；保持原方向分支和单次 `updateNodes` 事务。无法测量节点时提示并不写入坐标。
- 复算：合成节点宽 230px、高 76/94/183px，`right` 下双根、混合高节点、折叠后代、深层三根的改前重叠分别为 3 对/22800、2 对/22090、1 对/7600、8 对/60800 世界 px²；改后均 0 对/0。`down` 改前分别为 0/0、1/12190、0/0、0/0，折叠后代未移动；改后均 0/0 且后代移动。两方向均通过坐标确定性、根节点基线、方向和真实 Store 一次撤销断言。改前记录 `/tmp/marginstudy-pad-layout-before.log`，改后记录 `/tmp/marginstudy-pad-layout-20261106-release/mindmap-layout.log`。这是合成尺寸复算，未对安装后的 Pad 实际画面验收。
- 验证：`MARGINSTUDY_VERIFY_DIR=/tmp/marginstudy-pad-layout-20261106-release npm run verify` 28/28 套通过，Reader 214/214、Workspace 295/295；修正四套旧验收脚本的结果输出位置，避免覆盖仓库已有验收记录。
- 安装：桌面与 Pad 隔离库 `main.js` SHA-256 均为 `6e27f7ad5b211a18e9a2ea08547dae10bd1b892c4b350f25131e159497274e67`，`styles.css` 均为 `5d1a64e887a47505c9f09aad562b2692a94061297290f6316d34a5d1bf68a3fd`。未重启 ADB server、未改卡片数据、未提交。

## 2026-11-06（PAD-PINCH 根因定位 · Hermes 实机）
- 完成：四问定位。50Hz 非 app/插件造成，而是设备"内容静止即降频"的面板策略：静止 50Hz（rAF 19.97ms/50.07fps，Obsidian 脑图、Obsidian 主页、Chrome 三个场景逐位相同）→ 真实触摸后 144Hz（rAF 6.95ms/143.98fps，1296 帧）；触摸到 144Hz 需 130ms，松手 0.6–0.9s 回 50Hz，手指按着但画面不动约 6s 也回 50Hz，按住且每帧改像素则 26 次采样保持 144Hz。
- 帧率决策点：DisplayModeDirector 全部票权 0–144、activeMode=7，SF `FrameRateOverrides=none`/`Override: off`、md.obsidian 层 `requestedFrameRate 0.00 Hz NoPreference`、`refreshRateOverride 0.0`，但 SF 实际 `activeMode id=3 / renderRate=50.00Hz`；`cmd display set-user-preferred-display-mode 2400 3392 144.00002` 被 DM 接受仍降 50 → 决策在 DM 之下（DPPS/自刷新 + `persist.sys.hans.skipframe.*`）。
- 每帧开销：trace 3.89s/171 帧，主线程 BeginMainFrame mean 3.46ms、p90 8.30、max 16.08（19.3% 超 144Hz 预算）；Recalculate Style 53 次/21.7ms、Layout 47 次/31.8ms、Paint 215 次/57.7ms；`.ms-mindmap` 单帧重绘 49.5M px²（视口 6.08 倍）；RasterTask 260 个按 tile 增量 0.82ms/帧（非瓶颈）；zoomAt 0.49ms/帧，144Hz 下逐帧 zoomAt 140 帧 6.94ms、0 帧 >8ms。
- 代码：双指路径 rAF 合帧（mindmapRenderer.ts:762-777），无 render()、无时间节流；但每帧 `getBoundingClientRect`+`offsetWidth` 强制回流（:842/897-898），`positionNodeToolbar` write→read(offsetWidth)→write（:636-638/652-653）。
- 证据：`evidence/acceptance-20261106/HERMES-PINCH-ROOT-RESULT.md` + `pinch-root-*`（trace gz 1.49MB、6 组 rAF、SF/display 提取、ramp、144Hz zoomloop、设置快照、安装件 md5 8efef8d7…）。
- 未完成/阻塞：收尾时设备 adb 掉线（`adb devices` 空、无 USB 条目），按铁律未重启 adb；`forward tcp:9333/tcp:9334` 仍注册在本地 adb server，设备回连后需 `adb forward --remove`；脑图缩放未复位到 1.0；未做真实双指捏合（无 root/`input` 不支持多指，CDP 合成触摸在真实触摸流中被丢弃）的显示模式直测。

## 2026-11-06（PAD-PINCH 帧开销优化 · 未完成）
- 已加入双指开始时的 `is-pinching` 类和 `will-change: transform`，在结束及清理时移除。尚未验证是否实际减少绘制面积。
- 尚未完成：手势几何缓存、工具栏 transform 定位、画布尺寸延迟落定、120 帧读取和写入计数、固定输入零容差等价回放、两端安装及 SHA-256。现有代码仍逐帧读取几何并写入世界尺寸，不能视作完成优化。
- 验证：首次沙箱内运行在 study-ui 因本机监听 `EPERM` 中止；沙箱外以 `MARGINSTUDY_VERIFY_DIR=/tmp/marginstudy-pinch-20261106-full` 重跑通过全部套件，Workspace 295/295，Reader 214/214。未覆盖本卡新增的三项专项断言。
- 设备：沙箱外 `adb devices` 和 `adb devices -l` 均无设备，`system_profiler SPUSBDataType` 无输出；未执行 `adb kill-server`。Pad 安装需要设备重新连接。
- 下一步第一动作：在 `src/workspace/acceptance-fixture.txt` 增加固定触摸回放及几何读写计数，先记录原路径结果，再实现缓存并逐项验证；最后构建并安装两端。

## 2026-11-06（PAD-PINCH 续做 · 链路掉线）
- 链路掉线：沙箱内 `adb devices` 因本机监听权限失败；按现有授权在沙箱外重试一次，返回设备列表为空。未执行 `kill-server` 或 `start-server`。
- 本轮仅检查现有实现和设备状态；四项优化、改前改后断言、构建及两端安装均未完成，未修改卡片数据或 `evidence/`。
- 恢复后第一动作：确认设备 `9885dd6f` 在线，随后按上一节的固定输入回放方案记录改前数据，再实施优化、验证并安装。

## 2026-11-06（PAD-PINCH 第三轮 · 本机基线未完成）
- 本轮遵守不调用 adb、不安装、不修改 `evidence/**` 和卡片数据。`src/workspace/acceptance-fixture.txt` 加入 120 帧触摸回放，改前记录 `/tmp/marginstudy-pinch-baseline4/workspace.log`：读取 rect 603、offsetWidth 249、offsetHeight 9，共 861；最终 scale 1.45031、scrollLeft 695、scrollTop 633。
- 基线局限：测试中的点击未选中卡片，工具栏 rect 全为 0，不能用于工具栏等价验收；样式计数目前只比较每帧属性值变化，不能检测重复写入相同值，不能作为 world 写入断言。测试目前故意失败，工作区验收 295/296。
- 完整命令 `MARGINSTUDY_VERIFY_DIR=/tmp/marginstudy-pinch-full-baseline npm run verify` 运行至工作区时因上述专项失败停止，先前执行的套件通过；不是全绿。构建 SHA-256：main.js `b8a58f86c06048be1280424098d940b7db017307dcab05b3940d9dde7c5cb576`，styles.css `f0278a70fa8e93705514e59c473cdaec23468bbd8513423c6889e223818fe79d`。
- 尚未实施几何缓存、仅 transform 写入、contain 或零漂移，也未获得改后数据或 Paint 面积；不得视为完成。`npm run build` 成功，本轮无设备测量。
- 下一步第一动作：修正回放，使选中节点和工具栏可见，使用可记录同值写入的方式统计每个 world 样式写入，并固定多组包含边界夹取的逐帧输入；先保存完整基线，再实施优化与零容差比对。

## 2026-11-06（捏合性能第四轮 · 未完成）
- 已实现双指开始缓存几何并预备画布、帧内 transform 和滚动更新、结束时恢复尺寸和工具栏；未加入 `contain: paint`。
- 固定回放改前读数 861；改后全局读数 381（rect 363、offsetWidth 9、offsetHeight 9），未达 ≤3。最终值改前与改后均为 scale 1.45031、scrollLeft 695、scrollTop 633。
- 实际样式赋值监测改后发现 width、height、left、top、transform 均有写入，未通过。堆栈表明阅读器异步加载触发 `refreshSidebar` → `render` → `applyView`；额外 rect 读取包括 `ReadingPositionTracker.measurable`。等待初始化及重复回放后仍复现；暂未扩大本卡范围修改阅读器或刷新机制。
- 完整验证 `/tmp/marginstudy-pinch-round4-verify-full` 至 workspace 失败，295/296；其余后续独立套件单独运行通过。专项断言与完整 verify 均未通过。
- 下一步第一动作：判断如何在不扩大任务范围的前提下处理阅读位置跟踪和异步刷新；对相同稳定输入重测改前和改后全局读取与赋值，之后重跑完整验证。
- 构建产物 SHA-256：main.js `49ab19f1b99de6f721c14924d8e652ff9d710995050a26b899576bcac42fc063`，styles.css `f0278a70fa8e93705514e59c473cdaec23468bbd8513423c6889e223818fe79d`。

## 2026-11-06（捏合性能第五轮 · 完成）
- 收窄测试计数到触摸移动安排的动画帧回调；排除阅读位置跟踪、文档加载后触发的脑图刷新，未修改这两条路径。逐帧断言 120 帧均为几何读取 0、world 尺寸和位置写入 0、transform 写入 1；累计分别为 0、0、120。累计读取断言上限为 2，计数窗口不包含手势起止。
- 固定输入回放最终值保持 scale `1.45031`、scrollLeft `695`、scrollTop `633`。完整验证 `MARGINSTUDY_VERIFY_DIR=/tmp/marginstudy-pinch-round5-full npm run verify` 全部通过，workspace 296/296，reader 214/214；日志保存在该目录。
- 构建 SHA-256：main.js `49ab19f1b99de6f721c14924d8e652ff9d710995050a26b899576bcac42fc063`，styles.css `f0278a70fa8e93705514e59c473cdaec23468bbd8513423c6889e223818fe79d`。
- 本轮未改善或重新实测 50Hz 静止和 130ms 起手现象；未触碰 adb、安装、卡片数据及 `evidence/**`。

## 2026-11-06 21:45 捏合性能优化生效（实机对比）
- 完成：捏合帧内去强制回流后，实机 trace 对比完成
- 结论：结论：超 6.94ms 帧 19.3%(33/171) → 1.7%(3/174)/1.1%(2/174)，真实 144Hz 捏合 0/220 超预算（约 4ms 余量）；Layout 47→3；Paint 每帧耗时 0.269→0.168ms、RasterTask 139.9→10.0ms。副作用：prepareGestureSurface 使每帧重绘面积 4.90×→6.09× 视口（+24.2%），但净收益为正；「12× 画布⇒12× 重绘」被证伪
- 证据：evidence/acceptance-20261106/HERMES-PINCH-RETEST.md、RESULT.md §19
- 下一步第一动作：请用户在 Pad 上真实双指复测手感；若仍卡，下一步测「起手 130ms 期间」的帧序列与是否需要减少首帧工作量
- [ ] [ ] PAD-PINCH-01 物理手感（用户复测）
- [ ] [ ] 可选：把 prepareGestureSurface 的 *6 预撑改小后重测，验证每帧重绘是否回落

## 2026-11-06（二次拖动提交链）
- 落盘窗口从 150ms 改为 800ms trailing；节点移动通知走增量更新；拖动和捏合期间推迟整图重建。hidden、blur、beforeunload、卸载及复习、导出路径触发 flush。
- 合成 Store：100 次移动后 300ms，改前写入 1 次、改后 0 次；改后强制 flush 写入 1 次，重载坐标一致。原要求的「≤2 次」改前也通过；附加的「空闲未满 800ms 不写」断言改前失败、改后通过。
- 同一工作区测试在 HEAD 临时副本中，移动后无重建和手势中不调用 render 两项均失败；改后均通过，手势结束后排队刷新执行。基线 `/tmp/marginstudy-drag2-ui-baseline2/workspace.log`；最终完整验证 `/tmp/marginstudy-drag2-20261106-final5` 全绿，workspace 298/298、reader 214/214。
- 19,201,541 字节合成内存 saveData：改前 15.451ms、改后 16.466ms；不是安卓原生桥或真实库落盘耗时。原报告的 0.1ms 是 save 调度调用，不是落盘耗时；本轮按要求未触碰 adb，未实测改后安卓长任务。
- 构建 SHA-256：main.js `b7a99bf8ce77a938ebd73c725e489697d02b61692fcb893550b654c3d16429b4`；styles.css `f0278a70fa8e93705514e59c473cdaec23468bbd8513423c6889e223818fe79d`。未安装、修改 evidence 或卡片数据、提交。
- 生命周期事件只能启动异步 flush；宿主进程被立即终止或设备断电时无法保证异步写入完成，不能宣称绝对零丢失。

## 2026-11-06（二次拖动卡顿修复复测 · Hermes 实机）
- 完成：同配方 8 组（7×gap350 + 1×gap90，144 Hz 顶帧 6944444 ns）+ 2 组隔离探针，覆盖 `HERMES-DRAG2-RESULT.md` 的同一 5 步配方、同一 5 窗切窗、同一分析器。
- 结论①：P2 的 94 ms 延迟刷新彻底消失——8 组 P2 的 `ws.refresh`=0、`render()`=0、长任务 0；store 监听回调 32→2，`scheduleRefresh` 24→0，拖动内 `render()` 0 次（基线每次 2 次）。
- 结论②：W5 的 60–65 ms 桥接长任务**没有消失**（6/7 组 53.5–62.1 ms，另有多数 122–136 ms；第 7 组单次 186 ms）。隔离探针定性：空闲 0 个长任务 vs 强制一次 `flush()` 出现 6 个（+0.2 128.9、+598 204.5、+803 210.2、+1407 66.4、+1474 137.8、+1971 62.8），与基线 rA 相对其自身 flush 的 +549/+726/+1291/+1349/+1836 同族。即落盘后的原生桥级联；去抖 150→800 ms 把它整体后移 650 ms，从 W3/W4 搬进了 W5。
- 结论③：无退化。W2 mean 1.96–3.11 / p90 2.50–7.30 / 超预算 1–3（基线 3.31–3.47 / 6.67–6.74 / 2）；W5 mean 1.20–1.56 / p90 1.63–4.13 / 0–1（基线 1.18–1.41 / 2.13–2.15 / 0）；P5 mean 0.21–1.11（基线 0.79–0.96）。
- 落盘时序：`moveNode → flush` 800–802 ms（8/8 确定），flush JS 0–0.4 ms 但当刻主线程任务 80.8–150.2 ms；`await flush()` 实测 2034 ms（19.2 MB `data.json`），即 `moveNode →` 磁盘完整落地 ≈2.8 s。
- 附带缺陷：`store.writeRecovery()` 把 `pending-main-*.json` 写进 vault，首次触发 `vault.on("create") → scheduleRefresh()`，实测在 n1 造成拖动中一次整图 render（35.5 + 7.8 ms，`UpdateLayoutTree` 23→29）。建议把 recovery 目录移出 vault 监听或忽略该目录 create。
- 丢数据核查：切后台会调用 `blur`/`visibilitychange` 的 `flush()`（同一毫秒记录）；重开 3 次坐标逐位一致（341.5/342.25 → 复位 211.991/210.073，rev 502→505，`dirty=false`，无冲突）。限制：adb `input keyevent` 送达 ≈0.9 s > 800 ms 去抖，**未能构造「切后台是唯一触发」**的场景；硬杀进程在 move 后 1.85 s 内会丢最后一次移动。
- 证据：`evidence/acceptance-20261106/HERMES-DRAG2-RETEST.md` + `drag2-trace-n1|n2|n3|n4|n5|n6|s1|w0.json`、`drag2-summary-*.json`、`drag2-retest-metrics.json`、`flushprobe-trace-f0|f1.json`、`drag2-harness/` 新增脚本、`drag2-retest-99-final-home.png`。
- 现场：卡片回到基线坐标、`selectedIds=[]`、`viewScale=1`、A30-OPPO 主页、trace 已关闭、无未 flush 编辑；`adb forward` 已移除 `tcp:9333`，原有 `54779/37395` 未动，未 kill/start adb server。

## 2026-11-06（卡片内联图片外置 · 完成）
- 加载检测到大图片后安排保存；每次主数据保存前将超过 64 KiB 的受支持图片 data URL 写入 `_marginstudy-media/`，按 SHA-256 去重并读回校验。保存成功后才同步内存引用；写入或校验失败保留原值，残缺媒体文件可在重试时修复。新图片仍先内联，保存时外置。日志记录迁移引用数、去重后的图片字节数和耗时；备份包含媒体目录。
- 合成样本主数据由 19,573,595 字节降至 1,691 字节；大图 14,680,064 字节，外置耗时 851 ms（本机内存测试）。连续保存文件数和引用不变；模拟写失败保留原 data URL；模拟中断文件可修复；测试桩验证迁移前后图片字节一致，APKG 验证外置图片导出。
- 完整验证 `MARGINSTUDY_VERIFY_DIR=/tmp/marginstudy-media-20261106-final2 npm run verify` 全绿，reader 214/214、workspace 298/298、APKG 9/9。未触碰 adb、安装、真实库或 `evidence/**`。
- 构建 SHA-256：main.js `f1aa1c0187883aee550ea675cc17871a79455e8d00547137158a6d0f5bf5de8d`；styles.css `f0278a70fa8e93705514e59c473cdaec23468bbd8513423c6889e223818fe79d`。
- 实测库 18.33 MB 中单字段 14.1 MB；仅移除此字段预计约 4.23 MB，其余大图片继续外置可再降低。未对真实库测量迁移后大小或安卓性能；其他数据占用可能使实际结果高于 1 MB。无法识别图片类型或无法解码时保留原值。

## 2026-11-07（二次拖动卡顿 · 媒体外置构建最终复测 · Hermes 实机）
- 完成：同一 5 步配方/5 窗/分析器（`analyze_drag2.py` 未改）跑 4 组配方（pA/pB/pC gap350 + pT gap90，144 Hz 顶帧 6944444 ns）+ 3 组 flush 探针（g0 空闲 / g1 落盘 / g2 带字节记账）+ 图片与落盘重开验证。被测构建 `main.js d365268a9fe2c9bd59551689cd580698`（设备实取一致）、`data.json` 9,997 B。
- 结论①：**W5 的 60–65 ms `androidBridge` 长任务消失**——4 组配方全 trace 0 个 >50 ms 主线程任务，最长 30.6/28.7/32.5/10.1 ms 且均属「点空白取消选中」；`androidBridge` 调用单次 ≤1.5 ms（合计 2.3–2.5 ms），基线为 60–190 ms 原生侧阻塞。
- 结论②：**flush 级联消失**——g0 0 个、g1 0 个（最大 6.9 ms）、g2 0 个（最大 4.4 ms）长任务，对照基线 f1 的 6 段 810.6 ms（128.9/204.5/210.2/66.4/137.8/62.8）。落盘 19.2 MB→9.6 KB、2034 ms→28–33 ms（恢复文件 9,593 B + data.json 9,593 B + saveData 7,083 B）。
- 结论③：无功能退化。W2 mean 2.23–2.77（基线 3.31–3.47）；W5 mean 1.88–2.88（基线 1.18–1.41，单帧略贵但 0 长任务、rAF 中位 6.9–7.0 ms）；P2 0.41–0.87、P5 0.60–1.00；拖动内 `render()`/DOM 变更 0（新会话首存除外）。
- 图片：看板 4/4 张加载（1440×3168、1440×3168、1414×804、4096×3072）、详情弹窗 1440×3168、脑图节点 1414×804，均目视确认非空白；`_marginstudy-media/` 3 个文件 sha256 与文件名一致；`data.json` 内联 data URL = 0。
- 落盘：拖动提交 → +802 ms 去抖 → flush 28.4 ms；`Page.reload` 与 `am force-stop`+重启两次均保住 330.25/330.75 与全部图片；随后复位 211.991/210.073，`rev 525`、`dirty=false`、磁盘 9,997 B。
- 残留：①每会话首次落盘因 `writeRecovery` 新建 `pending-main-<writerId>.json` 触发 vault create → refresh 26.4 + render 24.6 ms（pC 复现，落在 W3/W4 之间）；②`studyWorkspace.ts:1568`、`documentNavigation.ts:167` 仍用裸 `card.image`，裸相对路径实测 404/`naturalWidth=0`，这两处列表会显示空白；③恢复目录每会话新增 ~10 KB，另有 3 个迁移前 19.2 MB 旧文件未清。
- 证据：`evidence/acceptance-20261106/HERMES-DRAG2-FINAL.md` + `drag2-trace-pA|pB|pC|pT.json`、`drag2-summary-p*.json`、`drag2-final-compare.json`、`flushprobe2-trace-g0|g1.json`、`flushprobe3-trace-g2.json`、截图 `drag2-final-01..05/99`、`drag2-harness/` 新增脚本。
- 现场：A30-OPPO 学习集库主页、`selectedIds=[]`、`viewScale=1`、trace 已关闭、无未 flush 编辑；`adb forward` 移除 `tcp:9333`，原有 `54779/37395` 未动，未 kill/start adb server；产品代码未改未提交。

## 2026-11-07（媒体外置收尾修复）
- 两处卡片列表原来直接设置相对路径，原实机证据为 404、`naturalWidth=0`；现均通过 `imageUrl()`。合成浏览器验收确认两处 `/_capacitor_file_/` 资源 URL 返回 200 且图片解码。全局搜索没有第三处直接使用 `card.image` 的裸图片路径；其余命中包括标注图片、编辑器和已解析的图片参数。
- 新会话首次主数据恢复文件创建及恢复文件删除均忽略该目录的 vault 事件，普通文件创建仍触发刷新。合成首次落盘断言 `scheduleRefresh=0`、`render=0`；改前实机为刷新 26.4 ms、重建 24.6 ms。
- 异步清理仅处理文件名符合设备生成规则且 JSON 的 `schemaVersion`、`writerId` 一致的 `pending-main` 文件；保留当前副本和最近副本，最多 3 个、合计小于 1 MiB，删除逐个记日志。当前副本即使超过上限也保留；冲突快照、标注恢复及不匹配文件不删除，故目录总量并非无条件受限。
- 合成 10 次会话：3 个主数据恢复文件共 6,520 字节；3 个约 19.2 MB 旧副本清除，另一个非插件文件保留。真实库未操作。
- 专项 workspace 验证 `/tmp/marginstudy-media-closeout-ui` 为 300/300；完整验证 `/tmp/marginstudy-media-closeout-20261107-final2` 全绿，workspace 300/300、reader 214/214、APKG 9/9。
- 构建 SHA-256：main.js `c6ff1a92508555335eb057561a5f41c58cfc1d1db6706404880b27becff726a9`；styles.css `f0278a70fa8e93705514e59c473cdaec23468bbd8513423c6889e223818fe79d`。清理旧大文件需读取及解析其内容，未在设备上测量这一步的耗时。
- 可选 W5 单帧优化本轮未修改；未触碰 adb、安装、真实库、`evidence/**` 或提交。
## 2026-11-07（A05 场景模板删除）
- 个人模板管理增加删除及二次确认；内置模板无删除入口，Store 拒绝内置或不存在的 ID。删除在一次事务中先将所有引用该模板的学习集切回 `standard`，再移除模板；学习集数据保留，界面立即刷新。
- 合成 Store 验收通过：拒绝操作 revision 不变；个人模板删除 revision +1，重开后不存在；活动模板及其他引用模板的学习集切回 `standard`，重开后保持。界面验收覆盖确认、取消、删除和下拉刷新。
- 完整验证 `MARGINSTUDY_VERIFY_DIR=/tmp/marginstudy-a05-delete-20261107-full npm run verify` 全绿，workspace 301/301、reader 214/214；补充重开断言后 Store 专项再次通过。
- 构建 SHA-256：main.js `394a908996b837fca7d29d72a35b7852d94d5204b55e071fb67166bd9855709b`；styles.css `f0278a70fa8e93705514e59c473cdaec23468bbd8513423c6889e223818fe79d`。未触碰 adb、安装、真实库、`evidence/**` 或提交。

## 2026-11-07（Pad 收口批次 · 六项实机验收 · Hermes）
- 被测构建实装 md5 未变：`1fe592922e3ff5d50e7083a142f0ae59` / `3ddc10b56cec6529d937918f0ae71e79`（= HEAD `60792ee`，未改代码、未提交）。
- 结论①：PAD-PINCH-01 合成捏合 0.4%（1/224，8.05ms）与 0.0%（0/222，max 6.47）超 6.94ms，主线程 p90 5.58/5.22、max 8.05/6.47；**物理手感仍待用户复测**。口径：本轮面板空载 60Hz（16.7ms），非基线 50.07Hz，超预算列仍按 6.94ms 同定义。
- 结论②：PAD-DRAG-01 五步配方两轮，W5（二次拖动）**≥50ms 长任务 0 个**（基线外置前 60–65ms），`render()`/`scheduleRefresh` 0 次；W5 单帧 2/24 超 6.94ms（9.04/8.36、8.97/10.02），drag trace 期间面板被顶到 144Hz（6944444 ns）。
- 结论③：新会话首次拖动 + flush 后 100.5ms 再点，`render`/`scheduleRefresh`/`refresh`/DOM 变更全 0，首次 `writeRecovery(pending-main)`（+804ms）不再引发整图重建。
- 结论④：PAD-LAYOUT-01 临时学习集 7 节点（2 根×2 子 + 高卡 230×369.93），自动布局后 21 对矩形交集面积 0（布局前 215,738.5 px²）。
- 结论⑤：PAD-ADD-01 真实菜单路径导入，Notice「已导入 6 个节点」但实际 +8 节点（6 卡 + 2 文档根）；画布数与 `activeCanvasId` 不变（加入当前脑图）；二次导入返回「没有可导入的新卡片（已存在对应节点）」且 0 新增。**文案与节点数口径不一致**，待产品决定是否改文案。
- 结论⑥：A05-01 Pad 通过 —— 复制标准→保存（Notice 模板已保存）→启用→删除并确认→模板消失、scene 回 `standard`、persisted rev 545→547；内置行无删除按钮。
- 新发现（非阻断）：模板编辑器「保存模板」位于 1292×914 首屏之外（y≈1113 > 914，需滚动），不滚动点击会静默点空；启动后默认落在学习首页，首页遮罩会吞掉第一次手势；删除活动学习集后 `activeStudySetId` 变空并被持久化。
- 现场：A30-OPPO 主页、无选中、scale 1、无 trace、临时学习集与临时模板全部删除（sets=1、canvases=2、nodes=5、cards=6、sceneTemplates=0）、`dirty=false`、rev 561、节点坐标复位；`adb forward tcp:9333` 已移除，原有 54779/37395 未动，未 kill/start adb server。
- 证据：`evidence/acceptance-20261106/HERMES-PAD-FINAL.md` + `padfinal-harness/pf_*.mjs`、`pf-trace-pinch-a|b.json`、`pf-pinch-summary-a|b.json`、`drag2-trace-pf-r1|r2.json`、`drag2-summary-pf-r1|r2.json`、`pf-layout-before|after.json`、`pf-add-01-*.json`、`pf-a05-*.json`、`pf-item3-firstdrag.json`、`pf-positions*.json`、截图 `pf-*.png`。
- 下一步第一动作：请用户在 Pad 上做两项物理复测（双指缩放手感、真实手指二次拖动跟手性），并在 `HERMES-PAD-FINAL.md` §7 对应条目回填结论。

## 2026-11-07（Pad 三项 UI 小修）
- 导入 Notice 改为报告实际新增节点数；合成验收覆盖两张卡加两个新根、已有根及重复导入。
- 模板编辑器面板限制在工作区内，保存按钮固定在滚动面板底部；合成验收检查初始位置和滚动后可见、可点。
- 复习列表与文档导航图片保留 `imageUrl()`；既有合成验收检查资源路径、图片解码及 HTTP 200。
- 完整验收 `/tmp/marginstudy-pad-ui-20261107-final` 全通过，Workspace 302/302、Reader 214/214；未对最终版本做 Pad 实机界面复验。
- 已将构建安装到桌面隔离库及 Pad 隔离库，两个文件两端哈希一致：`main.js` SHA-256 `a58fbb505141fb8fe725f18962096119df994dbe4e1619dd975af7a767d1f80d`、MD5 `20e556643fd12b0d4b12a9f9b0a48ae0`；`styles.css` SHA-256 `19d6ac538e602d9b1742af41759547cc42dfaa48a9e09e36f8cc680e01dc2ad4`、MD5 `9fa85ad3172e1ed69816a423a625c577`。未重启 ADB server、修改卡片数据或 `evidence/**`，未提交。

## 2026-11-07（A31 冻结签收核验 · Pad 实机 · Hermes）
- 判定：7 项中 4 项通过（程序回退、媒体五项、模板保存按钮、导入 Notice），2 项不成立，1 项为数据报告。
- 第 1 项：`main.js`/`styles.css` 均为交付构建（设备实取 SHA-256 `a58fbb50…`/`19d6ac53…`），强停重启后 sets 1 / canvases 2 / nodes 5 / cards 6、5 个节点坐标逐位不变，`data.json` 10,684 B（rev 561→562，仅 revision/savedAt 变）；**但两端 `manifest.json` 仍是 `1.2.40`（MD5 `d2739e3c…`），仓库才是 `1.3.0`（`e04518f9…`），插件版本回读 1.2.40** —— 安装只覆盖了 main.js/styles.css。
- 第 2 项：临时学习集内 `a31-n1` 120,120 →(+80/+50)→ 200,170，真实「撤销」按钮点击后精确回到 120,120；**「重做」按钮在撤销后 10.1 s 内（150 ms 采样）始终 `disabled`**，`store.future=1` 却点不动；触发一次工具栏重绘后按钮可用，点击精确回到 200,170。根因：`syncHistoryButtons()` 只刷 `[data-bottom-action]`，scenes 模式场景条的撤销/重做只有 `data-ms-tool`（`studyWorkspace.ts:776/805/814`），回调里也没有 `drawToolbar()`。
- 第 3 项：用 `git archive HEAD` + 同版本 node_modules 复现上一构建（md5 `1fe59292…`、SHA-256 `394a9089…`、5,022,888 B，逐字节一致），推到设备重启后数据原样，再换回 `20e55664…`/`a58fbb50…` 重启复核，数据仍原样。
- 第 4 项：卡片详情 1440×3168、看板 4 张（1440×3168×2、1414×804、4096×3072）、脑图节点 1414×804、复习列表 4 张、文档导航卡片页签 4 张，`naturalWidth` 全 >0 且 `currentSrc` 为 `_capacitor_file_…/_marginstudy-media/<sha256>.jpg`。
- 第 5 项：`_marginstudy-recovery/` 104 MB（106,272 KB）/ 12 文件 / 0 子目录；3 个 `pending-annotations`（36,109,015 + 36,109,055×2 B）占全部体积，`pending-main` 已滚动压到 ~10 KB/份。
- 第 6 项：编辑器 scrollTop 0 时「保存模板」rect [12.76, 847.52, 99.96, 44]，bottom 891.52 ≤ 视口 914 且 ≤ 面板 bottom 897.29，`elementFromPoint` 命中按钮本身。
- 第 7 项：真实菜单导入 Notice「已导入 8 个节点」= 实际 +8（6 卡片节点 + 2 文档根节点），画布数与 `activeCanvasId` 不变；新画布复测同为 8/8。
- 现场：A30-OPPO 学习首页、无选中、scale 1、无 modal/看板/书页查找面板、无 trace、无临时学习集/模板/卡组（sets 1、canvases 2、nodes 5、cards 6、decks 0、templates 0）；`data.json` 10,681 B、rev 593；与开工前逐字段比对只有 revision/savedAt/writerId/两处 workspaceState 差异；`adb forward tcp:9333` 已移除，54779/37395 未动，未 kill/start server。
- 证据：`evidence/acceptance-20261106/HERMES-A31-RESULT.md` + `a31-01…a31-99` 截图 + `a31-harness/` 脚本。
- 待决策：①重做按钮修法（补 `data-bottom-action` 或回调 `drawToolbar()`）；②是否把 1.3.0 的 `manifest.json` 补推到两端；③恢复目录 3 个 36 MB 注解快照的清理策略。

## 2026-11-07（A31 撤销/重做按钮状态修复）
- 场景工具栏撤销、重做按钮补充 `data-bottom-action`，复用现有历史状态同步；提交、撤销和重做时立即更新顶栏与胶囊按钮，无需整图重绘。
- 新增四种场景的节点拖动、立即撤销和立即重做行为验收，检查坐标精确恢复、两处按钮一致及重做后撤销可用。修复前复现 `excerpt redo unavailable immediately after undo`；修复后 Workspace 303/303 通过。
- 完整 `npm run verify` 通过，结果位于 `/tmp/marginstudy-a31-history-20261107-full/results.json`；Reader 214/214、Workspace 303/303。首次沙箱内运行因 `127.0.0.1` 监听被拒而中止，随后在允许本地监听的环境完整通过。
- 构建 SHA-256：`main.js` `9643b1b574efed6209af7daaa9ca789b68cd8155d1c89cef51aaf179a0da1b96`；`styles.css` `19d6ac538e602d9b1742af41759547cc42dfaa48a9e09e36f8cc680e01dc2ad4`。未使用 adb、安装、改真实库或 `evidence/**`，未提交；未进行 Pad 实机复测。

## 2026-11-07（A31 收尾核验 · Pad 实机 · Hermes · 两项修复后）
- 判定：两项均通过，**A31 通过**。
- 第 1 项：设备构建 `main.js` MD5 `27ffcfe8…` / SHA-256 `9643b1b5…`、`styles.css` `9fa85ad3…`、`manifest.json` `e04518f9…`（1.3.0）；强停重启（pid 5384）后 `plugin.manifest.version=1.3.0`，rev 593→594（+1），sets 1 / canvases 2 / nodes 5 / cards 6，5 个节点坐标逐位不变，`data.json` 10,681 B 不变。
- 第 2 项：临时学习集 `A31C-UNDO-TEMP` 内 `a31c-n1` 120,120 →200,170；真实「撤销」后同一 click 任务内（t=+60.8 ms，元素未重建）`重做.disabled=false`，CDP 回读 t=+67.6 ms 亦 false；立即点重做精确回 200,170。第二轮 200,170→280,220，撤销后 150 ms 采样 7 次（50.1/204.5/361.7/515.7/671.1/829.2/985.1 ms）全 false，点重做精确回 280,220。对比上一轮 10.1 s 全 disabled，修复生效。
- 现场：A30-OPPO 学习首页，无选中/无 modal/无临时学习集；sets 1、canvases 2、nodes 5、cards 6、decks 0、templates 0；`data.json` 10,681 B、rev 606，与开工前逐字段比对仅 revision/savedAt/writerId 差异；无 trace；`adb forward tcp:9333` 已移除，54779/37395 未动，未 kill/start server；产品代码未改未提交。
- 证据：`evidence/acceptance-20261106/HERMES-A31-CLOSE-RESULT.md` + `a31c-01…a31c-06` 截图 + `a31c-run.log` + `a31c-harness/`。

## 2026-11-07（手写笔延迟定位 · Pad 实机 · Hermes · 只量不改）
- 判定：延迟主因不是"事件处理慢"也不是"帧节奏慢"，而是 **输入管道 8.3 ms + 每帧重建实时笔迹导致的掉帧**；A/B/C 中 **C（drawLive 只增不重建）消除最多**，B（point 的 rect 缓存）实测为 0。
- 设备构建 `main.js` MD5 `27ffcfe88ed3c9d2f181f2e1a12e0f9d`（与给定一致）；面板 2400×3392、活动模式 7＝144Hz、DPR 2.625；空闲 rAF 16.66 ms，笔输入期间 6.9 ms（系统为笔升帧，非 50Hz 卡死）。
- 合成对照（120 帧 ×1 点/帧，3 次重复）：handler A 1.02 / B 0.79–1.04 / C 0.36 ms；drawLive A 0.84 / C 0.15 ms；Script 总量 A 139–156、C 68–71 ms。trace 逐帧：A 8.34 ms/帧（UpdateLayoutTree 2.67、Layerize 1.69、Paint 整视口 8,140,800 px²），C 7.51（样式重算 2.42 未消），G（单 path 延长 d）4.43（样式 0.25）；E（drawLive 空实现）0.87 ⇒ 全部样式/重绘由笔迹 DOM 重建引起。
- 真实笔（`adb shell input stylus swipe`，事件 8.34 ms≈120 Hz）：事件→JS 入口五组一致 8.3 ms；处理 A 0.47–0.51 / C 0.12 ms；时间戳→所在帧 A 10.25–10.44、C 9.57–9.60 ms；超 9 ms 帧 A 18–19/230（max 31–37 ms）、C 2/246（max 9.3）；3 s 笔画 A 56/492（max 31.5）、C 1/502（max 9.4）。端到端到上屏估算 ≈17 ms（A）/16.5 ms（C）。
- 通道限制：`sendevent`/写 `/dev/input/event6` 被 SELinux 拒绝、设备无 root/su；物理笔无人手实测，真实笔数据来自 InputManager 注入（保留 pointerType=pen 与真实分发，跳过内核笔驱动与系统预测）。
- 最小改动建议：`src/mindmap/handwriting.ts:257-266` 的 `drawLive()` 改为每笔画只建 1 个 `<g>`、每帧只追加新线段（压力宽度规则对齐 `handwritingSvg.ts:19-23`），`cancel()` 补 `liveState=null`；不建议做 B，不建议只做 G。
- 现场：未写入任何笔迹（options.write 全程计数，3 次调用 0 次落库；canvas `handwriting` 读回 undefined、DOM 笔迹节点 0）；`data.json` 10,684 B / md5 `016b6487d97e5946417846cc3aec63ff` / mtime 15:39 未变；手写模式已关闭；回到 A30-OPPO 学习集主页；trace 已 end、Debugger 已 disable；`adb forward tcp:9333` 已移除，54779/37395 未动，未 kill/start server；产品代码未改未提交。
- 证据：`evidence/acceptance-20261106/HERMES-INK-LATENCY.md` + `ink-latency/`（CDP/计时脚本、trace 逐帧汇总、原始逐事件记录）。

## 2026-11-07（手写实时层增量渲染）
- 普通压力笔迹按笔画复用 `<g>` 并追加新线段；无压力笔迹和荧光笔更新单条路径。直线模式可能改变已有几何，继续重建预览；取消和提交清空实时层。
- 隔离浏览器验收连续 120 帧：实时层 `replaceChildren` 为 0、组与已有线段节点保持不变、每帧增加一段；最终 SVG 与原保存层渲染器逐属性一致，抬笔后实时层节点数为 0。改前同一验收失败于组被重建。
- 完整 `MARGINSTUDY_VERIFY_DIR=/tmp/marginstudy-ink-incremental-20261107-full npm run verify` 全通过；手写 14/14、Reader 214/214、Workspace 303/303。沙箱内首次运行因本地监听受限中止，授权环境运行通过。
- 构建 SHA-256：`main.js` `3e07e91a5d5643132171d703e4665e88a73d06898c66a27d5619a0d33bb8913f`；`styles.css` `19d6ac538e602d9b1742af41759547cc42dfaa48a9e09e36f8cc680e01dc2ad4`。
- 未重新采集帧预算数据；既有设备 InputManager 注入对照 A→C：1.2 秒超 9 ms 帧 18/230→2/246，3 秒 56/492→1/502，不能视为本次构建实测。追加 SVG 节点仍可能触发样式重算和整视口重绘。
- 未使用 adb、安装、写真实库或修改 `evidence/**`，未提交。

## 2026-11-07（手写增量渲染 · Pad 实机复测 · Hermes）
- 判定：**JS 侧与主线程帧预算已达 C 组水平；帧间隔 >9 ms 计数未复现上轮 C，仍差 19 帧/3 s**。
- 设备构建 `main.js` MD5 `f2e00a70bfa31d36c33d7fd286c1d952` / SHA-256 `3e07e91a…`、`styles.css` `9fa85ad3…` 实测一致；144 Hz 活动模式、DPR 2.625；canvas `canvas-mw0ngdqj-a4je9j`、`lineMode=off`。
- 真实笔（`input stylus swipe`，143 点/1.2 s、360 点/3 s）：处理 **0.13 ms**（上轮 A 0.47–0.51、C 0.12–0.13）；时间戳→所在帧 **9.76–9.78 ms**（A 10.25–10.44、C 9.57–9.60）；超 9 ms 帧 **12–15/218（1.2 s）与 20/490（3 s）**，上轮 A 18/230 与 56/492、C 2/246 与 1/502；稳定段 6–8/142 与 17/402。同场对照：旧"每事件重建"行为 R 30/218、72/487；`drawLive` 空实现 E 6/216、1/482 ⇒ 残留由渲染路径产生，起始 ~30 ms 长帧与渲染无关（E 29.5 ms）。
- trace：`ProxyMain::BeginMainFrame` mean 2.70/2.95、p90 4.22/4.36、max 7.75/6.25 ms，**>9 ms 帧 0/219 与 0/480**（R 对照 6/480、max 10.28）；每帧 UpdateLayoutTree 0.62 ms、Paint 1.51 次×8,324,108 px²、Layerize 0.65、Commit 0.26 ⇒ 剩余来源是整视口重绘 + 样式重算，不是 handler。
- 合成 120 帧 ×5：每事件 0.374–0.429（中位 0.400）ms（A 1.02、C 0.36），Script 72.5–83.9 ms（C 68–71），样式重算 1.77–2.03 ms/帧，`liveRebuilds=0`。
- 视觉等价：121 点→120 段逐段 `<path>`，`d`/`stroke-width` 与 `createMindmapInkStroke` **120/120 全等**，段间 gaps=0，宽度 2.536–5.181（116 个不同值），实时组身份 121 帧不变、第 30 帧段列表是第 90 帧前缀、60 帧窗口 0 删除 0 组替换；抬笔后实时层 0 节点，连写 3 笔节点数逐笔回到 4/1370，无泄漏。
- 现场：`options.write` 全程计数（每次抬笔 +1、0 次落库），canvas `handwriting` 读回 undefined；`data.json` 10,684 B / mtime 16:12 / md5 `b0c5f18…` 未变；已按 `mindmapRenderer.ts:185-188` 恢复 write；手写模式关闭、回 A30-OPPO 学习集主页；trace 已 end、注入全局已清；`adb forward tcp:9333` 已移除，54779/37395 未动，未 kill/start server；产品代码未改未提交。
- 未覆盖：`lineMode=auto/always` 的 `replaceWith` 重建分支、荧光笔/无压力分支、已有大量笔迹的画布、物理笔人手实测（InputManager 注入）。
- 证据：`evidence/acceptance-20261106/HERMES-INK-RETEST.md` + `ink-retest/`（`real.js`/`harness.js` 与上轮字节一致，新增 R/E 对照与 `analyze-frames.mjs`）。

## 2026-11-07（手写渲染剩余帧成本 · 第二轮）
- 未达到完成定义：120 帧局部样式/布局范围和非整视口 Paint 未证明；目标设备 >9ms 帧数未测，不能认定接近 1/500。
- 既有实现的 live 本来就是独立 `<g>`，线段路径属性由 `createMindmapInkSegment` 直接设置。隔离 Chrome 合成页面、120 帧追加 120 段对照：基线、给 `<g>` 设置 `contain: layout style` + `will-change: transform`、迁移至带相同提示的独立绝对定位 SVG，三者各出现 240 次 Paint；前两者 Paint clip 含 1300×930 整视口，独立 SVG 同样包含整视口。每组 UpdateLayoutTree 120 次、elementCount 1；Layout 120 次、每次 dirtyObjects 4，无法证明仅涉及 live 子树。结果与脚本位于 `/tmp/margin-ink-trace-result.json`、`/tmp/margin-ink-trace.mjs`。Chrome 为 headless、禁用 GPU，合成页面并非目标 WebView，不能推断实机增益或帧数。
- `<g>` 提示候选通过 120 帧几何等价及抬笔清理测试，但未消除 Paint；已撤回候选和对应临时测试，不引入未经证实的图层提示。独立 SVG 仅在合成页面验证，未改产品结构；它可能改变合成和叠层行为，尚无视觉等价证据。
- 最终构建完整 `npm run verify` 通过：`/tmp/marginstudy-ink-render-20261107-final/results.json`；手写 14/14、Reader 214/214、Workspace 303/303。原有 120 帧测试的逐段几何/属性等价和抬笔节点清空通过；最终版本未设置临时 contain 或 will-change。`main.js` SHA-256 `3e07e91a5d5643132171d703e4665e88a73d06898c66a27d5619a0d33bb8913f`，`styles.css` SHA-256 `19d6ac538e602d9b1742af41759547cc42dfaa48a9e09e36f8cc680e01dc2ad4`。
- 下一步第一动作：在允许的目标 WebView 真实 GPU 环境采集逐层 raster/invalidations，核对 trace 的 Paint clip 与实际脏矩形；若仍整层重绘，探索保留逐段 SVG 几何与原有透明度叠加效果的分块绘制方案，再进行同场 120 帧和 >9ms 帧对照。当前禁用 adb、安装和真实库修改，无法重现已有 Pad 同场测量。
- 未使用 adb、安装、改真实库或 `evidence/**`，未提交。

## 2026-11-07（手写帧成本 A/B · 目标 WebView 运行时注入 · Hermes）
- 判定：**B 结构性无效、C 只有 −16%、D（SVG 覆盖层）只有 −22%；把 D 的同一套屏幕空间逻辑换成 canvas 承载（X）后 >9 ms 帧 2/494（−96%），与"完全不渲染"对照 Z（7/486）同级**。推荐按 D 的思路落地、承载必须用 canvas；若只能在 A–E 五选一，D 为最优但不划算（比 C 少 3 帧/500 却要改绘制路径），C 是低风险备选。
- 构建 `main.js` md5 `f2e00a70bfa31d36c33d7fd286c1d952`（未改）；设备 OPD2409、144 Hz、DPR 2.625、视口 1292×914；canvas `canvas-mw0ngdqj-a4je9j`、`lineMode=off`、`options.write` 全程计数桩。全部改动为运行时注入（`evidence/acceptance-20261106/ink-ab/ab.js`）。
- 3 s 真实笔（`input stylus swipe`，361±1 点）逐组中位：>9 ms 帧 **A 50/496（28–62，n=24）、B 48/498（n=4）、C 42/497（n=24）、D 39/497（n=15）、D2 38/497（n=12）、X 2/494（n=8）、Z 7/486（n=3）**；安慰剂 P（无效样式写）54/496 ⇒ C 的 −8 帧不是任意样式写入的副作用。交错配对：A/C 6 对 C 低 5 次（均值 −10.3），A/D 6 对 D 低 5 次（−7.7），A/D2 4 对全低（−14.3）。
- 机制（trace）：A/B/C 每个变动帧 2 次 paint（一次无界 clip 2.8e14 + 一次整视口 8,140,800 设备 px²），3 s 494 帧中 363 帧如此，无一次 clip 等于 world（7.37M）⇒ "world 重绘"实为无界失效；D 把无界变成有界 3.4M 但仍有整视口 paint（均值 8.32M→4.79M，仅 −42%）；X 把 UpdateLayoutTree/Paint/RasterTask 全部消掉，3 s 仅 10 次 paint（0.02/帧），BMF mean 1.22 ms（A 2.77、C 3.20、D 3.05）。contain 落在 0×0 的 `<g>` 上（计算值 `layout style` 但无布局盒），给 `ink.surface` 加同属性（B2）亦 45/485、53/492 无效果。
- 坐标一致性（要求 <0.5 CSS px）：D 覆盖层 client 折线 vs 提交世界坐标笔画经真实 CTM 渲染的屏幕位置 **max 0.297 / mean 0.20 px**（n=360）；提交笔画的屏幕位置 vs 笔尖 clientX/Y max 0.297–0.301（A 同口径 0.298–0.301，即输入量化下限 1/2.625=0.381 px/设备像素）；世界坐标首末点与 A 逐位相同。X（canvas）同尺 max 0.298。逐段 path 数与段宽 A/B/C/D 每 12 点采样完全一致（11…359 段）。
- E 组（pointerrawupdate）：样本数与 pointermove 相同（360/360）、`timeStamp` 完全相同，入口延迟 8.19 vs 8.50 ms ⇒ 只早到 0.31 ms，不改几何、不改帧节奏，不建议采用。
- 基线口径：本会话 A 为 50/496，上轮 20/490（页面左侧带标注 PDF、设备已连续跑近 2 h、CPU 56–60 ℃），跨轮绝对值不可比，全部结论只用同会话交错对照。
- 现场：未写入任何笔迹（`writes`=1/轮、仅内存 `lastWrite`，canvas `handwriting` 读回 undefined、DOM `[data-map-ink-stroke]`=0）；`data.json` 10,684 B / mtime 16:12 / md5 `b0c5f18455a86c00f6586128bb842400` 未变；`options.write` 已按 `mindmapRenderer.ts` 原实现逐字恢复；注入全局删除、`live/surface` 的 contain/willChange 复位、`[data-ab-overlay]`=0；手写模式关闭；回 A30-OPPO 学习集主页（与上轮 `ink-retest-close-verified.png` 同形态）；各轮 trace 已 end；`adb forward tcp:9333` 已移除，54779/37395 未动，未 kill/start server；产品代码未改未提交。
- 未覆盖：`lineMode=auto/always`、荧光笔/无压力分支、已有大量笔迹的画布、书写中平移/缩放（覆盖层缓存了笔画起始的 rect/scale）、人手物理笔（InputManager 注入，pressure 恒 1）。
- 证据：`evidence/acceptance-20261106/HERMES-INK-AB.md` + `ink-ab/`（`ab.js`/`ab.mjs`/`aggregate.mjs`/`analyze.mjs`/`visual-check.mjs`/`cleanup.mjs`、`ab-*.json`、`a12x-shot.png`/`d12x-shot.png`/`x12x-shot.png`/`xpair-early.png`/`xpair-late.png`、`ab-close-verified.png`）；trace 原始 JSON 在 `/Users/tanlihen/.hermes/cache/scratch/ink-ab/`。

## 2026-11-07（手写 canvas 实时覆盖层）
- 画笔和荧光笔实时显示改用 fixed canvas，保存、取消、撤销仍沿用原路径；覆盖层位于脑图根容器，z-index 35，低于工具栏 40 和设置面板 45。每帧检查 world 矩形、缩放、DPR 和视口尺寸，变化时清空重投影；resize 主动重绘。
- 隔离浏览器验收 16/16：连续 120 帧实时 SVG 无 DOM 写入，提交后与原 SVG 渲染器生成的几何和属性一致；缩放至 1.5、resize、端点误差小于 0.5 CSS px、荧光笔无压力变宽及单次撤销通过。该端点比较为合成浏览器场景，非目标设备实测。
- 完整 `MARGINSTUDY_VERIFY_DIR=/tmp/marginstudy-canvas-20261107-final npm run verify` 通过；Reader 214/214、Workspace 303/303。
- 构建 SHA-256：`main.js` `35a37d0f18a3fe8c9b0452ef5b4282c3e968159d004713d721db42fd4ac66564`；`styles.css` `1eb2c3e119bd6c303d0d3acfa90f4638a46176e6cfa1595bf934c35bf7197c62`。
- 未重新采集目标 WebView 的 Paint trace 或物理笔帧时，不能把既有运行时注入 A/B 数值视为本构建的实测结果。按透明度逐段绘制时，半透明线段的重叠可能比 SVG 组透明度更深，尚未完成像素等价验证。
- 下一步第一动作：在允许的目标环境中对本构建采集 Paint trace，并检查半透明荧光笔交叠处的视觉差异；当前任务禁止 adb、安装、真实库写入与修改 `evidence/**`。

## 2026-11-07（手写 canvas 覆盖层 · 产品构建实机验收 · Hermes）
- 判定：**第 1、3(笔)、4、5 项 PASS；第 2 项部分 FAIL** —— 帧成本达到注入 X 组同一水平，但①抬笔瞬间笔尾长出 1.5–2.3 CSS px（端点判据 <0.5 不满足）、②半透明荧光笔书写中 alpha 0.953 vs 抬笔后 0.33（2.9× 偏深，抬笔跳色）。两项均为产品实现缺陷，已给最小修复建议，未改产品代码。
- 设备构建 `main.js` md5 `8b09a8a3cb349c37375aa10308fefdfe`（sha256 `35a37d0f…`）、`styles.css` md5 `b26d79c42386031d4df6d17334b1209e`，设备与本机逐字节一致；Obsidian pid 26771 全程未重启；144 Hz 活动模式、DPR 2.625、视口 1292×914、canvas `canvas-mw0ngdqj-a4je9j`（0 存量笔迹）。
- 第 1 项（3 s 真实笔，n=6，`options.write` 计数桩，与 A/X 同口径）：`>9 ms` 帧 **4.5/449 中位 = 1.00%**（3–5 / 439–456），笔画窗口内 2/426（0.47%）；**采集时 renderRate 144.0 Hz**（mode 7 renderFrameRate 144.00002，rAF p50 6.9 ms）。1.2 s 对照 3.5/194.5 = 1.80%。trace（n=2）：`BeginMainFrame` **mean 0.92 / p90 1.22 / max 5.09 ms**、>9 ms 0；paint **0.027 次/帧**（3 s 共 12 次，仅落在起笔 #3–12 与收笔 #430–448 四帧，8 次整视口 + 2 次无界 + 2 次起笔 49.5M）。对照：A 50/496（10.3%，2.77/4.55/5.89，1.47 次）、X 注入 2/494（0.40%，1.22/1.75/6.61，0.02）、Z 不渲染 7/486（1.44%）⇒ 产品比 A 降 90%，与 X 同级且主线程更低，与"完全不渲染"对照同带。
- 第 2 项（canvas 末帧 `toDataURL` vs 抬笔后截图，after−before 差分掩膜）：笔（v02/v03）中心线偏移 max **0.19 / 0.381 CSS px**、宽度差 max 0.381/0.762、canvas→SVG 像素距 max **0.381** ⇒ 走向/宽度 PASS；**端点 FAIL**：canvas 只画到 180/181 点，末点距最后 move 点 1.98/1.47 px，SVG 首帧比 canvas 末帧长 **2.286 CSS px**（`up()` push 末点后未重画就 `commitDrawing()`）。荧光笔（h01，`#ffd54f` .32，宽 21）有效 alpha canvas **0.953**（0.933–0.976）vs SVG **0.330**，合成色 (254,214,87) vs (246,232,189)，ΔRGB (8,−18,−102) ⇒ **FAIL**；根因：`paintPreview()` 逐段 `stroke()` 且 `globalAlpha=.32`，圆头重叠约 8 层，`1−(1−0.32)^8≈0.95`。
- 第 3 项：笔 3 连笔，rAF 逐帧 637 帧 **0 空白帧 / 0 双画帧**（canvas 与 SVG 在 `commitDrawing()` 同一任务内交接），screencast 232 帧（~57 fps）墨迹覆盖度单调增、无 0 无跳变，`previewCount 0`、`live 0`、DOM 笔数恒等笔数 ⇒ 无空白/残留/双画。荧光笔同配方在抬笔瞬间覆盖度 10216→16、10788→932、11440→1588（`hl-01-before-up.png` vs `hl-02-after-up.png` 可见实心黄→淡黄）⇒ 跳色 FAIL（与第 2 项同根因）。
- 第 4 项（笔画 45% 处 `zoomAt(中点,1.5)`）：preview 变换 722.62/310.81/0.99949 → 580.14/217.10/1.49923，清屏后按新变换重画 265/266 点；canvas 折线 vs 真实 CTM 逐点 mean 0.248 / p90 0.376 / max **0.403 CSS px**（判据 <1），无错位 ⇒ PASS。残差来自 `bounds.width/offsetWidth` 与 `viewScale` 的 0.077% 差。
- 第 5 项：一笔 = 1 次 write（`脑图手写`）= 1 条历史，撤销 1 次后 strokes 0 / DOM 0 / `previewCount 0`，再撤销无副作用；3 笔 → 3 次撤销 → 0 ⇒ PASS。
- 修复建议（未实施）：①荧光笔整笔离屏合成（段用 alpha=1 画进离屏 canvas，可见 canvas 每帧清脏矩形后 `globalAlpha=opacity` 一次性 `drawImage`）；②`up()` 里 push 末点后先 `paintPreview()` 再 `commitDrawing()`；③可选缓存 `worldRect/scale`，去掉每帧两次强制布局（trace 里 UpdateLayoutTree 0.305 ms/帧约占 BMF 1/3）。
- 现场：未写入笔迹（两本画布 `handwriting` = undefined/null、DOM 0）；`data.json` 10,684 B 不变，md5 `182421a3…`→`8e9036e0…`，18:34 与 18:36 两次快照逐字段只差 `revision 622→623` 与 `savedAt`（撤销测试的库事务记账）；注入已清（`__IC` false、`.ms-map-ink-preview` 0）、`options.write` 按 `mindmapRenderer.ts` 原实现恢复、手写模式关闭、`viewScale` 复位 1、回 A30-OPPO 学习集主页（`close-verified.png`）；各轮 trace 已 end、`adb forward tcp:9333` 已移除（54779/37395 未动，未 kill/start server）；产品代码未改未提交。
- 未覆盖：`pressure` 恒 1（压力分段宽度只验证结构）、`lineMode=auto/always`、存量笔迹画布、screencast 仅 ~57 fps（<17 ms 单帧白闪靠 144 Hz rAF 状态 + 同任务结构补足）、第 1 项用计数桩不含落盘成本。
- 证据：`evidence/acceptance-20261106/HERMES-INK-CANVAS.md` + `ink-canvas/`（`page.js`/`run.mjs`/`analyze.py`/`color.py`/`analyze-flash.py`/`summarize.py`/`cleanup.mjs`/`probe.mjs`、`raw/run-*.json`、`raw/trace-*.json`、`ink-v02-01-canvas-last-frame.png`/`ink-v02-02-svg-first-frame.png`、`hl-01-before-up.png`/`hl-02-after-up.png`、`f03-f*.jpg`/`fh02-f*.jpg`、`close-verified.png`）。

## 2026-11-07（canvas 端点与透明度修复）
- 抬笔在追加末点后同步绘制尚未绘制的线段，再由 `commitDrawing` 清理 canvas、写入并渲染 SVG；已有段不会重复绘制。
- 透明笔迹使用不透明离屏 canvas，按新增段包围盒清理并合成显示 canvas；不透明笔沿用原路径。缩放、尺寸变化和直线模式重建时同步清理离屏及显示画布。
- 隔离 Chromium：手写验收 19/19，覆盖连续三笔抬笔端点、单笔撤销、接缝 alpha、合成颜色、120 帧实时 SVG 无写入；120 次荧光笔 pointermove 处理均值 0.105 ms、最大 0.20 ms、超过 9 ms 为 0。该数字包含完整事件处理，并非离屏增量成本，不能代表目标设备。
- 完整验证通过：`/tmp/marginstudy-ink-20261107-full/results.json`。构建 SHA-256：`main.js` `95bec773c4049a901723508936318211d2332328dba512eb5fd9bce510fe03ed`；`styles.css` `1eb2c3e119bd6c303d0d3acfa90f4638a46176e6cfa1595bf934c35bf7197c62`。
- 尚未完成目标设备验收：禁止 adb、安装和真实库数据修改，无法复现该设备 144 Hz >9 ms 帧占比及 120 帧 Paint trace；隔离浏览器 SVG 零写入不能证明没有整视口 Paint，也不能证明实机像素差。下一步第一动作：在允许的目标设备非 adb 验证通道采集本构建 120 帧 Paint 与 3 秒帧间隔，并比较 canvas 末帧和 SVG 首帧像素。

## 2026-11-07（手写 canvas 两项修复 · Pad 实机复验 · Hermes）
- 判定：**两处修复均成立；同时查出一个既有阻断缺陷（F1）**。①抬笔端点：同一口径 chamfer `svg→canvas` **2.286 → 0.381 CSS px**，笔尾端点差 **0.373 / 0.430 / 0.373**（3 笔，判据 <0.5），抬笔前 canvas 已画满 `N-1/N-1`、提交帧 `N/N`（`up()` 补画生效）；②荧光笔 alpha：canvas **0.322** vs SVG **0.325**（差 mean 0.003 / max 0.007，判据 ≤0.02），合成色 ΔRGB max **(0.5, 1.0, 0.8)**（上轮 (8,−18,−102)）；③性能不回退：3 s `>9 ms` 帧 **4.5/441.5 = 1.02%**（上轮 1.00%），BMF **0.96/0.91**、p90 1.28/1.22、max 9.44/5.60 ms（上轮 0.92/1.22/5.09），renderRate **144.0 Hz**，同轮 `drawLive` 对 SVG **写入 0/360–361 次**（`live` 子树 0 变更）；④闪帧：笔/荧光笔各 3 笔 **0 空白 / 0 双画 / 0 残留**，荧光笔抬笔**不再跳色**。
- F1（阻断，两轮同源、非本次修复引入）：`.ms-map-ink-preview{position:fixed;inset:0}` 挂在 `.ms-mindmap-root`，而 Obsidian `.workspace-leaf` 带 `contain:strict`，使其成为包含块 ⇒ canvas 元素 rect **(0, 80, 1292.19, 914.29)**（视口 0,0,1292,914），位图内容按视口坐标绘制 ⇒ 书写中整条笔迹比笔尖**低 80 CSS px**，抬笔瞬间整条上跳 80 px。证据：位图 vs 屏幕掩膜对齐 dy 扫描 **+210 设备 px（+80 CSS）时 IoU 0.50、dy=0 时 0.00**；screencast 逐帧包围盒 up 前 y 460–720 → up 后 380–640；红底定位与 leaf 裁剪一致。修法二选一：覆盖层挂 `document.body`，或 `setTransform` 里减去元素自身视口偏移。上轮"2.29 px"与本轮 0.381 px 都是**位图 vs 位图**比较，看不见元素摆位。
- 设备构建 `main.js` md5 `4a932fc6d609e428464006574275c53e`（sha256 `95bec773…`）、`styles.css` md5 `b26d79c4…`，设备与本机逐字节一致；Obsidian pid 13290 全程未重启；144 Hz、DPR 2.625、视口 1292×914、canvas `canvas-mw0ngdqj-a4je9j`（0 存量）。
- 通道/配方/口径沿用 `HERMES-INK-CANVAS.md`；harness 仅增量只读：`canvas-at-commit` 快照（在 `commitDrawing` 前取 = canvas 末帧，含 `up()` 补画的末点）、`drawLive` 写入计数 + `MutationObserver`、`snapMode=meta`（`toDataURL` 一次阻塞 111–126 ms，meta 轮剔除该 harness 成本）。
- 现场：未写入任何笔迹（两本画布 `handwriting`=null、无 `layers[*].strokes`）；`data.json` 10,684 B、md5 `51a82254…` 收尾未变（`revision` 632 来自本轮真实写入+撤销的库事务）；注入已清（`__IC` false、`.ms-map-ink-preview` 0）、`options.write` 按 `mindmapRenderer.ts:186-189` 恢复、手写模式关闭、`viewScale` 1、回 A30-OPPO 学习集主页（`close-verified.png`）；各轮 trace 已 end；`adb forward tcp:9333` 已移除（54779/37395 未动，未 kill/start server）；产品代码未改未提交。
- 未覆盖：`pressure` 恒 1、`lineMode=auto/always`、存量大量笔迹画布、screencast ~57 fps（<17 ms 单帧白闪靠 144 Hz rAF 状态 + 同任务交接补足）。
- 证据：`evidence/acceptance-20261106/HERMES-INK-FINAL.md` + `ink-canvas/`（新增 `endpoint.py`/`hlcolor.py`/`hljump.py`/`cardtext.py`，`offset-evidence-mid.png`/`offset-evidence-after.png`、`midprobe-*.png`、`redprobe.png`、`raw/run-{e02,e03,e04,hh01,hh02,p4-*,f04,f05,f06,fhh*,midprobe}.json`）。
## 2026-11-07（F2 手写预览层级）
- 采用方案 A：预览 canvas 放入 `.ms-mindmap-root`，使用绝对定位及 z-index 35；工具栏和设置面板继续自然叠在其上。移除调色板和设置面板挖空，保留脑图视口裁剪，使半透明控件下的墨迹能够透出。
- 绘制期间每帧读取根容器矩形并更新负偏移；world 缩放和平移仍由原有重投影逻辑处理。隔离浏览器验证含祖先位移、视口范围、缩放、120 帧 SVG 零变更和笔迹位图平均 chamfer；23/23 通过。
- 完整验证通过：`/tmp/marginstudy-f2-20261107/results.json`；Reader 214/214、Workspace 303/303。`main.js` SHA-256 `52faeb3a359cdfe81af0f6d4827272bf9ddbe8b435db47fad285ba2a927da1f8`；`styles.css` SHA-256 `8e3cbe002ad1cdb8f382b7188b5b2c923470571caa27bbe4e0cbb3be772919fba`。
- 未完成：底部栏、悬浮按钮、调色板各三点的书写中与抬笔后截图逐像素对照；笔尾最大 chamfer；本构建 Paint trace 和目标设备 144 Hz 性能。现有平均 chamfer 与 SVG 零变更不足以证明这些断言。未使用 adb、安装或修改 `evidence/**`。
- 下一步第一动作：在隔离 Chromium 中构造带真实三类控件的场景，截取同一笔 canvas 末帧和 SVG 首帧，记录九点 RGB 与最大笔尾 chamfer，再采集 Paint trace；如需目标设备数据，使用用户允许的非 adb 通道。

## 2026-11-07（手写预览层级 F2 · Pad 实机复验 · Hermes）
- 判定：**四项全部通过**。F2 修复成立：预览 canvas 从 body 移到 `.ms-mindmap-root`（absolute、z 35），与成品墨迹（z 30）同一层叠分支，底部场景栏（40）/悬浮按钮（36）/调色板（40）对二者的遮挡逐像素相同。
- 设备构建 `main.js` md5 `38d8ba9c2ab86287bddf146167a6f926` / sha256 `52faeb3a…`、`styles.css` md5 `5cc5e156…` / sha256 `8e3cbe00…`，两端逐字节一致；pid 26910 未重启；144 Hz、DPR 2.625、视口 1292×914、`canvas-mw0ngdqj-a4je9j`（0 存量）。
- 第 1 项（三处 × 3 像素，书写中 mid2 vs 抬笔后 after1）：底部栏 **(193,194,196) vs (193,194,196)**（上轮 (48,52,59) vs (190,192)）；悬浮按钮实心三像素 Δ(0,0,0)（不透明控件两种状态都看不见），缺口三点 Δ≤(1,0,1)（可见墨迹也不变）；调色板三点 Δ(0,0,0)，行内墨迹跨度两种状态完全相同（上轮 13 px「抬笔才出现」消失）。
- 第 2 项：12 笔 3,740 帧 canvas rect 恒 (0,0,1292.19,914.29)（最大偏差 0.29 px，判据 ≤1），clip 只剩脑图视口且与 `.ms-mindmap` 四边差 ≤0.02 px；脑图上方 64 px 带书写中墨色像素 0；**笔尾 0.346 / 0.346 / 0.346 CSS px**（穿越栏 0.381、穿越调色板 0.000，判据 ≤0.5）；chamfer 笔 0.381（0 像素 >0.5）。
- 第 3 项：3 s 真实笔 `>9 ms` 帧中位 **4/444 = 0.91%**（0.22–1.83%，n=6；上轮 0.57%，区间重叠但中位高 0.34 pp，如实登记）；主线程 BMF **1.04/1.07**、p90 1.43/1.49、max 5.92/5.86、>9 ms 0/442（上轮 1.05/0.99、1.40/1.33、7.64/5.27）；paint 0.027/帧（12 次，8 整视口 + 2 无界）；renderRate **144.0 Hz**；`drawLive` 对 SVG **0/360–361** 次写入。
- 第 4 项：五组对照图（`F2-01…F2-05`）确认书写中/抬笔后墨迹同长同深，无「抬笔变淡」、无整段被裁。
- 作废批次登记：`f2caps01/02` mid2 落在笔画 73%（未到取样点）、`f2pal01` 水平笔画被世界左缘夹住、`f2pal02` 起笔在可视区外 → 修正时序与路径后重测。
- 现场：未写入笔迹（`strokes 0`、DOM 0、canvas 无 `handwriting`）；`data.json` 10,684 B / md5 `2661044178feca5e41612aadb6951563`，与恢复快照 `pending-main-device-rolling-000001.json` 逐字段只差 `writerId`（rev 657 两边一致；646→657 来自本轮 12 次真实提交+撤销的库事务）；`options.write` 已恢复、手写模式关闭、`viewScale` 1、回 A30-OPPO 主页（`close-verified.png`）、trace 已 end、`adb forward tcp:9333` 已移除（54779/37395 未动，未 kill/start server）；产品代码未改未提交。
- 证据：`evidence/acceptance-20261106/HERMES-INK-F2.md` + `ink-f2/`（`f2.mjs`/`chain.mjs`/`tail_check.py`/`sample_pts.py`、`raw/run-f2*.json`、`raw/summary-*.json`、`F2-01…05*.png`、`close-verified.png`）。
## 2026-11-08（A12 路线 A · 隔离验证）
- 已在重组文档目录中保留稳定页 ID；页面重排后目录选区锚点跟随引用页。改前失败：`/private/var/folders/t6/drs3g4rn65584bfmzxqhq4_r0000gn/T/marginstudy-reader-iUGttJ/results.json`；改后通过：`/private/var/folders/t6/drs3g4rn65584bfmzxqhq4_r0000gn/T/marginstudy-reader-qrXip2/results.json`。
- 跨 PDF 虚拟页导出改前因入口拒绝失败（`/private/var/folders/t6/drs3g4rn65584bfmzxqhq4_r0000gn/T/marginstudy-reader-KvQVbP/results.json`，该轮并发测试污染了其他两项）；改后跨源全页和选定页序通过。工作区导出入口已接通。
- 重排撤销改前失败：`/private/var/folders/t6/drs3g4rn65584bfmzxqhq4_r0000gn/T/marginstudy-reader-MN25sr/results.json`；改后覆盖重排、移除、撤销、重做及目录恢复。重做中途曾因刷新清空历史失败：`/private/var/folders/t6/drs3g4rn65584bfmzxqhq4_r0000gn/T/marginstudy-reader-rMg1HV/results.json`，修复后通过。
- 目录转脑图改前缺少入口：`/private/var/folders/t6/drs3g4rn65584bfmzxqhq4_r0000gn/T/marginstudy-workspace-ui-i5lEJk/results.json`；改后 304/304 通过：`/private/var/folders/t6/drs3g4rn65584bfmzxqhq4_r0000gn/T/marginstudy-workspace-ui-NnEXNI/results.json`。覆盖三节点、父子关系、选区锚点和单次撤销。
- 选区插目录子树断裂改前失败：`/private/var/folders/t6/drs3g4rn65584bfmzxqhq4_r0000gn/T/marginstudy-reader-m30GyK/results.json`；缩略图拖入改前失败：`/private/var/folders/t6/drs3g4rn65584bfmzxqhq4_r0000gn/T/marginstudy-reader-smsqMD/results.json`；跨文档追加撤销改前失败：`/private/var/folders/t6/drs3g4rn65584bfmzxqhq4_r0000gn/T/marginstudy-reader-aTc1KN/results.json`。改后均通过。
- 目录章节折页入口改前缺失：`/private/var/folders/t6/drs3g4rn65584bfmzxqhq4_r0000gn/T/marginstudy-workspace-ui-T6Rz1g/results.json`；改后验证章节范围、子章节及单次撤销通过。真实 PDF 区域折页验证四种旋转的几何、选区及源文件 SHA-256；折页前源字节与几何原本已有通过证据，不能伪造这两条断言的改前失败。
- 插入的外部 PDF 页进入重组集合改前失败：`/private/var/folders/t6/drs3g4rn65584bfmzxqhq4_r0000gn/T/marginstudy-reader-zvV44w/results.json`；改后可引用并导出正确内容。
- 最终 `/tmp/marginstudy-a12-20261108-final5` 完整通过；Reader 222/222（`/private/var/folders/t6/drs3g4rn65584bfmzxqhq4_r0000gn/T/marginstudy-reader-dd7a8T/results.json`），Workspace 305/305（`/private/var/folders/t6/drs3g4rn65584bfmzxqhq4_r0000gn/T/marginstudy-workspace-ui-ulsW7i/results.json`）。
- 构建已安装桌面隔离库，源码构建与安装文件 SHA-256 一致：`main.js` `0cbcde18c6e1f162a051718b60eccdf3cf3b53c77d2fcf776e4f955919447d5e`；`styles.css` `8e3cbe002ad1cdbf382b7188b5b2c923470571caa27bbe4e0cbb3be772919fba`。隔离库 `data.json` 安装前后 SHA-256 均为 `dc838ae3055d56dd68aeeb0c81c4d945af9df1bfc26dd4ff154f0eabe98a4428`；未修改真实库、`evidence/**`，未提交。
- 尚缺：要求四项均有真实改前失败，但源哈希不变和区域折页几何在修改前已有通过证据；不能声称四项均已满足红绿证据要求。真实宿主上的折叠、拖入和导出视觉由 CC 后续实机验收；当前隔离测试不能替代。
- 下一步第一动作：由 CC 在桌面隔离宿主验证折叠、拖入、导出视觉并记录结果；对已正确的两条断言以实际改前通过记录替代虚构失败，需要任务验收方接受该证据口径。

## 2026-11-08（A12 实机验收 CC · 6/6 PASS）
- 交付：`evidence/acceptance-20261106/CC-A12-RESULT.md`；截图 5 张 `CC-A12-shot1…5`（区域折页前后、章节折页、导出页序、目录转脑图）。
- ① 源哈希：l4-sample-alpha.pdf 区域折页前后宿主 sha256 均为 `007d7527a5207605098c900285fc97db6a0fb1c1b4f001ab71b3b74f3417658f`；第 1 页显示高 869→859 px（−10 px）。② 章节折页入口 `折叠章节 L4/candidates` 存在，四页高度 869/869/671/869→34，revision 2467→2468，展开恢复 2469。③ 插目录 2461→2462、重排 [1,2,3,4]→[2,1,3,4] 2471→2473 撤销 2475 恢复、移除 3 页 2477 后撤销恢复 4 页，revision 单调不减。④ 临时副本重排 [2,1,3,4] 导出 PDF 4 页，pdfjs 文本序 = 源页 2/1/3/4，与虚拟页集合一致。⑤ 目录转脑图 cards 22→24、nodes 18→20（2 个 kind=toc），L4 根、candidates 的 parentId=L4 节点；单次撤销全部恢复。⑥ 临时副本/导出/目录项/脑图对象/设置全部清理，A17-验收-B 界面模式恢复 scenes，回学习集主页。
- 隔离库收尾：cards 22、nodes 18、canvases 9、documents 34、studySets 5、tabs 7、docPaths 7，与验收开始基线一致；`data.json` 无 `A12-临时重组` 引用；l4 目录空、无折页、标注 6 条、源哈希不变。revision 2452→2491（单调计数器，未回写；对象与设置已还原，撤销历史仍在库内）。
- 未改产品代码、未提交、未改既有 evidence。本卡完成。
### A23 AI 回答转换（2026-11-08，进行中）

用户要求先记录三条断言的改前失败测试，再实现、全量 verify、构建并安装桌面隔离库。不得读取 Claudian 历史、修改 `evidence/**`、真实库或提交。

现状：`draftFromPastedReply` 已能把普通文本转单卡草稿，且能把 Markdown 标题或列表解析为目录；`saveLibraryDraft` 用一次 `libraryTransaction` 保存目录，但会额外创建总标题根节点。AI 回答界面目前仅提供“制作卡片预览”，尚无回答转分支及选段写评论/标题的完整入口。`Store` 的 `libraryTransaction` 与 `undoLibraryChange` 已有快照机制；卡片评论主要存于 `back`，节点另有 `comments`。

尚未编写改前测试、修改功能、执行 verify 或安装。下一步第一动作：查看 `studyWorkspace.ts` 的 `selectedContext` 和现有 AI 测试夹具，确定可追踪目标卡片/节点的公开接口；先补三个独立行为测试并保留各自失败输出到 `/tmp`，再实施与验证。宿主侧 UI 流程须列为 CC 实机验收项。

#### A23 本轮实现与证据（2026-11-08）

- 新增回答转脑图、选段写节点评论、选段设节点标题入口，整答转单卡沿用已有可编辑预览。脑图使用回答首标题或首个内容块作为根；转换和节点编辑各使用一次库事务，失败回滚；UI 失败提示手动重试。
- 新增 `src/ai/a23-acceptance.mjs` 并接入 `verify`。合成 Store 下，transport、三层层级及父子关系、cards/nodes 深比较撤销、解析及中途写入失败回滚各两次通过，日志为 `/tmp/a23-after-{transport,hierarchy,undo,failure}-{1,2}.log`。transport 测试拦截 `DesktopChatTransport.stream`，尚未覆盖宿主 UI 的全部外部传输路径。
- 改前六次记录 `/tmp/a23-before-{transport,hierarchy,undo}-{1,2}.log` 均因新模块不存在而在构建阶段失败，未运行到行为断言；不能充当要求的三条断言各两次真实红灯证据。此项未完成，不能标记整卡通过。
- 旧的目录解析和保存代码未改动，其原有 `ai` 与 `claudian` 合成套件均通过，日志在 `/tmp/marginstudy-a23-baseline-existing/`。这说明已有部分行为本来可用，不能把新增入口的缺失当成每条旧行为必然失败。
- `MARGINSTUDY_VERIFY_DIR=/tmp/marginstudy-a23-full-20261108 npm run verify` 全部 31 个套件通过；第一次沙箱内运行在 `study-ui` 监听 localhost 时 EPERM，已在授权环境重跑通过。
- 已构建并安装桌面隔离库：`main.js` SHA256 `0ff1fc4d378ddddb1ca4d73157c396b7d713ce2a99b61b9de4150c65ce3c0439`；`styles.css` SHA256 `8e3cbe002ad1cdbf382b7188b5b2c923470571caa27bbe4e0cbb3be772919fba`；安装文件与构建文件一致。未触碰真实库、adb 或 `evidence/**`。
- 下一步第一动作：在隔离的改前代码副本中建立可执行的用户行为测试，确认缺失入口导致的真实断言结果；若原行为本来通过，应记录实际结果，不伪造失败。之后由 CC 执行宿主 UI 流程。

## 2026-11-08 · CC-A23 实机验收（精简版，串行无后台）
- 交付：`evidence/acceptance-20261106/CC-A23-RESULT.md` + 截图 3 张（shot1 面板、shot2 回复气泡主证、shot3 收尾）。
- 结论：**不通过（实机被阻断）**。真实 Send 链路（本地 SSE 桩，绑定握手 Mini/Normal 文本+图片+tool_calls+结果回传全通过）渲染 Ask 回复后，`.ms-ai-message-assistant` 只有「制作卡片预览」，`回答转脑图分支 / 选段写评论 / 选段设标题` 在 document 中命中 0，两次独立复跑一致 → **DEF-A23-1**。因此第 2～5 项（层级父子与无多余总根、转换 0 请求、一次撤销逐字段、空内容 Notice）**实机未能执行**，只给出源码层与单元层证据（`node src/ai/a23-acceptance.mjs` → PASS transport/hierarchy/undo/failure，4/4）。
- 入口门槛实测：`自动接收下一条 Claudian 回复` 实机 hidden（`claudianBridge.ts:52` 锁 realclaudian **2.3.30**，本机 **2.3.21**，`api.read=undefined`）；`粘贴 AI 回复` 不调用 `addAnswerActions`，故当前构建下三按钮唯一前置是真发一次 AI 请求。
- 全程外发网络 `realPass/fetch/xhr/ws = 0`，本地桩请求 14 次；页内 http/https hook 已还原（`httpRestored=true`）。
- 副作用登记 **DEF-A23-2**：脚本在无转换可撤时点了撤销，回退既有「编辑学习集」事务（已用重做复原 2 笔）。收尾读数 cards 22 / nodes 18 / edges 2 / comments 0/0（等于基线），revision 2492（基线≈2491，计数器层面存在偏移，未写成完全回到基线）；临时对象 leftover 0，侧栏已关，已回学习集主页 `A17-验收-B`。
- 仍缺：A23 三按钮在实机的可达性（需产品侧修复后补测第 2～5 项断言）。
