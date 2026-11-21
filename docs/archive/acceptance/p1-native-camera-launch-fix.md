# P1 原生相机启动修复与验收

2026-10-19。子项11.5；仅部署MarginStudy验收库，11.5和父项11保持未关闭。

## 本轮结果

macOS Camera入口已由HTML相机改为公开ImageKit `IKPictureTaker`原生面板。插件内实点启动后，实际显示相机画面与Camera、Cancel、Done控件；Cancel可用。切换文档也会中止请求、退出相机并清理临时目录。没有按快门，没有保存实际环境照片或相机预览截图文件。

这解决了本机原先停在Starting camera的阻塞。没有据此声称与MN4全部视觉及功能完全等价。

## 查明的缺陷与修复

1. 浏览器代码吞掉`video.play()`错误后仍标记Camera ready。现在失败会释放流并返回页编辑；03失败、04通过记录保留。
2. 原先等待`play()`完成才加载设备列表，因此无帧时无法换设备。现在独立加载设备列表；07失败、08通过记录保留。
3. 真实宿主诊断显示getUserMedia已返回活动视频流，但videoWidth/Height及readyState一直为0，卡在play等待；窗口置前后相同。Chromium为什么没有交付视频帧仍未证明，不能将其归因于某个权限处理器。
4. macOS改走原生相机：随机请求目录、显式确认后输出PNG、结果协议及尺寸校验、仅一张插页、关闭/切文档时取消。非mac仍保留已修复的浏览器实现。
5. 直接执行Camera.app中的二进制曾返回权限错误；系统相机设置仅显示MN4，没有MarginStudy Camera条目。改为LaunchServices启动整个.app后，本机原生预览成功。授权归属差异是实现考虑，底层TCC归因未获得运行日志证明；没有修改系统隐私开关，也没有观察到新的可点击授权提示。
6. 插件通过`open -W -n -a`等待原生组件，读取请求目录中的result.json；取消会终止launcher并清理目录。helper监测目录生命期后自行退出，实机切文档验证了脱离launcher的进程同样退出。Timer主Actor编译警告已消除，最终构建无该警告。

## 插件L4实测

| 操作 | 结果 | 证据 |
| --- | --- | --- |
| 正式页编辑入口Add Page → Camera | 启动独立MarginStudy Camera，系统Edit Picture面板及实际预览可见；Done在未拍摄时禁用 | 20-native-camera-live.ax.txt；预览仅在工具即时查看，未写图片文件 |
| 点击原生Cancel | 面板退出，原四页及页编辑保留，按钮恢复 | 21-native-camera-cancel-cleanup.json |
| 再次打开Camera后切换文档 | 相机进程及临时目录均清理；无迟到插页 | 23-camera-switch-document.ax.txt、23-camera-switch-cleanup.json |
| 切回目标文档并真实停用/启用插件 | 原四页、首页和工作区恢复，退出页编辑，无Claudian浮框 | 24—27 AX记录；29-final-installed-state.json确认启用文件落盘 |
| 结束数据比较 | 19个模型/设置/完整工作区区段及目标PDF、两处受保护main.js共22项一致 | 28-final-data-comparison.json |

启用开关的AX值始终显示0，不能用该数值判断真实开关状态；以菜单条目、工作区恢复及最终community-plugins.json落盘交叉核对。早期取样曾只有realclaudian，最终29确认包含margin-study。未覆盖data.json、正式库插件、原开发源码或Claudian/API配置。

## 自动验证

沿既有Reader公开操作边界，OS边界由替身覆盖。

- typecheck、build、Reader108/108、Workspace80/80：17-launchservices-check.log。
- 修正Timer Actor隔离后再次构建通过：18-actor-build.log、18-actor-build-detail.log。
- 增加原生Camera确认结果的合成图片验证后，Reader **109/109**：22-native-selected-check.log及22-reader-results.json。验证双击仅一页、独立附件、宽高、重开后页身份与像素；测试不代表真实相机拍摄/Swift编码实测。
- 红色记录10-native-camera-route-red和16-native-launch-red等首跑失败继续保留，未改成通过；完整20套件未重复运行。
- 四插件产物与Camera.app逐文件部署哈希一致，签名验证通过；19-deployed-hashes.json及29-final-installed-state.json。
- 临时实机诊断代码和绝对证据路径已从源码/发布main.js移除。

Obsidian ASAR的REA只读分析未提供足够证据证明此次卡住由宿主权限handler造成；有选择范围及bootstrap完整性局限，01—02原始输出保留。不是MN4新增L3结论。

## 仍需完成

- 真实拍摄→Done→Swift PNG编码→插页，当前仅实际验证预览/取消和合成结果导入。
- MN4原生相机面板的完整模板、尺寸、按钮/状态逐一视觉对照；本轮未重复打开此前工具无法可靠取消的MN4系统弹窗。
- iPhone连续互通、其他实际相机设备和设备切换；当前只有本机相机实测。
- 真实Photos成功选图、HEIC/iCloud及全部窗口视觉。此前图库是No Photos，本轮没有加入用户照片。
- 然后11.6实际编辑PDF导出、11.7页编辑撤销/恢复；11.4原版Files最终插入待复核等旧差距保留。

证据：[native-camera-startup-20261019](evidence/native-camera-startup-20261019/)。旧阶段：[系统图库与相机](P1系统图库与相机插页验收.md)。
