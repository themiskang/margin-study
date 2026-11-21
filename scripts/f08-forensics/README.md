# F08 阶段 2 取证脚本（只读采集，不改源码）

基线 `f78573e8b5f5660bdf19af26fc9fd0ac75cd14db`。被验四件套取自
`.agent-artifacts/f08-executor/install/`（与 `evidence/f08-f78573e-20261121/exec/build-manifest.json` 相等）。

| 脚本 | 用途 |
| --- | --- |
| `a1.mjs` | 场景 1/2：v2 库并发外部改写 → 停写 → 冷重启 → 真实对话框选本地候选/外部版本 |
| `a3.mjs` | 场景 3/4/5：真实导入按钮 + 原生文件面板；`panel` 只导入并取证面板，`before` 导入后立即 SIGKILL，`after` 导入→重启→重复导入 |
| `race.mjs` | 外部写入者进程：轮询替换暂存目录里的 `expected.sha256`，再以 `rename` 原子改写 `data.json` |
| `mkfixture.mjs` | 给 `prepare-host.mjs` 生成的归档补 `srs` / `reviewLogs` / `reviewPending` 并重算 MANIFEST |
| `lib.mjs` / `a3lib.mjs` | 隔离宿主启动、CDP 观测、真实 UI 点击与命令面板 |
| `state.mjs` / `probe.mjs` | 只读观测快照 |
| `jsondiff.mjs` | 叶子级 JSON 语义差分 |
| `postprocess.mjs` / `finalize.mjs` | 收口：补 `.resolved` 原件与日志、写字节差分、`observations.json`、`RESULT.json` 清单 |

配套：`.agent-artifacts/f08-executor/prepare-host.mjs`（建隔离库）与 `cua-driver`（原生面板 AX）。
输出目录：`evidence/f08-f78573e-20261121/forensics/`。入口示例：

```sh
F08_OUT=$PWD/evidence/f08-f78573e-20261121/forensics/a1-local node scripts/f08-forensics/a1.mjs local
F08_OUT=$PWD/evidence/f08-f78573e-20261121/forensics/a3-before node scripts/f08-forensics/a3.mjs before
F08_FORENSICS=$PWD/evidence/f08-f78573e-20261121/forensics node scripts/f08-forensics/finalize.mjs
```
