# MarginStudy 当前状态

状态日期为 2026-11-22。**本机宿主已升级到 Obsidian 1.15.1**（旧版 1.12.7 保留在 `/Applications/Obsidian-1.12.7.app`）；1.15.1 上插件 1.4.0 正常加载、41 条命令、0 异常、PDF 打开正常。此前所有证据均产在 1.12.7。当前对齐目标为 MarginNote 5.0.2。项目仍处于开发阶段。

| 工作 | 当前状态 | 依据 |
| --- | --- | --- |
| 卡 A 冷重启写盘 | 已验收，8/8。历史库结论限于 `f78573e` 线的 schema v3 | [卡 A 收口](archive/progress/progress-legacy-202611.md#卡-a-收口--pass-88) |
| 卡 CI 公开验收 | 53 个自动化套件使用公开夹具。历史实机回放单独运行 | [测试与验证](../README.md#测试与验证) |
| 卡 B 保存冲突反馈 | 已验收 8/8，异厂复核两轮 PASS。冲突态显式保存统一走 `src/model/saveFeedback.ts`，同文 10 秒去重；自动路径不刷屏。行为用合成 Obsidian 宿主，真实实机复核仍待补 | [GAP-02](MN5-PARITY-GAP.md) |
| 卡 C1/C2 PDF 橡皮擦 | C2 执行验收通过。受控负载 30/30、低负载 10/10。PDF 专项 247/247，公开验证连续两轮 53/53 | [GAP-03](MN5-PARITY-GAP.md) |
| GAP-06a 桌面导入 | 执行验收 7/7。Obsidian 隔离库用原生选择器和直接路径各导入 1 份 PDF，各生成 1 条摘录。严格公开门禁 53/53，几何门禁 292/298。业主实机签收和 GAP-06b 仍待完成 | [桌面导入验收](../scripts/verify/desktop-import-acceptance.mjs) |
| GAP-06a 本卡附带修复 | 暂存改名触发来源迁移，迁移失败恢复旧快照，导致直接路径导入的 PDF 掉出学习集。改名监听只跳过同时匹配文件对象、旧路径及计划目标的导入事件。Obsidian 隔离库实测，窗口内的普通文档改名及暂存文件改往其他路径均进入来源迁移 | [暂存改名识别](../src/import/webImport.ts#L194) · [宿主监听](../src/main.ts#L117) |
| A3 原生菜单矩阵 | 等待补齐 5.0.2 原生采集 | [采集规格](specs/mn502-capture-plan.md) |
| A6 Pad 验收 | 等待设备在线 | [GAP-13](MN5-PARITY-GAP.md) |
| 开源发版 | 本地准备已完成：历史已清理（`.git` 84 MB → 7.9 MB，`dist/` 与 `handoff-to-edict/` 已从全部历史剔除）、`evidence/` 已外迁至仓库外、隐私复扫 0 命中。**尚未创建远端、尚未推送** | [决策](archive/plans/) |
当前差距统一登记在 [MN5 差距表](MN5-PARITY-GAP.md)。工作顺序见 [路线图](ROADMAP.md)。阶段验收、历史计划和交接见 [归档索引](archive/README.md)。

## 2026-11-22 · P0 备份守卫（合并 `f930749`）

问题：备份清单含 `MarginStudyBackups/…` 内部路径时，加载期守卫直接抛错，**整个插件加载失败**（Pad 实机 1.15.1 默认状态复现）。
修复：加载期解除该类来源登记并记 `localEvent`（保留卡片正文、节点、学习集归属），校验侧跳过该类条目；`sha/bytes` 校验仍在跳过之前执行（篡改照样失败），危险路径仍抛错；备份创建侧对 data 与 files 两侧统一过滤。
范围豁免：P5（`verify:public` 首轮即绿）受 GAP-03 负载敏感间歇阻塞，异厂裁定与本卡无关，**不标首轮即绿**。

## 2026-11-22 · GAP-03 C2 收口（合并 `8f8b130`）

- 根因：`src/pdf/extendNotes.ts` 的 `commitNotes` 把权威几何写入（`updateNotebookMeta`）排在重型预览渲染（双 `overlayPng` + `toBlob` 缩略图）之后，高负载下突破夹具裸 `wait(80)` → `frame resize did not follow both paper axes`。
- 修法：几何同步提交在前、权威写入随后、预览异步生成；夹具改条件等待并内联两帧诊断；新增 `extendGeometry.test.mjs` 延迟单测（250ms 注入）。
- 异厂验收 PASS（受控负载 30/30、低负载 10/10、px-gap 298 行零差异、W3 单测独立复跑 1/1）。
- 主树合入后连续两轮 `verify:public` 各 **53/53**，`pdf-hw-eraser` **247/247** → 同时闭环 P0（备份守卫卡）挂起的 P5。
- **覆盖范围勘误**：`hw-eraser-acceptance.mjs` 的夹具注入自 `2bfb044`（2026-11-15）起匹配零次，PDF 橡皮擦专项两组断言在此后从未运行。`2bfb044..a830592` 期间已收口的 10 张卡（卡 A/B/CI、GAP-04、GAP-06a/06b、P0 等）其 `pdf-hw-eraser 245/245` 记录**只覆盖 245 条中的 243 条实际断言**；已在差距表标注，不逐张补跑。

## 2026-11-22 · GAP-07a 收口（合并 `b53a83d`）

四项 MN5 对齐图层能力完成：`Handwriting on Top`、`Blank Background`、独立阅读器留白入口、文本框/图片绑层（`bindToInkLayer?: boolean`）。
异厂复核两轮：首轮 **FAIL**（文本框缩放柄被置顶笔迹视觉遮挡——`elementFromPoint` 仍命中，靠 3×3 像素采样才发现）→ `a0f141b` 新增 `.ms-overlay-handles-layer`（z=5）修复 → 复判 **PASS 7/7**。
主树合入后 `tsc` 0、`build` 0、`verify:public` 53/53。
**业主签收项未计入通过**：Pad 端 Apple Pencil 手感/防误触、深浅主题肉眼观感、macOS 窄窗格与分屏体验。

### 浏览器后端守卫（`check-browser-backend.mjs`）

同一故障第三次复现：worktree 内 `npm ci` 的 postinstall 把 `/opt/homebrew/bin/agent-browser` 重链进该 worktree，worktree 删除后所有 UI 套件报 `spawn agent-browser ENOENT`（表现为 `verify:public` 30/53）。
新增 `scripts/verify/check-browser-backend.mjs`：跑验收前解析后端真实路径，指向 `/orca/workspaces/` 即退出 1 并给出修复命令；已正反向验证（正常 0 / 断链 1）。

## 2026-11-22 · GAP-07b-1 收口（合并 `86c7ef4`，8 轮）

宿主几何跟随、层操作与合并事务语义。B1–B3 + D1–D4 全部通过，异厂复核 8 轮（前 7 轮 FAIL，逐轮修边界）。
**流程改进生效**：第 6 轮起由复核席把失败场景**导出为可执行夹具**，执行席跑同一批脚本修复；7 个夹具原样入库 `scripts/verify/annotation-merge-d4/` 并注册为回归套件。前 6 轮「各写各的脚本」始终不收敛，改为共用夹具后 2 轮内收口。
门禁：`tsc` 0、`build` 0、`verify:public` **60/60**、`px-gap` 292/298（top-3 3.00px 未变）。
新增独立卡 **GAP-BUILD-01**（构建可复现 + 产物路径泄露）。

## 2026-11-24 · GAP-BUILD-01 收口（合并 `1fe664f`，2 轮）

构建可复现 + 产物零路径泄露。根因：worktree 的 `node_modules` 为符号链接，esbuild 把 CJS 模块键写成相对 cwd 的路径。
修法：`absWorkingDir` + `preserveSymlinks`，模块键归一化为仓库内相对路径。
四路径产物 SHA-256 全等；敏感路径命中 0（修复前 922 处）；体积 −63,618 B 完全来自前缀，去前缀后逐字节相同。
新增 `scripts/verify/build-determinism-acceptance.mjs` 常驻套件（仓内临时根、仅 `node_modules` 符号链接、`realpath` 边界断言）。
门禁：`tsc` 0、`build` 0、`verify:public` **61/61**、`px-gap` 292/298（top-3 3.00px 未变）。
复核第一轮判 PARTIAL，抓出「新回归套件默认写系统 tmpdir」与「macOS 原生步骤沿符号链接写回真实树」两处隔离漏洞；
修复后第二轮 PASS。新增 **GAP-BUILD-02**（隔离环境原生冷编译 `SIGTRAP`，另案跟踪）。

## 2026-11-24 · GAP-07b-2 收口（合并 `7cf1612`，9 轮）

孤儿层引用 + 宿主改名/移动。B4 六项、B5 二十六项、守卫一项，`refs` 回归共 32 项。
门禁（公开模式 `env -u MARGINSTUDY_EVIDENCE_DIR`）：`tsc` 0、`build` 0、`verify:public` **94/94**、`px-gap` 292/298（top-3 3.00px）。

**过程记录（9 轮，每轮都发现真实数据丢失路径）**：
1. 改名静默删除未迁移的恢复数据（草稿丢失 / 解绑 `1→0` / 48 位前缀碰撞误删他人文件）
2. 计数相等的损坏内容被当通过
3. 启动读异常、配额清理跨文档、`TFolder` 外部搬侧车、改名回滚分裂态
4. 普通合并短键碰撞、静默丢写、墓碑 GC 无证明
5. 删除依据是内存标志而非磁盘内容
6. 侧车回滚跨 writer 误删并发草稿
7. 守卫本身被绕过（方括号、别名、解构、`as any`、`fs.promises.rm`、封装、路径变量）
8. 守卫漏报新形态 + 白名单计数去重缺陷 + 日志字段 `sidecarPath` 被信任
9. 守卫诊断格式（行号位置）、公开模式 SKIP 而非真跑

**沉淀的两条结构约束（长期护栏，不再靠逐路径修补）**：
- **不变量 R**：恢复文件删除必须由磁盘级逐字段证明并绑定实际删除目标；任何不确定一律保留 + quarantine。
- **静态守卫**：`recovery-delete-guard.mjs` 用 TypeScript AST 扫描 + 调用点级白名单（数量锁 6）+ 运行时证明-目标绑定哨兵，11 种绕过形态全部捕获；守卫自身可失败（注入即 FAIL 并报行号）。

## 2026-11-24 · GAP-07b-3 收口（合并 `f139629`，17 轮）

导出跟随语义 + 跨库往返。B6 四项、B7 三项、透明度守卫一项。
门禁（公开模式）：`tsc` 0、`build` 0、`verify:public` **102/102**、`px-gap` 292/298（top-3 3.00px）。

**17 轮发现的真实缺陷（按严重度）**：
1. **跨库导入丢数据**：`includePdf:false` 时跳过 `payload.annotations` → 导入到无原 PDF 的库得到空库。
2. **快照层信息丢失**：`snapshotAnnotations` 硬编码 `inkLayerId: "default"` 且不重映射 `hostAnnotationId`。
3. **导出写错键**：只写 `/CA`（描边）不写 `/ca`（填充），且已删除宿主的脏态未过滤。
4. **CSS 回退缺失**：`var(--token)` 无回退 → 旧主题下参考层变完全不透明。
5. **透明度语义四处实现**：`pen.ts` / `annotationLayer.ts` / `styles-reader.css` ×2 各写一遍 `0.35`。

**守卫的三次方法论升级（可复用到其他卡）**：
- 从「数值/字符串匹配」→「**符号解析到唯一声明**」（数值形态穷举必有漏）
- 从「人工类名清单」→「**标记驱动枚举 + 注册表双向校验**」（清单必漏新增类型）
- 从「单元素 `opacity`」→「**全链乘积 + 绘制日志 + 像素全采样**」三层交叉（局部衰减不改最大值）
另：断言/遮蔽/命名空间/解构等写法须按**值表达式**符号判定，不能按类型或语法长相。

新登记两张独立卡：**RENDER-OPACITY-ALL-CHANNELS**（`filter`/`mask`/`blend` 等非 opacity 通道）、**THEME-REFERENCE-OPACITY**（社区主题影响面）。

## 2026-11-24 · GAP-09 收口（合并 `1132593`，1 轮执行 + 1 轮复核）

简洁显示：三态状态机、精简笔条、命令与快捷键、`statusBar` 模板契约、四视口几何。
门禁（公开模式）：`tsc` 0、`build` 0、`verify:public` **104/104**（基线 102 + 2 新套件）、`px-gap` **295/298**（`10-minimal*` 三条 `maxDelta=0`，`skipped` 3→3 仅剩 `07-node-selected*` 可选锚点）。
复核唯一阻断为 G9-07 零重叠（756×851 简洁手写态 + 目录展开，把手与「卡片」页签相交 **3.3125 px²**），
执行席补断言（全对交集面积 === 0，并证明旧矩形喂进去会 FAIL）后修到 16 组 × 324 对全零。

**业主实机签收未计入（3 项，并入批次验收）**：
1. macOS 触控板 + Pad 触屏/Pencil 的 `420ms` 长按手感与防误触
2. Obsidian 1.15.1 真实宿主原生状态栏/标签栏/窄分屏下把手与笔条可达性、宿主热键无冲突
3. 真机深浅主题与窄窗切换肉眼观感

## 2026-11-24 · GAP-08 收口（合并 `4381f82`，1 轮执行 + 2 轮复核）

套索选择：选区/富剪贴板/解绑保全/区域摘录撤重/并发拒绝。
门禁（公开模式）：`tsc` 0、`build` 0、`verify:public` **106/106**（104 + `lasso-model-binding` + `lasso-ui-workflow`）、`px-gap` **295/298**（exceeded 0，skipped 3 为 `07-node-selected*` 可选锚点）。

复核第一轮唯一阻断为 **G8-05 并发覆盖**：陈旧修订号首次被拒后旧选区仍可重试并覆盖另一视图已落盘的颜色
（`retry.writes=1`、`canUndo=true`）。根因：拒绝时置空 `penRevision` 却未让旧选区失效，下一次动作又把最新修订号补回。
修复（`378016a`）：拒绝即清空选区并保留陈旧修订号直到重新 `pointerdown`；实测 `retry.writes=0`、`selectionCleared=true`、
`relassoWrites=1`，另一视图数据零丢失。G8-06 另补同一条 8 步链的逐步模型/像素/冷启/导出四类证据。

**业主实机签收未计入（3 项，并入批次验收）**：Pad/Pencil 与触控板圈选跟手性与防误触；真实宿主工具条/调色盘观感与热键冲突；真实 AI 供应商识别质量与扫描 PDF 摘录清晰度。

## 2026-11-24 · GAP-06c 收口（合并 `cf5f253`，7 轮修复 + 异厂复核）

合并入口撤销覆盖 + PDF/`.msref` 批注携带一致性。
门禁（主库环境）：`tsc` 0、`build` 0、`verify:public` **108/108**（106 + `merge-annotation-parity` + `merge-document-undo`）、`px-gap` **295/298**（exceeded 0）。

**七轮修复的收敛过程（每轮都是真实数据风险）**：
1. `snapshotAnnotations` 漏滤 `mediaDeleted`/空壳、浅拷 `textRuns`、源活跃层未同步 →
   目标侧正常笔迹被当成**孤儿**（不可擦/不可套索）。
2. PDF 目标未传 `annotations:'include'` → 落默认 `clean`，**源/目标批注 100% 丢失**。
3. 防误删守卫只比 manifest → **加书签后仍被删**、关闭期间写入被漏。
4. 守卫存在 **TOCTOU 窗口**（`onClose` 期间状态变化）→ `trash` 仍发生。
5. Store 旁路未受守卫 → **活文档批注 3→0**；`DocumentRecord.id` 重建 → 冷恢复阅读位置失效。
6. 权限令牌可被**任意集合申请** → 误删普通 TOC 集合。
7. 校验函数返回**内部可变对象**（引用别名）→ 调用方改绑即可放行。

**沉淀的通用约束（可复用）**：
- 删除/破坏性操作：**唯一入口** + **删除前二次从磁盘校验**（避免 TOCTOU）+ **一次性、强绑定身份的凭据**（模块私有铸造、冻结 + 摘要、单次消费）。
- 校验函数**只能返回值快照或摘要**，绝不交出内部可变引用。
- 允许清理的对象必须带**创建证据**（`createdByMergeTxId`），且清理入口与底层 Store 双重校验。

**G6c-07 环境豁免**：异厂复核环境 `verify:public` 104/108 与 `px-gap` 超时，父提交 `4bda9aa`/`3581d6b` 同环境同样超时；
主库与执行席隔离克隆均 108/108、295/298，判定环境差异、不构成回退。

## 2026-11-25 · GAP-10a 收口（合并 `a6ef497`，执行 + 异厂复核 PASS）

R2–R10 九面锚点固化（YAN-01）。新增公开套件 `yan-r2-r10-surfaces`（`verify:public` 108→**109/109**），`px-gap` 维持 **295/298**。
两处最小 CSS 修复均由套件实测暴露（`756×427` 单选操作条换行、附件胶囊 `transition:none`），未改冻结基线。

**证据有效性两处修正**（复核发现的非阻断项，值得记为流程约束）：
1. R10 曾在 `openSyncStatusPanel()` 后立即读取，得到 `scrollWidth/clientWidth = 0/0` 的**空真读数**；
   改为移除 `.ms-modal-bg` 前读取并 `wait(40)` 后，真实读数 `652×652`、`rowCount=7`。
2. 5 份 JSON 曾在父提交生成（11:36 < 提交 11:44）；改为在提交 HEAD 上重生成，并在证据内标注 `head` / `generatedAt`。
   → **约束：证据必须带 `head` 与生成时间，且与合入提交一致。**

**登记跟踪项 `TEST-FLAKE-LOAD`（非本卡）**：并发浏览器会话下 `pdf-hw-eraser`/`word-hw-eraser` 会出现 4 条 `null` DOM 假红
（`null.querySelector`/`null.getBoundingClientRect`/`null.dispatchEvent`/`null.text`）；串行顺序跑不复现。
判据：**2 个并发浏览器会话下连跑 3 次，必须 100% 绿**。

## 2026-11-25 · GAP-10b 收口（合并 `a035b14`，执行 + 异厂复核 PASS）

文档锚点生命周期：跨页回跳 / 改名移目录 / 工作区冷重开 / 缺源恢复重锚。
门禁：`tsc` 0、`build` 0、`verify:public` **110/110**、`px-gap` **295/298**（8 条边际项 8/8 恰 3.00px，零回退）。

复核独立性证据（GLM 异厂）：父提交 `f27d373` 同套件 **0/4**；候选导出副本**单独回退** `notebookSyncPending` 三处 hunk →
G10b-03 **3/3 次确定性失败**（切本后 `refreshExtendLayout` 打断导航、`currentPage` 停 1、`annEls=0`），证明修复必要。
冷重开四路证据：对象身份、`destroyed` 标志、DOM 脱离、数据来源（按 id 从盘取卡）。

**两条非阻断登记（建议另开小卡补断言）**：
1. 批注侧 `excerptBlocks`（`store.ts:3503-3505`）未进公开套件，仅复核 Node 探针覆盖；
2. `referenceBounds` 旋转局部行 hunk 无区分性断言（G10b-01 第 2 页为整行摘录）。

## 2026-11-25 · GAP-EGO-01a 收口（合并 `2a69e04`，条件收口 + 异厂 PASS）

新浏览器（ego）测试通道底座。默认后端仍 `agent-browser`；`verify:public` **110→111**、`px-gap` 295/298。
关键成效：单会话只拉起 1 次浏览器（冷启 338ms → 进程内约 4ms，约 85×），`ego` 下 `px-gap` 首次跑通
（295/298，与默认逐锚点 `maxAbsDeltaDiff=0.5px`，零状态不一致）。
`scripts/px-gap.mjs` 仅 ego 分支等待上限 90s→300s / 180s→360s，默认后端不变，显式标注为 headed 环境差异。

**诚实挂账**：GE1a-06 = 4/5 + `workspace` 348/352：
- 1 项 **P**（跳页后立即开目录栏丢页码）→ 新卡 `GAP-READER-GOTO-01`；
- 3 项 **E**（Pinch 纵向 60px / sepia 纸面被 60ms refresh 覆写 / 关侧栏段落位移）→ `GAP-EGO-01b`。

**门禁稳定性实录（TEST-FLAKE-LOAD 复现）**：合入后首轮全量 `verify:public` 为 **110/111**，
`word-hw-eraser` 在 **121.0s** 超时（上限 120s）；单跑该套件 **60.4s / 247/247 PASS**；同机第二轮全量 **111/111**。
结论：负载下超时假红，非产品回退；该套件 120s 上限偏紧，已登记到 `TEST-FLAKE-LOAD` 待规划席裁决是否放宽（属基础设施时限，非判据）。

## 2026-11-25 · PDF 双指缩放收口（合并 `5683920`，发布 1.5.2）

触控设备 PDF 阅读区双指缩放。`verify:public` 111→**112/112**、`px-gap` 295/298，异厂 codex 复核 4/4 PASS。

**五轮修复的真实边角（每轮均有 Red→Green 实测）**：
1. 断言空壳：套件读 `undoStack`（不存在），撤销栈长度恒 0 → 改读 `editUndo/editRedo` 并加注入自证。
2. 留白区第二指重入框选 → 残留 `.ms-lasso`；用 `isPinching()` 守卫 + `stopImmediatePropagation`。
3. 简洁工作区松手 **保存 2 次**（缩放与阅读位置各触发一次）→ 合并为一次原子写入。
4. 原生 **捕获丢失** 时抬指前提交半截笔画 → `lostpointercapture` 立即 `abortActiveGesture()`。
5. **滚动防抖穿越捏合**（滚动后 250ms 内捏合仍会保存）与 **可信 blur/hidden 未中止**（残留 2 个预览后误提交）→ 捏合开始取消待执行防抖、失焦仅在手势活动时中止。

已装 1.5.2 到 Mac `yan` 库与 Pad 两个库（`Documents/yan`、`Documents/MarginStudy-A30-Isolated`）。

## 2026-11-26 · 缩放白闪/内存/自动补画收口（合并 `7aaf2b3`，发布 1.5.3）

业主 Pad 实机反馈“每次缩放白闪一下”。根因：`renderPage` 在 `page.render` 之前改写 `rec.canvas.width/height`，**改 backing store 会立即清空画布**，中间空窗在慢设备可见。

六轮复核（codex × gpt-6.2-sol high）逐轮收紧，最终 `3c4f9e2` 终裁 **PASS 4/4**：
1. 双缓冲单帧替换（旧画面保留至新帧就绪）；PZ-07 60Hz 取样，Red `flashFrames=1`（0.5676→1.0，跳变 0.4324）→ Green 四路 0 帧（maxJump ≤0.0008）。
2. 内存：折叠 A4 桌面 498 MB → **34.91 MiB**，移动 115 MB → **9.34 MiB**；折叠页改单趟分段合成 `composeCanvas`，去中间拷贝。
3. 预算：逐像素对账 delta=0（`desktop-spread-a4-dpr3` 15,999,882 px ≤ 16M，消除 246,559 px 低估）；**先物理归零再销账**，跨页驱逐含在途页，峰值 3,732,892 px。
4. 分配失败保旧位图：`getContext=null` / 尺寸静默失败 / 尺寸抛异常三类注入，修前一种 100% 白 → 修后 0 帧且 `domPreserved=true`、`pendingRerender=true`。
5. 可读性下限：14000pt@400% 保留 1414×1414（edgeEnergy 20.19 ≥ 8.0），不再用 353×353 糊块换预算。
6. 自动升级：按**每页可渲染性**判资格（折叠页不占预算分母，`visiblePages` 原集合不改）、`eps=0.01`、`Map<page,targetDpr>` 去重 + 单执行锁；折叠邻页 296ms 内升级、已达目标页重复事件 0 次重渲；Red（换回 `39a4ec8`）769.2ms 零升级可复现。

门禁：`verify:public` 112/112（缩放专项 11 项）、`px-gap` 295/298 exceeded 0、锚点 2.063px、折叠 388388 采样像素全等、移动峰值 3,999,988/4,000,000 px。已装 1.5.3 到 Mac `yan` 与 Pad 两个库。

## 2026-11-27 · 标注撤销重构 + 平板工具栏布局收口（合并 `506272e`，发布 1.5.4）

业主 Pad 实机反馈三条（选区过敏感且不可撤销、底部工具栏压正文、左上「⋯」旧弹层遮挡且重复）。

六卡同批（`ANNOT-01..03` + `UI-01..03`），全部经异厂复核（codex × gpt-6.2-sol high）逐条 PASS：

- **ANNOT-01**：最小选区（微拖 4px / 中文 3 字 / 英文 6 字）+ 区域短边 12px 双约束；Red 全数复现（`adfe3b3`）。复核抓出**一次手势提交两次**（跨页 2 卡、连续摘录重复）与**细长框 40×2 绕过**，幂等令牌 + 短边守卫修复（复核 32/32）。
- **ANNOT-02**：统一 `ReaderExcerptChange` 撤销模型，标注 + 卡片 + 脑图节点 + 空文档根一次回滚（`f2f6c96`→`7d7ed2f`→`06929bc`）。三轮阻断均为真实数据缺陷：redo 覆盖撤销后编辑的正文、自动复习开启时撤不干净（`0/1/2/1`→`0/0/0/0`）、跨文档合并组员撤重丢锚点（3/3）。
- **UI-01**：`--ms-bottom-bar-clearance` 只加在 `.ms-workspace-reader-host`；A30 等效 `maxOverlapArea 4874.24px² → 0`，HTML 窄屏 `11292.75px² → 0`；溢出菜单 17/17 项实点（`1f5bde4`，复核 240/240 组合、174/174 锚点零漂移）。
- **UI-02**：场景态左上 `⋯` 与旧顶栏**从 DOM 移除**，24 项能力逐项迁移（`10eba01`）。复核抓出回忆/阅读场景**缺撤销重做触屏入口**（`14dd41b`）、**切场景污染撤销栈**（`36bbcf6`）、**切已有空脑图学习集自动多建一张图并清空 redo**（`09dd6b0`）。
- **UI-03**：底部单槽互斥状态机（编辑态高优先）+ `WeakMap` 引用计数（`506af1b`）；复核抓出**点外部不关闭编辑器**（`b866bf6`），补齐 8 条退出路径与白名单。
- **ANNOT-03**：`historyScope` 路由 + 三种独立阅读器 `Cmd+Z`（`4484a81`）；复核抓出**底部菜单打开时 `Cmd+Z` 误撤背后文档**（`1bb53c4`），加统一浮层守卫，浮层关闭后撤销恢复。

门禁：`verify:public` 112 → **116/116**（新增 `annot-threshold`、`annot-undo-atomicity`、`pad-toolbar-layout`、`workspace-annot-undo-e2e`）；`px-gap` 295/298 exceeded 0。已装 1.5.4 到 Mac `yan` 与 Pad 两个库。

## 2026-11-27 · 拖选只选中（合并 `SELECT-01`，发布 1.5.5）

业主反馈：在「摘录/书写」场景拖选一句话，**松手即自动高亮并成卡**，用户期望"只选中，再由自己决定"。

根因：`studyWorkspace.ts` 在 `excerpt`/`writing` 场景且工具为选择时调用 `setAutomaticTextExcerpt(true)`；`baseController.ts` 在 `automaticTextExcerpt && 选中长度≥minChars` 时直接 `commitAnnotation(...,"highlight",...)`，**没有"仅选中"中间态**，且该开关无用户可见设置项。

修复（`e1050ca` → `8254a0d`，复核 PASS）：
- 默认 **拖选仅选中**；选区菜单主行直接提供「高亮 / 摘录卡 / 复制」（原来「高亮」在二级菜单且无「摘录卡」）。
- 新增设置 `autoHighlightOnSelect`（默认关，进设置页 + `featureSearch` 23/23，重载持久化）。
- 点「高亮」→ 1 标注，是否成卡服从 `autoCardOnHighlight`；点「摘录卡」→ 严格 1 标注 + 1 卡（不双卡），1 次撤销原子撤回。
- 连续摘录（P0）保持逐笔自动，退出即复原为仅选中。
- 手滑保护：4px 微拖、两次/三次连续微拖（40/65/120ms）、拖选后 Esc/点空白 → 0 产物且**菜单不弹**。根因为 `pointerdown.detail=0` 与 `mousedown.detail=1` 混用导致连击兜底把微拖误升为双击；已改为仅位移 ≤2px 的静止点击计入连击链。

门禁：`verify:public` 116 → **117/117**（新增 `select-vs-highlight`）；`px-gap` 295/298 exceeded 0。已装 1.5.5 到 Mac `yan` 与 Pad 两个库。

## 2026-11-27 · 底栏让位回归修复（合并 `49c22ff`，发布 1.5.6）

业主 1.5.5 实机（Mac，1510×962@DPR2，场景模式）反馈：**底部工具栏仍压住正文**。

根因：`syncBottomClearance` 用 `readerRect.bottom - capsuleRect.top` 并把结果写回**同一阅读区的 margin**——**用被自己修改的元素测量自己**，真机上逐帧收敛到 0；合成测试在稳定后单次采样，恰好取到有让位那一帧，故 240/240 全绿仍漏。

三轮修复（复核逐轮加布局）：
1. `dd85f2f`：改为按胶囊自身 `height + computedStyle.bottom + gap` 计算，移除 `observe(readerPane)`，补 `visualViewport`/`window` resize；30 帧极差 0。复核抓出**窄屏菜单展开时让位仅 95px**（380×700 溢出 389.86 / 统一更多 876.61 px²）。
2. `a11e46a`：让位取「所有可见底部浮层」最大值（胶囊/溢出菜单/统一更多/格式条），菜单开合同步。复核抓出**竖排分屏 `756×851@DPR2` 让位 0**，「更多」盖正文 4253.61 px²。
3. `db33efc`：移除「竖排=0」一刀切，改为统一几何侵入深度 `barHeight + barBottomOffset - readerBottomInset`；竖排「更多」展开 231px、横排 624px，三滚动位交叠 0；竖排保留 130.02px 可滚阅读区。

门禁：`verify:public` **117/117**、`px-gap` 295/298 exceeded 0。已装 1.5.6 到 Mac `yan` 与 Pad 两个库。
