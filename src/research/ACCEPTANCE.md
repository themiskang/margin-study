# 研究浏览器验收

2026-10-24 第07包：`node src/research/acceptance.mjs` 18项通过，合成 DOM/webview 与文件适配器；工作区118项、typecheck/build通过。测试数量不代表真实站点覆盖率。

新增：打印前捕获网页来源、PDF登记 sourceUrl 与学习集“打开来源网页”；最近100个URL/索引/搜索词快照、工作区与独立窗口状态保存；普通目标为新窗口的HTTP链接在当前guest打开，不授予popup/Node/vault能力。恢复历史重新载入URL，**不恢复表单、SPA内存、播放进度等页面状态**；persist分区也不证明登录会话一定恢复。

真实Obsidian1.14.5：Bing photosynthesis→Wikipedia→后退/前进→28页PDF→当前学习集→阅读器→打开来源网页通过。侧栏切换恢复、多步后退前进、最终插件重载后的目标/历史/模式/锁定恢复通过。设置名称/顺序改动重开可见并还原；锁定时选择正文未改目标，解锁后plants, algae触发搜索。独立窗口按当前URL打开及关闭通过。

八类真实入口：视频BiliBili、文本Bing、图片Bing Images、词典有道、PDF Bing PDF均加载；Google Translate实际显示“光合作用”。Scholar被reCAPTCHA拦截；知乎显示搜索页和登录门槛。未解验证码、输入凭据或证明登录后功能；YouTube、百度替代引擎、视频播放、跨账号登录与任意动态站点未覆盖。

MN4 L4：八类菜单、底栏布局、Bing→Wikipedia→后退/前进本轮通过。旧2026-10-16本机A/B网页→PDF/学习集、独立窗口证据仍属旧构建，不替代本轮真实站点证据。

2026-10-24 收尾补验：真实独立窗口 A→B→C、B处关闭、宿主“重新打开标签页”后B目标和双向历史保留，后退A/前进B/C通过。发现并修复跨窗口guest由主document创建导致点击不响应，以及地址/设置弹层落到主窗口的问题；guest、模态挂载和Escape/选择监听均使用所属document，关闭时释放模态。新增跨document DOM回归先红后绿。

研究设置已改为MN4参照的分类、选择勾选列表，独立编辑页保留自定义URL/顺序。真实选择→关闭→重开持久化通过并还原；原版Research设置分类/Custom URL内联状态和直接转PDF加入学习集均补取证。搜索供应商保持已有配置，没有为对照重置用户设置，也不声称覆盖原版每个额外供应商。

研究PDF在学习集中的移除→Undo→Redo→重新加入→同id/来源/字节→来源定位已通过；系统Trash Put Back未测，与学习集关系恢复分开记录。验收库本轮文件已正常UI回收，原版打印测试文件已从样例移除；用户明确答复“允许，仅删除这个测试副本”后，已核对完整文件名并仅永久删除该资料库测试副本；Local/WebDownloads为空，原样例文档及空Review已恢复核对。第07包已关闭，证据见closeout/cleanup-authorized.json、mn4-test-deleted.ax.txt/png及mn4-final.ax.txt/png。

最新证据在 `evidence/package07-20261024/closeout/`；完整矩阵和版本见 [阶段报告](../../docs/archive/phased-tasks/acceptance-reports/07-results.md)。旧本机A/B证据不会替代真实外站证据，所有登录/验证码限制继续有效。
