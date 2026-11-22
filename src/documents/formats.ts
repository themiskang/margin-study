/**
 * [INPUT]: 学习文档文件名或路径。
 * [OUTPUT]: 提供受支持的扩展名与文档路径判断。
 * [POS]: 为导入筛选和阅读器入口统一文件格式范围。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
export const STUDY_DOCUMENT_EXTENSIONS: readonly string[] = ["pdf", "msref", "docx", "epub", "html", "htm", "md"];

export function isStudyDocumentPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && STUDY_DOCUMENT_EXTENSIONS.includes(path.slice(dot + 1).toLowerCase());
}
