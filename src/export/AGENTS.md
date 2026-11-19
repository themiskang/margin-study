# src/export/

> L2 | Parent: ../../AGENTS.md

- `studySetExport.ts` 限定学习集、复习状态和历史范围，生成带清单的 ZIP。
- `studySetImport.ts` 校验学习集包、重映射实体引用并移除空 PDF 页编辑，通过 Store 提交主数据。
- `studySetImportFiles.ts` 规划原件与侧车路径，在主数据提交前记录可回滚文件。
- `studySetNotes.ts` 将学习集卡片导出为库内 Markdown。
- `studySet-acceptance.mjs` 校验 ZIP 内容范围、完整性和脱敏。
- `studySetImport-acceptance.mjs` 校验导入后的重开、引用、PDF 页编辑、回滚和主数据迁移后的重复导入。
- `studySet-ui-acceptance.mjs` 执行学习集导出界面夹具。
- `studySet-ui-fixture.txt` 定义学习集导出菜单的交互断言。
- `exporter.ts` 提供文档、卡片和复习题的导出入口。
- `mindmapExport.ts` 将脑图内容渲染为可导出的图像。
- `cardFlow.ts` 生成卡片流导出的 HTML 和布局。
- `cardFlow-acceptance.mjs` 执行卡片流导出夹具。
- `cardFlow-fixture.txt` 定义卡片流的排版与内容断言。
- `apkg.ts` 生成包含卡片与媒体的 Anki 包。
- `apkg-acceptance.mjs` 校验 Anki 包的记录、媒体和可读性。
- `sqlite.ts` 为 Anki 包编码 SQLite 数据。

[PROTOCOL]: Update this header on change, then check AGENTS.md
