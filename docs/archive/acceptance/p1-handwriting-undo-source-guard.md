# 新建手写撤销、重做与来源保护验收

更新：2026-10-17。此阶段修复上一轮原生验收发现的新笔迹撤销遗留空容器问题，仅安装到 MarginStudy验收库。原开发源码与 yan 正式插件保持基线。本阶段没有修改 Document 菜单生产代码，整插件功能和呈现仍未达到 MN4 全面等价。

## 实际行为

新建笔迹后撤销，在该笔迹没有后续独立修改、没有卡片来源引用时，从当前文档批注集合移除该记录。重做恢复同一 ID、完整属性、笔画与原数组位置；文档已改名时使用当前路径。保存、重开阅读器和插件重载后，不会复活已撤销的测试笔迹。

擦除已有笔迹仍保留来源容器。新建笔迹后来被卡片主来源、次来源引用，或另一视图加上备注时，撤销只清除笔画，保留来源身份和后来编辑。若笔画已被外部改动，或重做时同 ID 已被其他类型的批注占用，停止该历史操作并清除本视图的编辑历史，避免重复 ID、覆盖或损坏已有记录。

历史空笔迹 `ann-mvb9jx0m-z47ea4` 继续保留；这次不是全库清理或数据迁移。之前添加再取消书签留下的 `bookmarks: []` 也没有手工清除。

## 修改与回归

- 生产修改仅在 [baseController.ts](src/annot/baseController.ts)：记录新建身份、完整批注快照和数组位置，撤销时检查来源引用及后续变化，重做时检查 ID 冲突。
- [工作区验收](src/workspace/acceptance-fixture.txt)：加强既有顶栏撤销用例，并新增同 ID 冲突、主/次来源和备注保护、PDF 公开笔事件保存恢复三项行为检查。
- [阅读器用例](src/documents/acceptance-fixtures/overlayCases.txt)：两个旧用例曾预期“撤销后保留空容器”，现按公开批注集合检查新建记录已移除；重做重新按 ID 查找，图片按类型查找，避免依赖旧对象或固定数组下标。没有删掉混合历史和选择性撤销检查。

保留的失败证据：

| 记录 | 真实结果与含义 |
|---|---|
| `evidence/verification/pen-creation-undo-red/` | 原缺陷 65/66，新建笔迹撤销后记录仍在 |
| `evidence/verification/pen-creation-conflict-red/` | 初版修复 66/67，另一视图放入同 ID 的 note 后，重做造成重复 ID；已补保护 |
| `evidence/verification/pen-undo-reader-contract-update/` | 旧阅读器用例 76/78，仍要求空容器；这是契约调整，不能另算生产缺陷 |

冲突用例最初未等待 PDF 页面渲染，得到了空绘图表面；补齐等待后才复现重复 ID。该测试准备错误不作为产品缺陷。最终全套结果在生产和测试修改完毕后运行，完成于 **2026-10-17 00:11:52 UTC / 北京时间 08:11:52**。

**20 套件全部通过：工作区 69/69、阅读器 78/78 组、组织 UI 17、复习 UI 34、AI UI 18；类型检查和构建通过。** 稳定结果、全部日志与工作区截图在 [pen-undo-final-green](evidence/verification/pen-undo-final-green/results.json)。数量表示插件自己的检查，不代表原版覆盖率。

## 原生验收

环境：Obsidian 1.14.4、MarginStudy验收库、合成四文档学习集；原版观察为 MN4 4.4.6，Qoder 静态 L3 仍为 4.4.5。原生鼠标输入与合成笔压事件分开记录。

| 编号 | 动作与实际观察 |
|---|---|
| 165 | 修复安装前界面记录 |
| 166 | 原版 Document 菜单：当前页已有书签，Add Bookmark 禁用、Remove Bookmark 可用；只有完整 AX，无截图，也没有执行全部菜单动作 |
| 167 | 画之前记录八个源/sidecar 摘要、12 个白名单模型区段及四条原有 PDF 批注 |
| 168 | 原生在 PDF 第一页画黄色笔迹，正文与导航预览出现；新增 ID 为 `ann-mvbn92sz-j25ck2` |
| 169 | 点顶栏 Undo，正文笔迹与导航预览消失，批注从五条回到四条，sidecar 与画之前逐字节相同 |
| 170 | 点顶栏 Redo，恢复同 ID、同笔迹与导航预览；整个 sidecar 与 168 逐字节相同 |
| 171 | 再次 Undo，测试笔迹记录不存在；sidecar 再次回到原字节 |
| 172 | 在真实设置中停用插件，记录停用列表与完整已保存工作区状态 |
| 173 | 重新启用、打开学习工作区；正文无测试黄线，手写导航仅保留旧富文字预览，四标签与 PDF 第 1 页、0.432 缩放及导航状态保留；宿主双侧栏和 Claudian 浮窗未遮挡。Undo/Redo 禁用，工具模式恢复默认文本摘录，不声称临时工具选择跨重载持久化 |
| 174 | [15 项限定数据比较](evidence/native-max-l4/174-pen-undo-reload-comparison.json) 全部通过 |

168—171、173 均保存完整 AX、截图和原样 sidecar；173 另保存宿主状态及白名单数据快照。脚本 [compare-pen-undo-evidence.py](scripts/compare-pen-undo-evidence.py) 只读取已保存证据，可重放比较，不修改或读取当前资料库：

```sh
python3 scripts/compare-pen-undo-evidence.py
```

比较确认：Undo、最终 Undo、重载与画之前的 PDF sidecar 字节相同；Redo 与首次画完字节相同；四条原有批注完整保留；四源及其 sidecar 最终回到基线；12 个模型区段（含卡片、脑图、docMeta）不变；停用前保存状态与重载后宿主状态完整相等；四安装文件匹配开发产物和部署凭证；两处受保护插件保持基线。未声称整份 `data.json` 字节不变，阅读/导航状态在测试前有正常变化。

## 安装与范围

部署凭证：[20261017-pen-undo-deployment.json](evidence/checkpoints/20261017-pen-undo-deployment.json)。开发与验收库 `main.js` 的 SHA-256 均为 `c3b33d58070fa72e1cfa9ffae34bae986dce77eb7bea011cb17ddcd7bf335763`。修改前代码、构建与合成数据备份在 `evidence/checkpoints/20261017-pen-undo-before/`；实际安装前构建另有 `20261017-pen-undo-installed-before/`。

真实鼠标已验证创建、Undo/Redo、保存和重载；主/次来源保护、独立备注、外部笔画冲突、同 ID 冲突和合成笔压属于隔离自动回归，未声称在原生宿主控制过这些并发时序，也未验证物理触控笔压感。

Document 菜单分组/条件、AI TOC、目录编辑、Cards 底栏、模板及其他布局差距仍按 [后续清单](后续工作清单.md) 推进。166 只补有书签的单场景原版状态；新建撤销修复不能替代菜单或全部手写工具对齐验收。本阶段未派发新辅助任务，协同校准未通过，当前无需用户转交资料。
