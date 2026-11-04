# 阅读主题、翻页与导航位置恢复验收

更新：2026-10-17。本阶段完成 Read Settings 的翻页方式、五种阅读主题和 More Settings→UI Theme 子集；补修暗色批注对比度、页身份及流式文档恢复时的导航栏时序。仅更新 MarginStudy验收库。**完整 Settings、Document - More 全部菜单和整插件呈现仍未等价。**

## 原版与官方依据

原版实机版本为 MN4 4.4.6（L4），Qoder 反汇编版本仍为 4.4.5（L3），没有把二者互相替代。本阶段使用已保存的原生操作及 [官方阅读设置手册](https://manual.marginnote.com.cn/mn4/document-reading-settings/)，快照在 `evidence/official-sources/manual-document-reading-settings.txt`。论坛检索记录为 `forum-reading-dark-image-search.json`；空检索结果不证明功能不存在。

- 203—209 实际切换 White、Sepia、Gray、Dark、Green，选主题后弹层关闭，再开显示当前选择。
- 210、216、217 核对 Horizontal Flip/Vertical Scroll 的选择及弹层保持。211—215 的滚动、按键和按钮尝试未证实原版翻页，不能作原版手势、翻页动画或按键语义通过证据。
- 218 打开原版完整 Settings；219 的 UI Theme 有五主题与图片颜色校正开关。插件本阶段仅实现 UI Theme 五主题，不用空按钮冒充全套设置。
- 官方说明底部两端箭头是前后视图，不是上一页/下一页。本插件原有阅读历史与翻页分别处理。
- 原版 Dark 样例中，中性文字变浅，红字及黄色底保留；因此没有把整个批注层做颜色反转。

原版样例的背景采样用于 CSS 基准，不代表所有媒体颜色都已匹配：

| 主题 | 纸面/工具栏 RGB | 脑图底 RGB |
|---|---|---|
| White | 255,255,255 | 242,242,242 |
| Sepia | 245,239,223 | 232,226,210 |
| Gray | 65,65,65 | 98,98,98 |
| Dark | 0,0,0 | 33,33,33 |
| Green | 237,250,204 | 223,236,192 |

220 已把原版恢复到 White/Vertical。没有修改原版数据库或采用原版私有类、CoreData、私有 API。

## 本阶段行为

| 入口/状态 | 实现与验收范围 |
|---|---|
| Document - More→Read Settings | 顶部菜单现有六个核心入口；阅读设置按原版两组分段按钮及 More Settings 排列，350px 锚定面板 |
| Horizontal Flip / Vertical Scroll | PDF 切单页非连续/连续阅读，面板保持；保留页身份与缩放并持久化。实机 Right 从第 3 页显示第 4 页；未宣称原版手势/动画等价 |
| 五主题 | 独立 `readingTheme`，默认 White，作用于插件学习区、文档、导航、脑图及 Cards；不修改宿主全局主题 |
| PDF 颜色 | 对显示画布施加滤镜，源文件、源像素和存储的批注颜色保留；图片原色校正未实现 |
| 暗色自由文字 | 中性深色透明底文字显示变浅；有意设置的彩色字/背景色保留。编辑器读取的原始 color 不变，打开/关闭编辑不会把显示色写回资料 |
| More Settings→UI Theme | 两栏设置子集，五个选项与阅读主题同步，选择后保持设置页，Close 退出；不是原版完整全局设置 |
| Word / HTML | 两个固定翻页控件禁用，主题可用。导航栏先占位，再恢复阅读位置，避免恢复后才变窄导致跳段 |

生产改动：`src/types.ts`、`src/settings.ts`、`src/workspace/studyWorkspace.ts`、`src/pdf/readerView.ts`、`src/annot/textRuns.ts`、`overlay.ts`、`inlineTextEditor.ts` 与 `styles-workspace.css`。行为回归位于工作区公开 UI 及阅读器既有验收边界，没有采用原版内部对象模型。

## 失败、诊断与修复

1. 自动失败记录保留在 `evidence/verification/read-settings-red-theme/`、`red-preferences/`、`red-mode/`、`red-navigation/`、`red-contrast/`（各目录均有 `read-settings-` 前缀）。原生取证前的完整结果为 75/75 工作区、79/79 阅读器，保存在 `read-settings-pre-native-green/`。
2. 228、229 记录真实宿主 Gray/Dark 中批注文字对比度失败。修正中性文字显示及白底框、浅色脑图标题对比度后，233—236 复核可读、打开编辑再关闭；PDF sidecar 未变。原生补修后的 76/76 完整结果保留于 `read-settings-before-navigation-final-green/`。
3. 233—238 的 PDF 第 3 页不能顶端对齐，诊断发现第 4 页被折叠，数据多出 `foldedPages: [4]`。折叠来源未确认，不能归因用户、主题或占位高度。239 通过界面展开第 4 页，再跳到第 3 页后正常对齐；没有为猜测的占位缺陷修改代码。
4. 249—254 激活 Word/HTML 后，相对 221 阶段基线的保存位置发生偏移。主题切换前后记录相同，不能归因主题。原因是新阅读器恢复位置时，已保存的导航栏尚未占位，随后正文变窄重排。公开行为测试先失败 **76/77**，提示 Word 重开后是另一段；在 reader.onOpen 前预留导航栏宽度后 **77/77**。稳定红/绿副本为 `read-settings-flowing-navigation-red/green/`。
5. 264—271 发现插件运行/开关显示开启，而宿主启用文件仍不含插件；270 的比较保留失败。重新停用/启用，并保持设置打开直到磁盘启用列表确认，再关闭设置，273—278 完整重载复核通过。宿主内部原因未定位，不将其宣称为插件缺陷或已根治。

比较脚本首次还错误地把 241 的末次保存快照当成当前页 4；已修正口径，241 的实际翻页以截图为准。没有改原证据或产品数据去满足比较。

## 最终自动检查与原生复核

最后生产修复之后，完整 **20 个套件全部通过**，完成于 **2026-10-17 04:55:54 UTC / 北京时间 12:55:54**：工作区 **77/77**、阅读器 **79/79 组**、组织 UI 17、复习 UI 34、AI UI 18。类型检查和生产构建通过。稳定副本：[read-settings-final-green](evidence/verification/read-settings-final-green/results.json)。专项 77/77 不冒充全套结果；这些数量也不是原版覆盖率。

| 证据 | 实际结果 |
|---|---|
| 239—241 | 第 4 页展开；Dark 下选 Horizontal，面板保持；关闭后 Right 实际显示 Page 4。首次 `PageDown` 工具键名报错不算翻页 |
| 242—245 | 返回第 3 页、选 Sepia；真实停用/启用重开。242/243/244 完整 workspaceState 与 readingPreferences 精确相等；245 Horizontal 与 Sepia 选中 |
| 246—248 | More Settings→UI Theme；选 Gray 保持设置，选 Green 后 Close；正文及原批注可读 |
| 249—254 | Word/HTML 固定翻页禁用、主题可用；保留首次激活位置偏移的诊断记录；最终恢复 White/Vertical/PDF3 |
| 255—257 | 新导航修复安装前/停用/启用重开完整状态精确相等；新 main.js 已部署 |
| 258—261 | Word 第 17 段、HTML“能量转换”标题和前后正文，切 PDF 再返回后保持同位置；未仅依据 AX 中全文判断可见段落 |
| 262—271 | 运行态重载位置保持，但启用文件未落盘的状态不一致被保存，不作为最终启用通过 |
| 273—276 | 真实停用；启用后先确认列表落盘；重开 HTML 同标题/段落位置。262/273/275 完整工作区和阅读偏好相等 |
| 277—279 | Word 复核后回 PDF；White、Vertical、第 3 页、0.432、四标签、手写导航、Cards，无 Claudian 浮窗；启用列表包含 realclaudian 与 margin-study |
| 280 | 30 项限定保存证据比较全部通过；截图目视结论单列，不冒充脚本像素验证 |

## 数据边界与部署

[280 比较](evidence/native-max-l4/280-read-settings-comparison.json) 确认：八个源/sidecar 的 SHA-256 不变；233—278 中 43 份 PDF sidecar 与 221 基线逐字节相同；11 个学习模型区段精确不变。第 12 段 docMeta 只允许 alpha 从 `{"bookmarks":[]}` 变为 `{"bookmarks":[],"foldedPages":[],"pdfLayout":"single","pdfContinuous":true}`，其他文档元数据精确不变。所有设置除新增 readingTheme 外不变。

不能写“整阶段工作区完全未变”。旧版本首次激活流式文档时已覆盖的两个位置保留如下：

| 位置 | 221 阶段前 | 254 诊断后/最终 |
|---|---|---|
| Word ratio | 0.3287425820176912 | 0.2301829268292683 |
| HTML ratio | 0.03931051587301587 | 0.03522367030644593 |
| HTML sectionOffset | 0.02406342509102045 | 0.015284284008450446 |

修复后的原生验证以 255 诊断后状态为基线；最终完整 workspaceState 与它精确相等，**没有忽略位置字段或偷偷手工还原旧记录**。历史空 pen、空书签列表保留，没有迁移或全库清理。

可只用保存证据重放，不读取当前资料库：

```sh
python3 scripts/compare-read-settings-evidence.py
```

最终部署凭证：[20261017-read-settings-final-deployment.json](evidence/checkpoints/20261017-read-settings-final-deployment.json)。四个构建产物与验收库一致；main.js SHA-256 为 `bd6e0782cda1aa83c905d0ec0d9b3bf5af5cb53231dc7078115fba7506e3d96c`，styles.css 为 `830f551dfda81ed7768e0d67f3da14c740ca6d1b1de47e1a52a0552346a458f1`。两处受保护 main.js 仍为 `be2bbfecf7f32a558c53af1f2ae2bfee10178e9f84b3024b5c5c60721b376fe9`；原 yan 与原源码未覆盖，Claudian 凭证未复制。

阶段前备份 `20261017-read-settings-before/` 含 `installed-data.json`；另有 contrast、navigation 修改前及安装前备份。本阶段独立封存为 `20261017-read-settings-verified.tar.gz`，摘要见 `20261017-read-settings-snapshot.json`。上一阶段 Document - More 归档保持原 SHA-256，不被覆盖。

## 后续范围

清单 05—08、14、16 仍局部推进。继续 PDF 页编辑、裁边/扩展、Document - More 其余开关和可用条件，再补目录编辑/AI TOC、Cards 底栏及卡片模板。全套 Settings、图片原色校正、原生横向手势/动画、复杂字体与多媒体颜色、Word 复杂排版和导航主动开关后的重排、所有尺寸/菜单条件及整插件像素一致都尚未完成。

本阶段由主代理独立完成，未新派 agent 或向 Qoder 交接；协同校准保持未通过，当前不需要用户转交材料。普通标签、窗口和桌面切换可以正常进行；旧状态失效由工具重新读取，不据保护文案归咎用户。历史 noWindowsAvailable 根因仍未知，见 [连接诊断](窗口连接诊断.md)。
