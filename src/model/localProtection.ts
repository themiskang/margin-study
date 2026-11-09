import type { Annotation, PluginData } from "../types";
import { sha256Hex } from "../utils/sha256";

export const protectedCollections = ["cards", "nodes", "studySets", "canvases", "documents", "cardTemplates", "sceneTemplates", "reviewLogs", "practiceAttempts", "reviewPending", "reviewDecks"] as const;
export type ProtectedCollection = typeof protectedCollections[number] | "annotations";
export interface ProtectedObject {
  collection: ProtectedCollection;
  id: string;
  value: Record<string, unknown>;
  docPath?: string;
}
export interface ProtectionSnapshot {
  format: "margin-study-protection";
  version: 1;
  id: string;
  createdAt: string;
  reason: string;
  scope: { collection: ProtectedCollection; id: string; docPath?: string }[];
  objects: ProtectedObject[];
  data?: PluginData;
  remote?: unknown;
  checksum: string;
}
export type ProtectionSnapshotInfo = Pick<ProtectionSnapshot, "id" | "createdAt" | "reason" | "scope"> & { path: string };

export function protectedObjects(data: Partial<PluginData>): ProtectedObject[] {
  return protectedCollections.flatMap(collection => ((data[collection] ?? []) as unknown as Record<string, unknown>[])
    .filter(value => typeof value.id === "string" && !!value.id)
    .map(value => ({ collection, id: value.id as string, value: JSON.parse(JSON.stringify(value)) })));
}

export function protectedAnnotations(path: string, annotations: Annotation[]): ProtectedObject[] {
  return annotations.map(value => ({ collection: "annotations", id: value.id, docPath: path, value: JSON.parse(JSON.stringify(value)) }));
}

export function signProtectionSnapshot(snapshot: Omit<ProtectionSnapshot, "checksum">): ProtectionSnapshot {
  return { ...snapshot, checksum: sha256Hex(JSON.stringify(snapshot)) };
}

export function validateProtectionSnapshot(value: unknown): ProtectionSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("保护快照格式无效");
  const snapshot = value as ProtectionSnapshot, { checksum, ...content } = snapshot;
  if (snapshot.format !== "margin-study-protection" || snapshot.version !== 1 || typeof snapshot.id !== "string" || !snapshot.id ||
      typeof snapshot.createdAt !== "string" || !Number.isFinite(Date.parse(snapshot.createdAt)) || typeof snapshot.reason !== "string" ||
      !Array.isArray(snapshot.objects) || !Array.isArray(snapshot.scope) || typeof checksum !== "string" || sha256Hex(JSON.stringify(content)) !== checksum) throw new Error("保护快照校验失败");
  for (const item of snapshot.objects) {
    if (!item || ![...protectedCollections, "annotations"].includes(item.collection) || typeof item.id !== "string" || !item.id ||
        !item.value || typeof item.value !== "object" || Array.isArray(item.value) || item.value.id !== item.id ||
        (item.collection === "annotations" && (typeof item.docPath !== "string" || !item.docPath))) throw new Error("保护快照对象无效");
  }
  const scope = snapshot.objects.map(({ collection, id, docPath }) => ({ collection, id, ...(docPath ? { docPath } : {}) }));
  if (JSON.stringify(snapshot.scope) !== JSON.stringify(scope)) throw new Error("保护快照范围不一致");
  return snapshot;
}
