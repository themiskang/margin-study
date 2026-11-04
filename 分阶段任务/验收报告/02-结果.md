# 02 PDF页编辑与导出结果

日期：2026-10-23  
状态：**已关闭：本轮列明的实际功能缺口已修复并验证**。此前“核心闭环收口但复杂PDF不保留表单/目录、链接点击未测”的结论已由本报告替代；不能再把这些历史缺口称为纯视觉差异。
范围：原11.1—11.7、11.9。第一包不重开。

## 已完成的用户流程与呈现

- 导出准确页面/范围，PDF或长图，系统Save改名/目录/Replace/取消；裁边、旋转90/180/270、空白插页和混合页面组合导出已有Qoder实机证据，按已通过范围复用。`evidence/qoder-real-20261022/02-pdf/SUMMARY.json`保留历史操作与图/文件索引。
- MN4 Annotated可用且点击实选第1、3页，Export(4)→(2)，沿用`evidence/package02-20261023/mn4-annotated-*.{png,txt}`。本轮不再占用MN4或重跑旧手势。
- **表单修复**：导出注册标准AcroForm字段树，保留层级字段名、值、复选框状态与页面控件。单控件终端字段采用标准合并字段/控件表示，避免Preview只改Widget值而父字段仍旧。多控件共享字段保持一个逻辑字段；仅导出部分页时去掉未选页控件；插入另一份同名表单时根字段自动加后缀，避免覆盖原字段。
- **目录修复**：导出原生PDF目录及子级，目标映射到真正导出的页面；删除/不导出目标时裁除失效条目，父项仍有有效子项时保留分组。
- **链接修复**：保留外链URI，重绑定直接/命名/GoTo内链；页序变更后跳到正确输出页，未导出目标不留下指向游离页面的死链接。
- **真实外部使用通过**：Obsidian新构建导出3页PDF；Preview实际执行内链到第3页、目录第一章回第1页；外链经Preview确认交给Chrome，实际地址为`example.com/?marginstudy=p02`。最终文件表单填写Grace Hopper→保存→关闭→重开仍显示新值；pypdf读取标准字段值也为Grace Hopper，渲染外观一致。外链首次实测在同一轮合并字段修复前构建，导航代码未变；最终构建内链/目录/表单均复测。
- 第一包相机/Photos与自动图片格式通过项沿用，未新增拍摄。

## 代码与部署

| 文件 | 原因与改变 |
|---|---|
| `src/pdf/pdfInteractiveExport.ts`（新增） | 复制页面时先断开旧字段父链和导航引用，避免带入未选择的源页面；完成所有页面后重建表单、目录及内链。字体资源按来源加命名空间，避免合并表单资源重名；源PDF不写入 |
| `src/pdf/editedPdfExport.ts` | 页面导出调用上述复制/重建过程，其余裁边、旋转、批注与Extend生成链保留 |
| `src/documents/acceptance-fixtures/pdfExportCases.txt` | Reader导出公共边界测试，独立PDF.js/pdf-lib重开验证表单编辑、实际页引用、目录、删页/重排/部分导出/插页及同名字段 |

上一轮Save Replace修复保持，Save5/5回归与本轮实际Replace再次通过。仅部署验收main/styles，未覆盖data、manifest或worker；真实宿主已重载最终构建。

| 文件 | 开发=验收SHA256 |
|---|---|
| main.js | `d094cd465632fb3004b1179c9afeaf503b989a6b7ec07cced46fa6d6f6c176e3` |
| styles.css | `fc883e000bc0e9c88781291e6dcf8ab30d5a3c994e79ad3bb79e364159967e5f` |
| manifest.json | `905813cfbf218025870d606eea9b7592d91c4eeedd8ea8d78c6f3f642304e8a2`（1.2.12未改） |

证据根：`evidence/package02-interactive-20261023/`。源码与安装前备份在`before/`、`deploy-before/`；最终源码归档`source-interactive-final.tar.gz`，SHA256 `7e2b1c627575aa28f4bcf577dd6889daa67107f6486acc8de7f8859333b216c4`。本轮前报告保留于`before/02-结果.md`。

## 验证

| 对象 | 实际执行及结果 | 证据 | 边界 |
|---|---|---|---|
| 自动回归 | typecheck/build通过；Save5/5、Reader180/180、Workspace102/102 | `verification-summary.json`与`final-*.log` | Workspace原有spread-fit间歇失败一次，原日志保留；定向复跑102/102。没有为此修改工作区代码；计数不是覆盖率 |
| 行为红绿 | 缺字段红例→修复；发现Preview父/子旧值冲突→单控件一致值红例→修复；复杂场景回归通过 | `fields-links-outline-red.log`、`widget-canonical-red.log`、`final-reader.log` | 一次把单控件断言误用于共享多控件的测试已改正，原失败日志保留，不把修测试当修产品 |
| 真实Obsidian1.14.4 | 重载最终main→真实导出→原生Save/Replace成功 | `deployment.json`、`host-interactive.pdf`、`final-pdf-audit.json` | 使用受控3页含目录/表单/内外链合成样例，不使用真实笔记 |
| 真实Preview | 最终PDF内链→第3页；目录→第1页；表单输入/保存/真实关闭重开通过 | `preview-final-link-page3.ax.txt`、`preview-final-outline-page1.ax.txt`、`preview-final-reopened.ax.txt`、`preview-edit-copy.pdf` | 文本字段保存实测；复选框勾选值导出/自动编辑验证，最终实机未改复选框 |
| 系统浏览器 | 外链实际启动Chrome，目标地址一致；测试标签已关闭 | `external-link-opened.ax.txt` | 只确认链接打开目标地址，不依赖目标站点业务 |
| 独立解析与视觉 | 输出页引用、目录页码1/2/3、标准字段Ada→Grace Hopper、控件外观流、重开渲染通过 | `final-pdf-audit.json`、`form-persisted.json`、`render-edited.png` | 没有用仅出现Widget或截图代替标准字段值检查 |
| MN4/Qoder复用 | Annotated、旋转/裁边/插页/长图证据保留 | Qoder02 SUMMARY/NOTES与上一轮package02证据 | 不是本轮重新操作；页内容生成算法未更改，不重跑已通过项 |

## 数据与清理

- 两次部署各自data前后严格相同，见`deployment.json`；宿主后来正常写入revision等，未手工替换data。
- 唯一本轮库内合成文件`p02-interactive-20261023.pdf`经Obsidian文件列表→删除→明确系统回收站正常清理；独立阅读标签已关闭，回到L4SampleSet/l4-sample-alpha。保留一条missing=true文档登记，未purge。
- `cleanup-audit.json`：仅排除准确的新合成文档登记和revision/writerId/savedAt后，**19项业务键严格相等**，包括完整workspaceState、docMeta、所有既有卡、节点、脑图、学习集及settings。没有新增卡、批注或脑图节点。
- 完整data恢复副本仅验收插件`package02-recovery/interactive-20261023/data-before.json`；合成源PDF和导出件在开发证据目录保留。上一轮mixed/long30已入回收站的状态未改。
- Preview已退出，外链测试Chrome标签已关闭。MN4未操作；两处保护main均仍为`be2bbfecf7f32a558c53af1f2ae2bfee10178e9f84b3024b5c5c60721b376fe9`。正式插件、yan、真实笔记和Claudian未修改；Trash未清空。

## 未测边界与下一步

本次用户明确要求收尾的“目录丢失、标准表单字段丢失、链接实际点击未验证”三项已关闭。所验证的是常规PDF目录、内部显式/命名目标、URI和AcroForm文字/复选框及共享控件；不以这些样例宣称覆盖所有PDF扩展或所有外部阅读器。

之前列明的HEIC/iCloud/复杂EXIF、超大文档资源极限、真实导出中途取消等仍属于设备/极限兼容未测范围，未新增“已知功能丢失”的豁免。第一包微差不重开。下一包按总控为03，本轮不启动并行任务。

最小接手：本报告、实时清单顶部/末尾、`deployment.json`、`verification-summary.json`、`cleanup-audit.json`；只有查具体红例时再读日志，勿重读旧evidence全库。
