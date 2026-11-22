# src/import/

> L2 · 上级 [AGENTS.md](../../AGENTS.md)

- `desktopDocumentPicker.ts` 负责桌面文件选择、单路径预检、读取与导入错误提示。工作区接收 `File[]` 后选择同名策略。
- `externalSources.ts` 使用 Electron 目录选择器登记外部来源。
- `webImport.ts` 为网页、本地和网盘导入提交文档。宿主用文件、旧路径和计划目标识别事务内的暂存改名。
- `baiduNetdiskUi.ts` 将百度网盘下载结果送入统一的文档导入流程。
- `baiduNetdisk.ts` 封装百度网盘授权、目录查询与下载。
- `acceptance.mjs` 验证网页导入与来源关联。
- `acceptance-fixture.txt` 提供网页导入验收的浏览器宿主。
- `a29-acceptance.mjs` 验证本地导入同名处理、回滚与恢复。
- `baiduNetdisk-acceptance.mjs` 验证网盘授权与下载适配。

[PROTOCOL]: Update this header on change, then check AGENTS.md
