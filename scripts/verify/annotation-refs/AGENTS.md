# scripts/verify/annotation-refs/

> L2 · 上级 [AGENTS.md](../AGENTS.md)

- `fixture-support.mjs` 从当前工作树内存构建 `Store`、`AnnotationController` 与 `MarginStudyPlugin`，提供孤儿图层与重命名验收夹具。
- `b4-01-load.mjs` 验证加载含孤儿 `inkLayerId` 的批注时零异常。
- `b4-02-retain-and-render.mjs` 验证孤儿对象保留计数、身份与笔画，并按 `alpha=255` 渲染。
- `b4-03-switch-layer.mjs` 验证切换至其他层再切回时孤儿对象持续可见且不归属正常层。
- `b4-04-export.mjs` 验证孤儿对象按 `opacity=1` 导出并成功扁平化为可重开的 PDF。
- `b4-05-shared-missing-layer.mjs` 验证多个指向同一缺失层的孤儿对象在各层独立降级且不丢失身份。
- `b4-06-rebind-and-delete.mjs` 验证孤儿对象重新绑定与孤儿化降级行为。
- `b5-01-counts.mjs` 验证跨目录重命名后标注总数、公共对象数与绑定对象数完全一致。
- `b5-02-old-key.mjs` 验证重命名后旧路径批注键、侧车文件与元数据均清理无残留。
- `b5-03-binding.mjs` 验证重命名后宿主绑定关系与手写层引用完整保留。
- `b5-04-target-conflict.mjs` 验证目标路径已存在批注时拒绝覆盖、保留双方并报错。
- `b5-05-rollback.mjs` 验证目标侧车写入失败时完整回滚侧车、缓存、元数据且无残留。
- `b5-06-two-moves.mjs` 验证连续两次排队重命名后计数一致且旧/中间路径键均清空。
- `b5-07-draft-survives-rename.mjs` 验证重命名时唯一未决草稿按新路径哈希迁移（迁移内容不许删、校验通过才删精确旧文件）且重开可读。
- `b5-08-merge-tx-survives-rename.mjs` 验证合并已写侧车但主数据未提交时重命名保留解绑事实（`1 → 1`），重开只作用于新路径。
- `b5-09-prefix-collision.mjs` 验证真实 48 位前缀碰撞下清理只认精确文件名与归属 `docPath`，碰撞不得伤及他人恢复文件与同前缀邻居文件。
- `invariant-r/` 存放 B5-10 至 B5-22 不变量 R（恢复数据持久性）13 项回归夹具与独立支持；遵循「证明不成立时必须保留原件，证明成立时允许删除且冷启事实恒为 1 无重复」两分支判据，不得把判据简化为「保留 N 次冷启」。

[PROTOCOL]: Update this header on change, then check AGENTS.md
