# src/model/

> L2 | Parent: ../../AGENTS.md

- `store.ts`：协调主数据、批注侧车和恢复快照。升级到 v3 前校验 v1/v2 原文及关联文件的备份。批注侧车继续使用 v2。
- `schema-migration-acceptance.mjs`：通过 Store 和合成磁盘库验证版本升级、失败保全、备份恢复和冲突三方。
- `annotationValidation.ts`：统一批注读写、冲突和备份的校验。
- `cardColors.ts`：同步卡片颜色与颜色标签。
- `conflicts.ts`：保留主数据冲突版本，合并复习事件。
- `duplicateIds.ts`：修复旧数据的重复对象 ID 和可判定引用。
- `localProtection.ts`：提取可恢复对象并校验保护快照。
- `mediaMigration.ts`：将内嵌图片外置，并更新内存引用。
- `reviewDecks.ts`：构建复习卡组及其成员关系。
- `reviewPending.ts`：归并复习候选及其进度。
- `a28-acceptance.mjs`：验证本地状态、保护快照和对象恢复。
- `additive-acceptance.mjs`：验证可选模型字段的往返兼容性。
- `drag-save-acceptance.mjs`：验证拖动期间的保存调度。
- `duplicate-ids-acceptance.mjs`：验证重复 ID 修复。
- `l3-acceptance.mjs`：验证工作区、卡片和脑图模型契约。
- `media-migration-acceptance.mjs`：验证图片外置和失败保全。
- `perf11-acceptance.mjs`：验证保存调度的性能预算。
- `sha256-acceptance.mjs`：验证无 Node 环境的备份校验。
- `ADDITIVE-ACCEPTANCE.md`、`additive-acceptance-evidence/`、`l3-acceptance-results.json`：记录模型验收口径和结果。

[PROTOCOL]: Update this header on change, then check AGENTS.md
