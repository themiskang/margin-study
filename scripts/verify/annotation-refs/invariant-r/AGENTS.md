# scripts/verify/annotation-refs/invariant-r/

> L2 · 上级 [AGENTS.md](../AGENTS.md)

遵循不变量 R「证明成立 / 不成立」两分支判据：磁盘级权威证明不成立时（读异常、哈希不符、双分支共存、磁盘未落盘）必须保留原件且不得删除或改名；磁盘级证明成立时允许删除且后续冷启事实恒为 1、无重复。不得把判据简化为「保留 N 次冷启」。

- `fixture-support.mjs` 从当前工作树内存编译 `Store`，提供故障注入、磁盘级证明检查与 SHA-256 采样工具。
- `b5-10-same-count-corrupted-content.mjs` 验证同数量内容损坏时由 `contentDigest` 拦截并保留原快照。
- `b5-11-quota-prune-other-doc.mjs` 验证同写入者配额边界下不跨文档删除未落盘唯一草稿。
- `b5-12-startup-read-error-keeps-log.mjs` 验证启动瞬态读异常（证明不成立）保留原日志，后续干净冷启磁盘证明成立后允许删除且事实恒为 1。
- `b5-13-folder-move-external-sidecar.mjs` 验证宿主先搬侧车后改名在证明成立时允许删除且事实恒为 1，外部改写致哈希不符（证明不成立）时保留日志与侧车。
- `b5-14-rename-rollback-durable.mjs` 验证目标草稿写失败与回读不符时回滚持久落盘，冷启零分裂态。
- `b5-15-cold-start-two-branches.mjs` 验证新旧双分支并存（无清理证明）时按内容摘要选唯一稳定权威，双侧车与双日志均原字节保留。
- `b5-16-proof-from-disk-not-memory.mjs` 验证主数据静默丢写（内存误判成功但磁盘未覆盖）时证明不成立、保留原日志，随后干净冷启磁盘证明成立后提交并清理。
- `b5-17-merge-short-key-collision.mjs` 验证共享 48 位前缀的两文档在普通合并时由 64-hex 全长键完全隔离，不覆盖他文档日志，两次冷启各恰 1 条事实。
- `b5-18-merge-silent-write-loss.mjs` 验证普通合并主数据静默丢写时统一删除闸门拒绝删除日志，清障后两次冷启各恰 1 条解绑事实。
- `b5-19-tombstone-gc-requires-proof.mjs` 验证墓碑 GC 在侧车摘要失配与读异常时均保留原墓碑且事实保持 1。
- `b5-20-disk-proof-checks-local-events.mjs` 验证磁盘证明除 `dedupeKey` 外必须核验实际 `localEvents` 对象，事件缺失时保留日志并在清障冷启后补回恰 1 条事件。
- `b5-21-sidecar-rollback-silent-write-loss.mjs` 验证侧车回滚静默丢写时由 `merge-tx-rolled-back` 磁盘回读拦截删除，原日志原字节保留。
- `b5-22-tombstone-cross-tx-proof.mjs` 验证墓碑后继被另一事务覆盖导致摘要失配时，GC 不得凭他事务磁盘证明删除旧墓碑，旧墓碑原字节保留。
- `b5-23-guard-bypass-forms.mjs` 验证 AST 守卫捕获全部 11 种绕过形态（方括号、模板拼接、别名、解构、强转、Object.assign、fs/vault、本地封装函数与路径变量数据流）。
- `b5-24-rollback-cross-writer.mjs` 验证改名回滚清理同时核验 `docPath`、`writerId` 与内容 digest，并发他 writer 草稿原字节保留。

[PROTOCOL]: Update this header on change, then check AGENTS.md
