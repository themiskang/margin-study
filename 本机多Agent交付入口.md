# 本机多 Agent 交付入口

## 给新 bot 的第一句话

本项目和证据都在**同一台 Mac**，直接进入现有工作目录读取，不需要下载、打包或复制 16 GB 证据：

`/Users/tanlihen/Documents/Qoder/2026-10-14/d20fd1f9/MarginStudy开发`

请先读本文件，再读仓库 `AGENTS.md` 和 `PROGRESS.md` 最近章节；按需读下列证据原件。`HANDOFF-20261115.md` 是历史交接材料，含过度概括及可能过期的状态，**本文件优先，实际代码和原始证据高于历史摘要**。

## Git 与本机文件的边界

- 这是 Git 仓库，分支 `main`；产品提交 `37845fe`，此前文档提交 `d7e0c36`。接手时自行运行 `git status --short` 和 `git log -3 --oneline` 获取实时状态。
- 本次检查未发现配置的 Git remote；不要假设存在可 `git pull` 的远程。新 bot 直接打开上述**现有目录**即可。
- `evidence/`、`.agent-artifacts/`、`native/`、`node_modules/` 及构建输出等被 `.gitignore` 忽略，但它们**仍在本机磁盘，可以直接读取**。忽略不等于丢失，不要 `git clean -fdx`、重置、清理、压缩或移动它们。
- 仓库代码依赖本机被忽略的证据：例如 `scripts/px-gap.mjs` 读取 `evidence/mn5-5.0.2-baseline/BASELINE.json`，`src/workspace/scene-acceptance.mjs` 读取 `evidence/mn5-5.0.2-data/templates/`。因此不能声称单独克隆即具备完整验收输入。
- 忽略目录里可能有用户真实数据和敏感信息。按需读取，不上传、不批量复制或提交；特别是 `~/mn5data/` 是取证副本，未经授权不得传播。

## 建议阅读顺序

1. `AGENTS.md`：项目执行约定。用户明确要求 **Codex 是代码执行席**；主 bot 负责规划和协调，代码由 Codex 写；复核与执行职责分离。不要让用户手动转交可直接委派的任务。
2. `PROGRESS.md`：查看最近记录及具体任务交接；内容较长，应先从末尾和相关任务搜索，不要假定所有历史结论仍准确。
3. `.agent-artifacts/SEATS.md`、`.agent-artifacts/DECISIONS.md`：本机会话曾记录的席位/决策，均为 Git 忽略文件；遇与用户新指令或实际能力冲突时，以新指令和实际证据为准。
4. `IMPLEMENTATION-DELTAS.md`、`MN5-5.0.2-DELTA.md`：差异及任务线索；许多状态未经同步，应对照源码与测试。
5. 下表的原始证据及专项报告。

## 本机证据目录

以下路径相对仓库根目录。保留原始文件；不能用报告中的推断替代截图、日志或实际运行结果。

| 内容 | 路径 |
|---|---|
| MN5 5.0.2 截图及几何基线 | `evidence/mn5-5.0.2-baseline/BASELINE.json`、同目录截图和 AX |
| 原版实机轨迹、录屏及索引 | `evidence/mn5-5.0.2-capture/INDEX.md`、`CONFIRMED-DELTAS.md` 及各批次目录 |
| MN5 数据层分析 | `evidence/mn5-5.0.2-data/SCHEMA.md`、`RUNTIME-DATA-MODEL.md`、`INK-AND-EXCERPT-FORMAT.md` |
| 几何差距及覆盖范围 | `evidence/px-gap-502/gap.json`、`gap.md` |
| 隔离库真实宿主验收 | `evidence/realhost-20261112/` |
| yan 真实库验收 | `evidence/realhost-yan-20261113/`，尤其 `YAN-REPORT-6.md`、`YAN-REPORT-7.md` |
| OPPO Pad 性能与用户反馈 | `evidence/pad-perf-20261113/`；含早期未经证实的根因判断，须结合原始数据核验 |
| 构建及打包历史 | `evidence/FREEZE-20261112.md`、`dist/`；冻结包可能早于当前源码，必须重新核对哈希 |
| 遮挡审计 | `OVERLAP-AUDIT.md`、`evidence/detail-1/` |

## 当前目标与不可忽略的限制

目标仍是桌面与 OPPO Pad 上尽可能完整复刻 MarginNote **5.0.2** 的功能、界面和布局，包含颜色、遮挡、标签栏等细节；用户不要求追随新版。不要把阶段成果写成「全功能、全界面已达成」。

- 像素报告此前为 **298 条、292 通过、0 超差、6 跳过**，属所测锚点和合成场景的有限结果；跳过项、缺失基线、菜单、样例不匹配及真实宿主未经验证的状态不能算通过。重新运行前指定临时输出目录，避免覆盖原始证据。
- 部分实机结论证据有限：目录键盘焦点、笔迹解绑、多文档书脊搜索等仍未确认；单次未找到不能推断不存在。先查看对应报告及截图，不要机械执行 `IMPLEMENTATION-DELTAS.md` 中未经证实的产品改动。
- 长卡坐标迁移与导出曾分阶段实现，但历史交接互相矛盾；先查最新源码、测试及 `PROGRESS.md`，不要假定端到端通过。
- 用户在 OPPO Pad 上曾反馈「非常顺利」，只证明当时该设备和构建的主观体验；保存链路、GC、GPU 或 WebView 的根因此前被多次过度定论，仍需受控测量才能确定。不要把合成性能测试当作真机延迟证据。
- 数据库副本曾在应用运行时由 Finder 复制，含 WAL，**不是已证明原子一致的快照**；模型字段、PencilKit 归属、FSRS 默认算法等应分别核验并标注观察、推断和未知。
- `yan` 是用户真实库：`/Users/tanlihen/文档/yan`。既有笔记、PDF、批注及备份不得任意修改或删除；测试探针及插件自身写入遵循用户已授权范围，先备份并核对清理。不要随意启停其他插件；用户允许发生实际冲突时优先 MarginStudy，但先定位并记录。

## 验收和交付规则

- 浏览器网页或 Web QA：遵循用户要求和本机 pi 规则，使用 `ego-browser nodejs`；先读 `~/.agents/skills/ego-browser/SKILL.md` 并运行 `ego-browser skill`。不要占用用户 Chrome/Safari。原有自动测试对 `agent-browser` 有历史依赖，应如实确认当前用户约束与运行方式，不能自行宣称已获回退授权。
- Obsidian 是原生桌面宿主，验收需遵循适用的 GUI 驱动规则；用户明确要求先完成桌面 Obsidian 验收，再向 Pad 部署。Pad 为 OPPO Pad 4 Pro / Android，历史隔离库在 `/storage/emulated/0/Documents/MarginStudy-A30-Isolated`；设备及权限先确认，不可假设在线。
- 同一工作目录只允许一个代码写入者；并行协作请隔离 worktree。用户要求 Codex 写代码，若 Codex 或子代理失败，停止并报告，不要自行换执行席。
- 产品代码变更后按项目要求执行完整 `npm run verify` 并记录实际结果；有失败、未复现或未验项不能标记完成。保留用户现有更改，不要擅自提交或重置。
- 当前本地 `main.js` SHA-256 `2b3dfe084982d5a98bd1e3a60ea97f7f3b7bf715b531986b57c0dde26c108e43`；`styles.css` SHA-256 `aabf80fd6aeb0c9ee14e2e8e8b020bdadaccb1f925cda86b45b582936f237816`。它们是本次交接时的忽略构建产物，不证明桌面、Pad 或 zip 一致；部署前重新核对运行时代码及哈希。

## 建议第一步

先读取 `AGENTS.md`、`PROGRESS.md` 末尾和 `git status`，核对构建/设备状态；再与用户当前目标对齐，列出仍需验证的具体面，分派给 Codex。先审查历史交付中未经验证或互相矛盾的结论，再改产品；不要清理证据。
