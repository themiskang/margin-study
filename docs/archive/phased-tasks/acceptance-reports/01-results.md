# 01 Extend 完整闭环结果

更新：2026-10-23。**按用户2026-10-23确认的核心流程标准收口**。R1/R3列明场景通过；R2裁剪、文字缩窄与R4跨类型持久排序已取得实机证据并修复插件。细小呈现差异与精确最小尺寸参数仅列备注，不再阻塞后续包。用户授权01/02交替，当前回到01；第二包既有改动保留。

## 本轮完成

- 图片菜单补齐 **Copy、Cut、Crop、垃圾桶**。原版4.4.6实测：Copy粘贴新增图；Cut暂不移除源图，Paste成功才移动。插件系统PNG剪贴板、延迟剪切、跨纸面一步撤销/重做及重开已实现；源图片被改动时拒绝陈旧剪切，不写入陌生HTML。
- 真实Obsidian验证Copy新增图、Cut源图保留、Paste移动且不改兄弟图、阅读区撤销恢复x=.06、重做/保存/重载后x=.3490683229813665。自动测试补的是ReaderView/可见DOM既有入口。`image-clipboard-native-comparison.json`。
- 图片选中边框改为原版蓝色、3 CSS px（原版截图6屏幕像素），三角柄12 CSS px；四项菜单目标宽189 CSS px，原版378屏幕像素；垃圾桶复用实心轮廓。局部菜单/边框修正，不代表整个多图纸面几何等价。
- Basic未成卡菜单宽1168→1248屏幕像素，原版参照1252；菜单主体高约137/136。调整页签/颜色/操作行间距及标签实心图标；所有入口仍在。`basic-spacing-native-comparison.json`、`obsidian-basic-spacing-final.jpg`。本轮另取得4.4.6当前截图`mn4-basic-446-current.jpg`，主体横向端点368..1619，确认1252px范围；历史截图仍保留原身份。
- 既有纯文字Margin、Favorites、空评论字体/禁用态等修复保留：Helvetica Regular20显式同配置局部配对；占位13px、顶边相对245px/字高19px；灰字有3px渲染差。此前已通过场景不重复测试。

## 本轮续接：纯文字导出与 Advanced

- 原版4.4.6非空文字留白的Advanced确认为Add Review、Speech、Research、Export Card；空留白仍只有两项。插件按非空文字显示四项，四项菜单主体宽均594屏幕像素。Speech使用独立瞬态队列，支持暂停/继续、前后段、重播、关闭及Reader关闭清理；Research显式搜索当前留白文字，保留配置的模式/引擎。未推定来源和独立评论的任意朗读次序。
- 真实Obsidian通过重播→暂停（出现继续）→继续（出现暂停）→关闭；Research网页搜索框精确为`P01 Export pairing 20261022`。当前验收配置是Video/BiliBili，原版为Text/Bing，未擅改配置。自动179/179 Reader、100/100 Workspace覆盖新增公共入口和数据不变。图标仍为近似轮廓，不能据此声称完整呈现等价。
- 纯文字Helvetica16显式同内容配对：PNG均1200×60；原版文字包围盒[82,19,493,49]，插件[83,19,493,49]。PDF均单页600×30，已实际保存、渲染并查看。原版PDF为可搜索矢量文字，插件PDF仍是栅格；原版黑色、插件当前配置#111111，保留差异。修复仅作用于独立纯文字导出，不外推混合/来源卡。
- 接手原版合成PDF显示空白，检查Document Crop后以完整选区Done恢复正文；没有新导入文档。Native/Obsidian两端新增文字探针均通过正常Basic删除；原三节点保留。`plain-advanced-native-comparison.json`、`plain-export-pdf-comparison.json`、`plain-advanced-round-audit.json`。

## 检查与部署

| 检查 | 实际结果 |
|---|---|
| 新图片行为红例 | Reader167/168，失败为图片缺少Copy；`image-clipboard-red.log` |
| 图片实现首轮 | typecheck/build、Reader168/168；`image-clipboard-green-*` |
| 最后图标构建当轮 | typecheck/build、Reader168/168、Workspace99/99通过；工具执行结果已记录 |
| 暂停期间后续共享源码回归 | Reader177/177、Workspace99/99；`image-clipboard-final-*`实际为14:00复制的共享源码结果，含第二包新增用例，不伪记为首轮168结果 |
| 纯文字导出红绿 | Reader177/178→178/178，typecheck/build通过；`plain-export-red*`、`plain-export-green-*` |
| Advanced红绿及最终共享源码 | Speech缺失178/179、Research缺失99/100；最终typecheck/build、Reader179/179、Workspace100/100通过；`advanced-actions-final-*` |
| 最新Basic样式/标签 | typecheck/build通过；最后页签CSS微调build通过，真实宿主命令重载与截图通过；`basic-spacing-*log` |

仅部署验收库main/styles；未替换data/manifest/pdf.worker。当前共享构建含保留的第二包改动。最终命令重载已完成；`deployment-r2-r4-confirmed.json`为最新。Speech/Research已完成真实宿主验证并清理。

| 开发与验收库产物 | SHA256 |
|---|---|
| main.js | `ebdccdec61f0acb48380a87872a39874488b577e03409851685da85f281ea507` |
| styles.css | `fc883e000bc0e9c88781291e6dcf8ab30d5a3c994e79ad3bb79e364159967e5f` |
| manifest.json（1.2.12） | `905813cfbf218025870d606eea9b7592d91c4eeedd8ea8d78c6f3f642304e8a2` |

源码回退：`image-clipboard-before/`、`basic-spacing-before/`、`plain-export-before/`、`advanced-actions-before/`。当前共享源码归档 `r6-source-20261023-r2-r4-confirmed.tar.gz`，SHA256 `989e3cd8c679f45a99c8726d0d6e40fa4dc60f6b41caab4987c3d927cf7ed5ad`；身份清单`r6-source-r2-r4-confirmed-identity.json`。不含验收库data、相机素材、Claudian配置或node_modules。此前placeholder/image-basic归档仅作历史。

## 数据与保护

- 图片探针`extend-mvj0anqb-rto0q1`已正常UI删除；即时清理后cards/nodes/edges/docMeta/学习集/复习等全部业务对象与起点严格相等。图库本轮单张合成图片可恢复删除，Library空，未purge；原版本轮组合纸面正常Basic删除。
- 暂停后01/02交替期间，documents新增`package02-l4-fresh.pdf`（missing登记）与`MarginStudyImports/page-assets/pdf-mve2jdnz-2kegmv.pdf`。既有13条登记未改；本轮不删除后续包的两条登记。不能把这段跨轮数据称为整份相等。`image-clipboard-round-audit.json`。
- 最新Basic空探针已正常UI删除、保存重载；本轮13项业务键（含documents）与接手时15条登记基线严格相等，仅保存元数据/workspaceState变化。`basic-spacing-round-audit.json`。
- 本轮纯文字/Advanced探针`extend-mvjcf9wi-8m5a5i`已正常UI删除并重载。13项业务键与纯文字轮起点严格相等，含15条documents；仅workspaceState/保存元数据变化。`plain-advanced-round-audit.json`。完整data回退分别在验收库插件`package01-recovery/plain-export/`和验收库根`package01-recovery/advanced-actions/`，不进入开发证据。
- 早轮含完整data的回退只在验收库`.obsidian/plugins/margin-study/package01-recovery/ink-images-446/`、`basic-spacing/`。历史10张hidden卡和missing登记保留；未清空回收站，未重拍相机。
- WorkBuddy/yan两处保护main均仍为`be2bbfecf7f32a558c53af1f2ae2bfee10178e9f84b3024b5c5c60721b376fe9`。未改真实笔记或Claudian配置。

## 已确认的 R2/R4 与 Qoder 接续

- 已先读用户指定的Qoder交付和MASTER-INDEX；原记录对应70f2842b，保持其当轮partial与方法披露，不把源码能力改写成其当轮实测结果。新增Codex补证见Qoder目录`01-extend/CODEX-SUPPLEMENT-20261023.md`。
- R2原版真实裁剪保存蓝半幅，重开仅蓝图、Reset禁用。插件改为每次以当前已提交位图开始；不再从旧edit元数据恢复历史原图。Reset仅重置当前草稿，取消/切文档不提交。真实Obsidian拖动→Done→重开同样蓝图/Reset禁用，`obsidian-r2-current-bitmap-*.jpg`。旧像素由撤销历史恢复。
- R2原版定位文字框现已成功缩窄、两行变三行；再次放大能显示完整文字，缩窄状态关闭/重开保留。Arial11/italic/red/yellow是继承的合成配置。精确最小宽高仍未确认；未把无变化/长按摘录菜单算作下限证据。`mn4-r2-text-system-contract.json`。
- R4原版独立文字＋附加手写经连续拖动，Done后、关闭重开编辑仍为手写在前；未测应用重启。`r2-r4-confirmed-native-contract.json`。插件在既有卡编辑/保存路径新增稳定commentOrder，普通back、来源文字/图像、附加媒体跨类型排序，草稿取消不提交；Reader来源对象不重排。脑图及Export Card使用同一顺序。
- 真实Obsidian合成卡保存`media:comment-mvjlkr9q-pmx3k6,back`，Undo恢复无附加评论的原卡、Redo恢复，实际宿主重载后次序保留；PNG与实际保存PDF渲染均为来源→手写→独立文字。`obsidian-r4-cross-type-*.jpg`、`obsidian-r4-cross-type-order.png/.pdf`。PDF仍栅格，不冒称原版矢量。
- Qoder文字卡同源脑图已补证，但部署前基线**已经存在**目标node；不能声称新增点击才修复缺失。Normal/Margin/Collapse已通过实际UI按钮补证；不把API设置图当点击证据，也不把不同视窗下72%/82%直接判为新缺陷。

## 最新回归、清理与保护

- Crop新契约红例Reader178/179；R4实际Workspace红例99/101（其中一项为旧spread-fit偶发，未因它改02源码），修复后typecheck/build、Reader179/179、Workspace101/101通过。新增来源评论跨类型/取消测试后typecheck/build、Workspace102/102通过；旧spread-fit未复现。`r2-r4-confirmed-{red,green}-*`、`r2-r4-source-order-final-*`。
- 仅复制验收main/styles，部署时data哈希前后均`fc14d6dca73f269e7cd06bd215b5dc99bd86776413168b3edc5f9e42143d300e`；真实命令重载通过。完整data回退仅在验收插件`package01-recovery/r2-r4-confirmed/`，开发证据只含合成对象及摘要。
- 三条Qoder01留白正常Basic删除；两张目标卡/节点转hidden；合成PDF经Obsidian确认移到系统回收站，保留missing登记；脑图合成根正常菜单隐藏。Qoder02 mixed/long30文件与l4/mixed docMeta不变。排除精确列明01目标及canvas.lastDocumentPath工作区元数据后，18项非目标业务键严格相等；`r2-r4-qoder01-cleanup-audit.json`。
- 原版R2/R4与文字框探针正常删除，唯一新导入Photos合成图可恢复删除，Library空；Qoder第一包P01文字纸面正常删除，第二包额外节点保留。未purge、未重拍相机。两处保护main仍为基线`be2bbfecf7f32a558c53af1f2ae2bfee10178e9f84b3024b5c5c60721b376fe9`。

## 验收范围与非阻塞备注

| 关口 | 状态与边界 |
|---|---|
| R1 | 列明三模式几何/工具避让/历史/宿主重载通过；Qoder新图配置不同，未外推全窗口像素等价 |
| R2 | 图片裁剪成功提交/重开规则已确认并修复；文字成功缩窄/换行/关闭重开已确认。**文字与图片精确最小尺寸未确认**，不将当前12/16px防零面积限值冒充原版值 |
| R3 | 列明归属、删除恢复、历史、重载及插件PNG/PDF顺序通过；原版组合Undo/导出边界保留 |
| R4 | **独立文字＋手写持久排序已通过原版与插件实机**；插件保存/Undo/Redo/宿主重载/PNG/PDF顺序通过。来源评论跨类型另有公共入口自动测试；未声称原版应用重启已测 |
| R5 | 已列Basic/Favorites/空评论/纯文字Margin/图片菜单等局部修正通过。仍有评论手柄额外上下按钮/字形、同尺寸多图纸面、最小态、PDF栅格对矢量等差异；按用户最新口径列为非阻塞备注，不再追求所有状态像素等价 |
| R6 | 当前部署、合成清理、非目标审计、保护哈希和源码归档已刷新；后续代码变更须再刷新 |

OS权限已由用户手动授予且预检true，已授权范围包括R2图片裁剪、R4排序，后续明确扩展至文字框合成测试；旧“等待系统授权”结论已失效。早期激活但未Raise导致窗口遮挡的事件不用于结论；最终辅助程序执行前检查AXRaise、前台和目标点窗口所有者。未越权使用其他系统自动化。

最小接续：本报告、`mn4-r2-text-system-contract.json`、`r2-r4-confirmed-native-contract.json`、`r2-r4-qoder01-cleanup-audit.json`、`R5-视觉状态矩阵.md`。01已停止执行并交接02，保持单写入/单桌面，不回滚02、不读取旧聊天、不重跑相机。


2026-10-23用户明确要求不再纠缠细枝末节，优先趁MN4试用仍可用推进后续包。第一包核心创建/编辑/成卡/联动/历史/重开/导出/清理收口；以上未知参数与小幅呈现差异不被伪记为实测通过，也不再阻塞切包。下一执行归属为02，优先补原版Annotated启用态，修复真实Save面板Replace被拒绝。
