## 2026-10-26 最新：Luna最终流程验收完成，逐项对齐继续

1.2.13 的学习流程、P10摘录编辑并正常UI撤销、脑图大纲/看板、同一Review session中Good评分后撤销、窄窗、保存重开、验收库19载荷回退/重装与Force Reload已由Luna完成。两条既存missing提示均稍后处理。最终详情及逐键审计见 `../../evidence/package10-20261026/continuation/luna-final-acceptance.md` 与 `luna-final-audit.json`。评分撤销日志保留，今日计数0，1张P10牌仍到期；未手改data。开发/验收main仍`99f39775…`、styles`522b7e70…`、manifest1.2.13。当前验收data SHA为`8325ccf994cd91ae6400b0b2c26321fbfd994d792dd3727a55a7b1c8452e5e23`；相较封版基线，cards/nodes/edges/documents/docMeta/studySets/canvases/reviewDecks/reviewPending/srs/cardTemplates逐键相等，另有撤销评分审计及保存/视图状态变化。

用户已要求继续按Sol代码、Luna桌面对照串行完成MN4逐项对齐，并把表格、柱状图等富内容纳入P10独立素材。下一步：更新状态矩阵；Luna以相同尺寸/缩放/选中态取证；Sol修复已证实手写缺口及新差异；最终重新回归、打包、验收库和数据审计。全界面同态证据仍不足，第10包未关闭，正式库不部署，待用户自己的库最终确认。以下较早“Luna最终验收待做”为历史状态。

## 2026-10-26 最新：1.2.13封版候选交Luna最终验收

完整21/21套件通过（Reader200、Workspace132、脑图手写12）；19项完整程序/265文件源码、哈希/安装回退/限制清单已生成，源码独立离线复建一致。只部署验收库并真实Force Reload，开发/安装/ZIP的19载荷一致。main `99f39775…`、styles `522b7e70…`、manifest1.2.13 `5cc889dd…`。业务键全相等；data `38f24155…`→`854ccf6a…`，仅保存元数据与PDF缩放0.793→0.818变化。yan `51ff6173…`、WorkBuddy `be2bbfec…`及realclaudian3文件保护哈希不变。

P10测试对象、牌组及初始化审计日志、两条旧missing登记保留。Luna继续学习整链/窄窗/保存重开/真实宿主更新回退/正常UI清理审计。手写全量缺口、Claudian2.3.21图片禁用、AI失败态/MN4 Research/Theme/Keyboard限测仍保留，不能宣称完整视觉等价。**第10包未关闭，等待Luna最终验收，再交用户确认；不自行标用户已确认。**

[Release evidence](../../evidence/package10-20261026/continuation/final-release.md)

## 2026-10-26 第二批对照：无新增已证实差异，转Sol封版准备

Luna在验收库P10素材/独立MN4样例完成Review牌组浏览/复习记录空态、AI模板/输入/附件菜单、Research现状/本地源跳转、Reader菜单与插件/MN4设置入口只读对照。没有新增P10-B2已证实缺陷；没有评分或完成复习、发送AI请求、导航外网页、改主题/快捷键/插件偏好或Research内容。AI失败态未测；MN4 Research页面及原生Theme/Keyboard页面未测；MN4 Add to Chat原有`In progress`状态来源不明，未Send/Cancel。详细AX/截图、限制和可复现条件见[第二批记录](evidence/package10-20261026/continuation/batch2-evidence.md)与[差异单](evidence/package10-20261026/continuation/batch2-differences.md)。

当前插件1.2.12，main `99f397750dd76451266692e365e7f5263a0b14fdd590b08700695950b5ddee96`、styles `522b7e7090ae41d7ca23bbe08eabfa9aee589f071dfb07c1fca570311629b989`。验收库P10独立牌组及1张合成卡保留作最终流程；Review入组初始化记录保留，无完成评分。最终全21套件、版本1.2.13、安装包/源码/哈希/回退说明、干净主机更新与还原/保存重开流程以及完整P10测试审计仍待Sol封版和最终Luna验证。第10包未关闭。

## 2026-10-26 第一批修复：部署验收通过，交回Luna

Sol基于第一批P10证据修复卡片Review Card类型显示、地图选择工具条定位及脑图Opacity/直线设置。开发和验收库插件载荷一致；验收库Force Reload实测通过。类型检查、build和受影响10个套件通过（Workspace132/132）；候选保持1.2.12。保护的yan和WorkBuddy main SHA保持基线。详细实现、哈希、安装备份、数据差异及UI证据见[evidence/package10-20261026/continuation/sol-batch1-fixes.md](continuation/sol-batch1-fixes.md)。

还缺 MN4 手写Pencil/Water/Crayon、Ruler、Vanish Mode、Perfect Shape、Clone As New Tool及Doc/Map/Card分项宽度；此批未完成手写设置全量等价。现在交Luna先复验修复，再进行第二批。P10独立牌组及入组初始化记录保留供Review流程测试，并已单列数据审计。第10包与最终封版仍未完成。

## 2026-10-26 第一批界面对照：取证已交 Sol 集中修复

验收构建保持1.2.12，开发/验收main `62d3caf09c2d6540850c53ae67be68c9eaeef847fc710b714469417f07a32b34`、styles `d4034cc9ce8271cf3d2a6052089548a40c840eb6d82596793c335a1924560850`。本批取证结束，已排除留白显示分段误读（P10-B1-01），并交Sol集中核验/修复：P10-B1-02 原版有Type/Opacity/Ruler/Shape等手写设置，插件对应入口只暴露颜色/粗细及其他笔工具；P10-B1-03 同France/Paris且加入各自P10 Review牌组后，MN4卡编辑器显示Review Card，插件仍标记摘录卡/Note Card；P10-B1-C01 插件单选操作条固定于地图画布底部，MN4工具贴近选中卡，窄图宽下插件工具通过横向滚动可访问。详情及AX/截图在`evidence/package10-20261026/continuation/batch1-differences.md`。

本轮创建验收用 `P10-Interface-Type-20261026` 牌组并将现存P10合成卡加入，以匹配Review状态。此操作按插件实现产生`initialization=true`的到期初始化记录，不是完成评分、不计review历史、不标错题。插件正常UI没有删除牌组或撤销该初始化记录的入口，SRS和log属于审计；牌组/初始化状态保留供第二批Review测试，最终审计将列明。原牌组成员/已完成复习历史及卡片正背内容未变，正式yan未动，data没有手工覆盖。完整数据说明：`continuation/p10-review-data-audit.md`。

第一批提供了足以集中修复的实证差异，Sol现在核实并修复。完成类型检查/build和受影响回归、验收库部署及实机复验后，再转Luna进行第二批。第10包其余工作和最终交付仍未完成。

# 第10包：全界面对照与正式交付

## 2026-10-26 最新续接：只读浏览已实机通过，Luna继续第一批

候选1.2.12，开发/验收 main `62d3caf09c2d6540850c53ae67be68c9eaeef847fc710b714469417f07a32b34`，styles `d4034cc9ce8271cf3d2a6052089548a40c840eb6d82596793c335a1924560850`。上一会话已部署，本次验收库 Force Reload 后完成“选择旧组→浏览全部卡片→关闭”实机复验：P10保持未绑定，data.json前后所有键相等。上一会话Workspace最终重跑132/132；当前未改码、构建或部署。正式yan/WorkBuddy程序保持本轮起点。

用户重申由代理执行模型切换。当前已交 `gpt-6-luna` 独占桌面继续第一批同态视觉和状态对照，Sol不同时操作桌面或改码。第一批未完成；完整批次存在已证实差异才集中修复，数据风险或阻断可提前交Sol。最终1.2.13、全21套件、交付和用户库确认仍待完成，第10包未关闭。证据：`evidence/package10-20261026/continuation/readonly-browse-result.md`。

### 第一批续测复核：留白分段已排除误报

`P10-B1-01`不作为物理页数缺陷：插件P10现有页内留白展开时生成三个显示片段，正常UI折叠后只剩一个缩略图，恢复展开后回到三个，正文物理页始终为1。原始证据：`evidence/package10-20261026/continuation/batch1-04-folded-thumbnails.*`及`batch1-05-restored-expanded.*`；原版留白改变视图计数的历史证据继续复用。`P10-B1-C01`尚需区分工具条横向滚动隐藏和真正裁切，不将其自动豁免为宿主适配。Note/Review卡编辑器、手写面板、页编辑及部分菜单仍在补同态证据，第一批未完成。

当前业务审计：相对只读浏览结束快照，原卡片/节点/学习集/脑图/牌组/复习数据相等；页内留白经正常UI折叠再恢复补写`collapsed=false`，另有缩放、面板和保存元数据变化。准确结束状态在最终本批审计中记录。当前源码与安装版未改，仍main `62d3caf0…`、styles `d4034cc9…`、候选1.2.12。

## 2026-10-26 历史：Sol 牌组/AI修复已部署

候选仍1.2.12；开发/验收 main `9b984423878074aee83afe493fb9dd40463a6ba44f146330d8901e2b4a72dbc1`，styles `d4034cc9ce8271cf3d2a6052089548a40c840eb6d82596793c335a1924560850`。完整记录、回退程序、当前候选包/源码及数据审计在[本轮修复记录](../../evidence/package10-20261026/sol-review-ai/README.md)。正式yan与WorkBuddy哈希保持本轮起点，程序只部署验收库。

`P10-ISO-01`已修复：活动集未绑牌组时不回退全局旧组；选择器先空白，明确选择后才预览/确认共享。实机P10空态、取消预览、L4原绑定、切回P10均通过。旧组/SRS/历史逐值不变，没有发生持久化跨集绑定污染。`P10-AI-01`的None/Guide/Quiz/Explain预设已按原版顺序显示；Guide是本项目提示词，未宣称复制原版内部提示词。`P10-ISO-02`查明为现有工作区Research历史，未证实是缺陷，未改作用范围。验收库Claudian2.3.21图片入口禁用属版本边界，既有2.3.30实机图片回流证据继续有效。

本轮受影响检查8/8（含Workspace131、Research18）、AI UI27通过；真实Obsidian已重载确认。没有真实AI请求、评分或新建测试对象。完整19载荷候选和265文件源码已打包，隔离安装/升级/回退验证通过；这些不替代最终原生宿主验收。最终封版尚未进行，全21套件与1.2.13递增留在封版阶段。

业务审计：17卡/9节点/3学习集/4脑图/1牌组保留；仅一张新P10卡在既有加载归一化中补keywords=[]，内容等价；scale实际起点0.41→0.408，另有lastVisitedAt/工作区导航和保存元数据变化，未覆盖data。Luna临时卡/留白/高亮等保留供后续继续，最终正常UI清理仍待做。

下一步用户手动切Luna：复验本轮修复，继续Review/历史、AI附件/失败态、Research来源、设置/快捷键及剩余菜单，并补同缩放/同状态视觉证据。此前“第一批完成”只代表入口和部分状态遍历，整体视觉等价尚未证明；完整链路、窄窗、保存重开、清理和用户库最终验收仍待完成。最小读取：本轮修复记录与[总矩阵](../../evidence/package10-20261025/mn4-interface-matrix.md)。

## 2026-10-26 Luna 历史采证：入口遍历与待查疑点（已由上节复核）

第一批主框架、Reader、目录/书签、摘录/批注、手写、页面编辑、卡片编辑器/模板、脑图和相关菜单已完成本轮原生 UI/AX 对照。第一批没有已证实、可直接改码的普通界面差异；页面缩放尚未对齐，不能据字级/比例判视觉缺陷。证据和状态条件见[本轮 Luna 对照记录](../../evidence/package10-20261026/luna-ui-comparison-20261026.md)。

第二批已检查 Review、AI 模板/附件入口、Research 和部分本地设置。高风险 `P10-ISO-01`：Obsidian P10 牌组选集弹层显示旧组 `实机验收卡组` 将绑定当前 P10 集，但成员是 L4 的 `Unique sentence U1/U2`；未点击应用、评分、改名或改旧组，持久化影响未证实。`P10-AI-01` 已确认模板菜单不同：MN4 为 None/Guide/Quiz/Explain，插件为 None/Explain/Compare/Quiz。`P10-ISO-02`：P10 Research 面板显示旧 P01 Bilibili 搜索页；没有导航或搜索，数据作用域未知。当前先切 GPT-6.1 Sol（中等推理）查明 Review/Research 隔离规则并核实模板语义，修复/验证后再回 Luna；模型由用户手动切换。附件/失败态、来源链路、设置完整页和最终流程仍待对照。

本轮候选仍为 `1.2.12`，main `934a928a6f3f9374cf8df53899bcef05384c4e434a0af19c73680b149e3d0cea`、styles `d4034cc9ce8271cf3d2a6052089548a40c840eb6d82596793c335a1924560850`。没有源码、构建或部署改动，无 AI 请求。Obsidian P10 临时集仍有两张测试卡、高亮和留白笔记；MN4 独立 P10 样例仍保持原合成 Q&A/Question 卡及独立牌组；待后续按正常 UI 清理并比较数据。

## 2026-10-26 Sol UI 修复完成，交回 Luna 对照（第10包未关闭）

本轮修复工作区当前学习集重复点击新建空脑图、页签/页头/窗口标题不同步，补齐左栏当前集与 MindMaps/Documents 层级，并把新建集改为默认空白、显式选择包含当前阅读文档。只更新并重载验收库；main SHA `934a928a6f3f9374cf8df53899bcef05384c4e434a0af19c73680b149e3d0cea`，styles SHA `d4034cc9ce8271cf3d2a6052089548a40c840eb6d82596793c335a1924560850`，manifest仍1.2.12。全套21套件在本轮主修复构建通过；后续标题与CSS修正的最终构建分别通过受影响的typecheck/build/Workspace129检查。没有将旧完整回归外推为最终全功能重验。

实机已确认默认空白集 docPaths=[]、当前集重复选择仍只有一个脑图、切换后所有标题即时更新，左栏样式已重载可见。Sol测试集已正常UI移除；cards/nodes/edges/docMeta/学习集/文档/复习/设置与Sol起点相等，仅原画布lastVisitedAt及运行元数据等导航状态变化。data SHA `279cee991a2852509e7e801bdf41daa754ad0b9ab02b77c4fae6efc9f118f71c`。前一轮Luna留下的P10对照集/PDF/两个空图仍保留。MN4脑图已恢复显示；前一轮“空脑图全部禁用”实际是隐藏脑图，已更正矩阵，未据此批量禁用工具。未发AI请求，正式yan/WorkBuddy保护哈希未变。无运行命令，等用户切Luna继续同状态对照。最小读取：[本轮完整记录](../../evidence/package10-20261026/sol-ui-fixes.md)、[总矩阵](../../evidence/package10-20261025/mn4-interface-matrix.md)。

## 2026-10-26 交接停点

用户要求新建空白对话，当前对话已停止代码、构建、部署及桌面操作。无运行命令。新对话为唯一执行方，界面对照用Luna，源码分析和修改用GPT-6.1 Sol、中等推理。最小交接文档：`/var/folders/t6/drs3g4rn65584bfmzxqhq4_r0000gn/T/marginstudy-p10-handoff-20261026.md`。

本日未改代码或重复自动回归。MN4与Obsidian均通过Window > Fill放大；MN4截图为`evidence/package10-20261026/mn4-filled-ai.jpg`。同一唯一合成PDF已复制到验收库根目录并通过快速切换器自动接管为自定义Reader，已加载1页；当前打开独立Reader，尚未建立对应Obsidian学习集。操作前数据快照`evidence/package10-20261026/acceptance-data-before-comparison.json`；当前验收data SHA256为`962ac49950cdd4cf10c8201e208da16ca66c5f27bbea40ab036130b2a58b5c57`，仅documents、revision、savedAt与该快照不同，其余业务键相等。第10包保持未关闭。

## 2026-10-25 当前执行结果（覆盖下面较早的“剩余任务”停点）

第10包仍在执行，不能宣称全界面与 MN4 已整体等价。此次继续完成图片 AI、MN4 独立样例复习与 AI 核心链路，并重建正式候选包。

- Claudian 图片入口在 Claudian 2.3.30 上通过真实请求：只发送独立合成图和问题，回复正确识别文字 `P10IMG742`、蓝色正方形、红色圆形。回复留在 MarginStudy 面板；图中无学习集或私人笔记内容。截图和可访问性树：`evidence/package10-20261025/claudian-image-fix/real-image-response.png`、`.ax.txt`。图片接口红绿测试、AI UI 25项和相关版本防护测试通过。
- MN4 原版样例未改。用户授权后新建独立学习集 `P10-Isolated-20261025`、独立牌组 `P10-Isolated-Deck-20261025`、唯一合成 PDF 和一张法国首都卡。复习真实启动 1/1，翻面后四档显示 Again 5m / Hard 10m / Good 1d / Easy 2d；Good 实际提交后正常到达末卡并结束。记录见 `evidence/package10-20261025/mn4-isolated/review-rating-options.png`、`review-one-good-completed.ax.txt`。
- MN4 单独 `Chat` 菜单项仍禁用；但选中合成卡后的 `Add to Chat` 可用。通过该入口把卡加入 Chat，提问后 MN4 AI 实际返回 `Paris`。问答截图和树：`evidence/package10-20261025/mn4-isolated/ai-synthetic-response.png`、`.ax.txt`。启用态面板其余模板、附件和失败状态未核验；不推断 Chat 禁用原因。
- 最新源码 `main.js` SHA256 `51ff617372ebfe1279cf5f5e06a7366c154277e90adace106057095256369434`；`styles.css` SHA256 `d4c0167df0e7204f02212677ca336eb132ec914e47fd022a88ed5e9a23950ffa`；manifest `1.2.12`（SHA256 `905813cfbf218025870d606eea9b7592d91c4eeedd8ea8d78c6f3f642304e8a2`）。开发、正式yan和验收库 main.js 哈希一致。正式 data SHA256 仍为 `42dbf086f475b44dc5878bd5b262033bba487a77cfce7d9b91c149b83230a7eb`；验收库 data SHA256 `2564b8f6d75c65347cb9e295c2fc98a6f811c488edeba24529f7a87303e12619`。安装与本次图片请求前后数据未被程序包替换；未读写 Claudian 配置/密钥；WorkBuddy 保护 main 目标哈希保持 `be2bbfec…b376fe9`。
- 最新全套 `npm run verify`：21/21 suites 通过，Reader 200/200、Workspace 125/125、AI UI 25项；完整结构化结果 `evidence/verification/results.json`。候选安装包19文件 SHA256 `1075d7487fc08030213891f6253381b5d26bbcdacd54e26b047cf7a2eda47407`；265文件源码归档 SHA256 `9c89c4d76fb0be48c0ae12454cbb60e95a4357160b95363ee5df9417e0c1d14f`。路径 `evidence/package10-20261025/delivery-final-20261025/`。隔离干净安装、升级、回退与data保留验证通过；此 package builder 只做隔离宿主验证，实际 Obsidian 实机证据单独记录在上述及 `native-takeover-fix/host-result.json`。
- `evidence/package10-20261025/mn4-interface-matrix.md` 已更新 Review/AI 行。其余框架、阅读工具、导航、菜单、编辑器、手写、页面编辑、脑图、Research、设置等仍缺同尺寸/同状态逐项对照；整体视觉等价尚未证明。牌组、学习集、合成卡和文件保留为独立具名样例以便查看，不接触原 MN4 样例。第10包保持执行中。

更新：2026-10-25。第10包仍未关闭。用户要求本轮解决两项AI问题后转到新空白对话，继续使用Sol；本会话结束代码、构建和桌面操作，由新对话唯一接手。目标仍是除微小部分外与MN4一致。

## 用户最新确认的 AI 需求与本轮实测

用户澄清“回复自动到AI界面”指 **在MarginStudy内提问得到的回复**，无需接通当前Codex聊天，也无需用原生Claudian监听替代。

正式yan宿主当前构建已实际验证：中心选中合成节点 `SOL_MAP_REPLY_825` → AI上下文显示该节点 → 在MarginStudy输入框提问 → 回答 `SOL_MAP_REPLY_825` 直接显示在同一MarginStudy面板，出现“制作卡片预览”。没有跳转Claudian手动发送、粘贴或启用回复监听。仅发送这条合成材料，一次请求，无私人内容。证据 `formal-ai-final-combined-result.json`、`formal-ai-final-combined-safe.txt`、`formal-ai-final-combined.png`。

本轮合成节点、学习集 `P10-AI-FINAL-SYNTHETIC` 已通过正常UI删除，AI新会话/草稿空。正式业务数据逐键与测试前相等：settings、cards、nodes、edges、srs、docMeta、reviewHistory/logs/pending、templates/decks、studySets、canvases、documents、workspaceState均相等；仅revision/writerId/savedAt变化。最终6卡/3节点/0边/1文档/0学习集/0脑图。data SHA `42dbf086f475b44dc5878bd5b262033bba487a77cfce7d9b91c149b83230a7eb`，未手工替换data或修改Claudian配置。

## 本轮新增真实缺陷：恢复提示重复堆积

正式工作区曾看似黑屏；经原生DevTools只读取DOM计数，实际已挂载1个工作区与1个AI面板，却累积721个恢复来源弹层。验收库亦观察到76个。`formal-recovery-modal-storm.json`保存计数；未读取/发送私人正文。REA运行时诊断缺现成CDP端点，未开调试端口，最终使用宿主DevTools定位。

新增 `src/documents/recoveryPrompts.ts`：同一缺源文档每次插件启动只提示一次，关闭/稍后处理后不再随每次扫描反复弹出；不同文档仍可独立恢复，恢复失败可原窗口重试；卸载关闭残留弹层并禁止异步再打开。`src/main.ts`改为使用该组件，并忽略插件备份/恢复目录的文件创建事件，避免内部PDF副本触发无意义恢复扫描。

通过既有可见DOM seam做TDD：连续扫描100次只留一个提示、Later不改关联且不重弹、另一来源可显式恢复、下次插件启动可重新提示、卸载清理。红123/124（重复弹层）→绿124/124；日志 `recovery-dialog-storm-red-results.json`、`recovery-dialog-storm-green-detail.log`。修复后的yan正式窗口真实重载、打开及AI流程通过；关闭提示后未再堆积。验收库磁盘已更新，但此修复的验收窗口最终重载留给新会话。

## 当前构建、回归、安装和保护

- main SHA `50b486390a6ae3917f825080d5dd873415f0d81df196357d3a72cd71a51e5bb0`，styles `d4c0167df0e7204f02212677ca336eb132ec914e47fd022a88ed5e9a23950ffa`，manifest仍1.2.12。
- 开发/验收/yan的19个程序/runtime文件哈希与权限逐项一致，`program-audit-recovery-final.json`。正式安装前后data均c30731e1…，程序备份 `formal-plugin-backups/before-recovery-fix/`；此前所有快照保留。WorkBuddy保护main仍be2bbfec…b376fe9；PDF++关闭、MarginStudy开启；未读写Claudian连接配置或密钥。
- 当前50b486构建全套21-suite全部通过，Reader200、Workspace124，见 `full-verification-recovery-final.json` / `.log` 及冻结 `verification-recovery-final/`。无运行测试或构建，无需重复同一构建的全套。
- **最新候选目录 `delivery-recovery-fix/`**。安装ZIP19文件，SHA `b572f060215ebe466556919a63003d4edaa97a72be70128e083327703a13f4cc`；可复建源码265文件，SHA `e924cb08a51ac983d4afc8e733b97b87e30099b8bf6c4cd281113e89d56bcc50`。含全部拆分CSS/native-src/原生runtime。`scripts/package-release.py`可打包/备份程序安装/回退，始终不替换data；完整清单见目录中manifest/identity。旧11/252文件包作废，旧 `delivery-complete-latest/` 是7256历史构建，不能作为50b486最新包。

## 此前本包已验证，避免重复

- Link旧七行菜单已按MN4实点改为四模式单击循环，持久化/重载通过：`link-mn4-observations.md`、`link-host-audit.json`；图标像素/提示位置尚未精确量测。
- Claudian2.3.30直接文本、AI卡片编辑保存重开、真实AI TOC生成保存重开、Markdown来源跳转已有合成证据；原生Claudian回复监听也是独立已测能力。证据 `formal-ai-2330-result.json`、`formal-ai-saved-card.json`、`formal-ai-toc-result.json`、`formal-markdown-source-link.json`、`formal-ai-native-autosync.json`。不再把本轮用户需求误当作原生回复监听。
- Reader短末页目录跳转、窗口改变后定位恢复、新PDF首次fit三个缺陷已修并在7256构建实机通过。见 `toc-position-real-result.json`、`first-fit-real-result.json` 及对应红绿日志。50b486未再改Reader/Workspace，仅加入恢复提示组件与回归用例。
- 19文件完整包真实更新→回退→重装→重载曾在d4a759/cc4da构建间通过：`host-package-update-rollback-result.json`。安装器未变，不能将该旧运行时证据写成50b486各业务都重验。
- 7256完整包在独立干净Obsidian库首次启动、空数据初始化、PDF首次fit和关闭库后重开通过：`clean-host-install-result.json`、`clean-host-*.png`。测试库关闭、登记移除，目录保留 `retired-clean-install-vault/`，无外部请求；误开的父目录登记/配置也已清理，配置有备份。50b486后续修复边界明确。
- 验收两份合成Reader PDF均经UI移入系统Trash，原26文档、原docMeta、卡/节点/边/学习集等相等，保留2条missing记录和测试TOC元数据；默认scale起点.569、当前1.098的差异保留，未改data强制恢复。见 `reader-fixtures-cleanup-audit.json`。Trash未清空。

## 2026-10-25 历史剩余任务（后续进展见顶部）

1. 先按新构建重载验收窗口，确认恢复提示不堆积；不要重复正式库AI请求或全套回归。
2. 继续 `mn4-interface-matrix.md` 的完整页面/菜单/模板及状态对照；当前矩阵仍是缺口索引，不能宣称整体视觉等价。已认可的宿主适配和微差边界保持。03/06历史关键缺口要更新而非消失。
3. 此项旧缺口已被后续证据覆盖：Claudian2.3.30合成图片实际回流、MN4 Add to Chat实际Paris回复均已通过；保留2.3.21图片禁用的版本边界。具体见本报告2026-10-25当前执行结果。
4. 此项旧缺口已修复：宿主稳定后扫描接管，原生启动/文件列表/快速切换器三条真实路径已通过，见本报告native-takeover-fix后续记录；旧失败保留为历史复现依据。
5. 剩余对照修复后再确定最终发布版本、重建包、按实际改动回归并审计。第10包不因本轮两项AI修好而行政关闭。

新会话最小读取：本报告、共用规则、实时清单、10任务书、MN4矩阵。当前正式窗口正常、合成内容清理，AI问题空；验收窗口仍开但待加载50b486。无其它写入者或运行命令。

## 2026-10-25 新空白会话继续（执行中）

验收窗口已重载50b486，关闭单个缺源提示后无堆积。新增定位并修复原生PDF自动接管：`file-open`在宿主视图切换结束前触发，立即替换会被原生操作覆盖；改为与layout-change共用250ms稳定后扫描。公共宿主适配器+真实Reader测试红124/125→绿125/125，typecheck/build通过。19文件候选`delivery-native-takeover-fix`已备份后仅部署验收库，原生启动、文件列表、快速切换器三条真实接管路径通过；合成P10-AUTO-TAKEOVER PDF已UI移入系统Trash，未清空。证据`native-takeover-fix/host-result.json`。正式yan仍50b486，未在本轮更新。全MN4矩阵、图片链路及最终发布仍继续，未关闭第10包。

用户已明确允许另建独立MN4合成样例补测AI/复习；不得改原有样例。不再以“用户禁止造新样例”作为阻塞。当前唯一执行方为本新空白会话，无并行代理。
