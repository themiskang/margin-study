/**
 * [INPUT]: PDF 橡皮擦夹具与隔离阅读器验收入口。
 * [OUTPUT]: 阅读器验收结果和 PDF 橡皮擦专项结果。
 * [POS]: 选择专项夹具并隔离浏览器会话。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
process.env.MARGINSTUDY_READER_SESSION_PREFIX = `marginstudy-pdf-eraser-${process.pid}`;
process.env.MARGINSTUDY_READER_PDF_ERASER = "1";
await import("../documents/acceptance.mjs");
