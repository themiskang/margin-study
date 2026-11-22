# src/model/

> L2 | Parent: ../../AGENTS.md

- `store.ts`：协调主数据、批注侧车和恢复快照。加载及常规备份解除内部来源登记，保留卡片内容和成员关系。迁移备份保留原字节，恢复时跳过内部来源。桌面冲突暂停写入，直至选定版本。
- `saveFeedback.ts`：根据桌面停写状态区分内存修改与保存反馈；为冲突和普通错误分别给出后续操作。
- `desktopMainReplacement.ts`：在 macOS 原子交换主数据。回读实际移出的版本。保留冲突字节，回收已退出写入者的暂存。
- `desktop-replacement-acceptance.mjs`：在 macOS 合成磁盘库验证升级与导入的并发、替换失败和进程终止。
- `migrationBackup.ts`：暂存、校验并发布 v3 升级备份。复用等价备份，回收已退出进程的暂存目录。
- `migration-backup-acceptance.mjs`：在真实合成磁盘库中注入异常和进程终止，核对恢复列表和逐文件差分。
- `schema-migration-acceptance.mjs`：通过 Store 和合成磁盘库验证版本升级、迁移原字节、内部来源解除登记、恢复校验和冲突三方。
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
