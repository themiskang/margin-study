# AI 助手与 Claudian 联动验收

## 已实现

检测到兼容的 `realclaudian` 时，学习助手默认选择 **Claudian（现有插件）**。纯文本提问由 MarginStudy 直接交给 Claudian 当前选中的模型，回答流式显示在 MarginStudy；卡片和目录仍先进入可编辑预览。MarginStudy 不替换 Claudian 会话、不读取其聊天记录、设置、密钥或输入框，也不把请求发送到 Claudian 聊天记录。Claudian 不兼容时保留手动复制/粘贴回退。

用户可从“附加文字或图片 → 粘贴 AI 回复”选取回复，生成卡片、层级目录或 Markdown 的可编辑预览。粘贴 JSON 可生成多张卡片；普通正文可生成单张卡片；目录另支持 Markdown 标题与列表。只有点击保存才写入当前学习集或新笔记，卡片不会自动加入复习。目录保存为真实节点层级，整次保存可撤销。

AI TOC 可直接用同一桥接生成当前 PDF 的目录；不兼容时可复制提示词并粘贴回复。图片尚无已验证的 Claudian 附件接口，需要在其聊天中手动添加。

也可选择 **自定义 API**：

- 桌面端 Chat Completions 流式文本、图片、分片工具调用与工具结果回传。
- Mini/Normal 是用户自定义模型的两种角色，不等同于原版 Light/Deep。
- 地址、模型与绑定状态保存在库内非机密本地配置；API Key 只使用 Obsidian `SecretStorage`（1.11.4+），不会写入 Store、备份或日志。
- 修改地址、密钥或模型立即解除绑定。测试需通过 Mini 图片/文本、Normal 图片/文本、Normal 工具调用和匹配结果回传后才允许请求。
- Ask 发送独立问题；Chat 只保留当前侧栏的内存会话。仅发送用户输入和明确附加的文字、卡片、图片。
- AI 目录、卡片和 Markdown 均先进入可编辑预览。新 Markdown 拒绝覆盖同名文件。
- 支持取消生成、隐藏侧栏时中止请求、图片上传/粘贴和卡片拖入。切换研究侧栏或关闭再打开 AI 侧栏，保留同一次工作区会话的未发送问题、附件和已修改预览；关闭整个工作区才释放内存会话。

## Claudian 兼容依据

只读检查的已安装制品：`realclaudian` **2.3.21**，`main.js` SHA-256：

`e9461355faa81f557daab05314983d195cbfe27c0b6712092043e14a823ab26a`

适配使用插件注册命令 `realclaudian:open-view`、视图类型 `claudian-view`，以及该版本自身“Add to Claudian”入口所用的 `appendToActiveInput(text)` / `focusActiveInput()` 作手动回退。直接请求另使用该版本辅助会话内部的独立 passive 执行边界，显式传入当前 Claudian 已选模型；只接收本次运行事件，不调用工具。

这是**制品中观察到的内部方法，不是已公布的稳定 API**。仅对 2.3.21 启用直接执行与手动预填；未知版本、执行结构缺失或当前选中模型变化时停止并显示回退。独立会话禁用持久化（若宿主支持）、拒绝权限与追问交互，取消、超时或连接失效时取消并释放会话。此适配仍受 Claudian 私有实现变化影响。

REA 分析只使用单独复制的 `main.js` 与 manifest，不读取插件私有配置。分析图达到上限，属于部分静态结果；接口依据来自具体源码上下文，不能推断未观察到的结果接口不存在。

## 原版布局与手册参照

`evidence/native-max-l4/11-ai-chat-reference.png` 的 1512×859 桌面截图用于 440px 右侧栏、32px 顶栏、Template 行和底部输入区。设置、服务选择、可编辑草稿与 Claudian 桥接属于插件功能，未声称每个细节均为原版功能。

自定义 API 的绑定测试按已保存手册配置说明实现；流式工具片段及匹配 `tool_call_id` 的后续回传按官方 Function Calling 文档实现。

## 已执行验收

下表自动检查使用合成数据、隔离浏览器、内存 Store 或 localhost 合成服务，不调用真实模型。真实 Obsidian 和原仓库模型连接单列在下文。

| 命令 | 实际通过 | 证据 |
| --- | --- | --- |
| `node src/ai/acceptance.mjs` | 21 | [网络、绑定、工具、Store 与保存](acceptance-evidence/results.json) |
| `node src/ai/claudian-acceptance.mjs` | 18 | `evidence/package03-20261023/direct-validated-green.log`；直接请求、被动工具策略、会话隔离、错误与取消 |
| `node src/ai/ui-acceptance.mjs` | 18 | `evidence/package03-20261023/direct-validated-green.log`；回答流入助手、卡片预览可编辑且不自动保存、未知版本回退 |

旧预填截图只证明手动回退曾可用，不再代表主流程。合成插件运行时检查了直接回答流、当前请求作用域、原会话及输入框隔离。

2026-10-24 真实窗口验证：验收库安装直接 Claudian 构建并重载，助手显示直接发送状态。一次合成请求显示 Claudian 连接错误；当时没有可用模型，真实生成待用户配置模型后验收。原有未发送提问草稿已恢复到 MarginStudy 输入框，没有发送。

原 `yan` 仓库的 Claudian 2.3.21 已单独发送一次合成连接问题，要求只回复“连接测试成功”，禁止读取/创建/修改文件或运行工具。实际收到该回复，界面显示 `deepseek-v4-flash · High`、4 tokens、1.1s，见 `15-original-vault-claudian-response.json/png`。这证明当时该仓库已有模型连接可用；没有复制其密钥或配置，也没有把开发版 MarginStudy 覆盖到该仓库。

真实 Obsidian 中，未发送问题和已修改卡片预览经“AI → 研究 → AI”及关闭再打开均保留，见 `22-native-ai-session-retained.*`。隐藏期间中止 SSE 请求、保留部分回答且恢复不重复发送另由合成服务验证。工作区重载不保留内存对话。图片识别、复杂任务回答质量和全部提供方兼容性仍未验证。
