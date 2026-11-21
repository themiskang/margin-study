# 05 卡组与复习完整流程结果

日期：2026-10-25  
状态：**第05包按目标宿主 Obsidian 收口。** 浏览、完整复习流程、评分历史和图片遮挡已通过真实宿主及自动回归。MN4 原版参数/遮挡记录为参照差异，不作为 Obsidian 插件本包的阻塞验收项，也不继续扩测。
范围：原编号 10、18—20，未缩小任务书范围。

## 已完成的用户流程与呈现

- 验收库卡组浏览页先于问答/评分显示。真实 Obsidian 1.14.5 中，`实机验收卡组` 的浏览页显示第 1/2 与第 2/2，首末张上一张/下一张禁用状态正确，底栏“进入问答评分 · 2 题”单独进入问题模式。实机随后显示问题、独立“显示答案”门控及 Again / Hard / Good / Easy 四档；这次只查看答案与评分建议，按“结束复习”退出，没有评分。
- 当前样例的宿主评分提示为 Again 1m、Hard 6m、Good 10m、Easy 7d。这是插件对该卡当前状态的建议值，不代表 MN4 原版权重或固定间隔。
- 合成 UI 完整走过建组、入组、浏览、问题、答案、评分、完成后返回；还覆盖首末导航、未来到期成员、筛选、收藏、复制来源隔离、来源刷新、问答编辑及历史。图片遮挡编辑新增矩形/自由路径/调整模式；自由路径按原图归一化点保存，可拖动整个区域和单独顶点，矩形可调尺寸，支持标签、删除、取消和保存。遮挡题渲染使用裁剪多边形，答案揭示后显示原图。
- Obsidian 真实卡组截图见本轮应用观察；合成 UI 截图在 `evidence/package05-20261024/`，例如 `deck-browse-due.png`、`deck-browse-all.png`、`review.png`、`history.png` 和 `copy-refresh.png`。

## 代码与部署

- 改动：`src/review/occlusionEditor.ts` 实现自由路径、归一化几何、移动/顶点/矩形调整及保存；`src/review/contracts.ts` 为遮挡增加可选多边形点；`src/review/questions.ts` 校验归一化几何；`src/review/content.ts` 按多边形裁剪遮罩。`src/review/ui-acceptance.mjs` 与 `ui-fixture.txt` 扩展可见 DOM/真实鼠标交互验收，并修正合成 Obsidian API shims。
- `typecheck` 和 production build 通过。安装版 main SHA256：`27af0eb85159b1057c9f15ab769b5b340034aec29a36c11c38469cdfc50c29ce`；styles SHA256：`46f72232b8199bfc8079038092ade45e3dd800cb9b5826e97e12ce19c2cb1408`。只部署到 `${MARGINSTUDY_TEST_VAULT}/.obsidian/plugins/margin-study` 的 `main.js`、`styles.css`；通过 Obsidian“重新加载插件”后验证新代码可用。没有复制或覆盖 `data.json`。
- 修改前快照：`evidence/package05-20261024/source-before.tar.gz`（SHA256 `117dd710c405c253ccd88e89fec374c0f5a66c92d7930187b28744a63721bb4e`）。最终源码包与逐文件身份：`evidence/package05-20261024/source-package05-20261024.tar.gz`（SHA256 `2b28f2bdf51793fae77226970291d65e3d82630bf0aa30a5662f6d8600a601ce`）和同名 `.identity.json`。结果报告本身留在包外以避免归档哈希循环。

## 验证

| 对象 | 实际执行及结果 | 原始证据 | 尚未覆盖 |
|---|---|---|---|
| 自动回归 | `node scripts/verify.mjs typecheck build review pending decks study review-ui workspace`；8 个套件全部通过；review UI 37 项，workspace UI 118 项 | `evidence/verification/results.json` 与各套件 `.log` | 只证明所列流程和合成夹具，不折算整包覆盖率 |
| 真实 Obsidian | Obsidian 1.14.5；插件重载后浏览 1/2 与 2/2、AQ 前底栏；进入评分模式，查看答案与四评分按钮，再不评分退出。无本轮合成内容写入 | 本轮 `mcp__cua_repl` 应用观察；宿主图片在对话操作记录中；安装哈希与数据审计见 `evidence/package05-20261024/deployment.json`、`data-audit.json` | 真实宿主的遮挡编辑器没有可安全使用的图片复习卡；保存后重开/评分历史以合成 UI 和 Store 回归覆盖 |
| MN4 L4 | MarginNote 4 的 `L4SampleSet / l4-sample-alpha` 保持原样；Review 选中的 `Codex-Max-L4-Deck` 显示空列表，过滤器当前无匹配卡；“Start To Review” 提示无卡可复习 | 本轮 `mcp__cua_repl` 的 MN4 无障碍树及屏幕观察 | 没有可评分的原版卡，无法验证 MN4 当前实际的评分间隔、评分后历史和遮挡编辑交互 |
| L3 / 原版资料 | Qoder `evidence/06-review-scheduling.md`、`06-L3-fsrs-callchain.md`、`04-occlusion-cloze.md`、`04-L3-occlusion-cloze.md`；本地 MN4 手册摘录 `runtime-l4/sources/manual/document-review-occlusion-cloze-recall-mode.md`、`flashcard-review-scientific-review-fsrs-anti.md` | `${MN4_RESEARCH_ROOT}/analysis/qoder-findings/` 及 `MarginStudy开发/runtime-l4/sources/manual/` | L3 约定不能替代原版 L4 运行观察；MN4 手册描述的间隔不视为本轮实测参数 |

## 数据与清理

- 合成浏览器使用内存 Store；合成自由形状、评分/历史及测试卡均未写入验收库或 MN4。未给真实 Obsidian 卡评分，所以卡组仍有 2 张成员、2 条待复习、2 条既有 review log、0 条 review history；卡/节点/边/文档计数为 15/7/1/23。
- 最终验收库 `data.json` SHA256：`c41e56c35d69aacfea2bcfec075947e594382daa1a033ad03ddce7f196baba50`。与 2026-10-24 开始前 Obsidian 自动备份逐项比较，业务键变化为空；自动 `lastBackup` 日期从 2026-10-23 更新到 2026-10-24，工作区 `auxiliary` 从 `none` 变为已恢复的 `ai`。revision/writer/savedAt 属于易变包络。详细计数和比较见 `evidence/package05-20261024/data-audit.json`。
- WorkBuddy 与 `${OBSIDIAN_VAULT}/.obsidian/plugins/margin-study/main.js` 两处保护 main 前后均为基线 `be2bbfecf7f32a558c53af1f2ae2bfee10178e9f84b3024b5c5c60721b376fe9`。
- Obsidian 最后恢复到原 `L4SampleSet · MarginStudy` 阅读标签、AI 学习助手侧栏与未发送 TOC 草稿；重载前后草稿及 PDF 材料内容可见且相同，没有发送，也未打开 AI 设置或凭据。MN4 原样例保持 Review 面板打开、Due 筛选恢复原状态；未评分、未编辑。

## 收口边界

第05包的产品目标宿主是 Obsidian。真实 Obsidian 已通过卡组浏览、问题/答案门控、Good/Easy 实际评分与历史、遮挡图编辑/保存重开、遮挡题显示与答案揭示；四档控件及评分流程另有自动 UI 回归。新修复的 `commentMedia` 附图路径也已通过回归、构建、验收库部署和真实重载。因此本包按 Obsidian 目标宿主收口。

MN4 `L4SampleSet` 缺少可复习的原版图片卡，且当前样例 Review 牌组无卡；MN4 原版全档间隔及遮挡编辑无法从现有样例实测。此项作为参照差异留档，不推断原版行为，也不阻塞本插件在 Obsidian 的第05包验收。用户已明确纠正优先级，应停止追加 MN4 探索。第10包将由用户在自己的库最终验收；不得将本报告扩写为“与 MN4 原版全量等价”。

本包最小续接集合：本报告、`05-卡组与复习完整流程.md`、`evidence/closeout-audit-20261025/obsidian-review-occlusion-fix.json`。除非用户后续要求 MN4 专项对照，不再安排第05包运行态操作。

## 补充核对（2026-10-25）
当前源码重跑review/pending/decks/study/review-ui/workspace及typecheck/build均PASS（workspace119/119）。MN4当前`Codex-Max-L4-Deck`仍为空。临时合成两页PDF仅在现有MN4窗口临时打开检查，未保存卡片、评分、历史或遮挡；关闭临时页签后原文档列表仍为`l4-sample-alpha`与`long-30pages`，原样例未改。`/tmp/MarginStudy-P05-20261025`已不存在，合成PDF与PNG位于系统废纸篓且可恢复；没有卡片或持久测试数据需要清理。遵照用户明确指示，未创建MN4数据库、Obsidian vault、代码仓库或工作树。评分历史、图片遮挡仍未通过原版L4，包不关闭。补充审计：`../../evidence/closeout-audit-20261025/audit.md`。

## 运行态复核（2026-10-25 后续继续）
再次只读检查当前`L4SampleSet`窗口：文档列表仍为`l4-sample-alpha`与`long-30pages`；Review菜单中`Stop Review`、翻面及四档评分均禁用，右侧列表未显示可复习卡。没有执行评分或修改原版卡。此前会话中尝试创建的临时牌组未能在当前可见Review列表中确认其持久存在；因此不把“已清理临时牌组”或“当前有可评分样例”写作事实。若牌组名称在牌组选择器中重新出现，再按正常界面删除并验证；本次无法据当前界面观察完成原版评分历史及图片遮挡实测，状态仍为未关闭。

## Obsidian 宿主复核（2026-10-25 后续继续）
按用户要求优先复核 Obsidian：在真实 `MarginStudy验收库 / L4SampleSet` 中重新打开“复习卡组”面板，卡组选择器显示当前 `实机验收卡组`，统计为 2 张卡片、2 道题目、2 题到期、今日完成 0；面板提供浏览全部卡片与开始到期复习入口。仅检查选择器与计数，没有开始评分或更改复习排程。Obsidian 中浏览/评分界面与旧报告记录的流程证据仍有效；本次新增仅确认当前卡组及运行时状态。收尾时关闭复习面板并恢复原 AI 助手侧栏，没有发送请求。另在 MN4 中完成既有的一张克隆合成卡单卡流程观察；结束时已按应用菜单删除临时牌组并确认列表只剩原有 `Codex-Max-L4-Deck`，原始 `Occlusion` 卡保留，详见 `evidence/package05-20261025-real-closeout/mn4-review-lifecycle.txt`。后续打开原始 `Occlusion` 卡编辑器，确认其类型为 Note Card，Question 为 `Occlusion`，Answer 显示 Missing card；当前 PDF 第 3 页虽有两块彩色矩形，但不是可供直接复习的原版图片卡。重置旧牌组选择后，窗口中的复习牌组选择器为空；主页列表仍只有原 `Codex-Max-L4-Deck`。一次相机工具动作立即取消，没有捕获或保存图像。故仍未验证 MN4 原版四档评分间隔完整历史及图片遮挡编辑，不改原卡/PDF。

## Obsidian 实机评分与遮挡回归（2026-10-25 后续继续）

用户指出本包的优先验收宿主应为 Obsidian；此前连续测试 MN4、没有及时打开 Obsidian 是执行顺序错误。本节记录补做的 Obsidian 实机验收与修复：

- Obsidian 1.14.5 的 `MarginStudy验收库 / L4SampleSet` 中，打开 `实机验收卡组`，确认 2 张卡、2 道题到期，开始真实复习并分别给两张合成验收卡评分 Good 与 Easy。评分历史可见，今日完成数从 0 变为 2。该间隔属于 MarginStudy/FSRS 建议，不作为 MN4 参数断言。
- 使用单独的合成卡克隆与 `/tmp/obsidian-occlusion-test.png`（红蓝测试图）实测 Obsidian 图片遮挡 UI：插图、创建矩形遮挡、调整矩形、保存后重新打开编辑器，遮挡仍在。首次预览发现未生成遮挡复习题。对照实际 UI 的 `commentMedia` 附图路径与 `cardImages()` 后定位到 `questionsForCard()` 仅检查 `image/images/sources/extendMedia` 的缺口。
- 在 `src/review/acceptance.mjs` 增加 `commentMedia` 附图的独立遮挡题回归。先运行确认失败（期望 `occlusion`，实际 `basic`），再在 `src/review/questions.ts` 纳入 `commentMedia?.some(media => media.image)`。之后 `node src/review/acceptance.mjs` 通过 **43** 项；`node scripts/verify.mjs typecheck build review pending decks study review-ui workspace` 全部通过，workspace **119/119**。
- 将修复版部署到验收库并真实重载 Obsidian；克隆卡重新加入卡组后，面板显示遮挡提示“回忆遮挡区域中的内容”与遮罩问号，显示答案后出现原图及答案，四档评分可用。为避免额外改动排程，没有给这张遮挡测试卡评分。
- 通过 Obsidian 卡片详情 UI 删除临时克隆并确认“已删除”；原始 U1 来源卡仍在脑图/看板。数据只剩原卡，克隆的待复习条目为 0。两个 `initialization: true` 的克隆初始化日志是插件保留的追加审计日志，不是复习评分；未手改数据或清除历史。`/tmp/obsidian-occlusion-test.png` 已移除。安装 main SHA256 `fcd0f70853683ab1c058fabaa9558338a5b67b0e65b75973939491ee37b0369b`，styles SHA256 `831dab9e7563d0c48571fa667cd2e1c3a7406cd8048677e401dcf8066af9ec4d`。详见 `evidence/closeout-audit-20261025/obsidian-review-occlusion-fix.json`。
- 收尾恢复到原 `l4-sample-alpha.pdf` 标签和 AI 助手侧栏；无 AI 请求。验收库此时 `data.json` SHA256 为 `c8b4112102facbfe630f41c2617e28701e4a45af480513a6f6f4099e17a8cea5`，15 cards / 7 nodes / 1 edge / 26 documents，2 个有效 pending、6 条 review log、1 条 review history。实际 Good/Easy 记录与两条初始化记录均保留在合成验收库供审计。

本轮前面写下的“仅检查卡组计数、没有实际评分”和“未给真实 Obsidian 卡评分”描述，是较早检查时点的历史记录；以上实机操作发生在其后，现时以本节最新数据和证据为准。MN4 L4 原版比较依然未完成；这不影响 Obsidian 宿主的上述功能验证，也不能反向替代它。
