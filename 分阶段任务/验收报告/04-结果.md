# 第04包：卡片模板和组织视图结果

日期：2026-10-24。状态：**已关闭（按用户确认的功能闭环口径；细小像素差异不阻塞）**。范围：原08、09、17；第03包真实模型验收仍按用户决定暂缓，不读取或更改 Claudian 设置、凭据，也未发送请求。

## 已完成的流程

- 卡片模板可保存、编辑、删除并应用。模板字段支持 `{{front}}`、`{{back}}`、`{{source}}`、`{{date}}` 与挖空语法；编辑器按卡片已关联的模板恢复选择。模板编辑器支持预览/Markdown 切换，卡片正文继续走原有 Markdown 渲染。
- 卡片合并、解除、引用/克隆、拆分和删除恢复使用现有 Store 用户操作。引用保持共享卡身份；克隆编辑不污染来源。合并保留可解除的成员记录、父子关系、边标签、卡组和来源；撤销/重做以一次操作恢复。
- 大纲 Tab/Shift-Tab、Enter/Backspace、拖放排序和层级移动继续有效；看板筛选、排序、分组、多选、批量编辑及拖入脑图仍使用现有交互。顶部多选工具条既有遮挡修复和跨视图 Markdown 展示通过回归。
- 修复两处具体问题：重新打开卡片编辑器时没有选择其已关联模板；模板增删/编辑绕过统一撤销历史。修复模板撤销时采用按模板身份的三方恢复，避免无关库撤销覆盖稍后编辑的模板。
- 修复复杂层级的合并顺序：选择深层节点后合并其祖先节点，原逻辑可能使中间父节点落回根层。现在先将组头移到被折叠分支上方，并记入解除合并快照；解除/重载/撤销/重做均保留原始层级与连线。

## 代码与部署

改动文件：`src/review/templates.ts`、`src/model/store.ts`、`src/study/acceptance.mjs`、`src/study/organize-ui-fixture.txt`。没有样式源变化；沿用现有编辑器和预览外观。

仅部署到 `/Users/tanlihen/Documents/Qoder/2026-10-14/d20fd1f9/MarginStudy验收库/.obsidian/plugins/margin-study` 的 `main.js` 与 `styles.css`。部署前后 data.json 相同（SHA256 `2982bee20e9e735940c425ac05719973db560fc5597855259b383616be673bf2`）；两次真实 Obsidian 重载均确认插件界面可用。开发与安装产物：

| 产物 | SHA256 |
|---|---|
| main.js | `2f9d30bb8f2f52311a625f4a7dac0663b1638d958cf243f056b6aa8d0f64b838` |
| styles.css | `46f72232b8199bfc8079038092ade45e3dd800cb9b5826e97e12ce19c2cb1408` |

可恢复源码快照：`evidence/package04-20261024/source-before.tar.gz`。最终源码包：`evidence/package04-20261024/source-package04-20261024.tar.gz`，SHA256 `bdf88812ffd8717767fae9c5c22475dd8406259f7fc7a5e1c69f2c2f8aafd02f`（235个文件，不含验收 data、node_modules、凭据或 evidence）。构建、部署、保护审计、数据审计和回归日志均在 `evidence/package04-20261024/`。

## 验证

| 对象 | 实际执行及结果 | 证据 | 边界 |
|---|---|---|---|
| 自动回归 | `node scripts/verify.mjs typecheck build model-l3 model-additive study study-ui study-observed-ui organize-ui review workspace` 全部通过；L3模型25/25、study15/15、study UI10/10、L4对齐UI8/8、组织UI19/19、workspace118/118 | `evidence/package04-20261024/final-verification.log` | 合成 UI 在隔离 Chromium 和内存 Store，不代替宿主 L4 |
| 模板 UI | 通过可见控件应用字段模板、写入卡片、保存重开；Markdown 标题、列表、粗体源码保持有效；编辑器重开选择模板；模板删除撤销并重开 | 同上；组织 UI 合成 fixture | 保存由卡片现有 Store 公共更新接口承接；MN4 不支持插件自定义的用户模板 |
| 真实 Obsidian 1.14.5 | 验收库重载后核对原脑图/大纲/看板。临时节点在三视图显示后用 Undo 清理；再次重载确认原样例与视图回来。现有引用徽标、Markdown 列表、复习卡组可见 | `host-outline.png/.ax.txt`、`host-board.png/.ax.txt` | 这次未将合成宿主节点与跨脑图成员实际拖放合并；跨画布、引用/副本、合并回滚由合成用户界面和 Store 场景覆盖 |
| MN4 4.4.6 L4 | 在 L4SampleSet 创建一次性脑图及 Note Card；确认 Note Card 标题/正文输入、评论与工具栏、模板类型菜单、合并前/后呈现入口；逻辑卡片编辑器尺寸520×560 | `mn4-editor.png`、`mn4-template-menu.png`、`mn4-editor.ax.txt` | 本轮没有在原版样例卡上做破坏性多卡合并；原版两卡合并—编辑—重开—解除成员重新出现已有记录见 `../../../MarginNote4调研/analysis/qoder-findings/runtime-l4/cases/A-merge-edit-reopen.md` 及 `../../../MarginNote4调研/analysis/qoder-findings/runtime-l4/assets/screenshots/A_merge/`。静态 L3 不写作 L4 |
| 保护与数据 | 两处保护 main 开始/结束均是基线 SHA256 `be2bbfecf7f32a558c53af1f2ae2bfee10178e9f84b3024b5c5c60721b376fe9`。清理后 cards15、nodes7、edges1、studySets1、canvases1、cardTemplates0、reviewDecks1、documents23、docMeta、settings 均与本包前相同；末尾仅 workspaceState 与 revision/writerId/savedAt 信封差异 | `protection-start.json`、`data-audit.json`、`deployment.json` | 不声称 data.json 全字节相等。workspaceState 差异来自打开三种视图/插件重载，用户原 AI 输入草稿已重新放回输入框，未发送 |
| L3契约 | 引用/克隆依 Qoder `02-L3-reference-mechanics.md` §7；合并/解除依 `03-L3-merge-mechanics.md` §6；本包逐项关注共享身份、无损物化、父链、边标签、单步 Undo | 上述 L3 报告及 final 回归日志 | 未将私有类/API用于实现；L3 仅是契约来源 |

保留 Markdown 呈现与顶部多选条修复，没有以像素微差阻塞。卡片外观、跨视图内容/关系、编辑可读性和数据恢复流程均有本轮或可复用的对应验证。

## 后续

第04包关闭。第03包状态不变，真实模型生成/保存重开仍依用户配置决定。下一执行对话最小读取集合为本报告、`后续工作清单.md`、共用规则和第05包任务书；不要读取 Claudian 设置或数据。
