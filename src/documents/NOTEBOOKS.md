# 空白笔记本、文档笔记本与原页引用

`openNewNotebook(plugin)` 打开创建界面。`createNotebook(plugin, options)` 创建独立标准 PDF，并加入指定或新建的学习集、登记文档后保存；重复文件名自动加后缀，不覆盖已有文件。默认保存在笔记库的 `MarginStudy 笔记本` 文件夹，只接受笔记库内的相对文件夹路径。

四种纸张为空白、点阵、方格、横线。每页沿用统一 595×842 PDF 坐标；背景使用共享 PDF 图案，不伪造可选中文字。纸张元数据保存在 `%MSNOTEBOOK` 注释，原文件可由其他 PDF 阅读器直接打开。

`updateNotebook(plugin, file, patch)` 支持更改样式或追加页面，每个文件串行更新。更新前先等待批注保存，再把当前 PDF 与其元数据确定性重建结果逐字节比对；如外部程序写入了其他 PDF 内容则拒绝重建，以免覆盖外部修改。批注仍在原 sidecar，文档路径、批注 ID、页坐标、来源卡片关联保持不变。当前 1–500 页限制用于约束一次创建/重建体量，不等同于原版无限追加能力。

阅读器检测这类 PDF 后提供纸张选择和追加页面；它沿用真实 PDF 页面及画笔/自由荧光笔/橡皮/套索/区域摘录，支持独立文字框和真实本地图片插入、拖动/缩放、编辑/替换、删除与撤销，均可生成来源卡片。当前没有删页、裁边、自由元素旋转或音视频插入。

三类阅读器均公开：

- `getReaderToolbar(): HTMLElement`：取得原工具栏。控件保留稳定 aria-label，可以将真实控件放进工作区更多面板，或查询按钮后触发原操作。
- `setWorkspaceChrome(enabled: boolean): void`：打开前或打开后均可调用；隐藏作为阅读器根元素直接子元素的常驻工具栏，便于工作区提供统一顶部一行工具。重置为 false 恢复独立阅读器。
- `openHandwritingSettings(anchor?: HTMLElement): void`：打开当前文档的手写图层设置，传入工具按钮可定位锚点。
- `openDocumentNotebooks(): void`、`selectDocumentNotebook(id)`、`createDocumentNotebook(name)`、`getDocumentNotebookId()`：管理当前原文档的多套独立笔记。
- `getHandwritingMode()`、`setHandwritingMode(mode)`、`subscribeHandwritingModeChange(listener)`：真实五模式 `pen/highlight/eraser/lasso/off`，模式订阅只在变化时回调并返回退订函数。
- `getHandwritingSyncPreference()`、`setHandwritingSyncPreference(enabled)`、`subscribeHandwritingSyncPreference(listener)`：读取、保存或订阅文档级偏好；偏好订阅立即回调并返回退订函数。工作区连接真实模式 API 后通过 `setHandwritingSyncAvailable(true)` 开放设置复选框，独立阅读器未连接时禁用。同步工具模式，笔迹仍在各自页面/画布保存；工作区联动由工作区验收负责。
- `beginTextAnnotation()`、`insertImageAnnotation(file: File)`、`undoOverlayChange()`、`redoOverlayChange()`：独立文字/本地图片自由批注及对应类别的撤销，保留稳定工具 aria-label。
- `getEditHistoryState()`、`undoLastEdit()`、`redoLastEdit()`、`subscribeEditHistory(listener)`：按时序撤销/重做最近的手写或自由批注操作，状态订阅立即回调并返回退订函数。旧独立按钮是同一日志的按类别视图；任一新操作清除全部重做分支，切文件/本/层或数据冲突清空日志。此日志不包含普通文字高亮/区域摘录增删等其他文档操作。
- PDF 的 `openSearch(): void`：在工作区模式下显示独立可关闭的正文搜索浮层，不依赖隐藏工具栏。

PDF 的 `getState()`/`setState()` 额外包含可选 `scale`，保留各标签显式缩放，恢复不会改全局默认。旧状态缺少 scale 时保留原行为；非法值忽略。布局/位置、原页引用刷新与笔记本背景重建一起保留当前缩放。

## 文档级笔记本

同一源文档的所有笔记本保存在同一个 sidecar，`Annotation.documentNotebookId` 缺省为主笔记本 `default`；切换只改变可见和可编辑范围，不复制文档、不改批注或卡片身份。各笔记本分别保存当前手写层/参考层、折页、书签和 PDF 阅读布局，旧主本数据继续兼容。可叠加一个半透明只读参考本，回忆模式隐藏参考本，来源回跳自动切到批注所属本。

当前本为空时不能再新建空本，输入已有名称改为切换。删除当前本清空内容并保留本，删除非当前本移除列表项；主本永久存在。清空/删除切断卡片来源关联，保留已有卡片内容快照。未抬笔、语音录制等已开始输入仍归原笔记本。

## 原页面引用重组

`pageCollection.ts` 的 `.msref` 是小型 JSON 清单，保存集合 ID、稳定引用项 ID、原 PDF 路径与页码、原文档笔记本、排列顺序和内容策略。打开时由 `PageCollectionDocument` 按需读取原 PDF，用原来的 PDF.js 页面直接渲染，不创建合并 PDF、不写原文件。每页可查看原页面，目录按引用页顺序生成。

`createPageCollection`、`appendPageReferences`、`reorderPageReferences` 提供新建/追加/重排或移除 API；阅读器公开 `openPageReorganization`、`getPageReference(s)`、`openPageSource`、`refreshPageCollection`。清单限制为 1000 个引用项、2 MB；源必须为笔记库内 PDF，拒绝路径穿越、缺源、超页和重复引用 ID。

默认目录/页面新建采用 `clean`，不带原摘录/标注；`selection` 来源新建与追加采用 `include`。包含的文字/区域摘录实时只读映射源批注并保留源卡片身份，点击打开原文源批注；笔迹、自由文字/图片、语音和备注独立快照为新的本地批注 ID。只复制源活动手写层的笔迹/自由元素，跳过软删除批注，几何与 overlay 对象深拷贝。只有 `selection` 来源复制折页状态，目录追加不复制折页；尚无留白语义。创建面板可选择页码和包含策略，不能据此声称已有原版的所有选区上下文入口。

虚拟文档的本地批注在 `pdfReferencePages` 保存稳定引用项 ID；重排动态映射页几何，卡片和批注身份保持不变。删除引用项保留原文件和批注数据，回跳不再猜到其他页。各笔记本折页/书签跟随重排，修改前重读清单以检测并发更新。

主插件公开 `vault.on("rename")` 在源文档的 Store 路径迁移后调用 `updatePageCollectionSourcePath(plugin,oldPath,newPath)`，按返回的清单路径刷新已打开阅读器。函数仅更新活动 `.msref` 中 `sourcePath === oldPath` 的 PDF 引用，保留引用 ID/页码/策略与其余字段，不加载或改写源批注和 PDF 字节；备份/恢复目录不修改。使用公开 `Vault.process` 原子更新，保留期间发生的标题/顺序编辑，并按插件串行处理 A→B→C；无效清单不改，单个写入失败会提示但不阻止其他清单。支持源 PDF 文件本身的改名/移动；外部系统在插件离线时改名，以及只触发目录事件的整文件夹移动，尚未自动解析。快速连改时工作区应合并队列末尾刷新，避免短暂读取已不存在的中间路径。

上述行为在独立浏览器与模拟 Obsidian API 中验收，包含真实 PDF.js 多源页面；真实宿主、原版逐项操作与硬件仍需验收。
