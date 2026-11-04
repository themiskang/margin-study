# MarginStudy 代码审查与优化清单（v0.2.0）

审查范围：`readerView.ts` / `annotationLayer.ts` / `htmlAnnot.ts` / `wordReader.ts` / `mindmapView.ts` / `store.ts` / `main.ts` / `styles.css`
总体结论：类型检查通过、主链路可用；发现 **2 个真实 bug（必修）+ 4 个性能瓶颈 + 5 个健壮性/一致性问题 + 3 个体验增强**。

---

## 🔴 必修（真实 bug，改动小、风险低）

### A. 标注控制器的 `document` 级监听未清理 → 内存泄漏
- `annotationLayer.ts:44` 构造函数 `document.addEventListener("mousedown", this.onDocMouseDown)`
- `htmlAnnot.ts:48` 同样注册
- 但 `ReaderView.onClose`（`readerView.ts:93-116`）与 `WordReaderView.onClose`（`wordReader.ts:58-61`）都**没有调 `annController.destroy()`** 移除监听。
- 后果：关闭阅读器后监听残留，reader 已销毁仍被调用（脏调用 + 内存泄漏），反复开关多个 PDF 会累积。
- 改法：给两个控制器加 `destroy()`，在 `onClose` 里 `removeEventListener("mousedown", …)` + `removePop()` + 退出 pen 模式。

### B. Word 阅读器 `.ms-word-body` 缺 `position: relative` → 手写/语音 marker 错位
- `styles.css:20` `.ms-word-body` 定义里无 `position`；
- `htmlAnnot.ts:383/398` 的 `ms-ann-voice` / `ms-ann-pen` 是绝对定位（left/top 用 %），依赖最近 positioned 祖先。
- 后果：Word 里的语音/手写 marker 会相对错误祖先定位，飘到文档外或错位。
- 改法：`.ms-word-body { position: relative; }`（一行 CSS）。

---

## 🟠 性能（大文档/大 PDF 明显卡顿）

### C. 缩放时重渲染所有已渲染页
- `readerView.ts:173-176` `setScale`：遍历 `this.pages` 每个已渲染页都调 `renderPage` → 几百页 PDF 缩放一次就全量 `getPage`+渲染。
- 改法：只重渲当前视口内（IntersectionObserver 判定 intersecting）的页；其余页把 `renderedScale` 置 -1，等滚动/observer 自然重渲。

### D. PDF 标注增删是「全页重建」而非增量
- `annotationLayer.ts:361-366` `renderPage` 每次 `clear(annLayer)` 后重 append 整页所有标注；`createAnnotation:218` / `deleteAnn:517` 都走这条。
- 后果：一页 30 个标注时，每加/删一个都重建 30 个 DOM。
- 改法：维护 `id→el` 映射；创建只 `append` 新 div，删除只 `querySelector([data-ann-id])` 移除单个。

### E. Word 标注 `renderAll` 整文档 `innerHTML` 重解析
- `htmlAnnot.ts:317-320`：每次增删标注都 `body.innerHTML = originalHtml` 重解析整篇 + 重包所有 span。
- 后果：长 docx（几十页）每次点一下都全量重建，卡且丢失编辑中状态。
- 改法：增量操作——新增只 append marker / 单条 wrapRange；删除只移除对应节点，不整体重赋值 innerHTML。

### F. 导图拖拽每 move 全量重画所有连线
- `mindmapView.ts:205-212` 拖拽 `pointermove` 内调 `drawEdges` → `238-277` 清空重画全部 path。
- 后果：节点多时拖一个节点每帧重画全部边，掉帧。
- 改法：拖拽时只更新与该节点相连的边（按 id 过滤），或 `requestAnimationFrame` 节流。

---

## 🟡 健壮性 / 一致性

### G. `WordReaderView.onClose` 笔误 `this.destroyed = false`
- `wordReader.ts:59`：应为 `true`（与 PDF 侧 `readerView.ts:94` 一致）；或该字段本未使用应删。

### H. PDF/Word 两份标注控制器 ~90% 重复
- `annotationLayer.ts` 与 `htmlAnnot.ts`：选区捕获、pop、makeCard、onAnnClick、editNote、deleteAnn、removePop、showSelectionPop、typeLabel 几乎逐字重复。
- 后果：改一处要改两处，维护易漏。
- 改法：抽 `BaseAnnotationController` 或共享 util（坐标/偏移换算、pop、卡片、语音、手写）。

### I. `makeCard` 取 front 逻辑 PDF/Word 不一致
- PDF 侧 `annotationLayer.ts:486` 批注卡取 `ann.text`；Word 侧 `htmlAnnot.ts:447` 取 `ann.noteText ?? ann.text`。
- 改法：统一为优先 `noteText`（批注卡正文应为批注内容）。

### J. Word 重叠高亮会嵌套/重复
- `htmlAnnot.ts:332-379` `wrapRange` 重包后生成新 span；再次高亮重叠区时 treeWalker 会遍历到已生成 span 内的文本节点 → 高亮嵌套。
- 改法：标注前从已标注 span 取回纯文本，或跳过已标注节点。

### K. 删除卡片不清理标注的 `cardId`
- `store.ts:115-119` `removeCard` 不清关联标注的 `cardId` → 孤立引用（低危）。

---

## ⚪ 体验增强（可选，非必须）

- **L. 导图缩放/平移**：`world` 固定 2000×1400（`mindmapView.ts:54`），大导图放不下。可加滚轮缩放 + 拖空白平移。
- **M. 平板文本选中高亮**：`handleSelection` 依赖 `mouseup`，平板触摸选择文本不触发 → 平板无法「选中文字→高亮」。可加 `selectionchange` 监听。
- **N. PDF 文档内搜索（Ctrl+F）**：MarginNote 有，当前未实现。

---

## 建议优先级
1. **先修 A + B**（两个真 bug，共约 10 行改动，立竿见影且零风险）
2. **再攻 C + D + E**（性能，大文档/大 PDF 体感提升最大）
3. 结构债 H 与一致性 I/J 可并入后续一轮
4. L/M/N 看你需要再排

---

## 修复状态（v0.3.0，2026-07-28）
- ✅ **A / G / B**：v0.2.1 已修（内存泄漏 + 笔误 + `.ms-word-body` 定位），本版沿用。
- ✅ **C**：`readerView.setScale` 仅重渲视口内页（IntersectionObserver 维护 `visiblePages`），视口外页 `renderedScale` 置 -1 待自然重渲。
- ✅ **D**：`annotationLayer` 维护 `elMap`(annId→元素+scale+page)，`renderPage` 增量对账（仅新增/缩放变化项重建，已最新项跳过），`createAnnotation` 只 append、`deleteAnn` 只移除单条；`loadForDoc` 清理旧 map。
- ✅ **E + J**：`htmlAnnot` 增删改走 `renderOne`/`removeAnnotationEl` 增量（不再整文档 `innerHTML` 重解析）；`wrapRange` 跳过已处于 `.ms-hl` 内的文本节点，避免重叠嵌套。
- ✅ **F**：导图拖拽用 `requestAnimationFrame` 节流，且只更新与该节点相连的边（`drawEdgesFor` + `edgeEls` 索引），不再每帧全量重画。
- ✅ **I**：PDF 侧 `makeCard` 取 front 统一优先 `noteText`（与 Word 侧一致）。
- ✅ **K**：`store.removeCard` 清理关联标注的 `cardId`（写回 sidecar），消除孤儿引用。
- ✅ **L**：导图支持滚轮缩放（以光标为锚点）+ 空白处拖拽平移；`world` 改为 transform 缩放，`canvasWrap` 随缩放调整滚动区；工具栏加 放大/缩小/适应。
- ✅ **M**：两控制器选区捕获由 `mouseup` 改为 `selectionchange`（200ms 防抖），平板触摸选字也能唤起工具条。
- ✅ **N**：PDF 文档内搜索——工具栏 🔍 按钮 / `pdf-search` 命令（Ctrl+F 绑定）；跨页收集命中、↑↓ 跳转、文本层高亮，随页面重渲自动重绘。
- ⬜ **H**：PDF/Word 两份标注控制器 ~90% 重复。**本版刻意未做基类抽取**——属维护性重构而非性能/正确性优化，且无 Obsidian 运行时回归验证环境，强行抽取两个工作正常的控制器风险高、易引入回归。建议后续单独一轮、配单元测试再推进。

---

## 复查修复（v0.3.1，2026-07-28）——「再看看」发现的回归/缺陷

> v0.3.0 落地后复查代码，发现 5 处确凿问题（含 2 处 v0.3.0 优化引入的回归），均已修复并重建安装。

- 🔴 **PDF 标注首页/缩放后整页不显示（v0.3.0 回归）**：`renderPage` 的 `elMap` 增量判定在「页面尚未量好尺寸、pageH=0」的提前调用中生成了空元素条目，后续 `live` 短路误判为「已渲染」→ 真实标注永不画出。`readerView` 移除三处提前调用（observer / `buildPageShells` / `setScale` 中在页面尺寸就绪前对 `annController.renderPage` 的直接调用），标注统一改由 `renderPage` 末尾（页面已量好、pageH 可用）渲染；并给 `live` 判定加 `els.length > 0` 兜底。
- 🔴 **Word 重叠高亮偏移错乱（v0.3.0 J 修复留的坑）**：`wrapRange` 的 `continue` 写在 `total += len` **之前**，跳过已高亮文本节点时不累加偏移，导致第二条重叠高亮算错位置、标到错误文字。改法：先把偏移累加放最前，再对 `.ms-hl` 内节点仅跳过「包裹」、不跳过「偏移累加」。
- 🟠 **PDF 搜索每键全文档扫描**：`input` 直接调 `runSearch`，大 PDF 每敲一键就全页 `getPage`+`getTextContent` 扫描，直接卡死。改加 300ms 防抖 `scheduleSearch`，并在关闭搜索框 / `onClose` 清理 timer。
- 🟡 **Word `flashAnnotation` 仍整文档 rebuild**：与 E 增量理念相悖，改只读现有 `[data-ann-id]` 元素加闪烁类，去掉 `renderAll`。
- 🟡 **导图连线/平移体验**：连线模式点击节点文字连不上线（原判定 `e.target === div` 过严）→ 改为点击节点任意部位即连；空白拖拽平移加 `e.preventDefault()` 防误选文字。

---

## 全盘扫描修复（v0.4.1，2026-07-28）——通读 src/ 24 个文件后的硬核收尾

> 用户要求「继续全盘扫描」，本次对 `src/` 下全部 24 个 ts 文件做了完整通读（pdf/word/mindmap/model/audio/canvas/sidebar/settings/utils/main/srs/export）。结论：v0.3.1 的核心闭环（增量渲染、缩放、搜索、导图缩放平移、跳转高亮、K 清 cardId）均自洽，无功能级回归。但扫出 4 处确凿问题，全部修复并重建安装。

- 🔴 **`createModal` 的 Esc 监听器泄漏（全局内存泄漏）**：`utils/modal.ts` 的 `createModal` 给 `document` 加了 `keydown`(Esc) 监听，但 `close()` 只移除背景、未移除该监听；通过「点背景 / 点按钮」关闭模态时 `onKey` 永久残留，多次开模态会累积幽灵监听器。改法：`close()` 一并 `removeEventListener`，并让 `onKey` 直接调 `close()`，生命周期收口干净。影响所有模态（卡片详情、统计、Canvas 导入、文本/确认框）。
- 🟠 **`store.isDueState` 用 UTC 日期（跨时区差一天）**：`dueCards()` 用 `new Date().toISOString().slice(0,10)`（UTC）与 `srs.isDue` 的本地 `todayStr()` 不一致，东八区等时区在凌晨可能把「今天到期」判成未到期。改法：统一用 `todayStr()`。
- 🟡 **Word 加载时冗余 `setHtml`**：`wordReader.loadFileByPath` 在 `loadForDoc` 之前先调了一次 `this.ann.setHtml(result.value)`（此时 cache 为空、纯浪费渲染），`loadForDoc` 之后已再次 `setHtml`。删除首次调用，避免无意义整文档重解析。
- 🟡 **`innerHTML +=` 构建模态（重解析风险）**：`exporter.openStats` 与 `canvasIo.importCanvas` 用 `modal.innerHTML +=` 拼接统计行/提示语，存在重解析、潜在监听器丢失风险。改法：改用 `el()` 构建子元素 `append`；`openStats` 复用 `createModal` 返回的 `close`（顺带消除残留 Esc 监听）。

> 说明：**H（抽基类）仍未做**——本版为纯修复版，不引入结构重构；两个控制器当前均正常工作，抽基类风险高，留单独一轮配测试推进。
> 本机无桌面端 Obsidian，以上仅过 `tsc --noEmit` + `npm run build`，**未做真机回归**。

## 抽基类（v0.5.0，2026-07-28）——落实 H
- 用户批准把 PDF/Word 两标注控制器的重复抽基类。通读两控制器后采取**克制抽取**：纯公共、零差异、最易改出不一致的逻辑上提成 `src/annot/baseController.ts` 的 `BaseAnnotationController`；差异点（选区→标注转换、渲染模型、语音落点、手写绑定）用抽象方法/钩子留给子类。类名 `AnnotationController`/`HtmlAnnotationController` 保持不变，`main.ts` 无需改动。
- **上提到基类的公共逻辑**：构造注册监听（mouseup/mousedown/selectionchange）+ `attach()`；`destroy()` 清理骨架；`loadForDoc`（钩子 `onLoadDoc`）；`buildToolbar`（颜色样本+mic+pen 按钮）/ `syncSwatches`；选区捕获骨架 `onMouseUp`/`onDocMouseDown`/`onSelectionChange`/`handleSelection` + `showSelectionPop`（防抖、pop 定位）；`pushAnnotation`（push+persist+renderOne+Notice）；语音通用流程 `toggleVoice`/`onVoicePlaceClick`/`finishVoice`（钩子 `resolveVoiceTarget`/`commitVoice`）；手写通用流程 `togglePen`（抽象 `setupPen`/`teardownPen`）；`onAnnClick` 弹层（两控制器逐字相同）；`makeCard`（front 计算 + Notice 统一带 label）；`editNote`（钩子 `afterNoteEdited`）；`deleteAnn`（filter+persist+`removeAnnotationEl`）；`typeLabel`/`persist`/`removePop`；`getCache`。
- **留在子类的差异点**：PDF `resolveSelection`（`.ms-page`→rects+页码+scale+pageH）、`renderOne`（rects/pen/voice 渲染 + `elMap` 增量）、`renderPage`/`refreshAll`（PDF 页级增量，elMap 对账）、`removeAnnotationEl`（elMap 删元素）、`flashAnnotation`（gotoPage+renderPage+querySelector）、`resolveVoiceTarget`（`.ms-page` 归一化 + 页码）、`commitVoice`（docKind pdf/page）、per-page `PenController` Map（`onColorChanged` 同步笔色）；Word `resolveSelection`（body contains + 字符偏移 `offsetOf`）、`renderOne`（`wrapRange`/`appendVoiceMarker`/`appendPen`）、`removeAnnotationEl`（解包 span/remove）、`flashAnnotation`（body querySelector）、`resolveVoiceTarget`（body 归一化）、`commitVoice`（docKind html/page:0）、单 `PenController`（`onColorChanged` 同步）、`renderAll`/`setHtml`/`afterNoteEdited`（改 span title）。
- 关键设计：手写提交**不抽象为 `commitPen`**（会丢 PDF 的 per-page 页码），改由子类 `setupPen` 内部 `onCommit` 闭包绑定页码；PDF `getBodyEl` 返回滚动容器作占位（PDF 渲染不依赖它）；`makeCard` 的 card front 计算两控制器原本一致，统一到基类；Notice 文案统一为带 label 版。
- 行为等价性：公共逻辑与原版逐方法比对、逐字节等价；PDF `elMap` 增量、Word `wrapRange` 重叠防嵌套、flash 增量闪烁等均完整保留。
- manifest `version` → 0.5.0；`tsc --noEmit`（零错误）+ `npm run build` 均通过（main.js 约 5.4MB）；已覆盖安装到 yan vault，manifest 确认 0.5.0，`community-plugins.json` 仍含 `margin-study`。
- 真机回归：本机可启动 Obsidian（之前误判为无），但 GUI 内逐帧交互仍需用户手动点验。建议 reload（Cmd+R）后重点验证：PDF/Word 选中文本出工具条→高亮/批注/卡正常；语音录音落点正确；平板手写；点击标注弹层（卡/删/播放）正常。

---

## 紧急修复（v0.5.1，2026-07-28）——PDF 加载失败（真机首次实测炸出）

> 用户重启 Obsidian 实测打开 PDF 报「PDF 加载失败」。这是从 v0.2.0 就埋着、因一直没真机跑而没暴露的底层 bug。

- 🔴 **根因**：`pdfjs.ts` 用 `URL.createObjectURL(blob)` 把 PDF 引擎 worker 以 **Blob URL** 形式加载，但 **Obsidian 跑在 Electron 里，默认 CSP 不允许 `blob:` 协议加载 Worker**。pdf.js 内部 `new Worker(blobURL)` 被浏览器拒绝 → `getDocument()` 直接 reject → 界面报「PDF 加载失败」。`esbuild.config.mjs` 的 `pdfWorkerPlugin` 把 `pdf.worker.min.js` 内联成字符串本身没错，**错在运行方式**。
- ✅ **修法**：废弃 Blob worker，改用**物理 worker 文件 + `file://` 加载**（Obsidian 内置 PDF 查看器同款方案，已验证可行）：
  - `scripts/gen-cmaps.mjs` 额外生成 `src/pdf/cmaps.json`（cMap+字体 base64）；
  - `esbuild.config.mjs` 在 build 时拼接「cMap/fetch 拦截注入 + `pdf.worker.min.js`」写出独立 `pdf.worker.js`（3.52MB，顶部含内联 cMap 数据，离线中文仍生效），并移除内联 worker 的 `pdfWorkerPlugin`；
  - `pdfjs.ts` 删掉 Blob 逻辑，新增 `initPdfWorker(app)`：用 `FileSystemAdapter.getBasePath()` 拼出 `.obsidian/plugins/margin-study/pdf.worker.js` 的 `file://` URL 设 `GlobalWorkerOptions.workerSrc`；`main.ts` onload 调用之；
  - `pdfjs.ts` 不再 import cMap 数据 → `main.js` 从 5.4MB **瘦身到 1.97MB**。
- 安装文件由 3 个变 **4 个**：`main.js` / `manifest.json` / `styles.css` / `pdf.worker.js`（worker **必须随插件分发**，否则 PDF 仍加载失败）。
- manifest `version` → 0.5.1；`tsc --noEmit`(零错误) + `npm run build` 通过；已覆盖安装 yan vault，manifest 确认 0.5.1。
- 真机验证：用户 reload（Cmd+R）后打开任意 PDF 应正常渲染（含中文）；如仍失败，请把 Obsidian Developer Tools Console 的红色报错贴回（重点看 worker 相关）。

## worker 根因级修复 + onOpen 崩溃回归（v0.5.2，2026-07-28）
- 用户 reload 后实测仍炸，Console 两错：
  1. `TypeError: Cannot read properties of undefined (reading 'buildToolbar')` at `ReaderView.onOpen` → `buildToolbar`（崩溃在视图打开阶段，PDF 根本没机会渲染）；
  2. `Not allowed to load local resource: file:///.../pdf.worker.js` 接 `Setting up fake worker failed: "Cannot load script at: file://..."` —— **file:// 也被 Obsidian/Electron 封死**（CSP 禁 worker + Chromium 禁止渲染进程读本地 file:// 资源）。即 v0.2.0 的 `blob:` 与 v0.5.1 的 `file://` 两条路全废。
- **崩溃回归根因**：v0.5.0 抽基类后，`ReaderView.onOpen` 在第 78 行先调 `this.buildToolbar()`（内部访问 `this.annController.buildToolbar(...)`），而 `this.annController` 直到第 100 行才 `new AnnotationController(...)`。顺序颠倒 → undefined 崩溃。修法：把 `new AnnotationController(this.plugin, this)` 提到 `buildToolbar()` 之前。
- **worker 根因级改法**（不再依赖任何外部 Worker 加载路径）：`pdfjs.ts` 删掉 `file://` 逻辑，新增 `initPdfWorker(app)` 改 `async`——
  - 通过 `app.vault.adapter.read(app.vault.configDir + "/plugins/margin-study/pdf.worker.js")` 把 worker 文件当**文本**读出（vault adapter 能读 `.obsidian` 内文件，绕开渲染进程 file:// 限制）；
  - 注入为**内联 `<script>`**（`s.textContent = code; document.head.appendChild(s); s.remove();`，走 `unsafe-inline`，Obsidian 允许），在主线程执行 → 注册 `globalThis.pdfjsWorker`；
  - 设 `GlobalWorkerOptions.workerSrc = "ms-inline://margin-study-worker"` 占位真值；
  - pdf.js 检测 `globalThis.pdfjsWorker` 已就绪（`pdf.js` `PDFWorker._mainThreadWorkerMessageHandler` getter）后，**跳过 `new Worker()` 与 `loadScript()`**，直接走内置「假 worker / 主线程」`LoopbackPort` 内存通信模式。中文字体 cMap 仍由 worker 内 fetch 钩子拦截（内联注入未变）。
  - `main.ts` onload `await initPdfWorker(this.app)`。
- 安装文件仍为 **4 个**（main.js ~1.97MB / pdf.worker.js ~3.52MB / manifest.json / styles.css），pdf.worker.js 必须随插件分发。
- manifest `version` → 0.5.2；`tsc --noEmit`(零错误) + `npm run build` 通过；已覆盖安装 yan vault。待用户 Cmd+R 后实测 PDF/Word 标注、中文渲染、语音/手写、导图、复习全链路。

## 文本层 --scale-factor 缺失（v0.5.3，2026-07-28）
- 现象：用户 reload 后「功能一个都没有、文本选不中」。
- 诊断：grep 确认 `node_modules/pdfjs-dist` / 打包 `main.js` / 部署 `pdf.worker.js` 均 = 3.11.174，本插件 API 与 worker 同版本、互相匹配 → worker 非崩溃点。
- 控制台 `API 5.3.34 ≠ Worker 3.11.174` + `pdf.viewer.min.mjs` 报错 = Obsidian 自带 pdf.js 5.3.34（主渲染进程全局）读了本插件注入的全局 `globalThis.pdfjsWorker`(3.11.174) 产生的无害版本冲突噪声，与本插件无关。
- 真因：`renderPage` 调 `renderTextLayer` 未给 `rec.textLayer` 设 `--scale-factor`；该变量为 NaN 时 pdf.js 把字符 `transform/left/top` 算成 0 → 文本叠在原点、不可见不可选 → 选区类批注/搜索高亮功能「看似全失效」。
- 修：`renderPage` 在 `renderTextLayer` 前 `rec.textLayer.style.setProperty("--scale-factor", String(viewport.scale));`；每次 renderPage（含缩放）重设。
- 构建+tsc 通过，已覆盖安装（version 0.5.3）。

## 侧边栏与思维导图集成重构（v0.6.0，2026-07-28）
- 用户反馈：打开 PDF 后看不到侧边栏卡片和思维导图。已打开 MarginNote 4 供参考。
- 参考结论：MarginNote 4 打开文档后，右侧自动出现集成学习面板，且默认显示思维导图（脑图）——卡片作为节点、节点间带连线。
- 根因：本插件原先「侧边栏」与「思维导图」是两个独立命令，不会随文档自动打开；且思维导图是独立 ItemView，未集成进侧边栏。
- 改法：
  - 新建 `src/mindmap/mindmapRenderer.ts`，把 `MindmapView` 全部渲染/交互逻辑抽出为可复用组件。
  - `MindmapView` 改为基于 `MindmapRenderer` 的薄包装。
  - `SidebarView` 页签改为 脑图 / 卡片 / 大纲 / 复习，默认「脑图」；脑图页签内直接挂载 `MindmapRenderer`。
  - `main.ts`：`openReader`/`openWord` 后自动 `openSidebar()`；`openSidebar()` 增加 split 兜底，避免 `getRightLeaf` 为空时面板出不来。
- 构建+tsc 通过，已覆盖安装（version 0.6.0）。

## 套索区域摘录 + 图片 OCR + 拖到脑图（v0.7.0，2026-07-28）
- 需求：用户参考 MarginNote 4，要求① 从页面外滑入框选区域并拖到右侧脑图；② 图片上选中文本（OCR）。
- 实现：
  - 数据模型：`AnnotationType` 新增 `"region"`；`Annotation`/`Card`/`MindNode` 新增可选 `image` 字段（base64 JPEG 截图）。
  - OCR：`src/ocr/ocr.ts` + 随插件分发的 `ocr.swift`，基于 macOS `VNRecognizeTextRequest`，支持中文/英文，返回逐字位置与置信度。
  - PDF 套索：`AnnotationController` 监听 pointer 事件，在 `.ms-page` 上绘制套索矩形，松开后截取 canvas 区域、OCR、生成 region 标注与摘录卡。
  - Word 套索：`HtmlAnnotationController` 在 body 上监听 pointer 事件，提取矩形内文本，对框中图片截图并 OCR。
  - 脑图接收拖拽：`MindmapRenderer` 监听 drop，由 cardId/annId 生成带图节点；节点渲染支持显示 `image`。
  - 工具栏：新增 ▣ 套索按钮；region 标注点击弹层增加「加入脑图」。
- 安装文件增至 5 个（加 `ocr.swift`）；构建+tsc 通过，已覆盖安装（version 0.7.0）。
- 限制：OCR 目前仅 macOS（依赖 `/usr/bin/swift`）；Windows 后续计划接入 Tesseract.js 兜底。
