# scripts/verify/

> L2 · 上级 [AGENTS.md](../../AGENTS.md)

- `fixtures.mjs` 解析公开夹具和私有证据路径。缺失私有夹具时返回跳过标记，严格模式下报错。
- `public-baseline.json` 冻结公开通过数下限，记录计数依据。
- `replay_support.py` 将 Python 回放的缺失输入路径交给验收入口，并将回放报告写到独立目录。
- `ego-harness.mjs` 统一隔离浏览器会话与命令接口（含 `resolveBrowserExecutable`、会话级持久 `ego-browser nodejs` 单进程桥接、DPR=1/light/focus 仿真与全命令兼容层）。
- `check-browser-backend.mjs` 复用 `ego-harness.mjs` 的 `resolveBrowserExecutable` 校验浏览器后端路径与稳定性。
- `ego-harness-parity-acceptance.mjs` 零私有夹具公开契约套件（GAP-EGO-01a），在默认 `agent-browser` 与 `MARGINSTUDY_BROWSER=ego` 双后端校验仿真初始化、非严格选择器、`find role/label`、`check/uncheck`、`console/errors`、`snapshot -i`、跨调用鼠标拖拽、单进程复用与 `runBrowserSync` 零泄漏。
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
- `reference-opacity-guard.mjs` 基于 TypeScript AST 与 CSS 规则扫描，强制参考层 `0.35` 双轨校验（递归 `calc()` 规范化数值 + 精确形态白名单 + 生产者侧 token 常量引用），基线精确等于 `4`（1 TS 常量 + 2 CSS 回退 + 1 定义点），其余形态、不可判定 `calc()` 或基线计数偏离即 FAIL 并报 `文件:行号`。
- `yan-r2-r10-surfaces-acceptance.mjs` 零私有夹具公开浏览器套件（GAP-10a / YAN-01），覆盖 R2–R10 九面三视口（R8 追加 380×700）基线几何、专属控件命中与零重叠、R4/R5 菜单契约、简洁态往返零残留与 R9/R10 防溢出。
- `anchor-lifecycle-navigation-acceptance.mjs` 零私有夹具公开浏览器套件（GAP-10b），在 1200×800 与真实 PDF.js Worker 下验证跨页折叠回跳、改名移目录多源/分块/非默认本回跳、工作区冷重开回跳与缺源离线保护及双路恢复重锚。
- `pdf-pinch-zoom-acceptance.mjs` 零私有夹具公开浏览器套件，验证 PDF 双指缩放两阶段提交、无白闪双缓冲（PZ-07 ~60Hz 采样，覆盖捏合与桌面缩放按钮）、锚点保持、手写/套索零副作用、三指安全与 CDP 触控冒烟。

[PROTOCOL]: Update this header on change, then check AGENTS.md
