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
