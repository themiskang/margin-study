# MarginStudy 第02包交接交付包

更新时间：2026-10-22 14:10（用户因上下文峰值要求停止本轮）。
本文件给下一执行方（DeepSeek / Codex / 其他 agent）单文件接手用。配合 [02-结果.md](验收报告/02-结果.md) 与 `evidence/package02-20261022/` 阅读。

**状态：02 未关闭。** 本轮完成后停止，下一执行方从"真实宿主重载 + 裁边手势复核"继续。

> **2026-10-22 18:25 状态更新（重要）**：第02包已暂停，当前执行归属为第01包（见 `后续工作清单.md` 14:35/之后记录）。项目当前 `main.js` 为 `b75dc96e…`（01 工作后的构建），本文件里的 `70f2842b…` 只是 02 在 14:10–14:35 的历史停点；不要把 `70f2842b` 当作当前构建，也不要据此部署/回退。接手 02 前先读实时清单的最新切换记录，并先做一次真实宿主/版本核对。

## 0. 一句话状态

- 源码 = 验收库，main.js `70f2842b45bedd76f674d61c05471d62215dbca17ee71966e10951ed94660cb0`，已构建并部署。
- `tsc`、build、Reader **177/177**、Workspace **99/99** 通过（隔离 harness）。
- **该构建尚未在真实 Obsidian 重载验证**；上一构建 `e7a4aa1e…` 已做过真实界面长图+系统保存验证。
- data.json 仍为宿主保存后的 `b35b27e7…`，本轮没有手工改；验收库根目录无本轮合成文件；Obsidian/MN4/ChatGPT 均已退出。
- 02 仍未关闭：裁边真实宿主复核、PDF 插页原版、Photos、格式/EXIF 全量、复杂 PDF 真实样例、非统一页宽 MN4 长图、真实超长/保存面板覆盖未验收。

## 1. 必读顺序（最小集合）

1. 本文件。
2. [00-总控与交接规则.md](00-总控与交接规则.md)。
3. [后续工作清单.md](../后续工作清单.md) 的"执行归属/切换记录"与 02 行。
4. [02-PDF页编辑与导出收尾.md](02-PDF页编辑与导出收尾.md)。
5. [验收报告/02-结果.md](验收报告/02-结果.md)。
6. `evidence/package02-20261022/round-20261022-long-image.json`、`round-20261022-crop-complex.json`。

按需再读源码：`src/pdf/pdfLongImage.ts`、`pdfExportUi.ts`、`pdfExportSave.ts`、`cropEditor.ts`、`pageCrop.ts`、`editedPdfExport.ts`、`imagePages.ts`。不要重读 01 长聊天，不要用旧快照覆盖当前源码。

## 2. 版本、部署与保护

| 产物 | 开发与验收库共同 SHA256 |
|---|---|
| main.js | `70f2842b45bedd76f674d61c05471d62215dbca17ee71966e10951ed94660cb0` |
| styles.css | `7e161cc341d77f5a1fa50e016785435ae6ca65cc116991933f8370ff906d2143` |
| pdf.worker.js | `a2197f116566b0b80cab7a464f0b3955a66a509b52c1e51bc2783bf52c12ed8f` |
| manifest.json | `905813cfbf218025870d606eea9b7592d91c4eeedd8ea8d78c6f3f642304e8a2`（1.2.12） |

- 唯一部署目标：`${MARGINSTUDY_TEST_VAULT}/.obsidian/plugins/margin-study`。
- 部署前备份：`evidence/package02-20261022/deploy-backup/before-{main.js,styles.css,pdf.worker.js}`（before-main 为旧版 `10316204…`）。
- data.json：`b35b27e79583efd57ad98eab4d3cf3ca2679761fc5006b371045ec9205bd804c`，由真实宿主保存阅读/工作区状态造成，不是手工修改。
- 两处保护 main.js 必须保持基线：`be2bbfecf7f32a558c53af1f2ae2bfee10178e9f84b3024b5c5c60721b376fe9`
  - `${MARGINSTUDY_LEGACY_SOURCE}/main.js`
  - `${OBSIDIAN_VAULT}/.obsidian/plugins/margin-study/main.js`
- 当前没有 Git。不要 `git reset`，不要用旧快照覆盖源码，不要替换验收库 data.json。
- 01 包未关闭，且 01 报告仍记旧值 `db6aff9c…`；切回 01 时必须由 01 自己补写停点，不能代写、不能把 01 当已完成。

## 3. 本轮已完成并验证

### 3.1 长图导出（真实界面 + MN4 对照 + 边界）

- 真实 Obsidian 1.14.4：命令面板"导出编辑后的 PDF" → `Select Pages for Export`（Export (4)）→ `Export PDF or Long Image` → **Long Image 可用** → 原生系统 Save 面板（默认名 `l4-sample-alpha_Flatten.png`）→ Save 落盘并复核。
- 受控 3 页 PDF（612×792，无历史裁剪）：插件 **1224×4752**，MN4 4.4.6 **1536×5964**；长宽比差 **0.012%**、统一缩放差 **0.012%**；页序、统一页宽、无页间距、白底一致（像素密度约 2.0 vs 2.51 px/pt）。
- 依据 MN4 实测把长图从"同一缩放、窄页居中"改为"统一页宽、每页按比例定高"；并做两遍渲染（避免超大中间画布）、逐页释放、`AbortSignal`/RenderTask 取消、`floor` 取整防尾页截断。
- 自动覆盖：混合页宽/旋转/非零 CropBox → 1000×2600；上限覆盖（maxHeight 1600/maxPixels 1e6）→ 521×1597；预取消/渲染中取消；系统 Save PNG 分支（mock）；PNG/JPEG/WebP/GIF/BMP 导入、透明白底、HEIC 拒绝。
- 证据：`plugin-long-image-fresh.png`、`mn4-long-image-fresh.png`、`plugin-long-image-real-commonwidth.png`、`screenshots/obs-03/04/05/11`、`screenshots/mn4-02/03/04`、`round-20261022-long-image.json`。

### 3.2 裁边到一点恢复

- MN4 4.4.6 实测：
  - 角点拖到**页内任意一点** → Done → 页面空白；再次打开 Crop 仍保持点状，**不恢复**。
  - 角点拖到**页面对角顶点（零面积）** → Done → 页面空白；再次打开 Crop **恢复整页**。
- 插件已实现：角点允许重合；Done 时零面积草稿恢复 `fullPageCrop`（一步恢复，避免留下空白页）。MN4 是两步（先空白页，再次 Crop 恢复），插件行为差异已记录。
- 证据：`mn4-crop-point-selection.png`、`mn4-crop-point-done-blank.png`、`mn4-crop-interior-point-reopen-still-point.png`、`mn4-crop-corner-point-done.png`、`mn4-crop-corner-reopen-restored.png`、`round-20261022-crop-complex.json`。

### 3.3 复杂 PDF 取证

合成含 URI Link、原生 Highlight、内部 Link、AcroForm 文本框、两项目录的 PDF，插件导出后实测：

- 保留：页数、可选文字、页级 `/Link`、`/Highlight`、表单外观 `/Widget`。
- 丢弃：AcroForm 字段注册（fields=0）、文档目录（outline=false）。
- 与 MN4 官方"压平 PDF 不含 MN 目录"方向一致；表单/链接的原始交互保留策略仍无原版依据。
- 证据：`round-20261022-crop-complex.json`、`reader.log`。

### 3.4 自动回归

`tsc --noEmit` 通过；`node scripts/verify.mjs build reader workspace`：build 通过、Reader **177/177**、Workspace **99/99**。日志：`evidence/verification/{results.json,build.log,reader.log,workspace.log}`。

## 4. 未完成项（不要当通过）

1. **真实宿主重载 70f2842b**（最优先）：重启 Obsidian 验收库，确认插件加载；重做一次长图导出 + 原生 Save；打开 Crop 复核零面积恢复手势和页面视觉。完成后记录 hostReload。
2. **裁边两步中间态**：插件是一步恢复；MN4 是先留空白页、再次 Crop 才恢复。要不要完全复刻两步，需产品判断并记录，不要静默改。
3. **旋转原版对照**：插件旋转导出有自动证据；MN4 旋转按钮实际点击/导出影响未做（可用 AX 菜单 + 截图补）。
4. **PDF 插页原版对照**：原版此前 Add Selected 报文件不存在；插入顺序/定位/持久化仍是实现选择。
5. **Photos 真实选图**：仅启动/取消通过；本机 Photos 无图，HEIC/iCloud/临时文件未测。
6. **图片格式/EXIF/色彩**：PNG/JPEG/WebP/GIF/BMP 自动通过；EXIF 方向全尺寸、色彩配置、动画、HEIC 转码未做。
7. **复杂 PDF 真实样例**：合成样例已取证；真实表单/链接/目录/原生批注、原版对照、大文档内存/缩略图性能、导出中外部改写竞态未验收。
8. **长图剩余边界**：非统一页宽/混合 CropBox/旋转的 MN4 长图；生产 32000px/64MP 上限的真实超长文档/巨大单页；真实界面渲染中取消；真实 Save 面板改目录/覆盖替换。
9. 01 未关闭、报告停点与旧值不一致，切回 01 由 01 自补。

## 5. 复现、构建、部署

```bash
cd ${MARGINSTUDY_REPO}
node_modules/typescript/bin/tsc --noEmit --pretty false
node scripts/verify.mjs build reader workspace

# 仅当源码变化后：构建并部署验收库
node esbuild.config.mjs production
cp -p main.js styles.css pdf.worker.js ../MarginStudy验收库/.obsidian/plugins/margin-study/
```

- `verify.mjs` 会占用隔离浏览器会话，**不要同时跑两份**；reader 约 40s，总 deadline 90s。
- build 会重写 `main.js`、`styles.css`、`pdf.worker.js`；部署前比对 SHA256，不要只拷 main。
- 部署只动验收库；不要动正式插件、yan 库、Claudian 配置、data.json。
- 真实界面入口：Obsidian 打开 PDF → 命令面板"在 MarginStudy 中打开当前 PDF" → 命令面板"导出编辑后的 PDF" → 选页 → Export as Long Image。

## 6. 桌面自动化现状（重要）

- 本机 AX/AppleScript 可用；helper 源码与编译产物在 `evidence/package02-20261022/axctl.swift` / `axctl`。常用：
  - `axctl tree <pid> 30 "关键词"`、`axctl click <pid> "按钮" --exact`、`axctl clickrole <pid> AXButton "..."`、`axctl setvalue ...`、`axctl key <pid> p cmd`。
  - AXPress/菜单点击不移动光标；`clickpid/dragpid` 是 postToPid 尝试，对 MN4 自绘画布未生效；真正拖拽仍用全局 `drag`（会移动真实光标）。
- Codex Computer Use MCP 已安装（`~/.codex/computer-use/.../SkyComputerUseClient mcp`），但从外部进程调用一直 `bootstrapTimedOut`，日志为 AppleEvent `errAEEventNotPermitted`/unexpected process；该服务只接受 Codex 自己的进程，不能直接复用。ChatGPT/Codex 已退出。
- 使用真实界面时**优先 AX/键盘/菜单**，避免占用用户鼠标；必须拖拽（如 MN4 裁边手柄）时先说明、做完把光标移回，并在证据里记录。
- 截图：`screencapture -x /tmp/xxx.png`；Obsidian 1.14.4（Info.plist 仍 1.12.7，自更新），MN4 4.4.6(44600)。

## 7. 数据、清理、回退

- 验收库根目录已无 `package02-*`/`*_Flatten.png`/`complex-source.pdf`；本轮合成文件在 `~/.Trash/package02-round-20261022/`。
- MN4 的受控 PDF 仅 "Temporarily Opened"，未加入 StudySet；MN4 已退出。
- Obsidian、ChatGPT、System Settings 均已退出；无待回复弹窗/未完成临时操作。
- data.json 未被手工修改；测试前后差异来自宿主保存阅读/工作区状态，无 `package02-l4-fresh` 的 docMeta 残留（已核对）。
- 部署前可回退产物在 `deploy-backup/`；两处保护 main 仍为基线。旧快照只能用于对照，不能覆盖当前源码。

## 8. 建议的下一步顺序

1. 真实宿主重载 70f2842b，重做长图导出 + 系统 Save + Crop 零面积恢复；记录 `hostReload=verified`。
2. MN4 旋转按钮实际点击 + 导出对照（AX，无需鼠标）。
3. MN4 非统一页宽/混合 CropBox 长图对照（用合成 PDF 临时打开，导出后清理）。
4. 真实 Save 面板改目录/覆盖同名 PNG；真实界面渲染中取消（若产品上有入口）。
5. PDF 插页原版对照；Photos 合成图导入后真实选图（需用户同意改 Photos 库）。
6. 复杂 PDF 真实样例（表单/链接/目录/原生批注）；决定是否保留 AcroForm/outline。
7. 全部通过后按模板关闭 02，更新 `后续工作清单.md` 02 行与报告。

## 9. 交接状态块（机器可读）

```json
{
  "package": "02",
  "closed": false,
  "stoppedAt": "2026-10-22T14:10+08:00",
  "stopReason": "user context peak",
  "sourceEqualsInstalled": true,
  "main": "70f2842b45bedd76f674d61c05471d62215dbca17ee71966e10951ed94660cb0",
  "styles": "7e161cc341d77f5a1fa50e016785435ae6ca65cc116991933f8370ff906d2143",
  "pdfWorker": "a2197f116566b0b80cab7a464f0b3955a66a509b52c1e51bc2783bf52c12ed8f",
  "manifest": "905813cfbf218025870d606eea9b7592d91c4eeedd8ea8d78c6f3f642304e8a2",
  "dataJson": "b35b27e79583efd57ad98eab4d3cf3ca2679761fc5006b371045ec9205bd804c",
  "protectedMain": "be2bbfecf7f32a558c53af1f2ae2bfee10178e9f84b3024b5c5c60721b376fe9",
  "tests": {"reader": "177/177", "workspace": "99/99", "build": "pass", "tsc": "pass"},
  "realHostReloadOfCurrentBuild": "pending",
  "appsRunning": [],
  "nextFirstAction": "restart Obsidian acceptance vault, verify 70f2842b loads, redo long-image export + crop gesture"
}
```
