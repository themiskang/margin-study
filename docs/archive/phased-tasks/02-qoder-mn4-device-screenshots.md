# Qoder 任务：MarginNote 4 实机截图与对照（02 包）

生成时间：2026-10-22 18:25。
任务对象：Qoder（或其他临时执行方）。**只做 MN4 实机取证，不改代码、不构建、不部署。**

## 0. 先读（只读，不要改动）

1. 本文件。
2. `分阶段任务/00-总控与交接规则.md`（数据/桌面保护与交替执行规则）。
3. `后续工作清单.md` 顶部"执行归属/切换记录"，特别是 **2026-10-22 14:35 第02包暂停、第01包恢复** 的记录。
4. `分阶段任务/验收报告/02-结果.md` 的"未关闭项与下一步"。
5. 测试输入：`evidence/package02-20261022/mn4-final-inputs/README.md`。

不要重读旧聊天、不要改 01/02 的报告、不要动源码。

## 1. 当前项目状态（避免误操作）

- 第02包处于**暂停、未关闭**；当前执行归属是**第01包**（用户已恢复 01）。
- 项目当前 `main.js` 为 `b75dc96e…`（18:25 实测），是 01 工作后的构建；02 交接包里的 `70f2842b…` 只是 02 在 14:10–14:35 的历史停点。**Qoder 不得基于任何哈希构建/部署 02，也不得回退/覆盖当前源码。**
- 只允许打开 MarginNote 4 做截图；**不要启动 Obsidian、不要碰验收库插件目录、不要改 data.json、不要改正式插件/yan/Claudian**。
- 若桌面正被 01 或用户占用，先问一句；同一时段只能一个桌面操作者。

## 2. 只允许写入的目录

```text
${MARGINSTUDY_REPO}/evidence/package02-20261022/mn4-qoder-20261022/
```

所有截图、导出的 PDF/PNG、说明都放这里；不要覆盖已有 evidence 文件。任务结束前不要改 `02-结果.md`（由 02 下一执行方整合）。

## 3. 测试输入（已准备好）

目录：`evidence/package02-20261022/mn4-final-inputs/`

| 文件 | 用途 |
|---|---|
| `l4-sample-alpha-copy.pdf` | 4 页统一尺寸 612×792，页 2 旋转 90°；导出面板/长图/裁边/旋转/批注/组合编辑 |
| `mixed-3pages.pdf` | 3 页混合尺寸：612×792、612×792 旋转 90°、400×600；非统一页宽长图 |
| `complex-form-link-outline.pdf` | 2 页：URI Link、内部 Link、原生 Highlight、AcroForm 文本框、两项目录；复杂 PDF 导出 |
| `long-30pages.pdf` | 30 页统一尺寸；长图超长边界/拆分或缩放 |

打开方式建议：`open -a "MarginNote 4" "<绝对路径>"`，让它作为 **Temporarily Opened** 文档，不要加入用户既有 StudySet。记录 MN4 版本 4.4.6 (44600)。

## 4. 必做截图清单（P0，先做完再考虑 P1）

每项都截：操作前、关键弹层/菜单、操作后、重开/导出结果。看不到的项记 `not-tested`，不要猜。

### P0-1 环境与版本
- MN4 主窗口全屏截图；About/版本截图；窗口尺寸；当前打开文档名。
- 确认并记录：App 4.4.6 (44600)、macOS 版本、显示器缩放（如可知）。

### P0-2 导出面板 / 选页 / 格式 / 保存面板
用 `l4-sample-alpha-copy.pdf`：
1. `Document → Export → Export Document`，截 `Select Pages for Export`（4 页）。
2. 依次截：Contents、All Pages、Page Range（输入 `1,3` 后）、Annotated、Clear；记录 Export (n) 数字。
3. 点 Export → 截 `Export PDF or Long Image` 格式弹层；分别点 PDF、Long Image，各截原生 Save 面板默认文件名/扩展名；取消或保存到证据目录。
4. 记录默认文件名（如 `L4SampleSet_l4-sample-alpha_XXXX_Flatten.pdf/.png`）与 Where 默认目录。

### P0-3 长图对照（核心）
1. `l4-sample-alpha-copy.pdf`：选全部 4 页 → Long Image → 保存到证据目录；用 `sips -g pixelWidth -g pixelHeight` 记录尺寸；在 Preview 截图整张长图。
2. `mixed-3pages.pdf`：选全部 3 页 → Long Image → 保存；记录尺寸、页序、每页宽度是否一致；截结果图。
3. `long-30pages.pdf`：选全部 30 页 → Long Image → 保存/观察；记录是否单张、是否缩放、是否拆分、是否报错/超时；截结果或错误。时间紧可只做 30 页一次。
4. 与已有插件输出对照（只读）：`plugin-long-image-real-commonwidth.png`（1898×7370）、`plugin-long-image-fresh.png`（1224×4752）、`mn4-long-image-fresh.png`（1536×5964）。记录长宽比；可选做并排对比图。

### P0-4 旋转原版
用 `l4-sample-alpha-copy.pdf`：
- 找到 `Document → 编辑 PDF 页面 → 旋转`（或工具栏旋转按钮），截菜单/按钮。
- 页 1 旋转 90°，截旋转前后页面；再转 180/270，记录方向。
- 旋转后导出 Long Image + PDF，保存到证据目录；在 Preview 重开导出文件，截图记录导出是否反映旋转、原页面旋转是否叠加。
- 记录旋转是否只影响显示（如能观察）。

### P0-5 裁边到一点恢复（需要鼠标拖拽）
用 `l4-sample-alpha-copy.pdf`，进入 Crop：
1. 截整页 + 八个手柄。
2. 把右下角拖到页面内部任意一点（非对角）→ Done → 截空白页；再次打开 Crop → 截（预期：仍是点状，不恢复）。
3. 手动把裁剪恢复整页（拖手柄回页面边界，或重开文档确认）。
4. 把左上角拖到页面**对角顶点**（零面积）→ Done → 截空白页；再次打开 Crop → 截（预期：恢复整页）。
5. 每步记录手柄坐标/页面状态；如果拖拽失败，截失败画面并记 `failed`，不要伪造。
注意：这是少数需要移动用户光标的操作；先确认用户不在用机，做完把光标移回。

### P0-6 PDF 插页（原版对照）
用 `l4-sample-alpha-copy.pdf` + `mixed-3pages.pdf`：
- 找到 `Document → Add Document / Insert Pages from File / Add Selected` 等入口；截菜单。
- 选择 `mixed-3pages.pdf` 的第 1 页或第 2 页，插入到当前页位置；截选择弹层、插入后页序/缩略图。
- 记录：插入位置、顺序、页面尺寸/旋转是否保留、总页数。
- 关闭并重开文档，截持久化结果；如果原版仍报文件不存在/失败，截错误并记录原始文字。

### P0-7 复杂 PDF 导出行为
用 `complex-form-link-outline.pdf`：
- 截页 1（Link + 原生 Highlight）、页 2（表单字段）、目录侧栏（若有）。
- `Export Document` → 压平 PDF + Long Image，保存到证据目录。
- 在 Preview 重开导出 PDF：截目录侧栏、点链接、点表单字段、看原生 Highlight；逐项记录保留/丢失。
- 如菜单有"导出源 PDF"与"压平 PDF"两种，截两者差异。

### P0-8 批注/Annotated 选页 + 组合编辑
用 `l4-sample-alpha-copy.pdf`：
- 在页 1、页 3 加高亮/评论；Export → Annotated，截选中页与 Export (n)；导出 Long Image，截结果。
- 组合：旋转页 2、裁边、插入一页、删除一页、移动页、加批注 → 导出 Long Image/PDF；截最终页序、重开结果。
- 若时间不够，至少做"加批注 → Annotated 选页 → 导出"。

## 5. P1（P0 做完还有时间再做）

- 真实 Save 面板：改目录、同名覆盖/Replace 行为；默认 PDF/PNG 命名。
- 长图超长拆分策略再确认（30 页结果复核）。
- 非统一页宽长图的页间距/背景/白边量化（用像素测量或目测记录）。
- 并排对比图：MN4 vs 插件已有 PNG（用 Python/PIL 或 Preview 拼图，标注尺寸/来源）。

## 6. 证据保存规范

```text
mn4-qoder-20261022/
  MN4-CAPTURE-SUMMARY.json
  MN4-CAPTURE-README.md
  01-environment/...
  02-export-panels/...
  03-long-image/...
  04-rotation/...
  05-crop/...
  06-insert/...
  07-complex-pdf/...
  08-annotated-combined/...
```

- 每张截图：`NN-<topic>-<step>.png`；每个主题一个 `.md`，写：操作步骤、菜单/按钮原文、实际观察、失败/未知。
- 导出的 PDF/PNG 保留原件；记录尺寸 `sips -g pixelWidth -g pixelHeight`、SHA256、保存路径。
- 截图可用 `screencapture -x <path>`（若 Qoder 有 shell/电脑操作能力）；没有就用自己的截图工具。
- `MN4-CAPTURE-SUMMARY.json` 至少包含：

```json
{
  "agent": "qoder",
  "date": "2026-10-22",
  "mn4Version": "4.4.6 (44600)",
  "items": [
    {
      "id": "P0-3",
      "title": "mixed-size long image",
      "status": "captured|partial|failed|not-tested",
      "screenshots": ["03-long-image/01-mixed-result.png"],
      "files": ["03-long-image/mixed-long.png"],
      "dimensions": "宽x高",
      "observations": "页序/宽度/页间距/背景/旋转实际表现",
      "uncertainties": "未确认或失败原因"
    }
  ]
}
```

## 7. 失败与未测

- 无法操作 MN4、试用到期、权限/弹窗阻断：立即停止，保留已截部分，在 summary 写 `not-tested` + 具体原因；不要编造。
- 原版报错/文件不存在：截错误原文，记 `failed`；不要改用插件结果替代。
- 每个 P0 做完就保存一次，避免试用到期丢证据。

## 8. 结束清理

- 关闭 MN4 中 Temporarily Opened 的测试文档；不要删除用户已有 L4SampleSet/笔记/卡片。
- MN4 若自动创建了临时 notebook，移到回收站并记录；不要 purge。
- 不动 Obsidian/验收库/源码；不部署、不构建、不改 data.json。
- 最后写 `MN4-CAPTURE-README.md`：已做/未做、证据索引、下一步建议。

## 9. 回报给用户的格式（短）

```text
MN4 取证完成。
已做：P0-1…P0-8（逐项一句话）
未做/失败：…（原因）
证据：evidence/package02-20261022/mn4-qoder-20261022/（MN4-CAPTURE-SUMMARY.json）
关键发现：长图尺寸/裁边恢复/旋转/插页/复杂PDF 各一句
未改代码、未部署、未动 data.json；MN4 已清理临时文档。
```
