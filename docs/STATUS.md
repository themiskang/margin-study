# MarginStudy 当前状态

状态日期为 2026-11-22。当前对齐目标为 MarginNote 5.0.2。项目仍处于开发阶段。

| 工作 | 当前状态 | 依据 |
| --- | --- | --- |
| 卡 A 冷重启写盘 | 已验收，8/8。历史库结论限于 `f78573e` 线的 schema v3 | [卡 A 收口](archive/progress/progress-legacy-202611.md#卡-a-收口--pass-88) |
| 卡 CI 公开验收 | 53 个自动化套件使用公开夹具。历史实机回放单独运行 | [测试与验证](../README.md#测试与验证) |
| 卡 B 保存冲突反馈 | 已验收 8/8，异厂复核两轮 PASS。冲突态显式保存统一走 `src/model/saveFeedback.ts`，同文 10 秒去重；自动路径不刷屏。行为用合成 Obsidian 宿主，真实实机复核仍待补 | [GAP-02](MN5-PARITY-GAP.md) |
| 卡 C1/C2 PDF 橡皮擦 | 待定位间歇失败并验证修复 | [GAP-03](MN5-PARITY-GAP.md) |
| GAP-06a 桌面导入 | 执行验收 7/7。Obsidian 隔离库用原生选择器和直接路径各导入 1 份 PDF，各生成 1 条摘录。严格公开门禁 53/53，几何门禁 292/298。业主实机签收和 GAP-06b 仍待完成 | [桌面导入验收](../scripts/verify/desktop-import-acceptance.mjs) |
| GAP-06a 本卡附带修复 | 暂存改名触发来源迁移，迁移失败恢复旧快照，导致直接路径导入的 PDF 掉出学习集。改名监听只跳过同时匹配文件对象、旧路径及计划目标的导入事件。Obsidian 隔离库实测，窗口内的普通文档改名及暂存文件改往其他路径均进入来源迁移 | [暂存改名识别](../src/import/webImport.ts#L194) · [宿主监听](../src/main.ts#L117) |
| A3 原生菜单矩阵 | 等待补齐 5.0.2 原生采集 | [采集规格](specs/mn502-capture-plan.md) |
| A6 Pad 验收 | 等待设备在线 | [GAP-13](MN5-PARITY-GAP.md) |
| 开源发版 | 本地准备已完成：历史已清理（`.git` 84 MB → 7.9 MB，`dist/` 与 `handoff-to-edict/` 已从全部历史剔除）、`evidence/` 已外迁至仓库外、隐私复扫 0 命中。**尚未创建远端、尚未推送** | [决策](archive/plans/) |
当前差距统一登记在 [MN5 差距表](MN5-PARITY-GAP.md)。工作顺序见 [路线图](ROADMAP.md)。阶段验收、历史计划和交接见 [归档索引](archive/README.md)。
