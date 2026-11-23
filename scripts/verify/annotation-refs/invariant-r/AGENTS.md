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

[PROTOCOL]: Update this header on change, then check AGENTS.md
