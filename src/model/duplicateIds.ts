export interface DuplicateRepairEntry {
  collection: string;
  id: string;
  /** kept-latest：保留更新时间最新的一条；dedupe-identical：内容相同，去掉重复。 */
  strategy: "kept-latest" | "dedupe-identical";
  dropped: number;
}

export interface DuplicateRepairResult {
  data: any;
  repaired: DuplicateRepairEntry[];
}

const ID_COLLECTIONS = ["cards", "nodes", "studySets", "canvases", "documents", "reviewDecks", "cardTemplates", "reviewLogs", "practiceAttempts", "reviewPending"] as const;

function stamp(value: any): number {
  const raw = value?.updatedAt ?? value?.createdAt ?? value?.at ?? value?.queuedAt;
  const time = raw ? Date.parse(String(raw)) : NaN;
  return Number.isFinite(time) ? time : 0;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * MN5 5.0.2：导入学习集或恢复旧版本时，重复卡片编号不再整包失败。
 * 规则：内容完全相同→去重；内容不同→保留时间戳最新的一条（其余丢弃并登记）。
 * 只处理 id 集合，不改动无关字段；返回登记项供调用方写本地事件。
 */
export function repairDuplicateIds(input: any): DuplicateRepairResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { data: input, repaired: [] };
  const data = structuredClone(input);
  const repaired: DuplicateRepairEntry[] = [];
  for (const collection of ID_COLLECTIONS) {
    const list = data[collection];
    if (!Array.isArray(list)) continue;
    const byId = new Map<string, any[]>();
    for (const item of list) {
      if (!item || typeof item.id !== "string" || !item.id) continue;
      const bucket = byId.get(item.id) ?? [];
      bucket.push(item);
      byId.set(item.id, bucket);
    }
    const kept: any[] = [];
    for (const item of list) if (!item || typeof item.id !== "string" || !item.id) kept.push(item);
    for (const [id, bucket] of byId) {
      if (bucket.length === 1) { kept.push(bucket[0]); continue; }
      const identical = bucket.every(item => sameJson(item, bucket[0]));
      if (identical) {
        kept.push(bucket[0]);
        repaired.push({ collection, id, strategy: "dedupe-identical", dropped: bucket.length - 1 });
        continue;
      }
      const winner = bucket.slice().sort((a, b) => stamp(b) - stamp(a))[0];
      kept.push(winner);
      repaired.push({ collection, id, strategy: "kept-latest", dropped: bucket.length - 1 });
    }
    data[collection] = kept;
  }
  return { data, repaired };
}
