# src/documents/

> L2 · 上级 [AGENTS.md](../../AGENTS.md)

- `formats.ts` 定义学习文档扩展名。导入筛选和阅读器准入共用此表。
- `content.ts` 清洗 HTML、解包 EPUB 并解析静态文档结构。
- `documentReader.ts` 挂载 HTML、EPUB 与 Markdown 阅读器。
- `markdown.ts` 转换阅读器使用的 Markdown 内容与段落。
- `notebook.ts` 创建基于 PDF 的笔记本。
- `notebookFormat.ts` 读写 PDF 笔记本元数据。
- `pageCollection.ts` 解析重组文档，维护引用页和来源路径。
- `readingPosition.ts` 保存并恢复阅读位置。
- `recoveryPrompts.ts` 显示失联来源候选与恢复入口。
- `NOTEBOOKS.md` 记录笔记本的文件与阅读约定。
- `ACCEPTANCE.md` 记录阅读器验收场景与判据。
- `acceptance.mjs` 驱动阅读器与批注验收。PDF 橡皮擦入口在笔迹套件加入专项夹具。
- `acceptance-results.json` 保存阅读器验收样本结果。
- `acceptance-fixtures/` 提供阅读器验收的宿主、PDF 和交互场景。
- `a28-ui-acceptance.mjs` 验证来源与本地状态界面。
- `a28-ui-fixture.txt` 提供本地状态界面的合成宿主。

[PROTOCOL]: Update this header on change, then check AGENTS.md
