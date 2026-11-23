# scripts/verify/annotation-merge-d4/

> L2 · 上级 [AGENTS.md](../AGENTS.md)

- `fixture-support.mjs` 从当前工作树 `src/model/store.ts` 内存构建 `Store`，提供合成适配器、故障注入钩子与断言工具。
- `02-concurrent-writes.mjs` 验证侧车写入期间并发编辑合并与第三方合法写入回滚保护。
- `02b-same-pen-concurrent-edit.mjs` 验证侧车写入已解绑笔迹期间，同一笔迹发生并发内容编辑时保留编辑且不恢复无效 `hostAnnotationId`。
- `03-recovery-same-store.mjs` 验证主数据持续写失败时冷启与同 Store 打开均保留 journal，清障后恰提交一次解绑事件。
- `04-shared-host-replay.mjs` 验证共有宿主与笔迹在同序与键序反转下三次重放完全幂等。
- `05-shared-pen-single-unbind.mjs` 验证软删除宿主下键序反转的共有笔迹只保留原对象与单条解绑事件。
- `07-forked-host-keeps-remote-pen.mjs` 验证远端宿主分叉后其关联笔迹随新分叉宿主保留，且不破坏本地绑定。
- `key-order-invariance.mjs` 验证有效宿主与软删除宿主首次合并对递归 JSON 键序反转完全不变。

[PROTOCOL]: Update this header on change, then check AGENTS.md
