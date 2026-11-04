# 06 现有 Claudian 的 AI 联动结果

## 2026-10-26 跨包证据更新

第10包已补齐此前暂缓的Claudian2.3.30真实文本回答、卡片编辑保存重开、AI TOC生成保存重开、Markdown来源跳转与原生回复监听；证据为 `evidence/package10-20261025/formal-ai-2330-result.json`、`formal-ai-saved-card.json`、`formal-ai-toc-result.json`、`formal-markdown-source-link.json`、`formal-ai-native-autosync.json`。2.3.30独立合成图片实际识别并回到MarginStudy的证据为 `evidence/package10-20261025/claudian-image-fix/real-image-response.*`。这些旧缺口已被后续特定版本/场景证据覆盖，不能继续当作全局未实现。

当前验收库Claudian为2.3.21，图片直连入口按版本禁用；本轮没有重复外部模型请求或修改其配置。当前P10修复候选main `9b984423…`，预设菜单已对齐None/Guide/Quiz/Explain，受影响回归与实机菜单确认见[Sol记录](../../evidence/package10-20261026/sol-review-ai/README.md)。完整界面、硬件/服务限制和最终验收仍按[第10包报告](10-结果.md)及总矩阵推进；本补记不扩大旧证据的构建或场景覆盖范围。

以下2026-10-24段落保留当时实现、版本与保护事实，其中“真实请求未测/图片仅手动”等状态以本补记为准。

日期：2026-10-24  
状态：**未关闭；本轮可离线验证的修复和验收库部署已完成，真实外部 AI 验收未执行。**  
范围：任务书原编号 21—23；第05包继续暂停、未关闭，第03包真实生成与目录保存重开暂缓状态保留。

## 已完成的用户流程与呈现

- 复核已有文字选择/卡片拖入、模板提问、Claudian 直连文本回流、卡片/层级目录/Markdown 可编辑预览、显式保存及撤销流程。Claudian 直连的回答来自本次独立 passive 执行会话；未知版本使用复制提问、手动粘贴回复回退。**手动粘贴不是自动回流**。
- 修复失败或取消后输入区丢失问题与附件：恢复原问题、所选文字来源和图片，保留部分回答供查看，不自动重试。运行期间锁定输入与附件移除，避免覆盖用户同时编辑的内容。隐藏侧栏会取消当前请求，重开不补发。
- 未完整完成的自定义服务请求不再提前暴露可保存预览；成功后才显示。聊天回答的“制作卡片预览”只能操作一次；同一预览保存后按钮与编辑字段禁用。这里的防重复是同一回答/预览的防重，不宣称跨会话或用户主动重贴同文内容去重。
- Claudian 此入口仅支持文字。图片上传/粘贴在进入提交前被拒绝，已有图片也不能通过 Enter 绕过发送限制。图片需在 Claudian 中手动附加，再手动粘贴回复；没有把自定义 API 的合成多模态通过写成 Claudian 图片直传通过。
- 卡片与目录保留选中材料的 `docPath`；Markdown 预览现在附加可编辑的来源文档链接，保存的是用户核对后的内容。只保留文档级来源，不宣称自动生成精准页码/摘录锚点。没有文档来源的手动粘贴不会虚构来源。
- 真实 Obsidian 验收中学习界面仅显示 MarginStudy AI 面板，宿主 Claudian 输入框没有遮挡。原未发送 TOC 草稿全文 1459 字在重载前保存于操作会话内，结束时逐字相等；起点/终点附件 chip 均为 0，PDF 材料本就在草稿正文中。没有发送这份草稿。

## 代码与部署

- 改动：`src/ai/panel.ts`；扩展 `src/ai/ui-acceptance.mjs`、`src/ai/ui-fixture.txt` 的合成外部服务/Claudian 失败与可见 DOM 检查。没有修改 Store 数据结构或 Claudian 配置。
- 最终 main SHA256：`210ccce36469f22408edb2be676a1c75a53cd3a97907241dc4389d0347f9eb88`；styles：`46f72232b8199bfc8079038092ade45e3dd800cb9b5826e97e12ce19c2cb1408`；manifest 1.2.12 不变。开发与验收库安装产物相同。
- 只复制 `main.js`、`styles.css` 到 `MarginStudy验收库/.obsidian/plugins/margin-study`，没有写入/替换 `data.json`。最终构建在真实宿主第三方插件页停用/启用，再打开工作区确认加载；最终手动回复入口取消验收通过。
- 修改前回退快照：`evidence/package06-20261024/source-before.tar.gz`。最终212文件源码包：`source-package06-20261024.tar.gz`，SHA256 `0502a14a2f1f9119e26f9dafe0f1299d64b1cd2f8501434c46f248dc6652438e`；逐文件身份见同名 `.identity.json`。报告和实时清单在源码包外。

## 验证

所有本包证据位于 `evidence/package06-20261024/`。

| 对象 | 实际执行及结果 | 原始证据 | 尚未覆盖 |
|---|---|---|---|
| 自动回归 | `node scripts/verify.mjs typecheck build ai claudian ai-ui workspace` 全通过；AI21、Claudian18、AI UI23、workspace118。取消恢复、Claudian失败保留来源、图片拒绝、直连来源/一次保存、Markdown来源链接新增检查通过 | `verification-final.log`、`results.json`、各套件 `.log`；取消恢复与Markdown来源的先红后绿日志 | 合成外部边界不证明任何真实 API 成功；未新增声称完整覆盖的测试数量指标 |
| 真实 Obsidian 1.14.5 | 验收库重载→粘贴合成卡片JSON→编辑正文→保存→按钮禁用→Undo→Redo→最终Undo；卡片已落盘取证且清理。最终来源链接构建再次重载→粘贴合成回复→取消，无数据新增 | `host-saved.ax.txt/png`、`host-saved-card.json`、`host-observations.json`、`host-final.ax.txt/png`、`deployment.json` | 保存/撤销证据来自本轮先行构建2873bcb1…；最终210ccce3…只增加Markdown预览来源，未改卡片保存边界，复用该证据。真实生成、图片识别、回答保存重开仍未测 |
| Claudian 合成直连 | 本次请求隔离文本流、过滤其他turn、完整结束门控、取消/超时/连接失效释放会话、错误不泄漏；现有草稿未消费，未知版本回退不发送 | `claudian.log`、`ai-ui.log`、`ai-claudian-direct.png` | 内部执行结构只验证2.3.21；不是上游稳定API，也不证明原库2.3.24可用 |
| MN4 L4 | 原样例 `L4SampleSet` 的 AI 菜单显示 Chat / Add to Chat 禁用；没有调用或编辑样例 | `mn4-ai-menu.ax.txt`，本轮CUA观察 | 无启用态回答面板/模板/图片/回流对照；该菜单截图工具不可用，未伪造截图。旧布局参考见 `src/ai/ACCEPTANCE.md`，不当本轮实测 |
| 原库只读身份 | yan `realclaudian` manifest为2.3.24；main SHA256 `e29ba7170f0d3bc753841f3723f1bc89c2ef7db3994fb956f0100ae2ea3e8077` | `original-bridge-identity.json` | 仅读manifest身份与bundle哈希，未读设置、凭据、聊天记录或运行模型；未确认2.3.24执行结构兼容 |

## 数据与清理

- 部署前保存限定业务基线 `business-before.json`；排除未读取的settings及易变revision/writerId/savedAt后，最终其余业务键**无差异**。包括cards/nodes/edges/documents、工作区状态、文档元数据、卡组/复习等；计数15/7/1/23。本轮合成卡余量0，无新笔记文件。最终数据SHA256见 `data-audit.json`（宿主保存会改变易变包络）。
- 两次部署瞬间data哈希各自相等；全部清理通过正常UI撤销，不恢复整份data。最终重载清空了本轮Undo/Redo历史；导入弹窗已取消，合成预览不留在当前对话。
- 原有工作区四个文档标签与业务状态保留；停用插件使宿主的旧独立阅读器标签退出，结束只保留当前L4学习工作区宿主标签。草稿在重新打开工作区后恢复，未操作Claudian输入框、设置或密钥。
- WorkBuddy与原yan正式 MarginStudy main 结束均仍为基线 `be2bbfecf7f32a558c53af1f2ae2bfee10178e9f84b3024b5c5c60721b376fe9`；未部署原库、未动真实笔记、未清空Trash。MN4恢复原空Review样例，AI菜单已关闭；不补造第05包数据。

## 未关闭项与下一步

1. **当前没有安全且已授权的真实外部AI实测条件。** 用户明确未授权本轮发送；验收库无API连接，Claudian显示Model unavailable。原yan虽有先前已授权连接，但当前安装2.3.24与适配2.3.21不符；原库有连接不等于本次新请求已获授权。本轮真实外部请求为0。
2. 后续先仅针对原库2.3.24制品检查可支持的接口结构/上游公开扩展边界，不读取配置；没有稳定接口则保留版本适配/手动回退并说明边界。不要直接放宽版本白名单。
3. 取得明确真实请求授权与兼容接口后，用新建、可清理的合成材料做真实文本回答→编辑→卡片/笔记导入→来源→重开；同时处理取消、超时/失败及重复操作。若需要部署正式MarginStudy，先提供目标文件、回退快照与验证方案，不自行覆盖正式插件。
4. Claudian图片直传/结果自动回流无已验证图片接口，原版MN4启用态面板也未验收；两者是本包独立未关闭项，不能只把缺口归结为API。

下次最小读取：总控规则、实时清单、本报告、06任务书、`original-bridge-identity.json`、`deployment.json`、`data-audit.json`；再按需读 `src/ai/panel.ts`、`claudianRequest.ts`、`claudianBridge.ts`、`ui-acceptance.mjs`。本轮停止代码与桌面执行，不自动启动07；第05包暂停未关闭状态不变。


2026-10-24用户后续决定：AI先暂缓，授权转第07包并要求另开空白对话。本包保持未关闭；上述“不自动启动07”已由本次明确安排替代。没有新增模型请求或插件改动。

## 2026-10-25 第10包后续实机结果

第10包后续在 yan 正式库完成 Claudian 2.3.30 的新原生回复自动回流和中心脑图上下文两项合成实机验证。MarginStudy显式启用下一条回复监听后，原生 Claudian 的新回复自动出现在 MarginStudy；选中中心脑图合成节点后，AI上下文芯片与真实模型回答均对应所选节点。证据见 `../../evidence/package10-20261025/formal-ai-native-autosync.json`、`../../evidence/package10-20261025/formal-ai-map-context.json`。这更新了06旧的“真实回流未执行”停点，但不单独关闭06：图片直传/回流、MN4启用态面板对照、该包完整集成场景仍保留未验证边界。未读取或改动Claudian配置、密钥。

## 补充核对（2026-10-25）
当前AI/Claudian/AI UI及typecheck/build等回归全部PASS；无源码改动或部署。只读程序制品核对确认验收版Claudian为2.3.21、yan为2.3.24；2.3.24可见预填/当前模型选择方法，但其直接执行依赖私有运行时，不能按静态字符串宣称兼容。未读取配置、密钥或草稿，未发送模型请求。真实回答/图片回流、MN4启用态对照仍未关闭。补充审计：`../../evidence/closeout-audit-20261025/audit.md`。
