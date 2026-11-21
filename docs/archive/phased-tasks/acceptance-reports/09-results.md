# 第09包结果：数据恢复与长期稳定性

日期：2026-10-25。状态：**本包已收尾。实现、构建、模型回归、验收库部署、真实宿主冲突与中断恢复、数据保护和测试清理均已完成。** 固定两小时隔离观察按用户决定移出关闭门槛，后续在真实使用中观察；不将本次有限规模检查写成长期稳定性已经得到全面证明。本次不启动第十包。

## 实现与部署

- 来源身份采用内容 SHA-256 与字节数。缺源时仅提供唯一精确哈希候选，恢复后保留原 document ID；内容改变时要求明确选择，并保留旧版本备份。
- 已覆盖外部文件/文件夹改名移动、停用插件期间的离线移动与启动扫描恢复，迁移 sidecar、Store 卡片、MSREF 与学习集路径；迁移冲突保留版本，失败回滚。保留原有内部连续改名、草稿及卸载时序行为。
- Store 串行提交并核对磁盘基线。真实外部冲突先保留本地/远端/基线，再由用户显式处理；主数据和批注写入前保留恢复快照。
- 最终构建已部署到验收库 `.obsidian/plugins/margin-study`，17 个 Runtime 文件与开发目录逐文件相等，启用列表已落盘。本轮补验收期间没有再修改代码。

## 验收结果与证据

| 要求 | 结果及实际边界 |
| --- | --- |
| 外部改名与离线恢复 | 合成库 Finder 单文件改名、PDF/sidecar 移动、停用插件后目录离线改名、关闭重开通过。原 ID 与精确哈希保持，5000 条 sidecar 批注、5000 张卡片、1000 条 MSREF 和学习集路径正确迁移，missing=false。Finder 保留扩展名，测试名实际为 `p09-long-text-renamed.pdf.pdf`。 |
| 多窗口冲突不覆盖 | 两个独立应用进程对同一临时合成库打开同一首卡旧内容。A 保存到 revision 26；B 仍持有旧编辑内容，提交后显示外部修改提示，磁盘保留 A。冲突快照 local=B/revision25、remote=A/revision26、baseline=原文/revision25，各5000卡。随后在真实冲突界面采用磁盘版本，再从卡片 UI 恢复原文，最终 revision28。 |
| 写入事务中断恢复 | 真实卡片保存触发后，文件观察器捕获 pending-main 已完整落盘为 revision29、主数据仍为 revision28 的时点，停止并强制终止仅临时实例及其 helpers。两文件均可解析、各5000卡/3文档；主应用 PID46522 保留。新进程重开后界面显示原文与5000卡，revision29恢复点保留。 |
| 恢复点实际可用 | 正常退出临时实例后，仅在停止的临时库中手动用捕获的 pending 快照恢复主数据，再重开 Obsidian，卡片详情显示中断时的新修改 `[Interrupted 20261025]`。随后退出，临时库恢复原文基线。此项验证手动快照恢复；没有宣称自动采纳恢复点。 |
| 大文档与关闭重开 | 500页文本 PDF 与200页扫描 PDF在合成库真实关闭重开后分别显示 /500、/200；200页重新从列表打开出现“已加载200页”。此前异步视图切换产生的未加载提示已通过最长5秒有限等待修复。 |
| 资源释放 | 关闭500页阅读器后10秒，全应用 RSS 一次采样由819.7MiB降至794.6MiB，下降约25.1MiB。包含其他窗口和共享页，仅是一次粗粒度证据。 |

双实例冲突时宿主分别为 Obsidian 1.14.5 与复制的官方应用 1.12.7，使用相同插件构建；隔离实例重启后为1.14.5。结论限定于记录的真实场景，不推断所有并发时序。中断时点为恢复快照完成、主数据提交前；未模拟系统断电或主文件写到一半。先前空闲进程强杀与同应用空白窗口尝试只保留为历史部分证据，最终通过结论来自上表的新证据。

主要宿主记录：`evidence/package09-20261025/host-tests-20261025.json`。冲突提示截图/AX与完整合成快照为 `multiwindow-conflict.*`、`main-conflict-snapshot-mvnc5fvq-oljvla.json`；中断时点为 `interruption-capture.json`，重启及恢复为 `interruption-after-restart.json`、`interruption-restarted-ui.png`、`interruption-manually-recovered.png` 与对应 AX。逐项关闭核对见 `closeout-requirements.json`。

## 自动检查

本包代码改动后已通过 `npx tsc --noEmit --pretty false`、`npm run build`、`node src/model/additive-acceptance.mjs`（24项）和 `node scripts/verify.mjs model-additive reader workspace pending decks pdf-save study review`；reader 198/198、workspace119/119。24项模型记录在 `src/model/additive-acceptance-evidence/results.json`。最终宿主补验没有再改源码，沿用这些结果；模型证据与上述真实宿主证据分别记录。

## 数据保护与清理

- 未替换验收库 `data.json`。本包起点 revision1442→1445，宿主增加7个文档的 `sha256`/`byteSize`、保存元信息，并将 `settings.lastBackup` 从2026-10-24更新为2026-10-25。精确排除这些已列明变化后，全部业务结构与起点相等；cards/nodes/edges/documents为15/7/1/26。最终哈希为 `2a4da3c35d791b9fff6abf911698d5d692e8357cda7eb252a322d567e078dfcb`。
- WorkBuddy 原源码与 yan 正式插件 main.js 均保持 `be2bbfecf7f32a558c53af1f2ae2bfee10178e9f84b3024b5c5c60721b376fe9`。未访问或修改 Claudian 配置/密钥，未发送 AI 请求；未改真实笔记。
- 合成内容全部位于独立测试库。主应用仓库列表已移除 stability-vault 和 P09-MultiWindow-Vault，保留原有 yan 与项目验收库；验收库窗口仍开着。测试副本应用、独立profile和/tmp合成库已退出并移入废纸篓，未清空废纸篓。原始合成样例保留为项目证据，未注册成日常仓库。
- 最终审计：`final-protection-audit.json`、`host-cleanup-final.json`、`vault-list-cleaned-ax.txt`与截图。验收库未加入本包5000卡等测试对象。

## 交付身份

- main.js：`9e382aa1e02e745bb7a5ba81c6fc7889f7bb869deee98558592609c8d60d8bd1`。
- styles.css：`831dab9e7563d0c48571fa667cd2e1c3a7406cd8048677e401dcf8066af9ec4d`。
- manifest.json：`905813cfbf218025870d606eea9b7592d91c4eeedd8ea8d78c6f3f642304e8a2`（v1.2.12）。
- 最终258文件源码/构建归档：`evidence/package09-20261025/final-source/source-final-p09-closeout.tar.gz`，SHA-256 `06e86968ba533ffbf41bc79373b866668e81c753b943d88cb95378c8d5cadf3d`；逐文件身份为同目录 `source-closeout-identity.json`。
- 最终宿主证据补充归档：`evidence/package09-20261025/final-source/p09-host-recovery-addendum.tar.gz`，SHA-256 `3c74f496bfe4ffb4f82902d90b7cf0c4b33e960b3f12210ff4f2ae1f4d7dca53`。同目录保留各历史源码快照及其哈希，起点源码在 `initial-baseline/source-before-p09.tar.gz`。

## 保留边界

第09包按数据身份、恢复、稳定性证据与用户取消固定两小时观察后的关闭要求收尾。长期真实使用、任意超大PDF、断电/主文件半写及所有并发时序没有得到全面验证。本包没有进行 MN4 全功能、布局、模板、按钮的逐项等价审计，不能据此宣称整个 MarginStudy 与 MN4 完全一致。第03/05/06等其他包的原有未关闭事项保持原状态，不转入第十包。

## 后续 Obsidian 浏览态审计（2026-10-25）
后续按第03/05包在现有 Obsidian 验收库切换阅读器/目录/搜索做只读宿主复核。当前 `data.json` SHA256 为 `0696389e0a2ef4ea5623623835d116556e7c3fe9f6bcb6f717575dc4af07d6c7`，相较本包结束哈希 `2a4da3c35d791b9fff6abf911698d5d692e8357cda7eb252a322d567e078dfcb` 变化。逐字段比较显示业务集合在剔除本包已记录的7个文档指纹、lastBackup日期和宿主包络后保持相等；新增变动位于workspace导航/视图状态（文档标签阅读位置、目录/搜索对应状态等），没有卡片、笔记或设置内容修改。计数仍为15卡/7节点/1边/26文档。开发与安装main/styles身份一致，两处保护main仍为原始哈希。完整比较见 `evidence/closeout-audit-20261025/obsidian-followup.json`；未直接写回或回滚 `data.json`。
