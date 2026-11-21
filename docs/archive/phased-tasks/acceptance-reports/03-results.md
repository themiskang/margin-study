# 第03包：阅读器与文档工具结果

## 2026-10-26 跨包证据更新

第10包已补齐此前暂缓的Claudian2.3.30真实文本回答、卡片编辑保存重开、AI TOC生成保存重开、Markdown来源跳转与原生回复监听；证据为 `evidence/package10-20261025/formal-ai-2330-result.json`、`formal-ai-saved-card.json`、`formal-ai-toc-result.json`、`formal-markdown-source-link.json`、`formal-ai-native-autosync.json`。2.3.30独立合成图片实际识别并回到MarginStudy的证据为 `evidence/package10-20261025/claudian-image-fix/real-image-response.*`。这些旧缺口已被后续特定版本/场景证据覆盖，不能继续当作全局未实现。

当前验收库Claudian为2.3.21，图片直连入口按版本禁用；本轮没有重复外部模型请求或修改其配置。当前P10修复候选main `9b984423…`，预设菜单已对齐None/Guide/Quiz/Explain，受影响回归与实机菜单确认见[Sol记录](../../evidence/package10-20261026/sol-review-ai/README.md)。完整界面、硬件/服务限制和最终验收仍按[第10包报告](10-结果.md)及总矩阵推进；本补记不扩大旧证据的构建或场景覆盖范围。

以下2026-10-24段落保留当时实现、版本与保护事实，其中“真实请求未测/图片仅手动”等状态以本补记为准。

日期：2026-10-24。状态：**进行中，未关闭；Claudian 直接调用与独立收尾已完成**。不启动04，不启动并行执行方。
范围：原07、12—16；完整关闭要求以03任务书/共用规则为准。测试计数不表示需求覆盖率。

## 已完成的用户流程与呈现

- 修复PDF多栏文字顺序、OCR快速重新启用/清缓存刷新丢失、卡片标题全局字号、旋转自由元素局部轴缩放及删除PDF批注后页边编号残留。实现辅助文字/图片识别框与显式批量摘录、HTML图片精确来源锚点、Margin编号/脚注显示设置。
- 目录创建、改名、删除、缩进、键盘换序、撤销重做、保存重开及导出；Word/HTML重排和卡片回原文；自由文字35度旋转、独立图片裁切/像素旋转与重开；MP4/WAV真实播放重开及缺源提示通过列明场景。
- **本次新增Claudian目录流程**：用户询问能否直接使用Claudian后，学习助手与 AI TOC 都可直接调用 Claudian 当前选中的模型，回答流式回到 MarginStudy；目录回复先进入标题/层级/页码预览，校验后保存并支持撤销。通过本次请求专属的隔离执行会话，不读取 Claudian 聊天记录、设置、密钥或输入框；取消/超时/连接失效会结束本次会话。未知版本保留手动复制/粘贴回退；图片仍需在 Claudian 手动附加。
- 最新直连构建已部署并重载。实机此前的一次合成问题返回 Claudian 连接错误；用户已暂缓配置模型，因此真实回答、原生目录保存/重开尚不能验收。原来的1459字未发送问题已恢复在 MarginStudy 输入框，没有发送。AI TOC意为“AI自动生成文档目录”。
- 全部需求、自动/宿主/MN4证据及各自限制见 [完整证据矩阵](../../evidence/package03-20261023/acceptance-matrix.md)。该矩阵是验收边界，不把菜单截图或历史证据扩大成全组合通过。

## 代码与部署

主要改动位于`src/pdf/readerView.ts`、`annotationLayer.ts`、`imageRegions.ts`、`textColumns.ts`；`src/annot/baseController.ts`、`overlay.ts`；`src/word/htmlAnnot.ts`/`wordReader.ts`；`src/cards/nativeEditor.ts`及相关字体渲染；`src/workspace/documentNavigation.ts`/`studyWorkspace.ts`、types及相关styles。具体原始回退快照保留在本包before-*及deploy-before-*目录。本次增量快照保留在`before-direct-claudian/`及`before-claudian-toc/`。

| 产物 | 当前开发=验收SHA256 |
|---|---|
| main.js | `c87c2e5a05a2eca8df111bdb44ce68a54095bf07d7a0976d1850646ce9e98294` |
| styles.css | `46f72232b8199bfc8079038092ade45e3dd800cb9b5826e97e12ce19c2cb1408` |
| manifest.json | `905813cfbf218025870d606eea9b7592d91c4eeedd8ea8d78c6f3f642304e8a2`（未改） |

唯一部署目标为验收库插件，只部署main/styles；data/manifest/worker/helper未覆盖。最新安装与重载状态以`deployment-direct-claudian.json`为准；仅同步main.js与styles.css，data.json部署前后SHA均为`b5b3f25b326db07114ca0fdaf26a7b9c83015660fd7652826a851f65ba0ec5dc`。

源码归档`evidence/package03-20261023/source-package03-20261024.tar.gz`，SHA256 `bfad96376e97c53bef96731aac8f40ab93dbeb27310e7cbfea684e913b4afcc1`。包含225个源码/构建/运行文件，已从归档逐文件验证；完整清单在同名`.identity.json`。不含验收data、外部凭据、node_modules或历史证据。恢复应先解压到新目录，不覆盖验收data/正式库。

## 验证

证据根均为`evidence/package03-20261023/`，除明确复用的前包材料。

| 对象 | 实际结果 | 证据 | 尚未覆盖/版本边界 |
|---|---|---|---|
| 本次自动回归 | typecheck/build通过；Workspace118/118；Claudian直接请求18/18；AI UI 18/18 | `direct-final-green.log`、`direct-validated-green.log`、`direct-config-green.log` | 直连适配依赖已安装Claudian 2.3.21观察到的私有执行结构；合成插件运行时不证明真实模型可用 |
| Reader/导出回归 | Reader193/193、PDF Save5/5 | `margin-delete-green.log`、`reader-tools-green.log` | 本次只增量修改DocumentNavigation，未修改Reader/导出。两份日志包含当时Workspace旧失败；后续定向修正并最终Workspace118/118，不写成原日志全绿 |
| 真实Obsidian1.14.5 | OCR刷新、辅助摘录、精确PDF/HTML选择与回源、Word重排、自由元素保存重开、音视频播放/缺源、编号删除刷新通过列明场景；相邻与重叠选择新增118/118合成UI回归 | 矩阵内逐项host-*；`host-independent-elements-audit.json`、`host-custom-toc-audit.json`、`margin-selection-links-acceptance-20261024.json` | 复杂多栏、跨页、旋转裁切与布局交叉组合仍只按各自证据范围通过，不扩写为完整MN4像素等价 |
| 最新Claudian原生流程 | 直连构建已重载；PDF AI TOC 窗口显示“通过 Claudian 生成目录”，本轮未发送请求 | `host-ai-toc-direct-entry.ax.txt`、`deployment-direct-claudian.json`；旧版合成回复预览证据仍保留 | 一次较早的合成请求返回连接错误；真实生成与原生保存/重开暂缓；公共界面自动保存/撤销已测 |
| MN4 4.4.6 L4 | Settings/选择/TOC创建改名缩进已观察；普通评论探针在双开关与切换文档后未显示脚注正文；独立 Extend 留白探针显示页边正文 | `mn4-observations.json`；`mn4-margin-semantic-probe-20261024.json`、`mn4-footnote-positive-*`、`mn4-adjacent-selection-20261024.png` | 本次样本中普通摘录评论不显示页边正文、独立 Extend 留白显示，按不同行为处理；未知的全部原版触发规则不作推断。宿主页边链接点击回源已通过定向UI回归 |
| 官方/L3依据 | 官方阅读设置与页边留白说明；旧MN3手册仅说明开关含义；既有六专题L3可作来源锚点参考 | probe JSON含官方URL；Qoder README及对应05契约 | 官方文字、静态类名均不代替MN4 L4。尤其不能据footnote类名断言评论就是脚注 |
| 前包复用 | 01已认可的小呈现参数不重开；02表单/目录/内外链实际缺口已关闭 | `02-结果.md`及其verification-summary、cleanup审计 | 复用当时已测场景；HEIC/极限资源/任意PDF扩展等未测范围保留 |

## 数据、清理与保护

- 本包3卡、6节点、2自定义目录条目及PDF/Word/HTML高亮已经正常UI清理；3源文档、3侧车、WAV/MP4和空媒体目录已通过Finder移到Trash，未清空。3文档从学习集成员移除，missing登记和新增docMeta保留；历史hidden/missing不purge。
- 本轮MN4探针摘录和独立空白都用各自Basic垃圾桶删除；探索时在旧U1打开的空白已立即撤销。旧高亮、Qoder卡片和文字框保留。Show footnotes=0、Margin Comment Area关闭、设置关闭；新增探针截图记录于`mn4-footnote-positive-*`，见`mn4-margin-probe-cleaned.png`和`mn4-margin-probe-restored-settings.ax.txt`。
- `final-protection-audit-20261024.json`：**15项原业务键严格相等**；cards15/nodes7/edges1，原docMeta及原20条登记严格相等，3新增missing登记准确保留；无活动测试文件/媒体目录。与直接请求前本轮快照相比workspace、settings、docMeta、documents、cards、nodes、edges完全相等；该快照保留用户打开的AI辅助区状态。
- settings 12项从未落盘变为显式默认值：appleOcrEngine=true、assistiveExcerpt=true、cardBaseFontSize=16、cardFontFamily=Helvetica、cardTitleUppercase=false、excerptAutoExpandRect=true、excerptLockColors=false、excerptPopup=true、hideKeyboardAccessoryBar=false、hideMarginNumbers=false、ocrSelectionCorrection=false、showFootnotesLinksOnMargin=false。scale从1.467→0.788是本包阅读变化；宿主跨日自动备份将lastBackup从2026-10-23更新为2026-10-24；其余原设置相等。不宣称整体data字节相等。
- 最新部署前后data哈希相等；恢复副本仅在验收插件`package03-recovery/20261023/`（直连验证基线在`direct-claudian/data-before.json`）；当前与该基线的业务/工作区字段一致，只存在`savedAt/revision/writerId`宿主保存信封变化。不能把before-cleanup数据覆盖当前库。
- 两处保护main均仍为`be2bbfecf7f32a558c53af1f2ae2bfee10178e9f84b3024b5c5c60721b376fe9`。未读取/复制Claudian凭据，未部署正式插件、未改真实笔记、未清空Trash。用户暂缓模型配置；部署后的本轮未再次发送模型请求。

## 未关闭项与下一步最小集合

1. 用户启用可用模型后，用合成PDF完成真实生成→预览编辑→保存/撤销重做→重开/来源跳转。直连功能已实现，无需另配直接API；当前真实生成暂缓。
2. 本次要求的两项非模型收尾已完成：MN4普通评论与独立Extend留白行为分别验证；宿主页边链接点击回到目标原文并闪烁锚点；同页相邻/重叠高亮下精确文本和PDF页几何回归通过，MN4可见跨相邻高亮拖选。所有其他布局交叉组合、MN4未观察到的脚注触发条件仍以矩阵边界记录。辅助识别不宣称公式/表格语义识别或完整PDF operator支持。

最小续接读取：本报告、`acceptance-matrix.md`、`deployment-direct-claudian.json`、`final-protection-audit-20261024.json`；具体MN4问题再读`mn4-margin-semantic-probe-20261024.json`。源码/保护审计与归档已完成，不再把它们写成未做。新源码变化时刷新归档。03未关闭，不自动进入04。

## 补充核对（2026-10-25）
当前共享源码已重跑typecheck/build、AI/Claudian/AI UI、Reader/deck/study/workspace相关回归，全部PASS（workspace119/119），未改源码或部署。现有验收库宿主证据仍显示模型不可用；本轮未发送请求，因此真实回答、目录保存/重开仍未关闭。补充审计：`../../evidence/closeout-audit-20261025/audit.md`。

## Obsidian 宿主复核（2026-10-25 后续继续）
本次直接在 Obsidian 1.14.5 的 `MarginStudy验收库 / L4SampleSet · MarginStudy` 学习工作区操作；AI 侧栏仅临时关闭以便查看阅读器，结束时恢复，没有发送请求或编辑 AI 草稿。确认 PDF 阅读器目录页正确显示“文档没有目录”及 `AI TOC` / `Edit` 入口；阅读设置面板实际列出翻页方向与五种主题选项；点击已有摘录卡的“跳转到原文”后，PDF 中对应原文区域显示锚点高亮。文档内搜索输入 `SAMPLE` 后显示 1/9，点击下一处变为 2/9，PDF 中命中词高亮。另切换到现有合成 DOCX 和 HTML 标签，确认 Word 80 段正文加载与 HTML 目录两条目可见；点击 HTML 的“能量转换”目录项后阅读器跳到对应章节。随后恢复原始 PDF 标签、搜索关闭及 AI 助手侧栏打开。以上是 Obsidian 宿主运行时补充正向证据，不覆盖未测的目录编辑持久化、重开、跨页/旋转精度，也不替代真实模型生成验收。未更改卡片、文档或设置。

## 2026-10-25 第10包后续真实AI证据引用

本日第10包在 yan 正式库对 Claudian 2.3.30 完成两项合成实机验证：MarginStudy 显式启用“自动接收下一条 Claudian 回复”后，新原生回复自动进入 MarginStudy；选中中心脑图合成节点后，AI上下文芯片显示该节点且真实回答引用其内容。证据位于 `../../evidence/package10-20261025/formal-ai-native-autosync.json` 与 `../../evidence/package10-20261025/formal-ai-map-context.json`。这些结果更新先前“未发送/无回流验收”的历史停点，但不关闭03包；AI TOC保存重开及全场景边界仍以本报告未关闭项和证据矩阵为准。Claudian图片路径未验。
