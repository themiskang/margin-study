# P1 页内文字编辑与样式栏验收

更新：2026-10-16。本阶段补上文档自由文字的页内编辑和底部样式栏，修复 Word 长正文放置偏移，并按用户要求进入学习时收起宿主双侧栏和 Claudian 浮动输入框。仅部署到 MarginStudy验收库。清单 05—08、14、16 继续局部推进，未整项完成。

## 原版参照与实际实现

原版运行版本为 MN4 4.4.6。证据 93—102 来自合成 PDF 中同一个文字框：页内输入、局部选中文字、粗体、字号菜单 8—30、前景/背景色、斜体、下划线和 Arial 字体；99 切手形工具后结束编辑。98 点击空白后编辑仍在，不能凭文件名 after-blur 认定已退出；101 字体选择时 AX 短暂为空，字体结果以 102 的稳定状态为准。静态 L3 六专题不因此扩大到这些未分析的界面行为。

插件使用自有 `Annotation` 模型，新增富文字片段 `overlay.textRuns`，全文继续写在 `Annotation.text`，供检索、卡片和旧数据读取使用。未照搬原版类名、CoreData 或私有 API。

| 范围 | 已实现与验证 | 边界 |
|---|---|---|
| 页内编辑 | 点击放置或编辑既有文字框，在正文位置编辑；底栏依次为字体、字号、B/I/U、文字背景色、前景色；完成、切工具、切图层/笔记本及关闭会保存草稿 | 原版所有字体、菜单排序、各窗口尺寸和全部动作未逐项等价 |
| 局部格式 | 选择片段分别设置字体、字号、粗斜体、下划线、前景/背景；20 色与自定义色，保留旧框底色 | 字体菜单使用插件预设列表；字体可用性仍受系统安装情况影响 |
| 编辑可靠性 | 独立草稿、局部撤销/重做、纯文本多行粘贴、IME 组合事件；同一批注并发改动保留双方内容，冲突草稿另存 | IME 候选确认和硬件输入顺序主要依据合成事件回归；实机中文使用纯文本粘贴完成 |
| 持久化 | 片段安全读写与校验；无修改打开/关闭不重写；字号规范化避免缩放后出现长小数 | 原版未明确的行为不推断为已等价 |
| 宿主空间 | 进入学习收起左右侧栏，隐藏 Claudian Zen 浮窗；离开/卸载恢复；学习中手动展开的 AI 侧栏保持可用 | 用户明确允许的 Obsidian 适配；不修改 Claudian 设置、凭证或草稿，不代表验收库 API 已连通 |

## 复现过的缺陷

1. 原 fixed 定位受宿主容器影响，编辑框不可见且底栏向右裁切。103 为失败；改为工作区内定位，104—106 实机可见。
2. 保存后顶部 Undo 曾直接删除新框。改为先结束草稿，再按文档操作历史撤销；108 恢复编辑前内容，109 重做恢复富文字。
3. 缩放 0.423 时字号 20 显示长小数。失败在 `reader-text-size-precision-red`，119、125 实机显示短整数 20。无修改重开不会静默改写旧 sidecar 中的浮点值。
4. 只收起宿主右栏仍会留下 Claudian 浮动输入框。110、111 为失败；在学习期间隐藏 Zen 浮窗，112、117、124、126 验证未遮挡。113 是侧栏恢复动画中的状态，以 114 的稳定双侧栏为准。
5. Word 长正文在 flex 滚动区内被压缩，批注归一化表面只有近一屏高，文字框被夹到远离点击的位置。自动失败记录 `workspace-word-surface-red`；正文禁止 flex 收缩后 `workspace-word-surface-green` 56/56，通过真实 Word 120—124 复核。改动没有迁移历史批注坐标；旧错误版本生成的占位批注仍保留在合成 sidecar 中。

## 自动验收

完整运行完成于 **2026-10-16 13:05:33 UTC**，20 套件全部通过，见 [统一结果](evidence/verification/results.json)。工作区 **56/56**，阅读器 **78/78 组**，复习 UI 34、组织 UI 17、AI UI 18。

验收沿用已确认的阅读器/工作区公开边界：通过文字批注、选区、底栏按钮、工具切换、关闭和重开观察结果。隔离浏览器的 Obsidian 生命周期、PDF/Mammoth 边界替身不能代替真实宿主；阅读器另有真实 PDF.js Worker 和几何回归。数字不代表原版功能覆盖比例。

失败副本保存在 `evidence/verification/` 下：`reader-inline-text-red`、`reader-text-style-red`、`reader-text-tool-switch-red`、`reader-text-conflict-red`、`reader-text-ime-red`、`reader-text-legacy-red`、`reader-text-size-precision-red`、`model-text-runs-red`、`workspace-text-draft-undo-red`、`workspace-inline-position-red`、`workspace-host-sidebars-red`、`workspace-floating-ai-red`、`workspace-word-surface-red`。最终通过副本为 `inline-final-reader-green`、`inline-final-workspace-green`、`inline-final-model-green`；较早的 green 保留为历史记录。

## 真实 Obsidian 验收

环境：Obsidian 1.14.4、合成 MarginStudy验收库；操作与截图使用桌面工具，未用内部接口替代点击。

| 证据 | 实际结果 |
|---|---|
| 104—109 | PDF 框和底栏可见；仅“布局”设为 Arial20、B/I/U、红字与黄绿背景；保存、顶部 Undo/Redo 后恢复对应内容 |
| 112、114—117 | 进入学习隐藏双侧栏与浮窗；普通页面恢复双侧栏；主动打开 Claudian 侧栏后焦点回正文仍保持可见，再收起后浮窗不回弹 |
| 119 | 重开 PDF，选“布局”，Arial、20、粗/斜/下划线状态正确 |
| 120—122 | Word 在第 24—25 段附近点击，编辑框出现在点击处；120 只输入到 Word，完整中文以 121 为准；切手形保存，切到 PDF 再回 Word，正文位置和批注保留 |
| 124—125 | 通过设置禁用/启用插件，重新打开工作区；Word 批注可见；PDF“布局”的 Arial20、B/I/U、红字与黄绿背景保留 |
| 126—127 | 编辑已结束，学习界面保持打开；[11 项数据比较](evidence/native-max-l4/127-inline-reload-comparison.json) 通过：两份 sidecar 重载前后相同、四个源文档正文摘要不变、目标批注唯一且片段格式正确、两个受保护 main.js 保持原基线 |

截图与 AX 全部见 [实机索引](evidence/native-max-l4/README.md)。没有将自动测试或不同内容/尺寸的截图写成像素一致。

## 仍需继续

- 透明自由文字覆盖原文的语义保持原样；Word/Markdown 重排后的框定位、跨宽度语义和复杂正文仍需对照原版。没有靠统一白底或改写正文遮住问题。
- Document 菜单的分组、顺序、状态及实际动作；卡片各模板和编辑器；脑图默认密度、缩放与按钮布局仍未全面对齐。
- PDF/Word 已实机验证本阶段场景；复杂 EPUB、HTML、多栏/扫描页、所有图层和窗口尺寸组合未逐一实机验证。
- 完整 AI 问答和结果回流仍按清单 21—23。验收库没有模型配置，本轮没有复制原 yan 的 API 凭证。

## 部署、回退与检查点

[安装凭证](evidence/checkpoints/20261016-inline-text-deployment.json) 记录 UI 停用后复制四个构建文件、摘要一致及重新启用。后续文字保存/重载没有修改构建产物。

阶段前版本：`evidence/checkpoints/20261016-inline-text-before/`；最初部署前文件：`20261016-inline-text-deployment-before/`；浮窗修复前：`20261016-floating-ai-before/`；Word 表面修复前：`20261016-word-surface-before/`。回退先在验收库禁用插件，恢复所选备份的 main.js/styles.css/manifest.json/pdf.worker.js，再启用。不要直接覆盖之后的主数据或 sidecar；旧程序不保证理解新增片段。

源码、构建、验收和证据摘要见 [检查点](verification-checkpoint.json)。原源码和正式 yan 插件仍为原基线。本阶段只完成上述范围，整套插件与 MN4 的全面功能和呈现对齐仍未完成。
