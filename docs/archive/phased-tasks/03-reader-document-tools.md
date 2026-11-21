# 第三包启动交接

用户已明确要求新开对话开始第三包。前一对话完成交接后停止源码/构建/验收/桌面操作；只有新对话执行，禁止并行或另开子代理争用桌面。

## 最小读取集合

1. `分阶段任务/00-总控与交接规则.md`
2. `后续工作清单.md`顶部执行归属和末尾最新记录
3. `分阶段任务/03-阅读器与文档工具.md`
4. `分阶段任务/验收报告/02-结果.md`
5. `evidence/package02-interactive-20261023/deployment.json`、`verification-summary.json`、`cleanup-audit.json`
6. 按具体行为读取相关源码；不要批量重读旧evidence/旧聊天。

## 当前事实

第一包已按用户核心闭环口径完成，字形/间距/精确最小尺寸不重开。第二包最初保留的标准表单字段、目录、链接交互实际功能缺口，在用户要求后已实际修复并验证；不要引用旧“兼容边界”作为当前结论。

开发=验收main SHA256 `d094cd465632fb3004b1179c9afeaf503b989a6b7ec07cced46fa6d6f6c176e3`，styles `fc883e000bc0e9c88781291e6dcf8ab30d5a3c994e79ad3bb79e364159967e5f`，manifest1.2.12 SHA `905813cfbf218025870d606eea9b7592d91c4eeedd8ea8d78c6f3f642304e8a2`。最终typecheck/build、Save5/5、Reader180/180、Workspace102/102通过；spread-fit曾有已知间歇失败，原日志保留，定向复跑通过，不为此回滚02。

第二包真实宿主已重载最终构建并导出，Preview最终表单填写保存关闭重开、标准字段值读取、内链到第3页、目录到第1页通过；外链实际打开Chrome目标地址。最终源码归档 `evidence/package02-interactive-20261023/source-interactive-final.tar.gz`，SHA `7e2b1c627575aa28f4bcf577dd6889daa67107f6486acc8de7f8859333b216c4`。

## 保护与现场

开发目录：`/Users/tanlihen/Documents/Qoder/2026-10-14/d20fd1f9/MarginStudy开发`；仅部署验收库 `.obsidian/plugins/margin-study` 的main/styles（worker真需才核验），不覆盖data/manifest。无Git，改动前定向备份，不用旧源码快照覆盖共享实现。

两处保护main基线均 `be2bbfecf7f32a558c53af1f2ae2bfee10178e9f84b3024b5c5c60721b376fe9`：
- `/Users/tanlihen/WorkBuddy/2026-07-27-17-19-57/margin-study/main.js`
- `/Users/tanlihen/文档/yan/.obsidian/plugins/margin-study/main.js`

保护正式插件、yan、真实笔记、Claudian配置；不清空Trash，不purge历史hidden/missing。完整data备份只留验收恢复目录，不复制包含真实相机内容的全data到开发证据。

Obsidian在验收库L4SampleSet工作区，选中l4-sample-alpha；本轮独立p02阅读标签已关闭。p02-interactive-20261023.pdf、旧mixed/long30均经UI进系统Trash，准确missing登记保留。19项非目标业务数据严格相等，docMeta/卡/节点/完整workspaceState/settings未变。Preview已退出，外链Chrome测试标签已关闭；旧缓存Reader标签可能仍存在，不据此判定活跃文件。

MN4仍为4.4.6(44600)，试用时间有限，原版必要取证优先。MN4本轮未改，L4SampleSet原合成样例及Qoder既有节点保留。第二包Annotated有效补证已完成。所有UI用CUA，先按工具规则getApp重获当前状态；原有系统鼠标替代授权仅限第一包指定测试，不能外推到第三包。

## 执行要求

第三包范围为Settings、阅读布局、精确选择、目录编辑/重排、Word/HTML重排导航回原文、自由元素及媒体。先核查现有能力和必要MN4证据，再修实际缺口；已通过的前两包证据复用，不重跑微差。AI TOC涉及真实API若缺授权应保留明确阻塞，不能擅动Claudian/API配置。

按实际用途主动选择已安装技能并先读SKILL.md，已约定测试seam见总控；普通步骤不重复征求授权。持续推进到第三包完整收尾：适当回归、验收部署、真实宿主、正常UI清理、03报告及总控索引。约一分钟有简短进展，不在每个小步骤后结束。硬件/API真正阻塞才解释；不把实际功能限制称为纯视觉差异。
