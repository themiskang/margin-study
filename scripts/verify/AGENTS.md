# scripts/verify/

> L2 · 上级 [AGENTS.md](../../AGENTS.md)

- `fixtures.mjs` 解析公开夹具和私有证据路径。缺失私有夹具时返回跳过标记，严格模式下报错。
- `public-baseline.json` 冻结公开通过数下限，记录计数依据。
- `replay_support.py` 将 Python 回放的缺失输入路径交给验收入口，并将回放报告写到独立目录。
- `ego-harness.mjs` 统一隔离浏览器会话与命令接口。
- `regress.mjs` 运行验收并比对断言数和构建指纹。
- `pdf-save-acceptance.mjs` 验证 PDF 保存行为。
- `apkg-verify.py` 独立检查 APKG 文件与 SQLite 内容。
- `tab-width-guard.mjs` 检查文档标签宽度。
- `compare-document-more-evidence.py` 复核文档菜单实机证据。
- `compare-navigation-evidence.py` 复核导航实机证据。
- `compare-pdf-crop-evidence.py` 复核 PDF 裁剪实机证据。
- `compare-pen-undo-evidence.py` 复核手写撤销实机证据。
- `compare-read-settings-evidence.py` 复核阅读设置实机证据。
- `desktop-import-acceptance.mjs` 在合成宿主验证桌面导入的落盘、摘录、同名处理和错误分类。
- `desktop-import-fixture.txt` 驱动桌面导入界面和 PDF 选区，调用隔离文件系统。
- `build-determinism-acceptance.mjs` 无头校验构建产物零路径泄露与跨路径 symlink 构建哈希一致性。
- `annotation-merge-d4/` 存放 GAP-07b-1 D4 批注冲突合并的 7 项复现回归夹具与共享支持。
- `annotation-refs/` 存放 GAP-07b-2 B4 孤儿 `inkLayerId`、B5 文档改名/移动（含 `invariant-r/` 不变量 R 磁盘级证明）与 GAP-07b-3 B6/B7 导出与跨库往返（`export-roundtrip/`）的 39 项复现回归夹具与共享支持。
- `recovery-delete-guard.mjs` 基于 TypeScript AST 扫描 `src/**`（精确调用点三元组白名单，禁止方法级豁免）与运行时哨兵，强制所有批注恢复文件删除均经 `canDeleteRecovery` / `deleteRecoveryIfProved` 单一闸门。

[PROTOCOL]: Update this header on change, then check AGENTS.md
