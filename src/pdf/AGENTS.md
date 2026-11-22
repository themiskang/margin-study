# src/pdf/

> L2 · 上级 [AGENTS.md](../../AGENTS.md)

- `readerView.ts` 挂载 PDF 阅读器，协调文档显示偏好、页面和留白生命周期。
- `pdfjs.ts` 加载 PDF.js 并解析文档。
- `cmaps.json` 为离线 PDF worker 提供 CMap 和字体。
- `annotationLayer.ts` 将 PDF 批注、手写栅格和回忆遮罩投影到独立页面层。
- `cropEditor.ts` 提供页面裁剪交互。
- `pageCrop.ts` 转换裁剪前后的页面坐标。
- `pageEditor.ts` 提供页面排列、旋转和增删交互。
- `pageImport.ts` 读取外部 PDF 和图片页。
- `imagePages.ts` 为图片文件生成 PDF 页面。
- `imageRegions.ts` 识别页面图片区域。
- `nativePhotoPicker.ts` 将原生相机与照片选取接入阅读器。
- `editedDocument.ts` 维护页面编辑记录与来源映射。
- `editedPdfExport.ts` 以页面编辑记录重建 PDF。
- `exportAnnotations.ts` 按文档的手写置顶偏好排列扁平化批注。
- `pdfExportSave.ts` 写入导出文件。
- `pdfExportUi.ts` 提供 PDF 导出交互。
- `pdfInteractiveExport.ts` 生成可交互 PDF 批注。
- `pdfLongImage.ts` 将选定页面合成为长图。
- `outline.ts` 将 PDF 大纲映射到阅读器目录。
- `regionFolds.ts` 维护区域折叠与页面坐标映射。
- `textColumns.ts` 识别页面文字列。
- `extendNotes.ts` 提交留白内容与几何，更新卡片字段，异步生成卡片预览。
- `extendTextBoxes.ts` 以留白纸面坐标编辑和绘制文字框。
- `extendText.ts` 定义留白文字带的文本缩放。
- `extendCardText.ts` 转换留白富文本与卡片文本。
- `extendMedia.ts` 将留白内容合成为卡片预览。
- `extendExport.ts` 导出留白与来源摘录的卡片。
- `extendNavigation.ts` 提供留白导航和缩略图。
- `extendImageCrop.ts` 提供留白图片裁剪和旋转。
- `extendImageEditor.ts` 编辑留白图片的纸面坐标。
- `extendMenu.ts` 提供留白操作菜单。
- `extendSpeech.ts` 将语音输入接入留白编辑器。
- `extendGeometry.test.mjs` 验证缩略图延迟期间 Store 已提交两轴尺寸。
- `hw-eraser-acceptance.mjs` 选择 PDF 橡皮擦夹具并调用隔离阅读器套件。
- `hw-eraser-fixture.txt` 验证擦除、换工具、重开和笔迹识别。

[PROTOCOL]: Update this header on change, then check AGENTS.md
