# scripts/verify/annotation-refs/export-roundtrip/

> L2 · 上级 [AGENTS.md](../AGENTS.md)

- `fixture-support.mjs` 从当前工作树构建隔离库、`ReaderView`/`AnnotationController` 与学习集打包/导入夹具。
- `pdf-content.mjs` 解包 PDF 页面内容流与 `ExtGState`，提取 `/ca`、`/CA`、CTM 矩阵与绘制点位。
- `static-checks.mjs` 基于 TypeScript AST 与样式源码扫描 `0.35` 字面量、参考态透明度分支与 `bindToInkLayer` 真值吞并写法。
- `b6-01-deleted-host-not-exported.mjs` 验证宿主删除后绑定笔迹导出绘制指令计数为 `0`。
- `b6-02-opacity-contract.mjs` 验证导出 PDF 中公共/当前层 `/ca 1` 与参考层 `/ca 0.35` 精确计数。
- `b6-03-transform-after-move-scale.mjs` 验证宿主移动与缩放后绑定笔迹导出矩阵坐标偏差 `≤ 1pt`。
- `b6-04-same-pipeline.mjs` 验证渲染与导出 `/ca`/`/CA` 逐对象一致，且 `0.35` 参考透明度仅存单一源头。
- `b7-01-roundtrip-diff-zero.mjs` 验证学习集跨库导出→清空→导入往返标注 JSON `diff === 0`。
- `b7-02-explicit-false-preserved.mjs` 验证 `bindToInkLayer` 显式 `false`/`true`/缺失三态无损往返且全仓零真值吞并。
- `b7-03-cross-vault-missing-refs.mjs` 验证不含原 PDF 的跨库导入保留孤儿层/宿主引用并按全不透明可见导出、零未捕获异常。

[PROTOCOL]: Update this header on change, then check AGENTS.md
