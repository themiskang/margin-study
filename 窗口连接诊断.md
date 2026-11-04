# Computer Use 窗口连接诊断

日期：2026-10-16。用户要求再次出现窗口连接错误时，先暂停界面验收并排查原因。本次已按此顺序执行。

## 已确认的现象

- “显示文件列表”操作返回 `Computer Use server error -10005: noWindowsAvailable`。随后重新读取 Obsidian 时，文件列表已经显示。因此报错不能证明动作没有执行；具体失败环节尚不确定。
- 另一次工具返回 `The user changed ... Re-query the latest state ...`。这只能说明工具要求重新读取窗口状态，不能证明用户动过界面；原因尚未确定，也没有证据证明与 `noWindowsAvailable` 同一根因。
- 错误后应用清单仍可读取，Obsidian 仍在运行。现有 Codex 日志没有本次窗口获取失败的底层记录。
- 官方 [Computer Use 说明](https://developers.openai.com/codex/computer-use.md) 和 [故障排查](https://developers.openai.com/codex/app/troubleshooting/) 未提供此错误码的具体解释。

## 本次处理与复查

重置工具会话，按应用标识 `md.obsidian` 重新绑定，并核对窗口标题确为“MarginStudy验收库”。随后逐步执行并读取结果：打开文档设置菜单、Escape 关闭、打开宿主命令面板、执行上次失败的“显示文件列表”，均成功。窗口画面与可访问性树也均能返回，见 [复查画面](evidence/native-max-l4/43-window-session-diagnostic.png) 和 [窗口树](evidence/native-max-l4/43-window-session-diagnostic.ax.txt)。

没有更改系统权限、网络或安全设置，没有重装应用。短时复查通过只证明当前会话可用，不等于根因已定位或永久修复。没有证据将此次问题归因为网络断开。

## 后续执行规则

1. 每次动作后读取最新窗口状态，再选择下一步，避免使用重绘前的元素编号。
2. 错误后先核实动作是否已执行，不盲目重复点击、保存或改名。
3. 遇到旧窗口状态失效的保护提示，先重新读取指定应用及验收库标题，不把工具文案归因为用户操作。每次跨应用切换或长时间代码工作后，动作前也先刷新状态。
4. 若再次出现 `noWindowsAvailable`，暂停插件界面验收，优先记录窗口清单、报错时间、操作前后状态及可用日志，再决定恢复方式；不将一次重连成功记为根治。

本次诊断后恢复清单 04 的实机验收；连接问题仍作为未确定根因的工具问题保留。

## 后续明确阻塞：Mac 锁定

之后继续操作时，工具明确返回 `The Mac is locked and automatic unlock could not unlock it. Ask the user to unlock the Mac manually before continuing.`。此时停止原生界面操作，已请用户手动解锁。该提示有明确条件，不能据此把之前的 `noWindowsAvailable` 也归因为锁屏，更不能归因为网络。

锁屏前已完成原生双窗口 Markdown 连续改名与未保存草稿保留/保存（证据 51—54），合成文件当时暂名 `原生草稿改名-B.md`。

用户回复“已解锁”后，重新读取 Obsidian 窗口成功。通过原生辅助窗口恢复 `验收说明.md` 并关闭该窗口；主工作区禁用/启用插件、重开及截图均成功，证据 55—56。本次恢复没有再次遇到 `noWindowsAvailable`，也没有重复此前 A→B 的草稿改名动作。最初点击顶部路径没有改名，核实文件名未变后改用原生内联标题完成；这属于控件操作结果，不作为连接错误。

## 2026-10-17 阅读设置阶段补充

本阶段早先关闭独立 Settings 窗口后再次出现 noWindowsAvailable；重新绑定 md.obsidian 可读到验收库主窗口，后续关闭设置后先重新绑定再操作可继续。原始事件保存在 `evidence/native-max-l4/20261017-read-settings-connection-events.json`，没有证据把一次恢复当作根治。

之后发生旧状态失效保护提示。用户明确说明其中一次是自己切换窗口，又说明误开第二桌面并允许继续。**普通标签、窗口和桌面切换可以进行**，由工具重新读取状态；这两个具体说明不能推广为历史 noWindowsAvailable 的根因。后续代码工作后刷新绑定、设置关闭后重新绑定均成功，本次摘要续接后没有新增 noWindowsAvailable。

另一个问题与窗口连接分开记录：264—271 插件已运行、设置开关开启，而磁盘 community-plugins.json 仍只有 realclaudian。273—278 再次停用/启用，保持设置打开直到确认启用列表落盘，再关闭重开，列表和工作区恢复通过。宿主内部原因未确认，不能据此归咎用户或网络，也没有把它改写成连接错误。后续重载验收须先确认启用列表，不能只看插件界面能否打开。
