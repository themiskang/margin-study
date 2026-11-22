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
