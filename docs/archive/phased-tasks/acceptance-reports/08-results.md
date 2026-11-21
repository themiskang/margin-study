# 第08包结果｜系统能力与硬件验收

日期：2026-10-25  
状态：**收尾完成；未宣称全部功能通过。** 第08包执行已结束，第09包未启动。第05暂停、第06暂缓、第03真实模型事项暂缓状态保持不变。
范围：原编号26—28，真实录音、播放、保存、离线转写回流、朗读、词典/翻译、多栏OCR、设备及失败恢复。

## 实际流程与边界

- **Obsidian录音与播放**：在验收库用MacBook Pro内置麦克风采集合成语音，约5秒材料实际形成14.219946秒WebM/Opus（48 kHz、单声道、227668字节）。播放、保存、宿主重载后再播放/暂停均通过；音频SHA256 `ab4abb9e747b11a34da0adc7054b77c4f8c18c0842766061cd97f175f3711995`未变。
- **本机离线自动转写**：集成whisper.cpp Tiny multilingual，识别在本机CPU执行，不上传音频、不访问网络。真实录音初稿为“Packaging. This is a synthetic microphone test. One, two, three, four, five.”；校对为“Package eight. This is a synthetic microphone test. One, two, three, four, five.”后保存。识别阶段原文字不变；保存、Undo/Redo、宿主重启重开后保留；识别失败（临时缺模型）不丢旧文字，恢复原模型后重试成功。音频数据字段不变。Tiny把“Package eight”识别为“Packaging”，需人工校字，不能称识别无误。
- **录音卡片设备结束**：修复卡片编辑器收到设备自行结束后，再点停止会重开录音并丢第一段的问题。红测118/119、修复后119/119；typecheck、`npm run build`、Reader 198/198、Workspace 119/119通过。最终代码见`src/cards/nativeEditor.ts`。
- **MN4原版实际回放与清理**：在 MarginNote 4 4.4.6 arm64 的 L4SampleSet 中，P08_SYNTHETIC_AUDIO 14秒录音从0秒播放进展到12秒（88%），结束后回到0秒；确认录音实际可播放并完成。卡片经 Delete 后由 Undo 恢复、再由 Redo 移除，最终活动Cards列表无该卡。l4-sample-alpha、long-30pages仍在；Review为空；系统默认输入已恢复BlackHole 2ch。未购买或更改许可证，未永久清空Trash。
- **朗读**：全文PDF按页面可选文字/OCR顺序读取，定位到来源页；扫描PDF启动、暂停、继续、2.5倍速、完成通过。所有系统声音和发音质量未独立评测。
- **多栏OCR**：连续留白栏沟需每侧至少三行；跨栏标题/页脚分带，原坐标不变。本机Vision中英双栏样本10框栏序/坐标有效；真实宿主双栏顺序、搜索RIGHT TWO 1/2到2/2、框定位通过。保留识别错误：独立Vision样本`sunlight`→`sunlignt`，宿主缩放样本`records sound`→`recoras souna`。复杂表格、倾斜、低清及任意多栏未验证。
- **失败恢复与未配备硬件**：权限请求合并、启动/停止防重、设备结束保留字节、保存失败保留Blob并重试、取消与失败恢复有自动/合成边界检查；没有真实系统拒权或拔除设备测试。用户确认没有额外硬件；压感笔、笔尾擦除、真实笔套索和额外相机未配备，未实测。套索只有鼠标/合成PointerEvent证据。
- **复用范围**：词典/短词翻译复用第07包有道`photosynthesis`、Google Translate至“光合作用”的证据；不外推长文、账号或词典音频。相机复用第01包已有本机拍摄证据；本轮不重复拍摄/申请权限。

## 源码、部署及归档

- 开发和验收插件最终 `main.js` SHA256：`ef2c830089c28723f7e288670b4945cf6511e215553980e6a77b2e6c13656110`；`styles.css`：`831dab9e7563d0c48571fa667cd2e1c3a7406cd8048677e401dcf8066af9ec4d`；manifest `1.2.12`。部署快照`actual-closeout/deployment-card-ended.json`记录main部署时data前后均为`fdb7966cafb566be6e6838fba0a56b982fcd8c423b8fad1bed21ca2cbfa757d7`。
- 最终安装Runtime与开发版逐文件哈希相等：`runtime.json` `74eb98b612d1c882e4b76ab8746359670a8cee80ac55ede5e71b35e867558eab`；`whisper-cli` `4d2108a0f491c0fa4f2f6ed3697a037236ae107dd09128b10030632247d82e55`；`LICENSE-whisper-cpp` `94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d`；`ggml-tiny.bin` `be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21`；`README.md` `72b8939318eb97a08148f3d2a38a5b66ee548fa299c827224abdc8b0c5dadba5`。
- 新源码包`evidence/package08-20261024/source-package08-final-20261025.tar.gz`含250个逐文件归档项，SHA256 `fbcd3df85b5f46cc877d3315f854f931286a7590ed202d115b51f013d9e8d3da`；逐文件manifest为`identity-final-20261025.json`。含`src/audio/transcription.ts`、修复后的`src/cards/nativeEditor.ts`及`native/transcription/`五个Runtime文件。原244文件包已过期。回退快照仍为`evidence/package08-20261024/source-before.tar.gz`。

## 数据、清理与保护

- 最终验收库`data.json` SHA256：`bea5a6fdac49c33ca65ed5cecc3ab61f02171203048d65a563e8d8a05ede6603`，与`actual-closeout/business-current.json`逐字结构一致；未覆盖data.json。相较即时部署哈希，宿主后续保存了workspace状态。cards/nodes/edges为15/7/1；26条documents中原25条相等，另有`p08-system-scan.pdf`一条missing历史登记保留；studySets、docMeta、settings和其他业务集合与最近清理快照相同。
- 活动验收库中不存在`p08-system-scan.pdf`、`.mstudy.json`或P08录音文件。准确测试文件已通过Finder移入系统Trash；Trash未清空、不做永久删除。既有文档登记仍可见为missing，未移除恢复信息。
- Reader/workspace相对最初基线保留已记录差异：全局默认缩放从`0.532`变为`0.569`（正常UI渲染导致）；Reader tab位置`left`从`0`变为`93`。后者仍存在于最后保存快照；不直接改data强制回滚。
- 1459字未发送TOC草稿准确恢复，附件0，AI请求0。未读Claudian配置/密钥。WorkBuddy源与yan正式插件保护main均为SHA256 `be2bbfecf7f32a558c53af1f2ae2bfee10178e9f84b3024b5c5c60721b376fe9`。

## 验收证据

证据根目录：`evidence/package08-20261024/`；本轮最终审计：`actual-closeout/final-closeout-audit-20261025.json`。关键材料包括`asr-return-audit.json`、`host-asr-after-reload.ax.txt`、`mn4-playback-cleanup-audit.txt`、`deployment-card-ended.json`、`identity-final-20261025.json`、`final-protection-audit.json`、`draft-protection.json`。真实宿主和自动验收证据按其构建版本记录，不把早期截图冒称最终构建。

第08包已完成本轮可用设备下的验收与可恢复清理，未启动第09包。硬件缺失、真实拒权/断连和复杂OCR边界按未测记录，不折算成通过。

## 后续 Obsidian 优先复核与 P08 回归清理（2026-10-25）
用户指出优先检查 Obsidian。随后重新在 Obsidian 真实验收库验证文档目录、阅读设置、原文回跳高亮和 `SAMPLE` 搜索 1/9→2/9；没有改录音或卡片数据。与此同时再次观察既有 MN4 样例卡列表时，先前报告记为已清理的 `P08_SYNTHETIC_AUDIO`（14 秒）又出现在 Cards 列表。已通过卡片 UI 的正常可恢复删除操作再次移除，并在随后的 AX 列表确认该卡不存在；原有 `Occlusion`、`P01`、`P0` 卡仍在。没有清空 Trash。该运行态与此前“最终列表已无测试卡”的断言冲突，故将旧断言降级为历史清理记录；P08 活动卡片在本次检查后确实已再次清理，但仍需后续只读核查 Obsidian 业务快照/计数，不能沿用先前数值声称整个库未变化。
