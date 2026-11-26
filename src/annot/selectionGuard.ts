/**
 * [INPUT]: 无外部运行期依赖，纯字符串与几何数值校验。
 * [OUTPUT]: 导出选区防误触常量与纯函数 countExcerptWeight、meetsExcerptMinLength、isPointerMicroDrag、isValidSelectionRect、isValidRegionSize。
 * [POS]: 位于 src/annot/，作为 BaseAnnotationController 与 PDF/HTML 区域摘录入口的共享门槛守卫。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */

export const DEFAULT_AUTO_EXCERPT_MIN_CJK = 4;
export const POINTER_MICRO_DRAG_PX = 6;
export const SELECTION_MIN_RECT_PX = 6;
export const REGION_MIN_SIZE_PX = 12;
export const LASSO_MIN_SIZE_PX = 20;

const STRIP_NON_CONTENT_RE = /[\p{P}\p{S}\s]+/gu;
const CJK_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export interface PointerPoint {
  x: number;
  y: number;
}

export interface SizeLike {
  width: number;
  height: number;
}

/** 计算摘录正文的有效权重：剥离空白与标点符号后，CJK 字符计 2，其余有效字符计 1。 */
export function countExcerptWeight(text: string): number {
  const cleaned = text.replace(STRIP_NON_CONTENT_RE, "");
  let weight = 0;
  for (const ch of cleaned) {
    weight += CJK_CHAR_RE.test(ch) ? 2 : 1;
  }
  return weight;
}

/** 判断文本是否达到自动摘录 / 自动成卡的最短字数门槛（按中文字符计，英文按 2 倍折算；<= 0 关闭限制）。 */
export function meetsExcerptMinLength(
  text: string,
  minCjkChars: number = DEFAULT_AUTO_EXCERPT_MIN_CJK,
): boolean {
  const threshold = Number.isFinite(minCjkChars) ? minCjkChars : DEFAULT_AUTO_EXCERPT_MIN_CJK;
  if (threshold <= 0) return text.trim().length > 0;
  return countExcerptWeight(text) >= threshold * 2;
}

/** 判定单次指针点击是否为 < minPx 的微拖抖动；不拦截双击/三击（detail >= 2）或无 pointerdown 选区。 */
export function isPointerMicroDrag(
  start: PointerPoint | null | undefined,
  end: PointerPoint | null | undefined,
  detail = 1,
  minPx = POINTER_MICRO_DRAG_PX,
): boolean {
  if (!start || !end) return false;
  if (detail >= 2) return false;
  return Math.hypot(end.x - start.x, end.y - start.y) < minPx;
}

/** 判定选区合并外包框是否有效（width < minPx && height < minPx 视为抖动）。 */
export function isValidSelectionRect(
  rect: SizeLike | null | undefined,
  minPx = SELECTION_MIN_RECT_PX,
): boolean {
  if (!rect) return false;
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return false;
  return rect.width >= minPx || rect.height >= minPx;
}

/** 判定区域摘录框尺寸是否同时满足短边最小值（width >= minPx && height >= minPx，即隐含面积 >= minPx²）硬下限。 */
export function isValidRegionSize(
  width: number,
  height: number,
  minPx = REGION_MIN_SIZE_PX,
): boolean {
  if (!Number.isFinite(minPx) || minPx < 0) return false;
  return Number.isFinite(width) && Number.isFinite(height) && width >= minPx && height >= minPx;
}
