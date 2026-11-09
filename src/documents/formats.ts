export function isStudyDocumentPath(path: string): boolean {
  return /\.(pdf|msref|docx|epub|html?|md)$/i.test(path);
}
