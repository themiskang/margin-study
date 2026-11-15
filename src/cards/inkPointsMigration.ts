import type { MindmapInkStroke } from "../mindmap/handwritingContracts";
import type { Card } from "../types";

export type VersionedInkStroke = MindmapInkStroke & { pointsVersion?: number };
export type CardInkMedia = Omit<NonNullable<Card["commentMedia"]>[number], "strokes"> & { strokes?: VersionedInkStroke[] };

export type InkSnapshotMeta =
  | { kind: "short"; snapshotWidth: number; snapshotHeight: number }
  | { kind: "segmented"; compositeWidth: number; compositeHeight: number; snapshotLeft: number; snapshotTop: number };

export function migrateInkPointsToContent(strokes: VersionedInkStroke[], snapshotMeta: InkSnapshotMeta): VersionedInkStroke[] {
  if (strokes.every(stroke => (stroke.pointsVersion ?? 1) >= 2)) return strokes;
  return strokes.map(stroke => {
    if ((stroke.pointsVersion ?? 1) >= 2) return stroke;
    return {
      ...stroke,
      pointsVersion: 2,
      points: stroke.points.map(point => ({
        ...point,
        x: snapshotMeta.kind === "short" ? point.x * snapshotMeta.snapshotWidth : point.x * snapshotMeta.compositeWidth - snapshotMeta.snapshotLeft,
        y: snapshotMeta.kind === "short" ? point.y * snapshotMeta.snapshotHeight : point.y * snapshotMeta.compositeHeight - snapshotMeta.snapshotTop,
      })),
    };
  });
}

export async function readInkCommentToContent(item: CardInkMedia, imageSize: (source: string) => Promise<{ width: number; height: number }>): Promise<CardInkMedia> {
  if (item.kind !== "ink" || !item.strokes?.length || item.strokes.every(stroke => (stroke.pointsVersion ?? 1) >= 2)) return item;
  let snapshotMeta: InkSnapshotMeta;
  if (item.parts?.length) {
    if (!item.snapshot) throw new Error("分段批注缺少快照坐标");
    const parts = [...item.parts].sort((left, right) => left.y - right.y);
    let compositeHeight = 0;
    for (const part of parts) {
      if (!Number.isFinite(part.y) || !Number.isFinite(part.height) || part.y !== compositeHeight || part.height <= 0) throw new Error("批注分段尺寸无效");
      compositeHeight += part.height;
    }
    const size = await imageSize(parts[0].image);
    if (!(size.width > 0) || !Number.isFinite(size.width) || !Number.isFinite(item.snapshot.x) || !Number.isFinite(item.snapshot.y)) throw new Error("批注快照尺寸无效");
    snapshotMeta = { kind: "segmented", compositeWidth: size.width, compositeHeight, snapshotLeft: item.snapshot.x * size.width, snapshotTop: item.snapshot.y * compositeHeight };
  } else {
    const size = await imageSize(item.snapshot?.image || item.image);
    if (!(size.width > 0) || !(size.height > 0) || !Number.isFinite(size.width) || !Number.isFinite(size.height)) throw new Error("批注快照尺寸无效");
    snapshotMeta = { kind: "short", snapshotWidth: size.width, snapshotHeight: size.height };
  }
  return { ...item, strokes: migrateInkPointsToContent(item.strokes, snapshotMeta) };
}
