# 07 研究网页完整流程结果

日期：2026-10-24  
状态：**已关闭：功能、验收、验收库部署、保护审计与授权清理均完成。** 第05包继续暂停未关闭，第06包暂缓未关闭，不自动启动08。
范围：任务书原编号24、25；真实网站、八类入口、前后退/锁定/PDF/学习集/来源、独立窗口和重开设置。

## 已完成的用户流程与呈现

- 真实Bing搜索photosynthesis→Wikipedia→后退搜索→前进正文→网页转28页PDF→加入L4SampleSet→阅读器→“打开来源网页”回Wikipedia。来源以DocumentRecord.sourceUrl保存；打印前捕获起点URL，异步打印时切页/切学习集不会覆盖起点来源与归属。保留文档级网页来源，不虚构网页文字锚点。
- 普通target新窗口的http(s)搜索结果在当前guest打开；真实Bing结果点击已通过。没有启用allowpopups、Node或vault访问。依赖独立window.open/OAuth的页面仍可能需外部浏览器，未宣称通用登录成功。
- 最近100个URL/索引/搜索词快照持久化；侧栏切换及宿主重载恢复；修正导航事件时序，真实连续两退两进通过。重开采用URL重新载入，不包含表单、SPA内存或播放进度。
- **独立窗口补齐**：真实Obsidian中本机A→B→C，在B处关闭窗口→宿主“重新打开标签页”→仍在B且可双向导航→后退A→前进B/C通过。该本机用例验证独立窗口生命周期，外部搜索兼容由前述真实站点证据承担。
- 补测发现独立窗口guest由主document创建时点击不响应，地址/设置弹层也落到主窗口；已改用container.ownerDocument创建guest、挂载模态和监听Escape/选择，并在dispose时释放弹层。修复后真实链接A→B、地址弹层、设置弹层、独立窗口打印均通过。
- Research设置已从直接展开所有编辑字段改为分类/引擎勾选列表；名称/URL/顺序编辑独立展开。真实百度选择→关闭→重开选中仍保留→还原Bing，编辑入口、原设置恢复通过。列表结构/层级/分隔/选中勾与MN4对照；宿主直达Research不仿造MN4其他全局设置页，保留现有供应商配置，不以本包重置设置。
- 锁定时正文文字新选择不改目标；解锁后选择plants, algae真实触发BiliBili搜索；结束恢复锁定。
- **数据关系恢复补齐**：独立窗口转存本机PDF→加入学习集→从学习集移除→Undo恢复→Redo移除→通过库内文件选择器重新加入→阅读与网页来源回跳通过。文档id、整条记录、sourceUrl、PDF字节严格相等，学习集关联恢复。通用系统回收站Put Back没有通过证据，单独列为未测；它不替代本次已实测的研究PDF关系恢复，也不再与这项混淆。
- MN4本轮八类模式/底栏、真实Bing→Wikipedia→前后退已取证；补实际Research全局设置分类/引擎勾选/Custom URL显示，并还原词典选中。下载按钮直接生成PDF并加入当前学习集，没有观察到额外保存弹层；已按事实记录。真实样例中该临时文档关联已移除，Review仍为空。

## 代码与部署

- 最终main SHA256：`55a2abbc019b03207055ba253092c11e5bb75d4c010a6d759ca4d9abc0b5cbad`。
- 最终styles SHA256：`831dab9e7563d0c48571fa667cd2e1c3a7406cd8048677e401dcf8066af9ec4d`。manifest1.2.12。
- 开发=验收库。只部署验收库main/styles，部署前后data哈希相等，没有覆盖data.json。最终真实停用/启用、重开工作区、设置选择持久化验收通过；community-plugins.json含margin-study并已落盘。原正式库与WorkBuddy没有部署。
- 本包累计改动：research/browser.ts、view.ts、acceptance-fixture.txt、workspace/studyWorkspace.ts；本次收尾再改utils/modal.ts（可选所属document，默认调用行为保持）和styles-research.css。未修改AI/Claudian、Store结构或真实笔记。
- 回退：最初source-before.tar.gz；收尾前7a3d0d18…版本保存在根证据目录source-package07-20261024.tar.gz（旧哈希869ab846…a21e）和closeout/source-before.tar.gz。最终源码包放closeout/source-package07-final.tar.gz，逐文件身份及完整哈希见同目录identity.json。

## 验证矩阵与精确边界

旧证据根目录：`evidence/package07-20261024/`；本次收尾：其`closeout/`。

| 对象 | 实际结果 | 证据 | 边界 |
|---|---|---|---|
| 自动回归 | typecheck/build、workspace118、research18通过 | closeout/settings-green.log、四套件log/results；research-final.log与research-results.json | 合成DOM/guest/文件适配器，不冒称外站通过；跨窗口弹层先红后绿见popout-red/green，分类设置见settings-red/green |
| 真实搜索与PDF | Bing→Wikipedia→后退前进→PDF/学习集/来源/重开通过 | 根目录host-bing-search、host-search-to-article、host-back/forward、host-pdf-saved、host-source-return、pdf-source-persistence.json | a4794a45…版打印/来源边界未被后续改动；收尾9789ae18…版又补独立guest打印，本次最终55a2abbc…只再改设置呈现，复用未变打印/历史边界 |
| 独立窗口 | A/B/C，B关闭重开，A后退/B/C前进、地址与设置均通过 | closeout/popout-before-close、popout-reopened、popout-reopened-back/forward、popout-settings的ax/png，popout-pdf-saved.ax.txt | 证明窗口恢复与URL历史，不证明外站登录/SPA内存 |
| 设置与锁定 | 分类引擎选中重开；原编辑名称顺序/还原；锁定解锁真实文字 | closeout/host-settings-final.ax.txt/png、host-settings-selection-reopen、host-settings-editor-final；根目录host-settings-reopen/restored、host-lock/unlock-selection | 现有供应商集合保留，不声称原版每个供应商都验收 |
| 研究PDF关系恢复 | 移除、Undo、Redo、重新加入、同身份/来源/字节、定位全部true | closeout/association-removed/undo/redo/readded/source-return.ax.txt、pdf-before-remove.json、association-restoration.json | 非系统文件永久删除恢复；通用系统Put Back未测 |
| MN4 L4 | 实际八类、搜索/正文/导航、Research分类/Custom、直接生成PDF加入学习集 | 根目录mn4-mode-menu/search-final/article/back/forward；closeout/mn4-research-settings.ax.txt/png、mn4-custom-url.png、mn4-settings-restored.ax.txt、mn4-pdf-created.ax.txt/png、mn4-final.ax.txt | 插件以Obsidian模态/菜单承载设置及分享，系统Mail/Messages等分享扩展不复制成插件功能；不会把不可撤销删除当普通回收 |
| 官方边界 | 使用Electron文档中的guest方法，现代webview new-window已移除 | https://www.electronjs.org/docs/latest/api/webview-tag 、https://www.electronjs.org/docs/latest/breaking-changes | 不使用宿主主进程私有接口来绕过限制 |

| 八类入口 | 真实结果与限制 |
|---|---|
| Video / BiliBili | photosynthesis、plants, algae动态结果加载；未登录，播放/会员视频未验 |
| Text / Bing | 搜索、正文、前后退完整通过；只覆盖本轮搜索 |
| Image / Bing Images | 真实图片结果页加载；图片下载/账号未验 |
| Scholar / Google Scholar | 到达reCAPTCHA异常流量验证页，记为受限；未解验证码、无搜索结果通过声明 |
| Question / 知乎 | 搜索页及登录门槛可见；未输入凭据，登录后内容未验 |
| Dictionary / 有道 | photosynthesis词典页加载；音频/账号未验 |
| PDF / Bing PDF | filetype:pdf photosynthesis结果加载；未逐个下载结果，网页转PDF另有完整证据 |
| Translate / Google Translate | photosynthesis→光合作用动态输出通过；长文/账号历史未验 |

这些外部限制按任务书逐项列明，不需要伪造登录成功才能完成研究流程；也不代表所有替代引擎、所有动态页面、OAuth或跨账号会话均兼容。

## 数据、清理与保护

- 收尾基线closeout/business-before.json；最终final-protection-audit.json：cards/nodes/edges仍15/7/1；起点24条文档逐条相等、原docMeta/学习集/卡片/复习等业务键不变。新增1条本轮A测试PDF的missing登记及来源，文档总25；此前Photosynthesis missing登记保留。本包最初23条原文档仍未改。
- 本轮A PDF从学习集移除并关闭标签，经宿主确认准确文件名后正常UI移入系统回收站；活动库无A测试PDF。未清空Trash、未整份还原data，原B网页PDF等旧材料保留。关系UndoRedo已由最终重载清空。
- 研究设置与收尾起点严格相等；workspace差异仅researchSession历史更新，原四文档标签、活动l4、布局/阅读状态、AI侧栏均恢复。目标回起点P01；URL快照保留本轮测试历史，未虚构已清空。
- 最终1459字TOC未发送草稿逐字相等，附件0、请求0，证据draft-protection.json/host-final.ax.txt/png；未读密钥或Claudian配置。临时副本/tmp/marginstudy-p07-unsent-draft.txt仍可供后续重载保护使用。
- WorkBuddy与yan正式MarginStudy main结束均为`be2bbfecf7f32a558c53af1f2ae2bfee10178e9f84b3024b5c5c60721b376fe9`。本机fixture已停止，无运行构建/验收进程。
- 原版样例文档恢复为l4-sample-alpha/long-30pages，恢复Codex-Max-L4-Deck空Review面板，没有新卡片/复习数据，词典选中已还原。原版下载的唯一测试PDF副本已按用户明确授权永久删除，Local/WebDownloads已核对为空，见下节。

## 授权清理与关闭

用户在删除确认问题中明确答复“允许，仅删除这个测试副本”。核对原版不可撤销确认框中的完整文件名后，仅永久删除 `Search - Microsoft Bing_8d10cf24e68653b7e01851107a858c4d`。删除后Local/WebDownloads仅剩返回上级入口；重新打开L4SampleSet，原l4-sample-alpha/long-30pages及Codex-Max-L4-Deck空Review均已核对。证据：closeout/mn4-test-deleted.ax.txt/png、mn4-final.ax.txt/png、cleanup-authorized.json。

此前把通用系统Trash Put Back列作07阻塞，已纠正其与研究学习集关联恢复的混淆：后者真实完成并有同id/来源/字节证据；前者仍明确未测，归通用恢复范围，不写成通过。外站登录、验证码及动态页面限制仍以矩阵为准。

**第07包已关闭，无本包待执行事项。** 第05包暂停未关闭、第06包暂缓未关闭；不自动启动08。最终源码身份见closeout/identity.json；保护复核见closeout/closure-verification.json。
