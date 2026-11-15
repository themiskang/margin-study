/**
 * [INPUT]: 依赖浏览器指针事件与笔迹类型。
 * [OUTPUT]: 提供采样、预测和掌触过滤函数。
 * [POS]: 为手写控制器转换输入并估算预测位置。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { Stroke } from "../types";

export interface TimedInkPoint { x: number; y: number; time: number }

export function predictInkPoint(points: TimedInkPoint[], downTime: number): TimedInkPoint | null {
  if (points.length < 3) return null;
  const [first, middle, last] = points.slice(-3);
  const firstDt = middle.time - first.time, lastDt = last.time - middle.time;
  if (last.time - downTime < 30 || firstDt <= 0 || lastDt <= 0 || lastDt > 40) return null;
  const vx = (last.x - middle.x) / lastDt, vy = (last.y - middle.y) / lastDt;
  const previousX = (middle.x - first.x) / firstDt, previousY = (middle.y - first.y) / firstDt;
  const speed = Math.hypot(vx, vy), previousSpeed = Math.hypot(previousX, previousY);
  if (speed < .08 || previousSpeed < .08 || speed > previousSpeed * 2 || previousSpeed > speed * 2 ||
      (vx * previousX + vy * previousY) / (speed * previousSpeed) < .9) return null;
  return { x: last.x + vx * 12, y: last.y + vy * 12, time: last.time + 12 };
}

export function inkPoint(event: PointerEvent, x: number, y: number): Stroke {
  return { x, y, ...(event.pointerType === "pen" ? { pressure: Math.max(.05, Math.min(1, event.pressure || .5)) } : {}) };
}

export function inkSamples(event: PointerEvent): PointerEvent[] {
  const samples = event.getCoalescedEvents?.();
  return samples?.length ? samples : [event];
}

export function rejectPalm(event: PointerEvent, activePointerType: string | null): boolean {
  if (activePointerType !== "pen" || event.pointerType !== "touch") return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

// Real-device touch down arrived 289 ms after pen cancellation; 400 ms leaves margin.
export const PALM_REJECTION_WINDOW_MS = 400;
export const PEN_COOLDOWN_MS = 1200;

export class PalmGuard {
  private lastPenAt = -Infinity;
  private penEndedAt = -Infinity;
  private rejected = new Set<number>();

  end(event: PointerEvent, activePointerType: string | null, activePointerId: number | null): void {
    this.rejected.delete(event.pointerId);
    if (activePointerType === "pen" && event.pointerId === activePointerId) {
      this.penEndedAt = this.lastPenAt = performance.now();
    }
  }

  down(event: PointerEvent, activePointerType: string | null): boolean {
    const now = performance.now();
    if (rejectPalm(event, activePointerType) || (event.pointerType === "touch" && (now - this.lastPenAt < PALM_REJECTION_WINDOW_MS || now - this.penEndedAt < PEN_COOLDOWN_MS) && rejectPalm(event, "pen"))) {
      this.lastPenAt = now; this.rejected.add(event.pointerId); return true;
    }
    return false;
  }

  move(event: PointerEvent, activePointerType: string | null): boolean {
    return rejectPalm(event, this.rejected.has(event.pointerId) ? "pen" : activePointerType);
  }
}

export function inkEndpoint(event: PointerEvent, point: Stroke, previous: Stroke): Stroke | null {
  if (Math.abs(previous.x - point.x) <= 1e-7 && Math.abs(previous.y - point.y) <= 1e-7) return null;
  return event.pointerType === "pen" && !event.pressure && previous.pressure !== undefined
    ? { ...point, pressure: previous.pressure } : point;
}
