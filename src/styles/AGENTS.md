# src/styles/

> L2 | Parent: ../../AGENTS.md

`esbuild.config.mjs` 按固定顺序拼接样式分片，输出根目录的 `styles.css`。验收夹具也直接读取各自需要的分片。

- `styles-base.css` 提供基础布局、控件和通用样式。
- `styles-reader.css` 提供阅读器和批注样式。
- `styles-mindmap.css` 提供脑图画布和节点样式。
- `styles-review.css` 提供复习界面样式。
- `styles-import.css` 提供导入界面样式。
- `styles-organize.css` 提供组织视图样式。
- `styles-workspace.css` 提供学习集工作区样式。
- `styles-ai.css` 提供 AI 面板样式。
- `styles-research.css` 提供研究视图样式。

[PROTOCOL]: Update this header on change, then check AGENTS.md
