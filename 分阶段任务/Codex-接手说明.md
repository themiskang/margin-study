# Codex 接手说明：当前代码状态与 review-ui 阻断

更新时间：2026-10-22 18:40。
用户已明确：**插件代码改动交给 Codex**，本会话不再改插件。本文件只记录事实与建议，不包含未提交的代码改动。

## 1. 当前状态

- 01/02 均未关闭；实时清单当前执行归属为第01包，02 暂停。
- 当前共享构建 main `b75dc96e…`、styles `0589cab3…`（01 最近构建），不要按 02 交接包里的 `70f2842b…` 部署/回退。
- 本会话今天早些时候对 02 的长图统一页宽、裁边恢复、取消信号等改动已进入共享源码/构建；按用户新指令不再继续改插件。
- 最近为跑通 `review-ui` 做的临时改动（`src/cards/nativeEditor.ts` 格式栏初始显示、`src/review/ui-acceptance.mjs` mock/断言）**已全部回退**，仓库恢复原状。

## 2. 自动回归基线（2026-10-22 18:3x，当前源码）

除 `review-ui` 外，以下套件均通过（`node scripts/verify.mjs <suite>`）：

- model-l3 25/25、model-additive PASS、review PASS、decks PASS、study 14/14、study-ui 10/10、study-observed-ui 8/8、organize-ui 17/17、web-import 9/9、mindmap-ink-export 11/11、ai PASS、claudian PASS、ai-ui PASS、research 15/15。
- `review-ui` **FAIL**（当前 0.0s 失败，尚未进入断言）。

## 3. review-ui 的两个独立问题

### 3.1 构建期失败（当前阻断）
`src/review/ui-acceptance.mjs` 的合成宿主缺少：

```text
No matching export in obsidian.ts for import "setIcon"
  src/annot/documentNotebooks.ts:5
No matching export in "synthetic:reader-types" for import "ReaderView"
  src/cards/cardView.ts:15
```

临时补 `export function setIcon(){}` 和 `export class ReaderView {}` 后可以构建并跑完 33 项；这些临时修补已回退，未提交。Codex 可在自己的分支修复 mock。

### 3.2 修好构建后暴露的两处“测试/产品口径”差异
1. **Note Card 编辑器底部格式栏初始可见性**
   - 测试 `native Note Card editor retains the 520 by 560 floating template and full-width bottom format bar` 期望打开编辑器时 `getBoundingClientRect().bottom === 949`（即格式栏可见）。
   - 当前 `src/cards/nativeEditor.ts` 初始 `formatBar.hidden=true`，只在正文/来源输入框 `focus` 后显示；因此测得 0。
   - 需要 MN4 实机证据决定：原版 Note Card 编辑器一打开是否显示底部格式栏。Qoder 任务已加该项截图。
2. **手写批注的持久化位置**
   - 测试 `the native pen control inserts a real drawn image into the note and persists it` 期望 `card.back` 包含 `![手写批注](data:image/png;base64,...)`。
   - 当前实现把手写图存入 `card.commentMedia`（`kind:"ink"`），不写回 `back` 文本。
   - 需要原版/数据模型决策：MN4 的手写是正文内联图片还是独立附注媒体。Qoder 任务已加该项截图。

## 4. 建议 Codex 接手顺序

1. 先核对实时清单/当前哈希，确认没有其他写入者；避免与 01 同时改。
2. 修复 `review-ui` 合成宿主（setIcon / ReaderView）；这是测试基建，不改变产品行为。
3. 用 Qoder 回传的 MN4 证据决定 3.2 两处口径；不要仅为了测试通过改产品。
4. 再按 03—10 审计结果补功能；每包跑对应套件 + build。
5. 只部署验收库；保护 data.json、正式插件、yan、Claudian；两处保护 main 基线 `be2bbfec…`。

## 5. 相关文件

- 十包实机取证任务：`分阶段任务/Qoder-十包实机取证任务.md`
- 02 专项取证：`分阶段任务/02-Qoder-MN4截图任务.md`
- 测试输入：`evidence/qoder-real-20261022/inputs/`
- 02 交接：`分阶段任务/02-交接交付包.md`（注意 18:25 状态更新横幅）
- 实时清单：`后续工作清单.md`
## 6. 06—10 只读审计结论（2026-10-22 18:35，供 Codex 排期）

- **09 P0**：来源身份未解决。建议 `DocumentRecord` 加 `contentSha256`；`vault.on("create")` 对缺失文档做唯一哈希匹配并弹“重新关联 A→B”确认；`TFolder` rename 做前缀迁移；`renameDocument` 支持 missing oldPath 并同步 msref；pending-main/annotations 需在 load 时重放。禁止按相似文件名盲连。
- **08 P0**：转写完全未实现（无 UI/接口）；OCR 只有按 y 合并，无字框/多栏顺序；真实麦克风录音/重放无证据；Photos 成功选图/HEIC 未测；无触控笔硬件证据。
- **06 P0**：无自动结果回流（仅手动粘贴）；当前 b75 构建 AI 面板未真实宿主复验；验收库无 API，真实回答只能经用户授权在 yan 完成；不得称自动回流。
- **07 P0**：无真实搜索站/登录/动态页实测；切换重开只恢复 URL，历史/滚动丢失；打印只测本机 1 页。需 Qoder 逐站表，代码先不改。
- **10 P0**：08/09 未收口，不能进入正式交付；全界面同尺寸矩阵、安装包/干净安装/更新/回退、单条完整流程均缺；manifest 1.2.12 vs package 0.2.0 未统一；20 套件尚无一次 `completeRun=true`。
- **04/05 待审计**：当前 `review-ui` 原状构建失败（缺 setIcon/ReaderView）；修好后暴露格式栏初始可见性、手写存 `commentMedia` 与测试断言不一致，需 MN4 证据后再定产品口径。不要仅为测试通过改产品。
- 本轮未改插件；Qoder 证据写入 `evidence/qoder-real-20261022/`，由审计方判定。
## 7. 03—05 只读审计结论（2026-10-22 18:50，供 Codex 排期）

- **03 P0**：目录编辑/拖动/AI TOC 全缺（无 docMeta 目录模型）；扫描页无文本层不可选；自由元素无任意角度旋转；Settings 只覆盖 UI Theme 一类。建议先建 docMeta TOC 模型 + outline 编辑/拖动 + documentNavigation 接入，再做角度；改 readerView/pdfGeometry 后重跑 01/02。
- **04 P0**：`review-ui` 红是格式栏初始可见性（产品或测试口径，需 Qoder MN4 证据）；三视图“同内容/关系”无单流程用例；模板/编辑器、看板默认分组缺同尺寸原版对照。建议先修 `review-ui` 合成宿主（setIcon/ReaderView），再决定产品口径；organize-ui fixture 加“编辑一处→三视图一致→重开”。
- **05 P0**：真实宿主端到端（组列表→浏览→问题→答案→四档→完成→返回）未做；浏览/完成底栏只对旧参照；空组/首末禁用无 UI 断言；FSRS 非原版。代码侧只需补空态/断言，主要靠 Qoder 真实证据。
- 三包均无 `03/04/05-结果.md`；旧 MN4 参照为 10-16/17，早于当前 b75 构建。
