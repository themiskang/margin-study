/**
 * 最小 SQLite 3 数据库文件写入器（只写不读）。
 *
 * 支持：rowid 表、UTF-8、页大小 4096、记录溢出页、多级表 b-tree。
 * 不生成：二级索引、WAL、freelist、auto-vacuum（读取方均不需要）。
 * 用途：A22 在移动端兼容地生成 Anki APKG 内的 collection.anki2；
 * 正确性由独立 SQLite 读取器（PRAGMA integrity_check + 计数核验）把关。
 */

const PAGE_SIZE = 4096;
const USABLE = PAGE_SIZE; // reserved 字节为 0
const PAGE_LEAF_TABLE = 0x0d;
const PAGE_INTERIOR_TABLE = 0x05;
/** 叶页最大本地负载：usable - 35 */
const MAX_LOCAL = USABLE - 35;
/** 叶页最小本地负载：((usable - 12) * 32 / 255) - 23 */
const MIN_LOCAL = Math.floor(((USABLE - 12) * 32) / 255) - 23;
const SQLITE_VERSION_NUMBER = 3045001;

export type SqliteValue = number | string | Uint8Array | null;

export interface SqliteRow {
  rowid: number;
  values: SqliteValue[];
}

interface TableSpec {
  name: string;
  sql: string;
  rows: SqliteRow[];
}

interface OverflowRef {
  pageNumber: number;
  next: number;
  chunk: Uint8Array;
}

// ===== varint / 记录编码 =====

function appendVarint(out: number[], value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error("sqlite varint 需要非负安全整数：" + value);
  }
  if (value < 0x80) { out.push(value); return; }
  const groups: number[] = [];
  let v = value;
  while (v > 0) { groups.unshift(v % 128); v = Math.floor(v / 128); }
  // value < 2^53 ⇒ groups.length ≤ 8，第九字节全量场景不会出现
  for (let i = 0; i < groups.length - 1; i++) out.push(groups[i] | 0x80);
  out.push(groups[groups.length - 1]);
}

function varintLength(value: number): number {
  if (value < 0x80) return 1;
  if (value < 0x4000) return 2;
  if (value < 0x200000) return 3;
  if (value < 0x10000000) return 4;
  if (value < 0x800000000) return 5;
  if (value < 0x4000000000000) return 6;
  return 7; // < 2^49，覆盖 2^53 内的所有值
}

function appendIntBytes(out: number[], value: number, width: number): void {
  const modulus = Math.pow(2, width * 8);
  let v = value < 0 ? value + modulus : value;
  if (v >= modulus || !Number.isFinite(v)) throw new Error("整数超出编码宽度：" + value);
  const bytes: number[] = [];
  for (let i = 0; i < width; i++) { bytes.unshift(v % 256); v = Math.floor(v / 256); }
  out.push(...bytes);
}

/** 按有符号范围选最小整型宽度；0/1 用常量 serial type 8/9。 */
function serialForInt(value: number): { type: number; width: number } {
  if (value === 0) return { type: 8, width: 0 };
  if (value === 1) return { type: 9, width: 0 };
  // serial type 与字宽的对应：1→1、2→2、3→3、4→4、5→6、6→8 字节
  const table: [number, number, number, number][] = [
    [1, 1, -0x80, 0x7f],
    [2, 2, -0x8000, 0x7fff],
    [3, 3, -0x800000, 0x7fffff],
    [4, 4, -0x80000000, 0x7fffffff],
    [5, 6, -140737488355328, 140737488355327],
  ];
  for (const [type, width, min, max] of table) {
    if (value >= min && value <= max) return { type, width };
  }
  return { type: 6, width: 8 };
}

function encodeRecord(values: SqliteValue[]): Uint8Array {
  const types: number[] = [];
  const bodies: number[] = [];
  for (const value of values) {
    if (value === null) { types.push(0); continue; }
    if (typeof value === "number") {
      if (Number.isSafeInteger(value)) {
        const { type, width } = serialForInt(value);
        types.push(type);
        if (width > 0) appendIntBytes(bodies, value, width);
        continue;
      }
      types.push(7);
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, value, false);
      for (let i = 0; i < 8; i++) bodies.push(view.getUint8(i));
      continue;
    }
    if (typeof value === "string") {
      const text = new TextEncoder().encode(value);
      types.push(13 + 2 * text.length);
      for (const byte of text) bodies.push(byte);
      continue;
    }
    types.push(12 + 2 * value.length);
    for (const byte of value) bodies.push(byte);
  }
  const typeVarints: number[] = [];
  for (const type of types) appendVarint(typeVarints, type);
  // 头部长度 varint 需包含自身：迭代到不动点（≤3 次收敛）
  let headerSize = typeVarints.length + 1;
  for (;;) {
    const varintLen = varintLength(headerSize);
    if (varintLen + typeVarints.length === headerSize) break;
    headerSize = varintLen + typeVarints.length;
  }
  const header: number[] = [];
  appendVarint(header, headerSize);
  for (const type of types) appendVarint(header, type);
  const out = new Uint8Array(header.length + bodies.length);
  out.set(header, 0);
  out.set(bodies, header.length);
  return out;
}

// ===== 页与 b-tree 构建 =====

type LeafCell = { bytes: number[]; key: number }; // key = rowid
type TreeNode =
  | { kind: "leaf"; cells: LeafCell[]; number?: number }
  | { kind: "interior"; children: TreeNode[]; cells: { child: TreeNode; key: number }[]; number?: number };

function maxKeyOf(node: TreeNode): number {
  if (node.kind === "leaf") return node.cells.length ? node.cells[node.cells.length - 1].key : 0;
  return maxKeyOf(node.children[node.children.length - 1]);
}

/** 把已编码的单元格按容量贪心装入叶页。 */
function packLeaves(cells: LeafCell[]): TreeNode[] {
  const leaves: TreeNode[] = [];
  let current: LeafCell[] = [];
  let used = 8; // 叶页头
  const flush = () => {
    if (current.length) leaves.push({ kind: "leaf", cells: current });
    current = []; used = 8;
  };
  for (const cell of cells) {
    const need = cell.bytes.length + 2;
    if (used + need > USABLE) flush();
    current.push(cell);
    used += cell.bytes.length + 2;
  }
  flush();
  return leaves.length ? leaves : [{ kind: "leaf", cells: [] }];
}

function buildLevels(leaves: TreeNode[]): TreeNode {
  let level = leaves;
  while (level.length > 1) {
    const parents: TreeNode[] = [];
    let children: TreeNode[] = [];
    let used = 12; // 内部页头（含最右指针）
    const flush = () => {
      if (children.length) {
        const cells = children.slice(0, -1).map((child) => ({ child, key: maxKeyOf(child) }));
        parents.push({ kind: "interior", children, cells });
      }
      children = []; used = 12;
    };
    for (const node of level) {
      const key = maxKeyOf(node);
      const need = 4 + varintLength(key) + 2;
      if (used + need > USABLE) flush();
      children.push(node);
      used += need;
    }
    flush();
    level = parents;
  }
  return level[0];
}

class PageAllocator {
  private next: number;
  constructor(start: number) { this.next = start; }
  alloc(): number { const n = this.next; this.next++; return n; }
  count(): number { return this.next - 1; }
}

function assignNumbers(node: TreeNode, alloc: PageAllocator, rootNumber?: number): void {
  if (node.kind === "interior") for (const child of node.children) assignNumbers(child, alloc);
  node.number = rootNumber ?? alloc.alloc();
}

function writeBtreePage(node: TreeNode, pageNumber: number): Uint8Array {
  const page = new Uint8Array(PAGE_SIZE);
  const view = new DataView(page.buffer);
  const headerOffset = pageNumber === 1 ? 100 : 0;
  if (node.kind === "leaf") {
    const cells = node.cells;
    view.setUint8(headerOffset, PAGE_LEAF_TABLE);
    view.setUint16(headerOffset + 1, 0, false);
    view.setUint16(headerOffset + 3, cells.length, false);
    const total = cells.reduce((sum, cell) => sum + cell.bytes.length, 0);
    view.setUint16(headerOffset + 5, cells.length ? USABLE - total : USABLE, false);
    view.setUint8(headerOffset + 7, 0);
    let pointer = headerOffset + 8;
    let offset = USABLE;
    for (const cell of cells) {
      offset -= cell.bytes.length;
      page.set(cell.bytes, offset);
      view.setUint16(pointer, offset, false);
      pointer += 2;
    }
  } else {
    const cells = node.cells;
    view.setUint8(headerOffset, PAGE_INTERIOR_TABLE);
    view.setUint16(headerOffset + 1, 0, false);
    view.setUint16(headerOffset + 3, cells.length, false);
    const cellBytes = cells.map((cell) => {
      const child = cell.child.number;
      if (!child) throw new Error("内部页子指针缺失");
      const out: number[] = [(child >>> 24) & 0xff, (child >>> 16) & 0xff, (child >>> 8) & 0xff, child & 0xff];
      appendVarint(out, cell.key);
      return out;
    });
    const total = cellBytes.reduce((sum, bytes) => sum + bytes.length, 0);
    view.setUint16(headerOffset + 5, cells.length ? USABLE - total : USABLE, false);
    view.setUint8(headerOffset + 7, 0);
    const rightMost = node.children[node.children.length - 1].number;
    if (!rightMost) throw new Error("内部页最右指针缺失");
    view.setUint32(headerOffset + 8, rightMost, false);
    let pointer = headerOffset + 12;
    let offset = USABLE;
    for (const bytes of cellBytes) {
      offset -= bytes.length;
      page.set(bytes, offset);
      view.setUint16(pointer, offset, false);
      pointer += 2;
    }
  }
  return page;
}

/** 编码一行：返回叶单元格字节；需要时分配溢出页链。 */
function encodeRow(rowid: number, payload: Uint8Array, alloc: PageAllocator, overflow: OverflowRef[]): LeafCell {
  const head: number[] = [];
  appendVarint(head, payload.length);
  appendVarint(head, rowid);
  let localSize = payload.length;
  let tail: number[] = [];
  if (payload.length > MAX_LOCAL) {
    const k = MIN_LOCAL + ((payload.length - MIN_LOCAL) % (USABLE - 4));
    localSize = k <= MAX_LOCAL ? k : MIN_LOCAL;
    const chunks: { start: number; size: number }[] = [];
    let offset = localSize;
    while (offset < payload.length) {
      const size = Math.min(payload.length - offset, USABLE - 4);
      chunks.push({ start: offset, size });
      offset += size;
    }
    const numbers = chunks.map(() => alloc.alloc());
    chunks.forEach((chunk, index) => overflow.push({
      pageNumber: numbers[index],
      next: index + 1 < numbers.length ? numbers[index + 1] : 0,
      chunk: payload.subarray(chunk.start, chunk.start + chunk.size),
    }));
    const first = numbers[0];
    tail = [(first >>> 24) & 0xff, (first >>> 16) & 0xff, (first >>> 8) & 0xff, first & 0xff];
  }
  const bytes = new Uint8Array(head.length + localSize + tail.length);
  for (let i = 0; i < head.length; i++) bytes[i] = head[i];
  bytes.set(payload.subarray(0, localSize), head.length);
  for (let i = 0; i < tail.length; i++) bytes[head.length + localSize + i] = tail[i];
  return { bytes: [...bytes], key: rowid };
}

export class SqliteFile {
  private tables: TableSpec[] = [];

  createTable(name: string, sql: string, rows: SqliteRow[]): void {
    this.tables.push({ name, sql, rows });
  }

  serialize(): Uint8Array {
    const overflow: OverflowRef[] = [];
    // 页号分配：1 保留给 sqlite_master 根；表树从 2 开始连续分配。
    const alloc = new PageAllocator(2);
    const tableRoots: TreeNode[] = [];
    for (const table of this.tables) {
      const cells = table.rows.map((row) => encodeRow(row.rowid, encodeRecord(row.values), alloc, overflow));
      const root = buildLevels(packLeaves(cells));
      assignNumbers(root, alloc);
      tableRoots.push(root);
    }
    // sqlite_master：根页固定为 1，其余页在所有表页之后。
    const masterRows: SqliteRow[] = this.tables.map((table, index) => ({
      rowid: index + 1,
      values: ["table", table.name, table.name, tableRoots[index].number!, table.sql],
    }));
    const masterCells = masterRows.map((row) => encodeRow(row.rowid, encodeRecord(row.values), alloc, overflow));
    const masterRoot = buildLevels(packLeaves(masterCells));
    assignNumbers(masterRoot, alloc, 1);

    const total = Math.max(alloc.count(), 1);
    const pageList: Uint8Array[] = new Array(total).fill(null).map(() => new Uint8Array(PAGE_SIZE));
    const emit = (node: TreeNode): void => {
      if (!node.number) throw new Error("页号缺失");
      pageList[node.number - 1] = writeBtreePage(node, node.number);
      if (node.kind === "interior") for (const child of node.children) emit(child);
    };
    for (const root of tableRoots) emit(root);
    emit(masterRoot);
    for (const ref of overflow) {
      const page = new Uint8Array(PAGE_SIZE);
      new DataView(page.buffer).setUint32(0, ref.next, false);
      page.set(ref.chunk, 4);
      pageList[ref.pageNumber - 1] = page;
    }

    // 文件头（页 1 前 100 字节）
    const header = pageList[0];
    const view = new DataView(header.buffer);
    const magic = "SQLite format 3\0";
    for (let i = 0; i < 16; i++) header[i] = magic.charCodeAt(i);
    view.setUint16(16, PAGE_SIZE, false);
    header[18] = 1; header[19] = 1; // 读写版本 legacy
    header[20] = 0; header[21] = 64; header[22] = 32; header[23] = 32;
    view.setUint32(24, 1, false); // change counter
    view.setUint32(28, total, false); // 页数
    view.setUint32(32, 0, false); // freelist trunk
    view.setUint32(36, 0, false); // freelist count
    view.setUint32(40, 1, false); // schema cookie
    view.setUint32(44, 4, false); // schema format
    view.setUint32(48, 0, false);
    view.setUint32(52, 0, false);
    view.setUint16(56, 1, false); // UTF-8
    view.setUint32(58, 0, false);
    view.setUint16(62, 0, false);
    view.setUint32(64, 0, false);
    view.setUint32(92, 1, false); // version-valid-for
    view.setUint32(96, SQLITE_VERSION_NUMBER, false);

    const out = new Uint8Array(total * PAGE_SIZE);
    for (let i = 0; i < total; i++) out.set(pageList[i], i * PAGE_SIZE);
    return out;
  }
}
